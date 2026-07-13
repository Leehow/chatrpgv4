#!/usr/bin/env python3
"""Long-run continuity and chapter-transition evidence validation for eval-spec-v1."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import tempfile
import uuid
from pathlib import Path
from typing import Any


EVAL_SPEC = "eval-spec-v1"
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
CONTINUITY_EVIDENCE_FILE = "continuity-evidence.json"
CHAPTER_EVIDENCE_FILE = "chapter-transition-evidence.json"
STATUSES = frozenset({"PASS", "FAIL", "INELIGIBLE", "NOT_RUN"})
EVIDENCE_CLASSES = frozenset({"fixture", "external"})
EXPECTED_MODEL_ROLES = {
    "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
    "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
}


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"unreadable JSON: {path}: {exc}") from exc


def _write_text_atomic(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return path


def _write_json_atomic(path: Path, payload: Any) -> Path:
    return _write_text_atomic(
        path,
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )


def _write_jsonl_atomic(path: Path, rows: list[dict[str, Any]]) -> Path:
    return _write_text_atomic(
        path,
        "".join(
            json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n"
            for row in rows
        ),
    )


def _canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _sha256_json(value: Any) -> str:
    return hashlib.sha256(_canonical_json_bytes(value)).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _artifact_descriptor(base: Path, path: Path) -> dict[str, Any]:
    return {
        "artifact": path.relative_to(base).as_posix(),
        "sha256": _sha256_file(path) if path.is_file() and not path.is_symlink() else None,
    }


def _load_live_cell():
    path = SCRIPT_DIR / "coc_eval_live_cell.py"
    spec = importlib.util.spec_from_file_location("coc_eval_longrun_live_cell", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _prepare_continuity_workspace(
    workspace: Path,
    *,
    required_anchors: list[str],
) -> dict[str, dict[str, str]]:
    if workspace.is_symlink():
        raise ValueError("continuity workspace must not be a symlink")
    if workspace.exists() and any(workspace.iterdir()):
        raise ValueError("continuity workspace must be new or empty")
    fixture_root = REPO_ROOT / "evaluation" / "spec" / "v1" / "fixtures" / "matrix"
    scenario = _read_json(fixture_root / "nightly-scenario.json")
    initial = _read_json(fixture_root / "nightly-initial-state.json")
    live_cell = _load_live_cell()
    _workspace, campaign_id, investigator_id = live_cell.materialize_workspace(
        _object(scenario, "continuity scenario fixture"),
        _object(initial, "continuity initial-state fixture"),
        workspace,
    )
    campaign = workspace / ".coc" / "campaigns" / campaign_id
    investigator = workspace / ".coc" / "investigators" / investigator_id
    investigator_state_path = (
        campaign / "save" / "investigator-state" / f"{investigator_id}.json"
    )
    investigator_state = _object(
        _read_json(investigator_state_path), "continuity investigator state"
    )
    conditions = investigator_state.get("conditions")
    if not isinstance(conditions, list) or any(
        not isinstance(item, str) for item in conditions
    ):
        raise ValueError("continuity investigator conditions must be string ids")
    injury_id = "injury-eval-archival-cut"
    if injury_id not in conditions:
        conditions.append(injury_id)
    investigator_state["conditions"] = conditions
    _write_json_atomic(investigator_state_path, investigator_state)

    world_path = campaign / "save" / "world-state.json"
    world = _object(_read_json(world_path), "continuity world state")
    discovered = world.get("discovered_clue_ids")
    if not isinstance(discovered, list) or any(
        not isinstance(item, str) for item in discovered
    ):
        raise ValueError("continuity discovered clues must be string ids")
    clue_id = "clue-latch-scratches"
    if clue_id not in discovered:
        discovered.append(clue_id)
    world["discovered_clue_ids"] = discovered
    _write_json_atomic(world_path, world)

    flags_path = campaign / "save" / "flags.json"
    flags = _object(_read_json(flags_path), "continuity flags state")
    clues_found = flags.get("clues_found")
    if not isinstance(clues_found, dict):
        raise ValueError("continuity clues_found must be an object")
    clues_found[clue_id] = True
    flags["clues_found"] = clues_found
    _write_json_atomic(flags_path, flags)

    npc_id = "npc-eval-archivist"
    npc_state_path = campaign / "save" / "npc-state.json"
    _write_json_atomic(
        npc_state_path,
        {
            "schema_version": 1,
            "npcs": {},
            "psych": {
                npc_id: {
                    "trust": 1,
                    "fear": 0,
                    "suspicion": 0,
                    "known_facts": [],
                    "lies_told": [],
                    "promises": [],
                    "revealable_facts": [],
                    "lie_options": [],
                    "deflect_options": [],
                    "deflections": [],
                    "leverage": [],
                    "active_reactions": [],
                    "availability": {"status": "available"},
                    "schedule": [],
                }
            },
        },
    )
    _write_jsonl_atomic(
        investigator / "inventory-history.jsonl",
        [
            {
                "schema_version": 1,
                "record_id": "inventory-record-eval-entry",
                "campaign_id": campaign_id,
                "items": ["item-eval-brass-token"],
            }
        ],
    )
    _write_jsonl_atomic(
        investigator / "history.jsonl",
        [
            {
                "schema_version": 1,
                "record_id": "history-record-eval-entry",
                "campaign_id": campaign_id,
                "type": "scenario_experience",
                "unresolved_threads": ["thread-eval-archive-access"],
            }
        ],
    )
    sources = {
        "inventory": {
            "source_path": (
                investigator / "inventory-history.jsonl"
            ).relative_to(workspace).as_posix(),
            "source_format": "jsonl",
            "json_pointer": "/0/items/0",
        },
        "injury": {
            "source_path": investigator_state_path.relative_to(workspace).as_posix(),
            "source_format": "json",
            "json_pointer": f"/conditions/{conditions.index(injury_id)}",
        },
        "san": {
            "source_path": investigator_state_path.relative_to(workspace).as_posix(),
            "source_format": "json",
            "json_pointer": "/current_san",
        },
        "relationship": {
            "source_path": npc_state_path.relative_to(workspace).as_posix(),
            "source_format": "json",
            "json_pointer": f"/psych/{npc_id}/trust",
        },
        "clue": {
            "source_path": world_path.relative_to(workspace).as_posix(),
            "source_format": "json",
            "json_pointer": f"/discovered_clue_ids/{discovered.index(clue_id)}",
        },
        "unresolved_thread": {
            "source_path": (
                investigator / "history.jsonl"
            ).relative_to(workspace).as_posix(),
            "source_format": "jsonl",
            "json_pointer": "/0/unresolved_threads/0",
        },
    }
    unsupported = sorted(set(required_anchors) - set(sources))
    if unsupported:
        raise ValueError(
            "no canonical structured state source for recall anchors: "
            + ", ".join(unsupported)
        )
    return {name: sources[name] for name in required_anchors}


def _json_pointer_value(payload: Any, pointer: str) -> Any:
    if not isinstance(pointer, str) or not pointer.startswith("/"):
        raise ValueError("recall anchor JSON pointer must start with /")
    current = payload
    for raw_part in pointer[1:].split("/"):
        part = raw_part.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict) and part in current:
            current = current[part]
        elif isinstance(current, list) and part.isdigit() and int(part) < len(current):
            current = current[int(part)]
        else:
            raise ValueError(f"recall anchor JSON pointer does not resolve: {pointer}")
    return current


def _observe_recall_anchors(
    workspace: Path, sources: dict[str, dict[str, str]]
) -> dict[str, dict[str, Any]]:
    observations: dict[str, dict[str, Any]] = {}
    for name, source in sources.items():
        relative = Path(source["source_path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("recall anchor source escaped continuity workspace")
        path = workspace / relative
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"recall anchor source missing or unsafe: {name}")
        source_text = path.read_text(encoding="utf-8")
        if source["source_format"] == "json":
            try:
                payload = json.loads(source_text)
            except json.JSONDecodeError as exc:
                raise ValueError(f"unreadable recall anchor JSON: {path}") from exc
        elif source["source_format"] == "jsonl":
            payload = []
            for number, line in enumerate(
                source_text.splitlines(), 1
            ):
                if not line.strip():
                    continue
                try:
                    payload.append(json.loads(line))
                except json.JSONDecodeError as exc:
                    raise ValueError(
                        f"unreadable recall anchor JSONL: {path}:{number}"
                    ) from exc
        else:
            raise ValueError(f"unsupported recall anchor source format: {name}")
        value = _json_pointer_value(payload, source["json_pointer"])
        value_sha256 = _sha256_json(value)
        identity = {
            "source_path": source["source_path"],
            "json_pointer": source["json_pointer"],
            "value_sha256": value_sha256,
        }
        observations[name] = {
            **source,
            "anchor_id": f"state:{_sha256_json(identity)}",
            "value_sha256": value_sha256,
            "_source_text": source_text,
        }
    return observations


def _write_recall_source_snapshots(
    lane_dir: Path,
    phase: str,
    observations: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    descriptors: dict[str, dict[str, Any]] = {}
    for name, observation in observations.items():
        suffix = ".jsonl" if observation["source_format"] == "jsonl" else ".json"
        path = _write_text_atomic(
            lane_dir / "artifacts" / "recall-sources" / phase / f"{name}{suffix}",
            observation["_source_text"],
        )
        descriptors[name] = _artifact_descriptor(lane_dir, path)
    return descriptors


def _run_segment(
    *,
    start_turn: int,
    turn_count: int,
    workspace: Path,
    output: Path,
    model_roles: dict[str, dict[str, str]],
) -> dict[str, Any]:
    """Execute one real continuity segment through the canonical live runner."""
    return _load_live_cell().run_live_segment(
        start_turn=start_turn,
        turn_count=turn_count,
        workspace=workspace,
        output=output,
        model_roles=model_roles,
    )


def _segment_attestation_matches(
    segment: dict[str, Any],
    model_roles: dict[str, dict[str, str]],
    logical_session_id: str,
) -> bool:
    attestation = segment.get("attestation")
    if not isinstance(attestation, dict):
        return False
    if (
        segment.get("evidence_class") == "external"
        and segment.get("logical_session_id") != logical_session_id
    ):
        return False
    attested = (
        attestation.get("attested") is True
        if segment.get("evidence_class") == "external"
        else attestation.get("attested", True) is True
    )
    return bool(
        attestation.get("player_model") == model_roles["player"]
        and attestation.get("kp_model") == model_roles["kp"]
        and attested
    )


def _local_artifact_descriptor(base: Path, path: Path) -> dict[str, Any]:
    return {
        "artifact": path.relative_to(base).as_posix(),
        "sha256": _sha256_file(path) if path.is_file() and not path.is_symlink() else None,
    }


def _materialize_fixture_segment_receipt(
    segment: dict[str, Any],
    *,
    index: int,
    segment_dir: Path,
    logical_session_id: str,
    roles: dict[str, dict[str, str]],
) -> dict[str, Any]:
    """Bind controlled fake-segment data without presenting it as external evidence."""
    segment_dir.mkdir(parents=True, exist_ok=True)
    invocation_id = segment.get("runner_invocation_id")
    if not isinstance(invocation_id, str) or not invocation_id.strip():
        invocation_id = f"fixture:{logical_session_id}:segment-{index}"
    ledger_path = _write_jsonl_atomic(
        segment_dir / "fixture-runner-invocations.jsonl",
        [
            {
                "schema_version": 1,
                "evidence_class": "fixture",
                "runner_invocation_id": invocation_id,
                "segment_id": index,
            }
        ],
    )
    checkpoint_path = _write_json_atomic(
        segment_dir / "fixture-checkpoint-observation.json",
        {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "evidence_class": "fixture",
            "reported_snapshot_sha256": segment.get("snapshot_sha256"),
        },
    )
    invocation_descriptor = _local_artifact_descriptor(segment_dir, ledger_path)
    checkpoint_descriptor = _local_artifact_descriptor(segment_dir, checkpoint_path)
    receipt = {
        **segment,
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "evidence_class": "fixture",
        "logical_session_id": logical_session_id,
        "runner_invocation_id": invocation_id,
        "runner_invocation_source": {
            "kind": "fixture",
            "field": "generated_fixture_id",
        },
        "attestation": {
            **(
                segment.get("attestation")
                if isinstance(segment.get("attestation"), dict)
                else {}
            ),
            "player_model": roles["player"],
            "kp_model": roles["kp"],
        },
        "secret_audit_passed": segment.get("secret_audit_passed", True) is True,
        "artifacts": {
            "invocation_ledger": invocation_descriptor,
            "checkpoint_resume": checkpoint_descriptor,
        },
    }
    _write_json_atomic(segment_dir / "continuity-segment.json", receipt)
    return receipt


def _lane_descriptor_from_segment(
    lane_dir: Path, segment_dir: Path, descriptor: Any
) -> dict[str, Any]:
    if not isinstance(descriptor, dict):
        return {"artifact": "", "sha256": None}
    artifact = descriptor.get("artifact")
    if not isinstance(artifact, str) or not artifact:
        return {"artifact": "", "sha256": descriptor.get("sha256")}
    relative = Path(artifact)
    if relative.is_absolute() or ".." in relative.parts:
        return {"artifact": "", "sha256": descriptor.get("sha256")}
    target = segment_dir / relative
    try:
        lane_relative = target.relative_to(lane_dir)
    except ValueError:
        return {"artifact": "", "sha256": descriptor.get("sha256")}
    return {
        "artifact": lane_relative.as_posix(),
        "sha256": descriptor.get("sha256"),
    }


def _lane_segment_record(
    segment: dict[str, Any],
    *,
    index: int,
    lane_dir: Path,
    segment_dir: Path,
) -> dict[str, Any]:
    artifacts = segment.get("artifacts")
    artifacts = artifacts if isinstance(artifacts, dict) else {}
    receipt_path = segment_dir / "continuity-segment.json"
    return {
        "segment_id": index,
        "logical_session_id": segment.get("logical_session_id"),
        "runner_invocation_id": segment.get("runner_invocation_id"),
        "accepted_turns": segment.get("accepted_turns"),
        "receipt": _artifact_descriptor(lane_dir, receipt_path),
        "invocation_ledger": _lane_descriptor_from_segment(
            lane_dir, segment_dir, artifacts.get("invocation_ledger")
        ),
        "checkpoint_manifest": _lane_descriptor_from_segment(
            lane_dir, segment_dir, artifacts.get("checkpoint_resume")
        ),
        "runner_metadata": _lane_descriptor_from_segment(
            lane_dir, segment_dir, artifacts.get("run_metadata")
        ),
        "checkpoint_snapshot_sha256": segment.get("snapshot_sha256"),
    }


def run_continuity_lane(
    *,
    lane: dict[str, Any],
    workspace: Path | str,
    output: Path | str,
    model_roles: dict[str, dict[str, str]],
) -> dict[str, Any]:
    """Execute a continuity lane in two process segments and validate its evidence."""
    lane = dict(_object(lane, "lane"))
    requirements = dict(_object(lane.get("requirements"), "lane.requirements"))
    lane_id = str(lane.get("lane_id") or "")
    if not lane_id:
        raise ValueError("lane.lane_id is required")
    turn_count = lane.get("turn_count")
    restart_at = lane.get("restart_at_turn")
    if (
        isinstance(turn_count, bool)
        or not isinstance(turn_count, int)
        or turn_count < 2
    ):
        raise ValueError("lane.turn_count must be an integer greater than one")
    if (
        isinstance(restart_at, bool)
        or not isinstance(restart_at, int)
        or restart_at < 1
        or restart_at >= turn_count
    ):
        raise ValueError("lane.restart_at_turn must split the requested turns")
    roles = {
        role: dict(_object(model_roles.get(role), f"model_roles.{role}"))
        for role in ("player", "kp")
    }
    workspace_path = Path(workspace).resolve()
    lane_dir = Path(output).resolve()
    lane_dir.mkdir(parents=True, exist_ok=True)
    segment_dirs = (
        lane_dir / "segments" / "segment-1",
        lane_dir / "segments" / "segment-2",
    )
    logical_session_id = f"eval-continuity:{lane_id}:{uuid.uuid4().hex}"
    required_anchors = [str(name) for name in requirements.get("recall_anchors") or []]
    anchor_sources = _prepare_continuity_workspace(
        workspace_path,
        required_anchors=required_anchors,
    )
    guard_path = workspace_path / ".coc" / "eval-continuity-restart.json"
    _write_json_atomic(
        guard_path,
        {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "session_id": logical_session_id,
            "expected_snapshot_sha256": None,
        },
    )

    first = _object(
        _run_segment(
            start_turn=1,
            turn_count=restart_at,
            workspace=workspace_path,
            output=segment_dirs[0],
            model_roles=roles,
        ),
        "first segment",
    )
    if first.get("evidence_class") != "external":
        first = _materialize_fixture_segment_receipt(
            first,
            index=1,
            segment_dir=segment_dirs[0],
            logical_session_id=logical_session_id,
            roles=roles,
        )
    anchors_before = _observe_recall_anchors(workspace_path, anchor_sources)
    before_source_artifacts = _write_recall_source_snapshots(
        lane_dir, "before-restart", anchors_before
    )
    _write_json_atomic(
        guard_path,
        {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "session_id": logical_session_id,
            "expected_snapshot_sha256": first.get("snapshot_sha256"),
        },
    )
    # Observe the resumed process inputs before starting the second model segment.
    # These are canonical state observations, not claims about model recollection.
    anchors_after = _observe_recall_anchors(workspace_path, anchor_sources)
    after_source_artifacts = _write_recall_source_snapshots(
        lane_dir, "after-restart", anchors_after
    )
    second = _object(
        _run_segment(
            start_turn=restart_at + 1,
            turn_count=turn_count - restart_at,
            workspace=workspace_path,
            output=segment_dirs[1],
            model_roles=roles,
        ),
        "second segment",
    )
    if second.get("evidence_class") != "external":
        second = _materialize_fixture_segment_receipt(
            second,
            index=2,
            segment_dir=segment_dirs[1],
            logical_session_id=logical_session_id,
            roles=roles,
        )
    expected_first = list(range(1, restart_at + 1))
    expected_second = list(range(restart_at + 1, turn_count + 1))
    if first.get("accepted_turns") != expected_first:
        raise ValueError("first segment did not accept the exact required turn range")
    if second.get("accepted_turns") != expected_second:
        raise ValueError("second segment did not accept the exact required turn range")

    pre_hash = first.get("snapshot_sha256")
    post_hash = second.get("snapshot_sha256")
    if not _is_sha256(pre_hash) or not _is_sha256(post_hash):
        raise ValueError("segments must report canonical snapshot sha256 values")
    segment_attested = all(
        _segment_attestation_matches(segment, roles, logical_session_id)
        for segment in (first, second)
    )
    exact_models = roles == EXPECTED_MODEL_ROLES
    attested = segment_attested and exact_models
    evidence_class = (
        "external"
        if any(segment.get("evidence_class") == "external" for segment in (first, second))
        else "fixture"
    )
    anchors_retained = all(
        anchors_after[name]["anchor_id"] == anchors_before[name]["anchor_id"]
        for name in required_anchors
    )
    recall_anchors = {
        name: {
            "anchor_id": anchors_before[name]["anchor_id"],
            "source_path": anchors_before[name]["source_path"],
            "source_format": anchors_before[name]["source_format"],
            "json_pointer": anchors_before[name]["json_pointer"],
            "before_value_sha256": anchors_before[name]["value_sha256"],
            "after_value_sha256": anchors_after[name]["value_sha256"],
            "before_source_artifact": before_source_artifacts[name],
            "after_source_artifact": after_source_artifacts[name],
            "present_before_restart": True,
            "present_after_restart": (
                anchors_after[name]["anchor_id"]
                == anchors_before[name]["anchor_id"]
            ),
            "observation_kind": "structured_state",
            "turn_ids": [restart_at, restart_at + 1],
        }
        for name in required_anchors
    }
    recall_path = _write_json_atomic(
        lane_dir / "artifacts" / "recall-anchors.json",
        {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "anchors": recall_anchors,
        },
    )
    segment_records = [
        _lane_segment_record(
            segment,
            index=index,
            lane_dir=lane_dir,
            segment_dir=segment_dirs[index - 1],
        )
        for index, segment in enumerate((first, second), 1)
    ]
    invocation_ids = [record.get("runner_invocation_id") for record in segment_records]
    external_sources_complete = evidence_class != "external" or bool(
        all(segment.get("evidence_class") == "external" for segment in (first, second))
        and all(
            isinstance(invocation_id, str) and invocation_id.strip()
            for invocation_id in invocation_ids
        )
        and len(set(invocation_ids)) == 2
        and all(
            record.get("logical_session_id") == logical_session_id
            and all(
                isinstance(record.get(field), dict)
                and _is_sha256(record[field].get("sha256"))
                for field in (
                    "receipt",
                    "invocation_ledger",
                    "checkpoint_manifest",
                    "runner_metadata",
                )
            )
            for record in segment_records
        )
    )
    audit_findings = []
    for index, (segment, record) in enumerate(
        zip((first, second), segment_records, strict=True), 1
    ):
        audit_passed = segment.get("secret_audit_passed") is True
        audit_findings.append(
            {
                "finding_id": f"secret-audit-segment-{index}",
                "status": "PASS" if audit_passed else "FAIL",
                "segment_id": index,
                "invocation_ledger_sha256": record["invocation_ledger"].get(
                    "sha256"
                ),
                "structured": True,
                "prose_scanned": False,
            }
        )
    secret_audit_passed = all(
        finding["status"] == "PASS" for finding in audit_findings
    )
    eligible = bool(
        attested
        and pre_hash == post_hash
        and anchors_retained
        and external_sources_complete
        and secret_audit_passed
    )
    secret_audit = {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "status": "PASS" if secret_audit_passed else "FAIL",
        "evidence_class": evidence_class,
        "findings": audit_findings,
    }
    audit_path = _write_json_atomic(
        lane_dir / "artifacts" / "secret-audit.json", secret_audit
    )
    evidence = {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "lane_id": lane_id,
        "evidence_class": evidence_class,
        "eligible": eligible,
        "session_id": logical_session_id,
        "accepted_turns": expected_first + expected_second,
        "turn_count": turn_count,
        "restart": {
            "at_turn": restart_at,
            "pre_checkpoint_sha256": pre_hash,
            "post_checkpoint_sha256": post_hash,
            "session_id_before": logical_session_id,
            "session_id_after": logical_session_id,
            "resumed": pre_hash == post_hash,
            "model_workers_restarted_between_segments": True,
            "logical_evaluation_session_continued": True,
            "model_conversation_session_continuity_claimed": False,
        },
        "recall_anchors": recall_anchors,
        "recall_anchor_receipt": _artifact_descriptor(lane_dir, recall_path),
        "attestation": {
            "player_model": roles["player"],
            "kp_model": roles["kp"],
            "runner": "coc_live_match.segmented",
            "attested": attested,
        },
        "session_scope": {
            "continued_identity": "logical_evaluation_session",
            "model_worker_sessions": "restarted_between_segments",
            "model_conversation_session_continuity": False,
        },
        "segments": segment_records,
        "secret_audit": {
            "status": secret_audit["status"],
            "references": [
                {
                    **_artifact_descriptor(lane_dir, audit_path),
                    "finding_id": finding["finding_id"],
                }
                for finding in audit_findings
            ],
        },
    }
    _write_json_atomic(lane_dir / CONTINUITY_EVIDENCE_FILE, evidence)
    validation = validate_continuity_run(lane_dir, requirements)
    status = validation["status"]
    if status == "PASS" and not exact_models:
        status = "INELIGIBLE"
    return {**evidence, "status": status, "validation": validation}


def _finding(
    *,
    code: str,
    severity: str,
    message: str,
    **extra: Any,
) -> dict[str, Any]:
    payload = {
        "code": code,
        "severity": severity,
        "message": message,
    }
    payload.update(extra)
    return payload


def _base_result(
    *,
    status: str,
    findings: list[dict[str, Any]],
    evidence_class: str | None = None,
    gameplay_evidence: bool | None = None,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if status not in STATUSES:
        raise ValueError(f"invalid status: {status}")
    result: dict[str, Any] = {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "status": status,
        "findings": findings,
        "metrics": metrics or {},
    }
    if evidence_class is not None:
        result["evidence_class"] = evidence_class
    if gameplay_evidence is not None:
        result["gameplay_evidence"] = gameplay_evidence
    return result


def _resolve_evidence_path(run_dir: Path, filename: str) -> Path | None:
    candidates = [
        run_dir / filename,
        run_dir / "artifacts" / filename,
    ]
    for path in candidates:
        if path.is_file():
            return path
    return None


def _is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(
        ch in "0123456789abcdef" for ch in value.lower()
    )


def _bound_artifact_path(
    run_dir: Path,
    descriptor: Any,
    label: str,
    findings: list[dict[str, Any]],
) -> Path | None:
    if not isinstance(descriptor, dict):
        findings.append(
            _finding(
                code=f"{label}_reference_invalid",
                severity="contradictory_evidence",
                message=f"{label} must be a hash-bound artifact descriptor",
            )
        )
        return None
    artifact = descriptor.get("artifact")
    expected_hash = descriptor.get("sha256")
    relative = Path(artifact) if isinstance(artifact, str) and artifact else None
    if (
        relative is None
        or relative.is_absolute()
        or ".." in relative.parts
        or not _is_sha256(expected_hash)
    ):
        findings.append(
            _finding(
                code=f"{label}_reference_invalid",
                severity="contradictory_evidence",
                message=f"{label} requires a safe relative path and sha256",
            )
        )
        return None
    candidate = run_dir / relative
    current = run_dir
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            findings.append(
                _finding(
                    code=f"{label}_reference_invalid",
                    severity="contradictory_evidence",
                    message=f"{label} must not traverse symlinks",
                )
            )
            return None
    if not candidate.is_file():
        findings.append(
            _finding(
                code=f"{label}_missing",
                severity="missing_evidence",
                message=f"bound {label} artifact is missing: {artifact}",
            )
        )
        return None
    try:
        candidate.resolve().relative_to(run_dir.resolve())
    except ValueError:
        findings.append(
            _finding(
                code=f"{label}_reference_invalid",
                severity="contradictory_evidence",
                message=f"{label} escaped the run directory",
            )
        )
        return None
    observed_hash = _sha256_file(candidate)
    if observed_hash != expected_hash:
        findings.append(
            _finding(
                code=f"{label}_hash_mismatch",
                severity="contradictory_evidence",
                message=f"bound {label} artifact hash does not match",
                expected=expected_hash,
                actual=observed_hash,
            )
        )
    return candidate


def _rebase_receipt_descriptor(
    run_dir: Path, receipt_path: Path, descriptor: Any
) -> dict[str, Any] | None:
    if not isinstance(descriptor, dict):
        return None
    artifact = descriptor.get("artifact")
    if not isinstance(artifact, str) or not artifact:
        return None
    relative = Path(artifact)
    if relative.is_absolute() or ".." in relative.parts:
        return None
    target = receipt_path.parent / relative
    try:
        lane_relative = target.relative_to(run_dir)
    except ValueError:
        return None
    return {
        "artifact": lane_relative.as_posix(),
        "sha256": descriptor.get("sha256"),
    }


def _checkpoint_manifest_file_hashes(
    payload: Any,
    *,
    segment_id: int,
    findings: list[dict[str, Any]],
) -> dict[str, str] | None:
    reasons: list[str] = []
    if not isinstance(payload, dict):
        reasons.append("manifest_not_object")
        payload = {}
    campaign_id = payload.get("campaign_id")
    investigator_id = payload.get("investigator_id")
    if (
        payload.get("schema_version") != 1
        or payload.get("eval_spec") != EVAL_SPEC
        or payload.get("kind") != "continuity-consumed-inputs"
    ):
        reasons.append("version_or_kind")
    if not isinstance(campaign_id, str) or not campaign_id:
        reasons.append("campaign_id")
        campaign_id = ""
    if not isinstance(investigator_id, str) or not investigator_id:
        reasons.append("investigator_id")
        investigator_id = ""
    campaign_root = f".coc/campaigns/{campaign_id}"
    expected_roots = {
        f"{campaign_root}/{name}": role
        for role, names in (
            ("mutable_campaign_state", ("save", "memory", "logs")),
            ("campaign_input", ("source", "scenario", "index")),
        )
        for name in names
    }
    roots = payload.get("roots")
    roots_by_path: dict[str, dict[str, Any]] = {}
    if not isinstance(roots, list):
        reasons.append("roots_not_list")
        roots = []
    for root in roots:
        if not isinstance(root, dict) or not isinstance(root.get("path"), str):
            reasons.append("root_record")
            continue
        root_path = root["path"]
        if root_path in roots_by_path:
            reasons.append("duplicate_root")
        roots_by_path[root_path] = root
        if (
            root_path not in expected_roots
            or root.get("role") != expected_roots.get(root_path)
            or not isinstance(root.get("present"), bool)
        ):
            reasons.append("root_contract")
    if set(roots_by_path) != set(expected_roots):
        reasons.append("root_coverage")
    if roots != sorted(
        roots,
        key=lambda item: str(item.get("path")) if isinstance(item, dict) else str(item),
    ):
        reasons.append("root_order")

    required_files = {
        f"{campaign_root}/campaign.json": ("campaign_config", True),
        f"{campaign_root}/party.json": ("campaign_config", None),
        ".coc/runtime.json": ("runtime_config", True),
        **{
            f".coc/investigators/{investigator_id}/{name}": (
                "investigator_state",
                None,
            )
            for name in (
                "creation.json",
                "character.json",
                "history.jsonl",
                "development.jsonl",
                "inventory-history.jsonl",
            )
        },
    }
    files = payload.get("files")
    files_by_path: dict[str, dict[str, Any]] = {}
    if not isinstance(files, list):
        reasons.append("files_not_list")
        files = []
    for record in files:
        if not isinstance(record, dict) or not isinstance(record.get("path"), str):
            reasons.append("file_record")
            continue
        file_path = record["path"]
        relative = Path(file_path)
        if relative.is_absolute() or ".." in relative.parts or file_path in files_by_path:
            reasons.append("file_path")
            continue
        files_by_path[file_path] = record
        expected_role = None
        required_presence: bool | None = None
        if file_path in required_files:
            expected_role, required_presence = required_files[file_path]
        else:
            for root_path, role in expected_roots.items():
                if file_path.startswith(f"{root_path}/"):
                    expected_role = role
                    if roots_by_path.get(root_path, {}).get("present") is not True:
                        reasons.append("file_under_absent_root")
                    break
        present = record.get("present")
        if expected_role is None or record.get("role") != expected_role:
            reasons.append("file_role_or_scope")
        if not isinstance(present, bool):
            reasons.append("file_presence")
        elif required_presence is True and present is not True:
            reasons.append("required_file_absent")
        if present is True and (
            not _is_sha256(record.get("sha256"))
            or isinstance(record.get("size"), bool)
            or not isinstance(record.get("size"), int)
            or record["size"] < 0
        ):
            reasons.append("present_file_receipt")
        if present is False and (
            "sha256" in record or "size" in record
        ):
            reasons.append("absent_file_receipt")
    if not set(required_files).issubset(files_by_path):
        reasons.append("required_file_records")
    if files != sorted(
        files,
        key=lambda item: str(item.get("path")) if isinstance(item, dict) else str(item),
    ):
        reasons.append("file_order")
    if payload.get("excluded_path_classes") != ["lock"]:
        reasons.append("excluded_path_classes")
    if reasons:
        findings.append(
            _finding(
                code="checkpoint_manifest_contract_invalid",
                severity="contradictory_evidence",
                message=f"segment {segment_id} checkpoint manifest violates the consumed-input contract",
                segment_id=segment_id,
                reasons=sorted(set(reasons)),
            )
        )
        return None
    return {
        path: record["sha256"]
        for path, record in files_by_path.items()
        if record.get("present") is True
    }


def _invocation_ledger_contract_ok(
    path: Path,
    *,
    segment_id: int,
    invocation_id: Any,
    accepted_turns: Any,
    attestation: Any,
    findings: list[dict[str, Any]],
) -> None:
    reasons: list[str] = []
    rows: list[dict[str, Any]] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            reasons.append(f"malformed_row:{number}")
            continue
        if not isinstance(row, dict):
            reasons.append(f"non_object_row:{number}")
            continue
        rows.append(row)
    if not isinstance(attestation, dict):
        attestation = {}
    expected_turns = (
        set(accepted_turns)
        if isinstance(accepted_turns, list)
        and all(isinstance(turn, int) and not isinstance(turn, bool) for turn in accepted_turns)
        else set()
    )
    runner_paths = {
        "player": REPO_ROOT / "runtime" / "adapters" / "player" / "run_player_turn.mjs",
        "narrator": REPO_ROOT
        / "runtime"
        / "adapters"
        / "narrator"
        / "run_narration.mjs",
    }
    models = {
        "player": attestation.get("player_model"),
        "narrator": attestation.get("kp_model"),
    }
    turns_by_role: dict[str, set[int]] = {"player": set(), "narrator": set()}
    audit_validator = _load_live_cell().live_match.secret_audit.validate_audit_receipt
    for row in rows:
        role = row.get("role")
        if role not in runner_paths:
            reasons.append("unknown_role")
            continue
        runner_path = runner_paths[role]
        transcript_turn = row.get("transcript_turn")
        if isinstance(transcript_turn, int) and not isinstance(transcript_turn, bool):
            turns_by_role[role].add(transcript_turn)
        if (
            row.get("schema_version") != 1
            or row.get("segment_invocation_id") != invocation_id
            or row.get("runner_kind") != "external_model_bridge"
            or not isinstance(row.get("runner_identity"), str)
            or not row["runner_identity"].strip()
            or Path(str(row.get("runner_path") or "")).resolve()
            != runner_path.resolve()
            or row.get("runner_sha256") != _sha256_file(runner_path)
            or row.get("model_identity") != models[role]
            or row.get("outcome") != "external_success"
            or transcript_turn not in expected_turns
        ):
            reasons.append(f"row_contract:{role}")
        if role == "narrator":
            audit = audit_validator(row.get("secret_audit"))
            if not audit.get("valid") or not audit.get("passed"):
                reasons.append("narrator_secret_audit")
    for role in ("player", "narrator"):
        if not turns_by_role[role]:
            reasons.append(f"role_missing:{role}")
    if not rows:
        reasons.append("empty")
    if reasons:
        findings.append(
            _finding(
                code="invocation_ledger_contract_invalid",
                severity="contradictory_evidence",
                message=f"segment {segment_id} invocation ledger lacks canonical external provenance",
                segment_id=segment_id,
                reasons=sorted(set(reasons)),
            )
        )


def _continuity_recall_receipt_ok(
    run_dir: Path,
    evidence: dict[str, Any],
    evidence_class: str | None,
    checkpoint_files: list[dict[str, str]] | None,
    findings: list[dict[str, Any]],
) -> None:
    anchors = evidence.get("recall_anchors")
    path = _bound_artifact_path(
        run_dir,
        evidence.get("recall_anchor_receipt"),
        "recall_anchor_receipt",
        findings,
    )
    if path is not None:
        try:
            receipt = _object(_read_json(path), "recall anchor receipt")
        except ValueError as exc:
            findings.append(
                _finding(
                    code="recall_anchor_receipt_invalid",
                    severity="contradictory_evidence",
                    message=str(exc),
                )
            )
        else:
            if (
                receipt.get("schema_version") != 1
                or receipt.get("eval_spec") != EVAL_SPEC
                or receipt.get("anchors") != anchors
            ):
                findings.append(
                    _finding(
                        code="recall_anchor_receipt_mismatch",
                        severity="contradictory_evidence",
                        message="recall anchor receipt must exactly bind top-level anchors",
                    )
                )
    if evidence_class != "external" or not isinstance(anchors, dict):
        return
    for name, anchor in anchors.items():
        if not isinstance(anchor, dict):
            continue
        state_id = anchor.get("anchor_id")
        before = anchor.get("before_value_sha256")
        after = anchor.get("after_value_sha256")
        source_path = anchor.get("source_path")
        pointer = anchor.get("json_pointer")
        source_format = anchor.get("source_format")
        concrete = bool(
            isinstance(state_id, str)
            and state_id.startswith("state:")
            and _is_sha256(state_id.removeprefix("state:"))
            and _is_sha256(before)
            and _is_sha256(after)
            and before == after
            and isinstance(source_path, str)
            and source_path
            and not Path(source_path).is_absolute()
            and ".." not in Path(source_path).parts
            and isinstance(pointer, str)
            and pointer.startswith("/")
            and source_format in {"json", "jsonl"}
            and anchor.get("observation_kind") == "structured_state"
            and "model_observed" not in anchor
        )
        if not concrete:
            findings.append(
                _finding(
                    code="external_recall_anchor_not_concrete",
                    severity="contradictory_evidence",
                    message=f"external recall anchor {name} lacks concrete structured-state evidence",
                    anchor=name,
                )
            )
            continue
        source_bound = bool(
            isinstance(checkpoint_files, list) and len(checkpoint_files) == 2
        )
        for phase_index, phase in enumerate(("before", "after")):
            descriptor = anchor.get(f"{phase}_source_artifact")
            source_artifact = _bound_artifact_path(
                run_dir,
                descriptor,
                "recall_anchor_source",
                findings,
            )
            checkpoint_hash = (
                checkpoint_files[phase_index].get(source_path)
                if source_bound and checkpoint_files is not None
                else None
            )
            descriptor_hash = (
                descriptor.get("sha256") if isinstance(descriptor, dict) else None
            )
            if (
                source_artifact is None
                or not _is_sha256(checkpoint_hash)
                or descriptor_hash != checkpoint_hash
            ):
                source_bound = False
                continue
            try:
                if source_format == "json":
                    source_payload = _read_json(source_artifact)
                else:
                    source_payload = [
                        json.loads(line)
                        for line in source_artifact.read_text(
                            encoding="utf-8"
                        ).splitlines()
                        if line.strip()
                    ]
                observed_value = _json_pointer_value(source_payload, pointer)
            except (ValueError, json.JSONDecodeError):
                source_bound = False
                continue
            expected_value_hash = anchor.get(f"{phase}_value_sha256")
            if _sha256_json(observed_value) != expected_value_hash:
                source_bound = False
        expected_identity = {
            "source_path": source_path,
            "json_pointer": pointer,
            "value_sha256": before,
        }
        if anchor.get("anchor_id") != f"state:{_sha256_json(expected_identity)}":
            source_bound = False
        if not source_bound:
            findings.append(
                _finding(
                    code="external_recall_anchor_source_unbound",
                    severity="contradictory_evidence",
                    message=f"external recall anchor {name} is not bound to both checkpoint source files",
                    anchor=name,
                )
            )


def _continuity_external_segments_ok(
    run_dir: Path,
    evidence: dict[str, Any],
    findings: list[dict[str, Any]],
) -> tuple[set[str], list[dict[str, str]]]:
    segments = evidence.get("segments")
    if not isinstance(segments, list) or len(segments) != 2:
        findings.append(
            _finding(
                code="external_segments_invalid",
                severity="contradictory_evidence",
                message="external continuity evidence requires exactly two segment receipts",
            )
        )
        return set(), [{}, {}]
    session_id = evidence.get("session_id")
    restart = evidence.get("restart") if isinstance(evidence.get("restart"), dict) else {}
    restart_at = restart.get("at_turn")
    turn_count = evidence.get("turn_count")
    expected_segment_turns = (
        (
            list(range(1, restart_at + 1)),
            list(range(restart_at + 1, turn_count + 1)),
        )
        if isinstance(restart_at, int)
        and not isinstance(restart_at, bool)
        and isinstance(turn_count, int)
        and not isinstance(turn_count, bool)
        else ([], [])
    )
    top_attestation = evidence.get("attestation")
    invocation_ids: list[str] = []
    ledger_hashes: set[str] = set()
    checkpoint_files: list[dict[str, str]] = [{}, {}]
    observed_turns: list[int] = []
    for index, segment in enumerate(segments, 1):
        if not isinstance(segment, dict):
            findings.append(
                _finding(
                    code="external_segment_invalid",
                    severity="contradictory_evidence",
                    message=f"segments[{index - 1}] must be an object",
                )
            )
            continue
        invocation_id = segment.get("runner_invocation_id")
        if not isinstance(invocation_id, str) or not invocation_id.strip():
            findings.append(
                _finding(
                    code="external_runner_invocation_id_missing",
                    severity="contradictory_evidence",
                    message=f"external segment {index} requires a source invocation id",
                    segment_id=index,
                )
            )
        else:
            invocation_ids.append(invocation_id)
        if segment.get("segment_id") != index:
            findings.append(
                _finding(
                    code="external_segment_order_invalid",
                    severity="contradictory_evidence",
                    message="external segment ids must be 1 then 2",
                )
            )
        if segment.get("logical_session_id") != session_id:
            findings.append(
                _finding(
                    code="external_segment_session_mismatch",
                    severity="contradictory_evidence",
                    message=f"external segment {index} does not bind the logical evaluation session",
                )
            )
        accepted_turns = segment.get("accepted_turns")
        if isinstance(accepted_turns, list) and all(
            isinstance(turn, int) and not isinstance(turn, bool)
            for turn in accepted_turns
        ):
            observed_turns.extend(accepted_turns)
            if accepted_turns != expected_segment_turns[index - 1]:
                findings.append(
                    _finding(
                        code="accepted_turn_range_mismatch",
                        severity="contradictory_evidence",
                        message=f"external segment {index} does not cover its exact required turn range",
                        segment_id=index,
                    )
                )
        else:
            findings.append(
                _finding(
                    code="external_segment_turns_invalid",
                    severity="contradictory_evidence",
                    message=f"external segment {index} accepted_turns are invalid",
                )
            )

        receipt_path = _bound_artifact_path(
            run_dir, segment.get("receipt"), "segment_receipt", findings
        )
        ledger_path = _bound_artifact_path(
            run_dir,
            segment.get("invocation_ledger"),
            "invocation_ledger",
            findings,
        )
        checkpoint_path = _bound_artifact_path(
            run_dir,
            segment.get("checkpoint_manifest"),
            "checkpoint_manifest",
            findings,
        )
        metadata_path = _bound_artifact_path(
            run_dir,
            segment.get("runner_metadata"),
            "runner_metadata",
            findings,
        )
        ledger_descriptor = segment.get("invocation_ledger")
        if isinstance(ledger_descriptor, dict) and _is_sha256(
            ledger_descriptor.get("sha256")
        ):
            ledger_hashes.add(ledger_descriptor["sha256"])
        if ledger_path is not None and not ledger_path.read_text(
            encoding="utf-8"
        ).strip():
            findings.append(
                _finding(
                    code="invocation_ledger_empty",
                    severity="contradictory_evidence",
                    message=f"external segment {index} invocation ledger is empty",
                )
            )
        if ledger_path is not None:
            _invocation_ledger_contract_ok(
                ledger_path,
                segment_id=index,
                invocation_id=invocation_id,
                accepted_turns=accepted_turns,
                attestation=top_attestation,
                findings=findings,
            )

        receipt: dict[str, Any] | None = None
        if receipt_path is not None:
            try:
                receipt = _object(_read_json(receipt_path), "segment receipt")
            except ValueError as exc:
                findings.append(
                    _finding(
                        code="segment_receipt_invalid",
                        severity="contradictory_evidence",
                        message=str(exc),
                    )
                )
        if receipt is not None:
            source = receipt.get("runner_invocation_source")
            if (
                receipt.get("evidence_class") != "external"
                or receipt.get("logical_session_id") != session_id
                or receipt.get("runner_invocation_id") != invocation_id
                or receipt.get("accepted_turns") != accepted_turns
            ):
                findings.append(
                    _finding(
                        code="segment_receipt_mismatch",
                        severity="contradictory_evidence",
                        message=f"external segment {index} does not match its bound receipt",
                    )
                )
            if not (
                isinstance(source, dict)
                and source.get("kind") == "live_match_metadata"
                and source.get("json_pointer") == "/metadata/run_id"
                and _rebase_receipt_descriptor(
                    run_dir, receipt_path, source.get("artifact")
                )
                == segment.get("runner_metadata")
            ):
                findings.append(
                    _finding(
                        code="external_runner_invocation_id_source_missing",
                        severity="contradictory_evidence",
                        message=f"external segment {index} invocation id lacks its source field",
                    )
                )
            elif metadata_path is not None:
                metadata_receipt: dict[str, Any] = {}
                try:
                    metadata_receipt = _object(
                        _read_json(metadata_path), "runner metadata receipt"
                    )
                    metadata_invocation_id = _json_pointer_value(
                        metadata_receipt, source["json_pointer"]
                    )
                except ValueError:
                    metadata_invocation_id = None
                if (
                    metadata_receipt.get("schema_version") != 1
                    or metadata_receipt.get("eval_spec") != EVAL_SPEC
                    or metadata_receipt.get("source")
                    != "live_match.result.metadata"
                    or metadata_invocation_id != invocation_id
                ):
                    findings.append(
                        _finding(
                            code="external_runner_invocation_metadata_mismatch",
                            severity="contradictory_evidence",
                            message=f"external segment {index} invocation id is not present in bound live-match metadata",
                        )
                    )
            receipt_artifacts = receipt.get("artifacts")
            if not isinstance(receipt_artifacts, dict) or (
                _rebase_receipt_descriptor(
                    run_dir,
                    receipt_path,
                    receipt_artifacts.get("invocation_ledger")
                )
                != ledger_descriptor
                or _rebase_receipt_descriptor(
                    run_dir,
                    receipt_path,
                    receipt_artifacts.get("checkpoint_resume")
                )
                != segment.get("checkpoint_manifest")
                or _rebase_receipt_descriptor(
                    run_dir,
                    receipt_path,
                    receipt_artifacts.get("run_metadata")
                )
                != segment.get("runner_metadata")
            ):
                findings.append(
                    _finding(
                        code="segment_receipt_artifact_mismatch",
                        severity="contradictory_evidence",
                        message=f"external segment {index} artifact bindings differ from its receipt",
                    )
                )
            receipt_attestation = receipt.get("attestation")
            if not isinstance(receipt_attestation, dict) or not isinstance(
                top_attestation, dict
            ) or any(
                receipt_attestation.get(role) != top_attestation.get(role)
                for role in ("player_model", "kp_model")
            ):
                findings.append(
                    _finding(
                        code="segment_receipt_attestation_mismatch",
                        severity="contradictory_evidence",
                        message=f"external segment {index} model attestation is inconsistent",
                    )
                )

        checkpoint_snapshot = segment.get("checkpoint_snapshot_sha256")
        expected_checkpoint = restart.get(
            "pre_checkpoint_sha256" if index == 1 else "post_checkpoint_sha256"
        )
        if checkpoint_snapshot != expected_checkpoint or not _is_sha256(
            checkpoint_snapshot
        ):
            findings.append(
                _finding(
                    code="segment_checkpoint_snapshot_mismatch",
                    severity="contradictory_evidence",
                    message=f"external segment {index} checkpoint does not bind restart evidence",
                )
            )
        if receipt is not None and receipt.get("snapshot_sha256") != checkpoint_snapshot:
            findings.append(
                _finding(
                    code="segment_checkpoint_snapshot_mismatch",
                    severity="contradictory_evidence",
                    message=f"external segment {index} receipt reports another checkpoint",
                )
            )
        if checkpoint_path is not None:
            try:
                checkpoint_payload = _read_json(checkpoint_path)
            except ValueError as exc:
                findings.append(
                    _finding(
                        code="checkpoint_manifest_invalid",
                        severity="contradictory_evidence",
                        message=str(exc),
                    )
                )
            else:
                if _sha256_json(checkpoint_payload) != checkpoint_snapshot:
                    findings.append(
                        _finding(
                            code="checkpoint_manifest_snapshot_mismatch",
                            severity="contradictory_evidence",
                            message=f"external segment {index} manifest content does not match snapshot hash",
                        )
                    )
                file_hashes = _checkpoint_manifest_file_hashes(
                    checkpoint_payload,
                    segment_id=index,
                    findings=findings,
                )
                if file_hashes is not None:
                    checkpoint_files[index - 1] = file_hashes
    if len(invocation_ids) != len(set(invocation_ids)):
        findings.append(
            _finding(
                code="external_runner_invocation_id_duplicate",
                severity="contradictory_evidence",
                message="external segment runner invocation ids must be distinct",
            )
        )
    if observed_turns != evidence.get("accepted_turns"):
        findings.append(
            _finding(
                code="external_segment_turns_mismatch",
                severity="contradictory_evidence",
                message="external segment turn ranges do not compose the top-level accepted turns",
            )
        )
    return ledger_hashes, checkpoint_files


def _continuity_secret_audit_ok(
    run_dir: Path,
    evidence: dict[str, Any],
    evidence_class: str | None,
    ledger_hashes: set[str],
    findings: list[dict[str, Any]],
) -> None:
    _secret_audit_ok(evidence, findings)
    audit = evidence.get("secret_audit")
    if not isinstance(audit, dict):
        return
    references = audit.get("references")
    if not isinstance(references, list):
        return
    referenced_ids: set[str] = set()
    artifact_finding_ids: set[str] = set()
    for reference in references:
        if not isinstance(reference, dict):
            continue
        finding_id = reference.get("finding_id")
        path = _bound_artifact_path(
            run_dir, reference, "secret_audit_artifact", findings
        )
        if not isinstance(finding_id, str) or not finding_id or path is None:
            continue
        referenced_ids.add(finding_id)
        try:
            payload = _object(_read_json(path), "secret audit artifact")
        except ValueError as exc:
            findings.append(
                _finding(
                    code="secret_audit_artifact_invalid",
                    severity="contradictory_evidence",
                    message=str(exc),
                )
            )
            continue
        artifact_findings = payload.get("findings")
        if not isinstance(artifact_findings, list):
            findings.append(
                _finding(
                    code="secret_audit_findings_missing",
                    severity="contradictory_evidence",
                    message="secret audit artifact requires structured findings",
                )
            )
            continue
        by_id = {
            item.get("finding_id"): item
            for item in artifact_findings
            if isinstance(item, dict) and isinstance(item.get("finding_id"), str)
        }
        artifact_finding_ids.update(by_id)
        finding = by_id.get(finding_id)
        if finding is None:
            findings.append(
                _finding(
                    code="secret_audit_finding_missing",
                    severity="contradictory_evidence",
                    message=f"secret audit finding does not exist: {finding_id}",
                )
            )
            continue
        if finding.get("status") != "PASS" or finding.get("prose_scanned") is not False:
            findings.append(
                _finding(
                    code="secret_audit_finding_failed",
                    severity="contradictory_evidence",
                    message=f"secret audit finding is not a structured PASS: {finding_id}",
                )
            )
        if evidence_class == "external" and finding.get(
            "invocation_ledger_sha256"
        ) not in ledger_hashes:
            findings.append(
                _finding(
                    code="secret_audit_ledger_unbound",
                    severity="contradictory_evidence",
                    message=f"secret audit finding is not bound to a segment ledger: {finding_id}",
                )
            )
    if artifact_finding_ids != referenced_ids:
        findings.append(
            _finding(
                code="secret_audit_finding_set_mismatch",
                severity="contradictory_evidence",
                message="every secret audit finding must have one hash-bound reference",
            )
        )


def _secret_audit_ok(evidence: dict[str, Any], findings: list[dict[str, Any]]) -> None:
    audit = evidence.get("secret_audit")
    if not isinstance(audit, dict):
        findings.append(
            _finding(
                code="secret_audit_missing",
                severity="contradictory_evidence",
                message="structured secret_audit object is required",
            )
        )
        return
    references = audit.get("references")
    if not isinstance(references, list) or not references:
        findings.append(
            _finding(
                code="secret_audit_references_missing",
                severity="contradictory_evidence",
                message="secret_audit.references must be a non-empty structured list",
            )
        )
        return
    for index, item in enumerate(references):
        if not isinstance(item, dict):
            findings.append(
                _finding(
                    code="secret_audit_reference_invalid",
                    severity="contradictory_evidence",
                    message=f"secret_audit.references[{index}] must be an object",
                )
            )
            continue
        if not isinstance(item.get("artifact"), str) or not item.get("artifact"):
            findings.append(
                _finding(
                    code="secret_audit_reference_invalid",
                    severity="contradictory_evidence",
                    message=f"secret_audit.references[{index}].artifact required",
                )
            )
        if not isinstance(item.get("finding_id"), str) or not item.get("finding_id"):
            findings.append(
                _finding(
                    code="secret_audit_reference_invalid",
                    severity="contradictory_evidence",
                    message=f"secret_audit.references[{index}].finding_id required",
                )
            )
    status = audit.get("status")
    if status not in {"PASS", "FAIL"}:
        findings.append(
            _finding(
                code="secret_audit_status_invalid",
                severity="contradictory_evidence",
                message="secret_audit.status must be PASS or FAIL",
            )
        )
    elif status == "FAIL":
        findings.append(
            _finding(
                code="secret_audit_failed",
                severity="contradictory_evidence",
                message="structured secret audit recorded FAIL",
            )
        )


def _eligibility_fields(
    evidence: dict[str, Any],
    requirements: dict[str, Any],
    findings: list[dict[str, Any]],
) -> tuple[str | None, bool | None]:
    required = (requirements.get("evidence_eligibility") or {}).get("required_fields") or []
    for field in required:
        if field not in evidence:
            findings.append(
                _finding(
                    code="eligibility_field_missing",
                    severity="contradictory_evidence",
                    message=f"missing eligibility field: {field}",
                    field=field,
                )
            )
    evidence_class = evidence.get("evidence_class")
    if evidence_class not in EVIDENCE_CLASSES:
        findings.append(
            _finding(
                code="evidence_class_invalid",
                severity="contradictory_evidence",
                message="evidence_class must be fixture or external",
            )
        )
        evidence_class = None
    eligible = evidence.get("eligible")
    if not isinstance(eligible, bool):
        findings.append(
            _finding(
                code="eligible_flag_invalid",
                severity="contradictory_evidence",
                message="eligible must be a boolean",
            )
        )
        eligible = None
    return evidence_class, eligible


def _attestation_present(attestation: Any) -> bool:
    if not isinstance(attestation, dict) or not attestation:
        return False
    player = attestation.get("player_model")
    kp = attestation.get("kp_model")
    runner = attestation.get("runner")
    attested = attestation.get("attested")
    if not isinstance(player, dict) or not player.get("id"):
        return False
    if not isinstance(kp, dict) or not kp.get("id"):
        return False
    if not isinstance(runner, str) or not runner:
        return False
    if attested is not True:
        return False
    return True


def validate_continuity_run(
    run_dir: Path | str,
    requirements: dict[str, Any],
) -> dict[str, Any]:
    """Validate structured continuity evidence against lane requirements."""
    if not isinstance(requirements, dict):
        raise ValueError("requirements must be an object")
    path = Path(run_dir)
    findings: list[dict[str, Any]] = []

    if not path.exists() or not path.is_dir():
        findings.append(
            _finding(
                code="run_dir_missing",
                severity="missing_evidence",
                message=f"run directory missing: {path}",
            )
        )
        return _base_result(status="NOT_RUN", findings=findings)

    evidence_path = _resolve_evidence_path(path, CONTINUITY_EVIDENCE_FILE)
    if evidence_path is None:
        findings.append(
            _finding(
                code="continuity_evidence_missing",
                severity="missing_evidence",
                message=f"{CONTINUITY_EVIDENCE_FILE} not found under run_dir",
            )
        )
        return _base_result(status="NOT_RUN", findings=findings)

    try:
        evidence = _read_json(evidence_path)
    except ValueError as exc:
        findings.append(
            _finding(
                code="continuity_evidence_unreadable",
                severity="missing_evidence",
                message=str(exc),
            )
        )
        return _base_result(status="NOT_RUN", findings=findings)

    if not isinstance(evidence, dict):
        findings.append(
            _finding(
                code="continuity_evidence_invalid",
                severity="contradictory_evidence",
                message="continuity evidence must be a JSON object",
            )
        )
        return _base_result(status="FAIL", findings=findings)

    if evidence.get("schema_version") != 1 or evidence.get("eval_spec") != EVAL_SPEC:
        findings.append(
            _finding(
                code="continuity_evidence_version_mismatch",
                severity="contradictory_evidence",
                message="continuity evidence must declare schema_version=1 and eval-spec-v1",
            )
        )

    evidence_class, eligible = _eligibility_fields(evidence, requirements, findings)

    # External lanes that executed without attestation are INELIGIBLE.
    if evidence_class == "external" and not _attestation_present(evidence.get("attestation")):
        findings.append(
            _finding(
                code="external_attestation_missing",
                severity="ineligible",
                message="external continuity lane requires runner/model attestation",
            )
        )
        return _base_result(
            status="INELIGIBLE",
            findings=findings,
            evidence_class=evidence_class,
            gameplay_evidence=False,
        )
    if evidence_class == "external":
        attestation = evidence.get("attestation")
        if not isinstance(attestation, dict) or any(
            attestation.get(field) != EXPECTED_MODEL_ROLES[role]
            for field, role in (("player_model", "player"), ("kp_model", "kp"))
        ):
            findings.append(
                _finding(
                    code="external_model_identity_mismatch",
                    severity="contradictory_evidence",
                    message="external continuity evidence requires the GLM/Luna model roles",
                )
            )

    expected_turns = requirements.get("turn_count")
    accepted = evidence.get("accepted_turns")
    reported_count = evidence.get("turn_count")
    if not isinstance(accepted, list) or not all(isinstance(item, int) for item in accepted):
        findings.append(
            _finding(
                code="accepted_turns_invalid",
                severity="contradictory_evidence",
                message="accepted_turns must be a list of integers",
            )
        )
        accepted = []
    if expected_turns is not None and (
        reported_count != expected_turns or len(accepted) != expected_turns
    ):
        findings.append(
            _finding(
                code="turn_count_mismatch",
                severity="contradictory_evidence",
                message=(
                    f"expected turn_count={expected_turns}, "
                    f"got turn_count={reported_count} accepted={len(accepted)}"
                ),
                expected=expected_turns,
                actual_turn_count=reported_count,
                actual_accepted_count=len(accepted),
            )
        )
    if (
        isinstance(expected_turns, int)
        and not isinstance(expected_turns, bool)
        and accepted
        and accepted != list(range(1, expected_turns + 1))
    ):
        findings.append(
            _finding(
                code="accepted_turn_range_mismatch",
                severity="contradictory_evidence",
                message="accepted_turns must be the exact range 1..turn_count",
            )
        )

    accepted_req = requirements.get("accepted_turns") or {}
    if accepted_req.get("monotonic") and accepted:
        if accepted != sorted(accepted) or len(accepted) != len(set(accepted)):
            findings.append(
                _finding(
                    code="accepted_turns_not_monotonic",
                    severity="contradictory_evidence",
                    message="accepted_turns must be strictly increasing unique turn ids",
                )
            )

    restart_req = requirements.get("restart") or {}
    restart = evidence.get("restart")
    if restart_req.get("required"):
        if not isinstance(restart, dict):
            findings.append(
                _finding(
                    code="restart_evidence_missing",
                    severity="contradictory_evidence",
                    message="restart evidence object is required",
                )
            )
            restart = {}
        expected_at = restart_req.get("at_turn")
        if expected_at is not None and restart.get("at_turn") != expected_at:
            findings.append(
                _finding(
                    code="restart_turn_mismatch",
                    severity="contradictory_evidence",
                    message=f"restart.at_turn must be {expected_at}",
                    expected=expected_at,
                    actual=restart.get("at_turn"),
                )
            )
        if restart_req.get("require_pre_checkpoint_sha256") and not _is_sha256(
            restart.get("pre_checkpoint_sha256")
        ):
            findings.append(
                _finding(
                    code="pre_checkpoint_hash_missing",
                    severity="contradictory_evidence",
                    message="restart.pre_checkpoint_sha256 must be a sha256 hex digest",
                )
            )
        if restart_req.get("require_post_checkpoint_sha256") and not _is_sha256(
            restart.get("post_checkpoint_sha256")
        ):
            findings.append(
                _finding(
                    code="post_checkpoint_hash_missing",
                    severity="contradictory_evidence",
                    message="restart.post_checkpoint_sha256 must be a sha256 hex digest",
                )
            )
        if (requirements.get("checkpoint_integrity") or {}).get(
            "pre_post_hash_match_required"
        ):
            pre_hash = restart.get("pre_checkpoint_sha256")
            post_hash = restart.get("post_checkpoint_sha256")
            if _is_sha256(pre_hash) and _is_sha256(post_hash) and pre_hash != post_hash:
                findings.append(
                    _finding(
                        code="checkpoint_hash_mismatch",
                        severity="contradictory_evidence",
                        message="pre/post checkpoint hashes must match for continuity resume",
                    )
                )
        if restart_req.get("require_session_identity_continuity"):
            before = restart.get("session_id_before")
            after = restart.get("session_id_after")
            session_id = evidence.get("session_id")
            if not before or not after or before != after:
                findings.append(
                    _finding(
                        code="session_identity_broken",
                        severity="contradictory_evidence",
                        message="session identity must continue across restart",
                    )
                )
            elif session_id and session_id != after:
                findings.append(
                    _finding(
                        code="session_identity_broken",
                        severity="contradictory_evidence",
                        message="top-level session_id must match restart session identity",
                    )
                )
        if restart.get("resumed") is not True:
            findings.append(
                _finding(
                    code="restart_not_resumed",
                    severity="contradictory_evidence",
                    message="restart.resumed must be true",
                )
            )
        if evidence_class == "external" and not (
            restart.get("model_workers_restarted_between_segments") is True
            and restart.get("logical_evaluation_session_continued") is True
            and restart.get("model_conversation_session_continuity_claimed") is False
        ):
            findings.append(
                _finding(
                    code="restart_session_scope_invalid",
                    severity="contradictory_evidence",
                    message=(
                        "restart evidence must distinguish restarted model workers "
                        "from the continued logical evaluation session"
                    ),
                )
            )

    anchors = evidence.get("recall_anchors")
    if not isinstance(anchors, dict):
        anchors = {}
        findings.append(
            _finding(
                code="recall_anchors_missing",
                severity="contradictory_evidence",
                message="recall_anchors object is required",
            )
        )
    for anchor_name in requirements.get("recall_anchors") or []:
        anchor = anchors.get(anchor_name)
        if not isinstance(anchor, dict):
            findings.append(
                _finding(
                    code="recall_anchor_missing",
                    severity="contradictory_evidence",
                    message=f"missing recall anchor: {anchor_name}",
                    anchor=anchor_name,
                )
            )
            continue
        if not anchor.get("anchor_id"):
            findings.append(
                _finding(
                    code="recall_anchor_incomplete",
                    severity="contradictory_evidence",
                    message=f"recall anchor {anchor_name} missing anchor_id",
                    anchor=anchor_name,
                )
            )
        if anchor.get("present_before_restart") is not True or (
            anchor.get("present_after_restart") is not True
        ):
            findings.append(
                _finding(
                    code="recall_anchor_not_retained",
                    severity="contradictory_evidence",
                    message=f"recall anchor {anchor_name} not retained across restart",
                    anchor=anchor_name,
                )
            )

    ledger_hashes: set[str] = set()
    checkpoint_files: list[dict[str, str]] | None = None
    if evidence_class == "external":
        ledger_hashes, checkpoint_files = _continuity_external_segments_ok(
            path, evidence, findings
        )
    _continuity_recall_receipt_ok(
        path, evidence, evidence_class, checkpoint_files, findings
    )

    if (requirements.get("secret_leakage_audit") or {}).get("required"):
        _continuity_secret_audit_ok(
            path, evidence, evidence_class, ledger_hashes, findings
        )

    if eligible is False:
        findings.append(
            _finding(
                code="evidence_marked_ineligible",
                severity="ineligible",
                message="evidence.eligible is false",
            )
        )
        return _base_result(
            status="INELIGIBLE",
            findings=findings,
            evidence_class=evidence_class,
            gameplay_evidence=False,
        )

    if findings:
        return _base_result(
            status="FAIL",
            findings=findings,
            evidence_class=evidence_class,
            gameplay_evidence=False,
            metrics={
                "accepted_turn_count": len(accepted),
                "reported_turn_count": reported_count,
            },
        )

    gameplay = evidence_class == "external"
    return _base_result(
        status="PASS",
        findings=[],
        evidence_class=evidence_class,
        gameplay_evidence=gameplay,
        metrics={
            "accepted_turn_count": len(accepted),
            "reported_turn_count": reported_count,
            "restart_at_turn": (restart or {}).get("at_turn") if isinstance(restart, dict) else None,
        },
    )


def validate_chapter_transition(
    run_dir: Path | str,
    requirements: dict[str, Any],
) -> dict[str, Any]:
    """Validate structured chapter-transition evidence against contract requirements."""
    if not isinstance(requirements, dict):
        raise ValueError("requirements must be an object")
    path = Path(run_dir)
    findings: list[dict[str, Any]] = []

    if not path.exists() or not path.is_dir():
        findings.append(
            _finding(
                code="run_dir_missing",
                severity="missing_evidence",
                message=f"run directory missing: {path}",
            )
        )
        return _base_result(status="NOT_RUN", findings=findings)

    evidence_path = _resolve_evidence_path(path, CHAPTER_EVIDENCE_FILE)
    if evidence_path is None:
        findings.append(
            _finding(
                code="chapter_transition_evidence_missing",
                severity="missing_evidence",
                message=f"{CHAPTER_EVIDENCE_FILE} not found under run_dir",
            )
        )
        return _base_result(status="NOT_RUN", findings=findings)

    try:
        evidence = _read_json(evidence_path)
    except ValueError as exc:
        findings.append(
            _finding(
                code="chapter_transition_evidence_unreadable",
                severity="missing_evidence",
                message=str(exc),
            )
        )
        return _base_result(status="NOT_RUN", findings=findings)

    if not isinstance(evidence, dict):
        findings.append(
            _finding(
                code="chapter_transition_evidence_invalid",
                severity="contradictory_evidence",
                message="chapter-transition evidence must be a JSON object",
            )
        )
        return _base_result(status="FAIL", findings=findings)

    if evidence.get("schema_version") != 1 or evidence.get("eval_spec") != EVAL_SPEC:
        findings.append(
            _finding(
                code="chapter_transition_version_mismatch",
                severity="contradictory_evidence",
                message="chapter evidence must declare schema_version=1 and eval-spec-v1",
            )
        )

    evidence_class, eligible = _eligibility_fields(evidence, requirements, findings)

    if evidence_class == "external" and not _attestation_present(evidence.get("attestation")):
        findings.append(
            _finding(
                code="external_attestation_missing",
                severity="ineligible",
                message="external chapter-transition lane requires runner/model attestation",
            )
        )
        return _base_result(
            status="INELIGIBLE",
            findings=findings,
            evidence_class=evidence_class,
            gameplay_evidence=False,
        )

    expected_module = requirements.get("source_module_id")
    if expected_module and evidence.get("source_module_id") != expected_module:
        findings.append(
            _finding(
                code="source_module_mismatch",
                severity="contradictory_evidence",
                message="source_module_id does not match contract",
                expected=expected_module,
                actual=evidence.get("source_module_id"),
            )
        )

    event_req = requirements.get("chapter_switch_event") or {}
    event = evidence.get("chapter_switch_event")
    if event_req.get("required"):
        if not isinstance(event, dict):
            findings.append(
                _finding(
                    code="chapter_switch_event_missing",
                    severity="contradictory_evidence",
                    message="chapter_switch_event object is required",
                )
            )
            event = {}
        expected_type = event_req.get("event_type")
        if expected_type and event.get("event_type") != expected_type:
            findings.append(
                _finding(
                    code="chapter_switch_event_type_mismatch",
                    severity="contradictory_evidence",
                    message=f"chapter_switch_event.event_type must be {expected_type}",
                )
            )
        if not event.get("event_id"):
            findings.append(
                _finding(
                    code="chapter_switch_event_id_missing",
                    severity="contradictory_evidence",
                    message="chapter_switch_event.event_id is required",
                )
            )

    if evidence.get("pre_active_scenario_id") != requirements.get("pre_active_scenario_id"):
        findings.append(
            _finding(
                code="pre_active_scenario_mismatch",
                severity="contradictory_evidence",
                message="pre_active_scenario_id does not match contract",
                expected=requirements.get("pre_active_scenario_id"),
                actual=evidence.get("pre_active_scenario_id"),
            )
        )
    if evidence.get("post_active_scenario_id") != requirements.get("post_active_scenario_id"):
        findings.append(
            _finding(
                code="post_active_scenario_mismatch",
                severity="contradictory_evidence",
                message="post_active_scenario_id does not match contract",
                expected=requirements.get("post_active_scenario_id"),
                actual=evidence.get("post_active_scenario_id"),
            )
        )

    expected_sidecars = list(requirements.get("preserved_epistemic_sidecars") or [])
    actual_sidecars = evidence.get("preserved_epistemic_sidecars")
    if not isinstance(actual_sidecars, list):
        actual_sidecars = []
        findings.append(
            _finding(
                code="epistemic_sidecars_missing",
                severity="contradictory_evidence",
                message="preserved_epistemic_sidecars list is required",
            )
        )
    for name in expected_sidecars:
        if name not in actual_sidecars:
            findings.append(
                _finding(
                    code="epistemic_sidecar_missing",
                    severity="contradictory_evidence",
                    message=f"missing preserved epistemic sidecar: {name}",
                    sidecar=name,
                )
            )

    for field_name, code in (
        ("investigator_state_continuity", "investigator_continuity_missing"),
        ("campaign_state_continuity", "campaign_continuity_missing"),
        ("item_continuity", "item_continuity_missing"),
    ):
        req = requirements.get(field_name) or {}
        value = evidence.get(field_name)
        if req.get("required") and not isinstance(value, dict):
            findings.append(
                _finding(
                    code=code,
                    severity="contradictory_evidence",
                    message=f"{field_name} object is required",
                )
            )
        elif isinstance(value, dict) and value.get("preserved") is not True:
            findings.append(
                _finding(
                    code=f"{field_name}_not_preserved",
                    severity="contradictory_evidence",
                    message=f"{field_name}.preserved must be true",
                )
            )

    for field_name, code in (
        ("discovered_clues", "discovered_clues_missing"),
        ("relationships", "relationships_missing"),
    ):
        req = requirements.get(field_name) or {}
        value = evidence.get(field_name)
        if req.get("required") and not isinstance(value, list):
            findings.append(
                _finding(
                    code=code,
                    severity="contradictory_evidence",
                    message=f"{field_name} list is required",
                )
            )
        elif isinstance(value, list):
            min_count = req.get("min_count")
            if isinstance(min_count, int) and len(value) < min_count:
                findings.append(
                    _finding(
                        code=f"{field_name}_below_min",
                        severity="contradictory_evidence",
                        message=f"{field_name} below required min_count",
                    )
                )

    invalidated_req = requirements.get("invalidated_segment") or {}
    bridged = evidence.get("code_revision_bridges_checkpoints") is True
    if invalidated_req.get("required_when_code_revision_bridges_checkpoints") and bridged:
        segment = evidence.get("invalidated_segment")
        if not isinstance(segment, dict) or segment.get("recorded") is not True:
            findings.append(
                _finding(
                    code="invalidated_segment_missing",
                    severity="contradictory_evidence",
                    message=(
                        "invalidated_segment evidence is required when a code "
                        "revision bridges checkpoints"
                    ),
                )
            )

    if (requirements.get("secret_leakage_audit") or {}).get("required"):
        _secret_audit_ok(evidence, findings)

    if eligible is False:
        findings.append(
            _finding(
                code="evidence_marked_ineligible",
                severity="ineligible",
                message="evidence.eligible is false",
            )
        )
        return _base_result(
            status="INELIGIBLE",
            findings=findings,
            evidence_class=evidence_class,
            gameplay_evidence=False,
        )

    if findings:
        return _base_result(
            status="FAIL",
            findings=findings,
            evidence_class=evidence_class,
            gameplay_evidence=False,
        )

    return _base_result(
        status="PASS",
        findings=[],
        evidence_class=evidence_class,
        gameplay_evidence=evidence_class == "external",
        metrics={
            "preserved_sidecar_count": len(actual_sidecars),
            "discovered_clue_count": len(evidence.get("discovered_clues") or []),
            "relationship_count": len(evidence.get("relationships") or []),
        },
    )
