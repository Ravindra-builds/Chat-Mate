import { tool } from "ai";
import { z } from "zod";
import { saveExplicitMemory } from "@/features/memory/actions";

type SearchResult = { title: string; url: string; snippet: string };

async function searchExa(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) throw new Error("EXA_API_KEY not set");

  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: 5,
      contents: { text: { maxCharacters: 500 } },
    }),
  });

  if (!response.ok) throw new Error(`Exa search failed: ${response.status}`);
  const data = await response.json();

  return (data.results ?? []).map((r: { title: string; url: string; text?: string }) => ({
    title: r.title,
    url: r.url,
    snippet: r.text ?? "",
  }));
}

/** Web search tool backed by Exa. */
export const webSearchTool = tool({
  description:
    "Search the web for current information — news, prices, recent events, " +
    "or anything that may have changed after the model's training cutoff.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
  }),
  execute: async ({ query }) => {
    try {
      return { results: await searchExa(query) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Search failed" };
    }
  },
});

/**
 * Explicit-save tool, scoped to one user per request via closure — mirrors
 * webSearchTool's shape but needs userId, which isn't available inside a
 * static tool definition.
 */
export function createSaveMemoryTool(userId: string) {
  return tool({
    description:
      "Save a specific fact the user explicitly asked you to remember or save for future conversations " +
      "(e.g. 'remember that I prefer TypeScript', 'save this: my birthday is June 9'). " +
      "Only call this when the user clearly asks you to remember/save something — not for casual mentions in passing.",
    inputSchema: z.object({
      fact: z
        .string()
        .describe(
          "The fact to remember, written in third person, e.g. 'User prefers TypeScript over JavaScript.'"
        ),
    }),
    execute: async ({ fact }) => saveExplicitMemory(userId, fact),
  });
}