# 0012 — The review is Markdown the app already renders

**Status:** Accepted

## Context

The copilot's post-`done` review writes a `notes` field the card shows under the verdict. The
content was good and the presentation was not: it read as one undifferentiated block of prose.

The reflex is to reach for a renderer. There already was one. `web/src/components/markdown-text.tsx`
has rendered `r.notes` since the copilot's first commit, and it handles headings, bullets, ordered
lists, fenced code blocks with a copy button, inline code, links, quotes, rules and tables. Nothing
was missing on the reading side. What was missing was on the writing side: `reviewPrompt` asked for
*"one short paragraph"* — precisely the one shape a Markdown renderer has nothing to do with. The
block of text was the prompt's output rendered faithfully.

So the real question was never "which renderer", it was **how far to push the format, and therefore
what the copilot must be told to produce**. Four candidates were on the table.

**HTML.** Rejected, and not on taste. Every string from an agent reaches the DOM as a text node in
this app — `MarkdownText`'s parser decides *structure*, never markup, and that is the repo's stated
XSS boundary (`CLAUDE.md` §"Security posture"). Rendering the review as HTML means one
`dangerouslySetInnerHTML` on a string a model wrote, on a screen whose sibling controls type into a
real terminal. The strict CSP would stop the scripts; it would not stop the rest. Sanitising instead
means a sanitiser dependency and a second, weaker boundary next to the one that already works.

**Diagrams (Mermaid, SVG).** Rejected. Two reasons, and the second is the one that would still hold
if the first were solved. First: Mermaid is ~1MB of JavaScript on a phone PWA, for a block that
appears on the fraction of cards that get a review — and it renders by injecting SVG markup, which
is the HTML problem wearing a different hat. Second, and decisively: **the review has nothing to
draw.** It reviews from `git diff --stat` and the handoff note, never the full diff — a deliberate
quota decision. A reviewer that has seen a list of filenames and a paragraph of prose cannot produce
an architecture diagram; it can only produce a plausible one, which is worse than none.

**Syntax highlighting in the fenced blocks.** Rejected for now. Another dependency (Shiki, Prism)
for content that is overwhelmingly a command to run or a single failing line, not a program. The
existing `<pre>` with the platform mono and a copy button is what those blocks need. The parser
already keeps the fence's `lang`, so this is one component away the day the content changes shape.

**Colour.** Retained, in one place only: the **verdict**. `complete` / `partial` / `drift` map onto
the three status colours the columns already use — green, amber, red. The verdict is the one line
you read before deciding whether to read the rest, and set as plain body text it was
indistinguishable from it. The notes body deliberately does NOT get a colour scheme of its own: a
second palette on the same screen makes the verdict stop meaning anything.

## Decision

**The review is Markdown, rendered by the reader the app already has.** No HTML, no diagram
library, no syntax highlighter, no prose theme.

The prompt (`notesRule`, `bridge/copilot.ts`) asks for the shape that reader renders: `### Done` and
`### Missing` sections, two to five bullets each, files and symbols in inline code, a fenced block
only to quote something verbatim, twenty lines as the ceiling. The two headings are named literally
so that two reviews of two cards read as one report rather than two essays.

Colour is spent on the verdict chip and nowhere else in the review.

## Consequences

- The rendering side needed no new code, and the fix landed where the defect actually was — in the
  prompt. The XSS boundary is untouched: it is still text nodes all the way down.
- **A review stored before this change stays readable**, for free and not by accident: a Markdown
  renderer given a plain paragraph renders a plain paragraph. No migration, no versioned notes
  field, no fallback branch to keep alive.
- The ceiling is a prompt instruction, not an enforced cap. A model that writes forty lines gets
  forty lines rendered. Accepted: truncating a review mid-sentence loses the half that says what is
  missing, and the failure mode of a long review is scrolling, not corruption.
- A verdict outside the three known words lands on the neutral pill rather than being colour-coded
  by a substring guess — `complete` is a substring of `not complete`, and a review painted green for
  saying the opposite is worse than one painted grey.
- What would justify revisiting: reviews that routinely carry real code (then syntax highlighting
  earns its dependency), or a review that is given the full diff (then there is something to draw,
  and the diagram question genuinely reopens).
