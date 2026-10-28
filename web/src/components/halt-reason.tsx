import { useT } from "@/i18n";
import { parseAnsi } from "@/lib/ansi";

/** A halt reason as plain text: a gate's output arrives with its colours (`\x1b[31m…`). */
export function stripAnsi(text: string): string {
  return parseAnsi(text)
    .map((s) => s.text)
    .join("");
}

const ERROR_LINE = /^(✗|✘|error|fatal)|failed|aborted/i;

/** The lines worth reading at a glance: the last error line of a long output, else its first three. */
export function haltSummary(reason: string): { head: string[]; full: string; more: boolean } {
  const full = stripAnsi(reason).trim();
  const lines = full.split("\n").map((l) => l.trim()).filter(Boolean);
  const err = lines.findLast((l) => ERROR_LINE.test(l));
  const head = err && lines.length > 3 ? [err] : lines.slice(0, 3);
  return { head, full, more: lines.length > head.length };
}

/** Why a lot halted: a few lines, the whole output behind « voir plus ». Text nodes only. */
export function HaltReason({ reason, className }: { reason: string; className?: string }) {
  const t = useT();
  const { head, full, more } = haltSummary(reason);
  return (
    <div className={className}>
      <p className="whitespace-pre-wrap break-words text-sm text-status-blocked">{head.join("\n")}</p>
      {more && (
        <details className="text-sm">
          <summary className="cursor-pointer select-none text-xs font-semibold text-muted-foreground">{t("common.showMore")}</summary>
          <pre className="mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-xs">{full}</pre>
        </details>
      )}
    </div>
  );
}
