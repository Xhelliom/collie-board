import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { setPreference } from "@/i18n";
import { CardJournal, describeEvent, foldStatusLoops } from "./card-journal";
import { CardEditor, LinkPicker } from "./card-editor";
import { CardDiff } from "./card-diff";
import type { BoardEvent, CardView } from "@/lib/board";

const ev = (id: number, type: string, payload: unknown = {}): BoardEvent =>
  ({ id, cardId: "c", type, payload, ts: Date.now() - id * 60_000 }) as BoardEvent;
const status = (id: number, from: string, to: string) => ev(id, "card.status", { from, to });

afterEach(() => setPreference("en"));

describe("journal (audit #22 #23 #10)", () => {
  it("#22 translates the five raw event types", () => {
    setPreference("fr");
    for (const type of ["card.reopened", "card.cleaned_up", "card.pr_opened", "wrapup.requested", "wrapup.collected"]) {
      expect(describeEvent(ev(1, type))).not.toBe(type);
    }
  });

  it("#22 relative dates follow the language", () => {
    setPreference("fr");
    render(<CardJournal events={[ev(5, "card.created")]} onRestore={async () => {}} />);
    expect(screen.queryByText(/ago/)).toBeNull();
    expect(screen.getByText(/il y a/)).toBeInTheDocument();
  });

  it("#23 folds consecutive working ↔ review round trips into one row", () => {
    const events = [
      status(1, "review", "working"),
      status(2, "working", "review"),
      status(3, "review", "working"),
      status(4, "working", "review"),
      ev(5, "card.created"),
    ];
    render(<CardJournal events={events} onRestore={async () => {}} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/4 .*working ↔ review/)).toBeInTheDocument();
  });

  it("#10 says when it caps, and shows everything on demand", async () => {
    const events = Array.from({ length: 35 }, (_, i) => ev(i + 1, "card.created"));
    render(<CardJournal events={events} onRestore={async () => {}} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(30);
    await userEvent.click(screen.getByRole("button", { name: /30.*35/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(35);
  });

  it("#10 folds 3+ consecutive working ↔ review moves into one row", () => {
    const rows = foldStatusLoops([status(1, "working", "review"), status(2, "review", "working"), status(3, "working", "review"), ev(4, "card.created")]);
    expect(rows).toHaveLength(2);
    expect("loop" in rows[0]! && rows[0].loop).toBe(3);
  });
});

describe("editor (audit #8 #17)", () => {
  const cards = Array.from({ length: 12 }, (_, i) => ({ id: `k${i}`, title: `Carte ${i}` }) as CardView);

  it("#17 filters the link list", async () => {
    render(<LinkPicker label="Après" hint="" value={null} cards={cards} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /Nothing|Aucune/i }));
    await userEvent.type(screen.getByRole("searchbox"), "Carte 11");
    expect(screen.getByText("Carte 11")).toBeInTheDocument();
    expect(screen.queryByText("Carte 3")).toBeNull();
  });

  it("#8 fields are 16px on mobile (text-base), no zoom at focus", () => {
    const card = { id: "c", title: "t", spec: "s", acceptance: ["a"], parentId: null, dependsOn: null } as unknown as CardView;
    render(<CardEditor card={card} open onClose={() => {}} onSave={async () => {}} />);
    for (const el of document.querySelectorAll("input:not([type=checkbox]), textarea")) {
      expect(el.className).not.toMatch(/(^|\s)text-sm/);
      expect(el.className).toMatch(/text-base/);
    }
  });
});

describe("diff (audit #21)", () => {
  it("#21 shows an error other than 409 instead of hiding the section", async () => {
    server.use(http.get("/api/cards/c1/diff", () => HttpResponse.json({ error: "git a cassé" }, { status: 500 })));
    render(<CardDiff cardId="c1" statusKey="working" />);
    expect(await screen.findByText(/git a cassé/)).toBeInTheDocument();
  });

  it("#21 still hides on 409 (not started)", async () => {
    server.use(http.get("/api/cards/c1/diff", () => HttpResponse.json({ error: "not started" }, { status: 409 })));
    const { container } = render(<CardDiff cardId="c1" statusKey="working" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container).toBeEmptyDOMElement();
  });
});
