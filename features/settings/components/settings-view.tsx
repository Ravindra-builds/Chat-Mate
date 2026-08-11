"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { toast } from "sonner";
import { DownloadIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

import { useUsageStatus } from "@/features/ai/hooks/use-usage-status";
import {
  useMemories,
  useAddMemory,
} from "@/features/settings/hooks/use-memories";
import { syncProfileName } from "@/features/settings/profile.actions";

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  google: "Google",
};

export function SettingsView() {
  const { user, isLoaded } = useUser();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [prevLoaded, setPrevLoaded] = useState(false);

  // Derive-during-render sync, same pattern as RenameDialog — fills the
  // form once Clerk's user data arrives, without a useEffect.
  if (isLoaded && !prevLoaded && user) {
    setPrevLoaded(true);
    setFirstName(user.firstName ?? "");
    setLastName(user.lastName ?? "");
  }

  const { data: usage } = useUsageStatus();
  const { data: memories, isLoading: memoriesLoading } = useMemories();
  const addMemory = useAddMemory();
  const [memoryDraft, setMemoryDraft] = useState("");

  async function handleSaveProfile() {
    if (!user) return;
    setSavingProfile(true);
    try {
      await user.update({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      await syncProfileName(firstName.trim(), lastName.trim());
      toast.success("Profile updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update profile",
      );
    } finally {
      setSavingProfile(false);
    }
  }

  function handleExport() {
    if (!memories || memories.length === 0) {
      toast.error("No memories to export yet");
      return;
    }
    const blob = new Blob([JSON.stringify(memories, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "chatmate-memories.json";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-10">
      {/* Page heading */}
      <header className="mb-10">
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Settings
        </p>

        <h1 className="mt-2 text-xl font-medium tracking-tight">
          Your ChatMate space
        </h1>

        <p className="mt-1.5 max-w-lg text-xs leading-5 text-muted-foreground">
          Manage your profile, usage, and the information ChatMate keeps for
          you.
        </p>
      </header>

      <div className="space-y-11">
        {/* Profile */}
        <section>
          <div className="mb-5">
            <h2 className="inline-block border-b border-foreground/25 pb-1 text-sm font-medium">
              Profile
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              Your basic account information.
            </p>
          </div>

          {!isLoaded ? (
            <Skeleton className="h-36 w-full rounded-lg" />
          ) : (
            <div className="rounded-lg border bg-card px-4 py-4 sm:px-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="first-name"
                    className="text-xs font-normal text-muted-foreground"
                  >
                    First name
                  </Label>

                  <Input
                    id="first-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="h-9 rounded-md text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="last-name"
                    className="text-xs font-normal text-muted-foreground"
                  >
                    Last name
                  </Label>

                  <Input
                    id="last-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="h-9 rounded-md text-sm"
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label
                    htmlFor="email"
                    className="text-xs font-normal text-muted-foreground"
                  >
                    Email
                  </Label>

                  <Input
                    id="email"
                    value={user?.primaryEmailAddress?.emailAddress ?? ""}
                    disabled
                    className="h-9 rounded-md bg-muted/30 text-sm"
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-end border-t pt-4">
                <Button
                  size="sm"
                  className="h-8 rounded-md px-3 text-xs"
                  disabled={savingProfile}
                  onClick={handleSaveProfile}
                >
                  {savingProfile ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Usage */}
        <section>
          <div className="mb-5">
            <h2 className="inline-block border-b border-foreground/25 pb-1 text-sm font-medium">
              Usage
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              Your AI usage for today.
            </p>
          </div>

          {!usage ? (
            <p className="text-xs text-muted-foreground">
              Usage tracking isn&apos;t configured.
            </p>
          ) : (
            <div className="rounded-lg border bg-card px-4 py-4 sm:px-5">
              <div className="space-y-5">
                {usage.map((item) => {
                  const percent =
                    item.limit > 0 ? (item.used / item.limit) * 100 : 0;

                  return (
                    <div key={item.provider} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">
                          {PROVIDER_LABEL[item.provider] ?? item.provider}
                        </span>

                        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                          {item.used}/{item.limit}
                        </span>
                      </div>

                      <Progress value={percent} className="h-1" />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Memory */}
        <section>
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 className="inline-block border-b border-foreground/25 pb-1 text-sm font-medium">
                Memory
              </h2>

              <p className="mt-2 text-xs text-muted-foreground">
                Things ChatMate can remember across conversations.
              </p>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleExport}
              className="h-8 shrink-0 px-2.5 text-xs"
            >
              <DownloadIcon className="size-3.5" />
              Export
            </Button>
          </div>

          {/* Add memory */}
          <div className="rounded-lg border bg-card px-4 py-4 sm:px-5">
            <Label htmlFor="memory-draft" className="text-xs font-medium">
              Add a memory
            </Label>

            <p className="mt-1 text-[11px] text-muted-foreground">
              Give ChatMate something useful to remember.
            </p>

            <Textarea
              id="memory-draft"
              placeholder="e.g. I prefer TypeScript over JavaScript"
              value={memoryDraft}
              onChange={(e) => setMemoryDraft(e.target.value)}
              className="mt-3 min-h-20 resize-none rounded-md text-sm"
            />

            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                className="h-8 rounded-md px-3 text-xs"
                disabled={!memoryDraft.trim() || addMemory.isPending}
                onClick={() =>
                  addMemory.mutate(memoryDraft.trim(), {
                    onSuccess: (result) => {
                      if (result.saved) setMemoryDraft("");
                    },
                  })
                }
              >
                <PlusIcon className="size-3.5" />
                {addMemory.isPending ? "Saving..." : "Save memory"}
              </Button>
            </div>
          </div>

          {/* Stored memories */}
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">Stored memories</span>

              <span className="text-[11px] text-muted-foreground">
                {memories?.length ?? 0}
              </span>
            </div>

            {memoriesLoading ? (
              <Skeleton className="h-24 w-full rounded-lg" />
            ) : !memories || memories.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-7 text-center">
                <p className="text-xs text-muted-foreground">
                  Nothing remembered yet.
                </p>
              </div>
            ) : (
              <ul className="max-h-80 space-y-1.5 overflow-y-auto">
                {memories.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-md border bg-card px-3 py-2.5 text-xs leading-5 transition-colors hover:bg-muted/40"
                  >
                    {m.memory}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
