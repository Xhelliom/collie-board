import { User } from "lucide-react";

import { useT } from "@/i18n";
import type { Pin } from "@/lib/prompt-pin";

// The prompt pin: the question the turns on screen answer, held over the top of reading mode.
// An OVERLAY, never a row in the thread — a row that came and went while scrolling would shift the
// text being read. Fixed at two lines whatever the prompt's length. A tap scrolls back to it.
export function PromptPin({ pin, onTap }: { pin: Pin; onTap: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      data-slot="prompt-pin"
      onClick={onTap}
      aria-label={t("pane.reading.pin", { text: pin.text })}
      className="pointer-events-auto flex h-14 w-full min-w-0 items-start gap-2 overflow-hidden rounded-md border bg-background px-3 py-2 text-left shadow-sm active:bg-muted"
    >
      <User aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-5 wrap-anywhere whitespace-pre-wrap">
        {pin.text}
      </span>
    </button>
  );
}
