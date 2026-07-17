"""W2-2: investigator development phase engine (Keeper Rulebook p.94-95)."""
from __future__ import annotations

import importlib.util
import json
import random
from pathlib import Path

import pytest


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_development = _load(
    "coc_development", "plugins/coc-keeper/scripts/coc_development.py"
)
coc_sanity = _load("coc_sanity", "plugins/coc-keeper/scripts/coc_sanity.py")


def _campaign_with_investigator(tmp_path: Path, *, skills: dict | None = None,
                                luck: int = 40) -> tuple[Path, str]:
    """Layout: <root>/.coc/campaigns/<id> + <root>/.coc/investigators/<id>."""
    root = tmp_path / ".coc"
    camp = root / "campaigns" / "case-1"
    (camp / "save" / "investigator-state").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    inv_id = "ada"
    inv_dir = root / "investigators" / inv_id
    inv_dir.mkdir(parents=True)
    sheet = {
        "schema_version": 1,
        "id": inv_id,
        "name": "Ada",
        "characteristics": {"LUCK": luck, "POW": 50, "INT": 70},
        "derived": {"HP": 11, "MP": 10, "SAN": 50, "Luck": luck},
        "skills": skills or {
            "Spot Hidden": 45,
            "Library Use": 60,
            "Cthulhu Mythos": 5,
            "Credit Rating": 40,
            "Persuade": 88,
        },
    }
    (inv_dir / "character.json").write_text(json.dumps(sheet), encoding="utf-8")
    (inv_dir / "development.jsonl").write_text("", encoding="utf-8")
    (camp / "save" / "investigator-state" / f"{inv_id}.json").write_text(
        json.dumps({
            "schema_version": 1,
            "campaign_id": "case-1",
            "investigator_id": inv_id,
            "current_luck": luck,
            "current_san": 50,
            "current_hp": 11,
            "current_mp": 10,
            "conditions": [],
            "skill_checks_earned": [],
        }),
        encoding="utf-8",
    )
    (camp / "save" / "pacing-state.json").write_text(
        json.dumps({
            "schema_version": 1,
            "campaign_id": "case-1",
            "luck_spent_last": 0,
            "tension_level": "low",
            "turn_number": 0,
        }),
        encoding="utf-8",
    )
    return camp, inv_id


def _read_ticks(camp: Path, inv_id: str) -> list[dict]:
    path = camp.parents[1] / "investigators" / inv_id / "development.jsonl"
    if not path.exists() or not path.read_text(encoding="utf-8").strip():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _success_result(skill: str = "Spot Hidden", **extra) -> dict:
    base = {
        "skill": skill,
        "outcome": "regular_success",
        "success": True,
        "roll": 22,
        "target": 45,
        "kind": "skill_check",
    }
    base.update(extra)
    return base


# ---------------------------------------------------------------------------
# record_skill_tick — exclusion rules (structured fields only)
# ---------------------------------------------------------------------------

def test_record_tick_rejects_luck_spent_improvement_ineligible(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    result = _success_result(improvement_tick_eligible=False, luck_spent=5)
    assert coc_development.record_skill_tick(camp, inv_id, "Spot Hidden", result) is None
    assert _read_ticks(camp, inv_id) == []


def test_record_tick_rejects_bonus_die_only_success(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    result = _success_result(
        bonus=1,
        penalty=0,
        tens_values=[8, 1],  # physical base tens fails; appended bonus tens succeeds
        units=2,
        roll=12,
        target=45,
        excluded_outcome="bonus_die_only_success",
    )
    assert coc_development.record_skill_tick(camp, inv_id, "Spot Hidden", result) is None
    assert _read_ticks(camp, inv_id) == []


def test_bonus_die_tick_uses_physical_base_die_in_both_orders(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    # Original 66 fails and appended bonus 06 succeeds: no development tick.
    excluded = _success_result(
        bonus=1,
        penalty=0,
        tens_values=[6, 0],
        units=6,
        roll=6,
        target=50,
    )
    assert coc_development.record_skill_tick(
        camp, inv_id, "Spot Hidden", excluded
    ) is None

    # Original 49 succeeds and appended bonus 59 is irrelevant: the natural
    # success remains eligible even though the extra tens die is larger.
    eligible = _success_result(
        bonus=1,
        penalty=0,
        tens_values=[4, 5],
        units=9,
        roll=49,
        target=50,
    )
    tick = coc_development.record_skill_tick(
        camp, inv_id, "Spot Hidden", eligible
    )
    assert tick is not None
    assert [row["skill"] for row in _read_ticks(camp, inv_id)] == ["Spot Hidden"]


def test_ending_capsule_rejects_symlinked_parent_escape(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    ending_id = "ending-symlink-escape"
    capsule = coc_development.build_ending_settlement_capsule(
        camp,
        {
            "event_type": "session_ending",
            "ending_id": ending_id,
            "scene_id": "finale",
            "kind": "cliffhanger",
            "decision_id": "capsule-symlink-escape",
            "investigator_ids": [inv_id],
            "ts": "2026-07-16T00:00:00Z",
        },
    )
    outside = tmp_path / "outside"
    outside.mkdir()
    endings = camp / "save" / "development-settlements" / "endings"
    endings.mkdir(parents=True)
    (endings / ending_id).symlink_to(outside, target_is_directory=True)

    with pytest.raises(ValueError, match="target is unsafe"):
        coc_development.persist_ending_settlement_capsule(camp, capsule)

    assert not (outside / "capsule.json").exists()


def test_record_tick_rejects_opposed_loser(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    result = _success_result(
        opposed_won=False,
        opposed_outcome="defender_higher",
        excluded_outcome="opposed_roll_loser",
    )
    assert coc_development.record_skill_tick(camp, inv_id, "Spot Hidden", result) is None
    assert _read_ticks(camp, inv_id) == []


def test_record_tick_rejects_cthulhu_mythos(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    result = _success_result(skill="Cthulhu Mythos")
    assert coc_development.record_skill_tick(
        camp, inv_id, "Cthulhu Mythos", result
    ) is None
    assert _read_ticks(camp, inv_id) == []


def test_record_tick_rejects_credit_rating(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    result = _success_result(skill="Credit Rating")
    assert coc_development.record_skill_tick(
        camp, inv_id, "Credit Rating", result
    ) is None
    assert _read_ticks(camp, inv_id) == []


def test_record_tick_appends_qualifying_success(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    result = _success_result()
    tick = coc_development.record_skill_tick(camp, inv_id, "Spot Hidden", result)
    assert tick is not None
    assert tick["skill"] == "Spot Hidden"
    assert "ts" in tick
    assert tick["roll"] == 22
    rows = _read_ticks(camp, inv_id)
    assert len(rows) == 1
    assert rows[0]["skill"] == "Spot Hidden"
    assert rows[0]["roll"] == 22


def test_same_skill_successes_receive_distinct_stable_event_tokens(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    first = coc_development.record_skill_tick(
        camp,
        inv_id,
        "Spot Hidden",
        _success_result(),
        source_event_id="rules.roll:first",
        source_kind="rules.roll",
    )
    second = coc_development.record_skill_tick(
        camp,
        inv_id,
        "Spot Hidden",
        _success_result(roll=23),
        source_event_id="rules.roll:second",
        source_kind="rules.roll",
    )
    replay = coc_development.record_skill_tick(
        camp,
        inv_id,
        "Spot Hidden",
        _success_result(),
        source_event_id="rules.roll:first",
        source_kind="rules.roll",
    )

    assert first is not None and second is not None and replay is not None
    assert first["event_token"] != second["event_token"]
    assert replay["event_token"] == first["event_token"]
    assert [row["event_token"] for row in _read_ticks(camp, inv_id)] == [
        first["event_token"], second["event_token"]
    ]


def test_consumed_event_replay_keeps_source_token_across_later_session(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    first = coc_development.record_skill_tick(
        camp,
        inv_id,
        "Spot Hidden",
        _success_result(),
        source_event_id="rules.roll:durable-replay",
        source_kind="rules.roll",
        session_id="case:session:1",
    )
    assert first is not None
    capsule = coc_development.build_ending_settlement_capsule(
        camp,
        {
            "event_type": "session_ending",
            "ending_id": "ending-durable-replay",
            "scene_id": "finale",
            "kind": "cliffhanger",
            "decision_id": "ending-durable-replay",
            "investigator_ids": [inv_id],
            "ts": "2026-07-16T00:00:00Z",
        },
    )
    development_input = capsule["development_inputs"][inv_id]
    coc_development.run_development_phase(
        camp,
        inv_id,
        ending_evidence=capsule,
        development_input=development_input,
    )
    assert _read_ticks(camp, inv_id) == []

    replay = coc_development.record_skill_tick(
        camp,
        inv_id,
        "Spot Hidden",
        _success_result(),
        source_event_id="rules.roll:durable-replay",
        source_kind="rules.roll",
        session_id="case:session:99",
    )

    assert replay is not None
    assert replay["event_token"] == first["event_token"]
    assert replay["session_id"] == "case:session:1"
    assert replay["development_event_status"] == "already_claimed"
    assert _read_ticks(camp, inv_id) == []
    ledger = json.loads((
        camp.parents[1] / "investigators" / inv_id
        / "development-claims.json"
    ).read_text(encoding="utf-8"))
    assert ledger["schema_version"] == 3
    assert ledger["events"][first["event_token"]]["source_event_id"] == (
        "rules.roll:durable-replay"
    )


def test_capsule_does_not_treat_investigator_projection_as_tick_source(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    tick = coc_development.record_skill_tick(
        camp,
        inv_id,
        "Spot Hidden",
        _success_result(),
        source_event_id="rules.roll:identity-conflict",
        source_kind="rules.roll",
    )
    assert tick is not None
    state_path = camp / "save" / "investigator-state" / f"{inv_id}.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["skill_checks_earned"] = ["Listen"]
    state["skill_check_events"] = [{
        "event_token": tick["event_token"],
        "skill": "Listen",
        "campaign_id": tick["campaign_id"],
        "session_id": tick["session_id"],
        "source_kind": tick["source_kind"],
        "source_event_id": tick["source_event_id"],
    }]
    state_path.write_text(json.dumps(state), encoding="utf-8")

    capsule = coc_development.build_ending_settlement_capsule(
        camp,
        {
            "event_type": "session_ending",
            "ending_id": "ending-event-token-conflict",
            "scene_id": "finale",
            "kind": "cliffhanger",
            "decision_id": "event-token-conflict",
            "investigator_ids": [inv_id],
            "ts": "2026-07-16T00:00:00Z",
        },
    )
    assert capsule["development_inputs"][inv_id]["skills_checked"] == [
        "Spot Hidden"
    ]
    archive = json.loads((
        camp.parents[1] / "investigators" / inv_id / "development-claims.json"
    ).read_text(encoding="utf-8"))
    assert archive["claims"][tick["event_token"]]["ending_id"] == (
        "ending-event-token-conflict"
    )
    assert list(archive["events"]) == [tick["event_token"]]


def test_two_campaign_capsules_can_claim_one_reusable_event_only_once(tmp_path):
    camp_a, inv_id = _campaign_with_investigator(
        tmp_path, skills={"Custom Skill": 0}
    )
    camp_b = camp_a.parent / "case-2"
    (camp_b / "save" / "investigator-state").mkdir(parents=True)
    (camp_b / "logs").mkdir(parents=True)
    (camp_b / "campaign.json").write_text(
        json.dumps({"campaign_id": "case-2"}), encoding="utf-8"
    )
    (camp_b / "save" / "investigator-state" / f"{inv_id}.json").write_text(
        json.dumps({
            "schema_version": 1,
            "campaign_id": "case-2",
            "investigator_id": inv_id,
            "current_luck": 40,
            "current_san": 50,
            "current_hp": 11,
            "current_mp": 10,
            "conditions": [],
            "max_san": 99,
            "skill_checks_earned": [],
        }),
        encoding="utf-8",
    )
    (camp_b / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "case-2",
        "luck_spent_last": 0,
        "tension_level": "low",
        "turn_number": 0,
    }), encoding="utf-8")
    tick = coc_development.record_skill_tick(
        camp_a,
        inv_id,
        "Custom Skill",
        _success_result(skill="Custom Skill"),
        source_event_id="shared-reusable-roll",
        source_kind="rules.roll",
    )
    assert tick is not None

    def capsule(campaign: Path, ending_id: str, decision_id: str):
        return coc_development.build_ending_settlement_capsule(
            campaign,
            {
                "event_type": "session_ending",
                "ending_id": ending_id,
                "scene_id": "finale",
                "kind": "cliffhanger",
                "decision_id": decision_id,
                "investigator_ids": [inv_id],
                "ts": "2026-07-16T00:00:00Z",
            },
        )

    capsule_a = capsule(camp_a, "ending-campaign-a", "decision-campaign-a")
    capsule_b = capsule(camp_b, "ending-campaign-b", "decision-campaign-b")
    input_a = capsule_a["development_inputs"][inv_id]
    input_b = capsule_b["development_inputs"][inv_id]

    assert input_a["input_tokens"] == [tick["event_token"]]
    assert input_b["input_tokens"] == []
    settled_a = coc_development.run_development_phase(
        camp_a,
        inv_id,
        ending_evidence=capsule_a,
        development_input=input_a,
    )
    settled_b = coc_development.run_development_phase(
        camp_b,
        inv_id,
        ending_evidence=capsule_b,
        development_input=input_b,
    )
    assert settled_a["skills_checked"] == ["Custom Skill"]
    assert settled_b["skills_checked"] == []
    claims = json.loads((
        camp_a.parents[1] / "investigators" / inv_id
        / "development-claims.json"
    ).read_text(encoding="utf-8"))["claims"]
    assert claims[tick["event_token"]]["ending_id"] == "ending-campaign-a"


def test_canonical_san_baseline_preserves_zero_maximum(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    canonical = coc_sanity.sanity_snapshot_path(camp, inv_id)
    canonical.parent.mkdir(parents=True, exist_ok=True)
    canonical.write_text(json.dumps({
        "investigator_id": inv_id,
        "san_current": 0,
        "san_max": 0,
        "awfulness_caps": {},
    }), encoding="utf-8")

    baseline, source_path = coc_development._sanity_mechanical_baseline(
        camp, inv_id
    )

    assert source_path == canonical
    assert baseline == {
        "source": "canonical",
        "current": 0,
        "max": 0,
        "awfulness_caps": {},
    }


# ---------------------------------------------------------------------------
# current-schema settlement and clean-slate rejection
# ---------------------------------------------------------------------------

def _current_capsule(camp: Path, inv_id: str, skill: str = "Spot Hidden") -> dict:
    tick = coc_development.record_skill_tick(
        camp,
        inv_id,
        skill,
        _success_result(skill=skill),
        source_event_id=f"rules.roll:{skill}",
        source_kind="rules.roll",
    )
    assert tick is not None
    return coc_development.build_ending_settlement_capsule(
        camp,
        {
            "event_type": "session_ending",
            "ending_id": "ending-current-development",
            "scene_id": "finale",
            "kind": "cliffhanger",
            "decision_id": "ending-current-development",
            "investigator_ids": [inv_id],
            "ts": "2026-07-16T00:00:00Z",
        },
    )


def test_current_capsule_applies_frozen_plan_and_consumes_exact_token(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    state_path = camp / "save" / "investigator-state" / f"{inv_id}.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["schema_version"] = 1
    state["campaign_id"] = "case-1"
    state["investigator_id"] = inv_id
    state_path.write_text(json.dumps(state), encoding="utf-8")
    capsule = _current_capsule(camp, inv_id)
    development_input = capsule["development_inputs"][inv_id]

    result = coc_development.run_development_phase(
        camp,
        inv_id,
        ending_evidence=capsule,
        development_input=development_input,
    )

    assert result["skills_checked"] == ["Spot Hidden"]
    assert result["settlement_plan_sha256"] == development_input[
        "deterministic_plan"
    ]["plan_sha256"]
    assert result["input_tokens_consumed"] == development_input["input_tokens"]
    assert _read_ticks(camp, inv_id) == []


def test_unversioned_development_row_is_rejected_without_rewrite(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    path = camp.parents[1] / "investigators" / inv_id / "development.jsonl"
    original = json.dumps({
        "skill": "Spot Hidden", "ts": "2026-01-01T00:00:00Z", "roll": 20,
    }) + "\n"
    path.write_text(original, encoding="utf-8")

    with pytest.raises(ValueError, match="unsupported schema"):
        coc_development.build_ending_settlement_capsule(
            camp,
            {
                "event_type": "session_ending",
                "ending_id": "ending-old-tick",
                "scene_id": "finale",
                "kind": "cliffhanger",
                "decision_id": "ending-old-tick",
                "investigator_ids": [inv_id],
                "ts": "2026-07-16T00:00:00Z",
            },
        )
    assert path.read_text(encoding="utf-8") == original


def test_v1_claim_ledger_is_rejected_instead_of_migrated(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    ledger = camp.parents[1] / "investigators" / inv_id / "development-claims.json"
    ledger.write_text(json.dumps({
        "schema_version": 1,
        "investigator_id": inv_id,
        "claims": {},
    }), encoding="utf-8")

    with pytest.raises(ValueError, match="claim ledger identity"):
        coc_development.record_skill_tick(
            camp,
            inv_id,
            "Spot Hidden",
            _success_result(),
            source_event_id="rules.roll:old-ledger",
            source_kind="rules.roll",
        )
    assert json.loads(ledger.read_text(encoding="utf-8"))["schema_version"] == 1


def test_legacy_singleton_san_is_not_a_development_baseline(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    legacy = camp / "save" / "sanity.json"
    legacy.write_text(json.dumps({
        "investigator_id": inv_id,
        "san_current": 3,
        "san_max": 4,
        "awfulness_caps": {"ghoul": 9},
    }), encoding="utf-8")

    baseline, source_path = coc_development._sanity_mechanical_baseline(
        camp, inv_id
    )

    assert source_path.name == f"{inv_id}.json"
    assert baseline["source"] == "investigator_state"
    assert baseline["current"] == 50
    assert baseline["max"] == 99
