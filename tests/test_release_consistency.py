import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = ROOT / "plugins" / "coc-keeper"
RELEASE_VERSION = "0.16.0-alpha.1"
CURRENT_STATUS_PATH = "docs/status/CURRENT.md"
HISTORICAL_BANNER = (
    "> **HISTORICAL — DO NOT EXECUTE.** "
    "Current status lives in `docs/status/CURRENT.md`."
)
LIVE_NOTES_BANNER = (
    "> **HISTORICAL EVIDENCE ONLY.** "
    "Live issue status is maintained in `docs/status/CURRENT.md`."
)


def _read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def manifest_versions():
    claude_marketplace = _read_json(ROOT / ".claude-plugin" / "marketplace.json")
    return [
        _read_json(PLUGIN_ROOT / ".codex-plugin" / "plugin.json")["version"],
        _read_json(PLUGIN_ROOT / ".claude-plugin" / "plugin.json")["version"],
        _read_json(PLUGIN_ROOT / ".cursor-plugin" / "plugin.json")["version"],
        claude_marketplace["plugins"][0]["version"],
    ]


def documented_starter_ids(readme: str | None = None):
    if readme is None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
    return set(
        re.findall(
            r"`plugins/coc-keeper/references/starter-scenarios/([a-z0-9-]+)/?`",
            readme,
        )
    )


def packaged_starter_ids():
    starter_root = PLUGIN_ROOT / "references" / "starter-scenarios"
    ids = set()
    for path in starter_root.iterdir():
        meta_path = path / "module-meta.json"
        if not meta_path.is_file():
            continue
        scenario_id = _read_json(meta_path)["scenario_id"]
        assert scenario_id == path.name
        ids.add(scenario_id)
    return ids


def _inventory_row(text: str, asset_group: str):
    prefix = f"| {asset_group} |"
    rows = [line for line in text.splitlines() if line.startswith(prefix)]
    assert len(rows) == 1, f"expected one inventory row for {asset_group!r}, got {rows}"
    return rows[0]


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


def test_release_version_is_consistent():
    assert all(version == RELEASE_VERSION for version in manifest_versions())


def test_readme_matches_packaged_starters():
    assert documented_starter_ids() == packaged_starter_ids()


def test_starter_identity_check_rejects_same_count_with_wrong_id():
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    mutated = readme.replace(
        "starter-scenarios/the-haunting/",
        "starter-scenarios/not-the-haunting/",
    )
    assert len(documented_starter_ids(mutated)) == len(packaged_starter_ids())
    assert documented_starter_ids(mutated) != packaged_starter_ids()


def test_release_documents_share_version_and_current_status_authority():
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    current = (ROOT / CURRENT_STATUS_PATH).read_text(encoding="utf-8")
    historical_audit = (
        ROOT / "docs/superpowers/specs/2026-07-10-next-phase-optimization-audit.md"
    ).read_text(encoding="utf-8")

    assert f"**`{RELEASE_VERSION}`**" in readme
    assert f"]({CURRENT_STATUS_PATH})" in readme
    assert f"## [Unreleased] — manifest `{RELEASE_VERSION}`" in changelog
    assert f"唯一实时状态来源是 `{CURRENT_STATUS_PATH}`" in changelog
    assert f"**Current manifest version:** `{RELEASE_VERSION}`" in current
    assert "only live status source" in current
    assert HISTORICAL_BANNER in historical_audit


def test_content_inventory_covers_all_declared_python_dependencies():
    inventory = (ROOT / "CONTENT_LICENSES.md").read_text(encoding="utf-8")

    test_row = _inventory_row(inventory, "Python test dependency")
    assert all(term in test_row for term in ("`pytest`", ".github/workflows/tests.yml"))

    for removed in (
        "Python runtime PDF dependency",
        "PDF-ingest parser dependency",
        "Optional PDF-ingest overlay dependency",
    ):
        assert removed not in inventory


def test_extreme_cold_reveal_resolution_is_consistent_across_status_sources():
    current = (ROOT / CURRENT_STATUS_PATH).read_text(encoding="utf-8")
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    notes = (ROOT / "docs/live-playtest-notes.md").read_text(encoding="utf-8")

    assert "### Resolved: Extreme-cold REVEAL time advance" in current
    assert "### Open: Extreme-cold REVEAL time advance" not in current
    for term in ("`REVEAL`", "`single_room_search`", "20 minutes", "`quick_observation`"):
        assert term in current
    assert "极寒场景" in changelog
    assert "`quick_observation`" in changelog
    known_issues = changelog.split("### Known Issues", 1)[1].split("## [", 1)[0]
    assert "极寒场景" not in known_issues
    assert "## Fixed - Director Time Advance In Extreme Cold Scenes" in notes
    assert (
        "test_live_turn_quick_observation_in_extreme_cold_persists_short_time_and_defers_exposure"
        in notes
    )


def test_changelog_does_not_delegate_live_status_to_playtest_notes():
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")

    assert "`docs/live-playtest-notes.md` 中保持 Open" not in changelog
    assert "historical evidence only" in changelog
    assert f"live status remains in `{CURRENT_STATUS_PATH}`" in changelog


def test_live_playtest_notes_are_historical_evidence_only():
    notes = (ROOT / "docs/live-playtest-notes.md").read_text(encoding="utf-8")

    assert LIVE_NOTES_BANNER in notes
    assert "## Open - Director Time Advance In Extreme Cold Scenes" not in notes


def test_rulebook_extracts_are_not_tracked():
    assert tracked_extract_paths() == []


def test_official_docs_name_real_model_roles_and_nightly_baseline_flow():
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    playtest_skill = (
        PLUGIN_ROOT / "skills" / "coc-playtest" / "SKILL.md"
    ).read_text(encoding="utf-8")
    combined = readme + playtest_skill
    for value in ("glm-5.2", "gpt-5.6-luna", "gpt-5.6-sol", "--baseline"):
        assert value in combined, f"official docs missing {value!r}"
