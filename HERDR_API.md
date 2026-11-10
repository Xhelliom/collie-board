# Herdr socket API — empirically verified (v0.9.0, protocol 22)

Probed live against a running Herdr server, most recently re-probed 2026-09-08 and cross-checked
against the bundled machine-readable schema — `herdr api schema [--json | --output PATH]`
(`schema_version 1`, covering requests, responses, errors, and events) is now the fastest way to
re-derive this contract without probing. These are the facts the bridge is built on; they confirm
the socket assumptions behind the design in [`ARCHITECTURE.md`](ARCHITECTURE.md).

**0.7.5 (protocol 17) → 0.8.0 (protocol 19) is purely additive**, diffed by dumping both binaries'
schemas: `workspace.move_block` and the `workspace.reordered` event were added, `IntegrationTarget`
gained `antigravity_cli` / `grok`, and **nothing was removed or changed** — every method the bridge
calls kept its params and result shape. The two things that did move are behavioural, invisible to
the schema, and called out where they belong below: `tab.close` on a workspace's last tab now closes
the workspace, and `pane.read`'s `truncated` finally tells the truth.

**0.8.0 (protocol 19) → 0.9.0 (protocol 22) breaks nothing the bridge calls** — re-derived
2026-09-08 from the 0.9.0 schema plus the upstream release notes. All 24 methods the bridge uses
kept their names, params and result shapes, and all 16 subscription types it opens are still valid
(`herdr integration status` matters more than the protocol here — see the last bullet). What did
move:

- **Subscriptions no longer replay retained history** (upstream #1270): a stream now starts at the
  moment the subscribe is accepted, and upstream's advice is to subscribe *before* the first
  `session.snapshot`. `index.ts` does the opposite (`engine.start()` then `poker.start()`) and
  **that is deliberate**: the poker's per-pane `pane.agent_status_changed` subscriptions are built
  from the first snapshot's agent set, so it could not subscribe first even if it wanted to. Safe
  because events here are pokes, never state — a missed one costs one `COLLIE_BOARD_POLL_IDLE_MS`,
  never correctness.
- **`workspace.close` now needs `close_group: true`** to close a primary workspace that still has
  linked worktree workspaces open, else `workspace_group_close_required` (#2874). The bridge never
  calls `workspace.close`; `worktree.remove` targets the worktree workspace itself and is untouched.
- **`worktree.create` / `open` / `remove` gained an optional `trust_repository`** (#3044) — a
  per-request escape hatch for a repo git considers dubiously owned, *not* a new gate. Repos owned
  by the running user behave exactly as before, so the bridge keeps omitting it.
- **`pane.process_info` follows the foreground process-group leader**, not a descendant (#3270,
  #3386). Strictly better for `resolveForProcess`: an agent that shelled out no longer reports the
  child's cwd.
- **`pane.read source:"recent"` no longer returns empty** for output still on the viewport (#3444).
- Additive fields, all ignored: `PaneInfo.display_agent` / `title` / `state_labels` /
  `terminal_title{,_stripped}`, `WorkspaceInfo.worktree` (worktree provenance),
  `AgentInfo.state_change_seq` / `screen_detection_skipped`.
- **`PaneInfo.cwd` is `string | null`** in the 0.9.0 schema while `WirePane.cwd` is `string`. Not
  observed null on any live pane, and every consumer either revalidates the path (`git.ts`) or
  falls back (`proc.cwd || opts.cwd`), so this is a latent typing gap, not a live bug.
- Not a protocol change, but the thing that actually costs history: `agent_session` is `null` on
  every pane when no agent integration is installed (`herdr integration status` → all *not
  installed*). Both `kind:"id"` and `kind:"path"` paths in `state-engine.ts` are then inert and
  `transcript.ts` runs on its process/cwd fallback. Installing `herdr integration install claude`
  (and `codex`) is what switches the exact-session path back on.

## Transport

→ [`docs/reference/herdr-api/01-transport.md`](docs/reference/herdr-api/01-transport.md)

## Methods the bridge uses (verified params)

→ [`docs/reference/herdr-api/02-methods-the-bridge-uses-verified-params.md`](docs/reference/herdr-api/02-methods-the-bridge-uses-verified-params.md)

## `session.snapshot` — one RPC, the whole herd (new in 0.7.2)

→ [`docs/reference/herdr-api/03-session-snapshot-one-rpc-the-whole-herd-new-in-0.md`](docs/reference/herdr-api/03-session-snapshot-one-rpc-the-whole-herd-new-in-0.md)

## `pane.send_keys` key grammar (verified)

→ [`docs/reference/herdr-api/04-pane-send-keys-key-grammar-verified.md`](docs/reference/herdr-api/04-pane-send-keys-key-grammar-verified.md)

## Rename methods — set an object's label (verified)

→ [`docs/reference/herdr-api/05-rename-methods-set-an-object-s-label-verified.md`](docs/reference/herdr-api/05-rename-methods-set-an-object-s-label-verified.md)

## Close methods — kill a pane or a whole tab (verified)

→ [`docs/reference/herdr-api/06-close-methods-kill-a-pane-or-a-whole-tab-verifie.md`](docs/reference/herdr-api/06-close-methods-kill-a-pane-or-a-whole-tab-verifie.md)

## Move methods — reorder tabs and workspaces (verified)

→ [`docs/reference/herdr-api/07-move-methods-reorder-tabs-and-workspaces-verifie.md`](docs/reference/herdr-api/07-move-methods-reorder-tabs-and-workspaces-verifie.md)

## Object shapes (observed)

→ [`docs/reference/herdr-api/08-object-shapes-observed.md`](docs/reference/herdr-api/08-object-shapes-observed.md)

## Event stream (now wired: event-poked polling)

→ [`docs/reference/herdr-api/09-event-stream-now-wired-event-poked-polling.md`](docs/reference/herdr-api/09-event-stream-now-wired-event-poked-polling.md)
