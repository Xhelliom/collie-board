import { Pin as PinIcon, X } from "lucide-react";

import { useT } from "@/i18n";
import { pinId, pinKey, setPinned, usePins, type Pin, type PinTarget } from "@/lib/pins";
import { setStatus } from "@/lib/status";
import { placeOf } from "@/lib/agent-groups";
import { paneDisplayName, type AgentView } from "@/lib/types";
import { cn } from "@/lib/utils";

const toggle = (target: PinTarget, name: string, pinned: boolean, failed: string) =>
  setPinned(target, name, pinned).catch(() => setStatus(failed, "error"));

/** Pin / unpin one target — a project, a card, an agent's session — to the sidebar. */
export function PinToggle({ target, name, className }: { target: PinTarget; name: string; className?: string }) {
  const t = useT();
  const pins = usePins();
  const on = pins.some((p) => pinId(p) === pinId(target));
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={t(on ? "pin.remove" : "pin.add")}
      title={t(on ? "pin.remove" : "pin.add")}
      onClick={(e) => {
        e.stopPropagation();
        void toggle(target, name, !on, t("pin.failed"));
      }}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60",
        on && "text-brand",
        className,
      )}
    >
      <PinIcon className={cn("size-4", on && "fill-current")} />
    </button>
  );
}

/** An agent's pin. Nothing for a pane herdr gave no session (a shell, a fresh agent). */
export function PinButton({ agent, className }: { agent: AgentView; className?: string }) {
  const key = pinKey(agent);
  if (!key) return null;
  return <PinToggle target={{ session: key }} name={`${paneDisplayName(agent)} · ${placeOf(agent)}`} className={className} />;
}

/** A pin whose target no longer exists: greyed, its last name, and the one thing to do with it. */
export function GonePin({ pin, className }: { pin: Pin; className?: string }) {
  const t = useT();
  const { name, status: _status, ...target } = pin;
  return (
    <div className={cn("flex items-center gap-1.5 text-muted-foreground/60", className)}>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="shrink-0 text-xs">{t("pin.gone")}</span>
      <button
        type="button"
        aria-label={t("pin.remove")}
        title={t("pin.remove")}
        onClick={() => void toggle(target as PinTarget, "", false, t("pin.failed"))}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
