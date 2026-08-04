import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DangerZone, noteLabel, resolveWatchStep, SubtaskProgress } from "./card.tsx";
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
