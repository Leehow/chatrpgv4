"""`rules.context` family enrichment reaches the Keeper.

This suite exists because the feature it covers was dead from the day it was
written and nobody noticed for the life of the branch.

`dispatch_rules_context` used to look its enricher up with
``globals().get("_tool_combat_context")``. That never resolved: an operation
cell's exports are written into the toolbox's globals by the loader, and the
kernel is loaded a second time under the alias ``coc_operation_kernel_runtime``
that the cells import from, so the name was in neither namespace the lookup
could see. The branch landed in bf08ad6b, after ab463b58 had already moved
combat out of the kernel, so it never ran once -- combat and sanity
``canonical_context`` reached a Keeper exactly zero times.

The repair replaced the lookup with an explicit registry. These tests hold two
things: that the families owning an enricher have registered one, and that a
real `rules.context` call actually carries the block. The second is what makes
this suite worth having -- a registration test alone would have passed against
a dispatch that ignored the registry.
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from toolbox_test_support import *  # noqa: E402,F401,F403
from toolbox_test_support import _run  # noqa: E402

import coc_operation_kernel_runtime as kernel_runtime  # noqa: E402

KERNEL_SOURCE = (
    Path(__file__).resolve().parents[1]
    / "plugins" / "coc-keeper" / "scripts" / "coc_operation_kernel.py"
).read_text(encoding="utf-8")

#: Families whose operation cell defines a context handler. A family here that
#: is not registered is the exact regression this suite exists to catch.
FAMILIES_THAT_OWN_AN_ENRICHER = ("combat", "sanity")


@pytest.mark.parametrize("family", FAMILIES_THAT_OWN_AN_ENRICHER)
def test_a_family_that_owns_an_enricher_has_registered_it(family):
    registered = kernel_runtime.registered_context_enrichers()
    assert family in registered, (
        f"{family!r} defines a rules.context handler but never registered it, "
        f"so its canonical_context silently never reaches the Keeper. "
        f"Registered: {registered}"
    )


def test_registration_refuses_something_that_cannot_be_called():
    with pytest.raises(TypeError):
        kernel_runtime.register_context_enricher("not-a-family", "nope")


def test_the_enricher_is_never_looked_up_through_globals():
    """The failure mode, asserted structurally so it cannot come back.

    A `globals().get("_tool_...")` in this file resolves to None and takes the
    whole branch with it, without an error, a warning, or a failing test.
    """
    tree = ast.parse(KERNEL_SOURCE)
    offenders = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == "get"):
            continue
        inner = func.value
        if not (isinstance(inner, ast.Call)
                and isinstance(inner.func, ast.Name)
                and inner.func.id == "globals"):
            continue
        for arg in node.args:
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                if arg.value.startswith("_tool_"):
                    offenders.append(arg.value)
    assert not offenders, (
        "the kernel reaches for an operation cell's handler through globals(): "
        f"{offenders}. That lookup cannot succeed -- cell exports go to the "
        "toolbox's globals, and this module is also loaded under the alias "
        "coc_operation_kernel_runtime. Register the enricher instead."
    )


@pytest.mark.parametrize("family", FAMILIES_THAT_OWN_AN_ENRICHER)
def test_rules_context_actually_carries_the_canonical_block(campaign_ws, family):
    """The one that would have caught the original defect.

    Registration proves a table entry exists; only a real call proves the
    dispatch reads it.
    """
    ws = campaign_ws
    context = _run(ws, "rules.context", {
        "investigator": ws["investigator_id"],
        "family": family,
    })
    assert context["ok"] is True, context
    data = context["data"]
    assert "canonical_context" in data, (
        f"rules.context for {family!r} returned no canonical_context; the "
        f"enricher did not run. Keys: {sorted(data)}"
    )
    assert isinstance(data["canonical_context"], dict)
    assert data["canonical_context"], (
        f"{family!r} canonical_context is empty; an enricher that returns "
        "nothing is indistinguishable from one that never ran"
    )


def test_a_family_with_no_enricher_gets_no_canonical_block(campaign_ws):
    """Enrichment is opt-in, so an unregistered family must stay untouched."""
    ws = campaign_ws
    context = _run(ws, "rules.context", {
        "investigator": ws["investigator_id"],
        "family": "core-check",
    })
    assert context["ok"] is True, context
    assert "canonical_context" not in context["data"]
