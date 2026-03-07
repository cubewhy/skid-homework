"use client";

import { useQwenHintAutoToggle } from "@/hooks/useQwenHintAutoToggle";
import { type AiProvider, DEFAULT_GEMINI_BASE_URL, DEFAULT_OPENAI_BASE_URL, useAiStore, } from "@/store/ai-store";
import {
  type LanguagePreference,
  type ShortcutAction,
  type ThemePreference,
  useSettingsStore,
} from "@/store/settings-store";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useAvailableModels } from "@/hooks/use-available-models";
import ShortcutRecorder from "./ShortcutRecorder";
import { useTheme } from "../theme-provider";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "../ui/select";
import { Slider } from "../ui/slider";
import { Textarea } from "../ui/textarea";
import AIAPICredentialsManager from "./AIAPICredentialsManager";
import AISourceManager from "./AISourceManager";
import ExplanationModeSelector from "./ExplanationModeSelector";
import ModelSelector, { CUSTOM_MODEL_VALUE } from "../ui/model-selector.tsx";
import { RefreshCw } from "lucide-react";

export const DEFAULT_BASE_BY_PROVIDER: Record<AiProvider, string> = {
  gemini: DEFAULT_GEMINI_BASE_URL,
  openai: DEFAULT_OPENAI_BASE_URL,
};

type BackButtonProps = {
  href?: string | null;
};

function BackButton({ href }: BackButtonProps) {
  const { t } = useTranslation("commons", {
    keyPrefix: "settings-page",
  });

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Link href={href ?? "/"} className="w-full sm:flex-1">
        <Button className="w-full">
          {t("back")} <Kbd>ESC</Kbd>
        </Button>
      </Link>
    </div>
  );
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation("commons", {
    keyPrefix: "settings-page",
  });
  const isCompact = useMediaQuery("(max-width: 640px)");

  const searchParams = useSearchParams();

  const navTargetPath = searchParams.get("from");

  const sources = useAiStore((s) => s.sources);
  const activeSourceId = useAiStore((s) => s.activeSourceId);
  const setActiveSource = useAiStore((s) => s.setActiveSource);
  const fallbackModel = useAiStore((s) => s.fallbackModel);
  const currentModel = useAiStore((s) => s.currentModel);
  const updateSource = useAiStore((s) => s.updateSource);
  const setFallbackModel = useAiStore((s) => s.setFallbackModel);
  const setCurrentModel = useAiStore((s) => s.setCurrentModel);
  const isCustomModel = useAiStore((s) => s.isCustomModel);
  const setIsCustomModel = useAiStore((s) => s.setIsCustomModel);
  const isCustomFallback = useAiStore((s) => s.isCustomFallback);
  const setIsCustomFallback = useAiStore((s) => s.setIsCustomFallback);
  const customModelName = useAiStore((s) => s.customModelName);
  const setCustomModelName = useAiStore((s) => s.setCustomModelName);
  const customModelSourceId = useAiStore((s) => s.customModelSourceId);
  const setCustomModelSourceId = useAiStore((s) => s.setCustomModelSourceId);
  const customFallbackName = useAiStore((s) => s.customFallbackName);
  const setCustomFallbackName = useAiStore((s) => s.setCustomFallbackName);
  const customFallbackSourceId = useAiStore((s) => s.customFallbackSourceId);
  const setCustomFallbackSourceId = useAiStore(
    (s) => s.setCustomFallbackSourceId
  );

  const {
    imageEnhancement: imageEnhancement,
    setImageEnhancement: setImageEnhancement,
    showQwenHint,
    setShowQwenHint,
    onlineSearchEnabled,
    setOnlineSearchEnabled,
    showModelSelectorInScanner,
    setShowModelSelectorInScanner,
    showOnlineSearchInScanner,
    setShowOnlineSearchInScanner,
    theme: themePreference,
    setThemePreference,
    language,
    setLanguage,
    keybindings,
    setKeybinding,
    resetKeybindings,
    devtoolsEnabled,
    setDevtoolsState,
    clearDialogOnSubmit,
    setClearDialogOnSubmit,
  } = useSettingsStore((s) => s);

  const { theme: activeTheme, setTheme } = useTheme();

  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(
    null
  );

  const activeSource = useMemo(
    () => sources.find((source) => source.id === activeSourceId) ?? sources[0],
    [sources, activeSourceId]
  );
  useQwenHintAutoToggle(sources, showQwenHint, setShowQwenHint);

  const localTraits = useMemo(() => activeSource?.traits ?? "", [activeSource]);
  const localThinkingBudget = useMemo(
    () => activeSource?.thinkingBudget ?? 8192,
    [activeSource]
  );

  // Get enabled sources for custom model provider selector
  const enabledSources = useMemo(
    () => sources.filter((source) => source.enabled && source.apiKey),
    [sources]
  );

  const router = useRouter();

  // Use shared hook for available models
  const {
    sourceModelsMap,
    isLoading: modelsLoading,
    forceRefetch,
  } = useAvailableModels();

  const handleBack = useCallback(() => {
    if (navTargetPath) {
      router.push(navTargetPath);
    } else {
      router.push("/");
    }
  }, [router, navTargetPath]);
  useHotkeys("esc", handleBack);

  useEffect(() => {
    if (themePreference !== activeTheme) {
      setTheme(themePreference);
    }
  }, [themePreference, activeTheme, setTheme]);

  const themeOptions = useMemo(
    () => [
      {
        value: "system" as ThemePreference,
        label: t("appearance.theme.options.system"),
      },
      {
        value: "light" as ThemePreference,
        label: t("appearance.theme.options.light"),
      },
      {
        value: "dark" as ThemePreference,
        label: t("appearance.theme.options.dark"),
      },
    ],
    [t]
  );

  const languageOptions = useMemo(
    () => [
      {
        value: "en" as LanguagePreference,
        label: t("appearance.language.options.en"),
      },
      {
        value: "zh" as LanguagePreference,
        label: t("appearance.language.options.zh"),
      },
    ],
    [t]
  );

  const handleThemeSelect = (value: ThemePreference) => {
    setThemePreference(value);
    setTheme(value);
  };

  const handleLanguageSelect = (value: LanguagePreference) => {
    setLanguage(value);
    if (i18n.language !== value) {
      i18n.changeLanguage(value);
    }
  };

  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const [fallbackPopoverOpen, setFallbackPopoverOpen] = useState(false);

  const translateSettings = useCallback(
    (key: string) => t(key as never) as string,
    [t]
  );

  const shortcutItems = useMemo(() => {
    return [
      {
        action: "upload" as ShortcutAction,
        label: translateSettings("shortcuts.actions.upload.label"),
        description: translateSettings("shortcuts.actions.upload.description"),
      },
      {
        action: "textInput" as ShortcutAction,
        label: translateSettings("shortcuts.actions.text-input.label"),
        description: translateSettings(
          "shortcuts.actions.text-input.description"
        ),
      },
      !isCompact && {
        action: "adbScreenshot" as ShortcutAction,
        label: translateSettings("shortcuts.actions.adb-screenshot.label"),
        description: translateSettings(
          "shortcuts.actions.adb-screenshot.description"
        ),
      },
      {
        action: "startScan" as ShortcutAction,
        label: translateSettings("shortcuts.actions.start-scan.label"),
        description: translateSettings(
          "shortcuts.actions.start-scan.description"
        ),
      },
      {
        action: "clearAll" as ShortcutAction,
        label: translateSettings("shortcuts.actions.clear-all.label"),
        description: translateSettings(
          "shortcuts.actions.clear-all.description"
        ),
      },
      {
        action: "openSettings" as ShortcutAction,
        label: translateSettings("shortcuts.actions.open-settings.label"),
        description: translateSettings(
          "shortcuts.actions.open-settings.description"
        ),
      },
      {
        action: "openChat" as ShortcutAction,
        label: translateSettings("shortcuts.actions.open-chat.label"),
        description: translateSettings(
          "shortcuts.actions.open-chat.description"
        ),
      },
      {
        action: "openGlobalTraitsEditor" as ShortcutAction,
        label: translateSettings(
          "shortcuts.actions.open-global-traits-editor.label"
        ),
        description: translateSettings(
          "shortcuts.actions.open-global-traits-editor.description"
        ),
      },
    ].filter(Boolean) as Array<{
      action: ShortcutAction;
      label: string;
      description: string;
    }>;
  }, [translateSettings, isCompact]);

  const shortcutsTitle = translateSettings("shortcuts.title");
  const shortcutsDesc = translateSettings("shortcuts.desc");
  const shortcutsResetLabel = translateSettings("shortcuts.reset");

  const handleModelChange = (model: string) => {
    if (model === CUSTOM_MODEL_VALUE) {
      setIsCustomModel(true);
    } else {
      setIsCustomModel(false);
      setCurrentModel(model);
    }
    setModelPopoverOpen(false);
  };

  const handleFallbackChange = (model: string) => {
    if (model === CUSTOM_MODEL_VALUE) {
      setIsCustomFallback(true);
    } else {
      setIsCustomFallback(false);
      setFallbackModel(model || null);
    }
    setFallbackPopoverOpen(false);
  };

  const handleTraitsChange = (value: string) => {
    if (!activeSource) return;
    updateSource(activeSource.id, { traits: value || undefined });
  };

  const clearTraits = () => {
    if (!activeSource) return;
    updateSource(activeSource.id, { traits: undefined });
  };

  const handleThinkingBudgetChange = (value: number) => {
    if (!activeSource) return;
    updateSource(activeSource.id, { thinkingBudget: value });
  };

  return (
    <>
      <div className="mx-auto max-w-3xl space-y-8 p-4 md:p-8">
        <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>

        <BackButton href={navTargetPath} />

        <AISourceManager />

        <AIAPICredentialsManager
          key={activeSource.id}
          activeSource={activeSource}
        />

        <Card>
          <CardHeader>
            <CardTitle>{t("appearance.title")}</CardTitle>
            <CardDescription>{t("appearance.desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="theme-select">
                {t("appearance.theme.label")}
              </Label>
              <select
                id="theme-select"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                value={themePreference}
                onChange={(event) =>
                  handleThemeSelect(event.target.value as ThemePreference)
                }
              >
                {themeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {t("appearance.theme.desc")}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="language-select">
                {t("appearance.language.label")}
              </Label>
              <select
                id="language-select"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                value={language}
                onChange={(event) =>
                  handleLanguageSelect(event.target.value as LanguagePreference)
                }
              >
                {languageOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {t("appearance.language.desc")}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{shortcutsTitle}</CardTitle>
            <CardDescription>{shortcutsDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {shortcutItems.map((item) => (
              <div
                key={item.action}
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{item.label}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.description}
                  </p>
                </div>
                <ShortcutRecorder
                  value={keybindings[item.action] ?? ""}
                  onChange={(combo) => setKeybinding(item.action, combo)}
                  isRecording={recordingAction === item.action}
                  onRecordingChange={(state) => {
                    if (!state) {
                      setRecordingAction(null);
                    } else {
                      setRecordingAction(item.action);
                    }
                  }}
                />
              </div>
            ))}
            <Button variant="ghost" onClick={resetKeybindings} className="mt-2">
              {shortcutsResetLabel}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("model.title")}</CardTitle>
            <CardDescription>{t("model.desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <ModelSelector
                sourceModelsMap={sourceModelsMap}
                value={currentModel}
                onChange={handleModelChange}
                open={modelPopoverOpen}
                onOpenChange={setModelPopoverOpen}
                allowCustom={true}
                isCustomSelected={isCustomModel}
                className="flex-2"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => void forceRefetch()}
                disabled={modelsLoading}
                title={t("model.refresh")}
              >
                <RefreshCw
                  className={`h-4 w-4 ${modelsLoading ? "animate-spin" : ""}`}
                />
              </Button>
            </div>
            {isCustomModel && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Select
                    value={customModelSourceId}
                    onValueChange={(value) => {
                      setCustomModelSourceId(value);
                    }}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue
                        placeholder={t("model.manual.select-provider")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {enabledSources.map((source) => (
                        <SelectItem key={source.id} value={source.id}>
                          {source.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    id="model-manual"
                    className="flex-1"
                    value={customModelName}
                    onChange={(event) => {
                      setCustomModelName(event.target.value);
                    }}
                    onBlur={() => {
                      // Only apply custom model when user finishes editing
                      if (customModelSourceId && customModelName.trim()) {
                        setActiveSource(customModelSourceId);
                        setCurrentModel(customModelName.trim());
                      }
                    }}
                    placeholder={t("model.manual.placeholder")}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("model.manual.desc")}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="show-model-selector"
                  checked={showModelSelectorInScanner}
                  onCheckedChange={(state) =>
                    setShowModelSelectorInScanner(Boolean(state))
                  }
                />
                <Label htmlFor="show-model-selector">
                  {t("model.show-selector-in-scanner")}
                </Label>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-retries">
                {t("model.max-retries.label")}
              </Label>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Slider
                    value={[activeSource?.maxRetries ?? 5]}
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
                  id="max-retries"
                  className="w-16"
                  type="number"
                  min={0}
                  max={10}
                  value={activeSource?.maxRetries ?? 5}
                  onChange={(event) => {
                    if (!activeSource) return;
                    const val = parseInt(event.target.value, 10);
                    updateSource(activeSource.id, {
                      maxRetries: isNaN(val)
                        ? 5
                        : Math.max(0, Math.min(10, val)),
                    });
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("model.max-retries.tip")}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{t("model.fallback.label")}</Label>
              <ModelSelector
                sourceModelsMap={sourceModelsMap}
                value={fallbackModel}
                onChange={handleFallbackChange}
                open={fallbackPopoverOpen}
                onOpenChange={setFallbackPopoverOpen}
                allowNone={true}
                noneLabel={t("model.fallback.none")}
                allowCustom={true}
                isCustomSelected={isCustomFallback}
                excludeModel={currentModel}
                className="w-full"
              />
              {isCustomFallback && (
                <div className="flex items-center gap-2 mt-2">
                  <Select
                    value={customFallbackSourceId}
                    onValueChange={(value) => {
                      setCustomFallbackSourceId(value);
                    }}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue
                        placeholder={t("model.manual.select-provider")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {enabledSources.map((source) => (
                        <SelectItem key={source.id} value={source.id}>
                          {source.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="flex-1"
                    value={customFallbackName}
                    onChange={(event) => {
                      setCustomFallbackName(event.target.value);
                    }}
                    onBlur={() => {
                      // Only apply custom fallback model when user finishes editing
                      if (customFallbackSourceId && customFallbackName.trim()) {
                        setFallbackModel(customFallbackName.trim());
                      }
                    }}
                    placeholder={t("model.manual.placeholder")}
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t("model.fallback.desc")}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("thinking.title")}</CardTitle>
            <CardDescription>{t("thinking.desc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeSource?.provider === "gemini" && (
              <div className="space-y-2">
                <Label>{t("thinking.budget")}</Label>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Slider
                      value={[localThinkingBudget]}
                      onValueChange={(value) =>
                        handleThinkingBudgetChange(value[0])
                      }
                      min={128}
                      max={24576}
                      step={1}
                    />
                  </div>
                  <Input
                    className="w-24"
                    value={localThinkingBudget}
                    type="number"
                    min={128}
                    max={24576}
                    onChange={(event) =>
                      handleThinkingBudgetChange(
                        Math.max(
                          128,
                          Math.min(24576, Number(event.target.value) || 128)
                        )
                      )
                    }
                  />
                  <span>{t("thinking.tokens-unit")}</span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="online-search-toggle">
                {t("thinking.online-search.title")}
              </Label>
              <div className="flex items-center gap-3">
                <Checkbox
                  id="online-search-toggle"
                  checked={onlineSearchEnabled}
                  onCheckedChange={(state) =>
                    setOnlineSearchEnabled(state === true)
                  }
                />
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    {t("thinking.online-search.toggle.settings")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("thinking.online-search.desc")}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="show-online-search-scanner"
                  checked={showOnlineSearchInScanner}
                  onCheckedChange={(state) =>
                    setShowOnlineSearchInScanner(state === true)
                  }
                />
                <Label htmlFor="show-online-search-scanner">
                  {t("thinking.online-search.show-toggle-in-scanner")}
                </Label>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="traits-input">{t("traits.title")}</Label>
              <div className="relative">
                <Textarea
                  id="traits-input"
                  className="min-h-25 pr-20"
                  value={localTraits}
                  onChange={(event) => handleTraitsChange(event.target.value)}
                  placeholder={t("traits.placeholder")}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-2"
                  onClick={clearTraits}
                  disabled={!localTraits}
                >
                  {t("clear-input")}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {t("traits.desc")}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("advanced.title")}</CardTitle>
            <CardDescription>{t("advanced.desc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Checkbox
                id="image-enhancement"
                checked={imageEnhancement}
                onCheckedChange={(state) =>
                  setImageEnhancement(state as boolean)
                }
              />
              <Label htmlFor="image-enhancement">
                {t("advanced.image-post-processing.enhancement")}
              </Label>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox
                id="show-qwen-hint"
                checked={showQwenHint}
                onCheckedChange={(state) => setShowQwenHint(Boolean(state))}
              />
              <Label htmlFor="show-qwen-hint">
                {t("advanced.ui.show-qwen-hint")}
              </Label>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox
                id="devtools-enabled"
                checked={devtoolsEnabled}
                onCheckedChange={(state) => setDevtoolsState(Boolean(state))}
              />
              <Label htmlFor="devtools-enabled">Enable Devtools</Label>
            </div>

            <div className="flex items-center gap-3">
              <Checkbox
                id="clear-dialog-on-submit"
                checked={clearDialogOnSubmit}
                onCheckedChange={(state) =>
                  setClearDialogOnSubmit(state === true)
                }
              />
              <Label htmlFor="clear-dialog-on-submit">
                {t("advanced.ui.clear-dialog-on-submit")}
              </Label>
            </div>

            <div className="flex items-center gap-3">
              <Label>{t("advanced.explanation.title")}</Label>

              <ExplanationModeSelector />
            </div>
          </CardContent>
        </Card>

        <BackButton href={navTargetPath} />
      </div>
    </>
  );
}
