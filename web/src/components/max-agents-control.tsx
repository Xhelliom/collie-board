import { useEffect, useState } from "react";
import { Gauge, Loader2, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchBoardPrefs, setBoardPrefs, MAX_AGENTS_CAP } from "@/lib/board";

// How many cards may run an agent at once — the semaphore `startCard` refuses on ("3 agents already
// running — finish or hand one off first"). It lives on the bridge like every other board pref, but
// unlike them it is about the MACHINE: what this laptop can compile and think for at once changes
// with what else is running on it, and until now changing it meant editing a systemd unit and
// restarting the bridge. A stepper rather than a text field: it's a small whole number, and a phone
// keyboard for one digit is a worse trade than two big targets.
//
// Optimistic, with revert on failure, like FollowUpsControl. Renders nothing until the bridge
// answers and nothing at all if it never does — a settings row that can't be trusted to reflect the
// real limit is worse than no row.

// A stepper is for nudging; anyone who genuinely wants 20 agents on one machine can still POST it.
const STEPPER_MAX = 8;

export function MaxAgentsControl() {
  const [value, setValue] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetchBoardPrefs(ac.signal)
      // A bridge older than this build answers the prefs without a `maxAgents` at all — the frontend
      // is served from disk and goes live on a rebuild, while the bridge needs a restart, so that
      // window is real. No number, no row: better than a stepper over a blank.
      .then((p) => (typeof p.maxAgents === "number" ? setValue(p.maxAgents) : setFailed(true)))
      .catch(() => setFailed(true));
    return () => ac.abort();
  }, []);

  async function bump(delta: number) {
    if (value === null || busy) return;
    // Clamp against the bridge's own ceiling too, so a value already above the stepper's range (set
    // by env or by hand) can still be stepped down rather than being stuck.
    const next = Math.min(MAX_AGENTS_CAP, Math.max(1, value + delta));
    if (next === value) return;
    setValue(next); // optimistic
    setBusy(true);
    try {
      const updated = await setBoardPrefs({ maxAgents: next });
      setValue(updated.maxAgents);
    } catch {
      setValue(value);
    } finally {
      setBusy(false);
    }
  }

  if (failed) return null;

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <Gauge className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="font-medium">Agents at once</div>
            <p className="text-sm text-muted-foreground">
              Starting a card past this limit is refused until one finishes or is handed off.
            </p>
          </div>
        </div>
        {value === null ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              disabled={busy || value <= 1}
              onClick={() => void bump(-1)}
              aria-label="One agent fewer"
            >
              <Minus />
            </Button>
            <span
              className="min-w-8 text-center text-base font-medium tabular-nums"
              aria-live="polite"
            >
              {value}
            </span>
            <Button
              variant="outline"
              size="icon"
              disabled={busy || value >= STEPPER_MAX}
              onClick={() => void bump(1)}
              aria-label="One agent more"
            >
              <Plus />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
