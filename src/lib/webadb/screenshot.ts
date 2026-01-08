import type {Adb} from '@yume-chan/adb';
import {AdbDaemonWebUsbDevice} from '@yume-chan/adb-daemon-webusb';
import {AdbManager} from './manager';

let manager: AdbManager = new AdbManager();
let selectedDevice: AdbDaemonWebUsbDevice | undefined;

function resetAdbManager() {
    manager = new AdbManager();
    selectedDevice = undefined;
}

async function syncSelectedDevice(): Promise<boolean> {
    const devices = await manager.getDevices();

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

export async function takeScreenshot(adb: Adb): Promise<Blob> {
    const socket = await adb.subprocess.shellProtocol!.spawn('screencap -p');
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
    }

    return new Blob(chunks as BlobPart[], { type: 'image/png' });
}

export async function isAdbDeviceConnected(): Promise<boolean> {
    try {
        return await syncSelectedDevice();
    } catch (error) {
        console.error('Failed to check ADB device connection', error);
        return false;
    }
}

export async function reconnectAdbDevice(): Promise<boolean> {
    resetAdbManager();
    const device = await manager.requestDevice();
    if (!device) {
        return false;
    }
    selectedDevice = device;
    return true;
}

export async function captureAdbScreenshot(): Promise<File> {
    const hasConnectedDevice = await syncSelectedDevice();

    if (!hasConnectedDevice) {
        const device = await manager.requestDevice();
        if (!device) {
            throw new Error('No device selected');
        }
        selectedDevice = device;
    }

    if (!selectedDevice) {
        throw new Error('No device selected');
    }

    const adb = await manager.connect(selectedDevice);
    const blob = await takeScreenshot(adb);
    await adb.close();

    const fileName = `screenshot_${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    return new File([blob], fileName, {type: 'image/png'});
}
