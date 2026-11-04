import { useEffect, useRef, useState } from "react";

import { t } from "@/i18n";

// Shown as the `title` of a disabled copy button — one string so every copy affordance in the app
// explains itself identically.
export const copyUnavailableTitle = () => t("pane.copy.unavailable");

// `navigator.clipboard` only exists in a secure context; plain `http://host:port` on a tailnet is a
// supported deploy, where the legacy `execCommand("copy")` still works from a tap.
function canCopyText(): boolean {
  if (typeof window === "undefined") return false;
  if (window.isSecureContext && navigator.clipboard) return true;
  return document.queryCommandSupported?.("copy") === true;
}

// Runs synchronously, so it stays inside the user gesture the browser requires.
function legacyCopy(text: string) {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.setAttribute("aria-hidden", "true");
  // Off screen, and 16px so iOS Safari does not zoom to it.
  field.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;font-size:16px";
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.appendChild(field);
  try {
    field.select();
    field.setSelectionRange(0, text.length);
    if (!document.execCommand("copy")) throw new Error("copy command refused");
  } finally {
    field.remove();
    active?.focus({ preventScroll: true });
  }
}

// Copy-to-clipboard with a brief ✓ confirmation, shared by every copy button in the app.
// `canCopy` is false only on a browser with neither the async API nor the legacy command — the
// caller disables the button there rather than show one that silently fails when tapped.
export function useCopy(confirmMs = 1500) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canCopy = canCopyText();

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy(text: string) {
    if (!canCopy) return;
    try {
      if (window.isSecureContext && navigator.clipboard) await navigator.clipboard.writeText(text);
      else legacyCopy(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), confirmMs);
    } catch {
      // clipboard denied — the source text stays readable/selectable regardless
    }
  }

  return { canCopy, copied, copy };
}
