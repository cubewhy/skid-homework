import {Adb, AdbDaemonTransport} from "@yume-chan/adb";
import {AdbDaemonWebUsbDevice, AdbDaemonWebUsbDeviceManager,} from "@yume-chan/adb-daemon-webusb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import {isTauri} from "@/lib/tauri/platform";

export interface AdbDevice {
  serial: string;
  name: string;
}

export class UnsupportedEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedEnvironmentError";
  }
}

export class AdbManager {
  private manager: AdbDaemonWebUsbDeviceManager;
  private credentialStore: AdbWebCredentialStore;

  constructor() {
    // WebUSB is disabled in Tauri; use Rust native ADB plugin instead
    if (isTauri()) {
      throw new UnsupportedEnvironmentError(
        "WebUSB is disabled in Tauri desktop builds. Use the native ADB plugin instead.",
      );
    }

    // ensure WebUSB is supported before initializing the manager
    if (
      typeof navigator === "undefined" ||
      !("usb" in navigator) ||
      !navigator.usb
    ) {
      throw new UnsupportedEnvironmentError(
        "WebUSB is not supported in this environment. Unable to initialize AdbManager.",
      );
    }

    const webUsb = navigator.usb;
    this.manager = new AdbDaemonWebUsbDeviceManager(webUsb);
    this.credentialStore = new AdbWebCredentialStore();
  }

  async requestDevice(): Promise<AdbDaemonWebUsbDevice | undefined> {
    return await this.manager.requestDevice();
  }

  async connect(device: AdbDaemonWebUsbDevice): Promise<Adb> {
    const connection = await device.connect();
    const transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection,
      credentialStore: this.credentialStore,
    });
    return new Adb(transport);
  }

  async getDevices(): Promise<AdbDaemonWebUsbDevice[]> {
    return await this.manager.getDevices();
  }
}
