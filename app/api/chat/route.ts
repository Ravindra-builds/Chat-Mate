import {
  loadChatMessages,
  saveChatMessages,
} from "@/features/ai/actions/chat-store";
import { DEFAULT_CHAT_MODEL, getChatModel } from "@/features/ai/utils/model";
import { webSearchTool } from "@/features/ai/utils/tools";
import { requireUser } from "@/features/auth/action/require-user";
import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";

/**
 * POST /api/chat — Streams an AI assistant reply for a conversation.
 *
 * Validates auth and ownership, persists the user message onto the active
 * branch, then streams the assistant response via the AI SDK. Supports
 * per-message model selection and an optional web-search tool. Final
 * messages are saved when the stream ends.
 *
 * Branching note: `message` is expected to be the tail of whatever path the
 * client currently has loaded (the active path on a normal send, or a
 * trimmed ancestor path after an edit/regenerate + `setMessages` +
 * `regenerate()` on the client). `parentId` for any newly-created message is
 * inferred server-side from its predecessor in that path — see
 * `saveChatMessages`.
 *
 * Forking note: if this conversation was forked off another one, its own
 * saved path (`ownMessages`) never includes the inherited ancestor
 * messages — those live under a different conversationId and are re-fetched
 * as `context` on every request instead. `context` is merged in only for
 * the model call, not for `originalMessages`/persistence, so we never
 * re-write rows that belong to the source conversation.
 */
export async function POST(req: Request) {
  await auth.protect();

  const {
    message,
    id,
    model,
    webSearch,
  }: {
    message: UIMessage;
    id: string;
    model?: string;
    webSearch?: boolean;
  } = await req.json();

  if (!message || !id) {
    return new Response("Missing message or conversation id", { status: 400 });
  }

  const user = await requireUser();

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id },
  });

  if (!conversation) {
    return new Response("Conversation not found", { status: 404 });
  }

  const modelId = model || conversation.model || DEFAULT_CHAT_MODEL;

  // Persist the model choice so a page refresh keeps using the same one.
  if (model && model !== conversation.model) {
    await prisma.conversation.update({
      where: { id },
      data: { model },
    });
  }

  const { messages: previousMessages, context } = await loadChatMessages(id);

  const alreadySaved = previousMessages.some(
    (storedMessage) => storedMessage.id === message.id,
  );

  const ownMessages = alreadySaved
    ? previousMessages
    : [...previousMessages, message];

  if (!alreadySaved) {
    // Save the whole *own* path (not just `[message]`) so the new message's
    // parentId can be inferred from its predecessor. Existing messages in
    // `ownMessages` are no-op content updates. `context` (inherited from a
    // fork source, if any) is deliberately excluded — it's not this
    // conversation's data to rewrite.
    await saveChatMessages(id, ownMessages);
  }

   const convoSystemPrompt ="You are ChatMate , a helpful assistant You have a web_search tool — use it whenever the question needs current information (news, prices, recent events, anything that may have changed since your training) or you're not confident in your knowledge. Don't guess when you can check. Format responses in markdown: use headers for structure in longer answers, bullet or numbered lists for steps/options, tables for comparisons, fenced code blocks with a language tag for any code, and LaTeX ($...$ or $$...$$) for math. Use mermaid diagrams (```mermaid) when explaining flows, architectures, or relationships that are easier to see than read.";
  const result = streamText({
    model: getChatModel(modelId),
    system:
      conversation.systemPrompt ?? convoSystemPrompt,
    // Inherited fork context goes in here so the model keeps continuity —
    // but only here, never into `originalMessages` below.
    messages: await convertToModelMessages([...context, ...ownMessages]),
    tools: {search_web: webSearchTool, },
    stopWhen: stepCountIs(5),
    prepareStep: ({ stepNumber }) => {
       // Only force a search on the very first step when the toggle is on.
       // Every step after that is left to "auto" so the model can stop
       // and write its final answer instead of being forced to search again.
       if (webSearch && stepNumber === 0) {
         return { toolChoice: { type: "tool", toolName: "search_web" } };
       }
       return { toolChoice: "auto" };
     },
  });

  result.consumeStream();

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: ownMessages,
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      onEnd: async ({ messages: finalMessages }) => {
        try {
          await saveChatMessages(id, finalMessages, { updateTitle: false });
        } catch (error) {
          console.error(error);
        }
      },
    }),
  });
}