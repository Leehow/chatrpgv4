import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = ROOT / "plugins" / "coc-keeper"
EXPECTED_PLUGIN_VERSION = "0.4.0-alpha.0"


def _json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _text(path: Path):
    return path.read_text(encoding="utf-8")


def test_all_host_manifests_share_the_040a_version():
    marketplace = _json(ROOT / ".claude-plugin" / "marketplace.json")
    versions = {
        _json(PLUGIN_ROOT / ".codex-plugin" / "plugin.json")["version"],
        _json(PLUGIN_ROOT / ".claude-plugin" / "plugin.json")["version"],
        _json(PLUGIN_ROOT / ".cursor-plugin" / "plugin.json")["version"],
        marketplace["plugins"][0]["version"],
    }
    assert versions == {EXPECTED_PLUGIN_VERSION}


def test_plugin_is_single_track_with_thin_host_entries():
    assert (PLUGIN_ROOT / "skills" / "coc-main" / "SKILL.md").is_file()
    assert (ROOT / ".cursor" / "skills" / "coc-keeper" / "SKILL.md").is_file()
    assert not (ROOT / ".cursor" / "skills" / "coc-main").exists()
    assert not (ROOT / "plugins" / "coc-keeper-zcode").exists()


def test_canonical_skills_have_matching_frontmatter_names():
    skill_root = PLUGIN_ROOT / "skills"
    skill_dirs = sorted(path for path in skill_root.iterdir() if path.is_dir())
    assert skill_dirs
    for directory in skill_dirs:
        skill_path = directory / "SKILL.md"
        assert skill_path.is_file(), directory
        text = _text(skill_path)
        match = re.search(r"\A---\s*\nname:\s*([^\n]+)", text)
        assert match, skill_path
        assert match.group(1).strip() == directory.name


def test_required_canonical_skills_are_present():
    names = {
        path.name
        for path in (PLUGIN_ROOT / "skills").iterdir()
        if path.is_dir()
    }
    assert {
        "coc-main",
        "coc-keeper-play",
        "coc-playtest",
        "coc-export-battle-report",
        "coc-campaign-state",
        "coc-rules-engine",
        "trpg-pdf-ingest",
    } <= names


def test_codex_only_image_generation_stays_explicitly_gated():
    character = _text(PLUGIN_ROOT / "skills" / "coc-character" / "SKILL.md")
    assert "CODEX_ONLY_IMAGEGEN_BEGIN" in character
    assert "CODEX_ONLY_IMAGEGEN_END" in character
    assert character.index("CODEX_ONLY_IMAGEGEN_BEGIN") < character.index(
        "CODEX_ONLY_IMAGEGEN_END"
    )


def test_playtest_skill_defines_real_plugin_context_free_player_acceptance():
    text = _text(PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md")
    compact = " ".join(text.split()).lower()
    for phrase in (
        "main codex",
        "canonical `coc-keeper` plugin",
        "fork_turns: none",
        "player-safe",
        "fresh isolated workspace",
        "coc-export-battle-report",
        "structured ending",
    ):
        assert phrase in compact
    for obsolete in (
        "coc_eval.py",
        "haunting_module",
        "chase_drill",
        "coc_playtest_harness.py",
        "coc_interactive_playtest.py",
    ):
        assert obsolete not in text


def test_final_report_skill_is_the_single_readable_report_owner():
    text = _text(
        PLUGIN_ROOT / "skills" / "coc-export-battle-report" / "SKILL.md"
    )
    compact = " ".join(text.split()).lower()
    assert "only final battle-report writer" in compact
    assert "battle-report.md" in text
    assert "battle-report-evidence.json" in text
    assert "public" in text and "consequence_public" in text
    assert "read `battle-report.md` end to end" in text
    assert "coc_eval.py" not in text
    assert "supplementary" not in compact


def test_pdf_ingest_is_an_external_skill_source_bundle_boundary():
    main = _text(PLUGIN_ROOT / "skills" / "coc-main" / "SKILL.md")
    ingest = _text(PLUGIN_ROOT / "skills" / "trpg-pdf-ingest" / "SKILL.md")
    playtest = _text(PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md")
    combined = "\n".join((main, ingest, playtest)).lower()
    assert "external pdf skill" in combined
    assert "source bundle" in combined or "source-bundle" in combined
    assert "repository has no pdf parser fallback" in combined
    assert "coc_pdf_bundle.py" in combined


def test_current_skills_reject_legacy_or_mismatched_runtime_state():
    combined = "\n".join(
        _text(PLUGIN_ROOT / "skills" / name / "SKILL.md").lower()
        for name in ("coc-main", "coc-campaign-state", "coc-playtest")
    )
    assert "exact-schema" in combined or "exact current" in combined
    assert "legacy" in combined or "mismatched" in combined
    assert "start fresh" in combined or "fresh campaign" in combined
