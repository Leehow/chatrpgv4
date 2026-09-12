#!/usr/bin/env python3
"""tests/play/bench.py -- the concurrent runner of player-persona-suite-v1.

See docs/specs/player-persona-benchmark.md. One run is one persona, one lane, one trial: a
real `bin/pi-coc` table driven by `tests/play/driver.py` -- the same daemon, the same one
round trip per turn as a real table -- with the typing done by an isolated persona agent
(`tests/play/player.py`) instead of by a person.

What this is not: acceptance. Agents.md's real table has the main session as its only
player, and nothing here replaces it. Every run record and every report carries
`method: "persona-benchmark"`, `acceptance: false`, and the runner refuses to pretend
otherwise. The Keeper side has no shortcut of any kind: no batch settle, no scripted
Keeper, no canned turns.

    uv run --frozen python tests/play/bench.py run --suite tests/play/suites/smoke.json
    uv run --frozen python tests/play/bench.py plan --suite tests/play/suites/full.json

Only the standard library is used.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import driver  # noqa: E402  (same directory; the driver is the transport, not a dependency to vendor)
from player import PersonaPlayer, ProviderExhausted, load_personas, player_view  # noqa: E402

REPO_ROOT = driver.REPO_ROOT
BENCH_ROOT = REPO_ROOT / ".coc" / "benchmarks"
KERNEL_ENTRY = REPO_ROOT / "build" / "kernel" / "rpc.mjs"
CONTENT_DIR = REPO_ROOT / "content"

#: Stop the run after this many consecutive turns that delivered nothing.
CONSECUTIVE_STALL_LIMIT = 3
#: Stop the run after this many consecutive unreadable persona replies.
CONSECUTIVE_PLAYER_FAILURE_LIMIT = 3
#: A campaign status outside this set means the story ended; the run stops on its own.
LIVE_CAMPAIGN_STATUSES = {"active", "ready_for_table", "setting_up"}

DEFAULTS: dict[str, Any] = {
    "module": "the-haunting",
    "play_language": "zh-Hans",
    "lanes": ["controlled"],
    "trials": 1,
    "max_turns": 30,
    "turn_timeout": 420.0,
    "opening_timeout": 600.0,
    "wall_cap_seconds": 7200.0,
    "kp_model": "xai/grok-4.6",
    "player_model": "deepseek/deepseek-v4-pro",
    "admission_model": "deepseek/deepseek-v4-flash",
    "controlled_pregen": "thomas-hayes",
    "natural_source": "pregen",
    "concurrency": 4,
}

_print_lock = threading.Lock()
#: Set once the provider says the account is out of credit. Every run still queued gives up
#: immediately instead of grinding a billing event into a hundred runs that read like defects.
_exhausted = threading.Event()

#: Seconds between two table starts. Twenty-four cold starts at once meant pi could not answer
#: `get_state` inside the driver's ten-second acknowledgement window and six runs died before
#: their first turn: the cost of concurrency is paid at startup, not during play. The gate only
#: spaces the starts -- once a table is up, all of them play at once.
START_STAGGER_SECONDS = 5.0
_start_gate = threading.Lock()
_last_start = 0.0


def say(message: str) -> None:
    with _print_lock:
        print(f"{driver.now_iso()} {message}", flush=True)


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# kernel: deterministic campaign creation, no model in the loop
# --------------------------------------------------------------------------

def kernel_call(method: str, params: dict[str, Any]) -> dict[str, Any]:
    """One short-lived kernel process, one request. Campaign creation is arithmetic, not play."""
    if not KERNEL_ENTRY.is_file():
        raise RuntimeError(f"{KERNEL_ENTRY} is missing; run `npm run build:runtime` first")
    request = json.dumps({"id": "bench-1", "method": method, "params": params}, ensure_ascii=False)
    proc = subprocess.run(
        [os.environ.get("COC_TEST_NODE", "node"), str(KERNEL_ENTRY),
         "--workspace", str(REPO_ROOT), "--content", str(CONTENT_DIR)],
        input=request + "\n", capture_output=True, text=True, timeout=120,
    )
    for line in proc.stdout.splitlines():
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if obj.get("id") == "bench-1" and ("ok" in obj):
            return obj
    raise RuntimeError(f"kernel gave no answer to {method}: stdout={proc.stdout[-400:]!r} "
                       f"stderr={proc.stderr[-400:]!r}")


def runtime_identity() -> dict[str, Any]:
    """Which build the tables actually ran, and which commit the tree was on.

    Another session develops in this worktree and rebuilds when it likes, so a suite that took
    five hours cannot assume one kernel. Recording the built file's digest and time makes a run
    attributable after the fact instead of arguable.
    """
    identity: dict[str, Any] = {}
    if KERNEL_ENTRY.is_file():
        data = KERNEL_ENTRY.read_bytes()
        identity["kernel_sha256"] = hashlib.sha256(data).hexdigest()[:16]
        identity["kernel_built_at"] = datetime.fromtimestamp(
            KERNEL_ENTRY.stat().st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    head = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=str(REPO_ROOT),
                          capture_output=True, text=True)
    if head.returncode == 0:
        identity["head"] = head.stdout.strip()
    dirty = subprocess.run(["git", "status", "--porcelain"], cwd=str(REPO_ROOT),
                           capture_output=True, text=True)
    if dirty.returncode == 0:
        identity["tree_dirty_files"] = len([l for l in dirty.stdout.splitlines() if l.strip()])
    return identity


def campaign_dir(campaign_id: str) -> Path:
    return REPO_ROOT / ".coc" / "campaigns" / campaign_id


def campaign_status(campaign_id: str) -> str | None:
    meta = driver.read_json(campaign_dir(campaign_id) / "campaign.json", None)
    return (meta or {}).get("status")


def opening_text(campaign_id: str) -> str | None:
    """The Keeper's opening delivery: turn 0 of the transcript, written before any player input."""
    path = campaign_dir(campaign_id) / "transcript.jsonl"
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if row.get("role") == "keeper" and row.get("text"):
            return row["text"]
    return None


# --------------------------------------------------------------------------
# the matrix
# --------------------------------------------------------------------------

def load_suite(path: Path) -> dict[str, Any]:
    suite = {**DEFAULTS, **json.loads(path.read_text(encoding="utf-8"))}
    if "suite" not in suite:
        suite["suite"] = path.stem
    if "personas" not in suite:
        raise ValueError(f"{path}: a suite must name its personas")
    for lane in suite["lanes"]:
        if lane not in ("controlled", "natural"):
            raise ValueError(f"{path}: unknown lane {lane!r}")
    if suite["natural_source"] not in ("pregen", "setup"):
        raise ValueError(f"{path}: natural_source must be 'pregen' or 'setup'")
    return suite


def plan_runs(suite: dict[str, Any], personas: dict[str, dict], stamp: str) -> list[dict[str, Any]]:
    runs = []
    for persona_id in suite["personas"]:
        if persona_id not in personas:
            raise ValueError(f"unknown persona {persona_id!r}")
        for lane in suite["lanes"]:
            for trial in range(1, int(suite["trials"]) + 1):
                slug = f"pb-{suite['suite']}-{persona_id.lower()}-{lane[:4]}-t{trial}-{stamp[-6:]}"
                runs.append({
                    "persona": persona_id, "lane": lane, "trial": trial,
                    "campaign": slug, "run_id": slug,
                })
    return runs


# --------------------------------------------------------------------------
# one run
# --------------------------------------------------------------------------

class RunFailed(Exception):
    pass


def _await_start_slot(stagger: float) -> None:
    global _last_start
    with _start_gate:
        wait = _last_start + stagger - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_start = time.monotonic()


def start_table(campaign: str, run_id: str, suite: dict[str, Any], launcher: str | None) -> str:
    """Start one table, staggered, and retry a failed start once under a suffixed run id.

    Returns the run id the table actually came up under, which is what later turns must use.
    """
    stagger = float(suite.get("start_stagger_seconds", START_STAGGER_SECONDS))
    for attempt in (1, 2):
        this_run = run_id if attempt == 1 else f"{run_id}-r{attempt}"
        argv = ["start", "--campaign", campaign, "--run", this_run, "--model", suite["kp_model"],
                "--no-default-run"]
        if launcher:
            argv += ["--launcher", launcher]
        if suite.get("admission_model"):
            argv += ["--env", f"PI_COC_ADMISSION_MODEL={suite['admission_model']}"]
        for pair in suite.get("env", []):
            argv += ["--env", pair]
        _await_start_slot(stagger)
        if driver.main(argv) == 0:
            return this_run
        say(f"{this_run}: start failed; {'retrying once' if attempt == 1 else 'giving up'}")
        time.sleep(stagger * 2)
    raise RunFailed(f"driver start failed twice for {run_id}")


def stop_table(run_id: str) -> None:
    try:
        driver.main(["stop", "--run", run_id])
    except Exception as exc:  # noqa: BLE001 -- stopping must never mask the run's own result
        say(f"{run_id}: stop raised {exc!r}")


def send_turn(run_id: str, text: str, timeout: float) -> dict[str, Any]:
    response = driver.rpc_call(run_id, {"cmd": "turn", "text": text, "timeout": timeout},
                               timeout=timeout + 30.0)
    if not response.get("ok"):
        raise RunFailed(f"turn rejected: {response.get('error')}")
    return response["summary"]


def await_opening(campaign: str, run_id: str, timeout: float) -> str:
    """Opening the table is a Keeper run of its own; wait for its delivery before playing."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        text = opening_text(campaign)
        if text:
            return text
        info = driver.read_json(driver.run_dir(run_id) / "daemon.json", {}) or {}
        if info.get("status") == "failed":
            raise RunFailed(f"daemon failed before the opening: {info.get('error')}")
        time.sleep(3.0)
    raise RunFailed(f"no opening delivery within {timeout}s")


def run_setup_lane(run: dict[str, Any], suite: dict[str, Any], player: PersonaPlayer,
                   trace: Path) -> dict[str, Any]:
    """Natural lane, `natural_source: "setup"`: the persona builds its own investigator.

    This is the real seven-step creation process (contract section 14.4) driven by the same
    persona, so the card the run plays with is the one this player would actually have made.
    """
    campaign, run_id = run["campaign"], f"{run['run_id']}-setup"
    run_id = start_table(campaign, run_id, suite, launcher="bin/pi-coc-setup")
    steps = []
    finished = False
    try:
        # Creation has no opening delivery to wait for: the campaign does not exist yet, so there
        # is no transcript to read. The player opens the app and says what they want, which is
        # what a person does here. The prompt is system language; the persona answers in the play
        # language, because that is the only place a language may be chosen (contract section 23).
        view = SETUP_FIRST_VIEW
        for step in range(1, int(suite.get("setup_max_turns", 20)) + 1):
            if campaign_status(campaign) == "ready_for_table":
                finished = True
                break
            act = player.act(view)
            if not act["ok"]:
                raise RunFailed(f"persona could not answer the setup lane: {act.get('error')}")
            try:
                summary = send_turn(run_id, act["player_message"], suite["turn_timeout"])
            except (RunFailed, driver.DaemonUnavailable) as exc:
                # Creation is a process that ends: the moment the card is finished, the setup
                # launcher exits, and a turn already on its way finds nobody home. That is the
                # lane succeeding, not failing -- but only if the campaign really is ready.
                if campaign_status(campaign) == "ready_for_table":
                    append_jsonl(trace, {"phase": "setup", "step": step, "at": driver.now_iso(),
                                         "note": "setup process ended with the card finished",
                                         "detail": str(exc)})
                    finished = True
                    break
                raise
            steps.append({"step": step, "player": act["player_message"],
                          "settle_class": summary["settle_class"]})
            append_jsonl(trace, {"phase": "setup", **steps[-1], "at": driver.now_iso()})
            if campaign_status(campaign) == "ready_for_table":
                finished = True
                break
            view = player_view(summary.get("delivery"), summary.get("final_text", ""),
                               summary["settle_class"])
    finally:
        stop_table(run_id)
    status = campaign_status(campaign)
    if status != "ready_for_table":
        raise RunFailed(f"setup lane ended with campaign status {status!r}, not ready_for_table")
    return {"setup_steps": len(steps), "setup_ended_by_process_exit": finished and not steps}


#: What the persona is told when a creation lane begins, before anything has been delivered.
SETUP_FIRST_VIEW = (
    "[You have just opened the game to make a new Call of Cthulhu investigator, before any "
    "session has begun. Nothing has been said to you yet. Say what you want, as yourself.]"
)


def append_jsonl(path: Path, obj: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def execute_run(run: dict[str, Any], suite: dict[str, Any], persona: dict[str, Any],
                suite_dir: Path) -> dict[str, Any]:
    campaign, run_id = run["campaign"], run["run_id"]
    if _exhausted.is_set():
        return {"method": "persona-benchmark", "acceptance": False, "status": "invalid",
                "suite": suite["suite"], "persona": persona["id"], "lane": run["lane"],
                "trial": run["trial"], "run_id": run_id, "campaign": campaign,
                "turns": [], "turns_played": 0,
                "error": "provider_exhausted: not started, the account was out of credit"}
    out_dir = suite_dir / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    trace = out_dir / "trace.jsonl"
    started_at, started_mono = driver.now_iso(), time.monotonic()
    record: dict[str, Any] = {
        "method": "persona-benchmark", "acceptance": False,
        "suite": suite["suite"], "persona": persona["id"], "persona_name": persona["name"],
        "lane": run["lane"], "trial": run["trial"], "campaign": campaign, "run_id": run_id,
        "module": suite["module"], "play_language": suite["play_language"],
        "models": {"keeper": suite["kp_model"], "player": suite["player_model"],
                   "admission": suite.get("admission_model")},
        "runtime": runtime_identity(),
        "started_at": started_at, "status": "running", "turns": [],
    }
    driver.write_json(out_dir / "run.json", record)

    lane_is_setup = run["lane"] == "natural" and suite["natural_source"] == "setup"
    pregen = (persona["natural_investigator"].get("pregen") or suite["controlled_pregen"]
              if run["lane"] == "natural" else suite["controlled_pregen"])
    investigator = (persona["natural_investigator"]["creation_brief"] if lane_is_setup
                    else f"a pre-made investigator ({pregen}); read your sheet as the table shows it")
    variation = (f"This is play-through {run['trial']} of this character concept. Open differently "
                 f"than an obvious first move would, but stay in profile.") if run["trial"] > 1 else ""

    player = PersonaPlayer(persona, out_dir, model=suite["player_model"],
                           play_language=suite["play_language"], variation=variation,
                           investigator=investigator)
    try:
        player.start()
        record["isolation"] = player.isolation
        _assert_isolation(player)

        if lane_is_setup:
            record.update(run_setup_lane(run, suite, player, trace))
        else:
            created = kernel_call("campaign.create", {
                "id": campaign, "module": suite["module"], "pregen": pregen,
                "play_language": suite["play_language"],
                "title": f"persona benchmark: {persona['id']} {run['lane']} t{run['trial']}",
            })
            if not created.get("ok"):
                raise RunFailed(f"campaign.create failed: {created.get('error')}")
            record["pregen"] = pregen

        run_id = start_table(campaign, run_id, suite, launcher=suite.get("launcher"))
        record["table_run_id"] = run_id
        view = await_opening(campaign, run_id, suite["opening_timeout"])
        append_jsonl(trace, {"phase": "opening", "at": driver.now_iso(), "view_sha256": sha256(view),
                             "text": view})

        stalls = consecutive_stalls = consecutive_player_failures = 0
        stop_reason = "max_turns"
        for turn in range(1, int(suite["max_turns"]) + 1):
            if time.monotonic() - started_mono > float(suite["wall_cap_seconds"]):
                stop_reason = "wall_cap"
                break
            act = player.act(view)
            if not act["ok"]:
                consecutive_player_failures += 1
                append_jsonl(trace, {"phase": "play", "turn": turn, "player_malformed": act.get("error"),
                                     "at": driver.now_iso()})
                if consecutive_player_failures >= CONSECUTIVE_PLAYER_FAILURE_LIMIT:
                    stop_reason = "player_unusable"
                    break
                continue
            consecutive_player_failures = 0

            summary = send_turn(run_id, act["player_message"], suite["turn_timeout"])
            # Spec section 1, invariant 2: exactly the persona's own words crossed to the Keeper.
            sent_sha = sha256(summary.get("player_text", ""))
            if sent_sha != sha256(act["player_message"]):
                raise RunFailed("what reached the Keeper was not what the persona wrote")

            delivery = summary.get("delivery")
            view = player_view(delivery, summary.get("final_text", ""), summary["settle_class"])
            turn_row = {
                "phase": "play", "turn": turn, "at": driver.now_iso(),
                "player_message": act["player_message"], "player_message_sha256": sent_sha,
                "private_eval": act.get("private_eval") or {},
                "settle_class": summary["settle_class"], "wall_seconds": summary["wall_seconds"],
                "tools": [t.get("name") for t in summary.get("tools") or []],
                "delivery_kind": (delivery or {}).get("kind"),
                "mechanics": (delivery or {}).get("mechanics") or [],
                "keeper_text": summary.get("final_text", ""),
            }
            append_jsonl(trace, turn_row)
            record["turns"].append({k: turn_row[k] for k in
                                    ("turn", "settle_class", "wall_seconds", "tools")})

            if summary["settle_class"] != "settled":
                stalls += 1
                consecutive_stalls += 1
                if consecutive_stalls >= CONSECUTIVE_STALL_LIMIT:
                    stop_reason = "stalled"
                    break
            else:
                consecutive_stalls = 0

            status = campaign_status(campaign)
            if status not in LIVE_CAMPAIGN_STATUSES:
                stop_reason = f"campaign_{status}"
                break
        record.update({"status": "completed", "stop_reason": stop_reason, "stalled_turns": stalls})
    except ProviderExhausted as exc:
        _exhausted.set()
        record.update({"status": "invalid", "error": f"provider_exhausted: {exc}"})
        say(f"{run_id}: PROVIDER EXHAUSTED -- {exc}")
        say("stopping: every remaining run would fail the same way. This is a billing event, "
            "not a product result; nothing here should be read as one.")
    except Exception as exc:  # noqa: BLE001 -- a broken run is evidence, not a crash
        record.update({"status": "invalid", "error": f"{type(exc).__name__}: {exc}"})
        say(f"{run_id}: INVALID -- {type(exc).__name__}: {exc}")
    finally:
        stop_table(record.get("table_run_id", run_id))
        player.stop()
        record["ended_at"] = driver.now_iso()
        record["wall_seconds"] = round(time.monotonic() - started_mono, 1)
        record["turns_played"] = len(record["turns"])
        record["evidence"] = {
            "campaign": str(campaign_dir(campaign).relative_to(REPO_ROOT)),
            "playtest": str(driver.run_dir(run_id).relative_to(REPO_ROOT)),
            "trace": str(out_dir.relative_to(REPO_ROOT)),
        }
        driver.write_json(out_dir / "run.json", record)
    say(f"{run_id}: {record['status']} ({record['turns_played']} turns, "
        f"{record['wall_seconds']}s, {record.get('stop_reason', record.get('error'))})")
    return record


def _assert_isolation(player: PersonaPlayer) -> None:
    """Spec section 1, invariants 1 and 3. A run that cannot prove these is not evidence."""
    missing = [flag for flag in ("--no-tools", "--no-extensions", "--no-skills",
                                 "--no-prompt-templates", "--no-context-files")
               if flag not in player.isolation["argv_flags"]]
    if missing:
        raise RunFailed(f"persona player is not isolated: missing {missing}")
    work = Path(player.isolation["cwd"])
    if any(work.iterdir()):
        raise RunFailed(f"persona player's working directory is not empty: {work}")
    if work.is_relative_to(REPO_ROOT):
        raise RunFailed("persona player is running inside the repository")


# --------------------------------------------------------------------------
# suite
# --------------------------------------------------------------------------

def cmd_plan(args: argparse.Namespace) -> int:
    suite = load_suite(Path(args.suite))
    personas = load_personas()
    runs = plan_runs(suite, personas, utc_stamp())
    per_run_minutes = float(args.minutes_per_turn) * int(suite["max_turns"])
    total = len(runs) * per_run_minutes
    print(json.dumps({
        "suite": suite["suite"], "runs": len(runs), "personas": len(suite["personas"]),
        "lanes": suite["lanes"], "trials": suite["trials"], "max_turns": suite["max_turns"],
        "models": {"keeper": suite["kp_model"], "player": suite["player_model"],
                   "admission": suite.get("admission_model")},
        "concurrency": suite["concurrency"],
        "estimate": {"minutes_per_turn_assumed": args.minutes_per_turn,
                     "keeper_turns_total": len(runs) * int(suite["max_turns"]),
                     "serial_hours": round(total / 60, 1),
                     "wallclock_hours_at_concurrency": round(total / 60 / int(suite["concurrency"]), 1)},
        "note": "estimate only; a run stops early on an ending, a stall or the wall cap",
        "runs_planned": [r["run_id"] for r in runs],
    }, ensure_ascii=False, indent=2))
    return 0


def sweep_stale_sandboxes() -> int:
    """Remove persona/judge sandboxes an earlier run was killed before cleaning.

    Each holds a copy of the table's credentials, so they are not left lying in the system
    temp directory for a later run to inherit or a backup to sweep up.
    """
    removed = 0
    root = Path(tempfile.gettempdir())
    for path in list(root.glob("persona-*")) + list(root.glob("persona-judge-*")):
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
            removed += 1
    return removed


def cmd_run(args: argparse.Namespace) -> int:
    suite = load_suite(Path(args.suite))
    swept = sweep_stale_sandboxes()
    if swept:
        say(f"swept {swept} sandbox directories left by an earlier run")
    if args.concurrency:
        suite["concurrency"] = args.concurrency
    if args.max_turns:
        suite["max_turns"] = args.max_turns
    personas = load_personas()
    stamp = utc_stamp()
    runs = plan_runs(suite, personas, stamp)
    suite_id = f"{suite['suite']}-{stamp}"
    suite_dir = BENCH_ROOT / suite_id
    suite_dir.mkdir(parents=True, exist_ok=True)
    driver.write_json(suite_dir / "suite.json", {
        "method": "persona-benchmark", "acceptance": False,
        "suite": suite["suite"], "suite_id": suite_id, "started_at": driver.now_iso(),
        "settings": suite, "runs": [r["run_id"] for r in runs], "status": "running",
    })
    say(f"suite {suite_id}: {len(runs)} runs, concurrency {suite['concurrency']}")
    say("this is a persona benchmark, not acceptance -- the real table of Agents.md is unchanged")

    results: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=int(suite["concurrency"])) as pool:
        futures = {pool.submit(execute_run, run, suite, personas[run["persona"]], suite_dir): run
                   for run in runs}
        for future in concurrent.futures.as_completed(futures):
            run = futures[future]
            try:
                results.append(future.result())
            except Exception as exc:  # noqa: BLE001
                say(f"{run['run_id']}: runner crashed: {exc!r}")
                results.append({"run_id": run["run_id"], "persona": run["persona"],
                                "lane": run["lane"], "trial": run["trial"],
                                "status": "invalid", "error": repr(exc)})

    completed = [r for r in results if r.get("status") == "completed"]
    if _exhausted.is_set():
        say("the provider ran out of credit during this suite: runs after that point are "
            "`provider_exhausted`, not evidence about the product")
    driver.write_json(suite_dir / "suite.json", {
        "method": "persona-benchmark", "acceptance": False,
        "suite": suite["suite"], "suite_id": suite_id, "ended_at": driver.now_iso(),
        "settings": suite, "status": "finished",
        "counts": {"planned": len(runs), "completed": len(completed),
                   "invalid": len(results) - len(completed)},
        "runs": sorted((r.get("run_id", "?") for r in results)),
    })
    say(f"suite {suite_id} finished: {len(completed)}/{len(runs)} completed -> {suite_dir}")
    return 0 if completed else 1


def cmd_status(args: argparse.Namespace) -> int:
    """Read-only progress of a suite, running or finished, from the evidence alone."""
    suite_dir = Path(args.suite_dir) if args.suite_dir else max(
        (p for p in BENCH_ROOT.iterdir() if p.is_dir()), key=lambda p: p.stat().st_mtime)
    rows = []
    for run_dir in sorted(p for p in suite_dir.iterdir() if (p / "run.json").exists()):
        record = driver.read_json(run_dir / "run.json", {}) or {}
        trace = run_dir / "trace.jsonl"
        played = setup = 0
        if trace.exists():
            for line in trace.read_text(encoding="utf-8", errors="replace").splitlines():
                played += '"phase": "play"' in line
                setup += '"phase": "setup"' in line
        rows.append({"run": run_dir.name, "persona": record.get("persona"),
                     "lane": record.get("lane"), "trial": record.get("trial"),
                     "status": record.get("status"), "stop_reason": record.get("stop_reason"),
                     "turns": played, "setup_steps": setup,
                     "wall_seconds": record.get("wall_seconds")})
    done = [r for r in rows if r["status"] == "completed"]
    invalid = [r for r in rows if r["status"] == "invalid"]
    running = [r for r in rows if r["status"] == "running"]
    planned = len((driver.read_json(suite_dir / "suite.json", {}) or {}).get("runs") or rows)
    print(json.dumps({
        "suite_dir": str(suite_dir), "planned": planned,
        "completed": len(done), "invalid": len(invalid), "running": len(running),
        "turns_played_total": sum(r["turns"] for r in rows),
        "invalid_runs": [{"run": r["run"], "status": r["status"]} for r in invalid],
        "in_flight": [{"run": r["run"], "turns": r["turns"], "setup_steps": r["setup_steps"]}
                      for r in running],
        "finished": [{"run": r["run"], "turns": r["turns"], "stop_reason": r["stop_reason"],
                      "wall_seconds": r["wall_seconds"]} for r in done],
    }, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="bench.py", description="player-persona-suite-v1 runner")
    sub = p.add_subparsers(dest="subcommand", required=True)

    sp = sub.add_parser("plan", help="expand the matrix and estimate its cost without spending any")
    sp.add_argument("--suite", required=True)
    sp.add_argument("--minutes-per-turn", type=float, default=0.93,
                    help="assumed Keeper minutes per turn (default: the third real admission table, "
                         "40 turns in 2222s)")
    sp.set_defaults(func=cmd_plan)

    sp = sub.add_parser("run", help="run the suite")
    sp.add_argument("--suite", required=True)
    sp.add_argument("--concurrency", type=int, default=None)
    sp.add_argument("--max-turns", type=int, default=None)
    sp.set_defaults(func=cmd_run)

    sp = sub.add_parser("status", help="read a suite's progress off its evidence (read-only)")
    sp.add_argument("--suite-dir", default=None, help="default: the most recent suite directory")
    sp.set_defaults(func=cmd_status)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
