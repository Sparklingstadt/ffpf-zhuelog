"use client";

import { useState, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemePreference } from "@/domain/preferences/theme";
import {
  getServerThemeSnapshot,
  getThemeSnapshot,
  setThemePreference,
  subscribeToTheme,
} from "@/infrastructure/theme/browser-theme-store";
import { Button } from "@/presentation/components/ui/button";

const options = [
  { value: "system", label: "システム", Icon: Monitor },
  { value: "light", label: "ライト", Icon: Sun },
  { value: "dark", label: "ダーク", Icon: Moon },
] as const;

export function ThemeSwitcher() {
  const preference = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );
  const [saveFailed, setSaveFailed] = useState(false);

  function selectTheme(value: ThemePreference) {
    setSaveFailed(!setThemePreference(value));
  }

  return (
    <div className="relative">
      <div
        role="group"
        aria-label="カラーテーマ"
        className="flex items-center gap-0.5 rounded-lg border bg-card p-0.5"
      >
        {options.map(({ value, label, Icon }) => (
          <Button
            key={value}
            type="button"
            variant={preference === value ? "secondary" : "ghost"}
            aria-pressed={preference === value}
            onClick={() => selectTheme(value)}
            size="icon-sm"
            title={label}
          >
            <Icon aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </Button>
        ))}
      </div>
      {saveFailed ? (
        <p
          role="status"
          className="absolute top-full right-0 mt-2 w-64 rounded-lg border bg-popover p-2 text-xs text-popover-foreground shadow-md"
        >
          端末に設定を保存できないため、この画面内だけで切り替えます。
        </p>
      ) : null}
    </div>
  );
}
