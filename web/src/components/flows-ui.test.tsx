import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FlowPicker } from "@/components/flow-picker";
import { FlowsSheet } from "@/components/flows-sheet";
import { GateControl } from "@/components/gate-control";
import { setPreference } from "@/i18n";
import { flowName, flowSteps, type Flow } from "@/lib/flows";
import type { AgentTemplate, TemplatesData } from "@/lib/templates";
import { server } from "@/test/setup";

const tpl = (o: Partial<AgentTemplate> & { id: string }): AgentTemplate => ({
  key: null, name: o.id, description: "", agentKind: null, model: null, brief: "B", builtin: false, worker: false, ...o,
});
const TEMPLATES: TemplatesData = {
  templates: [tpl({ id: "t1", key: "implementer", builtin: true, name: "Implementer" }), tpl({ id: "t2", key: "reviewer", builtin: true, name: "Reviewer" })],
  modelKinds: [],
};
const CODE: Flow = { id: "f1", key: "code", name: "Code", description: "", steps: ["t1", "t2"], builtin: true };
const MINE: Flow = { id: "f2", key: null, name: "Mine", description: "", steps: ["t2"], builtin: false };

beforeEach(() => {
  setPreference("en");
  server.use(
    http.get("*/api/templates", () => HttpResponse.json(TEMPLATES)),
    http.get("*/api/flows", () => HttpResponse.json({ flows: [CODE, MINE] })),
  );
});

describe("flows helpers", () => {
  it("a shipped flow reads translated by its key, a custom one as typed; steps read as A → B", () => {
    setPreference("fr");
    expect(flowName(CODE)).toBe("Code : implémenter puis relire");
    expect(flowName(MINE)).toBe("Mine");
    expect(flowSteps({ steps: ["t2", "gone", "t1"] }, TEMPLATES.templates)).toBe("Relecteur → Implémenteur");
  });
});

describe("FlowPicker", () => {
  it("lists the flows, says the chosen one's steps, and reports a change", async () => {
    const onChange = vi.fn();
    render(<FlowPicker value="f1" onChange={onChange} />);
    expect(await screen.findByText(/Implementer → Reviewer\./)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Flow" }), "f2");
    expect(onChange).toHaveBeenCalledWith("f2");
  });
});

describe("FlowsSheet", () => {
  it("creates a flow from ordered steps", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post("*/api/flows", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ flow: MINE }, { status: 201 });
      }),
    );
    const onChanged = vi.fn();
    render(<FlowsSheet open onClose={() => {}} flows={[CODE, MINE]} templates={TEMPLATES.templates} onChanged={onChanged} />);
    await userEvent.click(await screen.findByRole("button", { name: /New flow/ }));
    await userEvent.type(screen.getByLabelText("Name"), "Check");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Add a step" }), "t1");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Add a step" }), "t2");
    await userEvent.click(screen.getByRole("button", { name: "Move Reviewer up" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodies).toEqual([{ description: "", steps: ["t2", "t1"], name: "Check" }]));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});

describe("GateControl: a repo's default flow", () => {
  it("sets it from the repo's row", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get("*/api/repos*", () => HttpResponse.json({ repos: [{ path: "/r/app", source: "card" }], hiddenCount: 0 })),
      http.post("*/api/repos/flow", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    render(<GateControl />);
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: /Default flow — app/ }), "f2");
    await waitFor(() => expect(bodies).toEqual([{ path: "/r/app", flowId: "f2" }]));
  });
});
