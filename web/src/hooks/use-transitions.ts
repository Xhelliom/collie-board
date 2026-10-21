import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { useT } from "@/i18n";
import { cardPath } from "@/lib/board";
import { panePath } from "@/lib/nav";
import { notifyCardId, notifyContent } from "@/lib/notify-content";
import type { AgentStatus, AgentView } from "@/lib/types";

// In-app lifecycle notifications. We diff each snapshot against the previous one and raise a toast
// when an agent crosses into a state that wants attention. Background/OS notifications are handled
// separately by the server via Web Push; this is the foreground equivalent — and the reason the
// service worker suppresses a push while a Collie tab is visible (lib/push-decision.ts).
//
// The first snapshot never fires (prev is null), so opening the app doesn't spam toasts for agents
// that were already blocked — matching the server's transition semantics.
//
// WHAT A TOAST CARRIES: whatever `notifyContent` (lib/notify-content.ts) composes, because the toast,
// the bell and the push are ONE sentence written once (NOTIFY_AUDIT.md §1.3, card N9) — the subject is
// the work (the card it backs, else its repo), never the agent, which is the word "claude" on every
// pane and so discriminates nothing.
//   • detail — the composition's body: the herd session when it isn't the primary one, the repo when
//              the card already took the title, and what happened. NEVER a copilot subtitle — hence
//              the `null` below: that answer can take seconds to minutes, and a toast is gone in
//              {@link TOAST_TTL_MS}, so by the time it would land there is
//              nothing left to update. The bell shows it because it is a persistent record.
//   • Open   — deep-links into the pane, in its own session — EXCEPT when the alert is about a card
//              to read (`notifyCardId`), where it follows the sentence to the card instead: the pane
//              is finished, so the terminal is the one place with nothing left to do (§4.1).
// Everything above is read straight off the snapshot's `AgentView`, so a toast costs no extra fetch.

interface AgentToast {
  paneId: string;
  /** The herd session the pane lives in (undefined = primary) — the tap scopes to it. */
  session?: string;
  /** Set only for a "card to read" alert: the tap opens this card instead of the pane. */
  cardId?: string;
  status: "blocked" | "done";
  title: string;
  detail: string;
}

/** How long a toast stays up. Longer than a send confirmation — this one is worth reading and tapping. */
const TOAST_TTL_MS = 6000;

function describe(a: AgentView, session: string | undefined): AgentToast {
  const status = a.status as "blocked" | "done";
  // The snapshot this diff ran on is the same one `reconcile()` had already acted on, so `cardStatus`
  // is current here with none of the re-reading the push has to do (§4.2).
  // `paneId` is passed because `notifyCardId` reads it: an alert with NO pane is about its card
  // whatever its column (a board alert — bridge/board-notify.ts). A toast always has one, so this
  // says so explicitly rather than letting the absent field decide for it.
  const subject = { status, paneId: a.paneId, cwd: a.cwd, cardTitle: a.cardTitle, cardId: a.cardId, cardStatus: a.cardStatus, session };
  const { title, body } = notifyContent(subject, null);
  return { paneId: a.paneId, session, cardId: notifyCardId(subject), status, title, detail: body };
}

/**
 * Watch the herd for attention-wanting transitions. `openPaneId` suppresses the pane you're already
 * looking at; `copilotPaneId` suppresses the board's own agent — a real pane with real transitions,
 * whose every internal request/reset would otherwise toast exactly like a worker's (the bridge keeps
 * it out of push/history the same way, by pane id rather than its renameable workspace label — see
 * index.ts). `session` is the herd session the snapshot was fetched for, stamped into each toast so
 * its tap lands in the right herd. The toasts go to the app's one <Toaster/> (routes/root.tsx), which
 * stacks them — under the header, never over it nor over the composer.
 */
export function useAgentTransitions(
  agents: AgentView[],
  openPaneId: string | null,
  copilotPaneId: string | null,
  session?: string,
): void {
  const prev = useRef<Map<string, AgentStatus> | null>(null);
  const navigate = useNavigate();
  const t = useT();

  useEffect(() => {
    const now = new Map(agents.map((a) => [a.paneId, a.status]));
    const before = prev.current;
    prev.current = now;
    if (!before) return;

    for (const a of agents) {
      const was = before.get(a.paneId);
      if (!was || was === a.status) continue;
      if (a.paneId === openPaneId) continue; // you're already looking at it
      if (a.paneId === copilotPaneId) continue; // the board's own agent, not a worker
      if (a.status !== "blocked" && a.status !== "done") continue;
      const n = describe(a, session);
      // One toast per pane (the id): a blocked→done flip replaces its own notice rather than stacking a second.
      (n.status === "blocked" ? toast.warning : toast.success)(n.title, {
        id: `agent:${n.paneId}`,
        description: n.detail,
        duration: TOAST_TTL_MS,
        action: {
          label: t("toast.open"),
          onClick: () => navigate(n.cardId ? cardPath(n.cardId) : panePath(n.paneId, n.session)),
        },
      });
    }
    // `t`/`navigate` are left out on purpose: a re-created one must not re-run the diff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, openPaneId, copilotPaneId, session]);
}
