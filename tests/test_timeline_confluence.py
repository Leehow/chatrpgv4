"""Deterministic tests for the timeline confluence conflict core.

Pure fixtures only: no live campaign data, no Git access, no filesystem
state beyond tmp-free in-memory projections.
"""
from __future__ import annotations

import copy
import importlib.util
import inspect
from pathlib import Path

# The module-level helper below is named ``enumerate``; these tests still
# need the builtin in a few comprehensions.
import builtins

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


tlc = _load(
    "coc_timeline_confluence_under_test", SCRIPTS / "coc_timeline_confluence.py"
)
tm = _load(
    "coc_temporal_memory_contract_confluence_test",
    SCRIPTS / "coc_temporal_memory_contract.py",
)
hist = _load("coc_git_history_confluence_test", SCRIPTS / "coc_git_history.py")

CAMPAIGN = "amaranthine-16"
MERGED = "tl-merged"
LEFT = "tl-left-fork"
RIGHT = "tl-right-fork"
CID = f"confluence-{CAMPAIGN}-{MERGED}"
CONFLICT_PREFIX = f"conflict-{CAMPAIGN}-{MERGED}"


def proj(timeline_id: str, state=None, **sections) -> dict:
    base = {"timeline_id": timeline_id, "campaign_id": CAMPAIGN, "state": state or {}}
    base.update(sections)
    return base


def enumerate(left: dict, right: dict, confluence_id: str = CID) -> dict:
    return tlc.enumerate_conflicts(left, right, confluence_id=confluence_id)


def dispositions_for(conflicts, mode="choose_left", **extra) -> dict:
    out = {}
    for conflict in conflicts:
        disposition = {
            "mode": mode,
            "receipt": f"disp-{conflict['conflict_id']}",
        }
        if conflict["class"] in tm.HARD_STATE_CONFLICT_CLASSES:
            disposition["resolver_receipt"] = f"resolve-{conflict['conflict_id']}"
        disposition.update(extra)
        out[conflict["conflict_id"]] = disposition
    return out


def build_plan(left: dict, right: dict, dispositions, **kwargs) -> dict:
    kwargs.setdefault("confluence_id", CID)
    kwargs.setdefault("timeline_id", MERGED)
    kwargs.setdefault("campaign_id", CAMPAIGN)
    return tlc.build_confluence_plan(
        left_projection=left,
        right_projection=right,
        dispositions=dispositions,
        receipt=kwargs.pop("receipt", "confluence-receipt-1"),
        schema_generation=kwargs.pop("schema_generation", "coc-schema-1"),
        **kwargs,
    )


# ---------------------------------------------------------------------------
# Identical branches
# ---------------------------------------------------------------------------


def test_identical_branches_have_no_conflicts_and_no_additions():
    left = proj(
        LEFT,
        state={"/investigators/marta/hp": 11, "/party/funds/cash": 30},
        rolls=[{"roll_id": "roll-marta-spot-turn-8", "result": 42}],
    )
    right = proj(
        RIGHT,
        state={"/party/funds/cash": 30, "/investigators/marta/hp": 11},
        rolls=[{"roll_id": "roll-marta-spot-turn-8", "result": 42}],
    )
    result = enumerate(left, right)
    assert result["conflicts"] == []
    assert result["additions"] == {"left_only": [], "right_only": []}
    assert result["parents"] == [LEFT, RIGHT]
    assert result["campaign_id"] == CAMPAIGN
    # A zero-conflict confluence is a valid plan with no dispositions.
    plan = build_plan(left, right, {})
    assert plan["conflicts"] == []
    assert len(plan["conflict_manifest_sha256"]) == 64


# ---------------------------------------------------------------------------
# Hard-state conflicts
# ---------------------------------------------------------------------------


def test_numeric_resource_conflict_is_stat_value():
    left = proj(LEFT, state={"/investigators/marta/hp": 11})
    right = proj(RIGHT, state={"/investigators/marta/hp": 7})
    result = enumerate(left, right)
    assert len(result["conflicts"]) == 1
    conflict = result["conflicts"][0]
    assert conflict["class"] == "stat_value"
    assert conflict["conflict_id"].startswith(f"{CONFLICT_PREFIX}-state-")
    assert conflict["left"] == {
        "timeline": LEFT,
        "refs": ["/investigators/marta/hp"],
        "value": 11,
    }
    assert conflict["right"] == {
        "timeline": RIGHT,
        "refs": ["/investigators/marta/hp"],
        "value": 7,
    }
    assert conflict["disposition"] is None
    assert tlc.classify_conflict(
        {"section": "state", "key": "/investigators/marta/hp", "left": 11, "right": 7}
    ) == {"class": "stat_value", "category": "hard_state", "non_duplicable": False}


def test_dead_alive_conflict_covers_explicit_and_absent_sides():
    # Explicit true vs explicit false.
    result = enumerate(
        proj(LEFT, state={"/investigators/marta/dead": True}),
        proj(RIGHT, state={"/investigators/marta/dead": False}),
    )
    assert [c["class"] for c in result["conflicts"]] == ["death"]
    assert result["conflicts"][0]["left"]["value"] is True
    assert result["conflicts"][0]["right"]["value"] is False

    # Dead on the left, key never written on the right: the absent side
    # still asserts the default (alive) — a disagreement, not an addition.
    result = enumerate(
        proj(LEFT, state={"/investigators/marta/dead": True}), proj(RIGHT)
    )
    assert [c["class"] for c in result["conflicts"]] == ["death"]
    assert result["conflicts"][0]["right"]["value"] is False
    assert result["additions"] == {"left_only": [], "right_only": []}

    # Shared death on both sides: shared history, no conflict.
    result = enumerate(
        proj(LEFT, state={"/investigators/marta/dead": True}),
        proj(RIGHT, state={"/investigators/marta/dead": True}),
    )
    assert result["conflicts"] == []

    # alive=true on one side equals the absent-side default: no conflict.
    result = enumerate(
        proj(LEFT, state={"/investigators/marta/alive": True}), proj(RIGHT)
    )
    assert result["conflicts"] == []

    death = tlc.classify_conflict(
        {"section": "state", "key": "/investigators/marta/dead", "left": True, "right": False}
    )
    assert death == {"class": "death", "category": "hard_state", "non_duplicable": True}


def test_consumed_resource_conflicts_from_transactions_and_state():
    left = proj(
        LEFT,
        state={"/party/first-aid-kit/consumed": True},
        transactions=[
            {
                "transaction_id": "tx-party-funds-turn-9",
                "kind": "cash_spend",
                "amount": 30,
            }
        ],
    )
    right = proj(
        RIGHT,
        transactions=[
            {
                "transaction_id": "tx-party-funds-turn-9",
                "kind": "cash_spend",
                "amount": 10,
            }
        ],
    )
    result = enumerate(left, right)
    classes = [c["class"] for c in result["conflicts"]]
    assert classes == ["consumed_resource", "consumed_resource"]
    by_ref = {tuple(c["left"]["refs"]): c for c in result["conflicts"]}
    tx = by_ref[("tx-party-funds-turn-9",)]
    assert tx["left"]["value"] == {"transaction_id": "tx-party-funds-turn-9", "kind": "cash_spend", "amount": 30}
    assert tx["right"]["value"]["amount"] == 10
    kit = by_ref[("/party/first-aid-kit/consumed",)]
    assert kit["right"]["value"] is False


def test_duplicate_rolls_effects_and_items_conflict_but_shared_rows_do_not():
    left = proj(
        LEFT,
        state={"/inventory/lantern/count": 1},
        rolls=[
            {"roll_id": "roll-pre-fork-listen", "result": 21},
            {"roll_id": "roll-marta-spot-turn-9", "result": 55},
        ],
        effects=[
            {"effect_id": "effect-marta-moment-insight", "bonus": 2},
        ],
    )
    right = proj(
        RIGHT,
        state={"/inventory/lantern/count": 2},
        rolls=[
            {"roll_id": "roll-pre-fork-listen", "result": 21},
            {"roll_id": "roll-marta-spot-turn-9", "result": 71},
        ],
        effects=[
            {"effect_id": "effect-marta-moment-insight", "bonus": 2, "spent": True},
        ],
    )
    result = enumerate(left, right)
    classes = sorted(c["class"] for c in result["conflicts"])
    assert classes == ["inventory_item", "one_time_effect", "roll_receipt"]
    for conflict in result["conflicts"]:
        assert tlc.classify_conflict(
            {"section": "rolls" if conflict["class"] == "roll_receipt" else "effects" if conflict["class"] == "one_time_effect" else "state", "key": conflict["left"]["refs"][0], "left": conflict["left"]["value"], "right": conflict["right"]["value"]}
        )["non_duplicable"] is (conflict["class"] in ("roll_receipt", "one_time_effect"))
    # The identical pre-fork roll produced neither a conflict nor an
    # addition: it is shared history, never double counted.
    assert all("roll-pre-fork-listen" not in entry["refs"] for entry in result["additions"]["left_only"] + result["additions"]["right_only"])


# ---------------------------------------------------------------------------
# KP-semantic conflicts
# ---------------------------------------------------------------------------


def test_npc_identity_and_relationship_conflicts_are_kp_semantic():
    left = proj(
        LEFT,
        entities=[{"entity_id": "npc-cult-leader", "display_name": "Elias Whitmore"}],
        relations=[
            {
                "from_entity_id": "investigator-marta",
                "to_entity_id": "npc-cult-leader",
                "relation_kind": "ally",
            }
        ],
    )
    right = proj(
        RIGHT,
        entities=[{"entity_id": "npc-cult-leader", "display_name": "Elias"}],
        relations=[
            {
                "from_entity_id": "investigator-marta",
                "to_entity_id": "npc-cult-leader",
                "relation_kind": "rival",
            }
        ],
    )
    result = enumerate(left, right)
    classes = sorted(c["class"] for c in result["conflicts"])
    assert classes == ["identity", "relationship"]
    for conflict in result["conflicts"]:
        classification = tlc.classify_conflict(
            {
                "section": "entities" if conflict["class"] == "identity" else "relations",
                "key": conflict["left"]["refs"][0],
                "left": conflict["left"]["value"],
                "right": conflict["right"]["value"],
            }
        )
        assert classification["category"] == "kp_semantic"
        assert classification["non_duplicable"] is False
    # KP-semantic dispositions carry no resolver_receipt requirement.
    conflicts = result["conflicts"]
    resolved = tlc.validate_dispositions(
        conflicts,
        {
            c["conflict_id"]: {"mode": "choose_left", "receipt": f"disp-{c['conflict_id']}"}
            for c in conflicts
        },
    )
    assert all(c["disposition"]["mode"] == "choose_left" for c in resolved)


def test_causality_conflict_from_structured_causal_marker():
    left = proj(
        LEFT,
        events=[{"decision_id": "dec-ritual-collapse", "event_type": "collapse"}],
    )
    right = proj(
        RIGHT,
        events=[
            {
                "decision_id": "dec-ritual-collapse",
                "event_type": "collapse",
                "caused_by": "ritual-backfire",
            }
        ],
    )
    result = enumerate(left, right)
    assert [c["class"] for c in result["conflicts"]] == ["causality"]
    # Same section without a causal marker classifies as world_fact.
    plain = enumerate(
        proj(LEFT, events=[{"decision_id": "dec-x", "note": "a"}]),
        proj(RIGHT, events=[{"decision_id": "dec-x", "note": "b"}]),
    )
    assert [c["class"] for c in plain["conflicts"]] == ["world_fact"]


# ---------------------------------------------------------------------------
# Classification matrix
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected_class"),
    [
        ({"section": "state", "key": "/investigators/marta/san", "left": 40, "right": 25}, "stat_value"),
        ({"section": "state", "key": "/party/funds/cash", "left": 30, "right": 10}, "cash"),
        ({"section": "state", "key": "/investigators/marta/major_wound", "left": False, "right": True}, "injury"),
        ({"section": "state", "key": "/inventory/revolver/count", "left": 1, "right": 2}, "inventory_item"),
        ({"section": "state", "key": "/npc/npc-cult-leader/display_name", "left": "A", "right": "B"}, "identity"),
        ({"section": "state", "key": "/party/motto", "left": "a", "right": "b"}, "world_fact"),
        ({"section": "state", "key": "/investigators/marta/is_dead", "left": True, "right": False}, "death"),
        ({"section": "rolls", "key": "roll-x", "left": {}, "right": {}}, "roll_receipt"),
        ({"section": "effects", "key": "effect-x", "left": {}, "right": {}}, "one_time_effect"),
        ({"section": "transactions", "key": "tx-x", "left": {}, "right": {}}, "consumed_resource"),
        ({"section": "receipts", "key": "fin-x", "left": {}, "right": {}}, "world_fact"),
        ({"section": "events", "key": "dec-x", "left": {}, "right": {}}, "world_fact"),
        ({"section": "relations", "key": "relation-a-to-b", "left": {}, "right": {}}, "relationship"),
        ({"section": "entities", "key": "npc-x", "left": {}, "right": {}}, "identity"),
        ({"section": "assertions", "key": "mem-x", "left": {}, "right": {}}, "memory_belief"),
    ],
)
def test_classify_conflict_matrix(raw, expected_class):
    classification = tlc.classify_conflict(raw)
    assert classification["class"] == expected_class
    expected_category = (
        "hard_state"
        if expected_class in tm.HARD_STATE_CONFLICT_CLASSES
        else "kp_semantic"
    )
    assert classification["category"] == expected_category
    assert classification["non_duplicable"] == (
        expected_class in tm.NON_DUPLICABLE_CONFLICT_CLASSES
    )


def test_classify_conflict_rejects_unknown_section_and_prose_key():
    with pytest.raises(tlc.ConfluenceConflictError, match="section"):
        tlc.classify_conflict({"section": "narration", "key": "x", "left": 1, "right": 2})
    with pytest.raises(tlc.ConfluenceConflictError, match="key"):
        tlc.classify_conflict({"section": "state", "key": "  ", "left": 1, "right": 2})
    with pytest.raises(tlc.ConfluenceConflictError, match="mapping"):
        tlc.classify_conflict("not-a-mapping")


# ---------------------------------------------------------------------------
# Dispositions
# ---------------------------------------------------------------------------


def _hard_conflict(conflict_class: str, slug: str) -> dict:
    return {
        "conflict_id": f"{CONFLICT_PREFIX}-{slug}",
        "class": conflict_class,
        "left": {"timeline": LEFT, "refs": [slug], "value": 1},
        "right": {"timeline": RIGHT, "refs": [slug], "value": 2},
        "disposition": None,
    }


def _kp_conflict(slug: str) -> dict:
    return {
        "conflict_id": f"{CONFLICT_PREFIX}-{slug}",
        "class": "identity",
        "left": {"timeline": LEFT, "refs": [slug], "value": "A"},
        "right": {"timeline": RIGHT, "refs": [slug], "value": "B"},
        "disposition": None,
    }


@pytest.mark.parametrize("mode", list(tm.DISPOSITION_MODES))
def test_every_disposition_mode_is_accepted_where_legal(mode):
    # stat_value is hard (resolver required) but duplicable: all eight
    # modes are legal on it, with a note required for defer.
    conflict = _hard_conflict("stat_value", f"mode-{mode}")
    disposition = {
        "mode": mode,
        "receipt": "disp-modes",
        "resolver_receipt": "resolve-modes",
    }
    if mode == "defer":
        disposition["note"] = "deferred until the sanatorium scene"
    resolved = tlc.validate_dispositions([conflict], {conflict["conflict_id"]: disposition})
    assert resolved[0]["disposition"]["mode"] == mode
    assert conflict["disposition"] is None  # input never mutated

    # KP-semantic conflicts need no resolver_receipt.
    kp = _kp_conflict(f"kp-{mode}")
    kp_disposition = {"mode": mode, "receipt": "disp-kp"}
    if mode == "defer":
        kp_disposition["note"] = "wait for the KP's next scene"
    resolved_kp = tlc.validate_dispositions(
        [kp], {kp["conflict_id"]: kp_disposition}
    )
    assert resolved_kp[0]["class"] == "identity"


@pytest.mark.parametrize(
    "conflict_class", list(tm.HARD_STATE_CONFLICT_CLASSES)
)
def test_hard_state_classes_require_resolver_receipt(conflict_class):
    conflict = _hard_conflict(conflict_class, f"hard-{conflict_class}")
    disposition = {"mode": "choose_left", "receipt": "disp-hard"}
    with pytest.raises(tlc.ConfluenceConflictError, match="resolver_receipt"):
        tlc.validate_dispositions([conflict], {conflict["conflict_id"]: disposition})
    disposition["resolver_receipt"] = "resolve-hard"
    resolved = tlc.validate_dispositions([conflict], {conflict["conflict_id"]: disposition})
    assert resolved[0]["disposition"]["resolver_receipt"] == "resolve-hard"


@pytest.mark.parametrize(
    "conflict_class", list(tm.NON_DUPLICABLE_CONFLICT_CLASSES)
)
@pytest.mark.parametrize("mode", ["combine", "duplicate"])
def test_non_duplicable_classes_forbid_combine_and_duplicate(conflict_class, mode):
    conflict = _hard_conflict(conflict_class, f"nd-{conflict_class}-{mode}")
    disposition = {
        "mode": mode,
        "receipt": "disp-nd",
        "resolver_receipt": "resolve-nd",
    }
    with pytest.raises(tlc.ConfluenceConflictError, match="never duplicated or combined"):
        tlc.validate_dispositions([conflict], {conflict["conflict_id"]: disposition})


def test_defer_requires_note():
    conflict = _kp_conflict("defer-note")
    with pytest.raises(tlc.ConfluenceConflictError, match="note"):
        tlc.validate_dispositions(
            [conflict],
            {conflict["conflict_id"]: {"mode": "defer", "receipt": "disp-defer"}},
        )
    resolved = tlc.validate_dispositions(
        [conflict],
        {
            conflict["conflict_id"]: {
                "mode": "defer",
                "receipt": "disp-defer",
                "note": "settle after the hospital scene",
            }
        },
    )
    assert resolved[0]["disposition"]["note"].startswith("settle")


def test_disposition_field_set_is_closed():
    conflict = _kp_conflict("closed-fields")
    with pytest.raises(tlc.ConfluenceConflictError, match="unknown fields"):
        tlc.validate_dispositions(
            [conflict],
            {
                conflict["conflict_id"]: {
                    "mode": "choose_right",
                    "receipt": "disp-x",
                    "bonus_dice": 2,
                }
            },
        )
    with pytest.raises(tlc.ConfluenceConflictError, match="closed enum"):
        tlc.validate_dispositions(
            [conflict],
            {conflict["conflict_id"]: {"mode": "coin_flip", "receipt": "disp-x"}},
        )
    with pytest.raises(tlc.ConfluenceConflictError, match="non-empty receipt"):
        tlc.validate_dispositions(
            [conflict],
            {conflict["conflict_id"]: {"mode": "choose_right", "receipt": "  "}},
        )


def test_missing_and_extra_dispositions_fail_closed():
    result = enumerate(
        proj(LEFT, state={"/investigators/marta/hp": 11, "/party/funds/cash": 30}),
        proj(RIGHT, state={"/investigators/marta/hp": 7, "/party/funds/cash": 12}),
    )
    conflicts = result["conflicts"]
    assert len(conflicts) == 2
    first, second = conflicts

    missing_id = second["conflict_id"]
    with pytest.raises(tlc.ConfluenceConflictError, match="missing dispositions") as exc_info:
        tlc.validate_dispositions(
            conflicts, {first["conflict_id"]: {"mode": "choose_left", "receipt": "d1"}}
        )
    assert missing_id in str(exc_info.value)

    with pytest.raises(tlc.ConfluenceConflictError, match="missing dispositions"):
        tlc.validate_dispositions(conflicts, {})

    with pytest.raises(tlc.ConfluenceConflictError, match="unknown conflict ids") as exc_info:
        tlc.validate_dispositions(
            conflicts,
            {
                **dispositions_for(conflicts),
                f"{CONFLICT_PREFIX}-invented": {
                    "mode": "paradox",
                    "receipt": "ghost",
                },
            },
        )
    assert "invented" in str(exc_info.value)

    # Zero conflicts plus stray dispositions is equally invalid.
    with pytest.raises(tlc.ConfluenceConflictError, match="unknown conflict ids"):
        tlc.validate_dispositions([], {f"{CONFLICT_PREFIX}-ghost": {"mode": "paradox", "receipt": "r"}})
    assert tlc.validate_dispositions([], []) == []


def test_duplicate_disposition_entries_fail():
    conflict = _kp_conflict("dup-disp")
    with pytest.raises(tlc.ConfluenceConflictError, match="duplicate disposition"):
        tlc.validate_dispositions(
            [conflict],
            [
                {"conflict_id": conflict["conflict_id"], "disposition": {"mode": "choose_left", "receipt": "a"}},
                {"conflict_id": conflict["conflict_id"], "disposition": {"mode": "choose_right", "receipt": "b"}},
            ],
        )


# ---------------------------------------------------------------------------
# Determinism, ordering, digests
# ---------------------------------------------------------------------------


def test_enumeration_is_order_insensitive_and_digest_stable():
    state = {
        "/investigators/marta/hp": 11,
        "/party/funds/cash": 30,
        "/investigators/marta/dead": True,
    }
    left_a = proj(LEFT, state=state)
    left_b = proj(LEFT, state=dict(reversed(list(state.items()))))
    right = proj(RIGHT, state={"/investigators/marta/hp": 7, "/party/funds/cash": 12})
    result_a = enumerate(left_a, right)
    result_b = enumerate(left_b, right)
    assert result_a["conflicts"] == result_b["conflicts"]
    assert result_a["enumeration_sha256"] == result_b["enumeration_sha256"]
    assert [c["class"] for c in result_a["conflicts"]] == ["death", "stat_value", "cash"]

    changed = enumerate(left_a, proj(RIGHT, state={"/investigators/marta/hp": 8, "/party/funds/cash": 12}))
    assert changed["enumeration_sha256"] != result_a["enumeration_sha256"]

    # Same enumeration through two calls is byte-stable.
    assert enumerate(left_a, right) == result_a


def test_conflict_ids_are_semantic_unique_and_nested():
    left = proj(
        LEFT,
        state={
            "/investigators/marta/hp": 11,
            "/investigators/marta san/hp": 9,
        },
        rolls=[
            {"roll_id": "roll-a", "result": 1},
            {"roll_id": "roll-b", "result": 2},
        ],
    )
    right = proj(
        RIGHT,
        state={"/investigators/marta/hp": 7, "/investigators/marta san/hp": 3},
        rolls=[
            {"roll_id": "roll-a", "result": 5},
            {"roll_id": "roll-b", "result": 6},
        ],
    )
    result = enumerate(left, right)
    ids = [c["conflict_id"] for c in result["conflicts"]]
    assert len(ids) == len(set(ids))
    assert all(cid.startswith(f"{CONFLICT_PREFIX}-") for cid in ids)
    assert all(tm.SEMANTIC_ID_RE.match(cid) for cid in ids)
    # Pointer-derived slugs survive sanitization deterministically.
    assert any("investigators-marta-hp" in cid for cid in ids)
    # Designed namespace: meaning-bearing scope plus 1-based ordinal.
    assert ids[0].endswith("-1") and ids[1].endswith("-2")


# ---------------------------------------------------------------------------
# Conflict id namespace: collision safety through truncation (reviewer fix)
# ---------------------------------------------------------------------------


def _assert_valid_ids(ids):
    assert len(ids) == len(set(ids))
    assert all(len(cid) <= 128 for cid in ids)
    assert all(tm.SEMANTIC_ID_RE.match(cid) for cid in ids)
    assert all(cid.startswith(f"{CONFLICT_PREFIX}-") for cid in ids)


def test_long_identical_prefix_paths_never_collide():
    # 160+ character pointers sharing an identical first ~130 characters,
    # diverging only far beyond the old 128-char truncation boundary.
    shared = "/".join(f"s{i:03d}-component" for i in range(10))
    assert len(shared) > 128
    suffixes = ["alpha-divergence", "beta-divergence", "gamma-divergence"]
    left_state = {f"{shared}/{suffix}": index for index, suffix in builtins.enumerate(suffixes)}
    right_state = {f"{shared}/{suffix}": 99 for suffix in suffixes}
    result = enumerate(proj(LEFT, state=left_state), proj(RIGHT, state=right_state))
    ids = [c["conflict_id"] for c in result["conflicts"]]
    _assert_valid_ids(ids)
    # Keys diverge beyond the clipping budget yet remain addressable.
    assert len(ids) == 3
    # The same construction with even more same-prefix siblings.
    many = [f"{shared}/tail-{i:03d}" for i in range(20)]
    result_many = enumerate(
        proj(LEFT, state={key: 1 for key in many}),
        proj(RIGHT, state={key: 2 for key in many}),
    )
    ids_many = [c["conflict_id"] for c in result_many["conflicts"]]
    _assert_valid_ids(ids_many)
    assert len(ids_many) == 20
    # Ordinals are zero-padded to one stable width per enumeration.
    for index, cid in builtins.enumerate(ids_many, start=1):
        assert cid.rsplit("-", 1)[1] == f"{index:02d}"


def test_long_identical_prefix_entity_and_roll_keys_never_collide():
    shared = "entity-npc-" + "-".join(f"deep{i:03d}" for i in range(20))
    assert len(shared) > 140
    left = proj(
        LEFT,
        entities=[
            {"entity_id": f"{shared}-alpha", "display_name": "A"},
            {"entity_id": f"{shared}-beta", "display_name": "B"},
        ],
        rolls=[
            {"roll_id": f"roll-{shared}-one", "result": 10},
            {"roll_id": f"roll-{shared}-two", "result": 20},
        ],
    )
    right = proj(
        RIGHT,
        entities=[
            {"entity_id": f"{shared}-alpha", "display_name": "AA"},
            {"entity_id": f"{shared}-beta", "display_name": "BB"},
        ],
        rolls=[
            {"roll_id": f"roll-{shared}-one", "result": 30},
            {"roll_id": f"roll-{shared}-two", "result": 40},
        ],
    )
    result = enumerate(left, right)
    ids = [c["conflict_id"] for c in result["conflicts"]]
    _assert_valid_ids(ids)
    assert len(ids) == 4
    # Each id's scope is clipped but the ordinal still separates siblings.
    scopes = {cid.rsplit("-", 1)[0] for cid in ids}
    assert len(ids) > len(scopes)  # at least two siblings share a clipped scope


def test_many_conflicts_of_same_class_get_unique_ordinal_ids():
    # 150 same-class divergences: ordinal width grows to 3, ids stay unique,
    # grammar-valid, ordered, and every disposition remains addressable.
    keys = [f"/investigators/inv-{i:03d}/hp" for i in range(150)]
    result = enumerate(
        proj(LEFT, state={key: 10 for key in keys}),
        proj(RIGHT, state={key: 20 for key in keys}),
    )
    conflicts = result["conflicts"]
    assert all(c["class"] == "stat_value" for c in conflicts)
    ids = [c["conflict_id"] for c in conflicts]
    _assert_valid_ids(ids)
    assert [cid.rsplit("-", 1)[1] for cid in ids] == [f"{n:03d}" for n in range(1, 151)]
    # Full disposition addressing works end to end across all 150.
    dispositions = {
        conflict["conflict_id"]: {
            "mode": "choose_left",
            "receipt": f"disp-{n}",
            "resolver_receipt": f"resolve-{n}",
        }
        for n, conflict in builtins.enumerate(conflicts, start=1)
    }
    resolved = tlc.validate_dispositions(conflicts, dispositions)
    assert all(c["disposition"]["mode"] == "choose_left" for c in resolved)
    plan = build_plan(
        proj(LEFT, state={key: 10 for key in keys}),
        proj(RIGHT, state={key: 20 for key in keys}),
        dispositions,
    )
    assert plan["conflict_manifest_sha256"] == tm.record_digest(
        {"conflicts": plan["conflicts"]}
    )


def test_reordered_source_insertion_produces_identical_ids():
    keys = [f"/investigators/inv-{i:03d}/hp" for i in range(25)] + [
        "/npc/npc-cult-leader/dead",
        "/party/lantern/consumed",
    ]
    left_state = {key: 10 for key in keys}
    right_state = {key: 20 for key in keys}
    left_state["/npc/npc-cult-leader/dead"] = True
    left_state["/party/lantern/consumed"] = True
    # Two different dict insertion orders (forward vs reversed vs shuffled).
    forward = {key: left_state[key] for key in keys}
    reversed_order = {key: left_state[key] for key in reversed(keys)}
    right_forward = {key: right_state[key] for key in keys}
    right_shuffled = {key: right_state[key] for key in keys[13:] + keys[:13]}
    result_a = enumerate(proj(LEFT, state=forward), proj(RIGHT, state=right_forward))
    result_b = enumerate(
        proj(LEFT, state=reversed_order), proj(RIGHT, state=right_shuffled)
    )
    ids_a = [c["conflict_id"] for c in result_a["conflicts"]]
    ids_b = [c["conflict_id"] for c in result_b["conflicts"]]
    _assert_valid_ids(ids_a)
    assert ids_a == ids_b
    assert result_a == result_b


def test_replay_determinism_of_ids_and_digests():
    left = proj(
        LEFT,
        state={"/investigators/marta/hp": 11, "/npc/x/dead": True},
        rolls=[{"roll_id": "roll-a", "result": 1}, {"roll_id": "roll-b", "result": 2}],
        effects=[{"effect_id": "effect-one"}],
    )
    right = proj(
        RIGHT,
        state={"/investigators/marta/hp": 7},
        rolls=[{"roll_id": "roll-a", "result": 9}, {"roll_id": "roll-c", "result": 3}],
    )
    result_a = enumerate(left, right)
    result_b = enumerate(left, right)
    assert [c["conflict_id"] for c in result_a["conflicts"]] == [
        c["conflict_id"] for c in result_b["conflicts"]
    ]
    assert result_a == result_b
    dispositions = dispositions_for(result_a["conflicts"])
    plan_a = build_plan(left, right, dispositions)
    plan_b = build_plan(left, right, dispositions)
    assert plan_a == plan_b
    assert plan_a["plan_sha256"] == plan_b["plan_sha256"]
    # Swapped argument order keeps deterministic (mirrored) ids.
    swapped = enumerate(right, left)
    swapped_ids = [c["conflict_id"] for c in swapped["conflicts"]]
    _assert_valid_ids(swapped_ids)
    assert swapped_ids == [c["conflict_id"] for c in result_a["conflicts"]]


def test_conflict_ids_for_direct_namespace_rules():
    raw = [
        {"section": "state", "key": "/a/b", "left": 1, "right": 2},
        {"section": "rolls", "key": "roll-x", "left": {}, "right": {}},
    ]
    ids = tlc.conflict_ids_for(CID, raw)
    assert ids == [
        f"{CONFLICT_PREFIX}-state-a-b-1",
        f"{CONFLICT_PREFIX}-rolls-roll-x-2",
    ]
    # Uniqueness is checked on final ids, not pre-truncation slugs: an
    # oversized confluence id with no room for a scope fails closed.
    long_confluence = "confluence-" + "-".join(f"camp{i:02d}" for i in range(17))
    assert len(long_confluence) > 124
    with pytest.raises(tlc.ConfluenceConflictError, match="no room"):
        tlc.conflict_ids_for(long_confluence, raw)


def test_left_right_order_is_preserved_and_swappable():
    left = proj(LEFT, state={"/investigators/marta/hp": 11})
    right = proj(RIGHT, state={"/investigators/marta/hp": 7})
    forward = enumerate(left, right)
    assert forward["parents"] == [LEFT, RIGHT]
    conflict = forward["conflicts"][0]
    assert conflict["left"]["timeline"] == LEFT
    assert conflict["left"]["value"] == 11
    assert conflict["right"]["timeline"] == RIGHT
    assert conflict["right"]["value"] == 7

    backward = enumerate(right, left)
    assert backward["parents"] == [RIGHT, LEFT]
    swapped = backward["conflicts"][0]
    assert swapped["left"]["timeline"] == RIGHT
    assert swapped["left"]["value"] == 7
    assert swapped["right"]["value"] == 11


def test_plan_digest_changes_with_authoritative_inputs():
    left = proj(LEFT, state={"/party/funds/cash": 30})
    right = proj(RIGHT, state={"/party/funds/cash": 12})
    dispositions = {
        f"{CONFLICT_PREFIX}-state-party-funds-cash-1": {
            "mode": "choose_left",
            "receipt": "disp-cash",
            "resolver_receipt": "resolve-cash",
        }
    }
    plan_a = build_plan(left, right, dispositions)
    plan_b = build_plan(left, right, dispositions)
    assert plan_a == plan_b
    plan_other_receipt = build_plan(
        left, right, dispositions, receipt="confluence-receipt-2"
    )
    assert plan_other_receipt["plan_sha256"] != plan_a["plan_sha256"]
    other_dispositions = {
        f"{CONFLICT_PREFIX}-state-party-funds-cash-1": {
            "mode": "choose_right",
            "receipt": "disp-cash-right",
            "resolver_receipt": "resolve-cash",
        }
    }
    plan_other_mode = build_plan(left, right, other_dispositions)
    assert plan_other_mode["plan_sha256"] != plan_a["plan_sha256"]
    assert (
        plan_other_mode["disposition_manifest_sha256"]
        != plan_a["disposition_manifest_sha256"]
    )


# ---------------------------------------------------------------------------
# No silent merge
# ---------------------------------------------------------------------------


def test_divergence_never_auto_resolves_and_additions_are_surfaced():
    left = proj(
        LEFT,
        state={"/flags/met-npc-ally": True, "/investigators/marta/hp": 11},
        rolls=[{"roll_id": "roll-left-only-turn-10", "result": 40}],
    )
    right = proj(
        RIGHT,
        state={"/investigators/marta/hp": 7, "/flags/met-npc-rival": True},
    )
    result = enumerate(left, right)
    # The disagreement stays a conflict carrying both values verbatim, and
    # the one-sided roll is an obligation, not an addition.
    assert [c["class"] for c in result["conflicts"]] == ["stat_value", "roll_receipt"]
    assert result["conflicts"][0]["left"]["value"] == 11
    assert result["conflicts"][0]["right"]["value"] == 7
    assert result["conflicts"][1]["left"]["value"]["roll_id"] == "roll-left-only-turn-10"
    assert result["conflicts"][1]["right"]["value"] == {"absent": True}
    # One-sided post-fork *non-mechanical* content is surfaced explicitly,
    # never dropped — and additions never carry non-duplicable mechanics.
    left_refs = [entry["refs"] for entry in result["additions"]["left_only"]]
    right_refs = [entry["refs"] for entry in result["additions"]["right_only"]]
    assert left_refs == [["/flags/met-npc-ally"]]
    assert right_refs == [["/flags/met-npc-rival"]]
    assert result["additions"]["left_only"][0]["value"] is True
    assert all(
        entry["section"] not in ("rolls", "effects", "transactions")
        for entry in result["additions"]["left_only"] + result["additions"]["right_only"]
    )

    # A plan cannot skip the disposition step.
    with pytest.raises(tlc.ConfluenceConflictError, match="missing dispositions"):
        build_plan(left, right, {})


def test_validate_dispositions_returns_copies_without_mutating_inputs():
    result = enumerate(
        proj(LEFT, state={"/party/funds/cash": 30}),
        proj(RIGHT, state={"/party/funds/cash": 12}),
    )
    conflicts = result["conflicts"]
    snapshot = copy.deepcopy(conflicts)
    dispositions = dispositions_for(conflicts)
    resolved = tlc.validate_dispositions(conflicts, dispositions)
    assert conflicts == snapshot
    assert resolved[0]["disposition"] == dispositions[resolved[0]["conflict_id"]]
    assert resolved is not conflicts
    assert resolved[0] is not conflicts[0]


# ---------------------------------------------------------------------------
# One-sided non-duplicable mechanics (reviewer Critical fix)
# ---------------------------------------------------------------------------


def _assert_absent_side(side, timeline):
    assert side["timeline"] == timeline
    assert side["value"] == {"absent": True}
    assert side["refs"]


def test_one_sided_rolls_effects_transactions_are_conflicts_not_additions():
    # Distinct semantic ids per branch: previously both sides became
    # disposition-free additions; both must now be resolution obligations.
    left = proj(
        LEFT,
        rolls=[{"roll_id": "roll-left-turn-10", "result": 40}],
        effects=[{"effect_id": "effect-left-insight"}],
        transactions=[{"transaction_id": "tx-left-spend", "amount": 5}],
    )
    right = proj(
        RIGHT,
        rolls=[{"roll_id": "roll-right-turn-10", "result": 70}],
        effects=[{"effect_id": "effect-right-rally"}],
        transactions=[{"transaction_id": "tx-right-spend", "amount": 7}],
    )
    result = enumerate(left, right)
    assert result["additions"] == {"left_only": [], "right_only": []}
    assert sorted(c["class"] for c in result["conflicts"]) == [
        "consumed_resource",
        "consumed_resource",
        "one_time_effect",
        "one_time_effect",
        "roll_receipt",
        "roll_receipt",
    ]
    by_class = {}
    for conflict in result["conflicts"]:
        by_class.setdefault(conflict["class"], []).append(conflict)
    for conflict_class, entries in by_class.items():
        present_left = next(c for c in entries if c["left"]["value"] != {"absent": True})
        present_right = next(c for c in entries if c["right"]["value"] != {"absent": True})
        # Present side carries the verbatim mechanic; absent side is marked.
        assert present_left["left"]["timeline"] == LEFT
        _assert_absent_side(present_left["right"], RIGHT)
        assert present_left["left"]["refs"] == present_left["right"]["refs"]
        _assert_absent_side(present_right["left"], LEFT)
        assert present_right["right"]["timeline"] == RIGHT
        assert present_right["left"]["refs"] == present_right["right"]["refs"]
    roll_left = by_class["roll_receipt"][0] if by_class["roll_receipt"][0]["left"]["value"] != {"absent": True} else by_class["roll_receipt"][1]
    assert roll_left["left"]["value"]["roll_id"] == "roll-left-turn-10"


def test_one_sided_roll_requires_disposition_and_resolver_receipt():
    left = proj(LEFT, rolls=[{"roll_id": "roll-left-only-turn-11", "result": 33}])
    right = proj(RIGHT)
    result = enumerate(left, right)
    assert len(result["conflicts"]) == 1
    conflict = result["conflicts"][0]
    assert conflict["class"] == "roll_receipt"
    assert conflict["right"]["value"] == {"absent": True}
    conflict_id = conflict["conflict_id"]

    # No disposition at all fails closed.
    with pytest.raises(tlc.ConfluenceConflictError, match="missing dispositions"):
        tlc.validate_dispositions([conflict], {})
    # Hard-state class: the mechanics resolver must receipt the numbers.
    with pytest.raises(tlc.ConfluenceConflictError, match="resolver_receipt"):
        tlc.validate_dispositions(
            [conflict], {conflict_id: {"mode": "choose_left", "receipt": "disp-r"}}
        )
    # Keeping the roll is legal only with both receipts.
    resolved = tlc.validate_dispositions(
        [conflict],
        {
            conflict_id: {
                "mode": "choose_left",
                "receipt": "disp-r",
                "resolver_receipt": "resolve-r",
            }
        },
    )
    assert resolved[0]["disposition"]["resolver_receipt"] == "resolve-r"
    # Dropping it is equally explicit (choose the absent side / sacrifice).
    for mode in ("choose_right", "sacrifice", "paradox"):
        tlc.validate_dispositions(
            [conflict],
            {
                conflict_id: {
                    "mode": mode,
                    "receipt": "disp-r",
                    "resolver_receipt": "resolve-r",
                }
            },
        )
    # Duplicating/combining a one-sided roll is still forbidden outright.
    for mode in ("combine", "duplicate"):
        with pytest.raises(tlc.ConfluenceConflictError, match="never duplicated or combined"):
            tlc.validate_dispositions(
                [conflict],
                {
                    conflict_id: {
                        "mode": mode,
                        "receipt": "disp-r",
                        "resolver_receipt": "resolve-r",
                    }
                },
            )


def test_one_sided_death_and_consumption_state_leaves_are_conflicts():
    # Non-boolean death/consumption leaves (no absent-side default) must
    # still be obligations, not additions.
    left = proj(
        LEFT,
        state={
            "/npc/npc-cult-leader/death_turn": 9,
            "/party/first-aid-kit/consumed_by": "marta",
        },
    )
    right = proj(RIGHT)
    result = enumerate(left, right)
    assert result["additions"] == {"left_only": [], "right_only": []}
    assert sorted(c["class"] for c in result["conflicts"]) == [
        "consumed_resource",
        "death",
    ]
    for conflict in result["conflicts"]:
        assert conflict["left"]["timeline"] == LEFT
        _assert_absent_side(conflict["right"], RIGHT)
        assert conflict["left"]["refs"] == conflict["right"]["refs"]


def test_death_segment_pointers_classify_as_death_on_both_sides():
    # Consistency: a death-segment pointer diverging on both sides is the
    # non-duplicable death class, never a combinable stat_value.
    result = enumerate(
        proj(LEFT, state={"/npc/npc-cult-leader/death_turn": 9}),
        proj(RIGHT, state={"/npc/npc-cult-leader/death_turn": 12}),
    )
    assert [c["class"] for c in result["conflicts"]] == ["death"]
    assert tlc.classify_conflict(
        {"section": "state", "key": "/npc/x/death_turn", "left": 9, "right": 12}
    ) == {"class": "death", "category": "hard_state", "non_duplicable": True}


def test_one_sided_kp_semantic_rows_remain_additions():
    # Scope guard: only non-duplicable mechanics become one-sided
    # obligations; new KP-semantic content stays surfaced additions.
    left = proj(
        LEFT,
        events=[{"decision_id": "dec-left-only-scene"}],
        entities=[{"entity_id": "npc-left-only-ally"}],
        assertions=[{"assertion_id": "mem-left-only-rumor"}],
        receipts=[{"finalization_id": "fin-left-only-turn-11"}],
        relations=[
            {
                "from_entity_id": "investigator-marta",
                "to_entity_id": "npc-left-only-ally",
                "relation_kind": "ally",
            }
        ],
    )
    right = proj(RIGHT)
    result = enumerate(left, right)
    assert result["conflicts"] == []
    assert result["additions"]["right_only"] == []
    assert sorted(entry["section"] for entry in result["additions"]["left_only"]) == [
        "assertions",
        "entities",
        "events",
        "receipts",
        "relations",
    ]


def test_distinct_mechanics_on_both_sides_cannot_survive_silently():
    # Shared pre-fork roll + distinct post-fork rolls per branch: the shared
    # row yields nothing, each distinct roll is an obligation, and the plan
    # only carries them through receipted dispositions.
    left = proj(
        LEFT,
        rolls=[
            {"roll_id": "roll-prefork-listen", "result": 21},
            {"roll_id": "roll-left-turn-12", "result": 40},
        ],
    )
    right = proj(
        RIGHT,
        rolls=[
            {"roll_id": "roll-prefork-listen", "result": 21},
            {"roll_id": "roll-right-turn-12", "result": 70},
        ],
    )
    result = enumerate(left, right)
    assert len(result["conflicts"]) == 2
    assert all(c["class"] == "roll_receipt" for c in result["conflicts"])
    assert result["additions"] == {"left_only": [], "right_only": []}

    with pytest.raises(tlc.ConfluenceConflictError, match="missing dispositions"):
        build_plan(left, right, {})

    # Keeping both rolls is possible only as two explicit receipted
    # decisions recorded in the confluence record and both manifests.
    keep_left = next(
        c for c in result["conflicts"] if c["left"]["value"] != {"absent": True}
    )
    keep_right = next(
        c for c in result["conflicts"] if c["right"]["value"] != {"absent": True}
    )
    dispositions = {
        keep_left["conflict_id"]: {
            "mode": "choose_left",
            "receipt": "disp-keep-left",
            "resolver_receipt": "resolve-keep-left",
        },
        keep_right["conflict_id"]: {
            "mode": "choose_right",
            "receipt": "disp-keep-right",
            "resolver_receipt": "resolve-keep-right",
        },
    }
    plan = build_plan(left, right, dispositions)
    assert len(plan["conflicts"]) == 2
    assert all(c["disposition"] for c in plan["conflicts"])
    assert plan["git_history_arguments"]["conflicts"] == plan["conflicts"]
    tm.validate_confluence(
        {
            "confluence_id": CID,
            "campaign_id": CAMPAIGN,
            "timeline_id": MERGED,
            "parents": plan["parents"],
            "merge_commit": "0" * 40,
            "receipt": "confluence-receipt-1",
            "conflicts": plan["conflicts"],
        }
    )
    manifest = tm.record_digest({"conflicts": plan["conflicts"]})
    assert plan["conflict_manifest_sha256"] == manifest

    # Sacrificing one of the two is equally explicit and receipted.
    sacrifice = {
        keep_left["conflict_id"]: {
            "mode": "choose_left",
            "receipt": "disp-keep-left",
            "resolver_receipt": "resolve-keep-left",
        },
        keep_right["conflict_id"]: {
            "mode": "sacrifice",
            "receipt": "disp-drop-right",
            "resolver_receipt": "resolve-drop-right",
        },
    }
    plan_sacrifice = build_plan(left, right, sacrifice)
    assert plan_sacrifice["plan_sha256"] != plan["plan_sha256"]


def test_one_sided_mechanics_enumeration_is_deterministic():
    left = proj(
        LEFT,
        rolls=[{"roll_id": "roll-left-turn-13", "result": 40}],
        state={"/npc/npc-cult-leader/killed": True},
    )
    right = proj(RIGHT, effects=[{"effect_id": "effect-right-turn-13"}])
    result_a = enumerate(left, right)
    result_b = enumerate(left, right)
    assert result_a == result_b
    assert sorted(c["class"] for c in result_a["conflicts"]) == [
        "death",
        "one_time_effect",
        "roll_receipt",
    ]
    assert result_a["additions"] == {"left_only": [], "right_only": []}


# ---------------------------------------------------------------------------
# Confluence plan compatibility with coc_git_history.confluence_timelines
# ---------------------------------------------------------------------------


def _plan_fixture():
    left = proj(
        LEFT,
        state={"/investigators/marta/hp": 11},
        rolls=[{"roll_id": "roll-marta-dodge-turn-9", "result": 55}],
        entities=[{"entity_id": "npc-cult-leader", "display_name": "Elias Whitmore"}],
        relations=[
            {
                "from_entity_id": "investigator-marta",
                "to_entity_id": "npc-cult-leader",
                "relation_kind": "ally",
            }
        ],
    )
    right = proj(
        RIGHT,
        state={"/investigators/marta/hp": 7},
        rolls=[{"roll_id": "roll-marta-dodge-turn-9", "result": 71}],
        entities=[{"entity_id": "npc-cult-leader", "display_name": "Elias"}],
        relations=[
            {
                "from_entity_id": "investigator-marta",
                "to_entity_id": "npc-cult-leader",
                "relation_kind": "rival",
            }
        ],
    )
    result = enumerate(left, right)
    dispositions = {}
    for conflict in result["conflicts"]:
        disposition = {
            "mode": "choose_left",
            "receipt": f"disp-{conflict['conflict_id']}",
        }
        if conflict["class"] in tm.HARD_STATE_CONFLICT_CLASSES:
            disposition["resolver_receipt"] = f"resolve-{conflict['conflict_id']}"
        dispositions[conflict["conflict_id"]] = disposition
    return left, right, dispositions


def test_plan_conflicts_pass_the_frozen_contract():
    left, right, dispositions = _plan_fixture()
    plan = build_plan(left, right, dispositions)
    record = {
        "confluence_id": CID,
        "campaign_id": CAMPAIGN,
        "timeline_id": MERGED,
        "parents": plan["parents"],
        "merge_commit": "0" * 40,
        "receipt": "confluence-receipt-1",
        "conflicts": plan["conflicts"],
    }
    tm.validate_confluence(record)
    assert plan["parents"] == [LEFT, RIGHT]
    assert plan["left_timeline_id"] == LEFT
    assert plan["right_timeline_id"] == RIGHT
    assert plan["merge_commit"] is None
    assert all(c["disposition"] is not None for c in plan["conflicts"])
    assert set(plan["conflicts"][0]) == {
        "conflict_id",
        "class",
        "left",
        "right",
        "disposition",
    }


def test_plan_manifest_digests_match_confluence_timelines_formula():
    left, right, dispositions = _plan_fixture()
    plan = build_plan(left, right, dispositions)
    assert plan["conflict_manifest_sha256"] == tm.record_digest(
        {"conflicts": plan["conflicts"]}
    )
    assert plan["disposition_manifest_sha256"] == tm.record_digest(
        {
            "dispositions": [
                {
                    "conflict_id": conflict["conflict_id"],
                    "disposition": conflict["disposition"],
                }
                for conflict in plan["conflicts"]
            ]
        }
    )


def test_plan_arguments_mirror_confluence_timelines_signature():
    left, right, dispositions = _plan_fixture()
    plan = build_plan(
        left, right, dispositions, path_resolutions={"save/world-state.json": "choose_left"}
    )
    signature = inspect.signature(hist.confluence_timelines)
    params = set(signature.parameters)
    covered = set(plan["git_history_arguments"])
    assert covered <= params
    assert params - covered == {"root"}
    assert plan["path_resolutions"] == {"save/world-state.json": "choose_left"}
    assert plan["git_history_arguments"]["path_resolutions"] == plan["path_resolutions"]
    assert plan["git_history_arguments"]["activate"] is False


def test_plan_default_confluence_id_and_timeline_guards():
    left, right, dispositions = _plan_fixture()
    plan = build_plan(left, right, dispositions, confluence_id=None)
    assert plan["confluence_id"] == CID
    tm.validate_confluence(
        {
            "confluence_id": plan["confluence_id"],
            "campaign_id": CAMPAIGN,
            "timeline_id": MERGED,
            "parents": plan["parents"],
            "merge_commit": "0" * 40,
            "receipt": "confluence-receipt-1",
            "conflicts": plan["conflicts"],
        }
    )

    with pytest.raises(tlc.ConfluenceConflictError, match="third timeline"):
        build_plan(left, right, dispositions, timeline_id=LEFT)
    with pytest.raises(tlc.ConfluenceConflictError, match="root timeline"):
        build_plan(left, right, dispositions, timeline_id="tl-main")
    with pytest.raises(tlc.ConfluenceConflictError, match="campaign"):
        build_plan(left, right, dispositions, campaign_id="other-campaign")


# ---------------------------------------------------------------------------
# Projection and confluence-id validation
# ---------------------------------------------------------------------------


def test_projection_validation_failures():
    good = proj(LEFT)
    with pytest.raises(tlc.ConfluenceConflictError, match="unknown fields"):
        tlc.validate_projection({**good, "narration": ["prose"]})
    with pytest.raises(tlc.ConfluenceConflictError, match="missing required fields"):
        tlc.validate_projection({"timeline_id": LEFT})
    with pytest.raises(tlc.ConfluenceConflictError, match="mapping"):
        tlc.validate_projection(["not", "a", "mapping"])
    with pytest.raises(tlc.ConfluenceConflictError, match="tl-"):
        tlc.validate_projection({**good, "timeline_id": "main"})
    with pytest.raises(tlc.ConfluenceConflictError, match="state must be a mapping"):
        tlc.validate_projection({**good, "state": [1, 2]})
    with pytest.raises(tlc.ConfluenceConflictError, match="rows must be mappings"):
        tlc.validate_projection({**good, "rolls": ["roll"]})
    with pytest.raises(tlc.ConfluenceConflictError, match="turn_number"):
        tlc.validate_projection({**good, "turn_number": "nine"})
    with pytest.raises(tlc.ConfluenceConflictError, match="commit_sha"):
        tlc.validate_projection({**good, "commit_sha": "deadbeef"})


def test_enumeration_rejects_campaign_and_timeline_mismatches():
    with pytest.raises(tlc.ConfluenceConflictError, match="different campaigns"):
        enumerate(proj(LEFT), {**proj(RIGHT), "campaign_id": "other-campaign"})
    with pytest.raises(tlc.ConfluenceConflictError, match="distinct timelines"):
        enumerate(proj(LEFT), proj(LEFT))


@pytest.mark.parametrize("bad_id", ["", "not-a-confluence", "Confluence-Upper-X", "confluence-UPPER"])
def test_enumeration_rejects_non_semantic_confluence_ids(bad_id):
    with pytest.raises(tlc.ConfluenceConflictError):
        enumerate(proj(LEFT), proj(RIGHT), confluence_id=bad_id)
