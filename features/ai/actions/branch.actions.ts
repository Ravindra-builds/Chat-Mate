"use server";

import { revalidatePath } from "next/cache";
import type { UIMessage } from "ai";
import type { Prisma } from "@/lib/generated/prisma/client";
import { requireUser } from "@/features/auth/action/require-user";
import { prisma } from "@/lib/db";
import { loadChatMessages, type LoadChatMessagesResult } from "./chat-store";
import { toUIMessageParts } from "@/features/ai/utils/message-parts";

export type EditMode = "inline" | "branch";

/**
 * Loads a message and verifies it belongs to a conversation owned by the
 * current user.
 *
 * @throws {Error} When the message doesn't exist or isn't owned by the caller.
 */
async function loadOwnedMessage(messageId: string) {
  const user = await requireUser();

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      conversationId: true,
      role: true,
      parentId: true,
      activeChildId: true,
      conversation: { select: { userId: true } },
    },
  });

  if (!message || message.conversation.userId !== user.id) {
    throw new Error("Message not found");
  }

  return message;
}

/**
 * Builds the root→`messageId` ancestor path (inclusive) plus sibling
 * metadata for every message on it. Used to hand the client a trimmed path
 * after an edit/regenerate that hasn't produced a new assistant reply yet —
 * ready for `setMessages()` followed by `regenerate()` against `/api/chat`.
 */
async function loadAncestorPath(
  conversationId: string,
  messageId: string
): Promise<LoadChatMessagesResult> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      parts: true,
      content: true,
      parentId: true,
    },
  });

  const byId = new Map(rows.map((row) => [row.id, row]));
  const childrenByParent = new Map<string | null, typeof rows>();
  for (const row of rows) {
    const bucket = childrenByParent.get(row.parentId);
    if (bucket) bucket.push(row);
    else childrenByParent.set(row.parentId, [row]);
  }

  const chain: typeof rows = [];
  const visited = new Set<string>();
  let currentId: string | null = messageId;

  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const row = byId.get(currentId);
    if (!row) break;
    chain.push(row);
    currentId = row.parentId;
  }
  chain.reverse();

  const branches: LoadChatMessagesResult["branches"] = {};
  for (const row of chain) {
    const siblings = childrenByParent.get(row.parentId) ?? [row];
    branches[row.id] = {
      parentId: row.parentId,
      siblingIds: siblings.map((sibling) => sibling.id),
      index: siblings.findIndex((sibling) => sibling.id === row.id),
    };
  }

  const messages: UIMessage[] = chain.map((row) => ({
    id: row.id,
    role: row.role === "ASSISTANT" ? "assistant" : "user",
    parts: toUIMessageParts(row.parts, row.content),
  }));

  return { messages, branches };
}

/**
 * Edits a user message.
 *
 * - `"branch"` — creates a new sibling user message (same parent), makes it
 *   the active branch, and preserves the original for navigation.
 * - `"inline"` — updates the message content in place and discards the
 *   assistant reply that followed it (and anything after that reply), so a
 *   fresh one replaces it. No sibling branch is created. Only meaningful
 *   when called on the current leaf of the active path — calling it on an
 *   earlier message will delete everything downstream of that reply.
 *
 * Either way, returns the root→message ancestor path so the client can
 * `setMessages()` and trigger `regenerate()`.
 */
export async function editMessage(
  messageId: string,
  content: string,
  mode: EditMode
): Promise<LoadChatMessagesResult> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Message cannot be empty");

  const message = await loadOwnedMessage(messageId);
  if (message.role !== "USER") {
    throw new Error("Only user messages can be edited");
  }

  const parts = [{ type: "text", text: trimmed }] as Prisma.InputJsonValue;

  if (mode === "branch") {
    const sibling = await prisma.message.create({
      data: {
        conversationId: message.conversationId,
        role: "USER",
        status: "COMPLETE",
        content: trimmed,
        parts,
        parentId: message.parentId,
      },
    });

    if (message.parentId) {
      await prisma.message.update({
        where: { id: message.parentId },
        data: { activeChildId: sibling.id },
      });
    } else {
      await prisma.conversation.update({
        where: { id: message.conversationId },
        data: { activeRootId: sibling.id },
      });
    }

    revalidatePath(`/c/${message.conversationId}`);
    return loadAncestorPath(message.conversationId, sibling.id);
  }

  // inline: overwrite content in place, drop the stale reply (and its
  // subtree) that followed it — deleting it cascades and clears the
  // parent's activeChildId automatically (FK onDelete: SetNull).
  if (message.activeChildId) {
    await prisma.message.delete({ where: { id: message.activeChildId } });
  }

  await prisma.message.update({
    where: { id: messageId },
    data: { content: trimmed, parts },
  });

  revalidatePath(`/c/${message.conversationId}`);
  return loadAncestorPath(message.conversationId, messageId);
}

/**
 * Regenerates an assistant reply.
 *
 * - `"branch"` — leaves the existing assistant message untouched (it
 *   becomes an inactive sibling once the new one is saved) and returns the
 *   path trimmed to its parent user message. `saveChatMessages` creates the
 *   new sibling and repoints `activeChildId` once the reply streams in.
 * - `"inline"` — deletes the existing assistant message (and its subtree)
 *   outright, so exactly one reply exists once regeneration completes — no
 *   branch arrows, at the cost of a new underlying row id.
 */
export async function regenerateMessage(
  messageId: string,
  mode: EditMode
): Promise<LoadChatMessagesResult> {
  const message = await loadOwnedMessage(messageId);
  if (message.role !== "ASSISTANT") {
    throw new Error("Only assistant messages can be regenerated");
  }
  if (!message.parentId) {
    throw new Error("Assistant message has no parent to regenerate from");
  }

  if (mode === "inline") {
    await prisma.message.delete({ where: { id: messageId } });
  }
  // "branch": no mutation needed here — saveChatMessages will create a
  // fresh sibling and repoint activeChildId once the new reply streams in.

  revalidatePath(`/c/${message.conversationId}`);
  return loadAncestorPath(message.conversationId, message.parentId);
}

/**
 * Switches the active branch at a fork.
 *
 * @param parentId - The parent message id, or `null` to switch the
 *   conversation's root branch.
 * @param childId - The sibling to make active; must actually be a child of
 *   `parentId` (or a root message, when `parentId` is `null`).
 */
export async function setActiveChild(
  parentId: string | null,
  childId: string
): Promise<LoadChatMessagesResult> {
  const child = await loadOwnedMessage(childId);

  if (child.parentId !== parentId) {
    throw new Error("childId is not a child of parentId");
  }

  if (parentId === null) {
    await prisma.conversation.update({
      where: { id: child.conversationId },
      data: { activeRootId: childId },
    });
  } else {
    await prisma.message.update({
      where: { id: parentId },
      data: { activeChildId: childId },
    });
  }

  revalidatePath(`/c/${child.conversationId}`);

  // Full active path, not just an ancestor chain — switching to a branch
  // should also follow whatever active pointers already exist further down
  // that subtree, not stop at childId.
  return loadChatMessages(child.conversationId);
}