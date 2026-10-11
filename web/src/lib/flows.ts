import { apiRequest } from "@/lib/api";
import { t, type MessageKey } from "@/i18n";
import type { AgentTemplate } from "@/lib/templates";
import { templateName } from "@/lib/templates";

// Flows (ADR 0032): a named, ordered list of templates — "implement, then review" — defined once and
// picked on a repo, a phase or a card. In a run each step is a fresh agent on the same branch. The
// bridge owns them; this file is the wire types, the calls, and the one place a shipped flow's name
// is localized (a custom one is shown as typed).

export interface Flow {
  id: string;
  key: string | null;
  name: string;
  description: string;
  /** Template ids, in order. */
  steps: string[];
  builtin: boolean;
}

export interface FlowFields {
  name?: string;
  description?: string;
  steps?: string[];
}

export const fetchFlows = (signal?: AbortSignal): Promise<{ flows: Flow[] }> => apiRequest("/api/flows", { signal });
export const createFlow = (input: FlowFields): Promise<{ flow: Flow }> =>
  apiRequest("/api/flows", { method: "POST", body: JSON.stringify(input) });
export const patchFlow = (id: string, input: FlowFields): Promise<{ flow: Flow }> =>
  apiRequest(`/api/flows/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
export const deleteFlow = (id: string): Promise<{ ok: true }> =>
  apiRequest(`/api/flows/${encodeURIComponent(id)}`, { method: "DELETE" });
export const resetFlow = (id: string): Promise<{ flow: Flow }> =>
  apiRequest(`/api/flows/${encodeURIComponent(id)}/reset`, { method: "POST" });

const BUILTIN_KEYS = ["code", "doc", "explore"] as const;
const isBuiltinKey = (k: string | null): k is (typeof BUILTIN_KEYS)[number] => !!k && (BUILTIN_KEYS as readonly string[]).includes(k);

/** A shipped flow reads in the app's language; a custom one as its author wrote it. */
export function flowName(f: Pick<Flow, "key" | "builtin" | "name">): string {
  return f.builtin && isBuiltinKey(f.key) ? t(`flows.builtin.${f.key}.name` as MessageKey) : f.name;
}
export function flowDescription(f: Pick<Flow, "key" | "builtin" | "description">): string {
  return f.builtin && isBuiltinKey(f.key) ? t(`flows.builtin.${f.key}.description` as MessageKey) : f.description;
}

/** `Implementer → Reviewer`: the flow's steps by name; a template that no longer exists is skipped. Pure. */
export function flowSteps(f: Pick<Flow, "steps">, templates: readonly AgentTemplate[]): string {
  return f.steps.flatMap((id) => templates.find((x) => x.id === id) ?? []).map(templateName).join(" → ");
}
