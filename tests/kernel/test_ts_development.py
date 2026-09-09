"""Development and ending comparisons through the real registered RPC; no gameplay claim."""
from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
from pathlib import Path

import pytest

from conftest import RpcClient, stating
from rpc_support import differences, python_command, snapshot

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / ".coc/playtests/runtime-consolidation/development"
TS_COMMAND = ["node", str(ROOT / "build/kernel/rpc.mjs")]


def retained(name):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=name + "-", dir=EVIDENCE))


def state_snapshot(workspace):
    result = snapshot(workspace)
    root = workspace / ".coc"
    result["byte_hashes"] = {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                            for path in sorted(root.rglob("*")) if path.is_file()
                            and path.relative_to(root).parts[0] != "repos"}
    return result


def end_session(call="t1-c2", **extra):
    return ("table.resolve", {"campaign": "c1", "call_id": call, "action": {
        "intent": "montage", "goal": "Account for the conclusion.", "method": "", "decision": "development:end-session", **extra}})


def settle(call="t1-c2", **extra):
    return end_session(call, decision="development:settle-ending", **extra)


def ending(call="t1-c3", scope="campaign", **extra):
    return ("table.apply", {"campaign": "c1", "call_id": call, "effects": [
        {"kind": "ending", "scope": scope, "summary": "The chapter's investigation is resolved.", **extra}]})


def narrate(call="t1-c4"):
    return ("table.narrate", {"campaign": "c1", "call_id": call, "text": "The witness closes the ledger. The investigation has an answer."})


def player(text="Review the accounting."):
    return ("table.player_input", {"campaign": "c1", "text": text})


def check(call="t1-c6"):
    return ("table.resolve", {"campaign": "c1", "call_id": call, "action": {
        "intent": "investigate", "goal": "Hear the movement.", "method": "Listen", "skill": "Listen"}})


def move(call):
    return ("table.apply", {"campaign": "c1", "call_id": call, "effects": [{"kind": "move", "to": "hall-of-records",
        "via": "The next investigation begins at the records office.", "travel_minutes": 0}]})


CASES = {
    "growth-and-replay": [settle(), end_session(), end_session(), check("t1-c3"), settle("t1-c4"), narrate("t1-c5"), end_session(),
        ("table.look", {"campaign": "c1", "focus": "investigator"})],
    "campaign-reward": [ending("t1-c2", scope="invalid"), ending("t1-c2"), end_session(scenario_san_reward_expr="100D1"),
        ending(), narrate(), player(), end_session("t2-c1"), end_session("t2-c2", scenario_san_reward_expr="1D8"), ending("t2-c3", scope="chapter"), narrate("t2-c4")],
    "chapter-continuation": [end_session(scenario_san_reward_expr="1D1"), ending(scope="chapter"), narrate(), player(),
        end_session("t2-c1", scenario_san_reward_expr="1D1"), ending("t2-c2", scope="chapter", summary="A repeated summary."),
        ("table.ask", {"campaign": "c1", "call_id": "t2-c3", "prompt": "Which lead next?", "options": ["Records", "Pause"]}), player("Visit the records."),
        move("t3-c1"), narrate("t3-c2"), player(), end_session("t4-c1"), narrate("t4-c2")],
    "late-accounting": [player(), end_session("t2-c1", scenario_san_reward_expr="1D8"), end_session("t2-c1", scenario_san_reward_expr="1D8"),
        end_session("t2-c2", scenario_san_reward_expr="1D8"), end_session("t2-c3", scenario_san_reward_expr="10D8"), check("t2-c4"),
        end_session("t2-c6", push=True), end_session("t2-c7", luck=1), end_session("t2-c8", target="Steven Knott"),
        end_session("t2-c9", intent="investigate"), end_session("t2-c10", decision="coc7:development:end-session"),
        narrate("t2-c5"), {"restart": True}, ("table.open", {"campaign": "c1"}), player(), end_session("t3-c1"), narrate("t3-c2")],
    "legacy-chapter-correction": [player(), ending("t2-c1", scope="chapter"), end_session("t2-c2", scenario_san_reward_expr="1D8"),
        ending("t2-c3", scope="chapter"), ("table.ask", {"campaign": "c1", "call_id": "t2-c4", "prompt": "Continue?", "options": ["Yes", "Wait"]}),
        narrate("t2-c4"), {"restart": True}, ("table.open", {"campaign": "c1"}), player(), end_session("t3-c1"), move("t3-c2"), narrate("t3-c3")],
    "pending-additive": [settle(), settle(), settle("t1-c3"), end_session("t1-c4"), narrate("t1-c5")],
    "completed-pending": [player(), settle("t2-c1"), end_session("t2-c2"), narrate("t2-c3")],
    "earlier-pending": [player(), end_session("t2-c1"), settle("t2-c2"), end_session("t2-c3"), narrate("t2-c4")],
    "multi-investigator": [end_session(), end_session("t1-c2", actor="thomas-hayes", scenario_san_reward_expr="2D6"), narrate("t1-c3")],
    "luck-disabled": [end_session(scenario_san_reward_expr="2D6"), check("t1-c3"), narrate()],
    "luck-conflict": [end_session(scenario_san_reward_expr="1D6"), check("t1-c3")],
    "invalid-reward": [end_session(scenario_san_reward_expr="not-dice"), end_session("t1-c3", ending="unknown"),
        end_session("t1-c4", scenario_san_reward_expr="4"), end_session("t1-c5", scenario_san_reward_expr="1D4+1D6"), check("t1-c6"), narrate("t1-c7")],
    "missing-tick-skill": [end_session()],
    "missing-frozen-input": [settle()],
    "completed-no-ending-turn": [end_session("t1-c2")],
    "imported-writeback": [end_session(scenario_san_reward_expr="2D6"), narrate("t1-c3"),
        ("investigator.get", {"library_id": "fixture-library"}),
        ("campaign.create", {"id": "reuse", "module": "the-haunting", "play_language": "en"}),
        ("investigator.load", {"campaign": "reuse", "library_id": "fixture-library"}),
        ("setup.complete", {"campaign": "reuse"}), ("table.open", {"campaign": "reuse"}),
        ("table.look", {"campaign": "reuse", "focus": "investigator"})],
}


def prepare(root, name):
    from coc.rules.development import build_ending_capsule, persist_ending_capsule
    from coc.rules.tables import RuleTables
    base = root / "base"
    client = RpcClient(base, command=python_command(), frozen_clock=True, env={"COC_KERNEL_SEED": "check-oracle-37"})
    try:
        client.ok("campaign.create", {"id": "c1", "module": "the-haunting", "pregen": "thomas-hayes", "play_language": "en"})
        client.ok("table.open", {"campaign": "c1"})
        client.ok(*narrate("t0-c1"))
        client.ok(*player("Study the desk."))
        rolled = client.ok("table.resolve", {"campaign": "c1", "call_id": "t1-c1", "action": {"intent": "investigate", "skill": "Spot Hidden", "goal": "Find the detail.", "method": "Inspect the desk."}})
        assert rolled["outcome"]["passed"]
        if name == "imported-writeback":
            saved = client.ok("investigator.save", {"campaign": "c1"})
            (root / "fixture-identities.json").write_text(json.dumps({"library_id": saved["library_id"]}) + "\n")
        if name in {"late-accounting", "legacy-chapter-correction", "completed-pending", "earlier-pending"}:
            method, params = narrate("t1-c2")
            client.ok(method, {**params, "text": stating(client, params["text"])})
    finally:
        client.close()
    directory = base / ".coc/campaigns/c1"
    sheet_path = directory / "party/thomas-hayes.json"
    sheet = json.loads(sheet_path.read_text())
    if name in {"growth-and-replay", "pending-additive"}:
        sheet["skills"]["Spot Hidden"] = 89
        sheet_path.write_text(json.dumps(sheet, ensure_ascii=False, indent=2) + "\n")
    if name == "multi-investigator":
        other = json.loads((ROOT / "content/starters/the-haunting/pregens/eleanor-reed/character.json").read_text())
        other["campaign_id"] = "c1"
        (directory / "party/eleanor-reed.json").write_text(json.dumps(other, ensure_ascii=False, indent=2) + "\n")
    if name.startswith("luck-"):
        patches = [{"patch_id": "no-luck", "version": 1, "target": "rule:coc7:development:luck-recovery", "relation": "disables",
                    "layer": "house_rule", "scope": "campaign", "reason": "Fixture recovery gate", "statement": "Skip Luck recovery."}]
        if name == "luck-conflict":
            patches.append({**patches[0], "patch_id": "yes-luck", "relation": "enables"})
        (directory / "save/house-rules.json").write_text(json.dumps({"patches": patches}) + "\n")
    if name in {"pending-additive", "completed-pending", "earlier-pending", "missing-frozen-input"}:
        tables = RuleTables(ROOT / "content/rulesets/coc7/rules-json")
        record = {"scene_id": "commission-briefing", "kind": "conclusion", "decision_id": "t0-c90" if name == "earlier-pending" else "t1-c90",
                  "investigator_ids": ["thomas-hayes"], "scenario_san_reward_expr": "2D6", "summary": "Frozen prior accounting."}
        capsule = build_ending_capsule(tables, directory, record, {"thomas-hayes": sheet}, luck_recovery_gate=None, captured_at="2000-01-02T03:04:05Z")
        if name == "missing-frozen-input":
            capsule["development_inputs"] = {}
        persist_ending_capsule(directory, capsule)
        if name == "pending-additive":
            sheet["skills"]["Spot Hidden"] = 94
            sheet["current_luck"] = 98
            sheet["current_san"] = 97
            sheet_path.write_text(json.dumps(sheet, ensure_ascii=False, indent=2) + "\n")
    if name == "missing-tick-skill":
        path = directory / "save/development-state/thomas-hayes.json"
        state = json.loads(path.read_text())
        for value in state["ticks"].values():
            value["skill"] = "Uncataloged Skill"
        path.write_text(json.dumps(state, indent=2) + "\n")
    if name in {"late-accounting", "legacy-chapter-correction", "completed-pending", "earlier-pending", "completed-no-ending-turn"}:
        path = directory / "world.json"
        world = json.loads(path.read_text())
        world["ending"] = {"summary": "An existing legacy conclusion.", "turn": 1}
        if name == "completed-no-ending-turn":
            world["ending"].pop("turn")
        path.write_text(json.dumps(world, ensure_ascii=False, indent=2) + "\n")
        path = directory / "campaign.json"
        meta = json.loads(path.read_text())
        meta.update(status="completed", ending=world["ending"])
        path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
    return base


def observe(root, name, label, command, base):
    workspace = root / (label + "-workspace")
    shutil.copytree(base, workspace)
    client = RpcClient(workspace, command=command, frozen_clock=True, env={"COC_KERNEL_SEED": "development-oracle"})
    exchanges, snapshots = [], []
    try:
        for step in CASES[name]:
            if isinstance(step, dict):
                exchanges.extend(client.exchanges)
                client.close()
                client = RpcClient(workspace, command=command, frozen_clock=True, env={"COC_KERNEL_SEED": "development-oracle"})
            else:
                method, params = step
                if method == "table.narrate":
                    params = {**params, "text": stating(client, params["text"])}
                if params.get("library_id") == "fixture-library":
                    params = {**params, "library_id": json.loads((root / "fixture-identities.json").read_text())["library_id"]}
                response = client.call(method, params)
                snapshots.append(state_snapshot(workspace))
                if method in {"table.narrate", "table.player_input", "table.open", "investigator.get", "campaign.create", "investigator.load", "setup.complete", "table.look"}:
                    assert response["ok"], f"{label} {name} intended successful {method}: {response}"
    finally:
        exchanges.extend(client.exchanges)
        client.close()
        result = {"exchanges": exchanges, "snapshots": snapshots, "exit_code": client.proc.returncode}
        (root / (label + ".json")).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result


@pytest.mark.parametrize("name", list(CASES))
def test_development_matches_python_through_rpc(name):
    root = retained(name)
    base = prepare(root, name)
    expected = observe(root, name, "python", python_command(), base)
    actual = observe(root, name, "typescript", TS_COMMAND, base)
    negative = {"luck-conflict", "missing-tick-skill", "missing-frozen-input", "completed-no-ending-turn"}
    if name not in negative:
        for label, result in [("python", expected), ("typescript", actual)]:
            assert any(item["response"].get("result", {}).get("outcome", {}).get("kind") == "development"
                       for item in result["exchanges"]), f"{label} {name} never completed development: {root}"
    findings = differences(expected, actual)
    (root / "comparison.json").write_text(json.dumps({"equal": not findings, "differences": findings}, indent=2) + "\n")
    assert not findings, f"{name}: retained {root}\n" + "\n".join(findings[:50])
