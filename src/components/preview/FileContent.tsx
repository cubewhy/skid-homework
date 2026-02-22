import { FileItem } from "@/store/problems-store";
import { useTranslation } from "react-i18next";
import { PhotoView } from "react-photo-view";
import { useEffect, useState } from "react";
import { isTextMimeType, readTextFile } from "@/utils/file-utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";

export type FileContentProps = {
  it: FileItem;
};

const TextFilePreview = ({ item }: { item: FileItem }) => {
  const [content, setContent] = useState<string>("");

  useEffect(() => {
    let canceled = false;
    readTextFile(item.url).then((text) => {
      if (!canceled) {
        setContent(text);
      }
    });
    return () => {
      canceled = true;
    };
  }, [item.url]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <div className="flex h-full w-full cursor-pointer overflow-hidden bg-muted/50 p-3 text-[10px] font-mono text-muted-foreground break-all whitespace-pre-wrap">
          {content.slice(0, 300)}
        </div>
      </DialogTrigger>
      <DialogContent className="flex h-[80vh] max-w-4xl flex-col" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{item.displayName}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto rounded-md bg-slate-950 p-4 font-mono text-sm text-slate-300 whitespace-pre-wrap">
          {content}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default function FileContent({ it }: FileContentProps) {
  const { t } = useTranslation("commons", { keyPrefix: "preview" });

  if (it.mimeType.startsWith("image/")) {
    return (
      <PhotoView src={it.url} key={it.url}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={it.url}
          alt={t("image-alt")}
          className="h-full w-full cursor-pointer object-cover"
        />
      </PhotoView>
    );
  }

  if (isTextMimeType(it.mimeType, it.file.name)) {
    return <TextFilePreview item={it} />;
  }

  return (
    <div className="flex h-full w-full select-none items-center justify-center text-sm">
      {it.mimeType === "application/pdf"
        ? t("file-type.pdf")
        : t("file-type.unknown")}
    </div>
  );
}
