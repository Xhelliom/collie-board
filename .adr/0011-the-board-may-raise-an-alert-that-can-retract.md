# 0011 — The board may raise its own alerts, if they can retract

- **Status:** Accepted
- **Date:** 2026-09-01 (arbitration rendered 2026-08-26)
- **Shipped in:** 0.129.0 → 0.133.0

## Context

Until 0.129.0 exactly three facts could reach a phone, and all three were about a **pane**: an agent
went `blocked`, an agent went `done`, and — since N4 — a `done` whose card had just landed in
`review`. Nothing else in the product had standing to speak. But the pane is the instrument, not the
work: what you reopen the app to check is a card, and the facts the board holds and no pane can
possibly report are exactly the ones that go unseen. A card whose pane vanished from the snapshot. A
handoff that expired without ever landing, leaving a session nobody will restart. A copilot verdict
rendered ten minutes after you stopped watching. Each of those is written to the card's journal, and
the journal is only legible if you are already on the card — which is precisely where you are not.

So: **is the board allowed to notify?** The question was put and answered in
[`NOTIFY_AUDIT.md` §6](../NOTIFY_AUDIT.md) — a twelve-event census (B1…B12) with an arbitration
above it. Four forces shaped that answer, and they are why this is an architecture decision and not
an implementation detail:

- **Reversibility is the coordinator's whole premise.** `NotificationCoordinator` debounces, coalesces
  into one slot and counts a digest by state, and every one of those behaviours assumes an alert
  *stops being true*. A pane alert erases itself because the pane changes state. A board fact is
  **punctual**: `review.created` is true once and never becomes false again. Dropped into the herd's
  slot as-is, it would sit there for ever and the digest would keep announcing "1 to review" for a
  card read three days ago.
- **The pipeline was indexed by `paneId` end to end** — the coordinator's maps, `FiredAlert.paneId`,
  the deep-link read off the map key, the history entry. Letting a card in means paying that down.
- **No new loop** (`CLAUDE.md` §The board). Anything periodic hangs off `engine.onUpdate`.
- **A second channel is the obvious shape and the wrong one.** A `collie:board` tag, a "board alerts"
  category, a preference per event: each looks like separation of concerns and each hands the operator
  two places to mute one herd.

**Why this file exists although the audit declined to write it.** §6.5 argued that an ADR closes an
option someone will re-propose, whereas this arbitration *opens* — so the rule belonged in `CLAUDE.md`
and nowhere else. That reading was half right. The permission opens; everything attached to it
**closes**, and those are the parts that get re-proposed: the second channel, the per-event
preference, the per-event digest word, the fact that notifies without knowing how it stops. `CLAUDE.md`
carries the rule in three lines and, per `.adr/README.md`, links here for the argument. The audit's
own non-decision is struck in place (§6.5) rather than rewritten — it was reasonable, and it was
about *where the reasoning lives*, not about what was decided.

## Decision

**The board may raise its own alerts.** Nothing justifies reserving notification to pane transitions:
what the board knows and the pane does not — a card gone unrunnable, a verdict rendered, a handoff
that never landed — is what the operator opens the app to find.

**But a fact emits only if it passes three tests, and it reaches the phone only if it can retract.**

**Test 1 — nobody asked for it just now.** A merge, a PR, a card start are awaited by their route: the
HTTP response *is* the notification, your finger is on it, and a push over the top is noise
(`integrate.ts` says it already for its five gestures — "all five are TAPS"). Only facts whose tail is
asynchronous and outlives the tap that started it, or that nobody asked for at all, pass.

**Test 2 — it opens an action, it does not narrate.** "The card moved to `working`" is journal. "The
worktree could not be removed" is a decision waiting. `db.recordEvent` exists for everything else and
is already rendered on the card screen; a fact that opens nothing stays there.

**Test 3 — no pane already says it.** A card entering `review` because an agent finished is carried by
that pane's `done` transition (N4) and has no board alert of its own. Otherwise the same fact buzzes
twice down two paths with no way to know about each other. `reconcile()` writing a column is the pane
speaking, not the board.

**The condition — a board alert must carry a readable retraction predicate**, evaluated on
`engine.onUpdate` beside the trigger: "the card left `orphaned`", "it got a new session", "it left
`review`". **A fact that cannot say when it stops being true does not reach the phone at all** — it
goes to the bell, which is a story rather than a state, or nowhere.

**And there is no second channel.** Board facts enter the *same* `collie:herd` slot, the same digest,
the same snooze, the same preferences screen. The only admitted loosening is **by surface**: some facts
earn the bell and not the vibration (B7, B10), and the three surfaces have been separable since N9.

**The trigger is the journal, tailed on `engine.onUpdate`.** `event` (`db.ts`) is append-only with an
autoincrement primary key and already carries all thirty-odd facts, written by the code that performs
them. `bridge/board-notify.ts` reads `WHERE id > ?` from an **in-memory** cursor seeded at
`lastEventId()` — the sixth `onUpdate` consumer, beside `reconcile` and the four coordinators. One
range scan per tick returning zero rows in the normal case; a restart resumes from now and never
replays the past; and a fact cannot be missed between two polls the way a state diff can, because the
journal is written by the **action**, not derived from a state.

### What this closes

- **"Give board alerts their own tag / category / channel."** No: two mute switches for one herd.
- **"One preference per event."** No: the settings screen would become the census of §6.3. One boolean
  per **family** — `board` (on) for work that stopped, `ready` (off) for a door that opened.
- **"One digest word per event", "file them under the existing words", or "keep them out of the
  digest".** No, no, and no: `Stalled` is one new state for B1 and B5 together (both mean *the work
  stopped and nothing will restart it*), `Ready` is the second only because it opens instead of
  demanding, filing a stalled card under `Needs you` would make a digest say "4 questions" where
  nobody asked one, and excluding them from the digest re-invents the second channel. Order:
  `Needs you` · `Stalled` · `Review` · `Done` · `Ready`.
- **"Diff the snapshot to find board facts."** No: a diff misses whatever happened between two polls.
- **"Poll GitHub for a PR merged by someone else" (B9).** No — it is a network poll, and the honest
  alternative is a webhook, which needs an ingress [ADR 0001](./0001-one-managed-front-door.md) does
  not allow. This one stays closed while that posture holds.
- **"A retraction predicate per fact."** Not needed: one fingerprint — column, session id, handoff
  request — covers all four shipped facts, because all four answer the same way.

## Consequences

- **`notifications.ts` gave up the assumption that an alert is a pane**, and that is the bill: an
  opaque key with public `arm`/`retract`, `paneId` optional on `Alert`, the deep-link read off the
  alert instead of the map key. It is a deep cut in an upstream file, priced in and recorded — brick
  28 of [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md) ("a coordinator that doesn't assume its alerts are
  panes" is generic; only the words `stalled` and `ready` are fork-shaped).
- **The bell's bar is lower than the phone's, by exactly one condition.** A story is never taken back,
  so B2/B7/B10 reach `NotifyLog.add()` in the clear — no coordinator, no debounce, no predicate. That
  asymmetry is the cheap lane, and it shipped first (0.129.0) with `notifications.ts` untouched.
- **Every future board fact owes the same four answers** before it can be added to `alarm()`, and the
  fallback is not "ship it anyway" but the bell. `board-notify.ts`'s `tell`/`alarm`/`unblocks` are
  where that editorial judgement lives, in one place, on purpose.
- **The retraction costs two indexed reads per armed alert per tick** — normally none. A card whose
  alert the preference refused still costs them until it moves (`arm` reports nothing back); bounded,
  self-clearing, and marked `ponytail:` at the map.
- **Same-tick alerts still send one message each.** A restarted herdr orphans the whole board in one
  tick; the slot coalesces them into one *notification* ("4 stalled") but they arrive as four renders,
  because the timers come due together and each `fire()` completes before the next runs. Collapsing
  them needs the render deferred by a macrotask, which changes when every caller sees one — the
  ceiling is written at `emit()` rather than half-fixed.
- **What would justify revisiting:** a board fact worth waking a phone for that genuinely has no
  readable end state. The answer today is the bell, and it should stay the answer until an actual fact
  makes it feel wrong — inventing a timeout so a punctual fact can pretend to retract would be a gauge
  that is quietly wrong, which §The board forbids on its own terms.
