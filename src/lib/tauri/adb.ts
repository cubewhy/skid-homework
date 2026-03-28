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

export interface TauriDecodeStreamHandle {
  channel: unknown;
}

export interface TauriAdbPairRequest {
  address: string;
  pairingCode: string;
}

export interface TauriAdbStillPayload {
  mimeType: string;
  bytes: Uint8Array;
  transport: "raw-ipc";
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

const invokeTauriBinaryCommand = async (
  command: string,
  payload?: Record<string, unknown>,
): Promise<Uint8Array> => {
  const result = await invokeTauriCommand<unknown>(command, payload);
  if (result instanceof ArrayBuffer) {
    return new Uint8Array(result);
  } else if (result instanceof Uint8Array) {
    return result;
  } else if (Array.isArray(result)) {
    return Uint8Array.from(result as number[]);
  }
  throw new Error("Invalid binary response from Tauri command");
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
  return invokeTauriBinaryCommand("tauri_adb_screenshot", {
    serial,
  });
};

export const captureTauriAdbStill = (
  serial: string,
  classpath: string,
  socketName: string,
): Promise<TauriAdbStillPayload> => {
  return invokeTauriBinaryCommand("tauri_adb_capture_still", {
    serial,
    classpath,
    socketName,
  }).then((bytes) => {
    return {
      mimeType: "image/jpeg",
      bytes,
      transport: "raw-ipc",
    };
  });
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
  onFrame: (framePacket: ArrayBuffer | Uint8Array) => void,
): Promise<TauriDecodeStreamHandle> => {
  if (!isTauri()) {
    throw new Error("Tauri decoded frame streaming is only available in Tauri desktop builds.");
  }

  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const frameChannel = new Channel<string | ArrayBuffer | Uint8Array | number[]>(async (framePacket) => {
    if (typeof framePacket === "string") {
      const res = await fetch(`data:application/octet-stream;base64,${framePacket}`);
      const buffer = await res.arrayBuffer();
      onFrame(buffer);
    } else {
      if (Array.isArray(framePacket)) {
        onFrame(Uint8Array.from(framePacket));
      } else {
        onFrame(framePacket);
      }
    }
  });

  await invoke<void>("tauri_scanner_start_stream", {
    port,
    frameChannel,
  });

  return {
    channel: frameChannel,
  };
};

export const stopTauriDecodeStream = async (): Promise<void> => {
  return await invokeTauriCommand<void>("tauri_scanner_stop_stream");
};
