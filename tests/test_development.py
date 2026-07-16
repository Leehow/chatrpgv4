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
        json.dumps({"current_luck": luck, "current_san": 50, "current_hp": 11}),
        encoding="utf-8",
    )
    (camp / "save" / "pacing-state.json").write_text(
        json.dumps({"luck_spent_last": 0, "tension_level": "low", "turn_number": 0}),
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
    assert ledger["schema_version"] == 2
    assert ledger["events"][first["event_token"]]["source_event_id"] == (
        "rules.roll:durable-replay"
    )


def test_capsule_rejects_conflicting_identity_for_existing_event_token(tmp_path):
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

    with pytest.raises(ValueError, match="conflicting campaign identity"):
        coc_development.build_ending_settlement_capsule(
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
    archive = json.loads((
        camp.parents[1] / "investigators" / inv_id / "development-claims.json"
    ).read_text(encoding="utf-8"))
    assert archive["claims"] == {}
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
            "investigator_id": inv_id,
            "current_luck": 40,
            "current_san": 50,
            "max_san": 99,
            "skill_checks_earned": [],
        }),
        encoding="utf-8",
    )
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
# run_development_phase
# ---------------------------------------------------------------------------

def _seed_tick(camp: Path, inv_id: str, skill: str, roll: int = 20) -> None:
    inv_dir = camp.parents[1] / "investigators" / inv_id
    with (inv_dir / "development.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"skill": skill, "ts": "2026-01-01T00:00:00Z", "roll": roll}) + "\n")


def test_development_phase_always_improves_when_roll_over_95(tmp_path):
    """p.94: 1D100 > skill OR >95 always improves."""
    camp, inv_id = _campaign_with_investigator(
        tmp_path, skills={"Spot Hidden": 99}
    )
    _seed_tick(camp, inv_id, "Spot Hidden")
    # seed 23 → check 100 (>95), gain 5
    seed = 23
    probe = random.Random(seed)
    check = probe.randint(1, 100)
    gain = probe.randint(1, 10)
    assert check > 95

    out = coc_development.run_development_phase(
        camp, inv_id, rng=random.Random(seed)
    )
    assert "Spot Hidden" in out["skills_checked"]
    assert any(s["skill"] == "Spot Hidden" for s in out["skills_improved"])
    sheet = json.loads(
        (camp.parents[1] / "investigators" / inv_id / "character.json").read_text()
    )
    assert sheet["skills"]["Spot Hidden"] == 99 + gain


def test_development_phase_improves_when_roll_exceeds_skill(tmp_path):
    camp, inv_id = _campaign_with_investigator(
        tmp_path, skills={"Library Use": 30}
    )
    _seed_tick(camp, inv_id, "Library Use")
    # Find a seed where first 1D100 > 30 and <=95, then capture gain.
    for seed in range(500):
        probe = random.Random(seed)
        check = probe.randint(1, 100)
        if check > 30 and check <= 95:
            gain = probe.randint(1, 10)
            break
    else:
        pytest.fail("no suitable RNG seed")

    out = coc_development.run_development_phase(
        camp, inv_id, rng=random.Random(seed)
    )
    improved = {row["skill"]: row for row in out["skills_improved"]}
    assert "Library Use" in improved
    assert improved["Library Use"]["gain"] == gain
    sheet = json.loads(
        (camp.parents[1] / "investigators" / inv_id / "character.json").read_text()
    )
    assert sheet["skills"]["Library Use"] == 30 + gain


def test_development_phase_san_reward_when_skill_reaches_90(tmp_path):
    camp, inv_id = _campaign_with_investigator(
        tmp_path, skills={"Persuade": 88}
    )
    _seed_tick(camp, inv_id, "Persuade")
    for seed in range(500):
        probe = random.Random(seed)
        check = probe.randint(1, 100)
        if check > 88:
            gain = probe.randint(1, 10)
            if 88 + gain >= 90:
                break
    else:
        pytest.fail("no suitable RNG seed")

    out = coc_development.run_development_phase(
        camp, inv_id, rng=random.Random(seed)
    )
    assert out["san_reward_expr"] == "2D6"
    sheet = json.loads(
        (camp.parents[1] / "investigators" / inv_id / "character.json").read_text()
    )
    assert sheet["skills"]["Persuade"] >= 90


def test_development_phase_awfulness_caps_decay(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path, skills={"Spot Hidden": 40})
    sess = coc_sanity.SanitySession(
        inv_id, san_max=99, int_value=70, rng=random.Random(1), campaign_dir=camp
    )
    sess.awfulness_caps = {"ghoul": 3, "byakhee": 1, "deep_one": 0}
    sess.save(camp)

    _seed_tick(camp, inv_id, "Spot Hidden")
    # Use a seed that fails the improvement so we still exercise decay.
    for seed in range(200):
        probe = random.Random(seed)
        if probe.randint(1, 100) <= 40:
            break
    out = coc_development.run_development_phase(
        camp, inv_id, rng=random.Random(seed)
    )
    assert out["awfulness_decay"] == {"ghoul": 2, "byakhee": 0, "deep_one": 0}
    loaded = coc_sanity.SanitySession.load(camp, inv_id, int_value=70)
    assert loaded.awfulness_caps == {"ghoul": 2, "byakhee": 0, "deep_one": 0}


def test_frozen_floor_zero_awfulness_decay_does_not_affect_later_cap(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path)
    sess = coc_sanity.SanitySession(
        inv_id, san_max=99, int_value=60, rng=random.Random(41),
        campaign_dir=camp,
    )
    sess.san_current = 60
    sess.awfulness_caps = {"ghoul": 0}
    sess.save(camp)
    baseline = {
        "skills": {},
        "luck": 40,
        "sanity": {
            "source": "canonical",
            "current": 60,
            "max": 99,
            "awfulness_caps": {"ghoul": 0},
        },
    }
    plan = coc_development._deterministic_development_plan(
        skills={},
        luck=40,
        sanity=baseline["sanity"],
        seed_material="awfulness-floor-zero",
        scenario_reward_expr=None,
    )
    assert plan["awfulness_decay"] == {"ghoul": 0}
    sess = coc_sanity.SanitySession.load(camp, inv_id)
    sess.awfulness_caps["ghoul"] = 10
    sess.save(camp)

    result = coc_development.run_development_phase(
        camp,
        inv_id,
        ending_evidence={"ending_id": "ending-awfulness-floor"},
        development_input={
            "schema_version": 2,
            "skills_checked": [],
            "input_tokens": [],
            "mechanical_baseline": baseline,
            "deterministic_plan": plan,
        },
    )

    assert result["awfulness_decay"]["ghoul"] == 10
    assert result["awfulness_merge"]["ghoul"] == {
        "current_before_apply": 10,
        "planned_delta": 0,
        "applied_delta": 0,
        "value_after": 10,
    }
    assert coc_sanity.SanitySession.load(camp, inv_id).awfulness_caps["ghoul"] == 10


def test_development_phase_clears_ticks(tmp_path):
    camp, inv_id = _campaign_with_investigator(tmp_path, skills={"Spot Hidden": 40})
    _seed_tick(camp, inv_id, "Spot Hidden")
    _seed_tick(camp, inv_id, "Spot Hidden", roll=11)  # duplicate skill
    path = camp.parents[1] / "investigators" / inv_id / "development.jsonl"
    assert path.read_text(encoding="utf-8").strip()

    coc_development.run_development_phase(camp, inv_id, rng=random.Random(7))
    assert path.read_text(encoding="utf-8") == ""
    assert _read_ticks(camp, inv_id) == []


def test_development_phase_returns_luck_recovery(tmp_path):
    camp, inv_id = _campaign_with_investigator(
        tmp_path, skills={"Spot Hidden": 99}, luck=20
    )
    _seed_tick(camp, inv_id, "Spot Hidden")
    out = coc_development.run_development_phase(camp, inv_id, rng=random.Random(3))
    assert "luck_recovery" in out
    assert "luck_after" in out["luck_recovery"]
    inv = json.loads(
        (camp / "save" / "investigator-state" / f"{inv_id}.json").read_text()
    )
    assert inv["current_luck"] == out["luck_recovery"]["luck_after"]
