import { cn } from "@/lib/utils";
import { useProblemsStore } from "@/store/problems-store";
import { PhotoProvider } from "react-photo-view";
import { ScrollArea } from "../ui/scroll-area";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import PreviewItem from "./PreviewItem";
import { useTranslation } from "react-i18next";

export type PreviewListProps = {
  layout: "default" | "mobile";
  removeItem: (id: string) => void;
  isDragging: boolean;
};

export default function PreviewList({
  layout,
  removeItem,
  isDragging,
}: PreviewListProps) {
  const { t } = useTranslation("commons", { keyPrefix: "preview" });
  const isMobileLayout = layout === "mobile";

  const { imageItems, renameFileItem } = useProblemsStore((s) => s);

  const [renamingItem, setRenamingItem] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [tempName, setTempName] = useState("");

  const handleStartRename = (id: string, currentName: string) => {
    setRenamingItem({ id, name: currentName });
    setTempName(currentName);
  };

  const handleConfirmRename = async () => {
    if (renamingItem && tempName.trim()) {
      await renameFileItem(renamingItem.id, tempName.trim());
      setRenamingItem(null);
    }
  };

  const renderItems = () =>
    imageItems.map((it) => (
      <PreviewItem
        key={it.id}
        item={it}
        layout={layout}
        onRemove={removeItem}
        onRename={handleStartRename}
      />
    ));

  return (
    <>
      <PhotoProvider>
        {isMobileLayout ? (
          <div
            className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2"
          >
            {renderItems()}
          </div>
        ) : (
          <ScrollArea
            className={cn(
              "rounded-lg flex-1 border p-4",
              isDragging
                ? "border-indigo-400 bg-indigo-500/10"
                : "border-white/15",
            )}
          >
            <div
              className={cn(
                "grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 content-start",
              )}
            >
              {renderItems()}
            </div>
          </ScrollArea>
        )}
      </PhotoProvider>

      <Dialog
        open={!!renamingItem}
        onOpenChange={(open) => {
          if (!open) setRenamingItem(null);
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {/* Rename File */}
              {t("rename.dialog.title")}
            </DialogTitle>
            <DialogDescription>
              {/* Enter a new name for the file. */}
              {t("rename.dialog.desc")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                {/* New Name */}
                {t("rename.dialog.new-name")}
              </Label>
              <Input
                id="name"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                className="col-span-3"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConfirmRename();
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="submit"
              onClick={handleConfirmRename}
              disabled={!tempName.trim()}
            >
              {t("rename.dialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
