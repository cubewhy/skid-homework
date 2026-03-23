"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  applyPerspectiveTransform,
  createFrameSource,
  DEFAULT_SCANNER_CONFIG,
  detectDocumentContour,
  enhanceDocumentImage,
  StabilityTracker,
  type FrameSource,
  type FrameSourceState,
  type Point,
  type ScannerConfig,
} from "@/lib/scanner";
import { isOpenCvReady } from "@/lib/scanner/opencv-runtime";
import { getSelectedDesktopAdbSerial } from "@/lib/webadb/screenshot";
import { useScannerStore } from "@/store/scanner-store";
import { cn } from "@/lib/utils";

import OpenCVLoader from "../OpenCVLoader";
import { ScannerControls } from "./ScannerControls";
import {
  ScannerCvDebugCard,
  ScannerDebugPanel,
  ScannerPreviewDebugCard,
} from "./ScannerDebugPanel";
import { ScannerOverlay } from "./ScannerOverlay";
import { ScannerPreviewHud } from "./ScannerPreviewHud";

export interface ScannerViewProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDocumentsCaptured?: (files: File[]) => void;
}

interface FrontendPerfSample {
  frameIndex: number;
  ipcMs: number;
  frameDecodeMs: number;
  payloadBytes: number;
  effectiveFps: number;
  pollCount: number;
}

interface PreviewCaptureSnapshot {
  frame: ImageData;
  points: Point[] | null;
}

type OptionalDebugFrameSource = FrameSource & {
  onDebugState?: (callback: (payload: unknown) => void) => void;
  onConnectionState?: (callback: (payload: unknown) => void) => void;
  onPerformanceState?: (callback: (payload: unknown) => void) => void;
};

const FRONTEND_PERF_LOG_PATTERN =
  /\[perf:frontend\]\s+frame#(\d+)\s+\|\s+ipc=([\d.]+)ms\s+frame_decode=([\d.]+)ms\s+\|\s+([\d.]+)KB\s+\|\s+effective\s+([\d.]+)\s+fps\s+\((\d+)\s+polls\)/i;
const PREVIEW_CAPTURE_COOLDOWN_MS = 1200;
const RECOVERABLE_SIGNAL_DEDUPE_MS = 2000;
const CV_PROCESS_INTERVAL_MS = 120;
const CV_MAX_WIDTH = 320;
const CV_MAX_HEIGHT = 180;
const AUTO_CAPTURE_STABLE_HOLD_MS = 1200;
const AUTO_CAPTURE_STABLE_FRAMES = 8;
const AUTO_CAPTURE_VARIANCE_THRESHOLD = 8;

const cloneFrame = (frame: ImageData): ImageData => {
  return new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
};

const clonePoints = (points: Point[] | null): Point[] | null => {
  return points?.map((point) => ({ ...point })) ?? null;
};

const imageDataToPngBlob = async (frame: ImageData): Promise<Blob> => {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get temporary canvas context.");
  }

  ctx.putImageData(frame, 0, 0);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Failed to encode the frame as PNG."));
      }
    }, "image/png");
  });
};

const parseFrontendPerfLog = (value: string): FrontendPerfSample | null => {
  const match = FRONTEND_PERF_LOG_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  return {
    frameIndex: Number.parseInt(match[1], 10),
    ipcMs: Number.parseFloat(match[2]),
    frameDecodeMs: Number.parseFloat(match[3]),
    payloadBytes: Math.round(Number.parseFloat(match[4]) * 1024),
    effectiveFps: Number.parseFloat(match[5]),
    pollCount: Number.parseInt(match[6], 10),
  };
};

const toFiniteNumber = (
  record: Record<string, unknown>,
  keys: string[],
): number | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
};

const toStringValue = (
  record: Record<string, unknown>,
  keys: string[],
): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
};

const toReconnectState = (
  value: string | null,
):
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "stopped"
  | "error"
  | null => {
  if (
    value === "idle"
    || value === "connecting"
    || value === "connected"
    || value === "reconnecting"
    || value === "stopped"
    || value === "error"
  ) {
    return value;
  }

  return null;
};

const toNullableMetric = (value: number): number | null => {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
};

const getCvProcessingSize = (
  width: number,
  height: number,
): { width: number; height: number } => {
  const scale = Math.min(1, CV_MAX_WIDTH / Math.max(1, width), CV_MAX_HEIGHT / Math.max(1, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const pointsEqual = (left: Point[] | null, right: Point[] | null): boolean => {
  if (left === right) {
    return true;
  }

  if (!left || !right || left.length !== right.length) {
    return false;
  }

  return left.every((point, index) => (
    point.x === right[index]?.x && point.y === right[index]?.y
  ));
};

/**
 * Live camera scanner dialog component.
 *
 * Uses the live document-camera preview for both CV detection and document
 * post-processing, while surfacing benchmark/debug metrics directly in the UI.
 */
export default function ScannerView({
  isOpen,
  onOpenChange,
  onDocumentsCaptured,
}: ScannerViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameBufferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const latestFrameRef = useRef<ImageData | null>(null);
  const latestFrameVersionRef = useRef(0);
  const renderedFrameVersionRef = useRef(0);
  const previewOrientationRef = useRef<"landscape" | "portrait">("landscape");
  const frameSourceRef = useRef<ReturnType<typeof createFrameSource> | null>(null);
  const frameSourceUnsubscribeRef = useRef<(() => void) | null>(null);
  const frameSourceSessionGenerationRef = useRef(0);
  const cvLoopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cvDetectionInFlightRef = useRef(false);
  const lastCvFrameVersionRef = useRef(0);
  const processingRef = useRef(false);
  const processingCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRecoverableSignalRef = useRef<{ key: string; at: number } | null>(null);
  const lastFatalErrorToastRef = useRef<string | null>(null);
  const dialogOpenRef = useRef(isOpen);
  const unmountedRef = useRef(false);
  const stopScannerRef = useRef<((options?: { skipComponentState?: boolean }) => Promise<void>) | null>(null);
  const latestCvSnapshotRef = useRef<PreviewCaptureSnapshot | null>(null);
  const captureCommitGenerationRef = useRef(0);
  const captureCommitPendingRef = useRef(false);
  const stableSinceRef = useRef<number | null>(null);
  const autoCaptureRef = useRef(true);
  const trackerRef = useRef<StabilityTracker>(
    new StabilityTracker(AUTO_CAPTURE_STABLE_FRAMES, AUTO_CAPTURE_VARIANCE_THRESHOLD),
  );

  const [serverJarPath, setServerJarPath] = useState<string>("");
  const [points, setPoints] = useState<Point[] | null>(null);
  const [isStable, setIsStable] = useState(false);
  const [autoCapture, setAutoCapture] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCaptureCommitPending, setIsCaptureCommitPending] = useState(false);
  const [previewOrientation, setPreviewOrientation] = useState<"landscape" | "portrait">("landscape");
  const { t } = useTranslation("commons", { keyPrefix: "document-scanner" });

  const status = useScannerStore((state) => state.status);
  const errorMessage = useScannerStore((state) => state.errorMessage);
  const capturedDocuments = useScannerStore((state) => state.capturedDocuments);
  const previewWidth = useScannerStore((state) => state.previewDebug.previewWidth);
  const previewHeight = useScannerStore((state) => state.previewDebug.previewHeight);
  const reconnectState = useScannerStore((state) => state.connectionDebug.reconnectState);
  const setStatus = useScannerStore((state) => state.setStatus);
  const setFrameSource = useScannerStore((state) => state.setFrameSource);
  const setConfig = useScannerStore((state) => state.setConfig);
  const addCapturedDocument = useScannerStore((state) => state.addCapturedDocument);
  const removeCapturedDocument = useScannerStore((state) => state.removeCapturedDocument);
  const clearCapturedDocuments = useScannerStore((state) => state.clearCapturedDocuments);
  const setPreviewDebug = useScannerStore((state) => state.setPreviewDebug);
  const setCvDebug = useScannerStore((state) => state.setCvDebug);
  const setConnectionDebug = useScannerStore((state) => state.setConnectionDebug);
  const setCaptureDebug = useScannerStore((state) => state.setCaptureDebug);
  const resetDebugState = useScannerStore((state) => state.resetDebugState);
  const reset = useScannerStore((state) => state.reset);

  const isStreaming = status === "streaming";
  const isConnecting = status === "connecting";
  const previewResolution = useMemo(() => {
    if (!previewWidth || !previewHeight) {
      return "—";
    }

    return `${previewWidth} × ${previewHeight}`;
  }, [previewHeight, previewWidth]);

  const capturedPreviewUrls = useMemo(() => {
    return capturedDocuments.map((file) => URL.createObjectURL(file));
  }, [capturedDocuments]);

  useEffect(() => {
    return () => {
      for (const url of capturedPreviewUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [capturedPreviewUrls]);

  const clearProcessingCooldown = useCallback(() => {
    if (processingCooldownRef.current) {
      clearTimeout(processingCooldownRef.current);
      processingCooldownRef.current = null;
    }
  }, []);

  const clearFrameSourceSubscription = useCallback(() => {
    if (frameSourceUnsubscribeRef.current) {
      frameSourceUnsubscribeRef.current();
      frameSourceUnsubscribeRef.current = null;
    }
  }, []);

  const beginFrameSourceSession = useCallback((): number => {
    frameSourceSessionGenerationRef.current += 1;
    return frameSourceSessionGenerationRef.current;
  }, []);

  const isFrameSourceSessionCurrent = useCallback((
    generation: number,
    source?: FrameSource | null,
  ): boolean => {
    if (generation !== frameSourceSessionGenerationRef.current) {
      return false;
    }

    if (typeof source !== "undefined" && frameSourceRef.current !== source) {
      return false;
    }

    return true;
  }, []);

  const releaseFrameSourceIfCurrent = useCallback((source: FrameSource | null): void => {
    if (!source || frameSourceRef.current !== source) {
      return;
    }

    clearFrameSourceSubscription();
    frameSourceRef.current = null;
    setFrameSource(null);
  }, [clearFrameSourceSubscription, setFrameSource]);

  const clearCvLoop = useCallback(() => {
    if (cvLoopTimeoutRef.current) {
      clearTimeout(cvLoopTimeoutRef.current);
      cvLoopTimeoutRef.current = null;
    }
    cvDetectionInFlightRef.current = false;
  }, []);

  const setProcessingState = useCallback((next: boolean) => {
    processingRef.current = next;
    setIsProcessing(next);
    setCvDebug({
      isProcessing: next,
      updatedAt: Date.now(),
    });
  }, [setCvDebug]);

  const setCaptureCommitPendingState = useCallback((next: boolean) => {
    captureCommitPendingRef.current = next;
    setIsCaptureCommitPending(next);
  }, []);

  const invalidatePendingCaptureCommits = useCallback(() => {
    captureCommitGenerationRef.current += 1;
    setCaptureCommitPendingState(false);
  }, [setCaptureCommitPendingState]);

  const canCommitCaptureResult = useCallback((captureGeneration: number): boolean => {
    return dialogOpenRef.current && captureGeneration === captureCommitGenerationRef.current;
  }, []);

  const schedulePreviewCooldown = useCallback(() => {
    clearProcessingCooldown();
    processingCooldownRef.current = setTimeout(() => {
      setProcessingState(false);
      processingCooldownRef.current = null;
    }, PREVIEW_CAPTURE_COOLDOWN_MS);
  }, [clearProcessingCooldown, setProcessingState]);

  const publishCvDebug = useCallback((
    frame: ImageData | null,
    detectedPoints: Point[] | null,
    stable: boolean,
    pipeline: "idle" | "preview" | "single-hq",
    processing: boolean,
    processingDimensions?: { width: number; height: number },
  ) => {
    setCvDebug({
      pipeline,
      cvReady: isOpenCvReady(),
      documentDetected: Boolean(detectedPoints && detectedPoints.length === 4),
      cornerCount: detectedPoints?.length ?? 0,
      cornerPoints: detectedPoints ?? [],
      isStable: stable,
      processingWidth: processingDimensions?.width ?? frame?.width ?? null,
      processingHeight: processingDimensions?.height ?? frame?.height ?? null,
      autoCaptureEnabled: autoCapture,
      isProcessing: processing,
      updatedAt: Date.now(),
    });
  }, [autoCapture, setCvDebug]);

  const applyPerfSample = useCallback((sample: FrontendPerfSample) => {
    setPreviewDebug({
      frameIndex: sample.frameIndex,
      ipcMs: sample.ipcMs,
      frameDecodeMs: sample.frameDecodeMs,
      payloadBytes: sample.payloadBytes,
      effectiveFps: sample.effectiveFps,
      pollCount: sample.pollCount,
      updatedAt: Date.now(),
    });
  }, [setPreviewDebug]);

  const applyRecoverableScannerSignal = useCallback((message: string, origin: string) => {
    const normalizedMessage = message.trim();
    if (normalizedMessage.length === 0) {
      return;
    }

    const now = Date.now();
    const signature = `${origin}:${normalizedMessage}`;
    const previousSignal = lastRecoverableSignalRef.current;

    if (
      previousSignal
      && previousSignal.key === signature
      && now - previousSignal.at < RECOVERABLE_SIGNAL_DEDUPE_MS
    ) {
      return;
    }

    lastRecoverableSignalRef.current = {
      key: signature,
      at: now,
    };

    setConnectionDebug({
      reconnectState: "reconnecting",
      reconnectMessage: t("connection.recovering"),
      lastErrorReason: normalizedMessage,
      lastDisconnectAt: now,
    });
    setStatus("connecting");
  }, [setConnectionDebug, setStatus, t]);

  const applyFrameSourceState = useCallback((state: FrameSourceState) => {
    const nextReconnectState = (() => {
      switch (state.status) {
        case "starting":
          return "connecting";
        case "streaming":
          return "connected";
        case "reconnecting":
          return "reconnecting";
        case "stopping":
        case "stopped":
          return "stopped";
        case "error":
          return "error";
        default:
          return "idle";
      }
    })();

    const reconnectMessage = (() => {
      switch (state.status) {
        case "starting":
          return t("connection.starting");
        case "streaming":
          return state.reconnectAttempt > 0
            ? t("connection.recovered")
            : t("connection.active");
        case "reconnecting":
          return state.nextReconnectDelayMs !== null
            ? t("connection.recovering-delay", { delayMs: state.nextReconnectDelayMs })
            : t("connection.recovering");
        case "stopping":
        case "stopped":
          return t("connection.stopped");
        case "error":
          return state.lastError ?? t("connection.failed");
        default:
          return t("connection.idle");
      }
    })();

    setPreviewDebug({
      frameIndex: state.metrics.frameIndex,
      previewFps: toNullableMetric(state.metrics.previewFps),
      recentWindowFps: toNullableMetric(state.metrics.recentWindowFps),
      effectiveFps: toNullableMetric(state.metrics.effectiveFps),
      payloadBytes: toNullableMetric(state.metrics.lastPayloadBytes),
      ipcMs: toNullableMetric(state.metrics.lastIpcMs),
      frameDecodeMs: toNullableMetric(state.metrics.lastDecodeMs),
      pollCount: state.metrics.pollCount > 0 ? state.metrics.pollCount : null,
      previewWidth: state.metrics.previewWidth,
      previewHeight: state.metrics.previewHeight,
      updatedAt: Date.now(),
    });

    setConnectionDebug({
      reconnectState: nextReconnectState,
      reconnectAttempt: state.reconnectAttempt > 0 ? state.reconnectAttempt : null,
      reconnectDelayMs: state.nextReconnectDelayMs,
      reconnectMessage,
      lastErrorReason: state.lastError,
      lastDisconnectAt:
        state.status === "reconnecting" || state.status === "error" || state.status === "stopped"
          ? Date.now()
          : null,
    });

    if (state.status === "streaming") {
      lastFatalErrorToastRef.current = null;
      setStatus("streaming");
      return;
    }

    if (state.status === "starting" || state.status === "reconnecting") {
      setStatus("connecting");
      return;
    }

    if (state.status === "error") {
      const fatalMessage = state.lastError ?? state.stopReason ?? t("connection.failed");
      setStatus("error", fatalMessage);
      if (lastFatalErrorToastRef.current !== fatalMessage) {
        lastFatalErrorToastRef.current = fatalMessage;
        toast.error(t("toasts.scanner-error", { message: fatalMessage }));
      }
      return;
    }

    if (state.status === "stopping" || state.status === "stopped") {
      setStatus("idle");
      return;
    }

    setStatus("idle");
  }, [setConnectionDebug, setPreviewDebug, setStatus, t]);

  const applyFutureDebugPayload = useCallback((payload: unknown) => {
    if (typeof payload === "string") {
      const perf = parseFrontendPerfLog(payload);
      if (perf) {
        applyPerfSample(perf);
        return;
      }

      setConnectionDebug({
        reconnectMessage: payload,
      });
      return;
    }

    if (!payload || typeof payload !== "object") {
      return;
    }

    const record = payload as Record<string, unknown>;
    const previewPatch: Parameters<typeof setPreviewDebug>[0] = {};
    const connectionPatch: Parameters<typeof setConnectionDebug>[0] = {};

    const frameIndex = toFiniteNumber(record, ["frameIndex", "frame", "frameCount"]);
    const previewWidth = toFiniteNumber(record, ["previewWidth", "width"]);
    const previewHeight = toFiniteNumber(record, ["previewHeight", "height"]);
    const previewFps = toFiniteNumber(record, ["previewFps", "currentFps"]);
    const recentWindowFps = toFiniteNumber(record, ["recentWindowFps", "windowFps"]);
    const effectiveFps = toFiniteNumber(record, ["effectiveFps"]);
    const ipcMs = toFiniteNumber(record, ["ipcMs", "ipc"]);
    const frameDecodeMs = toFiniteNumber(record, ["frameDecodeMs", "decodeMs"]);
    const payloadBytes = toFiniteNumber(record, ["payloadBytes", "payloadSize"]);
    const payloadKb = toFiniteNumber(record, ["payloadKb"]);
    const pollCount = toFiniteNumber(record, ["pollCount", "polls"]);
    const transport = toStringValue(record, ["transport", "codec", "pipeline"]);

    if (frameIndex !== null) previewPatch.frameIndex = Math.round(frameIndex);
    if (previewWidth !== null) previewPatch.previewWidth = Math.round(previewWidth);
    if (previewHeight !== null) previewPatch.previewHeight = Math.round(previewHeight);
    if (previewFps !== null) previewPatch.previewFps = previewFps;
    if (recentWindowFps !== null) previewPatch.recentWindowFps = recentWindowFps;
    if (effectiveFps !== null) previewPatch.effectiveFps = effectiveFps;
    if (ipcMs !== null) previewPatch.ipcMs = ipcMs;
    if (frameDecodeMs !== null) previewPatch.frameDecodeMs = frameDecodeMs;
    if (payloadBytes !== null) previewPatch.payloadBytes = payloadBytes;
    if (payloadKb !== null) previewPatch.payloadBytes = Math.round(payloadKb * 1024);
    if (pollCount !== null) previewPatch.pollCount = Math.round(pollCount);
    if (transport !== null) previewPatch.transport = transport;

    const reconnectState = toReconnectState(
      toStringValue(record, ["reconnectState", "connectionState", "state"]),
    );
    if (reconnectState !== null) connectionPatch.reconnectState = reconnectState;

    const reconnectAttempt = toFiniteNumber(record, ["reconnectAttempt", "attempt"]);
    const reconnectMaxAttempts = toFiniteNumber(record, [
      "reconnectMaxAttempts",
      "maxAttempts",
    ]);
    const reconnectDelayMs = toFiniteNumber(record, ["reconnectDelayMs", "delayMs"]);
    const reconnectMessage = toStringValue(record, ["message", "reconnectMessage"]);
    const lastErrorReason = toStringValue(record, ["lastErrorReason", "error"]);

    if (reconnectAttempt !== null) {
      connectionPatch.reconnectAttempt = Math.round(reconnectAttempt);
    }
    if (reconnectMaxAttempts !== null) {
      connectionPatch.reconnectMaxAttempts = Math.round(reconnectMaxAttempts);
    }
    if (reconnectDelayMs !== null) connectionPatch.reconnectDelayMs = reconnectDelayMs;
    if (reconnectMessage !== null) connectionPatch.reconnectMessage = reconnectMessage;
    if (lastErrorReason !== null) connectionPatch.lastErrorReason = lastErrorReason;

    if (Object.keys(previewPatch).length > 0) {
      setPreviewDebug({ ...previewPatch, updatedAt: Date.now() });
    }
    if (Object.keys(connectionPatch).length > 0) {
      setConnectionDebug(connectionPatch);
    }
  }, [applyPerfSample, setConnectionDebug, setPreviewDebug]);

  const attachOptionalHooks = useCallback((
    source: FrameSource,
    shouldApplyPayload?: () => boolean,
  ) => {
    const maybeDebugSource = source as OptionalDebugFrameSource;
    const applyGuardedPayload = (payload: unknown): void => {
      if (shouldApplyPayload && !shouldApplyPayload()) {
        return;
      }

      applyFutureDebugPayload(payload);
    };

    maybeDebugSource.onDebugState?.(applyGuardedPayload);
    maybeDebugSource.onConnectionState?.(applyGuardedPayload);
    maybeDebugSource.onPerformanceState?.(applyGuardedPayload);
  }, [applyFutureDebugPayload]);

  const buildDocumentBlob = useCallback(async (
    frame: ImageData,
    documentPoints: Point[] | null,
  ): Promise<Blob> => {
    if (documentPoints && documentPoints.length === 4) {
      const warpedBlob = await applyPerspectiveTransform(frame, documentPoints);
      return await enhanceDocumentImage(warpedBlob);
    }

    return await imageDataToPngBlob(frame);
  }, []);

  const saveCapturedDocument = useCallback((
    blob: Blob,
    frame: ImageData,
    documentDetected: boolean,
  ) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = new File([blob], `scan_preview_${timestamp}.png`, {
      type: "image/png",
    });

    addCapturedDocument(file);
    setCaptureDebug({
      lastCaptureSource: "preview-stream",
      lastCaptureWidth: frame.width,
      lastCaptureHeight: frame.height,
      lastCaptureAt: Date.now(),
      lastCaptureError: null,
      lastCaptureDocumentDetected: documentDetected,
    });
  }, [addCapturedDocument, setCaptureDebug]);

  const createCaptureSnapshot = useCallback((
    frame: ImageData,
    sourcePoints: Point[] | null,
  ): PreviewCaptureSnapshot => {
    return {
      frame: cloneFrame(frame),
      points: clonePoints(sourcePoints),
    };
  }, []);

  const captureFromPreview = useCallback(async (
    snapshot: PreviewCaptureSnapshot,
    trigger: "manual" | "auto",
  ) => {
    if (processingRef.current || !dialogOpenRef.current) {
      return;
    }

    const captureGeneration = captureCommitGenerationRef.current;
    const { frame, points: sourcePoints } = snapshot;

    setProcessingState(true);
    setCaptureCommitPendingState(true);
    publishCvDebug(
      frame,
      sourcePoints,
      Boolean(sourcePoints && sourcePoints.length === 4),
      "preview",
      true,
    );
    toast.info(
      trigger === "auto"
        ? t("toasts.auto-capturing-preview")
        : t("toasts.capturing-preview"),
    );

    try {
      const blob = await buildDocumentBlob(frame, sourcePoints);
      if (!canCommitCaptureResult(captureGeneration)) {
        return;
      }
      saveCapturedDocument(
        blob,
        frame,
        Boolean(sourcePoints && sourcePoints.length === 4),
      );
      toast.success(t("toasts.preview-ready"));
      schedulePreviewCooldown();
    } catch (error) {
      if (!canCommitCaptureResult(captureGeneration)) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Scanner] Preview capture failed:", error);
      setCaptureDebug({ lastCaptureError: message });
      setProcessingState(false);
      toast.error(t("toasts.preview-failed", { message }));
    } finally {
      if (captureGeneration === captureCommitGenerationRef.current) {
        setCaptureCommitPendingState(false);
      }
    }
  }, [
    buildDocumentBlob,
    canCommitCaptureResult,
    publishCvDebug,
    saveCapturedDocument,
    schedulePreviewCooldown,
    setCaptureCommitPendingState,
    setCaptureDebug,
    setProcessingState,
    t,
  ]);

  const startCvLoop = useCallback(() => {
    clearCvLoop();

    const tick = (): void => {
      const frame = latestFrameRef.current;
      if (!frame) {
        cvLoopTimeoutRef.current = setTimeout(tick, CV_PROCESS_INTERVAL_MS);
        return;
      }

      if (processingRef.current) {
        trackerRef.current.reset();
        startTransition(() => {
          setPoints(null);
          setIsStable(false);
        });
        publishCvDebug(frame, null, false, "preview", true);
        cvLoopTimeoutRef.current = setTimeout(tick, CV_PROCESS_INTERVAL_MS);
        return;
      }

      const frameVersion = latestFrameVersionRef.current;
      if (
        !cvDetectionInFlightRef.current
        && frameVersion !== 0
        && frameVersion !== lastCvFrameVersionRef.current
      ) {
        cvDetectionInFlightRef.current = true;

        try {
          const processingSize = getCvProcessingSize(frame.width, frame.height);
          const detectedPoints = detectDocumentContour(frame, {
            maxWidth: processingSize.width,
            maxHeight: processingSize.height,
          });
          const stable = trackerRef.current.push(detectedPoints);
          const now = Date.now();
          if (!stable || !detectedPoints) {
            stableSinceRef.current = null;
          } else {
            if (stableSinceRef.current === null) {
              stableSinceRef.current = now;
            }
          }

          const stableHoldSatisfied = Boolean(
            stable
            && detectedPoints
            && stableSinceRef.current !== null
            && now - stableSinceRef.current >= AUTO_CAPTURE_STABLE_HOLD_MS,
          );

          latestCvSnapshotRef.current = {
            frame,
            points: clonePoints(detectedPoints),
          };

          startTransition(() => {
            setPoints((current) => (pointsEqual(current, detectedPoints) ? current : detectedPoints));
            setIsStable((current) => (current === stable ? current : stable));
          });
          publishCvDebug(frame, detectedPoints, stable, "preview", false, processingSize);

          if (
            autoCaptureRef.current
            && stableHoldSatisfied
            && detectedPoints
          ) {
            void captureFromPreview(
              createCaptureSnapshot(frame, detectedPoints),
              "auto",
            );
          }

          lastCvFrameVersionRef.current = frameVersion;
        } finally {
          cvDetectionInFlightRef.current = false;
        }
      }

      cvLoopTimeoutRef.current = setTimeout(tick, CV_PROCESS_INTERVAL_MS);
    };

    cvLoopTimeoutRef.current = setTimeout(tick, 0);
  }, [captureFromPreview, clearCvLoop, createCaptureSnapshot, publishCvDebug]);

  const renderLoop = useCallback(() => {
    const canvas = canvasRef.current;
    const frame = latestFrameRef.current;

    if (
      canvas
      && frame
      && renderedFrameVersionRef.current !== latestFrameVersionRef.current
    ) {
      renderedFrameVersionRef.current = latestFrameVersionRef.current;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const isPortrait = previewOrientationRef.current === "portrait";
        const targetWidth = isPortrait ? frame.height : frame.width;
        const targetHeight = isPortrait ? frame.width : frame.height;

        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
          canvas.width = targetWidth;
          canvas.height = targetHeight;
        }

        if (!isPortrait) {
          ctx.putImageData(frame, 0, 0);
        } else {
          if (!frameBufferCanvasRef.current) {
            frameBufferCanvasRef.current = document.createElement("canvas");
          }

          const frameBufferCanvas = frameBufferCanvasRef.current;
          if (frameBufferCanvas.width !== frame.width || frameBufferCanvas.height !== frame.height) {
            frameBufferCanvas.width = frame.width;
            frameBufferCanvas.height = frame.height;
          }

          const frameBufferContext = frameBufferCanvas.getContext("2d");
          if (!frameBufferContext) {
            animationFrameRef.current = requestAnimationFrame(renderLoop);
            return;
          }

          frameBufferContext.putImageData(frame, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.save();
          ctx.translate(canvas.width, 0);
          ctx.rotate(Math.PI / 2);
          ctx.drawImage(frameBufferCanvas, 0, 0);
          ctx.restore();
        }
      }
    }

    animationFrameRef.current = requestAnimationFrame(renderLoop);
  }, []);

  const handleStart = useCallback(async () => {
    if (!dialogOpenRef.current || unmountedRef.current) {
      return;
    }

    const serial = getSelectedDesktopAdbSerial();
    if (!serial) {
      toast.error(t("toasts.no-device"));
      return;
    }

    const sessionGeneration = beginFrameSourceSession();
    const isCurrentStartSession = (source?: FrameSource | null): boolean => {
      return isFrameSourceSessionCurrent(sessionGeneration, source);
    };

    let resolvedJarPath = serverJarPath;
    if (!resolvedJarPath) {
      try {
        const { resolveResource } = await import("@tauri-apps/api/path");
        resolvedJarPath = await resolveResource("resources/camera-server.jar");
        if (
          !dialogOpenRef.current
          || !isCurrentStartSession()
        ) {
          return;
        }
        setServerJarPath(resolvedJarPath);
      } catch {
        if (
          dialogOpenRef.current
          && isCurrentStartSession()
        ) {
          toast.error(t("toasts.server-jar-missing"));
        }
        return;
      }
    }

    if (
      !dialogOpenRef.current
      || !isCurrentStartSession()
    ) {
      return;
    }

    const config: ScannerConfig = {
      ...DEFAULT_SCANNER_CONFIG,
      serial,
      serverJarPath: resolvedJarPath,
    };

    invalidatePendingCaptureCommits();
    clearProcessingCooldown();
    clearCvLoop();
    setProcessingState(false);
    setStatus("connecting");
    setConfig(config);
    resetDebugState();
    trackerRef.current.reset();
    latestCvSnapshotRef.current = null;
    stableSinceRef.current = null;
    setPoints(null);
    setIsStable(false);
    latestFrameRef.current = null;
    latestFrameVersionRef.current = 0;
    renderedFrameVersionRef.current = 0;
    lastCvFrameVersionRef.current = 0;

    setPreviewDebug({
      transport: "live-preview",
      previewWidth: config.width,
      previewHeight: config.height,
      updatedAt: Date.now(),
    });
    publishCvDebug(null, null, false, "idle", false);
    setConnectionDebug({
      reconnectState: "connecting",
      reconnectMessage: t("connection.starting"),
      lastErrorReason: null,
      reconnectAttempt: null,
      reconnectMaxAttempts: null,
      reconnectDelayMs: null,
    });
    setCaptureDebug({
      highQualityStatus: "idle",
      highQualitySource: null,
      lastCaptureError: null,
      lastCaptureSource: null,
      lastCaptureAt: null,
      lastCaptureWidth: null,
      lastCaptureHeight: null,
      lastCaptureDocumentDetected: false,
    });

    let source: FrameSource | null = null;

    try {
      source = createFrameSource(config);

      const isCurrentSourceSession = (): boolean => {
        return isCurrentStartSession(source);
      };

      attachOptionalHooks(source, isCurrentSourceSession);
      clearFrameSourceSubscription();
      frameSourceUnsubscribeRef.current = source.onStateChange((state: FrameSourceState) => {
        if (!isCurrentSourceSession()) {
          return;
        }

        applyFrameSourceState(state);
      });

      source.onFrame((frame: ImageData) => {
        if (!isCurrentSourceSession()) {
          return;
        }

        latestFrameRef.current = frame;
        latestFrameVersionRef.current += 1;
      });

      source.onError((error: string) => {
        if (!isCurrentSourceSession()) {
          return;
        }

        console.error("[ScannerView] Frame source error:", error);
        applyRecoverableScannerSignal(error, "source.onError");
      });

      frameSourceRef.current = source;
      setFrameSource(source);

      if (
        !dialogOpenRef.current
        || !isCurrentSourceSession()
      ) {
        releaseFrameSourceIfCurrent(source);
        try {
          await source.stop();
        } catch (error) {
          console.warn("[ScannerView] Failed to stop frame source:", error);
        }
        return;
      }

      await source.start();

      if (
        !dialogOpenRef.current
        || !isCurrentSourceSession()
      ) {
        releaseFrameSourceIfCurrent(source);
        try {
          await source.stop();
        } catch (error) {
          console.warn("[ScannerView] Failed to stop frame source:", error);
        }
        return;
      }

      setStatus("streaming");
      setConnectionDebug({
        reconnectState: "connected",
        reconnectMessage: t("connection.started"),
      });
      animationFrameRef.current = requestAnimationFrame(renderLoop);
      startCvLoop();
    } catch (error) {
      if (!source || !isCurrentStartSession(source)) {
        releaseFrameSourceIfCurrent(source);
        return;
      }

      releaseFrameSourceIfCurrent(source);
      const message = error instanceof Error ? error.message : String(error);
      setStatus("error", message);
      setConnectionDebug({
        reconnectState: "error",
        reconnectMessage: t("connection.start-failed"),
        lastErrorReason: message,
        lastDisconnectAt: Date.now(),
      });
      toast.error(t("toasts.start-failed", { message }));
    }
  }, [
    applyFrameSourceState,
    applyRecoverableScannerSignal,
    attachOptionalHooks,
    beginFrameSourceSession,
    clearFrameSourceSubscription,
    clearProcessingCooldown,
    clearCvLoop,
    isFrameSourceSessionCurrent,
    invalidatePendingCaptureCommits,
    publishCvDebug,
    renderLoop,
    releaseFrameSourceIfCurrent,
    resetDebugState,
    serverJarPath,
    setCaptureDebug,
    setConfig,
    setConnectionDebug,
    setFrameSource,
    setPreviewDebug,
    setProcessingState,
    setStatus,
    startCvLoop,
    t,
  ]);

  const stopScanner = useCallback(async (options?: { skipComponentState?: boolean }) => {
    const skipComponentState = options?.skipComponentState ?? false;

    const sessionGeneration = beginFrameSourceSession();
    const source = frameSourceRef.current;
    let stopErrorMessage: string | null = null;

    invalidatePendingCaptureCommits();
    clearProcessingCooldown();
    clearCvLoop();
    clearFrameSourceSubscription();

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (source) {
      frameSourceRef.current = null;
      setFrameSource(null);
      try {
        await source.stop();
      } catch (error) {
        stopErrorMessage = error instanceof Error ? error.message : String(error);
        console.warn("[ScannerView] Failed to stop frame source:", error);
      }
    }

    if (!isFrameSourceSessionCurrent(sessionGeneration)) {
      return;
    }

    latestFrameRef.current = null;
    latestFrameVersionRef.current = 0;
    renderedFrameVersionRef.current = 0;
    lastCvFrameVersionRef.current = 0;
    trackerRef.current.reset();
    latestCvSnapshotRef.current = null;
    stableSinceRef.current = null;
    processingRef.current = false;

    if (!skipComponentState && !unmountedRef.current) {
      setPoints(null);
      setIsStable(false);
      setIsProcessing(false);
    }

    publishCvDebug(null, null, false, "idle", false);
    setConfig(null);
    if (stopErrorMessage) {
      setConnectionDebug({
        reconnectState: "error",
        reconnectMessage: stopErrorMessage,
        lastErrorReason: stopErrorMessage,
        lastDisconnectAt: Date.now(),
      });
      setStatus("error", stopErrorMessage);
      return;
    }

    setConnectionDebug({
      reconnectState: "stopped",
      reconnectMessage: t("connection.stopped-by-user"),
      lastErrorReason: null,
      lastDisconnectAt: Date.now(),
    });
    setStatus("idle");
  }, [
    beginFrameSourceSession,
    clearCvLoop,
    clearFrameSourceSubscription,
    clearProcessingCooldown,
    invalidatePendingCaptureCommits,
    isFrameSourceSessionCurrent,
    publishCvDebug,
    setConfig,
    setConnectionDebug,
    setFrameSource,
    setStatus,
    t,
  ]);

  // Keep a stable ref so the unmount-only cleanup always calls the latest version.
  stopScannerRef.current = stopScanner;

  const handleStop = useCallback(async () => {
    await stopScanner();
  }, [stopScanner]);

  const handlePreviewCapture = useCallback(() => {
    const cvSnapshot = latestCvSnapshotRef.current;
    if (cvSnapshot) {
      void captureFromPreview(createCaptureSnapshot(
        cvSnapshot.frame,
        cvSnapshot.points,
      ), "manual");
      return;
    }

    const frame = latestFrameRef.current;
    if (!frame) {
      return;
    }

    void captureFromPreview(createCaptureSnapshot(frame, null), "manual");
  }, [captureFromPreview, createCaptureSnapshot]);

  const handleRemoveCapturedDocument = useCallback((index: number) => {
    removeCapturedDocument(index);
  }, [removeCapturedDocument]);

  const handlePreviewOrientationToggle = useCallback(() => {
    setPreviewOrientation((current) => (current === "landscape" ? "portrait" : "landscape"));
  }, []);

  const handleSendToAI = useCallback(() => {
    if (capturedDocuments.length === 0) {
      toast.error(t("toasts.no-documents"));
      return;
    }
    if (captureCommitPendingRef.current) {
      return;
    }

    invalidatePendingCaptureCommits();
    clearProcessingCooldown();
    setProcessingState(false);
    onDocumentsCaptured?.(capturedDocuments);
    clearCapturedDocuments();
    onOpenChange(false);
  }, [
    capturedDocuments,
    clearCapturedDocuments,
    clearProcessingCooldown,
    invalidatePendingCaptureCommits,
    onDocumentsCaptured,
    onOpenChange,
    setProcessingState,
    t,
  ]);

  useEffect(() => {
    previewOrientationRef.current = previewOrientation;
    renderedFrameVersionRef.current = 0;
  }, [previewOrientation]);

  useEffect(() => {
    autoCaptureRef.current = autoCapture;
    setCvDebug({
      autoCaptureEnabled: autoCapture,
      isProcessing,
      updatedAt: Date.now(),
    });
  }, [autoCapture, isProcessing, setCvDebug]);

  useEffect(() => {
    dialogOpenRef.current = isOpen;
    if (!isOpen) {
      invalidatePendingCaptureCommits();
      latestCvSnapshotRef.current = null;
      void handleStop();
      reset();
    }
  }, [handleStop, invalidatePendingCaptureCommits, isOpen, reset]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousConsoleLog = console.log;
    const interceptedConsoleLog: typeof console.log = (...args) => {
      previousConsoleLog(...args);

      for (const arg of args) {
        if (typeof arg !== "string") {
          continue;
        }

        const perf = parseFrontendPerfLog(arg);
        if (perf) {
          applyPerfSample(perf);
        }
      }
    };

    console.log = interceptedConsoleLog;

    return () => {
      if (console.log === interceptedConsoleLog) {
        console.log = previousConsoleLog;
      }
    };
  }, [applyPerfSample, isOpen]);

  useEffect(() => {
    // Strict Mode mounts effects twice in development, so reset the ref here
    // after the previous cleanup marks the component as unmounted.
    unmountedRef.current = false;

    return () => {
      unmountedRef.current = true;
      dialogOpenRef.current = false;
      // Reuse the full stop path so transport teardown also cancels RAF and stops the source.
      void stopScannerRef.current?.({ skipComponentState: true });
    };
  }, []);

  const isPortraitSplitLayout = previewOrientation === "portrait";
  const dialogSectionPaddingClass = "px-4 sm:px-5 lg:px-6";
  const dialogWidthClass = isPortraitSplitLayout
    ? "sm:!w-[min(100vw-2rem,1540px)] sm:!max-w-[min(100vw-2rem,1540px)]"
    : "sm:!w-[min(100vw-2rem,1360px)] sm:!max-w-[min(100vw-2rem,1360px)]";
  const scannerContentWidthClass = isPortraitSplitLayout
    ? "mx-auto w-full max-w-[1440px] space-y-4"
    : "mx-auto w-full max-w-[1200px] space-y-4";
  const previewColumnWidthClass = isPortraitSplitLayout
    ? "xl:max-w-[384px] 2xl:max-w-[400px]"
    : "xl:max-w-[680px]";
  const scannerGridClass = isPortraitSplitLayout
    ? "xl:mx-auto xl:w-fit xl:max-w-full xl:grid-cols-[minmax(0,384px)_minmax(320px,360px)_minmax(320px,400px)] 2xl:grid-cols-[minmax(0,400px)_minmax(340px,380px)_minmax(340px,420px)]"
    : "xl:w-full xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] 2xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,420px)]";

  const previewSurface = (
    <div
      className={cn(
        "relative w-full self-center overflow-hidden rounded-xl border bg-black shadow-inner",
        previewOrientation === "portrait"
          ? "aspect-[3/4] max-w-[336px] sm:max-w-[360px] xl:max-w-none"
          : "aspect-video max-w-[560px] sm:max-w-[600px] xl:max-w-none",
      )}
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full object-contain"
      />

      {isStreaming ? <ScannerPreviewHud /> : null}

      {isStreaming && !isProcessing ? (
        <ScannerOverlay
          points={points}
          isStable={isStable}
          frameWidth={latestFrameRef.current?.width ?? 0}
          frameHeight={latestFrameRef.current?.height ?? 0}
          orientation={previewOrientation}
        />
      ) : null}

      {isProcessing ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-white" />
          <p className="mt-4 font-medium text-white shadow-sm">
            {t("overlay.processing")}
          </p>
        </div>
      ) : null}

      {!isStreaming ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70">
          {isConnecting ? (
            <>
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              <p className="text-sm text-white/80">
                {t("overlay.connecting")}
              </p>
            </>
          ) : null}
          {!isConnecting && status === "idle" ? (
            <p className="text-sm text-white/80">
              {t("overlay.idle")}
            </p>
          ) : null}
          {status === "error" ? (
            <div className="text-center">
              <p className="text-sm font-medium text-red-400">{t("overlay.error-title")}</p>
              <p className="mt-1 max-w-sm text-xs text-white/50">
                {errorMessage}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const controlsPanel = (
    <ScannerControls
      isConnecting={isConnecting}
      isStreaming={isStreaming}
      isProcessing={isProcessing}
      autoCapture={autoCapture}
      isStable={isStable}
      previewOrientation={previewOrientation}
      previewResolution={previewResolution}
      reconnectState={reconnectState}
      onAutoCaptureChange={setAutoCapture}
      onPreviewOrientationToggle={handlePreviewOrientationToggle}
      onStart={handleStart}
      onStop={handleStop}
      onPreviewCapture={handlePreviewCapture}
    />
  );

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {isOpen ? <OpenCVLoader /> : null}
      <DialogContent
        size="scanner"
        className={cn("!flex h-[min(94vh,1040px)] flex-col overflow-hidden p-0", dialogWidthClass)}
      >
        <DialogHeader className={cn("shrink-0 border-b pb-3 pt-4", dialogSectionPaddingClass)}>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            {t("title")}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          <div className={cn(scannerContentWidthClass, dialogSectionPaddingClass)}>
            <div className={cn("grid min-w-0 gap-4 xl:min-h-full xl:items-start xl:overflow-hidden", scannerGridClass)}>
              {isPortraitSplitLayout ? (
                <>
                  <div className="flex min-w-0 flex-col gap-4 xl:min-h-0">
                    <div className={cn("flex w-full flex-col xl:self-start", previewColumnWidthClass)}>
                      {previewSurface}
                    </div>
                  </div>

                  <div className="flex min-w-0 w-full flex-col gap-4 xl:min-h-0 xl:self-start">
                    {controlsPanel}
                    <ScannerCvDebugCard />
                  </div>

                  <div className="flex min-w-0 w-full flex-col gap-4 xl:min-h-0 xl:self-start">
                    <ScannerPreviewDebugCard />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex min-w-0 flex-col gap-4 xl:min-h-0">
                    <div className={cn("flex w-full flex-col gap-4 xl:self-start", previewColumnWidthClass)}>
                      {previewSurface}
                      {controlsPanel}
                    </div>
                  </div>

                  <div className="min-w-0 xl:min-h-0 xl:self-start xl:overflow-y-auto">
                    <div className="flex min-w-0 w-full flex-col">
                      <ScannerDebugPanel />
                    </div>
                  </div>
                </>
              )}
            </div>

            {capturedDocuments.length > 0 ? (
              <div className="space-y-4 rounded-xl border bg-muted/40 px-4 py-4 sm:px-5 lg:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{t("captured.title")}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("captured.description")}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("captured.item-count", { count: capturedDocuments.length })}
                  </p>
                </div>

                <div className="flex gap-3 overflow-x-auto pb-1 sm:gap-4">
                  {capturedDocuments.map((doc, index) => (
                    <div
                      key={`${doc.name}-${index}`}
                      className="group relative shrink-0"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={capturedPreviewUrls[index]}
                        alt={t("captured.preview-alt", { index: index + 1 })}
                        className="h-28 w-24 rounded border bg-background object-cover shadow-sm transition-transform group-hover:scale-105"
                      />
                      <button
                        className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100"
                        onClick={() => handleRemoveCapturedDocument(index)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className={cn("mt-0 shrink-0 border-t py-4 sm:justify-end", dialogSectionPaddingClass)}>
          <Button
            variant="default"
            onClick={handleSendToAI}
            disabled={capturedDocuments.length === 0 || isCaptureCommitPending}
            className={cn(
              "min-w-32 w-full sm:w-auto",
              (capturedDocuments.length === 0 || isCaptureCommitPending) && "opacity-50 grayscale",
            )}
          >
            {t("actions.send-to-ai", { count: capturedDocuments.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
