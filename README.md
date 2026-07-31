<div align="center">

<img src="public/logo.png" alt="ChatMate logo" width="96" />

# ChatMate

**A self-hosted, GPT-style chat app with live web search and a real conversation *tree*.**

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io)
[![Postgres](https://img.shields.io/badge/PostgreSQL-DB-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Vercel AI SDK](https://img.shields.io/badge/Vercel_AI_SDK-v7-black?logo=vercel)](https://sdk.vercel.ai)
[![License](https://img.shields.io/badge/license-TBD-lightgrey)](#license)

[**Live Demo**](https://chat-mate-jade-one.vercel.app) · [**Repo**](https://github.com/Ravindra-builds/Chat-Mate)

</div>

---

Most GPT clones are just a chat window bolted onto an API call. ChatMate does two things most clones skip:

1. **The model can search the web mid-answer** when it needs current information — you watch it happen, live.
2. **Conversation history is a real tree**, not a flat log — edit or regenerate any message without losing what was there before, and split any message off into its own independent conversation.

---

## Table of Contents

- [What it does](#what-it-does)
- [Tech stack](#tech-stack)
- [How it's built](#how-its-built)
  - [Tool calling (web search)](#tool-calling-web-search)
  - [Chat branching](#chat-branching)
  - [Conversation forking](#conversation-forking)
  - [Rate limiting & cost control](#rate-limiting--cost-control)
- [Folder structure](#folder-structure)
- [Data model](#data-model)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Using the app](#using-the-app)
- [Deployment](#deployment)
- [Requirements checklist](#requirements-checklist)
- [Known limitations](#known-limitations)
- [License](#license)

---

## What it does

| | |
|---|---|
| 🤖 **Multi-provider chat** | OpenAI (GPT-4o, GPT-4o mini, GPT-4.1) and Google (Gemini 2.0 / 2.5 / 3.1), switchable per message |
| 🔎 **Autonomous web search** | The model decides *for itself* when a question needs current information, then streams the search step and the final answer live |
| 🌳 **True branching** | Editing or regenerating a message creates a sibling branch — nothing is overwritten, and you can navigate between versions with `‹ prev / next ›` arrows |
| 🍴 **Conversation forking** | Split any message — yours or the model's — into a brand-new, independent conversation with zero duplicated rows |
| 🔐 **Auth & persistence** | Clerk for auth, Postgres/Prisma for storage, the Vercel AI SDK for streaming |

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, React 19, Server Actions) |
| Language | TypeScript |
| Styling / UI | Tailwind CSS v4, shadcn/ui, `@base-ui/react` |
| AI orchestration | Vercel AI SDK (`ai`, `@ai-sdk/react`) |
| Model providers | OpenAI (`@ai-sdk/openai`), Google Gemini (`@ai-sdk/google`) |
| Web search | [Exa](https://exa.ai) API |
| Database | PostgreSQL |
| ORM | Prisma 7 (`@prisma/adapter-pg`) |
| Auth | Clerk |
| Server state | TanStack Query |
| Markdown / code rendering | Streamdown (+ math, mermaid, code, CJK plugins) |
| Rate limiting | Upstash Redis (sliding window) |

---

## How it's built

### Tool calling (web search)

The model isn't handed search results up front — it's given a **tool** and decides for itself, per turn, whether it needs to use it.

```
app/api/chat/route.ts        → streams the whole turn, tool calls included
features/ai/utils/tools.ts   → the web_search tool definition (Exa-backed)
features/ai/utils/model.ts   → resolves "provider:model" → an AI SDK model instance
```

- `webSearchTool` is registered as `search_web` inside `streamText(...)`. It's a plain AI SDK `tool()`: a Zod input schema (`{ query: string }`) and an `execute` that calls Exa's `/search` endpoint and returns `{ results }` or `{ error }`. Errors are caught and returned as *data*, never thrown — a failed search degrades gracefully instead of killing the stream.
- The model chooses when to call it, with one exception: when the "web search" toggle is on in the composer, the **first** step of that turn is forced to call `search_web`; every step after that is left as `"auto"` so the model can stop and answer instead of being forced to search again mid-loop.
- Everything streams through **one** `toUIMessageStream` — tool-call start, tool-call result, and the model's text all arrive over the same connection, in order.
- On the client (`chat-messages.tsx`), the tool part renders its own live state machine: a "Searching for '…'" indicator while in flight, a collapsible source list once results land, or a quiet inline error if it failed.
- Tool calls and results are **persisted**, not just streamed and discarded — stored in the assistant message's `parts` JSON column exactly as the AI SDK represents them, so reopening a conversation later re-renders the same search trail.

### Chat branching

Every message is a node in a tree, not an entry in a flat list.

```
Message.parentId          → which message this replied to
Message.activeChildId     → which of this message's children is "on screen" right now
Conversation.activeRootId → which top-level message starts the visible thread
```

Loading a conversation means walking `activeRootId → activeChildId → activeChildId → …` (`loadChatMessages` in `chat-store.ts`) rather than selecting all rows and hoping they're in order. Every message on that walk also gets its sibling group computed in the same query, so the UI knows instantly whether branch arrows are needed.

- **Edit a message** (pencil icon) → creates a new sibling with the same `parentId`, repoints `activeChildId`, and triggers a fresh model response for that branch. The original is untouched.
- **Regenerate a reply** (`⋯` menu) → same idea, but for assistant messages: the old reply becomes an inactive sibling, a new one takes its place.
- **Branch navigation** — any message with more than one sibling shows `‹ 2/3 ›` arrows; clicking switches `activeChildId` at that fork and reloads the path from there down.
- All of this lives in `features/ai/actions/branch.actions.ts` (`editMessage`, `regenerateMessage`, `setActiveChild`) and is **fully persisted** — refresh the page and you're still on the same branch, because "which branch is active" is a real column, not client state.

### Conversation forking

Beyond branching *within* a conversation, any message can be split off into its **own conversation** — useful when a thread goes in two genuinely different directions.

- Forking doesn't copy anything. The new conversation stores a single pointer — `forkedFromMessageId` — to the message it split from, which usually lives in a completely different `Conversation` row.
- Opening the fork walks that pointer **upward** to rebuild inherited history for display (rendered read-only, dimmed, above the fork's own messages) and for the model's context — nothing is duplicated in the database.
- The moment you send a message in the fork, it becomes a real row parented onto the fork point, and grows independently from there.
- Deleting the *original* conversation while a live fork depends on it would otherwise cascade-delete history the fork still needs — so it's **hidden** (`isDeleted`) instead of destroyed. It drops out of the sidebar but nothing is lost, and it's cleaned up automatically once the last dependent fork is deleted.

### Rate limiting & cost control

Every LLM call costs real money, so the chat endpoint is guarded on several independent layers before a request reaches a model provider.

- **Daily quota per provider**, not per model — switching between `gpt-4o` and `gpt-4.1` still draws from the same OpenAI bucket. Enforced with a rolling 24h sliding window (`@upstash/ratelimit`), env-configurable via `RATE_LIMIT_OPENAI_PER_DAY` / `RATE_LIMIT_GOOGLE_PER_DAY`.
- **Output token cap** (`maxOutputTokens: 2048`) bounds the cost of any single request regardless of what the prompt asks for.
- **System-prompt hardening** — a short addendum, always appended even over a custom `systemPrompt`, that treats file/search/user content as data rather than instructions, and tells the model to build incrementally instead of dumping an entire project in one reply.
- **Usage is visible, not just enforced** — `getRateLimitStatus` reads the count via Upstash's non-consuming `getRemaining`, so the sidebar shows `OpenAI 3/10` / `Google 7/20` without spending a real request just to display it.
- **Friendly failure** — a rate-limited request returns a plain-text `429` before any DB write or model call happens, and mid-stream errors are unmasked via `onError` instead of the SDK's generic "An error occurred."

---

## Folder structure

```
app/
├─ (auth)/sign-in/[[...sign-in]]/   Clerk sign-in page
├─ (root)/                          authenticated shell
│  ├─ page.tsx                      "new chat" landing page
│  └─ c/[id]/page.tsx               a single conversation
├─ api/chat/route.ts                POST endpoint that streams a turn (model + tools)
└─ layout.tsx                       root layout, providers

components/
├─ ai-elements/                     chat-specific building blocks
├─ ui/                              shadcn/ui primitives
└─ providers/                       Theme + QueryClient providers

features/
├─ ai/
│  ├─ actions/
│  │  ├─ chat-store.ts              loadChatMessages / saveChatMessages — the tree-walking core
│  │  └─ branch.actions.ts          editMessage / regenerateMessage / setActiveChild
│  └─ utils/
│     ├─ model.ts                   model registry + "provider:model" → AI SDK model
│     ├─ tools.ts                   the Exa-backed web_search tool
│     └─ message-parts.ts           UIMessage <-> DB parts conversion
├─ auth/action/                     require-user.ts, onboard.ts
├─ conversation/
│  ├─ actions/conversation.actions.ts  CRUD + fork + guarded delete
│  ├─ components/                   ConversationView, ChatMessages, ChatComposer, BranchNav, AppSidebar
│  └─ hooks/                        useConversations, useBranches, useForkConversation
└─ home/actions/start-new-chat.ts   reuses an empty "New Chat" instead of spawning duplicates

prisma/
├─ schema.prisma                    User / Conversation / Message models
└─ migrations/                      SQL migration history

lib/
├─ db.ts                            Prisma client singleton
└─ generated/prisma/                generated Prisma client (not hand-edited)
```

Each `features/*` folder owns its server actions, hooks, and components together instead of one global `actions/` + one global `components/` folder. `app/` stays thin — pages fetch initial data and hand it to a feature component; almost no logic lives in `app/` itself.

---

## Data model

```
User
└─ Conversation (many)
   ├─ isPinned / isArchived / isDeleted     isDeleted = hidden-but-not-destroyed (see forking)
   ├─ model / systemPrompt                  per-conversation override
   ├─ activeRootId  ────────────────┐
   ├─ forkedFromConversationId      │       nullable — set only on forked conversations
   ├─ forkedFromMessageId           │       nullable — the exact message it forked from
   │                                ▼
   └─ Message (many)            ← activeRootId points here
      ├─ parentId                            nullable self-reference — the tree edge
      ├─ activeChildId                       nullable self-reference — "which child is active"
      ├─ role        USER / ASSISTANT / SYSTEM / TOOL
      ├─ status      PENDING / COMPLETE / ERROR
      ├─ content                             plain text, for search/preview
      └─ parts                               JSON — full AI SDK UIMessage parts array
```

> The two self-references on `Message` (`parentId`, `activeChildId`) are what make branching possible without a separate "branches" table — the tree *is* the message table, and "which branch is showing" is a pointer, not a stored path.
>
> `forkedFromMessageId` is **not** scoped to the same conversation — that's what lets a fork's tree hang off a message that belongs to a different `Conversation` row, without copying it.

---

## Getting started

### Prerequisites

- Node.js 20+
- A PostgreSQL database — local, or free tier from [Neon](https://neon.tech) / [Supabase](https://supabase.com)
- A [Clerk](https://clerk.com) application (free tier is fine)
- An [OpenAI](https://platform.openai.com) and/or [Google AI Studio](https://aistudio.google.com) API key
- An [Exa](https://exa.ai) API key (for web search)

### Setup

```bash
# 1. Clone
git clone https://github.com/Ravindra-builds/Chat-Mate
cd chatmate

# 2. Install
npm install        # or pnpm install / yarn install

# 3. Configure environment
cp sample.env .env
# fill in every value — see Environment variables below

# 4. Set up the database
npx prisma migrate dev
npx prisma generate

# 5. Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to Clerk sign-in — once signed in, ChatMate creates your `User` row automatically on first load.

### Other scripts

| Command | What it does |
|---|---|
| `npm run build` | Production build (also type-checks) |
| `npm run start` | Run the production build |
| `npm run lint`  | ESLint |

---

## Environment variables

All of these live in `sample.env` — copy it to `.env` and fill each one in.

| Variable | Required | Purpose |
|---|:---:|---|
| `DATABASE_URL` | ✅ | Postgres connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | Clerk client key |
| `CLERK_SECRET_KEY` | ✅ | Clerk server key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | ✅ | Defaults to `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | ✅ | Defaults to `/` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | ✅ | Defaults to `/` |
| `OPENAI_API_KEY` | For OpenAI models | Powers GPT-4o / GPT-4o mini / GPT-4.1 |
| `GOOGLE_GENERATIVE_AI_API_KEY` | For Gemini models | Powers Gemini 2.0 / 2.5 / 3.1 |
| `EXA_API_KEY` | ✅ | Backs the `web_search` tool |
| `UPSTASH_REDIS_REST_URL` | ✅ | Backs the daily rate limiter |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Backs the daily rate limiter |
| `RATE_LIMIT_OPENAI_PER_DAY` | Optional (default `10`) | Daily request cap for OpenAI models |
| `RATE_LIMIT_GOOGLE_PER_DAY` | Optional (default `20`) | Daily request cap for Google models |

> You don't need both `OPENAI_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` — just whichever provider(s) you want selectable in the model dropdown. A missing key for the currently-selected provider fails at request time, not at startup.

---

## Using the app

- **Start a chat** from the sidebar — it reuses an existing empty "New Chat" instead of piling up blanks.
- **Toggle web search** in the composer to force a search before that turn's answer; otherwise the model decides on its own.
- **Switch models** per message from the composer's model picker.
- **Edit** any of your own messages (pencil icon on hover, always visible on mobile) — this branches instead of overwriting.
- **Regenerate** any assistant reply, or **fork a new conversation** from any message, via the `⋯` menu (always visible, not hover-gated).
- **Navigate branches** with the `‹ n/N ›` arrows that appear wherever a message has siblings.
- **Track daily usage** in the sidebar footer, e.g. `OpenAI 3/10`, before you hit the limit.
- **Rename / pin / archive / delete** conversations from the sidebar's `⋯` menu. Deleting a conversation with an active fork hides it instead of destroying it — see [Conversation forking](#conversation-forking).

---

## Deployment

1. Push to GitHub and import the repo into [Vercel](https://vercel.com) (or your platform of choice).
2. Add every variable from [Environment variables](#environment-variables) to the project's environment settings.
3. Point `DATABASE_URL` at a reachable Postgres instance — Neon/Supabase both work well with serverless deploys.
4. Run `npx prisma migrate deploy` against that database before (or as part of) your first deploy — `migrate dev` is for local development only.
5. Add your deployment URL to Clerk's allowed origins/redirect URLs in the Clerk dashboard.

---

## Requirements checklist

<details>
<summary><strong>Phase 1 — Tool calling</strong></summary>

| Requirement | Where |
|---|---|
| Web search tool integrated | `features/ai/utils/tools.ts` (Exa) |
| Model decides when to call it | `streamText({ tools: { search_web } })`, `toolChoice: "auto"` |
| Streamed tool execution + final answer | single `toUIMessageStream`; live states in `chat-messages.tsx` |
| Tool calls/results persisted | stored in `Message.parts` via `saveChatMessages` |
| Loading / error states | in-flight indicator, inline error state, `try/catch` around the Exa call |

</details>

<details>
<summary><strong>Phase 2 — Chat branching</strong></summary>

| Requirement | Where |
|---|---|
| Branch from any message | `editMessage` / `regenerateMessage` (`"branch"` mode), `forkConversation` |
| View/switch branches | `BranchNav` component + `setActiveChild` |
| Persist branch history | `Message.parentId` / `activeChildId` / `Conversation.activeRootId` |
| Rename/delete | `updateConversation` / `deleteConversation` (fork-aware guard) |
| Clean branch nav UI | hover-revealed on desktop, always-visible on mobile |

</details>

<details>
<summary><strong>Phase 3 — Rate limiting & cost control</strong></summary>

| Requirement | Where |
|---|---|
| Per-provider daily limit | `features/ai/utils/rate-limit.ts` (Upstash sliding window) |
| Configurable, not hardcoded | `RATE_LIMIT_OPENAI_PER_DAY` / `RATE_LIMIT_GOOGLE_PER_DAY` |
| Output token cap | `maxOutputTokens: 2048` |
| Prompt-injection / jailbreak resistance | safety addendum in `app/api/chat/route.ts` |
| Usage visible to the user | `usage-status.tsx` sidebar widget |
| Graceful failure | plain-text `429` pre-stream, `onError` for mid-stream failures |

</details>

---

## Known limitations
 
- **Two message-persistence paths exist.** The live chat flow (`/api/chat` + `chat-store.ts`) is what's actually rendered. A separate, fully-built CRUD layer (`features/messages/*` — `createMessage`, `updateMessage`, `deleteMessage`, `useMessages`) is **not currently wired into any UI**. Before extending message editing/deletion, decide whether to reuse this layer or remove it.
- **No UI yet** for the per-conversation `model` / `systemPrompt` overrides that already exist in the schema — every conversation currently falls back to the default model and system prompt.
- **Rate limiting currently covers the main chat endpoint only.** Branch, regenerate, and fork actions go through the same auth checks as everything else, but aren't yet metered against the daily quota — planned for a future pass.
- **No automated test suite yet** — changes are currently verified manually; contributions adding test coverage (Vitest/Playwright) are welcome.
---

## License

 MIT 

---

<div align="center">

Built by [Ravindra](https://ravindrayadav.online) · [GitHub](https://github.com/Ravindra-builds) · [Blog](https://rvindra.hashnode.dev)

</div>