# 9. The board (this fork)

**Statut :** ✅ décidé — architecture en place, pièges vérifiés

Partie de [`ARCHITECTURE.md`](../../ARCHITECTURE.md), qui en est le sommaire.

> **Projects.** A repo's road map is the roadmap, its phases, and its lots (planned runs), planned by
> a per-repo *orchestrator* agent that the operator starts from the project tab
> (`bridge/orchestrator.ts`) and that never launches — [ADR 0021](../../.adr/0021-a-project-is-a-roadmap-phases-and-lots-planned-by-an-agent-that-never-launches.md).
> Every board route family is listed once in `isBoardPath` (`board-routes.ts`); `server.ts` forwards
> exactly that list.

Collie is an ephemeral mirror: every tick re-reads the snapshot and nothing is persisted. That is
right for "which agent needs me now" and useless for "where is this task". The board adds the second
question, and exactly one rule carries the design: **`card` is durable, `session` is ephemeral.**

- **One store, no ORM** — `bun:sqlite` and raw SQL in `bridge/db.ts`. The schema is four tables wide
  and the bridge's dependency story stays "Bun + `node:*`". Additive migrations only.
- **No new loop.** Reconciliation, the context gauge, handoff completion, the automatic handoff
  taken before an idle session's prompt cache expires and the copilot's review
  trigger are all `engine.onUpdate` hooks on the poll that already runs. There is no second source of
  truth and nothing to resync — the same reasoning as §5.
- **A DISCONNECTED snapshot is ignored, everywhere.** Its pane list is the last good one, and
  treating "the bridge lost herdr" as "every pane vanished" would orphan the entire board on a blip.
- **Nothing runtime is persisted.** The database holds intent and history. A card's status, cwd and
  agent still come from the snapshot on every read.
- **1 card = 1 branch = 1 workspace.** `worktree.create` returns a checkout, a workspace, a tab and a
  pane in one RPC, so the card's diff needs no scoping logic: it is that checkout against its fork
  point. The relationship falls out of herdr's model rather than being bookkeeping we maintain.
- **Primary session only.** A pane id means nothing in another herdr server. Multi-session cards
  would need a session column on every row for a use case that doesn't exist.
- **Multi-machine is a central and nodes.** Another machine runs its own herdr and the same bridge
  in a `node` role — board off, `/api/node/*` on behind a per-node token, its own `tailscale serve`.
  The central reads its nodes off `engine.onUpdate`, treats an unreachable one as a `disconnected`
  snapshot, and qualifies their panes by node name; a card names an *environment* that a node
  declares, never a path. The node never calls the central.
  [ADR 0046](../../.adr/0046-multi-machine-un-collie-central-et-des-noeuds.md).
- **Security is not re-implemented.** `bridge/board-routes.ts` receives the same `guard()` every
  other route uses, so a board write is gated exactly like typing into a pane — which is what
  starting a card eventually is. `bridge/git.ts` is the only place the bridge shells out: argv
  elements, never a shell; the one client-supplied path is validated and always follows `--`.

## Splitting one dump into several cards

A dictated note routinely names three things. The copilot's reformulation can therefore return a
`split`, and two nullable self-references on `card` carry what comes out of it. They are kept
separate because they answer different questions:

- **`parent_id` — provenance.** "These came from the same brain dump." A card WITH children is a
  **container**: it keeps the original dictation, is refused a branch, is refused a start, and
  derives its status from its children (urgency first, so one blocked child outranks three that are
  working). The parent used to keep one of the tasks itself, which is precisely how the same work
  ended up on two cards.
- **`depends_on` — ordering.** One edge per card, not a list. Independent (null everywhere), serial
  (a chain) and the realistic mixed case all fall out of the same column, where a two-mode
  "parallel or sequential" flag can only express the first two. In the split answer it is an index
  pointing **backward**, which makes a cycle unrepresentable rather than merely unlikely; a hand
  edit through the API gets an explicit cycle check instead.

A third self-reference answers a third question, and is **not** a synonym for the first:

- **`origin_card_id` — where a card came OUT of.** The reviewed card a copilot follow-up was filed
  against, or the card whose working session filed an `agent` one (below). Reusing `parent_id` for it
  is the obvious-looking shortcut and it is wrong: it would make every reviewed card a container —
  unstartable, its column dragged around by its own follow-ups.
  This one carries no semantics at all beyond the caption it renders as (`from “…”`, on the tile and
  at the top of the card), which is the whole point: a follow-up's title is written as a note to the
  card it belongs to, so on its own it has lost the sentence that produced it. Set at creation,
  never patched, absent from the API's create allowlist — same rule as `origin`. It may dangle (like
  `duplicate_of`, unlike `parent_id`/`depends_on`, which `deleteCard` clears), and it resolves to no
  caption, which is the right degradation for a caption.

## A card that wrote itself

Two writers besides a person put cards on this board, and the point of `card.origin` is that they
are told apart rather than lumped into "not a human" (ADR 0010):

- **`copilot`** — the review's follow-ups, filed while you were elsewhere. Badged **auto**, and
  always carrying a `category` (the review's own triage of what it produced).
- **`agent`** — a working session that decided mid-turn there was something to record and `POST`ed
  a card through the local API. Badged **agent**, no category.

The second one has a problem the first doesn't: the bridge cannot tell who is calling. So the caller
declares itself with **`x-collie-pane`** — its `HERDR_PANE_ID`, which every herdr pane has for free —
and the bridge does the rest: `openSessionByPane()` turns that into the card being worked on, which
becomes `origin_card_id` (the `from “…”` caption). No match still marks the card; only the link is
lost. `origin` and `origin_card_id` remain absent from the create allowlist, so a body can never
claim either: the caller says WHO it is, the bridge says what that means.

The session's half of the trace is a **journal entry**, not a column — `card.filed` on the source
card, carrying the filing session's id. It is the only thing that says *which* session, on a card
with a handoff chain, and it costs no storage.

**The dependency is a gate, not a trigger.** A finished predecessor makes its successor
start*able* — it never starts it. An agent that launches itself writes code and spends the user's
quota with nobody watching, which is the one thing this board is arranged against, and it is the
same reasoning that keeps the copilot off by default.

**A run is the one exception, and it is scoped to a set** ([ADR 0017](../../.adr/0017-a-run-is-consent-given-once-over-a-chosen-set-of-cards.md)).
The operator selects cards of one repo and taps "Run these"; `POST /api/runs` writes a `run` row and
`run_id` on each member, and starts nothing. From there `RunCoordinator` (`bridge/run.ts`, one more
`engine.onUpdate` hook) moves the members: it starts the startable ones in `depends_on` order while
a slot is free, and when a worker lands in `review` and sits idle it hands the **lead**
(`bridge/lead.ts` — the copilot's pane and file-answer plumbing under its own `lead` label, always
on) a question: *check* the checkout against spec and acceptance, *triage* the copilot's review and
follow-ups, or *re-check* after a conflict. It then executes the answer through the routes a tap
would use — `promptAndConfirm` back to the worker, `prForCard` with auto-merge armed,
`resolveConflict`, `fileAsDone` — and journals each decision with its reason as `run.*`. A member is
filed only once its PR has landed (merged, or GitHub's auto-merge armed); "GitHub has not answered
yet" is a wait asked again on a later tick, never a timer, and a member filed on an armed auto-merge
holds its dependents back until the board has seen that merge ([ADR 0036](../../.adr/0036-github-not-answering-yet-is-a-wait-and-only-a-landing-files-the-card.md)). The lead
judges and speaks; it never edits, starts, pushes or merges. The coordinator keeps no state: where
a member stands (`stepFor`) is read from the card, its journal and its pane on every snapshot, so a
restart resumes the run. A `blocked` worker is never answered, and a card the lead sent back
`MAX_ROUNDS` times is `run.halted` to the operator. Cards outside a run see none of this.

**What actually passes between two cards is the branch.** A dependent card forks from its
predecessor's branch rather than the repo's base, because a serial task needs the previous one's
code, not a summary of it; its opening prompt says the branch is *not* clean and carries the
predecessor's review notes. A card's base is ONE answer, `baseOf` (`git.ts`): its `base_ref`, filled
at creation with the repo's default branch (`origin/HEAD`, then `main`/`master`) — a dependent card's
too — and never the main checkout's current branch, which is a `board/…` branch after one card: a
repo that declares none of those gives no base (the back-fill skips its cards) rather than a guess. Every
diff, integration check, review and fork reads it. The resolved base is persisted onto the card at
start, since `base_ref` is also the left side of its diff — left at `main` the card would display its predecessor's work as its own.
Once the predecessor's PR has merged (in squash, so its branch is no ancestor of the base), the
dependent card forks from the synced base instead — [ADR 0034](../../.adr/0034-a-card-after-a-merged-predecessor-forks-from-the-base.md).
This is deliberately **not** the `.board/handoff.md` mechanism: that one is for context exhaustion
inside a single card, where the next agent inherits the same worktree and can read the note from its
own cwd. Across two cards the file isn't even there.

## The follow-up that shouldn't have been a card

A review's follow-ups become cards, and nearly all of them should. One shape shouldn't. "Note in
`NOTIFY_AUDIT.md` that step 1 landed" is one line into a file the review just named — and a card for
it is a card you triage, filter, drag and eventually delete, a chore the tool invented. So that one
**is not filed at all**: it stays on the review as a `TinyTodo`, carrying the spec the card would
have had, and the reviewed card's screen offers it as **one tap — finish it now** — which sends it
to that card's OWN agent. Which is right there: the review fires the moment the work lands, so the
agent is still at its prompt, in the right worktree, with the context open.

**The criterion is written once** (`isTinyFollowUp`, `bridge/copilot.ts`), and it is three clauses:
one edit to one file the review can name; the review already knows what to write; nothing verified
beyond the edit landing. The first two are the reviewer's to judge — nothing on the bridge side can
tell "one edit" from a title — so the copilot answers them, from a prompt stating the same three
clauses. The third is restated as a closed list of categories (`docs`, `chore`) and enforced in
code: a `bug`, a `feature` and a `test` all end in someone checking the result, so none of them is
ever tiny however the model answers. A one-line fix that misses the floor simply becomes an ordinary
card, which is the harmless direction — the fork's rule that a gauge which might be wrong is worse
than no gauge.

**Not filing it costs something, and the row pays it.** A suggestion with no card is a suggestion
that cannot be started, so when that agent is gone the row shows the SPEC in full rather than an
offer: nothing was filed, so this row is the only place the note still exists, and it has to be
readable by the person who now has to do it. `doneAt` is the one write a review ever gets after
creation, and it has to be durable — without it the offer stays live and a second tap makes the
agent do the same edit twice.

**Same switches, same gate.** A tiny suggestion is produced under `autoFollowUps` and the per-category
switches exactly like a filed one — a board that asked for no follow-ups gets none of either. And
like `startCard`, nothing here is automatic: the operator taps it, same reasoning as the dependency
gate above.

**And some follow-ups shouldn't exist at all.** The tiny criterion only answers "too small for a
card"; four shapes turned out to be parasites, documented with their board examples in ADR 0018.
An empty diff files no cards (a non-tiny suggestion on `(no changes)` is the model inventing work
from the handoff alone); a `complete` verdict files no cards (checking that a card exists is a
sentence for `notes`, not a follow-up); branch janitoring — leftover, generated or out-of-scope
files to take out of the branch already open — never becomes a card, because a new card would cut
a new worktree while the cleanup belongs on the reviewed branch, so it rides the same `TinyTodo`
row instead; and an already-filed suggestion is refused on its folded title (case, accents and
punctuation carry no meaning), with the filed titles shown to the model to catch a genuine
rewording. Every refusal is journalled as `copilot.review_filtered` — a silent drop is a review
the operator cannot audit.

**And the operator makes the same call, by hand.** The arbitrage above is a judgement, not a
privilege the copilot holds: a card you are looking at can be *converted into an action*
(`convertToAction`, `bridge/cards.ts`) — its spec and acceptance become a `TinyTodo` on another
card's screen, the same row with the same tap, and the card itself is deleted. Four ways in, one
target each. The two in a menu, unconditional: a sub-task's "⋯" puts the action on the container you
have open, and a card's own "⋯" puts it on its container — or, for a copilot follow-up, on the card
it was filed against, which is the case this exists for (the copilot judged it worth a card and you
disagree). And two in the open, because a gesture three taps deep in a menu is one nobody finds: a
button beside Start with the same target as the card's "⋯", and — on the review a card was promoted
out of — "Finish it instead", which converts AND hands the action to the agent still sitting there,
the whole arbitrage in one gesture. Those two are offered only while nothing has run in the card
(`convertible`, `web/src/routes/card.tsx`): past `ready` it has a branch, a session and a journal
behind it, and losing that is not a two-tap decision. Both ask twice, through the same hook as
Delete. Deleting is the
point: a card AND an action saying the same thing is the chore the conversion removes, and what was
in the card survives as the action's spec, shown in full when that agent is gone.

The review it lands on carries the verdict `converted` and journals `card.action_added`, not
`review.created` — the copilot reviewed nothing, and `tell` announces a `review.created` in the bell
(NOTIFY_AUDIT §6.3 B2). An alert for a tap the operator just made is what §6 refuses.

## Three herdr behaviours the docs don't state

Live-probed against 0.7.5 on 2026-07-28, re-checked against 0.8.0 on 2026-08-07. Each one silently
breaks the obvious implementation:

1. **`agent.start` does not wait.** The CLI's help says success means the agent "is ready for input",
   but that is the CLI polling afterwards. The socket method returns in ~2 ms with
   `agent_status: "unknown"` and leaves `launch_pending: true`. Poll `agent.get` for
   `interactive_ready` (`launchAgent()`).
2. **`agent.prompt` does not reliably submit.** A multi-line prompt lands in Claude Code's box as
   `[Pasted text #N +M lines]` and sits there; one `Enter` afterwards submits it untouched. Same
   class as the `send_text` + `send_keys` race HERDR_API.md already documents. Read the state back
   and look (`promptAndConfirm()`). 0.8.0 narrows this upstream — herdr now waits briefly between
   the text and its own Enter (#1878) — but `promptAndConfirm` stays exactly as it is: the modal
   case it also covers is untouched, its Enter only fires when the agent is neither `working` nor
   `blocked` (so a prompt that did land costs nothing), and the plugin still supports 0.7.x.
3. **`agent_session` is absent by default.** It only appears once `herdr integration install claude`
   has planted its hook — not one agent pane in a plain install carried it, which means Collie's own
   pane History is unavailable by default too. The gauge falls back to resolving the transcript from
   the directory the agent was launched in, which is sound only because the board created it.
