import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { setPreference } from "@/i18n";
import type { CardView } from "@/lib/board";
import { EnvironmentPicker } from "./card-environment";
import { CardEditor } from "./card-editor";
import { CardTile } from "./card-tile";

// « Lancer sur » (ADR 0046 §4): this machine by default, the peers' matching environments after,
// an unreachable peer greyed with its reason — and no picker at all without a peer.
const card = (over: Partial<CardView> = {}): CardView =>
  ({
    id: "c1",
    title: "ship it",
    spec: null,
    rawInput: null,
    acceptance: [],
    status: "backlog",
    repoPath: "/r/collie",
    baseRef: null,
    branch: null,
    workspaceId: null,
    agentKind: null,
    parentId: null,
    duplicateOf: null,
    dependsOn: null,
    origin: null,
    originCardId: null,
    category: null,
    tag: null,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    session: null,
    runtime: null,
    sessionCount: 0,
    copilotBusy: false,
    wrapupPending: false,
    keepWorktree: false,
    autoHandoff: null,
    ...over,
  }) as CardView;

const envs = (environments: { peer: string; name: string; agent: string }[], unreachable: { peer: string; error: string }[] = []) =>
  server.use(http.get("/api/repos/environments", () => HttpResponse.json({ remote: "github.com/x/collie", environments, unreachable })));

afterEach(() => setPreference("en"));

describe("Lancer sur", () => {
  it("renders nothing for a user with no peer", async () => {
    envs([]);
    const { container } = render(<EnvironmentPicker repoPath="/r/collie" value={null} onChange={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("offers this machine first, then « env · peer », an unreachable peer disabled with its reason", async () => {
    setPreference("fr");
    envs([{ peer: "test-depot-collie", name: "dev", agent: "claude" }], [{ peer: "nas", error: "timeout" }]);
    const onChange = vi.fn();
    render(<EnvironmentPicker repoPath="/r/collie" value={null} onChange={onChange} />);
    const select = await screen.findByLabelText("Lancer sur");
    const options = [...select.querySelectorAll("option")].map((o) => [o.textContent, o.disabled]);
    expect(options).toEqual([
      ["Cette machine", false],
      ["dev · test-depot-collie", false],
      ["nas — injoignable : timeout", true],
    ]);
    await userEvent.selectOptions(select, "test-depot-collie/dev");
    expect(onChange).toHaveBeenCalledWith({ peer: "test-depot-collie", name: "dev" });
  });

  it("the editor saves the choice on the card, and leaves it out when untouched", async () => {
    envs([{ peer: "test-depot-collie", name: "dev", agent: "claude" }]);
    server.use(http.get("/api/cards", () => HttpResponse.json({ cards: [] })));
    const onSave = vi.fn(async () => {});
    render(<CardEditor card={card()} open onClose={() => {}} onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]).not.toHaveProperty("0.environment");
    await userEvent.selectOptions(await screen.findByLabelText("Launch on"), "test-depot-collie/dev");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1]).toHaveProperty("0.environment", { peer: "test-depot-collie", name: "dev" });
  });

  it("the tile says which machine", () => {
    render(<CardTile card={card({ environment: { peer: "test-depot-collie", name: "dev" } })} onClick={() => {}} />);
    expect(screen.getByText("on test-depot-collie")).toBeInTheDocument();
  });
});
