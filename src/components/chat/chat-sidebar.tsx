"use client";

import { useTranslation } from "react-i18next";
import Link from "next/link";
import {
  Plus,
  Trash2,
  GitFork,
  MoreHorizontal,
  MessageSquare,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AiSource } from "@/store/ai-store";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { ChatThreadRecord } from "@/store/chat-db";

interface ChatSidebarProps {
  threads: ChatThreadRecord[];
  activeChatId?: string;
  sourceMap: Map<string, AiSource>;
  searchQuery: string;

  onSearchChange: (query: string) => void;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onForkChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onCloseMobile?: () => void;
}

export function ChatSidebar({
  threads,
  activeChatId,
  sourceMap,
  searchQuery,

  onSearchChange,
  onNewChat,
  onSelectChat,
  onForkChat,
  onDeleteChat,
  onCloseMobile,
}: ChatSidebarProps) {
  const { t } = useTranslation("commons", { keyPrefix: "chat-page.actions" });

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between px-4 py-2">
        <Button
          onClick={onNewChat}
          className="w-full justify-start gap-2 shadow-sm"
          variant="default"
        >
          <Plus className="h-4 w-4" />
          {t("new-chat")}
        </Button>
      </div>

      <div className="px-4 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("search")}
            className="pl-8 h-9"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
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
                        onSelectChat(thread.id);
                        onCloseMobile?.();
                      }}
                      className={cn(
                        "flex w-full flex-col items-start gap-1 rounded-md px-3 py-2 text-sm transition-all hover:bg-muted/50",
                        isActive
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <span className="truncate w-45 text-left">
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
                              onClick={() => onForkChat(thread.id)}
                            >
                              <GitFork className="mr-2 h-4 w-4" /> Fork
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onDeleteChat(thread.id)}
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
        <Link href="/" passHref>
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            size="sm"
          >
            {t("back")}
            <Kbd>ESC</Kbd>
          </Button>
        </Link>
      </div>
    </div>
  );
}
