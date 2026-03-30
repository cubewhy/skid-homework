type PngEncodeRequest = {
  id: number;
  width: number;
  height: number;
  data: ArrayBuffer;
};

type PngEncodeResponse =
  | {
    id: number;
    data: ArrayBuffer;
  }
  | {
    id: number;
    error: string;
  };

let encodeCanvas: OffscreenCanvas | null = null;
let encodeContext: OffscreenCanvasRenderingContext2D | null = null;

const ensureEncodeSurface = (
  width: number,
  height: number,
): {
  canvas: OffscreenCanvas;
  context: OffscreenCanvasRenderingContext2D;
} => {
  if (!encodeCanvas || !encodeContext) {
    encodeCanvas = new OffscreenCanvas(width, height);
    encodeContext = encodeCanvas.getContext("2d");
    if (!encodeContext) {
      throw new Error("Could not get PNG encode worker canvas context.");
    }
  }

  if (encodeCanvas.width !== width) {
    encodeCanvas.width = width;
  }
  if (encodeCanvas.height !== height) {
    encodeCanvas.height = height;
  }

  return {
    canvas: encodeCanvas,
    context: encodeContext,
  };
};

const postWorkerResponse = (payload: PngEncodeResponse, transfer?: Transferable[]): void => {
  self.postMessage(payload, transfer ?? []);
};

self.onmessage = (event: MessageEvent<PngEncodeRequest>) => {
  void (async () => {
    const { id, width, height, data } = event.data;

    try {
      const { canvas, context } = ensureEncodeSurface(width, height);
      const frame = new ImageData(new Uint8ClampedArray(data), width, height);
      context.putImageData(frame, 0, 0);

      const encodedBlob = await canvas.convertToBlob({ type: "image/png" });
      const encodedBuffer = await encodedBlob.arrayBuffer();

      postWorkerResponse(
        {
          id,
          data: encodedBuffer,
        },
        [encodedBuffer],
      );
    } catch (error) {
      postWorkerResponse({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
};
