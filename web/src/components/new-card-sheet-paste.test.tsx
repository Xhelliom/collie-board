import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { NewCardSheet } from "./new-card-sheet";

// Pasting a screenshot into a card. The mechanism is the composer's (hooks/use-image-upload.ts) —
// what needs proving here is that the sheet is actually WIRED to it: the upload fires, and the host
// path it returns lands in the dump, so the agent that picks the card up can read the image.

function renderSheet() {
  render(<NewCardSheet open onClose={() => {}} onCreate={() => {}} tags={[]} />);
  return screen.getByRole("textbox", { name: /what needs doing/i });
}

describe("NewCardSheet — clipboard image paste", () => {
  it("uploads a pasted image and appends its path to the dump", async () => {
    server.use(
      http.post(/\/api\/pane\/[^/]+\/upload$/, () => HttpResponse.json({ ok: true, path: "/tmp/shot.png" })),
    );
    const box = renderSheet();
    const file = new File(["x"], "shot.png", { type: "image/png" });

    fireEvent.paste(box, { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] } });

    await waitFor(() => expect(box).toHaveValue("/tmp/shot.png"));
  });

  it("leaves a plain-text paste alone", () => {
    const box = renderSheet();

    fireEvent.paste(box, {
      clipboardData: { items: [{ kind: "string", type: "text/plain", getAsFile: () => null }] },
    });

    expect(box).toHaveValue("");
  });
});
