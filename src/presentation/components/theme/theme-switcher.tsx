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
    <div className="flex flex-col items-end gap-2">
      <div
        role="group"
        aria-label="カラーテーマ"
        className="flex items-center gap-1 rounded-xl border bg-card p-1 shadow-xs"
      >
        {options.map(({ value, label, Icon }) => (
          <Button
            key={value}
            type="button"
            variant={preference === value ? "secondary" : "ghost"}
            aria-pressed={preference === value}
            onClick={() => selectTheme(value)}
            className="h-10 gap-1.5 px-3 text-xs"
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
          </Button>
        ))}
      </div>
      {saveFailed ? (
        <p role="status" className="max-w-xs text-xs text-muted-foreground">
          端末に設定を保存できないため、この画面内だけで切り替えます。
        </p>
      ) : null}
    </div>
  );
}
