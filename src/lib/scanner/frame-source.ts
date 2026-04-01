/**
 * Unified frame source abstraction for the document scanner.
 *
 * Provides a consistent interface for receiving low-cost live preview frames,
 * capturing high-quality still images on demand, and recovering from transport
 * failures without forcing the UI layer to rebuild the full scanner pipeline.
 */

import {
  captureTauriAdbStill,
  captureTauriAdbStillStream,
  forwardTauriAdbPort,
  pushTauriAdbFile,
  removeForwardTauriAdbPort,
  startTauriAdbServer,
  startTauriDecodeStream,
  stopTauriAdbServer,
  stopTauriDecodeStream,
  type TauriDecodeStreamHandle,
  type TauriDecodeStreamLifecycleEvent,
} from "@/lib/tauri/adb";
import {isTauri} from "@/lib/tauri/platform";

import {decodeFramePacketToRgba, FRAME_PACKET_HEADER_SIZE, FRAME_PACKET_TELEMETRY_SIZE,} from "./frame-codec";

/** Callback type for receiving decoded preview frames. */
export type FrameCallback = (frame: ImageData) => void;

/** Callback type for frame source errors. */
export type ErrorCallback = (error: string) => void;

/** Callback type for frame source state updates. */
export type FrameSourceStateCallback = (state: FrameSourceState) => void;

/** Live preview and capture capability flags exposed to the UI layer. */
export interface FrameSourceCapabilities {
  livePreview: boolean;
  highQualityStillCapture: boolean;
  colorPreview: boolean;
  automaticReconnect: boolean;
}

/** Lightweight metrics that can be rendered directly in the UI. */
export interface FrameSourceMetrics {
  targetPreviewFps: number;
  frameIndex: number;
  frameCount: number;
  pollCount: number;
  emptyPollCount: number;
  consecutiveEmptyPolls: number;
  lastPayloadBytes: number;
  lastIpcMs: number;
  lastDecodeMs: number;
  previewFps: number;
  recentWindowFps: number;
  effectiveFps: number;
  previewWidth: number | null;
  previewHeight: number | null;
  lastFrameAt: number | null;
  stallCount: number;
  reconnectCount: number;
  totalReconnectDowntimeMs: number;
}

export interface FrameSourceBenchmarkWindow {
  sampleCount: number;
  average: number;
  p95: number;
  max: number;
}

export interface FrameSourceBenchmarkSnapshot {
  collectedAt: number;
  startedAt: number | null;
  runtimeMs: number;
  status: FrameSourceStatus;
  targetPreviewFps: number;
  frameIndex: number;
  totalFrames: number;
  totalPolls: number;
  emptyPolls: number;
  previewFps: number;
  recentWindowFps: number;
  effectiveFps: number;
  latestPayloadBytes: number;
  latestIpcMs: number;
  latestDecodeMs: number;
  previewResolution: {
    width: number | null;
    height: number | null;
  };
  recentError: string | null;
  frameIntervalMs: FrameSourceBenchmarkWindow;
  ipcMs: FrameSourceBenchmarkWindow;
  decodeMs: FrameSourceBenchmarkWindow;
  payloadBytes: FrameSourceBenchmarkWindow;
  reconnect: {
    count: number;
    inProgress: boolean;
    attempt: number;
    totalDowntimeMs: number;
    lastDowntimeMs: number | null;
  };
}

export type FrameSourceStatus =
  | "idle"
  | "starting"
  | "streaming"
  | "reconnecting"
  | "stopping"
  | "stopped"
  | "error";

export interface FrameSourceState {
  status: FrameSourceStatus;
  statusUpdatedAt: number;
  reconnectAttempt: number;
  nextReconnectDelayMs: number | null;
  lastError: string | null;
  stopReason: string | null;
  capabilities: FrameSourceCapabilities;
  metrics: FrameSourceMetrics;
  benchmark: FrameSourceBenchmarkSnapshot;
}

export interface ScannerStillCapture {
  file: File;
  width: number | null;
  height: number | null;
  capturedAt: number;
  source: "tauri-camera-still";
  serial: string;
  previewWidth: number | null;
  previewHeight: number | null;
  transport: string;
}

type DecoderLifecycleState = "starting" | "connected" | "reconnecting" | "ready" | "error" | "stopped";

type DecoderLifecycleEvent = TauriDecodeStreamLifecycleEvent & {
  state: DecoderLifecycleState;
};

/** Frame source lifecycle interface. */
export interface FrameSource {
  /** Start receiving frames from the source. */
  start(): Promise<void>;
  /** Stop receiving frames and clean up resources. */
  stop(): Promise<void>;
  /** Register a callback to receive preview frames. */
  onFrame(callback: FrameCallback): void;
  /** Register a callback for error notifications. */
  onError(callback: ErrorCallback): void;
  /** Register for state and benchmark updates. Returns an unsubscribe function. */
  onStateChange(callback: FrameSourceStateCallback): () => void;
  /** Get the most recent state snapshot. */
  getState(): FrameSourceState;
  /** Get the most recent benchmark snapshot. */
  getBenchmarkSnapshot(): FrameSourceBenchmarkSnapshot;
  /** Capture a single full-quality still image independent of the live preview path. */
  captureStillFrame(): Promise<ScannerStillCapture>;
}

/** Configuration for the camera server connection. */
export interface ScannerConfig {
  serial: string;
  serverJarPath: string;
  remoteJarPath: string;
  socketName: string;
  localPort: number;
  width: number;
  height: number;
  bitrate: number;
  framerate: number;
  cameraId: string;
}

/** Default scanner configuration values. */
export const DEFAULT_SCANNER_CONFIG: Omit<ScannerConfig, "serial" | "serverJarPath"> = {
  remoteJarPath: "/data/local/tmp/camera-server.jar",
  socketName: "scanner",
  localPort: 27184,
  width: 640,
  height: 360,
  bitrate: 2_000_000,
  framerate: 30,
  cameraId: "0",
};

const SERVER_MAIN_CLASS = "com.skidhomework.server.Server";
const STILL_CAPTURE_SOCKET_SUFFIX = "-still";
const STILL_STREAM_SOCKET_SUFFIX = "-still-stream";
const STILL_FORWARD_PORT_OFFSET = 1000;
const DECODE_RESTART_DELAY_MS = 125;
const WATCHDOG_INTERVAL_MS = 1000;
const STARTUP_FRAME_GRACE_MS = 9000;

const getStillCaptureSocketName = (socketName: string): string => {
  return `${socketName}${STILL_CAPTURE_SOCKET_SUFFIX}`;
};

const getStillStreamSocketName = (socketName: string): string => {
  return `${socketName}${STILL_STREAM_SOCKET_SUFFIX}`;
};

const buildStillForwardPreferredPort = (previewPort: number): number => {
  const basePort = Number.isInteger(previewPort) && previewPort > 0
    ? previewPort
    : DEFAULT_SCANNER_CONFIG.localPort;
  return Math.min(MAX_TCP_PORT, Math.max(1, basePort + STILL_FORWARD_PORT_OFFSET));
};

const JPEG_SOI_MARKER = 0xffd8;
const JPEG_SEGMENT_MARKER_PREFIX = 0xff;
const JPEG_START_OF_SCAN_MARKER = 0xda;
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

const readBigEndianMarker = (bytes: Uint8Array, index: number): number | null => {
  if (index < 0 || index + 1 >= bytes.byteLength) {
    return null;
  }

  return (bytes[index] << 8) | bytes[index + 1];
};

const readNextJpegMarker = (
  bytes: Uint8Array,
  offset: number,
): { marker: number; markerStart: number; nextOffset: number } | null => {
  if (offset < 0 || offset >= bytes.byteLength || bytes[offset] !== JPEG_SEGMENT_MARKER_PREFIX) {
    return null;
  }

  const markerStart = offset;
  while (offset < bytes.byteLength && bytes[offset] === JPEG_SEGMENT_MARKER_PREFIX) {
    offset += 1;
  }

  if (offset >= bytes.byteLength) {
    return null;
  }

  return {
    marker: bytes[offset],
    markerStart,
    nextOffset: offset + 1,
  };
};

const scanJpegEntropyData = (
  bytes: Uint8Array,
  offset: number,
): { nextMarkerOffset: number; end: number | null } | null => {
  while (offset + 1 < bytes.byteLength) {
    if (bytes[offset] !== JPEG_SEGMENT_MARKER_PREFIX) {
      offset += 1;
      continue;
    }

    const marker = readNextJpegMarker(bytes, offset);
    if (!marker) {
      return null;
    }

    if (marker.marker === 0x00) {
      offset = marker.nextOffset;
      continue;
    }

    if (marker.marker >= 0xd0 && marker.marker <= 0xd7) {
      offset = marker.nextOffset;
      continue;
    }

    if (marker.marker === 0xd9) {
      return {
        nextMarkerOffset: marker.markerStart,
        end: marker.nextOffset,
      };
    }

    return {
      nextMarkerOffset: marker.markerStart,
      end: null,
    };
  }

  return null;
};

const findJpegPayloadBoundsFrom = (
  bytes: Uint8Array,
  startIndex: number,
): { start: number; end: number } | null => {
  if (readBigEndianMarker(bytes, startIndex) !== JPEG_SOI_MARKER) {
    return null;
  }

  let offset = startIndex + 2;

  while (offset + 1 < bytes.byteLength) {
    const markerInfo = readNextJpegMarker(bytes, offset);
    if (!markerInfo) {
      return null;
    }

    const marker = markerInfo.marker;
    offset = markerInfo.nextOffset;

    if (marker === 0xd9) {
      return { start: startIndex, end: offset };
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (offset + 1 >= bytes.byteLength) {
      return null;
    }

    const segmentLength = readBigEndianMarker(bytes, offset);
    if (segmentLength === null || segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      return null;
    }

    offset += segmentLength;

    if (marker !== JPEG_START_OF_SCAN_MARKER) {
      continue;
    }

    // Some vendors emit multi-scan/progressive JPEGs. When the entropy-coded
    // segment ends at another marker instead of EOI, continue parsing until we
    // reach the real end-of-image marker.
    const entropyScan = scanJpegEntropyData(bytes, offset);
    if (!entropyScan) {
      return null;
    }

    if (entropyScan.end !== null) {
      return { start: startIndex, end: entropyScan.end };
    }

    offset = entropyScan.nextMarkerOffset;
  }

  return null;
};

const extractJpegPayload = (bytes: Uint8Array): Uint8Array => {
  for (let index = 0; index < bytes.byteLength - 1; index += 1) {
    if (readBigEndianMarker(bytes, index) !== JPEG_SOI_MARKER) {
      continue;
    }

    const bounds = findJpegPayloadBoundsFrom(bytes, index);
    if (bounds) {
      return bytes.slice(bounds.start, bounds.end);
    }
  }

  return bytes;
};

const readJpegDimensions = (
  bytes: Uint8Array,
): { width: number; height: number } | null => {
  if (readBigEndianMarker(bytes, 0) !== JPEG_SOI_MARKER) {
    return null;
  }

  let offset = 2;
  while (offset + 3 < bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] === JPEG_SEGMENT_MARKER_PREFIX) {
      offset += 1;
    }

    if (offset >= bytes.byteLength) {
      break;
    }

    const marker = bytes[offset];
    offset += 1;

    if (marker === 0x01) {
      continue;
    }

    if (marker === 0xd9 || marker === JPEG_START_OF_SCAN_MARKER) {
      break;
    }

    if (offset + 1 >= bytes.byteLength) {
      break;
    }

    const segmentLength = readBigEndianMarker(bytes, offset);
    if (segmentLength === null || segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      break;
    }

    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) {
        return null;
      }

      const height = readBigEndianMarker(bytes, offset + 3);
      const width = readBigEndianMarker(bytes, offset + 5);
      if (width === null || height === null) {
        return null;
      }

      return { width, height };
    }

    offset += segmentLength;
  }

  return null;
};

const findMarkerOffset = (
  bytes: Uint8Array,
  marker: number,
  fromEnd: boolean = false,
): number | null => {
  if (fromEnd) {
    for (let index = bytes.byteLength - 2; index >= 0; index -= 1) {
      if (readBigEndianMarker(bytes, index) === marker) {
        return index;
      }
    }
    return null;
  }

  for (let index = 0; index < bytes.byteLength - 1; index += 1) {
    if (readBigEndianMarker(bytes, index) === marker) {
      return index;
    }
  }

  return null;
};

const describeHexWindow = (
  bytes: Uint8Array,
  count: number,
  fromEnd: boolean = false,
): string => {
  if (bytes.byteLength === 0) {
    return "∅";
  }

  const safeCount = Math.max(1, Math.min(count, bytes.byteLength));
  const slice = fromEnd
    ? bytes.slice(bytes.byteLength - safeCount)
    : bytes.slice(0, safeCount);
  return [...slice].map((value) => value.toString(16).padStart(2, "0")).join(" ");
};

const describeStillPayloadDiagnostics = (
  bytes: Uint8Array,
  mimeType: string,
): Record<string, unknown> => {
  const startsWithSoi = mimeType === "image/jpeg"
    ? readBigEndianMarker(bytes, 0) === JPEG_SOI_MARKER
    : null;
  const firstSoiOffset = mimeType === "image/jpeg"
    ? findMarkerOffset(bytes, JPEG_SOI_MARKER)
    : null;
  const lastEoiOffset = mimeType === "image/jpeg"
    ? findMarkerOffset(bytes, 0xffd9, true)
    : null;
  const dimensions = mimeType === "image/jpeg"
    ? readJpegDimensions(bytes)
    : null;

  return {
    mimeType,
    byteLength: bytes.byteLength,
    headHex: describeHexWindow(bytes, 16),
    tailHex: describeHexWindow(bytes, 16, true),
    startsWithSoi,
    firstSoiOffset,
    lastEoiOffset,
    dimensions,
  };
};

const formatStillPayloadDiagnostics = (payload: Record<string, unknown>): string => {
  return JSON.stringify(payload);
};

const buildStillCaptureFile = (
  bytes: Uint8Array,
  mimeType = "image/jpeg",
): File => {
  const extension = mimeType === "image/png" ? "png" : "jpg";
  const fileName = `camera_still_${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
  const blobCompatibleBytes = new Uint8Array(bytes.byteLength);
  blobCompatibleBytes.set(bytes);
  return new File([blobCompatibleBytes], fileName, { type: mimeType });
};
const BENCHMARK_EMIT_INTERVAL_MS = 250;
const BENCHMARK_WINDOW_SIZE = 240;
const INITIAL_RECONNECT_DELAY_MS = 250;
const MAX_RECONNECT_DELAY_MS = 5000;
const RECONNECT_BACKOFF_MULTIPLIER = 1.6;
const DECODE_RESTART_MAX_ATTEMPTS = 2;
const FORWARD_RESTART_MAX_ATTEMPTS = 3;
const RECOVERY_EVENT_SUPPRESSION_MS = 2500;
const STEADY_STATE_STALL_MIN_GRACE_MS = 4500;
const STEADY_STATE_STALL_FRAME_MULTIPLIER = 48;
const MAX_TCP_PORT = 65535;
const FORWARD_PORT_FALLBACK_OFFSETS = [0, 1, 2, 3, 4, 5, 10, 20, 50, 100, 200, 500];

type RecoveryMode =
  | "cold-start"
  | "decode-restart"
  | "server-restart"
  | "forward-restart";

interface CleanupTransportOptions {
  stopDecoder: boolean;
  stopServer: boolean;
  removeForward: boolean;
}

const DEFAULT_CAPABILITIES: FrameSourceCapabilities = {
  livePreview: true,
  highQualityStillCapture: true,
  colorPreview: true,
  automaticReconnect: true,
};

interface BenchmarkAccumulator {
  startedAt: number | null;
  firstFrameAt: number | null;
  totalFrames: number;
  totalPolls: number;
  totalEmptyPolls: number;
  lastFrameAt: number | null;
  ipcSamples: number[];
  decodeSamples: number[];
  payloadSamples: number[];
  frameIntervalSamples: number[];
  reconnectCount: number;
  reconnectStartedAt: number | null;
  totalReconnectDowntimeMs: number;
  lastReconnectDowntimeMs: number | null;
}

const nowMs = (): number => {
  return performance.now();
};

const nowEpochMs = (): number => {
  return performance.timeOrigin + performance.now();
};

const sleep = async (delayMs: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const toErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const isLocalForwardBindError = (error: unknown): boolean => {
  const message = toErrorMessage(error).toLowerCase();
  return [
    "cannot bind listener",
    "cannot bind to 127.0.0.1",
    "10013",
    "10048",
    "access permissions",
    "only one usage of each socket address",
    "访问权限不允许",
    "访问套接字",
  ].some((pattern) => message.includes(pattern));
};

const buildForwardPortCandidates = (preferredPort: number): number[] => {
  const basePort = Number.isInteger(preferredPort) && preferredPort > 0
    ? preferredPort
    : DEFAULT_SCANNER_CONFIG.localPort;

  const candidates = new Set<number>();
  for (const offset of FORWARD_PORT_FALLBACK_OFFSETS) {
    const candidate = basePort + offset;
    if (candidate > 0 && candidate <= MAX_TCP_PORT) {
      candidates.add(candidate);
    }
  }

  return [...candidates];
};

const pushWindowSample = (samples: number[], value: number): void => {
  samples.push(value);
  if (samples.length > BENCHMARK_WINDOW_SIZE) {
    samples.splice(0, samples.length - BENCHMARK_WINDOW_SIZE);
  }
};

const summarizeSamples = (samples: number[]): FrameSourceBenchmarkWindow => {
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      average: 0,
      p95: 0,
      max: 0,
    };
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const sum = sorted.reduce((accumulator, value) => accumulator + value, 0);
  const p95Index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * 0.95) - 1),
  );

  return {
    sampleCount: sorted.length,
    average: sum / sorted.length,
    p95: sorted[p95Index],
    max: sorted[sorted.length - 1],
  };
};

const computeRecentWindowFps = (
  frameIntervalSamples: number[],
  desiredWindowMs: number,
): number => {
  if (frameIntervalSamples.length === 0) {
    return 0;
  }

  let accumulatedMs = 0;
  let intervalCount = 0;

  for (let index = frameIntervalSamples.length - 1; index >= 0; index -= 1) {
    const sample = frameIntervalSamples[index];
    accumulatedMs += sample;
    intervalCount += 1;

    if (accumulatedMs >= desiredWindowMs) {
      break;
    }
  }

  if (accumulatedMs <= 0 || intervalCount === 0) {
    return 0;
  }

  return (intervalCount * 1000) / accumulatedMs;
};

const computeActiveStreamingFps = (
  totalFrames: number,
  firstFrameAt: number | null,
  lastFrameAt: number | null,
  totalReconnectDowntimeMs: number,
): number => {
  if (totalFrames <= 0 || firstFrameAt === null || lastFrameAt === null || lastFrameAt <= firstFrameAt) {
    return 0;
  }

  const activeRuntimeMs = Math.max(0, (lastFrameAt - firstFrameAt) - totalReconnectDowntimeMs);
  if (activeRuntimeMs <= 0) {
    return 0;
  }

  return totalFrames / (activeRuntimeMs / 1000);
};

const computeSessionAverageFps = (
  totalFrames: number,
  startedAt: number | null,
): number => {
  if (totalFrames <= 0 || startedAt === null) {
    return 0;
  }

  const runtimeMs = Math.max(0, nowMs() - startedAt);
  if (runtimeMs <= 0) {
    return 0;
  }

  return totalFrames / (runtimeMs / 1000);
};

const computeLatestFrameFps = (frameIntervalSamples: number[]): number => {
  if (frameIntervalSamples.length === 0) {
    return 0;
  }

  const latestIntervalMs = frameIntervalSamples[frameIntervalSamples.length - 1] ?? 0;
  if (latestIntervalMs <= 0) {
    return 0;
  }

  return 1000 / latestIntervalMs;
};

const clampMetric = (value: number): number => {
  return Number.isFinite(value) && value > 0 ? value : 0;
};

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 10) / 10;
};

const resolveEffectiveFps = (benchmark: BenchmarkAccumulator): number => {
  return roundMetric(
    clampMetric(
      computeActiveStreamingFps(
        benchmark.totalFrames,
        benchmark.firstFrameAt,
        benchmark.lastFrameAt,
        benchmark.totalReconnectDowntimeMs,
      ),
    ),
  );
};

const resolveSessionAverageFps = (benchmark: BenchmarkAccumulator): number => {
  return roundMetric(clampMetric(computeSessionAverageFps(benchmark.totalFrames, benchmark.startedAt)));
};

const resolveRecentWindowFps = (benchmark: BenchmarkAccumulator): number => {
  return roundMetric(clampMetric(computeRecentWindowFps(benchmark.frameIntervalSamples, 3000)));
};

const resolvePreviewFps = (benchmark: BenchmarkAccumulator): number => {
  return roundMetric(clampMetric(computeLatestFrameFps(benchmark.frameIntervalSamples)));
};

const computeBenchmarkRuntimeMs = (benchmark: BenchmarkAccumulator): number => {
  return benchmark.startedAt === null
    ? 0
    : Math.max(0, nowMs() - benchmark.startedAt);
};

const getCurrentSnapshotMetrics = (benchmark: BenchmarkAccumulator): {
  previewFps: number;
  recentWindowFps: number;
  effectiveFps: number;
  runtimeMs: number;
} => {
  return {
    previewFps: resolvePreviewFps(benchmark),
    recentWindowFps: resolveRecentWindowFps(benchmark),
    effectiveFps: resolveSessionAverageFps(benchmark),
    runtimeMs: computeBenchmarkRuntimeMs(benchmark),
  };
};

const getCurrentUiMetrics = (benchmark: BenchmarkAccumulator): {
  previewFps: number;
  recentWindowFps: number;
  effectiveFps: number;
} => {
  return {
    previewFps: resolvePreviewFps(benchmark),
    recentWindowFps: resolveRecentWindowFps(benchmark),
    effectiveFps: resolveEffectiveFps(benchmark),
  };
};

const getBenchmarkMetrics = (benchmark: BenchmarkAccumulator): {
  previewFps: number;
  recentWindowFps: number;
  effectiveFps: number;
  runtimeMs: number;
} => {
  return getCurrentSnapshotMetrics(benchmark);
};

const applyUiMetrics = (benchmark: BenchmarkAccumulator, metrics: FrameSourceMetrics): void => {
  const current = getCurrentUiMetrics(benchmark);
  metrics.previewFps = current.previewFps;
  metrics.recentWindowFps = current.recentWindowFps;
  metrics.effectiveFps = current.effectiveFps;
};

const setLastIpcMetric = (metrics: FrameSourceMetrics, value: number): void => {
  metrics.lastIpcMs = roundMetric(Math.max(0, value));
};

const setLastDecodeMetric = (metrics: FrameSourceMetrics, value: number): void => {
  metrics.lastDecodeMs = roundMetric(Math.max(0, value));
};

const setLastPayloadMetric = (metrics: FrameSourceMetrics, value: number): void => {
  metrics.lastPayloadBytes = Math.max(0, value);
};

const resetFirstFrameAt = (benchmark: BenchmarkAccumulator): void => {
  benchmark.firstFrameAt = null;
};

const markBenchmarkFirstFrame = (benchmark: BenchmarkAccumulator, timestamp: number): void => {
  if (benchmark.firstFrameAt === null) {
    benchmark.firstFrameAt = timestamp;
  }
};

const pushBenchmarkFrameInterval = (
  benchmark: BenchmarkAccumulator,
  currentTimestamp: number,
  previousTimestamp: number,
): void => {
  pushWindowSample(benchmark.frameIntervalSamples, currentTimestamp - previousTimestamp);
};

const computeReconnectDelay = (attempt: number): number => {
  if (attempt <= 0) {
    return 0;
  }

  const delay = INITIAL_RECONNECT_DELAY_MS * (RECONNECT_BACKOFF_MULTIPLIER ** (attempt - 1));
  return Math.round(Math.min(MAX_RECONNECT_DELAY_MS, delay));
};

const computeWatchdogThresholdMs = (
  lastFrameAt: number | null,
  targetPreviewFps: number,
): number => {
  if (lastFrameAt === null) {
    return STARTUP_FRAME_GRACE_MS;
  }

  return Math.max(
    STEADY_STATE_STALL_MIN_GRACE_MS,
    Math.round((1000 / Math.max(1, targetPreviewFps)) * STEADY_STATE_STALL_FRAME_MULTIPLIER),
  );
};

const looksLikePreviewSizedStillCapture = (
  previewWidth: number | null,
  previewHeight: number | null,
  stillWidth: number | null,
  stillHeight: number | null,
): boolean => {
  if (
    previewWidth === null
    || previewHeight === null
    || stillWidth === null
    || stillHeight === null
  ) {
    return false;
  }

  const previewLongEdge = Math.max(previewWidth, previewHeight);
  const previewShortEdge = Math.min(previewWidth, previewHeight);
  const stillLongEdge = Math.max(stillWidth, stillHeight);
  const stillShortEdge = Math.min(stillWidth, stillHeight);

  return stillLongEdge <= previewLongEdge * 1.2
    && stillShortEdge <= previewShortEdge * 1.2;
};

const selectRecoveryMode = (
  stopReason: string,
  attempt: number,
  hasReceivedFrames: boolean,
): RecoveryMode => {
  if (attempt <= 0) {
    return "cold-start";
  }

  if (
    !hasReceivedFrames
    && (
      stopReason === "scanner-error"
      || stopReason === "scanner-stopped"
      || stopReason === "poll-error"
    )
  ) {
    return "server-restart";
  }

  if (attempt <= DECODE_RESTART_MAX_ATTEMPTS) {
    return "decode-restart";
  }

  if (attempt <= FORWARD_RESTART_MAX_ATTEMPTS) {
    return "forward-restart";
  }

  return "server-restart";
};

const createEmptyBenchmarkSnapshot = (): FrameSourceBenchmarkSnapshot => {
  return {
    collectedAt: nowMs(),
    startedAt: null,
    runtimeMs: 0,
    status: "idle",
    targetPreviewFps: DEFAULT_SCANNER_CONFIG.framerate,
    frameIndex: 0,
    totalFrames: 0,
    totalPolls: 0,
    emptyPolls: 0,
    previewFps: 0,
    recentWindowFps: 0,
    effectiveFps: 0,
    latestPayloadBytes: 0,
    latestIpcMs: 0,
    latestDecodeMs: 0,
    previewResolution: {
      width: null,
      height: null,
    },
    recentError: null,
    frameIntervalMs: summarizeSamples([]),
    ipcMs: summarizeSamples([]),
    decodeMs: summarizeSamples([]),
    payloadBytes: summarizeSamples([]),
    reconnect: {
      count: 0,
      inProgress: false,
      attempt: 0,
      totalDowntimeMs: 0,
      lastDowntimeMs: null,
    },
  };
};

const createInitialState = (): FrameSourceState => {
  return {
    status: "idle",
    statusUpdatedAt: nowMs(),
    reconnectAttempt: 0,
    nextReconnectDelayMs: null,
    lastError: null,
    stopReason: null,
    capabilities: { ...DEFAULT_CAPABILITIES },
    metrics: {
      targetPreviewFps: DEFAULT_SCANNER_CONFIG.framerate,
      frameIndex: 0,
      frameCount: 0,
      pollCount: 0,
      emptyPollCount: 0,
      consecutiveEmptyPolls: 0,
      lastPayloadBytes: 0,
      lastIpcMs: 0,
      lastDecodeMs: 0,
      previewFps: 0,
      recentWindowFps: 0,
      effectiveFps: 0,
      previewWidth: null,
      previewHeight: null,
      lastFrameAt: null,
      stallCount: 0,
      reconnectCount: 0,
      totalReconnectDowntimeMs: 0,
    },
    benchmark: createEmptyBenchmarkSnapshot(),
  };
};

/**
 * Frame source that receives Rust-decoded preview frames via Tauri IPC.
 *
 * The live preview path is intentionally optimized for low latency, while
 * single-frame high-quality extraction is delegated to a dedicated Camera2
 * still-capture path so export quality no longer depends on preview transport.
 */
export class TauriNativeFrameSource implements FrameSource {
  private config: ScannerConfig;
  private frameCallback: FrameCallback | null = null;
  private errorCallback: ErrorCallback | null = null;
  private readonly stateCallbacks = new Set<FrameSourceStateCallback>();
  private readonly benchmark: BenchmarkAccumulator = {
    startedAt: null,
    firstFrameAt: null,
    totalFrames: 0,
    totalPolls: 0,
    totalEmptyPolls: 0,
    lastFrameAt: null,
    ipcSamples: [],
    decodeSamples: [],
    payloadSamples: [],
    frameIntervalSamples: [],
    reconnectCount: 0,
    reconnectStartedAt: null,
    totalReconnectDowntimeMs: 0,
    lastReconnectDowntimeMs: null,
  };
  private state: FrameSourceState = createInitialState();
  private desiredRunning = false;
  private streamActive = false;
  private previewPauseDepth = 0;
  private previewPauseStartedAt: number | null = null;
  private forwardActive = false;
  private stillForwardActive = false;
  private serverRunning = false;
  private decoderRunning = false;
  private suppressUnexpectedEventsUntil = 0;
  private reconnectLoopPromise: Promise<void> | null = null;
  private watchdogTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private decoderStreamHandle: TauriDecodeStreamHandle | null = null;
  private lastStateEmitAt = 0;
  private recoveryErrorReported = false;
  private streamStartedAt: number | null = null;
  private decodeTargetRgba: Uint8ClampedArray | null = null;
  private stillLocalPort: number;

  constructor(config: ScannerConfig) {
    this.config = config;
    this.stillLocalPort = buildStillForwardPreferredPort(config.localPort);
  }

  onFrame(callback: FrameCallback): void {
    this.frameCallback = callback;
  }

  onError(callback: ErrorCallback): void {
    this.errorCallback = callback;
  }

  onStateChange(callback: FrameSourceStateCallback): () => void {
    this.stateCallbacks.add(callback);
    callback(this.getState());
    return () => {
      this.stateCallbacks.delete(callback);
    };
  }

  getState(): FrameSourceState {
    return {
      ...this.state,
      capabilities: { ...this.state.capabilities },
      metrics: { ...this.state.metrics },
      benchmark: this.getBenchmarkSnapshot(),
    };
  }

  getBenchmarkSnapshot(): FrameSourceBenchmarkSnapshot {
    const snapshotMetrics = getBenchmarkMetrics(this.benchmark);

    return {
      collectedAt: nowMs(),
      startedAt: this.benchmark.startedAt,
      runtimeMs: snapshotMetrics.runtimeMs,
      status: this.state.status,
      targetPreviewFps: this.config.framerate,
      frameIndex: this.benchmark.totalFrames,
      totalFrames: this.benchmark.totalFrames,
      totalPolls: this.benchmark.totalPolls,
      emptyPolls: this.benchmark.totalEmptyPolls,
      previewFps: snapshotMetrics.previewFps,
      recentWindowFps: snapshotMetrics.recentWindowFps,
      effectiveFps: snapshotMetrics.effectiveFps,
      latestPayloadBytes: this.state.metrics.lastPayloadBytes,
      latestIpcMs: this.state.metrics.lastIpcMs,
      latestDecodeMs: this.state.metrics.lastDecodeMs,
      previewResolution: {
        width: this.state.metrics.previewWidth,
        height: this.state.metrics.previewHeight,
      },
      recentError: this.state.lastError,
      frameIntervalMs: summarizeSamples(this.benchmark.frameIntervalSamples),
      ipcMs: summarizeSamples(this.benchmark.ipcSamples),
      decodeMs: summarizeSamples(this.benchmark.decodeSamples),
      payloadBytes: summarizeSamples(this.benchmark.payloadSamples),
      reconnect: {
        count: this.benchmark.reconnectCount,
        inProgress: this.benchmark.reconnectStartedAt !== null,
        attempt: this.state.reconnectAttempt,
        totalDowntimeMs: this.benchmark.totalReconnectDowntimeMs,
        lastDowntimeMs: this.benchmark.lastReconnectDowntimeMs,
      },
    };
  }

  async captureStillFrame(): Promise<ScannerStillCapture> {
    const capturedAt = nowMs();
    this.pausePreviewDelivery();
    try {
      let stillPayload = null;
      if (!this.stillForwardActive) {
        try {
          await this.ensureStillForward();
        } catch (error) {
          console.warn("[Scanner][StillPerf] Failed to establish still-stream forward, falling back:", error);
        }
      }

      if (this.stillForwardActive) {
        try {
          stillPayload = await captureTauriAdbStillStream(this.stillLocalPort);
        } catch (error) {
          await this.invalidateStillForward();
          console.warn("[Scanner][StillPerf] Forwarded still-stream capture failed, falling back:", error);
        }
      }

      if (!stillPayload) {
        stillPayload = await captureTauriAdbStill(
          this.config.serial,
          this.config.remoteJarPath,
          getStillCaptureSocketName(this.config.socketName),
        );
      }
      const stillBytes = stillPayload.mimeType === "image/jpeg"
        ? extractJpegPayload(stillPayload.bytes)
        : stillPayload.bytes;
      const dimensions = stillPayload.mimeType === "image/jpeg"
        ? readJpegDimensions(stillBytes)
        : null;
      const previewWidth = this.state.metrics.previewWidth;
      const previewHeight = this.state.metrics.previewHeight;

      if (looksLikePreviewSizedStillCapture(
        previewWidth,
        previewHeight,
        dimensions?.width ?? null,
        dimensions?.height ?? null,
      )) {
        const downgradeReason =
          `High-quality still capture downgraded to preview-sized legacy fallback `
          + `(${dimensions?.width ?? 0}x${dimensions?.height ?? 0} vs preview ${previewWidth ?? 0}x${previewHeight ?? 0}).`;
        this.markHighQualityStillCaptureUnavailable(downgradeReason);
        throw new Error(downgradeReason);
      }

      console.info(
        `[Scanner][StillDiag] Captured high-quality still payload: ${formatStillPayloadDiagnostics({
          serial: this.config.serial,
          transport: stillPayload.transport,
          raw: describeStillPayloadDiagnostics(stillPayload.bytes, stillPayload.mimeType),
          extracted: describeStillPayloadDiagnostics(stillBytes, stillPayload.mimeType),
          extractionTrimmedBytes: stillPayload.bytes.byteLength - stillBytes.byteLength,
          previewDimensions: {
            width: this.state.metrics.previewWidth,
            height: this.state.metrics.previewHeight,
          },
          capturedAt,
        })}`,
      );

      return {
        file: buildStillCaptureFile(stillBytes, stillPayload.mimeType),
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        capturedAt,
        source: "tauri-camera-still",
        serial: this.config.serial,
        previewWidth: this.state.metrics.previewWidth,
        previewHeight: this.state.metrics.previewHeight,
        transport: stillPayload.transport,
      };
    } finally {
      this.resumePreviewDelivery();
    }
  }

  async start(): Promise<void> {
    if (this.desiredRunning) {
      return;
    }

    this.desiredRunning = true;
    this.recoveryErrorReported = false;
    this.resetRuntimeMetrics();
    try {
      await this.ensureStreaming("manual-start");
    } catch (error) {
      this.desiredRunning = false;
      this.streamActive = false;
      this.clearTimers();
      await this.cleanupTransport({
        stopDecoder: true,
        stopServer: true,
        removeForward: true,
      });
      this.reconnectLoopPromise = null;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.desiredRunning && !this.streamActive) {
      return;
    }

    this.desiredRunning = false;
    this.streamActive = false;
    this.suppressUnexpectedEvents(800);
    this.clearTimers();
    this.updateState(
      {
        status: "stopping",
        stopReason: "manual-stop",
        nextReconnectDelayMs: null,
        reconnectAttempt: 0,
      },
      true,
    );

    await this.cleanupTransport({
      stopDecoder: true,
      stopServer: true,
      removeForward: true,
    });
    this.reconnectLoopPromise = null;
    this.updateState(
      {
        status: "stopped",
        stopReason: "manual-stop",
        nextReconnectDelayMs: null,
        reconnectAttempt: 0,
      },
      true,
    );
  }

  private async handleDecoderLifecycleEvent(event: DecoderLifecycleEvent): Promise<void> {
    if (!this.desiredRunning) {
      return;
    }

    switch (event.state) {
      case "reconnecting":
        this.markReconnectStarted();
        this.suppressUnexpectedEvents(RECOVERY_EVENT_SUPPRESSION_MS);
        this.updateState(
          {
            status: "reconnecting",
            lastError: event.detail,
            stopReason: "decoder-reconnecting",
            reconnectAttempt: Math.max(1, event.reconnectAttempt, this.state.reconnectAttempt),
            nextReconnectDelayMs: null,
          },
          true,
        );
        return;
      case "connected":
        this.suppressUnexpectedEvents(RECOVERY_EVENT_SUPPRESSION_MS);
        return;
      case "ready":
        this.activateReadyStream();
        return;
      case "error":
      case "stopped":
        await this.handleUnexpectedStop(event.detail, `decoder-${event.state}`);
        return;
      default:
        return;
    }
  }

  private createServerArgs(): string[] {
    return [
      "--socket", this.config.socketName,
      "--still-socket", getStillCaptureSocketName(this.config.socketName),
      "--still-stream-socket", getStillStreamSocketName(this.config.socketName),
      "--width", String(this.config.width),
      "--height", String(this.config.height),
      "--bitrate", String(this.config.bitrate),
      "--fps", String(this.config.framerate),
      "--camera", this.config.cameraId,
    ];
  }

  private async ensureServerJarDeployed(): Promise<void> {
    await pushTauriAdbFile(
      this.config.serial,
      this.config.serverJarPath,
      this.config.remoteJarPath,
    );
  }

  private async ensureForward(): Promise<void> {
    if (this.forwardActive) {
      return;
    }

    const preferredPort = this.config.localPort;
    const candidates = buildForwardPortCandidates(preferredPort);
    let bindFailureSeen = false;
    let lastError: unknown = null;

    for (const candidatePort of candidates) {
      try {
        await forwardTauriAdbPort(
          this.config.serial,
          candidatePort,
          this.config.socketName,
        );
        this.config.localPort = candidatePort;
        this.forwardActive = true;

        if (bindFailureSeen && candidatePort !== preferredPort) {
          console.warn(
            `[Scanner] Preferred local forward port ${preferredPort} was unavailable; switched preview transport to ${candidatePort}.`,
          );
        }
        return;
      } catch (error) {
        lastError = error;
        if (!isLocalForwardBindError(error) || candidatePort === candidates[candidates.length - 1]) {
          throw error;
        }
        bindFailureSeen = true;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(toErrorMessage(lastError));
  }

  private async ensureStillForward(): Promise<void> {
    if (this.stillForwardActive) {
      return;
    }

    const preferredPort = this.stillLocalPort;
    const candidates = buildForwardPortCandidates(preferredPort);
    let bindFailureSeen = false;
    let lastError: unknown = null;

    for (const candidatePort of candidates) {
      try {
        await forwardTauriAdbPort(
          this.config.serial,
          candidatePort,
          getStillStreamSocketName(this.config.socketName),
        );
        this.stillLocalPort = candidatePort;
        this.stillForwardActive = true;

        if (bindFailureSeen && candidatePort !== preferredPort) {
          console.warn(
            `[Scanner] Preferred local still-stream forward port ${preferredPort} was unavailable; switched still transport to ${candidatePort}.`,
          );
        }
        return;
      } catch (error) {
        lastError = error;
        if (!isLocalForwardBindError(error) || candidatePort === candidates[candidates.length - 1]) {
          throw error;
        }
        bindFailureSeen = true;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(toErrorMessage(lastError));
  }

  private async ensureStillForwardBestEffort(): Promise<void> {
    try {
      await this.ensureStillForward();
    } catch (error) {
      this.stillForwardActive = false;
      console.warn(
        "[Scanner] Still-stream forward is unavailable; continuing with one-shot still fallback.",
        error,
      );
    }
  }

  private async invalidateStillForward(): Promise<void> {
    const stillLocalPort = this.stillLocalPort;
    this.stillForwardActive = false;

    try {
      await removeForwardTauriAdbPort(this.config.serial, stillLocalPort);
    } catch {
      // Ignore stale forward cleanup failures so still capture can fall back immediately.
    }
  }

  private async ensureServerRunning(): Promise<void> {
    if (this.serverRunning) {
      return;
    }

    await this.ensureServerJarDeployed();
    await startTauriAdbServer(
      this.config.serial,
      this.config.remoteJarPath,
      SERVER_MAIN_CLASS,
      this.createServerArgs(),
    );
    this.serverRunning = true;
  }

  private async ensureDecodeStream(forceRestart: boolean = false): Promise<void> {
    if (forceRestart) {
      this.suppressUnexpectedEvents(RECOVERY_EVENT_SUPPRESSION_MS);
      await this.stopDecodeStream();
      await sleep(DECODE_RESTART_DELAY_MS);
    }

    if (this.decoderRunning && this.decoderStreamHandle) {
      return;
    }

    this.decoderStreamHandle = await startTauriDecodeStream(
      this.config.localPort,
      (framePacket) => {
        void this.handleStreamPacket(framePacket);
      },
      (event) => {
        void this.handleDecoderLifecycleEvent(event);
      },
    );
    this.decoderRunning = true;
  }

  private releaseDecodeStreamHandle(): void {
    this.decoderStreamHandle?.dispose();
    this.decoderStreamHandle = null;
  }

  private activateReadyStream(): void {
    if (!this.desiredRunning) {
      return;
    }

    const shouldRefreshStreamingState = !this.streamActive
      || this.state.status !== "streaming"
      || this.benchmark.reconnectStartedAt !== null;

    if (!shouldRefreshStreamingState) {
      return;
    }

    this.decoderRunning = true;
    this.recoveryErrorReported = false;
    this.finishReconnectDowntime();
    this.suppressUnexpectedEvents(RECOVERY_EVENT_SUPPRESSION_MS);

    if (!this.streamActive) {
      this.streamStartedAt = nowMs();
      this.state.metrics.lastFrameAt = null;
      this.state.metrics.consecutiveEmptyPolls = 0;
      this.clearTimers();
      this.streamActive = true;
      this.startWatchdog();
    }

    this.updateState(
      {
        status: "streaming",
        stopReason: null,
        lastError: null,
        nextReconnectDelayMs: null,
        reconnectAttempt: 0,
      },
      true,
    );
  }

  private async performRecovery(mode: RecoveryMode): Promise<void> {
    this.suppressUnexpectedEvents(RECOVERY_EVENT_SUPPRESSION_MS);

    switch (mode) {
      case "decode-restart":
        await this.ensureDecodeStream(true);
        return;
      case "forward-restart":
        await this.stopDecodeStream();
        await this.cleanupTransport({
          stopDecoder: false,
          stopServer: false,
          removeForward: true,
        });
        await this.ensureForward();
        await this.ensureStillForwardBestEffort();
        await this.ensureDecodeStream();
        return;
      case "server-restart":
        await this.stopDecodeStream();
        await this.cleanupTransport({
          stopDecoder: false,
          stopServer: true,
          removeForward: false,
        });
        await this.ensureForward();
        await this.ensureServerRunning();
        await this.ensureDecodeStream();
        return;
      case "cold-start":
      default:
        await this.ensureForward();
        await this.ensureStillForwardBestEffort();
        await this.ensureServerRunning();
        await this.ensureDecodeStream();
        return;
    }
  }

  private async ensureStreaming(reason: string): Promise<void> {
    if (this.reconnectLoopPromise) {
      await this.reconnectLoopPromise;
      return;
    }

    this.reconnectLoopPromise = this.connectionLoop(reason).finally(() => {
      this.reconnectLoopPromise = null;
    });
    await this.reconnectLoopPromise;
  }

  private async connectionLoop(reason: string): Promise<void> {
    while (this.desiredRunning) {
      const attempt = this.state.reconnectAttempt;
      const reconnectDelayMs = computeReconnectDelay(attempt);
      const nextStatus: FrameSourceStatus = attempt === 0 ? "starting" : "reconnecting";
      const recoveryMode = selectRecoveryMode(
        reason,
        attempt,
        this.benchmark.totalFrames > 0,
      );

      this.updateState(
        {
          status: nextStatus,
          stopReason: reason,
          nextReconnectDelayMs: reconnectDelayMs > 0 ? reconnectDelayMs : null,
        },
        true,
      );

      if (reconnectDelayMs > 0) {
        await sleep(reconnectDelayMs);
        if (!this.desiredRunning) {
          return;
        }
      }

      this.suppressUnexpectedEvents(RECOVERY_EVENT_SUPPRESSION_MS);
      if (!this.desiredRunning) {
        return;
      }

      try {
        await this.performRecovery(recoveryMode);
        return;
      } catch (error) {
        const message = toErrorMessage(error);
        const nextAttempt = attempt + 1;

        this.markReconnectStarted();
        this.state.reconnectAttempt = nextAttempt;
        this.streamActive = false;
        this.decoderRunning = false;
        this.releaseDecodeStreamHandle();
        this.updateState(
          {
            status: "reconnecting",
            lastError: message,
            stopReason: reason,
            reconnectAttempt: nextAttempt,
            nextReconnectDelayMs: computeReconnectDelay(nextAttempt),
          },
          true,
        );
        if (recoveryMode === "forward-restart") {
          this.serverRunning = false;
        }
        this.emitRecoverableError(message);
      }
    }
  }

  private async handleStreamPacket(framePacket: ArrayBuffer | Uint8Array): Promise<void> {
    if (!this.desiredRunning) {
      return;
    }

    const packetByteLength = framePacket.byteLength;
    if (packetByteLength <= FRAME_PACKET_HEADER_SIZE) {
      return;
    }

    try {
      this.activateReadyStream();
      if (this.previewPauseDepth > 0) {
        this.benchmark.totalPolls += 1;
        this.state.metrics.pollCount = this.benchmark.totalPolls;
        this.state.metrics.emptyPollCount = this.benchmark.totalEmptyPolls;
        return;
      }

      const receivedAtEpochMs = nowEpochMs();
      const decodeStart = nowMs();
      const { width, height, rgba, telemetry } = decodeFramePacketToRgba(
        framePacket,
        this.decodeTargetRgba ?? undefined,
      );
      this.decodeTargetRgba = rgba;
      const decodeMs = nowMs() - decodeStart;
      const payloadBytes = packetByteLength - FRAME_PACKET_HEADER_SIZE - (telemetry ? FRAME_PACKET_TELEMETRY_SIZE : 0);
      const ipcMs = telemetry
        ? Math.max(0, receivedAtEpochMs - telemetry.sentAtEpochMs)
        : 0;

      this.benchmark.totalPolls += 1;
      this.state.metrics.pollCount = this.benchmark.totalPolls;
      this.state.metrics.emptyPollCount = this.benchmark.totalEmptyPolls;

      this.handlePreviewFrame(
        new ImageData(rgba, width, height),
        width,
        height,
        payloadBytes,
        ipcMs,
        decodeMs,
      );
    } catch (error) {
      const message = `Preview frame delivery failed: ${toErrorMessage(error)}`;
      this.markReconnectStarted();
      this.emitRecoverableError(message);
      await this.handleUnexpectedStop(message, "stream-packet-error");
    }
  }

  private pausePreviewDelivery(): void {
    this.previewPauseDepth += 1;
    if (this.previewPauseDepth === 1) {
      this.previewPauseStartedAt = nowMs();
      this.clearWatchdog();
    }
  }

  private markHighQualityStillCaptureUnavailable(reason: string): void {
    if (!this.state.capabilities.highQualityStillCapture) {
      return;
    }

    this.state.capabilities = {
      ...this.state.capabilities,
      highQualityStillCapture: false,
    };
    console.warn(`[Scanner][StillDiag] ${reason}`);
    this.emitState(true);
  }

  private resumePreviewDelivery(): void {
    if (this.previewPauseDepth === 0) {
      return;
    }

    this.previewPauseDepth -= 1;
    if (this.previewPauseDepth === 0 && this.desiredRunning && this.streamActive) {
      this.refreshWatchdogReferenceAfterPreviewPause();
      this.startWatchdog();
    }
  }

  private refreshWatchdogReferenceAfterPreviewPause(): void {
    const pauseStartedAt = this.previewPauseStartedAt;
    if (pauseStartedAt === null) {
      return;
    }

    const resumedAt = nowMs();
    this.streamStartedAt = resumedAt;
    if (this.benchmark.totalFrames > 0) {
      this.benchmark.lastFrameAt = resumedAt;
      this.state.metrics.lastFrameAt = resumedAt;
    } else {
      this.benchmark.lastFrameAt = null;
      this.state.metrics.lastFrameAt = null;
    }
    this.state.metrics.consecutiveEmptyPolls = 0;
    this.previewPauseStartedAt = null;
    const pauseDurationMs = Math.max(0, resumedAt - pauseStartedAt);
    this.suppressUnexpectedEvents(
      Math.max(
        computeWatchdogThresholdMs(this.state.metrics.lastFrameAt, this.config.framerate),
        Math.min(STARTUP_FRAME_GRACE_MS, pauseDurationMs),
      ),
    );
  }

  private startWatchdog(): void {
    this.clearWatchdog();

    const tick = async (): Promise<void> => {
      if (!this.desiredRunning || !this.streamActive) {
        return;
      }

      const currentTime = nowMs();
      const referenceTime = this.state.metrics.lastFrameAt ?? this.streamStartedAt;
      const thresholdMs = computeWatchdogThresholdMs(
        this.state.metrics.lastFrameAt,
        this.config.framerate,
      );

      if (referenceTime !== null && currentTime - referenceTime > thresholdMs) {
        this.state.metrics.stallCount += 1;
        this.markReconnectStarted();
        await this.handleUnexpectedStop(
          `Preview stream stalled for ${Math.round(currentTime - referenceTime)}ms.`,
          "watchdog-stall",
        );
        return;
      }

      this.watchdogTimeoutId = setTimeout(() => {
        void tick();
      }, WATCHDOG_INTERVAL_MS);
    };

    this.watchdogTimeoutId = setTimeout(() => {
      void tick();
    }, WATCHDOG_INTERVAL_MS);
  }

  private handlePreviewFrame(
    frame: ImageData,
    width: number,
    height: number,
    payloadBytes: number,
    ipcMs: number,
    decodeMs: number,
  ): void {
    const timestamp = nowMs();
    const previousFrameAt = this.benchmark.lastFrameAt;

    this.benchmark.totalFrames += 1;
    this.benchmark.lastFrameAt = timestamp;
    markBenchmarkFirstFrame(this.benchmark, timestamp);
    pushWindowSample(this.benchmark.ipcSamples, ipcMs);
    pushWindowSample(this.benchmark.decodeSamples, decodeMs);
    pushWindowSample(this.benchmark.payloadSamples, payloadBytes);

    if (previousFrameAt !== null) {
      pushBenchmarkFrameInterval(this.benchmark, timestamp, previousFrameAt);
    }

    this.state.metrics.frameCount = this.benchmark.totalFrames;
    this.state.metrics.consecutiveEmptyPolls = 0;
    setLastPayloadMetric(this.state.metrics, payloadBytes);
    setLastIpcMetric(this.state.metrics, ipcMs);
    setLastDecodeMetric(this.state.metrics, decodeMs);
    this.state.metrics.previewWidth = width;
    this.state.metrics.previewHeight = height;
    this.state.metrics.lastFrameAt = timestamp;

    this.updateMetricsFromBenchmark();
    this.emitState(false);
    this.frameCallback?.(frame);
  }

  private async handleUnexpectedStop(
    reason: string,
    stopReason: string,
  ): Promise<void> {
    if (!this.desiredRunning) {
      return;
    }

    if (nowMs() < this.suppressUnexpectedEventsUntil) {
      return;
    }

    this.streamActive = false;
    this.decoderRunning = false;
    this.releaseDecodeStreamHandle();
    this.clearTimers();
    this.markReconnectStarted();
    this.emitRecoverableError(reason);

    if (this.reconnectLoopPromise) {
      return;
    }

    this.state.reconnectAttempt = Math.max(1, this.state.reconnectAttempt || 1);
    this.updateState(
      {
        status: "reconnecting",
        lastError: reason,
        stopReason,
        reconnectAttempt: this.state.reconnectAttempt,
        nextReconnectDelayMs: computeReconnectDelay(this.state.reconnectAttempt),
      },
      true,
    );

    await this.ensureStreaming(stopReason);
  }

  private updateMetricsFromBenchmark(): void {
    const snapshot = this.getBenchmarkSnapshot();
    this.state.metrics.targetPreviewFps = snapshot.targetPreviewFps;
    this.state.metrics.frameIndex = snapshot.frameIndex;
    applyUiMetrics(this.benchmark, this.state.metrics);
    this.state.metrics.reconnectCount = snapshot.reconnect.count;
    this.state.metrics.totalReconnectDowntimeMs = snapshot.reconnect.totalDowntimeMs;
    this.state.metrics.pollCount = this.benchmark.totalPolls;
    this.state.metrics.emptyPollCount = this.benchmark.totalEmptyPolls;
    this.state.benchmark = snapshot;
  }

  private updateState(
    partial: Partial<Omit<FrameSourceState, "capabilities" | "metrics" | "benchmark">> & {
      reconnectAttempt?: number;
    },
    forceEmit: boolean,
  ): void {
    if (partial.status) {
      this.state.status = partial.status;
    }
    if (partial.lastError !== undefined) {
      this.state.lastError = partial.lastError;
    }
    if (partial.stopReason !== undefined) {
      this.state.stopReason = partial.stopReason;
    }
    if (partial.nextReconnectDelayMs !== undefined) {
      this.state.nextReconnectDelayMs = partial.nextReconnectDelayMs;
    }
    if (partial.reconnectAttempt !== undefined) {
      this.state.reconnectAttempt = partial.reconnectAttempt;
    }

    this.state.statusUpdatedAt = nowMs();
    this.updateMetricsFromBenchmark();
    this.emitState(forceEmit);
  }

  private emitState(force: boolean): void {
    const currentTime = nowMs();
    if (!force && currentTime - this.lastStateEmitAt < BENCHMARK_EMIT_INTERVAL_MS) {
      return;
    }

    this.lastStateEmitAt = currentTime;
    const snapshot = this.getState();
    for (const callback of this.stateCallbacks) {
      callback(snapshot);
    }
  }

  private emitRecoverableError(message: string): void {
    if (this.recoveryErrorReported) {
      return;
    }

    this.recoveryErrorReported = true;
    this.errorCallback?.(message);
  }

  private suppressUnexpectedEvents(windowMs: number): void {
    this.suppressUnexpectedEventsUntil = Math.max(
      this.suppressUnexpectedEventsUntil,
      nowMs() + windowMs,
    );
  }

  private markReconnectStarted(): void {
    if (this.benchmark.reconnectStartedAt !== null) {
      return;
    }

    this.benchmark.reconnectCount += 1;
    this.benchmark.reconnectStartedAt = nowMs();
  }

  private finishReconnectDowntime(): void {
    if (this.benchmark.reconnectStartedAt === null) {
      return;
    }

    const downtimeMs = Math.max(0, nowMs() - this.benchmark.reconnectStartedAt);
    this.benchmark.totalReconnectDowntimeMs += downtimeMs;
    this.benchmark.lastReconnectDowntimeMs = downtimeMs;
    this.benchmark.reconnectStartedAt = null;
  }

  private clearTimers(): void {
    this.clearWatchdog();
  }

  private clearWatchdog(): void {
    if (this.watchdogTimeoutId) {
      clearTimeout(this.watchdogTimeoutId);
      this.watchdogTimeoutId = null;
    }
  }

  private async stopDecodeStream(): Promise<void> {
    this.streamActive = false;
    this.decoderRunning = false;
    this.releaseDecodeStreamHandle();
    this.suppressUnexpectedEvents(RECOVERY_EVENT_SUPPRESSION_MS);

    try {
      await stopTauriDecodeStream();
    } catch {
      // Ignore decoder shutdown errors so recovery can proceed.
    }
  }

  private async cleanupTransport(options: CleanupTransportOptions): Promise<void> {
    const { serial, remoteJarPath, localPort } = this.config;
    const stillLocalPort = this.stillLocalPort;
    this.streamActive = false;
    this.clearTimers();
    this.suppressUnexpectedEvents(RECOVERY_EVENT_SUPPRESSION_MS);

    if (options.stopDecoder) {
      await this.stopDecodeStream();
    }

    if (options.stopServer) {
      try {
        await stopTauriAdbServer(serial, remoteJarPath);
      } catch {
        // Ignore server shutdown errors so recovery can proceed.
      }
      this.serverRunning = false;
    }

    if (options.removeForward) {
      try {
        await removeForwardTauriAdbPort(serial, localPort);
      } catch {
        // Ignore forward removal errors so recovery can proceed.
      }
      this.forwardActive = false;
      try {
        await removeForwardTauriAdbPort(serial, stillLocalPort);
      } catch {
        // Ignore still forward removal errors so recovery can proceed.
      }
      this.stillForwardActive = false;
    }
  }

  private resetRuntimeMetrics(): void {
    this.state = createInitialState();
    this.state.capabilities = { ...DEFAULT_CAPABILITIES };
    this.benchmark.startedAt = nowMs();
    resetFirstFrameAt(this.benchmark);
    this.benchmark.totalFrames = 0;
    this.benchmark.totalPolls = 0;
    this.benchmark.totalEmptyPolls = 0;
    this.benchmark.lastFrameAt = null;
    this.benchmark.ipcSamples = [];
    this.benchmark.decodeSamples = [];
    this.benchmark.payloadSamples = [];
    this.benchmark.frameIntervalSamples = [];
    this.benchmark.reconnectCount = 0;
    this.benchmark.reconnectStartedAt = null;
    this.benchmark.totalReconnectDowntimeMs = 0;
    this.benchmark.lastReconnectDowntimeMs = null;
    this.lastStateEmitAt = 0;
    this.streamStartedAt = null;
    this.previewPauseStartedAt = null;
    this.decodeTargetRgba = null;
    this.releaseDecodeStreamHandle();
    this.streamActive = false;
    this.forwardActive = false;
    this.serverRunning = false;
    this.decoderRunning = false;
    this.state.benchmark = this.getBenchmarkSnapshot();
  }
}

/**
 * Create the appropriate frame source for the current platform.
 */
export const createFrameSource = (config: ScannerConfig): FrameSource => {
  if (isTauri()) {
    return new TauriNativeFrameSource(config);
  }

  throw new Error("WebCodecs frame source is not yet implemented for browser builds.");
};
