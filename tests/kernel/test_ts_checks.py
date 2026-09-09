"""Actual built-RPC check settlements compared with Python, with retained state/Git evidence."""
from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
from pathlib import Path

import pytest

from conftest import RpcClient, in_play_language
from rpc_support import differences, python_command, snapshot

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / ".coc/playtests/runtime-consolidation/checks"
TS_COMMAND = ["node", str(ROOT / "build/kernel/rpc.mjs")]
CREATE = ("campaign.create", {"id": "c1", "module": "the-haunting", "pregen": "thomas-hayes", "play_language": "en"})


def retained(name):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=name + "-", dir=EVIDENCE))


def state_snapshot(workspace):
    result = snapshot(workspace)
    directory = workspace / ".coc"
    result["byte_hashes"] = {path.relative_to(directory).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                             for path in sorted(directory.rglob("*")) if path.is_file()
                             and path.relative_to(directory).parts[0] != "repos"}
    return result


def resolve(call, **action):
    return ("table.resolve", {"campaign": "c1", "call_id": call, "action": action})


def ordinary(call="t1-c1", **action):
    return resolve(call, **{"intent": "investigate", "skill": "Spot Hidden", "goal": "find the detail", "method": "inspect the desk", **action})


def finish(call="t1-c20"):
    return ("table.narrate", {"campaign": "c1", "call_id": call, "text": "The investigation advances. The witness waits by the desk."})


CASES = {
    "ordinary-replay": [ordinary(), ordinary(), ordinary(skill="Listen"),
        ordinary("t1-c2", skill="Anthropology"), ordinary("t1-c3", skill="DEX"),
        ordinary("t1-c4", modifiers={"bonus_dice": 2, "penalty_dice": 1, "difficulty": "hard"}),
        ordinary("t1-c5", modifiers={"bonus_dice": 1, "penalty_dice": 2, "difficulty": "extreme"}),
        ordinary("t1-c6", modifiers={"bonus_dice": 2, "penalty_dice": 2}), finish(), ordinary(),
        ("table.view", {"campaign": "c1"}), ("table.player_input", {"campaign": "c1", "text": "I listen for movement."}),
        ordinary("t2-c1", skill="Listen"), finish("t2-c2")],
    "push": [ordinary(), resolve("t1-c2", intent="investigate", push=True),
        resolve("t1-c3", intent="investigate", push=True, stakes="The drawer jams."),
        resolve("t1-c4", intent="investigate", push=True, method="look under the lamp", stakes="The drawer jams."),
        resolve("t1-c5", intent="investigate", push=True, method="look again", stakes="The lock breaks."),
        resolve("t1-c6", intent="investigate", luck=1), finish()],
    "luck": [ordinary(), resolve("t1-c2", intent="investigate", luck=100), resolve("t1-c6", intent="investigate", luck=9007199254740993),
        resolve("t1-c3", intent="investigate", luck=19), resolve("t1-c3", intent="investigate", luck=19),
        resolve("t1-c4", intent="investigate", push=True, method="search again", stakes="The drawer jams."),
        resolve("t1-c5", intent="investigate", luck=1), finish()],
    "fumble": [ordinary(), resolve("t1-c2", intent="investigate", push=True, method="search again", stakes="The drawer jams."),
        resolve("t1-c3", intent="investigate", luck=10), finish()],
    "critical": [ordinary(), resolve("t1-c2", intent="investigate", luck=1), finish()],
    "luck-roll": [ordinary(decision="push-luck:luck-roll", skill="LUCK"), resolve("t1-c2", intent="investigate", luck=1), finish()],
    "social": [resolve("t1-c1", intent="social", target="Steven Knott", skill="Persuade", goal="read the records", method="appeal to his duty", motive={"direction": "support", "intensity": 1}),
        resolve("t1-c2", intent="social", target="Steven Knott", skill="Intimidate", goal="read the records", method="show resolve", motive={"direction": "oppose", "intensity": 2}),
        resolve("t1-c3", intent="social", target="Walter Corbitt", skill="Intimidate", goal="gain an answer", method="show resolve", motive={"direction": "oppose", "intensity": 2}),
        resolve("t1-c4", intent="social", target="Steven Knott", skill="Charm", goal="earn his trust", method="speak warmly"),
        resolve("t1-c5", intent="social", target="Steven Knott", skill="Charm", goal="earn his trust", method="speak warmly", motive={"direction": "support", "intensity": True}),
        finish()],
    "psychology": [resolve("t1-c1", intent="investigate", target="Steven Knott", skill="Psychology", goal="understand the hesitation"),
        {"restart": True}, resolve("t1-c2", intent="investigate", decision="psychology:realize-player-safe", target="Steven Knott", method="He looks away before answering."),
        resolve("t1-c2", intent="investigate", decision="psychology:realize-player-safe", target="Steven Knott", method="He looks away before answering."),
        resolve("t1-c3", intent="social", decision="psychology:observe-concealed", target="Walter Corbitt", goal="read his expression"),
        ("table.view", {"campaign": "c1"}), finish()],
    "combined-opposed": [ordinary(decision="core-check:combined-check", skills=["DEX", "Climb"], mode="all"),
        ordinary("t1-c2", decision="core-check:combined-check", skills=["Listen", "Spot Hidden"], mode="any"),
        ordinary("t1-c3", decision="core-check:opposed-check", target="Walter Corbitt", skill="Listen"),
        ordinary("t1-c4", decision="core-check:opposed-check", target="Walter Corbitt", skill="DEX"),
        ordinary("t1-c5", decision="core-check:opposed-check", target="Steven Knott", skill="Listen"), finish()],
    "npc-actor": [ordinary(actor="Walter Corbitt", skill="Listen"), ordinary("t1-c2", actor="Walter Corbitt", skill="DEX"),
        ordinary("t1-c3", actor="Steven Knott", skill="Listen"), ordinary("t1-c4", actor="Steven Knott", skill="Law"), finish()],
    "choices-rulings": [("table.ask", {"campaign": "c1", "call_id": "t1-c1", "prompt": "Which route?", "options": ["Window", "Door"], "binds": "route"}),
        ("table.player_input", {"campaign": "c1", "text": "The window."}),
        ordinary("t2-c1", choice={"pending": "route", "option": "Window"}), ordinary("t2-c2", choice={"pending": "missing", "option": "Door"}),
        finish("t2-c3")],
    "validation-none": [resolve("t1-c1", intent="idle"), resolve("t1-c2", intent="move", goal="cross the room", method="walk over"),
        resolve("t1-c3", intent="montage", goal="wait"), resolve("t1-c4", intent="not-an-intent"),
        ordinary("t1-c5", skill="Not A Skill"), ordinary("t1-c6", skill=""), ordinary("t1-c7", modifiers={"bonus_dice": True}),
        ordinary("t1-c8", modifiers={"difficulty": "impossible"}), ordinary("t1-c9", mode="none"),
        ordinary("t1-c10", push=True, luck=5), ordinary("t1-c11", san_loss="bad"),
        ordinary("t1-c12", modifiers={"bonus_dice": None}), ordinary("t1-c13", modifiers={"difficulty": None}),
        ordinary("t1-c14", motive={"direction": "neutral", "intensity": None}), finish()],
    "routing": [resolve("t1-c1", intent="investigate", luck=10), resolve("t1-c2", intent="investigate", push=True, method="try again", stakes="A cost."),
        resolve("t1-c3", intent="investigate", target="Steven Knott", goal="understand the request", method="observe the witness"),
        resolve("t1-c4", intent="investigate", target="Steven Knott", skill="Not A Skill"),
        ordinary("t1-c5", target="Walter Corbitt"), ordinary("t1-c6"), finish()],
    "optional-luck": [ordinary(), resolve("t1-c2", intent="investigate", luck=10), finish()],
    "source-material": [ordinary(target="Tower"), ordinary("t1-c2", actor="Tower"),
        ordinary("t1-c3", target="Unindexed witness"), ordinary("t1-c4", target="Lena")],
    "completed-replay": [ordinary(), ordinary("t1-c2"), resolve("t1-c3", intent="idle"),
        ("table.resolve", {"campaign": "c1", "call_id": "t1-c4", "action": "bad"}),
        resolve("t1-c5", intent="montage", decision="missing")],
    "replay-before-unrelated-session-read": [ordinary(),
        {"damage": "save/combat.json", "value": "{bad json"}, ordinary(),
        ordinary("t1-c2", modifiers={"bonus_dice": True})],
}


def seed_base(root, name):
    base = root / "base"
    client = RpcClient(base, command=python_command(), frozen_clock=True, env={"COC_KERNEL_SEED": "fixture"})
    try:
        if name == "source-material":
            from module_helpers import finish as finish_reading, indexed, opening
            from setup_helpers import confirmed_investigator
            mid, _ = indexed(client, root)
            job, _, _ = opening(client, mid)
            finish_reading(client, job)
            client.ok("campaign.create", {"id": "c1", "module": mid, "play_language": "en"})
            confirmed_investigator(client)
            client.ok("setup.complete", {"campaign": "c1"})
        else:
            client.ok(*CREATE)
        client.ok("table.open", {"campaign": "c1"})
        client.ok("table.narrate", {"campaign": "c1", "call_id": "t0-c1", "text": "The case begins. A letter waits on the desk."})
        client.ok("table.player_input", {"campaign": "c1", "text": "I study the desk."})
        if name == "completed-replay":
            client.ok(*ordinary())
    finally:
        client.close()
    directory = base / ".coc/campaigns/c1"
    if name in {"social", "psychology", "combined-opposed", "npc-actor"}:
        path = directory / "world.json"
        world = json.loads(path.read_text())
        world["npc_presence"]["walter-corbitt"] = world["active_scene"]
        path.write_text(json.dumps(world, ensure_ascii=False, indent=2) + "\n")
    if name == "npc-actor":
        path = directory / "npc-ledger.json"
        ledger = json.loads(path.read_text()) if path.exists() else {}
        ledger.setdefault("npc-steven-knott", {})["skills"] = {"Listen": {"value": 66}}
        path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n")
    if name == "choices-rulings":
        rows = [{"name": "attention", "statement": "The lamp makes small details legible.", "anchor": {"family": "core-check", "skill": "Spot Hidden"}, "scope": "campaign", "turn": 0, "status": "active"},
                {"name": "other", "statement": "A social ruling.", "anchor": {"family": "social"}, "scope": "campaign", "turn": 0, "status": "active"}]
        (directory / "rulings.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
    if name == "optional-luck":
        path = directory / "save/house-rules.json"
        path.write_text(json.dumps({"patches": [{"patch_id": "disable-luck", "version": 1, "target": "decision:coc7:push-luck:luck-spend", "relation": "disables", "layer": "house_rule", "scope": "campaign", "reason": "Fixture option gate", "statement": "Luck spending is disabled."}]}) + "\n")
    if name == "completed-replay":
        path = directory / "campaign.json"
        meta = json.loads(path.read_text())
        meta["status"] = "completed"
        path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
    return base


def run_case(root, label, command, base, name):
    workspace = root / (label + "-workspace")
    shutil.copytree(base, workspace)
    seed = "check-oracle-7" if name == "fumble" else "check-oracle-37" if name == "critical" else "check-oracle-206"
    client = RpcClient(workspace, command=command, frozen_clock=True, env={"COC_KERNEL_SEED": seed})
    exchanges, snapshots = [], []
    try:
        for step in CASES[name]:
            if isinstance(step, dict) and "damage" in step:
                path = workspace / ".coc/campaigns/c1" / step["damage"]
                if path.exists():
                    (root / f"{label}-retained-before-damage.bin").write_bytes(path.read_bytes())
                path.write_text(step["value"])
            elif isinstance(step, dict):
                exchanges.extend(client.exchanges)
                client.close()
                client = RpcClient(workspace, command=command, frozen_clock=True, env={"COC_KERNEL_SEED": seed})
            else:
                method, params = step
                if method == "table.narrate":
                    result = client.ok(method, {**params, "text": in_play_language(client, params["text"])})
                    assert result.get("commit"), "An accepted check sequence must actually commit its narration"
                elif method == "table.player_input":
                    client.ok(method, params)
                else:
                    client.call(method, params)
                snapshots.append(state_snapshot(workspace))
        exchanges.extend(client.exchanges)
    finally:
        client.close()
    result = {"exchanges": exchanges, "snapshots": snapshots}
    (root / (label + ".json")).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result


@pytest.mark.parametrize("name", list(CASES))
def test_check_settlements_match_python(name):
    root = retained(name)
    base = seed_base(root, name)
    expected = run_case(root, "python", python_command(), base, name)
    actual = run_case(root, "typescript", TS_COMMAND, base, name)
    findings = differences(expected, actual)
    (root / "comparison.json").write_text(json.dumps({"equal": not findings, "differences": findings}, indent=2) + "\n")
    assert not findings, f"{name}: retained {root}\n" + "\n".join(findings[:60])
