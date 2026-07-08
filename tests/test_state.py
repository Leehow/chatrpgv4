import importlib.util
import json
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_state = load_module("coc_state", "plugins/coc-keeper/scripts/coc_state.py")
coc_language = load_module("coc_language_test", "plugins/coc-keeper/scripts/coc_language.py")


def test_create_campaign_workspace_and_party(tmp_path):
    coc_state.ensure_workspace(tmp_path)
    investigator_path = coc_state.create_investigator(
        tmp_path,
        "ada-king",
        {"schema_version": 1, "id": "ada-king", "name": "Ada King", "characteristics": {}},
    )
    campaign_path = coc_state.create_campaign(tmp_path, "haunting-test", "The Haunting Test")
    party_path = coc_state.link_party(tmp_path, "haunting-test", ["ada-king"])

    assert investigator_path == tmp_path / ".coc" / "investigators" / "ada-king" / "character.json"
    assert (tmp_path / ".coc" / "investigators" / "ada-king" / "creation.json").exists()
    creation = json.loads((tmp_path / ".coc" / "investigators" / "ada-king" / "creation.json").read_text())
    assert creation["investigator_id"] == "ada-king"
    assert creation["status"] == "creation_record_pending"
    assert campaign_path == tmp_path / ".coc" / "campaigns" / "haunting-test" / "campaign.json"
    assert json.loads(party_path.read_text())["investigator_ids"] == ["ada-king"]
    assert (tmp_path / ".coc" / "campaigns" / "haunting-test" / "memory").exists()
    assert (tmp_path / ".coc" / "campaigns" / "haunting-test" / "logs").exists()


def test_workspace_indexes_campaigns_and_reusable_investigators(tmp_path):
    coc_state.create_investigator(
        tmp_path,
        "ada-king",
        {"schema_version": 1, "id": "ada-king", "name": "Ada King", "characteristics": {}},
    )
    coc_state.create_campaign(tmp_path, "haunting-test", "The Haunting Test")
    coc_state.link_party(tmp_path, "haunting-test", ["ada-king"])

    investigator_index = json.loads((tmp_path / ".coc" / "indexes" / "investigators.json").read_text())
    campaign_index = json.loads((tmp_path / ".coc" / "indexes" / "campaigns.json").read_text())

    assert investigator_index["schema_version"] == 1
    assert investigator_index["investigators"]["ada-king"] == {
        "id": "ada-king",
        "name": "Ada King",
        "creation_path": ".coc/investigators/ada-king/creation.json",
        "path": ".coc/investigators/ada-king/character.json",
        "history_path": ".coc/investigators/ada-king/history.jsonl",
        "development_path": ".coc/investigators/ada-king/development.jsonl",
        "inventory_history_path": ".coc/investigators/ada-king/inventory-history.jsonl",
    }
    assert campaign_index["schema_version"] == 1
    assert campaign_index["campaigns"]["haunting-test"] == {
        "campaign_id": "haunting-test",
        "title": "The Haunting Test",
        "status": "setup",
        "play_language": "zh-Hans",
        "path": ".coc/campaigns/haunting-test/campaign.json",
        "party_path": ".coc/campaigns/haunting-test/party.json",
        "save_path": ".coc/campaigns/haunting-test/save",
        "memory_path": ".coc/campaigns/haunting-test/memory",
        "logs_path": ".coc/campaigns/haunting-test/logs",
        "investigator_ids": ["ada-king"],
    }


def test_list_investigators_enumerates_existing_investigators(tmp_path):
    coc_state.create_investigator(
        tmp_path,
        "ada-king",
        {"schema_version": 1, "id": "ada-king", "name": "Ada King", "occupation": "Antiquarian", "era": "1920s", "characteristics": {}},
    )
    coc_state.create_investigator(
        tmp_path,
        "bryn-jones",
        {"schema_version": 1, "id": "bryn-jones", "name": "Bryn Jones", "occupation": "Private Investigator", "era": "modern", "characteristics": {}},
    )

    investigators = coc_state.list_investigators(tmp_path)

    assert len(investigators) == 2
    assert [entry["investigator_id"] for entry in investigators] == ["ada-king", "bryn-jones"]
    by_id = {entry["investigator_id"]: entry for entry in investigators}
    assert by_id["ada-king"]["name"] == "Ada King"
    assert by_id["ada-king"]["occupation"] == "Antiquarian"
    assert by_id["ada-king"]["era"] == "1920s"
    assert by_id["bryn-jones"]["name"] == "Bryn Jones"
    assert by_id["bryn-jones"]["occupation"] == "Private Investigator"
    assert by_id["bryn-jones"]["era"] == "modern"


def test_list_investigators_skips_dirs_without_character_json_and_tolerates_missing_fields(tmp_path):
    coc_state.ensure_workspace(tmp_path)
    # Investigator with full fields.
    coc_state.create_investigator(
        tmp_path,
        "ada-king",
        {"schema_version": 1, "id": "ada-king", "name": "Ada King", "occupation": "Antiquarian", "era": "1920s", "characteristics": {}},
    )
    # Investigator with minimal fields (no occupation/era).
    coc_state.create_investigator(
        tmp_path,
        "minimal-investigator",
        {"schema_version": 1, "id": "minimal-investigator", "name": "Minimal", "characteristics": {}},
    )
    # An empty directory under investigators/ that has no character.json must be skipped.
    (tmp_path / ".coc" / "investigators" / "stub-dir").mkdir(parents=True, exist_ok=True)
    # A directory whose character.json is malformed JSON must be skipped, not crash.
    malformed_dir = tmp_path / ".coc" / "investigators" / "malformed"
    malformed_dir.mkdir(parents=True, exist_ok=True)
    (malformed_dir / "character.json").write_text("{not valid json", encoding="utf-8")

    investigators = coc_state.list_investigators(tmp_path)

    ids = {entry["investigator_id"] for entry in investigators}
    assert ids == {"ada-king", "minimal-investigator"}
    by_id = {entry["investigator_id"]: entry for entry in investigators}
    # Missing fields are tolerated (default to None) rather than raising.
    assert by_id["minimal-investigator"]["name"] == "Minimal"
    assert by_id["minimal-investigator"]["occupation"] is None
    assert by_id["minimal-investigator"]["era"] is None


def test_list_investigators_returns_empty_list_when_none_exist(tmp_path):
    coc_state.ensure_workspace(tmp_path)

    assert coc_state.list_investigators(tmp_path) == []


def test_create_investigator_persists_supplied_creation_record(tmp_path):
    investigator_path = coc_state.create_investigator(
        tmp_path,
        "ada-king",
        {"schema_version": 1, "id": "ada-king", "name": "Ada King", "characteristics": {}},
        creation={
            "schema_version": 1,
            "investigator_id": "ada-king",
            "method": "standard_rulebook_chapter_3",
            "occupation": "Antiquarian",
            "skill_allocation": {"occupation_points": {"spent": 300}},
        },
    )

    creation = json.loads((investigator_path.parent / "creation.json").read_text())

    assert creation["investigator_id"] == "ada-king"
    assert creation["method"] == "standard_rulebook_chapter_3"
    assert creation["skill_allocation"]["occupation_points"]["spent"] == 300


def test_create_campaign_persists_play_language(tmp_path):
    default_campaign_path = coc_state.create_campaign(tmp_path, "default-language", "Default Language")
    custom_campaign_path = coc_state.create_campaign(
        tmp_path,
        "custom-language",
        "Custom Language",
        play_language="ja-JP",
    )

    default_campaign = json.loads(default_campaign_path.read_text())
    custom_campaign = json.loads(custom_campaign_path.read_text())

    assert default_campaign["play_language"] == "zh-Hans"
    assert default_campaign["localized_terms"] == {"zh-Hans": {}}
    assert default_campaign["language_profile"]["language"] == "zh-Hans"
    assert "Chinese transliterations" in default_campaign["language_profile"]["name_policy"]
    assert custom_campaign["play_language"] == "ja-JP"
    assert custom_campaign["localized_terms"] == {"ja-JP": {}}
    assert custom_campaign["language_profile"]["language"] == "ja-JP"
    assert "localized_terms.ja-JP" in custom_campaign["language_profile"]["term_policy"]


def test_create_campaign_initializes_resume_state_files(tmp_path):
    campaign_path = coc_state.create_campaign(tmp_path, "haunting-test", "The Haunting Test")
    campaign_dir = campaign_path.parent

    world_state = json.loads((campaign_dir / "save" / "world-state.json").read_text())
    active_scene = json.loads((campaign_dir / "save" / "active-scene.json").read_text())
    flags = json.loads((campaign_dir / "save" / "flags.json").read_text())

    assert world_state["campaign_id"] == "haunting-test"
    assert world_state["status"] == "setup"
    assert world_state["active_scene_id"] is None
    assert world_state["memory_refs"] == ["memory/session-summaries.jsonl"]
    assert world_state["log_refs"] == ["logs/events.jsonl", "logs/rolls.jsonl"]
    assert world_state["investigator_state_refs"] == []
    assert active_scene == {
        "schema_version": 1,
        "campaign_id": "haunting-test",
        "scenario_id": None,
        "scene_id": None,
        "source_event_type": None,
        "summary": "",
        "pending_choices": None,
    }
    assert flags == {
        "schema_version": 1,
        "campaign_id": "haunting-test",
        "scenario_id": None,
        "clues_found": {},
        "decisions": [],
        "spoiler_reveals": [],
    }
    assert (campaign_dir / "logs" / "events.jsonl").read_text() == ""
    assert (campaign_dir / "logs" / "rolls.jsonl").read_text() == ""
    assert (campaign_dir / "logs" / "audit.jsonl").read_text() == ""
    assert (campaign_dir / "memory" / "session-summaries.jsonl").read_text() == ""

    # pacing-state.json is created so the director does not always fall back
    pacing_state = json.loads((campaign_dir / "save" / "pacing-state.json").read_text())
    assert pacing_state == {
        "schema_version": 1,
        "campaign_id": "haunting-test",
        "tension_level": "low",
        "lethal_chances_used": 0,
        "recent_intent_classes": [],
        "turn_number": 0,
        "luck_spent_last": 0,
    }


def test_custom_language_profiles_are_independent_copies():
    first = coc_language.language_profile("fr-FR")
    first["speaker_labels"]["player"] = "joueur"

    second = coc_language.language_profile("fr-FR")
    english = coc_language.language_profile("en-US")

    assert second["speaker_labels"]["player"] == "Player"
    assert english["speaker_labels"]["player"] == "Player"


def test_append_jsonl_and_snapshot(tmp_path):
    coc_state.ensure_workspace(tmp_path)
    coc_state.create_campaign(tmp_path, "case-1", "Case 1")
    campaign_dir = tmp_path / ".coc" / "campaigns" / "case-1"
    log_path = tmp_path / ".coc" / "campaigns" / "case-1" / "logs" / "events.jsonl"
    coc_state.append_jsonl(log_path, {"type": "scene", "payload": {"id": "intro"}})
    coc_state.append_jsonl(
        campaign_dir / "memory" / "session-summaries.jsonl",
        {"summary": "The investigators opened the case."},
    )
    (campaign_dir / "scenario" / "scenario.json").write_text(
        json.dumps({"scenario_id": "case-1-scenario"}),
        encoding="utf-8",
    )
    (campaign_dir / "index" / "source-map.json").write_text(
        json.dumps({"sources": [{"path": "pdf/module.pdf"}]}),
        encoding="utf-8",
    )
    snapshot_path = coc_state.create_snapshot(tmp_path, "case-1", "after-intro")

    assert log_path.read_text().strip().endswith('"scene", "payload": {"id": "intro"}}')
    assert snapshot_path.exists()
    assert (snapshot_path / "logs" / "events.jsonl").read_text() == log_path.read_text()
    assert (snapshot_path / "memory" / "session-summaries.jsonl").exists()
    assert json.loads((snapshot_path / "scenario" / "scenario.json").read_text())["scenario_id"] == "case-1-scenario"
    assert json.loads((snapshot_path / "index" / "source-map.json").read_text())["sources"][0]["path"] == "pdf/module.pdf"


def test_restore_snapshot_recovers_campaign_state(tmp_path):
    coc_state.ensure_workspace(tmp_path)
    coc_state.create_campaign(tmp_path, "case-1", "Case 1")
    campaign_dir = tmp_path / ".coc" / "campaigns" / "case-1"
    coc_state.append_jsonl(
        campaign_dir / "logs" / "events.jsonl",
        {"type": "scene", "payload": {"id": "intro"}},
    )
    coc_state.append_jsonl(
        campaign_dir / "memory" / "session-summaries.jsonl",
        {"summary": "Original memory."},
    )
    (campaign_dir / "save" / "world-state.json").write_text(
        json.dumps({"active_scene_id": "intro"}),
        encoding="utf-8",
    )
    coc_state.create_snapshot(tmp_path, "case-1", "before-risk")

    coc_state.append_jsonl(
        campaign_dir / "logs" / "events.jsonl",
        {"type": "scene", "payload": {"id": "bad-branch"}},
    )
    (campaign_dir / "memory" / "session-summaries.jsonl").write_text(
        json.dumps({"summary": "Bad memory."}) + "\n",
        encoding="utf-8",
    )
    (campaign_dir / "save" / "world-state.json").write_text(
        json.dumps({"active_scene_id": "bad-branch"}),
        encoding="utf-8",
    )

    restored_path = coc_state.restore_snapshot(tmp_path, "case-1", "before-risk")

    assert restored_path == campaign_dir
    assert "bad-branch" not in (campaign_dir / "logs" / "events.jsonl").read_text()
    assert json.loads((campaign_dir / "save" / "world-state.json").read_text())["active_scene_id"] == "intro"
    assert json.loads((campaign_dir / "memory" / "session-summaries.jsonl").read_text())["summary"] == "Original memory."


def test_prepare_character_creation_draft_archives_stale_active_draft(tmp_path):
    coc_state.create_campaign(tmp_path, "case-1", "Case 1")
    campaign_dir = tmp_path / ".coc" / "campaigns" / "case-1"
    stale_path = campaign_dir / "save" / "character-creation-draft.json"
    stale_path.write_text(
        json.dumps({
            "schema_version": 1,
            "investigator_id": "old-investigator",
            "status": "drafting",
        }),
        encoding="utf-8",
    )

    draft_path = coc_state.prepare_character_creation_draft(
        tmp_path,
        "case-1",
        "new-investigator",
        generation_method="point_buy_460",
    )

    active = json.loads(draft_path.read_text(encoding="utf-8"))
    archive_path = campaign_dir / "save" / "character-creation-drafts" / "old-investigator.json"

    assert active["investigator_id"] == "new-investigator"
    assert active["generation_method"] == "point_buy_460"
    assert archive_path.exists()
    assert json.loads(archive_path.read_text(encoding="utf-8"))["investigator_id"] == "old-investigator"
