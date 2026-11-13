import { TerminalSquare } from "lucide-react";

import { AnsiOutput } from "@/components/ansi-output";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { isHorizontalRule } from "@/lib/harness/claude/markers";

// Reading mode shows the conversation, and a screen that is not part of it — the folder-trust
// prompt, a repo's MCP approval, any first-run choice — never reaches the transcript. herdr reports
// the agent `blocked` in front of those (HERDR_API.md § "First-run screens"); when no grammar lifted
// the screen into buttons, this banner shows its last rows and the keys that answer it, so the card
// that "never starts" doesn't need a trip to terminal mode. It is derived from the poll each time,
// so it goes away by itself once the agent is working again or the screen stops blocking.

/** Rows of the screen's tail always shown, and how far up the dialog's top border is looked for. */
export const BLOCKED_TAIL_ROWS = 14;
const BLOCKED_TAIL_MAX = 40;

const plain = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

/**
 * The screen's tail (ANSI kept, rendered by AnsiOutput), trailing blanks dropped: from the dialog's
 * top border — the nearest rule above the tail that is not the separator a menu draws before a
 * numbered row ("5. Chat about this") — so a long question keeps its first lines. Never fewer than
 * `rows` rows, never more than BLOCKED_TAIL_MAX.
 */
export function screenTail(display: string, rows = BLOCKED_TAIL_ROWS): string {
  const lines = display.split("\n");
  while (lines.length > 0 && plain(lines.at(-1)!).trim() === "") lines.pop();
  let start = Math.max(0, lines.length - rows);
  for (let i = lines.length - 2; i >= Math.max(0, lines.length - BLOCKED_TAIL_MAX); i--) {
    if (!isHorizontalRule(plain(lines[i]!))) continue;
    if (/^\s*(?:❯\s*)?\d+\.\s/.test(plain(lines[i + 1]!))) continue;
    start = Math.min(start, i);
    break;
  }
  return lines.slice(start).join("\n");
}

const KEYS: { label: string; keys: string[] }[] = [
  { label: "↑", keys: ["Up"] },
  { label: "↓", keys: ["Down"] },
  { label: "1", keys: ["1"] },
  { label: "2", keys: ["2"] },
  { label: "3", keys: ["3"] },
  { label: "Space", keys: ["Space"] }, // a checklist toggles with it
  { label: "Esc", keys: ["Escape"] },
  { label: "Enter", keys: ["Enter"] },
];

export function BlockedScreenBanner({
  display,
  disabled,
  onKeys,
  onShowTerminal,
}: {
  display: string;
  disabled?: boolean;
  onKeys: (keys: string[]) => void;
  onShowTerminal: () => void;
}) {
  const t = useT();
  return (
    <div role="region" aria-label={t("pane.blocked.title")} className="shrink-0 border-b border-status-blocked/40 bg-status-blocked/10 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{t("pane.blocked.title")}</div>
        <Button type="button" variant="ghost" size="sm" onClick={onShowTerminal}>
          <TerminalSquare className="size-3.5" />
          {t("pane.blocked.showTerminal")}
        </Button>
      </div>
      {/* AnsiOutput with no agent = the plain raw mirror: React text nodes, never HTML. */}
      <div className="mt-1 max-h-[45dvh] overflow-auto rounded-md bg-terminal-background">
        <AnsiOutput text={screenTail(display)} wrap />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {KEYS.map((k) => (
          <Button
            key={k.label}
            type="button"
            variant="outline"
            size="sm"
            className="min-w-11"
            disabled={disabled}
            aria-label={t("pane.blocked.key", { key: k.label })}
            onClick={() => onKeys(k.keys)}
          >
            {k.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
