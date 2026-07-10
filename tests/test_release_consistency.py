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

    runtime_row = _inventory_row(inventory, "Python runtime PDF dependency")
    assert all(
        term in runtime_row
        for term in ("`pypdf`", "plugins/coc-keeper/scripts/coc_scenario.py", "UNVERIFIED")
    )

    parser_row = _inventory_row(inventory, "PDF-ingest parser dependency")
    assert all(
        term in parser_row
        for term in ("`pymupdf4llm`", "PyMuPDF", "`fitz`", "pdf_cache.py", "probe_pdf.py", "UNVERIFIED")
    )

    overlay_row = _inventory_row(inventory, "Optional PDF-ingest overlay dependency")
    assert all(
        term in overlay_row
        for term in ("`pdfplumber`", "render_overlay.py", "score_parse_quality.py", "UNVERIFIED")
    )
    assert "PyPI packages `pytest` and `pypdf`" not in inventory


def test_current_status_owns_extreme_cold_reveal_issue():
    current = (ROOT / CURRENT_STATUS_PATH).read_text(encoding="utf-8")

    assert "### Open: Extreme-cold REVEAL time advance" in current
    for term in ("`REVEAL`", "`single_room_search`", "20 minutes", "extreme cold"):
        assert term in current


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
