from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
EVIDENCE_SCRIPT = (
    REPO / "plugins" / "coc-keeper" / "scripts" / "coc_playtest_evidence.py"
)
REPORT_SCRIPT = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_playtest_report.py"
OPERATOR_REVIEW_SCRIPT = (
    REPO / "plugins" / "coc-keeper" / "scripts" / "coc_operator_review.py"
)
SECRET_AUDIT_SCRIPT = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_secret_audit.py"
RUN_IDENTITY_SCRIPT = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_run_identity.py"
TRUSTED_RUNNER_REGISTRY = (
    REPO / "plugins" / "coc-keeper" / "references" / "trusted-playtest-runners.json"
)
CANONICAL_RUNNERS = {
    "player": REPO / "runtime" / "adapters" / "player" / "run_player_turn.mjs",
    "narrator": REPO / "runtime" / "adapters" / "keeper" / "run_keeper_turn.mjs",
}


def _load(name: str, path: Path):
    assert path.exists(), f"missing implementation: {path}"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def evidence():
    return _load("coc_playtest_evidence_test", EVIDENCE_SCRIPT)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _complete_provenance(run_dir: Path) -> dict:
    registry = json.loads(TRUSTED_RUNNER_REGISTRY.read_text(encoding="utf-8"))[
        "runners"
    ]
    transcript = (
        b'{"turn":1,"role":"player_simulator","text":"look"}\n'
        b'{"turn":2,"role":"keeper_under_test","text":"rain"}\n'
    )
    events = b'{"event_type":"clue_reveal","clue_id":"c1"}\n'
    rolls = b'{"type":"roll","payload":{"roll":42}}\n'
    _write_bytes(run_dir / "transcript.jsonl", transcript)
    _write_bytes(run_dir / "logs" / "events.jsonl", events)
    _write_bytes(run_dir / "logs" / "rolls.jsonl", rolls)
    ledger_rows = []
    for attempt, (role, transcript_turn) in enumerate(
        (("player", 1), ("narrator", 2)), start=1
    ):
        entry = registry[role]
        ledger_rows.append(
            {
                "schema_version": 1,
                "role": role,
                "attempt": attempt,
                "transcript_turn": transcript_turn,
                "runner_kind": entry["kind"],
                "runner_identity": entry["identity"],
                "runner_path": str(CANONICAL_RUNNERS[role].resolve()),
                "runner_sha256": entry["sha256"],
                "model_identity": {
                    "provider": "fixture-provider",
                    "id": f"fixture-{role}-model",
                },
                "outcome": "external_success",
                "response_mode": "tool",
                "fallback_kind": None,
            }
        )
    (run_dir / "runner-invocations.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in ledger_rows),
        encoding="utf-8",
    )
    return {
        "started_at": "2026-07-10T01:02:03Z",
        "ended_at": "2026-07-10T01:03:04Z",
        "user_claimed_live": True,
        "transcript_path": "transcript.jsonl",
        "invocation_ledger_path": "runner-invocations.jsonl",
        "event_log_paths": ["logs/events.jsonl", "logs/rolls.jsonl"],
    }


def _operator_provenance(run_dir: Path) -> dict:
    registry = json.loads(TRUSTED_RUNNER_REGISTRY.read_text(encoding="utf-8"))[
        "runners"
    ]
    _write_bytes(
        run_dir / "transcript.jsonl",
        (
            b'{"turn":1,"role":"player_simulator","text":"look"}\n'
            b'{"turn":2,"role":"keeper_under_test","text":"rain"}\n'
        ),
    )
    _write_bytes(
        run_dir / "logs" / "events.jsonl",
        b'{"event_type":"scene","scene_id":"office"}\n',
    )
    _write_bytes(run_dir / "logs" / "rolls.jsonl", b"")
    _write_bytes(
        run_dir
        / "sandbox"
        / ".coc"
        / "campaigns"
        / "operator-campaign"
        / "logs"
        / "rolls.jsonl",
        b"",
    )
    narrator = registry["narrator"]
    rows = [
        {
            "schema_version": 1,
            "role": "player",
            "attempt": 1,
            "transcript_turn": 1,
            "runner_kind": "operator",
            "runner_identity": None,
            "runner_path": None,
            "runner_sha256": None,
            "model_identity": {"provider": "operator", "id": "human_or_codex"},
            "outcome": "operator_input",
            "response_mode": "operator_jsonl",
            "fallback_kind": None,
        },
        {
            "schema_version": 1,
            "role": "narrator",
            "attempt": 1,
            "transcript_turn": 2,
            "runner_kind": narrator["kind"],
            "runner_identity": narrator["identity"],
            "runner_path": str(CANONICAL_RUNNERS["narrator"].resolve()),
            "runner_sha256": narrator["sha256"],
            "model_identity": {"provider": "zhipu-coding", "id": "glm-5.2"},
            "outcome": "external_success",
            "response_mode": "keeper_agent",
            "fallback_kind": None,
        },
    ]
    (run_dir / "runner-invocations.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    return {
        "started_at": "2026-07-14T01:02:03Z",
        "ended_at": "2026-07-14T01:03:04Z",
        "user_claimed_live": True,
        "operator_long_play": True,
        "transcript_path": "transcript.jsonl",
        "invocation_ledger_path": "runner-invocations.jsonl",
        "event_log_paths": ["logs/events.jsonl", "logs/rolls.jsonl"],
    }


def _subagent_provenance(run_dir: Path) -> dict:
    provenance = _operator_provenance(run_dir)
    player_id = "player-agent-01"
    request = {
        "narration": "Rain traces the office window.",
        "character_card": {"name": "Ada"},
        "transcript_tail": [],
        "pending_choice": None,
        "play_language": "en-US",
    }
    binding = {
        "schema_version": 1,
        "protocol": "codex_subagent_player_v1",
        "actor_id": player_id,
        "turn": 1,
        "request": request,
    }
    request_sha = _sha256(
        json.dumps(
            binding, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    )
    envelope = {
        **binding,
        "type": "player_request",
        "request_sha256": request_sha,
    }
    response = {
        "schema_version": 1,
        "protocol": "codex_subagent_player_v1",
        "actor_id": player_id,
        "turn": 1,
        "request_sha256": request_sha,
        "player_text": "look",
        "intent_class": "investigate",
    }
    response_sha = _sha256(
        json.dumps(
            response, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    )
    exchange = {
        "schema_version": 1,
        "protocol": "codex_subagent_player_v1",
        "actor_id": player_id,
        "turn": 1,
        "request_envelope": envelope,
        "response": response,
        "request_sha256": request_sha,
        "response_sha256": response_sha,
    }
    (run_dir / "subagent-player-exchanges.jsonl").write_text(
        json.dumps(exchange, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    def replace_player(rows):
        player = next(row for row in rows if row["role"] == "player")
        player.update(
            runner_kind=None,
            runner_identity=None,
            model_identity=None,
            outcome="codex_subagent_input",
            response_mode="codex_subagent_jsonl",
            actor_kind="codex_subagent",
            actor_id=player_id,
            request_sha256=request_sha,
            response_sha256=response_sha,
        )

    _rewrite_ledger(run_dir, replace_player)
    provenance.update(
        operator_long_play=False,
        codex_subagent_player=True,
        subagent_player_contract={
            "schema_version": 1,
            "protocol": "codex_subagent_player_v1",
            "actor": {"kind": "codex_subagent", "id": player_id},
            "transport": "stdio_relay",
            "visibility": "player_safe_request_only",
            "filesystem_isolation": "not_attested_shared_workspace",
            "collaboration_receipt": "NOT_ATTESTED",
            "exchange_ledger": {
                "schema_version": 1,
                "path": "subagent-player-exchanges.jsonl",
            },
        },
        subagent_player_exchange_path="subagent-player-exchanges.jsonl",
    )
    return provenance


def _rewrite_ledger(run_dir: Path, mutate) -> None:
    path = run_dir / "runner-invocations.jsonl"
    rows = [json.loads(line) for line in path.read_text().splitlines() if line]
    mutate(rows)
    path.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )


def test_trusted_runner_registry_pins_canonical_entrypoints_and_hashes():
    assert TRUSTED_RUNNER_REGISTRY.is_file()
    registry = json.loads(TRUSTED_RUNNER_REGISTRY.read_text(encoding="utf-8"))
    assert registry["schema_version"] == 1
    assert set(registry["runners"]) == {
        "player", "narrator", "action_resolver", "interactive_driver"
    }
    for role, expected_path, expected_kind in (
        ("player", "runtime/adapters/player/run_player_turn.mjs", "external_model_bridge"),
        ("narrator", "runtime/adapters/keeper/run_keeper_turn.mjs", "external_model_bridge"),
        (
            "action_resolver",
            "runtime/adapters/compiler/run_action_resolve.mjs",
            "external_model_bridge",
        ),
        (
            "interactive_driver",
            "plugins/coc-keeper/scripts/coc_interactive_playtest.py",
            "python_cli",
        ),
    ):
        entry = registry["runners"][role]
        assert entry["role"] == role
        assert entry["path"] == expected_path
        assert entry["kind"] == expected_kind
        assert entry["identity"]
        assert entry["sha256"] == _sha256((REPO / expected_path).read_bytes())
    assert registry["runners"]["narrator"]["identity"] == (
        "coc-runtime-keeper-agent@0.79.9"
    )


@pytest.mark.parametrize(
    "payload",
    [[], "not-a-registry", 7, None],
    ids=["array", "string", "number", "null"],
)
def test_non_object_trusted_registry_fails_closed(
    tmp_path, evidence, monkeypatch, payload
):
    provenance = _complete_provenance(tmp_path)
    registry_path = tmp_path / "invalid-trusted-runners.json"
    registry_path.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(evidence, "TRUSTED_RUNNER_REGISTRY_PATH", registry_path)

    receipt = evidence.build_evidence_receipt(tmp_path, provenance)

    assert receipt["eligible_as_gameplay_evidence"] is False
    assert "trusted_runner_registry_invalid" in receipt["evidence_reasons"]


@pytest.mark.parametrize("attack", ["self_sha", "invented_package"])
def test_arbitrary_runner_cannot_self_attest_as_trusted(tmp_path, evidence, attack):
    provenance = _complete_provenance(tmp_path)
    fake = tmp_path / "fake-runner"
    fake.write_bytes(b"fake runner bytes\n")
    digest = _sha256(fake.read_bytes())

    def forge(rows):
        player = next(row for row in rows if row["role"] == "player")
        player.update(
            {
                "runner_kind": "external_model_bridge",
                "runner_identity": "forged-player@999",
                "runner_path": str(fake),
                "runner_sha256": digest,
                "model_identity": {"provider": "forged", "id": "fake-model"},
                "attestation": {"runner_sha256": digest},
            }
        )
        if attack == "invented_package":
            player["package_identity"] = {
                "name": "invented-trusted-package",
                "version": "999.0.0",
            }

    _rewrite_ledger(tmp_path, forge)

    receipt = evidence.build_evidence_receipt(tmp_path, provenance)

    assert receipt["eligible_as_gameplay_evidence"] is False
    assert "untrusted_player_runner_used" in receipt["evidence_reasons"]


def test_provenance_turn_counts_cannot_create_999_external_turns(tmp_path, evidence):
    provenance = _complete_provenance(tmp_path)
    provenance["player_runner"] = {"turn_count": 999, "kind": "external_model_bridge"}
    provenance["narrator_runner"] = {"turn_count": 999}
    provenance["external_model_turns"] = 999

    receipt = evidence.build_evidence_receipt(tmp_path, provenance)

    assert receipt["eligible_as_gameplay_evidence"] is True
    assert receipt["external_model_turns"] != 999
    assert receipt["external_model_turns"] == 2


def test_complete_attested_receipt_qualifies_and_hashes_actual_bytes(tmp_path, evidence):
    provenance = _complete_provenance(tmp_path)

    receipt = evidence.build_evidence_receipt(tmp_path, provenance)

    assert receipt["schema_version"] == 1
    assert receipt["started_at"] == provenance["started_at"]
    assert receipt["ended_at"] == provenance["ended_at"]
    assert receipt["user_claimed_live"] is True
    assert receipt["external_model_turns"] == 2
    assert receipt["fallback_turns"] == 0
    assert receipt["runners"]["player"]["sha256"] == _sha256(
        CANONICAL_RUNNERS["player"].read_bytes()
    )
    assert receipt["runners"]["narrator"]["sha256"] == _sha256(
        CANONICAL_RUNNERS["narrator"].read_bytes()
    )
    assert receipt["artifacts"]["transcript"]["sha256"] == _sha256(
        (tmp_path / "transcript.jsonl").read_bytes()
    )
    assert [entry["sha256"] for entry in receipt["artifacts"]["event_logs"]] == [
        _sha256((tmp_path / "logs" / "events.jsonl").read_bytes()),
        _sha256((tmp_path / "logs" / "rolls.jsonl").read_bytes()),
    ]
    assert receipt["artifacts"]["invocation_ledger"]["sha256"] == _sha256(
        (tmp_path / "runner-invocations.jsonl").read_bytes()
    )
    assert receipt["validation_findings"] == []
    assert receipt["evidence_reasons"] == []
    assert receipt["eligible_as_gameplay_evidence"] is True


def test_approved_operator_review_qualifies_actual_play_and_renders_battle_report(
    tmp_path, evidence
):
    run_dir = tmp_path / "operator-reviewed-run"
    provenance = _operator_provenance(run_dir)
    receipt = evidence.build_evidence_receipt(run_dir, provenance)
    assert receipt["eligible_as_gameplay_evidence"] is False
    assert receipt["operator_review_status"] == "pending"
    evidence.write_evidence_receipt(run_dir, receipt)

    (run_dir / "playtest.json").write_text(
        json.dumps(
            {
                "run_id": run_dir.name,
                "campaign_id": "operator-campaign",
                "scenario": "Operator Module",
                "scenario_id": "operator-module",
                "play_language": "en-US",
                "operator_long_play": True,
                "operator_review_protocol": "operator_codex_black_box_v2",
                "operator_review_status": "pending",
                "simulation_method": "operator_long_play_pending_review",
                "player_profile": "operator_player",
            }
        ),
        encoding="utf-8",
    )

    dimensions = {
        name: {
            "decision": "pass",
            "notes": f"Reviewed {name} against the transcript and event log.",
            "evidence_refs": ["transcript.jsonl#line-1"],
        }
        for name in ("rules", "facts", "progression", "style")
    }
    review_input = {
        "schema_version": 1,
        "protocol": "operator_codex_black_box_v2",
        "run_id": run_dir.name,
        "reviewer": {"kind": "codex", "id": "test-reviewer"},
        "dimensions": dimensions,
    }
    review_input_path = run_dir / "operator-review-input.json"
    review_input_path.write_text(
        json.dumps(review_input, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    _load("coc_operator_review_record", OPERATOR_REVIEW_SCRIPT).record_review(
        run_dir, review_input_path
    )
    qualified = evidence.read_evidence_receipt(run_dir)

    assert qualified["eligible_as_gameplay_evidence"] is True
    assert qualified["play_kind"] == "operator_reviewed_actual_play"
    assert qualified["qualification_method"] == "structured_operator_review"
    assert qualified["external_model_turns"] == 1
    assert qualified["evidence_reasons"] == []

    metadata = json.loads((run_dir / "playtest.json").read_text(encoding="utf-8"))
    assert metadata["operator_reviewed_actual_play"] is True
    assert metadata["simulation_method"] == "operator_reviewed_actual_play"
    assert metadata["official_suite_status"] == "NOT_RUN"
    report = run_dir / "artifacts" / "battle-report.md"
    report_text = report.read_text(encoding="utf-8")
    assert report.name == "battle-report.md"
    assert not report_text.startswith("# NON-GAMEPLAY")
    assert "<!-- report-schema-version: 2 -->" in report_text
    approved_completeness = json.loads(
        (run_dir / "artifacts" / "report-completeness.json").read_text(
            encoding="utf-8"
        )
    )
    assert approved_completeness["passed"] is True
    assert approved_completeness["required_public_roll_count"] == 0
    assert "operator_reviewed_actual_play" in report_text
    assert "Official suite status: NOT_RUN" in report_text

    review_input["dimensions"]["facts"]["decision"] = "fail"
    review_input["dimensions"]["facts"]["notes"] = "A fact mismatch requires repair."
    review_input_path.write_text(
        json.dumps(review_input, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    _load("coc_operator_review_rerecord", OPERATOR_REVIEW_SCRIPT).record_review(
        run_dir, review_input_path
    )
    downgraded = evidence.read_evidence_receipt(run_dir)
    downgraded_metadata = json.loads(
        (run_dir / "playtest.json").read_text(encoding="utf-8")
    )
    verification = run_dir / "artifacts" / "verification-sample.md"
    assert downgraded["eligible_as_gameplay_evidence"] is False
    assert downgraded["play_kind"] is None
    assert "no_external_player_turns" not in downgraded["evidence_reasons"]
    assert "no_external_model_turns" not in downgraded["evidence_reasons"]
    assert downgraded_metadata["simulation_method"] == "operator_long_play_changes_required"
    assert verification.is_file()
    verification_text = verification.read_text(encoding="utf-8")
    assert "<!-- report-schema-version: 2 -->" in verification_text
    downgraded_completeness = json.loads(
        (run_dir / "artifacts" / "report-completeness.json").read_text(
            encoding="utf-8"
        )
    )
    assert downgraded_completeness["passed"] is True
    assert downgraded_completeness["required_public_roll_count"] == 0
    assert not report.exists()


def test_manual_subagent_relay_remains_diagnostic_after_separate_review(
    tmp_path, evidence
):
    run_dir = tmp_path / "subagent-reviewed-run"
    provenance = _subagent_provenance(run_dir)
    receipt = evidence.build_evidence_receipt(run_dir, provenance)
    assert receipt["eligible_as_gameplay_evidence"] is False
    assert receipt["operator_review_status"] == "pending"
    assert receipt["runners"]["player"]["kind"] == "codex_subagent"
    assert receipt["runners"]["player"]["isolation"] == (
        "protocol_blind_shared_filesystem_not_attested"
    )
    assert receipt["runners"]["player"]["collaboration_receipt"] == "NOT_ATTESTED"
    assert receipt["play_kind"] == "manual_protocol_blind_diagnostic"
    assert "codex_collaboration_receipt_not_attested" in receipt["evidence_reasons"]
    exchange_artifact = receipt["artifacts"]["subagent_player_exchanges"]
    assert exchange_artifact["path"] == "subagent-player-exchanges.jsonl"
    assert exchange_artifact["sha256"] == _sha256(
        (run_dir / "subagent-player-exchanges.jsonl").read_bytes()
    )
    evidence.write_evidence_receipt(run_dir, receipt)
    (run_dir / "playtest.json").write_text(
        json.dumps(
            {
                "run_id": run_dir.name,
                "campaign_id": "operator-campaign",
                "scenario": "Subagent Module",
                "scenario_id": "subagent-module",
                "play_language": "en-US",
                "codex_subagent_player": True,
                "subagent_player_contract": provenance["subagent_player_contract"],
                "operator_review_protocol": "codex_subagent_player_v1",
                "operator_review_status": "pending",
                "simulation_method": "manual_protocol_blind_diagnostic_pending_review",
                "player_profile": "codex_collaboration_subagent_player",
            }
        ),
        encoding="utf-8",
    )
    review_input = {
        "schema_version": 1,
        "protocol": "codex_subagent_player_v1",
        "run_id": run_dir.name,
        "player": {"kind": "codex_subagent", "id": "player-agent-01"},
        "reviewer": {"kind": "codex", "id": "main-reviewer-01"},
        "dimensions": {
            name: {
                "decision": "pass",
                "notes": f"Reviewed {name} against the transcript and logs.",
                "evidence_refs": ["transcript.jsonl#line-1"],
            }
            for name in ("rules", "facts", "progression", "style")
        },
    }
    review_path = run_dir / "operator-review-input.json"
    review_path.write_text(json.dumps(review_input), encoding="utf-8")
    _load("coc_subagent_review_record", OPERATOR_REVIEW_SCRIPT).record_review(
        run_dir, review_path
    )

    qualified = evidence.read_evidence_receipt(run_dir)
    assert qualified["eligible_as_gameplay_evidence"] is False
    assert qualified["play_kind"] == "manual_protocol_blind_diagnostic"
    assert qualified["qualification_method"] == "manual_stdio_digest_binding_only"
    assert "codex_collaboration_receipt_not_attested" in qualified["evidence_reasons"]
    metadata = json.loads((run_dir / "playtest.json").read_text(encoding="utf-8"))
    assert metadata["codex_subagent_actual_play"] is False
    assert metadata["operator_reviewed_actual_play"] is False
    assert metadata["simulation_method"] == "manual_protocol_blind_diagnostic_reviewed"


def test_subagent_exchange_digest_is_recomputed_from_exact_response(tmp_path, evidence):
    provenance = _subagent_provenance(tmp_path)
    path = tmp_path / "subagent-player-exchanges.jsonl"
    exchange = json.loads(path.read_text(encoding="utf-8"))
    exchange["response"]["player_text"] = "tampered after relay"
    path.write_text(json.dumps(exchange) + "\n", encoding="utf-8")

    receipt = evidence.build_evidence_receipt(tmp_path, provenance)

    assert receipt["eligible_as_gameplay_evidence"] is False
    assert "subagent_player_exchange_ledger_invalid" in receipt["evidence_reasons"]


def test_fact_fidelity_fallback_is_counted_without_malformed_ledger(
    tmp_path, evidence
):
    provenance = _complete_provenance(tmp_path)

    def record_fallback(rows):
        narrator = next(row for row in rows if row["role"] == "narrator")
        narrator.update(
            outcome="template_fallback",
            fallback_kind="fact_fidelity",
            response_mode="audit_failure",
        )

    _rewrite_ledger(tmp_path, record_fallback)
    receipt = evidence.build_evidence_receipt(tmp_path, provenance)

    assert receipt["fallback_turns"] == 1
    assert "invocation_ledger_malformed" not in receipt["evidence_reasons"]
    assert receipt["eligible_as_gameplay_evidence"] is True


def test_unknown_fallback_kind_still_fails_closed(tmp_path, evidence):
    provenance = _complete_provenance(tmp_path)
    _rewrite_ledger(
        tmp_path,
        lambda rows: next(
            row for row in rows if row["role"] == "narrator"
        ).update(
            outcome="template_fallback",
            fallback_kind="unknown_fidelity_mode",
            response_mode="audit_failure",
        ),
    )

    receipt = evidence.build_evidence_receipt(tmp_path, provenance)

    assert receipt["eligible_as_gameplay_evidence"] is False
    assert "invocation_ledger_malformed" in receipt["evidence_reasons"]


def test_write_evidence_receipt_replaces_symlink_without_touching_outside_target(
    tmp_path, evidence
):
    run_dir = tmp_path / "run"
    receipt = evidence.build_evidence_receipt(run_dir, _complete_provenance(run_dir))
    outside = tmp_path / "outside-evidence.json"
    sentinel = "outside evidence sentinel\n"
    outside.write_text(sentinel, encoding="utf-8")
    output = run_dir / "evidence.json"
    output.symlink_to(outside)

    written = evidence.write_evidence_receipt(run_dir, receipt)

    assert outside.read_text(encoding="utf-8") == sentinel
    assert written == output
    assert written.is_file()
    assert not written.is_symlink()
    assert json.loads(written.read_text(encoding="utf-8"))["schema_version"] == 1


def test_caller_runner_claims_cannot_override_trusted_ledger(tmp_path, evidence):
    provenance = _complete_provenance(tmp_path)
    provenance["player_runner"] = {
        "kind": "scripted_fake",
        "runner_attested": False,
        "turn_count": 999,
    }
    provenance["live"] = True
    provenance["runner_attested"] = True
    provenance["eligible_as_gameplay_evidence"] = True

    receipt = evidence.build_evidence_receipt(tmp_path, provenance)

    assert receipt["user_claimed_live"] is True
    assert receipt["runners"]["player"]["kind"] == "external_model_bridge"
    assert receipt["external_model_turns"] == 2
    assert receipt["eligible_as_gameplay_evidence"] is True


@pytest.mark.parametrize(
    ("case", "reason"),
    [
        ("ledger_missing", "invocation_ledger_missing"),
        ("model_missing", "model_identity_missing"),
        ("untrusted_player", "untrusted_player_runner_used"),
        ("ledger_malformed", "invocation_ledger_malformed"),
        ("no_external_player", "no_external_player_turns"),
        ("transcript_missing", "transcript_hash_missing"),
        ("event_logs_missing", "event_log_hash_missing"),
    ],
)
def test_receipt_fails_closed_for_incomplete_or_malformed_provenance(
    tmp_path, evidence, case, reason
):
    provenance = _complete_provenance(tmp_path)
    if case == "ledger_missing":
        provenance["invocation_ledger_path"] = "missing.jsonl"
    elif case == "model_missing":
        _rewrite_ledger(
            tmp_path,
            lambda rows: next(row for row in rows if row["role"] == "player").pop(
                "model_identity"
            ),
        )
    elif case == "untrusted_player":
        fake = tmp_path / "untrusted-player"
        fake.write_bytes(b"untrusted\n")
        _rewrite_ledger(
            tmp_path,
            lambda rows: next(row for row in rows if row["role"] == "player").update(
                runner_path=str(fake),
                runner_sha256=_sha256(fake.read_bytes()),
            ),
        )
    elif case == "ledger_malformed":
        _rewrite_ledger(
            tmp_path,
            lambda rows: rows[0].update(attempt="999"),
        )
    elif case == "no_external_player":
        _rewrite_ledger(
            tmp_path,
            lambda rows: next(row for row in rows if row["role"] == "player").update(
                outcome="runner_failure",
                model_identity=None,
            ),
        )
    elif case == "transcript_missing":
        provenance["transcript_path"] = "missing.jsonl"
    elif case == "event_logs_missing":
        provenance["event_log_paths"] = []

    receipt = evidence.build_evidence_receipt(tmp_path, provenance)

    assert receipt["eligible_as_gameplay_evidence"] is False
    assert reason in receipt["evidence_reasons"]


def test_receipt_does_not_hash_artifact_paths_outside_run_dir(tmp_path, evidence):
    run_dir = tmp_path / "run"
    provenance = _complete_provenance(run_dir)
    outside = tmp_path / "outside.jsonl"
    outside.write_bytes(b"secret outside bytes\n")
    provenance["transcript_path"] = "../outside.jsonl"

    receipt = evidence.build_evidence_receipt(run_dir, provenance)

    assert receipt["eligible_as_gameplay_evidence"] is False
    assert "artifact_path_outside_run_dir" in receipt["evidence_reasons"]
    assert receipt["artifacts"]["transcript"]["sha256"] is None


def test_descriptor_anchored_evidence_does_not_follow_run_local_secret_symlink(
    tmp_path, evidence,
):
    identity = _load("coc_run_identity_evidence_test", RUN_IDENTITY_SCRIPT)
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    secret = tmp_path / "outside-secret.jsonl"
    secret.write_bytes(b"outside secret must never be hashed\n")
    handle = identity.allocate_default_run_dir(
        workspace / ".coc" / "playtests",
        trusted_root=workspace,
    )
    anchored = handle.activate()
    os.symlink(secret, "leak.jsonl", dir_fd=anchored.root_fd)
    try:
        artifact = evidence._build_artifact(anchored, "leak.jsonl")
        assert artifact == {"path": "leak.jsonl", "sha256": None}
        assert artifact["sha256"] != hashlib.sha256(secret.read_bytes()).hexdigest()
    finally:
        handle.close()


@pytest.mark.parametrize(
    ("relative_path", "reason"),
    [
        ("transcript.jsonl", "transcript_hash_mismatch"),
        ("logs/events.jsonl", "event_log_hash_mismatch"),
        ("runner-invocations.jsonl", "invocation_ledger_hash_mismatch"),
    ],
)
def test_validated_receipt_detects_on_disk_tamper(
    tmp_path, evidence, relative_path, reason
):
    provenance = _complete_provenance(tmp_path)
    receipt = evidence.build_evidence_receipt(tmp_path, provenance)
    evidence.write_evidence_receipt(tmp_path, receipt)
    with (tmp_path / relative_path).open("ab") as handle:
        handle.write(b"tampered\n")

    validated = evidence.read_evidence_receipt(tmp_path)

    assert validated["eligible_as_gameplay_evidence"] is False
    assert reason in validated["evidence_reasons"]


def test_write_recomputes_eligibility_instead_of_trusting_receipt_booleans(
    tmp_path, evidence
):
    provenance = _complete_provenance(tmp_path)
    receipt = evidence.build_evidence_receipt(tmp_path, provenance)
    (tmp_path / "transcript.jsonl").write_bytes(b"changed after build\n")
    receipt["eligible_as_gameplay_evidence"] = True
    receipt["evidence_reasons"] = []

    path = evidence.write_evidence_receipt(tmp_path, receipt)
    stored = json.loads(path.read_text(encoding="utf-8"))

    assert path == tmp_path / "evidence.json"
    assert stored["eligible_as_gameplay_evidence"] is False
    assert "transcript_hash_mismatch" in stored["evidence_reasons"]


def test_report_validates_receipt_and_does_not_trust_live_metadata_strings(
    tmp_path, evidence
):
    provenance = _complete_provenance(tmp_path)
    receipt = evidence.build_evidence_receipt(tmp_path, provenance)
    evidence.write_evidence_receipt(tmp_path, receipt)
    (tmp_path / "playtest.json").write_text(
        json.dumps(
            {
                "run_id": "receipt-run",
                "campaign_id": "receipt-run",
                "audit_profile": "live_llm_player_match",
                "simulation_method": "live_llm_player_vs_kp",
                "eligible_as_gameplay_evidence": True,
                "play_language": "en-US",
            }
        ),
        encoding="utf-8",
    )
    report = _load("coc_playtest_report_evidence_test", REPORT_SCRIPT)

    first = report.generate_battle_report(tmp_path).read_text(encoding="utf-8")
    assert "evidence-eligibility: eligible" in first

    with (tmp_path / "transcript.jsonl").open("ab") as handle:
        handle.write(b'{"turn":2,"role":"system","text":"tampered"}\n')
    second = report.generate_battle_report(tmp_path).read_text(encoding="utf-8")

    assert "evidence-eligibility: ineligible" in second
    assert "transcript_hash_mismatch" in second


def test_report_fails_closed_when_metadata_claims_live_but_receipt_is_absent(tmp_path):
    (tmp_path / "playtest.json").write_text(
        json.dumps(
            {
                "run_id": "spoofed-live",
                "audit_profile": "live_llm_player_match",
                "simulation_method": "live_llm_player_vs_kp",
                "eligible_as_gameplay_evidence": True,
                "play_language": "en-US",
            }
        ),
        encoding="utf-8",
    )
    report = _load("coc_playtest_report_absent_evidence_test", REPORT_SCRIPT)

    text = report.generate_battle_report(tmp_path).read_text(encoding="utf-8")

    assert "evidence-eligibility: ineligible" in text
    assert "evidence_receipt_missing" in text


def test_tampered_receipt_downgrades_evidence_sensitive_report_metadata(
    tmp_path, evidence
):
    provenance = _complete_provenance(tmp_path)
    receipt = evidence.build_evidence_receipt(tmp_path, provenance)
    evidence.write_evidence_receipt(tmp_path, receipt)
    (tmp_path / "playtest.json").write_text(
        json.dumps(
            {
                "run_id": "stale-attested-metadata",
                "campaign_id": "stale-attested-metadata",
                "audit_profile": "evidence_grade_player_bridge_match",
                "simulation_method": "attested_external_model_playtest",
                "player_profile": "attested_external_model_bridge",
                "play_language": "en-US",
            }
        ),
        encoding="utf-8",
    )
    with (tmp_path / "transcript.jsonl").open("ab") as handle:
        handle.write(b'{"turn":99,"role":"system","text":"tampered"}\n')
    report = _load("coc_playtest_report_stale_metadata_test", REPORT_SCRIPT)

    text = report.generate_battle_report(tmp_path).read_text(encoding="utf-8")

    assert "evidence-eligibility: ineligible" in text
    assert "Simulation Method: unattested_runner_match_not_gameplay_evidence" in text
    assert "Player Profile: unattested_runner" in text
    assert "Audit Profile: player_bridge_match" in text
    assert "attested_external_model_playtest" not in text


def _canonical_json(value) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def _action_row(turn: int, previous: str, action: dict) -> dict:
    row = {
        "turn_number": turn,
        "previous_sha256": previous,
        "action": action,
        "events": [],
        "state_before": {"sha256": "a" * 64},
        "state_after": {"sha256": "b" * 64},
        "provenance": {"recording_mode": "sync"},
    }
    row["row_sha256"] = _sha256(_canonical_json(row))
    return row


def _complete_interactive_provenance(run_dir: Path, *, run_kind: str) -> dict:
    registry = json.loads(TRUSTED_RUNNER_REGISTRY.read_text(encoding="utf-8"))[
        "runners"
    ]
    driver = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_interactive_playtest.py"
    transcript = (
        b'{"turn":1,"role":"player","text":"look"}\n'
        b'{"turn":1,"role":"keeper","text":"rain"}\n'
    )
    player_view = b'{"turn":1,"visible":true}\n'
    events = b'{"event_type":"clue_reveal","clue_id":"c1"}\n'
    _write_bytes(run_dir / "transcript.jsonl", transcript)
    _write_bytes(run_dir / "player-view.jsonl", player_view)
    _write_bytes(run_dir / "logs" / "events.jsonl", events)

    previous = "0" * 64
    rows = []
    for turn in (1, 2):
        row = _action_row(turn, previous, {"kind": "turn", "text": f"act-{turn}"})
        rows.append(row)
        previous = row["row_sha256"]
        manifest = {
            "schema_version": 2,
            "turn_number": turn,
            "action_chain_sha256": row["row_sha256"],
        }
        path = run_dir / "checkpoints" / f"turn-{turn:06d}" / "manifest.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
    (run_dir / "action-journal.jsonl").write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )

    narrator = registry["narrator"]
    ledger_row = {
        "schema_version": 1,
        "role": "narrator",
        "attempt": 1,
        "transcript_turn": 1,
        "runner_kind": narrator["kind"],
        "runner_identity": narrator["identity"],
        "runner_path": str(CANONICAL_RUNNERS["narrator"].resolve()),
        "runner_sha256": narrator["sha256"],
        "model_identity": {"provider": "zhipu-coding", "id": "glm-5.2"},
        "outcome": "external_success",
        "response_mode": "tool",
        "fallback_kind": None,
    }
    (run_dir / "runner-invocations.jsonl").write_text(
        json.dumps(ledger_row, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {
        "started_at": "2026-07-12T01:02:03Z",
        "ended_at": "2026-07-12T01:03:04Z",
        "user_claimed_live": True,
        "run_kind": run_kind,
        "transcript_path": "transcript.jsonl",
        "player_view_path": "player-view.jsonl",
        "action_ledger_path": "action-journal.jsonl",
        "checkpoint_manifest_paths": [
            "checkpoints/turn-000001/manifest.json",
            "checkpoints/turn-000002/manifest.json",
        ],
        "invocation_ledger_path": "runner-invocations.jsonl",
        "event_log_paths": ["logs/events.jsonl"],
        "interactive_driver_path": str(driver.resolve()),
    }


def test_interactive_run_b_eligible_when_trusted_chain_attests(tmp_path, evidence):
    provenance = _complete_interactive_provenance(
        tmp_path, run_kind="blind_actual_play"
    )
    receipt = evidence.build_evidence_receipt(tmp_path, provenance)
    assert receipt["run_kind"] == "blind_actual_play"
    assert receipt["eligible_as_gameplay_evidence"] is True
    assert receipt["runners"]["interactive_driver"]["sha256"] == (
        json.loads(TRUSTED_RUNNER_REGISTRY.read_text(encoding="utf-8"))["runners"][
            "interactive_driver"
        ]["sha256"]
    )
    assert receipt["runners"]["narrator"]["model_identities"] == [
        {"provider": "zhipu-coding", "id": "glm-5.2"}
    ]


def test_interactive_run_a_never_battle_report_eligible(tmp_path, evidence):
    provenance = _complete_interactive_provenance(
        tmp_path, run_kind="diagnostic_spoiler_run"
    )
    receipt = evidence.build_evidence_receipt(tmp_path, provenance)
    assert receipt["run_kind"] == "diagnostic_spoiler_run"
    assert receipt["eligible_as_gameplay_evidence"] is False
    assert "diagnostic_spoiler_run_not_battle_report_eligible" in receipt["evidence_reasons"]


def test_interactive_tampered_action_breaks_chain(tmp_path, evidence):
    provenance = _complete_interactive_provenance(
        tmp_path, run_kind="blind_actual_play"
    )
    path = tmp_path / "action-journal.jsonl"
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    rows[0]["action"] = {"kind": "turn", "text": "tampered"}
    path.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    receipt = evidence.build_evidence_receipt(tmp_path, provenance)
    assert receipt["eligible_as_gameplay_evidence"] is False
    assert "action_ledger_chain_invalid" in receipt["evidence_reasons"]


def test_interactive_missing_checkpoint_fails(tmp_path, evidence):
    provenance = _complete_interactive_provenance(
        tmp_path, run_kind="blind_actual_play"
    )
    (tmp_path / "checkpoints" / "turn-000002" / "manifest.json").unlink()
    receipt = evidence.build_evidence_receipt(tmp_path, provenance)
    assert receipt["eligible_as_gameplay_evidence"] is False
    assert "checkpoint_missing" in receipt["evidence_reasons"]


def test_interactive_glm_model_mismatch_fails(tmp_path, evidence):
    provenance = _complete_interactive_provenance(
        tmp_path, run_kind="blind_actual_play"
    )

    def mutate(rows):
        rows[0]["model_identity"] = {"provider": "openai", "id": "gpt-5"}

    _rewrite_ledger(tmp_path, mutate)
    receipt = evidence.build_evidence_receipt(tmp_path, provenance)
    assert receipt["eligible_as_gameplay_evidence"] is False
    assert "interactive_narrator_model_mismatch" in receipt["evidence_reasons"]


def test_self_declared_run_b_without_trusted_driver_fails(tmp_path, evidence):
    provenance = _complete_interactive_provenance(
        tmp_path, run_kind="blind_actual_play"
    )
    forged = tmp_path / "forged-driver.py"
    forged.write_text("print('nope')\n", encoding="utf-8")
    provenance["interactive_driver_path"] = str(forged)
    receipt = evidence.build_evidence_receipt(tmp_path, provenance)
    assert receipt["eligible_as_gameplay_evidence"] is False
    assert "interactive_driver_untrusted" in receipt["evidence_reasons"]


def test_run_a_report_uses_diagnostic_filename_and_spoiler_heading(tmp_path, evidence):
    provenance = _complete_interactive_provenance(
        tmp_path, run_kind="diagnostic_spoiler_run"
    )
    receipt = evidence.build_evidence_receipt(tmp_path, provenance)
    evidence.write_evidence_receipt(tmp_path, receipt)
    (tmp_path / "playtest.json").write_text(
        json.dumps(
            {
                "run_id": "diag-run",
                "campaign_id": "diag-run",
                "play_language": "en-US",
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "artifacts").mkdir()
    (tmp_path / "artifacts" / "battle-report.md").write_text("stale\n", encoding="utf-8")
    report = _load("coc_playtest_report_diag_test", REPORT_SCRIPT)
    path = report.generate_battle_report(tmp_path)
    assert path.name == "diagnostic-play-report.md"
    text = path.read_text(encoding="utf-8")
    assert "DIAGNOSTIC SPOILER-AWARE" in text
    assert not (tmp_path / "artifacts" / "battle-report.md").exists()


def test_run_b_eligible_report_is_battle_report(tmp_path, evidence):
    provenance = _complete_interactive_provenance(
        tmp_path, run_kind="blind_actual_play"
    )
    receipt = evidence.build_evidence_receipt(tmp_path, provenance)
    evidence.write_evidence_receipt(tmp_path, receipt)
    (tmp_path / "playtest.json").write_text(
        json.dumps(
            {
                "run_id": "blind-run",
                "campaign_id": "blind-run",
                "play_language": "en-US",
            }
        ),
        encoding="utf-8",
    )
    report = _load("coc_playtest_report_blind_test", REPORT_SCRIPT)
    path = report.generate_battle_report(tmp_path)
    assert path.name == "battle-report.md"
    assert "evidence-eligibility: eligible" in path.read_text(encoding="utf-8")
