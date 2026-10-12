import { Loader2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { useT } from "@/i18n";

// A settings card whose data the bridge has not sent yet: a tab is never left blank (an older or
// unreachable bridge keeps this up rather than silently showing nothing).
export function SettingsLoading() {
  const t = useT();
  return (
    <Card className="gap-0 py-0">
      <div role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("common.loading")}
      </div>
    </Card>
  );
}
