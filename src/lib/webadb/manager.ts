import {Adb, AdbDaemonTransport} from '@yume-chan/adb';
import {AdbDaemonWebUsbDeviceManager, AdbDaemonWebUsbDevice} from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';

export interface AdbDevice {
    serial: string;
    name: string;
}

export class AdbManager {
    private manager: AdbDaemonWebUsbDeviceManager;
    private credentialStore: AdbWebCredentialStore;

    constructor() {
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
