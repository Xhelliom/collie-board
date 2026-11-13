import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { CardDiff } from "./card-diff";

describe("count folds", () => {
  it("the diff lists 8 files then a count", async () => {
    const files = Array.from({ length: 57 }, (_, i) => ({ path: `src/f${i}.ts`, added: 1, removed: 0, kind: "text" }));
    server.use(http.get("/api/cards/c1/diff", () => HttpResponse.json({ ok: true, base: "b", cwd: "/w", files, added: 57, removed: 0 })));
    render(<CardDiff cardId="c1" statusKey="review" />);
    expect(await screen.findByText("src/f0.ts")).toBeInTheDocument();
    expect(screen.queryByText("src/f8.ts")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show 49 more" }));
    expect(screen.getByText("src/f56.ts")).toBeInTheDocument();
  });
});

