import { useState } from "react";

import { AGENT_KIND_LABEL, type AgentKindOption } from "@/components/agent-kind-picker";
import { TemplatesSheet } from "@/components/templates-sheet";
import { useT } from "@/i18n";
import { boardErrorMessage, type Phase } from "@/lib/board";
import { flowName, flowSteps, type Flow } from "@/lib/flows";
import { setStatus } from "@/lib/status";
import { patchPhase, templateName, type TemplatesData } from "@/lib/templates";

// The default template of an open phase (ADR 0026): one quiet line under its goal. Cards of the phase
// that carry their own template keep it; the rest start with this one. `onChanged` reloads the page's
// data, which is where both the phases and the templates come from.
export function PhaseTemplate({
  phase,
  data,
  flows,
  onChanged,
}: {
  phase: Phase;
  data: TemplatesData | null | undefined;
  /** The flows (ADR 0032); the flow line is absent while null, as on an older bridge. */
  flows?: Flow[] | null;
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

  const flow = flows?.find((f) => f.id === phase.pipelineId) ?? null;
  async function pickFlow(id: string) {
    try {
      await patchPhase(phase.id, { pipelineId: id || null });
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
    {flows && (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs text-muted-foreground" title={t("flows.picker.hint")}>
        <label className="flex items-center gap-1.5">
          {t("flows.picker.label")}
          <select
            aria-label={t("flows.picker.label")}
            value={phase.pipelineId ?? ""}
            onChange={(e) => void pickFlow(e.target.value)}
            className="h-7 rounded-md border border-border bg-background px-1.5 text-xs font-semibold text-foreground"
          >
            <option value="">{t("flows.picker.none")}</option>
            {flows.map((f) => (
              <option key={f.id} value={f.id}>
                {flowName(f)}
              </option>
            ))}
          </select>
        </label>
        {flow && <span>{flowSteps(flow, data.templates)}</span>}
      </div>
    )}
    </div>
  );
}
