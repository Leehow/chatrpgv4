import importlib.util
import json
import stat
from pathlib import Path

import pytest


SCRIPT_PATH = Path("plugins/coc-keeper/scripts/coc_character_card.py")


def _load_card_script():
    spec = importlib.util.spec_from_file_location("coc_character_card", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_direct_reusable_render_rejects_active_development_before_output(tmp_path):
    card_script = _load_card_script()
    coc_root = tmp_path / ".coc"
    investigator_id = "guarded-render"
    character_path = (
        coc_root / "investigators" / investigator_id / "character.json"
    )
    campaign_path = coc_root / "campaigns" / "camp" / "campaign.json"
    character_path.parent.mkdir(parents=True)
    campaign_path.parent.mkdir(parents=True)
    character_path.write_text(json.dumps({
        "id": investigator_id,
        "identity": {"name": "Guarded Render"},
        "player_facing_sheet_zh": {
            "display_name": "受保护的调查员",
            "characteristics": {},
            "derived": {},
            "skills": [],
            "weapons": [],
            "backstory_summary": "稳定快照测试。",
        },
    }, ensure_ascii=False), encoding="utf-8")
    campaign_path.write_text(
        json.dumps({"campaign_id": "camp", "title": "Guard Test"}),
        encoding="utf-8",
    )
    ending_id = "ending-render-guard"
    transaction_id = (
        card_script.coc_investigator_guard._expected_transaction_id(
            ending_id, investigator_id
        )
    )
    marker_path = character_path.with_name(
        "development-active-transaction.json"
    )
    marker_path.write_text(json.dumps({
        "schema_version": 2,
        "status": "active",
        "transaction_id": transaction_id,
        "investigator_id": investigator_id,
        "campaign_id": "foreign-campaign",
        "ending_id": ending_id,
        "inflight_ref": (
            "campaigns/foreign-campaign/save/development-settlements/"
            "endings/ending-render-guard/guarded-render.inflight.json"
        ),
        "created_at": "2026-07-16T00:00:00Z",
        "phase": "creating",
        "journal_sha256": None,
        "next_journal_sha256": None,
        "transition_at": None,
    }), encoding="utf-8")
    tracked = {
        character_path: character_path.read_bytes(),
        campaign_path: campaign_path.read_bytes(),
        marker_path: marker_path.read_bytes(),
    }
    out_dir = tmp_path / "cards"

    with pytest.raises(
        card_script.coc_investigator_guard.ReusableInvestigatorRecoveryConflict
    ) as exc_info:
        card_script.render_cards(
            character_path,
            campaign_path,
            out_dir,
            repo_root=tmp_path,
            html_mode="never",
        )

    assert exc_info.value.code == "RECOVERY_CONFLICT"
    assert not out_dir.exists()
    assert {path: path.read_bytes() for path in tracked} == tracked


def test_render_cards_outputs_markdown_only_when_auto_detects_no_playwright(tmp_path):
    card_script = _load_card_script()
    portrait = tmp_path / "assets" / "portraits" / "aino.png"
    portrait.parent.mkdir(parents=True)
    portrait.write_bytes(b"not really a png, only a path fixture")
    campaign = {
        "title": "Masks of Nyarlathotep",
        "localized_terms": {"zh-Hans": {"Masks of Nyarlathotep": "《奈亚拉托提普的面具》"}},
    }
    character = {
        "identity": {"name": "Aino Rautio"},
        "portrait": {"asset_path": "assets/portraits/aino.png"},
        "player_facing_sheet_zh": {
            "display_name": "艾诺·劳蒂奥",
            "portrait_path": "assets/portraits/aino.png",
            "era": "1925",
            "nationality": "芬兰",
            "age": 44,
            "occupation": "神秘学学者",
            "characteristics": {
                "力量": {"key": "STR", "value": 35},
                "教育": {"key": "EDU", "value": 70},
            },
            "derived": {"生命值": 11, "理智": 70},
            "skills": [
                {"label": "射击（手枪）", "key": "Firearms (Handgun)", "value": 70, "half": 35, "fifth": 14},
                {"label": "图书馆使用", "key": "Library Use", "value": 70, "half": 35, "fifth": 14},
            ],
            "weapons": [
                {
                    "label": "捷克 CZ vz. 24 自动手枪",
                    "skill_label": "射击（手枪）",
                    "damage": "1D8",
                    "range": "15码",
                    "ammo_capacity": 8,
                    "malfunction": 99,
                }
            ],
            "backstory_summary": "芬兰北方出身的神秘学讲师。",
        },
        "backstory": {"traits": ["冷静", "避免近身冲突"]},
    }
    campaign_path = tmp_path / "campaign.json"
    character_path = tmp_path / "character.json"
    campaign_path.write_text(json.dumps(campaign), encoding="utf-8")
    character_path.write_text(json.dumps(character, ensure_ascii=False), encoding="utf-8")

    result = card_script.render_cards(
        character_path,
        campaign_path,
        tmp_path / "cards",
        repo_root=tmp_path,
        language="zh-Hans",
        html_mode="auto",
        playwright_detected=False,
        write_back=True,
    )

    markdown = (tmp_path / result["markdown_path"]).read_text(encoding="utf-8")
    written_character = json.loads(character_path.read_text(encoding="utf-8"))

    assert "![艾诺·劳蒂奥 立绘](../assets/portraits/aino.png)" in markdown
    assert "射击（手枪）" in markdown
    assert "html_path" not in result
    assert not (tmp_path / "cards" / "aino-rautio-character-card.html").exists()
    assert written_character["character_cards"]["markdown_path"] == result["markdown_path"]
    assert "html_path" not in written_character["character_cards"]


def test_render_cards_auto_outputs_html_when_playwright_is_detected(tmp_path):
    card_script = _load_card_script()
    portrait = tmp_path / "assets" / "portraits" / "aino.png"
    portrait.parent.mkdir(parents=True)
    portrait.write_bytes(b"not really a png, only a path fixture")
    campaign_path = tmp_path / "campaign.json"
    character_path = tmp_path / "character.json"
    campaign_path.write_text(
        json.dumps(
            {
                "title": "Masks of Nyarlathotep",
                "localized_terms": {"zh-Hans": {"Masks of Nyarlathotep": "《奈亚拉托提普的面具》"}},
            }
        ),
        encoding="utf-8",
    )
    character_path.write_text(
        json.dumps(
            {
                "identity": {"name": "Aino Rautio"},
                "player_facing_sheet_zh": {
                    "display_name": "艾诺·劳蒂奥",
                    "portrait_path": "assets/portraits/aino.png",
                    "era": "1925",
                    "nationality": "芬兰",
                    "age": 44,
                    "occupation": "神秘学学者",
                    "characteristics": {"力量": {"key": "STR", "value": 35}},
                    "derived": {"生命值": 11},
                    "skills": [
                        {"label": "射击（手枪）", "key": "Firearms (Handgun)", "value": 70, "half": 35, "fifth": 14}
                    ],
                    "weapons": [],
                    "backstory_summary": "芬兰北方出身的神秘学讲师。",
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    result = card_script.render_cards(
        character_path,
        campaign_path,
        tmp_path / "cards",
        repo_root=tmp_path,
        language="zh-Hans",
        html_mode="auto",
        playwright_detected=True,
    )

    html = (tmp_path / result["html_path"]).read_text(encoding="utf-8")

    assert "《奈亚拉托提普的面具》" in html
    assert "src=\"../assets/portraits/aino.png\"" in html
    assert "由 coc_character_card.py 生成" in html


def test_render_cards_can_force_html_even_without_playwright(tmp_path):
    card_script = _load_card_script()
    campaign_path = tmp_path / "campaign.json"
    character_path = tmp_path / "character.json"
    campaign_path.write_text(json.dumps({"title": "Masks of Nyarlathotep"}), encoding="utf-8")
    character_path.write_text(
        json.dumps(
            {
                "identity": {"name": "Aino Rautio"},
                "player_facing_sheet_zh": {
                    "display_name": "艾诺·劳蒂奥",
                    "era": "1925",
                    "nationality": "芬兰",
                    "age": 44,
                    "occupation": "神秘学学者",
                    "characteristics": {"力量": {"key": "STR", "value": 35}},
                    "derived": {"生命值": 11},
                    "skills": [],
                    "weapons": [],
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    result = card_script.render_cards(
        character_path,
        campaign_path,
        tmp_path / "cards",
        repo_root=tmp_path,
        language="zh-Hans",
        html_mode="always",
        playwright_detected=False,
    )

    assert "html_path" in result


def test_render_cards_does_not_fallback_to_raw_backstory_for_chinese_sheet(tmp_path):
    card_script = _load_card_script()
    campaign_path = tmp_path / "campaign.json"
    character_path = tmp_path / "character.json"
    campaign_path.write_text(json.dumps({"title": "Masks of Nyarlathotep"}), encoding="utf-8")
    character_path.write_text(
        json.dumps(
            {
                "identity": {"name": "Aino Rautio"},
                "player_facing_sheet_zh": {
                    "display_name": "艾诺·劳蒂奥",
                    "era": "1925",
                    "nationality": "芬兰",
                    "age": 44,
                    "occupation": "神秘学学者",
                    "characteristics": {"力量": {"key": "STR", "value": 35}},
                    "derived": {"生命值": 11},
                    "skills": [],
                    "weapons": [],
                    "backstory_summary": "芬兰北方出身的神秘学讲师。",
                },
                "backstory": {
                    "traits": ["calm under pressure"],
                    "significant_people": ["mentor in Stockholm"],
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    result = card_script.render_cards(
        character_path,
        campaign_path,
        tmp_path / "cards",
        repo_root=tmp_path,
        language="zh-Hans",
        html_mode="never",
    )

    markdown = (tmp_path / result["markdown_path"]).read_text(encoding="utf-8")

    assert "芬兰北方出身" in markdown
    assert "calm under pressure" not in markdown
    assert "mentor in Stockholm" not in markdown


def test_character_card_script_is_directly_executable():
    mode = SCRIPT_PATH.stat().st_mode

    assert mode & stat.S_IXUSR
