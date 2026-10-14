import { afterEach, describe, expect, it, vi } from "vitest";
import { boardLoader, boardRouteLoader, homeLoader, projectLoader } from "./board-loaders";

// The home screen never reads the facts, and they are the heaviest thing on its poll: its loader must not ask.
function stubFetch() {
  const urls: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    urls.push(url);
    const body = url.includes("/api/project/facts") ? { facts: [{ cardId: "c1" }] } : { cards: [] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  });
  return urls;
}

afterEach(() => vi.unstubAllGlobals());

describe("home vs board loader", () => {
  it("the home loader never requests /api/project/facts", async () => {
    const urls = stubFetch();
    const data = await (await homeLoader()).board;
    expect(urls.some((u) => u.includes("/api/project/facts"))).toBe(false);
    expect(data.facts).toBeUndefined();
  });

  it("defers the cards only on a cold start: once a list is known a poll hands <Await> data, not a promise", async () => {
    stubFetch();
    await (await homeLoader()).board;
    expect((await homeLoader()).board).not.toBeInstanceOf(Promise);
  });

  it("the board loader still requests the facts and returns them by card id", async () => {
    const urls = stubFetch();
    const data = await boardLoader();
    expect(urls.some((u) => u.includes("/api/project/facts"))).toBe(true);
    expect(data.facts?.c1).toBeDefined();
  });
});

describe("board route loader", () => {
  it("asks for cards, facts, phases and templates — none of the project page's layer", async () => {
    const urls = stubFetch();
    await boardRouteLoader({ request: new Request("http://x/board?repo=/r") });
    for (const path of ["/api/cards", "/api/project/facts", "/api/phases", "/api/templates"]) {
      expect(urls.some((u) => u.includes(path)), path).toBe(true);
    }
    for (const path of ["lots", "runs", "roadmap", "orchestrator", "flows", "history", "memory"]) {
      expect(urls.some((u) => u.includes(path)), path).toBe(false);
    }
  });
});

describe("project loader", () => {
  it("sends the repo's requests without waiting for cards and facts, and memory with history", async () => {
    const urls: string[] = [];
    let releaseCards!: () => void;
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", (url: string) => {
      urls.push(url);
      if (url.includes("/api/cards")) return new Promise<Response>((r) => (releaseCards = () => r(json({ cards: [] }))));
      if (url.includes("/api/orchestrator?")) return Promise.resolve(json({ paneId: "p1" }));
      return Promise.resolve(new Response("nope", { status: 500 }));
    });
    const pending = projectLoader({ request: new Request("http://x/project?repo=/r") });
    await vi.waitFor(() => {
      for (const path of ["/api/phases", "/api/runs", "/api/roadmap", "/api/orchestrator?", "/api/templates", "/api/flows", "history", "memory"]) {
        expect(urls.some((u) => u.includes(path)), path).toBe(true);
      }
    });
    releaseCards();
    // A failed project fetch still degrades to "none", not an error page.
    const data = await pending;
    expect(data.error).toBe(false);
    expect(data).toMatchObject({ phases: [], lots: [], roadmap: null, orchestratorEntries: [], orchestratorMemory: null, templates: null, flows: null });
  });
});

// Audit perf #4: the list screens read the summary view; the full list only where a screen needs what it leaves out.
describe("which view of the cards", () => {
  const cardsUrl = (urls: string[]) => urls.find((u) => u.startsWith("/api/cards"));
  it("home and an unfiltered Board read the summary; a filtered Board and the project page the full list", async () => {
    let urls = stubFetch();
    await (await homeLoader()).board;
    expect(cardsUrl(urls)).toBe("/api/cards?view=summary");
    urls = stubFetch();
    await boardRouteLoader({ request: new Request("http://x/board?repo=/r&status=done") });
    expect(cardsUrl(urls)).toBe("/api/cards?view=summary");
    for (const q of ["tag=x", "origin=auto", "phase=p1", "done=all"]) {
      urls = stubFetch();
      await boardRouteLoader({ request: new Request(`http://x/board?${q}`) });
      expect(cardsUrl(urls), q).toBe("/api/cards");
    }
    urls = stubFetch();
    await projectLoader({ request: new Request("http://x/project?repo=/r") });
    expect(cardsUrl(urls)).toBe("/api/cards");
  });
});
