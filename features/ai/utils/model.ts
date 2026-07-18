import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";

export type ModelOption = {
  id: string; // stored verbatim in Conversation.model, e.g. "openai:gpt-4o-mini"
  label: string;
  provider: "openai" | "google";
};

export const MODEL_OPTIONS: ModelOption[] = [
  { id: "openai:gpt-4o-mini", label: "GPT-4o mini", provider: "openai" },
  { id: "openai:gpt-4o", label: "GPT-4o", provider: "openai" },
  { id: "openai:gpt-4.1", label: "GPT-4.1", provider: "openai" },
  { id: "google:gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "google" },
  { id: "google:gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google" },
];

/** Default OpenAI model used when a conversation has no override. */
export const DEFAULT_CHAT_MODEL = MODEL_OPTIONS[0].id;

/**
 * Resolves a "<provider>:<model>" id into an AI SDK language model instance.
 * Falls back to {@link DEFAULT_CHAT_MODEL} for unknown/missing ids.
 */
export function getChatModel(modelId?: string | null) {
  const id = isKnownModel(modelId) ? modelId : DEFAULT_CHAT_MODEL;
  const [provider, ...rest] = id.split(":");
  const modelName = rest.join(":");

  switch (provider) {
    case "google":
      return google(modelName);
    case "openai":
    default:
      return openai(modelName);
  }
}

export function isKnownModel(id?: string | null): id is string {
  return !!id && MODEL_OPTIONS.some((m) => m.id === id);
}