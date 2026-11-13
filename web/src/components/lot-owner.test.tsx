import { act, render, screen } from "@testing-library/react";

import type { CardView, Lot } from "@/lib/board";
import { publishIdentities } from "@/lib/identities";
import { CardPeople } from "./card-people";
import { PhaseLots } from "./project-lots";

// ADR 0048 §7: another pair's lot is seen, not launched — greyed with why — and a lot or card running
// at another pair's reads « running at <name>'s ».
const ME = "aaaaaaaaaaaa";
const ALICE = "bbbbbbbbbbbb";
const card = (over: Partial<CardView> = {}) => ({ id: "c1", title: "step", status: "ready", repoPath: "/r/s", ...over }) as CardView;
const lot = (over: Partial<Lot> = {}): Lot => ({ id: "l1", repoPath: "/r/s", phaseId: null, name: "L", position: 0, launchedAt: null, cardIds: ["c1"], createdBy: "alice@x", createdPair: ALICE, ...over });

function lots(l: Lot, c = card()) {
  return render(<PhaseLots lots={[{ lot: l, cards: [c], done: 0 }]} steps={[c]} byId={new Map([[c.id, c]])} onLaunched={() => {}} renderStep={(s) => <li key={s.id}>{s.title}</li>} />);
}

describe("a lot or card of another pair", () => {
  beforeEach(() => act(() => publishIdentities({ "/r/s": { me: "me@x", pair: ME, people: ["alice@x", "me@x"] } })));
  afterEach(() => act(() => publishIdentities({})));

  it("greys Launch on another pair's planned lot, with why", () => {
    lots(lot());
    expect(screen.getByRole("button", { name: /launch this lot/i })).toBeDisabled();
    expect(screen.getByText(/alice's lot — only its creator/)).toBeInTheDocument();
  });

  it("greys Resume on another pair's halted lot", () => {
    lots(lot({ launchedAt: 1, halted: "gate failed", finished: false }));
    expect(screen.getByRole("button", { name: /resume/i })).toBeDisabled();
  });

  it("says where another pair's lot is running", () => {
    lots(lot({ launchedAt: 1, finished: false }));
    expect(screen.getByText("running at alice's")).toBeInTheDocument();
  });

  it("this pair's own lot launches as before", () => {
    lots(lot({ createdBy: "me@x", createdPair: ME }));
    expect(screen.getByRole("button", { name: /launch this lot/i })).toBeEnabled();
    expect(screen.queryByText(/only its creator/)).toBeNull();
  });

  it("a card claimed by another pair reads « running at », until it is done", () => {
    const claimed = card({ status: "working", claim: { pair: ALICE, by: "alice@x", at: 0 } });
    const { rerender } = render(<CardPeople card={claimed} />);
    expect(screen.getByText("running at alice's")).toBeInTheDocument();
    rerender(<CardPeople card={{ ...claimed, status: "done" }} />);
    expect(screen.queryByText(/running at/)).toBeNull();
  });
});
