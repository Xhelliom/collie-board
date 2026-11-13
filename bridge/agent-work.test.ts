// Background rows are trimmed copies of real Claude Code 2.1.318 log rows; task rows follow the
// shapes upstream Collie reads (see agent-work.ts).
import { describe, expect, it } from "bun:test";

import { agentWork, lastSaid } from "./agent-work.ts";

const use = (id: string, name: string, input: unknown, sidechain = false) =>
  JSON.stringify({ isSidechain: sidechain, type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, toolUseResult: unknown) =>
  JSON.stringify({ isSidechain: false, type: "user", message: { content: [{ tool_use_id: id, type: "tool_result", content: "" }] }, toolUseResult });
const notified = (id: string) =>
  JSON.stringify({
    type: "queue-operation",
    operation: "enqueue",
    content: `<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n</task-notification>`,
  });
const run = (...rows: string[]) => agentWork(rows.join("\n"));

describe("agentWork — tasks", () => {
  it("takes the latest TodoWrite list whole", () => {
    const first = use("toolu_1", "TodoWrite", { todos: [{ content: "Lire", status: "completed" }, { content: "Écrire", status: "pending" }] });
    const second = use("toolu_2", "TodoWrite", {
      todos: [
        { content: "Lire", status: "completed" },
        { content: "Écrire", status: "in_progress" },
        { content: "Tester", status: "pending" },
      ],
    });
    expect(run(first, second).tasks).toEqual([
      { text: "Lire", status: "completed" },
      { text: "Écrire", status: "in_progress" },
      { text: "Tester", status: "pending" },
    ]);
  });

  it("follows TaskCreate / TaskUpdate by the id the create returned", () => {
    expect(
      run(
        use("toolu_a", "TaskCreate", { subject: "Parser", description: "…" }),
        result("toolu_a", { task: { id: "1", subject: "Parser" } }),
        use("toolu_b", "TaskCreate", { subject: "Afficher" }),
        result("toolu_b", { task: { id: "2" } }),
        use("toolu_c", "TaskCreate", { subject: "Jeter" }),
        result("toolu_c", { task: { id: "3" } }),
        use("toolu_d", "TaskUpdate", { taskId: "1", status: "completed" }),
        use("toolu_e", "TaskUpdate", { taskId: "2", status: "in_progress" }),
        use("toolu_f", "TaskUpdate", { taskId: "3", status: "deleted" }),
      ).tasks,
    ).toEqual([
      { text: "Parser", status: "completed" },
      { text: "Afficher", status: "in_progress" },
    ]);
  });

  it("drops a list once every task is done, and a new create starts a fresh batch", () => {
    const done = [use("toolu_a", "TaskCreate", { subject: "Ancien" }), result("toolu_a", { task: { id: "1" } }), use("toolu_b", "TaskUpdate", { taskId: "1", status: "completed" })];
    expect(run(...done).tasks).toEqual([]);
    expect(run(...done, use("toolu_c", "TaskCreate", { subject: "Nouveau" })).tasks).toEqual([{ text: "Nouveau", status: "pending" }]);
  });

  it("ignores a subagent's own list", () => {
    expect(run(use("toolu_1", "TodoWrite", { todos: [{ content: "x", status: "pending" }] }, true)).tasks).toEqual([]);
  });
});

describe("agentWork — background commands", () => {
  const bg = (id: string, task: string, description: string) => [
    use(id, "Bash", { command: "bun run build", description, run_in_background: true }),
    result(id, { stdout: "", stderr: "", interrupted: false, backgroundTaskId: task }),
  ];

  it("lists a backgrounded command until it notifies, is stopped, or the session exits", () => {
    const rows = [...bg("toolu_A", "bA", "Build"), ...bg("toolu_B", "bB", "Serveur de dev")];
    expect(run(...rows).background).toEqual(["Build", "Serveur de dev"]);
    expect(run(...rows, notified("toolu_A")).background).toEqual(["Serveur de dev"]);
    expect(run(...rows, use("toolu_s", "TaskStop", { task_id: "bB" })).background).toEqual(["Build"]);
    expect(run(...rows, JSON.stringify({ type: "cost-state", sessionId: "s" })).background).toEqual([]);
  });

  it("does not count a foreground Bash call", () => {
    expect(run(use("toolu_A", "Bash", { command: "ls" }), result("toolu_A", { stdout: "x", stderr: "" })).background).toEqual([]);
  });
});

describe("lastSaid", () => {
  const said = (text: unknown, sidechain = false) =>
    JSON.stringify({ isSidechain: sidechain, type: "assistant", message: { content: [{ type: "text", text }] } });
  it("reads the newest main-thread text, one line", () => {
    const text = [said("vieux"), said("Je lis\n  le code."), use("toolu_9", "Bash", { command: "ls" }), said("sous-agent", true), "{partial"].join("\n");
    expect(lastSaid(text)).toBe("Je lis le code.");
  });
  it("caps a long message and says nothing on an empty log", () => {
    expect(lastSaid(said("x".repeat(300)))).toHaveLength(160);
    expect(lastSaid("")).toBeNull();
  });
});
