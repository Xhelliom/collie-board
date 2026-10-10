import { Languages } from "lucide-react";

import { Card } from "@/components/ui/card";
import { setPreference, usePreference, useT, type Preference } from "@/i18n";

// Settings: the language of the board, projects and cards (ADR 0024). "Automatic" follows the browser.
// Names stay in their own language ("Français" is never "French") so the one who cannot read the
// current language can still find their own.
const OPTIONS: { value: Preference; label: string | null }[] = [
  { value: "auto", label: null },
  { value: "fr", label: "Français" },
  { value: "en", label: "English" },
];

export function LanguageControl() {
  const t = useT();
  const pref = usePreference();
  return (
    <Card className="gap-0 py-0">
      <label className="flex items-start gap-3 p-4">
        <Languages className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-semibold">{t("language.label")}</span>
          <span className="text-xs text-muted-foreground">{t("language.hint")}</span>
        </span>
        <select
          aria-label={t("language.label")}
          value={pref}
          onChange={(e) => setPreference(e.target.value as Preference)}
          className="h-10 shrink-0 rounded-lg border border-border bg-background px-2 text-sm"
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label ?? t("language.auto")}
            </option>
          ))}
        </select>
      </label>
    </Card>
  );
}
