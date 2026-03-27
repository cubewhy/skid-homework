export interface Point {
  x: number;
  y: number;
}

export interface DocumentContourOptions {
  maxWidth?: number;
  maxHeight?: number;
}

export const buildDocumentContourDetectionOptions = (
  width: number,
  height: number,
  options: DocumentContourOptions = {},
): DocumentContourOptions => {
  const targetSize = buildReferenceProcessingSize(width, height, options);
  return {
    maxWidth: targetSize.width,
    maxHeight: targetSize.height,
  };
};

interface PolarLine {
  id: number;
  phi: number;
  rho: number;
  votes: number;
}

interface HoughSpace {
  accumulator: Uint32Array;
  rhoValues: number[];
  thetaValues: number[];
  rhoCount: number;
  thetaCount: number;
}

interface IntersectionCandidate {
  point: Point;
  lineV: PolarLine;
  lineH: PolarLine;
  corners: [Point, Point, Point, Point];
  connectivity: [number, number, number, number];
  orientation: [number, number, number, number];
}

interface FrameCandidate {
  points: [Point, Point, Point, Point];
  score: number;
}

interface ImageMaskMat {
  cols: number;
  rows: number;
  data: Uint8Array;
  ucharPtr: (row: number, col: number) => Uint8Array;
  delete: () => void;
}

const REFERENCE_TARGET_SHORT_SIDE = 500;
const PREPROCESS_MEDIAN_KERNEL_SIZE = 25;
const PREPROCESS_MORPH_KERNEL_SIZE = 15;
const CANNY_THRESHOLD_LOWER = 10;
const CANNY_THRESHOLD_UPPER = 70;
const CONTOUR_THICKNESS = 3;
const DILATE_KERNEL_SIZE = 15;
const ERODE_KERNEL_SIZE = 3;
const THETA_START = -Math.PI / 4;
const THETA_END = (3 * Math.PI) / 4;
const THETA_SAMPLE_COUNT = 180;
const HOUGH_MIN_DISTANCE = 10;
const HOUGH_MIN_ANGLE = 50;
const HOUGH_THRESHOLD_RATIO = 0.49;
const LINE_ANGLE_ERROR = Math.PI / 12;
const INTERSECTION_ALONG_LENGTH = 50;
const INTERSECTION_SAMPLE_WIDTH = 3;
const ORIENTATION_SCORE_THRESHOLD = 0.4;
const FRAME_AREA_THRESHOLD = 0.3;

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const linspace = (start: number, end: number, count: number): number[] => {
  if (count <= 1) {
    return [start];
  }

  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, index) => start + (index * step));
};

const buildReferenceProcessingSize = (
  width: number,
  height: number,
  options: DocumentContourOptions,
): { width: number; height: number } => {
  const hasExplicitWidth = typeof options.maxWidth === "number" && Number.isFinite(options.maxWidth);
  const hasExplicitHeight = typeof options.maxHeight === "number" && Number.isFinite(options.maxHeight);
  if (hasExplicitWidth && hasExplicitHeight) {
    return {
      width: Math.max(1, Math.round(options.maxWidth as number)),
      height: Math.max(1, Math.round(options.maxHeight as number)),
    };
  }

  const shortSide = Math.max(1, Math.min(width, height));
  const scale = REFERENCE_TARGET_SHORT_SIDE / shortSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const buildPreparedChannel = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cv: any,
  channel: ImageMaskMat,
): ImageMaskMat => {
  const blurred = new cv.Mat();
  const equalized = new cv.Mat();
  const opened = new cv.Mat();
  const closed = new cv.Mat();
  const morphKernel = cv.getStructuringElement(
    cv.MORPH_RECT,
    new cv.Size(PREPROCESS_MORPH_KERNEL_SIZE, PREPROCESS_MORPH_KERNEL_SIZE),
  );

  try {
    cv.medianBlur(channel, blurred, PREPROCESS_MEDIAN_KERNEL_SIZE);
    cv.equalizeHist(blurred, equalized);
    cv.morphologyEx(equalized, opened, cv.MORPH_OPEN, morphKernel);
    cv.morphologyEx(opened, closed, cv.MORPH_CLOSE, morphKernel);
    return closed.clone();
  } finally {
    blurred.delete();
    equalized.delete();
    opened.delete();
    closed.delete();
    morphKernel.delete();
  }
};

const buildContourMasks = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cv: any,
  prepared: ImageMaskMat,
): {
  houghMask: ImageMaskMat;
  connectivityMask: ImageMaskMat;
} => {
  const filtered = new cv.Mat();
  const cannyEdges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const contourMask = cv.Mat.zeros(prepared.rows, prepared.cols, cv.CV_8UC1);
  const houghMask = new cv.Mat();
  const connectivityMask = new cv.Mat();
  const dilateKernel = cv.getStructuringElement(
    cv.MORPH_RECT,
    new cv.Size(DILATE_KERNEL_SIZE, DILATE_KERNEL_SIZE),
  );
  const erodeKernel = cv.getStructuringElement(
    cv.MORPH_RECT,
    new cv.Size(ERODE_KERNEL_SIZE, ERODE_KERNEL_SIZE),
  );

  try {
    cv.bitwise_and(prepared, prepared, filtered);
    cv.Canny(
      filtered,
      cannyEdges,
      CANNY_THRESHOLD_LOWER,
      CANNY_THRESHOLD_UPPER,
      3,
      true,
    );
    cv.findContours(
      cannyEdges,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE,
    );
    cv.drawContours(contourMask, contours, -1, new cv.Scalar(255), CONTOUR_THICKNESS);
    cv.morphologyEx(contourMask, connectivityMask, cv.MORPH_DILATE, dilateKernel);
    cv.morphologyEx(contourMask, houghMask, cv.MORPH_ERODE, erodeKernel);

    return {
      houghMask: houghMask.clone(),
      connectivityMask: connectivityMask.clone(),
    };
  } finally {
    filtered.delete();
    cannyEdges.delete();
    contours.delete();
    hierarchy.delete();
    contourMask.delete();
    houghMask.delete();
    connectivityMask.delete();
    dilateKernel.delete();
    erodeKernel.delete();
  }
};

const buildHoughSpace = (
  mask: ImageMaskMat,
): HoughSpace => {
  const thetaValues = linspace(THETA_START, THETA_END, THETA_SAMPLE_COUNT);
  const rhoOffset = Math.ceil(Math.hypot(mask.rows, mask.cols));
  const rhoValues = Array.from(
    { length: (rhoOffset * 2) + 1 },
    (_, index) => index - rhoOffset,
  );
  const rhoCount = rhoValues.length;
  const thetaCount = thetaValues.length;
  const accumulator = new Uint32Array(rhoCount * thetaCount);
  const cosValues = thetaValues.map((theta) => Math.cos(theta));
  const sinValues = thetaValues.map((theta) => Math.sin(theta));
  const data = mask.data;

  for (let row = 0; row < mask.rows; row += 1) {
    const rowOffset = row * mask.cols;
    for (let col = 0; col < mask.cols; col += 1) {
      if (data[rowOffset + col] === 0) {
        continue;
      }

      for (let thetaIndex = 0; thetaIndex < thetaCount; thetaIndex += 1) {
        const rhoIndex = Math.round(
          (col * cosValues[thetaIndex]) + (row * sinValues[thetaIndex]),
        ) + rhoOffset;
        if (rhoIndex < 0 || rhoIndex >= rhoCount) {
          continue;
        }

        accumulator[(rhoIndex * thetaCount) + thetaIndex] += 1;
      }
    }
  }

  return {
    accumulator,
    rhoValues,
    thetaValues,
    rhoCount,
    thetaCount,
  };
};

const collectLinesFromHoughSpace = (
  mask: ImageMaskMat,
): { vertical: PolarLine[]; horizontal: PolarLine[] } => {
  const houghSpace = buildHoughSpace(mask);
  let maxVotes = 0;

  for (let index = 0; index < houghSpace.accumulator.length; index += 1) {
    if (houghSpace.accumulator[index] > maxVotes) {
      maxVotes = houghSpace.accumulator[index];
    }
  }

  if (maxVotes === 0) {
    return {
      vertical: [],
      horizontal: [],
    };
  }

  const threshold = maxVotes * HOUGH_THRESHOLD_RATIO;
  const candidates: Array<{ rhoIndex: number; thetaIndex: number; votes: number }> = [];

  for (let rhoIndex = 0; rhoIndex < houghSpace.rhoCount; rhoIndex += 1) {
    for (let thetaIndex = 0; thetaIndex < houghSpace.thetaCount; thetaIndex += 1) {
      const votes = houghSpace.accumulator[(rhoIndex * houghSpace.thetaCount) + thetaIndex];
      if (votes >= threshold) {
        candidates.push({ rhoIndex, thetaIndex, votes });
      }
    }
  }

  candidates.sort((left, right) => right.votes - left.votes);

  const vertical: PolarLine[] = [];
  const horizontal: PolarLine[] = [];
  const accepted: Array<{ rhoIndex: number; thetaIndex: number }> = [];
  let nextLineId = 0;

  for (const candidate of candidates) {
    const suppressed = accepted.some((peak) => {
      return (
        Math.abs(peak.rhoIndex - candidate.rhoIndex) <= HOUGH_MIN_DISTANCE
        && Math.abs(peak.thetaIndex - candidate.thetaIndex) <= HOUGH_MIN_ANGLE
      );
    });
    if (suppressed) {
      continue;
    }

    accepted.push({
      rhoIndex: candidate.rhoIndex,
      thetaIndex: candidate.thetaIndex,
    });

    const line: PolarLine = {
      id: nextLineId,
      phi: houghSpace.thetaValues[candidate.thetaIndex],
      rho: houghSpace.rhoValues[candidate.rhoIndex],
      votes: candidate.votes,
    };
    nextLineId += 1;

    if (Math.abs(line.phi) < LINE_ANGLE_ERROR || Math.abs(line.phi - Math.PI) < LINE_ANGLE_ERROR) {
      vertical.push(line);
    } else if (Math.abs(line.phi - (Math.PI / 2)) < LINE_ANGLE_ERROR) {
      horizontal.push(line);
    }
  }

  return {
    vertical,
    horizontal,
  };
};

const findPointsOnLine = (line: PolarLine, xValues: [number, number]): [Point, Point] => {
  const [leftX, rightX] = xValues;
  const denominator = Math.sin(line.phi);
  const safeDenominator = Math.abs(denominator) < 1e-6
    ? (denominator >= 0 ? 1e-6 : -1e-6)
    : denominator;

  return [
    {
      x: leftX,
      y: (line.rho - (leftX * Math.cos(line.phi))) / safeDenominator,
    },
    {
      x: rightX,
      y: (line.rho - (rightX * Math.cos(line.phi))) / safeDenominator,
    },
  ];
};

const pointsToGeneralLine = (
  firstPoint: Point,
  secondPoint: Point,
): { a: number; b: number; c: number } => {
  return {
    a: firstPoint.y - secondPoint.y,
    b: secondPoint.x - firstPoint.x,
    c: (firstPoint.x * secondPoint.y) - (secondPoint.x * firstPoint.y),
  };
};

const intersectCartesianLines = (
  firstLine: { a: number; b: number; c: number },
  secondLine: { a: number; b: number; c: number },
): Point | null => {
  const determinant = (firstLine.a * secondLine.b) - (firstLine.b * secondLine.a);
  if (Math.abs(determinant) < 1e-6) {
    return null;
  }

  const x = ((firstLine.b * secondLine.c) - (firstLine.c * secondLine.b)) / determinant;
  const y = ((firstLine.c * secondLine.a) - (firstLine.a * secondLine.c)) / determinant;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
};

const buildIntersectionCorners = (
  lineV: PolarLine,
  lineH: PolarLine,
  xValues: [number, number],
): [Point, Point, Point, Point] => {
  const horizontalPoints = findPointsOnLine(lineH, xValues);
  const left = horizontalPoints[0].x < horizontalPoints[1].x
    ? horizontalPoints[0]
    : horizontalPoints[1];
  const right = horizontalPoints[0].x < horizontalPoints[1].x
    ? horizontalPoints[1]
    : horizontalPoints[0];

  const verticalPoints = findPointsOnLine(lineV, xValues);
  const top = verticalPoints[0].y > verticalPoints[1].y
    ? verticalPoints[0]
    : verticalPoints[1];
  const bottom = verticalPoints[0].y > verticalPoints[1].y
    ? verticalPoints[1]
    : verticalPoints[0];

  return [top, right, bottom, left];
};

const interpolatePixelsAlongLine = (
  start: Point,
  end: Point,
  width: number,
): Array<[number, number]> => {
  let x1 = start.x;
  let y1 = start.y;
  let x2 = end.x;
  let y2 = end.y;

  const pixels: Array<[number, number]> = [];
  const steep = Math.abs(y2 - y1) > Math.abs(x2 - x1);

  if (steep) {
    [x1, y1] = [y1, x1];
    [x2, y2] = [y2, x2];
  }

  if (x1 > x2) {
    [x1, x2] = [x2, x1];
    [y1, y2] = [y2, y1];
  }

  const dx = x2 - x1;
  const dy = y2 - y1;
  const gradient = dx === 0 ? 0 : dy / dx;

  let xEnd = Math.round(x1);
  let yEnd = y1 + (gradient * (xEnd - x1));
  const xStartPixel = xEnd;
  const yStartPixel = Math.round(yEnd);

  if (steep) {
    pixels.push([yStartPixel, xStartPixel], [yStartPixel + 1, xStartPixel]);
  } else {
    pixels.push([xStartPixel, yStartPixel], [xStartPixel, yStartPixel + 1]);
  }

  let interpolatedY = yEnd + gradient;

  xEnd = Math.round(x2);
  yEnd = y2 + (gradient * (xEnd - x2));
  const xEndPixel = xEnd;
  const yEndPixel = Math.round(yEnd);

  for (let x = xStartPixel + 1; x < xEndPixel; x += 1) {
    if (steep) {
      for (let offset = 1 - width; offset <= width; offset += 1) {
        pixels.push([Math.floor(interpolatedY) + offset, x]);
      }
    } else {
      for (let offset = 1 - width; offset <= width; offset += 1) {
        pixels.push([x, Math.floor(interpolatedY) + offset]);
      }
    }

    interpolatedY += gradient;
  }

  if (steep) {
    pixels.push([yEndPixel, xEndPixel], [yEndPixel + 1, xEndPixel]);
  } else {
    pixels.push([xEndPixel, yEndPixel], [xEndPixel, yEndPixel + 1]);
  }

  return pixels.map(([x, y]) => [Math.trunc(x), Math.trunc(y)]);
};

const computeConnectivity = (
  point: Point,
  corners: [Point, Point, Point, Point],
  connectivityMask: ImageMaskMat,
): [number, number, number, number] => {
  const hits = [0, 0, 0, 0];
  const lengths = [0, 0, 0, 0];
  const data = connectivityMask.data;
  const rowStride = connectivityMask.cols;

  corners.forEach((corner, index) => {
    const distance = Math.hypot(corner.x - point.x, corner.y - point.y);
    if (distance === 0) {
      return;
    }

    const ratio = INTERSECTION_ALONG_LENGTH / distance;
    const endPoint: Point = {
      x: Math.round(((1 - ratio) * point.x) + (ratio * corner.x)),
      y: Math.round(((1 - ratio) * point.y) + (ratio * corner.y)),
    };
    const pixels = interpolatePixelsAlongLine(point, endPoint, INTERSECTION_SAMPLE_WIDTH);

    for (const [x, y] of pixels) {
      if (x < 0 || y < 0 || x >= connectivityMask.cols || y >= connectivityMask.rows) {
        continue;
      }

      if (data[(y * rowStride) + x] > 0) {
        hits[index] += 1;
      }
      lengths[index] += 1;
    }
  });

  return hits.map((hitCount, index) => {
    const length = lengths[index];
    return length === 0 ? Number.NaN : hitCount / length;
  }) as [number, number, number, number];
};

const computeOrientation = (
  connectivity: [number, number, number, number],
): [number, number, number, number] => {
  const pairs: Array<[number, number]> = [
    [0, 1],
    [0, 3],
    [2, 3],
    [2, 1],
  ];

  return pairs.map(([firstIndex, secondIndex]) => {
    const first = connectivity[firstIndex];
    const second = connectivity[secondIndex];
    const sum = first + second;
    return sum !== 0 ? (2 * (first * second)) / sum : 0;
  }) as [number, number, number, number];
};

const buildIntersections = (
  verticalLines: PolarLine[],
  horizontalLines: PolarLine[],
  connectivityMask: ImageMaskMat,
): IntersectionCandidate[] => {
  const xValues: [number, number] = [0, connectivityMask.cols];
  const intersections: IntersectionCandidate[] = [];

  for (const lineV of verticalLines) {
    for (const lineH of horizontalLines) {
      const horizontalPoints = findPointsOnLine(lineH, xValues);
      const verticalPoints = findPointsOnLine(lineV, xValues);
      const point = intersectCartesianLines(
        pointsToGeneralLine(horizontalPoints[0], horizontalPoints[1]),
        pointsToGeneralLine(verticalPoints[0], verticalPoints[1]),
      );

      if (!point) {
        continue;
      }

      const corners = buildIntersectionCorners(lineV, lineH, xValues);
      const connectivity = computeConnectivity(point, corners, connectivityMask);
      const orientation = computeOrientation(connectivity);

      intersections.push({
        point,
        lineV,
        lineH,
        corners,
        connectivity,
        orientation,
      });
    }
  }

  return intersections;
};

const computeFrameArea = (
  topLeft: IntersectionCandidate,
  topRight: IntersectionCandidate,
  bottomLeft: IntersectionCandidate,
): number => {
  const height = Math.abs(topLeft.point.y - bottomLeft.point.y);
  const width = Math.abs(topLeft.point.x - topRight.point.x);
  const angle = Math.abs(topLeft.lineH.phi - topLeft.lineV.phi);
  return height * width * Math.sin(angle);
};

const computeFrameScore = (
  topLeft: IntersectionCandidate,
  topRight: IntersectionCandidate,
  bottomRight: IntersectionCandidate,
  bottomLeft: IntersectionCandidate,
  imageShape: { width: number; height: number },
): number | null => {
  const area = computeFrameArea(topLeft, topRight, bottomLeft);
  const totalArea = imageShape.width * imageShape.height;
  const relativeArea = area / totalArea;
  if (!Number.isFinite(relativeArea) || relativeArea <= FRAME_AREA_THRESHOLD) {
    return null;
  }

  const score = (
    (topLeft.orientation[0] * relativeArea)
    + (topRight.orientation[1] * relativeArea)
    + (bottomRight.orientation[2] * relativeArea)
    + (bottomLeft.orientation[3] * relativeArea)
  );

  return Number.isFinite(score) ? score : null;
};

const buildBestFrameCandidate = (
  intersections: IntersectionCandidate[],
  imageShape: { width: number; height: number },
): FrameCandidate | null => {
  const corners = {
    topLeft: intersections.filter((intersection) => intersection.orientation[0] > ORIENTATION_SCORE_THRESHOLD),
    topRight: intersections.filter((intersection) => intersection.orientation[1] > ORIENTATION_SCORE_THRESHOLD),
    bottomRight: intersections.filter((intersection) => intersection.orientation[2] > ORIENTATION_SCORE_THRESHOLD),
    bottomLeft: intersections.filter((intersection) => intersection.orientation[3] > ORIENTATION_SCORE_THRESHOLD),
  };

  let bestFrame: FrameCandidate | null = null;

  for (const topLeft of corners.topLeft) {
    const bottomLeftCandidates = corners.bottomLeft.filter((candidate) => {
      return candidate !== topLeft && candidate.lineV.id === topLeft.lineV.id;
    });
    const topRightCandidates = corners.topRight.filter((candidate) => {
      return candidate !== topLeft && candidate.lineH.id === topLeft.lineH.id;
    });

    for (const bottomRight of corners.bottomRight) {
      if (bottomRight === topLeft) {
        continue;
      }

      for (const topRight of topRightCandidates) {
        for (const bottomLeft of bottomLeftCandidates) {
          if (
            bottomRight.lineV.id !== topRight.lineV.id
            || bottomRight.lineH.id !== bottomLeft.lineH.id
          ) {
            continue;
          }

          const score = computeFrameScore(
            topLeft,
            topRight,
            bottomRight,
            bottomLeft,
            imageShape,
          );
          if (score === null) {
            continue;
          }

          if (!bestFrame || score > bestFrame.score) {
            bestFrame = {
              points: [
                topLeft.point,
                topRight.point,
                bottomRight.point,
                bottomLeft.point,
              ],
              score,
            };
          }
        }
      }
    }
  }

  return bestFrame;
};

const scalePointsToSourceFrame = (
  points: [Point, Point, Point, Point],
  sourceWidth: number,
  sourceHeight: number,
  scaleX: number,
  scaleY: number,
): Point[] => {
  return points.map((point) => {
    return {
      x: clamp(point.x * scaleX, 0, sourceWidth - 1),
      y: clamp(point.y * scaleY, 0, sourceHeight - 1),
    };
  });
};

const detectOnChannel = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cv: any,
  channel: ImageMaskMat,
): [Point, Point, Point, Point] | null => {
  let prepared: ImageMaskMat | null = null;
  let masks: { houghMask: ImageMaskMat; connectivityMask: ImageMaskMat } | null = null;

  try {
    prepared = buildPreparedChannel(cv, channel);
    masks = buildContourMasks(cv, prepared);
    const lines = collectLinesFromHoughSpace(masks.houghMask);
    const intersections = buildIntersections(
      lines.vertical,
      lines.horizontal,
      masks.connectivityMask,
    );
    return buildBestFrameCandidate(intersections, {
      width: prepared.cols,
      height: prepared.rows,
    })?.points ?? null;
  } finally {
    prepared?.delete();
    masks?.houghMask.delete();
    masks?.connectivityMask.delete();
  }
};

/**
 * Detects document boundaries in a preview frame by mirroring the reference
 * scanner pipeline: HSV split -> value channel -> saturation channel ->
 * median blur -> equalize -> morphology -> contour mask -> custom Hough ->
 * intersection scoring -> frame selection.
 */
export const detectDocumentContour = (
  imageData: ImageData,
  options: DocumentContourOptions = {},
): Point[] | null => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cv = (window as any).cv;
  if (!cv || !cv.Mat) {
    return null;
  }

  const src = new cv.Mat(imageData.height, imageData.width, cv.CV_8UC4);
  src.data.set(imageData.data);

  const targetSize = buildReferenceProcessingSize(imageData.width, imageData.height, options);
  const needsResize = targetSize.width !== imageData.width || targetSize.height !== imageData.height;
  let working = src;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resized: any | null = null;
  const scaleX = imageData.width / targetSize.width;
  const scaleY = imageData.height / targetSize.height;

  if (needsResize) {
    resized = new cv.Mat();
    cv.resize(
      src,
      resized,
      new cv.Size(targetSize.width, targetSize.height),
      0,
      0,
      cv.INTER_AREA,
    );
    working = resized;
  }

  const rgb = new cv.Mat();
  const hsv = new cv.Mat();
  const hsvChannels = new cv.MatVector();
  let saturation: ImageMaskMat | null = null;
  let value: ImageMaskMat | null = null;

  try {
    cv.cvtColor(working, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    cv.split(hsv, hsvChannels);

    const saturationChannel = hsvChannels.get(1) as ImageMaskMat;
    const valueChannel = hsvChannels.get(2) as ImageMaskMat;
    saturation = saturationChannel;
    value = valueChannel;

    const valueFrame = detectOnChannel(cv, valueChannel);
    if (valueFrame) {
      return scalePointsToSourceFrame(
        valueFrame,
        imageData.width,
        imageData.height,
        scaleX,
        scaleY,
      );
    }

    const saturationFrame = detectOnChannel(cv, saturationChannel);
    if (saturationFrame) {
      return scalePointsToSourceFrame(
        saturationFrame,
        imageData.width,
        imageData.height,
        scaleX,
        scaleY,
      );
    }

    return null;
  } catch (error) {
    console.error("[Scanner] Document detection error:", error);
    return null;
  } finally {
    src.delete();
    resized?.delete();
    rgb.delete();
    hsv.delete();
    hsvChannels.delete();
    saturation?.delete();
    value?.delete();
  }
};
