// Whether a key press is meant for a field or a shortcut of the browser, and
// so not for a page's own keys.
export function isTypingOrShortcut(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat)
    return true;
  const target = event.target as HTMLElement | null;
  return Boolean(
    target?.isContentEditable || target?.closest("input, textarea, select"),
  );
}

// Whether the key press lands on a button or a link, which Enter and Space
// already press.
export function isOnControl(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  return Boolean(target?.closest("button, a, summary"));
}
