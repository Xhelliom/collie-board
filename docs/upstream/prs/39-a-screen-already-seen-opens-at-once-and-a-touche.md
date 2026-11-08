# 39. 🔵 A screen already seen opens at once, and a touched link starts loading

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

A navigation waited on every loader of its target, even to a screen just left: a back from a card
to its project cost as much as the first visit (≈ 0.57 s at phone throttling), and an ETag only turns
a refetch into a 304, still a round trip. `lib/nav-cache.ts` keeps each polled loader's last result
per URL: a **navigation** returns it at once and one `revalidate()` runs when it is on screen; a
**revalidation** (the poll) always fetches and refreshes the entry. The two are told apart by
`router.state.navigation.state`, which holds for a POP too. A delegated `pointerover`/`pointerdown`
listener starts a link's loader before the tap lands, and the navigation joins that load. Upstream
has the root and pane loaders to wrap; the board's loaders are fork-only. No timer.

| | |
|---|---|
| Commit | *Navigation : un écran déjà vu s'affiche tout de suite, un lien touché commence à charger* |
| Files | `web/src/lib/nav-cache.ts` (+ test, new), `web/src/lib/loaders.ts` (root and pane loaders wrapped), `web/src/router.tsx` (one call) |
| Extraction | **Needs extraction**: drop the hunks in `board-loaders.ts`, and the prefetched-link pattern (`/board/project`, `/card/`) has no upstream equivalent — upstream would prefetch nothing, or `/pane/` once its loader's offline discriminator moves to the router state too. |
