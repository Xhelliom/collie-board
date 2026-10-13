import { afterEach, describe, expect, it, vi } from "vitest";
import { boardLoader, boardRouteLoader, homeLoader } from "./board-loaders";

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
    const data = await homeLoader();
    expect(urls.some((u) => u.includes("/api/project/facts"))).toBe(false);
    expect(data.facts).toBeUndefined();
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
