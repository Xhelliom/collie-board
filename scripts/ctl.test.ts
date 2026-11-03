import { afterEach, describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bridgeUrl,
  checkVersions,
  collieVersion,
  dnsNameFromStatus,
  main,
  parseEnv,
  PLUGIN_ID,
  resolveConfigDir,
  statusBanner,
  taskXml,
  tasklistImage,
  waitForPort,
} from "./ctl.ts";

// ctl.ts is the argv every Herdr action runs on every platform (ADR 0050). On Linux/macOS it must be
// a transparent hand-off to collie-board-ctl.sh; on Windows it must say the same things the shell
// script says. Both halves are pinned here, on whatever platform the suite runs on.

const ROOT = join(import.meta.dir, "..");
const tmps: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "collie-ctl-"));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("parseEnv", () => {
  it("reads what `set -a; . .env` reads from the simple lines a plugin .env holds", () => {
    const env = parseEnv(
      [
        "# a comment",
        "",
        "COLLIE_BOARD_TRUSTED_USER=me@example.com",
        "export COLLIE_BOARD_PORT=8790",
        'COLLIE_BOARD_PUBLIC_HOSTS="host.tail.ts.net"',
        "SINGLE='a b'",
        "INLINE=value # trailing comment",
        "HASH_IN_VALUE=a#b",
        "not a pair",
        "CRLF=yes\r",
      ].join("\n"),
    );
    expect(env).toEqual({
      COLLIE_BOARD_TRUSTED_USER: "me@example.com",
      COLLIE_BOARD_PORT: "8790",
      COLLIE_BOARD_PUBLIC_HOSTS: "host.tail.ts.net",
      SINGLE: "a b",
      INLINE: "value",
      HASH_IN_VALUE: "a#b",
      CRLF: "yes",
    });
  });
});

describe("resolveConfigDir", () => {
  const base = {
    env: {} as Record<string, string | undefined>,
    home: "/home/me",
    platform: "linux" as NodeJS.Platform,
    herdrConfigDir: () => undefined as string | undefined,
    exists: () => false,
  };

  it("takes the dir Herdr injects before anything else", () => {
    expect(
      resolveConfigDir({ ...base, env: { HERDR_PLUGIN_CONFIG_DIR: "/injected" }, herdrConfigDir: () => "/cli" }),
    ).toBe("/injected");
  });

  it("then asks Herdr's CLI, trimming its newline", () => {
    expect(resolveConfigDir({ ...base, herdrConfigDir: () => "/cli\n" })).toBe("/cli");
  });

  it("then Herdr's conventional dir, only if it holds a .env — %APPDATA% on Windows", () => {
    const unix = join("/home/me", ".config", "herdr", "plugins", "config", PLUGIN_ID);
    expect(resolveConfigDir({ ...base, exists: (p) => p === join(unix, ".env") })).toBe(unix);
    const win = join("C:/Users/me/AppData/Roaming", "herdr", "plugins", "config", PLUGIN_ID);
    expect(
      resolveConfigDir({
        ...base,
        platform: "win32",
        env: { APPDATA: "C:/Users/me/AppData/Roaming" },
        exists: (p) => p === join(win, ".env"),
      }),
    ).toBe(win);
  });

  it("falls back to ~/.config/collie-board, like the shell script", () => {
    expect(resolveConfigDir(base)).toBe(join("/home/me", ".config", "collie-board"));
  });
});

describe("the tailnet URL", () => {
  it("reads Self.DNSName without its trailing dot, and nothing from garbage", () => {
    expect(dnsNameFromStatus(JSON.stringify({ Self: { DNSName: "box.tail1.ts.net." } }))).toBe("box.tail1.ts.net");
    expect(dnsNameFromStatus("not json")).toBe("");
    expect(dnsNameFromStatus("{}")).toBe("");
  });

  it("has the three shapes of bridge_url", () => {
    expect(bridgeUrl("box.ts.net", "https", 8788)).toBe("https://box.ts.net");
    expect(bridgeUrl("box.ts.net", "http", 8790)).toBe("http://box.ts.net:8790");
    expect(bridgeUrl("", "https", 8788)).toBe("http://127.0.0.1:8788 (Tailscale name unavailable)");
  });
});

/** A checkout with just the files the version readers look at. */
function fakeRoot(v: { toml?: string; pkg?: string; web?: string; log?: string; buildInfo?: string }) {
  const root = tmp();
  mkdirSync(join(root, "web", "dist"), { recursive: true });
  if (v.toml) writeFileSync(join(root, "herdr-plugin.toml"), `id = "x"\nversion = "${v.toml}"\n`);
  if (v.pkg) writeFileSync(join(root, "package.json"), JSON.stringify({ name: "a", version: v.pkg }));
  if (v.web) writeFileSync(join(root, "web", "package.json"), JSON.stringify({ name: "b", version: v.web }));
  if (v.log) writeFileSync(join(root, "CHANGELOG.md"), `# Changelog\n\n## [${v.log}] — 2026-11-03\n\n## [0.0.1]\n`);
  if (v.buildInfo) writeFileSync(join(root, "web", "dist", "build-info.json"), v.buildInfo);
  return root;
}

describe("collieVersion", () => {
  it("is the built bundle's stamp, sha included", () => {
    const root = fakeRoot({ toml: "1.0.0", buildInfo: JSON.stringify({ version: "1.2.3", sha: "abc1234" }) });
    expect(collieVersion(root)).toBe("1.2.3+abc1234");
  });

  it("falls back to the manifest, saying the web isn't built, then to unknown", () => {
    expect(collieVersion(fakeRoot({ toml: "1.0.0" }))).toBe("1.0.0 (manifest; web not built)");
    expect(collieVersion(fakeRoot({}))).toBe("unknown");
  });

  // Same fixture through both implementations, where bash exists: the two must never disagree.
  it.skipIf(!Bun.which("bash"))("says exactly what collie-board-ctl.sh version says", () => {
    for (const v of [{ toml: "2.0.0", buildInfo: JSON.stringify({ version: "2.0.1", sha: "f00" }) }, { toml: "2.0.0" }]) {
      const root = fakeRoot(v);
      mkdirSync(join(root, "scripts"));
      cpSync(join(ROOT, "scripts", "collie-board-ctl.sh"), join(root, "scripts", "collie-board-ctl.sh"));
      const sh = Bun.spawnSync(["bash", join(root, "scripts", "collie-board-ctl.sh"), "version"], {
        env: { ...process.env, HERDR_PLUGIN_CONFIG_DIR: tmp(), PATH: process.env.PATH ?? "" },
      });
      expect(sh.stdout.toString().trim()).toBe(collieVersion(root));
    }
  });
});

describe("checkVersions", () => {
  it("passes when the three files and the newest CHANGELOG heading agree", () => {
    const r = checkVersions(fakeRoot({ toml: "1.4.0", pkg: "1.4.0", web: "1.4.0", log: "1.4.0" }));
    expect(r.ok).toBe(true);
    expect(r.lines[0]).toContain("1.4.0 consistent");
  });

  it("fails on any one of them, naming what each says", () => {
    const r = checkVersions(fakeRoot({ toml: "1.4.0", pkg: "1.4.0", web: "1.3.9", log: "1.4.0" }));
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toContain("web/package.json   1.3.9");
    expect(checkVersions(fakeRoot({ pkg: "1.0.0" })).ok).toBe(false);
  });

  it("agrees with the real checkout, as check-version.sh does in CI", () => {
    expect(checkVersions(ROOT).ok).toBe(true);
  });
});

describe("taskXml — the Windows supervision", () => {
  const xml = taskXml({
    userId: "DELL\\steph",
    bun: "C:\\Users\\steph\\.bun\\bin\\bun.exe",
    root: "C:\\Users\\steph & co\\collie-board",
    socket: "C:\\Users\\steph\\AppData\\Roaming\\herdr\\sessions\\b\\herdr.sock",
  });

  it("runs at THIS user's logon, in their session, never elevated (ADR 0046 §7)", () => {
    expect(xml).toMatch(/<LogonTrigger>\s*<Enabled>true<\/Enabled>\s*<UserId>DELL\\steph<\/UserId>/);
    expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    // Session 0 ("whether the user is logged on or not") and elevation are exactly what must not appear.
    expect(xml).not.toMatch(/Password|S4U|ServiceAccount|HighestAvailable|BootTrigger/);
  });

  it("is never killed for running long, and never starts twice", () => {
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(xml).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
    expect(xml).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
  });

  it("runs the supervisor headless, with the socket start was invoked against", () => {
    expect(xml).toContain("<Command>conhost.exe</Command>");
    const args = /<Arguments>(.*)<\/Arguments>/.exec(xml)?.[1] ?? "";
    expect(args).toStartWith("--headless C:\\Users\\steph\\.bun\\bin\\bun.exe ");
    expect(args).toContain("_run");
    expect(args).toContain("--socket=C:\\Users\\steph\\AppData\\Roaming\\herdr\\sessions\\b\\herdr.sock");
  });

  it("quotes a path with spaces and escapes XML", () => {
    expect(xml).toContain("&quot;C:\\Users\\steph &amp; co\\collie-board");
    expect(xml).toContain("<WorkingDirectory>C:\\Users\\steph &amp; co\\collie-board</WorkingDirectory>");
    expect(xml).not.toMatch(/ & /);
  });

  it("leaves the socket out when start wasn't given one — the bridge then uses its own default", () => {
    expect(taskXml({ userId: "u", bun: "b", root: "r" })).not.toContain("--socket");
  });
});

describe("statusBanner", () => {
  const b = { ready: true, version: "1.0.0+abc", service: "svc", port: 8788, env: {}, tailnetUrl: "https://box" };

  it("says the same lines as print_status_banner", () => {
    expect(statusBanner(b)).toEqual([
      "",
      "  ✓ Collie is running  ·  v1.0.0+abc",
      "    service   svc",
      "    local     http://127.0.0.1:8788",
      "    tailnet   https://box",
      "",
    ]);
  });

  it("warns when nothing answers, and shows the proxy instead of the tailnet when serve is skipped", () => {
    expect(statusBanner({ ...b, ready: false })[1]).toContain("isn't answering on :8788");
    expect(statusBanner({ ...b, env: { COLLIE_BOARD_SKIP_SERVE: "1", COLLIE_BOARD_PUBLIC_URL: "https://p" } })[4]).toBe(
      "    proxy     https://p",
    );
  });
});

describe("tasklistImage", () => {
  it("reads the image of the matched row, and nothing from the no-match INFO line", () => {
    expect(tasklistImage('"bun.exe","4242","Console","2","120 000 K"\r\n')).toBe("bun.exe");
    expect(tasklistImage("INFO: No tasks are running which match the specified criteria.\r\n")).toBeUndefined();
  });
});

describe("waitForPort", () => {
  it("is true once something listens, false when nothing does", async () => {
    const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    try {
      expect(await waitForPort(server.port, 1000)).toBe(true);
    } finally {
      server.stop(true);
    }
    expect(await waitForPort(server.port, 300)).toBe(false);
  });
});

describe("main — the routing", () => {
  const deps = (platform: NodeJS.Platform) => {
    const calls: { delegated?: string[]; windows?: [string, string[]]; err: string[] } = { err: [] };
    return {
      calls,
      d: {
        platform,
        delegate: async (args: string[]) => ((calls.delegated = args), 7),
        windows: async (cmd: string, rest: string[]) => ((calls.windows = [cmd, rest]), 0),
        err: (l: string) => calls.err.push(l),
      },
    };
  };

  it("hands every command, untouched, to collie-board-ctl.sh on Linux and macOS", async () => {
    for (const platform of ["linux", "darwin"] as const) {
      const { calls, d } = deps(platform);
      expect(await main(["logs", "200"], d)).toBe(7);
      expect(calls.delegated).toEqual(["logs", "200"]);
      expect(calls.windows).toBeUndefined();
    }
  });

  it("runs the command natively on Windows", async () => {
    const { calls, d } = deps("win32");
    expect(await main(["start"], d)).toBe(0);
    expect(calls.windows).toEqual(["start", []]);
    expect(calls.delegated).toBeUndefined();
  });

  it("refuses what isn't ported yet on Windows, saying what to do instead", async () => {
    for (const cmd of ["setup", "serve", "unserve", "update"]) {
      const { calls, d } = deps("win32");
      expect(await main([cmd], d)).toBe(2);
      expect(calls.windows).toBeUndefined();
      expect(calls.err[0]).toContain(`'${cmd}' is not available on Windows yet`);
    }
  });
});

describe("herdr-plugin.toml", () => {
  const manifest = Bun.TOML.parse(readFileSync(join(ROOT, "herdr-plugin.toml"), "utf8")) as {
    platforms: string[];
    build: { command: string[]; platforms?: string[] }[];
    actions: { id: string; command: string[]; platforms?: string[] }[];
  };

  it("declares Windows, and builds there through ctl.ts", () => {
    expect(manifest.platforms).toContain("windows");
    const win = manifest.build.filter((b) => (b.platforms ?? manifest.platforms).includes("windows"));
    expect(win.map((b) => b.command)).toEqual([["bun", "scripts/ctl.ts", "build"]]);
  });

  // Herdr refuses two actions with one id whatever their platforms (duplicate_plugin_action_id), so an
  // action offered on Windows must be ctl.ts everywhere — and one ctl.ts can't run natively there
  // must not be offered on Windows at all.
  it("runs every action that reaches Windows through ctl.ts, with its own id as the command", () => {
    const ids = manifest.actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of manifest.actions) {
      const platforms = a.platforms ?? manifest.platforms;
      if (platforms.includes("windows")) {
        expect(a.command).toEqual(["bun", "scripts/ctl.ts", a.id]);
        expect(["setup", "serve", "unserve", "update"]).not.toContain(a.id);
      } else {
        expect(a.command).toEqual(["bash", "scripts/collie-board-ctl.sh", a.id]);
      }
    }
  });
});
