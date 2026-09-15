import {isTauri} from "./platform";

export type TauriAdbDevice = {
  serial: string;
  name: string;
  state: string;
};

export type TauriAdbConnectResult = {
  serial: string;
  message: string;
};

export type TauriAdbPairRequest = {
  address: string;
  pairingCode: string;
};

type TauriRawChannelPayload = ArrayBuffer | Uint8Array | number[];

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

const normalizeTauriRawChannelPayload = (payload: TauriRawChannelPayload): Uint8Array => {
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }

  if (payload instanceof Uint8Array) {
    return payload;
  }

  if (Array.isArray(payload)) {
    return Uint8Array.from(payload);
  }

  throw new Error("Invalid binary payload from Tauri channel.");
};

const invokeTauriBinaryChannelCommand = async (
  command: string,
  payload?: Record<string, unknown>,
  channelKey: string = "payloadChannel",
): Promise<Uint8Array> => {
  if (!isTauri()) {
    throw new Error("Native binary channel IPC is only available in Tauri desktop builds.");
  }

  const { invoke, Channel } = await import("@tauri-apps/api/core");

  return await new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;

    const settleResolve = (bytes: Uint8Array): void => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(bytes);
    };

    const settleReject = (error: unknown): void => {
      if (settled) {
        return;
      }

      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const payloadChannel = new Channel<TauriRawChannelPayload>((message) => {
      try {
        settleResolve(normalizeTauriRawChannelPayload(message));
      } catch (error) {
        settleReject(error);
      }
    });

    void invoke<void>(command, {
      ...(payload ?? {}),
      [channelKey]: payloadChannel,
    }).catch((error) => {
      settleReject(error);
    });
  });
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
  return await invokeTauriBinaryChannelCommand("tauri_adb_screenshot", {
    serial,
  });
};

// --- Generic ADB primitives for future desktop integrations ---

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
