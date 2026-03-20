/**
 * Tauri v2 global type augmentation.
 * Tauri injects `__TAURI_INTERNALS__` into the window object at runtime.
 */
interface Window {
  __TAURI_INTERNALS__?: Record<string, unknown>;
}
