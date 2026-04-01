import type {
  ScannerPostProcessWorkerErrorResponse,
  ScannerPostProcessWorkerRequest,
  ScannerPostProcessWorkerResponse,
} from "./scanner-postprocess-worker-protocol";
import type {Point} from "./document-detector";
import type {OrthogonalRotation} from "./image-data";

const WORKER_INIT_TIMEOUT_MS = 12_000;

interface ProcessRequestOptions {
  documentPoints: Point[] | null;
  outputRotation: OrthogonalRotation;
  imageEnhancement: boolean;
}

export interface ScannerPostProcessWorkerResult {
  processingMs: number;
  decodeMs: number | null;
  perspectiveMs: number | null;
  enhanceMs: number | null;
  rotateMs: number | null;
  encodeMs: number;
  inputWidth: number;
  inputHeight: number;
  outputWidth: number;
  outputHeight: number;
  encodedMimeType: "image/png";
  encodedBytes: ArrayBuffer;
}

interface PendingProcessRequest {
  resolve: (result: ScannerPostProcessWorkerResult) => void;
  reject: (error: Error) => void;
}

export class ScannerPostProcessWorkerClient {
  private worker: Worker | null = null;
  private initPromise: Promise<boolean> | null = null;
  private initResolver: ((ready: boolean) => void) | null = null;
  private initTimeoutId: number | null = null;
  private requestId = 0;
  private ready = false;
  private disposed = false;
  private lastError: string | null = null;
  private readonly pendingRequests = new Map<number, PendingProcessRequest>();

  isReady(): boolean {
    return this.ready && this.worker !== null;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  async ensureReady(): Promise<boolean> {
    if (this.disposed) {
      return false;
    }

    if (this.isReady()) {
      return true;
    }

    if (this.initPromise) {
      return await this.initPromise;
    }

    if (typeof Worker === "undefined") {
      this.lastError = "Web Workers are unavailable in this environment.";
      return false;
    }

    this.initPromise = new Promise<boolean>((resolve) => {
      try {
        this.worker = new Worker(new URL("./scanner-postprocess.worker.ts", import.meta.url), {
          name: "scanner-postprocess-worker",
        });
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        resolve(false);
        return;
      }

      this.initResolver = (ready: boolean) => {
        if (this.initTimeoutId !== null) {
          clearTimeout(this.initTimeoutId);
          this.initTimeoutId = null;
        }

        const worker = this.worker;
        if (!ready && worker) {
          this.detachWorker(worker);
          worker.terminate();
          this.worker = null;
        }

        this.ready = ready;
        this.initResolver = null;
        this.initPromise = null;
        resolve(ready);
      };

      this.worker.addEventListener("message", this.handleMessage);
      this.worker.addEventListener("error", this.handleWorkerError);
      this.initTimeoutId = window.setTimeout(() => {
        this.lastError = "Timed out while starting the scanner post-process worker.";
        this.resolveInit(false);
      }, WORKER_INIT_TIMEOUT_MS);

      this.postMessage({type: "init"});
    });

    return await this.initPromise;
  }

  async process(
    frame: ImageData,
    options: ProcessRequestOptions,
  ): Promise<ScannerPostProcessWorkerResult> {
    const ready = await this.ensureReady();
    if (!ready || !this.worker) {
      throw new Error(this.lastError ?? "Scanner post-process worker is unavailable.");
    }

    const requestId = ++this.requestId;
    const pixels = new Uint8ClampedArray(frame.data);

    return await new Promise<ScannerPostProcessWorkerResult>((resolve, reject) => {
      this.pendingRequests.set(requestId, {resolve, reject});

      try {
        this.postMessage({
          type: "process",
          requestId,
          inputKind: "image-data",
          width: frame.width,
          height: frame.height,
          pixels: pixels.buffer,
          documentPoints: options.documentPoints,
          outputRotation: options.outputRotation,
          imageEnhancement: options.imageEnhancement,
        }, [pixels.buffer]);
      } catch (error) {
        this.pendingRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async processSourceFile(
    sourceFile: Blob,
    options: ProcessRequestOptions,
  ): Promise<ScannerPostProcessWorkerResult> {
    const ready = await this.ensureReady();
    if (!ready || !this.worker) {
      throw new Error(this.lastError ?? "Scanner post-process worker is unavailable.");
    }

    const requestId = ++this.requestId;

    return await new Promise<ScannerPostProcessWorkerResult>((resolve, reject) => {
      this.pendingRequests.set(requestId, {resolve, reject});

      try {
        this.postMessage({
          type: "process",
          requestId,
          inputKind: "encoded-image",
          sourceBlob: sourceFile,
          documentPoints: options.documentPoints,
          outputRotation: options.outputRotation,
          imageEnhancement: options.imageEnhancement,
        });
      } catch (error) {
        this.pendingRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  terminate(): void {
    this.disposed = true;
    this.resolveInit(false);
    this.rejectPendingRequests(new Error("Scanner post-process worker was terminated."));

    if (this.worker) {
      const worker = this.worker;
      this.worker = null;
      this.detachWorker(worker);
      worker.terminate();
    }

    this.ready = false;
  }

  private readonly handleMessage = (event: MessageEvent<ScannerPostProcessWorkerResponse>): void => {
    const message = event.data;

    switch (message.type) {
      case "ready":
        this.lastError = null;
        this.resolveInit(true);
        return;
      case "result": {
        const pending = this.pendingRequests.get(message.requestId);
        if (!pending) {
          return;
        }

        this.pendingRequests.delete(message.requestId);
        pending.resolve({
          processingMs: message.processingMs,
          decodeMs: message.decodeMs,
          perspectiveMs: message.perspectiveMs,
          enhanceMs: message.enhanceMs,
          rotateMs: message.rotateMs,
          encodeMs: message.encodeMs,
          inputWidth: message.inputWidth,
          inputHeight: message.inputHeight,
          outputWidth: message.outputWidth,
          outputHeight: message.outputHeight,
          encodedMimeType: message.encodedMimeType,
          encodedBytes: message.encodedBytes,
        });
        return;
      }
      case "error":
        this.handleWorkerMessageError(message);
        return;
      default:
        return;
    }
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    this.lastError = event.message || "Scanner post-process worker crashed.";
    this.resolveInit(false);
    this.rejectPendingRequests(new Error(this.lastError));

    if (this.worker) {
      const worker = this.worker;
      this.worker = null;
      this.detachWorker(worker);
      worker.terminate();
    }

    this.ready = false;
  };

  private handleWorkerMessageError(message: ScannerPostProcessWorkerErrorResponse): void {
    this.lastError = message.message;

    if (message.phase === "init" || typeof message.requestId === "undefined") {
      this.resolveInit(false);
      this.rejectPendingRequests(new Error(message.message));
      return;
    }

    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(message.requestId);
    pending.reject(new Error(message.message));
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private resolveInit(ready: boolean): void {
    if (!this.initResolver) {
      return;
    }

    const resolver = this.initResolver;
    this.initResolver = null;
    resolver(ready);
  }

  private detachWorker(worker: Worker): void {
    worker.removeEventListener("message", this.handleMessage);
    worker.removeEventListener("error", this.handleWorkerError);
  }

  private postMessage(
    message: ScannerPostProcessWorkerRequest,
    transfer?: Transferable[],
  ): void {
    if (!this.worker) {
      throw new Error("Scanner post-process worker is not available.");
    }

    if (transfer && transfer.length > 0) {
      this.worker.postMessage(message, transfer);
      return;
    }

    this.worker.postMessage(message);
  }
}

export const createScannerPostProcessWorkerClient = (): ScannerPostProcessWorkerClient => {
  return new ScannerPostProcessWorkerClient();
};
