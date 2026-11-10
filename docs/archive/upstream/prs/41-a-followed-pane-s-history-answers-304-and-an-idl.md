# 41. 🟡 A followed pane's history answers 304, and an idle pane polls slow

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

The reading view follows a pane with `GET /api/pane/:id/history?after=…` on every poll. Measured
(10 min, `/api/diag/routes`): 26 calls, 163 ms average, 448 ms max, no 304 — the whole log re-read
each time. `TranscriptStore.pageAt` now stats first and reuses its parse while size/mtime hold; the
route answers through `conditionalJson` (body ETag); `fetchHistory` goes through `conditionalGet`.
And `intervalFor` polls fast only for the open pane itself working/blocked (or a shell) — an agent
busy elsewhere no longer drags the whole app to 1.5 s. Generic — it knows no card (the lot rule
beside it is the fork's).

| | |
|---|---|
| Commit | *perf: historique en 304 quand rien n'a bougé, poll lent hors pane actif* |
| Files | `bridge/transcript.ts`, `bridge/server.ts`, `web/src/lib/api.ts`, `web/src/hooks/use-polling.ts` |
| Extraction | **Needs extraction** — drop the `lots` parameter and its `useMatches` lookup in `root.tsx`; the `board.ts` side of the `conditionalGet` move does not exist upstream. |

---
