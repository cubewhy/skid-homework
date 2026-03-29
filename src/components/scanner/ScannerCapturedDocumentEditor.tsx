import {type PointerEvent as ReactPointerEvent, useRef, useState,} from "react";
import {useTranslation} from "react-i18next";

import type {Point} from "@/lib/scanner";
import type {ScannerCapturedDocument} from "@/store/scanner-store";
import {Button} from "@/components/ui/button";
import {useBlobDataUrl} from "@/hooks/use-blob-data-url";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ScannerCapturedDocumentEditorProps {
  open: boolean;
  document: ScannerCapturedDocument | null;
  isApplying: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (documentId: string, points: Point[]) => void;
}

interface ScannerCapturedDocumentEditorBodyProps {
  document: ScannerCapturedDocument;
  isApplying: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (documentId: string, points: Point[]) => void;
}

const DEFAULT_INSET_RATIO = 0.08;
const CORNER_LABELS = ["TL", "TR", "BR", "BL"] as const;

const clonePoints = (points: Point[] | null): Point[] | null => {
  return points?.map((point) => ({...point})) ?? null;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const buildDefaultPoints = (width: number, height: number): Point[] => {
  const insetX = Math.max(12, width * DEFAULT_INSET_RATIO);
  const insetY = Math.max(12, height * DEFAULT_INSET_RATIO);

  return [
    {x: insetX, y: insetY},
    {x: width - insetX, y: insetY},
    {x: width - insetX, y: height - insetY},
    {x: insetX, y: height - insetY},
  ];
};

const getInitialPoints = (document: ScannerCapturedDocument): Point[] => {
  const existing = clonePoints(document.points);
  if (existing && existing.length === 4) {
    return existing;
  }

  return buildDefaultPoints(document.sourceWidth, document.sourceHeight);
};

export function ScannerCapturedDocumentEditor({
  open,
  document,
  isApplying,
  onOpenChange,
  onApply,
}: ScannerCapturedDocumentEditorProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[min(100vw-2rem,1040px)]">
        {open && document ? (
          <ScannerCapturedDocumentEditorBody
            key={document.id}
            document={document}
            isApplying={isApplying}
            onOpenChange={onOpenChange}
            onApply={onApply}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ScannerCapturedDocumentEditorBody({
  document,
  isApplying,
  onOpenChange,
  onApply,
}: ScannerCapturedDocumentEditorBodyProps) {
  const {t} = useTranslation("commons");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const activeCornerIndexRef = useRef<number | null>(null);
  const [draftPoints, setDraftPoints] = useState<Point[]>(() => getInitialPoints(document));
  const sourceUrl = useBlobDataUrl(document.sourceFile);

  const updatePointFromEvent = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const svg = svgRef.current;
    const activeCornerIndex = activeCornerIndexRef.current;
    if (!svg || activeCornerIndex === null) {
      return;
    }

    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    const x = clamp(
      ((event.clientX - rect.left) / rect.width) * document.sourceWidth,
      0,
      document.sourceWidth,
    );
    const y = clamp(
      ((event.clientY - rect.top) / rect.height) * document.sourceHeight,
      0,
      document.sourceHeight,
    );

    setDraftPoints((current) => current.map((point, index) => {
      if (index !== activeCornerIndex) {
        return point;
      }

      return {x, y};
    }));
  };

  const handlePointerDown = (
    index: number,
    event: ReactPointerEvent<SVGCircleElement>,
  ): void => {
    activeCornerIndexRef.current = index;
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (activeCornerIndexRef.current === null) {
      return;
    }

    updatePointFromEvent(event);
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId);
    }
    activeCornerIndexRef.current = null;
  };

  const handleReset = (): void => {
    setDraftPoints(getInitialPoints(document));
  };

  const handleApply = (): void => {
    if (draftPoints.length !== 4) {
      return;
    }

    onApply(document.id, draftPoints.map((point) => ({...point})));
  };

  const polygonPoints = draftPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const referenceSize = Math.max(document.sourceWidth, document.sourceHeight);
  const strokeWidth = Math.max(3, referenceSize * 0.005);
  const handleRadius = Math.max(9, referenceSize * 0.014);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("document-scanner.editor.title")}</DialogTitle>
        <DialogDescription>{t("document-scanner.editor.description")}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div
          className="relative mx-auto w-full overflow-hidden rounded-xl border bg-black"
          style={{aspectRatio: `${document.sourceWidth} / ${document.sourceHeight}`}}
        >
          {sourceUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sourceUrl}
                alt={t("document-scanner.editor.image-alt")}
                className="absolute inset-0 h-full w-full object-fill"
                draggable={false}
              />
            </>
          ) : (
            <div className="absolute inset-0 bg-muted/20" />
          )}
          <svg
            ref={svgRef}
            className="absolute inset-0 h-full w-full touch-none"
            viewBox={`0 0 ${document.sourceWidth} ${document.sourceHeight}`}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <polygon
              points={polygonPoints}
              fill="rgba(59, 130, 246, 0.18)"
              stroke="rgba(96, 165, 250, 0.92)"
              strokeWidth={strokeWidth}
              strokeLinejoin="round"
            />
            {draftPoints.map((point, index) => (
              <g key={`editor-corner-${index}`}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={handleRadius}
                  fill="white"
                  stroke="rgba(37, 99, 235, 0.95)"
                  strokeWidth={Math.max(2, referenceSize * 0.003)}
                  onPointerDown={(event) => handlePointerDown(index, event)}
                />
                <text
                  x={point.x}
                  y={point.y - handleRadius - Math.max(10, referenceSize * 0.01)}
                  textAnchor="middle"
                  fontSize={Math.max(14, referenceSize * 0.018)}
                  fontWeight="700"
                  fill="white"
                  stroke="rgba(0,0,0,0.45)"
                  strokeWidth={Math.max(1.5, referenceSize * 0.0015)}
                  paintOrder="stroke"
                >
                  {CORNER_LABELS[index]}
                </text>
              </g>
            ))}
          </svg>
        </div>

        <p className="text-xs text-muted-foreground">
          {t("document-scanner.editor.hint")}
        </p>
      </div>

      <DialogFooter className="gap-2 sm:justify-between">
        <Button variant="outline" onClick={handleReset} disabled={isApplying}>
          {t("document-scanner.editor.actions.reset")}
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isApplying}>
            {t("document-scanner.editor.actions.cancel")}
          </Button>
          <Button onClick={handleApply} disabled={draftPoints.length !== 4 || isApplying}>
            {isApplying
              ? t("document-scanner.editor.actions.applying")
              : t("document-scanner.editor.actions.apply")}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
