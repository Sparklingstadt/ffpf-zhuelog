import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// The inner layers (domain, application) stay framework-free and never reach
// into the outer layers.
const innerLayerBoundaries = [
  {
    regex: "^@/(?!(domain|application)/)",
    message:
      "domain・application から外側の層（infrastructure・presentation・composition・app）を import しないでください。",
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
    message:
      "domain・application をフレームワークやDBに依存させないでください。",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "src/domain/**/*.{ts,tsx,mts}",
      "src/application/**/*.{ts,tsx,mts}",
    ],
    rules: {
      "no-restricted-imports": ["error", { patterns: innerLayerBoundaries }],
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
    // VuePress output for docs-site.
    "docs-site/.vuepress/.temp/**",
    "docs-site/.vuepress/.cache/**",
    "docs-site/.vuepress/dist/**",
    // Claude Code worktrees live here. Git skips them via .git/info/exclude,
    // which ESLint does not read.
    ".claude/**",
  ]),
]);

export default eslintConfig;
