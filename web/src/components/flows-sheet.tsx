import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { boardErrorMessage } from "@/lib/board";
import { createFlow, deleteFlow, flowDescription, flowName, flowSteps, patchFlow, resetFlow, type Flow } from "@/lib/flows";
import { setStatus } from "@/lib/status";
import { templateName, type AgentTemplate } from "@/lib/templates";

// The flows screen (ADR 0032): the list and an editor, two views of one sheet — the template screen's shape.
// The steps are templates, picked from the list the bridge sends; a flow holds one to six of them.

const MAX_STEPS = 6;
type View = { kind: "list" } | { kind: "edit"; flow: Flow | null };

const field =
  "h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function FlowsSheet({
  open,
  onClose,
  flows,
  templates,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  flows: Flow[];
  templates: AgentTemplate[];
  onChanged: () => void;
}) {
  const t = useT();
  const [view, setView] = useState<View>({ kind: "list" });
  useEffect(() => {
    if (open) setView({ kind: "list" });
  }, [open]);

  return (
    <BottomSheet open={open} onClose={onClose} title={t("flows.title")}>
      {view.kind === "list" ? (
        <List flows={flows} templates={templates} onView={setView} onChanged={onChanged} />
      ) : (
        <Editor
          key={view.flow?.id ?? "new"}
          flow={view.flow}
          templates={templates}
          onBack={() => setView({ kind: "list" })}
          onSaved={() => {
            onChanged();
            setView({ kind: "list" });
          }}
        />
      )}
    </BottomSheet>
  );
}

function List({ flows, templates, onView, onChanged }: { flows: Flow[]; templates: AgentTemplate[]; onView: (v: View) => void; onChanged: () => void }) {
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
      <div>
        <Button variant="brand" className="h-9 gap-1.5 px-3 text-sm" onClick={() => onView({ kind: "edit", flow: null })}>
          <Plus className="size-4" />
          {t("flows.new")}
        </Button>
      </div>
      {flows.length === 0 && <p className="text-sm text-muted-foreground">{t("flows.empty")}</p>}
      <ul className="flex flex-col gap-2">
        {flows.map((f) => (
          <li key={f.id} className="flex flex-col gap-2 rounded-xl border bg-card/60 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-sm font-semibold">{flowName(f)}</span>
              {f.builtin && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{t("flows.shipped")}</span>}
            </div>
            <p className="text-[13px] leading-snug text-muted-foreground">{flowSteps(f, templates)}</p>
            {flowDescription(f) && <p className="text-[13px] leading-snug text-muted-foreground">{flowDescription(f)}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => onView({ kind: "edit", flow: f })}>
                {t("flows.edit")}
              </Button>
              {f.builtin ? (
                <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => void run(() => resetFlow(f.id))}>
                  {t("flows.reset")}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className="h-8 px-3 text-xs text-status-blocked"
                  onClick={() => {
                    if (confirming !== f.id) return setConfirming(f.id);
                    setConfirming(null);
                    void run(() => deleteFlow(f.id));
                  }}
                >
                  {confirming === f.id ? t("flows.deleteConfirm") : t("flows.delete")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Editor({ flow, templates, onBack, onSaved }: { flow: Flow | null; templates: AgentTemplate[]; onBack: () => void; onSaved: () => void }) {
  const t = useT();
  const [name, setName] = useState(flow?.name ?? "");
  const [description, setDescription] = useState(flow?.description ?? "");
  const [steps, setSteps] = useState<string[]>(flow?.steps ?? []);
  const [busy, setBusy] = useState(false);

  const shipped = !!flow?.builtin;
  const canSave = (shipped || name.trim() !== "") && steps.length > 0 && !busy;
  const nameOf = (id: string) => {
    const tpl = templates.find((x) => x.id === id);
    return tpl ? templateName(tpl) : id;
  };
  const move = (i: number, d: number) =>
    setSteps((s) => {
      const next = [...s];
      [next[i], next[i + d]] = [next[i + d]!, next[i]!];
      return next;
    });

  async function save() {
    setBusy(true);
    try {
      const fields = { description: description.trim(), steps };
      // A shipped flow keeps its name: it is localized by its key.
      if (flow) await patchFlow(flow.id, shipped ? fields : { ...fields, name: name.trim() });
      else await createFlow({ ...fields, name: name.trim() });
      setStatus(t("flows.saved"), "success");
      onSaved();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={onBack} className="-ml-1 inline-flex items-center gap-1 self-start text-xs font-semibold text-brand">
        <ChevronLeft className="size-4" />
        {t("flows.back")}
      </button>
      {!shipped && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t("flows.field.name")}</span>
          <input aria-label={t("flows.field.name")} value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{t("flows.field.description")}</span>
        <input aria-label={t("flows.field.description")} value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">{t("flows.field.steps")}</span>
        <ol className="flex flex-col gap-1.5">
          {steps.map((id, i) => (
            <li key={`${id}-${i}`} className="flex items-center gap-1.5 rounded-lg border bg-card/60 px-3 py-1.5 text-sm">
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{nameOf(id)}</span>
              <button type="button" disabled={i === 0} aria-label={t("flows.step.up", { name: nameOf(id) })} onClick={() => move(i, -1)} className="p-1 text-muted-foreground disabled:opacity-30">
                <ArrowUp className="size-4" />
              </button>
              <button type="button" disabled={i === steps.length - 1} aria-label={t("flows.step.down", { name: nameOf(id) })} onClick={() => move(i, 1)} className="p-1 text-muted-foreground disabled:opacity-30">
                <ArrowDown className="size-4" />
              </button>
              <button type="button" aria-label={t("flows.step.remove", { name: nameOf(id) })} onClick={() => setSteps((s) => s.filter((_, j) => j !== i))} className="p-1 text-muted-foreground">
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ol>
        {steps.length < MAX_STEPS ? (
          <select
            aria-label={t("flows.step.add")}
            value=""
            onChange={(e) => e.target.value && setSteps((s) => [...s, e.target.value])}
            className={field}
          >
            <option value="">+ {t("flows.step.add")}</option>
            {templates.map((x) => (
              <option key={x.id} value={x.id}>
                {templateName(x)}
              </option>
            ))}
          </select>
        ) : (
          <span className="px-1 text-xs text-muted-foreground">{t("flows.stepsMax")}</span>
        )}
      </div>
      <Button variant="brand" className="w-full" disabled={!canSave} onClick={() => void save()}>
        {busy ? t("flows.saving") : t("flows.save")}
      </Button>
    </div>
  );
}
