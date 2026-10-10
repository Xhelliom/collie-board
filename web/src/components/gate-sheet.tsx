import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { boardErrorMessage, repoName, setRepoGate, suggestRepoGate, type GateSuggestion } from "@/lib/board";

// The repo's gate (ADR 0020): the command a run executes on each worker's checkout before the lead
// sees it. The copilot can propose one from the repo's own files, but only the operator's Enregistrer
// saves it — the bridge will RUN this, so the suggestion fills the field and nothing more.
//
// No shell: the hint under the field says so, because `make a && make b` would save fine and then
// mean nothing.
export function GateSheet({
  open,
  onClose,
  repoPath,
  gate,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  repoPath: string;
  /** The saved command, or null/undefined while the repo has none. */
  gate?: string | null;
  /** Called with the saved command (null once removed), so the caller's list can follow. */
  onSaved?: (gate: string | null) => void;
}) {
  const t = useT();
  const [value, setValue] = useState(gate ?? "");
  const [suggestion, setSuggestion] = useState<GateSuggestion | null>(null);
  const [busy, setBusy] = useState<"suggest" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A fresh sheet per opening: whatever was typed or suggested last time is not this time's.
  useEffect(() => {
    if (!open) return;
    setValue(gate ?? "");
    setSuggestion(null);
    setError(null);
  }, [open, gate]);

  async function suggest() {
    setBusy("suggest");
    setError(null);
    try {
      const { suggestion: s } = await suggestRepoGate(repoPath);
      setSuggestion(s);
      setValue(s.command);
    } catch (e) {
      setError(boardErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function save(next: string | null) {
    setBusy("save");
    setError(null);
    try {
      await setRepoGate(repoPath, next);
      onSaved?.(next);
      onClose();
    } catch (e) {
      setError(boardErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const trimmed = value.trim().replace(/\s+/g, " ");

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t("gate.sheet.title", { repo: repoName(repoPath) })}
      footer={
        <div className="flex w-full gap-2">
          {gate && (
            <Button variant="outline" disabled={busy !== null} onClick={() => void save(null)}>
              {t("gate.remove")}
            </Button>
          )}
          <Button variant="brand" className="flex-1" disabled={busy !== null || trimmed === ""} onClick={() => void save(trimmed)}>
            {t("gate.save")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t("gate.intro")}</p>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t("gate.command")}</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="bun run test"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-10 rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <span className="text-xs text-muted-foreground">{t("gate.noShell")}</span>
        </label>

        <Button
          variant="outline"
          className="gap-1.5"
          disabled={busy !== null}
          onClick={() => void suggest()}
        >
          {busy === "suggest" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {busy === "suggest" ? t("gate.suggesting") : t("gate.suggest")}
        </Button>

        {suggestion && (
          <div aria-label={t("gate.suggestion")} className="flex flex-col gap-2 rounded-lg border bg-card/50 p-3 text-sm">
            <p>{suggestion.reason}</p>
            {suggestion.needsScript && suggestion.scriptSuggestion && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("gate.createYourself")} <code>{suggestion.command}</code>
                </span>
                <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">{suggestion.scriptSuggestion}</pre>
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
