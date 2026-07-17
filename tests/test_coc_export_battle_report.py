import hashlib
import importlib.util
import json
from pathlib import Path

import pytest


SCRIPT = Path(
    "plugins/coc-keeper/skills/coc-export-battle-report/scripts/export_battle_report.py"
)
JSON_OUTPUT = "battle-report-source-bundle.json"
MARKDOWN_OUTPUT = "battle-report-source-bundle.md"


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
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
        encoding="utf-8",
    )


def _fixture(run: Path):
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    investigator = run / "sandbox" / ".coc" / "investigators" / "ada"
    metadata = {"run_id": "run-1", "campaign_id": "case-1", "seed": 17}
    character = {
        "id": "ada",
        "name": "艾达 | Ada",
        "unknown_future": {"nested": [0, False, "", {"unicode": "星"}]},
    }
    creation = {"schema_version": 9, "steps": [{"name": "age", "value": 27}]}
    transcript = [
        {
            "turn": 1,
            "role": "keeper_under_test",
            "speaker": "Gatekeeper",
            "speaker_display": "KP[门卫]",
            "text": "门上写着 **勿入**。\n第二行有 `code`。",
            "text_display": "门上展示着：勿入。",
        },
        {"turn": 2, "role": "system", "text": "meta row"},
        {
            "turn": 3,
            "role": "player_simulator",
            "speaker": "Ada King",
            "text": "我说：\"进去\" | yes 🚪",
        },
        {"turn": 4, "role": "keeper", "text": ""},
    ]
    rolls = [
        {"roll_id": "public-1", "visibility": "public", "roll": 42, "target": 60},
        {
            "roll_id": "keeper-1",
            "visibility": "keeper_only",
            "roll": 99,
            "secret_text": "THE_KEEPER_ROLL_SECRET",
        },
    ]
    snapshots = {
        "save/active-scene.json": {"scene_id": "attic", "private_plan": "STATE_SECRET"},
        "save/combat.json": {"active": False, "participants": []},
        "save/chase.json": {"active": True, "locations": ["hall", "attic"]},
        "save/flags.json": {"flags": {"door_open": True}},
        "save/world-state.json": {"time": "midnight"},
        "save/investigator-state/ada.json": {"investigator_id": "ada", "hp": 9},
    }
    _write_json(run / "playtest.json", metadata)
    _write_json(campaign / "campaign.json", {"campaign_id": "case-1"})
    _write_json(campaign / "party.json", {"investigator_ids": ["ada"]})
    _write_json(investigator / "character.json", character)
    _write_json(investigator / "creation.json", creation)
    _write_jsonl(investigator / "history.jsonl", [{"kind": "origin", "raw": {"x": 1}}])
    _write_jsonl(run / "transcript.jsonl", transcript)
    _write_jsonl(campaign / "logs" / "rolls.jsonl", rolls)
    for relative, payload in snapshots.items():
        _write_json(campaign / relative, payload)
    _write_json(run / "artifacts" / "report-completeness.json", {"passed": True})
    (run / "artifacts" / "battle-report.md").write_text(
        "# canonical battle report\n", encoding="utf-8"
    )
    return {
        "character": character,
        "creation": creation,
        "rolls": rolls,
        "snapshots": snapshots,
        "transcript": transcript,
    }


def test_source_bundle_pair_is_lossless_deterministic_and_non_colliding(tmp_path):
    module = _load()
    run = tmp_path / "run"
    expected = _fixture(run)
    canonical = run / "artifacts" / "battle-report.md"
    canonical_before = canonical.read_bytes()

    first = module.export_battle_report(run)
    artifacts = run / "artifacts"
    json_before = (artifacts / JSON_OUTPUT).read_bytes()
    markdown_before = (artifacts / MARKDOWN_OUTPUT).read_bytes()
    second = module.export_battle_report(run)

    assert canonical.read_bytes() == canonical_before
    assert (artifacts / JSON_OUTPUT).read_bytes() == json_before
    assert (artifacts / MARKDOWN_OUTPUT).read_bytes() == markdown_before
    assert first["report_id"] == second["report_id"]
    assert first["report_id"].startswith("coc-br-source-")
    payload = json.loads(json_before)
    assert payload["investigators"][0]["character"] == expected["character"]
    assert payload["investigators"][0]["creation"] == expected["creation"]
    assert payload["transcript"]["records"] == expected["transcript"]
    assert payload["public_rolls"]["records"] == [expected["rolls"][0]]
    for relative, snapshot in expected["snapshots"].items():
        assert payload["campaign"]["structured_inputs"][relative] == snapshot
    assert payload["completeness"]["classification"] == "COMPLETE"
    assert payload["completeness"]["report_binding"]["path"] == "artifacts/battle-report.md"


def test_manifest_binds_original_sources_receipt_and_canonical_report(tmp_path):
    module = _load()
    run = tmp_path / "run"
    expected = _fixture(run)

    report = module.export_battle_report(run)
    manifest = {entry["path"]: entry for entry in report["source_manifest"]}
    transcript_raw = (run / "transcript.jsonl").read_bytes()
    assert manifest["transcript.jsonl"]["sha256"] == hashlib.sha256(transcript_raw).hexdigest()
    assert manifest["transcript.jsonl"]["record_count"] == len(expected["transcript"])
    rolls_path = "sandbox/.coc/campaigns/case-1/logs/rolls.jsonl"
    assert manifest[rolls_path]["record_count"] == 2
    assert manifest[rolls_path]["included_record_count"] == 1
    receipt = run / "artifacts" / "report-completeness.json"
    assert report["completeness"]["receipt_binding"]["sha256"] == hashlib.sha256(
        receipt.read_bytes()
    ).hexdigest()
    canonical = run / "artifacts" / "battle-report.md"
    assert report["completeness"]["report_binding"]["sha256"] == hashlib.sha256(
        canonical.read_bytes()
    ).hexdigest()
    assert report["completeness"]["receipt_binding"]["verification"] == (
        "SOURCE_STATUS_ONLY_NOT_RECOMPUTED_BY_EXPORTER"
    )


def test_partial_requires_opt_in_and_is_prominently_incomplete(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    (run / "transcript.jsonl").rename(run / "partial-transcript.jsonl")

    with pytest.raises(module.ExportError, match="--allow-partial"):
        module.export_battle_report(run)
    assert not (run / "artifacts" / JSON_OUTPUT).exists()

    report = module.export_battle_report(run, allow_partial=True)
    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert report["completeness"]["transcript_source"] == "partial-transcript.jsonl"
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "Completeness: **INCOMPLETE**" in markdown
    assert "partial transcript exported by explicit request" in markdown


def test_missing_transcript_and_characters_are_structural_and_visible(tmp_path):
    module = _load()
    run = tmp_path / "missing"
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_json(run / "playtest.json", {"run_id": "missing", "campaign_id": "case-1"})
    _write_json(campaign / "party.json", {"investigator_ids": ["gone"]})

    report = module.export_battle_report(run)
    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert report["completeness"]["missing_character_ids"] == ["gone"]
    assert report["completeness"]["missing_creation_ids"] == ["gone"]
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "final transcript.jsonl is missing" in markdown
    assert markdown.count("**MISSING**") >= 2


def test_unrelated_artifact_is_preserved_and_output_symlink_is_rejected(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    unrelated = run / "artifacts" / "operator-notes.txt"
    unrelated.write_text("keep me", encoding="utf-8")
    module.export_battle_report(run)
    assert unrelated.read_text(encoding="utf-8") == "keep me"

    target = tmp_path / "outside.json"
    target.write_text("outside", encoding="utf-8")
    output = run / "artifacts" / JSON_OUTPUT
    output.unlink()
    output.symlink_to(target)
    with pytest.raises(module.ExportError, match="output symlink"):
        module.export_battle_report(run)
    assert target.read_text(encoding="utf-8") == "outside"


def test_canonical_report_symlink_is_not_followed(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    canonical = run / "artifacts" / "battle-report.md"
    canonical.unlink()
    outside = tmp_path / "outside-report.md"
    outside.write_text("CANONICAL_OUTSIDE_SECRET", encoding="utf-8")
    canonical.symlink_to(outside)

    report = module.export_battle_report(run)
    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert report["completeness"]["report_binding"]["binding_status"] == (
        "CANONICAL_REPORT_UNSAFE"
    )
    combined = (
        (run / "artifacts" / JSON_OUTPUT).read_text(encoding="utf-8")
        + (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    )
    assert "CANONICAL_OUTSIDE_SECRET" not in combined


@pytest.mark.parametrize(
    ("rows", "missing_reason"),
    [
        ([{"turn": 1, "role": "system", "text": "only meta"}], "Keeper/KP"),
        ([{"turn": 1, "role": "narrator", "text": "Keeper only"}], "player dialogue"),
    ],
)
def test_final_transcript_requires_both_dialogue_sides(tmp_path, rows, missing_reason):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    _write_jsonl(run / "transcript.jsonl", rows)

    report = module.export_battle_report(run)
    assert report["completeness"]["classification"] == "INCOMPLETE"
    assert any(missing_reason in reason for reason in report["completeness"]["reasons"])


@pytest.mark.parametrize(
    ("filename", "payload"),
    [("character.json", {}), ("creation.json", [])],
)
def test_empty_or_non_object_character_payload_is_incomplete(tmp_path, filename, payload):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    target = run / "sandbox" / ".coc" / "investigators" / "ada" / filename
    _write_json(target, payload)

    report = module.export_battle_report(run)
    assert report["completeness"]["classification"] == "INCOMPLETE"
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "**INVALID:** expected a non-empty JSON object." in markdown


def test_keeper_and_scenario_secrets_are_excluded_from_both_outputs(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    campaign = run / "sandbox" / ".coc" / "campaigns" / "case-1"
    _write_jsonl(
        run / "keeper-view.jsonl",
        [{"role": "keeper", "text": "THE_KEEPER_VIEW_SECRET"}],
    )
    _write_json(
        campaign / "scenario" / "scenario.json",
        {"keeper_truth": "THE_SCENARIO_SECRET"},
    )
    _write_jsonl(
        campaign / "logs" / "events.jsonl",
        [{"secret": True, "summary": "THE_EVENT_SECRET"}],
    )

    module.export_battle_report(run)
    combined = (
        (run / "artifacts" / JSON_OUTPUT).read_text(encoding="utf-8")
        + (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    )
    for secret in (
        "THE_KEEPER_VIEW_SECRET",
        "THE_SCENARIO_SECRET",
        "THE_EVENT_SECRET",
        "THE_KEEPER_ROLL_SECRET",
    ):
        assert secret not in combined
    assert "keeper-view.jsonl" not in combined
    assert "scenario/scenario.json" not in combined
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "STATE_SECRET" not in markdown


def test_hidden_character_fields_are_redacted_only_from_player_markdown(tmp_path):
    module = _load()
    run = tmp_path / "run"
    _fixture(run)
    character_path = run / "sandbox" / ".coc" / "investigators" / "ada" / "character.json"
    character = json.loads(character_path.read_text(encoding="utf-8"))
    character["keeper_secret"] = "CHARACTER_KEEPER_SECRET"
    character["nested"] = {"secret": True, "text": "NESTED_KEEPER_SECRET"}
    _write_json(character_path, character)

    module.export_battle_report(run)
    archive = (run / "artifacts" / JSON_OUTPUT).read_text(encoding="utf-8")
    markdown = (run / "artifacts" / MARKDOWN_OUTPUT).read_text(encoding="utf-8")
    assert "CHARACTER_KEEPER_SECRET" in archive
    assert "NESTED_KEEPER_SECRET" in archive
    assert "CHARACTER_KEEPER_SECRET" not in markdown
    assert "NESTED_KEEPER_SECRET" not in markdown
