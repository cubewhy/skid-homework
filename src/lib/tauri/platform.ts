/**
 * Runtime platform detection utilities.
 * Detects Tauri v2 environment via the injected `__TAURI_INTERNALS__` global.
 */

export type Platform = "web" | "tauri";

/**
 * Check if the current runtime is within a Tauri desktop application.
 * Tauri v2 injects `__TAURI_INTERNALS__` into the webview's global scope.
 */
export const isTauri = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

/**
 * Get the current runtime platform identifier.
 */
export const getPlatform = (): Platform => {
  return isTauri() ? "tauri" : "web";
};
