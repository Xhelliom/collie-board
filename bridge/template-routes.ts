// `/api/templates` — agent templates (ADR 0026): list, create, edit, delete, reset, draft with the
// copilot, and import from a repo's `.claude/agents/*.md`.
//
// NOTHING HERE APPLIES A TEMPLATE. Applying one is `startCard`'s job, at the operator's tap. `draft`
// and `import` only RETURN what they found: a template comes into the board when the operator saves
// it — a repository does not get to decide what an agent is told (ADR 0020's reasoning, again).

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";

import { BUILTIN_ADAPTERS, type AgentAdapter } from "./adapters.ts";
import { PANE_HEADER, type BoardContext } from "./board-routes.ts";
import {
  AGENT_FILE_MAX_BYTES,
  draftPrompt,
  isKind,
  isModel,
  parseAgentFile,
  TEMPLATE_BRIEF_MAX,
  TEMPLATE_DESCRIPTION_MAX,
  TEMPLATE_NAME_MAX,
  toTemplateDraft,
  type AgentFile,
} from "./templates.ts";

export const TEMPLATES_ROUTE = "/api/templates";
const ONE = /^\/api\/templates\/([^/]+?)(?:\/(reset))?$/;
const MAX_IMPORT_FILES = 50;

const isRepoRoot = (p: unknown): p is string => typeof p === "string" && isAbsolute(p) && existsSync(join(p, ".git"));

async function bodyOf(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = await req.json();
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type Fields = { name?: string; description?: string; agentKind?: string | null; model?: string | null; brief?: string };

/** Validate an untrusted template body. `all`: a create, where name and brief are required. Pure + exported. */
export function parseTemplateBody(b: Record<string, unknown>, all: boolean): { ok: true; value: Fields } | { ok: false; error: string } {
  const out: Fields = {};
  if ("name" in b || all) {
    if (typeof b.name !== "string" || b.name.trim() === "" || b.name.trim().length > TEMPLATE_NAME_MAX)
      return { ok: false, error: `name must be 1 to ${TEMPLATE_NAME_MAX} characters` };
    out.name = b.name.trim();
  }
  if ("description" in b) {
    if (typeof b.description !== "string" || b.description.length > TEMPLATE_DESCRIPTION_MAX)
      return { ok: false, error: `description must be at most ${TEMPLATE_DESCRIPTION_MAX} characters` };
    out.description = b.description.trim();
  }
  if ("agentKind" in b) {
    if (b.agentKind !== null && !isKind(b.agentKind)) return { ok: false, error: "agentKind must be an agent kind or null" };
    out.agentKind = b.agentKind;
  }
  if ("model" in b) {
    // One model word, never a flag: it rides to the CLI behind the kind's own flag (templates.ts).
    if (b.model !== null && !isModel(b.model)) return { ok: false, error: "model must be a single model name or null" };
    out.model = b.model;
  }
  if ("brief" in b || all) {
    if (typeof b.brief !== "string" || b.brief.trim() === "" || b.brief.length > TEMPLATE_BRIEF_MAX)
      return { ok: false, error: `brief must be 1 to ${TEMPLATE_BRIEF_MAX} characters` };
    out.brief = b.brief.trim();
  }
  return { ok: true, value: out };
}

/**
 * The agent files of a repo, read-only. A symlink is skipped (it could point anywhere), the folder
 * itself must resolve inside the repo, and a file over the size cap or past the count cap is not read.
 */
export function readAgentFiles(repoPath: string): AgentFile[] {
  const dir = join(repoPath, ".claude", "agents");
  if (!existsSync(dir)) return [];
  const root = realpathSync(repoPath);
  const real = realpathSync(dir);
  if (real !== root && !real.startsWith(root + sep)) return [];
  const out: AgentFile[] = [];
  for (const name of readdirSync(real).filter((n) => n.endsWith(".md")).sort().slice(0, MAX_IMPORT_FILES)) {
    const file = join(real, name);
    const st = lstatSync(file);
    if (!st.isFile() || st.size > AGENT_FILE_MAX_BYTES) continue;
    const parsed = parseAgentFile(readFileSync(file, "utf8"));
    if (parsed) out.push(parsed);
  }
  return out;
}

/** The kinds that take a model — the single source of truth the screen reads, so it never guesses. */
const modelKindsOf = (adapters: Record<string, AgentAdapter>): string[] =>
  Object.values(adapters)
    .filter((a) => a.modelFlag)
    .map((a) => a.kind);

export async function handleTemplateRoute(pathname: string, req: Request, ctx: BoardContext): Promise<Response | null> {
  if (pathname !== TEMPLATES_ROUTE && !pathname.startsWith(`${TEMPLATES_ROUTE}/`)) return null;
  const { db } = ctx;
  const pane = req.headers.get(PANE_HEADER)?.trim();
  const audit = (action: string, detail: Record<string, unknown>) =>
    ctx.audit.record({ action, session: ctx.session, device: ctx.device, detail: { ...detail, ...(pane ? { pane } : {}) } });

  if (pathname === TEMPLATES_ROUTE) {
    if (req.method === "GET") {
      const denied = ctx.guard("read");
      if (denied) return denied;
      return ctx.json({ templates: db.listTemplates(), modelKinds: modelKindsOf(ctx.adapters ?? BUILTIN_ADAPTERS) });
    }
    if (req.method !== "POST") return ctx.text("method not allowed", 405);
    const denied = ctx.guard("write");
    if (denied) return denied;
    const b = await bodyOf(req);
    if (!b) return ctx.text("bad body", 400);
    const parsed = parseTemplateBody(b, true);
    if (!parsed.ok) return ctx.text(parsed.error, 400);
    const template = db.createTemplate({ ...parsed.value, name: parsed.value.name!, brief: parsed.value.brief! });
    audit("template.create", { templateId: template.id, name: template.name });
    return ctx.json({ template }, 201);
  }

  // The two verbs that are not about one template — before the `:id` pattern would swallow them.
  if (pathname === `${TEMPLATES_ROUTE}/draft` || pathname === `${TEMPLATES_ROUTE}/import`) {
    if (req.method !== "POST") return ctx.text("method not allowed", 405);
    const denied = ctx.guard("write");
    if (denied) return denied;
    const b = await bodyOf(req);
    if (!b) return ctx.text("bad body", 400);

    if (pathname.endsWith("/import")) {
      if (!isRepoRoot(b.repoPath)) return ctx.text("repoPath must be the root of a repository", 400);
      const candidates = readAgentFiles(b.repoPath);
      audit("template.import", { repoPath: b.repoPath, found: candidates.length });
      return ctx.json({ candidates });
    }

    if (typeof b.description !== "string" || b.description.trim() === "" || b.description.length > 2000)
      return ctx.text("description must be 1 to 2000 characters", 400);
    if (b.baseOn !== undefined && b.baseOn !== null && (typeof b.baseOn !== "string" || !db.getTemplate(b.baseOn)))
      return ctx.text("baseOn: no such template", 400);
    if (!ctx.cfg.boardCopilot)
      return ctx.json({ ok: false, error: "the copilot is off (COLLIE_BOARD_COPILOT)", kind: "disabled" }, 409);
    const base = typeof b.baseOn === "string" ? db.getTemplate(b.baseOn)!.brief : null;
    const raw = await ctx.copilot.ask((outPath) => draftPrompt({ description: b.description as string, baseOn: base, outPath }));
    audit("template.draft", { ok: raw !== null });
    if (raw === null) return ctx.json({ ok: false, kind: "no-answer", error: "the copilot gave no answer in time" }, 502);
    try {
      return ctx.json({ ok: true, draft: toTemplateDraft(raw) });
    } catch (err) {
      return ctx.json({ ok: false, kind: "malformed", error: (err as Error).message }, 502);
    }
  }

  const m = ONE.exec(pathname);
  if (!m) return ctx.text("not found", 404);
  const id = decodeURIComponent(m[1]!);

  if (m[2] === "reset") {
    if (req.method !== "POST") return ctx.text("method not allowed", 405);
    const denied = ctx.guard("write");
    if (denied) return denied;
    const t = db.getTemplate(id);
    if (!t) return ctx.text("template not found", 404);
    const reset = db.resetTemplate(id);
    if (!reset) return ctx.text("only a shipped template can be reset", 409);
    audit("template.reset", { templateId: id, key: t.key });
    return ctx.json({ template: reset });
  }

  if (req.method === "PATCH") {
    const denied = ctx.guard("write");
    if (denied) return denied;
    const b = await bodyOf(req);
    if (!b) return ctx.text("bad body", 400);
    const parsed = parseTemplateBody(b, false);
    if (!parsed.ok) return ctx.text(parsed.error, 400);
    const template = db.updateTemplate(id, parsed.value);
    if (!template) return ctx.text("template not found", 404);
    audit("template.update", { templateId: id });
    return ctx.json({ template });
  }
  if (req.method === "DELETE") {
    const denied = ctx.guard("write");
    if (denied) return denied;
    const r = db.deleteTemplate(id);
    if (r === "missing") return ctx.text("template not found", 404);
    if (r === "builtin") return ctx.text("a shipped template is reset, not deleted", 409);
    audit("template.delete", { templateId: id });
    return ctx.json({ ok: true });
  }
  return ctx.text("method not allowed", 405);
}
