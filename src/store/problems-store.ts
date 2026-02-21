import { create } from "zustand";
import { db, type HomeworkRecord } from "@/db/problems-db";
import { createJSONStorage, persist } from "zustand/middleware";

// --- TYPE DEFINITIONS ---

export type FileStatus = "success" | "pending" | "failed" | "processing";

export type FileItem = {
  id: string;
  file: File;
  displayName: string;
  mimeType: string;
  url: string; // Object URL for client-side preview
  source: "upload" | "camera";
  status: FileStatus;
};

export type Solution = {
  fileId: string;
  status: "success" | "processing" | "pending" | "failed";
  streamedOutput?: string | null;
  problems: ProblemSolution[];
  aiSourceId?: string;
};

export interface ExplanationStep {
  title: string;
  content: string;
}

export interface ProblemSolution {
  problem: string;
  answer: string;
  explanation: string;
  steps: ExplanationStep[];
}

export interface ProblemsState {
  // --- STATE ---
  imageItems: FileItem[];
  // Map Key is now the FileItem.id, not the URL
  imageSolutions: Map<string, Solution>;

  // Refactored: Stores the unique ID of the selected image
  selectedImageId?: string;
  selectedProblem: number;
  isWorking: boolean;
  isInitialized: boolean;

  // --- ACTIONS ---

  // Initialize from DB
  initializeStore: () => Promise<void>;

  // File Management
  addFileItems: (items: FileItem[]) => Promise<void>;
  renameFileItem: (id: string, newName: string) => Promise<void>;
  updateFileItem: (id: string, updates: Partial<FileItem>) => void;
  updateItemStatus: (id: string, status: FileItem["status"]) => void;
  removeImageItem: (id: string) => Promise<void>;
  clearAllItems: () => Promise<void>;

  // Problem Management
  updateProblem: (
    fileId: string,
    problemIndex: number,
    newAnswer: string,
    newExplanation: string,
    newSteps: ExplanationStep[],
  ) => void;

  // Solution Management
  addSolution: (solution: Solution) => void;
  updateSolution: (fileId: string, updates: Partial<Solution>) => void;
  appendStreamedOutput: (fileId: string, chunk: string) => void;
  clearStreamedOutput: (fileId: string) => void;
  removeSolutionsByIds: (ids: Set<string>) => void; // Renamed from ByUrls
  clearAllSolutions: () => void;

  // UI State
  setSelectedImageId: (id?: string) => void; // Renamed
  setSelectedProblem: (index: number) => void;
  setWorking: (isWorking: boolean) => void;
  stopWorking: () => void;
}

export const useProblemsStore = create<ProblemsState>()(
  persist(
    (set, get) => ({
      // --- INITIAL STATE ---
      imageItems: [],
      imageSolutions: new Map(),
      selectedImageId: undefined,
      selectedProblem: 0,
      isWorking: false,
      isInitialized: false,

      // --- ACTION IMPLEMENTATIONS ---

      initializeStore: async () => {
        // Prevent double initialization
        if (get().isInitialized) return;

        try {
          const records = await db.homeworks.orderBy("createdAt").toArray();

          const items: FileItem[] = [];
          const solutions = new Map<string, Solution>();

          for (const record of records) {
            // Reconstruct File object (metadata + blob)
            const file = new File([record.blob], record.fileName, {
              type: record.mimeType,
              lastModified: record.createdAt,
            });

            // Create a stable Object URL for this session
            const url = URL.createObjectURL(record.blob);

            items.push({
              id: record.id,
              file,
              displayName: file.name,
              mimeType: record.mimeType,
              source: record.source,
              status: record.status,
              url,
            });

            // Rehydrate solution if it exists
            if (record.solution) {
              // Sync the solution's ID key to the record ID
              const solution: Solution = {
                ...record.solution,
                fileId: record.id, // Ensure strict mapping
                // Remove legacy field if it exists in DB record
                imageUrl: undefined,
              } as Solution;

              solutions.set(record.id, solution);
            }
          }

          set({
            imageItems: items,
            imageSolutions: solutions,
            isInitialized: true,
          });
        } catch (error) {
          console.error("Failed to initialize store from DB:", error);
          set({ isInitialized: true });
        }
      },

      addFileItems: async (newItems) => {
        const now = Date.now();

        // Prepare records for DB
        const records: HomeworkRecord[] = newItems.map((item, index) => ({
          id: item.id,
          blob: item.file,
          fileName: item.displayName,
          mimeType: item.mimeType,
          source: item.source,
          status: item.status,
          createdAt: now + index,
          solution: undefined,
        }));

        set((state) => ({ imageItems: [...state.imageItems, ...newItems] }));

        try {
          await db.homeworks.bulkAdd(records);
        } catch (err) {
          console.error("Failed to persist items:", err);
        }
      },

      renameFileItem: async (id, newName) => {
        const items = get().imageItems;
        const oldItem = items.find((i) => i.id === id);

        if (!oldItem || oldItem.displayName === newName) return;

        const originalItem: FileItem = { ...oldItem };

        const newFile = new File([oldItem.file], newName, {
          type: oldItem.mimeType || oldItem.file.type,
          lastModified: Date.now(),
        });
        const newUrl = URL.createObjectURL(newFile);

        set((state) => ({
          imageItems: state.imageItems.map((item) =>
            item.id === id
              ? { ...item, file: newFile, url: newUrl, displayName: newName }
              : item,
          ),
          // Note: No need to update imageSolutions map because the Key is now 'id', which hasn't changed.
        }));

        try {
          await db.homeworks.update(id, {
            fileName: newName,
            blob: newFile,
          });

          // revoke old url after db operation succeeded
          if (originalItem.url) URL.revokeObjectURL(originalItem.url);
        } catch (error) {
          console.error("Failed to update database:", error);

          // rollback state in zustand
          set((state) => ({
            imageItems: state.imageItems.map((item) =>
              item.id === id ? originalItem : item,
            ),
          }));

          // revoke new url
          if (newUrl) URL.revokeObjectURL(newUrl);
        }
      },

      updateItemStatus: (id, status) => {
        set((state) => ({
          imageItems: state.imageItems.map((item) =>
            item.id === id ? { ...item, status } : item,
          ),
        }));
        db.homeworks.update(id, { status }).catch(console.error);
      },

      updateFileItem: (id, updates) => {
        set((state) => ({
          imageItems: state.imageItems.map((item) =>
            item.id === id ? { ...item, ...updates } : item,
          ),
        }));

        // Map FileItem updates to HomeworkRecord updates where applicable
        const dbUpdates: Partial<HomeworkRecord> = {};
        if (updates.status) dbUpdates.status = updates.status;

        if (Object.keys(dbUpdates).length > 0) {
          db.homeworks.update(id, dbUpdates).catch(console.error);
        }
      },

      removeImageItem: async (id) => {
        const state = get();
        const itemToRemove = state.imageItems.find((i) => i.id === id);

        // Revoke memory reference
        if (itemToRemove?.url) {
          URL.revokeObjectURL(itemToRemove.url);
        }

        set((state) => {
          const newSolutions = new Map(state.imageSolutions);
          // Clean up the solution from memory map using ID
          newSolutions.delete(id);

          return {
            imageItems: state.imageItems.filter((item) => item.id !== id),
            imageSolutions: newSolutions,
            // Reset selected if we deleted the active one
            selectedImageId:
              state.selectedImageId === id ? undefined : state.selectedImageId,
          };
        });

        await db.homeworks.delete(id);
      },

      updateProblem: (
        fileId,
        problemIndex,
        newAnswer,
        newExplanation,
        newSteps,
      ) => {
        set((state) => {
          const currentSolution = state.imageSolutions.get(fileId);
          if (!currentSolution) return state;

          const updatedProblems = [...currentSolution.problems];
          updatedProblems[problemIndex] = {
            ...updatedProblems[problemIndex],
            answer: newAnswer,
            explanation: newExplanation,
            steps: newSteps,
          };

          const updatedSolution = {
            ...currentSolution,
            problems: updatedProblems,
          };

          const newSolutionsMap = new Map(state.imageSolutions);
          newSolutionsMap.set(fileId, updatedSolution);

          // Sync to DB
          db.homeworks
            .update(fileId, { solution: updatedSolution })
            .catch(console.error);

          return { imageSolutions: newSolutionsMap };
        });
      },

      clearAllItems: async () => {
        // Revoke all URLs
        get().imageItems.forEach((i) => URL.revokeObjectURL(i.url));

        set({
          imageItems: [],
          imageSolutions: new Map(),
          selectedImageId: undefined,
        });

        await db.homeworks.clear();
      },

      addSolution: (newSolution) =>
        set((state) => {
          if (state.imageSolutions.has(newSolution.fileId)) {
            console.warn(`Solution for ${newSolution.fileId} already exists.`);
            return state;
          }
          const newSolutionsMap = new Map(state.imageSolutions);
          newSolutionsMap.set(newSolution.fileId, newSolution);

          // Sync to DB
          db.homeworks
            .update(newSolution.fileId, { solution: newSolution })
            .catch(console.error);

          return { imageSolutions: newSolutionsMap };
        }),

      updateSolution: (fileId, updates) =>
        set((state) => {
          const currentSolution = state.imageSolutions.get(fileId);
          if (!currentSolution) {
            console.error(
              `Attempted to update a non-existent solution for ID: ${fileId}`,
            );
            return state;
          }

          const updatedSolution = { ...currentSolution, ...updates };

          if (updates.status === "success") {
            updatedSolution.streamedOutput = null;
          }

          const newSolutionsMap = new Map(state.imageSolutions);
          newSolutionsMap.set(fileId, updatedSolution);

          // Sync to DB (Only persist significant updates, avoid saving while streaming)
          db.homeworks
            .update(fileId, { solution: updatedSolution })
            .catch(console.error);

          return { imageSolutions: newSolutionsMap };
        }),

      appendStreamedOutput: (fileId, chunk) =>
        set((state) => {
          // Memory only - do not sync to DB to avoid IO trashing
          const currentSolution = state.imageSolutions.get(fileId);
          if (!currentSolution) return state;

          const newSolutionsMap = new Map(state.imageSolutions);
          newSolutionsMap.set(fileId, {
            ...currentSolution,
            streamedOutput: (currentSolution.streamedOutput || "") + chunk,
          });

          return { imageSolutions: newSolutionsMap };
        }),

      clearStreamedOutput: (fileId) =>
        set((state) => {
          const currentSolution = state.imageSolutions.get(fileId);
          if (!currentSolution) return state;

          const newSolutionsMap = new Map(state.imageSolutions);
          newSolutionsMap.set(fileId, {
            ...currentSolution,
            streamedOutput: null,
          });

          return { imageSolutions: newSolutionsMap };
        }),

      removeSolutionsByIds: (idsToRemove) =>
        set((state) => {
          const newSolutionsMap = new Map(state.imageSolutions);

          idsToRemove.forEach((id) => {
            newSolutionsMap.delete(id);

            // Remove solution from DB record
            db.homeworks
              .update(id, { solution: undefined })
              .catch(console.error);
          });
          return { imageSolutions: newSolutionsMap };
        }),

      clearAllSolutions: () => {
        set({ imageSolutions: new Map() });
        // Clear all solutions in DB but keep files
        db.homeworks
          .toCollection()
          .modify({ solution: undefined })
          .catch(console.error);
      },

      setSelectedImageId: (selectedImageId) => set({ selectedImageId }),
      setSelectedProblem: (selectedProblem) => set({ selectedProblem }),
      setWorking: (isWorking) => set({ isWorking }),
      stopWorking: () => set({ isWorking: false }),
    }),
    {
      name: "problems-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        selectedImageId: state.selectedImageId,
        selectedProblem: state.selectedProblem,
      }),
    },
  ),
);
