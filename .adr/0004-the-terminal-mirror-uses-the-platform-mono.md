# 0004 — The terminal mirror uses the platform's mono

- **Status:** Accepted
- **Date:** 2026-07-30
- **Shipped in:** 0.61.0

## Context

`--font-mono` opened with `"JetBrains Mono"` from the first commit that set it, and JetBrains Mono
was **never shipped**: no `@font-face` anywhere in `web/`, no `<link rel="preload">` in
`index.html`, no `.woff2` in `public/`, nothing in the service worker's precache manifest. The name
sat first in the stack and every device fell straight past it to whatever came next — `ui-monospace`
on iOS/macOS, Roboto Mono on Android, Consolas or Liberation Mono elsewhere.

So the pane mirror, the transcript, every diff and every code block — the monospace surface that is
the centre of this app — rendered in a **different face per device**, while the CSS asserted
otherwise. The UI audit (`UI_AUDIT.md` §7 R3) called this state the worst of the three available,
and it was right for a reason that is not about typography: it is a decision that *reads* as made
and has no effect. Anyone auditing the theme sees a considered choice; anyone reading the rendered
page sees the system font. The two never meet, and nothing in CI could catch the gap.

Three options were actually on the table:

1. **Self-host it.** `@fontsource-variable/jetbrains-mono`, ~35 kB of woff2 into `public/`,
   `@font-face` + preload, and a precache entry. The strict CSP is not an obstacle — there is no
   `font-src` directive, so fonts fall to `default-src 'self'`, which self-hosting satisfies.
   Feasible; the cost is a versioned binary, an OFL licence to carry, and 35 kB on first load.
2. **Keep the name, keep not loading it.** The status quo. Rejected on the reasoning above.
3. **Name the system stack and mean it.**

## Decision

**Declare the platform's own monospace stack, and load nothing.** `--font-mono` leads with
`ui-monospace`, which resolves to the face each OS ships *for exactly this purpose* — SF Mono on
Apple platforms, with named fallbacks behind it for the rest.

Two arguments carry it. The narrow one: a system mono already carries the optical sizing, hinting
and metrics the device was tuned for, and a web font has to beat that before it earns 35 kB and a
binary in the tree. The broad one: this app is served over a tailnet to its owner's phone, and no
part of its value depends on the terminal mirror looking identical on two devices — it depends on
the mirror being *legible* on the one in your hand, which the platform font already delivers.

`--font-sans` is declared in the same block for the same reason, even though it only restates the
system stack. An inherited default is not a decision; a written one is, and the next person to
touch it will know that.

## Consequences

- The mirror still differs per device — but that is now the decision, stated in the theme, instead
  of an accident hiding behind a name. **This is the point, not a residual cost.**
- Nothing to preload, precache, license, or update. The font can never be the thing that broke a
  cold load on a weak tailnet link.
- **Ligatures are gone as an option** for anyone who wanted `!=` and `=>` to knit. No system mono
  ships them. That is the real thing this ADR closes off.
- Both font stacks live in a plain `@theme`, not the file's `@theme inline` block: `inline` keeps
  the variable out of `:root`, and Preflight's `--default-font-family` has to resolve `--font-sans`
  there for the document to pick it up at all. Moving them back into the inline block would
  silently revert this decision while looking like a tidy-up.

**What would justify revisiting it:** a legibility complaint traced to a specific platform's mono
(the tiebreaker is the mirror at phone size, not a specimen sheet), or Collie growing a desktop
surface where a shared face across machines starts to carry real weight. Either way the work is
option 1 above, which stays cheap — it is one dependency, one `@font-face`, one preload, and the
CSP already permits it.
