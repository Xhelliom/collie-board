import { Check, Loader2, Send, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The one send gesture of every message box (agent view, orchestrator, card prompts): the design
// system's brand button, 44 px, same shape everywhere. During an agent's turn with nothing to send
// it becomes Stop (when the caller gives `onStop`) — one button, not two side by side.
export function SendButton({
  label,
  stopLabel,
  onClick,
  onStop,
  hasContent,
  working = false,
  busy = false,
  armed = false,
  disabled = false,
  type = "button",
  className,
}: {
  /** The aria-label (and title) as Send. */
  label: string;
  /** The aria-label (and title) as Stop. */
  stopLabel?: string;
  onClick?: () => void;
  /** Present → the button is Stop while `working` and `!hasContent`. */
  onStop?: () => void;
  /** Text or an image is waiting to go. */
  hasContent: boolean;
  working?: boolean;
  busy?: boolean;
  /** "Done / confirm" state: a check instead of the send icon. */
  armed?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const stop = working && !hasContent && !!onStop;
  const name = stop ? stopLabel : label;
  return (
    <Button
      type={stop ? "button" : type}
      variant="brand"
      className={cn("size-11 shrink-0 px-0", className)}
      disabled={stop ? disabled : disabled || busy || !hasContent}
      onClick={stop ? onStop : onClick}
      aria-label={name}
      title={name}
    >
      {stop ? <Square className="size-4 fill-current" /> : busy ? <Loader2 className="size-4 animate-spin" /> : armed ? <Check className="size-4" /> : <Send className="size-4" />}
    </Button>
  );
}
