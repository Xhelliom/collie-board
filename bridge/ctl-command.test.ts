import { describe, expect, it } from "bun:test";

import { ctlCommand } from "./ctl-command.ts";

describe("ctlCommand", () => {
  it("is the Herdr plugin action under herdr 0.9, or with no engine known", () => {
    expect(ctlCommand("restart", { engine: "herdr09", hc: null })).toBe("herdr plugin action invoke restart --plugin herdr.collie-board");
    expect(ctlCommand("update", null)).toBe("herdr plugin action invoke update --plugin herdr.collie-board");
  });

  it("is the checkout's ctl script, by absolute path, under herdr-core (no plugin actions there)", () => {
    expect(ctlCommand("restart", { engine: "hc", hc: null }, "/opt/collie/scripts/collie-board-ctl.sh")).toBe(
      "bash '/opt/collie/scripts/collie-board-ctl.sh' restart",
    );
    expect(ctlCommand("update", { engine: "hc", hc: null })).toMatch(/^bash '\/.+\/scripts\/collie-board-ctl\.sh' update$/);
  });
});
