import type { ReactNode } from "react";
import { Plug } from "lucide-react";

import { t, useT } from "@/i18n";
import { Card } from "@/components/ui/card";
import type { BridgeStatus, DeviceAuth } from "@/lib/types";

// A small read-only diagnostics panel for Settings: where this client is connected, whether it's a
// secure context (PWA/push need one), the live bridge status, and — when per-device auth is on —
// this device's access level. Reads browser globals (location / isSecureContext); the bridge +
// device come from the polled snapshot (HomeData). Nothing here is configurable; it's for "why
// isn't X working" triage.
export function ConnectionInfo({
  bridge,
  device,
  build,
}: {
  bridge: BridgeStatus | undefined;
  device: DeviceAuth | undefined;
  /** Build id the bridge reports it's serving (from /api/config); omitted while loading/offline. */
  build?: string;
}) {
  const t = useT();
  const b = bridgeLabel(bridge);
  const d = deviceLabel(device);
  const secure = typeof window !== "undefined" && window.isSecureContext;
  const host = typeof window !== "undefined" ? window.location.host : "—";

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center gap-3 p-4 pb-3">
        <Plug className="size-5 shrink-0 text-muted-foreground" />
        <div>
          <div className="font-medium">{t("settings.conn.title")}</div>
          <p className="text-sm text-muted-foreground">{t("settings.conn.hint")}</p>
        </div>
      </div>
      <dl className="divide-y divide-border/60 border-t border-border/60">
        <Row label={t("settings.conn.endpoint")}>{host}</Row>
        <Row label={t("settings.conn.secure")}>{secure ? t("settings.conn.yes") : t("settings.conn.no")}</Row>
        <Row label={t("settings.conn.bridge")}>
          <span className={b.tone}>{b.text}</span>
        </Row>
        <Row label={t("settings.conn.device")}>
          <span className={d.tone}>{d.text}</span>
        </Row>
        {build && <Row label={t("settings.conn.build")}>{build}</Row>}
      </dl>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-sm">{children}</dd>
    </div>
  );
}

function bridgeLabel(bridge: BridgeStatus | undefined): { text: string; tone: string } {
  if (bridge === "connected") return { text: t("settings.conn.connected"), tone: "text-status-done" };
  if (bridge === "disconnected") return { text: t("settings.conn.offline"), tone: "text-status-working" };
  return { text: t("settings.conn.connecting"), tone: "text-muted-foreground" };
}

// Mirrors the deviceAuth matrix on the bridge (see bridge/server.ts). "Local" = an authorised request
// with no device header, i.e. the on-host loopback operator.
function deviceLabel(device: DeviceAuth | undefined): { text: string; tone: string } {
  if (!device || !device.enforced) return { text: t("settings.conn.notEnforced"), tone: "text-muted-foreground" };
  if (device.authorized) {
    return {
      text: device.device ? t("settings.conn.full", { device: device.device }) : t("settings.conn.fullLocal"),
      tone: "text-status-done",
    };
  }
  return {
    text: device.device ? t("settings.conn.ro", { device: device.device }) : t("settings.conn.roBare"),
    tone: "text-status-working",
  };
}
