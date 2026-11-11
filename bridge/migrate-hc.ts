import type { AgentAdapter } from "./adapters.ts";
import type { BoardDb, Card } from "./db.ts";
import { boardTab, type BoardTab, type Mux } from "./mux/mux.ts";
import type { AgentView } from "./types.ts";
import { agentNameFor, cardTab, launchAgent, outOfSight } from "./cards.ts";
import { ownerOf } from "./mux/composite.ts";
import { isOrchestratorAgent, orchestratorLabel, orchestratorName, orchestratorTab } from "./orchestrator.ts";

// ─────────────────────────────────────────────────────────────────────────────
// « Migrer vers herdr-core » : a Claude card agent at rest under herdr 0.9 is closed there and
// reopened under hc on the SAME conversation (`claude --resume <id>`, same cwd). Measured in
// HERDR_CORE_API.md §3: the conversation comes back and the session id does not change, so the card's
// transcript, context gauge and agentSessionId follow without remapping.
//
// A bridge that does not read hc yet cannot see the migrated terminal: the session is put out of
// reconcile's sight (`outOfSight`) instead of being orphaned, until its pane shows up in a snapshot —
// then reconcile follows it as any other (cards.ts).
//
// Any Claude pane under 0.9 migrates the same way, card or not (migrate-hc-routes.ts): what it is
// called under hc is `migrationIdentity`'s — the orchestrator keeps the label it is found by.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether a pane is herdr 0.9's — read off its id by {@link ownerOf}, the composite's one rule. Never
 * `cfg.mux`, which (with both engines read) only names where NEW panes are launched.
 */
export const isHerdr09Pane = (paneId: string): boolean => ownerOf(paneId) === "herdr09";

/** Why the button is not offered. One reason, the first that holds. */
export type MigrateBlock = "not-herdr09" | "no-pane" | "not-claude" | "no-session-id" | "busy" | "hc-down";

/** Whether « Migrer vers herdr-core » may be offered for this pane. Null = yes. */
export function migrateBlock(input: {
  pane: AgentView | undefined;
  adapter: AgentAdapter | undefined;
  hcUp: boolean;
}): MigrateBlock | null {
  if (!input.pane) return "no-pane";
  if (!isHerdr09Pane(input.pane.paneId)) return "not-herdr09";
  if (!input.adapter?.sessionId) return "not-claude";
  if (!input.pane.agentSessionId) return "no-session-id";
  if (input.pane.status !== "idle" && input.pane.status !== "done") return "busy";
  if (!input.hcUp) return "hc-down";
  return null;
}

/** The reasons, in the operator's words (the per-pane route and « Tout migrer »'s bilan). */
export const MIGRATE_BLOCK_FR: Record<MigrateBlock | "board-pane", string> = {
  "not-herdr09": "déjà sous herdr-core",
  "no-pane": "ce pane n'existe plus",
  "not-claude": "seul Claude reprend sa conversation",
  "no-session-id": "sa conversation n'est pas connue",
  busy: "il travaille ou attend une réponse",
  "hc-down": "herdr-core ne répond pas",
  "board-pane": "le lead et le copilote sont relancés par le board",
};

/** What the migrated pane is called under hc, and its tab in herdr-app (`herdr.space`/`herdr.tab`, mux/hc.ts). */
export interface MigrationIdentity {
  /** The agent's herdr name. */
  name: string;
  /** The pane's label under hc; the name when absent. */
  label?: string;
  show: BoardTab;
}

/**
 * A card's agent is its card's; an orchestrator keeps the label `findOrchestrator` reads (its 0.9
 * workspace's, the pane's under hc); any other pane keeps the name it shows in the herd.
 */
export function migrationIdentity(pane: AgentView, card: Card | null): MigrationIdentity {
  if (card) return { name: card.branch ?? card.title, show: cardTab(card) };
  if (isOrchestratorAgent(pane)) return { name: orchestratorName(pane.cwd), label: orchestratorLabel(pane.cwd), show: orchestratorTab(pane.cwd) };
  const label = pane.paneLabel ?? pane.workspaceLabel;
  const id = pane.paneId.replace(/\W/g, "-");
  // The pane id keeps the herdr name unique: two free agents may share a space's label.
  return { name: `${label}-${id}`, label, show: boardTab(`pane-${id}`, pane.cwd, label) };
}

export type MigrateResult =
  | { ok: true; paneId: string }
  /** hc refused; the agent was brought back under 0.9 on the same conversation. */
  | { ok: false; kind: "fell-back"; paneId: string; message: string }
  /** No spare shell under 0.9: nothing was closed, the agent runs on where it was. */
  | { ok: false; kind: "untouched"; message: string }
  /** Neither engine took it: the pane is gone, the transcript is not (`claude --resume <id>`). */
  | { ok: false; kind: "lost"; message: string };

/**
 * Close the 0.9 pane, then relaunch under hc. Close FIRST: two Claude processes on one session id
 * would both append to its transcript. Any hc failure relaunches under 0.9 with the same resume, in a
 * spare shell opened BEFORE the close — closing a space's last pane closes the space (measured), and
 * a fallback with nowhere to open would lose the agent. No spare, no migration: nothing is touched.
 * The caller has checked {@link migrateBlock}.
 */
export async function migrateToHc(deps: {
  db: BoardDb;
  herdr: Mux;
  hc: Mux;
  /** The card session running in the pane; absent for a pane no card owns (orchestrator, free agent). */
  sessionId?: string;
  pane: AgentView;
  name: string;
  label?: string;
  show?: BoardTab;
  sleep?: (ms: number) => Promise<void>;
}): Promise<MigrateResult> {
  const { db, herdr, hc, sessionId, pane } = deps;
  const session = sessionId ? db.getSession(sessionId)! : null;
  /** Reattach the card's session to where the agent runs now; a pane without a card has nothing to reattach. */
  const moved = (to: string, mux: string, error?: string) => {
    if (!session) return;
    db.patchSession(session.id, { paneId: to });
    db.recordEvent(session.cardId, "session.migrated", { sessionId: session.id, from: pane.paneId, to, mux, ...(error ? { error } : {}) });
  };
  const resume = ["--resume", pane.agentSessionId!];
  // The cwd already ran Claude, so it is trusted: no trustFolder, no trust screen (measured).
  const name = agentNameFor(deps.name);
  const sleep = deps.sleep;

  let spare: string;
  try {
    spare = (await herdr.createTab(pane.workspaceId, { cwd: pane.cwd, label: name })).paneId;
  } catch (err) {
    return { ok: false, kind: "untouched", message: `herdr 0.9 n'a pas ouvert de shell de secours (${(err as Error).message}) — rien n'a changé` };
  }

  // Between the close and the reattach the pane is missing from the snapshot — not an orphan.
  if (session) outOfSight.add(session.id);
  await herdr.closePane(pane.paneId);

  let hcPane: string | null = null;
  try {
    hcPane = (await hc.createWorkspace({ cwd: pane.cwd, label: deps.label ?? name, ...(deps.show ? { show: deps.show } : {}) })).paneId;
    await launchAgent(hc, hcPane, "claude", name, sleep, resume);
    moved(hcPane, "hc");
    await herdr.closePane(spare).catch(() => {});
    return { ok: true, paneId: hcPane };
  } catch (err) {
    const message = (err as Error).message;
    if (hcPane) await hc.closePane(hcPane).catch(() => {});
    try {
      await launchAgent(herdr, spare, "claude", name, sleep, resume);
      moved(spare, "herdr09", message);
      return { ok: false, kind: "fell-back", paneId: spare, message: `herdr-core a refusé (${message}) — l'agent est relancé sous herdr 0.9` };
    } catch (err2) {
      return { ok: false, kind: "lost", message: `herdr-core (${message}) puis herdr 0.9 (${(err2 as Error).message}) ont refusé — reprendre à la main : claude --resume ${pane.agentSessionId}` };
    } finally {
      if (session) outOfSight.delete(session.id);
    }
  }
}
