// `!ls` from the chat: Claude Code runs a line in a shell, with no agent turn, only when the `!` is
// TYPED as the first key. Pasted — and every engine sends a reply as one paste or one write — it stays
// text and the agent answers it as a question (measured, Claude Code 2.1.332 under hc 0.1.21). So the
// prefix is typed on its own first (sendReplySteps), then the rest goes as before.
import { adapterFor, type AgentAdapter } from "./adapters.ts";
import type { EngineSnapshot } from "./state-engine.ts";

/** The prefix to type first and the rest to send, when `text` opens the shell mode of the agent in `paneId`; else null. */
export function shellSplit(
  snap: EngineSnapshot | undefined,
  adapters: Record<string, AgentAdapter>,
  paneId: string,
  text: string,
): { prefix: string; rest: string } | null {
  if (!snap || snap.bridge === "disconnected") return null;
  const agent = snap.agents.find((a) => a.paneId === paneId);
  // A typed key goes past hc's refusal of a blocked program: it could answer the dialog.
  if (!agent || agent.status === "blocked") return null;
  const prefix = adapterFor(adapters, agent.agent).shellPrefix;
  if (!prefix || !text.startsWith(prefix)) return null;
  const rest = text.slice(prefix.length);
  return rest.trim() ? { prefix, rest } : null;
}
