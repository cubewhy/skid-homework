/**
 * Unified frame source abstraction for the document scanner.
 *
 * Provides a consistent interface for receiving low-cost live preview frames,
 * capturing high-quality still images on demand, and recovering from transport
 * failures without forcing the UI layer to rebuild the full scanner pipeline.
 */

import {
  forwardTauriAdbPort,
  getTauriDecodedFrame,
  pushTauriAdbFile,
  removeForwardTauriAdbPort,
  startTauriAdbServer,
  startTauriDecodeStream,
  stopTauriAdbServer,
  stopTauriDecodeStream,
} from "@/lib/tauri/adb";
import {isTauri} from "@/lib/tauri/platform";
import {type AdbScreenshotCapture, captureAdbScreenshotWithMetadata,} from "@/lib/webadb/screenshot";

import {decodeFramePacketToRgba} from "./frame-codec.js";

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

export interface ScannerStillCapture extends AdbScreenshotCapture {
  previewWidth: number | null;
  previewHeight: number | null;
}

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
  framerate: 60,
  cameraId: "0",
};

const SERVER_MAIN_CLASS = "com.skidhomework.server.Server";
const SERVER_STARTUP_DELAY_MS = 600;
const DECODE_RESTART_DELAY_MS = 125;
const WATCHDOG_INTERVAL_MS = 1000;
const STARTUP_FRAME_GRACE_MS = 9000;
const MAX_EMPTY_POLL_DELAY_MS = 12;
const BENCHMARK_EMIT_INTERVAL_MS = 250;
const BENCHMARK_WINDOW_SIZE = 240;
const STEADY_STATE_FRAME_GAP_THRESHOLD_MS = 250;
const INITIAL_RECONNECT_DELAY_MS = 250;
const MAX_RECONNECT_DELAY_MS = 5000;
const RECONNECT_BACKOFF_MULTIPLIER = 1.6;
const FRAME_PACKET_HEADER_SIZE = 9;
const DECODE_RESTART_MAX_ATTEMPTS = 2;
const FORWARD_RESTART_MAX_ATTEMPTS = 3;
const RECOVERY_EVENT_SUPPRESSION_MS = 2500;
const STEADY_STATE_STALL_MIN_GRACE_MS = 4500;
const STEADY_STATE_STALL_FRAME_MULTIPLIER = 48;

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

const sleep = async (delayMs: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
};

const toErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
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
    if (sample > STEADY_STATE_FRAME_GAP_THRESHOLD_MS) {
      break;
    }

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

const computeReconnectDelay = (attempt: number): number => {
  if (attempt <= 0) {
    return 0;
  }

  const delay = INITIAL_RECONNECT_DELAY_MS * (RECONNECT_BACKOFF_MULTIPLIER ** (attempt - 1));
  return Math.round(Math.min(MAX_RECONNECT_DELAY_MS, delay));
};

const computeEmptyPollDelay = (
  intervalMs: number,
  consecutiveEmptyPolls: number,
): number => {
  const baseDelay = Math.max(4, Math.min(8, Math.round(intervalMs / 4)));
  const multiplier = Math.min(3, Math.max(0, consecutiveEmptyPolls - 1));
  return Math.min(MAX_EMPTY_POLL_DELAY_MS, baseDelay * (multiplier + 1));
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

const selectRecoveryMode = (stopReason: string, attempt: number): RecoveryMode => {
  if (attempt <= 0) {
    return "cold-start";
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
 * single-frame high-quality extraction is delegated to a separate ADB
 * screenshot path so capture quality no longer depends on preview transport.
 */
export class TauriNativeFrameSource implements FrameSource {
  private config: ScannerConfig;
  private frameCallback: FrameCallback | null = null;
  private errorCallback: ErrorCallback | null = null;
  private readonly stateCallbacks = new Set<FrameSourceStateCallback>();
  private readonly benchmark: BenchmarkAccumulator = {
    startedAt: null,
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
  private forwardActive = false;
  private serverRunning = false;
  private decoderRunning = false;
  private eventListenersReady = false;
  private suppressUnexpectedEventsUntil = 0;
  private reconnectLoopPromise: Promise<void> | null = null;
  private pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private cleanupListeners: (() => void) | null = null;
  private lastStateEmitAt = 0;
  private recoveryErrorReported = false;
  private streamStartedAt: number | null = null;

  constructor(config: ScannerConfig) {
    this.config = config;
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
    const runtimeMs = this.benchmark.startedAt === null
      ? 0
      : Math.max(0, nowMs() - this.benchmark.startedAt);
    const effectiveFps = runtimeMs > 0
      ? this.benchmark.totalFrames / (runtimeMs / 1000)
      : 0;
    const steadyStateIntervals = this.benchmark.frameIntervalSamples.filter(
      (sample) => sample <= STEADY_STATE_FRAME_GAP_THRESHOLD_MS,
    );
    const recentWindowFps = computeRecentWindowFps(steadyStateIntervals, 3000);
    const previewFps = computeRecentWindowFps(this.benchmark.frameIntervalSamples, 1000);

    return {
      collectedAt: nowMs(),
      startedAt: this.benchmark.startedAt,
      runtimeMs,
      status: this.state.status,
      targetPreviewFps: this.config.framerate,
      frameIndex: this.benchmark.totalFrames,
      totalFrames: this.benchmark.totalFrames,
      totalPolls: this.benchmark.totalPolls,
      emptyPolls: this.benchmark.totalEmptyPolls,
      previewFps,
      recentWindowFps,
      effectiveFps,
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
    const capture = await captureAdbScreenshotWithMetadata({
      preferredDesktopSerial: this.config.serial,
    });

    return {
      ...capture,
      previewWidth: this.state.metrics.previewWidth,
      previewHeight: this.state.metrics.previewHeight,
    };
  }

  async start(): Promise<void> {
    if (this.desiredRunning) {
      return;
    }

    this.desiredRunning = true;
    this.recoveryErrorReported = false;
    this.resetRuntimeMetrics();
    await this.ensureEventListeners();
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
      await this.disposeEventListeners();
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
    await this.disposeEventListeners();
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

  private async ensureEventListeners(): Promise<void> {
    if (this.eventListenersReady) {
      return;
    }

    const { listen } = await import("@tauri-apps/api/event");
    const unlistenError = await listen<string>("scanner:error", (event) => {
      void this.handleUnexpectedStop(event.payload, "scanner-error");
    });
    const unlistenStopped = await listen<void>("scanner:stopped", () => {
      void this.handleUnexpectedStop(
        this.state.lastError ?? "Preview stream stopped unexpectedly.",
        "scanner-stopped",
      );
    });

    this.cleanupListeners = () => {
      unlistenError();
      unlistenStopped();
    };
    this.eventListenersReady = true;
  }

  private async disposeEventListeners(): Promise<void> {
    if (this.cleanupListeners) {
      this.cleanupListeners();
      this.cleanupListeners = null;
    }
    this.eventListenersReady = false;
  }

  private createServerArgs(): string[] {
    return [
      "--socket", this.config.socketName,
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

    await forwardTauriAdbPort(
      this.config.serial,
      this.config.localPort,
      this.config.socketName,
    );
    this.forwardActive = true;
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

    if (this.decoderRunning) {
      this.streamActive = true;
      return;
    }

    await startTauriDecodeStream(this.config.localPort);
    this.decoderRunning = true;
    this.streamActive = true;
    this.streamStartedAt = nowMs();
    this.state.metrics.lastFrameAt = null;
    this.state.metrics.consecutiveEmptyPolls = 0;
    this.suppressUnexpectedEvents(RECOVERY_EVENT_SUPPRESSION_MS);
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
        await sleep(SERVER_STARTUP_DELAY_MS);
        await this.ensureDecodeStream();
        return;
      case "cold-start":
      default:
        await this.ensureForward();
        await this.ensureServerRunning();
        await sleep(SERVER_STARTUP_DELAY_MS);
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
      const recoveryMode = selectRecoveryMode(reason, attempt);

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
        this.state.reconnectAttempt = 0;
        this.recoveryErrorReported = false;
        this.finishReconnectDowntime();
        this.updateMetricsFromBenchmark();
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
        this.startPollLoop();
        this.startWatchdog();
        return;
      } catch (error) {
        const message = toErrorMessage(error);
        const nextAttempt = attempt + 1;

        this.markReconnectStarted();
        this.state.reconnectAttempt = nextAttempt;
        this.streamActive = false;
        this.decoderRunning = false;
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

  private startPollLoop(): void {
    this.clearPollLoop();

    const intervalMs = Math.max(1, Math.round(1000 / Math.max(1, this.config.framerate)));
    const poll = async (): Promise<void> => {
      if (!this.desiredRunning || !this.streamActive) {
        return;
      }

      const cycleStart = nowMs();
      let receivedFrame = false;

      try {
        const ipcStart = nowMs();
        const data = await getTauriDecodedFrame();
        const ipcMs = nowMs() - ipcStart;

        this.benchmark.totalPolls += 1;
        this.state.metrics.pollCount = this.benchmark.totalPolls;
        this.state.metrics.lastIpcMs = ipcMs;

        if (data.byteLength > FRAME_PACKET_HEADER_SIZE) {
          const decodeStart = nowMs();
          const { width, height, rgba } = decodeFramePacketToRgba(data);
          const decodeMs = nowMs() - decodeStart;
          const payloadBytes = data.byteLength - FRAME_PACKET_HEADER_SIZE;

          receivedFrame = true;
          this.handlePreviewFrame(
            new ImageData(rgba, width, height),
            width,
            height,
            payloadBytes,
            ipcMs,
            decodeMs,
          );
        } else {
          this.handleEmptyPoll();
        }
      } catch (error) {
        const message = `Preview polling failed: ${toErrorMessage(error)}`;
        this.markReconnectStarted();
        this.emitRecoverableError(message);
        await this.handleUnexpectedStop(message, "poll-error");
        return;
      }

      if (!this.desiredRunning || !this.streamActive) {
        return;
      }

      const cycleMs = nowMs() - cycleStart;
      const nextDelayMs = receivedFrame
        ? Math.max(0, intervalMs - cycleMs)
        : computeEmptyPollDelay(intervalMs, this.state.metrics.consecutiveEmptyPolls);

      this.pollTimeoutId = setTimeout(() => {
        void poll();
      }, nextDelayMs);
    };

    this.pollTimeoutId = setTimeout(() => {
      void poll();
    }, 0);
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
    pushWindowSample(this.benchmark.ipcSamples, ipcMs);
    pushWindowSample(this.benchmark.decodeSamples, decodeMs);
    pushWindowSample(this.benchmark.payloadSamples, payloadBytes);

    if (previousFrameAt !== null) {
      pushWindowSample(this.benchmark.frameIntervalSamples, timestamp - previousFrameAt);
    }

    this.state.metrics.frameCount = this.benchmark.totalFrames;
    this.state.metrics.consecutiveEmptyPolls = 0;
    this.state.metrics.lastPayloadBytes = payloadBytes;
    this.state.metrics.lastDecodeMs = decodeMs;
    this.state.metrics.previewWidth = width;
    this.state.metrics.previewHeight = height;
    this.state.metrics.lastFrameAt = timestamp;

    this.updateMetricsFromBenchmark();
    this.emitState(false);
    this.frameCallback?.(frame);
  }

  private handleEmptyPoll(): void {
    this.benchmark.totalEmptyPolls += 1;
    this.state.metrics.emptyPollCount = this.benchmark.totalEmptyPolls;
    this.state.metrics.consecutiveEmptyPolls += 1;
    this.updateMetricsFromBenchmark();
    this.emitState(false);
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
    this.state.metrics.previewFps = snapshot.previewFps;
    this.state.metrics.recentWindowFps = snapshot.recentWindowFps;
    this.state.metrics.effectiveFps = snapshot.effectiveFps;
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
    this.clearPollLoop();
    this.clearWatchdog();
  }

  private clearPollLoop(): void {
    if (this.pollTimeoutId) {
      clearTimeout(this.pollTimeoutId);
      this.pollTimeoutId = null;
    }
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
    this.suppressUnexpectedEvents(RECOVERY_EVENT_SUPPRESSION_MS);

    try {
      await stopTauriDecodeStream();
    } catch {
      // Ignore decoder shutdown errors so recovery can proceed.
    }
  }

  private async cleanupTransport(options: CleanupTransportOptions): Promise<void> {
    const { serial, remoteJarPath, localPort } = this.config;
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
    }
  }

  private resetRuntimeMetrics(): void {
    this.state = createInitialState();
    this.state.capabilities = { ...DEFAULT_CAPABILITIES };
    this.benchmark.startedAt = nowMs();
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
