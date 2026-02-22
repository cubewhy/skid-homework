import { Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { useProblemsStore, type ProblemSolution } from "@/store/problems-store";
import { parseImproveResponse, type ImproveResponse } from "@/ai/response";
import { useAiStore } from "@/store/ai-store";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { renderImproveXml } from "@/ai/request";
import { uint8ToBase64 } from "@/utils/encoding";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { TextInputDialog } from "../dialogs/TextInputDialog";

import improvePrompt from "../../ai/prompts/improve.prompt.md";
import { getEnabledToolCallingPrompts } from "@/ai/prompts/prompt-manager";
import { OrderedSolution } from "@/hooks/use-solution-export";

export type ImproveSolutionDialogProps = {
  entry: OrderedSolution;
  activeProblem: ProblemSolution | null;
  updateSolution: (solution: ImproveResponse) => void;
};

export type ImproveSolutionDialogHandle = {
  openDialog: () => void;
};

export const ImproveSolutionDialog = forwardRef<
  ImproveSolutionDialogHandle,
  ImproveSolutionDialogProps
>(({ entry, activeProblem, updateSolution }, ref) => {
  const sources = useAiStore((s) => s.sources);
  const activeSourceId = useAiStore((s) => s.activeSourceId);
  const getClientForSource = useAiStore((s) => s.getClientForSource);
  const { appendStreamedOutput, clearStreamedOutput } = useProblemsStore(
    (s) => s,
  );
  const { t } = useTranslation("commons", { keyPrefix: "improve-dialog" });

  const enabledSources = useMemo(() => {
    const available = sources.filter(
      (source) => source.enabled && Boolean(source.apiKey),
    );
    const active = available.find((source) => source.id === activeSourceId);
    if (!active) {
      return available;
    }
    return [active, ...available.filter((source) => source.id !== active.id)];
  }, [sources, activeSourceId]);

  useImperativeHandle(ref, () => ({
    openDialog: () => {
      setDialogOpen(true);
    },
  }));

  const [dialogOpen, setDialogOpen] = useState(false);
  const [isImproving, setImproving] = useState(false);

  const handleImproveSolution = async (improveSolutionPrompt: string) => {
    if (!activeProblem) return;
    if (!enabledSources.length) {
      toast(t("toasts.no-source.title"), {
        description: t("toasts.no-source.description"),
      });
      return;
    }

    const buf = await entry.item.file.arrayBuffer();
    const base64 = await uint8ToBase64(new Uint8Array(buf));

    const prompt = renderImproveXml({
      user_suggestion: improveSolutionPrompt,
      answer: activeProblem.answer,
      explanation: activeProblem.explanation,
      problem: activeProblem.problem,
    });

    try {
      toast(t("toasts.processing.title"), {
        description: t("toasts.processing.description"),
      });
      setImproving(true);

      let lastError: unknown = null;

      for (const source of enabledSources) {
        const aiClient = getClientForSource(source.id);
        if (!aiClient) {
          lastError = new Error(
            t("toasts.no-key.description", { provider: source.name }),
          );
          continue;
        }

        const traitsPrompt = source.traits
          ? `\nUser defined traits:
<traits>
${source.traits}
</traits>
`
          : "";

        aiClient.addSystemPrompt(improvePrompt);
        aiClient.addSystemPrompt(traitsPrompt);

        aiClient.setAvailableTools(getEnabledToolCallingPrompts());

        try {
          clearStreamedOutput(entry.item.id);

          const resText = await aiClient.sendMedia(
            base64,
            entry.item.mimeType,
            prompt,
            source.model,
            (text) => appendStreamedOutput(entry.item.id, text),
          );

          const res = parseImproveResponse(resText);
          if (!res) {
            throw new Error(t("toasts.failed.parse"));
          }

          updateSolution(res);
          clearStreamedOutput(entry.item.id);
          return;
        } catch (error) {
          lastError = error;
          clearStreamedOutput(entry.item.id);
        }
      }

      throw lastError ?? new Error(t("toasts.failed.parse"));
    } catch (e) {
      toast(t("toasts.failed.title"), {
        description: t("toasts.failed.description", { error: String(e) }),
      });
      return;
    } finally {
      setImproving(false);
    }
  };

  return (
    <TextInputDialog
      isOpen={dialogOpen}
      onOpenChange={setDialogOpen}
      trigger={
        <Button variant="outline" disabled={isImproving}>
          {isImproving && <Loader2 className="animate-spin mr-2" />}
          {t("trigger")} <Kbd>/</Kbd>
        </Button>
      }
      title={t("title")}
      description={t("description")}
      placeholder={t("placeholder")}
      submitText={t("submit")}
      isSubmitting={isImproving}
      onSubmit={handleImproveSolution}
    />
  );
});

ImproveSolutionDialog.displayName = "ImproveSolutionDialog";
