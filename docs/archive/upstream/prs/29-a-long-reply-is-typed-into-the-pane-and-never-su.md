# 29. ⛔️ A long reply is typed into the pane and never submitted — **upstream fixed it first**

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

**No PR, and none is possible: upstream already has this, in a stronger form, since before we wrote
ours.** Checked against `upstream/main` on 2026-09-01, after `eee02eb` landed. Both halves of our fix
exist there:

| | | |
|---|---|---|
| [`29bca11`](https://github.com/AltanS/collie/commit/29bca11b165ddd5b79e070619138735647121ac4) | 2026-08-06 | *fix(guard): read Claude's paste placeholder as send evidence for long replies* |
| [`a557762`](https://github.com/AltanS/collie/commit/a55776269f00ae97a0c353633515ce1ea431bf8f) | 2026-08-09 | *fix(web): make the reply guard's input-box detection width-independent* (their issue #76) |

Shipped in `v1.0.0-beta.45`, and in `v1.0.2`, upstream's current release. Their reasoning is recorded
as **their** ADR 0010 (`.adr/0010-long-sends-are-verified-via-the-paste-placeholder.md`), and it names
the same two failures we hit, from the same screen: the placeholder the literal match structurally
cannot see, and a `MAX_DRAFT_LINES` of 12 that a wide-glyph draft blows past.

We did not know, because these six files have moved a long way upstream since the fork point —
`reply-action.ts` is 499 lines there against our 158 — so the fork never inherited the fix, hit the
bug on its own, and solved it again. A cherry-pick of `eee02eb` onto `upstream/main` conflicts in all
six files; the "clean cherry-pick" this entry claimed when it was written was wrong, and there is
nothing to extract regardless.

**Upstream's version is better than ours, and this is the part that matters when we rebase.** Their
adapter hook is `draftCarriesSend?(sent, draft)`, consulted only after the generic match fails, and
its contract is strict-or-false: it accepts a placeholder only when the token is CONSISTENT with the
message just typed — a collapse has to be plausible for a send that size, the token may not claim more
newlines than we sent, and any literal tail beside the token has to be the END of our message (their
#110, a half-arrived send that fired Enter). Ours is `isCollapsedDraft(draft)`, which reads the shape
of the string and nothing else. **Their rule 1 names our hole exactly**: a stale token from an earlier
paste vouches for a short message that never landed, and the guard presses Enter into whatever has
focus. We argued the composer's pre-clear sweep makes that unreachable. That is an argument, not the
check they wrote. They also carry a second member, `draftIsOpaque?(draft)`, which stands "Take over"
down on a stranded placeholder — the wart we knowingly skipped.

## What comes OUT of the fork when we take upstream's version

Nothing here is a permanent local patch to maintain — it is a duplicate of upstream work, and the
whole of it is deletable the day these six files are rebased onto `upstream/main`:

- `isCollapsedDraft` in `web/src/lib/harness/claude/chrome.ts`, its member on `HarnessAdapter`
  (`web/src/lib/harness/types.ts`), its wiring in `web/src/lib/harness/claude/index.ts`, and the
  `draft !== null && adapter.isCollapsedDraft(draft)` arm in `web/src/lib/reply-action.ts` — all
  superseded by their `draftCarriesSend?` / `draftIsOpaque?` pair and `harness/claude/paste.ts`.
- Our `MAX_DRAFT_LINES = 64` — superseded by their 100, which also counts blank-line skips against
  the same cap (ours does not).
- The tests that pin our version: the `isCollapsedDraft` and `MAX_DRAFT_LINES` blocks in
  `chrome.test.ts`, and the two collapsed-chip cases in `reply-action.test.ts`.

Take theirs whole rather than reconciling the two — the delta they close is the placeholder
consistency check, which is a correctness gap, not a style difference.
