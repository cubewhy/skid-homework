"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/components/theme-provider";
import { useSettingsStore, type ThemePreference } from "@/store/settings-store";
import { useAiStore, type AiModelSummary } from "@/store/ai-store";
import type { SourceModels } from "@/hooks/use-available-models";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import ModelSelector from "@/components/ui/model-selector";
import { Monitor, Moon, Sun } from "lucide-react";

export interface PreferencesStepProps {
  sourceModelsMap: SourceModels[];
  allModels: AiModelSummary[];
  isLoadingModels: boolean;
}

const THEME_OPTIONS: { value: ThemePreference; icon: typeof Sun }[] = [
  { value: "system", icon: Monitor },
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
];

export default function PreferencesStep({ sourceModelsMap, allModels, isLoadingModels }: PreferencesStepProps) {
  const { t } = useTranslation("commons", { keyPrefix: "init-page.preferences" });
  const { theme, setTheme } = useTheme();
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const currentModel = useAiStore((s) => s.currentModel);
  const setCurrentModel = useAiStore((s) => s.setCurrentModel);
  const isLoading = isLoadingModels;

  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);

  const handleLanguageChange = (lang: "en" | "zh") => {
    setLanguage(lang);
    import("i18next").then(({ default: i18n }) => i18n.changeLanguage(lang));
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">{t("title")}</h2>
      <p className="-mt-4 text-sm text-muted-foreground">{t("description")}</p>

      <div>
        <Label className="text-sm font-medium">{t("theme.label")}</Label>
        <div className="mt-2 flex gap-2">
          {THEME_OPTIONS.map(({ value, icon: Icon }) => (
            <Button
              key={value}
              variant={theme === value ? "default" : "outline"}
              size="sm"
              onClick={() => setTheme(value)}
              className="gap-1.5"
            >
              <Icon className="h-3.5 w-3.5" />
              {t(`theme.${value}`)}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-sm font-medium">{t("language.label")}</Label>
        <div className="mt-2 flex gap-2">
          {(["en", "zh"] as const).map((lang) => (
            <Button
              key={lang}
              variant={language === lang ? "default" : "outline"}
              size="sm"
              onClick={() => handleLanguageChange(lang)}
            >
              {t(`language.${lang}`)}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-sm font-medium">{t("model.label")}</Label>
        {allModels.length > 0 ? (
          <div className="mt-2">
            <ModelSelector
              sourceModelsMap={sourceModelsMap}
              value={currentModel}
              onChangeAction={(model) => setCurrentModel(model)}
              open={modelSelectorOpen}
              onOpenChangeAction={setModelSelectorOpen}
              className="w-full"
            />
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {isLoading ? t("model.loading") : t("model.no-key")}
          </p>
        )}
      </div>
    </div>
  );
}
