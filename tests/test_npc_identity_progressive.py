"""Thin contract tests for progressive authored-NPC identity."""
from __future__ import annotations

import importlib.util
from pathlib import Path


path = Path("plugins/coc-keeper/scripts/coc_npc_identity.py")
spec = importlib.util.spec_from_file_location("coc_npc_identity_progressive", path)
identity = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(identity)


def test_deepening_profile_does_not_change_stable_identity_ref():
    stub = {"npc_id": "npc-witness", "origin": "source", "agenda": "unknown"}
    deep = {
        "npc_id": "npc-witness",
        "origin": "source",
        "agenda": "Protect the source-backed secret.",
        "voice": "Measured.",
        "role_label": "教会守护者",
        "source_refs": [{"pdf_index": 12}],
    }

    before = identity.identity_contract(stub, "opening")
    after = identity.identity_contract(deep, "opening")

    assert before["identity_ref"] == after["identity_ref"]
    assert before["profile_revision_ref"] != after["profile_revision_ref"]
    assert after["role"]["role_label"] == "教会守护者"
