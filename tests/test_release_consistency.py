import json
import re
import subprocess
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = ROOT / "plugins" / "coc-keeper"
RELEASE_VERSION = "0.4.0-alpha.0"
PYTHON_RELEASE_VERSION = "0.4.0a0"
CURRENT_STATUS_PATH = "docs/status/CURRENT.md"


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _text(path: Path):
    return path.read_text(encoding="utf-8")


def manifest_versions():
    marketplace = _read_json(ROOT / ".claude-plugin" / "marketplace.json")
    return [
        _read_json(PLUGIN_ROOT / ".codex-plugin" / "plugin.json")["version"],
        _read_json(PLUGIN_ROOT / ".claude-plugin" / "plugin.json")["version"],
        _read_json(PLUGIN_ROOT / ".cursor-plugin" / "plugin.json")["version"],
        _read_json(PLUGIN_ROOT / ".zcode-plugin" / "plugin.json")["version"],
        _read_json(PLUGIN_ROOT / ".kimi-plugin" / "plugin.json")["version"],
        _read_json(PLUGIN_ROOT / ".kimi-plugin" / "kimi.plugin.json")["version"],
        marketplace["plugins"][0]["version"],
    ]


def documented_starter_ids():
    return set(
        re.findall(
            r"`plugins/coc-keeper/references/starter-scenarios/([a-z0-9-]+)/?`",
            _text(ROOT / "README.md"),
        )
    )


def packaged_starter_ids():
    ids = set()
    for path in (PLUGIN_ROOT / "references" / "starter-scenarios").iterdir():
        metadata = path / "module-meta.json"
        if metadata.is_file():
            scenario_id = _read_json(metadata)["scenario_id"]
            assert scenario_id == path.name
            ids.add(scenario_id)
    return ids


def tracked_extract_paths():
    result = subprocess.run(
        [
            "git",
            "ls-files",
            "--",
            "checks/ocr-cached/**",
            "checks/py4llm-cached/**",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.splitlines()


def test_release_versions_are_consistent():
    assert manifest_versions() == [RELEASE_VERSION] * 7
    project = tomllib.loads(_text(ROOT / "pyproject.toml"))["project"]
    assert project["version"] == PYTHON_RELEASE_VERSION


def test_release_documents_share_version_and_current_status_authority():
    readme = _text(ROOT / "README.md")
    changelog = _text(ROOT / "CHANGELOG.md")
    current = _text(ROOT / CURRENT_STATUS_PATH)

    assert f"**`{RELEASE_VERSION}`**" in readme
    assert f"]({CURRENT_STATUS_PATH})" in readme
    assert f"## [Unreleased] — manifest `{RELEASE_VERSION}`" in changelog
    assert f"**Current manifest version:** `{RELEASE_VERSION}`" in current
    assert "only live status source" in current
    assert "0.4.0a" in readme and "0.4.0a" in changelog and "0.4.0a" in current


def test_readme_matches_packaged_starters():
    assert documented_starter_ids() == packaged_starter_ids()


def test_active_docs_define_plugin_native_subagent_acceptance():
    paths = (
        ROOT / "README.md",
        ROOT / "AGENTS.md",
        ROOT / CURRENT_STATUS_PATH,
        ROOT / ".cursor" / "skills" / "coc-keeper" / "SKILL.md",
    )
    combined = "\n".join(_text(path) for path in paths)
    compact = " ".join(combined.split()).lower()
    for phrase in (
        "main codex",
        "fork_turns: \"none\"",
        "player-safe",
        "fresh isolated workspace",
        "coc-export-battle-report",
        "artifacts/battle-report.md",
    ):
        assert phrase in compact
    assert "coc_eval.py" not in combined
    assert "coc_playtest_harness.py" not in combined


def test_readable_report_has_one_named_skill_owner():
    readme = _text(ROOT / "README.md")
    agents = _text(ROOT / "AGENTS.md")
    current = _text(ROOT / CURRENT_STATUS_PATH)
    for text in (readme, agents, current):
        assert "coc-export-battle-report" in text
        assert "battle-report.md" in text
    skill = _text(
        PLUGIN_ROOT / "skills" / "coc-export-battle-report" / "SKILL.md"
    )
    assert "only final battle-report writer" in " ".join(skill.split()).lower()


def test_pdf_docs_define_external_skill_and_no_repository_fallback():
    combined = "\n".join(
        _text(path)
        for path in (
            ROOT / "README.md",
            ROOT / "AGENTS.md",
            ROOT / CURRENT_STATUS_PATH,
            ROOT / "CONTENT_LICENSES.md",
        )
    ).lower()
    assert "external" in combined and "pdf skill" in combined
    assert "source bundle" in combined or "source-bundle" in combined
    assert "no pdf parser" in combined
    assert "ocr fallback" in combined


def test_content_inventory_has_no_removed_player_adapter_dependency():
    inventory = _text(ROOT / "CONTENT_LICENSES.md")
    ignored = _text(ROOT / ".gitignore")
    assert "runtime/adapters/player" not in inventory
    assert "runtime/adapters/player" not in ignored
    assert "`pytest`" in inventory


def test_obsolete_active_playtest_status_docs_are_removed():
    assert not (ROOT / "docs" / "live-playtest-notes.md").exists()
    assert not (ROOT / "docs" / "status" / "MASKS-WHITEBOX-PLAYTEST.md").exists()


def test_rulebook_extracts_are_not_tracked():
    assert tracked_extract_paths() == []
