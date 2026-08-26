"""Deterministic tests for the temporal retrieval core (pure fixtures only)."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"

COMMIT_A = "a" * 40
COMMIT_B = "b" * 40
COMMIT_C = "c" * 40

CID = "test"
PARTY = None  # set after contract load
INV_ADA = None
NPC_KNOTT = None


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


rt = _load("coc_temporal_retrieval_under_test", SCRIPTS / "coc_temporal_retrieval.py")
contract = rt.contract

PARTY = contract.subject_id_for("party", CID, "")
INV_ADA = contract.subject_id_for("investigator", None, "ada")
NPC_KNOTT = contract.subject_id_for("npc", CID, "knott")
PLAYER = contract.subject_id_for("player", None, "table")

CELLAR = "entity-location-cellar"
JOURNAL = "entity-clue-journal"
ATTIC = "entity-location-attic"
KNOTT = "entity-person-knott"


def _subject_record(
    kind: str,
    *,
    campaign_id: str | None = None,
    slug: str = "",
    same_as: tuple[str, ...] = (),
) -> dict:
    rec = {
        "subject_id": contract.subject_id_for(kind, campaign_id, slug),
        "kind": kind,
        "campaign_id": campaign_id,
        "display_name": f"{kind} {slug or campaign_id}".strip(),
        "same_subject_as": list(same_as),
    }
    contract.validate_subject(rec)
    return rec


def _assertion(
    slug: str,
    *,
    kind: str = "belief",
    subject: str = PARTY,
    knowers: list[str] | None = None,
    privacy: str = "player_safe",
    timeline: str = "tl-main",
    campaign_id: str | None = CID,
    entities: tuple[str, ...] = (),
    valid_from: int = 1,
    valid_until: int | None = None,
    superseded_by: tuple[str, ...] = (),
    source_turn: int = 1,
    state: str = "accurate",
    statement: str = "一条结构化记忆描述。",
    commit: str = COMMIT_A,
    covers: tuple[str, ...] = (),
    contradicts: tuple[str, ...] = (),
    validate: bool = True,
) -> dict:
    if kind == "summary":
        scope = "campaign"
        aid = f"mem-{campaign_id}-{slug}"
        if not covers:
            covers = (COMMIT_A,)
    elif campaign_id is None:
        scope = "cross_campaign"
        aid = f"mem-xc-{slug}"
    else:
        scope = "campaign"
        aid = f"mem-{campaign_id}-{slug}"
    rec = {
        "assertion_id": aid,
        "kind": kind,
        "scope": scope,
        "campaign_id": campaign_id,
        "timeline_id": timeline if scope == "campaign" else None,
        "subject_id": subject,
        "knowers": list(knowers if knowers is not None else [subject]),
        "privacy": privacy,
        "state": state,
        "statement": statement,
        "entities": list(entities),
        "occurred_turn": valid_from,
        "valid_from_turn": valid_from,
        "valid_until_turn": valid_until,
        "superseded_by": list(superseded_by),
        "contradicts": list(contradicts),
        "confirms": [],
        "covers_commits": list(covers),
        "transfer_ref": None,
        "source_commit": commit,
        "source_turn": source_turn,
        "source_receipts": [f"receipt-{slug}"],
    }
    if validate:
        contract.validate_assertion(rec)
    return rec


# ---------------------------------------------------------------------------
# Recall-context validation
# ---------------------------------------------------------------------------


def test_context_defaults_and_closed_envelope():
    ctx = rt.build_recall_context()
    assert ctx["timeline_id"] == contract.ROOT_TIMELINE_ID
    assert ctx["privacy"] == "keeper"
    assert ctx["turn_number"] is None
    assert ctx["entities"] == []
    assert ctx["kinds"] == []
    assert ctx["salience"] == {}
    assert set(ctx) == set(rt.CONTEXT_FIELDS)
    # entities are de-duplicated into a deterministic order
    ctx2 = rt.build_recall_context(entities=[JOURNAL, CELLAR, JOURNAL])
    assert ctx2["entities"] == [JOURNAL, CELLAR]


@pytest.mark.parametrize(
    "kwargs,field",
    [
        ({"subject_id": "not-a-subject"}, "subject_id"),
        ({"subject_id": "subject-bad!id"}, "subject_id"),
        ({"timeline_id": "main"}, "timeline_id"),
        ({"turn_number": -1}, "turn_number"),
        ({"turn_number": "3"}, "turn_number"),
        ({"entities": CELLAR}, "entities"),
        ({"entities": ["cellar"]}, "entities"),
        ({"scene_id": "Scene 1"}, "scene_id"),
        ({"privacy": "system_only"}, "privacy"),
        ({"campaign_id": ""}, "campaign_id"),
        ({"kinds": ["nope"]}, "kinds"),
        ({"include_superseded": "yes"}, "include_superseded"),
        ({"salience": ["x"]}, "salience"),
        ({"salience": {"cellar": 0.5}}, "salience"),
        ({"salience": {f"mem-{CID}-a": 1.5}}, "salience"),
        ({"salience": {f"mem-{CID}-a": True}}, "salience"),
        ({"limit": 0}, "limit"),
        ({"limit": 65}, "limit"),
        ({"limit": True}, "limit"),
    ],
)
def test_context_rejects_invalid_inputs(kwargs, field):
    with pytest.raises(rt.TemporalRetrievalError) as err:
        rt.build_recall_context(**kwargs)
    assert err.value.field == field


def test_builders_reject_foreign_context_and_type_misuse():
    rows = [_assertion("one")]
    with pytest.raises(rt.TemporalRetrievalError, match="build_recall_context"):
        rt.narrow_candidates(rows, {"subject_id": None})
    # container-level misuse still raises; row-level malformation is
    # excluded with diagnostics instead (see validation tests below)
    with pytest.raises(rt.TemporalRetrievalError, match="assertions"):
        rt.narrow_candidates("not-even-iterable-of-rows" and 123, rt.build_recall_context())
    with pytest.raises(rt.TemporalRetrievalError, match="assertions"):
        rt.narrow_candidates({"mem-x": rows[0]}, rt.build_recall_context())


@pytest.mark.parametrize("kwargs", [{"budget": 0}, {"budget": 65}, {"budget": "8"}])
def test_budget_and_limit_bounds(kwargs):
    ctx = rt.build_recall_context()
    with pytest.raises(rt.TemporalRetrievalError):
        rt.build_hot_projection([], ctx, **kwargs)
    with pytest.raises(rt.TemporalRetrievalError):
        rt.build_cold_projection([], ctx, **kwargs)
    with pytest.raises(rt.TemporalRetrievalError):
        rt.narrow_candidates([], ctx, limit=0)


# ---------------------------------------------------------------------------
# Privacy projection
# ---------------------------------------------------------------------------


def test_player_view_never_receives_keeper_only_rows():
    rows = [
        _assertion("secret", privacy="keeper_only", subject=NPC_KNOTT),
        _assertion("public"),
        _assertion("guess", kind="player_assertion", subject=PLAYER),
    ]
    player = rt.build_recall_context(privacy="player_safe")
    keeper = rt.build_recall_context(privacy="keeper")
    player_ids = [r["assertion_id"] for r in rt.narrow_candidates(rows, player)]
    keeper_ids = [r["assertion_id"] for r in rt.narrow_candidates(rows, keeper)]
    assert "mem-test-secret" not in player_ids
    assert set(player_ids) == {"mem-test-public", "mem-test-guess"}
    assert "mem-test-secret" in keeper_ids
    # every tier honors the boundary
    for builder in (rt.build_hot_projection, rt.build_cold_projection):
        hot_ids = [c["assertion_id"] for c in builder(rows, player)["candidates"]]
        assert "mem-test-secret" not in hot_ids


def test_suppressed_memory_is_keeper_only_by_contract():
    row = _assertion(
        "buried", privacy="keeper_only", state="suppressed", subject=INV_ADA
    )
    contract.validate_assertion(row)
    player_ids = [
        r["assertion_id"]
        for r in rt.narrow_candidates([row], rt.build_recall_context(privacy="player_safe"))
    ]
    assert player_ids == []


# ---------------------------------------------------------------------------
# Subjective knowledge (subject / knowers)
# ---------------------------------------------------------------------------


def test_subject_narrowing_is_subjective():
    ada_private = _assertion("ada-belief", subject=INV_ADA)
    shared = _assertion(
        "shared-knowledge",
        kind="knowledge",
        subject=NPC_KNOTT,
        knowers=[NPC_KNOTT, INV_ADA],
    )
    rows = [ada_private, shared]

    as_ada = [
        r["assertion_id"]
        for r in rt.narrow_candidates(rows, rt.build_recall_context(subject_id=INV_ADA))
    ]
    assert set(as_ada) == {"mem-test-ada-belief", "mem-test-shared-knowledge"}

    as_knott = [
        r["assertion_id"]
        for r in rt.narrow_candidates(rows, rt.build_recall_context(subject_id=NPC_KNOTT))
    ]
    assert as_knott == ["mem-test-shared-knowledge"]

    no_subject = [
        r["assertion_id"]
        for r in rt.narrow_candidates(rows, rt.build_recall_context())
    ]
    assert set(no_subject) == {"mem-test-ada-belief", "mem-test-shared-knowledge"}


# ---------------------------------------------------------------------------
# Valid time, supersession, contradictions
# ---------------------------------------------------------------------------


def _superseded_pair() -> tuple[dict, dict]:
    successor = _assertion(
        "door-new", valid_from=5, source_turn=5, entities=(CELLAR,)
    )
    old = _assertion(
        "door-old",
        valid_from=2,
        valid_until=5,
        superseded_by=(successor["assertion_id"],),
        source_turn=2,
        entities=(CELLAR,),
    )
    return old, successor


def test_valid_time_window_and_supersession():
    old, successor = _superseded_pair()
    rows = [old, successor]

    at_turn_3 = rt.build_recall_context(turn_number=3, entities=[CELLAR])
    assert [r["assertion_id"] for r in rt.narrow_candidates(rows, at_turn_3)] == [
        "mem-test-door-old"
    ]

    at_turn_7 = rt.build_recall_context(turn_number=7, entities=[CELLAR])
    assert [r["assertion_id"] for r in rt.narrow_candidates(rows, at_turn_7)] == [
        "mem-test-door-new"
    ]

    no_anchor = rt.build_recall_context(entities=[CELLAR])
    assert [r["assertion_id"] for r in rt.narrow_candidates(rows, no_anchor)] == [
        "mem-test-door-new"
    ]

    with_archive = rt.build_recall_context(entities=[CELLAR], include_superseded=True)
    assert set(
        r["assertion_id"] for r in rt.narrow_candidates(rows, with_archive)
    ) == {"mem-test-door-old", "mem-test-door-new"}


def test_contradictory_state_is_returned_as_data():
    other = _assertion("claim-a", entities=(KNOTT,))
    contradicts = _assertion(
        "claim-b",
        state="contradictory",
        contradicts=(other["assertion_id"],),
        entities=(KNOTT,),
    )
    contract.validate_assertion(contradicts)
    got = rt.narrow_candidates(
        [other, contradicts], rt.build_recall_context(entities=[KNOTT])
    )
    assert {r["assertion_id"] for r in got} == {"mem-test-claim-a", "mem-test-claim-b"}
    by_id = {r["assertion_id"]: r for r in got}
    assert by_id["mem-test-claim-b"]["contradicts"] == ["mem-test-claim-a"]


# ---------------------------------------------------------------------------
# Timeline / campaign isolation
# ---------------------------------------------------------------------------


def test_cross_timeline_isolation():
    main_row = _assertion("main-memory", entities=(CELLAR,), source_turn=3)
    attic_row = _assertion(
        "attic-memory", timeline="tl-attic", entities=(ATTIC,), source_turn=4
    )
    rows = [main_row, attic_row]

    on_main = rt.build_recall_context(timeline_id="tl-main")
    assert [r["assertion_id"] for r in rt.narrow_candidates(rows, on_main)] == [
        "mem-test-main-memory"
    ]
    assert [
        c["assertion_id"] for c in rt.build_hot_projection(rows, on_main)["candidates"]
    ] == ["mem-test-main-memory"]
    assert [
        c["assertion_id"] for c in rt.build_cold_projection(rows, on_main)["candidates"]
    ] == []

    on_attic = rt.build_recall_context(timeline_id="tl-attic")
    assert [r["assertion_id"] for r in rt.narrow_candidates(rows, on_attic)] == [
        "mem-test-attic-memory"
    ]


def test_cross_campaign_rows_and_campaign_isolation():
    foreign = _assertion("foreign-row", campaign_id="other", timeline="tl-main")
    preference = _assertion(
        "player-pref",
        kind="player_preference",
        subject=PLAYER,
        campaign_id=None,
        privacy="player_safe",
    )
    local = _assertion("local-row")
    rows = [foreign, preference, local]

    default_ctx = rt.build_recall_context()
    got = {r["assertion_id"] for r in rt.narrow_candidates(rows, default_ctx)}
    # no campaign filter: bundle is trusted to be campaign-scoped
    assert got == {"mem-other-foreign-row", "mem-xc-player-pref", "mem-test-local-row"}

    # campaign pinned, no identity bindings: None-scope rows fail closed
    isolated = rt.build_recall_context(campaign_id=CID)
    got = {r["assertion_id"] for r in rt.narrow_candidates(rows, isolated)}
    assert got == {"mem-test-local-row"}

    # explicit validated binding re-admits the cross-campaign row:
    # global player -> same_subject_as -> campaign-scoped record
    bound = rt.build_recall_context(
        campaign_id=CID,
        identity_bindings=[
            _subject_record(
                "player",
                campaign_id=None,
                slug="table",
                same_as=("subject-player-table-of-test",),
            ),
            _subject_record("player", campaign_id=CID, slug="table-of-test"),
        ],
    )
    assert bound["bound_subject_ids"] == [PLAYER]
    got = {r["assertion_id"] for r in rt.narrow_candidates(rows, bound)}
    assert got == {"mem-xc-player-pref", "mem-test-local-row"}

    # every tier honors the binding gate (hot shows positive admission;
    # cold only ever contains summaries/closed rows, so it proves exclusion)
    hot_isolated = {
        c["assertion_id"] for c in rt.build_hot_projection(rows, isolated)["candidates"]
    }
    assert "mem-xc-player-pref" not in hot_isolated
    hot_bound = {
        c["assertion_id"] for c in rt.build_hot_projection(rows, bound)["candidates"]
    }
    assert "mem-xc-player-pref" in hot_bound
    cold_isolated = {
        c["assertion_id"] for c in rt.build_cold_projection(rows, isolated)["candidates"]
    }
    assert "mem-xc-player-pref" not in cold_isolated


# ---------------------------------------------------------------------------
# Entity / scene hard filters and ranking
# ---------------------------------------------------------------------------


def test_entity_hard_filter_and_overlap_ranking():
    both = _assertion("both", entities=(CELLAR, JOURNAL), source_turn=2)
    one = _assertion("one", entities=(CELLAR,), source_turn=2)
    neither = _assertion("neither", entities=(ATTIC,), source_turn=9)
    rows = [neither, one, both]

    ctx = rt.build_recall_context(entities=[CELLAR, JOURNAL], turn_number=2)
    got = rt.narrow_candidates(rows, ctx)
    assert [r["assertion_id"] for r in got] == ["mem-test-both", "mem-test-one"]
    assert got[0]["entity_overlap"] == 2
    assert got[1]["entity_overlap"] == 1
    assert got[0]["score"] > got[1]["score"]


def test_scene_hard_filter_and_scene_weight():
    in_scene = _assertion("in-scene", entities=(CELLAR, KNOTT), source_turn=2)
    out_scene = _assertion("out-scene", entities=(KNOTT,), source_turn=2)
    rows = [in_scene, out_scene]

    ctx = rt.build_recall_context(scene_id=CELLAR, entities=[KNOTT], turn_number=2)
    got = rt.narrow_candidates(rows, ctx)
    assert [r["assertion_id"] for r in got] == ["mem-test-in-scene"]
    assert got[0]["scene_match"] is True

    empty = rt.build_recall_context(scene_id="entity-location-nowhere")
    assert rt.narrow_candidates(rows, empty) == []


def test_salience_is_explicit_data_only():
    low = _assertion("sal-low", entities=(CELLAR,), source_turn=5)
    high = _assertion("sal-high", entities=(CELLAR,), source_turn=5)
    rows = [low, high]

    without = rt.build_recall_context(entities=[CELLAR], turn_number=6)
    order = [r["assertion_id"] for r in rt.narrow_candidates(rows, without)]
    assert order == ["mem-test-sal-high", "mem-test-sal-low"]  # id tie-break

    with_salience = rt.build_recall_context(
        entities=[CELLAR], turn_number=6, salience={"mem-test-sal-low": 1.0}
    )
    got = rt.narrow_candidates(rows, with_salience)
    assert [r["assertion_id"] for r in got] == ["mem-test-sal-low", "mem-test-sal-high"]
    assert got[0]["salience"] == 1.0
    assert got[1]["salience"] == 0.0


def test_recency_ranking_and_exact_ties():
    fresh = _assertion("fresh", entities=(CELLAR,), source_turn=9)
    stale = _assertion("stale", entities=(CELLAR,), source_turn=2)
    rows = [stale, fresh]
    ctx = rt.build_recall_context(entities=[CELLAR], turn_number=10)
    got = rt.narrow_candidates(rows, ctx)
    assert [r["assertion_id"] for r in got] == ["mem-test-fresh", "mem-test-stale"]
    assert got[0]["recency"] > got[1]["recency"]

    tie_a = _assertion("tie-aaa", entities=(CELLAR,), source_turn=4)
    tie_b = _assertion("tie-bbb", entities=(CELLAR,), source_turn=4)
    got = rt.narrow_candidates([tie_b, tie_a], rt.build_recall_context(entities=[CELLAR]))
    assert [r["assertion_id"] for r in got] == ["mem-test-tie-aaa", "mem-test-tie-bbb"]
    assert got[0]["score"] == got[1]["score"]


def test_statement_prose_never_affects_ranking():
    cellar_en = _assertion("prose-a", entities=(CELLAR,), statement="cellar cellar cellar")
    cellar_zh = _assertion("prose-b", entities=(CELLAR,), statement="完全无关的叙述")
    ctx = rt.build_recall_context(entities=[CELLAR])
    got = rt.narrow_candidates([cellar_zh, cellar_en], ctx)
    assert got[0]["score"] == got[1]["score"]
    assert [r["assertion_id"] for r in got] == ["mem-test-prose-a", "mem-test-prose-b"]
    # keyword bait in the query direction: scene ids/entities are ids, prose
    # fields are never consulted
    bait = rt.build_recall_context(entities=[CELLAR], scene_id=CELLAR)
    assert {r["assertion_id"] for r in rt.narrow_candidates([cellar_zh, cellar_en], bait)} == {
        "mem-test-prose-a",
        "mem-test-prose-b",
    }


def test_limit_truncates_warm_results():
    rows = [
        _assertion(f"lim-{i}", entities=(CELLAR,), source_turn=i + 1) for i in range(5)
    ]
    ctx = rt.build_recall_context(entities=[CELLAR])
    assert len(rt.narrow_candidates(rows, ctx, limit=2)) == 2
    warm = rt.build_warm_projection(rows, ctx)
    assert warm["tier"] == "warm"
    assert warm["limit"] == rt.DEFAULT_WARM_LIMIT
    warm_limited = rt.build_warm_projection(rows, rt.build_recall_context(limit=3))
    assert len(warm_limited["candidates"]) == 3


# ---------------------------------------------------------------------------
# Hot / warm / cold tiers
# ---------------------------------------------------------------------------


def test_hot_projection_newest_first_and_budget():
    rows = [
        _assertion("hot-1", source_turn=1),
        _assertion("hot-2", source_turn=2),
        _assertion("hot-3", source_turn=3),
        _assertion(
            "hot-closed",
            source_turn=4,
            valid_from=4,
            valid_until=4,
            superseded_by=("mem-test-hot-successor",),
        ),
    ]
    ctx = rt.build_recall_context()
    hot = rt.build_hot_projection(rows, ctx)
    assert hot["tier"] == "hot"
    assert hot["authority"] == "advisory"
    assert hot["hard_gate"] is False
    assert [c["assertion_id"] for c in hot["candidates"]] == [
        "mem-test-hot-3",
        "mem-test-hot-2",
        "mem-test-hot-1",
    ]
    capped = rt.build_hot_projection(rows, ctx, budget=2)
    assert [c["assertion_id"] for c in capped["candidates"]] == [
        "mem-test-hot-3",
        "mem-test-hot-2",
    ]
    # valid-time anchor governs: the closed row was effective at turn 4
    anchored = rt.build_hot_projection(rows, rt.build_recall_context(turn_number=4))
    assert [c["assertion_id"] for c in anchored["candidates"]][:1] == ["mem-test-hot-closed"]
    anchored5 = rt.build_hot_projection(rows, rt.build_recall_context(turn_number=5))
    assert "mem-test-hot-closed" not in [
        c["assertion_id"] for c in anchored5["candidates"]
    ]


def test_cold_projection_summaries_then_superseded():
    old, successor = _superseded_pair()
    summary = _assertion(
        "chapter-one",
        kind="summary",
        subject=PARTY,
        source_turn=6,
        covers=(COMMIT_A, COMMIT_B),
        statement="第一章摘要。",
    )
    open_row = _assertion("open-late", source_turn=7)
    attic_closed = _assertion(
        "attic-closed",
        timeline="tl-attic",
        valid_from=2,
        valid_until=3,
        superseded_by=("mem-test-attic-successor",),
        source_turn=2,
    )
    rows = [successor, old, summary, open_row, attic_closed]

    cold = rt.build_cold_projection(rows, rt.build_recall_context())
    assert cold["tier"] == "cold"
    assert [c["assertion_id"] for c in cold["candidates"]] == [
        "mem-test-chapter-one",
        "mem-test-door-old",
    ]
    assert cold["summary_count"] == 1
    assert cold["superseded_count"] == 1
    assert cold["covers_commits"] == [COMMIT_A, COMMIT_B]
    by_id = {c["assertion_id"]: c for c in cold["candidates"]}
    assert by_id["mem-test-door-old"]["source_refs"]["superseded_by"] == [
        "mem-test-door-new"
    ]
    assert by_id["mem-test-chapter-one"]["source_refs"]["covers_commits"] == [
        COMMIT_A,
        COMMIT_B,
    ]

    # archive relaxes the time anchor but never the timeline boundary
    cold_anchored = rt.build_cold_projection(
        rows, rt.build_recall_context(turn_number=99)
    )
    assert "mem-test-door-old" in [c["assertion_id"] for c in cold_anchored["candidates"]]
    assert "mem-test-attic-closed" not in [
        c["assertion_id"] for c in cold_anchored["candidates"]
    ]

    # budget caps summaries first
    tight = rt.build_cold_projection(rows, rt.build_recall_context(), budget=1)
    assert [c["assertion_id"] for c in tight["candidates"]] == ["mem-test-chapter-one"]


def test_source_refs_enable_exact_drill_down():
    row = _assertion("drill", source_turn=4, commit=COMMIT_C)
    got = rt.narrow_candidates([row], rt.build_recall_context())
    refs = got[0]["source_refs"]
    assert refs == {
        "assertion_id": "mem-test-drill",
        "timeline_id": "tl-main",
        "source_commit": COMMIT_C,
        "source_turn": 4,
        "source_receipts": ["receipt-drill"],
        "covers_commits": [],
        "superseded_by": [],
    }


# ---------------------------------------------------------------------------
# Contract validation of input rows (reviewer finding: no validation gate)
# ---------------------------------------------------------------------------


def test_malformed_rows_are_excluded_with_diagnostics():
    good = _assertion("good-row")
    bad_privacy = _assertion("bad-privacy", privacy="secret", validate=False)
    bad_time = _assertion(
        "bad-time",
        valid_from=5,
        valid_until=2,
        superseded_by=("mem-test-other",),
        validate=False,
    )
    bad_provenance = _assertion("bad-prov", source_turn=-1, validate=False)
    unknown_field = _assertion("bad-field", validate=False)
    unknown_field["mood"] = "spooky"
    rows = [bad_privacy, good, bad_time, "not-a-mapping", unknown_field, bad_provenance]

    report = rt.validate_assertion_rows(rows)
    assert [r["assertion_id"] for r in report["valid"]] == ["mem-test-good-row"]
    assert len(report["excluded"]) == 5
    by_id = {d["assertion_id"]: d for d in report["excluded"]}
    assert by_id["mem-test-bad-privacy"]["error"] == "ClosedEnumError"
    assert by_id["mem-test-bad-privacy"]["field"] == "privacy"
    assert by_id["mem-test-bad-time"]["error"] == "TemporalMemoryContractError"
    assert by_id["mem-test-bad-prov"]["error"] == "ProvenanceError"
    assert by_id["mem-test-bad-field"]["error"] == "UnknownFieldError"
    assert by_id[None]["error"] == "NotMapping"
    # diagnostics are deterministically sorted
    keys = [d["assertion_id"] or "" for d in report["excluded"]]
    assert keys == sorted(keys)

    ctx = rt.build_recall_context()
    assert [r["assertion_id"] for r in rt.narrow_candidates(rows, ctx)] == [
        "mem-test-good-row"
    ]
    hot = rt.build_hot_projection(rows, ctx)
    assert [c["assertion_id"] for c in hot["candidates"]] == ["mem-test-good-row"]
    assert hot["excluded_count"] == 5
    assert {d["assertion_id"] for d in hot["excluded"]} == {
        "mem-test-bad-privacy",
        "mem-test-bad-time",
        "mem-test-bad-prov",
        "mem-test-bad-field",
        None,
    }
    warm = rt.build_warm_projection(rows, ctx)
    assert warm["excluded_count"] == 5
    cold = rt.build_cold_projection(rows, ctx)
    assert cold["excluded_count"] == 5


def test_malformed_rows_fail_closed_for_player_view():
    # a row claiming player_safe but invalid elsewhere never reaches any
    # projection, so validation order cannot leak it into a player view
    sneaky = _assertion(
        "sneaky", privacy="player_safe", state="nope", validate=False
    )
    good = _assertion("safe-row")
    player = rt.build_recall_context(privacy="player_safe")
    got = rt.narrow_candidates([sneaky, good], player)
    assert [r["assertion_id"] for r in got] == ["mem-test-safe-row"]
    report = rt.validate_assertion_rows([sneaky])
    assert report["valid"] == []
    assert report["excluded"][0]["error"] == "ClosedEnumError"


def test_validate_assertion_rows_rejects_container_misuse():
    with pytest.raises(rt.TemporalRetrievalError, match="assertions"):
        rt.validate_assertion_rows("a-string")
    with pytest.raises(rt.TemporalRetrievalError, match="assertions"):
        rt.validate_assertion_rows({"mem-x": {}})
    with pytest.raises(rt.TemporalRetrievalError, match="assertions"):
        rt.validate_assertion_rows(123)


# ---------------------------------------------------------------------------
# Identity bindings for cross-campaign None-scope rows (reviewer finding)
# ---------------------------------------------------------------------------


def test_identity_bindings_must_be_contract_valid():
    bad = _subject_record("player", campaign_id=None, slug="table")
    bad["kind"] = "alien"
    with pytest.raises(rt.TemporalRetrievalError, match="identity binding"):
        rt.build_recall_context(campaign_id=CID, identity_bindings=[bad])
    with pytest.raises(rt.TemporalRetrievalError, match="identity_bindings"):
        rt.build_recall_context(campaign_id=CID, identity_bindings=["not-a-record"])
    with pytest.raises(rt.TemporalRetrievalError, match="identity_bindings"):
        rt.build_recall_context(campaign_id=CID, identity_bindings="nope")


def test_dangling_binding_chain_proves_nothing():
    # same_subject_as points at a record not in the binding set: fail closed
    dangling = _subject_record(
        "player", campaign_id=None, slug="table", same_as=("subject-player-ghost",)
    )
    ctx = rt.build_recall_context(campaign_id=CID, identity_bindings=[dangling])
    assert ctx["bound_subject_ids"] == []
    row = _assertion(
        "ghost-pref",
        kind="player_preference",
        subject=PLAYER,
        campaign_id=None,
    )
    assert rt.narrow_candidates([row], ctx) == []


def test_binding_to_other_campaign_does_not_admit():
    other_campaign = _subject_record("player", campaign_id="other", slug="table")
    ctx = rt.build_recall_context(campaign_id=CID, identity_bindings=[other_campaign])
    assert ctx["bound_subject_ids"] == []
    row = _assertion(
        "foreign-pref",
        kind="player_preference",
        subject=PLAYER,
        campaign_id=None,
    )
    assert rt.narrow_candidates([row], ctx) == []


PLAYER_TARGET = "subject-player-table-of-test"


def _none_scope_row(slug: str, subject: str = PLAYER) -> dict:
    return _assertion(
        slug, kind="player_preference", subject=subject, campaign_id=None
    )


def _pinned(records: list[dict]) -> dict:
    return rt.build_recall_context(campaign_id=CID, identity_bindings=records)


def _bound_of(records: list[dict]) -> list[str]:
    return _pinned(records)["bound_subject_ids"]


def test_binding_requires_explicit_edge_mere_presence_rejects():
    # no edge at all — target-campaign record present, global present
    records = [
        _subject_record("player", campaign_id=CID, slug="table-of-test"),
        _subject_record("player", campaign_id=None, slug="table"),
    ]
    assert _bound_of(records) == []
    assert rt.narrow_candidates([_none_scope_row("no-edge")], _pinned(records)) == []


def test_binding_direct_edge_allows():
    records = [
        _subject_record(
            "player",
            campaign_id=None,
            slug="table",
            same_as=(PLAYER_TARGET,),
        ),
        _subject_record("player", campaign_id=CID, slug="table-of-test"),
    ]
    assert _bound_of(records) == [PLAYER]
    got = rt.narrow_candidates([_none_scope_row("direct")], _pinned(records))
    assert [r["assertion_id"] for r in got] == ["mem-xc-direct"]


def test_binding_reverse_edge_allows():
    # edge declared on the target-campaign endpoint
    records = [
        _subject_record("player", campaign_id=None, slug="table"),
        _subject_record(
            "player", campaign_id=CID, slug="table-of-test", same_as=(PLAYER,)
        ),
    ]
    assert _bound_of(records) == [PLAYER]
    got = rt.narrow_candidates([_none_scope_row("reverse")], _pinned(records))
    assert [r["assertion_id"] for r in got] == ["mem-xc-reverse"]


def test_binding_dangling_edge_rejects():
    records = [
        _subject_record(
            "player", campaign_id=None, slug="table", same_as=("subject-player-ghost",)
        )
    ]
    assert _bound_of(records) == []
    assert rt.narrow_candidates([_none_scope_row("dangling")], _pinned(records)) == []


def test_binding_chain_through_another_campaign_rejects():
    # global -> other-campaign subject -> target-campaign subject
    records = [
        _subject_record(
            "player",
            campaign_id=None,
            slug="table",
            same_as=("subject-player-relay-other",),
        ),
        _subject_record(
            "player",
            campaign_id="other",
            slug="relay-other",
            same_as=(PLAYER_TARGET,),
        ),
        _subject_record("player", campaign_id=CID, slug="table-of-test"),
    ]
    assert _bound_of(records) == []
    assert rt.narrow_candidates([_none_scope_row("chain")], _pinned(records)) == []


def test_binding_unrelated_campaign_scoped_record_rejects():
    # a target-campaign subject exists but has nothing to do with PLAYER
    records = [
        _subject_record("player", campaign_id=None, slug="table"),
        _subject_record("player", campaign_id=CID, slug="someone-else"),
    ]
    assert _bound_of(records) == []
    assert rt.narrow_candidates([_none_scope_row("unrelated")], _pinned(records)) == []


def test_binding_no_transitive_global_shortcut():
    # global A -> global B -> target-campaign: only B is directly bound;
    # A must not inherit the binding transitively
    records = [
        _subject_record(
            "player", campaign_id=None, slug="a", same_as=("subject-player-b",)
        ),
        _subject_record(
            "player", campaign_id=None, slug="b", same_as=(PLAYER_TARGET,)
        ),
        _subject_record("player", campaign_id=CID, slug="table-of-test"),
    ]
    assert _bound_of(records) == ["subject-player-b"]
    ctx = _pinned(records)
    assert rt.narrow_candidates([_none_scope_row("hop-a", subject="subject-player-a")], ctx) == []
    got = rt.narrow_candidates([_none_scope_row("hop-b", subject="subject-player-b")], ctx)
    assert [r["assertion_id"] for r in got] == ["mem-xc-hop-b"]


def test_bindings_without_campaign_pin_have_no_effect():
    chain = [
        _subject_record(
            "player", campaign_id=None, slug="table", same_as=("subject-player-x",)
        ),
        _subject_record("player", campaign_id=CID, slug="x"),
    ]
    ctx = rt.build_recall_context(identity_bindings=chain)
    assert ctx["bound_subject_ids"] == []
    # unpinned campaign recall still admits cross-campaign rows (trusted bundle)
    row = _assertion(
        "free-pref", kind="player_preference", subject=PLAYER, campaign_id=None
    )
    assert [r["assertion_id"] for r in rt.narrow_candidates([row], ctx)] == [
        "mem-xc-free-pref"
    ]


# ---------------------------------------------------------------------------
# Zero results, determinism
# ---------------------------------------------------------------------------


def test_zero_results_are_empty_not_errors():
    rows = [_assertion("solo", entities=(CELLAR,))]
    unknown_entity = rt.build_recall_context(entities=["entity-location-nowhere"])
    assert rt.narrow_candidates(rows, unknown_entity) == []
    warm = rt.build_warm_projection(rows, unknown_entity)
    assert warm["count"] == 0 and warm["candidates"] == []
    hot = rt.build_hot_projection([], rt.build_recall_context())
    assert hot["count"] == 0
    cold = rt.build_cold_projection(rows, unknown_entity)
    assert cold["count"] == 0
    all_secret = [_assertion("hidden", privacy="keeper_only")]
    player = rt.build_recall_context(privacy="player_safe")
    assert rt.narrow_candidates(all_secret, player) == []


def test_deterministic_order_independent_of_input_order():
    rows = [
        _assertion("det-a", entities=(CELLAR,), source_turn=3),
        _assertion("det-b", entities=(CELLAR, JOURNAL), source_turn=3),
        _assertion("det-c", entities=(CELLAR,), source_turn=8),
    ]
    ctx = rt.build_recall_context(entities=[CELLAR, JOURNAL], turn_number=9)
    first = rt.narrow_candidates(rows, ctx)
    shuffled = [rows[2], rows[0], rows[1]]
    second = rt.narrow_candidates(shuffled, ctx)
    assert [r["assertion_id"] for r in first] == [r["assertion_id"] for r in second]
    again = rt.narrow_candidates(rows, ctx)
    assert json.dumps(first, sort_keys=True) == json.dumps(again, sort_keys=True)
