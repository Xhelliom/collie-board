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

/** The index of the pipeline step the card is on: the newest `card.pipeline_step` says, none yet = step 0. Pure. */
export function currentStep(events: readonly BoardEvent[]): number {
  const latest = events.find((e) => e.type === "card.pipeline_step"); // newest first
  const i = (latest?.payload as { index?: unknown } | null)?.index;
  return typeof i === "number" ? i : 0;
}

/** The role that follows the one the card is on, or null at the end of the pipeline. Pure. */
export function nextRole(pipeline: readonly AgentTemplate[], events: readonly BoardEvent[]): AgentTemplate | null {
  return pipeline[currentStep(events) + 1] ?? null;
}

/**
 * The step a send-back goes to: the nearest `worker` role at or before the step the card is on, or null
 * when there is none (the message then stays with the current session). Pure.
 */
export function workerStep(pipeline: readonly AgentTemplate[], current: number): number | null {
  for (let i = Math.min(current, pipeline.length - 1); i >= 0; i--) if (pipeline[i]!.worker) return i;
  return null;
}

/** What a worker role is told when a send-back comes back to it: the card, then the failure. Pure. */
export function sendBackPrompt(role: AgentTemplate, card: Card, failure: string): string {
  return composePrompt(
    role.brief,
    `${initialPrompt(card)}\n\n---\n\nYour earlier work on this card is already in this branch (read the recent commits). A later step could not accept it:\n\n${failure}\n\n${bilanPrompt()}`,
  );
}

/** What the next role is told: its brief, the card, and what the previous step reported. Pure. */
export function stepPrompt(role: AgentTemplate, card: Card, previous: { name: string; report: string | null }): string {
  const said = previous.report?.trim()
    ? `The previous step (${previous.name}) reported:\n\n${previous.report.trim()}`
    : `The previous step (${previous.name}) left no report: read the commits of this branch.`;
  return composePrompt(role.brief, `${initialPrompt(card)}\n\n---\n\n${said}\n\n${bilanPrompt()}`);
}

/**
 * The role a tap can hand a card to outside a run: only a card that has landed (`review`) with a session
 * still open and a role left after the one it is on. A card in a run chains by itself. Pure.
 */
export function nextStepOf(
  card: Pick<Card, "runId" | "status">,
  hasSession: boolean,
  pipeline: readonly AgentTemplate[],
  events: readonly BoardEvent[],
): { templateId: string; name: string } | null {
  if (card.runId || !hasSession || card.status !== "review") return null;
  const role = nextRole(pipeline, events);
  return role ? { templateId: role.id, name: role.name } : null;
}

/** The worker's closing bilan from its checkout, or null when it left none (what the next role is told). */
export async function readBilan(card: Card): Promise<string | null> {
  const checkout = card.repoPath && card.branch ? await worktreePathFor(card.repoPath, card.branch) : null;
  if (!checkout) return null;
  const text = await Bun.file(join(checkout, BILAN_REL_PATH)).text().catch(() => "");
  return text.trim().slice(0, 8000) || null;
}

/** The pipeline of a card, read from the db. */
export function pipelineOf(db: BoardDb, card: Card): AgentTemplate[] {
  return resolvePipeline(card, card.phaseId ? db.getPhase(card.phaseId) : null, card.repoPath ? db.repoFlow(card.repoPath) : null, db.listTemplates(), db.listFlows());
}

/**
 * Replace the card's session with a fresh agent in `role`, at pipeline step `index`, told `text`.
 * Modelled on `swapToFreshSession` (new pane first, then the old one closed). Throws; the coordinator
 * turns a failure into a halt.
 *
 * SAME DISCIPLINE AS `startCard`: the step is journaled only once the agent is up. An agent that never
 * came up leaves no open session on a shell pane (that wedges the card: reconciliation never orphans a
 * live shell, and every retry answers "already running") and no step counted as taken. The retry is a
 * plain start: `startCard` reads the owed step from the journal (`owedStep`) and launches that role.
 */
async function swapRole(
  db: BoardDb,
  herdr: HerdrClient,
  cfg: Config,
  card: Card,
  session: CardSession,
  role: AgentTemplate,
  index: number,
  text: string,
  adapters?: Record<string, AgentAdapter>,
  wait?: (ms: number) => Promise<void>,
): Promise<void> {
  if (!card.workspaceId || !session.paneId) throw new Error("card has no workspace or pane");
  const created = await herdr.createTab(card.workspaceId, { label: card.title.slice(0, 40) });
  db.closeSession(session.id, "pipeline");
  try {
    await herdr.closePane(session.paneId);
  } catch {
    // Already gone is the outcome we wanted.
  }

  // The card's explicit kind, else the ROLE's (ADR 0026) — never the kind an earlier role ran with.
  const kind = card.agentKind ?? role.agentKind ?? cfg.boardAgentKind;
  const next = db.openSession({ cardId: card.id, paneId: created.paneId, agentKind: kind });
  const args = modelArgs(kind, role.model, adapters);
  try {
    await launchAgent(herdr, created.paneId, kind, agentNameFor(card.branch ?? card.title), wait, args);
  } catch (err) {
    db.closeSession(next.id, "abandoned");
    // The tab was created for this agent: left open, it is a stray shell nobody owns.
    await herdr.closeTab(created.tabId).catch(() => {});
    db.setStatus(card.id, "ready", "agent failed to start");
    // `prompt`: the retry is `startCard`, which resumes THIS step with it (`owedStep`), not role 0.
    db.recordEvent(card.id, "card.start_failed", { stage: "pipeline", step: index, role: role.name, prompt: text, error: (err as Error).message });
    throw new Error(`agent.start (${role.name}): ${(err as Error).message}`);
  }
  db.recordEvent(card.id, "card.pipeline_step", { index, from: session.id, to: next.id, templateId: role.id, name: role.name, kind, ...(args.length ? { args, model: role.model } : {}) });

  // The previous bilan is spent: the next role writes its own, and the lead must not read a stale one.
  // Only once the agent is up — a failed launch keeps it for the retry.
  const checkout = card.repoPath && card.branch ? await worktreePathFor(card.repoPath, card.branch) : null;
  if (checkout) await Bun.file(join(checkout, BILAN_REL_PATH)).delete().catch(() => {});

  try {
    await promptAndConfirm(herdr, created.paneId, text, wait, { firstAfterLaunch: true });
  } catch (err) {
    // The agent IS up; only the prompt failed — recoverable by hand, as in `startCard`: keep the session.
    db.recordEvent(card.id, "card.start_failed", { stage: "agent.prompt", error: (err as Error).message });
    throw new Error(`agent started but the prompt failed: ${(err as Error).message}`);
  }
  db.setStatus(card.id, "working", `pipeline: ${role.name}`);
}

/** The next role takes the branch, told what the step before reported. */
export async function advancePipeline(
  db: BoardDb,
  herdr: HerdrClient,
  cfg: Config,
  card: Card,
  session: CardSession,
  role: AgentTemplate,
  report: string | null,
  adapters?: Record<string, AgentAdapter>,
  wait?: (ms: number) => Promise<void>,
): Promise<void> {
  const pipeline = pipelineOf(db, card);
  const index = currentStep(db.listEvents(card.id, 200)) + 1;
  const previous = pipeline[index - 1]?.name ?? "previous step";
  await swapRole(db, herdr, cfg, card, session, role, index, stepPrompt(role, card, { name: previous, report }), adapters, wait);
}

/**
 * A send-back about the code (red gate, red CI, the lead's correction) belongs to whoever writes it:
 * back to the worker role at `index`, in a fresh session, with the failure. The card is then on that
 * step again, so its next landing is judged and handed on to the later roles afresh.
 */
export async function sendBackToWorker(
  db: BoardDb,
  herdr: HerdrClient,
  cfg: Config,
  card: Card,
  session: CardSession,
  index: number,
  failure: string,
  adapters?: Record<string, AgentAdapter>,
  wait?: (ms: number) => Promise<void>,
): Promise<void> {
  const role = pipelineOf(db, card)[index];
  if (!role) throw new Error("the card has no such pipeline step");
  await swapRole(db, herdr, cfg, card, session, role, index, sendBackPrompt(role, card, failure), adapters, wait);
}
