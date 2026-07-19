"use server";

import { requireUser } from "@/features/auth/action/require-user";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

/** Shape of a conversation row returned in the sidebar list. */
export type ConversationListItem = {
    id: string;
    title: string;
    isPinned: boolean;
    isArchived: boolean;
    lastMessageAt: Date;
    createdAt: Date;
    updatedAt: Date;
};


/**
 * Verifies that a conversation exists and belongs to the given user.
 *
 * @throws {Error} When the conversation is not found or not owned by the user.
 */
async function assertOwnsConversation(conversationId: string, userId: string) {
    const conversation = await prisma.conversation.findFirst({
        where: {
            id: conversationId,
            userId
        }
    });

    if (!conversation) {
        throw new Error("Conversation not found")
    }

    return conversation
}

/**
 * Fetches a single conversation owned by the current user.
 *
 * @param conversationId - The conversation to load.
 * @throws {Error} When the conversation is not found.
 */
export async function getConversation(conversationId: string) {
    const user = await requireUser();
    return assertOwnsConversation(conversationId, user.id)
}


/**
 * Lists non-archived, non-hidden conversations for the current user.
 * Pinned conversations appear first, then sorted by most recent activity.
 */
export async function listConversations(): Promise<ConversationListItem[]> {
    const user = await requireUser();

    return prisma.conversation.findMany({
        where: { userId: user.id, isArchived: false, isDeleted: false },
        orderBy: [{ isPinned: "desc" }, { lastMessageAt: "desc" }],
        select: {
            id: true,
            title: true,
            isPinned: true,
            isArchived: true,
            lastMessageAt: true,
            createdAt: true,
            updatedAt: true,
        },
    })
}

/**
 * Creates a new conversation for the current user.
 *
 * @param title - Optional title; defaults to "New Chat".
 */
export async function createConversation(title = "New Chat") {
    const user = await requireUser();

    return prisma.conversation.create({
        data: {
            userId: user.id,
            title: title.trim() || "New Chat",
        },
    });
}

/**
 * Forks a brand-new, independent conversation off of an existing message.
 *
 * The source message is *not* copied — the new conversation's message tree
 * simply hangs its own first message's `parentId` off it once the user
 * sends something (see `saveChatMessages`). Until then, `loadChatMessages`
 * reconstructs the inherited history for display (and for the model) by
 * walking `forkedFromMessageId` upward.
 *
 * This is also why `deleteConversation` refuses to hard-delete a
 * conversation that has forks hanging off it — see below.
 *
 * @param messageId - The message to fork from. Must belong to a conversation owned by the caller.
 * @returns The new conversation's ID.
 */
export async function forkConversation(messageId: string) {
    const user = await requireUser();

    const message = await prisma.message.findUnique({
        where: { id: messageId },
        select: {
            id: true,
            conversationId: true,
            conversation: {
                select: { userId: true, title: true, model: true, systemPrompt: true },
            },
        },
    });

    if (!message || message.conversation.userId !== user.id) {
        throw new Error("Message not found");
    }

    const title = `Branch | from ${message.conversation.title}`.slice(0, 80);

    const forked = await prisma.conversation.create({
        data: {
            userId: user.id,
            title,
            model: message.conversation.model,
            systemPrompt: message.conversation.systemPrompt,
            forkedFromConversationId: message.conversationId,
            forkedFromMessageId: message.id,
        },
    });

    return { id: forked.id };
}

/**
 * Updates conversation metadata (title, pin, or archive status).
 *
 * @param conversationId - The conversation to update.
 * @param data - Fields to change; omitted fields are left unchanged.
 */
export async function updateConversation(
    conversationId: string,
    data: { title?: string; isPinned?: boolean; isArchived?: boolean }
) {
    const user = await requireUser();
    await assertOwnsConversation(conversationId, user.id);

    const conversation = await prisma.conversation.update({
        where: { id: conversationId },
        data: {
            ...(data.title !== undefined ? { title: data.title.trim() || "New Chat" } : {}),
            ...(data.isPinned !== undefined ? { isPinned: data.isPinned } : {}),
            ...(data.isArchived !== undefined ? { isArchived: data.isArchived } : {}),
        },
    });

    revalidatePath("/");
    revalidatePath(`/c/${conversationId}`);
    return conversation;
}



/**
 * Deletes a conversation owned by the current user — permanently, unless
 * another conversation has been forked off one of its messages. In that
 * case a hard delete would cascade through the `Message.parentId` FK chain
 * and destroy history the fork still depends on, so the conversation is
 * hidden (`isDeleted: true`) instead: it drops out of `listConversations`,
 * but every row stays intact in the DB.
 *
 * That hidden conversation isn't stuck forever, though: once its *last*
 * remaining fork is itself deleted, this same function is what deletes
 * *that* fork too, and — since the hidden parent no longer has any forks
 * left — walks up and hard-deletes the parent right after, recursively, all
 * the way up a fork-of-a-fork chain if there is one. A conversation is only
 * ever purged this way if the caller had already tried to delete it
 * directly and it got hidden waiting on that last fork — deleting a fork
 * never reaches back and deletes a source conversation the user hasn't
 * touched.
 *
 * @param conversationId - The conversation to delete.
 * @returns The conversation ID and whether it was hidden instead of deleted.
 */
type DeleteConversationResult = { id: string; hidden: boolean };

export async function deleteConversation(
    conversationId: string
): Promise<DeleteConversationResult> {
    const user = await requireUser();
    await assertOwnsConversation(conversationId, user.id);

    const result = await deleteOrHideConversation(conversationId, user.id);

    revalidatePath("/");
    return result;
}

/**
 * Deletes one conversation (hiding it instead if it still has live forks),
 * then — if it was itself a fork whose source is sitting hidden — checks
 * whether that source is now orphaned of every fork and, if so, recurses
 * upward to finally purge it too. See `deleteConversation` for the
 * user-facing contract; this is split out purely so the upward walk can
 * call itself without re-running the top-level ownership check on every
 * hop (ownership is already guaranteed transitively, since forking only
 * ever happens within one user's own conversations).
 */
async function deleteOrHideConversation(
    conversationId: string,
    userId: string
): Promise<DeleteConversationResult> {
    const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { forkedFromConversationId: true },
    });

    const hasForks = await prisma.conversation.findFirst({
        where: { forkedFromConversationId: conversationId },
        select: { id: true },
    });

    if (hasForks) {
        await prisma.conversation.update({
            where: { id: conversationId },
            data: { isDeleted: true },
        });
        return { id: conversationId, hidden: true };
    }

    await prisma.conversation.delete({
        where: { id: conversationId },
    });

    const sourceId = conversation?.forkedFromConversationId;
    if (sourceId) {
        const source = await prisma.conversation.findUnique({
            where: { id: sourceId },
            select: { id: true, userId: true, isDeleted: true },
        });

        // Only purge the source if the user had already deleted it (it's
        // sitting hidden) — never as a side effect of deleting a fork the
        // user chose to keep the source around for.
        if (source?.isDeleted && source.userId === userId) {
            await deleteOrHideConversation(source.id, userId);
        }
    }

    return { id: conversationId, hidden: false };
}