"use client";

import { AnimatePresence, motion } from "framer-motion";
import { PanelLeftClose } from "lucide-react";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

import { useChatLogic } from "@/hooks/use-chat-logic";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ChatComposer } from "@/components/chat/chat-composer";

export default function ChatPage() {
  const { t } = useTranslation("commons", { keyPrefix: "chat-page" });
  const {
    activeChatId,
    activeThread,
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
  } = useChatLogic();

  const renderSidebarContent = (mobile = false) => (
    <ChatSidebar
      threads={filteredThreads}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      activeChatId={activeChatId}
      sourceMap={sourceMap}
      onNewChat={handleNewChat}
      onSelectChat={navigateToChat}
      onForkChat={handleForkChat}
      onDeleteChat={handleDeleteChat}
      onCloseMobile={mobile ? () => setSidebarOpen(false) : undefined}
    />
  );

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
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
                  <TooltipContent>{t("actions.close-sidebar")}</TooltipContent>
                </Tooltip>
              </div>
              <div className="flex-1 overflow-hidden">
                {renderSidebarContent()}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        <div className="flex flex-1 flex-col h-full min-w-0 bg-background">
          <ChatHeader
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            sidebarCollapsed={sidebarCollapsed}
            setSidebarCollapsed={setSidebarCollapsed}
            renderSidebar={renderSidebarContent}
            availableSources={availableSources}
            resolvedSource={resolvedSource}
            resolvedSourceId={resolvedSourceId}
            activeThread={activeThread}
            modelInput={modelInput}
            setModelInput={setModelInput}
            onSelectSource={handleSelectSource}
            onUpdateModel={async (id, model) => {
              await updateThread(id, { model });
            }}
          />

          <ChatMessages
            messages={chatMessages}
            resolvedSource={resolvedSource}
          />

          <ChatComposer
            input={messageInput}
            setInput={setMessageInput}
            onSend={handleSend}
            isSending={isSending}
            disabled={!resolvedSource}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
