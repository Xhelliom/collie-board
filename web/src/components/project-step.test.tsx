import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { CardView } from "@/lib/board";
import type { CardFacts } from "@/lib/project-facts";
import { StepItem } from "./project-step";

const card = { id: "c", title: "Show the score", spec: "## Show the score\nLetters on the recipe page.", acceptance: ["A shows", "B hides"], status: "done", agentKind: "claude", phaseId: null, dependsOn: null, runId: "r" } as unknown as CardView;
const facts: CardFacts = {
  cardId: "c",
  gate: { ok: true, command: "tools/ovg gate", ts: 1 },
  lead: { decision: "finished", reason: "all criteria hold", ts: 2 },
  triage: { accept: true, verdict: "partial", reason: "false alarm" },
  review: "partial",
  pr: { url: "https://github.com/me/app/pull/35", state: "open", autoMerge: "refused" },
  sentBack: 1,
  operatorSaid: 0,
  startedAt: 0,
  endedAt: 14 * 60_000,
};

const mount = (f?: CardFacts) =>
  render(
    <MemoryRouter>
      <StepItem card={card} index={0} next={false} open flash={false} predecessor={undefined} facts={f} onToggle={() => {}} />
    </MemoryRouter>,
  );

describe("StepItem with the journal's facts", () => {
  it("shows a one-line subtitle and the headline chips even when folded", () => {
    mount(facts);
    expect(screen.getByText("Letters on the recipe page.")).toBeInTheDocument();
    for (const t of ["gate ✓", "PR open", "merge it yourself", "review partial", "sent back 1×", "14 min"]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it("says who did what: the gate, the lead's reason, the review, the PR", () => {
    mount(facts);
    const list = screen.getByRole("list", { name: "Who did what" });
    expect(list).toHaveTextContent("tools/ovg gate — green");
    expect(list).toHaveTextContent("finished — all criteria hold");
    expect(list).toHaveTextContent("the lead accepted it: false alarm");
    expect(list).toHaveTextContent("me/app/pull/35");
    expect(list).toHaveTextContent("GitHub would not merge it by itself");
  });

  it("is still a card without facts", () => {
    mount(undefined);
    expect(screen.getByRole("list", { name: "Who did what" })).toHaveTextContent("claude — finished");
    expect(screen.queryByText("gate ✓")).toBeNull();
  });
});
