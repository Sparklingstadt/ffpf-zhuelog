"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useSyncExternalStore } from "react";

import { parseThemePreference } from "@/domain/preferences/theme";
import {
  getServerThemeSnapshot,
  getThemeSnapshot,
  setThemePreference,
  subscribeToTheme,
} from "@/infrastructure/theme/browser-theme-store";

const options = [
  { value: "system", label: "システム", Icon: Monitor },
  { value: "light", label: "ライト", Icon: Sun },
  { value: "dark", label: "ダーク", Icon: Moon },
] as const;

// The color theme as radio items of the signed-in menu, so the header keeps
// one button and the arrow keys reach the choice like any other item.
export function ThemeMenuItems() {
  const preference = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );
  return (
    <DropdownMenu.RadioGroup
      aria-label="カラーテーマ"
      value={preference}
      onValueChange={(value) => {
        setThemePreference(parseThemePreference(value));
      }}
    >
      {options.map(({ value, label, Icon }) => (
        <DropdownMenu.RadioItem
          key={value}
          value={value}
          // Picking a theme keeps the menu open, to compare them.
          onSelect={(event) => event.preventDefault()}
          className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
        >
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          {label}
          <DropdownMenu.ItemIndicator className="ml-auto">
            <Check className="size-4" aria-hidden="true" />
          </DropdownMenu.ItemIndicator>
        </DropdownMenu.RadioItem>
      ))}
    </DropdownMenu.RadioGroup>
  );
}
