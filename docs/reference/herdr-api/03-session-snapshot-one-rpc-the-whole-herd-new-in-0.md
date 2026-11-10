# `session.snapshot` — one RPC, the whole herd (new in 0.7.2)

**Statut :** ✅ décidé — contrat du socket herdr 0.9 vérifié en direct

Partie de [`HERDR_API.md`](../../../HERDR_API.md), qui en est le sommaire.

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
