import { useEffect, useState } from "react";
import { Hourglass, Loader2 } from "lucide-react";
import { useNavigate, useRevalidator } from "react-router";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  answerHandoffOffer,
  boardErrorMessage,
  fetchBoardPrefs,
  patchCard,
  setBoardPrefs,
  type CardView,
} from "@/lib/board";
import { panePath } from "@/lib/nav";
import { setStatus } from "@/lib/status";

// The phone's side of bridge/auto-handoff.ts: the board-wide switch (Settings), one card's answer
// over it (card screen), and the offer itself (pane screen).

/**
 * Settings row. Off by default — the note costs an agent turn per idle spell, on your quota, with
 * nobody watching. Optimistic toggle with revert, like FollowUpsControl; renders nothing if the
 * bridge never answers, since a row that can't show the real state is worse than none.
 */
export function AutoHandoffControl() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetchBoardPrefs(ac.signal)
      .then((p) => setOn(p.autoHandoff))
      .catch(() => setFailed(true));
    return () => ac.abort();
  }, []);

  async function save(next: boolean) {
    const before = on;
    setOn(next);
    setBusy(true);
    try {
      setOn((await setBoardPrefs({ autoHandoff: next })).autoHandoff);
    } catch {
      setOn(before);
    } finally {
      setBusy(false);
    }
  }

  if (failed) return null;

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <Hourglass className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="font-medium">Auto handoff</div>
            <p className="text-sm text-muted-foreground">
              When a Claude card session has sat idle for 4 minutes, have it write its handoff note
              before its prompt cache expires. Coming back later, start fresh from the note instead of
              reloading the whole conversation. Each card can override this.
            </p>
          </div>
        </div>
        {on === null ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Switch
            checked={on}
            disabled={busy}
            onCheckedChange={(next) => void save(next)}
            aria-label="Auto handoff"
          />
        )}
      </div>
    </Card>
  );
}

const CHOICES: ReadonlyArray<{ value: CardView["autoHandoff"]; label: string }> = [
  { value: null, label: "Default" },
  { value: "on", label: "Always" },
  { value: "off", label: "Never" },
];

/** One card's answer, over the Settings switch. Durable on the card, so it outlives the session. */
export function AutoHandoffChoice({ card, onChanged }: { card: CardView; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function choose(value: CardView["autoHandoff"]) {
    setBusy(true);
    try {
      await patchCard(card.id, { autoHandoff: value });
      onChanged();
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-medium">Auto handoff</div>
        <p className="text-xs text-muted-foreground">
          Never, for an agent that leaves work running in the background: its pane reads idle while
          that work goes on, and a fresh session would close it.
        </p>
      </div>
      <div className="flex gap-1.5">
        {CHOICES.map(({ value, label }) => (
          <Button
            key={label}
            size="sm"
            variant={card.autoHandoff === value ? "secondary" : "outline"}
            aria-pressed={card.autoHandoff === value}
            disabled={busy}
            onClick={() => void choose(value)}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

// The session sat quiet past its prompt cache, and the board took its handoff note while the cache
// was still warm. Replying here reloads the whole conversation uncached; a fresh session opened on
// the note costs a page. The operator picks — declining leaves the session exactly as it was.
export function ResumeOffer({ cardId }: { cardId: string }) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);

  const answer = async (accept: boolean) => {
    setBusy(true);
    try {
      const { paneId } = await answerHandoffOffer(cardId, accept);
      // The old pane is closed by now; the fresh one is where the conversation continues.
      if (accept && paneId) navigate(panePath(paneId));
    } catch (e) {
      setStatus((e as Error).message, "error", null);
    } finally {
      setBusy(false);
    }
    revalidator.revalidate();
  };

  return (
    <div role="status" className="border-t border-border/40 px-3 py-2">
      <p className="text-xs leading-[1.55] text-muted-foreground">
        Cache expiré : le prochain message rechargera toute la conversation. Un handoff a été écrit
        avant l'expiration.
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void answer(true)}>
          Repartir du handoff
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void answer(false)}>
          Continuer ici
        </Button>
      </div>
    </div>
  );
}
