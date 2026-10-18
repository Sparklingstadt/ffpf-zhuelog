import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Workspace packages stay framework-free and never reach into the app.
const packageBoundaries = [
  {
    group: ["@/**"],
    message: "パッケージからアプリの内部（src/）を import しないでください。",
  },
  {
    group: [
      "next",
      "next/**",
      "react",
      "react/**",
      "react-dom",
      "react-dom/**",
      "@prisma/**",
    ],
    message: "パッケージをフレームワークやDBに依存させないでください。",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["packages/**/*.{ts,tsx,mts}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: packageBoundaries }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    // Claude Code worktrees live here. Git skips them via .git/info/exclude,
    // which ESLint does not read.
    ".claude/**",
  ]),
]);

export default eslintConfig;
