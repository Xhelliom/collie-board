import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { getLocale, t, useT } from "@/i18n";
import { boardErrorMessage, closePhase, reopenPhase, sealPhase } from "@/lib/board";
import type { ProjectPhase } from "@/lib/project";
import { setStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

// Milestones (ADR 0025): validating a phase is the operator's gesture, so it is a confirmation sheet —
// what is frozen, where the open steps go — and never a bare button. These three are the whole of it.

const FIELD = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/** The "validate this phase" confirmation. `targets` are the OTHER open phases an open step may move to. */
export function ValidateSheet({
  section,
  targets,
  onClose,
  onDone,
}: {
  section: ProjectPhase;
  targets: ProjectPhase[];
  onClose: () => void;
  onDone: () => void;
}) {
  const tt = useT();
  const phase = section.phase!;
  const done = section.steps.filter((s) => s.status === "done").length;
  const open = section.steps.length - done;
  // Default: the next open phase after this one, so the work flows on; none when this is the last.
  const next = targets.find((p) => p.phase!.position > phase.position) ?? targets[0];
  const [moveTo, setMoveTo] = useState<string>(next?.phase!.id ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      await closePhase(phase.id, { moveOpenTo: moveTo || null, note: note.trim() || undefined });
      setStatus(t("project.validate.done", { name: phase.name }), "success");
      onDone();
      onClose();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={tt("project.validate.title", { name: phase.name })}
      footer={
        <div className="flex w-full gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {tt("lot.cancel")}
          </Button>
          <Button variant="brand" className="flex-1" disabled={busy} onClick={() => void go()}>
            {tt("project.validate.confirm")}
          </Button>
        </div>
      }
    >
      <div data-vaul-no-drag className="flex flex-col gap-3">
        <p className="text-sm font-semibold">{tt("project.validate.counts", { done, open })}</p>
        <p className="text-sm text-muted-foreground">{tt("project.validate.explain")}</p>
        {open > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">{tt("project.validate.moveTo")}</span>
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={FIELD}>
              {targets.map((p) => (
                <option key={p.key} value={p.phase!.id}>
                  {p.title}
                </option>
              ))}
              <option value="">{tt("project.noPhase")}</option>
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">{tt("project.validate.note")}</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className={FIELD} />
        </label>
      </div>
    </BottomSheet>
  );
}

/** An old project with no phases: file the finished, phase-less steps under one validated phase. */
export function SealSheet({
  repo,
  count,
  cardIds,
  initialName = "",
  onClose,
  onDone,
}: {
  repo: string;
  count: number;
  /** Only these finished steps (one dictation's); omitted, every finished step no phase has taken. */
  cardIds?: string[];
  /** A name to start from — the dictation's title, so naming it is one tap. */
  initialName?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const tt = useT();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      const r = await sealPhase({ repoPath: repo, name: name.trim(), ...(cardIds ? { cardIds } : {}) });
      setStatus(t("project.seal.done", { count: r.moved, name: name.trim() }), "success");
      onDone();
      onClose();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={tt("project.seal.title")}
      footer={
        <div className="flex w-full gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {tt("lot.cancel")}
          </Button>
          <Button variant="brand" className="flex-1" disabled={busy || name.trim() === ""} onClick={() => void go()}>
            {tt("project.validate.confirm")}
          </Button>
        </div>
      }
    >
      <div data-vaul-no-drag className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{tt("project.seal.explain", { count })}</p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">{tt("project.seal.name")}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tt("project.seal.placeholder")}
            maxLength={200}
            className={FIELD}
          />
        </label>
      </div>
    </BottomSheet>
  );
}

/** The validated phases, folded at the end of the page: what was delivered, one line each. */
export function ClosedPhases({ closed, onReopened }: { closed: ProjectPhase[]; onReopened: () => void }) {
  const tt = useT();
  const [open, setOpen] = useState<string | null>(null);
  if (closed.length === 0) return null;

  async function reopen(p: ProjectPhase) {
    try {
      await reopenPhase(p.phase!.id);
      setStatus(t("project.closed.reopened", { name: p.title }), "success");
      onReopened();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
  }

  return (
    <section aria-label={tt("project.closed.title")} className="flex flex-col gap-2 pt-4">
      <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {tt("project.closed.title")} · {closed.length}
      </h2>
      <ul className="flex flex-col gap-2">
        {closed.map((p) => {
          const isOpen = open === p.key;
          const date = new Date(p.phase!.closedAt!).toLocaleDateString(getLocale());
          return (
            <li key={p.key} className="rounded-xl border bg-card/40">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : p.key)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{p.title}</span>
                  <span className="block text-xs text-muted-foreground">{tt("project.closed.row", { count: p.steps.length, date })}</span>
                </span>
                <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-300", isOpen && "rotate-180")} />
              </button>
              {isOpen && (
                <div className="flex flex-col gap-2 px-3.5 pb-3.5">
                  {p.phase!.closedNote && <p className="text-sm text-muted-foreground">{p.phase!.closedNote}</p>}
                  <ul className="flex flex-col gap-1 text-sm">
                    {p.steps.map((s) => (
                      <li key={s.id} className="truncate text-muted-foreground">
                        {s.title}
                      </li>
                    ))}
                  </ul>
                  <Button variant="outline" className="h-8 self-start px-3 text-xs" onClick={() => void reopen(p)}>
                    {tt("project.closed.reopen")}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
