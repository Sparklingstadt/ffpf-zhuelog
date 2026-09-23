import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// CI/deployment archives need neither Git hooks nor development dependencies.
const root = fileURLToPath(new URL("../", import.meta.url));
const lefthook = fileURLToPath(
  new URL("../node_modules/lefthook/bin/index.js", import.meta.url),
);
if (process.env.CI || process.env.VERCEL || !existsSync(lefthook)) {
  console.log(
    "Skipping Git hooks in CI/deployment or without dev dependencies.",
  );
} else {
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: root,
    encoding: "utf8",
  });
  if (git.status !== 0 || git.stdout.trim() !== root.replace(/\/$/, "")) {
    console.log("Skipping Git hooks outside the project Git repository.");
  } else {
    const result = spawnSync(process.execPath, [lefthook, "install"], {
      cwd: root,
      stdio: "inherit",
    });
    process.exitCode = result.status ?? 1;
  }
}
