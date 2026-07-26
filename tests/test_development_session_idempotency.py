"""Development settlement idempotency scoped by the durable table-session cursor.

Pins W4: one settlement per investigator per table session. A repeat
end_session within one session replays the original settlement receipt (no
new rolls, no new state diffs); session.begin advances the cursor and opens
a fresh settlement boundary.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
PYTHON = sys.executable


def _load(name: str, rel: str | Path):
    path = Path(rel)
    if not path.is_absolute():
        path = REPO / path
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_session_idempotency", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_session_idempotency", SCRIPTS / "coc_starter.py")


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [
        json.loads(raw)
        for raw in path.read_text(encoding="utf-8").splitlines()
        if raw.strip()
    ]


@pytest.fixture()
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "session-idempotency-test"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Session Idempotency Test",
    )
    return {
        "workspace": workspace,
        "coc_root": coc_root,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": quick["investigator_id"],
        "quick": quick,
    }


def _run(ws, tool: str, args: dict | None = None) -> dict:
    args = dict(args or {})
    if tool == "rules.roll":
        args.setdefault("difficulty", "regular")
        args.setdefault("difficulty_basis", "keeper_judgment")
        args.setdefault("goal", "settle the focused session test action")
        args.setdefault(
            "stakes",
            {
                "on_success": "the focused test action succeeds",
                "on_failure": "the focused test action does not succeed",
            },
        )
    result = coc_toolbox.run_tool(
        tool, ws["workspace"], ws["campaign_id"], dict(args)
    )
    assert isinstance(result, dict)
    return result


def _end_session(ws, decision_id: str) -> dict:
    result = _run(
        ws,
        "state.end_session",
        {
            "kind": "cliffhanger",
            "summary": f"session boundary {decision_id}",
            "decision_id": decision_id,
        },
    )
    assert result["ok"] is True, result
    return result


def _luck_recovery_rows(ws) -> list[dict]:
    rows = []
    for row in _read_jsonl(ws["campaign_dir"] / "logs" / "rolls.jsonl"):
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        if row.get("kind") == "luck_recovery" or payload.get("kind") == "luck_recovery":
            rows.append(row)
    return rows


def _current_luck(ws) -> int:
    character = json.loads(
        (ws["coc_root"] / "investigators" / ws["investigator_id"] / "character.json")
        .read_text(encoding="utf-8")
    )
    derived = character.get("derived") if isinstance(character.get("derived"), dict) else {}
    if derived.get("Luck") is not None:
        return int(derived["Luck"])
    chars = character.get("characteristics") if isinstance(character.get("characteristics"), dict) else {}
    if chars.get("LUCK") is not None:
        return int(chars["LUCK"])
    return 50


def _earn_spot_hidden_tick(ws) -> None:
    rolled = _run(
        ws,
        "rules.roll",
        {
            "investigator": ws["investigator_id"],
            "skill": "Spot Hidden",
            "target": 99,
            "seed": 1,
            "decision_id": "tick-earning-roll",
        },
    )
    assert rolled["ok"] is True, rolled


def _boundary_ledger(ws) -> dict | None:
    path = (
        ws["campaign_dir"]
        / "save"
        / "development-settlements"
        / "boundaries"
        / f"{ws['investigator_id']}.json"
    )
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def test_repeat_end_session_within_one_session_replays_settlement(campaign_ws):
    _earn_spot_hidden_tick(campaign_ws)

    first = _end_session(campaign_ws, "ending-one")
    first_receipt = first["data"]["development"]["settlements"][0]["receipt"]
    assert first_receipt["result"]["skills_checked"] == ["Spot Hidden"]
    assert first_receipt.get("replayed") is not True
    assert len(_luck_recovery_rows(campaign_ws)) == 1
    luck_after_first = _current_luck(campaign_ws)

    second = _end_session(campaign_ws, "ending-two")
    second_receipt = second["data"]["development"]["settlements"][0]["receipt"]
    assert second_receipt["replayed"] is True
    assert second_receipt["replayed_from_ending_id"]
    # The replayed receipt is the ORIGINAL settlement: its skills and Luck
    # figures describe the first boundary, not a re-run.
    assert second_receipt["result"]["skills_checked"] == ["Spot Hidden"]
    assert len(_luck_recovery_rows(campaign_ws)) == 1
    assert _current_luck(campaign_ws) == luck_after_first

    settlement_records = list(
        (campaign_ws["campaign_dir"] / "save" / "development-settlements" / "endings")
        .glob(f"*/{campaign_ws['investigator_id']}.json")
    )
    assert len(settlement_records) == 1
    ledger = _boundary_ledger(campaign_ws)
    assert ledger is not None
    assert len(ledger["boundaries"]) == 1
    assert ledger["boundaries"][0]["session_ids"]


def test_session_begin_opens_a_fresh_settlement_boundary(campaign_ws):
    _earn_spot_hidden_tick(campaign_ws)
    first = _end_session(campaign_ws, "ending-one")
    assert first["data"]["development"]["settlements"][0]["receipt"][
        "result"
    ]["skills_checked"] == ["Spot Hidden"]
    assert len(_luck_recovery_rows(campaign_ws)) == 1
    luck_after_first = _current_luck(campaign_ws)

    begun = _run(
        campaign_ws, "session.begin", {"decision_id": "begin-session-two"}
    )
    assert begun["ok"] is True, begun
    assert begun["data"]["table_session_seq"] == 2
    assert begun["data"]["session_key"].endswith(":session:2")

    replay = _run(
        campaign_ws, "session.begin", {"decision_id": "begin-session-two"}
    )
    assert replay["ok"] is True
    assert replay["data"] == begun["data"]
    assert any(
        "duplicate decision_id" in warning for warning in replay["warnings"]
    )

    third = _end_session(campaign_ws, "ending-three")
    third_receipt = third["data"]["development"]["settlements"][0]["receipt"]
    assert third_receipt.get("replayed") is not True
    assert third_receipt["result"]["skills_checked"] == []
    assert len(_luck_recovery_rows(campaign_ws)) == 2

    session_state = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "session-state.json").read_text(
            encoding="utf-8"
        )
    )
    assert session_state == {"schema_version": 1, "table_session_seq": 2}
    settlement_records = sorted(
        (campaign_ws["campaign_dir"] / "save" / "development-settlements" / "endings")
        .glob(f"*/{campaign_ws['investigator_id']}.json")
    )
    assert len(settlement_records) == 2
    ledger = _boundary_ledger(campaign_ws)
    assert ledger is not None
    assert len(ledger["boundaries"]) == 2
    boundary_sessions = [
        row["session_ids"] for row in ledger["boundaries"]
    ]
    assert boundary_sessions[1] == [begun["data"]["session_key"]]
    assert _current_luck(campaign_ws) >= luck_after_first


def test_session_state_seeded_at_campaign_create(campaign_ws):
    session_state = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "session-state.json").read_text(
            encoding="utf-8"
        )
    )
    assert session_state == {"schema_version": 1, "table_session_seq": 1}
