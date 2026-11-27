import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";

// Runs the migration tests (tests/migration/*.test.ts) against a Postgres the
// tests may CREATE and DROP databases in. `pnpm run test:migration` starts the
// compose.e2e Postgres first; set MIGRATION_TEST_DATABASE_URL to use another
// server (an admin connection URL, e.g. to its "postgres" database).
const adminUrl =
  process.env.MIGRATION_TEST_DATABASE_URL ??
  "postgresql://zhuelog_e2e:local-e2e-only@127.0.0.1:55439/zhuelog_e2e";

const dir = new URL("../tests/migration/", import.meta.url);
const files = (await readdir(dir))
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => `tests/migration/${name}`);

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", "--test-concurrency=1", ...files],
  {
    stdio: "inherit",
    env: { ...process.env, MIGRATION_TEST_DATABASE_URL: adminUrl },
  },
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.once("close", (code) => {
  process.exitCode = code === 0 ? 0 : 1;
});
