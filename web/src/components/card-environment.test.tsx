import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { setPreference } from "@/i18n";
import type { CardView } from "@/lib/board";
import { CardEnvironment, EnvironmentPicker } from "./card-environment";
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

  it("the editor locks the choice while the card runs here or on a peer — the bridge refuses it", async () => {
    envs([{ peer: "test-depot-collie", name: "dev", agent: "claude" }]);
    server.use(
      http.get("/api/cards", () => HttpResponse.json({ cards: [] })),
      http.get("/api/cards/c1/remote", () =>
        HttpResponse.json({ environment: { peer: "test-depot-collie", name: "dev" }, session: { peer: "test-depot-collie", environment: "dev", paneId: "w1:p1", branch: "b" }, state: null }),
      ),
    );
    const { unmount } = render(<CardEditor card={card({ session: {} as CardView["session"] })} open onClose={() => {}} onSave={async () => {}} />);
    expect(await screen.findByLabelText("Launch on")).toBeDisabled();
    expect(screen.getByText(/A session is running/)).toBeInTheDocument();
    unmount();
    render(<CardEditor card={card({ environment: { peer: "test-depot-collie", name: "dev" } })} open onClose={() => {}} onSave={async () => {}} />);
    await waitFor(async () => expect(await screen.findByLabelText("Launch on")).toBeDisabled());
  });

  it("the tile says which machine", () => {
    render(<CardTile card={card({ environment: { peer: "test-depot-collie", name: "dev" } })} onClick={() => {}} />);
    expect(screen.getByText("on test-depot-collie")).toBeInTheDocument();
  });
});

describe("CardEnvironment", () => {
  const onCard = { peer: "test-depot-collie", name: "dev" };
  const running = { environment: onCard, session: { peer: "test-depot-collie", environment: "dev", paneId: "w1:p1", branch: "board/x" } };
  const start = <button>Start</button>;

  it("no peer serves the repo: no picker, Start alone", async () => {
    envs([]);
    render(<CardEnvironment card={card()} onChanged={() => {}} onError={() => {}}>{start}</CardEnvironment>);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByLabelText("Launch on")).toBeNull();
  });

  it("running on a peer: says where, hides Start, and ends the session there", async () => {
    setPreference("fr");
    let ended = 0;
    server.use(
      http.get("/api/cards/c1/remote", () =>
        HttpResponse.json(ended ? { environment: onCard, session: null, state: null } : { ...running, state: { reachable: true, pane: { status: "working", agent: "claude" } } }),
      ),
      http.delete("/api/cards/c1/remote", () => {
        ended++;
        return HttpResponse.json({ ok: true });
      }),
    );
    envs([{ ...onCard, agent: "claude" }]);
    const onChanged = vi.fn();
    render(<CardEnvironment card={card({ environment: onCard, status: "working" })} onChanged={onChanged} onError={() => {}}>{start}</CardEnvironment>);
    // Not even a flash of Start while the remote is being read.
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(await screen.findByText("En cours sur test-depot-collie (dev), branche board/x")).toBeInTheDocument();
    expect(screen.getByText("Son agent, à l'ouverture de la carte : working")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByLabelText("Lancer sur")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Terminer la session sur test-depot-collie" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(ended).toBe(1);
    expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByTestId("card-remote")).toBeNull();
  });

  it("an unreachable peer still holds the card: Start stays hidden", async () => {
    server.use(http.get("/api/cards/c1/remote", () => HttpResponse.json({ ...running, state: { reachable: false, error: "timeout", pane: null } })));
    render(<CardEnvironment card={card({ environment: onCard })} onChanged={() => {}} onError={() => {}}>{start}</CardEnvironment>);
    expect(await screen.findByText("Peer not reached: timeout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End the session on test-depot-collie" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });
});
