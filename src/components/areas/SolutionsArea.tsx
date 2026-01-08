import { TabsTrigger } from "@radix-ui/react-tabs";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Tabs, TabsContent, TabsList } from "../ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  useProblemsStore,
  type FileItem,
  type Solution,
} from "@/store/problems-store";
import { useAiStore } from "@/store/ai-store";
import ProblemList from "../ProblemList";
import SolutionViewer from "../SolutionViewer";
import type { ImproveResponse } from "@/ai/response";
import { PhotoProvider, PhotoView } from "react-photo-view";
import StreamingOutputDisplay from "../StreamingOutputDisplay";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useDrag } from "@use-gesture/react";
import { animated, to, useSpring } from "@react-spring/web";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import { readTextFile } from "@/utils/file-utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";

export interface OrderedSolution {
  item: FileItem;
  solutions: Solution;
}

const TextSolutionPreview = ({
  item,
  t,
  tCommon,
  idx,
}: {
  item: FileItem;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tCommon: any;
  idx: number;
}) => {
  const [content, setContent] = useState<string>("");

  useEffect(() => {
    readTextFile(item.url).then(setContent);
  }, [item.url]);

  return (
    <Collapsible defaultOpen>
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-400">
          {t("photo-label", {
            index: idx + 1,
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
                  {t("photo-label", {
                    index: idx + 1,
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
      <CollapsibleContent className="mt-2">
        <div className="max-h-96 overflow-hidden overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 p-4 text-xs font-mono text-slate-300 whitespace-pre-wrap break-all">
          {content}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default function SolutionsArea() {
  const { t } = useTranslation("commons", { keyPrefix: "solutions" });
  const { t: tCommon } = useTranslation("commons");
  const translate = useCallback(
    (key: string, options?: Record<string, unknown>) =>
      t(key as never, options as never) as unknown as string,
    [t],
  );
  const {
    imageItems: items,
    imageSolutions,
    selectedImage,
    selectedProblem,
    setSelectedImage,
    setSelectedProblem,
    updateProblem,
    isWorking,
  } = useProblemsStore((s) => s);
  const aiSources = useAiStore((s) => s.sources);
  const aiSourceNames = useMemo(() => {
    return new Map(aiSources.map((source) => [source.id, source.name]));
  }, [aiSources]);
  const viewerRef = useRef<HTMLElement | null>(null);

  const prefersTouch = useMediaQuery("(pointer: coarse)");

  // Build a solutions list that matches the visual order of the uploaded items.
  const orderedSolutions: OrderedSolution[] = useMemo(() => {
    return items
      .filter((item) => imageSolutions.has(item.url)) // Use the map directly for an efficient O(1) check.
      .map((item) => ({
        item: item,
        // Retrieve the solution directly from the map. The `!` is safe
        // because the filter step guarantees the key exists.
        solutions: imageSolutions.get(item.url)!,
      }));
  }, [items, imageSolutions]);

  // Derive the index of the currently selected image.
  const currentImageIdx = useMemo(() => {
    if (!orderedSolutions.length) return -1;
    if (!selectedImage) return 0;
    const idx = orderedSolutions.findIndex((e) => e.item.url === selectedImage);
    return idx === -1 ? 0 : idx; // Default to the first image if not found.
  }, [orderedSolutions, selectedImage]);

  // Get the current solution bundle (image + its problems).
  const currentBundle =
    currentImageIdx >= 0 ? orderedSolutions[currentImageIdx] : null;
  const problems = currentBundle?.solutions.problems ?? [];

  const exportableSolutions = useMemo(
    () => orderedSolutions.filter((entry) => entry.solutions.problems.length),
    [orderedSolutions],
  );

  const buildMarkdownDocument = useCallback(() => {
    const lines: string[] = [];
    lines.push(`# ${translate("export.document-title")}`);
    lines.push("");

    exportableSolutions.forEach((entry, pageIndex) => {
      const displayName = entry.item.file.name
        ? entry.item.file.name
        : t("tabs.fallback", { index: pageIndex + 1 });

      lines.push(
        `## ${translate("export.page-heading", {
          index: pageIndex + 1,
          name: displayName,
        })}`,
      );
      lines.push("");

      entry.solutions.problems.forEach((problem, problemIdx) => {
        lines.push(
          `### ${translate("export.problem-heading", { index: problemIdx + 1 })}`,
        );
        lines.push("");

        const hasContent = (value: string | undefined | null) =>
          Boolean(value && value.replace(/\s+/g, "").length);

        const ensureContent = (
          value: string | undefined | null,
          fallback: string,
        ) => (hasContent(value) ? value! : fallback);

        lines.push(`**${translate("export.problem-label")}**`);
        lines.push("");
        lines.push(
          ensureContent(
            problem.problem,
            translate("export.placeholders.problem"),
          ),
        );
        lines.push("");

        lines.push(`**${translate("export.answer-label")}**`);
        lines.push("");
        lines.push(
          ensureContent(
            problem.answer,
            translate("export.placeholders.answer"),
          ),
        );
        lines.push("");

        lines.push(`**${translate("export.explanation-label")}**`);
        lines.push("");
        lines.push(
          ensureContent(
            problem.explanation,
            translate("export.placeholders.explanation"),
          ),
        );
        lines.push("");
      });
    });

    return lines.join("\n");
  }, [exportableSolutions, t, translate]);

  const handleExportMarkdown = useCallback(() => {
    if (!exportableSolutions.length) {
      toast.error(translate("export.empty.title"), {
        description: translate("export.empty.description"),
      });
      return;
    }

    try {
      const markdown = buildMarkdownDocument();
      const blob = new Blob([markdown], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.href = url;
      link.download = `${translate("export.filename-prefix")}-${timestamp}.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 0);

      toast.success(translate("export.success.title"), {
        description: translate("export.success.description"),
      });
    } catch (error) {
      console.error("Failed to export markdown", error);
      toast.error(translate("export.error.title"), {
        description: translate("export.error.description"),
      });
    }
  }, [buildMarkdownDocument, exportableSolutions.length, translate]);

  const [{ x }, api] = useSpring(() => ({ x: 0 }));

  // Effect to keep the selectedImage state consistent if the data changes.
  useEffect(() => {
    if (!orderedSolutions.length) {
      if (selectedImage !== null) setSelectedImage(undefined);
      return;
    }
    const safeIdx = currentImageIdx === -1 ? 0 : currentImageIdx;
    const url = orderedSolutions[safeIdx].item.url;
    if (selectedImage !== url) setSelectedImage(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedSolutions.length, currentImageIdx]); // Depend on length and index

  // Navigation helpers for problems and images.
  const goNextProblem = useCallback(() => {
    if (!problems.length) return;
    setSelectedProblem(
      Math.min(selectedProblem + 1, Math.max(0, problems.length - 1)),
    );
  }, [problems.length, selectedProblem, setSelectedProblem]);

  const goPrevProblem = useCallback(() => {
    if (!problems.length) return;
    setSelectedProblem(Math.max(selectedProblem - 1, 0));
  }, [problems.length, selectedProblem, setSelectedProblem]);

  const goNextImage = useCallback(() => {
    if (!orderedSolutions.length) return;
    const next = (currentImageIdx + 1) % orderedSolutions.length;
    setSelectedImage(orderedSolutions[next].item.url);
    setSelectedProblem(0); // Reset problem index when changing images.
  }, [currentImageIdx, orderedSolutions, setSelectedImage, setSelectedProblem]);

  const goPrevImage = useCallback(() => {
    if (!orderedSolutions.length) return;
    const prev =
      (currentImageIdx - 1 + orderedSolutions.length) % orderedSolutions.length;
    setSelectedImage(orderedSolutions[prev].item.url);
    setSelectedProblem(0); // Reset problem index.
  }, [currentImageIdx, orderedSolutions, setSelectedImage, setSelectedProblem]);

  // Effect to clamp the selectedProblem index to a valid range when data changes.
  useEffect(() => {
    if (!problems.length) {
      if (selectedProblem !== 0) setSelectedProblem(0);
      return;
    }
    const clamped = Math.min(selectedProblem, problems.length - 1);
    if (clamped !== selectedProblem) setSelectedProblem(clamped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentImageIdx, problems.length]); // Re-run when image or problems change.

  const updateSolution = (
    entry: OrderedSolution,
    solutionIdx: number,
    res: ImproveResponse,
  ) => {
    updateProblem(
      entry.item.url,
      solutionIdx,
      res.improved_answer,
      res.improved_explanation,
      res.improved_steps,
    );
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLTextAreaElement) return;
    // handle navigation
    // Tab/Shift+Tab for image navigation.

    // L-Arrow/R-Arrow for an ergonomics keybinding for Left-Handedness
    if (e.key === "Tab" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      if (e.shiftKey || e.key === "ArrowLeft") goPrevImage();
      else goNextImage();
      // focus the viewer
      setTimeout(() => viewerRef.current?.focus(), 0);
      return;
    }
    // Space/Shift+Space for problem navigation.
    if (e.code === "Space") {
      e.preventDefault();
      if (e.shiftKey) goPrevProblem();
      else goNextProblem();
      viewerRef.current?.focus();
    }
  };

  const renderStatusMessage = (entry: OrderedSolution) => {
    if (entry.solutions.status === "success") {
      const providerName = entry.solutions.aiSourceId
        ? aiSourceNames.get(entry.solutions.aiSourceId)
        : null;
      if (providerName) {
        return t("status.success-with-provider", { provider: providerName });
      }
      return t("status.success");
    }

    switch (entry.item.status) {
      case "success":
        return t("status.success");

      case "pending":
        if (entry.solutions.streamedOutput) {
          return t("status.stream");
        }
        return t("status.pending");

      case "failed":
        return t("status.failed");
    }
  };

  const bindDrag = useDrag(
    ({ down, movement: [mx], elapsedTime }) => {
      if (!prefersTouch) return;

      api.start({
        x: down ? mx : 0,
        immediate: down,
      });

      if (down) return;

      const MIN_DISTANCE = 60;
      const MAX_DURATION = 450;

      if (elapsedTime > MAX_DURATION) return;

      if (Math.abs(mx) < MIN_DISTANCE || problems.length === 0) return;

      if (mx < 0) {
        goNextProblem();
      } else {
        goPrevProblem();
      }
      setTimeout(() => viewerRef.current?.focus(), 0);
    },
    {
      enabled: prefersTouch,
      filterTaps: true,
      threshold: 25,
    },
  );

  const dragStyle = prefersTouch
    ? {
        touchAction: "pan-y",
        transform: to([x], (mx) => `translate3d(${mx}px, 0, 0)`),
      }
    : undefined;

  return (
    <>
      <Card className="rounded-2xl shadow">
        <CardHeader className="px-6 pb-0">
          <CardTitle className="text-lg font-semibold">{t("title")}</CardTitle>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportMarkdown}
              disabled={!exportableSolutions.length}
            >
              {translate("export.button")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="pt-2">
          {/* Focusable region to capture keyboard shortcuts for navigation. */}
          <animated.div
            tabIndex={0}
            className="outline-none"
            aria-label={t("focus-region-aria")}
            {...(prefersTouch ? bindDrag() : {})}
            style={dragStyle}
          >
            {/* Conditional rendering based on whether solutions are available. */}
            {!orderedSolutions.length ? (
              <div className="text-sm text-gray-400">
                {isWorking ? t("analyzing") : t("idle")}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Image Tabs for switching between different photos' solutions. */}
                <Tabs
                  value={selectedImage ?? undefined}
                  onValueChange={(v) => {
                    setSelectedImage(v);
                    setSelectedProblem(0); // Reset problem index on tab change.
                  }}
                  className="w-full"
                >
                  <TabsList className="flex flex-wrap gap-2">
                    {orderedSolutions.map((entry, idx) => (
                      <TabsTrigger key={entry.item.id} value={entry.item.url}>
                        {entry.item.file.name ||
                          t("tabs.fallback", { index: idx + 1 })}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {orderedSolutions.length > 1 && (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Button
                        size={prefersTouch ? "lg" : "default"}
                        className="flex-1 justify-center gap-2 py-4 text-base"
                        variant="outline"
                        onClick={goPrevImage}
                      >
                        <ChevronLeft className="h-5 w-5" />
                        {tCommon("solution-viewer.navigation.prev-image")}
                      </Button>
                      <Button
                        size={prefersTouch ? "lg" : "default"}
                        className="flex-1 justify-center gap-2 py-4 text-base"
                        onClick={goNextImage}
                      >
                        {tCommon("solution-viewer.navigation.next-image")}
                        <ChevronRight className="h-5 w-5" />
                      </Button>
                    </div>
                  )}
                  {prefersTouch && problems.length > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground sm:hidden">
                      {t("gesture-hint")}
                    </p>
                  )}

                  {/* Content for each image tab. */}
                  {orderedSolutions.map((entry, idx) => {
                    return (
                      <TabsContent
                        key={entry.item.id}
                        value={entry.item.url}
                        className="mt-4"
                        onKeyDown={handleKeyDown}
                      >
                        {/* Collapsible preview of the current photo. */}
                        {entry.item.mimeType.startsWith("image/") ? (
                          <Collapsible defaultOpen>
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-slate-400">
                                {t("photo-label", {
                                  index: idx + 1,
                                  source: tCommon(
                                    `sources.${entry.item.source}`,
                                  ),
                                })}
                              </div>
                              <CollapsibleTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2"
                                >
                                  {t("toggle-preview")}
                                </Button>
                              </CollapsibleTrigger>
                            </div>
                            <CollapsibleContent className="mt-2">
                              <div className="overflow-hidden rounded-xl border border-slate-700">
                                <PhotoProvider>
                                  <PhotoView src={entry.item.url}>
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={entry.item.url}
                                      alt={`Preview ${entry.item.file.name || idx + 1}`}
                                      className="block max-h-96 w-full object-contain bg-black/20 cursor-pointer"
                                    />
                                  </PhotoView>
                                </PhotoProvider>
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        ) : (
                          <TextSolutionPreview
                            item={entry.item}
                            t={t}
                            tCommon={tCommon}
                            idx={idx}
                          />
                        )}

                        {(entry.solutions.status !== "success" ||
                          entry.solutions.streamedOutput) && (
                          <StreamingOutputDisplay
                            title={t("streaming.title")}
                            output={entry.solutions.streamedOutput ?? null}
                            placeholder={t("streaming.placeholder")}
                          />
                        )}

                        <Separator className="my-4" />

                        {/* Display problems or a message if none were found. */}
                        {entry.solutions.problems.length === 0 ? (
                          <div className="text-sm text-slate-400">
                            {renderStatusMessage(entry)}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            {/* Left: List of problems for the current image. */}
                            <ProblemList entry={entry} />

                            {/* Right: Detailed view of the selected problem. */}
                            <SolutionViewer
                              ref={viewerRef}
                              entry={entry}
                              goNextImage={goNextImage}
                              goPrevImage={goPrevImage}
                              goNextProblem={goNextProblem}
                              goPrevProblem={goPrevProblem}
                              updateSolution={(res) =>
                                updateSolution(entry, selectedProblem, res)
                              }
                            />
                          </div>
                        )}
                      </TabsContent>
                    );
                  })}
                </Tabs>
              </div>
            )}
          </animated.div>
        </CardContent>
      </Card>
    </>
  );
}
