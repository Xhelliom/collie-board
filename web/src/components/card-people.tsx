import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { CardView } from "@/lib/board";
import { personName, useRepoIdentities } from "@/lib/identities";

/**
 * Who filed a card and who it is for, on a shared board (ADR 0048 §5): « par alice » when someone
 * else created it, a chip « à bob » when it is assigned. Nothing at all on an unshared repo.
 */
export function useCardPeople(card: Pick<CardView, "repoPath" | "createdBy" | "assignee">): { by: string | null; to: string | null } | null {
  const t = useT();
  const ids = useRepoIdentities(card.repoPath);
  if (!ids) return null;
  const name = (email: string) => personName(email, ids.me, t("people.me"));
  const by = card.createdBy && card.createdBy !== ids.me ? name(card.createdBy) : null;
  const to = card.assignee ? name(card.assignee) : null;
  return by || to ? { by, to } : null;
}

export function CardPeople({ card, className }: { card: Pick<CardView, "repoPath" | "createdBy" | "assignee">; className?: string }) {
  const t = useT();
  const people = useCardPeople(card);
  if (!people) return null;
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", className)}>
      {people.by && <span title={card.createdBy ?? undefined}>{t("people.by", { name: people.by })}</span>}
      {people.to && (
        <span title={card.assignee ?? undefined} className="rounded-full border border-foreground/20 bg-accent px-1.5 py-px font-medium text-foreground">
          {t("people.to", { name: people.to })}
        </span>
      )}
    </span>
  );
}
