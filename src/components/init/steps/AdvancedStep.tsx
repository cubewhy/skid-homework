"use client";

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAiStore, type AiModelSummary } from "@/store/ai-store";
import { useSettingsStore } from "@/store/settings-store";
import type { SourceModels } from "@/hooks/use-available-models";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import ModelSelector from "@/components/ui/model-selector";

export interface AdvancedStepProps {
  sourceModelsMap: SourceModels[];
  allModels: AiModelSummary[];
  isLoadingModels: boolean;
}

export default function AdvancedStep({ sourceModelsMap, allModels, isLoadingModels }: AdvancedStepProps) {
  const { t } = useTranslation("commons", {
    keyPrefix: "init-page.advanced",
  });

  const sources = useAiStore((s) => s.sources);
  const activeSourceId = useAiStore((s) => s.activeSourceId);
  const updateSource = useAiStore((s) => s.updateSource);
  const fallbackModel = useAiStore((s) => s.fallbackModel);
  const setFallbackModel = useAiStore((s) => s.setFallbackModel);

  const onlineSearchEnabled = useSettingsStore((s) => s.onlineSearchEnabled);
  const setOnlineSearchEnabled = useSettingsStore(
    (s) => s.setOnlineSearchEnabled,
  );

  const activeSource = useMemo(
    () => sources.find((s) => s.id === activeSourceId) ?? sources[0],
    [sources, activeSourceId],
  );

  const thinkingBudget = useMemo(
    () => activeSource?.thinkingBudget ?? 8192,
    [activeSource],
  );

  const maxRetries = useMemo(
    () => activeSource?.maxRetries ?? 5,
    [activeSource],
  );

  const isLoading = isLoadingModels;
  const [fallbackSelectorOpen, setFallbackSelectorOpen] = useState(false);

  const handleFallbackChange = (
    model: string,
    sourceId?: string | null,
  ) => {
    setFallbackModel(model || null, sourceId);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">{t("title")}</h2>
      <p className="-mt-4 text-sm text-muted-foreground">
        {t("description")}
      </p>

      {/* Thinking Budget - only for Gemini providers */}
      {activeSource?.provider === "gemini" && (
        <div className="space-y-2">
          <Label>{t("thinking-budget.label")}</Label>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Slider
                value={[thinkingBudget]}
                onValueChange={(value) => {
                  if (!activeSource) return;
                  updateSource(activeSource.id, {
                    thinkingBudget: value[0],
                  });
                }}
                min={128}
                max={24576}
                step={1}
              />
            </div>
            <Input
              className="w-24"
              value={thinkingBudget}
              type="number"
              min={128}
              max={24576}
              onChange={(event) => {
                if (!activeSource) return;
                const val = Math.max(
                  128,
                  Math.min(24576, Number(event.target.value) || 128),
                );
                updateSource(activeSource.id, { thinkingBudget: val });
              }}
            />
            <span className="text-sm text-muted-foreground">
              {t("thinking-budget.unit")}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("thinking-budget.tip")}
          </p>
        </div>
      )}

      {/* Online Search */}
      <div className="flex items-center gap-3">
        <Checkbox
          id="init-online-search"
          checked={onlineSearchEnabled}
          onCheckedChange={(state) => setOnlineSearchEnabled(state === true)}
        />
        <div>
          <Label htmlFor="init-online-search">{t("online-search")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("online-search-tip")}
          </p>
        </div>
      </div>

      {/* Max Retries */}
      <div className="space-y-2">
        <Label htmlFor="init-max-retries">{t("max-retries.label")}</Label>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Slider
              value={[maxRetries]}
              onValueChange={(value) => {
                if (!activeSource) return;
                updateSource(activeSource.id, { maxRetries: value[0] });
              }}
              min={0}
              max={10}
              step={1}
            />
          </div>
          <Input
            id="init-max-retries"
            className="w-16"
            type="number"
            min={0}
            max={10}
            value={maxRetries}
            onChange={(event) => {
              if (!activeSource) return;
              const val = parseInt(event.target.value, 10);
              updateSource(activeSource.id, {
                maxRetries: isNaN(val) ? 5 : Math.max(0, Math.min(10, val)),
              });
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("max-retries.tip")}
        </p>
      </div>

      {/* Fallback Model */}
      <div className="space-y-2">
        <Label>{t("fallback.label")}</Label>
        {allModels.length > 0 ? (
          <ModelSelector
            sourceModelsMap={sourceModelsMap}
            value={fallbackModel}
            onChangeAction={handleFallbackChange}
            open={fallbackSelectorOpen}
            onOpenChangeAction={setFallbackSelectorOpen}
            allowNone
            noneLabel={t("fallback.none")}
            className="w-full"
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            {isLoading ? "..." : t("fallback.no-models")}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t("fallback.tip")}</p>
      </div>
    </div>
  );
}
