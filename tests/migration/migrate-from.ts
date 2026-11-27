import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

// The migration under test. Every migration before it is applied first, then
// the test's seed, then this one.
export const TARGET_MIGRATION = "20261127100000_owner_to_user";

const migrationsDir = new URL("../../prisma/migrations/", import.meta.url);

function adminUrl(): string {
  const url = process.env.MIGRATION_TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "MIGRATION_TEST_DATABASE_URL is not set: run pnpm run test:migration",
    );
  }
  return url;
}

function databaseUrl(name: string): string {
  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  url.search = "";
  return url.toString();
}

function migration(name: string): string {
  return readFileSync(new URL(`${name}/migration.sql`, migrationsDir), "utf8");
}

const created: { name: string; client: pg.Client }[] = [];

// The failure of the target migration, with the database as the migration
// left it, so a test can check that nothing changed.
export class MigrationFailed extends Error {
  constructor(
    message: string,
    readonly db: pg.Client,
  ) {
    super(message);
  }
}

// A new database at the migration before TARGET_MIGRATION, with seedSql run,
// then TARGET_MIGRATION applied the way `prisma migrate deploy` does: the
// whole file as one simple query (the migration wraps itself in BEGIN ...
// COMMIT). Rejects with MigrationFailed when the migration fails.
export async function migrateFrom(seedSql: string): Promise<pg.Client> {
  const name = `zhuelog_migration_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const client = new pg.Client({ connectionString: databaseUrl(name) });
  await client.connect();
  created.push({ name, client });

  const names = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!names.includes(TARGET_MIGRATION)) {
    throw new Error(`migration ${TARGET_MIGRATION} does not exist`);
  }
  for (const before of names.filter((n) => n < TARGET_MIGRATION)) {
    await client.query(migration(before));
  }
  await client.query(seedSql);
  try {
    await client.query(migration(TARGET_MIGRATION));
  } catch (error) {
    // The migration's own BEGIN leaves the session in the aborted
    // transaction; end it as the deploy tool would, so the test can read the
    // database as the migration left it.
    await client.query("ROLLBACK");
    throw new MigrationFailed(
      error instanceof Error ? error.message : String(error),
      client,
    );
  }
  return client;
}

// Closes and drops every database migrateFrom made.
export async function dropMigratedDatabases(): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    for (const { name, client } of created.splice(0)) {
      await client.end().catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
}
