import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setPreference } from "@/i18n";
import { decisionStatus, docMatches, docsLoader, docTree, fileCount, folderChain, pageNameOf, resolveDocLink, type DocsIndex } from "@/lib/docs";
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
    { kind: "roadmap", id: "d1", text: "The repo is the source of truth", status: "decided", date: "2026-11-06", category: "Foundation" },
    { kind: "adr", path: ".adr/0001-door.md", title: "0001 — One door", status: "Accepted", date: "2026-09-01" },
    ...[1, 2, 3, 4, 5].map((n) => ({ kind: "roadmap" as const, id: `o${n}`, text: `Open question ${n}`, status: "open" as const, date: "2026-08-01", ...(n === 1 ? { cardId: "c1" } : {}) })),
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
    http.get("/api/docs/page-tabs", () =>
      HttpResponse.json({ ref: "main", pages: [{ name: "roadmap", size: 9 }], deliverables: [{ cardId: "c9", cardTitle: "Offer", name: "offre.html", size: 9 }], tabs: [] }),
    ),
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
          { path: "/board/roadmap", element: <p>roadmap page</p> },
        ],
        { initialEntries: [url] },
      )}
    />,
  );
const folder = (name: string) => screen.findByRole("button", { name: new RegExp(`^${name}`) });

describe("docs helpers", () => {
  it("resolves a relative link against the document's folder, and refuses one that climbs out", () => {
    expect(resolveDocLink("docs/plan/a.md", "../adr/b.md#ctx")).toBe("docs/adr/b.md");
    expect(resolveDocLink("README.md", "./docs/x.md")).toBe("docs/x.md");
    expect(resolveDocLink("README.md", "../x.md")).toBeNull();
  });

  it("classes an ADR's free-text status, and keeps a roadmap decision's own", () => {
    const adr = (status: string | null) => ({ kind: "adr" as const, path: "a.md", title: "a", status, date: null });
    expect(decisionStatus(adr("Accepted — superseded by 0036"))).toBe("decided");
    expect(decisionStatus(adr("Proposed"))).toBe("leaning");
    expect(decisionStatus(adr("Ouvert"))).toBe("open");
    expect(decisionStatus(adr(null))).toBe("decided");
    expect(decisionStatus({ kind: "roadmap", id: "x", text: "x", status: "leaning", date: null })).toBe("leaning");
  });

  it("matches on title, path, or the bridge's text hits", () => {
    const d = { path: "NOTES.md", title: "Notes", size: 1 };
    expect(docMatches(d, "", new Set())).toBe(true);
    expect(docMatches(d, "not", new Set())).toBe(true);
    expect(docMatches(d, "girafe", new Set())).toBe(false);
    expect(docMatches(d, "girafe", new Set(["NOTES.md"]))).toBe(true);
  });

  it("builds the folder tree, folders first, and counts what a folder holds", () => {
    const f = (path: string) => ({ path, title: path, size: 1 });
    const root = docTree([f("README.md"), f("docs/plan/b.md"), f("docs/a.md"), f(".adr/0001.md")]);
    expect(root.folders.map((x) => x.path)).toEqual([".adr", "docs"]);
    expect(root.files.map((x) => x.path)).toEqual(["README.md"]);
    expect(root.folders[1]!.folders[0]!.path).toBe("docs/plan");
    expect(fileCount(root.folders[1]!)).toBe(2);
    expect(folderChain("docs/plan/b.md")).toEqual(["docs", "docs/plan"]);
    expect(pageNameOf("docs/pages/roadmap.html")).toBe("roadmap");
    expect(pageNameOf("docs/pages/x/y.html")).toBeNull();
  });
});

describe("DocumentsRoute", () => {
  it("asks for a project when none is picked", async () => {
    mount("/board/documents");
    expect(await screen.findByText("Pick a project to read its documents.")).toBeInTheDocument();
  });

  it("shows the real folders folded with their counts, and the roadmap decisions as a virtual folder", async () => {
    mount("/board/documents?repo=%2Fr%2Fapp");
    expect(await folder("\\.adr")).toHaveAttribute("aria-expanded", "false");
    expect(await folder("docs")).toHaveTextContent("docs2"); // phase-1.md + pages/roadmap.html
    expect(screen.getByRole("link", { name: /NOTES\.md/ })).toBeInTheDocument(); // a root file needs no folder
    expect(screen.queryByText("phase-1.md")).toBeNull();

    await userEvent.click(await folder("Decisions \\(6\\)"));
    expect(screen.getByText("The repo is the source of truth")).toBeInTheDocument();
    expect(screen.getByText("Foundation", { selector: "span" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "❓ Open" }));
    expect(screen.queryByText("The repo is the source of truth")).toBeNull();
    expect(screen.getByRole("button", { name: /^Decisions \(5\)/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "❓ Open" }));
    await userEvent.click(screen.getByRole("button", { name: "Foundation" }));
    expect(screen.getByRole("button", { name: /^Decisions \(1\)/ })).toBeInTheDocument();
  });

  it("a tap on an open decision goes to its card, or to the roadmap when it has none", async () => {
    const { unmount } = mount("/board/documents?repo=%2Fr%2Fapp");
    await userEvent.click(await folder("Decisions"));
    expect(screen.queryByRole("link", { name: /source of truth/ })).toBeNull(); // a decided one is not a link
    await userEvent.click(screen.getByRole("link", { name: /Open question 1/ }));
    expect(await screen.findByText("card page")).toBeInTheDocument();
    unmount();
    mount("/board/documents?repo=%2Fr%2Fapp"); // the folder is still open, as left
    await userEvent.click(await screen.findByRole("link", { name: /Open question 2/ }));
    expect(await screen.findByText("roadmap page")).toBeInTheDocument();
  });

  it("folds and unfolds a folder, and finds it as left on coming back", async () => {
    const { unmount } = mount("/board/documents?repo=%2Fr%2Fapp");
    await userEvent.click(await folder("docs"));
    await userEvent.click(await folder("plan"));
    expect(screen.getByText("phase-1.md")).toBeInTheDocument();
    await userEvent.click(await folder("plan"));
    expect(screen.queryByText("phase-1.md")).toBeNull();
    await userEvent.click(await folder("plan"));
    unmount();
    mount("/board/documents?repo=%2Fr%2Fapp");
    expect(await screen.findByText("phase-1.md")).toBeInTheDocument();
  });

  it("a search narrows the tree to its hits and opens their folders — titles at once, text through the bridge", async () => {
    mount("/board/documents?repo=%2Fr%2Fapp");
    const box = await screen.findByPlaceholderText("Search titles and text");
    await userEvent.type(box, "phase");
    expect(screen.getByText("phase-1.md")).toBeInTheDocument();
    expect(screen.queryByText("NOTES.md")).toBeNull();
    expect(screen.queryByRole("button", { name: /^\.adr/ })).toBeNull();
    await userEvent.clear(box);
    await userEvent.type(box, "girafe");
    expect(await screen.findByText("NOTES.md")).toBeInTheDocument();
    expect(screen.queryByText("phase-1.md")).toBeNull();
  });

  it("opens a document beside the tree with its path, as text, and follows its relative .md link in place", async () => {
    mount("/board/documents?repo=%2Fr%2Fapp");
    await userEvent.click(await folder("docs"));
    await userEvent.click(await folder("plan"));
    await userEvent.click(screen.getByText("phase-1.md"));
    expect(await screen.findByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
    expect(document.querySelector("article script")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Path" })).toHaveTextContent("docs › plan › phase-1.md");
    expect(screen.getByRole("link", { name: /phase-1\.md/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "All documents" })).toBeInTheDocument(); // the phone's ←
    await userEvent.click(screen.getByRole("button", { name: "the door" }));
    expect(await screen.findByText(".adr › 0001-door.md")).toBeInTheDocument();
    expect(await screen.findByText("0001 — One door", { selector: "article *" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^\.adr/ })).toHaveAttribute("aria-expanded", "true"); // its folder opened
  });

  it("opens a custom page from docs › pages in the tab's inert frame, with full screen", async () => {
    mount("/board/documents?repo=%2Fr%2Fapp");
    await userEvent.click(await folder("docs"));
    await userEvent.click(await folder("pages"));
    await userEvent.click(screen.getByRole("link", { name: /roadmap\.html/ }));
    const frame = await screen.findByTitle("Project page roadmap");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("src", "/api/docs/page?repo=%2Fr%2Fapp&name=roadmap");
    await userEvent.click(screen.getByRole("button", { name: /Full screen/ }));
    expect(frame.parentElement).toHaveClass("fixed", "inset-0");
  });

  it("lists the repo's pages and its cards' HTML deliverables, each with « As a tab » that the bridge keeps", async () => {
    const puts: unknown[] = [];
    server.use(
      http.put("/api/docs/page-tabs", async ({ request }) => {
        const body = (await request.json()) as { key: string; on: boolean };
        puts.push(body);
        return HttpResponse.json({ ref: "main", pages: [], deliverables: [], tabs: body.on ? [body.key] : [] });
      }),
    );
    mount("/board/documents?repo=%2Fr%2Fapp");
    const page = await screen.findByRole("button", { name: "Show roadmap as a tab" });
    expect(page).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Card: Offer")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /offre/ })).toHaveAttribute("href", "/board/page?repo=%2Fr%2Fapp&card=c9&name=offre.html");

    const card = screen.getByRole("button", { name: "Show offre as a tab" });
    await userEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(puts).toEqual([
      { repo: "/r/app", key: "c9/offre.html", on: true },
      { repo: "/r/app", key: "c9/offre.html", on: false },
    ]);
  });

  it("offers « Showcase » on a ticked page only, one per project", async () => {
    const puts: unknown[] = [];
    server.use(
      http.get("/api/docs/page-tabs", () =>
        HttpResponse.json({ ref: "main", pages: [{ name: "roadmap", size: 9 }], deliverables: [{ cardId: "c9", cardTitle: "Offer", name: "offre.html", size: 9 }], tabs: ["roadmap"], showcase: null }),
      ),
      http.put("/api/docs/page-tabs", async ({ request }) => {
        const body = (await request.json()) as { showcase: string | null };
        puts.push(body);
        return HttpResponse.json({ ref: "main", pages: [], deliverables: [], tabs: ["roadmap"], showcase: body.showcase });
      }),
    );
    mount("/board/documents?repo=%2Fr%2Fapp");
    const pin = await screen.findByRole("button", { name: "Show roadmap at the head of the Project page" });
    expect(screen.queryByRole("button", { name: "Show offre at the head of the Project page" })).toBeNull();
    await userEvent.click(pin);
    expect(pin).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(pin);
    expect(pin).toHaveAttribute("aria-pressed", "false");
    expect(puts).toEqual([
      { repo: "/r/app", showcase: "roadmap" },
      { repo: "/r/app", showcase: null },
    ]);
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
    // Folded while it has gaps, so the tree stays on screen.
    await userEvent.click(await screen.findByRole("button", { name: /Doc check/, expanded: false }));
    expect(screen.getByText("No « Où chercher quoi »")).toBeInTheDocument();
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

  it("« New page » files a card whose deliverable is docs/pages/<name>.html, the inert contract in its spec", async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post("/api/cards", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, card: { id: "c44" } });
      }),
    );
    mount("/board/documents?repo=%2Fr%2Fapp");
    await userEvent.click(await screen.findByRole("button", { name: "New page" }));
    const create = screen.getByRole("button", { name: "Create the card" });
    await userEvent.type(screen.getByLabelText("Page name"), "plan marketing");
    expect(screen.getByText("Letters, digits, - and _ only, no space.")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Page name"));
    await userEvent.type(screen.getByLabelText("Page name"), "plan-marketing");
    expect(screen.getByText("Will be docs/pages/plan-marketing.html")).toBeInTheDocument();
    expect(create).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Brief"), "Launch plan for Q1");
    await userEvent.click(create);
    expect(await screen.findByText("card page")).toBeInTheDocument();
    expect(body).toMatchObject({ title: "Page: plan-marketing", repoPath: "/r/app" });
    const spec = String(body!.spec);
    expect(spec).toContain("`docs/pages/plan-marketing.html`");
    expect(spec).toContain("Launch plan for Q1");
    expect(spec).toContain("No script");
    expect(spec).toContain("CSS inline");
    expect(spec).toContain("sandbox");
  });

  it("says when the docs hold to the convention, with no button", async () => {
    server.use(http.get("/api/docs", () => HttpResponse.json({ ...INDEX, bilan: [] })));
    mount("/board/documents?repo=%2Fr%2Fapp");
    expect(await screen.findByText("✅ The docs follow the convention.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bring the docs up to standard" })).toBeNull();
  });
});
