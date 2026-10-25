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

test("repository contracts live in domain/<feature>/repositories", () => {
  const misplaced = sources.flatMap(({ path, text }) =>
    interfaces(text)
      .filter((name) => name.endsWith("Repository"))
      .filter(() => !/^domain\/[^/]+\/repositories\//.test(path))
      .map((name) => `${name} in ${path}`),
  );
  assert.deepEqual(misplaced, []);
});

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

// The web reaches data only through the Go API: no Prisma, no Postgres
// driver and no Auth.js anywhere in src (the generated client aside).
const forbiddenModule = (specifier: string) =>
  /^@\/generated\/prisma(\/|$)/.test(specifier) ||
  /(^|\/)generated\/prisma(\/|$)/.test(specifier) ||
  /^@prisma\//.test(specifier) ||
  /^pg(\/|$)/.test(specifier) ||
  /^next-auth(\/|$)/.test(specifier);

const moduleSpecifiers = (text: string) =>
  [
    ...text.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g,
    ),
  ].map((match) => match[1]!);

test("nothing in src imports Prisma, pg or next-auth", () => {
  const files = readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(path))
    .filter((path) => !path.startsWith("generated/"));
  assert.ok(files.length > 0);
  const offenders = files.flatMap((path) =>
    moduleSpecifiers(readFileSync(`${root}${path}`, "utf8"))
      .filter(forbiddenModule)
      .map((specifier) => `${path}: ${specifier}`),
  );
  assert.deepEqual(offenders, []);
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
    'import { x } from "@/infrastructure/go-api/client";',
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
