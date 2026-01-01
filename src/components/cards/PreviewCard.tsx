/* eslint-disable @next/next/no-img-element */
import "react-photo-view/dist/react-photo-view.css";
import { ImageIcon, Trash2, X } from "lucide-react";
import { PhotoProvider, PhotoView } from "react-photo-view";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ScrollArea } from "../ui/scroll-area";
import { Badge } from "../ui/badge";
import { twMerge } from "tailwind-merge";
import type { FileItem, FileStatus } from "@/store/problems-store";
import { useCallback, useState, type ClipboardEvent } from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export type PreviewCardProps = {
  items: FileItem[];
  appendFiles: (files: File[] | FileList, source: FileItem["source"]) => void;
  removeItem: (id: string) => void;
  layout?: "default" | "mobile";
};

function getColorClassByStatus(status: FileStatus) {
  switch (status) {
    case "success":
      return "border-green-500";
    case "failed":
      return "border-red-500";
    case "pending":
      return "border-amber-500";
    case "processing":
      return "border-cyan-500";
  }
}

export default function PreviewCard({
  items,
  removeItem,
  appendFiles,
  layout = "default",
}: PreviewCardProps) {
  const { t } = useTranslation("commons", { keyPrefix: "preview" });
  const { t: tCommon } = useTranslation("commons");

  const [isDragging, setIsDragging] = useState(false);
  const isMobileLayout = layout === "mobile";

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (isMobileLayout) return;
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        appendFiles(e.dataTransfer.files, "upload");
      }
    },
    [appendFiles, isMobileLayout],
  );

  // const preventTyping = (e: KeyboardEvent) => {
  //   // 2. Allow modifier keys like Ctrl, Shift, etc., but block everything else.
  //   // This ensures that Ctrl+V (paste) still works.
  //   if (!e.ctrlKey && !e.metaKey && !e.altKey) {
  //     e.preventDefault();
  //   }
  // };

  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault();
    if (!e.clipboardData) return;
    appendFiles(e.clipboardData.files, "upload");
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
          "md:col-span-2 border-white/10 backdrop-blur outline-none caret-transparent cursor-default",
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
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent
          className="flex flex-col gap-2"
          onDragOver={(e) => {
            if (isMobileLayout) return;
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => !isMobileLayout && setIsDragging(false)}
        >
          {items.length === 0 ? (
            <div
              className={cn(
                "flex flex-col items-center justify-center rounded-lg border text-slate-400",
                isMobileLayout
                  ? "h-48 border-white/20 bg-muted/30 px-6 text-center text-base"
                  : "h-64 border-dashed",
                isDragging && !isMobileLayout
                  ? "border-indigo-400 bg-indigo-500/10"
                  : "border-white/15",
              )}
              onDrop={onDrop}
            >
              <ImageIcon className="mb-2 h-6 w-6" />
              <p className="text-sm">
                {/* No images yet. Upload or take a photo to begin. */}
                {t("no-files")}
              </p>
              <p className="text-sm">
                {/* You can drag your files to this panel. */}
                {isMobileLayout
                  ? t("drag-tip-mobile", { defaultValue: t("drag-tip") })
                  : t("drag-tip")}
              </p>
            </div>
          ) : (
            <PhotoProvider>
              {isMobileLayout ? (
                <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2">
                  {items.map((it) => (
                    <figure
                      key={it.id}
                      className={twMerge(
                        "group relative flex h-64 min-w-[72vw] flex-col overflow-hidden rounded-2xl border border-white/15 bg-background/80 shadow-sm",
                        getColorClassByStatus(it.status),
                      )}
                      onDrop={onDrop}
                    >
                      {it.mimeType.startsWith("image/") ? (
                        <PhotoView src={it.url}>
                          <img
                            src={it.url}
                            alt={t("image-alt")}
                            className="h-48 w-full cursor-pointer object-cover"
                          />
                        </PhotoView>
                      ) : (
                        <div className="flex h-48 w-full select-none items-center justify-center text-sm">
                          {it.mimeType === "application/pdf"
                            ? t("file-type.pdf")
                            : t("file-type.unknown")}
                        </div>
                      )}
                      <figcaption className="flex items-center justify-between px-4 py-3 text-xs text-slate-200">
                        <span className="truncate pr-2" title={it.file.name}>
                          {it.file.name}
                        </span>
                        <Badge variant="outline" className="border-white/20">
                          {tCommon(`sources.${it.source}`)}
                        </Badge>
                      </figcaption>
                      <button
                        className="absolute right-3 top-3 rounded-full bg-black/40 p-2 text-white/90 backdrop-blur transition hover:bg-black/60"
                        onClick={() => removeItem(it.id)}
                        aria-label={t("remove-aria")}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </figure>
                  ))}
                </div>
              ) : (
                <ScrollArea className="rounded-lg">
                  <div
                    className={cn(
                      "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4",
                      isDragging
                        ? "border-indigo-400 bg-indigo-500/10"
                        : "border-white/15",
                    )}
                    onDrop={onDrop}
                  >
                    {items.map((it) => (
                      <figure
                        key={it.id}
                        className={twMerge(
                          "group relative overflow-hidden rounded-xl border border-white/10",
                          getColorClassByStatus(it.status),
                        )}
                      >
                        {it.mimeType.startsWith("image/") ? (
                          <PhotoView src={it.url}>
                            <img
                              src={it.url}
                              alt={t("image-alt")}
                              className="h-40 w-full cursor-pointer object-cover"
                            />
                          </PhotoView>
                        ) : (
                          <div className="flex h-40 w-full select-none items-center justify-center">
                            {it.mimeType === "application/pdf"
                              ? t("file-type.pdf")
                              : t("file-type.unknown")}
                          </div>
                        )}
                        <figcaption className="flex items-center justify-between px-3 py-2 text-xs text-slate-300">
                          <span className="truncate" title={it.file.name}>
                            {it.file.name}
                          </span>
                          <Badge variant="outline" className="border-white/20">
                            {tCommon(`sources.${it.source}`)}
                          </Badge>
                        </figcaption>
                        <button
                          className="absolute right-2 top-2 hidden rounded-md bg-black/40 p-1 text-white/90 backdrop-blur transition group-hover:block"
                          onClick={() => removeItem(it.id)}
                          aria-label={t("remove-aria")}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </figure>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </PhotoProvider>
          )}

          {isDragging && !isMobileLayout && (
            <div
              className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed text-slate-400 border-red-500 bg-red-500/10"
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
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
