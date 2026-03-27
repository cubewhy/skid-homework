"use client";

import type {FileItem} from "@/store/problems-store";
import {useCallback} from "react";
import ActionsArea from "./ActionsArea";
import UploadFilesInfo from "./UploadFilesInfo";
import {Button} from "../ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "../ui/card";
import {Separator} from "../ui/separator";
import UploadArea from "./UploadArea";
import {useRouter} from "next/navigation";
import {useTranslation} from "react-i18next";
import {cn} from "@/lib/utils";
import {useShortcut} from "@/hooks/use-shortcut";
import {ShortcutHint} from "../ShortcutHint";
import {useSettingsStore} from "@/store/settings-store";
import OnlineSearchToggle from "@/components/actions/OnlineSearchToggle";
import ModelSelectorPopover from "./ModelSelectorPopover";

export type ActionsCardProps = {
  items: FileItem[];
  appendFilesAction: (
    files: File[] | FileList,
    source: FileItem["source"]
  ) => void;
  totalBytes: number;
  clearAllAction: () => void;
  startScanAction: () => Promise<void>;
  allowPdfUploads: boolean;
  layout?: "default" | "mobile";
  className?: string;
};

export default function ActionsCard({
  items,
  appendFilesAction,
  totalBytes,
  clearAllAction,
  startScanAction,
  allowPdfUploads,
  layout = "default",
  className,
}: ActionsCardProps) {
  const { t } = useTranslation("commons", { keyPrefix: "actions" });
  const { t: tCommon } = useTranslation("commons");
  const router = useRouter();

  const {
    showModelSelectorInScanner,
    showOnlineSearchInScanner,
    onlineSearchEnabled,
    setOnlineSearchEnabled,
  } = useSettingsStore((s) => s);

  const handleSettingsBtnClick = useCallback(() => {
    router.push("/settings");
  }, [router]);

  const handleChatBtnClick = useCallback(() => {
    router.push("/chat");
  }, [router]);

  const settingsShortcut = useShortcut(
    "openSettings",
    () => handleSettingsBtnClick(),
    [handleSettingsBtnClick]
  );

  const chatShortcut = useShortcut("openChat", () => handleChatBtnClick(), [
    handleChatBtnClick,
  ]);

  return (
    <Card
      className={cn(
        "md:col-span-1 border-white/10 backdrop-blur",
        layout === "mobile" &&
        "border border-white/20 bg-background/70 shadow-lg backdrop-blur-lg",
        className
      )}
    >
      <CardHeader
        className={cn(layout === "mobile" ? "px-5 pb-2 pt-5" : undefined)}
      >
        <CardTitle
          className={cn(
            "text-base",
            layout === "mobile" && "text-lg font-semibold"
          )}
        >
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent
        className={cn("space-y-4", layout === "mobile" && "px-5 pb-5 pt-1")}
      >
        <UploadArea
          appendFiles={appendFilesAction}
          allowPdf={allowPdfUploads}
        />

        <Separator className="my-2" />

        <UploadFilesInfo itemsLength={items.length} totalBytes={totalBytes} />

        {showModelSelectorInScanner && <ModelSelectorPopover />}

        <ActionsArea
          itemsLength={items.length}
          clearAll={clearAllAction}
          startScan={startScanAction}
          layout={layout}
        />

        {showOnlineSearchInScanner && (
          <div className="flex w-full">
            <OnlineSearchToggle
              checked={onlineSearchEnabled}
              onCheckedChange={setOnlineSearchEnabled}
              label={
                onlineSearchEnabled
                  ? tCommon(
                    "settings-page.thinking.online-search.toggle.enabled"
                  )
                  : tCommon(
                    "settings-page.thinking.online-search.toggle.disabled"
                  )
              }
            />
          </div>
        )}

        <div
          className={cn(
            "flex gap-2 flex-wrap",
            layout === "mobile" && "flex-col"
          )}
        >
          <Button
            className={cn("flex-1", layout === "mobile" && "py-6 text-base")}
            size={layout === "mobile" ? "lg" : "default"}
            variant="secondary"
            onClick={handleSettingsBtnClick}
          >
            {t("settings")}
            {layout !== "mobile" && (
              <ShortcutHint shortcut={settingsShortcut} />
            )}
          </Button>
          <Button
            className={cn("flex-1", layout === "mobile" && "py-6 text-base")}
            size={layout === "mobile" ? "lg" : "default"}
            variant="secondary"
            onClick={handleChatBtnClick}
          >
            {t("chat")}
            {layout !== "mobile" && <ShortcutHint shortcut={chatShortcut} />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
