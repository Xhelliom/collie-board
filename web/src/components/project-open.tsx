import { useEffect, useId, useState, type ReactNode } from "react";
import { Bot, ChevronDown, Ellipsis, SquareTerminal } from "lucide-react";

import { AgentKindPicker } from "@/components/agent-kind-picker";
import { OpenedNote } from "@/components/pane-place";
import { TemplatePicker } from "@/components/template-picker";
import { Button } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import { useSpaceActions } from "@/hooks/use-spaces";
import { useT } from "@/i18n";
import type { OpenInRepo } from "@/lib/api";
import { fetchLaunchEngine, repoName } from "@/lib/board";
import type { CreatedPane, OpenedPlace } from "@/lib/types";
import { cn } from "@/lib/utils";

// An agent or a terminal in the repo's folder, outside any card: hc has no Spaces tab to open one
// from (ADR 0052), so the gesture lives where the project is. The same gesture under herdr 0.9.
// « New agent » stays a button; the terminal and the page's rarer gestures (`actions`) sit under « Actions ».
export function ProjectOpen({ repo, actions }: { repo: string; actions?: ReactNode }) {
  const t = useT();
  const { openInRepo, enter } = useSpaceActions();
  const [sheet, setSheet] = useState(false);
  const [termSheet, setTermSheet] = useState(false);
  const [space, setSpace] = useState("");
  // Where a launch goes now: herdr 0.9 has no herdr-app space to pick (null = not read yet).
  const [launch, setLaunch] = useState<{ engine: "hc" | "herdr09"; fallback: boolean } | null>(null);
  const [opened, setOpened] = useState<(OpenedPlace & { pane: CreatedPane }) | null>(null);
  const spaceId = useId();
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agentKind, setAgentKind] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);

  useEffect(() => {
    if (!termSheet) return;
    let live = true;
    fetchLaunchEngine().then(
      (r) => live && setLaunch(r),
      () => live && setLaunch(null),
    );
    return () => {
      live = false;
    };
  }, [termSheet]);

  const run = async (opts: OpenInRepo) => {
    setBusy(true);
    try {
      const res = await openInRepo(repo, opts);
      if (res) setOpened(res);
    } finally {
      setBusy(false);
      setSheet(false);
      setTermSheet(false);
    }
  };
  const on09 = launch?.engine === "herdr09";

  return (
    <div className="relative flex items-center gap-2">
      {/* On a phone « New agent » joins the menu: the project's name beside it needs the room. */}
      <Button variant="outline" size="sm" disabled={busy} onClick={() => setSheet(true)} className="max-sm:hidden">
        <Bot className="size-4" />
        {t("project.open.agent")}
      </Button>
      {/* Same hand-rolled menu as the orchestrator's: an absolute list over a click-outside layer. */}
      <span className="relative">
        <Button
          variant="outline"
          size="sm"
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu((v) => !v)}
          onKeyDown={(e) => e.key === "Escape" && setMenu(false)}
          aria-label={t("project.actions")}
        >
          {/* « ⋯ » on a phone: the project's name beside it needs the room. */}
          <Ellipsis className="size-4 sm:hidden" />
          <span className="hidden sm:inline">{t("project.actions")}</span>
          <ChevronDown className={cn("hidden size-3.5 transition-transform sm:block", menu && "rotate-180")} />
        </Button>
        {menu && (
          <>
            <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMenu(false)} />
            <div role="menu" className="absolute right-0 top-full z-50 mt-1 flex w-72 max-w-[calc(100vw-2rem)] flex-col items-stretch gap-1 rounded-xl border bg-card p-1.5 text-sm shadow-(--shadow-3)">
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setMenu(false);
                  setSheet(true);
                }}
                className="flex h-10 items-center gap-2.5 rounded-lg px-3 text-left font-medium hover:bg-muted/60 sm:hidden"
              >
                <Bot className="size-4 text-muted-foreground" />
                {t("project.open.agent")}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setMenu(false);
                  setTermSheet(true);
                }}
                className="flex h-10 items-center gap-2.5 rounded-lg px-3 text-left font-medium hover:bg-muted/60"
              >
                <SquareTerminal className="size-4 text-muted-foreground" />
                {t("project.open.terminal")}
              </button>
              {actions}
            </div>
          </>
        )}
      </span>
      <BottomSheet
        open={termSheet}
        onClose={() => setTermSheet(false)}
        title={t("project.open.terminalSheet", { repo: repoName(repo) })}
        footer={
          <Button className="w-full" disabled={busy} onClick={() => void run({ open: "terminal", ...(!on09 && space.trim() ? { space: space.trim() } : {}) })}>
            {t(busy ? "project.open.opening" : "project.open.openTerminal")}
          </Button>
        }
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={spaceId} className={cn("text-sm font-medium", on09 && "text-muted-foreground")}>
            {t("project.open.space")}
          </label>
          <input
            id={spaceId}
            value={space}
            onChange={(e) => setSpace(e.target.value)}
            disabled={on09}
            maxLength={40}
            placeholder="Collie Board"
            aria-describedby={`${spaceId}-hint`}
            className="h-10 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p id={`${spaceId}-hint`} className={cn("text-xs", launch?.fallback ? "text-status-blocked" : "text-muted-foreground")}>
            {t(!on09 ? "project.open.spaceHint" : launch?.fallback ? "project.open.spaceFallback" : "project.open.spaceOff")}
          </p>
        </div>
      </BottomSheet>
      {/* Anchored under the header's actions, like the menu, but it stays until dismissed: not a toast that leaves. */}
      {opened && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg bg-card shadow-(--shadow-3)">
          <OpenedNote
          opened={opened}
          onDismiss={() => setOpened(null)}
          onEnter={() => {
            setOpened(null);
            enter(opened.pane);
          }}
          />
        </div>
      )}
      <BottomSheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={t("project.open.sheet", { repo: repoName(repo) })}
        footer={
          <Button className="w-full" disabled={busy} onClick={() => void run({ open: "agent", agentKind, templateId })}>
            {t(busy ? "project.open.starting" : "project.open.start")}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <AgentKindPicker value={agentKind} onChange={setAgentKind} />
          <TemplatePicker value={templateId} onChange={setTemplateId} />
        </div>
      </BottomSheet>
    </div>
  );
}
