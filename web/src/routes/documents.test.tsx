import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setPreference } from "@/i18n";
import { docMatches, docsLoader, resolveDocLink, type DocsIndex } from "@/lib/docs";
import { server } from "@/test/setup";

import { DocumentsRoute } from "./documents";

const INDEX: DocsIndex = {
  ref: "main",
  rubrics: [
    { id: "adr", label: "Décisions (ADR)", docs: [{ path: ".adr/0001-door.md", title: "0001 — One door", size: 10 }] },
    { id: "plan", label: "Plan par phase", docs: [{ path: "docs/plan/phase-1.md", title: "Phase 1", size: 10 }] },
  ],
  other: [{ path: "NOTES.md", title: "Notes", size: 5 }],
  decisions: [
    { kind: "roadmap", id: "d1", text: "The repo is the source of truth", status: "decided", date: "2026-11-06" },
    { kind: "adr", path: ".adr/0001-door.md", title: "0001 — One door", status: "Accepted", date: "2026-09-01" },
  ],
  bilan: [
    { code: "missing", rubric: "index", label: "Où chercher quoi" },
    { code: "tooBig", path: "plan/dette.md", size: 140_000 },
    { code: "noStatus", count: 5, paths: ["docs/a.md", "docs/b.md", "docs/c.md"] },
  ],
};

const FILES: Record<string, string> = {
  "docs/plan/phase-1.md": "# Phase 1\n\nSee [the door](../../.adr/0001-door.md). <script>alert(1)</script>\n",
  ".adr/0001-door.md": "# 0001 — One door\n\n**Status:** Accepted\n",
};

beforeEach(() => {
  setPreference("en");
  localStorage.clear();
  server.use(
    http.get("/api/docs", () => HttpResponse.json(INDEX)),
    http.get("/api/docs/file", ({ request }) => {
      const path = new URL(request.url).searchParams.get("path")!;
      return path in FILES ? HttpResponse.json({ path, text: FILES[path], truncated: false }) : new HttpResponse("no", { status: 404 });
    }),
    http.get("/api/docs/search", ({ request }) =>
      HttpResponse.json({ paths: new URL(request.url).searchParams.get("q") === "girafe" ? ["NOTES.md"] : [] }),
    ),
  );
});
afterEach(() => setPreference("en"));

const mount = (url: string) =>
  render(
    <RouterProvider
      router={createMemoryRouter(
        [
          { path: "/board/documents", loader: docsLoader, element: <DocumentsRoute /> },
          { path: "/card/:cardId", element: <p>card page</p> },
        ],
        { initialEntries: [url] },
      )}
    />,
  );

describe("docs helpers", () => {
  it("resolves a relative link against the document's folder, and refuses one that climbs out", () => {
    expect(resolveDocLink("docs/plan/a.md", "../adr/b.md#ctx")).toBe("docs/adr/b.md");
    expect(resolveDocLink("README.md", "./docs/x.md")).toBe("docs/x.md");
    expect(resolveDocLink("README.md", "../x.md")).toBeNull();
  });

  it("matches on title, path, or the bridge's text hits", () => {
    const d = { path: "NOTES.md", title: "Notes", size: 1 };
    expect(docMatches(d, "", new Set())).toBe(true);
    expect(docMatches(d, "not", new Set())).toBe(true);
    expect(docMatches(d, "girafe", new Set())).toBe(false);
    expect(docMatches(d, "girafe", new Set(["NOTES.md"]))).toBe(true);
  });
});

describe("DocumentsRoute", () => {
  it("asks for a project when none is picked", async () => {
    mount("/board/documents");
    expect(await screen.findByText("Pick a project to read its documents.")).toBeInTheDocument();
  });

  it("lists the rubrics, « Other » and the merged decisions with their statuses", async () => {
    mount("/board/documents?repo=%2Fr%2Fapp");
    expect(await screen.findByText("Plan par phase")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(screen.getByText("The repo is the source of truth")).toBeInTheDocument();
    expect(screen.getByText("✅ Decided")).toBeInTheDocument();
    expect(screen.getByText("Accepted")).toBeInTheDocument();
  });

  it("searches titles at once and text through the bridge", async () => {
    mount("/board/documents?repo=%2Fr%2Fapp");
    const box = await screen.findByPlaceholderText("Search titles and text");
    await userEvent.type(box, "phase");
    expect(screen.getByText("Phase 1")).toBeInTheDocument();
    expect(screen.queryByText("Notes")).toBeNull();
    await userEvent.clear(box);
    await userEvent.type(box, "girafe");
    expect(await screen.findByText("Notes")).toBeInTheDocument();
    expect(screen.queryByText("Phase 1")).toBeNull();
  });

  it("opens a document as text, and follows its relative .md link in place", async () => {
    mount("/board/documents?repo=%2Fr%2Fapp");
    await userEvent.click(await screen.findByText("Phase 1"));
    expect(await screen.findByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
    expect(document.querySelector("article script")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "the door" }));
    expect(await screen.findByText(".adr/0001-door.md")).toBeInTheDocument();
    expect(await screen.findByText("0001 — One door")).toBeInTheDocument();
  });

  it("« Request a change » files a card naming the file and the operator's words, then opens it", async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post("/api/cards", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, card: { id: "c42" } });
      }),
    );
    mount("/board/documents?repo=%2Fr%2Fapp&doc=docs%2Fplan%2Fphase-1.md");
    await userEvent.click(await screen.findByRole("button", { name: "Request a change" }));
    const submit = screen.getByRole("button", { name: "Create the card" });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("What should change in this document?"), "Add the exit criteria");
    await userEvent.click(submit);
    expect(await screen.findByText("card page")).toBeInTheDocument();
    expect(body).toMatchObject({ title: "Doc: change docs/plan/phase-1.md", repoPath: "/r/app" });
    expect(String(body!.spec)).toContain("`docs/plan/phase-1.md`");
    expect(String(body!.spec)).toContain("Add the exit criteria");
  });

  it("shows the doc check one gap per line, and « Bring the docs up to standard » files a card that asks first", async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post("/api/cards", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, card: { id: "c43" } });
      }),
    );
    mount("/board/documents?repo=%2Fr%2Fapp");
    expect(await screen.findByText("No « Où chercher quoi »")).toBeInTheDocument();
    expect(screen.getByText("plan/dette.md is 140 KB: split it past 30")).toBeInTheDocument();
    expect(screen.getByText("5 files in docs/ without a Status line: docs/a.md, docs/b.md, docs/c.md, …")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Bring the docs up to standard" }));
    expect(await screen.findByText("card page")).toBeInTheDocument();
    expect(body).toMatchObject({ title: "Doc: bring app up to the convention", repoPath: "/r/app" });
    const spec = String(body!.spec);
    expect(spec).toContain("- plan/dette.md is 140 KB");
    expect(spec).toContain('"open"');
    expect(spec).toContain("cardId");
    expect(spec).toContain("Delete nothing");
  });

  it("says when the docs hold to the convention, with no button", async () => {
    server.use(http.get("/api/docs", () => HttpResponse.json({ ...INDEX, bilan: [] })));
    mount("/board/documents?repo=%2Fr%2Fapp");
    expect(await screen.findByText("✅ The docs follow the convention.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bring the docs up to standard" })).toBeNull();
  });
});
