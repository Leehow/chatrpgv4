#!/usr/bin/env python3
"""tests/play/persona_report.py -- the three-tier report of player-persona-suite-v1.

See docs/specs/player-persona-benchmark.md section 6. Three tiers, kept apart on purpose:

    receipts  computed here from .coc/campaigns/<id>/{turns/*.json,telemetry.jsonl}
    sidecar   the persona's own private_eval, aggregated -- printed as self-report
    judge     semantic questions, answered by a model with a turn citation

The judge is a tool-carrying pi agent (Agents.md: model work over text runs as an agent with
tools, not as a bare completion). It is handed a packet this file builds -- the transcript,
the receipts, the module's own truth, and the private hypotheses the Keeper never saw -- and
it writes `judgement.json` itself. Findings without a turn citation are dropped here, not
argued with.

    uv run --frozen python tests/play/persona_report.py run --run-dir .coc/benchmarks/<suite>/<run>
    uv run --frozen python tests/play/persona_report.py suite --suite-dir .coc/benchmarks/<suite>
    uv run --frozen python tests/play/persona_report.py compare --baseline <dir> --candidate <dir>

Only the standard library is used.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from persona_metrics import HARD_GATES, METRICS, judge_metrics, rate  # noqa: E402
from player import load_personas, seed_home  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
#: The judge probe: `deepseek-v4-flash` walked every turn and recorded eight cited findings
#: where `deepseek-v4-pro` recorded none from the same evidence, and it is several times faster
#: -- which matters when a suite has a hundred runs to judge.
DEFAULT_JUDGE_MODEL = "deepseek/deepseek-v4-flash"
JUDGE_TIMEOUT = 1800


# --------------------------------------------------------------------------
# tier A: receipts
# --------------------------------------------------------------------------

def driver_read(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    return rows


def admission_failed_turns(campaign: Path) -> set[int]:
    """Turns where the action review never answered (contract section 32.2).

    The Keeper is then told the batch cannot settle, and it says so to the player -- which a
    judge rightly reads as a refusal. Those turns are named by number here so a finding can be
    marked as co-occurring with an instrument failure. By turn number, never by matching words:
    which sentence counts as a refusal is a semantic question, and this repository does not
    answer those with phrase lists.
    """
    failed = set()
    for row in read_jsonl(campaign / "telemetry.jsonl"):
        if row.get("lane") == "admission" and row.get("ok") is False and isinstance(row.get("turn"), int):
            failed.add(row["turn"])
    return failed


def module_graph(campaign: Path) -> dict[str, Any]:
    meta = json.loads((campaign / "campaign.json").read_text(encoding="utf-8"))
    module_id = meta.get("module_id")
    for candidate in (REPO_ROOT / ".coc" / "modules" / str(module_id) / "module-graph.json",
                      REPO_ROOT / "content" / "starters" / str(module_id) / "module-graph.json"):
        if candidate.exists():
            return json.loads(candidate.read_text(encoding="utf-8"))
    return {"nodes": []}


def receipts_metrics(campaign: Path) -> dict[str, Any]:
    turns = [json.loads(p.read_text(encoding="utf-8"))
             for p in sorted((campaign / "turns").glob("*.json"))]
    telemetry = read_jsonl(campaign / "telemetry.jsonl")
    graph = module_graph(campaign)
    clue_nodes = [n for n in graph.get("nodes", []) if n.get("node_kind") == "clue"]

    played = [t for t in turns if t.get("turn")]
    receipts = [r for t in turns for r in (t.get("receipts") or [])]
    clue_receipts = [r for r in receipts if r.get("kind") == "clue"]
    seen: set[str] = set()
    duplicates = 0
    for receipt in clue_receipts:
        name = receipt.get("clue")
        if name in seen:
            duplicates += 1
        seen.add(name)

    rolls = [r for r in receipts if r.get("kind") == "roll"]
    resolve_turns = {t["turn"] for t in turns if any(
        r.get("kind") in ("roll", "dice") for r in (t.get("receipts") or []))}

    tool_rows = [r for r in telemetry if r.get("tool") and not r.get("event")]
    errored = [r for r in tool_rows if r.get("ok") is False]
    admission = [r for r in telemetry if r.get("lane") == "admission" and r.get("verdict")]
    verdicts: dict[str, int] = {}
    for row in admission:
        verdicts[row["verdict"]] = verdicts.get(row["verdict"], 0) + 1
    admission_ms = sorted(r["ms"] for r in admission if isinstance(r.get("ms"), (int, float)))
    director = [r for r in telemetry if r.get("lane") == "director"]
    offers = [r for r in telemetry if r.get("lane") == "offers"]
    offers_out = sum(len(r.get("offered") or []) for r in offers)
    offers_taken = sum(len(r.get("taken") or r.get("adopted") or []) for r in offers
                       if isinstance(r.get("taken") or r.get("adopted"), list))

    party = sorted((campaign / "party").glob("*.json"))
    sheet = json.loads(party[0].read_text(encoding="utf-8")) if party else {}
    skills = sheet.get("skills") or {}
    top_skills = {k for k, _ in sorted(
        ((k, v if isinstance(v, (int, float)) else (v or {}).get("value", 0))
         for k, v in skills.items()), key=lambda kv: kv[1], reverse=True)[:5]}
    best_rolls = [r for r in rolls if (r.get("skill") or "") in top_skills]

    meta = json.loads((campaign / "campaign.json").read_text(encoding="utf-8"))
    # Death lives in the engine, not in the prose: the sheet's conditions and current HP are
    # the record (a real table ended with `conditions: [... "dead"]` and `current_hp: 0`).
    conditions = set(sheet.get("conditions") or [])
    alive = None
    if sheet:
        alive = "dead" not in conditions and (sheet.get("current_hp") or 0) > 0

    return {
        "turns_played": len(played),
        "rules_layer_turns": len(resolve_turns - {0}),
        "info_gain_per_turn": round(len(clue_receipts) / len(played), 3) if played else None,
        "clue_reachability": (round(len(seen) / len(clue_nodes), 3) if clue_nodes else None),
        "clues_found": len(seen), "clues_in_module": len(clue_nodes),
        "duplicate_clue_rate": (round(duplicates / len(clue_receipts), 3) if clue_receipts else None),
        "kernel_error_rate": (round(len(errored) / len(tool_rows), 4) if tool_rows else None),
        "kernel_error_codes": sorted({r.get("code") for r in errored if r.get("code")}),
        "admission_verdicts": verdicts,
        "admission_refusal_rate": (round(sum(v for k, v in verdicts.items()
                                             if k not in ("authorized", "entailed", "not_player_action"))
                                         / sum(verdicts.values()), 4) if verdicts else None),
        "admission_ms_p90": (admission_ms[int(len(admission_ms) * 0.9) - 1] if admission_ms else None),
        "resource_receipts": sum(1 for r in receipts if r.get("kind") in ("time", "cash", "item")),
        # A resource change's receipt kind is `delta`; `change` is the name its *projection*
        # carries (section 16.2). Reading the receipt by its projected name counted zero wounds
        # in a run that ended with the investigator dead on the floor.
        "combat_receipts": sum(1 for r in receipts
                               if r.get("kind") == "delta" and r.get("resource") in ("hp", "san")),
        "combat_sessions": sum(1 for r in receipts if r.get("kind") == "session"
                               and r.get("family") == "combat" and r.get("transition") == "start"),
        "npc_ledger_moves": sum(1 for r in receipts if r.get("kind") == "npc"),
        "best_skill_success_rate": (round(sum(1 for r in best_rolls if r.get("passed")) / len(best_rolls), 3)
                                    if best_rolls else None),
        "director_adoption": (round(sum(1 for r in director if r.get("adopted")) / len(director), 3)
                              if director else None),
        "offers_taken": {"offered": offers_out, "taken": offers_taken},
        "tool_calls": len(tool_rows),
        "campaign_status": meta.get("status"),
        "investigator_alive": alive,
        "investigator_conditions": sorted(conditions),
    }


# --------------------------------------------------------------------------
# tier B: the player's own report on itself
# --------------------------------------------------------------------------

def sidecar_metrics(trace_rows: list[dict[str, Any]]) -> dict[str, Any]:
    evals = [row["private_eval"] for row in trace_rows
             if row.get("phase") == "play" and isinstance(row.get("private_eval"), dict)]
    def median(field: str) -> float | None:
        values = [e[field] for e in evals if isinstance(e.get(field), (int, float))]
        return round(statistics.median(values), 2) if values else None

    hypotheses = [str(e.get("current_hypothesis") or "").strip() for e in evals]
    changes = sum(1 for a, b in zip(hypotheses, hypotheses[1:]) if a and b and a != b)
    return {
        "self_report": True,
        "perceived_agency": median("perceived_agency"),
        "confusion": median("confusion"),
        "engagement": median("engagement"),
        "frustration": median("frustration"),
        "hypothesis_changes": changes,
        "hypothesis_confidence_final": (evals[-1].get("hypothesis_confidence") if evals else None),
        "turns_with_eval": len(evals),
    }


# --------------------------------------------------------------------------
# tier C: the judge lane
# --------------------------------------------------------------------------

JUDGE_INSTRUCTIONS = """\
You are auditing one recorded Call of Cthulhu session against a fixed list of questions. You
are not scoring the session and not giving an opinion about how good it was.

Everything you need is behind one tool in this directory. Read nothing else; the raw files
are large and reading them is not your job.

    python judge_tools.py questions          the questions you must answer
    python judge_tools.py turns              one line per turn, in order
    python judge_tools.py turn <n>           one turn in full: what the player sent, what the
                                             Keeper delivered, the receipts the kernel minted,
                                             and the player's private notes, which the Keeper
                                             never saw
    python judge_tools.py truth              the module's own truth: secrets, clues, NPCs
    python judge_tools.py truth --kind secret

Work like this:

1. `questions`, then `turns`, so you know what is being asked and what happened.
2. Go turn by turn with `turn <n>`. Consult `truth` whenever a question turns on what the
   module actually says.
3. For each turn where a question is genuinely exercised, record one finding:

    python judge_tools.py record --metric <id> --turn <n> --verdict ok|violation \
        --quote "<one sentence, copied exactly from that turn>" --why "<one short line>"

   `ok` means the turn exercised the question and the answer was the good one. `violation`
   means it exercised it and the answer was the bad one. Record one or the other whenever the
   turn gave the question any occasion at all: a turn where the Keeper could have refused and
   did not is an `ok` for hard_denial_rate, not a silence. Silence is only for a question that
   had no occasion to arise in that turn -- there is no third verdict called "not exercised as
   a violation".

The tool refuses a finding whose quote does not occur in that turn. That is deliberate: if
you cannot quote it, it did not happen. Do not work around the refusal -- find the real
sentence or drop the finding.

Judge what the record shows, not what you would have done. Absence of evidence is not a
violation. A player who guesses the truth is still guessing: the Keeper's job is to keep the
module's secrets until a receipt delivers them.

When you have been through every turn, say how many findings you recorded and stop.
"""


def build_judge_packet(run_dir: Path, campaign: Path, persona: dict[str, Any],
                       trace_rows: list[dict[str, Any]]) -> Path:
    turn_receipts = {}
    for path in sorted((campaign / "turns").glob("*.json")):
        record = json.loads(path.read_text(encoding="utf-8"))
        turn_receipts[record.get("turn")] = record.get("receipts") or []

    graph = module_graph(campaign)
    truth = [{"kind": n.get("node_kind"), "name": n.get("name"),
              "visibility": n.get("visibility"), "summary": n.get("summary")}
             for n in graph.get("nodes", [])
             if n.get("node_kind") in ("secret", "clue", "npc", "conclusion", "threat", "creature")]

    turns = []
    opening = next((r for r in trace_rows if r.get("phase") == "opening"), None)
    if opening:
        turns.append({"turn": 0, "player_message": None, "keeper_text": opening.get("text"),
                      "mechanics": [], "receipts": turn_receipts.get(0, []), "private_eval": None})
    for row in trace_rows:
        if row.get("phase") != "play" or not row.get("turn"):
            continue
        turns.append({
            "turn": row["turn"], "player_message": row.get("player_message"),
            "keeper_text": row.get("keeper_text"), "mechanics": row.get("mechanics") or [],
            "receipts": turn_receipts.get(row["turn"], []),
            "settle_class": row.get("settle_class"),
            "private_eval": row.get("private_eval") or {},
        })

    ids = list(dict.fromkeys(list(HARD_GATES) + list(persona["assertions"])))
    questions = [{"id": mid, "question": spec["question"],
                  "good_answer": ("ok means " + spec["summary"])}
                 for mid, spec in judge_metrics(ids)]

    packet = {
        "persona": {"id": persona["id"], "name": persona["name"], "summary": persona["summary"],
                    "probes": persona["probes"]},
        "questions": questions,
        "module_truth": truth,
        "turns": turns,
    }
    path = run_dir / "judge-packet.json"
    path.write_text(json.dumps(packet, ensure_ascii=False, indent=1), encoding="utf-8")
    return path


def run_judge(run_dir: Path, model: str) -> dict[str, Any]:
    """A pi agent with tools, in the run's own directory, writing its verdict file itself."""
    pi = REPO_ROOT / "node_modules" / ".bin" / "pi"
    provider, _, model_id = model.partition("/")
    (run_dir / "JUDGE.md").write_text(JUDGE_INSTRUCTIONS, encoding="utf-8")
    # The tools travel with the packet: a judge that has to reshape its own input spends its
    # context doing that and answers nothing (this lane's first two runs produced no findings
    # at all from a 39KB packet).
    shutil.copy2(Path(__file__).resolve().parent / "judge_tools.py", run_dir / "judge_tools.py")
    for stale in ("judgement.jsonl", "judge-refusals.jsonl"):
        (run_dir / stale).unlink(missing_ok=True)
    # `--thinking off` is not a preference: with thinking on, this lane produced no text and no
    # tool call at all, twice -- reasoning and the tool budget come out of the same output
    # allowance. Turned off, the same model reads every turn and answers every question.
    (run_dir / "judge-session").mkdir(exist_ok=True)
    home = seed_home(Path(tempfile.mkdtemp(prefix="persona-judge-")) / "home",
                     REPO_ROOT / ".pi" / "coc-agent")
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("PI_COC_", "PIPIUI_", "PI_CODING_AGENT_DIR"))}
    env["PI_CODING_AGENT_DIR"] = str(home)
    try:
        proc = subprocess.run(_judge_argv(pi, provider, model_id, run_dir), cwd=str(run_dir),
                              capture_output=True, text=True, timeout=JUDGE_TIMEOUT, env=env)
        first_pass = proc.stdout + "\n" + proc.stderr
        (run_dir / "judge-stdout.log").write_text(first_pass, encoding="utf-8")
    finally:
        shutil.rmtree(home.parent, ignore_errors=True)
    missed = uncovered_turns(run_dir)
    if missed:
        # The first pass samples: on a thirty-turn table it looked at ten turns and left a rate
        # with a denominator of one. A rate nobody can divide is worse than no rate, so the turns
        # it never opened are named back to it and it goes again over those alone.
        (run_dir / "JUDGE.md").write_text(
            JUDGE_INSTRUCTIONS + "\n\nSECOND PASS. You have already judged some turns. These you "
            "have not opened at all: " + ", ".join(str(t) for t in missed) + ". Open each one with "
            "`python judge_tools.py turn <n>` and record a finding for every question that turn "
            "exercises. If a turn exercises nothing, that is a real answer -- move on.\n",
            encoding="utf-8")
        subprocess.run(_judge_argv(pi, provider, model_id, run_dir), cwd=str(run_dir),
                       capture_output=True, text=True, timeout=JUDGE_TIMEOUT, env=env)

    path = run_dir / "judgement.jsonl"
    if not path.exists():
        return {"findings": [], "error": "the judge recorded no findings at all"}
    findings = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    refused = run_dir / "judge-refusals.jsonl"
    return {"findings": findings,
            "refused": len(refused.read_text(encoding="utf-8").splitlines()) if refused.exists() else 0,
            "cost": judge_cost(run_dir)}


def judge_cost(run_dir: Path) -> dict[str, Any]:
    """What the judge actually spent, read off its own session -- an audited lane, not an estimate."""
    totals = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "requests": 0}
    for path in (run_dir / "judge-session").glob("*.jsonl"):
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            usage = (row.get("message") or row if isinstance(row, dict) else {}).get("usage")
            if not isinstance(usage, dict):
                continue
            totals["requests"] += 1
            for key in ("input", "output", "cacheRead", "cacheWrite"):
                if isinstance(usage.get(key), (int, float)):
                    totals[key] += usage[key]
    return totals


def _judge_argv(pi: Path, provider: str, model_id: str, run_dir: Path) -> list[str]:
    return [str(pi), "-p", "--no-extensions", "--no-skills", "--no-prompt-templates",
            "--session-dir", str(run_dir / "judge-session"),
            "--no-context-files", "--approve", "--thinking", "off",
            "--tools", "read,write,edit,bash", "--provider", provider, "--model", model_id,
            "Follow JUDGE.md in this directory."]


def uncovered_turns(run_dir: Path) -> list[int]:
    """Turns the judge never recorded anything about -- not turns it cleared."""
    packet = json.loads((run_dir / "judge-packet.json").read_text(encoding="utf-8"))
    all_turns = [t["turn"] for t in packet["turns"]]
    seen = set()
    path = run_dir / "judgement.jsonl"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                seen.add(json.loads(line).get("turn"))
            except ValueError:
                continue
    return [t for t in all_turns if t not in seen]


def fold_judgement(judgement: dict[str, Any], turns_seen: set[int],
                   allowed: list[str], admission_failed: set[int] | None = None) -> dict[str, Any]:
    """Drop what cannot be cited, then count. The judge does not get to add metrics."""
    folded: dict[str, dict[str, Any]] = {}
    dropped = 0
    for finding in judgement.get("findings") or []:
        metric_id = finding.get("metric")
        turn = finding.get("turn")
        quote = (finding.get("quote") or "").strip()
        verdict = finding.get("verdict")
        if (metric_id not in allowed or metric_id not in METRICS
                or not isinstance(turn, int) or turn not in turns_seen
                or verdict not in ("ok", "violation") or not quote):
            dropped += 1
            continue
        bucket = folded.setdefault(metric_id, {"ok": 0, "violation": 0, "citations": [],
                                               "violations_while_review_unavailable": 0})
        bucket[verdict] += 1
        instrument = turn in (admission_failed or set())
        if verdict == "violation" and instrument:
            bucket["violations_while_review_unavailable"] += 1
        if verdict == "violation" or len(bucket["citations"]) < 3:
            bucket["citations"].append({"turn": turn, "verdict": verdict, "quote": quote[:400],
                                        "why": (finding.get("why") or "")[:300],
                                        **({"review_unavailable_this_turn": True} if instrument else {})})
    for metric_id, bucket in folded.items():
        bucket["rate"] = rate(metric_id, bucket["ok"], bucket["violation"])
        bucket["direction"] = METRICS[metric_id]["direction"]
    if dropped:
        folded["_dropped_findings"] = dropped
    return folded


# --------------------------------------------------------------------------
# the report
# --------------------------------------------------------------------------

#: A run that failed because the product never produced an investigator is a result, not a
#: broken instrument. The creation lane can follow a player who keeps asking instead of
#: choosing until the step budget runs out, narrating a whole unreceipted session on the way
#: (`pb-full-p02-natu-t3-74849Z`: twenty steps, no card, and the last ten turns called no tool
#: at all while telling the player "the card is still pending").
NO_CARD_SIGNATURE = "not ready_for_table"


def classify(record: dict[str, Any]) -> str:
    if record.get("status") != "invalid":
        return record.get("status") or "unknown"
    error = str(record.get("error") or "")
    if NO_CARD_SIGNATURE in error:
        return "no_card"
    if error.startswith("instrument-invalid") or "instrument-invalid" in error:
        return "instrument_invalid"
    return "invalid"


def build_report(run_dir: Path, *, judge: bool, judge_model: str) -> dict[str, Any]:
    # Absolute: the judge runs with this directory as its cwd, and a relative --session-dir was
    # resolved against it, burying the session under a copy of its own path.
    run_dir = run_dir.resolve()
    record = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
    campaign = REPO_ROOT / ".coc" / "campaigns" / record["campaign"]
    trace_rows = read_jsonl(run_dir / "trace.jsonl")
    personas = load_personas()
    persona = personas[record["persona"]]

    report: dict[str, Any] = {
        "persona": f"{persona['id']}_{persona['name']}", "lane": record["lane"],
        "trial": record["trial"], "run_id": record["run_id"],
        "method": "persona-benchmark", "acceptance": False,
        "status": classify(record), "raw_status": record.get("status"),
        "stop_reason": record.get("stop_reason"), "error": record.get("error"),
        "models": record.get("models"),
    }
    if not campaign.exists():
        report["error"] = "no campaign evidence; the run did not reach a table"
        return report

    receipts = receipts_metrics(campaign)
    report["receipts"] = receipts
    report["self_report"] = sidecar_metrics(trace_rows)

    if judge:
        build_judge_packet(run_dir, campaign, persona, trace_rows)
        judgement = run_judge(run_dir, judge_model)
        turns_seen = {row["turn"] for row in trace_rows if row.get("turn")} | {0}
        allowed = list(dict.fromkeys(list(HARD_GATES) + list(persona["assertions"])))
        report["judged"] = fold_judgement(judgement, turns_seen, allowed,
                                          admission_failed_turns(campaign))
        if judgement.get("refused"):
            report["judged"]["_refused_by_tool"] = judgement["refused"]
        if judgement.get("error"):
            report["judge_error"] = judgement["error"]
    else:
        report["judged"] = {}

    report["hard_gates"] = {gate: report["judged"].get(gate, {}).get("violation", 0)
                            for gate in HARD_GATES}
    report["outcome"] = {
        "turns": receipts["turns_played"],
        "ending": record.get("stop_reason"),
        "critical_clues_found": receipts["clues_found"],
        "critical_clues_total": receipts["clues_in_module"],
        "investigator_alive": receipts["investigator_alive"],
        "wall_seconds": record.get("wall_seconds"),
    }
    report["evidence"] = record.get("evidence")
    (run_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                                         encoding="utf-8")
    return report


def cmd_run(args: argparse.Namespace) -> int:
    report = build_report(Path(args.run_dir), judge=not args.no_judge, judge_model=args.judge_model)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def cmd_suite(args: argparse.Namespace) -> int:
    suite_dir = Path(args.suite_dir)
    run_dirs = sorted(p for p in suite_dir.iterdir() if (p / "run.json").exists())
    skip = {p.strip().upper() for p in (args.skip_personas or "").split(",") if p.strip()}
    if skip:
        kept = []
        for run_dir in run_dirs:
            record = driver_read(run_dir / "run.json")
            if (record.get("persona") or "").upper() in skip or record.get("status") != "completed":
                continue
            kept.append(run_dir)
        print(f"judging {len(kept)} of {len(run_dirs)} runs (skipping personas {sorted(skip)} "
              f"and runs that did not complete)", file=sys.stderr)
        run_dirs = kept
    reports: list[dict[str, Any]] = []
    # The judge lane is one agent per run; a hundred of them in series is most of a day, and
    # they share nothing but the model endpoint.
    workers = 1 if args.no_judge else max(1, int(args.judge_concurrency))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(build_report, run_dir, judge=not args.no_judge,
                               judge_model=args.judge_model): run_dir for run_dir in run_dirs}
        for future in concurrent.futures.as_completed(futures):
            run_dir = futures[future]
            try:
                reports.append(future.result())
            except Exception as exc:  # noqa: BLE001 -- one unreadable run does not lose the suite
                reports.append({"run_id": run_dir.name, "status": "invalid",
                                "error": f"{type(exc).__name__}: {exc}"})
                print(f"{run_dir.name}: report failed: {exc}", file=sys.stderr)
    reports.sort(key=lambda r: (r.get("persona") or "", r.get("lane") or "", r.get("trial") or 0))
    summary = {
        "method": "persona-benchmark", "acceptance": False,
        "suite_dir": str(suite_dir), "runs": len(reports),
        "note": "no overall average is computed on purpose: what matters is which persona regressed",
        "by_persona": {},
    }
    for report in reports:
        key = f"{report['persona']}/{report['lane']}"
        summary["by_persona"].setdefault(key, []).append({
            "trial": report.get("trial"), "status": report.get("status"),
            "hard_gates": report.get("hard_gates"),
            "receipts": {k: report.get("receipts", {}).get(k) for k in
                         ("turns_played", "clue_reachability", "rules_layer_turns",
                          "stalled_turns", "kernel_error_rate")},
            "judged": {k: v.get("rate") for k, v in (report.get("judged") or {}).items()
                       if isinstance(v, dict)},
            "self_report": report.get("self_report"),
        })
    (suite_dir / "suite-report.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def cmd_table(args: argparse.Namespace) -> int:
    """The readable form of a suite report: one row per persona and lane.

    No overall average is printed here either. A single number over eighteen personas is
    exactly the thing that hides "the Director got smoother on the main line and started
    railroading the players who leave it".
    """
    summary = json.loads((Path(args.suite_dir) / "suite-report.json").read_text(encoding="utf-8"))
    by_persona = summary["by_persona"]
    judged_ids = sorted({m for runs in by_persona.values() for run in runs
                         for m in (run.get("judged") or {}) if m in METRICS})
    columns = [m for m in judged_ids if METRICS[m]["tier"] == "judge"][: args.max_metrics]

    width = max(len(k) for k in by_persona) + 2 if by_persona else 34
    header = (f"{'persona / lane':<{width}}{'runs':>5}{'turns':>7}{'clues':>7}{'gates':>7}"
              + "".join(f"{m[:14]:>16}" for m in columns))
    print(f"suite: {summary['suite_dir']}")
    print("method: persona-benchmark -- not acceptance (Agents.md's real table is unchanged)")
    print(header)
    print("-" * len(header))
    for key in sorted(by_persona):
        runs = by_persona[key]
        def med(pick) -> str:
            values = [v for v in (pick(r) for r in runs) if isinstance(v, (int, float))]
            return f"{statistics.median(values):.2f}".rstrip("0").rstrip(".") if values else "-"
        # A gate count of zero must not be printable when nothing was judged: unmeasured and
        # clean look identical otherwise, and the first reader will take it for clean.
        judged_any = any(r.get("judged") for r in runs)
        gates = (sum(sum((r.get("hard_gates") or {}).values()) for r in runs)
                 if judged_any else "-")
        row = (f"{key:<{width}}{len(runs):>5}"
               f"{med(lambda r: r['receipts'].get('turns_played')):>7}"
               f"{med(lambda r: r['receipts'].get('clue_reachability')):>7}"
               f"{str(gates):>7}")
        for metric_id in columns:
            row += f"{med(lambda r, m=metric_id: (r.get('judged') or {}).get(m)):>16}"
        print(row)
    print()
    print("gates = hard-gate violations (secret leak, state corruption, rules P0, inner life). "
          "Any number here is a defect, not a score; `-` means the judge lane did not run, "
          "which is not the same as clean.")
    for metric_id in columns:
        print(f"  {metric_id}: {METRICS[metric_id]['summary']} "
              f"({'higher' if METRICS[metric_id]['direction'] == 'higher_is_better' else 'lower'} is better)")
    return 0


def cmd_compare(args: argparse.Namespace) -> int:
    def load(path: Path) -> dict[str, Any]:
        return json.loads((path / "suite-report.json").read_text(encoding="utf-8"))["by_persona"]

    baseline, candidate = load(Path(args.baseline)), load(Path(args.candidate))
    rows = []
    for key in sorted(set(baseline) | set(candidate)):
        for metric_id in sorted({m for side in (baseline.get(key, []), candidate.get(key, []))
                                 for run in side for m in (run.get("judged") or {})}):
            def mean(side: list[dict]) -> float | None:
                values = [run["judged"][metric_id] for run in side
                          if isinstance(run.get("judged", {}).get(metric_id), (int, float))]
                return round(statistics.mean(values), 4) if values else None
            before, after = mean(baseline.get(key, [])), mean(candidate.get(key, []))
            if before is None or after is None:
                continue
            direction = METRICS[metric_id]["direction"]
            delta = after - before
            better = delta > 0 if direction == "higher_is_better" else delta < 0
            rows.append({"persona": key, "metric": metric_id, "baseline": before,
                         "candidate": after, "delta": round(delta, 4),
                         "regressed": (not better) and abs(delta) >= float(args.threshold)})
    rows.sort(key=lambda r: (not r["regressed"], -abs(r["delta"])))
    print(json.dumps({"method": "persona-benchmark", "acceptance": False,
                      "regressions": [r for r in rows if r["regressed"]],
                      "all": rows}, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="persona_report.py", description="player-persona-suite-v1 report")
    sub = p.add_subparsers(dest="subcommand", required=True)
    for name, func, needs in (("run", cmd_run, "--run-dir"), ("suite", cmd_suite, "--suite-dir")):
        sp = sub.add_parser(name)
        sp.add_argument(needs, required=True, dest=needs.lstrip("-").replace("-", "_"))
        sp.add_argument("--no-judge", action="store_true", help="tiers A and B only; spend nothing")
        sp.add_argument("--judge-model", default=DEFAULT_JUDGE_MODEL)
        sp.add_argument("--skip-personas", default=None,
                        help="comma-separated persona ids to leave unjudged (e.g. runs starved of "
                             "quota); incomplete runs are skipped with them")
        sp.add_argument("--judge-concurrency", type=int, default=8,
                        help="judges to run at once when judging a whole suite (default 8)")
        sp.set_defaults(func=func)
    sp = sub.add_parser("table", help="render a finished suite report as a per-persona table")
    sp.add_argument("--suite-dir", required=True)
    sp.add_argument("--max-metrics", type=int, default=6)
    sp.set_defaults(func=cmd_table)

    sp = sub.add_parser("compare")
    sp.add_argument("--baseline", required=True)
    sp.add_argument("--candidate", required=True)
    sp.add_argument("--threshold", default=0.05)
    sp.set_defaults(func=cmd_compare)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
