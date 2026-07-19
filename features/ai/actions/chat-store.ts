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
};

type TreeRow = {
  id: string;
  role: MessageRole;
  parts: Prisma.JsonValue | null;
  content: string;
  parentId: string | null;
  activeChildId: string | null;
};

/**
 * Loads the *active* conversation path (root → leaf) by walking `activeChildId`
 * pointers, starting from `Conversation.activeRoot`. Also returns sibling
 * metadata for every message on that path so the UI can render branch
 * previous/next controls without extra round-trips.
 *
 * @param conversationId - The conversation whose active branch to load.
 */
export async function loadChatMessages(
  conversationId: string
): Promise<LoadChatMessagesResult> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { activeRootId: true },
  });

  if (!conversation?.activeRootId) {
    return { messages: [], branches: {} };
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

  const messages: UIMessage[] = path.map((row) => ({
    id: row.id,
    role: row.role === "ASSISTANT" ? "assistant" : "user",
    parts: toUIMessageParts(row.parts, row.content),
  }));

  return { messages, branches };
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

  const existingRows = await prisma.message.findMany({
    where: { id: { in: relevant.map((m) => m.id) } },
    select: { id: true },
  });
  const existingIds = new Set(existingRows.map((r) => r.id));

  let previousId: string | null = null;
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

      if (previousId) {
        await prisma.message.update({
          where: { id: previousId },
          data: { activeChildId: message.id },
        });
      } else {
        newRootId = message.id;
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

  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { title: true, activeRootId: true },
  });

  const firstUser = relevant.find((message) => message.role === "user");
  const firstUserText = firstUser ? getMessageText(firstUser).trim() : "";

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: new Date(),
      // Only ever set on a brand-new conversation's first message. Editing
      // the root later goes through editMessage(), which owns activeRootId
      // for that case.
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