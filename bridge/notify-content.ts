// The ONE place a push's title and body are composed. Both the coordinator's first, plain push
// (notifications.ts) and every later subtitle update (notify-subtitle.ts) render through it, so the
// two can never drift into two different sentences about the same alert — the drift that used to
// hand a perfectly-rewritten subtitle back a title still reading "claude is done".
//
// THE SUBJECT IS THE WORK, NOT THE WORKER (NOTIFY_AUDIT.md §3.1-3.2): the card title when the pane
// backs one, the repo otherwise. The agent name is deliberately gone — herdr reports the pane KIND
// ("claude") and not the session name Collie picked, so it was the same word on every notification,
// and a constant is not a discriminant (§2.1). The BRANCH is deliberately absent too: it is a slug of
// the card title (`branchFromTitle`) and only exists on card-backed panes, so it could only ever
// write the subject twice — its place is the bell, not the push (§3.4).
//
// AND NOTHING REPEATS. The repo appears EXACTLY ONCE: as the subject when there is no card, in the
// body when there is. The body never falls back to the subject the way `cardTitle ?? cwd` did (§2.2)
// — an empty body beats an echo.

import { basename } from "./repos.ts";

/** Just the corner of an `Alert` the composition reads — a plain shape, so a test passes a literal. */
export interface NotifySubject {
  status: "blocked" | "done";
  cwd: string;
  cardTitle?: string;
}

/**
 * The short repo name behind a pane's cwd. A card pane runs in `<…>/worktrees/<repo>/<branch>`, where
 * the last segment is the BRANCH — hence the `worktrees` anchor rather than a bare basename, which is
 * right everywhere else (a hand-launched pane sits in the checkout itself).
 */
export function repoOf(cwd: string): string {
  const parts = cwd.replace(/\/+$/, "").split("/");
  const i = parts.lastIndexOf("worktrees");
  return (i >= 0 ? parts[i + 1] : undefined) || basename(cwd);
}

/**
 * Title + body for a single outstanding alert. `subtitle` is what actually happened — the copilot's
 * sentence, the agent's own last transcript line, or null before either has landed (notify-subtitle.ts
 * renders the same shape again once one does).
 */
export function notifyContent(a: NotifySubject, subtitle: string | null): { title: string; body: string } {
  const repo = repoOf(a.cwd);
  const subject = a.cardTitle || repo;
  const marker = a.status === "blocked" ? "Needs you" : "Done";
  return {
    title: `${marker} · ${subject}`,
    // The repo is omitted exactly when it IS the subject — which is what keeps it to one appearance.
    body: [subject === repo ? null : repo, subtitle].filter((p): p is string => !!p).join(" · "),
  };
}
