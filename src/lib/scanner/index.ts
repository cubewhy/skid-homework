/**
 * Scanner module public API.
 */

export { createFrameSource, DEFAULT_SCANNER_CONFIG } from "./frame-source";
export type {
  FrameSource,
  FrameCallback,
  ErrorCallback,
  FrameSourceState,
  FrameSourceStatus,
  FrameSourceMetrics,
  FrameSourceBenchmarkSnapshot,
  FrameSourceBenchmarkWindow,
  FrameSourceCapabilities,
  FrameSourceStateCallback,
  ScannerConfig,
  ScannerStillCapture,
} from "./frame-source";

export { detectDocumentContour } from "./document-detector";
export type { Point } from "./document-detector";
export { StabilityTracker } from "./stability-tracker";
export { applyPerspectiveTransform } from "./perspective-transform";
export { enhanceDocumentImage } from "./document-enhancer";
export { scalePointBetweenFrames, scalePointsBetweenFrames } from "./capture-mapping";
export type { FrameDimensions } from "./capture-mapping";
