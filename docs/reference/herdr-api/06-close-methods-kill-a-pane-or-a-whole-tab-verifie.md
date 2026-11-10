# Close methods — kill a pane or a whole tab (verified)

**Statut :** ✅ décidé — contrat du socket herdr 0.9 vérifié en direct

Partie de [`HERDR_API.md`](../../../HERDR_API.md), qui en est le sommaire.

Two sibling structural ops remove panes. `tab.close` live-verified 2026-07-19 on the sandbox session.

| Method | Params | Returns (`result.type`) | Event | Error (unknown id) |
|---|---|---|---|---|
| `pane.close` | `{pane_id}` | `ok` | `pane.closed` | `pane_not_found`, `confirmation_required` (see below) |
| `tab.close` | `{tab_id}` (schema: `TabTarget`) | `ok` | `tab.closed` | `tab_not_found` |

- **`pane.close` refuses the last pane of a repo's main-checkout workspace while linked worktrees
  hang off it**: `confirmation_required: closing this pane would close a worktree group` (live-verified
  2026-10-29). Confirming would close the worktree workspaces too. Open a second pane in that workspace
  first (`tab.create`) and the close is a plain one — what `restartOrchestrator` does during a lot.
- **`tab.close` is a BULK pane-close: closing a tab terminates EVERY pane inside it.** Verified by
  creating a throwaway tab holding a plain shell pane, then `tab.close {tab_id}` — the next
  `session.snapshot` no longer lists the tab **or** its inner pane. So it's no more privileged than
  closing those panes one-by-one (which `pane.close` already allows) — same remote-shell threat model.
- ⚠️ **Since 0.8.0, closing a workspace's LAST tab closes the workspace too** (upstream #1760, making
  the socket match what the TUI always did). Live-verified 2026-08-07: `workspace.create` → one tab
  `w25:t1` → `tab.close {tab_id:"w25:t1"}` → the next snapshot lists neither the pane, nor the tab,
  **nor `w25` itself**. On 0.7.x the emptied workspace survived. Costs the board nothing: a card whose
  pane leaves the snapshot is already reconciled to `orphaned` (`cards.ts`), and that path doesn't
  care whether the workspace went with it. It does mean `tab.close` is now a second way to lose a
  workspace, next to `worktree.remove` below.
- **Success is a bare `{"result":{"type":"ok"}}`** (same shape as `pane.close`), not a record reply
  like the renames — there's nothing left to describe. The closure surfaces on the next snapshot poll;
  `tab.close` also emits a `tab_closed` event (which Collie doesn't consume).
- **Errors:** unknown id → `{code:"tab_not_found", message:"tab <id> not found"}`; a missing `tab_id`
  → ``{code:"invalid_request", message:"invalid request: missing field `tab_id` …"}``.

## `worktree.remove` — takes `workspace_id`, not `workspace` (live-probed 0.7.5, 2026-07-29)

| Method | Params | Returns | Error (unknown id) |
|---|---|---|---|
| `worktree.remove` | `{workspace_id}` | `ok` | `workspace_not_found` |

**The CLI flag and the socket field disagree**, and this is the trap: `herdr worktree remove` takes
`--workspace <ID>`, so copying that name into the socket call is the obvious thing to do — and it
answers ``{code:"invalid_request", message:"invalid request: missing field `workspace_id` …"}``.
Probed by sending `{workspace}`, `{workspace_id}` and `{id}` against a nonexistent workspace: only
the second reaches the handler at all (`workspace_not_found`), which is how you tell "wrong field
name" from "wrong id" here.

Removing the worktree takes its **workspace** down with it — that is the only way the bridge
*deliberately* closes a workspace, since Collie wires `pane.close` and `tab.close` but nothing that
targets a workspace. (Herdr does have `workspace.close` `{workspace_id}` → `ok`, unwired here; and
since 0.8.0 `tab.close` on the last tab takes the workspace down as a side effect — see above.)

**`force: true` (a boolean, live-verified) is required in practice.** Without it, herdr refuses any
checkout holding modified or untracked files:

```
worktree_remove_failed: fatal: '…/board-auditer-…' contains modified or untracked files,
use --force to delete it
```

and `.board/` — the handoff and wrapup notes the bridge itself writes into every card's worktree — is
untracked by construction, so *every* cleanup hits this. What `force` overrides is **herdr's** check,
not the board's: `refusalFor` has already run, and unlike herdr it knows `.board/` is the bridge's own
scratch and whether the branch's commits are integrated. A non-boolean is rejected
(`invalid type: string "yes", expected a boolean`).
