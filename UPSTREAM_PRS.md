# Upstream PR ledger

The work in this fork that belongs to [`AltanS/collie`](https://github.com/AltanS/collie) rather
than to the board, with the commits that carry it. Strategy and posture live in
[`UPSTREAM.md`](./UPSTREAM.md); this file is the queue.

**Keep it current.** A brick lands here in the same commit that introduces it — see
[`CLAUDE.md`](./CLAUDE.md) → *The board*. A ledger updated afterwards is a ledger nobody trusts.

**One brick, one file**: `docs/upstream/prs/NN-<slug>.md`, and its `## NN. <status> <title>` heading
here linking to it. A status change edits the emoji in both titles.

> ⚠️ **This repo is a standalone fork, not a GitHub fork object**, so a PR cannot be opened from it
> (GitHub requires the head repo to be a fork of the base). To submit: fork `AltanS/collie` on
> GitHub, add it as a third remote, cherry-pick onto a branch there, open the PR. That is why the
> **Extraction** column below matters — it says whether a brick is one `git cherry-pick` or a
> re-assembly.

Status: 🔵 ready · 🟡 needs extraction · ⚪ not started · 🟢 submitted · ✅ merged · ⛔️ moot — upstream already has it, arrived there without us

---

## 1. 🔵 `collie-ctl.sh` — three ways `start` breaks on a standard install

→ [`docs/upstream/prs/01-collie-ctl-sh-three-ways-start-breaks-on-a-stand.md`](docs/upstream/prs/01-collie-ctl-sh-three-ways-start-breaks-on-a-stand.md)

## 2. 🟡 Context gauge, and `$ctx` in herdr's own sidebar

→ [`docs/upstream/prs/02-context-gauge-and-ctx-in-herdr-s-own-sidebar.md`](docs/upstream/prs/02-context-gauge-and-ctx-in-herdr-s-own-sidebar.md)

## 3. 🟡 Find a pane's transcript without the integration — **fixes History for most users**

→ [`docs/upstream/prs/03-find-a-pane-s-transcript-without-the-integration.md`](docs/upstream/prs/03-find-a-pane-s-transcript-without-the-integration.md)

## 4. 🟡 Two herdr races every agent launcher hits

→ [`docs/upstream/prs/04-two-herdr-races-every-agent-launcher-hits.md`](docs/upstream/prs/04-two-herdr-races-every-agent-launcher-hits.md)

## 5. 🔵 Wrap the pane mirror by default on a phone

→ [`docs/upstream/prs/05-wrap-the-pane-mirror-by-default-on-a-phone.md`](docs/upstream/prs/05-wrap-the-pane-mirror-by-default-on-a-phone.md)

## 6. 🔵 The frontend test suite is broken by Node 24+

→ [`docs/upstream/prs/06-the-frontend-test-suite-is-broken-by-node-24.md`](docs/upstream/prs/06-the-frontend-test-suite-is-broken-by-node-24.md)

## 7. ⚪ Diff view on the focused pane's `cwd`

→ [`docs/upstream/prs/07-diff-view-on-the-focused-pane-s-cwd.md`](docs/upstream/prs/07-diff-view-on-the-focused-pane-s-cwd.md)

## 8. ⚪ TOML agent adapters

→ [`docs/upstream/prs/08-toml-agent-adapters.md`](docs/upstream/prs/08-toml-agent-adapters.md)

## 9. 🔵 The bottom sheet closes on a scroll, and vanishes instead of closing

→ [`docs/upstream/prs/09-the-bottom-sheet-closes-on-a-scroll-and-vanishes.md`](docs/upstream/prs/09-the-bottom-sheet-closes-on-a-scroll-and-vanishes.md)

## 10. 🔵 Three one-line finishes: `text-wrap`, scroll-snap, haptic confirm

→ [`docs/upstream/prs/10-three-one-line-finishes-text-wrap-scroll-snap-ha.md`](docs/upstream/prs/10-three-one-line-finishes-text-wrap-scroll-snap-ha.md)

## 11. 🔵 `recent_unwrapped` behind the raw-terminal toggle (+ the wire name is snake_case)

→ [`docs/upstream/prs/11-recent-unwrapped-behind-the-raw-terminal-toggle.md`](docs/upstream/prs/11-recent-unwrapped-behind-the-raw-terminal-toggle.md)

## 12. 🔵 Three accessibility holes: a heading per screen, a reachable dismiss, a barrier per route

→ [`docs/upstream/prs/12-three-accessibility-holes-a-heading-per-screen-a.md`](docs/upstream/prs/12-three-accessibility-holes-a-heading-per-screen-a.md)

## 13. 🟡 A type scale, a font decision, and named motion curves

→ [`docs/upstream/prs/13-a-type-scale-a-font-decision-and-named-motion-cu.md`](docs/upstream/prs/13-a-type-scale-a-font-decision-and-named-motion-cu.md)

## 14. 🟡 A desktop mode: sheets from the right, lists that use the width, a reactive `useMediaQuery`

→ [`docs/upstream/prs/14-a-desktop-mode-sheets-from-the-right-lists-that.md`](docs/upstream/prs/14-a-desktop-mode-sheets-from-the-right-lists-that.md)

## 15. 🔵 A reading mode for the pane screen (and the `after` cursor it needs)

→ [`docs/upstream/prs/15-a-reading-mode-for-the-pane-screen-and-the-after.md`](docs/upstream/prs/15-a-reading-mode-for-the-pane-screen-and-the-after.md)

## 16. 🔵 Which pane am I in? (and a breadcrumb segment that switches within the space)

→ [`docs/upstream/prs/16-which-pane-am-i-in-and-a-breadcrumb-segment-that.md`](docs/upstream/prs/16-which-pane-am-i-in-and-a-breadcrumb-segment-that.md)

## 17. 🔵 Slash commands completed as you type, not only from the sheet

→ [`docs/upstream/prs/17-slash-commands-completed-as-you-type-not-only-fr.md`](docs/upstream/prs/17-slash-commands-completed-as-you-type-not-only-fr.md)

## 18. 🔵 A bell: what pinged, after the notification is gone

→ [`docs/upstream/prs/18-a-bell-what-pinged-after-the-notification-is-gon.md`](docs/upstream/prs/18-a-bell-what-pinged-after-the-notification-is-gon.md)

## 19. 🔵 The foreground notification is a toast, and it says which pane

→ [`docs/upstream/prs/19-the-foreground-notification-is-a-toast-and-it-sa.md`](docs/upstream/prs/19-the-foreground-notification-is-a-toast-and-it-sa.md)

## 20. 🔵 A refusal the bridge wrote is shown as the bridge wrote it

→ [`docs/upstream/prs/20-a-refusal-the-bridge-wrote-is-shown-as-the-bridg.md`](docs/upstream/prs/20-a-refusal-the-bridge-wrote-is-shown-as-the-bridg.md)

## 21. 🟡 The pictures an agent makes are unlookable-at from a phone

→ [`docs/upstream/prs/21-the-pictures-an-agent-makes-are-unlookable-at-fr.md`](docs/upstream/prs/21-the-pictures-an-agent-makes-are-unlookable-at-fr.md)

## 22. 🔵 `idle` and `done`, with a since

→ [`docs/upstream/prs/22-idle-and-done-with-a-since.md`](docs/upstream/prs/22-idle-and-done-with-a-since.md)

## 23. 🟡 How much Claude Code quota is used, on the dashboard

→ [`docs/upstream/prs/23-how-much-claude-code-quota-is-used-on-the-dashbo.md`](docs/upstream/prs/23-how-much-claude-code-quota-is-used-on-the-dashbo.md)

## 24. 🔵 A notification whose subject is the work, not the worker

→ [`docs/upstream/prs/24-a-notification-whose-subject-is-the-work-not-the.md`](docs/upstream/prs/24-a-notification-whose-subject-is-the-work-not-the.md)

## 25. 🔵 One composition for all three notification surfaces

→ [`docs/upstream/prs/25-one-composition-for-all-three-notification-surfa.md`](docs/upstream/prs/25-one-composition-for-all-three-notification-surfa.md)

## 26. 🔵 The multi-agent digest counts what is waiting, not how many agents

→ [`docs/upstream/prs/26-the-multi-agent-digest-counts-what-is-waiting-no.md`](docs/upstream/prs/26-the-multi-agent-digest-counts-what-is-waiting-no.md)

## 27. 🔵 Image upload + clipboard paste as a hook, not composer-only code

→ [`docs/upstream/prs/27-image-upload-clipboard-paste-as-a-hook-not-compo.md`](docs/upstream/prs/27-image-upload-clipboard-paste-as-a-hook-not-compo.md)

## 28. 🔵 A notification coordinator that doesn't assume its alerts are panes

→ [`docs/upstream/prs/28-a-notification-coordinator-that-doesn-t-assume-i.md`](docs/upstream/prs/28-a-notification-coordinator-that-doesn-t-assume-i.md)

## 29. ⛔️ A long reply is typed into the pane and never submitted — **upstream fixed it first**

→ [`docs/upstream/prs/29-a-long-reply-is-typed-into-the-pane-and-never-su.md`](docs/upstream/prs/29-a-long-reply-is-typed-into-the-pane-and-never-su.md)

## 30. 🔵 Cursor is missing from every agent table, and Codex's reset command is wrong

→ [`docs/upstream/prs/30-cursor-is-missing-from-every-agent-table-and-cod.md`](docs/upstream/prs/30-cursor-is-missing-from-every-agent-table-and-cod.md)

## 31. 🔵 `agent_session.kind === "path"` — the half of herdr's enum Collie drops

→ [`docs/upstream/prs/31-agent-session-kind-path-the-half-of-herdr-s-enum.md`](docs/upstream/prs/31-agent-session-kind-path-the-half-of-herdr-s-enum.md)

## 32. 🔵 The pane list is flat — nothing says which space a pane is in

→ [`docs/upstream/prs/32-the-pane-list-is-flat-nothing-says-which-space-a.md`](docs/upstream/prs/32-the-pane-list-is-flat-nothing-says-which-space-a.md)

## 33. 🔵 A worktree floats beside the repo it was cut from, and the Spaces screen shows neither

→ [`docs/upstream/prs/33-a-worktree-floats-beside-the-repo-it-was-cut-fro.md`](docs/upstream/prs/33-a-worktree-floats-beside-the-repo-it-was-cut-fro.md)

## 34. 🔵 Two branches in flight always conflict — over the version, not the code

→ [`docs/upstream/prs/34-two-branches-in-flight-always-conflict-over-the.md`](docs/upstream/prs/34-two-branches-in-flight-always-conflict-over-the.md)

## 35. 🔵 The ctl lifecycle tests inherit the service's config

→ [`docs/upstream/prs/35-the-ctl-lifecycle-tests-inherit-the-service-s-co.md`](docs/upstream/prs/35-the-ctl-lifecycle-tests-inherit-the-service-s-co.md)

## 36. 🟡 Long lists fold to their newest few, with a « Voir les n autres » toggle

→ [`docs/upstream/prs/36-long-lists-fold-to-their-newest-few-with-a-voir.md`](docs/upstream/prs/36-long-lists-fold-to-their-newest-few-with-a-voir.md)

## 37. 🔵 The web bundle goes out gzipped, precompressed at build

→ [`docs/upstream/prs/37-the-web-bundle-goes-out-gzipped-precompressed-at.md`](docs/upstream/prs/37-the-web-bundle-goes-out-gzipped-precompressed-at.md)

## 38. 🔵 The transcript's timestamps reuse one formatter

→ [`docs/upstream/prs/38-the-transcript-s-timestamps-reuse-one-formatter.md`](docs/upstream/prs/38-the-transcript-s-timestamps-reuse-one-formatter.md)

## 39. 🔵 A screen already seen opens at once, and a touched link starts loading

→ [`docs/upstream/prs/39-a-screen-already-seen-opens-at-once-and-a-touche.md`](docs/upstream/prs/39-a-screen-already-seen-opens-at-once-and-a-touche.md)

## 40. 🟡 Which agents have subagents running

→ [`docs/upstream/prs/40-which-agents-have-subagents-running.md`](docs/upstream/prs/40-which-agents-have-subagents-running.md)

## 41. 🟡 A followed pane's history answers 304, and an idle pane polls slow

→ [`docs/upstream/prs/41-a-followed-pane-s-history-answers-304-and-an-idl.md`](docs/upstream/prs/41-a-followed-pane-s-history-answers-304-and-an-idl.md)

## 42. 🟡 One status line for the whole app, above the tab bar and the composer

→ [`docs/upstream/prs/42-one-status-line-for-the-whole-app-above-the-tab.md`](docs/upstream/prs/42-one-status-line-for-the-whole-app-above-the-tab.md)

## 43. 🟡 `ctl.ts` — the plugin actions on Windows, under one command per id

→ [`docs/upstream/prs/43-ctl-ts-the-plugin-actions-on-windows-under-one-c.md`](docs/upstream/prs/43-ctl-ts-the-plugin-actions-on-windows-under-one-c.md)

## 44. 🟡 Idle screens — a Claude dialog herdr calls `idle` reads `blocked`

→ [`docs/upstream/prs/44-idle-screens-a-claude-dialog-herdr-calls-idle-re.md`](docs/upstream/prs/44-idle-screens-a-claude-dialog-herdr-calls-idle-re.md)

## 46. 🟡 AskUserQuestion — the whole question, and its free-text row

→ [`docs/upstream/prs/46-askuserquestion-the-whole-question-and-its-free.md`](docs/upstream/prs/46-askuserquestion-the-whole-question-and-its-free.md)

## Never offer as one PR

→ [`docs/upstream/prs/45-never-offer-as-one-pr.md`](docs/upstream/prs/45-never-offer-as-one-pr.md)
