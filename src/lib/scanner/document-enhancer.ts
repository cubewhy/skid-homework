const ENHANCER_BACKGROUND_KERNEL_RATIO = 0.08;
const ENHANCER_BACKGROUND_KERNEL_MIN = 9;
const ENHANCER_BACKGROUND_KERNEL_MAX = 41;
const ENHANCER_ADAPTIVE_BLOCK_SIZE = 25;
const ENHANCER_ADAPTIVE_THRESHOLD_C = 15;

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
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

/**
 * Enhances a generated document image using a more moderate OCR-friendly pipeline.
 *
 * @param documentBlob The document image blob produced from the same source image
 * that generated the contour, already rotated into the intended export orientation.
 * @returns A Blob containing the enhanced image
 */
export const enhanceDocumentImage = async (documentBlob: Blob): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cv = (window as any).cv;
    if (!cv || !cv.Mat) {
      reject(new Error("OpenCV.js is not loaded"));
      return;
    }

    const img = new Image();
    const blobUrl = URL.createObjectURL(documentBlob);

    img.onload = () => {
      let src = new cv.Mat();
      const gray = new cv.Mat();
      const background = new cv.Mat();
      const flattened = new cv.Mat();
      const denoised = new cv.Mat();
      const normalized = new cv.Mat();
      const otsuBinary = new cv.Mat();
      const adaptiveBinary = new cv.Mat();
      const display = new cv.Mat();
      let backgroundKernel = new cv.Mat();
      let cleanupKernel = new cv.Mat();
      let output = new cv.Mat();

      try {
        src = cv.imread(img);

        // 1. Convert to grayscale so downstream stages operate on a stable luminance signal.
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        // 2. Flatten uneven lighting before thresholding so bright corners and shadows are less harmful.
        const backgroundKernelSize = toOddKernelSize(
          Math.round(Math.min(gray.cols, gray.rows) * ENHANCER_BACKGROUND_KERNEL_RATIO),
          ENHANCER_BACKGROUND_KERNEL_MIN,
          ENHANCER_BACKGROUND_KERNEL_MAX,
        );
        backgroundKernel = cv.getStructuringElement(
          cv.MORPH_RECT,
          new cv.Size(backgroundKernelSize, backgroundKernelSize),
        );
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

        cleanupKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
        cv.morphologyEx(otsuBinary, otsuBinary, cv.MORPH_OPEN, cleanupKernel);
        cv.morphologyEx(adaptiveBinary, adaptiveBinary, cv.MORPH_CLOSE, cleanupKernel);

        const otsuScore = computeBinaryCandidateScore(cv, otsuBinary);
        const adaptiveScore = computeBinaryCandidateScore(cv, adaptiveBinary);
        const bestBinaryScore = Math.max(otsuScore, adaptiveScore);

        if (Number.isFinite(bestBinaryScore)) {
          output = adaptiveScore > otsuScore ? adaptiveBinary.clone() : otsuBinary.clone();
        } else {
          output = normalized.clone();
        }

        cv.cvtColor(output, display, cv.COLOR_GRAY2RGBA);

        // Render back to canvas
        const outputCanvas = document.createElement("canvas");
        cv.imshow(outputCanvas, display);

        outputCanvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Enhancement blob creation failed."));
            }
          },
          "image/png",
          1.0
        );

      } catch (error) {
        console.error("[Scanner] Document enhancement failed:", error);
        reject(error);
      } finally {
        src.delete();
        gray.delete();
        background.delete();
        flattened.delete();
        denoised.delete();
        normalized.delete();
        otsuBinary.delete();
        adaptiveBinary.delete();
        backgroundKernel.delete();
        cleanupKernel.delete();
        display.delete();
        output.delete();
        URL.revokeObjectURL(blobUrl);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error("Failed to load image for enhancement."));
    };

    img.src = blobUrl;
  });
};
