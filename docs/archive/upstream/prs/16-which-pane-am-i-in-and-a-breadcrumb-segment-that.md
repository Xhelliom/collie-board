# 16. 🔵 Which pane am I in? (and a breadcrumb segment that switches within the space)

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

Two panes of one space+tab — two Claude sessions in one repo, the ordinary case — render an
**identical** pane header on desktop and an identical card on the space screen: same title, same cwd,
same ctx%. Switching between them looks like it did nothing. Live-reported as "clicking either pane
opens the same one"; it never did, the URL and the mirror were right the whole time. Nothing on
screen said so.

| | |
|---|---|
| Commit | `6d75e8a` *feat(pane): say which pane you're in, and switch within the space from the breadcrumb* |
| Files | `web/src/components/pane-menu.tsx` (new, + test), `web/src/components/agent-chat.tsx`, `web/src/components/agent-card.tsx` |
| Extraction | **Clean cherry-pick.** One new file and two upstream ones; no card in sight. |

**The desktop toolbar was missing the segment mobile already had.** The mobile context row ends in
`space › tab › pN`; the desktop breadcrumb stopped at `tab`. Adding it is three lines — but it must
sit *outside* the truncating span beside it, which is `overflow:hidden` and would clip the menu.

**The chip lists THIS SPACE's panes, not the herd.** Upstream's swipe-up sheet (the handle above the
composer) lists every pane in every space, which reads as a detour when all you wanted was the pane
next door. Same rule as the segments beside it: a breadcrumb segment switches *within* its level. The
sheet is untouched and still one swipe away.

**No popover dependency.** The repo has no such primitive and this needs none: an absolutely
positioned list plus a transparent full-screen layer for click-outside. A space with one pane renders
a plain chip rather than a dead affordance.

**The card carries its pane number too** — the space screen is where the tap happens, so the
ambiguity has to be resolved there as well, not only after you land.

---
