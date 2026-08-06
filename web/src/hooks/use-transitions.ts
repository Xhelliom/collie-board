import { useCallback, useEffect, useRef, useState } from "react";

import { notifyVerb, notifyWhat, notifyWhere, paneDisplayName, type AgentStatus, type AgentView } from "@/lib/types";

// In-app lifecycle notifications. We diff each snapshot against the previous one and raise a toast
// when an agent crosses into a state that wants attention. Background/OS notifications are handled
// separately by the server via Web Push; this is the foreground equivalent — and the reason the
// service worker suppresses a push while a Collie tab is visible (lib/push-decision.ts).
//
// The first snapshot never fires (prev is null), so opening the app doesn't spam toasts for agents
// that were already blocked — matching the server's transition semantics.
//
// WHAT A TOAST CARRIES (decided here; the old status line carried only `agent · workspace`), same
// naming/formatting the bell's history uses (lib/types.ts) so upgrading one upgrades both:
//   • title  — the pane's display name, the verb, and WHERE (herd session + workspace/repo) — all
//              short, stable identity, so it shares one line and leaves the second line to WHAT.
//              `paneDisplayName` is the session you'd recognise: your own pane label, else Claude's
//              `/rename` session name, else the agent name. Three panes running "claude" used to
//              produce three identical notices.
//   • detail — WHAT happened: the card it backs, falling back to the working directory when the
//              pane isn't card-backed. NEVER a copilot subtitle: that answer can take seconds to
//              minutes, and a toast is gone in {@link TOAST_TTL_MS} (see agent-toasts.tsx) — by the
//              time it would land there's nothing left to update. The bell can show it because it's
//              a persistent record, not a transient one.
//   • a tap  — deep-links into the pane, in its own session.
// Everything above is read straight off the snapshot's `AgentView`, so a toast costs no extra fetch.

export interface AgentToast {
  /** Monotonic within this mount — a stable list key, nothing more. */
  id: number;
  paneId: string;
  /** The herd session the pane lives in (undefined = primary) — the tap scopes to it. */
  session?: string;
  status: "blocked" | "done";
  title: string;
  detail: string;
}

/** Toasts kept on screen at once — older ones drop off, they're transient by construction. */
const MAX_TOASTS = 3;

function describe(a: AgentView, session: string | undefined): Omit<AgentToast, "id"> {
  const status = a.status as "blocked" | "done";
  const where = notifyWhere({ session, workspaceLabel: a.workspaceLabel });
  return {
    paneId: a.paneId,
    session,
    status,
    title: `${paneDisplayName(a)} ${notifyVerb(status)} · ${where}`,
    detail: notifyWhat({ cardTitle: a.cardTitle, cwd: a.cwd }),
  };
}

/**
 * Watch the herd for attention-wanting transitions. `openPaneId` suppresses the pane you're already
 * looking at; `copilotPaneId` suppresses the board's own agent — a real pane with real transitions,
 * whose every internal request/reset would otherwise toast exactly like a worker's (the bridge keeps
 * it out of push/history the same way, by pane id rather than its renameable workspace label — see
 * index.ts). `session` is the herd session the snapshot was fetched for, stamped into each toast so
 * its tap lands in the right herd. Toasts auto-dismiss in the component that renders them.
 */
export function useAgentTransitions(
  agents: AgentView[],
  openPaneId: string | null,
  copilotPaneId: string | null,
  session?: string,
): { toasts: AgentToast[]; dismiss: (id: number) => void } {
  const prev = useRef<Map<string, AgentStatus> | null>(null);
  const [toasts, setToasts] = useState<AgentToast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const now = new Map(agents.map((a) => [a.paneId, a.status]));
    const before = prev.current;
    prev.current = now;
    if (!before) return;

    const fresh: AgentToast[] = [];
    for (const a of agents) {
      const was = before.get(a.paneId);
      if (!was || was === a.status) continue;
      if (a.paneId === openPaneId) continue; // you're already looking at it
      if (a.paneId === copilotPaneId) continue; // the board's own agent, not a worker
      if (a.status !== "blocked" && a.status !== "done") continue;
      fresh.push({ id: nextId.current++, ...describe(a, session) });
    }
    if (fresh.length === 0) return;
    // One toast per pane: a blocked→done flip replaces its own notice rather than stacking a second.
    const supersededPanes = new Set(fresh.map((t) => t.paneId));
    setToasts((list) => [...list.filter((t) => !supersededPanes.has(t.paneId)), ...fresh].slice(-MAX_TOASTS));
  }, [agents, openPaneId, copilotPaneId, session]);

  return { toasts, dismiss };
}
