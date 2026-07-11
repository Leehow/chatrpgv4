from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
EVIDENCE_SCRIPT = (
    REPO / "plugins" / "coc-keeper" / "scripts" / "coc_playtest_evidence.py"
)
REPORT_SCRIPT = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_playtest_report.py"
SECRET_AUDIT_SCRIPT = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_secret_audit.py"
TRUSTED_RUNNER_REGISTRY = (
    REPO / "plugins" / "coc-keeper" / "references" / "trusted-playtest-runners.json"
)
CANONICAL_RUNNERS = {
    "player": REPO / "runtime" / "adapters" / "player" / "run_player_turn.mjs",
    "narrator": REPO / "runtime" / "adapters" / "narrator" / "run_narration.mjs",
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
        if role == "narrator":
            audit_mod = _load("coc_secret_audit_fixture", SECRET_AUDIT_SCRIPT)
            ledger_rows[-1]["secret_audit"] = audit_mod.audit_secret_claims([], [], [])
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
    assert set(registry["runners"]) == {"player", "narrator"}
    for role, expected_path in {
        "player": "runtime/adapters/player/run_player_turn.mjs",
        "narrator": "runtime/adapters/narrator/run_narration.mjs",
    }.items():
        entry = registry["runners"][role]
        assert entry["role"] == role
        assert entry["path"] == expected_path
        assert entry["kind"] == "external_model_bridge"
        assert entry["identity"]
        assert entry["sha256"] == _sha256((REPO / expected_path).read_bytes())


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


def test_narrator_external_success_requires_recomputable_audit_receipt(tmp_path, evidence):
    provenance = _complete_provenance(tmp_path)

    def forge(rows):
        narrator = next(row for row in rows if row["role"] == "narrator")
        narrator["secret_audit"]["coverage_digest"] = "0" * 64

    _rewrite_ledger(tmp_path, forge)
    receipt = evidence.build_evidence_receipt(tmp_path, provenance)
    assert receipt["eligible_as_gameplay_evidence"] is False
    assert "narrator_secret_audit_invalid" in receipt["evidence_reasons"]


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
        ("no_external_player", "no_external_model_turns"),
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
