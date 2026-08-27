"""Deterministic tests for the temporal memory facade."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_temporal_retrieval

COMMIT_A = "a" * 40
COMMIT_B = "b" * 40


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


tm = _load("coc_temporal_memory_under_test", SCRIPTS / "coc_temporal_memory.py")
contract = tm.contract


def _camp(tmp_path: Path, name: str = "test") -> Path:
    camp = tmp_path / "campaigns" / name
    camp.mkdir(parents=True)
    return camp


def _assertion(camp: Path, **overrides) -> dict:
    cid = camp.name
    base = {
        "assertion_id": f"mem-{cid}-cellar-knock",
        "kind": "belief",
        "scope": "campaign",
        "campaign_id": cid,
        "timeline_id": "tl-main",
        "subject_id": contract.subject_id_for("party", cid, ""),
        "knowers": [contract.subject_id_for("party", cid, "")],
        "privacy": "player_safe",
        "state": "accurate",
        "statement": "地窖里有敲击声。",
        "entities": ["entity-location-cellar"],
        "occurred_turn": 3,
        "valid_from_turn": 3,
        "source_commit": COMMIT_A,
        "source_turn": 3,
        "source_receipts": ["receipt-turn-3"],
    }
    base.update(overrides)
    return tm.record_assertion(base, campaign_dir=camp)


# ---------------------------------------------------------------------------
# Episodes
# ---------------------------------------------------------------------------


def test_record_episode_is_immutable_and_hashes_text(tmp_path):
    camp = _camp(tmp_path)
    first = tm.record_episode(
        COMMIT_A,
        "tl-main",
        2,
        ["receipt-final-turn-2"],
        "我检查地窖门。",
        "门闩上有新的划痕。",
        campaign_dir=camp,
    )
    assert first["episode_id"] == "episode-test-tl-main-turn-2"
    assert first["commit"] == COMMIT_A
    assert first["turn_number"] == 2
    assert first["finalization_receipt"] == "receipt-final-turn-2"
    expected_player = hashlib.sha256("我检查地窖门。".encode("utf-8")).hexdigest()
    expected_keeper = hashlib.sha256("门闩上有新的划痕。".encode("utf-8")).hexdigest()
    assert first["evidence"]["player_text_sha256"] == expected_player
    assert first["evidence"]["keeper_text_sha256"] == expected_keeper
    assert "我检查地窖门" not in json.dumps(first, ensure_ascii=False)

    # byte-identical replay is idempotent (same receipts + same text)
    again = tm.record_episode(
        COMMIT_A,
        "tl-main",
        2,
        ["receipt-final-turn-2"],
        "我检查地窖门。",
        "门闩上有新的划痕。",
        campaign_dir=camp,
    )
    assert again["episode_id"] == first["episode_id"]
    assert again["commit"] == COMMIT_A
    assert again["evidence"] == first["evidence"]

    # any drift fails closed: different commit, text, receipts, participants
    with pytest.raises(tm.TemporalMemoryError, match="immutable"):
        tm.record_episode(
            COMMIT_B,
            "tl-main",
            2,
            ["receipt-final-turn-2"],
            "我检查地窖门。",
            "门闩上有新的划痕。",
            campaign_dir=camp,
        )
    with pytest.raises(tm.TemporalMemoryError, match="immutable"):
        tm.record_episode(
            COMMIT_A,
            "tl-main",
            2,
            ["receipt-final-turn-2"],
            "改写后的玩家文本",
            "门闩上有新的划痕。",
            campaign_dir=camp,
        )
    with pytest.raises(tm.TemporalMemoryError, match="immutable"):
        tm.record_episode(
            COMMIT_A,
            "tl-main",
            2,
            ["receipt-other"],
            "我检查地窖门。",
            "门闩上有新的划痕。",
            campaign_dir=camp,
        )
    party = contract.subject_id_for("party", camp.name, "")
    with pytest.raises(tm.TemporalMemoryError, match="immutable"):
        tm.record_episode(
            COMMIT_A,
            "tl-main",
            2,
            ["receipt-final-turn-2"],
            "我检查地窖门。",
            "门闩上有新的划痕。",
            campaign_dir=camp,
            subjects_present=[party],
        )


def test_record_episode_without_candidates_enqueues_backlog(tmp_path):
    camp = _camp(tmp_path)
    tm.record_episode(
        COMMIT_A, "tl-main", 1, ["receipt-final-turn-1"], "", "",
        campaign_dir=camp,
    )
    backlog = tm._load_latest(tm._path(camp, "backlog"), "backlog_id")
    row = backlog["backlog-test-t1-extract"]
    assert row["reason"] == "review_required"
    assert row["status"] == "pending"


def test_record_episode_keeps_candidates_off_world_store(tmp_path):
    camp = _camp(tmp_path)
    tm.record_episode(
        COMMIT_A,
        "tl-main",
        4,
        ["receipt-final-turn-4"],
        "player",
        "keeper",
        campaign_dir=camp,
        candidates=[
            {"kind": "entity", "label": "cellar door"},
            {"kind": "relationship", "from": "ada", "to": "knott"},
        ],
    )
    assert tm.load_assertions(camp) == {}
    evidence = tm.load_episode_evidence(camp)["episode-test-tl-main-turn-4"]
    assert len(evidence["candidate_entities"]) == 1
    assert len(evidence["candidate_relationships"]) == 1


# ---------------------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------------------


def test_record_assertion_validates_and_is_idempotent(tmp_path):
    camp = _camp(tmp_path)
    first = _assertion(camp)
    contract.validate_assertion(first)
    again = _assertion(camp)
    assert again == first
    lines = (camp / "memory" / "temporal" / "assertions.jsonl").read_text(
        encoding="utf-8"
    ).strip().splitlines()
    assert len(lines) == 1


def test_record_assertion_rejects_unknown_kind(tmp_path):
    camp = _camp(tmp_path)
    with pytest.raises(contract.ClosedEnumError):
        _assertion(camp, kind="rumor")


def test_record_assertion_refuses_in_place_overwrite(tmp_path):
    camp = _camp(tmp_path)
    _assertion(camp)
    with pytest.raises(tm.TemporalMemoryError, match="already exists"):
        _assertion(camp, statement="改写原陈述")


# ---------------------------------------------------------------------------
# Recall ranking + privacy
# ---------------------------------------------------------------------------


def test_recall_ranks_by_entity_then_recency(tmp_path):
    camp = _camp(tmp_path)
    party = contract.subject_id_for("party", camp.name, "")
    _assertion(
        camp,
        assertion_id="mem-test-door-scratch",
        statement="门上的划痕",
        entities=["entity-location-front-door"],
        source_turn=1,
        valid_from_turn=1,
        occurred_turn=1,
    )
    _assertion(
        camp,
        assertion_id="mem-test-cellar-later",
        statement="更晚的地窖记忆",
        entities=["entity-location-cellar"],
        source_turn=9,
        valid_from_turn=9,
        occurred_turn=9,
    )
    _assertion(
        camp,
        assertion_id="mem-test-cellar-early",
        statement="较早的地窖记忆",
        entities=["entity-location-cellar"],
        source_turn=2,
        valid_from_turn=2,
        occurred_turn=2,
    )
    result = tm.recall(
        party,
        {
            "campaign_dir": camp,
            "entities": ["entity-location-cellar"],
            "view": "keeper",
            "limit": 5,
        },
    )
    assert result["authority"] == "advisory"
    assert result["hard_gate"] is False
    ids = [row["assertion_id"] for row in result["candidates"]]
    assert ids[0] == "mem-test-cellar-later"
    assert "mem-test-door-scratch" not in ids


def test_recall_privacy_hides_keeper_only_from_player_view(tmp_path):
    camp = _camp(tmp_path)
    _assertion(
        camp,
        assertion_id="mem-test-public",
        privacy="player_safe",
        entities=["entity-location-cellar"],
    )
    _assertion(
        camp,
        assertion_id="mem-test-secret",
        privacy="keeper_only",
        entities=["entity-location-cellar"],
        statement="Corbitt 埋在地下室。",
    )
    player = tm.recall(
        None,
        {
            "campaign_dir": camp,
            "entities": ["entity-location-cellar"],
            "privacy": "player_safe",
        },
    )
    assert {row["assertion_id"] for row in player["candidates"]} == {"mem-test-public"}
    keeper = tm.recall(
        None,
        {
            "campaign_dir": camp,
            "entities": ["entity-location-cellar"],
            "view": "keeper",
        },
    )
    assert {row["assertion_id"] for row in keeper["candidates"]} == {
        "mem-test-public",
        "mem-test-secret",
    }


def test_recall_excludes_superseded_unless_as_of_includes_them(tmp_path):
    camp = _camp(tmp_path)
    original = _assertion(camp)
    successor = _assertion(
        camp,
        assertion_id="mem-test-cellar-knock-closed",
        statement="敲击声来源已揭晓",
        valid_from_turn=9,
        occurred_turn=3,
        source_turn=9,
        confirms=[original["assertion_id"]],
    )
    closed = contract.plan_supersession(
        original, successor["assertion_id"], valid_until_turn=9
    )
    tm.record_assertion(closed, campaign_dir=camp)

    current = tm.recall(
        None, {"campaign_dir": camp, "entities": ["entity-location-cellar"]}
    )
    assert [row["assertion_id"] for row in current["candidates"]] == [
        successor["assertion_id"]
    ]

    historic = tm.recall(
        None,
        {
            "campaign_dir": camp,
            "entities": ["entity-location-cellar"],
            "as_of_turn": 4,
        },
    )
    assert [row["assertion_id"] for row in historic["candidates"]] == [
        original["assertion_id"]
    ]


# ---------------------------------------------------------------------------
# Recall = thin read-only adapter over the canonical retrieval core
# ---------------------------------------------------------------------------


def test_recall_on_absent_store_is_read_only_and_empty(tmp_path):
    camp = _camp(tmp_path)
    result = tm.recall(
        None,
        {"campaign_dir": camp, "entities": ["entity-location-cellar"]},
    )
    assert result["tier"] == "warm"
    assert result["count"] == 0
    assert result["candidates"] == []
    assert result["excluded_count"] == 0
    assert result["pending_player_assertions"] == []
    # A query never bootstraps the canonical store.
    assert not (camp / "memory" / "temporal").exists()


def test_recall_matches_canonical_warm_projection(tmp_path):
    camp = _camp(tmp_path)
    _assertion(
        camp,
        assertion_id="mem-test-parity-a",
        entities=["entity-location-cellar"],
        source_turn=5,
        valid_from_turn=5,
        occurred_turn=5,
    )
    _assertion(
        camp,
        assertion_id="mem-test-parity-b",
        entities=["entity-location-attic"],
        source_turn=7,
        valid_from_turn=7,
        occurred_turn=7,
    )
    adapted = tm.recall(
        None,
        {
            "campaign_dir": camp,
            "entities": ["entity-location-cellar"],
            "view": "keeper",
            "as_of_turn": 6,
        },
    )
    canonical = coc_temporal_retrieval.build_warm_projection(
        list(tm.load_assertions(camp).values()),
        coc_temporal_retrieval.build_recall_context(
            subject_id=None,
            timeline_id="tl-main",
            turn_number=6,
            entities=["entity-location-cellar"],
            privacy="keeper",
            campaign_id=camp.name,
            identity_bindings=list(tm.load_subjects(camp).values()),
        ),
    )
    # Byte-equal candidates: the facade owns no ranking of its own.
    assert adapted["candidates"] == canonical["candidates"]
    assert [row["assertion_id"] for row in adapted["candidates"]] == [
        "mem-test-parity-a"
    ]


def test_recall_default_limit_matches_canonical_warm_default(tmp_path):
    """No explicit limit -> the canonical warm default (12), not the retired
    facade default (8): nine qualifying candidates all return, byte-equal
    with the core built the same way."""
    camp = _camp(tmp_path)
    for n in range(1, 10):
        _assertion(
            camp,
            assertion_id=f"mem-test-default-{n:02d}",
            entities=["entity-location-cellar"],
            source_turn=n,
            valid_from_turn=n,
            occurred_turn=n,
        )
    adapted = tm.recall(
        None,
        {
            "campaign_dir": camp,
            "entities": ["entity-location-cellar"],
            "view": "keeper",
        },
    )
    canonical = coc_temporal_retrieval.build_warm_projection(
        list(tm.load_assertions(camp).values()),
        coc_temporal_retrieval.build_recall_context(
            subject_id=None,
            timeline_id="tl-main",
            entities=["entity-location-cellar"],
            privacy="keeper",
            campaign_id=camp.name,
            identity_bindings=list(tm.load_subjects(camp).values()),
        ),
    )
    assert len(adapted["candidates"]) == 9
    assert adapted["candidates"] == canonical["candidates"]
    # Deterministic warm order (score tie -> newer source_turn first).
    assert adapted["candidates"][0]["assertion_id"] == "mem-test-default-09"


def test_recall_pins_campaign_against_foreign_rows(tmp_path):
    camp = _camp(tmp_path)
    _assertion(
        camp,
        assertion_id="mem-test-own",
        entities=["entity-location-cellar"],
    )
    # A foreign campaign-scoped row physically present in this store is
    # excluded by campaign pinning.
    _assertion(
        camp,
        assertion_id="mem-other-foreign",
        campaign_id="other",
        entities=["entity-location-cellar"],
    )

    result = tm.recall(
        None,
        {"campaign_dir": camp, "entities": ["entity-location-cellar"]},
    )
    assert {row["assertion_id"] for row in result["candidates"]} == {
        "mem-test-own"
    }


def test_recall_fails_closed_on_corrupt_assertion_rows(tmp_path):
    """Strict assertion-store read boundary: idless objects, non-object
    JSON, malformed JSON, and contract-invalid payloads are temporal store
    corruption — the query fails closed and never writes or bootstraps."""
    camp = _camp(tmp_path)
    _assertion(
        camp,
        assertion_id="mem-test-own",
        entities=["entity-location-cellar"],
    )
    assertions_path = camp / "memory" / "temporal" / "assertions.jsonl"
    good = assertions_path.read_text(encoding="utf-8")
    bad_lines = [
        json.dumps({"kind": "belief"}),                        # idless dict
        json.dumps([{"assertion_id": "mem-x"}]),              # JSON list
        json.dumps("scalar"),                                  # JSON string
        json.dumps(7),                                         # JSON number
        '{"assertion_id": "mem-y", broken',                    # malformed JSON
        json.dumps({"assertion_id": "mem-z", "kind": "belief"}),  # contract-invalid
    ]
    for bad in bad_lines:
        assertions_path.write_text(good + bad + "\n", encoding="utf-8")
        with pytest.raises(tm.TemporalMemoryError, match="corruption"):
            tm.recall(
                None,
                {"campaign_dir": camp, "entities": ["entity-location-cellar"]},
            )
        # The failed query left the append-only store byte-identical.
        assert assertions_path.read_text(encoding="utf-8") == good + bad + "\n"


def test_recall_fails_closed_on_invalid_context(tmp_path):
    camp = _camp(tmp_path)
    _assertion(camp)
    with pytest.raises(ValueError, match="privacy"):
        tm.recall(None, {"campaign_dir": camp, "view": "secret"})
    with pytest.raises(ValueError, match="turn_number"):
        tm.recall(None, {"campaign_dir": camp, "as_of_turn": "3"})
    with pytest.raises(ValueError, match="entities"):
        tm.recall(None, {"campaign_dir": camp, "entities": ["cellar"]})


# ---------------------------------------------------------------------------
# Player assertion flow
# ---------------------------------------------------------------------------


def test_player_assertion_stays_candidate_until_adjudicated(tmp_path):
    camp = _camp(tmp_path)
    player = contract.subject_id_for("player", None, "table")
    candidate = _assertion(
        camp,
        assertion_id="mem-test-player-ghost",
        kind="player_assertion",
        subject_id=player,
        knowers=[player],
        state="uncertain",
        statement="地窖敲击是鬼。",
    )
    assert candidate["kind"] == "player_assertion"
    recalled = tm.recall(
        player,
        {"campaign_dir": camp, "entities": ["entity-location-cellar"]},
    )
    assert recalled["pending_player_assertions"][0]["assertion_id"] == candidate["assertion_id"]
    assert all(row["kind"] != "world_event" for row in recalled["candidates"])

    receipt = tm.adjudicate_candidate(
        "adj-accept-ghost",
        candidate["assertion_id"],
        "accept",
        campaign_dir=camp,
        kind="belief",
    )
    assert receipt["action"] == "accept"
    assert receipt["promoted_assertion_id"]
    # exact request replay is idempotent
    replay = tm.adjudicate_candidate(
        "adj-accept-ghost",
        candidate["assertion_id"],
        "accept",
        campaign_dir=camp,
        kind="belief",
    )
    assert replay == receipt
    # decision-id reuse with a different action/candidate fails closed
    with pytest.raises(tm.TemporalMemoryError, match="already bound"):
        tm.adjudicate_candidate(
            "adj-accept-ghost",
            candidate["assertion_id"],
            "reject",
            campaign_dir=camp,
        )
    with pytest.raises(tm.TemporalMemoryError, match="already bound"):
        tm.adjudicate_candidate(
            "adj-accept-ghost",
            "mem-test-missing",
            "accept",
            campaign_dir=camp,
        )

    store = tm.load_assertions(camp)
    assert store[candidate["assertion_id"]]["kind"] == "player_assertion"
    promoted = store[receipt["promoted_assertion_id"]]
    assert promoted["kind"] == "belief"
    assert promoted["confirms"] == [candidate["assertion_id"]]
    assert promoted["subject_id"] == contract.subject_id_for("party", camp.name, "")


def test_adjudicate_modify_and_reject(tmp_path):
    camp = _camp(tmp_path)
    player = contract.subject_id_for("player", None, "table")
    candidate = _assertion(
        camp,
        assertion_id="mem-test-player-wind",
        kind="player_assertion",
        subject_id=player,
        knowers=[player],
        state="uncertain",
        statement="只是风。",
    )
    modified = tm.adjudicate_candidate(
        "adj-modify-wind",
        candidate["assertion_id"],
        "modify",
        campaign_dir=camp,
        statement="可能是风，也可能是管道。",
        kind="belief",
        state="uncertain",
    )
    promoted = tm.load_assertions(camp)[modified["promoted_assertion_id"]]
    assert promoted["statement"] == "可能是风，也可能是管道。"
    assert promoted["confirms"] == [candidate["assertion_id"]]

    other = _assertion(
        camp,
        assertion_id="mem-test-player-other",
        kind="player_assertion",
        subject_id=player,
        knowers=[player],
        statement="管家就是凶手。",
    )
    rejected = tm.adjudicate_candidate(
        "adj-reject-butler",
        other["assertion_id"],
        "reject",
        campaign_dir=camp,
    )
    assert rejected["promoted_assertion_id"] is None
    assert tm.load_assertions(camp)[other["assertion_id"]]["kind"] == "player_assertion"


def test_adjudicate_unknown_action_and_missing_candidate(tmp_path):
    camp = _camp(tmp_path)
    with pytest.raises(tm.TemporalMemoryError, match="action"):
        tm.adjudicate_candidate("d1", "mem-test-x", "ignore", campaign_dir=camp)
    with pytest.raises(tm.TemporalMemoryError, match="not found"):
        tm.adjudicate_candidate("d2", "mem-test-missing", "accept", campaign_dir=camp)
    with pytest.raises(tm.TemporalMemoryError, match="statement"):
        player = contract.subject_id_for("player", None, "table")
        cand = _assertion(
            camp,
            assertion_id="mem-test-player-blank",
            kind="player_assertion",
            subject_id=player,
            knowers=[player],
            statement="x",
        )
        tm.adjudicate_candidate(
            "d3", cand["assertion_id"], "modify", campaign_dir=camp, statement=""
        )


# ---------------------------------------------------------------------------
# Hook resolution / supersession
# ---------------------------------------------------------------------------


def test_resolve_hook_writes_supersession_edge(tmp_path):
    camp = _camp(tmp_path)
    original = _assertion(
        camp,
        assertion_id="mem-test-hook-cellar",
        kind="belief",
        privacy="keeper_only",
        state="uncertain",
        statement="地窖敲击尚未解释。",
    )
    tm.register_hook(
        "mem-hook-cellar",
        original["assertion_id"],
        campaign_dir=camp,
        kind="unresolved_hook",
        introduced_at="turn-3",
    )
    receipt = tm.resolve_hook(
        "mem-hook-cellar",
        "paid_off",
        "hook-payoff-1",
        campaign_dir=camp,
        resolved_at="turn-9",
        reason="第九回合揭晓来源",
    )
    assert receipt["already_resolved"] is False
    assert receipt["status"] == "paid_off"
    assert receipt["successor_id"]

    store = tm.load_assertions(camp)
    closed = store[original["assertion_id"]]
    assert closed["statement"] == "地窖敲击尚未解释。"
    assert closed["valid_until_turn"] == 9
    assert closed["superseded_by"] == [receipt["successor_id"]]
    successor = store[receipt["successor_id"]]
    assert successor["confirms"] == [original["assertion_id"]]
    assert successor["statement"] == "第九回合揭晓来源"

    replay = tm.resolve_hook(
        "mem-hook-cellar",
        "paid_off",
        "hook-payoff-1",
        campaign_dir=camp,
        resolved_at="turn-9",
        reason="第九回合揭晓来源",
    )
    assert replay["already_resolved"] is True

    same_status = tm.resolve_hook(
        "mem-hook-cellar",
        "paid_off",
        "hook-payoff-2",
        campaign_dir=camp,
    )
    assert same_status["already_resolved"] is True


def test_resolve_hook_rejects_bad_resolution_and_missing(tmp_path):
    camp = _camp(tmp_path)
    with pytest.raises(tm.TemporalMemoryError, match="resolution"):
        tm.resolve_hook("mem-x", "open", "d1", campaign_dir=camp)
    with pytest.raises(tm.TemporalMemoryError, match="not found"):
        tm.resolve_hook("mem-missing", "resolved", "d2", campaign_dir=camp)


# ---------------------------------------------------------------------------
# Resume projection
# ---------------------------------------------------------------------------


def test_build_resume_projection_uses_summaries_and_temporal_history(tmp_path):
    camp = _camp(tmp_path)
    tm.record_episode(
        COMMIT_A, "tl-main", 1, ["receipt-final-turn-1"], "p1", "k1",
        campaign_dir=camp,
    )
    _assertion(camp)
    player = contract.subject_id_for("player", None, "table")
    _assertion(
        camp,
        assertion_id="mem-test-player-guess",
        kind="player_assertion",
        subject_id=player,
        knowers=[player],
        statement="玩家猜测管家有问题。",
    )
    tm.register_hook(
        "mem-hook-open",
        "mem-test-cellar-knock",
        campaign_dir=camp,
    )
    summaries = camp / "memory" / "session-summaries.jsonl"
    summaries.write_text(
        json.dumps(
            {"turn_number": 1, "summary": "调查员进入大宅。"},
            ensure_ascii=False,
        )
        + "\n"
        + json.dumps(
            {"turn_number": 3, "summary": "地窖传来敲击。"},
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    capsule = tm.build_resume_projection("test", 3, campaign_dir=camp)
    assert capsule["authority"] == "advisory"
    assert capsule["hard_gate"] is False
    assert capsule["schema_generation"] == "temporal-memory-1"
    assert capsule["campaign_id"] == "test"
    assert capsule["turn_number"] == 3
    assert capsule["recent_episodes"][0]["episode_id"] == "episode-test-tl-main-turn-1"
    assert capsule["recent_episodes"][0]["player_text_sha256"]
    assert any(
        row["assertion_id"] == "mem-test-cellar-knock"
        for row in capsule["active_assertions"]
    )
    assert any(row["memory_id"] == "mem-hook-open" for row in capsule["open_hooks"])
    assert any(
        row["assertion_id"] == "mem-test-player-guess"
        for row in capsule["pending_candidates"]
    )
    assert [row["summary"] for row in capsule["session_summaries"]] == [
        "调查员进入大宅。",
        "地窖传来敲击。",
    ]


def test_store_is_rebuildable_jsonl_under_temporal(tmp_path):
    camp = _camp(tmp_path)
    tm.record_episode(
        COMMIT_A, "tl-main", 1, ["receipt-final-turn-1"], "p", "k",
        campaign_dir=camp,
    )
    _assertion(camp)
    root = camp / "memory" / "temporal"
    assert (root / "schema.json").exists()
    assert (root / "episodes.jsonl").exists()
    assert (root / "assertions.jsonl").exists()
    schema = json.loads((root / "schema.json").read_text(encoding="utf-8"))
    assert schema["schema_generation"] == "temporal-memory-1"
    assert schema["authority"] == "advisory"


# ---------------------------------------------------------------------------
# Adversarial immutability / idempotency (reviewer-cited gaps)
# ---------------------------------------------------------------------------


def test_supersession_close_rejects_field_tampering(tmp_path):
    """A same-id close may change ONLY valid_until_turn + the appended
    successor id (the exact plan_supersession delta)."""
    camp = _camp(tmp_path)
    party = contract.subject_id_for("party", camp.name, "")
    keeper = contract.subject_id_for("keeper", None, "table")
    original = _assertion(camp)
    successor = _assertion(
        camp,
        assertion_id="mem-test-cellar-knock-v2",
        statement="来源已揭晓",
        valid_from_turn=9,
        occurred_turn=3,
        source_turn=9,
        confirms=[original["assertion_id"]],
    )
    closed = contract.plan_supersession(
        original, successor["assertion_id"], valid_until_turn=9
    )
    tm.record_assertion(closed, campaign_dir=camp)

    for field, value in (
        ("knowers", [party, keeper]),
        ("privacy", "keeper_only"),
        ("state", "distorted"),
        ("entities", []),
        ("source_receipts", ["receipt-forged"]),
        ("statement", "改写原陈述"),
    ):
        tampered = dict(closed)
        tampered[field] = value
        with pytest.raises(tm.TemporalMemoryError, match="plan_supersession"):
            tm.record_assertion(tampered, campaign_dir=camp)


def test_closed_assertion_cannot_be_reclosed_or_edited(tmp_path):
    camp = _camp(tmp_path)
    original = _assertion(camp)
    successor = _assertion(
        camp,
        assertion_id="mem-test-cellar-knock-v2",
        statement="来源已揭晓",
        valid_from_turn=9,
        occurred_turn=3,
        source_turn=9,
    )
    closed = contract.plan_supersession(
        original, successor["assertion_id"], valid_until_turn=9
    )
    stored = tm.record_assertion(closed, campaign_dir=camp)
    # byte-identical replay of the closed record stays idempotent
    assert tm.record_assertion(closed, campaign_dir=camp) == stored
    # a second close (extra successor, later turn) is a rewrite and fails
    reclosed = contract.plan_supersession(
        closed, "mem-test-cellar-knock-v3", valid_until_turn=12
    )
    with pytest.raises(tm.TemporalMemoryError, match="plan_supersession"):
        tm.record_assertion(reclosed, campaign_dir=camp)


def test_adjudication_replay_rejects_modified_parameters(tmp_path):
    camp = _camp(tmp_path)
    player = contract.subject_id_for("player", None, "table")
    candidate = _assertion(
        camp,
        assertion_id="mem-test-player-wind-x",
        kind="player_assertion",
        subject_id=player,
        knowers=[player],
        statement="只是风。",
    )
    first = tm.adjudicate_candidate(
        "adj-mod-x",
        candidate["assertion_id"],
        "modify",
        campaign_dir=camp,
        statement="可能是风。",
        kind="belief",
    )
    with pytest.raises(tm.TemporalMemoryError, match="already bound"):
        tm.adjudicate_candidate(
            "adj-mod-x",
            candidate["assertion_id"],
            "modify",
            campaign_dir=camp,
            statement="不是风。",
            kind="belief",
        )
    with pytest.raises(tm.TemporalMemoryError, match="already bound"):
        tm.adjudicate_candidate(
            "adj-mod-x", candidate["assertion_id"], "accept", campaign_dir=camp
        )
    replay = tm.adjudicate_candidate(
        "adj-mod-x",
        candidate["assertion_id"],
        "modify",
        campaign_dir=camp,
        statement="可能是风。",
        kind="belief",
    )
    assert replay == first


def test_adjudication_receipt_without_fingerprint_fails_closed(tmp_path):
    """A stored decision row carrying no request fingerprint cannot be
    verified, so replay refuses instead of trusting the old receipt."""
    camp = _camp(tmp_path)
    player = contract.subject_id_for("player", None, "table")
    candidate = _assertion(
        camp,
        assertion_id="mem-test-player-legacy",
        kind="player_assertion",
        subject_id=player,
        knowers=[player],
        statement="遗留决定。",
    )
    tm._append_jsonl(
        tm._path(camp, "adjudications"),
        {
            "decision_id": "adj-legacy",
            "adjudication_id": "mem-test-adj-adj-legacy",
            "candidate_id": candidate["assertion_id"],
            "action": "accept",
            "promoted_assertion_id": None,
            "authority": "advisory",
            "hard_gate": False,
        },
    )
    with pytest.raises(tm.TemporalMemoryError, match="already bound"):
        tm.adjudicate_candidate(
            "adj-legacy", candidate["assertion_id"], "accept", campaign_dir=camp
        )


def test_generated_ids_cannot_collide_through_truncation(tmp_path):
    camp = _camp(tmp_path)
    player = contract.subject_id_for("player", None, "table")
    candidate = _assertion(
        camp,
        assertion_id="mem-test-player-longcand",
        kind="player_assertion",
        subject_id=player,
        knowers=[player],
        statement="长 id 候选。",
    )
    long_a = "adj-" + "d" * 200 + "-first"
    long_b = "adj-" + "d" * 200 + "-second"
    first = tm.adjudicate_candidate(
        long_a, candidate["assertion_id"], "reject", campaign_dir=camp
    )
    assert first["adjudication_id"] == tm._adjudication_id(camp.name, long_a)
    assert len(first["adjudication_id"]) <= contract._MAX_ID_LEN
    assert first["adjudication_id"] == tm._adjudication_id(camp.name, long_b)
    # distinct decisions may not silently share one generated id
    with pytest.raises(tm.TemporalMemoryError, match="collides"):
        tm.adjudicate_candidate(
            long_b, candidate["assertion_id"], "reject", campaign_dir=camp
        )

    candidate2 = _assertion(
        camp,
        assertion_id="mem-test-player-longcand2",
        kind="player_assertion",
        subject_id=player,
        knowers=[player],
        statement="另一个长 id 候选。",
    )
    # decisions that differ only inside the promoted-id truncation window but
    # outside the adjudication-id window: distinct adjudication ids, one
    # shared generated promoted id
    decision_p = "d" * 85 + "alpha"
    decision_q = "d" * 85 + "beta"
    assert tm._adjudication_id(camp.name, decision_p) != tm._adjudication_id(
        camp.name, decision_q
    )
    assert tm._promoted_id(camp.name, candidate2["assertion_id"], decision_p) == (
        tm._promoted_id(camp.name, candidate2["assertion_id"], decision_q)
    )
    tm.adjudicate_candidate(
        decision_p, candidate2["assertion_id"], "accept", campaign_dir=camp
    )
    with pytest.raises(tm.TemporalMemoryError, match="collides"):
        tm.adjudicate_candidate(
            decision_q, candidate2["assertion_id"], "accept", campaign_dir=camp
        )


def test_prefixed_id_respects_max_len_without_blind_slicing():
    value = "x" * 400 + "-tail"
    ident = tm._prefixed_id("mem-test-adj-", value)
    assert ident.startswith("mem-test-adj-")
    assert len(ident) <= contract._MAX_ID_LEN
    empty = tm._prefixed_id("mem-test-adj-", "???")
    assert empty.startswith("mem-test-adj-x")
    assert len(empty) <= contract._MAX_ID_LEN


def test_subject_identity_is_immutable_append_only(tmp_path):
    camp = _camp(tmp_path)
    tm.ensure_store(camp)
    sid = contract.subject_id_for("npc", camp.name, "corbitt")
    base = {
        "subject_id": sid,
        "kind": "npc",
        "campaign_id": camp.name,
        "display_name": "Walter Corbitt",
        "same_subject_as": [],
    }
    first = tm._write_subject(camp, dict(base))
    assert tm._write_subject(camp, dict(base)) == first
    # identity rewrites fail closed
    with pytest.raises(tm.TemporalMemoryError, match="already exists"):
        tm._write_subject(camp, dict(base, display_name="Someone Else"))
    # campaign scope is immutable (cross-campaign kinds accept a campaign_id
    # at validation, so the rewrite gate must reject the silent re-scope)
    player_base = {
        "subject_id": "subject-player-thomas",
        "kind": "player",
        "campaign_id": None,
        "display_name": "Thomas",
        "same_subject_as": [],
    }
    tm._write_subject(camp, dict(player_base))
    with pytest.raises(tm.TemporalMemoryError, match="already exists"):
        tm._write_subject(camp, dict(player_base, campaign_id=camp.name))
    # equivalence edges may only grow
    extended = dict(base, same_subject_as=["subject-npc-other-camp-corbitt"])
    tm._write_subject(camp, extended)
    assert tm.load_subjects(camp)[sid]["same_subject_as"] == extended["same_subject_as"]
    with pytest.raises(tm.TemporalMemoryError, match="already exists"):
        tm._write_subject(camp, dict(base))  # edge removal is a rewrite


def test_entity_identity_is_immutable_append_only(tmp_path):
    camp = _camp(tmp_path)
    tm.ensure_store(camp)
    base = {
        "entity_id": "entity-person-corbitt",
        "kind": "person",
        "campaign_id": camp.name,
        "display_name": "Walter Corbitt",
        "aliases": ["the landlord"],
        "same_entity_as": [],
        "subject_ref": None,
    }
    first = tm._write_entity(camp, dict(base))
    assert tm._write_entity(camp, dict(base)) == first
    with pytest.raises(tm.TemporalMemoryError, match="already exists"):
        tm._write_entity(camp, dict(base, display_name="Someone Else"))
    with pytest.raises(tm.TemporalMemoryError, match="already exists"):
        tm._write_entity(camp, dict(base, campaign_id="other-camp"))
    # alias append is the sanctioned extension
    grown = dict(base, aliases=["the landlord", "the ghost landlord"])
    tm._write_entity(camp, grown)
    assert tm.load_entities(camp)[first["entity_id"]]["aliases"] == grown["aliases"]
    # alias removal / reorder are rewrites
    with pytest.raises(tm.TemporalMemoryError, match="already exists"):
        tm._write_entity(camp, dict(base))
    with pytest.raises(tm.TemporalMemoryError, match="already exists"):
        tm._write_entity(
            camp, dict(grown, aliases=["the ghost landlord", "the landlord"])
        )
    # equivalence edges may only grow
    edge = dict(grown, same_entity_as=["entity-person-corbitt-alt"])
    tm._write_entity(camp, edge)
    assert (
        tm.load_entities(camp)[first["entity_id"]]["same_entity_as"]
        == edge["same_entity_as"]
    )


def test_default_subject_bootstrap_leaves_customized_subject_untouched(tmp_path):
    camp = _camp(tmp_path)
    tm.ensure_store(camp)
    tm._write_subject(
        camp,
        {
            "subject_id": contract.subject_id_for("world", camp.name, ""),
            "kind": "world",
            "campaign_id": camp.name,
            "display_name": "雾都",
            "same_subject_as": [],
        },
    )
    written = tm.ensure_default_subjects(camp)
    assert written["world"]["display_name"] == "雾都"
    rows = tm._read_jsonl(tm._path(camp, "subjects"))
    world_rows = [
        row
        for row in rows
        if row.get("subject_id") == contract.subject_id_for("world", camp.name, "")
    ]
    assert len(world_rows) == 1


def test_resolve_hook_successor_collision_raises(tmp_path):
    camp = _camp(tmp_path)
    original = _assertion(
        camp, assertion_id="mem-test-hook-base", statement="未解钩子。"
    )
    tm.register_hook("mem-hook-cellar", original["assertion_id"], campaign_dir=camp)
    _assertion(
        camp,
        assertion_id="mem-test-hook-mem-hook-cellar-paid-off",
        statement="无关断言。",
    )
    with pytest.raises(tm.TemporalMemoryError, match="collides"):
        tm.resolve_hook(
            "mem-hook-cellar",
            "paid_off",
            "hook-pay-1",
            campaign_dir=camp,
            resolved_at="turn-9",
        )


# ---------------------------------------------------------------------------
# Machine-facing commit resolution (semantic in, machine sha out)
# ---------------------------------------------------------------------------


def _git_history():
    import coc_git_history

    return coc_git_history


def _repo_with_finalized_turn(tmp_path, campaign_id="gitcamp", turn=2):
    gh = _git_history()
    root = tmp_path / "root"
    camp_dir = gh.worktree_path_for(root, campaign_id)
    camp_dir.mkdir(parents=True)
    gh.commit_baseline(
        root, campaign_id, schema_generation="test-1", note="baseline"
    )
    sha = gh.commit_finalized_turn(
        root,
        campaign_id,
        turn_number=turn,
        finalization_id=f"fin-turn-{turn}",
        journal_decision_id=f"journal-turn-{turn}",
        settlement_snapshot_id=f"snapshot-turn-{turn}",
        rendered_text_sha256="0" * 64,
        schema_generation="test-1",
    )
    return root, sha


def test_record_turn_episode_resolves_commit_and_attaches_it(tmp_path):
    gh = _git_history()
    root, sha = _repo_with_finalized_turn(tmp_path)
    episode = tm.record_turn_episode(
        root,
        "gitcamp",
        "tl-main",
        2,
        ["receipt-final-turn-2"],
        "我检查地窖门。",
        "门闩上有新的划痕。",
    )
    assert episode["episode_id"] == "episode-gitcamp-tl-main-turn-2"
    assert episode["commit"] == sha  # machine-attached, never caller-supplied
    # idempotent semantic replay
    replay = tm.record_turn_episode(
        root,
        "gitcamp",
        "tl-main",
        2,
        ["receipt-final-turn-2"],
        "我检查地窖门。",
        "门闩上有新的划痕。",
    )
    assert replay["episode_id"] == episode["episode_id"]
    assert replay["commit"] == sha
    store = tm.load_episodes(gh.worktree_path_for(root, "gitcamp"))
    assert store[episode["episode_id"]]["commit"] == sha
    # semantic resolution fails closed for an unplayed turn
    with pytest.raises(gh.GitHistoryError):
        tm.record_turn_episode(
            root, "gitcamp", "tl-main", 3, ["receipt-x"], "p", "k"
        )
