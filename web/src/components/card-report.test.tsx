import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { BoardEvent, CardSession } from "@/lib/board";
import { cardReport } from "@/lib/card-report";
import { CardReportSection } from "./card-report";

let id = 0;
const ev = (type: string, payload: Record<string, unknown>): BoardEvent =>
  ({ id: ++id, cardId: "c", type, payload, ts: id }) as BoardEvent;
const session = (handoffMd: string | null) => ({ id: `s${++id}`, handoffMd }) as CardSession;

describe("cardReport", () => {
  it("pairs each bilan with the lead's answer, in order, and concludes on the last verdict", () => {
    const r = cardReport([
      ev("run.report", { runId: "r", round: 1, text: "Issue : codé\nhalf", issue: "coded" }),
      ev("run.decision", { runId: "r", decision: "prompt", prompt: "add tests", reason: "no tests" }),
      ev("run.decision", { runId: "r", decision: "fold", reason: "irrelevant" }),
      ev("run.report", { runId: "r", round: 2, text: "Issue : partiel\ntests", issue: "partial" }),
      ev("run.decision", { runId: "r", decision: "finished", reason: "good enough" }),
    ])!;
    expect(r.rounds.map((x) => [x.bilan?.split("\n")[1], x.answer?.kind])).toEqual([["half", "prompt"], ["tests", "finished"]]);
    expect(r.issue).toBe("partial");
    expect(r.conclusion).toEqual({ kind: "finished", reason: "good enough" });
  });

  it("is null for a card never launched", () => {
    expect(cardReport([], [session(null)])).toBeNull();
  });

  it("shows a halt with its reason, and the session's report alone is enough", () => {
    expect(cardReport([ev("run.halted", { runId: "r", reason: "lead silent" })])!.conclusion).toEqual({ kind: "halted", reason: "lead silent" });
    const r = cardReport([], [session("# Done\nshipped")])!;
    expect(r.handoffMd).toContain("shipped");
    expect(r.issue).toBeNull();
  });
});

describe("CardReportSection", () => {
  it("leads with the outcome and the lead's conclusion; only the last round is open", () => {
    const r = cardReport(
      [
        ev("run.report", { runId: "r", round: 1, text: "first bilan", issue: null }),
        ev("run.decision", { runId: "r", decision: "prompt", prompt: "verify", reason: "unproven" }),
        ev("run.report", { runId: "r", round: 2, text: "Issue : déjà présent\nabc123 on main", issue: "present" }),
        ev("run.decision", { runId: "r", decision: "finished", reason: "abc123 is on main" }),
      ],
      [session("end of session note")],
    )!;
    const { container } = render(<CardReportSection report={r} />);
    expect(screen.getByTestId("report-issue")).toHaveTextContent(/already there/i);
    expect(screen.getAllByText("abc123 is on main").length).toBeGreaterThan(0);
    const details = container.querySelectorAll("details");
    expect([...details].map((d) => d.open)).toEqual([false, true, false]); // round 1, round 2, the session report
    expect(screen.getByText(/end-of-session report/i)).toBeInTheDocument();
  });

  it("says the outcome is unknown when the bilan gave none", () => {
    const r = cardReport([ev("run.report", { runId: "r", round: 1, text: "did stuff", issue: null })])!;
    render(<CardReportSection report={r} />);
    expect(screen.getByTestId("report-issue")).toHaveTextContent(/outcome unknown/i);
    expect(screen.getByText(/has not answered yet/i)).toBeInTheDocument();
  });
});
