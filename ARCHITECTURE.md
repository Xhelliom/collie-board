# Architecture — Collie (a Herdr web bridge over Tailscale)

> **Fork note.** This document is upstream Collie's and still describes the bridge accurately —
> the deployment model, the interaction loop and especially §6's security posture are unchanged and
> remain load-bearing. What Collie Board adds sits on top of it and is described in §9; the fork's
> posture toward upstream is in [`UPSTREAM.md`](./UPSTREAM.md).

> **Why Collie is shaped the way it is.** The deployment model, the interaction loop, and especially
> the security posture — the reasoning the code can't state itself. This describes what is built; a
> few deliberate *non*-decisions are called out as such, and §8 parks ideas that are not built on
> purpose. For how to run it see [`README.md`](./README.md); for repo conventions
> [`CLAUDE.md`](./CLAUDE.md); for the verified socket contract [`HERDR_API.md`](./HERDR_API.md).

## 1. The problem (real workflow, real pain)

The route Collie replaces: **Termux on Android → SSH into a tailnet machine → run the Herdr TUI.**
Three pains:

1. The on-screen **terminal keyboard is terrible** to type on.
2. **No voice control** in a terminal.
3. **Re-SSHing / re-logging-in every time** is tedious.

The goal: a **mobile web interface, reachable over Tailscale, that you don't have to keep logging
into** — so you can check on and steer your agent herd from a phone with the native keyboard and
voice, no SSH.

## 2. What Collie is

A Herdr web bridge — a long-lived local process that

- connects to Herdr's Unix-socket API (`$HERDR_SOCKET_PATH`),
- serves a **mobile-first web app**, with live state polled over HTTP (see §5),
- translates browser actions → socket methods,
- sits behind **one hardened front door** — `tailscale serve` (default; tailnet-only HTTPS +
  MagicDNS) or a conforming reverse proxy
  ([README → Variant C](./README.md#variant-c--reverse-proxy-as-the-only-front-door-no-tailscale)) —
  installable as a **PWA**.

The browser never touches the socket directly; the bridge is the only thing that does.

```
   phone / laptop (PWA)
        │  HTTPS over tailnet  (https://herd.<tailnet>.ts.net)
        ▼
   tailscale serve  ── injects identity headers, terminates TLS   (Variant C: a reverse proxy instead)
        │  127.0.0.1:PORT   (bridge binds loopback ONLY)
        ▼
   Collie (this project)
     • static web app + small JSON API (browser polls /api/snapshot)
     • herdr-client adapter (the ONLY code that knows socket method names)
     • snapshot poll, event-poked (see §5)
        │  newline-delimited JSON over Unix socket
        ▼
   Herdr server (owns panes, agents, state)
```

## 3. Deployment model — **systemd user service, not a plugin pane**

This is the clearest call in the design. A plugin **pane** runs inside a terminal pane: if the pane
closes, the user detaches, or Herdr restarts, the bridge dies — exactly when you're on mobile and not
watching the TUI. A long-lived network daemon must be supervised independently.

- **The bridge runs as a `systemd --user` service** (launchd agent on macOS) — starts at login,
  restarts on failure, survives Herdr restarts.
- **The Herdr plugin stays — as a thin registration/launcher,** so the bridge shows up in
  `herdr plugin list` and Herdr conventions still apply. Its `[[actions]]` do things like
  `systemctl --user start collie-board` and **print the tailnet URL**; they do *not* host the server. A
  `[[build]]` step builds the web UI on `herdr plugin install` (GitHub); local `link` installs skip
  it and build lazily on first `start`. Concretely that's `[[actions]]` + `[[build]]` and nothing
  else: `[[panes]]` is what this section argues against, and `[[events]]` would duplicate the
  bridge's own `events.subscribe` stream (§5).
- **Socket-path discovery:** a non-Herdr-launched daemon won't get `$HERDR_SOCKET_PATH` injected, so
  it resolves the path from a well-known location (`~/.config/herdr/herdr.sock` default, or the
  bridge's own config) and re-resolves on reconnect in case it moves.

## 4. The core interaction loop

Deliberately **not** full terminal mirroring. The loop:

```
agent goes blocked
   → PUSH notification  (which agent, which workspace — see the gap below)
   → tap → app opens to that agent
   → the pane, with recognised prompts parsed into tappable blocks
       (prompt-select · preview-select · wizard)   ← structured, not a raw screenful
   → reply:  plain text box (Android's keyboard handles voice dictation for free)
             + quick actions + a special-key strip
   → explicit Send button  → agent.send + Enter
   → "Sent ✓" + card flips blocked → working   ("did it land?" confirmation)
```

Product details that shaped the loop:

- **Don't show a raw screenful.** A "last screenful" is often a mid-stack-trace — the actual
  question is lines above. Collie parses recognised prompts out of the pane text into interactive
  blocks (`web/src/lib/blocks.ts`), so answering a permission dialog or a menu is a tap, not a
  transcription exercise. The raw pane stays below for context.
  - **Where this stops short of the design.** The original intent was for the *bridge* to capture the
    output chunk at the moment Herdr says an agent went blocked, and hand the client a structured
    `BlockingMessage`. That was never built: parsing is client-side and pattern-based, over whatever
    the current pane happens to show. It works because agent prompts are formulaic, and it degrades
    to "read the pane" when they aren't.
- **Voice needs zero special build.** It's a plain text box — Android's default keyboard provides
  dictation via its mic button. No Web Speech API, no push-to-talk, no voice-specific fallback. Send
  is a normal explicit button, so dictated text is naturally reviewable before it goes — that's just
  how the box works, not a feature to build.
- **Quick replies are heuristics, not guarantees.** Different agents expect different input (a Y/n
  prompt vs a numbered menu vs an approval phrase), so there is always a **"send exactly what I
  type"** fallback.
- **Opinionated triage.** The home screen leads with **"NEEDS YOU"** — blocked agents at top,
  working/idle collapsed below. Simultaneous blocks batch into one summary notification, not three
  races.
- **Close the trust loop.** A "Sent" state on the `POST`'s HTTP response, then the visible
  blocked→working transition. Without it, latency makes users double-tap.
- **Manage a pane in place.** Long-pressing a pane pill in the tab's pane switcher opens a small
  actions sheet — rename it (the label then leads its cards/headers) or close it. Both are the same
  `pane.rename` / `pane.close` writes the security posture already covers
  (`web/src/components/pane-actions-sheet.tsx`).

**Known gap — the notification body doesn't carry the question.** The design called for putting the
agent's question *in* the notification, so a tap is actionable even before the app loads (§7 explains
why that matters on Android). What ships identifies **which** agent needs you — title `<agent>
<verb>`, body `<workspace> · <cwd>` (`bridge/notifications.ts`) — and you read the question in the
app. Closing this needs the server-side blocking-message capture described above.

## 5. Architecture notes

- **The `herdr-client` adapter is the only module that knows socket method names** (`pane.read`,
  `agent.send`, `events.subscribe`, …). It translates to/from an internal domain model
  (`AgentStatus`, `AgentView`, `SnapshotResponse` — `bridge/types.ts`), so a Herdr API rename is a
  one-file fix, not a shatter.
- **One protocol, two dialers.** Herdr's control socket is AF_UNIX on Linux/macOS and a *named pipe*
  on Windows (named after the full socket path). `bridge/dial.ts` is the only place that knows the
  difference: `Bun.connect({unix})` on POSIX, `node:net` on Windows. The wire protocol is identical —
  the `interprocess` crate Herdr uses inserts no framing or metadata, so the same newline-delimited
  JSON-RPC speaks to both, streaming `events.subscribe` included. `COLLIE_BOARD_HERDR_DIAL=net` forces the
  Windows dialer anywhere, which is how that branch stays tested off Windows.
- **Output model: poll, not stream — event-poked.** Herdr exposes `pane.read` (snapshot) and
  `pane.output_matched` (regex event) but **no raw output-stream event**, so there is nothing to
  stream even if we wanted to; the live pane view is poll-on-status-change + caching. The bridge's
  Herdr-facing poll ticks `session.snapshot` — one RPC returning every workspace/tab/pane/agent/
  layout — falling back to the `workspace.list` + `pane.list` (+ `tab.list`) trio on older servers
  (full contract in [`HERDR_API.md`](./HERDR_API.md)). A long-lived `events.subscribe` stream runs
  alongside purely to **poke** that poll: lifecycle events plus a per-agent-pane
  `pane.agent_status_changed` subscription trigger an immediate debounced re-poll, while the interval
  relaxes to `COLLIE_BOARD_POLL_IDLE_MS` (12 s default) whenever the stream is healthy and drops back to
  the fast `COLLIE_BOARD_POLL_MS` when it isn't. **The snapshot poll stays the source of truth throughout —
  a missed event costs one interval, never correctness.**
- **Scrollback comes from the transcript, not the terminal.** An agent's TUI runs on the *alternate
  screen* (`ESC[?1049h`), so the emulator keeps no scrollback ring and `pane.read` can never return
  more than the visible viewport — the live mirror physically cannot scroll back. Pane history is
  therefore read from the agent's **own transcript file** off disk (`bridge/transcript.ts`,
  `/api/pane/:id/history`), a separate source from the mirror with different fidelity: turns and
  their text, not a replay of the screen. The client fetches the whole conversation in one request
  and renders a window that grows upward, which is what lets find-in-history and jump-to-user-turn
  work across turns you haven't scrolled to. Rationale and the measured numbers are commented at the
  top of `web/src/routes/history.tsx`.
- **The browser polls too.** `useRevalidator` → `/api/snapshot` on an adaptive interval. There is no
  WebSocket fan-out to the browser and no push of state; pulling is what makes the two recovery loops
  below trivial.
- **Two independent recovery loops, designed in from the start** (not retrofitted):
  - *bridge ↔ Herdr*: the snapshot poll doubles as resync — a failed tick marks the herd
    disconnected (the UI's connection bar shows "Herdr offline") and keeps retrying; the
    `events.subscribe` stream reconnects with backoff and re-subscribes, and since it only pokes the
    poll, a dropped stream costs latency, never correctness.
  - *browser ↔ bridge*: polling makes reconnect trivial — failed polls surface in the connection bar
    / offline banner, and the next successful poll heals the UI. No socket lifecycle to manage.
- **Polling moots per-client backpressure.** A push design would need `bufferedAmount` watching so a
  slow phone couldn't OOM the bridge. Each client instead fetches a bounded snapshot at its own pace,
  so there is nothing to buffer or coalesce.
- **Render `pane.read` safely** (see §6): strip ANSI **server-side** to plain text and render it as
  React text nodes; never `innerHTML` raw terminal output.
- **PWA cache-busting.** Service workers serve stale clients after an update, so the build stamp
  travels in every response (`X-Collie-Build` header + `/api/config`); on mismatch the footer offers
  "new build — tap to update."

## 6. Security model

This socket equals **arbitrary code execution on the host** (`agent.send` / `pane.send_text` type
into live terminals). The posture is single-user, behind one hardened front door (tailnet-only by
default). These four are genuine RCE vectors and are **load-bearing — do not regress them:**

- **The bridge binds `127.0.0.1` only** and lets its single front door proxy it. Binding `0.0.0.0`
  makes the whole access check theater. But be exact about what that bind buys: it bounds **remote**
  reach, not local. Herdr's socket is a filesystem object, so its permissions bound callers to the
  owning uid; a TCP port bounds callers to the network namespace, which every uid on the host shares.
  So a process running as a *different* user — an agent you deliberately put under
  `sudo -u agent-review` to contain it — cannot open your herdr socket but **can** open
  `127.0.0.1:$COLLIE_BOARD_PORT` and drive any pane in the herd. Installing Collie removes that uid
  boundary; if it is the containment you were relying on, the device gate below makes that port
  **read-only** — the one write gate that doesn't rest on "local means trusted". Note its scope: it
  gates writes and only writes, so that uid keeps reading snapshots, pane output and transcript
  history. It bounds damage, not disclosure. Closing the read side is outside what the bridge does —
  it needs the port not to be shared in the first place (its own network namespace, or a uid
  owner-match filter such as nftables `meta skuid`); a plain port firewall rule won't stop a
  same-host peer (raised in [#33](https://github.com/AltanS/collie/issues/33)).
  Under `tailscale serve`, the `Tailscale-User-Login` header is the person gate — trusted **only**
  when the request source is loopback (i.e. it came from tailscaled). `COLLIE_BOARD_TRUSTED_USER` rejects a
  *mismatching* login and **passes an absent one**: it narrows which tailnet user is trusted, it does
  not mandate the header. That is safe under `tailscale serve`, which injects it on every request, and
  not safe behind anything that might stop injecting it — the header exists **only** under
  `tailscale serve` ingress. Under a reverse-proxy front door
  ([README → Variant C](./README.md#variant-c--reverse-proxy-as-the-only-front-door-no-tailscale))
  there is none, and the equivalent write gate is **per-device auth** (`COLLIE_BOARD_DEVICE_HEADER`) with
  the proxy contract (README Variant B/C requirements) as the load-bearing piece. That gate **fails
  closed since 0.15.0**: with `COLLIE_BOARD_DEVICE_HEADER` set, a request arriving without the header is
  read-only, so reaching the port is no longer sufficient to write. Device ids are names your proxy
  asserts, not secrets — treat them as guessable and keep the front door and its ACL as the real
  containment.
- **`pane.read` output renders safely** — it's attacker-influenceable (filenames, agent output,
  fetched web content). Never `innerHTML`; it renders as React text nodes under a **strict CSP**
  (`default-src 'self'`), so an escaping miss can't run injected script that calls back into the
  socket.
- **A same-origin gate on every API request** — accepted only when the browser's `Origin` host equals
  the `Host` header the bridge receives (loopback always allowed), so a page on any other tailnet
  device can't CSRF the bridge. With a plain `tailscale serve` on the MagicDNS name these match
  automatically (no config). When Collie is fronted by a *different* public hostname or an extra
  reverse proxy / TLS terminator (custom domain, load balancer, Headscale + upstream TLS, or a
  reverse-proxy front door — [README → Variant C](./README.md#variant-c--reverse-proxy-as-the-only-front-door-no-tailscale)),
  the public origin no longer matches the forwarded `Host` — list that exact origin in
  `COLLIE_BOARD_ALLOWED_ORIGINS` (the only sanctioned way to widen the gate; never bind off-loopback to
  "fix" it).
- **Idle lock — a pause, not a gate.** It covers an unattended, visibly-open Collie after 30 minutes
  and pauses polling, but it is client state that starts `false` on every reload, so it gates nothing:
  a stolen unlocked phone is still an open shell, same as no lock at all
  ([ADR 0007](./.adr/0007-the-idle-lock-is-a-pause-not-a-gate.md)).

Also shipped, as defence in depth:

- **Audit log** — every write-level action appends a JSONL line (timestamp, method, truncated params)
  to `<stateDir>/audit.log`, mode 0600 since it may echo reply text. An audit failure never fails the
  user's action (`bridge/audit.ts`).
- **Destructive-action confirm** — a browser-side prompt when input pattern-matches `rm`, `sudo`,
  `git push --force`, `dd`, etc. (`web/src/lib/destructive.ts`). Prevents catastrophic mistaps.

Considered, not built:

- **Tailscale ACL scoping** to your specific devices (`src: tag:my-phone → dst: this:bridge`).
  Promote this to mandatory the moment the tailnet has any device you don't fully control.
- **A short PIN** gating reconnection — friction against a grabbed phone, on top of the idle lock.

Full passthrough (no command allow-list) is acceptable for a personal tool — an allow-list would
defeat the purpose. **Never use `tailscale funnel`** (public exposure).

## 7. Tailscale & PWA

- `tailscale serve` → tailnet-only HTTPS on a stable MagicDNS hostname; the node cert doesn't rotate,
  so the PWA stays signed in. No credential management, no login screen.
- Install as a PWA (Add to Home Screen) → app icon, instant open, persistent.
- Known failure mode (accept, don't engineer around): if `tailscaled` is down, the bridge is reachable
  on localhost but not via MagicDNS. On **Android specifically**, the OS backgrounds Tailscale
  aggressively — a notification tap may hit the app before the tunnel is up, and you wait. The
  intended mitigation (the agent's question in the notification body, so the tap is at least
  informative) is the gap noted at the end of §4.

## 8. Future ideas

Not planned, not scheduled — a parking lot for ideas surfaced while reading Herdr's socket surface,
so they don't get re-discovered from scratch or acted on by accident.

- **`herdr terminal session observe` / `control` (new in 0.7.2).** A CLI subcommand pair that streams
  a pane as NDJSON live ANSI frames — `observe` is read-only; `control` additionally accepts stdin
  commands (`terminal.input`, `terminal.resize`, `terminal.scroll`, `terminal.release`) with
  one-controller-at-a-time semantics (`--takeover` to steal control). A bridge process could spawn
  either as a child and get a true live pane mirror, or even a full interactive terminal, instead of
  polled snapshots. **But raw ANSI frames need a real terminal emulator to render** (cursor movement,
  screen clears, scroll regions — well beyond the current SGR-color-only parser, see
  [`HERDR_API.md`](./HERDR_API.md)), and rendering that faithfully in the browser would breach §6's
  "pane output is React text nodes only" XSS boundary. Adopt this deliberately, with a real
  terminal-emulator library and a re-examined threat model — or not at all. This is the designated
  parking spot for that idea; don't half-do it.


## 9. The board (this fork)

Collie is an ephemeral mirror: every tick re-reads the snapshot and nothing is persisted. That is
right for "which agent needs me now" and useless for "where is this task". The board adds the second
question, and exactly one rule carries the design: **`card` is durable, `session` is ephemeral.**

- **One store, no ORM** — `bun:sqlite` and raw SQL in `bridge/db.ts`. The schema is four tables wide
  and the bridge's dependency story stays "Bun + `node:*`". Additive migrations only.
- **No new loop.** Reconciliation, the context gauge, handoff completion and the copilot's review
  trigger are all `engine.onUpdate` hooks on the poll that already runs. There is no second source of
  truth and nothing to resync — the same reasoning as §5.
- **A DISCONNECTED snapshot is ignored, everywhere.** Its pane list is the last good one, and
  treating "the bridge lost herdr" as "every pane vanished" would orphan the entire board on a blip.
- **Nothing runtime is persisted.** The database holds intent and history. A card's status, cwd and
  agent still come from the snapshot on every read.
- **1 card = 1 branch = 1 workspace.** `worktree.create` returns a checkout, a workspace, a tab and a
  pane in one RPC, so the card's diff needs no scoping logic: it is that checkout against its fork
  point. The relationship falls out of herdr's model rather than being bookkeeping we maintain.
- **Primary session only.** A pane id means nothing in another herdr server. Multi-session cards
  would need a session column on every row for a use case that doesn't exist.
- **Security is not re-implemented.** `bridge/board-routes.ts` receives the same `guard()` every
  other route uses, so a board write is gated exactly like typing into a pane — which is what
  starting a card eventually is. `bridge/git.ts` is the only place the bridge shells out: argv
  elements, never a shell; the one client-supplied path is validated and always follows `--`.

### Splitting one dump into several cards

A dictated note routinely names three things. The copilot's reformulation can therefore return a
`split`, and two nullable self-references on `card` carry what comes out of it. They are kept
separate because they answer different questions:

- **`parent_id` — provenance.** "These came from the same brain dump." A card WITH children is a
  **container**: it keeps the original dictation, is refused a branch, is refused a start, and
  derives its status from its children (urgency first, so one blocked child outranks three that are
  working). The parent used to keep one of the tasks itself, which is precisely how the same work
  ended up on two cards.
- **`depends_on` — ordering.** One edge per card, not a list. Independent (null everywhere), serial
  (a chain) and the realistic mixed case all fall out of the same column, where a two-mode
  "parallel or sequential" flag can only express the first two. In the split answer it is an index
  pointing **backward**, which makes a cycle unrepresentable rather than merely unlikely; a hand
  edit through the API gets an explicit cycle check instead.

A third self-reference answers a third question, and is **not** a synonym for the first:

- **`origin_card_id` — where a card came OUT of.** The reviewed card a copilot follow-up was filed
  against, or the card whose working session filed an `agent` one (below). Reusing `parent_id` for it
  is the obvious-looking shortcut and it is wrong: it would make every reviewed card a container —
  unstartable, its column dragged around by its own follow-ups.
  This one carries no semantics at all beyond the caption it renders as (`from “…”`, on the tile and
  at the top of the card), which is the whole point: a follow-up's title is written as a note to the
  card it belongs to, so on its own it has lost the sentence that produced it. Set at creation,
  never patched, absent from the API's create allowlist — same rule as `origin`. It may dangle (like
  `duplicate_of`, unlike `parent_id`/`depends_on`, which `deleteCard` clears), and it resolves to no
  caption, which is the right degradation for a caption.

### A card that wrote itself

Two writers besides a person put cards on this board, and the point of `card.origin` is that they
are told apart rather than lumped into "not a human" (ADR 0010):

- **`copilot`** — the review's follow-ups, filed while you were elsewhere. Badged **auto**, and
  always carrying a `category` (the review's own triage of what it produced).
- **`agent`** — a working session that decided mid-turn there was something to record and `POST`ed
  a card through the local API. Badged **agent**, no category.

The second one has a problem the first doesn't: the bridge cannot tell who is calling. So the caller
declares itself with **`x-collie-pane`** — its `HERDR_PANE_ID`, which every herdr pane has for free —
and the bridge does the rest: `openSessionByPane()` turns that into the card being worked on, which
becomes `origin_card_id` (the `from “…”` caption). No match still marks the card; only the link is
lost. `origin` and `origin_card_id` remain absent from the create allowlist, so a body can never
claim either: the caller says WHO it is, the bridge says what that means.

The session's half of the trace is a **journal entry**, not a column — `card.filed` on the source
card, carrying the filing session's id. It is the only thing that says *which* session, on a card
with a handoff chain, and it costs no storage.

**The dependency is a gate, not a trigger.** A finished predecessor makes its successor
start*able* — it never starts it. An agent that launches itself writes code and spends the user's
quota with nobody watching, which is the one thing this board is arranged against, and it is the
same reasoning that keeps the copilot off by default.

**What actually passes between two cards is the branch.** A dependent card forks from its
predecessor's branch rather than the repo's base, because a serial task needs the previous one's
code, not a summary of it; its opening prompt says the branch is *not* clean and carries the
predecessor's review notes. The resolved base is persisted onto the card, since `base_ref` is also
the left side of its diff — left at `main` the card would display its predecessor's work as its own.
This is deliberately **not** the `.board/handoff.md` mechanism: that one is for context exhaustion
inside a single card, where the next agent inherits the same worktree and can read the note from its
own cwd. Across two cards the file isn't even there.

### The follow-up that shouldn't have been a card

A review's follow-ups become cards, and nearly all of them should. One shape shouldn't. "Note in
`NOTIFY_AUDIT.md` that step 1 landed" is one line into a file the review just named — and a card for
it is a card you triage, filter, drag and eventually delete, a chore the tool invented. So that one
**is not filed at all**: it stays on the review as a `TinyTodo`, carrying the spec the card would
have had, and the reviewed card's screen offers it as **one tap — finish it now** — which sends it
to that card's OWN agent. Which is right there: the review fires the moment the work lands, so the
agent is still at its prompt, in the right worktree, with the context open.

**The criterion is written once** (`isTinyFollowUp`, `bridge/copilot.ts`), and it is three clauses:
one edit to one file the review can name; the review already knows what to write; nothing verified
beyond the edit landing. The first two are the reviewer's to judge — nothing on the bridge side can
tell "one edit" from a title — so the copilot answers them, from a prompt stating the same three
clauses. The third is restated as a closed list of categories (`docs`, `chore`) and enforced in
code: a `bug`, a `feature` and a `test` all end in someone checking the result, so none of them is
ever tiny however the model answers. A one-line fix that misses the floor simply becomes an ordinary
card, which is the harmless direction — the fork's rule that a gauge which might be wrong is worse
than no gauge.

**Not filing it costs something, and the row pays it.** A suggestion with no card is a suggestion
that cannot be started, so when that agent is gone the row shows the SPEC in full rather than an
offer: nothing was filed, so this row is the only place the note still exists, and it has to be
readable by the person who now has to do it. `doneAt` is the one write a review ever gets after
creation, and it has to be durable — without it the offer stays live and a second tap makes the
agent do the same edit twice.

**Same switches, same gate.** A tiny suggestion is produced under `autoFollowUps` and the per-category
switches exactly like a filed one — a board that asked for no follow-ups gets none of either. And
like `startCard`, nothing here is automatic: the operator taps it, same reasoning as the dependency
gate above.

**And the operator makes the same call, by hand.** The arbitrage above is a judgement, not a
privilege the copilot holds: a card you are looking at can be *converted into an action*
(`convertToAction`, `bridge/cards.ts`) — its spec and acceptance become a `TinyTodo` on another
card's screen, the same row with the same tap, and the card itself is deleted. Two ways in, one
target each: a sub-task's "⋯" puts the action on the container you have open, and a card's own "⋯"
puts it on its container — or, for a copilot follow-up, on the card it was filed against, which is
the case this exists for (the copilot judged it worth a card and you disagree). Deleting is the
point: a card AND an action saying the same thing is the chore the conversion removes, and what was
in the card survives as the action's spec, shown in full when that agent is gone.

The review it lands on carries the verdict `converted` and journals `card.action_added`, not
`review.created` — the copilot reviewed nothing, and `tell` announces a `review.created` in the bell
(NOTIFY_AUDIT §6.3 B2). An alert for a tap the operator just made is what §6 refuses.

### Three herdr behaviours the docs don't state

Live-probed against 0.7.5 on 2026-07-28, re-checked against 0.8.0 on 2026-08-07. Each one silently
breaks the obvious implementation:

1. **`agent.start` does not wait.** The CLI's help says success means the agent "is ready for input",
   but that is the CLI polling afterwards. The socket method returns in ~2 ms with
   `agent_status: "unknown"` and leaves `launch_pending: true`. Poll `agent.get` for
   `interactive_ready` (`launchAgent()`).
2. **`agent.prompt` does not reliably submit.** A multi-line prompt lands in Claude Code's box as
   `[Pasted text #N +M lines]` and sits there; one `Enter` afterwards submits it untouched. Same
   class as the `send_text` + `send_keys` race HERDR_API.md already documents. Read the state back
   and look (`promptAndConfirm()`). 0.8.0 narrows this upstream — herdr now waits briefly between
   the text and its own Enter (#1878) — but `promptAndConfirm` stays exactly as it is: the modal
   case it also covers is untouched, its Enter only fires when the agent is neither `working` nor
   `blocked` (so a prompt that did land costs nothing), and the plugin still supports 0.7.x.
3. **`agent_session` is absent by default.** It only appears once `herdr integration install claude`
   has planted its hook — not one agent pane in a plain install carried it, which means Collie's own
   pane History is unavailable by default too. The gauge falls back to resolving the transcript from
   the directory the agent was launched in, which is sound only because the board created it.
