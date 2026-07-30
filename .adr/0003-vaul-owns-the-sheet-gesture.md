# 0003 — Vaul owns the sheet gesture

- **Status:** Accepted
- **Date:** 2026-07-30
- **Shipped in:** 0.56.0
- **Reverses:** the `no Radix, no portals, no extra deps` note that stood at the top of
  `web/src/components/ui/sheet.tsx` since 0.1.0

## Context

`sheet.tsx` was a hand-rolled bottom sheet, and deliberately so. The UI audit of 0.40.0
(`UI_AUDIT.md` §7) found eight distinct defects in it, and split them in two:

- **Bugs** — a pull that started in a field or a list armed the pull-to-dismiss and closed the sheet
  instead of scrolling it; the drag offset survived the close and replayed on the next open; `onClose`
  sat in the effect dependency arrays, so every 1.5 s poll tore the touch listeners down mid-gesture;
  no body-scroll lock; a `setState` per touchmove frame; and closing was not animated at all.
- **Physics** — no dismiss on velocity, so a flick (the first gesture anyone tries) did nothing; a
  fixed 90 px close threshold regardless of whether the panel was 200 px or 700 px tall; a hard stop
  at the top edge instead of elastic resistance; and a fixed 200 ms return whatever the distance.

The audit was explicit that these must not be conflated: *adopting a dependency to work around three
twenty-line bugs does not defend itself*. So the bugs were fixed by hand first, in `5151295`
(0.49.0) — all of the first group, closing animation included — and this decision was deferred until
the gesture could be judged on a real phone with those fixes in it. It was, on 2026-07-30, on both
Android and iOS. **The gesture still felt wrong**, and it failed exactly where the second group
predicted: a flick does nothing, and the wrist commitment a dismiss takes depends on nothing sensible.

That is the whole case. A bug is fixed once and stays fixed; a *feel* is tuned by trial, and trial
against a physical device is the one loop that does not converge by reading code. The remaining
twenty-odd lines (§E6b–d) are easy to write and hard to write well.

### What was measured, not assumed

The audit made the bundle a precondition rather than a talking point. Two production builds of the
**same tree**, 0.49.3, with and without the dependency — that pairing is what isolates Vaul's cost
from everything else shipping at the same time:

| | JS raw | **JS gzip** | CSS gzip |
| --- | --- | --- | --- |
| hand-rolled | 565.24 kB | **167.22 kB** | 10.02 kB |
| Vaul | 629.90 kB | **187.55 kB** | 9.92 kB |
| delta | +64.66 kB | **+20.33 kB (+12.2 %)** | −0.10 kB |

**+20.2 kB gzip over the wire, once, on a PWA that precaches.** That is the real price, and it is
the strongest argument that was available against this decision.

Don't read the absolute figures as current: 0.56.0 ships at 189.66 kB gzip because the composer
redesign, the copy buttons and the light/dark theme all landed alongside. The **delta** is the number
this decision was made on, and re-measuring it means building the same commit twice, not diffing two
releases.

Two claims in the audit did not survive contact and are corrected here:

- It counted **two** new dependencies (`vaul` + `@radix-ui/react-dialog`). It is one direct
  dependency, which pulls **sixteen** `@radix-ui/*` packages transitively. The runtime dependency
  list in `web/package.json` goes from seven to eight; `node_modules` grows by seventeen.
- It counted `repositionInputs` as a clear win because *"the hand-rolled version does nothing for the
  keyboard"*. That is half true: `index.html` already sets
  `interactive-widget=resizes-content`, which handles Chrome. **Safari ignores it**, so on iOS —
  half the target — the four sheets with fields genuinely had nothing. `repositionInputs` (on by
  default, driven by `visualViewport`) is what covers that half.

### What was checked before committing

- **CSP.** Vaul injects its stylesheet by appending a `<style>` element at import time. The bridge
  serves `style-src 'self' 'unsafe-inline'` (`bridge/server.ts:70`), so it is allowed. Had that
  directive been tightened, the drawer would have lost every animation *silently* — worth knowing
  before anyone hardens it.
- **The long-press regression.** `backdropArmed` was a hand-written copy of Radix's
  outside-*pointerdown* rule, and it existed because a long-press that opens a sheet still has a
  finger down: the release `click` lands on the backdrop and used to dismiss instantly. Radix gets
  this right by construction, so the guard is deleted — and a test now states the rule out loud
  rather than trusting it.

## Decision

**Vaul owns the sheet gesture.** `BottomSheet` and `SideSheet` are two calls to one internal
`SheetShell` over `Drawer.Root`, one `direction` prop apart. Their public props are unchanged, so all
nine call sites moved without edits.

Three things stay ours, because the library's defaults are wrong for this app:

1. **`data-vaul-no-drag` on everything below the header.** Vaul arms the drag from anywhere on the
   panel that is not marked, and its scroll heuristic does not exempt a field at `scrollTop === 0` —
   which is precisely the reported bug. The header (handle, title, ✕) is the grab zone: always
   visible, far bigger than a handle, and impossible to confuse with the content.
2. **Focus placement, both ways.** Vaul's `autoFocus` defaults to false, which strands the user
   behind the modal; Radix's own default takes the first tabbable, which here is the ✕ — an Enter
   right after opening would close what you just opened. The panel takes focus itself. On the way
   out, Radix hands focus to its `Trigger`, and these sheets have none (the caller owns `open`), so
   the opener is remembered and restored explicitly.
3. **The grab handle.** Ours, not `Drawer.Handle`, which ships a hard-coded light-grey background
   that would fight the theme tokens.

## Consequences

- **+20.2 kB gzip**, and a UI dependency with one maintainer on an app meant to last. Accepted
  knowingly; this is the number to re-check if it ever stops being worth it.
- **`sheet.tsx` is now an upstream file we have rewritten**, so it joins the table in `UPSTREAM.md`.
  It also stops being a clean cherry-pick for upstream: brick 9 in `UPSTREAM_PRS.md` is the *bug fix*
  at `5151295`, and it must be offered from that commit, never from the current file — upstream has
  not taken this dependency and this ADR is not an argument that it should.
- **Nine tests became four contracts.** The suite no longer simulates a drag: the physics is Vaul's
  and is tested there, and a jsdom re-enactment of pointer capture would only assert our own fake.
  What is tested is what this repo actually configures — labelling, the single accessible Close, the
  four dismiss paths, where focus lands, and which regions are marked no-drag.
- **jsdom needed a shim.** It implements pointer events but not pointer *capture*, which Vaul claims
  on every pointerdown; without `setPointerCapture` in `web/src/test/setup.ts` the suite stayed green
  while throwing 54 uncaught errors.
- **`session-switcher.tsx` lost its manual `createPortal`** — it existed only because the hand-rolled
  sheet was not portaled and an ancestor `backdrop-filter` could clip it.
- **§E6b–d are moot**, and so is most of §E7: a side drawer on desktop is now
  `direction="right"` rather than a second component. That is a separate card, and it still needs the
  `useMediaQuery` the repo does not have.

**What would justify revisiting this:** the gesture is the only thing bought here. If a future Vaul
release regresses it, or the dependency goes unmaintained, the fallback is not to fork Vaul — it is
to re-implement §E6b–d over the shell this change left behind, which is a smaller job than the
original hand-rolled sheet was, and delete the dependency.
