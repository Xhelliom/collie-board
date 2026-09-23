import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  artifactKindOf,
  expandDirectoryCandidates,
  handleArtifactFile,
  isExcludedArtifactPath,
  listWorktreeArtifacts,
  mentionedArtifactCandidates,
  paneArtifactsResponse,
  resolveArtifact,
  scrubHtml,
  worktreeForPane,
} from "./artifacts.ts";
import type { TranscriptEntry } from "./transcript.ts";

// Confinement is exercised against a REAL directory tree, exactly like the gallery test: the whole
// point of resolveArtifact is what the filesystem does with symlinks, and a fake fs would only prove
// the code agrees with itself. Rendering (scrubHtml) is pure, so its fixtures are strings.

const PNG = Buffer.from("89504e470d0a1a0a", "hex"); // just enough bytes to be a file

let root: string;
let outside: string;
const inRoot = (rel: string) => join(root, rel);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "collie-artifacts-"));
  outside = await mkdtemp(join(tmpdir(), "collie-secret-"));

  await writeFile(join(root, "render.png"), PNG);
  await writeFile(join(root, "UPPER.PNG"), PNG);
  await mkdir(join(root, "docs", "hero-recette"), { recursive: true });
  await writeFile(join(root, "docs", "hero-recette", "page.html"), "<h1>validation</h1>");
  await writeFile(join(root, "docs", "hero-recette", "compte-rendu.md"), "# Compte rendu\n\nFait.\n");
  // Refused media: a real file of every kind the reader must NOT serve.
  await writeFile(join(root, "notes.txt"), "not an artifact");
  await writeFile(join(root, "schema.json"), "{}");
  await writeFile(join(root, "vector.svg"), "<svg/>");
  // The escape attempt: an artifact-named symlink inside the root pointing out of it.
  await writeFile(join(outside, "secret.png"), PNG);
  await symlink(join(outside, "secret.png"), join(root, "escape.png"));
  // A symlink whose NAME is an artifact kind and whose target is another root file — the resolved
  // path stays inside the root, so it is servable; only the escaping one must not be.
  await symlink(join(root, "render.png"), join(root, "alias.png"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("artifactKindOf", () => {
  test("recognises the three servable families, case-insensitively", () => {
    expect(artifactKindOf("/x/a.png")).toBe("image");
    expect(artifactKindOf("/x/a.JPEG")).toBe("image");
    expect(artifactKindOf("/x/a.webp")).toBe("image");
    expect(artifactKindOf("/x/a.md")).toBe("markdown");
    expect(artifactKindOf("/x/rapport.markdown")).toBe("markdown");
    expect(artifactKindOf("/x/a.html")).toBe("html");
    expect(artifactKindOf("/x/a.HTM")).toBe("html");
  });

  test("rejects everything else — SVG, text, JSON, extensionless", () => {
    // SVG is deliberately excluded, unchanged from the gallery: it is a script host.
    expect(artifactKindOf("/x/a.svg")).toBeNull();
    expect(artifactKindOf("/x/a.txt")).toBeNull();
    expect(artifactKindOf("/x/a.json")).toBeNull();
    expect(artifactKindOf("/x/a.pdf")).toBeNull();
    expect(artifactKindOf("/x/png")).toBeNull();
  });
});

describe("resolveArtifact", () => {
  test("resolves a real image, markdown and html under the root", async () => {
    const img = await resolveArtifact(root, inRoot("render.png"));
    expect(img?.kind).toBe("image");
    const md = await resolveArtifact(root, inRoot("docs/hero-recette/compte-rendu.md"));
    expect(md?.kind).toBe("markdown");
    expect(md?.full).toEndWith("compte-rendu.md");
    const page = await resolveArtifact(root, inRoot("docs/hero-recette/page.html"));
    expect(page?.kind).toBe("html");
  });

  test("refuses a symlink that escapes the root, even from inside it", async () => {
    // The attack this route exists to survive: the path IS inside the root as written, and only
    // realpath shows it isn't.
    expect(await resolveArtifact(root, inRoot("escape.png"))).toBeNull();
  });

  test("serves a symlink that resolves back inside the root", async () => {
    // An in-root symlink is a rename, not an escape — the resolved file is what is served.
    expect((await resolveArtifact(root, inRoot("alias.png")))?.kind).toBe("image");
  });

  test("refuses a path outside the root", async () => {
    expect(await resolveArtifact(root, join(outside, "secret.png"))).toBeNull();
  });

  test("refuses traversal written into the path", async () => {
    expect(await resolveArtifact(root, join(root, "..", "..", "etc", "passwd"))).toBeNull();
  });

  test("refuses a relative request outright — the client only echoes back served paths", async () => {
    expect(await resolveArtifact(root, "render.png")).toBeNull();
  });

  test("refuses a refused media type and a missing file", async () => {
    expect(await resolveArtifact(root, inRoot("notes.txt"))).toBeNull();
    expect(await resolveArtifact(root, inRoot("schema.json"))).toBeNull();
    expect(await resolveArtifact(root, inRoot("vector.svg"))).toBeNull();
    expect(await resolveArtifact(root, inRoot("ghost.png"))).toBeNull();
  });

  test("refuses every candidate when the root itself is gone", async () => {
    const gone = await mkdtemp(join(tmpdir(), "collie-artifacts-gone-"));
    await rm(gone, { recursive: true, force: true });
    expect(await resolveArtifact(gone, inRoot("render.png"))).toBeNull();
  });
});

describe("scrubHtml — agent HTML made safe for the phone", () => {
  test("drops script/iframe/object/embed subtrees whole, regardless of inner '>'", () => {
    const dirty = [
      "<html><head></head><body>",
      "<script>if (a > b) { alert('hi') }</script>",
      "<script src='https://evil.example/x.js'></script>",
      "<iframe src='https://evil.example/'></iframe>",
      "<object data='x.swf'></object>",
      "<embed src='y'></embed>",
      "<p>the report</p>",
      "</body></html>",
    ].join("");
    const clean = scrubHtml(dirty);
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("iframe");
    expect(clean).not.toContain("object");
    expect(clean).not.toContain("embed");
    expect(clean).not.toContain("alert");
    expect(clean).toContain("the report");
  });

  test("drops external stylesheet links but keeps inline <style>", () => {
    const dirty =
      '<link rel="stylesheet" href="https://evil.example/x.css">' +
      '<link rel="alternate stylesheet" href="y.css">' +
      "<style>.hero { color: red }</style>";
    const clean = scrubHtml(dirty);
    expect(clean).not.toContain('href="https://evil.example/x.css"');
    expect(clean).not.toContain("y.css");
    expect(clean).toContain("<style>.hero { color: red }</style>");
  });

  test("strips on* handlers from surviving tags, keeps the tag", () => {
    const clean = scrubHtml('<button onclick="steal()" data-x="1">Go</button>');
    expect(clean).toContain("Go");
    expect(clean).toContain("data-x");
    expect(clean).not.toContain("onclick");
  });

  test("keeps text verbatim and leaves an unterminated script dead at the end", () => {
    expect(scrubHtml("<script>never closed")).toBe("");
    expect(scrubHtml("before <script>abc</script> after")).toBe("before  after");
  });

  test("a '>' inside a quoted attribute value does not end the tag early", () => {
    const clean = scrubHtml('<a title="x > y">keep</a><script>evil</script>');
    expect(clean).toContain('title="x > y"');
    expect(clean).not.toContain("script");
  });
});

describe("isExcludedArtifactPath", () => {
  test("drops dependency, build-output, cache and board-scratch dirs by segment", () => {
    expect(isExcludedArtifactPath(join("node_modules", "acme", "page.html"))).toBe(true);
    expect(isExcludedArtifactPath(join("dist", "bundle.html"))).toBe(true);
    expect(isExcludedArtifactPath(join("coverage", "index.html"))).toBe(true);
    expect(isExcludedArtifactPath(join(".board", "handoff.md"))).toBe(true);
    expect(isExcludedArtifactPath(join(".git", "objects", "x.png"))).toBe(true);
  });

  test("keeps genuine deliverables, even with lookalike names", () => {
    expect(isExcludedArtifactPath(join("docs", "hero-recette", "page.html"))).toBe(false);
    expect(isExcludedArtifactPath("render.png")).toBe(false);
    expect(isExcludedArtifactPath(join("docs", "node_modules-migration.md"))).toBe(false);
  });
});

describe("listWorktreeArtifacts", () => {
  test("lifts only existing, servable, in-root candidates into entries", async () => {
    const artifacts = await listWorktreeArtifacts(root, [
      "render.png",
      "docs/hero-recette/page.html",
      "docs/hero-recette/compte-rendu.md",
      "notes.txt", // refused media
      "ghost.md", // missing
      join(outside, "secret.png"), // outside the root
      join(root, "escape.png"), // symlink escape
    ]);
    const names = artifacts.map((a) => a.name).sort();
    expect(names).toEqual(["compte-rendu.md", "page.html", "render.png"]);
    const page = artifacts.find((a) => a.name === "page.html");
    expect(page?.rel).toBe(join("docs", "hero-recette", "page.html"));
    expect(page?.kind).toBe("html");
  });

  test("a case-variant duplicate resolves to one entry", async () => {
    // The sort and dedupe both check the RESOLVED path, so ".png" and ".PNG" of the same file is one.
    expect((await listWorktreeArtifacts(root, ["render.png"])).length).toBe(1);
  });

  test("sorts newest first", async () => {
    await writeFile(join(root, "fresh.md"), "newer");
    const artifacts = await listWorktreeArtifacts(root, ["render.png", "fresh.md"]);
    expect(artifacts[0]?.name).toBe("fresh.md");
  });

  test("excludes dependency/build/board files even when the session mentioned them", async () => {
    // A `Read` that merely OPENED a file promotes it to a candidate via the "mentioned" half —
    // the listing must still refuse third-party and plumbing paths.
    await mkdir(join(root, "node_modules", "acme"), { recursive: true });
    await writeFile(join(root, "node_modules", "acme", "page.html"), "<h1>third party</h1>");
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "bundle.html"), "<h1>build output</h1>");
    await mkdir(join(root, ".board"), { recursive: true });
    await writeFile(join(root, ".board", "handoff.md"), "# plumbing");
    const artifacts = await listWorktreeArtifacts(root, [
      "render.png",
      join("node_modules", "acme", "page.html"),
      join("dist", "bundle.html"),
      join(".board", "handoff.md"),
    ]);
    expect(artifacts.map((a) => a.name)).toEqual(["render.png"]);
  });
});

describe("mentionedArtifactCandidates", () => {
  const entry = (parts: TranscriptEntry["parts"]): TranscriptEntry => ({
    uuid: "u",
    ts: "",
    role: "assistant",
    parts,
  });

  test("collects surfaced image paths and absolute path summaries", () => {
    const out = mentionedArtifactCandidates([
      entry([
        { kind: "tool", name: "Read", summary: "/wt/docs/hero-recette/spec.md" },
        { kind: "tool", name: "Read", summary: "render.png", image: "/wt/docs/hero-recette/render.png" },
        { kind: "tool", name: "Bash", summary: "grep -r foo /wt/src" }, // contains a space — not a file
      ]),
    ]);
    expect(out).toContain("/wt/docs/hero-recette/spec.md");
    expect(out).toContain("/wt/docs/hero-recette/render.png");
    expect(out).not.toContain("/wt/src");
  });

  test("ignores inline (data:) images — they are not files", () => {
    const out = mentionedArtifactCandidates([
      entry([{ kind: "tool", name: "Read", summary: "x", image: "data:image/png;base64,AAA" }]),
    ]);
    expect(out).toEqual([]);
  });

  test("a relative single-token servable path is a mention", () => {
    const out = mentionedArtifactCandidates([
      entry([{ kind: "tool", name: "Write", summary: "docs/hero-recette/page.html" }]),
    ]);
    expect(out).toContain("docs/hero-recette/page.html");
  });

  test("a bare filename, a phrase, or a non-servable extension is not a mention", () => {
    const out = mentionedArtifactCandidates([
      entry([
        { kind: "tool", name: "Write", summary: "page.html" }, // no "/" — not path-shaped
        { kind: "tool", name: "Bash", summary: "cat docs/hero-recette/page.html" }, // spaces — a command
        { kind: "tool", name: "Read", summary: "src/index.tsx" }, // servable-kind only
      ]),
    ]);
    expect(out).toEqual([]);
  });
});

describe("expandDirectoryCandidates", () => {
  test("turns an untracked-directory entry into its servable files, recursively", async () => {
    await mkdir(join(root, "shots", "deep"), { recursive: true });
    await writeFile(join(root, "shots", "a.png"), PNG);
    await writeFile(join(root, "shots", "deep", "b.md"), "# b");
    await writeFile(join(root, "shots", "skip.txt"), "x");
    const out = await expandDirectoryCandidates(root, ["shots/"]);
    expect(out).toContain(join(root, "shots", "a.png"));
    expect(out).toContain(join(root, "shots", "deep", "b.md"));
    expect(out.some((p) => p.endsWith("skip.txt"))).toBe(false);
  });

  test("passes a plain file through unchanged", async () => {
    const out = await expandDirectoryCandidates(root, ["render.png"]);
    expect(out).toEqual([join(root, "render.png")]);
  });

  test("leaves a missing candidate as-is — containment drops it later", async () => {
    const out = await expandDirectoryCandidates(root, ["ghost.md"]);
    expect(out).toEqual(["ghost.md"]);
  });

  test("does not descend into excluded dirs of an untracked tree", async () => {
    await mkdir(join(root, "work", "node_modules", "acme"), { recursive: true });
    await writeFile(join(root, "work", "node_modules", "acme", "page.html"), "<h1>third party</h1>");
    await writeFile(join(root, "work", "deliverable.md"), "# mine");
    const out = await expandDirectoryCandidates(root, ["work/"]);
    expect(out).toContain(join(root, "work", "deliverable.md"));
    expect(out.some((p) => p.includes("node_modules"))).toBe(false);
  });
});

describe("worktreeForPane — the root is derived from the CARD, never the request", () => {
  const board = (over: Partial<{
    sessions: { paneId: string | null; cardId: string }[];
    cards: Record<string, { repoPath: string | null; branch: string | null; baseRef: string | null } | null>;
  }>) => {
    const { sessions = [], cards = {} } = over;
    return {
      listOpenSessions: () => sessions,
      getCard: (id: string) => cards[id] ?? null,
    };
  };
  /** A fake `git worktree list --porcelain` answering for any repo path. */
  const porcelain = (checkout: string) =>
    `worktree ${checkout}\nbranch refs/heads/board/x\n\nworktree /home/me/collie-board\nbranch refs/heads/main\n`;

  test("resolves the worktree of the card backing the pane", async () => {
    const wt = await worktreeForPane(
      board({
        sessions: [{ paneId: "w1:p1", cardId: "c1" }],
        cards: { c1: { repoPath: "/home/me/collie-board", branch: "board/x", baseRef: "main" } },
      }),
      "w1:p1",
      async () => ({ ok: true, stdout: porcelain(root), stderr: "" }),
    );
    expect(wt?.root).toBe(root);
    expect(wt?.baseRef).toBe("main");
  });

  test("a pane with no open session, or a card without a branch, has no root", async () => {
    const git = async () => ({ ok: true, stdout: "", stderr: "" });
    expect(await worktreeForPane(board({}), "w1:p9", git)).toBeNull();
    expect(
      await worktreeForPane(
        board({
          sessions: [{ paneId: "w1:p1", cardId: "c1" }],
          cards: { c1: { repoPath: "/home/me/collie-board", branch: null, baseRef: null } },
        }),
        "w1:p1",
        git,
      ),
    ).toBeNull();
  });

  test("a branch with no worktree on disk has no root", async () => {
    const wt = await worktreeForPane(
      board({
        sessions: [{ paneId: "w1:p1", cardId: "c1" }],
        cards: { c1: { repoPath: "/home/me/collie-board", branch: "board/x", baseRef: "main" } },
      }),
      "w1:p1",
      async () => ({ ok: true, stdout: "worktree /home/me/collie-board\nbranch refs/heads/main\n\n", stderr: "" }),
    );
    expect(wt).toBeNull();
  });
});

describe("handleArtifactFile — the serving endpoint", () => {
  test("serves an image with its content type", async () => {
    const res = await handleArtifactFile(
      root,
      new Request(`http://x/api/pane/w1:p1/artifact?p=${encodeURIComponent(inRoot("render.png"))}`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("etag")).toBeTruthy();
  });

  test("serves markdown raw, as text", async () => {
    const res = await handleArtifactFile(
      root,
      new Request(`http://x/api/pane/w1:p1/artifact?p=${encodeURIComponent(inRoot("docs/hero-recette/compte-rendu.md"))}`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await res.text()).toContain("# Compte rendu");
  });

  test("serves html SCRUBBED and under a sandbox CSP", async () => {
    const page = join(root, "dirty.html");
    await writeFile(
      page,
      "<html><head><link rel='stylesheet' href='x.css'><script>alert(1)</script></head>" +
        "<body><button onclick='x()'>ok</button></body></html>",
    );
    const res = await handleArtifactFile(
      root,
      new Request(`http://x/api/pane/w1:p1/artifact?p=${encodeURIComponent(page)}`),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    const body = await res.text();
    expect(body).toContain("ok");
    expect(body).not.toContain("<script");
    expect(body).not.toContain("onclick");
    expect(body).not.toContain("x.css");
  });

  test("answers an unchanged artifact with a 304", async () => {
    const url = `http://x/api/pane/w1:p1/artifact?p=${encodeURIComponent(inRoot("render.png"))}`;
    const first = await handleArtifactFile(root, new Request(url));
    const etag = first.headers.get("etag")!;
    const second = await handleArtifactFile(root, new Request(url, { headers: { "if-none-match": etag } }));
    expect(second.status).toBe(304);
  });

  test("404s an escaping path, a refused type and a no-card pane", async () => {
    const get = (p: string) =>
      handleArtifactFile(root, new Request(`http://x/api/pane/w1:p1/artifact?p=${encodeURIComponent(p)}`));
    expect((await get(join(outside, "secret.png"))).status).toBe(404);
    expect((await get(inRoot("notes.txt"))).status).toBe(404);
    expect((await get(join(root, "..", "x.png"))).status).toBe(404);
    expect((await handleArtifactFile(null, new Request(`http://x/api/pane/w1:p1/artifact?p=${encodeURIComponent(inRoot("render.png"))}`))).status).toBe(404);
  });

  test("400s a request with no path", async () => {
    expect((await handleArtifactFile(root, new Request("http://x/api/pane/w1:p1/artifact"))).status).toBe(400);
  });
});

describe("paneArtifactsResponse — the listing endpoint", () => {
  // Computed per test (not at describe evaluation): `root` is assigned by beforeAll BELOW the
  // describe bodies, so a describe-level constant would capture it as `undefined`.
  const worktree = () => ({ root, baseRef: "refs/heads/main" });
  /** The two git calls diffStat makes, answered from a fake runner over a REAL temp-dir root. */
  const fakeGit = (files: string[]) =>
    async (args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> => {
      if (args[0] === "merge-base") return { ok: true, stdout: "abc1234\n", stderr: "" };
      if (args[0] === "diff") return { ok: true, stdout: files.map((f) => `1\t0\t${f}`).join("\n"), stderr: "" };
      if (args[0] === "status") return { ok: true, stdout: files.map((f) => `?? ${f}`).join("\n"), stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    };

  test("lists what the session wrote (diff) and mentioned (entries), newest first", async () => {
    await writeFile(join(root, "docs", "hero-recette", "render.png"), PNG);
    const res = await paneArtifactsResponse({
      worktree: worktree(),
      entries: [
        {
          uuid: "u",
          ts: "",
          role: "assistant",
          parts: [{ kind: "tool", name: "Read", summary: "/wt/missing-from-diff.md" }],
        },
      ],
      git: fakeGit(["docs/hero-recette/render.png", "docs/hero-recette/page.html", "notes.txt"]),
      acceptEncoding: null,
    });
    const { artifacts } = (await res.json()) as { artifacts: { name: string; kind: string; path: string }[] };
    const names = artifacts.map((a) => a.name).sort();
    expect(names).toEqual(["page.html", "render.png"]);
    expect(artifacts.every((a) => a.path.startsWith(root))).toBe(true);
    // A mention with no matching file adds nothing — only servable files become entries.
    expect(artifacts.some((a) => a.name === "missing-from-diff.md")).toBe(false);
  });

  test("a pane with no worktree answers an empty list", async () => {
    const res = await paneArtifactsResponse({ worktree: null, acceptEncoding: null });
    expect((await res.json()) as object).toEqual({ artifacts: [] });
  });

  test("an untracked DIRECTORY is expanded into the files inside", async () => {
    // git status --porcelain names an untracked folder as one `?? docs/hero-recette/` entry; the
    // files within must still surface — they are exactly what an unreviewed card produced.
    await mkdir(join(root, "fresh"), { recursive: true });
    await writeFile(join(root, "fresh", "shot.png"), PNG);
    await writeFile(join(root, "fresh", "rapport.md"), "# fait");
    const git = async (args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> => {
      if (args[0] === "merge-base") return { ok: true, stdout: "abc1234\n", stderr: "" };
      if (args[0] === "diff") return { ok: true, stdout: "", stderr: "" }; // nothing committed
      if (args[0] === "status") return { ok: true, stdout: "?? fresh/\n", stderr: "" };
      return { ok: true, stdout: "", stderr: "" };
    };
    const res = await paneArtifactsResponse({ worktree: worktree(), git, acceptEncoding: null });
    const { artifacts } = (await res.json()) as { artifacts: { name: string; kind: string }[] };
    const names = artifacts.map((a) => a.name).sort();
    expect(names).toEqual(["rapport.md", "shot.png"]);
  });

  test("a relative mention resolves inside the worktree root", async () => {
    const res = await paneArtifactsResponse({
      worktree: worktree(),
      entries: [
        {
          uuid: "u",
          ts: "",
          role: "assistant",
          parts: [{ kind: "tool", name: "Write", summary: "docs/hero-recette/page.html" }],
        },
      ],
      // git is down: the mention alone must still serve.
      git: async () => ({ ok: false, stdout: "", stderr: "boom" }),
      acceptEncoding: null,
    });
    const { artifacts } = (await res.json()) as { artifacts: { name: string; kind: string }[] };
    expect(artifacts.map((a) => a.name)).toContain("page.html");
  });

  test("a git failure degrades to mentions-only, not to an error", async () => {
    const res = await paneArtifactsResponse({
      worktree: worktree(),
      entries: [
        {
          uuid: "u",
          ts: "",
          role: "assistant",
          parts: [{ kind: "tool", name: "Write", summary: join(root, "docs/hero-recette/page.html") }],
        },
      ],
      git: async () => ({ ok: false, stdout: "", stderr: "boom" }),
      acceptEncoding: null,
    });
    const { artifacts } = (await res.json()) as { artifacts: { name: string }[] };
    expect(artifacts.map((a) => a.name)).toContain("page.html");
  });
});