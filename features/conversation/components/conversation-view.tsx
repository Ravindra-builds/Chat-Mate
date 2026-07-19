"use client";
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useQueryClient } from '@tanstack/react-query';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useChat } from "@ai-sdk/react"
import React, { useMemo, useState } from 'react'
import { useConversations, useForkConversation } from '../hooks/use-conversation';
import { useBranches } from '../hooks/use-branches';
import { editMessage, regenerateMessage, setActiveChild } from '@/features/ai/actions/branch.actions';
import { queryKeys } from '../utils/query-keys';
import { toast } from 'sonner';
import { ChatEmpty } from './chat-empty';
import { ChatMessages } from './chat-messages';
import { ChatComposer } from './chat-composer';
import { DEFAULT_CHAT_MODEL } from '@/features/ai/utils/model';

type ConversationViewProps = {
    conversationId: string;
    initialMessages: UIMessage[];
    /** Read-only ancestor messages inherited from a forked-from conversation, if any. */
    initialContext?: UIMessage[];
    initialModel?: string | null;
    /** Set when this conversation was created via "Make new branch". */
    sourceConversationId?: string | null;
};

/**
 * Main chat view — header, message list (or empty state), and composer with streaming.
 */
export const ConversationView = ({
    conversationId,
    initialMessages,
    initialContext,
    initialModel,
    sourceConversationId,
}: ConversationViewProps) => {
    const queryClient = useQueryClient();
    const { data: conversations } = useConversations();
    const { data: branches } = useBranches(conversationId);
    const forkConversation = useForkConversation();
    const [model, setModel] = useState(initialModel || DEFAULT_CHAT_MODEL);
    const [webSearch, setWebSearch] = useState(false);
    // Guards every mutation that touches the message tree — switching a
    // branch, editing a message, or regenerating a reply. All three end the
    // same way (setMessages + a branches cache update), so they share one
    // busy flag to avoid overlapping round-trips.
    const [isBranchBusy, setIsBranchBusy] = useState(false);

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

    const { messages, sendMessage, setMessages, status, regenerate } = useChat({
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

    // True while a turn is actively being requested/streamed — used to keep
    // edit/regenerate/branch-switch from firing on top of an in-flight turn.
    const isStreaming = status === "streaming" || status === "submitted";

    const handleSwitchBranch = async (parentId: string | null, childId: string) => {
        if (isBranchBusy) return;
        setIsBranchBusy(true);
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
            setIsBranchBusy(false);
        }
    };

    /**
     * Edits a user message as a new sibling branch, loads the trimmed
     * ancestor path, then asks `useChat` to regenerate against it — the
     * transport always sends `messages.at(-1)`, so this produces the same
     * request a fresh `sendMessage` would, just for the edited branch.
     */
    const handleEditMessage = async (messageId: string, content: string) => {
        if (isBranchBusy || isStreaming) return false;
        setIsBranchBusy(true);
        try {
            const result = await editMessage(messageId, content, "branch");
            setMessages(result.messages);
            queryClient.setQueryData(
                queryKeys.branches.byConversation(conversationId),
                result.branches
            );
            await regenerate();
            return true;
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Could not edit message"
            );
            return false;
        } finally {
            setIsBranchBusy(false);
        }
    };

    /** Regenerates an assistant reply as a new sibling branch at that fork. */
    const handleRegenerateMessage = async (messageId: string) => {
        if (isBranchBusy || isStreaming) return false;
        setIsBranchBusy(true);
        try {
            const result = await regenerateMessage(messageId, "branch");
            setMessages(result.messages);
            queryClient.setQueryData(
                queryKeys.branches.byConversation(conversationId),
                result.branches
            );
            await regenerate();
            return true;
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Could not regenerate response"
            );
            return false;
        } finally {
            setIsBranchBusy(false);
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
                <SidebarTrigger />
                <Separator orientation="vertical" className="mx-1 h-4" />
                <h1 className="truncate text-sm font-medium">{title}</h1>
            </header>

            {messages.length === 0 && (!initialContext || initialContext.length === 0) ? (
                <ChatEmpty />
            ) : (
                <ChatMessages
                    messages={messages}
                    status={status}
                    branches={branches}
                    context={initialContext}
                    sourceConversationId={sourceConversationId}
                    onSwitchBranch={handleSwitchBranch}
                    onEditMessage={handleEditMessage}
                    onRegenerateMessage={handleRegenerateMessage}
                    onForkConversation={(messageId) => forkConversation.mutate(messageId)}
                    isForking={forkConversation.isPending}
                    isBranchBusy={isBranchBusy || isStreaming}
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