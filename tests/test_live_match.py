"""Contract tests for the keeper-agent live match harness.

The current runtime has no fixed action-resolution/narration pipeline.  These
tests exercise the actual boundary instead: a player adapter supplies prose,
the keeper coding agent owns the turn and calls the canonical toolbox, and the
match harness synchronously projects persisted state/log evidence into the
playtest artifacts.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import stat
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_live_match.py"

SECRET_PROSE_FRAGMENTS = [
    "STR 100 CON 100 DEX 15 INT 25 POW 30; HP 100; tentacle slash",
    "probes and discards humans out of curiosity about these fragile successors",
    "White Friday disaster kills ~10,000; only the attribution of blame varies",
    "keeper-only shaft map coordinates 46.5N 12.1E under the ice seal",
]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


match = _load("coc_live_match", SCRIPT)
npc_identity = _load(
    "coc_npc_identity_live_test",
    REPO / "plugins" / "coc-keeper" / "scripts" / "coc_npc_identity.py",
)


def _write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _write_scripted_player_runner(
    path: Path,
    lines: list[str],
    *,
    model_identity: dict | None = None,
    response_mode: str | None = None,
) -> None:
    """Write a stateful player adapter fixture with no keeper-side inputs."""
    script = f"""#!/usr/bin/env python3
import json, sys
from pathlib import Path
state_path = Path(__file__).with_suffix('.state')
lines = {json.dumps(lines, ensure_ascii=False)!r}
lines = json.loads(lines)
model_identity = {model_identity!r}
response_mode = {response_mode!r}
idx = int(state_path.read_text()) if state_path.exists() else 0
request = json.loads(sys.stdin.read())
assert 'public_state' not in request
assert 'world_state' not in request
assert 'character_card' in request
assert 'play_language' in request
text = lines[min(idx, len(lines) - 1)]
state_path.write_text(str(idx + 1))
result = {{
    'ok': True,
    'player_text': text,
    'player_notes': f'note-for-turn-{{idx + 1}}',
}}
if model_identity is not None:
    result['model_identity'] = model_identity
if response_mode is not None:
    result['response_mode'] = response_mode
sys.stdout.write(json.dumps(result, ensure_ascii=False) + '\\n')
"""
    path.write_text(script, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _build_workspace(
    tmp_path: Path,
    *,
    with_secrets: bool = False,
) -> tuple[Path, str, str]:
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "match-drive"
    investigator_id = "inv1"
    campaign = coc_root / "campaigns" / campaign_id
    scenario = campaign / "scenario"
    save = campaign / "save"

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
    _write_json(
        campaign / "campaign.json",
        {
            "campaign_id": campaign_id,
            "title": "Match Drive Campaign",
            "scenario_id": "match-drive",
            "era": "1920s",
            "dice_mode": "codex",
            "spoiler_policy": "warn_before_reveal",
            "play_language": "zh-Hans",
        },
    )
    _write_json(
        save / "world-state.json",
        {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "active_scene_id": "scene-1",
            "visited_scene_ids": ["scene-1"],
            "discovered_clue_ids": [],
            "major_decisions": [],
        },
    )
    _write_json(
        save / "pacing-state.json",
        {
            "schema_version": 1,
            "tension_level": "low",
            "lethal_chances_used": 0,
            "recent_intent_classes": [],
            "turn_number": 0,
            "luck_spent_last": 0,
        },
    )
    _write_json(
        save / "flags.json",
        {"schema_version": 1, "clues_found": {}, "decisions": []},
    )
    _write_json(
        save / "investigator-state" / f"{investigator_id}.json",
        {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "investigator_id": investigator_id,
            "current_hp": 12,
            "current_san": 55,
            "current_mp": 11,
            "conditions": [],
            "skill_checks_earned": [],
        },
    )
    _write_json(
        coc_root / "investigators" / investigator_id / "character.json",
        {
            "schema_version": 1,
            "id": investigator_id,
            "name": "Ada",
            "occupation": "Antiquarian",
            "era": "1920s",
            "characteristics": {
                "STR": 50,
                "CON": 55,
                "SIZ": 50,
                "DEX": 60,
                "APP": 45,
                "INT": 70,
                "POW": 55,
                "EDU": 70,
                "LUCK": 55,
            },
            "derived": {"HP": 12, "SAN": 55, "MP": 11, "MOV": 8},
            "skills": {
                "Credit Rating": 50,
                "Spot Hidden": 60,
                "Library Use": 55,
            },
            "backstory": {},
        },
    )

    secret_values = SECRET_PROSE_FRAGMENTS if with_secrets else []
    _write_json(
        scenario / "story-graph.json",
        {
            "scenes": [
                {
                    "scene_id": "scene-1",
                    "available_clues": ["c1"],
                    "dramatic_question": "q1",
                    "entry_conditions": [],
                    "exit_conditions": [],
                    "tone": ["tense"],
                    "allowed_improvisation": [],
                    **(
                        {"keeper_summary": secret_values[1]}
                        if secret_values
                        else {}
                    ),
                },
                {
                    "scene_id": "scene-2",
                    "available_clues": ["c2"],
                    "dramatic_question": "q2",
                    "entry_conditions": [],
                    "exit_conditions": [],
                    "tone": ["tense"],
                    "allowed_improvisation": [],
                },
            ]
        },
    )
    _write_json(
        scenario / "clue-graph.json",
        {
            "conclusions": [
                {
                    "conclusion_id": "cc1",
                    "importance": "critical",
                    "minimum_routes": 2,
                    "clues": [
                        {
                            "clue_id": "c1",
                            "delivery": "x",
                            "delivery_kind": "environmental",
                            "visibility": "player-safe",
                        },
                        {
                            "clue_id": "c2",
                            "delivery": "y",
                            "delivery_kind": "environmental",
                            "visibility": "player-safe",
                        },
                    ],
                    "fallback_policy": "",
                }
            ]
        },
    )
    _write_json(
        scenario / "npc-agendas.json",
        {
            "npcs": [
                {
                    "npc_id": "npc-guide",
                    "name": "向导",
                    "agenda": "hide the shaft",
                    "secret": secret_values[0] if secret_values else "",
                    "keeper_notes": secret_values[3] if secret_values else "",
                }
            ]
        },
    )
    _write_json(scenario / "threat-fronts.json", {"fronts": []})
    _write_json(
        scenario / "pacing-map.json",
        {
            "pacing_curve": [
                {
                    "scene_id": "scene-1",
                    "tension_target": "low",
                    "horror_stage": "ordinary",
                },
                {
                    "scene_id": "scene-2",
                    "tension_target": "medium",
                    "horror_stage": "wrongness",
                },
            ]
        },
    )
    _write_json(
        scenario / "improvisation-boundaries.json",
        {
            "invent_allowed": [],
            "never_invent": [],
            "keeper_secrets": secret_values or ["secret-1"],
        },
    )
    _write_json(
        scenario / "module-meta.json",
        {
            "schema_version": 1,
            "scenario_id": "match-drive",
            "structure_type": "linear_acts",
            "era": "1920s",
            "content_flags": [],
            "win_condition": "x",
        },
    )
    (campaign / "logs").mkdir(parents=True, exist_ok=True)
    return workspace, campaign_id, investigator_id


def _install_keeper(
    monkeypatch,
    *,
    texts: list[str] | None = None,
    mutation=None,
    error: str | None = None,
) -> list[dict]:
    calls: list[dict] = []
    replies = texts or ["你检查了眼前的现场。"]

    def send_turn(request, **_kwargs):
        index = len(calls)
        calls.append(json.loads(json.dumps(request, ensure_ascii=False)))
        if error is not None:
            raise RuntimeError(error)
        if mutation is not None:
            mutation(request, index)
        return {
            "ok": True,
            "narration": replies[min(index, len(replies) - 1)],
            "model_identity": {"provider": "fixture", "id": "keeper-agent"},
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }

    monkeypatch.setattr(match.keeper_adapter, "keeper_send_turn", send_turn)
    return calls


def test_keeper_agent_match_runs_three_turns_and_writes_incremental_transcript(
    tmp_path, monkeypatch,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    player = tmp_path / "scripted-player"
    _write_scripted_player_runner(
        player,
        ["我检查门锁。", "我追查木屑。", "我检查相邻窗框。"],
    )
    keeper_calls = _install_keeper(
        monkeypatch,
        texts=["锁眼里有木屑。", "木屑很新鲜。", "窗框没有撬痕。"],
    )

    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        max_turns=3,
        run_dir=tmp_path / "run",
    )

    assert len(result["turns"]) == 3
    assert result["result"]["pipeline"] == "keeper_agent"
    assert [call["player_input"] for call in keeper_calls] == [
        "我检查门锁。",
        "我追查木屑。",
        "我检查相邻窗框。",
    ]
    run_id = result["metadata"]["run_id"]
    assert run_id.startswith("coc-run-v1:")
    assert [call["run_id"] for call in keeper_calls] == [run_id] * 3
    identity = json.loads(
        (Path(result["run_dir"]) / "run-identity.json").read_text(
            encoding="utf-8"
        )
    )
    assert identity == {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "run_id": run_id,
    }
    assert result["result"]["run_id"] == run_id
    assert result["result"]["cumulative_run_ids"] == [run_id]
    assert (
        result["result"]["npc_event_chain_binding"]["artifact_run_id"]
        == run_id
    )
    partial = _read_jsonl(Path(result["run_dir"]) / "partial-transcript.jsonl")
    assert len(partial) == 3
    assert all(row["grounding_receipt"] == {
        "schema_version": 1,
        "source": "keeper_agent",
        "guard_applied": False,
    } for row in partial)
    assert all(row["narrator_method"] == "keeper_agent" for row in partial)


def test_live_match_projects_npc_engagement_ids_without_copying_event_payloads(
    tmp_path, monkeypatch,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    campaign = workspace / ".coc" / "campaigns" / campaign_id
    player = tmp_path / "npc-player"
    _write_scripted_player_runner(player, ["我向向导问路。"])

    def mutate(_request, _index):
        identity_contract = npc_identity.identity_contract(
            {
                "npc_id": "npc-guide",
                "name": "Guide",
                "agenda": "SENTINEL_NPC_IDENTITY_MUST_NOT_BE_PUBLIC",
                "schedule": [],
                "source_refs": [],
            },
            "scene-1",
        )
        match._append_jsonl_fsync(
                campaign / "logs" / "events.jsonl",
                {
                    "schema_version": npc_identity.ENGAGEMENT_EVENT_SCHEMA_VERSION,
                    "event_type": "npc_engagement",
                "npc_id": "npc-guide",
                "scene_id": "scene-1",
                "interaction_kind": "dialogue",
                "identity_binding": npc_identity.identity_binding(
                    identity_contract,
                    structured_producer="director_apply.npc_move",
                ),
                "identity_contract": identity_contract,
                "keeper_only_detail": "SENTINEL_EVENT_DETAIL_MUST_NOT_BE_PUBLIC",
            },
        )
        match._append_jsonl_fsync(
            campaign / "logs" / "events.jsonl",
            {
                "event_type": "flag_set",
                "flag_id": "keeper-only-continuity-flag",
                "value": True,
                "reason": "SENTINEL_FLAG_REASON_MUST_NOT_BE_PUBLIC",
            },
        )
        match._append_jsonl_fsync(
            campaign / "logs" / "events.jsonl",
            {
                "event_type": "npc_engagement",
                "npc_id": "npc-legacy-guide",
                "keeper_only_detail": "SENTINEL_LEGACY_NPC_DETAIL_MUST_NOT_BE_PUBLIC",
            },
        )
        match._append_jsonl_fsync(
            campaign / "logs" / "events.jsonl",
            {
                "event_type": "time_marker_changed",
                "marker_id": "keeper-deadline",
                "reason": "SENTINEL_TIME_MARKER_REASON_MUST_NOT_BE_PUBLIC",
            },
        )

    _install_keeper(monkeypatch, mutation=mutate)
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        max_turns=1,
        run_dir=tmp_path / "npc-run",
    )

    session = result["result"]
    assert session["engaged_npc_ids"] == ["npc-guide"]
    assert session["npc_engagement_coverage_contract"] == {
        "schema_version": 4,
        "semantics": "authored_identity_attestation",
        "producer": "coc_live_match",
        "projection_schema_version": 1,
        "usage": "display_only",
        "coverage_eligible": False,
        "legacy_raw_ids_included": False,
        "legacy_status": "NON_COMPARABLE",
        "evidence_digest": npc_identity.engagement_evidence_digest(
            session["npc_engagement_evidence"]
        ),
    }
    assert session["npc_engagement_evidence"] == {
        "schema_version": 1,
        "semantics": "authored_identity_attestation",
        "status": "NON_COMPARABLE",
        "authored_attested_npc_ids": ["npc-guide"],
        "legacy_unverifiable_npc_ids": ["npc-legacy-guide"],
        "unverified_npc_ids": [],
    }
    assert "events" not in session
    public_artifacts = json.dumps(
        {"result": result["result"], "metadata": result["metadata"]},
        ensure_ascii=False,
    )
    assert "SENTINEL_NPC_IDENTITY_MUST_NOT_BE_PUBLIC" not in public_artifacts
    assert "SENTINEL_EVENT_DETAIL_MUST_NOT_BE_PUBLIC" not in public_artifacts
    assert "SENTINEL_FLAG_REASON_MUST_NOT_BE_PUBLIC" not in public_artifacts
    assert "SENTINEL_LEGACY_NPC_DETAIL_MUST_NOT_BE_PUBLIC" not in public_artifacts
    assert "SENTINEL_TIME_MARKER_REASON_MUST_NOT_BE_PUBLIC" not in public_artifacts
    npc_statement = next(
        row
        for row in result["metadata"]["narrative_adherence"]["statements"]
        if row["criterion"].get("npc_id") == "npc-guide"
    )
    # Display projection may still show the structured identity, but a raw
    # caller-appended row has no source receipt and cannot count as adherence
    # coverage through the internal campaign capability.
    assert npc_statement["satisfied"] is False


def test_keeper_turn_persistence_is_visible_before_next_player_call(
    tmp_path, monkeypatch,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    campaign = workspace / ".coc" / "campaigns" / campaign_id
    run_dir = tmp_path / "sync-run"
    dummy_player = tmp_path / "in-process-player"
    dummy_player.write_text("fixture", encoding="utf-8")
    player_calls = 0

    def player_send_turn(_request, **_kwargs):
        nonlocal player_calls
        player_calls += 1
        if player_calls == 2:
            partial = _read_jsonl(run_dir / "partial-transcript.jsonl")
            world = json.loads(
                (campaign / "save" / "world-state.json").read_text(encoding="utf-8")
            )
            assert len(partial) == 1
            assert world["major_decisions"] == ["keeper-write-complete"]
        return {"ok": True, "player_text": f"行动 {player_calls}"}

    monkeypatch.setattr(match.player_adapter, "player_send_turn", player_send_turn)

    def mutate(_request, index):
        if index != 0:
            return
        path = campaign / "save" / "world-state.json"
        world = json.loads(path.read_text(encoding="utf-8"))
        world["major_decisions"] = ["keeper-write-complete"]
        _write_json(path, world)

    _install_keeper(monkeypatch, mutation=mutate)
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=dummy_player,
        max_turns=2,
        run_dir=run_dir,
    )

    assert len(result["turns"]) == 2
    assert player_calls == 2


def test_historical_cliffhanger_does_not_stop_resumed_run(
    tmp_path, monkeypatch,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    campaign = workspace / ".coc" / "campaigns" / campaign_id
    match._append_jsonl_fsync(
        campaign / "logs" / "events.jsonl",
        {
            "event_type": "session_ending",
            "kind": "cliffhanger",
            "scene_id": "scene-1",
            "summary": "previous session boundary",
        },
    )
    player = tmp_path / "resumed-player"
    _write_scripted_player_runner(player, ["继续调查。", "再检查一次。"])
    keeper_calls = _install_keeper(monkeypatch, texts=["你继续调查。", "你查完了。"])

    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        max_turns=2,
        run_dir=tmp_path / "resumed-run",
    )

    assert len(result["turns"]) == 2
    assert len(keeper_calls) == 2
    assert result["stop_reason"] == "max_turns_reached"
    assert result["terminal_evidence"]["session_ending"] is False
    assert result["result"]["completion_receipts"]["conclusion"]["status"] == "missing"
    assert result["result"]["completion_receipts"]["scenario_concluded"] is False


def test_keeper_tool_and_roll_logs_are_projected_once_into_report(
    tmp_path, monkeypatch,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    campaign = workspace / ".coc" / "campaigns" / campaign_id
    player = tmp_path / "roll-player"
    _write_scripted_player_runner(player, ["我仔细检查锁眼。"])

    def mutate(_request, _index):
        match._append_jsonl_fsync(
            campaign / "logs" / "toolbox-calls.jsonl",
            {
                "tool": "rules.roll",
                "decision_id": "turn-roll-1",
                "ok": True,
            },
        )
        match._append_jsonl_fsync(
            campaign / "logs" / "rolls.jsonl",
            {
                "event_type": "roll",
                "type": "roll",
                "roll_id": "fixture-roll-1",
                "actor": investigator_id,
                "visibility": "public",
                "source": "keeper_toolbox",
                "source_ref": "logs/rolls.jsonl#fixture-roll-1",
                "payload": {
                    "roll_id": "fixture-roll-1",
                    "skill": "Spot Hidden",
                    "roll": 22,
                    "effective_target": 60,
                    "difficulty": "regular",
                    "outcome": "success",
                },
            },
        )
        world_path = campaign / "save" / "world-state.json"
        world = json.loads(world_path.read_text(encoding="utf-8"))
        world["discovered_clue_ids"] = ["c1"]
        _write_json(world_path, world)

    _install_keeper(monkeypatch, texts=["你在锁眼里发现了新鲜木屑。"], mutation=mutate)
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        max_turns=1,
        run_dir=tmp_path / "roll-run",
    )

    turn = result["turns"][0]
    assert [row["tool"] for row in turn["tool_calls"]] == ["rules.roll"]
    assert [row["roll_id"] for row in turn["rule_results"]] == ["fixture-roll-1"]
    assert turn["clue_revealed"] == ["c1"]
    report = Path(result["battle_report_path"]).read_text(encoding="utf-8")
    assert report.count("[roll-id: fixture-roll-1]") == 1
    completeness = json.loads(
        (Path(result["run_dir"]) / "artifacts" / "report-completeness.json")
        .read_text(encoding="utf-8")
    )
    assert completeness["passed"] is True


def test_unknown_action_is_owned_by_keeper_without_fixed_grounding_gate(
    tmp_path, monkeypatch,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    player = tmp_path / "off-design-player"
    _write_scripted_player_runner(player, ["我现在乘火箭去月球。"])
    calls = _install_keeper(monkeypatch, texts=["你眼下没有这样的交通手段。"])

    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        max_turns=1,
        resolve_player_actions=True,
        run_dir=tmp_path / "off-design-run",
    )

    assert calls[0]["player_input"] == "我现在乘火箭去月球。"
    assert result["turns"][0]["narration"]["final_text"] == (
        "你眼下没有这样的交通手段。"
    )
    partial = _read_jsonl(Path(result["run_dir"]) / "partial-transcript.jsonl")
    assert partial[0]["grounding_receipt"]["guard_applied"] is False


def test_live_match_rehydrates_manual_transcript_tail(tmp_path, monkeypatch):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    player = tmp_path / "tail-player"
    _write_scripted_player_runner(player, ["我接着检查刚才的门缝。"])
    prior_tail = [
        {"role": "player", "text": "我检查105号门。"},
        {"role": "keeper", "text": "门缝内侧留着一道新鲜刮痕。"},
    ]
    calls = _install_keeper(monkeypatch)

    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        max_turns=1,
        initial_transcript_tail=prior_tail,
        initial_narration=prior_tail[-1]["text"],
        run_dir=tmp_path / "tail-run",
    )

    assert result["player_requests"][0]["transcript_tail"] == prior_tail
    assert result["player_requests"][0]["narration"] == prior_tail[-1]["text"]
    assert calls[0]["transcript_tail"][-3:] == [
        *prior_tail,
        {"role": "player", "text": "我接着检查刚才的门缝。"},
    ]


def test_resume_run_builds_cumulative_transcript_and_invocation_chain(
    tmp_path, monkeypatch,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    first_player = tmp_path / "first-player"
    second_player = tmp_path / "second-player"
    _write_scripted_player_runner(first_player, ["我检查门锁。"])
    _write_scripted_player_runner(second_player, ["我继续检查门轴。"])

    _install_keeper(monkeypatch, texts=["锁眼里有新鲜木屑。"])
    first = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=first_player,
        max_turns=1,
        run_dir=tmp_path / "first-run",
    )
    second_calls = _install_keeper(monkeypatch, texts=["门轴刚上过油。"])
    second = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=second_player,
        max_turns=1,
        run_dir=tmp_path / "second-run",
        resume_run_dir=first["run_dir"],
    )

    first_run_id = first["metadata"]["run_id"]
    second_run_id = second["metadata"]["run_id"]
    assert first_run_id != second_run_id
    assert second["metadata"]["cumulative_run_ids"] == [
        first_run_id,
        second_run_id,
    ]
    assert second["metadata"]["continuation_of"] == first_run_id
    assert second["metadata"]["transcript_scope"] == "campaign_cumulative"
    assert second["player_requests"][0]["transcript_tail"][-2:] == [
        {"role": "player", "text": "我检查门锁。"},
        {"role": "keeper", "text": "锁眼里有新鲜木屑。"},
    ]
    assert second_calls[0]["transcript_tail"][-1] == {
        "role": "player",
        "text": "我继续检查门轴。",
    }
    transcript = _read_jsonl(Path(second["run_dir"]) / "transcript.jsonl")
    transcript_text = [row.get("text") for row in transcript]
    for expected in ("我检查门锁。", "锁眼里有新鲜木屑。", "我继续检查门轴。", "门轴刚上过油。"):
        assert expected in transcript_text
    invocations = _read_jsonl(Path(second["run_dir"]) / "runner-invocations.jsonl")
    assert len(invocations) == 4
    assert [row["attempt"] for row in invocations if row["role"] == "player"] == [1, 2]
    assert [row["attempt"] for row in invocations if row["role"] == "narrator"] == [1, 2]
    driver = json.loads(
        (Path(second["run_dir"]) / "driver-result.json").read_text(encoding="utf-8")
    )
    assert len(driver["turns"]) == 2


def test_distinct_same_basename_artifacts_get_distinct_run_ids_with_resume(
    tmp_path, monkeypatch,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    first_player = tmp_path / "same-name-first-player"
    second_player = tmp_path / "same-name-second-player"
    _write_scripted_player_runner(first_player, ["我检查门锁。"])
    _write_scripted_player_runner(second_player, ["我继续检查门轴。"])

    _install_keeper(monkeypatch, texts=["锁眼里有新鲜木屑。"])
    first = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=first_player,
        max_turns=1,
        run_dir=tmp_path / "parent-a" / "same-run",
    )
    second_calls = _install_keeper(monkeypatch, texts=["门轴刚上过油。"])
    second = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=second_player,
        max_turns=1,
        run_dir=tmp_path / "parent-b" / "same-run",
        resume_run_dir=first["run_dir"],
    )

    first_run_id = first["metadata"]["run_id"]
    second_run_id = second["metadata"]["run_id"]
    assert first_run_id != second_run_id
    assert second["metadata"]["cumulative_run_ids"] == [
        first_run_id,
        second_run_id,
    ]
    assert [row["run_id"] for row in second_calls] == [second_run_id]


def test_distinct_same_basename_nonresume_artifacts_do_not_alias_run_id(
    tmp_path, monkeypatch,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    player = tmp_path / "same-basename-nonresume-player"
    _write_scripted_player_runner(player, ["我检查门锁。", "我检查门轴。"])
    _install_keeper(monkeypatch)

    first = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        max_turns=1,
        run_dir=tmp_path / "left" / "same-run",
    )
    second = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        max_turns=1,
        run_dir=tmp_path / "right" / "same-run",
    )

    assert first["metadata"]["run_id"] != second["metadata"]["run_id"]


def test_artifact_run_identity_reentry_reuses_atomic_persisted_id(tmp_path):
    run_dir = tmp_path / "artifact"
    run_dir.mkdir()

    first = match._ensure_artifact_run_identity(run_dir, "campaign-a")
    second = match._ensure_artifact_run_identity(run_dir, "campaign-a")

    assert first == second
    assert first.startswith("coc-run-v1:")


def test_concurrent_artifact_identity_reentry_converges_on_one_id(tmp_path):
    run_dir = tmp_path / "concurrent-artifact"

    with ThreadPoolExecutor(max_workers=8) as pool:
        run_ids = list(pool.map(
            lambda _index: match._ensure_artifact_run_identity(
                run_dir, "campaign-a"
            ),
            range(16),
        ))

    assert len(set(run_ids)) == 1
    persisted = json.loads((run_dir / "run-identity.json").read_text())
    assert persisted["run_id"] == run_ids[0]


def test_resume_rejects_current_identity_already_in_prior_chain_before_keeper(
    tmp_path, monkeypatch,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    player = tmp_path / "identity-collision-player"
    _write_scripted_player_runner(player, ["我检查门锁。"])
    _install_keeper(monkeypatch)
    first = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        max_turns=1,
        run_dir=tmp_path / "prior" / "run",
    )
    current = tmp_path / "current" / "run"
    current.mkdir(parents=True)
    (current / "run-identity.json").write_bytes(
        (Path(first["run_dir"]) / "run-identity.json").read_bytes()
    )
    calls = _install_keeper(monkeypatch)

    with pytest.raises(match.RunIdentityError) as exc_info:
        match.run_live_match(
            workspace,
            campaign_id,
            investigator_id,
            player_runner=player,
            max_turns=1,
            run_dir=current,
            resume_run_dir=first["run_dir"],
        )

    assert exc_info.value.code == "run_identity_conflict"
    assert calls == []


def test_default_run_directory_allocation_survives_concurrent_name_collision(
    tmp_path,
):
    parent = tmp_path / "playtests"

    with ThreadPoolExecutor(max_workers=8) as pool:
        paths = list(pool.map(
            lambda _index: match._allocate_default_run_dir(
                parent, stamp="20260716T120000Z"
            ),
            range(16),
        ))

    assert len({path.resolve() for path in paths}) == 16
    assert all(path.is_dir() for path in paths)


def test_resume_helpers_ignore_system_rows_and_renumber_append():
    prior = [
        {"turn": 1, "role": "player_simulator", "text": "我检查门锁。"},
        {"turn": 2, "role": "keeper_under_test", "text": "锁眼里有木屑。"},
        {"turn": 3, "role": "system", "text": "Spot Hidden 22"},
    ]
    tail, narration = match._resume_tail_from_transcript(prior, limit=6)
    assert tail == [
        {"role": "player", "text": "我检查门锁。"},
        {"role": "keeper", "text": "锁眼里有木屑。"},
    ]
    assert narration == "锁眼里有木屑。"
    current = [
        {"turn": 1, "role": "player_simulator", "text": "我继续。"},
        {"turn": 2, "role": "keeper_under_test", "text": "门开了。"},
    ]
    assert [row["turn"] for row in match._renumber_appended_rows(prior, current)] == [
        1, 2, 3, 4, 5,
    ]


def test_player_request_routes_distinct_personas_without_keeper_fields(tmp_path):
    workspace, campaign_id, _investigator_id = _build_workspace(
        tmp_path, with_secrets=True
    )
    common = {
        "narration": "雨水沿着门框滴落。",
        "character_card": {"id": "inv1"},
        "transcript_tail": [],
    }
    careful = match.build_player_request(
        workspace,
        campaign_id,
        persona_id="careful_investigator",
        persona_prompt_directives=["先观察并交叉验证。"],
        **common,
    )
    reckless = match.build_player_request(
        workspace,
        campaign_id,
        persona_id="reckless_investigator",
        persona_prompt_directives=["立即行动。"],
        **common,
    )

    assert careful["persona_prompt_directives"] != reckless["persona_prompt_directives"]
    encoded = json.dumps([careful, reckless], ensure_ascii=False)
    assert "keeper_secret" not in encoded
    assert all(secret not in encoded for secret in SECRET_PROSE_FRAGMENTS)


def test_player_visible_opening_never_reads_private_scene_summary(tmp_path):
    campaign = tmp_path / "campaign"
    _write_json(
        campaign / "save" / "active-scene.json",
        {"summary": "PRIVATE PLAN", "dramatic_question": "PRIVATE QUESTION"},
    )
    _write_json(
        campaign / "scenario" / "scenario.json",
        {"opening_scene": {"summary": "PRIVATE OPENING"}},
    )
    narration = match.player_visible_narration(None, campaign)
    assert narration == "场景开始。你站在可调查的现场。"
    assert "PRIVATE" not in narration


def test_fresh_haunting_uses_player_safe_commission_opening(tmp_path):
    workspace = tmp_path / "fresh-workspace"
    quick = match.coc_starter.quick_start(
        workspace,
        "the-haunting",
        "thomas-hayes",
        campaign_id="fresh-haunting",
    )
    campaign = workspace / ".coc" / "campaigns" / quick["campaign_id"]
    assert match.player_visible_narration(None, campaign) == (
        "调查员会接受 Knott 的委托，并决定先从哪里着手调查吗？"
    )


def test_player_character_view_is_complete_owned_card_with_current_vitals(tmp_path):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    campaign = workspace / ".coc" / "campaigns" / campaign_id
    card = {
        "schema_version": 1,
        "id": investigator_id,
        "name": "Ada",
        "occupation": "Detective",
        "characteristics": {"STR": 50, "POW": 65, "keeper_secret": 99},
        "derived": {"HP": 99, "SAN": 99, "MP": 99, "MOV": 8},
        "skills": {f"Skill {index}": index for index in range(1, 19)},
        "weapons": [
            {"name": ".38", "skill": "Handgun", "damage": "1D10", "secret": "x"}
        ],
        "equipment": ["flashlight", {"name": "lockpicks", "keeper_note": "x"}],
        "backstory": {
            "scenario_id": "the-haunting",
            "scenario_bound": {"description": "Knott hired me", "keeper_secret": "x"},
            "traits": ["cautious"],
        },
        "notes": "report-only note",
        "clue_graph": {"secret": True},
        "npc_agendas": ["secret"],
    }

    view = match.build_player_character_view(card, campaign, investigator_id)
    assert len(view["skills"]) == 18
    assert view["derived"] == {"HP": 12, "SAN": 55, "MP": 11, "MOV": 8}
    assert view["weapons"][0] == {
        "name": ".38",
        "skill": "Handgun",
        "damage": "1D10",
    }
    encoded = json.dumps(view, ensure_ascii=False)
    for forbidden in (
        "keeper_secret",
        "keeper_note",
        "clue_graph",
        "npc_agendas",
        "report-only note",
        "scenario_id",
    ):
        assert forbidden not in encoded


def test_completion_receipts_require_structured_ending_combat_and_reward(tmp_path):
    campaign = tmp_path / "campaign"
    logs = campaign / "logs"
    logs.mkdir(parents=True)
    story = {"scenes": [{"scene_id": "ending", "is_final": True, "scene_edges": []}]}
    world = {"active_scene_id": "ending"}
    terminal = {
        "reached_terminal": True,
        "active_scene_id": "ending",
        "graph_terminal": True,
        "session_ending": False,
    }
    (logs / "events.jsonl").write_text("", encoding="utf-8")
    missing = match.build_completion_receipts(
        campaign,
        story_graph=story,
        world_state=world,
        terminal_evidence=terminal,
        scenario_id="the-haunting",
    )
    assert missing["complete"] is False

    events = [
        {
            "type": "session_ending",
            "decision_id": "older-partial-ending",
        },
        {
            "event_type": "combat_ended",
            "decision_id": "combat-1",
            "combat_id": "fight-1",
            "outcome": "investigators_win",
        },
        {
            "event_type": "reward",
            "decision_id": "reward-1",
            "source": "conclusion_rewards",
            "reward_kind": "sanity",
            "roll_id": "reward-roll-1",
        },
        {
            "type": "session_ending",
            "decision_id": "ending-1",
            "scene_id": "ending",
            "scenario_id": "the-haunting",
        },
    ]
    (logs / "events.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in events), encoding="utf-8"
    )
    terminal["session_ending"] = True
    complete = match.build_completion_receipts(
        campaign,
        story_graph=story,
        world_state=world,
        terminal_evidence=terminal,
        scenario_id="the-haunting",
    )
    assert complete["complete"] is True
    assert all(
        complete[kind]["status"] == "complete"
        for kind in ("session_ending", "combat", "conclusion", "reward")
    )
    assert complete["combat"]["source_event_type"] == "combat_ended"
    assert complete["session_ending"]["source_ref"].endswith("line-4")

    events.append({
        "event_type": "session_ending",
        "kind": "cliffhanger",
        "scene_id": "ending",
        "scenario_id": "the-haunting",
    })
    (logs / "events.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in events), encoding="utf-8"
    )
    cliffhanger = match.build_completion_receipts(
        campaign,
        story_graph=story,
        world_state=world,
        terminal_evidence=terminal,
        scenario_id="the-haunting",
    )
    assert cliffhanger["session_ending"]["kind"] == "cliffhanger"
    assert cliffhanger["conclusion"]["status"] == "missing"
    assert cliffhanger["scenario_concluded"] is False
    assert cliffhanger["complete"] is False


@pytest.mark.parametrize("live", [False, True])
def test_live_claim_cannot_make_untrusted_player_evidence_eligible(
    tmp_path, monkeypatch, live,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    player = tmp_path / f"untrusted-player-{live}"
    _write_scripted_player_runner(player, ["我环顾四周。"])
    _install_keeper(monkeypatch)
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        max_turns=1,
        live=live,
        run_dir=tmp_path / f"evidence-{live}",
    )
    metadata = result["metadata"]
    assert metadata["user_claimed_live"] is live
    assert metadata["eligible_as_gameplay_evidence"] is False
    assert "untrusted_player_runner_used" in metadata["evidence_reasons"]
    assert (Path(result["run_dir"]) / "evidence.json").is_file()


def test_fake_runner_provenance_cannot_forge_trust(tmp_path, monkeypatch):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    player = tmp_path / "forged-player"
    _write_scripted_player_runner(
        player,
        ["我假装调用了外部模型。"],
        model_identity={"provider": "forged", "id": "fake-model"},
        response_mode="tool",
    )
    digest = hashlib.sha256(player.read_bytes()).hexdigest()
    forged = {
        "kind": "external_model_bridge",
        "identity": "forged-player@999",
        "turn_count": 999,
        "attestation": {
            "method": "runner_sha256",
            "subject_identity": "forged-player@999",
            "runner_sha256": digest,
        },
    }
    keeper_calls = _install_keeper(monkeypatch)
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        max_turns=1,
        live=True,
        evidence_provenance={"player_runner": forged},
        run_dir=tmp_path / "forged-run",
    )
    assert result["metadata"]["eligible_as_gameplay_evidence"] is False
    assert result["evidence"]["external_model_turns"] <= 1


def test_evidence_receipt_exists_before_battle_report_generation(
    tmp_path, monkeypatch,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    player = tmp_path / "report-player"
    _write_scripted_player_runner(player, ["我环顾四周。"])
    _install_keeper(monkeypatch)
    original = match.playtest_report.generate_battle_report
    observed: list[Path] = []

    def guarded_generate(run_dir):
        evidence = Path(run_dir) / "evidence.json"
        assert evidence.is_file()
        observed.append(evidence)
        return original(run_dir)

    monkeypatch.setattr(match.playtest_report, "generate_battle_report", guarded_generate)
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        max_turns=1,
        run_dir=tmp_path / "report-run",
    )
    assert observed == [Path(result["run_dir"]) / "evidence.json"]


def test_invocation_ledger_replaces_symlink_without_touching_target(tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "transcript.jsonl").write_text(
        json.dumps({"turn": 1, "role": "player_simulator", "text": "look"}) + "\n",
        encoding="utf-8",
    )
    outside = tmp_path / "outside.jsonl"
    outside.write_text("outside sentinel\n", encoding="utf-8")
    output = run_dir / "runner-invocations.jsonl"
    output.symlink_to(outside)

    written = match._write_invocation_ledger(
        run_dir, [{"role": "player", "attempt": 1}]
    )
    assert outside.read_text(encoding="utf-8") == "outside sentinel\n"
    assert written.is_file() and not written.is_symlink()
    assert json.loads(written.read_text(encoding="utf-8"))["transcript_turn"] == 1


def test_operator_mode_uses_operator_player_and_remains_review_pending(
    tmp_path, monkeypatch,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    observed: list[dict] = []

    def operator_provider(request):
        observed.append(request)
        return {
            "ok": True,
            "player_text": "我检查眼前的痕迹。",
            "response_mode": "operator_jsonl",
        }

    monkeypatch.setattr(
        match.player_adapter,
        "player_send_turn",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("operator mode must not call the AI player adapter")
        ),
    )
    keeper_calls = _install_keeper(monkeypatch)
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=None,
        operator_long_play=True,
        operator_player_provider=operator_provider,
        max_turns=1,
        run_dir=tmp_path / "operator-run",
    )
    assert len(observed) == 1
    assert result["metadata"]["operator_review_status"] == "pending"
    assert result["metadata"]["eligible_as_gameplay_evidence"] is False
    assert "operator_review_required" in result["metadata"]["evidence_reasons"]
    assert result["metadata"]["operator_contract"]["model_call_boundary"][
        "kp_keeper_agent"
    ] == "single_pass_production_model_under_test"
    assert keeper_calls[0]["run_policy"] == "continue_until_scenario_terminal"


def test_keeper_failure_stops_without_template_or_background_fallback(
    tmp_path, monkeypatch,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    player = tmp_path / "failure-player"
    _write_scripted_player_runner(player, ["我检查现场。"])
    _install_keeper(monkeypatch, error="fixture keeper failure")
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        max_turns=2,
        run_dir=tmp_path / "failure-run",
    )
    assert result["stop_reason"] == "keeper_turn_failed"
    assert result["turns"] == []
    assert _read_jsonl(Path(result["run_dir"]) / "partial-transcript.jsonl") == []
    invocations = _read_jsonl(Path(result["run_dir"]) / "runner-invocations.jsonl")
    assert invocations[-1]["outcome"] == "runner_failure"
    assert invocations[-1]["failure"]["class"] == "runner_failure"


@pytest.mark.parametrize(
    ("state_patch", "expected_status"),
    [
        ({"current_hp": 0, "conditions": ["unconscious"]}, "unconscious"),
        ({"conditions": ["dying"]}, "dying"),
        ({"conditions": ["stabilized"]}, "stabilized"),
        ({"conditions": ["dead"]}, "dead"),
        ({"bout_active": True}, "temporarily_unplayable"),
        ({"permanently_insane": True}, "permanently_unplayable"),
    ],
)
def test_structured_playability_pauses_before_player_or_keeper_turn(
    tmp_path, monkeypatch, state_patch, expected_status,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    campaign = workspace / ".coc" / "campaigns" / campaign_id
    state_path = campaign / "save" / "investigator-state" / f"{investigator_id}.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update(state_patch)
    _write_json(state_path, state)
    player = tmp_path / f"paused-{expected_status}"
    _write_scripted_player_runner(player, ["不应执行。"])
    keeper_calls = _install_keeper(monkeypatch)

    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        max_turns=1,
        run_dir=tmp_path / f"paused-run-{expected_status}",
    )
    assert result["investigator_playability"]["status"] == expected_status
    assert result["result"]["player_turn_count"] == 0
    assert keeper_calls == []
    if expected_status == "dead":
        assert result["investigator_playability"]["terminal"] is True
    else:
        assert result["result"]["reached_terminal"] is False


def test_underlying_insanity_without_active_bout_remains_player_controlled(tmp_path):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    campaign = workspace / ".coc" / "campaigns" / campaign_id
    state_path = campaign / "save" / "investigator-state" / f"{investigator_id}.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update({"temporary_insane": True, "indefinite_insane": True})
    _write_json(state_path, state)
    assert match.investigator_playability(campaign, investigator_id) == {
        "status": "active",
        "playable": True,
        "terminal": False,
    }
