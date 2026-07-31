"use client";

import { MessageSquareIcon } from "lucide-react";
import { useUser } from "@clerk/nextjs";
import {  useState } from "react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/** People often put their full name in the "first name" field — only use the first token. */
function firstNameOnly(name?: string | null) {
  return name?.trim().split(" ")[0] || null;
}

function timeGreeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Empty-state placeholder shown before the first message is sent. */
export function ChatEmpty() {
  const { user } = useUser();
  
  // Initialize state directly using a function so it computes once on mount
  const [greetingPrefix] = useState(() => timeGreeting(new Date().getHours()));

  const firstName = firstNameOnly(user?.firstName);

// custom fallback if the name doesn't exist
const greeting = firstName 
  ? `${greetingPrefix}, ${firstName}` 
  : "What's on your mind?";
  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageSquareIcon />
          </EmptyMedia>
          <EmptyTitle className="text-2xl tracking-tight">
            {greeting}
          </EmptyTitle>
          <EmptyDescription>
            Ask anything — replies stream in real time.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}