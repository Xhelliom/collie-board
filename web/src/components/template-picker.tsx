import { AGENT_KIND_LABEL, type AgentKindOption } from "@/components/agent-kind-picker";
import { useTemplates } from "@/hooks/use-templates";
import { useT } from "@/i18n";
import { templateName } from "@/lib/templates";

// "Which role does this card want?" — a select, because the list is short and a select is what a
// phone does best. What the choice imposes (agent, model) is said under it, so picking a template
// is never a surprise at Start. Renders nothing until the bridge has answered.
export function TemplatePicker({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const t = useT();
  const { data } = useTemplates();
  if (!data || data.templates.length === 0) return null;
  const sel = data.templates.find((x) => x.id === value) ?? null;
  const kind = sel?.agentKind ? (AGENT_KIND_LABEL[sel.agentKind as AgentKindOption] ?? sel.agentKind) : t("templates.agentDefault");
  const ignored = !!sel?.model && !!sel.agentKind && !data.modelKinds.includes(sel.agentKind);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{t("templates.picker.label")}</span>
      <select
        aria-label={t("templates.picker.label")}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <option value="">{t("templates.picker.none")}</option>
        {data.templates.map((x) => (
          <option key={x.id} value={x.id}>
            {templateName(x)}
          </option>
        ))}
      </select>
      <p className="px-1 text-xs text-muted-foreground">
        {sel
          ? [
              sel.model ? t("templates.picker.runs", { kind, model: sel.model }) : t("templates.picker.runsKind", { kind }),
              ignored ? t("templates.picker.modelIgnored", { kind }) : "",
              t("templates.picker.inherit"),
            ]
              .filter(Boolean)
              .join(" ")
          : t("templates.picker.inherit")}
      </p>
    </label>
  );
}
