"use client";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { Info, StarIcon } from "lucide-react";
import { useEffect, useMemo, useCallback, useState } from "react";
import { useAiStore } from "@/store/ai-store";
import ActionsCard from "../actions/ActionsCard";
import PreviewCard from "../preview/PreviewCard";

import solvePrompt from "@/ai/prompts/solve.prompt.md";

import { uint8ToBase64 } from "@/utils/encoding";
import { parseSolveResponse } from "@/ai/response";

import {
  useProblemsStore,
  type FileItem as FileItem,
  type ProblemSolution,
} from "@/store/problems-store";
import SolutionsArea from "../solutions/SolutionsArea";
import { useSettingsStore } from "@/store/settings-store";
import { processImage } from "@/utils/image-post-processing";
import { Button } from "../ui/button";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useShortcut } from "@/hooks/use-shortcut";
import OpenCVLoader from "../OpenCVLoader";
import { getEnabledToolCallingPrompts } from "@/ai/prompts/prompt-manager";
import { useStoreInitialization } from "@/hooks/use-store-initialization";
import { isTextMimeType } from "@/utils/file-utils";

export default function ScanPage() {
  const { t } = useTranslation("commons", { keyPrefix: "scan-page" });
  const router = useRouter();
  // Destructure all necessary state and new semantic actions from the store.
  const {
    imageItems: items,
    addFileItems,
    updateItemStatus,
    removeImageItem,
    updateFileItem,
    clearAllItems,
    setSelectedProblem,
    addSolution,
    updateSolution,
    removeSolutionsByIds,
    clearAllSolutions,
    appendStreamedOutput,
    clearStreamedOutput,
  } = useProblemsStore((s) => s);
  const isStoreReady = useStoreInitialization();

  const { imageEnhancement, traits } = useSettingsStore((s) => s);

  // Zustand store for AI provider configuration.
  const sources = useAiStore((state) => state.sources);
  const activeSourceId = useAiStore((state) => state.activeSourceId);
  const getClientForSource = useAiStore((state) => state.getClientForSource);
  const allowPdfUploads = useAiStore((state) => state.allowPdfUpload());

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

  // State to track if the AI is currently processing images.
  const setWorking = useProblemsStore((s) => s.setWorking);

  const isMobile = useMediaQuery("(max-width: 640px)");
  const [activeTab, setActiveTab] = useState<"capture" | "preview">(
    items.length ? "preview" : "capture",
  );
  useShortcut(
    "openChat",
    (event) => {
      event.preventDefault();
      router.push("/chat");
    },
    [router],
  );

  useEffect(() => {
    if (!items.length) {
      setActiveTab("capture");
    }
  }, [items.length]);

  // Memoized calculation of the total size of all uploaded files.
  const totalBytes = useMemo(
    () => items.reduce((sum, it) => sum + it.file.size, 0),
    [items],
  );

  useEffect(() => {
    window.addEventListener("beforeunload", (e) => {
      if (items.length > 0) {
        e.preventDefault();
      }
    });
  }, [items.length]);

  // Callback to add new files to the items list using the store action.
  const appendFiles = useCallback(
    (files: File[] | FileList, source: FileItem["source"]) => {
      let rejectedPdf = false;
      const arr = Array.from(files).filter((f) => {
        if (f.type.startsWith("image/")) {
          return true;
        }

        if (isTextMimeType(f.type, f.name)) {
          return true;
        }

        if (f.type === "application/pdf") {
          if (allowPdfUploads) {
            return true;
          }
          rejectedPdf = true;
          return false;
        }

        toast(t("toasts.unsupported-file.title"), {
          description: t("toasts.unsupported-file.description", {
            mimeType: f.type,
          }),
        });
        return false;
      });

      if (rejectedPdf) {
        toast(t("toasts.pdf-blocked.title"), {
          description: t("toasts.pdf-blocked.description"),
        });
      }

      if (arr.length === 0) return;

      const initialItems: FileItem[] = arr.map((file) => ({
        id: uuidv4(),
        file,
        displayName: file.name,
        mimeType: file.type,
        url: URL.createObjectURL(file),
        source,
        status:
          file.type.startsWith("image/") && imageEnhancement
            ? "processing"
            : "pending",
      }));

      addFileItems(initialItems);

      // Image post-processing
      if (imageEnhancement) {
        initialItems.forEach((item) => {
          if (item.status === "processing") {
            console.log(`Processing image ${item.displayName}`);
            processImage(item.file)
              .then((result) => {
                console.log(`Success processed image ${item.displayName}`);
                updateFileItem(item.id, {
                  status: "pending",
                  file: result.file,
                  url: result.url,
                });
              })
              .catch((error) => {
                console.error(`Failed to process ${item.displayName}:`, error);
                updateFileItem(item.id, {
                  status: "failed",
                });
              });
          }
        });
      }
    },
    [addFileItems, imageEnhancement, allowPdfUploads, t, updateFileItem],
  );

  // Function to remove a specific item from the list by its ID.
  const removeItem = (id: string) => {
    const target = items.find((i) => i.id === id);
    if (target) URL.revokeObjectURL(target.url); // Clean up the object URL.
    // Use the semantic action to remove the item.
    removeImageItem(id);
  };

  // Function to clear all uploaded items and solutions.
  const clearAll = () => {
    items.forEach((i) => URL.revokeObjectURL(i.url)); // Clean up all object URLs.
    clearAllItems();
    // reset index
    setSelectedProblem(0);
    clearAllSolutions(); // Use the semantic action to clear solutions.
  };

  // Utility function to retry an async operation with exponential backoff.
  const retryAsyncOperation = async (
    asyncFn: () => Promise<string>,
    maxRetries: number = 5,
    initialDelayMs: number = 5000,
  ): Promise<string> => {
    let lastError: Error | undefined;
    let delay = initialDelayMs;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await asyncFn(); // Attempt the operation.
      } catch (error) {
        lastError = error as Error;
        console.log(
          `Attempt ${attempt} failed. Retrying in ${delay / 1000}s...`,
        );

        if (attempt < maxRetries) {
          // Wait for the delay period before the next attempt.
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // Double the delay for the next retry (exponential backoff).
        }
      }
    }
    // If all retries fail, throw the last captured error.
    throw lastError ?? new Error("Unknown AI failure");
  };

  /**
   * Main function to start the scanning process.
   * It polls through the configured AI sources until one succeeds per item.
   */
  const startScan = async () => {
    const availableSources = enabledSources;

    if (!availableSources.length) {
      toast(t("toasts.no-source.title"), {
        description: t("toasts.no-source.description"),
      });
      return;
    }

    const invalidSource = availableSources.find(
      (source) => !source.model || source.model.length === 0,
    );
    if (invalidSource) {
      toast(t("toasts.no-model.title"), {
        description: t("toasts.no-model.description", {
          provider: invalidSource.name,
        }),
      });
      return;
    }

    if (items.filter((item) => item.status === "processing").length !== 0) {
      toast(t("toasts.post-processing.title"), {
        description: t("toasts.post-processing.description"),
      });
      return;
    }

    const itemsToProcess = items.filter(
      (item) => item.status === "pending" || item.status === "failed",
    );

    if (itemsToProcess.length === 0) {
      toast(t("toasts.all-processed.title"), {
        description: t("toasts.all-processed.description"),
      });
      return;
    }

    const hasPdfItems = itemsToProcess.some(
      (item) => item.mimeType === "application/pdf",
    );

    const hasGeminiSource = availableSources.some(
      (source) => source.provider === "gemini",
    );

    if (hasPdfItems && !hasGeminiSource) {
      toast(t("toasts.pdf-blocked.title"), {
        description: t("toasts.pdf-blocked.description"),
      });
      return;
    }

    toast(t("toasts.working.title"), {
      description: t("toasts.working.description", {
        count: itemsToProcess.length,
      }),
    });
    setWorking(true);

    try {
      const concurrency = 4;
      const n = itemsToProcess.length;

      const idsToProcess = new Set(itemsToProcess.map((item) => item.id));
      removeSolutionsByIds(idsToProcess);

      const processOne = async (item: FileItem) => {
        console.log(`Processing ${item.id}`);

        const buf = await item.file.arrayBuffer();
        const base64 = await uint8ToBase64(new Uint8Array(buf));

        let lastError: unknown = null;

        updateSolution(item.id, {
          status: "processing",
        });

        for (const source of availableSources) {
          try {
            const aiClient = getClientForSource(source.id);
            if (!aiClient) {
              throw new Error(
                t("errors.missing-key", { provider: source.name }),
              );
            }

            const promptPrompt = source.traits
              ? `\nUser defined prompts:
<prompt>
${source.traits}
</prompt>
`
              : "";

            const traitsPrompt = traits
              ? `\nUser defined traits:
<traits>
${traits}
</traits>
`
              : "";

            aiClient.addSystemPrompt(solvePrompt);
            aiClient.addSystemPrompt(promptPrompt + traitsPrompt);

            aiClient.setAvailableTools(getEnabledToolCallingPrompts());

            clearStreamedOutput(item.id);

            const resText = await retryAsyncOperation(() =>
              aiClient.sendMedia(
                base64,
                item.mimeType,
                undefined,
                source.model,
                (text) => appendStreamedOutput(item.id, text),
              ),
            );

            const res = parseSolveResponse(resText);
            if (!res) {
              throw new Error(t("errors.parsing-failed"));
            }

            updateSolution(item.id, {
              status: "success",
              problems: res.problems ?? [],
              aiSourceId: source.id,
            });

            updateItemStatus(item.id, "success");
            return;
          } catch (error) {
            lastError = error;
            console.error(`Source ${source.name} failed for ${item.id}`, error);
            clearStreamedOutput(item.id);
          }
        }

        throw lastError ?? new Error("All AI sources exhausted");
      };

      // add to orderedSolutions
      for (const item of itemsToProcess) {
        // Init solution object
        addSolution({
          fileId: item.id,
          status: "pending",
          problems: [],
        });
      }

      let nextIndex = 0;
      const worker = async () => {
        while (true) {
          const i = nextIndex++;
          if (i >= n) break;
          try {
            await processOne(itemsToProcess[i]);
          } catch (err) {
            const failureProblem: ProblemSolution = {
              problem: t("errors.processing-failed.problem"),
              answer: t("errors.processing-failed.answer"),
              explanation: t("errors.processing-failed.explanation", {
                error: String(err),
              }),
              steps: [],
            };

            updateSolution(itemsToProcess[i].url, {
              status: "failed",
              problems: [failureProblem],
              aiSourceId: undefined,
            });
            clearStreamedOutput(itemsToProcess[i].url);

            updateItemStatus(itemsToProcess[i].id, "failed");
          }
        }
      };

      const workers = Array(Math.min(concurrency, n))
        .fill(0)
        .map(() => worker());

      await Promise.all(workers);
    } catch (e) {
      console.error(e);
      toast(t("toasts.error.title"), {
        description: t("toasts.error.description"),
      });
    } finally {
      toast(t("toasts.done.title"), {
        description: t("toasts.done.description"),
      });
      setWorking(false);
    }
  };

  if (!isStoreReady) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <p className="text-muted-foreground animate-pulse">
          {/* Loading */}
          {t("loading")}
        </p>
      </div>
    );
  }

  return (
    <>
      {imageEnhancement && <OpenCVLoader />}

      <div className={cn("min-h-screen", isMobile && "pb-24")}>
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
          <header
            className={cn(
              "mb-6 flex items-center justify-between gap-4",
              isMobile && "flex-col items-start",
            )}
          >
            <div className="flex w-full flex-col gap-2">
              <h1
                className={cn(
                  "text-3xl font-semibold tracking-tight",
                  isMobile && "text-2xl leading-tight",
                )}
              >
                {t("title")}
              </h1>
              <div className="flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
                <Info className="h-4 w-4 shrink-0" />
                <span>{t("tip")}</span>
              </div>
            </div>

            <Button
              className={cn(
                "gap-2 whitespace-nowrap",
                isMobile ? "w-full justify-center rounded-full py-3" : "px-4",
              )}
              size={isMobile ? "lg" : "default"}
              variant="secondary"
              asChild
            >
              <a
                href="https://github.com/cubewhy/skid-homework/discussions"
                target="_blank"
                rel="noreferrer"
              >
                <StarIcon className="h-4 w-4" />
                {t("discussions-btn")}
              </a>
            </Button>
          </header>

          {isMobile && (
            <div className="mb-6 w-full rounded-2xl border border-white/15 bg-background/70 p-4 shadow-sm backdrop-blur">
              <p className="text-base font-medium">
                {items.length
                  ? t("mobile.status", { count: items.length })
                  : t("mobile.empty")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {allowPdfUploads
                  ? t("mobile.hint-ready")
                  : t("mobile.hint-pdf")}
              </p>
            </div>
          )}

          {isMobile ? (
            <Tabs
              value={activeTab}
              onValueChange={(value) =>
                setActiveTab(value as "capture" | "preview")
              }
              className="md:hidden"
            >
              <TabsList className="grid w-full grid-cols-2 bg-muted/40">
                <TabsTrigger
                  value="capture"
                  className="text-sm font-medium data-[state=active]:bg-background data-[state=active]:text-foreground"
                >
                  {t("mobile.tabs.capture")}
                </TabsTrigger>
                <TabsTrigger
                  value="preview"
                  className="text-sm font-medium data-[state=active]:bg-background data-[state=active]:text-foreground"
                >
                  {t("mobile.tabs.preview")}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="capture" className="mt-4">
                <ActionsCard
                  appendFiles={appendFiles}
                  clearAll={clearAll}
                  startScan={startScan}
                  totalBytes={totalBytes}
                  items={items}
                  allowPdfUploads={allowPdfUploads}
                  layout="mobile"
                />
              </TabsContent>
              <TabsContent value="preview" className="mt-4">
                <PreviewCard
                  appendFiles={appendFiles}
                  removeItem={removeItem}
                  items={items}
                  layout="mobile"
                />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3 lg:gap-8">
              <ActionsCard
                appendFiles={appendFiles}
                clearAll={clearAll}
                startScan={startScan}
                totalBytes={totalBytes}
                items={items}
                allowPdfUploads={allowPdfUploads}
              />

              <PreviewCard
                appendFiles={appendFiles}
                removeItem={removeItem}
                items={items}
              />
            </div>
          )}

          {/* Solutions Section */}
          <section className={cn("mt-8", !isMobile && "mt-10")}>
            <SolutionsArea />
          </section>

          <footer
            className={cn(
              "mt-10 flex items-center justify-between text-sm text-muted-foreground",
              isMobile && "mt-12 flex-col items-start gap-3 text-base",
            )}
          >
            <p>
              {t("footer.license")} {t("footer.slogan")}{" "}
              <a
                className="underline"
                href="https://github.com/cubewhy/skid-homework"
                target="_blank"
                rel="noreferrer"
              >
                {/* {t("footer.source")} */}
                https://github.com/cubewhy/skid-homework
              </a>
            </p>
          </footer>
        </div>
      </div>
    </>
  );
}
