import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { MarkdownText } from "@/components/markdown-text";
import { fileRefCandidates, splitFileRefs } from "@/lib/files-link";
import type { TranscriptEntry } from "@/lib/types";
import { FileLinksProvider } from "./file-links";

describe("splitFileRefs", () => {
  const refs = (text: string) => splitFileRefs(text).flatMap((p) => (p.ref ? [p.ref] : []));

  it("finds a relative path, with or without a line", () => {
    expect(refs("see src/a.ts:42 and README.md")).toEqual([{ path: "src/a.ts", line: 42 }, { path: "README.md" }]);
    expect(refs("at web/x.tsx:7:3.")).toEqual([{ path: "web/x.tsx", line: 7 }]);
  });

  it("ignores URLs, absolute paths, dotfiles and versions", () => {
    expect(refs("https://example.com/a.js /etc/passwd.txt .env ./a.ts 0.256.0 ~/x.md")).toEqual([]);
  });

  it("keeps the text intact", () => {
    const text = "x src/a.ts:1, y";
    expect(splitFileRefs(text).map((p) => p.text).join("")).toBe(text);
  });

  it("collects candidates from prose only", () => {
    const entries = [
      { uuid: "1", role: "assistant", parts: [{ kind: "text", text: "`src/a.ts:3` and src/a.ts" }, { kind: "tool", name: "Read", summary: "b.ts" }] },
    ] as unknown as TranscriptEntry[];
    expect(fileRefCandidates(entries)).toEqual(["src/a.ts"]);
  });
});

describe("FileLinksProvider", () => {
  const entries = [
    { uuid: "1", role: "assistant", parts: [{ kind: "text", text: "fixed `src/a.ts:2`, not gone.ts" }] },
  ] as unknown as TranscriptEntry[];

  it("links only existing paths, asks once, and opens the file at its line", async () => {
    let asked: unknown = null;
    server.use(
      http.post("/api/pane/p1/files/exists", async ({ request }) => {
        asked = await request.json();
        return HttpResponse.json({ existing: ["src/a.ts"] });
      }),
      http.get("/api/pane/p1/file", ({ request }) =>
        new URL(request.url).searchParams.get("path") === "src/a.ts"
          ? new HttpResponse("one\ntwo\nthree")
          : new HttpResponse("nope", { status: 404 }),
      ),
    );
    render(
      <FileLinksProvider paneId="p1" entries={entries}>
        <MarkdownText text={(entries[0]!.parts[0] as { text: string }).text} />
      </FileLinksProvider>,
    );
    const link = await screen.findByRole("button", { name: "src/a.ts:2" });
    expect(asked).toEqual({ paths: ["src/a.ts", "gone.ts"] });
    expect(screen.queryByRole("button", { name: "gone.ts" })).toBeNull();

    await userEvent.click(link);
    await waitFor(() => expect(document.querySelector('[data-line="2"]')?.className).toContain("bg-find-hit"));
    expect(document.querySelector('[data-line="2"]')?.textContent).toBe("2two");
  });

  it("makes no link at all without a provider", () => {
    render(<MarkdownText text="`src/a.ts:2`" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
