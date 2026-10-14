# 0039 — The MCP server is stdio, and the caller's pane header says who it is

**Status:** Accepted

## Context

A voice assistant (and any MCP client, Claude Code included) wants to drive the board: read what
blocks, answer an agent, file a card, launch a lot. [ADR 0013](./0013-the-bridge-does-not-know-its-consumers.md)
left the door open: an MCP server "wraps that same API". Two things had to be chosen.

**The transport.** Streamable HTTP served by the bridge would be reached through `tailscale serve`,
where a write without `Origin` is refused (`checkAccess`, *origin required*). Relaxing that for `/mcp`
would let any device of the tailnet type into a terminal. stdio has no such door: the client launches
the process on the bridge's machine, which calls the bridge on loopback like `curl` does.

**The caller.** A stdio server inherits its client's environment. An agent that plugged the server in
runs inside a herdr pane, so `HERDR_PANE_ID` is set; the operator's own client (a voice assistant
outside herdr) has none. The launch and phase-validation routes already tell the two apart by the
`x-collie-pane` header ([ADR 0010](./0010-an-agent-filed-card-is-traced-on-the-card.md),
[ADR 0030](./0030-the-orchestrator-may-launch-a-lot-when-the-operator-allows-it-per-project.md)).

## Decision

**`bridge/mcp.ts` is a stdio MCP server, a thin translator over the local HTTP API. Nothing else.**

- **No transport served by the bridge.** `checkAccess` and the CSP are untouched. A remote MCP waits
  for the multi-machine phase and its own ADR.
- **No second path to the database, no decision of its own.** Every tool is one or a few calls to the
  existing routes; the board's guards (launch, phase validation, `x-collie-pane`, device gate) answer
  exactly as they would to `curl`. A `403`/`409` becomes a one-sentence message a voice can read.
- **Who is the caller.** With `HERDR_PANE_ID` in the environment, the server sends it as
  `x-collie-pane` on **every** call: the caller is an agent, and launching a lot or validating a phase
  is refused (except the one autonomous launch of ADR 0030). Without it the call is the operator's,
  through their client. A test pins both.
- **That relay is a convention, not an authentication.** An agent can already call the bridge with
  `curl` and leave the header out; the guard was never a boundary against a hostile agent, only
  against a well-behaved one doing the wrong thing. This server does not make it weaker, and does not
  claim to make it stronger.
- **Configuration is environment:** `COLLIE_BOARD_URL` (else `http://127.0.0.1:$COLLIE_BOARD_PORT`, else
  8788), `COLLIE_BOARD_DEVICE_HEADER` + `COLLIE_BOARD_DEVICE` when the deployment has the device gate.
- **No consumer-specific code** — nothing here names Loquivox.
- **Tools, compact, with annotations** (the client confirms aloud whatever is not read-only):
  read — `list_projects`, `project_status`, `get_card`, `whats_blocking`, `recent_notifications`
  (`readOnlyHint: true`); act — `reply_to_agent`, `create_card`, `notify`, `launch_lot`
  (`readOnlyHint: false`, `launch_lot` also `destructiveHint: true`: it spends quota and starts agents).
  Replies are titles, statuses and one line of reason; a card's whole body is never the default.
- The protocol is hand-rolled (`initialize`, `tools/list`, `tools/call`, `ping`): three methods do not
  justify a dependency.

## Consequences

- `notify` needs a pane: the bridge answers `400` without `x-collie-pane`, so the operator's client
  (no pane) cannot use it today. The tool says so rather than faking a pane.
- The skill's "no MCP server" sentence and `CLAUDE.md`'s rule now say: the MCP server exists, wraps
  the API, and adds no sink to the bridge.
- Revisit when a remote client must reach the bridge (multi-machine), not before.
