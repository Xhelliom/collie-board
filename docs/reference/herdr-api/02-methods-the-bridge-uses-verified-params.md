# Methods the bridge uses (verified params)

**Statut :** ✅ décidé — contrat du socket herdr 0.9 vérifié en direct

Partie de [`HERDR_API.md`](../../../HERDR_API.md), qui en est le sommaire.

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
- **Bracketed-paste markers pass through unchanged.** Live-probed 2026-11-04 (herdr 0.9.5): a
  `send_text` of `ESC[200~aaaaaaaaaa\nZ ESC[201~` into `cat -v` came back as `^[[200~aaaaaaaaaa` /
  `Z^[[201~` — herdr neither strips the markers nor checks whether the program enabled bracketed-paste
  mode (DECSET 2004). A program that did not would show them as text, so frame only for a harness
  known to read them.
- **Long text into Claude Code — measured on Linux, herdr 0.9.5, Claude Code 2.1.318 (2026-11-04).**
  Each send checked in the session's `.jsonl` after submit:

  | Send | Size | Arrived |
  | --- | --- | --- |
  | `send_text` raw, one line | 4,931 chars | whole |
  | `send_text` raw, 1,000 lines | 4,931 chars | whole |
  | `send_text` raw, one line | 13,331 chars | whole |
  | `send_text` framed `ESC[200~ … ESC[201~`, 2,400 lines | 13,329 chars | whole |
  | `agent.prompt`, 2,400 lines | 13,329 chars | whole, and submitted |

  Raw or framed, Claude Code shows `[Pasted text #N]` and records the turn wrapped in
  `<pasted_content id="…">…</pasted_content id="…">` (stripped by `unwrapPastes`, `bridge/transcript.ts`).
  Upstream measured the failure on **macOS** (herdr 0.9.0, Claude Code 2.1.288: 12,029 chars sent,
  787 received): the PTY there hands Claude ~1 KB reads, Claude makes each read over 800 characters its
  own paste, and a short last read wipes the earlier ones. Not reproduced on Linux, whose reads are
  larger. Collie Board frames a reply over 800 characters to a Claude pane anyway (`bridge/paste.ts`),
  for macOS hosts. `agent.prompt` could not be probed for framing (herdr refuses a target that is not
  the pane's foreground agent), so card prompts stay unframed — whole on Linux, unmeasured on macOS.
- **An ack means "herdr took the bytes", never "the TUI acted on them".** Both `send_text` and
  `send_keys` return before the target program has read, let alone rendered, anything. So a
  successful RPC pair is not evidence a reply was delivered — a focused TUI dialog can swallow the
  text and consume the Enter with both calls reporting success. Anything that needs delivery
  *confirmed* must read the pane back and look (`web/src/lib/reply-action.ts`).
