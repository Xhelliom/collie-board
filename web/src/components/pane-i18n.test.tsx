import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";

import { setPreference } from "@/i18n";
import { Composer } from "./composer";

afterEach(() => setPreference("en"));

it("speaks French on the pane screen — composer chrome and the Keys dock — with no English left", async () => {
  setPreference("fr");
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <Composer
          paneId="w1:p1" agent="claude" isShell={false} gone={false} readOnly={false} dialogPresent={false}
          text="" mirrorText="" terminalDraft={null} rawTerminalDraft={null}
          prefs={{ wrap: true, fontSize: 11, rawTerminal: false, reading: false, statusLine: true }}
          setWrap={vi.fn()} stepFontSize={vi.fn()} setRawTerminal={vi.fn()} onSent={vi.fn()}
        />
      ),
    },
  ]);
  render(<RouterProvider router={router} />);
  expect(screen.getByPlaceholderText("Écris une réponse…")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Touches" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Rapide" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Affichage" }));
  expect(screen.getByRole("button", { name: "Agrandir la police" })).toBeInTheDocument();
  expect(screen.queryByText("Type a reply…")).toBeNull();
});
