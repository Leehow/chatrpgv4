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


def _attested_runner(
    run_dir: Path,
    role: str,
    *,
    turns: int = 2,
    kind: str = "external_model_bridge",
) -> dict:
    identity = f"fixture-{role}-bridge@1.0.0"
    relative_path = Path("runners") / f"{role}.bridge"
    runner_bytes = f"trusted {role} bridge bytes\n".encode()
    _write_bytes(run_dir / relative_path, runner_bytes)
    digest = _sha256(runner_bytes)
    return {
        "kind": kind,
        "identity": identity,
        "path": relative_path.as_posix(),
        "model_identity": {
            "provider": "fixture-provider",
            "model": f"fixture-{role}-model",
        },
        "turn_count": turns,
        "attestation": {
            "method": "runner_sha256",
            "subject_identity": identity,
            "runner_sha256": digest,
        },
    }


def _complete_provenance(run_dir: Path) -> dict:
    transcript = b'{"turn":1,"role":"player_simulator","text":"look"}\n'
    events = b'{"event_type":"clue_reveal","clue_id":"c1"}\n'
    rolls = b'{"type":"roll","payload":{"roll":42}}\n'
    _write_bytes(run_dir / "transcript.jsonl", transcript)
    _write_bytes(run_dir / "logs" / "events.jsonl", events)
    _write_bytes(run_dir / "logs" / "rolls.jsonl", rolls)
    return {
        "started_at": "2026-07-10T01:02:03Z",
        "ended_at": "2026-07-10T01:03:04Z",
        "user_claimed_live": True,
        "player_runner": _attested_runner(run_dir, "player", turns=2),
        "narrator_runner": _attested_runner(run_dir, "narrator", turns=2),
        "fallback_turns": 0,
        "transcript_path": "transcript.jsonl",
        "event_log_paths": ["logs/events.jsonl", "logs/rolls.jsonl"],
    }


def test_complete_attested_receipt_qualifies_and_hashes_actual_bytes(tmp_path, evidence):
    provenance = _complete_provenance(tmp_path)

    receipt = evidence.build_evidence_receipt(tmp_path, provenance)

    assert receipt["schema_version"] == 1
    assert receipt["started_at"] == provenance["started_at"]
    assert receipt["ended_at"] == provenance["ended_at"]
    assert receipt["user_claimed_live"] is True
    assert receipt["external_model_turns"] == 4
    assert receipt["fallback_turns"] == 0
    assert receipt["runners"]["player"]["sha256"] == _sha256(
        (tmp_path / "runners" / "player.bridge").read_bytes()
    )
    assert receipt["runners"]["narrator"]["sha256"] == _sha256(
        (tmp_path / "runners" / "narrator.bridge").read_bytes()
    )
    assert receipt["artifacts"]["transcript"]["sha256"] == _sha256(
        (tmp_path / "transcript.jsonl").read_bytes()
    )
    assert [entry["sha256"] for entry in receipt["artifacts"]["event_logs"]] == [
        _sha256((tmp_path / "logs" / "events.jsonl").read_bytes()),
        _sha256((tmp_path / "logs" / "rolls.jsonl").read_bytes()),
    ]
    assert receipt["validation_findings"] == []
    assert receipt["evidence_reasons"] == []
    assert receipt["eligible_as_gameplay_evidence"] is True


def test_live_claim_and_caller_booleans_cannot_attest_a_fake_runner(tmp_path, evidence):
    provenance = _complete_provenance(tmp_path)
    provenance["player_runner"]["kind"] = "scripted_fake"
    provenance["live"] = True
    provenance["runner_attested"] = True
    provenance["eligible_as_gameplay_evidence"] = True

    receipt = evidence.build_evidence_receipt(tmp_path, provenance)

    assert receipt["user_claimed_live"] is True
    assert receipt["runners"]["player"]["kind"] == "scripted_fake"
    assert receipt["eligible_as_gameplay_evidence"] is False
    assert "runner_not_attested" in receipt["evidence_reasons"]
    assert "runner_kind_ineligible" in receipt["evidence_reasons"]


@pytest.mark.parametrize(
    ("mutation", "reason"),
    [
        (lambda p: p.pop("player_runner"), "runner_missing"),
        (lambda p: p["player_runner"].update(kind="unknown"), "runner_kind_unknown"),
        (lambda p: p["player_runner"].pop("attestation"), "runner_not_attested"),
        (lambda p: p["player_runner"].pop("model_identity"), "model_identity_missing"),
        (
            lambda p: p["player_runner"].update(turn_count="2"),
            "external_model_turns_malformed",
        ),
        (
            lambda p: (
                p["player_runner"].update(turn_count=0),
                p["narrator_runner"].update(turn_count=0),
            ),
            "no_external_model_turns",
        ),
        (lambda p: p.update(fallback_turns="0"), "fallback_turns_malformed"),
        (lambda p: p.update(transcript_path="missing.jsonl"), "transcript_hash_missing"),
        (lambda p: p.update(event_log_paths=[]), "event_log_hash_missing"),
    ],
)
def test_receipt_fails_closed_for_incomplete_or_malformed_provenance(
    tmp_path, evidence, mutation, reason
):
    provenance = _complete_provenance(tmp_path)
    mutation(provenance)

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
        ("runners/player.bridge", "runner_hash_mismatch"),
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
