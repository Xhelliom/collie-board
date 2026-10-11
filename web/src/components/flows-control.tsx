import { useState } from "react";
import { Workflow } from "lucide-react";

import { FlowsSheet } from "@/components/flows-sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useFlows } from "@/hooks/use-flows";
import { useTemplates } from "@/hooks/use-templates";
import { useT } from "@/i18n";

// Settings: the flows (ADR 0032), one tap to manage — next to the templates they are made of.
// Renders nothing until the bridge answers, and nothing if it never does (an older bridge has no /api/flows).
export function FlowsControl() {
  const t = useT();
  const { flows, reload } = useFlows();
  const { data } = useTemplates();
  const [open, setOpen] = useState(false);
  if (!flows || !data) return null;
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-start gap-3 p-4">
        <Workflow className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-semibold">{t("flows.title")}</span>
          <span className="text-xs text-muted-foreground">{t("flows.hint")}</span>
          <span className="text-xs text-muted-foreground">{t("flows.count", { count: flows.length })}</span>
        </div>
        <Button variant="outline" className="h-9 shrink-0 px-3 text-sm" onClick={() => setOpen(true)}>
          {t("flows.manage")}
        </Button>
      </div>
      <FlowsSheet open={open} onClose={() => setOpen(false)} flows={flows} templates={data.templates} onChanged={reload} />
    </Card>
  );
}
