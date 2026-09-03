#!/usr/bin/env python3
"""Operation adapter cell: progressive-source."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    Path,
    ToolError,
    _HERE,
    _PI_SOURCE_COORDINATOR_MAX_ATTEMPTS,
    _fulfill_host_work_for_asset_unlocked,
    _load_sibling,
    _opening_card,
    _read_optional_json,
    _source_host_work_projection,
    _source_submit_lock_path,
    _with_mechanics_locator_discovery,
    coc_fileio,
    coc_module_project,
    coc_runtime_ops,
    deepcopy,
    json,
    os,
    time,
    tool,
    _tool_evidence_record_adoption as _shared_tool_evidence_record_adoption,
)

def _source_pack_dispatch_task(packet: dict[str, Any]) -> dict[str, Any]:
    """Wrap one leased packet as an exact host-dispatchable source task."""
    instruction_ref = str(
        (_HERE.parent / "agents" / "coc-source-pack-worker.md").resolve()
    )
    return {
        "schema_version": 1,
        "contract_id": "coc.codex-source-pack-task.v1",
        "instruction_ref": instruction_ref,
        "model_policy": "inherit_parent",
        "packet": deepcopy(packet),
    }

def _pi_source_pack_dispatch_task(packet: dict[str, Any]) -> dict[str, Any]:
    """Wrap one leased packet as an exact Pi Package source task."""
    task = _source_pack_dispatch_task(packet)
    task["contract_id"] = "coc.pi-source-pack-task.v1"
    return task

def _attach_source_host_projection(
    ctx: Ctx,
    result: dict[str, Any],
    asset_root_id: str,
) -> dict[str, Any]:
    projection = _source_host_work_projection(ctx, asset_root_id)
    result["host_work"] = projection
    if projection.get("background_takeover") is not None:
        result["background_takeover"] = projection["background_takeover"]
    return projection

_OPENING_INPUT_FIELDS = frozenset({
    "start_location_id", "opening_pdf_indices",
    "mechanics_locator_pdf_indices",
    "opening_required_npc_ids", "opening_required_secret_ids",
})

_OPENING_RESULT_CAPS = {
    "start_candidates": 64,
    "blocking": 16,
    "hard_work": 16,
    "soft_work": 32,
    "deferred": 32,
    "mutation_cards": 5,
}

_OPENING_PREPARATION_DATA_MAX_BYTES = 12 * 1024

_OPENING_PREPARATION_MCP_RESERVE_BYTES = 1024

_OPENING_SAFE_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"

def _opening_start_selector(value: Any, *, required: bool) -> str | None:
    try:
        return coc_module_project.parse_opening_start_selector(
            value,
            required=required,
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError("invalid_param", exc.message) from exc

def _opening_id_list(value: Any, field: str, *, maximum: int = 32) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not value:
        raise ToolError("invalid_param", f"{field} must be a non-empty array")
    if len(value) > maximum:
        raise ToolError("invalid_param", f"{field} accepts at most {maximum} ids")
    rows: list[str] = []
    for index, raw in enumerate(value):
        if not isinstance(raw, str) or not raw.strip():
            raise ToolError(
                "invalid_param", f"{field}[{index}] must be a non-empty string",
            )
        text = raw.strip()
        try:
            coc_module_project.coc_module_assets._require_id(
                text, f"{field}[{index}]",
            )
        except coc_module_project.coc_module_assets.ModuleAssetsError as exc:
            raise ToolError("invalid_param", str(exc)) from exc
        if text in rows:
            raise ToolError("invalid_param", f"{field} must contain unique ids")
        rows.append(text)
    return rows

def _opening_page_list(
    value: Any,
    *,
    field: str = "opening_pdf_indices",
) -> list[int] | None:
    if value is None:
        return None
    if not isinstance(value, list) or not value:
        raise ToolError(
            "invalid_param", f"{field} must contain 1..3 pages"
        )
    if len(value) > 3:
        raise ToolError(
            "invalid_param", f"{field} must contain 1..3 pages"
        )
    if any(
        isinstance(row, bool) or not isinstance(row, int) or row < 0
        for row in value
    ):
        raise ToolError(
            "invalid_param",
            f"{field} must be non-negative integers",
        )
    if len(value) != len(set(value)):
        raise ToolError(
            "invalid_param", f"{field} must not contain duplicates"
        )
    return list(value)

def _opening_activation_card(start_location_id: str) -> dict[str, Any]:
    """Return the explicit, advisory initial scene activation card."""
    card = _opening_card(
        "state.move_scene",
        {
            "scene_id": start_location_id,
            "defer_initial_progressive_on_enter": True,
        },
        ["decision_id"],
    )
    card.update({"authority": "advisory", "hard_gate": False})
    return card

def _opening_skeleton_argument_contract(
    root_info: dict[str, Any],
) -> dict[str, Any]:
    """Describe the smallest source-bound Tier-1 skeleton the host must judge."""
    return {
        "schema_version": 1,
        "contract_id": "coc.progressive-opening-skeleton-argument.v1",
        "closed": True,
        "semantic_scope": "small_accepted_source_window_only",
        "guessing_allowed": False,
        "full_module_scan_allowed": False,
        "prefilled_template": {
            "schema_version": 1,
            "parse_tier": 1,
            "source": {
                key: root_info[key]
                for key in ("source_id", "file_sha256", "page_count", "producer")
            },
            "start_candidates": ["<source-grounded-location-id>"],
            "locations": [{
                "location_id": "<same-start-location-id>",
                "title": "<source-grounded-title>",
                "parse_state": "toc_only",
            }],
            "mechanics_locator_pass_status": "pending",
            "mechanics_index": [],
            "start_clock_status": "unresolved",
        },
        "start_clock_source_ref_template": {
            "source_id": root_info["source_id"],
            "pdf_index": "<selected-zero-based-pdf-index>",
        },
        "first_submission_guidance": {
            "authority": "advisory",
            "hard_gate": False,
            "copy_prefilled_template": True,
            "replace_placeholders_only": True,
            "omit_optional_source_evidenced_fields": True,
            "source_clock_exception": (
                "when the selected opening pages explicitly author the starting "
                "date/time or day phase, set start_clock_status=source and add only "
                "start_clock plus start_clock_source_refs copied from "
                "start_clock_source_ref_template once per supporting selected page; "
                "when a time or phase "
                "is authored without a date, keep local_datetime/local_date null and "
                "use calendar_mode=relative, time_precision=day_phase, a semantic "
                "day_phase_hint, and the exact source-supported display"
            ),
        },
        "required_fields": [
            "schema_version",
            "parse_tier",
            "source",
            "start_candidates",
            "locations",
            "mechanics_locator_pass_status",
            "start_clock_status",
        ],
        "source_required_fields": [
            "source_id", "file_sha256", "page_count", "producer",
        ],
        "start_clock_source_ref_required_fields": ["source_id", "pdf_index"],
        "location_required_fields": [
            "location_id", "title", "parse_state",
        ],
        "location_parse_state_enum": sorted(
            coc_module_project.coc_module_assets.PARSE_STATES
        ),
        "optional_source_evidenced_fields": [
            "edges_provisional",
            "npc_roster",
            "item_roster",
            "start_clock",
            "start_clock_source_refs",
        ],
        "rules": [
            "start_candidates must be non-empty and each id must match a locations[].location_id",
            "mechanics_index=[] is valid while mechanics_locator_pass_status=pending",
            "for the first submission, copy the prefilled template, replace only its placeholders, and omit optional source-evidenced fields except an explicitly authored start_clock plus exact source refs",
            "add optional roster, edges, mechanics locators, or start_clock only when supported by accepted source evidence",
            "do not guess unresolved facts or scan the full module",
        ],
    }

def _cap_opening_rows(
    data: dict[str, Any], key: str, rows: list[dict[str, Any]],
) -> None:
    cap = _OPENING_RESULT_CAPS[key]
    data[key] = rows[:cap]
    data[f"{key}_total"] = len(rows)
    data[f"{key}_returned_count"] = len(data[key])
    data[f"{key}_omitted_count"] = max(0, len(rows) - len(data[key]))

def _opening_encoded_data_bytes(data: dict[str, Any]) -> int:
    for _ in range(8):
        encoded_size = len(json.dumps(
            data, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        ).encode("utf-8"))
        if data.get("encoded_data_bytes") == encoded_size:
            return encoded_size
        data["encoded_data_bytes"] = encoded_size
    return len(json.dumps(
        data, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8"))

def _fit_opening_data_budget(
    data: dict[str, Any],
    *,
    selected_start_location_id: str | None,
) -> None:
    """Shrink optional rows in one stable order after their static caps."""
    collection_keys = (
        "start_candidates", "deferred", "soft_work", "hard_work",
        "blocking", "mutation_cards",
    )
    total_keys = {
        "start_candidates": "start_candidate_total",
        "deferred": "deferred_total",
        "soft_work": "soft_work_total",
        "hard_work": "hard_work_total",
        "blocking": "blocking_total",
        "mutation_cards": "mutation_cards_total",
    }

    def refresh_counts(key: str) -> None:
        returned = len(data.get(key) or [])
        total = int(data.get(total_keys[key]) or 0)
        prefix = "start_candidate" if key == "start_candidates" else key
        data[f"{prefix}_returned_count"] = returned
        data[f"{prefix}_omitted_count"] = max(0, total - returned)

    for key in collection_keys:
        refresh_counts(key)
    build_budget = (
        _OPENING_PREPARATION_DATA_MAX_BYTES
        - _OPENING_PREPARATION_MCP_RESERVE_BYTES
    )
    while _opening_encoded_data_bytes(data) > build_budget:
        removed = False
        for key in collection_keys:
            rows = data.get(key)
            if not isinstance(rows, list) or not rows:
                continue
            if key == "start_candidates" and selected_start_location_id:
                removable_index = next(
                    (
                        index for index in range(len(rows) - 1, -1, -1)
                        if str((rows[index] or {}).get("location_id") or "")
                        != selected_start_location_id
                    ),
                    None,
                )
                if removable_index is None:
                    continue
                rows.pop(removable_index)
            else:
                rows.pop()
            refresh_counts(key)
            removed = True
            break
        if not removed:
            # Selection hints are best-effort: sacrifice byte-heavy previews
            # (e.g. CJK pages) only when nothing else can shrink, and say so
            # rather than failing the whole preparation closed.
            candidates = data.get("opening_page_candidates")
            if isinstance(candidates, list) and any(
                isinstance(row, dict) and row.get("text_preview")
                for row in candidates
            ):
                for row in candidates:
                    if isinstance(row, dict):
                        row.pop("text_preview", None)
                data["text_preview_omitted_for_budget"] = True
                continue
            code = (
                "opening_selected_candidate_too_large"
                if selected_start_location_id
                else "opening_result_too_large"
            )
            raise ToolError(
                code,
                "mandatory opening preparation data exceeds the 12 KiB budget",
            )
    _opening_encoded_data_bytes(data)

def _tool_progressive_prepare_opening(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    extras = set(args) - _OPENING_INPUT_FIELDS
    if extras:
        raise ToolError(
            "invalid_param",
            "progressive.prepare_opening accepts only structured opening selectors",
        )
    start_arg = _opening_start_selector(
        args.get("start_location_id"),
        required=False,
    )
    pages_arg = _opening_page_list(args.get("opening_pdf_indices"))
    locator_pages_arg = _opening_page_list(
        args.get("mechanics_locator_pdf_indices"),
        field="mechanics_locator_pdf_indices",
    )
    required_npcs = _opening_id_list(
        args.get("opening_required_npc_ids"), "opening_required_npc_ids",
    )
    required_secrets = _opening_id_list(
        args.get("opening_required_secret_ids"), "opening_required_secret_ids",
    )
    try:
        root_info = coc_module_project.resolve_opening_preparation_root(
            ctx.root, str(ctx.campaign_id),
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError(exc.code, exc.message) from exc
    assets_mod = coc_module_project.coc_module_assets
    root_id = str(root_info["asset_root_id"])
    skeleton = assets_mod.get_skeleton(ctx.root, root_id)
    data: dict[str, Any] = {
        "schema_version": 1,
        "experimental": True,
        "component_ready": True,
        "asset_root_id": root_id,
        "source": {
            key: root_info[key]
            for key in ("source_id", "file_sha256", "bundle_sha256", "page_count", "producer")
        },
        "link_state": root_info["link_state"],
        "source_window_ready": False,
        "skeleton_ready": isinstance(skeleton, dict),
        "selected_start_pack_ready": False,
        "projection_inputs_ready": False,
        "projected_selected_start_ready": False,
        "ready_to_activate": False,
        "active_scene_ready": False,
        "opening_ready": False,
        "selected_start_location_id": None,
        "source_window": None,
        "cached_page_refs": [],
        "window_origin": None,
        "ownership": {
            "kind": "diagnostic_work_planner",
            "narrator": False,
            "compiler": False,
            "semantic_model": False,
            "player_action_gate": False,
            "background_supervisor": False,
        },
        "limitations": [
            "component-ready experimental setup surface only",
            "no automatic source extraction, host callback, queue drain, or deferred-work resume",
        ],
        "contract_refs": [
            "coc.source-pack-worker.v1",
            "progressive.fulfill_host_work",
        ],
    }
    blocking: list[dict[str, Any]] = []
    hard_work: list[dict[str, Any]] = []
    soft_work: list[dict[str, Any]] = []
    deferred: list[dict[str, Any]] = []
    cards: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    selected: str | None = None
    window: dict[str, Any] | None = None
    readiness: dict[str, Any] | None = None

    if not isinstance(skeleton, dict):
        blocking.append({"code": "opening_skeleton_missing", "entity_id": root_id})
        if pages_arg is None:
            try:
                data.update(assets_mod.opening_page_candidate_catalog(
                    ctx.root,
                    root_id,
                    bundle_sha256=str(root_info["bundle_sha256"]),
                ))
            except assets_mod.ModuleAssetsError as exc:
                raise ToolError(
                    "opening_source_catalog_invalid", str(exc),
                ) from exc
        else:
            try:
                scope = assets_mod.validate_opening_source_window(
                    ctx.root,
                    root_id,
                    bundle_sha256=str(root_info["bundle_sha256"]),
                    pdf_indices=pages_arg,
                )
            except assets_mod.ModuleAssetsError as exc:
                raise ToolError(
                    "opening_source_window_invalid", str(exc),
                ) from exc
            module_root = assets_mod._module_dir(ctx.root, root_id)
            data["source_window_ready"] = True
            data["source_window"] = list(scope["pdf_indices"])
            data["window_origin"] = "host_selected_pre_skeleton"
            data["cached_page_refs"] = [
                {
                    **deepcopy(ref),
                    "path": str(
                        module_root / "pages" / f"{int(ref['pdf_index']):04d}.md"
                    ),
                }
                for ref in scope["page_refs"]
            ]
        bootstrap_prefill: dict[str, Any] = {}
        bootstrap_missing = ["start_location", "opening_pdf_indices"]
        if pages_arg is not None:
            bootstrap_prefill["opening_pdf_indices"] = list(pages_arg)
            bootstrap_missing = ["start_location"]
        next_operation = _opening_card(
            "progressive.opening_bootstrap",
            bootstrap_prefill,
            bootstrap_missing,
        )
        next_operation.update({
            "hard_gate": True,
            "authority": "canonical_setup",
            "selection_contract": {
                "start_location": {
                    "location_id": "source-grounded stable id",
                    "title": "source-grounded table-language title",
                },
                "opening_pdf_indices": (
                    "shortest sufficient contiguous 1..3-page authored opening"
                ),
            },
            "reason": (
                "After semantic selection from this bounded catalog, bootstrap "
                "the exact opening before any live-play operation."
            ),
        })
        data["next_operation"] = next_operation
        publish_card = _opening_card(
            "progressive.publish_skeleton",
            {"asset_root_id": root_id, "source_file_sha256": root_info["file_sha256"]},
            ["skeleton"],
        )
        publish_card["skeleton_argument_contract"] = (
            _opening_skeleton_argument_contract(root_info)
        )
        cards.append(publish_card)
    else:
        candidates = coc_module_project.opening_start_candidates(skeleton)
        try:
            selected = coc_module_project.select_opening_start(
                ctx.campaign_dir, skeleton, start_arg,
            )
        except coc_module_project.OpeningPreparationError as exc:
            if exc.code == "opening_start_selection_required":
                blocking.append({"code": exc.code})
            else:
                raise ToolError(exc.code, exc.message) from exc
        if selected is not None:
            data["selected_start_location_id"] = selected
            try:
                binding_result = coc_module_project.resolve_selected_opening_binding(
                    ctx.root,
                    root_info,
                    skeleton,
                    selected,
                    pages_arg,
                    required_npc_ids=required_npcs,
                    required_secret_ids=required_secrets,
                )
                window = {
                    "window_origin": binding_result["window_origin"],
                    "scope": binding_result["scope"],
                }
                readiness = binding_result["readiness"]
            except coc_module_project.OpeningPreparationError as exc:
                if exc.code == "opening_source_window_required":
                    blocking.append({"code": exc.code, "entity_id": selected})
                    if pages_arg is None:
                        # The durable skeleton carries no exact opening locator
                        # for this start, so the host must semantically pick
                        # the window.  Never leave the Keeper on a bare
                        # blocking row: surface the bounded candidate catalog
                        # and an explicit re-entry card, mirroring the
                        # skeleton-missing selection lane.
                        try:
                            data.update(assets_mod.opening_page_candidate_catalog(
                                ctx.root,
                                root_id,
                                bundle_sha256=str(root_info["bundle_sha256"]),
                            ))
                        except assets_mod.ModuleAssetsError as catalog_exc:
                            raise ToolError(
                                "opening_source_catalog_invalid", str(catalog_exc),
                            ) from catalog_exc
                        window_selection_card = _opening_card(
                            "progressive.opening_bootstrap",
                            {
                                "start_location": {
                                    "location_id": selected,
                                    "title": next(
                                        (
                                            str(row.get("title") or "")
                                            for row in candidates
                                            if str(row.get("location_id") or "")
                                            == selected
                                        ),
                                        "",
                                    ),
                                },
                            },
                            ["opening_pdf_indices"],
                        )
                        window_selection_card.update({
                            "hard_gate": True,
                            "authority": "canonical_setup",
                            "selection_contract": {
                                "opening_pdf_indices": (
                                    "shortest sufficient contiguous 1..3-page "
                                    "authored opening chosen from "
                                    "opening_page_candidates"
                                ),
                            },
                            "reason": (
                                "the durable skeleton carries no exact opening "
                                "locator for this start; choose "
                                "opening_pdf_indices from the bounded candidate "
                                "catalog and bootstrap the exact opening once."
                            ),
                        })
                        data["next_operation"] = window_selection_card
                else:
                    raise ToolError(exc.code, exc.message) from exc
            if window is not None:
                scope = window["scope"]
                data["source_window_ready"] = True
                data["window_origin"] = window["window_origin"]
                data["source_window"] = list(scope["pdf_indices"])
                data["cached_page_refs"] = deepcopy(scope["page_refs"][:3])
                data["selected_start_pack_ready"] = bool(readiness["ready"])
                data["projection_inputs_ready"] = bool(readiness["ready"])
                data["present_npc_ids"] = list(readiness["present_npc_ids"][:32])
                data["required_secret_status"] = list(
                    readiness["required_secret_status"][:32]
                )
                blocking.extend(deepcopy(readiness["blocking"]))
                for advisory in readiness.get("advisories") or []:
                    if (
                        not isinstance(advisory, dict)
                        or advisory.get("code") != "opening_npc_agenda_missing"
                    ):
                        continue
                    soft_work.append(deepcopy(advisory))
                    deferred.append({
                        "code": "opening_npc_agenda_deferred",
                        "entity_id": str(advisory.get("entity_id") or "")[:128],
                        "reason": "not_required_for_opening",
                    })

                all_requests = assets_mod.list_host_work_requests(
                    ctx.root, root_id, include_closed=True, limit=None,
                )
                exact_requests = [
                    row for row in all_requests
                    if row.get("kind") == "partial_opening"
                    and row.get("request_purpose") == assets_mod.FOREGROUND_OPENING_PURPOSE
                    and str(row.get("target_id") or "") == selected
                    and row.get("requested_source_scope") == scope
                ]
                open_exact = next(
                    (
                        row for row in exact_requests
                        if row.get("status") not in {"fulfilled", "cancelled", "superseded"}
                    ),
                    None,
                )
                if not readiness["ready"]:
                    hard_work.append({
                        "code": "opening_pack_required",
                        "entity_kind": "location",
                        "entity_id": selected,
                        "job_id": (open_exact or {}).get("job_id"),
                        "request_purpose": assets_mod.FOREGROUND_OPENING_PURPOSE,
                    })
                if open_exact is not None:
                    cards.append(_opening_card(
                        "progressive.fulfill_host_work",
                        {},
                        ["worker_result", "host_task_timing"],
                    ))
                elif not readiness["ready"]:
                    cards.append(_opening_card(
                        "progressive.request_opening_pack",
                        {
                            "asset_root_id": root_id,
                            "source_file_sha256": root_info["file_sha256"],
                            "start_location_id": selected,
                            "opening_pdf_indices": list(scope["pdf_indices"]),
                            "request_purpose": assets_mod.FOREGROUND_OPENING_PURPOSE,
                        },
                        [],
                    ))
                if readiness["ready"]:
                    projected_ready = (
                        coc_module_project.opening_projection_state_is_fresh(
                            ctx.root,
                            ctx.campaign_dir,
                            root_id,
                            selected,
                            scope,
                        )
                    )
                    data["projected_selected_start_ready"] = projected_ready
                    if not projected_ready:
                        blocking.append({
                            "code": "opening_projection_required",
                            "entity_id": selected,
                        })
                        cards.append(_opening_card(
                            "progressive.project_opening",
                            {
                                "asset_root_id": root_id,
                                "source_file_sha256": root_info["file_sha256"],
                                "start_location_id": selected,
                                "opening_pdf_indices": list(scope["pdf_indices"]),
                            },
                            [],
                        ))
                    world = ctx.world()
                    active_ready = (
                        projected_ready
                        and str(world.get("active_scene_id") or "") == selected
                    )
                    data["active_scene_ready"] = active_ready
                    data["ready_to_activate"] = (
                        projected_ready
                        and coc_module_project.campaign_is_pristine_for_opening(
                            ctx.campaign_dir
                        )
                    )
                    data["opening_ready"] = active_ready
                    if data["ready_to_activate"]:
                        cards.append(_opening_activation_card(selected))

                selected_job_ids = {
                    str(row.get("job_id") or "") for row in exact_requests
                }
                for row in all_requests:
                    job_id = str(row.get("job_id") or "")
                    if not job_id or job_id in selected_job_ids:
                        continue
                    soft_work.append({
                        "code": "deferred_host_work",
                        "job_id": job_id,
                        "entity_id": str(row.get("target_id") or "")[:128],
                    })
                    deferred.append({
                        "code": "not_required_for_opening",
                        "job_id": job_id,
                        "entity_id": str(row.get("target_id") or "")[:128],
                    })

        if str(skeleton.get("mechanics_locator_pass_status") or "") == "pending":
            soft_work.append({
                "code": "mechanics_locator_pass_pending",
                "required_for_opening": False,
                "hard_gate": False,
            })
            deferred.append({
                "code": "mechanics_locator_pass_deferred",
                "reason": "idle_warm_not_required_for_opening",
            })
            locator_prefill: dict[str, Any] = {
                "asset_root_id": root_id,
                "source_file_sha256": root_info["file_sha256"],
                "request_purpose": assets_mod.MECHANICS_LOCATOR_PURPOSE,
            }
            locator_missing = ["mechanics_locator_pdf_indices"]
            if locator_pages_arg is None:
                try:
                    catalog = assets_mod.opening_page_candidate_catalog(
                        ctx.root,
                        root_id,
                        bundle_sha256=str(root_info["bundle_sha256"]),
                    )
                except assets_mod.ModuleAssetsError as exc:
                    raise ToolError(
                        "mechanics_locator_source_catalog_invalid", str(exc),
                    ) from exc
                data["mechanics_locator_page_candidates"] = deepcopy(
                    catalog["opening_page_candidates"]
                )
                data["mechanics_locator_page_candidate_total"] = int(
                    catalog["opening_page_candidate_total"]
                )
                data["mechanics_locator_page_candidate_complete"] = True
                data["mechanics_locator_page_candidate_role"] = (
                    "selection_hint_only_not_provenance"
                )
            else:
                try:
                    locator_scope = assets_mod.validate_opening_source_window(
                        ctx.root,
                        root_id,
                        bundle_sha256=str(root_info["bundle_sha256"]),
                        pdf_indices=locator_pages_arg,
                    )
                except assets_mod.ModuleAssetsError as exc:
                    raise ToolError(
                        "mechanics_locator_source_window_invalid", str(exc),
                    ) from exc
                locator_prefill["mechanics_locator_pdf_indices"] = list(
                    locator_scope["pdf_indices"]
                )
                locator_missing = []
                data["mechanics_locator_source_window"] = list(
                    locator_scope["pdf_indices"]
                )
            locator_card = _opening_card(
                "progressive.request_locator_pass",
                locator_prefill,
                locator_missing,
            )
            locator_card.update({
                "authority": "advisory",
                "hard_gate": False,
                "required_for_opening": False,
                "deadline_class": "idle_warm",
            })
            cards.append(locator_card)

    selected_candidate = next(
        (row for row in candidates if row.get("location_id") == selected), None,
    )
    bounded_candidates = [
        {"location_id": str(row.get("location_id") or "")[:128],
         "title": str(row.get("title") or "")[:160]}
        for row in candidates[:_OPENING_RESULT_CAPS["start_candidates"]]
    ]
    if selected_candidate is not None and all(
        row["location_id"] != selected for row in bounded_candidates
    ):
        bounded_candidates[-1:] = [{
            "location_id": str(selected_candidate.get("location_id") or "")[:128],
            "title": str(selected_candidate.get("title") or "")[:160],
        }]
    data["start_candidates"] = bounded_candidates
    data["start_candidate_total"] = len(candidates)
    data["start_candidate_returned_count"] = len(bounded_candidates)
    data["start_candidate_omitted_count"] = max(0, len(candidates) - len(bounded_candidates))
    _cap_opening_rows(data, "blocking", blocking)
    _cap_opening_rows(data, "hard_work", hard_work)
    _cap_opening_rows(data, "soft_work", soft_work)
    _cap_opening_rows(data, "deferred", deferred)
    _cap_opening_rows(data, "mutation_cards", cards)
    data["encoded_data_budget_bytes"] = _OPENING_PREPARATION_DATA_MAX_BYTES
    data["encoded_data_bytes"] = 0
    _fit_opening_data_budget(
        data,
        selected_start_location_id=selected,
    )
    hints = [
        "use only the mutation cards whose prerequisites fit the current setup; "
        "this diagnostic does not impose a Keeper call sequence or gate play",
    ]
    if data.get("opening_page_candidates") and pages_arg is None:
        hints.append(
            "opening_page_candidates is the bounded complete cached selection "
            "catalog: semantically choose a structured source-grounded start "
            "and the shortest sufficient contiguous 1..3-page authored opening, "
            "then invoke data.next_operation as progressive.opening_bootstrap "
            "exactly once; never guess page indices, scan beyond this catalog, "
            "publish a skeleton separately, or enter live play first"
        )
    return data, [], hints

def _l0_direct_opening_projection(
    ctx: Ctx,
    *,
    root_info: dict[str, Any],
    location_id: str,
    title: str,
    pages: list[int],
    scope: dict[str, Any],
) -> dict[str, Any] | None:
    """Direct-write the opening scene from the source-reviewed module-init L0.

    Returns a ``source_work``-shaped receipt when the module-init L0 is present
    and validated for this campaign, or ``None`` when the legacy foreground
    ``partial_opening`` host-work lane must be used instead.  The direct write
    lifts the L0 opening hooks into a canonical source-bound location pack
    (player hooks -> read_aloud, keeper hooks -> keeper_only), stores it through
    the ordinary entity boundary, projects the canonical opening slice, and
    drains the exact campaign watch — with no claim/fulfill coordinator spine.
    """
    module_init_ready, _module_init_reason, document = (
        coc_runtime_ops._pi_module_init_l0_status(
            ctx.root, str(ctx.campaign_id),
        )
    )
    if not module_init_ready or not isinstance(document, dict):
        return None
    l0 = document.get("l0")
    if not isinstance(l0, dict):
        return None
    assets_mod = coc_module_project.coc_module_assets
    # Idempotent short-circuit: the direct write already projected this exact
    # source window (durable receipt + binding + ready L0 pack).  A duplicate
    # bootstrap then reports current and the outer flow drains the watch to
    # re-project, instead of re-writing the entity pack.
    current_binding = (
        coc_module_project.current_opening_projection_source_binding(
            ctx.campaign_dir,
        )
    )
    if (
        isinstance(current_binding, dict)
        and str(current_binding.get("start_location_id") or "") == location_id
        and coc_module_project.current_opening_projection_receipt(
            ctx.campaign_dir,
        ) is not None
        and bool(coc_module_project.opening_pack_readiness(
            ctx.root,
            root_info["asset_root_id"],
            location_id,
            required_source_scope=scope,
        ).get("ready"))
    ):
        return {
            "status": "current",
            "idempotent": True,
            "direct_write": True,
            "origin": "module_init_l0",
            "asset_root_id": root_info["asset_root_id"],
            "start_location_id": location_id,
        }
    try:
        refs = assets_mod.cached_source_refs(
            ctx.root,
            root_info["asset_root_id"],
            {"source_refs": list(scope["page_refs"])},
            field="opening_l0_direct",
        )
        pack = coc_module_project.build_l0_direct_opening_pack(
            l0,
            location_id=location_id,
            title=title,
            source_refs=refs,
            scope_pdf_indices=pages,
        )
        # Opening handouts join the unified verbatim-card pipeline: each L0
        # opening card becomes a canonical handout entity that the selected-
        # opening projection reprojects into the campaign card store.
        opening_cards = coc_runtime_ops.l0_opening_handout_cards(
            l0,
            scene_id=location_id,
        )
        for card in opening_cards:
            assets_mod.cached_source_refs(
                ctx.root,
                root_info["asset_root_id"],
                {"source_refs": list(card["source_refs"])},
                field=f"opening_handout {card['handout_id']}",
                allow_string_refs=True,
            )
        # All location and handout source refs are now proven against the bound
        # root. Only after that closed validation may durable entities/jobs land.
        stored = assets_mod.put_entity(
            ctx.root,
            root_info["asset_root_id"],
            "location",
            location_id,
            pack,
        )
        opening_card_ids: list[str] = []
        opening_card_jobs: list[dict[str, Any]] = []
        for card in opening_cards:
            assets_mod.put_entity(
                ctx.root,
                root_info["asset_root_id"],
                "handout",
                str(card["handout_id"]),
                card,
            )
            opening_card_ids.append(str(card["asset_id"]))
            opening_card_jobs.append(assets_mod.enqueue_job(
                ctx.root,
                root_info["asset_root_id"],
                kind="deepen_handout",
                target_id=str(card["handout_id"]),
                priority=100,
                reason="module_init_l0_opening_handout",
                consumer_refs=[assets_mod.campaign_consumer_ref(
                    ctx.root,
                    str(ctx.campaign_id),
                    root_info["asset_root_id"],
                    intent_kind="scene_enter",
                )],
            ))
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError(
            "opening_l0_direct_write_invalid", str(exc),
        ) from exc
    try:
        projection = coc_module_project.project_selected_opening(
            ctx.root,
            str(ctx.campaign_id),
            root_info["asset_root_id"],
            str(root_info["file_sha256"]),
            location_id,
            pages,
        )
        drain = coc_module_project.drain_opening_projection_watches(
            ctx.root,
            root_info["asset_root_id"],
            start_location_id=location_id,
            source_scope_signature=assets_mod.opening_source_scope_signature(
                scope
            ),
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError(exc.code, exc.message) from exc
    except coc_module_project.ModuleProjectError as exc:
        raise ToolError("opening_projection_failed", str(exc)) from exc
    # Opening cards stop at the candidate set: setup only materializes card
    # entities and their campaign projection. Delivery timing is always the
    # KP's semantic judgment — the KP hands the opening cards to the players
    # right after the table opening via state.deliver_handout (same path as
    # every other card). No delivery write happens here.
    return {
        "status": "complete",
        "idempotent": False,
        "direct_write": True,
        "origin": "module_init_l0",
        "asset_root_id": root_info["asset_root_id"],
        "start_location_id": location_id,
        "stored_entity": stored,
        "opening_handout_card_ids": opening_card_ids,
        "opening_handout_jobs": opening_card_jobs,
        "opening_projection": projection,
        "watch_drain": drain,
    }

def _tool_progressive_opening_bootstrap(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    start = args.get("start_location")
    if not isinstance(start, dict) or set(start) != {"location_id", "title"}:
        raise ToolError(
            "invalid_param",
            "start_location must contain exactly location_id and title",
        )
    location_id = _opening_start_selector(
        start.get("location_id"), required=True,
    )
    title = str(start.get("title") or "").strip()
    if not title or len(title) > 240:
        raise ToolError("invalid_param", "start_location.title is required")
    pages = _opening_page_list(args.get("opening_pdf_indices"))
    assert pages is not None
    if pages != sorted(pages) or any(
        right != left + 1 for left, right in zip(pages, pages[1:])
    ):
        raise ToolError(
            "invalid_param",
            "opening_pdf_indices must be ascending and contiguous",
        )
    try:
        root_info = coc_module_project.resolve_opening_preparation_root(
            ctx.root, str(ctx.campaign_id),
        )
        scope = coc_module_project.coc_module_assets.validate_opening_source_window(
            ctx.root,
            root_info["asset_root_id"],
            bundle_sha256=root_info["bundle_sha256"],
            pdf_indices=pages,
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError(exc.code, exc.message) from exc
    except coc_module_project.coc_module_assets.ModuleAssetsError as exc:
        raise ToolError("opening_source_window_invalid", str(exc)) from exc
    # A duplicate bootstrap can arrive after the opening has already reached
    # live play (for example, an extension retry races the initial scene move).
    # It must never attempt a second projection over played state.  Verify the
    # exact requested source-bound projection is still current, then return a
    # purely read-only receipt before the pristine-only bootstrap path.
    if not coc_module_project.campaign_is_pristine_for_opening(
        root_info["campaign_dir"]
    ) and coc_module_project.opening_projection_state_is_fresh(
        ctx.root,
        root_info["campaign_dir"],
        root_info["asset_root_id"],
        location_id,
        scope,
    ):
        receipt = coc_module_project.current_opening_projection_receipt(
            root_info["campaign_dir"],
        )
        return {
            "status": "current",
            "idempotent": True,
            "idempotent_reason": "opening_already_current_after_play",
            "asset_root_id": root_info["asset_root_id"],
            "source_file_sha256": root_info["file_sha256"],
            "start_location": {
                "location_id": location_id,
                "title": title,
            },
            "opening_pdf_indices": pages,
            "skeleton_store": None,
            "sparse_projection": {
                "status": "current",
                "projected": True,
                "idempotent": True,
                "opening_projection_receipt": receipt,
            },
            "projection_watch": None,
            "source_work": {
                "status": "current",
                "idempotent": True,
                "worker_kick": {
                    "started": False,
                    "reason": "opening_already_current_after_play",
                },
            },
        }, [], [
            "opening is already current in played campaign state; duplicate "
            "bootstrap was a no-op"
        ]
    if not coc_module_project.campaign_is_pristine_for_opening(
        root_info["campaign_dir"]
    ):
        raise ToolError(
            "opening_bootstrap_non_pristine",
            "opening bootstrap cannot overwrite played campaign state",
        )
    assets_mod = coc_module_project.coc_module_assets
    skeleton = assets_mod.get_skeleton(ctx.root, root_info["asset_root_id"])
    stored: dict[str, Any] | None = None
    pending_skeleton: dict[str, Any] | None = None
    if skeleton is None:
        pending_skeleton = {
            "schema_version": 1,
            "parse_tier": 1,
            "source": {
                key: root_info[key]
                for key in ("source_id", "file_sha256", "page_count", "producer")
            },
            "module_identity": deepcopy(root_info["module_identity"]),
            "start_candidates": [location_id],
            "locations": [{
                "location_id": location_id,
                "title": title,
                "parse_state": "toc_only",
            }],
            "mechanics_locator_pass_status": "pending",
            "mechanics_index": [],
            "start_clock_status": "unresolved",
        }
    else:
        matching = [
            row for row in (skeleton.get("locations") or [])
            if isinstance(row, dict)
            and row.get("location_id") == location_id
            and str(row.get("title") or "").strip() == title
        ]
        if (
            location_id not in (skeleton.get("start_candidates") or [])
            or len(matching) != 1
        ):
            raise ToolError(
                "opening_bootstrap_conflict",
                "existing skeleton has a different start location id/title",
            )
    try:
        # Conflict-first reservation: no source/campaign projection mutation
        # occurs until the exact campaign-owned watch has been validated.
        watch = coc_module_project.register_opening_projection_watch(
            ctx.root,
            str(ctx.campaign_id),
            asset_root_id=root_info["asset_root_id"],
            source_file_sha256=root_info["file_sha256"],
            bundle_sha256=root_info["bundle_sha256"],
            start_location_id=location_id,
            source_scope=scope,
        )
        if pending_skeleton is not None:
            try:
                stored = assets_mod.put_skeleton(
                    ctx.root, root_info["asset_root_id"], pending_skeleton,
                )
            except assets_mod.ModuleAssetsError as exc:
                raise ToolError(
                    "opening_skeleton_store_failed", str(exc),
                ) from exc
        projected = coc_module_project.project_skeleton_to_campaign(
            ctx.root,
            str(ctx.campaign_id),
            root_info["asset_root_id"],
            opening_start_location_id=location_id,
            opening_source_scope=scope,
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError(exc.code, exc.message) from exc
    except coc_module_project.ModuleProjectError as exc:
        raise ToolError("opening_sparse_projection_failed", str(exc)) from exc
    request_data, request_warnings, request_hints = (
        _l0_direct_opening_projection(
            ctx,
            root_info=root_info,
            location_id=location_id,
            title=title,
            pages=pages,
            scope=scope,
        )
    ), [], []
    if request_data is None:
        request_data, request_warnings, request_hints = (
            _tool_progressive_request_opening_pack(ctx, {
                "asset_root_id": root_info["asset_root_id"],
                "source_file_sha256": root_info["file_sha256"],
                "start_location_id": location_id,
                "opening_pdf_indices": pages,
                "request_purpose": assets_mod.FOREGROUND_OPENING_PURPOSE,
                "execution_owner": "opening_source_coordinator",
            })
        )
    if request_data.get("status") == "current":
        request_data["automatic_projection"] = (
            coc_module_project.drain_opening_projection_watches(
                ctx.root,
                root_info["asset_root_id"],
                start_location_id=location_id,
                source_scope_signature=assets_mod.opening_source_scope_signature(
                    scope
                ),
            )
        )
    return {
        "status": request_data.get("status"),
        "idempotent": stored is None and bool(request_data.get("idempotent")),
        "asset_root_id": root_info["asset_root_id"],
        "source_file_sha256": root_info["file_sha256"],
        "start_location": {
            "location_id": location_id,
            "title": title,
        },
        "opening_pdf_indices": pages,
        "skeleton_store": stored,
        "sparse_projection": projected,
        "projection_watch": watch,
        "source_work": request_data,
    }, request_warnings, request_hints

def _tool_progressive_publish_skeleton(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    try:
        root_info = coc_module_project.resolve_opening_preparation_root(
            ctx.root, str(ctx.campaign_id),
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError(
            exc.code,
            exc.message,
            details={
                "status": "validation_failed", "complete": False,
                "stored": False, "projected": False,
            },
        ) from exc
    root_id = str(args.get("asset_root_id") or "").strip()
    source_sha = str(args.get("source_file_sha256") or "").strip()
    if root_id != root_info["asset_root_id"] or source_sha != root_info["file_sha256"]:
        raise ToolError(
            "opening_source_identity_mismatch",
            "publish arguments do not match the campaign-bound source root",
            details={
                "status": "validation_failed", "complete": False,
                "stored": False, "projected": False,
            },
        )
    skeleton = deepcopy(args.get("skeleton"))
    if not isinstance(skeleton, dict):
        raise ToolError(
            "invalid_param",
            "skeleton must be an object",
            details={
                "status": "validation_failed", "complete": False,
                "stored": False, "projected": False,
            },
        )
    assets_mod = coc_module_project.coc_module_assets
    try:
        stored = assets_mod.put_skeleton(ctx.root, root_id, skeleton)
    except assets_mod.SkeletonStorePhaseError as exc:
        return {
            "status": "stored_metadata_failed",
            "complete": False,
            "stored": True,
            "projected": False,
            "asset_root_id": root_id,
            "store": exc.store_result,
            "pending_phase": "parse_tier_registry_identity",
            "metadata_error": exc.metadata_error,
            "retry_card": _opening_card(
                "progressive.publish_skeleton",
                {"asset_root_id": root_id, "source_file_sha256": source_sha},
                ["skeleton"],
            ),
        }, [
            "skeleton.json committed but parse-tier registry identity did not; "
            "retry the same publication before sparse projection"
        ], []
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError(
            "invalid_param",
            str(exc),
            details={
                "status": "validation_failed", "complete": False,
                "stored": False, "projected": False,
            },
        ) from exc
    try:
        projected = coc_module_project.project_skeleton_to_campaign(
            ctx.root, str(ctx.campaign_id), root_id,
        )
    except Exception as exc:  # store truth is intentionally not rolled back
        return {
            "status": "stored_projection_failed",
            "complete": False,
            "stored": True,
            "projected": False,
            "asset_root_id": root_id,
            "store": stored,
            "projection_error": {
                "type": type(exc).__name__[:80],
                "message": str(exc)[:320],
            },
            "retry_card": _opening_card(
                "progressive.publish_skeleton",
                {"asset_root_id": root_id, "source_file_sha256": source_sha},
                ["skeleton"],
            ),
        }, [
            "skeleton storage completed but sparse projection failed; source truth was not rolled back"
        ], []
    return {
        "status": "complete",
        "complete": True,
        "stored": True,
        "projected": True,
        "asset_root_id": root_id,
        "store": stored,
        "projection": projected,
    }, [], [
        "skeleton and sparse projection are available; selected opening depth remains a separate explicit step"
    ]

def _tool_progressive_request_opening_pack(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    selected_arg = _opening_start_selector(
        args.get("start_location_id"),
        required=True,
    )
    assets_mod = coc_module_project.coc_module_assets
    if args.get("request_purpose") != assets_mod.FOREGROUND_OPENING_PURPOSE:
        raise ToolError(
            "invalid_param",
            "request_purpose must equal foreground_opening_slice",
        )
    try:
        root_info = coc_module_project.resolve_opening_preparation_root(
            ctx.root, str(ctx.campaign_id),
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError(exc.code, exc.message) from exc
    root_id = str(args.get("asset_root_id") or "").strip()
    source_sha = str(args.get("source_file_sha256") or "").strip()
    if root_id != root_info["asset_root_id"] or source_sha != root_info["file_sha256"]:
        raise ToolError(
            "opening_source_identity_mismatch",
            "request arguments do not match the campaign-bound source root",
        )
    skeleton = assets_mod.get_skeleton(ctx.root, root_id)
    if not isinstance(skeleton, dict):
        raise ToolError("opening_skeleton_missing", "publish the skeleton first")
    try:
        selected = coc_module_project.select_opening_start(
            ctx.campaign_dir,
            skeleton,
            selected_arg,
        )
        binding_result = coc_module_project.resolve_selected_opening_binding(
            ctx.root,
            root_info,
            skeleton,
            selected,
            _opening_page_list(args.get("opening_pdf_indices")),
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError(exc.code, exc.message) from exc
    window = {
        "window_origin": binding_result["window_origin"],
        "scope": binding_result["scope"],
    }
    readiness = binding_result["readiness"]
    if readiness["ready"]:
        ingest_receipt = assets_mod.current_ingest_fulfillment_receipt(
            readiness.get("pack") or {}
        )
        return {
            "status": "current",
            "idempotent": True,
            "asset_root_id": root_id,
            "start_location_id": selected,
            "request_purpose": assets_mod.FOREGROUND_OPENING_PURPOSE,
            "source_scope_signature": assets_mod.opening_source_scope_signature(
                window["scope"]
            ),
            "job_id": str((ingest_receipt or {}).get("job_id") or "") or None,
            "worker_kick": {"started": False, "reason": "opening_pack_already_ready"},
        }, [], []
    caller_owns_materialization = (
        args.get("execution_owner") == "opening_source_coordinator"
    )
    try:
        stub = assets_mod.ensure_stub(
            ctx.root,
            root_id,
            "location",
            selected,
            reason="foreground_opening_slice",
        )
        queued = assets_mod.enqueue_job(
            ctx.root,
            root_id,
            kind="partial_opening",
            target_id=selected,
            priority=100,
            reason="foreground_opening_slice",
            request_purpose=assets_mod.FOREGROUND_OPENING_PURPOSE,
            requested_source_scope=window["scope"],
            work_level="current_dependency",
            dependency_ref={
                "operation": "progressive.project_opening",
                "subject": {"kind": "location", "id": selected},
                "source_scope_signature": (
                    assets_mod.opening_source_scope_signature(window["scope"])
                ),
            },
            consumer_refs=[
                assets_mod.campaign_consumer_ref(
                    ctx.root,
                    str(ctx.campaign_id),
                    root_id,
                    intent_kind="opening",
                )
            ],
            kick_worker=not caller_owns_materialization,
            materialization_owner=(
                "opening_bootstrap"
                if caller_owns_materialization else None
            ),
        )
    except assets_mod.ModuleAssetsError as exc:
        code = (
            "opening_source_scope_conflict"
            if "opening_source_scope_conflict" in str(exc)
            else "invalid_param"
        )
        raise ToolError(code, str(exc)) from exc
    job_id = str((queued.get("job") or {}).get("job_id") or "")
    if caller_owns_materialization:
        worker_mod = _load_sibling(
            "coc_module_queue_worker_opening_bootstrap",
            "coc_module_queue_worker.py",
        )
        try:
            worker_mod.materialize_exact_caller_owned_host_work(
                ctx.root,
                root_id,
                job_id=job_id,
                materialization_owner="opening_bootstrap",
            )
        except (
            worker_mod.QueueWorkerError,
            assets_mod.ModuleAssetsError,
            coc_fileio.CampaignLockError,
        ) as exc:
            raise ToolError(
                "opening_host_work_materialization_failed",
                str(exc),
            ) from exc
    all_open_host_work = assets_mod.list_host_work_requests(
        ctx.root, root_id, limit=None,
    )
    open_request = next(
        (
            row for row in all_open_host_work
            if str(row.get("job_id") or "") == job_id
        ),
        None,
    )
    worker_kick = queued.get("worker_kick") or {}
    if (
        not caller_owns_materialization
        and open_request is None
        and (
            worker_kick.get("started") is True
            or worker_kick.get("already_running") is True
        )
    ):
        # The detached queue worker only converts deterministic queue state into
        # a host-work row.  Give that local handoff a very small grace interval
        # so this same response can carry the dispatch card instead of forcing
        # another LLM status/discovery round trip.
        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline:
            time.sleep(0.05)
            all_open_host_work = assets_mod.list_host_work_requests(
                ctx.root, root_id, limit=None,
            )
            open_request = next(
                (
                    row for row in all_open_host_work
                    if str(row.get("job_id") or "") == job_id
                ),
                None,
            )
            if open_request is not None:
                break
    if caller_owns_materialization and open_request is None:
        raise ToolError(
            "opening_host_work_materialization_failed",
            "exact opening job has no durable host-work request",
        )
    data = {
        "status": "queued" if queued.get("enqueued") else "coalesced",
        "idempotent": bool(queued.get("deduped")),
        "asset_root_id": root_id,
        "start_location_id": selected,
        "request_purpose": assets_mod.FOREGROUND_OPENING_PURPOSE,
        "source_scope_signature": assets_mod.opening_source_scope_signature(
            window["scope"]
        ),
        "requested_source_scope": window["scope"],
        "job_id": job_id,
        "dedupe_state": queued.get("dedupe_state"),
        "worker_kick": queued.get("worker_kick"),
        "host_request_id": (
            str((open_request or {}).get("job_id") or "") or None
        ),
        "stub_created": bool(stub.get("created")),
    }
    if open_request is not None:
        host_projection = _source_host_work_projection(
            ctx,
            root_id,
            all_open_host_work=all_open_host_work,
            execution_owner=(
                str(args.get("execution_owner") or "").strip() or None
            ),
        )
        takeover = host_projection.get("background_takeover")
        data["host_work"] = {
            key: value
            for key, value in host_projection.items()
            if key != "background_takeover"
        }
        if takeover is not None:
            data["background_takeover"] = takeover
        elif caller_owns_materialization:
            # "No takeover" is not a reason. The common cause is that every
            # candidate job has spent its dispatch attempts, and the job simply
            # disappears from the claim candidates with nothing said — the same
            # unexplained-refusal shape as the opening gates. Name it.
            exhausted = [
                str(row.get("job_id") or "")
                for row in all_open_host_work or []
                if int(row.get("dispatch_attempts") or 0)
                >= _PI_SOURCE_COORDINATOR_MAX_ATTEMPTS
            ]
            if exhausted:
                raise ToolError(
                    "opening_host_work_dispatch_attempts_exhausted",
                    "every candidate opening host-work request has reached the "
                    f"dispatch attempt ceiling of "
                    f"{_PI_SOURCE_COORDINATOR_MAX_ATTEMPTS} "
                    f"(job_ids: {', '.join(sorted(exhausted))}); a graceful "
                    "release refunds host-side failures, so this ceiling means "
                    "the work itself kept failing and needs an explicit "
                    "decision rather than another automatic retry",
                )
            raise ToolError(
                "opening_host_work_takeover_unavailable",
                "exact opening host-work request has no canonical takeover",
            )
    return data, [], [
        "host-work materialization is deterministic bookkeeping; a host source "
        "worker must still return the exact partial pack"
    ]

def _tool_progressive_request_locator_pass(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    assets_mod = coc_module_project.coc_module_assets
    if args.get("request_purpose") != assets_mod.MECHANICS_LOCATOR_PURPOSE:
        raise ToolError(
            "invalid_param", "request_purpose must equal mechanics_locator_pass",
        )
    try:
        root_info = coc_module_project.resolve_opening_preparation_root(
            ctx.root, str(ctx.campaign_id),
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError(exc.code, exc.message) from exc
    root_id = str(args.get("asset_root_id") or "").strip()
    source_sha = str(args.get("source_file_sha256") or "").strip()
    if root_id != root_info["asset_root_id"] or source_sha != root_info["file_sha256"]:
        raise ToolError(
            "mechanics_locator_source_identity_mismatch",
            "request arguments do not match the campaign-bound source root",
        )
    skeleton = assets_mod.get_skeleton(ctx.root, root_id)
    if not isinstance(skeleton, dict):
        raise ToolError("opening_skeleton_missing", "publish the skeleton first")
    if skeleton.get("mechanics_locator_pass_status") == "complete":
        return {
            "status": "current",
            "idempotent": True,
            "asset_root_id": root_id,
            "worker_kick": {"started": False, "reason": "locator_pass_complete"},
        }, [], []
    pages = _opening_page_list(
        args.get("mechanics_locator_pdf_indices"),
        field="mechanics_locator_pdf_indices",
    )
    try:
        scope = assets_mod.validate_opening_source_window(
            ctx.root,
            root_id,
            bundle_sha256=str(root_info["bundle_sha256"]),
            pdf_indices=pages,
        )
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError(
            "mechanics_locator_source_window_invalid", str(exc),
        ) from exc
    checked_scope = skeleton.get("mechanics_locator_scope")
    if (
        isinstance(checked_scope, dict)
        and str(checked_scope.get("source_file_sha256") or "").lower()
        == str(scope["file_sha256"]).lower()
        and set(scope["pdf_indices"]).issubset(
            set(checked_scope.get("pdf_indices") or [])
        )
    ):
        return {
            "status": "current",
            "idempotent": True,
            "asset_root_id": root_id,
            "request_purpose": assets_mod.MECHANICS_LOCATOR_PURPOSE,
            "requested_source_scope": scope,
            "source_scope_signature": assets_mod.opening_source_scope_signature(scope),
            "job_id": None,
            "worker_kick": {
                "started": False,
                "reason": "locator_window_already_reviewed",
            },
            "required_for_opening": False,
            "hard_gate": False,
            "deadline_class": "idle_warm",
        }, [], []
    try:
        queued = assets_mod.enqueue_job(
            ctx.root,
            root_id,
            kind="locate_mechanics_index",
            target_id=assets_mod.MECHANICS_LOCATOR_TARGET_ID,
            priority=20,
            reason=assets_mod.MECHANICS_LOCATOR_PURPOSE,
            request_purpose=assets_mod.MECHANICS_LOCATOR_PURPOSE,
            requested_source_scope=scope,
            consumer_refs=[
                assets_mod.campaign_consumer_ref(
                    ctx.root,
                    str(ctx.campaign_id),
                    root_id,
                    intent_kind="mechanics",
                )
            ],
        )
    except assets_mod.ModuleAssetsError as exc:
        code = (
            "mechanics_locator_source_scope_conflict"
            if "mechanics_locator_source_scope_conflict" in str(exc)
            else "mechanics_locator_source_window_invalid"
        )
        raise ToolError(code, str(exc)) from exc
    job_id = str((queued.get("job") or {}).get("job_id") or "")
    return {
        "status": "queued" if queued.get("enqueued") else "coalesced",
        "idempotent": bool(queued.get("deduped")),
        "asset_root_id": root_id,
        "request_purpose": assets_mod.MECHANICS_LOCATOR_PURPOSE,
        "requested_source_scope": scope,
        "source_scope_signature": assets_mod.opening_source_scope_signature(scope),
        "job_id": job_id,
        "dedupe_state": queued.get("dedupe_state"),
        "worker_kick": queued.get("worker_kick"),
        "required_for_opening": False,
        "hard_gate": False,
        "deadline_class": "idle_warm",
    }, [], [
        "claim/spawn/forward this exact packet opportunistically; opening and ordinary play remain available",
    ]

def _tool_progressive_project_opening(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    try:
        root_info = coc_module_project.resolve_opening_preparation_root(
            ctx.root, str(ctx.campaign_id),
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError(exc.code, exc.message) from exc
    assets_mod = coc_module_project.coc_module_assets
    opening_work = [
        row for row in assets_mod.list_host_work_requests(
            ctx.root,
            root_info["asset_root_id"],
            include_closed=False,
            limit=None,
        )
        if row.get("kind") == "partial_opening"
        and row.get("request_purpose") == assets_mod.FOREGROUND_OPENING_PURPOSE
        and row.get("operational_class") in {
            "runnable", "leased", "awaiting_cache", "awaiting_scope",
        }
    ]
    leased_work = [
        row for row in opening_work
        if row.get("operational_class") == "leased"
    ]
    if leased_work:
        return {
            "status": "source_lifecycle_in_flight",
            "projection_deferred": True,
            "idempotent": True,
            "retry_required": False,
            "projection_owner": "campaign_opening_projection_watch",
            "open_job_ids": [
                str(row.get("job_id") or "")
                for row in leased_work
                if str(row.get("job_id") or "")
            ],
            "lifecycle_states": ["leased"],
        }, [], [
            "do not repeat project_opening while the exact source lease has "
            "an active owner; ordinary scene queries and play remain available",
        ]
    if opening_work:
        host_projection = _source_host_work_projection(
            ctx,
            root_info["asset_root_id"],
            all_open_host_work=opening_work,
            execution_owner="opening_source_coordinator",
        )
        classes = sorted({
            str(row.get("operational_class") or "")
            for row in opening_work
        })
        background_takeover = host_projection.get("background_takeover")
        if isinstance(background_takeover, dict):
            status = "source_recovery_ready"
        else:
            status = "source_recovery_waiting"
        return {
            "status": status,
            "projection_deferred": False,
            "projection_ready": False,
            "retry_required": isinstance(
                background_takeover, dict,
            ),
            "open_job_ids": [
                str(row.get("job_id") or "")
                for row in opening_work
                if str(row.get("job_id") or "")
            ],
            "lifecycle_states": classes,
            "normal_next_operation": {
                "operation": "scene.context",
                "arguments": {},
            },
            "host_work": host_projection,
            **(
                {"background_takeover": background_takeover}
                if isinstance(background_takeover, dict) else {}
            ),
        }, [], [
            "this source request has no active lease owner; use the returned "
            "recovery action when present, or continue through the next "
            "ordinary scene.context without polling progressive.status",
        ]
    selected_arg = _opening_start_selector(
        args.get("start_location_id"),
        required=True,
    )
    pages_arg = _opening_page_list(args.get("opening_pdf_indices"))
    try:
        result = coc_module_project.project_selected_opening(
            ctx.root,
            str(ctx.campaign_id),
            str(args.get("asset_root_id") or ""),
            str(args.get("source_file_sha256") or ""),
            selected_arg,
            pages_arg,
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError(exc.code, exc.message) from exc
    except coc_module_project.ModuleProjectError as exc:
        raise ToolError("opening_projection_failed", str(exc)) from exc
    if coc_module_project.campaign_is_pristine_for_opening(ctx.campaign_dir):
        result["activation_operation"] = _opening_activation_card(
            str(result.get("start_location_id") or selected_arg)
        )
    return result, [], [
        "selected authored opening projection is current; activation remains an explicit scene mutation"
    ]

def _tool_progressive_request_mechanics(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    try:
        result = coc_module_project.request_mechanics(
            ctx.root,
            ctx.campaign_id,
            kind=str(args["kind"]),
            target_id=str(args["target_id"]),
            title=str(args.get("title") or "") or None,
            reason=str(args.get("reason") or "mechanics_required"),
        )
    except coc_module_project.ModuleProjectError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    result, _locator_discovery = _with_mechanics_locator_discovery(
        ctx,
        result,
        subject_kind=str(args["kind"]),
        subject_id=str(args["target_id"]),
    )
    return result, [], list(result.get("host_hints") or [])

def _tool_progressive_follow_mentions(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    mentions = args.get("mentions")
    if not isinstance(mentions, list):
        raise ToolError("invalid_param", "mentions must be an array")
    try:
        result = coc_module_project.follow_structured_mentions(
            ctx.root,
            ctx.campaign_id,
            mentions,
            reason=str(args.get("reason") or "structured_mention"),
        )
    except coc_module_project.ModuleProjectError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    except Exception as exc:
        raise ToolError("progressive_error", f"follow_mentions failed: {exc}") from exc
    return result, [], list(result.get("host_hints") or [])

def _tool_progressive_register_source_bundle(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    root_id = coc_module_project.campaign_asset_root_id(ctx.campaign_dir)
    if not root_id:
        raise ToolError("invalid_param", "campaign is not progressive")
    assets_mod = coc_module_project.coc_module_assets
    try:
        result = assets_mod.register_source_bundle(
            ctx.root,
            Path(str(args.get("source_bundle_path") or "")).expanduser().resolve(),
            asset_root_id=root_id,
        )
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    if str(result.get("asset_root_id") or "") != root_id:
        raise ToolError(
            "source_identity_mismatch",
            "source bundle resolved to a different progressive asset root",
        )
    _attach_source_host_projection(ctx, result, root_id)
    return result, [], [
        "reviewed pages are now cached; claim background host work again so its "
        "exact cached_page_refs refresh without reopening the PDF",
    ]

def _tool_progressive_claim_host_work(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    root_id = coc_module_project.campaign_asset_root_id(ctx.campaign_dir)
    if not root_id:
        raise ToolError("invalid_param", "campaign is not progressive")
    assets_mod = coc_module_project.coc_module_assets
    try:
        requested_delivery = str(
            args.get("result_delivery") or "named_submit"
        )
        private_claim = args.get("current_dependency_claim")
        exact_job_id = None
        if private_claim is not None:
            if (
                str(os.environ.get("COC_HOST") or "").lower() != "pi"
                or requested_delivery != "task_return_to_parent"
                or not isinstance(private_claim, dict)
                or set(private_claim)
                != {
                    "campaign_id", "dependency_id", "job_id",
                    "dependency_ref",
                }
            ):
                raise assets_mod.ModuleAssetsError(
                    "current_dependency_claim is reserved for one exact "
                    "private Pi coordinator task"
                )
            job_id = str(private_claim.get("job_id") or "").strip()
            canonical_ref = assets_mod.validate_host_work_dependency_ref(
                private_claim.get("dependency_ref")
            )
            dependency_id = assets_mod.current_dependency_projection_id(
                str(ctx.campaign_id),
                root_id,
                canonical_ref,
            )
            expected_executor = f"source-current-dependency:{dependency_id}"
            if (
                not job_id
                or private_claim.get("campaign_id") != str(ctx.campaign_id)
                or private_claim.get("dependency_id") != dependency_id
                or str(args.get("executor_id") or "") != expected_executor
                or args.get("limit", 1) != 1
            ):
                raise assets_mod.ModuleAssetsError(
                    "private current dependency claim identity drift"
                )
            open_request = next(
                (
                    row for row in assets_mod.list_host_work_requests(
                        ctx.root,
                        root_id,
                        include_closed=False,
                        limit=None,
                    )
                    if str(row.get("job_id") or "") == job_id
                ),
                None,
            )
            if (
                not isinstance(open_request, dict)
                or open_request.get("work_level") != "current_dependency"
                or open_request.get("dependency_ref") != canonical_ref
            ):
                raise assets_mod.ModuleAssetsError(
                    "private current dependency claim no longer owns its "
                    "exact open typed request"
                )
            exact_job_id = job_id
        packet_delivery = (
            "return_to_parent"
            if requested_delivery == "task_return_to_parent"
            else requested_delivery
        )
        result = assets_mod.claim_host_work_requests(
            ctx.root,
            root_id,
            executor_id=str(args.get("executor_id") or ""),
            limit=args.get("limit", 1),
            lease_seconds=args.get("lease_seconds", 600),
            cached_only=True,
            result_delivery=packet_delivery,
            max_dispatch_attempts=args.get("max_dispatch_attempts"),
            exact_job_id=exact_job_id,
            # Lease only as many groups as the bounded inline claim wire can
            # carry; a larger batch would void its own projection at
            # transport time and release every lease it just took.
            max_projected_wire_bytes=assets_mod.CLAIM_WIRE_BUDGET_BYTES,
        )
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    result_delivery = str(args.get("result_delivery") or "named_submit")
    is_headless = str(os.environ.get("COC_PI_HEADLESS") or "").lower() in {"1", "true", "yes"}
    if result_delivery in {"named_submit", "task_return_to_parent"}:
        packets = [
            packet for packet in result.pop("packets", [])
            if isinstance(packet, dict)
        ]
        if is_headless:
            # Headless/RPC mode has no host spawn-child capability. Keep the
            # raw packets (with cached_page_refs) so the KP can read the source
            # pages directly, but do NOT emit dispatch_tasks that would instruct
            # spawning a background source-pack child the host cannot create.
            result["packets"] = packets
            result["dispatch_task_count"] = 0
        else:
            task_builder = (
                _pi_source_pack_dispatch_task
                if str(os.environ.get("COC_HOST") or "").lower() == "pi"
                else _source_pack_dispatch_task
            )
            result["dispatch_tasks"] = [task_builder(packet) for packet in packets]
            result["dispatch_task_count"] = len(result["dispatch_tasks"])
    if is_headless:
        hints = [
            "headless mode: this host cannot spawn a background source-pack child. "
            "Each packets[] entry carries cached_page_refs (paths to cached source "
            "page text). Read those pages directly, extract the location/clue/NPC "
            "pack semantically, and submit it once via progressive.fulfill_host_work.",
            "if you cannot produce a valid pack, do NOT loop on claim/fulfill: fall "
            "back to the existing skeleton topology plus cached page text and continue "
            "the opening narration directly. Unfinished progressive work stays queued "
            "and never blocks play.",
        ]
    else:
        hints = [
            "for named_submit, spawn one background source-pack child per exact "
            "returned dispatch_tasks[] value and continue play; add no transcript, "
            "prefix, suffix, or reconstructed wrapper",
            "for task_return_to_parent, spawn the exact dispatch task immediately; "
            "do not poll or retrieve output, and on its natural completion forward "
            "each exact results[i] once through progressive.fulfill_host_work",
            "return_to_parent is reserved for a capability-advertised lifecycle "
            "or source owner; it receives bare packets[] values and follows the "
            "exact returned takeover card before forwarding results[i] through "
            "progressive.fulfill_host_work",
        ]
    if not result.get("dispatch_tasks") and not result.get("packets"):
        hints.append(
            "no exact cached-page group is ready; unresolved or uncached requests "
            "remain visible in progressive.status for a bounded host PDF window"
        )
    warnings: list[str] = []
    if _pi_auto_dispatch_active() and result_delivery != "task_return_to_parent":
        # The Pi coordinator child always claims with
        # result_delivery=task_return_to_parent (validated in
        # pi/lib/runtime.ts); any other delivery on Pi is the main Keeper
        # racing the auto-dispatched coordinator.
        warnings.append(
            "Pi source-work race: progressive.claim_host_work was called with "
            f"result_delivery={result_delivery!r}. "
            + _PI_SOURCE_WORK_RACE_WARNING
        )
    return result, warnings, hints

def _tool_progressive_renew_host_work_leases(ctx: Ctx, args: dict[str, Any]):
    assets_mod = coc_module_project.coc_module_assets
    try:
        result = assets_mod.renew_host_work_leases(
            ctx.root,
            str(args.get("asset_root_id") or ""),
            executor_id=str(args.get("executor_id") or ""),
            lease_ids=list(args.get("lease_ids") or []),
            lease_seconds=args.get("lease_seconds"),
        )
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    return result, [], []

def _tool_progressive_release_host_work_leases(ctx: Ctx, args: dict[str, Any]):
    assets_mod = coc_module_project.coc_module_assets
    try:
        result = assets_mod.release_host_work_leases(
            ctx.root,
            str(args.get("asset_root_id") or ""),
            executor_id=str(args.get("executor_id") or ""),
            lease_ids=list(args.get("lease_ids") or []),
            reason=str(args.get("reason") or ""),
        )
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    return result, [], []

def _tool_progressive_fulfill_host_work(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    root_id = coc_module_project.campaign_asset_root_id(ctx.campaign_dir)
    if not root_id:
        raise ToolError("invalid_param", "campaign is not progressive")
    data, warnings, hints = _fulfill_host_work_for_asset(
        ctx, args, root_id=root_id,
    )
    if (
        _pi_auto_dispatch_active()
        and "worker_result" not in args
        and "pack" in args
    ):
        # The Pi coordinator child only ever forwards one exact worker_result
        # (pi/lib/runtime.ts runCoordinatorLifecycle); a directly supplied
        # pack is the main Keeper hand-authoring source work.
        warnings = [
            *warnings,
            "Pi source-work race: progressive.fulfill_host_work was called "
            "with a directly supplied pack instead of an exact-forwarded "
            "worker_result. " + _PI_SOURCE_WORK_RACE_WARNING,
        ]
    return data, warnings, hints

def _fulfill_host_work_for_asset(
    ctx: Ctx, args: dict[str, Any], *, root_id: str,
):
    """Serialize both parent and source-scoped calls through one strict core."""
    try:
        with coc_fileio.advisory_file_lock(_source_submit_lock_path(ctx)):
            return _fulfill_host_work_for_asset_unlocked(
                ctx, args, root_id=root_id,
            )
    except coc_fileio.CampaignLockError as exc:
        raise ToolError("campaign_busy", str(exc)) from exc

def _pi_auto_dispatch_active() -> bool:
    """True when the Pi host extension auto-dispatches ready source work."""
    if str(os.environ.get("COC_HOST") or "").lower() != "pi":
        return False
    # Headless Pi cannot spawn the source coordinator; the main KP owns the
    # direct claim/fulfill fallback there (see the claim headless hints).
    return str(os.environ.get("COC_PI_HEADLESS") or "").lower() not in {
        "1", "true", "yes",
    }

_PI_SOURCE_WORK_RACE_WARNING = (
    "on Pi the host extension auto-dispatches ready source work to the Pi "
    "source coordinator; the main Keeper must not claim host work, fulfill "
    "host work, or author source packs itself. Continue play and await the "
    "coordinator terminal notice, then consume durable packs only through "
    "later canonical entity/mechanics queries."
)

def _tool_progressive_on_enter_scene(ctx: Ctx, args: dict[str, Any]):
    active_scene_id = str(ctx.world().get("active_scene_id") or "").strip()
    scene_id = str(args.get("scene_id") or "").strip()
    if not active_scene_id or scene_id != active_scene_id:
        raise ToolError(
            "stale_scene_id",
            "progressive.on_enter_scene only materializes the exact canonical active scene",
            details={"active_scene_id": active_scene_id or None, "scene_id": scene_id or None},
        )
    result = coc_module_project.on_enter_scene(
        ctx.root, str(ctx.campaign_id or ""), scene_id,
    )
    root_id = result.get("asset_root_id") or coc_module_project.campaign_source_asset_root_id(
        ctx.campaign_dir,
    )
    open_work = []
    if root_id:
        open_work = coc_module_project.coc_module_assets.list_host_work_requests(
            ctx.root, str(root_id), limit=8,
        )
    projection = _source_host_work_projection(
        ctx, str(root_id), all_open_host_work=open_work,
    ) if root_id else {}
    data = {
        "scene_id": scene_id,
        "materialization": {
            "progressive": bool(result.get("progressive")),
            "merged_active": bool(result.get("merged_active")),
            "actions": result.get("actions") or [],
            "section_materialization": [
                row.get("section_materialization")
                for row in (result.get("actions") or [])
                if isinstance(row, dict) and isinstance(row.get("section_materialization"), dict)
            ],
        },
        "projection": {
            "asset_root_id": root_id,
            "host_work_open_count": len(open_work),
        },
    }
    if projection.get("background_takeover"):
        data["background_takeover"] = projection["background_takeover"]
    return data, list(result.get("host_hints") or []), [
        "re-read scene.context after terminal source work; section bodies are Keeper-only and are never returned by this materialization operation",
    ]

def _tool_progressive_status(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    # Either binding counts here: this operation reports on host work, and a
    # campaign bound through the opening/review path owns host work under
    # source_cache_asset_root_id without ever setting the progressive pointer.
    root_id = coc_module_project.campaign_source_asset_root_id(ctx.campaign_dir)
    if not root_id:
        return {
            "progressive": False,
            "asset_root_id": None,
            "queue": None,
        }, ["campaign is not progressive"], []
    # list_queue lives on assets module (sibling of project)
    assets_mod = coc_module_project.coc_module_assets
    queue = assets_mod.list_queue(ctx.root, root_id)
    worker_mod = coc_module_project._load_sibling(
        "coc_module_queue_worker_toolbox", "coc_module_queue_worker.py",
    )
    module_root = assets_mod.assets_root(ctx.root) / root_id
    identity = _read_optional_json(module_root / "identity.json", {})
    skeleton = assets_mod.get_skeleton(ctx.root, root_id) or {}
    all_host_work = assets_mod.list_host_work_requests(
        ctx.root, root_id, limit=None,
    )
    data: dict[str, Any] = {
        "progressive": True,
        "asset_root_id": root_id,
        "queue": coc_module_project._compact_queue_snapshot(
            queue, open_host_work=all_host_work,
        ),
        "worker": worker_mod.worker_status(ctx.root),
        "source_cache": {
            "source_id": (identity.get("source") or {}).get("source_id"),
            "file_sha256": identity.get("file_sha256"),
            "bundle_count": len(identity.get("source_bundles") or []),
            "cached_pdf_indices": sorted(
                int(path.stem)
                for path in (module_root / "pages").glob("*.md")
                if path.stem.isdigit()
            ),
        },
        "start_clock_status": skeleton.get("start_clock_status") or "unbound",
        "full_parse": assets_mod.read_full_parse_state(ctx.root, root_id),
        "host_work": {
            "open_count": len(all_host_work),
            "requests": all_host_work[:8],
            "ready_for_background_count": sum(
                (
                    assets_mod.host_work_operational_class(row) == "runnable"
                    and bool(row.get("requested_pdf_indices"))
                    and str(row.get("kind") or "") != "full_parse"
                )
                for row in all_host_work
            ),
            "leased_count": sum(
                row.get("dispatch_state") == "leased" for row in all_host_work
            ),
            "needs_source_window_count": sum(
                bool(row.get("requested_pdf_indices"))
                and str(row.get("kind") or "") != "full_parse"
                and row.get("cached_scope_complete") is False
                for row in all_host_work
            ),
            "claim_operation": {
                "tool": "progressive.claim_host_work",
                "args": {
                    "executor_id": "<stable host/session id>",
                    "limit": 1,
                },
            },
        },
    }
    host_work_projection = _source_host_work_projection(
        ctx,
        root_id,
        all_open_host_work=all_host_work,
    )
    if host_work_projection.get("background_takeover"):
        data["background_takeover"] = host_work_projection[
            "background_takeover"
        ]
    kind = str(args.get("kind") or "").strip()
    tid = str(args.get("target_id") or "").strip()
    if kind or tid:
        if not kind or not tid:
            raise ToolError("invalid_param", "kind and target_id must be provided together")
        data["entity"] = coc_module_project._entity_status(
            ctx.root, root_id, kind, tid,
        )
    hints = [
        "queue is non-blocking: dig only enqueues; parallel worker merges ready packs "
        "and writes host-work requests for missing deep bodies",
    ]
    full_parse_state = (
        data["full_parse"] if isinstance(data.get("full_parse"), dict) else {}
    )
    if full_parse_state.get("status") == "failed":
        next_operation = full_parse_state.get("next_operation")
        if isinstance(next_operation, dict) and next_operation.get(
            "operation",
        ):
            hints.append(
                "full_parse terminally failed; run its explicit "
                f"next_operation {next_operation.get('operation')} to retry "
                "the whole-book baiduocr lane after fixing the OCR environment"
            )
    elif full_parse_state.get("status") == "in_progress" and full_parse_state.get(
        "failure_class",
    ):
        hints.append(
            "full_parse OCR is retrying automatically with bounded backoff; "
            "no host action is needed while the queue worker is running"
        )
    if all_host_work:
        hints.append(
            "open host_work requests are not completed parses. When "
            "background_takeover is present, execute its exact next_host_action "
            "or coordinator_dispatch by dispatch_mode "
            "(direct_single_leaf, parent_flat_fanout, or coordinator_fanout); "
            "do not invent a nested coordinator on a depth-1 host. On a "
            "named-submit host the parent does not wait, retrieve, poll, or "
            "call progressive.fulfill_host_work; only a host without direct "
            "submit uses the exact-forward fallback"
        )
    return data, [], hints

def _tool_progressive_retry_full_parse(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    assets_mod = coc_module_project.coc_module_assets
    root_id = str(args.get("asset_root_id") or "").strip()
    if not root_id:
        raise ToolError("invalid_param", "asset_root_id required")
    reason = str(args.get("reason") or "retry_full_parse").strip()[:120]
    queued = assets_mod.enqueue_job(
        ctx.root,
        root_id,
        kind="full_parse",
        target_id=root_id,
        priority=5,
        reason=reason,
        consumer_refs=[assets_mod.campaign_consumer_ref(
            ctx.root, str(ctx.campaign_id), root_id, intent_kind="full_parse",
        )],
        kick_worker=True,
    )
    state = assets_mod.read_full_parse_state(ctx.root, root_id)
    hints: list[str] = []
    if queued.get("enqueued"):
        hints.append(
            "a fresh full_parse job is queued; the background worker owns the "
            "whole-book OCR attempt"
        )
    elif queued.get("dedupe_state") in {"pending", "in_flight"}:
        hints.append(
            "full_parse is already queued or in flight; the worker owns "
            "completion and bounded retries"
        )
    elif queued.get("dedupe_state") == "done":
        hints.append("full_parse already completed; no retry needed")
    return {
        "asset_root_id": root_id,
        "campaign_id": str(ctx.campaign_id),
        "enqueued": bool(queued.get("enqueued")),
        "deduped": bool(queued.get("deduped")),
        "dedupe_state": queued.get("dedupe_state"),
        "job_id": str((queued.get("job") or {}).get("job_id") or ""),
        "full_parse": state,
    }, [], hints

def _tool_evidence_record_adoption(ctx, args):
    return _shared_tool_evidence_record_adoption(ctx, args)


def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "progressive.prepare_opening",
    "Experimental campaign-serial planner for one source-authored opening. "
    "With no real opening selector, its first call returns the existing bounded "
    "complete opening_page_candidates catalog when source selection is needed; "
    "semantically select from that catalog and never guess page indices. It "
    "validates an accepted contiguous 1..3-page window and returns bounded readiness "
    "plus optional mutation cards; it never parses, queues, projects, moves, "
    "narrates, supervises background work, or gates player actions. Retain the "
    "accepted selection for this bound scenario generation; after opening "
    "bootstrap, do not repeat this planner as a progress or recovery query.",
    {
        "start_location_id": {
            "type": ["string", "null"], "maxLength": 128,
            "pattern": _OPENING_SAFE_ID_PATTERN,
            "desc": "optional exact structured start candidate id",
        },
        "opening_pdf_indices": {
            "type": "array", "minItems": 1, "maxItems": 3,
            "uniqueItems": True, "items": {"type": "integer", "minimum": 0},
            "desc": "optional exact host-selected contiguous accepted pages",
        },
        "mechanics_locator_pdf_indices": {
            "type": "array", "minItems": 1, "maxItems": 3,
            "uniqueItems": True, "items": {"type": "integer", "minimum": 0},
            "desc": "optional exact host-selected appendix/roster candidate pages; never required for opening",
        },
        "opening_required_npc_ids": {
            "type": "array", "minItems": 1, "maxItems": 32,
            "uniqueItems": True, "items": {"type": "string", "maxLength": 128},
            "desc": "optional present-NPC opening construction prerequisites",
        },
        "opening_required_secret_ids": {
            "type": "array", "minItems": 1, "maxItems": 32,
            "uniqueItems": True, "items": {"type": "string", "maxLength": 128},
            "desc": "optional keeper-secret opening construction prerequisites",
        },
    },
    access="query",
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=False,
    execution_class="serial_campaign",
)(_tool_progressive_prepare_opening)
    registry.tool(
    "progressive.opening_bootstrap",
    "Deterministically publishes the minimal source-bound opening skeleton, "
    "projects sparse pristine campaign state, and records a campaign-owned "
    "auto-projection watch. With a source-reviewed module-init L0 present it "
    "direct-writes the opening scene from the L0 hooks (player hooks -> "
    "read_aloud, keeper hooks -> keeper_only) with zero host-work/coordinator "
    "dependency; without L0 it enqueues the exact foreground partial_opening "
    "request. It never reads prose, moves a scene, narrates, waits, claims, "
    "or fulfills. Invoke once for the accepted setup decision and retain its "
    "receipt/watch; follow the returned host lifecycle instead of repeating "
    "bootstrap.",
    {
        "start_location": {
            "type": "object",
            "required": True,
            "properties": {
                "location_id": {
                    "type": "string", "minLength": 1, "maxLength": 128,
                    "pattern": _OPENING_SAFE_ID_PATTERN,
                },
                "title": {"type": "string", "minLength": 1, "maxLength": 240},
            },
            "required_fields": ["location_id", "title"],
            "additionalProperties": False,
        },
        "opening_pdf_indices": {
            "type": "array", "required": True, "minItems": 1, "maxItems": 3,
            "uniqueItems": True, "items": {"type": "integer", "minimum": 0},
        },
    },
)(_tool_progressive_opening_bootstrap)
    registry.tool(
    "progressive.publish_skeleton",
    "Experimental canonical publication of one structured source-bound skeleton. "
    "Stores validated shared module truth, then projects sparse campaign IR as a "
    "separate non-atomic phase; it never parses free prose or source pages.",
    {
        "asset_root_id": {"type": "string", "required": True, "maxLength": 128},
        "source_file_sha256": {"type": "string", "required": True, "minLength": 64, "maxLength": 64},
        "skeleton": {"type": "object", "required": True},
    },
)(_tool_progressive_publish_skeleton)
    registry.tool(
    "progressive.request_opening_pack",
    "Experimental mutation that enqueues exactly one selected-start partial opening "
    "slice over a validated 1..3-page accepted window. The queue kick only "
    "materializes host work; it does not perform semantic extraction.",
    {
        "asset_root_id": {"type": "string", "required": True, "maxLength": 128},
        "source_file_sha256": {"type": "string", "required": True, "minLength": 64, "maxLength": 64},
        "start_location_id": {
            "type": "string", "required": True,
            "minLength": 1, "maxLength": 128,
            "pattern": _OPENING_SAFE_ID_PATTERN,
        },
        "opening_pdf_indices": {
            "type": "array", "required": True, "minItems": 1, "maxItems": 3,
            "uniqueItems": True, "items": {"type": "integer", "minimum": 0},
        },
        "request_purpose": {
            "type": "string", "required": True,
            "enum": ["foreground_opening_slice"],
        },
        "execution_owner": {
            "type": "string",
            "enum": ["opening_source_coordinator"],
            "desc": (
                "optional capability-advertised semantic owner; it leases and "
                "compiles the sole foreground packet in the same context"
            ),
        },
    },
)(_tool_progressive_request_opening_pack)
    registry.tool(
    "progressive.request_locator_pass",
    "Enqueue one nonblocking mechanics-locator pass over an exact host-selected "
    "contiguous 1..3-page accepted window. It never selects pages, scans the "
    "bundle, blocks opening readiness, or extracts mechanics profiles.",
    {
        "asset_root_id": {"type": "string", "required": True, "maxLength": 128},
        "source_file_sha256": {
            "type": "string", "required": True,
            "minLength": 64, "maxLength": 64,
        },
        "mechanics_locator_pdf_indices": {
            "type": "array", "required": True, "minItems": 1, "maxItems": 3,
            "uniqueItems": True, "items": {"type": "integer", "minimum": 0},
        },
        "request_purpose": {
            "type": "string", "required": True,
            "enum": ["mechanics_locator_pass"],
        },
    },
)(_tool_progressive_request_locator_pass)
    registry.tool(
    "progressive.project_opening",
    "Experimental selected-only projection of one durable, current opening pack. "
    "Accepts no pack payload, never compiles alternate starts, and refuses stale "
    "projection writes after play has begun. While an exact opening source lease "
    "has an active owner, even an incomplete or repeated call is a read-only "
    "deferred no-op; released/runnable work exposes its normal recovery action.",
    {
        "asset_root_id": {
            "type": "string", "required": True, "maxLength": 128,
        },
        "source_file_sha256": {
            "type": "string", "required": True,
            "minLength": 64, "maxLength": 64,
        },
        "start_location_id": {
            "type": "string", "required": True,
            "minLength": 1, "maxLength": 128,
            "pattern": _OPENING_SAFE_ID_PATTERN,
        },
        "opening_pdf_indices": {
            "type": "array", "minItems": 1, "maxItems": 3,
            "uniqueItems": True,
            "items": {"type": "integer", "minimum": 0},
            "desc": "optional exact qualified selected opening page window",
        },
    },
)(_tool_progressive_project_opening)
    registry.tool(
    "progressive.request_mechanics",
    "Request one source-first NPC/item mechanics lookup without reparsing its narrative body. Exact appendix/chapter pages are cached and same-page subjects are batched.",
    {
        "kind": {"type": "string", "required": True, "desc": "npc | item"},
        "target_id": {"type": "string", "required": True, "desc": "stable subject id"},
        "title": {"type": "string", "desc": "optional table-language label"},
        "reason": {"type": "string", "desc": "structured reason for the source lookup"},
    },
)(_tool_progressive_request_mechanics)
    registry.tool(
    "progressive.follow_mentions",
    "Enqueue deepen jobs from a structured mentions list "
    "[{kind, ref_id, raw_label?}]. For KP/host use when a deep pack, handout index, "
    "or dig yields explicit entity refs. Never pass free prose to scan.",
    {
        "mentions": {
            "type": "array",
            "required": True,
            "desc": "list of {kind, ref_id, raw_label?}",
        },
        "reason": {
            "type": "string",
            "desc": "queue reason label",
        },
    },
)(_tool_progressive_follow_mentions)
    registry.tool(
    "progressive.register_source_bundle",
    "Validate and register one later host-PDF page window for the campaign's "
    "existing progressive asset root. This caches reviewed pages only; it does "
    "not parse PDF bytes or compile semantic entity packs.",
    {
        "source_bundle_path": {
            "type": "string",
            "required": True,
            "desc": "absolute path to one host-produced source-bundle directory",
        },
    },
)(_tool_progressive_register_source_bundle)
    registry.tool(
    "progressive.claim_host_work",
    "Atomically lease contract-compatible exact cached-page work "
    "groups for bounded host-native source-pack subagents. named_submit returns "
    "exact dispatch tasks whose child submits directly; task_return_to_parent "
    "returns exact dispatch tasks whose natural completion is strictly fulfilled once by the "
    "parent; return_to_parent returns bare coc.source-pack-worker.v1 packets "
    "for the lifecycle coordinator. Children never write campaign/module state "
    "directly. A capability-advertised lifecycle/source owner may instead "
    "compile one returned bare packet in its existing semantic context.",
    {
        "executor_id": {
            "type": "string",
            "required": True,
            "desc": "stable host/session executor id used for leases and recovery",
        },
        "limit": {
            "type": "integer",
            "minimum": 1,
            # Derived, never restated: the runtime raised its own ceiling and
            # this schema kept advertising 4, so the contract was the real
            # limit and a whole-book pass drained four groups at a time.
            "maximum": coc_module_project.coc_module_assets.MAX_CLAIM_LIMIT,
            "desc": (
                "maximum independent exact-page work groups to lease "
                "(default 1)"
            ),
        },
        "lease_seconds": {
            "type": "integer",
            "minimum": 30,
            "maximum": 3600,
            "desc": "crash-recovery lease duration (default 600 seconds)",
        },
        "max_dispatch_attempts": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100,
            "desc": (
                "optional exact upper bound on durable claim attempts; "
                "groups at the bound are not leased"
            ),
        },
        "result_delivery": {
            "type": "string",
            "enum": [
                "named_submit", "task_return_to_parent", "return_to_parent",
            ],
            "desc": (
                "worker result transport: direct named submit by default, "
                "exact task return to the spawning parent, or exact packet "
                "return to a lifecycle coordinator"
            ),
        },
        "current_dependency_claim": {
            "type": "object",
            "desc": (
                "private Pi coordinator binding produced by the repository; "
                "main KP callers must omit it"
            ),
            "properties": {
                "dependency_id": {"type": "string", "required": True},
                "campaign_id": {"type": "string", "required": True},
                "job_id": {"type": "string", "required": True},
                "dependency_ref": {
                    "type": "object",
                    "required": True,
                    "additionalProperties": True,
                },
            },
            "additionalProperties": False,
        },
    },
)(_tool_progressive_claim_host_work)
    registry.tool(
    "progressive.renew_host_work_leases",
    "Host-lifecycle operation that renews only exact leases owned by one "
    "executor. It is not a Keeper source-reading operation.",
    {
        "asset_root_id": {"type": "string", "required": True},
        "executor_id": {"type": "string", "required": True},
        "lease_ids": {
            "type": "array", "required": True, "minItems": 1,
            "items": {"type": "string"},
        },
        "lease_seconds": {
            "type": "integer", "required": True, "minimum": 30, "maximum": 3600,
        },
    },
)(_tool_progressive_renew_host_work_leases)
    registry.tool(
    "progressive.release_host_work_leases",
    "Host-lifecycle operation that gracefully releases only exact leases "
    "owned by one executor. Abrupt crashes still recover through bounded TTL.",
    {
        "asset_root_id": {"type": "string", "required": True},
        "executor_id": {"type": "string", "required": True},
        "lease_ids": {
            "type": "array", "required": True, "minItems": 1,
            "items": {"type": "string"},
        },
        "reason": {"type": "string", "required": True, "maxLength": 256},
    },
)(_tool_progressive_release_host_work_leases)
    registry.tool(
    "progressive.fulfill_host_work",
    "Submit one exact source-worker result for an open progressive parsing request. "
    "This is the canonical closure path: it validates the request/entity binding, "
    "marks the handoff fulfilled, and re-enqueues campaign merge work.",
    {
        "worker_result": {
            "type": "object",
            "properties": {
                "job_id": {"type": "string"},
                "pack": {"type": "object"},
                "related_packs": {"type": "array"},
                "opening_setup": {"type": "object"},
            },
            "required_fields": ["job_id", "pack", "related_packs"],
            "additionalProperties": False,
            "desc": (
                "preferred exact child results[i] object; pass it unchanged as "
                "one value and never combine it with legacy job_id/pack/related_packs"
            ),
        },
        "job_id": {
            "type": "string",
            "desc": "legacy explicit job id; mutually exclusive with worker_result",
        },
        "pack": {
            "type": "object",
            "desc": "legacy explicit pack; mutually exclusive with worker_result",
        },
        "related_packs": {
            "type": "array",
            "desc": "legacy optional same-page batch; mutually exclusive with worker_result",
        },
        "opening_setup": {
            "type": "object",
            "desc": (
                "required closed opening clock observation for partial_opening; "
                "normally carried inside worker_result"
            ),
        },
        "host_task_timing": {
            "type": "object",
            "properties": {
                "started_at": {"type": "string"},
                "completed_at": {"type": "string"},
                "duration_ms": {"type": "integer", "minimum": 0},
                "task_id": {"type": "string"},
            },
            "required_fields": [
                "started_at", "completed_at", "duration_ms", "task_id",
            ],
            "desc": "optional exact host-runtime metadata from the completed background task; never model-authored",
        },
    },
)(_tool_progressive_fulfill_host_work)
    registry.tool(
    "progressive.on_enter_scene",
    "Materialize only the canonical active progressive scene: merge a ready location pack and enqueue exact source-bound location/opening section extraction through the existing queue. Returns status and host-work projection, never section prose.",
    {
        "scene_id": {"type": "string", "required": True, "desc": "must exactly equal world.active_scene_id"},
        "decision_id": {"type": "string", "desc": "stable materialization receipt id"},
    },
    access="mutation",
    read_domains=("scene", "world", "module_progressive"),
    write_domains=("module_progressive",),
)(_tool_progressive_on_enter_scene)
    registry.tool(
    "progressive.status",
    "Read progressive parse queue + optional entity status for the campaign asset root. "
    "Also reports whether the detached parallel queue worker is running. "
    "Keeper-only diagnostic for a concrete later dig/entity decision. It is not "
    "a Pi private-coordinator completion signal: while that lifecycle is open, "
    "await its terminal notice without polling, reassurance queries, repeat "
    "preparation/bootstrap, or manual claim/fulfillment.",
    {
        "kind": {
            "type": "string",
            "desc": "optional entity kind to inspect",
        },
        "target_id": {
            "type": "string",
            "desc": "optional entity id to inspect (requires kind)",
        },
    },
    access="query",
    read_domains=("module_progressive",),
    audit_mode="reference",
)(_tool_progressive_status)
    registry.tool(
    "progressive.retry_full_parse",
    "Retry a terminally failed whole-book parse by enqueuing one fresh full_parse "
    "job for the campaign asset root (baiduocr lane). Only meaningful when "
    "progressive.status reports full_parse.status=failed with next_operation "
    "progressive.retry_full_parse; a queued/in-flight parse dedupes instead. The "
    "background worker re-runs the OCR bridge (reusing the sha-keyed corpus when "
    "complete) and registers corpus pages into module-assets. Keeper-only source "
    "lane operation; never blocks the opening projection or play.",
    {
        "asset_root_id": {
            "type": "string",
            "desc": "module asset root id to re-parse (progressive.status asset_root_id)",
        },
        "reason": {
            "type": "string",
            "desc": "optional retry reason shown in the queue row",
        },
    },
    access="mutation",
    write_domains=("module_progressive",),
)(_tool_progressive_retry_full_parse)
    registry.tool(
    "evidence.record_adoption",
    "Record which advisory candidates the KP adopted, modified, or ignored. Keeper-internal audit evidence only.",
    {
        "decision_id": {"type": "string", "required": True, "desc": "stable turn decision id"},
        "advice_id": {"type": "string", "required": True, "desc": "id returned by an advisory tool"},
        "disposition": {"type": "string", "required": True, "desc": "adopted | modified | ignored"},
        "reason": {"type": "string", "required": True, "desc": "concise semantic reason, not hidden chain-of-thought"},
        "adopted_fields": {"type": "array", "desc": "structured field paths actually used"},
        "emotional_tone_adoption": {"type": "array", "desc": "per-NPC first-impression follow-through for each npc_moves[].emotional_tone in the referenced plan: {npc_id, emotional_tone, adoption: adopted|modified|ignored}"},
        "storylet_candidate": {
            "type": "object",
            "desc": "legacy optional exact candidate returned by actions.advise/storylets.suggest; prefer candidate_ref",
        },
        "candidate_ref": {
            "type": "string",
            "desc": "optional stable candidate_ref returned by actions.advise; the canonical candidate is resolved from advisory evidence",
        },
        "finalization_id": {
            "type": "string",
            "desc": "optional finalized output proving the adopted candidate reached the delivered draft",
        },
        "exact_excerpt": {
            "type": "string",
            "desc": "optional exact finalized draft excerpt realizing the adopted candidate",
        },
    },
)(_tool_evidence_record_adoption)


OPERATION_EXPORTS = (
    '_OPENING_INPUT_FIELDS',
    '_OPENING_PREPARATION_DATA_MAX_BYTES',
    '_OPENING_PREPARATION_MCP_RESERVE_BYTES',
    '_OPENING_RESULT_CAPS',
    '_OPENING_SAFE_ID_PATTERN',
    '_PI_SOURCE_WORK_RACE_WARNING',
    '_attach_source_host_projection',
    '_cap_opening_rows',
    '_fit_opening_data_budget',
    '_fulfill_host_work_for_asset',
    '_l0_direct_opening_projection',
    '_opening_activation_card',
    '_opening_encoded_data_bytes',
    '_opening_id_list',
    '_opening_page_list',
    '_opening_skeleton_argument_contract',
    '_opening_start_selector',
    '_pi_auto_dispatch_active',
    '_pi_source_pack_dispatch_task',
    '_source_pack_dispatch_task',
    '_tool_evidence_record_adoption',
    '_tool_progressive_claim_host_work',
    '_tool_progressive_follow_mentions',
    '_tool_progressive_fulfill_host_work',
    '_tool_progressive_on_enter_scene',
    '_tool_progressive_opening_bootstrap',
    '_tool_progressive_prepare_opening',
    '_tool_progressive_project_opening',
    '_tool_progressive_publish_skeleton',
    '_tool_progressive_register_source_bundle',
    '_tool_progressive_release_host_work_leases',
    '_tool_progressive_renew_host_work_leases',
    '_tool_progressive_request_locator_pass',
    '_tool_progressive_request_mechanics',
    '_tool_progressive_request_opening_pack',
    '_tool_progressive_retry_full_parse',
    '_tool_progressive_status',
)
