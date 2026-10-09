import { useState } from "react";
import { Link, useRevalidator } from "react-router";
import { Maximize2, Send } from "lucide-react";

import { AnsiOutput } from "@/components/ansi-output";
import { Button } from "@/components/ui/button";
import { boardErrorMessage, startOrchestrator, type OrchestratorState } from "@/lib/board";
import { sendReply } from "@/lib/api";
import { panePath } from "@/lib/nav";
import { setStatus } from "@/lib/status";

// The project's orchestrator (ADR 0021): a conversation with the agent that plans this repo — cards,
// phases, lots, the roadmap. It prepares and never launches; its writes show up in the project view
// through the usual poll. What is mirrored here is the tail of its pane (the project loader reads it
// on the root's tick, so the panel has no timer of its own); the full chat is one tap away.
//
// Shown docked on a wide screen and inside a sheet on a phone — the same content, so everything below
// the header is marked `data-vaul-no-drag`: a touch in the field or the mirror is theirs, not the sheet's.

export function OrchestratorPanel({
  repo,
  state,
  text,
}: {
  repo: string | null;
  state: OrchestratorState | null | undefined;
  text: string;
}) {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");

  if (!repo) {
    return (
      <p data-vaul-no-drag className="p-4 text-sm text-muted-foreground">
        Choisis un dépôt (filtre « repo » du board) pour discuter avec l'orchestrateur de son projet.
      </p>
    );
  }

  async function start() {
    setBusy(true);
    try {
      await startOrchestrator(repo!);
      setStatus("Orchestrateur démarré.", "success");
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
        <p className="text-sm text-muted-foreground">
          Un agent dédié à ce projet : il lit le board, propose des phases, des lots et une roadmap, et prépare le tout sans
          jamais rien lancer. Il consomme ton quota tant qu'il travaille.
        </p>
        <Button variant="brand" className="self-start" disabled={busy} onClick={() => void start()}>
          {busy ? "Démarrage…" : "Démarrer l'orchestrateur"}
        </Button>
      </div>
    );
  }

  return (
    <div data-vaul-no-drag className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">Orchestrateur</span>
        <Link to={panePath(state.paneId)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand">
          <Maximize2 className="size-3" />
          Ouvrir en plein écran
        </Link>
      </div>
      <div className="min-h-32 flex-1 overflow-y-auto rounded-lg bg-[var(--terminal-background)] p-2 text-[var(--terminal-foreground)]" aria-label="Fil de l'orchestrateur">
        <AnsiOutput text={text} wrap fontSize={11} />
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="Message à l'orchestrateur"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Dis-lui ce que tu veux planifier…"
          className="min-h-10 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <Button type="submit" variant="brand" className="h-10 shrink-0 px-3" disabled={busy || draft.trim() === ""} aria-label="Envoyer">
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
