# 17. 🔵 Slash commands completed as you type, not only from the sheet

**Statut :** ✅ décidé — registre tenu à jour, statut de la brique dans son titre (🔵 🟡 ⚪ 🟢 ✅ ⛔️)

Partie de [`UPSTREAM_PRS.md`](../UPSTREAM_PRS.md), qui en est le sommaire.

The command catalog upstream already ships (`agent-commands.ts`) is only reachable by leaving the
keyboard: tap the Agent button, open a sheet, search, tap back. That is the right surface for
*browsing* commands and the wrong one for the case where you already know the command and have
started typing it. This adds the second half — prefix matches offered inline as you type `/comp` —
and changes nothing about the first.

| | |
|---|---|
| Commit | `0473d39` *feat(web): complete slash commands as you type them in the composer* |
| Files | `web/src/components/command-suggestions.tsx` (new, + test), `web/src/components/composer.tsx` (one import, a 10-line mount, one comment on `insertCommand`), `web/src/components/composer.test.tsx` |
| Extraction | **Clean cherry-pick.** One new file plus a small hook in an upstream one; no card in sight, no board state, no new dependency. |

**One catalog, two surfaces.** Both halves call `commandsFor(agent)`, so a command added to the
catalog shows up in both without a second edit — the failure mode this exists to prevent.

**The trigger is the whole design.** Suggestions fire only while the draft is a lone `/token`: a
slash command is one only at the start of the line, and the first space means the user is writing
arguments rather than still choosing. The strip therefore retires itself and needs no dismiss
affordance. The regex is also what keeps an empty draft quiet — `"".startsWith("")` matches every
command, so a prefix filter alone would light up on a just-cleared input.

**Picking completes, it never sends.** It fills the input (`/compact ` with the trailing space when
the command takes an argument) and returns the keyboard; sending stays the deliberate tap it is
everywhere else. It deliberately does not route through the composer's `insertCommand()`, which
*appends* to an existing draft and would yield `/comp /compact ` — replacing the partial token is the
only correct move, and a comment there now says so.

**A labelled group of buttons, not a listbox.** A listbox promises arrow-key navigation and an active
descendant this doesn't have; native buttons carry Tab and their own accessible names for free.

---
