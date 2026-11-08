# Move methods — reorder tabs and workspaces (verified)

**Statut :** ✅ décidé — contrat du socket herdr 0.9 vérifié en direct

Partie de [`HERDR_API.md`](../../../HERDR_API.md), qui en est le sommaire.

Two sibling structural ops reorder objects. Both live-verified 2026-07-20 on the sandbox session.

| Method | Params | Returns (`result.type`) |
|---|---|---|
| `tab.move` | `{tab_id, insert_index}` | `tab_list` → that workspace's tabs, post-move order |
| `workspace.move` | `{workspace_id, insert_index}` | `workspace_list` → all workspaces, post-move order |

- **Tabs: array order is authoritative, `number` is stable.** `tab.move` reorders the array
  returned by `tab.list` / `session.snapshot` **without renumbering** — after moving `t2` (number 2)
  before `t1` (number 1), the snapshot lists `[t2, t1]` with numbers unchanged. Herdr itself renders
  array order: the default label of an unlabeled tab is **positional** (post-move, `t2` displays as
  "1"). ⚠️ Consequence: a client that sorts tabs by `number` un-does the user's reorder — render
  tabs in array order, never number order.
- **Workspaces are the opposite: `workspace.move` renumbers.** After moving `w7` (number 5) to the
  front, it becomes `number 1` and every other workspace shifts — `number` always equals position,
  so array order and number order never disagree and sorting workspaces by `number` is safe.
- **`insert_index` counts positions in the PRE-removal list** (workspace-scoped for tabs, clamped at
  the end). Moving an item toward the end therefore needs `target + 1`: with `[t2, t1]`,
  `tab.move {tab_id: t2, insert_index: 1}` is a **no-op**; `insert_index: 2` yields `[t1, t2]`.
- The event catalog lists sibling `tab.moved` / `workspace.moved` events (0.7.2); emission not
  observed here (no live subscription during the probe).
- **`workspace.move_block` `{workspace_id, insert_index}` (new in 0.8.0, protocol 19)** moves a
  workspace *together with the worktree group it belongs to*, atomically, and emits the new
  `workspace.reordered` event. It exists because 0.8.0 also keeps worktree parents and children
  packed in the sidebar: moving a parent with plain `workspace.move` would now tear the block apart.
  Unwired by Collie, and the one 0.8.0 addition with an obvious board shape — a card's worktree IS
  such a block, so this is what board-order → herd-order would ride on. Unverified: no live probe.
