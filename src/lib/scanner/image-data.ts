import {isTauri} from "@/lib/tauri/platform";

export type OrthogonalRotation = 0 | 90 | 180 | 270;

type PngEncodeSurface =
  | {
    kind: "offscreen";
    canvas: OffscreenCanvas;
    context: OffscreenCanvasRenderingContext2D;
  }
  | {
    kind: "dom";
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
  };

let pngEncodeSurface: PngEncodeSurface | null = null;
let pngEncodeQueue: Promise<void> = Promise.resolve();
let pngEncodeWorkerDisabled = false;
let pngEncodeNativeDisabled = false;

type PngEncodeWorkerState = {
  nextRequestId: number;
  worker: Worker;
  pending: Map<number, {
    resolve: (blob: Blob) => void;
    reject: (error: Error) => void;
  }>;
};

let pngEncodeWorkerState: PngEncodeWorkerState | null = null;

const toErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

export const cloneImageData = (frame: ImageData): ImageData => {
  return new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
};

const getPngEncodeSurface = (
  width: number,
  height: number,
): PngEncodeSurface => {
  const OffscreenCanvasConstructor = (
    globalThis as typeof globalThis & {
      OffscreenCanvas?: typeof OffscreenCanvas;
    }
  ).OffscreenCanvas;

  if (typeof OffscreenCanvasConstructor === "function") {
    if (pngEncodeSurface?.kind !== "offscreen") {
      const canvas = new OffscreenCanvasConstructor(width, height);
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Could not get reusable offscreen canvas context.");
      }

      pngEncodeSurface = {
        kind: "offscreen",
        canvas,
        context,
      };
    }

    if (pngEncodeSurface.canvas.width !== width) {
      pngEncodeSurface.canvas.width = width;
    }
    if (pngEncodeSurface.canvas.height !== height) {
      pngEncodeSurface.canvas.height = height;
    }

    return pngEncodeSurface;
  }

  if (pngEncodeSurface?.kind !== "dom") {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not get reusable canvas context.");
    }

    pngEncodeSurface = {
      kind: "dom",
      canvas,
      context,
    };
  }

  if (pngEncodeSurface.canvas.width !== width) {
    pngEncodeSurface.canvas.width = width;
  }
  if (pngEncodeSurface.canvas.height !== height) {
    pngEncodeSurface.canvas.height = height;
  }

  return pngEncodeSurface;
};

const destroyPngEncodeWorker = (): void => {
  if (!pngEncodeWorkerState) {
    return;
  }

  pngEncodeWorkerState.worker.terminate();
  const pending = [...pngEncodeWorkerState.pending.values()];
  pngEncodeWorkerState.pending.clear();
  pngEncodeWorkerState = null;

  for (const request of pending) {
    request.reject(new Error("PNG encode worker was terminated."));
  }
};

const getPngEncodeWorkerState = (): PngEncodeWorkerState | null => {
  if (pngEncodeWorkerDisabled || typeof Worker !== "function") {
    return null;
  }

  if (pngEncodeWorkerState) {
    return pngEncodeWorkerState;
  }

  try {
    const worker = new Worker(new URL("./png-encode.worker.ts", import.meta.url), {
      type: "module",
    });
    const pending = new Map<number, {
      resolve: (blob: Blob) => void;
      reject: (error: Error) => void;
    }>();

    worker.onmessage = (event: MessageEvent<{ id: number; data?: ArrayBuffer; error?: string }>) => {
      const { id, data, error } = event.data;
      const request = pending.get(id);
      if (!request) {
        return;
      }

      pending.delete(id);

      if (error) {
        request.reject(new Error(error));
        return;
      }

      if (!data) {
        request.reject(new Error("PNG encode worker returned no data."));
        return;
      }

      request.resolve(new Blob([data], { type: "image/png" }));
    };

    worker.onerror = (event) => {
      pngEncodeWorkerDisabled = true;
      const message = event.message || "PNG encode worker failed.";
      const requests = [...pending.values()];
      pending.clear();
      destroyPngEncodeWorker();
      for (const request of requests) {
        request.reject(new Error(message));
      }
    };

    pngEncodeWorkerState = {
      nextRequestId: 1,
      worker,
      pending,
    };
  } catch {
    pngEncodeWorkerDisabled = true;
    return null;
  }

  return pngEncodeWorkerState;
};

const encodeImageDataToPngBlobLocally = async (frame: ImageData): Promise<Blob> => {
  const previousEncode = pngEncodeQueue;
  let releaseEncode: (() => void) | undefined;
  pngEncodeQueue = new Promise<void>((resolve) => {
    releaseEncode = resolve;
  });

  await previousEncode;

  try {
    const surface = getPngEncodeSurface(frame.width, frame.height);
    surface.context.putImageData(frame, 0, 0);

    if (surface.kind === "offscreen") {
      return await surface.canvas.convertToBlob({ type: "image/png" });
    }

    return await new Promise<Blob>((resolve, reject) => {
      surface.canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to encode the frame as PNG."));
        }
      }, "image/png");
    });
  } finally {
    releaseEncode?.();
  }
};

const encodeImageDataToPngBlobViaWorker = async (frame: ImageData): Promise<Blob> => {
  const workerState = getPngEncodeWorkerState();
  if (!workerState) {
    return await encodeImageDataToPngBlobLocally(frame);
  }

  const requestId = workerState.nextRequestId;
  workerState.nextRequestId += 1;

  const copiedData = new Uint8ClampedArray(frame.data);

  const blobPromise = new Promise<Blob>((resolve, reject) => {
    workerState.pending.set(requestId, { resolve, reject });
  });

  workerState.worker.postMessage({
    id: requestId,
    width: frame.width,
    height: frame.height,
    data: copiedData.buffer,
  }, [copiedData.buffer]);

  return await blobPromise;
};

const encodeImageDataToPngBlobViaNative = async (frame: ImageData): Promise<Blob> => {
  if (!isTauri()) {
    throw new Error("Native PNG encode is only available in Tauri desktop builds.");
  }

  const { encodeTauriPngRgba } = await import("@/lib/tauri/adb");
  const rgba = new Uint8Array(frame.data);
  const encodedBytes = await encodeTauriPngRgba(frame.width, frame.height, rgba);
  return new Blob([new Uint8Array(encodedBytes)], { type: "image/png" });
};

export const encodeImageDataToPngBlob = async (frame: ImageData): Promise<Blob> => {
  if (!pngEncodeNativeDisabled && isTauri()) {
    try {
      return await encodeImageDataToPngBlobViaNative(frame);
    } catch (error) {
      console.warn("[Scanner] Native PNG encode failed, falling back to browser encoder.", error);
      pngEncodeNativeDisabled = true;
    }
  }

  try {
    return await encodeImageDataToPngBlobViaWorker(frame);
  } catch (error) {
    console.warn("[Scanner] PNG encode worker failed, falling back to local encoder.", error);
    pngEncodeWorkerDisabled = true;
    destroyPngEncodeWorker();
    return await encodeImageDataToPngBlobLocally(frame);
  }
};

const imageDataToCanvas = (frame: ImageData): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not get temporary canvas context.");
  }

  context.putImageData(frame, 0, 0);
  return canvas;
};

const bitmapToImageData = (bitmap: ImageBitmap): ImageData => {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not get temporary canvas context.");
  }

  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
};

type BrowserImageDecoder = {
  close?: () => void;
  decode: () => Promise<{ image: ImageBitmap }>;
};

type BrowserImageDecoderConstructor = new (init: {
  data: BufferSource;
  type: string;
}) => BrowserImageDecoder;

const getImageDecoderConstructor = (): BrowserImageDecoderConstructor | null => {
  const candidate = (globalThis as typeof globalThis & {
    ImageDecoder?: BrowserImageDecoderConstructor;
  }).ImageDecoder;

  return typeof candidate === "function" ? candidate : null;
};

export const decodeImageUrlToImageData = async (
  src: string,
  revokeUrl?: () => void,
): Promise<ImageData> => {
  return await new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Could not get temporary canvas context."));
          return;
        }

        context.drawImage(img, 0, 0);
        resolve(context.getImageData(0, 0, canvas.width, canvas.height));
      } catch (error) {
        reject(error);
      } finally {
        revokeUrl?.();
      }
    };

    img.onerror = () => {
      revokeUrl?.();
      reject(new Error("Failed to decode still image payload."));
    };

    img.src = src;
  });
};

export const readBlobAsDataUrl = async (blob: Blob): Promise<string> => {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Failed to read still image blob as a data URL."));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read still image blob."));
    };
    reader.readAsDataURL(blob);
  });
};

const decodeBlobWithImageDecoder = async (blob: Blob): Promise<ImageData> => {
  const ImageDecoderConstructor = getImageDecoderConstructor();
  if (!ImageDecoderConstructor || !blob.type) {
    throw new Error("ImageDecoder is not available for still decoding.");
  }

  const decoder = new ImageDecoderConstructor({
    data: await blob.arrayBuffer(),
    type: blob.type,
  });

  try {
    const { image } = await decoder.decode();
    try {
      return bitmapToImageData(image);
    } finally {
      image.close();
    }
  } finally {
    decoder.close?.();
  }
};

export const decodeBlobToImageData = async (blob: Blob): Promise<ImageData> => {
  const failures: string[] = [];

  try {
    return await decodeBlobWithImageDecoder(blob);
  } catch (error) {
    failures.push(`ImageDecoder=${toErrorMessage(error)}`);
  }

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      try {
        return bitmapToImageData(bitmap);
      } finally {
        bitmap.close();
      }
    } catch (error) {
      failures.push(`createImageBitmap=${toErrorMessage(error)}`);
    }
  } else {
    failures.push("createImageBitmap=unavailable");
  }

  try {
    const dataUrl = await readBlobAsDataUrl(blob);
    return await decodeImageUrlToImageData(dataUrl);
  } catch (error) {
    failures.push(`dataUrl=${toErrorMessage(error)}`);
    throw new Error(`Failed to decode still image payload. ${failures.join(" | ")}`);
  }
};

export const rotateImageData = (
  frame: ImageData,
  rotation: OrthogonalRotation,
): ImageData => {
  if (rotation === 0) {
    return cloneImageData(frame);
  }

  const sourceCanvas = imageDataToCanvas(frame);
  const targetCanvas = document.createElement("canvas");

  if (rotation === 90 || rotation === 270) {
    targetCanvas.width = frame.height;
    targetCanvas.height = frame.width;
  } else {
    targetCanvas.width = frame.width;
    targetCanvas.height = frame.height;
  }

  const context = targetCanvas.getContext("2d");
  if (!context) {
    throw new Error("Could not get temporary canvas context.");
  }

  context.save();
  switch (rotation) {
    case 90:
      context.translate(targetCanvas.width, 0);
      context.rotate(Math.PI / 2);
      break;
    case 180:
      context.translate(targetCanvas.width, targetCanvas.height);
      context.rotate(Math.PI);
      break;
    case 270:
      context.translate(0, targetCanvas.height);
      context.rotate(-Math.PI / 2);
      break;
    default:
      break;
  }
  context.drawImage(sourceCanvas, 0, 0);
  context.restore();

  return context.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
};
