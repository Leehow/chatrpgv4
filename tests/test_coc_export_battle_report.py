import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path("plugins/coc-keeper/skills/coc-export-battle-report/scripts/export_battle_report.py")
JSON_OUTPUT = "battle-report-evidence.json"
MARKDOWN_OUTPUT = "battle-report.md"


def _load():
    spec = importlib.util.spec_from_file_location("coc_export_battle_report_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def _fixture(run: Path, *, metadata_name="run.json"):
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    investigator = run / "sandbox" / ".coc" / "investigators" / "ada"
    metadata = {"run_id": "run-1", "campaign_id": "case-1", "seed": 17}
    transcript = [
        {"turn": 1, "role": "keeper_under_test", "speaker_display": "KP[门卫]", "text": "门上写着 **勿入**。\n第二行有 `code`。"},
        {"turn": 2, "role": "system", "text": "RUNNER_PROMPT_SECRET"},
        {"turn": 3, "role": "player_simulator", "speaker": "Ada King", "text": "我说：\"进去\" | yes 🚪"},
    ]
    rolls = [
        {"roll_id": "public-1", "actor": "ada", "visibility": "public", "source_ref": "logs/rolls.jsonl#public-1", "payload": {"roll_id": "public-1", "skill": "Spot Hidden", "roll": 42, "effective_target": 60, "outcome": "success"}},
        {"roll_id": "keeper-1", "visibility": "keeper_only", "payload": {"roll": 99, "secret_text": "KEEPER_ROLL_SECRET"}},
    ]
    _write_json(run / metadata_name, metadata)
    _write_json(campaign / "party.json", {"investigator_ids": ["ada"]})
    _write_json(investigator / "character.json", {"id": "ada", "name": "艾达 | Ada", "occupation": "记者", "age": 27, "sex": "F", "characteristics": {"STR": 40, "LUCK": 50}, "derived": {"HP": 10, "SAN": 60, "MP": 12}, "skills": {"Library Use": 73}, "weapons": [{"name": "Camera tripod", "damage": "1D4"}], "equipment": ["camera"], "backstory": {"scenario_bound": {"description": "A public assignment", "significant_people": "Her editor"}, "traits": ["curious"], "ideology": "publish the truth"}, "player_facing_sheet_zh": {"nationality": "英国", "skills": [{"key": "Library Use", "label": "图书馆使用", "value": 70, "half": 35, "fifth": 14}]}, "keeper_secret": "CHARACTER_SECRET"})
    _write_json(investigator / "creation.json", {"age": 27})
    _write_json(campaign / "save" / "investigator-state" / "ada.json", {"investigator_id": "ada", "current_hp": 9, "current_san": 54, "current_mp": 12, "current_luck": 50, "conditions": ["wounded"], "personal_horror_hooks": [{"hook_id": "truth", "summary": "A censored story", "woven": True, "keeper_secret": "HOOK_SECRET"}]})
    _write_json(campaign / "save" / "world-state.json", {"visited_scene_ids": ["office", "archive"], "scene_history": [{"scene_id": "archive", "decision_id": "d1"}], "discovered_clue_ids": ["clue-public"], "major_decisions": [{"decision_id": "d1", "summary": "Entered the archive"}]})
    _write_json(campaign / "save" / "flags.json", {"clues_found": {"clue-public": {"method": "read the public ledger"}}, "keeper_secret": "FLAG_SECRET"})
    _write_json(campaign / "save" / "npc-engagement-receipts.json", {"receipts": {"r1": {"event": {"event_id": "e1", "npc_id": "npc-clerk", "scene_id": "archive", "interaction_kind": "dialogue", "identity_contract": {"keeper_only": True, "name": "Secret Clerk Name", "agenda": "NPC_AGENDA_SECRET", "voice": "NPC_VOICE_SECRET"}}}}})
    ending_id = "ending-1"
    _write_jsonl(campaign / "logs" / "events.jsonl", [{"event_type": "session_ending", "ending_id": ending_id, "scene_id": "archive", "kind": "conclusion", "summary": "Ada published the evidence.", "settlement_capsule_ref": f"save/development-settlements/endings/{ending_id}/capsule.json"}])
    _write_json(campaign / "save" / "development-settlements" / "endings" / ending_id / "ada.json", {"ending_id": ending_id, "investigator_id": "ada", "receipt": {"status": "PASS", "result": {"improvement_checks": [{"skill": "Library Use", "check_roll": 90, "gain": 3, "value_before": 70, "value_after": 73, "applied_delta": 3, "improved": True}], "luck_recovery": {"luck_before": 50, "luck_after": 55, "gained": 5}}}})
    _write_jsonl(run / "transcript.jsonl", transcript)
    _write_jsonl(campaign / "logs" / "rolls.jsonl", rolls)
    _write_jsonl(campaign / "logs" / "toolbox-calls.jsonl", [{
        "schema_version": 2,
        "turn_number": 1,
        "tool": "director.advise",
        "ok": True,
        "args": {"decision_id": "d1"},
        "data": {"advice_id": "director:1:test", "keeper_secret": "INTERNAL_ONLY"},
        "visibility": "keeper_internal",
    }])
    _write_jsonl(campaign / "logs" / "advisory-adoptions.jsonl", [{
        "schema_version": 1,
        "decision_id": "d1",
        "advice_id": "director:1:test",
        "disposition": "modified",
        "reason": "Kept the pressure but changed the NPC beat.",
        "visibility": "keeper_internal",
    }])
    return {"metadata": metadata, "rolls": rolls, "transcript": transcript}


def test_writes_the_single_final_report_pair_deterministically(tmp_path):
    module = _load()
    run = tmp_path / "run"
    expected = _fixture(run)
    first = module.export_battle_report(run)
    artifacts = run / "artifacts"
    json_before = (artifacts / JSON_OUTPUT).read_bytes()
    markdown_before = (artifacts / MARKDOWN_OUTPUT).read_bytes()
    second = module.export_battle_report(run)
    assert first["report_id"] == second["report_id"]
    assert first["report_id"].startswith("coc-battle-report-")
    assert (artifacts / JSON_OUTPUT).read_bytes() == json_before
    assert (artifacts / MARKDOWN_OUTPUT).read_bytes() == markdown_before
    payload = json.loads(json_before)
    assert payload["report_type"] == "coc_actual_play_battle_report_evidence"
    assert payload["run_metadata"] == expected["metadata"]
    assert payload["completeness"]["classification"] == "COMPLETE"
    assert payload["schema_version"] == 4
    assert payload["keeper_internal"]["tool_call_count"] == 1
    assert payload["keeper_internal"]["advisory_adoption_count"] == 1
    assert payload["keeper_internal"]["turn_capsules"][0]["tool_calls"][0]["data"]["keeper_secret"] == "INTERNAL_ONLY"
    assert "INTERNAL_ONLY" not in markdown_before.decode()
    assert "Kept the pressure" not in markdown_before.decode()
    assert markdown_before.decode().startswith("# COC Actual-Play Battle Report\n")


@pytest.mark.parametrize("metadata_name", ["run.json", "playtest.json"])
def test_accepts_simplified_run_or_legacy_playtest_metadata(tmp_path, metadata_name):
    module = _load()
    run = tmp_path / metadata_name
    _fixture(run, metadata_name=metadata_name)
    report = module.export_battle_report(run)
    assert report["source_identity"]["metadata_source"] == metadata_name
    assert report["source_identity"]["run_id"] == "run-1"


def test_final_report_is_readable_actual_play_not_raw_payload_dump(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    module.export_battle_report(run)
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    for phrase in ("## Investigators", "### 艾达 | Ada", "- Sex: F", "- Nationality: 英国", "- Final HP: 9", "- Conditions: wounded", "#### Characteristics", "#### Initial Skills", "| 图书馆使用 (`Library Use`) | 70 | 35 | 14 |", "#### Weapons", "#### Equipment", "#### Backstory and Traits", "  - Description: A public assignment", "#### Personal Horror", "## Development and Ending", "Ada published the evidence.", "### 艾达 | Ada Development", "Library Use: 70 → 73", "- Luck: 50 → 55", "## Investigation Chronicle", "`office` → `archive`", "`clue-public` — read the public ledger", "`npc-clerk`", "## Actual Play", "### Turn 1 · KP[门卫]", "门上写着 **勿入**。", "### Turn 3 · Ada King", "## Public Rules and Dice", "- Roll: 42", "- Target: 60", "- Outcome: success"):
        assert phrase in markdown
    assert "{'condition':" not in markdown
    assert '"luck_after"' not in markdown
    assert '"description"' not in markdown


def test_final_report_preserves_zero_character_and_roll_values(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    investigator = run / "sandbox" / ".coc" / "investigators" / "ada"
    _write_json(
        investigator / "character.json",
        {
            "id": "ada",
            "name": "艾达 | Ada",
            "hp": 11,
            "san": 54,
            "mp": 9,
        },
    )
    _write_json(
        campaign / "save" / "investigator-state" / "ada.json",
        {"investigator_id": "ada", "current_hp": 0, "current_san": 0, "current_mp": 0, "current_luck": 0},
    )
    _write_jsonl(
        campaign / "logs" / "rolls.jsonl",
        [
            {
                "roll_id": "zero-roll",
                "roll": 87,
                "effective_target": 60,
                "visibility": "public",
                "payload": {
                    "roll_id": "zero-roll",
                    "roll": 0,
                    "effective_target": 0,
                    "outcome": "failure",
                },
            }
        ],
    )

    module.export_battle_report(run)
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    for field in ("Final HP", "Final SAN", "Final MP", "Final Luck", "Roll", "Target"):
        assert f"- {field}: 0" in markdown
    assert "- Final HP: 11" not in markdown
    assert "- Roll: 87" not in markdown
    assert "- Target: 60" not in markdown


@pytest.mark.parametrize(
    ("expression", "raw", "total", "expected_roll"),
    [
        ("2D6", [6, 3], 9, "2D6 = 9"),
        ("1D1-1", [1], 0, "1D1-1 = 0"),
    ],
)
def test_nested_dice_total_is_complete_and_rendered(
    tmp_path, expression, raw, total, expected_roll
):
    module = _load()
    run = tmp_path / f"nested-{total}"
    _fixture(run)
    rolls = (
        run
        / "sandbox"
        / ".coc"
        / "campaigns"
        / "case-1"
        / "logs"
        / "rolls.jsonl"
    )
    _write_jsonl(
        rolls,
        [
            {
                "roll_id": f"nested-{total}",
                "visibility": "public",
                "payload": {
                    "roll_id": f"nested-{total}",
                    "dice": {
                        "expression": expression,
                        "raw": raw,
                        "total": total,
                    },
                },
            }
        ],
    )

    report = module.export_battle_report(run)

    assert report["completeness"]["classification"] == "COMPLETE"
    assert report["public_rolls"]["status"] == "PASS"
    assert report["public_rolls"]["malformed_source_lines"] == []
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert f"- Roll: {expected_roll}" in markdown
    assert f"- Raw Dice: {', '.join(map(str, raw))}" in markdown


def test_evidence_hashes_sources_and_renders_public_roll_exactly_once(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    report = module.export_battle_report(run)
    manifest = {entry["path"]: entry for entry in report["source_manifest"]}
    transcript = run / "transcript.jsonl"
    assert manifest["transcript.jsonl"]["sha256"] == hashlib.sha256(transcript.read_bytes()).hexdigest()
    rolls_path = "sandbox/.coc/campaigns/case-1/logs/rolls.jsonl"
    assert manifest[rolls_path]["record_count"] == 2
    assert manifest[rolls_path]["included_record_count"] == 1
    assert report["public_rolls"]["status"] == "PASS"
    assert report["public_rolls"]["required_count"] == report["public_rolls"]["rendered_count"] == 1
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert markdown.count("### `public-1`") == 1


def test_valid_empty_roll_log_explicitly_reports_zero(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    rolls = run / "sandbox" / ".coc" / "campaigns" / "case-1" / "logs" / "rolls.jsonl"
    _write_jsonl(rolls, [])
    report = module.export_battle_report(run)
    assert report["public_rolls"]["status"] == "PASS"
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "Public roll count: **0**" in markdown
    assert "No public or consequence-public rolls occurred." in markdown


@pytest.mark.parametrize("mutation,reason", [
    ("missing-log", "public roll count cannot be proven"),
    ("duplicate", "duplicate public roll IDs"),
    ("malformed", "lack roll_id or numerical evidence"),
])
def test_public_roll_completeness_fails_closed(tmp_path, mutation, reason):
    module = _load()
    run = tmp_path / mutation
    data = _fixture(run)
    rolls = run / "sandbox" / ".coc" / "campaigns" / "case-1" / "logs" / "rolls.jsonl"
    if mutation == "missing-log":
        rolls.unlink()
    elif mutation == "duplicate":
        _write_jsonl(rolls, [data["rolls"][0], data["rolls"][0]])
    else:
        _write_jsonl(rolls, [{"visibility": "public", "outcome": "success"}])
    report = module.export_battle_report(run)
    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert report["public_rolls"]["status"] == "FAIL"
    assert any(reason in item for item in report["completeness"]["reasons"])


def test_partial_requires_opt_in_and_stays_incomplete(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    (run / "transcript.jsonl").rename(run / "partial-transcript.jsonl")
    with pytest.raises(module.ExportError, match="--allow-partial"):
        module.export_battle_report(run)
    report = module.export_battle_report(run, allow_partial=True)
    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert report["source_identity"]["transcript_source"] == "partial-transcript.jsonl"


def test_secrets_and_non_dialogue_rows_are_excluded_from_both_outputs(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_jsonl(run / "keeper-view.jsonl", [{"text": "KEEPER_VIEW_SECRET"}])
    _write_json(campaign / "scenario" / "scenario.json", {"truth": "SCENARIO_SECRET"})
    module.export_battle_report(run)
    combined = (run / "artifacts" / JSON_OUTPUT).read_text(encoding="utf-8") + (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    for secret in ("RUNNER_PROMPT_SECRET", "KEEPER_ROLL_SECRET", "CHARACTER_SECRET", "HOOK_SECRET", "FLAG_SECRET", "NPC_AGENDA_SECRET", "NPC_VOICE_SECRET", "Secret Clerk Name", "KEEPER_VIEW_SECRET", "SCENARIO_SECRET"):
        assert secret not in combined


def test_completeness_dimensions_are_scoped_and_missing_ending_is_visible(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    (campaign / "logs" / "events.jsonl").unlink()
    report = module.export_battle_report(run)
    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert report["completeness"]["claim_scope"] == "report_source_evidence_only"
    assert report["completeness"]["dimensions"]["ending_and_development"]["status"] == "FAIL"
    assert "whole_product_kp_quality" in report["completeness"]["not_claimed"]


@pytest.mark.parametrize(
    ("kept_role", "expected_reason"),
    [
        ("keeper_under_test", "no non-empty player dialogue rows were found"),
        ("player_simulator", "no non-empty Keeper/KP dialogue rows were found"),
    ],
)
def test_exact_transcript_dimension_reports_the_actual_missing_role(
    tmp_path, kept_role, expected_reason
):
    module = _load()
    run = tmp_path / kept_role
    data = _fixture(run)
    _write_jsonl(
        run / "transcript.jsonl",
        [row for row in data["transcript"] if row.get("role") == kept_role],
    )
    report = module.export_battle_report(run)
    dimension = report["completeness"]["dimensions"]["exact_transcript"]
    assert dimension["status"] == "FAIL"
    assert expected_reason in dimension["findings"]
    assert "final ordered transcript contains both table roles" not in dimension["findings"]


def test_unrelated_artifact_is_preserved_and_output_symlink_is_rejected(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    unrelated = run / "artifacts" / "operator-notes.txt"
    unrelated.parent.mkdir(parents=True)
    unrelated.write_text("keep me", encoding="utf-8")
    module.export_battle_report(run)
    assert unrelated.read_text(encoding="utf-8") == "keep me"
    output = run / "artifacts" / JSON_OUTPUT
    output.unlink()
    outside = tmp_path / "outside.json"
    outside.write_text("outside", encoding="utf-8")
    output.symlink_to(outside)
    with pytest.raises(module.ExportError, match="output symlink"):
        module.export_battle_report(run)
    assert outside.read_text(encoding="utf-8") == "outside"
