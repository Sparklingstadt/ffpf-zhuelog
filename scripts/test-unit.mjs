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

const files = await testFiles("tests/");
const goDir = new URL("../services/api/", import.meta.url);
const [nodePassed, goPassed] = await Promise.all([
  run(process.execPath, [
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=4",
    ...files,
  ]),
  // The Go API lives in its own module; vet then test, concurrently with Node.
  run("go", ["vet", "./..."], { cwd: goDir }).then(
    (vetPassed) =>
      vetPassed && run("go", ["test", "-race", "./..."], { cwd: goDir }),
  ),
]);
process.exitCode = !interrupted && nodePassed && goPassed ? 0 : 1;
