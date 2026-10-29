import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { CardView } from "@/lib/board";
import { claimHolder, personName, useIdentities } from "@/lib/identities";

type PeopleCard = Pick<CardView, "repoPath" | "createdBy" | "assignee" | "claim" | "status">;

/**
 * Who filed a card and who it is for, on a shared board (ADR 0048 §5): « par alice » when someone
 * else created it, a chip « à bob » when it is assigned, « en cours chez carol » while another pair
 * holds it (§7). Nothing at all on an unshared repo.
 */
export function useCardPeople(card: PeopleCard): { by: string | null; to: string | null; at: string | null } | null {
  const t = useT();
  const all = useIdentities();
  const ids = card.repoPath ? all[card.repoPath] : undefined;
  if (!ids) return null;
  const name = (email: string) => personName(email, ids.me, t("people.me"));
  const by = card.createdBy && card.createdBy !== ids.me ? name(card.createdBy) : null;
  const to = card.assignee ? name(card.assignee) : null;
  const held = claimHolder(card, all);
  const at = held ? name(held.by) : null;
  return by || to || at ? { by, to, at } : null;
}

export function CardPeople({ card, className }: { card: PeopleCard; className?: string }) {
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
      {people.at && (
        <span title={card.claim?.by} className="rounded-full bg-status-working/15 px-1.5 py-px font-medium text-status-working">
          {t("people.runningAt", { name: people.at })}
        </span>
      )}
    </span>
  );
}
