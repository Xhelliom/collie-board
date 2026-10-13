import { isReadOnly } from "@/lib/types";
import type { DeviceAuth } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NonNominalPanel } from "@/components/non-nominal-panel";
import { useT } from "@/i18n";

// Shown when the bridge enforces per-device auth and this device isn't on the allowlist: the UI
// drops to read-only (the backend rejects every terminal-driving action anyway). Renders nothing
// when the feature is off, the device is authorised, or the state isn't known yet — so it costs
// nothing on a normal single-user deployment. `device` comes from the snapshot (HomeData.device).
export function ReadOnlyBanner({
  device,
  className,
}: {
  device: DeviceAuth | undefined;
  className?: string;
}) {
  const t = useT();
  if (!isReadOnly(device)) return null;
  return (
    <NonNominalPanel
      tone="working"
      title={t("spaces.readOnly.title")}
      className={cn("mx-3 mt-2", className)}
    >
      {t("spaces.readOnly.body")}
      {device?.device ? ` (${device.device})` : ""}
    </NonNominalPanel>
  );
}
