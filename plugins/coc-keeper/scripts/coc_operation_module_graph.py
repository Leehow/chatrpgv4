#!/usr/bin/env python3
"""Operation adapter cell: campaign-bound ModuleGraph source context."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
    _campaign_play_language,
    _load_sibling,
    coc_module_project,
    deepcopy,
)


coc_module_graph = _load_sibling(
    "coc_module_graph_toolbox",
    "coc_module_graph.py",
)


def _module_summary(
    manifest: dict[str, Any], graph: dict[str, Any]
) -> dict[str, Any]:
    coverage = dict(graph.get("coverage") or {})
    source_gaps = sorted(
        domain
        for domain, status in coverage.items()
        if status in {"partial", "unresolved"}
    )
    return {
        "module_id": graph.get("module_id"),
        "graph_contract_id": graph.get("contract_id"),
        "graph_schema_version": graph.get("schema_version"),
        "build_status": manifest.get("build_status"),
        "source_languages": list(graph.get("source_languages") or []),
        "coverage": coverage,
        "source_gaps": source_gaps,
        "missing_shards": list(manifest.get("missing_shards") or []),
    }


def _presentation_contract(
    *, source_languages: list[str], play_language: str
) -> dict[str, Any]:
    return {
        "play_language": play_language,
        "localization_required": play_language not in source_languages,
        "persistence": "none",
        "authority": "keeper-semantic-presentation",
    }


def _authority_contract() -> dict[str, Any]:
    return {
        "source_truth": "module-graph",
        "campaign_applicability": "live-state-and-kp-judgment",
        "semantic_match": False,
        "hard_gate": False,
    }


def _unavailable_result(
    ctx: Ctx,
    *,
    mode: str,
    status: str,
    diagnostic_codes: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "mode": mode,
        "available": False,
        "status": status,
        **(
            {"diagnostic_codes": list(diagnostic_codes)}
            if diagnostic_codes is not None
            else {}
        ),
        "module": None,
        "presentation": {
            "play_language": _campaign_play_language(ctx),
            "localization_required": False,
            "persistence": "none",
            "authority": "keeper-semantic-presentation",
        },
        "candidates": None,
        "context": None,
        "authority": _authority_contract(),
    }


_MACHINE_ONLY_KEYS = frozenset({
    "grep_anchor",
    "current_generation",
    "module_graph_path",
    "shard_path",
    "evidence_path",
    "review_path",
    "bundle_path",
    "markdown_path",
})


def _model_safe_graph_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _model_safe_graph_value(child)
            for key, child in value.items()
            if key not in _MACHINE_ONLY_KEYS and not key.endswith("_sha256")
        }
    if isinstance(value, list):
        return [_model_safe_graph_value(child) for child in value]
    return deepcopy(value)


def _campaign_graph_asset_root_id(ctx: Ctx) -> str | None:
    source_root = coc_module_project.campaign_source_asset_root_id(
        ctx.campaign_dir
    )
    if source_root:
        return source_root
    handout_roots = coc_module_project.campaign_handout_asset_root_ids(
        ctx.campaign_dir
    )
    return handout_roots[-1] if handout_roots else None


def _tool_module_context(ctx: Ctx, args: dict[str, Any]):
    unknown = sorted(set(args) - {"query", "seed_ids", "depth", "limit"})
    if unknown:
        raise ToolError(
            "invalid_param",
            "module.context has unsupported argument(s): " + ", ".join(unknown),
        )
    query_supplied = "query" in args
    seeds_supplied = "seed_ids" in args
    query = args.get("query")
    seed_ids = args.get("seed_ids")
    if query_supplied and (
        not isinstance(query, str) or not query.strip()
    ):
        raise ToolError("invalid_param", "query must be a non-empty string")
    if seeds_supplied and (
        not isinstance(seed_ids, list)
        or not seed_ids
        or any(not isinstance(value, str) or not value.strip() for value in seed_ids)
        or len(set(seed_ids)) != len(seed_ids)
    ):
        raise ToolError(
            "invalid_param",
            "seed_ids must be a non-empty unique array of semantic ids",
        )
    if query_supplied and seeds_supplied:
        raise ToolError(
            "invalid_param",
            "query and seed_ids are mutually exclusive",
        )
    if not query_supplied and not seeds_supplied and (
        "depth" in args or "limit" in args
    ):
        raise ToolError(
            "invalid_param",
            "status mode does not accept depth or limit",
        )
    if query_supplied and "depth" in args:
        raise ToolError("invalid_param", "search mode does not accept depth")
    if seeds_supplied and "limit" in args:
        raise ToolError("invalid_param", "expand mode does not accept limit")
    if isinstance(query, str):
        query = query.strip()
    requested_mode = (
        "search" if query_supplied else ("expand" if seeds_supplied else "status")
    )
    root_id = _campaign_graph_asset_root_id(ctx)
    if not root_id:
        return _unavailable_result(
            ctx,
            mode=requested_mode,
            status="unbound",
        ), [], [
            "this campaign has no bound source graph; reuse existing Scenario IR and keep unknown source facts unknown"
        ]
    try:
        installation = coc_module_graph.load_installed_module_graph_installation(
            ctx.root,
            asset_root_id=root_id,
        )
    except coc_module_graph.ModuleGraphError as exc:
        codes = sorted({row["code"] for row in exc.findings})
        if "module_graph_not_installed" in codes:
            return _unavailable_result(
                ctx,
                mode=requested_mode,
                status="not_compiled",
            ), [
                "the campaign source is bound but its ModuleGraph has not been compiled"
            ], [
                "reuse existing Scenario IR and keep source facts outside the compiled scope unknown; play continues"
            ]
        return _unavailable_result(
            ctx,
            mode=requested_mode,
            status="invalid",
            diagnostic_codes=codes,
        ), [
            "the bound ModuleGraph failed integrity validation and was not used"
        ], [
            "reuse existing Scenario IR and keep affected source facts unknown; play continues"
        ]
    graph = installation["module_graph"]
    module = _module_summary(installation["manifest"], graph)
    candidates = (
        coc_module_graph.search_graph(
            graph,
            str(query),
            audience="keeper",
            limit=int(args.get("limit", 8)),
        )
        if query
        else None
    )
    context = (
        _model_safe_graph_value(
            coc_module_graph.graph_context(
                graph,
                list(seed_ids),
                depth=int(args.get("depth", 1)),
                audience="keeper",
                max_nodes=24,
            )
        )
        if seed_ids
        else None
    )
    hints = [
        "ModuleGraph text stays in source_languages; render only final table prose in play_language and persist no translation",
    ]
    if query:
        hints.insert(
            0,
            "lexical matches are candidates only; the KP selects exact semantic seed ids before requesting graph context",
        )
        if not candidates:
            hints.append(
                "no lexical candidate was found in the compiled scope; this is not world absence and uncompiled source remains unknown"
            )
    if seed_ids:
        hints.insert(
            0,
            "source context is authored module truth only; live campaign state and KP judgment own current applicability and disclosure",
        )
        if isinstance(context, dict) and context.get("error"):
            hints.append(
                "one or more exact semantic seed ids are not present in the compiled graph; choose from lexical candidates or keep the source fact unknown"
            )
    return {
        "schema_version": 1,
        "mode": requested_mode,
        "available": True,
        **(
            {"status": "seed_not_found"}
            if seed_ids and isinstance(context, dict) and context.get("error")
            else (
                {"status": "not_found_in_compiled_scope"}
                if query and not candidates
                else {}
            )
        ),
        "module": module,
        "presentation": _presentation_contract(
            source_languages=module["source_languages"],
            play_language=_campaign_play_language(ctx),
        ),
        "candidates": candidates,
        "context": context,
        "authority": _authority_contract(),
    }, [], hints


def register_operations(registry) -> None:
    registry.tool(
        "module.context",
        "Read campaign-bound ModuleGraph status, lexical candidates, or one bounded source neighborhood. Keeper-only source context; lexical matches never make semantic or disclosure decisions.",
        {
            "query": {
                "type": "string",
                "maxLength": 240,
                "desc": "optional source-language lexical query; omit with seed_ids",
            },
            "seed_ids": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "maxItems": 8,
                "uniqueItems": True,
                "desc": "optional exact semantic node ids; omit with query",
            },
            "depth": {
                "type": "integer",
                "minimum": 0,
                "maximum": 2,
                "desc": "expand depth (default 1; seed_ids mode only)",
            },
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 12,
                "desc": "search candidate limit (default 8; query mode only)",
            },
        },
        access="query",
        read_domains=(),
        write_domains=(),
        recovery_domains=(),
        response_mode="full",
        audit_mode="reference",
        strict_read_only=True,
        execution_class="serial_campaign",
    )(_tool_module_context)


OPERATION_EXPORTS = (
    "_tool_module_context",
    "coc_module_graph",
)
