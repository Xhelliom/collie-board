#!/usr/bin/env python3
"""Où part le quota — mesure par poste, par fenêtre. Règles : docs/dev/couts-2026-11.md § Méthode."""
import glob, json, os, sqlite3, statistics, sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta

HOME = os.path.expanduser("~")
STATE = f"{HOME}/.local/state/collie-board"
WT = f"{HOME}/.herdr/worktrees/"
TZ = timezone(timedelta(hours=1))
def d(s): return datetime.fromisoformat(s).replace(tzinfo=TZ)
WINDOWS = {
    "avant2s": (d("2026-11-05"), d("2026-11-19T22:00")),  # la mesure d'origine (contrôle)
    "avant": (d("2026-11-12T22:00"), d("2026-11-19T22:00")),  # la semaine juste avant les freins
    "apres": (d("2026-11-20"), d("2026-11-27")),
}
MARK = "Tu es l'orchestrateur du projet"
REVIEW = "You review the work on ONE card"

db = sqlite3.connect(sys.argv[1])
cards = {}  # (repo basename, branch slug) -> (title, run_id)
for title, repo, branch, run in db.execute("select title, repo_path, branch, run_id from card where branch is not null"):
    cards[(os.path.basename(repo or ""), branch.replace("/", "-"))] = (title, run)

def weighted(t): return t[0] + 1.25 * t[1] + 0.1 * t[2] + 5 * t[3]
def model_of(m):
    for k in ("opus", "sonnet", "fable", "haiku"):
        if k in m: return k
    return "autre"

def user_text(row):
    c = row.get("message", {}).get("content")
    if isinstance(c, str): return c
    if isinstance(c, list):
        return "\n".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text")
    return ""

def sub_of(text, first):
    if first: return "travail"
    if "has marked this task finished" in text: return "fin"
    if "check" in text and "failed on your PR" in text: return "relance"
    if "gate" in text and "failed" in text: return "relance"
    if "Opening a PR" in text or "conflict" in text.lower(): return "integration"
    return "suivi"

calls = {}  # (msg id, request id) -> record ; newest row wins
starts = defaultdict(list)  # window -> [start context of a card session]
since = WINDOWS["avant2s"][0].timestamp() - 86400
for path in glob.glob(f"{HOME}/.claude/projects/**/*.jsonl", recursive=True):
    if os.path.getmtime(path) < since: continue
    try: lines = open(path, encoding="utf-8", errors="replace").read().split("\n")
    except OSError: continue
    is_orch = any(MARK in l for l in lines[:400])
    is_review = any(REVIEW in l for l in lines[:50])
    is_sub = "/subagents/" in path
    first_seen, sub, first_call = False, "travail", True
    for l in lines:
        if not l: continue
        try: row = json.loads(l)
        except ValueError: continue
        if row.get("type") == "user" and not row.get("isMeta"):
            t = user_text(row)
            if t.strip() and not t.startswith("<"):
                sub = sub_of(t, not first_seen); first_seen = True
        if row.get("type") != "assistant": continue
        m = row.get("message") or {}
        u, model = m.get("usage"), m.get("model", "")
        if not u or not isinstance(model, str) or model.startswith("<"): continue
        ts = datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
        cwd = row.get("cwd") or ""
        tok = (u.get("input_tokens") or 0, u.get("cache_creation_input_tokens") or 0,
               u.get("cache_read_input_tokens") or 0, u.get("output_tokens") or 0)
        # poste
        if cwd.startswith(f"{STATE}/lead"): poste, repo = "lead", "collie-board"
        elif cwd.startswith(f"{STATE}/copilot"): poste, repo = "copilote", "collie-board"
        elif cwd.startswith(WT):
            parts = cwd[len(WT):].split("/")
            repo = parts[0]; card = cards.get((repo, parts[1] if len(parts) > 1 else ""))
            if not card: poste = "manuel-worktree"
            elif is_review: poste = "reviewer"
            elif "mesur" in card[0].lower(): poste = "mesure"
            else: poste = "carte:" + sub
        else:
            repo = os.path.basename(cwd.rstrip("/")) or "?"
            poste = "orchestrateur" if is_orch else "manuel-racine"
        key = (m.get("id") or f"{path}#{len(calls)}", row.get("requestId"))
        calls[key] = (ts, poste, repo, model_of(model), tok)
        if first_call and not is_sub and poste.startswith("carte:") and sub == "travail":
            for w, (a, b) in WINDOWS.items():
                if a <= ts < b: starts[w].append(tok[0] + tok[1] + tok[2])
        first_call = False

out = {}
for w, (a, b) in WINDOWS.items():
    agg = defaultdict(lambda: [0, 0.0, 0, []])  # brut, pondéré, appels, contextes
    for ts, poste, repo, model, tok in calls.values():
        if not (a <= ts < b): continue
        for k in (("poste", poste), ("repo", repo), ("model", model),
                  ("board_model", model if not poste.startswith("manuel") else None),
                  ("cb_poste", poste if repo == "collie-board" or poste in ("lead", "copilote") else None),
                  ("model_poste", f"{poste.split(':')[0]}/{model}")):
            if k[1] is None: continue
            g = agg[k]; g[0] += sum(tok); g[1] += weighted(tok); g[2] += 1; g[3].append(tok[0] + tok[1] + tok[2])
    days = (b - a).total_seconds() / 86400
    out[w] = {"days": days, "starts_median": statistics.median(starts[w]) if starts[w] else None,
              "starts_n": len(starts[w]),
              "rows": {f"{k[0]}|{k[1]}": {"brut": g[0], "pond": round(g[1]), "appels": g[2],
                                          "ctx_med": statistics.median(g[3])} for k, g in agg.items()}}
json.dump(out, sys.stdout, indent=1)
