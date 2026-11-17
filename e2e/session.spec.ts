import { type BrowserContext, type Page } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import type { Client } from "pg";
import { sessionCookieName } from "./environment";
import {
  asGuest,
  asMember,
  createMember,
  expect,
  memberOwnerId,
  signOut,
  test,
} from "./fixtures";

const password = "member-password-1";

async function cookie(context: BrowserContext, name: string) {
  return (await context.cookies()).find((entry) => entry.name === name);
}

async function sessionRows(db: Client) {
  const { rows } = await db.query(
    `SELECT "tokenHash", "ownerId", "role", "sessionVersion", "login"
       FROM "Session"`,
  );
  return rows as {
    tokenHash: string;
    ownerId: string;
    role: string;
    sessionVersion: number | null;
    login: string | null;
  }[];
}

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

// The cookie's expiry, in seconds from now, is the Max-Age the web set.
function expectLifetime(expires: number | undefined, seconds: number) {
  const left = (expires ?? 0) - Date.now() / 1000;
  expect(Math.abs(left - seconds)).toBeLessThanOrEqual(120);
}

async function expectSignedOut(page: Page) {
  await page.goto("/logs");
  await expect(page).toHaveURL(/\/signin(?:\?|$)/);
}

test("signing in stores only the token's hash, and signing out deletes the row", async ({
  page,
  context,
  db,
  baseURL,
}) => {
  const accountId = await createMember(db, "taro", "太郎", password);
  await asMember(page, "taro", password, "/logs");

  const session = await cookie(context, sessionCookieName);
  expect(session?.value).toHaveLength(43);
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expectLifetime(session?.expires, 2_592_000);

  expect(await sessionRows(db)).toEqual([
    {
      tokenHash: sha256(session!.value),
      ownerId: memberOwnerId(accountId),
      role: "member",
      sessionVersion: 0,
      login: null,
    },
  ]);
  // The cookie's value itself is stored nowhere.
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM "Session" WHERE "tokenHash" = $1 OR "id" = $1`,
    [session!.value],
  );
  expect(rows[0].n).toBe(0);

  await signOut(page);
  await expect(
    page.getByRole("button", { name: "ゲストとして使う" }),
  ).toBeVisible();
  expect(await sessionRows(db)).toEqual([]);
  expect(await cookie(context, sessionCookieName)).toBeUndefined();

  // The old cookie names a deleted row.
  await context.addCookies([
    {
      name: sessionCookieName,
      value: session!.value,
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await expectSignedOut(page);
});

test("a planted session cookie and Go's old cookies are replaced at sign-in", async ({
  page,
  context,
  db,
  baseURL,
}) => {
  await createMember(db, "taro", "太郎", password);
  const planted = "A".repeat(43);
  await context.addCookies(
    [
      [sessionCookieName, planted],
      ["zl_access", "x"],
      ["zl_refresh", "y"],
    ].map(([name, value]) => ({
      name,
      value,
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax" as const,
    })),
  );
  // A token of the right shape that names no row is refused.
  await expectSignedOut(page);

  await asMember(page, "taro", password, "/logs");
  const session = await cookie(context, sessionCookieName);
  expect(session?.value).toBeTruthy();
  expect(session?.value).not.toBe(planted);
  expect(await cookie(context, "zl_access")).toBeUndefined();
  expect(await cookie(context, "zl_refresh")).toBeUndefined();
  expect(await sessionRows(db)).toHaveLength(1);
});

test("a guest session lasts 24 hours and is shared by the owner id guest", async ({
  page,
  context,
  db,
}) => {
  await asGuest(page);
  const session = await cookie(context, sessionCookieName);
  expectLifetime(session?.expires, 86_400);
  expect(await sessionRows(db)).toEqual([
    {
      tokenHash: sha256(session!.value),
      ownerId: "guest",
      role: "guest",
      sessionVersion: null,
      login: null,
    },
  ]);
});

test("an expired session is signed out", async ({ page, db }) => {
  await createMember(db, "taro", "太郎", password);
  await asMember(page, "taro", password, "/logs");
  await db.query(
    `UPDATE "Session" SET "expiresAt" = NOW() - interval '1 second'`,
  );
  await expectSignedOut(page);
});

test("a sign-in prunes expired sessions", async ({ page, db }) => {
  const ids = [0, 1, 2].map(() => `c${randomBytes(12).toString("hex")}`);
  for (const id of ids)
    await db.query(
      `INSERT INTO "Session" ("id","tokenHash","ownerId","role","expiresAt")
       VALUES ($1,$2,'guest','guest', NOW() - interval '1 minute')`,
      [id, sha256(id)],
    );

  await asGuest(page);
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM "Session" WHERE "id" = ANY($1)`,
    [ids],
  );
  expect(rows[0].n).toBe(0);
  expect(await sessionRows(db)).toHaveLength(1);
});

test("the old Go cookies alone are signed out", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies(
    [
      ["zl_access", "x"],
      ["zl_refresh", "y"],
    ].map(([name, value]) => ({
      name,
      value,
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax" as const,
    })),
  );
  await expectSignedOut(page);
});

test("a member's act-as cookie is ignored", async ({
  page,
  context,
  db,
  baseURL,
}) => {
  await createMember(db, "taro", "太郎", password);
  const otherId = await createMember(db, "jiro", "次郎", password);
  await asMember(page, "taro", password, "/logs");
  // Only admins may act as someone; a member's own cookie changes nothing.
  await context.addCookies([
    {
      name: "zl_act_as",
      value: memberOwnerId(otherId),
      url: baseURL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/logs");
  await expect(page).toHaveURL((url) => url.pathname === "/logs");
  await expect(page.getByText("太郎")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "として操作中" }),
  ).toHaveCount(0);
});
