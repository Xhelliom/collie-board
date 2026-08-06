import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { NotificationBell } from "@/components/notification-bell";

interface AppHeaderProps {
  /** Screen title, left-aligned. Ignored when `children` is set (a bespoke breadcrumb — the pane's
   *  `space › tab` or the card's parent link). */
  title?: string;
  /** Muted subtitle under the title — a count, a repo, a breadcrumb. */
  subtitle?: string;
  /** Renders a leading back chevron and calls this on tap. The four root screens (Herd/Board/Spaces/
   *  Settings) omit it — the nav (AppNav) is the way there now. A screen you enter (card, pane, a
   *  drilled-into space, history) sets it. */
  onBack?: () => void;
  /** A leading mark before title/subtitle — the dashboard only, mobile only (`lg:hidden` on the
   *  caller's own element): below `lg` the nav's Collie mark lives in the tab bar, shoulder to
   *  shoulder with three other icons, so the one screen that used to anchor the brand mark gets a
   *  quiet static echo of it back. Desktop already has the real thing at the top of the sidebar. */
  icon?: ReactNode;
  /** Bespoke left content, overriding title/subtitle entirely. */
  children?: ReactNode;
  /** Right-cluster lead items. */
  rightLead?: ReactNode;
  /** Right-cluster trailing items — typically the screen's primary action. */
  rightTrail?: ReactNode;
  /** Full-width takeover of the row (the pane's find bar). Still lives inside this one shell so the
   *  sticky/safe-area bar is never copy-pasted. */
  override?: ReactNode;
}

// The contextual toolbar every screen mounts below the nav (AppNav). It used to carry the Collie mark
// and its connection animation on every screen; both now live in the nav (sidebar / tab bar), so a
// healthy toolbar is just a title (or a bespoke breadcrumb) on the left, the screen's own controls on
// the right, and — on a screen you entered rather than navigated to via a tab — a back chevron leading
// the row.
export function AppHeader({
  title,
  subtitle,
  onBack,
  icon,
  children,
  rightLead,
  rightTrail,
  override,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex min-h-14 flex-none items-center gap-3 border-b border-border bg-background px-4 [padding-top:calc(env(safe-area-inset-top)_+_0.5rem)] lg:px-5">
      {override ?? (
        <>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="-ml-1.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 active:bg-muted"
            >
              <ArrowLeft className="size-5" />
            </button>
          )}
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {icon}
            {children ?? (
              <div className="min-w-0">
                {title && (
                  <div className="truncate text-[17px] font-semibold tracking-[-0.01em]">
                    {title}
                  </div>
                )}
                {subtitle && (
                  <div className="truncate text-sm text-muted-foreground">{subtitle}</div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {rightLead}
            {rightTrail}
            {/* The bell closes the right cluster on every screen. In a right-aligned row the anchored
                slot is the LAST one, and the bell is the only control present everywhere — so it gets
                it, and the screen's own controls (which change from screen to screen anyway) shift
                instead of pushing the bell around. */}
            <NotificationBell />
          </div>
        </>
      )}
    </header>
  );
}
