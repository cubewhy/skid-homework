"use client";

import {Activity, Gauge, Wifi} from "lucide-react";
import {useTranslation} from "react-i18next";

import {Badge} from "@/components/ui/badge";
import {useScannerStore} from "@/store/scanner-store";

const FPS_TARGET = 30;

const formatMetric = (value: number | null, suffix: string = ""): string => {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }

  return `${value.toFixed(1)}${suffix}`;
};

const getBenchmarkVariant = (
  value: number | null,
): "default" | "outline" | "destructive" => {
  if (value === null || Number.isNaN(value)) {
    return "outline";
  }

  return value >= FPS_TARGET ? "default" : "destructive";
};

const formatResolution = (width: number | null, height: number | null): string => {
  if (!width || !height) {
    return "—";
  }

  return `${width}×${height}`;
};

export function ScannerPreviewHud() {
  const { t } = useTranslation("commons", { keyPrefix: "document-scanner" });
  const previewDebug = useScannerStore((state) => state.previewDebug);
  const connectionDebug = useScannerStore((state) => state.connectionDebug);
  const benchmarkState =
    previewDebug.recentWindowFps !== null && previewDebug.recentWindowFps >= FPS_TARGET
      ? "pass"
      : previewDebug.recentWindowFps === null
        ? "pending"
        : "fail";

  return (
    <div className="absolute left-2 top-2 z-20 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1.5 rounded-md border border-white/15 bg-black/65 p-1.5 text-[11px] text-white shadow-lg backdrop-blur-sm sm:gap-2 sm:rounded-lg sm:p-2 sm:text-xs">
      <Badge variant={getBenchmarkVariant(previewDebug.recentWindowFps)} className="shrink-0">
        <Gauge className="h-3 w-3" />
        {t(`preview-hud.state.${benchmarkState}`)} {t("preview-hud.target", { fps: FPS_TARGET })}
      </Badge>
      <Badge variant="outline" className="border-white/20 text-white">
        <Activity className="h-3 w-3" />
        {t("preview-hud.metrics.now")} {formatMetric(previewDebug.previewFps)}
      </Badge>
      <Badge variant="outline" className="border-white/20 text-white">
        {t("preview-hud.metrics.window")} {formatMetric(previewDebug.recentWindowFps)}
      </Badge>
      <Badge variant="outline" className="hidden border-white/20 text-white sm:inline-flex">
        {t("preview-hud.metrics.effective")} {formatMetric(previewDebug.effectiveFps)}
      </Badge>
      <Badge variant="outline" className="hidden border-white/20 text-white md:inline-flex">
        {t("preview-hud.metrics.frame")} {previewDebug.frameIndex}
      </Badge>
      <Badge variant="outline" className="border-white/20 text-white">
        {t("preview-hud.metrics.resolution")} {formatResolution(previewDebug.previewWidth, previewDebug.previewHeight)}
      </Badge>
      <Badge variant="outline" className="border-white/20 text-white">
        <Wifi className="h-3 w-3" />
        {t(`debug.states.reconnect.${connectionDebug.reconnectState}`)}
      </Badge>
    </div>
  );
}
