"""A27: durable, bounded runtime session lifecycle."""
from __future__ import annotations

import importlib.util
import json
import math
import threading
from pathlib import Path

import pytest


def _load_session():
    path = Path(__file__).resolve().parents[1] / "runtime" / "engine" / "session.py"
    spec = importlib.util.spec_from_file_location("runtime_session_lifecycle", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FakeClock:
    def __init__(self, now: float = 100.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def _record(tmp_path: Path, *, campaign_id: str = "case", investigator_id: str = "ada") -> dict:
    return {
        "workspace": tmp_path,
        "campaign_id": campaign_id,
        "investigator_id": investigator_id,
        "character_relpath": f".coc/investigators/{investigator_id}/character.json",
        "resolved_config": {"schema_version": 1, "brain": "debug"},
        "brain_at_create": "debug",
    }


def _valid_player_intent() -> dict:
    return {
        "primary_intent": "investigate",
        "secondary_intents": [],
        "target_entities": ["scene"],
        "risk_posture": "cautious",
        "explicit_roll_request": False,
        "player_hypothesis": None,
        "action_atoms": [{"topic": "room", "verb": "search"}],
        "npc_interactions": [],
    }


def test_player_intent_validator_accepts_exact_public_shape_without_aliasing():
    session = _load_session()
    intent = _valid_player_intent()

    normalized = session._validate_player_intent(intent)

    assert normalized == intent
    assert normalized is not intent
    assert normalized["action_atoms"] is not intent["action_atoms"]


@pytest.mark.parametrize(
    ("field", "bad_value"),
    [
        ("primary_intent", "interpret-prose-locally"),
        ("primary_intent", 1),
        ("secondary_intents", ["follow_up", 1]),
        ("target_entities", "scene"),
        ("risk_posture", "desperate"),
        ("explicit_roll_request", 1),
        ("player_hypothesis", {"guess": "hidden door"}),
        ("action_atoms", [{"path": ("room", "desk")}]),
        ("npc_interactions", [{"difficulty": math.nan}]),
    ],
)
def test_player_intent_validator_rejects_malformed_public_fields(field, bad_value):
    session = _load_session()
    intent = _valid_player_intent()
    intent[field] = bad_value

    with pytest.raises((TypeError, ValueError)):
        session._validate_player_intent(intent)


def test_player_intent_validator_requires_exact_public_fields():
    session = _load_session()
    missing = _valid_player_intent()
    missing.pop("npc_interactions")
    extra = {**_valid_player_intent(), "intent_detail": "careful_investigation"}

    with pytest.raises(ValueError):
        session._validate_player_intent(missing)
    with pytest.raises(ValueError):
        session._validate_player_intent(extra)


@pytest.mark.parametrize("seed", [0, -1, 2**128, "", "run-a:0001"])
def test_rng_seed_validator_preserves_exact_integer_or_string(seed):
    session = _load_session()

    assert session._validate_rng_seed(seed) == seed
    assert type(session._validate_rng_seed(seed)) is type(seed)


@pytest.mark.parametrize(
    "seed",
    [True, False, None, 1.0, [], {}, {"seed"}, ("run-a", 1)],
)
def test_rng_seed_validator_rejects_boolean_collection_and_non_exact_scalars(seed):
    session = _load_session()

    with pytest.raises((TypeError, ValueError)):
        session._validate_rng_seed(seed)


def test_checkpoint_durability_mode_forwards_sync_manual_without_changing_default(
    tmp_path, monkeypatch
):
    session = _load_session()
    forwarded: list[dict] = []

    record = {
        "session_id": "sess-durable",
        "workspace": tmp_path,
        "campaign_id": "case",
        "investigator_id": "ada",
        "character_relpath": ".coc/investigators/ada/character.json",
        "character_path": tmp_path / ".coc/investigators/ada/character.json",
        "campaign_dir": tmp_path / ".coc/campaigns/case",
        "state_paths": {},
        "resolved_config": {"schema_version": 1, "brain": "debug"},
        "brain_at_create": "debug",
    }

    class Debug:
        @staticmethod
        def debug_send_turn(*_args, **kwargs):
            forwarded.append(dict(kwargs))
            return [], {"turns": [], "runtime_phase_ms": {}}

    monkeypatch.setattr(session, "get_session", lambda _sid: record)
    monkeypatch.setattr(session, "_load_debug_adapter", lambda: Debug)
    monkeypatch.setattr(session, "_record_turn_telemetry", lambda *_a, **_k: None)

    session.send("sess-durable", "normal")
    session.send("sess-durable", "durable", durability_mode="checkpoint")

    assert "recording_mode" not in forwarded[0]
    assert "recording_flush" not in forwarded[0]
    assert forwarded[1]["recording_mode"] == "sync"
    assert forwarded[1]["recording_flush"] == "manual"
    with pytest.raises(ValueError, match="durability_mode"):
        session.send("sess-durable", "bad", durability_mode="eventual")


def test_registry_expires_and_tombstones_session_without_revival(tmp_path):
    session = _load_session()
    clock = FakeClock()
    registry = session.SessionRegistry(ttl_seconds=10, monotonic=clock)
    sid = registry.create(_record(tmp_path), session_id="sess-expire")

    clock.advance(11)
    assert registry.expire() == [sid]
    with pytest.raises(session.UnknownSessionError) as exc:
        registry.get(sid)
    assert exc.value.kind == "unknown_session"
    with pytest.raises(ValueError, match="tombstoned"):
        registry.create(_record(tmp_path), session_id=sid)


def test_registry_returns_deep_copies_and_freezes_creation_config(tmp_path):
    session = _load_session()
    clock = FakeClock()
    source = _record(tmp_path)
    registry = session.SessionRegistry(monotonic=clock)
    sid = registry.create(source, session_id="sess-copy")
    source["resolved_config"]["brain"] = "pi"
    stored = registry.get(sid)
    stored["resolved_config"]["brain"] = "changed"

    again = registry.get(sid)
    assert again["resolved_config"] == {"schema_version": 1, "brain": "debug"}
    assert again["workspace"] == tmp_path.resolve()


def test_registry_rejects_non_integer_frozen_pipeline_schema_version(tmp_path):
    session = _load_session()
    registry = session.SessionRegistry(monotonic=FakeClock())
    record = _record(tmp_path)
    record["resolved_config"] = {
        "schema_version": 2.0,
        "planner": {"kind": "deterministic"},
        "rules": {"kind": "deterministic"},
        "narrator": {"kind": "template"},
        "player": {"kind": "human"},
    }
    record["brain_at_create"] = "debug"
    with pytest.raises(ValueError, match="not recoverable"):
        registry.create(record, session_id="sess-float-schema")


def test_registry_snapshot_restore_is_workspace_scoped_and_secret_free(tmp_path):
    session = _load_session()
    clock = FakeClock()
    registry = session.SessionRegistry(monotonic=clock)
    live = _record(tmp_path)
    live.update({"player_input": "secret", "adapter_handle": object(), "api_key": "nope"})
    registry.create(live, session_id="sess-live")
    registry.create(_record(tmp_path), session_id="sess-closed")
    registry.close("sess-closed")

    path = registry.snapshot(tmp_path)
    raw = json.loads(path.read_text(encoding="utf-8"))
    serialized = json.dumps(raw)
    assert path == tmp_path / ".coc" / "runtime" / "sessions.json"
    assert "secret" not in serialized
    assert "nope" not in serialized
    assert str(tmp_path.resolve()) not in serialized
    assert raw["closed_session_ids"] == ["sess-closed"]

    restored = session.SessionRegistry(monotonic=clock)
    assert restored.restore(tmp_path) == ["sess-live"]
    assert restored.get("sess-live")["workspace"] == tmp_path.resolve()
    with pytest.raises(session.UnknownSessionError):
        restored.get("sess-closed")

    other = tmp_path / "other"
    other.mkdir()
    assert restored.restore(other) == []


def test_registry_lock_serializes_concurrent_create_and_get(tmp_path):
    session = _load_session()
    registry = session.SessionRegistry(monotonic=FakeClock())
    failures: list[Exception] = []

    def worker(index: int) -> None:
        try:
            sid = registry.create(_record(tmp_path, investigator_id=f"inv-{index}"), session_id=f"sess-{index}")
            assert registry.get(sid)["investigator_id"] == f"inv-{index}"
        except Exception as exc:  # pragma: no cover - asserted below
            failures.append(exc)

    threads = [threading.Thread(target=worker, args=(index,)) for index in range(24)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert failures == []
    assert len(registry) == 24


def test_registry_close_and_expiry_retire_registered_worker_scopes(tmp_path):
    session = _load_session()
    clock = FakeClock()

    class Pool:
        def __init__(self):
            self.closed = []
        def close_scope(self, key):
            self.closed.append(key)

    pool = Pool()
    registry = session.SessionRegistry(ttl_seconds=10, monotonic=clock, worker_pool=pool)
    registry.create(_record(tmp_path), session_id="sess-close-worker")
    close_key = {"session_id": "sess-close-worker", "campaign_id": "camp-1",
                 "match_id": "camp-1", "role": "narrator:/runner"}
    registry.register_worker_scope("sess-close-worker", close_key)
    registry.close("sess-close-worker")
    assert pool.closed == [close_key]

    registry.create(_record(tmp_path), session_id="sess-expire-worker")
    expire_key = {"session_id": "sess-expire-worker", "campaign_id": "camp-1",
                  "match_id": "camp-1", "role": "narrator:/runner"}
    registry.register_worker_scope("sess-expire-worker", expire_key)
    clock.advance(11)
    assert registry.expire() == ["sess-expire-worker"]
    assert pool.closed[-1] == expire_key


def test_lazy_worker_pool_first_use_is_singleton_under_concurrency(monkeypatch):
    session = _load_session()
    registry = session.SessionRegistry(monotonic=FakeClock())
    created = []

    class Pool:
        def __init__(self, *_args, **_kwargs):
            created.append(self)

    class WorkerPoolModule:
        JsonlWorkerPool = Pool

    original_load = session._load_module
    monkeypatch.setattr(
        session, "_load_module",
        lambda name, path: WorkerPoolModule if path.name == "worker_pool.py"
        else original_load(name, path),
    )
    barrier = threading.Barrier(8)
    observed = []

    def first_use():
        barrier.wait()
        observed.append(session._ensure_worker_pool(registry))

    threads = [threading.Thread(target=first_use) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(created) == 1
    assert all(pool is created[0] for pool in observed)


def test_narrator_worker_pool_executes_the_trusted_canonical_server(monkeypatch):
    session = _load_session()
    registry = session.SessionRegistry(monotonic=FakeClock())
    commands = []

    class Pool:
        def __init__(self, command_factory, **_kwargs):
            commands.append(command_factory({}))

    class WorkerPoolModule:
        JsonlWorkerPool = Pool

    original_load = session._load_module
    monkeypatch.setattr(
        session,
        "_load_module",
        lambda name, path: WorkerPoolModule
        if path.name == "worker_pool.py"
        else original_load(name, path),
    )

    session._ensure_worker_pool(registry)

    assert commands == [[
        "node",
        str(
            Path("runtime/adapters/narrator/run_narration.mjs").resolve()
        ),
        "--server",
    ]]


def test_session_accepts_only_canonical_exact_grounded_narrator_audit():
    session = _load_session()
    envelope = {
        "scene_anchor": {
            "scene_id": "study",
            "sensory_anchors": ["雨点敲窗"],
        },
        "approved_reveals": {
            "clues": [{
                "clue_id": "clue-ledger",
                "player_safe_summary": "账本边缘有新鲜水痕",
            }],
        },
        "must_not_reveal": [{"id": "secret-owner", "category": "keeper"}],
    }
    anchor_ref = "envelope:/scene_anchor/sensory_anchors/0"
    valid = {
        "ok": True,
        "final_text": "雨点敲着窗。",
        "secret_audit_complete": True,
        "asserted_fact_refs": [anchor_ref],
        "semantic_audit": [{
            "asserted_ref": anchor_ref,
            "forbidden_ref": "secret-owner",
            "decision": "different_fact",
            "reason": "weather observation is not ownership",
        }],
        "response_mode": "tool",
    }

    receipt = session._validated_narrator_secret_audit(envelope, valid)

    assert receipt is not None
    assert receipt["passed"] is True
    assert receipt["coverage"]["expected_pair_count"] == 1


def test_session_rejects_narrator_audit_malformed_missing_extra_duplicate_uncertain_and_ungrounded():
    session = _load_session()
    envelope = {
        "scene_anchor": {"scene_id": "study", "sensory_anchors": ["雨点敲窗"]},
        "must_not_reveal": [{"id": "secret-owner", "category": "keeper"}],
    }
    anchor_ref = "envelope:/scene_anchor/sensory_anchors/0"
    pair = {
        "asserted_ref": anchor_ref,
        "forbidden_ref": "secret-owner",
        "decision": "different_fact",
        "reason": "different structured facts",
    }
    base = {
        "ok": True,
        "final_text": "雨点敲着窗。",
        "secret_audit_complete": True,
        "asserted_fact_refs": [anchor_ref],
        "semantic_audit": [pair],
        "response_mode": "tool",
    }
    attacks = [
        {**base, "response_mode": "prose_fallback"},
        {**base, "secret_audit_complete": False},
        {**base, "asserted_fact_refs": [anchor_ref, anchor_ref]},
        {**base, "semantic_audit": []},
        {**base, "semantic_audit": [pair, dict(pair)]},
        {**base, "semantic_audit": [{**pair, "forbidden_ref": "secret-other"}]},
        {**base, "semantic_audit": [{**pair, "decision": "uncertain"}]},
        {**base, "semantic_audit": [{**pair, "extra": True}]},
        {
            **base,
            "asserted_fact_refs": ["sensory:rain_proximity"],
            "semantic_audit": [{
                **pair,
                "asserted_ref": "sensory:rain_proximity",
            }],
        },
        {
            **base,
            "asserted_fact_refs": ["sensory:desk_dampness"],
            "semantic_audit": [{
                **pair,
                "asserted_ref": "sensory:desk_dampness",
            }],
        },
        {
            **base,
            "asserted_fact_refs": ["location:interior_study"],
            "semantic_audit": [{
                **pair,
                "asserted_ref": "location:interior_study",
            }],
        },
    ]

    assert all(
        session._validated_narrator_secret_audit(envelope, attack) is None
        for attack in attacks
    )


_VALID_RETRY_ENVELOPE = {
    "scene_anchor": {"scene_id": "study", "sensory_anchors": ["雨点敲窗"]},
    "approved_reveals": {"clues": [{
        "clue_id": "clue-ledger", "player_safe_summary": "账本边缘有新鲜水痕",
    }]},
    "must_not_reveal": [{"id": "secret-owner", "category": "keeper"}],
}
_VALID_RETRY_NARRATION = {
    "ok": True,
    "final_text": "雨点敲着窗。",
    "secret_audit_complete": True,
    "asserted_fact_refs": ["envelope:/scene_anchor/sensory_anchors/0"],
    "semantic_audit": [{
        "asserted_ref": "envelope:/scene_anchor/sensory_anchors/0",
        "forbidden_ref": "secret-owner",
        "decision": "different_fact",
        "reason": "weather observation is not ownership",
    }],
    "response_mode": "tool",
    "model_identity": {"provider": "zhipu-coding", "id": "glm-5.2"},
}


def _coverage_failing_narration():
    """A tool-mode narration whose secret_audit_complete is False (coverage-fail).

    Mirrors the intermittent GLM behaviour where the tool is invoked but the
    audit fields are incomplete, so ``_validated_narrator_secret_audit``
    returns None without the narration being a hard exception.
    """
    failing = json.loads(json.dumps(_VALID_RETRY_NARRATION))
    failing["secret_audit_complete"] = False
    failing["asserted_fact_refs"] = []
    failing["semantic_audit"] = []
    return failing


def test_narrate_with_coverage_retry_recovers_from_intermittent_coverage_fail():
    """A coverage-fail then pass on retry yields a valid audit (not a fatal abort).

    Regression: an intermittent GLM coverage-fail previously forced
    ``deterministic_fallback=True`` for the turn on the *first* attempt, which
    made ``validate_attestation`` reject the whole turn (consistent=False). The
    narrator path must retry the same envelope a bounded number of times before
    degrading, since the LLM is non-deterministic and the same envelope can
    pass on a second invocation.
    """
    session = _load_session()
    attempts = [_coverage_failing_narration(), _VALID_RETRY_NARRATION]

    def fake_pi_narrate(_request, **_kwargs):
        return attempts.pop(0)

    result = session._narrate_with_coverage_retry(
        _VALID_RETRY_ENVELOPE,
        player_text="...",
        pi_narrate=fake_pi_narrate,
    )
    # The valid narration won out: a secret_audit receipt is returned.
    assert result["secret_audit"] is not None
    assert result["secret_audit"]["passed"] is True
    assert result["deterministic_fallback"] is False
    assert result["narration"]["final_text"] == "雨点敲着窗。"
    # Both attempts were consumed.
    assert attempts == []


def test_narrate_with_coverage_retry_degrades_after_exhausting_retries():
    """Persistent coverage-fail still degrades to deterministic fallback.

    Safety/behaviour contract unchanged: when the model cannot produce a valid
    audit within the retry budget, the turn falls back (no secret_audit) rather
    than silently passing an unaudited narration.
    """
    session = _load_session()

    def fake_pi_narrate(_request, **_kwargs):
        return _coverage_failing_narration()

    result = session._narrate_with_coverage_retry(
        _VALID_RETRY_ENVELOPE,
        player_text="...",
        pi_narrate=fake_pi_narrate,
    )
    assert result["secret_audit"] is None
    assert result["deterministic_fallback"] is True
    # 1 initial attempt + 2 retries = 3 calls total, then it stops.
    assert result["attempts"] == 3


def test_sdk_unknown_session_is_stable_documented_exception():
    session = _load_session()
    registry = session.SessionRegistry(monotonic=FakeClock())
    with pytest.raises(session.UnknownSessionError) as exc:
        registry.get("sess-never-created")
    assert exc.value.kind == "unknown_session"
    assert str(exc.value) == "unknown_session"


def test_registry_snapshot_rejects_secret_or_absolute_config_values(tmp_path):
    session = _load_session()
    registry = session.SessionRegistry(monotonic=FakeClock())
    record = _record(tmp_path)
    record["resolved_config"] = {
        "schema_version": 1,
        "brain": "debug",
        "api_key": "must-not-persist",
        "cache_path": str(tmp_path / "absolute"),
    }
    registry.create(record, session_id="sess-unrecoverable")

    with pytest.raises(ValueError, match="not recoverable"):
        registry.snapshot(tmp_path)


def test_registry_restore_rejects_path_escape_and_sensitive_edited_snapshot(tmp_path):
    session = _load_session()
    snapshot = tmp_path / ".coc" / "runtime" / "sessions.json"
    snapshot.parent.mkdir(parents=True)
    snapshot.write_text(json.dumps({
        "schema_version": 1,
        "closed_session_ids": [],
        "sessions": [{
            "session_id": "sess-edited",
            "campaign_id": "case",
            "investigator_id": "ada",
            "character_relpath": "../../outside.json",
            "resolved_config": {"schema_version": 1, "brain": "debug", "token": "bad"},
            "brain_at_create": "debug",
        }],
    }), encoding="utf-8")

    with pytest.raises(ValueError, match="invalid session snapshot"):
        session.SessionRegistry(monotonic=FakeClock()).restore(tmp_path)


@pytest.mark.parametrize(
    "sensitive_config",
    [
        {"nested": {"Authorization": "opaque"}},
        {"nested": {"http-cookie": "opaque"}},
        {"nested": {"privateKeyPem": "opaque"}},
        {"nested": {"client_secret": "opaque"}},
        {"nested": {"refresh-token": "opaque"}},
        {"metadata": {"label": "Authorization: Bearer abc.def.ghi"}},
        {"metadata": {"label": "Cookie: session=opaque"}},
        {"metadata": {"label": "-----BEGIN PRIVATE KEY-----\nopaque"}},
        {"metadata": {"label": "https://user:password@example.invalid/api"}},
    ],
)
def test_registry_snapshot_recursively_rejects_sensitive_keys_and_values(
    tmp_path, sensitive_config,
):
    session = _load_session()
    registry = session.SessionRegistry(monotonic=FakeClock())
    record = _record(tmp_path)
    record["resolved_config"].update(sensitive_config)
    registry.create(record, session_id="sess-sensitive")

    with pytest.raises(ValueError, match="not recoverable"):
        registry.snapshot(tmp_path)


@pytest.mark.parametrize("ttl", [math.nan, math.inf, -math.inf])
def test_registry_rejects_non_finite_ttl(ttl):
    session = _load_session()
    with pytest.raises(ValueError, match="positive finite number"):
        session.SessionRegistry(ttl_seconds=ttl)


@pytest.mark.parametrize("now", [math.nan, math.inf, -math.inf])
def test_registry_rejects_non_finite_monotonic_clock(now, tmp_path):
    session = _load_session()
    registry = session.SessionRegistry(monotonic=lambda: now)
    with pytest.raises(RuntimeError, match="invalid value"):
        registry.create(_record(tmp_path), session_id="sess-clock")


def _valid_snapshot_payload(*session_ids: str) -> dict:
    return {
        "schema_version": 1,
        "closed_session_ids": [],
        "sessions": [
            {
                "session_id": sid,
                "campaign_id": "case",
                "investigator_id": "ada",
                "character_relpath": ".coc/investigators/ada/character.json",
                "resolved_config": {"schema_version": 1, "brain": "debug"},
                "brain_at_create": "debug",
            }
            for sid in session_ids
        ],
    }


@pytest.mark.parametrize("schema_version", [True, False, "1", None, 1.0])
def test_registry_restore_requires_exact_snapshot_schema_version(
    tmp_path, schema_version,
):
    session = _load_session()
    snapshot = tmp_path / ".coc" / "runtime" / "sessions.json"
    snapshot.parent.mkdir(parents=True)
    payload = _valid_snapshot_payload("sess-restored")
    payload["schema_version"] = schema_version
    snapshot.write_text(json.dumps(payload), encoding="utf-8")

    registry = session.SessionRegistry(monotonic=FakeClock())
    with pytest.raises(ValueError, match="invalid session snapshot"):
        registry.restore(tmp_path)
    assert len(registry) == 0


def test_registry_restore_rejects_extra_snapshot_root_fields(tmp_path):
    session = _load_session()
    snapshot = tmp_path / ".coc" / "runtime" / "sessions.json"
    snapshot.parent.mkdir(parents=True)
    payload = _valid_snapshot_payload("sess-restored")
    payload["unexpected"] = "must fail closed"
    snapshot.write_text(json.dumps(payload), encoding="utf-8")

    registry = session.SessionRegistry(monotonic=FakeClock())
    with pytest.raises(ValueError, match="invalid session snapshot"):
        registry.restore(tmp_path)
    assert len(registry) == 0


@pytest.mark.parametrize(
    "sessions,closed",
    [
        (["sess-duplicate", "sess-duplicate"], []),
        ([], ["sess-closed", "sess-closed"]),
        (["sess-overlap"], ["sess-overlap"]),
    ],
)
def test_registry_restore_rejects_duplicate_or_overlapping_session_ids(
    tmp_path, sessions, closed,
):
    session = _load_session()
    snapshot = tmp_path / ".coc" / "runtime" / "sessions.json"
    snapshot.parent.mkdir(parents=True)
    payload = _valid_snapshot_payload(*sessions)
    payload["closed_session_ids"] = closed
    snapshot.write_text(json.dumps(payload), encoding="utf-8")

    registry = session.SessionRegistry(monotonic=FakeClock())
    with pytest.raises(ValueError, match="invalid session snapshot"):
        registry.restore(tmp_path)
    assert len(registry) == 0
    assert registry._tombstones == {}


def test_registry_restore_malformed_batch_is_atomic(tmp_path):
    session = _load_session()
    snapshot = tmp_path / ".coc" / "runtime" / "sessions.json"
    snapshot.parent.mkdir(parents=True)
    payload = _valid_snapshot_payload("sess-valid", "sess-invalid")
    payload["sessions"][1]["resolved_config"]["cookie"] = "opaque"
    snapshot.write_text(json.dumps(payload), encoding="utf-8")

    registry = session.SessionRegistry(monotonic=FakeClock())
    registry.create(_record(tmp_path), session_id="sess-existing")
    before = registry.get("sess-existing")
    with pytest.raises(ValueError, match="invalid session snapshot"):
        registry.restore(tmp_path)
    assert registry.get("sess-existing")["campaign_id"] == before["campaign_id"]
    with pytest.raises(session.UnknownSessionError):
        registry.get("sess-valid")


def test_registry_auto_generated_session_id_retries_uuid_collision(tmp_path, monkeypatch):
    session = _load_session()
    registry = session.SessionRegistry(monotonic=FakeClock())

    class FakeUUID:
        def __init__(self, value: str) -> None:
            self.hex = value

    values = iter([FakeUUID("a" * 32), FakeUUID("a" * 32), FakeUUID("b" * 32)])
    monkeypatch.setattr(session.uuid, "uuid4", lambda: next(values))

    first = registry.create(_record(tmp_path))
    second = registry.create(_record(tmp_path, investigator_id="bea"))
    assert first == "sess_aaaaaaaaaaaaaaaa"
    assert second == "sess_bbbbbbbbbbbbbbbb"
