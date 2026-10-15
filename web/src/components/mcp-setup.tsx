import { useEffect, useState } from "react";
import { Check, Terminal, Copy } from "lucide-react";

import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { copyUnavailableTitle, useCopy } from "@/hooks/use-copy";
import { fetchMcpSetup, type McpSetup } from "@/lib/board";

// "MCP server" — how to plug bridge/mcp.ts (ADR 0039) into a client, with this install's real path.
// Shows and copies a command; runs nothing (only git.ts and gate.ts shell out).
export function McpSetupCard() {
  const t = useT();
  const [setup, setSetup] = useState<McpSetup | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    fetchMcpSetup(ctl.signal).then(setSetup, () => !ctl.signal.aborted && setFailed(true));
    return () => ctl.abort();
  }, []);

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center gap-3">
        <Terminal className="size-5 shrink-0 text-muted-foreground" />
        <div>
          <div className="font-medium">{t("settings.mcp.title")}</div>
          <p className="text-sm text-muted-foreground">{t("settings.mcp.hint")}</p>
        </div>
      </div>
      {failed && <p className="text-sm text-status-blocked">{t("settings.mcp.failed")}</p>}
      {setup && (
        <>
          <CommandLine command={setup.command} />
          {setup.deviceCommand && (
            <>
              <p className="text-sm text-muted-foreground">{t("settings.mcp.device")}</p>
              <CommandLine command={setup.deviceCommand} />
            </>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t("settings.mcp.read")}</dt>
            <dd className="font-mono text-xs leading-5">{names(setup, true)}</dd>
            <dt className="text-muted-foreground">{t("settings.mcp.action")}</dt>
            <dd className="font-mono text-xs leading-5">{names(setup, false)}</dd>
          </dl>
        </>
      )}
    </Card>
  );
}

const names = (s: McpSetup, readOnly: boolean) =>
  s.tools.filter((x) => x.readOnly === readOnly).map((x) => x.name).join(", ");

function CommandLine({ command }: { command: string }) {
  const t = useT();
  const { canCopy, copied, copy } = useCopy();
  return (
    <button
      type="button"
      disabled={!canCopy}
      onClick={() => void copy(command)}
      aria-label={t("settings.mcp.copy", { command })}
      title={canCopy ? undefined : copyUnavailableTitle()}
      className="flex w-full items-start gap-2 rounded-md border border-border bg-muted/40 p-2 text-left font-mono text-xs break-all select-all transition-colors hover:bg-muted/60 active:bg-muted disabled:cursor-text"
    >
      <span className="min-w-0 flex-1">{command}</span>
      {copied ? (
        <Check className="size-4 shrink-0 text-status-done" aria-label={t("settings.mcp.copied")} />
      ) : (
        <Copy className="size-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}
