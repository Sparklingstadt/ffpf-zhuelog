export const THEME_STORAGE_KEY = "zhuelog:theme:v1";
export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

// Fixed first-party source only. No user-controlled value is interpolated into
// executable code. The CSP nonce is supplied by the server root layout.
// Run in <head> before the body paints, independently of React hydration.
export const THEME_BOOTSTRAP_SCRIPT = `(() => {
  let preference = "system";
  try {
    const stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    if (stored === "light" || stored === "dark") preference = stored;
  } catch {}
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.classList.toggle("dark", preference === "dark" ||
    (preference === "system" && matchMedia(${JSON.stringify(SYSTEM_DARK_QUERY)}).matches));
})();`;
