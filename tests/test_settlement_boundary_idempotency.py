"""Boundary-idempotent post-session settlement.

One settlement per (session_id, investigator_id, settlement_type): a repeat
``development.settle`` for an already-settled session/chapter boundary returns
the original receipt payload plus explicit replay provenance, with no new rolls
or state diffs, and the battle report renders settlement from the canonical
boundary receipt(s).
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


ops = _load(
    "coc_runtime_ops_boundary_test",
    REPO / "plugins" / "coc-keeper" / "scripts" / "coc_runtime_ops.py",
)
state = _load(
    "coc_state_boundary_test",
    REPO / "plugins" / "coc-keeper" / "scripts" / "coc_state.py",
)
exporter = _load(
    "coc_export_boundary_test",
    REPO
    / "plugins"
    / "coc-keeper"
    / "skills"
    / "coc-export-battle-report"
    / "scripts"
    / "export_battle_report.py",
)

SETTLE = {"schema_version": 1, "kind": "development.settle", "payload": {}}


def _read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _workspace(root: Path) -> Path:
    state.create_campaign(root, "camp", "Boundary Campaign")
    sheet = {
        "schema_version": 1,
        "id": "inv",
        "investigator_id": "inv",
        "name": "Boundary Investigator",
        "characteristics": {"POW": 60, "INT": 70, "LUCK": 50},
        "derived": {"HP": 12, "SAN": 60, "MP": 12},
        "skills": {"Spot Hidden": 20},
    }
    state.create_investigator(root, "inv", sheet)
    state.link_party(root, "camp", ["inv"])
    (root / ".coc" / "runtime.json").write_text(
        json.dumps({
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        }),
        encoding="utf-8",
    )
    return root / ".coc" / "investigators" / "inv" / "character.json"


def _record_tick(campaign: Path, source: str) -> None:
    tick = ops.coc_development.record_skill_tick(
        campaign,
        "inv",
        "Spot Hidden",
        {
            "skill": "Spot Hidden",
            "outcome": "regular_success",
            "success": True,
            "roll": 20,
            "target": 50,
            "kind": "skill_check",
        },
        source_event_id=source,
        source_kind="runtime-test",
    )
    assert tick is not None


def _persist_ending(campaign: Path, decision_id: str) -> dict:
    record = {
        "event_type": "session_ending",
        "scene_id": "finale",
        "kind": "conclusion",
        "decision_id": decision_id,
        "investigator_ids": ["inv"],
        "ts": "2026-07-24T00:00:00Z",
    }
    record["ending_id"] = ops.coc_development.ending_id_for_event(record)
    record["event_id"] = ops.coc_development.ending_event_id(record["ending_id"])
    capsule = ops.coc_development.build_ending_settlement_capsule(campaign, record)
    capsule_path = ops.coc_development.persist_ending_settlement_capsule(
        campaign, capsule
    )
    record["settlement_capsule_ref"] = capsule_path.relative_to(
        campaign
    ).as_posix()
    record["settlement_capsule_sha256"] = capsule["capsule_sha256"]
    events = campaign / "logs" / "events.jsonl"
    events.parent.mkdir(parents=True, exist_ok=True)
    with events.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record) + "\n")
    return capsule


def _settle(root: Path, character: Path, seed: int) -> dict:
    return ops.execute_operation(
        root,
        campaign_id="camp",
        investigator_id="inv",
        character_path=character,
        operation=SETTLE,
        rng_seed=seed,
    )


def _luck_rolls(campaign: Path) -> list[dict]:
    return [
        row
        for row in _read_jsonl(campaign / "logs" / "rolls.jsonl")
        if row.get("payload", {}).get("kind") == "luck_recovery"
    ]


def _development_events(campaign: Path) -> list[dict]:
    return [
        row
        for row in _read_jsonl(campaign / "logs" / "events.jsonl")
        if row.get("type") == "development"
    ]


def _assert_replay_of(replay: dict, original: dict) -> None:
    replay_payload = dict(replay)
    provenance = {
        "replayed": replay_payload.pop("replayed"),
        "replayed_from_boundary_id": replay_payload.pop(
            "replayed_from_boundary_id"
        ),
        "replayed_from_ending_id": replay_payload.pop("replayed_from_ending_id"),
    }
    assert replay_payload == original
    assert provenance == {
        "replayed": True,
        "replayed_from_boundary_id": original["result"]["settlement_boundary"][
            "boundary_id"
        ],
        "replayed_from_ending_id": original["result"]["ending_evidence"][
            "ending_id"
        ],
    }


def _ledger(campaign: Path) -> dict:
    path = (
        campaign
        / "save"
        / "development-settlements"
        / "boundaries"
        / "inv.json"
    )
    return json.loads(path.read_text(encoding="utf-8"))


def test_duplicate_boundary_settlement_replays_original_receipt(tmp_path):
    character = _workspace(tmp_path)
    campaign = tmp_path / ".coc" / "campaigns" / "camp"
    _record_tick(campaign, "runtime-test:boundary-tick")
    _persist_ending(campaign, "boundary-ending-one")
    first = _settle(tmp_path, character, 4)
    assert first["result"]["improvement_checks"]
    boundary = first["result"]["settlement_boundary"]
    assert boundary["settlement_types"] == [
        "skill_development",
        "luck_recovery",
    ]
    rolls_before = (campaign / "logs" / "rolls.jsonl").read_bytes()
    events_before = (campaign / "logs" / "events.jsonl").read_bytes()
    luck_before = json.loads(
        (campaign / "save" / "investigator-state" / "inv.json").read_text()
    )["current_luck"]

    # A second ending at the same boundary: no new earned inputs, so the
    # original receipt is replayed without new rolls or state diffs.
    _persist_ending(campaign, "boundary-ending-two")
    second = _settle(tmp_path, character, 999)
    _assert_replay_of(second, first)
    assert (campaign / "logs" / "rolls.jsonl").read_bytes() == rolls_before
    assert (campaign / "logs" / "events.jsonl").read_bytes() != events_before  # ending event only
    assert len(_development_events(campaign)) == 1
    assert len(_luck_rolls(campaign)) == 1
    assert json.loads(
        (campaign / "save" / "investigator-state" / "inv.json").read_text()
    )["current_luck"] == luck_before

    # A third ending behaves identically.
    _persist_ending(campaign, "boundary-ending-three")
    third = _settle(tmp_path, character, 7)
    _assert_replay_of(third, first)
    assert len(_luck_rolls(campaign)) == 1

    ledger = _ledger(campaign)
    assert len(ledger["boundaries"]) == 1
    entry = ledger["boundaries"][0]
    assert entry["boundary_id"] == boundary["boundary_id"]
    assert set(entry["settlement_types"]) == {
        "skill_development",
        "luck_recovery",
    }
    assert entry["first_ending_id"] == first["result"]["ending_evidence"]["ending_id"]


def test_new_earned_inputs_open_a_new_boundary(tmp_path):
    character = _workspace(tmp_path)
    campaign = tmp_path / ".coc" / "campaigns" / "camp"
    _record_tick(campaign, "runtime-test:session-one-tick")
    _persist_ending(campaign, "session-one-ending")
    first = _settle(tmp_path, character, 11)

    _record_tick(campaign, "runtime-test:session-two-tick")
    _persist_ending(campaign, "session-two-ending")
    second = _settle(tmp_path, character, 11)

    assert second["operation_id"] != first["operation_id"]
    assert (
        second["result"]["settlement_boundary"]["boundary_id"]
        != first["result"]["settlement_boundary"]["boundary_id"]
    )
    assert second["result"]["skills_checked"] == ["Spot Hidden"]
    assert second["result"]["luck_recovery"]["roll"] is not None
    assert len(_luck_rolls(campaign)) == 2
    ledger = _ledger(campaign)
    assert len(ledger["boundaries"]) == 2


def test_empty_first_boundary_settles_once_then_replays(tmp_path):
    character = _workspace(tmp_path)
    campaign = tmp_path / ".coc" / "campaigns" / "camp"
    _persist_ending(campaign, "empty-ending-one")
    first = _settle(tmp_path, character, 3)
    assert first["result"]["luck_recovery"]["roll"] is not None
    assert first["result"]["settlement_boundary"]["session_ids"] == [
        "camp:session:1"
    ]

    _persist_ending(campaign, "empty-ending-two")
    second = _settle(tmp_path, character, 5)
    _assert_replay_of(second, first)
    assert len(_luck_rolls(campaign)) == 1
    assert len(_ledger(campaign)["boundaries"]) == 1


def test_invalid_boundary_ledger_is_rejected_without_mutation(tmp_path):
    character = _workspace(tmp_path)
    campaign = tmp_path / ".coc" / "campaigns" / "camp"
    _record_tick(campaign, "runtime-test:schema-tick")
    _persist_ending(campaign, "schema-ending")
    ledger_path = (
        campaign
        / "save"
        / "development-settlements"
        / "boundaries"
        / "inv.json"
    )
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    legacy = {"schema_version": 0, "investigator_id": "inv", "boundaries": []}
    ledger_path.write_text(json.dumps(legacy), encoding="utf-8")

    with pytest.raises(Exception, match="boundary ledger"):
        _settle(tmp_path, character, 4)

    assert json.loads(ledger_path.read_text(encoding="utf-8")) == legacy
    assert _luck_rolls(campaign) == []
    assert _development_events(campaign) == []


def test_report_renders_canonical_boundary_receipt_not_last_ending(tmp_path):
    """Smoke-run shape: three endings, one real settlement at the first."""
    character = _workspace(tmp_path)
    campaign = tmp_path / ".coc" / "campaigns" / "camp"
    _record_tick(campaign, "runtime-test:report-tick")
    _persist_ending(campaign, "report-ending-one")
    first = _settle(tmp_path, character, 4)
    _persist_ending(campaign, "report-ending-two")
    _assert_replay_of(_settle(tmp_path, character, 8), first)
    _persist_ending(campaign, "report-ending-three")
    _assert_replay_of(_settle(tmp_path, character, 9), first)

    run = tmp_path / "run"
    run_campaign = run / "sandbox" / ".coc" / "campaigns" / "camp"
    import shutil

    shutil.copytree(tmp_path / ".coc", run / "sandbox" / ".coc")
    (run / "run.json").write_text(
        json.dumps({"run_id": "run-1", "campaign_id": "camp", "seed": 17}),
        encoding="utf-8",
    )
    (run / "transcript.jsonl").write_text(
        json.dumps({"turn": 1, "role": "keeper_under_test", "text": "KP"})
        + "\n"
        + json.dumps({"turn": 2, "role": "player_simulator", "text": "玩家"})
        + "\n",
        encoding="utf-8",
    )

    result = exporter.export_battle_report(run)
    payload = json.loads(
        (run / "artifacts" / "battle-report-evidence.json").read_text(
            encoding="utf-8"
        )
    )
    settlements = payload["development_settlements"]
    assert len(settlements) == 1
    settlement = settlements[0]
    first_ending_id = first["result"]["ending_evidence"]["ending_id"]
    assert settlement["ending_ordinal"] == 1
    assert "ending_id" not in settlement
    assert "boundary_id" not in settlement
    assert set(settlement["settlement_types"]) == {
        "skill_development",
        "luck_recovery",
    }
    planned_luck = first["result"]["luck_recovery"]
    assert settlement["luck_recovery"]["luck_before"] == (
        planned_luck["planned_luck_before"]
    )
    assert settlement["luck_recovery"]["gained"] == planned_luck["gained"]
    markdown = (run / "artifacts" / "battle-report.md").read_text(
        encoding="utf-8"
    )
    # The canonical receipt's real Luck movement renders; the last ending's
    # empty replay does not hide it.
    assert (
        f"Luck: {planned_luck['planned_luck_before']} → "
        f"{planned_luck['luck_after']}"
    ) in markdown
    assert "report_id" not in result
    validation = (run / "artifacts" / "audit" / "report-validation.json").read_text(
        encoding="utf-8"
    )
    assert first_ending_id in validation


def test_report_covers_every_ending_receipt_for_pre_ledger_runs(tmp_path):
    """Historical runs without a boundary ledger keep every receipt visible."""
    run = tmp_path / "run"
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    investigator = run / "sandbox" / ".coc" / "investigators" / "ada"
    (campaign / "logs").mkdir(parents=True)
    investigator.mkdir(parents=True)
    (run / "run.json").write_text(
        json.dumps({"run_id": "run-1", "campaign_id": "case-1", "seed": 17}),
        encoding="utf-8",
    )
    (campaign / "party.json").write_text(
        json.dumps({"investigator_ids": ["ada"]}), encoding="utf-8"
    )
    (investigator / "character.json").write_text(
        json.dumps({"id": "ada", "name": "Ada", "skills": {}}),
        encoding="utf-8",
    )
    endings = []
    for suffix, luck_before, luck_after, gained in (
        ("one", 55, 65, 10),
        ("two", 65, 65, 0),
    ):
        ending_id = f"ending-{suffix}"
        endings.append({
            "event_type": "session_ending",
            "ending_id": ending_id,
            "scene_id": "finale",
            "kind": "conclusion",
            "summary": f"ending {suffix}",
            "settlement_capsule_ref": (
                f"save/development-settlements/endings/{ending_id}/capsule.json"
            ),
        })
        receipt_path = (
            campaign
            / "save"
            / "development-settlements"
            / "endings"
            / ending_id
            / "ada.json"
        )
        receipt_path.parent.mkdir(parents=True, exist_ok=True)
        receipt_path.write_text(json.dumps({
            "ending_id": ending_id,
            "investigator_id": "ada",
            "receipt": {
                "status": "PASS",
                "result": {
                    "improvement_checks": [],
                    "luck_recovery": {
                        "roll": 66,
                        "success": gained > 0,
                        "gained": gained,
                        "luck_before": luck_before,
                        "luck_after": luck_after,
                    },
                },
            },
        }), encoding="utf-8")
    (campaign / "logs" / "events.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in endings), encoding="utf-8"
    )
    (campaign / "logs" / "rolls.jsonl").write_text("", encoding="utf-8")
    (run / "transcript.jsonl").write_text(
        json.dumps({"turn": 1, "role": "keeper_under_test", "text": "KP"})
        + "\n"
        + json.dumps({"turn": 2, "role": "player_simulator", "text": "玩家"})
        + "\n",
        encoding="utf-8",
    )

    exporter.export_battle_report(run)
    payload = json.loads(
        (run / "artifacts" / "battle-report-evidence.json").read_text(
            encoding="utf-8"
        )
    )
    settlements = payload["development_settlements"]
    assert len(settlements) == 2
    assert [row["ending_ordinal"] for row in settlements] == [1, 2]
    assert all("ending_id" not in row for row in settlements)
    first = next(row for row in settlements if row["ending_ordinal"] == 1)
    assert first["luck_recovery"]["luck_before"] == 55
    assert first["luck_recovery"]["luck_after"] == 65
    markdown = (run / "artifacts" / "battle-report.md").read_text(
        encoding="utf-8"
    )
    assert "Luck: 55 → 65" in markdown
    evidence_text = (run / "artifacts" / "battle-report-evidence.json").read_text(
        encoding="utf-8"
    )
    primary = markdown + evidence_text
    assert "ending-one" not in primary
    assert "ending-two" not in primary
    validation = (run / "artifacts" / "audit" / "report-validation.json").read_text(
        encoding="utf-8"
    )
    assert "ending-one" in validation
    assert "ending-two" in validation
