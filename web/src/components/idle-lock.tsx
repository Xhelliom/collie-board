import { NavMark } from "@/components/app-nav";
import { Button } from "@/components/ui/button";

// The cover shown while the idle lock is engaged. It sits ABOVE a still-mounted router (see App), so
// resuming returns you to the exact screen, draft and scroll position you left — nothing is unmounted
// and nothing is rebuilt.
//
// It is deliberately GLASS rather than opaque. The cover's job is to say "this is frozen, not live" —
// a paused mirror read as a current one is the actual hazard — and it does that better while the herd
// stays legible underneath: you can see WHAT is stale instead of losing the screen entirely. The
// trade is that an unattended screen no longer hides agent output; that's accepted, because the
// device's own screen lock is the thing that was ever going to handle shoulder-surfing.
//
// It leads with the Collie mark (NavMark, the same ringed badge the header uses) for a plain reason:
// this is the one screen in the app with no header, no herd and no chrome, so without the badge a
// full-viewport panel is unattributable — it could be any app that happened to be open.
//
// No lock iconography and no "for safety" — the pause guards nothing (.adr/0007). Saying otherwise
// would promise a gate that a page reload has always walked straight through.
interface IdleLockProps {
  onUnlock: () => void;
  /** The refetch fired on resume is still in flight — hold the cover and run the gallop rather than
   *  dropping straight back onto the frozen screen this panel just warned about. */
  catchingUp?: boolean;
}

export function IdleLock({ onUnlock, catchingUp = false }: IdleLockProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Collie en pause"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/40 px-6 backdrop-blur-[3px]"
    >
      {/* The panel carries its own, heavier blur so the copy stays readable over arbitrary pane text,
          while the scrim above keeps the herd recognisable behind it. */}
      <div className="flex flex-col items-center gap-6 rounded-3xl border border-border/60 bg-card/70 px-8 py-10 text-center shadow-2xl ring-1 ring-white/10 backdrop-blur-2xl">
        <div className="flex flex-col items-center gap-3">
          <NavMark gallop={catchingUp} lost={false} size={80} />
          <span className="text-lg font-semibold tracking-tight">Collie</span>
        </div>
        {catchingUp ? (
          <div className="space-y-1">
            <p className="font-medium">Mise à jour…</p>
            <p className="max-w-xs text-sm text-muted-foreground">Récupération de l'état de la meute.</p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="font-medium">En pause</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Les mises à jour se sont arrêtées pendant que cet écran restait inactif — ce qu'il y a
              derrière est figé. La reprise repart exactement où vous en étiez.
            </p>
          </div>
        )}
        {/* The button doesn't just disable during the catch-up — it's replaced by the gallop above, so
            there's nothing to press twice and no dead control to look at. */}
        {!catchingUp && (
          <Button size="lg" onClick={onUnlock}>
            Toucher pour reprendre
          </Button>
        )}
      </div>
    </div>
  );
}
