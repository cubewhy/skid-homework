/**
 * Binary frame packet parsing and QOI decoding utilities for the scanner.
 */

export const FRAME_CODEC_QOI = 1;
export const FRAME_CODEC_LUMA8 = 2;
export const FRAME_CODEC_I420 = 3;
export const FRAME_CODEC_I420_TELEMETRY = 4;
export const FRAME_PACKET_HEADER_SIZE = 9;
export const FRAME_PACKET_TELEMETRY_SIZE = 12;

export interface NormalizedFramePayload { buffer: ArrayBuffer; byteOffset: number; byteLength: number; }
export interface FramePacketTelemetry { sentAtEpochMs: number; sequence: number; }
export interface ParsedFramePacket { codec: number; width: number; height: number; payload: Uint8Array; telemetry: FramePacketTelemetry | null; }
export interface DecodedRgbaFrame { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer>; telemetry: FramePacketTelemetry | null; }


const QOI_MAGIC = [0x71, 0x6f, 0x69, 0x66];
const QOI_HEADER_SIZE = 14;
const QOI_END_MARKER_SIZE = 8;
const QOI_MASK_2 = 0xc0;
const QOI_OP_INDEX = 0x00;
const QOI_OP_DIFF = 0x40;
const QOI_OP_LUMA = 0x80;
const QOI_OP_RUN = 0xc0;
const QOI_OP_RGB = 0xfe;
const QOI_OP_RGBA = 0xff;
const IS_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44;
const GRAY_TO_RGBA_LUT = new Uint32Array(256);
const Y_TO_RGB_LUT = new Int32Array(256);
const U_TO_BLUE_LUT = new Int32Array(256);
const U_TO_GREEN_LUT = new Int32Array(256);
const V_TO_RED_LUT = new Int32Array(256);
const V_TO_GREEN_LUT = new Int32Array(256);
 
const LITTLE_ENDIAN_RGBA_ALPHA = 0xff << 24;
 
const BIG_ENDIAN_RGBA_ALPHA = 0xff;

for (let value = 0; value < GRAY_TO_RGBA_LUT.length; value += 1) {
  GRAY_TO_RGBA_LUT[value] = IS_LITTLE_ENDIAN
    ? (0xff << 24) | (value << 16) | (value << 8) | value
    : (value << 24) | (value << 16) | (value << 8) | 0xff;

  const luma = Math.max(0, value - 16);
  const chroma = value - 128;
  Y_TO_RGB_LUT[value] = 298 * luma;
  U_TO_BLUE_LUT[value] = 516 * chroma;
  U_TO_GREEN_LUT[value] = -100 * chroma;
  V_TO_RED_LUT[value] = 409 * chroma;
  V_TO_GREEN_LUT[value] = -208 * chroma;
}

/**
 * Normalize different Tauri IPC payload shapes to a single buffer view.
 *
 * @param {Uint8Array | ArrayBuffer | number[]} data
 * @returns {{ buffer: ArrayBuffer, byteOffset: number, byteLength: number }}
 */
export const normalizeFramePayload = (data: Uint8Array | ArrayBuffer | number[]): NormalizedFramePayload => {
  if (data instanceof ArrayBuffer) {
    return {
      buffer: data,
      byteOffset: 0,
      byteLength: data.byteLength,
    };
  }

  if (ArrayBuffer.isView(data)) {
    return {
      buffer: data.buffer as ArrayBuffer,
      byteOffset: data.byteOffset,
      byteLength: data.byteLength,
    };
  }

  const normalized = Uint8Array.from(data);
  return {
    buffer: normalized.buffer as ArrayBuffer,
    byteOffset: 0,
    byteLength: normalized.byteLength,
  };
};

/**
 * Parse a codec-tagged scanner frame packet.
 *
 * @param {Uint8Array | ArrayBuffer | number[]} data
 * @returns {{ codec: number, width: number, height: number, payload: Uint8Array }}
 */
export const parseFramePacket = (data: Uint8Array | ArrayBuffer | number[]): ParsedFramePacket => {
  const { buffer, byteOffset, byteLength } = normalizeFramePayload(data);

  if (byteLength < FRAME_PACKET_HEADER_SIZE) {
    throw new Error("Frame packet is shorter than the protocol header.");
  }

  const view = new DataView(buffer, byteOffset, byteLength);
  const codec = view.getUint8(0);
  const width = view.getUint32(1, false);
  const height = view.getUint32(5, false);
  let payloadOffset = FRAME_PACKET_HEADER_SIZE;
  let telemetry: FramePacketTelemetry | null = null;

  if (codec === FRAME_CODEC_I420_TELEMETRY) {
    if (byteLength < FRAME_PACKET_HEADER_SIZE + FRAME_PACKET_TELEMETRY_SIZE) {
      throw new Error("Frame packet telemetry header is truncated.");
    }

    telemetry = {
      sentAtEpochMs: Number(view.getBigUint64(FRAME_PACKET_HEADER_SIZE, false)),
      sequence: view.getUint32(FRAME_PACKET_HEADER_SIZE + 8, false),
    };
    payloadOffset += FRAME_PACKET_TELEMETRY_SIZE;
  }

  const payload = new Uint8Array(buffer, byteOffset + payloadOffset, byteLength - payloadOffset);

  return { codec, width, height, payload, telemetry };
};

/**
 * Decode a codec-tagged frame packet to RGBA pixels.
 *
 * @param {Uint8Array | ArrayBuffer | number[]} data
 * @param {Uint8ClampedArray<ArrayBufferLike>=} targetRgba
 * @returns {{ width: number, height: number, rgba: Uint8ClampedArray }}
 */
export const decodeFramePacketToRgba = (data: Uint8Array | ArrayBuffer | number[], targetRgba?: Uint8ClampedArray<ArrayBufferLike>): DecodedRgbaFrame => {
  const { codec, width, height, payload, telemetry } = parseFramePacket(data);

  if (codec === FRAME_CODEC_QOI) {
    return {
      width,
      height,
      rgba: decodeQoiToRgba(payload, width, height),
      telemetry,
    };
  }

  if (codec === FRAME_CODEC_LUMA8) {
    return {
      width,
      height,
      rgba: decodeLuma8ToRgba(payload, width, height, targetRgba),
      telemetry,
    };
  }

  if (codec === FRAME_CODEC_I420 || codec === FRAME_CODEC_I420_TELEMETRY) {
    return {
      width,
      height,
      rgba: decodeI420ToRgba(payload, width, height, targetRgba),
      telemetry,
    };
  }

  throw new Error(`Unsupported scanner frame codec: ${codec}.`);
};

/**
 * Decode a QOI image payload to RGBA pixels.
 *
 * @param {Uint8Array} payload
 * @param {number} expectedWidth
 * @param {number} expectedHeight
 * @returns {Uint8ClampedArray}
 */
export const decodeQoiToRgba = (payload: Uint8Array, expectedWidth: number, expectedHeight: number): Uint8ClampedArray<ArrayBuffer> => {
  if (payload.length < QOI_HEADER_SIZE + QOI_END_MARKER_SIZE) {
    throw new Error("QOI payload is too short.");
  }

  for (let index = 0; index < QOI_MAGIC.length; index += 1) {
    if (payload[index] !== QOI_MAGIC[index]) {
      throw new Error("QOI payload has an invalid magic header.");
    }
  }

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const width = view.getUint32(4, false);
  const height = view.getUint32(8, false);
  const channels = payload[12];

  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error("Frame packet dimensions do not match the QOI payload header.");
  }

  if (channels !== 3 && channels !== 4) {
    throw new Error(`Unsupported QOI channel count: ${channels}.`);
  }

  const pixelCount = width * height;
  const rgba = new Uint8ClampedArray(pixelCount * 4) as Uint8ClampedArray<ArrayBuffer>;
  const index = new Uint8Array(64 * 4);

  let cursor = QOI_HEADER_SIZE;
  let run = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 255;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    if (run > 0) {
      run -= 1;
    } else {
      if (cursor >= payload.length - QOI_END_MARKER_SIZE) {
        throw new Error("QOI payload ended before all pixels were decoded.");
      }

      const byte1 = payload[cursor];
      cursor += 1;

      if (byte1 === QOI_OP_RGB) {
        red = payload[cursor];
        green = payload[cursor + 1];
        blue = payload[cursor + 2];
        cursor += 3;
      } else if (byte1 === QOI_OP_RGBA) {
        red = payload[cursor];
        green = payload[cursor + 1];
        blue = payload[cursor + 2];
        alpha = payload[cursor + 3];
        cursor += 4;
      } else {
        switch (byte1 & QOI_MASK_2) {
          case QOI_OP_INDEX: {
            const slot = (byte1 & 0x3f) * 4;
            red = index[slot];
            green = index[slot + 1];
            blue = index[slot + 2];
            alpha = index[slot + 3];
            break;
          }
          case QOI_OP_DIFF:
            red = (red + ((byte1 >> 4) & 0x03) - 2 + 256) & 0xff;
            green = (green + ((byte1 >> 2) & 0x03) - 2 + 256) & 0xff;
            blue = (blue + (byte1 & 0x03) - 2 + 256) & 0xff;
            break;
          case QOI_OP_LUMA: {
            if (cursor >= payload.length - QOI_END_MARKER_SIZE) {
              throw new Error("QOI payload ended in the middle of a luma chunk.");
            }

            const byte2 = payload[cursor];
            cursor += 1;

            const greenDiff = (byte1 & 0x3f) - 32;
            red = (red + greenDiff + ((byte2 >> 4) & 0x0f) - 8 + 256) & 0xff;
            green = (green + greenDiff + 256) & 0xff;
            blue = (blue + greenDiff + (byte2 & 0x0f) - 8 + 256) & 0xff;
            break;
          }
          case QOI_OP_RUN:
            run = byte1 & 0x3f;
            break;
          default:
            throw new Error(`Unsupported QOI opcode: ${byte1}.`);
        }
      }
    }

    const outputOffset = pixelIndex * 4;
    rgba[outputOffset] = red;
    rgba[outputOffset + 1] = green;
    rgba[outputOffset + 2] = blue;
    rgba[outputOffset + 3] = alpha;

    const hash = ((red * 3 + green * 5 + blue * 7 + alpha * 11) & 0x3f) * 4;
    index[hash] = red;
    index[hash + 1] = green;
    index[hash + 2] = blue;
    index[hash + 3] = alpha;
  }

  const expectedEndOffset = cursor;
  const remaining = payload.subarray(expectedEndOffset, expectedEndOffset + QOI_END_MARKER_SIZE);
  const endMarker = [0, 0, 0, 0, 0, 0, 0, 1];

  if (remaining.length !== QOI_END_MARKER_SIZE) {
    throw new Error("QOI payload is missing the end marker.");
  }

  for (let index = 0; index < endMarker.length; index += 1) {
    if (remaining[index] !== endMarker[index]) {
      throw new Error("QOI payload has an invalid end marker.");
    }
  }

  return rgba;
};

/**
 * Expand a raw 8-bit luma plane to RGBA for preview rendering.
 *
 * @param {Uint8Array} payload
 * @param {number} width
 * @param {number} height
 * @param {Uint8ClampedArray<ArrayBufferLike>=} targetRgba
 * @returns {Uint8ClampedArray<ArrayBuffer>}
 */
export const decodeLuma8ToRgba = (payload: Uint8Array, width: number, height: number, targetRgba?: Uint8ClampedArray<ArrayBufferLike>): Uint8ClampedArray<ArrayBuffer> => {
  const pixelCount = width * height;

  if (payload.length !== pixelCount) {
    throw new Error(`Invalid LUMA8 payload size: expected ${pixelCount}, got ${payload.length}.`);
  }

  const { rgba, rgba32 } = resolveRgbaTarget(pixelCount, targetRgba);

  for (let index = 0; index < pixelCount; index += 1) {
    rgba32[index] = GRAY_TO_RGBA_LUT[payload[index]];
  }

  return rgba;
};

/**
 * Decode a tightly packed I420 frame to RGBA.
 *
 * @param {Uint8Array} payload
 * @param {number} width
 * @param {number} height
 * @param {Uint8ClampedArray<ArrayBufferLike>=} targetRgba
 * @returns {Uint8ClampedArray<ArrayBuffer>}
 */
export const decodeI420ToRgba = (payload: Uint8Array, width: number, height: number, targetRgba?: Uint8ClampedArray<ArrayBufferLike>): Uint8ClampedArray<ArrayBuffer> => {
  if ((width & 1) !== 0 || (height & 1) !== 0) {
    throw new Error(`I420 preview frames require even dimensions, got ${width}x${height}.`);
  }

  const lumaSize = width * height;
  const chromaWidth = width >> 1;
  const chromaHeight = height >> 1;
  const chromaSize = chromaWidth * chromaHeight;
  const expectedSize = lumaSize + chromaSize * 2;

  if (payload.length !== expectedSize) {
    throw new Error(`Invalid I420 payload size: expected ${expectedSize}, got ${payload.length}.`);
  }

  const yPlane = payload.subarray(0, lumaSize);
  const uPlane = payload.subarray(lumaSize, lumaSize + chromaSize);
  const vPlane = payload.subarray(lumaSize + chromaSize, expectedSize);
  const { rgba, rgba32 } = resolveRgbaTarget(lumaSize, targetRgba);

  for (let row = 0; row < height; row += 2) {
    const yRow0 = row * width;
    const yRow1 = yRow0 + width;
    const chromaRow = (row >> 1) * chromaWidth;

    for (let col = 0; col < width; col += 2) {
      const chromaIndex = chromaRow + (col >> 1);
      const u = uPlane[chromaIndex];
      const v = vPlane[chromaIndex];
      const blueContribution = U_TO_BLUE_LUT[u];
      const greenContribution = U_TO_GREEN_LUT[u] + V_TO_GREEN_LUT[v];
      const redContribution = V_TO_RED_LUT[v];

      const pixel0 = yRow0 + col;
      rgba32[pixel0] = packRgbaFromYuv(
        yPlane[pixel0],
        redContribution,
        greenContribution,
        blueContribution,
      );
      rgba32[pixel0 + 1] = packRgbaFromYuv(
        yPlane[pixel0 + 1],
        redContribution,
        greenContribution,
        blueContribution,
      );

      const pixel2 = yRow1 + col;
      rgba32[pixel2] = packRgbaFromYuv(
        yPlane[pixel2],
        redContribution,
        greenContribution,
        blueContribution,
      );
      rgba32[pixel2 + 1] = packRgbaFromYuv(
        yPlane[pixel2 + 1],
        redContribution,
        greenContribution,
        blueContribution,
      );
    }
  }

  return rgba;
};

/**
 * Resolve a reusable RGBA target buffer for decoder hot paths.
 *
 * @param {number} pixelCount
 * @param {Uint8ClampedArray<ArrayBufferLike>=} targetRgba
 * @returns {{ rgba: Uint8ClampedArray<ArrayBufferLike>, rgba32: Uint32Array<ArrayBufferLike> }}
 */
const resolveRgbaTarget = (pixelCount: number, targetRgba?: Uint8ClampedArray<ArrayBufferLike>): { rgba: Uint8ClampedArray<ArrayBuffer>, rgba32: Uint32Array<ArrayBuffer> } => {
  const byteLength = pixelCount * 4;

  if (
    targetRgba &&
    targetRgba.length === byteLength &&
    (targetRgba.byteOffset & 0x03) === 0
  ) {
    return {
      rgba: targetRgba as Uint8ClampedArray<ArrayBuffer>,
      rgba32: new Uint32Array(targetRgba.buffer, targetRgba.byteOffset, pixelCount) as Uint32Array<ArrayBuffer>,
    };
  }

  const rgba = new Uint8ClampedArray(byteLength) as Uint8ClampedArray<ArrayBuffer>;
  return {
    rgba,
    rgba32: new Uint32Array(rgba.buffer, rgba.byteOffset, pixelCount) as Uint32Array<ArrayBuffer>,
  };
};

/**
 * Pack one YUV pixel into RGBA32.
 *
 * @param {number} y
 * @param {number} redContribution
 * @param {number} greenContribution
 * @param {number} blueContribution
 * @returns {number}
 */
const packRgbaFromYuv = (y: number, redContribution: number, greenContribution: number, blueContribution: number): number => {
  const base = Y_TO_RGB_LUT[y];
  const red = clampByte((base + redContribution + 128) >> 8);
  const green = clampByte((base + greenContribution + 128) >> 8);
  const blue = clampByte((base + blueContribution + 128) >> 8);

  if (IS_LITTLE_ENDIAN) {
    return LITTLE_ENDIAN_RGBA_ALPHA | (blue << 16) | (green << 8) | red;
  }

  return (red << 24) | (green << 16) | (blue << 8) | BIG_ENDIAN_RGBA_ALPHA;
};

/**
 * Clamp an integer channel value to the 0..255 range.
 *
 * @param {number} value
 * @returns {number}
 */
const clampByte = (value: number): number => {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
};
