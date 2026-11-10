# 32. 🔵 The pane list is flat — nothing says which space a pane is in

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

| | |
|---|---|
| Commit | `1edd875` *feat(panes): la liste latérale regroupe les panes par space* |
| Files | `web/src/components/space-pane-tree.tsx` (new), `web/src/components/{agent-sidebar,pane-list-column}.tsx`, `web/src/lib/spaces.ts`, `web/src/components/status-badge.tsx`, `web/src/components/agent-chat.tsx` (one prop) |
| Extraction | **Clean cherry-pick** bar one line: the group header reads `AgentView.branch`, which upstream doesn't have — deleting the ternary leaves the path fallback, which is already the code path for every non-card space. |

Herdr's own sidebar groups by space: a header per space, its branch under the name, its panes
beneath it. Collie's pane list — the desktop 296px column and the pane-switcher sheet, both of them —
listed every pane in the herd flat under three triage headings, with the workspace name demoted to
metadata on each row. On a herd of sixteen spaces that reads as one long undifferentiated list, and
the one thing you navigate by (which project is this?) is the thing repeated on every row instead of
said once.

Grouping by space doesn't lose the triage: it moves it up a level. `groupPanesBySpace()` sorts spaces
worst-status-first (the same `STATUS_RANK` the flat list used), the header carries the space's blocked
count, and every row keeps its own status dot — which it needed anyway, since the section heading is
no longer there to say it.

Not a transcription of the TUI: the `└─` connectors become a hairline rail down each group, and the
row's status dot sits ON that rail with a ring in the list's own surface colour, so one mark is both
"this pane belongs to that space" and "this is its state". The space holding the open pane gets a
brand-tinted rail. Two components became one (`<SpacePaneTree>`, one `dense` flag apart), which is a
net deletion — they had two copies of the row.

Two smaller things ride along and are separable: `StatusDot` now takes its size from its wrapper
(the inner disc was pinned at `size-2.5`, so passing a size did nothing), and a row's second line
prints its tab only when its space actually spans more than one — herdr labels a lone tab `1`, and
that under every row is noise.

---
