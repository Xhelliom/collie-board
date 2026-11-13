import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The Balise palette (index.css) holds every text pairing to WCAG AA, 4.5:1, in both themes. Read
// from the stylesheet itself, so a retuned token cannot slip under the floor unnoticed.

const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");

function tokens(selector: ":root" | ".dark"): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// [text, surface] — every surface a text token is actually painted on.
const SURFACES = ["background", "card", "muted"];
const ON_SURFACES = [
  "foreground",
  "text-secondary",
  "muted-foreground",
  "brand",
  "destructive",
  "status-blocked",
  "status-working",
  "status-done",
  "status-review",
  "status-idle",
  "status-info",
  "md-heading",
  "md-code",
  "diff-add",
  "diff-del",
];
const PAIRS: [string, string][] = [
  ...ON_SURFACES.flatMap((fg) => SURFACES.map((bg) => [fg, bg] as [string, string])),
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["brand-foreground", "brand"],
  ["destructive-foreground", "destructive"],
  ["status-chip-foreground", "status-blocked"],
  ["popover-foreground", "popover"],
  ...["agent", "lead", "copilot", "orchestrator", "board", "you"].map((a) => [`actor-${a}-fg`, `actor-${a}-bg`] as [string, string]),
];

describe.each([":root", ".dark"] as const)("Balise contrast, %s", (theme) => {
  // Light inherits nothing; dark overrides only what it redefines.
  const t = { ...tokens(":root"), ...(theme === ".dark" ? tokens(".dark") : {}) };

  it.each(PAIRS)("%s on %s ≥ 4.5:1", (fg, bg) => {
    expect(t[fg], fg).toMatch(/^#/);
    expect(t[bg], bg).toMatch(/^#/);
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["signal-blocked", "signal-working", "signal-stuck", "signal-review"])("%s, a graphic, ≥ 3:1 on the page", (sig) => {
    expect(contrast(t[sig]!, t.background!)).toBeGreaterThanOrEqual(3);
    expect(contrast(t[sig]!, t.card!)).toBeGreaterThanOrEqual(3);
  });

  // The light theme's text inks (brand, status-*) are the signal colours a step darker: 4.5:1 is the
  // floor and the operator's own light values sit at 3.4–4.3 as text.
  it("one colour per meaning: blue works, orange waits, green done, violet review, neutral brand", () => {
    const want =
      theme === ".dark"
        ? { "status-done": "#3ccf6e", "status-working": "#4fa3ff", "signal-working": "#4fa3ff", "signal-blocked": "#ff7a1a", "status-review": "#c3adff", "signal-review": "#c3adff", "status-info": "#5cc8e6", brand: "#e6f0ee" }
        : { "status-done": "#136f37", "status-working": "#1a5fb8", "signal-blocked": "#d85f00", "signal-working": "#1a5fb8", "status-review": "#5a3fd0", "signal-review": "#5a3fd0", brand: "#0b1a1c" };
    for (const [k, v] of Object.entries(want)) expect(t[k], k).toBe(v);
    expect(t.brand).toBe(t.foreground);
    expect(t["brand-foreground"]).toBe(t.background);
  });
});

it("contrast() is WCAG's formula", () => {
  expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
});
