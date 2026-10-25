import "dotenv/config";
import { defineConfig } from "prisma/config";
import { securePostgresConnectionString } from "./prisma/postgres-connection";

// `prisma generate` (postinstall) needs no database, so DATABASE_URL is
// optional here; migrate and seed fail without it.
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: databaseUrl ? securePostgresConnectionString(databaseUrl) : undefined,
  },
});
