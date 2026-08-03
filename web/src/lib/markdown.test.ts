import { parseInline, parseMarkdown, safeHref, type MdBlock, type MdSpan } from "./markdown";

// The Markdown grammar for transcript prose. It exists because agent output IS Markdown and reading
// `## Heading` / `**bold**` raw on a phone is worse than reading it formatted — but it must never
// produce markup, only an AST the renderer turns into React elements (the repo's XSS boundary).
//
// The two deliberate omissions below (underscore emphasis, space-flanked asterisks) are the ones
// that matter for CODE-HEAVY text, which is what agents actually emit.

describe("safeHref", () => {
  it.each([
    ["https", "https://example.com"],
    ["http", "http://example.com"],
    ["mailto", "mailto:a@b.com"],
    ["rooted path", "/pane/w1:p1"],
    ["fragment", "#section"],
  ])("allows %s", (_label, href) => {
    expect(safeHref(href)).toBe(href);
  });

  // A link is the one place this view could hand a URL straight to the browser.
  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["JaVaScRiPt: (case dodge)", "JaVaScRiPt:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["vbscript:", "vbscript:msgbox(1)"],
    ["a bare word", "notaurl"],
    ["empty", "   "],
  ])("refuses %s", (_label, href) => {
    expect(safeHref(href)).toBeNull();
  });
});

describe("parseInline", () => {
  it("plain text is a single span", () => {
    expect(parseInline("just words")).toEqual([{ kind: "text", text: "just words" }]);
  });

  it.each([
    ["bold", "a **strong** b", { kind: "bold", spans: [{ kind: "text", text: "strong" }] }],
    ["italic", "a *soft* b", { kind: "italic", spans: [{ kind: "text", text: "soft" }] }],
    ["code", "a `x = 1` b", { kind: "code", text: "x = 1" }],
  ])("parses %s between text runs", (_label, src, mid) => {
    expect(parseInline(src)).toEqual([
      { kind: "text", text: "a " },
      mid,
      { kind: "text", text: " b" },
    ]);
  });

  it("bold wins over italic on a double delimiter", () => {
    expect(parseInline("**both**")).toEqual([
      { kind: "bold", spans: [{ kind: "text", text: "both" }] },
    ]);
  });

  // Regression: agents write **`sha`** constantly. A flat span model rendered those backticks
  // literally, right next to correctly-chipped neighbours — so emphasis bodies are re-parsed.
  it("parses inline code nested inside bold", () => {
    expect(parseInline("**`c6fe96`**")).toEqual([
      { kind: "bold", spans: [{ kind: "code", text: "c6fe96" }] },
    ]);
  });

  it("parses mixed content inside emphasis", () => {
    expect(parseInline("**ship `a.ts` now**")).toEqual([
      {
        kind: "bold",
        spans: [
          { kind: "text", text: "ship " },
          { kind: "code", text: "a.ts" },
          { kind: "text", text: " now" },
        ],
      },
    ]);
  });

  it("parses emphasis inside a link label", () => {
    expect(parseInline("[**docs**](https://example.com)")).toEqual([
      {
        kind: "link",
        href: "https://example.com",
        spans: [{ kind: "bold", spans: [{ kind: "text", text: "docs" }] }],
      },
    ]);
  });

  it("terminates on pathological nesting instead of recursing without bound", () => {
    expect(() => parseInline("*".repeat(200) + "x" + "*".repeat(200))).not.toThrow();
  });

  it("does not treat snake_case as emphasis — underscore emphasis is unsupported on purpose", () => {
    const src = "see betting_tip_prose_consistency and __dunder__ names";
    expect(parseInline(src)).toEqual([{ kind: "text", text: src }]);
  });

  it("does not swallow a shell glob into an italic run", () => {
    // The space before the closing marker disqualifies it — otherwise "*.ts to *" became italic.
    const src = "rename *.ts to *.tsx";
    expect(parseInline(src)).toEqual([{ kind: "text", text: src }]);
  });

  it("keeps code content literal — markdown inside backticks is not parsed", () => {
    expect(parseInline("`**not bold**`")).toEqual([{ kind: "code", text: "**not bold**" }]);
  });

  it("parses a safe link", () => {
    expect(parseInline("see [docs](https://example.com) now")).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", href: "https://example.com", spans: [{ kind: "text", text: "docs" }] },
      { kind: "text", text: " now" },
    ]);
  });

  it("an unsafe link keeps its literal text instead of becoming an anchor", () => {
    const src = "[click](javascript:alert(1))";
    const spans = parseInline(src);
    expect(spans.every((s) => s.kind !== "link")).toBe(true);
    expect(spans.map((s) => ("text" in s ? s.text : "")).join("")).toContain("click");
  });

  it("leaves HTML-looking text as text — there is no markup path at all", () => {
    const src = '<img src=x onerror="alert(1)">';
    expect(parseInline(src)).toEqual([{ kind: "text", text: src }]);
  });
});

describe("parseMarkdown", () => {
  it("parses headings by level", () => {
    expect(parseMarkdown("## Two\n### Three")).toEqual([
      { kind: "heading", level: 2, spans: [{ kind: "text", text: "Two" }] },
      { kind: "heading", level: 3, spans: [{ kind: "text", text: "Three" }] },
    ]);
  });

  it("reflows a hard-wrapped paragraph instead of keeping source line breaks", () => {
    // The phone's width should decide the wrapping, not the agent's 100-column source.
    expect(parseMarkdown("one two\nthree four")).toEqual([
      { kind: "paragraph", spans: [{ kind: "text", text: "one two three four" }] },
    ]);
  });

  it("blank lines separate paragraphs", () => {
    const blocks = parseMarkdown("first\n\nsecond");
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.kind === "paragraph")).toBe(true);
  });

  it("keeps fenced code verbatim, with its language", () => {
    const src = "```ts\nconst a = 1;\n\n// **not bold**\n```";
    expect(parseMarkdown(src)).toEqual([
      { kind: "code", lang: "ts", text: "const a = 1;\n\n// **not bold**" },
    ]);
  });

  it("an unterminated fence still yields a code block rather than eating the rest as prose", () => {
    expect(parseMarkdown("```\nno closing fence")).toEqual([
      { kind: "code", lang: "", text: "no closing fence" },
    ]);
  });

  it("parses bullet and numbered lists", () => {
    expect(parseMarkdown("- one\n- two")).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two" }]],
      },
    ]);
    const ol = parseMarkdown("1. first\n2. second");
    expect(ol[0]).toMatchObject({ kind: "list", ordered: true });
    expect((ol[0] as { items: unknown[] }).items).toHaveLength(2);
  });

  it("switching marker kind starts a new list, not one mixed block", () => {
    const blocks = parseMarkdown("- bullet\n1. numbered");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ ordered: false });
    expect(blocks[1]).toMatchObject({ ordered: true });
  });

  it("reads a rule as a rule, not a bullet", () => {
    expect(parseMarkdown("---")).toEqual([{ kind: "rule" }]);
  });

  it("joins a multi-line blockquote", () => {
    expect(parseMarkdown("> one\n> two")).toEqual([
      { kind: "quote", spans: [{ kind: "text", text: "one two" }] },
    ]);
  });

  it("handles a realistic agent message end to end", () => {
    const src = [
      "## Done — shipped and clean",
      "",
      "Two commits, both pushed:",
      "",
      "- `c6fe96ff` the guard",
      "- `f5cd200a` deployment record",
      "",
      "```bash",
      "git log --oneline",
      "```",
      "",
      "See [the run](https://ci.example.com/42) for details.",
    ].join("\n");

    expect(parseMarkdown(src).map((b) => b.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "code",
      "paragraph",
    ]);
  });

  it("empty input yields no blocks", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n  \n")).toEqual([]);
  });
});

// Tables were the worst thing on this screen as literal text: a phone re-wraps every `| a | b |` line
// mid-cell, so the grid dissolves. The parser's job is to recover the STRUCTURE — the renderer decides
// the shape (a real table when it fits, a card per row when it doesn't).
describe("parseMarkdown — tables", () => {
  const table = (src: string) => parseMarkdown(src)[0] as Extract<MdBlock, { kind: "table" }>;
  const texts = (spans: MdSpan[]) => spans.map((s) => ("text" in s ? s.text : "")).join("");

  it("parses a header row, its delimiter, and the body", () => {
    const t = table("| file | change |\n|---|---|\n| a.ts | fixed |\n| b.ts | dropped |");
    expect(t.kind).toBe("table");
    expect(t.headers.map(texts)).toEqual(["file", "change"]);
    expect(t.rows.map((r) => r.map(texts))).toEqual([
      ["a.ts", "fixed"],
      ["b.ts", "dropped"],
    ]);
  });

  it("accepts alignment markers and outer pipes being absent", () => {
    const t = table("a | b\n:--- | ---:\n1 | 2");
    expect(t.headers.map(texts)).toEqual(["a", "b"]);
    expect(t.rows.map((r) => r.map(texts))).toEqual([["1", "2"]]);
  });

  it("cells are inline-parsed, so a cell can hold code or a link", () => {
    const t = table("| what | where |\n|---|---|\n| `parseInline` | [docs](https://x.dev) |");
    expect(t.rows[0]![0]).toEqual([{ kind: "code", text: "parseInline" }]);
    expect(t.rows[0]![1]![0]).toMatchObject({ kind: "link", href: "https://x.dev" });
  });

  // Ragged rows are routine in agent output; the renderer must never have to index a hole.
  it("normalises every row to the header's column count", () => {
    const t = table("| a | b | c |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |");
    expect(t.rows.map((r) => r.length)).toEqual([3, 3]);
    expect(t.rows[0]!.map(texts)).toEqual(["1", "", ""]);
    expect(t.rows[1]!.map(texts)).toEqual(["1", "2", "3"]);
  });

  it("keeps an escaped pipe inside its cell instead of splitting on it", () => {
    const t = table("| cmd | note |\n|---|---|\n| a \\| b | piped |");
    expect(t.rows[0]!.map(texts)).toEqual(["a | b", "piped"]);
  });

  // The delimiter row is the whole discriminator — pipes alone are just prose (a shell pipeline).
  it("a pipe-bearing line with no delimiter row stays a paragraph", () => {
    expect(parseMarkdown("run `ls | wc -l` first").map((b) => b.kind)).toEqual(["paragraph"]);
  });

  it("a table directly after a paragraph line is not swallowed into it", () => {
    expect(parseMarkdown("Summary:\n| a | b |\n|---|---|\n| 1 | 2 |").map((b) => b.kind)).toEqual([
      "paragraph",
      "table",
    ]);
  });

  it("the table ends where its rows do", () => {
    expect(parseMarkdown("| a |\n|---|\n| 1 |\n\nAfter the table.").map((b) => b.kind)).toEqual([
      "table",
      "paragraph",
    ]);
  });
});
