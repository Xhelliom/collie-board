import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { ExitCriteria } from "@/components/exit-criteria";
import { setPreference } from "@/i18n";
import type { ExitView } from "@/lib/peers";
import { server } from "@/test/setup";

test("shows the four criteria held or not, and ticks the two manual ones", async () => {
  setPreference("fr");
  let view: ExitView = {
    protocol: { held: false, generation: 1, version: "0.1.20", since: Date.UTC(2026, 9, 20), due: Date.UTC(2026, 11, 20) },
    machines: { held: false, onHc: 1, total: 2, list: [{ name: "dell", engine: "hc" }, { name: "dev", engine: null }] },
    harnesses: { held: true },
    herdr09: { held: false },
  };
  const posted: unknown[] = [];
  server.use(
    http.get("/api/exit-criteria", () => HttpResponse.json(view)),
    http.post("/api/exit-criteria", async ({ request }) => {
      const b = (await request.json()) as { herdr09Frozen?: boolean };
      posted.push(b);
      view = { ...view, herdr09: { held: b.herdr09Frozen === true } };
      return HttpResponse.json(view);
    }),
  );
  render(<ExitCriteria />);

  expect(await screen.findByText("Conditions de départ : 1 sur 4 tenues")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Voir" }));
  expect(screen.getByTestId("exit-protocol")).toHaveTextContent(/protocole 1 \(hc 0\.1\.20\).*pas tenu/);
  expect(screen.getByTestId("exit-machines")).toHaveTextContent(/Machines sous hc : 1\/2.*dell : herdr-core · dev : inconnu.*pas tenu/);
  expect(screen.getByTestId("exit-harnesses")).toHaveTextContent(/coché à la main\s*tenu$/);
  expect(screen.getAllByRole("switch")).toHaveLength(2);

  await userEvent.click(screen.getByRole("switch", { name: /herdr 0.9 ne reçoit plus/ }));
  expect(await screen.findByText("Conditions de départ : 2 sur 4 tenues")).toBeInTheDocument();
  expect(posted).toEqual([{ herdr09Frozen: true }]);
  expect(screen.getByTestId("exit-herdr09")).not.toHaveTextContent("pas tenu");
});
