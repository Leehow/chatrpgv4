"""Healing/resource migration through the canonical RPC with retained state and RNG evidence."""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile

import pytest

from conftest import RpcClient, in_play_language
from rpc_support import differences, python_command, snapshot

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / ".coc/playtests/runtime-consolidation/healing"
PATIENT = "thomas-hayes"
HEALER = "alice-healer"


def call(method, **params):
    return method, {"campaign": "c1", **params}


def treatment(ordinal, skill="First Aid", **action):
    return call("table.resolve", call_id=f"t1-c{ordinal}", action={"intent": "investigate", "actor": HEALER,
        "target": PATIENT, "skill": skill, "goal": "Treat the recorded wound", "method": "Use the available medical supplies", **action})


def clock(ordinal, minutes, **extra):
    return call("table.apply", call_id=f"t1-c{ordinal}", effects=[{"kind": "time", "minutes": minutes, **extra}])


def damage(ordinal, amount):
    return call("table.apply", call_id=f"t1-c{ordinal}", effects=[{"kind": "damage", "dice": f"1D1+{amount-1}", "subject": PATIENT, "why": "An accounted fall"}])


def fixed_decision(ordinal, decision, **action):
    return call("table.resolve", call_id=f"t1-c{ordinal}", action={"intent": "montage", "actor": PATIENT,
        "decision": "healing:" + decision, "goal": "Settle the recorded wound clock", **action})


CASES = {
    "patient-and-daily-use": {"steps": [treatment(1), treatment(1), treatment(2), treatment(3, "Medicine"), treatment(4, "Medicine")], "settled": [0, 1, 2, 3, 4]},
    "first-aid-teamwork": {"steps": [fixed_decision(1, "first-aid-ordinary", intent="investigate", target=HEALER)], "settled": [0]},
    "first-aid-push-refusals": {"steps": [fixed_decision(1, "first-aid-ordinary", intent="investigate", push=True, method="Repack the wound", stakes="The tissue tears"),
        fixed_decision(2, "first-aid-ordinary", intent="investigate"), fixed_decision(3, "first-aid-ordinary", intent="investigate", push=True, method="Repack the wound", stakes="The tissue tears"),
        fixed_decision(4, "first-aid-ordinary", intent="investigate", push=True, method="Repack again", stakes="The tissue tears")], "settled": [1], "refused": [0, 2, 3]},
    "npc-healer": {"steps": [treatment(1, "Medicine", actor="Steven Knott"), {"pin": True}, treatment(2, "Medicine", actor="Steven Knott")], "settled": [2]},
    "medicine-before-day": {"minutes": 1439, "steps": [treatment(1, "Medicine")], "settled": [0]},
    "medicine-after-day": {"minutes": 1440, "steps": [treatment(1, "Medicine")], "settled": [0]},
    "first-aid-at-hour": {"minutes": 60, "steps": [treatment(1)]},
    "first-aid-past-hour": {"minutes": 61, "steps": [treatment(1)]},
    "rebased-wound": {"occurred": -60, "steps": [treatment(1), clock(2, 1), treatment(3)]},
    "stabilize-and-treat": {"hp": 0, "conditions": ["major_wound", "unconscious", "dying"],
        "steps": [treatment(1, "Medicine"), treatment(2), treatment(3, "Medicine")], "settled": [1, 2]},
    "dying-round": {"hp": 0, "conditions": ["major_wound", "unconscious", "dying"],
        "steps": [fixed_decision(1, "dying-round-clock"), fixed_decision(1, "dying-round-clock")], "settled": [0, 1]},
    "dying-hour": {"hp": 1, "conditions": ["major_wound", "unconscious", "dying", "stabilized"],
        "steps": [fixed_decision(1, "dying-hour-clock"), treatment(2)], "settled": [0]},
    "weekly-not-due": {"minutes": 10079, "hp": 2, "conditions": ["major_wound", "prone"],
        "steps": [fixed_decision(1, "weekly-major-wound-recovery", rest={"complete": True})]},
    "weekly-due-and-replay": {"minutes": 10080, "hp": 2, "conditions": ["major_wound", "prone"],
        "steps": [fixed_decision(1, "weekly-major-wound-recovery", rest={"complete": True, "poor_environment": True}),
                  fixed_decision(1, "weekly-major-wound-recovery", rest={"complete": True, "poor_environment": True}),
                  fixed_decision(2, "weekly-major-wound-recovery")], "settled": [0, 1]},
    "rest-days-and-conditions": {"hp": 2, "conditions": ["prone", "unconscious"], "steps": [clock(1, 359), clock(2, 360), clock(3, 1440), clock(3, 1440), clock(4, 43200), damage(5, 2)]},
    "rest-major-weeks": {"hp": 2, "conditions": ["major_wound", "prone", "unconscious"], "steps": [clock(1, 10079), clock(2, 10080), clock(3, 20160), damage(4, 2)]},
    "mp-remainder-and-call-gate": {"mp": 0, "steps": [clock(1, 5), clock(2, 30), clock(3, 30),
        call("table.apply", call_id="t1-c4", effects=[{"kind": "time", "minutes": 30}, {"kind": "time", "minutes": 30}]),
        clock(5, 90), {"restart": True}, clock(6, 90), clock(6, 90), clock(7, 600)]},
    "high-pow-mp": {"mp": 0, "pow": 150, "steps": [clock(1, 90), clock(2, 90), clock(3, 600)]},
    "damage-major-and-lethal": {"hp": 12, "steps": [damage(1, 6), damage(1, 6), damage(2, 1), damage(3, 13)]},
    "failure-keeps-existing-write-order": {"hp": 12, "steps": [
        call("table.apply", call_id="t1-c1", effects=[{"kind": "damage", "dice": "1D1+5", "subject": PATIENT}, {"kind": "time", "minutes": -1}]),
        call("table.apply", call_id="t1-c2", effects=[{"kind": "damage", "dice": "1D6", "subject": "Nobody"}]),
        call("table.apply", call_id="t1-c3", effects=[{"kind": "damage", "dice": "bad", "subject": PATIENT}])]},
    "midnight-and-repeated-days": {"sanity": {"san_current": 44, "daily_san_lost": 12, "day_start_san": 55},
        "steps": [clock(1, 839), clock(2, 1), clock(2, 1), clock(3, 2880)]},
    "travel-midnight-is-not-rest": {"mp": 0, "sanity": {"san_current": 52, "daily_san_lost": 3, "day_start_san": 55},
        "steps": [call("table.apply", call_id="t1-c1", effects=[{"kind": "move", "to": "Hall of Records", "travel_minutes": 870}])]},
    "sanity-identity-refusal": {"sanity": {"investigator_id": "other", "san_current": 44, "daily_san_lost": 12}, "steps": [clock(1, 840)]},
    "unused-session-does-not-block-resources": {"mp": 0, "steps": [{"unused_corrupt": True}, clock(1, 60),
        damage(2, 1), {"unused_corrupt": False}]},
}


def state_snapshot(workspace):
    result = snapshot(workspace)
    directory = workspace / ".coc"
    result["byte_hashes"] = {path.relative_to(directory).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(directory.rglob("*")) if path.is_file() and path.relative_to(directory).parts[0] != "repos"}
    return result


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def prepare(client, case):
    client.ok("campaign.create", {"id": "c1", "module": "the-haunting", "pregen": PATIENT, "play_language": "en"})
    client.ok("table.open", {"campaign": "c1"})
    client.ok("table.narrate", {"campaign": "c1", "call_id": "t0-c1", "text": "The case begins. A witness waits by the desk."})
    client.ok("table.player_input", {"campaign": "c1", "text": "We tend the recorded wounds."})
    directory = client.workspace / ".coc/campaigns/c1"
    patient = json.loads((directory / "party" / f"{PATIENT}.json").read_text())
    healer = copy.deepcopy(patient)
    healer.update(id=HEALER, name="Alice Healer", current_hp=12, conditions=[])
    healer["skills"].update({"First Aid": 95, "Medicine": 95})
    patient.update(current_hp=case.get("hp", 4), current_mp=case.get("mp", 3), conditions=case.get("conditions", []))
    patient["skills"].update({"First Aid": 5, "Medicine": 2})
    if "pow" in case:
        patient["characteristics"]["POW"] = case["pow"]
        patient["derived"]["MP"] = case["pow"] // 5
    write(directory / "party" / f"{PATIENT}.json", patient)
    write(directory / "party" / f"{HEALER}.json", healer)
    meta = json.loads((directory / "campaign.json").read_text())
    meta["investigators"].append(HEALER)
    write(directory / "campaign.json", meta)
    world = json.loads((directory / "world.json").read_text())
    world["clock"]["minutes"] = case.get("minutes", 0)
    write(directory / "world.json", world)
    write(directory / "save/healing-state" / f"{PATIENT}.json", {"investigator_id": PATIENT, "current_hp": patient["current_hp"], "conditions": patient["conditions"],
        "wound_ledger": [{"wound_id": "wound-fixture", "source_damage_roll_id": "source-fixture", "occurred_elapsed_minutes": case.get("occurred", 0), "status": "active"}], "preserved": {"source": "accepted fixture"}})
    if "sanity" in case:
        write(directory / "save/sanity-state" / f"{PATIENT}.json", {"investigator_id": PATIENT, "san_max": 99, **case["sanity"]})


def observe(root, label, command, case):
    workspace = root / "workspace"
    options = {"command": command, "frozen_clock": True, "env": {"COC_KERNEL_SEED": "healing-rpc"}}
    client = RpcClient(workspace, **options)
    exchanges, states = [], []
    try:
        prepare(client, case)
        for i, step in enumerate(case["steps"]):
            if isinstance(step, tuple):
                response = client.call(*step)
                if i in case.get("settled", []):
                    assert response["ok"] and response["result"].get("family") == "healing", response
                if i in case.get("refused", []):
                    assert not response["ok"] and response["error"]["code"] == "needs", response
                states.append(state_snapshot(workspace))
            elif step.get("restart"):
                exchanges.extend(client.exchanges); client.close()
                client = RpcClient(workspace, **options)
            elif step.get("pin"):
                path = workspace / ".coc/campaigns/c1/npc-ledger.json"
                ledger = json.loads(path.read_text())
                ledger.setdefault("npc-steven-knott", {"stance": None, "disclosed": [], "exchanged": [], "interactions": [], "promises": [], "said": [], "skills": {}, "turns_present": None})["skills"]["Medicine"] = {"value": 95, "turn": 0, "source": "keeper"}
                write(path, ledger)
            elif "unused_corrupt" in step:
                path = workspace / ".coc/campaigns/c1/save/combat.json"
                if step["unused_corrupt"]:
                    assert not path.exists()
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("{ malformed unused combat snapshot", encoding="utf-8")
                else:
                    path.rename(root / f"{label}-retained-unused-combat.json")
        # A real ordinary check is the next RNG observation, even after rejected healing calls.
        client.ok("table.resolve", {"campaign": "c1", "call_id": "t1-c90", "action": {"intent": "investigate", "actor": HEALER, "skill": "Listen", "method": "Listen at the door", "goal": "Hear an approaching visitor"}})
        client.ok("table.narrate", {"campaign": "c1", "call_id": "t1-c91", "text": in_play_language(client, "The treatment and its consequences are accounted for. The case continues.")})
    finally:
        exchanges.extend(client.exchanges)
        client.close()
        if workspace.exists():
            states.append(state_snapshot(workspace))
            (root / f"{label}.json").write_text(json.dumps({"exchanges": exchanges, "states": states}, ensure_ascii=False, indent=2) + "\n")
            workspace.rename(root / f"{label}-workspace")
    return {"exchanges": exchanges, "states": states}


@pytest.mark.parametrize("name", CASES)
def test_healing_matches_current_python(name):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix=name + "-", dir=EVIDENCE))
    override = os.environ.get("COC_TS_HEALING_COMMAND")
    command = json.loads(override) if override else ["node", str(ROOT / "build/kernel/rpc.mjs")]
    reference = observe(root, "python", python_command(), CASES[name])
    actual = observe(root, "typescript", command, CASES[name])
    findings = differences(reference, actual)
    (root / "comparison.json").write_text(json.dumps({"equal": not findings, "differences": findings}, indent=2) + "\n")
    assert not findings, f"retained: {root}\n" + "\n".join(findings)
