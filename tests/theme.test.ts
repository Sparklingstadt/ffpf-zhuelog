import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
  isDarkTheme,
  parseThemePreference,
} from "../src/domain/preferences/theme";
import {
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
} from "../src/infrastructure/theme/theme-bootstrap";

test("theme defaults to system and explicit preferences override the OS", () => {
  for (const value of [undefined, null, "", "system", "unknown", {}, ["dark"]])
    assert.equal(parseThemePreference(value), "system");
  assert.equal(parseThemePreference("dark"), "dark");
  assert.equal(parseThemePreference("light"), "light");
  assert.equal(isDarkTheme("system", true), true);
  assert.equal(isDarkTheme("system", false), false);
  assert.equal(isDarkTheme("dark", false), true);
  assert.equal(isDarkTheme("light", true), false);
});

test("early theme bootstrap handles stored choices, blocked storage and untrusted values", () => {
  for (const [stored, systemDark, expected] of [
    [null, true, true],
    [null, false, false],
    ["light", true, false],
    ["dark", false, true],
    ["system", true, true],
    ["bad-value", true, true],
    ["throw", true, true],
    ['dark";throw new Error("injected")//', false, false],
  ] as const) {
    let dark: boolean | undefined;
    const dataset: Record<string, string> = {};
    runInNewContext(THEME_BOOTSTRAP_SCRIPT, {
      document: {
        documentElement: {
          dataset,
          classList: {
            toggle(name: string, active: boolean) {
              assert.equal(name, "dark");
              dark = active;
            },
          },
        },
      },
      localStorage: {
        getItem(key: string) {
          assert.equal(key, THEME_STORAGE_KEY);
          if (stored === "throw") throw new Error("disabled");
          return stored;
        },
      },
      matchMedia() {
        return { matches: systemDark };
      },
    });
    assert.equal(dark, expected);
    assert.equal(dataset.themePreference, parseThemePreference(stored));
  }
});
