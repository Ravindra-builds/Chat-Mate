"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listMyMemories, addMemoryManuallyForCurrentUser } from "@/features/memory/actions";
import { queryKeys } from "@/features/conversation/utils/query-keys";

export function useMemories() {
  return useQuery({
    queryKey: queryKeys.memory.all,
    queryFn: () => listMyMemories(),
  });
}

export function useAddMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (fact: string) => addMemoryManuallyForCurrentUser(fact),
    onSuccess: (result) => {
      if (result.saved) {
        toast.success("Saved to memory");
        void queryClient.invalidateQueries({ queryKey: queryKeys.memory.all });
      } else {
        toast.error(result.reason ?? "Could not save memory");
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not save memory");
    },
  });
}