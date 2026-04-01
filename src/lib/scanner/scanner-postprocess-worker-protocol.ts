import type {Point} from "./document-detector";
import type {OrthogonalRotation} from "./image-data";

export interface ScannerPostProcessWorkerInitRequest {
  type: "init";
}

export interface ScannerPostProcessWorkerProcessRequest {
  type: "process";
  requestId: number;
  inputKind: "image-data" | "encoded-image";
  width?: number;
  height?: number;
  pixels?: ArrayBuffer;
  sourceBlob?: Blob;
  documentPoints: Point[] | null;
  outputRotation: OrthogonalRotation;
  imageEnhancement: boolean;
}

export type ScannerPostProcessWorkerRequest =
  | ScannerPostProcessWorkerInitRequest
  | ScannerPostProcessWorkerProcessRequest;

export interface ScannerPostProcessWorkerReadyResponse {
  type: "ready";
}

export interface ScannerPostProcessWorkerResultResponse {
  type: "result";
  requestId: number;
  processingMs: number;
  decodeMs: number | null;
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

export interface ScannerPostProcessWorkerErrorResponse {
  type: "error";
  phase: "init" | "process" | "runtime";
  message: string;
  requestId?: number;
}

export type ScannerPostProcessWorkerResponse =
  | ScannerPostProcessWorkerReadyResponse
  | ScannerPostProcessWorkerResultResponse
  | ScannerPostProcessWorkerErrorResponse;
