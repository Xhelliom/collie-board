import { useState } from "react";

import { useT } from "@/i18n";

/**
 * Folds a long list to its first `limit` entries; the returned `toggle` is the « Voir les n autres »
 * button (null when everything fits). The text counterpart is `CollapsibleText`.
 */
export function useFold<T>(items: T[], limit: number) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, limit);
  const toggle =
    items.length > limit ? (
      <FoldToggle open={open} onClick={() => setOpen((o) => !o)} label={t("fold.more", { count: items.length - limit })} lessLabel={t("fold.less")} />
    ) : null;
  return { shown, toggle };
}

export function FoldToggle({
  open,
  label,
  lessLabel,
  onClick,
}: {
  open: boolean;
  label: string;
  lessLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onClick}
      className="flex min-h-11 items-center self-start px-2 text-sm text-primary underline-offset-2 hover:underline"
    >
      {open ? lessLabel : label}
    </button>
  );
}
