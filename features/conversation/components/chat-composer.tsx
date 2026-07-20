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
// Only the presentational pieces — trigger/content/item/value stay the plain
// PromptInputSelect (Radix Select) dropdown, unchanged. This just swaps what
// renders inside each item/the trigger: logo icon instead of provider text.
import { ModelSelectorLogo, ModelSelectorName } from "@/components/ai-elements/model-selector";
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
  // Purely for display in the trigger — doesn't affect what's sent to the
  // server, `onModelChange`/`model` still drive that exactly as before.
  const selectedOption = MODEL_OPTIONS.find((option) => option.id === model);

  async function handleSubmit(message: { text: string }) {
    const text = message.text.trim();
    if (!text || isSending) return;
    await onSend({ text, model, webSearch });
  }

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-3xl px-3 pb-3 sm:px-4 sm:pb-4 md:px-6",
        // On phones with a home-indicator/gesture bar, env(safe-area-inset-bottom)
        // is the height of that reserved zone (0 on other devices) — pb-3
        // already covers non-notched phones, so only add the extra when needed.
        "[padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]",
        className
      )}
    >
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            placeholder="Message ChatMate"
            className="min-h-10 max-h-32 sm:min-h-16 sm:max-h-48"
          />
        </PromptInputBody>

        <PromptInputFooter className="flex-wrap gap-2">
          <PromptInputTools className="min-w-0 flex-1 overflow-x-auto">
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
              className="shrink-0"
            >
              <GlobeIcon className="size-4 shrink-0" />
              {/* Icon-only on phones to leave room for the model picker */}
              <span className="hidden sm:inline">Search</span>
            </PromptInputButton>

            <PromptInputSelect value={model} onValueChange={(v) => onModelChange(v as string)}>
              <PromptInputSelectTrigger className="min-w-0 shrink-0 gap-1.5">
                {selectedOption ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ModelSelectorLogo
                      provider={selectedOption.provider}
                      className="size-4 shrink-0"
                    />
                    <ModelSelectorName className="truncate">
                      {selectedOption.label}
                    </ModelSelectorName>
                  </span>
                ) : (
                  <PromptInputSelectValue placeholder="Model" />
                )}
              </PromptInputSelectTrigger>
              <PromptInputSelectContent>
                {MODEL_OPTIONS.map((option) => (
                  <PromptInputSelectItem key={option.id} value={option.id}>
                    <ModelSelectorLogo provider={option.provider} className="size-4 shrink-0" />
                    <ModelSelectorName className="truncate">{option.label}</ModelSelectorName>
                  </PromptInputSelectItem>
                ))}
              </PromptInputSelectContent>
            </PromptInputSelect>
          </PromptInputTools>

          <PromptInputSubmit status={status} className="shrink-0" />
        </PromptInputFooter>
      </PromptInput>

      <p className="mt-2 text-center text-xs text-muted-foreground">
        ChatMate can make mistakes. Check important info.
      </p>
    </div>
  );
}