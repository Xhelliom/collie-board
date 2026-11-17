import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { setPreference } from "@/i18n";
import { AboutControl } from "./about-control";

// Settings → About during an update: the version row names the step, the track shows what is behind,
// and a failed step carries its reason.
const about = (version: object) => server.use(http.get("/api/about", () => HttpResponse.json({ rows: [{ id: "version", ...version }] })));

describe("AboutControl — an update in progress", () => {
  it("names the current step and marks it on the track", async () => {
    setPreference("fr");
    about({ state: "todo", key: "updating", vars: { current: "1.0.0", build: "abc", step: "build" } });
    render(<AboutControl />);
    expect(await screen.findByText(/Mise à jour en cours/)).toBeTruthy();
    expect(screen.queryByText(/\.fix$/)).toBeNull();
    const steps = screen.getByRole("list", { name: "Étapes de la mise à jour" });
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toBe("construction");
  });

  it("shows where a failed update stopped, and why", async () => {
    setPreference("fr");
    about({ state: "down", key: "failed", vars: { current: "1.0.0", build: "abc", step: "fetch", reason: "fatal: unable to access origin" } });
    render(<AboutControl />);
    expect(await screen.findByText(/s'est arrêtée à l'étape récupération/)).toBeTruthy();
    expect(screen.getByText("fatal: unable to access origin")).toBeTruthy();
  });
});
