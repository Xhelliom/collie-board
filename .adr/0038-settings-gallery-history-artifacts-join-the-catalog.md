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
