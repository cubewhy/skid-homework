/* eslint-disable @next/next/no-img-element */
import "react-photo-view/dist/react-photo-view.css";
import { ImageIcon, Trash2, X } from "lucide-react";
import { PhotoProvider, PhotoView } from "react-photo-view";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ScrollArea } from "../ui/scroll-area";
import { Badge } from "../ui/badge";
import { twMerge } from "tailwind-merge";
import type { FileItem, FileStatus } from "@/store/problems-store";
import {
  useCallback,
  useState,
  type ClipboardEvent,
  useRef,
  useEffect,
} from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { generateTextFilename, readTextFile } from "@/utils/file-utils";

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

const TextFilePreview = ({ url }: { url: string }) => {
  const [content, setContent] = useState<string>("");

  useEffect(() => {
    readTextFile(url).then((text) => setContent(text.slice(0, 300)));
  }, [url]);

  return (
    <div className="h-40 w-full overflow-hidden bg-muted/50 p-3 text-[10px] font-mono text-muted-foreground break-all whitespace-pre-wrap">
      {content}
    </div>
  );
};

export default function PreviewCard({
  items,
  removeItem,
  appendFiles,
  layout = "default",
}: PreviewCardProps) {
  const { t } = useTranslation("commons", { keyPrefix: "preview" });
  const { t: tCommon } = useTranslation("commons");

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

  // const preventTyping = (e: KeyboardEvent) => {
  //   // 2. Allow modifier keys like Ctrl, Shift, etc., but block everything else.
  //   // This ensures that Ctrl+V (paste) still works.
  //   // if (!e.ctrlKey && !e.metaKey && !e.altKey) {
  //   //   e.preventDefault();
  //   // }
  // };

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
            {t("title")}
          </CardTitle>
        </CardHeader>
        <CardContent
          className="flex flex-col gap-2 flex-1"
          onDragEnter={onDragEnter}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {items.length === 0 ? (
            <div
              className={cn(
                "flex flex-col items-center justify-center rounded-lg border text-slate-400 flex-1",
                isMobileLayout
                  ? "h-48 border-white/20 bg-muted/30 px-6 text-center text-base"
                  : "min-h-[16rem] border-dashed",
                isDragging && !isMobileLayout
                  ? "border-indigo-400 bg-indigo-500/10"
                  : "border-white/15",
              )}
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
              {!isMobileLayout && (
                <p className="mt-2 text-xs text-slate-500">
                  {t("supported-types")}
                </p>
              )}
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
                    >
                      {it.mimeType.startsWith("image/") ? (
                        <PhotoView src={it.url}>
                          <img
                            src={it.url}
                            alt={t("image-alt")}
                            className="h-48 w-full cursor-pointer object-cover"
                          />
                        </PhotoView>
                      ) : it.mimeType.startsWith("text/") ||
                        it.file.name.match(/\.(md|json|txt)$/i) ? (
                        <TextFilePreview url={it.url} />
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
                        className="absolute right-3 top-3 rounded-full bg-black/40 p-2 text-white/90 backdrop-blur transition hover:bg-black/60 cursor-pointer"
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
                        ) : it.mimeType.startsWith("text/") ||
                          it.file.name.match(/\.(md|json|txt)$/i) ? (
                          <TextFilePreview url={it.url} />
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
                          className="absolute right-2 top-2 hidden rounded-md bg-black/40 p-1 text-white/90 backdrop-blur transition group-hover:block cursor-pointer"
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
