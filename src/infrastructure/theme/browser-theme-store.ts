import {
  isDarkTheme,
  parseThemePreference,
  type ThemePreference,
} from "../../domain/preferences/theme";
import { SYSTEM_DARK_QUERY, THEME_STORAGE_KEY } from "./theme-bootstrap";

const THEME_CHANGE_EVENT = "zhuelog:theme-change";

export function getThemeSnapshot(): ThemePreference {
  return parseThemePreference(document.documentElement.dataset.themePreference);
}

export function getServerThemeSnapshot(): ThemePreference {
  return "system";
}

function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.classList.toggle(
    "dark",
    isDarkTheme(preference, window.matchMedia(SYSTEM_DARK_QUERY).matches),
  );
}

export function setThemePreference(preference: ThemePreference) {
  applyTheme(preference);
  let saved = true;
  try {
    if (preference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    saved = false; // Switching still works when browser storage is disabled.
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  return saved;
}

export function subscribeToTheme(onChange: () => void) {
  const media = window.matchMedia(SYSTEM_DARK_QUERY);
  const syncSystem = () => {
    applyTheme(getThemeSnapshot());
    onChange();
  };
  const syncStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    applyTheme(parseThemePreference(event.newValue));
    onChange();
  };
  // Also catches an OS theme change between the early script and hydration.
  syncSystem();
  media.addEventListener("change", syncSystem);
  window.addEventListener("storage", syncStorage);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("pageshow", syncSystem);
  return () => {
    media.removeEventListener("change", syncSystem);
    window.removeEventListener("storage", syncStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("pageshow", syncSystem);
  };
}
