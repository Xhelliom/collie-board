import { useState } from "react";

import { AGENT_KIND_LABEL, type AgentKindOption } from "@/components/agent-kind-picker";
import { TemplatesSheet } from "@/components/templates-sheet";
import { useT } from "@/i18n";
import { boardErrorMessage, type Phase } from "@/lib/board";
import { setStatus } from "@/lib/status";
import { patchPhase, templateName, type TemplatesData } from "@/lib/templates";

// The default template of an open phase (ADR 0026): one quiet line under its goal. Cards of the phase
// that carry their own template keep it; the rest start with this one. `onChanged` reloads the page's
// data, which is where both the phases and the templates come from.
export function PhaseTemplate({
  phase,
  data,
  onChanged,
}: {
  phase: Phase;
  data: TemplatesData | null | undefined;
  onChanged: () => void;
}) {
  const t = useT();
  const [managing, setManaging] = useState(false);
  if (!data) return null;
  const sel = data.templates.find((x) => x.id === phase.templateId) ?? null;
  const kind = sel?.agentKind ? (AGENT_KIND_LABEL[sel.agentKind as AgentKindOption] ?? sel.agentKind) : t("templates.agentDefault");

  async function pick(id: string) {
    try {
      await patchPhase(phase.id, { templateId: id || null });
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
    onChanged();
  }

  const steps = phase.pipeline ?? [];
  async function setPipeline(next: string[]) {
    try {
      await patchPhase(phase.id, { pipeline: next.length ? next : null });
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
    onChanged();
  }

  return (
    <div className="-mt-1 flex flex-col pb-1">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pb-1 text-xs text-muted-foreground">
      <label className="flex items-center gap-1.5">
        {t("templates.phase.label")}
        <select
          aria-label={t("templates.phase.label")}
          value={phase.templateId ?? ""}
          onChange={(e) => void pick(e.target.value)}
          className="h-7 rounded-md border border-border bg-background px-1.5 text-xs font-semibold text-foreground"
        >
          <option value="">{t("templates.picker.none")}</option>
          {data.templates.map((x) => (
            <option key={x.id} value={x.id}>
              {templateName(x)}
            </option>
          ))}
        </select>
      </label>
      <span>
        {sel
          ? sel.model
            ? t("templates.picker.runs", { kind, model: sel.model })
            : t("templates.picker.runsKind", { kind })
          : t("templates.phase.hint")}
      </span>
      <button type="button" onClick={() => setManaging(true)} className="font-semibold text-brand">
        {t("templates.manageLink")}
      </button>
      <TemplatesSheet open={managing} onClose={() => setManaging(false)} data={data} onChanged={onChanged} />
    </div>
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-1 text-xs text-muted-foreground" title={t("templates.pipeline.hint")}>
      <span>{t("templates.pipeline.label")}</span>
      {steps.map((id, i) => {
        const tpl = data.templates.find((x) => x.id === id);
        if (!tpl) return null;
        return (
          <span key={`${id}-${i}`} className="inline-flex items-center gap-1">
            {i > 0 && <span aria-hidden="true">→</span>}
            <button
              type="button"
              aria-label={t("templates.pipeline.remove", { name: templateName(tpl) })}
              onClick={() => void setPipeline(steps.filter((_, j) => j !== i))}
              className="rounded-full border bg-card/70 px-2 py-0.5 font-semibold text-foreground hover:border-foreground/25"
            >
              {templateName(tpl)} ×
            </button>
          </span>
        );
      })}
      <select
        aria-label={t("templates.pipeline.add")}
        value=""
        onChange={(e) => e.target.value && void setPipeline([...steps, e.target.value])}
        className="h-7 rounded-md border border-border bg-background px-1.5 text-xs font-semibold text-foreground"
      >
        <option value="">+ {t("templates.pipeline.add")}</option>
        {data.templates.map((x) => (
          <option key={x.id} value={x.id}>
            {templateName(x)}
          </option>
        ))}
      </select>
    </div>
    </div>
  );
}
