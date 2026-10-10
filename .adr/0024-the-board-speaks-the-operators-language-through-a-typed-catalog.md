# 0024 — The board speaks the operator's language, through a typed catalog

**Status:** Accepted
**Date:** 2026-10-10

## Context

The fork's screens were written in whichever language the author was thinking in: the card page, the
new-card sheet and the run sheet in French, the project view, the PR list and the board's own chrome in
English, and Altan's upstream screens (Herd, Spaces, Settings, panes) in English. One page could mix
both. The operator asked for it to be fixed — and then for it to be *multilingual*, not just
French: so the answer cannot be strings hard-coded in a different language.

## Decision

**A catalog, one file per area, both languages side by side** (`web/src/i18n/`). A message is one entry,
`"key": { en, fr }`, checked by `defineMessages`: an entry without both languages does not compile.
Plurals are `{ one, other }` selected by a `count` param; `{name}` interpolates. `t(key, params)` reads
the current language; `useT()` is the same function plus a subscription, so a component re-renders
when the language changes. English is the source and the fallback.

**The language is a preference: `auto` (the browser: French for any `fr-*`), `fr` or `en`**, kept in
`localStorage`, set from Settings (`LanguageControl`). No server-side locale yet.

**The scope is the fork's.** Everything that is the board's — the board, projects, cards, PRs, the
sheets, the orchestrator panel — goes through the catalog. **Herd, Spaces, Settings, the panes and any
upstream file stay hard-coded English and never import `i18n`**: translating Altan's screens would put a
change in hundreds of upstream lines, and every update of his would conflict with it
([`UPSTREAM.md`](../UPSTREAM.md)). The one upstream touch is one line in `settings.tsx` mounting the
language control, like the gate control before it.

**One file per area, so no two editors share one**: `common`, `board`, `card`, `project`, `prs`,
`sheets`, `orchestrator`, `language`. Adding an area is one import in `catalog.ts`.

## What this rules out

**An i18n library** (react-i18next, Lingui, FormatJS). The need is two languages, a handful of
plurals and a typed key; ~60 lines cover it, with no runtime to learn and no extraction step.

**Translating upstream's screens.** Rejected above for its rebase cost. If upstream ever ships its own
catalog, the fork adopts that one and this ADR is superseded.

**Strings hard-coded in French "for now".** That is the state this ADR ends.

## Consequences

- A missing translation is a type error, not a hole found on a phone.
- Tests that check text set the language explicitly (`setPreference`); none relies on jsdom's.
- **Not covered yet:** what the *bridge* writes for people — bell and push subtitles, route error
  messages, the lead's and orchestrator's own wording. They need the locale to reach the bridge (a
  header, or a board pref), which is its own decision. Dates and relative times (`timeAgo`) are upstream's
  and stay English until then.
