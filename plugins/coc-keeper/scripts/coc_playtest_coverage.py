#!/usr/bin/env python3
"""Keeper-only exhaustive scenario coverage planning and post-run accounting.

This module is deliberately outside the live turn path.  It reads structured
Scenario IR before play, reads authoritative structured receipts after play,
and unions observations from independent fresh-baseline lanes.  It never
classifies prose and an incomplete aggregate is data, not a runtime gate.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = 1
PLAN_KIND = "coc_scenario_coverage_plan"
OBSERVATION_KIND = "coc_scenario_coverage_observation"
AGGREGATE_KIND = "coc_scenario_coverage_aggregate"

TARGET_CATEGORIES = (
    "scenes",
    "edges",
    "side_branches",
    "clue_routes",
    "npcs",
    "conclusions",
    "endings",
    "rewards",
    "development",
)


class CoverageContractError(ValueError):
    """Raised when a new-format coverage artifact is invalid."""


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _canonical_sha256(value: Any) -> str:
    return _sha256_bytes(_canonical_bytes(value))


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise CoverageContractError(f"invalid JSON: {path}") from exc
    if not isinstance(value, dict):
        raise CoverageContractError(f"expected JSON object: {path}")
    return value


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise CoverageContractError(f"cannot read receipt log: {path}") from exc
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except ValueError as exc:
            raise CoverageContractError(
                f"invalid JSONL at {path}:{line_number}"
            ) from exc
        if not isinstance(row, dict):
            raise CoverageContractError(
                f"expected JSON object at {path}:{line_number}"
            )
        rows.append(row)
    return rows


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _texts(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [text for item in value if (text := _text(item))]


def _json_file_manifest(root: Path, paths: Iterable[Path]) -> list[dict[str, Any]]:
    manifest: list[dict[str, Any]] = []
    for path in sorted(set(paths), key=lambda item: item.as_posix()):
        if not path.is_file():
            continue
        data = path.read_bytes()
        manifest.append(
            {
                "path": path.relative_to(root).as_posix(),
                "sha256": _sha256_bytes(data),
                "size": len(data),
            }
        )
    return manifest


def _manifest_digest(manifest: list[dict[str, Any]]) -> str:
    return _canonical_sha256(manifest)


def _source_ref(filename: str, pointer: str) -> dict[str, str]:
    return {"path": filename, "json_pointer": pointer}


def _edge_target_id(
    from_scene_id: str,
    ordinal: int,
    edge: dict[str, Any],
) -> str:
    digest = _canonical_sha256(edge)[:16]
    return f"edge:{from_scene_id}:{ordinal}:{digest}"


def _collect_explicit_groups(*documents: dict[str, Any]) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for document in documents:
        for row in document.get("exclusivity_groups") or []:
            if not isinstance(row, dict):
                continue
            group_id = _text(row.get("group_id"))
            if not group_id:
                continue
            members = _texts(row.get("member_target_ids") or row.get("members"))
            groups[group_id] = {
                "group_id": group_id,
                "kind": _text(row.get("kind")) or "authored_exclusive",
                "member_source_ids": members,
                "source_ref": row.get("source_ref"),
            }
    return [groups[key] for key in sorted(groups)]


def generate_plan(scenario_dir: Path | str) -> dict[str, Any]:
    """Generate a private plan from the current structured Scenario IR."""
    root = Path(scenario_dir).resolve()
    required = {
        "module-meta.json": root / "module-meta.json",
        "story-graph.json": root / "story-graph.json",
        "clue-graph.json": root / "clue-graph.json",
        "npc-agendas.json": root / "npc-agendas.json",
    }
    missing = [name for name, path in required.items() if not path.is_file()]
    if missing:
        raise CoverageContractError(
            "new-format Scenario IR is missing: " + ", ".join(sorted(missing))
        )

    module_meta = _read_json(required["module-meta.json"])
    story_graph = _read_json(required["story-graph.json"])
    clue_graph = _read_json(required["clue-graph.json"])
    npc_agendas = _read_json(required["npc-agendas.json"])
    scenario_id = _text(module_meta.get("scenario_id"))
    if not scenario_id:
        raise CoverageContractError("module-meta.json requires scenario_id")

    scenes = [row for row in story_graph.get("scenes") or [] if isinstance(row, dict)]
    scene_by_id: dict[str, dict[str, Any]] = {}
    for row in scenes:
        scene_id = _text(row.get("scene_id"))
        if not scene_id or scene_id in scene_by_id:
            raise CoverageContractError("story graph scene_id values must be unique strings")
        if "scene_edges" not in row or not isinstance(row.get("scene_edges"), list):
            raise CoverageContractError(
                "new-format coverage plans require explicit scene_edges on every scene"
            )
        scene_by_id[scene_id] = row

    start_ids = sorted(
        scene_id for scene_id, row in scene_by_id.items() if row.get("is_start") is True
    )
    if not start_ids:
        raise CoverageContractError("story graph requires at least one explicit is_start scene")

    adjacency: dict[str, list[str]] = {scene_id: [] for scene_id in scene_by_id}
    raw_edges: list[tuple[str, int, dict[str, Any]]] = []
    for from_scene_id, row in scene_by_id.items():
        for ordinal, edge in enumerate(row.get("scene_edges") or []):
            if not isinstance(edge, dict):
                raise CoverageContractError("scene_edges entries must be objects")
            to_scene_id = _text(edge.get("to"))
            if not to_scene_id or to_scene_id not in scene_by_id:
                raise CoverageContractError(
                    f"scene edge from {from_scene_id} has unknown target {to_scene_id!r}"
                )
            adjacency[from_scene_id].append(to_scene_id)
            raw_edges.append((from_scene_id, ordinal, edge))

    reachable: set[str] = set(start_ids)
    frontier = list(start_ids)
    while frontier:
        current = frontier.pop()
        for target in adjacency[current]:
            if target not in reachable:
                reachable.add(target)
                frontier.append(target)

    targets: dict[str, list[dict[str, Any]]] = {
        category: [] for category in TARGET_CATEGORIES
    }
    source_to_target_ids: dict[str, set[str]] = {}

    def register(category: str, row: dict[str, Any], *source_ids: str) -> None:
        targets[category].append(row)
        for source_id in source_ids:
            source_to_target_ids.setdefault(source_id, set()).add(row["target_id"])

    for ordinal, (scene_id, row) in enumerate(scene_by_id.items()):
        register(
            "scenes",
            {
                "target_id": f"scene:{scene_id}",
                "scene_id": scene_id,
                "reachable": scene_id in reachable,
                "source_ref": _source_ref("story-graph.json", f"/scenes/{ordinal}"),
            },
            scene_id,
            f"scene:{scene_id}",
        )

        for affordance_ordinal, affordance in enumerate(row.get("affordances") or []):
            if not isinstance(affordance, dict):
                continue
            affordance_id = _text(affordance.get("id"))
            if not affordance_id:
                continue
            target_id = f"side-branch:{scene_id}:{affordance_id}"
            clue_ids = []
            if clue_id := _text(affordance.get("clue_id")):
                clue_ids.append(clue_id)
            clue_ids.extend(_texts(affordance.get("grants_clue_ids")))
            register(
                "side_branches",
                {
                    "target_id": target_id,
                    "scene_id": scene_id,
                    "affordance_id": affordance_id,
                    "route_type": _text(affordance.get("route_type")),
                    "clue_ids": sorted(set(clue_ids)),
                    "chance_gated": isinstance(affordance.get("roll_gate"), dict),
                    "reachable": scene_id in reachable,
                    "source_ref": _source_ref(
                        "story-graph.json",
                        f"/scenes/{ordinal}/affordances/{affordance_ordinal}",
                    ),
                },
                affordance_id,
                target_id,
            )

        conclusion_contract = row.get("conclusion_contract")
        if isinstance(conclusion_contract, dict):
            conclusion_id = _text(conclusion_contract.get("conclusion_id"))
            if conclusion_id:
                ending_target_id = f"ending:{conclusion_id}"
                register(
                    "endings",
                    {
                        "target_id": ending_target_id,
                        "ending_id": conclusion_id,
                        "scene_id": scene_id,
                        "reachable": scene_id in reachable,
                        "source_ref": _source_ref(
                            "story-graph.json", f"/scenes/{ordinal}/conclusion_contract"
                        ),
                    },
                    conclusion_id,
                    ending_target_id,
                )
                for key, value in conclusion_contract.items():
                    if key.endswith("_reward") and isinstance(value, dict):
                        reward_target_id = f"reward:{conclusion_id}:{key}"
                        register(
                            "rewards",
                            {
                                "target_id": reward_target_id,
                                "reward_id": None,
                                "contract_key": key,
                                "conclusion_id": conclusion_id,
                                "reward_kind": key.removesuffix("_reward"),
                                "source": "conclusion_rewards",
                                "reachable": scene_id in reachable,
                                "source_ref": _source_ref(
                                    "story-graph.json",
                                    f"/scenes/{ordinal}/conclusion_contract/{key}",
                                ),
                            },
                            key,
                            reward_target_id,
                        )
                if conclusion_contract.get("development_settlement") is not None:
                    development_target_id = f"development:{conclusion_id}"
                    register(
                        "development",
                        {
                            "target_id": development_target_id,
                            "conclusion_id": conclusion_id,
                            "reachable": scene_id in reachable,
                            "source_ref": _source_ref(
                                "story-graph.json",
                                f"/scenes/{ordinal}/conclusion_contract/development_settlement",
                            ),
                        },
                        development_target_id,
                    )

    for from_scene_id, ordinal, edge in raw_edges:
        to_scene_id = _text(edge.get("to"))
        assert to_scene_id is not None
        target_id = _edge_target_id(from_scene_id, ordinal, edge)
        explicit_edge_id = _text(edge.get("edge_id"))
        register(
            "edges",
            {
                "target_id": target_id,
                "edge_id": explicit_edge_id,
                "from_scene_id": from_scene_id,
                "to_scene_id": to_scene_id,
                "kind": _text(edge.get("kind")) or "unspecified",
                "when": edge.get("when"),
                "reachable": from_scene_id in reachable and to_scene_id in reachable,
                "source_ordinal": ordinal,
                "source_ref": _source_ref(
                    "story-graph.json",
                    f"/scenes/{list(scene_by_id).index(from_scene_id)}/scene_edges/{ordinal}",
                ),
            },
            *(item for item in (explicit_edge_id, target_id) if item),
        )

    clue_accumulator: dict[str, dict[str, Any]] = {}
    for conclusion_ordinal, conclusion in enumerate(clue_graph.get("conclusions") or []):
        if not isinstance(conclusion, dict):
            continue
        conclusion_id = _text(conclusion.get("conclusion_id"))
        if not conclusion_id:
            continue
        clue_ids: list[str] = []
        for clue_ordinal, clue in enumerate(conclusion.get("clues") or []):
            if not isinstance(clue, dict):
                continue
            clue_id = _text(clue.get("clue_id"))
            if not clue_id:
                continue
            clue_ids.append(clue_id)
            row = clue_accumulator.setdefault(
                clue_id,
                {
                    "target_id": f"clue-route:{clue_id}",
                    "clue_id": clue_id,
                    "conclusion_ids": [],
                    "delivery_kinds": [],
                    "chance_gated": False,
                    "bonus": False,
                    "source_refs": [],
                },
            )
            if conclusion_id not in row["conclusion_ids"]:
                row["conclusion_ids"].append(conclusion_id)
            delivery_kind = _text(clue.get("delivery_kind"))
            if delivery_kind and delivery_kind not in row["delivery_kinds"]:
                row["delivery_kinds"].append(delivery_kind)
            row["chance_gated"] = bool(
                row["chance_gated"]
                or delivery_kind == "skill_check"
                or clue.get("difficulty") is not None
            )
            row["bonus"] = bool(row["bonus"] or isinstance(clue.get("bonus"), dict))
            row["source_refs"].append(
                _source_ref(
                    "clue-graph.json",
                    f"/conclusions/{conclusion_ordinal}/clues/{clue_ordinal}",
                )
            )
        try:
            minimum_routes = int(conclusion.get("minimum_routes"))
        except (TypeError, ValueError):
            minimum_routes = len(clue_ids)
        target_id = f"conclusion:{conclusion_id}"
        register(
            "conclusions",
            {
                "target_id": target_id,
                "conclusion_id": conclusion_id,
                "clue_ids": clue_ids,
                "minimum_routes": max(0, min(minimum_routes, len(clue_ids))),
                "source_ref": _source_ref(
                    "clue-graph.json", f"/conclusions/{conclusion_ordinal}"
                ),
                "reachable": True,
            },
            conclusion_id,
            target_id,
        )

    for clue_id in sorted(clue_accumulator):
        row = clue_accumulator[clue_id]
        row["conclusion_ids"].sort()
        row["delivery_kinds"].sort()
        register("clue_routes", row, clue_id, row["target_id"])

    for ordinal, npc in enumerate(npc_agendas.get("npcs") or []):
        if not isinstance(npc, dict):
            continue
        npc_id = _text(npc.get("npc_id"))
        if not npc_id:
            continue
        target_id = f"npc:{npc_id}"
        register(
            "npcs",
            {
                "target_id": target_id,
                "npc_id": npc_id,
                "source_ref": _source_ref("npc-agendas.json", f"/npcs/{ordinal}"),
                "reachable": True,
            },
            npc_id,
            target_id,
        )

    # Explicit top-level reward/development rows are supported without guessing
    # semantics from prose.  They are part of the new Scenario IR extension.
    for category, key, id_key in (
        ("rewards", "conclusion_rewards", "reward_id"),
        ("development", "development_targets", "development_id"),
    ):
        for ordinal, item in enumerate(module_meta.get(key) or []):
            if not isinstance(item, dict):
                continue
            source_id = _text(item.get(id_key))
            if not source_id:
                continue
            target_id = f"{category.rstrip('s')}:{source_id}"
            if any(existing["target_id"] == target_id for existing in targets[category]):
                continue
            register(
                category,
                {
                    "target_id": target_id,
                    id_key: source_id,
                    "conclusion_id": _text(item.get("conclusion_id")),
                    "reward_kind": _text(item.get("reward_kind")),
                    "source": _text(item.get("source")),
                    "reachable": item.get("unreachable") is not True,
                    "source_ref": _source_ref("module-meta.json", f"/{key}/{ordinal}"),
                },
                source_id,
                target_id,
            )

    groups = _collect_explicit_groups(module_meta, story_graph, clue_graph)
    for scene_id, row in scene_by_id.items():
        group_id = _text(
            row.get("exclusive_group")
            or row.get("exclusivity_group")
            or row.get("ending_group")
            or row.get("branch_group")
        )
        if group_id:
            groups.append(
                {
                    "group_id": group_id,
                    "kind": "authored_exclusive",
                    "member_source_ids": [scene_id],
                    "source_ref": _source_ref(
                        "story-graph.json", f"/scenes/{list(scene_by_id).index(scene_id)}"
                    ),
                }
            )

    merged_groups: dict[str, dict[str, Any]] = {}
    for group in groups:
        current = merged_groups.setdefault(
            group["group_id"],
            {
                "group_id": group["group_id"],
                "kind": group.get("kind") or "authored_exclusive",
                "member_target_ids": [],
                "unresolved_member_source_ids": [],
                "source_refs": [],
            },
        )
        for source_id in group.get("member_source_ids") or []:
            resolved = sorted(source_to_target_ids.get(source_id, set()))
            if resolved:
                current["member_target_ids"].extend(resolved)
            else:
                current["unresolved_member_source_ids"].append(source_id)
        if group.get("source_ref"):
            current["source_refs"].append(group["source_ref"])
    exclusivity_groups = []
    for group_id in sorted(merged_groups):
        group = merged_groups[group_id]
        group["member_target_ids"] = sorted(set(group["member_target_ids"]))
        group["unresolved_member_source_ids"] = sorted(
            set(group["unresolved_member_source_ids"])
        )
        if group["unresolved_member_source_ids"]:
            raise CoverageContractError(
                f"exclusivity group {group_id} contains unknown members: "
                + ", ".join(group["unresolved_member_source_ids"])
            )
        exclusivity_groups.append(group)

    for category in TARGET_CATEGORIES:
        targets[category].sort(key=lambda row: row["target_id"])

    source_files = _json_file_manifest(root, root.glob("*.json"))
    plan: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "kind": PLAN_KIND,
        "purpose": "keeper_only_exhaustive_playtest_orchestration",
        "narrative_gate": False,
        "live_turn_integration": False,
        "scenario": {
            "scenario_id": scenario_id,
            "source_bundle_sha256": _manifest_digest(source_files),
            "source_files": source_files,
        },
        "targets": targets,
        "exclusivity_groups": exclusivity_groups,
        "unreachable": [
            {
                "target_id": row["target_id"],
                "reason": "not_reachable_from_explicit_start_graph",
                "source_ref": row["source_ref"],
            }
            for row in targets["scenes"]
            if row["reachable"] is False
        ],
    }
    plan["plan_sha256"] = _canonical_sha256(plan)
    return plan


# Public names used by the test orchestrator design.  Keep the implementation
# names descriptive while exposing the exact three-function surface.
plan_from_scenario_dir = generate_plan


def _require_artifact(value: dict[str, Any], *, kind: str) -> None:
    if value.get("schema_version") != SCHEMA_VERSION or value.get("kind") != kind:
        raise CoverageContractError(
            f"unsupported coverage schema; require schema_version={SCHEMA_VERSION}, kind={kind}"
        )


def _verify_plan(plan: dict[str, Any]) -> None:
    _require_artifact(plan, kind=PLAN_KIND)
    supplied = _text(plan.get("plan_sha256"))
    unsigned = dict(plan)
    unsigned.pop("plan_sha256", None)
    if supplied != _canonical_sha256(unsigned):
        raise CoverageContractError("coverage plan digest mismatch")


def _nested_exact_values(row: Any, singular: set[str], plural: set[str]) -> set[str]:
    found: set[str] = set()
    if isinstance(row, dict):
        for key, value in row.items():
            if key in singular:
                if text := _text(value):
                    found.add(text)
            elif key in plural:
                found.update(_texts(value))
            if isinstance(value, (dict, list)):
                found.update(_nested_exact_values(value, singular, plural))
    elif isinstance(row, list):
        for value in row:
            found.update(_nested_exact_values(value, singular, plural))
    return found


def _run_files(run_dir: Path, campaign_dir: Path) -> list[Path]:
    candidates = [
        run_dir / "playtest.json",
        run_dir / "run-identity.json",
        run_dir / "evidence.json",
        campaign_dir / "save" / "world-state.json",
        campaign_dir / "save" / "active-scene.json",
        campaign_dir / "save" / "combat.json",
        campaign_dir / "logs" / "events.jsonl",
        campaign_dir / "logs" / "rolls.jsonl",
        campaign_dir / "scenario" / "module-meta.json",
        campaign_dir / "scenario" / "story-graph.json",
        campaign_dir / "scenario" / "clue-graph.json",
        campaign_dir / "scenario" / "npc-agendas.json",
    ]
    candidates.extend((run_dir / "sandbox" / ".coc" / "investigators").glob("*/development.jsonl"))
    return [path for path in candidates if path.is_file()]


def _campaign_dir(run_dir: Path, playtest: dict[str, Any]) -> Path:
    campaigns_root = run_dir / "sandbox" / ".coc" / "campaigns"
    campaign_id = _text(playtest.get("campaign_id"))
    if not campaign_id:
        raise CoverageContractError("new-format playtest.json requires campaign_id")
    campaign_dir = campaigns_root / campaign_id
    if not campaign_dir.is_dir():
        raise CoverageContractError("playtest campaign directory is missing")
    return campaign_dir


def _receipt_ref(kind: str, index: int, identifier: str | None = None) -> str:
    suffix = f"#{index + 1}"
    if identifier:
        suffix += f":{identifier}"
    return f"{kind}{suffix}"


def observe_run(plan: dict[str, Any], run_dir: Path | str) -> dict[str, Any]:
    """Project authoritative current-format receipts into a post-run observation."""
    _verify_plan(plan)
    root = Path(run_dir).resolve()
    playtest = _read_json(root / "playtest.json")
    run_id = _text(playtest.get("run_id"))
    scenario_id = _text(playtest.get("scenario_id"))
    if not run_id or not scenario_id:
        raise CoverageContractError(
            "new-format playtest.json requires exact run_id and scenario_id"
        )
    if scenario_id != plan["scenario"]["scenario_id"]:
        raise CoverageContractError("run scenario_id does not match coverage plan")
    campaign_dir = _campaign_dir(root, playtest)
    world = _read_json(campaign_dir / "save" / "world-state.json")
    events = _read_jsonl(campaign_dir / "logs" / "events.jsonl")
    rolls = _read_jsonl(campaign_dir / "logs" / "rolls.jsonl")

    visited: dict[str, list[str]] = {}
    for scene_id in _texts(world.get("visited_scene_ids")):
        visited.setdefault(scene_id, []).append("save/world-state.json#visited_scene_ids")
    if active := _text(world.get("active_scene_id")):
        visited.setdefault(active, []).append("save/world-state.json#active_scene_id")

    transitions: list[tuple[str, str, str | None, str]] = []
    discovered: dict[str, list[str]] = {
        clue_id: ["save/world-state.json#discovered_clue_ids"]
        for clue_id in _texts(world.get("discovered_clue_ids"))
    }
    attempted_clues: dict[str, list[str]] = {}
    route_receipts: dict[str, list[str]] = {}
    conclusion_receipts: dict[str, list[str]] = {}
    ending_receipts: dict[str, list[str]] = {}
    reward_receipts: list[tuple[set[str], str]] = []
    development_receipts: list[tuple[set[str], str]] = []
    attested_npcs: dict[str, list[str]] = {}

    for index, row in enumerate(events):
        event_type = _text(row.get("event_type"))
        if not event_type:
            # Old type/payload wrappers are intentionally not migrated here.
            continue
        ref = _receipt_ref("logs/events.jsonl", index, event_type)
        if event_type in {"scene", "scene_entered"}:
            if scene_id := _text(row.get("scene_id")):
                visited.setdefault(scene_id, []).append(ref)
        if event_type == "scene_transition":
            before = _text(row.get("from_scene_id"))
            after = _text(row.get("to_scene_id"))
            if before and after:
                transitions.append((before, after, _text(row.get("edge_id")), ref))
                visited.setdefault(before, []).append(ref)
                visited.setdefault(after, []).append(ref)
        if event_type == "clue_discovered":
            if clue_id := _text(row.get("clue_id")):
                discovered.setdefault(clue_id, []).append(ref)
        if event_type in {"clue_attempt", "clue_route_attempt"}:
            if clue_id := _text(row.get("clue_id")):
                attempted_clues.setdefault(clue_id, []).append(ref)
        for route_id in _nested_exact_values(
            row,
            {"route_id", "affordance_id", "source_affordance_id"},
            {"route_ids", "matched_route_ids", "matched_affordance_ids"},
        ):
            route_receipts.setdefault(route_id, []).append(ref)
        if conclusion_id := _text(row.get("conclusion_id")):
            conclusion_receipts.setdefault(conclusion_id, []).append(ref)
            if event_type in {"session_ending", "conclusion", "scenario_conclusion"}:
                ending_receipts.setdefault(conclusion_id, []).append(ref)
        if event_type == "session_ending":
            if ending_id := _text(row.get("ending_id")):
                ending_receipts.setdefault(ending_id, []).append(ref)
            if scene_id := _text(row.get("scene_id")):
                ending_receipts.setdefault(f"scene:{scene_id}", []).append(ref)
        if event_type in {"reward", "conclusion_reward"}:
            reward_receipts.append(
                (
                    _nested_exact_values(
                        row,
                        {"reward_id", "reward_kind", "conclusion_id", "source"},
                        set(),
                    ),
                    ref,
                )
            )
        if event_type in {"development_settled", "development", "skill_development"}:
            development_receipts.append(
                (
                    _nested_exact_values(
                        row,
                        {"development_id", "conclusion_id", "source"},
                        set(),
                    ),
                    ref,
                )
            )
        if event_type == "npc_engagement":
            npc_id = _text(row.get("npc_id"))
            contract = row.get("identity_contract")
            binding = row.get("identity_binding")
            if (
                npc_id
                and isinstance(contract, dict)
                and _text(contract.get("npc_id")) == npc_id
                and isinstance(binding, dict)
                and binding
            ):
                attested_npcs.setdefault(npc_id, []).append(ref)

    for index, row in enumerate(rolls):
        if _text(row.get("event_type")) != "roll":
            continue
        ref = _receipt_ref("logs/rolls.jsonl", index, _text(row.get("roll_id")))
        clue_ids = _nested_exact_values(row, {"clue_id"}, {"clue_ids"})
        for clue_id in clue_ids:
            attempted_clues.setdefault(clue_id, []).append(ref)
        if _text(row.get("kind")) == "reward" or _text(row.get("reward_kind")):
            reward_receipts.append(
                (
                    _nested_exact_values(
                        row,
                        {"reward_id", "reward_kind", "conclusion_id", "source"},
                        set(),
                    ),
                    ref,
                )
            )

    investigator_root = root / "sandbox" / ".coc" / "investigators"
    for path in sorted(investigator_root.glob("*/development.jsonl")):
        for index, row in enumerate(_read_jsonl(path)):
            event_type = _text(row.get("event_type"))
            if event_type not in {"development_settled", "development", "skill_development"}:
                continue
            ref = f"{path.relative_to(root).as_posix()}#{index + 1}:{event_type}"
            development_receipts.append(
                (
                    _nested_exact_values(
                        row,
                        {"development_id", "conclusion_id", "source"},
                        set(),
                    ),
                    ref,
                )
            )

    observations: dict[str, list[dict[str, Any]]] = {
        category: [] for category in TARGET_CATEGORIES
    }

    def add(category: str, target: dict[str, Any], status: str, refs: Iterable[str]) -> None:
        observations[category].append(
            {
                "target_id": target["target_id"],
                "status": status,
                "evidence_refs": sorted(set(refs)),
            }
        )

    for target in plan["targets"]["scenes"]:
        refs = visited.get(target["scene_id"], [])
        add("scenes", target, "observed" if refs else "not_observed", refs)

    pair_counts: dict[tuple[str, str], int] = {}
    for target in plan["targets"]["edges"]:
        pair = (target["from_scene_id"], target["to_scene_id"])
        pair_counts[pair] = pair_counts.get(pair, 0) + 1
    for target in plan["targets"]["edges"]:
        refs = []
        pair = (target["from_scene_id"], target["to_scene_id"])
        for before, after, edge_id, ref in transitions:
            if (before, after) != pair:
                continue
            if target.get("edge_id"):
                if edge_id == target["edge_id"]:
                    refs.append(ref)
            elif pair_counts[pair] == 1:
                refs.append(ref)
        add("edges", target, "observed" if refs else "not_observed", refs)

    for target in plan["targets"]["side_branches"]:
        refs = list(route_receipts.get(target["affordance_id"], []))
        for clue_id in target.get("clue_ids") or []:
            refs.extend(discovered.get(clue_id, []))
            refs.extend(attempted_clues.get(clue_id, []))
        if refs:
            discovered_refs = []
            for clue_id in target.get("clue_ids") or []:
                discovered_refs.extend(discovered.get(clue_id, []))
            status = (
                "observed"
                if route_receipts.get(target["affordance_id"]) or discovered_refs
                else "attempted_not_discovered"
            )
        else:
            status = "not_observed"
        add("side_branches", target, status, refs)

    for target in plan["targets"]["clue_routes"]:
        clue_id = target["clue_id"]
        refs = discovered.get(clue_id, [])
        if refs:
            status = "observed"
        elif attempted_clues.get(clue_id):
            status = "attempted_not_discovered"
            refs = attempted_clues[clue_id]
        else:
            status = "not_observed"
        add("clue_routes", target, status, refs)

    for target in plan["targets"]["npcs"]:
        refs = attested_npcs.get(target["npc_id"], [])
        add("npcs", target, "observed" if refs else "not_observed", refs)

    for target in plan["targets"]["conclusions"]:
        conclusion_id = target["conclusion_id"]
        refs = list(conclusion_receipts.get(conclusion_id, []))
        clue_refs: list[str] = []
        for clue_id in target.get("clue_ids") or []:
            clue_refs.extend(discovered.get(clue_id, []))
        if len({clue_id for clue_id in target.get("clue_ids") or [] if clue_id in discovered}) >= target.get("minimum_routes", 0):
            refs.extend(clue_refs)
        add("conclusions", target, "observed" if refs else "not_observed", refs)

    for target in plan["targets"]["endings"]:
        refs = list(ending_receipts.get(target["ending_id"], []))
        refs.extend(ending_receipts.get(f"scene:{target['scene_id']}", []))
        add("endings", target, "observed" if refs else "not_observed", refs)

    for target in plan["targets"]["rewards"]:
        accepted = {
            value
            for value in (
                target.get("reward_id"),
                target.get("reward_kind"),
                target.get("conclusion_id"),
                target.get("source"),
            )
            if value
        }
        refs = [ref for values, ref in reward_receipts if accepted and accepted <= values]
        add("rewards", target, "observed" if refs else "not_observed", refs)

    for target in plan["targets"]["development"]:
        accepted = {
            value
            for value in (
                target.get("development_id"),
                target.get("conclusion_id"),
                target.get("source"),
            )
            if value
        }
        refs = [ref for values, ref in development_receipts if accepted and accepted <= values]
        add("development", target, "observed" if refs else "not_observed", refs)

    evidence_files = _json_file_manifest(root, _run_files(root, campaign_dir))
    observation: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "kind": OBSERVATION_KIND,
        "purpose": "post_run_test_observation",
        "narrative_gate": False,
        "plan_sha256": plan["plan_sha256"],
        "scenario_id": scenario_id,
        "source_bundle_sha256": plan["scenario"]["source_bundle_sha256"],
        "run": {
            "run_id": run_id,
            "run_evidence_sha256": _manifest_digest(evidence_files),
            "evidence_files": evidence_files,
        },
        "target_observations": observations,
    }
    observation["observation_sha256"] = _canonical_sha256(observation)
    return observation


def aggregate_observations(
    plan: dict[str, Any], observations: Iterable[dict[str, Any]]
) -> dict[str, Any]:
    """Union independent lane observations without mutating any run."""
    _verify_plan(plan)
    rows = list(observations)
    if not rows:
        raise CoverageContractError("at least one observation is required")
    run_ids: set[str] = set()
    for observation in rows:
        _require_artifact(observation, kind=OBSERVATION_KIND)
        supplied = _text(observation.get("observation_sha256"))
        unsigned = dict(observation)
        unsigned.pop("observation_sha256", None)
        if supplied != _canonical_sha256(unsigned):
            raise CoverageContractError("coverage observation digest mismatch")
        if observation.get("plan_sha256") != plan["plan_sha256"]:
            raise CoverageContractError("observation was generated from a different plan")
        if observation.get("source_bundle_sha256") != plan["scenario"]["source_bundle_sha256"]:
            raise CoverageContractError("observation source bundle digest mismatch")
        run_id = _text((observation.get("run") or {}).get("run_id"))
        if not run_id or run_id in run_ids:
            raise CoverageContractError("observation run_id values must be unique")
        run_ids.add(run_id)

    union: dict[str, list[dict[str, Any]]] = {category: [] for category in TARGET_CATEGORIES}
    uncovered: list[str] = []
    attempted_not_discovered: list[str] = []
    for category in TARGET_CATEGORIES:
        for target in plan["targets"][category]:
            if target.get("reachable") is False:
                continue
            statuses: list[tuple[str, str, list[str]]] = []
            for observation in rows:
                by_id = {
                    row["target_id"]: row
                    for row in observation["target_observations"][category]
                }
                item = by_id.get(target["target_id"])
                if item is None:
                    raise CoverageContractError(
                        f"observation missing target {target['target_id']}"
                    )
                statuses.append(
                    (
                        observation["run"]["run_id"],
                        item["status"],
                        item.get("evidence_refs") or [],
                    )
                )
            observed = [(run_id, refs) for run_id, status, refs in statuses if status == "observed"]
            attempted = [
                (run_id, refs)
                for run_id, status, refs in statuses
                if status == "attempted_not_discovered"
            ]
            status = "observed" if observed else (
                "attempted_not_discovered" if attempted else "not_observed"
            )
            union[category].append(
                {
                    "target_id": target["target_id"],
                    "status": status,
                    "observed_in_runs": [run_id for run_id, _refs in observed],
                    "attempted_in_runs": [run_id for run_id, _refs in attempted],
                }
            )
            if status != "observed":
                uncovered.append(target["target_id"])
            if status == "attempted_not_discovered":
                attempted_not_discovered.append(target["target_id"])

    union_status = {
        item["target_id"]: item["status"]
        for category in TARGET_CATEGORIES
        for item in union[category]
    }
    group_results = []
    for group in plan.get("exclusivity_groups") or []:
        missing = [
            target_id
            for target_id in group["member_target_ids"]
            if union_status.get(target_id) != "observed"
        ]
        group_results.append(
            {
                "group_id": group["group_id"],
                "status": "complete" if not missing else "incomplete",
                "member_target_ids": group["member_target_ids"],
                "unobserved_member_target_ids": missing,
            }
        )

    aggregate: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "kind": AGGREGATE_KIND,
        "purpose": "cross_lane_post_run_test_aggregate",
        "narrative_gate": False,
        "plan_sha256": plan["plan_sha256"],
        "scenario_id": plan["scenario"]["scenario_id"],
        "source_bundle_sha256": plan["scenario"]["source_bundle_sha256"],
        "runs": [
            {
                "run_id": observation["run"]["run_id"],
                "run_evidence_sha256": observation["run"]["run_evidence_sha256"],
                "observation_sha256": observation["observation_sha256"],
            }
            for observation in rows
        ],
        "union": union,
        "exclusivity_groups": group_results,
        "uncovered_reachable_target_ids": sorted(uncovered),
        "attempted_not_discovered_target_ids": sorted(attempted_not_discovered),
        "complete": not uncovered and all(
            row["status"] == "complete" for row in group_results
        ),
    }
    aggregate["aggregate_sha256"] = _canonical_sha256(aggregate)
    return aggregate


aggregate_lanes = aggregate_observations


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    plan = subparsers.add_parser("plan", help="generate private coverage plan")
    plan.add_argument("--scenario-dir", type=Path, required=True)
    plan.add_argument("--output", type=Path, required=True)

    observe = subparsers.add_parser("observe", help="collect post-run observation")
    observe.add_argument("--plan", type=Path, required=True)
    observe.add_argument("--run-dir", type=Path, required=True)
    observe.add_argument("--output", type=Path)

    aggregate = subparsers.add_parser("aggregate", help="union fresh-baseline lanes")
    aggregate.add_argument("--plan", type=Path, required=True)
    aggregate.add_argument("--observation", type=Path, action="append", required=True)
    aggregate.add_argument("--output", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "plan":
            result = generate_plan(args.scenario_dir)
            output = args.output
        elif args.command == "observe":
            plan = _read_json(args.plan)
            result = observe_run(plan, args.run_dir)
            output = args.output or args.run_dir / "artifacts" / "coverage-observation.json"
        else:
            plan = _read_json(args.plan)
            result = aggregate_observations(
                plan, (_read_json(path) for path in args.observation)
            )
            output = args.output
        _write_json(output, result)
    except CoverageContractError as exc:
        raise SystemExit(str(exc)) from exc
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
