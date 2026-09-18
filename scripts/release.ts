#!/usr/bin/env bun
// Cut a release from the fragments in `changes/` — ADR 0016.
//
// A branch never touches the version: it drops `changes/<slug>.md` instead, a file of its own that no
// other branch can conflict with. On `main`, CI runs this after a green build: it folds every
// fragment into one CHANGELOG entry, takes the biggest bump any of them asked for, aligns the three
// version files, and deletes the fragments. It prints the new version and does nothing else — the
// commit, the tag and the push are the workflow's (.github/workflows/release.yml).
//
// A fragment:
//
//     bump: minor
//
//     ### Added
//     - Écran « Open PRs » : vérifie à la demande si chaque PR ouverte merge encore
//
// Each bullet gets the short hash of the commit that added its fragment, the way the CHANGELOG has
// always cited its features — unless the line already ends with one.

import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export type Bump = "patch" | "minor" | "major";

export interface Fragment {
  name: string;
  bump: Bump;
  /** `### Added` → its bullets, in the order written. A bullet may span several lines. */
  sections: Map<string, string[]>;
}

const BUMPS: Bump[] = ["patch", "minor", "major"];
/** Keep a Changelog's order; any other heading follows, in the order first seen. */
const ORDER = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

/** Parse one fragment, or throw naming it — a malformed fragment must fail the release, loudly. */
export function parseFragment(name: string, text: string): Fragment {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const bump = /^bump:\s*(\w+)\s*$/.exec(lines[0] ?? "")?.[1] as Bump | undefined;
  if (!bump || !BUMPS.includes(bump)) throw new Error(`${name}: first line must be "bump: patch|minor|major"`);
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of lines.slice(1)) {
    const heading = /^###\s+(.+?)\s*$/.exec(line)?.[1];
    if (heading) {
      current = sections.get(heading) ?? [];
      sections.set(heading, current);
    } else if (line.startsWith("- ")) {
      if (!current) throw new Error(`${name}: a bullet before any "### Section" heading`);
      current.push(line);
    } else if (line.trim() && current?.length) {
      current[current.length - 1] += `\n${line}`;
    } else if (line.trim()) {
      throw new Error(`${name}: unexpected line "${line.trim()}"`);
    }
  }
  if (![...sections.values()].some((b) => b.length)) throw new Error(`${name}: no "- " line to release`);
  return { name, bump, sections };
}

export function nextVersion(current: string, bump: Bump): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) throw new Error(`not a version: ${current}`);
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === "major") return `${maj + 1}.0.0`;
  if (bump === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

/**
 * The version and the CHANGELOG entry the fragments add up to. Pure: `hashOf` names the commit that
 * brought a fragment in, null when git can't say (then the bullet goes out without one).
 */
export function planRelease(
  current: string,
  fragments: readonly Fragment[],
  date: string,
  hashOf: (fragment: string) => string | null,
): { version: string; entry: string } {
  const bump = fragments.reduce<Bump>((a, f) => (BUMPS.indexOf(f.bump) > BUMPS.indexOf(a) ? f.bump : a), "patch");
  const version = nextVersion(current, bump);
  const merged = new Map<string, string[]>();
  for (const f of fragments) {
    const hash = hashOf(f.name);
    for (const [heading, bullets] of f.sections) {
      const cited = bullets.map((b) => (hash && !/\([0-9a-f]{7,}\)\s*$/.test(b) ? `${b} (${hash})` : b));
      merged.set(heading, [...(merged.get(heading) ?? []), ...cited]);
    }
  }
  const headings = [...merged.keys()].sort((a, b) => {
    const [ia, ib] = [ORDER.indexOf(a), ORDER.indexOf(b)];
    return (ia === -1 ? ORDER.length : ia) - (ib === -1 ? ORDER.length : ib);
  });
  const body = headings
    .filter((h) => merged.get(h)!.length)
    .map((h) => `### ${h}\n\n${merged.get(h)!.join("\n")}`)
    .join("\n\n");
  return { version, entry: `## [${version}] - ${date}\n\n${body}\n` };
}

/** Put the entry above the newest `## [x.y.z]` heading — below the file's own preamble. */
export function insertEntry(changelog: string, entry: string): string {
  const at = changelog.search(/^## \[/m);
  return at === -1 ? `${changelog.trimEnd()}\n\n${entry}` : `${changelog.slice(0, at)}${entry}\n${changelog.slice(at)}`;
}

/** Replace the first `version` in a manifest — the same one `check-version.sh` reads. */
export function setVersion(text: string, version: string, kind: "toml" | "json"): string {
  const re = kind === "toml" ? /^(\s*version\s*=\s*")[^"]*(")/m : /("version"\s*:\s*")[^"]*(")/;
  if (!re.test(text)) throw new Error(`no version field to set (${kind})`);
  return text.replace(re, `$1${version}$2`);
}

async function main(root: string): Promise<void> {
  const dir = join(root, "changes");
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort();
  } catch {
    // No `changes/` at all: nothing to release.
  }
  if (!names.length) return;

  const fragments = await Promise.all(names.map(async (n) => parseFragment(n, await Bun.file(join(dir, n)).text())));
  const toml = join(root, "herdr-plugin.toml");
  const current = /^\s*version\s*=\s*"([^"]*)"/m.exec(await Bun.file(toml).text())?.[1];
  if (!current) throw new Error("herdr-plugin.toml has no version");

  const hashOf = (name: string): string | null => {
    const r = Bun.spawnSync(["git", "log", "--diff-filter=A", "--format=%h", "--abbrev=7", "-1", "--", `changes/${name}`], { cwd: root });
    return r.stdout.toString().trim() || null;
  };
  const { version, entry } = planRelease(current, fragments, new Date().toISOString().slice(0, 10), hashOf);

  const changelog = join(root, "CHANGELOG.md");
  await Bun.write(changelog, insertEntry(await Bun.file(changelog).text(), entry));
  await Bun.write(toml, setVersion(await Bun.file(toml).text(), version, "toml"));
  for (const pkg of ["package.json", "web/package.json"]) {
    const path = join(root, pkg);
    await Bun.write(path, setVersion(await Bun.file(path).text(), version, "json"));
  }
  for (const n of names) rmSync(join(dir, n));
  console.log(version);
}

if (import.meta.main) await main(join(import.meta.dir, ".."));
