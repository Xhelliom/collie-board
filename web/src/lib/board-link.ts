// A link to one of Collie Board's own screens, recognised in agent prose so the reading view can
// show what it points at instead of a bare underlined URL. Pure; the origin is ignored on purpose —
// the orchestrator writes its configured origin, which may not be the one this tab was opened from,
// and the card is always resolved against THIS bridge and opened in-app.

export type BoardLink = { kind: "card" | "pane"; id: string; path: string };

export function parseBoardLink(href: string): BoardLink | null {
  let path: string;
  try {
    const u = new URL(href, "http://x");
    path = u.pathname;
  } catch {
    return null;
  }
  const m = /^\/(card|pane)\/([^/]+)\/?$/.exec(path);
  if (!m) return null;
  try {
    return { kind: m[1] as "card" | "pane", id: decodeURIComponent(m[2]!), path: `/${m[1]}/${m[2]}` };
  } catch {
    return null;
  }
}
