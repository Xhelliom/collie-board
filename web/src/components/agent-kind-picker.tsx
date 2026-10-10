import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { AgentIcon } from "@/components/agent-icon";

// The harnesses a card can launch. `null` = the bridge default
// (`COLLIE_BOARD_AGENT_KIND`, `bridge/config.ts:290`). The four are the ones
// with a slash-command catalog and a brand icon in the UI; anything else
// stays reachable via the API (`agentKind` in `bridge/board-routes.ts:149`).
export const AGENT_KIND_OPTIONS = ["claude", "codex", "cursor", "opencode"] as const;

export type AgentKindOption = (typeof AGENT_KIND_OPTIONS)[number];

export const AGENT_KIND_LABEL: Record<AgentKindOption, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
};

/**
 * Pick which harness a card will launch. Phone-first: a 2×2 grid of large
 * tap targets with the agent's own icon, not a dropdown. `value: null` is
 * the bridge default — shown as its own row so "not choosing" stays a
 * visible choice rather than an empty state.
 */
export function AgentKindPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (kind: string | null) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{t("agentpicker.label")}</span>
      <div className="grid grid-cols-2 gap-1.5">
        {AGENT_KIND_OPTIONS.map((kind) => {
          const active = value === kind;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onChange(kind)}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm active:scale-[0.99]",
                active ? "border-primary bg-primary/10" : "border-border bg-background",
              )}
            >
              <AgentIcon agent={kind} className="size-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {AGENT_KIND_LABEL[kind]}
              </span>
            </button>
          );
        })}
      </div>
      <p className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <span>
          {value === null
            ? t("agentpicker.default")
            : t("agentpicker.will")}
        </span>
        {value !== null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 underline underline-offset-4"
          >
            {t("agentpicker.reset")}
          </button>
        )}
      </p>
    </div>
  );
}
