"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useHotkeys } from "react-hotkeys-hook";

import { decodeSeedChat, type SeedChatState } from "@/lib/chat-seed";
import { useAiStore, type AiSource } from "@/store/ai-store";
import { useChatStore } from "@/store/chat-store";
import type { AiChatMessage } from "@/ai/chat-types";

import chatPrompt from "@/ai/prompts/chat.prompt.md";
import diagramToolPrompt from "@/ai/prompts/tools/diagram-tool.prompt.md";
import mermaidToolPrompt from "@/ai/prompts/tools/mermaid-tool.prompt.md";

function trimTitle(text: string, fallback: string) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return fallback;
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}

function mapMessagesToAi(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
): AiChatMessage[] {
  return messages
    .filter((msg) => msg.content && msg.content.trim().length > 0)
    .map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
}

export function useChatLogic() {
  const { t } = useTranslation("commons", { keyPrefix: "chat-page" });
  const router = useRouter();
  const searchParams = useSearchParams();

  const sources = useAiStore((state) => state.sources);
  const activeSourceId = useAiStore((state) => state.activeSourceId);
  const setActiveSource = useAiStore((state) => state.setActiveSource);
  const getClientForSource = useAiStore((state) => state.getClientForSource);

  const threads = useChatStore((state) => state.threads);
  const isHydrated = useChatStore((state) => state.isHydrated);
  const loadThreads = useChatStore((state) => state.loadThreads);
  const loadMessages = useChatStore((state) => state.loadMessages);
  const createChat = useChatStore((state) => state.createChat);
  const appendMessage = useChatStore((state) => state.appendMessage);
  const updateMessage = useChatStore((state) => state.updateMessage);
  const updateThread = useChatStore((state) => state.updateThread);
  const deleteChat = useChatStore((state) => state.deleteChat);
  const messagesMap = useChatStore((state) => state.messages);

  const [activeChatId, setActiveChatId] = useState<string | undefined>(
    undefined,
  );
  const [messageInput, setMessageInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [seedData, setSeedData] = useState<SeedChatState | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [currentSourceId, setCurrentSourceId] = useState<string | null>(null);

  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads;
    const lowerQuery = searchQuery.toLowerCase();
    return threads.filter((thread) =>
      // TODO: search for chat content
      thread.title.toLowerCase().includes(lowerQuery),
    );
  }, [threads, searchQuery]);

  const navigateToChat = useCallback(
    (chatId: string | undefined) => {
      setActiveChatId(chatId);
      if (chatId) {
        router.push(`#${chatId}`);
      } else {
        router.push("/chat");
      }
    },
    [router],
  );

  useEffect(() => {
    const syncFromUrl = () => {
      const hash = window.location.hash.replace(/^#/, "");
      setActiveChatId(hash || undefined);
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    window.addEventListener("hashchange", syncFromUrl);
    return () => {
      window.removeEventListener("popstate", syncFromUrl);
      window.removeEventListener("hashchange", syncFromUrl);
    };
  }, []);

  const chatMessages = useMemo(() => {
    if (!activeChatId) return [];
    return messagesMap[activeChatId] ?? [];
  }, [messagesMap, activeChatId]);

  const availableSources = useMemo(
    () => sources.filter((source) => source.enabled && Boolean(source.apiKey)),
    [sources],
  );

  const sourceMap = useMemo(
    () =>
      new Map<string, AiSource>(sources.map((source) => [source.id, source])),
    [sources],
  );

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeChatId),
    [threads, activeChatId],
  );

  useEffect(() => {
    if (!isHydrated) loadThreads().catch(console.error);
  }, [isHydrated, loadThreads]);

  useEffect(() => {
    if (!activeChatId) return;
    if (messagesMap[activeChatId]) return;
    loadMessages(activeChatId).catch(console.error);
  }, [activeChatId, loadMessages, messagesMap]);

  useEffect(() => {
    const seedParam = searchParams.get("seed");
    if (!seedParam) return;
    const seed = decodeSeedChat(seedParam);
    if (!seed) return;

    setSeedData(seed);
    if (seed.prefillMessage) setMessageInput(seed.prefillMessage);
    if (seed.sourceId) setCurrentSourceId(seed.sourceId);
    if (seed.model) setModelInput(seed.model);

    const params = new URLSearchParams(searchParams);
    params.delete("seed");
    const next = params.toString();
    router.replace(next ? `/chat?${next}` : "/chat");
  }, [router, searchParams]);

  useEffect(() => {
    if (activeThread) {
      setCurrentSourceId(activeThread.sourceId);
      return;
    }
    if (currentSourceId) return;
    const preferred =
      availableSources.find((src) => src.id === activeSourceId) ??
      availableSources[0] ??
      null;
    if (preferred) setCurrentSourceId(preferred.id);
  }, [activeThread, availableSources, activeSourceId, currentSourceId]);

  const resolvedSourceId = activeThread?.sourceId ?? currentSourceId ?? null;
  const resolvedSource = resolvedSourceId
    ? (sourceMap.get(resolvedSourceId) ?? null)
    : null;

  useEffect(() => {
    if (activeThread) {
      setModelInput(activeThread.model);
    } else if (seedData?.model) {
      setModelInput(seedData.model);
    } else if (resolvedSource) {
      setModelInput(resolvedSource.model);
    } else {
      setModelInput("");
    }
  }, [activeThread, resolvedSource, seedData]);

  const handleSelectSource = async (sourceId: string) => {
    setCurrentSourceId(sourceId);
    setActiveSource(sourceId);
    const source = sourceMap.get(sourceId);
    if (source && !activeThread) setModelInput(source.model);

    if (activeThread) {
      await updateThread(activeThread.id, {
        sourceId,
        updatedAt: Date.now(),
        model: source?.model,
      });
    }
  };

  const handleNewChat = useCallback(() => {
    navigateToChat(undefined);
    setModelInput(resolvedSource?.model || "");
    setMessageInput("");
    setSeedData(null);
    if (window.innerWidth < 1024) setSidebarOpen(false);
  }, [resolvedSource, navigateToChat]);

  const handleSend = async () => {
    const trimmed = messageInput.trim();
    if (!trimmed || isSending) return;

    if (!resolvedSource?.apiKey) {
      toast.error(
        t("errors.missing-key", {
          provider: resolvedSource?.name ?? "Unknown",
        }),
      );
      return;
    }

    const modelName = modelInput.trim() || resolvedSource.model;
    setIsSending(true);
    setMessageInput("");

    let chatId = activeChatId ?? null;
    let assistantMessageId: string | null = null;

    try {
      let newlyCreated = false;

      if (!chatId) {
        const title =
          seedData?.title ?? trimTitle(trimmed, t("history.untitled"));
        chatId = await createChat({
          title,
          sourceId: resolvedSource.id,
          model: modelName,
          metadata: seedData?.contextMessage
            ? { contextMessage: seedData.contextMessage }
            : undefined,
          initialMessages: [{ role: "user", content: trimmed }],
        });
        newlyCreated = true;
        navigateToChat(chatId);
        setSeedData(null);
      } else {
        await appendMessage(chatId, { role: "user", content: trimmed });
      }

      if (!newlyCreated && chatId) {
        await updateThread(chatId, { updatedAt: Date.now(), model: modelName });
      }

      const assistantMessage = await appendMessage(chatId!, {
        role: "assistant",
        content: "",
      });
      assistantMessageId = assistantMessage.id;

      const currentState = useChatStore.getState();
      const conversation = currentState.messages[chatId!] ?? [];
      const contextMessages: AiChatMessage[] = [];

      const threadMetadata = activeThread?.metadata as {
        contextMessage?: string;
      } | null;
      if (newlyCreated && seedData?.contextMessage) {
        contextMessages.push({
          role: "system",
          content: seedData.contextMessage,
        });
      } else if (threadMetadata?.contextMessage) {
        contextMessages.push({
          role: "system",
          content: threadMetadata.contextMessage,
        });
      }

      const history = mapMessagesToAi(
        conversation
          .filter((msg) => msg.id !== assistantMessageId)
          .map((msg) => ({ role: msg.role, content: msg.content })),
      );

      const client = getClientForSource(resolvedSource.id);
      if (!client?.sendChat) throw new Error(t("errors.unsupported"));

      const traitsPrompt = resolvedSource.traits
        ? `\nUser traits:\n${resolvedSource.traits}\n`
        : "";
      client.addSystemPrompt(chatPrompt);
      client.addSystemPrompt(traitsPrompt);

      client.setAvailableTools([diagramToolPrompt, mermaidToolPrompt]);

      let aggregated = "";
      await client.sendChat(
        [...contextMessages, ...history],
        modelName,
        (delta) => {
          aggregated += delta;
          if (assistantMessageId) {
            updateMessage(chatId!, assistantMessageId, { content: aggregated });
          }
        },
      );

      if (aggregated.trim()) {
        await updateMessage(chatId!, assistantMessageId, {
          content: aggregated.trim(),
        });
      }
    } catch (error) {
      console.error(error);
      toast.error(t("errors.send-failed"));
      if (chatId && assistantMessageId) {
        await updateMessage(chatId, assistantMessageId, {
          error: true,
          content: "Error generating response.",
        });
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleForkChat = async (chatId: string) => {
    const thread = threads.find((t) => t.id === chatId);
    if (!thread) return;
    try {
      const msgs = await useChatStore.getState().loadMessages(chatId);
      const newId = await createChat({
        title: `${thread.title} (Fork)`,
        sourceId: thread.sourceId,
        model: thread.model,
        initialMessages: msgs.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });
      navigateToChat(newId);
      toast.success(t("history.fork-success", { defaultValue: "Chat forked" }));
    } catch (e) {
      console.error(e);
      toast.error(t("history.fork-error", { defaultValue: "Failed to fork" }));
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    if (
      !window.confirm(
        t("history.delete-confirm", { defaultValue: "Delete chat?" }),
      )
    )
      return;
    try {
      await deleteChat(chatId);
      if (activeChatId === chatId) {
        navigateToChat(undefined);
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to delete");
    }
  };

  useHotkeys("esc", () => router.push("/"), { enableOnFormTags: true });
  useHotkeys("ctrl+k, cmd+k", handleNewChat, { enableOnFormTags: true });

  return {
    t,
    router,
    activeChatId,
    activeThread,
    threads,
    chatMessages,
    messageInput,
    setMessageInput,
    isSending,
    sidebarOpen,
    setSidebarOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
    availableSources,
    resolvedSource,
    resolvedSourceId,
    modelInput,
    setModelInput,
    sourceMap,
    handleNewChat,
    handleSend,
    handleForkChat,
    handleDeleteChat,
    handleSelectSource,
    navigateToChat,
    updateThread,
    filteredThreads,
    searchQuery,
    setSearchQuery,
  };
}
