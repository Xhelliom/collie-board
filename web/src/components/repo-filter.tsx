import { Chip } from "@/components/ui/chip";
import { SectionLabel } from "@/components/ui/section-label";
import type { RepoScope } from "@/lib/board";

/**
 * The board's repo scope: one chip per repo that has cards, plus "All".
 *
 * The SAME strip the sessions side uses for spaces (`SpaceStrip`) — a scrolling row of pills, lead
 * chip is the escape — because that idiom already exists in this app and already works on a phone.
 * Not a `<Tabs>`: tabs want a bounded, known set that fits the width, and the repo list is neither.
 * [ADR 0006](../../../.adr/0006-the-board-scopes-by-repo-and-remembers-it.md).
 *
 * Sits above the scroller with the tag strip, and directly above it: repo is the coarser axis (where
 * the work lives), tag the finer one (what kind of work), and they compose — scoping to a repo
 * narrows the tag strip to that repo's tags, so the two rows never offer a combination that is empty.
 *
 * Renders nothing while there is nothing to choose between — one repo, or none. Except when a scope
 * is already on: a board filtered by a strip that isn't drawn is a board that has silently lost
 * cards, so the way out stays on screen even if it is the only repo left.
 */
export function RepoFilter({
  repos,
  active,
  onPick,
}: {
  /** Repos to offer, in `reposOf` order — most recently touched first. */
  repos: RepoScope[];
  active: string | null;
  onPick: (repoPath: string | null) => void;
}) {
  if (active === null && repos.length < 2) return null;
  return (
    <div className="flex snap-x scroll-px-3 items-center gap-2 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:snap-start">
      <SectionLabel>Repos</SectionLabel>
      <Chip label="All" active={active === null} onClick={() => onPick(null)} />
      {repos.map((repo) => (
        <Chip
          key={repo.path}
          label={repo.name}
          active={active === repo.path}
          onClick={() => onPick(active === repo.path ? null : repo.path)}
        />
      ))}
    </div>
  );
}
