import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { useLightbox } from "@/lib/lightbox";
import type { CardView } from "@/lib/board";
import { CardDeliverables, DeliverableLinks, recentDeliverables } from "./card-deliverables";

const d = (name: string, size = 2048) => ({ name, size, mime: "x", publishedAt: 1, by: "agent" });

function LightboxProbe() {
  const lb = useLightbox();
  return <output data-testid="lb">{lb ? `${lb.index}:${lb.images.join(",")}` : ""}</output>;
}

describe("CardDeliverables", () => {
  it("shows images as thumbnails into the lightbox, documents to open, the rest as a download", async () => {
    server.use(
      http.get("/api/cards/c1/deliverables", () =>
        HttpResponse.json({ deliverables: [d("shot.png"), d("report.md"), d("data.xlsx", 3 * 1024 * 1024)] }),
      ),
    );
    render(
      <>
        <CardDeliverables cardId="c1" version={0} />
        <LightboxProbe />
      </>,
    );
    const thumb = await screen.findByRole("button", { name: "Open shot.png" });
    expect(thumb.querySelector("img")!.getAttribute("src")).toBe("/api/cards/c1/deliverables/shot.png");
    await userEvent.click(thumb);
    expect(screen.getByTestId("lb").textContent).toBe("0:/api/cards/c1/deliverables/shot.png");

    expect(screen.getByRole("button", { name: "Open report.md" })).toBeTruthy();
    const dl = screen.getByRole("link", { name: "Download data.xlsx" });
    expect(dl.getAttribute("href")).toBe("/api/cards/c1/deliverables/data.xlsx");
    expect(dl.textContent).toContain("3 MB");
  });

  it("deletes on the second tap only", async () => {
    let deleted = 0;
    server.use(
      http.get("/api/cards/c1/deliverables", () => HttpResponse.json({ deliverables: [d("a.pdf")] })),
      http.delete("/api/cards/c1/deliverables/a.pdf", () => {
        deleted++;
        return HttpResponse.json({ ok: true });
      }),
    );
    render(<CardDeliverables cardId="c1" version={0} />);
    const del = await screen.findByRole("button", { name: "Delete a.pdf" });
    await userEvent.click(del);
    expect(deleted).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Delete a.pdf" }));
    await waitFor(() => expect(screen.queryByText("a.pdf")).toBeNull());
    expect(deleted).toBe(1);
  });

  it("renders nothing when the card has published nothing", async () => {
    let asked = false;
    server.use(
      http.get("/api/cards/c1/deliverables", () => {
        asked = true;
        return HttpResponse.json({ deliverables: [] });
      }),
    );
    const { container } = render(<CardDeliverables cardId="c1" version={0} />);
    await waitFor(() => expect(asked).toBe(true));
    expect(container.textContent).toBe("");
  });
});

describe("recentDeliverables / DeliverableLinks", () => {
  const cards = [
    { id: "a", title: "Logo" },
    { id: "b", title: "Rapport" },
  ] as CardView[];
  const facts = {
    a: { deliverables: [{ name: "logo.png", size: 10, ts: 1 }] },
    b: { deliverables: [{ name: "r.html", size: 20, ts: 2 }] },
  } as never;

  it("lists the project's newest first, each linked to its card", () => {
    const items = recentDeliverables(cards, facts);
    expect(items.map((i) => i.name)).toEqual(["r.html", "logo.png"]);
    render(
      <MemoryRouter>
        <DeliverableLinks items={items} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "on Logo" }).getAttribute("href")).toBe("/card/a");
    expect(screen.getByRole("link", { name: "Open r.html" }).getAttribute("href")).toBe("/api/cards/b/deliverables/r.html");
    expect(screen.getByRole("button", { name: "Open logo.png" })).toBeTruthy();
  });
});
