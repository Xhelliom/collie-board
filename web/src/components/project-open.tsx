import { useState } from "react";
import { Bot, SquareTerminal } from "lucide-react";

import { AgentKindPicker } from "@/components/agent-kind-picker";
import { TemplatePicker } from "@/components/template-picker";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { useSpaceActions } from "@/hooks/use-spaces";
import { useT } from "@/i18n";
import type { OpenInRepo } from "@/lib/api";
import { repoName } from "@/lib/board";

// An agent or a terminal in the repo's folder, outside any card: hc has no Spaces tab to open one
// from (ADR 0052), so the gesture lives where the project is. The same gesture under herdr 0.9.
export function ProjectOpen({ repo }: { repo: string }) {
  const t = useT();
  const { openInRepo } = useSpaceActions();
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agentKind, setAgentKind] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);

  const run = async (opts: OpenInRepo) => {
    setBusy(true);
    try {
      await openInRepo(repo, opts);
    } finally {
      setBusy(false);
      setSheet(false);
    }
  };

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => setSheet(true)}>
        <Bot className="size-4" />
        {t("project.open.agent")}
      </Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void run({ open: "terminal" })}>
        <SquareTerminal className="size-4" />
        {t("project.open.terminal")}
      </Button>
      <BottomSheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={t("project.open.sheet", { repo: repoName(repo) })}
        footer={
          <Button className="w-full" disabled={busy} onClick={() => void run({ open: "agent", agentKind, templateId })}>
            {t(busy ? "project.open.starting" : "project.open.start")}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <AgentKindPicker value={agentKind} onChange={setAgentKind} />
          <TemplatePicker value={templateId} onChange={setTemplateId} />
        </div>
      </BottomSheet>
    </div>
  );
}
