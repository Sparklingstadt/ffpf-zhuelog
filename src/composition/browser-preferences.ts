// What the browser remembers for this device (theme, whether the example
// pinyin starts hidden), for the UI components that read and change it. The
// stores themselves are infrastructure; components reach them only here.
// Safe to import from client components: nothing here touches the server.
export {
  getServerThemeSnapshot,
  getThemeSnapshot,
  setThemePreference,
  subscribeToTheme,
} from "@/infrastructure/theme/browser-theme-store";
export { THEME_BOOTSTRAP_SCRIPT } from "@/infrastructure/theme/theme-bootstrap";
export {
  getExamplePinyinSnapshot,
  getServerExamplePinyinSnapshot,
  setExamplePinyinPreference,
  subscribeToExamplePinyin,
} from "@/infrastructure/preferences/example-pinyin-store";
