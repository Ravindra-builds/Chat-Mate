import { tool } from "ai";
import { z } from "zod";

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