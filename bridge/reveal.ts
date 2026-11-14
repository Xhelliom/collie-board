// ── « AFFICHER » ON A MASKED SECRET ──────────────────────────────────────────
// The mirror masks secrets (redact.ts) and that stays the default: the read route never carries one.
// This is the one way back, on the operator's tap: the phone names a mask by the row it sees, the
// bridge reads the pane again and answers that one secret. An action, so the device gate applies
// (server.ts treats every pane action as a write), and audited — without the value.

import type { AuditLog } from "./audit.ts";
import type { Mux } from "./mux/mux.ts";
import { revealAt } from "./redact.ts";

const MAX_LINE = 4096;
const MAX_LINES = 2000;

const isCount = (v: unknown, max: number): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;

export async function revealPane(
  herdr: Mux,
  paneId: string,
  req: Request,
  audit: AuditLog,
  device: string | null,
  session: string,
  defaultLines: number,
): Promise<Response> {
  let body: { line?: unknown; fromEnd?: unknown; col?: unknown; lines?: unknown; unwrapped?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response("bad body", { status: 400 });
  }
  const { line, fromEnd, col, lines, unwrapped } = body;
  if (typeof line !== "string" || line.length > MAX_LINE || !isCount(fromEnd, MAX_LINES) || !isCount(col, MAX_LINE) || !isCount(lines, MAX_LINES)) {
    return new Response("bad body", { status: 400 });
  }
  let value: string | null;
  try {
    const read = await herdr.readPane(paneId, unwrapped === true ? "recent_unwrapped" : "recent", lines || defaultLines, "ansi");
    value = revealAt(read.text, line, fromEnd, col);
  } catch (err) {
    return new Response(`herdr read failed: ${(err as Error).message}`, { status: 502 });
  }
  audit.record({ action: "pane.reveal", paneId, session, device, detail: { found: value !== null } });
  if (value === null) return new Response("no longer on screen", { status: 404 });
  return new Response(JSON.stringify({ value }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
