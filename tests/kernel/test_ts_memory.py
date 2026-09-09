"""Memory lane comparison through the canonical RPC, retaining all evidence."""
from __future__ import annotations

import json
from pathlib import Path
import tempfile

import pytest

from conftest import RpcClient
from rpc_support import differences, python_command, snapshot
from test_ts_transactions import CREATE, OPEN, OPENING, INPUT, NARRATE

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / ".coc/playtests/runtime-consolidation/memory"
CAMPAIGN = {"campaign": "c1"}
START = [CREATE, OPEN, OPENING, INPUT, NARRATE]


def call(method, **params):
    return method, {**CAMPAIGN, **params}


def candidate(kind="knowledge", **fields):
    return {"kind": kind, "subject": "Thomas Hayes", "statement": "The letter was waiting.", **fields}


ROWS = [candidate(), candidate("world_event", subject="world"),
        candidate("belief", knowers=["party", "Steven Knott"], state="uncertain", privacy="keeper_only", confidence=0.5),
        candidate("relationship", subject="Steven Knott", entities=["Thomas Hayes"]),
        candidate("promise", subject="Steven Knott", entities=["Thomas Hayes"], statement="He will wait until morning."),
        candidate("player_assertion", subject="player"), candidate("player_preference", subject="player"),
        candidate("keeper_correction", subject="keeper")]
SUBMIT = call("memory.submit", job_id="extract:c1:t1", candidates=ROWS)
INVALID = [None, {}, [None], [candidate(id="model-id")], [candidate(unrecognized=True)],
           [candidate(kind="other")], [candidate(statement=" ")], [candidate(statement="x" * 401)],
           [candidate(subject="")], [candidate(subject="Walter Corbitt")], [candidate("world_event")],
           [candidate(knowers="party")], [candidate(entities="Thomas Hayes")],
           [candidate(knowers=["world"])], [candidate("relationship")],
           [candidate(privacy=None)], [candidate(state=None)], [candidate(confidence=True)],
           [candidate(confidence=1.1)], [candidate()] * 13]

CASES = {
    "empty-default-and-job-packet": [CREATE, OPEN, call("memory.job"),
        *[call("memory.job", turn=value) for value in [-1, True, 1.0, "1", 12]],
        OPENING, call("memory.job"), INPUT, NARRATE, call("memory.job"), call("memory.job", turn=0)],
    "submit-replay-supersession-ledger": [*START, SUBMIT, SUBMIT,
        call("memory.submit", job_id="extract:c1:t1", candidates=[]), call("memory.job"),
        call("table.recall", what="memory"), call("table.recall", what="memory", about=["Knott"]),
        INPUT, call("table.narrate", call_id="t2-c1", text="Knott changes his promise."),
        call("memory.submit", job_id="extract:c1:t2", candidates=[candidate("promise", subject="Steven Knott", entities=["Thomas Hayes"], statement="He will return after sunset.")]),
        call("table.recall", what="memory", about=["Knott"], include_superseded=True),
        call("table.capsule")],
    "candidate-refusals-and-recovery": [*START, call("memory.job"),
        *[call("memory.submit", job_id="extract:c1:t1", candidates=value) for value in INVALID],
        call("memory.job"), call("memory.fail", job_id="extract:c1:t1", reason="model_error", detail={"timeout": True}),
        SUBMIT, call("memory.job"), call("table.recall", what="memory", about=["Thomas"]),
        call("memory.fail", job_id="extract:c1:t1", reason="lane_error", detail="late failure")],
    "lost-job-and-restart": [*START, call("memory.job"), {"damage": "memory/jobs/extract:c1:t1.json", "value": "{bad json"},
        {"restart": True}, SUBMIT, {"restart": True}, SUBMIT,
        *[call("memory.fail", job_id=value, reason="invalid") for value in [None, "extract:other:t1", "invalid"]],
        call("memory.fail", job_id="extract:c1:t30", reason="invalid", detail="uncommitted"),
        call("memory.submit", job_id="extract:c1:t30", candidates=[]),
        call("memory.fail", job_id="extract:c1:t1", reason="unknown")],
    "warnings-anchor-budget": [*START,
        call("table.warn", turn=1, lane="verifier", findings=[{"kind": "reveal", "quote": "The ink is dry.", "why": "a" * 250}, {"kind": "player_agency", "quote": "never said"}]),
        call("table.warn", turn=1, lane="verifier", findings=[{"kind": "uncommitted_state", "quote": "witness"}] * 12),
        call("table.warn", turn=1, lane="other", findings=[]),
        call("table.warn", turn=1, lane="verifier", findings=[None]),
        call("table.warn", turn=1, lane="verifier", findings=[{"kind": "other"}]),
        call("table.warn", turn=5, lane="verifier", findings=[]),
        INPUT, call("table.capsule"), call("table.recall", what="transcript", read={"turn": 1, "role": "keeper"})],
    "history-transcript": [*START, SUBMIT, INPUT,
        call("table.ask", call_id="t2-c1", prompt="Which lead?", options=["Letter", "Door"], text="He waits."),
        INPUT, call("table.narrate", call_id="t3-c1", text="A long silence. " + "\U0001f680" * 100),
        *[call("table.recall", what="transcript", **params) for params in [{}, {"turns": [0, 20]}, {"role": "keeper"}, {"read": {"turn": 3, "role": "keeper"}}, {"read": {"turn": 55, "role": "player"}}, {"role": "other"}, {"turns": [False, 1]}, {"read": []}]],
        call("table.recall", what="history", turns=[0, 20], diff=[0, 3], lines=True),
        call("table.recall", what="history", types=["memory-written"]),
        call("table.recall", what="history", types=["other"]),
        call("table.recall", what="history", diff=[1, 30])],
    "recall-filters-and-errors": [*START, SUBMIT, INPUT,
        *[call("table.recall", what="memory", **params) for params in [{"about": ["world"], "turns": [1, 1]}, {"about": ["Hayes"], "kinds": ["knowledge"]}, {"about": []}, {"about": ["absent person"]}, {"about": "Knott"}, {"kinds": ["other"]}, {"limit": True}, {"limit": 1.0}, {"limit": 31}, {"line": "missing"}, {"line": "main"}, {"line": "any"}]],
        call("table.recall", what="other")],
    "advisory-does-not-change-turn-state": [*START, INPUT, call("table.ask", call_id="t2-c1", prompt="Wait?", options=["Yes", "No"]),
        call("memory.job"), SUBMIT, call("table.warn", turn=1, lane="verifier", findings=[]), call("table.status"),
        {"complete": True}, call("memory.job"), call("memory.submit", job_id="extract:c1:t1", candidates=[]),
        call("table.warn", turn=1, lane="verifier", findings=[]), call("table.recall", what="transcript")],
    "advisory-survives-damaged-current-cursor": [*START, call("memory.job"),
        {"damage": "turn.json", "value": "{bad json"},
        call("memory.job"), SUBMIT, SUBMIT,
        call("table.warn", turn=1, lane="verifier", findings=[{"kind": "reveal", "quote": "The ink is dry.", "why": "An advisory finding."}]),
        call("memory.fail", job_id="extract:c1:t1", reason="lane_error"), {"restart": True},
        call("memory.job"), OPEN, call("table.recall", what="history")],
}


def observe(root, label, command, steps):
    workspace = root / "workspace"
    client = RpcClient(workspace, command=command, frozen_clock=True, env={"COC_KERNEL_SEED": "memory-oracle"})
    exchanges, states = [], []
    try:
        for i, step in enumerate(steps):
            if isinstance(step, tuple):
                client.call(*step)
                states.append(snapshot(workspace))
            elif step.get("restart"):
                exchanges.extend(client.exchanges)
                client.close()
                client = RpcClient(workspace, command=command, frozen_clock=True, env={"COC_KERNEL_SEED": "memory-oracle"})
            elif "damage" in step:
                path = workspace / ".coc/campaigns/c1" / step["damage"]
                (root / f"{label}-retained-{i}.bin").write_bytes(path.read_bytes())
                path.write_text(step["value"])
            elif step.get("complete"):
                path = workspace / ".coc/campaigns/c1/campaign.json"
                meta = json.loads(path.read_text()); meta["status"] = "completed"
                path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
        exchanges.extend(client.exchanges)
    finally:
        client.close()
    result = {"exchanges": exchanges, "states": states}
    (root / f"{label}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    workspace.rename(root / f"{label}-workspace")
    return result


@pytest.mark.parametrize("name", CASES)
def test_memory_matches_python(name):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix=name + "-", dir=EVIDENCE))
    reference = observe(root, "python", python_command(), CASES[name])
    actual = observe(root, "typescript", ["node", str(ROOT / "build/kernel/rpc.mjs")], CASES[name])
    found = differences(reference, actual)
    (root / "comparison.json").write_text(json.dumps({"equal": not found, "differences": found}, indent=2) + "\n")
    assert not found, f"retained: {root}\n" + "\n".join(found)
