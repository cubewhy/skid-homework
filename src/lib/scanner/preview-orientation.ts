import type {OrthogonalRotation} from "./image-data";

export type PreviewOrientation = "landscape" | "portrait";

export interface PreviewOrientationPoint {
  x: number;
  y: number;
}

export interface OrientedFrameDimensions {
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

/**
 * Rotates a point from native landscape frame space into portrait preview space.
 */
export const rotatePointClockwiseWithinFrame = (
  point: PreviewOrientationPoint,
  frameWidth: number,
  frameHeight: number,
): PreviewOrientationPoint => {
  return {
    x: clamp(frameHeight - 1 - point.y, 0, Math.max(0, frameHeight - 1)),
    y: clamp(point.x, 0, Math.max(0, frameWidth - 1)),
  };
};

/**
 * Returns the visible frame dimensions for the requested preview orientation.
 */
export const getOrientedFrameDimensions = (
  frameWidth: number,
  frameHeight: number,
  orientation: PreviewOrientation,
): OrientedFrameDimensions => {
  if (orientation === "portrait") {
    return {
      width: frameHeight,
      height: frameWidth,
    };
  }

  return {
    width: frameWidth,
    height: frameHeight,
  };
};

/**
 * Converts a point from native frame space into the active preview orientation.
 */
export const orientPointForPreview = (
  point: PreviewOrientationPoint,
  frameWidth: number,
  frameHeight: number,
  orientation: PreviewOrientation,
): PreviewOrientationPoint => {
  if (orientation === "portrait") {
    return rotatePointClockwiseWithinFrame(point, frameWidth, frameHeight);
  }

  return point;
};

/**
 * Converts a point set from native frame space into the active preview orientation.
 */
export const orientPointsForPreview = (
  points: PreviewOrientationPoint[],
  frameWidth: number,
  frameHeight: number,
  orientation: PreviewOrientation,
): PreviewOrientationPoint[] => {
  return points.map((point) => orientPointForPreview(point, frameWidth, frameHeight, orientation));
};

/**
 * Maps a point from a frame that has already been rotated clockwise back into
 * the original source-image coordinate space.
 */
export const mapPointFromRotatedFrameToSource = (
  point: PreviewOrientationPoint,
  sourceWidth: number,
  sourceHeight: number,
  rotation: OrthogonalRotation,
): PreviewOrientationPoint => {
  switch (rotation) {
    case 90:
      return {
        x: clamp(point.y, 0, Math.max(0, sourceWidth - 1)),
        y: clamp(sourceHeight - 1 - point.x, 0, Math.max(0, sourceHeight - 1)),
      };
    case 180:
      return {
        x: clamp(sourceWidth - 1 - point.x, 0, Math.max(0, sourceWidth - 1)),
        y: clamp(sourceHeight - 1 - point.y, 0, Math.max(0, sourceHeight - 1)),
      };
    case 270:
      return {
        x: clamp(sourceWidth - 1 - point.y, 0, Math.max(0, sourceWidth - 1)),
        y: clamp(point.x, 0, Math.max(0, sourceHeight - 1)),
      };
    default:
      return {
        x: clamp(point.x, 0, Math.max(0, sourceWidth - 1)),
        y: clamp(point.y, 0, Math.max(0, sourceHeight - 1)),
      };
  }
};

export const mapPointsFromRotatedFrameToSource = (
  points: PreviewOrientationPoint[],
  sourceWidth: number,
  sourceHeight: number,
  rotation: OrthogonalRotation,
): PreviewOrientationPoint[] => {
  return points.map((point) => mapPointFromRotatedFrameToSource(
    point,
    sourceWidth,
    sourceHeight,
    rotation,
  ));
};
