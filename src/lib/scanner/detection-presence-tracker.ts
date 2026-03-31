import type { Point } from "./document-detector";

const clonePoints = (points: Point[] | null): Point[] | null => {
  return points?.map((point) => ({ ...point })) ?? null;
};

export interface DetectionPresenceState {
  rawDetected: boolean;
  effectiveDetected: boolean;
  effectivePoints: Point[] | null;
  retainedFromHistory: boolean;
  missingFrames: number;
}

/**
 * Applies short-lived hysteresis to document detection presence so the preview
 * overlay does not disappear immediately when one or two frames fail to return
 * a quadrilateral.
 */
export class DetectionPresenceTracker {
  private lastDetectedPoints: Point[] | null = null;
  private lastDetectedAt: number | null = null;
  private missingFrames = 0;

  constructor(
    private readonly maxMissingFrames: number = 3,
    private readonly retainMs: number = 240,
  ) {}

  public push(points: Point[] | null, now: number = Date.now()): DetectionPresenceState {
    if (points && points.length === 4) {
      const nextPoints = clonePoints(points);
      this.lastDetectedPoints = nextPoints;
      this.lastDetectedAt = now;
      this.missingFrames = 0;

      return {
        rawDetected: true,
        effectiveDetected: true,
        effectivePoints: nextPoints,
        retainedFromHistory: false,
        missingFrames: 0,
      };
    }

    this.missingFrames += 1;
    const withinFrameGrace = this.missingFrames <= this.maxMissingFrames;
    const withinTimeGrace = this.lastDetectedAt !== null
      && now - this.lastDetectedAt <= this.retainMs;

    if (this.lastDetectedPoints && withinFrameGrace && withinTimeGrace) {
      return {
        rawDetected: false,
        effectiveDetected: true,
        effectivePoints: clonePoints(this.lastDetectedPoints),
        retainedFromHistory: true,
        missingFrames: this.missingFrames,
      };
    }

    this.lastDetectedPoints = null;
    this.lastDetectedAt = null;

    return {
      rawDetected: false,
      effectiveDetected: false,
      effectivePoints: null,
      retainedFromHistory: false,
      missingFrames: this.missingFrames,
    };
  }

  public reset(): void {
    this.lastDetectedPoints = null;
    this.lastDetectedAt = null;
    this.missingFrames = 0;
  }
}
