from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import sys
import uuid
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_longrun.py"
CONTINUITY_RUNNER_PATH = (
    REPO
    / "plugins"
    / "coc-keeper"
    / "scripts"
    / "coc_eval_continuity_runner.py"
)
CONTINUITY_EVIDENCE_PATH = (
    REPO
    / "plugins"
    / "coc-keeper"
    / "scripts"
    / "coc_eval_continuity_evidence.py"
)
LONG_MEMORY_PATH = REPO / "evaluation" / "spec" / "v1" / "cases" / "long-memory.json"
CHAPTER_TRANSITION_PATH = (
    REPO / "evaluation" / "spec" / "v1" / "cases" / "chapter-transition.json"
)
REGISTRY_PATH = REPO / "evaluation" / "spec" / "v1" / "case-registry.json"
TRUSTED_RUNNERS_PATH = (
    REPO / "plugins" / "coc-keeper" / "references" / "trusted-playtest-runners.json"
)
LIVE_CELL_PATH = (
    REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_live_cell.py"
)

RECALL_ANCHORS = (
    "inventory",
    "injury",
    "san",
    "relationship",
    "clue",
    "unresolved_thread",
)
EPISTEMIC_SIDECARS = (
    "epistemic-graph.json",
    "reveal-contracts.json",
    "compile-confidence.json",
)


def _load():
    assert MODULE_PATH.is_file(), f"missing implementation module: {MODULE_PATH}"
    spec = importlib.util.spec_from_file_location("coc_eval_longrun_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["coc_eval_longrun_test"] = module
    spec.loader.exec_module(module)
    return module


def test_longrun_is_compatibility_facade_over_split_continuity_modules():
    runner_source = CONTINUITY_RUNNER_PATH.read_text(encoding="utf-8")
    evidence_source = CONTINUITY_EVIDENCE_PATH.read_text(encoding="utf-8")
    facade_source = MODULE_PATH.read_text(encoding="utf-8")

    assert "def run_continuity_lane(" in runner_source
    assert "def validate_continuity_run(" not in runner_source
    assert "def validate_continuity_run(" in evidence_source
    assert "def _checkpoint_manifest_file_hashes(" in evidence_source
    assert "def _invocation_ledger_contract_ok(" in evidence_source
    assert "def _continuity_recall_receipt_ok(" in evidence_source
    assert "def _continuity_secret_audit_ok(" in evidence_source
    assert "_load_live_cell" not in evidence_source
    assert "coc_eval_continuity_runner.py" in facade_source
    assert "coc_eval_continuity_evidence.py" in facade_source
    assert "def validate_chapter_transition(" in facade_source


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _sha256_json(payload: object) -> str:
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _write_json(path: Path, payload: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return path


def _artifact(run_dir: Path, path: Path) -> dict[str, str]:
    return {
        "artifact": path.relative_to(run_dir).as_posix(),
        "sha256": _sha256_file(path),
    }


def _trusted_runner(role: str) -> dict:
    registry = json.loads(TRUSTED_RUNNERS_PATH.read_text(encoding="utf-8"))
    return dict(registry["runners"][role])


def _runner_attestation() -> dict:
    player = _trusted_runner("player")
    narrator = _trusted_runner("narrator")
    return {
        "segment": {
            "kind": "python_function",
            "identity": "coc-eval-live-segment@1",
            "path": "plugins/coc-keeper/scripts/coc_eval_live_cell.py",
            "sha256": _sha256_file(LIVE_CELL_PATH),
        },
        "player": {
            key: player[key] for key in ("kind", "identity", "path", "sha256")
        },
        "narrator": {
            key: narrator[key]
            for key in ("kind", "identity", "path", "sha256")
        },
    }


def _write_continuity_run(run_dir: Path, evidence: dict) -> dict:
    """Materialize all hash-bound receipts used by a complete test run."""
    if evidence.get("evidence_class") == "external":
        source_specs = {
            "inventory": (
                ".coc/investigators/inv1/inventory-history.jsonl",
                "jsonl",
                "/0/items/0",
                json.dumps({"items": ["item-eval-brass-token"]}, sort_keys=True)
                + "\n",
                "item-eval-brass-token",
            ),
            "injury": (
                ".coc/campaigns/eval-neutral/save/investigator-state/inv1.json",
                "json",
                "/conditions/0",
                json.dumps(
                    {"conditions": ["injury-eval-archival-cut"], "current_san": 50},
                    sort_keys=True,
                )
                + "\n",
                "injury-eval-archival-cut",
            ),
            "san": (
                ".coc/campaigns/eval-neutral/save/investigator-state/inv1.json",
                "json",
                "/current_san",
                json.dumps(
                    {"conditions": ["injury-eval-archival-cut"], "current_san": 50},
                    sort_keys=True,
                )
                + "\n",
                50,
            ),
            "relationship": (
                ".coc/campaigns/eval-neutral/save/npc-state.json",
                "json",
                "/psych/npc-eval-archivist/trust",
                json.dumps(
                    {"psych": {"npc-eval-archivist": {"trust": 1}}},
                    sort_keys=True,
                )
                + "\n",
                1,
            ),
            "clue": (
                ".coc/campaigns/eval-neutral/save/world-state.json",
                "json",
                "/discovered_clue_ids/0",
                json.dumps(
                    {"discovered_clue_ids": ["clue-latch-scratches"]},
                    sort_keys=True,
                )
                + "\n",
                "clue-latch-scratches",
            ),
            "unresolved_thread": (
                ".coc/investigators/inv1/history.jsonl",
                "jsonl",
                "/0/unresolved_threads/0",
                json.dumps(
                    {"unresolved_threads": ["thread-eval-archive-access"]},
                    sort_keys=True,
                )
                + "\n",
                "thread-eval-archive-access",
            ),
        }
        source_file_receipts: dict[str, tuple[str, int]] = {}
        for name, anchor in evidence["recall_anchors"].items():
            source_path, source_format, pointer, source_text, value = source_specs[name]
            value_hash = _sha256_json(value)
            identity = {
                "source_path": source_path,
                "json_pointer": pointer,
                "value_sha256": value_hash,
            }
            source_file_receipts[source_path] = (
                hashlib.sha256(source_text.encode("utf-8")).hexdigest(),
                len(source_text.encode("utf-8")),
            )
            source_artifacts = {}
            for phase in ("before", "after"):
                suffix = ".jsonl" if source_format == "jsonl" else ".json"
                source_artifact = (
                    run_dir
                    / "artifacts"
                    / "recall-sources"
                    / f"{phase}-restart"
                    / f"{name}{suffix}"
                )
                source_artifact.parent.mkdir(parents=True, exist_ok=True)
                source_artifact.write_text(source_text, encoding="utf-8")
                source_artifacts[phase] = _artifact(run_dir, source_artifact)
            anchor.update(
                {
                    "anchor_id": f"state:{_sha256_json(identity)}",
                    "source_path": source_path,
                    "source_format": source_format,
                    "json_pointer": pointer,
                    "before_value_sha256": value_hash,
                    "after_value_sha256": value_hash,
                    "before_source_artifact": source_artifacts["before"],
                    "after_source_artifact": source_artifacts["after"],
                    "observation_kind": "structured_state",
                }
            )
        campaign_root = ".coc/campaigns/eval-neutral"
        file_records: dict[str, dict] = {}

        def add_present(path: str, role: str, marker: str | None = None) -> None:
            file_hash, size = source_file_receipts.get(
                path,
                (_sha256_text(marker or path), len((marker or path).encode("utf-8"))),
            )
            file_records[path] = {
                "path": path,
                "role": role,
                "present": True,
                "sha256": file_hash,
                "size": size,
            }

        add_present(f"{campaign_root}/campaign.json", "campaign_config", "campaign")
        file_records[f"{campaign_root}/party.json"] = {
            "path": f"{campaign_root}/party.json",
            "role": "campaign_config",
            "present": False,
        }
        add_present(".coc/runtime.json", "runtime_config", "runtime")
        for filename in (
            "creation.json",
            "character.json",
            "history.jsonl",
            "development.jsonl",
            "inventory-history.jsonl",
        ):
            source_path = f".coc/investigators/inv1/{filename}"
            add_present(source_path, "investigator_state", filename)
        for filename in (
            "world-state.json",
            "pacing-state.json",
            "flags.json",
            "investigator-state/inv1.json",
            "npc-state.json",
            "threat-state.json",
            "subsystem-state.json",
        ):
            add_present(
                f"{campaign_root}/save/{filename}",
                "mutable_campaign_state",
                filename,
            )
        for filename in (
            "events.jsonl",
            "rolls.jsonl",
            "subsystem-results.jsonl",
        ):
            add_present(
                f"{campaign_root}/logs/{filename}",
                "mutable_campaign_state",
                filename,
            )
        for filename in (
            "story-graph.json",
            "clue-graph.json",
            "npc-agendas.json",
            "threat-fronts.json",
            "pacing-map.json",
            "improvisation-boundaries.json",
            "module-meta.json",
        ):
            add_present(
                f"{campaign_root}/scenario/{filename}",
                "campaign_input",
                filename,
            )
        for source_path in source_file_receipts:
            if source_path.startswith(f"{campaign_root}/"):
                add_present(source_path, "mutable_campaign_state")
        files = sorted(file_records.values(), key=lambda item: item["path"])
        roots = []
        for role, values in (
            (
                "mutable_campaign_state",
                (("save", True), ("memory", True), ("logs", True)),
            ),
            (
                "campaign_input",
                (("source", False), ("scenario", True), ("index", False)),
            ),
        ):
            for name, present in values:
                path = f"{campaign_root}/{name}"
                entries = sorted(
                    item["path"].removeprefix(f"{path}/")
                    for item in files
                    if item["present"] is True
                    and item["path"].startswith(f"{path}/")
                )
                roots.append(
                    {
                        "path": path,
                        "role": role,
                        "present": present,
                        "entries": entries,
                        "entry_count": len(entries),
                        "entry_list_sha256": _sha256_json(entries),
                    }
                )
        checkpoint_manifest = {
            "schema_version": 2,
            "eval_spec": "eval-spec-v1",
            "kind": "continuity-consumed-inputs",
            "campaign_id": "eval-neutral",
            "investigator_id": "inv1",
            "roots": sorted(roots, key=lambda item: item["path"]),
            "files": files,
            "excluded_path_classes": ["lock"],
        }
        checkpoint_snapshot = _sha256_json(checkpoint_manifest)
        evidence["restart"]["pre_checkpoint_sha256"] = checkpoint_snapshot
        evidence["restart"]["post_checkpoint_sha256"] = checkpoint_snapshot
        restart_at = evidence["restart"]["at_turn"]
        ranges = (
            list(range(1, restart_at + 1)),
            list(range(restart_at + 1, evidence["turn_count"] + 1)),
        )
        segments = []
        ledger_hashes = []
        first_transcript_descriptor = None
        first_transcript_tail = None
        first_transcript_count = None
        for index, accepted_turns in enumerate(ranges, 1):
            segment_dir = run_dir / "segments" / f"segment-{index}"
            invocation_id = uuid.uuid4().hex
            turn_bindings = [
                {"turn_number": turn, "decision_id": f"decision-{turn}"}
                for turn in accepted_turns
            ]
            ledger = segment_dir / "runner-invocations.jsonl"
            ledger.parent.mkdir(parents=True, exist_ok=True)
            trusted = {
                role: _trusted_runner(role) for role in ("player", "narrator")
            }
            secret_receipt = {
                "schema_version": 1,
                "status": "passed",
                "passed": True,
                "evidence_eligible": True,
                "forbidden_refs": [],
                "asserted_fact_refs": [],
                "direct_matches": [],
                "semantic_matches": [],
                "uncertain_matches": [],
                "malformed_evidence": [],
                "semantic_evidence": [],
                "semantic_evidence_contract": {
                    "schema_version": 1,
                    "coverage_rule": "asserted_x_forbidden_exact",
                    "verification_owner": "coc_secret_audit",
                },
                "coverage": {
                    "asserted_refs": [],
                    "forbidden_refs": [],
                    "expected_pairs": [],
                    "expected_pair_count": 0,
                    "observed_pair_count": 0,
                },
                "coverage_digest": "8956d77bceba9eabb4de317a9e05461d2a171f7a9a599138639db15175159e3c",
            }
            rows = []
            for segment_turn, binding in enumerate(turn_bindings, 1):
                for role, model in (
                    ("player", evidence["attestation"]["player_model"]),
                    ("narrator", evidence["attestation"]["kp_model"]),
                ):
                    runner = trusted[role]
                    row = {
                        "schema_version": 1,
                        "segment_invocation_id": invocation_id,
                        "segment_turn": segment_turn,
                        "continuity_turn": binding["turn_number"],
                        "decision_id": binding["decision_id"],
                        "role": role,
                        "attempt": segment_turn,
                        "transcript_turn": (
                            segment_turn * 2 - 1
                            if role == "player"
                            else segment_turn * 2
                        ),
                        "runner_kind": runner["kind"],
                        "runner_identity": runner["identity"],
                        "runner_path": str(REPO / runner["path"]),
                        "runner_sha256": runner["sha256"],
                        "model_identity": model,
                        "outcome": "external_success",
                        "response_mode": "tool",
                        "fallback_kind": None,
                    }
                    if role == "narrator":
                        row["secret_audit"] = secret_receipt
                    rows.append(row)
            ledger.write_text(
                "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
                encoding="utf-8",
            )
            ledger_descriptor = _artifact(run_dir, ledger)
            local_ledger_descriptor = {
                "artifact": ledger.name,
                "sha256": ledger_descriptor["sha256"],
            }
            ledger_hashes.append(ledger_descriptor["sha256"])
            checkpoint = segment_dir / "checkpoint-resume-manifest.json"
            _write_json(checkpoint, checkpoint_manifest)
            checkpoint_descriptor = _artifact(run_dir, checkpoint)
            local_checkpoint_descriptor = {
                "artifact": checkpoint.name,
                "sha256": checkpoint_descriptor["sha256"],
            }
            metadata_path = _write_json(
                segment_dir / "continuity-run-metadata.json",
                {
                    "schema_version": 1,
                    "eval_spec": "eval-spec-v1",
                    "source": "coc_eval_live_cell.run_live_segment",
                    "runner_invocation_id": invocation_id,
                    "live_match_metadata": {"run_id": f"segment-{index}"},
                },
            )
            metadata_descriptor = _artifact(run_dir, metadata_path)
            local_metadata_descriptor = {
                "artifact": metadata_path.name,
                "sha256": metadata_descriptor["sha256"],
            }
            transcript_rows = []
            normalized_transcript = []
            for turn in accepted_turns:
                for role, normalized_role, text in (
                    ("player_simulator", "player", f"player-{turn}"),
                    ("keeper_under_test", "keeper", f"keeper-{turn}"),
                ):
                    transcript_rows.append(
                        {"turn": turn, "role": role, "text": text}
                    )
                    normalized_transcript.append(
                        {"role": normalized_role, "text": text}
                    )
            transcript_path = segment_dir / "transcript.jsonl"
            transcript_path.write_text(
                "".join(
                    json.dumps(row, sort_keys=True) + "\n"
                    for row in transcript_rows
                ),
                encoding="utf-8",
            )
            transcript_descriptor = _artifact(run_dir, transcript_path)
            local_transcript_descriptor = {
                "artifact": transcript_path.name,
                "sha256": transcript_descriptor["sha256"],
            }
            resume_context = None
            local_resume_context = None
            initial_tail = []
            initial_narration = "场景开始。"
            if index == 1:
                first_transcript_descriptor = transcript_descriptor
                first_transcript_tail = normalized_transcript[-6:]
                first_transcript_count = len(normalized_transcript)
            else:
                assert first_transcript_descriptor is not None
                assert first_transcript_tail is not None
                assert first_transcript_count is not None
                initial_tail = first_transcript_tail
                initial_narration = first_transcript_tail[-1]["text"]
                resume_context_path = _write_json(
                    segment_dir / "continuity-resume-context.json",
                    {
                        "schema_version": 1,
                        "eval_spec": "eval-spec-v1",
                        "kind": "continuity-resume-context",
                        "source_segment_id": 1,
                        "resume_start_turn": accepted_turns[0],
                        "source_transcript_sha256": first_transcript_descriptor[
                            "sha256"
                        ],
                        "source_transcript_message_count": first_transcript_count,
                        "transcript_tail": first_transcript_tail,
                        "last_narration": initial_narration,
                    },
                )
                resume_context = _artifact(run_dir, resume_context_path)
                local_resume_context = {
                    "artifact": resume_context_path.name,
                    "sha256": resume_context["sha256"],
                }
            player_requests_path = _write_json(
                segment_dir / "player-requests.json",
                [
                    {
                        "transcript_tail": initial_tail,
                        "narration": initial_narration,
                    }
                ],
            )
            player_requests_descriptor = _artifact(
                run_dir, player_requests_path
            )
            local_player_requests_descriptor = {
                "artifact": player_requests_path.name,
                "sha256": player_requests_descriptor["sha256"],
            }
            segment_receipt = {
                "schema_version": 1,
                "eval_spec": "eval-spec-v1",
                "evidence_class": "external",
                "runner": "coc_live_match",
                "logical_session_id": evidence["session_id"],
                "runner_invocation_id": invocation_id,
                "runner_invocation_source": {
                    "kind": "runner_issued_uuid",
                    "artifact": local_metadata_descriptor,
                    "json_pointer": "/runner_invocation_id",
                },
                "accepted_turns": accepted_turns,
                "turn_bindings": turn_bindings,
                "snapshot_sha256": checkpoint_snapshot,
                "resume_context_applied": index == 2,
                "attestation": {
                    **evidence["attestation"],
                    "runner": "coc_live_match",
                },
                "artifacts": {
                    "invocation_ledger": local_ledger_descriptor,
                    "checkpoint_resume": local_checkpoint_descriptor,
                    "run_metadata": local_metadata_descriptor,
                    "transcript": local_transcript_descriptor,
                    "player_requests": local_player_requests_descriptor,
                    "resume_context": local_resume_context,
                },
            }
            receipt = segment_dir / "continuity-segment.json"
            _write_json(receipt, segment_receipt)
            segments.append(
                {
                    "segment_id": index,
                    "logical_session_id": evidence["session_id"],
                    "runner_invocation_id": invocation_id,
                    "accepted_turns": accepted_turns,
                    "turn_bindings": turn_bindings,
                    "receipt": _artifact(run_dir, receipt),
                    "invocation_ledger": ledger_descriptor,
                    "checkpoint_manifest": checkpoint_descriptor,
                    "runner_metadata": metadata_descriptor,
                    "transcript": transcript_descriptor,
                    "player_requests": player_requests_descriptor,
                    "resume_context": resume_context,
                    "resume_context_applied": index == 2,
                    "checkpoint_snapshot_sha256": checkpoint_snapshot,
                }
            )
        evidence["segments"] = segments
        evidence["restart"]["model_context_rehydrated"] = True
    else:
        ledger_hashes = []

    recall_receipt = run_dir / "artifacts" / "recall-anchors.json"
    _write_json(
        recall_receipt,
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "anchors": evidence["recall_anchors"],
        },
    )
    evidence["recall_anchor_receipt"] = _artifact(run_dir, recall_receipt)

    audit_findings = []
    for index, ledger_hash in enumerate(ledger_hashes or [None], 1):
        finding = {
            "finding_id": f"secret-audit-segment-{index}",
            "status": "PASS",
            "segment_id": index,
            "structured": True,
            "prose_scanned": False,
        }
        if ledger_hash is not None:
            finding["invocation_ledger_sha256"] = ledger_hash
        audit_findings.append(finding)
    audit_path = run_dir / "artifacts" / "secret-audit.json"
    _write_json(
        audit_path,
        {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "status": "PASS",
            "evidence_class": evidence["evidence_class"],
            "structured": True,
            "findings": audit_findings,
        },
    )
    audit_descriptor = _artifact(run_dir, audit_path)
    evidence["secret_audit"] = {
        "status": "PASS",
        "references": [
            {
                **audit_descriptor,
                "finding_id": finding["finding_id"],
            }
            for finding in audit_findings
        ],
    }
    _write_json(run_dir / "continuity-evidence.json", evidence)
    return evidence


def _rehash_segment_ledger(run_dir: Path, evidence: dict, index: int) -> None:
    segment = evidence["segments"][index - 1]
    ledger = run_dir / segment["invocation_ledger"]["artifact"]
    ledger_hash = _sha256_file(ledger)
    segment["invocation_ledger"]["sha256"] = ledger_hash
    receipt_path = run_dir / segment["receipt"]["artifact"]
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["artifacts"]["invocation_ledger"]["sha256"] = ledger_hash
    _write_json(receipt_path, receipt)
    segment["receipt"]["sha256"] = _sha256_file(receipt_path)
    audit_path = run_dir / evidence["secret_audit"]["references"][0]["artifact"]
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    audit["findings"][index - 1]["invocation_ledger_sha256"] = ledger_hash
    _write_json(audit_path, audit)
    audit_hash = _sha256_file(audit_path)
    for reference in evidence["secret_audit"]["references"]:
        reference["sha256"] = audit_hash
    _write_json(run_dir / "continuity-evidence.json", evidence)


def _rehash_secret_audit(run_dir: Path, evidence: dict) -> None:
    references = evidence["secret_audit"]["references"]
    descriptor = references[0]
    audit_path = run_dir / descriptor["artifact"]
    audit_hash = _sha256_file(audit_path)
    for reference in references:
        reference["sha256"] = audit_hash
    _write_json(run_dir / "continuity-evidence.json", evidence)


def _rewrite_segment_invocation_id(
    run_dir: Path, evidence: dict, index: int, invocation_id: str
) -> None:
    segment = evidence["segments"][index - 1]
    segment["runner_invocation_id"] = invocation_id
    ledger = run_dir / segment["invocation_ledger"]["artifact"]
    rows = [
        json.loads(line)
        for line in ledger.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    for row in rows:
        row["segment_invocation_id"] = invocation_id
    ledger.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    metadata_path = run_dir / segment["runner_metadata"]["artifact"]
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata["runner_invocation_id"] = invocation_id
    _write_json(metadata_path, metadata)
    metadata_hash = _sha256_file(metadata_path)
    segment["runner_metadata"]["sha256"] = metadata_hash
    receipt_path = run_dir / segment["receipt"]["artifact"]
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["runner_invocation_id"] = invocation_id
    receipt["runner_invocation_source"]["artifact"]["sha256"] = metadata_hash
    receipt["artifacts"]["run_metadata"]["sha256"] = metadata_hash
    _write_json(receipt_path, receipt)
    _rehash_segment_ledger(run_dir, evidence, index)


def _rewrite_checkpoint_roots(manifest: dict) -> None:
    present_paths = {
        item["path"]
        for item in manifest["files"]
        if item.get("present") is True
    }
    for root in manifest["roots"]:
        entries = sorted(
            path.removeprefix(f'{root["path"]}/')
            for path in present_paths
            if path.startswith(f'{root["path"]}/')
        )
        root["entries"] = entries
        root["entry_count"] = len(entries)
        root["entry_list_sha256"] = _sha256_json(entries)


def _rewrite_all_checkpoints(
    run_dir: Path, evidence: dict, mutate, *, refresh_roots: bool = True
) -> None:
    snapshot_hashes = []
    for segment in evidence["segments"]:
        checkpoint = run_dir / segment["checkpoint_manifest"]["artifact"]
        manifest = json.loads(checkpoint.read_text(encoding="utf-8"))
        mutate(manifest)
        if refresh_roots:
            _rewrite_checkpoint_roots(manifest)
        _write_json(checkpoint, manifest)
        checkpoint_file_hash = _sha256_file(checkpoint)
        snapshot_hash = _sha256_json(manifest)
        snapshot_hashes.append(snapshot_hash)
        segment["checkpoint_manifest"]["sha256"] = checkpoint_file_hash
        segment["checkpoint_snapshot_sha256"] = snapshot_hash
        receipt_path = run_dir / segment["receipt"]["artifact"]
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        receipt["snapshot_sha256"] = snapshot_hash
        receipt["artifacts"]["checkpoint_resume"][
            "sha256"
        ] = checkpoint_file_hash
        _write_json(receipt_path, receipt)
        segment["receipt"]["sha256"] = _sha256_file(receipt_path)
    evidence["restart"]["pre_checkpoint_sha256"] = snapshot_hashes[0]
    evidence["restart"]["post_checkpoint_sha256"] = snapshot_hashes[1]
    _write_json(run_dir / "continuity-evidence.json", evidence)


def _requirements_for(lane_id: str) -> dict:
    payload = json.loads(LONG_MEMORY_PATH.read_text(encoding="utf-8"))
    for lane in payload["lanes"]:
        if lane["lane_id"] == lane_id:
            return dict(lane["requirements"])
    raise AssertionError(f"missing lane {lane_id}")


def _chapter_requirements() -> dict:
    payload = json.loads(CHAPTER_TRANSITION_PATH.read_text(encoding="utf-8"))
    return dict(payload["lanes"][0]["requirements"])


def _complete_continuity_evidence(
    *,
    turn_count: int = 25,
    restart_at: int = 13,
    evidence_class: str = "fixture",
    eligible: bool = True,
    attestation: dict | None = None,
    checkpoint_match: bool = True,
    monotonic: bool = True,
    omit_anchor: str | None = None,
) -> dict:
    accepted = list(range(1, turn_count + 1))
    if not monotonic:
        accepted = [1, 3, 2] + list(range(4, turn_count + 1))
    pre_hash = _sha256_text(f"checkpoint-pre-{restart_at}")
    post_hash = pre_hash if checkpoint_match else _sha256_text(f"checkpoint-post-mismatch-{restart_at}")
    anchors = {}
    for name in RECALL_ANCHORS:
        if name == omit_anchor:
            continue
        anchors[name] = {
            "anchor_id": f"anchor-{name}",
            "present_before_restart": True,
            "present_after_restart": True,
            "turn_ids": [restart_at - 1, restart_at + 1],
        }
    evidence = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "lane_id": f"continuity-{turn_count}",
        "evidence_class": evidence_class,
        "eligible": eligible,
        "session_id": "session-continuity-1",
        "accepted_turns": accepted,
        "turn_count": turn_count,
        "restart": {
            "at_turn": restart_at,
            "pre_checkpoint_sha256": pre_hash,
            "post_checkpoint_sha256": post_hash,
            "session_id_before": "session-continuity-1",
            "session_id_after": "session-continuity-1",
            "resumed": True,
            "model_workers_restarted_between_segments": True,
            "logical_evaluation_session_continued": True,
            "model_conversation_session_continuity_claimed": False,
        },
        "recall_anchors": anchors,
        "secret_audit": {
            "status": "PASS",
            "references": [
                {
                    "artifact": "artifacts/secret-audit.json",
                    "finding_id": "secret-audit-none",
                }
            ],
        },
    }
    if attestation is not None:
        evidence["attestation"] = attestation
    elif evidence_class == "external":
        evidence["attestation"] = {
            "player_model": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
            "kp_model": {"provider": "zhipu-coding", "id": "glm-5.2"},
            "runner": "coc_live_match.segmented",
            "runners": _runner_attestation(),
            "attested": True,
        }
    return evidence


def _complete_chapter_evidence(
    *,
    evidence_class: str = "fixture",
    omit_sidecar: str | None = None,
    code_revision_bridge: bool = False,
    include_invalidated_segment: bool = False,
) -> dict:
    sidecars = [name for name in EPISTEMIC_SIDECARS if name != omit_sidecar]
    evidence = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "lane_id": "masks-peru-to-america",
        "evidence_class": evidence_class,
        "eligible": True,
        "source_module_id": "masks-of-nyarlathotep",
        "chapter_switch_event": {
            "event_id": "evt-chapter-switch-1",
            "event_type": "chapter_switch",
            "from_scenario_id": "masks-of-nyarlathotep-ch-peru",
            "to_scenario_id": "masks-of-nyarlathotep-ch-america",
        },
        "pre_active_scenario_id": "masks-of-nyarlathotep-ch-peru",
        "post_active_scenario_id": "masks-of-nyarlathotep-ch-america",
        "preserved_epistemic_sidecars": sidecars,
        "investigator_state_continuity": {
            "investigator_id": "inv-1",
            "state_sha256_before": _sha256_text("inv-before"),
            "state_sha256_after": _sha256_text("inv-after-preserved"),
            "preserved": True,
        },
        "campaign_state_continuity": {
            "campaign_id": "camp-1",
            "state_sha256_before": _sha256_text("camp-before"),
            "state_sha256_after": _sha256_text("camp-after-preserved"),
            "preserved": True,
        },
        "discovered_clues": [
            {"clue_id": "clue-peru-1", "retained": True},
        ],
        "relationships": [
            {"npc_id": "npc-peru-guide", "retained": True},
        ],
        "item_continuity": {
            "items": [{"item_id": "item-notebook", "retained": True}],
            "preserved": True,
        },
        "code_revision_bridges_checkpoints": code_revision_bridge,
        "secret_audit": {
            "status": "PASS",
            "references": [
                {
                    "artifact": "artifacts/secret-audit.json",
                    "finding_id": "secret-audit-none",
                }
            ],
        },
    }
    if include_invalidated_segment or code_revision_bridge:
        evidence["invalidated_segment"] = {
            "segment_id": "seg-bridge-1",
            "reason_code": "code_revision_bridge",
            "from_checkpoint_sha256": _sha256_text("ckpt-a"),
            "to_checkpoint_sha256": _sha256_text("ckpt-b"),
            "recorded": True,
        }
    return evidence


def test_long_memory_case_spec_defines_25_and_50_lanes():
    assert LONG_MEMORY_PATH.is_file()
    payload = json.loads(LONG_MEMORY_PATH.read_text(encoding="utf-8"))
    assert payload["schema_version"] == 1
    assert payload["eval_spec"] == "eval-spec-v1"
    lanes = {lane["lane_id"]: lane for lane in payload["lanes"]}
    assert set(lanes) == {"continuity-25", "continuity-50"}
    assert lanes["continuity-25"]["turn_count"] == 25
    assert lanes["continuity-25"]["restart_at_turn"] == 13
    assert lanes["continuity-50"]["turn_count"] == 50
    assert lanes["continuity-50"]["restart_at_turn"] == 27
    for lane in payload["lanes"]:
        req = lane["requirements"]
        assert req["accepted_turns"]["monotonic"] is True
        assert req["restart"]["require_model_context_rehydration"] is True
        assert set(req["recall_anchors"]) == set(RECALL_ANCHORS)
        assert req["secret_leakage_audit"]["source"] == "structured_audit_references"
        assert req["secret_leakage_audit"]["forbid_prose_scanning"] is True


def test_chapter_transition_case_spec_is_identifier_only():
    assert CHAPTER_TRANSITION_PATH.is_file()
    payload = json.loads(CHAPTER_TRANSITION_PATH.read_text(encoding="utf-8"))
    assert payload["schema_version"] == 1
    assert payload["eval_spec"] == "eval-spec-v1"
    lane = payload["lanes"][0]
    assert lane["lane_id"] == "masks-peru-to-america"
    req = lane["requirements"]
    assert req["source_module_id"] == "masks-of-nyarlathotep"
    assert req["pre_active_scenario_id"] == "masks-of-nyarlathotep-ch-peru"
    assert req["post_active_scenario_id"] == "masks-of-nyarlathotep-ch-america"
    assert req["preserved_epistemic_sidecars"] == list(EPISTEMIC_SIDECARS)
    raw = CHAPTER_TRANSITION_PATH.read_text(encoding="utf-8").lower()
    # Contract must stay identifier-only: no embedded module prose blobs.
    forbidden_fragments = (
        "you awaken",
        "the expedition",
        "jackson elias",
        "©",
        "all rights reserved",
    )
    for fragment in forbidden_fragments:
        assert fragment not in raw


def test_validate_continuity_missing_run_is_not_run(tmp_path: Path):
    mod = _load()
    result = mod.validate_continuity_run(tmp_path / "missing", _requirements_for("continuity-25"))
    assert result["status"] == "NOT_RUN"
    assert result["findings"]
    assert all(item["severity"] == "missing_evidence" for item in result["findings"])


def test_validate_continuity_empty_dir_is_not_run(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "empty-run"
    run_dir.mkdir()
    result = mod.validate_continuity_run(run_dir, _requirements_for("continuity-25"))
    assert result["status"] == "NOT_RUN"
    assert any(item["code"] == "continuity_evidence_missing" for item in result["findings"])


def test_validate_continuity_turn_count_mismatch_fails(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "turns"
    evidence = _complete_continuity_evidence(turn_count=20)
    _write_json(run_dir / "continuity-evidence.json", evidence)
    result = mod.validate_continuity_run(run_dir, _requirements_for("continuity-25"))
    assert result["status"] == "FAIL"
    assert any(item["code"] == "turn_count_mismatch" for item in result["findings"])


def test_validate_continuity_non_monotonic_accepted_turns_fails(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "nonmono"
    evidence = _complete_continuity_evidence(monotonic=False)
    _write_json(run_dir / "continuity-evidence.json", evidence)
    result = mod.validate_continuity_run(run_dir, _requirements_for("continuity-25"))
    assert result["status"] == "FAIL"
    assert any(item["code"] == "accepted_turns_not_monotonic" for item in result["findings"])


def test_validate_continuity_checkpoint_hash_mismatch_fails(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "ckpt"
    evidence = _complete_continuity_evidence(checkpoint_match=False)
    _write_json(run_dir / "continuity-evidence.json", evidence)
    result = mod.validate_continuity_run(run_dir, _requirements_for("continuity-25"))
    assert result["status"] == "FAIL"
    assert any(item["code"] == "checkpoint_hash_mismatch" for item in result["findings"])


def test_validate_continuity_missing_recall_anchor_fails(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "anchor"
    evidence = _complete_continuity_evidence(omit_anchor="clue")
    _write_json(run_dir / "continuity-evidence.json", evidence)
    result = mod.validate_continuity_run(run_dir, _requirements_for("continuity-25"))
    assert result["status"] == "FAIL"
    assert any(item["code"] == "recall_anchor_missing" for item in result["findings"])
    assert any(item.get("anchor") == "clue" for item in result["findings"])


def test_validate_continuity_external_without_attestation_is_ineligible(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "external"
    evidence = _complete_continuity_evidence(evidence_class="external", attestation={})
    # Explicit empty attestation object marks executed-but-unattested external lane.
    evidence["attestation"] = {}
    _write_json(run_dir / "continuity-evidence.json", evidence)
    result = mod.validate_continuity_run(run_dir, _requirements_for("continuity-25"))
    assert result["status"] == "INELIGIBLE"
    assert any(item["code"] == "external_attestation_missing" for item in result["findings"])


def test_validate_continuity_complete_fixture_passes_and_labels_fixture(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "ok"
    evidence = _complete_continuity_evidence(evidence_class="fixture")
    _write_continuity_run(run_dir, evidence)
    result = mod.validate_continuity_run(run_dir, _requirements_for("continuity-25"))
    assert result["status"] == "PASS"
    assert result["evidence_class"] == "fixture"
    assert result["gameplay_evidence"] is False
    assert result["findings"] == []


def test_validate_continuity_external_attested_is_gameplay_evidence(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "ext-ok"
    evidence = _complete_continuity_evidence(evidence_class="external")
    _write_continuity_run(run_dir, evidence)
    result = mod.validate_continuity_run(run_dir, _requirements_for("continuity-25"))
    assert result["status"] == "PASS"
    assert result["evidence_class"] == "external"
    assert result["gameplay_evidence"] is True


def test_validate_continuity_rejects_rehashed_resume_prompt_without_prior_context(
    tmp_path: Path,
):
    mod = _load()
    run_dir = tmp_path / "resume-context-dropped"
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    segment = evidence["segments"][1]
    requests_path = run_dir / segment["player_requests"]["artifact"]
    _write_json(
        requests_path,
        [{"transcript_tail": [], "narration": "场景重新开始。"}],
    )
    requests_hash = _sha256_file(requests_path)
    segment["player_requests"]["sha256"] = requests_hash
    receipt_path = run_dir / segment["receipt"]["artifact"]
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["artifacts"]["player_requests"]["sha256"] = requests_hash
    _write_json(receipt_path, receipt)
    segment["receipt"]["sha256"] = _sha256_file(receipt_path)
    _write_json(run_dir / "continuity-evidence.json", evidence)

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "resume_context_prompt_mismatch"
        for item in result["findings"]
    )


def test_validate_continuity_external_requires_source_invocation_ids(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "missing-invocation"
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    evidence["segments"][0].pop("runner_invocation_id")
    _write_json(run_dir / "continuity-evidence.json", evidence)

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "external_runner_invocation_id_missing"
        for item in result["findings"]
    )


def test_validate_continuity_external_rejects_duplicate_invocation_ids(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "duplicate-invocation"
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    _rewrite_segment_invocation_id(
        run_dir,
        evidence,
        2,
        evidence["segments"][0]["runner_invocation_id"],
    )

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "external_runner_invocation_id_duplicate"
        for item in result["findings"]
    )


@pytest.mark.parametrize(
    "caller_selected_id", ["segment-output-name", "0" * 32]
)
def test_validate_continuity_rejects_rehashed_caller_selected_invocation_id(
    tmp_path: Path, caller_selected_id: str
):
    mod = _load()
    run_dir = tmp_path / "caller-selected-id"
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    _rewrite_segment_invocation_id(
        run_dir, evidence, 1, caller_selected_id
    )

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "external_runner_invocation_id_invalid"
        for item in result["findings"]
    )


@pytest.mark.parametrize(
    "mutation",
    ["runner", "player_path", "narrator_hash", "segment_identity"],
)
def test_validate_continuity_requires_exact_top_runner_identity(
    tmp_path: Path, mutation: str
):
    mod = _load()
    run_dir = tmp_path / "top-runner"
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    if mutation == "runner":
        evidence["attestation"]["runner"] = "arbitrary-nonempty-runner"
    elif mutation == "player_path":
        evidence["attestation"]["runners"]["player"][
            "path"
        ] = "runtime/adapters/player/arbitrary.mjs"
    elif mutation == "narrator_hash":
        evidence["attestation"]["runners"]["narrator"]["sha256"] = "0" * 64
    else:
        evidence["attestation"]["runners"]["segment"][
            "identity"
        ] = "arbitrary-segment@1"
    for segment in evidence["segments"]:
        receipt_path = run_dir / segment["receipt"]["artifact"]
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        receipt["attestation"] = evidence["attestation"]
        _write_json(receipt_path, receipt)
        segment["receipt"]["sha256"] = _sha256_file(receipt_path)
    _write_json(run_dir / "continuity-evidence.json", evidence)

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "external_runner_identity_mismatch"
        for item in result["findings"]
    )


def test_validate_continuity_requires_exact_segment_receipt_runner_identity(
    tmp_path: Path,
):
    mod = _load()
    run_dir = tmp_path / "receipt-runner"
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    segment = evidence["segments"][0]
    receipt_path = run_dir / segment["receipt"]["artifact"]
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["runner"] = "arbitrary-nonempty-runner"
    _write_json(receipt_path, receipt)
    segment["receipt"]["sha256"] = _sha256_file(receipt_path)
    _write_json(run_dir / "continuity-evidence.json", evidence)

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "segment_receipt_runner_identity_mismatch"
        for item in result["findings"]
    )


def test_validate_continuity_requires_registry_ledger_runner_identity(
    tmp_path: Path,
):
    mod = _load()
    run_dir = tmp_path / "ledger-runner"
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    segment = evidence["segments"][0]
    ledger = run_dir / segment["invocation_ledger"]["artifact"]
    rows = [
        json.loads(line)
        for line in ledger.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    next(row for row in rows if row["role"] == "player")[
        "runner_identity"
    ] = "arbitrary-nonempty-runner"
    ledger.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    _rehash_segment_ledger(run_dir, evidence, 1)

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "invocation_ledger_contract_invalid"
        and "runner_identity:player" in item.get("reasons", [])
        for item in result["findings"]
    )


def test_validate_continuity_rejects_tampered_bound_artifacts(tmp_path: Path):
    mod = _load()
    cases = {
        "receipt": (
            "segments/segment-1/continuity-segment.json",
            "segment_receipt_hash_mismatch",
        ),
        "ledger": (
            "segments/segment-1/runner-invocations.jsonl",
            "invocation_ledger_hash_mismatch",
        ),
        "checkpoint": (
            "segments/segment-1/checkpoint-resume-manifest.json",
            "checkpoint_manifest_hash_mismatch",
        ),
        "recall": (
            "artifacts/recall-anchors.json",
            "recall_anchor_receipt_hash_mismatch",
        ),
        "audit": (
            "artifacts/secret-audit.json",
            "secret_audit_artifact_hash_mismatch",
        ),
    }
    for case, (relative, expected_code) in cases.items():
        run_dir = tmp_path / case
        _write_continuity_run(
            run_dir, _complete_continuity_evidence(evidence_class="external")
        )
        target = run_dir / relative
        target.write_bytes(target.read_bytes() + b"\n")

        result = mod.validate_continuity_run(
            run_dir, _requirements_for("continuity-25")
        )

        assert result["status"] == "FAIL", case
        assert any(
            item["code"] == expected_code for item in result["findings"]
        ), (case, result["findings"])


@pytest.mark.parametrize(
    "mutation",
    [
        "missing_segment",
        "status_fail",
        "extra",
        "duplicate",
        "segment_ledger_swap",
        "duplicate_segment",
        "ledger_hash_set",
    ],
)
def test_validate_continuity_rejects_rehashed_secret_audit_contract_mutation(
    tmp_path: Path, mutation: str
):
    mod = _load()
    run_dir = tmp_path / mutation
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    references = evidence["secret_audit"]["references"]
    audit_path = run_dir / references[0]["artifact"]
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    if mutation == "missing_segment":
        audit["findings"].pop()
        references.pop()
    elif mutation == "status_fail":
        audit["status"] = "FAIL"
        evidence["secret_audit"]["status"] = "FAIL"
    elif mutation == "extra":
        extra = {
            **audit["findings"][0],
            "finding_id": "secret-audit-segment-extra",
            "segment_id": 3,
        }
        audit["findings"].append(extra)
        references.append(
            {**references[0], "finding_id": extra["finding_id"]}
        )
    elif mutation == "duplicate":
        audit["findings"].append(dict(audit["findings"][0]))
        references.append(dict(references[0]))
    elif mutation == "segment_ledger_swap":
        audit["findings"][0]["segment_id"] = 2
        audit["findings"][1]["segment_id"] = 1
    elif mutation == "duplicate_segment":
        audit["findings"][1]["segment_id"] = 1
    else:
        audit["findings"][1]["invocation_ledger_sha256"] = "f" * 64
    _write_json(audit_path, audit)
    _rehash_secret_audit(run_dir, evidence)

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "continuity_secret_audit_contract_invalid"
        for item in result["findings"]
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("schema_version", 2),
        ("schema_version", True),
        ("eval_spec", "eval-spec-v0"),
        ("evidence_class", "fixture"),
        ("structured", False),
    ],
)
def test_validate_continuity_rejects_rehashed_secret_audit_version_metadata(
    tmp_path: Path, field: str, value
):
    mod = _load()
    run_dir = tmp_path / field
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    audit_path = run_dir / evidence["secret_audit"]["references"][0]["artifact"]
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    audit[field] = value
    _write_json(audit_path, audit)
    _rehash_secret_audit(run_dir, evidence)

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "continuity_secret_audit_contract_invalid"
        for item in result["findings"]
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("schema_version", 2),
        ("schema_version", True),
        ("eval_spec", "eval-spec-v0"),
    ],
)
def test_validate_continuity_rejects_rehashed_segment_receipt_version(
    tmp_path: Path, field: str, value
):
    mod = _load()
    run_dir = tmp_path / field
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    segment = evidence["segments"][0]
    receipt_path = run_dir / segment["receipt"]["artifact"]
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt[field] = value
    _write_json(receipt_path, receipt)
    segment["receipt"]["sha256"] = _sha256_file(receipt_path)
    _write_json(run_dir / "continuity-evidence.json", evidence)

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "segment_receipt_version_mismatch"
        for item in result["findings"]
    )


def test_validate_continuity_rejects_rehashed_incomplete_checkpoint_manifest(
    tmp_path: Path,
):
    mod = _load()
    run_dir = tmp_path / "incomplete-checkpoint"
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    snapshot_hash = _sha256_json({})
    for segment in evidence["segments"]:
        checkpoint = run_dir / segment["checkpoint_manifest"]["artifact"]
        _write_json(checkpoint, {})
        checkpoint_file_hash = _sha256_file(checkpoint)
        segment["checkpoint_manifest"]["sha256"] = checkpoint_file_hash
        segment["checkpoint_snapshot_sha256"] = snapshot_hash
        receipt_path = run_dir / segment["receipt"]["artifact"]
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        receipt["snapshot_sha256"] = snapshot_hash
        receipt["artifacts"]["checkpoint_resume"][
            "sha256"
        ] = checkpoint_file_hash
        _write_json(receipt_path, receipt)
        segment["receipt"]["sha256"] = _sha256_file(receipt_path)
    evidence["restart"]["pre_checkpoint_sha256"] = snapshot_hash
    evidence["restart"]["post_checkpoint_sha256"] = snapshot_hash
    _write_json(run_dir / "continuity-evidence.json", evidence)

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "checkpoint_manifest_contract_invalid"
        for item in result["findings"]
    )


def test_validate_continuity_rejects_rehashed_incomplete_invocation_ledger(
    tmp_path: Path,
):
    mod = _load()
    run_dir = tmp_path / "incomplete-ledger"
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    segment = evidence["segments"][0]
    ledger = run_dir / segment["invocation_ledger"]["artifact"]
    ledger.write_text('{"role":"player"}\n', encoding="utf-8")
    ledger_hash = _sha256_file(ledger)
    segment["invocation_ledger"]["sha256"] = ledger_hash
    receipt_path = run_dir / segment["receipt"]["artifact"]
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["artifacts"]["invocation_ledger"]["sha256"] = ledger_hash
    _write_json(receipt_path, receipt)
    segment["receipt"]["sha256"] = _sha256_file(receipt_path)
    audit_path = run_dir / evidence["secret_audit"]["references"][0]["artifact"]
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    audit["findings"][0]["invocation_ledger_sha256"] = ledger_hash
    _write_json(audit_path, audit)
    audit_hash = _sha256_file(audit_path)
    for reference in evidence["secret_audit"]["references"]:
        reference["sha256"] = audit_hash
    _write_json(run_dir / "continuity-evidence.json", evidence)

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "invocation_ledger_contract_invalid"
        for item in result["findings"]
    )


@pytest.mark.parametrize("mutation", ["missing", "duplicate", "extra"])
def test_validate_continuity_requires_exact_role_turn_ledger_coverage(
    tmp_path: Path, mutation: str
):
    mod = _load()
    run_dir = tmp_path / mutation
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    segment = evidence["segments"][0]
    ledger = run_dir / segment["invocation_ledger"]["artifact"]
    rows = [
        json.loads(line)
        for line in ledger.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    target = next(
        row
        for row in rows
        if row["role"] == "player" and row["continuity_turn"] == 2
    )
    if mutation == "missing":
        rows.remove(target)
    elif mutation == "duplicate":
        rows.append(dict(target))
    else:
        extra = dict(target)
        extra.update(
            {
                "attempt": 999,
                "segment_turn": 999,
                "continuity_turn": 999,
                "transcript_turn": 999,
                "decision_id": "decision-extra",
            }
        )
        rows.append(extra)
    ledger.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    _rehash_segment_ledger(run_dir, evidence, 1)

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "invocation_ledger_turn_coverage_invalid"
        for item in result["findings"]
    )


@pytest.mark.parametrize("invalid_turn", [True, 1.0])
def test_validate_continuity_rejects_bool_or_float_ledger_turn_binding(
    tmp_path: Path, invalid_turn
):
    mod = _load()
    run_dir = tmp_path / repr(invalid_turn)
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    segment = evidence["segments"][0]
    ledger = run_dir / segment["invocation_ledger"]["artifact"]
    rows = [
        json.loads(line)
        for line in ledger.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    target = next(
        row
        for row in rows
        if row["role"] == "player" and row["continuity_turn"] == 1
    )
    target["continuity_turn"] = invalid_turn
    target["segment_turn"] = invalid_turn
    ledger.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    _rehash_segment_ledger(run_dir, evidence, 1)

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "invocation_ledger_turn_coverage_invalid"
        for item in result["findings"]
    )
    assert any(
        item["code"] == "invocation_ledger_contract_invalid"
        and "turn_field_type:player" in item.get("reasons", [])
        for item in result["findings"]
    )


def test_validate_continuity_receipt_binds_decision_for_every_accepted_turn(
    tmp_path: Path,
):
    mod = _load()
    run_dir = tmp_path / "reduced-turn-bindings"
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    segment = evidence["segments"][0]
    receipt_path = run_dir / segment["receipt"]["artifact"]
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["turn_bindings"].pop()
    _write_json(receipt_path, receipt)
    segment["receipt"]["sha256"] = _sha256_file(receipt_path)
    _write_json(run_dir / "continuity-evidence.json", evidence)

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "segment_receipt_turn_bindings_mismatch"
        for item in result["findings"]
    )


def test_validate_continuity_requires_lane_wide_unique_decision_ids(
    tmp_path: Path,
):
    mod = _load()
    run_dir = tmp_path / "duplicate-cross-segment-decision"
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    segment = evidence["segments"][1]
    duplicated = evidence["segments"][0]["turn_bindings"][0]["decision_id"]
    segment["turn_bindings"][0]["decision_id"] = duplicated
    ledger = run_dir / segment["invocation_ledger"]["artifact"]
    rows = [
        json.loads(line)
        for line in ledger.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    for row in rows:
        if row["segment_turn"] == 1:
            row["decision_id"] = duplicated
    ledger.write_text(
        "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
        encoding="utf-8",
    )
    receipt_path = run_dir / segment["receipt"]["artifact"]
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["turn_bindings"] = segment["turn_bindings"]
    _write_json(receipt_path, receipt)
    _rehash_segment_ledger(run_dir, evidence, 2)

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "external_segment_decision_id_duplicate"
        for item in result["findings"]
    )


@pytest.mark.parametrize(
    "relative",
    [
        "save/pacing-state.json",
        "save/threat-state.json",
        "save/subsystem-state.json",
        "scenario/module-meta.json",
    ],
)
def test_validate_continuity_rejects_rehashed_required_checkpoint_omission(
    tmp_path: Path, relative: str
):
    mod = _load()
    run_dir = tmp_path / relative.replace("/", "-")
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    omitted = f".coc/campaigns/eval-neutral/{relative}"

    def omit(manifest):
        manifest["files"] = [
            item for item in manifest["files"] if item["path"] != omitted
        ]

    _rewrite_all_checkpoints(run_dir, evidence, omit)
    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "checkpoint_manifest_required_file_missing"
        and item.get("path") == omitted
        for item in result["findings"]
    )


@pytest.mark.parametrize("root_name", ["source", "scenario", "index"])
def test_validate_continuity_rejects_present_empty_campaign_input_root(
    tmp_path: Path, root_name: str
):
    mod = _load()
    run_dir = tmp_path / root_name
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    root_path = f".coc/campaigns/eval-neutral/{root_name}"

    def empty_root(manifest):
        manifest["files"] = [
            item
            for item in manifest["files"]
            if not item["path"].startswith(f"{root_path}/")
        ]
        next(item for item in manifest["roots"] if item["path"] == root_path)[
            "present"
        ] = True

    _rewrite_all_checkpoints(run_dir, evidence, empty_root)
    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "checkpoint_manifest_root_inventory_invalid"
        and item.get("root") == root_path
        for item in result["findings"]
    )


@pytest.mark.parametrize(
    "mutation",
    [
        "wrong_count",
        "wrong_digest",
        "missing_entry",
        "extra_entry",
        "duplicate_entry",
        "unsorted_entries",
    ],
)
def test_validate_continuity_rejects_rehashed_root_inventory_inconsistency(
    tmp_path: Path, mutation: str
):
    mod = _load()
    run_dir = tmp_path / mutation
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    root_path = ".coc/campaigns/eval-neutral/scenario"

    def corrupt(manifest):
        root = next(
            item for item in manifest["roots"] if item["path"] == root_path
        )
        if mutation == "wrong_count":
            root["entry_count"] += 1
        elif mutation == "wrong_digest":
            root["entry_list_sha256"] = "0" * 64
        elif mutation == "missing_entry":
            root["entries"].pop()
            root["entry_count"] = len(root["entries"])
            root["entry_list_sha256"] = _sha256_json(root["entries"])
        elif mutation == "extra_entry":
            root["entries"].append("invented.json")
            root["entries"].sort()
            root["entry_count"] = len(root["entries"])
            root["entry_list_sha256"] = _sha256_json(root["entries"])
        elif mutation == "duplicate_entry":
            root["entries"].append(root["entries"][0])
            root["entries"].sort()
            root["entry_count"] = len(root["entries"])
            root["entry_list_sha256"] = _sha256_json(root["entries"])
        else:
            root["entries"].reverse()
            root["entry_list_sha256"] = _sha256_json(root["entries"])

    _rewrite_all_checkpoints(
        run_dir, evidence, corrupt, refresh_roots=False
    )
    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "checkpoint_manifest_root_inventory_invalid"
        and item.get("root") == root_path
        for item in result["findings"]
    )


def test_validate_continuity_rejects_unbound_external_anchor_sources(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "unbound-anchor-sources"
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    evidence["recall_anchors"]["clue"].pop("before_source_artifact")
    receipt_path = run_dir / evidence["recall_anchor_receipt"]["artifact"]
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt["anchors"]["clue"].pop("before_source_artifact")
    _write_json(receipt_path, receipt)
    evidence["recall_anchor_receipt"]["sha256"] = _sha256_file(receipt_path)
    _write_json(run_dir / "continuity-evidence.json", evidence)

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "external_recall_anchor_source_unbound"
        for item in result["findings"]
    )


def test_validate_continuity_rejects_rehashed_shifted_turn_ranges(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "shifted-turn-ranges"
    evidence = _write_continuity_run(
        run_dir, _complete_continuity_evidence(evidence_class="external")
    )
    shifted_ranges = (list(range(2, 15)), list(range(15, 27)))
    evidence["accepted_turns"] = list(range(2, 27))
    for segment, shifted in zip(evidence["segments"], shifted_ranges, strict=True):
        segment["accepted_turns"] = shifted
        receipt_path = run_dir / segment["receipt"]["artifact"]
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
        receipt["accepted_turns"] = shifted
        _write_json(receipt_path, receipt)
        segment["receipt"]["sha256"] = _sha256_file(receipt_path)
    _write_json(run_dir / "continuity-evidence.json", evidence)

    result = mod.validate_continuity_run(
        run_dir, _requirements_for("continuity-25")
    )

    assert result["status"] == "FAIL"
    assert any(
        item["code"] == "accepted_turn_range_mismatch"
        for item in result["findings"]
    )


def test_continuity_runner_restarts_at_required_turn_and_preserves_hash(
    tmp_path: Path, monkeypatch
):
    longrun = _load()

    def fake_segment(*, start_turn, turn_count, workspace, output, model_roles):
        return {
            "accepted_turns": list(range(start_turn, start_turn + turn_count)),
            "snapshot_sha256": "a" * 64,
            "attestation": {
                "player_model": model_roles["player"],
                "kp_model": model_roles["kp"],
            },
        }

    monkeypatch.setattr(longrun, "_run_segment", fake_segment)
    lane = json.loads(LONG_MEMORY_PATH.read_text(encoding="utf-8"))["lanes"][0]
    model_roles = {
        "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
    }

    evidence = longrun.run_continuity_lane(
        lane=lane,
        workspace=tmp_path / "workspace",
        output=tmp_path / "lane",
        model_roles=model_roles,
    )

    assert evidence["accepted_turns"] == list(range(1, 26))
    assert evidence["restart"]["at_turn"] == 13
    assert (
        evidence["restart"]["pre_checkpoint_sha256"]
        == evidence["restart"]["post_checkpoint_sha256"]
    )
    assert evidence["attestation"]["attested"] is True
    assert evidence["status"] == "PASS"
    assert json.loads(
        (tmp_path / "lane" / "continuity-evidence.json").read_text(
            encoding="utf-8"
        )
    )["accepted_turns"] == list(range(1, 26))


def test_continuity_runner_uses_50_turn_restart_boundary(tmp_path: Path, monkeypatch):
    longrun = _load()
    calls = []

    def fake_segment(*, start_turn, turn_count, workspace, output, model_roles):
        calls.append((start_turn, turn_count))
        return {
            "accepted_turns": list(range(start_turn, start_turn + turn_count)),
            "snapshot_sha256": "9" * 64,
            "attestation": {
                "player_model": model_roles["player"],
                "kp_model": model_roles["kp"],
            },
        }

    monkeypatch.setattr(longrun, "_run_segment", fake_segment)
    lane = json.loads(LONG_MEMORY_PATH.read_text(encoding="utf-8"))["lanes"][1]
    model_roles = {
        "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
    }

    evidence = longrun.run_continuity_lane(
        lane=lane,
        workspace=tmp_path / "workspace",
        output=tmp_path / "lane",
        model_roles=model_roles,
    )

    assert calls == [(1, 27), (28, 23)]
    assert evidence["accepted_turns"] == list(range(1, 51))
    assert evidence["restart"]["at_turn"] == 27
    assert evidence["status"] == "PASS"


def test_continuity_runner_reads_recall_anchors_from_structured_campaign_state(
    tmp_path: Path, monkeypatch
):
    longrun = _load()

    def fake_segment(*, start_turn, turn_count, workspace, output, model_roles):
        return {
            "accepted_turns": list(range(start_turn, start_turn + turn_count)),
            "snapshot_sha256": "b" * 64,
            "attestation": {
                "player_model": model_roles["player"],
                "kp_model": model_roles["kp"],
            },
        }

    monkeypatch.setattr(longrun, "_run_segment", fake_segment)
    lane = json.loads(LONG_MEMORY_PATH.read_text(encoding="utf-8"))["lanes"][0]
    model_roles = {
        "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
    }

    evidence = longrun.run_continuity_lane(
        lane=lane,
        workspace=tmp_path / "workspace",
        output=tmp_path / "lane",
        model_roles=model_roles,
    )

    assert not list(
        (tmp_path / "workspace").rglob("evaluation-continuity-anchors.json")
    )
    expected_sources = {
        "inventory": ".coc/investigators/inv1/inventory-history.jsonl",
        "injury": ".coc/campaigns/eval-neutral/save/investigator-state/inv1.json",
        "san": ".coc/campaigns/eval-neutral/save/investigator-state/inv1.json",
        "relationship": ".coc/campaigns/eval-neutral/save/npc-state.json",
        "clue": ".coc/campaigns/eval-neutral/save/world-state.json",
        "unresolved_thread": ".coc/investigators/inv1/history.jsonl",
    }
    assert set(evidence["recall_anchors"]) == set(expected_sources)
    for name, anchor in evidence["recall_anchors"].items():
        assert anchor["source_path"] == expected_sources[name]
        assert anchor["json_pointer"].startswith("/")
        assert anchor["anchor_id"].startswith("state:")
        assert len(anchor["anchor_id"].removeprefix("state:")) == 64
        assert anchor["before_value_sha256"] == anchor["after_value_sha256"]
        assert len(anchor["before_value_sha256"]) == 64
        assert anchor["observation_kind"] == "structured_state"
        assert "model_observed" not in anchor


def test_continuity_runner_writes_checkpoint_guard_before_resume(
    tmp_path: Path, monkeypatch
):
    longrun = _load()
    observed_session_ids = []

    def fake_segment(*, start_turn, turn_count, workspace, output, model_roles):
        guard_path = workspace / ".coc" / "eval-continuity-restart.json"
        guard = json.loads(guard_path.read_text(encoding="utf-8"))
        observed_session_ids.append(guard["session_id"])
        if start_turn > 1:
            assert guard["expected_snapshot_sha256"] == "c" * 64
        return {
            "accepted_turns": list(range(start_turn, start_turn + turn_count)),
            "snapshot_sha256": "c" * 64,
            "attestation": {
                "player_model": model_roles["player"],
                "kp_model": model_roles["kp"],
            },
        }

    monkeypatch.setattr(longrun, "_run_segment", fake_segment)
    lane = json.loads(LONG_MEMORY_PATH.read_text(encoding="utf-8"))["lanes"][0]
    model_roles = {
        "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
    }

    evidence = longrun.run_continuity_lane(
        lane=lane,
        workspace=tmp_path / "workspace",
        output=tmp_path / "lane",
        model_roles=model_roles,
    )

    assert observed_session_ids == [evidence["session_id"], evidence["session_id"]]


def test_continuity_runner_rebases_real_segment_receipts_and_passes_validation(
    tmp_path: Path, monkeypatch
):
    longrun = _load()
    issued_invocation_ids = []

    def external_segment(
        *, start_turn, turn_count, workspace, output, model_roles
    ):
        output.mkdir(parents=True)
        session_id = json.loads(
            (workspace / ".coc" / "eval-continuity-restart.json").read_text(
                encoding="utf-8"
            )
        )["session_id"]
        invocation_id = uuid.uuid4().hex
        issued_invocation_ids.append(invocation_id)
        live_cell = longrun._load_live_cell()
        checkpoint_manifest = live_cell._continuity_snapshot_manifest(
            workspace, "eval-neutral", "inv1"
        )
        checkpoint_hash = _sha256_json(checkpoint_manifest)
        accepted_turns = list(range(start_turn, start_turn + turn_count))
        turn_bindings = [
            {"turn_number": turn, "decision_id": f"decision-{turn}"}
            for turn in accepted_turns
        ]
        ledger = output / "runner-invocations.jsonl"
        player_runner = (
            REPO / "runtime" / "adapters" / "player" / "run_player_turn.mjs"
        )
        narrator_runner = (
            REPO / "runtime" / "adapters" / "narrator" / "run_narration.mjs"
        )
        secret_receipt = live_cell.live_match.secret_audit.audit_secret_claims(
            [], [], []
        )
        rows = []
        for segment_turn, binding in enumerate(turn_bindings, 1):
            for role, runner, model in (
                ("player", player_runner, model_roles["player"]),
                ("narrator", narrator_runner, model_roles["kp"]),
            ):
                trusted = _trusted_runner(role)
                row = {
                    "schema_version": 1,
                    "segment_invocation_id": invocation_id,
                    "segment_turn": segment_turn,
                    "continuity_turn": binding["turn_number"],
                    "decision_id": binding["decision_id"],
                    "role": role,
                    "attempt": segment_turn,
                    "transcript_turn": (
                        segment_turn * 2 - 1
                        if role == "player"
                        else segment_turn * 2
                    ),
                    "runner_kind": "external_model_bridge",
                    "runner_identity": trusted["identity"],
                    "runner_path": str(runner),
                    "runner_sha256": _sha256_file(runner),
                    "model_identity": model,
                    "outcome": "external_success",
                    "response_mode": "tool",
                    "fallback_kind": None,
                }
                if role == "narrator":
                    row["secret_audit"] = secret_receipt
                rows.append(row)
        ledger.write_text(
            "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows),
            encoding="utf-8",
        )
        checkpoint = _write_json(
            output / "checkpoint-resume-manifest.json", checkpoint_manifest
        )
        local_ledger = {"artifact": ledger.name, "sha256": _sha256_file(ledger)}
        local_checkpoint = {
            "artifact": checkpoint.name,
            "sha256": _sha256_file(checkpoint),
        }
        metadata = _write_json(
            output / "continuity-run-metadata.json",
                {
                    "schema_version": 1,
                    "eval_spec": "eval-spec-v1",
                    "source": "coc_eval_live_cell.run_live_segment",
                    "runner_invocation_id": invocation_id,
                    "live_match_metadata": {"run_id": output.name},
            },
        )
        local_metadata = {
            "artifact": metadata.name,
            "sha256": _sha256_file(metadata),
        }
        transcript_rows = []
        for turn in accepted_turns:
            transcript_rows.extend(
                [
                    {
                        "turn": turn,
                        "role": "player_simulator",
                        "text": f"player-{turn}",
                    },
                    {
                        "turn": turn,
                        "role": "keeper_under_test",
                        "text": f"keeper-{turn}",
                    },
                ]
            )
        transcript = output / "transcript.jsonl"
        transcript.write_text(
            "".join(json.dumps(row, sort_keys=True) + "\n" for row in transcript_rows),
            encoding="utf-8",
        )
        local_transcript = {
            "artifact": transcript.name,
            "sha256": _sha256_file(transcript),
        }
        initial_tail = []
        initial_narration = "场景开始。"
        local_resume_context = None
        if start_turn > 1:
            first_transcript = output.parent / "segment-1" / "transcript.jsonl"
            first_rows = [
                json.loads(line)
                for line in first_transcript.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            initial_tail = [
                {
                    "role": (
                        "player"
                        if row["role"] == "player_simulator"
                        else "keeper"
                    ),
                    "text": row["text"],
                }
                for row in first_rows[-6:]
            ]
            initial_narration = initial_tail[-1]["text"]
            resume_context = _write_json(
                output / "continuity-resume-context.json",
                {
                    "schema_version": 1,
                    "eval_spec": "eval-spec-v1",
                    "kind": "continuity-resume-context",
                    "source_segment_id": 1,
                    "resume_start_turn": start_turn,
                    "source_transcript_sha256": _sha256_file(first_transcript),
                    "source_transcript_message_count": len(first_rows),
                    "transcript_tail": initial_tail,
                    "last_narration": initial_narration,
                },
            )
            local_resume_context = {
                "artifact": resume_context.name,
                "sha256": _sha256_file(resume_context),
            }
        player_requests = _write_json(
            output / "player-requests.json",
            [
                {
                    "transcript_tail": initial_tail,
                    "narration": initial_narration,
                }
            ],
        )
        local_player_requests = {
            "artifact": player_requests.name,
            "sha256": _sha256_file(player_requests),
        }
        attestation = {
            "player_model": model_roles["player"],
            "kp_model": model_roles["kp"],
            "runner": "coc_live_match",
            "runners": _runner_attestation(),
            "attested": True,
        }
        receipt = {
            "schema_version": 1,
            "eval_spec": "eval-spec-v1",
            "evidence_class": "external",
            "runner": "coc_live_match",
            "logical_session_id": session_id,
            "runner_invocation_id": invocation_id,
            "runner_invocation_source": {
                "kind": "runner_issued_uuid",
                "artifact": local_metadata,
                "json_pointer": "/runner_invocation_id",
            },
            "accepted_turns": accepted_turns,
            "turn_bindings": turn_bindings,
            "snapshot_sha256": checkpoint_hash,
            "resume_context_applied": start_turn > 1,
            "attestation": attestation,
            "artifacts": {
                "invocation_ledger": local_ledger,
                "checkpoint_resume": local_checkpoint,
                "run_metadata": local_metadata,
                "transcript": local_transcript,
                "player_requests": local_player_requests,
                "resume_context": local_resume_context,
            },
        }
        _write_json(output / "continuity-segment.json", receipt)
        return {
            **receipt,
            "secret_audit_passed": True,
        }

    monkeypatch.setattr(longrun, "_run_segment", external_segment)
    lane = json.loads(LONG_MEMORY_PATH.read_text(encoding="utf-8"))["lanes"][0]
    model_roles = {
        "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
    }

    result = longrun.run_continuity_lane(
        lane=lane,
        workspace=tmp_path / "workspace",
        output=tmp_path / "lane",
        model_roles=model_roles,
    )

    assert result["status"] == "PASS"
    assert result["validation"]["gameplay_evidence"] is True
    assert [
        item["runner_invocation_id"] for item in result["segments"]
    ] == issued_invocation_ids
    assert result["segments"][0]["receipt"]["artifact"] == (
        "segments/segment-1/continuity-segment.json"
    )
    assert result["session_scope"] == {
        "continued_identity": "logical_evaluation_session",
        "model_worker_sessions": "restarted_between_segments",
        "model_conversation_session_continuity": False,
        "model_context_transfer": "checkpoint_rehydrated",
    }


def test_run_segment_delegates_to_canonical_live_cell_adapter(tmp_path, monkeypatch):
    longrun = _load()
    observed = {}
    expected = {
        "accepted_turns": [14, 15],
        "snapshot_sha256": "d" * 64,
        "attestation": {
            "player_model": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
            "kp_model": {"provider": "zhipu-coding", "id": "glm-5.2"},
        },
    }

    class FakeLiveCell:
        @staticmethod
        def run_live_segment(**kwargs):
            observed.update(kwargs)
            return expected

    monkeypatch.setattr(longrun, "_load_live_cell", lambda: FakeLiveCell)
    model_roles = {
        "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
    }

    result = longrun._run_segment(
        start_turn=14,
        turn_count=2,
        workspace=tmp_path / "workspace",
        output=tmp_path / "segment-2",
        model_roles=model_roles,
    )

    assert result is expected
    assert observed == {
        "start_turn": 14,
        "turn_count": 2,
        "workspace": tmp_path / "workspace",
        "output": tmp_path / "segment-2",
        "model_roles": model_roles,
    }


def test_continuity_runner_does_not_default_external_attestation_to_true(
    tmp_path: Path, monkeypatch
):
    longrun = _load()

    def unattested_external_segment(
        *, start_turn, turn_count, workspace, output, model_roles
    ):
        return {
            "accepted_turns": list(range(start_turn, start_turn + turn_count)),
            "snapshot_sha256": "e" * 64,
            "evidence_class": "external",
            "attestation": {
                "player_model": model_roles["player"],
                "kp_model": model_roles["kp"],
            },
        }

    monkeypatch.setattr(longrun, "_run_segment", unattested_external_segment)
    lane = json.loads(LONG_MEMORY_PATH.read_text(encoding="utf-8"))["lanes"][0]
    model_roles = {
        "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
    }

    result = longrun.run_continuity_lane(
        lane=lane,
        workspace=tmp_path / "workspace",
        output=tmp_path / "lane",
        model_roles=model_roles,
    )

    assert result["status"] == "INELIGIBLE"
    assert result["attestation"]["attested"] is False


def test_continuity_runner_rejects_external_segment_session_drift(
    tmp_path: Path, monkeypatch
):
    longrun = _load()

    def drifting_session_segment(
        *, start_turn, turn_count, workspace, output, model_roles
    ):
        session_id = json.loads(
            (workspace / ".coc" / "eval-continuity-restart.json").read_text(
                encoding="utf-8"
            )
        )["session_id"]
        return {
            "accepted_turns": list(range(start_turn, start_turn + turn_count)),
            "snapshot_sha256": "f" * 64,
            "evidence_class": "external",
            "logical_session_id": (
                session_id if start_turn == 1 else f"{session_id}:drifted"
            ),
            "runner_invocation_id": f"segment-{start_turn}",
            "secret_audit_passed": True,
            "attestation": {
                "player_model": model_roles["player"],
                "kp_model": model_roles["kp"],
                "attested": True,
            },
        }

    monkeypatch.setattr(longrun, "_run_segment", drifting_session_segment)
    lane = json.loads(LONG_MEMORY_PATH.read_text(encoding="utf-8"))["lanes"][0]
    model_roles = {
        "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
    }

    result = longrun.run_continuity_lane(
        lane=lane,
        workspace=tmp_path / "workspace",
        output=tmp_path / "lane",
        model_roles=model_roles,
    )

    assert result["status"] == "INELIGIBLE"
    assert result["attestation"]["attested"] is False


def test_validate_chapter_transition_missing_evidence_is_not_run(tmp_path: Path):
    mod = _load()
    result = mod.validate_chapter_transition(tmp_path / "missing", _chapter_requirements())
    assert result["status"] == "NOT_RUN"
    assert any(item["severity"] == "missing_evidence" for item in result["findings"])


def test_validate_chapter_transition_missing_sidecar_fails(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "sidecar"
    evidence = _complete_chapter_evidence(omit_sidecar="reveal-contracts.json")
    _write_json(run_dir / "chapter-transition-evidence.json", evidence)
    result = mod.validate_chapter_transition(run_dir, _chapter_requirements())
    assert result["status"] == "FAIL"
    assert any(item["code"] == "epistemic_sidecar_missing" for item in result["findings"])


def test_validate_chapter_transition_requires_invalidated_segment_when_bridged(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "bridge"
    evidence = _complete_chapter_evidence(
        code_revision_bridge=True,
        include_invalidated_segment=False,
    )
    # Force bridge flag without segment payload.
    evidence.pop("invalidated_segment", None)
    evidence["code_revision_bridges_checkpoints"] = True
    _write_json(run_dir / "chapter-transition-evidence.json", evidence)
    result = mod.validate_chapter_transition(run_dir, _chapter_requirements())
    assert result["status"] == "FAIL"
    assert any(item["code"] == "invalidated_segment_missing" for item in result["findings"])


def test_validate_chapter_transition_complete_fixture_passes(tmp_path: Path):
    mod = _load()
    run_dir = tmp_path / "chapter-ok"
    evidence = _complete_chapter_evidence()
    _write_json(run_dir / "chapter-transition-evidence.json", evidence)
    result = mod.validate_chapter_transition(run_dir, _chapter_requirements())
    assert result["status"] == "PASS"
    assert result["evidence_class"] == "fixture"
    assert result["gameplay_evidence"] is False


def _load_pipeline():
    path = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_pipeline.py"
    scripts = str(path.parent)
    if scripts not in sys.path:
        sys.path.insert(0, scripts)
    spec = importlib.util.spec_from_file_location(
        "coc_eval_pipeline_longrun_test", path
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["coc_eval_pipeline_longrun_test"] = module
    spec.loader.exec_module(module)
    return module


def test_release_chapter_contradictory_evidence_fails_through_gates(tmp_path: Path):
    pipeline = _load_pipeline()
    run_dir = tmp_path / "chapter-bad"
    evidence = _complete_chapter_evidence(omit_sidecar="reveal-contracts.json")
    _write_json(run_dir / "chapter-transition-evidence.json", evidence)
    result = pipeline.run_release_external_gates(
        root=REPO,
        output=tmp_path / "out",
        chapter_run=run_dir,
        holdout_bundle=None,
        calibration_reviews=None,
        judge_requests=[],
    )
    assert result["lanes"]["chapter_transition"]["status"] == "FAIL"
    assert result["status"] == "FAIL"
    assert "chapter_run" not in set(result.get("missing") or [])


def test_release_chapter_valid_fixture_passes_lane_without_gameplay_claim(
    tmp_path: Path,
):
    pipeline = _load_pipeline()
    run_dir = tmp_path / "chapter-ok"
    evidence = _complete_chapter_evidence()
    _write_json(run_dir / "chapter-transition-evidence.json", evidence)
    result = pipeline.run_release_external_gates(
        root=REPO,
        output=tmp_path / "out",
        chapter_run=run_dir,
        holdout_bundle=None,
        calibration_reviews=None,
        judge_requests=[],
    )
    lane = result["lanes"]["chapter_transition"]
    assert lane["status"] == "PASS"
    assert lane.get("evidence_class") == "fixture"
    assert lane.get("gameplay_evidence") is False
    assert result["status"] == "NOT_RUN"
    assert set(result["missing"]) == {"holdout_bundle", "human_calibration"}


def test_case_registry_registers_longrun_fixture_self_tests():
    registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    by_id = {case["case_id"]: case for case in registry["cases"]}
    assert "long-memory-fixture-self-test" in by_id
    assert "chapter-transition-fixture-self-test" in by_id
    for case_id in (
        "long-memory-fixture-self-test",
        "chapter-transition-fixture-self-test",
    ):
        case = by_id[case_id]
        assert case["kind"] == "pytest_node"
        assert case["gate"] == "hard"
        assert "pr" in case["suites"]
        assert "smoke" not in case["suites"]
        assert "tests/test_eval_longrun.py" in " ".join(case["command"])
        # Deterministic fixture self-tests must not require unimplemented capabilities.
        assert "long_memory" not in case["required_capabilities"]
        assert "chapter_transition" not in case["required_capabilities"]
