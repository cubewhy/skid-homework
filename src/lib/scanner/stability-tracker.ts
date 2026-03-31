import type { Point } from "./document-detector";

/**
 * Tracks document corner points over multiple frames to determine stability.
 * Useful for triggering an auto-capture when the user is holding the camera still.
 */
export class StabilityTracker {
  private history: Point[][] = [];
  private readonly maxFrames: number;
  private readonly varianceThreshold: number;
  private readonly maxMissingFrames: number;
  private missingFrames = 0;

  /**
   * @param maxFrames Number of consecutive frames to track.
   * @param varianceThreshold Maximum allowed pixel variance across frames to be considered stable.
   */
  constructor(
    maxFrames: number = 5,
    varianceThreshold: number = 15,
    maxMissingFrames: number = 1,
  ) {
    this.maxFrames = maxFrames;
    this.varianceThreshold = varianceThreshold;
    this.maxMissingFrames = Math.max(0, Math.floor(maxMissingFrames));
  }

  /**
   * Adds new points to the tracker history.
   * @param points 4 corner points. Pass null to reset if detection failed.
   * @returns true if the document is stable across the tracked frames.
   */
  public push(points: Point[] | null): boolean {
    if (!points || points.length !== 4) {
      this.missingFrames += 1;
      if (this.missingFrames > this.maxMissingFrames) {
        this.history = [];
      }
      return false;
    }

    this.missingFrames = 0;
    this.history.push(points);
    if (this.history.length > this.maxFrames) {
      this.history.shift();
    }

    return this.isStable();
  }

  /**
   * Calculates variance of the corner points to determine stability.
   */
  public isStable(): boolean {
    if (this.history.length < this.maxFrames) {
      return false; // Not enough data yet
    }

    // Calculate variance for each of the 4 corners independently
    for (let pointIdx = 0; pointIdx < 4; pointIdx++) {
      let sumX = 0, sumY = 0;

      // Calculate mean
      for (let frameIdx = 0; frameIdx < this.maxFrames; frameIdx++) {
        sumX += this.history[frameIdx][pointIdx].x;
        sumY += this.history[frameIdx][pointIdx].y;
      }
      const meanX = sumX / this.maxFrames;
      const meanY = sumY / this.maxFrames;

      // Calculate variance
      let varX = 0, varY = 0;
      for (let frameIdx = 0; frameIdx < this.maxFrames; frameIdx++) {
        varX += Math.pow(this.history[frameIdx][pointIdx].x - meanX, 2);
        varY += Math.pow(this.history[frameIdx][pointIdx].y - meanY, 2);
      }
      varX /= this.maxFrames;
      varY /= this.maxFrames;

      // If any corner is moving too much, the document is not stable
      if (Math.sqrt(varX) > this.varianceThreshold || Math.sqrt(varY) > this.varianceThreshold) {
        return false;
      }
    }

    return true;
  }

  public reset(): void {
    this.history = [];
    this.missingFrames = 0;
  }
}
