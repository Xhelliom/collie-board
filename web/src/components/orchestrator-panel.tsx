import { useEffect, useRef, useState } from "react";
import { Link, useRevalidator } from "react-router";
import { Maximize2, Send } from "lucide-react";

import { useT } from "@/i18n";
import { ago } from "@/lib/project-facts";
import { TranscriptView } from "@/components/transcript-view";
import { Button } from "@/components/ui/button";
import { boardErrorMessage, renewOrchestrator, startOrchestrator, type OrchestratorMemory, type OrchestratorState } from "@/lib/board";
import { sendReply } from "@/lib/api";
import { panePath } from "@/lib/nav";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { TranscriptEntry } from "@/lib/types";

// The project's orchestrator (ADR 0021): a conversation with the agent that plans this repo — cards,
// phases, lots, the roadmap. It prepares and never launches; its writes show up in the project view
// through the usual poll. What is shown is its conversation in the reading view's turns (the
// project loader reads the transcript on the root's tick, so the panel has no timer of its own) —
// never the terminal mirror, whose separator lines and blank rows read as noise. The full chat is one tap away.
//
// Shown docked on a wide screen and inside a sheet on a phone — the same content, so everything below
// the header is marked `data-vaul-no-drag`: a touch in the field or the mirror is theirs, not the sheet's.

/** The context occupancy from which the panel proposes a hand-over (ADR 0023). */
export const HANDOVER_PCT = 50;

export function OrchestratorPanel({
  repo,
  state,
  entries,
  memory = null,
}: {
  repo: string | null;
  state: OrchestratorState | null | undefined;
  /** Its conversation, oldest first. */
  entries: TranscriptEntry[];
  /** The note it left its next self (ADR 0023), read-only here. */
  memory?: OrchestratorMemory | null;
}) {
  const t = useT();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  // The first tap of a hand-over, and the note's date at that moment: the second tap opens once it moved.
  const [asked, setAsked] = useState<{ base: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Follow the conversation as it grows — unless the reader scrolled up to read: then leave them there.
  const stuck = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  if (!repo) {
    return (
      <p data-vaul-no-drag className="p-4 text-sm text-muted-foreground">
        {t("orch.pickRepo")}
      </p>
    );
  }

  async function start() {
    setBusy(true);
    try {
      await startOrchestrator(repo!);
      setStatus(t("orch.started"), "success");
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setBusy(false);
      void revalidator.revalidate();
    }
  }

  async function renew(step: "ask" | "restart") {
    setBusy(true);
    try {
      await renewOrchestrator(repo!, step);
      if (step === "ask") {
        setAsked({ base: state?.memoryUpdatedAt ?? 0 });
        setStatus(t("orch.noting"), "info", 4000);
      } else {
        setAsked(null);
        setStatus(t("orch.renewed"), "success");
      }
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setBusy(false);
      void revalidator.revalidate();
    }
  }

  async function send() {
    const msg = draft.trim();
    if (!msg || !state?.paneId) return;
    setBusy(true);
    try {
      const res = await sendReply(state.paneId, msg);
      if (res.ok === false) throw new Error(res.error ?? "not sent");
      setDraft("");
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setBusy(false);
      void revalidator.revalidate();
    }
  }

  if (!state?.paneId) {
    return (
      <div data-vaul-no-drag className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted-foreground">{t("orch.intro")}</p>
        <Button variant="brand" className="self-start" disabled={busy} onClick={() => void start()}>
          {busy ? t("orch.starting") : t("orch.start")}
        </Button>
      </div>
    );
  }

  return (
    <div data-vaul-no-drag className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
          {t("orch.title")}
          {typeof state.ctxPct === "number" && (
            <span
              role="img"
              aria-label={t("orch.ctxFull", { pct: Math.round(state.ctxPct) })}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] normal-case tracking-normal"
            >
              <span aria-hidden="true" className="h-1 w-12 overflow-hidden rounded-full bg-border">
                <i className={cn("block h-full", state.ctxPct >= 50 ? "bg-status-working" : "bg-status-done")} style={{ width: `${Math.min(100, state.ctxPct)}%` }} />
              </span>
              ctx {Math.round(state.ctxPct)}%
            </span>
          )}
        </span>
        <Link to={panePath(state.paneId)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand">
          <Maximize2 className="size-3" />
          {t("orch.fullscreen")}
        </Link>
      </div>
      {typeof state.ctxPct === "number" && state.ctxPct >= HANDOVER_PCT && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-status-working/50 bg-status-working/10 p-2.5 text-sm">
          <span>{t("orch.handover")}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="h-8 px-3 text-xs" disabled={busy || asked !== null} onClick={() => void renew("ask")}>
              {t("orch.askNote")}
            </Button>
            {asked !== null && (
              <Button
                variant="brand"
                className="h-8 px-3 text-xs"
                disabled={busy || (state.memoryUpdatedAt ?? 0) <= asked.base}
                onClick={() => void renew("restart")}
              >
                {t("orch.restart")}
              </Button>
            )}
            {asked !== null && (state.memoryUpdatedAt ?? 0) <= asked.base && (
              <span className="text-xs text-muted-foreground">{t("orch.waitingNote")}</span>
            )}
          </div>
        </div>
      )}
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-32 flex-1 overflow-y-auto rounded-lg border bg-card/40 p-2"
        aria-label={t("orch.thread")}
      >
        {entries.length > 0 ? (
          <TranscriptView entries={entries} />
        ) : (
          <p className="p-2 text-sm text-muted-foreground">{t("orch.warmingUp")}</p>
        )}
      </div>
      <details className="rounded-lg border bg-card/40 px-2.5 py-1.5 text-sm">
        <summary className="cursor-pointer select-none text-xs font-semibold text-muted-foreground">
          {memory ? t("orch.memoryNoted", { ago: ago(memory.updatedAt) }) : t("orch.memory")}
        </summary>
        {memory ? (
          <p className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap text-muted-foreground">{memory.note}</p>
        ) : (
          <p className="mt-1.5 text-muted-foreground">{t("orch.memoryEmpty")}</p>
        )}
      </details>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label={t("orch.message")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // Enter sends, and so do Ctrl/Super+Enter; Shift+Enter keeps its newline. Never mid-IME composition.
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void send();
          }}
          rows={2}
          placeholder={t("orch.placeholder")}
          className="min-h-10 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <Button type="submit" variant="brand" className="h-10 shrink-0 px-3" disabled={busy || draft.trim() === ""} aria-label={t("orch.send")}>
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
