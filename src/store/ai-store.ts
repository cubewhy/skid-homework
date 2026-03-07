import { GeminiAi } from "@/ai/gemini";
import { v4 as uuidv4 } from "uuid";
import { OpenAiClient } from "@/ai/openai";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AiChatMessage } from "@/ai/chat-types";

export type AiProvider = "gemini" | "openai";

export type AiModelSummary = {
  name: string;
  displayName: string;
};

export interface AiSource {
  id: string;
  name: string;
  provider: AiProvider;
  apiKey: string | null;
  baseUrl?: string;
  traits?: string;
  thinkingBudget?: number;
  useResponsesApi?: boolean;
  webSearchToolType?: string;
  maxRetries?: number;
  enabled: boolean;
}

export function sourceSupportsFileUpload(source: AiSource): boolean {
  return (
    source.provider === "gemini" ||
    (source.provider === "openai" && !!source.useResponsesApi)
  );
}

export type ImportAISourceModel = {
  name: string;
  model: string;
  provider: AiProvider;
  baseUrl?: string;
  key?: string;
};

export interface AiFile {
  data: string;
  mimeType: string;
  name: string;
}

export interface AiClient {
  setAvailableTools: (prompts: string[]) => void;
  addSystemPrompt: (prompt: string) => void;
  sendMedia: (
    file: AiFile,
    prompt?: string,
    model?: string,
    callback?: (text: string) => void,
    options?: { onlineSearch?: boolean }
  ) => Promise<string>;
  getAvailableModels?: () => Promise<AiModelSummary[]>;
  sendChat?: (
    messages: AiChatMessage[],
    model?: string,
    callback?: (text: string) => void,
    options?: { onlineSearch?: boolean }
  ) => Promise<string>;
}

export const DEFAULT_GEMINI_MODEL = "models/gemini-2.5-flash";
export const DEFAULT_GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com";
export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

function loadLegacyGemini(): {
  source: Partial<AiSource>;
  model: string;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const legacyRaw = window.localStorage.getItem("gemini-storage");
    if (!legacyRaw) return null;
    const parsed = JSON.parse(legacyRaw) as {
      state?: {
        geminiKey?: string | null;
        geminiBaseUrl?: string;
        geminiModel?: string;
        traits?: string;
        thinkingBudget?: number;
      };
    };
    const legacyState = parsed?.state;
    if (!legacyState) return null;
    return {
      source: {
        apiKey: legacyState.geminiKey ?? null,
        baseUrl: legacyState.geminiBaseUrl ?? DEFAULT_GEMINI_BASE_URL,
        traits: legacyState.traits,
        thinkingBudget: legacyState.thinkingBudget ?? 8192,
      },
      model: legacyState.geminiModel ?? DEFAULT_GEMINI_MODEL,
    };
  } catch (error) {
    console.warn("Failed to migrate legacy Gemini configuration", error);
    return null;
  }
}

// Memoize legacy config to avoid duplicate localStorage reads during initialization
const legacyGeminiConfig = loadLegacyGemini();

function createDefaultSources(): AiSource[] {
  return [
    {
      id: "gemini-default",
      name: "Gemini",
      provider: "gemini",
      apiKey: legacyGeminiConfig?.source.apiKey ?? null,
      baseUrl: legacyGeminiConfig?.source.baseUrl ?? DEFAULT_GEMINI_BASE_URL,
      traits: legacyGeminiConfig?.source.traits,
      thinkingBudget: legacyGeminiConfig?.source.thinkingBudget ?? 8192,
      enabled: true,
    },
    {
      id: "openai-default",
      name: "OpenAI",
      provider: "openai",
      apiKey: null,
      baseUrl: DEFAULT_OPENAI_BASE_URL,
      traits: undefined,
      thinkingBudget: undefined,
      useResponsesApi: true,
      enabled: false,
    },
  ];
}

function loadLegacyModel(): string {
  return legacyGeminiConfig?.model ?? DEFAULT_GEMINI_MODEL;
}

function createClientForSource(source: AiSource): AiClient | null {
  if (!source.apiKey) return null;

  if (source.provider === "gemini") {
    return new GeminiAi(source.apiKey, source.baseUrl, {
      thinkingBudget: source.thinkingBudget,
    });
  }

  if (source.provider === "openai") {
    return new OpenAiClient(
      source.apiKey,
      source.baseUrl,
      source.useResponsesApi,
      source.webSearchToolType
    );
  }

  return null;
}

export interface AiStore {
  sources: AiSource[];
  activeSourceId: string;
  fallbackModel: string | null;
  currentModel: string;
  isCustomModel: boolean;
  isCustomFallback: boolean;
  customModelName: string;
  customModelSourceId: string;
  customFallbackName: string;
  customFallbackSourceId: string;

  addSource: (source: Omit<AiSource, "id">) => string;
  updateSource: (id: string, updates: Partial<AiSource>) => void;
  removeSource: (id: string) => void;
  toggleSource: (id: string, enabled: boolean) => void;
  setActiveSource: (id: string) => void;
  setFallbackModel: (model: string | null) => void;
  setCurrentModel: (model: string) => void;
  setIsCustomModel: (isCustom: boolean) => void;
  setIsCustomFallback: (isCustom: boolean) => void;
  setCustomModelName: (name: string) => void;
  setCustomModelSourceId: (id: string) => void;
  setCustomFallbackName: (name: string) => void;
  setCustomFallbackSourceId: (id: string) => void;

  getActiveSource: () => AiSource | null;
  getEnabledSources: () => AiSource[];
  getSourceById: (id: string) => AiSource | undefined;
  hasActiveKey: () => boolean;
  allowPdfUpload: () => boolean;
  getClientForSource: (id?: string) => AiClient | null;
}

export const useAiStore = create<AiStore>()(
  persist(
    (set, get) => ({
      sources: createDefaultSources(),
      activeSourceId: "gemini-default",
      fallbackModel: null,
      currentModel: loadLegacyModel(),
      isCustomModel: false,
      isCustomFallback: false,
      customModelName: "",
      customModelSourceId: "",
      customFallbackName: "",
      customFallbackSourceId: "",

      addSource: (source) => {
        const id = uuidv4();
        set((state) => ({
          sources: [
            ...state.sources,
            {
              ...source,
              id,
            },
          ],
        }));
        return id;
      },

      updateSource: (id, updates) =>
        set((state) => ({
          sources: state.sources.map((source) =>
            source.id === id ? { ...source, ...updates } : source
          ),
        })),

      removeSource: (id) =>
        set((state) => {
          const nextSources = state.sources.filter(
            (source) => source.id !== id
          );

          const nextActive =
            state.activeSourceId === id
              ? (nextSources.find((source) => source.enabled)?.id ??
                nextSources[0]?.id ??
                "gemini-default")
              : state.activeSourceId;

          return {
            sources: nextSources,
            activeSourceId: nextActive,
          };
        }),

      toggleSource: (id, enabled) =>
        set((state) => ({
          sources: state.sources.map((source) =>
            source.id === id ? { ...source, enabled } : source
          ),
        })),

      setActiveSource: (id) =>
        set((state) => {
          const exists = state.sources.some((source) => source.id === id);
          return exists ? { activeSourceId: id } : state;
        }),

      setFallbackModel: (model) => set({ fallbackModel: model }),

      setCurrentModel: (model) => set({ currentModel: model }),

      setIsCustomModel: (isCustom) => set({ isCustomModel: isCustom }),

      setIsCustomFallback: (isCustom) => set({ isCustomFallback: isCustom }),

      setCustomModelName: (name) => set({ customModelName: name }),

      setCustomModelSourceId: (id) => set({ customModelSourceId: id }),

      setCustomFallbackName: (name) => set({ customFallbackName: name }),

      setCustomFallbackSourceId: (id) => set({ customFallbackSourceId: id }),

      getActiveSource: () => {
        const state = get();
        const explicit = state.sources.find(
          (source) =>
            source.id === state.activeSourceId &&
            source.enabled &&
            Boolean(source.apiKey)
        );
        if (explicit) {
          return explicit;
        }

        const firstEnabled = state.sources.find(
          (source) => source.enabled && Boolean(source.apiKey)
        );
        if (firstEnabled) {
          return firstEnabled;
        }

        return state.sources[0] ?? null;
      },

      getEnabledSources: () =>
        get().sources.filter((source) => source.enabled && source.apiKey),

      getSourceById: (id) => get().sources.find((source) => source.id === id),

      hasActiveKey: () => {
        return get().getEnabledSources().length > 0;
      },

      allowPdfUpload: () => {
        return get().getEnabledSources().some(sourceSupportsFileUpload);
      },

      getClientForSource: (id) => {
        const state = get();
        if (id) {
          const explicitSource = state.sources.find((entry) => entry.id === id);
          return explicitSource ? createClientForSource(explicitSource) : null;
        }

        const active = state.getActiveSource();
        if (!active) {
          return null;
        }
        return createClientForSource(active);
      },
    }),
    {
      name: "ai-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sources: state.sources,
        activeSourceId: state.activeSourceId,
        fallbackModel: state.fallbackModel,
        currentModel: state.currentModel,
        isCustomModel: state.isCustomModel,
        isCustomFallback: state.isCustomFallback,
        customModelName: state.customModelName,
        customModelSourceId: state.customModelSourceId,
        customFallbackName: state.customFallbackName,
        customFallbackSourceId: state.customFallbackSourceId,
      }),
      version: 4,
      migrate: (persistedState, version) => {
        const data =
          persistedState && typeof persistedState === "object"
            ? { ...(persistedState as Record<string, unknown>) }
            : {};
        if (version < 3) {
          // Migrate model from active source to global currentModel
          const sources = data.sources as AiSource[] | undefined;
          const activeSourceId = data.activeSourceId as string | undefined;
          const activeSource = sources?.find((s) => s.id === activeSourceId);
          // Use legacy model from source or default
          data.currentModel =
            (activeSource as Record<string, unknown> | undefined)?.model ??
            DEFAULT_GEMINI_MODEL;
          // Remove model from all sources
          if (sources) {
            data.sources = sources.map((s) => {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { model: _removed, ...rest } = s as AiSource & {
                model?: string;
              };
              return rest;
            });
          }
        }
        if (version < 4) {
          // Migrate fallbackSourceId to fallbackModel (set to null)
          delete data.fallbackSourceId;
          data.fallbackModel = null;
        }
        return data;
      },
    }
  )
);

export const useHasActiveAiKey = () =>
  useAiStore((state) => state.hasActiveKey());
