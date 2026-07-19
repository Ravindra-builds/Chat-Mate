"use client";
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useQueryClient } from '@tanstack/react-query';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useChat } from "@ai-sdk/react"
import React, { useMemo, useState } from 'react'
import { useConversations } from '../hooks/use-conversation';
import { useBranches } from '../hooks/use-branches';
import { setActiveChild } from '@/features/ai/actions/branch.actions';
import { queryKeys } from '../utils/query-keys';
import { toast } from 'sonner';
import { ChatEmpty } from './chat-empty';
import { ChatMessages } from './chat-messages';
import { ChatComposer } from './chat-composer';
import { DEFAULT_CHAT_MODEL } from '@/features/ai/utils/model';

type ConversationViewProps = {
    conversationId: string;
    initialMessages: UIMessage[];
     initialModel?: string | null;
};

/**
 * Main chat view — header, message list (or empty state), and composer with streaming.
 */
export const ConversationView = ({ conversationId, initialMessages, initialModel }: ConversationViewProps) => {
    const queryClient = useQueryClient();
    const { data: conversations } = useConversations();
    const { data: branches } = useBranches(conversationId);
    const [model, setModel] = useState(initialModel || DEFAULT_CHAT_MODEL);
    const [webSearch, setWebSearch] = useState(false);
    const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);

    const transport = useMemo(() => new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ id, messages, body }) => ({
            body: {
                id,
                message: messages.at(-1),
                ...(body as Record<string, unknown> | undefined),
            }
        })
    }), []);

    const { messages, sendMessage, setMessages, status } = useChat({
        id: conversationId,
        messages: initialMessages,
        transport,
        onFinish: () => {
            void queryClient.invalidateQueries({
                queryKey: queryKeys.conversations.all,
            });
            // A new turn changes activeChildId pointers (and may create a
            // sibling branch during edit/regenerate flows) — refresh nav data.
            void queryClient.invalidateQueries({
                queryKey: queryKeys.branches.byConversation(conversationId),
            });
        },
        onError: (error) => {
            toast.error(error.message);
        },
    })
    const title =
    conversations?.find((item) => item.id === conversationId)?.title ?? "Chat";

    const handleSwitchBranch = async (parentId: string | null, childId: string) => {
        if (isSwitchingBranch) return;
        setIsSwitchingBranch(true);
        try {
            const result = await setActiveChild(parentId, childId);
            setMessages(result.messages);
            queryClient.setQueryData(
                queryKeys.branches.byConversation(conversationId),
                result.branches
            );
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Could not switch branch"
            );
        } finally {
            setIsSwitchingBranch(false);
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
                <SidebarTrigger />
                <Separator orientation="vertical" className="mx-1 h-4" />
                <h1 className="truncate text-sm font-medium">{title}</h1>
            </header>

            {messages.length === 0 ? (
                <ChatEmpty />
            ) : (
                <ChatMessages
                    messages={messages}
                    status={status}
                    branches={branches}
                    onSwitchBranch={handleSwitchBranch}
                    isSwitchingBranch={isSwitchingBranch}
                />
            )}

             <ChatComposer
                status={status}
                model={model}
                onModelChange={setModel}
                webSearch={webSearch}
                onWebSearchChange={setWebSearch}
                onSend={({ text, model, webSearch }) => {
                    void sendMessage({ text }, { body: { model, webSearch } });
                }}
           />
        </div>
    )
}