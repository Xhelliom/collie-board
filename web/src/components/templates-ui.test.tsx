import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PhaseTemplate } from "@/components/phase-template";
import { TemplateChip } from "@/components/template-chip";
import { TemplatePicker } from "@/components/template-picker";
import { setPreference } from "@/i18n";
import type { Phase } from "@/lib/board";
import { templateFor, type AgentTemplate, type TemplatesData } from "@/lib/templates";
import { server } from "@/test/setup";

const tpl = (o: Partial<AgentTemplate> & { id: string }): AgentTemplate => ({
  key: null, name: o.id, description: "", agentKind: null, model: null, brief: "B", builtin: false, ...o,
});
const DATA: TemplatesData = {
  templates: [
    tpl({ id: "t1", key: "reviewer", builtin: true, name: "Reviewer", agentKind: "claude", model: "opus" }),
    tpl({ id: "t2", name: "Doc writer" }),
  ],
  modelKinds: ["claude"],
};
const phase = (o: Partial<Phase> = {}): Phase => ({ id: "p1", repoPath: "/r", name: "P1", goal: "", position: 0, roadmapItemId: null, templateId: null, ...o });

beforeEach(() => {
  setPreference("en");
  server.use(http.get("*/api/templates", () => HttpResponse.json(DATA)));
});
afterEach(() => setPreference("en"));

describe("templateFor", () => {
  const phases = [{ id: "p1", templateId: "t2" }, { id: "p2", templateId: null }];
  it("a card's own template wins, else its phase's (marked inherited), else none", () => {
    expect(templateFor({ templateId: "t1", phaseId: "p1" }, phases, DATA.templates)).toMatchObject({ template: { id: "t1" }, inherited: false });
    expect(templateFor({ templateId: null, phaseId: "p1" }, phases, DATA.templates)).toMatchObject({ template: { id: "t2" }, inherited: true });
    expect(templateFor({ templateId: null, phaseId: "p2" }, phases, DATA.templates)).toBeNull();
    // A template that no longer exists is no template, not a crash.
    expect(templateFor({ templateId: "gone", phaseId: null }, phases, DATA.templates)).toBeNull();
  });
});

describe("TemplateChip", () => {
  it("says it is inherited from the phase only when it is", () => {
    const { rerender } = render(<TemplateChip name="Reviewer" inherited />);
    expect(screen.getByText("Reviewer")).toHaveAttribute("title", "from the phase");
    rerender(<TemplateChip name="Reviewer" inherited={false} />);
    expect(screen.getByText("Reviewer")).not.toHaveAttribute("title");
  });
});

describe("PhaseTemplate", () => {
  it("sets the phase's default template, and clears it", async () => {
    const bodies: unknown[] = [];
    const onChanged = vi.fn();
    server.use(
      http.patch("*/api/phases/p1", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ phase: {} });
      }),
    );
    render(<PhaseTemplate phase={phase()} data={DATA} onChanged={onChanged} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Default template" }), "t1");
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(bodies).toEqual([{ templateId: "t1" }]);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Default template" }), "");
    await waitFor(() => expect(bodies).toEqual([{ templateId: "t1" }, { templateId: null }]));
  });

  it("says what the chosen template imposes, in French when asked", async () => {
    setPreference("fr");
    render(<PhaseTemplate phase={phase({ templateId: "t1" })} data={DATA} onChanged={() => {}} />);
    expect(screen.getByText("Template par défaut")).toBeInTheDocument();
    expect(screen.getByText(/modèle opus/)).toBeInTheDocument();
    expect(screen.getByText("Relecteur")).toBeInTheDocument();
  });

  it("renders nothing while the templates are unknown", () => {
    const { container } = render(<PhaseTemplate phase={phase()} data={null} onChanged={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("TemplatePicker: managing without leaving the screen", () => {
  it("opens the templates sheet from the picker", async () => {
    render(<TemplatePicker value={null} onChange={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "Manage templates…" }));
    expect(await screen.findByText("Agent templates")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New template/ })).toBeInTheDocument();
  });
});
