// Flows — ADR 0032. A flow is a named pipeline: an ordered list of templates (roles) a card goes
// through, defined once in the board and picked by a card, a phase or a repo. Everything here is pure;
// the db and the routes call it.

import type { AgentFlow, AgentTemplate } from "./db.ts";

export const FLOW_NAME_MAX = 80;
export const FLOW_DESCRIPTION_MAX = 300;
/** A flow is a handful of roles, not a program. */
export const PIPELINE_MAX = 6;

type Builtin = { key: string; name: string; description: string; roles: readonly string[] };

/** Shipped flows, over the shipped templates by key. Names are English as stored; the app translates by `key`. */
export const BUILTIN_FLOWS: readonly Builtin[] = [
  { key: "code", name: "Code: implement then review", description: "An implementer writes the change, a reviewer reads it with fresh eyes.", roles: ["implementer", "reviewer"] },
  { key: "doc", name: "Doc only", description: "One writer, no code review.", roles: ["doc"] },
  { key: "explore", name: "Exploration", description: "One read-only investigation that ends in a conclusion.", roles: ["explore"] },
];

/** Validate an untrusted flow body. `all`: a create, where name and steps are required. `known`: does this template exist. Pure. */
export function parseFlowBody(
  b: Record<string, unknown>,
  all: boolean,
  known: (templateId: string) => boolean,
): { ok: true; value: { name?: string; description?: string; steps?: string[] } } | { ok: false; error: string } {
  const out: { name?: string; description?: string; steps?: string[] } = {};
  if ("name" in b || all) {
    if (typeof b.name !== "string" || b.name.trim() === "" || b.name.trim().length > FLOW_NAME_MAX)
      return { ok: false, error: `name must be 1 to ${FLOW_NAME_MAX} characters` };
    out.name = b.name.trim();
  }
  if ("description" in b) {
    if (typeof b.description !== "string" || b.description.length > FLOW_DESCRIPTION_MAX)
      return { ok: false, error: `description must be at most ${FLOW_DESCRIPTION_MAX} characters` };
    out.description = b.description.trim();
  }
  if ("steps" in b || all) {
    const s = b.steps;
    if (!Array.isArray(s) || s.length < 1 || s.length > PIPELINE_MAX || !s.every((x) => typeof x === "string"))
      return { ok: false, error: `steps must be 1 to ${PIPELINE_MAX} template ids` };
    if (!(s as string[]).every(known)) return { ok: false, error: "steps: no such template" };
    out.steps = s as string[];
  }
  return { ok: true, value: out };
}

/**
 * The ordered roles a card goes through, most specific first: its own flow, its own single template,
 * its phase's flow, its phase's template, its repo's default flow, none. A flow or template that no
 * longer exists (or a flow whose templates are all gone) is skipped, never an error — the references
 * are soft. Pure.
 */
export function resolvePipeline(
  card: { templateId: string | null; pipelineId: string | null },
  phase: { templateId: string | null; pipelineId: string | null } | null,
  repoFlowId: string | null,
  templates: readonly AgentTemplate[],
  flows: readonly AgentFlow[],
): AgentTemplate[] {
  const one = (id: string | null | undefined) => {
    const t = id ? templates.find((x) => x.id === id) : undefined;
    return t ? [t] : [];
  };
  const flow = (id: string | null | undefined) => {
    const f = id ? flows.find((x) => x.id === id) : undefined;
    return f ? f.steps.flatMap((sid) => templates.find((t) => t.id === sid) ?? []) : [];
  };
  for (const found of [flow(card.pipelineId), one(card.templateId), flow(phase?.pipelineId), one(phase?.templateId), flow(repoFlowId)]) {
    if (found.length) return found;
  }
  return [];
}
