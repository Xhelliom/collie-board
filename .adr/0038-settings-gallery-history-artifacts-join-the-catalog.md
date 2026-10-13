# 0038 — Settings, gallery, history and artifacts join the catalog

**Status:** Accepted — amends [0024](./0024-the-board-speaks-the-operators-language-through-a-typed-catalog.md) on scope
**Date:** 2026-10-13

## Decision

The operator wants one language per screen, English by default with French as a translation. So
Settings, the gallery, the pane (chat, composer, history, artifacts), Spaces and the notification bell go through the catalog (`settings`,
`gallery`, `history`, `pane`, `spaces` message files), and 0024's "Settings stays hard-coded English" no longer holds.
The default preference is `en`; `auto` (follow the browser) is now an explicit choice.

## Cost

These files are upstream's, so each is a rebase conflict risk ([`UPSTREAM.md`](../UPSTREAM.md)).
Formatting inside a message uses `<c>`/`<b>` rendered by `i18n/rich.tsx`.

## Not done

The chrome around every route (idle cover, connection bars, boot splash, error screen, update banner, toasts, shared aria-labels) and the pane leaves (context gauge, agent sidebar, bell, statusline label, fold toggle) are in the catalog. Still English-only: the notification markers (`Needs you`, `Review`… in toast and bell titles) — `web/src/lib/notify-content.ts` is a byte-identical mirror of the bridge's, which composes the push. Brand names ("Collie", "Collie Board") are not translated.
