export type OrthogonalRotation = 0 | 90 | 180 | 270;

const toErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

export const cloneImageData = (frame: ImageData): ImageData => {
  return new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height);
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
