import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/setup";

import { RepoModelSettings } from "./repo-model-settings";

const harnesses = [
  { kind: "claude", provider: false, providers: [{ id: "anthropic", models: [{ id: "opus", efforts: ["low", "medium"] }] }], value: { provider: null, model: "opus", effort: "medium" } },
  {
    kind: "opencode",
    provider: true,
    providers: [{ id: "l40s", models: [{ id: "qwen38", efforts: ["low", "xhigh"] }, { id: "plain", efforts: [] }] }],
    value: null,
  },
];

describe("repo default model per harness", () => {
  it("offers provider → model → effort for OpenCode, effort only when the model has variants", async () => {
    const posted: unknown[] = [];
    server.use(
      http.get("/api/repos/model", () => HttpResponse.json({ harnesses })),
      http.post("/api/repos/model", async ({ request }) => {
        const b = (await request.json()) as { kind: string; provider: string | null; model: string | null; effort: string | null };
        posted.push(b);
        return HttpResponse.json({ kind: b.kind, value: { provider: b.provider, model: b.model, effort: b.effort } });
      }),
    );
    render(<RepoModelSettings repo="/r/app" />);
    const claude = await screen.findByRole("group", { name: "claude" });
    expect(within(claude).getByRole("combobox", { name: "Default model" })).toHaveValue("opus");
    expect(within(claude).getByRole("combobox", { name: "Effort" })).toHaveValue("medium");
    expect(within(claude).queryByRole("combobox", { name: "Provider" })).toBeNull();

    const oc = screen.getByRole("group", { name: "opencode" });
    expect(within(oc).queryByRole("combobox", { name: "Effort" })).toBeNull();
    await userEvent.selectOptions(within(oc).getByRole("combobox", { name: "Provider" }), "l40s");
    await userEvent.selectOptions(within(oc).getByRole("combobox", { name: "Default model" }), "qwen38");
    await userEvent.selectOptions(within(oc).getByRole("combobox", { name: "Effort" }), "xhigh");
    expect(posted.at(-1)).toEqual({ path: "/r/app", kind: "opencode", provider: "l40s", model: "qwen38", effort: "xhigh" });
    await userEvent.selectOptions(within(oc).getByRole("combobox", { name: "Default model" }), "plain");
    expect(within(oc).queryByRole("combobox", { name: "Effort" })).toBeNull();
  });

  it("leaves the field free when OpenCode's files offered nothing", async () => {
    server.use(http.get("/api/repos/model", () => HttpResponse.json({ harnesses: [{ ...harnesses[1], providers: [] }] })));
    render(<RepoModelSettings repo="/r/app" />);
    const oc = await screen.findByRole("group", { name: "opencode" });
    expect(within(oc).getByRole("textbox", { name: "Provider" })).toBeInTheDocument();
    expect(within(oc).getByRole("textbox", { name: "Default model" })).toBeInTheDocument();
  });
});
