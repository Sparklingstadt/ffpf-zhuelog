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
const pluginImports = ["@ffpf-zhuelog/*-plugin", "@ffpf-zhuelog/*-plugin/**"];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Flat config lets a later block replace a rule, so the core and plugin
  // blocks repeat packageBoundaries.
  {
    files: ["packages/**/*.{ts,tsx,mts}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: packageBoundaries }],
    },
  },
  {
    files: ["packages/core/**/*.{ts,tsx,mts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...packageBoundaries,
            {
              group: pluginImports,
              message: "core は個別の連携プラグインを import しません。",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/*-plugin/**/*.{ts,tsx,mts}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...packageBoundaries,
            {
              group: [
                "@ffpf-zhuelog/core/domain/**",
                "@ffpf-zhuelog/core/application/**",
              ],
              message:
                "プラグインは @ffpf-zhuelog/core/integration だけを使ってください。",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/composition/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: pluginImports,
              message:
                "連携プラグインの登録は src/composition/ だけで行ってください。",
            },
          ],
        },
      ],
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
