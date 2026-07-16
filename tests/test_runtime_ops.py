from __future__ import annotations

import importlib.util
import json
import random
from pathlib import Path

import pytest
from pypdf import PdfWriter


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
        development = root / ".coc" / "investigators" / "inv" / "development.jsonl"
        development.write_text("", encoding="utf-8")
        inv_state = campaign / "save" / "investigator-state" / "inv.json"
        inv_state.parent.mkdir(parents=True, exist_ok=True)
        inv_state.write_text(
            json.dumps({
                "current_luck": 50,
                "current_san": 60,
                "current_hp": 12,
                "skill_checks_earned": ["Spot Hidden"],
            }),
            encoding="utf-8",
        )
        events = campaign / "logs" / "events.jsonl"
        events.parent.mkdir(parents=True, exist_ok=True)
        events.write_text(
            json.dumps({
                "event_type": "session_ending",
                "scene_id": "finale",
                "kind": "conclusion",
                "ts": "2026-07-15T00:00:00Z",
            }) + "\n",
            encoding="utf-8",
        )
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
    assert through_pi == direct
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
        inv_state = campaign / "save" / "investigator-state" / "inv.json"
        inv_state.parent.mkdir(parents=True, exist_ok=True)
        inv_state.write_text(json.dumps({
            "investigator_id": "inv",
            "current_luck": 50,
            "current_san": 60,
            "current_hp": 12,
            "skill_checks_earned": ["Spot Hidden"],
        }), encoding="utf-8")
        events = campaign / "logs" / "events.jsonl"
        events.parent.mkdir(parents=True, exist_ok=True)
        events.write_text(json.dumps({
            "event_type": "session_ending",
            "scene_id": "finale",
            "kind": "cliffhanger",
            "decision_id": "ending-crash-test",
            "ts": "2026-07-15T00:00:00Z",
        }) + "\n", encoding="utf-8")

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
    inflight = campaign / "save" / "development-settlements" / "inv.inflight.json"
    settlement = campaign / "save" / "development-settlements" / "inv.json"
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
    assert recovered == control
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
        inv_state = campaign / "save" / "investigator-state" / "inv.json"
        inv_state.write_text(json.dumps({
            "investigator_id": "inv",
            "current_luck": 50,
            "current_san": 60,
            "current_hp": 12,
            "skill_checks_earned": ["Spot Hidden"],
        }), encoding="utf-8")
        _seed_structured_combat_conclusion(campaign)
        with (campaign / "logs" / "events.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({
                "event_type": "session_ending",
                "scene_id": "corbitt-confrontation",
                "kind": "conclusion",
                "decision_id": "late-crash-ending",
            }) + "\n")
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
        original = ops.coc_fileio.write_json_atomic
        settlement_path = (
            crash_campaign / "save" / "development-settlements" / "inv.json"
        )

        def crash_before_receipt(path, *args, **kwargs):
            if Path(path) == settlement_path:
                raise SystemExit("crash immediately before settlement receipt")
            return original(path, *args, **kwargs)

        monkeypatch.setattr(
            ops.coc_fileio, "write_json_atomic", crash_before_receipt
        )
        restore = lambda: monkeypatch.setattr(
            ops.coc_fileio, "write_json_atomic", original
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
    assert recovered == control
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
    assert not (
        crash_campaign / "save" / "development-settlements" / "inv.inflight.json"
    ).exists()


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
    with (campaign / "logs" / "events.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({
            "event_type": "session_ending",
            "scene_id": "corbitt-confrontation",
            "kind": "conclusion",
            "ts": "2026-07-15T00:00:00Z",
        }) + "\n")

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
        json.dumps({
            "event_type": "session_ending",
            "scene_id": "corbitt-confrontation",
            "kind": "conclusion",
        }),
    ]) + "\n", encoding="utf-8")

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
    with (campaign / "logs" / "events.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({
            "event_type": "session_ending",
            "scene_id": "corbitt-confrontation",
            "kind": "conclusion",
            "ts": "2026-07-15T00:00:00Z",
        }) + "\n")
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
    assert reward["rolls"] == [3]
    assert reward["san_before"] == 55
    assert reward["san_gained"] == 3
    assert reward["san_after"] == 58
    assert reward["san_max"] == 99
    sanity = json.loads((campaign / "save" / "sanity.json").read_text(encoding="utf-8"))
    investigator = json.loads(inv_path.read_text(encoding="utf-8"))
    assert sanity["san_current"] == 58
    assert investigator["current_san"] == 58
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
    assert reward["rolls"] == [3]
    assert reward["san_before"] == 55
    assert reward["san_gained"] == 1
    assert reward["san_after"] == reward["san_max"] == 56
    assert json.loads(inv_path.read_text(encoding="utf-8"))["current_san"] == 56


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
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    with pdf.open("wb") as handle:
        writer.write(handle)
    bound = ops.execute_setup_operation(tmp_path, operation={
        "schema_version": 1,
        "kind": "scenario.bind_pdf",
        "payload": {
            "campaign_id": "custom",
            "scenario_id": "custom-module",
            "title": "Custom Module",
            "pdf_path": str(pdf),
            "pdf_index_start": 0,
            "pdf_index_end": 0,
            "compile_now": False,
        },
    })
    assert bound["status"] == "PASS"
    scenario = json.loads(
        (tmp_path / ".coc" / "campaigns" / "custom" / "scenario" / "scenario.json")
        .read_text(encoding="utf-8")
    )
    assert scenario["resolution_policy"] == "source_first"
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
