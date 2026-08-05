import { useEffect, useState } from "react";
import { ListPlus, Loader2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { fetchBoardPrefs, setBoardPrefs } from "@/lib/board";

// The one board-wide switch: whether the copilot's review turns what it found still undone into
// backlog cards. Off by default — a board that refills itself is opted into, not discovered — and
// the review still lands with its verdict and notes either way. Lives on the bridge (not in
// localStorage) because the review runs there, with or without a phone attached.
//
// Optimistic toggle with revert on failure, like NotifyPrefsControl. Renders nothing until the
// bridge answers, and nothing at all if it never does — a settings row that can't be trusted to
// reflect the real state is worse than no row.
export function FollowUpsControl() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetchBoardPrefs(ac.signal)
      .then((p) => setOn(p.autoFollowUps))
      .catch(() => setFailed(true));
    return () => ac.abort();
  }, []);

  async function toggle(next: boolean) {
    setOn(next); // optimistic
    setBusy(true);
    try {
      const updated = await setBoardPrefs({ autoFollowUps: next });
      setOn(updated.autoFollowUps);
    } catch {
      setOn(!next);
    } finally {
      setBusy(false);
    }
  }

  if (failed) return null;

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <ListPlus className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="font-medium">Follow-up cards</div>
            <p className="text-sm text-muted-foreground">
              When a card is done, add what the review found still undone to the backlog.
            </p>
          </div>
        </div>
        {on === null ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Switch
            checked={on}
            disabled={busy}
            onCheckedChange={(next) => void toggle(next)}
            aria-label="Follow-up cards"
          />
        )}
      </div>
    </Card>
  );
}
