import { createContext, useContext, useMemo } from "react";
import { Check, Copy } from "lucide-react";

import { parseMarkdown, type MdBlock, type MdSpan } from "@/lib/markdown";
import { splitHighlight } from "@/lib/transcript-search";
import { COPY_UNAVAILABLE_TITLE, useCopy } from "@/hooks/use-copy";

// Renders the Markdown AST as React elements. Every string from the log reaches the DOM as a TEXT
// NODE — there is no `dangerouslySetInnerHTML` here and there must never be one. That is the repo's
// XSS boundary (CLAUDE.md §"Security posture"): the parser decides *structure*, never markup, so a
// transcript containing `<script>` renders those characters and nothing executes.
//
// Sizing/colour deliberately track the surrounding transcript styles rather than introducing a
// prose theme — this is a reading view inside a terminal-ish app, not a document viewer.

// The active find query, threaded via context rather than a prop drilled through every nested span —
// highlighting is a cross-cutting display concern, and the AST walk is already recursive.
const QueryContext = createContext("");

/** Literal text with find hits marked. Still text nodes — `<mark>` is structure, never parsed markup. */
function Hit({ text }: { text: string }) {
  const query = useContext(QueryContext);
  if (query.trim() === "") return <>{text}</>;
  const pieces = splitHighlight(text, query);
  if (pieces.length === 1 && !pieces[0]!.hit) return <>{text}</>;
  return (
    <>
      {pieces.map((piece, i) =>
        piece.hit ? (
          <mark key={i} className="rounded-sm bg-find-hit text-inherit">
            {piece.text}
          </mark>
        ) : (
          <span key={i}>{piece.text}</span>
        ),
      )}
    </>
  );
}

// Emphasis and links hold child spans (agents nest them — ``**`sha`**`` is routine), so this recurses
// through <Spans>. `code` is the leaf.
function Span({ span }: { span: MdSpan }) {
  switch (span.kind) {
    case "bold":
      return (
        <strong className="font-semibold">
          <Spans spans={span.spans} />
        </strong>
      );
    case "italic":
      return (
        <em className="italic">
          <Spans spans={span.spans} />
        </em>
      );
    case "code":
      return (
        <code className="code-inline rounded bg-muted px-1 py-0.5 font-mono break-all">
          <Hit text={span.text} />
        </code>
      );
    case "link":
      // `href` was scheme-checked in the parser. noreferrer/noopener because these URLs come from
      // agent output, and target=_blank keeps the PWA shell alive behind the tap.
      return (
        <a
          href={span.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 break-all"
        >
          <Spans spans={span.spans} />
        </a>
      );
    default:
      return <Hit text={span.text} />;
  }
}

const Spans = ({ spans }: { spans: MdSpan[] }) => (
  <>
    {spans.map((span, i) => (
      <Span key={i} span={span} />
    ))}
  </>
);

// A code block plus its own copy button — the AST already holds the block's text verbatim, so
// copying is just handing it to the clipboard. `pr-8` on the <pre> keeps a long first line from
// running under the button; the button sits on the outer wrapper (not the scrolling <pre>), so it
// stays put regardless of horizontal scroll.
function CodeBlock({ text }: { text: string }) {
  const { canCopy, copied, copy } = useCopy();
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border bg-muted/50 px-2 py-1.5 pr-8 font-mono text-xs leading-snug">
        <Hit text={text} />
      </pre>
      <button
        type="button"
        disabled={!canCopy}
        onClick={() => copy(text)}
        aria-label={copied ? "Copied" : "Copy code block"}
        title={canCopy ? "Copy" : COPY_UNAVAILABLE_TITLE}
        className="absolute right-1 top-1 flex size-6 items-center justify-center rounded text-muted-foreground/70 transition-colors active:bg-muted disabled:pointer-events-none disabled:opacity-50"
      >
        {copied ? (
          <Check className="size-3.5 text-status-working" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </div>
  );
}

/**
 * Widest table that still reads as a table on a phone.
 *
 * Three ~110px columns fit a 360px screen with the text still wrapping inside its cell. Past that the
 * grid is a horizontal pan, and a pan is exactly what this whole screen exists to remove — so a wide
 * table becomes one CARD PER ROW instead, each cell labelled by its header. The decision is made from
 * the column count rather than a measurement: the AST already knows it, and a resize-observed table
 * that reshapes under the reader is worse than one that picked a form and kept it.
 */
const MAX_TABLE_COLS = 3;

function TableBlock({ block }: { block: Extract<MdBlock, { kind: "table" }> }) {
  // Rows are already normalised to the header count (lib/markdown.ts), so a cell is never a hole.
  if (block.headers.length > MAX_TABLE_COLS) {
    return (
      <div className="space-y-1.5">
        {block.rows.map((row, r) => (
          <div key={r} className="space-y-0.5 rounded-md border bg-muted/30 px-2.5 py-2 text-sm">
            {row.map((cell, c) => (
              <div key={c} className="flex gap-2">
                <span className="w-1/3 shrink-0 font-medium text-muted-foreground">
                  <Spans spans={block.headers[c] ?? []} />
                </span>
                <span className="min-w-0 flex-1">
                  <Spans spans={cell} />
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }
  // Its own scroller, the pattern code blocks already use — a stubborn table scrolls itself rather
  // than pushing the page sideways.
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {block.headers.map((cell, c) => (
              <th key={c} className="border-b px-2 py-1 text-left align-top font-semibold">
                <Spans spans={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border-b border-border/40 px-2 py-1 align-top">
                  <Spans spans={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Each level sits a rung above the body it introduces, which now reads at text-base (R2). The old
// ladder ran 16/15/14px — h1 level with the surrounding prose and h3 below it, so a heading marked
// a paragraph rather than opening a section.
const HEADING_CLASS: Record<number, string> = {
  1: "text-xl font-semibold",
  2: "text-lg font-semibold",
  3: "text-base font-semibold",
};

function Block({ block }: { block: MdBlock }) {
  switch (block.kind) {
    case "heading": {
      // Levels 4-6 are rare in agent prose and don't earn another size step on a phone — they ride
      // the body rung and let the weight carry the distinction.
      const cls = HEADING_CLASS[block.level] ?? "text-base font-semibold";
      return (
        <div className={`${cls} mt-1 leading-snug`}>
          <Spans spans={block.spans} />
        </div>
      );
    }
    case "code":
      return <CodeBlock text={block.text} />;
    case "table":
      return <TableBlock block={block} />;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          className={`ml-4 space-y-0.5 ${block.ordered ? "list-decimal" : "list-disc"} marker:text-muted-foreground`}
        >
          {block.items.map((item, i) => (
            <li key={i} className="pl-0.5">
              <Spans spans={item} />
            </li>
          ))}
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote className="border-l-2 pl-2.5 text-muted-foreground italic">
          <Spans spans={block.spans} />
        </blockquote>
      );
    case "rule":
      return <hr className="border-border" />;
    default:
      return (
        <p className="leading-relaxed">
          <Spans spans={block.spans} />
        </p>
      );
  }
}

/**
 * Render agent prose as formatted Markdown. Memoised on the source string: a transcript page holds
 * dozens of these and the parse is pure, so re-parsing on every unrelated re-render is pure waste.
 */
export function MarkdownText({
  text,
  className,
  query = "",
}: {
  text: string;
  className?: string;
  /** Active find query — occurrences render as marks. Empty disables highlighting entirely. */
  query?: string;
}) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <QueryContext.Provider value={query}>
      {/* text-base, not text-sm: this is the body of a message — the thing you actually read on
          this screen — not a caption around it (R2). */}
      <div className={`space-y-2 text-base break-words ${className ?? ""}`}>
        {blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>
    </QueryContext.Provider>
  );
}
