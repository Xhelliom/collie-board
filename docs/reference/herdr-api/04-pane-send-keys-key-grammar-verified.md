# `pane.send_keys` key grammar (verified)

**Statut :** ✅ décidé — contrat du socket herdr 0.9 vérifié en direct

Partie de [`HERDR_API.md`](../../../HERDR_API.md), qui en est le sommaire.

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
- **NOT supported** (all return `invalid_key`): tmux-style `BTab`; and the keys
  `PageUp` `PageDown` `Home` `End` `Insert` `Delete` (in any spelling). There is no forward-delete
  and no scrollback paging via keys — the web mirror is scrollable instead.
- **`C-c` changed in 0.9.5**: `invalid_key` through 0.7.0, **accepted** in 0.9.5 (live-probed on
  Windows, 2026-10: `{"type":"ok"}`, typed as `^C`). `BTab` is still refused there.
- ⚠️ Consequence: Ctrl-C is **`ctrl+c`** — the spelling every version accepts, and the bridge's.
  Multiple keys per call are applied in order, e.g. `{keys:["Down","Enter"]}`.
- Re-checked against 0.7.2's bundled schema: unchanged.
