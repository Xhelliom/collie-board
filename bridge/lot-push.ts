// Pendant un lot lancé, l'orchestrateur du dépôt reçoit déjà chaque fin de carte (orchestrator-nudge.ts)
// et en fait le bilan : le push revient à lui (POST /api/board/notify). Cette règle décide, pour une
// alerte qui vient de tirer, si elle part au téléphone ou reste dans la cloche (ADR 0040). Pure : le
// coordinateur la reçoit en crochet (index.ts), rien ne passe par server.ts.

import type { Alert } from "./notifications.ts";

/** Le coin de `BoardDb` lu ici. */
export interface LotPushSource {
  getCard(id: string): { runId: string | null; repoPath: string | null } | null;
  /** Les lots lancés et pas encore terminés. */
  listOpenRuns(): { id: string }[];
}

export interface LotPushDeps {
  /** Le réglage « Lots : laisser l'orchestrateur notifier ». */
  enabled: () => boolean;
  db: LotPushSource;
  /** Un orchestrateur vit-il pour ce dépôt ? Lu au tir : s'il est mort, l'alerte repart en push. */
  orchestratorAlive: (repoPath: string) => boolean;
}

/**
 * Cette alerte reste-t-elle dans la cloche ? `key` est celle du coordinateur : `note:` est la parole
 * explicite d'un agent (celle de l'orchestrateur compris), jamais retenue ; `run:` est la fin d'un
 * lot, qui par définition n'est plus « ouvert » quand elle tire.
 */
export function lotHoldsPush(key: string, alert: Alert, d: LotPushDeps): boolean {
  if (!d.enabled() || key.startsWith("note:")) return false;
  const card = alert.cardId ? d.db.getCard(alert.cardId) : null;
  if (!card?.runId || !card.repoPath) return false;
  if (!key.startsWith("run:") && !d.db.listOpenRuns().some((r) => r.id === card.runId)) return false;
  return d.orchestratorAlive(card.repoPath);
}
