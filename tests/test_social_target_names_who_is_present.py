"""A social target that is not in the scene must be told who is.

`social_candidate_stale` carried `details={"target_ref", "active_scene_id"}`,
and both are undeclared identity fields for `rules.settle`, so the projection
stripped them and the Keeper received `details: {}` — a refusal with no
information at all — classed `invariant_terminal` with no next action.

Live on 2026-09-02: the Keeper opened a negotiation with `npc-joseph-fynche`,
a REAL authored NPC it had been narrating for several turns, who is not in the
active scene. It had written the leverage contract perfectly
(`{level: 1, source_ref: "clue:clue-crown-slab-heraldry"}`) and was told the
attempt was impossible, with nothing to act on.

The correction is to settle against a target the scene holds, or move the
intended NPC in first — so the refusal now names the present targets, in a
field that survives the identity projection.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_load("coc_toolbox_social_target_tests", SCRIPTS / "coc_toolbox.py")
kernel = _load("coc_operation_kernel_social_target_tests", SCRIPTS / "coc_operation_kernel.py")


def test_the_refusal_source_names_present_targets() -> None:
    """The raise site must carry the answer, not just echo the question."""
    source = (SCRIPTS / "coc_operation_kernel.py").read_text(encoding="utf-8")
    marker = "the semantic social target is not present in the active scene"
    assert marker in source
    block = source[source.index(marker) - 2000:source.index(marker) + 1200]
    assert "present_npc_ids" in block, (
        "the refusal must carry who IS present; target_ref and active_scene_id "
        "are stripped by the projection, so a details payload of only those "
        "reaches the Keeper as {}"
    )
    assert "present targets: " in block, (
        "the message itself must name them too, for a Keeper reading prose"
    )
