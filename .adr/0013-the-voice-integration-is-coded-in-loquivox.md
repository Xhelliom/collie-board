# 0013 — The voice integration is coded in loquivox, not in the board

- **Status:** Accepted
- **Date:** 2026-09-08
- **Shipped in:** — (design only; no code in this commit)

## Context

The originating note asks for a loop: a collie-board notification reaches an agent that is *talking*
to you, it asks you what to do, your spoken answer goes back into the board to start the next thing,
the board answers, and round it goes. It leaves one thing open, verbatim: *"soit dans loquivox une
intégration, soit dans collie-board une intégration loquivox"* — and asks how it should be imagined.
This ADR answers that, and nothing else: it closes an option (a board that drives loquivox) that
will otherwise be proposed again the first time someone reads the sentence "collie-board integration"
in the note and starts in `bridge/`.

**What loquivox is, for this purpose** (read at `~/git/perso/loquivox`, `src/loquivox/`). A GTK/Python
service that holds a spoken conversation while a key is held: `handlers/keyboard.py` (evdev) →
`ModeHandler._talk_worker` → `_talk_conversation`, which is one of two engines over one
`services/talk.py::TalkSession`. The cascade (`_talk_converse`) loops STT → LLM → TTS turn by turn;
the realtime engine (`services/realtime_talk.py`) hands the whole conversation to an OpenAI Realtime
session. What is spoken and heard is shown in the WebKit bubble by `managers/chat.py`.

Its entry and exit points, named:

| | Where |
| --- | --- |
| **Conversation in** (a fact arriving from outside a turn) | `services/research.py::ResearchDesk` — a queue polled *between* turns: cascade `_talk_listen` returns `action="research"`, realtime `RealtimeTalk.push_research()` |
| **Conversation in** (screen context, mid-session) | `TalkSession.set_context()` / `context_clause()`, pushed by `RealtimeTalk.push_context()` |
| **Conversation out** (the model reaching the world) | one tool, `research`, declared twice (`CHAT_TOOL` / `REALTIME_TOOL`), answered `STARTED` on the spot and run on a thread |
| **User in / out, typed** | `ui/chat_overlay.py` webview → `signal` JS→Python handler → `ModeHandler.submit_text_chat` |
| **User in, spoken** | evdev only, in `handlers/keyboard.py` |
| **Externally, from another process** | **nothing.** No socket, no D-Bus, no CLI IPC, no single-instance channel — grepped for; `api.py` is the LLM client, not an API |

That last row is the whole argument.

## Decision

**The integration is written in loquivox. It consumes collie-board's local HTTP API; the bridge
never learns that loquivox exists.**

Five forces, in the order they bite:

1. **There is nothing to drive.** For the board to "drive loquivox", loquivox would first need the
   external entry point it does not have. That is loquivox code either way — plus a client in the
   bridge. The board side is work *in addition to*, never *instead of*.
2. **The shape of the loop already exists on the loquivox side, and nowhere on the board's.**
   `ResearchDesk` *is* this feature's mechanism: an asynchronous outside fact, injected between two
   turns and never mid-sentence, with a queue, a `ready()` predicate and both engines' injection paths
   already written and debugged. A board notification has exactly that shape. So does the return leg:
   a tool answered `STARTED` while the HTTP call runs on a thread is how you reply to the board
   without the conversation going quiet.
3. **The fork's own rules forbid the other side.** *"No new poll loop. Anything periodic hangs off
   `engine.onUpdate`"* and *"Keep the upstream surface narrow"* (`CLAUDE.md` § The board). A bridge
   that drives loquivox means an outbound client, config, and a "is anyone listening?" state the
   bridge cannot know. Meanwhile loquivox's conversation loop *already ticks every 50 ms with nothing
   to do* (`keys.poll(mapping, 0.05)`) — where `push_context()` and `push_research()` are polled. One
   more predicate there costs a string compare.
4. **Coupling follows lifetime.** The bridge is a service that is always up; a loquivox conversation
   lasts two minutes and only exists while a key was pressed. The ephemeral subscribes to the durable,
   never the reverse.
5. **The board already exposes everything.** `GET /api/notifications/log` (monotonic `id` = a cursor),
   `POST /api/cards/<id>/prompt` (→ `promptAndConfirm`, types into the real pane), `/start`,
   `PATCH /api/cards/<id>`, `POST /api/pane/<id>/reply`. Nothing to add for a first version.

**A correction the note needs: collie-board has no MCP server.** The skill says so in its own words —
*"There is no CLI and no MCP server: use `curl`"*. "Via the MCP" reads, concretely, as *via the local
HTTP API the skill documents*, and on the loquivox side as a **conversation tool**, sibling to
`research` — not an MCP client. If an MCP server is ever wanted it wraps that same API and this
decision is unaffected.

### The loop, end to end

*Board → voice*

1. `engine.onTransition` → `NotificationCoordinator.onTransition` — debounce (`notifyDelayMs`, 30 s),
   coalesce, retract. Unchanged.
2. On FIRE, `bridge/index.ts` writes `notifyLog.add(alert)` and enriches the subtitle. Bell, push and
   digest all start here. Unchanged.
3. loquivox polls `GET /api/notifications/log`, keeps the highest `id` it has seen, takes what is
   above it. **The composition is reused, not rewritten**: the entry already carries `status`,
   `cardTitle`, `cwd`, `cardId`, `cardStatus`, `subtitle` — the exact fields `notifyContent()` renders
   for all three existing surfaces. The voice speaks `notifyMarker` + subject + subtitle.
4. A `BoardDesk` (a copy of `ResearchDesk`) queues it. The conversation loop takes it where it already
   takes a research result: cascade — `_talk_listen` returns `action="board"` once `ready()` and the
   VAD has heard nothing; realtime — `push_board()` polled beside `push_research()`, waiting on
   `_audio_done` and `not _user_speaking`, then `conversation.item.create` + `response.create`.
5. The assistant asks it out loud: *"On «Explorer loquivox», l'agent a une question — …. On fait quoi ?"*

*Voice → board*

6. You answer out loud. The turn is transcribed like any other.
7. A `collie_board` tool is on the table (declared twice, like `research`). The model calls it.
8. It returns `STARTED` at once and the HTTP call runs on a thread — the assistant says it is sending
   and carries on; the conversation never blocks on the network.
   *"réponds-lui que oui"* → `POST /api/cards/<id>/prompt`. *"lance-la"* → `/start`. *"note ça"* →
   `POST /api/cards` with `spec` (**never `rawInput`** — that fires the copilot and spends quota).
   *"passe-la en revue"* → `PATCH /api/cards/<id>`.
9. What the board answered comes back through the same desk, between two turns, and is spoken.
10. The prompted agent transitions again → step 1. The loop closes on its own, with nothing added to
    the board to close it.

## Consequences

- **`fc36c670` ("faire arriver les notifications collie-board dans la discussion") is done without
  touching `bridge/`.** Its "additional destination" is a *reader*, not an emitter. Adding a loquivox
  sink beside push/bell/digest is exactly what this ADR refuses.
- **What loquivox lacks** (all of the work is here): no external entry point at all → the polling
  thread + `BoardDesk`; both engines need their own injection branch (system message vs
  `conversation.item.create`), as `research` does; the outbound `BOARD_TOOL` in both shapes, dispatched
  in `TalkSession._answer` and in `RealtimeTalk._handle`; config under `[board]` + a Settings tab; and
  **a guard — the tool types into a real terminal, so a write action is confirmed out loud before it
  is sent**, never on one mis-transcribed sentence.
- **Nothing arrives outside a session.** The conversation only exists while F4/F6 is held. A
  notification with no session to land in is dropped — the push already covers that case. A "listening
  mode" that opens a session on a notification is a separate decision, not an implied one.
- **Two board-side gaps, neither blocking.** *No outbound stream* — no SSE, no WS; the log is polled,
  so latency is loquivox's poll on top of the 30 s debounce. *Retraction does not propagate* — the
  coordinator clears the slot, the log deliberately keeps the trace, so a question already handled at
  the keyboard would still be asked aloud. The predicate is readable (`GET /api/cards/<id>` gives the
  current status): **loquivox re-reads the card before speaking**, which is what § The board's "an
  alert that notifies must say how it retracts" requires of a fourth surface.
- **The 50-entry in-RAM log is the dedup boundary.** A cursor held in memory is enough within one
  loquivox run; across a restart the same notification can be asked twice.
- **The device gate.** With `COLLIE_BOARD_DEVICE_HEADER` on, writes need the header; loopback with no
  `Origin` is what lets an unheadered write through otherwise.
- **What would justify revisiting:** loquivox growing a real external entry point for its own reasons
  (a socket, a D-Bus name). Force 1 would fall — but 2, 3 and 4 would not, so this would still be a
  loquivox-side integration; only the transport would change.
