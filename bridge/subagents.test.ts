// The rows below are trimmed copies of real Claude Code 2.1.30x log rows (see subagents.ts).
import { describe, expect, it } from "bun:test";

import { runningSubagents } from "./subagents.ts";

const launch = (id: string, description: string, sidechain = false) =>
  JSON.stringify({
    isSidechain: sidechain,
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "Agent", input: { description, prompt: "…" } }] },
  });
const launched = (id: string, status = "async_launched") =>
  JSON.stringify({
    isSidechain: false,
    type: "user",
    message: { content: [{ tool_use_id: id, type: "tool_result", content: [{ type: "text", text: "Async agent launched successfully." }] }] },
    toolUseResult: { isAsync: true, status, agentId: "a00dbd5552a4ba13d" },
  });
const notification = (id: string) =>
  `<task-notification>\n<task-id>a00dbd5552a4ba13d</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n</task-notification>`;
const queued = (id: string) =>
  JSON.stringify({ type: "queue-operation", operation: "enqueue", content: notification(id) });
const userNotified = (id: string) =>
  JSON.stringify({ type: "user", origin: { kind: "task-notification" }, message: { role: "user", content: notification(id) } });
const costState = JSON.stringify({ type: "cost-state", sessionId: "s", totalCostUSD: 1 });

describe("runningSubagents", () => {
  it("counts a launched subagent until its notification, whatever row carries it", () => {
    const rows = [launch("toolu_A", "Inventaire"), launched("toolu_A"), launch("toolu_B", "Relecture"), launched("toolu_B", "forked")];
    expect(runningSubagents(rows.join("\n"))).toEqual(["Inventaire", "Relecture"]);
    expect(runningSubagents([...rows, queued("toolu_A")].join("\n"))).toEqual(["Relecture"]);
    expect(runningSubagents([...rows, queued("toolu_A"), userNotified("toolu_B")].join("\n"))).toEqual([]);
  });

  it("says nothing for a launch with no confirmed start, or one from a subagent's own sidechain", () => {
    expect(runningSubagents(launch("toolu_A", "x"))).toEqual([]);
    expect(runningSubagents([launch("toolu_A", "x", true), launched("toolu_A")].join("\n"))).toEqual([]);
  });

  it("drops everything launched before the session exited", () => {
    const rows = [launch("toolu_A", "dead"), launched("toolu_A"), costState, launch("toolu_B", "alive"), launched("toolu_B")];
    expect(runningSubagents(rows.join("\n"))).toEqual(["alive"]);
  });
});
