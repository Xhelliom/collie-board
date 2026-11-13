// The one line a board tile says about where its card stands — read from what the card already knows
// (its status, its pane, its journal facts, its predecessor). PURE, so the order of the cases is tested.
import { t } from "@/i18n";
import type { Awaiting, CardView } from "./board";
import type { DependencyInfo } from "./board-groups";
import type { LotHold } from "./lot-hold";
import { ago, type CardFacts } from "./project-facts";

/** `bad` is red and means blocked — the only red on a tile. `strong` asks for you without alarm. */
export type TileTone = "bad" | "good" | "strong" | "plain" | "quiet";

/** `agent`: a live pane backs the card — the tile asks the herd for its state (agent-identity). */
export type TileState = { agent: true } | { agent?: false; text: string; tone: TileTone };

/** Done and finished this week: the Fini column's default view. */
export const WEEK_MS = 7 * 24 * 3600 * 1000;
export const doneThisWeek = (c: CardView, now = Date.now()): boolean => now - c.updatedAt < WEEK_MS;

export function tileState(
  card: CardView,
  o: { facts?: CardFacts; dependency?: DependencyInfo; lot?: LotHold | null; awaiting?: Awaiting },
  now = Date.now(),
): TileState {
  const pr = o.facts?.pr?.state;
  // updatedAt stands in for "finished when" — CardView has no doneAt (same choice as the Done column).
  if (card.status === "done")
    return pr === "merged"
      ? { text: t("tile.state.merged", { ago: ago(card.updatedAt, now) }), tone: "good" }
      : { text: t("tile.state.finished", { ago: ago(card.updatedAt, now) }), tone: "quiet" };
  if (card.status === "orphaned") return { text: t("tile.state.blocked", { reason: t("tile.state.lost") }), tone: "bad" };
  if (card.status === "review" && pr === "closed")
    return { text: t("tile.state.blocked", { reason: t("tile.state.prClosed") }), tone: "bad" };
  if (o.awaiting) return { text: t("tile.state.question"), tone: "strong" };
  if (card.runtime) return { agent: true };
  if (card.status === "blocked") return { text: t("agents.state.needs"), tone: "strong" };
  if (card.copilotBusy) return { text: t("tile.state.copilot"), tone: "quiet" };
  if (card.status === "review") {
    if (o.lot?.step) return { text: `${o.lot.label} · ${t(`lot.step.${o.lot.step}`)}`, tone: "plain" };
    return { text: t(pr === "open" ? "tile.state.prOpen" : "tile.state.review"), tone: "plain" };
  }
  if (card.status === "working" || card.status === "starting") return { text: t("tile.state.starting"), tone: "plain" };
  if (o.dependency && !o.dependency.met) return { text: t("tile.state.waits", { title: o.dependency.title }), tone: "quiet" };
  return { text: t("tile.state.ready"), tone: "plain" };
}
