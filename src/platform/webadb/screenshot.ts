import type {Adb} from "@yume-chan/adb";
import type {AdbDaemonWebUsbDevice} from "@yume-chan/adb-daemon-webusb";
import {AdbManager} from "./manager";

let manager: AdbManager | undefined;
let selectedDevice: AdbDaemonWebUsbDevice | undefined;

async function syncSelectedDevice(): Promise<boolean> {
  const devices = await getAdbManager().getDevices();

  if (!devices.length) {
    selectedDevice = undefined;
    return false;
  }

  if (selectedDevice) {
    const stillConnected = devices.some(
      (device) => device.serial === selectedDevice!.serial,
    );
    if (stillConnected) {
      return true;
    }
  }

  selectedDevice = devices[0];
  return true;
}

function getAdbManager(): AdbManager {
  if (!manager) {
    try {
      manager = new AdbManager();
    } catch (error) {
      console.error(
        "Failed to initialize AdbManager. WebUSB might not be supported.",
        error,
      );
      throw error;
    }
  }
  return manager;
}

async function getAdbConnection(): Promise<Adb> {
  const hasConnectedDevice = await syncSelectedDevice();

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

export async function isAdbDeviceConnected(): Promise<boolean> {
  try {
    return await syncSelectedDevice();
  } catch (error) {
    console.error("Failed to check ADB device connection", error);
    return false;
  }
}

export async function reconnectAdbDevice(): Promise<boolean> {
  const device = await getAdbManager().requestDevice();
  if (!device) {
    return false;
  }

  selectedDevice = device;
  return true;
}

export async function captureAdbScreenshot(): Promise<File> {
  const adb = await getAdbConnection();
  const socket = await adb.subprocess.shellProtocol!.spawn("screencap -p");
  const reader = socket.stdout.getReader();

  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) {
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    await adb.close();
  }

  const blob = new Blob(chunks as BlobPart[], {type: "image/png"});
  const fileName = `screenshot_${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  return new File([blob], fileName, {type: "image/png"});
}
