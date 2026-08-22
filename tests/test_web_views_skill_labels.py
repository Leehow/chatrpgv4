"""Player-facing skill labels on the web character projection."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from runtime.sdk import web_views

REPO_ROOT = Path(__file__).resolve().parents[1]


def _load_script(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _labels(view: dict) -> dict[str, str]:
    return {row["key"]: row["label"] for row in view["skills"]}


def test_zh_hans_canonical_skills_ignore_stale_english_pf_labels():
    character = {
        "id": "ada",
        "skills": {
            "Spot Hidden": 70,
            "Library Use": 50,
            "First Aid": 40,
            "Listen": 45,
            "Stealth": 30,
            "Persuade": 55,
            "Language (Own)": 80,
        },
        "player_facing_sheet_zh": {
            "skills": [
                {"key": "Spot Hidden", "label": "Spot Hidden", "value": 70},
                {"key": "Library Use", "label": "Library Use", "value": 50},
                {"key": "First Aid", "label": "First Aid", "value": 40},
                {"key": "Listen", "label": "Listen", "value": 45},
                {"key": "Stealth", "label": "Stealth", "value": 30},
                {"key": "Persuade", "label": "Persuade", "value": 55},
                {"key": "Language (Own)", "label": "Language (Own)", "value": 80},
            ]
        },
    }
    view = web_views._display_character(REPO_ROOT, character, "zh-Hans")
    labels = _labels(view)
    assert labels["Spot Hidden"] == "侦查"
    assert labels["Library Use"] == "图书馆使用"
    assert labels["First Aid"] == "急救"
    assert labels["Listen"] == "聆听"
    assert labels["Stealth"] == "潜行"
    assert labels["Persuade"] == "说服"
    assert labels["Language (Own)"] == "母语"


def test_zh_hans_keeps_authored_and_custom_pf_labels():
    character = {
        "id": "ada",
        "skills": {
            "Credit Rating": 50,
            "Language (Own)": 80,
            "Spot Hidden": 70,
            "Trench Astrology": 15,
        },
        "player_facing_sheet_zh": {
            "skills": [
                {"key": "Credit Rating", "label": "地位与财力", "value": 50},
                {"key": "Language (Own)", "label": "语言（英语）", "value": 80},
                {"key": "Spot Hidden", "label": "侦查", "value": 70},
                {"key": "Trench Astrology", "label": "战壕占星术", "value": 15},
            ]
        },
    }
    view = web_views._display_character(REPO_ROOT, character, "zh-Hans")
    labels = _labels(view)
    assert labels["Credit Rating"] == "地位与财力"
    assert labels["Language (Own)"] == "语言（英语）"
    assert labels["Spot Hidden"] == "侦查"
    assert labels["Trench Astrology"] == "战壕占星术"


def test_unknown_skill_without_pf_keeps_stable_machine_key():
    character = {
        "id": "ada",
        "skills": {
            "Custom Knack": 20,
            "Trench Astrology": 15,
        },
    }
    view = web_views._display_character(REPO_ROOT, character, "zh-Hans")
    labels = _labels(view)
    assert labels["Custom Knack"] == "Custom Knack"
    assert labels["Trench Astrology"] == "Trench Astrology"


def test_zh_hans_without_pf_uses_table_vocabulary():
    character = {
        "id": "ada",
        "skills": {"Spot Hidden": 70, "First Aid": 40},
    }
    view = web_views._display_character(REPO_ROOT, character, "zh-Hans")
    labels = _labels(view)
    assert labels["Spot Hidden"] == "侦查"
    assert labels["First Aid"] == "急救"


def test_en_us_keeps_english_machine_keys():
    character = {
        "id": "ada",
        "skills": {"Spot Hidden": 70, "Trench Astrology": 15},
        "player_facing_sheet_zh": {
            "skills": [
                {"key": "Spot Hidden", "label": "侦查", "value": 70},
            ]
        },
    }
    view = web_views._display_character(REPO_ROOT, character, "en-US")
    labels = _labels(view)
    assert labels["Spot Hidden"] == "Spot Hidden"
    assert labels["Trench Astrology"] == "Trench Astrology"


def test_display_character_zh_hans_does_not_keep_stale_english_skill_labels(
    tmp_path: Path,
):
    scripts = REPO_ROOT / "plugins" / "coc-keeper" / "scripts"
    coc_starter = _load_script("coc_starter_skill_view", scripts / "coc_starter.py")
    workspace = tmp_path / "ws"
    coc_root = workspace / ".coc"
    coc_root.mkdir(parents=True)
    (coc_root / "runtime.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "planner": {"kind": "deterministic"},
                "rules": {"kind": "deterministic"},
                "narrator": {"kind": "template"},
                "player": {"kind": "human"},
            }
        ),
        "utf-8",
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id="rpc-skill-labels",
        title="RPC Skill Labels",
    )
    inv = str(quick["investigator_id"])
    path = workspace / ".coc" / "investigators" / inv / "character.json"
    raw = json.loads(path.read_text("utf-8"))
    raw["player_facing_sheet_zh"]["skills"] = [
        {"key": key, "label": key, "value": value}
        for key, value in raw["skills"].items()
    ]
    path.write_text(json.dumps(raw, ensure_ascii=False), "utf-8")
    sheet = web_views.display_character(
        workspace, inv, "zh-Hans", campaign_id="rpc-skill-labels"
    )
    assert sheet is not None
    labels = _labels(sheet)
    assert labels["Spot Hidden"] == "侦查"
    assert labels["Library Use"] == "图书馆使用"
    assert labels["Listen"] == "聆听"
    assert labels["Stealth"] == "潜行"
    assert labels["Persuade"] == "说服"
