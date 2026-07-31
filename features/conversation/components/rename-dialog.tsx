"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RenameDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTitle: string;
  onSave: (title: string) => void;
  isSaving?: boolean;
};

export function RenameDialog({
  open,
  onOpenChange,
  currentTitle,
  onSave,
  isSaving,
}: RenameDialogProps) {
  const [value, setValue] = React.useState(currentTitle);
  const [prevOpen, setPrevOpen] = React.useState(open);

  // Re-sync the draft every time the dialog opens by deriving state during render.
  // avoids the "cascading render"
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setValue(currentTitle);
    }
  }

  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && trimmed !== currentTitle.trim();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave || isSaving) return;
    onSave(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>Give this conversation a new name.</DialogDescription>
          </DialogHeader>

          <div className="mt-4 flex flex-col gap-2">
            <Label htmlFor="rename-chat-input" className="sr-only">
              Chat title
            </Label>
            <Input
              id="rename-chat-input"
              autoFocus
              value={value}
              disabled={isSaving}
              maxLength={80}
              onChange={(event) => setValue(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave || isSaving}>
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}