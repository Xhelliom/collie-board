import { Pin as PinIcon, X } from "lucide-react";

import { useT } from "@/i18n";
import { pinKey, setPinned, usePins, type Pin } from "@/lib/pins";
import { setStatus } from "@/lib/status";
import { paneDisplayName, type AgentView } from "@/lib/types";
import { cn } from "@/lib/utils";

const toggle = (session: string, name: string, pinned: boolean, failed: string) =>
  setPinned(session, name, pinned).catch(() => setStatus(failed, "error"));

/** Pin / unpin an agent's session to the quick access. Nothing for a pane herdr gave no session (a shell, a fresh agent). */
export function PinButton({ agent, className }: { agent: AgentView; className?: string }) {
  const t = useT();
  const pins = usePins();
  const key = pinKey(agent);
  if (!key) return null;
  const on = pins.some((p) => p.session === key);
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={t(on ? "pin.remove" : "pin.add")}
      title={t(on ? "pin.remove" : "pin.add")}
      onClick={(e) => {
        e.stopPropagation();
        void toggle(key, `${paneDisplayName(agent)} · ${agent.workspaceLabel}`, !on, t("pin.failed"));
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

/** A pin whose session no longer exists: greyed, its last name, and the one thing to do with it. */
export function GonePin({ pin, className }: { pin: Pin; className?: string }) {
  const t = useT();
  return (
    <div className={cn("flex items-center gap-1.5 text-muted-foreground/60", className)}>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{pin.name}</span>
        <span className="block truncate text-xs">{t("pin.gone")}</span>
      </span>
      <button
        type="button"
        aria-label={t("pin.remove")}
        title={t("pin.remove")}
        onClick={() => void toggle(pin.session, "", false, t("pin.failed"))}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted/60 hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/** Each pin with its live pane, or none when the session is gone. */
export const resolvePins = (pins: Pin[], agents: AgentView[]) =>
  pins.map((pin) => ({ pin, agent: agents.find((a) => pinKey(a) === pin.session) }));
