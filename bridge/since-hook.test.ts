// The orchestrator's UserPromptSubmit hook (skills/collie-board/since-hook.ts). fetch is injected, so
// nothing here talks to a bridge; the cursor file is real, in a temp dir.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sinceHook } from "../skills/collie-board/since-hook.ts";

const state = mkdtempSync(join(tmpdir(), "collie-since-"));
afterAll(() => rmSync(state, { recursive: true, force: true }));

const env = { HERDR_PANE_ID: "w1:p2", XDG_STATE_HOME: state, COLLIE_BOARD_PORT: "9999" };
const cursorFile = join(state, "collie-board", "since-w1_p2");

function fakeFetch(status: number, body: string, seen: { url?: string; headers?: HeadersInit }[] = []) {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, headers: init?.headers });
    return new Response(status === 204 ? null : body, { status });
  }) as unknown as typeof fetch;
}

describe("sinceHook", () => {
  it("is silent outside a herdr pane", async () => {
    expect(await sinceHook({}, fakeFetch(200, '{"summary":"x"}'))).toBe("");
  });

  it("prints the summary, stores the cursor, and sends it back next time", async () => {
    const seen: { url?: string; headers?: HeadersInit }[] = [];
    const out = await sinceHook(env, fakeFetch(200, '{"cursor":42,"count":1,"summary":"Depuis…"}', seen));
    expect(out).toBe("Depuis…");
    expect(seen[0]?.url).toBe("http://127.0.0.1:9999/api/orchestrator/since?since=");
    expect(seen[0]?.headers).toEqual({ "x-collie-pane": "w1:p2" });
    expect(readFileSync(cursorFile, "utf8")).toBe("42\n");

    await sinceHook(env, fakeFetch(200, '{"cursor":43,"count":0}', seen));
    expect(seen[1]?.url).toEndWith("?since=42");
    expect(readFileSync(cursorFile, "utf8")).toBe("43\n");
  });

  it("is silent on 204, a non-JSON body, or a dead bridge", async () => {
    expect(await sinceHook(env, fakeFetch(204, ""))).toBe("");
    expect(await sinceHook(env, fakeFetch(200, "<html>"))).toBe("");
    const dead = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await sinceHook(env, dead)).toBe("");
  });
});
