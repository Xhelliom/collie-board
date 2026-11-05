import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleRollback, previousRelease, type RollbackDeps } from "./rollback.ts";

const URL_ = "http://127.0.0.1/api/update/rollback";
const tags = ["v0.256.0", "v0.255.0", "v0.254.3", "v0.257.0", "v1.0.0-rc", "latest"];

function deps(over: Partial<RollbackDeps> = {}): RollbackDeps & { invoked: number } {
  const d = {
    invoked: 0,
    fetchTags: async () => tags,
    configDir: mkdtempSync(join(tmpdir(), "rollback-")),
    invoke: async () => {
      d.invoked++;
      return null;
    },
    ...over,
  };
  return d;
}

describe("previousRelease", () => {
  it("is the newest release strictly older than the running one", () => {
    expect(previousRelease(tags, "0.256.0")).toBe("0.255.0");
    expect(previousRelease(tags, "0.254.3")).toBeNull();
  });
});

describe("handleRollback", () => {
  it("GET names the previous release", async () => {
    const res = await handleRollback(new Request(URL_), "0.256.0", deps());
    expect(await res.json()).toEqual({ previous: "0.255.0" });
  });

  it("POST leaves the tag for the ctl and invokes the update action", async () => {
    const d = deps();
    const res = await handleRollback(new Request(URL_, { method: "POST" }), "0.256.0", d);
    expect(res.status).toBe(202);
    expect(d.invoked).toBe(1);
    expect(readFileSync(join(d.configDir, "update-target"), "utf8")).toBe("v0.255.0\n");
  });

  it("refuses an agent pane", async () => {
    const d = deps();
    const req = new Request(URL_, { method: "POST", headers: { "x-collie-pane": "w1:p1" } });
    expect((await handleRollback(req, "0.256.0", d)).status).toBe(403);
    expect(d.invoked).toBe(0);
  });

  it("has nothing to go back to below the oldest release", async () => {
    const d = deps();
    expect((await handleRollback(new Request(URL_, { method: "POST" }), "0.254.3", d)).status).toBe(409);
    expect(d.invoked).toBe(0);
  });

  it("removes the target when herdr refuses, so the next update is a plain one", async () => {
    const d = deps({ invoke: async () => "no server" });
    expect((await handleRollback(new Request(URL_, { method: "POST" }), "0.256.0", d)).status).toBe(502);
    expect(existsSync(join(d.configDir, "update-target"))).toBe(false);
  });
});
