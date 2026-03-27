import type {Point} from "./document-detector";

/**
 * Calculates the Euclidean distance between two points.
 */
function distance(p1: Point, p2: Point): number {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}

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
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cv = (window as any).cv;
    if (!cv || !cv.Mat) {
      reject(new Error("OpenCV.js is not loaded"));
      return;
    }

    if (corners.length !== 4) {
      reject(new Error("Perspective transform requires exactly 4 corner points."));
      return;
    }

    const [tl, tr, br, bl] = orderPoints(corners);

    // Calculate the output width from the detected quadrilateral.
    const widthTop = distance(tl, tr);
    const widthBottom = distance(bl, br);
    const maxWidth = Math.max(1, Math.round(Math.max(widthTop, widthBottom)));

    // Calculate the output height from the detected quadrilateral.
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

      // Perform the perspective warp
      cv.warpPerspective(
        srcMat,
        dstMat,
        transformMatrix,
        new cv.Size(maxWidth, maxHeight),
        cv.INTER_CUBIC,
        cv.BORDER_REPLICATE,
        new cv.Scalar()
      );

      // Render the warped result directly to a Canvas to extract a Blob
      const outputCanvas = document.createElement("canvas");
      cv.imshow(outputCanvas, dstMat);

      outputCanvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to encode warped image to blob."));
          }
        },
        "image/png",
        1.0
      );

    } catch (error) {
      console.error("[Scanner] Perspective transform failed: ", error);
      reject(error);
    } finally {
      // Cleanup
      srcMat.delete();
      dstMat.delete();
      srcPoints.delete();
      dstPoints.delete();
      transformMatrix.delete();
    }
  });
};
