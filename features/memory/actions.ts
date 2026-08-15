"use server";

import { mem0 } from "./mem0-client";
import { requireUser } from "@/features/auth/action/require-user";
import { saveExplicitMemory } from "./memory.service";

export type StoredMemory = {
  id: string;
  memory: string;
  createdAt: string | null;
  updatedAt: string | null;
};

/**
 * Lists every memory Mem0 has stored for the authenticated user.
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

/**
 * Explicit-save Server Action for the settings UI — always authenticated via requireUser().
 */
export async function addMemoryManuallyForCurrentUser(fact: string) {
  const trimmed = fact.trim();
  if (!trimmed) return { saved: false, reason: "Memory can't be empty." };
  const user = await requireUser();
  return saveExplicitMemory(user.id, trimmed);
}
