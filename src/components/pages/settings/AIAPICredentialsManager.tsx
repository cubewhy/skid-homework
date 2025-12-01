import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_BASE_BY_PROVIDER } from "./SettingsPage";
import { useEffect, useState } from "react";
import { AiSource, useAiStore } from "@/store/ai-store";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

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

  const updateSource = useAiStore((s) => s.updateSource);

  useEffect(() => {
    setLocalName(activeSource?.name ?? "");
    setLocalApiKey(activeSource?.apiKey ?? "");
    setLocalBaseUrl(
      activeSource?.baseUrl ??
        (activeSource ? DEFAULT_BASE_BY_PROVIDER[activeSource.provider] : ""),
    );
  }, [activeSource]);

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
      </CardContent>
    </Card>
  );
}
