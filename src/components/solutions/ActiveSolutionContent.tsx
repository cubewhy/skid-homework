import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { useCallback, useMemo, useState, useEffect, type KeyboardEvent } from "react";
import { useProblemsStore, type FileItem } from "@/store/problems-store";
import { useAiStore } from "@/store/ai-store";
import ProblemList from "./ProblemList";
import SolutionViewer from "./SolutionViewer";
import type { ImproveResponse } from "@/ai/response";
import { PhotoProvider, PhotoView } from "react-photo-view";
import StreamingOutputDisplay from "./StreamingOutputDisplay";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useDrag } from "@use-gesture/react";
import { animated, to, useSpring } from "@react-spring/web";
import { OrderedSolution } from "@/hooks/use-solution-export";
import { Maximize2 } from "lucide-react";
import { isTextMimeType, readTextFile } from "@/utils/file-utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";

export type ActiveSolutionContentProps = {
  ref?: React.Ref<HTMLDivElement>;
  entry: OrderedSolution;
  isActive: boolean;
  onNavigateImage: (direction: "next" | "prev") => void;
};

const TextSolutionPreview = ({
  item,
  t,
  tCommon,
}: {
  item: FileItem;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tCommon: any;
}) => {
  const [content, setContent] = useState<string>("");

  useEffect(() => {
    let ignore = false;
    readTextFile(item.url)
      .then((text) => {
        if (!ignore) {
          setContent(text);
        }
      })
      .catch((error) => {
        console.error("Failed to read text file for preview:", item.url, error);
        if (!ignore) {
          // Optionally clear content or keep previous content; here we clear.
          setContent("");
        }
        });
    return () => {
      ignore = true;
    };
  }, [item.url]);

  return (
    <Collapsible defaultOpen>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-slate-400">
          {t("file-label", {
            fileName: item.displayName,
            source: tCommon(`sources.${item.source}`),
          })}
        </div>
        <div className="flex gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <Maximize2 className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="flex h-[80vh] max-w-4xl flex-col">
              <DialogHeader>
                <DialogTitle>
                  {t("file-label", {
                    fileName: item.displayName,
                    source: tCommon(`sources.${item.source}`),
                  })}
                </DialogTitle>
              </DialogHeader>
              <div className="flex-1 overflow-auto rounded-md bg-slate-950 p-4 font-mono text-sm text-slate-300 whitespace-pre-wrap">
                {content}
              </div>
            </DialogContent>
          </Dialog>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 px-2">
              {t("toggle-preview")}
            </Button>
          </CollapsibleTrigger>
        </div>
      </div>
      <CollapsibleContent>
        <div className="max-h-96 overflow-hidden overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 p-4 text-xs font-mono text-slate-300 whitespace-pre-wrap break-all">
          {content}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default function ActiveSolutionContent({
  ref,
  entry,
  isActive,
  onNavigateImage,
}: ActiveSolutionContentProps) {
  const { t } = useTranslation("commons", { keyPrefix: "solutions" });
  const { t: tCommon } = useTranslation("commons");
  const prefersTouch = useMediaQuery("(pointer: coarse)");

  const { selectedProblem, setSelectedProblem, updateProblem } =
    useProblemsStore((s) => s);

  const aiSources = useAiStore((s) => s.sources);
  const aiSourceNames = useMemo(
    () => new Map(aiSources.map((s) => [s.id, s.name])),
    [aiSources],
  );

  const [{ x }, api] = useSpring(() => ({ x: 0 }));

  const problems = entry.solutions.problems ?? [];
  const hasProblems = problems.length > 0;

  // --- Navigation Helpers ---
  const goNextProblem = useCallback(() => {
    if (!hasProblems) return;
    setSelectedProblem(Math.min(selectedProblem + 1, problems.length - 1));
  }, [hasProblems, problems.length, selectedProblem, setSelectedProblem]);

  const goPrevProblem = useCallback(() => {
    if (!hasProblems) return;
    setSelectedProblem(Math.max(selectedProblem - 1, 0));
  }, [hasProblems, selectedProblem, setSelectedProblem]);

  // --- Keyboard Handling ---
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLInputElement
    )
      return;

    // Image Navigation
    if (e.key === "Tab" || (e.key === "ArrowLeft" && e.ctrlKey)) {
      // Logic for prev/next image handled via onNavigateImage prop usually,
      // but here we keep simple tab logic or use arrows
      return;
    }

    // Problem Navigation
    if (e.code === "Space") {
      e.preventDefault();
      if (e.shiftKey) goPrevProblem();
      else goNextProblem();
    }
  };

  // --- Gestures ---
  const bindDrag = useDrag(
    ({ down, movement: [mx], elapsedTime }) => {
      if (!prefersTouch || !isActive) return;

      api.start({ x: down ? mx : 0, immediate: down });
      if (down) return;

      const MIN_DISTANCE = 60;
      const MAX_DURATION = 450;

      if (
        elapsedTime > MAX_DURATION ||
        Math.abs(mx) < MIN_DISTANCE ||
        !hasProblems
      )
        return;

      if (mx < 0) goNextProblem();
      else goPrevProblem();
    },
    { enabled: prefersTouch && isActive, filterTaps: true, threshold: 25 },
  );

  const dragStyle = prefersTouch
    ? {
        touchAction: "pan-y",
        transform: to([x], (mx) => `translate3d(${mx}px, 0, 0)`),
      }
    : undefined;

  // --- Update Handler ---
  const handleUpdateSolution = (idx: number, res: ImproveResponse) => {
    updateProblem(
      entry.item.id,
      idx,
      res.improved_answer,
      res.improved_explanation,
      res.improved_steps,
    );
  };

  const renderStatusMessage = () => {
    if (entry.solutions.status === "success") {
      const providerName = entry.solutions.aiSourceId
        ? aiSourceNames.get(entry.solutions.aiSourceId)
        : null;
      return providerName
        ? t("status.success-with-provider", { provider: providerName })
        : t("status.success");
    } else if (entry.solutions.status === "pending") {
      return t("status.pending");
    }
    switch (entry.item.status) {
      case "success":
        return t("status.success");
      case "pending":
        return entry.solutions.streamedOutput
          ? t("status.stream")
          : t("status.pending");
      case "failed":
        return t("status.failed");
      default:
        return "";
    }
  };

  return (
    <animated.div
      ref={ref}
      tabIndex={0}
      className="outline-none"
      onKeyDown={handleKeyDown}
      {...(prefersTouch ? bindDrag() : {})}
      style={dragStyle}
    >
      {/* Image Preview */}
      {entry.item.mimeType.startsWith("image/") ? (
        <Collapsible defaultOpen>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-slate-400">
              {t("file-label", {
                fileName: entry.item.displayName,
                source: entry.item.source,
              })}
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 px-2">
                {t("toggle-preview")}
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <div className="overflow-hidden rounded-xl border border-slate-700 bg-black/20">
              <PhotoProvider>
                <PhotoView src={entry.item.url}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={entry.item.url}
                    alt={`Preview ${entry.item.displayName}`}
                    className="block max-h-96 w-full object-contain cursor-pointer"
                  />
                </PhotoView>
              </PhotoProvider>
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : isTextMimeType(entry.item.mimeType, entry.item.file.name) ? (
        <TextSolutionPreview item={entry.item} t={t} tCommon={tCommon} />
      ) : null}

      {/* Streaming Output */}
      {(entry.solutions.status !== "success" ||
        entry.solutions.streamedOutput) && (
        <div className="mt-4">
          <StreamingOutputDisplay
            title={t("streaming.title")}
            output={entry.solutions.streamedOutput ?? null}
            placeholder={t("streaming.placeholder")}
          />
        </div>
      )}

      <Separator className="my-4" />

      {/* Problem Content */}
      {!hasProblems ? (
        <div className="text-sm text-slate-400">{renderStatusMessage()}</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <ProblemList entry={entry} />

          <SolutionViewer
            entry={entry}
            // Pass navigation intended for the Viewer
            goNextImage={() => onNavigateImage("next")}
            goPrevImage={() => onNavigateImage("prev")}
            goNextProblem={goNextProblem}
            goPrevProblem={goPrevProblem}
            updateSolution={(res) => handleUpdateSolution(selectedProblem, res)}
          />
        </div>
      )}
    </animated.div>
  );
}
