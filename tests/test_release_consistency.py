import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = ROOT / "plugins" / "coc-keeper"


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


def documented_starter_count():
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    documented_paths = set(
        re.findall(
            r"`plugins/coc-keeper/references/starter-scenarios/([a-z0-9-]+)/?`",
            readme,
        )
    )
    return len(documented_paths)


def packaged_starter_count():
    starter_root = PLUGIN_ROOT / "references" / "starter-scenarios"
    return sum(1 for path in starter_root.iterdir() if (path / "module-meta.json").is_file())


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
    assert all(version == "0.16.0-alpha.1" for version in manifest_versions())


def test_readme_matches_packaged_starters():
    assert documented_starter_count() == packaged_starter_count()


def test_rulebook_extracts_are_not_tracked():
    assert tracked_extract_paths() == []
