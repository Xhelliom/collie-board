# 0013 — The bridge does not know its consumers

**Status:** Accepted

## Context

A card asked to cross the board with a separate desktop application of the same author — loquivox,
a voice assistant that holds a spoken conversation while a key is held, living in its own
repository. The loop wanted: a board notification reaches that application, it asks you out loud
what to do, your spoken answer starts the next thing here, the board answers, and round it goes.

The request left exactly one thing open: is that written in the consumer, or here? It is the first
of a class — a program that wants to be told what the board knows and to act back on it — so the
answer is worth recording as a rule rather than as one application's plumbing.

Three forces decide it, none of them about voice:

1. **Coupling follows lifetime.** The bridge is a user unit that is always up. A consumer of this
   kind is ephemeral: a conversation that lasts two minutes, a script run by hand, a page open in a
   tab. The ephemeral subscribes to the durable; the reverse makes the durable hold state it cannot
   verify, starting with *"is anyone listening?"*.
2. **Driving a consumer costs the bridge everything it is meant not to grow.** An outbound client,
   its configuration, its failure modes, and something periodic to feed it — while `CLAUDE.md`
   § The board says *"No new poll loop"* and *"Keep the upstream surface narrow"*. A consumer, by
   contrast, already has a loop of its own; that is what makes it a consumer.
3. **The front door already exposes all of it** — [ADR 0001](./0001-one-managed-front-door.md).
   `GET /api/notifications/log` carries a monotonic `id`, which is a cursor by construction;
   `POST /api/cards/<id>/prompt` types into the real pane; `/start`, `PATCH /api/cards/<id>`,
   `POST /api/pane/<id>/reply` and `POST /api/cards` cover the rest. Nothing had to be added to the
   bridge for the first consumer — that is the evidence the surface is already the right one.

One correction of fact the request needed, recorded here because it will be assumed again: **the
board has no MCP server.** The skill says so in its own words — *"There is no CLI and no MCP
server: use `curl`"*. "Through the MCP" reads, concretely, as *through the local HTTP API*. If an
MCP server is ever wanted, it wraps that same API and this decision is unaffected.

## Decision

**A consumer integrates by reading and writing the local HTTP API. The bridge never learns that a
particular consumer exists.**

Concretely, in `bridge/`: no sink beside push, bell and digest; no outbound client; no
configuration section named after a consumer; no "is it connected?" state. A request that begins
*"the board sends to X"* is answered by X reading the log.

## Consequences

- **Notification content is reused, not recomposed.** A log entry already carries `status`,
  `cardTitle`, `cwd`, `cardId`, `cardStatus` and `subtitle` — the exact fields `notifyContent()`
  renders for the three existing surfaces. A fourth surface reads those; it does not get a
  composition of its own.
- **Two gaps a consumer lives with, neither of which buys bridge code.** *No outbound stream* — no
  SSE, no WebSocket: latency is the consumer's poll interval on top of the `notifyDelayMs` debounce.
  *Retraction does not propagate* — the coordinator clears its slot while the log deliberately keeps
  the trace, so a question already answered at the keyboard is still in the log. A consumer
  therefore **re-reads the card (`GET /api/cards/<id>`) before acting on an entry**, which is what
  [ADR 0011](./0011-the-board-may-raise-an-alert-that-can-retract.md) asks of anything that
  notifies.
- **The 50-entry in-RAM log is the deduplication boundary.** A cursor held in the consumer's own
  memory is enough within one run; across a restart, the same entry can be seen twice.
- **Writes cross the device gate like any other.** With `COLLIE_BOARD_DEVICE_HEADER` set, a write
  needs that header; loopback with no `Origin` is what lets an unheadered write through otherwise.
  A consumer creating cards sends `spec`, never `rawInput` — that field fires the copilot and
  spends quota.
- **How the consumer works is not our business.** Where it queues the fact, how it decides not to
  interrupt, what it says out loud — that reasoning belongs in its repository, not in this one.
- **What would justify revisiting:** the board needing to *initiate* toward a consumer, a mode
  where a notification wakes something that was not already listening. Force 1 falls the moment the
  target is durable too. That is a new decision, not one implied by this one.
