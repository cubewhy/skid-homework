import { create } from "zustand";

// --- TYPE DEFINITIONS ---

export type FileStatus = "success" | "pending" | "failed" | "processing";

// Type definition for an image item in the upload list.
export type FileItem = {
  id: string; // Unique identifier for each item
  file: File; // The actual image file
  mimeType: string;
  url: string; // Object URL for client-side preview
  source: "upload" | "camera"; // Origin of the image
  status: FileStatus;
};

// Type definition for the solution set of a single image.
export type Solution = {
  imageUrl: string; // URL of the source image, used as a key
  status: "success" | "processing" | "failed"; // Whether the AI processing was successful
  streamedOutput?: string | null; // Stores the raw streaming output from the AI
  problems: ProblemSolution[]; // Array of problems found in the image
  aiSourceId?: string; // Identifier of the AI source that produced the solution
};

export interface ExplanationStep {
  title: string;
  content: string;
}

export interface ProblemSolution {
  problem: string;
  answer: string;
  explanation: string; // The full raw markdown
  steps: ExplanationStep[]; // Parsed steps
  onlineSearch?: string; // Raw ONLINE_SEARCH section content
}

// The interface for our store's state and actions.
export interface ProblemsState {
  // --- STATE ---
  imageItems: FileItem[];
  // Use a Map to store solutions. This gives us O(1) access for performance
  // AND maintains insertion order, which is crucial for rendering.
  imageSolutions: Map<string, Solution>;
  selectedImage?: string;
  selectedProblem: number;
  isWorking: boolean;

  // --- ACTIONS ---

  // Actions for managing image items
  addFileItems: (items: FileItem[]) => void;
  updateFileItem: (id: string, updates: Partial<FileItem>) => void;
  updateItemStatus: (id: string, status: FileItem["status"]) => void;
  removeImageItem: (id: string) => void;
  updateProblem: (
    imageUrl: string,
    problemIndex: number,
    newAnswer: string,
    newExplanation: string,
    newSteps: ExplanationStep[],
  ) => void;
  clearAllItems: () => void;

  // Actions for managing image solutions
  addSolution: (solution: Solution) => void;
  updateSolution: (imageUrl: string, updates: Partial<Solution>) => void;
  appendStreamedOutput: (imageUrl: string, chunk: string) => void;
  clearStreamedOutput: (imageUrl: string) => void;
  removeSolutionsByUrls: (urls: Set<string>) => void;
  clearAllSolutions: () => void;

  // Actions for managing selection state
  setSelectedImage: (image?: string) => void;
  setSelectedProblem: (index: number) => void;

  // Action to update the global working/loading state
  setWorking: (isWorking: boolean) => void;
}

export const useProblemsStore = create<ProblemsState>((set) => ({
  // --- INITIAL STATE ---
  imageItems: [],
  imageSolutions: new Map(), // Initialize as an empty Map
  selectedImage: undefined,
  selectedProblem: 0,
  isWorking: false,

  // --- ACTION IMPLEMENTATIONS ---

  /**
   * Adds new image items to the list.
   */
  addFileItems: (newItems) =>
    set((state) => ({ imageItems: [...state.imageItems, ...newItems] })),

  /**
   * Updates the status of a specific image item.
   */
  updateItemStatus: (id, status) =>
    set((state) => ({
      imageItems: state.imageItems.map((item) =>
        item.id === id ? { ...item, status } : item,
      ),
    })),

  /**
   * Updates a specific file item with a set of partial updates.
   * This is more flexible than updateItemStatus, allowing changes to any field,
   * such as adding rasterization results or an error message.
   */
  updateFileItem: (id, updates) =>
    set((state) => ({
      imageItems: state.imageItems.map((item) =>
        item.id === id ? { ...item, ...updates } : item,
      ),
    })),

  /**
   * Removes a single image item by its ID.
   */
  removeImageItem: (id) =>
    set((state) => ({
      imageItems: state.imageItems.filter((item) => item.id !== id),
    })),

  /**
   * Updates a specific problem within a solution.
   */
  updateProblem: (
    imageUrl,
    problemIndex,
    newAnswer,
    newExplanation,
    newSteps,
  ) =>
    set((state) => {
      const currentSolution = state.imageSolutions.get(imageUrl);
      if (!currentSolution) {
        return state; // Do nothing if solution doesn't exist
      }

      const updatedProblems = [...currentSolution.problems];
      updatedProblems[problemIndex] = {
        ...updatedProblems[problemIndex],
        answer: newAnswer,
        explanation: newExplanation,
        steps: newSteps,
      };

      const newSolutionsMap = new Map(state.imageSolutions);
      newSolutionsMap.set(imageUrl, {
        ...currentSolution,
        problems: updatedProblems,
      });

      return { imageSolutions: newSolutionsMap };
    }),

  /**
   * Clears all image items from the state.
   */
  clearAllItems: () => set({ imageItems: [] }),

  /**
   * Adds a new solution to the map.
   * Use this to create an initial placeholder before AI processing begins.
   * This function will NOT overwrite an existing solution to prevent accidental data loss.
   * @param newSolution The initial solution object.
   */
  addSolution: (newSolution) =>
    set((state) => {
      // Prevent overwriting an existing entry with this specific action.
      if (state.imageSolutions.has(newSolution.imageUrl)) {
        console.warn(
          `Solution for ${newSolution.imageUrl} already exists. Use updateSolution to modify it.`,
        );
        return state;
      }
      const newSolutionsMap = new Map(state.imageSolutions);
      newSolutionsMap.set(newSolution.imageUrl, newSolution);
      return { imageSolutions: newSolutionsMap };
    }),

  /**
   * Updates an existing solution with new data.
   * This is the primary way to update a solution after AI processing is complete.
   * It performs an O(1) update.
   * If the update includes `success: true`, it automatically clears `streamedOutput`.
   * @param imageUrl The key of the solution to update.
   * @param updates An object containing the fields to update (e.g., { problems, success }).
   */
  updateSolution: (imageUrl, updates) =>
    set((state) => {
      const currentSolution = state.imageSolutions.get(imageUrl);

      // If there's no solution to update, do nothing.
      if (!currentSolution) {
        console.error(
          `Attempted to update a non-existent solution for URL: ${imageUrl}`,
        );
        return state;
      }

      const newSolutionsMap = new Map(state.imageSolutions);

      // Merge the current solution with the updates.
      const updatedSolution = { ...currentSolution, ...updates };

      // If the update marks the solution as successful, clear the streamed output.
      if (updates.status === "success") {
        updatedSolution.streamedOutput = null;
      }

      newSolutionsMap.set(imageUrl, updatedSolution);

      return { imageSolutions: newSolutionsMap };
    }),

  /**
   * Appends a chunk of text to a solution's streamedOutput. O(1) performance.
   * @param imageUrl The unique identifier for the solution to update.
   * @param chunk The piece of text to append.
   */
  appendStreamedOutput: (imageUrl, chunk) =>
    set((state) => {
      const currentSolution = state.imageSolutions.get(imageUrl);
      if (!currentSolution) return state;

      const newSolutionsMap = new Map(state.imageSolutions);
      newSolutionsMap.set(imageUrl, {
        ...currentSolution,
        streamedOutput: (currentSolution.streamedOutput || "") + chunk,
      });

      return { imageSolutions: newSolutionsMap };
    }),

  /**
   * Clears the streamedOutput for a specific solution, setting it to null.
   * This is useful if a user wants to manually clear a log or cancel an operation.
   * O(1) performance.
   * @param imageUrl The key of the solution to modify.
   */
  clearStreamedOutput: (imageUrl: string) =>
    set((state) => {
      const currentSolution = state.imageSolutions.get(imageUrl);
      // Do nothing if the solution doesn't exist.
      if (!currentSolution) {
        return state;
      }

      const newSolutionsMap = new Map(state.imageSolutions);
      // Create a new solution object with streamedOutput set to null.
      newSolutionsMap.set(imageUrl, {
        ...currentSolution,
        streamedOutput: null,
      });

      return { imageSolutions: newSolutionsMap };
    }),

  /**
   * Removes solutions associated with a given set of image URLs.
   * The order of the remaining items is preserved.
   */
  removeSolutionsByUrls: (urlsToRemove) =>
    set((state) => {
      const newSolutionsMap = new Map(state.imageSolutions);
      urlsToRemove.forEach((url) => {
        newSolutionsMap.delete(url);
      });
      return { imageSolutions: newSolutionsMap };
    }),

  /**
   * Clears all solutions from the state.
   */
  clearAllSolutions: () => set({ imageSolutions: new Map() }),

  /**
   * Sets the currently selected image URL.
   */
  setSelectedImage: (selectedImage) => set({ selectedImage }),

  /**
   * Sets the index of the currently selected problem for the selected image.
   */
  setSelectedProblem: (selectedProblem) => set({ selectedProblem }),

  /**
   * Sets the global working state, e.g., for a global loading indicator.
   */
  setWorking: (isWorking) => set({ isWorking }),
}));
