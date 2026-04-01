"use client";

import {useEffect} from "react";
import {usePlatform} from "@/hooks/use-platform";

/**
 * Intercepts external link clicks in Tauri and opens them in the
 * system default browser via the opener plugin, instead of navigating
 * within the webview.
 *
 * Also handles file drag-and-drop by preventing the default webview
 * behavior of navigating to the dropped file URL.
 */
export function TauriLinkInterceptor({
  children,
}: {
  children: React.ReactNode;
}) {
  const platform = usePlatform();

  useEffect(() => {
    if (platform !== "tauri") return;

    const handleClick = async (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // Only intercept external URLs (http/https)
      if (href.startsWith("http://") || href.startsWith("https://")) {
        e.preventDefault();
        e.stopPropagation();
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(href);
      }
    };

    // Prevent webview from navigating to dropped files
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
    };

    document.addEventListener("click", handleClick, true);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);

    return () => {
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
  }, [platform]);

  return <>{children}</>;
}
