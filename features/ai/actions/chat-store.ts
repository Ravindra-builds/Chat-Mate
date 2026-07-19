"use server";

import type { UIMessage } from "ai";
import type { MessageRole, Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getMessageText, toUIMessageParts } from "@/features/ai/utils/message-parts";

/** Sibling metadata for one message on the active path, used to drive branch nav UI. */
export type BranchInfo = {
  parentId: string | null;
  siblingIds: string[];
  index: number;
};

export type LoadChatMessagesResult = {
  /** The active path, root → leaf, ready for `useChat({ messages })`. */
  messages: UIMessage[];
  /** Keyed by message id — only populated for messages on the active path. */
  branches: Record<string, BranchInfo>;
  /**
   * Read-only ancestor messages inherited from the conversation this one
   * was forked from (root → the fork point), oldest first. Empty unless
   * this conversation has `forkedFromMessageId` set. These live in a
   * *different* conversation's tree — they're not part of `messages` and
   * aren't persisted again by `saveChatMessages` — but the model still
   * needs them for context, and the UI renders them above this
   * conversation's own (interactive) messages.
   */
  context: UIMessage[];
};

type TreeRow = {
  id: string;
  role: MessageRole;
  parts: Prisma.JsonValue | null;
  content: string;
  parentId: string | null;
  activeChildId: string | null;
};

function rowToUIMessage(row: Pick<TreeRow, "id" | "role" | "parts" | "content">): UIMessage {
  return {
    id: row.id,
    role: row.role === "ASSISTANT" ? "assistant" : "user",
    parts: toUIMessageParts(row.parts, row.content),
  };
}

/**
 * Walks the `parentId` chain upward from `messageId` — which may belong to
 * a *different* conversation than the one being loaded, since that's the
 * whole point for a forked conversation — and returns root → messageId,
 * inclusive, oldest first.
 *
 * One query per hop. Fork chains (and forks-of-forks) are expected to stay
 * shallow in practice, so this trades a few extra round-trips for a much
 * simpler implementation than a recursive SQL query.
 */
async function walkAncestors(messageId: string): Promise<UIMessage[]> {
  const chain: UIMessage[] = [];
  const visited = new Set<string>();
  let cursor: string | null = messageId;

  while (cursor) {
    if (visited.has(cursor)) break; // defensive: never trust a cycle
    visited.add(cursor);

    const row:any = await prisma.message.findUnique({
      where: { id: cursor },
      select: { id: true, role: true, parts: true, content: true, parentId: true },
    });
    if (!row) break;

    chain.push(rowToUIMessage(row));
    cursor = row.parentId;
  }

  return chain.reverse();
}

/**
 * Loads the *active* conversation path (root → leaf) by walking `activeChildId`
 * pointers, starting from `Conversation.activeRoot`. Also returns sibling
 * metadata for every message on that path so the UI can render branch
 * previous/next controls without extra round-trips, and — when this
 * conversation was forked off another one — the read-only ancestor context
 * leading up to the fork point.
 *
 * @param conversationId - The conversation whose active branch to load.
 */
export async function loadChatMessages(
  conversationId: string
): Promise<LoadChatMessagesResult> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { activeRootId: true, forkedFromMessageId: true },
  });

  if (!conversation) {
    return { messages: [], branches: {}, context: [] };
  }

  const context = conversation.forkedFromMessageId
    ? await walkAncestors(conversation.forkedFromMessageId)
    : [];

  if (!conversation.activeRootId) {
    return { messages: [], branches: {}, context };
  }

  // Single query for the whole tree — cheaper than walking with N round-trips,
  // and lets us compute sibling groups (including root-level siblings, which
  // have parentId: null) entirely in memory.
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      parts: true,
      content: true,
      parentId: true,
      activeChildId: true,
    },
  });

  const byId = new Map<string, TreeRow>();
  const childrenByParent = new Map<string | null, TreeRow[]>();
  for (const row of rows) {
    byId.set(row.id, row);
    const bucket = childrenByParent.get(row.parentId);
    if (bucket) {
      bucket.push(row);
    } else {
      childrenByParent.set(row.parentId, [row]);
    }
  }
  // Each bucket is already createdAt-asc since `rows` was fetched in that order.

  const path: TreeRow[] = [];
  const visited = new Set<string>();
  let currentId: string | null = conversation.activeRootId;

  while (currentId) {
    if (visited.has(currentId)) break; // defensive: never trust a cycle
    visited.add(currentId);

    const row = byId.get(currentId);
    if (!row) break;

    path.push(row);
    currentId = row.activeChildId;
  }

  const branches: Record<string, BranchInfo> = {};
  for (const row of path) {
    const siblings = childrenByParent.get(row.parentId) ?? [row];
    branches[row.id] = {
      parentId: row.parentId,
      siblingIds: siblings.map((s) => s.id),
      index: siblings.findIndex((s) => s.id === row.id),
    };
  }

  const messages: UIMessage[] = path.map(rowToUIMessage);

  return { messages, branches, context };
}

/**
 * True if `messageId` itself, or any message in its subtree (replies,
 * replies-to-replies, etc), is the fork anchor for another conversation.
 *
 * Deleting a message cascades to its whole subtree via the `parentId` FK
 * (`onDelete: Cascade`) — if any message down that subtree is another
 * conversation's `forkedFromMessageId`, that conversation's entire history
 * would silently go with it. This is the guard `editMessage`/
 * `regenerateMessage` call before doing an `"inline"` delete, since inline
 * mode discards a message (and everything under it) outright rather than
 * branching.
 */
export async function hasForksInSubtree(messageId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id FROM "Message" WHERE id = ${messageId}
      UNION ALL
      SELECT m.id FROM "Message" m
      JOIN subtree s ON m."parentId" = s.id
    )
    SELECT c.id FROM "Conversation" c
    JOIN subtree s ON c."forkedFromMessageId" = s.id
    LIMIT 1
  `;
  return rows.length > 0;
}

type SaveChatMessagesOptions = {
  updateTitle?: boolean;
};

/**
 * Persists a contiguous path of AI SDK `UIMessage`s (root → leaf, or a tail
 * of it) into the message tree.
 *
 * `parentId` for any newly-created message is inferred from its predecessor
 * in the `messages` array — the caller is responsible for passing a real
 * path (e.g. the active path plus one new message), not an arbitrary set.
 * Already-persisted messages are only content-updated; their `parentId` is
 * never touched.
 *
 * Fork-aware: if this conversation was forked off another one
 * (`forkedFromMessageId`) and hasn't saved any of its own messages yet, the
 * very first message's `parentId` is set to that fork anchor instead of
 * `null` — but the anchor's own `activeChildId` is deliberately left
 * untouched, since that pointer drives the *source* conversation's active
 * path, not this fork's.
 *
 * @param conversationId - Target conversation ID.
 * @param messages - A root-to-leaf path to persist (system messages are skipped).
 * @param options.updateTitle - When true, auto-titles "New Chat" from the first user message.
 */
export async function saveChatMessages(
  conversationId: string,
  messages: UIMessage[],
  options: SaveChatMessagesOptions = {}
) {
  const { updateTitle = true } = options;
  const relevant = messages.filter((message) => message.role !== "system");

  if (relevant.length === 0) return;

  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { title: true, activeRootId: true, forkedFromMessageId: true },
  });

  const existingRows = await prisma.message.findMany({
    where: { id: { in: relevant.map((m) => m.id) } },
    select: { id: true },
  });
  const existingIds = new Set(existingRows.map((r) => r.id));

  const isUnstartedFork = !conversation.activeRootId && !!conversation.forkedFromMessageId;
  const forkAnchorId = isUnstartedFork ? conversation.forkedFromMessageId : null;

  let previousId: string | null = forkAnchorId ?? null;
  let newRootId: string | null = null;

  for (const message of relevant) {
    const content = getMessageText(message);
    const role = message.role === "assistant" ? "ASSISTANT" : "USER";
    const isNew = !existingIds.has(message.id);

    if (isNew) {
      await prisma.message.create({
        data: {
          id: message.id,
          conversationId,
          role,
          status: "COMPLETE",
          content,
          parts: message.parts as Prisma.InputJsonValue,
          parentId: previousId,
        },
      });

      if (previousId === null) {
        // First message overall — no parent, this is a fresh root.
        newRootId = message.id;
      } else if (previousId === forkAnchorId) {
        // First message of a *forked* conversation — its parent lives in
        // another conversation, so it's still this conversation's own
        // root, but we must not touch the foreign parent's activeChildId.
        newRootId = message.id;
      } else {
        await prisma.message.update({
          where: { id: previousId },
          data: { activeChildId: message.id },
        });
      }
    } else {
      await prisma.message.update({
        where: { id: message.id },
        data: {
          content,
          parts: message.parts as Prisma.InputJsonValue,
          status: "COMPLETE",
        },
      });
    }

    previousId = message.id;
  }

  const firstUser = relevant.find((message) => message.role === "user");
  const firstUserText = firstUser ? getMessageText(firstUser).trim() : "";

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: new Date(),
      // Only ever set on a brand-new (or brand-new-fork) conversation's
      // first message. Editing the root later goes through editMessage(),
      // which owns activeRootId for that case.
      ...(newRootId && !conversation.activeRootId
        ? { activeRootId: newRootId }
        : {}),
      title:
        updateTitle && conversation.title === "New Chat" && firstUserText
          ? firstUserText.slice(0, 48)
          : conversation.title,
    },
  });
}