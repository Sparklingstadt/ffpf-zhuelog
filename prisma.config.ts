import "dotenv/config";
import { defineConfig, env } from "prisma/config";
import { securePostgresConnectionString } from "./src/infrastructure/config/postgres-connection";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: { url: securePostgresConnectionString(env("DATABASE_URL")) },
});
