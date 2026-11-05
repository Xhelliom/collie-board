import { describe, expect, it } from "vitest";
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

// An empty diff says so and offers nothing: the base is the bridge's single answer (`baseOf`). The
// old "base ref on main" button wrote a literal `main` — wrong for a dependent card, and offered on
// a merged one whose diff is empty because its work has landed.
describe("CardDiff — empty diff", () => {
  const stat = (files: unknown[]) => ({ ok: true, base: "abc123", cwd: "/w", files, added: 0, removed: 0 });

  it("never offers to write `main` as the base", async () => {
    let patched = false;
    server.use(
      http.get("/api/cards/c1/diff", () => HttpResponse.json(stat([]))),
      http.patch("/api/cards/c1", () => {
        patched = true;
        return HttpResponse.json({ ok: true, card: {} });
      }),
    );
    render(<CardDiff cardId="c1" statusKey="done" />);

    expect(await screen.findByText(/nothing changed on this branch/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /main/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1); // the refresh, nothing else
    expect(patched).toBe(false);
  });

  it("says « nothing coded, already there » instead of looking like a failure", async () => {
    server.use(http.get("/api/cards/c1/diff", () => HttpResponse.json(stat([]))));
    render(<CardDiff cardId="c1" statusKey="done" alreadyPresent />);
    expect(await screen.findByText(/already there/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing changed on this branch/i)).not.toBeInTheDocument();
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

// Line comments: tap lines, write a note, and the batch goes to the agent as ONE prompt. The batch
// outlives an unmount (a Back out of the card), and is dropped once sent.
describe("CardDiff — line comments", () => {
  const stat = { ok: true, base: "abc123", cwd: "/w", files: [{ path: "a.ts", added: 2, removed: 1, kind: "text" }], added: 2, removed: 1 };
  const patch = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -10,2 +10,3 @@\n keep\n-old\n+new one\n+new two";

  it("collects a comment, keeps it across a remount, and sends one message", async () => {
    sessionStorage.clear();
    const user = userEvent.setup();
    server.use(
      http.get("/api/cards/c2/diff", ({ request }) =>
        new URL(request.url).searchParams.get("mode")
          ? HttpResponse.json({ ok: true, path: "a.ts", diff: patch, truncated: false })
          : HttpResponse.json(stat),
      ),
    );
    const sent: string[] = [];
    const onSend = async (text: string) => {
      sent.push(text);
    };
    const first = render(<CardDiff cardId="c2" statusKey="review" onSend={onSend} />);

    await user.click(await screen.findByText("a.ts"));
    await user.click(await screen.findByText("+new one"));
    await user.click(screen.getByText("+new two"));
    await user.type(screen.getByPlaceholderText(/your comment/i), "rename these");
    await user.click(screen.getByRole("button", { name: /add comment/i }));
    expect(screen.getByText("1 comment")).toBeInTheDocument();

    first.unmount();
    render(<CardDiff cardId="c2" statusKey="review" onSend={onSend} />);
    expect(await screen.findByText("1 comment")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /send to the agent/i }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toContain("`a.ts` (+11–12)\n> +new one\n> +new two\n\nrename these");
    expect(screen.queryByText("1 comment")).not.toBeInTheDocument();
    expect(sessionStorage.length).toBe(0);
  });

  it("offers no commenting when the card has no agent to send to", async () => {
    server.use(
      http.get("/api/cards/c3/diff", ({ request }) =>
        new URL(request.url).searchParams.get("mode")
          ? HttpResponse.json({ ok: true, path: "a.ts", diff: patch, truncated: false })
          : HttpResponse.json(stat),
      ),
    );
    const user = userEvent.setup();
    render(<CardDiff cardId="c3" statusKey="done" />);
    await user.click(await screen.findByText("a.ts"));
    await user.click(await screen.findByText("+new one"));
    expect(screen.queryByPlaceholderText(/your comment/i)).not.toBeInTheDocument();
  });
});
