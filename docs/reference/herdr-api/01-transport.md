# Transport

**Statut :** ✅ décidé — contrat du socket herdr 0.9 vérifié en direct

Partie de [`HERDR_API.md`](../../../HERDR_API.md), qui en est le sommaire.

- Unix domain socket at `$HERDR_SOCKET_PATH` (default `~/.config/herdr/herdr.sock`).
- **Windows: a named pipe**, not AF_UNIX nor TCP (live-probed against 0.9.5, 2026-10). `herdr
  status` reports `socket: %APPDATA%\herdr\herdr.sock`; that path is an ordinary 24-byte file
  (`<pid>:<timestamp>`), and the real transport is the pipe named after the full path,
  `\\.\pipe\C:\Users\<user>\AppData\Roaming\herdr\herdr.sock`. Named sessions follow the same
  scheme under `%APPDATA%\herdr\sessions\<name>\herdr.sock`. Same JSON, same one-shot RPC, same
  streaming `events.subscribe`; `bridge/dial.ts` maps the path and dials it with `node:net`. Every
  method below answered there, `worktree.create` included once the server's PATH had git (see the
  [reconnaissance](../../multi-machine/reconnaissance-windows.md) § 1).
- **Newline-delimited JSON.** Request: `{"id": <string>, "method": <string>, "params": <object>}`.
  - `id` **must be a string** (integer → `invalid_request`).
- Response: `{"id", "result": {"type": "...", ...}}` or `{"id": "", "error": {"code", "message"}}`.
- **RPC is one-shot: the server closes the connection after a single response.** Send one
  request per connection. (Confirmed: a second request on the same connection never replies —
  the socket is already closed.)
- Malformed requests close the connection too, and the serde error message names the missing/
  wrong field — which is how this contract was reverse-engineered without side effects.
- **Exception:** `events.subscribe` keeps the connection open and streams events.
