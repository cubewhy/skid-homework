import type {Point} from "@/lib/scanner";

type PreviewOrientation = "landscape" | "portrait";

interface ScannerOverlayProps {
  /** The 4 document corner points detected in the frame. */
  points: Point[] | null;
  /** Whether the detected points are considered stable. */
  isStable: boolean;
  /** The natural width of the frame for coordinate scaling. */
  frameWidth: number;
  /** The natural height of the frame for coordinate scaling. */
  frameHeight: number;
  /** The display orientation currently used by the live preview. */
  orientation: PreviewOrientation;
}

const rotatePointForPortrait = (point: Point, frameHeight: number): Point => {
  return {
    x: frameHeight - point.y,
    y: point.x,
  };
};

/**
 * An SVG overlay that draws the detected document quadrilateral over the live preview.
 */
export function ScannerOverlay({
  points,
  isStable,
  frameWidth,
  frameHeight,
  orientation,
}: ScannerOverlayProps) {
  if (!points || points.length !== 4 || frameWidth === 0 || frameHeight === 0) {
    return null;
  }

  const overlayWidth = orientation === "portrait" ? frameHeight : frameWidth;
  const overlayHeight = orientation === "portrait" ? frameWidth : frameHeight;
  const overlayPoints = orientation === "portrait"
    ? points.map((point) => rotatePointForPortrait(point, frameHeight))
    : points;

  // Define SVG polygon points scaled to the rotated viewBox when needed.
  const polygonPoints = overlayPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const referenceSize = Math.max(overlayWidth, overlayHeight);

  // Green for stable, high confidence; Orange for detected but unstable.
  const strokeColor = isStable ? "rgba(34, 197, 94, 0.8)" : "rgba(249, 115, 22, 0.8)";
  const fillColor = isStable ? "rgba(34, 197, 94, 0.2)" : "rgba(249, 115, 22, 0.1)";

  return (
    <svg
      className="absolute inset-0 h-full w-full pointer-events-none"
      viewBox={`0 0 ${overlayWidth} ${overlayHeight}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Dim the background outside the document slightly */}
      <mask id="document-mask">
        <rect width="100%" height="100%" fill="white" />
        <polygon points={polygonPoints} fill="black" />
      </mask>
      <rect
        width="100%"
        height="100%"
        fill="rgba(0,0,0,0.4)"
        mask="url(#document-mask)"
      />

      {/* Draw the document boundary */}
      <polygon
        points={polygonPoints}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={Math.max(3, referenceSize * 0.005)}
        strokeLinejoin="round"
      />

      {/* Corner indicators */}
      {overlayPoints.map((point, index) => (
        <circle
          key={`corner-${index}`}
          cx={point.x}
          cy={point.y}
          r={Math.max(6, referenceSize * 0.01)}
          fill="white"
          stroke={strokeColor}
          strokeWidth={Math.max(2, referenceSize * 0.003)}
        />
      ))}
    </svg>
  );
}
