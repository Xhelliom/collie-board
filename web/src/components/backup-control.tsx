import { useRef, useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { downloadBackup, restoreBackup, type RestoreResult } from "@/lib/backup";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { isReadOnly } from "@/lib/types";
import type { DeviceAuth } from "@/lib/types";

// "Backup" — one file with everything Collie Board persists: the board's cards and their history,
// the server-side preferences, and this browser's own (see lib/backup.ts). Both directions live in
// one card because they are one subject, and because the restore's first move is an export anyway.
//
// Restoring REPLACES the board, so it takes the same two-tap confirm as Kill and /clear, after the
// file is picked — the confirm names what is about to happen instead of guarding an empty gesture.
// Read-only devices get neither: both routes are write-gated on the bridge, so say why rather than
// let the tap 403.

export function BackupControl({ device }: { device: DeviceAuth | undefined }) {
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [restored, setRestored] = useState<RestoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { pending, confirm, reset } = usePendingConfirm(6000);
  const readOnly = isReadOnly(device);

  function clearResult() {
    setError(null);
    setSaved(null);
    setRestored(null);
  }

  async function exportNow() {
    clearResult();
    setBusy("export");
    try {
      setSaved(await downloadBackup());
    } catch {
      setError("Couldn't back up.");
    } finally {
      setBusy(null);
    }
  }

  function pickFile() {
    clearResult();
    setFile(null);
    fileRef.current?.click();
  }

  function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    // Reset the input so re-picking the SAME file still fires a change event.
    e.target.value = "";
    setFile(picked);
    reset();
  }

  async function importNow() {
    if (!file) return;
    if (!confirm("restore")) return; // first tap arms; this is the second
    clearResult();
    setBusy("import");
    try {
      setRestored(await restoreBackup(file));
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't restore.");
    } finally {
      setBusy(null);
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
              Download your cards, history and preferences as one JSON file — or restore from one.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border/60 p-3">
        <Button variant="outline" size="sm" disabled={busy !== null || readOnly} onClick={exportNow}>
          {busy === "export" ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Preparing…
            </>
          ) : (
            "Download backup"
          )}
        </Button>

        {file ? (
          <Button
            variant={pending === "restore" ? "destructive" : "secondary"}
            size="sm"
            disabled={busy !== null}
            onClick={importNow}
          >
            {busy === "import" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Restoring…
              </>
            ) : pending === "restore" ? (
              "Tap again to replace"
            ) : (
              <>
                <Upload className="size-4" />
                Restore {file.name}
              </>
            )}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={busy !== null || readOnly} onClick={pickFile}>
            <Upload className="size-4" />
            Restore…
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={onPicked}
        />

        {readOnly && (
          <span className="text-xs text-muted-foreground">
            This device isn't allowed to export or restore.
          </span>
        )}
        {!busy && error && <span className="text-xs text-status-blocked">{error}</span>}
        {!busy && !error && saved && (
          <span className="truncate text-xs text-muted-foreground">Saved {saved}</span>
        )}
      </div>

      {file && !busy && !restored && (
        <p className="border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
          This replaces the board and every stored preference. The bridge exports the current state
          to its <code>backups/</code> folder first.
        </p>
      )}

      {restored && (
        <div className="space-y-1.5 border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
          <p>
            Restored {Object.values(restored.tables).reduce((a, b) => a + b, 0)} rows,{" "}
            {restored.files} files and {restored.clientPrefs} local preferences.
          </p>
          <p>
            Previous state saved on the host at <code className="break-all">{restored.safetyBackup}</code>.
          </p>
          {restored.restartRequired && (
            <p>
              Restart the bridge to pick up the notification settings:{" "}
              <code className="break-all">
                herdr plugin action invoke restart --plugin herdr.collie-board
              </code>
            </p>
          )}
          <Button variant="outline" size="sm" onClick={() => location.reload()}>
            Reload the app
          </Button>
        </div>
      )}
    </Card>
  );
}
