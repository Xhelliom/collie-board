# Herdr socket API — empirically verified (v0.8.0, protocol 19)

Probed live against a running Herdr server, most recently re-probed 2026-08-07 and cross-checked
against the bundled machine-readable schema — `herdr api schema [--json | --output PATH]`
(`schema_version 1`, covering requests, responses, errors, and events) is now the fastest way to
re-derive this contract without probing. These are the facts the bridge is built on; they confirm
the socket assumptions behind the design in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

**0.7.5 (protocol 17) → 0.8.0 (protocol 19) is purely additive**, diffed by dumping both binaries'
schemas: `workspace.move_block` and the `workspace.reordered` event were added, `IntegrationTarget`
gained `antigravity_cli` / `grok`, and **nothing was removed or changed** — every method the bridge
calls kept its params and result shape. The two things that did move are behavioural, invisible to
the schema, and called out where they belong below: `tab.close` on a workspace's last tab now closes
the workspace, and `pane.read`'s `truncated` finally tells the truth.

## Transport

- Unix domain socket at `$HERDR_SOCKET_PATH` (default `~/.config/herdr/herdr.sock`).
- **Newline-delimited JSON.** Request: `{"id": <string>, "method": <string>, "params": <object>}`.
  - `id` **must be a string** (integer → `invalid_request`).
- Response: `{"id", "result": {"type": "...", ...}}` or `{"id": "", "error": {"code", "message"}}`.
- **RPC is one-shot: the server closes the connection after a single response.** Send one
  request per connection. (Confirmed: a second request on the same connection never replies —
  the socket is already closed.)
- Malformed requests close the connection too, and the serde error message names the missing/
  wrong field — which is how this contract was reverse-engineered without side effects.
- **Exception:** `events.subscribe` keeps the connection open and streams events.

## Methods the bridge uses (verified params)

| Method | Params | Returns (`result.type`) |
|---|---|---|
| `session.snapshot` | `{}` | `session_snapshot` → `snapshot{workspaces[], tabs[], panes[], agents[], layouts[], focused_*}` |
| `workspace.list` | `{}` | `workspace_list` → `workspaces[]` |
| `pane.list` | `{}` | `pane_list` → `panes[]` |
| `pane.read` | `{pane_id, source, lines, format}` | `pane_read` → `read{text, truncated, revision}` |
| `pane.send_text` | `{pane_id, text}` | (ack) |
| `pane.send_keys` | `{pane_id, keys}` | (ack) |
| `agent.send` | `{target, text}` | (ack) — writes **literal** text, no Enter |

- `pane.read` `source` ∈ `visible | recent | recent_unwrapped | detection`; `format` ∈ `text | ansi`.
  **Snake_case on the wire** — the CLI advertises `--source recent-unwrapped`, but the socket rejects
  the hyphen (`invalid_request: unknown variant`). Live-probed 2026-07-30 (herdr 0.7.x).
  **`format: "text"` returns clean plain text (no ANSI escapes)** → safe to render, no XSS surface.
- `agent.send` writes literal text only; to submit a reply, follow with an Enter keypress
  (`pane.send_keys {keys: ["Enter"]}`) — submit-key name needs live confirmation per agent.
- **`pane.send_text` writes RAW bytes — no bracketed paste.** Live-probed 2026-07-27 (herdr 0.7.4) by
  sending into a pane running `/usr/bin/cat -v`, which renders control bytes visibly: the text came
  back bare, with no `^[[200~` / `^[[201~` framing. Two consequences worth keeping:
  - A PTY is an ordered byte stream, so a following `send_keys` **cannot** overtake the text. Any
    "the Enter arrived before the text" theory is dead on arrival — including blaming the settle
    delay between the two calls (`sendReplySteps`, `bridge/server.ts`). See #34, where that was the
    first and wrong hypothesis.
  - A `\n` inside `text` is delivered as a real newline keypress, not as pasted content. What the TUI
    does with it (submit vs. insert) is the harness's choice, not something the paste framing hides.
- **An ack means "herdr took the bytes", never "the TUI acted on them".** Both `send_text` and
  `send_keys` return before the target program has read, let alone rendered, anything. So a
  successful RPC pair is not evidence a reply was delivered — a focused TUI dialog can swallow the
  text and consume the Enter with both calls reporting success. Anything that needs delivery
  *confirmed* must read the pane back and look (`web/src/lib/reply-action.ts`).

## `session.snapshot` — one RPC, the whole herd (new in 0.7.2)

`session.snapshot` `{}` → `{"type":"session_snapshot","snapshot":{...}}`. One-shot like every RPC —
no special connection handling, no streaming. The `snapshot` bundles everything a client needs to
bootstrap or resync in a single round trip:

```jsonc
{ "version":"0.8.0", "protocol":19,
  "workspaces":[ /* same record shape as workspace.list → workspaces[] */ ],
  "tabs":      [ /* same record shape as tab.list → tabs[] */ ],
  "panes":     [ /* same record shape as pane.list → panes[] */ ],
  "agents":    [ /* precomputed subset of panes[] that carry an agent */ ],
  "layouts":   [ /* per-tab PaneLayoutSnapshot, see layout.updated below */ ],
  "focused_workspace_id":"w0…", "focused_tab_id":"w0…:t1", "focused_pane_id":"w0…:p1" }
  // focused_* are string | null
```

Docs-blessed pattern: **bootstrap with `session.snapshot` → `events.subscribe` → re-`session.snapshot`
on reconnect or staleness.** CLI mirror: `herdr api snapshot` prints the raw reply — handy for
diffing shapes without writing a client.

Collie's bridge polls this method (one RPC per tick instead of the `workspace.list` + `pane.list`
+ `tab.list` trio) and falls back to the trio on older servers that don't know the method. Old-server
detection: the error reply is
``{"id":"","error":{"code":"invalid_request","message":"invalid request: unknown variant `session.snapshot`, expected one of ..."}}``
— the bridge treats an `unknown variant` error on `session.snapshot` specifically as "fall back,"
not a hard failure.

## `pane.send_keys` key grammar (verified)

The server **validates** every key and rejects unknown names with
`{error:{code:"invalid_key", message:"unsupported key <X>"}}` (pane lookup happens first, so probe
against a real pane). Empirically enumerated against Herdr 0.7.0 — it is **NOT** tmux syntax:

- **Special keys (bare, case-insensitive):** `Up` `Down` `Left` `Right` `Tab` `Enter` `Escape`
  `Space` `Backspace` (alias `BS`), and function keys `F1`…`F12`.
- **Literal single characters:** a one-character string is typed as that character — digits (`"1"`,
  `"2"`, …), letters, punctuation (live-verified 2026-07-04). This is what Collie's prompt-select
  taps send: `{keys:["1"]}` answers a permission dialog; `{keys:["2","Enter"]}` picks option 2 of an
  AskUserQuestion select.
- **Modifier chords (join with `+`):** `ctrl+c`, `ctrl+u`, `ctrl+d`, `ctrl+l`, `ctrl+r`,
  `shift+tab`, `ctrl+left`, `alt+f`, … Modifiers: `ctrl` / `shift` / `alt` / `cmd` / `super`
  (case-insensitive). This is the **same grammar as `config.toml [keys]`**.
- **Multi-modifier chords work, in any modifier order** (live-verified 2026-07-20 against 0.7.3 on
  a throwaway sandbox pane, with `PageUp` → `invalid_key` in the same run as proof the validator was
  active): `ctrl+shift+p` / `shift+ctrl+p`, `alt+shift+p` / `shift+alt+p`, triple
  `ctrl+alt+shift+p` / `ctrl+shift+alt+p`, and modifier+special `alt+Up` all ack. Independently
  confirmed against 0.7.4 by @bnivanov (issue #20).
- **NOT supported** (all return `invalid_key`): tmux-style `C-c` / `BTab`; and the keys
  `PageUp` `PageDown` `Home` `End` `Insert` `Delete` (in any spelling). There is no forward-delete
  and no scrollback paging via keys — the web mirror is scrollable instead.
- ⚠️ Consequence: Ctrl-C is **`ctrl+c`**, not `C-c`. Multiple keys per call are applied in order,
  e.g. `{keys:["Down","Enter"]}`.
- Re-checked against 0.7.2's bundled schema: unchanged.

## Rename methods — set an object's label (verified)

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

## Close methods — kill a pane or a whole tab (verified)

Two sibling structural ops remove panes. `tab.close` live-verified 2026-07-19 on the sandbox session.

| Method | Params | Returns (`result.type`) | Event | Error (unknown id) |
|---|---|---|---|---|
| `pane.close` | `{pane_id}` | `ok` | `pane.closed` | `pane_not_found` |
| `tab.close` | `{tab_id}` (schema: `TabTarget`) | `ok` | `tab.closed` | `tab_not_found` |

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

### `worktree.remove` — takes `workspace_id`, not `workspace` (live-probed 0.7.5, 2026-07-29)

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

## Move methods — reorder tabs and workspaces (verified)

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

## Object shapes (observed)

```jsonc
// workspace.list → workspaces[]
{ "workspace_id":"w0000000000000", "number":1, "label":"demo",
  "focused":false, "pane_count":2, "tab_count":1,
  "active_tab_id":"w0000000000000:t1", "agent_status":"done" }

// pane.list → panes[]
{ "pane_id":"w0000000000000:p1", "terminal_id":"term_…", "workspace_id":"w0000000000000",
  "tab_id":"w0000000000000:t1", "focused":false, "cwd":"/…/demo",
  "foreground_cwd":"/…/demo", "agent":"claude", "agent_status":"done",
  "agent_session":{"source":"herdr:claude","agent":"claude","kind":"id","value":"…"},
  "revision":0,
  "scroll":{"offset_from_bottom":0,"max_offset_from_bottom":128,"viewport_rows":48} }
```

`agent_status` ∈ `idle | working | blocked | done | unknown`. Panes without an agent omit/null `agent`.

> **Pane records now carry `scroll`** (new in 0.7.2, live-verified 2026-07-07): `pane.list`,
> `pane.get`, `pane.current`, and `session.snapshot` panes all include
> `scroll: {offset_from_bottom, max_offset_from_bottom, viewport_rows} | null` (all `uint64`;
> `offset_from_bottom == 0` means the pane is scrolled to the bottom). Collie doesn't consume it yet.

> **`revision` is a stub through Herdr 0.8.0** (live-verified 2026-07-05 on 0.7.0; reconfirmed on
> 0.7.2 2026-07-07, and on 0.8.0 2026-08-07 by reading a pane back across 60 lines of fresh output):
> `pane.read`, `pane.list`, and `session.snapshot` all return `revision: 0` for every pane, including
> actively-changing ones. Treat it as advisory / future-proofing only — never as a load-bearing
> change detector (Collie's prompt-select race guard re-derives the menu from content for exactly
> this reason).

> **`pane.read`'s `truncated` became truthful in 0.8.0** (upstream #1717). Through 0.7.x it was
> hardcoded `false` even when the read demonstrably cut scrollback off. Live-verified 2026-08-07 on
> 0.8.0 against a pane holding 66 lines: `lines: 5` and `lines: 20` → `truncated: true`, `lines: 100`
> and `lines: 5000` → `false`; `source: "visible"` reports it the same way. **Collie still gates
> "is there more to load" on `scroll` (`max_offset_from_bottom`), not on this** — deliberately: the
> plugin's `min_herdr_version` is `0.7.0`, where `truncated: false` is a lie that would read as
> "nothing more to fetch", while `scroll` is correct on both. Revisit only if the floor moves to 0.8.

## Event stream (now wired: event-poked polling)

`events.subscribe` `{subscriptions: [{type, pane_id?}]}` keeps the connection open and streams
events. Empty `subscriptions: []` → ack only, no events ever arrive. The ack and the event frames
are shaped differently — worth calling out explicitly:

- **Ack:** `{"id":"<id>","result":{"type":"subscription_started"}}`.
- **Event:** `{"event":"<snake_case>","data":{...}}`. Note the split: subscription `type` values
  are dot-form (`pane.agent_status_changed`), but the `event` field on each streamed line is
  snake_case (`pane_agent_status_changed`). Real example line:
  `{"data":{"pane_id":"w6:p3","type":"pane_agent_detected","workspace_id":"w6"},"event":"pane_agent_detected"}`.

The full event catalog (subscription `type` values), 0.7.2 additions marked `*`, 0.8.0's marked `†`:

```
workspace.created  workspace.updated  workspace.renamed  workspace.closed  workspace.focused  workspace.moved *
workspace.reordered †
worktree.created   worktree.opened    worktree.removed
tab.created        tab.closed         tab.focused        tab.renamed       tab.moved *
pane.created       pane.closed        pane.focused       pane.moved        pane.exited
pane.agent_detected  pane.output_matched  pane.agent_status_changed
layout.updated *   pane.scroll_changed *
```

`*` = new to the catalog in 0.7.2 (`workspace.moved`, `tab.moved`, `layout.updated`,
`pane.scroll_changed`); `workspace.updated` and `pane.focused` were already listed but are called
out here too since they're easy to miss in the block above. `†` = new in 0.8.0 —
`workspace.reordered` fires for the atomic group move `workspace.move_block` performs; Collie
doesn't subscribe to it. An unsubscribed event costs nothing here: the stream only pokes the poller,
so anything it misses lands on the next `session.snapshot` anyway.

- **Scoping, verified:** `pane.agent_status_changed`, `pane.scroll_changed`, and
  `pane.output_matched` **require** `pane_id` in the subscription (omit it →
  ``invalid_request: missing field `pane_id` ``). Everything else is global — subscribe with just
  `{type}`.
- **`layout.updated`** (global) payload is a full `PaneLayoutSnapshot`: `{workspace_id, tab_id,
  zoomed, area, focused_pane_id, panes:[{pane_id,focused,rect}],
  splits:[{id,direction,ratio,rect}]}` — the same shape as `session.snapshot`'s `layouts[]`.
- **`pane.scroll_changed`** (pane-scoped) payload: `{pane_id, workspace_id, scroll}` (`scroll`
  shape as in "Object shapes" above).
- **Rich payloads:** `pane_created` / `workspace_created` carry the **full** pane/workspace
  record, not just ids. `pane_exited` carries `{pane_id, workspace_id}`. `pane_agent_detected`
  carries `{pane_id, workspace_id, agent?}` and can fire in herd-wide bursts on re-detection —
  consumers should debounce it.

Collie now polls `session.snapshot` (above) as the source of truth, and additionally holds a
long-lived `events.subscribe` stream — global lifecycle events plus a per-agent-pane
`pane.agent_status_changed` subscription, resubscribed whenever the agent-pane set changes —
purely to **poke** the poller: an event triggers an immediate debounced re-poll, it never updates
state by itself. While the stream is healthy, interval polling relaxes to `COLLIE_BOARD_POLL_IDLE_MS`
(default 12000 ms, min 1000 ms); when the stream is down or reconnecting, it drops back to the
fast `COLLIE_BOARD_POLL_MS` cadence. Events accelerate; the snapshot stays authoritative — a missed
event costs one interval, never correctness.

Also visible in the 0.8.0 schema but unused by Collie: `events.wait`, `pane.send_input`,
`agent.list`, `pane.wait_for_output`, `workspace.close`, `workspace.move_block` — run
`herdr api schema` for the full 90-method catalog (89 on 0.7.5; the count is the cheapest way to
spot that a server grew methods under you).
