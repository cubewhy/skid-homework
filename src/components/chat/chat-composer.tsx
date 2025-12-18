"use client";

import { useEffect, useRef } from "react";
import { SendHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

interface ChatComposerProps {
  input: string;
  setInput: (val: string) => void;
  onSend: () => void;
  isSending: boolean;
  disabled: boolean;
}

export function ChatComposer({
  input,
  setInput,
  onSend,
  isSending,
  disabled,
}: ChatComposerProps) {
  const { t } = useTranslation("commons", { keyPrefix: "chat-page.composer" });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(
        Math.max(scrollHeight, 24),
        200,
      )}px`;
    }
  }, [input]);

  return (
    <div className="shrink-0 bg-background px-4 pb-6 pt-2">
      <div className="mx-auto w-full max-w-3xl">
        <div className="relative flex items-end gap-2 rounded-2xl border bg-background px-4 py-3 shadow-lg ring-1 ring-border/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={t("placeholder")}
            disabled={disabled || isSending}
            className="min-h-6 max-h-50 w-full resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 text-base"
          />
          <Button
            size="icon"
            onClick={onSend}
            disabled={!input.trim() || isSending || disabled}
            className={cn(
              "h-8 w-8 shrink-0 rounded-lg transition-all",
              input.trim()
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            <SendHorizontal className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-2 text-center">
          <p className="text-[10px] text-muted-foreground/60">
            {t("aigc-disclaimer")}
          </p>
        </div>
      </div>
    </div>
  );
}
