import {
  LOCK_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
  type PasswordAccount,
} from "@ffpf-zhuelog/core/domain/identity/entities/password-account";
import {
  LoginIdTakenError,
  PasswordAccountNotFoundError,
} from "@ffpf-zhuelog/core/domain/identity/password-account-error";
import type { PasswordAccountRepository } from "@ffpf-zhuelog/core/domain/identity/repositories/password-account-repository";
import { getPrismaClient } from "../prisma-client";
import type { PasswordAccount as PasswordAccountRow } from "@/generated/prisma/client";

function map(row: PasswordAccountRow): PasswordAccount {
  return {
    id: row.id,
    loginId: row.loginId,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    sessionVersion: row.sessionVersion,
    failedAttempts: row.failedAttempts,
    lockedUntil: row.lockedUntil,
    createdAt: row.createdAt,
  };
}

function hasCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

export class PrismaPasswordAccountRepository implements PasswordAccountRepository {
  // The caller passes a login ID that is already normalised.
  async findByLoginId(loginId: string) {
    const row = await getPrismaClient().passwordAccount.findUnique({
      where: { loginId },
    });
    return row ? map(row) : null;
  }

  async findById(id: string) {
    const row = await getPrismaClient().passwordAccount.findUnique({
      where: { id },
    });
    return row ? map(row) : null;
  }

  async list() {
    const rows = await getPrismaClient().passwordAccount.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(map);
  }

  async create(input: {
    loginId: string;
    displayName: string;
    passwordHash: string;
  }) {
    try {
      return map(
        await getPrismaClient().passwordAccount.create({ data: input }),
      );
    } catch (error) {
      if (hasCode(error, "P2002")) throw new LoginIdTakenError();
      throw error;
    }
  }

  // One statement, so concurrent guesses cannot read the same counter. Both
  // CASE expressions see the row as it was before this UPDATE. The casts are
  // needed because the driver sends Date parameters as text.
  async reserveAttempt(id: string, now: Date) {
    const lockEnd = new Date(now.getTime() + LOCK_DURATION_MS);
    const updated = await getPrismaClient().$executeRaw`
      UPDATE "PasswordAccount" SET
        "failedAttempts" = CASE WHEN "lockedUntil" IS NOT NULL THEN 1 ELSE "failedAttempts" + 1 END,
        "lockedUntil" = CASE WHEN (CASE WHEN "lockedUntil" IS NOT NULL THEN 1 ELSE "failedAttempts" + 1 END) >= ${MAX_FAILED_ATTEMPTS} THEN CAST(${lockEnd} AS TIMESTAMP(3)) ELSE NULL END,
        "updatedAt" = CAST(${now} AS TIMESTAMP(3))
      WHERE "id" = ${id} AND ("lockedUntil" IS NULL OR "lockedUntil" <= CAST(${now} AS TIMESTAMP(3)))
    `;
    return updated > 0;
  }

  async clearFailures(id: string) {
    await getPrismaClient().passwordAccount.updateMany({
      where: { id },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  }

  async setPassword(id: string, passwordHash: string) {
    try {
      await getPrismaClient().passwordAccount.update({
        where: { id },
        data: {
          passwordHash,
          sessionVersion: { increment: 1 },
          failedAttempts: 0,
          lockedUntil: null,
        },
      });
    } catch (error) {
      if (hasCode(error, "P2025")) throw new PasswordAccountNotFoundError();
      throw error;
    }
  }
}
