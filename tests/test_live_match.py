"""Tests for coc_live_match: bridged player LLM vs KP match harness (N5)."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import random
import stat
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_live_match.py"
CANONICAL_PLAYER_RUNNER = REPO / "runtime" / "adapters" / "player" / "run_player_turn.mjs"
CANONICAL_NARRATOR_RUNNER = REPO / "runtime" / "adapters" / "narrator" / "run_narration.mjs"

# Distinct keeper-side prose that must never appear in player-brain requests.
SECRET_PROSE_FRAGMENTS = [
    "STR 100 CON 100 DEX 15 INT 25 POW 30; HP 100; tentacle slash",
    "probes and discards humans out of curiosity about these fragile successors",
    "White Friday disaster kills ~10,000; only the attribution of blame varies",
    "keeper-only shaft map coordinates 46.5N 12.1E under the ice seal",
]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


match = _load("coc_live_match", SCRIPT)


def _write_scripted_player_runner(
    path: Path,
    lines: list[str],
    *,
    intent_classes: list[str] | None = None,
    model_identity: dict | None = None,
    response_mode: str | None = None,
) -> None:
    """Stateful fake runner: emit scripted player_text lines in order.

    When ``intent_classes`` is provided, each turn's response includes that
    structured ``intent_class`` (player-brain semantic evidence).
    """
    lines_literal = json.dumps(lines, ensure_ascii=False)
    intents_repr = repr(intent_classes)
    model_repr = repr(model_identity)
    response_mode_repr = repr(response_mode)
    script = f"""#!/usr/bin/env python3
import json, sys
from pathlib import Path
state_path = Path(__file__).with_suffix(".state")
lines = {lines_literal}
intent_classes = {intents_repr}
model_identity = {model_repr}
response_mode = {response_mode_repr}
idx = int(state_path.read_text()) if state_path.exists() else 0
req = json.loads(sys.stdin.read())
assert "public_state" in req and "character_card" in req
text = lines[min(idx, len(lines) - 1)]
state_path.write_text(str(idx + 1))
out = {{"ok": True, "player_text": text, "player_notes": f"note-for-turn-{{idx+1}}"}}
if intent_classes is not None:
    out["intent_class"] = intent_classes[min(idx, len(intent_classes) - 1)]
if model_identity is not None:
    out["model_identity"] = model_identity
if response_mode is not None:
    out["response_mode"] = response_mode
sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\\n")
"""
    path.write_text(script, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _build_workspace(tmp_path: Path, *, with_secrets: bool = False) -> tuple[Path, str, str]:
    """Workspace layout matching runtime (.coc/campaigns + investigators)."""
    workspace = tmp_path / "ws"
    campaign_id = "match-drive"
    investigator_id = "inv1"
    camp = workspace / ".coc" / "campaigns" / campaign_id
    scn = camp / "scenario"
    save = camp / "save"
    save.mkdir(parents=True)
    (save / "investigator-state").mkdir()
    scn.mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    (workspace / ".coc" / "runtime.json").write_text(
        json.dumps({"schema_version": 1, "brain": "debug"}),
        encoding="utf-8",
    )
    (camp / "campaign.json").write_text(
        json.dumps(
            {
                "campaign_id": campaign_id,
                "title": "Match Drive Campaign",
                "scenario_id": "match-drive",
                "era": "1920s",
                "dice_mode": "codex",
                "spoiler_policy": "warn_before_reveal",
                "play_language": "zh-Hans",
            }
        ),
        encoding="utf-8",
    )
    (save / "world-state.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "campaign_id": campaign_id,
                "active_scene_id": "scene-1",
                "discovered_clue_ids": [],
                "major_decisions": [],
            }
        ),
        encoding="utf-8",
    )
    (save / "pacing-state.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "tension_level": "low",
                "lethal_chances_used": 0,
                "recent_intent_classes": [],
                "turn_number": 0,
                "luck_spent_last": 0,
            }
        ),
        encoding="utf-8",
    )
    (save / "flags.json").write_text(
        json.dumps({"schema_version": 1, "clues_found": {}, "decisions": []}),
        encoding="utf-8",
    )
    (save / "investigator-state" / f"{investigator_id}.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "campaign_id": campaign_id,
                "investigator_id": investigator_id,
                "current_hp": 12,
                "current_san": 55,
                "current_mp": 11,
                "conditions": [],
                "skill_checks_earned": [],
            }
        ),
        encoding="utf-8",
    )
    char_dir = workspace / ".coc" / "investigators" / investigator_id
    char_dir.mkdir(parents=True)
    (char_dir / "character.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "id": investigator_id,
                "occupation": "Antiquarian",
                "era": "1920s",
                "characteristics": {"APP": 45, "LUCK": 55},
                "derived": {"HP": 12, "SAN": 55},
                "skills": {
                    "Credit Rating": 50,
                    "Spot Hidden": 60,
                    "Library Use": 55,
                },
                "backstory": {},
            }
        ),
        encoding="utf-8",
    )
    (scn / "story-graph.json").write_text(
        json.dumps(
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
                    {
                        "scene_id": "scene-3",
                        "available_clues": ["c3"],
                        "dramatic_question": "q3",
                        "entry_conditions": [],
                        "exit_conditions": [],
                        "tone": ["tense"],
                        "allowed_improvisation": [],
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    (scn / "clue-graph.json").write_text(
        json.dumps(
            {
                "conclusions": [
                    {
                        "conclusion_id": "cc1",
                        "importance": "critical",
                        "minimum_routes": 3,
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
                            {
                                "clue_id": "c3",
                                "delivery": "z",
                                "delivery_kind": "environmental",
                                "visibility": "player-safe",
                            },
                        ],
                        "fallback_policy": "",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    secrets = []
    if with_secrets:
        secrets = [
            (
                "secret-polyp-horror-full-stat-block: STR 100 CON 100 DEX 15 INT 25 POW 30; "
                "HP 100; tentacle slash 60% Lethality 50%."
            ),
            (
                "secret-entity-motive-is-curiosity: the Polyp Horror probes and discards "
                "humans out of curiosity about these fragile successors to the Great Race."
            ),
            (
                "secret-white-friday-is-inevitable: regardless of the patrol's choices, on "
                "13 December 1916 the White Friday disaster kills ~10,000; only the "
                "attribution of blame varies."
            ),
            (
                "secret-shaft-map: keeper-only shaft map coordinates 46.5N 12.1E under the ice seal"
            ),
        ]
    (scn / "npc-agendas.json").write_text(
        json.dumps(
            {
                "npcs": [
                    {
                        "npc_id": "npc-guide",
                        "name": "向导",
                        "agenda": "hide the shaft",
                        "secret": secrets[0] if secrets else "",
                        "keeper_notes": secrets[3] if len(secrets) > 3 else "",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    (scn / "threat-fronts.json").write_text(json.dumps({"fronts": []}), encoding="utf-8")
    (scn / "pacing-map.json").write_text(
        json.dumps(
            {
                "pacing_curve": [
                    {"scene_id": "scene-1", "tension_target": "low", "horror_stage": "ordinary"},
                    {"scene_id": "scene-2", "tension_target": "medium", "horror_stage": "wrongness"},
                    {"scene_id": "scene-3", "tension_target": "high", "horror_stage": "revelation"},
                ]
            }
        ),
        encoding="utf-8",
    )
    (scn / "improvisation-boundaries.json").write_text(
        json.dumps(
            {
                "invent_allowed": [],
                "never_invent": [],
                "keeper_secrets": secrets or ["secret-1"],
            }
        ),
        encoding="utf-8",
    )
    (scn / "module-meta.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "scenario_id": "match-drive",
                "structure_type": "linear_acts",
                "era": "1920s",
                "content_flags": [],
                "win_condition": "x",
            }
        ),
        encoding="utf-8",
    )
    if with_secrets and secrets:
        # Also bury secret prose in story-graph summary (keeper-facing).
        story = json.loads((scn / "story-graph.json").read_text(encoding="utf-8"))
        story["scenes"][0]["keeper_summary"] = secrets[1]
        story["scenes"][0]["secret_outcome"] = secrets[2]
        (scn / "story-graph.json").write_text(json.dumps(story), encoding="utf-8")
    return workspace, campaign_id, investigator_id


def test_scripted_match_runs_three_plus_turns_end_to_end(tmp_path):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    runner = tmp_path / "scripted_player"
    _write_scripted_player_runner(
        runner,
        [
            "我搜查场景一的痕迹。",
            "我继续跟进刚才发现的线索。",
            "我检查下一个可调查的方向。",
            "我再仔细看一遍现场。",
        ],
    )
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=runner,
        max_turns=3,
        rng_seed=42,
        live=False,
        intent_class="investigate",
    )
    assert len(result["turns"]) >= 3
    assert result["metadata"]["runner_kind"] == "unknown"
    assert result["metadata"]["simulation_method"] == "unattested_runner_match_not_gameplay_evidence"
    assert result["battle_report_path"]
    battle = Path(result["battle_report_path"]).read_text(encoding="utf-8")
    assert "我搜查场景一的痕迹" in battle or "实际跑团" in battle
    # player_notes captured for the report path
    assert any(t.get("player_notes") for t in result["player_turns"])


def test_metadata_honesty_live_false_is_not_gameplay_evidence(tmp_path):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    runner = tmp_path / "scripted_player"
    _write_scripted_player_runner(runner, ["我环顾四周。"])
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=runner,
        max_turns=1,
        rng_seed=7,
        live=False,
        intent_class="investigate",
    )
    meta = result["metadata"]
    assert meta["user_claimed_live"] is False
    assert "live" not in meta
    assert meta["runner_kind"] == "unknown"
    assert meta["simulation_method"] == "unattested_runner_match_not_gameplay_evidence"
    assert meta["player_profile"] != "external_llm_bridge"
    assert "never gameplay evidence" in meta["evidence_disclaimer"].lower()
    assert meta["eligible_as_gameplay_evidence"] is False
    playtest = json.loads(
        (Path(result["run_dir"]) / "playtest.json").read_text(encoding="utf-8")
    )
    assert playtest["simulation_method"] == "unattested_runner_match_not_gameplay_evidence"
    assert playtest["runner_kind"] == "unknown"
    assert playtest["eligible_as_gameplay_evidence"] is False
    assert (Path(result["run_dir"]) / "evidence.json").is_file()


def test_live_flag_cannot_make_scripted_runner_evidence_eligible(tmp_path):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    runner = tmp_path / "scripted_player"
    _write_scripted_player_runner(runner, ["我环顾四周。"])
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=runner,
        max_turns=1,
        rng_seed=7,
        live=True,
        intent_class="investigate",
    )
    meta = result["metadata"]
    assert meta["user_claimed_live"] is True
    assert "live" not in meta
    assert meta["eligible_as_gameplay_evidence"] is False
    assert "untrusted_player_runner_used" in meta["evidence_reasons"]
    assert meta["runner_kind"] == "unknown"


def test_evidence_receipt_exists_before_battle_report_generation(tmp_path, monkeypatch):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    runner = tmp_path / "scripted_player"
    _write_scripted_player_runner(runner, ["我环顾四周。"])
    assert hasattr(match, "playtest_report"), "live match must expose its report generator"
    original = match.playtest_report.generate_battle_report
    observed = []

    def guarded_generate(run_dir):
        evidence_path = Path(run_dir) / "evidence.json"
        assert evidence_path.is_file()
        observed.append(evidence_path)
        return original(run_dir)

    monkeypatch.setattr(match.playtest_report, "generate_battle_report", guarded_generate)
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=runner,
        max_turns=1,
        rng_seed=7,
        live=True,
        intent_class="investigate",
    )

    assert observed == [Path(result["run_dir"]) / "evidence.json"]


def _patch_observed_canonical_player(monkeypatch):
    def send_turn(_request, *, runner_path, timeout_s):
        assert Path(runner_path).resolve() == CANONICAL_PLAYER_RUNNER.resolve()
        return {
            "ok": True,
            "player_text": "我检查眼前最明显的痕迹。",
            "intent_class": "investigate",
            "model_identity": {"provider": "fixture", "id": "trusted-player-model"},
            "response_mode": "tool",
        }

    monkeypatch.setattr(match.player_adapter, "player_send_turn", send_turn)


def _run_canonical_player_match(
    tmp_path,
    monkeypatch,
    *,
    max_turns=1,
    narrator_runner=None,
    evidence_provenance=None,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    _patch_observed_canonical_player(monkeypatch)
    return match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=CANONICAL_PLAYER_RUNNER,
        narrator_runner=narrator_runner,
        max_turns=max_turns,
        rng_seed=23,
        live=True,
        intent_class=None,
        evidence_provenance=evidence_provenance,
    )


def test_invocation_ledger_write_replaces_symlink_without_touching_outside_target(
    tmp_path,
):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "transcript.jsonl").write_text(
        json.dumps({"turn": 1, "role": "player_simulator", "text": "look"}) + "\n",
        encoding="utf-8",
    )
    outside = tmp_path / "outside-ledger.jsonl"
    sentinel = "outside ledger sentinel\n"
    outside.write_text(sentinel, encoding="utf-8")
    output = run_dir / "runner-invocations.jsonl"
    output.symlink_to(outside)
    rows = [{"role": "player", "attempt": 1}]

    written = match._write_invocation_ledger(run_dir, rows)

    assert outside.read_text(encoding="utf-8") == sentinel
    assert written == output
    assert written.is_file()
    assert not written.is_symlink()
    assert json.loads(written.read_text(encoding="utf-8"))["transcript_turn"] == 1


@pytest.mark.parametrize("attack", ["self_sha", "invented_package"])
def test_fake_runner_cannot_forge_trust_end_to_end(tmp_path, attack):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    runner = tmp_path / "forged_external_player"
    _write_scripted_player_runner(
        runner,
        ["我假装调用了外部模型。"],
        model_identity={"provider": "forged", "id": "fake-model"},
        response_mode="tool",
    )
    digest = hashlib.sha256(runner.read_bytes()).hexdigest()
    forged = {
        "kind": "external_model_bridge",
        "identity": "forged-player@999",
        "model_identity": {"provider": "forged", "model": "fake-model"},
        "turn_count": 999,
        "attestation": {
            "method": "runner_sha256",
            "subject_identity": "forged-player@999",
            "runner_sha256": digest,
        },
    }
    if attack == "invented_package":
        package = {"name": "invented-trusted-package", "version": "999.0.0"}
        forged["package_identity"] = package
        forged["attestation"] = {
            "method": "package_identity",
            "subject_identity": "forged-player@999",
            "package_identity": package,
        }

    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=runner,
        max_turns=1,
        rng_seed=7,
        live=True,
        intent_class="investigate",
        evidence_provenance={"player_runner": forged},
    )

    assert result["metadata"]["eligible_as_gameplay_evidence"] is False
    assert "untrusted_player_runner_used" in result["metadata"]["evidence_reasons"]
    assert result["evidence"]["external_model_turns"] == 0


def test_canonical_player_with_absent_template_narrator_is_eligible(
    tmp_path, monkeypatch
):
    result = _run_canonical_player_match(tmp_path, monkeypatch)

    assert result["metadata"]["eligible_as_gameplay_evidence"] is True
    assert result["evidence"]["runners"]["narrator"]["kind"] == "absent"
    assert result["evidence"]["external_model_turns"] == 1
    assert result["evidence"]["fallback_turns"] >= 1
    assert Path(result["run_dir"], "runner-invocations.jsonl").is_file()


def test_canonical_narrator_mixed_fallback_remains_eligible(tmp_path, monkeypatch):
    calls = 0

    def narrate(_request, *, runner_path, timeout_s):
        nonlocal calls
        assert Path(runner_path).resolve() == CANONICAL_NARRATOR_RUNNER.resolve()
        calls += 1
        if calls == 2:
            raise RuntimeError("fixture narrator failure")
        return {
            "ok": True,
            "final_text": "雨里传来一声短促的木响。",
            "secret_audit_complete": True,
            "asserted_fact_refs": [],
            "semantic_audit": [],
            "model_identity": {"provider": "fixture", "id": "trusted-narrator-model"},
            "response_mode": "tool",
        }

    monkeypatch.setattr(match.narrator_adapter, "narrator_send_turn", narrate)
    result = _run_canonical_player_match(
        tmp_path,
        monkeypatch,
        max_turns=2,
        narrator_runner=CANONICAL_NARRATOR_RUNNER,
    )

    assert result["metadata"]["eligible_as_gameplay_evidence"] is True
    assert result["evidence"]["fallback_turns"] == 1
    assert result["evidence"]["external_model_turns"] >= 3


def test_canonical_narrator_all_fallback_can_remain_eligible(tmp_path, monkeypatch):
    def fail(_request, *, runner_path, timeout_s):
        raise RuntimeError("fixture narrator failure")

    monkeypatch.setattr(match.narrator_adapter, "narrator_send_turn", fail)
    result = _run_canonical_player_match(
        tmp_path,
        monkeypatch,
        narrator_runner=CANONICAL_NARRATOR_RUNNER,
    )

    assert result["metadata"]["eligible_as_gameplay_evidence"] is True
    assert result["evidence"]["external_model_turns"] == 1
    assert result["evidence"]["fallback_turns"] >= 1


def test_live_match_missing_structured_secret_audit_uses_recorded_template_fallback(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(match.narrator_adapter, "narrator_send_turn", lambda *a, **k: {
        "ok": True, "final_text": "model prose without audit",
        "secret_audit_complete": False,
    })
    text, method, fallback, outcome = match._apply_narrator_or_template(
        template_text="safe template", projected={"decision_id": "d1"},
        live_turn={"narration_envelope": {
            "must_not_reveal": [{"id": "secret-a", "category": "keeper_secret"}]
        }}, campaign_dir=tmp_path, last_player_text="act", play_language="zh-Hans",
        recent_narrations=[], narrator_runner=CANONICAL_NARRATOR_RUNNER,
        timeout_s=1,
    )
    assert (text, method) == ("safe template", "template")
    assert fallback["error"] == "structured_secret_audit_failed"
    assert outcome["fallback_kind"] == "secret_audit"


@pytest.mark.parametrize("response", [
    {"ok": True, "final_text": "prose", "asserted_fact_refs": [],
     "semantic_audit": [], "response_mode": "tool"},
    {"ok": True, "final_text": "prose", "asserted_fact_refs": [],
     "semantic_audit": [], "secret_audit_complete": True,
     "response_mode": "prose_fallback"},
    {"ok": True, "final_text": "prose", "asserted_fact_refs": [],
     "semantic_audit": [], "secret_audit_complete": True},
])
def test_live_match_requires_explicit_complete_tool_audit(response, tmp_path, monkeypatch):
    monkeypatch.setattr(match.narrator_adapter, "narrator_send_turn", lambda *a, **k: response)
    text, method, fallback, outcome = match._apply_narrator_or_template(
        template_text="safe", projected={"decision_id": "d-explicit"},
        live_turn={"narration_envelope": {"must_not_reveal": []}},
        campaign_dir=tmp_path, last_player_text="act", play_language="zh-Hans",
        recent_narrations=[], narrator_runner=CANONICAL_NARRATOR_RUNNER, timeout_s=1,
    )
    assert (text, method) == ("safe", "template")
    assert fallback["error"] == "structured_secret_audit_failed"
    assert outcome["fallback_kind"] == "secret_audit"


def test_untrusted_narrator_output_disqualifies_evidence(tmp_path, monkeypatch):
    narrator = tmp_path / "forged_narrator"
    _write_scripted_narrator_runner(
        narrator,
        texts=["伪造的叙述。"],
        model_identity={"provider": "forged", "id": "fake-narrator"},
        response_mode="tool",
    )
    result = _run_canonical_player_match(
        tmp_path,
        monkeypatch,
        narrator_runner=narrator,
    )

    assert result["metadata"]["eligible_as_gameplay_evidence"] is False
    assert "untrusted_narrator_runner_used" in result["metadata"]["evidence_reasons"]


def test_forged_999_counts_are_replaced_by_hashed_invocation_ledger(
    tmp_path, monkeypatch
):
    result = _run_canonical_player_match(
        tmp_path,
        monkeypatch,
        evidence_provenance={
            "external_model_turns": 999,
            "fallback_turns": 999,
            "player_runner": {"turn_count": 999, "kind": "external_model_bridge"},
        },
    )

    assert result["metadata"]["eligible_as_gameplay_evidence"] is True
    assert result["evidence"]["external_model_turns"] == 1
    ledger = Path(result["run_dir"]) / "runner-invocations.jsonl"
    assert result["evidence"]["artifacts"]["invocation_ledger"]["sha256"] == hashlib.sha256(
        ledger.read_bytes()
    ).hexdigest()


def test_rehashed_999_row_ledger_fails_transcript_reconciliation(tmp_path, monkeypatch):
    result = _run_canonical_player_match(tmp_path, monkeypatch)
    run_dir = Path(result["run_dir"])
    ledger_path = run_dir / "runner-invocations.jsonl"
    rows = [json.loads(line) for line in ledger_path.read_text().splitlines() if line]
    player_row = next(row for row in rows if row["role"] == "player")
    forged_rows = [*rows, *[dict(player_row, attempt=100 + index) for index in range(998)]]
    ledger_path.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in forged_rows),
        encoding="utf-8",
    )
    receipt_path = run_dir / "evidence.json"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["external_model_turns"] = 999
    receipt["artifacts"]["invocation_ledger"]["sha256"] = hashlib.sha256(
        ledger_path.read_bytes()
    ).hexdigest()
    receipt_path.write_text(json.dumps(receipt), encoding="utf-8")

    validated = match.playtest_evidence.read_evidence_receipt(run_dir)

    assert validated["eligible_as_gameplay_evidence"] is False
    assert "invocation_transcript_mismatch" in validated["evidence_reasons"]


def test_spoiler_isolation_player_requests_exclude_keeper_secret_prose(tmp_path):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path, with_secrets=True)
    runner = tmp_path / "scripted_player"
    _write_scripted_player_runner(
        runner,
        ["我搜查现场。", "我继续调查。", "我再看一眼。"],
    )
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=runner,
        max_turns=3,
        rng_seed=11,
        live=False,
        intent_class="investigate",
    )
    assert result["player_requests"], "expected captured player requests"
    for req in result["player_requests"]:
        blob = json.dumps(req, ensure_ascii=False)
        for fragment in SECRET_PROSE_FRAGMENTS:
            assert fragment not in blob, f"secret prose leaked into player request: {fragment!r}"
        # Structural spoiler sources must not be present as top-level keys.
        assert "keeper_secrets" not in req
        assert "story_graph" not in req
        assert "clue_graph" not in req
        assert "npc_agendas" not in req
        assert "director_plan" not in req
        assert "narrative_directives" not in req


def test_scripted_match_passes_runner_intent_class_into_turn(tmp_path):
    """Structured intent_class from the player envelope reaches turn records."""
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    runner = tmp_path / "scripted_player_intent"
    _write_scripted_player_runner(
        runner,
        ["我仔细搜查现场寻找线索。"],
        intent_classes=["investigate"],
    )
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=runner,
        max_turns=1,
        rng_seed=42,
        live=False,
        # No match-level intent_class — envelope must supply it.
        intent_class=None,
    )
    assert result["player_choices"], "expected player_choices"
    assert result["player_choices"][0]["intent_class"] == "investigate"
    pacing = json.loads(
        (
            workspace
            / ".coc"
            / "campaigns"
            / campaign_id
            / "save"
            / "pacing-state.json"
        ).read_text(encoding="utf-8")
    )
    assert "investigate" in pacing.get("recent_intent_classes", [])


def test_scripted_match_move_crosses_into_unlocked_scene(tmp_path):
    """Integration: after unlock, a move-intent turn must leave the start scene."""
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    camp = workspace / ".coc" / "campaigns" / campaign_id
    story = json.loads((camp / "scenario" / "story-graph.json").read_text(encoding="utf-8"))
    # Narrative exits block clue-exhaustion auto-advance (acceptance shape).
    story["scenes"][0]["exit_conditions"] = ["orders_received"]
    story["scenes"][0]["npc_ids"] = ["npc-commander"]
    (camp / "scenario" / "story-graph.json").write_text(
        json.dumps(story), encoding="utf-8"
    )
    (camp / "scenario" / "npc-agendas.json").write_text(
        json.dumps(
            {
                "npcs": [
                    {
                        "npc_id": "npc-commander",
                        "agenda": "withhold the true objective",
                        "desire": "keep order",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    world = json.loads((camp / "save" / "world-state.json").read_text(encoding="utf-8"))
    world["unlocked_scene_ids"] = ["scene-1", "scene-2"]
    world["visited_scene_ids"] = []
    world["scene_history"] = []
    (camp / "save" / "world-state.json").write_text(json.dumps(world), encoding="utf-8")

    runner = tmp_path / "scripted_move_player"
    _write_scripted_player_runner(
        runner,
        [
            "我向指挥官确认任务细节。",
            "我们沿鞍部侧脊隐蔽推进。",
        ],
        intent_classes=["social", "move"],
    )
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=runner,
        max_turns=2,
        rng_seed=42,
        live=False,
        intent_class=None,
    )
    world2 = json.loads((camp / "save" / "world-state.json").read_text(encoding="utf-8"))
    assert world2["active_scene_id"] == "scene-2"
    assert "scene-1" in world2["visited_scene_ids"]
    assert any(h.get("scene_id") == "scene-2" for h in world2.get("scene_history") or [])
    actions = [t.get("action") for t in result["turns"]]
    assert "CUT" in actions or any(
        t.get("scene_transition") for t in result["turns"]
    )


def _write_scripted_narrator_runner(
    path: Path,
    *,
    texts: list[str] | None = None,
    fail: bool = False,
    inject_bookkeeping: bool = False,
    model_identity: dict | None = None,
    response_mode: str | None = None,
) -> None:
    """Stateful fake narrator: emit scripted final_text lines in order."""
    lines_literal = json.dumps(
        texts
        or [
            "你接过钥匙，金属还带着体温；诺特的目光在门廊阴影里停了一拍。",
            "报馆纸页沙沙作响，你翻到那则未刊出的剪报。",
        ],
        ensure_ascii=False,
    )
    model_repr = repr(model_identity)
    response_mode_repr = repr(response_mode)
    if fail:
        script = """#!/usr/bin/env python3
import json, sys
sys.stdout.write(json.dumps({"ok": False, "error": "narrator boom"}) + "\\n")
sys.exit(1)
"""
    elif inject_bookkeeping:
        script = f"""#!/usr/bin/env python3
import json, sys
from pathlib import Path
state_path = Path(__file__).with_suffix(".state")
idx = int(state_path.read_text()) if state_path.exists() else 0
req = json.loads(sys.stdin.read())
assert "rationale" not in json.dumps(req.get("narration_envelope") or {{}})
state_path.write_text(str(idx + 1))
# Deliberately include a bookkeeping phrase so the guard rewrite path fires.
out = {{
    "ok": True,
    "final_text": "基于以上信息，你确认了线索：门框划痕。雨还在下。",
    "secret_audit_complete": True,
    "response_mode": "tool",
    "asserted_fact_refs": [],
    "semantic_audit": [],
}}
if {model_repr} is not None:
    out["model_identity"] = {model_repr}
if {response_mode_repr} is not None:
    out["response_mode"] = {response_mode_repr}
sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\\n")
"""
    else:
        script = f"""#!/usr/bin/env python3
import json, sys
from pathlib import Path
state_path = Path(__file__).with_suffix(".state")
lines = {lines_literal}
idx = int(state_path.read_text()) if state_path.exists() else 0
req = json.loads(sys.stdin.read())
assert "narration_envelope" in req
env = req["narration_envelope"]
assert "rationale" not in env
assert "keeper_secrets" not in env
text = lines[min(idx, len(lines) - 1)]
state_path.write_text(str(idx + 1))
out = {{"ok": True, "final_text": text, "secret_audit_complete": True,
       "asserted_fact_refs": [], "semantic_audit": [], "response_mode": "tool"}}
if {model_repr} is not None:
    out["model_identity"] = {model_repr}
if {response_mode_repr} is not None:
    out["response_mode"] = {response_mode_repr}
sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\\n")
"""
    path.write_text(script, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def test_narrator_runner_uses_narrated_text_in_transcript(tmp_path):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    player = tmp_path / "scripted_player"
    narrator = tmp_path / "scripted_narrator"
    narrated = "你接过钥匙，金属还带着体温；诺特没再多说。"
    _write_scripted_player_runner(player, ["我接受委托并收下钥匙。"])
    _write_scripted_narrator_runner(narrator, texts=[narrated])
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        narrator_runner=narrator,
        max_turns=1,
        rng_seed=42,
        live=False,
        intent_class="investigate",
    )
    assert result["narration_method"] == "llm_narrator"
    assert result["fallback_turns"] == 0
    assert result["metadata"]["narration_method"] == "llm_narrator"
    battle = Path(result["battle_report_path"]).read_text(encoding="utf-8")
    assert narrated in battle
    assert any(
        (t.get("narration") or {}).get("final_text") == narrated for t in result["turns"]
    )


def test_narrator_fallback_on_runner_failure_keeps_playing(tmp_path):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    player = tmp_path / "scripted_player"
    narrator = tmp_path / "failing_narrator"
    _write_scripted_player_runner(player, ["我环顾四周。", "我继续调查。"])
    _write_scripted_narrator_runner(narrator, fail=True)
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        narrator_runner=narrator,
        max_turns=2,
        rng_seed=7,
        live=False,
        intent_class="investigate",
    )
    assert result["fallback_turns"] >= 1
    assert result["narration_method"] == "template"
    assert any(t.get("narrator_fallback") for t in result["turns"])
    assert len(result["turns"]) >= 1


def test_narrator_guard_rewrite_and_final_text_audit(tmp_path):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    player = tmp_path / "scripted_player"
    narrator = tmp_path / "bookkeeping_narrator"
    _write_scripted_player_runner(player, ["我检查门框。"])
    _write_scripted_narrator_runner(narrator, inject_bookkeeping=True)
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=player,
        narrator_runner=narrator,
        max_turns=1,
        rng_seed=3,
        live=False,
        intent_class="investigate",
    )
    assert result["narration_method"] == "llm_narrator"
    final = (result["turns"][0].get("narration") or {}).get("final_text") or ""
    assert "基于以上信息" not in final
    audit_path = (
        workspace
        / ".coc"
        / "campaigns"
        / campaign_id
        / "logs"
        / "narration-audit.jsonl"
    )
    assert audit_path.exists()
    lines = [
        json.loads(line)
        for line in audit_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert any(row.get("field") == "final_text" for row in lines)


def _run_match_with_investigator_state(
    tmp_path: Path,
    *,
    current_hp: int,
    conditions: list[str],
    **state_overrides,
):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    state_path = (
        workspace
        / ".coc"
        / "campaigns"
        / campaign_id
        / "save"
        / "investigator-state"
        / f"{investigator_id}.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state.update(
        {
            "current_hp": current_hp,
            "conditions": conditions,
            **state_overrides,
        }
    )
    state_path.write_text(json.dumps(state), encoding="utf-8")
    runner = tmp_path / "outcome_player"
    _write_scripted_player_runner(runner, ["我等待同伴处理眼前的危机。"])
    return match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=runner,
        max_turns=1,
        rng_seed=1,
        live=False,
        intent_class="wait",
    )


def test_dying_investigator_enters_rescue_resolution_not_dead(tmp_path):
    result = _run_match_with_investigator_state(
        tmp_path,
        current_hp=0,
        conditions=["major_wound", "dying", "unconscious"],
    )

    assert result["stop_reason"] != "investigator_dead"
    assert result["investigator_playability"]["status"] == "dying"
    assert result["investigator_playability"]["terminal"] is False
    assert result["pending_resolution"]["kind"] == "dying_rescue"
    assert result["result"]["pending_resolution"] == result["pending_resolution"]
    assert result["result"]["reached_terminal"] is False
    assert any(
        row.get("kind") == "dying_tick"
        for turn in result["result"]["turns"]
        for row in (turn.get("subsystem_results") or [])
    )


def test_stabilized_dying_investigator_remains_distinct_in_match_evidence(tmp_path):
    result = _run_match_with_investigator_state(
        tmp_path,
        current_hp=1,
        conditions=["major_wound", "dying", "stabilized", "unconscious"],
    )

    assert result["stop_reason"] != "investigator_dead"
    assert result["investigator_playability"]["status"] == "stabilized"
    assert result["investigator_playability"]["terminal"] is False
    assert result["pending_resolution"]["kind"] == "stabilized_death_clock"
    assert result["result"]["reached_terminal"] is False


def test_unconscious_without_dead_condition_does_not_report_death(tmp_path):
    result = _run_match_with_investigator_state(
        tmp_path,
        current_hp=0,
        conditions=["unconscious"],
    )

    assert result["stop_reason"] != "investigator_dead"
    assert result["investigator_playability"] == {
        "status": "unconscious",
        "playable": False,
        "terminal": False,
    }
    assert result["result"]["reached_terminal"] is False


def test_explicit_dead_condition_is_immediately_terminal(tmp_path):
    result = _run_match_with_investigator_state(
        tmp_path,
        current_hp=4,
        conditions=["dead"],
    )

    assert result["stop_reason"] == "investigator_dead"
    assert result["investigator_playability"] == {
        "status": "dead",
        "playable": False,
        "terminal": True,
    }
    assert result["result"]["reached_terminal"] is False


def test_permanently_unplayable_investigator_is_not_a_terminal_campaign(tmp_path):
    result = _run_match_with_investigator_state(
        tmp_path,
        current_hp=8,
        conditions=[],
        permanently_insane=True,
    )

    assert result["investigator_playability"]["status"] == "permanently_unplayable"
    assert result["investigator_playability"]["terminal"] is False
    assert result["result"]["reached_terminal"] is False


@pytest.mark.parametrize("underlying_flag", ["temporary_insane", "indefinite_insane"])
def test_underlying_insanity_without_active_bout_remains_player_controlled(
    tmp_path,
    underlying_flag,
):
    result = _run_match_with_investigator_state(
        tmp_path,
        current_hp=8,
        conditions=[],
        bout_active=False,
        **{underlying_flag: True},
    )

    assert result["investigator_playability"] == {
        "status": "active",
        "playable": True,
        "terminal": False,
    }
    assert result["stop_reason"] == "max_turns_reached"
    assert result["result"]["player_turn_count"] == 1


def test_active_bout_is_temporarily_unplayable_and_pauses_match(tmp_path):
    result = _run_match_with_investigator_state(
        tmp_path,
        current_hp=8,
        conditions=[],
        bout_active=True,
    )

    assert result["investigator_playability"] == {
        "status": "temporarily_unplayable",
        "playable": False,
        "terminal": False,
    }
    assert result["stop_reason"] == "investigator_temporarily_unplayable"
    assert result["result"]["player_turn_count"] == 0
    assert result["result"]["reached_terminal"] is False


def test_canonical_keeper_bout_choice_progresses_without_player_brain(tmp_path, monkeypatch):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    camp = workspace / ".coc" / "campaigns" / campaign_id
    char_path = workspace / ".coc" / "investigators" / investigator_id / "character.json"
    character = json.loads(char_path.read_text())
    character["characteristics"].update({"POW": 99, "INT": 99})
    character["derived"]["SAN"] = 99
    char_path.write_text(json.dumps(character))
    started = match.live_turn_runner.subsystem_executor.execute_commands(
        camp,
        char_path,
        investigator_id,
        [{
            "command_id": "match-bout-origin",
            "kind": "sanity_check",
            "phase": "resolve",
            "payload": {
                "decision_id": "match-bout-decision",
                "roll_id": "match-bout-roll",
                "san_loss_success": 5,
                "san_loss_fail_expr": "5",
                "source": "match horror",
                "alone": False,
                "involuntary_kind": "flee",
                "module_bout_override": {"force_mode": "real_time"},
            },
        }],
        rng=random.Random(1),
    )[0]
    assert started["pending_choice"]["responder"] == "keeper"
    monkeypatch.setattr(
        match.player_adapter,
        "player_send_turn",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("Keeper-owned bout choice must bypass player brain")
        ),
    )
    unused_runner = tmp_path / "unused-player"
    _write_scripted_player_runner(unused_runner, ["不应调用"])

    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=unused_runner,
        max_turns=1,
        rng_seed=31,
        live=False,
    )

    assert result["stop_reason"] == "max_turns_reached"
    assert result["result"]["player_turn_count"] == 0
    assert result["result"]["turns"][0]["subsystem_results"][0]["kind"] == "bout_tick"
    assert result["result"]["reached_terminal"] is False


def test_live_match_forwards_player_typed_push_response(tmp_path, monkeypatch):
    workspace, campaign_id, investigator_id = _build_workspace(tmp_path)
    camp = workspace / ".coc" / "campaigns" / campaign_id
    char_path = workspace / ".coc" / "investigators" / investigator_id / "character.json"
    executor = match.live_turn_runner.subsystem_executor
    failed = executor.execute_commands(
        camp,
        char_path,
        investigator_id,
        [{
            "command_id": "match-push-origin",
            "kind": "skill_check",
            "phase": "resolve",
            "payload": {
                "decision_id": "match-push-origin-decision",
                "roll_id": "match-push-origin-roll",
                "skill": "Spot Hidden",
                "roll_contract": {"push_policy": {"eligible": True}},
                "resolution_context": {
                    "scene_action": "SUBSYSTEM",
                    "clue_policy": {},
                    "narrative_directives": {},
                    "rule_signals": {},
                },
            },
        }],
        rng=random.Random(5),
    )[0]
    assert failed["events"][0]["outcome"] == "failure"
    offered = executor.execute_commands(
        camp,
        char_path,
        investigator_id,
        [{
            "command_id": "match-push-offer",
            "kind": "push_offer",
            "phase": "offer",
            "payload": {
                "decision_id": "match-push-offer-decision",
                "original_command_id": "match-push-origin",
                "changed_method_evidence": {
                    "changed": True,
                    "source": "player_proposal",
                    "summary": "inspect the paper impression",
                },
                "announced_consequence": {"summary": "the watcher recognizes you"},
            },
        }],
        rng=random.Random(211),
    )[0]
    choice = offered["pending_choice"]

    def answer_push(request, **_kwargs):
        assert request["pending_choice"] == choice
        return {
            "ok": True,
            "player_text": "",
            "pending_choice_response": {
                "choice_id": choice["choice_id"],
                "responder": "player",
                "revision": choice["revision"],
                "action": "cancel",
            },
        }

    monkeypatch.setattr(match.player_adapter, "player_send_turn", answer_push)
    runner = tmp_path / "player-placeholder"
    _write_scripted_player_runner(runner, ["unused"])
    result = match.run_live_match(
        workspace,
        campaign_id,
        investigator_id,
        player_runner=runner,
        max_turns=1,
        rng_seed=32,
        live=False,
    )

    assert result["result"]["turns"][0]["subsystem_results"][0]["status"] == "cancelled"
    assert result["player_choices"][0]["player_text"] == ""
    assert executor.get_current_pending_choice(camp) is None


def test_condition_form_active_bout_is_temporarily_unplayable_and_pauses_match(
    tmp_path,
):
    result = _run_match_with_investigator_state(
        tmp_path,
        current_hp=8,
        conditions=["bout_active"],
    )

    assert result["investigator_playability"] == {
        "status": "temporarily_unplayable",
        "playable": False,
        "terminal": False,
    }
    assert result["stop_reason"] == "investigator_temporarily_unplayable"
    assert result["result"]["player_turn_count"] == 0
    assert result["result"]["reached_terminal"] is False


def test_explicit_temporarily_unplayable_condition_pauses_match(tmp_path):
    result = _run_match_with_investigator_state(
        tmp_path,
        current_hp=8,
        conditions=["temporarily_unplayable"],
    )

    assert result["investigator_playability"]["status"] == "temporarily_unplayable"
    assert result["investigator_playability"]["terminal"] is False
    assert result["stop_reason"] == "investigator_temporarily_unplayable"
    assert result["result"]["player_turn_count"] == 0
