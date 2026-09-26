import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";

// Build first (package.json): TypeScript process tests execute the Go binary.
// Separate processes isolate environment mutations between test files/suites.
const children = new Set();
let interrupted = false;
function stop(signal) {
  interrupted = true;
  for (const child of children) child.kill(signal);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

function run(command, args, options = {}) {
  if (interrupted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    children.add(child);
    child.once("error", (error) => {
      console.error(`Could not start ${command}: ${error.message}`);
    });
    child.once("close", (code) => {
      children.delete(child);
      resolve(code === 0);
    });
  });
}

const files = (await readdir(new URL("../tests/", import.meta.url)))
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => `tests/${name}`);
const results = await Promise.all([
  (async () => {
    const options = { cwd: new URL("../workers/line/", import.meta.url) };
    return (
      (await run("go", ["vet", "./..."], options)) &&
      (await run("go", ["test", "-race", "-parallel", "4", "./..."], options))
    );
  })(),
  run(process.execPath, [
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=4",
    ...files,
  ]),
]);
process.exitCode = !interrupted && results.every(Boolean) ? 0 : 1;
