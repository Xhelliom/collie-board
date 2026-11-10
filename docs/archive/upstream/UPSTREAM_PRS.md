# Upstream PR ledger

> **Frozen — [ADR 0059](../../../.adr/0059-le-fork-est-independant-ni-briques-proposees-ni-rebase.md) (2026-11-10).** The fork is
> independent: no brick is offered upstream and nothing is rebased. This file is an archive; don't update it.

The work in this fork that belongs to [`AltanS/collie`](https://github.com/AltanS/collie) rather
than to the board, with the commits that carry it. Strategy and posture live in
[`UPSTREAM.md`](../../../UPSTREAM.md); this file is the queue.

**Keep it current.** A brick lands here in the same commit that introduces it — see
[`CLAUDE.md`](../../../CLAUDE.md) → *The board*. A ledger updated afterwards is a ledger nobody trusts.

**One brick, one file**: `prs/NN-<slug>.md`, and its `## NN. <status> <title>` heading
here linking to it. A status change edits the emoji in both titles.

> ⚠️ **This repo is a standalone fork, not a GitHub fork object**, so a PR cannot be opened from it
> (GitHub requires the head repo to be a fork of the base). To submit: fork `AltanS/collie` on
> GitHub, add it as a third remote, cherry-pick onto a branch there, open the PR. That is why the
> **Extraction** column below matters — it says whether a brick is one `git cherry-pick` or a
> re-assembly.

Status: 🔵 ready · 🟡 needs extraction · ⚪ not started · 🟢 submitted · ✅ merged · ⛔️ moot — upstream already has it, arrived there without us

---

## 1. 🔵 `collie-ctl.sh` — three ways `start` breaks on a standard install

→ [`prs/01-collie-ctl-sh-three-ways-start-breaks-on-a-stand.md`](prs/01-collie-ctl-sh-three-ways-start-breaks-on-a-stand.md)

## 2. 🟡 Context gauge, and `$ctx` in herdr's own sidebar

→ [`prs/02-context-gauge-and-ctx-in-herdr-s-own-sidebar.md`](prs/02-context-gauge-and-ctx-in-herdr-s-own-sidebar.md)

## 3. 🟡 Find a pane's transcript without the integration — **fixes History for most users**

→ [`prs/03-find-a-pane-s-transcript-without-the-integration.md`](prs/03-find-a-pane-s-transcript-without-the-integration.md)

## 4. 🟡 Two herdr races every agent launcher hits

→ [`prs/04-two-herdr-races-every-agent-launcher-hits.md`](prs/04-two-herdr-races-every-agent-launcher-hits.md)

## 5. 🔵 Wrap the pane mirror by default on a phone

→ [`prs/05-wrap-the-pane-mirror-by-default-on-a-phone.md`](prs/05-wrap-the-pane-mirror-by-default-on-a-phone.md)

## 6. 🔵 The frontend test suite is broken by Node 24+

→ [`prs/06-the-frontend-test-suite-is-broken-by-node-24.md`](prs/06-the-frontend-test-suite-is-broken-by-node-24.md)

## 7. ⚪ Diff view on the focused pane's `cwd`

→ [`prs/07-diff-view-on-the-focused-pane-s-cwd.md`](prs/07-diff-view-on-the-focused-pane-s-cwd.md)

## 8. ⚪ TOML agent adapters

→ [`prs/08-toml-agent-adapters.md`](prs/08-toml-agent-adapters.md)

## 9. 🔵 The bottom sheet closes on a scroll, and vanishes instead of closing

→ [`prs/09-the-bottom-sheet-closes-on-a-scroll-and-vanishes.md`](prs/09-the-bottom-sheet-closes-on-a-scroll-and-vanishes.md)

## 10. 🔵 Three one-line finishes: `text-wrap`, scroll-snap, haptic confirm

→ [`prs/10-three-one-line-finishes-text-wrap-scroll-snap-ha.md`](prs/10-three-one-line-finishes-text-wrap-scroll-snap-ha.md)

## 11. 🔵 `recent_unwrapped` behind the raw-terminal toggle (+ the wire name is snake_case)

→ [`prs/11-recent-unwrapped-behind-the-raw-terminal-toggle.md`](prs/11-recent-unwrapped-behind-the-raw-terminal-toggle.md)

## 12. 🔵 Three accessibility holes: a heading per screen, a reachable dismiss, a barrier per route

→ [`prs/12-three-accessibility-holes-a-heading-per-screen-a.md`](prs/12-three-accessibility-holes-a-heading-per-screen-a.md)

## 13. 🟡 A type scale, a font decision, and named motion curves

→ [`prs/13-a-type-scale-a-font-decision-and-named-motion-cu.md`](prs/13-a-type-scale-a-font-decision-and-named-motion-cu.md)

## 14. 🟡 A desktop mode: sheets from the right, lists that use the width, a reactive `useMediaQuery`

→ [`prs/14-a-desktop-mode-sheets-from-the-right-lists-that.md`](prs/14-a-desktop-mode-sheets-from-the-right-lists-that.md)

## 15. 🔵 A reading mode for the pane screen (and the `after` cursor it needs)

→ [`prs/15-a-reading-mode-for-the-pane-screen-and-the-after.md`](prs/15-a-reading-mode-for-the-pane-screen-and-the-after.md)

## 16. 🔵 Which pane am I in? (and a breadcrumb segment that switches within the space)

→ [`prs/16-which-pane-am-i-in-and-a-breadcrumb-segment-that.md`](prs/16-which-pane-am-i-in-and-a-breadcrumb-segment-that.md)

## 17. 🔵 Slash commands completed as you type, not only from the sheet

→ [`prs/17-slash-commands-completed-as-you-type-not-only-fr.md`](prs/17-slash-commands-completed-as-you-type-not-only-fr.md)

## 18. 🔵 A bell: what pinged, after the notification is gone

→ [`prs/18-a-bell-what-pinged-after-the-notification-is-gon.md`](prs/18-a-bell-what-pinged-after-the-notification-is-gon.md)

## 19. 🔵 The foreground notification is a toast, and it says which pane

→ [`prs/19-the-foreground-notification-is-a-toast-and-it-sa.md`](prs/19-the-foreground-notification-is-a-toast-and-it-sa.md)

## 20. 🔵 A refusal the bridge wrote is shown as the bridge wrote it

→ [`prs/20-a-refusal-the-bridge-wrote-is-shown-as-the-bridg.md`](prs/20-a-refusal-the-bridge-wrote-is-shown-as-the-bridg.md)

## 21. 🟡 The pictures an agent makes are unlookable-at from a phone

→ [`prs/21-the-pictures-an-agent-makes-are-unlookable-at-fr.md`](prs/21-the-pictures-an-agent-makes-are-unlookable-at-fr.md)

## 22. 🔵 `idle` and `done`, with a since

→ [`prs/22-idle-and-done-with-a-since.md`](prs/22-idle-and-done-with-a-since.md)

## 23. 🟡 How much Claude Code quota is used, on the dashboard

→ [`prs/23-how-much-claude-code-quota-is-used-on-the-dashbo.md`](prs/23-how-much-claude-code-quota-is-used-on-the-dashbo.md)

## 24. 🔵 A notification whose subject is the work, not the worker

→ [`prs/24-a-notification-whose-subject-is-the-work-not-the.md`](prs/24-a-notification-whose-subject-is-the-work-not-the.md)

## 25. 🔵 One composition for all three notification surfaces

→ [`prs/25-one-composition-for-all-three-notification-surfa.md`](prs/25-one-composition-for-all-three-notification-surfa.md)

## 26. 🔵 The multi-agent digest counts what is waiting, not how many agents

→ [`prs/26-the-multi-agent-digest-counts-what-is-waiting-no.md`](prs/26-the-multi-agent-digest-counts-what-is-waiting-no.md)

## 27. 🔵 Image upload + clipboard paste as a hook, not composer-only code

→ [`prs/27-image-upload-clipboard-paste-as-a-hook-not-compo.md`](prs/27-image-upload-clipboard-paste-as-a-hook-not-compo.md)

## 28. 🔵 A notification coordinator that doesn't assume its alerts are panes

→ [`prs/28-a-notification-coordinator-that-doesn-t-assume-i.md`](prs/28-a-notification-coordinator-that-doesn-t-assume-i.md)

## 29. ⛔️ A long reply is typed into the pane and never submitted — **upstream fixed it first**

→ [`prs/29-a-long-reply-is-typed-into-the-pane-and-never-su.md`](prs/29-a-long-reply-is-typed-into-the-pane-and-never-su.md)

## 30. 🔵 Cursor is missing from every agent table, and Codex's reset command is wrong

→ [`prs/30-cursor-is-missing-from-every-agent-table-and-cod.md`](prs/30-cursor-is-missing-from-every-agent-table-and-cod.md)

## 31. 🔵 `agent_session.kind === "path"` — the half of herdr's enum Collie drops

→ [`prs/31-agent-session-kind-path-the-half-of-herdr-s-enum.md`](prs/31-agent-session-kind-path-the-half-of-herdr-s-enum.md)

## 32. 🔵 The pane list is flat — nothing says which space a pane is in

→ [`prs/32-the-pane-list-is-flat-nothing-says-which-space-a.md`](prs/32-the-pane-list-is-flat-nothing-says-which-space-a.md)

## 33. 🔵 A worktree floats beside the repo it was cut from, and the Spaces screen shows neither

→ [`prs/33-a-worktree-floats-beside-the-repo-it-was-cut-fro.md`](prs/33-a-worktree-floats-beside-the-repo-it-was-cut-fro.md)

## 34. 🔵 Two branches in flight always conflict — over the version, not the code

→ [`prs/34-two-branches-in-flight-always-conflict-over-the.md`](prs/34-two-branches-in-flight-always-conflict-over-the.md)

## 35. 🔵 The ctl lifecycle tests inherit the service's config

→ [`prs/35-the-ctl-lifecycle-tests-inherit-the-service-s-co.md`](prs/35-the-ctl-lifecycle-tests-inherit-the-service-s-co.md)

## 36. 🟡 Long lists fold to their newest few, with a « Voir les n autres » toggle

→ [`prs/36-long-lists-fold-to-their-newest-few-with-a-voir.md`](prs/36-long-lists-fold-to-their-newest-few-with-a-voir.md)

## 37. 🔵 The web bundle goes out gzipped, precompressed at build

→ [`prs/37-the-web-bundle-goes-out-gzipped-precompressed-at.md`](prs/37-the-web-bundle-goes-out-gzipped-precompressed-at.md)

## 38. 🔵 The transcript's timestamps reuse one formatter

→ [`prs/38-the-transcript-s-timestamps-reuse-one-formatter.md`](prs/38-the-transcript-s-timestamps-reuse-one-formatter.md)

## 39. 🔵 A screen already seen opens at once, and a touched link starts loading

→ [`prs/39-a-screen-already-seen-opens-at-once-and-a-touche.md`](prs/39-a-screen-already-seen-opens-at-once-and-a-touche.md)

## 40. 🟡 Which agents have subagents running

→ [`prs/40-which-agents-have-subagents-running.md`](prs/40-which-agents-have-subagents-running.md)

## 41. 🟡 A followed pane's history answers 304, and an idle pane polls slow

→ [`prs/41-a-followed-pane-s-history-answers-304-and-an-idl.md`](prs/41-a-followed-pane-s-history-answers-304-and-an-idl.md)

## 42. 🟡 One status line for the whole app, above the tab bar and the composer

→ [`prs/42-one-status-line-for-the-whole-app-above-the-tab.md`](prs/42-one-status-line-for-the-whole-app-above-the-tab.md)

## 43. 🟡 `ctl.ts` — the plugin actions on Windows, under one command per id

→ [`prs/43-ctl-ts-the-plugin-actions-on-windows-under-one-c.md`](prs/43-ctl-ts-the-plugin-actions-on-windows-under-one-c.md)

## 44. 🟡 Idle screens — a Claude dialog herdr calls `idle` reads `blocked`

→ [`prs/44-idle-screens-a-claude-dialog-herdr-calls-idle-re.md`](prs/44-idle-screens-a-claude-dialog-herdr-calls-idle-re.md)

## 46. 🟡 AskUserQuestion — the whole question, and its free-text row

→ [`prs/46-askuserquestion-the-whole-question-and-its-free.md`](prs/46-askuserquestion-the-whole-question-and-its-free.md)

## Never offer as one PR

→ [`prs/45-never-offer-as-one-pr.md`](prs/45-never-offer-as-one-pr.md)
