"""Regression corpus (contract §11.8): every recorded rules.settle payload from the old repo,
replayed as a resolve action. The same decision must be selected, the effect/event kinds
must match and the session transitions must match; dice are random and never compared."""

import json
import os
from pathlib import Path

import pytest

from conftest import RpcClient, campaign_dir, open_turn, read_json, read_jsonl
from test_rules_families import first_failure, seed_wound
from rpc_support import read_command, snapshot

CORPUS = Path(__file__).with_name("corpus")
CASES = sorted(p for p in CORPUS.glob("*.json"))


def _seed_sanity(workspace: Path, overrides: dict) -> None:
    """A per-investigator sanity snapshot the engine will load: the sheet's SAN plus the
    case's overrides (an underlying insanity, a delusion, ...)."""
    directory = campaign_dir(workspace)
    sheet = read_json(directory / "party" / "thomas-hayes.json")
    state = {
        "investigator_id": "thomas-hayes", "san_max": 99, "san_current": sheet["current_san"], "cm_value": 0,
        "awfulness_caps": {}, "temporary_insane": False, "temporary_insane_remaining_hours": 0, "indefinite_insane": False,
        "permanently_insane": False, "bout_active": False, "bout_rounds_remaining": 0, "active_bout_id": None,
        "daily_san_lost": 0, "day_start_san": sheet["current_san"], "bouts_of_madness": [], "involuntary_actions": [],
        "phobia": None, "phobia_tags": [], "mania": None, "mania_tags": [], "mania_unindulged": False, "conditions": [],
        "active_delusion": None, "delusion_resistant": False, "symptoms_suppressed_until_next_san_loss": False,
        "recovery_trigger": None, "treatment_trigger": None, "events": [],
    }
    state.update(overrides)
    if state["temporary_insane"] and not state["temporary_insane_remaining_hours"]:
        state["temporary_insane_remaining_hours"] = 5
    path = directory / "save" / "sanity-state" / "thomas-hayes.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _setup(client: RpcClient, case: dict) -> int:
    """Run the case's setup; returns the next call ordinal."""
    setup = case.get("setup") or {}
    ordinal = 1
    for scene in setup.get("move_to") or []:
        client.table("apply", call_id=f"t1-c{ordinal}", effects=[{"kind": "move", "to": scene}])
        ordinal += 1
    if setup.get("wound"):
        seed_wound(client.workspace, setup["wound"]["hp"], minutes_ago=setup["wound"].get("minutes_ago", 0))
    if setup.get("prior_failed_check"):
        prior = setup["prior_failed_check"]
        failed_id, _ = first_failure(client, "t1-c", intent="investigate", goal=prior["goal"], method="",
                                     skill=prior["skill"], stakes=prior.get("stakes"),
                                     modifiers={"difficulty": prior["difficulty"]})
        ordinal = int(failed_id.split("-c")[1]) + 1
    if setup.get("pending_ending"):
        ended = client.table("resolve", call_id="t1-c1", action={
            "intent": "montage", "goal": "session ends", "method": "", "decision": "development:end-session"})
        ending_id = ended["outcome"]["ending_id"]
        receipt = campaign_dir(client.workspace) / "save" / "development-settlements" / "endings" / ending_id / "thomas-hayes.json"
        receipt.unlink()
        ordinal = 2
    if setup.get("combat"):
        # One exchange: the investigator's attack and the NPC's answer, so the fight is live.
        combat = setup["combat"]
        client.table("resolve", call_id=f"t1-c{ordinal}", action={
            "intent": "combat", "goal": "open the fight", "method": "", "target": "Walter Corbitt",
            "weapon": combat.get("weapon", "unarmed")})
        client.table("resolve", call_id=f"t1-c{ordinal + 1}", action={
            "intent": "combat", "goal": "answer", "method": "", "actor": "Walter Corbitt", "defense": combat.get("defense", "dodge")})
        ordinal += 2
    if setup.get("sanity") is not None:
        _seed_sanity(client.workspace, setup["sanity"])
    return ordinal


def _check_session(expected, actual) -> None:
    if expected is None:
        assert actual is None
        return
    if "kind" in expected:
        assert actual is not None and actual["kind"] == expected["kind"]
    if "kind_in" in expected:
        assert (actual or {}).get("kind") in expected["kind_in"]
    if "status" in expected:
        assert actual["status"] == expected["status"]
    if "status_in" in expected:
        assert actual["status"] in expected["status_in"]
    if "outcome" in expected:
        assert actual.get("outcome") == expected["outcome"]


def _check(client: RpcClient, workspace: Path, call_id: str, action: dict, expect: dict) -> dict:
    before = len(read_jsonl(campaign_dir(workspace) / "events.jsonl"))
    result = client.table("resolve", call_id=call_id, action=action)
    assert result["decision"] == expect["decision"]
    outcome = result["outcome"]
    assert outcome["kind"] == expect["outcome_kind"]
    for key, value in (expect.get("outcome") or {}).items():
        if key.endswith("_in"):
            assert outcome.get(key[:-3]) in value, key
        else:
            assert outcome.get(key) == value, key
    assert {e["kind"] for e in result["effects"]} <= set(expect["effect_kinds_allowed"])
    events = [e["type"] for e in read_jsonl(campaign_dir(workspace) / "events.jsonl")[before:]]
    # slice 2 (12.1): every session receipt also emits `session-changed`; the recorded
    # slice-1 expectations predate it, so it is optional everywhere.
    optional = set(expect.get("optional_event_types") or []) | {"session-changed"}
    assert [e for e in events if e not in optional] == expect["event_types"]
    for event_type, minimum in (expect.get("event_counts_min") or {}).items():
        assert events.count(event_type) >= minimum, event_type
    if "roll_visibility" in expect:
        receipt = next(r for r in client.table("status")["receipts"] if r["id"] == result["receipt"])
        assert receipt["visibility"] == expect["roll_visibility"]
    if "continuations" in expect:
        assert [c["decision"] for c in result["continuations"]] == expect["continuations"]
    if "continuations_on_failure" in expect:
        names = [c["decision"] for c in result["continuations"]]
        if outcome.get("passed") or outcome.get("level") == "fumble":
            assert names == []
        else:
            assert names == expect["continuations_on_failure"]
    if "session" in expect:
        _check_session(expect["session"], result["session"])
    if "session_after" in expect:
        _check_session(expect["session_after"], client.table("look")["where"]["session"])
    if "pending_choice" in expect:
        pending = result["pending_choice"]
        if expect["pending_choice"] is None:
            assert pending is None
        else:
            assert pending is not None and pending["for"] == expect["pending_choice"]["for"]
    if expect.get("second_push_refused"):
        turn, n = call_id.split("-c")
        again = client.table_err("resolve", call_id=f"{turn}-c{int(n) + 1}", action=action)
        assert again["code"] == expect["second_push_refused"]
    # The settlement is idempotent under its call_id.
    assert client.table("resolve", call_id=call_id, action=action) == {**result, "replayed": True}
    return result


def run_recorded_case(path, workspace, *, command=None, frozen_clock=False, capture_failure=False):
    case = json.loads(path.read_text(encoding="utf-8"))
    client = None
    failure = None
    try:
        client = RpcClient(workspace, env={"COC_KERNEL_SEED": str((case.get("setup") or {}).get("seed") or path.stem)},
                           command=command, frozen_clock=frozen_clock)
        open_turn(client, "回归。")
        ordinal = _setup(client, case)
        _check(client, client.workspace, f"t1-c{ordinal}", case["action"], case["expect"])
        for offset, followup in enumerate(case.get("followups") or [], start=1):
            _check(client, client.workspace, f"t1-c{ordinal + offset}", followup["action"], followup["expect"])
    except Exception as exc:
        if not capture_failure:
            raise
        failure = {"type": type(exc).__name__, "message": str(exc)}
    finally:
        if client:
            client.close()
    return {"exchanges": client.exchanges if client else [], "state": snapshot(workspace), "failure": failure}


@pytest.mark.parametrize("path", CASES, ids=[p.stem for p in CASES])
def test_recorded_payload_replays_as_a_resolve(path, tmp_path):
    run_recorded_case(path, tmp_path / "ws")
