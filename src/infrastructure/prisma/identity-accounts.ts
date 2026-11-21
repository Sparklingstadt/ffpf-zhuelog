import type { IdentityAccounts } from "../identity/session-current-user-provider";
import { prisma } from "./prisma-client";

// Reads only the columns that decide who is signed in.
export const prismaIdentityAccounts: IdentityAccounts = {
  findPasswordAccount: (id) =>
    prisma().passwordAccount.findUnique({
      where: { id },
      select: {
        id: true,
        loginId: true,
        displayName: true,
        passwordHash: true,
        sessionVersion: true,
      },
    }),
  findFfpfAccount: (id) =>
    prisma().ffpfAccount.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        displayName: true,
        sessionVersion: true,
      },
    }),
};
