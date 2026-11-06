import { describe, expect, it } from "bun:test";

import { foldUpstream, insertEntry, nextVersion, parseFragment, planRelease, setVersion } from "./release.ts";

// The release is cut by CI with nobody watching, so what it must never do is guess: a malformed
// fragment fails it, and everything it writes is derived from the fragments and nothing else.

const frag = (name: string, text: string) => parseFragment(name, text);

describe("parseFragment", () => {
  it("reads the bump and the bullets under their heading, continuation lines included", () => {
    const f = frag("a.md", "bump: minor\n\n### Added\n- one\n  still one\n- two\n");
    expect(f.bump).toBe("minor");
    expect(f.sections.get("Added")).toEqual(["- one\n  still one", "- two"]);
  });

  it("refuses a fragment it cannot read, naming it", () => {
    expect(() => frag("a.md", "### Added\n- x")).toThrow("a.md");
    expect(() => frag("b.md", "bump: huge\n\n### Added\n- x")).toThrow("b.md");
    expect(() => frag("c.md", "bump: patch\n\n- orphan")).toThrow("c.md");
    expect(() => frag("d.md", "bump: patch\n\n### Fixed\n")).toThrow("d.md");
  });
});

describe("planRelease", () => {
  const a = frag("a.md", "bump: patch\n\n### Fixed\n- a fix");
  const b = frag("b.md", "bump: minor\n\n### Added\n- a feature\n\n### Fixed\n- b fix (1234567)");

  it("takes the biggest bump any fragment asked for", () => {
    expect(planRelease("0.145.0", [a], "2026-09-18", () => null).version).toBe("0.145.1");
    expect(planRelease("0.145.0", [a, b], "2026-09-18", () => null).version).toBe("0.146.0");
  });

  it("folds every fragment into one entry, Added before Fixed, each bullet citing its commit once", () => {
    const { entry } = planRelease("0.145.0", [a, b], "2026-09-18", (n) => (n === "a.md" ? "aaaaaaa" : "bbbbbbb"));
    expect(entry).toBe(
      "## [0.146.0] - 2026-09-18\n\n### Added\n\n- a feature (bbbbbbb)\n\n### Fixed\n\n- a fix (aaaaaaa)\n- b fix (1234567)\n",
    );
  });
});

describe("the files it writes", () => {
  it("puts the entry above the newest release, under the preamble", () => {
    const out = insertEntry("# Changelog\n\nintro\n\n## [0.1.0] - x\n\n- old\n", "## [0.2.0] - y\n\n- new\n");
    expect(out).toBe("# Changelog\n\nintro\n\n## [0.2.0] - y\n\n- new\n\n## [0.1.0] - x\n\n- old\n");
  });

  it("sets the one version check-version.sh reads, in both manifest shapes", () => {
    expect(setVersion('id = "x"\nversion = "0.1.0"\n', "0.2.0", "toml")).toBe('id = "x"\nversion = "0.2.0"\n');
    expect(setVersion('{\n  "name": "x",\n  "version": "0.1.0"\n}', "0.2.0", "json")).toContain('"version": "0.2.0"');
  });

  it("refuses a version it cannot parse rather than inventing one", () => {
    expect(() => nextVersion("1.2", "patch")).toThrow();
  });
});

describe("### Upstream", () => {
  const md = "# U\n\n| File | Change |\n|---|---|\n| `bridge/server.ts` | one import |\n| `bridge/config.ts` | a block |\n\nRebasing.\n";

  it("stays out of the CHANGELOG, and a malformed line fails the release", () => {
    const f = frag("a.md", "bump: patch\n\n### Fixed\n- a fix\n\n### Upstream\n- `bridge/server.ts`: one route");
    expect(planRelease("1.0.0", [f], "2026-11-06", () => null).entry).not.toContain("one route");
    expect(() => frag("b.md", "bump: patch\n\n### Fixed\n- x\n\n### Upstream\n- server.ts one route")).toThrow("b.md");
    expect(() => frag("c.md", "bump: patch\n\n### Upstream\n- `a.ts`: x")).toThrow("c.md");
  });

  it("appends to the row of the same file, else adds a row at the table's end", () => {
    const out = foldUpstream(md, [
      { file: "`bridge/server.ts`", change: "one route" },
      { file: "`bridge/index.ts`", change: "one hook" },
    ]);
    expect(out).toBe(
      "# U\n\n| File | Change |\n|---|---|\n| `bridge/server.ts` | one import ; one route |\n| `bridge/config.ts` | a block |\n| `bridge/index.ts` | one hook |\n\nRebasing.\n",
    );
  });
});
