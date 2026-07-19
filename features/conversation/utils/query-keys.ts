/** TanStack Query key factory for conversations and messages caches. */
export const queryKeys = {
    conversations: {
      all: ["conversations"] as const,
      detail: (id: string) => ["conversations", id] as const,
    },
    messages: {
      byConversation: (conversationId: string) =>
        ["messages", conversationId] as const,
    },
    branches: {
      byConversation: (conversationId: string) =>
        ["branches", conversationId] as const,
    },
    usage: {
      status: ["usage-status"] as const,
    },
  };