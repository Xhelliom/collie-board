import * as React from "react";
import { X } from "lucide-react";
import { Drawer } from "vaul";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useIsDesktop } from "@/hooks/use-media-query";

// The gesture belongs to Vaul, not to us — see .adr/0003-vaul-owns-the-sheet-gesture.md for the
// arbitration and the measured bundle cost. What the hand-rolled version never had, in the order it
// is felt: dismiss on VELOCITY (the flick), a close threshold that is a fraction of the panel's
// height instead of a fixed 90px, elastic resistance past the edges, and a return whose duration
// follows the distance travelled. Underneath it also brings a real focus trap (ours was explicitly
// "no full trap"), the body-scroll lock, Radix's outside-pointerdown rule — which is what the
// hand-rolled `backdropArmed` guard was reimplementing — and `repositionInputs`, on by default and
// the only thing that handles the iOS keyboard: Safari ignores the
// `interactive-widget=resizes-content` that index.html sets for Chrome.
//
// Everything below the header carries `data-vaul-no-drag`: a touch that starts in a field or a list
// belongs to that field or that list, never to the pull-to-dismiss. That was the reported bug, and
// this is Vaul's own escape hatch for it. The header is the drag zone — the panel is a flex column,
// so it never scrolls out of reach.

// The grab handle at the top of an open sheet — the drag zone's affordance, and ONLY that. It used
// to double as the closed pane screen's swipe-up trigger; a handle is a poor way to OPEN something
// (no label, no hit target of its own, and it cost the mirror a band of its own), so opening is a
// labelled button now and this stays where a handle earns its keep: on something already open.
// Ours rather than Vaul's `Drawer.Handle`, which ships a hard-coded light-grey background that
// fights the theme tokens.
export function GrabHandle({ className }: { className?: string }) {
  return <span className={cn("h-1.5 w-12 rounded-full bg-muted-foreground/50", className)} />;
}

interface SheetShellProps {
  open: boolean;
  onClose: () => void;
  direction: "bottom" | "left" | "right";
  title?: string;
  /** Optional action(s) rendered in the header, to the left of the close (✕) button. */
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

function SheetShell({
  open,
  onClose,
  direction,
  title,
  headerAction,
  footer,
  children,
  className,
}: SheetShellProps) {
  const atBottom = direction === "bottom";
  // The content gets its own padding everywhere except the LEFT drawer, which is upstream's
  // full-bleed nav rail. Not a property of "is this a side sheet" — a right-side sheet is a bottom
  // sheet that ran out of screen to come up from, and it holds the same padded content.
  const padded = direction !== "left";
  // Radix restores focus to its Trigger on close — and these sheets have none: the caller owns
  // `open`, so there is no Trigger to hand focus back to, and it would land on <body>. Remember who
  // had it. Captured during render because Radix moves focus in from its own mount effect, which
  // runs before any effect this component could schedule.
  // Released only once focus has actually been handed back — clearing it on `open === false` would
  // wipe it during the closing render, before Radix's unmount hand-off runs.
  const opener = React.useRef<HTMLElement | null>(null);
  if (open) opener.current ??= document.activeElement as HTMLElement | null;

  return (
    <Drawer.Root
      open={open}
      direction={direction}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/50" />
        {/* No Description in any of these sheets; telling Radix so keeps it from warning. */}
        <Drawer.Content
          aria-describedby={undefined}
          // Vaul leaves focus outside the panel unless told otherwise, which strands keyboard and
          // screen-reader users behind the modal. Radix's own default is the first tabbable — here
          // the ✕, so an Enter right after opening would close what you just opened. Focus the panel
          // itself instead, which is what the hand-rolled version did.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            opener.current?.focus?.();
            opener.current = null;
          }}
          className={cn(
            "fixed z-50 flex flex-col border-border bg-background shadow-2xl",
            className,
          )}
        >
          {/* No background and no blur on the header. It carried both when it was `sticky` inside the
              scrolling panel and content passed underneath it; now it is a flex sibling above its own
              scroller, so nothing ever does. Keeping them cost two visible defects: an opaque square
              box painting over the panel's rounded top corners (the panel can't clip it — `overflow:
              hidden` here would also clip Vaul's ::after, which covers the overscroll bounce), and a
              backdrop-filter sampling the page behind the drawer, which drew a bright line along the
              top edge wherever light content sat behind it. */}
          <div
            className={cn(
              "shrink-0 border-b border-border/60 px-4",
              atBottom ? "pb-3" : "py-3 [padding-top:calc(env(safe-area-inset-top)_+_0.75rem)]",
            )}
          >
            {atBottom && (
              <div className="flex justify-center pt-2 pb-1">
                <GrabHandle />
              </div>
            )}
            <div className="flex items-center justify-between">
              <Drawer.Title className="text-sm font-semibold">{title}</Drawer.Title>
              <div className="flex items-center gap-1">
                {headerAction}
                <Drawer.Close asChild>
                  <Button variant="ghost" size="icon" className="size-8" aria-label="Close">
                    <X className="size-4" />
                  </Button>
                </Drawer.Close>
              </div>
            </div>
          </div>
          <div
            data-vaul-no-drag
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overscroll-contain",
              padded && "px-4 py-3",
            )}
          >
            {children}
          </div>
          {footer && (
            <div
              data-vaul-no-drag
              className="shrink-0 border-t border-border/60 px-3 py-2 pb-[calc(env(safe-area-inset-bottom)_+_0.5rem)]"
            >
              {footer}
            </div>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Pinned below the scroller — a form's confirm action goes here, not at the end of the body. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

// A bottom sheet on a phone, the SAME sheet entering from the right on a wide screen. Not a second
// component and not a second gesture — one `direction` and one set of positioning classes apart, as
// Vaul intends. A panel that slides up from the bottom edge of a 27" display is a phone idiom
// wearing the wrong screen; and on the four-column board a right-hand panel leaves the columns
// visible, which a centred modal would cover.
//
// The breakpoint is a matchMedia read, not a CSS class, because `direction` is a prop Vaul uses to
// pick the drag axis and the enter/exit transform — CSS can't switch that.
export function BottomSheet({ open, onClose, title, footer, children, className }: BottomSheetProps) {
  const desktop = useIsDesktop();
  return (
    <SheetShell
      open={open}
      onClose={onClose}
      direction={desktop ? "right" : "bottom"}
      title={title}
      footer={footer}
      // No top border: the panel already reads as a separate surface against the dimmed backdrop, and
      // a hairline there drew as a bright seam under the rounded corners rather than an edge.
      className={cn(
        desktop
          ? "inset-y-0 right-0 w-[26rem] max-w-[92vw] rounded-l-2xl border-l"
          : "inset-x-0 bottom-0 max-h-[82dvh] w-full rounded-t-2xl",
        // The footer carries the safe-area inset itself; adding it here too would double it.
        !desktop && !footer && "pb-[calc(env(safe-area-inset-bottom)_+_1rem)]",
        className,
      )}
    >
      {children}
    </SheetShell>
  );
}

interface SideSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Optional action(s) rendered in the header, to the left of the close (✕) button. */
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

// A left-edge drawer: the same component, one prop apart. Nothing in the app renders it today — the
// thread sidebar goes into a BottomSheet — but it is upstream's export, so it stays.
export function SideSheet({
  open,
  onClose,
  title,
  headerAction,
  children,
  footer,
  className,
}: SideSheetProps) {
  return (
    <SheetShell
      open={open}
      onClose={onClose}
      direction="left"
      title={title}
      headerAction={headerAction}
      footer={footer}
      className={cn("inset-y-0 left-0 w-[86%] max-w-sm border-r", className)}
    >
      {children}
    </SheetShell>
  );
}
