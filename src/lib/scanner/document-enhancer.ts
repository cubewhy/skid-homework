import {decodeBlobToImageData, encodeImageDataToPngBlob} from "./image-data";

const ENHANCER_BACKGROUND_KERNEL_RATIO = 0.08;
const ENHANCER_BACKGROUND_KERNEL_MIN = 9;
const ENHANCER_BACKGROUND_KERNEL_MAX = 41;
const ENHANCER_ADAPTIVE_BLOCK_SIZE = 25;
const ENHANCER_ADAPTIVE_THRESHOLD_C = 15;

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

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

const toOddKernelSize = (
  value: number,
  min: number,
  max: number,
): number => {
  const clamped = Math.min(max, Math.max(min, value));
  return clamped % 2 === 0 ? clamped + 1 : clamped;
};

const estimateBinaryTransitionDensity = (
  data: Uint8Array,
  width: number,
  height: number,
): number => {
  if (width <= 1 || height === 0 || data.length === 0) {
    return 0;
  }

  const rowStep = Math.max(1, Math.floor(height / 48));
  const columnStep = Math.max(1, Math.floor(width / 64));
  let transitions = 0;
  let comparisons = 0;

  for (let y = 0; y < height; y += rowStep) {
    const rowOffset = y * width;
    let previous = data[rowOffset] > 127 ? 1 : 0;

    for (let x = columnStep; x < width; x += columnStep) {
      const current = data[rowOffset + x] > 127 ? 1 : 0;
      if (current !== previous) {
        transitions += 1;
      }
      previous = current;
      comparisons += 1;
    }
  }

  return comparisons === 0 ? 0 : transitions / comparisons;
};

const computeBinaryCandidateScore = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cv: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  binary: any,
): number => {
  const totalPixels = Math.max(1, binary.rows * binary.cols);
  const whitePixelRatio = cv.countNonZero(binary) / totalPixels;
  const blackPixelRatio = 1 - whitePixelRatio;
  const transitionDensity = estimateBinaryTransitionDensity(binary.data, binary.cols, binary.rows);

  if (whitePixelRatio < 0.45 || whitePixelRatio > 0.995 || blackPixelRatio < 0.005) {
    return Number.NEGATIVE_INFINITY;
  }

  const targetWhiteRatio = 0.82;
  const whiteRatioScore = 1 - clamp(
    Math.abs(whitePixelRatio - targetWhiteRatio) / 0.42,
    0,
    1,
  );
  const detailScore = clamp(transitionDensity / 0.12, 0, 1);
  const inkCoverageScore = clamp(blackPixelRatio / 0.18, 0, 1);

  return (whiteRatioScore * 1.4) + (detailScore * 0.9) + (inkCoverageScore * 0.4);
};

const imageDataToPngBlob = async (imageData: ImageData): Promise<Blob> => {
  return await encodeImageDataToPngBlob(imageData);
};

interface EnhancementWorkspace {
  width: number;
  height: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gray: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  background: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flattened: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  denoised: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  normalized: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  otsuBinary: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adaptiveBinary: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  display: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  backgroundKernel: any | null;
  backgroundKernelSize: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cleanupKernel: any | null;
}

let enhancementWorkspace: EnhancementWorkspace | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const deleteMat = (mat: any | null | undefined): void => {
  mat?.delete?.();
};

const destroyEnhancementWorkspace = (): void => {
  if (!enhancementWorkspace) {
    return;
  }

  deleteMat(enhancementWorkspace.gray);
  deleteMat(enhancementWorkspace.background);
  deleteMat(enhancementWorkspace.flattened);
  deleteMat(enhancementWorkspace.denoised);
  deleteMat(enhancementWorkspace.normalized);
  deleteMat(enhancementWorkspace.otsuBinary);
  deleteMat(enhancementWorkspace.adaptiveBinary);
  deleteMat(enhancementWorkspace.display);
  deleteMat(enhancementWorkspace.backgroundKernel);
  deleteMat(enhancementWorkspace.cleanupKernel);
  enhancementWorkspace = null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createWorkspaceGrayMat = (cv: any, width: number, height: number): any => {
  return new cv.Mat(height, width, cv.CV_8UC1);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createWorkspaceRgbaMat = (cv: any, width: number, height: number): any => {
  return new cv.Mat(height, width, cv.CV_8UC4);
};

const ensureEnhancementWorkspace = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cv: any,
  width: number,
  height: number,
  backgroundKernelSize: number,
): EnhancementWorkspace => {
  if (
    !enhancementWorkspace
    || enhancementWorkspace.width !== width
    || enhancementWorkspace.height !== height
  ) {
    destroyEnhancementWorkspace();
    enhancementWorkspace = {
      width,
      height,
      gray: createWorkspaceGrayMat(cv, width, height),
      background: createWorkspaceGrayMat(cv, width, height),
      flattened: createWorkspaceGrayMat(cv, width, height),
      denoised: createWorkspaceGrayMat(cv, width, height),
      normalized: createWorkspaceGrayMat(cv, width, height),
      otsuBinary: createWorkspaceGrayMat(cv, width, height),
      adaptiveBinary: createWorkspaceGrayMat(cv, width, height),
      display: createWorkspaceRgbaMat(cv, width, height),
      backgroundKernel: null,
      backgroundKernelSize: null,
      cleanupKernel: cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2)),
    };
  }

  if (enhancementWorkspace.backgroundKernelSize !== backgroundKernelSize) {
    deleteMat(enhancementWorkspace.backgroundKernel);
    enhancementWorkspace.backgroundKernel = cv.getStructuringElement(
      cv.MORPH_RECT,
      new cv.Size(backgroundKernelSize, backgroundKernelSize),
    );
    enhancementWorkspace.backgroundKernelSize = backgroundKernelSize;
  }

  return enhancementWorkspace;
};

const runEnhancementPipeline = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cv: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  src: any,
): ImageData => {
  const backgroundKernelSize = toOddKernelSize(
    Math.round(Math.min(src.cols, src.rows) * ENHANCER_BACKGROUND_KERNEL_RATIO),
    ENHANCER_BACKGROUND_KERNEL_MIN,
    ENHANCER_BACKGROUND_KERNEL_MAX,
  );
  const workspace = ensureEnhancementWorkspace(
    cv,
    src.cols,
    src.rows,
    backgroundKernelSize,
  );
  const {
    gray,
    background,
    flattened,
    denoised,
    normalized,
    otsuBinary,
    adaptiveBinary,
    display,
    backgroundKernel,
    cleanupKernel,
  } = workspace;

  try {
    // 1. Convert to grayscale so downstream stages operate on a stable luminance signal.
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // 2. Flatten uneven lighting before thresholding so bright corners and shadows are less harmful.
    cv.morphologyEx(gray, background, cv.MORPH_CLOSE, backgroundKernel);
    cv.divide(gray, background, flattened, 255, -1);

    // 3. Denoise and normalize contrast for OCR-friendly candidate generation.
    cv.GaussianBlur(flattened, denoised, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    cv.normalize(denoised, normalized, 0, 255, cv.NORM_MINMAX);

    // 4. Build complementary threshold candidates and keep the one that preserves text best.
    cv.threshold(normalized, otsuBinary, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    cv.adaptiveThreshold(
      normalized,
      adaptiveBinary,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      ENHANCER_ADAPTIVE_BLOCK_SIZE,
      ENHANCER_ADAPTIVE_THRESHOLD_C,
    );

    cv.morphologyEx(otsuBinary, otsuBinary, cv.MORPH_OPEN, cleanupKernel);
    cv.morphologyEx(adaptiveBinary, adaptiveBinary, cv.MORPH_CLOSE, cleanupKernel);

    const otsuScore = computeBinaryCandidateScore(cv, otsuBinary);
    const adaptiveScore = computeBinaryCandidateScore(cv, adaptiveBinary);
    const bestBinaryScore = Math.max(otsuScore, adaptiveScore);
    const finalGray = Number.isFinite(bestBinaryScore)
      ? (adaptiveScore > otsuScore ? adaptiveBinary : otsuBinary)
      : normalized;

    cv.cvtColor(finalGray, display, cv.COLOR_GRAY2RGBA);
    return new ImageData(new Uint8ClampedArray(display.data), display.cols, display.rows);
  } catch (error) {
    destroyEnhancementWorkspace();
    throw error;
  }
};

export const enhanceDocumentRgbaMatToImageData = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  documentMat: any,
): Promise<ImageData> => {
  const cv = getOpenCvRuntime();

  if (!documentMat || typeof documentMat.cols !== "number" || typeof documentMat.rows !== "number") {
    throw new Error("Invalid OpenCV mat supplied for document enhancement.");
  }

  return runEnhancementPipeline(cv, documentMat);
};

export const enhanceDocumentImageData = async (
  documentImage: ImageData,
): Promise<ImageData> => {
  const cv = getOpenCvRuntime();
  const src = new cv.Mat(documentImage.height, documentImage.width, cv.CV_8UC4);

  try {
    src.data.set(documentImage.data);
    return runEnhancementPipeline(cv, src);
  } catch (error) {
    console.error("[Scanner] Document enhancement failed:", error);
    throw error;
  } finally {
    src.delete();
  }
};

/**
 * Enhances a generated document image using a more moderate OCR-friendly pipeline.
 *
 * @param documentBlob The document image blob produced from the same source image
 * that generated the contour, already rotated into the intended export orientation.
 * @returns A Blob containing the enhanced image
 */
export const enhanceDocumentImage = async (documentBlob: Blob): Promise<Blob> => {
  const decodedImage = await decodeBlobToImageData(documentBlob);
  const enhancedImage = await enhanceDocumentImageData(decodedImage);
  return await imageDataToPngBlob(enhancedImage);
};
