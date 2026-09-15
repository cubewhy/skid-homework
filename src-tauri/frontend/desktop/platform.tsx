import type {
  AppTarget,
  PlatformCaptureActionsProps,
} from "../shared/platform-types";

export type {AppTarget, PlatformCaptureActionsProps};

export const APP_TARGET: AppTarget = "tauri-desktop";

export const isWebTarget = false;
export const isTauriDesktopTarget = true;
export const isTauriAndroidTarget = false;

export function shouldEnableSerwist(): boolean {
  return false;
}

export async function openExternalUrl(url: string): Promise<void> {
  const {openUrl} = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

export {DesktopCaptureActions as PlatformCaptureActions} from "./components/DesktopCaptureActions";
export {PlatformRootShell} from "./PlatformRootShell";
export {ImagePostProcessLoader, processImage} from "../shared/scan-enhance";
export {default as PlatformInitPage} from "@/components/init/InitWizard";
export {default as PlatformInitGuard} from "@/components/guards/RequireInit";
