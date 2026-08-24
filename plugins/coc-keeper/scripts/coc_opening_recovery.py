#!/usr/bin/env python3
"""Canonical materialization-watch recovery decision.

Both the Pi host-lifecycle gate in ``coc_toolbox`` and the opening-phase
projection in ``coc_opening_phase`` consume ``decide_materialization_watch_recovery``.
This module classifies a pending opening watch and returns the card payload;
it does not write state, dispatch work, or own host envelopes.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# How long a pending opening projection watch may sit with host-work that was
# never leased (dispatch_attempts=0, no current lease) before recovery treats
# the auto-dispatch owner as lost. A live Pi coordinator claims inside one
# parent turn after bootstrap; 150s is far above that RTT while still short
# enough that a wedged "ready forever" job is recoverable without waiting out
# the full lease window. This is NOT the once-leased-then-gone path.
NEVER_LEASED_GRACE_SECONDS = 150.0
# How long a pending opening projection watch may go without any currently
# leased host work after work was at least once claimed (or after the longer
# grace when lease history is unknown). Deliberately well above the default
# 600s lease so an in-flight batch is never mistaken for a corpse. Distinct
# from the never-leased early dispatch_lost path above.
RESOLVER_GRACE_SECONDS = 900.0

ACTION_POLL_STATUS = "poll_status"
ACTION_REARM_BOOTSTRAP = "rearm_bootstrap"
ACTION_REFRESH_PROJECTION = "refresh_projection"
ACTION_LOST_AFTER_PLAY = "lost_after_play"
ACTION_NONE = "none"

_EMPTY_DECISION = {
    "action": ACTION_NONE,
    "lost_kind": None,
    "source_lifecycle_status": "",
    "operation": None,
    "prefilled_arguments": {},
    "missing_arguments": [],
    "retained_start_location_id": "",
    "recoverable": False,
}


def opening_watch_age_seconds(
    watch: dict[str, Any],
    *,
    now: datetime | None = None,
) -> float | None:
    created = str(watch.get("created_at") or "").strip()
    if not created:
        return None
    try:
        created_at = datetime.fromisoformat(created)
    except ValueError:
        return None
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    clock = now if now is not None else datetime.now(timezone.utc)
    if clock.tzinfo is None:
        clock = clock.replace(tzinfo=timezone.utc)
    return (clock - created_at).total_seconds()


def classify_opening_watch_loss(
    *,
    age_seconds: float | None,
    host_work_rows: list[dict[str, Any]] | None,
    host_work_operational_class,
) -> str | None:
    """Return dispatch_lost / resolver_lost, or None while waiting is honest.

    ``host_work_rows is None`` is an incomplete snapshot, never evidence that
    the owner is gone. Live leased work, young never-leased work, and
    once-leased work inside the long grace stay pending.
    """
    if age_seconds is None or host_work_rows is None:
        return None
    any_leased = any(
        host_work_operational_class(row) == "leased"
        for row in host_work_rows
    )
    if any_leased:
        return None
    ever_leased = any(
        int(row.get("dispatch_attempts") or 0) > 0
        for row in host_work_rows
    )
    if not ever_leased and age_seconds >= NEVER_LEASED_GRACE_SECONDS:
        return "dispatch_lost"
    if age_seconds >= RESOLVER_GRACE_SECONDS:
        return "resolver_lost"
    return None


def retained_bootstrap_arguments(
    watch: dict[str, Any],
    *,
    retained_start_location_title: str = "",
) -> tuple[dict[str, Any], list[str]]:
    """Prefill the retained opening; never invent a start_location title."""
    source_scope = (
        watch.get("source_scope")
        if isinstance(watch.get("source_scope"), dict)
        else {}
    )
    indices = source_scope.get("pdf_indices")
    prefilled: dict[str, Any] = {}
    if (
        isinstance(indices, list)
        and indices
        and all(
            isinstance(value, int) and not isinstance(value, bool)
            for value in indices
        )
    ):
        prefilled["opening_pdf_indices"] = list(indices)
    retained_location_id = str(watch.get("start_location_id") or "").strip()
    retained_title = str(retained_start_location_title or "").strip()
    if retained_location_id and retained_title:
        prefilled["start_location"] = {
            "location_id": retained_location_id,
            "title": retained_title,
        }
    missing: list[str] = []
    if "start_location" not in prefilled:
        missing.append("start_location")
    if "opening_pdf_indices" not in prefilled:
        missing.append("opening_pdf_indices")
    return prefilled, missing


def decide_materialization_watch_recovery(
    *,
    watch_status: str,
    watch: dict[str, Any],
    asset_root_id: str,
    host_work_rows: list[dict[str, Any]] | None,
    campaign_pristine: bool,
    retained_start_location_title: str = "",
    now: datetime | None = None,
    host_work_operational_class=None,
) -> dict[str, Any]:
    """Pure recovery decision for one opening-source materialization watch.

    Callers may format host vs browser envelopes from this result; they must
    not recompute whether or how recovery occurs.
    """
    watch = watch if isinstance(watch, dict) else {}
    status = str(watch_status or "pending")
    root_id = str(asset_root_id or "")
    retained_id = str(watch.get("start_location_id") or "").strip()
    if status == "complete":
        return {
            "action": ACTION_REFRESH_PROJECTION,
            "lost_kind": None,
            "source_lifecycle_status": "complete",
            "operation": "progressive.project_opening",
            "prefilled_arguments": {
                "asset_root_id": root_id,
                "source_file_sha256": str(watch.get("source_file_sha256") or ""),
                "start_location_id": str(watch.get("start_location_id") or ""),
            },
            "missing_arguments": [],
            "retained_start_location_id": retained_id,
            "recoverable": True,
        }
    if status != "pending":
        return {
            **_EMPTY_DECISION,
            "source_lifecycle_status": status,
            "retained_start_location_id": retained_id,
        }
    classifier = host_work_operational_class
    if classifier is None:
        raise TypeError(
            "host_work_operational_class is required for a pending watch"
        )
    lost_kind = classify_opening_watch_loss(
        age_seconds=opening_watch_age_seconds(watch, now=now),
        host_work_rows=host_work_rows,
        host_work_operational_class=classifier,
    )
    if lost_kind is not None and campaign_pristine:
        prefilled, missing = retained_bootstrap_arguments(
            watch,
            retained_start_location_title=retained_start_location_title,
        )
        return {
            "action": ACTION_REARM_BOOTSTRAP,
            "lost_kind": lost_kind,
            "source_lifecycle_status": lost_kind,
            "operation": "progressive.opening_bootstrap",
            "prefilled_arguments": prefilled,
            "missing_arguments": missing,
            "retained_start_location_id": retained_id,
            "recoverable": True,
        }
    if lost_kind is not None:
        return {
            "action": ACTION_LOST_AFTER_PLAY,
            "lost_kind": lost_kind,
            "source_lifecycle_status": "lost_after_play",
            "operation": None,
            "prefilled_arguments": {},
            "missing_arguments": [],
            "retained_start_location_id": retained_id,
            "recoverable": False,
        }
    return {
        "action": ACTION_POLL_STATUS,
        "lost_kind": None,
        "source_lifecycle_status": "pending",
        "operation": "progressive.status",
        "prefilled_arguments": {"asset_root_id": root_id},
        "missing_arguments": [],
        "retained_start_location_id": retained_id,
        "recoverable": True,
    }


def load_opening_watch_host_work(
    root: Path,
    asset_root_id: str,
    *,
    module_assets,
    pure_read: bool = False,
) -> list[dict[str, Any]] | None:
    """Read-only host-work snapshot. None means the snapshot is incomplete."""
    try:
        if pure_read:
            rows = module_assets.inspect_host_work_requests_pure(
                root, asset_root_id, include_closed=False, limit=None,
            )
            if rows is None:
                return None
        else:
            rows = module_assets.list_host_work_requests(
                root, asset_root_id, include_closed=False, limit=None,
            )
    except Exception:
        return None
    return [row for row in rows if isinstance(row, dict)]


def load_retained_location_title(
    root: Path,
    asset_root_id: str,
    location_id: str,
    *,
    module_assets,
) -> str:
    if not location_id:
        return ""
    try:
        skeleton = module_assets.get_skeleton(root, asset_root_id)
    except Exception:
        return ""
    rows = skeleton.get("locations") if isinstance(skeleton, dict) else None
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("location_id") or "") != location_id:
            continue
        title = str(row.get("title") or "").strip()
        if title:
            return title
    return ""


def recover_materialization_watch(
    root: Path,
    campaign_dir: Path,
    *,
    watch_status: str,
    watch: dict[str, Any],
    asset_root_id: str,
    host_work_mode: str = "mutating",
    module_project,
) -> dict[str, Any]:
    """Gather read-only facts, then run the one pure recovery decision."""
    watch = watch if isinstance(watch, dict) else {}
    assets = module_project.coc_module_assets
    rows = load_opening_watch_host_work(
        root,
        asset_root_id,
        module_assets=assets,
        pure_read=(host_work_mode == "pure_read"),
    )
    title = load_retained_location_title(
        root,
        asset_root_id,
        str(watch.get("start_location_id") or ""),
        module_assets=assets,
    )
    return decide_materialization_watch_recovery(
        watch_status=watch_status,
        watch=watch,
        asset_root_id=asset_root_id,
        host_work_rows=rows,
        campaign_pristine=bool(
            module_project.campaign_is_pristine_for_opening(campaign_dir)
        ),
        retained_start_location_title=title,
        host_work_operational_class=assets.host_work_operational_class,
    )


def projection_next_operation(
    decision: dict[str, Any],
    campaign_id: str,
) -> dict[str, Any] | None:
    """Derive/browser card: same decision, no host envelope fields."""
    operation = decision.get("operation")
    if not operation:
        return None
    card: dict[str, Any] = {
        "operation": str(operation),
        "invoke_via": "coc_invoke",
        "campaign": str(campaign_id),
        "arguments": deepcopy(decision.get("prefilled_arguments") or {}),
    }
    if decision.get("action") == ACTION_REARM_BOOTSTRAP:
        card["missing_arguments"] = list(decision.get("missing_arguments") or [])
    return card
