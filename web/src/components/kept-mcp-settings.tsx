import { useEffect, useState } from "react";

import { useT } from "@/i18n";
import { boardErrorMessage, fetchKeptMcp, setKeptMcp, type KeptMcp } from "@/lib/board";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// The MCP servers and plugins a board agent of this repo keeps beside collie-board (lean launch). The
// names are read by the bridge from Claude Code's own files when this opens — never polled.
export function KeptMcpSettings({ repo }: { repo: string }) {
  const t = useT();
  const [s, setS] = useState<KeptMcp | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setS(null);
    fetchKeptMcp(repo, ac.signal)
      .then(setS)
      .catch(() => {});
    return () => ac.abort();
  }, [repo]);

  if (!s) return null;
  // A kept name no longer found stays shown, so it can be unticked.
  const names = [...new Set([...s.available.mcp, ...s.available.plugins, ...s.kept])];

  async function toggle(name: string) {
    if (!s) return;
    const next = s.kept.includes(name) ? s.kept.filter((n) => n !== name) : [...s.kept, name];
    try {
      const { kept } = await setKeptMcp(repo, next);
      setS({ ...s, kept });
      setStatus(t("orch.autoSaved"), "success", 2000);
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label={t("orch.keptMcp")}>
      <span className="font-medium">{t("orch.keptMcp")}</span>
      {names.length ? (
        <div className="flex flex-wrap gap-1.5">
          {names.map((n) => {
            const on = s.kept.includes(n);
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                onClick={() => void toggle(n)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted/60",
                )}
              >
                {n}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("orch.keptMcpNone")}</p>
      )}
      <p className="text-xs text-muted-foreground">{t("orch.keptMcpHint")}</p>
    </div>
  );
}
