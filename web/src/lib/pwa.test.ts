import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/pwa.ts wires itself at import time: it reads navigator.serviceWorker.controller and calls
// registerSW. Each test sets up a fake SW world, then imports a fresh copy of the module.

type Opts = { onRegisteredSW?: (url: string, r: ServiceWorkerRegistration) => void };
let opts: Opts = {};
vi.mock("virtual:pwa-register", () => ({
  registerSW: (o: Opts) => {
    opts = o;
    return () => Promise.resolve();
  },
}));

class FakeWorker extends EventTarget {
  state = "installing";
  go(state: string) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

const reload = vi.fn();
let container: EventTarget & { controller: unknown };
let reg: EventTarget & { active: FakeWorker | null; installing: FakeWorker | null; update: () => Promise<void> };

async function boot(controlled: boolean) {
  container = Object.assign(new EventTarget(), { controller: controlled ? {} : null });
  vi.stubGlobal("navigator", { serviceWorker: container });
  reg = Object.assign(new EventTarget(), {
    active: controlled ? new FakeWorker() : null,
    installing: null as FakeWorker | null,
    update: () => Promise.resolve(),
  });
  vi.resetModules();
  await import("./pwa");
  opts.onRegisteredSW?.("/sw.js", reg as unknown as ServiceWorkerRegistration);
}

// The browser's sequence for one worker: updatefound, then installed → activated, then the
// clientsClaim() in sw.ts makes it the controller.
function installWorker() {
  const w = new FakeWorker();
  reg.installing = w;
  reg.dispatchEvent(new Event("updatefound"));
  w.go("installed");
  reg.installing = null;
  reg.active = w;
  w.go("activated");
  container.controller = w;
  container.dispatchEvent(new Event("controllerchange"));
}

beforeEach(() => {
  vi.useFakeTimers(); // the 60 s update poll
  reload.mockClear();
  vi.spyOn(window, "location", "get").mockReturnValue({ reload } as unknown as Location);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("first-ever visit (no controller yet)", () => {
  it("does not reload when the first worker installs, activates and claims the page", async () => {
    await boot(false);
    installWorker();
    expect(reload).not.toHaveBeenCalled();
  });

  it("still reloads when a later worker replaces that first one", async () => {
    await boot(false);
    installWorker();
    installWorker();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("return visit (already controlled)", () => {
  it("reloads once when a new worker takes over", async () => {
    await boot(true);
    installWorker();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
