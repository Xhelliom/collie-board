// The bridge is the guard; a prompt says what is allowed and how. A "don't" in a prompt is legitimate only
// when a route refuses the same gesture, or when the bridge cannot check it (what is said, consent given
// aloud). Every forbidding sentence the orchestrator can read is listed here with what holds it — a new
// one fails until it is attached to its guard, or rewritten as a conditional permission.
import { describe, expect, it } from "bun:test";
import type { Card } from "./db.ts";
import { ASK_NOTE_PROMPT, orchestratorPrompt } from "./orchestrator.ts";
import { GOAL_LOT_LINE, cardMessage, goalLines, lotMessage, phaseMessage, lateMessage } from "./orchestrator-nudge.ts";

/** Substring of the sentence → what holds it. */
const ALLOWED: Record<string, string> = {
  // Routes that refuse an agent pane (403): POST /api/phases/<id>/close|reopen, /api/phases/seal (ADR 0025).
  "ne la fais pas": "route — phases",
  "Ne valide jamais une phase": "route — phases",
  "Ne valide rien toi-même": "route — phases",
  "Ne valide aucune phase": "route — phases",
  // What the bridge cannot check: what is said to the operator, and consent given aloud.
  "Ne lui donne JAMAIS un id brut": "invérifiable — la parole à l'opérateur",
  "jamais une par étape": "invérifiable — le volume de notifications",
  "Jamais sans accord explicite": "invérifiable — le « oui » oral de l'opérateur (ADR 0057)",
  "jamais « à la fin »": "invérifiable — quand la mémoire est écrite",
  "Ne crée PAS de phase de board pour le Cadrage": "invérifiable — convention de planification",
  // Not a prohibition: a widening (do it yourself), a tone, or a statement of fact.
  "Ne lui demande pas de faire ce que tu peux faire": "permission",
  "ce que tu ne sais pas": "ton",
  "te refuse si ce n'est pas permis": "constat — le bridge refuse",
  "te refuse ce qui n'est pas": "constat — le bridge refuse",
  "ne devient pas une carte": "constat",
  "n'exécute rien": "constat",
  "ne produit aucune carte": "constat",
  "n'est pas mergée": "constat",
  "ne sont pas dans": "constat",
};

const FORBIDS = /\b(?:ne|n')\s*[^\s,;.]+[^.;:—]*?\b(?:rien|jamais|pas|aucune?)\b|\bjamais\b|\binterdit/i;

function everyPrompt(): string[] {
  const c = { id: "c1", title: "T", status: "done" } as Card;
  const g = { id: "g", text: "v1", criteria: ["a"], waiting: ["d"] };
  const none = new Set<string>();
  return [
    orchestratorPrompt("/r", null, "http://x"),
    orchestratorPrompt("/r"),
    ASK_NOTE_PROMPT,
    lotMessage("L", [c], new Set(), new Set(["c1"]), { name: "P", open: [c] }, "/r", { go: true, next: { id: "n", name: "N" } }),
    lotMessage("L", [c], new Set(["c1"]), new Set(), null, "/r", { go: false, why: "w" }),
    lotMessage("L", [c], none, none, null, "/r", null, g),
    lotMessage("L", [c], none, none, null, "/r", null, null, { enabled: true, startWhenIdle: true }),
    lotMessage("L", [c], none, none, null, "/r", null, null, { enabled: true, startWhenIdle: false }),
    lotMessage("L", [c], none, none, null, "/r", null, null, { enabled: false, startWhenIdle: false }),
    ...goalLines(g, "/r", true),
    GOAL_LOT_LINE,
    cardMessage(c, "w", "r"),
    lateMessage(c, 1, "b", "main"),
    phaseMessage("closed", "P", null),
    phaseMessage("sealed", "P", "Q"),
    phaseMessage("reopened", "P", null),
  ];
}

describe("orchestrator prompts: every prohibition is held by a guard", () => {
  const sentences = everyPrompt().flatMap((t) => t.split(/(?<=[.;:!?])\s+|\n|—/)).map((s) => s.trim());
  const forbidding = sentences.filter((s) => FORBIDS.test(s));

  it("no forbidding sentence without its guard", () => {
    expect(forbidding.filter((s) => !Object.keys(ALLOWED).some((k) => s.includes(k)))).toEqual([]);
  });

  it("no stale entry in the list", () => {
    expect(Object.keys(ALLOWED).filter((k) => !forbidding.some((s) => s.includes(k)))).toEqual([]);
  });

  it("no prompt tells the orchestrator never to launch or relaunch", () => {
    for (const s of sentences) expect(s).not.toMatch(/ne (re)?lance (rien|jamais)|ne lances? JAMAIS/i);
  });
});
