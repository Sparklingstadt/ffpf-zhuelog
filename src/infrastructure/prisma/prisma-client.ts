import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/prisma/client";
import { securePostgresConnectionString } from "../../../prisma/postgres-connection";

// Kept on globalThis so hot reloads in development reuse one client (and its
// connection pool) instead of opening a new one each time.
const globalForPrisma = globalThis as unknown as {
  zhuelogPrisma?: PrismaClient;
};

// One client per process. Throws only when called without DATABASE_URL, so
// importing this module (for example during the build) never needs a database.
export function prisma(): PrismaClient {
  if (globalForPrisma.zhuelogPrisma) return globalForPrisma.zhuelogPrisma;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: securePostgresConnectionString(url),
    }),
  });
  globalForPrisma.zhuelogPrisma = client;
  return client;
}
