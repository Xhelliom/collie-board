import { createContext, useContext, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { sendReply } from "@/lib/api";
import { boardApi, createTools, invalidArgs, oneLine, Refusal, type BoardTool, type Json } from "@/lib/board-tools";
import { cn } from "@/lib/utils";

// The orchestrator's ```collie-buttons block (ADR 0042): a JSON array of buttons whose LOOK is free
// (label, tone, size) and whose ACTION is a tool of the shared catalog (lib/board-tools.ts, the MCP
// server's own) — or `say`, which types into the orchestrator's pane. What a button does is shown
// from action+args, never from its label; the tap is the operator's, run by the browser over the
// tool's HTTP routes with the operator's rights.

/** The orchestrator's pane, set by its panel around an ASSISTANT turn only. Null anywhere else: the block stays code. */
export const ButtonsPaneContext = createContext<string | null>(null);
export const useButtonsPane = () => useContext(ButtonsPaneContext);

// Late-bound fetch, so a test's (or a polyfill's) fetch is the one used.
const TOOLS = new Map(createTools(boardApi((...a) => fetch(...a), "")).filter((t) => t.button !== false).map((t) => [t.name, t]));

/** The one action outside the catalog: types into the orchestrator's pane — never another agent's. */
const SAY = { props: { text: { type: "string" } }, required: ["text"] };

// Tones map onto the theme, never a raw colour.
const TONE: Record<string, { variant: "default" | "outline" | "destructive" | "secondary" | "ghost"; className?: string }> = {
  primary: { variant: "default" },
  neutral: { variant: "outline" },
  secondary: { variant: "secondary" },
  ghost: { variant: "ghost" },
  danger: { variant: "destructive" },
  success: { variant: "outline", className: "border-status-done text-status-done" },
  warning: { variant: "outline", className: "border-status-working text-status-working" },
};
const SIZE: Record<string, "sm" | "default" | "lg"> = { sm: "sm", md: "default", lg: "lg" };

interface Spec { label: string; tone?: string; size?: string; wide?: boolean; action: string; args?: Json }

/** The block's buttons, or null when it isn't a JSON array of objects — then it renders as the code it is. */
export function parseButtons(text: string): Spec[] | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(v) || v.length === 0 || !v.every((b) => b && typeof b === "object" && !Array.isArray(b))) return null;
  return v.map((b: Json) => ({ ...b, label: oneLine(b.label || b.action || "?", 60), action: String(b.action ?? "") }));
}

type Plan = { ok: true; preview: string; destructive: boolean; run: () => Promise<string> } | { ok: false; why: string };

function plan(spec: Spec, pane: string): Plan | Promise<Plan> {
  const args = spec.args ?? {};
  if (spec.action === "say") {
    const bad = invalidArgs(SAY, args);
    if (bad) return { ok: false, why: `Arguments invalides : ${bad}.` };
    return {
      ok: true, destructive: false, preview: `Répondre « ${oneLine(args.text, 60)} » à l'orchestrateur`,
      run: async () => {
        const res = await sendReply(pane, String(args.text));
        if (res.ok === false) throw new Error(res.error ?? "non envoyé");
        return "Envoyé à l'orchestrateur.";
      },
    };
  }
  const tool: BoardTool | undefined = TOOLS.get(spec.action);
  if (!tool) return { ok: false, why: `Action inconnue : ${oneLine(spec.action, 40)}.` };
  const bad = invalidArgs(tool, args);
  if (bad) return { ok: false, why: `Arguments invalides : ${bad}.` };
  const ready = (preview: string): Plan => ({ ok: true, preview, destructive: !!tool.destructive, run: () => tool.run(args) });
  if (!tool.preview) return ready(tool.description.split(/[.:]/)[0]!);
  return tool.preview(args).then(ready, (e) => ({ ok: false, why: e instanceof Refusal ? e.message : "Impossible de dire ce que ferait ce bouton." }));
}

function ActionButton({ spec, pane, spent, onRun }: { spec: Spec; pane: string; spent: boolean; onRun: (run: () => Promise<string>) => void }) {
  const t = useT();
  const [p, setP] = useState<Plan | null>(null);
  const [armed, setArmed] = useState(false);
  const key = JSON.stringify(spec);
  useEffect(() => {
    let live = true;
    void Promise.resolve(plan(spec, pane)).then((r) => live && setP(r));
    return () => { live = false; };
  }, [key, pane]); // eslint-disable-line react-hooks/exhaustive-deps
  const tone = TONE[spec.tone ?? ""] ?? TONE.neutral!;
  const off = spent || !p || !p.ok;
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", spec.wide && "w-full")}>
      <Button
        type="button"
        variant={armed ? "destructive" : tone.variant}
        size={SIZE[spec.size ?? ""] ?? "default"}
        disabled={off}
        className={cn(!armed && tone.className, spec.wide && "w-full")}
        onClick={() => {
          if (!p?.ok) return;
          // A destructive tool asks once more, in place (no browser dialog: it blocks the PWA).
          if (p.destructive && !armed) return setArmed(true);
          setArmed(false);
          onRun(p.run);
        }}
      >
        {armed ? t("pane.action.confirm", { label: spec.label }) : spec.label}
      </Button>
      <span className={cn("text-xs", p && !p.ok ? "text-destructive" : "text-muted-foreground")}>
        {!p ? "…" : p.ok ? p.preview : p.why}
        {armed && (
          <button type="button" className="ml-2 underline" onClick={() => setArmed(false)}>
            {t("pane.dialog.cancel")}
          </button>
        )}
      </span>
    </div>
  );
}

/** One block's buttons, several per row. After one tap the whole block is spent: it answered its question. */
export function ActionButtons({ buttons, pane }: { buttons: Spec[]; pane: string }) {
  const [state, setState] = useState<{ busy: boolean; ok?: boolean; text?: string } | null>(null);
  function onRun(run: () => Promise<string>) {
    setState({ busy: true });
    run().then(
      (text) => setState({ busy: false, ok: true, text: oneLine(text.split("\n")[0], 200) }),
      (e) => setState({ busy: false, ok: false, text: e instanceof Refusal ? e.message : `Erreur : ${oneLine(e?.message, 160)}` }),
    );
  }
  return (
    <div className="space-y-1.5" data-vaul-no-drag>
      <div className="flex flex-wrap items-start gap-2">
        {buttons.map((b, i) => (
          <ActionButton key={i} spec={b} pane={pane} spent={state !== null} onRun={onRun} />
        ))}
      </div>
      {state && (
        <p role="status" className={cn("text-sm", state.ok === false ? "text-destructive" : "text-muted-foreground")}>
          {state.busy ? "…" : state.text}
        </p>
      )}
    </div>
  );
}
