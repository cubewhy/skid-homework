"use client";

import { useQwenHintAutoToggle } from "@/hooks/useQwenHintAutoToggle";
import { cn } from "@/lib/utils";
import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  useAiStore,
  type AiModelSummary,
  type AiProvider,
} from "@/store/ai-store";
import {
  useSettingsStore,
  type LanguagePreference,
  type ShortcutAction,
  type ThemePreference,
} from "@/store/settings-store";
import { Check, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMediaQuery } from "@/hooks/use-media-query";
import ShortcutRecorder from "./ShortcutRecorder";
import { useTheme } from "../theme-provider";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { Label } from "../ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Slider } from "../ui/slider";
import { Textarea } from "../ui/textarea";
import AIAPICredentialsManager from "./AIAPICredentialsManager";
import AISourceManager from "./AISourceManager";
import ExplanationModeSelector from "./ExplanationModeSelector";

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
  const updateSource = useAiStore((s) => s.updateSource);
  const getClientForSource = useAiStore((s) => s.getClientForSource);

  const {
    imageEnhancement: imageEnhancement,
    setImageEnhancement: setImageEnhancement,
    showQwenHint,
    setShowQwenHint,
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

  const activeSource = useMemo(
    () => sources.find((source) => source.id === activeSourceId) ?? sources[0],
    [sources, activeSourceId],
  );
  useQwenHintAutoToggle(sources, showQwenHint, setShowQwenHint);

  const localTraits = useMemo(() => activeSource?.traits ?? "", [activeSource]);
  const localThinkingBudget = useMemo(
    () => activeSource?.thinkingBudget ?? 8192,
    [activeSource],
  );

  const [availableModels, setAvailableModels] = useState<AiModelSummary[]>([]);
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);

  const router = useRouter();
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
    [t],
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
    [t],
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
      toast.error(
        t("model.fetch.error", {
          provider: activeSource.name,
        }),
      );
    }
  }, [activeSource, getClientForSource, t]);

  useEffect(() => {
    const execute = async () => {
      await loadModels();
    };

    execute();
  }, [loadModels]);

  const translateSettings = useCallback(
    (key: string) => t(key as never) as string,
    [t],
  );

  const shortcutItems = useMemo(() => {
    return [
      {
        action: "upload" as ShortcutAction,
        label: translateSettings("shortcuts.actions.upload.label"),
        description: translateSettings("shortcuts.actions.upload.description"),
      },
      {
        action: "camera" as ShortcutAction,
        label: translateSettings("shortcuts.actions.camera.label"),
        description: translateSettings("shortcuts.actions.camera.description"),
      },
      {
        action: "textInput" as ShortcutAction,
        label: translateSettings("shortcuts.actions.text-input.label"),
        description: translateSettings("shortcuts.actions.text-input.description"),
      },
      !isCompact && {
        action: "adbScreenshot" as ShortcutAction,
        label: translateSettings("shortcuts.actions.adb-screenshot.label"),
        description: translateSettings(
          "shortcuts.actions.adb-screenshot.description",
        ),
      },
      {
        action: "startScan" as ShortcutAction,
        label: translateSettings("shortcuts.actions.start-scan.label"),
        description: translateSettings(
          "shortcuts.actions.start-scan.description",
        ),
      },
      {
        action: "clearAll" as ShortcutAction,
        label: translateSettings("shortcuts.actions.clear-all.label"),
        description: translateSettings(
          "shortcuts.actions.clear-all.description",
        ),
      },
      {
        action: "openSettings" as ShortcutAction,
        label: translateSettings("shortcuts.actions.open-settings.label"),
        description: translateSettings(
          "shortcuts.actions.open-settings.description",
        ),
      },
      {
        action: "openChat" as ShortcutAction,
        label: translateSettings("shortcuts.actions.open-chat.label"),
        description: translateSettings(
          "shortcuts.actions.open-chat.description",
        ),
      },
      {
        action: "openGlobalTraitsEditor" as ShortcutAction,
        label: translateSettings(
          "shortcuts.actions.open-global-traits-editor.label",
        ),
        description: translateSettings(
          "shortcuts.actions.open-global-traits-editor.description",
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

  const handleModelSelect = (model: string) => {
    if (!activeSource) return;
    updateSource(activeSource.id, { model });
    setModelPopoverOpen(false);
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

  const modelDisplay = useMemo(() => {
    if (!activeSource) return "";
    if (!activeSource.model) return t("model.sel.none");
    const match = availableModels.find(
      (model) => model.name === activeSource.model,
    );
    return match
      ? match.displayName
      : t("model.sel.unknown", { name: activeSource.model });
  }, [activeSource, availableModels, t]);

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
              <Popover
                open={modelPopoverOpen}
                onOpenChange={setModelPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={modelPopoverOpen}
                    className="flex-2 justify-between"
                  >
                    {modelDisplay}
                    <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0">
                  <Command>
                    <CommandInput placeholder={t("model.sel.search")} />
                    <CommandList>
                      <CommandEmpty>{t("model.sel.empty")}</CommandEmpty>
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
              <Button variant="outline" onClick={loadModels} className="flex-1">
                {t("model.refresh")}
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="model-manual">{t("model.manual.title")}</Label>
              <Input
                id="model-manual"
                value={activeSource?.model ?? ""}
                onChange={(event) =>
                  activeSource &&
                  updateSource(activeSource.id, { model: event.target.value })
                }
                placeholder={t("model.manual.placeholder")}
              />
              <p className="text-xs text-muted-foreground">
                {t("model.manual.desc")}
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
                          Math.min(24576, Number(event.target.value) || 128),
                        ),
                      )
                    }
                  />
                  <span>{t("thinking.tokens-unit")}</span>
                </div>
              </div>
            )}

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
                onCheckedChange={(state) => setClearDialogOnSubmit(Boolean(state))}
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
