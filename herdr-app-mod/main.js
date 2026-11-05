// Collie Board — panneau projet + orchestrateur pour herdr-app. PROTOTYPE, lecture seule :
// uniquement des GET vers le bridge (aucun lancement, aucun merge, aucune écriture).
// checkAccess (bridge/server.ts) laisse passer un GET sans en-tête Origin : seule une écriture
// non-GET sans Origin depuis un Host non-loopback est refusée. Ici on n'émet que des GET.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, panes, spaces, terminals, run, exec } from "herdr";

const B = "http://127.0.0.1:8788";
const EVERY_MS = 10000;

const get = async (path) => {
  const r = await fetch(B + path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
};
const q = (repo) => encodeURIComponent(repo);
const ago = (ms) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} j`;
};
const oneLine = (s, n = 140) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

// Même règle que la PWA (web/src/lib/recette.ts isPending).
const pending = (e) => e.state === "todo" || (e.state === "ko" && !e.followUpDone);

export default class CollieBoard extends View {
  init(_props, cx) {
    this.repos = []; this.data = null; this.error = null;
    try { this.repo = localStorage.getItem("repo"); } catch { this.repo = null; }
    this.refresh(cx);
    cx.timer.every(EVERY_MS, (cx) => { if (this.shown()) this.refresh(cx); });
  }

  // Rien quand caché : un pane dans un onglet non affiché ne rafraîchit pas.
  // shortcut: un bloc de layout (pas un pane) est supposé visible ; lire layout() .hidden si besoin.
  shown() {
    const me = props()?.pane && panes().find((p) => p.pane === props().pane);
    if (!me) return true;
    return spaces().some((s) => s.active && s.tabs.some((t) => t.active && t.id === me.tab));
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        this.repos = (await get("/api/repos")).repos ?? [];
        if (!this.repos.some((r) => r.path === this.repo)) this.repo = this.repos[0]?.path ?? null;
        if (this.repo) this.data = await this.load(this.repo);
        this.error = null;
      } catch (e) {
        this.error = String(e?.message ?? e);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  async load(repo) {
    const [phases, runs, recette, orch, log, snap] = await Promise.all([
      get(`/api/phases?repo=${q(repo)}`), get(`/api/runs?repo=${q(repo)}`), get(`/api/recette?repo=${q(repo)}`),
      get(`/api/orchestrator?repo=${q(repo)}`), get("/api/notifications/log"), get("/api/snapshot"),
    ]);
    const open = (phases.phases ?? []).filter((p) => !p.closedAt).sort((a, b) => a.position - b.position);
    const openIds = new Set(open.map((p) => p.id));
    const lots = (runs.runs ?? []).filter((r) => openIds.has(r.phaseId));
    const entries = (recette.groups ?? []).flatMap((g) => g.entries ?? []);
    const paneId = orch.running ? orch.paneId : null;
    let messages = [];
    if (paneId) {
      const h = await get(`/api/pane/${q(paneId)}/history?limit=40`).catch(() => null);
      messages = (h?.entries ?? []).filter((e) => e.role === "assistant")
        .flatMap((e) => e.parts.filter((p) => p.kind === "text").map((p) => ({ ts: Date.parse(e.ts), text: p.text })))
        .slice(-3).reverse();
    }
    return {
      repo,
      phases: open,
      lots: {
        running: lots.filter((r) => r.launchedAt && !r.finished),
        planned: lots.filter((r) => !r.launchedAt),
        done: lots.filter((r) => r.finished),
      },
      toTest: entries.filter(pending).length,
      orch: { ...orch, agent: paneId ? (snap.agents ?? []).find((a) => a.paneId === paneId) : null },
      messages,
      alerts: (log.entries ?? []).filter((e) => e.cwd === repo || (paneId && e.paneId === paneId)).slice(0, 4),
    };
  }

  pick(repo, cx) {
    this.repo = repo; this.data = null;
    try { localStorage.setItem("repo", repo); } catch {}
    this.refresh(cx);
  }

  // Le terminal herdr-app qui porte le pane herdr de l'orchestrateur, s'il existe (label collie.pane).
  // shortcut: herdr et herdr-app ont des cœurs distincts aujourd'hui ; sans ce label, on ouvre la PWA.
  orchTerminal(paneId) {
    return terminals().find((t) => t.labels && (t.labels["collie.pane"] === paneId)) ?? null;
  }

  openOrch(cx) {
    const d = this.data; if (!d) return;
    const t = d.orch.paneId && this.orchTerminal(d.orch.paneId);
    if (t) return run("agent.focus", { terminal: t.address });
    const url = d.orch.paneId ? `${B}/pane/${q(d.orch.paneId)}` : `${B}/board/project?repo=${q(d.repo)}`;
    cx.spawn(async () => { await exec("xdg-open", [url]).catch(() => {}); });
  }

  render(_cx) {
    const t = theme();
    const label = (s) => div().text_size(11).font_semibold().text_color(t.dim).child(s);
    const card = (...kids) => v_flex().gap(6).p(10).rounded(8).bg(t.surface).border_1().border_color(t.border).children(kids);
    const statusColor = (s) => t[s] ?? t.unknown;

    const chips = h_flex().flex_wrap().gap(4).children(this.repos.slice(0, 12).map((r) =>
      div().id(`repo-${r.path}`).px(8).py(3).rounded(6).text_size(12)
        .bg(r.path === this.repo ? t.selected : t.raised)
        .text_color(r.path === this.repo ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.pick(r.path, cx))
        .child(r.name)));

    const d = this.data;
    let body;
    if (!d) body = div().text_color(t.muted).child(this.error ? `Bridge injoignable : ${this.error}` : "Chargement…");
    else {
      const lotRow = (name, list, color) => h_flex().gap(6).items_center()
        .child(div().w(8).h(8).rounded(4).bg(color))
        .child(div().w(80).text_color(t.muted).child(name))
        .child(div().font_semibold().child(String(list.length)))
        .child(div().flex_1().truncate().text_color(t.dim).child(list.map((r) => r.name).join(" · ")));

      const project = card(
        label("PHASE EN COURS"),
        ...(d.phases.length ? d.phases.map((p) => div().font_semibold().child(p.name)) : [div().text_color(t.muted).child("Aucune phase ouverte")]),
        label("LOTS"),
        lotRow("En cours", d.lots.running, t.working),
        lotRow("Planifiés", d.lots.planned, t.idle),
        lotRow("Finis", d.lots.done, t.done),
        h_flex().gap(6).items_center().pt(4)
          .child(div().text_size(18).font_semibold().text_color(d.toTest ? t.blocked : t.done).child(String(d.toTest)))
          .child(div().text_color(t.muted).child("à tester dans la recette")),
      );

      const o = d.orch, a = o.agent, st = !o.running ? "absent" : a?.status ?? "inconnu";
      const orch = card(
        h_flex().justify_between().items_center()
          .child(label("ORCHESTRATEUR"))
          .child(h_flex().gap(6).items_center()
            .child(div().w(8).h(8).rounded(4).bg(o.running ? statusColor(a?.status) : t.unknown))
            .child(div().text_size(12).child(st + (o.ctxPct != null && o.running ? ` · ctx ${o.ctxPct} %` : "")))),
        ...(d.messages.length
          ? d.messages.map((m) => v_flex().gap(1)
              .child(div().text_size(11).text_color(t.dim).child(`il y a ${ago(m.ts)}`))
              .child(div().text_size(12).child(oneLine(m.text))))
          : [div().text_size(12).text_color(t.muted).child(o.running ? "Pas de message récent" : "Pas d'orchestrateur en marche")]),
        label("ALERTES"),
        ...(d.alerts.length
          ? d.alerts.map((n) => h_flex().gap(6).items_start()
              .child(div().mt(4).w(6).h(6).rounded(3).bg(statusColor(n.status)))
              .child(v_flex().flex_1()
                .child(div().text_size(12).truncate().child(n.cardTitle ?? n.workspaceLabel ?? n.status))
                .child(div().text_size(11).text_color(t.dim).child(`${ago(n.ts)} · ${oneLine(n.subtitle, 90)}`))))
          : [div().text_size(12).text_color(t.muted).child("Aucune alerte")]),
        div().id("open-orch").mt(4).px(10).py(5).rounded(6).bg(t.solid).text_color(t.solid_foreground).text_size(12)
          .hover((s) => s.opacity(0.85))
          .on_click((_e, cx) => this.openOrch(cx))
          .child(o.paneId && this.orchTerminal(o.paneId) ? "Ouvrir son terminal" : "Ouvrir dans la PWA ↗"),
      );
      body = v_flex().gap(10).child(project).child(orch);
    }

    return v_flex().id("collie").size_full().min_h(0).p(10).gap(10).bg(t.chrome).text_color(t.foreground).text_size(13)
      .overflow_y_scrollbar()
      .child(h_flex().justify_between().items_center()
        .child(div().font_semibold().child("Collie · projets"))
        .child(div().text_size(11).text_color(t.dim).child(this.loading ? "…" : "lecture seule")))
      .child(chips)
      .child(body);
  }
}
