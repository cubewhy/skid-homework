import type {Point} from "./document-detector";

export interface ScannerCvWorkerInitRequest {
  type: "init";
}

export interface ScannerCvWorkerDetectRequest {
  type: "detect";
  requestId: number;
  frameVersion: number;
  width: number;
  height: number;
  maxWidth: number;
  maxHeight: number;
  pixels: ArrayBuffer;
}

export type ScannerCvWorkerRequest =
  | ScannerCvWorkerInitRequest
  | ScannerCvWorkerDetectRequest;

export interface ScannerCvWorkerReadyResponse {
  type: "ready";
}

export interface ScannerCvWorkerResultResponse {
  type: "result";
  requestId: number;
  frameVersion: number;
  processingMs: number;
  points: Point[] | null;
}

export interface ScannerCvWorkerErrorResponse {
  type: "error";
  phase: "init" | "detect" | "runtime";
  message: string;
  requestId?: number;
}

export type ScannerCvWorkerResponse =
  | ScannerCvWorkerReadyResponse
  | ScannerCvWorkerResultResponse
  | ScannerCvWorkerErrorResponse;
