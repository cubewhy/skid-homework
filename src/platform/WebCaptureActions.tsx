"use client";

import Image from "next/image";
import {MoreVertical} from "lucide-react";
import {useCallback, useEffect, useState} from "react";
import {useTranslation} from "react-i18next";
import type {PlatformCaptureActionsProps} from "./platform-types";
import {ShortcutHint} from "@/components/ShortcutHint";
import {Button} from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {useShortcut} from "@/hooks/use-shortcut";
import {useAdbCaptureActions} from "./use-adb-capture-actions";
import {UnsupportedEnvironmentError} from "./webadb/manager";
import {
  captureAdbScreenshot,
  isAdbDeviceConnected,
  reconnectAdbDevice,
} from "./webadb/screenshot";

export function WebCaptureActions({
  appendFiles,
  disabled,
  isCompact,
}: PlatformCaptureActionsProps): React.JSX.Element | null {
  const {t} = useTranslation("commons", {keyPrefix: "upload-area"});
  const [adbConnected, setAdbConnected] = useState(false);
  const {
    adbBusy,
    adbBusyMode,
    captureAdbScreenshot: captureWithAdbState,
    isDisabled,
    runAdbAction,
  } = useAdbCaptureActions({
    appendFiles,
    disabled,
    onUnsupportedEnvironment: (error) =>
      error instanceof UnsupportedEnvironmentError,
  });

  useEffect(() => {
    let cancelled = false;

    const updateAdbStatus = async () => {
      try {
        const connected = await isAdbDeviceConnected();
        if (!cancelled) {
          setAdbConnected(connected);
        }
      } catch (error) {
        console.error("ADB status check failed", error);
        if (!cancelled) {
          setAdbConnected(false);
        }
      }
    };

    const usb =
      typeof navigator !== "undefined" && "usb" in navigator
        ? (
            navigator as Navigator & {
              usb?: {
                addEventListener: typeof window.addEventListener;
                removeEventListener: typeof window.removeEventListener;
              };
            }
          ).usb
        : undefined;

    void updateAdbStatus();

    if (usb) {
      const handleUsbChange = () => {
        void updateAdbStatus();
      };

      usb.addEventListener("connect", handleUsbChange);
      usb.addEventListener("disconnect", handleUsbChange);

      return () => {
        cancelled = true;
        usb.removeEventListener("connect", handleUsbChange);
        usb.removeEventListener("disconnect", handleUsbChange);
      };
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const handleAdbReconnect = useCallback(async () => {
    await runAdbAction("connect", async () => {
      const ok = await reconnectAdbDevice();
      setAdbConnected(ok);
    });
  }, [runAdbAction]);

  const handleAdbBtnClicked = useCallback(async () => {
    if (isDisabled) return;

    if (!adbConnected) {
      await runAdbAction("connect", async () => {
        const ok = await reconnectAdbDevice();
        setAdbConnected(ok);
      });
      return;
    }

    await captureWithAdbState(captureAdbScreenshot);
  }, [
    adbConnected,
    captureWithAdbState,
    isDisabled,
    runAdbAction,
  ]);

  const adbScreenshotShortcut = useShortcut(
    "adbScreenshot",
    () => {
      void handleAdbBtnClicked();
    },
    [handleAdbBtnClicked],
  );

  if (isCompact) {
    return null;
  }

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        className="flex-1 items-center min-w-0 justify-between"
        size="default"
        disabled={isDisabled}
        onClick={() => void handleAdbBtnClicked()}
        title={t("adb.screenshot-hint")}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Image
            src="/icons/adb.svg"
            alt="ADB"
            width={18}
            height={18}
            className="h-4.5 w-4.5"
          />
          <span className="truncate">
            {adbBusy
              ? adbBusyMode === "capture"
                ? t("adb.screenshot-busy")
                : t("adb.connecting")
              : adbConnected
                ? t("adb.screenshot")
                : t("adb.connect")}
          </span>
        </span>
        <ShortcutHint shortcut={adbScreenshotShortcut} />
      </Button>
      {adbConnected && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="px-3"
              disabled={isDisabled}
              aria-label={t("adb.menu-aria-label")}
            >
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem onClick={() => void handleAdbReconnect()}>
              {t("adb.reconnect")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
