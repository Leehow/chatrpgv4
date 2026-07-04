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
