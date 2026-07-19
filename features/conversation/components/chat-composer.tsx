"use client";

import * as React from "react";
import { GlobeIcon } from "lucide-react";
import type { ChatStatus } from "ai";

import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  // Attachments disabled for now — bring back when file/image upload is needed:
  // PromptInputActionMenu,
  // PromptInputActionMenuTrigger,
  // PromptInputActionMenuContent,
  // PromptInputActionAddAttachments,
} from "@/components/ai-elements/prompt-input";
import { MODEL_OPTIONS } from "@/features/ai/utils/model";
import { cn } from "@/lib/utils";

type ChatComposerProps = {
  onSend: (params: { text: string; model: string; webSearch: boolean }) => Promise<void> | void;
  status: ChatStatus;
  model: string;
  onModelChange: (model: string) => void;
  webSearch: boolean;
  onWebSearchChange: (value: boolean) => void;
  className?: string;
};

/**
 * Message composer — text input, model picker, and web-search toggle,
 * built on the Vercel AI Elements `PromptInput` primitives.
 */
export function ChatComposer({
  onSend,
  status,
  model,
  onModelChange,
  webSearch,
  onWebSearchChange,
  className,
}: ChatComposerProps) {
  const isSending = status === "submitted" || status === "streaming";

  async function handleSubmit(message: { text: string }) {
    const text = message.text.trim();
    if (!text || isSending) return;
    await onSend({ text, model, webSearch });
  }

  return (
    <div className={cn("mx-auto w-full max-w-3xl px-4 pb-4 md:px-6", className)}>
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea placeholder="Message ChatMate" />
        </PromptInputBody>

        <PromptInputFooter>
          <PromptInputTools>
            {/* Attachments disabled for now:
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
            */}

            <PromptInputButton
              variant={webSearch ? "default" : "ghost"}
              onClick={() => onWebSearchChange(!webSearch)}
              tooltip="Search the web"
            >
              <GlobeIcon className="size-4" />
              <span>Search</span>
            </PromptInputButton>

            <PromptInputSelect value={model} onValueChange={(v) => onModelChange(v as string)}>
              <PromptInputSelectTrigger>
                <PromptInputSelectValue placeholder="Model" />
              </PromptInputSelectTrigger>
              <PromptInputSelectContent>
                {MODEL_OPTIONS.map((option) => (
                  <PromptInputSelectItem key={option.id} value={option.label}>
                    {option.label}
                  </PromptInputSelectItem>
                ))}
              </PromptInputSelectContent>
            </PromptInputSelect>
          </PromptInputTools>

          <PromptInputSubmit status={status} />
        </PromptInputFooter>
      </PromptInput>

      <p className="mt-2 text-center text-xs text-muted-foreground">
        ChatMate can make mistakes. Check important info.
      </p>
    </div>
  );
}