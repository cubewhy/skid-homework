import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const TOTAL_STEPS = 4;

export interface InitStore {
  initCompleted: boolean;
  setInitCompleted: (completed: boolean) => void;

  currentStep: number;
  direction: 1 | -1;
  setCurrentStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
}

export const useInitStore = create<InitStore>()(
  persist(
    (set) => ({
      initCompleted: false,
      setInitCompleted: (completed) => set({ initCompleted: completed }),

      currentStep: 0,
      direction: 1,
      setCurrentStep: (step) =>
        set((state) => ({
          currentStep: step,
          direction: step > state.currentStep ? 1 : -1,
        })),
      nextStep: () =>
        set((state) => ({
          currentStep: Math.min(state.currentStep + 1, TOTAL_STEPS - 1),
          direction: 1,
        })),
      prevStep: () =>
        set((state) => ({
          currentStep: Math.max(state.currentStep - 1, 0),
          direction: -1,
        })),
    }),
    {
      name: "skidhw-init-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        initCompleted: state.initCompleted,
      }),
      version: 1,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== "object") {
          try {
            const aiRaw = localStorage.getItem("ai-storage");
            if (aiRaw) {
              const aiState = JSON.parse(aiRaw) as {
                state?: { sources?: { enabled?: boolean; apiKey?: string | null }[] };
              };
              const sources = aiState?.state?.sources ?? [];
              const hasKey = sources.some((s) => s.enabled && s.apiKey);
              if (hasKey) {
                return { initCompleted: true };
              }
            }
          } catch {
            // ignore
          }
          return { initCompleted: false };
        }
        return persistedState;
      },
    },
  ),
);
