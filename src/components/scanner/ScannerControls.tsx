"use client";

import {Camera, RotateCw, ScanLine, Square, Waves} from "lucide-react";
import {useTranslation} from "react-i18next";

import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardHeader, CardTitle,} from "@/components/ui/card";
import {Label} from "@/components/ui/label";
import {Separator} from "@/components/ui/separator";
import {Switch} from "@/components/ui/switch";

interface ScannerControlsProps {
  isConnecting: boolean;
  isStreaming: boolean;
  isProcessing: boolean;
  autoCapture: boolean;
  isStable: boolean;
  previewOrientation: "landscape" | "portrait";
  previewResolution: string;
  reconnectState: string;
  onAutoCaptureChange: (enabled: boolean) => void;
  onPreviewOrientationToggle: () => void;
  onStart: () => void;
  onStop: () => void;
  onPreviewCapture: () => void;
}

const getReconnectStateLabel = (
  reconnectState: string,
  t: (
    key:
      | "states.reconnect.connected"
      | "states.reconnect.connecting"
      | "states.reconnect.error"
      | "states.reconnect.idle"
      | "states.reconnect.reconnecting"
      | "states.reconnect.stopped",
  ) => string,
): string => {
  switch (reconnectState) {
    case "connected":
    case "connecting":
    case "error":
    case "idle":
    case "reconnecting":
    case "stopped":
      return t(`states.reconnect.${reconnectState}`);
    default:
      return reconnectState;
  }
};

export function ScannerControls({
  isConnecting,
  isStreaming,
  isProcessing,
  autoCapture,
  isStable,
  previewOrientation,
  previewResolution,
  reconnectState,
  onAutoCaptureChange,
  onPreviewOrientationToggle,
  onStart,
  onStop,
  onPreviewCapture,
}: ScannerControlsProps) {
  const { t } = useTranslation("commons", { keyPrefix: "document-scanner.controls" });
  const showStopAction = isConnecting || isStreaming;
  const previewOrientationLabel = previewOrientation === "landscape"
    ? t("actions.use-portrait" as never)
    : t("actions.use-landscape" as never);

  return (
    <Card className="min-w-0 gap-0">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Waves className="h-4 w-4" />
            {t("title")}
          </CardTitle>
          <Badge variant={isStreaming ? "default" : "outline"}>
            {isStreaming ? t("badges.live") : t("badges.stopped")}
          </Badge>
          <Badge variant={isStable ? "default" : "outline"}>
            {isStable ? t("badges.stable") : t("badges.unstable")}
          </Badge>
        </div>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2.5 md:grid-cols-2">
          <div className="min-w-0 rounded-lg border bg-background/60 p-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("metrics.preview-resolution")}
            </p>
            <p className="mt-1 break-words text-sm font-semibold">{previewResolution}</p>
          </div>
          <div className="min-w-0 rounded-lg border bg-background/60 p-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("metrics.reconnect-state")}
            </p>
            <p className="mt-1 break-words text-sm font-semibold">
              {getReconnectStateLabel(reconnectState, t)}
            </p>
          </div>
        </div>

        <div className={isStreaming ? "grid gap-2 sm:grid-cols-2 xl:grid-cols-3" : "grid gap-2 sm:grid-cols-2"}>
          <Button
            variant="outline"
            onClick={onPreviewOrientationToggle}
            className="w-full justify-center gap-2"
            disabled={isProcessing}
          >
            <RotateCw className="h-4 w-4" />
            {previewOrientationLabel}
          </Button>
          {!showStopAction ? (
            <Button
              onClick={onStart}
              disabled={isProcessing}
              className="w-full justify-center gap-2"
            >
              <Camera className="h-4 w-4" />
              {t("actions.start")}
            </Button>
          ) : (
            <>
              <Button
                variant="destructive"
                onClick={onStop}
                className="w-full justify-center gap-2"
                disabled={isProcessing}
              >
                <Square className="h-4 w-4" />
                {t("actions.stop")}
              </Button>
              <Button
                variant="outline"
                onClick={onPreviewCapture}
                className="w-full justify-center gap-2"
                disabled={isProcessing}
              >
                <ScanLine className="h-4 w-4" />
                {isProcessing ? t("actions.processing") : t("actions.capture")}
              </Button>
            </>
          )}
        </div>

        <Separator />

        <div className="flex items-start space-x-3 rounded-md border p-2.5 shadow-sm">
          <Switch
            id="auto-capture"
            checked={autoCapture}
            onCheckedChange={onAutoCaptureChange}
            disabled={!isStreaming || isProcessing}
          />
          <div className="min-w-0 space-y-1">
            <Label htmlFor="auto-capture" className="cursor-pointer text-sm font-medium">
              {t("auto-capture.label")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("auto-capture.description")}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
