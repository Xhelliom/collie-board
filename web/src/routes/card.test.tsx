import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  DangerZone,
  noteLabel,
  PromptBox,
  resolveWatchStep,
  ReviewPass,
  SubtaskActionsSheet,
  SubtaskProgress,
  topOfColumn,
} from "./card.tsx";
import type { CardStatus, CardView } from "@/lib/board";

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

  function renderSheet(index: number) {
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
