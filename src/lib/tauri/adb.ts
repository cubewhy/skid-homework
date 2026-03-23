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

// --- Scanner-related ADB commands ---

export const pushTauriAdbFile = async (
  serial: string,
  localPath: string,
  remotePath: string,
): Promise<string> => {
  return await invokeTauriCommand<string>("tauri_adb_push", {
    serial,
    localPath,
    remotePath,
  });
};

export const forwardTauriAdbPort = async (
  serial: string,
  localPort: number,
  remoteSocketName: string,
): Promise<string> => {
  return await invokeTauriCommand<string>("tauri_adb_forward", {
    serial,
    localPort,
    remoteSocketName,
  });
};

export const removeForwardTauriAdbPort = async (
  serial: string,
  localPort: number,
): Promise<string> => {
  return await invokeTauriCommand<string>("tauri_adb_remove_forward", {
    serial,
    localPort,
  });
};

export const startTauriAdbServer = async (
  serial: string,
  classpath: string,
  mainClass: string,
  serverArgs: string[],
): Promise<string> => {
  return await invokeTauriCommand<string>("tauri_adb_start_server", {
    serial,
    classpath,
    mainClass,
    serverArgs,
  });
};

export const stopTauriAdbServer = async (
  serial: string,
  classpath: string,
): Promise<string> => {
  return await invokeTauriCommand<string>("tauri_adb_stop_server", {
    serial,
    classpath,
  });
};

export const startTauriDecodeStream = async (
  port: number,
): Promise<void> => {
  return await invokeTauriCommand<void>("tauri_scanner_start_stream", {
    port,
  });
};

export const stopTauriDecodeStream = async (): Promise<void> => {
  return await invokeTauriCommand<void>("tauri_scanner_stop_stream");
};

/**
 * Poll the latest decoded video frame from the Rust H.264 stream decoder.
 * Returns a raw Uint8Array, where byte 0 is the frame codec, bytes 1..5 are
 * the big-endian width, bytes 5..9 are the big-endian height, and the remaining
 * bytes are codec-specific image payload data.
 * Returns an empty array if no new frame is available.
 */
export const getTauriDecodedFrame = async (): Promise<Uint8Array> => {
  if (!isTauri()) {
    throw new Error("Tauri decoded frame polling is only available in Tauri desktop builds.");
  }
  return await invokeTauriCommand<Uint8Array>("tauri_scanner_get_frame");
};

