import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { downloadBackup } from "@/lib/backup";
import { isReadOnly } from "@/lib/types";
import type { DeviceAuth } from "@/lib/types";

// "Back up" — one file with everything Collie Board persists: the board's cards and their history,
// the server-side preferences, and this browser's own (see lib/backup.ts). Read-only devices can't
// have it: the export is write-gated on the bridge, so say why rather than let the tap 403.

export function BackupControl({ device }: { device: DeviceAuth | undefined }) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const readOnly = isReadOnly(device);

  async function run() {
    setBusy(true);
    setError(false);
    setSaved(null);
    try {
      setSaved(await downloadBackup());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <Download className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="font-medium">Backup</div>
            <p className="text-sm text-muted-foreground">
              Download your cards, history and preferences as one JSON file.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-border/60 p-3">
        <Button variant="outline" size="sm" disabled={busy || readOnly} onClick={run}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Preparing…
            </>
          ) : (
            "Download backup"
          )}
        </Button>
        {readOnly && (
          <span className="text-xs text-muted-foreground">
            This device isn't allowed to export.
          </span>
        )}
        {!busy && error && <span className="text-xs text-status-blocked">Couldn't back up.</span>}
        {!busy && !error && saved && (
          <span className="truncate text-xs text-muted-foreground">Saved {saved}</span>
        )}
      </div>
    </Card>
  );
}
