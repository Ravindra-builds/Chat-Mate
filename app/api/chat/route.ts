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
 * Validates auth and ownership, persists the user message, then streams the
 * assistant response via the AI SDK. Supports per-message model selection
 * and an optional web-search tool. Final messages are saved when the stream ends.
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

  const previousMessages = await loadChatMessages(id);

  const alreadySaved = previousMessages.some(
    (storedMessage) => storedMessage.id === message.id,
  );

  const messages = alreadySaved
    ? previousMessages
    : [...previousMessages, message];

  if (!alreadySaved) {
    await saveChatMessages(id, [message]);
  }

  const result = streamText({
    model: getChatModel(modelId),
    system:
      conversation.systemPrompt ??
      "You are ChatMate , a helpful assistant You have a web_search tool — use it whenever the question needs current information (news, prices, recent events, anything that may have changed since your training) or you're not confident in your knowledge. Don't guess when you can check.",
    messages: await convertToModelMessages(messages),
    tools: { web_search: webSearchTool },
    toolChoice: webSearch ? { type: "tool", toolName: "web_search" } : "auto",
    stopWhen: stepCountIs(5),
  });

  result.consumeStream();

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
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
