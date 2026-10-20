// Subagents in flight — "this agent has N helpers running", read off the same session log the
// context gauge already reads (context.ts), at its cadence. Knowing they run is the whole feature:
// no access to them, nothing persisted.
//
// SHAPE OF THE SOURCE (verified against Claude Code 2.1.286–2.1.304, 2026-10-20, on 600 real logs
// under ~/.claude/projects — 320 subagent launches):
//   - the launch is an `assistant` row with a `tool_use` named "Agent" (never "Task" in any log
//     here), `input.description` the short label;
//   - its `tool_result` comes back AT ONCE, with `toolUseResult.status` "async_launched" (291) or
//     "forked" (29) — every launch, `run_in_background` or not, so "no tool_result yet" never meant
//     "still running" in practice and is not counted;
//   - the end is a `<task-notification>` naming `<tool-use-id>` with a `<status>` (completed,
//     failed, killed, stopped), journaled as a queue-operation, a queued_command attachment or a
//     plain user row — so it is matched on the raw line, whatever row carries it;
//   - a session that EXITS with subagents still running writes no notification, but writes a
//     `cost-state` row: all 4 launches without a notification were followed by one, and no
//     notification ever followed a `cost-state` for a launch before it. A launch older than the
//     newest `cost-state` is therefore dead.
// Not covered, on purpose: an agent finished and then woken by SendMessage (it can notify twice) —
// the count says "done" for it, an under-count rather than a phantom.

const NOTIFIED_RE = /<tool-use-id>(toolu_[A-Za-z0-9_-]+)<\/tool-use-id>/g;
const RUNNING = new Set(["async_launched", "forked"]);

/** Descriptions of the subagents a Claude session log says are still running, oldest first. PURE. */
export function runningSubagents(text: string): string[] {
  const launched = new Map<string, string>(); // tool_use id → description
  const started = new Set<string>();
  const finished = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.includes("<task-notification>")) {
      for (const m of line.matchAll(NOTIFIED_RE)) finished.add(m[1]!);
    }
    // Cheap filters first: only three row shapes matter, and logs run to tens of megabytes.
    const cost = line.startsWith('{"type":"cost-state"');
    if (!cost && !line.includes('"Agent"') && !line.includes('"toolUseResult"')) continue;
    let row: { type?: unknown; isSidechain?: unknown; message?: { content?: unknown }; toolUseResult?: unknown };
    try {
      row = JSON.parse(line) as typeof row;
    } catch {
      continue;
    }
    if (row.type === "cost-state") {
      // The session exited: whatever it had launched died with it.
      launched.clear();
      started.clear();
      continue;
    }
    if (row.isSidechain === true || !Array.isArray(row.message?.content)) continue;
    for (const b of row.message.content as { type?: unknown; id?: unknown; name?: unknown; input?: { description?: unknown }; tool_use_id?: unknown }[]) {
      if (row.type === "assistant" && b?.type === "tool_use" && b.name === "Agent" && typeof b.id === "string") {
        launched.set(b.id, typeof b.input?.description === "string" ? b.input.description : "");
      } else if (row.type === "user" && b?.type === "tool_result" && typeof b.tool_use_id === "string") {
        const status = (row.toolUseResult as { status?: unknown } | null)?.status;
        if (typeof status === "string" && RUNNING.has(status)) started.add(b.tool_use_id);
      }
    }
  }
  return [...launched].filter(([id]) => started.has(id) && !finished.has(id)).map(([, d]) => d);
}
