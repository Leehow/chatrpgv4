"""Drift guard for the progressive lane's unregistered scene-field surface.

`coc_module_projection.RECORD_FIELD_REGISTRY` governs records that reach the
runtime through a ModuleGraph. It cannot reach the scenario documents the
raw-PDF progressive lane writes: every registry call site takes a graph, and a
progressive campaign's `scenario/` directory has none. Those documents
therefore carry top-level scene fields that no registry lists, and until this
file existed nothing anywhere would have noticed a new one appearing.

`coc_module_reachability.PROGRESSIVE_SCENE_FIELDS` is the declaration of that
surface, with a producer and a consumer named per field. This module pins it
against a committed fixture derived from real progressive output, so a tenth
field is a decision someone makes rather than a silence.

The fixture is committed on purpose. `.coc/` is gitignored and has zero tracked
files, so a test that read a local campaign directory would be unrunnable on a
fresh clone — it would pass by skipping, which is the same silence in a
different costume.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
LINT_PATH = SCRIPTS / "coc_module_reachability.py"
PROJECTION_PATH = SCRIPTS / "coc_module_projection.py"
FIXTURE = (
    ROOT / "tests" / "fixtures" / "module-reachability" / "cases"
    / "progressive-scene-fields.json"
)

#: The nine fields, restated here rather than imported, so that editing the
#: module's own constant cannot silently re-baseline this test. Changing the
#: surface means changing it in three places that must agree: the constant, the
#: fixture, and this list.
EXPECTED_PROGRESSIVE_SCENE_FIELDS = frozenset({
    "evidence_gap",
    "keeper_only",
    "keeper_secret_refs",
    "page_text_sha256",
    "parse_state",
    "source_context_mentions",
    "source_evidence",
    "source_page_indices",
    "source_span",
})


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


assert LINT_PATH.is_file(), f"{LINT_PATH} does not exist."
reachability = _load("coc_module_reachability_pf", LINT_PATH)


def _registered_scene_fields() -> frozenset[str]:
    """The graph-carrier registry's story-graph scene field set.

    Loaded from the real module, not restated: the point of the comparison
    below is that the two authorities are disjoint in fact, which a copy of
    the registry here could not establish.
    """
    projection = _load("coc_module_projection_pf", PROJECTION_PATH)
    return projection.RECORD_FIELD_REGISTRY["story-graph.json"]["scenes"]


def _fixture_scenes() -> list[dict]:
    case = json.loads(FIXTURE.read_text(encoding="utf-8"))
    scenes = case["documents"]["story-graph.json"]["scenes"]
    assert scenes, f"{FIXTURE.name} carries no scenes."
    return scenes


def _fixture_scene_fields() -> set[str]:
    fields: set[str] = set()
    for scene in _fixture_scenes():
        fields |= set(scene)
    return fields


def test_fixture_is_committed():
    """A fresh clone must be able to run this test.

    `.coc/` is gitignored, so the real campaign directories this fixture was
    derived from are not available to anyone else. If this file goes missing,
    the drift guard below has nothing to measure against.
    """
    assert FIXTURE.is_file(), (
        f"{FIXTURE} is missing. The progressive field surface can only be "
        "pinned against committed data; the campaign directories under .coc/ "
        "are gitignored and exist on one machine."
    )


def test_constant_matches_the_restated_expectation():
    assert reachability.PROGRESSIVE_SCENE_FIELDS == (
        EXPECTED_PROGRESSIVE_SCENE_FIELDS
    ), (
        "PROGRESSIVE_SCENE_FIELDS changed. That is allowed, but it is a "
        "decision: name the new field's producer and consumer in the "
        "constant's comment (or state plainly that it has none), update the "
        "fixture, then update this list."
    )


def test_declared_surface_is_exactly_what_the_fixture_carries():
    """The drift guard proper.

    The fixture's scene fields, minus everything the graph-carrier registry
    already governs, must be exactly the declared set. A tenth progressive
    field lands here as a failure instead of being carried by nobody's ledger.
    """
    carried = _fixture_scene_fields() - _registered_scene_fields()
    assert carried == set(reachability.PROGRESSIVE_SCENE_FIELDS), (
        "The progressive scene fields the fixture carries and the fields "
        "PROGRESSIVE_SCENE_FIELDS declares have drifted.\n"
        f"in the fixture but undeclared: {sorted(carried - set(reachability.PROGRESSIVE_SCENE_FIELDS))}\n"
        f"declared but not in the fixture: {sorted(set(reachability.PROGRESSIVE_SCENE_FIELDS) - carried)}"
    )


def test_every_declared_field_is_actually_present_on_a_fixture_scene():
    """Each declared field is carried, not merely listed.

    The set comparison above would also pass if a field were declared and the
    fixture happened to carry it on no scene — it cannot, since the set is
    built from the scenes, but stating it per field makes a failure name the
    field rather than a diff.
    """
    scenes = _fixture_scenes()
    missing = [
        field
        for field in sorted(reachability.PROGRESSIVE_SCENE_FIELDS)
        if not any(field in scene for scene in scenes)
    ]
    assert not missing, (
        f"{FIXTURE.name} declares these fields nowhere on any scene: {missing}"
    )


def test_declared_fields_are_disjoint_from_the_graph_registry():
    """The two authorities do not overlap, and must not start to.

    A field in both would mean either that the registry grew a reach it does
    not have, or that this constant claimed one the registry already owns.
    """
    overlap = set(reachability.PROGRESSIVE_SCENE_FIELDS) & _registered_scene_fields()
    assert not overlap, (
        "These fields are claimed by both RECORD_FIELD_REGISTRY and "
        f"PROGRESSIVE_SCENE_FIELDS: {sorted(overlap)}. Settle which carrier "
        "writes them before either authority keeps listing it."
    )


@pytest.mark.parametrize(
    "field", sorted(EXPECTED_PROGRESSIVE_SCENE_FIELDS)
)
def test_each_field_is_written_by_the_progressive_producer(field: str):
    """Every declared field is one the progressive lane actually writes.

    The producer is named per field in the constant's comment; this checks the
    weaker structural claim that the name occurs in the producing module at
    all, so a field invented here rather than observed fails.
    """
    producer = (SCRIPTS / "coc_module_project.py").read_text(encoding="utf-8")
    assert field in producer, (
        f"{field!r} is declared as a progressive scene field but "
        "coc_module_project.py never names it. A field surface is a "
        "measurement, not a guess."
    )
