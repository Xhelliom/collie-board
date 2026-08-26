// The ONE place a notification's title and body are composed. All three surfaces render through it —
// the push (notifications.ts / notify-subtitle.ts), the in-app toast (use-transitions.ts) and the
// bell (notification-bell.tsx) — so a better sentence is written once and lands on all three
// (NOTIFY_AUDIT.md §1.3, card N9). Before this, three separate codes composed the same facts at three
// levels of richness, and the push — the only surface that counts with the phone in a pocket — was
// the poorest of the three.
//
// THIS FILE EXISTS TWICE, BYTE FOR BYTE: `bridge/notify-content.ts` and `web/src/lib/notify-content.ts`.
// The bridge and the web app build from separate source trees on purpose (see the header of
// web/src/lib/types.ts), which rules out importing across the boundary — the same trade already made
// for `paneDisplayName`. What is new is that the duplicate cannot rot: `notify-content.test.ts` diffs
// the two copies and fails the build the moment they drift. Edit one, copy it over the other.
//
// THE SUBJECT IS THE WORK, NOT THE WORKER (§3.1-3.2): the card title when the pane backs one, the
// repo otherwise. The agent name is deliberately gone — herdr reports the pane KIND ("claude") and
// not the session name Collie picked, so it was the same word on every notification, and a constant
// is not a discriminant (§2.1). The BRANCH is deliberately absent too: it is a slug of the card title
// (`branchFromTitle`) and only exists on card-backed panes, so it could only ever write the subject
// twice (§3.4).
//
// AND NOTHING REPEATS. The repo appears EXACTLY ONCE: as the subject when there is no card, in the
// body when there is. The body never falls back to the subject the way `cardTitle ?? cwd` did (§2.2)
// — an empty body beats an echo.
//
// THE MARKER NAMES WHAT IS LEFT TO DO, NOT WHAT THE PANE DID (§4.1, card N4). A pane that finishes on
// a card the board has since moved to `review` reads `Review`, not `Done` — the session is over, the
// reading is not — and {@link notifyCardId} sends the tap to that card instead of the terminal, which
// is precisely the place with nothing left to do. Both read the SAME `cardStatus`, so the sentence and
// the destination can never disagree; §4.3's edge cases all fall out of that one condition being false
// (a card the operator moved back by hand, a pane with no card at all: `Done`, tap to the pane).

/** Just the corner of an alert the composition reads — a plain shape, so a test passes a literal. */
export interface NotifySubject {
  status: "blocked" | "done";
  cwd: string;
  cardTitle?: string;
  /**
   * The herd session, when it isn't the primary one. In-app surfaces only: it says WHERE to go look,
   * which a history row and a toast have room for and a lock screen does not — so the push leaves it
   * unset and the same composition serves both.
   */
  session?: string;
  /**
   * The card this pane backs and its status AS OF THE MOMENT THE ALERT FIRES — not of the transition
   * that armed it. The distinction is the whole feature: `reconcile()` moves a finished pane's card
   * to `review` on `onUpdate`, i.e. AFTER the same poll's transition loop, so at `onTransition` the
   * card still reads `working`. By the time the 30s debounce expires it has been reconciled ~20 times
   * over (§4.2) — which is why the bridge reads it in the coordinator's pre-fire hook, and why the
   * in-app surfaces can read it straight off the snapshot they diffed.
   */
  cardId?: string;
  cardStatus?: string;
}

/**
 * The short repo name behind a pane's cwd. A card pane runs in `<…>/worktrees/<repo>/<branch>`, where
 * the last segment is the BRANCH — hence the `worktrees` anchor rather than a bare basename, which is
 * right everywhere else (a hand-launched pane sits in the checkout itself).
 */
export function repoOf(cwd: string): string {
  const parts = cwd.replace(/\/+$/, "").split("/");
  const i = parts.lastIndexOf("worktrees");
  return (i >= 0 ? parts[i + 1] : undefined) || parts[parts.length - 1] || cwd;
}

/**
 * Title + body for a single outstanding alert. `subtitle` is what actually happened — the copilot's
 * sentence, the agent's own last transcript line, the diff stat, or null before any of them has
 * landed (notify-subtitle.ts renders the same shape again once one does; the toast is gone too fast
 * to ever carry one, so it always passes null).
 */
export function notifyContent(a: NotifySubject, subtitle: string | null): { title: string; body: string } {
  const repo = repoOf(a.cwd);
  const subject = a.cardTitle || repo;
  const marker = a.status === "blocked" ? "Needs you" : a.cardStatus === "review" ? "Review" : "Done";
  return {
    title: `${marker} · ${subject}`,
    // The repo is omitted exactly when it IS the subject — which is what keeps it to one appearance.
    body: [a.session, subject === repo ? null : repo, subtitle].filter((p): p is string => !!p).join(" · "),
  };
}

/**
 * Where a tap should land: the CARD when the notification is about a card to read (the `Review`
 * marker above), else undefined — the pane, exactly as before. Shared by all three surfaces (the
 * push payload, the toast, the bell) so the marker and the destination stay one decision.
 */
export function notifyCardId(a: NotifySubject): string | undefined {
  return a.cardStatus === "review" ? a.cardId : undefined;
}
