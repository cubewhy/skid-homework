export interface Point {
  x: number;
  y: number;
}

export interface DocumentContourOptions {
  maxWidth?: number;
  maxHeight?: number;
}

interface OpenCvGlobalScope {
  cv?: {
    Mat?: unknown;
  };
}

export const buildDocumentContourDetectionOptions = (
  width: number,
  height: number,
  options: DocumentContourOptions = {},
): DocumentContourOptions => {
  const hasExplicitWidth = typeof options.maxWidth === "number" && Number.isFinite(options.maxWidth);
  const hasExplicitHeight = typeof options.maxHeight === "number" && Number.isFinite(options.maxHeight);

  return {
    maxWidth: hasExplicitWidth ? Math.max(1, Math.floor(options.maxWidth as number)) : Math.max(1, Math.floor(width)),
    maxHeight: hasExplicitHeight ? Math.max(1, Math.floor(options.maxHeight as number)) : Math.max(1, Math.floor(height)),
  };
};

const CONTOUR_AREA_MIN_RATIO = 0.06;
const CONTOUR_AREA_MAX_RATIO = 0.98;
const APPROXIMATION_EPSILON_FACTORS = [0.01, 0.015, 0.02, 0.03, 0.04, 0.05] as const;
const MAX_SCORING_CONTOURS = 15;
const MIN_ACCEPTABLE_QUAD_SCORE = 2.05;
const BORDER_TOUCH_MARGIN_RATIO = 0.015;

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const distanceBetweenPoints = (first: Point, second: Point): number => {
  return Math.hypot(first.x - second.x, first.y - second.y);
};

const rotateLeft = <T>(values: T[], offset: number): T[] => {
  if (values.length === 0) {
    return values;
  }

  const normalizedOffset = ((offset % values.length) + values.length) % values.length;
  return values.slice(normalizedOffset).concat(values.slice(0, normalizedOffset));
};

const computePolygonArea = (points: Point[]): number => {
  if (points.length < 3) {
    return 0;
  }

  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += (current.x * next.y) - (next.x * current.y);
  }

  return Math.abs(area) / 2;
};

const computeBoundingBoxArea = (points: Point[]): number => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return Math.max(1, width * height);
};

const computeAngleCosine = (previous: Point, current: Point, next: Point): number => {
  const vectorA = {
    x: previous.x - current.x,
    y: previous.y - current.y,
  };
  const vectorB = {
    x: next.x - current.x,
    y: next.y - current.y,
  };

  const vectorAMagnitude = Math.hypot(vectorA.x, vectorA.y);
  const vectorBMagnitude = Math.hypot(vectorB.x, vectorB.y);
  if (vectorAMagnitude === 0 || vectorBMagnitude === 0) {
    return 1;
  }

  const cosine = ((vectorA.x * vectorB.x) + (vectorA.y * vectorB.y))
    / (vectorAMagnitude * vectorBMagnitude);
  return Math.abs(cosine);
};

const computeRightAngleScore = (points: Point[]): number => {
  if (points.length !== 4) {
    return 0;
  }

  let scoreSum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index + points.length - 1) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    scoreSum += 1 - clamp(computeAngleCosine(previous, current, next), 0, 1);
  }

  return scoreSum / points.length;
};

const computeSideBalanceScore = (points: Point[]): number => {
  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  const topWidth = distanceBetweenPoints(topLeft, topRight);
  const bottomWidth = distanceBetweenPoints(bottomLeft, bottomRight);
  const leftHeight = distanceBetweenPoints(topLeft, bottomLeft);
  const rightHeight = distanceBetweenPoints(topRight, bottomRight);

  const widthBalance = Math.min(topWidth, bottomWidth) / Math.max(topWidth, bottomWidth, 1);
  const heightBalance = Math.min(leftHeight, rightHeight) / Math.max(leftHeight, rightHeight, 1);
  return (widthBalance + heightBalance) / 2;
};

const computeAreaScore = (
  points: Point[],
  frameWidth: number,
  frameHeight: number,
): number => {
  const frameArea = Math.max(1, frameWidth * frameHeight);
  const areaRatio = computePolygonArea(points) / frameArea;
  if (areaRatio < CONTOUR_AREA_MIN_RATIO || areaRatio > CONTOUR_AREA_MAX_RATIO) {
    return 0;
  }

  const targetAreaRatio = 0.42;
  const normalizedDistance = Math.min(1, Math.abs(areaRatio - targetAreaRatio) / targetAreaRatio);
  return 1 - normalizedDistance;
};

const computeBorderTouchPenalty = (
  points: Point[],
  frameWidth: number,
  frameHeight: number,
): number => {
  const marginX = Math.max(4, frameWidth * BORDER_TOUCH_MARGIN_RATIO);
  const marginY = Math.max(4, frameHeight * BORDER_TOUCH_MARGIN_RATIO);

  let touchingPoints = 0;
  for (const point of points) {
    if (
      point.x <= marginX
      || point.x >= frameWidth - marginX
      || point.y <= marginY
      || point.y >= frameHeight - marginY
    ) {
      touchingPoints += 1;
    }
  }

  return Math.min(1, touchingPoints / points.length);
};

const computeQuadScore = (
  points: Point[],
  contourArea: number,
  frameWidth: number,
  frameHeight: number,
): number => {
  const polygonArea = computePolygonArea(points);
  if (polygonArea <= 0) {
    return 0;
  }

  const extentScore = clamp(polygonArea / computeBoundingBoxArea(points), 0, 1);
  const contourCoverageScore = clamp(contourArea / polygonArea, 0, 1);
  const rightAngleScore = computeRightAngleScore(points);
  const sideBalanceScore = computeSideBalanceScore(points);
  const areaScore = computeAreaScore(points, frameWidth, frameHeight);
  const borderTouchPenalty = computeBorderTouchPenalty(points, frameWidth, frameHeight);

  return (
    (rightAngleScore * 2.2)
    + (extentScore * 1.2)
    + (contourCoverageScore * 0.9)
    + (sideBalanceScore * 0.7)
    + (areaScore * 1.0)
    - (borderTouchPenalty * 0.8)
  );
};

/**
 * Detects the largest quadrilateral (document boundaries) in a given image.
 * Uses OpenCV.js for edge detection and contour approximation.
 *
 * @param imageData The source image data from the camera frame.
 * @returns An array of 4 Points representing the document corners, or null if none found.
 */
export const detectDocumentContour = (
  imageData: ImageData,
  options: DocumentContourOptions = {},
): Point[] | null => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cv = (globalThis as OpenCvGlobalScope).cv as any;
  if (!cv || !cv.Mat) {
    return null; // OpenCV not loaded yet
  }

  const src = new cv.Mat(imageData.height, imageData.width, cv.CV_8UC4);
  src.data.set(imageData.data);

  let working = src;
  let resized: InstanceType<typeof cv.Mat> | null = null;
  let scaleX = 1;
  let scaleY = 1;

  const hasMaxWidth = typeof options.maxWidth === "number" && Number.isFinite(options.maxWidth);
  const hasMaxHeight = typeof options.maxHeight === "number" && Number.isFinite(options.maxHeight);
  const maxWidth = hasMaxWidth ? Math.max(1, Math.floor(options.maxWidth as number)) : imageData.width;
  const maxHeight = hasMaxHeight ? Math.max(1, Math.floor(options.maxHeight as number)) : imageData.height;
  const resizeScale = Math.min(
    1,
    maxWidth / Math.max(1, imageData.width),
    maxHeight / Math.max(1, imageData.height),
  );

  if (resizeScale < 1) {
    const targetWidth = Math.max(1, Math.round(imageData.width * resizeScale));
    const targetHeight = Math.max(1, Math.round(imageData.height * resizeScale));
    resized = new cv.Mat();
    cv.resize(
      src,
      resized,
      new cv.Size(targetWidth, targetHeight),
      0,
      0,
      cv.INTER_AREA,
    );
    working = resized;
    scaleX = imageData.width / targetWidth;
    scaleY = imageData.height / targetHeight;
  }

  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const edges = new cv.Mat();
  const closedEdges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const closeKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  const dilateKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));

  let finalPoints: Point[] | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  try {
    // 1. Grayscale
    cv.cvtColor(working, gray, cv.COLOR_RGBA2GRAY);

    // 2. Gaussian Blur to reduce noise
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

    // 3. Detect edges directly from the blurred grayscale image.
    cv.Canny(blur, edges, 75, 200);

    // 4. Reconnect fragmented borders before contour extraction.
    cv.dilate(edges, edges, dilateKernel);
    cv.morphologyEx(edges, closedEdges, cv.MORPH_CLOSE, closeKernel);

    // 5. Find Contours
    cv.findContours(
      closedEdges,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE
    );

    const minArea = working.cols * working.rows * CONTOUR_AREA_MIN_RATIO;
    const maxArea = working.cols * working.rows * CONTOUR_AREA_MAX_RATIO;

    // 6. Find the largest contour that can be approximated to a 4-point polygon.
    const numContours = contours.size();
    const sortedContours: Array<{ index: number; area: number }> = [];
    for (let i = 0; i < numContours; i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      contour.delete();

      if (area < minArea || area > maxArea) {
        continue;
      }

      sortedContours.push({ index: i, area });
    }

    // Sort by area descending.
    sortedContours.sort((a, b) => b.area - a.area);

    // Check top contours.
    for (let i = 0; i < Math.min(MAX_SCORING_CONTOURS, sortedContours.length); i++) {
      const contour = contours.get(sortedContours[i].index);
      const perimeter = cv.arcLength(contour, true);
      const contourArea = sortedContours[i].area;

      for (const epsilonFactor of APPROXIMATION_EPSILON_FACTORS) {
        const approx = new cv.Mat();

        try {
          cv.approxPolyDP(contour, approx, epsilonFactor * perimeter, true);

          if (approx.rows === 4 && cv.isContourConvex(approx)) {
            const candidatePoints: Point[] = [];
            for (let j = 0; j < 4; j++) {
              candidatePoints.push({
                x: Math.round(approx.data32S[j * 2] * scaleX),
                y: Math.round(approx.data32S[j * 2 + 1] * scaleY),
              });
            }
            const orderedCandidatePoints = orderPoints(candidatePoints);
            const candidateScore = computeQuadScore(
              orderedCandidatePoints,
              contourArea * scaleX * scaleY,
              imageData.width,
              imageData.height,
            );

            if (candidateScore > bestScore) {
              bestScore = candidateScore;
              finalPoints = orderedCandidatePoints;
            }
          }
        } finally {
          approx.delete();
        }
      }

      contour.delete();
    }

  } catch (error) {
    console.error("[Scanner] Document detection error: ", error);
  } finally {
    // Cleanup memory
    src.delete();
    resized?.delete();
    gray.delete();
    blur.delete();
    edges.delete();
    closedEdges.delete();
    contours.delete();
    hierarchy.delete();
    closeKernel.delete();
    dilateKernel.delete();
  }

  if (!finalPoints || bestScore < MIN_ACCEPTABLE_QUAD_SCORE) {
    return null;
  }

  return finalPoints;
};

/**
 * Orders points consistently: Top-Left, Top-Right, Bottom-Right, Bottom-Left
 */
const orderPoints = (pts: Point[]): Point[] => {
  if (pts.length !== 4) {
    return pts;
  }

  const center = pts.reduce((accumulator, point) => {
    return {
      x: accumulator.x + point.x,
      y: accumulator.y + point.y,
    };
  }, { x: 0, y: 0 });

  center.x /= pts.length;
  center.y /= pts.length;

  const sortedByAngle = [...pts].sort((left, right) => {
    const leftAngle = Math.atan2(left.y - center.y, left.x - center.x);
    const rightAngle = Math.atan2(right.y - center.y, right.x - center.x);
    return leftAngle - rightAngle;
  });

  const topLeftIndex = sortedByAngle.reduce((bestIndex, point, index, values) => {
    const bestPoint = values[bestIndex];
    return (point.x + point.y) < (bestPoint.x + bestPoint.y) ? index : bestIndex;
  }, 0);

  let ordered = rotateLeft(sortedByAngle, topLeftIndex);

  // Ensure the second point is the top-right corner instead of the bottom-left corner.
  if (ordered[1].y > ordered[3].y) {
    ordered = [ordered[0], ordered[3], ordered[2], ordered[1]];
  }

  return ordered;
};
