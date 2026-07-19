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

    const {
      messages: initialMessages,
      context: initialContext,
    } = await loadChatMessages(id);

  return (
    <ConversationView
      key={id}
      conversationId={id}
      initialMessages={initialMessages}
      initialContext={initialContext}
      initialModel={conversation!.model}
      sourceConversationId={conversation!.forkedFromConversationId}
    />
  )
}

export default page