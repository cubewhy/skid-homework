import { Camera, MoreVertical, Upload, FileText } from "lucide-react";
import { Button } from "../ui/button";
import { toast } from "sonner";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { TextInputDialog } from "../dialogs/TextInputDialog";
import { type FileItem, useProblemsStore } from "@/store/problems-store";
import { Trans, useTranslation } from "react-i18next";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { useShortcut } from "@/hooks/use-shortcut";
import { ShortcutHint } from "../ShortcutHint";
import { useNativeCamera } from "@/hooks/use-native-camera";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  captureAdbScreenshot,
  isAdbDeviceConnected,
  reconnectAdbDevice,
} from "@/lib/webadb/screenshot";
import { UnsupportedEnvironmentError } from "@/lib/webadb/manager";
import { TimeoutError, withTimeout } from "@/utils/timeout";
import { generateTextFilename } from "@/utils/file-utils";

export type UploadAreaProps = {
  appendFiles: (files: File[] | FileList, source: FileItem["source"]) => void;
  allowPdf: boolean;
};

export default function UploadArea({ appendFiles, allowPdf }: UploadAreaProps) {
  const { t } = useTranslation("commons", { keyPrefix: "upload-area" });
  const isCompact = useMediaQuery("(max-width: 640px)");
  const cameraTips = t("camera-tip.tips", {
    returnObjects: true,
  }) as string[];

  const isWorking = useProblemsStore((s) => s.isWorking);
  const [cameraTipOpen, setCameraTipOpen] = useState(false);
  const [textInputOpen, setTextInputOpen] = useState(false);
  const [adbBusy, setAdbBusy] = useState(false);
  const [adbBusyMode, setAdbBusyMode] = useState<"connect" | "capture" | null>(
    null,
  );
  const [adbConnected, setAdbConnected] = useState(false);

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const uploadBtnRef = useRef<HTMLButtonElement | null>(null);
  const cameraBtnRef = useRef<HTMLButtonElement | null>(null);

  const handleTextInput = useCallback(
    (text: string) => {
      const filename = generateTextFilename(text);
      const file = new File([text], filename, { type: "text/plain" });
      appendFiles([file], "upload");
      setTextInputOpen(false);
    },
    [appendFiles],
  );

  const handleUploadBtnClicked = useCallback(() => {
    if (isWorking || adbBusy) return;
    uploadInputRef.current?.click();
  }, [isWorking, adbBusy]);

  const { isNative, capture } = useNativeCamera();
  const runCameraFlow = useCallback(async () => {
    if (isWorking || adbBusy) return;
    if (isNative) {
      const files = await capture();
      if (files.length) {
        appendFiles(files, "camera");
        return;
      }
    }
    cameraInputRef.current?.click();
  }, [appendFiles, capture, isNative, isWorking, adbBusy]);

  const handleCameraBtnClicked = useCallback(() => {
    void runCameraFlow();
  }, [runCameraFlow]);

  useEffect(() => {
    let cancelled = false;

    const updateAdbStatus = async () => {
      try {
        const connected = await isAdbDeviceConnected();
        if (!cancelled) setAdbConnected(connected);
      } catch (error) {
        console.error("ADB status check failed", error);
        if (!cancelled) setAdbConnected(false);
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
    if (isWorking || adbBusy) return;
    try {
      setAdbBusy(true);
      setAdbBusyMode("connect");
      const ok = await reconnectAdbDevice();
      setAdbConnected(ok);
    } catch (error) {
      if (error instanceof UnsupportedEnvironmentError) {
        toast.error(t("toasts.webusb-not-supported"));
      } else {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        toast.error(t("toasts.adb-failed", { error: errorMessage }));
      }
    } finally {
      setAdbBusy(false);
      setAdbBusyMode(null);
    }
  }, [adbBusy, isWorking, t]);

  const handleAdbBtnClicked = useCallback(async () => {
    if (isWorking || adbBusy) return;
    try {
      setAdbBusy(true);
      if (!adbConnected) {
        setAdbBusyMode("connect");
        const ok = await reconnectAdbDevice();
        setAdbConnected(ok);
      } else {
        setAdbBusyMode("capture");
        const file = await withTimeout(captureAdbScreenshot(), 5_000);
        appendFiles([file], "adb");
      }
    } catch (err) {
      if (err instanceof UnsupportedEnvironmentError) {
        toast.error(t("toasts.webusb-not-supported"));
      } else if (err instanceof TimeoutError) {
        toast.error(t("adb.capture-timeout"));
      } else {
        const errorMessage = err instanceof Error ? err.message : String(err);
        toast.error(t("toasts.adb-failed", { error: errorMessage }));
        // On failure we keep current adb-connected state as-is
      }
    } finally {
      setAdbBusy(false);
      setAdbBusyMode(null);
    }
  }, [adbBusy, adbConnected, appendFiles, isWorking, t]);

  const uploadShortcut = useShortcut("upload", () => handleUploadBtnClicked(), [
    handleUploadBtnClicked,
  ]);

  const cameraShortcut = useShortcut("camera", () => handleCameraBtnClicked(), [
    handleCameraBtnClicked,
  ]);

  const adbScreenshotShortcut = useShortcut(
    "adbScreenshot",
    () => handleAdbBtnClicked(),
    [handleAdbBtnClicked],
  );

  const textInputShortcut = useShortcut("textInput", () => {
    if (isWorking || adbBusy) return;
    setTextInputOpen(true);
  }, [isWorking, adbBusy]);

  const fileAccept = allowPdf
    ? "image/*,application/pdf,text/*,.txt,.md,.json"
    : "image/*,text/*,.txt,.md,.json";

  return (
    <>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground md:text-xs">
          {t("upload-tip")}
        </p>
        {!allowPdf && (
          <p className="text-xs text-muted-foreground/80">
            {t("pdf-disabled")}
          </p>
        )}
      </div>
      <div className={cn("flex gap-2", isCompact && "flex-col")}>
        <input
          ref={uploadInputRef}
          type="file"
          accept={fileAccept}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.currentTarget.files)
              appendFiles(e.currentTarget.files, "upload");
            e.currentTarget.value = ""; // allow re-select same files
          }}
        />
        <Button
          className={cn(
            "flex-1 items-center justify-between",
            isCompact && "py-6 text-base font-medium",
          )}
          size={isCompact ? "lg" : "default"}
          ref={uploadBtnRef}
          disabled={isWorking || adbBusy}
          onClick={handleUploadBtnClicked}
        >
          <span className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {t("upload")}
          </span>
          <ShortcutHint shortcut={uploadShortcut} />
        </Button>
      </div>
      <div className={cn("flex gap-2 w-full", isCompact && "flex-col")}>
        <input
          ref={cameraInputRef}
          disabled={isWorking || adbBusy}
          type="file"
          accept={fileAccept}
          capture="environment"
          className="hidden"
          onChange={(e) => {
            if (e.currentTarget.files)
              appendFiles(e.currentTarget.files, "camera");
            e.currentTarget.value = "";
          }}
        />
        <Button
          ref={cameraBtnRef}
          variant="secondary"
          className={cn(
            "flex-1 items-center justify-between min-w-0 flex-shrink",
            isCompact && "py-6 text-base font-medium",
          )}
          size={isCompact ? "lg" : "default"}
          disabled={isWorking || adbBusy}
          onClick={handleCameraBtnClicked}
        >
          <span className="flex items-center gap-2 min-w-0 overflow-hidden">
            <Camera className="h-5 w-5 flex-shrink-0" />
            <span className="truncate">{t("take-photo")}</span>
          </span>
          <ShortcutHint shortcut={cameraShortcut} />
        </Button>
        <TextInputDialog
          isOpen={textInputOpen}
          onOpenChange={setTextInputOpen}
          title={t("text-input.title")}
          description={t("text-input.description")}
          placeholder={t("text-input.placeholder")}
          submitText={t("text-input.submit")}
          onSubmit={handleTextInput}
          trigger={
            <Button
              variant="secondary"
              className={cn(
                "flex-1 items-center justify-between min-w-0 flex-shrink",
                isCompact && "py-6 text-base font-medium mt-2",
              )}
              size={isCompact ? "lg" : "default"}
              disabled={isWorking}
              onClick={() => setTextInputOpen(true)}
            >
              <span className="flex items-center gap-2 min-w-0 overflow-hidden">
                <FileText className="h-5 w-5 flex-shrink-0" />
                <span className="truncate">{t("text-input.button")}</span>
              </span>
              <ShortcutHint shortcut={textInputShortcut} />
            </Button>
          }
        />
      </div>
      {!isCompact && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 items-center min-w-0 justify-between"
            size="default"
            disabled={isWorking || adbBusy}
            onClick={handleAdbBtnClicked}
            title={t("adb.screenshot-hint")}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <Image
                src="/icons/adb.svg"
                alt="ADB"
                width={18}
                height={18}
                className="h-[18px] w-[18px]"
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
                  disabled={isWorking || adbBusy}
                  aria-label={t("adb.menu-aria-label")}
                >
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuItem onClick={handleAdbReconnect}>
                  {t("adb.reconnect")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      {/* Camera help dialog */}
      <Dialog open={cameraTipOpen} onOpenChange={setCameraTipOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("camera-tip.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              <Trans
                i18nKey="upload-area.camera-tip.intro"
                components={{
                  takePhoto: <code />,
                  capture: <code />,
                }}
              />
            </p>
            <ul className="list-disc pl-5 dark:text-slate-400">
              {cameraTips.map((tip, index) => (
                <li key={index}>{tip}</li>
              ))}
            </ul>
          </div>
          <DialogFooter>
            <Button onClick={() => setCameraTipOpen(false)}>
              {t("camera-tip.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
