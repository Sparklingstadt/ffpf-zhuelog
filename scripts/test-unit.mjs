import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";

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

async function testFiles(dir) {
  const names = await readdir(new URL(`../${dir}`, import.meta.url)).catch(
    (error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  return names
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => `${dir}${name}`);
}

// App tests live in tests/; each workspace package keeps its own tests/.
const packages = (
  await readdir(new URL("../packages/", import.meta.url), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const files = [
  ...(await testFiles("tests/")),
  ...(
    await Promise.all(
      packages.map((name) => testFiles(`packages/${name}/tests/`)),
    )
  ).flat(),
];
const passed = await run(process.execPath, [
  "--import",
  "tsx",
  "--test",
  "--test-concurrency=4",
  ...files,
]);
process.exitCode = !interrupted && passed ? 0 : 1;
