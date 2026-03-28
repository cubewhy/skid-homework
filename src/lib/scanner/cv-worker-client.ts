import type {Point} from "./document-detector";
import type {
  ScannerCvWorkerErrorResponse,
  ScannerCvWorkerRequest,
  ScannerCvWorkerResponse,
} from "./cv-worker-protocol";

const WORKER_INIT_TIMEOUT_MS = 12_000;

interface DetectionRequestOptions {
  frameVersion: number;
  maxWidth: number;
  maxHeight: number;
}

export interface ScannerCvWorkerDetectionResult {
  frameVersion: number;
  processingMs: number;
  points: Point[] | null;
}

interface PendingDetection {
  resolve: (result: ScannerCvWorkerDetectionResult) => void;
  reject: (error: Error) => void;
}

export class ScannerCvWorkerClient {
  private worker: Worker | null = null;
  private initPromise: Promise<boolean> | null = null;
  private initResolver: ((ready: boolean) => void) | null = null;
  private initTimeoutId: number | null = null;
  private requestId = 0;
  private ready = false;
  private disposed = false;
  private lastError: string | null = null;
  private readonly pendingDetections = new Map<number, PendingDetection>();

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
        this.worker = new Worker(new URL("./cv-detection.worker.ts", import.meta.url), {
          name: "scanner-cv-worker",
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
        this.lastError = "Timed out while starting the scanner CV worker.";
        this.resolveInit(false);
      }, WORKER_INIT_TIMEOUT_MS);

      this.postMessage({ type: "init" });
    });

    return await this.initPromise;
  }

  async detect(
    frame: ImageData,
    options: DetectionRequestOptions,
  ): Promise<ScannerCvWorkerDetectionResult> {
    const ready = await this.ensureReady();
    if (!ready || !this.worker) {
      throw new Error(this.lastError ?? "Scanner CV worker is unavailable.");
    }

    const requestId = ++this.requestId;
    const pixels = frame.data.slice();

    return await new Promise<ScannerCvWorkerDetectionResult>((resolve, reject) => {
      this.pendingDetections.set(requestId, { resolve, reject });

      try {
        this.postMessage({
          type: "detect",
          requestId,
          frameVersion: options.frameVersion,
          width: frame.width,
          height: frame.height,
          maxWidth: options.maxWidth,
          maxHeight: options.maxHeight,
          pixels: pixels.buffer,
        }, [pixels.buffer]);
      } catch (error) {
        this.pendingDetections.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  terminate(): void {
    this.disposed = true;
    this.resolveInit(false);
    this.rejectPendingDetections(new Error("Scanner CV worker was terminated."));

    if (this.worker) {
      const worker = this.worker;
      this.worker = null;
      this.detachWorker(worker);
      worker.terminate();
    }

    this.ready = false;
  }

  private readonly handleMessage = (event: MessageEvent<ScannerCvWorkerResponse>): void => {
    const message = event.data;

    switch (message.type) {
      case "ready":
        this.lastError = null;
        this.resolveInit(true);
        return;
      case "result": {
        const pending = this.pendingDetections.get(message.requestId);
        if (!pending) {
          return;
        }

        this.pendingDetections.delete(message.requestId);
        pending.resolve({
          frameVersion: message.frameVersion,
          processingMs: message.processingMs,
          points: message.points,
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
    this.lastError = event.message || "Scanner CV worker crashed.";
    this.resolveInit(false);
    this.rejectPendingDetections(new Error(this.lastError));

    if (this.worker) {
      const worker = this.worker;
      this.worker = null;
      this.detachWorker(worker);
      worker.terminate();
    }

    this.ready = false;
  };

  private handleWorkerMessageError(message: ScannerCvWorkerErrorResponse): void {
    this.lastError = message.message;

    if (message.phase === "init" || typeof message.requestId === "undefined") {
      this.resolveInit(false);
      this.rejectPendingDetections(new Error(message.message));
      return;
    }

    const pending = this.pendingDetections.get(message.requestId);
    if (!pending) {
      return;
    }

    this.pendingDetections.delete(message.requestId);
    pending.reject(new Error(message.message));
  }

  private rejectPendingDetections(error: Error): void {
    for (const pending of this.pendingDetections.values()) {
      pending.reject(error);
    }
    this.pendingDetections.clear();
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
    message: ScannerCvWorkerRequest,
    transfer?: Transferable[],
  ): void {
    if (!this.worker) {
      throw new Error("Scanner CV worker is not available.");
    }

    if (transfer && transfer.length > 0) {
      this.worker.postMessage(message, transfer);
      return;
    }

    this.worker.postMessage(message);
  }
}

export const createScannerCvWorkerClient = (): ScannerCvWorkerClient => {
  return new ScannerCvWorkerClient();
};
