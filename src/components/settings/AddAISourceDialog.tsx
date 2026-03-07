import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type AiProvider,
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  useAiStore,
} from "@/store/ai-store";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const PRESET_URLS: Record<string, string> = {
  openai: DEFAULT_OPENAI_BASE_URL,
  openrouter: "https://openrouter.ai/api/v1",
};

function detectPresetFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const normalizedUrl = url.replace(/\/$/, "");
  for (const [preset, presetUrl] of Object.entries(PRESET_URLS)) {
    if (normalizedUrl === presetUrl.replace(/\/$/, "")) {
      return preset;
    }
  }
  return undefined;
}

export type AddAISourceDialogProps = {
  onChange: (dialogOpen: boolean) => void;
  open: boolean;
};

export default function AddAISourceDialog({
  onChange,
  open,
}: AddAISourceDialogProps) {
  const { t } = useTranslation("commons", { keyPrefix: "settings-page" });

  const sources = useAiStore((s) => s.sources);
  const addSource = useAiStore((s) => s.addSource);
  const setActiveSource = useAiStore((s) => s.setActiveSource);

  const [newProvider, setNewProvider] = useState<AiProvider>("gemini");
  const [newSourceName, setNewSourceName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiAddress, setApiAddress] = useState("");
  const [useResponsesApi, setUseResponsesApi] = useState(true);
  const [webSearchToolType, setWebSearchToolType] = useState<
    string | undefined
  >(undefined);
  const [isCustomWebSearch, setIsCustomWebSearch] = useState(false);

  const currentPreset = useMemo(
    () => detectPresetFromUrl(apiAddress || DEFAULT_OPENAI_BASE_URL),
    [apiAddress]
  );

  const resetAddDialog = () => {
    setNewSourceName("");
    setNewProvider("gemini");
    setApiAddress("");
    setUseResponsesApi(true);
    setWebSearchToolType(undefined);
    setIsCustomWebSearch(false);
  };

  const handleAddDialogChange = (open: boolean) => {
    onChange(open);
    if (!open) {
      resetAddDialog();
    }
  };

  const handleAddSource = () => {
    const provider = newProvider;
    const counter =
      sources.filter((source) => source.provider === provider).length + 1;
    const defaultName =
      provider === "gemini"
        ? t("sources.providers.gemini") + ` #${counter}`
        : t("sources.providers.openai") + ` #${counter}`;

    const name = newSourceName.trim() || defaultName;

    const newId = addSource({
      name,
      provider,
      apiKey: apiKey || null,
      baseUrl:
        apiAddress.trim() ||
        (provider === "gemini"
          ? DEFAULT_GEMINI_BASE_URL
          : DEFAULT_OPENAI_BASE_URL),
      traits: undefined,
      thinkingBudget: provider === "gemini" ? 8192 : undefined,
      useResponsesApi: provider === "openai" ? useResponsesApi : undefined,
      webSearchToolType: provider === "openai" ? webSearchToolType : undefined,
      enabled: true,
    });

    setActiveSource(newId);
    onChange(false);
    resetAddDialog();
    toast.success(
      t("sources.add.success", {
        name,
      })
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleAddDialogChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sources.add.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-provider">{t("sources.add.provider")}</Label>
            <select
              id="new-provider"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              value={newProvider}
              onChange={(event) =>
                setNewProvider(event.target.value as AiProvider)
              }
            >
              <option value="gemini">{t("sources.providers.gemini")}</option>
              <option value="openai">{t("sources.providers.openai")}</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-name">{t("sources.add.name")}</Label>
            <Input
              id="new-name"
              value={newSourceName}
              onChange={(event) => setNewSourceName(event.target.value)}
              placeholder={t("sources.add.name-placeholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-name">{t("sources.add.key")}</Label>
            <Input
              id="api-key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={t("sources.add.key-placeholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-name">{t("sources.add.address")}</Label>
            <Input
              id="api-address"
              value={apiAddress}
              type="url"
              onChange={(event) => setApiAddress(event.target.value)}
              placeholder={
                newProvider === "gemini"
                  ? DEFAULT_GEMINI_BASE_URL
                  : DEFAULT_OPENAI_BASE_URL
              }
            />
          </div>

          {newProvider === "openai" && (
            <Accordion type="single" collapsible className="w-full pt-2">
              <AccordionItem value="advanced-options" className="border-b-0">
                <AccordionTrigger className="text-sm font-medium border-t pt-4 pb-2 hover:no-underline">
                  {t("api-credentials.advanced.title")}
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label>{t("api-credentials.advanced.quick-preset")}</Label>
                    <Select
                      value={currentPreset ?? "custom"}
                      onValueChange={(val) => {
                        if (val === "custom") {
                          return;
                        }
                        const presetUrl = PRESET_URLS[val];
                        if (presetUrl) {
                          setApiAddress(presetUrl);
                          if (val === "openrouter") {
                            toast.success(
                              t("api-credentials.advanced.switched-openrouter")
                            );
                          } else if (val === "openai") {
                            toast.success(
                              t("api-credentials.advanced.switched-openai")
                            );
                          }
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t(
                            "api-credentials.advanced.quick-preset-placeholder"
                          )}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">
                          {t("api-credentials.advanced.openai-default")}
                        </SelectItem>
                        <SelectItem value="openrouter">
                          {t("api-credentials.advanced.openrouter")}
                        </SelectItem>
                        {currentPreset === undefined && (
                          <SelectItem value="custom">
                            {t("api-credentials.advanced.custom-url")}
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center space-x-2 pt-2">
                    <Checkbox
                      id="use-responses-api"
                      checked={useResponsesApi}
                      onCheckedChange={(checked) => {
                        setUseResponsesApi(checked === true);
                      }}
                    />
                    <Label htmlFor="use-responses-api" className="text-sm">
                      {t("api-credentials.advanced.enable-responses-api")}
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("api-credentials.advanced.responses-api-tip")}
                  </p>

                  <div className="space-y-2 pt-4">
                    <Label>
                      {t("api-credentials.advanced.web-search-tool.label")}
                    </Label>
                    <Select
                      value={
                        isCustomWebSearch ||
                        (webSearchToolType !== undefined &&
                          !["web_search", "web_search_preview"].includes(
                            webSearchToolType
                          ))
                          ? "custom"
                          : webSearchToolType === undefined
                            ? "auto"
                            : webSearchToolType
                      }
                      onValueChange={(val) => {
                        if (val === "auto") {
                          setIsCustomWebSearch(false);
                          setWebSearchToolType(undefined);
                        } else if (val === "custom") {
                          setIsCustomWebSearch(true);
                          setWebSearchToolType(undefined);
                        } else {
                          setIsCustomWebSearch(false);
                          setWebSearchToolType(val);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t(
                            "api-credentials.advanced.web-search-tool.placeholder"
                          )}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">
                          {t("api-credentials.advanced.web-search-tool.auto")}
                        </SelectItem>
                        <SelectItem value="web_search">
                          {t(
                            "api-credentials.advanced.web-search-tool.web-search"
                          )}
                        </SelectItem>
                        <SelectItem value="web_search_preview">
                          {t(
                            "api-credentials.advanced.web-search-tool.web-search-preview"
                          )}
                        </SelectItem>
                        <SelectItem value="custom">
                          {t("api-credentials.advanced.web-search-tool.custom")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {(isCustomWebSearch ||
                      (webSearchToolType !== undefined &&
                        !["web_search", "web_search_preview"].includes(
                          webSearchToolType
                        ))) && (
                      <Input
                        placeholder={t(
                          "api-credentials.advanced.web-search-tool.custom-placeholder"
                        )}
                        value={webSearchToolType || ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setWebSearchToolType(val || undefined);
                          if (val) {
                            setIsCustomWebSearch(false);
                          } else {
                            setIsCustomWebSearch(true);
                          }
                        }}
                      />
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t("api-credentials.advanced.web-search-tool.tip")}
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
        </div>
        <DialogFooter className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => handleAddDialogChange(false)}
          >
            {t("sources.add.cancel")}
          </Button>
          <Button onClick={handleAddSource}>{t("sources.add.confirm")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
