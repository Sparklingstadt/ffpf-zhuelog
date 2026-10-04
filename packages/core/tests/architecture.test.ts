import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const sources = readdirSync(root, { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".ts"))
  .map((path) => ({
    path: relative(root, `${root}${path}`).replaceAll("\\", "/"),
    text: readFileSync(`${root}${path}`, "utf8"),
  }));
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

test("core never writes to the console; outer layers own logging", () => {
  const logging = sources
    .filter(({ text }) => /\bconsole\.\w+\(/.test(text))
    .map(({ path }) => path);
  assert.deepEqual(logging, []);
});
