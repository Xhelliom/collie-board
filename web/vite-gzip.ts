import type { Plugin } from "vite";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

// Precompress the text assets of the output dir: `x.js` gets an `x.js.gz` beside it, which the bridge
// serves to a client that accepts gzip (bridge/precompressed.ts). Done at build time, once, at level 9
// — never per request. Runs last in `closeBundle`, after every other plugin (the PWA's sw.js included) has
// written its files, and into whatever outDir the build used (dist or dist-staging alike).
const COMPRESSIBLE = new Set([".js", ".css", ".html", ".svg", ".json", ".webmanifest"]);

export function gzipPlugin(): Plugin {
  let outDir = "";
  return {
    name: "collie-gzip",
    apply: "build",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle: {
      order: "post", // after vite-plugin-pwa writes sw.js
      sequential: true,
      handler() {
        for (const rel of readdirSync(outDir, { recursive: true }) as string[]) {
          if (!COMPRESSIBLE.has(extname(rel))) continue;
          const full = join(outDir, rel);
          writeFileSync(`${full}.gz`, gzipSync(readFileSync(full), { level: 9 }));
        }
      },
    },
  };
}
