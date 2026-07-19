"use client";

import { useUsageStatus } from "@/features/ai/hooks/use-usage-status";
import { cn } from "@/lib/utils";

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  google: "Google",
};

/** Small "3/10 · 7/20" style usage readout for the sidebar footer. */
export function UsageStatus() {
  const { data } = useUsageStatus();

  if (!data) return null;

  return (
    <div className="flex flex-col gap-1 px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
      {data.map((item) => {
        const exhausted = item.remaining === 0;
        return (
          <div key={item.provider} className="flex items-center justify-between gap-2">
            <span>{PROVIDER_LABEL[item.provider] ?? item.provider}</span>
            <span
              className={cn(
                "tabular-nums",
                exhausted && "font-medium text-destructive"
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
        );
      })}
    </div>
  );
}