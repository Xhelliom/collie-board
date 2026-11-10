# 27. 🔵 Image upload + clipboard paste as a hook, not composer-only code

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

Upstream can already paste a screenshot into the composer: it uploads the file and appends the
returned host path to the draft, because Herdr's socket carries no image and the agent reads one by
path. That round-trip is written *inside* `Composer`, so it is available to exactly one textarea —
and the second textarea that wants it has to copy forty lines or do without.

`useImageUpload` is the same code, moved. Same request, same append rule, same status sentence; the
composer now consumes it instead of owning it, and any other draft box gets a screenshot attachment
in three lines.

| | |
|---|---|
| Commit | `4ceb4ca` *feat(card): paste a screenshot into a new card, same upload as a session* |
| Files | `web/src/hooks/use-image-upload.ts` (new), `web/src/components/composer.tsx` (~40 lines out, one hook call in) |
| Extraction | **Clean cherry-pick minus the consumer.** The commit also wires the fork's `new-card-sheet.tsx`; drop that hunk and its test file and the rest applies as-is. |

**`paneId` is documented as the upload's OWNER, not a route.** The bridge only ever uses it for the
saved file's name prefix and the audit line, so a caller with no pane can pass a label and still get
an honestly-named file — that is what makes the hook reusable at all, and it is a property upstream
already has and does not state anywhere.

**The composer's own paste tests are untouched** and still pass against the hook, which is the
evidence the move was verbatim.

---
