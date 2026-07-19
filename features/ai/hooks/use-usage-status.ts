"use client";

import { useQuery } from "@tanstack/react-query";
import { getMyUsageStatus } from "../actions/usage.action";
import { queryKeys } from "@/features/conversation/utils/query-keys";

/**
 * Current user's daily usage for both providers. Refetches periodically and
 * is also invalidated right after a chat turn finishes (see
 * `ConversationView`'s `onFinish`), so the sidebar counter stays live
 * without polling too aggressively.
 */
export function useUsageStatus() {
  return useQuery({
    queryKey: queryKeys.usage.status,
    queryFn: () => getMyUsageStatus(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}