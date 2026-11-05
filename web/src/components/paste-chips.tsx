import { useState } from "react";
import { ClipboardList, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ChatInput } from "@/components/ui/chat/chat-input";
import { useT } from "@/i18n";
import { pasteLabel, pasteMarker, type PasteChip } from "@/lib/paste-chips";

interface PasteChipsProps {
  chips: PasteChip[];
  onEdit: (n: number, text: string) => void;
  onRemove: (n: number) => void;
}

// The chips over the composer for its collapsed long pastes (lib/paste-chips.ts): tap one to edit its
// text in place, × to drop it with its marker. Renders nothing without a chip.
export function PasteChips({ chips, onEdit, onRemove }: PasteChipsProps) {
  const t = useT();
  const [open, setOpen] = useState<number | null>(null);
  if (chips.length === 0) return null;
  const editing = chips.find((c) => c.n === open);
  return (
    <div className="mb-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <div key={c.n} className="flex max-w-full items-center rounded-full bg-muted/60 text-xs">
            <button
              type="button"
              className="flex min-w-0 items-center gap-1 py-1 pl-2.5 pr-1"
              aria-expanded={open === c.n}
              aria-label={t("pane.paste.edit", { marker: pasteMarker(c.n) })}
              onClick={() => setOpen(open === c.n ? null : c.n)}
            >
              <ClipboardList className="size-3 shrink-0" />
              <span className="font-medium">{pasteMarker(c.n)}</span>
              <span className="truncate text-muted-foreground">{pasteLabel(c.text)}</span>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 rounded-full"
              aria-label={t("pane.paste.remove", { marker: pasteMarker(c.n) })}
              onClick={() => {
                if (open === c.n) setOpen(null);
                onRemove(c.n);
              }}
            >
              <X className="size-3" />
            </Button>
          </div>
        ))}
      </div>
      {editing && (
        <ChatInput
          value={editing.text}
          onChange={(e) => onEdit(editing.n, e.target.value)}
          aria-label={t("pane.paste.edit", { marker: pasteMarker(editing.n) })}
          className="max-h-60 font-mono text-xs"
        />
      )}
    </div>
  );
}
