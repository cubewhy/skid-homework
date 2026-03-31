import type {Point} from "./document-detector";

const clonePoints = (points: Point[] | null): Point[] | null => {
  return points?.map((point) => ({ ...point })) ?? null;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const computeMaxCornerDelta = (left: Point[], right: Point[]): number => {
  let maxDelta = 0;

  for (let index = 0; index < 4; index += 1) {
    const deltaX = left[index].x - right[index].x;
    const deltaY = left[index].y - right[index].y;
    maxDelta = Math.max(maxDelta, Math.hypot(deltaX, deltaY));
  }

  return maxDelta;
};

const blendPoints = (previous: Point[], next: Point[], factor: number): Point[] => {
  const alpha = clamp(factor, 0, 1);

  return previous.map((point, index) => ({
    x: point.x + ((next[index].x - point.x) * alpha),
    y: point.y + ((next[index].y - point.y) * alpha),
  }));
};

export interface DetectionPresenceState {
  rawDetected: boolean;
  effectiveDetected: boolean;
  effectivePoints: Point[] | null;
  retainedFromHistory: boolean;
  smoothedFromDetection: boolean;
  missingFrames: number;
}

/**
 * Applies short-lived hysteresis to document detection presence so the preview
 * overlay does not disappear immediately when one or two frames fail to return
 * a quadrilateral.
 */
export class DetectionPresenceTracker {
  private lastEffectivePoints: Point[] | null = null;
  private lastDetectedAt: number | null = null;
  private missingFrames = 0;

  constructor(
    private readonly maxMissingFrames: number = 3,
    private readonly retainMs: number = 240,
    private readonly smoothingThresholdPx: number = 18,
    private readonly smoothingFactor: number = 0.35,
  ) {}

  public push(points: Point[] | null, now: number = Date.now()): DetectionPresenceState {
    if (points && points.length === 4) {
      const nextPoints = points.map((point) => ({ ...point }));
      const previousEffectivePoints = this.lastEffectivePoints;
      const shouldSmooth = Boolean(
        previousEffectivePoints
        && computeMaxCornerDelta(previousEffectivePoints, nextPoints) <= this.smoothingThresholdPx,
      );
      const effectivePoints = shouldSmooth && previousEffectivePoints
        ? blendPoints(previousEffectivePoints, nextPoints, this.smoothingFactor)
        : nextPoints;
      this.lastEffectivePoints = clonePoints(effectivePoints);
      this.lastDetectedAt = now;
      this.missingFrames = 0;

      return {
        rawDetected: true,
        effectiveDetected: true,
        effectivePoints,
        retainedFromHistory: false,
        smoothedFromDetection: shouldSmooth,
        missingFrames: 0,
      };
    }

    this.missingFrames += 1;
    const withinFrameGrace = this.missingFrames <= this.maxMissingFrames;
    const withinTimeGrace = this.lastDetectedAt !== null
      && now - this.lastDetectedAt <= this.retainMs;

    if (this.lastEffectivePoints && withinFrameGrace && withinTimeGrace) {
      return {
        rawDetected: false,
        effectiveDetected: true,
        effectivePoints: clonePoints(this.lastEffectivePoints),
        retainedFromHistory: true,
        smoothedFromDetection: false,
        missingFrames: this.missingFrames,
      };
    }

    this.lastEffectivePoints = null;
    this.lastDetectedAt = null;

    return {
      rawDetected: false,
      effectiveDetected: false,
      effectivePoints: null,
      retainedFromHistory: false,
      smoothedFromDetection: false,
      missingFrames: this.missingFrames,
    };
  }

  public reset(): void {
    this.lastEffectivePoints = null;
    this.lastDetectedAt = null;
    this.missingFrames = 0;
  }
}
