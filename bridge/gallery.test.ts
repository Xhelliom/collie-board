import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  containedIn,
  galleryDocKindOf,
  handleGalleryRoute,
  isImagePath,
  listGalleryDocs,
  listImages,
  resolveGalleryFile,
  resolveImage,
  shortProject,
} from "./gallery.ts";

// The pure helpers stand on their own; everything that decides what is servable is exercised
// against a REAL directory tree, because the whole point of resolveImage is what the filesystem
// does with symlinks — a fake fs would only prove the code agrees with itself.

const PNG = Buffer.from("89504e470d0a1a0a", "hex"); // just enough bytes to be a file

let root: string;
let outside: string;
const scratch = (session: string) =>
  join(root, "-home-me-git-proj", session, "scratchpad");

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "collie-gallery-"));
  outside = await mkdtemp(join(tmpdir(), "collie-secret-"));
  await writeFile(join(outside, "secret.png"), PNG);

  await mkdir(join(scratch("s1"), "renders"), { recursive: true });
  await writeFile(join(scratch("s1"), "a.png"), PNG);
  await writeFile(join(scratch("s1"), "UPPER.PNG"), PNG);
  await writeFile(join(scratch("s1"), "notes.md"), "not an image");
  await writeFile(join(scratch("s1"), "page.html"), "<h1>preview</h1>");
  await writeFile(join(scratch("s1"), "data.json"), "{}");
  await writeFile(join(scratch("s1"), "renders", "deep.jpg"), PNG);
  // The escape attempt: an image-named symlink inside a scratchpad pointing out of the root.
  await symlink(join(outside, "secret.png"), join(scratch("s1"), "escape.png"));

  await mkdir(scratch("s2"), { recursive: true });
  await writeFile(join(scratch("s2"), "b.webp"), PNG);
  await writeFile(join(scratch("s2"), "memo.markdown"), "# memo");
  // A file outside any scratchpad — the glob must not pick it up.
  await writeFile(join(root, "-home-me-git-proj", "s2", "sibling.png"), PNG);
  await writeFile(join(root, "-home-me-git-proj", "s2", "sibling.md"), "# outside");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("isImagePath", () => {
  test("matches the served extensions regardless of case", () => {
    expect(isImagePath("/x/a.png")).toBe(true);
    expect(isImagePath("/x/a.JPEG")).toBe(true);
    expect(isImagePath("/x/a.webp")).toBe(true);
  });

  test("rejects SVG and non-images", () => {
    // SVG is deliberately excluded — it executes script on a top-level navigation to this origin.
    expect(isImagePath("/x/a.svg")).toBe(false);
    expect(isImagePath("/x/a.md")).toBe(false);
    expect(isImagePath("/x/png")).toBe(false);
  });

  test("documents live next to images — the image list still ignores them", async () => {
    const names = (await listImages(root)).map((i) => i.name);
    expect(names).not.toContain("notes.md");
    expect(names).not.toContain("page.html");
    expect(names).not.toContain("memo.markdown");
  });
});

describe("containedIn", () => {
  test("accepts the root and anything under it", () => {
    expect(containedIn("/tmp/claude-1", "/tmp/claude-1")).toBe(true);
    expect(containedIn("/tmp/claude-1", "/tmp/claude-1/p/s/scratchpad/a.png")).toBe(true);
  });

  test("rejects a sibling that merely shares the prefix", () => {
    // A bare startsWith would accept this one.
    expect(containedIn("/tmp/claude-1", "/tmp/claude-10/a.png")).toBe(false);
    expect(containedIn("/tmp/claude-1", "/etc/passwd")).toBe(false);
  });
});

describe("shortProject", () => {
  test("drops the mangled home prefix, which is identical on every entry", () => {
    expect(shortProject("-home-me-git-perso-collie-board", "/home/me")).toBe(
      "git-perso-collie-board",
    );
  });

  test("leaves a slug that isn't under home alone", () => {
    expect(shortProject("-var-www-site", "/home/me")).toBe("var-www-site");
  });
});

describe("listImages", () => {
  test("finds images in every scratchpad, at any depth", async () => {
    const names = (await listImages(root)).map((i) => i.name).sort();
    expect(names).toEqual(["UPPER.PNG", "a.png", "b.webp", "deep.jpg"]);
  });

  test("ignores non-images, files outside a scratchpad, and symlinks", async () => {
    const names = (await listImages(root)).map((i) => i.name);
    expect(names).not.toContain("notes.md");
    expect(names).not.toContain("sibling.png");
    // The walk doesn't follow links at all, so an escaping one never even reaches the listing —
    // the belt to resolveImage's braces below.
    expect(names).not.toContain("escape.png");
  });

  test("tags each image with its project and session", async () => {
    const a = (await listImages(root)).find((i) => i.name === "a.png");
    expect(a?.session).toBe("s1");
    expect(a?.project).toContain("git-proj");
  });

  test("a missing root is an empty list, not a throw", async () => {
    expect(await listImages(join(root, "does-not-exist"))).toEqual([]);
  });

  test("sorts newest first", async () => {
    const times = (await listImages(root)).map((i) => i.mtime);
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });
});

describe("galleryDocKindOf", () => {
  test("recognises the two servable document families, case-insensitively", () => {
    expect(galleryDocKindOf("/x/a.md")).toBe("markdown");
    expect(galleryDocKindOf("/x/a.MARKDOWN")).toBe("markdown");
    expect(galleryDocKindOf("/x/a.html")).toBe("html");
    expect(galleryDocKindOf("/x/a.HTM")).toBe("html");
  });

  test("rejects images, SVG and anything else", () => {
    expect(galleryDocKindOf("/x/a.png")).toBeNull();
    expect(galleryDocKindOf("/x/a.svg")).toBeNull();
    expect(galleryDocKindOf("/x/a.txt")).toBeNull();
    expect(galleryDocKindOf("/x/a.json")).toBeNull();
  });
});

describe("listGalleryDocs", () => {
  test("finds markdown and html in every scratchpad, at any depth", async () => {
    await mkdir(join(scratch("s1"), "renders", "nested"), { recursive: true });
    await writeFile(join(scratch("s1"), "renders", "nested", "deep.md"), "# deep");
    const names = (await listGalleryDocs(root)).map((d) => d.name).sort();
    expect(names).toEqual(["deep.md", "memo.markdown", "notes.md", "page.html"]);
  });

  test("ignores refused kinds and files outside a scratchpad", async () => {
    const names = (await listGalleryDocs(root)).map((d) => d.name);
    expect(names).not.toContain("data.json");
    expect(names).not.toContain("sibling.md");
    expect(names).not.toContain("a.png");
  });

  test("tags each doc with its project, session and kind", async () => {
    const page = (await listGalleryDocs(root)).find((d) => d.name === "page.html");
    expect(page?.session).toBe("s1");
    expect(page?.project).toContain("git-proj");
    expect(page?.kind).toBe("html");
    const memo = (await listGalleryDocs(root)).find((d) => d.name === "memo.markdown");
    expect(memo?.kind).toBe("markdown");
  });

  test("a missing root is an empty list, not a throw", async () => {
    expect(await listGalleryDocs(join(root, "does-not-exist"))).toEqual([]);
  });

  test("sorts newest first", async () => {
    const times = (await listGalleryDocs(root)).map((d) => d.mtime);
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });
});

describe("resolveGalleryFile", () => {
  test("resolves an image, a markdown and an html under the root, with kinds", async () => {
    expect(await resolveGalleryFile(join(scratch("s1"), "a.png"), root)).toMatchObject({
      kind: "image",
    });
    expect(await resolveGalleryFile(join(scratch("s1"), "notes.md"), root)).toMatchObject({
      kind: "markdown",
    });
    expect(await resolveGalleryFile(join(scratch("s1"), "page.html"), root)).toMatchObject({
      kind: "html",
    });
  });

  test("refuses an escape, an outside path and a refused kind", async () => {
    expect(await resolveGalleryFile(join(scratch("s1"), "escape.png"), root)).toBeNull();
    expect(await resolveGalleryFile(join(outside, "secret.png"), root)).toBeNull();
    expect(await resolveGalleryFile(join(scratch("s1"), "data.json"), root)).toBeNull();
    expect(await resolveGalleryFile(join(scratch("s1"), "ghost.md"), root)).toBeNull();
  });

  test("resolveImage stays image-only — a document is not an image", async () => {
    expect(await resolveImage(join(scratch("s1"), "a.png"), root)).toContain("a.png");
    expect(await resolveImage(join(scratch("s1"), "page.html"), root)).toBeNull();
  });

  test("refuses traversal written into the path", async () => {
    expect(await resolveGalleryFile(join(scratch("s1"), "..", "..", "..", "..", "x.png"), root)).toBeNull();
  });
});

describe("handleGalleryRoute", () => {
  const get = (url: string, headers?: Record<string, string>) =>
    handleGalleryRoute(new URL(url).pathname, new Request(url, { headers }), root);

  test("lists images as JSON", async () => {
    const res = await get("http://x/api/gallery");
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as { images: { name: string }[] };
    expect(body.images.length).toBe(4);
  });

  test("lists scratchpad documents alongside the images", async () => {
    const res = await get("http://x/api/gallery");
    const body = (await res!.json()) as { docs: { name: string; kind: string; session: string }[] };
    const names = body.docs.map((d) => d.name).sort();
    expect(names).toEqual(["deep.md", "memo.markdown", "notes.md", "page.html"]);
    expect(body.docs.find((d) => d.name === "page.html")).toMatchObject({
      kind: "html",
      session: "s1",
    });
  });

  test("serves an image with its content type", async () => {
    const p = encodeURIComponent(join(scratch("s1"), "a.png"));
    const res = await get(`http://x/api/gallery/file?p=${p}`);
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toBe("image/png");
    expect(res?.headers.get("etag")).toBeTruthy();
  });

  test("answers an unchanged image with a 304", async () => {
    const p = encodeURIComponent(join(scratch("s1"), "a.png"));
    const first = await get(`http://x/api/gallery/file?p=${p}`);
    const etag = first!.headers.get("etag")!;
    const second = await get(`http://x/api/gallery/file?p=${p}`, { "if-none-match": etag });
    expect(second?.status).toBe(304);
  });

  test("404s an escaping path rather than serving it", async () => {
    const p = encodeURIComponent(join(outside, "secret.png"));
    expect((await get(`http://x/api/gallery/file?p=${p}`))?.status).toBe(404);
  });

  test("serves markdown raw, as text", async () => {
    const p = encodeURIComponent(join(scratch("s2"), "memo.markdown"));
    const res = await get(`http://x/api/gallery/file?p=${p}`);
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await res!.text()).toContain("# memo");
  });

  test("serves html SCRUBBED and under a sandbox CSP", async () => {
    const page = join(scratch("s1"), "dirty.html");
    await writeFile(
      page,
      "<html><head><link rel='stylesheet' href='x.css'><script>alert(1)</script></head>" +
        "<body><button onclick='x()'>ok</button></body></html>",
    );
    const res = await get(`http://x/api/gallery/file?p=${encodeURIComponent(page)}`);
    expect(res?.status).toBe(200);
    expect(res?.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res?.headers.get("content-security-policy")).toBe("sandbox");
    const body = await res!.text();
    expect(body).toContain("ok");
    expect(body).not.toContain("<script");
    expect(body).not.toContain("onclick");
    expect(body).not.toContain("x.css");
  });

  test("404s a refused kind even inside a scratchpad", async () => {
    const p = encodeURIComponent(join(scratch("s1"), "data.json"));
    expect((await get(`http://x/api/gallery/file?p=${p}`))?.status).toBe(404);
  });

  test("400s a request with no path", async () => {
    expect((await get("http://x/api/gallery/file"))?.status).toBe(400);
  });

  test("returns null for a path it doesn't own, so the caller falls through", async () => {
    expect(await get("http://x/api/snapshot")).toBeNull();
  });

  test("returns null for a non-GET, so nothing here can mutate", async () => {
    const res = await handleGalleryRoute(
      "/api/gallery",
      new Request("http://x/api/gallery", { method: "POST" }),
      root,
    );
    expect(res).toBeNull();
  });
});
