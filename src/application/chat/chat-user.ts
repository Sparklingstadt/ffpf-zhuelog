import { recordWithin } from "../ai-usage/record-within";
import {
  isMemberRole,
  type AuthenticatedUser,
} from "../../domain/identity/entities/authenticated-user";
import type { OpenAiUsage } from "../../domain/vocabulary/vocabulary-entry";

// What the quick questions and the chat share: whose notes they are, who
// pays for an answer, who may ask, and how an answer is metered.

// userId is whose notes these are and who pays for an answer. An admin
// impersonating a member is that member: the answer reads the member's notes
// and is counted in the member's AI usage.
export type ChatPerson = { userId: string; demo: boolean };

// null: signed out or a guest.
export function chatPerson(user: AuthenticatedUser | null): ChatPerson | null {
  if (!user || !isMemberRole(user.role)) return null;
  return { userId: user.userId, demo: user.demo === true };
}

export type AskRefusal = "signed-out" | "forbidden" | "demo" | "unavailable";

// Why the user may not ask, checked in this order: signed in, a member or
// admin, not the demo. null: may ask (OpenAI is the caller's to check).
export function askRefusal(
  user: AuthenticatedUser | null,
): Exclude<AskRefusal, "unavailable"> | null {
  if (!user) return "signed-out";
  const found = chatPerson(user);
  if (!found) return "forbidden";
  if (found.demo) return "demo";
  return null;
}

// The answer's pieces. The usage is recorded before the answer ends or
// fails, and also when the caller stops early; each write waits at most
// recordTimeoutMs and a failed or late one is only logged, so it never
// changes what the user gets. A failure is logged as failureCode with
// OpenAI's code, unless the browser stopped the answer. Callers pass only
// fixed codes and error names to logError, never the question or the answer.
export async function* meteredAnswer(
  answer: (onUsage: (usage: OpenAiUsage) => void) => AsyncIterable<string>,
  options: {
    signal: AbortSignal;
    failureCode: string;
    feature: string;
    record: (usage: OpenAiUsage) => Promise<void>;
    recordTimeoutMs: number;
    logError: (code: string, ...details: string[]) => void;
  },
): AsyncGenerator<string> {
  const spent: OpenAiUsage[] = [];
  try {
    yield* answer((usage) => spent.push(usage));
  } catch (error) {
    // An answer the browser stopped is not a failure worth logging.
    if (!options.signal.aborted)
      options.logError(options.failureCode, failureCode(error));
    throw error;
  } finally {
    for (const usage of spent)
      await recordWithin(
        () => options.record(usage),
        options.recordTimeoutMs,
        (code, name) => options.logError(code, options.feature, name),
      );
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

// OpenAI's error code (the whole message of its errors), else the error's
// name: application code does not import the infrastructure's error class.
function failureCode(error: unknown): string {
  if (error instanceof Error && /^OPENAI_[A-Z_]+$/.test(error.message))
    return error.message;
  return errorName(error);
}
