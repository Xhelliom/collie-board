import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isBoardPath } from "./board-routes.ts";

// The collie-board skill (skills/collie-board/SKILL.md) is what an agent reads to use this API. It
// drifted once — a route shipped, the skill did not hear of it — so this pins the two directions:
//   1. every route the skill documents still exists;
//   2. every route the bridge declares is either documented, or listed below as the operator's own
//      (a screen, a setting, plumbing) with the reason it is not the agent's.
// Adding a route fails (2) until you decide which it is. Routes matched by a regex rather than written
// out as a string (a card's `/start`, `/finish-now`…) are outside what this can see.

const ROOT = join(import.meta.dir, "..");
const SKILL = readFileSync(join(ROOT, "skills/collie-board/SKILL.md"), "utf8");

const sources = readdirSync(import.meta.dir)
  .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
  .map((f) => readFileSync(join(import.meta.dir, f), "utf8"));
const allSource = sources.join("\n");

/** Routes written out as a string in the bridge: `"/api/phases/seal"`. */
const declared = new Set<string>();
for (const src of sources) for (const m of src.matchAll(/["`](\/api\/[a-z0-9/_-]+)["`]/g)) declared.add(m[1]!.replace(/\/$/, ""));

/** What the skill documents, with `<id>` placeholders turned into `:p`. */
const documented = new Set<string>();
for (const m of SKILL.matchAll(/\/api\/[A-Za-z0-9/_<>.-]+/g)) documented.add(m[0].replace(/<[^>]*>/g, ":p").replace(/\/$/, ""));

/** Not for an agent: the operator's screens and settings, and the app's own plumbing. */
const OPERATOR_ONLY: Record<string, string> = {
  "/api/backup": "the operator's backup screen",
  "/api/backup/restore": "the operator's restore, which restarts the bridge",
  "/api/board/prefs": "the board's switches (settings screen)",
  "/api/board/prs": "the Open PRs screen (asks GitHub on a tap)",
  "/api/board/usage": "the quota gauge",
  "/api/config": "the app's own config for the client",
  "/api/gallery": "the image gallery screen",
  "/api/gallery/file": "the image gallery screen",
  "/api/notifications/log": "the bell",
  "/api/notifications/log/read-all": "the bell",
  "/api/notifications/prefs": "notification settings",
  "/api/notifications/snooze": "notification settings",
  "/api/pane": "terminal driving — the pane routes are not the skill's",
  "/api/repos/gate/suggest": "the operator's gate screen asks the copilot (spends quota on a tap)",
  "/api/repos/hide": "the repo picker's own preference",
  "/api/snapshot": "the herd snapshot the app polls",
  "/api/subscribe": "web push subscription",
  "/api/tab": "herdr tab creation from the app",
  "/api/update/check": "the app's update banner",
  "/api/workspace": "herdr workspace creation from the app",
};

describe("the collie-board skill and the bridge's routes", () => {
  it("documents nothing the bridge no longer serves", () => {
    const missing: string[] = [];
    for (const d of documented) {
      const [, api, root, ...rest] = d.split("/");
      const base = `/${api}/${root}`;
      const served = isBoardPath(d) || [...declared].some((l) => l === d || d.startsWith(`${l}/`) || l === base);
      // A path's words (`launch`, `seal`, `close`…) must still appear in the bridge, or the route was renamed.
      const words = rest.filter((w) => w && !w.startsWith(":"));
      const present = words.every((w) => new RegExp(`\\b${w}\\b`).test(allSource));
      if (!served || !present) missing.push(d);
    }
    expect(missing).toEqual([]);
  });

  it("knows every route the bridge declares: documented, or listed as the operator's", () => {
    const unknown = [...declared]
      .filter((l) => ![...documented].some((d) => d === l || d.startsWith(`${l}/`)))
      .filter((l) => !(l in OPERATOR_ONLY))
      .sort();
    expect(unknown).toEqual([]);
  });

  it("does not keep a stale allowlist entry for a route that is now documented or gone", () => {
    const stale = Object.keys(OPERATOR_ONLY).filter((l) => !declared.has(l) || [...documented].some((d) => d === l || d.startsWith(`${l}/`)));
    expect(stale).toEqual([]);
  });
});
