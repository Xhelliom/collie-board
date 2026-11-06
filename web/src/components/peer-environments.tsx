import { Link } from "react-router";
import { Boxes, ChevronRight } from "lucide-react";

import { useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import { repoName, settingsPath } from "@/lib/board";
import type { PeersView } from "@/lib/peers";

// Settings → Peers → Environments: a summary only. A repo is offered, and its launch rights set, in
// that project's own settings (components/repo-offer.tsx) — it is a setting of the repo, not of the pairing.
export function PeerEnvironments({ environments, inbound }: { environments: PeersView["environments"]; inbound: PeersView["inbound"] }) {
  const t = useT();
  return (
    <Card className="gap-3 p-4" aria-label={t("peers.env.title")} role="region">
      <div className="flex items-start gap-3">
        <Boxes className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="font-medium">{t("peers.env.title")}</div>
          <p className="text-sm text-muted-foreground">{t("peers.env.summaryHint")}</p>
        </div>
      </div>
      {environments.length === 0 && <p className="text-sm text-muted-foreground">{t("peers.none")}</p>}
      <ul className="flex flex-col divide-y">
        {environments.map((env) => {
          // `launch` null: a hand-written peer, every environment (bridge/node.ts).
          const allowed = inbound.filter((p) => p.launch === null || p.launch.includes(env.name)).map((p) => p.name);
          return (
            <li key={env.name}>
              <Link
                to={settingsPath(env.repoPath)}
                aria-label={`${env.name} — ${t("peers.env.open")}`}
                className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-accent/50"
                data-testid={`env-${env.name}`}
              >
                <span className="min-w-0">
                  <span className="block font-medium">
                    {env.name} <span className="font-normal text-muted-foreground">· {repoName(env.repoPath)}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {allowed.length > 0 ? t("peers.env.allowed", { peers: allowed.join(", ") }) : t("peers.env.nobody")}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
