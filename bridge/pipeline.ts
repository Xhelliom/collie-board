// A card's pipeline — ADR 0031. The ordered roles a card goes through: `implementer → reviewer → fix`.
// Step 0 is `startCard`'s own start; every later step is a FRESH agent session on the same card,
// worktree and branch (a reviewer that wrote the code does not read it with fresh eyes), told what the
// step before it reported. Only a run chains steps (the RunCoordinator calls `advancePipeline`).
//
// NO STATE OF ITS OWN: the step a card stands at is the number of `card.pipeline_step` entries in its
// journal, so a restart resumes from what the card says.

import { join } from "node:path";

import { agentNameFor, initialPrompt, launchAgent, promptAndConfirm } from "./cards.ts";
import type { Config } from "./config.ts";
import type { AgentAdapter } from "./adapters.ts";
import type { BoardDb, BoardEvent, Card, CardSession, AgentTemplate } from "./db.ts";
import type { HerdrClient } from "./herdr-client.ts";
import { BILAN_REL_PATH, bilanPrompt } from "./lead.ts";
import { resolvePipeline } from "./flows.ts";
import { composePrompt, modelArgs } from "./templates.ts";
import { worktreePathFor } from "./git.ts";

/** The role that follows the one the card is on, or null at the end of the pipeline. Pure. */
export function nextRole(pipeline: readonly AgentTemplate[], events: readonly BoardEvent[]): AgentTemplate | null {
  const advanced = events.filter((e) => e.type === "card.pipeline_step").length;
  return pipeline[advanced + 1] ?? null;
}

/** What the next role is told: its brief, the card, and what the previous step reported. Pure. */
export function stepPrompt(role: AgentTemplate, card: Card, previous: { name: string; report: string | null }): string {
  const said = previous.report?.trim()
    ? `The previous step (${previous.name}) reported:\n\n${previous.report.trim()}`
    : `The previous step (${previous.name}) left no report: read the commits of this branch.`;
  return composePrompt(role.brief, `${initialPrompt(card)}\n\n---\n\n${said}\n\n${bilanPrompt()}`);
}

/** The pipeline of a card, read from the db. */
export function pipelineOf(db: BoardDb, card: Card): AgentTemplate[] {
  return resolvePipeline(card, card.phaseId ? db.getPhase(card.phaseId) : null, card.repoPath ? db.repoFlow(card.repoPath) : null, db.listTemplates(), db.listFlows());
}

/**
 * Replace the card's session with a fresh agent in the next role. Modelled on `swapToFreshSession`
 * (new pane first, then the old one closed). Throws; the coordinator turns a failure into a halt.
 */
export async function advancePipeline(
  db: BoardDb,
  herdr: HerdrClient,
  cfg: Config,
  card: Card,
  session: CardSession,
  role: AgentTemplate,
  report: string | null,
  adapters?: Record<string, AgentAdapter>,
): Promise<void> {
  if (!card.workspaceId || !session.paneId) throw new Error("card has no workspace or pane");
  const pipeline = pipelineOf(db, card);
  const index = db.listEvents(card.id, 200).filter((e) => e.type === "card.pipeline_step").length + 1;
  const previous = pipeline[index - 1]?.name ?? "previous step";

  const created = await herdr.createTab(card.workspaceId, { label: card.title.slice(0, 40) });
  db.closeSession(session.id, "pipeline");
  try {
    await herdr.closePane(session.paneId);
  } catch {
    // Already gone is the outcome we wanted.
  }

  // The previous bilan is spent: the next role writes its own, and the lead must not read a stale one.
  const checkout = card.repoPath && card.branch ? await worktreePathFor(card.repoPath, card.branch) : null;
  if (checkout) await Bun.file(join(checkout, BILAN_REL_PATH)).delete().catch(() => {});

  const kind = card.agentKind ?? role.agentKind ?? cfg.boardAgentKind;
  const next = db.openSession({ cardId: card.id, paneId: created.paneId, agentKind: kind });
  const args = modelArgs(kind, role.model, adapters);
  db.recordEvent(card.id, "card.pipeline_step", { index, from: session.id, to: next.id, templateId: role.id, name: role.name, kind, ...(args.length ? { args, model: role.model } : {}) });

  await launchAgent(herdr, created.paneId, kind, agentNameFor(card.branch ?? card.title), undefined, args);
  await promptAndConfirm(herdr, created.paneId, stepPrompt(role, card, { name: previous, report }), undefined, { firstAfterLaunch: true });
  db.setStatus(card.id, "working", `pipeline: ${role.name}`);
}
