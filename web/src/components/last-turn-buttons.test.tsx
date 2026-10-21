import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";

import { server } from "@/test/setup";
import { fixtureAgents } from "@/test/handlers";
import type { TranscriptEntry } from "@/lib/types";
import { AgentChat } from "./agent-chat";
import { lastTurnButtons } from "./last-turn-buttons";

// ADR 0044: on a pane screen the buttons are live only for the project's orchestrator — in both
// modes — and stay code for any other agent.

beforeAll(() => {
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});

const BLOCK = "Je fusionne ?\n\n```collie-buttons\n" + JSON.stringify([{ label: "Oui", action: "say", args: { text: "oui" } }]) + "\n```";
const entry = (uuid: string, role: TranscriptEntry["role"], text: string): TranscriptEntry => ({
  uuid, ts: "2026-10-21T10:00:00Z", role, parts: [{ kind: "text", text }],
});
const tool: TranscriptEntry = { uuid: "t", ts: "2026-10-21T10:00:00Z", role: "assistant", parts: [{ kind: "tool", name: "Bash", summary: "ls" }] };

describe("lastTurnButtons", () => {
  it("takes the newest assistant message's block, past its trailing tool steps", () => {
    expect(lastTurnButtons([entry("u", "user", "go"), entry("a", "assistant", BLOCK), tool])?.key).toBe("a");
  });
  it("is gone once a user turn answers it", () => {
    expect(lastTurnButtons([entry("a", "assistant", BLOCK), entry("u", "user", "oui")])).toBeNull();
  });
  it("only looks at the last message, not an older one", () => {
    expect(lastTurnButtons([entry("a", "assistant", BLOCK), entry("b", "assistant", "Fait.")])).toBeNull();
  });
});

const orch = { ...fixtureAgents[0]!, workspaceLabel: "orchestrator-webapp" }; // cwd /home/you/webapp
const other = fixtureAgents[0]!;

function renderPane(agent: typeof orch, reading: boolean) {
  localStorage.setItem("collie:display-prefs:v3", JSON.stringify({ readingPick: reading }));
  server.use(
    http.get(/\/api\/pane\/[^/]+\/history/, () =>
      HttpResponse.json({ paneId: agent.paneId, available: true, entries: [entry("a", "assistant", BLOCK)], hasMore: false, total: 1, fileTruncated: false, queued: [] }),
    ),
  );
  const props = { paneId: agent.paneId, agent, agents: [agent], shellPanes: [], tabs: [], text: BLOCK, onBack: vi.fn(), onSelect: vi.fn() };
  render(<RouterProvider router={createMemoryRouter([{ path: "/", element: <AgentChat {...props} /> }])} />);
}

describe.each([["reading", true], ["terminal", false]])("pane screen, %s mode", (_, reading) => {
  it("the orchestrator's buttons are live", async () => {
    renderPane(orch, reading);
    await waitFor(() => expect(screen.getByRole("button", { name: "Oui" })).toBeEnabled());
  });
  it("another agent's block stays code", async () => {
    renderPane(other, reading);
    if (reading) await screen.findByText(/"action":"say"/);
    else await waitFor(() => expect(screen.getAllByText(/collie-buttons/).length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Oui" })).toBeNull();
  });
});
