import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMemo, useState } from "react";
import {
  AiSource,
  DEFAULT_BASE_BY_PROVIDER,
  DEFAULT_OPENAI_BASE_URL,
  useAiStore,
} from "@/store/ai-store";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

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

export type AIAPICredentialsManagerProps = {
  activeSource: AiSource;
};

export default function AIAPICredentialsManager({
  activeSource,
}: AIAPICredentialsManagerProps) {
  const { t } = useTranslation("commons", {
    keyPrefix: "settings-page",
  });

  const [localName, setLocalName] = useState(activeSource?.name ?? "");
  const [localApiKey, setLocalApiKey] = useState(activeSource?.apiKey ?? "");
  const [localBaseUrl, setLocalBaseUrl] = useState(
    activeSource?.baseUrl ??
      (activeSource ? DEFAULT_BASE_BY_PROVIDER[activeSource.provider] : ""),
  );
  const [isCustomWebSearch, setIsCustomWebSearch] = useState(false);

  const updateSource = useAiStore((s) => s.updateSource);

  const currentPreset = useMemo(
    () => detectPresetFromUrl(activeSource?.baseUrl),
    [activeSource?.baseUrl],
  );

  const handleNameBlur = () => {
    if (!activeSource) return;
    const trimmed = localName.trim();
    if (!trimmed || trimmed === activeSource.name) return;
    updateSource(activeSource.id, { name: trimmed });
  };

  const applyApiKey = () => {
    if (!activeSource) return;
    const trimmed = localApiKey.trim();
    const current = activeSource.apiKey ?? "";
    if (trimmed === current) return;
    updateSource(activeSource.id, {
      apiKey: trimmed ? trimmed : null,
    });
    toast.success(t("api-credentials.applied"));
  };

  const clearApiKey = () => {
    if (!activeSource) return;
    setLocalApiKey("");
    updateSource(activeSource.id, { apiKey: null });
  };

  const applyBaseUrl = () => {
    if (!activeSource) return;
    const trimmed = localBaseUrl.trim();
    const next = trimmed || DEFAULT_BASE_BY_PROVIDER[activeSource.provider];
    if (
      (activeSource.baseUrl ??
        DEFAULT_BASE_BY_PROVIDER[activeSource.provider]) === next
    ) {
      return;
    }
    updateSource(activeSource.id, {
      baseUrl: next,
    });
  };

  const resetBaseUrl = () => {
    if (!activeSource) return;
    const defaults = DEFAULT_BASE_BY_PROVIDER[activeSource.provider];
    setLocalBaseUrl(defaults);
    updateSource(activeSource.id, { baseUrl: defaults });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("api-credentials.title")}</CardTitle>
        <CardDescription>{t("api-credentials.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="source-name">{t("api-credentials.name.label")}</Label>
          <Input
            id="source-name"
            value={localName}
            onChange={(event) => setLocalName(event.target.value)}
            onBlur={handleNameBlur}
            placeholder={t("api-credentials.name.placeholder")}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="api-key-input">{t("api-credentials.label")}</Label>
          <div className="flex items-center space-x-2">
            <Input
              id="api-key-input"
              type="password"
              value={localApiKey}
              placeholder={t("api-credentials.placeholder", {
                provider: activeSource?.name ?? "",
              })}
              onChange={(event) => setLocalApiKey(event.target.value)}
              onBlur={applyApiKey}
            />
            <Button
              variant="outline"
              onClick={clearApiKey}
              disabled={!localApiKey}
            >
              {t("clear-input")}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="base-url-input">
            {t("advanced.custom-base-url.title")}
          </Label>
          <div className="flex items-center space-x-2">
            <Input
              id="base-url-input"
              type="url"
              value={localBaseUrl}
              placeholder={t("advanced.custom-base-url.placeholder")}
              onChange={(event) => setLocalBaseUrl(event.target.value)}
              onBlur={applyBaseUrl}
            />
            <Button variant="outline" onClick={resetBaseUrl}>
              {t("reset")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("advanced.custom-base-url.helper", {
              provider: activeSource?.name ?? "",
            })}
          </p>
        </div>

        {activeSource?.provider === "openai" && (
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
                        setLocalBaseUrl(presetUrl);
                        updateSource(activeSource.id, { baseUrl: presetUrl });
                        if (val === "openrouter") {
                          toast.success(
                            t("api-credentials.advanced.switched-openrouter"),
                          );
                        } else if (val === "openai") {
                          toast.success(
                            t("api-credentials.advanced.switched-openai"),
                          );
                        }
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={t(
                          "api-credentials.advanced.quick-preset-placeholder",
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
                    checked={activeSource.useResponsesApi || false}
                    onCheckedChange={(checked) => {
                      updateSource(activeSource.id, {
                        useResponsesApi: checked === true,
                      });
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
                      (activeSource.webSearchToolType !== undefined &&
                        !["web_search", "web_search_preview"].includes(
                          activeSource.webSearchToolType,
                        ))
                        ? "custom"
                        : activeSource.webSearchToolType === undefined
                          ? "auto"
                          : activeSource.webSearchToolType
                    }
                    onValueChange={(val) => {
                      if (val === "auto") {
                        setIsCustomWebSearch(false);
                        updateSource(activeSource.id, {
                          webSearchToolType: undefined,
                        });
                      } else if (val === "custom") {
                        setIsCustomWebSearch(true);
                        updateSource(activeSource.id, {
                          webSearchToolType: undefined,
                        });
                      } else {
                        setIsCustomWebSearch(false);
                        updateSource(activeSource.id, {
                          webSearchToolType: val,
                        });
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={t(
                          "api-credentials.advanced.web-search-tool.placeholder",
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        {t("api-credentials.advanced.web-search-tool.auto")}
                      </SelectItem>
                      <SelectItem value="web_search">
                        {t(
                          "api-credentials.advanced.web-search-tool.web-search",
                        )}
                      </SelectItem>
                      <SelectItem value="web_search_preview">
                        {t(
                          "api-credentials.advanced.web-search-tool.web-search-preview",
                        )}
                      </SelectItem>
                      <SelectItem value="custom">
                        {t("api-credentials.advanced.web-search-tool.custom")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {(isCustomWebSearch ||
                    (activeSource.webSearchToolType !== undefined &&
                      !["web_search", "web_search_preview"].includes(
                        activeSource.webSearchToolType,
                      ))) && (
                    <Input
                      placeholder={t(
                        "api-credentials.advanced.web-search-tool.custom-placeholder",
                      )}
                      value={activeSource.webSearchToolType || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateSource(activeSource.id, {
                          webSearchToolType: val || undefined,
                        });
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
      </CardContent>
    </Card>
  );
}
