// « Faire résoudre le conflit » on a PR's sheet. A PR a card carries goes through the card's own path
// (its live agent, else `reopenForPr` — ADR 0014); a PR nobody carries gets a card filed ON ITS BRANCH
// (no new branch) and started. Never `agent.start` here: `startCard` owns the launch races.

import type { Mux } from "./mux/mux.ts";
import type { Config } from "./config.ts";
import type { Card } from "./db.ts";
import type { BoardDb } from "./db.ts";
import { startCard } from "./cards.ts";
import { restoreBranch } from "./git.ts";
import { reopenForPr, resolveConflict } from "./integrate.ts";
import { parsePrNumber, prDetail, type PrDetail } from "./pr-detail.ts";
import { reposOf } from "./prs.ts";

type Started = { ok: true; paneId: string } | { ok: false; error: string };

export interface PrResolveDeps {
  detail(repo: string, n: string): Promise<{ ok: true; detail: PrDetail } | { ok: false; status: number; error: string }>;
  restore(repo: string, branch: string): Promise<{ ok: true } | { ok: false; error: string }>;
  start(cardId: string, prompt: string): Promise<Started>;
  resolve(card: Card): Promise<Started>;
  reopen(card: Card): Promise<Started>;
}

export type PrResolveResult =
  | { ok: true; card: { id: string; title: string }; paneId: string }
  | { ok: false; status: number; error: string };

/** The real ports. `cfg`/`herdr` are the route's own. */
export const prResolvePorts = (db: BoardDb, herdr: Mux, cfg: Config): PrResolveDeps => ({
  detail: (repo, n) => prDetail(db, repo, n),
  restore: restoreBranch,
  start: async (id, prompt) => {
    const r = await startCard(db, herdr, cfg, id, { promptText: prompt });
    return r.ok ? { ok: true, paneId: r.value.worktree.paneId } : { ok: false, error: r.error.message };
  },
  resolve: async (c) => {
    const r = await resolveConflict(db, herdr, c, "pr");
    return r.ok ? { ok: true, paneId: r.value.paneId } : { ok: false, error: r.error.message };
  },
  reopen: async (c) => {
    const r = await reopenForPr(db, herdr, cfg, c);
    return r.ok ? { ok: true, paneId: r.value.paneId } : { ok: false, error: r.error.message };
  },
});

/** The conflict of a PR no card carries: nobody else will push, so the agent does — to the PR's own branch. Pure + exported. */
export function pushingPrompt(base: string, branch: string, url: string): string {
  return [
    `The pull request ${url} (branch ${branch}) conflicts with ${base}. Settle it in THIS checkout:`,
    "",
    `1. git merge ${base}`,
    "2. Resolve every conflict. Keep both intentions where they are compatible; where they are not, read the other side before dropping anything.",
    "3. Make sure the project still builds and its tests still pass.",
    "4. Commit the merge.",
    `5. git push origin ${branch} — the same branch, never a new one.`,
    "",
    `Do NOT check out ${base}, do not merge the PR, and do not touch any other checkout. Stop once the push is done.`,
  ].join("\n");
}

export async function resolvePrConflict(db: BoardDb, repo: string, rawNumber: string, deps: PrResolveDeps): Promise<PrResolveResult> {
  if (!reposOf(db).has(repo)) return { ok: false, status: 403, error: "unknown repo" };
  const number = parsePrNumber(rawNumber);
  if (!number) return { ok: false, status: 400, error: "bad PR number" };
  const read = await deps.detail(repo, rawNumber);
  if (!read.ok) return read;
  const d = read.detail;
  if (d.state !== "open") return { ok: false, status: 409, error: `this PR is ${d.state} — there is nothing left to settle` };
  if (!d.conflicting) return { ok: false, status: 409, error: "GitHub reports no conflict on this PR" };

  const fail = (error: string): PrResolveResult => ({ ok: false, status: 409, error });
  const carried = d.card ? db.getCard(d.card.id) : null;
  if (carried) {
    const r = await (db.openSessionFor(carried.id)?.paneId ? deps.resolve(carried) : deps.reopen(carried));
    return r.ok ? { ok: true, card: { id: carried.id, title: carried.title }, paneId: r.paneId } : fail(r.error);
  }

  const restored = await deps.restore(repo, d.head);
  if (!restored.ok) return fail(restored.error);
  const card = db.createCard({
    title: `Résoudre le conflit de la PR #${number}`,
    spec: `La PR #${number} (${d.url}) est en conflit avec ${d.base}. Résoudre sur sa branche ${d.head}, sans en créer une autre.`,
    repoPath: repo,
    branch: d.head,
    baseRef: d.base,
  });
  const started = await deps.start(card.id, pushingPrompt(`origin/${d.base}`, d.head, d.url));
  // The card stays on the board when the launch fails: the operator can start it from there.
  return started.ok ? { ok: true, card: { id: card.id, title: card.title }, paneId: started.paneId } : fail(`${started.error} — la carte « ${card.title} » reste sur le tableau`);
}
