# Chat History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conversation ending, private DB history, Markdown download and LocalStorage recovery.

**Architecture:** Keep conversation validation in core; use a repository port and Prisma adapter for persistence. Browser backup and Markdown formatting remain independent of the API, while a client hook coordinates the current conversation and saved snapshots.

**Tech Stack:** Next.js 16.3.6, React 19, AI SDK 7, Prisma 7, PostgreSQL, Zod, Playwright.

**Spec:** ../specs/2026-10-01-chat-history-design.md

## Global Constraints

- Maximum 40 messages, 40,000 text characters, 256KiB request body.
- Private GitHub ID ownership; admin-only history and same-origin writes.
- Latest 20 local conversations, at most 1MiB; no API keys or reasoning stored.
- Save never invokes AI. New PR only; no merge or production migration.

## Review Focus

- Switching accounts must not show or save another user's local draft.
- Interrupted streams must retain partial text and disable new sends after ending.
- Storage quota or corrupted JSON must not break DB saves or downloads.
- Reusing another owner's UUID must fail rather than transfer ownership.
- Refreshing after a saved draft changes must show the newest local snapshot without marking it DB-saved.

### Task 1: Conversation domain and identity

**Files:** `packages/core/src/domain/chat/conversation.ts`, `packages/core/src/domain/chat/repositories/conversation-repository.ts`, `packages/core/src/application/chat/use-cases/save-conversation.ts`, `src/types/next-auth.d.ts`, identity entity/provider/config, `tests/chat-conversation.test.ts`.

**Interfaces:** `conversationSchema`, `Conversation`, `ConversationSummary`, `ConversationRepository.save(ownerId, conversation)`, `.list(ownerId)`, `.get(ownerId,id)`; `AuthenticatedUser.githubId?: string`.

- [ ] Add failing tests for invalid roles, blank text, message/character limits and ownership collision.
- [ ] Implement schema, save use case and stable GitHub ID session propagation. Use `token.sub` populated by GitHub's profile ID; reject absent identity for saved history.
- [ ] Run `node --import tsx --test tests/chat-conversation.test.ts`.

```ts
const ownerId = user.githubId;
if (!ownerId) throw new Error("REAUTH_REQUIRED");
const conversation = conversationSchema.parse(input);
await repository.save(ownerId, conversation);
```

### Task 2: Private DB and API

**Files:** Prisma schema/migration, `src/infrastructure/persistence/prisma/repositories/prisma-conversation-repository.ts`, `src/composition/conversation-container.ts`, `src/app/api/chat/conversations/route.ts`, `src/app/api/chat/conversations/[id]/route.ts`, `src/presentation/controllers/conversation-controller.ts`, `tests/chat-conversation-api.test.ts`.

**Interfaces:** JSON GET list summaries, GET detail and PUT save on `/api/chat/conversations`; all respond no-store.

- [ ] Add tests for unauthenticated/guest requests, mismatched origins, oversized body and ownership checks.
- [ ] Create ChatConversation with composite owner/id key and unique global id. Save updates only matching owners; timestamp is server-generated. Client updatedAt is used only for local snapshot comparison, never ownership.
- [ ] Generate Prisma and apply migration only to isolated E2E PostgreSQL.
- [ ] Run API/domain tests and typecheck.

```sql
CREATE TABLE "ChatConversation" (
 "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL,
 "title" TEXT NOT NULL, "modelName" TEXT NOT NULL,
 "ended" BOOLEAN NOT NULL, "messages" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ChatConversation_ownerId_updatedAt_idx" ON "ChatConversation"("ownerId", "updatedAt");
```

### Task 3: Browser persistence and download

**Files:** `src/infrastructure/chat/browser-conversation-history.ts`, `src/presentation/presenters/conversation-markdown.ts`, `tests/chat-conversation-browser.test.ts`.

**Interfaces:** read/write backup by owner ID, newest-first bounded snapshots with current draft id; Markdown serializer of Conversation.

- [ ] Add failing tests for corruption, quota failure, eviction, account separation and Markdown speaker labels.
- [ ] Implement strict read validation and bounded writes; do not silently discard current snapshot. Display errors via hook rather than throw during render.
- [ ] Run targeted tests. Ensure UTF-8 content and file names use conversation ID plus date.

```ts
const key = `zhuelog:chat-history:v1:${ownerId}`;
const markdown = conversation.messages
  .map((m) => `## ${m.role === "user" ? "あなた" : "ChatGPT"}\n\n${m.text}`)
  .join("\n\n");
```

### Task 4: Screen integration and E2E

**Files:** `src/presentation/components/chat/use-conversation-history.ts`, `conversation-history.tsx`, existing `chat-interface.tsx`, chat page, `e2e/chat.spec.ts`, fixtures, README.

**Interfaces:** hook returns draft, history, errors, ended, saving and actions end/save/new/open/download; ChatInterface receives stable owner ID.

- [ ] Add E2E scenarios using route-mocked AI stream: end retains messages and disables composer; new starts blank; DB save survives reload; local draft survives reload; download contains roles and response.
- [ ] Implement controls, history and backup status; stale response from a previous draft must not change current saved status. Reading a historical item fetches DB detail unless a newer local version exists.
- [ ] Run targeted desktop/mobile Playwright, typecheck, lint, build and relevant unit tests.
- [ ] Commit reviewed source including previously deployed model change. Push new feature branch, create PR with migration instructions and attach it to this task.

```ts
function endConversation() {
  stop();
  setEnded(true);
}
function startNewConversation() {
  persistCurrent();
  setMessages([]);
  setEnded(false);
}
```

## Verification

Implemented and reviewed. Typecheck, lint, optimized build and 109 unit tests pass. Full desktop/mobile E2E: 84/84; final backup adjustment rechecked with 8/8 chat E2E tests. The migration was applied only to isolated E2E PostgreSQL. Reviewer findings on navigation, invalid archives and multiple-tab overwrites were fixed with regressions.
