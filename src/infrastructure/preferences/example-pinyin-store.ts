import {
  parseExamplePinyinPreference,
  type ExamplePinyinPreference,
} from "@/domain/preferences/example-pinyin";

// Kept on this device only, like the theme. Nothing goes to the database.
export const EXAMPLE_PINYIN_STORAGE_KEY = "zhuelog:example-pinyin:v1";
const CHANGE_EVENT = "zhuelog:example-pinyin-change";

// The choice made in this page when the browser cannot store it.
let unsaved: ExamplePinyinPreference | null = null;

export function getExamplePinyinSnapshot(): ExamplePinyinPreference {
  if (unsaved) return unsaved;
  try {
    return parseExamplePinyinPreference(
      localStorage.getItem(EXAMPLE_PINYIN_STORAGE_KEY),
    );
  } catch {
    return "shown";
  }
}

export function getServerExamplePinyinSnapshot(): ExamplePinyinPreference {
  return "shown";
}

// Saves the choice and tells every subscriber in this page. Returns false
// when the browser refused to store it (the choice still holds in the page).
export function setExamplePinyinPreference(
  preference: ExamplePinyinPreference,
): boolean {
  let saved = true;
  try {
    if (preference === "shown")
      localStorage.removeItem(EXAMPLE_PINYIN_STORAGE_KEY);
    else localStorage.setItem(EXAMPLE_PINYIN_STORAGE_KEY, preference);
    unsaved = null;
  } catch {
    saved = false;
    unsaved = preference;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return saved;
}

// Follows changes made in this page and in other tabs.
export function subscribeToExamplePinyin(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === EXAMPLE_PINYIN_STORAGE_KEY || event.key === null)
      onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
