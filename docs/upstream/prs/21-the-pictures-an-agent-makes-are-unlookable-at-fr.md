# 21. 🟡 The pictures an agent makes are unlookable-at from a phone

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../../../UPSTREAM_PRS.md), qui en est le sommaire.

An agent that generates images — a render, a chart, a mock — writes them into its scratchpad and then
*describes them in prose*, which is the one output a phone client turns back into nothing. The
transcript shows `Read /…/scratchpad/render.png`: the path of a file the operator cannot open. This
adds the two views that make them visible, over one read-only route.

| | |
|---|---|
| Commit | _(this change)_ |
| Files | `bridge/gallery.ts` + `bridge/gallery.test.ts` (new), `bridge/server.ts` (one import + one dispatch block), `bridge/transcript.ts` (`toolImagePath()` + `toolResultImage()` + the tool part's `image`), `web/src/{components/image-lightbox,routes/gallery}.tsx` + `web/src/lib/lightbox.ts` (new), `web/src/components/{transcript-view,agent-chat}.tsx`, `web/src/routes/{history,settings}.tsx`, `web/src/lib/{api,loaders,types,nav}.ts`, `web/src/router.tsx`, `web/src/test/setup.ts` |
| Extraction | **Needs extraction.** The new files lift cleanly, but the wiring is spread over ten upstream files and the gallery row lands in a `settings.tsx` the fork has already edited. No card in sight, though — none of this knows the board exists. |

Two views over the same files. **Inline**: a tool call whose `file_path` is a servable image renders
the picture instead of the tool line; a picture the tool *returned* — a browser screenshot, which is a
base64 block in the `tool_result` and never a file — rides in the page as a `data:` URL (gallery types
only, 1 MB cap) and renders under its call. **A gallery**: every scratchpad image, grouped by session,
from Settings. Both open one full-screen viewer that swipes through the set — a session's eight
variants are eight swipes, not eight taps in and out. The pane's ⋯ sheet reaches the same set
without going through History — that screen holds no transcript (the mirror is a terminal snapshot),
so the row fetches one on demand and says so when the session made no pictures.

The viewer is `<dialog showModal()>` plus CSS scroll snapping, so the modal layer and the whole
gesture (momentum, rubber-banding, interruption) are the platform's, not ours — the same reasoning
that put Vaul under the sheets. It unmounts while the idle cover is up, because the top layer paints
above the cover no matter what z-index the cover carries.

**The security shape is the part worth reviewing.** The route hands file bytes to the tailnet, so it
has exactly one root — `/tmp/claude-<uid>`, fixed, with no client-supplied component — and serves a
path only if its `realpath` still lands under the root's `realpath`. Resolving first is the point: an
image-named symlink planted in a scratchpad is the obvious way to turn this into "read any file the
bridge user can read", and comparing the paths as written waves it straight through. The listing walk
doesn't follow links at all, and SVG is excluded (an image to `<img>`, a script host to a top-level
navigation on an origin that also serves the app). `gallery.test.ts` drives all of that against a
real directory tree, symlink included — a fake fs would only prove the code agrees with itself.

---
