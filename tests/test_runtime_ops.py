from __future__ import annotations

import importlib.util
import hashlib
import json
import os
import random
import subprocess
import sys
import time
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
    "coc_runtime_ops_test",
    REPO / "plugins" / "coc-keeper" / "scripts" / "coc_runtime_ops.py",
)
state = _load(
    "coc_state_runtime_ops_test",
    REPO / "plugins" / "coc-keeper" / "scripts" / "coc_state.py",
)
module_project = _load(
    "coc_module_project_runtime_ops_test",
    REPO / "plugins" / "coc-keeper" / "scripts" / "coc_module_project.py",
)
toolbox = _load(
    "coc_toolbox_runtime_ops_test",
    REPO / "plugins" / "coc-keeper" / "scripts" / "coc_toolbox.py",
)


_QUICK_FIRE_ORDER = (
    "DEX", "INT", "POW", "EDU", "CON", "SIZ", "APP", "STR",
)
_QUICK_FIRE_OCCUPATION_ALLOCATIONS = {
    "Credit Rating": 20,
    "Spot Hidden": 40,
    "Library Use": 40,
    "Psychology": 30,
    "Fast Talk": 30,
    "History": 40,
}
_QUICK_FIRE_INTEREST_ALLOCATIONS = {
    "Listen": 40,
    "Stealth": 40,
    "Occult": 30,
    "First Aid": 30,
}


def _complete_quick_fire_skills() -> tuple[dict[str, int], dict]:
    characteristics = dict(zip(
        _QUICK_FIRE_ORDER,
        (80, 70, 60, 60, 50, 50, 50, 40),
        strict=True,
    ))
    rule_table = ops.coc_character.coc_rules.load_rule_table("skills")
    catalog = rule_table["skills"]
    required = set(
        rule_table["standard_sheet"]["1920s"]["default_skill_ids"]
    ) | set(_QUICK_FIRE_OCCUPATION_ALLOCATIONS) | set(
        _QUICK_FIRE_INTEREST_ALLOCATIONS
    )
    skills: dict[str, int] = {}
    for skill_id, spec in catalog.items():
        if skill_id not in required:
            continue
        base = spec["base_chance"]
        if base == "half_DEX":
            base = characteristics["DEX"] // 2
        elif base == "EDU":
            base = characteristics["EDU"]
        skills[skill_id] = (
            int(base)
            + _QUICK_FIRE_OCCUPATION_ALLOCATIONS.get(skill_id, 0)
            + _QUICK_FIRE_INTEREST_ALLOCATIONS.get(skill_id, 0)
        )
    return skills, {
        "occupation_points": {
            "budget": 200,
            "spent": 200,
            "allocations": dict(_QUICK_FIRE_OCCUPATION_ALLOCATIONS),
        },
        "personal_interest_points": {
            "budget": 140,
            "spent": 140,
            "allocations": dict(_QUICK_FIRE_INTEREST_ALLOCATIONS),
        },
    }


def _guided_quick_fire_payload(
    tmp_path: Path,
    *,
    investigator_id: str,
    decision_id: str,
) -> dict:
    ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "campaign.create",
        "payload": {
            "campaign_id": "guided",
            "title": "Guided",
            "era": "1920s",
        },
    })
    luck = toolbox.run_tool(
        "rules.roll_dice",
        tmp_path,
        "guided",
        {
            "expression": "3D6",
            "decision_id": decision_id,
            "purpose": "investigator_creation_luck",
            "reason": "guided fixture",
            "seed": 31,
        },
    )
    skills, skill_budget = _complete_quick_fire_skills()
    return {
        "campaign_id": "guided",
        "investigator_id": investigator_id,
        "sheet": {
            "id": investigator_id,
            "name": "Guided Investigator",
            "age": 29,
            "skills": skills,
            "player_facing_sheet_zh": {
                "display_name": "引导式调查员",
                "skills": [],
            },
        },
        "creation": {
            "input_mode": "guided_quick_fire",
            "method": "quick_fire_array",
            "characteristic_assignment_order": list(_QUICK_FIRE_ORDER),
            "luck_roll_total": luck["data"]["total"],
            "luck_roll_receipt": {
                "campaign_id": "guided",
                "decision_id": decision_id,
                "roll_id": luck["data"]["roll_id"],
            },
            "skill_budget": skill_budget,
        },
    }


def _read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _workspace(root: Path) -> Path:
    state.create_campaign(root, "camp", "Parity Campaign")
    sheet = {
        "schema_version": 1,
        "id": "inv",
        "investigator_id": "inv",
        "name": "Parity Investigator",
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


def _seed_structured_combat_conclusion(
    campaign: Path,
    *,
    scene_id: str = "corbitt-confrontation",
    outcome: str = "investigators_win",
) -> None:
    combat_id = f"combat-{scene_id}"
    (campaign / "save" / "combat.json").write_text(json.dumps({
        "schema_version": 2,
        "combat_id": combat_id,
        "scene_ref": f"scene/{scene_id}",
        "status": "concluded",
        "outcome": outcome,
    }), encoding="utf-8")
    events = campaign / "logs" / "events.jsonl"
    events.parent.mkdir(parents=True, exist_ok=True)
    with events.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({
            "event_type": "combat_ended",
            "combat_id": combat_id,
            "outcome": outcome,
        }) + "\n")


def _persist_current_ending(campaign: Path, event: dict) -> dict:
    record = dict(event)
    record.setdefault("investigator_ids", ["inv"])
    record.setdefault("ts", "2026-07-15T00:00:00Z")
    record.setdefault(
        "ending_id", ops.coc_development.ending_id_for_event(record)
    )
    record["event_id"] = ops.coc_development.ending_event_id(record["ending_id"])
    capsule = ops.coc_development.build_ending_settlement_capsule(
        campaign, record
    )
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


def _record_current_tick(
    campaign: Path, skill: str = "Spot Hidden", source: str = "runtime-test:tick"
) -> dict:
    tick = ops.coc_development.record_skill_tick(
        campaign,
        "inv",
        skill,
        {
            "skill": skill,
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
    return tick


def _without_capsule_source_digests(receipt: dict) -> dict:
    normalized = json.loads(json.dumps(receipt))
    ending = normalized.get("result", {}).get("ending_evidence")
    if isinstance(ending, dict):
        normalized["result"]["ending_evidence"] = {
            "ending_id": ending.get("ending_id"),
            "event_id": ending.get("event_id"),
            "conclusion_id": ending.get("conclusion_id"),
        }
    return normalized


def _prepare_development_cliffhanger(root: Path) -> tuple[Path, Path, dict]:
    character = _workspace(root)
    campaign = root / ".coc" / "campaigns" / "camp"
    inv_state = campaign / "save" / "investigator-state" / "inv.json"
    inv_state.write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "camp",
        "investigator_id": "inv",
        "current_luck": 50,
        "current_san": 60,
        "current_hp": 12,
        "current_mp": 12,
        "skill_checks_earned": [],
    }), encoding="utf-8")
    tick = ops.coc_development.record_skill_tick(
        campaign,
        "inv",
        "Spot Hidden",
        {
            "skill": "Spot Hidden",
            "outcome": "regular_success",
            "success": True,
            "roll": 20,
            "target": 20,
            "kind": "skill_check",
        },
        source_event_id="runtime-test:spot-hidden",
        source_kind="runtime-test",
    )
    assert tick is not None
    _persist_current_ending(campaign, {
        "event_type": "session_ending",
        "scene_id": "finale",
        "kind": "cliffhanger",
        "decision_id": "ending-crash-interleave",
        "investigator_ids": ["inv"],
        "ts": "2026-07-15T00:00:00Z",
    })
    operation = {"schema_version": 1, "kind": "development.settle", "payload": {}}
    return character, campaign, operation


def _exact_development_paths(
    campaign: Path, investigator_id: str = "inv"
) -> tuple[str, Path, Path]:
    ending = ops.coc_development.structured_ending_evidence(campaign)
    assert ending is not None
    ending_id = str(ending["ending_id"])
    settlement = ops.coc_development.ending_settlement_path(
        campaign, ending_id, investigator_id
    )
    return ending_id, settlement, settlement.with_name(
        f"{investigator_id}.inflight.json"
    )


def _prepared_development_journal(
    root: Path,
) -> tuple[Path, Path, Path, Path, dict]:
    character, campaign, _operation = _prepare_development_cliffhanger(root)
    ending = ops.coc_development.structured_ending_evidence(campaign)
    assert ending is not None
    ending_id, settlement, inflight = _exact_development_paths(campaign)
    rng = random.Random(5)
    journal = ops._capture_development_inflight(
        campaign_dir=campaign,
        investigator_id="inv",
        ending_id=ending_id,
        settlement_path=settlement,
        inflight_path=inflight,
        ending=ending,
        rng=rng,
    )
    _receipt, file_postimages, log_postimages = ops._plan_development_postimages(
        campaign_dir=campaign,
        investigator_id="inv",
        payload={},
        rng=rng,
        settlement_path=settlement,
        ending=ending,
    )
    journal.update({
        "status": "prepared",
        "file_postimages": file_postimages,
        "log_postimages": log_postimages,
        "planned_at": "2026-07-16T00:00:00Z",
    })
    ops._write_development_journal(inflight, journal)
    return character, campaign, settlement, inflight, journal


def _cast_operation() -> dict:
    return {
        "schema_version": 1,
        "kind": "magic.cast",
        "payload": {
            "spell": "Cloud Memory",
            "pushed": False,
            "interrupted": False,
            "is_npc": False,
        },
    }


def _path_images(paths: list[Path]) -> dict[Path, bytes | None]:
    return {
        path: path.read_bytes() if path.is_file() else None
        for path in paths
    }


def test_recovery_cleans_marker_only_creating_window_without_game_state_changes(
    tmp_path,
):
    character, campaign, _operation = _prepare_development_cliffhanger(tmp_path)
    ending_id, settlement, inflight = _exact_development_paths(campaign)
    tracked = [
        character,
        campaign / "save" / "investigator-state" / "inv.json",
        campaign / "logs" / "events.jsonl",
    ]
    before = _path_images(tracked)
    marker = ops._development_active_marker_path(campaign, "inv")
    ops._claim_development_active_marker(
        campaign_dir=campaign,
        investigator_id="inv",
        ending_id=ending_id,
        inflight_path=inflight,
    )
    assert marker.is_file() and not inflight.exists() and not settlement.exists()

    with ops.coc_fileio.campaign_lock(campaign):
        recovered = ops.recover_development_transactions(campaign)

    assert recovered == []
    assert not marker.exists() and not inflight.exists()
    assert _path_images(tracked) == before


def test_recovery_handles_prepared_journal_durable_before_phase_transition(
    tmp_path,
):
    character, campaign, _settlement, inflight, _journal = (
        _prepared_development_journal(tmp_path)
    )
    marker = ops._development_active_marker_path(campaign, "inv")
    assert json.loads(marker.read_text(encoding="utf-8"))["phase"] == "creating"
    tracked = [
        character,
        campaign / "save" / "investigator-state" / "inv.json",
        campaign / "logs" / "events.jsonl",
    ]
    before = _path_images(tracked)

    with ops.coc_fileio.campaign_lock(campaign):
        recovered = ops.recover_development_transactions(campaign)

    assert [item["status"] for item in recovered] == ["ROLLED_BACK"]
    assert not marker.exists() and inflight.is_file()
    assert json.loads(inflight.read_text(encoding="utf-8"))["status"] == "recovered"
    assert _path_images(tracked) == before


@pytest.mark.parametrize("journal_fault", ["missing", "fingerprint_mismatch"])
def test_journaled_marker_missing_or_mismatched_journal_fails_closed(
    tmp_path, journal_fault
):
    character, campaign, _settlement, inflight, journal = (
        _prepared_development_journal(tmp_path)
    )
    ops._mark_development_journal_durable(
        campaign_dir=campaign,
        investigator_id="inv",
        inflight_path=inflight,
        transaction_id=str(journal["transaction_id"]),
    )
    marker = ops._development_active_marker_path(campaign, "inv")
    if journal_fault == "missing":
        inflight.unlink()
    else:
        inflight.write_bytes(inflight.read_bytes() + b"\n")
    tracked = [
        character,
        campaign / "save" / "investigator-state" / "inv.json",
        campaign / "logs" / "events.jsonl",
        marker,
        inflight,
    ]
    before = _path_images(tracked)

    with ops.coc_fileio.campaign_lock(campaign):
        with pytest.raises(ops.DevelopmentRecoveryConflict):
            ops.recover_development_transactions(campaign)

    assert _path_images(tracked) == before


def test_recovery_finishes_committed_receipt_before_cleanup_window(tmp_path):
    _character, campaign, settlement, inflight, journal = (
        _prepared_development_journal(tmp_path)
    )
    ending = ops.coc_development.structured_ending_evidence(campaign)
    assert ending is not None
    ops._mark_development_journal_durable(
        campaign_dir=campaign,
        investigator_id="inv",
        inflight_path=inflight,
        transaction_id=str(journal["transaction_id"]),
    )
    ops._apply_development_postimages(
        campaign_dir=campaign,
        investigator_id="inv",
        settlement_path=settlement,
        ending=ending,
        journal=journal,
    )
    ops._transition_development_active_marker(
        campaign_dir=campaign,
        investigator_id="inv",
        inflight_path=inflight,
        transaction_id=str(journal["transaction_id"]),
        expected_phases={"journaled"},
        phase="committed",
        journal_sha256=ops._development_journal_sha256(inflight),
        transition_at="2026-07-16T00:01:00Z",
    )
    marker = ops._development_active_marker_path(campaign, "inv")
    committed = settlement.read_bytes()

    with ops.coc_fileio.campaign_lock(campaign):
        recovered = ops.recover_development_transactions(campaign)

    assert [item["status"] for item in recovered] == ["COMMITTED"]
    assert settlement.read_bytes() == committed
    assert not marker.exists() and not inflight.exists()


@pytest.mark.parametrize("marker_phase", ["recovering", "recovered"])
def test_recovery_cleans_recovered_journal_precleanup_windows(
    tmp_path, marker_phase
):
    character, campaign, _settlement, inflight, journal = (
        _prepared_development_journal(tmp_path)
    )
    ops._mark_development_journal_durable(
        campaign_dir=campaign,
        investigator_id="inv",
        inflight_path=inflight,
        transaction_id=str(journal["transaction_id"]),
    )
    recovered_at = "2026-07-16T00:02:00Z"
    recovered_journal = ops._recovered_development_journal(
        journal, recovered_at=recovered_at
    )
    recovered_digest = ops._journal_serialized_sha256(recovered_journal)
    ops._transition_development_active_marker(
        campaign_dir=campaign,
        investigator_id="inv",
        inflight_path=inflight,
        transaction_id=str(journal["transaction_id"]),
        expected_phases={"journaled"},
        phase="recovering",
        journal_sha256=ops._development_journal_sha256(inflight),
        next_journal_sha256=recovered_digest,
        transition_at=recovered_at,
    )
    ops._write_development_journal(inflight, recovered_journal)
    if marker_phase == "recovered":
        ops._transition_development_active_marker(
            campaign_dir=campaign,
            investigator_id="inv",
            inflight_path=inflight,
            transaction_id=str(journal["transaction_id"]),
            expected_phases={"recovering"},
            phase="recovered",
            journal_sha256=recovered_digest,
            transition_at=recovered_at,
        )
    marker = ops._development_active_marker_path(campaign, "inv")
    character_before = character.read_bytes()

    with ops.coc_fileio.campaign_lock(campaign):
        recovered = ops.recover_development_transactions(campaign)

    assert [item["status"] for item in recovered] == ["RECOVERED"]
    assert character.read_bytes() == character_before
    assert not marker.exists() and inflight.is_file()
    assert json.loads(inflight.read_text(encoding="utf-8"))["status"] == "recovered"


def test_plugin_and_pi_sdk_entries_return_same_magic_receipt(tmp_path):
    plugin_root = tmp_path / "plugin"
    pi_root = tmp_path / "pi"
    plugin_character = _workspace(plugin_root)
    _workspace(pi_root)

    direct = ops.execute_operation(
        plugin_root,
        campaign_id="camp",
        investigator_id="inv",
        character_path=plugin_character,
        operation=_cast_operation(),
        rng_seed=1,
    )

    api = _load("runtime_sdk_ops_parity", REPO / "runtime" / "sdk" / "api.py")
    session_id = api.create_session(
        pi_root, campaign_id="camp", investigator_id="inv"
    )
    through_pi = api.operate(session_id, _cast_operation(), rng_seed=1)

    assert through_pi == direct
    for root in (plugin_root, pi_root):
        campaign = root / ".coc" / "campaigns" / "camp"
        saved = json.loads(
            (campaign / "save" / "investigator-state" / "inv.json").read_text()
        )
        assert saved["magic"]["cast_spells"] == ["Cloud Memory"]
        assert len((campaign / "logs" / "rolls.jsonl").read_text().splitlines()) == 1


def test_runtime_operation_rejects_host_specific_extra_fields(tmp_path):
    character = _workspace(tmp_path)
    operation = _cast_operation()
    operation["host"] = "codex"

    with pytest.raises(ops.RuntimeOperationError, match="exactly"):
        ops.execute_operation(
            tmp_path,
            campaign_id="camp",
            investigator_id="inv",
            character_path=character,
            operation=operation,
        )


def test_scenario_repair_requires_structured_resolution_request(tmp_path):
    character = _workspace(tmp_path)
    with pytest.raises(ops.RuntimeOperationError, match="source_resolution_request"):
        ops.execute_operation(
            tmp_path,
            campaign_id="camp",
            investigator_id="inv",
            character_path=character,
            operation={"schema_version": 1, "kind": "scenario.repair", "payload": {}},
        )


@pytest.mark.parametrize(
    "operation",
    [
        {
            "schema_version": 1,
            "kind": "tome.read",
            "payload": {
                "tome": "Al Azif",
                "phase": "initial",
                "language_skill": 50,
                "read_language_ok": False,
                "plot_critical": False,
                "choose_disbelief": False,
                "alone": True,
            },
        },
        {
            "schema_version": 1,
            "kind": "hazard.apply",
            "payload": {"severity": "minor", "source": "fall"},
        },
        {
            "schema_version": 1,
            "kind": "hazard.poison",
            "payload": {"poison_id": "Arsenic", "doses": 1},
        },
    ],
)
def test_plugin_and_pi_sdk_entries_match_for_new_stateful_operations(
    tmp_path, operation
):
    direct_root = tmp_path / "direct"
    pi_root = tmp_path / "pi"
    direct_character = _workspace(direct_root)
    _workspace(pi_root)
    direct = ops.execute_operation(
        direct_root,
        campaign_id="camp",
        investigator_id="inv",
        character_path=direct_character,
        operation=operation,
        rng_seed=17,
    )
    api = _load(f"runtime_sdk_ops_{operation['kind']}", REPO / "runtime" / "sdk" / "api.py")
    session_id = api.create_session(pi_root, campaign_id="camp", investigator_id="inv")
    through_pi = api.operate(session_id, operation, rng_seed=17)
    assert through_pi == direct


def test_development_settle_is_shared_and_records_all_public_rolls(tmp_path):
    direct_root = tmp_path / "direct"
    pi_root = tmp_path / "pi"
    direct_character = _workspace(direct_root)
    _workspace(pi_root)
    for root in (direct_root, pi_root):
        campaign = root / ".coc" / "campaigns" / "camp"
        _record_current_tick(campaign)
        _persist_current_ending(campaign, {
            "event_type": "session_ending",
            "scene_id": "finale",
            "kind": "conclusion",
            "decision_id": "shared-development-ending",
            "ts": "2026-07-15T00:00:00Z",
        })
    operation = {"schema_version": 1, "kind": "development.settle", "payload": {}}
    direct = ops.execute_operation(
        direct_root,
        campaign_id="camp",
        investigator_id="inv",
        character_path=direct_character,
        operation=operation,
        rng_seed=4,
    )
    api = _load("runtime_sdk_development_parity", REPO / "runtime" / "sdk" / "api.py")
    session_id = api.create_session(pi_root, campaign_id="camp", investigator_id="inv")
    through_pi = api.operate(session_id, operation, rng_seed=4)
    assert _without_capsule_source_digests(through_pi) == (
        _without_capsule_source_digests(direct)
    )
    assert direct["result"]["improvement_checks"]
    for root in (direct_root, pi_root):
        rolls = (root / ".coc" / "campaigns" / "camp" / "logs" / "rolls.jsonl")
        assert any("development_check" in line for line in rolls.read_text().splitlines())
        assert any("luck_recovery" in line for line in rolls.read_text().splitlines())
        inv_state = json.loads((
            root / ".coc" / "campaigns" / "camp" / "save"
            / "investigator-state" / "inv.json"
        ).read_text(encoding="utf-8"))
        assert inv_state["skill_checks_earned"] == []

    before = (direct_root / ".coc" / "campaigns" / "camp" / "logs" / "rolls.jsonl").read_text()
    repeated = ops.execute_operation(
        direct_root,
        campaign_id="camp",
        investigator_id="inv",
        character_path=direct_character,
        operation=operation,
        rng_seed=999,
    )
    assert repeated == direct
    assert (direct_root / ".coc" / "campaigns" / "camp" / "logs" / "rolls.jsonl").read_text() == before


def test_development_settle_recovers_crash_before_commit_marker(
    tmp_path, monkeypatch
):
    crash_root = tmp_path / "crash"
    control_root = tmp_path / "control"
    crash_character = _workspace(crash_root)
    control_character = _workspace(control_root)
    for root in (crash_root, control_root):
        campaign = root / ".coc" / "campaigns" / "camp"
        _record_current_tick(campaign)
        _persist_current_ending(campaign, {
            "event_type": "session_ending",
            "scene_id": "finale",
            "kind": "cliffhanger",
            "decision_id": "ending-crash-test",
            "ts": "2026-07-15T00:00:00Z",
        })

    operation = {"schema_version": 1, "kind": "development.settle", "payload": {}}
    control = ops.execute_operation(
        control_root,
        campaign_id="camp",
        investigator_id="inv",
        character_path=control_character,
        operation=operation,
        rng_seed=5,
    )

    original_write_roll = ops._write_public_roll

    def crash_before_luck_roll(*args, **kwargs):
        if kwargs.get("kind") == "luck_recovery":
            raise SystemExit("simulated process crash before settlement commit")
        return original_write_roll(*args, **kwargs)

    monkeypatch.setattr(ops, "_write_public_roll", crash_before_luck_roll)
    with pytest.raises(SystemExit, match="simulated process crash"):
        ops.execute_operation(
            crash_root,
            campaign_id="camp",
            investigator_id="inv",
            character_path=crash_character,
            operation=operation,
            rng_seed=5,
        )
    campaign = crash_root / ".coc" / "campaigns" / "camp"
    ending_id = ops.coc_development.structured_ending_evidence(campaign)["ending_id"]
    settlement = ops.coc_development.ending_settlement_path(
        campaign, ending_id, "inv"
    )
    inflight = settlement.with_name("inv.inflight.json")
    assert inflight.is_file()
    assert not settlement.exists()

    monkeypatch.setattr(ops, "_write_public_roll", original_write_roll)
    recovered = ops.execute_operation(
        crash_root,
        campaign_id="camp",
        investigator_id="inv",
        character_path=crash_character,
        operation=operation,
        # The prepared journal, not this changed retry seed, owns replay dice.
        rng_seed=999,
    )
    assert _without_capsule_source_digests(recovered) == (
        _without_capsule_source_digests(control)
    )
    assert settlement.is_file()
    assert not inflight.exists()
    assert json.loads(crash_character.read_text(encoding="utf-8")) == json.loads(
        control_character.read_text(encoding="utf-8")
    )
    crash_state = json.loads((
        campaign / "save" / "investigator-state" / "inv.json"
    ).read_text(encoding="utf-8"))
    control_state = json.loads((
        control_root / ".coc" / "campaigns" / "camp" / "save"
        / "investigator-state" / "inv.json"
    ).read_text(encoding="utf-8"))
    assert crash_state == control_state
    crash_rolls = [
        row.get("payload")
        for row in _read_jsonl(campaign / "logs" / "rolls.jsonl")
    ]
    control_rolls = [
        row.get("payload")
        for row in _read_jsonl(
            control_root / ".coc" / "campaigns" / "camp" / "logs" / "rolls.jsonl"
        )
    ]
    assert crash_rolls == control_rolls
    assert len([
        row for row in _read_jsonl(campaign / "logs" / "events.jsonl")
        if row.get("type") == "development"
    ]) == 1

    rolls_before = (campaign / "logs" / "rolls.jsonl").read_text(encoding="utf-8")
    replay = ops.execute_operation(
        crash_root,
        campaign_id="camp",
        investigator_id="inv",
        character_path=crash_character,
        operation=operation,
        rng_seed=1,
    )
    assert replay == recovered
    assert (campaign / "logs" / "rolls.jsonl").read_text(encoding="utf-8") == rolls_before


def test_canonical_operation_recovers_crashed_settlement_before_its_write(
    tmp_path, monkeypatch
):
    character, campaign, operation = _prepare_development_cliffhanger(tmp_path)
    original_write = ops.coc_fileio.write_text_atomic
    crashed = False

    def crash_after_canonical_character(path, text):
        nonlocal crashed
        original_write(path, text)
        if Path(path) == character and not crashed:
            crashed = True
            raise SystemExit("crash after canonical settlement mutation")

    monkeypatch.setattr(
        ops.coc_fileio, "write_text_atomic", crash_after_canonical_character
    )
    with pytest.raises(SystemExit, match="canonical settlement mutation"):
        ops.execute_operation(
            tmp_path,
            campaign_id="camp",
            investigator_id="inv",
            character_path=character,
            operation=operation,
            rng_seed=5,
        )
    ending_id = ops.coc_development.structured_ending_evidence(campaign)["ending_id"]
    inflight = ops.coc_development.ending_settlement_path(
        campaign, ending_id, "inv"
    ).with_name("inv.inflight.json")
    assert json.loads(inflight.read_text(encoding="utf-8"))["status"] == "prepared"

    monkeypatch.setattr(ops.coc_fileio, "write_text_atomic", original_write)
    intervening = ops.execute_operation(
        tmp_path,
        campaign_id="camp",
        investigator_id="inv",
        character_path=character,
        operation=_cast_operation(),
        rng_seed=1,
    )
    assert intervening["status"] == "PASS"
    recovered_journal = json.loads(inflight.read_text(encoding="utf-8"))
    assert recovered_journal["status"] == "recovered"
    state_after_intervening = json.loads((
        campaign / "save" / "investigator-state" / "inv.json"
    ).read_text(encoding="utf-8"))
    assert state_after_intervening["magic"]["cast_spells"] == ["Cloud Memory"]
    magic_events_before = [
        row for row in _read_jsonl(campaign / "logs" / "events.jsonl")
        if row.get("type") == "magic"
    ]
    magic_rolls_before = [
        row for row in _read_jsonl(campaign / "logs" / "rolls.jsonl")
        if row.get("source") == "runtime_operation"
        and row.get("payload", {}).get("kind") == "magic.cast"
    ]

    settled = ops.execute_operation(
        tmp_path,
        campaign_id="camp",
        investigator_id="inv",
        character_path=character,
        operation=operation,
        rng_seed=999,
    )
    assert settled["status"] == "PASS"
    state_after_settlement = json.loads((
        campaign / "save" / "investigator-state" / "inv.json"
    ).read_text(encoding="utf-8"))
    assert state_after_settlement["magic"] == state_after_intervening["magic"]
    assert [
        row for row in _read_jsonl(campaign / "logs" / "events.jsonl")
        if row.get("type") == "magic"
    ] == magic_events_before
    assert [
        row for row in _read_jsonl(campaign / "logs" / "rolls.jsonl")
        if row.get("source") == "runtime_operation"
        and row.get("payload", {}).get("kind") == "magic.cast"
    ] == magic_rolls_before
    assert not inflight.exists()


def test_recovery_conflict_preserves_direct_foreign_deltas_without_restore(
    tmp_path, monkeypatch
):
    character, campaign, operation = _prepare_development_cliffhanger(tmp_path)
    rolls_path = campaign / "logs" / "rolls.jsonl"
    rolls_path.unlink(missing_ok=True)
    original_write = ops.coc_fileio.write_text_atomic
    crashed = False

    def crash_after_canonical_character(path, text):
        nonlocal crashed
        original_write(path, text)
        if Path(path) == character and not crashed:
            crashed = True
            raise SystemExit("crash before foreign divergence")

    monkeypatch.setattr(
        ops.coc_fileio, "write_text_atomic", crash_after_canonical_character
    )
    with pytest.raises(SystemExit, match="foreign divergence"):
        ops.execute_operation(
            tmp_path,
            campaign_id="camp",
            investigator_id="inv",
            character_path=character,
            operation=operation,
            rng_seed=5,
        )
    monkeypatch.setattr(ops.coc_fileio, "write_text_atomic", original_write)

    inv_path = campaign / "save" / "investigator-state" / "inv.json"
    foreign_state = json.loads(inv_path.read_text(encoding="utf-8"))
    foreign_state["foreign_post_crash_write"] = "must-survive"
    inv_path.write_text(json.dumps(foreign_state), encoding="utf-8")
    event_path = campaign / "logs" / "events.jsonl"
    with event_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({
            "event_type": "foreign_post_crash_event",
            "receipt": "must-survive",
        }) + "\n")
    assert not rolls_path.exists()
    # Existence is evidence too: an empty foreign-created append log must not
    # be mistaken for the transaction's absent preimage and silently removed.
    rolls_path.write_text("", encoding="utf-8")
    tracked_before = {
        path: path.read_bytes()
        for path in [character, inv_path, event_path, rolls_path]
    }

    with pytest.raises(ops.DevelopmentRecoveryConflict) as exc_info:
        ops.execute_operation(
            tmp_path,
            campaign_id="camp",
            investigator_id="inv",
            character_path=character,
            operation=_cast_operation(),
            rng_seed=1,
        )
    conflict = exc_info.value
    assert conflict.code == "RECOVERY_CONFLICT"
    assert "campaigns/camp/save/investigator-state/inv.json" in conflict.conflicting_paths
    assert "campaigns/camp/logs/events.jsonl" in conflict.conflicting_paths
    assert "campaigns/camp/logs/rolls.jsonl" in conflict.conflicting_paths
    assert all(path.read_bytes() == before for path, before in tracked_before.items())
    assert json.loads(inv_path.read_text(encoding="utf-8"))[
        "foreign_post_crash_write"
    ] == "must-survive"
    assert _read_jsonl(event_path)[-1]["event_type"] == "foreign_post_crash_event"
    ending_id = ops.coc_development.structured_ending_evidence(campaign)["ending_id"]
    assert ops.coc_development.ending_settlement_path(
        campaign, ending_id, "inv"
    ).with_name("inv.inflight.json").exists()


@pytest.mark.parametrize("target_kind", ["directory", "symlink"])
def test_development_rejects_non_regular_target_before_any_mutation(
    tmp_path, target_kind
):
    character, campaign, operation = _prepare_development_cliffhanger(tmp_path)
    sanity_path = ops.coc_sanity.sanity_snapshot_path(campaign, "inv")
    sanity_path.parent.mkdir(parents=True, exist_ok=True)
    if target_kind == "directory":
        sanity_path.mkdir()
    else:
        sanity_path.symlink_to(character)
    tracked = [
        character,
        campaign / "save" / "investigator-state" / "inv.json",
        campaign / "logs" / "events.jsonl",
        tmp_path / ".coc" / "investigators" / "inv" / "development.jsonl",
    ]
    before = {path: path.read_bytes() for path in tracked}
    _ending_id, settlement, inflight = _exact_development_paths(campaign)

    with pytest.raises(ops.DevelopmentRecoveryConflict) as exc_info:
        ops.execute_operation(
            tmp_path,
            campaign_id="camp",
            investigator_id="inv",
            character_path=character,
            operation=operation,
            rng_seed=5,
        )

    assert exc_info.value.code == "RECOVERY_CONFLICT"
    assert any("sanity-state/inv.json" in path for path in exc_info.value.conflicting_paths)
    assert {path: path.read_bytes() for path in tracked} == before
    assert not settlement.exists()
    assert not inflight.exists()
    assert sanity_path.is_dir() if target_kind == "directory" else sanity_path.is_symlink()


def test_preapply_cas_preserves_planning_window_foreign_write(
    tmp_path, monkeypatch
):
    character, campaign, operation = _prepare_development_cliffhanger(tmp_path)
    inv_path = campaign / "save" / "investigator-state" / "inv.json"
    events_path = campaign / "logs" / "events.jsonl"
    inv_before = inv_path.read_bytes()
    events_before = events_path.read_bytes()
    original_plan = ops._plan_development_postimages

    def plan_then_foreign_write(*args, **kwargs):
        planned = original_plan(*args, **kwargs)
        value = json.loads(character.read_text(encoding="utf-8"))
        value["foreign_campaign_write"] = "must-survive"
        character.write_text(json.dumps(value), encoding="utf-8")
        return planned

    monkeypatch.setattr(
        ops, "_plan_development_postimages", plan_then_foreign_write
    )
    _ending_id, settlement, inflight = _exact_development_paths(campaign)
    with pytest.raises(ops.DevelopmentRecoveryConflict) as exc_info:
        ops.execute_operation(
            tmp_path,
            campaign_id="camp",
            investigator_id="inv",
            character_path=character,
            operation=operation,
            rng_seed=5,
        )

    assert "foreign_campaign_write" in json.loads(
        character.read_text(encoding="utf-8")
    )
    assert inv_path.read_bytes() == inv_before
    assert events_path.read_bytes() == events_before
    assert not settlement.exists()
    assert inflight.is_file()
    assert any("character.json" in path for path in exc_info.value.conflicting_paths)


@pytest.mark.parametrize("malformed_image", ["file_preimage", "log_postimage"])
def test_recovery_rejects_malformed_individual_image_before_restore(
    tmp_path, malformed_image
):
    character, campaign, _operation = _prepare_development_cliffhanger(tmp_path)
    ending = ops.coc_development.structured_ending_evidence(campaign)
    assert ending is not None
    ending_id, settlement, inflight = _exact_development_paths(campaign)
    rng = random.Random(5)
    journal = ops._capture_development_inflight(
        campaign_dir=campaign,
        investigator_id="inv",
        ending_id=ending_id,
        settlement_path=settlement,
        inflight_path=inflight,
        ending=ending,
        rng=rng,
    )
    _receipt, file_postimages, log_postimages = ops._plan_development_postimages(
        campaign_dir=campaign,
        investigator_id="inv",
        payload={},
        rng=rng,
        settlement_path=settlement,
        ending=ending,
    )
    journal.update({
        "status": "prepared",
        "file_postimages": file_postimages,
        "log_postimages": log_postimages,
    })
    if malformed_image == "file_preimage":
        journal["file_preimages"]["character"]["sha256"] = "0" * 64
    else:
        journal["log_postimages"]["events"]["suffix_sha256"] = "0" * 64
    ops._write_development_journal(inflight, journal)
    ops._mark_development_journal_durable(
        campaign_dir=campaign,
        investigator_id="inv",
        inflight_path=inflight,
        transaction_id=str(journal["transaction_id"]),
    )
    tracked = [
        character,
        campaign / "save" / "investigator-state" / "inv.json",
        campaign / "logs" / "events.jsonl",
    ]
    before = {path: path.read_bytes() for path in tracked}

    with pytest.raises(ops.DevelopmentRecoveryConflict):
        ops.recover_development_transactions(campaign)

    assert {path: path.read_bytes() for path in tracked} == before
    assert inflight.is_file()
    assert not settlement.exists()


def test_recovery_rejects_relocated_duplicate_journal_before_any_mutation(tmp_path):
    character, campaign, _operation = _prepare_development_cliffhanger(tmp_path)
    ending = ops.coc_development.structured_ending_evidence(campaign)
    assert ending is not None
    ending_id, settlement, inflight = _exact_development_paths(campaign)
    rng = random.Random(5)
    journal = ops._capture_development_inflight(
        campaign_dir=campaign,
        investigator_id="inv",
        ending_id=ending_id,
        settlement_path=settlement,
        inflight_path=inflight,
        ending=ending,
        rng=rng,
    )
    _receipt, file_postimages, log_postimages = ops._plan_development_postimages(
        campaign_dir=campaign,
        investigator_id="inv",
        payload={},
        rng=rng,
        settlement_path=settlement,
        ending=ending,
    )
    journal.update({
        "status": "prepared",
        "file_postimages": file_postimages,
        "log_postimages": log_postimages,
    })
    ops._write_development_journal(inflight, journal)
    ops._mark_development_journal_durable(
        campaign_dir=campaign,
        investigator_id="inv",
        inflight_path=inflight,
        transaction_id=str(journal["transaction_id"]),
    )
    duplicate = (
        campaign / "save" / "development-settlements" / "endings"
        / "zzz-relocated" / "inv.inflight.json"
    )
    duplicate.parent.mkdir(parents=True)
    duplicate.write_bytes(inflight.read_bytes())
    tracked = [
        character,
        campaign / "save" / "investigator-state" / "inv.json",
        campaign / "logs" / "events.jsonl",
        campaign / "logs" / "rolls.jsonl",
    ]
    before = {
        path: path.read_bytes() if path.is_file() else None for path in tracked
    }

    with pytest.raises(ops.DevelopmentRecoveryConflict) as exc_info:
        ops.recover_development_transactions(campaign)

    assert exc_info.value.code == "RECOVERY_CONFLICT"
    assert {path: (path.read_bytes() if path.is_file() else None) for path in tracked} == before
    assert inflight.is_file()
    assert duplicate.is_file()
    assert not settlement.exists()


def test_recovery_validates_overlapping_journal_set_before_any_mutation(tmp_path):
    character, campaign, _operation = _prepare_development_cliffhanger(tmp_path)
    ending = ops.coc_development.structured_ending_evidence(campaign)
    assert ending is not None
    ending_id, settlement, inflight = _exact_development_paths(campaign)
    ops._capture_development_inflight(
        campaign_dir=campaign,
        investigator_id="inv",
        ending_id=ending_id,
        settlement_path=settlement,
        inflight_path=inflight,
        ending=ending,
        rng=random.Random(5),
    )

    second_sheet = {
        "schema_version": 1,
        "id": "inv2",
        "investigator_id": "inv2",
        "name": "Second Investigator",
        "characteristics": {"POW": 50, "INT": 60, "LUCK": 40},
        "derived": {"HP": 10, "SAN": 50, "MP": 10},
        "skills": {"Listen": 25},
    }
    state.create_investigator(tmp_path, "inv2", second_sheet)
    second_state = campaign / "save" / "investigator-state" / "inv2.json"
    second_state.write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "camp",
        "investigator_id": "inv2",
        "current_luck": 40,
        "current_san": 50,
        "current_hp": 10,
        "skill_checks_earned": [],
    }), encoding="utf-8")
    second_ending = {**ending, "ending_id": "ending-second-journal"}
    second_settlement = ops.coc_development.ending_settlement_path(
        campaign, second_ending["ending_id"], "inv2"
    )
    second_inflight = second_settlement.with_name("inv2.inflight.json")
    ops._capture_development_inflight(
        campaign_dir=campaign,
        investigator_id="inv2",
        ending_id=second_ending["ending_id"],
        settlement_path=second_settlement,
        inflight_path=second_inflight,
        ending=second_ending,
        rng=random.Random(6),
    )
    tracked = [
        character,
        second_state,
        campaign / "logs" / "events.jsonl",
        inflight,
        second_inflight,
    ]
    before = {path: path.read_bytes() for path in tracked}

    with pytest.raises(ops.DevelopmentRecoveryConflict) as exc_info:
        ops.recover_development_transactions(campaign)

    assert exc_info.value.transaction_id == "development-recovery-set"
    assert any("logs/events.jsonl" in path for path in exc_info.value.conflicting_paths)
    assert {path: path.read_bytes() for path in tracked} == before
    assert not settlement.exists()
    assert not second_settlement.exists()


def test_invalid_exact_receipt_is_rejected_before_new_journal_or_state_write(tmp_path):
    character, campaign, operation = _prepare_development_cliffhanger(tmp_path)
    ending_id, settlement, inflight = _exact_development_paths(campaign)
    settlement.parent.mkdir(parents=True, exist_ok=True)
    settlement.write_text(json.dumps({
        "schema_version": 1,
        "ending_id": ending_id,
        "investigator_id": "foreign-investigator",
        "settled_at": "2026-07-16T00:00:00Z",
        "receipt": {
            "schema_version": 1,
            "status": "PASS",
            "kind": "development.settle",
            "operation_id": "forged",
            "result": {"ending_evidence": {"ending_id": ending_id}},
            "state_refs": ["save/investigator-state/inv.json"],
        },
    }), encoding="utf-8")
    tracked = [
        character,
        campaign / "save" / "investigator-state" / "inv.json",
        campaign / "logs" / "events.jsonl",
        settlement,
    ]
    before = {path: path.read_bytes() for path in tracked}

    with pytest.raises(
        ops.RuntimeOperationError,
        match="existing exact development settlement receipt is invalid",
    ):
        ops.execute_operation(
            tmp_path,
            campaign_id="camp",
            investigator_id="inv",
            character_path=character,
            operation=operation,
            rng_seed=5,
        )

    assert {path: path.read_bytes() for path in tracked} == before
    assert not inflight.exists()


def test_two_campaigns_shared_investigator_serialize_without_deadlock(tmp_path):
    character = _workspace(tmp_path)
    campaign_one = tmp_path / ".coc" / "campaigns" / "camp"
    state.create_campaign(tmp_path, "camp2", "Second Campaign")
    state.link_party(tmp_path, "camp2", ["inv"])
    campaign_two = tmp_path / ".coc" / "campaigns" / "camp2"
    for campaign, skill, decision in (
        (campaign_one, "Spot Hidden", "ending-camp-one"),
        (campaign_two, "Listen", "ending-camp-two"),
    ):
        _record_current_tick(campaign, skill, f"runtime-test:{decision}")
        _persist_current_ending(campaign, {
            "event_type": "session_ending",
            "scene_id": "finale",
            "kind": "cliffhanger",
            "decision_id": decision,
            "investigator_ids": ["inv"],
            "ts": "2026-07-16T00:00:00Z",
        })

    # Hold the shared lock briefly so both subprocesses first acquire their
    # own campaign locks and queue in the documented campaign->investigator
    # order.  communicate(timeout=...) is the deadlock proof.
    lock_path = ops._development_investigator_lock_path(campaign_one, "inv")
    command_base = [
        sys.executable,
        str(REPO / "plugins" / "coc-keeper" / "scripts" / "coc_runtime_ops.py"),
        "--workspace", str(tmp_path),
        "--investigator", "inv",
        "--character", str(character),
        "--operation-json", json.dumps({
            "schema_version": 1,
            "kind": "development.settle",
            "payload": {},
        }),
        "--rng-seed", "7",
    ]
    with ops.coc_fileio.advisory_file_lock(lock_path):
        processes = [
            subprocess.Popen(
                [*command_base, "--campaign", campaign_id],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            )
            for campaign_id in ("camp", "camp2")
        ]
        campaign_locks = [
            campaign_one / ".campaign.lock",
            campaign_two / ".campaign.lock",
        ]
        deadline = time.monotonic() + 30.0
        while (
            not all(path.is_file() for path in campaign_locks)
            and time.monotonic() < deadline
        ):
            time.sleep(0.01)
        assert all(path.is_file() for path in campaign_locks)
    outputs: list[tuple[str, str, int]] = []
    try:
        for process in processes:
            stdout, stderr = process.communicate(timeout=30)
            outputs.append((stdout, stderr, process.returncode))
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=2)

    assert [code for _out, _err, code in outputs] == [0, 0], outputs
    assert all(json.loads(stdout)["status"] == "PASS" for stdout, _err, _code in outputs)
    for campaign in (campaign_one, campaign_two):
        ending = ops.coc_development.structured_ending_evidence(campaign)
        assert ending is not None
        assert ops.coc_development.ending_settlement_path(
            campaign, ending["ending_id"], "inv"
        ).is_file()
    # Persistent lock inode is expected; acquiring it proves neither worker
    # leaked the kernel lock.
    with ops.coc_fileio.advisory_file_lock(lock_path, wait_seconds=0.2):
        pass
    json.loads(character.read_text(encoding="utf-8"))


def test_foreign_campaign_marker_is_zero_write_and_only_origin_recovers(tmp_path):
    character, campaign_a, _operation = _prepare_development_cliffhanger(tmp_path)
    state.create_campaign(tmp_path, "camp2", "Foreign Campaign")
    state.link_party(tmp_path, "camp2", ["inv"])
    campaign_b = tmp_path / ".coc" / "campaigns" / "camp2"
    ending = ops.coc_development.structured_ending_evidence(campaign_a)
    assert ending is not None
    ending_id, settlement, inflight = _exact_development_paths(campaign_a)
    rng = random.Random(5)
    journal = ops._capture_development_inflight(
        campaign_dir=campaign_a,
        investigator_id="inv",
        ending_id=ending_id,
        settlement_path=settlement,
        inflight_path=inflight,
        ending=ending,
        rng=rng,
    )
    _receipt, file_postimages, log_postimages = ops._plan_development_postimages(
        campaign_dir=campaign_a,
        investigator_id="inv",
        payload={},
        rng=rng,
        settlement_path=settlement,
        ending=ending,
    )
    journal.update({
        "status": "prepared",
        "file_postimages": file_postimages,
        "log_postimages": log_postimages,
    })
    ops._write_development_journal(inflight, journal)
    ops._mark_development_journal_durable(
        campaign_dir=campaign_a,
        investigator_id="inv",
        inflight_path=inflight,
        transaction_id=str(journal["transaction_id"]),
    )
    character_preimage = journal["file_preimages"]["character"]
    ops.coc_fileio.write_text_atomic(
        character, str(file_postimages["character"]["text"])
    )
    marker = ops._development_active_marker_path(campaign_a, "inv")
    tracked = [character, inflight, marker]
    before_foreign = {path: path.read_bytes() for path in tracked}

    with pytest.raises(ops.DevelopmentRecoveryConflict) as guarded_read:
        ops.read_development_guarded_character(campaign_b, "inv", character)
    assert guarded_read.value.transaction_id == journal["transaction_id"]
    assert {path: path.read_bytes() for path in tracked} == before_foreign

    with pytest.raises(ops.DevelopmentRecoveryConflict) as exc_info:
        with ops.coc_fileio.campaign_lock(campaign_b):
            ops.recover_development_transactions(campaign_b)

    assert exc_info.value.transaction_id == journal["transaction_id"]
    assert {path: path.read_bytes() for path in tracked} == before_foreign
    assert not settlement.exists()

    with ops.coc_fileio.campaign_lock(campaign_a):
        recovered = ops.recover_development_transactions(campaign_a)

    assert recovered[0]["status"] == "ROLLED_BACK"
    assert ops._file_image(character) == character_preimage
    assert inflight.is_file()
    assert json.loads(inflight.read_text(encoding="utf-8"))["status"] == "recovered"
    assert not marker.exists()


@pytest.mark.parametrize(
    "crash_site",
    ["scenario_public_roll", "scenario_reward_event", "settlement_receipt"],
)
def test_development_settle_recovers_late_scenario_reward_crashes(
    tmp_path, monkeypatch, crash_site
):
    crash_root = tmp_path / f"crash-{crash_site}"
    control_root = tmp_path / f"control-{crash_site}"
    crash_character = _workspace(crash_root)
    control_character = _workspace(control_root)

    def prepare(root: Path) -> Path:
        campaign = root / ".coc" / "campaigns" / "camp"
        scenario = campaign / "scenario"
        scenario.mkdir(parents=True, exist_ok=True)
        (scenario / "story-graph.json").write_text(json.dumps({
            "scenes": [{
                "scene_id": "corbitt-confrontation",
                "conclusion_contract": {
                    "conclusion_id": "corbitt-destroyed",
                    "requires_combat_outcome": "investigators_win",
                    "session_ending": True,
                    "sanity_reward": {"die": "1D6", "rule_ref": "module.reward"},
                },
            }],
        }), encoding="utf-8")
        _record_current_tick(campaign)
        _seed_structured_combat_conclusion(campaign)
        _persist_current_ending(campaign, {
            "event_type": "session_ending",
            "scene_id": "corbitt-confrontation",
            "kind": "conclusion",
            "decision_id": "late-crash-ending",
        })
        return campaign

    crash_campaign = prepare(crash_root)
    control_campaign = prepare(control_root)
    operation = {"schema_version": 1, "kind": "development.settle", "payload": {}}
    control = ops.execute_operation(
        control_root,
        campaign_id="camp",
        investigator_id="inv",
        character_path=control_character,
        operation=operation,
        rng_seed=5,
    )

    restore = None
    if crash_site == "scenario_public_roll":
        original = ops._write_public_roll

        def crash_on_scenario_roll(*args, **kwargs):
            if kwargs.get("kind") == "scenario_san_reward":
                raise SystemExit("crash after scenario SAN mutation")
            return original(*args, **kwargs)

        monkeypatch.setattr(ops, "_write_public_roll", crash_on_scenario_roll)
        restore = lambda: monkeypatch.setattr(ops, "_write_public_roll", original)
    elif crash_site == "scenario_reward_event":
        original = ops._write_sanity_reward_event

        def crash_after_reward_event(*args, **kwargs):
            original(*args, **kwargs)
            if kwargs.get("source") == "conclusion_rewards":
                raise SystemExit("crash after scenario reward event")

        monkeypatch.setattr(ops, "_write_sanity_reward_event", crash_after_reward_event)
        restore = lambda: monkeypatch.setattr(
            ops, "_write_sanity_reward_event", original
        )
    else:
        original = ops.coc_fileio.write_text_atomic
        ending_id = ops.coc_development.structured_ending_evidence(
            crash_campaign
        )["ending_id"]
        settlement_path = ops.coc_development.ending_settlement_path(
            crash_campaign, ending_id, "inv"
        )

        def crash_before_receipt(path, *args, **kwargs):
            if Path(path) == settlement_path:
                raise SystemExit("crash immediately before settlement receipt")
            return original(path, *args, **kwargs)

        monkeypatch.setattr(
            ops.coc_fileio, "write_text_atomic", crash_before_receipt
        )
        restore = lambda: monkeypatch.setattr(
            ops.coc_fileio, "write_text_atomic", original
        )

    with pytest.raises(SystemExit, match="crash"):
        ops.execute_operation(
            crash_root,
            campaign_id="camp",
            investigator_id="inv",
            character_path=crash_character,
            operation=operation,
            rng_seed=5,
        )
    assert restore is not None
    restore()
    recovered = ops.execute_operation(
        crash_root,
        campaign_id="camp",
        investigator_id="inv",
        character_path=crash_character,
        operation=operation,
        rng_seed=999,
    )
    assert _without_capsule_source_digests(recovered) == (
        _without_capsule_source_digests(control)
    )
    assert json.loads(crash_character.read_text(encoding="utf-8")) == json.loads(
        control_character.read_text(encoding="utf-8")
    )
    for relative in (
        Path("save/investigator-state/inv.json"),
        Path("save/sanity.json"),
    ):
        assert json.loads((crash_campaign / relative).read_text(encoding="utf-8")) == json.loads(
            (control_campaign / relative).read_text(encoding="utf-8")
        )
    crash_rolls = _read_jsonl(crash_campaign / "logs" / "rolls.jsonl")
    assert [row.get("payload") for row in crash_rolls] == [
        row.get("payload")
        for row in _read_jsonl(control_campaign / "logs" / "rolls.jsonl")
    ]
    roll_ids = [row["roll_id"] for row in crash_rolls]
    assert len(roll_ids) == len(set(roll_ids))
    reward_events = [
        row for row in _read_jsonl(crash_campaign / "logs" / "events.jsonl")
        if row.get("event_type") == "reward"
        and row.get("source") == "conclusion_rewards"
    ]
    assert len(reward_events) == 1
    ending_id = ops.coc_development.structured_ending_evidence(
        crash_campaign
    )["ending_id"]
    assert not ops.coc_development.ending_settlement_path(
        crash_campaign, ending_id, "inv"
    ).with_name("inv.inflight.json").exists()


def test_development_settle_applies_structured_scenario_san_reward(tmp_path):
    character = _workspace(tmp_path)
    campaign = tmp_path / ".coc" / "campaigns" / "camp"
    scenario = campaign / "scenario"
    scenario.mkdir(parents=True, exist_ok=True)
    (scenario / "story-graph.json").write_text(json.dumps({
        "scenes": [{
            "scene_id": "corbitt-confrontation",
            "conclusion_contract": {
                "conclusion_id": "corbitt-destroyed",
                "requires_combat_outcome": "investigators_win",
                "session_ending": True,
                "sanity_reward": {
                    "die": "1D6",
                    "rule_ref": "module.haunting.conclusion_sanity_reward",
                },
            },
        }],
    }), encoding="utf-8")
    _seed_structured_combat_conclusion(campaign)
    _persist_current_ending(campaign, {
        "event_type": "session_ending",
        "scene_id": "corbitt-confrontation",
        "kind": "conclusion",
        "decision_id": "structured-scenario-ending",
        "ts": "2026-07-15T00:00:00Z",
    })

    receipt = ops.execute_operation(
        tmp_path,
        campaign_id="camp",
        investigator_id="inv",
        character_path=character,
        operation={"schema_version": 1, "kind": "development.settle", "payload": {}},
        rng_seed=11,
    )

    assert receipt["result"]["ending_evidence"]["conclusion_id"] == "corbitt-destroyed"
    assert receipt["result"]["scenario_san_reward_expr"] == "1D6"
    assert receipt["result"]["scenario_san_reward"]["expression"] == "1D6"
    roll_rows = [
        json.loads(line)
        for line in (campaign / "logs" / "rolls.jsonl").read_text(
            encoding="utf-8"
        ).splitlines()
        if line.strip()
    ]
    reward_roll = next(
        row for row in roll_rows
        if row.get("payload", {}).get("kind") == "scenario_san_reward"
    )
    assert reward_roll["actor"] == "inv"
    assert reward_roll["payload"]["actor_id"] == "inv"
    assert reward_roll["payload"]["source"] == "conclusion_rewards"
    assert reward_roll["payload"]["san_delta"] >= 0
    assert reward_roll["payload"]["rule_ref"] == (
        "module.haunting.conclusion_sanity_reward"
    )
    event_rows = [
        json.loads(line)
        for line in (campaign / "logs" / "events.jsonl").read_text(
            encoding="utf-8"
        ).splitlines()
        if line.strip()
    ]
    reward_event = next(
        row for row in event_rows if row.get("event_type") == "reward"
    )
    assert reward_event["source"] == "conclusion_rewards"
    assert reward_event["roll_id"] == reward_roll["payload"]["roll_id"]
    assert reward_event["conclusion_id"] == "corbitt-destroyed"


def test_same_structured_conclusion_reward_is_consumed_once_across_endings(
    tmp_path,
):
    character = _workspace(tmp_path)
    campaign = tmp_path / ".coc" / "campaigns" / "camp"
    scenario = campaign / "scenario"
    scenario.mkdir(parents=True, exist_ok=True)
    (scenario / "story-graph.json").write_text(json.dumps({
        "scenes": [{
            "scene_id": "corbitt-confrontation",
            "conclusion_contract": {
                "conclusion_id": "corbitt-destroyed",
                "requires_combat_outcome": "investigators_win",
                "session_ending": True,
                "sanity_reward": {"die": "1D6", "rule_ref": "module.reward"},
            },
        }],
    }), encoding="utf-8")
    _seed_structured_combat_conclusion(campaign)
    event_path = campaign / "logs" / "events.jsonl"
    _persist_current_ending(campaign, {
        "event_type": "session_ending",
        "scene_id": "corbitt-confrontation",
        "kind": "conclusion",
        "decision_id": "conclusion-one",
        "investigator_ids": ["inv"],
    })
    operation = {"schema_version": 1, "kind": "development.settle", "payload": {}}
    first = ops.execute_operation(
        tmp_path,
        campaign_id="camp",
        investigator_id="inv",
        character_path=character,
        operation=operation,
        rng_seed=11,
    )
    first_reward = first["result"]["scenario_san_reward"]
    assert first["result"]["scenario_san_reward_applied"] is True
    sanity_path = ops.coc_sanity.sanity_snapshot_path(campaign, "inv")
    san_after_first = json.loads(sanity_path.read_text(encoding="utf-8"))[
        "san_current"
    ]

    _record_current_tick(
        campaign, "Spot Hidden", "runtime-test:conclusion-two-tick"
    )
    _persist_current_ending(campaign, {
        "event_type": "session_ending",
        "scene_id": "corbitt-confrontation",
        "kind": "conclusion",
        "decision_id": "conclusion-two",
        "investigator_ids": ["inv"],
    })
    second = ops.execute_operation(
        tmp_path,
        campaign_id="camp",
        investigator_id="inv",
        character_path=character,
        operation=operation,
        # Even an identical caller seed cannot duplicate public roll IDs for a
        # distinct durable ending identity.
        rng_seed=11,
    )

    assert second["result"]["ending_evidence"]["ending_id"] != first[
        "result"
    ]["ending_evidence"]["ending_id"]
    assert second["result"]["skills_checked"] == ["Spot Hidden"]
    assert second["result"]["luck_recovery"]["roll"] is not None
    assert second["result"]["scenario_san_reward_applied"] is False
    assert second["result"]["scenario_san_reward"]["replayed"] is True
    assert second["result"]["scenario_san_reward"]["rolls"] == first_reward["rolls"]
    assert json.loads(sanity_path.read_text(encoding="utf-8"))[
        "san_current"
    ] == san_after_first
    rolls = _read_jsonl(campaign / "logs" / "rolls.jsonl")
    assert len({row["roll_id"] for row in rolls}) == len(rolls)
    assert sum(
        row.get("payload", {}).get("kind") == "scenario_san_reward"
        for row in rolls
    ) == 1
    assert sum(
        row.get("payload", {}).get("kind") == "luck_recovery"
        for row in rolls
    ) == 2
    rewards = [
        row for row in _read_jsonl(event_path)
        if row.get("event_type") == "reward"
        and row.get("source") == "conclusion_rewards"
    ]
    assert len(rewards) == 1
    reward_receipts = list((
        campaign / "save" / "development-settlements" / "conclusion-rewards" / "inv"
    ).glob("*.json"))
    assert len(reward_receipts) == 1
    durable = json.loads(reward_receipts[0].read_text(encoding="utf-8"))
    assert durable["ending_id"] == first["result"]["ending_evidence"]["ending_id"]
    assert durable["roll_id"] == rewards[0]["roll_id"]


def test_development_settle_rejects_stale_combat_victory(tmp_path):
    character = _workspace(tmp_path)
    campaign = tmp_path / ".coc" / "campaigns" / "camp"
    scenario = campaign / "scenario"
    scenario.mkdir(parents=True, exist_ok=True)
    (scenario / "story-graph.json").write_text(json.dumps({
        "scenes": [{
            "scene_id": "corbitt-confrontation",
            "conclusion_contract": {
                "conclusion_id": "corbitt-destroyed",
                "requires_combat_outcome": "investigators_win",
                "session_ending": True,
                "sanity_reward": {"die": "1D6", "rule_ref": "module.reward"},
            },
        }],
    }), encoding="utf-8")
    combat_id = "combat-corbitt-rematch"
    (campaign / "save" / "combat.json").write_text(json.dumps({
        "schema_version": 2,
        "combat_id": combat_id,
        "scene_ref": "scene/corbitt-confrontation",
        "status": "concluded",
        "outcome": "monsters_win",
    }), encoding="utf-8")
    (campaign / "logs" / "events.jsonl").write_text("\n".join([
        json.dumps({
            "event_type": "combat_ended",
            "combat_id": combat_id,
            "outcome": "investigators_win",
        }),
        json.dumps({
            "event_type": "combat_ended",
            "combat_id": combat_id,
            "outcome": "monsters_win",
        }),
    ]) + "\n", encoding="utf-8")
    _persist_current_ending(campaign, {
        "event_type": "session_ending",
        "scene_id": "corbitt-confrontation",
        "kind": "conclusion",
        "decision_id": "stale-combat-ending",
    })

    receipt = ops.execute_operation(
        tmp_path,
        campaign_id="camp",
        investigator_id="inv",
        character_path=character,
        operation={"schema_version": 1, "kind": "development.settle", "payload": {}},
        rng_seed=11,
    )
    assert receipt["result"]["ending_evidence"]["conclusion_id"] is None
    assert receipt["result"]["scenario_san_reward_expr"] is None
    assert "scenario_san_reward" not in receipt["result"]
    assert not any(
        row.get("payload", {}).get("kind") == "scenario_san_reward"
        for row in _read_jsonl(campaign / "logs" / "rolls.jsonl")
    )


def _seed_quick_start_corbitt_ending(root: Path, campaign_id: str = "quick-san"):
    started = ops.execute_setup_operation(
        root,
        operation={
            "schema_version": 1,
            "kind": "campaign.quick_start",
            "payload": {
                "scenario_id": "the-haunting",
                "pregen_id": "thomas-hayes",
                "campaign_id": campaign_id,
            },
        },
    )
    campaign = root / ".coc" / "campaigns" / campaign_id
    _seed_structured_combat_conclusion(campaign)
    investigator_id = started["result"]["investigator_id"]
    record = {
        "event_type": "session_ending",
        "scene_id": "corbitt-confrontation",
        "kind": "conclusion",
        "decision_id": f"{campaign_id}-ending",
        "investigator_ids": [investigator_id],
        "ts": "2026-07-15T00:00:00Z",
    }
    record["ending_id"] = ops.coc_development.ending_id_for_event(record)
    record["event_id"] = ops.coc_development.ending_event_id(record["ending_id"])
    capsule = ops.coc_development.build_ending_settlement_capsule(
        campaign, record
    )
    capsule_path = ops.coc_development.persist_ending_settlement_capsule(
        campaign, capsule
    )
    record["settlement_capsule_ref"] = capsule_path.relative_to(campaign).as_posix()
    record["settlement_capsule_sha256"] = capsule["capsule_sha256"]
    with (campaign / "logs" / "events.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record) + "\n")
    return started, campaign


def test_fresh_quick_start_development_reward_seeds_sanity_from_investigator_state(tmp_path):
    started, campaign = _seed_quick_start_corbitt_ending(tmp_path)
    investigator_id = started["result"]["investigator_id"]
    character_path = Path(started["result"]["character_path"])
    inv_path = campaign / "save" / "investigator-state" / f"{investigator_id}.json"
    assert json.loads(inv_path.read_text(encoding="utf-8"))["current_san"] == 55
    assert not (campaign / "save" / "sanity.json").exists()
    operation = {"schema_version": 1, "kind": "development.settle", "payload": {}}

    receipt = ops.execute_operation(
        tmp_path,
        campaign_id="quick-san",
        investigator_id=investigator_id,
        character_path=character_path,
        operation=operation,
        rng_seed=2,
    )

    reward = receipt["result"]["scenario_san_reward"]
    assert reward["rolls"] == [4]
    assert reward["san_before"] == 55
    assert reward["san_gained"] == 4
    assert reward["san_after"] == 59
    assert reward["san_max"] == 99
    sanity = json.loads((campaign / "save" / "sanity.json").read_text(encoding="utf-8"))
    investigator = json.loads(inv_path.read_text(encoding="utf-8"))
    assert sanity["san_current"] == 59
    assert investigator["current_san"] == 59
    rolls_before = (campaign / "logs" / "rolls.jsonl").read_text(encoding="utf-8")
    state_before = (campaign / "save" / "sanity.json").read_text(encoding="utf-8")

    repeated = ops.execute_operation(
        tmp_path,
        campaign_id="quick-san",
        investigator_id=investigator_id,
        character_path=character_path,
        operation=operation,
        rng_seed=999,
    )

    assert repeated == receipt
    assert (campaign / "logs" / "rolls.jsonl").read_text(encoding="utf-8") == rolls_before
    assert (campaign / "save" / "sanity.json").read_text(encoding="utf-8") == state_before


def test_development_reward_uses_existing_sanity_snapshot_and_respects_cap(tmp_path):
    started, campaign = _seed_quick_start_corbitt_ending(tmp_path, "quick-san-cap")
    investigator_id = started["result"]["investigator_id"]
    character_path = Path(started["result"]["character_path"])
    sanity = ops.coc_sanity.SanitySession(
        investigator_id,
        san_max=56,
        int_value=70,
        rng=random.Random(1),
        campaign_dir=campaign,
    )
    sanity.san_current = 55
    sanity.day_start_san = 55
    sanity.save(campaign, strict_mirror=True)
    inv_path = campaign / "save" / "investigator-state" / f"{investigator_id}.json"
    mirrored = json.loads(inv_path.read_text(encoding="utf-8"))
    mirrored["current_san"] = 12
    inv_path.write_text(json.dumps(mirrored), encoding="utf-8")

    receipt = ops.execute_operation(
        tmp_path,
        campaign_id="quick-san-cap",
        investigator_id=investigator_id,
        character_path=character_path,
        operation={"schema_version": 1, "kind": "development.settle", "payload": {}},
        rng_seed=2,
    )

    reward = receipt["result"]["scenario_san_reward"]
    assert reward["rolls"] == [4]
    assert reward["san_before"] == 55
    assert reward["san_gained"] == 1
    assert reward["san_after"] == reward["san_max"] == 56
    assert json.loads(inv_path.read_text(encoding="utf-8"))["current_san"] == 56


def test_frozen_capped_san_reward_cannot_turn_into_later_healing(tmp_path):
    character = _workspace(tmp_path)
    campaign = tmp_path / ".coc" / "campaigns" / "camp"
    scenario = campaign / "scenario"
    scenario.mkdir(parents=True, exist_ok=True)
    (scenario / "story-graph.json").write_text(json.dumps({
        "scenes": [{
            "scene_id": "corbitt-confrontation",
            "conclusion_contract": {
                "conclusion_id": "corbitt-destroyed",
                "requires_combat_outcome": "investigators_win",
                "session_ending": True,
                "sanity_reward": {"die": "1D6", "rule_ref": "test.reward"},
            },
        }],
    }), encoding="utf-8")
    _seed_structured_combat_conclusion(campaign)
    sanity = ops.coc_sanity.SanitySession(
        "inv", san_max=99, int_value=70, rng=random.Random(1),
        campaign_dir=campaign,
    )
    sanity.san_current = 99
    sanity.day_start_san = 99
    sanity.save(campaign, strict_mirror=True)
    ending = _persist_current_ending(campaign, {
        "event_type": "session_ending",
        "ending_id": "ending-frozen-zero-san",
        "scene_id": "corbitt-confrontation",
        "kind": "conclusion",
        "decision_id": "frozen-zero-san",
    })
    plan = ending["development_inputs"]["inv"]["deterministic_plan"]
    assert plan["scenario_san_reward"]["total"] > 0
    assert plan["scenario_san_planned_delta"] == 0
    # A legitimate later loss occurs before the delayed ending retry.
    sanity = ops.coc_sanity.SanitySession.load(campaign, "inv")
    sanity.san_current = 90
    sanity.save(campaign, strict_mirror=True)
    settlement = ops.coc_development.ending_settlement_path(
        campaign, ending["ending_id"], "inv"
    )

    receipt = ops._development_operation_body(
        campaign_dir=campaign,
        investigator_id="inv",
        payload={},
        rng=random.Random(9),
        ending=ending,
        settlement_path=settlement,
    )

    reward = receipt["result"]["scenario_san_reward"]
    assert reward["planned_san_delta"] == 0
    assert reward["san_before"] == reward["san_after"] == 90
    assert reward["san_gained"] == 0
    assert ops.coc_sanity.SanitySession.load(campaign, "inv").san_current == 90
    assert Path(character).is_file()


def test_scenario_reward_planned_baseline_includes_frozen_development_delta(
    tmp_path,
):
    character = _workspace(tmp_path)
    campaign = tmp_path / ".coc" / "campaigns" / "camp"
    sheet = json.loads(Path(character).read_text(encoding="utf-8"))
    sheet["skills"]["Spot Hidden"] = 89
    Path(character).write_text(json.dumps(sheet), encoding="utf-8")
    sanity = ops.coc_sanity.SanitySession(
        "inv", san_max=99, int_value=70, rng=random.Random(1),
        campaign_dir=campaign,
    )
    sanity.san_current = 80
    sanity.day_start_san = 80
    sanity.save(campaign, strict_mirror=True)
    scenario = campaign / "scenario"
    scenario.mkdir(parents=True, exist_ok=True)
    (scenario / "story-graph.json").write_text(json.dumps({
        "scenes": [{
            "scene_id": "corbitt-confrontation",
            "conclusion_contract": {
                "conclusion_id": "corbitt-destroyed",
                "requires_combat_outcome": "investigators_win",
                "session_ending": True,
                "sanity_reward": {
                    "die": "1D6", "rule_ref": "test.reward-order"
                },
            },
        }],
    }), encoding="utf-8")
    _seed_structured_combat_conclusion(campaign)
    _record_current_tick(campaign, source="runtime-test:reward-order")
    baseline = {
        "skills": {"Spot Hidden": 89},
        "luck": 50,
        "sanity": {
            "source": "canonical",
            "current": 80,
            "max": 99,
            "awfulness_caps": {},
        },
    }
    ending_id = None
    plan = None
    for index in range(500):
        candidate_ending_id = f"ending-planned-reward-order-{index}"
        candidate = ops.coc_development._deterministic_development_plan(
            skills=baseline["skills"],
            luck=baseline["luck"],
            sanity=baseline["sanity"],
            seed_material=(
                f"{candidate_ending_id}:inv:development.settle"
            ),
            scenario_reward_expr="1D6",
        )
        if (
            candidate["development_san_planned_delta"] > 0
            and candidate["scenario_san_planned_delta"] > 0
        ):
            ending_id = candidate_ending_id
            plan = candidate
            break
    assert plan is not None and ending_id is not None
    ending = _persist_current_ending(campaign, {
        "event_type": "session_ending",
        "ending_id": ending_id,
        "scene_id": "corbitt-confrontation",
        "kind": "conclusion",
        "decision_id": "planned-reward-order",
    })
    frozen = ending["development_inputs"]["inv"]
    assert frozen["mechanical_baseline"] == baseline
    assert frozen["deterministic_plan"] == plan
    live_sanity = ops.coc_sanity.SanitySession(
        "inv", san_max=99, int_value=70, rng=random.Random(1),
        campaign_dir=campaign,
    )
    live_sanity.san_current = 30
    live_sanity.day_start_san = 30
    live_sanity.save(campaign, strict_mirror=True)
    settlement = ops.coc_development.ending_settlement_path(
        campaign, ending["ending_id"], "inv"
    )

    receipt = ops._development_operation_body(
        campaign_dir=campaign,
        investigator_id="inv",
        payload={},
        rng=random.Random(9),
        ending=ending,
        settlement_path=settlement,
    )

    development_reward = receipt["result"]["san_reward"]
    scenario_reward = receipt["result"]["scenario_san_reward"]
    expected_planned_before = min(
        baseline["sanity"]["max"],
        baseline["sanity"]["current"]
        + plan["development_san_planned_delta"],
    )
    assert development_reward["planned_san_before"] == 80
    assert development_reward["san_before"] == 30
    assert scenario_reward["planned_san_before"] == expected_planned_before
    assert scenario_reward["planned_san_delta"] == plan[
        "scenario_san_planned_delta"
    ]
    assert scenario_reward["san_before"] == (
        30 + plan["development_san_planned_delta"]
    )
    assert scenario_reward["planned_san_before"] != scenario_reward["san_before"]
    assert Path(character).is_file()


def test_setup_gateway_quick_start_has_direct_and_pi_sdk_parity(tmp_path):
    operation = {
        "schema_version": 1,
        "kind": "campaign.quick_start",
        "payload": {
            "scenario_id": "the-haunting",
            "pregen_id": "thomas-hayes",
            "campaign_id": "quick",
        },
    }
    direct_root = tmp_path / "direct"
    pi_root = tmp_path / "pi"
    direct = ops.execute_setup_operation(direct_root, operation=operation)
    api = _load("runtime_sdk_setup_parity", REPO / "runtime" / "sdk" / "api.py")
    through_pi = api.setup_workspace(pi_root, operation)
    for receipt in (direct, through_pi):
        # Absolute local paths are intentionally workspace-specific; all
        # semantic result fields and relative state refs are host-neutral.
        receipt["result"].pop("character_path", None)
        receipt["result"].pop("campaign_dir", None)
    assert through_pi == direct
    assert (pi_root / ".coc" / "campaigns" / "quick" / "campaign.json").is_file()


def test_onboarding_inspect_exposes_all_shared_discovery_surfaces(tmp_path):
    receipt = ops.execute_setup_operation(
        tmp_path,
        operation={"schema_version": 1, "kind": "onboarding.inspect", "payload": {}},
    )
    assert receipt["status"] == "PASS"
    haunting = next(
        item for item in receipt["result"]["starters"]
        if item["scenario_id"] == "the-haunting"
    )
    assert haunting["pregens"]
    assert receipt["result"]["characteristic_generation_methods"]
    assert "roll_expression" in receipt["result"]["rule_helper_api"]
    assert "tome.read" in receipt["result"]["session_operation_kinds"]
    assert "investigator.render_card" in receipt["result"]["setup_operation_kinds"]

    rules = ops.execute_setup_operation(
        tmp_path,
        operation={"schema_version": 1, "kind": "rules.inspect", "payload": {}},
    )
    assert rules["result"]["helpers"] == receipt["result"]["rule_helper_api"]


def test_pi_interact_uses_host_semantic_evidence_without_scanning_prose(tmp_path):
    character = _workspace(tmp_path)
    operation = _cast_operation()
    route = {
        "schema_version": 1,
        "route": "operation",
        "reason": "host semantically identified an explicit spell cast",
        "operation": operation,
    }
    api = _load("runtime_sdk_interact_operation", REPO / "runtime" / "sdk" / "api.py")
    session_id = api.create_session(tmp_path, campaign_id="camp", investigator_id="inv")
    dispatched = api.interact(
        session_id,
        "这句话的表面词形不参与本地分类",
        semantic_route=route,
        rng_seed=1,
    )
    assert dispatched["mode"] == "operation"
    direct_root = tmp_path / "direct"
    direct_character = _workspace(direct_root)
    direct = ops.execute_operation(
        direct_root,
        campaign_id="camp",
        investigator_id="inv",
        character_path=direct_character,
        operation=operation,
        rng_seed=1,
    )
    assert dispatched["receipt"] == direct
    route_rows = (
        tmp_path / ".coc" / "campaigns" / "camp" / "logs" / "operation-routes.jsonl"
    ).read_text(encoding="utf-8").splitlines()
    assert len(route_rows) == 1
    row = json.loads(route_rows[0])
    assert row["operation_kind"] == "magic.cast"
    assert "这句话" not in route_rows[0]


def test_semantic_route_rejects_inconsistent_or_host_specific_shape():
    with pytest.raises(ops.RuntimeOperationError, match="operation must be null"):
        ops.validate_semantic_route({
            "schema_version": 1,
            "route": "ordinary_turn",
            "reason": "uncertain",
            "operation": _cast_operation(),
        })
    with pytest.raises(ops.RuntimeOperationError, match="must contain"):
        ops.validate_semantic_route({
            "schema_version": 1,
            "route": "ordinary_turn",
            "reason": "uncertain",
            "operation": None,
            "host": "pi",
        })


def test_pi_operation_router_accepts_structured_semantics_and_fails_closed(tmp_path):
    router = _load(
        "runtime_pi_operation_router_test",
        REPO / "runtime" / "adapters" / "pi" / "operation_router.py",
    )
    success = tmp_path / "success.py"
    success.write_text(
        "#!/usr/bin/env python3\n"
        "import json\n"
        "print(json.dumps({'ok': True, 'semantic_route': {"
        "'schema_version': 1, 'route': 'ordinary_turn', "
        "'reason': 'semantic uncertainty', 'operation': None}}))\n",
        encoding="utf-8",
    )
    success.chmod(0o755)
    routed = router.route_player_action("任意自然语言", {}, runner_path=success)
    assert routed["semantic_route"]["route"] == "ordinary_turn"
    assert routed.get("fallback") is not True

    failure = tmp_path / "failure.py"
    failure.write_text(
        "#!/usr/bin/env python3\n"
        "import json, sys\n"
        "print(json.dumps({'ok': False, 'error': 'unavailable'}))\n"
        "sys.exit(1)\n",
        encoding="utf-8",
    )
    failure.chmod(0o755)
    fallback = router.route_player_action("任意自然语言", {}, runner_path=failure)
    assert fallback["fallback"] is True
    assert fallback["semantic_route"] == {
        "schema_version": 1,
        "route": "ordinary_turn",
        "reason": "operation_router_unavailable",
        "operation": None,
    }


def test_bind_pdf_field_error_names_every_missing_and_unsupported_field(tmp_path):
    with pytest.raises(
        ops.RuntimeOperationError,
        match=(
            r"missing: scenario_id, title; unsupported: scenario_title; "
            r"allowed: campaign_id, compile_now, reference_cached_pages, "
            r"scenario_id, source_bundle_path, title"
        ),
    ):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "scenario.bind_pdf",
            "payload": {
                "campaign_id": "custom",
                "scenario_title": "Custom Module",
                "source_bundle_path": str(tmp_path / "module-source"),
            },
        })


def test_public_bind_pdf_rejects_forged_review_authority(tmp_path):
    with pytest.raises(
        ops.RuntimeOperationError,
        match=r"unsupported: opening_source_provenance",
    ):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "scenario.bind_pdf",
            "payload": {
                "campaign_id": "custom",
                "scenario_id": "custom-module",
                "title": "Custom Module",
                "source_bundle_path": str(tmp_path / "source"),
                "opening_source_provenance": (
                    "coordinator_reviewed_playable_opening"
                ),
            },
        })


def _review_rebind_fixture(tmp_path: Path):
    """Campaign + first bind (pdf-skill pages 0-1) + an OCR-cached page 2.

    Mirrors the blocker2 scene: pages 0-1 registered by the first bundle,
    page 2 registered first by the whole-book baiduocr lane, then the review
    transport rebinds a window whose page 2 was re-extracted by the pdf-skill
    producer (cross-producer, different text).
    """
    ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "campaign.create",
        "payload": {
            "campaign_id": "custom",
            "title": "Custom Campaign",
            "era": "1920s",
            "play_language": "zh-Hans",
        },
    })
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"%PDF host-owned review fixture")

    def write_bundle(name: str, texts: dict[int, str]) -> Path:
        bundle = tmp_path / name
        bundle.mkdir()
        pages = []
        for pdf_index, body in sorted(texts.items()):
            markdown = f"# Page {pdf_index}\n\n{body}\n".encode()
            markdown_path = f"page-{pdf_index:04d}.md"
            (bundle / markdown_path).write_bytes(markdown)
            pages.append({
                "pdf_index": pdf_index,
                "markdown_path": markdown_path,
                "text_sha256": hashlib.sha256(markdown).hexdigest(),
                "review_state": "manual_accepted",
                "parse_confidence": 0.93,
                "grep_anchors": [f"Page {pdf_index}"],
            })
        (bundle / "manifest.json").write_text(json.dumps({
            "schema_version": 1,
            "producer": "codex-pdf-skill",
            "source": {
                "source_id": "pdf:custom-module",
                "title": "Custom Module",
                "path": str(pdf),
                "file_sha256": hashlib.sha256(
                    pdf.read_bytes()
                ).hexdigest(),
                "page_count": 4,
            },
            "pages": pages,
        }), encoding="utf-8")
        return bundle

    first = write_bundle("first-source", {
        0: "Reviewed opening page.", 1: "Second page.",
    })
    first_bound = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "scenario.bind_pdf",
        "payload": {
            "campaign_id": "custom",
            "scenario_id": "custom-module",
            "title": "Custom Module",
            "source_bundle_path": str(first),
            "compile_now": False,
        },
    })
    assert first_bound["status"] == "PASS"
    # The whole-book OCR lane registers page 2 first (baiduocr, unreviewed).
    ocr_text = "# Page 2\n\nOCR corpus page two.\n"
    ops.coc_module_assets.put_page(
        tmp_path,
        "custom-module",
        2,
        ocr_text,
        meta={
            "source_id": "pdf:custom-module",
            "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
            "producer": "baiduocr",
            "review_state": "unreviewed",
            "parse_confidence": None,
            "source": "baiduocr",
            "unreviewed": True,
            "doc_ref": "doc_2.md",
        },
    )
    ocr_digest = hashlib.sha256(ocr_text.encode()).hexdigest()
    reviewed = write_bundle("reviewed-source", {
        0: "Reviewed opening page.", 1: "Second page.",
        # Cross-producer re-extraction: same page, pdf-skill text differs
        # from the cached baiduocr text (blocker2 page-4 pattern).
        2: "Pdf-skill re-extracted page two.",
    })
    return tmp_path, pdf, first_bound, reviewed, ocr_digest


def _bind_review(tmp_path: Path, bundle: Path, **extra):
    return ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "scenario.bind_pdf",
        "payload": {
            "campaign_id": "custom",
            "scenario_id": "custom-module",
            "title": "Custom Module",
            "source_bundle_path": str(bundle),
            "compile_now": False,
            **extra,
        },
    })


def test_review_rebind_references_cross_producer_cached_page(tmp_path: Path):
    """The review transport rebind (reference_cached_pages=True) accepts a
    reviewed window whose page was re-extracted by a different producer than
    the cached page: the page is bound by content address (cache identity
    and producer stay authoritative), not compared as text."""
    tmp_path, pdf, first_bound, reviewed, ocr_digest = (
        _review_rebind_fixture(tmp_path)
    )
    bound = _bind_review(tmp_path, reviewed, reference_cached_pages=True)
    assert bound["status"] == "PASS"
    source_cache = bound["result"]["source_cache"]
    assert source_cache["referenced_cached_page_count"] == 1
    assert source_cache["referenced_cached_pdf_indices"] == [2]
    assert source_cache["new_page_count"] == 0
    assert source_cache["reused_page_count"] == 3
    # The cached OCR page 2 keeps its text and producer identity untouched.
    cached = ops.coc_module_assets.get_page(tmp_path, "custom-module", 2)
    assert "OCR corpus page two." in cached["text"]
    assert "re-extracted" not in cached["text"]
    assert cached["meta"]["producer"] == "baiduocr"
    assert cached["meta"]["review_state"] == "unreviewed"
    # The reviewed bundle is now bound to the referenced cached page.
    assert bound["result"]["source_cache"]["bundle_sha256"] in (
        cached["meta"].get("bundle_sha256s") or []
    )
    # The reference is durable provenance, not a silent retcon.
    state = ops.coc_module_assets.read_full_parse_state(
        tmp_path, "custom-module",
    )
    reference = next(
        row for row in (state.get("provenance") or [])
        if row.get("pdf_index") == 2
    )
    assert reference["disposition"] == "review_references_cache"
    assert reference["source"] == "opening_review_transport"
    assert reference["incoming_producer"] == "codex-pdf-skill"
    assert reference["existing_producer"] == "baiduocr"
    assert reference["existing_text_sha256"] == ocr_digest
    assert reference["incoming_text_sha256"] != ocr_digest
    # The bundle row records the referenced (cached) identity, not the
    # discarded incoming pdf-skill text.
    identity = json.loads(
        (
            tmp_path / ".coc" / "module-assets" / "custom-module"
            / "identity.json"
        ).read_text(encoding="utf-8")
    )
    row = next(
        row for row in identity["source_bundles"]
        if row["bundle_sha256"] == bound["result"]["source_cache"]["bundle_sha256"]
    )
    page_revision = next(
        rev for rev in row["page_revisions"] if rev["pdf_index"] == 2
    )
    assert page_revision["text_sha256"] == ocr_digest
    assert sorted(row["pdf_indices"]) == [0, 1, 2]


def test_review_rebind_rejects_same_producer_page_drift(tmp_path: Path):
    """Tamper resistance is preserved: a reviewed page that drifts from a
    cached page of the same extraction pipeline (pdf-skill vs pdf-skill) is
    real conflict and is rejected even on the review lane; the strict lane
    rejects it as well."""
    tmp_path, pdf, first_bound, reviewed, ocr_digest = (
        _review_rebind_fixture(tmp_path)
    )
    tampered = tmp_path / "tampered-source"
    tampered.mkdir()
    texts = {
        0: "Tampered opening text.", 1: "Second page.",
        2: "Pdf-skill re-extracted page two.",
    }
    pages = []
    for pdf_index, body in sorted(texts.items()):
        markdown = f"# Page {pdf_index}\n\n{body}\n".encode()
        markdown_path = f"page-{pdf_index:04d}.md"
        (tampered / markdown_path).write_bytes(markdown)
        pages.append({
            "pdf_index": pdf_index,
            "markdown_path": markdown_path,
            "text_sha256": hashlib.sha256(markdown).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.93,
            "grep_anchors": [f"Page {pdf_index}"],
        })
    (tampered / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:custom-module",
            "title": "Custom Module",
            "path": str(pdf),
            "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
            "page_count": 4,
        },
        "pages": pages,
    }), encoding="utf-8")
    # Same pipeline (pdf-skill) page 0 drifted -> still refused on the
    # review lane (campaign references the root, no silent overwrite).
    with pytest.raises(
        ops.coc_module_assets.ModuleAssetsError,
        match=r"cached page 0 content drift",
    ):
        _bind_review(tmp_path, tampered, reference_cached_pages=True)
    # The strict public lane rejects the same bundle unchanged.
    with pytest.raises(
        ops.coc_module_assets.ModuleAssetsError,
        match=r"cached page 0 content drift",
    ):
        _bind_review(tmp_path, tampered)


def test_review_rebind_rejects_non_boolean_lane_flag(tmp_path):
    tmp_path, pdf, first_bound, reviewed, ocr_digest = (
        _review_rebind_fixture(tmp_path)
    )
    with pytest.raises(
        ops.RuntimeOperationError,
        match=r"reference_cached_pages must be a boolean",
    ):
        _bind_review(tmp_path, reviewed, reference_cached_pages="yes")


def test_review_rebind_accepts_blocker2_cross_producer_sample(tmp_path):
    """Replay of the blocker2 evidence shape (herald-yk-final-01): pdf-skill
    first bundle holds pages 1-3 (ef994624/96f6d905/c995bd3d), the whole-book
    OCR lane cached page 4 first (e45307c8, baiduocr), and the reviewed
    bundle re-extracted page 4 with the pdf-skill producer (76499f01).
    The review rebind references the cached page instead of failing."""
    ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "campaign.create",
        "payload": {
            "campaign_id": "herald-yk-final-01",
            "title": "Herald Campaign",
            "era": "1920s",
            "play_language": "zh-Hans",
        },
    })
    pdf = tmp_path / "herald.pdf"
    pdf.write_bytes(b"%PDF herald fixture")
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()

    def write_bundle(name: str, texts: dict[int, str]) -> Path:
        bundle = tmp_path / name
        bundle.mkdir()
        pages = []
        for pdf_index, body in sorted(texts.items()):
            markdown = f"# Page {pdf_index}\n\n{body}\n".encode()
            markdown_path = f"page-{pdf_index:04d}.md"
            (bundle / markdown_path).write_bytes(markdown)
            pages.append({
                "pdf_index": pdf_index,
                "markdown_path": markdown_path,
                "text_sha256": hashlib.sha256(markdown).hexdigest(),
                "review_state": "manual_accepted",
                "parse_confidence": 0.93,
                "grep_anchors": [f"Page {pdf_index}"],
            })
        (bundle / "manifest.json").write_text(json.dumps({
            "schema_version": 1,
            "producer": "codex-pdf-skill",
            "source": {
                "source_id": "pdf:herald",
                "title": "Herald of the Yellow King",
                "path": str(pdf),
                "file_sha256": file_sha,
                "page_count": 8,
            },
            "pages": pages,
        }), encoding="utf-8")
        return bundle

    first = write_bundle("first-bundle", {
        1: "CALL OF CTHULHU", 2: "RIPPLES FROM CARCOSA",
        3: "THREE SCENARIOS EXPLORING HASTUR",
    })
    first_bound = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "scenario.bind_pdf",
        "payload": {
            "campaign_id": "herald-yk-final-01",
            "scenario_id": "herald",
            "title": "Herald of the Yellow King",
            "source_bundle_path": str(first),
            "compile_now": False,
        },
    })
    assert first_bound["status"] == "PASS"
    ocr_text = "# Page 4\n\n12月的帷幕…谢尔伯思\n"
    ops.coc_module_assets.put_page(
        tmp_path,
        "herald",
        4,
        ocr_text,
        meta={
            "source_id": "pdf:herald",
            "file_sha256": file_sha,
            "producer": "baiduocr",
            "review_state": "unreviewed",
            "parse_confidence": None,
            "source": "baiduocr",
            "unreviewed": True,
            "doc_ref": "doc_4.md",
        },
    )
    ocr_digest = hashlib.sha256(ocr_text.encode()).hexdigest()
    reviewed = write_bundle("reviewed-bundle", {
        1: "CALL OF CTHULHU", 2: "RIPPLES FROM CARCOSA",
        3: "THREE SCENARIOS EXPLORING HASTUR",
        # pdf-skill re-extraction differs from the cached OCR text.
        4: "# Page 4\n\n12 月的帷幕…谢尔伯恩\n",
    })
    bound = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "scenario.bind_pdf",
        "payload": {
            "campaign_id": "herald-yk-final-01",
            "scenario_id": "herald",
            "title": "Herald of the Yellow King",
            "source_bundle_path": str(reviewed),
            "compile_now": False,
            "reference_cached_pages": True,
        },
    })
    assert bound["status"] == "PASS"
    source_cache = bound["result"]["source_cache"]
    assert source_cache["referenced_cached_pdf_indices"] == [4]
    cached = ops.coc_module_assets.get_page(tmp_path, "herald", 4)
    assert cached["meta"]["text_sha256"] == ocr_digest
    assert cached["meta"]["producer"] == "baiduocr"
    assert bound["result"]["source_cache"]["bundle_sha256"] in (
        cached["meta"].get("bundle_sha256s") or []
    )
    # Without the review lane the same window is still refused (regression).
    with pytest.raises(
        ops.coc_module_assets.ModuleAssetsError,
        match=r"cached page 4 content drift",
    ):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "scenario.bind_pdf",
            "payload": {
                "campaign_id": "herald-yk-final-01",
                "scenario_id": "herald",
                "title": "Herald of the Yellow King",
                "source_bundle_path": str(reviewed),
                "compile_now": False,
            },
        })


def test_setup_gateway_creates_campaign_investigator_link_and_pdf_binding(tmp_path):
    campaign = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "campaign.create",
        "payload": {
            "campaign_id": "custom",
            "title": "Custom Campaign",
            "era": "1920s",
            "play_language": "zh-Hans",
        },
    })
    assert campaign["status"] == "PASS"
    sheet = {
        "schema_version": 1,
        "id": "custom-inv",
        "name": "Custom Investigator",
        "characteristics": {
            "STR": 50, "CON": 50, "SIZ": 50, "DEX": 50,
            "APP": 50, "INT": 50, "POW": 50, "EDU": 50,
        },
        "derived": {
            "HP": 10, "SAN": 50, "MP": 10, "Luck": 60,
            "DB": "none", "Build": 0, "MOV": 8,
        },
        "skills": {"Credit Rating": 20},
        "player_facing_sheet_zh": {
            "display_name": "自定义调查员",
            "era": "1920s",
            "nationality": "中国",
            "occupation": "记者",
            "characteristics": {
                "力量": {"key": "STR", "value": 50},
                "教育": {"key": "EDU", "value": 50},
            },
            "derived": {"生命值": 10, "理智": 50},
            "skills": [],
            "backstory_summary": "一名愿意追查异常事件的记者。",
        },
    }
    created = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "investigator.create",
        "payload": {
            "investigator_id": "custom-inv",
            "sheet": sheet,
            "creation": {"input_mode": "import_complete_sheet"},
        },
    })
    assert created["status"] == "PASS"
    linked = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "campaign.link_investigator",
        "payload": {
            "campaign_id": "custom",
            "investigator_ids": ["custom-inv"],
        },
    })
    assert linked["result"]["investigator_ids"] == ["custom-inv"]
    runtime_state = json.loads(
        (tmp_path / ".coc" / "campaigns" / "custom" / "save"
         / "investigator-state" / "custom-inv.json").read_text(encoding="utf-8")
    )
    assert runtime_state["current_luck"] == 60

    card = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "investigator.render_card",
        "payload": {
            "campaign_id": "custom",
            "investigator_id": "custom-inv",
        },
    })
    assert card["status"] == "PASS"
    assert card["result"]["language"] == "zh-Hans"
    assert (tmp_path / card["result"]["markdown_path"]).is_file()
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"%PDF host-owned fixture")
    source_bundle = tmp_path / "module-source"
    source_bundle.mkdir()
    markdown = b"# Custom Module\n\nKeeper-only extracted source.\n"
    (source_bundle / "page-0000.md").write_bytes(markdown)
    (source_bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:custom-module",
            "title": "Custom Module",
            "path": str(pdf),
            "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
            "page_count": 1,
        },
        "pages": [{
            "pdf_index": 0,
            "markdown_path": "page-0000.md",
            "text_sha256": hashlib.sha256(markdown).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.93,
            "grep_anchors": ["Keeper-only extracted source."],
        }],
    }), encoding="utf-8")
    bound = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "scenario.bind_pdf",
        "payload": {
            "campaign_id": "custom",
            "scenario_id": "custom-module",
            "title": "Custom Module",
            "source_bundle_path": str(source_bundle),
            "compile_now": False,
        },
    })
    assert bound["status"] == "PASS"
    scenario = json.loads(
        (tmp_path / ".coc" / "campaigns" / "custom" / "scenario" / "scenario.json")
        .read_text(encoding="utf-8")
    )
    assert scenario["resolution_policy"] == "source_first"
    assert len(scenario["source"]["bundle_sha256"]) == 64
    assert scenario["source"]["source_bundle_path"] == str(source_bundle)
    assert scenario["opening_source_provenance"] == (
        "selection_hint_only_not_provenance"
    )
    assert "opening_source_provenance" not in scenario["source"]
    assert scenario["source_cache_asset_root_id"] == "custom-module"
    assert "progressive_asset_root_id" not in scenario
    assert bound["result"]["source_cache"]["asset_root_id"] == "custom-module"
    assert bound["result"]["source_cache"]["new_page_count"] == 1
    opening_root = module_project.resolve_opening_preparation_root(
        tmp_path, "custom",
    )
    assert opening_root["asset_root_id"] == "custom-module"
    assert opening_root["link_state"] == "source_bound"
    assert opening_root["source_id"] == "pdf:custom-module"
    assert opening_root["file_sha256"] == hashlib.sha256(pdf.read_bytes()).hexdigest()
    assert opening_root["bundle_sha256"] == scenario["source"]["bundle_sha256"]
    assert opening_root["bundle_pdf_indices"] == [0]
    cached_page = (
        tmp_path
        / ".coc"
        / "module-assets"
        / "custom-module"
        / "pages"
        / "0000.md"
    )
    assert cached_page.read_text(encoding="utf-8") == markdown.decode("utf-8")
    metadata = json.loads(
        (tmp_path / ".coc" / "campaigns" / "custom" / "campaign.json")
        .read_text(encoding="utf-8")
    )
    assert metadata["active_scenario_id"] == "custom-module"
    briefing_path = metadata["character_creation"]["briefing_path"]
    assert (tmp_path / briefing_path).is_file()
    assert bound["result"]["character_creation_briefing"]["briefing_path"] == briefing_path
    briefing_markdown = (tmp_path / briefing_path).read_text(encoding="utf-8")
    assert "图书馆使用" in briefing_markdown
    assert "快速数组：80、70、60、60、50、50、50、40" in briefing_markdown
    assert "当前自动快速建卡不匹配" not in briefing_markdown

    rerendered = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "campaign.render_briefing",
        "payload": {"campaign_id": "custom"},
    })
    assert rerendered["status"] == "PASS"
    assert rerendered["result"]["briefing_path"] == briefing_path
    assert (tmp_path / briefing_path).read_text(encoding="utf-8") == (
        briefing_markdown
    )

    continuation = {
        "schema_version": 1,
        "contract_id": "coc.opening-source-continue.v1",
        "campaign_id": "custom",
        "scenario_id": "custom-module",
        "selected_opening_pdf_indices": [0],
        "source_bundle_id": "custom-module",
        "source_bundle_path": str(source_bundle),
        "result_delivery": "task_return_to_parent",
    }
    with pytest.raises(
        ops.RuntimeOperationError,
        match="retained exact continuation",
    ):
        ops._build_opening_source_review_fulfillment(
            tmp_path,
            continuation={
                **continuation,
                "result_delivery": "caller_supplied",
            },
            status="reviewed",
            selected_opening_pdf_indices=[0],
        )
    with pytest.raises(
        ops.RuntimeOperationError,
        match="continuation differs from pending task",
    ):
        ops._build_opening_source_review_fulfillment(
            tmp_path,
            continuation={
                **continuation,
                "source_bundle_id": "forged-bundle-id",
            },
            status="reviewed",
            selected_opening_pdf_indices=[0],
        )
    with pytest.raises(
        ops.RuntimeOperationError,
        match="continuation differs from pending task",
    ):
        ops._build_opening_source_review_fulfillment(
            tmp_path,
            continuation=continuation,
            status="reviewed",
            selected_opening_pdf_indices=[1],
        )
    receipt = ops._build_opening_source_review_fulfillment(
        tmp_path,
        continuation=continuation,
        status="reviewed",
        selected_opening_pdf_indices=[0],
    )
    first_generation = scenario["opening_source_review_task"]["generation"]
    ops._apply_opening_source_review_fulfillment(tmp_path, receipt)
    with pytest.raises(
        ops.RuntimeOperationError,
        match="task authority is invalid",
    ):
        ops._apply_opening_source_review_fulfillment(tmp_path, receipt)

    ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "scenario.bind_pdf",
        "payload": {
            "campaign_id": "custom",
            "scenario_id": "custom-module",
            "title": "Custom Module",
            "source_bundle_path": str(source_bundle),
            "compile_now": False,
        },
    })
    rebound_scenario = json.loads(
        (
            tmp_path / ".coc" / "campaigns" / "custom"
            / "scenario" / "scenario.json"
        ).read_text(encoding="utf-8")
    )
    assert rebound_scenario["opening_source_review_task"]["generation"] == (
        first_generation + 1
    )
    with pytest.raises(
        ops.RuntimeOperationError,
        match="does not match pending task",
    ):
        ops._apply_opening_source_review_fulfillment(tmp_path, receipt)


def test_medieval_pdf_bind_and_rerender_write_kp_guided_briefing(tmp_path):
    created = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "campaign.create",
        "payload": {
            "campaign_id": "medieval-briefing",
            "title": "Medieval Campaign",
            "era": "medieval",
            "play_language": "zh-Hans",
        },
    })
    assert created["status"] == "PASS"

    pdf = tmp_path / "medieval-chronicle.pdf"
    pdf.write_bytes(b"%PDF host-owned medieval fixture")
    source_bundle = tmp_path / "medieval-source"
    source_bundle.mkdir()
    page = b"# Medieval Chronicle\n\nA player-safe medieval premise.\n"
    (source_bundle / "page-0000.md").write_bytes(page)
    (source_bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:medieval-chronicle",
            "title": "Medieval Chronicle",
            "path": str(pdf),
            "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
            "page_count": 1,
        },
        "pages": [{
            "pdf_index": 0,
            "markdown_path": "page-0000.md",
            "text_sha256": hashlib.sha256(page).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.96,
            "grep_anchors": ["A player-safe medieval premise."],
        }],
    }), encoding="utf-8")

    bound = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "scenario.bind_pdf",
        "payload": {
            "campaign_id": "medieval-briefing",
            "scenario_id": "medieval-chronicle",
            "title": "Medieval Chronicle",
            "source_bundle_path": str(source_bundle),
            "compile_now": False,
        },
    })
    assert bound["status"] == "PASS"
    briefing_path = bound["result"]["character_creation_briefing"][
        "briefing_path"
    ]

    def assert_kp_guided(markdown: str) -> None:
        assert "**年代**：medieval" in markdown
        assert "Medieval Chronicle" in markdown
        assert "当前自动快速建卡可靠支持的年代：1920年代" in markdown
        assert "## 年代适配建卡" in markdown
        assert "不能直接套用其他年代的标准卡包；但建卡不会因此停止" in markdown
        assert "属性、幸运、衍生值和年龄调整仍按规则处理" in markdown
        assert "职业、技能取舍和名称由时代背景决定" in markdown
        assert "预设调查员" in markdown
        assert "暂不生成数值" not in markdown
        for misplaced in (
            "新闻", "考古", "警务", "射击", "旧报", "图书馆使用",
            "快速数组：80、70、60、60、50、50、50、40",
        ):
            assert misplaced not in markdown
        for jargon in ("规则包", "宿主", "导入流程", "creation.input_mode"):
            assert jargon not in markdown

    bound_markdown = (tmp_path / briefing_path).read_text(encoding="utf-8")
    assert_kp_guided(bound_markdown)

    rerendered = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "campaign.render_briefing",
        "payload": {"campaign_id": "medieval-briefing"},
    })
    assert rerendered["status"] == "PASS"
    assert rerendered["result"]["briefing_path"] == briefing_path
    rerendered_markdown = (tmp_path / briefing_path).read_text(encoding="utf-8")
    assert rerendered_markdown == bound_markdown
    assert_kp_guided(rerendered_markdown)


def test_investigator_create_rejects_localized_machine_skills_before_write(tmp_path):
    sheet = {
        "schema_version": 1,
        "id": "localized-inv",
        "name": "Localized Investigator",
        "characteristics": {
            "STR": 80, "CON": 70, "SIZ": 60, "DEX": 60,
            "APP": 50, "INT": 50, "POW": 50, "EDU": 40,
        },
        "derived": {
            "HP": 13, "MP": 10, "SAN": 50, "Luck": 60,
            "DB": "+1D4", "Build": 1, "MOV": 7,
        },
        "skills": {"信用评级": 20, "侦查": 50},
    }

    with pytest.raises(ops.RuntimeOperationError, match="canonical English"):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": {
                "investigator_id": "localized-inv",
                "sheet": sheet,
                "creation": {"input_mode": "import_complete_sheet"},
            },
        })

    assert not (tmp_path / ".coc" / "investigators" / "localized-inv").exists()


def test_investigator_create_materializes_quick_fire_numbers_before_write(tmp_path):
    complete_skills, skill_budget = _complete_quick_fire_skills()
    ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "campaign.create",
        "payload": {
            "campaign_id": "quick-fire",
            "title": "Quick Fire",
            "era": "1920s",
        },
    })
    luck = toolbox.run_tool(
        "rules.roll_dice",
        tmp_path,
        "quick-fire",
        {
            "expression": "3D6",
            "decision_id": "runtime-ops-quick-fire-luck",
            "purpose": "investigator_creation_luck",
            "reason": "为速建调查员生成幸运值",
            "seed": 19,
        },
    )
    assert luck["ok"] is True
    receipt = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "investigator.create",
        "payload": {
            "campaign_id": "quick-fire",
            "investigator_id": "quick-fire-inv",
            "sheet": {
                "id": "quick-fire-inv",
                "name": "Quick Fire Investigator",
                "age": 29,
                "skills": complete_skills,
                "player_facing_sheet_zh": {
                    "display_name": "速建调查员",
                    "skills": [],
                },
            },
            "creation": {
                "input_mode": "guided_quick_fire",
                "method": "quick_fire_array",
                "characteristic_assignment_order": list(_QUICK_FIRE_ORDER),
                "luck_roll_total": luck["data"]["total"],
                "luck_roll_receipt": {
                    "campaign_id": "quick-fire",
                    "decision_id": "runtime-ops-quick-fire-luck",
                    "roll_id": luck["data"]["roll_id"],
                },
                "skill_budget": skill_budget,
            },
        },
    })

    assert receipt["status"] == "PASS"
    stored = json.loads(
        (tmp_path / ".coc" / "investigators" / "quick-fire-inv"
         / "character.json").read_text(encoding="utf-8")
    )
    assert sorted(stored["characteristics"].values()) == [
        40, 50, 50, 50, 60, 60, 70, 80,
    ]
    assert stored["derived"]["Luck"] == luck["data"]["total"] * 5
    assert stored["derived"]["DB"] == "none"
    assert stored["era"] == "1920s"
    assert stored["skills"] == complete_skills
    assert "Fighting (Brawl)" in stored["skills"]
    assert "Firearms (Handgun)" in stored["skills"]
    assert "Pilot" in stored["skills"]
    assert "Science" in stored["skills"]
    assert "Survival" in stored["skills"]
    assert "Fighting (Axe)" not in stored["skills"]
    assert "Art and Craft (Acting)" not in stored["skills"]
    assert len(stored["player_facing_sheet_zh"]["skills"]) == len(complete_skills)
    assert stored["player_facing_sheet_zh"]["skills"][0]["label"] == "会计"


def test_guided_quick_fire_selected_specialization_is_added(tmp_path):
    payload = _guided_quick_fire_payload(
        tmp_path,
        investigator_id="selected-specialization",
        decision_id="selected-specialization-luck",
    )
    payload["sheet"]["era"] = "1920s"
    occupation = payload["creation"]["skill_budget"]["occupation_points"][
        "allocations"
    ]
    occupation["History"] -= 10
    occupation["Fighting (Axe)"] = 10
    payload["sheet"]["skills"]["History"] -= 10
    payload["sheet"]["skills"]["Fighting (Axe)"] = 25
    receipt = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "investigator.create",
        "payload": payload,
    })
    assert receipt["status"] == "PASS"
    stored = json.loads(
        (tmp_path / ".coc" / "investigators" / "selected-specialization"
         / "character.json").read_text(encoding="utf-8")
    )
    assert stored["skills"]["Fighting (Axe)"] == 25
    assert stored["era"] == "1920s"
    assert any(
        row["key"] == "Fighting (Axe)" and row["label"] == "格斗（斧）"
        for row in stored["player_facing_sheet_zh"]["skills"]
    )


def test_guided_quick_fire_accepts_unallocated_edu_80_own_language(tmp_path):
    payload = _guided_quick_fire_payload(
        tmp_path,
        investigator_id="edu-80-own-language",
        decision_id="edu-80-own-language-luck",
    )
    payload["creation"]["characteristic_assignment_order"] = [
        "EDU", "INT", "POW", "DEX", "CON", "SIZ", "APP", "STR",
    ]
    payload["sheet"]["skills"]["Language (Own)"] = 80
    payload["sheet"]["skills"]["Dodge"] = 30

    receipt = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "investigator.create",
        "payload": payload,
    })

    assert receipt["status"] == "PASS"
    stored = json.loads(
        (tmp_path / ".coc" / "investigators" / "edu-80-own-language"
         / "character.json").read_text(encoding="utf-8")
    )
    assert stored["characteristics"]["EDU"] == 80
    assert stored["skills"]["Language (Own)"] == 80
    assert all(
        "Language (Own)" not in account["allocations"]
        for account in payload["creation"]["skill_budget"].values()
    )


def test_guided_quick_fire_rejects_allocation_to_derived_base_above_cap(
    tmp_path,
):
    payload = _guided_quick_fire_payload(
        tmp_path,
        investigator_id="allocated-edu-80-own-language",
        decision_id="allocated-edu-80-own-language-luck",
    )
    payload["creation"]["characteristic_assignment_order"] = [
        "EDU", "INT", "POW", "DEX", "CON", "SIZ", "APP", "STR",
    ]
    occupation = payload["creation"]["skill_budget"]["occupation_points"][
        "allocations"
    ]
    occupation["History"] -= 1
    occupation["Language (Own)"] = 1
    payload["sheet"]["skills"]["History"] -= 1
    payload["sheet"]["skills"]["Language (Own)"] = 81
    payload["sheet"]["skills"]["Dodge"] = 30

    with pytest.raises(
        ops.RuntimeOperationError,
        match=(
            r"Language \(Own\).*authoritative characteristic-derived base "
            r"80.*allocation delta 1 is not permitted"
        ),
    ):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": payload,
        })
    assert not (
        tmp_path / ".coc" / "investigators"
        / "allocated-edu-80-own-language"
    ).exists()


@pytest.mark.parametrize("skill_id", ["Credit Rating", "Cthulhu Mythos"])
def test_guided_quick_fire_rejects_package_starting_skill_cap_before_write(
    tmp_path,
    skill_id,
):
    payload = _guided_quick_fire_payload(
        tmp_path,
        investigator_id=f"over-cap-{skill_id.replace(' ', '-').lower()}",
        decision_id=f"over-cap-{skill_id.replace(' ', '-').lower()}-luck",
    )
    occupation = payload["creation"]["skill_budget"]["occupation_points"][
        "allocations"
    ]
    for allocated_skill_id, delta in list(occupation.items()):
        payload["sheet"]["skills"][allocated_skill_id] -= delta
    occupation.clear()
    occupation[skill_id] = 200
    payload["sheet"]["skills"][skill_id] = 200
    with pytest.raises(
        ops.RuntimeOperationError,
        match="starting-skill cap 75",
    ):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": payload,
        })
    assert not (
        tmp_path / ".coc" / "investigators"
        / f"over-cap-{skill_id.replace(' ', '-').lower()}"
    ).exists()


@pytest.mark.parametrize("era", ["modern", "future-2099"])
def test_guided_quick_fire_rejects_unsupported_era_before_write(
    tmp_path, era,
):
    investigator_id = f"unsupported-{era}"
    payload = _guided_quick_fire_payload(
        tmp_path,
        investigator_id=investigator_id,
        decision_id=f"{investigator_id}-luck",
    )
    payload["sheet"]["era"] = era
    with pytest.raises(
        ops.RuntimeOperationError,
        match=(
            rf"sheet\.era must exactly match campaign era '1920s'; "
            rf"got '{era}'"
        ),
    ):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": payload,
        })
    assert not (
        tmp_path / ".coc" / "investigators" / investigator_id
    ).exists()


def test_kp_guided_era_adaptive_rejects_a_standard_quick_fire_era_before_write(
    tmp_path,
):
    investigator_id = "adaptive-in-1920s"
    payload = _guided_quick_fire_payload(
        tmp_path,
        investigator_id=investigator_id,
        decision_id="adaptive-in-1920s-luck",
    )
    payload["sheet"].update({
        "era": "1920s",
        "era_adaptive": True,
        "kp_guided": True,
    })
    payload["creation"].update({
        "input_mode": "kp_guided_era_adaptive",
        "era": "1920s",
        "era_adaptive": True,
        "kp_guided": True,
    })

    with pytest.raises(
        ops.RuntimeOperationError,
        match=(
            "KP-guided era-adaptive creation is available only when the campaign era "
            "has no package-owned guided Quick Fire standard sheet"
        ),
    ):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": payload,
        })
    assert not (
        tmp_path / ".coc" / "investigators" / investigator_id
    ).exists()



@pytest.mark.parametrize("bad_input_mode", [None, "import_complete_sheet"])
def test_quick_fire_shape_requires_guided_mode_before_write(
    tmp_path, bad_input_mode,
):
    investigator_id = "quick-fire-wrong-discriminator"
    payload = _guided_quick_fire_payload(
        tmp_path,
        investigator_id=investigator_id,
        decision_id="quick-fire-wrong-discriminator-luck",
    )
    if bad_input_mode is None:
        payload["creation"].pop("input_mode")
    else:
        payload["creation"]["input_mode"] = bad_input_mode

    with pytest.raises(
        ops.RuntimeOperationError,
        match="deterministic Quick Fire investigator.create requires creation.input_mode=guided_quick_fire",
    ):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": payload,
        })
    assert not (
        tmp_path / ".coc" / "investigators" / investigator_id
    ).exists()


def test_guided_quick_fire_rejects_sparse_machine_and_localized_skills_before_write(
    tmp_path,
):
    payload = _guided_quick_fire_payload(
        tmp_path,
        investigator_id="sparse-guided",
        decision_id="sparse-guided-luck",
    )
    payload["sheet"]["skills"] = {
        "Credit Rating": 20,
        "Spot Hidden": 65,
    }
    payload["sheet"]["player_facing_sheet_zh"]["skills"] = [
        {"key": "Credit Rating", "label": "信用评级", "value": 20},
        {"key": "Spot Hidden", "label": "侦查", "value": 65},
    ]
    with pytest.raises(
        ops.RuntimeOperationError,
        match="complete era-appropriate standard catalog",
    ):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": payload,
        })
    assert not (
        tmp_path / ".coc" / "investigators" / "sparse-guided"
    ).exists()


def test_guided_quick_fire_rejects_fake_aggregate_budget_before_write(tmp_path):
    payload = _guided_quick_fire_payload(
        tmp_path,
        investigator_id="fake-budget",
        decision_id="fake-budget-luck",
    )
    for account in payload["creation"]["skill_budget"].values():
        account.pop("allocations")
    with pytest.raises(
        ops.RuntimeOperationError,
        match="budget, spent, and allocations",
    ):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": payload,
        })
    assert not (
        tmp_path / ".coc" / "investigators" / "fake-budget"
    ).exists()


def test_guided_quick_fire_rejects_final_value_mismatch_before_write(tmp_path):
    payload = _guided_quick_fire_payload(
        tmp_path,
        investigator_id="mismatched-value",
        decision_id="mismatched-value-luck",
    )
    payload["sheet"]["skills"]["Spot Hidden"] += 1
    with pytest.raises(
        ops.RuntimeOperationError,
        match="catalog base plus allocation deltas",
    ):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": payload,
        })
    assert not (
        tmp_path / ".coc" / "investigators" / "mismatched-value"
    ).exists()


@pytest.mark.parametrize("creation", [{}, {"method": "quick_fire_array"}])
def test_investigator_create_rejects_undiscriminated_creation_before_write(
    tmp_path, creation,
):
    sheet = {
        "id": "undiscriminated",
        "name": "Undiscriminated",
        "characteristics": {
            "STR": 50, "CON": 50, "SIZ": 50, "DEX": 50,
            "APP": 50, "INT": 50, "POW": 50, "EDU": 50,
        },
        "derived": {
            "HP": 10, "MP": 10, "SAN": 50, "Luck": 50,
            "DB": "none", "Build": 0, "MOV": 8,
        },
        "skills": {"Credit Rating": 20},
    }
    with pytest.raises(
        ops.RuntimeOperationError,
        match="input_mode|deterministic Quick Fire",
    ):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "investigator.create",
            "payload": {
                "investigator_id": "undiscriminated",
                "sheet": sheet,
                "creation": creation,
            },
        })
    assert not (
        tmp_path / ".coc" / "investigators" / "undiscriminated"
    ).exists()


def test_suffocation_lifecycle_is_persisted_and_roll_traced(tmp_path):
    character = _workspace(tmp_path)
    operations = [
        {
            "schema_version": 1,
            "kind": "hazard.suffocation.start",
            "payload": {"kind": "drowning", "severity": "minor", "exertion": True},
        },
        {
            "schema_version": 1,
            "kind": "hazard.suffocation.tick",
            "payload": {},
        },
        {
            "schema_version": 1,
            "kind": "hazard.suffocation.end",
            "payload": {"reason": "rescued"},
        },
    ]
    receipts = [
        ops.execute_operation(
            tmp_path,
            campaign_id="camp",
            investigator_id="inv",
            character_path=character,
            operation=operation,
            rng_seed=seed,
        )
        for seed, operation in enumerate(operations, start=1)
    ]
    assert [item["status"] for item in receipts] == ["PASS", "PASS", "PASS"]
    state_row = json.loads(
        (tmp_path / ".coc" / "campaigns" / "camp" / "save" / "investigator-state" / "inv.json")
        .read_text(encoding="utf-8")
    )
    assert "suffocating" not in state_row["conditions"]
    rolls = (
        tmp_path / ".coc" / "campaigns" / "camp" / "logs" / "rolls.jsonl"
    ).read_text(encoding="utf-8")
    assert '"skill":"CON"' in rolls


def _created_campaign(tmp_path: Path, campaign_id: str, **extra) -> dict:
    ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "campaign.create",
        "payload": {"campaign_id": campaign_id, "title": campaign_id, **extra},
    })
    return json.loads(
        (tmp_path / ".coc" / "campaigns" / campaign_id / "campaign.json")
        .read_text(encoding="utf-8")
    )


def _answer(value, *, pdf_index: int = 1) -> dict:
    return {
        "status": "source",
        "value": value,
        "source_refs": [{"source_id": "pdf:raw", "pdf_index": pdf_index}],
    }


def _unresolved(*, pdf_index: int = 1) -> dict:
    return {
        "status": "unresolved",
        "inspected_source_refs": [
            {"source_id": "pdf:raw", "pdf_index": pdf_index}
        ],
    }


_UNRESOLVED = _unresolved()


def _bind_fast_facts_source(
    tmp_path: Path,
    campaign_id: str,
    *,
    source_id: str = "pdf:raw",
    scenario_id: str | None = None,
    page_text: str = "# Source\n\nAccepted setup evidence.\n",
) -> dict:
    scenario_id = scenario_id or f"{campaign_id}-source"
    pdf = tmp_path / f"{scenario_id}.pdf"
    pdf.write_bytes(
        f"%PDF host-owned fast facts fixture {scenario_id}".encode()
    )
    bundle = tmp_path / f"{scenario_id}-bundle"
    bundle.mkdir()
    pages = []
    for pdf_index in (0, 1):
        data = f"{page_text}\nPage {pdf_index}.\n".encode()
        markdown_path = f"page-{pdf_index:04d}.md"
        (bundle / markdown_path).write_bytes(data)
        pages.append({
            "pdf_index": pdf_index,
            "markdown_path": markdown_path,
            "text_sha256": hashlib.sha256(data).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.93,
            "grep_anchors": ["Accepted setup evidence."],
        })
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": source_id,
            "title": scenario_id,
            "path": str(pdf),
            "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
            "page_count": 2,
        },
        "pages": pages,
    }), encoding="utf-8")
    return ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "scenario.bind_pdf",
        "payload": {
            "campaign_id": campaign_id,
            "scenario_id": scenario_id,
            "title": scenario_id,
            "source_bundle_path": str(bundle),
            "compile_now": False,
        },
    })


def _fast_facts(**overrides) -> dict:
    facts = {
        "schema_version": 1,
        "contract_id": "coc.opening-fast-facts.v1",
        "era": _answer("1890s"),
        "place": _answer("英格兰惠特比"),
        "investigator_hook": _answer("一封旧友来信请你去港口小镇查一桩失踪案。"),
        "investigator_constraints": _UNRESOLVED,
        "player_safe_summary": _answer("一场从港口失踪案开始的调查。"),
        "content_flags": _answer(["失踪", "海难"]),
    }
    facts.update(overrides)
    return facts


def _fast_facts_for_source(source_id: str, **overrides) -> dict:
    facts = _fast_facts(**overrides)
    for name in (
        "era",
        "place",
        "investigator_hook",
        "investigator_constraints",
        "player_safe_summary",
        "content_flags",
    ):
        answer = facts[name]
        refs_key = (
            "source_refs"
            if answer["status"] == "source"
            else "inspected_source_refs"
        )
        for ref in answer[refs_key]:
            ref["source_id"] = source_id
    return facts


def _adopt(tmp_path: Path, campaign_id: str, facts: dict) -> dict:
    return ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "campaign.adopt_source_facts",
        "payload": {"campaign_id": campaign_id, "facts": facts},
    })


def test_campaign_create_records_omitted_era_as_unestablished(tmp_path):
    campaign = _created_campaign(tmp_path, "raw-pdf")
    assert campaign["era_source"] == "unestablished"
    assert state.campaign_era_is_established(campaign) is False


def test_campaign_create_records_declared_era_as_established(tmp_path):
    campaign = _created_campaign(tmp_path, "declared", era="1890s")
    assert campaign["era"] == "1890s"
    assert campaign["era_source"] == "declared"
    assert state.campaign_era_is_established(campaign) is True
    # A declared campaign never had a source parse to ask about place.
    assert state.campaign_place_is_established(campaign) is True


def test_adopt_source_facts_fails_before_scenario_bind(tmp_path):
    _created_campaign(tmp_path, "raw-pdf")
    with pytest.raises(
        ops.RuntimeOperationError, match="campaign has no source-bound"
    ):
        _adopt(tmp_path, "raw-pdf", _fast_facts())


def test_fast_facts_unblock_character_creation_and_reach_the_briefing(tmp_path):
    _created_campaign(tmp_path, "raw-pdf")
    with pytest.raises(ops.RuntimeOperationError, match="era is not source-established"):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "investigator.contract",
            "payload": {"campaign_id": "raw-pdf"},
        })
    _bind_fast_facts_source(tmp_path, "raw-pdf")
    adopted = _adopt(tmp_path, "raw-pdf", _fast_facts())
    assert adopted["status"] == "PASS"
    assert adopted["result"]["era"] == "1890s"
    assert adopted["result"]["era_source"] == "authored"
    assert adopted["result"]["unresolved_blocking_facts"] == []
    assert adopted["result"]["character_creation_unblocked"] is True

    campaign = json.loads(
        (tmp_path / ".coc" / "campaigns" / "raw-pdf" / "campaign.json")
        .read_text(encoding="utf-8")
    )
    assert campaign["era"] == "1890s"
    assert campaign["era_source"] == "authored"
    assert campaign["source_fast_facts"]["place"]["value"] == "英格兰惠特比"
    canonical_ref = campaign["source_fast_facts"]["place"]["source_refs"][0]
    assert canonical_ref["source_id"] == "pdf:raw"
    assert len(canonical_ref["file_sha256"]) == 64
    assert len(canonical_ref["bundle_sha256"]) == 64
    assert len(canonical_ref["text_sha256"]) == 64
    assert canonical_ref["review_state"] == "manual_accepted"

    contract = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "investigator.contract",
        "payload": {"campaign_id": "raw-pdf"},
    })
    assert contract["status"] == "PASS"
    assert contract["result"]["campaign_binding"]["era"] == "1890s"

    briefing_path = adopted["result"]["character_creation_briefing_path"]
    assert briefing_path
    briefing = (tmp_path / briefing_path).read_text(encoding="utf-8")
    assert "英格兰惠特比" in briefing
    assert "一封旧友来信请你去港口小镇查一桩失踪案。" in briefing
    assert "海难" in briefing


@pytest.mark.parametrize("gate", ["era", "place"])
def test_unresolved_gating_fact_keeps_character_creation_blocked(tmp_path, gate):
    _created_campaign(tmp_path, "raw-pdf")
    _bind_fast_facts_source(tmp_path, "raw-pdf")
    adopted = _adopt(tmp_path, "raw-pdf", _fast_facts(**{gate: _UNRESOLVED}))
    # An honest "unresolved" is accepted and recorded, never rejected: it must
    # never be harder to submit than a fabricated answer.
    assert adopted["status"] == "PASS"
    assert adopted["result"]["unresolved_blocking_facts"] == [gate]
    assert adopted["result"]["character_creation_unblocked"] is False
    with pytest.raises(ops.RuntimeOperationError, match="not source-established"):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "investigator.contract",
            "payload": {"campaign_id": "raw-pdf"},
        })


def test_unresolved_non_gating_facts_do_not_block_creation(tmp_path):
    _created_campaign(tmp_path, "raw-pdf")
    _bind_fast_facts_source(tmp_path, "raw-pdf")
    adopted = _adopt(tmp_path, "raw-pdf", _fast_facts(
        investigator_hook=_UNRESOLVED,
        player_safe_summary=_UNRESOLVED,
        content_flags=_UNRESOLVED,
    ))
    assert adopted["result"]["character_creation_unblocked"] is True
    assert ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "investigator.contract",
        "payload": {"campaign_id": "raw-pdf"},
    })["status"] == "PASS"


def test_link_investigator_blocks_until_fast_facts_answer_the_gates(tmp_path):
    _created_campaign(tmp_path, "raw-pdf")
    with pytest.raises(ops.RuntimeOperationError, match="not source-established"):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "campaign.link_investigator",
            "payload": {
                "campaign_id": "raw-pdf",
                "investigator_ids": ["someone"],
            },
        })


@pytest.mark.parametrize("facts,match", [
    (_fast_facts(era={"status": "source", "value": "  ",
                      "source_refs": [{"source_id": "pdf:raw", "pdf_index": 0}]}),
     "'era' value must be a non-empty string"),
    (_fast_facts(place={"status": "source", "value": "X", "source_refs": []}),
     "'place' requires non-empty source evidence"),
    (_fast_facts(era={"status": "source", "value": "1920s",
                      "source_refs": [{"source_id": "pdf:raw", "pdf_index": -1}]}),
     "zero-based pdf_index"),
    (_fast_facts(place={"status": "unresolved"}),
     "'place' is unresolved and requires"),
    (_fast_facts(place={"status": "unresolved", "inspected_source_refs": []}),
     "'place' requires non-empty source evidence"),
    (_fast_facts(era={"status": "guessed", "value": "1920s"}),
     "'era' status must be source or unresolved"),
    ({"schema_version": 1, "contract_id": "coc.opening-fast-facts.v1"},
     "must answer every"),
])
def test_adopt_source_facts_rejects_malformed_answer_sets(tmp_path, facts, match):
    _created_campaign(tmp_path, "raw-pdf")
    _bind_fast_facts_source(tmp_path, "raw-pdf")
    with pytest.raises(ops.RuntimeOperationError, match=match):
        _adopt(tmp_path, "raw-pdf", facts)


def test_adopt_source_facts_is_idempotent_and_refuses_conflicting_era(tmp_path):
    _created_campaign(tmp_path, "raw-pdf")
    _bind_fast_facts_source(tmp_path, "raw-pdf")
    assert _adopt(tmp_path, "raw-pdf", _fast_facts())["status"] == "PASS"
    repeated = _adopt(tmp_path, "raw-pdf", _fast_facts())
    assert repeated["result"]["already_established"] is True
    assert repeated["result"]["era"] == "1890s"
    with pytest.raises(ops.RuntimeOperationError, match="already established"):
        _adopt(tmp_path, "raw-pdf", _fast_facts(era=_answer("1920s")))


def test_adopt_source_facts_projects_source_content_out_of_campaign_and_result(
    tmp_path,
):
    campaign_id = "projected-provenance"
    source_body = "SOURCE-BODY-MUST-NOT-PERSIST-7f02d9"
    _created_campaign(tmp_path, campaign_id)
    _bind_fast_facts_source(
        tmp_path,
        campaign_id,
        page_text=(
            "# Source\n\nAccepted setup evidence.\n"
            f"{source_body}\n"
        ),
    )

    adopted = _adopt(tmp_path, campaign_id, _fast_facts())
    returned_facts = adopted["result"]["facts"]
    campaign = json.loads(
        (tmp_path / ".coc" / "campaigns" / campaign_id / "campaign.json")
        .read_text(encoding="utf-8")
    )
    stored_facts = campaign["source_fast_facts"]

    for facts in (returned_facts, stored_facts):
        serialized = json.dumps(facts, ensure_ascii=False)
        assert "grep_anchors" not in serialized
        assert "grep_anchor" not in serialized
        assert "raw_excerpt" not in serialized
        assert source_body not in serialized
        ref = facts["place"]["source_refs"][0]
        assert ref["source_id"] == "pdf:raw"
        assert len(ref["file_sha256"]) == 64
        assert len(ref["bundle_sha256"]) == 64
        assert len(ref["text_sha256"]) == 64
        assert ref["review_state"] == "manual_accepted"
        assert ref["parse_confidence"] == 0.93

    # Projected persisted facts still validate against the live canonical
    # bundle and therefore remain usable at the normal character gate.
    ops._require_established_source_facts(tmp_path, campaign, campaign_id)
    contract = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "investigator.contract",
        "payload": {"campaign_id": campaign_id},
    })
    assert contract["status"] == "PASS"


@pytest.mark.parametrize("operation", ["contract", "create", "link"])
def test_later_unresolved_era_revokes_authored_era_at_every_campaign_gate(
    tmp_path, operation
):
    _created_campaign(tmp_path, "raw-pdf")
    _bind_fast_facts_source(tmp_path, "raw-pdf")
    _adopt(tmp_path, "raw-pdf", _fast_facts())
    downgraded = _adopt(
        tmp_path,
        "raw-pdf",
        _fast_facts(era=_unresolved()),
    )
    assert downgraded["result"]["character_creation_unblocked"] is False
    assert downgraded["result"]["unresolved_blocking_facts"] == ["era"]
    assert downgraded["result"]["era"] == ""
    assert downgraded["result"]["era_source"] == "unestablished"
    campaign = json.loads(
        (tmp_path / ".coc" / "campaigns" / "raw-pdf" / "campaign.json")
        .read_text(encoding="utf-8")
    )
    assert campaign["era_source"] == "unestablished"
    assert campaign["source_fast_facts"]["era"]["status"] == "unresolved"

    payloads = {
        "contract": {
            "kind": "investigator.contract",
            "payload": {"campaign_id": "raw-pdf"},
        },
        "create": {
            "kind": "investigator.create",
            "payload": {
                "campaign_id": "raw-pdf",
                "investigator_id": "blocked-create",
                "sheet": {},
                "creation": {
                    "input_mode": "guided_quick_fire",
                    "characteristic_assignment_order": [],
                },
            },
        },
        "link": {
            "kind": "campaign.link_investigator",
            "payload": {
                "campaign_id": "raw-pdf",
                "investigator_ids": ["someone"],
            },
        },
    }
    with pytest.raises(ops.RuntimeOperationError, match="era is not source-established"):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            **payloads[operation],
        })


@pytest.mark.parametrize(
    "bad_ref,match",
    [
        ({"source_id": "pdf:foreign", "pdf_index": 1}, "different source_id"),
        ({"source_id": "pdf:raw", "pdf_index": 9}, "uncached pdf_index 9"),
    ],
)
def test_adopt_source_facts_rejects_foreign_or_uncached_refs(
    tmp_path, bad_ref, match
):
    _created_campaign(tmp_path, "raw-pdf")
    _bind_fast_facts_source(tmp_path, "raw-pdf")
    facts = _fast_facts()
    facts["place"]["source_refs"] = [bad_ref]
    with pytest.raises(ops.RuntimeOperationError, match=match):
        _adopt(tmp_path, "raw-pdf", facts)


def test_source_rebind_invalidates_old_facts_and_allows_fresh_different_era(
    tmp_path,
):
    _created_campaign(tmp_path, "raw-pdf")
    _bind_fast_facts_source(tmp_path, "raw-pdf")
    _adopt(tmp_path, "raw-pdf", _fast_facts())
    rebound = _bind_fast_facts_source(
        tmp_path,
        "raw-pdf",
        source_id="pdf:replacement",
        scenario_id="replacement-source",
        page_text="# Replacement\n\nAccepted setup evidence.\n",
    )
    campaign_path = (
        tmp_path / ".coc" / "campaigns" / "raw-pdf" / "campaign.json"
    )
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    assert "source_fast_facts" not in campaign
    assert campaign["era_source"] == "unestablished"
    briefing = (
        tmp_path
        / rebound["result"]["character_creation_briefing"]["briefing_path"]
    ).read_text(encoding="utf-8")
    assert "英格兰惠特比" not in briefing
    assert "一封旧友来信请你去港口小镇查一桩失踪案。" not in briefing
    with pytest.raises(ops.RuntimeOperationError, match="era is not source-established"):
        ops.execute_setup_operation(tmp_path, operation={
            "schema_version": 1,
            "kind": "investigator.contract",
            "payload": {"campaign_id": "raw-pdf"},
        })

    readopted = _adopt(
        tmp_path,
        "raw-pdf",
        _fast_facts_for_source(
            "pdf:replacement",
            era={
                "status": "source",
                "value": "1920s",
                "source_refs": [
                    {"source_id": "pdf:replacement", "pdf_index": 1}
                ],
            },
            place={
                "status": "source",
                "value": "美国波士顿",
                "source_refs": [
                    {"source_id": "pdf:replacement", "pdf_index": 1}
                ],
            },
        ),
    )
    assert readopted["result"]["era"] == "1920s"
    assert readopted["result"]["character_creation_unblocked"] is True
    assert ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "investigator.contract",
        "payload": {"campaign_id": "raw-pdf"},
    })["status"] == "PASS"


def test_pdf_bind_preserves_explicitly_declared_era_provenance(tmp_path):
    _created_campaign(tmp_path, "declared-pdf", era="1920s")
    _bind_fast_facts_source(tmp_path, "declared-pdf")
    campaign = json.loads(
        (tmp_path / ".coc" / "campaigns" / "declared-pdf" / "campaign.json")
        .read_text(encoding="utf-8")
    )
    assert campaign["era"] == "1920s"
    assert campaign["era_source"] == "declared"
