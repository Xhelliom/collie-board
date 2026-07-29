import { describe, expect, it } from "vitest";

import { boardErrorMessage } from "./board";

// Reported from a phone: tapping Merge showed "/api/cards/1cd268ac-…/integration" and the reason was
// off the end of the line. The refusal sentences are the whole point of the integration gate, so
// they have to survive the trip to the screen.
describe("boardErrorMessage", () => {
  it("digs the bridge's sentence out of an apiRequest failure", () => {
    const err = new Error(
      '/api/cards/1cd268ac-5e55/integration → 409 {"ok":false,"error":"main has uncommitted changes — a merge would land on top of them","kind":"refused"}',
    );
    expect(boardErrorMessage(err)).toBe(
      "main has uncommitted changes — a merge would land on top of them",
    );
  });

  it("falls back to stripping the url-and-status prefix when the body is plain text", () => {
    expect(boardErrorMessage(new Error("/api/cards/x → 404 card not found"))).toBe("card not found");
  });

  it("never returns an empty string, whatever it is handed", () => {
    expect(boardErrorMessage(new Error(""))).toBe("something went wrong");
    expect(boardErrorMessage(undefined)).toBe("something went wrong");
    expect(boardErrorMessage(new Error("/api/x → 500 "))).toBe("something went wrong");
  });

  it("leaves a message that has no prefix alone", () => {
    expect(boardErrorMessage(new Error("Failed to fetch"))).toBe("Failed to fetch");
  });
});
