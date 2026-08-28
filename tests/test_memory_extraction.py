"""Deterministic tests for the temporal-memory extraction core.

Covers: deterministic/idempotent job packets, closed result validation,
machine provenance reattachment and anti-drift, candidate-only persistence
through the temporal facade, explicit failure backlog + retry/recovery,
rejected candidates remaining candidates until KP adjudication, no keyword
inference over prose, and no hard-state mutation. All fixtures are pure
tmp_path campaigns; no LLM, no live campaign data.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import threading
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"

COMMIT_A = "a" * 40
COMMIT_B = "b" * 40


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


tm = _load("coc_temporal_memory_facade_under_test", SCRIPTS / "coc_temporal_memory.py")
contract = tm.contract
ext = _load("coc_memory_extraction_under_test", SCRIPTS / "coc_memory_extraction.py")

_SHA_RE = re.compile(r"[0-9a-f]{40,64}")


def _camp(tmp_path: Path, name: str = "test") -> Path:
    camp = tmp_path / "campaigns" / name
    camp.mkdir(parents=True)
    return camp


def _episode_row(
    *, campaign_id: str = "test", turn: int = 2, commit: str = COMMIT_A
) -> dict:
    return {
        "episode_id": contract.episode_id_for(campaign_id, "tl-main", turn),
        "campaign_id": campaign_id,
        "timeline_id": "tl-main",
        "commit": commit,
        "turn_number": turn,
        "finalization_receipt": f"receipt-final-turn-{turn}",
        "subjects_present": ["subject-party-test"],
        "entities": ["entity-location-cellar"],
    }


def _commit_record(
    *, campaign_id: str = "test", turn: int = 2, sha: str = COMMIT_A
) -> dict:
    return {
        "sha": sha,
        "campaign_id": campaign_id,
        "timeline_id": "tl-main",
        "turn_number": turn,
        "finalization_id": f"receipt-final-turn-{turn}",
        "commit_type": "turn",
        "parents": [],
        "tree_digest": "d" * 64,
        "files": [],
    }


def _record_episode(
    camp: Path,
    *,
    turn: int = 2,
    commit: str = COMMIT_A,
    with_candidates: bool = False,
) -> dict:
    tm.record_episode(
        commit,
        "tl-main",
        turn,
        [f"receipt-final-turn-{turn}"],
        "我检查地窖门。",
        "门闩上有新的划痕。",
        campaign_dir=camp,
        candidates=[{"kind": "entity", "name": "cellar"}] if with_candidates else None,
    )
    return tm.load_episodes(camp)[contract.episode_id_for(camp.name, "tl-main", turn)]


def _build_job(camp: Path, episode: dict | None = None, turn: int = 2) -> dict:
    episode = episode or _episode_row(turn=turn)
    return ext.build_extraction_job(
        camp,
        _commit_record(turn=turn),
        episode["finalization_receipt"],
        episode,
    )


def _candidate(n: int = 1, *, turn: int = 2, statement: str = "地窖里有敲击声。", **over) -> dict:
    base = {
        "assertion_id": f"mem-test-t{turn}-c{n}",
        "kind": "belief",
        "subject_id": "subject-party-test",
        "knowers": ["subject-party-test"],
        "privacy": "player_safe",
        "state": "accurate",
        "statement": statement,
        "entities": ["entity-location-cellar"],
        "occurred_turn": turn,
        "valid_from_turn": turn,
    }
    base.update(over)
    return base


def _player_candidate(n: int = 1, *, turn: int = 2, **over) -> dict:
    return _candidate(
        n,
        turn=turn,
        kind="player_assertion",
        subject_id="subject-player-table",
        knowers=["subject-player-table"],
        **over,
    )


def _result(job: dict, candidates: list[dict]) -> dict:
    return {"job_id": job["job_id"], "candidates": candidates}


# ---------------------------------------------------------------------------
# build_extraction_job
# ---------------------------------------------------------------------------


def test_build_extraction_job_is_deterministic_and_pure(tmp_path):
    camp = _camp(tmp_path)
    episode = _episode_row()
    first = ext.build_extraction_job(
        camp, _commit_record(), episode["finalization_receipt"], episode
    )
    second = ext.build_extraction_job(
        camp, _commit_record(), episode["finalization_receipt"], episode
    )
    assert contract.canonical_json(first) == contract.canonical_json(second)
    assert first["job_id"] == "extract-test-tl-main-turn-2"
    # One finalized commit -> one job id; a different turn is a different job.
    other_turn = ext.build_extraction_job(
        camp,
        _commit_record(turn=3),
        _episode_row(turn=3)["finalization_receipt"],
        _episode_row(turn=3),
    )
    assert other_turn["job_id"] == "extract-test-tl-main-turn-3"
    # Pure: no store is created by building the packet.
    assert not (camp / "memory").exists()


def test_packet_contains_semantic_refs_only(tmp_path):
    camp = _camp(tmp_path)
    job = _build_job(camp)
    packet_json = json.dumps(job["packet"], ensure_ascii=False)
    assert _SHA_RE.search(packet_json) is None
    assert job["provenance"]["commit"] not in packet_json
    assert job["provenance"]["finalization_receipt"] not in packet_json
    assert job["provenance"]["episode_digest"] not in packet_json
    packet = job["packet"]
    assert packet["episode_id"] == "episode-test-tl-main-turn-2"
    assert packet["campaign_id"] == "test"
    assert packet["timeline_id"] == "tl-main"
    assert packet["turn_number"] == 2
    assert packet["subjects_present"] == ["subject-party-test"]
    assert packet["entities"] == ["entity-location-cellar"]
    rule = packet["result_contract"]
    assert rule["id_prefix"] == "mem-test-t2-c"
    assert "source_commit" in rule["forbidden_fields"]
    assert "summary" not in rule["allowed_kinds"]


def test_build_rejects_binding_mismatch(tmp_path):
    camp = _camp(tmp_path)
    episode = _episode_row()
    with pytest.raises(ext.MemoryExtractionError, match="commit sha"):
        ext.build_extraction_job(camp, {**_commit_record(), "sha": "nope"}, episode["finalization_receipt"], episode)
    with pytest.raises(ext.MemoryExtractionError, match="different commit"):
        ext.build_extraction_job(camp, _commit_record(sha=COMMIT_B), episode["finalization_receipt"], episode)
    with pytest.raises(ext.MemoryExtractionError, match="turn_number"):
        ext.build_extraction_job(camp, {**_commit_record(), "turn_number": 3}, episode["finalization_receipt"], episode)
    with pytest.raises(ext.MemoryExtractionError, match="finalization_receipt"):
        ext.build_extraction_job(camp, _commit_record(), "receipt-other", episode)
    with pytest.raises(ext.MemoryExtractionError, match="turn commits only"):
        ext.build_extraction_job(camp, {**_commit_record(), "commit_type": "baseline"}, episode["finalization_receipt"], episode)
    with pytest.raises(ext.MemoryExtractionError, match="unknown fields"):
        ext.build_extraction_job(camp, {**_commit_record(), "surprise": 1}, episode["finalization_receipt"], episode)


# ---------------------------------------------------------------------------
# validate_extraction_result
# ---------------------------------------------------------------------------


def test_validate_valid_result_attaches_machine_provenance(tmp_path):
    job = _build_job(_camp(tmp_path))
    normalized = ext.validate_extraction_result(
        job,
        _result(job, [_candidate(1), _player_candidate(2)]),
    )
    assert normalized["job_id"] == job["job_id"]
    assert [c["assertion_id"] for c in normalized["candidates"]] == [
        "mem-test-t2-c1",
        "mem-test-t2-c2",
    ]
    for payload in normalized["candidates"]:
        contract.validate_assertion(payload)  # full closed schema holds
        assert payload["source_commit"] == COMMIT_A
        assert payload["source_turn"] == 2
        assert payload["source_receipts"] == ["receipt-final-turn-2"]
        assert payload["scope"] == "campaign"
        assert payload["campaign_id"] == "test"
        assert payload["timeline_id"] == "tl-main"
        # fresh open candidates: no lifecycle edges from extraction
        assert payload["superseded_by"] == []
        assert payload["valid_until_turn"] is None
        assert payload["confirms"] == []


def test_validate_rejects_provenance_and_edge_fields(tmp_path):
    job = _build_job(_camp(tmp_path))
    for field, value in (
        ("source_commit", COMMIT_B),
        ("source_turn", 9),
        ("source_receipts", ["receipt-forged"]),
        ("covers_commits", [COMMIT_B]),
        ("superseded_by", ["mem-test-t1-c1"]),
        ("valid_until_turn", 4),
        ("contradicts", ["mem-test-t1-c1"]),
        ("confirms", ["mem-test-t1-c1"]),
        ("transfer_ref", "transfer-test-tl-a-to-tl-b"),
    ):
        with pytest.raises(ext.MemoryExtractionError, match="unknown fields"):
            ext.validate_extraction_result(
                job, _result(job, [_candidate(1, **{field: value})])
            )
    # Explicit provenance hint in the message
    with pytest.raises(ext.MemoryExtractionError, match="provenance"):
        ext.validate_extraction_result(
            job, _result(job, [_candidate(1, source_commit=COMMIT_B)])
        )


def test_validate_rejects_envelope_errors(tmp_path):
    job = _build_job(_camp(tmp_path))
    with pytest.raises(ext.MemoryExtractionError, match="does not match the job"):
        ext.validate_extraction_result(
            job, {"job_id": "extract-test-tl-main-turn-9", "candidates": []}
        )
    with pytest.raises(ext.MemoryExtractionError, match="unknown fields"):
        ext.validate_extraction_result(
            job, {"job_id": job["job_id"], "candidates": [], "extra": 1}
        )
    with pytest.raises(ext.MemoryExtractionError, match="missing required fields"):
        ext.validate_extraction_result(job, {"job_id": job["job_id"]})
    with pytest.raises(ext.MemoryExtractionError, match="must be a list"):
        ext.validate_extraction_result(
            job, {"job_id": job["job_id"], "candidates": "none"}
        )
    too_many = [_candidate(n) for n in range(1, ext.MAX_CANDIDATES + 2)]
    with pytest.raises(ext.MemoryExtractionError, match="max is"):
        ext.validate_extraction_result(job, _result(job, too_many))


def test_validate_rejects_candidate_schema_errors(tmp_path):
    job = _build_job(_camp(tmp_path))
    cases = [
        _candidate(1, kind="summary"),  # not extractable
        _candidate(1, kind="keeper_correction"),  # subject must be keeper
        _candidate(1, kind="relationship", entities=[]),  # needs exactly one target
        _candidate(1, assertion_id="mem-test-t9-c1"),  # wrong turn
        _candidate(1, assertion_id="mem-other-t2-c1"),  # wrong campaign
        _candidate(1, assertion_id="mem-test-t2-c01"),  # ordinal grammar
        [_candidate(1), _candidate(1)],  # duplicate id
        _candidate(1, knowers=[]),  # owner missing from knowers
        _player_candidate(1, privacy="keeper_only"),  # player_assertion must be player_safe
        _candidate(1, state="contradictory"),  # needs contradicts (edges forbidden)
        _candidate(1, occurred_turn=5, valid_from_turn=2),  # occurred after valid_from
        _candidate(1, statement="   "),  # empty statement
        _candidate(1, timeline_id="tl-fork-dark"),  # off-job binding
        _candidate(1, scope="cross_campaign"),  # off-job scope
        _candidate(1, valid_from_turn=-1),  # negative turn
    ]
    for case in cases:
        candidates = case if isinstance(case, list) else [case]
        with pytest.raises(ext.MemoryExtractionError):
            ext.validate_extraction_result(job, _result(job, candidates))


# ---------------------------------------------------------------------------
# apply_extraction_result
# ---------------------------------------------------------------------------


def _artifact_of(camp: Path, job: dict) -> dict | None:
    return ext.load_completed_job(camp, job["job_id"])


def _jobs_dir(camp: Path) -> Path:
    return camp / "memory" / "temporal" / "extraction-jobs"


def test_apply_persists_candidates_idempotently(tmp_path):
    camp = _camp(tmp_path)
    episode = _record_episode(camp, with_candidates=True)
    job = _build_job(camp, episode)

    first = ext.apply_extraction_result(
        camp, job, _result(job, [_candidate(1), _candidate(2, statement="管家在说谎。")])
    )
    assert first["status"] == "applied"
    assert first["applied"] == 2
    assert first["assertion_ids"] == ["mem-test-t2-c1", "mem-test-t2-c2"]
    assert first["backlog_status"] == "none"  # no backlog row existed
    # One immutable artifact holds the whole batch, provenance-attached...
    artifact = _artifact_of(camp, job)
    assert artifact is not None
    assert artifact["candidate_count"] == 2
    assert set(artifact) == set(ext.ARTIFACT_FIELDS)
    assert [c["assertion_id"] for c in artifact["candidates"]] == [
        "mem-test-t2-c1",
        "mem-test-t2-c2",
    ]
    assert artifact["candidates"][0]["source_commit"] == COMMIT_A
    assert artifact["candidates"][0]["source_receipts"] == ["receipt-final-turn-2"]
    assert artifact["provenance"]["commit"] == COMMIT_A
    assert first["artifact_digest"] == artifact["artifact_digest"]
    # ...and nothing was published into the shared assertion store.
    assert tm.load_assertions(camp) == {}
    assert list(_jobs_dir(camp).glob("*.json")) == [
        _jobs_dir(camp) / "extract-test-tl-main-turn-2.json"
    ]

    second = ext.apply_extraction_result(
        camp, job, _result(job, [_candidate(1), _candidate(2, statement="管家在说谎。")])
    )
    assert second["status"] == "applied"  # exact replay is idempotent
    assert second["artifact_digest"] == first["artifact_digest"]
    assert len(list(_jobs_dir(camp).glob("*.json"))) == 1  # no second artifact
    assert tm.load_assertions(camp) == {}
    events = ext.load_extraction_events(camp)
    assert [row["outcome"] for row in events] == ["created", "replayed"]


def test_apply_invalid_result_records_pending_backlog_never_raises(tmp_path):
    camp = _camp(tmp_path)
    episode = _record_episode(camp)  # no candidates -> facade review_required row
    job = _build_job(camp, episode)

    receipt = ext.apply_extraction_result(camp, job, {"job_id": "wrong", "candidates": []})
    assert receipt["status"] == "backlog_pending"
    assert receipt["error_kind"] == "invalid_result"
    assert receipt["backlog_status"] == "pending"
    assert tm.load_assertions(camp) == {}
    assert _artifact_of(camp, job) is None  # no completed job is visible

    backlog = tm._load_latest(tm._path(camp, "backlog"), "backlog_id")
    row = backlog["backlog-test-t2-extract"]
    assert row["reason"] == "extraction_error"
    assert row["status"] == "pending"
    assert row["commit"] == COMMIT_A
    events = ext.load_extraction_events(camp)
    assert events[-1]["event"] == "failed"
    assert events[-1]["error_kind"] == "invalid_result"


def test_retry_after_failure_recovers_backlog(tmp_path):
    camp = _camp(tmp_path)
    episode = _record_episode(camp)
    job = _build_job(camp, episode)

    failed = ext.apply_extraction_result(camp, job, _result(job, [_candidate(1, kind="nope")]))
    assert failed["status"] == "backlog_pending"
    assert _artifact_of(camp, job) is None

    # Retry: deterministic job rebuild yields the same job id.
    job_again = _build_job(camp, episode)
    assert job_again["job_id"] == job["job_id"]
    recovered = ext.apply_extraction_result(camp, job_again, _result(job, [_candidate(1)]))
    assert recovered["status"] == "applied"
    assert recovered["backlog_status"] == "recovered"
    artifact = _artifact_of(camp, job)
    assert artifact["candidates"][0]["statement"] == "地窖里有敲击声。"
    backlog = tm._load_latest(tm._path(camp, "backlog"), "backlog_id")
    assert backlog["backlog-test-t2-extract"]["status"] == "recovered"


def test_apply_detects_provenance_drift(tmp_path):
    camp = _camp(tmp_path)
    episode = _record_episode(camp)
    job = _build_job(camp, episode)

    drifted = json.loads(contract.canonical_json(job))
    drifted["provenance"]["commit"] = COMMIT_B
    receipt = ext.apply_extraction_result(camp, drifted, _result(drifted, [_candidate(1)]))
    assert receipt["status"] == "backlog_pending"
    assert receipt["error_kind"] == "provenance_drift"
    assert tm.load_assertions(camp) == {}
    assert _artifact_of(camp, job) is None

    digest_drift = json.loads(contract.canonical_json(job))
    digest_drift["provenance"]["episode_digest"] = "0" * 64
    receipt = ext.apply_extraction_result(camp, digest_drift, _result(digest_drift, []))
    assert receipt["error_kind"] == "provenance_drift"

    # Episode never recorded: drift, not a crash.
    empty_camp = _camp(tmp_path, "empty")
    receipt = ext.apply_extraction_result(empty_camp, job, _result(job, [_candidate(1)]))
    assert receipt["status"] == "backlog_pending"
    assert receipt["error_kind"] == "provenance_drift"
    assert _artifact_of(empty_camp, job) is None


def test_divergent_replay_fails_closed_artifact_untouched(tmp_path):
    """A completed artifact is immutable: replaying the same job with
    different content fails closed and never rewrites the stored batch."""
    camp = _camp(tmp_path)
    episode = _record_episode(camp, with_candidates=True)
    job = _build_job(camp, episode)

    first = ext.apply_extraction_result(camp, job, _result(job, [_candidate(1)]))
    assert first["status"] == "applied"
    original_digest = first["artifact_digest"]

    divergent = ext.apply_extraction_result(
        camp, job, _result(job, [_candidate(1, statement="篡改后的内容。")])
    )
    assert divergent["status"] == "backlog_pending"
    assert divergent["error_kind"] == "provenance_drift"
    assert divergent["applied"] == 0
    # The stored artifact is byte-identical to the first completion.
    artifact = _artifact_of(camp, job)
    assert artifact["artifact_digest"] == original_digest
    assert artifact["candidates"][0]["statement"] == "地窖里有敲击声。"
    assert len(list(_jobs_dir(camp).glob("*.json"))) == 1


def test_corrupt_completed_artifact_fails_closed(tmp_path):
    camp = _camp(tmp_path)
    episode = _record_episode(camp, with_candidates=True)
    job = _build_job(camp, episode)
    assert ext.apply_extraction_result(camp, job, _result(job, [_candidate(1)]))["status"] == "applied"

    # Corrupt the stored artifact (external damage).
    (_jobs_dir(camp) / "extract-test-tl-main-turn-2.json").write_text(
        "{not json", encoding="utf-8"
    )
    receipt = ext.apply_extraction_result(camp, job, _result(job, [_candidate(1)]))
    assert receipt["status"] == "backlog_pending"
    assert receipt["error_kind"] == "provenance_drift"
    assert "cannot be verified" in receipt["detail"]


def test_zero_candidate_success_recovers_review_backlog(tmp_path):
    """A valid empty result is a legitimate semantic outcome ("nothing
    memorable") and must produce a completed job record and recover the
    episode's pending review backlog."""
    camp = _camp(tmp_path)
    episode = _record_episode(camp)  # facade wrote review_required pending
    job = _build_job(camp, episode)

    receipt = ext.apply_extraction_result(camp, job, _result(job, []))
    assert receipt["status"] == "applied"
    assert receipt["applied"] == 0
    assert receipt["assertion_ids"] == []
    # A zero-candidate success still completes the job visibly.
    artifact = _artifact_of(camp, job)
    assert artifact is not None
    assert artifact["candidate_count"] == 0
    assert artifact["candidates"] == []
    assert tm.load_assertions(camp) == {}
    backlog = tm._load_latest(tm._path(camp, "backlog"), "backlog_id")
    row = backlog["backlog-test-t2-extract"]
    assert row["reason"] == "review_required"  # reason preserved
    assert row["status"] == "recovered"  # ...but the slot is no longer pending
    assert receipt["backlog_status"] == "recovered"


def test_zero_candidate_retry_after_failure_recovers_backlog(tmp_path):
    """Recovery on success is not gated on candidate count: a failed job
    retried with a valid zero-candidate result still recovers the backlog."""
    camp = _camp(tmp_path)
    episode = _record_episode(camp)
    job = _build_job(camp, episode)

    failed = ext.apply_extraction_result(
        camp, job, _result(job, [_candidate(1, kind="summary")])
    )
    assert failed["status"] == "backlog_pending"

    receipt = ext.apply_extraction_result(camp, job, _result(job, []))
    assert receipt["status"] == "applied"
    assert receipt["applied"] == 0
    assert receipt["backlog_status"] == "recovered"
    backlog = tm._load_latest(tm._path(camp, "backlog"), "backlog_id")
    assert backlog["backlog-test-t2-extract"]["status"] == "recovered"


# ---------------------------------------------------------------------------
# Atomicity / concurrency / visibility (adversarial)
# ---------------------------------------------------------------------------


def test_apply_never_publishes_into_shared_stores(tmp_path):
    """Extraction publishes only the per-job artifact: the shared
    append-only stores gain nothing, so no partial batch can ever exist."""
    camp = _camp(tmp_path)
    episode = _record_episode(camp, with_candidates=True)
    job = _build_job(camp, episode)

    def store_bytes() -> dict[str, bytes]:
        return {
            key: (camp / "memory" / "temporal" / f"{key}.jsonl").read_bytes()
            for key in ("assertions", "entities", "subjects")
            if (camp / "memory" / "temporal" / f"{key}.jsonl").exists()
        }

    before = store_bytes()
    receipt = ext.apply_extraction_result(
        camp, job, _result(job, [_candidate(1), _candidate(2)])
    )
    assert receipt["status"] == "applied"
    assert store_bytes() == before  # byte-identical shared stores
    assert _artifact_of(camp, job)["candidate_count"] == 2


def test_invalid_candidate_writes_nothing(tmp_path):
    """An invalid candidate anywhere in the batch fails the whole result
    before persistence: no completed job, no store writes."""
    camp = _camp(tmp_path)
    episode = _record_episode(camp, with_candidates=True)
    job = _build_job(camp, episode)

    receipt = ext.apply_extraction_result(
        camp, job, _result(job, [_candidate(1), _candidate(2, kind="summary")])
    )
    assert receipt["status"] == "backlog_pending"
    assert receipt["error_kind"] == "invalid_result"
    assert tm.load_assertions(camp) == {}
    assert _artifact_of(camp, job) is None


def test_concurrent_writer_bytes_survive_failed_write(tmp_path, monkeypatch):
    """Another writer appending to the shared temporal JSONL during a
    failed extraction keeps every byte: extraction never opens those files
    for write, so there is nothing to truncate."""
    camp = _camp(tmp_path)
    episode = _record_episode(camp, with_candidates=True)
    job = _build_job(camp, episode)
    # Pre-existing evidence in the shared store.
    tm.record_assertion(
        {**_candidate(9), "statement": "先前存在的证据。", "source_receipts": ["receipt-prior"]},
        campaign_dir=camp,
    )
    assertions_path = camp / "memory" / "temporal" / "assertions.jsonl"
    baseline = assertions_path.read_bytes()

    def concurrent_writer_then_fail(tmp: Path, text: str) -> None:
        # Simulated interleaving: another process appends one evidence row
        # while our extraction is between validation and its failed write.
        tm.record_assertion(
            {
                **_candidate(8),
                "statement": "并发写入的证据。",
                "source_receipts": ["receipt-concurrent"],
            },
            campaign_dir=camp,
        )
        raise OSError("disk full")

    real_write_temp = ext._write_temp_artifact
    monkeypatch.setattr(ext, "_write_temp_artifact", concurrent_writer_then_fail)
    receipt = ext.apply_extraction_result(
        camp, job, _result(job, [_candidate(1), _candidate(2)])
    )
    assert receipt["status"] == "backlog_pending"
    assert receipt["error_kind"] == "persistence_error"
    assert receipt["applied"] == 0
    assert "no completed job is visible" in receipt["detail"]

    # No visible completed job, no temp leftovers ...
    assert _artifact_of(camp, job) is None
    assert list(_jobs_dir(camp).glob("*")) == []
    # ... and every byte of pre-existing AND concurrent evidence survived.
    final = assertions_path.read_bytes()
    assert final.startswith(baseline)
    stored = tm.load_assertions(camp)
    assert stored["mem-test-t2-c9"]["statement"] == "先前存在的证据。"
    assert stored["mem-test-t2-c8"]["statement"] == "并发写入的证据。"
    backlog = tm._load_latest(tm._path(camp, "backlog"), "backlog_id")
    assert backlog["backlog-test-t2-extract"]["status"] == "pending"

    # Recovery: a later retry completes the job; the concurrent rows remain.
    monkeypatch.setattr(ext, "_write_temp_artifact", real_write_temp)
    ok = ext.apply_extraction_result(camp, job, _result(job, [_candidate(1)]))
    assert ok["status"] == "applied"
    assert set(tm.load_assertions(camp)) == {"mem-test-t2-c9", "mem-test-t2-c8"}


def test_link_failure_leaves_all_evidence_untouched(tmp_path, monkeypatch):
    """A temp-write/rename (hard-link) failure leaves pre-existing and
    concurrent evidence untouched and records a pending backlog."""
    camp = _camp(tmp_path)
    episode = _record_episode(camp, with_candidates=True)
    job = _build_job(camp, episode)
    tm.record_assertion(
        {**_candidate(7), "statement": "先前存在的证据。", "source_receipts": ["receipt-prior"]},
        campaign_dir=camp,
    )
    assertions_path = camp / "memory" / "temporal" / "assertions.jsonl"
    entities_path = camp / "memory" / "temporal" / "entities.jsonl"
    baseline_assertions = assertions_path.read_bytes()
    baseline_entities = entities_path.read_bytes()

    def boom(*args, **kwargs):
        raise OSError("link failed")

    monkeypatch.setattr(ext.os, "link", boom)
    receipt = ext.apply_extraction_result(camp, job, _result(job, [_candidate(1)]))
    assert receipt["status"] == "backlog_pending"
    assert receipt["error_kind"] == "persistence_error"
    assert assertions_path.read_bytes() == baseline_assertions
    assert entities_path.read_bytes() == baseline_entities
    assert _artifact_of(camp, job) is None
    assert list(_jobs_dir(camp).glob("*")) == []  # temp file cleaned up
    backlog = tm._load_latest(tm._path(camp, "backlog"), "backlog_id")
    assert backlog["backlog-test-t2-extract"]["status"] == "pending"


def test_completed_job_visibility(tmp_path):
    """A completed job is exactly one whole artifact file: absent before
    apply, present and closed-schema after, with the semantic job-id path."""
    camp = _camp(tmp_path)
    episode = _record_episode(camp, with_candidates=True)
    job = _build_job(camp, episode)
    assert ext.load_completed_job(camp, job["job_id"]) is None

    receipt = ext.apply_extraction_result(camp, job, _result(job, [_candidate(1)]))
    assert receipt["status"] == "applied"
    artifact = ext.load_completed_job(camp, job["job_id"])
    assert artifact["job_id"] == "extract-test-tl-main-turn-2"
    assert artifact["schema_generation"] == contract.SCHEMA_GENERATION
    assert artifact["episode_id"] == "episode-test-tl-main-turn-2"
    assert set(artifact) == set(ext.ARTIFACT_FIELDS)
    # Path traversal is refused at the artifact gate.
    with pytest.raises(ext.MemoryExtractionError, match="artifact path"):
        ext.load_completed_job(camp, "extract-../../escape")


# ---------------------------------------------------------------------------
# Artifact integrity verification (digest recomputation on every load)
# ---------------------------------------------------------------------------


def _artifact_path_of(camp: Path, job: dict) -> Path:
    return _jobs_dir(camp) / f"{job['job_id']}.json"


@pytest.mark.parametrize(
    "tamper",
    [
        # (label, mutation of the parsed artifact)
        ("candidate_statement", lambda a: a["candidates"][0].__setitem__("statement", "篡改后的陈述。")),
        ("candidate_added", lambda a: a["candidates"].append(dict(a["candidates"][0]))),
        ("candidate_removed", lambda a: a["candidates"].clear()),
        ("candidate_count", lambda a: a.__setitem__("candidate_count", 99)),
        ("provenance_commit", lambda a: a["provenance"].__setitem__("commit", COMMIT_B)),
        ("turn_number", lambda a: a.__setitem__("turn_number", 7)),
        ("timeline_id", lambda a: a.__setitem__("timeline_id", "tl-fork-dark")),
        ("episode_id", lambda a: a.__setitem__("episode_id", "episode-test-tl-main-turn-9")),
        ("stale_digest", lambda a: a.__setitem__("artifact_digest", "f" * 64)),
        ("foreign_job_id", lambda a: a.__setitem__("job_id", "extract-test-tl-main-turn-9")),
        ("unknown_field", lambda a: a.__setitem__("surprise", 1)),
    ],
)
def test_tampered_artifact_fails_closed_and_stays_untouched(tmp_path, tamper):
    """Valid JSON with tampered content (stale digest) never passes load or
    replay verification; the damaged bytes themselves remain untouched."""
    label, mutate = tamper
    camp = _camp(tmp_path)
    episode = _record_episode(camp, with_candidates=True)
    job = _build_job(camp, episode)
    assert ext.apply_extraction_result(camp, job, _result(job, [_candidate(1)]))["status"] == "applied"

    path = _artifact_path_of(camp, job)
    tampered_bytes = path.read_bytes()
    parsed = json.loads(tampered_bytes)
    mutate(parsed)
    # Rewrite as valid JSON, keeping whatever (possibly stale) digest the
    # mutation left in place.
    path.write_text(
        json.dumps(parsed, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )

    # Direct load fails closed...
    with pytest.raises(ext.MemoryExtractionError):
        ext.load_completed_job(camp, job["job_id"])
    # ... and replay does too, without rewriting the damaged bytes.
    receipt = ext.apply_extraction_result(camp, job, _result(job, [_candidate(1)]))
    assert receipt["status"] == "backlog_pending"
    assert receipt["error_kind"] == "provenance_drift"
    assert path.read_bytes() != tampered_bytes or label == "stale_digest"
    # No backlog was pending before; the failed replay records one.
    backlog = tm._load_latest(tm._path(camp, "backlog"), "backlog_id")
    assert backlog["backlog-test-t2-extract"]["status"] == "pending"


def test_tampered_digest_fails_closed(tmp_path):
    """A digest that does not match its own content is rejected even when
    every other field is untouched."""
    camp = _camp(tmp_path)
    episode = _record_episode(camp, with_candidates=True)
    job = _build_job(camp, episode)
    ext.apply_extraction_result(camp, job, _result(job, [_candidate(1)]))

    path = _artifact_path_of(camp, job)
    parsed = json.loads(path.read_text())
    parsed["artifact_digest"] = contract.record_digest({"x": 1})
    path.write_text(json.dumps(parsed, sort_keys=True, separators=(",", ":")), encoding="utf-8")
    with pytest.raises(ext.MemoryExtractionError, match="integrity verification"):
        ext.load_completed_job(camp, job["job_id"])


def test_exact_replay_after_verified_load(tmp_path):
    """A verified load followed by an exact replay is idempotent."""
    camp = _camp(tmp_path)
    episode = _record_episode(camp, with_candidates=True)
    job = _build_job(camp, episode)
    first = ext.apply_extraction_result(camp, job, _result(job, [_candidate(1)]))

    verified = ext.load_completed_job(camp, job["job_id"])  # digest-verified
    assert verified["artifact_digest"] == first["artifact_digest"]
    assert ext.artifact_content_digest(verified) == verified["artifact_digest"]

    second = ext.apply_extraction_result(camp, job, _result(job, [_candidate(1)]))
    assert second["status"] == "applied"
    assert second["artifact_digest"] == first["artifact_digest"]
    assert len(list(_jobs_dir(camp).glob("*.json"))) == 1


# ---------------------------------------------------------------------------
# Same-process concurrency / temp ownership
# ---------------------------------------------------------------------------


def _no_temp_leftovers(camp: Path) -> bool:
    return not [p for p in _jobs_dir(camp).rglob("*.tmp")]


def test_same_process_concurrent_writers_same_job(tmp_path, monkeypatch):
    """Two same-process calls for the SAME job interleaved at the temp
    write: separate exclusive temps, atomic publication, one wins creation
    and the other verifies as an exact replay — no shared temp truncation,
    exactly one artifact, no temp leftovers."""
    camp = _camp(tmp_path)
    episode = _record_episode(camp, with_candidates=True)
    job = _build_job(camp, episode)

    real = ext._write_temp_artifact
    barrier = threading.Barrier(2)
    temps: list[Path] = []

    def synced(tmp: Path, text: str) -> None:
        temps.append(Path(tmp))
        barrier.wait(timeout=5)  # both writers hold their temps simultaneously
        real(tmp, text)

    monkeypatch.setattr(ext, "_write_temp_artifact", synced)
    results: list[dict] = []

    def run() -> None:
        results.append(
            ext.apply_extraction_result(camp, job, _result(job, [_candidate(1)]))
        )

    threads = [threading.Thread(target=run) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert len(temps) == 2 and temps[0] != temps[1]  # unique concurrent temps
    assert all(row["status"] == "applied" for row in results)
    assert sorted(
        ext.load_extraction_events(camp)[i]["outcome"] for i in (-1, -2)
    ) == ["created", "replayed"]
    assert len(list(_jobs_dir(camp).glob("*.json"))) == 1
    assert tm.load_assertions(camp) == {}
    assert _no_temp_leftovers(camp)


def test_same_process_concurrent_writers_different_jobs(tmp_path, monkeypatch):
    """Two same-process calls for DIFFERENT jobs interleaved at the temp
    write: both publish their own artifact; neither temp interferes."""
    camp = _camp(tmp_path)
    ep2 = _record_episode(camp, turn=2, with_candidates=True)
    ep3 = _record_episode(camp, turn=3, with_candidates=True)
    job2 = _build_job(camp, ep2, turn=2)
    job3 = _build_job(camp, ep3, turn=3)

    real = ext._write_temp_artifact
    barrier = threading.Barrier(2)

    def synced(tmp: Path, text: str) -> None:
        barrier.wait(timeout=5)
        real(tmp, text)

    monkeypatch.setattr(ext, "_write_temp_artifact", synced)
    outcomes: list[tuple[str, str]] = []

    def run(job: dict) -> None:
        receipt = ext.apply_extraction_result(camp, job, _result(job, [_candidate(1, turn=job["packet"]["turn_number"])]))
        outcomes.append((job["job_id"], receipt["status"]))

    threads = [
        threading.Thread(target=run, args=(job2,)),
        threading.Thread(target=run, args=(job3,)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert sorted(outcomes) == [
        ("extract-test-tl-main-turn-2", "applied"),
        ("extract-test-tl-main-turn-3", "applied"),
    ]
    assert ext.load_completed_job(camp, job2["job_id"])["candidate_count"] == 1
    assert ext.load_completed_job(camp, job3["job_id"])["candidate_count"] == 1
    assert len(list(_jobs_dir(camp).glob("*.json"))) == 2
    assert _no_temp_leftovers(camp)


def test_failed_writer_cannot_remove_other_temp_or_artifact(tmp_path, monkeypatch):
    """A failing writer cleans only its own temp: a foreign temp file and a
    completed artifact for another job survive its failure byte-for-byte."""
    camp = _camp(tmp_path)
    ep2 = _record_episode(camp, turn=2, with_candidates=True)
    ep3 = _record_episode(camp, turn=3, with_candidates=True)
    job2 = _build_job(camp, ep2, turn=2)
    job3 = _build_job(camp, ep3, turn=3)

    # Job 2 completes first and becomes pre-existing completed evidence.
    ok = ext.apply_extraction_result(camp, job2, _result(job2, [_candidate(1, turn=2)]))
    assert ok["status"] == "applied"
    artifact2_bytes = (_jobs_dir(camp) / f"{job2['job_id']}.json").read_bytes()

    # A foreign writer's temp sits in the same directory.
    foreign_temp = _jobs_dir(camp) / ".extract-foreign.tmp"
    foreign_bytes = b"another writer's in-flight temp"
    foreign_temp.write_bytes(foreign_bytes)

    real = ext._write_temp_artifact

    def fail_job3(tmp: Path, text: str) -> None:
        if job3["job_id"] in text:
            raise OSError("disk full")
        real(tmp, text)

    monkeypatch.setattr(ext, "_write_temp_artifact", fail_job3)
    receipt = ext.apply_extraction_result(
        camp, job3, _result(job3, [_candidate(1, turn=3)])
    )
    assert receipt["status"] == "backlog_pending"
    assert receipt["error_kind"] == "persistence_error"
    assert ext.load_completed_job(camp, job3["job_id"]) is None

    # The foreign temp and the other job's completed artifact are intact.
    assert foreign_temp.read_bytes() == foreign_bytes
    assert (_jobs_dir(camp) / f"{job2['job_id']}.json").read_bytes() == artifact2_bytes
    # The failed call's own temp was cleaned: only the foreign temp remains.
    leftovers = [p for p in _jobs_dir(camp).iterdir() if p.name.endswith(".tmp")]
    assert leftovers == [foreign_temp]

    # Recovery after the failure completes job 3 without touching the rest.
    monkeypatch.setattr(ext, "_write_temp_artifact", real)
    retry = ext.apply_extraction_result(
        camp, job3, _result(job3, [_candidate(1, turn=3)])
    )
    assert retry["status"] == "applied"
    assert foreign_temp.read_bytes() == foreign_bytes
    assert (_jobs_dir(camp) / f"{job2['job_id']}.json").read_bytes() == artifact2_bytes


def test_rejected_candidate_remains_candidate_until_kp_adjudication(tmp_path):
    """Extraction stores the candidate in the artifact and never promotes
    it; once the (later, integration-owned) bridge materializes the artifact
    candidate into the shared store, a KP reject leaves it a candidate —
    never deleted, never promoted."""
    camp = _camp(tmp_path)
    episode = _record_episode(camp, with_candidates=True)
    job = _build_job(camp, episode)
    receipt = ext.apply_extraction_result(
        camp, job, _result(job, [_player_candidate(1, statement="管家是凶手。")])
    )
    assert receipt["status"] == "applied"
    candidate_id = "mem-test-t2-c1"

    # Extraction itself promoted nothing: no shared assertions exist yet.
    assert tm.load_assertions(camp) == {}
    artifact = _artifact_of(camp, job)
    assert artifact["candidates"][0]["kind"] == "player_assertion"

    # Documented adjudication bridge: materialize the artifact candidate
    # through the facade, then KP rejects the guess.
    tm.record_assertion(artifact["candidates"][0], campaign_dir=camp)
    decision = tm.adjudicate_candidate(
        "decision-t2-reject-guess", candidate_id, "reject", campaign_dir=camp
    )
    assert decision["action"] == "reject"
    assert decision["promoted_assertion_id"] is None

    stored = tm.load_assertions(camp)
    assert candidate_id in stored  # never deleted
    assert stored[candidate_id]["kind"] == "player_assertion"
    assert stored[candidate_id]["statement"] == "管家是凶手。"
    assert stored[candidate_id]["valid_until_turn"] is None  # still open
    # Extraction never promoted anything on its own.
    assert all(not aid.startswith("mem-test-promoted-") for aid in stored)


# ---------------------------------------------------------------------------
# No prose semantics, no hard-state mutation
# ---------------------------------------------------------------------------


def test_no_keyword_inference_over_statement_text(tmp_path):
    camp = _camp(tmp_path)
    episode = _record_episode(camp, with_candidates=True)
    job = _build_job(camp, episode)
    spoiler = _candidate(
        1,
        kind="belief",
        privacy="keeper_only",
        statement="KP秘密：地毯下藏着骰子检定与san值损失的真相。",
    )
    neutral = _candidate(2, statement="房间里很冷。")

    normalized = ext.validate_extraction_result(job, _result(job, [spoiler, neutral]))
    by_id = {c["assertion_id"]: c for c in normalized["candidates"]}
    # Statements pass through verbatim; declared kind/privacy are respected
    # regardless of trigger words (死了/秘密/骰子/san...).
    assert by_id["mem-test-t2-c1"]["statement"] == spoiler["statement"]
    assert by_id["mem-test-t2-c1"]["kind"] == "belief"
    assert by_id["mem-test-t2-c1"]["privacy"] == "keeper_only"
    assert by_id["mem-test-t2-c2"]["statement"] == "房间里很冷。"

    receipt = ext.apply_extraction_result(camp, job, _result(job, [spoiler, neutral]))
    assert receipt["status"] == "applied"
    artifact = _artifact_of(camp, job)
    by_id = {c["assertion_id"]: c for c in artifact["candidates"]}
    assert by_id["mem-test-t2-c1"]["statement"] == spoiler["statement"]
    assert by_id["mem-test-t2-c1"]["kind"] == "belief"
    assert by_id["mem-test-t2-c1"]["privacy"] == "keeper_only"


def test_apply_never_touches_hard_state(tmp_path):
    camp = _camp(tmp_path)
    (camp / "campaign.json").write_text('{"campaign_id": "test"}\n', encoding="utf-8")
    save = camp / "save"
    save.mkdir()
    (save / "state.json").write_text('{"hp": 12, "san": 50}\n', encoding="utf-8")
    episode = _record_episode(camp, with_candidates=True)
    job = _build_job(camp, episode)

    def snapshot() -> dict:
        return {
            str(p.relative_to(camp)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(camp.rglob("*"))
            if p.is_file() and "memory" not in p.parts
        }

    before = snapshot()
    memory_before = {
        str(p.relative_to(camp))
        for p in camp.rglob("*")
        if p.is_file() and str(p.relative_to(camp)).startswith("memory")
    }
    receipt = ext.apply_extraction_result(camp, job, _result(job, [_candidate(1)]))
    assert receipt["status"] == "applied"
    assert snapshot() == before
    assert (save / "state.json").read_text(encoding="utf-8") == '{"hp": 12, "san": 50}\n'
    # Everything created by apply lives under memory/temporal only. The
    # episode setup may already have produced the rebuildable canonical-event
    # projection at memory/events-projection.db.
    memory_after = {
        str(p.relative_to(camp))
        for p in camp.rglob("*")
        if p.is_file() and str(p.relative_to(camp)).startswith("memory")
    }
    new = memory_after - memory_before
    assert new
    assert all(path.startswith("memory/temporal/") for path in new)


# ---------------------------------------------------------------------------
# record_extraction_failure
# ---------------------------------------------------------------------------


def test_record_extraction_failure_closed_and_bounded(tmp_path):
    camp = _camp(tmp_path)
    episode = _record_episode(camp)
    job = _build_job(camp, episode)

    with pytest.raises(ext.MemoryExtractionError, match="closed enum"):
        ext.record_extraction_failure(camp, job, "mystery_kind", "boom")

    row = ext.record_extraction_failure(
        camp, job, "producer_timeout", "x" * 600
    )
    assert set(row) == set(contract.BACKLOG_FIELDS)
    assert row["backlog_id"] == "backlog-test-t2-extract"
    assert row["reason"] == "extraction_error"
    assert row["status"] == "pending"
    assert row["commit"] == COMMIT_A
    events = ext.load_extraction_events(camp)
    assert events[-1]["error_kind"] == "producer_timeout"
    assert len(events[-1]["detail"]) == ext.MAX_DETAIL_CHARS

    # Idempotent identical failure: no duplicate backlog line payload.
    again = ext.record_extraction_failure(camp, job, "producer_timeout", "x" * 600)
    assert again == row
