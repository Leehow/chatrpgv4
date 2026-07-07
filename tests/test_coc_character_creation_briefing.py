import importlib.util
import json
from pathlib import Path


SCRIPT_PATH = Path("plugins/coc-keeper/scripts/coc_character_creation_briefing.py")


def _load_briefing_script():
    spec = importlib.util.spec_from_file_location("coc_character_creation_briefing", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def test_render_briefing_writes_player_safe_markdown_and_campaign_pointer(tmp_path):
    briefing = _load_briefing_script()
    campaign_dir = tmp_path / ".coc" / "campaigns" / "case-1"
    _write_json(
        campaign_dir / "campaign.json",
        {
            "title": "Internal Test Title",
            "play_language": "zh-Hans",
            "localized_terms": {"zh-Hans": {"Masks of Nyarlathotep": "《奈亚拉托提普的面具》"}},
        },
    )
    _write_json(
        campaign_dir / "scenario" / "scenario.json",
        {
            "scenario_id": "masks",
            "title": "Masks of Nyarlathotep",
            "player_safe_summary": "公开前提：一封旧友来信把调查员带向陌生档案。",
            "source": {"title": "Masks of Nyarlathotep", "filename": "masks.pdf"},
        },
    )
    _write_json(
        campaign_dir / "scenario" / "module-meta.json",
        {
            "scenario_id": "masks",
            "title": "Masks of Nyarlathotep",
            "era": "1920s",
            "structure_type": "hybrid_mega",
            "content_flags": ["cosmic_horror", "cult_violence"],
        },
    )
    _write_json(
        campaign_dir / "scenario" / "keeper-secrets.json",
        [{"summary": "The secret solution must not appear."}],
    )
    _write_json(campaign_dir / "index" / "source-map.json", {"sources": []})

    result = briefing.render_briefing_from_campaign(
        campaign_dir,
        repo_root=tmp_path,
        write_back=True,
    )

    markdown = (tmp_path / result["briefing_path"]).read_text(encoding="utf-8")
    campaign = json.loads((campaign_dir / "campaign.json").read_text(encoding="utf-8"))

    assert markdown.startswith("# 《奈亚拉托提普的面具》：开卡序章")
    assert "玩家安全" in markdown
    assert "公开前提：一封旧友来信" in markdown
    assert "大型混合战役" in markdown
    assert "图书馆使用" in markdown
    assert "属性生成方式" in markdown
    assert "点购：460 点" in markdown
    assert "快速数组：80、70、60、60、50、50、50、40" in markdown
    assert "The secret solution" not in markdown
    assert campaign["character_creation"]["briefing_path"] == result["briefing_path"]


def test_render_briefing_uses_safe_default_when_summary_missing(tmp_path):
    briefing = _load_briefing_script()
    campaign_dir = tmp_path / ".coc" / "campaigns" / "case-2"
    _write_json(campaign_dir / "campaign.json", {"play_language": "zh-Hans"})
    _write_json(campaign_dir / "scenario" / "scenario.json", {"title": "The Case"})
    _write_json(
        campaign_dir / "scenario" / "module-meta.json",
        {"title": "The Case", "era": "1920s", "structure_type": "node_mystery"},
    )
    _write_json(campaign_dir / "index" / "source-map.json", {"sources": [{"filename": "case.pdf"}]})

    result = briefing.render_briefing_from_campaign(campaign_dir, repo_root=tmp_path)
    markdown = (tmp_path / result["briefing_path"]).read_text(encoding="utf-8")

    assert "The Case 的开卡阶段只呈现玩家安全信息" in markdown
    assert "case.pdf" in markdown
    assert "守秘人秘密" in markdown
