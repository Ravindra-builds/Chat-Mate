import type { HTMLAttributes } from "react";
import { Loader2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Props for the {@link Loader} spinner component. */
export type LoaderProps = HTMLAttributes<HTMLDivElement> & {
  size?: number;
};

/** Spinning loading indicator for in-progress assistant responses. */
export const Loader = ({ className, size = 16, ...props }: LoaderProps) => (
  <div
    className={cn("inline-flex items-center justify-center", className)}
    {...props}
  >
    <Loader2Icon className="animate-spin" size={size} />
  </div>
);

/** Three-dot "typing" indicator shown while an assistant reply hasn't started streaming yet. */
export const TypingIndicator = ({ className }: { className?: string }) => (
  <div className={cn("inline-flex items-center gap-1.5 py-1 px-2", className)}>
    <span className="size-2 animate-pulse rounded-full bg-primary/80 [animation-duration:0.6s]" />
    <span className="size-2 animate-pulse rounded-full bg-primary/80 [animation-duration:0.6s] [animation-delay:0.2s]" />
    <span className="size-2 animate-pulse rounded-full bg-primary/80 [animation-duration:0.6s] [animation-delay:0.4s]" />
  </div>
);