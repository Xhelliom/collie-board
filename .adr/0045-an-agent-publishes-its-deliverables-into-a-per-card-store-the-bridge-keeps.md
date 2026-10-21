# 0045 — An agent publishes its deliverables into a per-card store the bridge keeps

**Status:** Accepted
**Date:** 2026-10-21

## Context

What an agent generates for a card — an image, an animation, a PDF, a spreadsheet, a report — was
lost with its session. The board already reads two places, and neither is durable:

- `bridge/artifacts.ts` reads the card's **worktree**, which is gone after the merge and the cleanup;
- `bridge/gallery.ts` reads the harness **scratchpad** under `/tmp/claude-<uid>`, which is ephemeral.

## Decision

A third store, kept by the bridge: `<stateDir>/deliverables/<cardId>/<name>`, the same state dir as
`uploads/` (and therefore in the backup). The **file is the truth** — no table, the listing is the
directory; who published it is read from the card's journal (`deliverable.published`). It is
deleted with the card (the card route, plus a sweep of orphaned stores at boot for the deletes that
bypass it). No TTL.

- **Publish**: `POST /api/cards/<id>/deliverables?name=<name>`, body = the raw bytes
  (`curl --data-binary @file`). `write` guard, 25 MB cap, the name sanitised to one safe basename
  (no hidden file, a `-2` suffix when taken). Provenance is derived from `x-collie-pane`
  ([ADR 0010](./0010-an-agent-filed-card-is-traced-on-the-card.md)), never declared.
- **Read**: `GET …/deliverables` lists `{name, size, mime, publishedAt, by}`; `GET …/deliverables/<name>`
  serves one under gallery.ts's rule — one root, realpath on both sides, `containedIn`.
- **Rendering by extension, never by content**: PNG/JPEG/GIF/WebP inline; Markdown as text; HTML
  scrubbed (`scrub.ts`) under a `sandbox` CSP; PDF inline under a `sandbox` CSP; everything else
  `Content-Disposition: attachment` + `application/octet-stream`. `nosniff` on all of them.
- **Delete**: `DELETE …/deliverables/<name>`, `write` guard.

## What is refused, and why

- **The bridge never reads a path the client gives it.** "Publish `/home/me/x.png`" would turn the
  route into "read any file the bridge user can read" for anything that can reach it. The bytes come
  in the body; the agent's own `curl` reads its own file.
- **SVG.** An image to `<img>`, a script host to a top-level navigation — and this origin serves the
  app. Refused at publish (415); publish a PNG.
- **Serving a name the store could not have written.** A path segment that does not survive
  `sanitizeName` unchanged is a 404 before the filesystem is touched; a symlink planted in the store
  resolves outside it and is a 404 too.
- **Reading the worktree or the scratchpad instead.** Both disappear on their own schedule, which is
  the problem this store exists to solve.
