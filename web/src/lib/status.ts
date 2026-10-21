import { toast } from "sonner";

// The app's status channel: a thin façade over Sonner, so the callers keep saying setStatus() and the
// one <Toaster/> in routes/root.tsx (components/ui/sonner.tsx) renders it. Sonner stacks, so a notice
// no longer overwrites the previous one.
export type StatusTone = "info" | "success" | "warn" | "error";

const SHOW = { info: toast.info, success: toast.success, warn: toast.warning, error: toast.error };

/** Standing errors, so a route change can close them and only them. */
const errors = new Set<string | number>();

/**
 * Publish a transient status. Errors persist until dismissed (✕ or swipe); everything else
 * auto-clears. Pass an explicit `ttlMs` (or `null` to persist) to override the per-tone default.
 */
export function setStatus(text: string, tone: StatusTone = "info", ttlMs?: number | null): void {
  const ttl = ttlMs === undefined ? (tone === "error" ? null : 2500) : ttlMs;
  const id = SHOW[tone](text, { duration: ttl ?? Infinity, closeButton: tone === "error" });
  if (tone === "error") errors.add(id);
}

export function clearStatus(): void {
  toast.dismiss();
  errors.clear();
}

/** Drop the standing errors — on a route change, where they would resurface with no context. Other tones fade anyway. */
export function clearErrorStatus(): void {
  for (const id of errors) toast.dismiss(id);
  errors.clear();
}
