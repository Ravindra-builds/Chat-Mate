"use client";

import { isTextUIPart, type UIMessage } from "ai";
import type { ChatStatus } from "ai";
import { ChevronDownIcon, ExternalLinkIcon, GlobeIcon } from "lucide-react";
import { useState } from "react";

import {
  Conversation,
  ConversationContent,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { Loader } from "@/components/ai-elements/loader";
import { cn } from "@/lib/utils";

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
};

export function ChatMessages({ messages, status }: ChatMessagesProps) {
  const isWaiting = status === "submitted" && messages.at(-1)?.role === "user";

  return (
    <Conversation>
      <ConversationContent className="py-8">
        {messages.map((message) => (
          <Message key={message.id} from={message.role}>
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
          </Message>
        ))}

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