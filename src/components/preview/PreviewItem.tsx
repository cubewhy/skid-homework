import { FileItem, FileStatus, useProblemsStore } from "@/store/problems-store";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { X, Pen, Trash2 } from "lucide-react";
import { twMerge } from "tailwind-merge";
import FileContent from "./FileContent";
import { Badge } from "../ui/badge";
import { Label } from "../ui/label";

export type PreviewItemProps = {
  item: FileItem;
  layout: "default" | "mobile";
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
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

export default function PreviewItem({
  item,
  layout,
  onRemove,
  onRename,
}: PreviewItemProps) {
  const { t } = useTranslation("commons", { keyPrefix: "preview" });
  const { t: tCommon } = useTranslation("commons");

  const { setSelectedImageId, selectedImageId } = useProblemsStore((s) => s);

  const isMobile = layout === "mobile";
  const isSelected = selectedImageId === item.id;

  const switchActiveItem = () => {
    setSelectedImageId(item.id);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/* The main component */}
        <figure
          onDoubleClick={switchActiveItem}
          className={twMerge(
            "group relative flex flex-col overflow-hidden border bg-background/80 shadow-sm transition select-none",
            isMobile
              ? "h-64 min-w-[72vw] rounded-2xl border-white/15"
              : "rounded-xl border-white/10",
            isSelected ? "bg-accent" : "",
            getColorClassByStatus(item.status),
          )}
        >
          <div className={isMobile ? "h-48" : "h-40"}>
            <FileContent it={item} />
          </div>

          <figcaption className="flex items-center justify-between px-3 py-2 text-xs text-slate-200">
            <span className="truncate pr-2" title={item.displayName}>
              {item.displayName}
            </span>
            <Badge variant="outline" className="border-white/20">
              {tCommon(`sources.${item.source}`)}
            </Badge>
          </figcaption>

          <button
            className={twMerge(
              "absolute right-2 top-2 rounded-full bg-black/40 p-1.5 text-white/90 backdrop-blur transition hover:bg-black/60 cursor-pointer",
              !isMobile && "hidden group-hover:block",
            )}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(item.id);
            }}
            aria-label={t("remove.aria")}
          >
            <X className="h-4 w-4" />
          </button>
        </figure>
      </ContextMenuTrigger>

      <ContextMenuContent>
        {isMobile ? (
          <Label className="px-2 py-1.5">{item.displayName}</Label>
        ) : (
          <ContextMenuItem disabled>{item.displayName}</ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onRename(item.id, item.displayName)}>
          <Pen className="mr-2 h-4 w-4" />
          {t("rename.menu-item")}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => onRemove(item.id)}
          variant="destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {t("remove.menu-item")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
