// Signed-in browsers. The cookie holds a random token; only its SHA-256 is
// stored, with the session's owner, role, login and sessionVersion. The
// expiry is fixed at sign-in. Expired rows are pruned a bounded batch at a
// time on each sign-in, as SignInThrottle's.
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import {
  sessionTtlMs,
  toSessionPrincipal,
  type SessionPrincipal,
} from "../../domain/identity/session";
import {
  hashSessionToken,
  isSessionTokenShape,
  newSessionToken,
} from "../auth/session-token";

// How many expired rows one sign-in deletes.
export const SESSION_PRUNE_BATCH = 100;

// For every interactive transaction that touches Session (password changes
// delete the owner's sessions with the hash update).
export const SESSION_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 };

// Deletes at most SESSION_PRUNE_BATCH expired rows; SKIP LOCKED so concurrent
// sign-ins never wait on each other's cleanup (as pruneThrottleSql).
export function pruneSessionsSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    DELETE FROM "Session" WHERE "id" IN (
      SELECT "id" FROM "Session"
       WHERE "expiresAt" <= CAST(${now} AS TIMESTAMP(3))
       LIMIT ${SESSION_PRUNE_BATCH} FOR UPDATE SKIP LOCKED)`;
}

export type SessionTokens = {
  newToken(): string;
  hash(token: string): string;
  isShape(value: string): boolean;
};

const defaultTokens: SessionTokens = {
  newToken: newSessionToken,
  hash: hashSessionToken,
  isShape: isSessionTokenShape,
};

export function createSessionStore(
  db: () => PrismaClient,
  tokens: SessionTokens = defaultTokens,
) {
  return {
    // Prunes expired rows, then stores a new session; returns the token (the
    // only time it exists outside the browser).
    async start(principal: SessionPrincipal, now: Date): Promise<string> {
      await db().$executeRaw(pruneSessionsSql(now));
      const token = tokens.newToken();
      await db().session.create({
        data: {
          tokenHash: tokens.hash(token),
          ownerId: principal.ownerId,
          role: principal.role,
          login: principal.role === "admin" ? principal.login : null,
          sessionVersion:
            principal.role === "member" ? principal.sessionVersion : null,
          expiresAt: new Date(now.getTime() + sessionTtlMs(principal)),
        },
      });
      return token;
    },

    // null for a token of the wrong shape (no query), an unknown hash, a row
    // with expiresAt <= now, or a row toSessionPrincipal refuses.
    async find(token: string, now: Date): Promise<SessionPrincipal | null> {
      if (!tokens.isShape(token)) return null;
      const row = await db().session.findUnique({
        where: { tokenHash: tokens.hash(token) },
        select: {
          ownerId: true,
          role: true,
          login: true,
          sessionVersion: true,
          expiresAt: true,
        },
      });
      if (row === null || row.expiresAt.getTime() <= now.getTime()) {
        return null;
      }
      return toSessionPrincipal(row);
    },

    // Deletes the row of this token; nothing for an unknown or malformed one.
    async end(token: string): Promise<void> {
      if (!tokens.isShape(token)) return;
      await db().session.deleteMany({
        where: { tokenHash: tokens.hash(token) },
      });
    },
  };
}
