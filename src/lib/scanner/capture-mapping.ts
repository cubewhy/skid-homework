import type {Point} from "./document-detector";

export interface FrameDimensions {
  width: number;
  height: number;
}

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
