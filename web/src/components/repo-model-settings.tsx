import { useEffect, useState } from "react";

import { useT } from "@/i18n";
import { boardErrorMessage, fetchRepoModels, setRepoModel, type HarnessModel, type RepoModel } from "@/lib/board";
import { setStatus } from "@/lib/status";

const field = "h-8 max-w-[14rem] rounded-md border border-border bg-background px-2 text-sm";
const NONE: RepoModel = { provider: null, model: null, effort: null };

/** A list when the harness's files offered one, a free field when they did not. Empty = « None ». */
function Pick({ label, value, options, none, onPick }: { label: string; value: string | null; options: { id: string; name?: string }[]; none: string; onPick: (v: string | null) => void }) {
  if (!options.length)
    return (
      <input
        key={value ?? ""}
        aria-label={label}
        placeholder={none}
        defaultValue={value ?? ""}
        onBlur={(e) => e.target.value.trim() !== (value ?? "") && onPick(e.target.value.trim() || null)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={field}
      />
    );
  // A value set elsewhere that the list no longer offers stays shown, not silently dropped.
  const all = value && !options.some((o) => o.id === value) ? [...options, { id: value }] : options;
  return (
    <select aria-label={label} value={value ?? ""} onChange={(e) => onPick(e.target.value || null)} className={field}>
      <option value="">{none}</option>
      {all.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name && o.name !== o.id ? `${o.id} — ${o.name}` : o.id}
        </option>
      ))}
    </select>
  );
}

function Harness({ h, onSave }: { h: HarnessModel; onSave: (v: RepoModel) => void }) {
  const t = useT();
  const v = h.value ?? NONE;
  const models = h.provider ? (h.providers.find((p) => p.id === v.provider)?.models ?? []) : h.providers.flatMap((p) => p.models);
  const efforts = models.find((m) => m.id === v.model)?.efforts ?? [];
  return (
    <div className="flex flex-col gap-1.5" aria-label={h.kind} role="group">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{t("orch.model")} · {h.kind}</span>
        <span className="flex flex-wrap items-center justify-end gap-2">
          {h.provider && <Pick label={t("orch.provider")} value={v.provider} options={h.providers} none={t("orch.providerNone")} onPick={(provider) => onSave({ provider, model: null, effort: null })} />}
          <Pick label={t("orch.model")} value={v.model} options={models} none={t("orch.modelNone")} onPick={(model) => onSave({ ...v, model, effort: null })} />
          {(efforts.length > 0 || v.effort) && <Pick label={t("orch.effort")} value={v.effort} options={efforts.map((id) => ({ id }))} none={t("orch.effortNone")} onPick={(effort) => onSave({ ...v, effort })} />}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{h.provider ? t("orch.modelHintFile") : t("orch.modelHint")}</p>
    </div>
  );
}

// One block per harness a model can reach (claude, opencode). The choices are read by the bridge from
// each harness's own files when this opens — never polled.
export function RepoModelSettings({ repo }: { repo: string }) {
  const t = useT();
  const [hs, setHs] = useState<HarnessModel[] | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setHs(null);
    fetchRepoModels(repo, ac.signal)
      .then((r) => setHs(r.harnesses))
      .catch(() => {});
    return () => ac.abort();
  }, [repo]);

  async function save(kind: string, next: RepoModel) {
    try {
      const { value } = await setRepoModel(repo, kind, next);
      setHs((cur) => cur?.map((h) => (h.kind === kind ? { ...h, value } : h)) ?? cur);
      setStatus(t("orch.autoSaved"), "success", 2000);
    } catch (e) {
      setStatus(boardErrorMessage(e), "error", null);
    }
  }

  return hs?.map((h) => <Harness key={h.kind} h={h} onSave={(v) => void save(h.kind, v)} />) ?? null;
}
