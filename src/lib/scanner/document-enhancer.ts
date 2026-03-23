/**
 * Enhances a generated document image using a more moderate OCR-friendly pipeline.
 *
 * @param documentBlob The original document image blob (typically from perspective transform)
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
      const denoised = new cv.Mat();
      const normalized = new cv.Mat();
      const thresholded = new cv.Mat();
      let morphKernel = new cv.Mat();
      const display = new cv.Mat();
      let output = new cv.Mat();

      try {
        src = cv.imread(img);

        // 1. Convert to grayscale and remove salt-and-pepper noise.
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.medianBlur(gray, denoised, 3);

        // 2. Normalize contrast without estimating a large synthetic background.
        cv.normalize(denoised, normalized, 0, 255, cv.NORM_MINMAX);

        // 3. Use a moderate thresholding path for text readability.
        cv.threshold(normalized, thresholded, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
        morphKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
        cv.morphologyEx(thresholded, thresholded, cv.MORPH_OPEN, morphKernel);

        const whitePixelRatio = cv.countNonZero(thresholded) / Math.max(1, thresholded.rows * thresholded.cols);
        const shouldUseBinaryOutput = whitePixelRatio >= 0.18 && whitePixelRatio <= 0.97;

        if (shouldUseBinaryOutput) {
          output = thresholded.clone();
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
        denoised.delete();
        normalized.delete();
        thresholded.delete();
        morphKernel.delete();
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
