import { cn } from "@/lib/utils";
import { ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

export type EmptyPreviewListProps = {
  layout: "default" | "mobile";
  isDragging: boolean;
};

export default function EmptyPreviewList({
  layout,
  isDragging,
}: EmptyPreviewListProps) {
  const { t } = useTranslation("commons", { keyPrefix: "preview" });
  const isMobileLayout = layout === "mobile";

  return (
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
  );
}
