import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { McpSetupCard } from "./mcp-setup";

const COMMAND = "claude mcp add collie-board -- bun run /home/me/collie-board/bridge/mcp.ts";
const tools = [
  { name: "list_projects", readOnly: true },
  { name: "get_card", readOnly: true },
  { name: "launch_lot", readOnly: false },
];

function serve(deviceCommand: string | null) {
  server.use(http.get("/api/board/mcp", () => HttpResponse.json({ command: COMMAND, deviceCommand, tools })));
}

describe("McpSetupCard", () => {
  const secure = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  afterEach(() => {
    if (secure) Object.defineProperty(window, "isSecureContext", secure);
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
  });

  it("shows the real command, copied in one tap, and the tools split read / action", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    serve(null);
    render(<McpSetupCard />);

    await userEvent.click(await screen.findByRole("button", { name: `Copy command: ${COMMAND}` }));
    expect(writeText).toHaveBeenCalledWith(COMMAND);
    expect(screen.getByText("list_projects, get_card")).toBeInTheDocument();
    expect(screen.getByText("launch_lot")).toBeInTheDocument();
    expect(screen.getByText(/run on the bridge's machine/)).toBeInTheDocument();
    expect(screen.queryByText(/device header/)).not.toBeInTheDocument();
  });

  it("adds the device-header variant only when the deployment has one", async () => {
    serve(`${COMMAND} -e COLLIE_BOARD_DEVICE_HEADER=x-device`);
    render(<McpSetupCard />);
    expect(await screen.findByText(/device header/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Copy command:/ })).toHaveLength(2);
  });
});
