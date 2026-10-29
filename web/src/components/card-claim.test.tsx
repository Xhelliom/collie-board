import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import type { CardView } from "@/lib/board";
import { publishIdentities } from "@/lib/identities";
import { server } from "@/test/setup";
import { ClaimedElsewhere } from "./card-claim";

// ADR 0048 §7: a shared card another pair claimed is not startable here — greyed with who and when,
// and « Reprendre la main » takes it back on a confirmed second tap.
const card = (over: Partial<CardView> = {}) =>
  ({ id: "c1", title: "t", status: "working", repoPath: "/r/s", claim: { pair: "bbbbbbbbbbbb", by: "alice@x", at: Date.UTC(2026, 9, 29, 9, 32) }, ...over }) as CardView;

describe("ClaimedElsewhere", () => {
  afterEach(() => act(() => publishIdentities({})));
  const shared = () => act(() => publishIdentities({ "/r/s": { me: "me@x", pair: "aaaaaaaaaaaa", people: ["alice@x", "me@x"] } }));

  it("greys Start with who holds the card, and takes it back only on the second tap", async () => {
    shared();
    let posted = 0;
    server.use(http.post("/api/cards/c1/claim", () => (posted++, HttpResponse.json({ ok: true }))));
    const onMessage = vi.fn();
    render(<ClaimedElsewhere card={card()} onChanged={() => {}} onMessage={onMessage} />);
    expect(screen.getByRole("button", { name: /start agent/i })).toBeDisabled();
    expect(screen.getByText(/^Taken by alice at \d\d:\d\d/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Take it back" }));
    expect(posted).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /tap again/i }));
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith(expect.stringContaining("yours"), "success"));
    expect(posted).toBe(1);
  });

  it("nothing for this pair's own claim, a finished card, or an unshared repo", () => {
    shared();
    const { container, rerender } = render(<ClaimedElsewhere card={card({ claim: { pair: "aaaaaaaaaaaa", by: "me@x", at: 0 } })} onChanged={() => {}} onMessage={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ClaimedElsewhere card={card({ status: "done" })} onChanged={() => {}} onMessage={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    act(() => publishIdentities({}));
    rerender(<ClaimedElsewhere card={card()} onChanged={() => {}} onMessage={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
