// Deux cartes parallèles d'un même lot qui touchent les mêmes fichiers : la seconde PR arrive en conflit
// et le lot s'arrête. Le board le voit venir à partir des chemins que les specs citent — et ne fait que
// le dire : chaîner (`dependsOn`) ou passer le lot à `maxParallel` 1 reste le geste du planificateur.

import type { Card, Run } from "./db.ts";

export type Overlap = { cardIds: [string, string]; files: string[] };

// shortcut: only paths written in the spec (`dir/file.ext`, `FILE.md`) count — a card that names no file
// is assumed to touch none; a bare `name.ext` needs a 2+ char name so « e.g. » is not a file.
const PATH = /(?<![\w./-])(?:\.\/)?((?:\.?[\w-]+\/)*[\w-]{2,}(?:\.[\w-]+)*\.[a-zA-Z][a-zA-Z0-9]{0,5})(?![\w/-])/g;

/** Les chemins de fichiers cités dans un texte, sans doublon. Une URL n'en est pas un. Pur. */
export function filesCited(text: string | null): string[] {
  if (!text) return [];
  const noUrls = text.replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, " ");
  return [...new Set([...noUrls.matchAll(PATH)].map((m) => m[1]!))];
}

/**
 * Les paires de cartes d'un lot qui peuvent tourner ensemble et citent un même fichier. Rien quand le
 * lot va une carte à la fois, ni pour deux cartes déjà ordonnées par une chaîne `dependsOn` du lot. Pur.
 */
export function lotOverlaps(run: Pick<Run, "maxParallel">, cards: Pick<Card, "id" | "title" | "spec" | "dependsOn">[]): Overlap[] {
  if (run.maxParallel === 1) return [];
  const byId = new Map(cards.map((c) => [c.id, c]));
  const before = (a: string, b: string) => {
    // Is `a` an in-lot ancestor of `b`? Bounded by the lot's size, so a cycle cannot loop for ever.
    let cur = byId.get(b)?.dependsOn;
    for (let i = 0; cur && i < cards.length; i++, cur = byId.get(cur)?.dependsOn) if (cur === a) return true;
    return false;
  };
  const files = cards.map((c) => new Set(filesCited(`${c.title}\n${c.spec ?? ""}`)));
  const out: Overlap[] = [];
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++) {
      const shared = [...files[i]!].filter((f) => files[j]!.has(f));
      if (shared.length && !before(cards[i]!.id, cards[j]!.id) && !before(cards[j]!.id, cards[i]!.id))
        out.push({ cardIds: [cards[i]!.id, cards[j]!.id], files: shared });
    }
  return out;
}

/** La phrase que l'API rend avec les paires : ce que le planificateur peut faire. Null sans recouvrement. */
export function overlapWarning(overlaps: Overlap[]): string | null {
  if (!overlaps.length) return null;
  const pairs = overlaps.map((o) => `${o.cardIds[0]} & ${o.cardIds[1]} (${o.files.join(", ")})`).join("; ");
  return `parallel cards cite the same files — their second PR will likely conflict: ${pairs}. Chain them (PATCH the second card with dependsOn: <first>) or set the lot's maxParallel to 1.`;
}
