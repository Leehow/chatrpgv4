#!/usr/bin/env python3
"""tests/play/forward_only_probe.py -- seeded Keeper probes for contract §158 (FR-04 / FR-05 of
docs/specs/forward-only-reconciliation-tickets.md).

Each case lays a campaign of the haunting out with the emitted kernel in the shape of a turn of the installed
App's Dust to Dust table, then hands the table to the product -- `tests/play/driver.py`, `bin/pi-coc`, the hybrid
engine, the live Keeper -- for one player sentence. What the kernel recorded is checked directly; what the Keeper
wrote is judged by a tool-enabled `pi -p` judge (never a word list), whose verdicts must quote the delivery.

Cases (outcomes pre-registered in PASS_RULES, written to the run directory before any trial):
    told-position    turn 26/27: turn 2 told the player they reached the Corbitt house and nothing moved them; the
                     review recorded the owed arrival. The player acts at the gate. PASS: the first receipt is the
                     owed move, the delivery continues at the house, and no sentence corrects, retracts or apologises.
    dispute          turn 28: the ledger's version (the Hall of Records) was delivered after the arrival; the player
                     disputes it and asks to be at the house. PASS: the party ends at the house, the delivery
                     follows the player, and no sentence apologises or admits a mistake.
    service-outage   turn 23: the action review is unavailable (its lane model does not exist) while the player pays a
                     fee. PASS: an admission refusal happened, no sentence tells the player the table or a service
                     could not settle or asks them to repeat, and the story carries on. INCONCLUSIVE when the Keeper
                     wrote nothing the review had to judge.

Live model calls, Mac only. Credentials come from the source-mode agent home (`.pi/coc-agent`) and the App's vault
(the Jev key), and are never printed. Stdlib only; run with `uv run --frozen python tests/play/forward_only_probe.py`.

    run    --case <name|all> [--trials 2] [--model grok-build/grok-4.5] [--thinking low] [--judge opencode-go/deepseek-v4.1-flash]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DRIVER = REPO_ROOT / "tests" / "play" / "driver.py"
KERNEL = REPO_ROOT / "build" / "kernel" / "rpc.mjs"
AGENT_HOME = REPO_ROOT / ".pi" / "coc-agent"
MODULE, PREGEN = "the-haunting", "thomas-hayes"
HOUSE, RECORDS, MORGUE = "corbitt-house-ground", "hall-of-records", "newspaper-morgue"
TOLD = "你开车穿过城区，把车停在科比特宅门前。"
JUDGE_TIMEOUT = 600

PASS_RULES = {
    "told-position": "the first receipt of the tested turn is a move landing the owed row to corbitt-house-ground; "
                     "judge: place == told and correction == no",
    "dispute": "the party ends the tested turn at corbitt-house-ground; judge: follows == yes and confession == no",
    "service-outage": "an admission row with ok:false for the Keeper's batch; judge: service == no and fiction == yes "
                      "(INCONCLUSIVE when no admission refusal happened)",
}


def kernel_steps(home: Path, campaign: str, steps: list[tuple[str, dict]]) -> list:
    """The emitted kernel, one request per line, the same way the extension tests prepare a workspace."""
    lines = "\n".join(json.dumps({"id": str(i), "method": m, "params": {"campaign": campaign, **p}}, ensure_ascii=False)
                      for i, (m, p) in enumerate(steps))
    run = subprocess.run(["node", str(KERNEL), "--workspace", str(home), "--content", str(REPO_ROOT / "content")],
                         input=lines + "\n", capture_output=True, text=True, cwd=str(REPO_ROOT), timeout=300)
    frames = [json.loads(line) for line in run.stdout.splitlines() if line.strip()]
    frames = [frame for frame in frames if not frame.get("progress")]
    for frame in frames:
        if not frame.get("ok"):
            raise RuntimeError(f"kernel step {frame.get('id')} ({steps[int(frame.get('id', 0))][0]}) failed: {json.dumps(frame.get('error'), ensure_ascii=False)[:600]}")
    return [frame.get("result") for frame in frames]


def campaign_dir(home: Path, campaign: str) -> Path:
    return home / ".coc" / "campaigns" / campaign


def forward_fix() -> str:
    """The kernel's own `owed_state` fix, read from its source so the seeded row says what table.warn would."""
    source = (REPO_ROOT / "kernel-ts" / "memory" / "index.ts").read_text(encoding="utf-8")
    start = source.index("owed_state: '") + len("owed_state: '")
    return source[start:source.index("'", start)]


def seed_owed(home: Path, campaign: str, turn: int) -> None:
    """What `table.warn` writes for an owed-capable review of `turn` (contract §158.3): the row on the record, in
    owed.json, and its forward-pointing warning. The review path itself is probed by owed-review-probe.mjs."""
    directory = campaign_dir(home, campaign)
    record_path = directory / "turns" / f"{turn:04d}.json"
    record = json.loads(record_path.read_text(encoding="utf-8"))
    row = {"name": f"t{turn}-owed-1", "turn": turn, "kind": "move",
           "effect": {"kind": "move", "to": HOUSE, "via": "Drove across town to the Corbitt house.", "travel_minutes": 30},
           "quote": TOLD, "what": "arrival at The Corbitt House (corbitt-house-ground), via: Drove across town to the Corbitt house.",
           "job": "0" * 64, "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "travel": "local_travel"}
    record["owed"] = [row]
    record.setdefault("warnings", []).append({"lane": "continuity-review", "kind": "owed_state", "quote": TOLD, "why": row["what"],
                                              "owed": row["name"], "fix": forward_fix(), "at": row["at"]})
    record["continuity_review"] = {"mode": "post", "reviewed": True, "verdict": "revise", "job": "0" * 64, "warnings": 1, "at": row["at"]}
    record_path.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    (directory / "owed.json").write_text(json.dumps({"open": [row], "closed": []}, ensure_ascii=False), encoding="utf-8")


def open_steps(campaign: str) -> list[tuple[str, dict]]:
    return [("campaign.create", {"id": campaign, "module": MODULE, "pregen": PREGEN, "play_language": "zh-Hans"}), ("table.open", {})]


def to_the_house_untold(campaign: str) -> list[tuple[str, dict]]:
    """Turn 1 at the Hall of Records; turn 2 tells the arrival at the house and lands no move (turn 26's shape)."""
    return open_steps(campaign) + [
        ("table.player_input", {"text": "我去档案馆查旧案。"}),
        ("table.apply", {"call_id": "t1-c1", "effects": [{"kind": "clue", "clue": "knott-research-leads", "how": "Knott named the places"},
                                                         {"kind": "move", "to": RECORDS},
                                                         {"kind": "flag", "name": "records-serious-crime-destination-known", "value": True}]}),
        ("table.narrate", {"call_id": "t1-c2", "text": "档案员把一摞发黄的卷宗推到你面前，指了指走廊尽头的法院方向。"}),
        ("table.player_input", {"text": "我开车去科比特宅。"}),
        ("table.narrate", {"call_id": "t2-c1", "text": f"{TOLD}铁门半开着，门后的小径上落满了枯叶。"}),
    ]


def prepare(case: str, home: Path, campaign: str) -> dict:
    if case == "told-position":
        kernel_steps(home, campaign, to_the_house_untold(campaign))
        seed_owed(home, campaign, 2)
        return {"turn": 3, "line": "我推开铁门，蹲在小径旁，看看地上有没有脚印。", "env": [], "previous": [2]}
    if case == "dispute":
        kernel_steps(home, campaign, to_the_house_untold(campaign) + [
            ("table.player_input", {"text": "我推开铁门，蹲在小径旁看看地上的脚印。"}),
            ("table.narrate", {"call_id": "t3-c1", "text": "档案员抬起头，把那摞卷宗又往你面前推了推。你仍站在档案馆的柜台前，窗外天色渐暗。"}),
        ])
        return {"turn": 4, "line": "等等，我刚才明明已经开车到了科比特宅门口，怎么又回到档案馆了？我就在宅子门口，推开铁门看看小径。",
                "env": [], "previous": [2, 3]}
    if case == "service-outage":
        kernel_steps(home, campaign, open_steps(campaign) + [
            ("table.player_input", {"text": "我去报社资料室查旧报纸。"}),
            ("table.apply", {"call_id": "t1-c1", "effects": [{"kind": "clue", "clue": "knott-research-leads", "how": "Knott named the places"},
                                                             {"kind": "move", "to": MORGUE}]}),
            ("table.narrate", {"call_id": "t1-c2", "text": "资料室的管理员从柜台后抬起头，问你要查哪一年的报纸，查阅要付两毛五分钱。"}),
        ])
        return {"turn": 2, "line": "我把两毛五分钱的查阅费放在柜台上，请管理员把一八八〇年代关于科比特宅的旧报纸找出来。",
                "env": ["PI_COC_ADMISSION_MODEL=opencode-go/no-such-model-for-probe", "PI_COC_ADMISSION_FAST_MIN_CONFIDENCE=off"], "previous": [1]}
    raise SystemExit(f"unknown case {case}")


QUESTIONS = {
    "told-position": [
        {"id": "place", "answers": ["told", "elsewhere"],
         "question": "Where is the investigator in the delivery under judgement? 'told' if it continues at the Corbitt house, "
                     "where the previous delivery said they had pulled up; 'elsewhere' if it puts them anywhere else."},
        {"id": "correction", "answers": ["yes", "no"],
         "question": "Does any sentence of the delivery under judgement correct, retract or contradict what an earlier delivery "
                     "told the player, apologise, admit a mistake, or step out of the story to explain the table, its records, "
                     "the rules or a service? Quote the sentence when yes."},
    ],
    "dispute": [
        {"id": "follows", "answers": ["yes", "no"],
         "question": "The player disputed where they were and said they are at the Corbitt house gate. Does the delivery under "
                     "judgement follow the player: at its end, are they at or going through the Corbitt house gate?"},
        {"id": "confession", "answers": ["yes", "no"],
         "question": "Does any sentence of the delivery under judgement apologise, admit that the table, the Keeper, the records "
                     "or a system made a mistake, or step out of the story to explain one? Quote the sentence when yes."},
    ],
    "service-outage": [
        {"id": "service", "answers": ["yes", "no"],
         "question": "Does any sentence of the delivery under judgement tell the player that the table, the records, the "
                     "bookkeeping, a review, a service or the system could not settle or process something, ask them to "
                     "say or send their action again, or otherwise step out of the story? Quote the sentence when yes."},
        {"id": "fiction", "answers": ["yes", "no"],
         "question": "Does the delivery under judgement carry the scene on in the story (the place and the people in it go "
                     "on), rather than only stopping or waiting?"},
    ],
}

JUDGE_MD = """# Judge one delivery of a tabletop horror game

You judge one delivery a game master (the Keeper) wrote to the player, against the questions in packet.json. The
packet holds what the player was told on the turns before (`earlier`), what the player said (`player`), and the
delivery under judgement (`delivery`). The story is in Chinese; judge its meaning, not its style.

Read packet.json with the read tool, then write verdict.json with the write tool, exactly:

{"answers": [{"id": "<question id>", "answer": "<one of that question's answers>", "quote": "<exact sentence from delivery, or empty>", "why": "<one English sentence>"}]}

One answer per question, in order. When an answer says something is wrong (a correction, an apology, a service notice,
somewhere else), `quote` must be a sentence copied exactly from `delivery`. Write nothing else, then stop.
"""


def normalise(text: str) -> str:
    return "".join(unicodedata.normalize("NFKC", text).split())


def judge(case: str, run_dir: Path, earlier: list[dict], player: str, delivery: str, model: str) -> dict:
    out = run_dir / "judge"
    out.mkdir(parents=True, exist_ok=True)
    (out / "packet.json").write_text(json.dumps({"questions": QUESTIONS[case], "earlier": earlier, "player": player, "delivery": delivery},
                                                ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "JUDGE.md").write_text(JUDGE_MD, encoding="utf-8")
    (out / "verdict.json").unlink(missing_ok=True)
    home = Path(tempfile.mkdtemp(prefix="forward-only-judge-")) / "home"
    home.mkdir(parents=True)
    for name in ("auth.json", "models.json", "models-store.json"):
        if (AGENT_HOME / name).is_file():
            shutil.copy2(AGENT_HOME / name, home / name)
    (home / "settings.json").write_text(json.dumps({"quietStartup": True}), encoding="utf-8")
    provider, _, model_id = model.partition("/")
    env = {k: v for k, v in os.environ.items() if not k.startswith(("PI_COC_", "PIPIUI_", "PI_CODING_AGENT_DIR", "TYPESAFE"))}
    env["PI_CODING_AGENT_DIR"] = str(home)
    argv = [str(REPO_ROOT / "node_modules" / ".bin" / "pi"), "-p", "--no-extensions", "--no-skills", "--no-prompt-templates",
            "--session-dir", str(out / "session"), "--no-context-files", "--approve", "--thinking", "off",
            "--tools", "read,write", "--provider", provider, "--model", model_id, "Follow JUDGE.md in this directory."]
    try:
        proc = subprocess.run(argv, cwd=str(out), capture_output=True, text=True, timeout=JUDGE_TIMEOUT, env=env, stdin=subprocess.DEVNULL)
        (out / "judge-stdout.log").write_text(proc.stdout + "\n" + proc.stderr, encoding="utf-8")
    finally:
        shutil.rmtree(home.parent, ignore_errors=True)
    path = out / "verdict.json"
    if not path.is_file():
        return {"ok": False, "reason": "no_verdict"}
    try:
        answers = json.loads(path.read_text(encoding="utf-8")).get("answers", [])
    except json.JSONDecodeError:
        return {"ok": False, "reason": "bad_json"}
    table, problems = {}, []
    for question in QUESTIONS[case]:
        found = next((a for a in answers if isinstance(a, dict) and a.get("id") == question["id"]), None)
        if not found or found.get("answer") not in question["answers"]:
            problems.append(f"{question['id']}: missing or not one of {question['answers']}")
            continue
        quote = str(found.get("quote") or "")
        if quote and normalise(quote) not in normalise(delivery):
            problems.append(f"{question['id']}: quote not in the delivery")
        table[question["id"]] = {"answer": found["answer"], "quote": quote, "why": str(found.get("why") or "")}
    return {"ok": not problems, "answers": table, "problems": problems}


def driver(*args: str, env: dict, timeout: float = 600) -> subprocess.CompletedProcess:
    return subprocess.run(["uv", "run", "--frozen", "python", str(DRIVER), *args], cwd=str(REPO_ROOT), env=env,
                          capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)


def jev_key() -> str:
    script = "import {readVaultSecret} from './experiments/single-loop-routing/vault.mjs'; process.stdout.write(readVaultSecret('EXT_JEV_APIKEY') ?? '');"
    return subprocess.run(["node", "--input-type=module", "-e", script], cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=30).stdout.strip()


def verdict_of(case: str, checks: dict, judged: dict) -> str:
    answers = {k: v["answer"] for k, v in (judged.get("answers") or {}).items()}
    if not judged.get("ok"):
        return "JUDGE_FAILED"
    if case == "told-position":
        return "PASS" if checks["owed_move_first"] and answers.get("place") == "told" and answers.get("correction") == "no" else "FAIL"
    if case == "dispute":
        return "PASS" if checks["ends_at_house"] and answers.get("follows") == "yes" and answers.get("confession") == "no" else "FAIL"
    if not checks["admission_refused"]:
        return "INCONCLUSIVE"
    return "PASS" if answers.get("service") == "no" and answers.get("fiction") == "yes" else "FAIL"


def trial(case: str, n: int, root: Path, args: argparse.Namespace, key: str) -> dict:
    stamp = datetime.now(timezone.utc).strftime("%H%M%S")
    campaign, run_id = f"fo-{case}-{stamp}-{n}", f"fo-{case}-{stamp}-{n}"
    run_dir = root / f"{case}-{n}"
    run_dir.mkdir(parents=True, exist_ok=True)
    home = run_dir / "home"
    home.mkdir(exist_ok=True)
    setup = prepare(case, home, campaign)
    env = {**os.environ, "PI_COC_HOME": str(home), "TYPESAFE_API_KEY": key}
    start = ["start", "--campaign", campaign, "--run", run_id, "--model", args.model, "--thinking", args.thinking,
             "--expect-engine", "hybrid-v1", "--no-default-run"]
    for pair in setup["env"]:
        start += ["--env", pair]
    began = time.time()
    started = driver(*start, env=env, timeout=180)
    (run_dir / "driver-start.log").write_text(started.stdout + "\n" + started.stderr, encoding="utf-8")
    if started.returncode != 0:
        return {"case": case, "trial": n, "verdict": "START_FAILED", "detail": (started.stderr or started.stdout)[-600:]}
    played = driver("turn", setup["line"], "--run", run_id, "--timeout", "480", env=env, timeout=540)
    (run_dir / "driver-turn.log").write_text(played.stdout + "\n" + played.stderr, encoding="utf-8")
    driver("stop", "--run", run_id, env=env, timeout=120)
    directory = campaign_dir(home, campaign)
    record_path = directory / "turns" / f"{setup['turn']:04d}.json"
    if not record_path.is_file():
        return {"case": case, "trial": n, "verdict": "NO_RECORD", "wall_s": round(time.time() - began, 1), "driver_exit": played.returncode}
    record = json.loads(record_path.read_text(encoding="utf-8"))
    world = json.loads((directory / "world.json").read_text(encoding="utf-8"))
    telemetry = [json.loads(line) for line in (directory / "telemetry.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    receipts = record.get("receipts") or []
    admissions = [row for row in telemetry if row.get("lane") == "admission" and row.get("turn") == setup["turn"]]
    checks = {
        "first_receipt": {k: receipts[0].get(k) for k in ("kind", "to", "owed", "told_turn")} if receipts else None,
        "owed_move_first": bool(receipts) and receipts[0].get("kind") == "move" and receipts[0].get("owed") == f"t2-owed-1" and receipts[0].get("to") == HOUSE,
        "moves": [r.get("to") for r in receipts if r.get("kind") == "move"],
        "ends_at_house": world.get("active_scene") == HOUSE,
        "admission_refused": any(row.get("ok") is False for row in admissions),
        "admission_rows": [{k: row.get(k) for k in ("ok", "path", "reason", "verdict", "reviewer")} for row in admissions][:6],
        "owed_ledger": json.loads((directory / "owed.json").read_text(encoding="utf-8")) if (directory / "owed.json").is_file() else None,
    }
    earlier = []
    for turn in setup["previous"]:
        prior = json.loads((directory / "turns" / f"{turn:04d}.json").read_text(encoding="utf-8"))
        earlier.append({"turn": turn, "player": prior.get("player_text"), "keeper": prior.get("rendered_text")})
    delivery = record.get("rendered_text") or ""
    judged = judge(case, run_dir, earlier, setup["line"], delivery, args.judge)
    result = {"case": case, "trial": n, "campaign": campaign, "run": run_id, "wall_s": round(time.time() - began, 1),
              "driver_exit": played.returncode, "delivery": delivery, "checks": checks, "judge": judged,
              "verdict": verdict_of(case, checks, judged)}
    (run_dir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="forward_only_probe.py")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run")
    run.add_argument("--case", default="all", choices=["all", *PASS_RULES])
    run.add_argument("--trials", type=int, default=2)
    run.add_argument("--model", default="grok-build/grok-4.5")
    run.add_argument("--thinking", default="low")
    run.add_argument("--judge", default="opencode-go/deepseek-v4.1-flash")
    run.add_argument("--out", default=None)
    args = parser.parse_args(argv)
    if not KERNEL.is_file():
        raise SystemExit("build/kernel/rpc.mjs is missing: build (remote-test.sh build-fetch) first")
    key = jev_key()
    if not key:
        raise SystemExit("no Jev key in the App vault")
    root = Path(args.out) if args.out else REPO_ROOT / ".coc" / "playtests" / f"forward-only-probe-{datetime.now().strftime('%Y%m%dT%H%M%S')}"
    root.mkdir(parents=True, exist_ok=True)
    (root / "preregistered.json").write_text(json.dumps({"rules": PASS_RULES, "model": args.model, "thinking": args.thinking, "judge": args.judge},
                                                        ensure_ascii=False, indent=1), encoding="utf-8")
    cases = list(PASS_RULES) if args.case == "all" else [args.case]
    results = []
    for case in cases:
        for n in range(1, args.trials + 1):
            result = trial(case, n, root, args, key)
            results.append(result)
            print(json.dumps({k: result.get(k) for k in ("case", "trial", "verdict", "wall_s")}, ensure_ascii=False), flush=True)
    summary = {case: [r["verdict"] for r in results if r["case"] == case] for case in cases}
    (root / "summary.json").write_text(json.dumps({"summary": summary, "results": results}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"out": str(root), "summary": summary}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
