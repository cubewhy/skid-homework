import type {Adb} from "@yume-chan/adb";
import {AdbDaemonWebUsbDevice} from "@yume-chan/adb-daemon-webusb";
import {
  captureTauriAdbScreenshot,
  connectTauriAdbDevice,
  listTauriAdbDevices,
  pairTauriAdbDevice,
  type TauriAdbDevice,
} from "@/lib/tauri/adb";
import {isTauri} from "@/lib/tauri/platform";
import {AdbManager, UnsupportedEnvironmentError} from "./manager";

export interface RemoteAdbPairRequest {
  pairingAddress: string;
  pairingCode: string;
}

export interface AdbScreenshotCapture {
  file: File;
  width: number | null;
  height: number | null;
  capturedAt: number;
  source: "tauri" | "webusb";
  serial?: string;
}

let _manager: AdbManager | undefined;
let selectedDevice: AdbDaemonWebUsbDevice | undefined;
let selectedTauriSerial: string | undefined;

const buildScreenshotFile = (parts: BlobPart[]): File => {
  const fileName = `screenshot_${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  return new File(parts, fileName, { type: "image/png" });
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IHDR_LENGTH = 13;
const PNG_IHDR_TYPE = [0x49, 0x48, 0x44, 0x52];

const readPngDimensions = (
  bytes: Uint8Array,
): { width: number; height: number } | null => {
  const minimumLength = 8 + 4 + 4 + PNG_IHDR_LENGTH;
  if (bytes.byteLength < minimumLength) {
    return null;
  }

  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      return null;
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdrLength = view.getUint32(8, false);

  if (ihdrLength !== PNG_IHDR_LENGTH) {
    return null;
  }

  for (let index = 0; index < PNG_IHDR_TYPE.length; index += 1) {
    if (bytes[12 + index] !== PNG_IHDR_TYPE[index]) {
      return null;
    }
  }

  return {
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  };
};

async function syncSelectedWebUsbDevice(): Promise<boolean> {
  const devices = await getAdbManager().getDevices();

  if (!devices.length) {
    selectedDevice = undefined;
    return false;
  }

  // Keep using the previously chosen device if it's still connected.
  if (selectedDevice) {
    const stillConnected = devices.some(
      (device) => device.serial === selectedDevice!.serial,
    );
    if (stillConnected) {
      return true;
    }
  }

  // Fall back to the first available device so follow-up calls can reuse it.
  selectedDevice = devices[0];
  return true;
}

async function syncSelectedTauriSerial(): Promise<boolean> {
  const devices = (await listDesktopAdbDevices()).filter(
    (device) => device.state === "device",
  );

  if (!devices.length) {
    selectedTauriSerial = undefined;
    return false;
  }

  if (
    selectedTauriSerial &&
    devices.some((device) => device.serial === selectedTauriSerial)
  ) {
    return true;
  }

  selectedTauriSerial = devices[0].serial;
  return true;
}

function getAdbManager(): AdbManager {
  if (!_manager) {
    try {
      _manager = new AdbManager();
    } catch (e) {
      console.error(
        "Failed to initialize AdbManager. WebUSB might not be supported.",
        e,
      );
      throw e;
    }
  }
  return _manager;
}

async function getWebUsbAdbConnection(): Promise<Adb> {
  const hasConnectedDevice = await syncSelectedWebUsbDevice();

  // if user haven't connected a device yet, prompt them to select one.
  // This is needed for the first time usage.
  if (!hasConnectedDevice) {
    const device = await getAdbManager().requestDevice();
    if (!device) {
      throw new Error("WebADB: No device selected");
    }
    selectedDevice = device;
  }

  if (!selectedDevice) {
    throw new Error("WebADB: No ADB device connected");
  }

  return await getAdbManager().connect(selectedDevice);
}

export const getSelectedDesktopAdbSerial = (): string | undefined => {
  return selectedTauriSerial;
};

export async function listDesktopAdbDevices(): Promise<TauriAdbDevice[]> {
  if (!isTauri()) {
    throw new UnsupportedEnvironmentError(
      "Desktop ADB device listing is only available in Tauri desktop builds.",
    );
  }

  return await listTauriAdbDevices();
}

export async function selectDesktopAdbDevice(serial: string): Promise<string> {
  if (!isTauri()) {
    throw new UnsupportedEnvironmentError(
      "Desktop ADB device selection is only available in Tauri desktop builds.",
    );
  }

  const devices = await listDesktopAdbDevices();
  const device = devices.find((item) => item.serial === serial);

  if (!device) {
    throw new Error(`ADB device ${serial} was not found.`);
  }

  if (device.state !== "device") {
    throw new Error(
      `ADB device ${serial} is not ready yet. Current state: ${device.state}.`,
    );
  }

  selectedTauriSerial = device.serial;
  return device.serial;
}

export async function isAdbDeviceConnected(): Promise<boolean> {
  try {
    if (isTauri()) {
      return await syncSelectedTauriSerial();
    }

    return await syncSelectedWebUsbDevice();
  } catch (error) {
    console.error("Failed to check ADB device connection", error);
    return false;
  }
}

export async function reconnectAdbDevice(): Promise<boolean> {
  if (isTauri()) {
    return await syncSelectedTauriSerial();
  }

  const device = await getAdbManager().requestDevice();
  if (!device) {
    return false;
  }
  selectedDevice = device;
  return true;
}

export async function connectRemoteAdbDevice(address: string): Promise<string> {
  if (!isTauri()) {
    throw new UnsupportedEnvironmentError(
      "Remote ADB connect is only available in Tauri desktop builds.",
    );
  }

  const result = await connectTauriAdbDevice(address);
  selectedTauriSerial = result.serial;
  return result.serial;
}

export async function pairRemoteAdbDevice(
  request: RemoteAdbPairRequest,
): Promise<string> {
  if (!isTauri()) {
    throw new UnsupportedEnvironmentError(
      "Remote ADB pair is only available in Tauri desktop builds.",
    );
  }

  return await pairTauriAdbDevice({
    address: request.pairingAddress,
    pairingCode: request.pairingCode,
  });
}

export async function captureAdbScreenshot(): Promise<File> {
  const capture = await captureAdbScreenshotWithMetadata();
  return capture.file;
}

const resolveActiveTauriSerial = async (
  preferredSerial?: string,
): Promise<string> => {
  if (preferredSerial) {
    const devices = (await listDesktopAdbDevices()).filter(
      (device) => device.state === "device",
    );
    const hasPreferredDevice = devices.some(
      (device) => device.serial === preferredSerial,
    );
    if (!hasPreferredDevice) {
      throw new Error(`Tauri ADB: Device ${preferredSerial} is not connected`);
    }

    selectedTauriSerial = preferredSerial;
    return preferredSerial;
  }

  const hasConnectedDevice = await syncSelectedTauriSerial();
  if (!hasConnectedDevice || !selectedTauriSerial) {
    throw new Error("Tauri ADB: No ADB device connected");
  }

  return selectedTauriSerial;
};

export async function captureAdbScreenshotWithMetadata(options?: {
  preferredDesktopSerial?: string;
}): Promise<AdbScreenshotCapture> {
  const capturedAt = Date.now();

  if (isTauri()) {
    const serial = await resolveActiveTauriSerial(options?.preferredDesktopSerial);
    const screenshotBytes = await captureTauriAdbScreenshot(serial);
    const blobCompatibleBytes = new Uint8Array(screenshotBytes.byteLength);
    blobCompatibleBytes.set(screenshotBytes);
    const dimensions = readPngDimensions(blobCompatibleBytes);
    return {
      file: buildScreenshotFile([blobCompatibleBytes]),
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      capturedAt,
      source: "tauri",
      serial,
    };
  }

  const adb = await getWebUsbAdbConnection();
  const socket = await adb.subprocess.shellProtocol!.spawn("screencap -p");
  const reader = socket.stdout.getReader();

  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    await adb.close();
  }

  const totalBytes = chunks.reduce((size, chunk) => size + chunk.byteLength, 0);
  const merged = new Uint8Array(totalBytes);
  let cursor = 0;
  for (const chunk of chunks) {
    merged.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  const dimensions = readPngDimensions(merged);

  return {
    file: buildScreenshotFile([merged]),
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    capturedAt,
    source: "webusb",
  };
}
