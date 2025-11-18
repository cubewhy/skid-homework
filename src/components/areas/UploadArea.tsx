import { Camera, Upload } from "lucide-react";
import { Button } from "../ui/button";
import { useCallback, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useProblemsStore, type FileItem } from "@/store/problems-store";
import { Trans, useTranslation } from "react-i18next";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { useShortcut } from "@/hooks/use-shortcut";
import { ShortcutHint } from "../ShortcutHint";
import { useNativeCamera } from "@/hooks/use-native-camera";

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
  // const [isDragging, setIsDragging] = useState(false);
  const [cameraTipOpen, setCameraTipOpen] = useState(false);

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const uploadBtnRef = useRef<HTMLButtonElement | null>(null);
  const cameraBtnRef = useRef<HTMLButtonElement | null>(null);

  const handleUploadBtnClicked = useCallback(() => {
    if (isWorking) return;
    uploadInputRef.current?.click();
  }, [isWorking]);

  const { isNative, capture } = useNativeCamera();
  const runCameraFlow = useCallback(async () => {
    if (isWorking) return;
    if (isNative) {
      const files = await capture();
      if (files.length) {
        appendFiles(files, "camera");
        return;
      }
    }
    cameraInputRef.current?.click();
  }, [appendFiles, capture, isNative, isWorking]);

  const handleCameraBtnClicked = useCallback(() => {
    void runCameraFlow();
  }, [runCameraFlow]);

  const uploadShortcut = useShortcut("upload", () => handleUploadBtnClicked(), [
    handleUploadBtnClicked,
  ]);

  const cameraShortcut = useShortcut("camera", () => handleCameraBtnClicked(), [
    handleCameraBtnClicked,
  ]);

  const fileAccept = allowPdf ? "image/*,application/pdf" : "image/*";

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
          disabled={isWorking}
          onClick={handleUploadBtnClicked}
        >
          <span className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {t("upload")}
          </span>
          {!isCompact && <ShortcutHint shortcut={uploadShortcut} />}
        </Button>
      </div>
      <div className={cn("flex gap-2", isCompact && "flex-col")}>
        <input
          ref={cameraInputRef}
          disabled={isWorking}
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
            "flex-1 items-center justify-between",
            isCompact && "py-6 text-base font-medium",
          )}
          size={isCompact ? "lg" : "default"}
          disabled={isWorking}
          onClick={handleCameraBtnClicked}
        >
          <span className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            {t("take-photo")}
          </span>
          {!isCompact && <ShortcutHint shortcut={cameraShortcut} />}
        </Button>
        {/* <Button */}
        {/*   variant="ghost" */}
        {/*   size="icon" */}
        {/*   onClick={() => setCameraTipOpen(true)} */}
        {/*   aria-label={t("camera-help-aria")} */}
        {/*   className={cn( */}
        {/*     isCompact && "h-12 w-12 rounded-xl border border-border/40", */}
        {/*   )} */}
        {/* > */}
        {/*   <Info className="h-4 w-4" /> */}
        {/* </Button> */}
      </div>
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
