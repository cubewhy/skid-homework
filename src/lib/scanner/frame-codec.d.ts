export const FRAME_CODEC_QOI: 1;
export const FRAME_CODEC_LUMA8: 2;
export const FRAME_CODEC_I420: 3;
export const FRAME_PACKET_HEADER_SIZE: number;

export interface NormalizedFramePayload {
  buffer: ArrayBuffer;
  byteOffset: number;
  byteLength: number;
}

export interface ParsedFramePacket {
  codec: number;
  width: number;
  height: number;
  payload: Uint8Array;
}

export interface DecodedRgbaFrame {
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

export function normalizeFramePayload(
  data: Uint8Array | ArrayBuffer | number[],
): NormalizedFramePayload;

export function parseFramePacket(
  data: Uint8Array | ArrayBuffer | number[],
): ParsedFramePacket;

export function decodeFramePacketToRgba(
  data: Uint8Array | ArrayBuffer | number[],
  targetRgba?: Uint8ClampedArray<ArrayBufferLike>,
): DecodedRgbaFrame;

export function decodeQoiToRgba(
  payload: Uint8Array,
  expectedWidth: number,
  expectedHeight: number,
): Uint8ClampedArray<ArrayBuffer>;

export function decodeLuma8ToRgba(
  payload: Uint8Array,
  width: number,
  height: number,
  targetRgba?: Uint8ClampedArray<ArrayBufferLike>,
): Uint8ClampedArray<ArrayBuffer>;

export function decodeI420ToRgba(
  payload: Uint8Array,
  width: number,
  height: number,
  targetRgba?: Uint8ClampedArray<ArrayBufferLike>,
): Uint8ClampedArray<ArrayBuffer>;
