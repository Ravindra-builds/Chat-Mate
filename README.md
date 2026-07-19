<p align="center">
  <img src="public/logo.png" alt="ChatMate logo" width="96" />
</p>
# ChatMate

ChatMate is a self-hosted GPT-style chat app built on Next.js. It's not just a chat wrapper around a model — it does two things most clones skip: it lets the model **search the web mid-answer** when it needs current information, and it treats conversation history as an actual **tree**, so you can edit or regenerate any message without losing what was there before, and even split a message off into a **brand-new, independent conversation**.

> Live demo: **chat-mate-jade-one.vercel.app**
> Repo: **https://github.com/Ravindra-builds/Chat-Mate**

---

## Table of contents

- [What it does](#what-it-does)
- [Tech stack](#tech-stack)
- [How it's built](#how-its-built)
  - [Tool calling (web search)](#tool-calling-web-search)
  - [Chat branching](#chat-branching)
  - [Conversation forking](#conversation-forking)
  - [Rate limiting & cost control](#rate-limiting--cost-control)
- [Folder structure](#folder-structure)
- [Data model](#data-model)
- [Running it locally](#running-it-locally)
- [Environment variables](#environment-variables)
- [Using the app](#using-the-app)
- [Deployment](#deployment)
- [Requirements checklist](#requirements-checklist)
- [Known limitations](#known-limitations)

---

## What it does

- Chat with **OpenAI (GPT-4o, GPT-4o mini, GPT-4.1)** or **Google (Gemini 2.0/2.5/3.1)** models, switchable per message.
- The model can **decide on its own** to search the web (via Exa) when a question needs current information, and streams both the search step and the final answer live.
- Every message can be **edited** or **regenerated** — instead of overwriting history, this creates a sibling branch, so you can navigate back and forth between versions with previous/next arrows, exactly like ChatGPT.
- Any message — yours or the model's — can be **forked into a brand-new conversation**. The new chat keeps the history up to that point (read-only, for context) and grows independently from there, without duplicating a single row in the database.
- Auth via Clerk, persistence via Postgres/Prisma, streaming via the Vercel AI SDK.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, React 19, Server Actions) |
| Language | TypeScript |
| Styling / UI | Tailwind CSS v4, shadcn/ui, @base-ui/react |
| AI orchestration | Vercel AI SDK (`ai`, `@ai-sdk/react`) |
| Model providers | OpenAI (`@ai-sdk/openai`), Google Gemini (`@ai-sdk/google`) |
| Web search tool | [Exa](https://exa.ai) API |
| Database | PostgreSQL |
| ORM | Prisma 7 (with `@prisma/adapter-pg`) |
| Auth | Clerk |
| Server state | TanStack Query |
| Markdown / code rendering | Streamdown (+ math, mermaid, code, CJK plugins) |

---

## How it's built

### Tool calling (web search)

The model isn't given search results up front — it's given a **tool** and decides for itself, per turn, whether it needs to use it.

```
app/api/chat/route.ts        → streams the whole turn, tool calls included
features/ai/utils/tools.ts   → the web_search tool definition (Exa-backed)
features/ai/utils/model.ts   → resolves "provider:model" → an AI SDK model instance
```

- `webSearchTool` (`features/ai/utils/tools.ts`) is registered as `search_web` in `streamText(...)`. It's a plain AI SDK `tool()`: a Zod input schema (`{ query: string }`) and an `execute` that calls Exa's `/search` endpoint and returns `{ results }` or `{ error }` — errors are caught and returned as data, never thrown, so a failed search degrades gracefully instead of killing the stream.
- The model chooses when to call it. There's one exception: when the user has the "web search" toggle on in the composer, the **first** step of that turn is forced to call `search_web` (`toolChoice: { type: "tool", toolName: "search_web" }`); every step after that is left as `"auto"` so the model can stop and just answer instead of being forced to search again on a multi-step tool loop.
- Everything streams through **one** `toUIMessageStream` — tool-call start, tool-call result, and the model's text all arrive over the same connection, in order, so the client never has to guess what state it's in.
- On the client (`features/conversation/components/chat-messages.tsx`), the tool part renders its own live state machine: a "Searching for '…'" indicator while the call is in flight, then a collapsible source list once results land, or a quiet inline error if it failed — the user watches the search happen instead of getting a black box.
- Tool calls and their results are **persisted**, not just streamed and discarded — they're stored as part of the assistant message's `parts` JSON column (`Message.parts`) exactly as the AI SDK represents them, so reopening a conversation later re-renders the same "it searched for X, found Y" trail, not just the final text.

### Chat branching

Every message is a node in a tree, not an entry in a flat list.

```
Message.parentId       → which message this replied to
Message.activeChildId  → which of this message's children is "on screen" right now
Conversation.activeRootId → which top-level message starts the visible thread
```

Loading a conversation means walking `activeRootId → activeChildId → activeChildId → …` (`loadChatMessages` in `features/ai/actions/chat-store.ts`) rather than just selecting all rows and hoping they're in order. Every message on that walk also gets its sibling group computed in the same query, so the UI knows instantly whether branch arrows are needed.

- **Edit a message** (pencil icon) → creates a new sibling with the same `parentId`, repoints `activeChildId`, and triggers a fresh model response for that branch. The original is untouched — it's just not the active sibling anymore.
- **Regenerate a reply** (⋯ menu) → same idea, but for assistant messages: the old reply becomes an inactive sibling, a new one is generated in its place.
- **Branch navigation** — any message with more than one sibling shows `‹ 2/3 ›` arrows (`branch-nav.tsx`); clicking switches `activeChildId` at that fork and reloads the path from there down.
- All of this lives in `features/ai/actions/branch.actions.ts` (`editMessage`, `regenerateMessage`, `setActiveChild`) and is **fully persisted** — refreshing the page shows the same branch you were on, because "which branch is active" is a real column, not client state.
- Deleting/renaming/pinning conversations is handled in `features/conversation/actions/conversation.actions.ts` and exposed through React Query hooks in `use-conversation.ts`.

### Conversation forking

Beyond branching *within* a conversation, any message can be split off into its **own conversation** — useful when a thread goes in two genuinely different directions and you don't want them tangled in the same sidebar entry.

- Forking doesn't copy anything. The new conversation just stores a pointer — `forkedFromMessageId` — at the message it was split from, which can (and usually does) live in a completely different `Conversation` row.
- Opening the new conversation walks that pointer **upward** to rebuild the inherited history for display (rendered read-only, dimmed, above the new conversation's own messages) and for the model's context window — but nothing is duplicated in the database. The old messages stay owned by the original conversation.
- The moment you send a message in the forked conversation, it becomes a real row with its own `conversationId`, parented onto the fork point — from there it grows independently, like any other conversation.
- Because nothing is copied, deleting the *original* conversation while a fork still depends on it would otherwise cascade-delete history the fork needs. So deleting a conversation with live forks **hides** it instead (`isDeleted`) rather than removing it — it drops out of the sidebar, but nothing is lost. Once the last fork depending on it is itself deleted, the hidden original is automatically cleaned up too.

### Rate limiting & cost control

Every LLM call costs real money, so the chat endpoint is guarded on three independent layers before a request ever reaches a model provider.

- **Daily quota per provider** — not per model. Switching between `gpt-4o` and `gpt-4.1` still draws from the same OpenAI bucket, so there's no dodging the cap by hopping models. Enforced with a rolling 24h sliding window (`@upstash/ratelimit`), not a fixed calendar-day reset, so the count is always "N requests in the trailing 24 hours." Limits are env-configurable (`RATE_LIMIT_OPENAI_PER_DAY`, `RATE_LIMIT_GOOGLE_PER_DAY`) rather than hardcoded.
- **Output token cap** (`maxOutputTokens: 2048` in `streamText`) bounds the cost of any single request regardless of what the prompt asks for — a hard backstop behind the system-prompt guidance below.
- **System prompt hardening** — a short addendum, always appended even when a conversation has a custom `systemPrompt`, that (1) treats anything inside a user message, uploaded file, or web search result as data rather than instructions, so it can't be used to override the model's behavior, and (2) tells the model to build incrementally instead of dumping an entire multi-file project in one reply, which is the main way a single request could otherwise burn the whole token budget.
- **Usage is checked, not just enforced** — `getRateLimitStatus` reads the current count via Upstash's non-consuming `getRemaining`, so the sidebar can show `OpenAI 3/10` / `Google 7/20` without spending one of the user's own requests just to display it.
- **Friendly failure, not a broken stream** — a rate-limited request returns a plain-text `429` before any DB write or model call happens (nothing gets persisted on a blocked request), and errors thrown mid-stream (provider outage, etc.) are unmasked via `toUIMessageStream`'s `onError` so the user sees an actual message instead of the SDK's default "An error occurred."
---

## Folder structure

```
app/
  (auth)/sign-in/[[...sign-in]]/   Clerk sign-in page
  (root)/                          authenticated shell
    page.tsx                       "new chat" landing page
    c/[id]/page.tsx                a single conversation (loads messages + context server-side)
  api/chat/route.ts                POST endpoint that streams a turn (model + tools)
  layout.tsx                       root layout, providers

components/
  ai-elements/                     chat-specific building blocks (Message, Conversation, Loader, PromptInput)
  ui/                              shadcn/ui primitives (Button, DropdownMenu, Textarea, Sidebar, …)
  providers/                       ThemeProvider, QueryClientProvider

features/
  ai/
    actions/
      chat-store.ts                loadChatMessages / saveChatMessages — the tree-walking core
      branch.actions.ts            editMessage / regenerateMessage / setActiveChild
    utils/
      model.ts                     model registry + "provider:model" → AI SDK model
      tools.ts                     the Exa-backed web_search tool
      message-parts.ts             UIMessage <-> DB parts conversions
  auth/
    action/require-user.ts         session -> Prisma User (throws if not onboarded)
    action/onboard.ts               upserts a Clerk user into the local User table
  conversation/
    actions/conversation.actions.ts  CRUD + fork + guarded delete
    components/                    ConversationView, ChatMessages, ChatComposer, BranchNav, AppSidebar, …
    hooks/                         useConversations, useBranches, useForkConversation, …
    utils/query-keys.ts            centralized React Query key factory
  home/actions/start-new-chat.ts   reuses an empty "New Chat" instead of spawning duplicates

prisma/
  schema.prisma                    User / Conversation / Message models
  migrations/                      SQL migration history

lib/
  db.ts                            Prisma client singleton
  generated/prisma/                generated Prisma client (not hand-edited)
```

The `features/*` split is deliberate: each feature owns its server actions, hooks, and components together, instead of one global `actions/` folder and one global `components/` folder. `app/` stays thin — pages fetch initial data and hand it to a feature component; almost no logic lives in `app/` itself.

---

## Data model

```
User
 └─ Conversation (many)
     ├─ isPinned / isArchived / isDeleted   (isDeleted = hidden-but-not-destroyed, see forking)
     ├─ model / systemPrompt                (per-conversation override)
     ├─ activeRootId ───────────┐
     ├─ forkedFromConversationId│  (nullable — set only for forked conversations)
     ├─ forkedFromMessageId     │  (nullable — the exact message it forked from)
     │                          ▼
     └─ Message (many)     ← activeRootId points here
         ├─ parentId              (nullable self-reference — the tree edge)
         ├─ activeChildId         (nullable self-reference — "which child is active")
         ├─ role (USER/ASSISTANT/SYSTEM/TOOL)
         ├─ status (PENDING/COMPLETE/ERROR)
         ├─ content (plain text, for search/preview)
         └─ parts (JSON — the full AI SDK UIMessage parts array: text, tool calls, tool results)
```

Two self-references on `Message` (`parentId`, `activeChildId`) are what make branching possible without a separate "branches" table: the tree *is* the message table, and "which branch is currently showing" is just a pointer, not a stored path.

`forkedFromMessageId` is **not** scoped to the same conversation — that's what lets a forked conversation's tree hang off a message that belongs to a different `Conversation` row, without copying it.

---

## Running it locally

### Prerequisites

- Node.js 20+
- A PostgreSQL database (local, or a free one from [Neon](https://neon.tech) / [Supabase](https://supabase.com))
- A [Clerk](https://clerk.com) application (free tier is fine)
- An [OpenAI](https://platform.openai.com) and/or [Google AI Studio](https://aistudio.google.com) API key
- An [Exa](https://exa.ai) API key (for web search)

### Steps

```bash
# 1. Clone
git clone https://github.com/Ravindra-builds/Chat-Mate
cd chatmate

# 2. Install
npm install
# or pnpm install / yarn install

# 3. Configure environment
cp sample.env .env
# then fill in every value — see "Environment variables" below

# 4. Set up the database
npx prisma migrate dev
npx prisma generate

# 5. Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to Clerk sign-in; once signed in, ChatMate creates your `User` row automatically on first load.

### Other scripts

```bash
npm run build   # production build (also type-checks)
npm run start   # run the production build
npm run lint    # eslint
```

---

## Environment variables

All of these are in `sample.env` — copy it to `.env` and fill each one in.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ✅ | Clerk client key |
| `CLERK_SECRET_KEY` | ✅ | Clerk server key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | ✅ | Defaults to `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | ✅ | Defaults to `/` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | ✅ | Defaults to `/` |
| `OPENAI_API_KEY` | Needed for OpenAI models | Powers GPT-4o / GPT-4o mini / GPT-4.1 |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Needed for Gemini models | Powers Gemini 2.0/2.5/3.1 |
| `EXA_API_KEY` | ✅ | Backs the `web_search` tool |
| `UPSTASH_REDIS_REST_URL` | ✅ | Backs the daily rate limiter |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Backs the daily rate limiter |
| `RATE_LIMIT_OPENAI_PER_DAY` | Optional (default `10`) | Daily request cap for OpenAI models |
| `RATE_LIMIT_GOOGLE_PER_DAY` | Optional (default `20`) | Daily request cap for Google models |

You don't strictly need both `OPENAI_API_KEY` and `GOOGLE_GENERATIVE_AI_API_KEY` — just whichever provider(s) you want selectable in the model dropdown. If a key for the currently-selected provider is missing, that model will error at request time rather than at startup.

---

## Using the app

- **Start a chat** from the sidebar — it reuses an existing empty "New Chat" instead of piling up blanks.
- **Toggle web search** in the composer to force the model to search before it answers that turn; otherwise it decides on its own whenever a question needs it.
- **Switch models** per-message from the composer's model picker.
- **Edit** any of your own messages (pencil icon on hover / always visible on mobile) — this branches instead of overwriting.
- **Regenerate** any assistant reply, or **fork a new conversation** from any message, via the ⋯ menu (always visible, not hover-gated, so it works the same on touch).
- **Navigate branches** with the `‹ n/N ›` arrows that appear wherever a message has siblings.
- **Track your daily usage** in the sidebar footer — shows requests used per provider (e.g. `OpenAI 3/10`), so you know before you hit the limit.
- **Rename / pin / archive / delete** conversations from the sidebar's `⋯` menu. Deleting a conversation that has an active fork hides it instead of destroying it — see [Conversation forking](#conversation-forking).

---

## Deployment

Deployed on **[Vercel / your platform — fill in]**.

1. Push to GitHub, import the repo into Vercel (or your platform of choice).
2. Add every variable from [Environment variables](#environment-variables) to the project's environment settings.
3. Point `DATABASE_URL` at a reachable Postgres instance (Neon/Supabase both work well with serverless deploys).
4. Run `npx prisma migrate deploy` against that database before (or as part of) your first deploy — `migrate dev` is for local development only.
5. Add your deployment's URL to Clerk's allowed origins/redirect URLs in the Clerk dashboard.

---

## Requirements checklist

**Phase 1 — Tool calling**
| Requirement | Where |
|---|---|
| Web search tool integrated | `features/ai/utils/tools.ts` (Exa) |
| Model decides when to call it | `streamText({ tools: { search_web }, ... })`, `toolChoice: "auto"` in `app/api/chat/route.ts` |
| Streamed tool execution + final answer | single `toUIMessageStream` in `app/api/chat/route.ts`; live states in `chat-messages.tsx` |
| Tool calls/results persisted | stored in `Message.parts` via `saveChatMessages` |
| Loading / error states | in-flight "Searching…" indicator, inline error state, `try/catch` around the Exa call itself |

**Phase 2 — Chat branching**
| Requirement | Where |
|---|---|
| Branch from any message | `editMessage` / `regenerateMessage` (`"branch"` mode), `forkConversation` |
| View/switch branches | `BranchNav` component + `setActiveChild` |
| Persist branch history | `Message.parentId` / `activeChildId` / `Conversation.activeRootId` — all real DB columns |
| Rename/delete | `updateConversation` / `deleteConversation` (fork-aware guard) |
| Clean branch nav UI | hover-revealed on desktop, always-visible on mobile; `‹ n/N ›` arrows only render when there's something to navigate |

**Phase 3 — Rate limiting & cost control**
| Requirement | Where |
|---|---|
| Per-provider daily limit | `features/ai/utils/rate-limit.ts` (Upstash sliding window) |
| Configurable, not hardcoded | `RATE_LIMIT_OPENAI_PER_DAY` / `RATE_LIMIT_GOOGLE_PER_DAY` env vars |
| Output token cap | `maxOutputTokens: 2048` in `app/api/chat/route.ts` |
| Prompt-injection / jailbreak resistance | safety addendum in `app/api/chat/route.ts`, always appended regardless of custom `systemPrompt` |
| Usage visible to the user | `usage-status.tsx` sidebar widget, `usage.actions.ts` |
| Graceful failure | plain-text `429` pre-stream, `onError` for mid-stream failures |

---