import { useEffect, useState } from "react";
import { ChevronLeft, FileDown, Plus, Sparkles } from "lucide-react";

import { AgentKindPicker } from "@/components/agent-kind-picker";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { boardErrorMessage, fetchRepos, repoName, type RepoChoice } from "@/lib/board";
import { setStatus } from "@/lib/status";
import {
  createTemplate,
  deleteTemplate,
  draftTemplate,
  importTemplates,
  patchTemplate,
  resetTemplate,
  templateDescription,
  templateName,
  type AgentFileCandidate,
  type AgentTemplate,
  type TemplatesData,
} from "@/lib/templates";

// The templates screen (ADR 0026): the list, an editor, and an import from a repo. Three views of one
// sheet. Nothing is saved by the copilot's draft or by a repo's files — both only FILL what you then
// read and save yourself.

type View = { kind: "list" } | { kind: "edit"; template: AgentTemplate | null } | { kind: "import" };

/** A model is one word — the bridge refuses anything else; checked here so the form says so before the tap. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;

const input =
  "h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function TemplatesSheet({
  open,
  onClose,
  data,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  data: TemplatesData;
  onChanged: () => void;
}) {
  const t = useT();
  const [view, setView] = useState<View>({ kind: "list" });
  // Back on the list whenever the sheet is reopened — a half-edited form from last time is not a place to land.
  useEffect(() => {
    if (open) setView({ kind: "list" });
  }, [open]);

  const done = () => {
    onChanged();
    setView({ kind: "list" });
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={t("templates.title")}>
      {view.kind === "list" && <List data={data} onView={setView} onChanged={onChanged} />}
      {view.kind === "edit" && <Editor key={view.template?.id ?? "new"} template={view.template} data={data} onBack={() => setView({ kind: "list" })} onSaved={done} />}
      {view.kind === "import" && <Import onBack={() => setView({ kind: "list" })} onSaved={done} />}
    </BottomSheet>
  );
}

function List({ data, onView, onChanged }: { data: TemplatesData; onView: (v: View) => void; onChanged: () => void }) {
  const t = useT();
  const [confirming, setConfirming] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
    onChanged();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="brand" className="h-9 gap-1.5 px-3 text-sm" onClick={() => onView({ kind: "edit", template: null })}>
          <Plus className="size-4" />
          {t("templates.new")}
        </Button>
        <Button variant="outline" className="h-9 gap-1.5 px-3 text-sm" onClick={() => onView({ kind: "import" })}>
          <FileDown className="size-4" />
          {t("templates.import")}
        </Button>
      </div>
      {data.templates.length === 0 && <p className="text-sm text-muted-foreground">{t("templates.empty")}</p>}
      <ul className="flex flex-col gap-2">
        {data.templates.map((tpl) => (
          <li key={tpl.id} className="flex flex-col gap-2 rounded-xl border bg-card/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-sm font-semibold">{templateName(tpl)}</span>
              {tpl.builtin && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{t("templates.shipped")}</span>}
              <span className="font-mono text-[11px] text-muted-foreground">
                {tpl.agentKind ?? t("templates.agentDefault")}
                {tpl.model ? ` · ${tpl.model}` : ""}
              </span>
            </div>
            {templateDescription(tpl) && <p className="text-[13px] leading-snug text-muted-foreground">{templateDescription(tpl)}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => onView({ kind: "edit", template: tpl })}>
                {t("templates.edit")}
              </Button>
              {tpl.builtin ? (
                <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => void run(() => resetTemplate(tpl.id))}>
                  {t("templates.reset")}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className="h-8 px-3 text-xs text-status-blocked"
                  onClick={() => {
                    if (confirming !== tpl.id) return setConfirming(tpl.id);
                    setConfirming(null);
                    void run(() => deleteTemplate(tpl.id));
                  }}
                >
                  {confirming === tpl.id ? t("templates.deleteConfirm") : t("templates.delete")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BackBar({ onBack }: { onBack: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onBack} className="-ml-1 mb-3 inline-flex items-center gap-1 text-xs font-semibold text-brand">
      <ChevronLeft className="size-4" />
      {t("templates.back")}
    </button>
  );
}

function Editor({
  template,
  data,
  onBack,
  onSaved,
}: {
  template: AgentTemplate | null;
  data: TemplatesData;
  onBack: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [agentKind, setAgentKind] = useState<string | null>(template?.agentKind ?? null);
  const [model, setModel] = useState(template?.model ?? "");
  const [brief, setBrief] = useState(template?.brief ?? "");
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState<"draft" | "save" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const shipped = !!template?.builtin;
  const modelBad = model.trim() !== "" && !MODEL.test(model.trim());
  const modelIgnored = model.trim() !== "" && !!agentKind && !data.modelKinds.includes(agentKind);
  const canSave = (shipped || name.trim() !== "") && brief.trim() !== "" && !modelBad && busy === null;

  async function draft() {
    setBusy("draft");
    setNote(null);
    try {
      const r = await draftTemplate(ask.trim(), template?.id ?? null);
      // Fills the form; saves nothing. A shipped template keeps its name (it is localized by its key).
      if (!shipped) setName(r.draft.name);
      setDescription(r.draft.description);
      setAgentKind(r.draft.agentKind);
      setModel(r.draft.model ?? "");
      setBrief(r.draft.brief);
      setNote(t("templates.draft.done"));
    } catch (e) {
      setNote(t("templates.draft.failed", { error: boardErrorMessage(e) }));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      const fields = { description: description.trim(), agentKind, model: model.trim() || null, brief: brief.trim() };
      if (template) await patchTemplate(template.id, shipped ? fields : { ...fields, name: name.trim() });
      else await createTemplate({ ...fields, name: name.trim() });
      setStatus(t("templates.saved"), "success");
      onSaved();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <BackBar onBack={onBack} />

      <section aria-label={t("templates.draft.title")} className="flex flex-col gap-2 rounded-xl border border-dashed p-3">
        <span className="text-xs font-semibold text-muted-foreground">{t("templates.draft.title")}</span>
        <textarea
          aria-label={t("templates.draft.field")}
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          rows={2}
          placeholder={t("templates.draft.placeholder")}
          className="min-h-16 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <Button variant="outline" className="h-9 gap-1.5 self-start px-3 text-sm" disabled={busy !== null || ask.trim() === ""} onClick={() => void draft()}>
          <Sparkles className="size-4" />
          {busy === "draft" ? t("templates.draft.busy") : t("templates.draft.go")}
        </Button>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </section>

      {!shipped && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t("templates.field.name")}</span>
          <input aria-label={t("templates.field.name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={input} />
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{t("templates.field.description")}</span>
        <input aria-label={t("templates.field.description")} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} className={input} />
      </label>
      <AgentKindPicker value={agentKind} onChange={setAgentKind} />
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{t("templates.field.model")}</span>
        <input
          aria-label={t("templates.field.model")}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          list="template-models"
          placeholder="sonnet"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={modelBad}
          className={`${input} font-mono`}
        />
        <datalist id="template-models">
          <option value="sonnet" />
          <option value="opus" />
          <option value="haiku" />
        </datalist>
        <span className="px-1 text-xs text-muted-foreground">
          {modelBad ? t("templates.modelInvalid") : t("templates.modelOnly", { kinds: data.modelKinds.join(", ") || "—" })}
          {modelIgnored && !modelBad ? ` ${t("templates.picker.modelIgnored", { kind: agentKind! })}` : ""}
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{t("templates.field.brief")}</span>
        <textarea
          aria-label={t("templates.field.brief")}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={12}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[13px] leading-snug outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <span className="px-1 text-xs text-muted-foreground">{t("templates.briefHint")}</span>
      </label>
      <Button variant="brand" className="w-full" disabled={!canSave} onClick={() => void save()}>
        {busy === "save" ? t("templates.saving") : t("templates.save")}
      </Button>
    </div>
  );
}

function Import({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const t = useT();
  const [repos, setRepos] = useState<RepoChoice[]>([]);
  const [repo, setRepo] = useState("");
  const [found, setFound] = useState<AgentFileCandidate[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetchRepos({}, ac.signal)
      .then((r) => setRepos(r.repos))
      .catch(() => {});
    return () => ac.abort();
  }, []);

  async function search() {
    setBusy(true);
    try {
      const r = await importTemplates(repo);
      setFound(r.candidates);
      setPicked(new Set());
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const chosen = [...picked].map((i) => found![i]!);
      for (const c of chosen) {
        await createTemplate({ name: c.name, description: c.description, model: c.model, brief: c.brief });
      }
      setStatus(t("templates.import.saved", { count: chosen.length }), "success");
      onSaved();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <BackBar onBack={onBack} />
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{t("templates.import.repo")}</span>
        <select aria-label={t("templates.import.repo")} value={repo} onChange={(e) => setRepo(e.target.value)} className={input}>
          <option value="" />
          {repos.map((r) => (
            <option key={r.path} value={r.path}>
              {repoName(r.path)}
            </option>
          ))}
        </select>
      </label>
      <Button variant="outline" className="self-start" disabled={!repo || busy} onClick={() => void search()}>
        {t("templates.import.search")}
      </Button>
      {found && found.length === 0 && <p className="text-sm text-muted-foreground">{t("templates.import.none")}</p>}
      {found && found.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">{t("templates.import.found", { count: found.length })}</p>
          <ul className="flex flex-col gap-2">
            {found.map((c, i) => (
              <li key={`${c.name}-${i}`} className="rounded-xl border bg-card/60 p-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-4"
                    checked={picked.has(i)}
                    onChange={() =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-semibold">{c.name}</span>
                    {c.description && <span className="text-[13px] leading-snug text-muted-foreground">{c.description}</span>}
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {c.model ?? "—"}
                      {c.tools ? ` · ${t("templates.import.tools", { tools: c.tools })}` : ""}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <Button variant="brand" className="w-full" disabled={picked.size === 0 || busy} onClick={() => void save()}>
            {t("templates.import.save", { count: picked.size })}
          </Button>
        </>
      )}
    </div>
  );
}
