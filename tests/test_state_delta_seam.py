"""A player-visible state change must be projectable AND provable.

This is the most expensive seam in the system, because breaking it costs the
whole turn rather than one field. `turn.finalize` proves every typed visible
delta against a registered canonical state operation and refuses the turn when
one cannot be proven, so an operation known to one side and not the other does
not degrade — it stops play.

That is not hypothetical. `state.characteristic_delta` was added to the visible
projection first and to the proof authority second. In between, a live table
drained 12 POW: the sheet changed, the delta projected, `turn.finalize`
rejected the turn three times with `unproven_state_delta`, and the player
received zero characters while their POW had dropped. Nothing else reported an
error, and no merge conflict was involved — the two registries simply
disagreed.

Two registries, two directions, and only one of them is load-bearing:

* A per-name branch in `_project_state_deltas` with no registration in the
  proof authority refuses turns. This must never happen.
* A registration with no per-name branch is fine when the operation reaches the
  player through the shared `player_state_receipt` contract, or when its effect
  kind is not a scalar delta at all. Those are listed below with the reason.
"""
from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
FINALIZATION = SCRIPTS / "coc_turn_finalization.py"
AUTHORITY = SCRIPTS / "coc_state_effect_authority.py"

# Registered with the proof authority, and deliberately without a per-name
# branch in the visible projection.
PROVEN_WITHOUT_A_NAMED_BRANCH = {
    "combat.resolve": "emits player_state_receipt; projected by the shared path",
    "rules.settle": "emits player_state_receipt; projected by the shared path",
    "sanity.execute": "emits player_state_receipt; projected by the shared path",
    "state.exceptional_effect": (
        "an `exceptional_effect` kind in STATE_KIND_OPERATION_NAMES, not a "
        "scalar state delta"
    ),
}


def _operations(text: str) -> set[str]:
    return set(re.findall(r'"([a-z_]+\.[a-z_]+)"', text))


def _projection_branches() -> set[str]:
    """Operations `_project_state_deltas` names explicitly.

    Scoped to that function on purpose: the file mentions several operations
    elsewhere for unrelated reasons (difficulty basis, coverage), and a
    whole-file scan reports them as seam violations they are not.
    """
    text = FINALIZATION.read_text(encoding="utf-8")
    start = text.index("def _project_state_deltas(")
    body = text[start:text.index("\ndef ", start + 10)]
    found = set(re.findall(r'tool == "([a-z_]+\.[a-z_]+)"', body))
    for group in re.findall(r"tool in \{(.*?)\}", body, re.S):
        found |= _operations(group)
    return found


def _function_body(text: str, name: str) -> str:
    start = text.index(f"def {name}(")
    return text[start:text.index("\ndef ", start + 10)]


def _proof_registry() -> set[str]:
    """Operations `writer_domains` can return a non-empty domain set for.

    Scoped to that function deliberately. An earlier draft scanned the whole
    authority module and passed even with the dispatch deleted, because the
    operation is also named in `_scalar_pairs` — a test that green-lights the
    exact defect it exists to catch is worse than no test.
    """
    text = AUTHORITY.read_text(encoding="utf-8")
    writers = set(re.findall(r'"([a-z_]+\.[a-z_]+)":\s*frozenset', text))
    kinds = _operations(
        re.search(r"STATE_KIND_OPERATION_NAMES = \{(.*?)\n\}", text, re.S).group(1)
    )
    dispatched = set(
        re.findall(r'tool == "([a-z_]+\.[a-z_]+)"', _function_body(text, "writer_domains"))
    )
    return writers | kinds | dispatched


def _scalar_pair_branches() -> set[str]:
    """Operations `_scalar_pairs` knows where to read before/after values from."""
    text = AUTHORITY.read_text(encoding="utf-8")
    return set(
        re.findall(r'tool == "([a-z_]+\.[a-z_]+)"', _function_body(text, "_scalar_pairs"))
    )


def _dispatched_writers() -> set[str]:
    text = AUTHORITY.read_text(encoding="utf-8")
    return set(
        re.findall(r'tool == "([a-z_]+\.[a-z_]+)"', _function_body(text, "writer_domains"))
    )


def test_both_registries_parse_to_something_plausible():
    """A parse that silently returns nothing would make the seam tests vacuous."""
    projection, proof = _projection_branches(), _proof_registry()
    assert len(projection) >= 15, sorted(projection)
    assert len(proof) >= 15, sorted(proof)
    for anchor in ("rules.damage", "state.characteristic_delta"):
        assert anchor in projection and anchor in proof, anchor


def test_every_projected_state_writer_can_be_proven():
    """The load-bearing direction. A gap here refuses turns.

    If this is red, the operation named below produces a player-visible delta
    that `turn.finalize` will reject, and the player gets nothing at all —
    not a missing field, the whole turn. Register it in
    `coc_state_effect_authority`, deriving its write domains from its own
    receipt so the proof stays as narrow as the write.
    """
    unprovable = sorted(_projection_branches() - _proof_registry())
    assert not unprovable, (
        "these are projected as visible state deltas and cannot be proven, so "
        "turn.finalize refuses the turn and the player receives nothing: "
        + ", ".join(unprovable)
    )


def test_every_proof_registration_reaches_the_player_somehow():
    """The other direction: provable but invisible is a silent state change.

    Legitimate when the operation uses the shared `player_state_receipt`
    contract, or when its effect kind is not a scalar delta. Anything else is
    state that moves without the player being told.
    """
    unexplained = sorted(
        _proof_registry() - _projection_branches() - set(PROVEN_WITHOUT_A_NAMED_BRANCH)
    )
    assert not unexplained, (
        "these can prove a state delta but nothing projects one for them, so a "
        "change would land without the player being told. Either emit "
        "`player_state_receipt` and let the shared path carry it, add a named "
        "branch to `_project_state_deltas`, or record it in "
        "PROVEN_WITHOUT_A_NAMED_BRANCH with the reason: " + ", ".join(unexplained)
    )


def test_the_exception_list_cannot_rot():
    """An entry that is no longer registered is a stale excuse."""
    stale = sorted(set(PROVEN_WITHOUT_A_NAMED_BRANCH) - _proof_registry())
    assert not stale, (
        "these are excused from having a projection branch but are no longer "
        "registered with the proof authority; drop the stale entries: "
        + ", ".join(stale)
    )
    assert all(
        reason.strip() for reason in PROVEN_WITHOUT_A_NAMED_BRANCH.values()
    ), "every exception must carry its reason"


def test_a_dedicated_writer_dispatch_has_somewhere_to_read_values_from():
    """`writer_domains` and `_scalar_pairs` are two halves of one registration.

    An operation with a dispatch but no pairs branch reports domains it can
    never match a value against, which fails proof exactly as loudly as no
    registration at all — and looks registered while doing it.
    """
    # An operation that emits `player_state_receipt` gets its values from the
    # shared read at the top of `_scalar_pairs` and needs no branch of its own;
    # those are already listed, with that reason, above.
    missing = sorted(
        _dispatched_writers()
        - _scalar_pair_branches()
        - set(PROVEN_WITHOUT_A_NAMED_BRANCH)
    )
    assert not missing, (
        "these have a writer_domains dispatch and no _scalar_pairs branch, so "
        "the authority claims a write domain it can never prove a value for: "
        + ", ".join(missing)
    )
