"use client";

import { useSyncExternalStore } from "react";
import { getPlatform, type Platform } from "@/lib/tauri/platform";

// No-op subscribe: platform never changes after page load
const subscribe = (): (() => void) => () => {};

// Client snapshot: reads actual platform at runtime
const getSnapshot = (): Platform => getPlatform();

// Server snapshot: always "web" during SSR to prevent hydration mismatch.
// After hydration, React re-renders with getSnapshot() which may return "tauri".
const getServerSnapshot = (): Platform => "web";

/**
 * Platform-aware React hook.
 * Returns the current runtime platform ("web" | "tauri") for conditional
 * rendering and platform-specific logic in components.
 *
 * Uses useSyncExternalStore to safely handle SSR/hydration:
 * - Server render + hydration pass: always returns "web"
 * - Post-hydration re-render: returns actual platform
 */
export const usePlatform = (): Platform => {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};
