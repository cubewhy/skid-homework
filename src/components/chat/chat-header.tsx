"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  Menu,
  PanelLeftOpen,
  Settings2,
  ChevronsUpDown,
  Check,
} from "lucide-react";

import type { AiSource } from "@/store/ai-store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { ChatThreadRecord } from "@/db/chat-db";

interface ChatHeaderProps {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  renderSidebar: (mobile?: boolean) => React.ReactNode;
  availableSources: AiSource[];
  resolvedSource: AiSource | null;
  resolvedSourceId: string | null;
  activeThread?: ChatThreadRecord;
  modelInput: string;
  setModelInput: (val: string) => void;
  onSelectSource: (id: string) => void;
  onUpdateModel: (id: string, model: string) => void;
}

export function ChatHeader({
  sidebarOpen,
  setSidebarOpen,
  sidebarCollapsed,
  setSidebarCollapsed,
  renderSidebar,
  availableSources,
  resolvedSource,
  resolvedSourceId,
  activeThread,
  modelInput,
  setModelInput,
  onSelectSource,
  onUpdateModel,
}: ChatHeaderProps) {
  const { t } = useTranslation("commons", { keyPrefix: "chat-page" });

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 bg-background/80 backdrop-blur-sm z-10">
      <div className="flex items-center gap-2">
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-75 p-0">
            <SheetHeader className="px-4 py-3 border-b text-left">
              <SheetTitle>Chat Menu</SheetTitle>
            </SheetHeader>
            {renderSidebar(true)}
          </SheetContent>
        </Sheet>

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

      <Popover>
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
        <PopoverContent className="w-75 p-0" align="start">
          <Command>
            <CommandInput placeholder={t("source.search")} />
            <CommandList>
              <CommandEmpty>{t("source.empty")}</CommandEmpty>
              <CommandGroup heading="Providers">
                {availableSources.map((source) => (
                  <CommandItem
                    key={source.id}
                    onSelect={() => onSelectSource(source.id)}
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
                onBlur={() => {
                  if (activeThread && modelInput !== activeThread.model) {
                    onUpdateModel(activeThread.id, modelInput);
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
            <Link href="/settings?from=/chat">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </Link>
          </TooltipTrigger>
          <TooltipContent>
            {t("actions.open-settings", { defaultValue: "Settings" })}
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
