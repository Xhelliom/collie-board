import { beforeEach, describe, expect, it } from "bun:test";

import { metered, record, resetRouteCost, routeCostSnapshot, routeKey } from "./route-cost.ts";

describe("route-cost", () => {
  beforeEach(resetRouteCost);

  it("normalises ids out of the path", () => {
    expect(routeKey("GET", "/api/pane/w1%3Ap3/history")).toBe("GET /api/pane/:id/history");
    expect(routeKey("POST", "/api/cards/42/start")).toBe("POST /api/cards/:id/start");
    expect(routeKey("POST", "/api/notifications/log/read-all")).toBe("POST /api/notifications/log/read-all");
    expect(routeKey("GET", "/assets/index-abc123.js")).toBe("GET (static)");
  });

  it("counts calls, time, bytes and 304s per route", async () => {
    const req = (p: string) => new Request(`http://x${p}`);
    const res = await metered(req("/api/cards/1"), async () => new Response("hello"));
    expect(await res.text()).toBe("hello");
    await metered(req("/api/cards/2"), async () => new Response(null, { status: 304 }));
    record("engine poll", 5);
    const { routes } = routeCostSnapshot();
    const cards = routes.find((r) => r.route === "GET /api/cards/:id")!;
    expect(cards).toMatchObject({ calls: 2, bytes: 5, notModified: 1 });
    expect(routes.find((r) => r.route === "engine poll")).toMatchObject({ calls: 1, totalMs: 5, maxMs: 5 });
  });

  it("caps distinct keys so a junk path cannot grow the map", () => {
    for (let i = 0; i < 300; i++) record(`GET /junk/${"a".repeat(i)}`, 1);
    const { routes } = routeCostSnapshot();
    expect(routes.length).toBe(201);
    expect(routes.find((r) => r.route === "(other)")!.calls).toBe(100);
  });
});
