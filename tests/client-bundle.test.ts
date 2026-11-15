import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The question data and word lists are hundreds of KB. Only the server may
// load them: browser code ("use client" modules and everything they import
// at runtime) must not reach them. A server action ("use server") is a call
// to the server from the browser, so the walk stops there.

const root = fileURLToPath(new URL("../src/", import.meta.url));

const DATA_MODULE =
  /^domain\/practice\/(.+-data|example-pinyin|hsk-words|hsk-words-official)\.ts$/;

const read = (path: string) => readFileSync(join(root, path), "utf8");

const isClient = (text: string) => /^\s*["']use client["']/.test(text);
const isServerAction = (text: string) => /^\s*["']use server["']/.test(text);

// The modules a file loads at runtime: every import or re-export but those
// that bring in types only.
export function runtimeSpecifiers(text: string): string[] {
  const specifiers: string[] = [];
  const statement =
    /\b(import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of text.matchAll(statement)) {
    const sideEffect = match[5] ?? match[6];
    if (sideEffect) {
      specifiers.push(sideEffect);
      continue;
    }
    if (match[2]) continue;
    const clause = match[3]!;
    const names = /\{([^}]*)\}/.exec(clause)?.[1];
    const hasDefault = /^[\w$]+/.test(clause.trim()) || clause.includes("*");
    const allTypes =
      !hasDefault &&
      names !== undefined &&
      names
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .every((name) => name.startsWith("type "));
    if (!allTypes) specifiers.push(match[4]!);
  }
  return specifiers;
}

function resolve(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = specifier.slice(2);
  else if (specifier.startsWith(".")) base = join(dirname(from), specifier);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ])
    if (/\.tsx?$/.test(candidate) && existsSync(join(root, candidate)))
      return candidate.replaceAll("\\", "/");
  return null;
}

// Every data module the file reaches, with the chain of imports that gets
// there.
function dataReachedFrom(start: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>([start]);
  const queue: { path: string; chain: string[] }[] = [
    { path: start, chain: [start] },
  ];
  while (queue.length > 0) {
    const { path, chain } = queue.shift()!;
    for (const specifier of runtimeSpecifiers(read(path))) {
      const next = resolve(path, specifier);
      if (!next || seen.has(next)) continue;
      seen.add(next);
      if (DATA_MODULE.test(next)) {
        found.push([...chain, next].join(" → "));
        continue;
      }
      if (isServerAction(read(next))) continue;
      queue.push({ path: next, chain: [...chain, next] });
    }
  }
  return found;
}

const files = readdirSync(root, { recursive: true, encoding: "utf8" })
  .map((path) => path.replaceAll("\\", "/"))
  .filter((path) => /\.tsx?$/.test(path) && !path.startsWith("generated/"));

test("browser code never loads question data or word lists", () => {
  const clients = files.filter((path) => isClient(read(path)));
  assert.ok(clients.length > 0);
  assert.deepEqual(clients.flatMap(dataReachedFrom), []);
});

test("the walk does find data where the server loads it", () => {
  assert.notDeepEqual(dataReachedFrom("domain/practice/practice-quiz.ts"), []);
});

test("runtimeSpecifiers skips type-only imports", () => {
  const sample = [
    'import type { A } from "./a";',
    'import { type B, type C } from "./b";',
    'import { type D, e } from "./d";',
    'import F from "./f";',
    'import * as G from "./g";',
    'export { h } from "./h";',
    'export type { I } from "./i";',
    'import "./j";',
    'const k = await import("./k");',
    'import {\n  l,\n  type M,\n} from "./l";',
  ].join("\n");
  assert.deepEqual(runtimeSpecifiers(sample), [
    "./d",
    "./f",
    "./g",
    "./h",
    "./j",
    "./k",
    "./l",
  ]);
});
