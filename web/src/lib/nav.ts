// Route path helpers. Pane ids contain a colon (e.g. "wE:p2"), so they must be URL-encoded in the
// path; React Router decodes them back in useParams. The active session rides along as `?s=` so a
// navigation stays scoped to the session you're viewing (see lib/session.ts) — omitted on primary.
import { sessionSearch } from "./session";

export function panePath(paneId: string, session?: string): string {
  return `/pane/${encodeURIComponent(paneId)}${sessionSearch(session)}`;
}

/**
 * A pane's conversation history — the agent's own transcript, which is the only scrollback a Claude
 * pane can have (its terminal runs on the alternate screen and retains nothing). A child path of the
 * pane so "back" lands on the live mirror.
 */
export function historyPath(paneId: string, session?: string): string {
  return `/pane/${encodeURIComponent(paneId)}/history${sessionSearch(session)}`;
}

/**
 * A space's detail route (its tabs + panes). Deep-linkable; carries the session like panePath.
 * `tabId`, when given, seeds the route's own tab selection (redesign §9: a tab chip on the Spaces
 * overview goes straight to that tab instead of "All") — read once on landing, not kept in sync
 * with the URL afterward (routes/space.tsx), so it stays a starting point, not a persisted filter.
 */
export function spacePath(spaceId: string, session?: string, tabId?: string): string {
  const base = sessionSearch(session);
  if (!tabId) return `/space/${encodeURIComponent(spaceId)}${base}`;
  return `/space/${encodeURIComponent(spaceId)}${base}${base ? "&" : "?"}tab=${encodeURIComponent(tabId)}`;
}

/** The dashboard path, carrying the current session so "go home" doesn't drop you back to primary. */
export function homePath(session?: string): string {
  return `/${sessionSearch(session)}`;
}

/** The settings route, carrying the current session like the other path helpers. */
export function settingsPath(session?: string): string {
  return `/settings${sessionSearch(session)}`;
}

/** The Spaces root tab (every space as a card), carrying the current session. */
export function spacesPath(session?: string): string {
  return `/spaces${sessionSearch(session)}`;
}
