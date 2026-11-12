import { useLayoutEffect, useRef, useState } from "react";
import { Link, useRevalidator } from "react-router";
import { Ellipsis, ImagePlus, Loader2, Maximize2, Package, Send } from "lucide-react";

import { useT } from "@/i18n";
import { ago } from "@/lib/project-facts";
import { ModelTag } from "@/components/model-tag";
import { ButtonsPaneContext } from "@/components/action-buttons";
import { TranscriptView } from "@/components/transcript-view";
import { DeliverableLinks, type RecentDeliverable } from "@/components/card-deliverables";
import { Button } from "@/components/ui/button";
import { MigrateHcButton } from "@/components/migrate-hc-button";
import { BottomSheet } from "@/components/ui/sheet";
import { ChatInput } from "@/components/ui/chat/chat-input";
import { AttachedImages, ImagePreviewSheet } from "@/components/image-attach";
import { useImageUpload } from "@/hooks/use-image-upload";
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

// The newest deliverable's date at the last opening of the list, per repo: a comfort of this device only.
const seenKey = (repo: string) => `collie.orch-deliverables-seen:${repo}`;
function loadSeen(repo: string): number {
  try {
    return Number(localStorage.getItem(seenKey(repo))) || 0;
  } catch {
    return 0;
  }
}
function saveSeen(repo: string, ts: number): void {
  try {
    localStorage.setItem(seenKey(repo), String(ts));
  } catch {
    // Private mode: the dot comes back on the next mount, nothing worse.
  }
}

export function OrchestratorPanel({
  repo,
  state,
  entries,
  memory = null,
  deliverables = [],
  onLeave,
}: {
  repo: string | null;
  state: OrchestratorState | null | undefined;
  /** Its conversation, oldest first. */
  entries: TranscriptEntry[];
  /** The note it left its next self (ADR 0023), read-only here. */
  memory?: OrchestratorMemory | null;
  /** The project's recent deliverables, newest first (from the facts the page polls), one button away. */
  deliverables?: RecentDeliverable[];
  /** Called when the panel sends the operator to the page (the sheet closes itself). */
  onLeave?: () => void;
}) {
  const t = useT();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // A screenshot goes up under the orchestrator's own pane, its `[Image #N]` token into the draft — the composer's hook.
  const upload = useImageUpload({ paneId: state?.paneId ?? "orchestrator", disabled: !state?.paneId, text: draft, setText: setDraft, inputRef });
  const fileRef = useRef<HTMLInputElement>(null);
  // The first tap of a hand-over, and the note's date at that moment: the second tap opens once it moved.
  const [asked, setAsked] = useState<{ base: number } | null>(null);
  const [delivOpen, setDelivOpen] = useState(false);
  // The rare actions (note, restart, memory) sit behind one header button, so the thread keeps the height.
  const [menuOpen, setMenuOpen] = useState(false);
  // Why the last "Repartir à neuf" failed, kept beside the button until the next try.
  const [restartError, setRestartError] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  // Follow the conversation as it grows — unless the reader scrolled up to read: then leave them there.
  const stuck = useRef(true);
  // Layout effect, and once more a frame later: the sheet is still sliding in when this first runs.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !stuck.current) return;
    el.scrollTop = el.scrollHeight;
    const id = requestAnimationFrame(() => {
      if (stuck.current) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
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

  // Read on each render: opening the list re-renders, and a changed repo reads its own mark.
  const seen = loadSeen(repo);
  const fresh = deliverables.filter((d) => d.ts > seen).length;

  // Renewing is always on offer (a new prompt, a drifted thread); past the threshold it is a warning.
  const full = typeof state?.ctxPct === "number" && state.ctxPct >= HANDOVER_PCT;

  async function renew(step: "ask" | "restart") {
    setBusy(true);
    if (step === "restart") setRestartError(null);
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
      if (step === "restart") setRestartError(t("orch.restartFailed", { reason: boardErrorMessage(e) }));
      else setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setBusy(false);
      void revalidator.revalidate();
    }
  }

  async function send() {
    const msg = upload.expand(draft).trim();
    if (!msg || !state?.paneId) return;
    setBusy(true);
    try {
      const res = await sendReply(state.paneId, msg);
      if (res.ok === false) throw new Error(res.error ?? t("pane.sendFailed"));
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
    <div data-vaul-no-drag className="flex min-h-0 flex-1 flex-col gap-2 p-3 max-lg:p-0">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
          {t("orch.title")}
          <ModelTag model={state.model} effort={state.effort} className="font-mono text-[11px] normal-case tracking-normal" />
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
        <span className="flex items-center gap-3">
          {deliverables.length > 0 && (
            <button
              type="button"
              onClick={() => {
                saveSeen(repo, deliverables[0]!.ts);
                setDelivOpen(true);
              }}
              aria-label={t(fresh > 0 ? "orch.deliverablesNew" : "orch.deliverablesCount", { count: deliverables.length, fresh })}
              className="relative inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-brand"
            >
              <Package className="size-3.5" />
              <span className="tabular-nums">{deliverables.length}</span>
              {fresh > 0 && <span data-testid="deliverables-new" aria-hidden="true" className="absolute -right-1.5 top-0.5 size-2 rounded-full bg-status-working" />}
            </button>
          )}
          <Link to={panePath(state.paneId)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand">
            <Maximize2 className="size-3" />
            {t("orch.fullscreen")}
          </Link>
          {asked !== null && (state.memoryUpdatedAt ?? 0) <= asked.base && (
            <span className="text-[11px] text-muted-foreground">{t("orch.waitingNote")}</span>
          )}
          {/* Same hand-rolled menu as pane-menu.tsx: an absolute list plus a click-outside layer. */}
          <span className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t("orch.menu")}
              className="-my-2 -mr-2 inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted/60"
            >
              <Ellipsis className="size-4" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMenuOpen(false)} />
                <div role="menu" className="absolute right-0 top-full z-50 mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-xl border border-border bg-card p-1.5 text-sm shadow-lg">
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy || asked !== null}
                    onClick={() => (setMenuOpen(false), void renew("ask"))}
                    className="min-h-11 rounded-lg px-2.5 text-left font-medium hover:bg-muted/60 disabled:opacity-50"
                  >
                    {t("orch.askNote")}
                  </button>
                  {/* Never gated on the note: an orchestrator with nothing new to record writes nothing, and the
                      last note it wrote is then what its successor reads. */}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => (setMenuOpen(false), void renew("restart"))}
                    className="min-h-11 rounded-lg px-2.5 text-left font-medium text-brand hover:bg-muted/60 disabled:opacity-50"
                  >
                    {t("orch.restart")}
                  </button>
                  {/* Still under herdr 0.9: the same conversation, resumed under hc — it stays this repo's orchestrator. */}
                  <MigrateHcButton
                    paneId={state.paneId}
                    onDone={(message, ok) => {
                      setMenuOpen(false);
                      setStatus(message, ok ? "success" : "error");
                      void revalidator.revalidate();
                    }}
                  />
                  <details className="border-t border-border/60 px-2.5 pt-1.5">
                    <summary className="flex min-h-11 cursor-pointer select-none items-center text-xs font-semibold text-muted-foreground">
                      {memory ? t("orch.memoryNoted", { ago: ago(memory.updatedAt) }) : t("orch.memory")}
                    </summary>
                    {memory ? (
                      <p className="mb-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap text-muted-foreground">{memory.note}</p>
                    ) : (
                      <p className="mb-1.5 text-muted-foreground">{t("orch.memoryEmpty")}</p>
                    )}
                  </details>
                </div>
              </>
            )}
          </span>
        </span>
      </div>
      <BottomSheet open={delivOpen} onClose={() => setDelivOpen(false)} title={t("orch.deliverables")}>
        <div data-vaul-no-drag className="overflow-y-auto">
          <DeliverableLinks items={deliverables} onLeave={() => (setDelivOpen(false), onLeave?.())} />
        </div>
      </BottomSheet>
      {/* Past the threshold the warning stays in sight: the actions it asks for are in the ⋯ menu. */}
      {full && (
        <p role="alert" className="rounded-lg border border-status-working/50 bg-status-working/10 p-2.5 text-sm">
          {t("orch.handover")}
        </p>
      )}
      {restartError && (
        <p role="alert" className="text-xs text-destructive">
          {restartError}
        </p>
      )}
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-32 flex-1 overflow-y-auto"
        aria-label={t("orch.thread")}
      >
        {entries.length > 0 ? (
          // justify-end: a short conversation sits against the composer, not at the top of an empty box.
          <div className="flex min-h-full flex-col justify-end">
            {/* Its own messages may end on buttons (ADR 0042); this panel is the only place that says so. */}
            <ButtonsPaneContext.Provider value={state.paneId}>
              <TranscriptView entries={entries} />
            </ButtonsPaneContext.Provider>
          </div>
        ) : (
          <p className="p-2 text-sm text-muted-foreground">{t("orch.warmingUp")}</p>
        )}
      </div>
      <ImagePreviewSheet upload={upload} />
      <AttachedImages upload={upload} />
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <ChatInput
          ref={inputRef}
          aria-label={t("orch.message")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // Enter sends, and so do Ctrl/Super+Enter; Shift+Enter keeps its newline. Never mid-IME composition.
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void send();
          }}
          onPaste={upload.onPaste}
          rows={1}
          placeholder={t("orch.placeholder")}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ""; // allow re-picking the same file
            if (file) upload.pick(file);
          }}
        />
        <Button
          type="button"
          variant="ghost"
          className="size-11 shrink-0 px-0 text-muted-foreground"
          disabled={upload.uploading || !state?.paneId}
          onClick={() => fileRef.current?.click()}
          aria-label={t("pane.attach")}
        >
          {upload.uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
        </Button>
        <Button type="submit" variant="brand" className="size-11 shrink-0 px-0" disabled={busy || draft.trim() === ""} aria-label={t("orch.send")}>
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
