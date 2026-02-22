import "react-photo-view/dist/react-photo-view.css";
import { Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import type { FileItem } from "@/store/problems-store";
import { useCallback, useState, useRef, type ClipboardEvent } from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import EmptyPreviewList from "./EmptyPreviewList";
import PreviewList from "./PreviewList";
import { generateTextFilename } from "@/utils/file-utils";

export type PreviewCardProps = {
  items: FileItem[];
  appendFiles: (files: File[] | FileList, source: FileItem["source"]) => void;
  removeItem: (id: string) => void;
  layout?: "default" | "mobile";
};

export default function PreviewCard({
  items,
  removeItem,
  appendFiles,
  layout = "default",
}: PreviewCardProps) {
  const { t } = useTranslation("commons", { keyPrefix: "preview" });

  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const isMobileLayout = layout === "mobile";

  const onDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (isMobileLayout) return;
      dragCounter.current++;
      if (dragCounter.current === 1) {
        setIsDragging(true);
      }
    },
    [isMobileLayout],
  );

  const onDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (isMobileLayout) return;
      dragCounter.current--;
      if (dragCounter.current === 0) {
        setIsDragging(false);
      }
    },
    [isMobileLayout],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (isMobileLayout) return;
      dragCounter.current = 0;
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        appendFiles(e.dataTransfer.files, "upload");
      } else {
        const text = e.dataTransfer.getData("text/plain");
        if (text) {
          const filename = generateTextFilename(text);
          const file = new File([text], filename, {
            type: "text/plain",
          });
          appendFiles([file], "upload");
        }
      }
    },
    [appendFiles, isMobileLayout],
  );

  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault();
    if (!e.clipboardData) return;
    if (e.clipboardData.files.length > 0) {
      appendFiles(e.clipboardData.files, "upload");
    } else {
      const text = e.clipboardData.getData("text");
      if (text) {
        const filename = generateTextFilename(text);
        const file = new File([text], filename, {
          type: "text/plain",
        });
        appendFiles([file], "upload");
      }
    }
  };

  return (
    <>
      <Card
        // contentEditable
        tabIndex={0}
        onPaste={handlePaste}
        suppressContentEditableWarning
        // onKeyDown={preventTyping}
        className={cn(
          "md:col-span-2 border-white/10 backdrop-blur outline-none caret-transparent cursor-default flex flex-col",
          isMobileLayout &&
            "border border-white/20 bg-background/70 shadow-lg backdrop-blur-lg",
        )}
      >
        <CardHeader className={cn(isMobileLayout && "px-5 pb-2 pt-5")}>
          <CardTitle
            className={cn(
              "text-base",
              isMobileLayout && "text-lg font-semibold",
            )}
          >
            {/* Preview */}
            {t("title")}
          </CardTitle>
          <CardDescription>
            {/* Hint: double click to focus image on solution area */}
            {t("tip")}
          </CardDescription>
        </CardHeader>
        <CardContent
          className={cn("flex flex-col gap-2 flex-1", isMobileLayout && "min-h-[20rem]")}
          onDragEnter={onDragEnter}
          onDragOver={(e) => {
            if (isMobileLayout) return;
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {items.length === 0 ? (
            <EmptyPreviewList
              layout={layout}
              isDragging={isDragging}
            />
          ) : (
            <PreviewList
              isDragging={isDragging}
              layout={layout}
              removeItem={removeItem}
            />
          )}

          {isDragging && !isMobileLayout && (
            <div
              className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed text-slate-400 border-red-500 bg-red-500/10"
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(false);
                dragCounter.current = 0;
              }}
            >
              <Trash2 />
              {t("drop-cancel")}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
