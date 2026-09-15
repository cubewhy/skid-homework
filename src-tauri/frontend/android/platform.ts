import type {
  AppTarget,
  PlatformCaptureActionsProps,
} from "../shared/platform-types";

export type {AppTarget, PlatformCaptureActionsProps};

export const APP_TARGET: AppTarget = "tauri-android";

export const isWebTarget = false;
export const isTauriDesktopTarget = false;
export const isTauriAndroidTarget = true;

export function shouldEnableSerwist(): boolean {
  return false;
}

export async function openExternalUrl(url: string): Promise<void> {
  const {openUrl} = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
}

export function PlatformCaptureActions(
  _props: PlatformCaptureActionsProps,
): React.JSX.Element | null {
  void _props;
  return null;
}

export {PlatformRootShell} from "./PlatformRootShell";
export {ImagePostProcessLoader, processImage} from "../shared/scan-enhance";
export {default as PlatformInitPage} from "@/components/init/MobileInitWizard";
export {default as PlatformInitGuard} from "@/components/guards/RequireInit";

