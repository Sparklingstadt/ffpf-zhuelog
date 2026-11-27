import {
  recordWithin,
  RECORD_TIMEOUT_MS,
} from "@/application/ai-usage/record-within";
import {
  createLineBot,
  createLineOwnerCheck,
} from "@/application/line/line-bot";
import { createLineLink } from "@/application/line/line-link";
import { getCachedCurrentUser } from "@/composition/current-user";
import { lineConfig, openAiConfig } from "@/infrastructure/config/environment";
import { createLineMessaging } from "@/infrastructure/line/line-messaging";
import {
  hashLinkCode,
  newLinkCode,
} from "@/infrastructure/line/link-code-crypto";
import { generateLineLearning } from "@/infrastructure/openai/line-learning";
import { OpenAiError, respondJson } from "@/infrastructure/openai/responses";
import { recordAiUsage } from "@/infrastructure/prisma/ai-usage-store";
import { createLineLinkStore } from "@/infrastructure/prisma/line-link-store";
import { createLineMessageStore } from "@/infrastructure/prisma/line-message-store";
import { prisma } from "@/infrastructure/prisma/prisma-client";
import { createSignInThrottleStore } from "@/infrastructure/prisma/sign-in-throttle-store";

// Read once at module load; Vercel needs a redeploy for env changes anyway.
const config = lineConfig();
const openAi = openAiConfig();
const links = createLineLinkStore(prisma);

// The bot's log codes that go to console.error: a failed send or throttle
// reset, an event without an id, a row settled elsewhere, review messages
// held back. Every other code (a message deferred, retried or failed, the
// count sent) goes to console.info.
const WARNING_CODES = new Set([
  "LINE_REPLY_FAILED",
  "LINE_PUSH_FAILED",
  "LINE_THROTTLE_RESET_FAILED",
  "LINE_EVENT_WITHOUT_ID",
  "LINE_MESSAGE_SETTLED",
  "LINE_REVIEW_NOTIFY_QUOTA_UNKNOWN",
  "LINE_REVIEW_NOTIFY_LIMITED",
  "LINE_REVIEW_NOTIFY_PUSH_FAILED",
]);

// The /account/line page and its actions, as the signed-in member or admin.
export const lineLink = createLineLink({
  currentUser: getCachedCurrentUser,
  enabled: config !== undefined,
  store: links,
  newCode: newLinkCode,
  hashCode: hashLinkCode,
  now: () => new Date(),
});

// The webhook and the daily pass; undefined when LINE is not configured.
export const lineBot =
  config && openAi
    ? (() => {
        const messaging = createLineMessaging(config);
        const messages = createLineMessageStore(prisma);
        return createLineBot({
          links,
          messages: {
            ...messages,
            insert: ({ ownerId, ...message }, now) =>
              messages.insert({ ...message, userId: ownerId }, now),
          },
          throttle: createSignInThrottleStore(prisma),
          async generate(kind, text, onUsage) {
            try {
              const generation = await generateLineLearning(
                (request) => respondJson(openAi, request, onUsage),
                kind,
                text,
              );
              return { ok: true, generation };
            } catch (error) {
              return {
                ok: false,
                failure:
                  error instanceof OpenAiError
                    ? { code: error.code, retryable: error.retryable }
                    : { code: "OPENAI_REQUEST_FAILED", retryable: false },
              };
            }
          },
          recordUsage: (ownerId, usage) =>
            recordWithin(
              () =>
                recordAiUsage(prisma, {
                  ...usage,
                  userId: ownerId,
                  feature: "line",
                }),
              RECORD_TIMEOUT_MS,
              (code, name) => console.error(code, name),
            ),
          messenger: messaging,
          quota: messaging,
          ownerValid: createLineOwnerCheck({
            ownerExists: links.ownerExists,
          }),
          hashCode: hashLinkCode,
          now: () => new Date(Math.trunc(Date.now())),
          log: (code, fields) =>
            WARNING_CODES.has(code)
              ? console.error(code, fields ?? {})
              : console.info(code, fields ?? {}),
        });
      })()
    : undefined;
