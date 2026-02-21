"use client";

import "katex/dist/katex.min.css";
import { useRef, useState, type ComponentProps } from "react";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";
import { useProblemsStore } from "@/store/problems-store";
import { toast } from "sonner";
import { type ImproveResponse } from "@/ai/response";
import { Kbd } from "../ui/kbd";
import { MemoizedMarkdown } from "../markdown/MarkdownRenderer";
import {
  ImproveSolutionDialog,
  type ImproveSolutionDialogHandle,
} from "./ImproveSolutionDialog";
import { useTranslation } from "react-i18next";
import { useAiStore } from "@/store/ai-store";
import { MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { encodeSeedChat } from "@/lib/chat-seed";
import { useSettingsStore } from "@/store/settings-store";
import InspectDialog from "../dialogs/InspectDialog";
import Explanation from "./Explanation";
import { OrderedSolution } from "@/hooks/use-solution-export";

export type SolutionViewerProps = {
  entry: OrderedSolution;
  goPrevImage: () => void;
  goNextImage: () => void;
  goNextProblem: () => void;
  goPrevProblem: () => void;

  updateSolution: (solution: ImproveResponse) => void;
} & ComponentProps<"section">;

export default function SolutionViewer({
  className,
  entry,
  goNextImage,
  goPrevImage,
  goNextProblem,
  goPrevProblem,
  updateSolution,
  ...props
}: SolutionViewerProps) {
  const { devtoolsEnabled, explanationMode } = useSettingsStore((s) => s);
  const [inspectDialogOpen, setInspectDialogOpen] = useState(false);

  const selectedProblem = useProblemsStore((s) => s.selectedProblem);
  const { t } = useTranslation("commons", { keyPrefix: "solution-viewer" });
  const sources = useAiStore((s) => s.sources);
  const activeSourceId = useAiStore((s) => s.activeSourceId);
  const router = useRouter();

  const viewerRef = useRef<HTMLElement | null>(null);

  const problemCount = entry.solutions.problems.length;
  const safeIndex = Math.min(
    Math.max(0, selectedProblem),
    Math.max(0, problemCount - 1),
  );

  const activeProblem =
    problemCount > 0 ? entry.solutions.problems[safeIndex] : null;

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t("copy.success.title"), {
        description: t("copy.success.description"),
      });
    } catch {
      toast(t("copy.failed.title"), {
        description: t("copy.failed.description"),
      });
    }
  };

  const dialogRef = useRef<ImproveSolutionDialogHandle>(null);

  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    const target = e.target as HTMLElement;
    if (
      target.tagName === "TEXTAREA" ||
      target.tagName === "INPUT" ||
      target.isContentEditable
    ) {
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      // open the dialog
      dialogRef.current?.openDialog();
    }
    if (e.ctrlKey && e.shiftKey && e.key === "C") {
      if (!activeProblem) return;
      e.preventDefault();
      copyToClipboard(activeProblem.answer);
    }
  };

  const problemText = activeProblem?.problem?.trim() ?? "";
  const answerText = activeProblem?.answer?.trim() ?? "";
  const explanationText = activeProblem?.explanation?.trim() ?? "";

  const handleStartChat = () => {
    if (!activeProblem) {
      toast.error(t("chat.no-problem.title"), {
        description: t("chat.no-problem.description"),
      });
      return;
    }

    const availableSources = sources.filter(
      (source) => source.enabled && source.apiKey,
    );
    if (availableSources.length === 0) {
      toast.error(t("chat.no-source.title"), {
        description: t("chat.no-source.description"),
      });
      return;
    }

    const preferredSourceId =
      entry.solutions.aiSourceId ?? activeSourceId ?? availableSources[0].id;
    const preferredSource =
      sources.find((source) => source.id === preferredSourceId) ??
      availableSources[0];

    const titleSource = problemText.replace(/\s+/g, " ").trim();
    const chatTitle =
      titleSource.length === 0
        ? t("chat.default-title")
        : titleSource.length > 60
          ? `${titleSource.slice(0, 60)}...`
          : titleSource;

    const contextSections: string[] = [
      t("chat.context.problem", {
        problem: problemText || t("chat.fallback.problem"),
      }),
    ];
    if (answerText) {
      contextSections.push(
        t("chat.context.answer", {
          answer: answerText,
        }),
      );
    }
    if (explanationText) {
      contextSections.push(
        t("chat.context.explanation", {
          explanation: explanationText,
        }),
      );
    }
    const contextMessage = [t("chat.context.intro"), ...contextSections].join(
      "\n\n",
    );

    const prefillLines: string[] = [
      t("chat.prefill.intro"),
      "",
      "**Problem**",
      problemText || t("chat.fallback.problem"),
    ];
    if (answerText) {
      prefillLines.push("", "**Answer**", answerText);
    }
    if (explanationText) {
      prefillLines.push("", "**Explanation**", explanationText);
    }
    prefillLines.push("", t("chat.prefill.outro"));
    const prefillMessage = prefillLines.join("\n");

    const payload = encodeSeedChat({
      title: chatTitle,
      prefillMessage,
      contextMessage,
      sourceId: preferredSource.id,
      model: preferredSource.model,
    });
    const target = payload ? `/chat?seed=${payload}` : "/chat";
    router.push(target);
  };

  return (
    <>
      <InspectDialog
        open={inspectDialogOpen}
        onChange={setInspectDialogOpen}
        answer={answerText}
        problem={problemText}
        explanation={explanationText}
      />
      <section
        ref={viewerRef}
        tabIndex={0}
        className={cn("md:col-span-2", className)}
        onKeyDown={onKeyDown}
        {...props}
      >
        <div className="rounded-xl border border-slate-700 p-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">
            {t("progress.prefix")}{" "}
            <label className="font-extrabold text-amber-500">
              {selectedProblem + 1}
            </label>{" "}
            {t("progress.suffix", {
              total: entry.solutions.problems.length,
            })}
          </div>

          {/* Markdown renderer for problem, answer, and explanation. */}
          <Markdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeKatex, { output: "html" }]]}
          >
            {activeProblem?.problem ?? ""}
          </Markdown>

          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-1 text-sm font-medium text-black dark:text-slate-300">
                {t("answer")}
              </div>
              <div className="rounded-lg bg-slate-300/60 dark:bg-slate-900/60 p-3">
                <MemoizedMarkdown source={activeProblem?.answer ?? ""} />
              </div>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(activeProblem?.answer ?? "")}
                >
                  {t("copy.button")} <Kbd>Ctrl+⇧+C</Kbd>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goPrevProblem}
                  disabled={selectedProblem === 0}
                >
                  {t("navigation.prev-problem")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goNextProblem}
                  disabled={
                    selectedProblem >= entry.solutions.problems.length - 1
                  }
                >
                  {t("navigation.next-problem")}
                </Button>
              </div>
            </div>

            <Explanation
              mode={explanationMode}
              content={activeProblem?.explanation ?? "<Empty Explanation>"}
              steps={activeProblem?.steps}
              key={entry.item.id}
            />

            <div className="flex flex-wrap gap-2">
              <ImproveSolutionDialog
                ref={dialogRef}
                entry={entry}
                activeProblem={activeProblem}
                updateSolution={updateSolution}
              />
              <Button
                type="button"
                onClick={handleStartChat}
                disabled={!activeProblem}
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                {t("chat.button")}
              </Button>
            </div>

            {/* Navigation controls for problems and images. */}
            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-slate-500">
                {t("source-image")}&nbsp;
                <a
                  href={entry.item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-dotted"
                >
                  {t("open-preview")}
                </a>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goPrevProblem}
                  disabled={selectedProblem === 0}
                >
                  {t("navigation.prev-problem")} <Kbd>⇧+␣</Kbd>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goNextProblem}
                  disabled={
                    selectedProblem >= entry.solutions.problems.length - 1
                  }
                >
                  {t("navigation.next-problem")} <Kbd>␣</Kbd>
                </Button>
                <Button variant="outline" size="sm" onClick={goPrevImage}>
                  {t("navigation.prev-image")} <Kbd>⇧+TAB</Kbd>
                </Button>
                <Button variant="outline" size="sm" onClick={goNextImage}>
                  {t("navigation.next-image")} <Kbd>TAB</Kbd>
                </Button>

                {devtoolsEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setInspectDialogOpen(true)}
                  >
                    Inspect
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
