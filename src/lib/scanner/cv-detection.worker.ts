/// <reference lib="webworker" />

import {buildDocumentContourDetectionOptions, detectDocumentContour} from "./document-detector";
import type {
  ScannerCvWorkerDetectRequest,
  ScannerCvWorkerErrorResponse,
  ScannerCvWorkerRequest,
  ScannerCvWorkerResponse,
} from "./cv-worker-protocol";

declare const self: DedicatedWorkerGlobalScope;

interface OpenCvWorkerRuntime {
  Mat?: unknown;
  onRuntimeInitialized?: (() => void) | null;
}

interface WorkerScopeWithOpenCv extends DedicatedWorkerGlobalScope {
  cv?: OpenCvWorkerRuntime;
}

const OPEN_CV_INIT_TIMEOUT_MS = 12_000;
const workerScope = self as WorkerScopeWithOpenCv;
let openCvReadyPromise: Promise<void> | null = null;

const postWorkerMessage = (message: ScannerCvWorkerResponse): void => {
  workerScope.postMessage(message);
};

const postWorkerError = (payload: ScannerCvWorkerErrorResponse): void => {
  postWorkerMessage(payload);
};

const ensureOpenCvReadyInWorker = async (): Promise<void> => {
  if (workerScope.cv?.Mat) {
    return;
  }

  if (openCvReadyPromise) {
    return await openCvReadyPromise;
  }

  openCvReadyPromise = new Promise<void>((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };

    const resolveReady = (): void => {
      cleanup();
      resolve();
    };

    const rejectReady = (error: unknown): void => {
      cleanup();
      reject(error);
    };

    timeoutId = setTimeout(() => {
      rejectReady(new Error("Timed out while loading OpenCV in the scanner worker."));
    }, OPEN_CV_INIT_TIMEOUT_MS);

    try {
      workerScope.importScripts("/opencv.js");
    } catch (error) {
      rejectReady(error);
      return;
    }

    const runtime = workerScope.cv;
    if (!runtime) {
      rejectReady(new Error("OpenCV did not expose a runtime in the scanner worker."));
      return;
    }

    if (runtime.Mat) {
      resolveReady();
      return;
    }

    const previousHandler = runtime.onRuntimeInitialized;
    runtime.onRuntimeInitialized = () => {
      if (typeof previousHandler === "function") {
        previousHandler();
      }
      resolveReady();
    };
  });

  try {
    await openCvReadyPromise;
  } catch (error) {
    openCvReadyPromise = null;
    throw error;
  }
};

const handleInit = async (): Promise<void> => {
  try {
    await ensureOpenCvReadyInWorker();
    postWorkerMessage({ type: "ready" });
  } catch (error) {
    postWorkerError({
      type: "error",
      phase: "init",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

const handleDetect = async (message: ScannerCvWorkerDetectRequest): Promise<void> => {
  try {
    await ensureOpenCvReadyInWorker();

    const startedAt = performance.now();
    const imageData = new ImageData(
      new Uint8ClampedArray(message.pixels),
      message.width,
      message.height,
    );
    const options = buildDocumentContourDetectionOptions(message.width, message.height, {
      maxWidth: message.maxWidth,
      maxHeight: message.maxHeight,
    });
    const points = detectDocumentContour(imageData, options);

    postWorkerMessage({
      type: "result",
      requestId: message.requestId,
      frameVersion: message.frameVersion,
      processingMs: performance.now() - startedAt,
      points,
    });
  } catch (error) {
    postWorkerError({
      type: "error",
      phase: "detect",
      message: error instanceof Error ? error.message : String(error),
      requestId: message.requestId,
    });
  }
};

workerScope.addEventListener("message", (event: MessageEvent<ScannerCvWorkerRequest>) => {
  switch (event.data.type) {
    case "init":
      void handleInit();
      break;
    case "detect":
      void handleDetect(event.data);
      break;
    default:
      postWorkerError({
        type: "error",
        phase: "runtime",
        message: `Unsupported scanner CV worker message: ${(event.data as { type?: string }).type ?? "unknown"}`,
      });
      break;
  }
});

export {};
