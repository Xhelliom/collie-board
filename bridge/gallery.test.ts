import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  containedIn,
  handleGalleryRoute,
  isImagePath,
  listImages,
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
  await writeFile(join(scratch("s1"), "renders", "deep.jpg"), PNG);
  // The escape attempt: an image-named symlink inside a scratchpad pointing out of the root.
  await symlink(join(outside, "secret.png"), join(scratch("s1"), "escape.png"));

  await mkdir(scratch("s2"), { recursive: true });
  await writeFile(join(scratch("s2"), "b.webp"), PNG);
  // A file outside any scratchpad — the glob must not pick it up.
  await writeFile(join(root, "-home-me-git-proj", "s2", "sibling.png"), PNG);
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

describe("resolveImage", () => {
  test("resolves a real image under the root", async () => {
    expect(await resolveImage(join(scratch("s1"), "a.png"), root)).toContain("a.png");
  });

  test("refuses a symlink that escapes the root, even from inside a scratchpad", async () => {
    // The attack this route exists to survive: the path IS under the root as written, and only
    // realpath shows it isn't.
    expect(await resolveImage(join(scratch("s1"), "escape.png"), root)).toBeNull();
  });

  test("refuses a path outside the root", async () => {
    expect(await resolveImage(join(outside, "secret.png"), root)).toBeNull();
  });

  test("refuses traversal written into the path", async () => {
    expect(await resolveImage(join(scratch("s1"), "..", "..", "..", "..", "x.png"), root)).toBeNull();
  });

  test("refuses a non-image extension and a missing file", async () => {
    expect(await resolveImage(join(scratch("s1"), "notes.md"), root)).toBeNull();
    expect(await resolveImage(join(scratch("s1"), "ghost.png"), root)).toBeNull();
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
