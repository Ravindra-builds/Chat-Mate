"use client";

import { useQuery } from "@tanstack/react-query";
import { loadChatMessages } from "@/features/ai/actions/chat-store";
import { queryKeys } from "../utils/query-keys";

/**
 * Fetches sibling/branch metadata (siblingIds + index per message id) for
 * the active path of a conversation.
 *
 * This is independent from `useChat`'s own message state — it only tracks
 * branch navigation data, and should be invalidated after any mutation that
 * can change the tree (a turn finishing, edit, regenerate, or switching
 * branches).
 */
export function useBranches(conversationId: string) {
  return useQuery({
    queryKey: queryKeys.branches.byConversation(conversationId),
    queryFn: async () => {
      const { branches } = await loadChatMessages(conversationId);
      return branches;
    },
  });
}