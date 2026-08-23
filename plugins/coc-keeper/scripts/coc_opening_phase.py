#!/usr/bin/env python3
"""Single opening-lifecycle phase derivation for one campaign.

Canonical callers: the Pi opening gate family in ``coc_toolbox``, the
``setup.phase`` query operation, ``setup.complete`` in ``coc_runtime_ops``,
and the web-facing campaign projection. Every consumer reads this one
derivation instead of recomputing campaign status, source binding, opening
source readiness, source sub-phase signals, and chargen completion.

By default, derivation preserves opening-lifecycle materialization: its
``host_work_mode="mutating"`` path may refresh, quarantine, requeue, or otherwise
materialize existing source-lane lifecycle work. Explicit
``host_work_mode="pure_read"`` (observe mode) is for ``parallel_read`` callers:
it is fail-closed and performs no writes, locks, directory creation, refresh,
quarantine, or requeue.

Phases (see the opening lifecycle state machine):

    module_preparation -> character_creation -> ready_for_table -> active

Starter and cold-compiled campaigns are not "another gate": their
``module_preparation`` phase is trivially satisfied, so they enter
``character_creation`` immediately. PDF source-bound campaigns express their
review / adoption / materialization / selection work as ``detail`` sub-phases
of the same ``module_preparation`` phase.
"""
from __future__ import annotations

import importlib.util
import json
import stat
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent

PHASE_MODULE_PREPARATION = "module_preparation"
PHASE_CHARACTER_CREATION = "character_creation"
PHASE_READY_FOR_TABLE = "ready_for_table"
PHASE_ACTIVE = "active"

PHASES = (
    PHASE_MODULE_PREPARATION,
    PHASE_CHARACTER_CREATION,
    PHASE_READY_FOR_TABLE,
    PHASE_ACTIVE,
)

# Source-lane sub-phases of module_preparation. These names are the same
# strings the persisted Pi opening gate envelopes have always carried, so a
# host that already routes on them keeps working after the consolidation.
SUB_PHASE_CONTRACT_INVALID = "opening_source_contract_invalid"
SUB_PHASE_REVIEW_FAILED = "opening_source_review_failed"
SUB_PHASE_REVIEW_REQUIRED = "opening_source_review_required"
SUB_PHASE_FACTS_ADOPTION_REQUIRED = "opening_source_facts_adoption_required"
SUB_PHASE_MATERIALIZATION = "opening_source_materialization"
SUB_PHASE_SELECTION = "opening_selection"

SUB_PHASES = (
    SUB_PHASE_CONTRACT_INVALID,
    SUB_PHASE_REVIEW_FAILED,
    SUB_PHASE_REVIEW_REQUIRED,
    SUB_PHASE_FACTS_ADOPTION_REQUIRED,
    SUB_PHASE_MATERIALIZATION,
    SUB_PHASE_SELECTION,
)

# The character-setup discriminator the source-bound resume path emits.
SUB_PHASE_CHARACTER_SETUP_REQUIRED = "opening_character_setup_required"

_PLACEHOLDER_SCENARIO_PROVENANCE_HINT = "selection_hint_only_not_provenance"
_REVIEWED_PROVENANCE = "coordinator_reviewed_playable_opening"


def _load_sibling(preferred: tuple[str, ...], own_name: str, filename: str):
    """Reuse an already-imported sibling copy, else load our own.

    Hosts import this module either through ``coc_toolbox`` (which already
    registered its own suffixed copies in ``sys.modules``) or standalone from
    the web projection path. Preferring an existing copy avoids re-executing
    heavy canonical modules twice in one process.
    """
    for name in preferred:
        existing = sys.modules.get(name)
        if existing is not None:
            return existing
    if own_name in sys.modules:
        return sys.modules[own_name]
    spec = importlib.util.spec_from_file_location(own_name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[own_name] = module
    spec.loader.exec_module(module)
    return module


def _coc_state():
    return _load_sibling(
        ("coc_state",), "coc_state_opening_phase", "coc_state.py",
    )


def _coc_module_project():
    return _load_sibling(
        ("coc_module_project_toolbox", "coc_module_project"),
        "coc_module_project_opening_phase",
        "coc_module_project.py",
    )


def _coc_runtime_ops():
    return _load_sibling(
        ("coc_runtime_ops_toolbox", "coc_runtime_ops"),
        "coc_runtime_ops_opening_phase",
        "coc_runtime_ops.py",
    )


def _contract_error(
    code: str, message: str, asset_root_id: str | None = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {"code": str(code), "message": str(message)}
    if asset_root_id:
        error["asset_root_id"] = str(asset_root_id)
    return error


def _blank_module_preparation() -> dict[str, Any]:
    return {
        "source_gated": False,
        "satisfied": True,
        "sub_phase": None,
        "asset_root_id": None,
        "source_provenance": "",
        "contract_error": None,
        "review_failure": None,
        "review_task": None,
        "facts_transport": None,
        "watch": None,
        "watch_status": None,
        "readiness": None,
        "blocking_reason": None,
    }


def _readiness_blocking_reason(readiness: dict[str, Any] | None) -> dict[str, Any] | None:
    """Readiness-derived setup-lifecycle blocker (the setup.complete authority)."""
    module_project = _coc_module_project()
    state = str((readiness or {}).get("state") or "")
    if state in {
        module_project.OPENING_SOURCE_NOT_GATED,
        module_project.OPENING_SOURCE_READY,
        "",
    }:
        return None
    if state == module_project.OPENING_SOURCE_FAILED:
        code = "opening_source_failed"
        message = "the bound source opening failed to parse and project"
    elif state == module_project.OPENING_SOURCE_NOT_PREPARED:
        code = "opening_source_not_prepared"
        message = (
            "this campaign is source-bound but no opening projection was ever "
            "prepared"
        )
    else:
        code = "opening_source_pending"
        message = "the background source parse has not projected the opening yet"
    return {
        "code": code,
        "message": message,
        "scope": "opening_source",
        "details": {"readiness": deepcopy(readiness)},
    }


def _module_preparation(
    root: Path,
    campaign_dir: Path,
    campaign_id: str,
    *,
    host_work_mode: str = "mutating",
) -> dict[str, Any]:
    """Derive the source-lane sub-phase for one campaign's opening module work.

    Mirrors the persisted opening source contract exactly: a broken or
    unreviewed source binding stays fail-closed, and only a current, fresh
    opening projection (or the absence of any source binding at all) counts as
    prepared.
    """
    module_project = _coc_module_project()
    runtime_ops = _coc_runtime_ops()
    prep = _blank_module_preparation()
    try:
        prep["readiness"] = module_project.opening_source_readiness(campaign_dir)
    except (OSError, ValueError):
        # Unreadable scenario metadata is reported as a source contract error
        # below; readiness has no opinion about a file it cannot parse.
        prep["readiness"] = None

    def fail_contract(
        code: str, message: str, asset_root_id: str | None = None,
    ) -> dict[str, Any]:
        prep["satisfied"] = False
        prep["sub_phase"] = SUB_PHASE_CONTRACT_INVALID
        prep["source_gated"] = True
        prep["contract_error"] = _contract_error(code, message, asset_root_id)
        if asset_root_id:
            prep["asset_root_id"] = str(asset_root_id)
        prep["blocking_reason"] = _readiness_blocking_reason(prep["readiness"])
        return prep

    scenario_path = campaign_dir / "scenario" / "scenario.json"
    try:
        loaded_scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        loaded_scenario = {}
    except (json.JSONDecodeError, OSError) as exc:
        return fail_contract("opening_scenario_metadata_invalid", str(exc))
    if not isinstance(loaded_scenario, dict):
        return fail_contract(
            "opening_scenario_metadata_invalid",
            "campaign scenario metadata must be an object",
        )
    scenario = loaded_scenario
    scenario_source = (
        scenario.get("source") if isinstance(scenario.get("source"), dict) else {}
    )
    top_provenance = scenario.get("opening_source_provenance")
    nested_provenance = scenario_source.get("opening_source_provenance")
    if (
        top_provenance is not None
        and nested_provenance is not None
        and top_provenance != nested_provenance
    ):
        return fail_contract(
            "opening_source_provenance_mismatch",
            "top-level and nested opening source provenance disagree",
        )
    provenance = str(
        top_provenance
        if top_provenance is not None
        else nested_provenance
        if nested_provenance is not None
        else ""
    ).strip()
    prep["source_provenance"] = provenance

    failure_receipt = scenario.get("opening_source_review_failure")
    if failure_receipt is not None:
        try:
            validated_failure = (
                runtime_ops._validate_opening_source_review_fulfillment(
                    root, failure_receipt, expected_status="failed",
                )
            )
        except runtime_ops.RuntimeOperationError as exc:
            return fail_contract("opening_source_review_failure_invalid", str(exc))
        prep["source_gated"] = True
        prep["satisfied"] = False
        prep["sub_phase"] = SUB_PHASE_REVIEW_FAILED
        prep["review_failure"] = {
            **validated_failure["failure"],
            "coordinator_task_identity_sha256": validated_failure[
                "coordinator_task_identity_sha256"
            ],
            "receipt_sha256": runtime_ops._opening_review_receipt_digest(
                validated_failure
            ),
        }
        prep["blocking_reason"] = _readiness_blocking_reason(prep["readiness"])
        return prep

    if provenance == _PLACEHOLDER_SCENARIO_PROVENANCE_HINT:
        try:
            pending_review = runtime_ops._validate_opening_review_task(
                scenario, expected_status="pending",
            )
        except runtime_ops.RuntimeOperationError as exc:
            return fail_contract("opening_source_review_task_invalid", str(exc))
        prep["source_gated"] = True
        prep["satisfied"] = False
        prep["sub_phase"] = SUB_PHASE_REVIEW_REQUIRED
        prep["review_task"] = {
            "scenario_id": pending_review["scenario_id"],
            "opening_review_generation": pending_review["generation"],
        }
        prep["blocking_reason"] = _readiness_blocking_reason(prep["readiness"])
        return prep

    if provenance not in {"", _REVIEWED_PROVENANCE}:
        return fail_contract(
            "opening_source_provenance_invalid",
            "persisted opening source provenance is unsupported",
        )

    if provenance == _REVIEWED_PROVENANCE:
        try:
            runtime_ops._validate_opening_source_review_fulfillment(
                root,
                scenario.get("opening_source_review_receipt"),
                expected_status="reviewed",
            )
        except runtime_ops.RuntimeOperationError as exc:
            return fail_contract("opening_source_review_receipt_invalid", str(exc))
        if scenario.get("opening_source_facts_transport") is not None:
            try:
                transport = runtime_ops._validate_opening_source_facts_transport(
                    root, str(campaign_id),
                )
            except runtime_ops.RuntimeOperationError:
                return fail_contract(
                    "opening_source_facts_transport_invalid",
                    (
                        "the pending opening source facts transport does not "
                        "match the current reviewed source"
                    ),
                )
            if transport is not None:
                prep["source_gated"] = True
                prep["satisfied"] = False
                prep["sub_phase"] = SUB_PHASE_FACTS_ADOPTION_REQUIRED
                prep["facts_transport"] = {
                    "scenario_id": transport["scenario_id"],
                    "opening_review_generation": transport[
                        "opening_review_generation"
                    ],
                    "facts": deepcopy(transport["facts"]),
                }
                prep["blocking_reason"] = _readiness_blocking_reason(
                    prep["readiness"]
                )
                return prep

    persisted_root_id = str(
        scenario.get("progressive_asset_root_id")
        or scenario.get("source_cache_asset_root_id")
        or ""
    ).strip()
    has_persisted_source_binding = bool(
        persisted_root_id or str(scenario_source.get("bundle_sha256") or "").strip()
    )
    try:
        root_info = module_project.resolve_opening_preparation_root(
            root, str(campaign_id),
        )
    except module_project.OpeningPreparationError as exc:
        if has_persisted_source_binding:
            return fail_contract(
                exc.code, exc.message, persisted_root_id or None,
            )
        # No source binding at all: starter and cold-compiled campaigns have
        # nothing to prepare, so module preparation is trivially satisfied.
        prep["source_gated"] = False
        prep["satisfied"] = True
        prep["sub_phase"] = None
        prep["blocking_reason"] = _readiness_blocking_reason(prep["readiness"])
        return prep

    prep["source_gated"] = True
    asset_root_id = str(root_info["asset_root_id"])
    prep["asset_root_id"] = asset_root_id
    binding = module_project.current_opening_projection_source_binding(campaign_dir)
    receipt = module_project.current_opening_projection_receipt(campaign_dir)
    if isinstance(binding, dict) and isinstance(receipt, dict):
        source_scope = binding.get("source_scope")
        start_location_id = str(binding.get("start_location_id") or "")
        if (
            binding.get("asset_root_id") == asset_root_id
            and start_location_id
            and isinstance(source_scope, dict)
            and module_project.opening_projection_state_is_fresh(
                root,
                campaign_dir,
                asset_root_id,
                start_location_id,
                source_scope,
                host_work_mode=host_work_mode,
            )
        ):
            prep["satisfied"] = True
            prep["sub_phase"] = None
            prep["blocking_reason"] = _readiness_blocking_reason(prep["readiness"])
            return prep

    watch = (
        scenario.get("opening_projection_watch")
        if isinstance(scenario.get("opening_projection_watch"), dict)
        else None
    )
    prep["satisfied"] = False
    if watch is not None:
        prep["sub_phase"] = SUB_PHASE_MATERIALIZATION
        prep["watch"] = deepcopy(watch)
        prep["watch_status"] = str(watch.get("status") or "pending")
    else:
        prep["sub_phase"] = SUB_PHASE_SELECTION
    prep["blocking_reason"] = _readiness_blocking_reason(prep["readiness"])
    return prep


def _party_is_linked(campaign_dir: Path, campaign_id: str) -> bool:
    """True only for one structurally current non-empty party link."""
    party_path = campaign_dir / "party.json"
    try:
        party_mode = party_path.lstat().st_mode
        if not stat.S_ISREG(party_mode):
            return False
        party = json.loads(party_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return False
    if (
        not isinstance(party, dict)
        or party.get("schema_version") != 1
        or party.get("campaign_id") != campaign_id
    ):
        return False
    investigator_ids = party.get("investigator_ids")
    active_ids = party.get("active_investigator_ids")
    return bool(
        isinstance(investigator_ids, list)
        and investigator_ids
        and all(isinstance(value, str) and value for value in investigator_ids)
        and isinstance(active_ids, list)
        and active_ids
        and all(isinstance(value, str) and value for value in active_ids)
        and set(active_ids).issubset(set(investigator_ids))
    )


def _campaign_is_pre_play(campaign_dir: Path) -> bool:
    """No play evidence yet: turn 0, no visited scenes, no scene transitions.

    Unlike ``campaign_is_pristine_for_opening`` this tolerates a preset
    ``active_scene_id``: starter installs (``campaign.quick_start``) point the
    opening scene at creation time, before any play has happened. Actual play
    always leaves visited scenes, a nonzero turn number, or scene-transition
    events.
    """
    def _load(path: Path) -> dict[str, Any]:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        return payload if isinstance(payload, dict) else {}

    world = _load(campaign_dir / "save" / "world-state.json")
    pacing = _load(campaign_dir / "save" / "pacing-state.json")
    if world.get("visited_scene_ids") or world.get("scene_history"):
        return False
    try:
        if int(pacing.get("turn_number") or 0) != 0:
            return False
    except (TypeError, ValueError):
        return False
    events_path = campaign_dir / "logs" / "events.jsonl"
    if events_path.is_file():
        try:
            for line in events_path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                row = json.loads(line)
                if (
                    isinstance(row, dict)
                    and row.get("event_type") == "scene_transition"
                ):
                    return False
        except (OSError, json.JSONDecodeError):
            return False
    return True


def _resume_gate_required(campaign_dir: Path, campaign_id: str) -> bool:
    """One current-source, pre-play, structurally empty party awaiting chargen.

    Deliberately narrower than "no confirmed investigator": it discriminates a
    pre-play campaign whose party file is absent or exactly empty, which is the
    only case where a ``session.resume`` must be sent back to character setup
    instead of the table. Starter installs preset the opening scene pointer at
    creation, so "pre-play" is judged on play evidence (visited scenes, turn
    number, scene transitions), not on a bare active-scene pointer.
    """
    state = _coc_state()
    try:
        campaign_state = state.load_campaign_state(campaign_dir)
        if campaign_state.get("status") == "ready_for_table":
            return False
    except (OSError, ValueError):
        pass
    if not _campaign_is_pre_play(campaign_dir):
        return False
    party_path = campaign_dir / "party.json"
    try:
        party_mode = party_path.lstat().st_mode
    except FileNotFoundError:
        party_mode = None
    except OSError:
        return False
    if party_mode is not None:
        if not stat.S_ISREG(party_mode):
            return False
        try:
            party = json.loads(party_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return False
        if (
            not isinstance(party, dict)
            or party.get("schema_version") != 1
            or party.get("campaign_id") != campaign_id
            or party.get("investigator_ids") != []
            or party.get("active_investigator_ids") != []
        ):
            return False
    return True


def _character_setup(
    campaign_dir: Path, campaign_id: str, campaign: dict[str, Any] | None,
) -> dict[str, Any]:
    state = _coc_state()
    runtime_ops = _coc_runtime_ops()
    confirmed = state.campaign_has_confirmed_investigator(campaign_dir, campaign_id)
    input_mode: str | None = None
    if isinstance(campaign, dict):
        try:
            input_mode = runtime_ops.guided_character_creation_input_mode(
                str(campaign.get("era") or "")
            )
        except (OSError, ValueError):
            input_mode = None
    policy = (
        "kp_guided_era_adaptive"
        if input_mode == "kp_guided_era_adaptive"
        else "guided_quick_fire"
        if input_mode is not None
        else None
    )
    resume_gate = (
        False
        if input_mode is None
        else _resume_gate_required(campaign_dir, campaign_id)
    )
    return {
        "confirmed": bool(confirmed),
        "party_linked": _party_is_linked(campaign_dir, campaign_id),
        "policy": policy,
        "input_mode": input_mode,
        "resume_gate_required": bool(resume_gate),
        "blocking_reason": (
            None
            if confirmed
            else {
                "code": "character_setup_incomplete",
                "message": (
                    "character setup is incomplete; a confirmed investigator "
                    "is required"
                ),
                "scope": "character_setup",
                "details": None,
            }
        ),
    }


def _next_operation(
    phase: str,
    campaign_id: str,
    module_preparation: dict[str, Any],
    character_setup: dict[str, Any],
) -> dict[str, Any] | None:
    """Canonical next operation pointer for the current phase.

    Only fully derivable cards are returned as complete invoke cards. The
    source materialization lifecycle card depends on live host-work leases and
    stays owned by the host gate, so it is reported as ``None`` here with the
    lifecycle facts in ``detail``.
    """
    if phase == PHASE_MODULE_PREPARATION:
        sub_phase = module_preparation.get("sub_phase")
        if sub_phase == SUB_PHASE_FACTS_ADOPTION_REQUIRED:
            transport = module_preparation.get("facts_transport") or {}
            return {
                "operation": "setup.adopt_source_facts",
                "invoke_via": "coc_invoke",
                "campaign": str(campaign_id),
                "arguments": {
                    "campaign_id": str(campaign_id),
                    "facts": deepcopy(transport.get("facts")),
                },
            }
        if sub_phase == SUB_PHASE_SELECTION:
            return {
                "operation": "progressive.prepare_opening",
                "invoke_via": "coc_invoke",
                "campaign": str(campaign_id),
            }
        return None
    if phase == PHASE_CHARACTER_CREATION:
        if character_setup.get("confirmed"):
            return {
                "operation": "setup.complete",
                "invoke_via": "coc_invoke",
                "campaign": str(campaign_id),
            }
        # The KP chooses the chargen route (quick fire run vs guided contract);
        # the phase table already scopes which operations are legal here.
        return None
    if phase == PHASE_READY_FOR_TABLE:
        return {
            "operation": "evidence.table_opening",
            "invoke_via": "coc_invoke",
            "campaign": str(campaign_id),
        }
    return None


def derive_opening_phase(
    root: Path | str,
    campaign_id: str,
    *,
    host_work_mode: str = "mutating",
) -> dict[str, Any]:
    """Derive the single opening lifecycle phase for one campaign.

    Returns ``{schema_version, campaign_id, phase, detail, next_operation,
    blocking_reason}``. The default ``host_work_mode="mutating"`` preserves
    lifecycle materialization; explicit ``host_work_mode="pure_read"`` is the
    fail-closed, no-write observe mode for ``parallel_read`` callers. See the
    module docstring for phase semantics.
    """
    root = Path(root)
    campaign_id = str(campaign_id or "")
    campaign_dir = root / ".coc" / "campaigns" / campaign_id
    state = _coc_state()
    if not campaign_id or not campaign_dir.is_dir():
        return {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "phase": PHASE_MODULE_PREPARATION,
            "detail": {
                "campaign_exists": False,
                "campaign_status": None,
                "session_role": "setup",
                "module_preparation": _blank_module_preparation(),
                "character_setup": {
                    "confirmed": False,
                    "party_linked": False,
                    "policy": None,
                    "input_mode": None,
                    "resume_gate_required": False,
                    "blocking_reason": None,
                },
            },
            "next_operation": None,
            "blocking_reason": {
                "code": "unknown_campaign",
                "message": f"unknown campaign: {campaign_id}",
                "scope": "campaign",
                "details": None,
            },
        }

    try:
        campaign = state.load_campaign_state(campaign_dir)
    except (OSError, ValueError):
        campaign = None
    status = None
    if isinstance(campaign, dict):
        raw_status = campaign.get("status")
        status = raw_status if isinstance(raw_status, str) and raw_status else None

    module_preparation = _module_preparation(
        root,
        campaign_dir,
        campaign_id,
        host_work_mode=host_work_mode,
    )
    character_setup = _character_setup(campaign_dir, campaign_id, campaign)

    if module_preparation["sub_phase"] is not None:
        phase = PHASE_MODULE_PREPARATION
    elif status == "ready_for_table":
        phase = PHASE_READY_FOR_TABLE
    elif status == "active" and character_setup["confirmed"]:
        phase = PHASE_ACTIVE
    else:
        phase = PHASE_CHARACTER_CREATION

    session_role = (
        "play"
        if phase in {PHASE_READY_FOR_TABLE, PHASE_ACTIVE}
        else "setup"
    )
    if phase == PHASE_MODULE_PREPARATION and status in {
        "ready_for_table", "active",
    }:
        # Source repair on an already-handed-off campaign keeps the play role;
        # the sub-phase still describes the outstanding module work.
        session_role = (
            "play"
            if status == "ready_for_table" or character_setup["confirmed"]
            else "setup"
        )

    if phase == PHASE_MODULE_PREPARATION:
        blocking_reason = module_preparation["blocking_reason"]
    elif phase == PHASE_CHARACTER_CREATION:
        blocking_reason = character_setup["blocking_reason"]
    else:
        blocking_reason = None

    return {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "phase": phase,
        "detail": {
            "campaign_exists": True,
            "campaign_status": status,
            "session_role": session_role,
            "module_preparation": module_preparation,
            "character_setup": character_setup,
        },
        "next_operation": _next_operation(
            phase, campaign_id, module_preparation, character_setup,
        ),
        "blocking_reason": blocking_reason,
    }


def opening_phase_projection(root: Path | str, campaign_id: str) -> dict[str, Any]:
    """Small player-safe projection of the derivation for UI consumers.

    Keeps module-source identifiers and coordinator receipts out of the
    browser while still driving character-setup and table-opening rendering.
    """
    derived = derive_opening_phase(root, campaign_id)
    detail = derived["detail"]
    module_preparation = detail["module_preparation"]
    character_setup = detail["character_setup"]
    return {
        "schema_version": 1,
        "phase": derived["phase"],
        "campaign_status": detail["campaign_status"],
        "session_role": detail["session_role"],
        "module_preparation_satisfied": bool(module_preparation["satisfied"]),
        "module_preparation_sub_phase": module_preparation["sub_phase"],
        "source_gated": bool(module_preparation["source_gated"]),
        "character_setup_confirmed": bool(character_setup["confirmed"]),
        "character_setup_policy": character_setup["policy"],
        "next_operation": (
            (derived["next_operation"] or {}).get("operation")
            if derived["next_operation"]
            else None
        ),
        "blocking_reason_code": (
            (derived["blocking_reason"] or {}).get("code")
            if derived["blocking_reason"]
            else None
        ),
    }
