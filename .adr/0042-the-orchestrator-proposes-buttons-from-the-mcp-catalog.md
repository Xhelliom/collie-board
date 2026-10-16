# 0042 — The orchestrator proposes buttons whose action comes from the MCP catalog

**Status:** Accepted

## Context

The orchestrator often ends on a question that settles in one gesture — « je fusionne ? », « je lance
le lot ? ». The operator answered by typing « oui » in the composer, then the orchestrator made the
call itself — or could not, when the route refuses its pane header (a launch). The operator asked for
buttons in the orchestrator's messages, on a model agreed with them: **free look, action from the MCP
tool catalog**.

## Decision

- **Syntax.** A fenced block tagged `collie-buttons` holding a JSON array of
  `{label, tone?, size?, wide?, action, args?}`, rendered by `web/src/components/markdown-text.tsx`.
  The look (label, tone mapped on the theme, size, row width) is the orchestrator's to choose.
- **One catalog.** The tool table left `bridge/mcp.ts` for `web/src/lib/board-tools.ts`: name, schema,
  readOnly/destructive, the HTTP calls (`run`) and a `preview` (what it will do, in words, GETs only).
  The MCP server lists and runs it; the browser runs the same `run` over the same routes — it never
  starts the MCP server. A new MCP tool is a possible button with no other work. Args are checked
  against the tool's schema; an unknown action or bad args greys the button with the reason and sends
  nothing. It lives under `web/` because Vite's dev server will not serve a file outside its root,
  while Bun imports anything.
- **One action outside it: `say {text}`**, which types into the pane of *this* orchestrator. A tool
  that types into another agent's pane (`reply_to_agent`) is not a button (`button: false`): typing in
  an agent's terminal stays the operator's own gesture. `notify` neither: it needs a pane header.
- **What the button shows is computed from action+args, never from its label**: « Fusionner « titre »
  dans main », « Lancer le lot « nom » ». A destructive tool asks once more, in place. Never an id.
- **Only in the orchestrator's conversation, only in its own words.** The orchestrator panel sets the
  context; a user turn (the operator's, or a `[vocal]` message typed in), a summary, a note or a
  thinking block resets it. Anywhere else — another agent's output, the pane screen — the block is code.
- **The tap is the operator's, with the operator's rights.** That is the point. Writing a block runs
  nothing; a route that refuses the orchestrator still refuses it.

## Why not a free action (any method + path + body)

A button is a reassuring label on top of a request. With a free action, « Oui » could be a `DELETE`,
and the label would say nothing about it. The orchestrator also reads content it does not control —
card specs, agent output, PR text — so an injected instruction could make it write such a block, and
the operator would tap a lie. With a catalog the request is one of a known few, its args are checked,
and the screen says what it does from the args themselves.

## Consequences

- The buttons are spent after one tap, for the life of the screen; a reload shows them live again —
  the bridge's own guards (a merged card, a launched lot) answer a second tap.
- The tools' sentences are French, as the MCP server's were.
