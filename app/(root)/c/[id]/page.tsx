import { loadChatMessages } from '@/features/ai/actions/chat-store';
import { getConversation } from '@/features/conversation/actions/conversation.actions';
import { ConversationView } from '@/features/conversation/components/conversation-view';
import { notFound } from 'next/navigation';
import React from 'react'

type ConversationPageProps = {
    params: Promise<{ id: string }>;
  };

/**
 * Conversation page — loads the active branch and renders the chat UI for a given ID.
 */
const page = async({params}:ConversationPageProps) => {
    const {id} = await params;

    let conversation: Awaited<ReturnType<typeof getConversation>>;
    try {
      conversation = await getConversation(id);
    } catch (error) {
      notFound();
    }

    // `branches` (sibling metadata per message id) isn't consumed yet — it
    // gets wired into ConversationView / MessageBranch in Step 4.
    const { messages: initialMessages } = await loadChatMessages(id);

  return (
    <ConversationView
      key={id}
      conversationId={id}
      initialMessages={initialMessages}
      initialModel={conversation!.model}
    />
  )
}

export default page