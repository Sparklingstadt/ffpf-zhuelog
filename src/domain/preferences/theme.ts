export type ThemePreference = "system" | "light" | "dark";

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function isDarkTheme(preference: ThemePreference, systemDark: boolean) {
  return preference === "dark" || (preference === "system" && systemDark);
}
