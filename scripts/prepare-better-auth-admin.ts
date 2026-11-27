// Puts the admin's Sparklingstadt ID sub into "_better_auth_admin" before the
// owner_to_user migration runs (prisma/migrations/20261127100000_owner_to_user),
// then prints a pre-deploy report of what would stop that migration.
//
//   pnpm run auth:prepare-admin -- --github-id 123 --sid-sub abc --email o@x --name Owner
//   pnpm run auth:prepare-admin -- ... --check-only   (no write, report only)
//
// Exits non-zero when the migration would stop. The only write is the staging
// row; every check is read only.
import pg from "pg";
import { pathToFileURL } from "node:url";

import { securePostgresConnectionString } from "../prisma/postgres-connection";

export type AdminArgs = {
  githubId: string;
  sidSub: string;
  email: string;
  name: string;
};

const flags: Record<string, keyof AdminArgs> = {
  "--github-id": "githubId",
  "--sid-sub": "sidSub",
  "--email": "email",
  "--name": "name",
};

export function isCheckOnly(argv: string[]): boolean {
  return argv.includes("--check-only");
}

export function parseAdminArgs(argv: string[]): AdminArgs {
  const found: Partial<AdminArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--check-only" || flag === "--") continue;
    const key = flags[flag];
    if (!key) throw new Error(`Unknown argument: ${flag}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value`);
    }
    found[key] = value;
  }
  for (const [flag, key] of Object.entries(flags)) {
    if (!found[key]) throw new Error(`${flag} is required`);
  }
  const args = found as AdminArgs;
  if (!/^\d+$/.test(args.githubId)) {
    throw new Error("--github-id must be numeric");
  }
  if (!/^[a-z0-9]{1,64}$/.test(args.sidSub)) {
    throw new Error("--sid-sub must be 1-64 characters of a-z and 0-9");
  }
  return args;
}

// Same table as the migration's own CREATE TABLE IF NOT EXISTS.
export const ENSURE_ADMIN_TABLE_SQL = `CREATE TABLE IF NOT EXISTS "_better_auth_admin" (
    "githubId" TEXT,
    "sidSub" TEXT,
    "email" TEXT,
    "name" TEXT
)`;

// Replaces the table's content with one row, in one statement. The values are
// $1 githubId, $2 sidSub, $3 email, $4 name (see adminValues); `args` only
// documents what the statement is for.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for the brief's signature
export function prepareAdminSql(_args?: AdminArgs): string {
  return `WITH cleared AS (DELETE FROM "_better_auth_admin")
INSERT INTO "_better_auth_admin" ("githubId", "sidSub", "email", "name")
VALUES ($1, $2, $3, $4)`;
}

export function adminValues(args: AdminArgs): string[] {
  return [args.githubId, args.sidSub, args.email, args.name];
}

// The owner columns the migration re-owns: the 12 owned tables and Follow's two.
const ownerColumns: { table: string; column: string }[] = [
  "LearningEntry",
  "ChatConversation",
  "PrepositionPracticeRecord",
  "QuickQuestion",
  "ComplementPracticeRecord",
  "ReviewItem",
  "ReviewLog",
  "VocabularyEntry",
  "AiUsage",
  "LineLink",
  "LineLinkCode",
  "LineMessage",
]
  .map((table) => ({ table, column: "ownerId" }))
  .concat([
    { table: "Follow", column: "followerId" },
    { table: "Follow", column: "followeeId" },
  ]);

const adminCte = `WITH "admin" AS (SELECT $1::text AS "githubId", $2::text AS "sidSub", $3::text AS "email")`;

// Read-only checks. Every query takes $1 githubId, $2 sidSub, $3 email of the
// admin to be, so it works before and after the staging row is written.
export function preDeployCheckSql(): {
  unmapped: string;
  emailCollisions: string;
  sidSubCollision: string;
} {
  const owners = ownerColumns
    .map(
      ({ table, column }) =>
        `SELECT '${table}' AS "table", '${column}' AS "column", "${column}" AS "owner" FROM "${table}"`,
    )
    .join("\n    UNION ALL ");
  return {
    // Same rule as the migration: an owner is mapped when it is
    // 'password:'||PasswordAccount.id, 'sid:'||SidAccount.id or the admin githubId.
    unmapped: `${adminCte},
"owners" AS (
    ${owners}
)
SELECT o."table", o."column", count(*)::int AS "count",
       array_to_string((array_agg(DISTINCT o."owner" ORDER BY o."owner"))[1:5], ', ') AS "owners"
  FROM "owners" o, "admin" a
 WHERE o."owner" IS DISTINCT FROM a."githubId"
   AND NOT EXISTS (SELECT 1 FROM "PasswordAccount" p WHERE 'password:' || p."id" = o."owner")
   AND NOT EXISTS (SELECT 1 FROM "SidAccount" s WHERE 'sid:' || s."id" = o."owner")
 GROUP BY o."table", o."column"
 ORDER BY o."table", o."column"`,
    // "user"."email" is unique: duplicate SidAccount emails, and a SidAccount
    // email equal to the admin's (compared case-insensitively).
    emailCollisions: `${adminCte}
SELECT 'duplicate' AS "kind", lower(s."email") AS "email", array_agg(s."id" ORDER BY s."id") AS "ids"
  FROM "SidAccount" s
 GROUP BY lower(s."email")
HAVING count(*) > 1
UNION ALL
SELECT 'admin', lower(s."email"), array_agg(s."id" ORDER BY s."id")
  FROM "SidAccount" s, "admin" a
 WHERE lower(s."email") = lower(a."email")
 GROUP BY lower(s."email")
 ORDER BY 1, 2`,
    // The migration stops when the admin's sidSub is an existing SidAccount.id.
    sidSubCollision: `${adminCte}
SELECT s."id" FROM "SidAccount" s, "admin" a WHERE s."id" = a."sidSub"`,
  };
}

export type PreDeployFindings = {
  unmapped: { table: string; column: string; count: number; owners: string }[];
  emailCollisions: {
    kind: "duplicate" | "admin";
    email: string;
    ids: string[];
  }[];
  sidSubCollisions: { id: string }[];
};

export function formatPreDeployReport(findings: PreDeployFindings): {
  ok: boolean;
  lines: string[];
} {
  const lines: string[] = ["Pre-deploy report for owner_to_user"];
  const { unmapped, emailCollisions, sidSubCollisions } = findings;

  lines.push("1. Owner values with no mapping");
  if (unmapped.length === 0) lines.push("   none");
  for (const u of unmapped) {
    lines.push(
      `   "${u.table}"."${u.column}": ${u.count} row(s) (owners: ${u.owners})`,
    );
  }

  lines.push('2. Email collisions on "user"."email"');
  if (emailCollisions.length === 0) lines.push("   none");
  for (const c of emailCollisions) {
    lines.push(
      c.kind === "duplicate"
        ? `   SidAccount rows share the email ${c.email}: ${c.ids.join(", ")}`
        : `   SidAccount ${c.ids.join(", ")} has the admin's email ${c.email}`,
    );
  }

  lines.push("3. Admin sidSub equal to a SidAccount id");
  if (sidSubCollisions.length === 0) lines.push("   none");
  for (const c of sidSubCollisions) lines.push(`   SidAccount ${c.id}`);

  const ok =
    unmapped.length + emailCollisions.length + sidSubCollisions.length === 0;
  lines.push(
    ok
      ? "OK: the migration should not stop on these checks."
      : "NOT OK: the migration would stop. Fix the data above before deploying.",
  );
  return { ok, lines };
}

async function main(argv: string[]): Promise<number> {
  const args = parseAdminArgs(argv);
  const checkOnly = isCheckOnly(argv);
  await import("dotenv/config");
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set.");
  const client = new pg.Client({
    connectionString: securePostgresConnectionString(raw),
  });
  await client.connect();
  try {
    if (checkOnly) {
      console.log("--check-only: nothing is written.");
    } else {
      await client.query("BEGIN");
      try {
        await client.query(ENSURE_ADMIN_TABLE_SQL);
        await client.query(prepareAdminSql(args), adminValues(args));
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      console.log(`Wrote the admin row for GitHub id ${args.githubId}.`);
    }
    const sql = preDeployCheckSql();
    const values = [args.githubId, args.sidSub, args.email];
    const unmapped = await client.query(sql.unmapped, values);
    const emails = await client.query(sql.emailCollisions, values);
    const subs = await client.query(sql.sidSubCollision, values);
    const report = formatPreDeployReport({
      unmapped: unmapped.rows,
      emailCollisions: emails.rows,
      sidSubCollisions: subs.rows,
    });
    console.log(report.lines.join("\n"));
    return report.ok ? 0 : 1;
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
