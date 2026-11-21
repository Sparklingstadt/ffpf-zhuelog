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

// The Go tests that need Postgres skip without API_TEST_DATABASE_URL. Unless
// the caller names a database, start the one in compose.test.yaml and bring
// its tables up to date. It is left running for the next run; stop it with
// `pnpm run test:unit:stop`.
const TEST_DATABASE_URL =
  "postgresql://zhuelog_test:local-test-only@127.0.0.1:55441/zhuelog_test";

async function testDatabaseUrl() {
  if (process.env.API_TEST_DATABASE_URL)
    return process.env.API_TEST_DATABASE_URL;
  const cwd = new URL("../", import.meta.url);
  const ready =
    (await run(
      "docker",
      ["compose", "-f", "compose.test.yaml", "up", "-d", "--wait"],
      { cwd },
    )) &&
    (await run(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      { cwd, env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } },
    ));
  if (ready) return TEST_DATABASE_URL;
  if (!interrupted)
    console.error(
      "Could not prepare the test database. Start Docker, or set API_TEST_DATABASE_URL to a migrated database.",
    );
  return null;
}

async function goTests() {
  const databaseUrl = await testDatabaseUrl();
  if (!databaseUrl) return false;
  const options = {
    cwd: goDir,
    env: { ...process.env, API_TEST_DATABASE_URL: databaseUrl },
  };
  return (
    (await run("go", ["vet", "./..."], options)) &&
    (await run("go", ["test", "-race", "./..."], options))
  );
}

const files = await testFiles("tests/");
const goDir = new URL("../services/api/", import.meta.url);
const [nodePassed, goPassed] = await Promise.all([
  run(process.execPath, [
    "--import",
    "tsx",
    // Lets the Server Action tests stand in for next/headers and the like
    // (tests/helpers/next-stubs.ts).
    "--experimental-test-module-mocks",
    "--test",
    "--test-concurrency=4",
    ...files,
  ]),
  // The Go API lives in its own module; vet then test, concurrently with Node.
  goTests(),
]);
process.exitCode = !interrupted && nodePassed && goPassed ? 0 : 1;
