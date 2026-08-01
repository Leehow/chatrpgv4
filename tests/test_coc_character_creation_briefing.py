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
    assert "<!--" not in markdown
    assert campaign["character_creation"]["briefing_path"] == result["briefing_path"]
    assert campaign["character_creation"]["public_setup_sha256"] == result[
        "public_setup_sha256"
    ]
    assert len(result["public_setup_sha256"]) == 64


def test_render_briefing_localizes_progressive_structure_type(tmp_path):
    briefing = _load_briefing_script()
    campaign_dir = tmp_path / ".coc" / "campaigns" / "case-loop"
    _write_json(
        campaign_dir / "campaign.json",
        {"play_language": "zh-Hans", "era": "1890s"},
    )
    _write_json(
        campaign_dir / "scenario" / "scenario.json",
        {"title": "Loop Case"},
    )
    _write_json(
        campaign_dir / "scenario" / "module-meta.json",
        {"title": "Loop Case", "era": "1890s", "structure_type": "time_loop"},
    )

    result = briefing.render_briefing_from_campaign(
        campaign_dir,
        repo_root=tmp_path,
    )
    markdown = (tmp_path / result["briefing_path"]).read_text(encoding="utf-8")

    assert "**结构**：时间循环" in markdown


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


def test_render_briefing_omits_unavailable_machine_fields_and_internal_markers(
    tmp_path,
):
    briefing = _load_briefing_script()
    campaign_dir = tmp_path / ".coc" / "campaigns" / "case-sparse"
    _write_json(
        campaign_dir / "campaign.json",
        {"play_language": "zh-Hans"},
    )
    _write_json(
        campaign_dir / "scenario" / "scenario.json",
        {"title": "Progressive Module"},
    )
    _write_json(
        campaign_dir / "scenario" / "module-meta.json",
        {
            "title": "Progressive Module",
            "era": "unknown",
            "structure_type": "unknown",
            "player_safe_summary": (
                "Progressive import: skeleton topology; "
                "deep packs fill in on demand."
            ),
        },
    )
    _write_json(campaign_dir / "index" / "source-map.json", {"sources": []})

    result = briefing.render_briefing_from_campaign(
        campaign_dir,
        repo_root=tmp_path,
    )
    markdown = (tmp_path / result["briefing_path"]).read_text(encoding="utf-8")

    assert "**年代**" not in markdown
    assert "**结构**" not in markdown
    assert "**来源**" not in markdown
    assert "unknown" not in markdown
    assert "Progressive import: skeleton topology" not in markdown
    assert "Progressive Module" not in markdown
    assert markdown.startswith("# 调查员创建简报：开卡序章")
    assert "<!--" not in markdown
    assert "generated_at" not in markdown
    assert "generated_by" not in markdown
    assert "不要使用内置预设调查员" not in markdown
    assert "年代适配建卡" in markdown
    assert "建卡不会因此停止" in markdown
    assert "预设调查员" in markdown
    assert "creation.input_mode" not in markdown
    assert "规则包" not in markdown
    assert "宿主" not in markdown
    assert "导入流程" not in markdown
    assert "接下来请选择一种属性生成方式" not in markdown


def test_medieval_campaign_briefing_routes_to_kp_guided_era_adaptation():
    briefing = _load_briefing_script()

    markdown = briefing.render_briefing(
        {
            "title": "Medieval Campaign",
            "era": "medieval",
            "era_source": "declared",
            "play_language": "zh-Hans",
        },
        {
            "title": "Castle Mystery",
        },
        {
            # Campaign era is authoritative even when source metadata drifts.
            "era": "1920s",
            "structure_type": "branching_investigation",
        },
        {
            "sources": [{"title": "Castle Chronicle"}],
        },
        language="zh-Hans",
    )

    assert "- **年代**：medieval" in markdown
    assert "- **来源**：Castle Chronicle" in markdown
    assert "当前自动快速建卡可靠支持的年代：1920年代" in markdown
    assert "## 年代适配建卡" in markdown
    assert "不能直接套用其他年代的标准卡包；但建卡不会因此停止" in markdown
    assert "属性、幸运、衍生值和年龄调整仍按规则处理" in markdown
    assert "职业、技能取舍和名称由时代背景决定" in markdown
    assert "预设调查员" in markdown
    assert "creation.input_mode" not in markdown
    assert "暂不生成数值" not in markdown
    for jargon in ("规则包", "宿主", "流程", "导入"):
        assert jargon not in markdown
    assert "## 适合的调查员" not in markdown
    assert "## 开卡时有用的方向" not in markdown
    assert "快速数组：80、70、60、60、50、50、50、40" not in markdown
    for misplaced in ("新闻", "考古", "警务", "射击", "旧报", "图书馆使用"):
        assert misplaced not in markdown


def test_modern_campaign_briefing_names_supported_era_without_contradiction():
    briefing = _load_briefing_script()
    campaign = {
        "title": "Modern Campaign",
        "era": "modern",
        "era_source": "declared",
        "play_language": "zh-Hans",
    }
    scenario = {"title": "Modern Mystery"}
    module_meta = {"era": "1920s"}

    markdown_zh = briefing.render_briefing(
        campaign,
        scenario,
        module_meta,
        {},
        language="zh-Hans",
    )
    assert "**年代**：modern" in markdown_zh
    assert "不能直接套用其他年代的标准卡包；但建卡不会因此停止" in markdown_zh
    assert "不能套用现代" not in markdown_zh

    markdown_en = briefing.render_briefing(
        campaign,
        scenario,
        module_meta,
        {},
        language="en",
    )
    assert "Era: modern" in markdown_en
    assert "Do not copy another era's standard sheet, but character creation does not stop here." in markdown_en
    assert "Do not borrow modern" not in markdown_en


def test_progressive_placeholder_prefers_localized_source_title(tmp_path):
    briefing = _load_briefing_script()
    campaign_dir = tmp_path / ".coc" / "campaigns" / "case-source-title"
    _write_json(
        campaign_dir / "campaign.json",
        {
            "title": "Generic Campaign Shell",
            "play_language": "zh-Hans",
            "localized_terms": {
                "zh-Hans": {"Source-Backed Case": "有据可查的案件"},
            },
        },
    )
    _write_json(
        campaign_dir / "scenario" / "scenario.json",
        {"title": "Progressive Module"},
    )
    _write_json(
        campaign_dir / "scenario" / "module-meta.json",
        {"title": "Progressive Module", "era": "unknown"},
    )
    _write_json(
        campaign_dir / "index" / "source-map.json",
        {"sources": [{"title": "Source-Backed Case"}]},
    )

    result = briefing.render_briefing_from_campaign(
        campaign_dir,
        repo_root=tmp_path,
    )
    markdown = (tmp_path / result["briefing_path"]).read_text(encoding="utf-8")

    assert markdown.startswith("# 有据可查的案件：开卡序章")
    assert "- **来源**：有据可查的案件" in markdown
    assert "Progressive Module" not in markdown
    assert "Generic Campaign Shell" not in markdown


def test_source_path_only_never_reaches_player_briefing(tmp_path):
    briefing = _load_briefing_script()
    source_paths = (
        "/Users/private/project/source/secret-module.pdf",
        r"C:\Users\private\project\source\secret-module.pdf?token=private",
    )
    for index, source_path in enumerate(source_paths):
        campaign_dir = (
            tmp_path / ".coc" / "campaigns" / f"case-private-path-{index}"
        )
        _write_json(
            campaign_dir / "campaign.json",
            {
                "title": "Progressive Module",
                "play_language": "zh-Hans",
            },
        )
        _write_json(
            campaign_dir / "scenario" / "scenario.json",
            {"title": "Progressive Module"},
        )
        _write_json(
            campaign_dir / "scenario" / "module-meta.json",
            {"title": "Progressive Module", "era": "unknown"},
        )
        _write_json(
            campaign_dir / "index" / "source-map.json",
            {"sources": [{"path": source_path}]},
        )

        result = briefing.render_briefing_from_campaign(
            campaign_dir,
            repo_root=tmp_path,
        )
        markdown = (
            tmp_path / result["briefing_path"]
        ).read_text(encoding="utf-8")

        assert markdown.startswith("# 调查员创建简报：开卡序章")
        assert "**来源**" not in markdown
        assert source_path not in markdown
        assert "secret-module.pdf" not in markdown
        assert "/Users/" not in markdown
        assert r"C:\Users" not in markdown
        assert "private/project/source" not in markdown
        assert r"private\project\source" not in markdown
        assert "token=private" not in markdown


def test_filename_fallback_is_basename_only_and_strips_uri_query(tmp_path):
    briefing = _load_briefing_script()
    campaign_dir = tmp_path / ".coc" / "campaigns" / "case-safe-filename"
    _write_json(
        campaign_dir / "campaign.json",
        {
            "title": "Progressive Module",
            "play_language": "zh-Hans",
        },
    )
    _write_json(
        campaign_dir / "scenario" / "scenario.json",
        {"title": "Progressive Module"},
    )
    _write_json(
        campaign_dir / "scenario" / "module-meta.json",
        {"title": "Progressive Module"},
    )
    _write_json(
        campaign_dir / "index" / "source-map.json",
        {
            "sources": [{
                "filename": (
                    "https://files.example/private/"
                    "safe-case.pdf?token=do-not-render"
                ),
            }],
        },
    )

    result = briefing.render_briefing_from_campaign(
        campaign_dir,
        repo_root=tmp_path,
    )
    markdown = (tmp_path / result["briefing_path"]).read_text(encoding="utf-8")

    assert markdown.startswith("# safe-case.pdf：开卡序章")
    assert "- **来源**：safe-case.pdf" in markdown
    assert "files.example" not in markdown
    assert "/private/" not in markdown
    assert "token=do-not-render" not in markdown


def test_nested_encoded_and_opaque_titles_fall_back_neutrally():
    briefing = _load_briefing_script()
    rejected_titles = (
        "%252FUsers%252Fprivate%252Fsecret.pdf",
        "%252fUsers%252fprivate%252fsecret.pdf",
        "%255CUsers%255Cprivate%255Csecret.pdf",
        "mailto:private@example.com",
        "data:text/plain,private",
        "urn:private:identity",
        "file%253A%252F%252FUsers%252Fprivate%252Fsecret.pdf",
        "unsafe%2500title",
        "invalid%FFtitle",
    )
    for title in rejected_titles:
        markdown = briefing.render_briefing(
            {
                "title": "Progressive Module",
                "play_language": "zh-Hans",
            },
            {"title": title},
            {"title": "Progressive Module"},
            {"sources": []},
            language="zh-Hans",
        )

        assert markdown.startswith("# 调查员创建简报：开卡序章")
        assert title not in markdown
        assert "private@example.com" not in markdown
        assert "/Users/" not in markdown


def test_nested_encoded_filename_delimiters_and_invalid_percent_are_rejected():
    briefing = _load_briefing_script()
    over_nested = "%2Fprivate.pdf"
    for _ in range(10):
        over_nested = over_nested.replace("%", "%25")
    rejected_filenames = (
        "safe.pdf%253Ftoken=PRIVATE",
        "secret%25252Fprivate.pdf",
        "secret%25252fprivate.pdf",
        "secret%255Cprivate.pdf",
        "secret%253Aprivate.pdf",
        "secret%253Fprivate.pdf",
        "secret%2523private.pdf",
        "secret%2500private.pdf",
        "secret%FFprivate.pdf",
        "../private.pdf",
        r"..\private.pdf",
        over_nested,
    )
    for filename in rejected_filenames:
        markdown = briefing.render_briefing(
            {
                "title": "Progressive Module",
                "play_language": "zh-Hans",
            },
            {"title": "Progressive Module"},
            {"title": "Progressive Module"},
            {"sources": [{"filename": filename}]},
            language="zh-Hans",
        )

        assert markdown.startswith("# 调查员创建简报：开卡序章")
        assert "**来源**" not in markdown
        assert filename not in markdown
        assert "token=PRIVATE" not in markdown


def test_trailing_source_path_separator_never_promotes_a_directory_name():
    briefing = _load_briefing_script()
    rejected_filenames = (
        "https://files.example/Users/private/",
        "/Users/private/",
        "C:\\Users\\private\\",
        "https://files.example/Users/private/?token=PRIVATE#fragment",
        "/Users/private/?token=PRIVATE#fragment",
        "C:\\Users\\private\\?token=PRIVATE#fragment",
        "https://files.example/Users/private%2F",
        "https://files.example/Users/private%252F",
        "/Users/private%EF%BC%8F",
        "/Users/private／",
        "C:\\Users\\private＼",
    )
    for filename in rejected_filenames:
        markdown = briefing.render_briefing(
            {
                "title": "Progressive Module",
                "play_language": "zh-Hans",
            },
            {"title": "Progressive Module"},
            {"title": "Progressive Module"},
            {"sources": [{"filename": filename}]},
            language="zh-Hans",
        )

        assert markdown.startswith("# 调查员创建简报：开卡序章")
        assert "**来源**" not in markdown
        assert "private：开卡序章" not in markdown
        assert "token=PRIVATE" not in markdown


def test_paths_with_actual_source_filenames_still_expose_only_the_basename():
    briefing = _load_briefing_script()
    safe_filenames = (
        "https://files.example/Users/private/case.pdf",
        "/Users/private/case.pdf",
        "C:\\Users\\private\\case.pdf",
        "https://files.example/Users/private/case.pdf?token=PRIVATE#fragment",
    )
    for filename in safe_filenames:
        markdown = briefing.render_briefing(
            {
                "title": "Progressive Module",
                "play_language": "zh-Hans",
            },
            {"title": "Progressive Module"},
            {"title": "Progressive Module"},
            {"sources": [{"filename": filename}]},
            language="zh-Hans",
        )

        assert markdown.startswith("# case.pdf：开卡序章")
        assert "- **来源**：case.pdf" in markdown
        assert "/Users/private" not in markdown
        assert "\\Users\\private" not in markdown
        assert "files.example" not in markdown
        assert "token=PRIVATE" not in markdown


def test_safe_literal_and_encoded_unicode_identities_remain_visible():
    briefing = _load_briefing_script()
    literal_title = briefing.render_briefing(
        {"play_language": "zh-Hans"},
        {"title": "A Safe Literal Title"},
        {},
        {"sources": []},
        language="zh-Hans",
    )
    encoded_filename = briefing.render_briefing(
        {
            "title": "Progressive Module",
            "play_language": "zh-Hans",
        },
        {"title": "Progressive Module"},
        {"title": "Progressive Module"},
        {"sources": [{"filename": "safe-%E6%A1%88%E4%BB%B6.pdf"}]},
        language="zh-Hans",
    )
    literal_filename = briefing.render_briefing(
        {
            "title": "Progressive Module",
            "play_language": "zh-Hans",
        },
        {"title": "Progressive Module"},
        {"title": "Progressive Module"},
        {"sources": [{"filename": "safe-literal.pdf"}]},
        language="zh-Hans",
    )
    encoded_uri_filename = briefing.render_briefing(
        {
            "title": "Progressive Module",
            "play_language": "zh-Hans",
        },
        {"title": "Progressive Module"},
        {"title": "Progressive Module"},
        {"sources": [{"filename": "https://example.test/files/%E6%A1%88%E4%BB%B6.pdf"}]},
        language="zh-Hans",
    )
    literal_percent_title = briefing.render_briefing(
        {"play_language": "zh-Hans"},
        {"title": "The 100% Safe Case"},
        {},
        {"sources": []},
        language="zh-Hans",
    )
    non_escape_percent_title = briefing.render_briefing(
        {"play_language": "zh-Hans"},
        {"title": "The 100%ZZ Safe Case"},
        {},
        {"sources": []},
        language="zh-Hans",
    )
    literal_percent_filename = briefing.render_briefing(
        {
            "title": "Progressive Module",
            "play_language": "zh-Hans",
        },
        {"title": "Progressive Module"},
        {"title": "Progressive Module"},
        {"sources": [{"filename": "The 100% Safe Case.pdf"}]},
        language="zh-Hans",
    )
    safe_unicode_title = briefing.render_briefing(
        {"play_language": "zh-Hans"},
        {"title": "黄色之王的使者"},
        {},
        {"sources": []},
        language="zh-Hans",
    )

    assert literal_title.startswith("# A Safe Literal Title：开卡序章")
    assert encoded_filename.startswith("# safe-案件.pdf：开卡序章")
    assert "- **来源**：safe-案件.pdf" in encoded_filename
    assert literal_filename.startswith("# safe-literal.pdf：开卡序章")
    assert "- **来源**：safe-literal.pdf" in literal_filename
    assert encoded_uri_filename.startswith("# 案件.pdf：开卡序章")
    assert "- **来源**：案件.pdf" in encoded_uri_filename
    assert literal_percent_title.startswith("# The 100% Safe Case：开卡序章")
    assert non_escape_percent_title.startswith("# The 100%ZZ Safe Case：开卡序章")
    assert literal_percent_filename.startswith(
        "# The 100% Safe Case.pdf：开卡序章"
    )
    assert "- **来源**：The 100% Safe Case.pdf" in literal_percent_filename
    assert safe_unicode_title.startswith("# 黄色之王的使者：开卡序章")


def test_localized_title_and_source_are_revalidated_at_display_boundary():
    briefing = _load_briefing_script()
    unsafe_translations = (
        "/Users/private/secret.pdf",
        "mailto:private@example.com",
        "Safe%252Fprivate",
        "Safe%E2%80%AEprivate",
        "Safe％２５２Ｆprivate",
        "Safe\u202eprivate",
        "Safe\u200bprivate",
        "Safe\u2066private",
        "Safe\u2028private",
        "ｍａｉｌｔｏ：private@example.com",
    )
    for translated in unsafe_translations:
        campaign = {
            "title": "Progressive Module",
            "play_language": "zh-Hans",
            "localized_terms": {
                "zh-Hans": {
                    "Safe Case": translated,
                    "Safe Source": translated,
                },
            },
        }
        localized_title = briefing.render_briefing(
            campaign,
            {"title": "Safe Case"},
            {"title": "Progressive Module"},
            {"sources": []},
            language="zh-Hans",
        )
        localized_source = briefing.render_briefing(
            campaign,
            {"title": "Progressive Module"},
            {"title": "Progressive Module"},
            {"sources": [{"title": "Safe Source"}]},
            language="zh-Hans",
        )

        assert localized_title.startswith("# 调查员创建简报：开卡序章")
        assert "**来源**" not in localized_title
        assert translated not in localized_title
        assert localized_source.startswith("# 调查员创建简报：开卡序章")
        assert "**来源**" not in localized_source
        assert translated not in localized_source
        assert "/Users/private" not in localized_title + localized_source
        assert "private@example.com" not in localized_title + localized_source


def test_unicode_controls_separators_and_compatibility_delimiters_are_rejected():
    briefing = _load_briefing_script()
    rejected_titles = (
        "Safe\u202eprivate",
        "Safe\u200bprivate",
        "Safe\u2066private",
        "Safe\u2028private",
        "Safe\u2029private",
        "\u2028Safe private",
        "Safe\x1fprivate",
        "Safe private\n",
        "Safe\ud800private",
        "Safe／private",
        "Safe＼private",
        "Safe？token=private",
        "ｍａｉｌｔｏ：private@example.com",
        "Safe%EF%BC%8Fprivate",
        "The 100% Safe%252Fprivate",
    )
    for title in rejected_titles:
        markdown = briefing.render_briefing(
            {"play_language": "zh-Hans"},
            {"title": title},
            {},
            {"sources": []},
            language="zh-Hans",
        )

        assert markdown.startswith("# 调查员创建简报：开卡序章")
        assert title not in markdown
        assert "token=private" not in markdown
        assert "private@example.com" not in markdown


def test_unestablished_campaign_era_never_reaches_the_player_briefing():
    briefing = _load_briefing_script()
    markdown = briefing.render_briefing(
        {
            "title": "Raw PDF Campaign",
            # Placeholder written by create_campaign only to seed a clock.
            "era": "1920s",
            "era_source": "unestablished",
            "play_language": "zh-Hans",
        },
        {"title": "Unknown Period"},
        {},
        {},
        language="zh-Hans",
    )
    # The module window states no period, and the era note says so outright.
    assert "**年代**：" not in markdown
    assert "本战役年代为 **未确定**" in markdown
