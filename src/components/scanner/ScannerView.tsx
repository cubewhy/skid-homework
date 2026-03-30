"use client";

import {startTransition, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Camera, X} from "lucide-react";
import {useTranslation} from "react-i18next";
import {toast} from "sonner";

import {Button} from "@/components/ui/button";
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,} from "@/components/ui/dialog";
import {
  applyPerspectiveTransformToImageData,
  applyPerspectiveTransformToMat,
  createFrameSource,
  DEFAULT_SCANNER_CONFIG,
  detectDocumentContour,
  enhanceDocumentImageData,
  enhanceDocumentRgbaMatToImageData,
  evaluateFrameMappingCompatibility,
  type FrameSource,
  type FrameSourceState,
  type Point,
  scalePointsBetweenFrames,
  type ScannerConfig,
  type ScannerStillCapture,
  StabilityTracker,
} from "@/lib/scanner";
import {createScannerCvWorkerClient, type ScannerCvWorkerClient} from "@/lib/scanner/cv-worker-client";
import {
  decodeBlobToImageData,
  encodeImageDataToPngBlob,
  type OrthogonalRotation,
  rotateImageData,
} from "@/lib/scanner/image-data";
import {isOpenCvReady} from "@/lib/scanner/opencv-runtime";
import {orientPointsForPreview} from "@/lib/scanner/preview-orientation";
import {shellTauriAdbCommand} from "@/lib/tauri/adb";
import {getSelectedDesktopAdbSerial} from "@/lib/webadb/screenshot";
import {useBlobDataUrl} from "@/hooks/use-blob-data-url";
import {useSettingsStore} from "@/store/settings-store";
import {type ScannerCapturedDocument, useScannerStore} from "@/store/scanner-store";
import {cn} from "@/lib/utils";

import OpenCVLoader from "../OpenCVLoader";
import {ScannerCapturedDocumentEditor} from "./ScannerCapturedDocumentEditor";
import {ScannerControls} from "./ScannerControls";
import {
  ScannerCaptureDebugCard,
  ScannerCvDebugCard,
  ScannerDebugPanel,
  ScannerPreviewDebugCard,
} from "./ScannerDebugPanel";
import {ScannerOverlay} from "./ScannerOverlay";
import {ScannerPreviewHud} from "./ScannerPreviewHud";

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

interface PreparedCaptureArtifact {
  sourceBlob: Blob;
  frame: ImageData;
  points: Point[] | null;
  outputRotation: OrthogonalRotation;
  source?: string;
}

interface ProcessedDocumentRenderResult {
  blob: Blob;
  outputWidth: number;
  outputHeight: number;
  perspectiveMs: number | null;
  enhanceMs: number | null;
  rotateMs: number | null;
  encodeMs: number;
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
const CAPTURE_CV_MAX_WIDTH = 1024;
const CAPTURE_CV_MAX_HEIGHT = 1024;
const AUTO_CAPTURE_STABLE_HOLD_MS = 1200;
const AUTO_CAPTURE_STABLE_FRAMES = 8;
const AUTO_CAPTURE_VARIANCE_THRESHOLD = 8;
const STILL_CAPTURE_ROTATION_CANDIDATES: readonly OrthogonalRotation[] = [0, 90, 270, 180] as const;

const cloneFrame = (frame: ImageData): ImageData => {
  return new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
};

const clonePoints = (points: Point[] | null): Point[] | null => {
  return points?.map((point) => ({ ...point })) ?? null;
};

const describeHexWindow = (bytes: Uint8Array, count: number, fromEnd: boolean = false): string => {
  if (bytes.byteLength === 0) {
    return "∅";
  }

  const safeCount = Math.max(1, Math.min(count, bytes.byteLength));
  const slice = fromEnd
    ? bytes.slice(bytes.byteLength - safeCount)
    : bytes.slice(0, safeCount);
  return [...slice].map((value) => value.toString(16).padStart(2, "0")).join(" ");
};

const findJpegMarkerOffset = (
  bytes: Uint8Array,
  markerHigh: number,
  markerLow: number,
  fromEnd: boolean = false,
): number | null => {
  if (fromEnd) {
    for (let index = bytes.byteLength - 2; index >= 0; index -= 1) {
      if (bytes[index] === markerHigh && bytes[index + 1] === markerLow) {
        return index;
      }
    }
    return null;
  }

  for (let index = 0; index < bytes.byteLength - 1; index += 1) {
    if (bytes[index] === markerHigh && bytes[index + 1] === markerLow) {
      return index;
    }
  }

  return null;
};

const describeBlobDiagnostics = async (blob: Blob): Promise<Record<string, unknown>> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    mimeType: blob.type,
    byteLength: bytes.byteLength,
    headHex: describeHexWindow(bytes, 16),
    tailHex: describeHexWindow(bytes, 16, true),
    startsWithJpegSoi:
      bytes.byteLength >= 2
        ? bytes[0] === 0xff && bytes[1] === 0xd8
        : false,
    firstSoiOffset: findJpegMarkerOffset(bytes, 0xff, 0xd8),
    lastEoiOffset: findJpegMarkerOffset(bytes, 0xff, 0xd9, true),
  };
};

const formatDiagnostics = (payload: Record<string, unknown>): string => {
  return JSON.stringify(payload);
};

const imageDataToPngBlob = async (frame: ImageData): Promise<Blob> => {
  return await encodeImageDataToPngBlob(frame);
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

const getCapturedDocumentProcessingSize = (
  width: number,
  height: number,
): { width: number; height: number } => {
  const scale = Math.min(
    1,
    CAPTURE_CV_MAX_WIDTH / Math.max(1, width),
    CAPTURE_CV_MAX_HEIGHT / Math.max(1, height),
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const getRotatedFrameDimensions = (
  width: number,
  height: number,
  rotation: OrthogonalRotation,
): { width: number; height: number } => {
  if (rotation === 90 || rotation === 270) {
    return {
      width: height,
      height: width,
    };
  }

  return { width, height };
};

const resolveStillFrameRotation = (
  previewDimensions: { width: number; height: number },
  stillDimensions: { width: number; height: number },
): {
  rotation: OrthogonalRotation;
  width: number;
  height: number;
  aspectDelta: number;
} => {
  let selectedRotation: OrthogonalRotation | null = null;
  let selectedDimensions: { width: number; height: number } | null = null;
  let selectedAspectDelta = Number.POSITIVE_INFINITY;
  let lastCompatibilityReason: string | null = null;

  for (const rotation of STILL_CAPTURE_ROTATION_CANDIDATES) {
    const candidateDimensions = getRotatedFrameDimensions(
      stillDimensions.width,
      stillDimensions.height,
      rotation,
    );
    const compatibility = evaluateFrameMappingCompatibility(
      previewDimensions,
      candidateDimensions,
    );

    if (!compatibility.compatible) {
      lastCompatibilityReason = compatibility.reason;
      continue;
    }

    if (selectedRotation === null || compatibility.aspectDelta < selectedAspectDelta) {
      selectedRotation = rotation;
      selectedDimensions = candidateDimensions;
      selectedAspectDelta = compatibility.aspectDelta;
    }
  }

  if (selectedRotation === null || !selectedDimensions) {
    throw new Error(
      lastCompatibilityReason
        ?? `Preview/still mapping is incompatible (${previewDimensions.width}x${previewDimensions.height} -> ${stillDimensions.width}x${stillDimensions.height}).`,
    );
  }

  return {
    rotation: selectedRotation,
    width: selectedDimensions.width,
    height: selectedDimensions.height,
    aspectDelta: selectedAspectDelta,
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

const formatPerfMetric = (value: number | null): string => {
  return value === null ? "—" : value.toFixed(1);
};

interface ScannerCapturedDocumentThumbnailProps {
  document: ScannerCapturedDocument;
  index: number;
  onEdit: (documentId: string) => void;
  onRemove: (documentId: string) => void;
  previewAlt: string;
  statusLabel: string;
}

function ScannerCapturedDocumentThumbnail({
  document,
  index,
  onEdit,
  onRemove,
  previewAlt,
  statusLabel,
}: ScannerCapturedDocumentThumbnailProps) {
  const previewUrl = useBlobDataUrl(document.file);

  return (
    <div
      key={document.id}
      className="group relative shrink-0"
    >
      <button
        type="button"
        onClick={() => onEdit(document.id)}
        className={cn(
          "relative block overflow-hidden rounded border bg-background shadow-sm transition-transform",
          document.status === "processing"
            ? "cursor-wait"
            : "group-hover:scale-[1.02]",
        )}
        disabled={document.status === "processing"}
      >
        {previewUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt={previewAlt}
              className="h-28 w-24 object-cover"
            />
          </>
        ) : (
          <div className="h-28 w-24 bg-muted/40" />
        )}
        <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-left text-[10px] font-medium text-white">
          {statusLabel}
        </div>
        {document.status === "processing" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/35">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          </div>
        ) : null}
      </button>
      <button
        type="button"
        className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100"
        onClick={() => onRemove(document.id)}
        aria-label={`Remove captured document ${index + 1}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/**
 * Live camera scanner dialog component.
 *
 * Uses the live document-camera preview for CV detection while preferring a
 * high-quality still capture for final document export whenever possible.
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
  const cvWorkerRef = useRef<ScannerCvWorkerClient | null>(null);
  const cvWorkerReadyRef = useRef(false);
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
  const capturedDocumentProcessVersionsRef = useRef<Map<string, number>>(new Map());
  const capturedDocumentQueueGenerationRef = useRef(0);
  const capturedDocumentQueueRef = useRef<Promise<void>>(Promise.resolve());
  const trackerRef = useRef<StabilityTracker>(
    new StabilityTracker(AUTO_CAPTURE_STABLE_FRAMES, AUTO_CAPTURE_VARIANCE_THRESHOLD),
  );

  const [serverJarPath, setServerJarPath] = useState<string>("");
  const [points, setPoints] = useState<Point[] | null>(null);
  const [isStable, setIsStable] = useState(false);
  const [autoCapture, setAutoCapture] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCaptureCommitPending, setIsCaptureCommitPending] = useState(false);
  const [editingCapturedDocumentId, setEditingCapturedDocumentId] = useState<string | null>(null);
  const [previewOrientation, setPreviewOrientation] = useState<"landscape" | "portrait">("landscape");
  const { t } = useTranslation("commons", { keyPrefix: "document-scanner" });
  const imageEnhancement = useSettingsStore((state) => state.imageEnhancement);

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
  const updateCapturedDocument = useScannerStore((state) => state.updateCapturedDocument);
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
  const editingCapturedDocument = useMemo(() => {
    if (!editingCapturedDocumentId) {
      return null;
    }

    return capturedDocuments.find((document) => document.id === editingCapturedDocumentId) ?? null;
  }, [capturedDocuments, editingCapturedDocumentId]);

  useEffect(() => {
    if (
      editingCapturedDocumentId
      && !capturedDocuments.some((document) => document.id === editingCapturedDocumentId)
    ) {
      setEditingCapturedDocumentId(null);
    }
  }, [capturedDocuments, editingCapturedDocumentId]);

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

  const terminateCvWorker = useCallback(() => {
    cvWorkerReadyRef.current = false;
    const worker = cvWorkerRef.current;
    cvWorkerRef.current = null;
    worker?.terminate();
  }, []);

  const ensureCvWorker = useCallback(async (): Promise<ScannerCvWorkerClient | null> => {
    let worker = cvWorkerRef.current;
    if (!worker) {
      worker = createScannerCvWorkerClient();
      cvWorkerRef.current = worker;
    }

    const ready = await worker.ensureReady();
    cvWorkerReadyRef.current = ready;
    if (ready) {
      return worker;
    }

    terminateCvWorker();
    return null;
  }, [terminateCvWorker]);

  const isCvRuntimeReady = useCallback((): boolean => {
    return isOpenCvReady() || cvWorkerReadyRef.current;
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
      cvReady: isCvRuntimeReady(),
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
  }, [autoCapture, isCvRuntimeReady, setCvDebug]);

  const detectDocumentContourWithFallback = useCallback(async (
    frame: ImageData,
    frameVersion: number,
    processingSize: { width: number; height: number },
  ): Promise<Point[] | null> => {
    const worker = cvWorkerRef.current;
    if (worker?.isReady()) {
      try {
        const result = await worker.detect(frame, {
          frameVersion,
          maxWidth: processingSize.width,
          maxHeight: processingSize.height,
        });
        cvWorkerReadyRef.current = true;
        return result.points;
      } catch (error) {
        console.warn("[Scanner] CV worker detection failed, falling back to main thread:", error);
        terminateCvWorker();
      }
    }

    return detectDocumentContour(frame, {
      maxWidth: processingSize.width,
      maxHeight: processingSize.height,
    });
  }, [terminateCvWorker]);

  const applyPerfSample = useCallback((sample: FrontendPerfSample) => {
    setPreviewDebug({
      frameIndex: sample.frameIndex,
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
      pollWaitMs: toNullableMetric(state.metrics.lastIpcMs),
      jsDecodeMs: toNullableMetric(state.metrics.lastDecodeMs),
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
    // const ipcMs = toFiniteNumber(record, ["ipcMs", "ipc"]);
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
    // if (ipcMs !== null) previewPatch.ipcMs = ipcMs;
    if (frameDecodeMs !== null) previewPatch.jsDecodeMs = frameDecodeMs;
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

  const buildDocumentSourceArtifact = useCallback(async (
    frame: ImageData,
    documentPoints: Point[] | null,
  ): Promise<PreparedCaptureArtifact> => {
    const exportOrientation = previewOrientationRef.current;
    const exportFrame = exportOrientation === "portrait"
      ? rotateImageData(frame, 90)
      : frame;
    const exportPoints = documentPoints && documentPoints.length === 4
      ? (
          exportOrientation === "portrait"
            ? orientPointsForPreview(documentPoints, frame.width, frame.height, "portrait")
            : documentPoints
        )
      : null;

    return {
      sourceBlob: await imageDataToPngBlob(exportFrame),
      frame: exportFrame,
      points: exportPoints,
      outputRotation: 0,
    };
  }, []);

  const renderProcessedDocumentBlob = useCallback(async (
    frame: ImageData,
    documentPoints: Point[] | null,
    outputRotation: OrthogonalRotation = 0,
  ): Promise<ProcessedDocumentRenderResult> => {
    let baseImage = frame;
    let perspectiveMs: number | null = null;
    let enhanceMs: number | null = null;
    let rotateMs: number | null = null;

    const finalizeOutputBlob = async (resultImage: ImageData): Promise<ProcessedDocumentRenderResult> => {
      const outputImage = outputRotation === 0
        ? resultImage
        : (() => {
            const rotateStartedAt = performance.now();
            const rotatedImage = rotateImageData(resultImage, outputRotation);
            rotateMs = performance.now() - rotateStartedAt;
            return rotatedImage;
          })();
      const encodeStartedAt = performance.now();
      const blob = await imageDataToPngBlob(outputImage);
      return {
        blob,
        outputWidth: outputImage.width,
        outputHeight: outputImage.height,
        perspectiveMs,
        enhanceMs,
        rotateMs,
        encodeMs: performance.now() - encodeStartedAt,
      };
    };

    if (imageEnhancement && documentPoints && documentPoints.length === 4) {
      const perspectiveStartedAt = performance.now();
      const croppedMat = applyPerspectiveTransformToMat(frame, documentPoints);
      perspectiveMs = performance.now() - perspectiveStartedAt;

      try {
        const enhanceStartedAt = performance.now();
        const enhancedImage = await enhanceDocumentRgbaMatToImageData(croppedMat);
        enhanceMs = performance.now() - enhanceStartedAt;
        return await finalizeOutputBlob(enhancedImage);
      } finally {
        croppedMat.delete();
      }
    }

    if (documentPoints && documentPoints.length === 4) {
      const perspectiveStartedAt = performance.now();
      baseImage = applyPerspectiveTransformToImageData(frame, documentPoints);
      perspectiveMs = performance.now() - perspectiveStartedAt;
    }

    if (!imageEnhancement) {
      return await finalizeOutputBlob(baseImage);
    }

    const enhanceStartedAt = performance.now();
    const enhancedImage = await enhanceDocumentImageData(baseImage);
    enhanceMs = performance.now() - enhanceStartedAt;
    return await finalizeOutputBlob(enhancedImage);
  }, [imageEnhancement]);

  const logHighQualityStillFailureDiagnostics = useCallback(async (
    stillCapture: ScannerStillCapture,
    error: unknown,
  ): Promise<void> => {
    try {
      const blobDiagnostics = await describeBlobDiagnostics(stillCapture.file);
      console.warn(
        `[Scanner][StillDiag] High-quality still decode failed. ${formatDiagnostics({
          error: error instanceof Error ? error.message : String(error),
          serial: stillCapture.serial,
          source: stillCapture.source,
          transport: stillCapture.transport,
          capturedAt: stillCapture.capturedAt,
          previewWidth: stillCapture.previewWidth,
          previewHeight: stillCapture.previewHeight,
          stillWidth: stillCapture.width,
          stillHeight: stillCapture.height,
          blob: blobDiagnostics,
        })}`,
      );
    } catch (diagnosticError) {
      console.warn("[Scanner][StillDiag] Failed to summarize high-quality still blob.", diagnosticError);
    }

    try {
      const serverLogTail = await shellTauriAdbCommand(
        stillCapture.serial,
        "tail -n 80 /data/local/tmp/skid-scanner-server.log",
      );
      if (serverLogTail.trim().length > 0) {
        console.warn(`[Scanner][StillDiag] Device scanner server log tail:\n${serverLogTail}`);
      } else {
        console.warn("[Scanner][StillDiag] Device scanner server log tail was empty.");
      }
    } catch (serverLogError) {
      console.warn("[Scanner][StillDiag] Failed to read device scanner server log tail.", serverLogError);
    }
  }, []);

  const buildHighQualityCaptureArtifact = useCallback(async (
    source: FrameSource,
    snapshot: PreviewCaptureSnapshot,
  ): Promise<PreparedCaptureArtifact> => {
    const totalStartedAt = performance.now();
    const stillCaptureStartedAt = performance.now();
    const stillCapture = await source.captureStillFrame();
    const stillCaptureMs = performance.now() - stillCaptureStartedAt;
    let decodedStillFrame: ImageData;
    let decodeMs: number | null = null;
    try {
      const decodeStartedAt = performance.now();
      decodedStillFrame = await decodeBlobToImageData(stillCapture.file);
      decodeMs = performance.now() - decodeStartedAt;
    } catch (error) {
      await logHighQualityStillFailureDiagnostics(stillCapture, error);
      const fallbackReason = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to decode high-quality still payload: ${fallbackReason}`);
    }
    const previewDimensions = {
      width: snapshot.frame.width,
      height: snapshot.frame.height,
    };
    const orientationStartedAt = performance.now();
    const selectedRotation = resolveStillFrameRotation(previewDimensions, {
      width: decodedStillFrame.width,
      height: decodedStillFrame.height,
    });
    const selectedStillFrame = selectedRotation.rotation === 0
      ? decodedStillFrame
      : rotateImageData(decodedStillFrame, selectedRotation.rotation);
    const orientationMs = performance.now() - orientationStartedAt;

    const mappedPoints = snapshot.points && snapshot.points.length === 4
      ? scalePointsBetweenFrames(snapshot.points, previewDimensions, {
          width: selectedRotation.width,
          height: selectedRotation.height,
        })
      : null;
    // Keep the HQ still in source space and defer preview-orientation rotation to async post-process.
    const outputRotation: OrthogonalRotation = previewOrientationRef.current === "portrait" ? 90 : 0;
    let sourceBlob: Blob = stillCapture.file;
    let sourceBlobMode = "original";
    let sourceEncodeMs: number | null = null;

    if (selectedStillFrame !== decodedStillFrame) {
      const sourceEncodeStartedAt = performance.now();
      sourceBlob = await imageDataToPngBlob(selectedStillFrame);
      sourceEncodeMs = performance.now() - sourceEncodeStartedAt;
      sourceBlobMode = "rotated-png";
    } else if (outputRotation !== 0) {
      sourceBlobMode = "original-deferred-rotation";
    }

    const totalMs = performance.now() - totalStartedAt;
    console.info(
      `[perf:still-prepare] ${stillCapture.transport} | total=${totalMs.toFixed(1)}ms`
      + ` capture=${stillCaptureMs.toFixed(1)}ms`
      + ` decode=${formatPerfMetric(decodeMs)}ms`
      + ` orient=${orientationMs.toFixed(1)}ms`
      + ` sourceEncode=${formatPerfMetric(sourceEncodeMs)}ms`
      + ` rotation=${selectedRotation.rotation}`
      + ` outputRotation=${outputRotation}`
      + ` aspectDelta=${selectedRotation.aspectDelta.toFixed(4)}`
      + ` sourceBlob=${sourceBlobMode}`
      + ` | preview=${previewDimensions.width}x${previewDimensions.height}`
      + ` still=${decodedStillFrame.width}x${decodedStillFrame.height}`
      + ` mapped=${selectedRotation.width}x${selectedRotation.height}`,
    );

    return {
      sourceBlob,
      frame: selectedStillFrame,
      points: mappedPoints,
      outputRotation,
      source: stillCapture.source,
    };
  }, [logHighQualityStillFailureDiagnostics]);

  const buildCaptureFile = useCallback((blob: Blob, outputNameBase: string): File => {
    const fileExtension = blob.type === "image/jpeg" ? "jpg" : "png";
    const fileType = blob.type || (fileExtension === "jpg" ? "image/jpeg" : "image/png");

    return new File([blob], `${outputNameBase}.${fileExtension}`, {
      type: fileType,
    });
  }, []);

  const invalidateCapturedDocumentQueue = useCallback(() => {
    capturedDocumentQueueGenerationRef.current += 1;
    capturedDocumentProcessVersionsRef.current.clear();
    capturedDocumentQueueRef.current = Promise.resolve();
    setEditingCapturedDocumentId(null);
  }, []);

  const queueCapturedDocumentProcessing = useCallback((
    documentId: string,
    sourceFile: File,
    outputNameBase: string,
    documentPoints: Point[] | null,
    outputRotation: OrthogonalRotation,
    initialFrame?: ImageData,
    options?: {
      redetectPoints?: boolean;
    },
  ): void => {
    const queueGeneration = capturedDocumentQueueGenerationRef.current;
    const nextVersion = (capturedDocumentProcessVersionsRef.current.get(documentId) ?? 0) + 1;
    capturedDocumentProcessVersionsRef.current.set(documentId, nextVersion);

    updateCapturedDocument(documentId, {
      status: "processing",
      error: null,
      points: clonePoints(documentPoints),
    });
    setCaptureDebug({
      postProcessStatus: "processing",
      postProcessError: null,
      postProcessDecodeMs: null,
      postProcessRedetectMs: null,
      postProcessPerspectiveMs: null,
      postProcessEnhanceMs: null,
      postProcessEncodeMs: null,
      postProcessTotalMs: null,
      postProcessUsedRedetect: Boolean(options?.redetectPoints),
      postProcessUsedPerspective: Boolean(documentPoints && documentPoints.length === 4),
      postProcessUsedEnhancement: imageEnhancement,
      postProcessInputWidth: initialFrame?.width ?? null,
      postProcessInputHeight: initialFrame?.height ?? null,
      postProcessOutputWidth: null,
      postProcessOutputHeight: null,
      postProcessUpdatedAt: Date.now(),
    });

    const runProcessing = async (): Promise<void> => {
      const totalStartedAt = performance.now();
      let decodeMs: number | null = null;
      const processingFrame = initialFrame ?? await (async () => {
        const decodeStartedAt = performance.now();
        const decodedFrame = await decodeBlobToImageData(sourceFile);
        decodeMs = performance.now() - decodeStartedAt;
        return decodedFrame;
      })();
      let resolvedPoints = clonePoints(documentPoints);
      let redetectMs: number | null = null;

      if (options?.redetectPoints) {
        try {
          const processingSize = getCapturedDocumentProcessingSize(
            processingFrame.width,
            processingFrame.height,
          );
          const redetectStartedAt = performance.now();
          const detectedPoints = await detectDocumentContourWithFallback(
            processingFrame,
            nextVersion,
            processingSize,
          );
          redetectMs = performance.now() - redetectStartedAt;
          if (detectedPoints && detectedPoints.length === 4) {
            resolvedPoints = detectedPoints;
          }
        } catch (error) {
          console.warn("[Scanner] Failed to redetect captured document corners:", error);
        }
      }

      const processedDocument = await renderProcessedDocumentBlob(
        processingFrame,
        resolvedPoints,
        outputRotation,
      );
      const processedFile = buildCaptureFile(processedDocument.blob, outputNameBase);

      if (
        queueGeneration !== capturedDocumentQueueGenerationRef.current
        || capturedDocumentProcessVersionsRef.current.get(documentId) !== nextVersion
      ) {
        return;
      }

      updateCapturedDocument(documentId, {
        file: processedFile,
        points: clonePoints(resolvedPoints),
        status: "ready",
        error: null,
        documentDetected: Boolean(resolvedPoints && resolvedPoints.length === 4),
      });
      const totalMs = performance.now() - totalStartedAt;
      setCaptureDebug({
        postProcessStatus: "success",
        postProcessError: null,
        postProcessDecodeMs: decodeMs,
        postProcessRedetectMs: redetectMs,
        postProcessPerspectiveMs: processedDocument.perspectiveMs,
        postProcessEnhanceMs: processedDocument.enhanceMs,
        postProcessEncodeMs: processedDocument.encodeMs,
        postProcessTotalMs: totalMs,
        postProcessUsedRedetect: Boolean(options?.redetectPoints),
        postProcessUsedPerspective: Boolean(resolvedPoints && resolvedPoints.length === 4),
        postProcessUsedEnhancement: imageEnhancement,
        postProcessInputWidth: processingFrame.width,
        postProcessInputHeight: processingFrame.height,
        postProcessOutputWidth: processedDocument.outputWidth,
        postProcessOutputHeight: processedDocument.outputHeight,
        postProcessUpdatedAt: Date.now(),
      });
      console.info(
        `[perf:postprocess] ${outputNameBase} | total=${totalMs.toFixed(1)}ms`
        + ` decode=${formatPerfMetric(decodeMs)}ms`
        + ` redetect=${formatPerfMetric(redetectMs)}ms`
        + ` crop=${formatPerfMetric(processedDocument.perspectiveMs)}ms`
        + ` enhance=${formatPerfMetric(processedDocument.enhanceMs)}ms`
        + ` rotate=${formatPerfMetric(processedDocument.rotateMs)}ms`
        + ` encode=${processedDocument.encodeMs.toFixed(1)}ms`
        + ` outputRotation=${outputRotation}`
        + ` | ${processingFrame.width}x${processingFrame.height}`
        + ` -> ${processedDocument.outputWidth}x${processedDocument.outputHeight}`,
      );
    };

    capturedDocumentQueueRef.current = capturedDocumentQueueRef.current
      .catch(() => undefined)
      .then(runProcessing)
      .catch((error) => {
        if (
          queueGeneration !== capturedDocumentQueueGenerationRef.current
          || capturedDocumentProcessVersionsRef.current.get(documentId) !== nextVersion
        ) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        updateCapturedDocument(documentId, {
          points: clonePoints(documentPoints),
          status: "failed",
          error: message,
        });
        setCaptureDebug({
          postProcessStatus: "error",
          postProcessError: message,
          postProcessUpdatedAt: Date.now(),
        });
        toast.error(t("toasts.post-process-failed", {message}));
      });
  }, [
    buildCaptureFile,
    detectDocumentContourWithFallback,
    imageEnhancement,
    renderProcessedDocumentBlob,
    setCaptureDebug,
    t,
    updateCapturedDocument,
  ]);

  const saveCapturedDocument = useCallback((
    artifact: PreparedCaptureArtifact,
    documentDetected: boolean,
    captureSource: "preview-stream" | "single-hq",
  ) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const prefix = captureSource === "single-hq" ? "scan_hq" : "scan_preview";
    const outputNameBase = `${prefix}_${timestamp}`;
    const sourceExtension = artifact.sourceBlob.type === "image/jpeg" ? "jpg" : "png";
    const sourceType = artifact.sourceBlob.type || (sourceExtension === "jpg" ? "image/jpeg" : "image/png");
    const sourceFile = new File([artifact.sourceBlob], `${outputNameBase}_source.${sourceExtension}`, {
      type: sourceType,
    });
    const pointsForDocument = clonePoints(artifact.points);
    const needsPostProcessing = Boolean(
      artifact.outputRotation !== 0
      || imageEnhancement
      || (pointsForDocument && pointsForDocument.length === 4)
    );
    const documentId = crypto.randomUUID();

    addCapturedDocument({
      id: documentId,
      file: sourceFile,
      sourceFile,
      points: pointsForDocument,
      status: needsPostProcessing ? "processing" : "ready",
      error: null,
      documentDetected,
      captureSource,
      sourceWidth: artifact.frame.width,
      sourceHeight: artifact.frame.height,
      outputNameBase,
      outputRotation: artifact.outputRotation,
    });

    if (needsPostProcessing) {
      const shouldRedetectPoints = Boolean(
        captureSource === "single-hq"
        && pointsForDocument
        && pointsForDocument.length === 4,
      );
      queueCapturedDocumentProcessing(
        documentId,
        sourceFile,
        outputNameBase,
        pointsForDocument,
        artifact.outputRotation,
        artifact.frame,
        {
          redetectPoints: shouldRedetectPoints,
        },
      );
    }

    setCaptureDebug({
      lastCaptureSource: captureSource,
      lastCaptureWidth: artifact.frame.width,
      lastCaptureHeight: artifact.frame.height,
      lastCaptureAt: Date.now(),
      lastCaptureError: null,
      lastCaptureDocumentDetected: documentDetected,
    });
  }, [addCapturedDocument, imageEnhancement, queueCapturedDocumentProcessing, setCaptureDebug]);

  const createCaptureSnapshot = useCallback((
    frame: ImageData,
    sourcePoints: Point[] | null,
  ): PreviewCaptureSnapshot => {
    return {
      frame: cloneFrame(frame),
      points: clonePoints(sourcePoints),
    };
  }, []);

  const captureDocument = useCallback(async (
    snapshot: PreviewCaptureSnapshot,
    trigger: "manual" | "auto",
  ) => {
    if (processingRef.current || !dialogOpenRef.current) {
      return;
    }

    const captureGeneration = captureCommitGenerationRef.current;
    const { frame, points: sourcePoints } = snapshot;
    const highQualityCapabilities = frameSourceRef.current?.getState().capabilities;
    const highQualityEnabled = Boolean(highQualityCapabilities?.highQualityStillCapture);

    setProcessingState(true);
    setCaptureCommitPendingState(true);
    publishCvDebug(
      frame,
      sourcePoints,
      Boolean(sourcePoints && sourcePoints.length === 4),
      highQualityEnabled ? "single-hq" : "preview",
      true,
    );
    setCaptureDebug({
      highQualityStatus: highQualityEnabled ? "capturing" : "idle",
      highQualitySource: null,
      highQualityFallbackReason: null,
      lastCaptureError: null,
    });
    toast.info(
      trigger === "auto"
        ? t("toasts.auto-capturing-preview")
        : t("toasts.capturing-preview"),
    );

    try {
      const highQualitySource = highQualityEnabled ? frameSourceRef.current : null;
      let captureArtifact: PreparedCaptureArtifact | null = null;
      let captureSource: "preview-stream" | "single-hq" = "preview-stream";
      const requiresHighQualitySource = highQualityEnabled;

      if (highQualitySource) {
        const highQualityAttempts = requiresHighQualitySource ? 2 : 1;
        let lastHighQualityError: unknown = null;

        for (let attempt = 1; attempt <= highQualityAttempts; attempt += 1) {
          try {
            setCaptureDebug({
              highQualityStatus: "processing",
              highQualitySource: null,
              highQualityFallbackReason: null,
            });
            const artifact = await buildHighQualityCaptureArtifact(highQualitySource, snapshot);
            captureArtifact = artifact;
            captureSource = "single-hq";
            setCaptureDebug({
              highQualityStatus: "success",
              highQualitySource: artifact.source ?? null,
              highQualityFallbackReason: null,
            });
            lastHighQualityError = null;
            break;
          } catch (highQualityError) {
            lastHighQualityError = highQualityError;
            if (attempt < highQualityAttempts) {
              console.warn(`[Scanner] High-quality still capture attempt ${attempt} failed, retrying:`, highQualityError);
            }
          }
        }

        if (lastHighQualityError) {
          const fallbackReason = lastHighQualityError instanceof Error
            ? lastHighQualityError.message
            : String(lastHighQualityError);
          console.warn("[Scanner] High-quality still capture failed:", lastHighQualityError);
          setCaptureDebug({
            highQualityStatus: "error",
            highQualitySource: null,
            highQualityFallbackReason: fallbackReason,
          });

          if (requiresHighQualitySource) {
            throw new Error(`Scanner capture requires a usable high-quality still source: ${fallbackReason}`);
          }
        }
      }

      if (!captureArtifact) {
        captureArtifact = await buildDocumentSourceArtifact(frame, sourcePoints);
      }

      if (!canCommitCaptureResult(captureGeneration)) {
        return;
      }
      saveCapturedDocument(
        captureArtifact,
        Boolean(sourcePoints && sourcePoints.length === 4),
        captureSource,
      );
      setProcessingState(false);
      if (!canCommitCaptureResult(captureGeneration)) {
        return;
      }
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
    buildDocumentSourceArtifact,
    buildHighQualityCaptureArtifact,
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

    const scheduleNextTick = (delayMs: number): void => {
      if (cvLoopTimeoutRef.current) {
        clearTimeout(cvLoopTimeoutRef.current);
      }

      cvLoopTimeoutRef.current = setTimeout(() => {
        cvLoopTimeoutRef.current = null;
        tick();
      }, delayMs);
    };

    const tick = (): void => {
      const frame = latestFrameRef.current;
      if (!frame) {
        scheduleNextTick(CV_PROCESS_INTERVAL_MS);
        return;
      }

      if (processingRef.current) {
        trackerRef.current.reset();
        startTransition(() => {
          setPoints(null);
          setIsStable(false);
        });
        publishCvDebug(frame, null, false, "preview", true);
        scheduleNextTick(CV_PROCESS_INTERVAL_MS);
        return;
      }

      const frameVersion = latestFrameVersionRef.current;
      if (
        !cvDetectionInFlightRef.current
        && frameVersion !== 0
        && frameVersion !== lastCvFrameVersionRef.current
      ) {
        cvDetectionInFlightRef.current = true;
        const processingSize = getCvProcessingSize(frame.width, frame.height);
        const frameForDetection = frame;
        const sessionGeneration = frameSourceSessionGenerationRef.current;
        const detectionStartedAt = performance.now();

        void (async () => {
          try {
            const detectedPoints = await detectDocumentContourWithFallback(
              frameForDetection,
              frameVersion,
              processingSize,
            );
            if (
              !dialogOpenRef.current
              || !isFrameSourceSessionCurrent(sessionGeneration)
            ) {
              return;
            }

            const stable = trackerRef.current.push(detectedPoints);
            const now = Date.now();
            if (!stable || !detectedPoints) {
              stableSinceRef.current = null;
            } else if (stableSinceRef.current === null) {
              stableSinceRef.current = now;
            }

            const stableHoldSatisfied = Boolean(
              stable
              && detectedPoints
              && stableSinceRef.current !== null
              && now - stableSinceRef.current >= AUTO_CAPTURE_STABLE_HOLD_MS,
            );

            latestCvSnapshotRef.current = {
              frame: frameForDetection,
              points: clonePoints(detectedPoints),
            };

            startTransition(() => {
              setPoints((current) => (pointsEqual(current, detectedPoints) ? current : detectedPoints));
              setIsStable((current) => (current === stable ? current : stable));
            });
            publishCvDebug(frameForDetection, detectedPoints, stable, "preview", false, processingSize);

            if (
              autoCaptureRef.current
              && stableHoldSatisfied
              && detectedPoints
            ) {
              void captureDocument(
                createCaptureSnapshot(frameForDetection, detectedPoints),
                "auto",
              );
            }

            lastCvFrameVersionRef.current = frameVersion;
          } catch (error) {
            if (
              dialogOpenRef.current
              && isFrameSourceSessionCurrent(sessionGeneration)
            ) {
              console.error("[Scanner] CV detection failed:", error);
            }
          } finally {
            cvDetectionInFlightRef.current = false;
            if (
              dialogOpenRef.current
              && isFrameSourceSessionCurrent(sessionGeneration)
              && latestFrameVersionRef.current !== frameVersion
            ) {
              const elapsedMs = performance.now() - detectionStartedAt;
              scheduleNextTick(Math.max(0, CV_PROCESS_INTERVAL_MS - elapsedMs));
            }
          }
        })();
      }

      scheduleNextTick(CV_PROCESS_INTERVAL_MS);
    };

    scheduleNextTick(0);
  }, [
    captureDocument,
    clearCvLoop,
    createCaptureSnapshot,
    detectDocumentContourWithFallback,
    isFrameSourceSessionCurrent,
    publishCvDebug,
  ]);

  const drawLatestFrameToCanvas = useCallback(() => {
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
  }, []);

  const schedulePreviewRender = useCallback(() => {
    if (animationFrameRef.current !== null) {
      return;
    }

    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      drawLatestFrameToCanvas();

      if (renderedFrameVersionRef.current !== latestFrameVersionRef.current) {
        schedulePreviewRender();
      }
    });
  }, [drawLatestFrameToCanvas]);

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
      highQualityFallbackReason: null,
      lastCaptureError: null,
      lastCaptureSource: null,
      lastCaptureAt: null,
      lastCaptureWidth: null,
      lastCaptureHeight: null,
      lastCaptureDocumentDetected: false,
      postProcessStatus: "idle",
      postProcessError: null,
      postProcessDecodeMs: null,
      postProcessRedetectMs: null,
      postProcessPerspectiveMs: null,
      postProcessEnhanceMs: null,
      postProcessEncodeMs: null,
      postProcessTotalMs: null,
      postProcessUsedRedetect: false,
      postProcessUsedPerspective: false,
      postProcessUsedEnhancement: false,
      postProcessInputWidth: null,
      postProcessInputHeight: null,
      postProcessOutputWidth: null,
      postProcessOutputHeight: null,
      postProcessUpdatedAt: null,
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
        schedulePreviewRender();
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

      void ensureCvWorker();
      setStatus("streaming");
      setConnectionDebug({
        reconnectState: "connected",
        reconnectMessage: t("connection.started"),
      });
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
    ensureCvWorker,
    isFrameSourceSessionCurrent,
    invalidatePendingCaptureCommits,
    publishCvDebug,
    schedulePreviewRender,
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
    terminateCvWorker();

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
    terminateCvWorker,
  ]);

  // Keep a stable ref so the unmount-only cleanup always calls the latest version.
  stopScannerRef.current = stopScanner;

  const handleStop = useCallback(async () => {
    await stopScanner();
  }, [stopScanner]);

  const handlePreviewCapture = useCallback(() => {
    const cvSnapshot = latestCvSnapshotRef.current;
    if (cvSnapshot) {
      void captureDocument(createCaptureSnapshot(
        cvSnapshot.frame,
        cvSnapshot.points,
      ), "manual");
      return;
    }

    const frame = latestFrameRef.current;
    if (!frame) {
      return;
    }

    void captureDocument(createCaptureSnapshot(frame, null), "manual");
  }, [captureDocument, createCaptureSnapshot]);

  const handleRemoveCapturedDocument = useCallback((documentId: string) => {
    capturedDocumentProcessVersionsRef.current.delete(documentId);
    if (editingCapturedDocumentId === documentId) {
      setEditingCapturedDocumentId(null);
    }
    removeCapturedDocument(documentId);
  }, [editingCapturedDocumentId, removeCapturedDocument]);

  const handleEditCapturedDocument = useCallback((documentId: string) => {
    const document = capturedDocuments.find((entry) => entry.id === documentId);
    if (!document || document.status === "processing") {
      return;
    }

    setEditingCapturedDocumentId(documentId);
  }, [capturedDocuments]);

  const handleApplyCapturedDocumentEdit = useCallback((
    documentId: string,
    nextPoints: Point[],
  ) => {
    const document = capturedDocuments.find((entry) => entry.id === documentId);
    if (!document) {
      return;
    }

    setEditingCapturedDocumentId(null);
    queueCapturedDocumentProcessing(
      documentId,
      document.sourceFile,
      document.outputNameBase,
      nextPoints,
      document.outputRotation,
      undefined,
      {
        redetectPoints: false,
      },
    );
  }, [capturedDocuments, queueCapturedDocumentProcessing]);

  const handlePreviewOrientationToggle = useCallback(() => {
    setPreviewOrientation((current) => (current === "landscape" ? "portrait" : "landscape"));
  }, []);

  const handleSendToAI = useCallback(() => {
    if (capturedDocuments.length === 0) {
      toast.error(t("toasts.no-documents"));
      return;
    }
    const processingCount = capturedDocuments.filter((document) => document.status === "processing").length;
    if (processingCount > 0) {
      toast.info(t("toasts.post-processing-pending", {count: processingCount}));
      return;
    }
    const failedCount = capturedDocuments.filter((document) => document.status === "failed").length;
    if (failedCount > 0) {
      toast.error(t("toasts.post-processing-blocked", {count: failedCount}));
      return;
    }
    if (captureCommitPendingRef.current) {
      return;
    }

    invalidatePendingCaptureCommits();
    invalidateCapturedDocumentQueue();
    clearProcessingCooldown();
    setProcessingState(false);
    onDocumentsCaptured?.(capturedDocuments.map((document) => document.file));
    clearCapturedDocuments();
    onOpenChange(false);
  }, [
    capturedDocuments,
    clearCapturedDocuments,
    clearProcessingCooldown,
    invalidateCapturedDocumentQueue,
    invalidatePendingCaptureCommits,
    onDocumentsCaptured,
    onOpenChange,
    setProcessingState,
    t,
  ]);

  useEffect(() => {
    previewOrientationRef.current = previewOrientation;
    renderedFrameVersionRef.current = 0;
    if (isStreaming) {
      schedulePreviewRender();
    }
  }, [isStreaming, previewOrientation, schedulePreviewRender]);

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
      invalidateCapturedDocumentQueue();
      setProcessingState(false);
      setCaptureCommitPendingState(false);
      latestCvSnapshotRef.current = null;
      void handleStop();
      reset();
    }
  }, [
    handleStop,
    invalidateCapturedDocumentQueue,
    invalidatePendingCaptureCommits,
    isOpen,
    reset,
    setCaptureCommitPendingState,
    setProcessingState,
  ]);

  useEffect(() => {
    // Strict Mode mounts effects twice in development, so reset the ref here
    // after the previous cleanup marks the component as unmounted.
    unmountedRef.current = false;

    return () => {
      unmountedRef.current = true;
      dialogOpenRef.current = false;
      invalidateCapturedDocumentQueue();
      // Reuse the full stop path so transport teardown also cancels RAF and stops the source.
      void stopScannerRef.current?.({ skipComponentState: true });
    };
  }, [invalidateCapturedDocumentQueue]);

  const isPortraitSplitLayout = previewOrientation === "portrait";
  const dialogSectionPaddingClass = "px-4 sm:px-5 lg:px-6";
  const dialogWidthClass = isPortraitSplitLayout
    ? "sm:!w-[min(100vw-2rem,1320px)] sm:!max-w-[min(100vw-2rem,1320px)]"
    : "sm:!w-[min(100vw-2rem,1180px)] sm:!max-w-[min(100vw-2rem,1180px)]";
  const scannerContentWidthClass = isPortraitSplitLayout
    ? "mx-auto w-full max-w-[1260px] space-y-4"
    : "mx-auto w-full max-w-[1120px] space-y-4";
  const previewColumnWidthClass = isPortraitSplitLayout
    ? "xl:max-w-[384px] 2xl:max-w-[400px]"
    : "xl:max-w-[680px]";
  const scannerGridClass = isPortraitSplitLayout
    ? "xl:mx-auto xl:w-fit xl:max-w-full xl:grid-cols-[minmax(0,384px)_minmax(320px,360px)_minmax(320px,400px)] 2xl:grid-cols-[minmax(0,400px)_minmax(340px,380px)_minmax(340px,420px)]"
    : "xl:w-full xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] 2xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,420px)]";
  const hasProcessingCapturedDocuments = capturedDocuments.some((document) => document.status === "processing");
  const hasFailedCapturedDocuments = capturedDocuments.some((document) => document.status === "failed");

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
        className={cn("!flex h-[min(92vh,960px)] flex-col overflow-hidden p-0", dialogWidthClass)}
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
                    <ScannerCaptureDebugCard />
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
                    <ScannerCapturedDocumentThumbnail
                      key={doc.id}
                      document={doc}
                      index={index}
                      onEdit={handleEditCapturedDocument}
                      onRemove={handleRemoveCapturedDocument}
                      previewAlt={t("captured.preview-alt", { index: index + 1 })}
                      statusLabel={
                        doc.status === "processing"
                          ? t("captured.status.processing")
                          : doc.status === "failed"
                            ? t("captured.status.failed")
                            : t("captured.status.ready")
                      }
                    />
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
            disabled={
              capturedDocuments.length === 0
              || isCaptureCommitPending
              || hasProcessingCapturedDocuments
              || hasFailedCapturedDocuments
            }
            className={cn(
              "min-w-32 w-full sm:w-auto",
              (
                capturedDocuments.length === 0
                || isCaptureCommitPending
                || hasProcessingCapturedDocuments
                || hasFailedCapturedDocuments
              ) && "opacity-50 grayscale",
            )}
          >
            {t("actions.send-to-ai", { count: capturedDocuments.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
      <ScannerCapturedDocumentEditor
        open={Boolean(editingCapturedDocument)}
        document={editingCapturedDocument}
        isApplying={editingCapturedDocument?.status === "processing"}
        onOpenChange={(open) => {
          if (!open) {
            setEditingCapturedDocumentId(null);
          }
        }}
        onApply={handleApplyCapturedDocumentEdit}
      />
    </Dialog>
  );
}
