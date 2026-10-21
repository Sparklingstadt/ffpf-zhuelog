import type { PasswordAccount } from "@/domain/identity/entities/password-account";
import {
  LoginIdTakenError,
  PasswordAccountNotFoundError,
} from "@/domain/identity/password-account-error";
import type { PasswordAccountRepository } from "@/domain/identity/repositories/password-account-repository";
import { getPrismaClient } from "../prisma-client";
import type { PasswordAccount as PasswordAccountRow } from "@/generated/prisma/client";

function map(row: PasswordAccountRow): PasswordAccount {
  return {
    id: row.id,
    loginId: row.loginId,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    sessionVersion: row.sessionVersion,
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

  async setPassword(id: string, passwordHash: string) {
    try {
      await getPrismaClient().passwordAccount.update({
        where: { id },
        data: {
          passwordHash,
          sessionVersion: { increment: 1 },
        },
      });
    } catch (error) {
      if (hasCode(error, "P2025")) throw new PasswordAccountNotFoundError();
      throw error;
    }
  }
}
