import {isTauri} from "./platform";

export interface TauriAdbDevice {
  serial: string;
  name: string;
  state: string;
}

export interface TauriAdbConnectResult {
  serial: string;
  message: string;
}

export interface TauriAdbPairRequest {
  address: string;
  pairingCode: string;
}

const invokeTauriCommand = async <T>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<T> => {
  if (!isTauri()) {
    throw new Error("Native ADB is only available in Tauri desktop builds.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<T>(command, payload);
};

export const listTauriAdbDevices = async (): Promise<TauriAdbDevice[]> => {
  return await invokeTauriCommand<TauriAdbDevice[]>("tauri_adb_list_devices");
};

export const pairTauriAdbDevice = async (
  request: TauriAdbPairRequest,
): Promise<string> => {
  return await invokeTauriCommand<string>("tauri_adb_pair", { request });
};

export const connectTauriAdbDevice = async (
  address: string,
): Promise<TauriAdbConnectResult> => {
  return await invokeTauriCommand<TauriAdbConnectResult>("tauri_adb_connect", {
    request: { address },
  });
};

export const captureTauriAdbScreenshot = async (
  serial: string,
): Promise<Uint8Array> => {
  const bytes = await invokeTauriCommand<number[]>("tauri_adb_screenshot", {
    serial,
  });
  return Uint8Array.from(bytes);
};

export const shellTauriAdbCommand = async (
  serial: string,
  command: string,
): Promise<string> => {
  return await invokeTauriCommand<string>("tauri_adb_shell", {
    serial,
    command,
  });
};
