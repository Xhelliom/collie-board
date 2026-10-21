import { useEffect, useState } from "react";
import { ListPlus, Loader2 } from "lucide-react";

import { Rich } from "@/i18n/rich";
import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { boardErrorMessage, CARD_CATEGORIES, fetchBoardPrefs, setBoardPrefs } from "@/lib/board";
import { setStatus } from "@/lib/status";
import type { BoardPrefs } from "@/lib/board";

// The one board-wide switch: whether the copilot's review turns what it found still undone into
// backlog cards. Off by default — a board that refills itself is opted into, not discovered — and
// the review still lands with its verdict and notes either way. Lives on the bridge (not in
// localStorage) because the review runs there, with or without a phone attached.
//
// Under it, one switch per category: the same choice at a finer grain, for the board that wants the
// missing-feature cards and not the go-click-through-it ones. The global stays the coarse cut —
// with it off the rows are inert, because none of them can produce anything anyway.
//
// Optimistic toggle with revert on failure, like NotifyPrefsControl. Renders nothing until the
// bridge answers, and nothing at all if it never does — a settings row that can't be trusted to
// reflect the real state is worse than no row.
export function FollowUpsControl() {
  const t = useT();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetchBoardPrefs(ac.signal)
      .then((p) => setPrefs(taken(p)))
      .catch(() => setFailed(true));
    return () => ac.abort();
  }, []);

  // One writer for both switches: show the new value, then keep whatever the bridge echoes back —
  // and put the previous state back untouched if it refuses.
  async function save(patch: Partial<Prefs>) {
    const before = prefs;
    setPrefs((p) => (p ? { ...p, ...patch } : p));
    setBusy(true);
    try {
      setPrefs(taken(await setBoardPrefs(patch)));
    } catch (e) {
      setPrefs(before);
      setStatus(t("error.saveFailed", { error: boardErrorMessage(e) }), "error");
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
            <div className="font-medium">{t("settings.followUps.title")}</div>
            <p className="text-sm text-muted-foreground">
              <Rich id="settings.followUps.hint" />
            </p>
          </div>
        </div>
        {prefs === null ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Switch
            checked={prefs.autoFollowUps}
            disabled={busy}
            onCheckedChange={(next) => void save({ autoFollowUps: next })}
            aria-label={t("settings.followUps.title")}
          />
        )}
      </div>

      {prefs !== null && (
        <div className="border-t border-border/60 py-1">
          {CARD_CATEGORIES.map((c) => {
            const on = prefs.followUpCategories.includes(c);
            return (
              <div key={c} className="flex items-center justify-between gap-4 py-1.5 pl-12 pr-4">
                <div className="min-w-0 text-sm">{t(`settings.followUps.${c}`)}</div>
                <Switch
                  checked={on}
                  disabled={busy || !prefs.autoFollowUps}
                  onCheckedChange={(next) =>
                    void save({
                      followUpCategories: next
                        ? CARD_CATEGORIES.filter((x) => x === c || prefs.followUpCategories.includes(x))
                        : prefs.followUpCategories.filter((x) => x !== c),
                    })
                  }
                  aria-label={t(`settings.followUps.${c}`)}
                />
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** Just the two keys this control owns — `maxAgents` has its own row, and echoing it back here
 *  would let a stale copy from this fetch overwrite what that one just set. */
type Prefs = Pick<BoardPrefs, "autoFollowUps" | "followUpCategories">;

const taken = (p: BoardPrefs): Prefs => ({
  autoFollowUps: p.autoFollowUps,
  followUpCategories: p.followUpCategories,
});

