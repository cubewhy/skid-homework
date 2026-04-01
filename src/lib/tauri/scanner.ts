import type {Point} from "@/lib/scanner/document-detector";
import type {OrthogonalRotation} from "@/lib/scanner/image-data";

import {isTauri} from "./platform";

type TauriRawChannelPayload = string | ArrayBuffer | Uint8Array | number[];

const NATIVE_POST_PROCESS_TIMEOUT_MS = 20_000;
const NATIVE_POST_PROCESS_PARTIAL_TIMEOUT_MS = 1_500;

export interface TauriScannerPostProcessResult {
  processingMs: number;
  decodeMs: number;
  perspectiveMs: number | null;
  enhanceMs: number | null;
  rotateMs: number | null;
  encodeMs: number;
  inputWidth: number;
  inputHeight: number;
  outputWidth: number;
  outputHeight: number;
  encodedMimeType: "image/png";
  encodedBytes: ArrayBuffer;
}

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

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  return Uint8Array.from(bytes).buffer;
};

export const processTauriScannerPostProcessSourceFile = async (
  sourceFile: Blob,
  options: {
    documentPoints: Point[] | null;
    outputRotation: OrthogonalRotation;
    imageEnhancement: boolean;
  },
): Promise<TauriScannerPostProcessResult> => {
  if (!isTauri()) {
    throw new Error("Native scanner post-process is only available in Tauri desktop builds.");
  }

  const sourceBytes = new Uint8Array(await sourceFile.arrayBuffer());
  const {invoke, Channel} = await import("@tauri-apps/api/core");

  return await new Promise<TauriScannerPostProcessResult>((resolve, reject) => {
    let settled = false;
    let overallTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let partialTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let response:
      | Omit<TauriScannerPostProcessResult, "encodedBytes">
      | null = null;
    let encodedBytes: ArrayBuffer | null = null;

    const clearTimers = (): void => {
      if (overallTimeoutId !== null) {
        clearTimeout(overallTimeoutId);
        overallTimeoutId = null;
      }

      if (partialTimeoutId !== null) {
        clearTimeout(partialTimeoutId);
        partialTimeoutId = null;
      }
    };

    const armPartialTimeout = (message: string): void => {
      if (settled || partialTimeoutId !== null || (response && encodedBytes !== null)) {
        return;
      }

      partialTimeoutId = setTimeout(() => {
        settleReject(new Error(message));
      }, NATIVE_POST_PROCESS_PARTIAL_TIMEOUT_MS);
    };

    const maybeResolve = (): void => {
      if (settled || !response || encodedBytes === null) {
        return;
      }

      settled = true;
      clearTimers();
      resolve({
        ...response,
        encodedBytes,
      });
    };

    const settleReject = (error: unknown): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimers();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    overallTimeoutId = setTimeout(() => {
      settleReject(new Error("Native scanner post-process timed out."));
    }, NATIVE_POST_PROCESS_TIMEOUT_MS);

    const payloadChannel = new Channel<TauriRawChannelPayload>((message) => {
      try {
        encodedBytes = toArrayBuffer(normalizeTauriRawChannelPayload(message));
        if (!response) {
          armPartialTimeout("Native scanner post-process returned raw payload without metadata.");
        }
        maybeResolve();
      } catch (error) {
        settleReject(error);
      }
    });

    void invoke<Omit<TauriScannerPostProcessResult, "encodedBytes">>(
      "tauri_scanner_postprocess_image",
      {
        request: {
          sourceBytes,
          documentPoints: options.documentPoints,
          outputRotation: options.outputRotation,
          imageEnhancement: options.imageEnhancement,
        },
        payloadChannel,
      },
    )
      .then((result) => {
        response = result;
        if (encodedBytes === null) {
          armPartialTimeout("Native scanner post-process returned metadata without raw payload.");
        }
        maybeResolve();
      })
      .catch((error) => {
        settleReject(error);
      });
  });
};
