#!/usr/bin/env python3
"""Host-side Pi-Coc debug experiment coordinator.

The public seam is ``DebugExperiment.dispatch``.  Slash-command adapters pass
closed ``run``/``status``/``cancel`` commands here; checkpoint identity,
processes, campaign copies, credentials, and evidence paths remain host-owned.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import traceback
from typing import Any


_PLUGIN_ROOT = Path(__file__).resolve().parents[2]
_SCRIPTS = _PLUGIN_ROOT / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import coc_git_history  # noqa: E402
import coc_npc_identity  # noqa: E402


_LANE_ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
_CAMPAIGN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
# Scene / NPC / clue / flag ids are authored semantic tokens; the same safe
# id grammar the kernel accepts for campaign-scoped identifiers.
_SITUATION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SITUATION_STRUCTURAL_KEYS = frozenset({
    "scene_id", "npc_presence", "clue_ids", "flags",
})
_SITUATION_KEYS = _SITUATION_STRUCTURAL_KEYS | {"establish_from_prompt"}
_MAX_SITUATION_LIST = 20
_TOOLBOX_SCRIPT = _SCRIPTS / "coc_toolbox.py"
_SITUATION_SEED_REASON = "host debug situation seeding"
_SITUATION_PROMPT_INSTRUCTION = (
    "[Host diagnostic instruction — not a player action] For this diagnostic "
    "lane the player's message below describes the situation the investigators "
    "are to be in. Before adjudicating it, establish that situation through the "
    "canonical state operations (state.move_scene, state.npc_presence, "
    "state.record_clue, state.set_flag); the party moves only through those "
    "tools. Do not fabricate mechanics: dice go through rules.* and results are "
    "never invented. Then adjudicate the message as the player's action in that "
    "situation."
)
# The lane's own resume prompt reaches the extension as a user message,
# indistinguishable from the player's, so releasing the resume-only tool
# surface on "any user message" released it immediately. The host marks its
# own prompts; only an unmarked one is the player's. The same literal lives in
# plugins/coc-keeper/pi/extensions/index.ts and is pinned by
# tests/pi/debug-lane-resume-surface.mjs.
DEBUG_LANE_HOST_PROMPT_MARKER = "[coc-debug-lane-host-prompt]"

# Operations that mean the Keeper acted for the player. None of them may run
# while the lane is still waiting for its resume to settle.
_RESUME_FORBIDDEN_OPERATIONS = frozenset({
    "state.journal", "turn.output_context", "turn.finalize", "rules.settle",
})

# Structural seeding lands after session.resume settled at awaiting_player.
# Seeding before the resume was tried on the real host: the seed rows read as
# an interrupted turn (open_turn_recovery), the Pi host then refused to act
# (acting_authorized=false, player input unbindable) and the lane deadlocked.
_SITUATION_SEEDED_TURN_NOTE = (
    "[Host diagnostic note — not a player action] After your resume, the host "
    "pre-established a situation through canonical state operations (scene, NPC "
    "presence, clues, flags). Re-read scene.context before adjudicating the "
    "player's message below, and do not treat its situation as an unearned claim."
)
_PROFILE_IDS = frozenset({
    "production",
    "rules-all-single-draft",
    "rules-director-single-draft",
})
_RECORD_KINDS = frozenset({
    "final",
    "rules",
    "director",
    "working_set",
    "timing",
    "state_diff",
    "tools",
    "rpc",
    "provider_stream",
    "stderr",
})
_DEFAULT_RECORD = (
    "final", "rules", "director", "working_set", "timing", "state_diff",
)
_TERMINAL = frozenset({"completed", "partial", "cancelled", "failed"})
_POST_FINALIZATION_AUDIT_PATHS = frozenset({
    "logs/canonical-events-sequence.json",
    "logs/canonical-events.jsonl",
    "logs/delivery-receipts.jsonl",
    # session.resume's orphan-roll quarantine appends `turn_tail_abandoned`
    # here after restoring save/ from the tip; the committed state is
    # untouched, so this is audit drift like the canonical event log.
    "logs/events.jsonl",
    "logs/toolbox-calls.jsonl",
})
_POST_FINALIZATION_OVERLAY_PATHS = frozenset({
    "memory/temporal/backlog.jsonl",
    "memory/temporal/episode-evidence.jsonl",
    "memory/temporal/episodes.jsonl",
    "save/continuation/delivery-receipts.jsonl",
})
_POST_FINALIZATION_ALLOWED_PATHS = (
    _POST_FINALIZATION_AUDIT_PATHS | _POST_FINALIZATION_OVERLAY_PATHS
)
_MAX_POST_FINALIZATION_OVERLAY_BYTES = 64 * 1024 * 1024
_MAX_LANES = 20
_MAX_CONCURRENCY = 20


class DebugExperimentError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _strict_object(value: Any, *, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise DebugExperimentError("debug_request_invalid", f"{label} must be an object")
    return value


def _exact_keys(value: dict[str, Any], allowed: set[str], *, label: str) -> None:
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label} has unknown fields: {', '.join(unknown)}",
        )


def _nonempty_text(value: Any, *, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise DebugExperimentError("debug_request_invalid", f"{label} must be non-empty")
    if "\x00" in value:
        raise DebugExperimentError("debug_request_invalid", f"{label} contains NUL")
    return value.strip()


def _lane_id(value: Any) -> str:
    token = _nonempty_text(value, label="lane.id")
    if _LANE_ID.fullmatch(token) is None or len(token) > 64:
        raise DebugExperimentError(
            "debug_request_invalid",
            "lane.id must be a short semantic kebab-case id",
        )
    if re.fullmatch(r"[0-9a-f]{24,}", token):
        raise DebugExperimentError("debug_request_invalid", "lane.id is opaque")
    return token


_DIRECTOR_GRAPH_PATH = (
    _PLUGIN_ROOT / "references" / "director-graph.json"
)


def _normalize_doctrine_overrides(raw: Any, *, label: str) -> dict[str, Any]:
    """Validate a lane's per-value doctrine overrides against the real graph.

    An override may only change the value of a doctrine node that already
    exists. It cannot add a node, change a node kind, or introduce a value of
    a different shape — so a lane can differ from production by exactly one
    recorded number and nothing else.
    """
    if raw is None:
        return {}
    overrides = _strict_object(raw, label=label)
    if not overrides:
        raise DebugExperimentError(
            "debug_request_invalid", f"{label} must not be empty when present",
        )
    try:
        graph = json.loads(_DIRECTOR_GRAPH_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise DebugExperimentError(
            "debug_request_invalid", f"DirectorGraph is unreadable: {exc}",
        ) from exc
    nodes = {
        row["node_id"]: row
        for row in graph.get("nodes", [])
        if isinstance(row, dict) and row.get("plane") == "doctrine"
    }
    normalized: dict[str, Any] = {}
    for node_id, value in overrides.items():
        node = nodes.get(node_id)
        if node is None:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}: {node_id!r} is not a doctrine node in the DirectorGraph",
            )
        current = (node.get("properties") or {}).get("value")
        if current is None:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}: {node_id!r} carries no value to override",
            )
        if type(value) is not type(current) or (
            isinstance(current, list) and len(value) != len(current)
        ):
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}: {node_id!r} expects a value shaped like {current!r}",
            )
        if value == current:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}: {node_id!r} override equals the production value",
            )
        normalized[node_id] = value
    return normalized


def _write_lane_director_graph(
    destination: Path, overrides: dict[str, Any]
) -> Path:
    """Write a lane-private DirectorGraph carrying the lane's overrides."""
    graph = json.loads(_DIRECTOR_GRAPH_PATH.read_text(encoding="utf-8"))
    for row in graph.get("nodes", []):
        if isinstance(row, dict) and row.get("node_id") in overrides:
            row["properties"]["value"] = overrides[row["node_id"]]
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return destination
def _situation_id(value: Any, *, label: str) -> str:
    token = _nonempty_text(value, label=label)
    if _SITUATION_ID.fullmatch(token) is None:
        raise DebugExperimentError(
            "debug_request_invalid", f"{label} must be a stable semantic id",
        )
    return token


def _situation_id_list(value: Any, *, label: str) -> list[str]:
    if not isinstance(value, list) or not 1 <= len(value) <= _MAX_SITUATION_LIST:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label} must be a list of 1 to {_MAX_SITUATION_LIST} ids",
        )
    ids = [_situation_id(item, label=f"{label}[{index}]") for index, item in enumerate(value)]
    if len(set(ids)) != len(ids):
        raise DebugExperimentError("debug_request_invalid", f"{label} contains duplicate ids")
    return ids


def _normalize_situation(raw: Any, *, label: str) -> dict[str, Any]:
    """Closed diagnostic situation: structural seeding or prompt-established.

    Both shapes are diagnostic-only. Structural seeding is applied in the
    sandbox lane through canonical state operations before the resume prompt;
    the prompt shape only prepends a host-owned instruction to the natural
    player message. Neither carries seeds, results, tools, paths, or env.
    """
    situation = _strict_object(raw, label=label)
    _exact_keys(situation, set(_SITUATION_KEYS), label=label)
    if not situation:
        raise DebugExperimentError("debug_request_invalid", f"{label} must not be empty")
    if "establish_from_prompt" in situation:
        if situation["establish_from_prompt"] is not True:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}.establish_from_prompt must be exactly true",
            )
        if len(situation) != 1:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label} cannot mix establish_from_prompt with structural seeding",
            )
        return {"shape": "prompt"}
    scene_id = (
        _situation_id(situation["scene_id"], label=f"{label}.scene_id")
        if "scene_id" in situation
        else None
    )
    npc_presence = (
        _situation_id_list(situation["npc_presence"], label=f"{label}.npc_presence")
        if "npc_presence" in situation
        else []
    )
    if npc_presence and scene_id is None:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label}.npc_presence requires {label}.scene_id (presence is per scene)",
        )
    clue_ids = (
        _situation_id_list(situation["clue_ids"], label=f"{label}.clue_ids")
        if "clue_ids" in situation
        else []
    )
    flags: dict[str, bool] = {}
    if "flags" in situation:
        raw_flags = _strict_object(situation["flags"], label=f"{label}.flags")
        if not 1 <= len(raw_flags) <= _MAX_SITUATION_LIST:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}.flags must hold 1 to {_MAX_SITUATION_LIST} flags",
            )
        for key, value in raw_flags.items():
            flag_id = _situation_id(key, label=f"{label}.flags key")
            if not isinstance(value, bool):
                raise DebugExperimentError(
                    "debug_request_invalid", f"{label}.flags[{flag_id}] must be boolean",
                )
            flags[flag_id] = value
    return {
        "shape": "structural",
        "scene_id": scene_id,
        "npc_presence": npc_presence,
        "clue_ids": clue_ids,
        "flags": flags,
    }


def _situation_operations(lane: dict[str, Any], campaign_id: str) -> list[dict[str, Any]]:
    """Canonical toolbox calls, in order, that seed one structural situation.

    Decision ids are semantic and lane-scoped so a sandbox replay of the same
    lane is idempotent and evidence names the exact seeded target.
    """
    situation = lane.get("situation") or {}
    if situation.get("shape") != "structural":
        return []
    lane_id = lane["id"]
    reason = f"{_SITUATION_SEED_REASON} for lane {lane_id}"
    operations: list[dict[str, Any]] = []
    scene_id = situation.get("scene_id")
    if scene_id:
        operations.append({
            "operation": "state.move_scene",
            "arguments": {
                "campaign": campaign_id,
                "scene_id": scene_id,
                "reason": reason,
                "decision_id": f"debug-situation:{lane_id}:move-scene:{scene_id}",
            },
        })
    for npc_id in situation.get("npc_presence") or []:
        operations.append({
            "operation": "state.npc_presence",
            "arguments": {
                "campaign": campaign_id,
                "npc_id": npc_id,
                "scene_id": scene_id,
                "status": "present",
                "reason": reason,
                "decision_id": f"debug-situation:{lane_id}:npc-presence:{npc_id}",
            },
        })
    for clue_id in situation.get("clue_ids") or []:
        operations.append({
            "operation": "state.record_clue",
            "arguments": {
                "campaign": campaign_id,
                "clue_id": clue_id,
                "method": reason,
                "decision_id": f"debug-situation:{lane_id}:record-clue:{clue_id}",
            },
        })
    for flag_id, value in (situation.get("flags") or {}).items():
        operations.append({
            "operation": "state.set_flag",
            "arguments": {
                "campaign": campaign_id,
                "flag_id": flag_id,
                "value": value,
                "reason": reason,
                "decision_id": f"debug-situation:{lane_id}:set-flag:{flag_id}",
            },
        })
    return operations


def _load_scenario_file(scenario_dir: Path, name: str) -> dict[str, Any]:
    path = scenario_dir / name
    if not path.is_file() or path.is_symlink():
        raise DebugExperimentError(
            "situation_catalog_unavailable",
            f"the sealed campaign has no readable scenario/{name}",
        )
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise DebugExperimentError(
            "situation_catalog_unavailable", f"scenario/{name} is unreadable",
        ) from exc
    if not isinstance(value, dict):
        raise DebugExperimentError(
            "situation_catalog_unavailable", f"scenario/{name} is not an object",
        )
    return value


def _validate_lane_situations(spec: dict[str, Any], checkpoint: dict[str, Any]) -> None:
    """Fail closed at planning on ids the sealed campaign does not author.

    Reads the sealed campaign's compiled scenario tables (the same files the
    kernel's ``Ctx.story_graph`` / ``clue_graph`` / ``npc_agendas`` load) so
    no lane spawns for a scene, NPC, or clue the Keeper could never present.
    Flags are free authored tokens and are only grammar-checked.
    """
    structural = [
        lane for lane in spec["lanes"]
        if (lane.get("situation") or {}).get("shape") == "structural"
    ]
    if not structural:
        return
    source_campaign = checkpoint.get("source_campaign")
    if not isinstance(source_campaign, str) or not source_campaign:
        raise DebugExperimentError(
            "situation_catalog_unavailable",
            "the sealed checkpoint names no source campaign for id validation",
        )
    scenario_dir = Path(source_campaign) / "scenario"
    if not scenario_dir.is_dir() or scenario_dir.is_symlink():
        raise DebugExperimentError(
            "situation_catalog_unavailable",
            "the sealed campaign has no scenario directory",
        )
    story_graph = _load_scenario_file(scenario_dir, "story-graph.json")
    clue_graph = _load_scenario_file(scenario_dir, "clue-graph.json")
    npc_agendas = _load_scenario_file(scenario_dir, "npc-agendas.json")
    scene_ids = {
        str(scene.get("scene_id"))
        for scene in story_graph.get("scenes") or []
        if isinstance(scene, dict) and scene.get("scene_id")
    }
    clue_ids = {
        str(clue.get("clue_id"))
        for conclusion in clue_graph.get("conclusions") or []
        if isinstance(conclusion, dict)
        for clue in conclusion.get("clues") or []
        if isinstance(clue, dict) and clue.get("clue_id")
    }
    for lane in structural:
        situation = lane["situation"]
        scene_id = situation.get("scene_id")
        if scene_id is not None and scene_id not in scene_ids:
            raise DebugExperimentError(
                "situation_unknown_scene",
                f"lane {lane['id']}: scene {scene_id!r} is not in the sealed story graph",
            )
        for npc_id in situation.get("npc_presence") or []:
            if coc_npc_identity.resolve_authored_npc(npc_agendas, npc_id) is None:
                raise DebugExperimentError(
                    "situation_unknown_npc",
                    f"lane {lane['id']}: NPC {npc_id!r} is not authored in the sealed campaign",
                )
        for clue_id in situation.get("clue_ids") or []:
            if clue_id not in clue_ids:
                raise DebugExperimentError(
                    "situation_unknown_clue",
                    f"lane {lane['id']}: clue {clue_id!r} is not in the sealed clue graph",
                )


def _normalize_run_spec(raw: Any) -> dict[str, Any]:
    spec = _strict_object(raw, label="run spec")
    _exact_keys(
        spec,
        {
            "player_input", "lanes", "record", "concurrency",
            "timeout_seconds", "situation",
        },
        label="run spec",
    )
    player_input = _nonempty_text(spec.get("player_input"), label="player_input")
    run_situation = (
        _normalize_situation(spec["situation"], label="situation")
        if "situation" in spec
        else None
    )
    raw_lanes = spec.get("lanes")
    if not isinstance(raw_lanes, list) or not 1 <= len(raw_lanes) <= _MAX_LANES:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"lanes must contain between 1 and {_MAX_LANES} cases",
        )
    lanes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, item in enumerate(raw_lanes):
        lane = _strict_object(item, label=f"lanes[{index}]")
        _exact_keys(
            lane,
            {"id", "profile", "player_input", "doctrine_overrides", "situation"},
            label=f"lanes[{index}]",
        )
        semantic_id = _lane_id(lane.get("id"))
        if semantic_id in seen:
            raise DebugExperimentError("debug_request_invalid", "lane ids must be unique")
        seen.add(semantic_id)
        profile = lane.get("profile", "production")
        if profile not in _PROFILE_IDS:
            raise DebugExperimentError(
                "debug_request_invalid", f"unsupported lane profile: {profile!r}",
            )
        lane_input = (
            player_input
            if "player_input" not in lane
            else _nonempty_text(lane["player_input"], label=f"lanes[{index}].player_input")
        )
        overrides = _normalize_doctrine_overrides(
            lane.get("doctrine_overrides"), label=f"lanes[{index}].doctrine_overrides"
        )
        lane_situation = (
            run_situation
            if "situation" not in lane
            else _normalize_situation(
                lane["situation"], label=f"lanes[{index}].situation",
            )
        )
        lanes.append({
            "id": semantic_id,
            "profile": profile,
            "player_input": lane_input,
            "doctrine_overrides": overrides,
            "situation": lane_situation,
        })

    timeout = spec.get("timeout_seconds", PRODUCT_TURN_BUDGET_SECONDS)
    if (
        not isinstance(timeout, int)
        or isinstance(timeout, bool)
        or not 1 <= timeout <= MAX_DIAGNOSTIC_TIMEOUT_SECONDS
    ):
        raise DebugExperimentError(
            "debug_request_invalid",
            "timeout_seconds must be an integer from 1 to "
            f"{MAX_DIAGNOSTIC_TIMEOUT_SECONDS}",
        )
    concurrency = spec.get("concurrency", min(2, len(lanes)))
    if (
        not isinstance(concurrency, int)
        or isinstance(concurrency, bool)
        or not 1 <= concurrency <= _MAX_CONCURRENCY
        or concurrency > len(lanes)
    ):
        raise DebugExperimentError(
            "debug_request_invalid",
            "concurrency must be an integer from 1 to "
            f"min({_MAX_CONCURRENCY}, lane count)",
        )
    raw_record = spec.get("record", list(_DEFAULT_RECORD))
    if not isinstance(raw_record, list) or any(not isinstance(row, str) for row in raw_record):
        raise DebugExperimentError("debug_request_invalid", "record must be a string list")
    if any(row not in _RECORD_KINDS for row in raw_record) or len(set(raw_record)) != len(raw_record):
        raise DebugExperimentError("debug_request_invalid", "record contains invalid or duplicate kinds")
    record = ["final", *(row for row in raw_record if row != "final")]
    return {
        "player_input": player_input,
        "situation": run_situation,
        "lanes": lanes,
        "record": record,
        "concurrency": concurrency,
        "timeout_seconds": timeout,
    }


def _requested_situation(lane: dict[str, Any]) -> dict[str, Any]:
    """Evidence stub naming which situation shape (if any) a lane requested."""
    situation = lane.get("situation")
    if not isinstance(situation, dict) or not situation.get("shape"):
        return {"shape": None}
    requested = {key: value for key, value in situation.items() if key != "shape"}
    return {"shape": situation["shape"], **({"requested": requested} if requested else {})}


def _budget_accounting(started: float) -> dict[str, Any]:
    """How long the lane took, and whether that beat the product's budget.

    A lane granted a diagnostic budget larger than the product's can finish a
    turn and still have failed the product goal, and a lane that failed early
    still measured something. Every terminal path reports both, so no result
    can quietly omit the comparison.
    """
    elapsed_ms = round((time.monotonic() - started) * 1000)
    return {
        "duration_ms": elapsed_ms,
        "product_budget_seconds": PRODUCT_TURN_BUDGET_SECONDS,
        "exceeded_product_budget": (
            elapsed_ms > PRODUCT_TURN_BUDGET_SECONDS * 1000
        ),
    }


#: The product's per-turn budget (spec §16.1). A lane that exceeds it has
#: failed the product goal even when the turn itself completes, so every lane
#: result records the overrun rather than letting a slow success read as a
#: pass.
PRODUCT_TURN_BUDGET_SECONDS = 180
#: Diagnostic ceiling. Measuring how far a turn overruns the budget is
#: impossible while the harness truncates at the budget, so a diagnostic may
#: ask for more — bounded, because an unbounded lane just hangs.
MAX_DIAGNOSTIC_TIMEOUT_SECONDS = 1800

#: Providers a diagnostic lane may run on. The gate exists so a lane cannot
#: quietly run through a relay or a fallback whose behaviour is not the
#: product's, which would make every measurement describe something else. It
#: is a closed set rather than one hardcoded name: which first-party provider
#: the account has quota on is the operator's call, and the lane still
#: verifies that the assistant messages actually came from the one that was
#: declared, so a silent fallback fails exactly as before.
_DEBUG_PROVIDERS = frozenset({"xai", "zai-coding-cn"})


def _validate_context(raw: Any, *, require_run: bool = False) -> dict[str, Any]:
    context = _strict_object(raw, label="debug context")
    if require_run:
        if context.get("role") != "play":
            raise DebugExperimentError("debug_not_play", "debug experiments require play role")
        if context.get("host_is_idle") is not True:
            raise DebugExperimentError(
                "debug_command_not_idle", "the current Pi-Coc host must be idle",
            )
        if context.get("provider") not in _DEBUG_PROVIDERS:
            raise DebugExperimentError(
                "debug_provider_unsupported",
                "debug experiments require a declared first-party provider: "
                + ", ".join(sorted(_DEBUG_PROVIDERS)),
            )
    campaign_id = context.get("campaign_id")
    if not isinstance(campaign_id, str) or _CAMPAIGN_ID.fullmatch(campaign_id) is None:
        raise DebugExperimentError("debug_request_invalid", "campaign_id is invalid")
    for field in ("workspace_root", "model", "thinking", "agent_home"):
        _nonempty_text(context.get(field), label=field)
    return dict(context)


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    descriptor = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    except BaseException:
        try:
            os.unlink(temp)
        except FileNotFoundError:
            pass
        raise


def _run_command(arguments: list[str], *, cwd: Path | None = None) -> str:
    completed = subprocess.run(
        arguments,
        cwd=cwd,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        message = (completed.stderr or completed.stdout).strip()
        raise DebugExperimentError(
            "checkpoint_materialization_failed",
            message or f"command failed: {arguments[0]}",
        )
    return completed.stdout.rstrip("\r\n")


def _git(repo: Path, worktree: Path, *arguments: str) -> str:
    return _run_command([
        "git",
        "--git-dir", str(repo),
        "--work-tree", str(worktree),
        "-c", "core.hooksPath=/dev/null",
        *arguments,
    ])


def _copy_workspace_support(source_coc: Path, destination_coc: Path) -> None:
    destination_coc.mkdir(parents=True, mode=0o700)
    for source in sorted(source_coc.iterdir(), key=lambda path: path.name):
        if source.name in {"campaigns", "repos", "debug"}:
            continue
        if source.is_symlink():
            raise DebugExperimentError(
                "checkpoint_materialization_failed",
                f"workspace support path is a symlink: {source.name}",
            )
        destination = destination_coc / source.name
        if source.is_dir():
            for nested in source.rglob("*"):
                if nested.is_symlink():
                    raise DebugExperimentError(
                        "checkpoint_materialization_failed",
                        f"workspace support contains a symlink: {source.name}",
                    )
            shutil.copytree(source, destination)
        elif source.is_file():
            shutil.copy2(source, destination)


def _delivery_receipt_for_tip(
    campaign: Path,
    *,
    campaign_id: str,
    finalization_id: str,
    rendered_text_sha256: str,
) -> dict[str, Any]:
    path = campaign / "save" / "continuation" / "delivery-receipts.jsonl"
    if not path.is_file() or path.is_symlink():
        raise DebugExperimentError(
            "checkpoint_delivery_unconfirmed",
            "the finalized tip has no confirmed delivery receipt",
        )
    selected: dict[str, Any] | None = None
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if (
                isinstance(row, dict)
                and row.get("campaign_id") == campaign_id
                and row.get("finalization_id") == finalization_id
            ):
                selected = row
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise DebugExperimentError(
            "checkpoint_delivery_unconfirmed",
            "the delivery receipt log is unreadable",
        ) from exc
    if (
        selected is None
        or selected.get("status") != "confirmed"
        or selected.get("rendered_text_sha256") != rendered_text_sha256
        or selected.get("ack_kind") not in {"displayed", "replayed"}
    ):
        raise DebugExperimentError(
            "checkpoint_delivery_unconfirmed",
            "the finalized tip delivery is not confirmed",
        )
    return selected


class GitCheckpointAdapter:
    """Read and materialize only the current tl-main finalized tip."""

    def seal_latest(self, context: dict[str, Any]) -> dict[str, Any]:
        workspace = Path(context["workspace_root"]).resolve()
        campaign_id = context["campaign_id"]
        source_coc = workspace / ".coc"
        if not source_coc.is_dir() or source_coc.is_symlink():
            raise DebugExperimentError("checkpoint_not_found", "workspace has no safe .coc root")
        try:
            repo = coc_git_history.repo_path_for(workspace, campaign_id)
            campaign = coc_git_history.worktree_path_for(workspace, campaign_id)
            timeline_id = coc_git_history.active_timeline_id(workspace, campaign_id)
        except (OSError, ValueError, coc_git_history.GitHistoryError) as exc:
            raise DebugExperimentError("checkpoint_not_found", str(exc)) from exc
        if timeline_id != coc_git_history.DEFAULT_TIMELINE_ID:
            raise DebugExperimentError(
                "checkpoint_timeline_unsupported",
                "MVP debug snapshots require the active tl-main timeline",
            )
        if (campaign / coc_git_history.PENDING_TURN_RELPATH).is_file():
            raise DebugExperimentError(
                "checkpoint_unsettled", "the campaign has a pending player turn",
            )
        if not repo.is_dir() or not campaign.is_dir():
            raise DebugExperimentError("checkpoint_not_found", "campaign Git is unavailable")
        status = _git(repo, campaign, "status", "--porcelain", "--untracked-files=no")
        dirty_paths = [
            line[3:].strip().strip('"')
            for line in status.splitlines()
            if len(line) >= 4
        ]
        unsafe_dirty = sorted(
            path for path in dirty_paths
            if path not in _POST_FINALIZATION_ALLOWED_PATHS
        )
        if unsafe_dirty:
            raise DebugExperimentError(
                "checkpoint_dirty",
                "the canonical campaign tree has non-audit tracked changes",
            )
        reference = coc_git_history.timeline_ref_name(timeline_id)
        commit = _git(repo, campaign, "rev-parse", "--verify", reference)
        message = _git(repo, campaign, "log", "-1", "--format=%B", commit)
        trailers = coc_git_history.parse_trailers(message)
        if (
            trailers.get("COC-Commit-Type") != "turn"
            or trailers.get("Campaign-Id") != campaign_id
            or trailers.get("Timeline-Id") != timeline_id
            or not str(trailers.get("Turn-Number") or "").isdigit()
            or not trailers.get("Finalization-Id")
        ):
            raise DebugExperimentError(
                "checkpoint_unsettled",
                "the active timeline tip is not one canonical finalized turn",
            )
        delivery_receipt = _delivery_receipt_for_tip(
            campaign,
            campaign_id=campaign_id,
            finalization_id=trailers["Finalization-Id"],
            rendered_text_sha256=str(trailers.get("Rendered-Text-SHA256") or ""),
        )
        overlays: list[dict[str, Any]] = []
        for relative in sorted(
            set(dirty_paths) & _POST_FINALIZATION_OVERLAY_PATHS
        ):
            source = campaign / relative
            if not source.is_file() or source.is_symlink():
                raise DebugExperimentError(
                    "checkpoint_tree_mismatch",
                    "post-finalization overlay is unavailable or unsafe",
                )
            payload = source.read_bytes()
            if len(payload) > _MAX_POST_FINALIZATION_OVERLAY_BYTES:
                raise DebugExperimentError(
                    "checkpoint_tree_mismatch",
                    "post-finalization overlay exceeds the debug snapshot limit",
                )
            overlays.append({
                "path": relative,
                "size_bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            })
        return {
            "campaign_id": campaign_id,
            "timeline_id": timeline_id,
            "turn": int(trailers["Turn-Number"]),
            "finalization_id": trailers["Finalization-Id"],
            "commit": commit,
            "source_workspace": str(workspace),
            "source_repo": str(repo),
            "source_campaign": str(campaign),
            "source_status": status,
            "post_finalization_audit_paths": sorted(dirty_paths),
            "post_finalization_overlays": overlays,
            "delivery_receipt": delivery_receipt,
        }

    def materialize(
        self,
        checkpoint: dict[str, Any],
        lane_workspace: Path | str,
    ) -> dict[str, Any]:
        destination = Path(lane_workspace)
        if destination.exists():
            raise DebugExperimentError(
                "checkpoint_materialization_failed", "lane workspace already exists",
            )
        source_workspace = Path(checkpoint["source_workspace"])
        source_repo = Path(checkpoint["source_repo"])
        source_campaign = Path(checkpoint["source_campaign"])
        campaign_id = checkpoint["campaign_id"]
        expected_commit = checkpoint["commit"]
        before_ref = _git(source_repo, source_campaign, "rev-parse", "refs/heads/main")
        before_status = _git(
            source_repo, source_campaign, "status", "--porcelain", "--untracked-files=no",
        )

        lane_coc = destination / ".coc"
        _copy_workspace_support(source_workspace / ".coc", lane_coc)
        lane_repo = lane_coc / "repos" / "campaigns" / f"{campaign_id}.git"
        lane_campaign = lane_coc / "campaigns" / campaign_id
        lane_repo.parent.mkdir(parents=True, mode=0o700)
        lane_campaign.parent.mkdir(parents=True, mode=0o700)
        _run_command([
            "git", "clone", "--mirror", "--no-local",
            str(source_repo), str(lane_repo),
        ])
        _run_command([
            "git", "--git-dir", str(lane_repo),
            "-c", "core.hooksPath=/dev/null",
            "worktree", "add", str(lane_campaign), "main",
        ])
        actual_commit = _git(lane_repo, lane_campaign, "rev-parse", "HEAD")
        if actual_commit != expected_commit:
            raise DebugExperimentError(
                "checkpoint_tree_mismatch", "lane checkpoint identity drifted",
            )
        materialized_overlay_paths: set[str] = set()
        for row in checkpoint.get("post_finalization_overlays") or []:
            if not isinstance(row, dict):
                raise DebugExperimentError(
                    "checkpoint_tree_mismatch",
                    "post-finalization overlay manifest is invalid",
                )
            relative = row.get("path")
            if relative not in _POST_FINALIZATION_OVERLAY_PATHS:
                raise DebugExperimentError(
                    "checkpoint_tree_mismatch",
                    "post-finalization overlay path is not allowed",
                )
            source = source_campaign / str(relative)
            if not source.is_file() or source.is_symlink():
                raise DebugExperimentError(
                    "checkpoint_tree_mismatch",
                    "post-finalization overlay source drifted",
                )
            payload = source.read_bytes()
            if (
                len(payload) != row.get("size_bytes")
                or hashlib.sha256(payload).hexdigest() != row.get("sha256")
            ):
                raise DebugExperimentError(
                    "checkpoint_tree_mismatch",
                    "post-finalization overlay content drifted",
                )
            target = lane_campaign / str(relative)
            if target.is_symlink():
                raise DebugExperimentError(
                    "checkpoint_tree_mismatch",
                    "post-finalization overlay target is unsafe",
                )
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            target.write_bytes(payload)
            materialized_overlay_paths.add(str(relative))
        delivery_path = (
            lane_campaign / "save" / "continuation" / "delivery-receipts.jsonl"
        )
        existing_delivery = (
            delivery_path.read_text(encoding="utf-8")
            if delivery_path.is_file() and not delivery_path.is_symlink()
            else ""
        )
        serialized_delivery = json.dumps(
            checkpoint["delivery_receipt"], ensure_ascii=False,
            separators=(",", ":"),
        )
        if (
            "save/continuation/delivery-receipts.jsonl"
            not in materialized_overlay_paths
            and serialized_delivery not in existing_delivery.splitlines()
        ):
            _append_jsonl(delivery_path, checkpoint["delivery_receipt"])
        if _git(source_repo, source_campaign, "rev-parse", "refs/heads/main") != before_ref:
            raise DebugExperimentError(
                "debug_production_write_forbidden", "source campaign ref changed",
            )
        if _git(
            source_repo, source_campaign, "status", "--porcelain", "--untracked-files=no",
        ) != before_status:
            raise DebugExperimentError(
                "debug_production_write_forbidden", "source campaign tree changed",
            )
        return {
            "workspace_root": str(destination.resolve()),
            "campaign_dir": str(lane_campaign.resolve()),
            "repo": str(lane_repo.resolve()),
            "commit": actual_commit,
        }


_SECRET_FIELD = re.compile(
    r"(?:authorization|api[_-]?key|token|password|secret|cookie)", re.IGNORECASE,
)
_AUTHORIZATION_TEXT = re.compile(
    r"(authorization\s*[:=]\s*(?:bearer\s+)?)([^\s,;]+)",
    re.IGNORECASE,
)
_SECRET_ASSIGNMENT_TEXT = re.compile(
    r"((?:api[_-]?key|token|password|secret|cookie)\s*[:=]\s*)([^\s,;]+)",
    re.IGNORECASE,
)


def _redact_free_text(value: str) -> str:
    redacted = _AUTHORIZATION_TEXT.sub(r"\1<REDACTED>", value)
    return _SECRET_ASSIGNMENT_TEXT.sub(r"\1<REDACTED>", redacted)


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): (
                "<REDACTED>" if _SECRET_FIELD.search(str(key)) else _redact(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(_redact(row), ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def _append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(
        path,
        os.O_WRONLY | os.O_CREAT | os.O_APPEND,
        0o600,
    )
    with os.fdopen(descriptor, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(_redact(row), ensure_ascii=False) + "\n")
        handle.flush()


class DebugRunCoordinator:
    """Inline coordinator; subprocess execution uses the same execute method."""

    def __init__(self, *, store: "FileRunStore", checkpoint: Any, lane: Any) -> None:
        self.store = store
        self.checkpoint = checkpoint
        self.lane = lane
        self._manifest_lock = threading.Lock()

    def _set_lane_status(
        self,
        run: dict[str, Any],
        lane_id: str,
        value: dict[str, Any],
    ) -> None:
        with self._manifest_lock:
            run["lane_statuses"] = [
                value if row.get("id") == lane_id else row
                for row in run.get("lane_statuses", [])
            ]
            self.store.save(run)

    def _cancelled(self, run: dict[str, Any]) -> bool:
        return (self.store.root / run["experiment_id"] / "CANCEL").is_file()

    def _record_lane(
        self,
        run: dict[str, Any],
        lane: dict[str, Any],
        result: dict[str, Any],
    ) -> dict[str, Any]:
        lane_root = (
            self.store.root / run["experiment_id"] / "lanes" / lane["id"]
        )
        lane_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        final = result.get("final")
        if not isinstance(final, dict):
            final = {
                "player_input": lane["player_input"],
                "rendered_text": None,
                "finalized": False,
                "exact_delivery": False,
            }
        final = dict(final)
        if not isinstance(final.get("situation"), dict):
            # The lane adapter owns application evidence; when it reported
            # none, record only what was requested so seeded evidence can
            # never be mistaken for natural play.
            final["situation"] = {**_requested_situation(lane), "reported": False}
        _atomic_json(lane_root / "final.json", _redact(final))
        selected = set(run["spec"]["record"])
        events = [
            event for event in (result.get("events") or [])
            if isinstance(event, dict)
        ]
        filenames = {
            "rules": "rules.jsonl",
            "director": "director.jsonl",
            "working_set": "working-set.jsonl",
            "timing": "timing.jsonl",
            "tools": "tools.jsonl",
            "rpc": "rpc.jsonl",
            "provider_stream": "provider-stream.jsonl",
            "stderr": "stderr.jsonl",
        }
        for category, filename in filenames.items():
            if category not in selected:
                continue
            rows = [event for event in events if event.get("category") == category]
            if rows:
                _write_jsonl(lane_root / filename, rows)
        if "state_diff" in selected and isinstance(result.get("state_diff"), dict):
            _atomic_json(lane_root / "state-diff.json", _redact(result["state_diff"]))

        status = str(result.get("status") or "failed")
        summary: dict[str, Any] = {
            "id": lane["id"],
            "status": status,
            "resume_first": result.get("resume_first") is True,
            "duration_ms": result.get("duration_ms"),
            "finalized": final.get("finalized") is True,
            "exact_delivery": final.get("exact_delivery") is True,
        }
        error = result.get("error")
        if isinstance(error, dict):
            summary["error"] = _redact(error)
        if isinstance(result.get("abort_count"), int):
            summary["abort_count"] = result["abort_count"]
        if isinstance(result.get("abort_confirmed"), bool):
            summary["abort_confirmed"] = result["abort_confirmed"]
        return summary

    def _comparison_lane(
        self,
        run: dict[str, Any],
        summary: dict[str, Any],
    ) -> dict[str, Any]:
        lane_root = (
            self.store.root / run["experiment_id"] / "lanes" / summary["id"]
        )
        final: dict[str, Any] = {}
        final_path = lane_root / "final.json"
        if final_path.is_file():
            value = json.loads(final_path.read_text(encoding="utf-8"))
            if isinstance(value, dict):
                final = value
        operation_rows: list[dict[str, Any]] = []
        tool_path = lane_root / "tools.jsonl"
        candidate_paths = (
            [tool_path]
            if tool_path.is_file()
            else [lane_root / "rules.jsonl", lane_root / "director.jsonl"]
        )
        for path in candidate_paths:
            if not path.is_file():
                continue
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                value = json.loads(line)
                if isinstance(value, dict) and isinstance(value.get("operation"), str):
                    operation_rows.append(value)
        operations: list[str] = []
        for row in operation_rows:
            if row.get("phase") not in {None, "start"}:
                continue
            operation = row["operation"]
            if operation not in operations:
                operations.append(operation)
        state_diff: dict[str, Any] | None = None
        state_path = lane_root / "state-diff.json"
        if state_path.is_file():
            value = json.loads(state_path.read_text(encoding="utf-8"))
            if isinstance(value, dict):
                state_diff = value
        return {
            **summary,
            "player_input": final.get("player_input"),
            "rendered_text": final.get("rendered_text"),
            "situation": final.get("situation", {"shape": None}),
            "canonical_operations": operations,
            "state_diff": state_diff,
        }

    def _run_lane(
        self,
        run: dict[str, Any],
        lane: dict[str, Any],
    ) -> dict[str, Any]:
        if self._cancelled(run):
            return {
                "id": lane["id"],
                "status": "cancelled",
                "resume_first": False,
                "duration_ms": 0,
                "finalized": False,
                "exact_delivery": False,
            }
        sandbox = self.store.root / run["experiment_id"] / "sandboxes" / lane["id"]
        try:
            self._set_lane_status(run, lane["id"], {
                "id": lane["id"], "status": "materializing",
            })
            materialized = self.checkpoint.materialize(run["checkpoint"], sandbox)
            self._set_lane_status(run, lane["id"], {
                "id": lane["id"], "status": "running",
            })
            result = self.lane.run(
                lane=lane,
                run=run,
                materialized=materialized,
                cancelled=lambda: self._cancelled(run),
            )
            if not isinstance(result, dict):
                raise DebugExperimentError(
                    "debug_lane_contract_drift", "lane returned no result object",
                )
            return self._record_lane(run, lane, result)
        except Exception as exc:
            result = {
                "status": "failed",
                "resume_first": False,
                "duration_ms": 0,
                "error": {
                    "code": getattr(exc, "code", "debug_lane_failed"),
                    "message": str(exc),
                },
                "events": [],
                "final": {
                    "player_input": lane["player_input"],
                    "rendered_text": None,
                    "finalized": False,
                    "exact_delivery": False,
                    "situation": {**_requested_situation(lane), "reported": False},
                },
            }
            return self._record_lane(run, lane, result)

    def start(self, run: dict[str, Any]) -> None:
        lanes = run["spec"]["lanes"]
        by_id: dict[str, dict[str, Any]] = {}
        with ThreadPoolExecutor(max_workers=run["spec"]["concurrency"]) as pool:
            futures = {
                pool.submit(self._run_lane, run, lane): lane["id"]
                for lane in lanes
            }
            for future in as_completed(futures):
                lane_id = futures[future]
                by_id[lane_id] = future.result()
                self._set_lane_status(run, lane_id, by_id[lane_id])
        summaries = [by_id[lane["id"]] for lane in lanes]
        completed = sum(row["status"] == "completed" for row in summaries)
        if completed == len(summaries):
            run["status"] = "completed"
        elif completed:
            run["status"] = "partial"
        elif self._cancelled(run):
            run["status"] = "cancelled"
        else:
            run["status"] = "failed"
        run["lane_statuses"] = summaries
        self.store.save(run)
        comparison_lanes = [
            self._comparison_lane(run, summary) for summary in summaries
        ]
        _atomic_json(
            self.store.root / run["experiment_id"] / "comparison.json",
            {
                "schema_version": 1,
                "contract_id": "coc.pi-debug-comparison.v1",
                "experiment_id": run["experiment_id"],
                "status": run["status"],
                "lanes": comparison_lanes,
            },
        )

    def cancel(self, run: dict[str, Any]) -> None:
        target = self.store.root / run["experiment_id"] / "CANCEL"
        if not target.exists():
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(descriptor)


def _semantic_operation(tool_name: Any) -> str:
    name = str(tool_name or "")
    if not name.startswith("coc_"):
        return name
    body = name[4:]
    domain, separator, operation = body.partition("_")
    return f"{domain}.{operation}" if separator else body


def _assistant_text(message: Any) -> str:
    if not isinstance(message, dict) or message.get("role") != "assistant":
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "".join(
        str(part.get("text") or "")
        for part in content
        if isinstance(part, dict) and part.get("type") == "text"
    )


def _tool_result_details(event: dict[str, Any]) -> dict[str, Any]:
    result = event.get("result")
    if isinstance(result, dict):
        details = result.get("details")
        if isinstance(details, dict):
            return details
        content = result.get("content")
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict) or not isinstance(part.get("text"), str):
                    continue
                try:
                    parsed = json.loads(part["text"])
                except json.JSONDecodeError:
                    continue
                if isinstance(parsed, dict):
                    return parsed
    return {}


def _tool_result_success(event: dict[str, Any]) -> bool:
    if event.get("isError") is True:
        return False
    details = _tool_result_details(event)
    return details.get("ok") is not False


def _rendered_text_from_tool(event: dict[str, Any]) -> str:
    details = _tool_result_details(event)
    data = details.get("data")
    if isinstance(data, dict) and isinstance(data.get("rendered_text"), str):
        return data["rendered_text"]
    if isinstance(details.get("rendered_text"), str):
        return details["rendered_text"]
    return ""


class PiRpcLaneAdapter:
    """One real Pi RPC process, one resume, one player send, one deadline."""

    def __init__(
        self,
        *,
        repo_root: Path | str,
        private_root: Path | str,
        command_builder: Any | None = None,
        extra_env: dict[str, str] | None = None,
    ) -> None:
        self.repo_root = Path(repo_root).resolve()
        self.private_root = Path(private_root)
        self.command_builder = command_builder
        self.extra_env = dict(extra_env or {})

    def _command(
        self,
        lane: dict[str, Any],
        run: dict[str, Any],
        materialized: dict[str, Any],
    ) -> list[str]:
        if self.command_builder is not None:
            value = self.command_builder(lane, run, materialized)
            if not isinstance(value, list) or not value or any(
                not isinstance(part, str) or not part for part in value
            ):
                raise DebugExperimentError(
                    "rpc_spawn_failed", "debug command builder returned invalid argv",
                )
            return value
        launcher = self.repo_root / "plugins" / "coc-keeper" / "pi" / "bin" / "pi-coc"
        model = str(run["context"]["model"])
        # The launcher takes `<provider>/<model>`. Pinning the prefix to xai
        # launched every lane on the wrong provider while the context said
        # otherwise; the lane's own provider check then failed all six, which
        # is the gate working and the command builder not.
        provider = str(run["context"]["provider"])
        model_ref = model if "/" in model else f"{provider}/{model}"
        return [
            str(launcher),
            "--mode", "rpc",
            "--campaign", str(run["context"]["campaign_id"]),
            "--model", model_ref,
            "--thinking", str(run["context"]["thinking"]),
            "--no-session",
        ]

    def _private_home(self, run: dict[str, Any], lane: dict[str, Any]) -> Path:
        source = Path(run["context"]["agent_home"])
        if not source.is_dir() or source.is_symlink():
            raise DebugExperimentError("rpc_spawn_failed", "source Pi home is unavailable")
        for entry in source.rglob("*"):
            if not entry.is_symlink():
                continue
            try:
                resolved = entry.resolve(strict=True)
            except OSError as exc:
                raise DebugExperimentError(
                    "rpc_spawn_failed", "source Pi home contains a broken symlink",
                ) from exc
            if not resolved.is_file():
                raise DebugExperimentError(
                    "rpc_spawn_failed",
                    "source Pi home contains a directory symlink",
                )
        target = self.private_root / run["experiment_id"] / lane["id"] / "pi-home"
        if target.exists():
            raise DebugExperimentError("rpc_spawn_failed", "private Pi home already exists")
        target.parent.mkdir(parents=True, mode=0o700)

        def ignored(_directory: str, names: list[str]) -> set[str]:
            return {name for name in names if name == "sessions"}

        shutil.copytree(source, target, ignore=ignored, symlinks=False)
        os.chmod(target, 0o700)
        auth = target / "auth.json"
        if auth.exists():
            os.chmod(auth, 0o600)
        return target

    @staticmethod
    def _safe_env() -> dict[str, str]:
        allowed = {
            "HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TERM",
            "USER", "LOGNAME", "SHELL", "NODE_PATH", "SSL_CERT_FILE",
            "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "UV_CACHE_DIR",
        }
        return {key: value for key, value in os.environ.items() if key in allowed}

    @staticmethod
    def _terminate(process: subprocess.Popen[str]) -> None:
        if process.poll() is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=1.0)
            return
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=1.0)
        except subprocess.TimeoutExpired:
            pass

    def _seed_situation(
        self,
        *,
        lane: dict[str, Any],
        run: dict[str, Any],
        materialized: dict[str, Any],
        deadline: float,
        cancelled: Any,
    ) -> tuple[list[dict[str, Any]], str | None]:
        """Apply structural seeding through the canonical toolbox gateway.

        Every write goes through ``coc_toolbox.py`` (the same ``run_tool``
        gateway the Pi MCP server uses) inside the sandbox lane, with the
        host variables play sets, so the campaign state is canonical and the
        Keeper's next ``scene.context`` presents exactly what a real game
        would after those moves. Runs after the resume settled.
        Returns the applied rows and the failure kind, if any.
        """
        campaign_id = str(run["context"]["campaign_id"])
        workspace = str(materialized["workspace_root"])
        environment = self._safe_env()
        environment.update({
            "COC_HOST": "pi",
            "COC_PROJECT_ROOT": workspace,
            "COC_RUNTIME_ROOT": str(self.repo_root / "runtime"),
            "COC_WORKSPACE": workspace,
            "PYTHONDONTWRITEBYTECODE": "1",
        })
        applied: list[dict[str, Any]] = []
        for step in _situation_operations(lane, campaign_id):
            if cancelled():
                return applied, "cancelled"
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return applied, "timeout"
            row: dict[str, Any] = {
                "operation": step["operation"],
                "decision_id": step["arguments"]["decision_id"],
                "arguments": step["arguments"],
                "ok": False,
            }
            step_started = time.monotonic()
            try:
                completed = subprocess.run(
                    [
                        sys.executable,
                        str(_TOOLBOX_SCRIPT),
                        step["operation"],
                        "--root", workspace,
                        "--campaign", campaign_id,
                        "--json", json.dumps(step["arguments"], ensure_ascii=False),
                    ],
                    cwd=self.repo_root,
                    env=environment,
                    capture_output=True,
                    text=True,
                    timeout=remaining,
                    check=False,
                )
            except subprocess.TimeoutExpired:
                row["error"] = {"code": "situation_seed_timeout"}
                row["duration_ms"] = round((time.monotonic() - step_started) * 1000)
                applied.append(row)
                return applied, "timeout"
            row["duration_ms"] = round((time.monotonic() - step_started) * 1000)
            envelope: Any = None
            try:
                envelope = json.loads(completed.stdout)
            except json.JSONDecodeError:
                envelope = None
            if isinstance(envelope, dict):
                row["ok"] = envelope.get("ok") is True
                row["warnings"] = [
                    str(item) for item in (envelope.get("warnings") or [])
                ]
                if not row["ok"]:
                    row["error"] = (
                        envelope.get("error")
                        if isinstance(envelope.get("error"), dict)
                        else {"code": "situation_seed_failed"}
                    )
            else:
                row["error"] = {
                    "code": "situation_seed_protocol_error",
                    "message": _redact_free_text(
                        (completed.stderr or completed.stdout).strip()[-2000:]
                    ),
                }
            applied.append(row)
            if not row["ok"]:
                return applied, "situation_seed_failed"
        return applied, None

    def run(
        self,
        *,
        lane: dict[str, Any],
        run: dict[str, Any],
        materialized: dict[str, Any],
        cancelled: Any,
    ) -> dict[str, Any]:
        started = time.monotonic()
        deadline = started + float(run["spec"]["timeout_seconds"])
        situation_shape = (lane.get("situation") or {}).get("shape")
        situation_evidence = _requested_situation(lane)
        if situation_shape == "prompt":
            situation_evidence["instruction"] = _SITUATION_PROMPT_INSTRUCTION
        elif situation_shape == "structural":
            situation_evidence["instruction"] = _SITUATION_SEEDED_TURN_NOTE
            situation_evidence["applied"] = []
            situation_evidence["seeded"] = False
        turn_instruction = situation_evidence.get("instruction")

        def final_payload(
            rendered_text: str | None, *, finalized: bool, exact_delivery: bool,
        ) -> dict[str, Any]:
            return {
                "player_input": lane["player_input"],
                "rendered_text": rendered_text,
                "finalized": finalized,
                "exact_delivery": exact_delivery,
                "situation": situation_evidence,
            }

        private_home: Path | None = None
        process: subprocess.Popen[str] | None = None
        stderr_thread: threading.Thread | None = None
        event_queue: queue.Queue[tuple[str, Any]] = queue.Queue()
        stderr_parts: list[str] = []
        events: list[dict[str, Any]] = []
        abort_count = 0
        abort_confirmed = False
        abort_id = f"abort-{lane['id']}"
        visible_text = ""
        rendered_text = ""
        finalized = False
        resume_first = False
        resume_success = False
        provider_verified = False
        provider_identity_error: str | None = None
        first_operation: str | None = None
        resume_acted_for_player: str | None = None
        current_phase = "launching"
        last_event_type = ""
        evidence_value = run.get("evidence_root")
        live_root = (
            Path(evidence_value) / "lanes" / lane["id"]
            if isinstance(evidence_value, str) and evidence_value
            else None
        )

        def progress(stage: str) -> None:
            if live_root is None:
                return
            _atomic_json(live_root / "progress.json", {
                "schema_version": 1,
                "lane_id": lane["id"],
                "stage": stage,
                "last_event_type": last_event_type,
                "elapsed_ms": round((time.monotonic() - started) * 1000),
            })

        def read_stdout() -> None:
            assert process is not None and process.stdout is not None
            try:
                for line in process.stdout:
                    try:
                        event_queue.put(("event", json.loads(line)))
                    except json.JSONDecodeError:
                        event_queue.put(("error", "rpc_protocol_corrupt"))
            finally:
                event_queue.put(("eof", None))

        def read_stderr() -> None:
            assert process is not None and process.stderr is not None
            for chunk in iter(lambda: process.stderr.read(4096), ""):
                if not chunk:
                    break
                if sum(len(part) for part in stderr_parts) < 65536:
                    stderr_parts.append(chunk)

        def send(value: dict[str, Any]) -> None:
            assert process is not None and process.stdin is not None
            process.stdin.write(json.dumps(value, ensure_ascii=False) + "\n")
            process.stdin.flush()

        def observe(event: dict[str, Any]) -> None:
            nonlocal first_operation, resume_success, visible_text
            nonlocal rendered_text, finalized, last_event_type, abort_confirmed
            nonlocal provider_verified, provider_identity_error
            nonlocal resume_acted_for_player
            event_type = event.get("type")
            last_event_type = str(event_type or "")
            if live_root is not None and "rpc" in run["spec"]["record"]:
                _append_jsonl(live_root / "live-rpc.jsonl", event)
            if (
                event_type == "response"
                and event.get("id") == abort_id
                and event.get("command") == "abort"
                and event.get("success") is True
            ):
                abort_confirmed = True
            if event_type != "message_update":
                progress(current_phase)
            tool_name = event.get("toolName") or event.get("tool")
            if event_type == "message_start":
                message = event.get("message")
                if isinstance(message, dict) and message.get("role") == "assistant":
                    provider = message.get("provider")
                    model = message.get("model")
                    if isinstance(provider, str) and isinstance(model, str):
                        if (
                            provider == str(run["context"]["provider"])
                            and model == str(run["context"]["model"])
                        ):
                            provider_verified = True
                        else:
                            provider_identity_error = "debug_provider_mismatch"
            if event_type in {"tool_execution_start", "tool_execution_end"}:
                operation = _semantic_operation(tool_name)
                if (
                    event_type == "tool_execution_start"
                    and first_operation is None
                    and "." in operation
                ):
                    first_operation = operation
                # The resume prompt says to stop at awaiting_player. A Keeper
                # that journals or finalizes during it has played a turn of
                # its own invention: the lane's budget is gone, the sandbox
                # campaign has advanced, and any situation seeded afterwards
                # describes a state the probe never asked for. Observed on
                # 2026-09-02 in two of six lanes.
                if (
                    current_phase == "resume"
                    and event_type == "tool_execution_start"
                    and operation in _RESUME_FORBIDDEN_OPERATIONS
                ):
                    resume_acted_for_player = operation
                tool_row = {
                    "category": "tools",
                    "phase": "start" if event_type.endswith("start") else "end",
                    "operation": operation,
                    "event": _redact(event),
                }
                events.append(tool_row)
                if operation.startswith("rules."):
                    events.append({**tool_row, "category": "rules"})
                if operation.split(".", 1)[0] in {
                    "scene", "actions", "director", "storylets",
                }:
                    events.append({**tool_row, "category": "director"})
                if event_type == "tool_execution_end" and operation == "session.resume":
                    resume_success = _tool_result_success(event)
                if event_type == "tool_execution_end" and operation == "turn.finalize":
                    finalized = _tool_result_success(event)
                    if finalized:
                        rendered_text = _rendered_text_from_tool(event)
            elif event_type == "message_end":
                text = _assistant_text(event.get("message"))
                if text:
                    visible_text = text
            elif event_type == "entry_appended":
                entry = event.get("entry")
                custom = entry.get("customType") if isinstance(entry, dict) else None
                category = (
                    "working_set" if custom == "coc-tool-working-set"
                    else "timing" if custom == "coc-turn-timing"
                    else "rpc"
                )
                events.append({"category": category, "event": _redact(event)})
            else:
                events.append({"category": "rpc", "event": _redact(event)})
                if event_type in {"message_start", "message_update"}:
                    events.append({"category": "provider_stream", "event": _redact(event)})

        def wait_terminal(*, phase: str) -> tuple[bool, str | None]:
            nonlocal abort_count, current_phase
            current_phase = phase
            progress(phase)
            while True:
                if cancelled():
                    if abort_count == 0:
                        send({"type": "abort", "id": abort_id})
                        abort_count = 1
                    return False, "cancelled"
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    if abort_count == 0:
                        send({"type": "abort", "id": abort_id})
                        abort_count = 1
                    drain_until = time.monotonic() + 1.5
                    settled_seen = False
                    while time.monotonic() < drain_until:
                        try:
                            kind, payload = event_queue.get(timeout=0.1)
                        except queue.Empty:
                            continue
                        if kind == "event" and isinstance(payload, dict):
                            observe(payload)
                            if payload.get("type") == "agent_settled":
                                settled_seen = True
                            if settled_seen and abort_confirmed:
                                break
                    return False, "timeout"
                try:
                    kind, payload = event_queue.get(timeout=min(0.1, remaining))
                except queue.Empty:
                    if process is not None and process.poll() is not None:
                        return False, "process_exit"
                    continue
                if kind == "error":
                    return False, str(payload)
                if kind == "eof":
                    return False, "process_exit"
                if not isinstance(payload, dict):
                    continue
                observe(payload)
                if provider_identity_error is not None:
                    return False, provider_identity_error
                if phase == "resume" and first_operation not in {None, "session.resume"}:
                    return False, "resume_order_violation"
                if payload.get("type") == "agent_settled":
                    return True, None

        try:
            progress("launching")
            private_home = self._private_home(run, lane)
            environment = self._safe_env()
            environment.update({
                "COC_WORKSPACE": str(materialized["workspace_root"]),
                "PI_COC_AGENT_DIR": str(private_home),
                # This session is a diagnostic lane: it drives its own
                # resume prompt, so the host must not also hand it the
                # startup instruction (the two compete and the Keeper
                # follows the host's, spending the lane budget on skill-doc
                # reads and tool discovery before any rule).
                "PI_COC_DEBUG_LANE": "1",
                "PI_COC_SESSION_ID": (
                    f"{run['experiment_id']}-{lane['id']}"
                ),
                **self.extra_env,
            })
            if lane.get("profile") != "production":
                environment["COC_PI_ACCEPTANCE_PROFILE"] = str(lane["profile"])
            overrides = lane.get("doctrine_overrides") or {}
            if overrides:
                environment["COC_DIRECTOR_GRAPH"] = str(_write_lane_director_graph(
                    Path(materialized["workspace_root"]) / ".coc" / "director-graph.json",
                    overrides,
                ))
            command = self._command(lane, run, materialized)
            process = subprocess.Popen(
                command,
                cwd=self.repo_root,
                env=environment,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                start_new_session=True,
            )
            threading.Thread(target=read_stdout, daemon=True).start()
            stderr_thread = threading.Thread(target=read_stderr, daemon=True)
            stderr_thread.start()
            send({
                "type": "prompt",
                "id": f"resume-{lane['id']}",
                "message": (
                    # The lane suppresses the host's startup instruction so the
                    # two do not compete, which means this prompt has to carry
                    # the clause that instruction owns. Without it the Keeper
                    # filled the vacuum: given only "stop at awaiting_player",
                    # it resumed, read the scene, journaled, built an output
                    # context and finalized a turn nobody asked for — measured
                    # 2026-09-02, four separate lanes.
                    f"{DEBUG_LANE_HOST_PROMPT_MARKER} "
                    "Host debug resume. session.resume must be the first canonical "
                    "campaign operation. Branch only on that session.resume result. "
                    "For awaiting_player, emit no new table prose and wait for the "
                    "player: do not journal, do not build an output context, do not "
                    "finalize, and do not act for the player in any way. This turn "
                    "is not yours to play. Stop after the resume settles and wait."
                ),
            })
            settled, failure = wait_terminal(phase="resume")
            resume_first = first_operation == "session.resume"
            if resume_acted_for_player is not None:
                return {
                    "status": "failed",
                    "resume_first": resume_first,
                    **_budget_accounting(started),
                    "abort_count": abort_count,
                    "abort_confirmed": abort_confirmed,
                    "error": {
                        "code": "resume_acted_for_player",
                        "details": {"operation": resume_acted_for_player},
                    },
                    "events": events,
                    "final": final_payload(
                        None, finalized=False, exact_delivery=False,
                    ),
                }
            if not settled or not resume_first or not resume_success or not provider_verified:
                if failure == "timeout":
                    status = "timed_out"
                    code = "lane_absolute_budget_exceeded"
                elif failure == "cancelled":
                    status = "cancelled"
                    code = "debug_cancelled"
                else:
                    status = "failed"
                    code = failure or (
                        "debug_provider_unverified"
                        if not provider_verified else "resume_failed"
                    )
                return {
                    "status": status,
                    "resume_first": resume_first,
                    **_budget_accounting(started),
                    "abort_count": abort_count,
                    "abort_confirmed": abort_confirmed,
                    "error": {"code": code},
                    "events": events,
                    "final": final_payload(None, finalized=False, exact_delivery=False),
                }
            if situation_shape == "structural":
                # The resume settled at awaiting_player; seed now so the seed
                # rows belong to the player's turn window, not to a phantom
                # interrupted turn the host would refuse to continue.
                current_phase = "seeding"
                progress("seeding")
                applied, seed_failure = self._seed_situation(
                    lane=lane,
                    run=run,
                    materialized=materialized,
                    deadline=deadline,
                    cancelled=cancelled,
                )
                situation_evidence["applied"] = applied
                situation_evidence["seeded"] = seed_failure is None
                for row in applied:
                    events.append({
                        "category": "tools",
                        "phase": "seed",
                        "operation": row["operation"],
                        "event": row,
                    })
                if seed_failure is not None:
                    if seed_failure == "timeout":
                        status, code = "timed_out", "lane_absolute_budget_exceeded"
                    elif seed_failure == "cancelled":
                        status, code = "cancelled", "debug_cancelled"
                    else:
                        status, code = "failed", "situation_seed_failed"
                    return {
                        "status": status,
                        "resume_first": resume_first,
                        **_budget_accounting(started),
                        "abort_count": abort_count,
                        "abort_confirmed": abort_confirmed,
                        "error": {"code": code},
                        "events": events,
                        "final": final_payload(
                            None, finalized=False, exact_delivery=False,
                        ),
                    }
            first_operation = None
            send({
                "type": "prompt",
                "id": f"turn-{lane['id']}",
                "message": (
                    f"{turn_instruction}\n\n{lane['player_input']}"
                    if turn_instruction
                    else lane["player_input"]
                ),
            })
            settled, failure = wait_terminal(phase="turn")
            if failure == "timeout":
                status = "timed_out"
                code = "turn_absolute_budget_exceeded"
            elif failure == "cancelled":
                status = "cancelled"
                code = "debug_cancelled"
            elif not settled:
                status = "failed"
                code = failure or "player_turn_undelivered"
            else:
                exact = bool(visible_text and rendered_text == visible_text)
                status = "completed" if finalized and exact else "failed"
                code = None if status == "completed" else "player_turn_undelivered"
            state_diff: dict[str, Any] = {}
            repo_value = materialized.get("repo")
            if isinstance(repo_value, str) and repo_value:
                repo = Path(repo_value)
                worktree = Path(materialized["workspace_root"]) / ".coc" / "campaigns" / run["context"]["campaign_id"]
                try:
                    current = _git(repo, worktree, "rev-parse", "refs/heads/main")
                    paths = _git(
                        repo, worktree, "diff", "--name-only",
                        run["checkpoint"]["commit"], current,
                    ).splitlines()
                    state_diff = {"changed_paths": paths}
                except DebugExperimentError:
                    state_diff = {"status": "unavailable"}
            result = {
                "status": status,
                "resume_first": resume_first,
                **_budget_accounting(started),
                "abort_count": abort_count,
                "abort_confirmed": abort_confirmed,
                "events": events,
                "state_diff": state_diff,
                "final": final_payload(
                    visible_text or None,
                    finalized=finalized,
                    exact_delivery=bool(visible_text and rendered_text == visible_text),
                ),
            }
            if code is not None:
                result["error"] = {"code": code}
            return result
        except (OSError, ValueError) as exc:
            return {
                "status": "failed",
                "resume_first": False,
                "duration_ms": round((time.monotonic() - started) * 1000),
                "abort_count": abort_count,
                "abort_confirmed": abort_confirmed,
                "error": {"code": "rpc_spawn_failed", "message": str(exc)},
                "events": events,
                "final": final_payload(None, finalized=False, exact_delivery=False),
            }
        finally:
            if process is not None:
                try:
                    if process.stdin is not None:
                        process.stdin.close()
                except OSError:
                    pass
                self._terminate(process)
            if stderr_thread is not None:
                stderr_thread.join(timeout=1.0)
            stderr_text = _redact_free_text("".join(stderr_parts).strip())
            if stderr_text:
                events.append({"category": "stderr", "text": stderr_text})
            if private_home is not None:
                try:
                    shutil.rmtree(private_home)
                except OSError:
                    pass
            current_phase = "terminal"
            progress("terminal")


class FileRunStore:
    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def allocate(self, campaign_id: str) -> str:
        stem = re.sub(r"[^A-Za-z0-9-]", "-", campaign_id).strip("-").lower()
        for ordinal in range(1, 10000):
            experiment_id = f"debug-{stem}-r{ordinal}"
            if not (self.root / experiment_id).exists():
                return experiment_id
        raise DebugExperimentError("debug_request_invalid", "debug run ordinal exhausted")

    def create(self, run: dict[str, Any]) -> None:
        target = self.root / run["experiment_id"]
        try:
            target.mkdir(mode=0o700)
        except FileExistsError as exc:
            raise DebugExperimentError("debug_request_invalid", "debug run already exists") from exc
        _atomic_json(target / "run.json", run)
        _atomic_json(self.root / f"current-{run['context']['campaign_id']}.json", {
            "experiment_id": run["experiment_id"],
        })

    def save(self, run: dict[str, Any]) -> None:
        _atomic_json(self.root / run["experiment_id"] / "run.json", run)

    def load(self, reference: str, campaign_id: str) -> dict[str, Any]:
        experiment_id = reference
        if reference == "current":
            pointer = self.root / f"current-{campaign_id}.json"
            if not pointer.is_file():
                raise DebugExperimentError("debug_run_not_found", "no current debug run")
            experiment_id = json.loads(pointer.read_text(encoding="utf-8"))[
                "experiment_id"
            ]
        path = self.root / experiment_id / "run.json"
        if not path.is_file():
            raise DebugExperimentError("debug_run_not_found", "debug run not found")
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or value.get("experiment_id") != experiment_id:
            raise DebugExperimentError("debug_run_corrupt", "debug run manifest is corrupt")
        return value

    def load_exact(self, experiment_id: str) -> dict[str, Any]:
        path = self.root / experiment_id / "run.json"
        if not path.is_file():
            raise DebugExperimentError("debug_run_not_found", "debug run not found")
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or value.get("experiment_id") != experiment_id:
            raise DebugExperimentError("debug_run_corrupt", "debug run manifest is corrupt")
        return value


def _public_run(run: dict[str, Any]) -> dict[str, Any]:
    checkpoint = run["checkpoint"]
    return {
        "status": run["status"],
        "experiment_id": run["experiment_id"],
        "checkpoint": {
            "campaign_id": checkpoint["campaign_id"],
            "timeline_id": checkpoint["timeline_id"],
            "turn": checkpoint["turn"],
        },
        "lanes": [row["id"] for row in run["spec"]["lanes"]],
        "spec": run["spec"],
        "lane_statuses": run.get("lane_statuses", []),
    }


def _coordinator_alive(run: dict[str, Any]) -> bool:
    pid = run.get("coordinator_pid")
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError):
        return False
    completed = subprocess.run(
        ["ps", "-p", str(pid), "-o", "command="],
        check=False,
        capture_output=True,
        text=True,
    )
    command = completed.stdout.strip()
    return (
        completed.returncode == 0
        and "pi_coc_debug_experiment.py execute" in command
        and f"--experiment-id {run.get('experiment_id')}" in command
    )


def _mark_coordinator_failure(run: dict[str, Any], message: str) -> None:
    run["status"] = "failed"
    run["error"] = {
        "code": "coordinator_exited_unsettled",
        "message": message,
    }
    run["lane_statuses"] = [
        row if row.get("status") in {
            "completed", "failed", "timed_out", "cancelled",
        } else {
            "id": row.get("id"),
            "status": "failed",
            "error": {"code": "coordinator_exited_unsettled"},
        }
        for row in run.get("lane_statuses", [])
    ]


class DebugExperiment:
    """One deep host-control interface over debug run lifecycle."""

    def __init__(self, *, store: FileRunStore, checkpoint: Any, executor: Any) -> None:
        self.store = store
        self.checkpoint = checkpoint
        self.executor = executor

    def dispatch(self, command: str, raw_context: dict[str, Any]) -> dict[str, Any]:
        action, separator, payload = command.strip().partition(" ")
        context = _validate_context(raw_context, require_run=action == "run")
        if action == "run":
            if not separator:
                raise DebugExperimentError("debug_request_invalid", "run requires one JSON spec")
            try:
                raw_spec = json.loads(payload)
            except json.JSONDecodeError as exc:
                raise DebugExperimentError("debug_request_invalid", "run spec is invalid JSON") from exc
            spec = _normalize_run_spec(raw_spec)
            checkpoint = self.checkpoint.seal_latest(context)
            # Unknown scene/NPC/clue ids fail closed here, before any run
            # directory, coordinator, or lane exists.
            _validate_lane_situations(spec, checkpoint)
            experiment_id = self.store.allocate(context["campaign_id"])
            run = {
                "schema_version": 1,
                "contract_id": "coc.pi-debug-experiment.v1",
                "experiment_id": experiment_id,
                "evidence_root": str(self.store.root / experiment_id),
                "status": "running",
                "context": context,
                "checkpoint": checkpoint,
                "spec": spec,
                "lane_statuses": [
                    {"id": lane["id"], "status": "queued"}
                    for lane in spec["lanes"]
                ],
            }
            self.store.create(run)
            try:
                self.executor.start(run)
            except Exception as exc:
                run["status"] = "failed"
                run["error"] = {"code": "debug_spawn_failed", "message": str(exc)}
                self.store.save(run)
                raise DebugExperimentError("debug_spawn_failed", "debug executor failed") from exc
            public = _public_run(run)
            return {
                "status": "started",
                "experiment_id": public["experiment_id"],
                "checkpoint": public["checkpoint"],
                "lanes": public["lanes"],
            }

        if action not in {"status", "cancel", "report"} or not separator:
            raise DebugExperimentError(
                "debug_request_invalid",
                "expected run <json>, status <id>, cancel <id>, or report <id>",
            )
        reference = payload.strip()
        if reference != "current" and _LANE_ID.fullmatch(reference) is None:
            raise DebugExperimentError("debug_request_invalid", "debug run reference is invalid")
        run = self.store.load(reference, context["campaign_id"])
        coordinator_died = (
            run.get("status") in {"running", "cancelling"}
            and isinstance(run.get("coordinator_pid"), int)
            and not _coordinator_alive(run)
        )
        stale_failed_lanes = (
            run.get("status") == "failed"
            and any(
                row.get("status") not in {
                    "completed", "failed", "timed_out", "cancelled",
                }
                for row in run.get("lane_statuses", [])
            )
        )
        if coordinator_died or stale_failed_lanes:
            _mark_coordinator_failure(
                run,
                "the debug coordinator exited before sealing the run",
            )
            self.store.save(run)
        if action == "status":
            return _public_run(run)
        if action == "report":
            if run.get("status") not in _TERMINAL:
                raise DebugExperimentError(
                    "debug_run_not_terminal", "debug report requires a terminal run",
                )
            report_path = self.store.root / run["experiment_id"] / "comparison.json"
            if not report_path.is_file():
                raise DebugExperimentError(
                    "debug_report_unavailable", "debug comparison report is unavailable",
                )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            if (
                not isinstance(report, dict)
                or report.get("experiment_id") != run["experiment_id"]
            ):
                raise DebugExperimentError(
                    "debug_report_integrity_mismatch", "debug comparison report drifted",
                )
            lane_summary = ", ".join(
                f"{row.get('id')}={row.get('status')}"
                for row in report.get("lanes", [])
                if isinstance(row, dict)
            )
            return {
                "status": run["status"],
                "experiment_id": run["experiment_id"],
                "message": (
                    f"Debug {run['experiment_id']} {run['status']}: {lane_summary}"
                ),
                "report": report,
            }
        if run["status"] in _TERMINAL:
            return _public_run(run)
        run["status"] = "cancelling"
        self.store.save(run)
        self.executor.cancel(run)
        return _public_run(run)


class SubprocessDebugExecutor:
    """Detach one coordinator so `/system debug run` returns immediately."""

    def __init__(self, *, store: FileRunStore, repo_root: Path | str) -> None:
        self.store = store
        self.repo_root = Path(repo_root).resolve()

    def start(self, run: dict[str, Any]) -> None:
        run_root = self.store.root / run["experiment_id"]
        log_path = run_root / "coordinator.log"
        descriptor = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        log_handle = os.fdopen(descriptor, "a", encoding="utf-8")
        try:
            process = subprocess.Popen(
                [
                    sys.executable,
                    str(Path(__file__).resolve()),
                    "execute",
                    "--store-root", str(self.store.root),
                    "--experiment-id", run["experiment_id"],
                    "--repo-root", str(self.repo_root),
                ],
                cwd=self.repo_root,
                env={
                    **PiRpcLaneAdapter._safe_env(),
                    "PYTHONDONTWRITEBYTECODE": "1",
                },
                stdin=subprocess.DEVNULL,
                stdout=log_handle,
                stderr=log_handle,
                start_new_session=True,
                text=True,
            )
        finally:
            log_handle.close()
        run["coordinator_pid"] = process.pid
        self.store.save(run)

    def cancel(self, run: dict[str, Any]) -> None:
        target = self.store.root / run["experiment_id"] / "CANCEL"
        if target.exists():
            return
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(descriptor)


def _default_store(context: dict[str, Any]) -> FileRunStore:
    workspace = Path(context["workspace_root"]).resolve()
    coc_root = workspace / ".coc"
    debug_root = coc_root / "debug"
    runs_root = debug_root / "runs"
    if coc_root.is_symlink() or debug_root.is_symlink() or runs_root.is_symlink():
        raise DebugExperimentError(
            "evidence_root_unsafe", "debug evidence root must not be a symlink",
        )
    try:
        runs_root.resolve(strict=False).relative_to(coc_root.resolve(strict=False))
    except ValueError as exc:
        raise DebugExperimentError(
            "evidence_root_unsafe", "debug evidence root escapes .coc",
        ) from exc
    return FileRunStore(runs_root)


def _dispatch_cli(command: str, context_json: str, repo_root: Path) -> dict[str, Any]:
    try:
        context = json.loads(context_json)
    except json.JSONDecodeError as exc:
        raise DebugExperimentError(
            "debug_request_invalid", "debug context is invalid JSON",
        ) from exc
    validated = _validate_context(context)
    store = _default_store(validated)
    experiment = DebugExperiment(
        store=store,
        checkpoint=GitCheckpointAdapter(),
        executor=SubprocessDebugExecutor(store=store, repo_root=repo_root),
    )
    return experiment.dispatch(command, validated)


def _execute_cli(store_root: Path, experiment_id: str, repo_root: Path) -> None:
    store = FileRunStore(store_root)
    run = store.load_exact(experiment_id)
    coordinator = DebugRunCoordinator(
        store=store,
        checkpoint=GitCheckpointAdapter(),
        lane=PiRpcLaneAdapter(
            repo_root=repo_root,
            private_root=store.root / experiment_id / "private",
        ),
    )
    coordinator.start(run)


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Pi-Coc debug experiment host")
    subparsers = parser.add_subparsers(dest="action", required=True)
    dispatch = subparsers.add_parser("dispatch")
    dispatch.add_argument("--command", required=True)
    dispatch.add_argument("--context-json", required=True)
    dispatch.add_argument("--repo-root", default=str(_PLUGIN_ROOT.parents[1]))
    execute = subparsers.add_parser("execute")
    execute.add_argument("--store-root", required=True)
    execute.add_argument("--experiment-id", required=True)
    execute.add_argument("--repo-root", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _argument_parser().parse_args(argv)
    try:
        if args.action == "dispatch":
            receipt = _dispatch_cli(
                args.command,
                args.context_json,
                Path(args.repo_root).resolve(),
            )
            print(json.dumps({"ok": True, "receipt": receipt}, ensure_ascii=False))
            return 0
        _execute_cli(
            Path(args.store_root).resolve(),
            args.experiment_id,
            Path(args.repo_root).resolve(),
        )
        return 0
    except DebugExperimentError as exc:
        print(json.dumps({
            "ok": False,
            "error": {"code": exc.code, "message": str(exc)},
        }, ensure_ascii=False))
        return 2
    except Exception as exc:
        if args.action == "execute":
            try:
                store = FileRunStore(Path(args.store_root).resolve())
                run = store.load_exact(args.experiment_id)
                _mark_coordinator_failure(run, str(exc))
                store.save(run)
            except Exception:
                pass
            traceback.print_exc(file=sys.stderr)
        print(json.dumps({
            "ok": False,
            "error": {
                "code": "debug_host_failed",
                "message": "debug host failed; inspect private coordinator evidence",
            },
        }, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
