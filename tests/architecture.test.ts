import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Only the inner layers: src/domain and src/application.
const root = fileURLToPath(new URL("../src/", import.meta.url));
const sources = readdirSync(root, { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".ts"))
  .map((path) => ({
    path: relative(root, `${root}${path}`).replaceAll("\\", "/"),
    text: readFileSync(`${root}${path}`, "utf8"),
  }))
  .filter(({ path }) => /^(domain|application)\//.test(path));
const interfaces = (text: string) =>
  [...text.matchAll(/^export interface (\w+)/gm)].map((match) => match[1]);

test("each application port file declares exactly one port", () => {
  const ports = sources.filter(({ path }) =>
    /^application\/[^/]+\/ports\//.test(path),
  );
  assert.ok(ports.length > 0);
  for (const { path, text } of ports)
    assert.equal(interfaces(text).length, 1, path);
});

test("domain never depends on application", () => {
  const leaks = sources
    .filter(({ path }) => path.startsWith("domain/"))
    .filter(({ text }) => /from "[^"]*application\//.test(text))
    .map(({ path }) => path);
  assert.deepEqual(leaks, []);
});

test("domain and application never write to the console; outer layers own logging", () => {
  const logging = sources
    .filter(({ text }) => /\bconsole\.\w+\(/.test(text))
    .map(({ path }) => path);
  assert.deepEqual(logging, []);
});

test("application ports never expose HTTP types", () => {
  const http = sources
    .filter(({ path }) => /^application\/[^/]+\/ports\//.test(path))
    .filter(({ text }) => /\b(Response|Request|Headers)\b/.test(text))
    .map(({ path }) => path);
  assert.deepEqual(http, []);
});

// The web reaches the database only through infrastructure/prisma: no Prisma
// outside it, no Postgres driver and no Auth.js anywhere in src (the generated
// client aside).
const prismaModule = (specifier: string) =>
  /^@\/generated\/prisma(\/|$)/.test(specifier) ||
  /(^|\/)generated\/prisma(\/|$)/.test(specifier) ||
  /^@prisma\//.test(specifier);

const forbiddenModule = (specifier: string) =>
  prismaModule(specifier) ||
  /^pg(\/|$)/.test(specifier) ||
  /^next-auth(\/|$)/.test(specifier);

const forbiddenIn = (path: string, specifier: string) =>
  path.startsWith("infrastructure/prisma/")
    ? forbiddenModule(specifier) && !prismaModule(specifier)
    : forbiddenModule(specifier);

const moduleSpecifiers = (text: string) =>
  [
    ...text.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g,
    ),
  ].map((match) => match[1]!);

test("only infrastructure/prisma imports Prisma; nothing imports pg or next-auth", () => {
  const files = readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path))
    .filter((path) => !path.startsWith("generated/"));
  assert.ok(files.length > 0);
  const offenders = files.flatMap((path) =>
    moduleSpecifiers(readFileSync(`${root}${path}`, "utf8"))
      .filter((specifier) => forbiddenIn(path, specifier))
      .map((specifier) => `${path}: ${specifier}`),
  );
  assert.deepEqual(offenders, []);
});

test("infrastructure/prisma may import Prisma but not pg or next-auth", () => {
  const path = "infrastructure/prisma/prisma-client.ts";
  assert.equal(forbiddenIn(path, "@prisma/adapter-pg"), false);
  assert.equal(forbiddenIn(path, "../../generated/prisma/client"), false);
  assert.equal(forbiddenIn(path, "pg"), true);
  assert.equal(forbiddenIn(path, "next-auth"), true);
  assert.equal(forbiddenIn("composition/x.ts", "@prisma/client"), true);
});

test("the import check catches each forbidden form", () => {
  const sample = [
    'import { PrismaClient } from "@/generated/prisma/client";',
    'import { PrismaPg } from "@prisma/adapter-pg";',
    'import type { Pool } from "pg";',
    'import NextAuth from "next-auth";',
    'export { auth } from "next-auth/react";',
    'const m = await import("../generated/prisma/client");',
    'import "pg";',
    'import { pgTable } from "pgx";',
  ].join("\n");
  assert.deepEqual(moduleSpecifiers(sample).filter(forbiddenModule), [
    "@/generated/prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "next-auth",
    "next-auth/react",
    "../generated/prisma/client",
    "pg",
  ]);
});

// Pages, Server Actions, controllers and route handlers reach the database
// and OpenAI only through the use cases composition builds: they never import
// infrastructure/prisma or infrastructure/openai. Cookies, headers and request
// signatures (infrastructure/auth, preferences, security, line) are the web
// layer's own business and may be imported directly.
const DATA_ADAPTERS = /^@\/infrastructure\/(prisma|openai)(\/|$)/;

test("pages and presentation never import the database or OpenAI adapters", () => {
  const files = readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => /\.(ts|tsx)$/.test(path))
    .filter((path) => /^(app|presentation)\//.test(path));
  assert.ok(files.length > 0);
  const offenders = files.flatMap((path) =>
    moduleSpecifiers(readFileSync(`${root}${path}`, "utf8"))
      .filter((specifier) => DATA_ADAPTERS.test(specifier))
      .map((specifier) => `${path}: ${specifier}`),
  );
  assert.deepEqual(offenders, []);
});

test("the data adapter check catches both adapters and nothing else", () => {
  assert.equal(
    DATA_ADAPTERS.test("@/infrastructure/prisma/vocabulary-store"),
    true,
  );
  assert.equal(DATA_ADAPTERS.test("@/infrastructure/openai/chat-client"), true);
  assert.equal(
    DATA_ADAPTERS.test("@/infrastructure/auth/client-address"),
    false,
  );
  assert.equal(DATA_ADAPTERS.test("@/infrastructure/prismatic"), false);
});

// UI components take nothing from infrastructure; browser-side stores come
// through composition/browser-preferences.ts (eslint.config.mjs agrees).
test("UI components never import infrastructure", () => {
  const files = readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => /\.(ts|tsx)$/.test(path))
    .filter((path) => path.startsWith("presentation/components/"));
  assert.ok(files.length > 0);
  const offenders = files.flatMap((path) =>
    moduleSpecifiers(readFileSync(`${root}${path}`, "utf8"))
      .filter((specifier) => /^@\/infrastructure(\/|$)/.test(specifier))
      .map((specifier) => `${path}: ${specifier}`),
  );
  assert.deepEqual(offenders, []);
});

// Better Auth is an infrastructure detail: the server library is imported only
// under infrastructure/auth, the browser client only under presentation.
const CLIENT_MODULE = /^better-auth\/(react|client\/plugins)(\/|$)/;
const serverModule = (specifier: string) =>
  /^better-auth(\/|$)/.test(specifier) && !CLIENT_MODULE.test(specifier);

const betterAuthViolation = (path: string, specifier: string) =>
  (serverModule(specifier) && !path.startsWith("infrastructure/auth/")) ||
  (CLIENT_MODULE.test(specifier) && !path.startsWith("presentation/"));

const betterAuthOffenders = (files: { path: string; text: string }[]) =>
  files.flatMap(({ path, text }) =>
    moduleSpecifiers(text)
      .filter((specifier) => betterAuthViolation(path, specifier))
      .map((specifier) => `${path}: ${specifier}`),
  );

test("better-auth is imported only under infrastructure/auth; its browser client only under presentation", () => {
  const files = readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path))
    .filter((path) => !path.startsWith("generated/"));
  assert.ok(files.length > 0);
  assert.deepEqual(
    betterAuthOffenders(
      files.map((path) => ({
        path,
        text: readFileSync(`${root}${path}`, "utf8"),
      })),
    ),
    [],
  );
});

test("the better-auth check catches each misplaced import", () => {
  const server = 'import { betterAuth } from "better-auth";';
  const plugin = 'import { admin } from "better-auth/plugins";';
  const react = 'import { createAuthClient } from "better-auth/react";';
  const clientPlugins =
    'import { adminClient } from "better-auth/client/plugins";';
  assert.deepEqual(
    betterAuthOffenders([
      { path: "application/x.ts", text: server },
      { path: "presentation/x.ts", text: plugin },
      { path: "infrastructure/auth/x.ts", text: server },
      { path: "infrastructure/auth/y.ts", text: plugin },
      { path: "infrastructure/auth/z.ts", text: react },
      { path: "infrastructure/prisma/x.ts", text: clientPlugins },
      { path: "presentation/auth.ts", text: react },
      { path: "presentation/auth.ts", text: clientPlugins },
      { path: "app/page.tsx", text: react },
    ]),
    [
      "application/x.ts: better-auth",
      "presentation/x.ts: better-auth/plugins",
      "infrastructure/auth/z.ts: better-auth/react",
      "infrastructure/prisma/x.ts: better-auth/client/plugins",
      "app/page.tsx: better-auth/react",
    ],
  );
});
