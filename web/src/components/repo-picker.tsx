import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";

import { useT } from "@/i18n";
import { BottomSheet } from "@/components/ui/sheet";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

/** Case- and accent-insensitive search key: « Écran » matches « ecr ». Pure, exported for the test. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export interface PickItem {
  value: string;
  label: string;
  /** An action, not a project: never filtered out, so « Add a project » stays at hand when nothing matches. */
  action?: boolean;
}

/** Where the picker opens: a panel anchored under `children` (the trigger) on a wide screen, the full
 *  screen on a phone. Shared by the project title and the new-agent folder field. */
export function RepoMenu({
  open,
  onClose,
  items,
  current,
  onPick,
  title,
  children,
  className,
  panelClassName,
}: {
  open: boolean;
  onClose: () => void;
  items: PickItem[];
  current: string;
  onPick: (value: string) => void;
  title: string;
  children: ReactNode;
  className?: string;
  panelClassName?: string;
}) {
  const desktop = useIsDesktop();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // The anchored panel closes on a press outside it; the sheet has its own overlay for that.
  useEffect(() => {
    if (!open || !desktop) return;
    const close = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, desktop, onClose]);

  const picker = open && <RepoPicker items={items} current={current} onPick={onPick} onClose={onClose} inputRef={inputRef} />;

  return (
    <div ref={boxRef} className={cn("relative min-w-0", className)}>
      {children}
      {desktop ? (
        picker && (
          <div className={cn("absolute left-0 top-full z-30 mt-1 flex max-h-[min(28rem,70vh)] w-80 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-(--shadow-3)", panelClassName)}>
            {picker}
          </div>
        )
      ) : (
        // Full screen on a phone: the keyboard takes half of it, the list needs the rest.
        <BottomSheet open={open} onClose={onClose} title={title} initialFocus={inputRef} className="h-dvh max-h-dvh rounded-none pt-[env(safe-area-inset-top)]">
          {picker}
        </BottomSheet>
      )}
    </div>
  );
}

/** The search field and the list it filters — ARIA combobox: focus stays in the field, the arrows move
 *  `aria-activedescendant`, Enter picks, Escape closes. */
export function RepoPicker({
  items,
  current,
  onPick,
  onClose,
  inputRef,
}: {
  items: PickItem[];
  current: string;
  onPick: (value: string) => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const t = useT();
  const id = useId();
  const [query, setQuery] = useState("");
  const q = fold(query.trim());
  const shown = items.filter((i) => i.action || fold(i.label).includes(q));
  const [active, setActive] = useState(() => Math.max(0, items.findIndex((i) => i.value === current)));
  const at = Math.min(active, shown.length - 1);
  const optId = (i: number) => `${id}-o${i}`;
  const empty = !shown.some((i) => !i.action);

  useEffect(() => {
    document.getElementById(optId(at))?.scrollIntoView?.({ block: "nearest" });
  });

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((at + step + shown.length) % shown.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[at]) onPick(shown[at].value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <>
      <div className="sticky top-0 z-10 bg-inherit p-2">
        <input
          ref={inputRef}
          autoFocus
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={shown.length ? optId(at) : undefined}
          aria-label={t("repo.search")}
          placeholder={t("repo.search")}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-10 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring lg:text-sm"
        />
      </div>
      {empty && <p className="px-4 pt-1 text-sm text-muted-foreground">{t("repo.none")}</p>}
      <ul id={`${id}-list`} role="listbox" aria-label={t("repo.label")} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
        {shown.map((item, i) => (
          <li
            key={item.value}
            id={optId(i)}
            role="option"
            aria-selected={i === at}
            // Keep focus in the field: the list is driven from it.
            onMouseDown={(e) => e.preventDefault()}
            onPointerMove={() => i !== at && setActive(i)}
            onClick={() => onPick(item.value)}
            className={cn(
              "flex h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-sm lg:h-10",
              i === at && "bg-muted",
              item.action ? "text-muted-foreground" : "font-medium",
              item.action && (i === 0 || !shown[i - 1]!.action) && "mt-1",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {!item.action && item.value === current && <Check className="size-4 shrink-0" aria-hidden="true" />}
          </li>
        ))}
      </ul>
    </>
  );
}
