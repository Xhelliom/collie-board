import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { setupServer } from "msw/node";

import { handlers, resetTypedDraft } from "./handlers";
import { __resetConnectionHealth } from "@/lib/connection-health";

// One MSW server for all tests; tests add per-case overrides with `server.use(...)`.
export const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
// The connection-health store is module-scoped and initialises its anchor to module-load time. Pin it
// to "now" before every test so a component rendered minutes after the file loaded never reads a stale
// anchor as an escalated outage. Fake-timer escalation suites re-pin AFTER vi.useFakeTimers() so the
// anchor equals the frozen clock exactly.
beforeEach(() => __resetConnectionHealth());
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetTypedDraft(); // the fake pane's input line, so a draft can't leak into the next test
});
afterAll(() => server.close());

// jsdom gaps that the terminal mirror / sheets touch.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}
// jsdom implements pointer EVENTS but not pointer CAPTURE, and Vaul claims the pointer on every
// pointerdown inside a sheet. Without these, any test that clicks inside a sheet throws an uncaught
// TypeError from outside the assertion path — the suite still went green while spraying 54 errors.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = () => false;
}
// jsdom parses <dialog> but implements neither showModal() nor close(), and the image viewer opens
// itself with showModal() on mount (that call is what puts it in the top layer). The shim does what
// the real methods do to the DOM — toggle `open`, fire `close` — which is everything a test can
// observe anyway: the top layer and the backdrop have no jsdom equivalent to assert against.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

// NOT a jsdom gap — a Node one, and a confusing one. Node 24+ defines its own `localStorage` global
// that stays UNDEFINED unless the process was started with `--localstorage-file`, and it takes
// precedence over the one jsdom installs. So every display-preference test started failing on
// `localStorage.clear()` the day the machine's Node was upgraded, with nothing in this repo having
// changed. Put a real one back when it's missing, per worker, in memory.
if (!globalThis.localStorage) {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => store.get(k) ?? null,
    // Storage stringifies everything — a test storing a number must read back a string, or it
    // would pass here and fail in a browser.
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: shim });
}
if (!("matchMedia" in window)) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}
