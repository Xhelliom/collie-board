import { useEffect, useRef, useState } from "react";

// Shown as the `title` of a disabled copy button — one string so every copy affordance in the app
// explains itself identically.
export const COPY_UNAVAILABLE_TITLE = "Copy unavailable — requires a secure context (HTTPS)";

// Copy-to-clipboard with a brief ✓ confirmation, shared by the transcript's code-block copy button,
// the terminal mirror's copy-buffer button, and the update banner's copy-command button.
// `navigator.clipboard` only exists in a secure context (same gate push.ts uses for Push) —
// `canCopy` lets the caller DISABLE the button on plain HTTP rather than show one that silently
// fails when tapped.
export function useCopy(confirmMs = 1500) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canCopy = typeof window !== "undefined" && window.isSecureContext && !!navigator.clipboard;

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy(text: string) {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), confirmMs);
    } catch {
      // clipboard denied — the source text stays readable/selectable regardless
    }
  }

  return { canCopy, copied, copy };
}
