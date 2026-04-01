import type {Point} from "./document-detector";

export interface FrameDimensions {
  width: number;
  height: number;
}

export interface FrameMappingCompatibility {
  compatible: boolean;
  aspectDelta: number;
  reason: string | null;
}

const DEFAULT_ASPECT_DELTA_TOLERANCE = 0.015;

const assertValidDimensions = (dimensions: FrameDimensions, label: string): void => {
  if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height)) {
    throw new Error(`${label} dimensions must be finite numbers.`);
  }

  if (dimensions.width <= 0 || dimensions.height <= 0) {
    throw new Error(`${label} dimensions must be greater than zero.`);
  }
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const normalizedAspectRatio = (dimensions: FrameDimensions): number => {
  const longer = Math.max(dimensions.width, dimensions.height);
  const shorter = Math.min(dimensions.width, dimensions.height);
  return longer / shorter;
};

const orientationLabel = (dimensions: FrameDimensions): "landscape" | "portrait" | "square" => {
  if (dimensions.width === dimensions.height) {
    return "square";
  }

  return dimensions.width > dimensions.height ? "landscape" : "portrait";
};

/**
 * Scale a single point from one frame space into another.
 */
export const scalePointBetweenFrames = (
  point: Point,
  source: FrameDimensions,
  target: FrameDimensions,
): Point => {
  assertValidDimensions(source, "Source");
  assertValidDimensions(target, "Target");

  const x = (point.x / source.width) * target.width;
  const y = (point.y / source.height) * target.height;

  return {
    x: clamp(x, 0, Math.max(0, target.width - 1)),
    y: clamp(y, 0, Math.max(0, target.height - 1)),
  };
};

/**
 * Scale a set of contour points from preview coordinates to still-capture coordinates.
 */
export const scalePointsBetweenFrames = (
  points: Point[],
  source: FrameDimensions,
  target: FrameDimensions,
): Point[] => {
  return points.map((point) => scalePointBetweenFrames(point, source, target));
};

/**
 * Validate whether preview-space points can be safely scaled into the target frame
 * without silently assuming a mismatched crop or aspect ratio.
 */
export const evaluateFrameMappingCompatibility = (
  source: FrameDimensions,
  target: FrameDimensions,
  maxAspectDelta: number = DEFAULT_ASPECT_DELTA_TOLERANCE,
): FrameMappingCompatibility => {
  assertValidDimensions(source, "Source");
  assertValidDimensions(target, "Target");

  const sourceOrientation = orientationLabel(source);
  const targetOrientation = orientationLabel(target);

  if (sourceOrientation !== targetOrientation) {
    return {
      compatible: false,
      aspectDelta: 1,
      reason: `Preview/still orientation mismatch (${sourceOrientation} -> ${targetOrientation}).`,
    };
  }

  const sourceAspect = normalizedAspectRatio(source);
  const targetAspect = normalizedAspectRatio(target);
  const aspectDelta = Math.abs(sourceAspect - targetAspect) / sourceAspect;

  if (aspectDelta > maxAspectDelta) {
    return {
      compatible: false,
      aspectDelta,
      reason: `Preview/still aspect ratio mismatch (${source.width}x${source.height} -> ${target.width}x${target.height}, delta=${aspectDelta.toFixed(4)}).`,
    };
  }

  return {
    compatible: true,
    aspectDelta,
    reason: null,
  };
};
