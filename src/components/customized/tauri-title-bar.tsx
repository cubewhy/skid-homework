"use client";

import { useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";
import { usePlatform } from "@/hooks/use-platform";

/**
 * Custom frameless title bar for Tauri desktop builds.
 * Renders only in Tauri environment. Uses project CSS variables
 * (--background, --foreground, --border) to match the current theme.
 *
 * Includes:
 *  - Window drag region
 *  - Minimize, maximize/restore, close buttons
 */
export function TauriTitleBar() {
  const platform = usePlatform();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (platform !== "tauri") return;

    let unlisten: (() => void) | undefined;

    const setup = async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();

      // Check initial maximized state
      setIsMaximized(await appWindow.isMaximized());

      // Listen for resize events to track maximized state
      unlisten = await appWindow.onResized(async () => {
        setIsMaximized(await appWindow.isMaximized());
      });
    };

    setup();
    return () => { unlisten?.(); };
  }, [platform]);

  if (platform !== "tauri") return null;

  const handleMinimize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  };

  const handleMaximize = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().toggleMaximize();
  };

  const handleClose = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  };

  return (
    <div
      className="tauri-title-bar"
      data-tauri-drag-region
    >
      <div className="tauri-title-bar__label" data-tauri-drag-region>
        Skid Homework
      </div>
      <div className="tauri-title-bar__controls">
        <button
          className="tauri-title-bar__btn"
          onClick={handleMinimize}
          aria-label="Minimize"
          id="titlebar-minimize"
        >
          <Minus size={14} />
        </button>
        <button
          className="tauri-title-bar__btn"
          onClick={handleMaximize}
          aria-label={isMaximized ? "Restore" : "Maximize"}
          id="titlebar-maximize"
        >
          <Square size={12} />
        </button>
        <button
          className="tauri-title-bar__btn tauri-title-bar__btn--close"
          onClick={handleClose}
          aria-label="Close"
          id="titlebar-close"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
