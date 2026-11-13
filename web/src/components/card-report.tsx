import { useT } from "@/i18n";
import { MarkdownText } from "@/components/markdown-text";
import type { BilanIssue, CardReport, LeadAnswer } from "@/lib/card-report";
import { cn } from "@/lib/utils";

const ISSUE_TONE: Record<BilanIssue | "unknown", string> = {
  coded: "border-status-done/40 bg-status-done/15 text-status-done",
  present: "border-brand/40 bg-brand/10 text-brand",
  partial: "border-status-working/40 bg-status-working/15 text-status-working",
  none: "border-destructive/40 bg-destructive/15 text-destructive",
  unknown: "border-border text-muted-foreground",
};

function Answer({ answer }: { answer: LeadAnswer }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1 rounded-lg border-l-2 border-brand/50 bg-brand/5 px-2.5 py-1.5 text-xs">
      <span className="font-semibold">{t(`report.answer.${answer.kind}`)}</span>
      {answer.reason && <span className="text-muted-foreground">{answer.reason}</span>}
      {answer.prompt && <span className="italic">{t("report.prompt", { prompt: answer.prompt })}</span>}
    </div>
  );
}

/** « Compte rendu »: the outcome, the lead's last word, then each bilan → answer round, newest open. Bare: the caller's panel frames it. */
export function CardReportSection({ report }: { report: CardReport }) {
  const t = useT();
  const issue = report.issue ?? "unknown";
  const n = report.rounds.length;
  return (
    <div className="flex flex-col gap-2.5" aria-label={t("report.title")} role="group">
        {(report.rounds.length > 0 || report.issue) && (
          <div className="flex flex-wrap items-center gap-2">
            <span data-testid="report-issue" className={cn("rounded-sm border px-2.5 py-0.5 text-xs font-semibold", ISSUE_TONE[issue])}>
              {t(`report.issue.${issue}`)}
            </span>
            {n > 0 && <span className="text-xs text-muted-foreground">{t("report.rounds", { count: n })}</span>}
          </div>
        )}
        {report.conclusion && <Answer answer={report.conclusion} />}
        {report.rounds.map((r, i) => (
          <details key={r.id} open={i === n - 1} className="group rounded-lg border px-2.5 py-1.5">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              {t("report.round", { n: i + 1 })}
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              {r.bilan ? (
                <div className="text-xs leading-[1.55]">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">{t("report.bilan")}</div>
                  <MarkdownText text={r.bilan} className="text-xs leading-[1.55]" />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t("report.noBilan")}</p>
              )}
              {r.answer ? <Answer answer={r.answer} /> : <p className="text-xs text-muted-foreground">{t("report.awaiting")}</p>}
            </div>
          </details>
        ))}
        {report.handoffMd && (
          <details className="rounded-lg border px-2.5 py-1.5">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{t("report.handoff")}</summary>
            <div className="mt-2 text-xs leading-[1.55]">
              <MarkdownText text={report.handoffMd} className="text-xs leading-[1.55]" />
            </div>
          </details>
        )}
    </div>
  );
}
