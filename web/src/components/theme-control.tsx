import { Monitor, Moon, Palette, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useThemeMode } from "@/hooks/use-theme-mode";
import type { ThemeMode } from "@/lib/theme";

const OPTIONS: ReadonlyArray<{ mode: ThemeMode; label: string; icon: typeof Sun }> = [
  { mode: "light", label: "Light", icon: Sun },
  { mode: "dark", label: "Dark", icon: Moon },
  { mode: "system", label: "System", icon: Monitor },
];

export function ThemeControl() {
  const { mode, setMode } = useThemeMode();

  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <Palette className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="font-medium">Appearance</div>
            <p className="text-sm text-muted-foreground">Light, dark, or follow your device.</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border/60 p-3">
        {OPTIONS.map(({ mode: m, label, icon: Icon }) => (
          <Button
            key={m}
            variant={mode === m ? "secondary" : "outline"}
            size="sm"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
          >
            <Icon className="size-4" />
            {label}
          </Button>
        ))}
      </div>
    </Card>
  );
}
