import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import type { TranscriptEntry } from "@/lib/types";
import { ButtonsPaneContext } from "./action-buttons";
import { MarkdownText } from "./markdown-text";
import { TranscriptView } from "./transcript-view";

// ADR 0042: the orchestrator's ```collie-buttons block. Look free, action from the shared catalog.
const ORCH = "w1:p9";
const block = (buttons: unknown) => "Je fusionne ?\n\n```collie-buttons\n" + JSON.stringify(buttons) + "\n```";
const inOrchestrator = (text: string) =>
  render(
    <ButtonsPaneContext.Provider value={ORCH}>
      <MarkdownText text={text} />
    </ButtonsPaneContext.Provider>,
  );

function record() {
  const calls: { method: string; url: string; body: unknown }[] = [];
  server.events.on("request:start", async ({ request }) => {
    const u = new URL(request.url);
    calls.push({ method: request.method, url: u.pathname, body: request.method === "GET" ? undefined : await request.clone().json().catch(() => null) });
  });
  return calls;
}
afterEach(() => server.events.removeAllListeners());

describe("collie-buttons", () => {
  it("finish_card merge: says what it does from args, confirms, then merges", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/cards/c1", () => HttpResponse.json({ card: { id: "c1", title: "Mon titre", status: "review", baseRef: "main" }, events: [] })),
      http.post("/api/cards/c1/integration", () => HttpResponse.json({ ok: true, base: "main" })),
    );
    const calls = record();
    inOrchestrator(block([
      { label: "Oui, fusionne", tone: "primary", action: "finish_card", args: { cardId: "c1", mode: "merge" } },
      { label: "Non", tone: "neutral", action: "say", args: { text: "non" } },
    ]));
    expect(await screen.findByText("Fusionner « Mon titre » dans main")).toBeInTheDocument();
    expect(screen.queryByText(/c1/)).toBeNull(); // never an id on screen
    await user.click(screen.getByRole("button", { name: "Oui, fusionne" }));
    expect(calls.some((c) => c.method === "POST")).toBe(false); // destructive: asks first
    await user.click(screen.getByRole("button", { name: "Confirmer : Oui, fusionne" }));
    expect(await screen.findByRole("status")).toHaveTextContent("« Mon titre » fusionnée dans main et classée terminée.");
    expect(calls.find((c) => c.method === "POST")).toEqual({ method: "POST", url: "/api/cards/c1/integration", body: { action: "merge", andDone: true } });
    expect(screen.getByRole("button", { name: "Non" })).toBeDisabled(); // the block is spent
  });

  it("say types into the orchestrator's pane", async () => {
    const user = userEvent.setup();
    server.use(http.post("/api/pane/:id/reply", () => HttpResponse.json({ ok: true })));
    const calls = record();
    inOrchestrator(block([{ label: "Non", action: "say", args: { text: "non" } }]));
    expect(await screen.findByText("Répondre « non » à l'orchestrateur")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Non" }));
    await screen.findByText("Envoyé à l'orchestrateur.");
    expect(calls).toEqual([{ method: "POST", url: `/api/pane/${encodeURIComponent(ORCH)}/reply`, body: { text: "non", submit: true } }]);
  });

  it("an unknown action, bad args or an agent's pane: greyed with the reason, nothing sent", async () => {
    const calls = record();
    inOrchestrator(block([
      { label: "Rm", action: "rm_rf", args: {} },
      { label: "Sans carte", action: "finish_card", args: { mode: "merge" } },
      { label: "Mauvais mode", action: "finish_card", args: { cardId: "c1", mode: "yolo" } },
      { label: "Autre agent", action: "reply_to_agent", args: { paneId: "w:p2", text: "oui" } },
    ]));
    expect(await screen.findByText("Action inconnue : rm_rf.")).toBeInTheDocument();
    expect(screen.getByText("Arguments invalides : il manque « cardId ».")).toBeInTheDocument();
    expect(screen.getByText(/« mode » vaut pr, merge, done/)).toBeInTheDocument();
    expect(screen.getByText("Action inconnue : reply_to_agent.")).toBeInTheDocument();
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
    expect(calls).toEqual([]);
  });

  it("stays code outside the orchestrator's panel, and in a non-assistant turn inside it", () => {
    const text = block([{ label: "Oui", action: "say", args: { text: "oui" } }]);
    const { unmount } = render(<MarkdownText text={text} />);
    expect(screen.queryByRole("button", { name: "Oui" })).toBeNull();
    expect(screen.getByText(/"action":"say"/)).toBeInTheDocument();
    unmount();
    const entry = (role: TranscriptEntry["role"]): TranscriptEntry => ({ uuid: role, ts: "2026-10-16T10:00:00Z", role, parts: [{ kind: "text", text }] });
    render(
      <ButtonsPaneContext.Provider value={ORCH}>
        <TranscriptView entries={[entry("user")]} />
      </ButtonsPaneContext.Provider>,
    );
    expect(screen.queryByRole("button", { name: "Oui" })).toBeNull();
  });

  it("an assistant turn in the orchestrator's panel gets the buttons", async () => {
    const text = block([{ label: "Oui", tone: "success", action: "say", args: { text: "oui" } }]);
    render(
      <ButtonsPaneContext.Provider value={ORCH}>
        <TranscriptView entries={[{ uuid: "a", ts: "2026-10-16T10:00:00Z", role: "assistant", parts: [{ kind: "text", text }] }]} />
      </ButtonsPaneContext.Provider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Oui" })).toBeEnabled());
  });
});
