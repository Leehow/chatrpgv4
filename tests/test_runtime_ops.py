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
        "derived": {"HP": 10, "SAN": 50, "MP": 10},
        "skills": {},
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
        "payload": {"investigator_id": "custom-inv", "sheet": sheet},
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
    assert scenario["source_cache_asset_root_id"] == "custom-module"
    assert "progressive_asset_root_id" not in scenario
    assert bound["result"]["source_cache"]["asset_root_id"] == "custom-module"
    assert bound["result"]["source_cache"]["new_page_count"] == 1
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

    rerendered = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "campaign.render_briefing",
        "payload": {"campaign_id": "custom"},
    })
    assert rerendered["status"] == "PASS"
    assert rerendered["result"]["briefing_path"] == briefing_path


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
