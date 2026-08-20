"use client";

import {MoreVertical} from "lucide-react";
import Image from "next/image";
import {useCallback, useEffect, useState} from "react";
import {useTranslation} from "react-i18next";
import {toast} from "sonner";

import type {PlatformCaptureActionsProps} from "../../../../src/platform/platform-types";
import {ShortcutHint} from "@/components/ShortcutHint";
import {Button} from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {useShortcut} from "@/hooks/use-shortcut";
import {useAdbCaptureActions} from "../../../../src/platform/use-adb-capture-actions";
import {AdbRemoteConnectDialog} from "./dialogs/AdbRemoteConnectDialog";
import {
  captureAdbScreenshot,
  connectRemoteAdbDevice,
  getSelectedDesktopAdbSerial,
  isAdbDeviceConnected,
  pairRemoteAdbDevice,
  selectDesktopAdbDevice,
} from "../lib/webadb/screenshot";
import {UnsupportedEnvironmentError} from "../lib/webadb/manager";

export function DesktopCaptureActions({
  appendFiles,
  disabled,
  isCompact,
}: PlatformCaptureActionsProps): React.JSX.Element | null {
  const {t} = useTranslation("commons", {keyPrefix: "upload-area"});
  const [adbConnected, setAdbConnected] = useState(false);
  const [adbRemoteDialogOpen, setAdbRemoteDialogOpen] = useState(false);
  const [selectedAdbSerial, setSelectedAdbSerial] = useState<string | null>(
    null,
  );
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

  const refreshAdbStatus = useCallback(async (): Promise<boolean> => {
    try {
      const connected = await isAdbDeviceConnected();
      setAdbConnected(connected);
      setSelectedAdbSerial(
        connected ? getSelectedDesktopAdbSerial() ?? null : null,
      );
      return connected;
    } catch (error) {
      console.error("ADB status check failed", error);
      setAdbConnected(false);
      setSelectedAdbSerial(null);
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const updateAdbStatus = async () => {
      const connected = await refreshAdbStatus();
      if (cancelled) return;
      if (!connected) {
        setSelectedAdbSerial(null);
      }
    };

    void updateAdbStatus();

    const handleWindowFocus = () => {
      void updateAdbStatus();
    };

    window.addEventListener("focus", handleWindowFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [refreshAdbStatus]);

  const handleAdbReconnect = useCallback(async () => {
    if (isDisabled) return;
    setAdbRemoteDialogOpen(true);
  }, [isDisabled]);

  const handleAdbBtnClicked = useCallback(async () => {
    if (isDisabled) return;
    const connected = await refreshAdbStatus();

    if (!connected) {
      setAdbRemoteDialogOpen(true);
      return;
    }

    await captureWithAdbState(captureAdbScreenshot);
  }, [captureWithAdbState, isDisabled, refreshAdbStatus]);

  const handleTauriRemoteConnect = useCallback(
    async (address: string) => {
      await runAdbAction("connect", async () => {
        const serial = await connectRemoteAdbDevice(address);
        setAdbConnected(true);
        setSelectedAdbSerial(serial);
        setAdbRemoteDialogOpen(false);
        toast.success(t("adb.connected", {serial}));
      });
    },
    [runAdbAction, t],
  );

  const handleTauriPairAndConnect = useCallback(
    async (request: {pairingAddress: string; pairingCode: string}) => {
      await runAdbAction("connect", async () => {
        await pairRemoteAdbDevice(request);
        toast.success(t("adb.paired"));
      });
    },
    [runAdbAction, t],
  );

  const handleTauriDeviceSelect = useCallback(
    async (serial: string) => {
      await runAdbAction("connect", async () => {
        const selectedSerial = await selectDesktopAdbDevice(serial);
        setAdbConnected(true);
        setSelectedAdbSerial(selectedSerial);
        setAdbRemoteDialogOpen(false);
        toast.success(t("adb.connected", {serial: selectedSerial}));
      });
    },
    [runAdbAction, t],
  );

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
    <>
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
      <AdbRemoteConnectDialog
        isOpen={adbRemoteDialogOpen}
        isSubmitting={adbBusy && adbBusyMode === "connect"}
        onOpenChange={setAdbRemoteDialogOpen}
        onConnect={handleTauriRemoteConnect}
        onPair={handleTauriPairAndConnect}
        onSelectDevice={handleTauriDeviceSelect}
        selectedSerial={selectedAdbSerial}
      />
    </>
  );
}
