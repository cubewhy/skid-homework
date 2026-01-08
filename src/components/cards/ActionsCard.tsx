import type { FileItem } from "@/store/problems-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import ActionsArea from "../areas/ActionsArea";
import InfoArea from "../UploadsInfo";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Separator } from "../ui/separator";
import UploadArea from "../areas/UploadArea";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useShortcut } from "@/hooks/use-shortcut";
import { ShortcutHint } from "../ShortcutHint";
import { useSettingsStore } from "@/store/settings-store";
import { useAiStore, type AiModelSummary } from "@/store/ai-store";
import { Check, ChevronsUpDown, Globe } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

function OnlineSearchToggle({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="relative flex-1 cursor-pointer group">
      <input
        type="checkbox"
        className="hidden peer"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
      <div
        className={cn(
          "flex items-center justify-center gap-2 h-9 px-4 py-2 rounded-md border transition-all duration-300 ease-in-out",
          // Unchecked
          "bg-gradient-to-b from-muted/50 to-muted border-border text-muted-foreground",
          "hover:border-blue-600/50 hover:text-foreground hover:shadow-sm",
          // Checked
          "peer-checked:from-blue-900 peer-checked:to-blue-950 peer-checked:border-blue-800 peer-checked:text-white peer-checked:shadow-lg peer-checked:shadow-blue-900/20",
          "peer-checked:-translate-y-0.5",
          "w-full",
        )}
      >
        <Globe
          className={cn(
            "h-4 w-4 transition-transform duration-500",
            checked && "rotate-180 text-white",
          )}
        />
        <span className="font-medium text-sm truncate select-none">
          {label}
        </span>

        <div
          className={cn(
            "absolute bottom-1 left-1/2 -translate-x-1/2 h-0.5 bg-white/40 rounded-full transition-all duration-300",
            checked ? "w-4 opacity-100" : "w-0 opacity-0",
          )}
        />
      </div>
    </label>
  );
}

export type ActionsCardProps = {
  items: FileItem[];
  appendFiles: (files: File[] | FileList, source: FileItem["source"]) => void;
  totalBytes: number;
  clearAll: () => void;
  startScan: () => Promise<void>;
  allowPdfUploads: boolean;
  layout?: "default" | "mobile";
  className?: string;
};

export default function ActionsCard({
  items,
  appendFiles,
  totalBytes,
  clearAll,
  startScan,
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
  const sources = useAiStore((s) => s.sources);
  const activeSourceId = useAiStore((s) => s.activeSourceId);
  const updateSource = useAiStore((s) => s.updateSource);
  const getClientForSource = useAiStore((s) => s.getClientForSource);

  const activeSource = useMemo(
    () => sources.find((source) => source.id === activeSourceId) ?? sources[0],
    [sources, activeSourceId],
  );

  const [availableModels, setAvailableModels] = useState<AiModelSummary[]>([]);
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);

  const loadModels = useCallback(async () => {
    if (!activeSource?.id || !activeSource.apiKey) {
      setAvailableModels([]);
      return;
    }
    try {
      const client = getClientForSource(activeSource.id);
      if (!client?.getAvailableModels) {
        setAvailableModels([]);
        return;
      }
      const models = await client.getAvailableModels();
      setAvailableModels(models);
    } catch (error) {
      console.error("Failed to fetch models", error);
      setAvailableModels([]);
    }
  }, [activeSource, getClientForSource]);

  useEffect(() => {
    if (showModelSelectorInScanner) {
      void loadModels();
    }
  }, [showModelSelectorInScanner, loadModels]);

  const handleModelSelect = (model: string) => {
    if (!activeSource) return;
    updateSource(activeSource.id, { model });
    setModelPopoverOpen(false);
  };

  const modelDisplay = useMemo(() => {
    if (!activeSource) return "";
    if (!activeSource.model) return tCommon("settings-page.model.sel.none");
    const match = availableModels.find(
      (model) => model.name === activeSource.model,
    );
    return match ? match.displayName : activeSource.model;
  }, [activeSource, availableModels, tCommon]);

  const handleSettingsBtnClick = useCallback(() => {
    router.push("/settings");
  }, [router]);

  const handleChatBtnClick = useCallback(() => {
    router.push("/chat");
  }, [router]);

  const settingsShortcut = useShortcut(
    "openSettings",
    () => handleSettingsBtnClick(),
    [handleSettingsBtnClick],
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
        className,
      )}
    >
      <CardHeader
        className={cn(layout === "mobile" ? "px-5 pb-2 pt-5" : undefined)}
      >
        <CardTitle
          className={cn(
            "text-base",
            layout === "mobile" && "text-lg font-semibold",
          )}
        >
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent
        className={cn("space-y-4", layout === "mobile" && "px-5 pb-5 pt-1")}
      >
        <UploadArea appendFiles={appendFiles} allowPdf={allowPdfUploads} />

        <Separator className="my-2" />

        <InfoArea itemsLength={items.length} totalBytes={totalBytes} />

        {showModelSelectorInScanner && (
          <Popover open={modelPopoverOpen} onOpenChange={setModelPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={modelPopoverOpen}
                className="w-full justify-between"
              >
                {modelDisplay}
                <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]">
              <Command>
                <CommandInput
                  placeholder={tCommon("settings-page.model.sel.search")}
                />
                <CommandList>
                  <CommandEmpty>
                    {tCommon("settings-page.model.sel.empty")}
                  </CommandEmpty>
                  <CommandGroup>
                    {availableModels.map((model) => (
                      <CommandItem
                        key={model.name}
                        value={model.name}
                        onSelect={(currentValue) => {
                          handleModelSelect(
                            currentValue === activeSource?.model
                              ? ""
                              : currentValue,
                          );
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            activeSource?.model === model.name
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                        {model.displayName}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}

        <ActionsArea
          itemsLength={items.length}
          clearAll={clearAll}
          startScan={startScan}
          layout={layout}
        />

        {showOnlineSearchInScanner && (
          <div className="flex w-full">
            <OnlineSearchToggle
              checked={onlineSearchEnabled}
              onCheckedChange={setOnlineSearchEnabled}
              label={tCommon("settings-page.thinking.online-search.toggle")}
            />
          </div>
        )}

        <div
          className={cn(
            "flex gap-2 flex-wrap",
            layout === "mobile" && "flex-col",
          )}
        >
          <Button
            className={cn("flex-1", layout === "mobile" && "py-6 text-base")}
            size={layout === "mobile" ? "lg" : "default"}
            variant="secondary"
            onClick={handleSettingsBtnClick}
          >
            {t("settings")}{" "}
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
