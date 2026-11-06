# 0053 — A custom page is served inert, under its own CSP, never the board's

**Status:** Accepted
**Date:** 2026-11-06

## Context

Some projects need a page nothing generic covers (a marketing plan, an art direction). An agent
writes it as `docs/pages/<name>.html` in the repo, and the project views show one tab per file, read
from the default branch like the Documents page. That HTML is **untrusted**: an agent wrote it, and
a repo can be anyone's. The board's CSP (`server.ts`) allows `script-src 'self'` and
`connect-src 'self'` — a page served under it, same-origin, could read the board and call `/api`.

The tempting options: loosen the board's CSP so the page can run, render it inline in the app, or
let it run scripts in a sandbox "because the origin is opaque anyway".

## Decision

- The page is served by its own route, `GET /api/docs/page?repo=&name=`, with **its own CSP**:
  `sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; …`.
  The board's CSP is set on the app's static files only, so it is untouched; `checkAccess` is
  untouched too (the route takes `ctx.guard("read")` like every board route).
- The bytes go through `scrubHtml` (the artifacts/gallery rule) — scripts, frames, external
  stylesheets and `on*` attributes are dropped before they leave the host.
- The app frames it in an `<iframe sandbox="">`: **no** `allow-same-origin`, **no** `allow-scripts`.
  Three locks on the same door: no script survives the scrub, none would run under the sandbox, and
  a request from the opaque origin carries `Origin: null`, which `checkAccess` refuses.
- A page is self-contained: inline CSS, `data:` images. Nothing is fetched from outside.

## Consequences

- A custom page cannot be interactive (no script, no form). A chart is an inline SVG; a tab strip is
  CSS. If one day a page truly needs script, the way is `allow-scripts` on the iframe **and** in the
  CSP's `sandbox`, still never `allow-same-origin` — not the board's CSP.
- A link inside the page cannot navigate the board (no `allow-top-navigation`); a link to the web
  does nothing useful. Pages are documents, not portals.
- The board's CSP never grows a `frame-src` exception or an `unsafe-*` for this — reopening that is
  reopening this ADR.
