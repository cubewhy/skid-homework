import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ThemePreference = "light" | "dark" | "system";
export type LanguagePreference = "en" | "zh";
export type ShortcutAction =
  | "upload"
  | "textInput"
  | "adbScreenshot"
  | "startScan"
  | "clearAll"
  | "openSettings"
  | "openChat"
  | "openGlobalTraitsEditor";

export type ShortcutMap = Record<ShortcutAction, string>;

export type ExplanationMode = "explanation" | "steps";

const DEFAULT_SHORTCUTS: ShortcutMap = {
  upload: "ctrl+1",
  textInput: "ctrl+i",
  startScan: "ctrl+3",
  clearAll: "ctrl+4",
  openSettings: "ctrl+6",
  adbScreenshot: "ctrl+2",
  openChat: "ctrl+shift+o",
  openGlobalTraitsEditor: "ctrl+o",
};

const DEFAULT_LANGUAGE: LanguagePreference = "en";

export interface SettingsState {
  imageEnhancement: boolean;
  setImageEnhancement: (imageEnhancement: boolean) => void;

  theme: ThemePreference;
  setThemePreference: (theme: ThemePreference) => void;

  language: LanguagePreference;
  languageInitialized: boolean;
  setLanguage: (language: LanguagePreference) => void;
  initializeLanguage: () => void;

  keybindings: ShortcutMap;
  setKeybinding: (action: ShortcutAction, binding: string) => void;
  resetKeybindings: () => void;

  traits: string;
  setTraits: (traits: string) => void;

  explanationMode: ExplanationMode;
  setExplanationMode: (explanationMode: ExplanationMode) => void;

  devtoolsEnabled: boolean;
  setDevtoolsState: (state: boolean) => void;

  clearDialogOnSubmit: boolean;
  setClearDialogOnSubmit: (state: boolean) => void;
  onlineSearchEnabled: boolean;
  setOnlineSearchEnabled: (state: boolean) => void;

  showModelSelectorInScanPage: boolean;
  setShowModelSelectorInScanPage: (state: boolean) => void;

  showOnlineSearchInScanPage: boolean;
  setShowOnlineSearchInScanPage: (state: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      imageEnhancement: false,
      theme: "system",
      language: DEFAULT_LANGUAGE,
      languageInitialized: false,
      keybindings: { ...DEFAULT_SHORTCUTS },
      traits: "",
      explanationMode: "explanation",
      devtoolsEnabled: false,
      clearDialogOnSubmit: true,
      onlineSearchEnabled: false,
      showModelSelectorInScanPage: false,
      showOnlineSearchInScanPage: false,

      setImageEnhancement: (imageEnhancement) => set({ imageEnhancement }),
      setThemePreference: (theme) => set({ theme }),
      setLanguage: (language) =>
        set({
          language,
          languageInitialized: true,
        }),
      initializeLanguage: () =>
        set((state) => {
          if (state.languageInitialized) {
            return state;
          }
          const prefersZh =
            typeof navigator !== "undefined" &&
            navigator.language.toLowerCase().startsWith("zh");
          return {
            languageInitialized: true,
            language: prefersZh ? "zh" : "en",
          };
        }),
      setKeybinding: (action, binding) =>
        set((state) => ({
          keybindings: {
            ...state.keybindings,
            [action]: binding,
          },
        })),
      resetKeybindings: () => set({ keybindings: { ...DEFAULT_SHORTCUTS } }),
      setTraits: (traits) => set({ traits }),
      setExplanationMode: (explanationMode) => set({ explanationMode }),
      setDevtoolsState: (state) => set({ devtoolsEnabled: state }),
      setClearDialogOnSubmit: (state) => set({ clearDialogOnSubmit: state }),
      setOnlineSearchEnabled: (state) => set({ onlineSearchEnabled: state }),
      setShowModelSelectorInScanPage: (state) =>
        set({ showModelSelectorInScanPage: state }),
      setShowOnlineSearchInScanPage: (state) =>
        set({ showOnlineSearchInScanPage: state }),
    }),
    {
      name: "skidhw-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        imageEnhancement: state.imageEnhancement,
        theme: state.theme,
        language: state.language,
        languageInitialized: state.languageInitialized,
        keybindings: state.keybindings,
        traits: state.traits,
        explanationMode: state.explanationMode,
        devtoolsEnabled: state.devtoolsEnabled,
        clearDialogOnSubmit: state.clearDialogOnSubmit,
        onlineSearchEnabled: state.onlineSearchEnabled,
        showModelSelectorInScanPage: state.showModelSelectorInScanPage,
        showOnlineSearchInScanPage: state.showOnlineSearchInScanPage,
      }),
      version: 10,
      migrate: (persistedState, version) => {
        const data: Partial<SettingsState> & Record<string, unknown> =
          persistedState && typeof persistedState === "object"
            ? { ...(persistedState as Record<string, unknown>) }
            : {};

        if (version < 3) {
          data.keybindings = { ...DEFAULT_SHORTCUTS };
        }

        const existing = (data as { keybindings?: ShortcutMap }).keybindings;
        const legacyDevtools = (data as { devtools?: boolean }).devtools;
        const legacyShowModelSelectorInScanner = (
          data as { showModelSelectorInScanner?: boolean }
        ).showModelSelectorInScanner;
        const legacyShowOnlineSearchInScanner = (
          data as { showOnlineSearchInScanner?: boolean }
        ).showOnlineSearchInScanner;

        const migratedData = {
          ...data,
          keybindings: existing
            ? { ...DEFAULT_SHORTCUTS, ...existing }
            : { ...DEFAULT_SHORTCUTS },
          languageInitialized:
            (data as { languageInitialized?: boolean }).languageInitialized ??
            true,
          clearDialogOnSubmit:
            (data as { clearDialogOnSubmit?: boolean }).clearDialogOnSubmit ??
            true,
          onlineSearchEnabled:
            (data as { onlineSearchEnabled?: boolean }).onlineSearchEnabled ??
            false,
          imageEnhancement:
            (data as { imageEnhancement?: boolean }).imageEnhancement ??
            false,
          showModelSelectorInScanPage:
            (data as { showModelSelectorInScanPage?: boolean })
              .showModelSelectorInScanPage ??
            legacyShowModelSelectorInScanner ??
            false,
          showOnlineSearchInScanPage:
            (data as { showOnlineSearchInScanPage?: boolean })
              .showOnlineSearchInScanPage ??
            legacyShowOnlineSearchInScanner ??
            false,
          devtoolsEnabled:
            (data as { devtoolsEnabled?: boolean }).devtoolsEnabled ??
            legacyDevtools ??
            false,
        };

        delete (migratedData as Record<string, unknown>).devtools;
        delete (migratedData as Record<string, unknown>)
          .showModelSelectorInScanner;
        delete (migratedData as Record<string, unknown>)
          .showOnlineSearchInScanner;
        return migratedData;
      },
    },
  ),
);

export const getDefaultShortcuts = () => ({ ...DEFAULT_SHORTCUTS });
