import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TemplatePicker } from "@/components/template-picker";
import { TemplatesControl } from "@/components/templates-control";
import { setPreference } from "@/i18n";
import type { AgentTemplate, TemplatesData } from "@/lib/templates";
import { server } from "@/test/setup";

const tpl = (o: Partial<AgentTemplate> & { id: string }): AgentTemplate => ({
  key: null,
  name: o.id,
  description: "",
  agentKind: null,
  model: null,
  brief: "BRIEF",
  builtin: false,
  ...o,
});
const DATA: TemplatesData = {
  templates: [
    tpl({ id: "t1", key: "implementer", builtin: true, name: "Implementer", description: "shipped text", model: "sonnet" }),
    tpl({ id: "t2", name: "Auth reviewer", description: "mine", agentKind: "codex", model: "opus" }),
  ],
  modelKinds: ["claude"],
};

beforeEach(() => {
  setPreference("en");
  server.use(http.get("*/api/templates", () => HttpResponse.json(DATA)));
});
afterEach(() => setPreference("en"));

const openSheet = async () => {
  render(<TemplatesControl />);
  await userEvent.click(await screen.findByRole("button", { name: "Manage" }));
};

describe("TemplatesControl", () => {
  it("shows a shipped template in the app's language and a custom one as typed", async () => {
    setPreference("fr");
    render(<TemplatesControl />);
    expect(await screen.findByText("2 templates")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Gérer" }));
    expect(await screen.findByText("Implémenteur")).toBeInTheDocument();
    expect(screen.getByText("Auth reviewer")).toBeInTheDocument();
    expect(screen.queryByText("Implementer")).toBeNull();
  });

  it("creates one, and refuses a model that is an option", async () => {
    let body: unknown = null;
    server.use(
      http.post("*/api/templates", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ template: tpl({ id: "t3" }) }, { status: 201 });
      }),
    );
    await openSheet();
    await userEvent.click(await screen.findByRole("button", { name: /New template/ }));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Name"), "Sec");
    await userEvent.type(screen.getByLabelText("Brief"), "Look at auth.");
    await userEvent.type(screen.getByLabelText("Model"), "--yolo");
    expect(screen.getByText(/never an option/)).toBeInTheDocument();
    expect(save).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Model"));
    await userEvent.type(screen.getByLabelText("Model"), "opus");
    await userEvent.click(save);
    await waitFor(() => expect(body).toEqual({ description: "", agentKind: null, model: "opus", brief: "Look at auth.", name: "Sec" }));
  });

  it("the copilot's draft fills the form and saves nothing", async () => {
    let saved = false;
    server.use(
      http.post("*/api/templates/draft", () =>
        HttpResponse.json({ ok: true, draft: { name: "Security", description: "Looks at auth", agentKind: null, model: "opus", brief: "Check the auth flow." } }),
      ),
      http.post("*/api/templates", () => {
        saved = true;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    await openSheet();
    await userEvent.click(await screen.findByRole("button", { name: /New template/ }));
    await userEvent.type(screen.getByLabelText("Describe the role"), "a security reviewer");
    await userEvent.click(screen.getByRole("button", { name: "Draft with AI" }));
    expect(await screen.findByText(/Drafted/)).toBeInTheDocument();
    expect(screen.getByLabelText("Brief")).toHaveValue("Check the auth flow.");
    expect(screen.getByLabelText("Name")).toHaveValue("Security");
    expect(saved).toBe(false);
  });

  it("imports the agent files you pick from a repo, and only those", async () => {
    const created: unknown[] = [];
    server.use(
      http.get("*/api/repos", () => HttpResponse.json({ repos: [{ path: "/g/overgate", name: "overgate", source: "card" }], hiddenCount: 0 })),
      http.post("*/api/templates/import", () =>
        HttpResponse.json({
          candidates: [
            { name: "ovg-implementer", description: "Implements a ticket", model: "sonnet", tools: "", brief: "Implement." },
            { name: "ovg-reviewer", description: "Reviews", model: "opus", tools: "Read, Grep", brief: "Review." },
          ],
        }),
      ),
      http.post("*/api/templates", async ({ request }) => {
        created.push(await request.json());
        return HttpResponse.json({ template: tpl({ id: "x" }) }, { status: 201 });
      }),
    );
    await openSheet();
    await userEvent.click(await screen.findByRole("button", { name: /Import from a repo/ }));
    await userEvent.selectOptions(await screen.findByLabelText("Repository"), "/g/overgate");
    await userEvent.click(screen.getByRole("button", { name: "Look for agent files" }));
    expect(await screen.findByText(/2 agent files found/)).toBeInTheDocument();
    expect(screen.getByText(/tools: Read, Grep \(not applied\)/)).toBeInTheDocument();
    expect(created).toHaveLength(0);
    await userEvent.click(screen.getByRole("checkbox", { name: /ovg-reviewer/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save 1 selected" }));
    await waitFor(() => expect(created).toEqual([{ name: "ovg-reviewer", description: "Reviews", model: "opus", brief: "Review." }]));
  });

  it("resets a shipped template and asks twice before deleting a custom one", async () => {
    const calls: string[] = [];
    server.use(
      http.post("*/api/templates/t1/reset", () => {
        calls.push("reset");
        return HttpResponse.json({ template: DATA.templates[0] });
      }),
      http.delete("*/api/templates/t2", () => {
        calls.push("delete");
        return HttpResponse.json({ ok: true });
      }),
    );
    await openSheet();
    await userEvent.click(await screen.findByRole("button", { name: "Reset to shipped" }));
    await waitFor(() => expect(calls).toEqual(["reset"]));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(calls).toEqual(["reset"]);
    await userEvent.click(screen.getByRole("button", { name: "Tap again to delete" }));
    await waitFor(() => expect(calls).toEqual(["reset", "delete"]));
  });
});

describe("TemplatePicker", () => {
  it("lists None first, says what the choice imposes, and reports the pick", async () => {
    const onChange = vi.fn();
    render(<TemplatePicker value="t2" onChange={onChange} />);
    const select = await screen.findByRole("combobox", { name: "Template" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["None", "Implementer", "Auth reviewer"]);
    // codex has no verified model flag: the picker says the model is ignored rather than promise it
    expect(screen.getByText(/Runs on Codex, model opus\. Codex ignores the model\./)).toBeInTheDocument();
    await userEvent.selectOptions(select, "t1");
    expect(onChange).toHaveBeenCalledWith("t1");
    await userEvent.selectOptions(select, "");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("renders nothing while the bridge has not answered", () => {
    server.use(http.get("*/api/templates", () => new Promise(() => {})));
    const { container } = render(<TemplatePicker value={null} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
