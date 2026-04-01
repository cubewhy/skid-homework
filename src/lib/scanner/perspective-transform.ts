import type {Point} from "./document-detector";
import {encodeImageDataToPngBlob} from "./image-data";

/**
 * Calculates the Euclidean distance between two points.
 */
function distance(p1: Point, p2: Point): number {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getOpenCvRuntime = (): any => {
  const scope = globalThis as typeof globalThis & {
    cv?: unknown;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cv = scope.cv as any;
  if (!cv || !cv.Mat) {
    throw new Error("OpenCV.js is not loaded");
  }

  return cv;
};

/**
 * Orders corners using the same sum/diff rule as the reference scanner.
 */
function orderPoints(points: Point[]): Point[] {
  if (points.length !== 4) {
    return points;
  }

  const sums = points.map((point) => point.x + point.y);
  const diffs = points.map((point) => point.y - point.x);

  return [
    points[sums.indexOf(Math.min(...sums))],
    points[diffs.indexOf(Math.min(...diffs))],
    points[sums.indexOf(Math.max(...sums))],
    points[diffs.indexOf(Math.max(...diffs))],
  ];
}

const imageDataToPngBlob = async (imageData: ImageData): Promise<Blob> => {
  return await encodeImageDataToPngBlob(imageData);
};

export const applyPerspectiveTransformToImageData = (
  imageData: ImageData,
  corners: Point[],
): ImageData => {
  const warpedMat = applyPerspectiveTransformToMat(imageData, corners);
  try {
    return new ImageData(
      new Uint8ClampedArray(warpedMat.data),
      warpedMat.cols,
      warpedMat.rows,
    );
  } finally {
    warpedMat.delete();
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const applyPerspectiveTransformToMat = (imageData: ImageData, corners: Point[]): any => {
  const cv = getOpenCvRuntime();

  if (corners.length !== 4) {
    throw new Error("Perspective transform requires exactly 4 corner points.");
  }

  const [tl, tr, br, bl] = orderPoints(corners);

  const widthTop = distance(tl, tr);
  const widthBottom = distance(bl, br);
  const maxWidth = Math.max(1, Math.round(Math.max(widthTop, widthBottom)));

  const heightLeft = distance(tl, bl);
  const heightRight = distance(tr, br);
  const maxHeight = Math.max(1, Math.round(Math.max(heightLeft, heightRight)));

  const srcMat = new cv.Mat(imageData.height, imageData.width, cv.CV_8UC4);
  const dstMat = new cv.Mat();
  const srcArr = new Float32Array([
    tl.x, tl.y,
    tr.x, tr.y,
    br.x, br.y,
    bl.x, bl.y,
  ]);
  const dstArr = new Float32Array([
    0, 0,
    maxWidth - 1, 0,
    maxWidth - 1, maxHeight - 1,
    0, maxHeight - 1,
  ]);

  const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, srcArr);
  const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, dstArr);
  const transformMatrix = cv.getPerspectiveTransform(srcPoints, dstPoints);

  try {
    srcMat.data.set(imageData.data);
    cv.warpPerspective(
      srcMat,
      dstMat,
      transformMatrix,
      new cv.Size(maxWidth, maxHeight),
      cv.INTER_CUBIC,
      cv.BORDER_REPLICATE,
      new cv.Scalar(),
    );

    return dstMat;
  } catch (error) {
    console.error("[Scanner] Perspective transform failed: ", error);
    dstMat.delete();
    throw error;
  } finally {
    srcMat.delete();
    srcPoints.delete();
    dstPoints.delete();
    transformMatrix.delete();
  }
};

/**
 * Applies a perspective transformation to an ImageData object, warping it
 * so the 4 given corner points form a flat rectangle.
 *
 * @param imageData The source image containing the document.
 * @param corners The 4 corners of the document (Top-Left, Top-Right, Bottom-Right, Bottom-Left).
 * @returns A Blob containing the transformed and cropped image in PNG format.
 */
export const applyPerspectiveTransform = async (
  imageData: ImageData,
  corners: Point[]
): Promise<Blob> => {
  return await imageDataToPngBlob(applyPerspectiveTransformToImageData(imageData, corners));
};
