import { describe, expect, test } from "bun:test";
import { lotHoldsPush, type LotPushDeps } from "./lot-push.ts";
import type { Alert } from "./notifications.ts";

const alert = (cardId?: string): Alert => ({ cwd: "/r", status: "done", ...(cardId ? { cardId } : {}) });

function deps(over: Partial<{ enabled: boolean; alive: boolean; open: string[]; runId: string | null }> = {}): LotPushDeps {
  const o = { enabled: true, alive: true, open: ["run1"], runId: "run1" as string | null, ...over };
  return {
    enabled: () => o.enabled,
    db: {
      getCard: (id) => (id === "c1" ? { runId: o.runId, repoPath: "/r" } : null),
      listOpenRuns: () => o.open.map((id) => ({ id })),
    },
    orchestratorAlive: (repo) => o.alive && repo === "/r",
  };
}

describe("lotHoldsPush", () => {
  test("carte d'un lot ouvert, orchestrateur vivant : retenue", () => {
    expect(lotHoldsPush("%1", alert("c1"), deps())).toBe(true);
    expect(lotHoldsPush("card:c1", alert("c1"), deps())).toBe(true);
  });
  test("fin de lot (run:) : retenue même si le lot est déjà fini", () => {
    expect(lotHoldsPush("run:run1", alert("c1"), deps({ open: [] }))).toBe(true);
  });
  test("pas d'orchestrateur vivant (mort en plein lot) : push", () => {
    expect(lotHoldsPush("%1", alert("c1"), deps({ alive: false }))).toBe(false);
  });
  test("réglage désactivé : push", () => {
    expect(lotHoldsPush("%1", alert("c1"), deps({ enabled: false }))).toBe(false);
  });
  test("lot terminé, carte hors lot, pane sans carte : push", () => {
    expect(lotHoldsPush("%1", alert("c1"), deps({ open: [] }))).toBe(false);
    expect(lotHoldsPush("%1", alert("c1"), deps({ runId: null }))).toBe(false);
    expect(lotHoldsPush("%1", alert(), deps())).toBe(false);
  });
  test("la note de l'orchestrateur n'est jamais retenue", () => {
    expect(lotHoldsPush("note:%9", alert("c1"), deps())).toBe(false);
  });
});
