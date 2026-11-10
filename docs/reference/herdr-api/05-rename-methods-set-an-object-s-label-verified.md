# Rename methods — set an object's label (verified)

**Statut :** ✅ décidé — contrat du socket herdr 0.9 vérifié en direct

Partie de [`HERDR_API.md`](../../../HERDR_API.md), qui en est le sommaire.

Three sibling RPCs set a display label on a workspace, tab, or pane. Live-verified 2026-07-18.

| Method | Params | `label` | Returns (`result.type`) | Event |
|---|---|---|---|---|
| `pane.rename` | `{pane_id, label}` | `string \| null` — **null clears** | `pane_info` → `{pane}` | **none** |
| `tab.rename` | `{tab_id, label}` | `string` (non-null) | `tab_info` → `{tab}` | `tab_renamed` |
| `workspace.rename` | `{workspace_id, label}` | `string` (non-null) | `workspace_info` → `{workspace}` | `workspace_renamed` |

- **`pane.rename` is the odd one out, twice over.** Its `label` accepts `null`, which **clears** the
  label (the `label` key then disappears from the pane record); the sibling two take a non-null
  string. And it emits **NO event** — a renamed pane surfaces only on the next `session.snapshot` /
  `pane.list` poll. `tab.rename` / `workspace.rename` DO emit: `tab_renamed` →
  `{type, tab_id, workspace_id, label}`, `workspace_renamed` → `{type, workspace_id, label}` (the
  `event` field is snake_case on the stream, as everywhere).
- **Errors:** an unknown id → `{code:"pane_not_found" | "tab_not_found" | "workspace_not_found",
  message:"<kind> <id> not found"}`.
- **No length limit; empty string accepted** (stored as-is on tab/workspace). Re-verified on
  `tab.rename` 2026-07-19: `label:""` is stored **literally** (the tab's label becomes empty — it does
  **not** reset to the default number), and `label:null` is rejected with
  ``{code:"invalid_request", message:"invalid request: invalid type: null, expected a string"}`` —
  confirming tabs/workspaces have **no "clear"** (only `pane.rename` clears, via `null`). Collie makes
  its own opposite choices per object: a blank pane "Save" clears (blank → `null`), while a blank tab
  "Save" is refused client- and bridge-side, since a literal-empty tab chip is useless. See
  `bridge/server.ts` (`normalizeTabLabel`).
- **Undocumented field:** once set, a pane's label rides along as **`label?: string`** in `pane.list`,
  `pane.get`, `pane.current`, and `session.snapshot` panes (omitted when unset — so it's absent from
  the base pane shape below). Workspaces already expose `label`; tabs likewise.
- **`agent.rename` `{target, name}`** also exists in the schema, but it is a DIFFERENT operation
  (renames an agent session, not a pane/tab/workspace) — **unverified and unwired by Collie**. Listed
  only so it isn't mistaken for the label renames above.
