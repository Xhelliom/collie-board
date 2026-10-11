import { useFlows } from "@/hooks/use-flows";
import { useTemplates } from "@/hooks/use-templates";
import { useT } from "@/i18n";
import { flowName, flowSteps } from "@/lib/flows";

// "Which chain of roles does this card go through?" (ADR 0032) — a select, like the template picker,
// with the steps said under it. Renders nothing until the bridge has answered (an older bridge has no flows).
export function FlowPicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const t = useT();
  const { flows } = useFlows();
  const { data } = useTemplates();
  if (!flows || !data) return null;
  const sel = flows.find((f) => f.id === value) ?? null;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{t("flows.picker.label")}</span>
      <select
        aria-label={t("flows.picker.label")}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <option value="">{t("flows.picker.none")}</option>
        {flows.map((f) => (
          <option key={f.id} value={f.id}>
            {flowName(f)}
          </option>
        ))}
      </select>
      <p className="px-1 text-xs text-muted-foreground">
        {sel ? `${flowSteps(sel, data.templates)}. ` : ""}
        {t("flows.picker.hint")}
      </p>
    </label>
  );
}
