from __future__ import annotations

import importlib.util
import json
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_setup_play_handoff", SCRIPTS / "coc_toolbox.py")
coc_state = _load("coc_state_setup_play_handoff", SCRIPTS / "coc_state.py")
coc_turn_finalization = coc_toolbox.coc_turn_finalization


def _read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _create_chargen_and_complete(
    root: Path, campaign_id: str, *, age: int = 27,
) -> tuple[Path, dict]:
    coc_state.create_campaign(root, campaign_id, "Setup handoff", era="1920s")
    chargen = coc_toolbox.run_tool(
        "setup.chargen_run",
        root,
        None,
        {
            "campaign_id": campaign_id,
            "investigator_id": f"inv-{campaign_id}",
            "name": "Ada Lark",
            "age": age,
            "occupation_name": "Journalist",
            "occupation_label": "记者",
            "assignment_priority": [
                "INT", "EDU", "POW", "DEX", "CON", "APP", "SIZ", "STR",
            ],
            "occupation_skill_names": ["Spot Hidden", "Listen"],
            "interest_skill_names": ["Occult", "First Aid", "Stealth", "Listen"],
            "luck": {"mode": "auto_roll"},
        },
    )
    assert chargen["ok"] is True, chargen
    assert chargen["data"]["result"]["roll_ids"]
    completed = coc_toolbox.run_tool(
        "setup.complete",
        root,
        campaign_id,
        {
            "campaign_id": campaign_id,
            "decision_id": f"complete-{campaign_id}",
        },
    )
    assert completed["ok"] is True, completed
    return root / ".coc" / "campaigns" / campaign_id, chargen


def _resume(root: Path, campaign_id: str) -> dict:
    resumed = coc_toolbox.run_tool("session.resume", root, campaign_id, {})
    assert resumed["ok"] is True, resumed
    return resumed


def _open(root: Path, campaign_id: str) -> dict:
    opening = coc_toolbox.run_tool(
        "evidence.table_opening",
        root,
        campaign_id,
        {
            "text": "[in_game]\n雨落在波士顿的窗玻璃上。\n[/in_game]",
            "run_id": f"run-{campaign_id}",
            "presented_roll_ids": [],
            "decision_id": f"opening-{campaign_id}",
        },
    )
    assert opening["ok"] is True, opening
    return opening


def test_completed_chargen_prefix_resumes_at_table_opening(tmp_path: Path) -> None:
    campaign_id = "chargen-prefix-opening"
    campaign_dir, chargen = _create_chargen_and_complete(tmp_path, campaign_id)

    creation = json.loads(
        (
            tmp_path / ".coc" / "investigators" / f"inv-{campaign_id}"
            / "creation.json"
        ).read_text(encoding="utf-8")
    )
    assert creation["edu_improvement_rolls"]
    assert set(chargen["data"]["result"]["roll_ids"]) <= (
        coc_turn_finalization.creation_receipt_bound_roll_ids(
            campaign_id, [creation]
        )
    )

    resumed = _resume(tmp_path, campaign_id)

    assert resumed["data"]["mode"] == "table_opening"
    assert resumed["data"]["next_operations"] == ["evidence.table_opening"]
    assert resumed["data"]["current_turn"]["meaningful_row_count"] == 0
    assert resumed["data"]["current_turn"]["rows"] == []
    assert resumed["data"]["turn_tail_quarantine"]["quarantined_orphan_rolls"] == []
    assert resumed["data"]["turn_tail_quarantine"]["invalidated_decisions"] == []
    assert not (campaign_dir / "save" / "roll-dispositions.json").exists()

    opening = _open(tmp_path, campaign_id)
    calls = _read_jsonl(campaign_dir / "logs" / "toolbox-calls.jsonl")
    complete_index = next(
        index for index, row in enumerate(calls)
        if row.get("tool") == "setup.complete" and row.get("ok") is True
    )
    opening_index = next(
        index for index, row in enumerate(calls)
        if row.get("tool") == "evidence.table_opening" and row.get("ok") is True
    )
    between = {row.get("tool") for row in calls[complete_index + 1 : opening_index]}
    assert between.isdisjoint(
        {"state.journal", "turn.output_context", "narration.review", "turn.finalize"}
    )

    cursor = json.loads(
        (campaign_dir / "save" / "turn-source-cursor.json").read_text(encoding="utf-8")
    )
    assert cursor["next_source_index"] == opening_index + 1
    assert cursor["next_source_offset"] > 0
    after_opening = _resume(tmp_path, campaign_id)
    assert after_opening["data"]["mode"] == "awaiting_player"
    assert after_opening["data"]["current_turn"]["meaningful_row_count"] == 0
    replay = _open(tmp_path, campaign_id)
    assert replay["data"] == opening["data"]
    assert len(_read_jsonl(campaign_dir / "logs" / "table-transcript.jsonl")) == 1


def test_post_handoff_mutation_remains_open_turn_recovery(tmp_path: Path) -> None:
    campaign_id = "chargen-prefix-real-tail"
    _campaign_dir, _chargen = _create_chargen_and_complete(tmp_path, campaign_id)
    changed = coc_toolbox.run_tool(
        "state.set_flag",
        tmp_path,
        campaign_id,
        {
            "flag_id": "real-post-handoff-mutation",
            "value": True,
            "decision_id": "real-post-handoff-mutation",
        },
    )
    assert changed["ok"] is True, changed

    resumed = _resume(tmp_path, campaign_id)

    assert resumed["data"]["mode"] == "open_turn_recovery"
    assert resumed["data"]["next_operations"] == [
        "continue_current_turn_from_receipts"
    ]
    assert resumed["data"]["current_turn"]["meaningful_row_count"] == 1
    assert [row["tool"] for row in resumed["data"]["current_turn"]["rows"]] == [
        "state.set_flag"
    ]
    assert resumed["data"]["turn_tail_quarantine"]["quarantined_orphan_rolls"] == []
    assert resumed["data"]["turn_tail_quarantine"]["invalidated_decisions"] == []
    flags = json.loads(
        (
            tmp_path / ".coc" / "campaigns" / campaign_id
            / "save" / "flags.json"
        ).read_text(encoding="utf-8")
    )
    assert flags["flags"]["real-post-handoff-mutation"] is True


def test_post_handoff_rules_roll_does_not_invalidate_setup_prefix(
    tmp_path: Path,
) -> None:
    campaign_id = "chargen-prefix-real-rules-tail"
    campaign_dir, chargen = _create_chargen_and_complete(tmp_path, campaign_id)
    setup_roll_ids = set(chargen["data"]["result"]["roll_ids"])
    rolled = coc_toolbox.run_tool(
        "rules.roll_dice",
        tmp_path,
        campaign_id,
        {
            "expression": "1D100",
            "reason": "real post-handoff rules work",
            "decision_id": "real-post-handoff-rules-roll",
        },
    )
    assert rolled["ok"] is True, rolled

    resumed = _resume(tmp_path, campaign_id)

    assert resumed["data"]["mode"] == "open_turn_recovery"
    assert [
        row["tool"] for row in resumed["data"]["current_turn"]["rows"]
    ] == ["rules.roll_dice"]
    quarantine = resumed["data"]["turn_tail_quarantine"]
    assert quarantine["quarantined_orphan_rolls"] == [rolled["data"]["roll_id"]]
    invalidated = {
        tuple(json.loads(key)) for key in quarantine["invalidated_decisions"]
    }
    assert invalidated == {("rules.roll_dice", "real-post-handoff-rules-roll")}
    dispositions = coc_turn_finalization.load_roll_dispositions(campaign_dir)
    assert setup_roll_ids.isdisjoint(dispositions)
    assert setup_roll_ids <= (
        coc_turn_finalization.campaign_creation_receipt_bound_roll_ids(campaign_dir)
    )
    assert any(
        "do not reuse" in hint and "invalidated" in hint
        for hint in resumed["hints"]
    )


def test_post_handoff_state_and_rules_tail_remains_recovery(tmp_path: Path) -> None:
    campaign_id = "chargen-prefix-state-rules-tail"
    campaign_dir, chargen = _create_chargen_and_complete(tmp_path, campaign_id)
    setup_roll_ids = set(chargen["data"]["result"]["roll_ids"])
    flag = coc_toolbox.run_tool(
        "state.set_flag",
        tmp_path,
        campaign_id,
        {
            "flag_id": "post-handoff-state-before-roll",
            "value": True,
            "decision_id": "post-handoff-state-before-roll",
        },
    )
    assert flag["ok"] is True, flag
    rolled = coc_toolbox.run_tool(
        "rules.roll_dice",
        tmp_path,
        campaign_id,
        {
            "expression": "1D100",
            "reason": "real post-handoff rules work after state",
            "decision_id": "post-handoff-roll-after-state",
        },
    )
    assert rolled["ok"] is True, rolled

    resumed = _resume(tmp_path, campaign_id)

    assert resumed["data"]["mode"] == "open_turn_recovery"
    assert [
        row["tool"] for row in resumed["data"]["current_turn"]["rows"]
    ] == ["state.set_flag", "rules.roll_dice"]
    invalidated = {
        tuple(json.loads(key))
        for key in resumed["data"]["turn_tail_quarantine"]["invalidated_decisions"]
    }
    assert invalidated == {("rules.roll_dice", "post-handoff-roll-after-state")}
    assert setup_roll_ids.isdisjoint(
        coc_turn_finalization.load_roll_dispositions(campaign_dir)
    )
    flags = json.loads(
        (campaign_dir / "save" / "flags.json").read_text(encoding="utf-8")
    )
    assert flags["flags"]["post-handoff-state-before-roll"] is True


def test_creation_binding_includes_nested_edu_receipts_and_fails_closed() -> None:
    campaign_id = "nested-edu-binding"
    check = {
        "campaign_id": campaign_id,
        "decision_id": "edu-check",
        "roll_id": "edu-check-roll",
    }
    improve = {
        "campaign_id": campaign_id,
        "decision_id": "edu-improve",
        "roll_id": "edu-improve-roll",
    }
    malformed = {**check, "extra": "not-current-schema"}
    cross_campaign = {**improve, "campaign_id": "other-campaign"}

    bound = coc_turn_finalization.creation_receipt_bound_roll_ids(
        campaign_id,
        [
            {
                "edu_improvement_rolls": [
                    {"check_receipt": check, "improve_receipt": improve},
                    {"check_receipt": malformed, "improve_receipt": cross_campaign},
                    "not-an-object",
                ],
            }
        ],
    )

    assert bound == {"edu-check-roll", "edu-improve-roll"}


def test_teen_luck_candidates_are_all_creation_bound(tmp_path: Path) -> None:
    campaign_id = "chargen-prefix-teen-luck"
    campaign_dir, chargen = _create_chargen_and_complete(
        tmp_path, campaign_id, age=18,
    )
    creation = json.loads(
        (
            tmp_path / ".coc" / "investigators" / f"inv-{campaign_id}"
            / "creation.json"
        ).read_text(encoding="utf-8")
    )
    candidate_ids = {
        row["receipt"]["roll_id"] for row in creation["luck_roll_candidates"]
    }
    assert len(candidate_ids) == 2
    assert candidate_ids <= set(chargen["data"]["result"]["roll_ids"])
    assert candidate_ids <= (
        coc_turn_finalization.campaign_creation_receipt_bound_roll_ids(campaign_dir)
    )

    resumed = _resume(tmp_path, campaign_id)

    assert resumed["data"]["mode"] == "table_opening"
    assert resumed["data"]["turn_tail_quarantine"]["quarantined_orphan_rolls"] == []
    assert resumed["data"]["turn_tail_quarantine"]["invalidated_decisions"] == []
    assert not (campaign_dir / "save" / "roll-dispositions.json").exists()


def test_setup_complete_replay_does_not_extend_prefix_seal(tmp_path: Path) -> None:
    campaign_id = "chargen-prefix-replay"
    _campaign_dir, _chargen = _create_chargen_and_complete(tmp_path, campaign_id)
    changed = coc_toolbox.run_tool(
        "state.set_flag",
        tmp_path,
        campaign_id,
        {
            "flag_id": "between-complete-replays",
            "value": True,
            "decision_id": "between-complete-replays",
        },
    )
    assert changed["ok"] is True, changed
    replay = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        campaign_id,
        {
            "campaign_id": campaign_id,
            "decision_id": f"complete-{campaign_id}",
        },
    )
    assert replay["ok"] is True, replay

    resumed = _resume(tmp_path, campaign_id)

    assert resumed["data"]["mode"] == "open_turn_recovery"
    assert [
        row["tool"] for row in resumed["data"]["current_turn"]["rows"]
    ] == ["state.set_flag"]


def test_setup_complete_immediate_replay_still_resumes_at_opening(
    tmp_path: Path,
) -> None:
    campaign_id = "chargen-prefix-immediate-replay"
    _campaign_dir, _chargen = _create_chargen_and_complete(tmp_path, campaign_id)
    replay = coc_toolbox.run_tool(
        "setup.complete",
        tmp_path,
        campaign_id,
        {
            "campaign_id": campaign_id,
            "decision_id": f"complete-{campaign_id}",
        },
    )
    assert replay["ok"] is True, replay

    resumed = _resume(tmp_path, campaign_id)

    assert resumed["data"]["mode"] == "table_opening"
    assert resumed["data"]["current_turn"]["meaningful_row_count"] == 0


def test_opening_replay_does_not_contaminate_later_recovery(tmp_path: Path) -> None:
    campaign_id = "opening-replay-isolation"
    campaign_dir, _chargen = _create_chargen_and_complete(tmp_path, campaign_id)
    assert _resume(tmp_path, campaign_id)["data"]["mode"] == "table_opening"
    first_opening = _open(tmp_path, campaign_id)
    cursor_path = campaign_dir / "save" / "turn-source-cursor.json"
    cursor_after_opening = cursor_path.read_bytes()
    rolled = coc_toolbox.run_tool(
        "rules.roll_dice",
        tmp_path,
        campaign_id,
        {
            "expression": "1D100",
            "reason": "genuine post-opening player work",
            "decision_id": "post-opening-player-roll",
        },
    )
    assert rolled["ok"] is True, rolled

    replay = _open(tmp_path, campaign_id)

    assert replay["data"] == first_opening["data"]
    assert cursor_path.read_bytes() == cursor_after_opening
    resumed = _resume(tmp_path, campaign_id)
    assert resumed["data"]["mode"] == "open_turn_recovery"
    assert [
        row["tool"] for row in resumed["data"]["current_turn"]["rows"]
    ] == ["rules.roll_dice"]
