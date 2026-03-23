import {create} from "zustand";
import type {FrameSource, Point, ScannerConfig} from "@/lib/scanner";

/**
 * Scanner state management for the ADB camera document scanner.
 */

export type ScannerStatus = "idle" | "connecting" | "streaming" | "error";
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
  /** Instantaneous preview FPS estimated from the latest frame interval. */
  previewFps: number | null;
  /** Recent window FPS estimated from a short rolling frame history. */
  recentWindowFps: number | null;
  /** Effective end-to-end FPS sampled from the transport log. */
  effectiveFps: number | null;
  /** Latest payload size in bytes sampled from the transport log. */
  payloadBytes: number | null;
  /** Latest IPC cost in milliseconds sampled from the transport log. */
  ipcMs: number | null;
  /** Latest frame decode cost in milliseconds sampled from the transport log. */
  frameDecodeMs: number | null;
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
  capturedDocuments: File[];
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
  addCapturedDocument: (doc: File) => void;
  removeCapturedDocument: (index: number) => void;
  clearCapturedDocuments: () => void;
  setPreviewDebug: (patch: Partial<ScannerPreviewDebugState>) => void;
  setCvDebug: (patch: Partial<ScannerCvDebugState>) => void;
  setConnectionDebug: (patch: Partial<ScannerConnectionDebugState>) => void;
  setCaptureDebug: (patch: Partial<ScannerCaptureDebugState>) => void;
  resetDebugState: () => void;
  reset: () => void;
}

const createInitialPreviewDebugState = (): ScannerPreviewDebugState => ({
  frameIndex: 0,
  previewFps: null,
  recentWindowFps: null,
  effectiveFps: null,
  payloadBytes: null,
  ipcMs: null,
  frameDecodeMs: null,
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
    set({ status, errorMessage: error ?? null }),

  setFrameSource: (source) =>
    set({ frameSource: source }),

  setConfig: (config) =>
    set({ config }),

  incrementFrameCount: () =>
    set((state) => ({ frameCount: state.frameCount + 1 })),

  resetFrameCount: () =>
    set({ frameCount: 0 }),

  addCapturedDocument: (doc) =>
    set((state) => ({
      capturedDocuments: [...state.capturedDocuments, doc],
    })),

  removeCapturedDocument: (index) =>
    set((state) => ({
      capturedDocuments: state.capturedDocuments.filter((_, i) => i !== index),
    })),

  clearCapturedDocuments: () =>
    set({ capturedDocuments: [] }),

  setPreviewDebug: (patch) =>
    set((state) => ({
      previewDebug: { ...state.previewDebug, ...patch },
    })),

  setCvDebug: (patch) =>
    set((state) => ({
      cvDebug: { ...state.cvDebug, ...patch },
    })),

  setConnectionDebug: (patch) =>
    set((state) => ({
      connectionDebug: { ...state.connectionDebug, ...patch },
    })),

  setCaptureDebug: (patch) =>
    set((state) => ({
      captureDebug: { ...state.captureDebug, ...patch },
    })),

  resetDebugState: () =>
    set({
      previewDebug: createInitialPreviewDebugState(),
      cvDebug: createInitialCvDebugState(),
      connectionDebug: createInitialConnectionDebugState(),
      captureDebug: createInitialCaptureDebugState(),
    }),

  reset: () => set(createInitialState()),
}));
