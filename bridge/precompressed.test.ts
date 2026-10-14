import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { precompressed } from "./precompressed.ts";

const dir = mkdtempSync(join(tmpdir(), "precompressed-"));
const js = join(dir, "a.js");
writeFileSync(js, "x".repeat(1000));
writeFileSync(`${js}.gz`, gzipSync("x".repeat(1000)));
const png = join(dir, "a.png");
writeFileSync(png, "png");

test("gzip accepted and a .gz beside the file: the .gz, with its encoding", async () => {
  const r = await precompressed(js, Bun.file(js), "gzip, deflate, br");
  expect(r.file.name).toBe(`${js}.gz`);
  expect(r.headers).toEqual({ "content-encoding": "gzip", vary: "accept-encoding" });
});

test("no Accept-Encoding: the raw file, still marked Vary", async () => {
  const r = await precompressed(js, Bun.file(js), null);
  expect(r.file.name).toBe(js);
  expect(r.headers).toEqual({ vary: "accept-encoding" });
});

test("no .gz beside the file: the raw file, no header", async () => {
  const r = await precompressed(png, Bun.file(png), "gzip");
  expect(r.file.name).toBe(png);
  expect(r.headers).toEqual({});
});
