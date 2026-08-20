import {FileText, Upload} from "lucide-react";
import {Button} from "../ui/button";
import {useCallback, useRef, useState} from "react";
import {TextInputDialog} from "../dialogs/TextInputDialog";
import {type FileItem, useProblemsStore} from "@/store/problems-store";
import {useTranslation} from "react-i18next";
import {useMediaQuery} from "@/hooks/use-media-query";
import {cn} from "@/lib/utils";
import {useShortcut} from "@/hooks/use-shortcut";
import {ShortcutHint} from "../ShortcutHint";
import {generateTextFilename} from "@/utils/file-utils";
import {PlatformCaptureActions} from "@/platform";

export type UploadAreaProps = {
  appendFiles: (files: File[] | FileList, source: FileItem["source"]) => void;
  allowPdf: boolean;
};

export default function UploadArea({ appendFiles, allowPdf }: UploadAreaProps) {
  const { t } = useTranslation("commons", { keyPrefix: "upload-area" });
  const isCompact = useMediaQuery("(max-width: 640px)");

  const isWorking = useProblemsStore((s) => s.isWorking);
  const [textInputOpen, setTextInputOpen] = useState(false);

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadBtnRef = useRef<HTMLButtonElement | null>(null);

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
    if (isWorking) return;
    uploadInputRef.current?.click();
  }, [isWorking]);

  const uploadShortcut = useShortcut("upload", () => handleUploadBtnClicked(), [
    handleUploadBtnClicked,
  ]);

  const textInputShortcut = useShortcut(
    "textInput",
    () => {
      if (isWorking) return;
      setTextInputOpen(true);
    },
    [isWorking],
  );

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
          disabled={isWorking}
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
                "flex-1 items-center justify-between min-w-0 shrink",
                isCompact && "py-6 text-base font-medium mt-2",
              )}
              size={isCompact ? "lg" : "default"}
              disabled={isWorking}
              onClick={() => setTextInputOpen(true)}
            >
              <span className="flex items-center gap-2 min-w-0 overflow-hidden">
                <FileText className="h-5 w-5 shrink-0" />
                <span className="truncate">{t("text-input.button")}</span>
              </span>
              <ShortcutHint shortcut={textInputShortcut} />
            </Button>
          }
        />
      </div>
      <PlatformCaptureActions
        appendFiles={appendFiles}
        disabled={isWorking}
        isCompact={isCompact}
      />
    </>
  );
}
