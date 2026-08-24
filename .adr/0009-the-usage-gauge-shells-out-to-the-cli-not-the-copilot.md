# 0009 — The usage gauge shells out to the CLI, not the copilot

- **Status:** Accepted
- **Date:** 2026-08-24
- **Shipped in:** 0.109.0

## Context

The dashboard needed to show how much Claude Code quota is left. The obvious route, and the one the
request proposed, was the copilot: it is already a live Claude session in a pane, so ask it to run
`/usage` and read the answer back. The request itself framed that as a **workaround** — "if there's
no other way" — so the first job was to look for a direct source.

Three were checked on this machine:

| Candidate | Verdict |
| --- | --- |
| `~/.claude/stats-cache.json` | Cumulative token counts per model, no limits, and `lastComputedDate` was **five weeks stale**. Not a quota figure. |
| The session transcripts (`~/.claude/projects/**.jsonl`) | Grepped for `five_hour` / `weekly_limit` / `utilization` / `rateLimit`: every hit was source code or shell output quoted inside a conversation. Claude Code records no limit state there. |
| The OAuth credentials + an undocumented account endpoint | Would put the bridge in the business of reading the user's tokens and calling an API nobody promised to keep. Rejected on the security posture alone. |

Then the CLI itself:

```
$ time claude -p "/usage"
Current session: 53% used · resets Aug 24, 11:59am (Europe/Paris)
Current week (all models): 15% used · resets Aug 26, 4:59pm (Europe/Paris)
Current week (Fable): 0% used
…
1.5s total
```

The slash command runs headlessly and prints the same panel as plain text, in a second and a half,
**without a model turn** — the panel is rendered locally. That is the direct source: same command
the request named, without the copilot in the middle.

The copilot route, by comparison: a queued agent request (serialised behind every card being
reformulated), five minutes of deadline, a pane whose TUI panel would have to be scraped or coaxed
into a file, and a model turn spent out of the very quota being measured.

## Decision

Read the gauge with `Bun.spawn(["claude", "-p", "/usage"])` from `bridge/usage.ts`, parse the limit
lines, cache the reading for fifteen minutes. **Do not involve the copilot.**

This is a **third shell-out**, in a fork whose rule is that `bridge/git.ts` is the only place we
shell out (`proc.ts`'s `ps` being the existing second). The rule's substance — argv elements never a
shell, no client-supplied argument anywhere near the command line — holds here: the argv is a
compile-time constant, and `?refresh=1` only chooses whether to skip a cache.

Refresh is **on arrival plus a button**, not a timer. The request left the cadence open ("every 15
minutes… or half an hour?" vs. "refresh when you land on the page"); on-arrival wins because it
needs no periodic work in a fork whose rule is *no new poll loop*, and the bridge's TTL already
bounds how old the answer can be. The gauge is fetched on mount — deliberately not from the root
loader, which revalidates every 1.5 s.

## Consequences

- The panel's wording is now a wire format we parse. It is one regex, isolated, and unit-tested
  against a captured panel; when it drifts, `parseUsage` finds nothing and the gauge **disappears**
  rather than showing a stale or invented number (same posture as the context gauge).
- A host with no `claude` on `PATH` — a herd of some other agent — shows no gauge. Correct: the
  figure is Claude Code's, and there is nothing honest to put in its place.
- The reading is machine-local, like `/usage` itself: it does not include other devices or claude.ai.
- **What would justify revisiting:** an API or on-disk file that reports limits (then drop the
  subprocess), or a second harness growing an equivalent command (then this belongs in
  `adapters/agents.toml` next to `clear`, not hard-coded).
