"""Regression corpus (contract §11.8): every recorded rules.settle payload from the old repo
that this half implements, replayed as a resolve action. The same decision must be selected
and the effect/event kinds must match; dice are random and never compared."""

import json
from pathlib import Path

import pytest

from conftest import RpcClient, campaign_dir, open_turn, read_json, read_jsonl
from test_rules_families import first_failure, seed_wound

CORPUS = Path(__file__).with_name("corpus")
CASES = sorted(p for p in CORPUS.glob("*.json"))


def _setup(client: RpcClient, case: dict) -> int:
    """Run the case's setup; returns the next call ordinal."""
    setup = case.get("setup") or {}
    ordinal = 1
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
    return ordinal


@pytest.mark.parametrize("path", CASES, ids=[p.stem for p in CASES])
def test_recorded_payload_replays_as_a_resolve(path, tmp_path):
    case = json.loads(path.read_text(encoding="utf-8"))
    expect = case["expect"]
    client = RpcClient(tmp_path / "ws", env={"COC_KERNEL_SEED": path.stem})
    try:
        open_turn(client, "回归。")
        ordinal = _setup(client, case)
        before = len(read_jsonl(campaign_dir(client.workspace) / "events.jsonl"))
        result = client.table("resolve", call_id=f"t1-c{ordinal}", action=case["action"])
        assert result["decision"] == expect["decision"]
        outcome = result["outcome"]
        assert outcome["kind"] == expect["outcome_kind"]
        for key, value in (expect.get("outcome") or {}).items():
            assert outcome.get(key) == value, key
        assert {e["kind"] for e in result["effects"]} <= set(expect["effect_kinds_allowed"])
        events = [e["type"] for e in read_jsonl(campaign_dir(client.workspace) / "events.jsonl")[before:]]
        optional = set(expect.get("optional_event_types") or [])
        assert [e for e in events if e not in optional] == expect["event_types"]
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
        if expect.get("second_push_refused"):
            again = client.table_err("resolve", call_id=f"t1-c{ordinal + 1}", action=case["action"])
            assert again["code"] == expect["second_push_refused"]
        # The settlement is idempotent under its call_id.
        assert client.table("resolve", call_id=f"t1-c{ordinal}", action=case["action"]) == {**result, "replayed": True}
    finally:
        client.close()
