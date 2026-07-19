"use client";

import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

type BranchNavProps = {
  index: number;
  total: number;
  disabled?: boolean;
  onNavigate: (nextIndex: number) => void;
};

/**
 * Prev/next control for switching between sibling branches at a fork.
 * Unlike `MessageBranch`/`MessageBranchContent` (which swap between
 * pre-rendered content already in the DOM), this only renders index/count
 * and delegates the actual branch switch to the caller — switching branches
 * here means a server round-trip (`setActiveChild`), not a local swap.
 */
export function BranchNav({ index, total, disabled, onNavigate }: BranchNavProps) {
  if (total <= 1) return null;

  return (
    <ButtonGroup className="[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md">
      <Button
        aria-label="Previous branch"
        disabled={disabled || index <= 0}
        onClick={() => onNavigate(index - 1)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <ChevronLeftIcon size={14} />
      </Button>
      <ButtonGroupText className="border-none bg-transparent text-muted-foreground shadow-none">
        {index + 1} of {total}
      </ButtonGroupText>
      <Button
        aria-label="Next branch"
        disabled={disabled || index >= total - 1}
        onClick={() => onNavigate(index + 1)}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <ChevronRightIcon size={14} />
      </Button>
    </ButtonGroup>
  );
}