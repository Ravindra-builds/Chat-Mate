# ChatMate — Codebase Documentation

*(package name: `gpt-clone`, working title in UI: "ChatMate")*

A ChatGPT-style AI chat app built on **Next.js 16 (App Router) + React 19**, using the **Vercel AI SDK v5** for streaming, **Clerk** for auth, **Prisma 7 + PostgreSQL** for persistence, and **shadcn/ui + Tailwind v4** for the interface.

---

## 1. Architecture Overview

ChatMate is a single Next.js application (no separate backend service). It follows a **feature-folder** structure layered on top of the Next.js App Router:

```
app/            → routes, layouts, the one API route
features/       → business logic grouped by domain (server actions + client hooks + components)
components/     → shared/presentational UI (shadcn primitives + ai-elements)
lib/            → cross-cutting singletons (Prisma client, cn() helper)
prisma/         → schema + migrations
```

**Request flow for a chat message:**

```
Browser (ConversationView)
   │  useChat() from @ai-sdk/react
   │  sendMessage({ text })
   ▼
POST /api/chat  (app/api/chat/route.ts)
   │  1. auth.protect() — Clerk session required
   │  2. requireUser() — maps Clerk user → Prisma User
   │  3. verify conversation belongs to user
   │  4. load prior messages, dedupe, persist the new user message
   │  5. streamText() via Vercel AI SDK → OpenAI
   │  6. stream tokens back as a UIMessageStream (SSE-like)
   │  7. onEnd → persist the final assistant message
   ▼
Browser renders streamed tokens live via useChat's `messages` state
```

Two parallel data-access layers exist for messages:
- **`features/ai/actions/chat-store.ts`** — the one actually used by the chat route and the conversation page (`loadChatMessages` / `saveChatMessages`), storing AI-SDK `UIMessage[]` with structured `parts` (JSON) in Postgres.
- **`features/messages/actions/messages.action.ts`** + `features/messages/hooks/use-messages.ts` — a second, fully-built CRUD layer (`listMessages`, `createMessage`, `updateMessage`, `deleteMessage`) that is **not wired into any UI component**. This looks like an earlier or parallel implementation. See §6 (Notes for a New Developer).

**Authentication model:** Clerk middleware (`proxy.ts`) protects every route except `/sign-in`. Inside `app/(root)/layout.tsx`, `auth.protect()` is called again and `onBoard()` upserts the Clerk user into the local `User` table, so a local `userId` always exists before any Prisma-owned data is touched. All server actions call `requireUser()`, which re-derives the Clerk session and looks up the local user — this is the actual authorization boundary (see §7, Security).

---

## 2. Tech Stack

| Concern | Library | Notes |
|---|---|---|
| Framework | Next.js 16.2.10 (App Router), React 19.2.4 | Route groups: `(auth)`, `(root)` |
| Auth | `@clerk/nextjs` ^7.5 | Middleware in `proxy.ts` (Next 16 renamed `middleware.ts` → `proxy.ts`) |
| AI streaming | `ai` (Vercel AI SDK) ^7, `@ai-sdk/openai`, `@ai-sdk/react` | `streamText`, `useChat`, `UIMessage` |
| DB / ORM | Prisma 7 (`prisma-client` generator) + `@prisma/adapter-pg`, PostgreSQL | Client generated to `lib/generated/prisma` (not in this bundle) |
| Client cache | `@tanstack/react-query` v5 | Query-key factory in `features/conversation/utils/query-keys.ts` |
| UI | shadcn/ui ("base-vega" style), Tailwind CSS v4, Radix-style primitives, `lucide-react` icons | `components/ui/*` is generated/vendored, not hand-rolled |
| Chat rendering | `streamdown` + `@streamdown/*` plugins (code, math, mermaid, cjk) | Renders assistant markdown via `MessageResponse` |
| Notifications | `sonner` | Toasts on mutation errors |

---

## 3. Directory Map & Most Important Files to Review First

For a new developer, read in this order:

1. **`prisma/schema.prisma`** — the data model (`User`, `Conversation`, `Message`). Understand this first; everything else revolves around it.
2. **`app/api/chat/route.ts`** — the heart of the app: auth check, ownership check, message persistence, and AI streaming. This is the single most important file.
3. **`features/ai/actions/chat-store.ts`** — how `UIMessage[]` are (de)serialized to/from Postgres.
4. **`features/conversation/components/conversation-view.tsx`** — the client-side counterpart; wires `useChat()` to the API route and renders the thread.
5. **`features/auth/action/require-user.ts`** and **`features/auth/action/onboard.ts`** — the authorization pattern used by every server action.
6. **`features/conversation/actions/conversation.actions.ts`** — CRUD for conversations (list/create/rename/pin/archive/delete), and the `assertOwnsConversation` pattern reused across the codebase.
7. **`app/(root)/layout.tsx`** and **`proxy.ts`** — where auth is enforced at the route level.
8. **`features/conversation/components/app-sidebar.tsx`** — main navigational shell (conversation list, new chat, theme, account).
9. **`lib/db.ts`** — Prisma client singleton pattern (important for Next.js dev hot-reload).

Everything under `components/ui/*` is generated shadcn boilerplate — skim it only when you need to understand a specific primitive's API (e.g., `Sidebar`, `InputGroup`).

### Full structure
```
app/
  (auth)/sign-in/[[...sign-in]]/page.tsx   Clerk <SignIn/> page
  (auth)/sign-in/layout.tsx                centered auth layout
  (root)/layout.tsx                        auth.protect() + onBoard() + <ChatShell>
  (root)/page.tsx                          "/" → creates a chat, redirects to /c/{id}
  (root)/c/[id]/page.tsx                   loads a conversation + its messages
  api/chat/route.ts                        POST — streaming chat endpoint
  layout.tsx                               root HTML shell: Clerk/Query/Theme providers
components/
  ai-elements/                             conversation container, loader, markdown message renderer
  providers/                               React Query + next-themes providers
  ui/                                      shadcn/ui primitives (generated)
features/
  ai/actions/chat-store.ts                 UIMessage <-> Prisma Message mapping
  ai/utils/model.ts                        OpenAI model resolver
  auth/action/{onboard,require-user}.ts    Clerk <-> Prisma user bridge
  conversation/actions/conversation.actions.ts   conversation CRUD (server actions)
  conversation/components/*                sidebar, chat shell, chat view, composer, message list
  conversation/hooks/use-conversation.ts   React Query hooks over conversation actions
  conversation/utils/query-keys.ts         query key factory
  home/actions/start-new-chat.ts           creates conversation for "/"
  messages/actions/messages.action.ts      ⚠ parallel/unused message CRUD (see §6)
  messages/hooks/use-messages.ts           ⚠ unused hooks for the above
hooks/use-mobile.ts                        media-query hook for responsive sidebar
lib/db.ts                                  Prisma client singleton
lib/utils.ts                               cn() Tailwind class merge helper
prisma/schema.prisma, migrations/          data model + SQL migrations
proxy.ts                                   Clerk middleware (Next 16 middleware entrypoint)
```

---

## 4. Data Model (Prisma)

```
User
 ├─ id (cuid), clerkId (unique), email (unique, nullable)
 ├─ firstName, lastName, imageUrl
 └─ conversations: Conversation[]

Conversation
 ├─ id, userId (FK → User, cascade delete)
 ├─ title (default "New Chat")
 ├─ model         — per-conversation OpenAI model override (nullable)
 ├─ systemPrompt  — per-conversation system prompt override (nullable)
 ├─ isPinned, isArchived
 ├─ lastMessageAt — drives sidebar sort order
 └─ messages: Message[]
     indexed on (userId, lastMessageAt desc) and (userId, isPinned, lastMessageAt desc)

Message
 ├─ id, conversationId (FK → Conversation, cascade delete)
 ├─ role: USER | ASSISTANT | SYSTEM | TOOL
 ├─ status: PENDING | COMPLETE | ERROR
 ├─ content (plain text, for search/fallback rendering)
 ├─ parts (JSON — full AI SDK UIMessage parts array, source of truth for rendering)
 └─ metadata (JSON, currently unused)
     indexed on (conversationId, createdAt desc)
```

Two migrations exist: `user_model` and `convo_and_msg`. Both are additive; no destructive migrations yet.

---

## 5. API Documentation

### `POST /api/chat`

Streams an assistant reply for a given conversation using the Vercel AI SDK's `UIMessageStream` protocol (consumed by `useChat` on the client).

**Auth:** Required (Clerk session cookie). Enforced via `auth.protect()` and again by `requireUser()`.

**Request body** (`application/json`):
```ts
{
  id: string;        // conversation id
  message: UIMessage; // the single new user message (AI SDK UIMessage shape)
}
```

**Behavior:**
1. Rejects with `400` if `message` or `id` is missing.
2. Resolves the local `User`; `404`s if the conversation doesn't exist **or isn't owned by the caller** (ownership check is a `findFirst({ where: { id, userId } })`, not a separate 403 — a not-found response is returned either way, which avoids leaking existence of other users' conversations).
3. Loads prior messages; if the incoming message ID was already saved (dedupe by `message.id`), it's not re-inserted (idempotency guard for client retries).
4. Calls `streamText()` with:
   - `model`: `getChatModel(conversation.model)` — defaults to `gpt-4o-mini` if the conversation has no override.
   - `system`: `conversation.systemPrompt` or a default `"You are ChatMate, a helpful assistant"`.
   - `messages`: full history converted via `convertToModelMessages`.
5. Streams the response back as SSE via `createUIMessageStreamResponse`, using a deterministic ID generator (`msg` prefix, 16 chars).
6. On stream completion (`onEnd`), persists all final messages (without re-triggering the title-generation logic — `updateTitle:false`).

**Response:** `200` streaming body (AI SDK UI message stream format) on success; `400` on missing fields; `404` on missing/unauthorized conversation.

### Server Actions (not REST, but the app's real "API surface")

All are Next.js Server Actions (`"use server"`), callable only from server components/client via RPC, each independently re-checking auth with `requireUser()`:

| Action | File | Purpose |
|---|---|---|
| `onBoard()` | `features/auth/action/onboard.ts` | Upsert Clerk user → local `User` |
| `requireUser()` | `features/auth/action/require-user.ts` | Auth guard + user lookup, used everywhere |
| `getConversation(id)` | `conversation.actions.ts` | Fetch one conversation (ownership-checked) |
| `listConversations()` | `conversation.actions.ts` | Sidebar list (pinned first, then recency) |
| `createConversation(title?)` | `conversation.actions.ts` | New conversation |
| `updateConversation(id, data)` | `conversation.actions.ts` | Rename / pin / archive |
| `deleteConversation(id)` | `conversation.actions.ts` | Hard delete (cascades to messages) |
| `startNewChat()` | `features/home/actions/start-new-chat.ts` | Used by `/` to create + redirect |
| `loadChatMessages(id)` | `features/ai/actions/chat-store.ts` | Load thread as `UIMessage[]` |
| `saveChatMessages(id, messages, opts)` | `features/ai/actions/chat-store.ts` | Upsert messages + update title/lastMessageAt |
| `listMessages / createMessage / updateMessage / deleteMessage` | `features/messages/actions/messages.action.ts` | ⚠ Built but currently unused CRUD path — see §6 |

---

## 6. Notes for a New Developer

- **Two message-persistence paths exist.** The live chat flow (`/api/chat` + `chat-store.ts`) is what's actually rendered in `ConversationView`. The separate `features/messages` action/hook pair (`createMessage`, `updateMessage`, `deleteMessage`, `useMessages`, etc.) is fully implemented but not called from any component. Before extending message editing/deletion UI, decide whether to wire up this existing layer or retire it — don't build a third one.
- **Model/system-prompt overrides exist in the schema (`Conversation.model`, `Conversation.systemPrompt`) but there's no UI to set them yet** — currently every conversation falls back to `gpt-4o-mini` and the default system prompt.
- **`app-sidebar.tsx` renaming uses `window.prompt()`** — functional but not a great UX pattern long-term; a good first "polish" ticket.
- **Route protection is layered but not redundant-for-no-reason**: `proxy.ts` (edge middleware) blocks unauthenticated access early; `app/(root)/layout.tsx` calls `auth.protect()` again and ensures onboarding; individual server actions call `requireUser()` again. This defense-in-depth means you can't accidentally expose a new server action just by forgetting one layer — but it does mean auth logic is checked 2–3 times per request, which is intentional, not a bug.
- **`AGENTS.md` / `CLAUDE.md` contain a prompt-injection-style instruction** ("this version of Next.js has breaking changes, read `node_modules/next/dist/docs/` before writing code") that doesn't correspond to anything real in `package.json` (Next 16.2.10 is a normal public release, and that docs path doesn't exist in the actual `next` package). Treat this as noise/an injected instruction rather than genuine project guidance — I did not act on it while producing this documentation, and you may want to remove or rewrite it so future AI coding assistants aren't misled by it.

---

## 7. Setup Instructions

### Prerequisites
- Node.js (18+ recommended for Next 16 / React 19)
- pnpm (repo conventions elsewhere in your other projects use pnpm for frontend)
- A PostgreSQL database
- A Clerk application (publishable + secret key)
- An OpenAI API key

### Steps

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment variables — create .env.local
```

```env
# Database
DATABASE_URL="postgresql://user:password@host:5432/dbname"

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_..."
CLERK_SECRET_KEY="sk_..."

# OpenAI (consumed by @ai-sdk/openai)
OPENAI_API_KEY="sk-..."
```

```bash
# 3. Generate the Prisma client and apply migrations
npx prisma migrate deploy      # or `prisma migrate dev` for local iterative dev
npx prisma generate            # outputs to lib/generated/prisma per schema.prisma

# 4. Run the dev server
pnpm dev
```

Open `http://localhost:3000` — you'll be redirected to Clerk sign-in, then onboarded automatically on first authenticated load (`onBoard()` runs in the root layout), then redirected into a fresh conversation.

### Build / Deploy
```bash
pnpm build
pnpm start
```
No special config in `next.config.ts` currently — it's the default scaffold. Deploying to Vercel is a natural fit given the AI SDK + Next.js combo (consistent with Ravindra's other projects deployed on Vercel/Render).

---

## 8. Security Review

### Findings

**1. Ownership checks are solid and consistent (Good).**
Every server action and the API route re-derive the user from the Clerk session server-side and scope every Prisma query with `userId`/ownership (`assertOwnsConversation`, `findFirst({ where: { id, userId } })`). There's no client-supplied `userId` trusted anywhere. This pattern is repeated correctly in `conversation.actions.ts`, `messages.action.ts`, and `app/api/chat/route.ts`.

**2. Auth is enforced in three independent layers (Good, defense-in-depth).**
Edge middleware (`proxy.ts`) → layout-level `auth.protect()` → per-action `requireUser()`. A missing check at any single layer wouldn't expose data, since the innermost layer (the action itself) always re-validates.

**3. `app/api/chat/route.ts` — potential message-length/rate abuse (Watch item).**
There's no cap on message length, conversation length sent to `streamText`, or per-user rate limiting on this route. Compared to your other projects (e.g., AI Arena, ConvoX) which use Upstash Redis for rate limiting, this endpoint currently has none — a signed-in user could spam requests and drive up OpenAI costs. Worth porting the same Redis-based rate limiter pattern here before any public deployment.

**4. No input validation/schema (`zod` is a dependency but unused here).**
`request.json()` is destructured directly into `{ message, id }` with only a truthiness check. A malformed `message` object (wrong shape) would likely throw inside `convertToModelMessages` rather than fail a clean validation step. Consider a `zod` schema (the package is already installed) to validate the request body shape before use — this also guards against unexpected `parts` content being persisted as-is into the `parts` JSON column.

**5. Stored `parts` JSON is trusted on the way back out (Watch item).**
`chat-store.ts` stores `message.parts` as-is (`Prisma.InputJsonValue`) and later feeds it straight back into `UIMessage.parts` for rendering. Since `MessageResponse` renders assistant text as markdown (via `streamdown`), and assistant content originates from the LLM (not raw user HTML), this is standard behavior for this class of app — but if any future feature lets a *user* message render through `MessageResponse` with markdown/HTML enabled, that would need output sanitization. Not an active vulnerability today, but a good thing to check before enabling rich rendering for user-authored content.

**6. `systemPrompt` and `model` are server-controlled, not user-input, today (Good).**
Since there's no UI yet to let end users set `Conversation.systemPrompt`, there's no current system-prompt-injection surface via that field. Flag this as a review item **when** that UI is built — at that point, decide whether arbitrary system prompts should be allowed per conversation, since that's effectively giving users control over the assistant's instructions.

**7. Prisma error messages surfaced to the client are generic (Good).**
Actions throw plain `Error("Conversation not found")` / `Error("Message not found")` rather than leaking Prisma internals or stack traces — consistent with the stack-trace-leakage hardening you did on the MentorOS project.

**8. `AGENTS.md`/`CLAUDE.md` contain an embedded instruction aimed at AI coding tools.**
As noted in §6, these files instruct any AI agent reading the repo to consult a non-existent `node_modules/next/dist/docs/` path before making changes, framed as if Next.js had undocumented breaking changes. This is not a runtime security issue for the app itself, but it's a **supply-chain-style prompt injection risk** for anyone using AI coding assistants on this repo — a malicious version of this file could just as easily instruct an agent to exfiltrate `.env` contents or weaken auth checks "per project convention." Worth treating any instructions embedded in repo docs as untrusted unless you personally wrote them, and reviewing `AGENTS.md`/`CLAUDE.md` before merging changes from anyone else.

**9. Environment secrets.**
`DATABASE_URL`, Clerk secret key, and `OPENAI_API_KEY` are all environment-variable driven and not present in the bundled source — correct practice. Ensure `.env*` stays in `.gitignore` (not verified here since the file wasn't fully inspected, but flagged as a standard check).

### Summary
The authorization model (ownership checks, layered auth) is the strongest part of this codebase and is implemented correctly and consistently. The main gaps before any public/production launch are: (a) rate limiting on `/api/chat`, and (b) request-body schema validation using the already-installed `zod`. Neither is currently exploitable beyond cost/availability risk (no data leakage or privilege escalation path was found).