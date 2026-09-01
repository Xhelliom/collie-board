import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import {
  CopyPromptButton,
  DangerZone,
  IntegrationSection,
  noteLabel,
  PromptBox,
  resolveWatchStep,
  ReviewPass,
  SubtaskActionsSheet,
  SubtaskProgress,
  TinyTodoRow,
  topOfColumn,
} from "./card.tsx";
import type { BoardEvent, CardStatus, CardView, Integration } from "@/lib/board";

function card(status: CardStatus): CardView {
  return {
    id: status + Math.random(),
    title: "x",
    spec: null,
    rawInput: null,
    acceptance: [],
    status,
    repoPath: null,
    baseRef: null,
    branch: null,
    workspaceId: null,
    agentKind: null,
    parentId: "container",
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
  };
}

// A session carries one of two documents in the same field, and they are not the same thing: a
// handoff note is written FOR the next agent, a closing report is what the outgoing agent says it
// did when the operator files the card. Labelling both "handoff note" made the second unreadable.
describe("noteLabel", () => {
  it("names the document by what ended the session", () => {
    expect(noteLabel(false, false)).toBe("Handoff note");
    expect(noteLabel(false, true)).toBe("Closing report");
  });

  it("turns into its own dismiss label when open", () => {
    expect(noteLabel(true, false)).toBe("Hide handoff note");
    expect(noteLabel(true, true)).toBe("Hide closing report");
  });
});

// After "resolve" is sent, the agent's turn ends off-screen — the section has to notice on its own
// rather than make the operator remember to come back and recheck.
describe("resolveWatchStep", () => {
  it("does nothing while not awaiting a resolve", () => {
    expect(resolveWatchStep(false, false, "working")).toEqual({ sawAgentTurn: false, refresh: false });
  });

  it("remembers the agent took a turn, but does not refresh mid-turn", () => {
    expect(resolveWatchStep(true, false, "working")).toEqual({ sawAgentTurn: true, refresh: false });
    expect(resolveWatchStep(true, false, "blocked")).toEqual({ sawAgentTurn: true, refresh: false });
  });

  it("refreshes only on the edge — a turn was seen, then it ended", () => {
    expect(resolveWatchStep(true, true, "idle")).toEqual({ sawAgentTurn: false, refresh: true });
    expect(resolveWatchStep(true, true, "done")).toEqual({ sawAgentTurn: false, refresh: true });
  });

  it("does not refresh on an idle status if the agent was never seen working", () => {
    // The status can already be idle the instant "resolve" is sent, before the agent has picked it up.
    expect(resolveWatchStep(true, false, "idle")).toEqual({ sawAgentTurn: false, refresh: false });
  });
});

// Deleting a card is the only thing in this app that cannot be undone, so one tap must never do it.
describe("DangerZone", () => {
  it("does not delete on the first tap — it arms and says it is final", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<DangerZone cardId="c1" onDelete={onDelete} />);

    await user.click(screen.getByRole("button", { name: /delete card/i }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /no undo/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /no undo/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

// One box, two callers: a follow-up for the running agent, and a correction for the copilot. Send
// is an explicit tap because that textarea IS the phone's voice input — dictated text gets reread
// before it goes anywhere.
describe("PromptBox", () => {
  it("sends the trimmed text under the caller's own label, then clears itself", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(
      <PromptBox
        onSend={onSend}
        placeholder="what came out wrong…"
        sendLabel="Send to the copilot"
      />,
    );
    const box = screen.getByPlaceholderText("what came out wrong…");

    await user.type(box, "  say the format will be json  ");
    await user.click(screen.getByRole("button", { name: "Send to the copilot" }));

    expect(onSend).toHaveBeenCalledWith("say the format will be json");
    expect(box).toHaveValue("");
  });

  it("stays disabled on whitespace — an empty instruction is not a correction", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<PromptBox onSend={onSend} />);

    await user.type(screen.getByRole("textbox"), "   ");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});

// The container's progress bar (redesign §4a) — the count line and the "attend une réponse" flag
// are the two things a container's own screen answers at a glance, so both get pinned here.
describe("SubtaskProgress", () => {
  it("renders nothing for a childless container", () => {
    const { container } = render(<SubtaskProgress cards={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("counts done against the total, and stays silent when nothing is blocked", () => {
    render(<SubtaskProgress cards={[card("done"), card("done"), card("ready")]} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/\/ 3 terminées/)).toBeInTheDocument();
    expect(screen.queryByText(/attend/)).toBeNull();
  });

  it("flags a blocked sub-task, singular", () => {
    render(<SubtaskProgress cards={[card("blocked"), card("ready")]} />);
    expect(screen.getByText("1 attend une réponse")).toBeInTheDocument();
  });

  it("pluralises when more than one sub-task is blocked", () => {
    render(<SubtaskProgress cards={[card("blocked"), card("blocked"), card("ready")]} />);
    expect(screen.getByText("2 attendent une réponse")).toBeInTheDocument();
  });
});

// The phone's only way to write `position` — the board's drag is desktop-only. What it must not do
// is rank against the wrong list: another column's cards, or sub-tasks that live in a container.
describe("topOfColumn", () => {
  const at = (status: CardStatus, position: number, parentId: string | null = null): CardView => ({
    ...card(status),
    position,
    parentId,
  });

  it("lands below the lowest position in the same column", () => {
    const moved = at("ready", 30);
    expect(topOfColumn([at("ready", 10), at("ready", 20), moved], moved)).toBe(9);
  });

  it("ignores the other columns and the sub-tasks", () => {
    const moved = at("ready", 30);
    const cards = [at("backlog", -50), at("ready", 10, "container"), at("ready", 20), moved];
    expect(topOfColumn(cards, moved)).toBe(19);
  });

  it("leaves a lone card where a new card would land", () => {
    const moved = at("ready", 7);
    expect(topOfColumn([moved], moved)).toBe(0);
  });
});

// The phone's only way to reorder sub-tasks: the grip's HTML5 drag never starts from a touch, so it
// is hidden below `lg` and these two rows replace it. What matters is that they write the SAME slot
// the drop writes — `onReorder(id, index)` is neighbour-space (the list minus the moved row), so a
// one-row move is index ± 1, exactly what dropping a row on its neighbour passes.
describe("SubtaskActionsSheet — reordering from the ⋯ menu", () => {
  const rows = [card("ready"), card("ready"), card("ready")];

  function renderSheet(index: number, onConvert = vi.fn()) {
    const onReorder = vi.fn();
    render(
      <SubtaskActionsSheet
        child={rows[index]}
        index={index}
        count={rows.length}
        parentTitle="Container"
        onClose={vi.fn()}
        onReorder={onReorder}
        onOpenPane={vi.fn()}
        onDependsOn={vi.fn()}
        onDetach={vi.fn()}
        onDelete={vi.fn()}
        onConvert={onConvert}
        candidates={[]}
      />,
    );
    return onReorder;
  }

  it("moves a row up into the slot above it", async () => {
    const user = userEvent.setup();
    const onReorder = renderSheet(1);
    await user.click(screen.getByRole("button", { name: "Monter" }));
    expect(onReorder).toHaveBeenCalledWith(rows[1].id, 0);
  });

  it("moves a row down into the slot below it", async () => {
    const user = userEvent.setup();
    const onReorder = renderSheet(1);
    await user.click(screen.getByRole("button", { name: "Descendre" }));
    expect(onReorder).toHaveBeenCalledWith(rows[1].id, 2);
  });

  // The manual half of the copilot's arbitrage, asked from the container's own screen: the target
  // is the card you are looking at, and the row says the card itself goes.
  it("converts a sub-task into an action on the container", async () => {
    const user = userEvent.setup();
    const onConvert = vi.fn();
    renderSheet(1, onConvert);
    await user.click(screen.getByRole("button", { name: "Convertir en action" }));
    expect(onConvert).toHaveBeenCalledWith(rows[1].id);
    expect(screen.getByText(/La carte disparaît du board/)).toBeInTheDocument();
  });

  it("offers no move past either end of the list", () => {
    renderSheet(0);
    expect(screen.queryByRole("button", { name: "Monter" })).toBeNull();
    expect(screen.getByRole("button", { name: "Descendre" })).toBeInTheDocument();
    cleanup();

    renderSheet(rows.length - 1);
    expect(screen.getByRole("button", { name: "Monter" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Descendre" })).toBeNull();
  });
});

// The whole point of the pass buttons is that they hand the card's OWN agent a command it actually
// has — a `/simplify` typed into a Codex pane is a line of noise, and one sent to a card whose pane
// is gone is a 409 the UI could have foreseen.
describe("ReviewPass", () => {
  function withAgent(agent: string | null): CardView {
    const c = card("review");
    if (agent === null) return c;
    return {
      ...c,
      runtime: {
        paneId: "p1",
        agent,
        agentStatus: "idle",
        cwd: "/w",
        workspaceId: "w1",
        workspaceLabel: "w",
      },
    };
  }

  it("sends the command the tapped pass names", async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(<ReviewPass card={withAgent("claude")} onRun={onRun} />);
    await userEvent.click(screen.getByRole("button", { name: /find bugs/i }));
    expect(onRun).toHaveBeenCalledWith("/code-review");
    await userEvent.click(screen.getByRole("button", { name: /simplify/i }));
    expect(onRun).toHaveBeenCalledWith("/simplify");
    cleanup();
  });

  it("offers nothing to tap when the agent has no such commands", () => {
    render(<ReviewPass card={withAgent("codex")} onRun={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
  });

  it("says what to do instead when the card's agent is gone", () => {
    render(<ReviewPass card={withAgent(null)} onRun={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/relaunch it on the branch/i)).toBeTruthy();
    cleanup();
  });
});

// The screen used to read a single axis — `ahead`, the distance to the LOCAL base — and the PR path
// moves work somewhere that axis cannot see. `pushed` is the second axis; these are the three states
// it has to tell apart.
describe("IntegrationSection — merged, pushed, and neither", () => {
  function integration(over: Partial<Integration> = {}): Integration {
    return {
      branch: "board/x",
      base: "main",
      ahead: 2,
      behind: 0,
      baseDirty: false,
      branchDirty: false,
      baseCheckedOut: true,
      pushed: false,
      ...over,
    };
  }

  async function show(over: Partial<Integration> = {}) {
    server.use(
      http.get("*/api/cards/:id/integration", () =>
        HttpResponse.json({ integration: integration(over) }),
      ),
    );
    render(
      <IntegrationSection card={card("working")} events={[]} onDone={vi.fn()} onState={vi.fn()} />,
    );
    await screen.findByText("board/x");
  }

  const cleanupButton = () => screen.queryByRole("button", { name: /clean up worktree/i });
  const discardButton = () => screen.queryByRole("button", { name: /discard this work/i });

  it("offers cleanup on a pushed branch, and keeps discard next to it", async () => {
    await show({ ahead: 2, pushed: true });
    expect(cleanupButton()).toBeTruthy();
    expect(discardButton()).toBeTruthy();
    cleanup();
  });

  it("refuses cleanup when the commits are nowhere but here", async () => {
    await show({ ahead: 2, pushed: false });
    expect(cleanupButton()).toBeNull();
    expect(discardButton()).toBeTruthy();
    cleanup();
  });

  it("does not claim to throw away commits the remote already has", async () => {
    await show({ ahead: 2, pushed: true });
    await userEvent.click(discardButton()!);
    expect(screen.getByRole("button", { name: /drop the branch and archive/i })).toBeTruthy();
    cleanup();
  });

  it("still counts what a discard destroys when nothing was pushed", async () => {
    await show({ ahead: 2, pushed: false, branchDirty: true });
    await userEvent.click(discardButton()!);
    expect(
      screen.getByRole("button", { name: /throw away 2 commits and uncommitted work\?/i }),
    ).toBeTruthy();
    cleanup();
  });
});

// Filing a card auto-cleans its worktree, so seconds after "Open a PR & done" the branch is gone and
// `integration` answers null — which used to take the whole section's contents with it, PR button
// included. What is left of the card's PR then lives only in the journal, and that has to stay a TAP:
// the grey history line under a phone-length closing report is not "the PR is still reachable".
describe("IntegrationSection — the PR outlives the branch", () => {
  const prOpened = [
    {
      id: 1,
      cardId: "c1",
      type: "card.pr_opened",
      payload: { branch: "board/x", base: "main", url: "https://github.com/o/r/pull/42" },
      ts: 2,
    },
    { id: 2, cardId: "c1", type: "card.cleaned_up", payload: { branch: "board/x" }, ts: 3 },
  ] as unknown as BoardEvent[];

  it("still offers the PR on a filed card whose branch has been cleaned up", async () => {
    server.use(
      http.get("*/api/cards/:id/integration", () => HttpResponse.json({ integration: null })),
      http.get("*/api/cards/:id/pr", () =>
        HttpResponse.json({ pr: { state: "merged", url: "https://github.com/o/r/pull/42", mergedAt: 5 } }),
      ),
    );
    render(
      <IntegrationSection card={card("done")} events={prOpened} onDone={vi.fn()} onState={vi.fn()} />,
    );
    const link = await screen.findByRole("link", { name: /view pr #42/i });
    expect(link.getAttribute("href")).toBe("https://github.com/o/r/pull/42");
    cleanup();
  });

  // The other half of the same surface: a card filed with `keepWorktree` on still has a branch, so
  // `integration` answers and the section takes its MAIN return. That path renders the PR through the
  // very same `prLink` — this test is what stops a `filing &&` from creeping back in front of it.
  it("still offers the PR on a filed card whose branch is still there", async () => {
    server.use(
      http.get("*/api/cards/:id/integration", () =>
        HttpResponse.json({
          integration: {
            branch: "board/x",
            base: "main",
            ahead: 1,
            behind: 0,
            branchDirty: false,
            baseDirty: false,
            baseCheckedOut: true,
            pushed: true,
          } satisfies Integration,
        }),
      ),
      http.get("*/api/cards/:id/pr", () => HttpResponse.json({ pr: null })),
    );
    render(
      <IntegrationSection card={card("done")} events={prOpened} onDone={vi.fn()} onState={vi.fn()} />,
    );
    const link = await screen.findByRole("link", { name: /view pr #42/i });
    expect(link.getAttribute("href")).toBe("https://github.com/o/r/pull/42");
    cleanup();
  });

  it("says there is nothing to integrate when the journal has no PR either", async () => {
    server.use(http.get("*/api/cards/:id/integration", () => HttpResponse.json({ integration: null })));
    render(<IntegrationSection card={card("done")} events={[]} onDone={vi.fn()} onState={vi.fn()} />);
    expect(await screen.findByText(/no branch to integrate/i)).toBeTruthy();
    cleanup();
  });
});

// The suggestion a review makes and deliberately does NOT file. The criterion lives in
// bridge/copilot.ts; this is the row that offers it, and the two states where it stops offering.
describe("TinyTodoRow", () => {
  const todo = {
    spec: "Add one line to NOTIFY_AUDIT.md saying step 1 is done.",
    acceptance: ["the line is in NOTIFY_AUDIT.md"],
    doneAt: null as number | null,
  };
  const title = "Note in NOTIFY_AUDIT.md that step 1 landed";

  it("offers the tap while this card's agent is still there", async () => {
    const onFinish = vi.fn();
    render(<TinyTodoRow title={title} todo={todo} live pending={false} onFinish={onFinish} />);

    expect(screen.getByText(title)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /finish it now/i }));
    expect(onFinish).toHaveBeenCalledOnce();
    cleanup();
  });

  it("takes no second tap once it has been sent — the agent would do the edit twice", () => {
    render(
      <TinyTodoRow title={title} todo={{ ...todo, doneAt: 1 }} live pending={false} onFinish={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /finish it now/i })).toBeNull();
    expect(screen.getByText(/sent to the agent/i)).toBeTruthy();
    cleanup();
  });

  it("shows the spec in full when there is no agent left — nothing was filed, so this is the note", () => {
    render(<TinyTodoRow title={title} todo={todo} live={false} pending={false} onFinish={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /finish it now/i })).toBeNull();
    // The sentence survives the offer lapsing — otherwise not making a card would lose it.
    expect(screen.getByText(/Add one line to NOTIFY_AUDIT\.md/)).toBeTruthy();
    cleanup();
  });
});

// The whole point of the button: what lands in the clipboard is pasteable as-is, and carries THIS
// card's id — the hand-rebuilt command it replaces is exactly where the wrong id used to come from.
describe("CopyPromptButton", () => {
  const secureDescriptor = Object.getOwnPropertyDescriptor(window, "isSecureContext");
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  afterEach(() => {
    if (secureDescriptor) Object.defineProperty(window, "isSecureContext", secureDescriptor);
    if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    cleanup();
  });

  it("copies the skill command around the clicked card's id", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(
      <>
        <CopyPromptButton cardId="aaa-111" />
        <CopyPromptButton cardId="bbb-222" />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: /bbb-222/ }));

    expect(writeText).toHaveBeenCalledWith("/collie-board card bbb-222");
    expect(await screen.findByText("Copié")).toBeTruthy();
  });

  it("is disabled (not hidden) outside a secure context, where there is no clipboard", () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });

    render(<CopyPromptButton cardId="aaa-111" />);
    expect(screen.getByRole("button", { name: /aaa-111/ })).toBeDisabled();
  });
});
