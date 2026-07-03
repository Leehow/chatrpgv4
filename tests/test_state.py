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
    assert campaign_path == tmp_path / ".coc" / "campaigns" / "haunting-test" / "campaign.json"
    assert json.loads(party_path.read_text())["investigator_ids"] == ["ada-king"]
    assert (tmp_path / ".coc" / "campaigns" / "haunting-test" / "memory").exists()
    assert (tmp_path / ".coc" / "campaigns" / "haunting-test" / "logs").exists()


def test_create_campaign_persists_play_language(tmp_path):
    default_campaign_path = coc_state.create_campaign(tmp_path, "default-language", "Default Language")
    custom_campaign_path = coc_state.create_campaign(
        tmp_path,
        "custom-language",
        "Custom Language",
        play_language="en-US",
    )

    default_campaign = json.loads(default_campaign_path.read_text())
    custom_campaign = json.loads(custom_campaign_path.read_text())

    assert default_campaign["play_language"] == "zh-Hans"
    assert default_campaign["localized_terms"] == {"zh-Hans": {}}
    assert custom_campaign["play_language"] == "en-US"
    assert custom_campaign["localized_terms"] == {"en-US": {}}


def test_append_jsonl_and_snapshot(tmp_path):
    coc_state.ensure_workspace(tmp_path)
    coc_state.create_campaign(tmp_path, "case-1", "Case 1")
    log_path = tmp_path / ".coc" / "campaigns" / "case-1" / "logs" / "events.jsonl"
    coc_state.append_jsonl(log_path, {"type": "scene", "payload": {"id": "intro"}})
    snapshot_path = coc_state.create_snapshot(tmp_path, "case-1", "after-intro")

    assert log_path.read_text().strip().endswith('"scene", "payload": {"id": "intro"}}')
    assert snapshot_path.exists()
