import { create } from "zustand";
import { db, type HomeworkRecord } from "@/db/problems-db";

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
  imageUrl: string; // Effectively the ID/Key for the solution map
  status: "success" | "processing" | "failed";
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
  imageSolutions: Map<string, Solution>;
  // The url of the active image
  // TODO: refactor selectedImage, use id instead of blob url
  selectedImage?: string;
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
    imageUrl: string,
    problemIndex: number,
    newAnswer: string,
    newExplanation: string,
    newSteps: ExplanationStep[],
  ) => void;

  // Solution Management
  addSolution: (solution: Solution) => void;
  updateSolution: (imageUrl: string, updates: Partial<Solution>) => void;
  appendStreamedOutput: (imageUrl: string, chunk: string) => void;
  clearStreamedOutput: (imageUrl: string) => void;
  removeSolutionsByUrls: (urls: Set<string>) => void;
  clearAllSolutions: () => void;

  // UI State
  setSelectedImage: (image?: string) => void;
  setSelectedProblem: (index: number) => void;
  setWorking: (isWorking: boolean) => void;
}

export const useProblemsStore = create<ProblemsState>((set, get) => ({
  // --- INITIAL STATE ---
  imageItems: [],
  imageSolutions: new Map(),
  selectedImage: undefined,
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
          // Important: Sync the solution's ID key to the new Object URL
          // so the frontend can look it up by the <img> src
          const solution = { ...record.solution, imageUrl: url };
          solutions.set(url, solution);
        }
      }

      set({
        imageItems: items,
        imageSolutions: solutions,
        isInitialized: true,
      });
    } catch (error) {
      console.error("Failed to initialize store from DB:", error);
      // Even on error, mark initialized to prevent infinite loading screens
      set({ isInitialized: true });
    }
  },

  addFileItems: async (newItems) => {
    // Optimistic UI update
    set((state) => ({ imageItems: [...state.imageItems, ...newItems] }));

    // Prepare records for DB
    const records: HomeworkRecord[] = newItems.map((item) => ({
      id: item.id,
      blob: item.file,
      fileName: item.displayName,
      mimeType: item.mimeType,
      source: item.source,
      status: item.status,
      createdAt: Date.now(),
      solution: undefined,
    }));

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
    }));

    try {
      await db.homeworks.update(id, {
        fileName: newName,
        blob: newFile,
      });

      // revoke old url after db operation successed
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
      // Clean up the solution from memory map if keyed by URL
      if (itemToRemove?.url) {
        newSolutions.delete(itemToRemove.url);
      }
      return {
        imageItems: state.imageItems.filter((item) => item.id !== id),
        imageSolutions: newSolutions,
      };
    });

    await db.homeworks.delete(id);
  },

  updateProblem: (
    imageUrl,
    problemIndex,
    newAnswer,
    newExplanation,
    newSteps,
  ) => {
    set((state) => {
      const currentSolution = state.imageSolutions.get(imageUrl);
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
      newSolutionsMap.set(imageUrl, updatedSolution);

      // Sync to DB
      const fileItem = state.imageItems.find((i) => i.url === imageUrl);
      if (fileItem) {
        db.homeworks
          .update(fileItem.id, { solution: updatedSolution })
          .catch(console.error);
      }

      return { imageSolutions: newSolutionsMap };
    });
  },

  clearAllItems: async () => {
    // Revoke all URLs
    get().imageItems.forEach((i) => URL.revokeObjectURL(i.url));

    set({
      imageItems: [],
      imageSolutions: new Map(),
      selectedImage: undefined,
    });

    await db.homeworks.clear();
  },

  addSolution: (newSolution) =>
    set((state) => {
      if (state.imageSolutions.has(newSolution.imageUrl)) {
        console.warn(`Solution for ${newSolution.imageUrl} already exists.`);
        return state;
      }
      const newSolutionsMap = new Map(state.imageSolutions);
      newSolutionsMap.set(newSolution.imageUrl, newSolution);

      // Sync to DB
      const fileItem = state.imageItems.find(
        (i) => i.url === newSolution.imageUrl,
      );
      if (fileItem) {
        db.homeworks
          .update(fileItem.id, { solution: newSolution })
          .catch(console.error);
      }

      return { imageSolutions: newSolutionsMap };
    }),

  updateSolution: (imageUrl, updates) =>
    set((state) => {
      const currentSolution = state.imageSolutions.get(imageUrl);
      if (!currentSolution) {
        console.error(
          `Attempted to update a non-existent solution for URL: ${imageUrl}`,
        );
        return state;
      }

      const updatedSolution = { ...currentSolution, ...updates };

      if (updates.status === "success") {
        updatedSolution.streamedOutput = null;
      }

      const newSolutionsMap = new Map(state.imageSolutions);
      newSolutionsMap.set(imageUrl, updatedSolution);

      // Sync to DB (Only persist significant updates, avoid saving while streaming)
      const fileItem = state.imageItems.find((i) => i.url === imageUrl);
      if (fileItem) {
        db.homeworks
          .update(fileItem.id, { solution: updatedSolution })
          .catch(console.error);
      }

      return { imageSolutions: newSolutionsMap };
    }),

  appendStreamedOutput: (imageUrl, chunk) =>
    set((state) => {
      // Memory only - do not sync to DB to avoid IO trashing
      const currentSolution = state.imageSolutions.get(imageUrl);
      if (!currentSolution) return state;

      const newSolutionsMap = new Map(state.imageSolutions);
      newSolutionsMap.set(imageUrl, {
        ...currentSolution,
        streamedOutput: (currentSolution.streamedOutput || "") + chunk,
      });

      return { imageSolutions: newSolutionsMap };
    }),

  clearStreamedOutput: (imageUrl) =>
    set((state) => {
      const currentSolution = state.imageSolutions.get(imageUrl);
      if (!currentSolution) return state;

      const newSolutionsMap = new Map(state.imageSolutions);
      newSolutionsMap.set(imageUrl, {
        ...currentSolution,
        streamedOutput: null,
      });

      return { imageSolutions: newSolutionsMap };
    }),

  removeSolutionsByUrls: (urlsToRemove) =>
    set((state) => {
      const newSolutionsMap = new Map(state.imageSolutions);
      urlsToRemove.forEach((url) => {
        newSolutionsMap.delete(url);

        // Remove solution from DB record
        const fileItem = state.imageItems.find((i) => i.url === url);
        if (fileItem) {
          db.homeworks
            .update(fileItem.id, { solution: undefined })
            .catch(console.error);
        }
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

  setSelectedImage: (selectedImage) => set({ selectedImage }),
  setSelectedProblem: (selectedProblem) => set({ selectedProblem }),
  setWorking: (isWorking) => set({ isWorking }),
}));
