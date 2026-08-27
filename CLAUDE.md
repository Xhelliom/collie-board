# CLAUDE.md — working agreement for this repo

> **This is Collie Board**, a fork of `AltanS/collie`. Everything below is upstream's working
> agreement and still applies verbatim — the versioning gate, the build traps, the security posture.
> The fork's own rules are in [*The board*](#the-board-fork-only-rules) at the bottom, and its
> posture toward upstream in [`UPSTREAM.md`](./UPSTREAM.md).

**Collie** (upstream repo `AltanS/collie`) — a phone web UI for your Herdr agent herd, served over
Tailscale. A mobile-first PWA (Vite + React + TS + Tailwind v4 + shadcn) plus a Bun/TS bridge that
talks to Herdr's Unix socket, letting you monitor and reply to agents from a phone. The Herdr
plugin id is `herdr.collie-board` (manifest: `herdr-plugin.toml`). Orientation:
[`README.md`](./README.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) · verified API
[`HERDR_API.md`](./HERDR_API.md) · decisions [`.adr/`](./.adr/).

## Decision records — read before reopening a settled question

[`.adr/`](./.adr/) holds the decisions whose reasoning would otherwise live only in a PR thread —
specifically the ones that **close off an option someone will reasonably propose again**. If you're
about to argue *why not* rather than *how*, check there first; if the answer isn't there and the
decision is that shape, add one (numbering + format: [`.adr/README.md`](./.adr/README.md)).

Rules elsewhere in this file stay short and normative and link to the ADR for the argument. Don't
restate an ADR's reasoning here, and don't edit a superseded ADR into agreement with the present —
mark it superseded and write the next one.

## Versioning — MANDATORY

This plugin is **SemVer**ed, and the version is **enforced**, so it never silently drifts.

**The version lives in three files that must always agree, plus a matching CHANGELOG entry:**
`herdr-plugin.toml` (canonical — Herdr reads it) · `package.json` · `web/package.json` ·
newest `## [x.y.z]` heading in `CHANGELOG.md`.

**Before committing any functional change** (anything under `bridge/`, `web/src/`, `scripts/`, or the
manifest) you MUST:

1. **Bump** the version in all three files to the same number:
   - **PATCH** (`0.2.0 → 0.2.1`): bug fix / internal refactor, no behavior change.
   - **MINOR** (`0.2.0 → 0.3.0`): new backward-compatible capability.
   - **MAJOR** (`0.2.0 → 1.0.0`): breaking change to config, API, or behavior.
2. **Add a `CHANGELOG.md` entry** under a new `## [x.y.z] - YYYY-MM-DD` heading (Added / Changed /
   Fixed). Use the real date. **Style: super crisp and short** — one line per change, no prose
   paragraphs, and cite the feature's short commit hash at the end of the line (`… (abc1234)`).
   Land features as their own commits first, then cut the release commit so the entry can cite them.
3. **Run `scripts/check-version.sh`** — it must print `✓`.

Doc-only changes (`*.md`) don't need a bump. This is enforced two ways, but **you are the first
line — do it as part of the change, not after**:

- `scripts/check-version.sh` runs inside `scripts/collie-board-ctl.sh build` (a release can't build while
  versions disagree).
- A **git pre-commit hook** (`scripts/git-hooks/pre-commit`, activate once with
  `scripts/install-hooks.sh`) blocks commits where functional code changed but the version didn't.
  Escape hatch for a single commit: `SKIP_VERSION_CHECK=1 git commit …`.

**Tag the release when you push it.** Cutting a release means the three version files + the newest
`CHANGELOG.md` heading agree on `x.y.z` (steps 1–3). When that release lands on `main` and you push,
**always push a matching annotated git tag with it** — `git tag -a vX.Y.Z -m "Collie X.Y.Z" && git
push origin vX.Y.Z` (or `git push --follow-tags` so the tag ships *with* the release). One `v<x.y.z>`
tag per shipped version on the remote. Not hook-enforced — it's on you. (Adding/adjusting this note is
a doc-only change and needs no version bump.)

**Update notice (user-facing).** The app's in-app update banner links to the newest release's GitHub
page and shows the command to run. Pushing a `v*` tag auto-creates that GitHub Release (with the
commands) via `.github/workflows/release.yml`. **Always express user-facing update/restart
instructions as Herdr plugin actions** — `herdr plugin action invoke update --plugin herdr.collie-board`
(or `restart`) — never `collie-board-ctl.sh …` / `systemctl … collie`, which depend on the caller's cwd and
the unit name; the Herdr action runs from anywhere.

## Build / run (operational facts that are easy to forget)

- **Frontend changes** (`web/`): rebuild with `bun run build` (root) or `cd web && bun run build`.
  The bridge serves `web/dist` **from disk at request time**, so on the deployment host
  a rebuild is **immediately live — no restart**.
- **Backend changes** (`bridge/*.ts`): Bun does **not** hot-reload the service — you must
  `systemctl --user restart collie-board`. Forgetting this is the #1 "my change didn't take" trap.
- `bun run build` (root) and `collie-board-ctl.sh build` **typecheck both sides first** (root tsc + web
  tsc), then build web to `dist-staging` and swap it in atomically — a failed build never empties a
  live `web/dist`. Bare `cd web && bun run build` still skips typechecking; don't ship from it.
- **Tests:** frontend `cd web && bun run test` (Vitest + jsdom + Testing Library + MSW; no headless
  browser); backend pure-logic `bun run test` at the root (Bun's own runner — covers `checkAccess`,
  `StateEngine`, `loadConfig`). A **pre-push hook** (`scripts/git-hooks/pre-push`) runs **both** before
  every push — override once with `SKIP_TESTS=1 git push`. The bits that genuinely need `Bun.serve` /
  `Bun.connect` (HTTP handlers, the socket client) stay unit-untested — Vitest-on-Node can't run them,
  so keep new backend logic pure/injectable enough for `bun test`, or exercise it through `web/`.
- Service: `systemd --user` unit `collie` on the deployment host; logs `journalctl --user -u collie-board -f`.
- TS is strict on both sides, with `noUnusedLocals/Parameters` everywhere. **`web/` additionally**
  enforces `verbatimModuleSyntax` + `erasableSyntaxOnly` (use `import type`, no parameter-property
  shorthand there). The **bridge** tsconfig does not enable those two — bridge code uses
  parameter-property shorthand by convention; keep each side consistent with itself.

## Frontend data layer (React Router, not TanStack)

- Data flows through **React Router** (`createBrowserRouter`, data mode): route **loaders**
  (`web/src/lib/loaders.ts`) fetch the snapshot + pane; **polling is `useRevalidator()` on an
  adaptive interval** (`web/src/hooks/use-polling.ts`); mutations are direct `lib/api.ts` calls
  followed by `revalidator.revalidate()`. There is **no TanStack Query** — don't reintroduce it.
- Routes: `/` (home) and `/pane/:paneId` (detail). The idle-lock in `App.tsx` COVERS the still-mounted
  `RouterProvider` (a `lib/idle.ts` module store pauses polling, not an unmount) — a pause, not a
  gate ([ADR 0007](./.adr/0007-the-idle-lock-is-a-pause-not-a-gate.md)); the router instance is
  module-scoped so it keeps its location.
- **The sheets are Vaul's.** `components/ui/sheet.tsx` is one `SheetShell` over `Drawer.Root`;
  `BottomSheet` and `SideSheet` are one `direction` apart. Don't hand-roll the drag again, and keep
  `data-vaul-no-drag` on everything below the header — that marking *is* the fix for "a drag in a
  list closes the drawer". [ADR 0003](./.adr/0003-vaul-owns-the-sheet-gesture.md).
- **PWA** via `vite-plugin-pwa` (`web/vite.config.ts`): manifest + `sw.js`, registered manually
  from `virtual:pwa-register` in `main.tsx` (bundled = CSP-safe). Install/SW need a **secure
  context** — over plain HTTP they no-op silently (Chrome insecure-origin flag, or HTTPS, to test).

## Herdr socket gotchas (see HERDR_API.md for the full, verified contract)

- RPC is **one-shot**: one request per connection; the server closes after one reply. `id` must be
  a **string**. Only `events.subscribe` streams.
- `pane.send_keys` grammar is **`+`-joined, not tmux**: `ctrl+c` (NOT `C-c`), `shift+tab`, `Up`,
  `Tab`, `Escape`, `Enter`, `Backspace`. `PageUp`/`Home`/`End`/`Delete` are unsupported.
- Pane output is rendered as **React text nodes** (never `innerHTML`); the ANSI parser only derives
  colors/weights. Keep it that way — it's the XSS boundary. Strict CSP + same-origin gate stay.

## Security posture (don't regress)

Loopback bind only · exactly one hardened front door — `tailscale serve` (never `funnel`) or a
conforming reverse proxy per README Variant C (`COLLIE_BOARD_SKIP_SERVE=1`) · same-origin gate · optional
identity/device gates · strict CSP. A socket call can type into a real terminal — treat the bridge as
remote shell access.

**Collie manages exactly one front door: `tailscale serve`** — `collie-board-ctl.sh` publishes it, records
the mapping in `tailscale-managed-handler`, and only ever tears down a mapping matching that record.
Every other tunnel (NetBird, ZeroTier, Cloudflare Tunnel) is `COLLIE_BOARD_SKIP_SERVE=1` + README Variant
E: the operator owns the ingress, Collie publishes nothing. **Don't add a second managed front
door** — [ADR 0001](./.adr/0001-one-managed-front-door.md).


## The board (fork-only rules)

- **Keep the upstream surface narrow.** New behaviour goes in new files with a hook, not into
  `server.ts`/`index.ts`. The list of touched upstream files is in `UPSTREAM.md` and is meant to stay
  short — that list *is* the rebase cost.
- **No new poll loop.** Anything periodic hangs off `engine.onUpdate`. If it's expensive, throttle it
  *inside* the consumer (see `ContextTracker`), don't add a timer.
- **`card` durable, `session` ephemeral.** Never persist runtime state. If a fact can be read from
  the snapshot, read it from the snapshot.
- **Provenance is derived, never declared.** A card an agent files on its own is marked `agent` from
  the `x-collie-pane` header it sends; `origin`/`originCardId` stay out of the create allowlist, so
  no body can claim them — [ADR 0010](./.adr/0010-an-agent-filed-card-is-traced-on-the-card.md).
- **Ignore a `disconnected` snapshot.** Every consumer of `EngineSnapshot` must bail on it; a socket
  blip must never look like "the whole herd vanished".
- **Never call `agent.start` or `agent.prompt` directly.** Use `launchAgent()` and
  `promptAndConfirm()` — they carry three live-verified herdr races (see `ARCHITECTURE.md` §9). A
  direct call is how you get a pane with a shell prompt and no agent in it.
- **`bridge/git.ts` is the only place we shell out.** argv elements, never a shell; the one
  client-supplied path is validated and always follows `--`.
- **The copilot spends the user's quota.** It stays off by default, serialised to one request, and
  reviews from `--stat` — never the full diff.
- **A change that would help upstream goes in the ledger, in the same commit.** If a brick is
  generic — it works with no card in sight — add or update its entry in
  [`UPSTREAM_PRS.md`](./UPSTREAM_PRS.md) with its commit hash. Doing it later means doing it never,
  and the whole fork strategy rests on that list being true.
- **A gauge that might be wrong is worse than no gauge.** Only claim `context = true` in
  `adapters/agents.toml` for a transcript format `latestUsage()` has actually been verified against.
