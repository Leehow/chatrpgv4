from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


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


def _campaign_tree_without_dispatch_audit(campaign_dir: Path) -> dict[str, object]:
    """Snapshot canonical campaign state while allowing one toolbox audit row."""
    snapshot: dict[str, object] = {}
    for path in sorted(campaign_dir.rglob("*")):
        relative = path.relative_to(campaign_dir).as_posix()
        if relative in {"logs/toolbox-calls.jsonl", "logs/.recorder.lock"}:
            continue
        if path.is_symlink():
            snapshot[relative] = ("symlink", path.readlink().as_posix())
        elif path.is_file():
            try:
                snapshot[relative] = path.read_bytes()
            except OSError:
                snapshot[relative] = ("unreadable", path.stat().st_mode)
    return snapshot


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


def _finalize_from_output(root: Path, campaign_id: str, output: dict) -> dict:
    result_paragraph = "调查员的行动在场景中产生了清楚而连续的结果。"
    draft = "调查员落实了刚才的决定。\n\n" + result_paragraph
    coverage = [
        {
            "obligation_id": row["obligation_id"],
            "realization": "fictional_beat",
            "action_realization": "调查员完成了本轮已经声明的具体行动",
            "response": "现场状态依照已经结算的行动发生了对应变化",
            "causal_explanation": "该变化直接来自本轮的权威状态记录",
            "persona_fit": "行动保持调查员既有身份与方法",
            "player_input_handling": "specific_preserved",
            "exact_excerpt": result_paragraph,
            "exceptional_beat": (
                "特殊结果已经造成与来源行动直接相连的实质改变"
                if row["exceptional_required"]
                else ""
            ),
        }
        for row in output["obligations"]
    ]
    placements = []
    for segment_type, source_key, after in (
        ("public_check", "roll_id", 0),
        ("state_delta", "effect_id", 1),
        ("exceptional_effect", "event_id", 1),
    ):
        rows = output["mechanics_bundle"].get(segment_type) or []
        if rows:
            placements.append({
                "after_paragraph": after,
                "segment_type": segment_type,
                "source_ids": [str(row[source_key]) for row in rows],
            })
    reviewed = coc_toolbox.run_tool(
        "narration.review",
        root,
        campaign_id,
        {
            "decision_id": f"review-{campaign_id}",
            "draft_text": draft,
            "findings": [],
        },
    )
    assert reviewed["ok"] is True, reviewed
    finalized = coc_toolbox.run_tool(
        "turn.finalize",
        root,
        campaign_id,
        {
            "draft": draft,
            "coverage": coverage,
            "mechanics_placements": placements,
            "revision": 1,
            "decision_id": f"finalize-{campaign_id}",
        },
    )
    assert finalized["ok"] is True, finalized
    return finalized


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

    boundary = coc_toolbox.coc_turn_manifest.effective_source_boundary(campaign_dir)
    assert boundary["kind"] == "setup_handoff_virtual"
    assert boundary["durable_start_index"] == 0
    assert boundary["effective_start_index"] > 0
    assert boundary["cursor_close_owner"] == "evidence.table_opening"
    assert resumed["data"]["mode"] == "table_opening"
    assert resumed["data"]["next_operations"] == ["evidence.table_opening"]
    assert resumed["data"]["current_turn"]["setup_source_prefix_seal"] == {
        "schema_version": 1,
        "decision_id": f"complete-{campaign_id}",
        "sealed_source_row_count": boundary["effective_start_index"],
        "effective_source_start_index": boundary["effective_start_index"],
        "cursor_closed": False,
        "cursor_close_owner": "evidence.table_opening",
    }
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
    closed_boundary = coc_toolbox.coc_turn_manifest.effective_source_boundary(
        campaign_dir
    )
    assert closed_boundary["kind"] == "durable_cursor"
    assert closed_boundary["effective_start_index"] == cursor["next_source_index"]
    assert closed_boundary["cursor_close_owner"] == "turn.finalize"
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
    rejected = coc_toolbox.run_tool(
        "state.journal",
        tmp_path,
        campaign_id,
        {
            "summary": "开桌前的真实变更不能被结算成玩家回合。",
            "player_action": "过早结算",
            "player_text": "我试图在开场前结算。",
            "run_id": f"run-{campaign_id}",
            "decision_id": f"journal-{campaign_id}",
        },
    )
    assert rejected["ok"] is False
    assert rejected["error"]["code"] == "table_opening_required"

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


def test_preopening_journal_fails_before_canonical_writes(
    tmp_path: Path,
) -> None:
    campaign_id = "preopening-journal-rejected"
    campaign_dir, _chargen = _create_chargen_and_complete(tmp_path, campaign_id)
    tracked = [
        campaign_dir / "save" / "turn-source-cursor.json",
        campaign_dir / "save" / "pacing-state.json",
        campaign_dir / "logs" / "events.jsonl",
        campaign_dir / "memory" / "session-summaries.jsonl",
        campaign_dir / "save" / "toolbox-ledger.json",
        campaign_dir / "logs" / "table-transcript.jsonl",
        campaign_dir / "save" / "pending-turn.json",
    ]
    before = {path: path.read_bytes() if path.is_file() else None for path in tracked}
    manifests = campaign_dir / "save" / "turn-manifests"
    manifests_before = sorted(path.name for path in manifests.glob("*.json"))

    journaled = coc_toolbox.run_tool(
        "state.journal",
        tmp_path,
        campaign_id,
        {
            "summary": "不应在开桌前写入。",
            "player_action": "过早行动",
            "player_text": "我现在就行动。",
            "player_speaker": "玩家",
            "run_id": f"run-{campaign_id}",
            "intent_class": "investigate",
            "decision_id": f"journal-{campaign_id}",
        },
    )

    assert journaled["ok"] is False
    assert journaled["error"]["code"] == "table_opening_required"
    assert {path: path.read_bytes() if path.is_file() else None for path in tracked} == before
    assert sorted(path.name for path in manifests.glob("*.json")) == manifests_before
    assert coc_toolbox.coc_turn_manifest.pending_manifest(campaign_dir) is None
    with pytest.raises(
        coc_toolbox.coc_turn_manifest.TurnManifestError,
        match="evidence.table_opening",
    ) as direct_error:
        coc_toolbox.coc_turn_manifest.start_pending_turn(
            campaign_dir,
            journal_decision_id="direct-preopening-defense",
            turn_number=1,
        )
    assert direct_error.value.code == "table_opening_required"
    assert sorted(path.name for path in manifests.glob("*.json")) == manifests_before
    assert _resume(tmp_path, campaign_id)["data"]["mode"] == "table_opening"
    _open(tmp_path, campaign_id)


def test_persisted_handoff_without_toolbox_receipt_fails_closed(
    tmp_path: Path,
) -> None:
    campaign_id = "handoff-receipt-interrupted"
    campaign_dir, _chargen = _create_chargen_and_complete(tmp_path, campaign_id)
    toolbox_path = campaign_dir / "logs" / "toolbox-calls.jsonl"
    calls = _read_jsonl(toolbox_path)
    assert calls[-1]["tool"] == "setup.complete"
    toolbox_path.write_text(
        "".join(
            json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
            for row in calls[:-1]
        ),
        encoding="utf-8",
    )
    tracked = [
        campaign_dir / "save" / "pacing-state.json",
        campaign_dir / "logs" / "events.jsonl",
        campaign_dir / "memory" / "session-summaries.jsonl",
        campaign_dir / "save" / "toolbox-ledger.json",
        campaign_dir / "logs" / "table-transcript.jsonl",
        campaign_dir / "save" / "pending-turn.json",
    ]
    before = {path: path.read_bytes() if path.is_file() else None for path in tracked}

    journaled = coc_toolbox.run_tool(
        "state.journal",
        tmp_path,
        campaign_id,
        {
            "summary": "generic receipt 中断时不能开始玩家回合。",
            "player_action": "等待开桌恢复",
            "player_text": "我等待开桌证据恢复。",
            "run_id": f"run-{campaign_id}",
            "decision_id": f"journal-{campaign_id}",
        },
    )

    assert journaled["ok"] is False
    assert journaled["error"]["code"] == "table_opening_required"
    assert {path: path.read_bytes() if path.is_file() else None for path in tracked} == before
    boundary = coc_toolbox.coc_turn_manifest.effective_source_boundary(campaign_dir)
    assert boundary["kind"] == "setup_handoff_unverified"
    assert boundary["effective_start_index"] == 0
    resumed = _resume(tmp_path, campaign_id)
    assert resumed["data"]["mode"] == "open_turn_recovery"
    assert resumed["data"]["current_turn"]["source_start_index"] == 0
    assert "setup_source_prefix_seal" not in resumed["data"]["current_turn"]


@pytest.mark.parametrize(
    ("corruption", "expected_code"),
    [
        ("schema", "state_corrupt"),
        ("campaign", "state_corrupt"),
        ("decision", "state_corrupt"),
        ("non_object", "state_corrupt"),
        ("investigator_ids", "state_corrupt"),
        ("extra_field", "state_corrupt"),
        ("full_receipt_mismatch", "table_opening_required"),
    ],
)
def test_malformed_persisted_handoff_never_opens_journal_boundary(
    tmp_path: Path, corruption: str, expected_code: str,
) -> None:
    campaign_id = f"malformed-handoff-{corruption}"
    campaign_dir, _chargen = _create_chargen_and_complete(tmp_path, campaign_id)
    campaign_path = campaign_dir / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    handoff = campaign["setup_handoff"]
    if corruption == "schema":
        handoff["schema_version"] = 2
    elif corruption == "campaign":
        handoff["campaign_id"] = "different-campaign"
    elif corruption == "decision":
        handoff["decision_id"] = " "
    elif corruption == "non_object":
        campaign["setup_handoff"] = "not-an-object"
    elif corruption == "investigator_ids":
        handoff["investigator_ids"] = ["../outside"]
    elif corruption == "extra_field":
        handoff["unexpected"] = True
    else:
        handoff["completed_at"] = "2099-01-01T00:00:00+00:00"
    campaign_path.write_text(
        json.dumps(campaign, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    canonical_before = _campaign_tree_without_dispatch_audit(campaign_dir)
    tracked = [
        campaign_dir / "save" / "pacing-state.json",
        campaign_dir / "logs" / "events.jsonl",
        campaign_dir / "memory" / "session-summaries.jsonl",
        campaign_dir / "save" / "toolbox-ledger.json",
        campaign_dir / "logs" / "table-transcript.jsonl",
        campaign_dir / "save" / "pending-turn.json",
    ]
    before = {path: path.read_bytes() if path.is_file() else None for path in tracked}

    journaled = coc_toolbox.run_tool(
        "state.journal",
        tmp_path,
        campaign_id,
        {
            "summary": "损坏 handoff 不能打开 journal 边界。",
            "player_action": "等待恢复",
            "player_text": "我等待状态修复。",
            "run_id": f"run-{campaign_id}",
            "decision_id": f"journal-{campaign_id}",
        },
    )

    assert journaled["ok"] is False
    assert journaled["error"]["code"] == expected_code
    assert {path: path.read_bytes() if path.is_file() else None for path in tracked} == before
    assert coc_toolbox.coc_turn_manifest.pending_manifest(campaign_dir) is None
    assert _campaign_tree_without_dispatch_audit(campaign_dir) == canonical_before
    if expected_code == "state_corrupt":
        resumed = coc_toolbox.run_tool("session.resume", tmp_path, campaign_id, {})
        assert resumed["ok"] is False
        assert resumed["error"]["code"] == "state_corrupt"
        assert _campaign_tree_without_dispatch_audit(campaign_dir) == canonical_before
        calls = _read_jsonl(campaign_dir / "logs" / "toolbox-calls.jsonl")
        assert calls[-1]["tool"] == "session.resume"
        assert calls[-1]["ok"] is False


def test_campaign_without_setup_handoff_keeps_ordinary_cursor_semantics(
    tmp_path: Path,
) -> None:
    campaign_id = "no-setup-handoff-boundary"
    coc_state.create_campaign(tmp_path, campaign_id, "No handoff", era="1920s")
    campaign_dir = tmp_path / ".coc" / "campaigns" / campaign_id

    boundary = coc_toolbox.coc_turn_manifest.effective_source_boundary(campaign_dir)
    assert boundary["kind"] == "durable_cursor"
    assert boundary["cursor_close_owner"] == "turn.finalize"
    manifest = coc_toolbox.coc_turn_manifest.start_pending_turn(
        campaign_dir,
        journal_decision_id="no-handoff-journal",
        turn_number=1,
    )
    assert manifest["source_start_index"] == 0


def test_damaged_preopening_journal_replay_cannot_recreate_transcript(
    tmp_path: Path,
) -> None:
    campaign_id = "damaged-preopening-journal-replay"
    campaign_dir, _chargen = _create_chargen_and_complete(tmp_path, campaign_id)
    campaign_path = campaign_dir / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    handoff = campaign.pop("setup_handoff")
    campaign_path.write_text(
        json.dumps(campaign, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    args = {
        "summary": "模拟受损历史 journal。",
        "player_action": "受损历史行动",
        "player_text": "这条 transcript 将被模拟丢失。",
        "run_id": f"run-{campaign_id}",
        "decision_id": f"journal-{campaign_id}",
    }
    original = coc_toolbox.run_tool(
        "state.journal", tmp_path, campaign_id, args,
    )
    assert original["ok"] is True, original
    campaign["setup_handoff"] = handoff
    campaign_path.write_text(
        json.dumps(campaign, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    transcript_path = campaign_dir / "logs" / "table-transcript.jsonl"
    transcript_path.unlink()

    replay = coc_toolbox.run_tool(
        "state.journal", tmp_path, campaign_id, args,
    )

    assert replay["ok"] is False
    assert replay["error"]["code"] == "table_opening_required"
    assert not transcript_path.exists()


def test_post_opening_pending_turn_excludes_setup_through_finalization(
    tmp_path: Path,
) -> None:
    campaign_id = "post-opening-manifest-boundary"
    campaign_dir, chargen = _create_chargen_and_complete(tmp_path, campaign_id)
    creation_roll_ids = set(chargen["data"]["result"]["roll_ids"])
    assert _resume(tmp_path, campaign_id)["data"]["mode"] == "table_opening"
    _open(tmp_path, campaign_id)
    cursor_path = campaign_dir / "save" / "turn-source-cursor.json"
    opening_cursor = json.loads(cursor_path.read_text(encoding="utf-8"))
    changed = coc_toolbox.run_tool(
        "state.set_flag",
        tmp_path,
        campaign_id,
        {
            "flag_id": "post-handoff-pending-tail",
            "value": True,
            "decision_id": "post-handoff-pending-tail",
        },
    )
    assert changed["ok"] is True, changed
    rolled = coc_toolbox.run_tool(
        "rules.roll_dice",
        tmp_path,
        campaign_id,
        {
            "expression": "1D100",
            "reason": "post-opening live turn roll",
            "decision_id": "post-opening-live-roll",
        },
    )
    assert rolled["ok"] is True, rolled
    journaled = coc_toolbox.run_tool(
        "state.journal",
        tmp_path,
        campaign_id,
        {
            "summary": "调查员确认了开桌交接后的现场状态。",
            "player_action": "确认现场状态",
            "player_text": "我先确认现场有没有变化。",
            "player_speaker": "玩家",
            "run_id": f"run-{campaign_id}",
            "intent_class": "investigate",
            "decision_id": f"journal-{campaign_id}",
        },
    )
    assert journaled["ok"] is True, journaled

    direct_output = coc_toolbox.run_tool(
        "turn.output_context", tmp_path, campaign_id, {},
    )
    assert direct_output["ok"] is True, direct_output
    output = direct_output["data"]
    assert output["source_start_index"] == opening_cursor["next_source_index"]
    assert creation_roll_ids.isdisjoint(output["source_roll_ids"])
    assert rolled["data"]["roll_id"] in output["source_roll_ids"]
    assert not any(
        roll_id in json.dumps(output["mechanics_bundle"], ensure_ascii=False)
        for roll_id in creation_roll_ids
    )
    assert not any(
        roll_id in json.dumps(output["obligations"], ensure_ascii=False)
        for roll_id in creation_roll_ids
    )
    manifest, source_rows, _journal = coc_toolbox.coc_turn_manifest.refresh_pending_window(
        campaign_dir
    )
    assert [row["tool"] for row in source_rows] == [
        "state.set_flag", "rules.roll_dice", "state.journal",
    ]
    assert creation_roll_ids.isdisjoint(
        coc_turn_finalization._referenced_roll_ids(source_rows)
    )
    assert manifest["source_start_index"] == output["source_start_index"]
    assert manifest["source_start_offset"] == opening_cursor["next_source_offset"]

    finalized = _finalize_from_output(tmp_path, campaign_id, output)

    assert creation_roll_ids.isdisjoint(finalized["data"]["source_roll_ids"])
    assert all(
        roll_id not in finalized["data"]["rendered_text"]
        for roll_id in creation_roll_ids
    )
    assert rolled["data"]["roll_id"] in finalized["data"]["source_roll_ids"]
    assert not (campaign_dir / "save" / "pending-turn.json").exists()
    completed_cursor = json.loads(cursor_path.read_text(encoding="utf-8"))
    assert completed_cursor["next_source_index"] > opening_cursor["next_source_index"]
    assert completed_cursor["next_source_offset"] > opening_cursor["next_source_offset"]
    assert completed_cursor["last_finalization_id"] == (
        finalized["data"]["finalization_id"]
    )


def test_unlinked_same_campaign_creation_cannot_bind_orphan_roll(
    tmp_path: Path,
) -> None:
    campaign_id = "unlinked-creation-cannot-launder"
    campaign_dir, _chargen = _create_chargen_and_complete(tmp_path, campaign_id)
    orphan = coc_toolbox.run_tool(
        "rules.roll_dice",
        tmp_path,
        campaign_id,
        {
            "expression": "1D100",
            "reason": "post-handoff orphan for scope regression",
            "decision_id": "unlinked-launder-attempt",
        },
    )
    assert orphan["ok"] is True, orphan
    unlinked_id = "unlinked-same-campaign"
    unlinked_dir = tmp_path / ".coc" / "investigators" / unlinked_id
    unlinked_dir.mkdir(parents=True)
    (unlinked_dir / "creation.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "investigator_id": unlinked_id,
                "input_mode": "guided_quick_fire",
                "edu_improvement_rolls": [
                    {
                        "check_receipt": {
                            "campaign_id": campaign_id,
                            "decision_id": "unlinked-launder-attempt",
                            "roll_id": orphan["data"]["roll_id"],
                        }
                    }
                ],
            },
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )

    assert orphan["data"]["roll_id"] not in (
        coc_turn_finalization.campaign_creation_receipt_bound_roll_ids(campaign_dir)
    )
    resumed = _resume(tmp_path, campaign_id)
    assert resumed["data"]["turn_tail_quarantine"]["quarantined_orphan_rolls"] == [
        orphan["data"]["roll_id"]
    ]


def test_linked_malformed_creation_cannot_launder_roll(tmp_path: Path) -> None:
    campaign_id = "linked-malformed-creation"
    campaign_dir, chargen = _create_chargen_and_complete(tmp_path, campaign_id)
    canonical_roll_ids = set(chargen["data"]["result"]["roll_ids"])
    assert canonical_roll_ids <= (
        coc_turn_finalization.campaign_creation_receipt_bound_roll_ids(campaign_dir)
    )
    orphan = coc_toolbox.run_tool(
        "rules.roll_dice",
        tmp_path,
        campaign_id,
        {
            "expression": "1D100",
            "reason": "linked malformed laundering attempt",
            "decision_id": "linked-malformed-launder",
        },
    )
    assert orphan["ok"] is True, orphan
    investigator_id = f"inv-{campaign_id}"
    creation_path = (
        tmp_path / ".coc" / "investigators" / investigator_id / "creation.json"
    )
    creation_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "investigator_id": investigator_id,
                "input_mode": "guided_quick_fire",
                "edu_improvement_rolls": [
                    {
                        "check_receipt": {
                            "campaign_id": campaign_id,
                            "decision_id": "linked-malformed-launder",
                            "roll_id": orphan["data"]["roll_id"],
                        }
                    }
                ],
            },
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )

    with pytest.raises(coc_turn_finalization.TurnContractError) as error:
        coc_turn_finalization.campaign_creation_receipt_bound_roll_ids(campaign_dir)
    assert error.value.code == "state_corrupt"


@pytest.mark.parametrize(
    ("receipt_family", "age", "expression"),
    [
        ("winning_luck", 27, "3D6"),
        ("luck_candidate", 27, "3D6"),
        ("edu_check", 45, "1D100"),
        ("edu_improve", 45, "1D10"),
        ("edu_improve_receipt_only", 45, "1D10"),
    ],
)
def test_linked_quick_fire_receipt_mutation_fails_closed_before_resume_writes(
    tmp_path: Path, receipt_family: str, age: int, expression: str,
) -> None:
    campaign_id = f"linked-{receipt_family}-launder"
    campaign_dir, chargen = _create_chargen_and_complete(
        tmp_path, campaign_id, age=age,
    )
    canonical_roll_ids = set(chargen["data"]["result"]["roll_ids"])
    assert canonical_roll_ids <= (
        coc_turn_finalization.campaign_creation_receipt_bound_roll_ids(campaign_dir)
    )
    orphan = coc_toolbox.run_tool(
        "rules.roll_dice",
        tmp_path,
        campaign_id,
        {
            "expression": expression,
            "reason": f"post-handoff {receipt_family} laundering attempt",
            "decision_id": f"orphan-{receipt_family}",
        },
    )
    assert orphan["ok"] is True, orphan
    reference = {
        "campaign_id": campaign_id,
        "decision_id": f"orphan-{receipt_family}",
        "roll_id": orphan["data"]["roll_id"],
    }
    creation_path = (
        tmp_path / ".coc" / "investigators" / f"inv-{campaign_id}"
        / "creation.json"
    )
    creation = json.loads(creation_path.read_text(encoding="utf-8"))
    if receipt_family == "winning_luck":
        creation["luck_roll_receipt"] = reference
    elif receipt_family == "luck_candidate":
        creation["luck_roll_candidates"] = [
            {"total": orphan["data"]["total"], "receipt": reference}
        ]
    elif receipt_family == "edu_check":
        creation["edu_improvement_rolls"][0]["check_receipt"] = reference
    elif receipt_family == "edu_improve":
        improved = next(
            (
                row for row in creation["edu_improvement_rolls"]
                if "improve_receipt" in row
            ),
            creation["edu_improvement_rolls"][0],
        )
        improved["improvement_roll"] = orphan["data"]["total"]
        improved["improve_receipt"] = reference
    else:
        creation["edu_improvement_rolls"][0]["improve_receipt"] = reference
    creation_path.write_text(
        json.dumps(creation, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    before = _campaign_tree_without_dispatch_audit(campaign_dir)

    with pytest.raises(coc_turn_finalization.TurnContractError) as direct_error:
        coc_turn_finalization.campaign_creation_receipt_bound_roll_ids(campaign_dir)
    assert direct_error.value.code == "state_corrupt"
    resumed = coc_toolbox.run_tool("session.resume", tmp_path, campaign_id, {})
    assert resumed["ok"] is False
    assert resumed["error"]["code"] == "state_corrupt"
    assert _campaign_tree_without_dispatch_audit(campaign_dir) == before
    dispositions = coc_turn_finalization.load_roll_dispositions(campaign_dir)
    assert canonical_roll_ids.isdisjoint(dispositions)
    assert orphan["data"]["roll_id"] not in dispositions


@pytest.mark.parametrize(
    "party_corruption",
    ["schema", "campaign", "id_list", "missing", "symlink", "unreadable"],
)
def test_resume_rejects_malformed_party_before_canonical_writes(
    tmp_path: Path, party_corruption: str,
) -> None:
    campaign_id = f"malformed-party-{party_corruption}"
    campaign_dir, chargen = _create_chargen_and_complete(tmp_path, campaign_id)
    canonical_roll_ids = set(chargen["data"]["result"]["roll_ids"])
    assert canonical_roll_ids <= (
        coc_turn_finalization.campaign_creation_receipt_bound_roll_ids(campaign_dir)
    )
    party_path = campaign_dir / "party.json"
    party = json.loads(party_path.read_text(encoding="utf-8"))
    if party_corruption == "schema":
        party["schema_version"] = 2
    elif party_corruption == "campaign":
        party["campaign_id"] = "different-campaign"
    elif party_corruption == "id_list":
        party["investigator_ids"] = [
            f"inv-{campaign_id}", f"inv-{campaign_id}",
        ]
    if party_corruption in {"schema", "campaign", "id_list"}:
        party_path.write_text(
            json.dumps(party, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    elif party_corruption == "missing":
        party_path.unlink()
    elif party_corruption == "symlink":
        target = tmp_path / f"saved-party-{campaign_id}.json"
        party_path.rename(target)
        party_path.symlink_to(target)
    else:
        party_path.chmod(0)
    before = _campaign_tree_without_dispatch_audit(campaign_dir)

    resumed = coc_toolbox.run_tool("session.resume", tmp_path, campaign_id, {})

    assert resumed["ok"] is False
    assert resumed["error"]["code"] == "state_corrupt"
    assert _campaign_tree_without_dispatch_audit(campaign_dir) == before
    calls = _read_jsonl(campaign_dir / "logs" / "toolbox-calls.jsonl")
    assert calls[-1]["tool"] == "session.resume"
    assert calls[-1]["ok"] is False


@pytest.mark.parametrize("linked_file", ["creation.json", "character.json"])
@pytest.mark.parametrize("corruption", ["missing", "symlink", "unreadable"])
def test_resume_rejects_corrupt_linked_investigator_before_canonical_writes(
    tmp_path: Path, linked_file: str, corruption: str,
) -> None:
    campaign_id = f"corrupt-linked-{linked_file.split('.')[0]}-{corruption}"
    campaign_dir, _chargen = _create_chargen_and_complete(tmp_path, campaign_id)
    linked_path = (
        tmp_path / ".coc" / "investigators" / f"inv-{campaign_id}" / linked_file
    )
    if corruption == "missing":
        linked_path.unlink()
    elif corruption == "symlink":
        target = tmp_path / f"saved-{linked_file}"
        linked_path.rename(target)
        linked_path.symlink_to(target)
    else:
        linked_path.chmod(0)
    before = _campaign_tree_without_dispatch_audit(campaign_dir)

    resumed = coc_toolbox.run_tool("session.resume", tmp_path, campaign_id, {})

    assert resumed["ok"] is False
    assert resumed["error"]["code"] == "state_corrupt"
    assert _campaign_tree_without_dispatch_audit(campaign_dir) == before
    calls = _read_jsonl(campaign_dir / "logs" / "toolbox-calls.jsonl")
    assert calls[-1]["tool"] == "session.resume"
    assert calls[-1]["ok"] is False
