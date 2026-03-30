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
  frameChannel: unknown;
  statusChannel: unknown;
  dispose: () => void;
}

export interface TauriDecodeStreamLifecycleEvent {
  state: "starting" | "connected" | "reconnecting" | "ready" | "error" | "stopped";
  detail: string;
  recoverable: boolean;
  reconnectAttempt: number;
}

export interface TauriAdbPairRequest {
  address: string;
  pairingCode: string;
}

export interface TauriAdbStillPayload {
  mimeType: string;
  bytes: Uint8Array;
  transport: string;
}

type TauriRawChannelPayload = string | ArrayBuffer | Uint8Array | number[];

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

const decodeBase64ToUint8Array = (base64: string): Uint8Array => {
  const normalized = base64.replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const normalizeTauriRawChannelPayload = (payload: TauriRawChannelPayload): Uint8Array => {
  if (typeof payload === "string") {
    return decodeBase64ToUint8Array(payload);
  }

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

export const captureTauriAdbStill = (
  serial: string,
  classpath: string,
  socketName: string,
): Promise<TauriAdbStillPayload> => {
  return invokeTauriBinaryChannelCommand("tauri_adb_capture_still", {
    serial,
    classpath,
    socketName,
  }).then((bytes) => {
    return {
      mimeType: "image/jpeg",
      bytes,
      transport: "raw-channel",
    };
  });
};

export const captureTauriAdbStillStream = (
  port: number,
): Promise<TauriAdbStillPayload> => {
  return invokeTauriBinaryChannelCommand("tauri_adb_capture_still_stream", {
    port,
  }).then((bytes) => {
    return {
      mimeType: "image/jpeg",
      bytes,
      transport: "forwarded-stream-channel",
    };
  });
};

export const encodeTauriPngRgba = async (
  width: number,
  height: number,
  rgba: Uint8Array,
): Promise<Uint8Array> => {
  return await invokeTauriBinaryChannelCommand("tauri_scanner_encode_png_rgba", {
    width,
    height,
    rgba,
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
  onLifecycleEvent: (event: TauriDecodeStreamLifecycleEvent) => void,
): Promise<TauriDecodeStreamHandle> => {
  if (!isTauri()) {
    throw new Error("Tauri decoded frame streaming is only available in Tauri desktop builds.");
  }

  const { invoke, Channel } = await import("@tauri-apps/api/core");
  let latestFramePacket: TauriRawChannelPayload | null = null;
  let frameDispatchScheduled = false;
  let disposed = false;
  let animationFrameId: number | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const clearScheduledDispatch = (): void => {
    if (animationFrameId !== null && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    frameDispatchScheduled = false;
  };

  const flushLatestFrame = (): void => {
    frameDispatchScheduled = false;
    animationFrameId = null;
    timeoutId = null;

    if (disposed) {
      latestFramePacket = null;
      return;
    }

    const framePacket = latestFramePacket;
    latestFramePacket = null;
    if (framePacket === null) {
      return;
    }

    onFrame(normalizeTauriRawChannelPayload(framePacket));

    if (latestFramePacket !== null) {
      scheduleLatestFrameDispatch();
    }
  };

  function scheduleLatestFrameDispatch(): void {
    if (disposed || frameDispatchScheduled) {
      return;
    }

    frameDispatchScheduled = true;

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      animationFrameId = window.requestAnimationFrame(() => {
        flushLatestFrame();
      });
      return;
    }

    timeoutId = setTimeout(() => {
      flushLatestFrame();
    }, 0);
  }

  const frameChannel = new Channel<TauriRawChannelPayload>((framePacket) => {
    if (disposed) {
      return;
    }

    latestFramePacket = framePacket;
    scheduleLatestFrameDispatch();
  });
  const statusChannel = new Channel<TauriDecodeStreamLifecycleEvent>((event) => {
    onLifecycleEvent(event);
  });

  await invoke<void>("tauri_scanner_start_stream", {
    port,
    frameChannel,
    statusChannel,
  });

  return {
    frameChannel,
    statusChannel,
    dispose: () => {
      disposed = true;
      latestFramePacket = null;
      clearScheduledDispatch();
    },
  };
};

export const stopTauriDecodeStream = async (): Promise<void> => {
  return await invokeTauriCommand<void>("tauri_scanner_stop_stream");
};
