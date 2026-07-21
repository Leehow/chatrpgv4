"""Ruleset package conformance suite (docs/ruleset-contract.md §9).

Phase 1: the real `coc7` package lives under `plugins/coc-keeper/rulesets/`
with its L2 skill pack (the eight rule-craft skills), so the parametrized
sweep validates it directly. The broken/valid fixture packages below are the
vacuous-pass protection: a conformance check that cannot fail a deliberately
broken package is worthless.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = ROOT / "plugins" / "coc-keeper"
RULESETS_ROOT = PLUGIN_ROOT / "rulesets"
SCRIPTS = str(PLUGIN_ROOT / "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

import ruleset_conformance


def _package_dirs() -> list[Path]:
    if not RULESETS_ROOT.is_dir():
        return []
    return sorted(
        path for path in RULESETS_ROOT.iterdir() if path.is_dir()
    )


_NO_PACKAGES = pytest.param(
    None,
    marks=pytest.mark.skip(
        reason="plugins/coc-keeper/rulesets/ does not exist yet "
        "(packages arrive in Phase 1)"
    ),
)


@pytest.mark.parametrize(
    "package_dir",
    _package_dirs() or [_NO_PACKAGES],
    ids=lambda p: p.name if isinstance(p, Path) else "no-packages-yet",
)
def test_packaged_rulesets_conform(package_dir: Path | None):
    assert package_dir is not None  # skipped via mark when empty
    assert ruleset_conformance.validate_package(package_dir) == []


def test_coc7_skill_pack_frontmatter_sweep_is_nonvacuous():
    """The real coc7 pack must actually contain the eight rule-craft skills.

    A frontmatter sweep over an empty or moved-away pack would pass vacuously;
    pin the contract §7 enumeration so that cannot happen silently.
    """
    pack = RULESETS_ROOT / "coc7" / "skills"
    skill_paths = sorted(pack.glob("*/SKILL.md"))
    assert {path.parent.name for path in skill_paths} == {
        "coc-rules-engine",
        "coc-sanity",
        "coc-combat",
        "coc-chase",
        "coc-magic",
        "coc-character",
        "coc-mythos-reference",
        "coc-development",
    }
    assert ruleset_conformance.validate_package(RULESETS_ROOT / "coc7") == []


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _write_json(path: Path, data: dict) -> None:
    _write(path, json.dumps(data, indent=2))


def _build_minimal_package(package_dir: Path) -> None:
    ruleset_id = package_dir.name
    _write_json(
        package_dir / "manifest.json",
        {
            "ruleset_id": ruleset_id,
            "name": "Minimal Test Ruleset",
            "version": "0.1.0",
            "resolution_model": "percentile",
            "schema_versions": {"campaign": 1, "actor": 1},
            "entry_points": {
                "resolver": "resolver.py",
                "skills": "skills/",
                "data": "rules-json/",
            },
            "resources": [
                {
                    "key": "hp",
                    "display": "HP",
                    "kind": "pool",
                    "reset": "never",
                    "recovery_rule": "natural healing 1/day (test ref)",
                }
            ],
        },
    )
    _write(
        package_dir / "resolver.py",
        "def check(**kwargs):\n"
        "    return {'ok': True}\n"
        "\n"
        "def resource_delta(**kwargs):\n"
        "    return {'ok': True}\n"
        "\n"
        "def public_api_index():\n"
        "    return ['check', 'resource_delta']\n",
    )
    _write_json(
        package_dir / "rules-json" / "metadata.json",
        {"schema_version": 1, "ruleset": ruleset_id},
    )
    _write_json(package_dir / "rules-json" / "test-table.json", {"rows": []})
    _write_json(
        package_dir / "rules-json" / "rule-index.json",
        {
            "schema_version": 1,
            "rules": [
                {
                    "id": "core.test_check",
                    "category": "core_resolution",
                    "source_table": "test-table.json",
                    "source_note": "test fixture",
                }
            ],
        },
    )
    _write(
        package_dir / "skills" / "test-skill" / "SKILL.md",
        "---\n"
        "name: test-skill\n"
        "description: minimal fixture skill\n"
        "---\n"
        "\n"
        "# Test skill\n",
    )


def test_valid_minimal_package_passes(tmp_path: Path):
    package_dir = tmp_path / "testrs"
    _build_minimal_package(package_dir)
    assert ruleset_conformance.validate_package(package_dir) == []


def test_broken_package_fails_conformance(tmp_path: Path):
    package_dir = tmp_path / "brokenrs"
    _build_minimal_package(package_dir)

    # Manifest: invalid resolution_model + ruleset_id mismatch with dir name.
    manifest_path = package_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["ruleset_id"] = "not-the-dir-name"
    manifest["resolution_model"] = "d100-chaos"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # Resolver missing the required `check` callable.
    _write(
        package_dir / "resolver.py",
        "def resource_delta(**kwargs):\n"
        "    return {'ok': True}\n"
        "\n"
        "def public_api_index():\n"
        "    return []\n",
    )

    # Rule index: duplicate id and a source_table that does not exist.
    _write_json(
        package_dir / "rules-json" / "rule-index.json",
        {
            "schema_version": 1,
            "rules": [
                {
                    "id": "core.test_check",
                    "category": "core_resolution",
                    "source_table": "test-table.json",
                    "source_note": "dup one",
                },
                {
                    "id": "core.test_check",
                    "category": "core_resolution",
                    "source_table": "missing-table.json",
                    "source_note": "dup two + dangling table",
                },
            ],
        },
    )

    # One SKILL.md without a description.
    _write(
        package_dir / "skills" / "no-description" / "SKILL.md",
        "---\nname: no-description\n---\n\n# No description\n",
    )

    problems = ruleset_conformance.validate_package(package_dir)
    joined = "\n".join(problems)
    assert len(problems) >= 6, joined
    # Each class of breakage must surface at least once.
    assert "d100-chaos" in joined  # schema violation on resolution_model
    assert "does not match directory name" in joined
    assert "'check'" in joined  # resolver missing required callable
    assert "duplicate rule id" in joined
    assert "missing-table.json" in joined  # dangling source_table
    assert "'description'" in joined  # SKILL.md frontmatter gap
