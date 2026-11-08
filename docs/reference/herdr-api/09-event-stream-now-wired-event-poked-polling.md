# Event stream (now wired: event-poked polling)

**Statut :** ✅ décidé — contrat du socket herdr 0.9 vérifié en direct

Partie de [`HERDR_API.md`](../../../HERDR_API.md), qui en est le sommaire.

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

## `pane.read` — use `format: "ansi"`, never `"text"`, on a pane that may be idle

Measured against herdr 0.7.5 (2026-08-09) on a pane whose agent had finished, same `source: "recent"`
and same `lines: 200`:

| format | time |
|---|---|
| `"ansi"` | **1 ms** |
| `"text"` | **6541 ms** |

The plain-text conversion degrades badly once a pane stops producing output; on a busy pane both
return in ~1 ms, so the trap only shows up on an idle or finished agent. 6.5 s is past every timeout
in this bridge (`DEFAULT_TIMEOUT_MS` is 5000), so a caller that asks for `"text"` simply fails —
which is what made reading mode show a permanent "reconnecting" banner on any done agent. Ask for
`"ansi"` and strip the SGR codes yourself; they carry no cursor sequences (already verified above).

## First-run screens — what `agent_status` says in front of them (live-probed herdr 0.9.5, Claude Code 2.1.318, 2026-11-04)

Claude Code opened in an untrusted directory holding a `.mcp.json`, read with `agent.get` /
`herdr agent explain` at each screen:

| screen | `agent_status` | detection rule |
|---|---|---|
| folder trust (« Is this a project you created or one you trust? ») | **`blocked`** | `live_blocked_form` |
| one new repo MCP server (« New MCP server found in this project: … ») | **`blocked`** | `live_blocked_form` |
| several new repo MCP servers (« N new MCP servers found… » checklist, `Space to select`) | **`idle`** | none — `default_known_agent_idle_fallback` |
| after the screens, at the input box | `idle` | `live_prompt_box` |
| « Teach auto mode about your environment? » (Claude Code 2.1.319, after a finished turn — seen on a peer 2026-11-06) | **`idle`** | — the board reads it `blocked` (`holding-screens.ts`, read at the passage to idle) |

- herdr does not tell these screens apart from any other blocked form: `blocked` means "some dialog",
  not "the trust prompt". The web tells them apart from the screen (`classifyFooter` +
  `namesTrustDialog` in `web/src/lib/harness/claude/markers.ts`).
- The checklist reads **`idle`**, so "blocked" alone misses it. The tell is the missing input box:
  idle + no `❯` box at the tail = a screen holds the agent (`hasInputBox`, harness adapter).
- `interactive_ready` is absent from `agent.get` for a pane where Claude was typed into a shell (not
  started by `agent.start`); for an `agent.start` pane it is `true` behind the trust dialog already
  (bridge/cards.ts), so it says nothing about these screens.
- Both 2.1.318 dialogs print their rows **unnumbered** with a `❯` pointer (trust parks it on
  « No, exit »; MCP on « Continue without… »). One `pane.send_keys` call with `["Down","Enter"]` or
  `["Up","Up","Enter"]` walks and confirms in order — verified: the latter wrote
  `enabledMcpjsonServers: ["probe-echo"]` to `.claude/settings.local.json`.
- A freshly launched agent has **no transcript yet** (`/history` → `no-log`), so reading mode falls
  back to the terminal on its own; the reading-mode banner matters once a log exists (a relaunch,
  `claude --continue` with a new server in `.mcp.json`).

## A card launch in a never-trusted folder (live-probed herdr 0.9.5, Claude Code 2.1.318, 2026-11-05)

The board's own launch path (`agent.start` → `agent.prompt`), on a fresh `git init` outside any
approved project:

- **A worktree of an approved repo shows no dialog** — measured: `git worktree add` of
  collie-board → `agent.start` returns `agent_started`, `idle`, input box up. Claude Code resolves
  trust through the repo, so the dialog only hits a repo **never opened in Claude Code**.
- In that case the cursor is on **« No, exit »**. `agent.start` answers
  `agent_not_ready: agent … is blocked during startup` (`blocked`, `launch_pending: true`, no
  `interactive_ready`) — contrary to the note above for older builds, it does not report ready.
- Our retry of that "transient" code then hits **`agent_name_taken`** (the agent is there, on the
  dialog) → the card start fails, Claude left on the dialog. It does not exit.
- `agent.prompt` is **refused**: `agent_blocked: … is blocked and requires interactive input`.
  Nothing is typed, no Enter is sent. And `promptAndConfirm` counts `blocked` as landed, so its
  rescue Enter never reaches the dialog either. **No blind Enter is possible on 0.9.5** — the
  « No, exit » risk measured by hc (HERDR_CORE_API.md §2c) is hc's `send`, not ours.
- The fix is upstream of the dialog: `startCard` (like a peer launch) writes
  `projects[<checkout>].hasTrustDialogAccepted: true` to `~/.claude.json` (`trustFolder`,
  bridge/cards.ts) before `agent.start`. Measured: same fresh folder, pre-trusted → `agent_started`,
  `idle`, no dialog.
