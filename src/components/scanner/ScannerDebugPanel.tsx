"use client";

import {Activity, Cpu, RefreshCcw, TimerReset, TriangleAlert, Wifi,} from "lucide-react";

import {Badge} from "@/components/ui/badge";
import {Card, CardContent, CardDescription, CardHeader, CardTitle,} from "@/components/ui/card";
import {Separator} from "@/components/ui/separator";
import {useTranslation} from "react-i18next";
import {useScannerStore} from "@/store/scanner-store";

const CORNER_LABELS = ["TL", "TR", "BR", "BL"] as const;

const formatResolution = (
  width: number | null,
  height: number | null,
): string => {
  if (!width || !height) {
    return "—";
  }

  return `${width} × ${height}`;
};

const formatNumber = (
  value: number | null,
  fractionDigits: number = 1,
  suffix: string = "",
): string => {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }

  return `${value.toFixed(fractionDigits)}${suffix}`;
};

const formatPayload = (payloadBytes: number | null): string => {
  if (payloadBytes === null || Number.isNaN(payloadBytes)) {
    return "—";
  }

  return `${(payloadBytes / 1024).toFixed(1)} KB`;
};

const FPS_ACCEPTANCE_THRESHOLD = 30;

const getFpsBenchmarkState = (
  fps: number | null,
): {
  label: "pending" | "pass" | "fail";
  variant: "default" | "secondary" | "destructive" | "outline";
} => {
  if (fps === null || Number.isNaN(fps)) {
    return {
      label: "pending",
      variant: "outline",
    };
  }

  if (fps >= FPS_ACCEPTANCE_THRESHOLD) {
    return {
      label: "pass",
      variant: "default",
    };
  }

  return {
    label: "fail",
    variant: "destructive",
  };
};

const formatTimestamp = (timestamp: number | null): string => {
  if (!timestamp) {
    return "—";
  }

  return new Date(timestamp).toLocaleTimeString();
};

const getReconnectVariant = (state: string): "default" | "secondary" | "destructive" | "outline" => {
  switch (state) {
    case "connected":
      return "default";
    case "connecting":
    case "reconnecting":
      return "secondary";
    case "error":
      return "destructive";
    default:
      return "outline";
  }
};

interface MetricItemProps {
  label: string;
  value: string;
  hint?: string;
}

const MetricItem = ({ label, value, hint }: MetricItemProps) => {
  return (
    <div className="min-w-0 rounded-lg border bg-background/60 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold text-foreground">{value}</p>
      {hint ? (
        <p className="mt-1 break-words text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
};

const useScannerDebugModel = () => {
  const { t } = useTranslation("commons", { keyPrefix: "document-scanner" });
  const status = useScannerStore((state) => state.status);
  const errorMessage = useScannerStore((state) => state.errorMessage);
  const previewDebug = useScannerStore((state) => state.previewDebug);
  const cvDebug = useScannerStore((state) => state.cvDebug);
  const connectionDebug = useScannerStore((state) => state.connectionDebug);
  const currentFpsBenchmark = getFpsBenchmarkState(previewDebug.previewFps);
  const recentWindowBenchmark = getFpsBenchmarkState(previewDebug.recentWindowFps);
  const effectiveFpsBenchmark = getFpsBenchmarkState(previewDebug.effectiveFps);
  const translateStatusState = (value: string): string => {
    switch (value) {
      case "idle":
      case "connecting":
      case "streaming":
      case "error":
        return t(`debug.states.status.${value}`);
      default:
        return value;
    }
  };
  const translateReconnectState = (value: string): string => {
    switch (value) {
      case "connected":
      case "connecting":
      case "reconnecting":
      case "stopped":
      case "error":
      case "idle":
      case "starting":
      case "stopping":
        return t(`debug.states.reconnect.${value}`);
      default:
        return value;
    }
  };
  const translatePipelineState = (value: string): string => {
    switch (value) {
      case "idle":
      case "preview":
      case "single-hq":
        return t(`debug.states.pipeline.${value}`);
      default:
        return value;
    }
  };

  return {
    t,
    status,
    errorMessage,
    previewDebug,
    cvDebug,
    connectionDebug,
    currentFpsBenchmark,
    recentWindowBenchmark,
    effectiveFpsBenchmark,
    translateStatusState,
    translateReconnectState,
    translatePipelineState,
  };
};

export function ScannerPreviewDebugCard() {
  const {
    t,
    status,
    errorMessage,
    previewDebug,
    connectionDebug,
    currentFpsBenchmark,
    recentWindowBenchmark,
    effectiveFpsBenchmark,
    translateStatusState,
    translateReconnectState,
  } = useScannerDebugModel();

  return (
    <Card className="min-w-0 w-full gap-0">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          {t("debug.preview.title")}
        </CardTitle>
        <CardDescription>
          {t("debug.preview.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status === "streaming" ? "default" : "outline"}>
            {translateStatusState(status)}
          </Badge>
          <Badge variant={currentFpsBenchmark.variant}>
            {t("debug.badges.current", {
              state: t(`debug.badges.state.${currentFpsBenchmark.label}`),
              fps: FPS_ACCEPTANCE_THRESHOLD,
            })}
          </Badge>
          <Badge variant={recentWindowBenchmark.variant}>
            {t("debug.badges.window", {
              state: t(`debug.badges.state.${recentWindowBenchmark.label}`),
            })}
          </Badge>
          <Badge variant={effectiveFpsBenchmark.variant}>
            {t("debug.badges.effective", {
              state: t(`debug.badges.state.${effectiveFpsBenchmark.label}`),
            })}
          </Badge>
          <Badge variant={getReconnectVariant(connectionDebug.reconnectState)}>
            <Wifi className="h-3 w-3" />
            {translateReconnectState(connectionDebug.reconnectState)}
          </Badge>
          {previewDebug.transport ? (
            <Badge variant="secondary">{previewDebug.transport}</Badge>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          <MetricItem
            label={t("debug.metrics.current-fps.label")}
            value={formatNumber(previewDebug.previewFps, 1)}
            hint={t("debug.metrics.current-fps.hint")}
          />
          <MetricItem
            label={t("debug.metrics.window-fps.label")}
            value={formatNumber(previewDebug.recentWindowFps, 1)}
            hint={t("debug.metrics.window-fps.hint")}
          />
          <MetricItem
            label={t("debug.metrics.effective-fps.label")}
            value={formatNumber(previewDebug.effectiveFps, 1)}
            hint={t("debug.metrics.effective-fps.hint")}
          />
          <MetricItem
            label={t("debug.metrics.frame-index")}
            value={String(previewDebug.frameIndex)}
          />
          <MetricItem
            label={t("debug.metrics.preview-resolution")}
            value={formatResolution(
              previewDebug.previewWidth,
              previewDebug.previewHeight,
            )}
          />
          <MetricItem
            label={t("debug.metrics.payload-size")}
            value={formatPayload(previewDebug.payloadBytes)}
          />
          <MetricItem
            label={t("debug.metrics.poll-count")}
            value={
              previewDebug.pollCount === null
                ? "—"
                : String(previewDebug.pollCount)
            }
          />
          <MetricItem
            label={t("debug.metrics.poll-wait")}
            value={formatNumber(previewDebug.pollWaitMs, 1, " ms")}
          />
          <MetricItem
            label={t("debug.metrics.js-decode")}
            value={formatNumber(previewDebug.jsDecodeMs, 1, " ms")}
          />
          <MetricItem
            label={t("debug.metrics.canvas-draw")}
            value={formatNumber(previewDebug.canvasDrawMs, 1, " ms")}
          />
          <MetricItem
            label={t("debug.metrics.last-update")}
            value={formatTimestamp(previewDebug.updatedAt)}
          />
        </div>

        <Separator />

        <div className="grid gap-3 sm:grid-cols-2">
          <MetricItem
            label={t("debug.metrics.reconnect-status")}
            value={translateReconnectState(connectionDebug.reconnectState)}
            hint={
              connectionDebug.reconnectAttempt !== null
                ? t("debug.hints.reconnect-attempt", {
                  attempt: connectionDebug.reconnectAttempt,
                  max: connectionDebug.reconnectMaxAttempts ?? "—",
                })
                : connectionDebug.reconnectMessage ?? t("debug.hints.no-reconnect-attempt")
            }
          />
          <MetricItem
            label={t("debug.metrics.recent-error")}
            value={connectionDebug.lastErrorReason ?? errorMessage ?? "—"}
            hint={
              connectionDebug.lastDisconnectAt
                ? t("debug.hints.last-disconnect", {
                  time: formatTimestamp(connectionDebug.lastDisconnectAt),
                })
                : t("debug.hints.no-disconnect")
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function ScannerCvDebugCard() {
  const {
    t,
    cvDebug,
    translatePipelineState,
  } = useScannerDebugModel();

  return (
    <Card className="min-w-0 w-full gap-0">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4" />
          {t("debug.cv.title")}
        </CardTitle>
        <CardDescription>
          {t("debug.cv.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={cvDebug.cvReady ? "default" : "destructive"}>
            {cvDebug.cvReady ? t("debug.cv.badges.ready") : t("debug.cv.badges.unavailable")}
          </Badge>
          <Badge variant={cvDebug.documentDetected ? "default" : "outline"}>
            {cvDebug.documentDetected ? t("debug.cv.badges.document-detected") : t("debug.cv.badges.no-document")}
          </Badge>
          <Badge variant={cvDebug.isStable ? "default" : "outline"}>
            {cvDebug.isStable ? t("debug.cv.badges.stable") : t("debug.cv.badges.unstable")}
          </Badge>
          <Badge variant={cvDebug.isProcessing ? "secondary" : "outline"}>
            <RefreshCcw className="h-3 w-3" />
            {cvDebug.isProcessing ? t("debug.cv.badges.processing") : t("debug.cv.badges.idle")}
          </Badge>
          <Badge variant="secondary">
            <TimerReset className="h-3 w-3" />
            {translatePipelineState(cvDebug.pipeline)}
          </Badge>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <MetricItem
            label={t("debug.cv.metrics.corner-count")}
            value={String(cvDebug.cornerCount)}
          />
          <MetricItem
            label={t("debug.cv.metrics.processing-resolution")}
            value={formatResolution(
              cvDebug.processingWidth,
              cvDebug.processingHeight,
            )}
          />
          <MetricItem
            label={t("debug.cv.metrics.auto-capture")}
            value={cvDebug.autoCaptureEnabled ? t("debug.cv.metrics.enabled") : t("debug.cv.metrics.disabled")}
          />
          <MetricItem
            label={t("debug.cv.metrics.last-update")}
            value={formatTimestamp(cvDebug.updatedAt)}
          />
        </div>

        <Separator />

        {cvDebug.cornerPoints.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {cvDebug.cornerPoints.map((point, index) => (
              <MetricItem
                key={`${CORNER_LABELS[index] ?? index}-${point.x}-${point.y}`}
                label={t("debug.cv.metrics.corner-label", {
                  corner: CORNER_LABELS[index] ?? index + 1,
                })}
                value={`${Math.round(point.x)}, ${Math.round(point.y)}`}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {t("debug.cv.empty")}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ScannerDebugPanel() {
  return (
    <div className="flex min-w-0 w-full flex-col gap-4">
      <ScannerPreviewDebugCard />
      <ScannerCvDebugCard />
    </div>
  );
}
