import { describe, expect, it } from "bun:test";

import { mcpSetup } from "./mcp-setup.ts";

describe("mcpSetup", () => {
  it("builds the command from the install's real path, every tool listed", async () => {
    const s = await mcpSetup("/opt/collie board/bridge", 8788, "");
    expect(s.command).toBe("claude mcp add collie-board -- bun run '/opt/collie board/bridge/mcp.ts'");
    expect(s.deviceCommand).toBeNull();
    expect(s.tools.find((t) => t.name === "list_projects")?.readOnly).toBe(true);
    expect(s.tools.find((t) => t.name === "launch_lot")?.readOnly).toBe(false);
    expect(s.tools.some((t) => t.name === "notify")).toBe(true);
  });

  it("adds the device variant and a non-default port only when the deployment has them", async () => {
    const s = await mcpSetup("/srv/bridge", 9000, "x-device");
    expect(s.command).toBe("claude mcp add collie-board -e COLLIE_BOARD_PORT=9000 -- bun run /srv/bridge/mcp.ts");
    expect(s.deviceCommand).toContain("-e COLLIE_BOARD_DEVICE_HEADER=x-device -e COLLIE_BOARD_DEVICE=");
  });
});
