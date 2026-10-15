// « Une PR pour le lot » (ADR 0041). Les cartes d'un lot réglé `integration: "lot"` partent d'une
// branche de lot, s'y fusionnent en local une fois acceptées, et le lot n'ouvre qu'une PR. Ce fichier
// est la plomberie git de ce modèle ; le coordinateur (run.ts) décide quand s'en servir.
//
// Aucun checkout pour la branche de lot : la fusion est faite en mémoire (`merge-tree`) puis posée par
// `commit-tree` + `update-ref` gardé par l'ancien sha. Le checkout principal n'est jamais touché, et
// deux fusions concurrentes ne s'écrasent pas — la perdante rend "busy" et redemande au tick suivant.

import { boardBranchPrefix } from "./config.ts";
import type { Card, Run } from "./db.ts";
import { branchExists, isAncestor, parseMergeTree, runGit, syncBaseWithOrigin, type GitRunner } from "./git.ts";

/** `board/lot-<slug>-<id6>` : le nom aide l'œil, l'id garde deux lots du même nom distincts. Pur. */
export function lotBranchOf(run: Pick<Run, "id" | "name">): string {
  const slug = (run.name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${boardBranchPrefix()}lot-${slug ? `${slug}-` : ""}${run.id.slice(0, 6)}`;
}

/**
 * La carte vue par la PR du lot : sa branche est celle du lot, sa base la vraie base. Tout ce que le
 * geste PR sait faire d'une carte (`prForCard`, `mergeWhenReady`, `prStatusFor`) marche alors tel quel,
 * et journalise sur la carte. Une carte hors lot, ou un lot pas encore démarré : la carte elle-même.
 */
export function lotPrCard(run: Pick<Run, "integration" | "lotBranch" | "lotBase"> | null | undefined, card: Card): Card {
  if (!run || run.integration !== "lot" || !run.lotBranch) return card;
  return { ...card, branch: run.lotBranch, baseRef: run.lotBase };
}

/** Crée la branche de lot depuis la base si elle n'existe pas (la base est d'abord mise au niveau d'origin). */
export async function ensureLotBranch(
  repoPath: string,
  lot: string,
  base: string,
  git: GitRunner = runGit,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await branchExists(repoPath, lot, git)) return { ok: true };
  const synced = await syncBaseWithOrigin(repoPath, base, lot, git);
  if (!synced.ok) return synced;
  const r = await git(["branch", "--", lot, base], repoPath);
  return r.ok ? { ok: true } : { ok: false, error: (r.stderr || r.stdout).trim().split("\n")[0] ?? "lot branch failed" };
}

export type FoldResult =
  | { ok: true; merged: boolean }
  | { ok: false; kind: "conflict"; files: string[]; error: string }
  | { ok: false; kind: "busy" | "other"; error: string };

/** `merge --no-ff` de la branche d'une carte dans la branche de lot, sans checkout. Rien n'est écrit en cas d'échec. */
export async function foldIntoLot(repoPath: string, lot: string, branch: string, git: GitRunner = runGit): Promise<FoldResult> {
  const fail = (kind: "busy" | "other", r: { stderr: string; stdout: string }): FoldResult => ({ ok: false, kind, error: (r.stderr || r.stdout).trim().split("\n")[0] ?? "git failed" });
  const sha = async (ref: string) => {
    const r = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${ref}^{commit}`], repoPath);
    return r.ok ? r.stdout.trim() : null;
  };
  const [lotSha, cardSha] = [await sha(lot), await sha(branch)];
  if (!lotSha || !cardSha) return { ok: false, kind: "other", error: `no such branch: ${lotSha ? branch : lot}` };
  if (await isAncestor(repoPath, cardSha, lotSha, git)) return { ok: true, merged: false };

  const tree = await git(["merge-tree", "--write-tree", "--name-only", "--", lotSha, cardSha], repoPath);
  const files = parseMergeTree(tree.ok, tree.stdout);
  if (!files) return fail("other", tree);
  if (files.length) return { ok: false, kind: "conflict", files, error: `${branch} conflicts with ${lot} in ${files.join(", ")}` };

  const commit = await git(["commit-tree", tree.stdout.trim().split("\n")[0]!, "-p", lotSha, "-p", cardSha, "-m", `Merge ${branch} into ${lot}`], repoPath);
  if (!commit.ok) return fail("other", commit);
  // Gardé par l'ancien sha : si le lot a bougé entre-temps, rien n'est écrit et on redemande.
  const moved = await git(["update-ref", `refs/heads/${lot}`, commit.stdout.trim(), lotSha], repoPath);
  return moved.ok ? { ok: true, merged: true } : fail("busy", moved);
}
