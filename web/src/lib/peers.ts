import { apiRequest } from "@/lib/api";

// The Peers settings screen's half of ADR 0049. Every call is the operator's own; no answer ever
// carries a token — the bridge keeps it, the screen only sees names, logins, dates and outcomes.

export type Invitation =
  | { state: "open"; code: string; expiresAt: number }
  | { state: "burned"; at: number; login: string | null }
  | { state: "used"; at: number; name: string };

export interface PeersView {
  name: string;
  invitation: Invitation | null;
  /** Who drives this machine (its node.toml). `launch` null: every environment (a hand-written peer). */
  inbound: { name: string; login: string | null; pairedAt: string | null; launch: string[] | null }[];
  /** Who this machine drives (its peers.toml). */
  outbound: { name: string; url: string; pairedAt: string }[];
  error: string | null;
}

export type TestResult =
  | { state: "ok"; node: string; environments: { name: string; agent: string }[] }
  | { state: "refused" }
  | { state: "closed" }
  | { state: "unreachable"; error: string };

const post = <T>(path: string, body?: unknown) =>
  apiRequest<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

export const fetchPeers = (signal?: AbortSignal) => apiRequest<PeersView>("/api/peers", { signal });
export const invitePeer = () => post<{ code: string; expiresAt: number }>("/api/peers/invite");
export const cancelInvite = () => apiRequest<{ ok: true }>("/api/peers/invite", { method: "DELETE" });
export const addPeer = (url: string, code: string) =>
  post<{ peer: { name: string; url: string }; test: TestResult }>("/api/peers/add", { url, code });
export const revokePeer = (name: string) => post<{ ok: true }>("/api/peers/revoke", { name });
export const forgetPeer = (name: string) => post<{ ok: true }>("/api/peers/forget", { name });
export const testPeer = (name: string) => post<{ test: TestResult }>("/api/peers/test", { name });

export const formatCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;
