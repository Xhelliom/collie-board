import { apiRequest } from "@/lib/api";
import { t, type MessageKey } from "@/i18n";

// Agent templates (ADR 0026): a role for a worker — a brief, an agent kind, a model. The bridge owns
// them; this file is the wire types, the calls, and the one place a shipped template's name is
// localized (a custom one is shown as typed).

export interface AgentTemplate {
  id: string;
  key: string | null;
  name: string;
  description: string;
  agentKind: string | null;
  model: string | null;
  brief: string;
  builtin: boolean;
}

export interface TemplatesData {
  templates: AgentTemplate[];
  /** The agent kinds a template's model is passed to — the bridge says, so the screen never guesses. */
  modelKinds: string[];
}

export interface TemplateFields {
  name?: string;
  description?: string;
  agentKind?: string | null;
  model?: string | null;
  brief?: string;
}

export interface TemplateDraft {
  name: string;
  description: string;
  agentKind: string | null;
  model: string | null;
  brief: string;
}

export interface AgentFileCandidate {
  name: string;
  description: string;
  model: string | null;
  tools: string;
  brief: string;
}

export const fetchTemplates = (signal?: AbortSignal): Promise<TemplatesData> => apiRequest("/api/templates", { signal });
export const createTemplate = (input: TemplateFields): Promise<{ template: AgentTemplate }> =>
  apiRequest("/api/templates", { method: "POST", body: JSON.stringify(input) });
export const patchTemplate = (id: string, input: TemplateFields): Promise<{ template: AgentTemplate }> =>
  apiRequest(`/api/templates/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) });
export const deleteTemplate = (id: string): Promise<{ ok: true }> =>
  apiRequest(`/api/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
export const resetTemplate = (id: string): Promise<{ template: AgentTemplate }> =>
  apiRequest(`/api/templates/${encodeURIComponent(id)}/reset`, { method: "POST" });
/** The copilot's draft, returned and never saved. Spends the operator's quota: only from a tap. */
export const draftTemplate = (description: string, baseOn?: string | null): Promise<{ ok: true; draft: TemplateDraft }> =>
  apiRequest("/api/templates/draft", { method: "POST", body: JSON.stringify({ description, baseOn: baseOn ?? null }) });
/** What a repo's `.claude/agents/*.md` holds — a proposal; nothing is saved. */
export const importTemplates = (repoPath: string): Promise<{ candidates: AgentFileCandidate[] }> =>
  apiRequest("/api/templates/import", { method: "POST", body: JSON.stringify({ repoPath }) });

const BUILTIN_KEYS = ["implementer", "reviewer", "doc", "explore", "fix"] as const;
const isBuiltinKey = (k: string | null): k is (typeof BUILTIN_KEYS)[number] => !!k && (BUILTIN_KEYS as readonly string[]).includes(k);

/** A shipped template reads in the app's language; a custom one as its author wrote it. Pure over `t`. */
export function templateName(tpl: Pick<AgentTemplate, "key" | "builtin" | "name">): string {
  return tpl.builtin && isBuiltinKey(tpl.key) ? t(`templates.builtin.${tpl.key}.name` as MessageKey) : tpl.name;
}
export function templateDescription(tpl: Pick<AgentTemplate, "key" | "builtin" | "description">): string {
  return tpl.builtin && isBuiltinKey(tpl.key) ? t(`templates.builtin.${tpl.key}.description` as MessageKey) : tpl.description;
}
