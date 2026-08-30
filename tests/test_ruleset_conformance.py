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
            "state_dirs": [{
                "name": "actor-state",
                "create_on_init": True,
                "role": "actor_state",
            }],
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


def test_graph_artifact_absence_remains_legal(tmp_path: Path):
    # A package shipping no rule-graph entry_points stays conformant.
    package_dir = tmp_path / "testrs"
    _build_minimal_package(package_dir)
    assert ruleset_conformance.validate_package(package_dir) == []
    manifest = json.loads((package_dir / "manifest.json").read_text(encoding="utf-8"))
    assert "rule_graph" not in manifest["entry_points"]


def test_rule_graph_artifact_missing_file_fails(tmp_path: Path):
    # Declaring a graph artifact without the file on disk must fail.
    package_dir = tmp_path / "testrs"
    _build_minimal_package(package_dir)
    manifest_path = package_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["entry_points"]["rule_graph"] = "rule-graph.json"
    manifest["entry_points"]["rule_graph_manifest"] = "rule-graph-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    problems = ruleset_conformance.validate_package(package_dir)
    assert any("rule-graph.json" in p and "missing" in p for p in problems)


def test_rule_graph_entry_points_must_be_paired(tmp_path: Path):
    package_dir = tmp_path / "testrs"
    _build_minimal_package(package_dir)
    manifest_path = package_dir / "manifest.json"

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["entry_points"]["rule_graph"] = "rule-graph.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (package_dir / "rule-graph.json").write_text(
        json.dumps({"ruleset_id": "testrs", "nodes": [], "relations": []}),
        encoding="utf-8",
    )
    problems = ruleset_conformance.validate_package(package_dir)
    assert any("declared together" in p for p in problems)

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    del manifest["entry_points"]["rule_graph"]
    manifest["entry_points"]["rule_graph_manifest"] = "rule-graph-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (package_dir / "rule-graph-manifest.json").write_text(
        json.dumps({
            "contract_id": "coc.rule-graph-build-manifest.v1",
            "schema_version": 1,
            "ruleset_id": "testrs",
            "ruleset_version": "0.1.0",
            "graph_content_digest": "a" * 64,
            "compiler_identity": "coc.rule-graph-compiler.v1",
            "review_status": "deterministic-accepted",
        }),
        encoding="utf-8",
    )
    problems = ruleset_conformance.validate_package(package_dir)
    assert any("declared together" in p for p in problems)


def test_rule_graph_manifest_identity_mismatch_fails(tmp_path: Path):
    # A manifest whose contract_id does not match the v1 build-manifest
    # contract id, or whose ruleset_id omits, must fail.
    package_dir = tmp_path / "testrs"
    _build_minimal_package(package_dir)
    manifest_path = package_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["entry_points"]["rule_graph"] = "rule-graph.json"
    manifest["entry_points"]["rule_graph_manifest"] = "rule-graph-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (package_dir / "rule-graph.json").write_text(
        json.dumps({"ruleset_id": "testrs", "nodes": [], "relations": []}), encoding="utf-8")
    (package_dir / "rule-graph-manifest.json").write_text(
        json.dumps({
            "contract_id": "coc.rule-graph-build-manifest.v1",
            "schema_version": 1,
            "ruleset_id": "testrs",
            "ruleset_version": "0.1.0",
            "source_bundles": [],
            "graph_content_digest": "a" * 64,
            "shards": [],
            "family_coverage": {},
            "family_promotion_eligibility": {},
            "data_table_dependencies": [],
            "resolver_capability_dependencies": [],
            "compiler_identity": "coc.rule-graph-compiler.v1",
            "reviewer_identity": "deterministic",
            "review_status": "deterministic-accepted",
            "findings": [],
        }), encoding="utf-8")
    assert ruleset_conformance.validate_package(package_dir) == []

    # A wrong contract_id must now fail.
    broken = json.loads((package_dir / "rule-graph-manifest.json").read_text(encoding="utf-8"))
    broken["contract_id"] = "wrong-contract"
    (package_dir / "rule-graph-manifest.json").write_text(json.dumps(broken), encoding="utf-8")
    problems = ruleset_conformance.validate_package(package_dir)
    assert any("contract_id" in p and "does not match" in p for p in problems)


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


# --------------------------------------------------------------------------- #
# Rule family runtime ownership (contract §2.2)
# --------------------------------------------------------------------------- #
_OWNERSHIP_GRAPH = {
    "ruleset_id": "testrs",
    "schema_version": 1,
    "nodes": [],
    "relations": [],
    "family_runtime_ownership": {"healing": "graph"},
    "legacy_surface_lifecycle": {"healing": "hidden"},
}
_OWNERSHIP_GRAPH_MANIFEST = {
    "contract_id": "coc.rule-graph-build-manifest.v1",
    "schema_version": 1,
    "ruleset_id": "testrs",
    "ruleset_version": "0.1.0",
    "source_bundles": [],
    "graph_content_digest": "a" * 64,
    "shards": [],
    "family_coverage": {},
    "family_promotion_eligibility": {
        "healing": {"promotion_eligible": True, "runtime_ownership": "graph"},
    },
    "data_table_dependencies": [],
    "resolver_capability_dependencies": [],
    "compiler_identity": "coc.rule-graph-compiler.v1",
    "reviewer_identity": "deterministic",
    "review_status": "deterministic-accepted",
    "findings": [],
}


def _package_with_rule_families(tmp_path: Path, families: list[dict]) -> Path:
    package_dir = tmp_path / "ownrs"
    _build_minimal_package(package_dir)
    manifest_path = package_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["rule_families"] = families
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return package_dir


def test_rule_families_absent_defaults_to_legacy_visible(tmp_path: Path):
    """A package without rule_families keeps every family legacy/visible."""
    package_dir = tmp_path / "defrs"
    _build_minimal_package(package_dir)
    assert ruleset_conformance.validate_package(package_dir) == []
    manifest = json.loads(
        (package_dir / "manifest.json").read_text(encoding="utf-8")
    )
    assert "rule_families" not in manifest


def test_rule_families_legacy_visible_entry_is_conformant(tmp_path: Path):
    package_dir = _package_with_rule_families(tmp_path, [{
        "family_id": "healing",
        "runtime_owner": "legacy",
        "legacy_surface": "visible",
    }])
    assert ruleset_conformance.validate_package(package_dir) == []


def test_rule_families_enum_rejection_is_schema_violation(tmp_path: Path):
    for bad in (
        {"service": "module", "owner": "unknown"},  # wrong keys
        {"runtime_owner": "shadow", "legacy_surface": "visible"},  # missing family_id
    ):
        package_dir = tmp_path / "enumrs"
        _build_minimal_package(package_dir)
        manifest_path = package_dir / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["rule_families"] = [bad]
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        problems = ruleset_conformance.validate_package(package_dir)
        assert any("schema violation" in p for p in problems), problems


def test_rule_families_bad_enum_value_is_rejected(tmp_path: Path):
    package_dir = _package_with_rule_families(tmp_path, [{
        "family_id": "healing",
        "runtime_owner": "quantum",
        "legacy_surface": "glowing",
    }])
    problems = ruleset_conformance.validate_package(package_dir)
    joined = "\n".join(problems)
    assert "runtime_owner must be one of" in joined
    assert "legacy_surface must be one of" in joined


def test_rule_families_shadow_requires_r1_entry_point_pair(tmp_path: Path):
    """Shadow/graph owners require the paired graph artifacts (R1 rule)."""
    package_dir = _package_with_rule_families(tmp_path, [{
        "family_id": "healing",
        "runtime_owner": "shadow",
        "legacy_surface": "visible",
    }])
    problems = ruleset_conformance.validate_package(package_dir)
    assert any(
        "requires the paired " in p and "entry_points" in p for p in problems
    ), problems


def test_rule_families_graph_owner_cannot_keep_legacy_visible(tmp_path: Path):
    package_dir = _package_with_rule_families(tmp_path, [{
        "family_id": "healing",
        "runtime_owner": "graph",
        "legacy_surface": "visible",
    }])
    problems = ruleset_conformance.validate_package(package_dir)
    assert any("graph-owned family cannot keep" in p for p in problems), problems


def test_rule_families_graph_owner_with_hidden_surface_and_artifacts_passes(
    tmp_path: Path,
):
    """graph + hidden/removed + both graph artifacts is conformant."""
    package_dir = _package_with_rule_families(tmp_path, [{
        "family_id": "healing",
        "runtime_owner": "graph",
        "legacy_surface": "hidden",
    }])
    manifest_path = package_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["entry_points"]["rule_graph"] = "rule-graph.json"
    manifest["entry_points"]["rule_graph_manifest"] = "rule-graph-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (package_dir / "rule-graph.json").write_text(
        json.dumps(_OWNERSHIP_GRAPH), encoding="utf-8"
    )
    (package_dir / "rule-graph-manifest.json").write_text(
        json.dumps(_OWNERSHIP_GRAPH_MANIFEST), encoding="utf-8"
    )
    assert ruleset_conformance.validate_package(package_dir) == []


def test_rule_families_graph_owner_requires_explicit_promotion_eligibility(
    tmp_path: Path,
):
    """A family cannot execute from RuleGraph while its own gate says no."""
    package_dir = _package_with_rule_families(tmp_path, [{
        "family_id": "healing",
        "runtime_owner": "graph",
        "legacy_surface": "hidden",
    }])
    manifest_path = package_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["entry_points"]["rule_graph"] = "rule-graph.json"
    manifest["entry_points"]["rule_graph_manifest"] = "rule-graph-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (package_dir / "rule-graph.json").write_text(
        json.dumps(_OWNERSHIP_GRAPH), encoding="utf-8"
    )
    graph_manifest = {
        **_OWNERSHIP_GRAPH_MANIFEST,
        "family_promotion_eligibility": {
            "healing": {
                "promotion_eligible": False,
                "runtime_ownership": "graph",
            },
        },
    }
    (package_dir / "rule-graph-manifest.json").write_text(
        json.dumps(graph_manifest), encoding="utf-8"
    )
    problems = ruleset_conformance.validate_package(package_dir)
    assert any(
        "graph-owned family requires promotion_eligible true" in problem
        for problem in problems
    ), problems


def test_rule_families_artifact_disagreement_fails_closed(tmp_path: Path):
    """Flipping only the package manifest is a half-flip and must fail."""
    package_dir = _package_with_rule_families(tmp_path, [{
        "family_id": "healing",
        "runtime_owner": "graph",
        "legacy_surface": "hidden",
    }])
    manifest_path = package_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["entry_points"]["rule_graph"] = "rule-graph.json"
    manifest["entry_points"]["rule_graph_manifest"] = "rule-graph-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    stale_graph = {
        **_OWNERSHIP_GRAPH,
        "family_runtime_ownership": {"healing": "shadow"},
        "legacy_surface_lifecycle": {"healing": "visible"},
    }
    stale_manifest = {
        **_OWNERSHIP_GRAPH_MANIFEST,
        "family_promotion_eligibility": {
            "healing": {"promotion_eligible": False, "runtime_ownership": "shadow"},
        },
    }
    (package_dir / "rule-graph.json").write_text(
        json.dumps(stale_graph), encoding="utf-8"
    )
    (package_dir / "rule-graph-manifest.json").write_text(
        json.dumps(stale_manifest), encoding="utf-8"
    )
    problems = ruleset_conformance.validate_package(package_dir)
    joined = "\n".join(problems)
    assert "runtime_owner disagrees" in joined, problems


def test_rule_families_unknown_family_and_duplicate_ids_rejected(tmp_path: Path):
    package_dir = _package_with_rule_families(tmp_path, [
        {"family_id": "healing", "runtime_owner": "legacy",
         "legacy_surface": "visible"},
        {"family_id": "healing", "runtime_owner": "legacy",
         "legacy_surface": "visible"},
        {"family_id": "spellsmithing", "runtime_owner": "legacy",
         "legacy_surface": "visible"},
    ])
    problems = ruleset_conformance.validate_package(package_dir)
    joined = "\n".join(problems)
    assert "duplicate family_id" in joined
    assert "not a known rule-graph family" in joined
