#!/usr/bin/env python3
"""Background parallel worker for progressive parse-queue jobs.

Design (product):
- Dig / enter / clue-follow only **enqueue** and return immediately.
- Deep pack extraction is host-owned; this worker never invents secret/handout
  bodies and does not OCR/parse PDF bytes.
- Worker runs **out of band**: claim jobs into ``in_flight``, process in a
  thread pool, merge ready packs into campaigns, write host-work requests for
  still-missing packs, then exit after idle.

See docs/active-plans/coc-on-demand-module-skeleton.md slice 7–8.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
WORKER_PID_NAME = "queue-worker.pid"
WORKER_LOG_NAME = "queue-worker.log"
HOST_WORK_DIR = "host-work"
DEFAULT_PARALLEL = 4
DEFAULT_IDLE_EXIT_S = 45.0
DEFAULT_STALE_IN_FLIGHT_S = 30.0
DEFAULT_POLL_S = 0.4


def _foreground_opening_result_contract() -> dict[str, Any]:
    """Return the compact closed result shape carried by opening host work."""
    return {
        "schema_version": 1,
        "contract_id": "coc.foreground-opening-pack.v1",
        "closed": True,
        "parse_state": "partial",
        "evidence_gap": False,
        "required_location_fields": [
            "location_id",
            "player_safe_summary",
            "source_page_indices",
            "source_refs",
        ],
        "exact_source_scope": True,
        "location_pack": {
            "fixed_fields": {
                "parse_state": "partial",
                "evidence_gap": False,
                "origin": "source",
            },
            "copy_from_request": {
                "location_id": "target_id",
                "host_work_job_id": "job_id",
                "source_page_indices": "requested_pdf_indices",
                "source_refs": {
                    "from": "cached_page_refs",
                    "select_fields": [
                        "source_id", "pdf_index", "text_sha256",
                    ],
                    "scope": "exact",
                },
            },
            "required_semantic_fields": ["title", "player_safe_summary"],
            "empty_defaults": {
                "available_clue_ids": [],
                "npc_ids": [],
                "clues": [],
                "npcs": [],
                "scene_edges": [],
                "affordances": [],
                "keeper_secret_refs": [],
                "pressure_moves": [],
                "tone": [],
                "mentions": [],
            },
            "source_ref": {
                "required_fields": [
                    "source_id", "pdf_index", "text_sha256",
                ],
                "field_types": {
                    "source_id": "string",
                    "pdf_index": "non_negative_integer",
                    "text_sha256": "64_hex_string",
                },
                "scope": "exact_cached_page_or_fact_subset",
            },
            "row_contracts": {
                "scene_edge": {
                    "required_fields": ["to"],
                    "template": {
                        "to": "<source-grounded-location-id>",
                        "kind": "travel",
                        "when": {"kind": "always"},
                    },
                    "when_optional": True,
                    "when_kind_values": sorted(
                        coc_module_assets._EXIT_CONDITION_KINDS
                    ),
                    "when_required_fields_by_kind": {
                        "clue_discovered": ["clue_id"],
                        "clock_reaches": ["threshold"],
                        "flag_set": ["flag_id"],
                    },
                    "forbidden_fields": ["when.type"],
                },
                "affordance": {
                    "required_fields": ["id", "cue", "route_type", "status"],
                    "template": {
                        "id": "<source-grounded-affordance-id>",
                        "cue": "<player-facing-action-cue>",
                        "route_type": "<semantic-route-type>",
                        "status": "open",
                    },
                    "forbidden_fields": ["affordance_id"],
                },
                "clue": {
                    "required_fields": [
                        "clue_id",
                        "player_safe_summary",
                        "discovery",
                        "provenance",
                        "source_refs",
                    ],
                    "template": {
                        "clue_id": "<source-grounded-clue-id>",
                        "player_safe_summary": "<source-grounded-player-text>",
                        "discovery": {
                            "mode": "automatic",
                            "skill": None,
                            "difficulty": None,
                            "condition": None,
                        },
                        "provenance": {
                            "authority": "source_authored",
                            "basis": "host_pack",
                        },
                        "source_refs": [{
                            "source_id": "<request-source-id>",
                            "pdf_index": "<cached-page-index-integer>",
                            "text_sha256": "<cached-page-text-sha256>",
                        }],
                    },
                    "discovery_mode_values": sorted(
                        coc_module_assets.CLUE_DISCOVERY_MODES
                    ),
                    "discovery_difficulty_values": sorted(
                        coc_module_assets.CLUE_CHECK_DIFFICULTIES
                    ),
                    "discovery_templates_by_mode": {
                        "automatic": {
                            "skill": None,
                            "difficulty": None,
                            "condition": None,
                        },
                        "check": {
                            "skill": "<non-empty-skill>",
                            "difficulty": "<difficulty-enum>",
                            "condition": None,
                        },
                        "conditional_check": {
                            "skill": "<non-empty-skill>",
                            "difficulty": "<difficulty-enum>",
                            "condition": {
                                "kind": "<source-grounded-condition-kind>",
                            },
                        },
                        "keeper_judgment": {
                            "skill": None,
                            "difficulty": None,
                            "condition": None,
                        },
                    },
                    "forbidden_fields": ["summary"],
                },
                "npc": {
                    "required_fields": ["npc_id", "agenda"],
                    "template": {
                        "npc_id": "<source-grounded-npc-id>",
                        "name": "<source-grounded-name>",
                        "parse_state": "partial",
                        "player_safe_summary": "<source-grounded-player-text>",
                        "agenda": "<source-bounded-immediate-agenda>",
                    },
                    "source_refs_policy": (
                        "omit_to_inherit_location_scope_or_use_exact_subset"
                    ),
                },
                "provenance": {
                    "allowed_fields": sorted(
                        coc_module_assets.FACT_PROVENANCE_FIELDS
                    ),
                    "authority_values": sorted(
                        coc_module_assets.FACT_PROVENANCE_AUTHORITIES
                    ),
                    "source_authored_template": {
                        "authority": "source_authored",
                        "basis": "host_pack",
                    },
                    "source_refs_policy": (
                        "omit_or_match_record_source_refs_exactly"
                    ),
                },
            },
        },
        "first_submission_guidance": {
            "authority": "advisory",
            "hard_gate": False,
            "copy_contract_values": [
                "location_pack.fixed_fields",
                "location_pack.copy_from_request",
                "location_pack.empty_defaults",
            ],
            "required_semantics_only": {
                "location_fields": ["title", "player_safe_summary"],
                "materially_present_npc_fields": ["npc_id", "agenda"],
                "npc_policy": "source_supported_and_materially_present_only",
            },
            "forced_empty_fields": {
                "scene_edges": [],
                "affordances": [],
            },
            "infer_structured_clock_or_routes_from_prose": False,
            "self_check_before_status_usable": True,
            "unsatisfied_required_fields_result": {
                "status": "abstain",
                "results": [],
            },
            "parent_repair_allowed": False,
        },
        "materially_present_npc": {
            "same_pack": True,
            "required_fields": ["npc_id", "agenda"],
            "agenda_scope": "source_bounded_immediate",
        },
        "missing_agenda_disposition": "soft_deferred",
        "replacement_before_opening": False,
    }


def _mechanics_locator_result_contract(
    *,
    file_sha256: str,
    requested_pdf_indices: list[int],
) -> dict[str, Any]:
    """Return the closed partial locator delta accepted by the parent."""
    scope = {
        "scope_kind": "explicit_pdf_indices",
        "pdf_indices": list(requested_pdf_indices),
        "source_file_sha256": file_sha256,
    }
    return {
        "schema_version": 1,
        "contract_id": "coc.mechanics-locator-pack.v1",
        "closed": True,
        "related_packs": "must_be_empty",
        "pack": {
            "allowed_fields": [
                "mechanics_locator_pass_status",
                "mechanics_locator_scope",
                "npc_roster",
                "item_roster",
                "mechanics_index",
            ],
            "required_fields": [
                "mechanics_locator_pass_status",
                "mechanics_locator_scope",
                "npc_roster",
                "item_roster",
                "mechanics_index",
            ],
            "fixed_fields": {
                "mechanics_locator_pass_status": "pending",
                "mechanics_locator_scope": scope,
            },
            "empty_defaults": {
                "npc_roster": [], "item_roster": [], "mechanics_index": [],
            },
            "npc_roster_row": {
                "allowed_fields": [
                    "npc_id", "names", "parse_state",
                    "source_page_indices", "source_refs",
                ],
                "required_fields": [
                    "npc_id", "names", "parse_state",
                    "source_page_indices", "source_refs",
                ],
                "fixed_fields": {"parse_state": "named_only"},
                "names": "non_empty_array_of_non_empty_strings",
                "names_semantics": "aliases_for_one_subject_only",
                "shared_stat_block_policy": {
                    "distinct_named_people": "separate_stable_npc_ids",
                    "required_rows_per_person": [
                        "npc_roster", "mechanics_index",
                    ],
                    "may_reuse_exact_fields": [
                        "source_page_indices", "source_refs", "locator_scope",
                    ],
                    "merge_identity_into_compound_subject": False,
                },
                "source_scope": "exact_subset_of_requested_cached_refs",
                "eligibility": "same_subject_has_a_mechanics_index_row",
            },
            "item_roster_row": {
                "allowed_fields": [
                    "item_id", "label", "parse_state",
                    "source_page_indices", "source_refs",
                ],
                "required_fields": [
                    "item_id", "label", "parse_state",
                    "source_page_indices", "source_refs",
                ],
                "fixed_fields": {"parse_state": "named_only"},
                "label": "non_empty_string",
                "source_scope": "exact_subset_of_requested_cached_refs",
                "eligibility": "same_subject_has_a_mechanics_index_row",
            },
            "mechanics_index_row": {
                "allowed_fields": [
                    "subject_kind", "subject_id", "status",
                    "locator_pass_status", "locator_scope",
                    "source_page_indices", "source_refs",
                ],
                "required_fields": [
                    "subject_kind", "subject_id", "status",
                    "locator_pass_status", "locator_scope",
                    "source_page_indices", "source_refs",
                ],
                "fixed_fields": {
                    "status": "located",
                    "locator_pass_status": "complete",
                    "locator_scope": scope,
                },
                "source_page_indices": "non_empty_subset_of_requested_pdf_indices",
                "source_refs": "exact_cached_refs_for_source_page_indices",
                "subject_kind_values": ["npc", "item"],
                "located_requires": "the reviewed page actually contains subject-specific authored numeric rules, parameters, or a stat block",
                "does_not_establish_located": [
                    "name_or_heading_only",
                    "description_or_plot_role_only",
                    "roster_or_dramatis_personae_entry_only",
                ],
            },
        },
        "no_located_subject_result": {
            "status": "usable",
            "copy_pack_fixed_fields": True,
            "npc_roster": [],
            "item_roster": [],
            "mechanics_index": [],
            "related_packs": [],
        },
        "rules": [
            "review only requested cached refs; never widen or scan the bundle",
            "global pass stays pending for this bounded partial locator window",
            "emit only source-supported named_only roster additions for subjects that also receive located rows",
            "emit one stable npc subject plus matching roster and index row for every distinct named person, even when multiple people share one authored stat block",
            "names are aliases for one subject only; shared stats may reuse exact source page indices, source refs, and locator scope but never merge distinct identities into a compound subject",
            "a name, description, roster, or dramatis-personae entry is not mechanics evidence; located requires actual subject-specific numeric rules, parameters, or a stat block on the reviewed page",
            "an exact reviewed window with no supported subject returns status=usable with empty rosters and mechanics_index so this request can close; it is not abstain",
            "do not emit mechanics profiles or eager related packs",
        ],
    }


def _mechanics_resolution_result_contract(
    *,
    job_id: str,
    job_kind: str,
    target_id: str,
    cached_page_refs: list[dict[str, Any]],
    batch_subjects: list[dict[str, Any]],
) -> dict[str, Any]:
    """Return the closed entity-wrapper shape for one mechanics extraction."""
    allowed_canonical_extends_ids = list(coc_mechanics.canonical_weapon_ids())
    subject_kind = {
        "resolve_npc_mechanics": "npc",
        "resolve_item_mechanics": "item",
    }[job_kind]
    exact_refs = [
        {
            "source_id": str(ref.get("source_id") or ""),
            "pdf_index": int(ref["pdf_index"]),
            "text_sha256": str(ref.get("text_sha256") or ""),
        }
        for ref in cached_page_refs
        if isinstance(ref, dict) and isinstance(ref.get("pdf_index"), int)
    ]
    eligible_related = [
        {
            "subject_kind": str(row.get("subject_kind") or ""),
            "subject_id": str(row.get("subject_id") or ""),
        }
        for row in batch_subjects
        if isinstance(row, dict)
        and (
            str(row.get("subject_kind") or ""),
            str(row.get("subject_id") or ""),
        ) != (subject_kind, target_id)
    ]
    pack_contract = {
        "allowed_fields": ["mechanics"],
        "required_fields": ["mechanics"],
        "forbidden_fields": ["parse_state"],
        "mechanics_nested_only": True,
        "mechanics": {
            "status_values": ["authored", "not_authored"],
            "authored": {
                "allowed_fields": [
                    "status", "profile", "source_refs",
                    "fields_observed", "fields_extracted",
                    "fields_not_authored", "provenance",
                ],
                "required_fields": [
                    "status", "profile", "source_refs",
                    "fields_observed", "fields_extracted",
                    "fields_not_authored", "provenance",
                ],
                "fixed_fields": {
                    "status": "authored",
                    "provenance.authority": "source_authored",
                },
                "source_refs": {
                    "allowed_exact_refs": exact_refs,
                    "scope": "non_empty_subject_subset",
                    "select_fields": [
                        "source_id", "pdf_index", "text_sha256",
                    ],
                },
                "profile_kind_by_subject_kind": {
                    "npc": "actor",
                    "item": "non_actor",
                },
                "canonical_profile_self_check": {
                    "required": True,
                    "allowed_canonical_extends_ids": allowed_canonical_extends_ids,
                    "weapon_entry": (
                        "weapon_id plus extends from allowed_canonical_extends_ids, "
                        "or omit extends and provide every canonical full-weapon "
                        "field required by the validator"
                    ),
                },
            },
            "not_authored": {
                "allowed_fields": [
                    "status", "source_page_indices", "source_refs",
                    "locator_pass_status", "locator_scope",
                    "absence_receipt", "provenance",
                ],
                "required_fields": [
                    "status", "locator_pass_status", "locator_scope",
                    "absence_receipt",
                ],
                "fixed_fields": {
                    "status": "not_authored",
                    "locator_pass_status": "complete",
                },
                "scope": "exact_matching_skeleton_locator_scope",
            },
        },
    }
    return {
        "schema_version": 1,
        "contract_id": "coc.mechanics-entity-pack.v1",
        "closed": True,
        "result_item": {
            "allowed_fields": ["job_id", "pack", "related_packs"],
            "required_fields": ["job_id", "pack", "related_packs"],
            "fixed_fields": {"job_id": job_id},
        },
        "primary_subject": {
            "subject_kind": subject_kind,
            "subject_id": target_id,
        },
        "pack": pack_contract,
        "related_packs": {
            "wrapper_allowed_fields": ["subject_kind", "subject_id", "pack"],
            "wrapper_required_fields": ["subject_kind", "subject_id", "pack"],
            "eligible_subjects": eligible_related,
            "pack_contract": "same_as_primary_pack",
            "duplicate_subjects": "forbidden",
        },
        "rules": [
            "copy result_item.fixed_fields before extraction",
            "put status/profile/source_refs/fields/provenance inside pack.mechanics, never at pack root",
            "pack must not claim narrative parse_state=deep; parent preserves body depth",
            "authored source_refs must be a non-empty exact subset of this request's accepted cached refs",
            "self-check canonical profiles before usable, including every weapon entry",
            "related_packs use only the closed wrapper and eligible same-page subjects",
            "Grok submits the complete outer result through its named source server; "
            "fallback parents forward child packs unchanged; neither path repairs or normalizes",
        ],
    }


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio_queue_worker", "coc_fileio.py")
coc_mechanics = _load_sibling("coc_mechanics_queue_worker", "coc_mechanics.py")
coc_module_assets = _load_sibling("coc_module_assets_queue_worker", "coc_module_assets.py")
coc_module_project = _load_sibling("coc_module_project_queue_worker", "coc_module_project.py")
coc_compiled_archive = _load_sibling(
    "coc_compiled_archive_queue_worker", "coc_compiled_archive.py"
)
coc_state = _load_sibling("coc_state_queue_worker", "coc_state.py")


class QueueWorkerError(ValueError):
    """Background queue worker failed."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_ts() -> float:
    return time.time()


def _write_json(path: Path, payload: Any) -> None:
    coc_fileio.write_json_atomic(
        path, payload, indent=2, ensure_ascii=False, trailing_newline=True,
    )


def _queue_path(workspace: Path, asset_root_id: str) -> Path:
    return coc_module_assets.assets_root(workspace) / asset_root_id / "parse-queue.json"


def _lock_path(workspace: Path, asset_root_id: str) -> Path:
    return coc_module_assets.assets_root(workspace) / asset_root_id / "parse-queue.lock"


def _worker_dir(workspace: Path) -> Path:
    d = coc_module_assets.assets_root(workspace) / "_worker"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _read_queue(workspace: Path, asset_root_id: str) -> dict[str, Any]:
    path = _queue_path(workspace, asset_root_id)
    if not path.is_file():
        return {
            "schema_version": coc_module_assets.SCHEMA_VERSION,
            "pending": [],
            "in_flight": [],
            "done": [],
        }
    return json.loads(path.read_text(encoding="utf-8"))


def _write_queue(workspace: Path, asset_root_id: str, queue: dict[str, Any]) -> None:
    queue = dict(queue)
    queue["schema_version"] = coc_module_assets.SCHEMA_VERSION
    queue.setdefault("pending", [])
    queue.setdefault("in_flight", [])
    queue.setdefault("done", [])
    _write_json(_queue_path(workspace, asset_root_id), queue)


def list_asset_roots_with_work(workspace: Path) -> list[str]:
    root = coc_module_assets.assets_root(workspace)
    if not root.is_dir():
        return []
    out: list[str] = []
    for child in sorted(root.iterdir()):
        if not child.is_dir() or child.name.startswith("_"):
            continue
        qpath = child / "parse-queue.json"
        if not qpath.is_file():
            continue
        try:
            q = json.loads(qpath.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        pending = q.get("pending") or []
        inflight = q.get("in_flight") or []
        if pending or inflight:
            out.append(child.name)
    return out


def campaigns_using_asset(workspace: Path, asset_root_id: str) -> list[str]:
    """Find campaigns whose progressive projection is bound to this asset root."""
    camps_root = coc_state.coc_root(Path(workspace).resolve()) / "campaigns"
    if not camps_root.is_dir():
        return []
    found: list[str] = []
    for camp in sorted(camps_root.iterdir()):
        if not camp.is_dir():
            continue
        sc = camp / "scenario" / "scenario.json"
        if not sc.is_file():
            continue
        try:
            data = json.loads(sc.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if str(data.get("progressive_asset_root_id") or "") == asset_root_id:
            found.append(camp.name)
    return found


def requeue_stale_in_flight(
    workspace: Path,
    asset_root_id: str,
    *,
    stale_after_s: float = DEFAULT_STALE_IN_FLIGHT_S,
) -> int:
    """Return timed-out in_flight jobs to pending (crash recovery)."""
    lock = _lock_path(workspace, asset_root_id)
    lock.parent.mkdir(parents=True, exist_ok=True)
    moved = 0
    with coc_fileio.advisory_file_lock(lock):
        queue = _read_queue(workspace, asset_root_id)
        pending = list(queue.get("pending") or [])
        inflight = list(queue.get("in_flight") or [])
        keep: list[dict[str, Any]] = []
        now = _now_ts()
        for job in inflight:
            claimed = float(job.get("claimed_at_ts") or 0)
            if claimed and (now - claimed) > float(stale_after_s):
                job = dict(job)
                job.pop("worker_id", None)
                job.pop("claimed_at", None)
                job.pop("claimed_at_ts", None)
                job["requeued_at"] = _now_iso()
                job["requeue_reason"] = "stale_in_flight"
                job["requeue_count"] = int(job.get("requeue_count") or 0) + 1
                pending.append(job)
                moved += 1
            else:
                keep.append(job)
        if moved:
            pending.sort(
                key=lambda item: (
                    -int(item.get("priority") or 0),
                    item.get("enqueued_at") or "",
                )
            )
            queue["pending"] = pending
            queue["in_flight"] = keep
            _write_queue(workspace, asset_root_id, queue)
    return moved


def claim_jobs(
    workspace: Path,
    asset_root_id: str,
    *,
    limit: int = 1,
    worker_id: str,
) -> list[dict[str, Any]]:
    """Atomically move up to ``limit`` pending jobs into in_flight."""
    if limit <= 0:
        return []
    lock = _lock_path(workspace, asset_root_id)
    lock.parent.mkdir(parents=True, exist_ok=True)
    claimed: list[dict[str, Any]] = []
    with coc_fileio.advisory_file_lock(lock):
        queue = _read_queue(workspace, asset_root_id)
        pending = list(queue.get("pending") or [])
        inflight = list(queue.get("in_flight") or [])
        # highest priority first (enqueue already sorts; re-sort defensively)
        pending.sort(
            key=lambda item: (
                -int(item.get("priority") or 0),
                item.get("enqueued_at") or "",
            )
        )
        take = pending[: int(limit)]
        rest = pending[int(limit) :]
        now_iso = _now_iso()
        now_ts = _now_ts()
        for job in take:
            j = dict(job)
            j["worker_id"] = worker_id
            j["claimed_at"] = now_iso
            j["claimed_at_ts"] = now_ts
            inflight.append(j)
            claimed.append(j)
        queue["pending"] = rest
        queue["in_flight"] = inflight
        _write_queue(workspace, asset_root_id, queue)
    return claimed


def _finish_job(
    workspace: Path,
    asset_root_id: str,
    job: dict[str, Any],
    *,
    result: str,
    detail: dict[str, Any] | None = None,
    failed: bool = False,
) -> None:
    lock = _lock_path(workspace, asset_root_id)
    with coc_fileio.advisory_file_lock(lock):
        queue = _read_queue(workspace, asset_root_id)
        jid = str(job.get("job_id") or "")
        inflight = [
            j for j in (queue.get("in_flight") or [])
            if str(j.get("job_id") or "") != jid
        ]
        done = [
            row for row in (queue.get("done") or [])
            if str(row.get("job_id") or "") != jid
        ]
        completed_at = _now_iso()
        row = {
            **{k: v for k, v in job.items() if k not in {"worker_id", "claimed_at_ts"}},
            "completed_at": completed_at,
            "result": result,
            "failed": bool(failed),
        }
        try:
            enqueued_at = datetime.fromisoformat(str(job.get("enqueued_at")))
            completed_dt = datetime.fromisoformat(completed_at)
            row["total_ms"] = max(
                0, round((completed_dt - enqueued_at).total_seconds() * 1000)
            )
            if job.get("claimed_at"):
                claimed_at = datetime.fromisoformat(str(job["claimed_at"]))
                row["queue_wait_ms"] = max(
                    0, round((claimed_at - enqueued_at).total_seconds() * 1000)
                )
                row["processing_ms"] = max(
                    0, round((completed_dt - claimed_at).total_seconds() * 1000)
                )
        except (TypeError, ValueError):
            # Legacy/manual jobs may not carry valid timestamps.  Completion
            # still succeeds; unavailable timing stays explicitly absent.
            pass
        if detail:
            row["detail"] = detail
        done.append(row)
        queue["in_flight"] = inflight
        queue["done"] = coc_module_assets.dedupe_done_jobs(done, limit=200)
        _write_queue(workspace, asset_root_id, queue)


def _is_pack_ready(pack: dict[str, Any] | None, *, allow_partial: bool = False) -> bool:
    if not pack:
        return False
    state = str(pack.get("parse_state") or "")
    if pack.get("evidence_gap"):
        return False
    if state == "deep":
        return True
    if allow_partial and state in {"partial", "body_parsed"}:
        return True
    return False


def _target_source_scope(
    workspace: Path,
    asset_root_id: str,
    skeleton: dict[str, Any],
    entity_kind: str | None,
    target_id: str,
    *,
    job_kind: str,
) -> dict[str, Any]:
    collection_and_key = {
        "location": ("locations", "location_id"),
        "npc": ("npc_roster", "npc_id"),
        "item": ("item_roster", "item_id"),
        "handout": ("handouts", "handout_id"),
        "threat": ("threats", "threat_id"),
    }.get(entity_kind or "")
    scopes: list[dict[str, Any]] = []
    mechanics_job = str(job_kind or "").startswith("resolve_")
    # Mechanics lookup is intentionally narrower than entity-body deepening.
    # Appendix/chapter-end locators are the authoritative source for authored
    # parameters; profile/appearance/body pages must not inflate a blocking
    # mechanics request merely because they describe the same person or item.
    if collection_and_key is not None and not mechanics_job:
        collection, key = collection_and_key
        for row in skeleton.get(collection) or []:
            if isinstance(row, dict) and str(row.get(key) or "") == target_id:
                scopes.append(row)
                break
    if mechanics_job:
        for locator in skeleton.get("mechanics_index") or []:
            if (
                isinstance(locator, dict)
                and str(locator.get("subject_kind") or "") == str(entity_kind or "")
                and str(locator.get("subject_id") or "") == target_id
            ):
                scopes.append(locator)
                break

    # The named-only entity is the canonical accumulation point for later
    # structured mentions.  A skeleton profile page and scene-context pages
    # are complementary evidence, so the host handoff must consume their
    # exact union instead of stopping at the first skeleton match.
    if entity_kind and not mechanics_job:
        target_pack = coc_module_assets.get_entity(
            workspace, asset_root_id, entity_kind, target_id,
        )
        if isinstance(target_pack, dict):
            scopes.append(target_pack)

    requested_indices: set[int] = set()
    for position, scope in enumerate(scopes):
        requested_indices.update(
            coc_module_assets._source_indices(
                scope,
                field=f"host_work.{entity_kind or 'entity'}.scope[{position}]",
            )
        )
    if not requested_indices:
        return {}
    # Keep disjoint evidence exact.  Reconstructing a min/max span here would
    # silently request unrelated intervening PDF pages.
    return {"source_page_indices": sorted(requested_indices)}


def _cached_page_refs(
    workspace: Path,
    asset_root_id: str,
    *,
    requested_indices: list[int],
) -> list[dict[str, Any]]:
    module_root = coc_module_assets.assets_root(workspace) / asset_root_id
    # An absent exact source scope is not permission to scan the whole cache.
    # Keep the handoff open until a structured skeleton/mention supplies page
    # indices instead of turning one vague neighbor into an all-module read.
    if not requested_indices:
        return []
    candidate_indices = requested_indices
    refs: list[dict[str, Any]] = []
    for pdf_index in candidate_indices:
        page = coc_module_assets.get_page(workspace, asset_root_id, pdf_index)
        if page is None:
            continue
        meta = page.get("meta") if isinstance(page.get("meta"), dict) else {}
        refs.append({
            "source_id": meta.get("source_id"),
            "pdf_index": pdf_index,
            "path": str(module_root / "pages" / f"{pdf_index:04d}.md"),
            "text_sha256": meta.get("text_sha256"),
            "bundle_sha256s": list(meta.get("bundle_sha256s") or []),
            "review_state": meta.get("review_state"),
            "parse_confidence": meta.get("parse_confidence"),
            "grep_anchors": list(meta.get("grep_anchors") or []),
        })
    return refs


def _write_host_work_request(
    workspace: Path,
    asset_root_id: str,
    job: dict[str, Any],
) -> Path:
    """Durable handoff for host PDF skill / external fulfillers (not free prose scan)."""
    root = coc_module_assets.assets_root(workspace) / asset_root_id
    work_dir = root / HOST_WORK_DIR
    work_dir.mkdir(parents=True, exist_ok=True)
    jid = str(job.get("job_id") or f"job-{int(_now_ts())}")
    path = work_dir / f"{jid}.json"
    identity = {}
    id_path = root / "identity.json"
    if id_path.is_file():
        try:
            identity = json.loads(id_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            identity = {}
    skeleton = coc_module_assets.get_skeleton(workspace, asset_root_id) or {}
    identity_source = (
        identity.get("source") if isinstance(identity.get("source"), dict) else {}
    )
    source = (
        (skeleton.get("source") or {})
        if isinstance(skeleton, dict)
        else {}
    )
    if not source:
        source = identity_source
    entity_kind = coc_module_assets._job_entity_kind(str(job.get("kind") or ""))
    target_id = str(job.get("target_id") or "")
    job_kind = str(job.get("kind") or "")
    if job_kind in {"partial_opening", "locate_mechanics_index"}:
        expected_purpose = (
            coc_module_assets.FOREGROUND_OPENING_PURPOSE
            if job_kind == "partial_opening"
            else coc_module_assets.MECHANICS_LOCATOR_PURPOSE
        )
        if (
            str(job.get("request_purpose") or "")
            != expected_purpose
        ):
            raise QueueWorkerError(
                f"{job_kind} job has an invalid request purpose"
            )
        requested_scope = coc_module_assets.validate_opening_source_scope(
            workspace,
            asset_root_id,
            job.get("requested_source_scope"),
        )
        expected_signature = coc_module_assets.opening_source_scope_signature(
            requested_scope
        )
        if str(job.get("source_scope_signature") or "") != expected_signature:
            raise QueueWorkerError(
                f"{job_kind} job source scope signature is stale"
            )
        requested_indices = list(requested_scope["pdf_indices"])
    else:
        requested_scope = _target_source_scope(
            workspace,
            asset_root_id,
            skeleton,
            entity_kind,
            target_id,
            job_kind=job_kind,
        )
        requested_indices = (
            coc_module_assets._source_indices(
                requested_scope,
                field=f"host_work.{entity_kind or 'entity'}",
            )
            if requested_scope
            else []
        )
    cached_page_refs = _cached_page_refs(
        workspace,
        asset_root_id,
        requested_indices=requested_indices,
    )
    cached_indices = {int(row["pdf_index"]) for row in cached_page_refs}
    scope_complete = (
        set(requested_indices) <= cached_indices if requested_indices else None
    )
    batch_subjects: list[dict[str, Any]] = []
    requested_set = set(requested_indices)
    if requested_set and str(job.get("kind") or "").startswith("resolve_"):
        for locator in skeleton.get("mechanics_index") or []:
            if not isinstance(locator, dict):
                continue
            locator_indices = set(
                coc_module_assets._source_indices(
                    locator, field="host_work.batch_subject",
                )
            )
            if not locator_indices or not locator_indices.issubset(requested_set):
                continue
            batch_subjects.append({
                "subject_kind": locator.get("subject_kind"),
                "subject_id": locator.get("subject_id"),
                "source_page_indices": sorted(locator_indices),
            })
    source_aspect = (
        "mechanics"
        if job_kind.startswith("resolve_") or job_kind == "locate_mechanics_index"
        else "body"
    )
    group_material = json.dumps(
        {
            "file_sha256": source.get("file_sha256") or identity.get("file_sha256"),
            "source_aspect": source_aspect,
            "request_purpose": job.get("request_purpose"),
            "bundle_sha256": (
                requested_scope.get("bundle_sha256")
                if job_kind in {"partial_opening", "locate_mechanics_index"}
                else None
            ),
            "requested_pdf_indices": requested_indices,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    work_group_id = "source-work-" + hashlib.sha256(group_material).hexdigest()[:16]
    work_level, dependency_ref = coc_module_assets.validate_host_work_contract(
        job.get("work_level")
        or coc_module_assets._default_host_work_level(job_kind),
        job.get("dependency_ref"),
    )
    deadline_class = (
        "blocking_micro"
        if work_level == "current_dependency"
        else "idle_warm"
        if work_level == "bounded_warm"
        else "hot_ring"
        if job_kind == "partial_neighbor"
        else "next_turn_hot"
    )
    dispatch_state = (
        "awaiting_scope"
        if not requested_indices
        else "ready"
        if scope_complete is True
        else "awaiting_cache"
    )
    payload = {
        "schema_version": coc_module_assets.HOST_WORK_SCHEMA_VERSION,
        "job_id": jid,
        "asset_root_id": asset_root_id,
        "kind": job.get("kind"),
        "target_id": job.get("target_id"),
        "priority": job.get("priority"),
        "reason": job.get("reason"),
        "created_at": _now_iso(),
        "source_pdf": source.get("path") or (identity.get("source") or {}).get("path"),
        "source_id": source.get("source_id") or (identity.get("source") or {}).get("source_id"),
        "file_sha256": source.get("file_sha256") or identity.get("file_sha256"),
        "pages_cached": [f"{pdf_index:04d}.md" for pdf_index in sorted(cached_indices)],
        "source_scope_status": "known" if requested_indices else "unknown",
        "requested_source_scope": requested_scope,
        "request_purpose": job.get("request_purpose"),
        "source_scope_signature": job.get("source_scope_signature"),
        "requested_pdf_indices": requested_indices,
        "cached_page_refs": cached_page_refs,
        "cached_scope_complete": scope_complete,
        "batch_subjects": batch_subjects,
        "source_aspect": source_aspect,
        "deadline_class": deadline_class,
        "work_level": work_level,
        "work_group_id": work_group_id,
        "dispatch_state": dispatch_state,
        "dispatch_attempts": 0,
        "instruction": (
            "Source scope is unknown. Do not open or scan the PDF and do not "
            "scan unrelated cached pages. Leave this request unresolved until "
            "a structured skeleton, mention, or entity update supplies exact "
            "pdf_indices; then enqueue the target again."
            if not requested_indices
            else
            "Host source worker: review exactly cached_page_refs for this "
            "bounded mechanics locator pass. Return the closed locator delta "
            "from result_contract unchanged: global pass remains pending; emit "
            "only source-bound named_only roster additions and complete+located "
            "mechanics_index rows whose pages are inside this exact request. "
            "For every distinct named person, emit a separate stable npc_id "
            "plus roster and mechanics_index row; a shared stat block may reuse "
            "exact source_page_indices, source_refs, and locator_scope across "
            "those rows, while names holds aliases for one subject only and "
            "never forms a compound identity. "
            "Do not emit mechanics profiles, related_packs, not_authored claims, "
            "or inspect any other cached/PDF page. Submit the complete outer "
            "result through the named source transport, or return it unchanged "
            "to the exact fallback parent."
            if job_kind == "locate_mechanics_index"
            else
            "Host PDF skill: review exactly cached_page_refs and only the "
            "requested_pdf_indices for request_purpose=foreground_opening_slice. "
            "Return one reusable location pack with parse_state=partial, "
            "evidence_gap=false and exact source_page_indices/source_refs. Follow "
            "the closed result_contract: include player_safe_summary and, for each "
            "materially present NPC, same-pack npc_id plus a source-bounded immediate "
            "agenda. Missing agenda is soft_deferred and must not cause replacement "
            "before opening. "
            "Do not claim deep "
            "or inspect pages outside this exact accepted scope. Submit the complete "
            "outer result through the named source transport, or return it unchanged "
            "to the exact fallback parent; the strict receiver binds this "
            "request transiently and persists only the canonical fulfillment receipt."
            if job_kind == "partial_opening"
            else
            "Host PDF skill: resolve authored mechanics for this structured subject. "
            "Read cached_page_refs first and visually review only requested_pdf_indices. "
            "batch_subjects sharing those pages should be extracted in the same host pass. "
            "Follow the closed result_contract. Return an entity pack with exactly one "
            "nested mechanics object; status, profile, source_refs, fields accounting, "
            "and provenance belong inside pack.mechanics, never at pack root. Do not "
            "emit parse_state=deep. For authored mechanics use status=authored with "
            "profile, source_refs, "
            "fields_observed==fields_extracted, fields_not_authored, provenance.authority="
            "source_authored, and attacks_per_round when the source authors it; or "
            "status=not_authored with locator_pass_status=complete, locator_scope, and "
            "absence_receipt.checked_scope bound exactly to that locator_scope "
            "(structured object with scope_kind, pdf_indices, source_file_sha256 equal "
            "to this packet's file_sha256); every selected page must be one of this "
            "packet's registered accepted cached_page_refs and every source_ref source_id "
            "must equal this packet's source_id. "
            "Do not emit flat characteristics/weapons/spells under located/unresolved/"
            "not_authored. Do not claim not_authored without a completed appendix scan. "
            "Submit the complete outer result, including primary pack and optional "
            "related_packs, through the named source transport, or return it unchanged "
            "to the exact fallback parent; later mechanics questions must reuse those "
            "durable packs."
            if job_kind.startswith("resolve_")
            else
            "Host PDF skill: read cached_page_refs first. If cached_scope_complete "
            "is true, do not reopen the PDF for this scope. Extract only a "
            "reusable partial neighbor pack; register a new validated source "
            "bundle window only for missing pdf_indices. Submit the complete outer "
            "result through the named source transport, or return it unchanged to the "
            "exact fallback parent, with parse_state=partial and "
            "evidence_gap=false, source_page_indices, and host_timing; the "
            "fulfillment operation binds the request transiently."
            if str(job.get("kind") or "") == "partial_neighbor"
            else
            "Host PDF skill: read cached_page_refs first. If cached_scope_complete "
            "is true, do not reopen the PDF for this scope. Register a new "
            "validated source bundle window only for missing pdf_indices, then "
            "deep-extract this entity once into a reusable entity pack. Submit the "
            "complete outer result through the named source transport, or return it "
            "unchanged to the exact fallback parent, with parse_state=deep and "
            "evidence_gap=false, source_page_indices, and host_timing; the "
            "fulfillment operation binds the request transiently, and later "
            "questions must query that pack rather than reopen the same PDF "
            "scope. Do not invent handout/secret bodies without page evidence."
        ),
    }
    if dependency_ref is not None:
        payload["dependency_ref"] = dependency_ref
    coc_module_assets.validate_host_work_request_shape(payload)
    if job_kind == "partial_opening":
        payload["result_contract"] = _foreground_opening_result_contract()
    elif job_kind == "locate_mechanics_index":
        payload["result_contract"] = _mechanics_locator_result_contract(
            file_sha256=str(payload.get("file_sha256") or ""),
            requested_pdf_indices=requested_indices,
        )
    elif job_kind in {"resolve_npc_mechanics", "resolve_item_mechanics"}:
        payload["result_contract"] = _mechanics_resolution_result_contract(
            job_id=jid,
            job_kind=job_kind,
            target_id=str(job.get("target_id") or ""),
            cached_page_refs=cached_page_refs,
            batch_subjects=batch_subjects,
        )
    pending_supersedes = sorted({
        str(value).strip()
        for value in job.get("supersedes_host_job_ids") or []
        if str(value).strip() and str(value).strip() != jid
    })
    superseded: list[str] = []
    with coc_fileio.advisory_file_lock(root / "host-work.lock"):
        candidates: list[tuple[Path, dict[str, Any]]] = []
        for old_job_id in pending_supersedes:
            old_path = work_dir / f"{old_job_id}.json"
            if not old_path.is_file():
                continue
            try:
                old_request = json.loads(old_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if str(old_request.get("status") or "open") in (
                coc_module_assets.HOST_WORK_CLOSED_STATUSES
            ):
                continue
            if not coc_module_assets._same_entity_work(
                old_request, job_kind, target_id,
            ):
                raise QueueWorkerError(
                    "supersede candidate does not match the replacement target"
                )
            candidates.append((old_path, old_request))

        # Readers also take host-work.lock, so they see either the old open row
        # or this replacement plus stale predecessors, never a stranded gap.
        _write_json(path, payload)
        for old_path, old_request in candidates:
            old_job_id = str(old_request.get("job_id") or "")
            old_request.update({
                "status": "superseded",
                "dispatch_state": "superseded",
                "superseded_at": _now_iso(),
                "superseded_by_job_id": jid,
            })
            _write_json(old_path, old_request)
            superseded.append(old_job_id)
        if superseded:
            payload["superseded_host_job_ids"] = superseded
            _write_json(path, payload)
    return path


def process_claimed_job(
    workspace: Path,
    asset_root_id: str,
    job: dict[str, Any],
) -> dict[str, Any]:
    """Process one in_flight job (merge if ready, else host-work request)."""
    kind = str(job.get("kind") or "")
    tid = str(job.get("target_id") or "")
    detail: dict[str, Any] = {"kind": kind, "target_id": tid}
    try:
        if kind == "locate_mechanics_index":
            req = _write_host_work_request(workspace, asset_root_id, job)
            detail["host_work_request"] = str(req)
            _finish_job(
                workspace,
                asset_root_id,
                job,
                result="awaiting_host_pack",
                detail=detail,
            )
            return {"ok": True, "result": "awaiting_host_pack", **detail}

        if kind in {"deepen_location", "partial_neighbor", "partial_opening"}:
            pack = coc_module_assets.get_entity(
                workspace, asset_root_id, "location", tid,
            )
            allow_partial = kind in {"partial_neighbor", "partial_opening"}
            if kind == "partial_opening" and _is_pack_ready(
                pack, allow_partial=True,
            ):
                expected_scope = coc_module_assets.validate_opening_source_scope(
                    workspace,
                    asset_root_id,
                    job.get("requested_source_scope"),
                )
                pack_indices = coc_module_assets._source_indices(
                    pack or {}, field="partial_opening.pack",
                )
                expected_signature = coc_module_assets.opening_source_scope_signature(
                    expected_scope
                )
                fulfilled_request = next(
                    (
                        row for row in coc_module_assets.list_host_work_requests(
                            workspace, asset_root_id, include_closed=True, limit=None,
                        )
                        if str(row.get("job_id") or "")
                        == str(job.get("job_id") or "")
                    ),
                    None,
                )
                if (
                    pack_indices == expected_scope["pdf_indices"]
                    and isinstance(fulfilled_request, dict)
                    and fulfilled_request.get("kind") == "partial_opening"
                    and fulfilled_request.get("target_id") == tid
                    and fulfilled_request.get("request_purpose")
                    == coc_module_assets.FOREGROUND_OPENING_PURPOSE
                    and fulfilled_request.get("requested_source_scope")
                    == expected_scope
                    and str(fulfilled_request.get("source_scope_signature") or "")
                    == expected_signature
                    and coc_module_assets.fulfilled_request_matches_current_pack(
                        fulfilled_request,
                        pack or {},
                        kind="location",
                        entity_id=tid,
                    )
                ):
                    detail["parse_state"] = (pack or {}).get("parse_state")
                    detail["request_purpose"] = (
                        coc_module_assets.FOREGROUND_OPENING_PURPOSE
                    )
                    _finish_job(
                        workspace,
                        asset_root_id,
                        job,
                        result="entity_ready",
                        detail=detail,
                    )
                    return {"ok": True, "result": "entity_ready", **detail}
            if kind != "partial_opening" and _is_pack_ready(
                pack, allow_partial=allow_partial,
            ):
                # Merge directly — job is in_flight, not pending, so
                # process_ready_deepens (pending-only) would miss it.
                camps = campaigns_using_asset(workspace, asset_root_id)
                merged_for: list[str] = []
                for camp_id in camps:
                    try:
                        camp_dir = coc_state.coc_root(Path(workspace).resolve()) / "campaigns" / camp_id
                        with coc_fileio.advisory_file_lock(
                            camp_dir / ".progressive-ir.lock", wait_seconds=15.0,
                        ):
                            ir = coc_module_project.load_campaign_ir(camp_dir)
                            ir = coc_module_project.merge_deep_location_into_ir(ir, pack)
                            # IR write + archive publish; archive failure never
                            # rolls back canonical IR (status recorded instead).
                            coc_module_project.write_ir_to_campaign(
                                camp_dir, ir, asset_root_id=asset_root_id,
                            )
                            archive = coc_compiled_archive.load_status(camp_dir) or {}
                            detail.setdefault("archive_status", {})[camp_id] = {
                                "status": archive.get("status"),
                                "archive_revision": archive.get("archive_revision"),
                                "error": archive.get("error"),
                            }
                        merged_for.append(camp_id)
                    except Exception as exc:  # noqa: BLE001
                        detail.setdefault("campaign_errors", {})[camp_id] = str(exc)
                detail["merged_campaigns"] = merged_for
                detail["parse_state"] = (pack or {}).get("parse_state")
                result_name = "merged" if merged_for else "pack_ready_no_campaign"
                detail["result"] = result_name
                _finish_job(
                    workspace, asset_root_id, job,
                    result=result_name,
                    detail=detail,
                )
                return {"ok": True, "result": result_name, **detail}

            req = _write_host_work_request(workspace, asset_root_id, job)
            detail["host_work_request"] = str(req)
            # Not failed: host must fulfill; leave a done marker so pending does
            # not spin. put_entity kick re-enqueues merge when pack lands.
            _finish_job(
                workspace, asset_root_id, job,
                result="awaiting_host_pack",
                detail=detail,
            )
            return {"ok": True, "result": "awaiting_host_pack", **detail}

        if kind in {
            "deepen_npc", "deepen_item", "deepen_clue", "deepen_handout", "deepen_threat",
            "resolve_npc_mechanics", "resolve_item_mechanics",
        }:
            entity_kind = {
                "deepen_npc": "npc",
                "deepen_item": "item",
                "deepen_clue": "clue",
                "deepen_handout": "handout",
                "deepen_threat": "threat",
                "resolve_npc_mechanics": "npc",
                "resolve_item_mechanics": "item",
            }[kind]
            pack = coc_module_assets.get_entity(
                workspace, asset_root_id, entity_kind, tid,
            )
            mechanics_job = kind.startswith("resolve_")
            mechanics_ready = (
                mechanics_job
                and isinstance((pack or {}).get("mechanics"), dict)
                and (pack or {})["mechanics"].get("status")
                in {"authored", "not_authored"}
            )
            if mechanics_ready or (not mechanics_job and _is_pack_ready(pack)):
                # Handouts are delivered from the asset store by their normal
                # consumer. NPCs, clues, and threats must enter the campaign
                # IR used by live scene/NPC/Director queries.
                if entity_kind == "handout":
                    _finish_job(
                        workspace, asset_root_id, job,
                        result="entity_ready",
                        detail={"entity_kind": entity_kind, "target_id": tid},
                    )
                    return {
                        "ok": True,
                        "result": "entity_ready",
                        "target_id": tid,
                    }
                camps = campaigns_using_asset(workspace, asset_root_id)
                merged_for: list[str] = []
                for camp_id in camps:
                    try:
                        camp_dir = (
                            coc_state.coc_root(Path(workspace).resolve())
                            / "campaigns" / camp_id
                        )
                        with coc_fileio.advisory_file_lock(
                            camp_dir / ".progressive-ir.lock", wait_seconds=15.0,
                        ):
                            ir = coc_module_project.load_campaign_ir(camp_dir)
                            ir = coc_module_project.merge_deep_entity_into_ir(
                                ir, entity_kind, pack,
                            )
                            coc_module_project.write_ir_to_campaign(
                                camp_dir, ir, asset_root_id=asset_root_id,
                            )
                            archive = coc_compiled_archive.load_status(camp_dir) or {}
                            detail.setdefault("archive_status", {})[camp_id] = {
                                "status": archive.get("status"),
                                "archive_revision": archive.get("archive_revision"),
                                "error": archive.get("error"),
                            }
                        merged_for.append(camp_id)
                    except Exception as exc:  # noqa: BLE001
                        detail.setdefault("campaign_errors", {})[camp_id] = str(exc)
                detail.update({
                    "entity_kind": entity_kind,
                    "merged_campaigns": merged_for,
                    "parse_state": (pack or {}).get("parse_state"),
                })
                result_name = "merged" if merged_for else "pack_ready_no_campaign"
                _finish_job(
                    workspace, asset_root_id, job,
                    result=result_name,
                    detail=detail,
                )
                return {"ok": True, "result": result_name, **detail}
            req = _write_host_work_request(workspace, asset_root_id, job)
            detail["entity_kind"] = entity_kind
            detail["host_work_request"] = str(req)
            _finish_job(
                workspace, asset_root_id, job,
                result="awaiting_host_pack",
                detail=detail,
            )
            return {"ok": True, "result": "awaiting_host_pack", **detail}

        # Unknown kinds: complete without blocking the queue forever.
        _finish_job(
            workspace, asset_root_id, job,
            result="skipped_unknown_kind",
            detail=detail,
        )
        return {"ok": True, "result": "skipped_unknown_kind", **detail}
    except Exception as exc:  # noqa: BLE001 — worker must isolate per-job failures
        _finish_job(
            workspace, asset_root_id, job,
            result="error",
            detail={"error": str(exc)},
            failed=True,
        )
        return {"ok": False, "error": str(exc), **detail}


def reenqueue_merge_for_entity(
    workspace: Path,
    asset_root_id: str,
    *,
    kind: str,
    target_id: str,
    reason: str = "pack_ready",
) -> dict[str, Any]:
    """After host put_entity deep, enqueue a high-priority merge job and kick worker."""
    job_kind = coc_module_assets.deepen_job_kind(kind)
    enq = coc_module_assets.enqueue_job(
        workspace,
        asset_root_id,
        kind=job_kind,
        target_id=target_id,
        priority=100,
        reason=reason,
    )
    kick = kick_background_worker(workspace)
    return {"enqueue": enq, "kick": kick}


def run_worker_once(
    workspace: Path,
    *,
    parallel: int = DEFAULT_PARALLEL,
    stale_after_s: float = DEFAULT_STALE_IN_FLIGHT_S,
) -> dict[str, Any]:
    """Single drain pass over all asset roots (parallel per batch)."""
    ws = Path(workspace).resolve()
    roots = list_asset_roots_with_work(ws)
    # Also requeue stale on every known module root with a queue file
    assets_root = coc_module_assets.assets_root(ws)
    if assets_root.is_dir():
        for child in assets_root.iterdir():
            if child.is_dir() and (child / "parse-queue.json").is_file():
                if child.name not in roots:
                    # still requeue stale
                    pass
                requeue_stale_in_flight(
                    ws, child.name, stale_after_s=stale_after_s,
                )
                if child.name not in roots:
                    q = _read_queue(ws, child.name)
                    if q.get("pending") or q.get("in_flight"):
                        roots.append(child.name)

    worker_id = f"worker-{os.getpid()}-{int(_now_ts() * 1000) % 100000}"
    claimed_all: list[tuple[str, dict[str, Any]]] = []
    per_root = max(1, int(parallel))
    for root_id in roots:
        requeue_stale_in_flight(ws, root_id, stale_after_s=stale_after_s)
        batch = claim_jobs(
            ws, root_id, limit=per_root, worker_id=worker_id,
        )
        for job in batch:
            claimed_all.append((root_id, job))

    results: list[dict[str, Any]] = []
    if not claimed_all:
        return {
            "claimed": 0,
            "results": [],
            "roots": roots,
            "worker_id": worker_id,
        }

    with ThreadPoolExecutor(max_workers=max(1, int(parallel))) as pool:
        futs = {
            pool.submit(process_claimed_job, ws, root_id, job): (root_id, job)
            for root_id, job in claimed_all
        }
        for fut in as_completed(futs):
            root_id, job = futs[fut]
            try:
                res = fut.result()
            except Exception as exc:  # noqa: BLE001
                res = {"ok": False, "error": str(exc)}
            results.append({
                "asset_root_id": root_id,
                "job_id": job.get("job_id"),
                "target_id": job.get("target_id"),
                "kind": job.get("kind"),
                **res,
            })

    return {
        "claimed": len(claimed_all),
        "results": results,
        "roots": roots,
        "worker_id": worker_id,
    }


def run_worker_loop(
    workspace: Path,
    *,
    parallel: int = DEFAULT_PARALLEL,
    poll_s: float = DEFAULT_POLL_S,
    idle_exit_s: float = DEFAULT_IDLE_EXIT_S,
    stale_after_s: float = DEFAULT_STALE_IN_FLIGHT_S,
) -> dict[str, Any]:
    """Poll until idle for ``idle_exit_s`` then exit (daemon-friendly)."""
    ws = Path(workspace).resolve()
    idle_started: float | None = None
    passes = 0
    total_claimed = 0
    while True:
        passes += 1
        out = run_worker_once(
            ws, parallel=parallel, stale_after_s=stale_after_s,
        )
        claimed = int(out.get("claimed") or 0)
        total_claimed += claimed
        if claimed == 0:
            if idle_started is None:
                idle_started = _now_ts()
            elif (_now_ts() - idle_started) >= float(idle_exit_s):
                return {
                    "stopped": "idle",
                    "passes": passes,
                    "total_claimed": total_claimed,
                }
        else:
            idle_started = None
        time.sleep(max(0.05, float(poll_s)))


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def worker_status(workspace: Path) -> dict[str, Any]:
    ws = Path(workspace).resolve()
    pid_path = _worker_dir(ws) / WORKER_PID_NAME
    if not pid_path.is_file():
        return {"running": False, "pid": None}
    try:
        pid = int(pid_path.read_text(encoding="utf-8").strip().splitlines()[0])
    except (OSError, ValueError):
        return {"running": False, "pid": None, "pid_file_corrupt": True}
    alive = _pid_alive(pid)
    if not alive:
        try:
            pid_path.unlink()
        except OSError:
            pass
        return {"running": False, "pid": pid, "stale_pid_file_removed": True}
    return {"running": True, "pid": pid, "pid_file": str(pid_path)}


def kick_background_worker(
    workspace: Path,
    *,
    parallel: int = DEFAULT_PARALLEL,
    idle_exit_s: float = DEFAULT_IDLE_EXIT_S,
    poll_s: float = DEFAULT_POLL_S,
) -> dict[str, Any]:
    """Non-blocking: start a detached worker process if none is alive.

    Play/dig paths must only call this and return — never wait on host PDF.
    """
    if os.environ.get("COC_DISABLE_QUEUE_WORKER", "").strip().lower() in {
        "1", "true", "yes", "on",
    }:
        return {
            "started": False,
            "already_running": False,
            "disabled": True,
            "reason": "COC_DISABLE_QUEUE_WORKER",
        }
    ws = Path(workspace).resolve()
    status = worker_status(ws)
    if status.get("running"):
        return {"started": False, "already_running": True, **status}

    wdir = _worker_dir(ws)
    pid_path = wdir / WORKER_PID_NAME
    log_path = wdir / WORKER_LOG_NAME
    script = SCRIPT_DIR / "coc_module_queue_worker.py"
    cmd = [
        sys.executable,
        str(script),
        "--workspace",
        str(ws),
        "run",
        "--parallel",
        str(max(1, int(parallel))),
        "--poll",
        str(float(poll_s)),
        "--idle-exit",
        str(float(idle_exit_s)),
        "--write-pid",
        str(pid_path),
    ]
    log_f = open(log_path, "a", encoding="utf-8")  # noqa: SIM115 — detached child owns lifetime
    try:
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=log_f,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            cwd=str(ws),
        )
    finally:
        # Parent closes its fd; child keeps the dup.
        try:
            log_f.close()
        except OSError:
            pass
    # Best-effort pid file if child has not written yet
    try:
        if not pid_path.is_file():
            pid_path.write_text(f"{proc.pid}\n", encoding="utf-8")
    except OSError:
        pass
    return {
        "started": True,
        "already_running": False,
        "pid": proc.pid,
        "log_file": str(log_path),
        "cmd": cmd,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Background parallel progressive parse-queue worker",
    )
    parser.add_argument("--workspace", default=".")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("run", help="run worker loop until idle")
    p.add_argument("--parallel", type=int, default=DEFAULT_PARALLEL)
    p.add_argument("--poll", type=float, default=DEFAULT_POLL_S)
    p.add_argument("--idle-exit", type=float, default=DEFAULT_IDLE_EXIT_S)
    p.add_argument("--stale-after", type=float, default=DEFAULT_STALE_IN_FLIGHT_S)
    p.add_argument("--write-pid", default="", help="path to pid file")

    p = sub.add_parser("once", help="single parallel drain pass")
    p.add_argument("--parallel", type=int, default=DEFAULT_PARALLEL)
    p.add_argument("--stale-after", type=float, default=DEFAULT_STALE_IN_FLIGHT_S)

    p = sub.add_parser("kick", help="non-blocking start detached worker")
    p.add_argument("--parallel", type=int, default=DEFAULT_PARALLEL)
    p.add_argument("--idle-exit", type=float, default=DEFAULT_IDLE_EXIT_S)

    p = sub.add_parser("status", help="is detached worker running?")

    args = parser.parse_args(argv)
    ws = Path(args.workspace).resolve()
    try:
        if args.cmd == "run":
            if args.write_pid:
                Path(args.write_pid).write_text(f"{os.getpid()}\n", encoding="utf-8")
            result = run_worker_loop(
                ws,
                parallel=args.parallel,
                poll_s=args.poll,
                idle_exit_s=args.idle_exit,
                stale_after_s=args.stale_after,
            )
            if args.write_pid:
                try:
                    Path(args.write_pid).unlink()
                except OSError:
                    pass
        elif args.cmd == "once":
            result = run_worker_once(
                ws, parallel=args.parallel, stale_after_s=args.stale_after,
            )
        elif args.cmd == "kick":
            result = kick_background_worker(
                ws, parallel=args.parallel, idle_exit_s=args.idle_exit,
            )
        elif args.cmd == "status":
            result = worker_status(ws)
        else:
            return 1
        print(json.dumps({"ok": True, **result}, ensure_ascii=False, default=str))
        return 0
    except (QueueWorkerError, OSError, json.JSONDecodeError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
