# Object shapes (observed)

**Statut :** ✅ décidé — contrat du socket herdr 0.9 vérifié en direct

Partie de [`HERDR_API.md`](../../../HERDR_API.md), qui en est le sommaire.

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
