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

export { buildDocumentContourDetectionOptions, detectDocumentContour } from "./document-detector";
export type { Point } from "./document-detector";
export { StabilityTracker } from "./stability-tracker";
export {
  DetectionPresenceTracker,
  type DetectionPresenceState,
} from "./detection-presence-tracker";
export {
  applyPerspectiveTransform,
  applyPerspectiveTransformToImageData,
  applyPerspectiveTransformToMat,
} from "./perspective-transform";
export {
  enhanceDocumentImage,
  enhanceDocumentImageData,
  enhanceDocumentRgbaMatToImageData,
} from "./document-enhancer";
export {
  evaluateFrameMappingCompatibility,
  scalePointBetweenFrames,
  scalePointsBetweenFrames,
} from "./capture-mapping";
export type { FrameDimensions, FrameMappingCompatibility } from "./capture-mapping";
