import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { ModelOption } from "./model";

// Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in the env.
export const isRedisConfigured = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

if (!isRedisConfigured) {
  console.error(
    "[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN missing — failing CLOSED. No chat requests will be served until this is fixed. (Deliberate: an unmetered fallback here risks a real bill.)"
  );
}

const redis = isRedisConfigured ? Redis.fromEnv() : null;

type Provider = ModelOption["provider"];

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * One rolling-24h quota per provider (not per individual model) — switching
 * between e.g. gpt-4o and gpt-4.1 still draws from the same "openai"
 * bucket. Sliding window over "1 d" means "N requests in the trailing 24h",
 * not a quota that resets all at once at a fixed clock time.
 *
 * Limits are env-configurable so they can be tuned per environment without
 * a code change:
 *   RATE_LIMIT_OPENAI_PER_DAY (default 10)
 *   RATE_LIMIT_GOOGLE_PER_DAY (default 20)
 *
 * Keys are namespaced with the project name:
 *   ratelimit:chatmate:chat:<provider>:<userId>
 */
export const DAILY_LIMITS: Record<Provider, number> = {
  openai: envInt("RATE_LIMIT_OPENAI_PER_DAY", 10),
  google: envInt("RATE_LIMIT_GOOGLE_PER_DAY", 20),
};

const limiters: Record<Provider, Ratelimit> | null = redis
  ? {
      google: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(DAILY_LIMITS.google, "1 d"),
        analytics: true,
        prefix: "ratelimit:chatmate:chat:google",
      }),
      openai: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(DAILY_LIMITS.openai, "1 d"),
        analytics: true,
        prefix: "ratelimit:chatmate:chat:openai",
      }),
    }
  : null;

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  /** Unix ms timestamp when the oldest request in the window rolls off. */
  reset: number;
  /** False only when Redis itself isn't configured — distinct from a real quota hit. */
  configured: boolean;
};

/**
 * Checks (and consumes) one unit of the given user's daily quota for a
 * provider. Fails CLOSED if Redis isn't configured — blocking real usage is
 * a much cheaper mistake than silently letting requests through unmetered.
 */
export async function checkChatRateLimit(
  userId: string,
  provider: Provider
): Promise<RateLimitResult> {
  if (!limiters) {
    return {
      success: false,
      limit: DAILY_LIMITS[provider],
      remaining: 0,
      reset: Date.now(),
      configured: false,
    };
  }
  const { success, limit, remaining, reset } = await limiters[provider].limit(userId);
  return { success, limit, remaining, reset, configured: true };
}

export type UsageStatus = {
  provider: Provider;
  limit: number;
  remaining: number;
  used: number;
  reset: number;
};

/**
 * Non-consuming check — for showing "3/10 used today" in the UI without
 * spending one of the user's own requests just to display the counter.
 * Returns null if Redis isn't configured, so the sidebar widget can just
 * hide itself instead of showing broken numbers.
 */
export async function getRateLimitStatus(
  userId: string
): Promise<UsageStatus[] | null> {
  if (!limiters) return null;

  const providers: Provider[] = ["openai", "google"];

  return Promise.all(
    providers.map(async (provider) => {
      const { remaining, reset } = await limiters[provider].getRemaining(userId);
      const limit = DAILY_LIMITS[provider];
      const clampedRemaining = Math.max(0, Math.min(limit, remaining));
      return {
        provider,
        limit,
        remaining: clampedRemaining,
        used: limit - clampedRemaining,
        reset,
      };
    })
  );
}