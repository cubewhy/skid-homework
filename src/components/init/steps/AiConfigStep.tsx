"use client";
import { useState } from "react";
import { useTranslation, Trans } from "react-i18next";
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
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  useAiStore,
  type AiSource,
  type AiModelSummary,
} from "@/store/ai-store";
import type { SourceFetchError } from "@/hooks/use-available-models";
import { CheckCircle2, Loader2 } from "lucide-react";

export interface AiConfigStepProps {
  allModels: AiModelSummary[];
  isLoadingModels: boolean;
  fetchErrors: SourceFetchError[];
  hasFetched: boolean;
}

function ProviderCard({ source }: { source: AiSource }) {
  const updateSource = useAiStore((s) => s.updateSource);
  const toggleSource = useAiStore((s) => s.toggleSource);
  const { t } = useTranslation("commons", { keyPrefix: "init-page.ai-config" });

  const [key, setKey] = useState(source.apiKey ?? "");
  const [baseUrl, setBaseUrl] = useState(source.baseUrl ?? "");

  const defaultBaseUrl =
    source.provider === "gemini" ? DEFAULT_GEMINI_BASE_URL : DEFAULT_OPENAI_BASE_URL;

  const commitKey = () => {
    const trimmed = key.trim();
    updateSource(source.id, {
      apiKey: trimmed || null,
      enabled: !!trimmed || source.enabled,
    });
  };

  const commitBaseUrl = () => {
    const trimmed = baseUrl.trim();
    updateSource(source.id, { baseUrl: trimmed || defaultBaseUrl });
  };

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">{source.name}</span>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={source.enabled}
            onCheckedChange={(checked) =>
              toggleSource(source.id, checked === true)
            }
          />
          <Label className="text-xs text-muted-foreground">
            {t("enabled")}
          </Label>
        </div>
      </div>

      <div className="mt-3">
        <Label className="text-xs">{t("api-key-placeholder", { provider: source.name })}</Label>
        <Input
          type="password"
          placeholder={t("api-key-placeholder", { provider: source.name })}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onBlur={commitKey}
          className="mt-1"
        />
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {source.provider === "gemini" ? (
          <Trans
            t={t}
            i18nKey="api-hint-gemini"
            components={{
              link: (
                <a
                  href="https://aistudio.google.com/api-keys"
                  className="underline"
                />
              ),
            }}
          />
        ) : (
          <Trans
            t={t}
            i18nKey="api-hint-openai"
            components={{
              link: (
                <a
                  href="https://platform.openai.com/settings/organization/api-keys"
                  className="underline"
                />
              ),
            }}
          />
        )}
      </p>

      <Accordion type="single" collapsible className="mt-2">
        <AccordionItem value="base-url" className="border-b-0">
          <AccordionTrigger className="py-2 text-xs hover:no-underline">
            {t("base-url-label")}
          </AccordionTrigger>
          <AccordionContent>
            <Input
              type="url"
              placeholder={t("base-url-placeholder", { provider: source.name })}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              onBlur={commitBaseUrl}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("base-url-helper")}
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

export default function AiConfigStep({ allModels, isLoadingModels, fetchErrors, hasFetched }: AiConfigStepProps) {
  const sources = useAiStore((s) => s.sources);
  const { t } = useTranslation("commons", { keyPrefix: "init-page.ai-config" });

  return (
    <div>
      <h2 className="text-xl font-bold">{t("title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>

      <div className="mt-5 space-y-3">
        {sources.map((source) => (
          <ProviderCard key={source.id} source={source} />
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">{t("storage-note")}</p>

      {(isLoadingModels || hasFetched) && (
        <div className="mt-3 space-y-1">
          {isLoadingModels ? (
            <div className="flex items-center gap-1.5 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">{t("status.loading")}</span>
            </div>
          ) : allModels.length > 0 ? (
            <div className="flex items-center gap-1.5 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-green-600">{t("status.connected")}</span>
            </div>
          ) : null}
          {!isLoadingModels && fetchErrors.map((err) => (
            <p key={err.sourceId} className="text-xs text-destructive">
              {err.sourceName}: {t(`status.errors.${err.code}` as "status.errors.auth")}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
