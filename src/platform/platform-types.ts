import type {ReactNode} from "react";
import type {FileItem} from "@/store/problems-store";

export type AppTarget = "web" | "tauri-desktop" | "tauri-android";

export type PlatformCaptureActionsProps = {
  appendFiles: (files: File[] | FileList, source: FileItem["source"]) => void;
  disabled: boolean;
  isCompact: boolean;
};

export type PlatformInitGuardProps = {children: ReactNode};
