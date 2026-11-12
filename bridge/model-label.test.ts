import { describe, expect, it } from "bun:test";
import { modelLabel } from "./model-label.ts";

describe("modelLabel", () => {
  it("shortens a Claude slug to family + version", () => {
    expect(modelLabel("claude-fable-5-2")).toBe("Fable 5.2");
    expect(modelLabel("claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelLabel("claude-sonnet-5-5")).toBe("Sonnet 5.5");
    expect(modelLabel("claude-opus-5")).toBe("Opus 5");
  });

  it("drops a date stamp and a window suffix, and reads the older version-first order", () => {
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(modelLabel("claude-opus-5-5[1m]")).toBe("Opus 5.5");
    expect(modelLabel("claude-3-5-sonnet-20241022")).toBe("Sonnet 3.5");
  });

  it("leaves a slug that is not Claude's as written", () => {
    expect(modelLabel("qwen3.8-coder")).toBe("qwen3.8-coder");
  });

  it("names nothing rather than a model that is not one", () => {
    expect(modelLabel("<synthetic>")).toBeNull();
    expect(modelLabel("")).toBeNull();
    expect(modelLabel(null)).toBeNull();
  });
});
