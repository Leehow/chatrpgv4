#!/usr/bin/env python3
"""Canonical continuity workspace, segment, and restart orchestration."""
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
TOP_CONTINUITY_RUNNER = "coc_live_match.segmented"
SEGMENT_CONTINUITY_RUNNER = "coc_live_match"


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
    spec = importlib.util.spec_from_file_location(
        "coc_eval_continuity_runner_live_cell", path
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _load_continuity_evidence():
    path = SCRIPT_DIR / "coc_eval_continuity_evidence.py"
    spec = importlib.util.spec_from_file_location(
        "coc_eval_continuity_runner_evidence", path
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _expected_runner_attestation() -> dict[str, dict[str, str]]:
    return _load_continuity_evidence()._expected_runner_attestation()


def _is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(
        ch in "0123456789abcdef" for ch in value.lower()
    )


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
    base_matches = bool(
        attestation.get("player_model") == model_roles["player"]
        and attestation.get("kp_model") == model_roles["kp"]
        and attested
    )
    if segment.get("evidence_class") != "external":
        return base_matches
    return bool(
        base_matches
        and attestation.get("runner") == SEGMENT_CONTINUITY_RUNNER
        and attestation.get("runners") == _expected_runner_attestation()
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
        "turn_bindings": segment.get("turn_bindings"),
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
    segment_executor: Any | None = None,
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
    execute_segment = segment_executor or _run_segment
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
        execute_segment(
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
        execute_segment(
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
            "runner": TOP_CONTINUITY_RUNNER,
            "runners": _expected_runner_attestation(),
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
    validation = _load_continuity_evidence().validate_continuity_run(
        lane_dir, requirements
    )
    status = validation["status"]
    if status == "PASS" and not exact_models:
        status = "INELIGIBLE"
    return {**evidence, "status": status, "validation": validation}
