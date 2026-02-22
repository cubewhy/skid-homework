import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ThemePreference = "light" | "dark" | "system";
export type LanguagePreference = "en" | "zh";
export type ShortcutAction =
  | "upload"
  | "camera"
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
  camera: "ctrl+2",
  textInput: "ctrl+3",
  startScan: "ctrl+4",
  clearAll: "ctrl+5",
  openSettings: "ctrl+6",
  adbScreenshot: "ctrl+7",
  openChat: "ctrl+e",
  openGlobalTraitsEditor: "ctrl+x",
};

const DEFAULT_LANGUAGE: LanguagePreference = "en";

const DISABLE_QWEN_HINT_DEFAULT =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_DISABLE_QWEN_HINT === "true";
export const SHOULD_SHOW_QWEN_HINT_DEFAULT = !DISABLE_QWEN_HINT_DEFAULT;

export interface SettingsState {
  imageEnhancement: boolean;
  setImageEnhancement: (imagePostprocessing: boolean) => void;

  showQwenHint: boolean;
  setShowQwenHint: (show: boolean) => void;

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
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      imageEnhancement: false,
      showQwenHint: SHOULD_SHOW_QWEN_HINT_DEFAULT,
      theme: "system",
      language: DEFAULT_LANGUAGE,
      languageInitialized: false,
      keybindings: { ...DEFAULT_SHORTCUTS },
      traits: "",
      explanationMode: "explanation",
      devtoolsEnabled: false,
      clearDialogOnSubmit: true,

      setImageEnhancement: (state) => set({ imageEnhancement: state }),
      setShowQwenHint: (state) => set({ showQwenHint: state }),
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
    }),
    {
      name: "skidhw-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        imageEnhancement: state.imageEnhancement,
        showQwenHint: state.showQwenHint,
        theme: state.theme,
        language: state.language,
        languageInitialized: state.languageInitialized,
        keybindings: state.keybindings,
        traits: state.traits,
        explanationMode: state.explanationMode,
        devtools: state.devtoolsEnabled,
        clearDialogOnSubmit: state.clearDialogOnSubmit,
      }),
      version: 7,
      migrate: (persistedState, version) => {
        const data: Partial<SettingsState> & Record<string, unknown> =
          persistedState && typeof persistedState === "object"
            ? { ...(persistedState as Record<string, unknown>) }
            : {};

        if (version < 3) {
          data.keybindings = { ...DEFAULT_SHORTCUTS };
        }

        const existing = (data as { keybindings?: ShortcutMap }).keybindings;

        return {
          ...data,
          keybindings: existing
            ? { ...DEFAULT_SHORTCUTS, ...existing }
            : { ...DEFAULT_SHORTCUTS },
          showQwenHint:
            (data as { showQwenHint?: boolean }).showQwenHint ??
            SHOULD_SHOW_QWEN_HINT_DEFAULT,
          languageInitialized:
            (data as { languageInitialized?: boolean }).languageInitialized ??
            true,
          clearDialogOnSubmit:
            (data as { clearDialogOnSubmit?: boolean }).clearDialogOnSubmit ??
            true,
        };
      },
    },
  ),
);

export const getDefaultShortcuts = () => ({ ...DEFAULT_SHORTCUTS });
