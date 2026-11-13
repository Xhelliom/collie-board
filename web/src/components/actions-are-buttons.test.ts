import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// « Une action est un bouton » (Sémaphore, 13/11): anything that does something or opens a view is a
// visible button — the system's secondary button, or a filled one for a panel's main action. A text
// link survives only as navigation inside a sentence, and then it is underlined in the text colour,
// never a coloured word. jsdom has no layout, so this reads the source: every <button>, <Link>, <a>
// and <summary> whose classes paint it in an accent colour must also paint it a surface.

const SRC = resolve(__dirname, "..");
const files = ["components", "routes"].flatMap((d) =>
  readdirSync(join(SRC, d))
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .map((f) => join(SRC, d, f)),
);

const COLOURED = /\btext-(brand|status-[a-z]+|md-[a-z]+|sky-\d+|blue-\d+)\b/;
const SURFACE = /\bbg-|buttonVariants|variant=/;

/** The classes of one opening tag: its literal className, plus any module constant it names. */
function classesOf(tag: string, src: string): string {
  const m = /className=(\{[\s\S]*?\}(?=\s*[a-zA-Z-]+=|\s*>|\s*\/>)|"[^"]*")/.exec(tag);
  if (!m) return "";
  let cls = m[1]!;
  for (const name of cls.match(/\b[A-Z_]{3,}|\b[a-z][a-zA-Z]+(?=[,)}`\s])/g) ?? []) {
    const def = new RegExp(`const ${name} = ([^;]+);`).exec(src);
    if (def) cls += " " + def[1];
  }
  return cls;
}

function offenders(): string[] {
  const out: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/<(button|Link|a|summary)\b/g)) {
      // The opening tag runs to the next element; good enough to find its className.
      const rest = src.slice(m.index! + 1, m.index! + 900);
      const end = rest.search(/<[A-Za-z/]/);
      const tag = rest.slice(0, end < 0 ? undefined : end);
      const cls = classesOf(tag, src);
      if (COLOURED.test(cls) && !SURFACE.test(cls)) {
        const line = src.slice(0, m.index).split("\n").length;
        out.push(`${file.slice(SRC.length + 1)}:${line}`);
      }
    }
  }
  return out;
}

describe("an action is a button", () => {
  it("no action is drawn as a bare coloured word", () => {
    expect(offenders()).toEqual([]);
  });

  it("catches one (the check is not vacuous)", () => {
    const tag = `button type="button" onClick={() => go()} className="text-xs font-semibold text-brand">`;
    expect(COLOURED.test(classesOf(tag, "")) && !SURFACE.test(classesOf(tag, ""))).toBe(true);
    const ok = `button type="button" className={cn(buttonVariants({ variant: "secondary" }), "text-brand")}>`;
    expect(SURFACE.test(classesOf(ok, ""))).toBe(true);
  });
});
