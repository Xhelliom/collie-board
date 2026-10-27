import { useEffect, useState } from "react";
import { ExternalLink, Server } from "lucide-react";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cachedPeers, cachedPeerTest, type PeersView, type TestResult } from "@/lib/peers";

// The header's machine switcher (decision 77740d3b §1): this machine's name, and a menu of it plus
// the peers it drives (peers.toml), each with a reachable dot. Picking a peer OPENS that Collie at its
// own address — its UI is never proxied through this bridge. Reachability is « Tester la connexion »
// (#185) run on opening the menu, through a short cache: no loop. Nothing renders without a peer.
export function MachineSwitcher() {
  const t = useT();
  const [view, setView] = useState<PeersView | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    cachedPeers()
      .then((v) => live && setView(v))
      .catch(() => {}); // no switcher is the honest fallback: the header must not fail over it
    return () => {
      live = false;
    };
  }, []);

  if (!view || view.outbound.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("machines.label", { name: view.name })}
        className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground active:bg-muted"
      >
        <Server className="size-[18px]" />
        <span className="hidden max-w-32 truncate text-sm sm:inline">{view.name}</span>
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={t("machines.title")}>
        {open && <MachineList view={view} />}
      </BottomSheet>
    </>
  );
}

/** Mounted only while the menu is open, so the tests run on opening and not before. */
function MachineList({ view }: { view: PeersView }) {
  const t = useT();
  const [tests, setTests] = useState<Record<string, TestResult | "failed">>({});
  // An installed PWA has no tabs: a new window there leaves the app, so it navigates in place.
  const standalone = useMediaQuery("(display-mode: standalone)");
  useEffect(() => {
    let live = true;
    for (const p of view.outbound)
      cachedPeerTest(p.name)
        .then((r) => live && setTests((s) => ({ ...s, [p.name]: r })))
        .catch(() => live && setTests((s) => ({ ...s, [p.name]: "failed" })));
    return () => {
      live = false;
    };
  }, [view]);

  return (
    <ul className="flex flex-col gap-1 py-2">
      <li className="flex items-center gap-3 rounded-[10px] bg-brand/16 px-3 py-3">
        <Dot state="up" />
        <span className="min-w-0 flex-1 truncate font-semibold text-brand">{view.name}</span>
        <span className="text-xs text-muted-foreground">{t("machines.this")}</span>
      </li>
      {view.outbound.map((p) => {
        const r = tests[p.name];
        const state = r === undefined ? "pending" : r !== "failed" && r.state === "ok" ? "up" : "down";
        return (
          <li key={p.name}>
            <a
              href={p.url}
              {...(standalone ? {} : { target: "_blank", rel: "noopener noreferrer" })}
              className="flex items-center gap-3 rounded-[10px] px-3 py-3 transition-colors hover:bg-muted/60 active:bg-muted"
            >
              <Dot state={state} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{p.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t(`machines.${state}`)} · {p.url}
                </span>
              </span>
              <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function Dot({ state }: { state: "up" | "down" | "pending" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2.5 shrink-0 rounded-full",
        state === "up" ? "bg-status-done" : state === "down" ? "bg-status-blocked" : "animate-pulse bg-muted-foreground/40",
      )}
    />
  );
}
