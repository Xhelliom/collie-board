// The board's look: Sémaphore (the default since 13/11) or the classic palette it replaced. Stored
// like the theme mode, applied as `data-style` on <html>; index.css carries the classic tokens.

export type UiStyle = "semaphore" | "classic";

const STORAGE_KEY = "collie:style";

export function loadUiStyle(): UiStyle {
  try {
    return localStorage.getItem(STORAGE_KEY) === "classic" ? "classic" : "semaphore";
  } catch {
    return "semaphore";
  }
}

export function applyUiStyle(style: UiStyle): void {
  if (style === "classic") document.documentElement.dataset.style = "classic";
  else delete document.documentElement.dataset.style;
}

export function saveUiStyle(style: UiStyle): void {
  applyUiStyle(style);
  try {
    if (style === "semaphore") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, style);
  } catch {
    // Private mode: the choice holds for this visit only.
  }
}
