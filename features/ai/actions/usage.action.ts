"use server";

import { requireUser } from "@/features/auth/action/require-user";
import { getRateLimitStatus, type UsageStatus } from "@/features/ai/utils/rate-limit";

/** Returns the current user's daily usage against both provider quotas, or null if rate limiting isn't configured. */
export async function getMyUsageStatus(): Promise<UsageStatus[] | null> {
  const user = await requireUser();
  return getRateLimitStatus(user.id);
}