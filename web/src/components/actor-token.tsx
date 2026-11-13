import { useT } from "@/i18n";
import type { Actor } from "@/lib/card-fiche";
import { cn } from "@/lib/utils";

// Who did it, as the board's official token: a letter on a tinted square (A L C O B T, index.css
// § Actor token). Shared by a card's history and the Recette timeline. The name is spoken, and shown
// beside the token when `named`.
export function ActorToken({ actor, named, className }: { actor: Actor; named?: boolean; className?: string }) {
  const t = useT();
  const name = t(`fiche.actor.${actor}`);
  const token = (
    <span data-actor={actor} className="actor-token" role={named ? undefined : "img"} aria-label={named ? undefined : name} title={name} aria-hidden={named || undefined}>
      {t(`actor.letter.${actor}`)}
    </span>
  );
  if (!named) return <span className={cn("inline-flex", className)}>{token}</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {token}
      <span>{name}</span>
    </span>
  );
}
