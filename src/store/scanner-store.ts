import {create} from "zustand";
import type {FrameSource, Point, ScannerConfig} from "@/lib/scanner";

/**
 * Scanner state management for the ADB camera document scanner.
 */

export type ScannerStatus = "idle" | "connecting" | "streaming" | "error";
export type ScannerCapturedDocumentStatus = "processing" | "ready" | "failed";
export type ScannerReconnectState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "stopped"
  | "error";
export type ScannerHighQualityCaptureStatus =
  | "idle"
  | "capturing"
  | "processing"
  | "success"
  | "error";
export type ScannerCvPipeline = "idle" | "preview" | "single-hq";

export interface ScannerPreviewDebugState {
  /** Latest frame index observed by the UI. */
  frameIndex: number;
  /** Instant preview FPS derived from the latest frame interval. */
  previewFps: number | null;
  /** Recent preview FPS across a contiguous short rolling window. */
  recentWindowFps: number | null;
  /** Average active preview FPS since the first frame, excluding reconnect downtime. */
  effectiveFps: number | null;
  /** Latest payload size in bytes sampled from the transport log. */
  payloadBytes: number | null;
  /** Latest wall-clock wait for the preview invoke/poll handoff in milliseconds. */
  pollWaitMs: number | null;
  /** Latest JavaScript frame packet decode cost in milliseconds. */
  jsDecodeMs: number | null;
  /** Latest canvas draw/upload cost for the preview surface in milliseconds. */
  canvasDrawMs: number | null;
  /** Number of polling attempts reported by the transport log. */
  pollCount: number | null;
  /** Current preview frame width. */
  previewWidth: number | null;
  /** Current preview frame height. */
  previewHeight: number | null;
  /** Transport label for the live preview pipeline. */
  transport: string | null;
  /** Timestamp when preview debug info was last refreshed. */
  updatedAt: number | null;
}

export interface ScannerCvDebugState {
  /** Current CV pipeline stage. */
  pipeline: ScannerCvPipeline;
  /** Whether OpenCV appears to be ready. */
  cvReady: boolean;
  /** Whether a document contour is currently detected. */
  documentDetected: boolean;
  /** Number of detected corners in the active contour. */
  cornerCount: number;
  /** Ordered corner points for the detected contour. */
  cornerPoints: Point[];
  /** Whether the detected contour is currently stable. */
  isStable: boolean;
  /** Resolution currently used by CV processing. */
  processingWidth: number | null;
  /** Resolution currently used by CV processing. */
  processingHeight: number | null;
  /** Whether preview auto-capture is enabled. */
  autoCaptureEnabled: boolean;
  /** Whether a capture/enhancement pipeline is actively running. */
  isProcessing: boolean;
  /** Timestamp when CV debug info was last refreshed. */
  updatedAt: number | null;
}

export interface ScannerConnectionDebugState {
  /** Current preview/reconnect state shown in the UI. */
  reconnectState: ScannerReconnectState;
  /** Current reconnect attempt if provided by the transport. */
  reconnectAttempt: number | null;
  /** Maximum reconnect attempts if provided by the transport. */
  reconnectMaxAttempts: number | null;
  /** Delay before the next reconnect attempt if provided by the transport. */
  reconnectDelayMs: number | null;
  /** Human-readable reconnect message from the transport. */
  reconnectMessage: string | null;
  /** Most recent error reason surfaced by the preview pipeline. */
  lastErrorReason: string | null;
  /** Timestamp when the preview stream most recently disconnected. */
  lastDisconnectAt: number | null;
}

export interface ScannerCaptureDebugState {
  /** Status for the explicit single high-quality extraction flow. */
  highQualityStatus: ScannerHighQualityCaptureStatus;
  /** Source label used by the latest single high-quality extraction. */
  highQualitySource: string | null;
  /** Reason why the high-quality path had to fall back to preview export. */
  highQualityFallbackReason: string | null;
  /** Source label for the most recently completed capture artifact. */
  lastCaptureSource: "preview-stream" | "single-hq" | null;
  /** Width of the latest captured still image. */
  lastCaptureWidth: number | null;
  /** Height of the latest captured still image. */
  lastCaptureHeight: number | null;
  /** Timestamp when the latest capture completed. */
  lastCaptureAt: number | null;
  /** Most recent capture error. */
  lastCaptureError: string | null;
  /** Whether the latest capture had a document contour. */
  lastCaptureDocumentDetected: boolean;
}

export interface ScannerCapturedDocument {
  /** Stable identifier for UI updates and post-processing. */
  id: string;
  /** Current export file; becomes the processed output once ready. */
  file: File;
  /** Original captured image used for manual recropping. */
  sourceFile: File;
  /** Current ordered corner points in source-image coordinates. */
  points: Point[] | null;
  /** Async post-processing state. */
  status: ScannerCapturedDocumentStatus;
  /** Latest post-processing error, if any. */
  error: string | null;
  /** Whether the original capture had a detected contour. */
  documentDetected: boolean;
  /** Capture transport used for this document. */
  captureSource: "preview-stream" | "single-hq";
  /** Natural source-image width. */
  sourceWidth: number;
  /** Natural source-image height. */
  sourceHeight: number;
  /** Stable filename prefix for regenerated outputs. */
  outputNameBase: string;
}

export interface ScannerState {
  /** Current scanner lifecycle status. */
  status: ScannerStatus;
  /** Error message if status is "error". */
  errorMessage: string | null;
  /** Active frame source instance. */
  frameSource: FrameSource | null;
  /** Currently active scanner configuration. */
  config: ScannerConfig | null;
  /** Number of frames received in current session. */
  frameCount: number;
  /** Captured document images ready to send to AI. */
  capturedDocuments: ScannerCapturedDocument[];
  /** Transport and preview debug metrics. */
  previewDebug: ScannerPreviewDebugState;
  /** CV detection debug metrics. */
  cvDebug: ScannerCvDebugState;
  /** Connection and reconnect debug metrics. */
  connectionDebug: ScannerConnectionDebugState;
  /** Capture source/status debug metrics. */
  captureDebug: ScannerCaptureDebugState;

  // Actions
  setStatus: (status: ScannerStatus, error?: string) => void;
  setFrameSource: (source: FrameSource | null) => void;
  setConfig: (config: ScannerConfig | null) => void;
  incrementFrameCount: () => void;
  resetFrameCount: () => void;
  addCapturedDocument: (doc: ScannerCapturedDocument) => void;
  updateCapturedDocument: (
    id: string,
    updates: Partial<ScannerCapturedDocument>,
  ) => void;
  removeCapturedDocument: (id: string) => void;
  clearCapturedDocuments: () => void;
  setPreviewDebug: (patch: Partial<ScannerPreviewDebugState>) => void;
  setCvDebug: (patch: Partial<ScannerCvDebugState>) => void;
  setConnectionDebug: (patch: Partial<ScannerConnectionDebugState>) => void;
  setCaptureDebug: (patch: Partial<ScannerCaptureDebugState>) => void;
  resetDebugState: () => void;
  reset: () => void;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isSamePatchValue = (current: unknown, next: unknown): boolean => {
  if (Object.is(current, next)) {
    return true;
  }

  if (Array.isArray(current) && Array.isArray(next)) {
    return current.length === next.length
      && current.every((value, index) => isSamePatchValue(value, next[index]));
  }

  if (isPlainObject(current) && isPlainObject(next)) {
    const currentKeys = Object.keys(current);
    const nextKeys = Object.keys(next);

    return currentKeys.length === nextKeys.length
      && currentKeys.every((key) => isSamePatchValue(current[key], next[key]));
  }

  return false;
};

const mergePatchIfChanged = <T extends object>(
  current: T,
  patch: Partial<T>,
  ignoredKeys: ReadonlyArray<keyof T> = [],
): T => {
  const keys = Object.keys(patch) as Array<keyof T>;
  const hasChange = keys.some((key) => {
    if (ignoredKeys.includes(key)) {
      return false;
    }

    return !isSamePatchValue(current[key], patch[key]);
  });

  return hasChange ? { ...current, ...patch } : current;
};

const createInitialPreviewDebugState = (): ScannerPreviewDebugState => ({
  frameIndex: 0,
  previewFps: null,
  recentWindowFps: null,
  effectiveFps: null,
  payloadBytes: null,
  pollWaitMs: null,
  jsDecodeMs: null,
  canvasDrawMs: null,
  pollCount: null,
  previewWidth: null,
  previewHeight: null,
  transport: null,
  updatedAt: null,
});

const createInitialCvDebugState = (): ScannerCvDebugState => ({
  pipeline: "idle",
  cvReady: false,
  documentDetected: false,
  cornerCount: 0,
  cornerPoints: [],
  isStable: false,
  processingWidth: null,
  processingHeight: null,
  autoCaptureEnabled: true,
  isProcessing: false,
  updatedAt: null,
});

const createInitialConnectionDebugState = (): ScannerConnectionDebugState => ({
  reconnectState: "idle",
  reconnectAttempt: null,
  reconnectMaxAttempts: null,
  reconnectDelayMs: null,
  reconnectMessage: null,
  lastErrorReason: null,
  lastDisconnectAt: null,
});

const createInitialCaptureDebugState = (): ScannerCaptureDebugState => ({
  highQualityStatus: "idle",
  highQualitySource: null,
  highQualityFallbackReason: null,
  lastCaptureSource: null,
  lastCaptureWidth: null,
  lastCaptureHeight: null,
  lastCaptureAt: null,
  lastCaptureError: null,
  lastCaptureDocumentDetected: false,
});

const createInitialState = () => ({
  status: "idle" as ScannerStatus,
  errorMessage: null,
  frameSource: null,
  config: null,
  frameCount: 0,
  capturedDocuments: [],
  previewDebug: createInitialPreviewDebugState(),
  cvDebug: createInitialCvDebugState(),
  connectionDebug: createInitialConnectionDebugState(),
  captureDebug: createInitialCaptureDebugState(),
});

export const useScannerStore = create<ScannerState>((set) => ({
  ...createInitialState(),

  setStatus: (status, error) =>
    set((state) => {
      const errorMessage = error ?? null;
      return state.status === status && Object.is(state.errorMessage, errorMessage)
        ? state
        : { status, errorMessage };
    }),

  setFrameSource: (source) =>
    set((state) => {
      return state.frameSource === source ? state : { frameSource: source };
    }),

  setConfig: (config) =>
    set((state) => {
      return state.config === config ? state : { config };
    }),

  incrementFrameCount: () =>
    set((state) => ({ frameCount: state.frameCount + 1 })),

  resetFrameCount: () =>
    set((state) => {
      return state.frameCount === 0 ? state : { frameCount: 0 };
    }),

  addCapturedDocument: (doc) =>
    set((state) => ({
      capturedDocuments: [...state.capturedDocuments, doc],
    })),

  updateCapturedDocument: (id, updates) =>
    set((state) => {
      let didChange = false;
      const capturedDocuments = state.capturedDocuments.map((document) => {
        if (document.id !== id) {
          return document;
        }

        didChange = true;
        return { ...document, ...updates };
      });

      return didChange ? { capturedDocuments } : state;
    }),

  removeCapturedDocument: (id) =>
    set((state) => ({
      capturedDocuments: state.capturedDocuments.filter((document) => document.id !== id),
    })),

  clearCapturedDocuments: () =>
    set({ capturedDocuments: [] }),

  setPreviewDebug: (patch) =>
    set((state) => {
      const previewDebug = mergePatchIfChanged(state.previewDebug, patch, ["updatedAt"]);
      return previewDebug === state.previewDebug ? state : { previewDebug };
    }),

  setCvDebug: (patch) =>
    set((state) => {
      const cvDebug = mergePatchIfChanged(state.cvDebug, patch, ["updatedAt"]);
      return cvDebug === state.cvDebug ? state : { cvDebug };
    }),

  setConnectionDebug: (patch) =>
    set((state) => {
      const connectionDebug = mergePatchIfChanged(state.connectionDebug, patch);
      return connectionDebug === state.connectionDebug ? state : { connectionDebug };
    }),

  setCaptureDebug: (patch) =>
    set((state) => {
      const captureDebug = mergePatchIfChanged(state.captureDebug, patch);
      return captureDebug === state.captureDebug ? state : { captureDebug };
    }),

  resetDebugState: () =>
    set({
      previewDebug: createInitialPreviewDebugState(),
      cvDebug: createInitialCvDebugState(),
      connectionDebug: createInitialConnectionDebugState(),
      captureDebug: createInitialCaptureDebugState(),
    }),

  reset: () => set(createInitialState()),
}));
