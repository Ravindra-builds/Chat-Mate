"use client";

import { isTextUIPart, type UIMessage } from "ai";
import type { ChatStatus } from "ai";
import {
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  PencilIcon,
  RefreshCcwIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader } from "@/components/ai-elements/loader";
import { cn } from "@/lib/utils";
import type { BranchInfo } from "@/features/ai/actions/chat-store";
import { getMessageText } from "@/features/ai/utils/message-parts";
import { BranchNav } from "./branch-nav";

type WebSearchResult = { title: string; url: string; snippet: string };

type WebSearchPart = {
  type: "tool-search_web";
  toolCallId: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  input?: { query?: string };
  output?: { results?: WebSearchResult[]; error?: string };
  errorText?: string;
};

/** Plain boolean check (not a type predicate) — the SDK's UIMessagePart union is
 *  discriminated per-state, so our flattened WebSearchPart shape can't satisfy a
 *  `part is WebSearchPart` predicate. We cast explicitly where this is used instead. */
function isWebSearchPartType(part: UIMessage["parts"][number]): boolean {
   return part.type === "tool-search_web";
}

/** Live "Searching…" status while the tool runs, collapsible source list once it's done. */
function WebSearchPartView({ part }: { part: WebSearchPart }) {
  const [open, setOpen] = useState(false);
  const query = part.input?.query;

  if (part.state === "input-streaming" || part.state === "input-available") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader size={14} />
        <span>Searching{query ? ` for "${query}"` : " the web"}…</span>
      </div>
    );
  }

  if (part.state === "output-error" || part.output?.error) {
    return (
      <div className="text-sm text-muted-foreground">
        Web search failed{part.output?.error ? `: ${part.output.error}` : "."}
      </div>
    );
  }

  const results = part.output?.results ?? [];
  if (results.length === 0) return null;

  return (
    <div className="rounded-lg border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <GlobeIcon className="size-3.5" />
        <span>
          {results.length} source{results.length > 1 ? "s" : ""}
        </span>
        <ChevronDownIcon
          className={cn("ml-auto size-3.5 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <ul className="space-y-1 border-t px-3 py-2">
          {results.map((r) => (
            <li key={r.url} >
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-1.5 text-sm text-primary hover:underline"
              >
                <ExternalLinkIcon className="mt-0.5 size-3 shrink-0" />
                <span className="line-clamp-1">{r.title || r.url}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type ChatMessagesProps = {
  messages: UIMessage[];
  status: ChatStatus;
  /** Sibling/branch metadata keyed by message id, from loadChatMessages(). */
  branches?: Record<string, BranchInfo>;
  /** Called when the user picks a different sibling at a fork. */
  onSwitchBranch?: (parentId: string | null, childId: string) => void;
  /**
   * Called when the user saves an edited user message. Creates a new
   * sibling branch and triggers a fresh assistant reply for it. Resolves to
   * `false` on failure so the caller can keep the editor open for a retry.
   */
  onEditMessage?: (messageId: string, content: string) => Promise<boolean>;
  /**
   * Called when the user asks for a fresh assistant reply at a given fork.
   * Resolves to `false` on failure.
   */
  onRegenerateMessage?: (messageId: string) => Promise<boolean>;
  /** True while any branch mutation (switch/edit/regenerate) is in flight. */
  isBranchBusy?: boolean;
};

export function ChatMessages({
  messages,
  status,
  branches,
  onSwitchBranch,
  onEditMessage,
  onRegenerateMessage,
  isBranchBusy,
}: ChatMessagesProps) {
  const isWaiting = status === "submitted" && messages.at(-1)?.role === "user";

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function startEdit(message: UIMessage) {
    setEditingId(message.id);
    setDraft(getMessageText(message));
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft("");
  }

  async function saveEdit(messageId: string) {
    const trimmed = draft.trim();
    if (!trimmed || !onEditMessage) return;
    const ok = await onEditMessage(messageId, trimmed);
    if (ok) {
      setEditingId(null);
      setDraft("");
    }
  }

  async function copyMessage(message: UIMessage) {
    try {
      await navigator.clipboard.writeText(getMessageText(message));
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy message");
    }
  }

  return (
    <Conversation>
      <ConversationContent className="py-8">
        {messages.map((message) => {
          const branch = branches?.[message.id];
          const isUser = message.role === "user";
          const isEditingThis = editingId === message.id;

          return (
            <Message key={message.id} from={message.role}>
              {isEditingThis ? (
                <div className="flex w-full min-w-0 max-w-full flex-col gap-2 rounded-lg bg-secondary px-3 py-3 text-sm text-foreground">
                  <Textarea
                    autoFocus
                    value={draft}
                    disabled={isBranchBusy}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void saveEdit(message.id);
                      } else if (e.key === "Escape") {
                        cancelEdit();
                      }
                    }}
                    className="min-h-[60px] resize-none border-none bg-transparent p-0 shadow-none focus-visible:ring-0"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isBranchBusy}
                      onClick={cancelEdit}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        isBranchBusy ||
                        !draft.trim() ||
                        draft.trim() === getMessageText(message).trim()
                      }
                      onClick={() => void saveEdit(message.id)}
                    >
                      Save & submit
                    </Button>
                  </div>
                </div>
              ) : (
                <MessageContent>
                  {message.parts.map((part, i) => {
                    if (isTextUIPart(part)) {
                      return <MessageResponse key={i}>{part.text}</MessageResponse>;
                    }
                    if (isWebSearchPartType(part)) {
                      const searchPart = part as unknown as WebSearchPart;
                      return <WebSearchPartView key={searchPart.toolCallId ?? i} part={searchPart} />;
                    }
                    return null;
                  })}
                </MessageContent>
              )}

              {!isEditingThis ? (
                <div className={cn("flex items-center gap-1", isUser && "justify-end")}>
                  {branch && onSwitchBranch ? (
                    <BranchNav
                      index={branch.index}
                      total={branch.siblingIds.length}
                      disabled={isBranchBusy}
                      onNavigate={(nextIndex) =>
                        onSwitchBranch(branch.parentId, branch.siblingIds[nextIndex])
                      }
                    />
                  ) : null}

                  <MessageActions className="opacity-0 transition-opacity group-hover:opacity-100">
                    <MessageAction
                      tooltip="Copy"
                      onClick={() => void copyMessage(message)}
                    >
                      <CopyIcon />
                    </MessageAction>

                    {isUser && onEditMessage ? (
                      <MessageAction
                        tooltip="Edit"
                        disabled={isBranchBusy}
                        onClick={() => startEdit(message)}
                      >
                        <PencilIcon />
                      </MessageAction>
                    ) : null}

                    {!isUser && onRegenerateMessage ? (
                      <MessageAction
                        tooltip="Regenerate"
                        disabled={isBranchBusy}
                        onClick={() => void onRegenerateMessage(message.id)}
                      >
                        <RefreshCcwIcon />
                      </MessageAction>
                    ) : null}
                  </MessageActions>
                </div>
              ) : null}
            </Message>
          );
        })}

        {isWaiting ? (
          <Message from="assistant">
            <MessageContent>
              <Loader />
            </MessageContent>
          </Message>
        ) : null}
      </ConversationContent>
    </Conversation>
  );
}