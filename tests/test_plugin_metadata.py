import json
from pathlib import Path


PLUGIN_ROOT = Path("plugins/coc-keeper")


def test_plugin_manifest_declares_coc_keeper_skill_plugin():
    manifest_path = PLUGIN_ROOT / ".codex-plugin" / "plugin.json"
    assert manifest_path.exists()

    manifest = json.loads(manifest_path.read_text())
    assert manifest["name"] == "coc-keeper"
    assert manifest["version"] == "0.1.0"
    assert manifest["skills"] == "./skills/"
    assert manifest["interface"]["displayName"] == "COC Keeper"
    assert "Call of Cthulhu" in manifest["description"]


def test_validate_rules_script_accepts_seed_rules():
    import importlib.util

    path = PLUGIN_ROOT / "scripts" / "coc_validate.py"
    spec = importlib.util.spec_from_file_location("coc_validate", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    assert module.validate_rules(PLUGIN_ROOT) == []


def test_all_v1_skills_have_valid_frontmatter():
    expected = {
        "coc-main",
        "coc-campaign-state",
        "coc-rules-engine",
        "coc-character",
        "coc-scenario-import",
        "coc-keeper-play",
        "coc-meta",
        "coc-playtest",
        "coc-combat",
        "coc-chase",
        "coc-sanity",
        "coc-mythos-reference",
    }
    found = set()
    for skill_path in (PLUGIN_ROOT / "skills").glob("*/SKILL.md"):
        text = skill_path.read_text()
        assert text.startswith("---\n")
        header = text.split("---", 2)[1]
        name_line = next(line for line in header.splitlines() if line.startswith("name: "))
        description_line = next(line for line in header.splitlines() if line.startswith("description: "))
        name = name_line.split(": ", 1)[1].strip()
        description = description_line.split(": ", 1)[1].strip()
        assert name == skill_path.parent.name
        assert len(description) > 40
        found.add(name)
    assert found == expected


def test_reference_documents_exist_and_use_ascii_system_markers():
    reference_names = ["mode-protocol.md", "state-schema.md", "rules-json-guide.md"]
    for name in reference_names:
        path = PLUGIN_ROOT / "references" / name
        assert path.exists()
        text = path.read_text()
        assert "[meta]" in text or name != "mode-protocol.md"
        assert "[spoiler_warning]" in text or name != "mode-protocol.md"
        for marker in ["[超游]", "[剧透警告]", "[回到游戏]"]:
            assert marker not in text


def test_coc_playtest_skill_documents_battle_report_inputs():
    text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    required_terms = [
        "campaign.json",
        "party.json",
        "scenario.json",
        "character.json",
        "transcript.jsonl",
        "rolls.jsonl",
        "events.jsonl",
        "session-summaries.jsonl",
        "player-feedback.jsonl",
        "## Run Setup",
        "## Character Dossier",
        "## Player Feedback On KP",
    ]
    for term in required_terms:
        assert term in text


def test_coc_playtest_skill_documents_rulebook_audit_loop():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "coc_playtest_harness.py",
        "coc_playtest_audit.py",
        "rulebook-audit.md",
        "pushed roll",
        "session ending",
        "mechanical detail",
        "raw payload",
        "test_gap",
        "system_gap",
        "report_gap",
        "Blueprint Cross-Check",
        "Next Loop Fix Target",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text


def test_coc_playtest_skill_documents_chase_drill_profile():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "chase-drill",
        "chase_drill",
        "save/chase.json",
        "movement actions",
        "location chain",
        "hazard",
        "barrier",
        "conflict",
        "quarry escapes",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text


def test_coc_playtest_skill_documents_suite_report_index():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "coc_playtest_suite.py",
        "suite-report.md",
        "index.json",
        "Core Coverage Matrix",
        "Non-Passing Runs",
        "character_dossier",
        "kp_player_transcript",
        "mechanical_rolls",
        "player_feedback",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text


def test_coc_playtest_skill_documents_semantic_matcher_constitution():
    skill_text = (PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md").read_text()
    spec_text = Path("docs/superpowers/specs/2026-07-03-coc-keeper-design.md").read_text()
    required_terms = [
        "Semantic Matcher Constitution",
        "natural-language matcher",
        "LLM semantic evaluator",
        "machine-controlled schema fields",
        "coverage_evaluator",
        "coverage_reasons",
    ]
    for term in required_terms:
        assert term in skill_text
        assert term in spec_text
