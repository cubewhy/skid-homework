"use client";

import {useCallback, useState} from "react";
import {useTranslation} from "react-i18next";
import {toast} from "sonner";

import type {PlatformCaptureActionsProps} from "./platform-types";
import {TimeoutError, withTimeout} from "@/utils/timeout";

export type AdbBusyMode = "connect" | "capture";

type UseAdbCaptureActionsOptions = {
  appendFiles: PlatformCaptureActionsProps["appendFiles"];
  disabled: boolean;
  onUnsupportedEnvironment?: (error: unknown) => boolean;
};

export function useAdbCaptureActions({
  appendFiles,
  disabled,
  onUnsupportedEnvironment,
}: UseAdbCaptureActionsOptions) {
  const {t} = useTranslation("commons", {keyPrefix: "upload-area"});
  const [adbBusy, setAdbBusy] = useState(false);
  const [adbBusyMode, setAdbBusyMode] = useState<AdbBusyMode | null>(null);

  const isDisabled = disabled || adbBusy;

  const handleAdbError = useCallback(
    (error: unknown) => {
      if (onUnsupportedEnvironment?.(error)) {
        toast.error(t("toasts.webusb-not-supported"));
        return;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(t("toasts.adb-failed", {error: errorMessage}));
    },
    [onUnsupportedEnvironment, t],
  );

  const runAdbAction = useCallback(
    async (mode: AdbBusyMode, action: () => Promise<void>) => {
      if (isDisabled) return;

      try {
        setAdbBusy(true);
        setAdbBusyMode(mode);
        await action();
      } catch (error) {
        if (mode === "capture" && error instanceof TimeoutError) {
          toast.error(t("adb.capture-timeout"));
        } else {
          handleAdbError(error);
        }
      } finally {
        setAdbBusy(false);
        setAdbBusyMode(null);
      }
    },
    [handleAdbError, isDisabled, t],
  );

  const captureAdbScreenshot = useCallback(
    async (capture: () => Promise<File>) => {
      await runAdbAction("capture", async () => {
        const file = await withTimeout(capture(), 5_000);
        appendFiles([file], "adb");
      });
    },
    [appendFiles, runAdbAction],
  );

  return {
    adbBusy,
    adbBusyMode,
    captureAdbScreenshot,
    isDisabled,
    runAdbAction,
  };
}
