"use client";

import { useUsageStatus } from "@/features/ai/hooks/use-usage-status";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  google: "Google",
};

/** Animated "fills as you use it" daily-usage bar per provider, sidebar footer. */
export function UsageStatus() {
  const { data } = useUsageStatus();

  if (!data) return null;

  return (
    <div className="flex flex-col gap-3 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
      {data.map((item) => {
        const percent = item.limit > 0 ? (item.used / item.limit) * 100 : 0;
        const exhausted = item.remaining === 0;
        const nearLimit = !exhausted && percent >= 80;

        return (
          <div key={item.provider} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{PROVIDER_LABEL[item.provider] ?? item.provider}</span>
              <span
                className={cn(
                  "tabular-nums",
                  exhausted && "font-medium text-destructive",
                  nearLimit && "font-medium text-amber-500"
                )}
                title={
                  exhausted
                    ? "Daily limit reached — resets on a rolling 24h window"
                    : undefined
                }
              >
                {item.used}/{item.limit}
              </span>
            </div>

            {/* Progress's indicator is bg-primary by default (your theme
                color) — these overrides only kick in near/at the limit. */}
            <div
              className={cn(
                exhausted &&
                  "[&_[data-slot=progress-indicator]]:bg-destructive",
                nearLimit &&
                  "[&_[data-slot=progress-indicator]]:bg-amber-500"
              )}
            >
              <Progress
                value={percent}
                className="[&_[data-slot=progress-track]]:h-1.5"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}