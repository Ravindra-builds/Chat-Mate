"use server";

import { prisma } from "@/lib/db";
// import { getMessageText } from "@/features/ai/utils/message-parts";
import { mem0, isMem0Configured } from "./mem0-client";
import { requireUser } from "@/features/auth/action/require-user";

export type StoredMemory = {
  id: string;
  memory: string;
  createdAt: string | null;
  updatedAt: string | null;
};

/**
 * Lists every memory Mem0 has stored for the current user. Defensively
 * normalizes the response shape — v3's getAll returns a paginated
 * {count, next, previous, results} envelope, but this guards against a
 * plain array too in case that changes again.
 */
export async function listMyMemories(): Promise<StoredMemory[]> {
  if (!mem0) return [];
  const user = await requireUser();

  try {
    const response = await mem0.getAll({
      filters: { user_id: user.id },
      pageSize: 100,
    });
    const results = Array.isArray(response) ? response : response.results ?? [];

    return results.map((r) => ({
      id: r.id,
      memory: r.memory ?? "",
      createdAt: r.created_at ?? null,
      updatedAt: r.updated_at ?? null,
    }));
  } catch (error) {
    console.error("[memory] listAll failed", error);
    return [];
  }
}

/** Explicit-save entry point for the settings UI — resolves the current user itself. */
export async function addMemoryManuallyForCurrentUser(fact: string) {
  const trimmed = fact.trim();
  if (!trimmed) return { saved: false, reason: "Memory can't be empty." };
  const user = await requireUser();
  return saveExplicitMemory(user.id, trimmed);
}

const SYNC_EVERY_N_MESSAGES = 12;

type Mem0Message = { role: "user" | "assistant"; content: string };

export async function retrieveMemoryContext(
  userId: string,
  query: string,
): Promise<string | null> {
  if (!mem0) return null;

  try {
    const results = await mem0.search(query, {
      filters: { user_id: userId },
      topK: 5,
    });

    if (!results.results || results.results.length === 0) return null;

    const facts = results.results.map((r) => `- ${r.memory}`).join("\n");
    return `What you remember about this user from past conversations (use only if relevant, don't force it into unrelated answers):\n${facts}`;
  } catch (error) {
    console.error("[memory] retrieval failed", error);
    return null;
  }
}

async function addToMemory(userId: string, messages: Mem0Message[]) {
  if (!mem0 || messages.length === 0) return;
  try {
    await mem0.add(messages, { user_id: userId });
  } catch (error) {
    console.error("[memory] add failed", error);
  }
}

export async function syncConversationMemory(conversationId: string) {
  if (!isMem0Configured) return;

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { userId: true, memSyncedCount: true },
  });
  if (!conversation) return;

  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });

  const unsynced = rows.slice(conversation.memSyncedCount);
  if (unsynced.length === 0) return;

  const messages: Mem0Message[] = unsynced
    .filter((r) => r.role === "USER" || r.role === "ASSISTANT")
    .map((r) => ({
      role: r.role === "USER" ? ("user" as const) : ("assistant" as const),
      content: r.content,
    }))
    .filter((m) => m.content.trim().length > 0);

  await addToMemory(conversation.userId, messages);

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { memSyncedCount: rows.length },
  });
}

export async function syncConversationMemoryIfDue(conversationId: string) {
  if (!isMem0Configured) return;

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      memSyncedCount: true,
      _count: { select: { messages: true } },
    },
  });
  if (!conversation) return;

  const unsyncedCount =
    conversation._count.messages - conversation.memSyncedCount;
  if (unsyncedCount < SYNC_EVERY_N_MESSAGES) return;

  await syncConversationMemory(conversationId);
}

export async function saveExplicitMemory(userId: string, fact: string) {
  if (!mem0) {
    return { saved: false, reason: "Memory isn't configured right now." };
  }
  try {
    await mem0.add([{ role: "user", content: fact }], { user_id: userId });
    return { saved: true };
  } catch (error) {
    console.error("[memory] explicit save failed", error);
    return { saved: false, reason: "Could not save that right now." };
  }
}

export async function flushPendingMemory(userId: string) {
  if (!isMem0Configured) return;

  const conversations = await prisma.conversation.findMany({
    where: { userId, isArchived: false, isDeleted: false },
    select: {
      id: true,
      memSyncedCount: true,
      _count: { select: { messages: true } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 5,
  });

  const pending = conversations.filter(
    (c) => c._count.messages > c.memSyncedCount,
  );

  await Promise.all(pending.map((c) => syncConversationMemory(c.id)));
}
