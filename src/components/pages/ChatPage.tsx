"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTranslation } from "react-i18next";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus,
  Trash2,
  ChevronsUpDown,
  Check,
  Menu,
  GitFork,
  PanelLeftClose,
  PanelLeftOpen,
  SendHorizontal,
  Bot,
  User,
  MoreHorizontal,
  Settings2,
  MessageSquare,
  Search,
} from "lucide-react";

import { decodeSeedChat, type SeedChatState } from "@/lib/chat-seed";
import { cn } from "@/lib/utils";
import { useAiStore, type AiSource } from "@/store/ai-store";
import { useChatStore } from "@/store/chat-store";
import type { AiChatMessage } from "@/ai/chat-types";
import { BASE_CHAT_SYSTEM_PROMPT } from "@/ai/prompts";

// UI Components
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { Badge } from "../ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { MemoizedMarkdown } from "../MarkdownRenderer";

// --- Utilities ---
function trimTitle(text: string, fallback: string) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return fallback;
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}

function mapMessagesToAi(
  messages: {
    role: "user" | "assistant" | "system";
    content: string;
  }[],
): AiChatMessage[] {
  return messages
    .filter((msg) => msg.content && msg.content.trim().length > 0)
    .map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
}

export default function ChatPage() {
  const { t } = useTranslation("commons", { keyPrefix: "chat-page" });
  const router = useRouter();
  const searchParams = useSearchParams();

  // --- Store Hooks ---
  const sources = useAiStore((state) => state.sources);
  const activeSourceId = useAiStore((state) => state.activeSourceId);
  const setActiveSource = useAiStore((state) => state.setActiveSource);
  const getClientForSource = useAiStore((state) => state.getClientForSource);

  const threads = useChatStore((state) => state.threads);
  const activeChatId = useChatStore((state) => state.activeChatId);
  const setActiveChat = useChatStore((state) => state.setActiveChat);
  const isHydrated = useChatStore((state) => state.isHydrated);
  const loadThreads = useChatStore((state) => state.loadThreads);
  const loadMessages = useChatStore((state) => state.loadMessages);
  const createChat = useChatStore((state) => state.createChat);
  const appendMessage = useChatStore((state) => state.appendMessage);
  const updateMessage = useChatStore((state) => state.updateMessage);
  const updateThread = useChatStore((state) => state.updateThread);
  const deleteChat = useChatStore((state) => state.deleteChat);

  // --- Local State ---
  const [messageInput, setMessageInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [seedData, setSeedData] = useState<SeedChatState | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // UI State
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sourcePopoverOpen, setSourcePopoverOpen] = useState(false);
  const [modelInput, setModelInput] = useState("");

  // Derived Data
  const storeChatMessages = useChatStore((state) => {
    const id = state.activeChatId;
    return id ? state.messages[id] : undefined;
  });

  const chatMessages = useMemo(
    () => storeChatMessages ?? [],
    [storeChatMessages],
  );

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

  // --- Initialization ---
  useEffect(() => {
    if (!isHydrated) loadThreads().catch(console.error);
  }, [isHydrated, loadThreads]);

  useEffect(() => {
    if (!activeChatId) return;
    const state = useChatStore.getState();
    if (state.messages[activeChatId]) return;
    loadMessages(activeChatId).catch(console.error);
  }, [activeChatId, loadMessages]);

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

  // --- Source Logic ---
  const [currentSourceId, setCurrentSourceId] = useState<string | null>(null);

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

  // --- Textarea Autosize Logic ---
  useEffect(() => {
    if (textareaRef.current) {
      // Reset height to auto to correctly calculate new scrollHeight
      textareaRef.current.style.height = "auto";
      const scrollHeight = textareaRef.current.scrollHeight;
      // Clamp between 24px and 200px
      textareaRef.current.style.height = `${Math.min(Math.max(scrollHeight, 24), 200)}px`;
    }
  }, [messageInput]);

  // --- Scroll Logic ---
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    // Shadcn ScrollArea renders a viewport with this data attribute
    const viewport = scrollAreaRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLElement;
    if (viewport) {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: smooth ? "smooth" : "instant",
      });
    }
  }, []);

  useEffect(() => {
    // Delay slightly to allow DOM to update
    const timeout = setTimeout(() => scrollToBottom(true), 100);
    return () => clearTimeout(timeout);
  }, [chatMessages, scrollToBottom]);

  // --- Actions ---
  const handleSelectSource = async (sourceId: string) => {
    setSourcePopoverOpen(false);
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
    setActiveChat(undefined);
    setModelInput(resolvedSource?.model || "");
    setMessageInput("");
    setSeedData(null);
    if (window.innerWidth < 1024) setSidebarOpen(false);
  }, [resolvedSource, setActiveChat]);

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
    setMessageInput(""); // Clear input immediately

    // Manual reset of height in case useEffect hasn't fired yet
    if (textareaRef.current) textareaRef.current.style.height = "auto";

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
        setActiveChat(chatId);
        setSeedData(null);
      } else {
        await appendMessage(chatId, { role: "user", content: trimmed });
      }

      // Scroll immediately after user message
      setTimeout(() => scrollToBottom(), 50);

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
      client.setSystemPrompt(BASE_CHAT_SYSTEM_PROMPT + traitsPrompt);

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
          content: "Error generating response.",
        });
      }
    } finally {
      setIsSending(false);
      scrollToBottom();
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
      setActiveChat(newId);
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
      if (activeChatId === chatId) handleNewChat();
    } catch (e) {
      console.error(e);
      toast.error("Failed to delete");
    }
  };

  // --- Hotkeys ---
  useHotkeys("esc", () => router.push("/"), { enableOnFormTags: true });
  useHotkeys("ctrl+k, cmd+k", handleNewChat, { enableOnFormTags: true });

  // --- Render Components ---
  const renderSidebarContent = (mobile = false) => (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between px-4 py-2">
        <Button
          onClick={handleNewChat}
          className="w-full justify-start gap-2 shadow-sm"
          variant="default"
        >
          <Plus className="h-4 w-4" />
          {t("actions.new-chat")}
        </Button>
      </div>

      <div className="px-4 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search chats..." className="pl-8 h-9" disabled />
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {/* Native scroll for sidebar list usually behaves better than nested custom ScrollAreas */}
        <div className="h-full overflow-y-auto px-3">
          {threads.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center text-sm text-muted-foreground opacity-60">
              <MessageSquare className="mb-2 h-8 w-8" />
              <p>{t("history.empty")}</p>
            </div>
          ) : (
            <div className="space-y-1 pb-4">
              {threads.map((thread) => {
                const isActive = thread.id === activeChatId;
                return (
                  <div
                    key={thread.id}
                    className="group relative flex items-center"
                  >
                    <button
                      onClick={() => {
                        setActiveChat(thread.id);
                        if (mobile) setSidebarOpen(false);
                      }}
                      className={cn(
                        "flex w-full flex-col items-start gap-1 rounded-md px-3 py-2 text-sm transition-all hover:bg-muted/50",
                        isActive
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <span className="truncate w-[180px] text-left">
                        {thread.title}
                      </span>
                      <span className="text-[10px] opacity-70 truncate max-w-full">
                        {sourceMap.get(thread.sourceId)?.name}
                      </span>
                    </button>
                    {isActive && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center opacity-100 transition-opacity">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                            >
                              <MoreHorizontal className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleForkChat(thread.id)}
                            >
                              <GitFork className="mr-2 h-4 w-4" /> Fork
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDeleteChat(thread.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="border-t p-3">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          size="sm"
          onClick={() => router.push("/")}
        >
          <PanelLeftClose className="h-4 w-4 rotate-180" />
          {t("actions.back")}
        </Button>
      </div>
    </div>
  );

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        {/* --- DESKTOP SIDEBAR --- */}
        <AnimatePresence initial={false}>
          {!sidebarCollapsed && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="hidden border-r bg-muted/10 md:flex md:flex-col h-full"
            >
              <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
                <span className="font-semibold tracking-tight">
                  {t("title")}
                </span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setSidebarCollapsed(true)}
                    >
                      <PanelLeftClose className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Close Sidebar</TooltipContent>
                </Tooltip>
              </div>
              <div className="flex-1 overflow-hidden">
                {renderSidebarContent()}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* --- MAIN CHAT AREA --- */}
        <div className="flex flex-1 flex-col h-full min-w-0 bg-background">
          {/* HEADER */}
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 bg-background/80 backdrop-blur-sm z-10">
            <div className="flex items-center gap-2">
              {/* Mobile Trigger */}
              <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="md:hidden">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[300px] p-0">
                  <SheetHeader className="px-4 py-3 border-b text-left">
                    <SheetTitle>Chat Menu</SheetTitle>
                  </SheetHeader>
                  {renderSidebarContent(true)}
                </SheetContent>
              </Sheet>

              {/* Desktop Expand */}
              {sidebarCollapsed && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hidden md:flex"
                      onClick={() => setSidebarCollapsed(false)}
                    >
                      <PanelLeftOpen className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open Sidebar</TooltipContent>
                </Tooltip>
              )}
            </div>

            <Separator orientation="vertical" className="h-6" />

            <Popover
              open={sourcePopoverOpen}
              onOpenChange={setSourcePopoverOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-2 font-normal text-muted-foreground hover:text-foreground"
                >
                  <span className="font-medium text-foreground">
                    {resolvedSource?.name || "Select Model"}
                  </span>
                  {activeThread?.model && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] font-normal h-5 px-1.5"
                    >
                      {activeThread.model}
                    </Badge>
                  )}
                  <ChevronsUpDown className="h-3 w-3 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-0" align="start">
                <Command>
                  <CommandInput placeholder={t("source.search")} />
                  <CommandList>
                    <CommandEmpty>{t("source.empty")}</CommandEmpty>
                    <CommandGroup heading="Providers">
                      {availableSources.map((source) => (
                        <CommandItem
                          key={source.id}
                          onSelect={() => handleSelectSource(source.id)}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <span>{source.name}</span>
                            <span className="text-xs text-muted-foreground ml-2">
                              {source.model}
                            </span>
                          </div>
                          {source.id === resolvedSourceId && (
                            <Check className="h-4 w-4" />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                  <div className="p-2 border-t bg-muted/30">
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">
                      Override Model Name
                    </label>
                    <Input
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                      className="h-8 text-xs"
                      placeholder="e.g. gpt-4-turbo"
                      onBlur={async () => {
                        if (activeThread && modelInput !== activeThread.model) {
                          await updateThread(activeThread.id, {
                            model: modelInput,
                          });
                        }
                      }}
                    />
                  </div>
                </Command>
              </PopoverContent>
            </Popover>

            <div className="ml-auto flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                  >
                    <Settings2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("settings.title", { defaultValue: "Settings" })}
                </TooltipContent>
              </Tooltip>
            </div>
          </header>

          {/* CHAT AREA (Flex Column Container) */}
          <div className="flex-1 min-h-0 overflow-hidden relative">
            {/* ScrollArea set to h-full to take up the flex-1 space */}
            <ScrollArea ref={scrollAreaRef} className="h-full">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-6 lg:px-8">
                {chatMessages.length === 0 ? (
                  <div className="mt-20 flex flex-col items-center justify-center gap-4 text-center">
                    <div className="rounded-full bg-muted p-4">
                      <Bot className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div className="max-w-md space-y-2">
                      <h2 className="text-lg font-semibold">
                        {t("conversation.empty-title")}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Start a new conversation with{" "}
                        <span className="font-medium text-foreground">
                          {resolvedSource?.name}
                        </span>
                        .
                      </p>
                    </div>
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: 0.05 }}
                      key={msg.id}
                      className={cn(
                        "group flex gap-4 text-sm md:text-base",
                        msg.role === "user" ? "flex-row-reverse" : "flex-row",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border shadow-sm",
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-background",
                        )}
                      >
                        {msg.role === "user" ? (
                          <User className="h-5 w-5" />
                        ) : (
                          <Bot className="h-5 w-5 text-primary" />
                        )}
                      </div>

                      <div
                        className={cn(
                          "flex min-w-0 max-w-[85%] flex-col gap-1 rounded-2xl px-4 py-3 shadow-sm md:max-w-[75%]",
                          msg.role === "user"
                            ? "bg-primary/5 text-foreground rounded-tr-sm"
                            : "bg-muted/30 border border-border/50 rounded-tl-sm",
                        )}
                      >
                        <div className="prose prose-sm dark:prose-invert max-w-none wrap-break-word leading-normal">
                          <MemoizedMarkdown
                            source={msg.content || "..."}
                            wrapText
                          />
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* INPUT AREA (Fixed Footer) */}
          <div className="shrink-0 bg-background px-4 pb-6 pt-2">
            <div className="mx-auto w-full max-w-3xl">
              <div className="relative flex items-end gap-2 rounded-2xl border bg-background px-4 py-3 shadow-lg ring-1 ring-border/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                <Textarea
                  ref={textareaRef}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={t("composer.placeholder")}
                  disabled={isSending || !resolvedSource}
                  className="min-h-6 max-h-[200px] w-full resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 text-base"
                />
                <Button
                  size="icon"
                  onClick={handleSend}
                  disabled={
                    !messageInput.trim() || isSending || !resolvedSource
                  }
                  className={cn(
                    "h-8 w-8 shrink-0 rounded-lg transition-all",
                    messageInput.trim()
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <SendHorizontal className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-2 text-center">
                <p className="text-[10px] text-muted-foreground/60">
                  AI can make mistakes. Verify important information.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
