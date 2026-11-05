// What an agent is working through — its task list and the commands it left running in the
// background — read off the same session log the context gauge already reads (context.ts), at its
// cadence. Same posture as subagents.ts: knowing is the feature, nothing persisted, Claude only.
//
// SHAPE OF THE SOURCE
//   - Task list, two generations of Claude Code tools (the idea is upstream Collie's Tasks pill):
//       `TodoWrite` {todos:[{content,status,activeForm}]} — each call REPLACES the whole list;
//       `TaskCreate` {subject,description,activeForm} — its result carries `toolUseResult.task.id`;
//       `TaskUpdate` {taskId,status,subject?} — status "deleted" drops it.
//     A TaskCreate after every task is completed starts a new batch, as the TUI's own list does.
//     ponytail: not seen in any of this machine's 2.1.318 logs (verified 2026-11-05) — the shapes are
//     upstream's, which read them live. Claude Code's ~/.claude/tasks/ files are not read.
//   - Background commands (verified on this machine's logs, 2026-11-05: 322 launches): a `Bash`
//     tool_use whose result's `toolUseResult.backgroundTaskId` is set — `run_in_background`, or a
//     command pushed to the background on a timeout. It ends with a `<task-notification>` naming its
//     `<tool-use-id>` (the subagent end, same row), a `TaskStop`/`KillShell` naming its task id, or the
//     session exiting (`cost-state`, see subagents.ts).

export type TaskStatus = "pending" | "in_progress" | "completed";
export interface AgentTask {
  text: string;
  status: TaskStatus;
}

const MAX_TASKS = 50;
const NOTIFIED_RE = /<tool-use-id>(toolu_[A-Za-z0-9_-]+)<\/tool-use-id>/g;

type Block = { type?: unknown; id?: unknown; name?: unknown; input?: Record<string, unknown>; tool_use_id?: unknown };
type Row = { type?: unknown; isSidechain?: unknown; message?: { content?: unknown }; toolUseResult?: unknown };

function oneLine(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 200) : "";
}

function status(v: unknown): TaskStatus | "deleted" | undefined {
  return v === "pending" || v === "in_progress" || v === "completed" || v === "deleted" ? v : undefined;
}

/** The task list and the still-running background commands of a Claude session log. PURE. */
export function agentWork(text: string): { tasks: AgentTask[]; background: string[] } {
  let tasks = new Map<string, AgentTask>();
  const createdBy = new Set<string>(); // TaskCreate tool_use ids whose real id has not come back
  const bash = new Map<string, string>(); // Bash tool_use id → its label
  const running = new Map<string, string>(); // background task id → Bash tool_use id
  const finished = new Set<string>(); // Bash tool_use ids that ended
  for (const line of text.split("\n")) {
    if (line.includes("<task-notification>")) for (const m of line.matchAll(NOTIFIED_RE)) finished.add(m[1]!);
    const cost = line.startsWith('{"type":"cost-state"');
    // Cheap filter first: logs run to tens of megabytes and only these rows matter.
    if (!cost && !/"(TodoWrite|TaskCreate|TaskUpdate|TaskStop|KillShell|Bash)"|"toolUseResult"/.test(line)) continue;
    let row: Row;
    try {
      row = JSON.parse(line) as Row;
    } catch {
      continue;
    }
    if (row.type === "cost-state") {
      running.clear(); // the session exited, its shells with it
      continue;
    }
    if (row.isSidechain === true || !Array.isArray(row.message?.content)) continue;
    for (const b of row.message.content as Block[]) {
      if (row.type === "assistant" && b?.type === "tool_use" && b.input) {
        const input = b.input;
        if (b.name === "TodoWrite" && Array.isArray(input.todos)) {
          tasks = new Map();
          (input.todos as Record<string, unknown>[]).forEach((t, i) => {
            const s = status(t?.status) ?? "pending";
            const label = oneLine(t?.content);
            if (s !== "deleted" && label) tasks.set(`w${i}`, { text: label, status: s });
          });
        } else if (b.name === "TaskCreate" && typeof b.id === "string") {
          const label = oneLine(input.subject) || oneLine(input.description);
          if (!label) continue;
          if (tasks.size > 0 && [...tasks.values()].every((t) => t.status === "completed")) tasks = new Map();
          tasks.set(b.id, { text: label, status: "pending" });
          createdBy.add(b.id);
        } else if (b.name === "TaskUpdate") {
          const key = String(input.taskId ?? "");
          const task = tasks.get(key);
          if (!task) continue;
          const s = status(input.status);
          if (s === "deleted") tasks.delete(key);
          else tasks.set(key, { text: oneLine(input.subject) || task.text, status: s ?? task.status });
        } else if (b.name === "TaskStop" || b.name === "KillShell") {
          const id = running.get(String(input.task_id ?? input.shell_id ?? ""));
          if (id) finished.add(id);
        } else if (b.name === "Bash" && typeof b.id === "string") {
          bash.set(b.id, oneLine(input.description) || oneLine(input.command));
        }
      } else if (row.type === "user" && b?.type === "tool_result" && typeof b.tool_use_id === "string") {
        const result = row.toolUseResult as { backgroundTaskId?: unknown; task?: { id?: unknown } } | null;
        const created = createdBy.has(b.tool_use_id) ? b.tool_use_id : undefined;
        const realId = result?.task?.id;
        if (created !== undefined && (typeof realId === "string" || typeof realId === "number")) {
          // Re-key on the id TaskUpdate will name, keeping the list's order.
          tasks = new Map([...tasks].map(([k, v]) => [k === created ? String(realId) : k, v]));
          createdBy.delete(b.tool_use_id);
        }
        if (bash.has(b.tool_use_id) && typeof result?.backgroundTaskId === "string") {
          running.set(result.backgroundTaskId, b.tool_use_id);
        }
      }
    }
  }
  const list = [...tasks.values()];
  return {
    // A list whose every task is done is history, not work — the mark goes with it.
    tasks: list.every((t) => t.status === "completed") ? [] : list.slice(0, MAX_TASKS),
    background: [...running.values()].filter((id) => !finished.has(id)).map((id) => bash.get(id)!),
  };
}
