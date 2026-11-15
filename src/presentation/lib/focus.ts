// Moves focus to the button that just appeared. Unlike autoFocus it does not
// center the button: the page stays where it is, so the progress bar stays
// in view, unless the button is out of sight (on a phone, below the bottom
// tabs), when it scrolls just far enough to show it.
export function focusInPlace(button: HTMLButtonElement | null) {
  if (!button) return;
  button.focus({ preventScroll: true });
  button.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
}

export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}
