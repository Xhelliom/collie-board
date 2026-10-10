import { useState } from "react";
import { UserCog } from "lucide-react";

import { TemplatesSheet } from "@/components/templates-sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTemplates } from "@/hooks/use-templates";
import { useT } from "@/i18n";

// Settings: the agent templates (ADR 0026), one tap to manage. Renders nothing until the bridge
// answers, and nothing if it never does (an older bridge has no /api/templates).
export function TemplatesControl() {
  const t = useT();
  const { data, reload } = useTemplates();
  const [open, setOpen] = useState(false);
  if (!data) return null;
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-start gap-3 p-4">
        <UserCog className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-semibold">{t("templates.title")}</span>
          <span className="text-xs text-muted-foreground">{t("templates.hint")}</span>
          <span className="text-xs text-muted-foreground">{t("templates.count", { count: data.templates.length })}</span>
        </div>
        <Button variant="outline" className="h-9 shrink-0 px-3 text-sm" onClick={() => setOpen(true)}>
          {t("templates.manage")}
        </Button>
      </div>
      <TemplatesSheet open={open} onClose={() => setOpen(false)} data={data} onChanged={reload} />
    </Card>
  );
}
