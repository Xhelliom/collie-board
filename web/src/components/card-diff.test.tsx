import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { CardDiff, isMarkdownPath, lineClass } from "./card-diff";

// A unified diff's file headers start with the same characters as its content lines, which is the
// one thing a naive prefix check gets wrong — every patch would open with a meaningless green and
// red line.
describe("lineClass", () => {
  it("treats +++ / --- as headers, not as an addition and a removal", () => {
    expect(lineClass("+++ b/src/a.ts")).toBe("text-muted-foreground");
    expect(lineClass("--- a/src/a.ts")).toBe("text-muted-foreground");
  });

  it("colours real additions and removals", () => {
    expect(lineClass("+const x = 1;")).toBe("text-status-done");
    expect(lineClass("-const x = 0;")).toBe("text-status-blocked");
  });

  it("marks hunk headers", () => {
    expect(lineClass("@@ -1,3 +1,4 @@")).toBe("text-status-working");
  });

  it("leaves context lines unstyled", () => {
    expect(lineClass(" unchanged")).toBe("");
    expect(lineClass("")).toBe("");
  });

  it("mutes the git preamble", () => {
    expect(lineClass("diff --git a/x b/x")).toBe("text-muted-foreground");
    expect(lineClass("index 0000000..d86bac9")).toBe("text-muted-foreground");
  });
});

// The way out of an empty diff. An empty `--stat` almost always means the base ref is wrong, not
// that the agent slept — so the empty state carries the fix (base on `main`, review again) and the
// non-empty one must not, or every card with real work would offer to re-point its base.
describe("CardDiff — empty diff", () => {
  const stat = (files: unknown[]) => ({ ok: true, base: "abc123", cwd: "/w", files, added: 0, removed: 0 });

  let patched: Record<string, unknown> | undefined;
  let reviewed = 0;

  beforeEach(() => {
    patched = undefined;
    reviewed = 0;
    server.use(
      http.patch("/api/cards/c1", async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ok: true, card: {} });
      }),
      http.post("/api/cards/c1/review", () => {
        reviewed += 1;
        return HttpResponse.json({ ok: true, card: {} });
      }),
    );
  });

  it("offers to re-point the base at main, and the tap PATCHes then re-reviews", async () => {
    const user = userEvent.setup();
    server.use(http.get("/api/cards/c1/diff", () => HttpResponse.json(stat([]))));
    render(<CardDiff cardId="c1" statusKey="review" />);

    await user.click(await screen.findByRole("button", { name: /base ref on main/i }));

    await waitFor(() => expect(patched).toEqual({ baseRef: "main" }));
    await waitFor(() => expect(reviewed).toBe(1));
  });

  it("does not offer it when the diff has files", async () => {
    server.use(
      http.get("/api/cards/c1/diff", () =>
        HttpResponse.json(stat([{ path: "web/src/a.ts", added: 3, removed: 1, kind: "text" }])),
      ),
    );
    render(<CardDiff cardId="c1" statusKey="review" />);

    expect(await screen.findByText("web/src/a.ts")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /base ref on main/i })).not.toBeInTheDocument();
  });
});

// The reader. A generated report is a file the card wrote, so it is reached from the diff — but a
// patch is not a document: reading one means fetching the FILE and rendering it. Two things must
// hold, and the second is why the toggle exists at all: every other file is untouched.
describe("CardDiff — Markdown reader", () => {
  const stat = (files: unknown[]) => ({ ok: true, base: "abc123", cwd: "/w", files, added: 1, removed: 0 });
  const md = { path: "REPORT.md", added: 4, removed: 0, kind: "text" };
  const ts = { path: "web/src/a.ts", added: 1, removed: 0, kind: "text" };

  it("classifies by extension, case-insensitively", () => {
    expect(isMarkdownPath("REPORT.md")).toBe(true);
    expect(isMarkdownPath("docs/notes.MARKDOWN")).toBe(true);
    expect(isMarkdownPath("web/src/a.ts")).toBe(false);
    expect(isMarkdownPath("mdfile")).toBe(false);
  });

  it("opens a .md rendered, and the toggle goes back to the patch", async () => {
    const user = userEvent.setup();
    const modes: (string | null)[] = [];
    server.use(
      http.get("/api/cards/c1/diff", ({ request }) => {
        const mode = new URL(request.url).searchParams.get("mode");
        if (!mode) return HttpResponse.json(stat([md]));
        modes.push(mode);
        return mode === "read"
          ? HttpResponse.json({ ok: true, path: "REPORT.md", text: "# Verdict\n\nAll good.", truncated: false })
          : HttpResponse.json({ ok: true, path: "REPORT.md", diff: "@@ -0,0 +1 @@\n+# Verdict", truncated: false });
      }),
    );
    render(<CardDiff cardId="c1" statusKey="review" />);

    await user.click(await screen.findByText("REPORT.md"));
    // Rendered, not raw: the heading's text node is "Verdict", with the `#` consumed as structure.
    expect(await screen.findByText("Verdict")).toBeInTheDocument();
    expect(screen.getByText("All good.")).toBeInTheDocument();
    await waitFor(() => expect(modes).toEqual(["read"]));

    await user.click(screen.getByRole("button", { name: /show the diff/i }));
    expect(await screen.findByText("+# Verdict")).toBeInTheDocument();
    await waitFor(() => expect(modes).toEqual(["read", "file"]));
  });

  it("leaves every other file on the diff it always had", async () => {
    const user = userEvent.setup();
    const modes: (string | null)[] = [];
    server.use(
      http.get("/api/cards/c1/diff", ({ request }) => {
        const mode = new URL(request.url).searchParams.get("mode");
        if (!mode) return HttpResponse.json(stat([ts]));
        modes.push(mode);
        return HttpResponse.json({ ok: true, path: ts.path, diff: "@@ -1 +1 @@\n+const x = 1;", truncated: false });
      }),
    );
    render(<CardDiff cardId="c1" statusKey="review" />);

    await user.click(await screen.findByText(ts.path));
    expect(await screen.findByText("+const x = 1;")).toBeInTheDocument();
    await waitFor(() => expect(modes).toEqual(["file"]));
    expect(screen.queryByRole("button", { name: /read the document/i })).not.toBeInTheDocument();
  });
});
