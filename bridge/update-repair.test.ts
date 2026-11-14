import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleUpdateRepairRoute, repairBrief, UPDATE_REPAIR_ROUTE } from "./update-repair.ts";

process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "repair-claude-"));
const failure = { command: "herdr plugin action invoke update-bash --plugin herdr.collie-board", output: "line 1\nerror: check-version.sh a échoué (code 141)" };

function setup() {
  const calls: string[] = [];
  const ctx = {
    herdr: {
      createWorkspace: async (o: { cwd: string; label?: string }) => (calls.push(`workspace ${o.label} ${o.cwd}`), { paneId: "p9", workspaceId: "w", tabId: "t", cwd: o.cwd }),
      startAgent: async (o: { kind: string }) => void calls.push(`start ${o.kind}`),
      getAgent: async () => ({ interactive_ready: true, agent_status: "working" }),
      promptAgent: async (o: { text: string }) => (calls.push(`prompt ${o.text}`), true),
    },
    cfg: { boardAgentKind: "claude" },
    audit: { record: () => {} },
    session: "default",
    guard: () => null,
    device: null,
    json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
    text: (body: string, status: number) => new Response(body, { status }),
  } as never;
  const post = (headers: Record<string, string> = {}, f: typeof failure | null = failure) =>
    handleUpdateRepairRoute(UPDATE_REPAIR_ROUTE, new Request(`http://x${UPDATE_REPAIR_ROUTE}`, { method: "POST", headers }), ctx, { failure: () => f, checkout: "/srv/collie" });
  return { calls, post };
}

describe("POST /api/update/repair", () => {
  it("launches an agent in the plugin checkout, briefed with the whole output and the command", async () => {
    const { calls, post } = setup();
    const res = (await post())!;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pane: { paneId: "p9" } });
    expect(calls.slice(0, 2)).toEqual(["workspace update-repair /srv/collie", "start claude"]);
    expect(calls[2]).toContain("check-version.sh a échoué (code 141)");
    expect(calls[2]).toContain(failure.command);
    expect(calls[2]).toContain("bun scripts/ctl.ts update");
    expect(calls[2]).toContain("Ne pousse rien");
  });

  it("is refused to an agent pane, and has nothing to do without a failure", async () => {
    const { calls, post } = setup();
    expect((await post({ "x-collie-pane": "p1" }))!.status).toBe(403);
    expect((await post({}, null))!.status).toBe(409);
    expect(calls).toEqual([]);
  });

  it("the brief keeps every line of the output", () => {
    const output = Array.from({ length: 500 }, (_, i) => `l${i}`).join("\n");
    expect(repairBrief({ command: "c", output }, "/srv")).toContain("l0\nl1\n");
  });
});
