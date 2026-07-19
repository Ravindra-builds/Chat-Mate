"use client";

import { isTextUIPart, type UIMessage } from "ai";
import type { ChatStatus } from "ai";
import {
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GlobeIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCcwIcon,
} from "lucide-react";
import Link from "next/link";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

/** Renders a message's text/web-search parts. Shared by interactive and read-only context messages. */
function MessagePartsView({ message }: { message: UIMessage }) {
  return (
    <>
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
    </>
  );
}

type ChatMessagesProps = {
  messages: UIMessage[];
  status: ChatStatus;
  /** Sibling/branch metadata keyed by message id, from loadChatMessages(). */
  branches?: Record<string, BranchInfo>;
  /**
   * Read-only ancestor messages inherited from a forked-from conversation
   * (root → fork point). Rendered above `messages` with no action bar —
   * they belong to a different conversation's tree.
   */
  context?: UIMessage[];
  /** The conversation this one was forked from, if any — used for the "view original" link. */
  sourceConversationId?: string | null;
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
  /** Called when the user forks a message off into a brand-new conversation. */
  onForkConversation?: (messageId: string) => void;
  /** True while a fork is being created (disables the menu item, doesn't block anything else). */
  isForking?: boolean;
  /** True while any branch mutation (switch/edit/regenerate) is in flight. */
  isBranchBusy?: boolean;
};

export function ChatMessages({
  messages,
  status,
  branches,
  context,
  sourceConversationId,
  onSwitchBranch,
  onEditMessage,
  onRegenerateMessage,
  onForkConversation,
  isForking,
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
        {context && context.length > 0 ? (
          <>
            <div className="mx-auto flex w-full max-w-[95%] items-center gap-3 py-2 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              <span className="shrink-0">
                Branched from{" "}
                {sourceConversationId ? (
                  <Link
                    href={`/c/${sourceConversationId}`}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    an earlier conversation
                  </Link>
                ) : (
                  "an earlier conversation"
                )}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>

            {context.map((message) => (
              <Message key={message.id} from={message.role} className="opacity-60">
                <MessageContent>
                  <MessagePartsView message={message} />
                </MessageContent>
              </Message>
            ))}

            <div className="mx-auto flex w-full max-w-[95%] items-center py-2">
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        ) : null}

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
                  <MessagePartsView message={message} />
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

                  {/*
                    Hover-revealed on desktop (mouse can discover it by
                    hovering), but always visible below the `md` breakpoint —
                    touch devices have no hover state, so gating discovery
                    behind it would hide these entirely on phones.
                  */}
                  <MessageActions className="transition-opacity opacity-100">
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
                  </MessageActions>

                  {/*
                    The "more" menu is always visible — never hover-gated —
                    both so it works on touch and so its contents
                    (regenerate / fork) are discoverable without hovering,
                    same as ChatGPT's kebab menu.
                  */}
                  {onRegenerateMessage || onForkConversation ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button type="button" size="icon-sm" variant="ghost" />}
                      >
                        <MoreHorizontalIcon className="size-3.5" />
                        <span className="sr-only">More actions</span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align={isUser ? "end" : "start"}>
                        {!isUser && onRegenerateMessage ? (
                          <DropdownMenuItem
                            disabled={isBranchBusy}
                            onClick={() => void onRegenerateMessage(message.id)}
                          >
                            <RefreshCcwIcon />
                            Regenerate
                          </DropdownMenuItem>
                        ) : null}
                        {onForkConversation ? (
                          <DropdownMenuItem
                            disabled={isForking}
                            onClick={() => onForkConversation(message.id)}
                          >
                            <GitBranchIcon />
                            Make new branch
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
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