import { beforeEach, describe, expect, test } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { RepoOffer } from "@/components/repo-offer";
import { setPreference } from "@/i18n";
import type { PeersView } from "@/lib/peers";

// Project settings → « Exécution depuis un autre poste »: the same /api/peers/* calls as Settings → Peers.

let view: PeersView;
let posted: [string, unknown][];

beforeEach(() => {
  setPreference("en");
  posted = [];
  view = {
    name: "dell",
    invitation: null,
    inbound: [{ name: "arch", login: null, pairedAt: null, launch: [] }],
    outbound: [],
    environments: [],
    error: null,
  };
  server.use(
    http.get("/api/peers", () => HttpResponse.json(view)),
    http.post("/api/peers/:action", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, string | boolean>;
      posted.push([String(params.action), body]);
      if (body.action === "add") view = { ...view, environments: [{ name: String(body.name), repoPath: String(body.repo), agent: String(body.agent) }] };
      if (params.action === "grant") view = { ...view, inbound: [{ ...view.inbound[0]!, launch: body.allow ? [String(body.environment)] : [] }] };
      return HttpResponse.json({ ok: true });
    }),
  );
});

describe("RepoOffer", () => {
  test("offers the repo under its own name with the chosen agent, then a peer is allowed by its box", async () => {
    const user = userEvent.setup();
    render(<RepoOffer repo="/home/me/git/cad" />);
    const toggle = await screen.findByRole("switch", { name: /offer this repo/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    const box = screen.getByRole("checkbox", { name: "Allow launching from arch" });
    expect(box).toBeDisabled();
    expect(screen.getByLabelText(/environment name/i)).toHaveValue("cad");

    await user.selectOptions(screen.getByLabelText("Agent"), "codex");
    await user.click(toggle);
    await waitFor(() => expect(posted).toContainEqual(["environments", { action: "add", name: "cad", repo: "/home/me/git/cad", agent: "codex" }]));
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));

    await user.click(box);
    await waitFor(() => expect(posted).toContainEqual(["grant", { name: "arch", environment: "cad", allow: true }]));
    await waitFor(() => expect(box).toBeChecked());
  });

  test("an offered repo: the agent change keeps the environment, a rename is saved, off removes it", async () => {
    view = { ...view, environments: [{ name: "cad", repoPath: "/home/me/git/cad", agent: "claude" }] };
    const user = userEvent.setup();
    render(<RepoOffer repo="/home/me/git/cad" />);
    const toggle = await screen.findByRole("switch", { name: /offer this repo/i });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));

    await user.selectOptions(screen.getByLabelText("Agent"), "codex");
    await waitFor(() => expect(posted).toContainEqual(["environments", { action: "agent", name: "cad", agent: "codex" }]));

    const name = screen.getByLabelText(/environment name/i);
    await user.clear(name);
    await user.type(name, "cad-win");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(posted).toContainEqual(["environments", { action: "rename", name: "cad", to: "cad-win" }]));

    await user.click(toggle);
    await waitFor(() => expect(posted).toContainEqual(["environments", { action: "remove", name: "cad" }]));
  });

  test("speaks French", async () => {
    setPreference("fr");
    render(<RepoOffer repo="/home/me/git/cad" />);
    expect(await screen.findByRole("switch", { name: "Offrir ce dépôt aux autres postes" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Autoriser le lancement depuis arch" })).toBeInTheDocument();
  });
});
