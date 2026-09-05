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
import random
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

import coc_chase  # noqa: E402
import coc_subsystem_executor  # noqa: E402
import coc_combat  # noqa: E402
import coc_git_history  # noqa: E402
import coc_npc_identity  # noqa: E402
import coc_rules  # noqa: E402
import coc_sanity  # noqa: E402
import coc_time  # noqa: E402


_LANE_ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
_CAMPAIGN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
# Scene / NPC / clue / flag ids are authored semantic tokens; the same safe
# id grammar the kernel accepts for campaign-scoped identifiers.
_SITUATION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_SITUATION_STRUCTURAL_KEYS = frozenset({
    "scene_id", "npc_presence", "clue_ids", "flags",
    # Reach state a scene and a roster cannot: a learned spell, a granted
    # item, a wounded investigator, a persisted ending. Without these, eleven
    # of the graph's forty-three decisions could not be driven at all.
    "items", "spells", "damage", "ending",
    # Time is a third kind of unreachable state. `state.advance_time` fires
    # due triggers, which is the only way to reach psychoanalysis treatment,
    # temporary-insanity recovery and weekly major-wound recovery; a safe rest
    # is what several of those triggers additionally require.
    "advance_minutes", "safe_rest",
    # Authored data a diagnostic lane may appoint, rather than canonical state
    # it may write. Which NPC teaches which spell is module content, and the
    # shipped modules author none, so magic could not be exercised at all
    # without inventing that content in the repo. A lane appoints a teacher for
    # itself instead: the override lives in the lane's own sandbox, is recorded
    # as a host seed in the evidence, and reaches no committed module.
    "spell_teachers",
    # Opposed-check `_npc_check` reads `skills` off npc-agendas. Shipped
    # modules author none, so a lane writes them into its sandbox copy.
    "npc_skills",
    # Chase pending kind is copied from story-graph `barrier`/`hazard`.
    # The Haunting authors none; a lane writes them into its sandbox copy.
    "chase_features",
    # Underlying insanity (no bout) so a delusion can be planted, plus a
    # pending SAN-gain receipt another producer reads.
    "insanity",
    "delusion",
    "san_gain",
    # An active fight or chase cannot be reached from scene/NPC presence:
    # combat:flee/reload bind the investigator's turn inside CombatSession,
    # and chase:end/conflict/barrier/hazard bind a live chase.json. Both are
    # host seeds through those session APIs, not hand-written snapshots.
    "combat",
    "chase",
})
_SITUATION_KEYS = _SITUATION_STRUCTURAL_KEYS | {"establish_from_prompt"}
_SITUATION_TEACHER_KEYS = frozenset({"npc_id", "source_kind", "spells"})
_SITUATION_TEACHER_KINDS = frozenset({"person", "entity"})
_SITUATION_NPC_SKILL_KEYS = frozenset({"npc_id", "skills"})
_SITUATION_CHASE_FEATURE_KEYS = frozenset({"scene_id", "barrier", "hazard"})
_SITUATION_INSANITY_KINDS = frozenset({"temporary", "indefinite"})
_SITUATION_COMBAT_KEYS = frozenset({
    "npc_id", "investigator_acts_now", "spent_weapon_id",
})
_SITUATION_CHASE_KEYS = frozenset({
    "npc_id", "investigator_role", "pending",
})
_SITUATION_CHASE_ROLES = frozenset({"quarry", "pursuer"})
_SITUATION_CHASE_PENDING = frozenset({
    "move", "barrier", "hazard", "conflict", "end",
})
_CHASE_HAZARD_KEYS = frozenset({
    "hazard_id", "skill", "target", "difficulty", "damage_dice",
    "collision_severity", "from_wreck", "from_debris", "sudden",
})
_CHASE_BARRIER_KEYS = frozenset({
    "barrier_id", "hp", "hp_max", "skill", "target", "difficulty",
    "damage_dice", "description",
})
_CHASE_DIFFICULTIES = frozenset({"regular", "hard", "extreme"})
_SITUATION_ITEM_KEYS = frozenset({
    "item_id", "label", "kind", "weapon", "weapon_id", "mechanics_ref",
    "quantity", "consumable", "investigator",
})
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
_SITUATION_COMBAT_TURN_NOTE = (
    " Combat is already active on the investigator's turn. Flight from that "
    "fight is decision:coc7:combat:flee; do not chase.start."
)
_SITUATION_CHASE_TURN_NOTE = (
    " A chase is already active. Settle the pending chase card the chase "
    "family offers; do not chase.start."
)
_SITUATION_MAGIC_TURN_NOTE = (
    " A teacher or learned spell is already in this situation. Learning is "
    "decision:coc7:magic:learn-spell; casting is decision:coc7:magic:cast-spell. "
    "Call rules.context for family magic."
)
_SITUATION_SANITY_DUE_TURN_NOTE = (
    " A due Sanity time trigger is waiting. Temporary recovery is "
    "decision:coc7:sanity:recover-temporary; psychoanalysis is "
    "decision:coc7:sanity:apply-treatment. Call rules.context for family sanity."
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
_MAX_LANES = 40
_MAX_CONCURRENCY = 40


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


def _appoint_spell_teachers(
    campaign_dir: Path, teachers: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Write the lane's appointed teachers into its own scenario data.

    Not a toolbox operation, deliberately: which NPC teaches which spell is
    authored module content, not canonical state, and there is no operation
    that writes it -- inventing one would put a diagnostic-only capability on
    the Keeper's surface. The write lands in the lane's sandbox copy of
    `scenario/npc-agendas.json`, the file `Ctx.npc_agendas` reads, so nothing
    reaches a committed module.

    Returns one evidence row per appointment.
    """
    path = campaign_dir / "scenario" / "npc-agendas.json"
    agendas = json.loads(path.read_text(encoding="utf-8"))
    rows = agendas.get("npcs")
    if not isinstance(rows, list):
        raise DebugExperimentError(
            "situation_catalog_unavailable",
            "the lane campaign's npc-agendas has no npcs list",
        )
    by_id = {
        str(row.get("npc_id")): row for row in rows if isinstance(row, dict)
    }
    applied: list[dict[str, Any]] = []
    for teacher in teachers:
        npc = by_id.get(teacher["npc_id"])
        if npc is None:
            raise DebugExperimentError(
                "situation_unknown_npc",
                f"NPC {teacher['npc_id']!r} is not authored in the sealed campaign",
            )
        npc["magic_source_kind"] = teacher["source_kind"]
        mechanics = npc.setdefault("mechanics", {})
        profile = mechanics.setdefault("profile", {})
        taught = list(dict.fromkeys(
            [*(profile.get("spells") or []), *teacher["spells"]]
        ))
        profile["spells"] = taught
        applied.append({
            "operation": "host.appoint_spell_teacher",
            "npc_id": teacher["npc_id"],
            "source_kind": teacher["source_kind"],
            "spells": taught,
            "authority": "host_diagnostic_seed",
            "note": (
                "lane-private authored-data override; not module content"
            ),
            "ok": True,
        })
    path.write_text(
        json.dumps(agendas, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return applied


def _sandbox_npc_agendas(campaign_dir: Path) -> tuple[Path, dict[str, Any], dict[str, dict[str, Any]]]:
    path = campaign_dir / "scenario" / "npc-agendas.json"
    try:
        agendas = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise DebugExperimentError(
            "situation_catalog_unavailable",
            "the lane campaign's npc-agendas is unreadable",
        ) from exc
    rows = agendas.get("npcs") if isinstance(agendas, dict) else None
    if not isinstance(rows, list):
        raise DebugExperimentError(
            "situation_catalog_unavailable",
            "the lane campaign's npc-agendas has no npcs list",
        )
    by_id = {
        str(row.get("npc_id")): row for row in rows if isinstance(row, dict)
    }
    return path, agendas, by_id


def _seed_npc_skills(
    campaign_dir: Path, rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Write opposed-check skills into the lane's sandbox npc-agendas."""
    path, agendas, by_id = _sandbox_npc_agendas(campaign_dir)
    applied: list[dict[str, Any]] = []
    for row in rows:
        npc = by_id.get(row["npc_id"])
        if npc is None:
            raise DebugExperimentError(
                "situation_unknown_npc",
                f"NPC {row['npc_id']!r} is not authored in the sealed campaign",
            )
        skills = npc.get("skills")
        if not isinstance(skills, dict):
            skills = {}
        skills.update(row["skills"])
        npc["skills"] = skills
        applied.append({
            "operation": "host.seed_npc_skills",
            "npc_id": row["npc_id"],
            "skills": dict(skills),
            "authority": "host_diagnostic_seed",
            "note": "lane-private authored-data override; not module content",
            "ok": True,
        })
    path.write_text(
        json.dumps(agendas, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return applied


def _sandbox_story_graph(campaign_dir: Path) -> tuple[Path, dict[str, Any], dict[str, dict[str, Any]]]:
    path = campaign_dir / "scenario" / "story-graph.json"
    try:
        graph = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise DebugExperimentError(
            "situation_catalog_unavailable",
            "the lane campaign's story-graph is unreadable",
        ) from exc
    scenes = graph.get("scenes") if isinstance(graph, dict) else None
    if not isinstance(scenes, list):
        raise DebugExperimentError(
            "situation_catalog_unavailable",
            "the lane campaign's story-graph has no scenes list",
        )
    by_id = {
        str(scene.get("scene_id")): scene
        for scene in scenes
        if isinstance(scene, dict) and scene.get("scene_id")
    }
    return path, graph, by_id


def _seed_chase_features(
    campaign_dir: Path, features: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Write barrier/hazard onto sandbox story-graph scenes."""
    path, graph, by_id = _sandbox_story_graph(campaign_dir)
    applied: list[dict[str, Any]] = []
    for feature in features:
        scene = by_id.get(feature["scene_id"])
        if scene is None:
            raise DebugExperimentError(
                "situation_unknown_scene",
                f"scene {feature['scene_id']!r} is not in the sealed story graph",
            )
        written: dict[str, Any] = {"scene_id": feature["scene_id"]}
        if "barrier" in feature:
            scene["barrier"] = feature["barrier"]
            written["barrier"] = feature["barrier"]
        if "hazard" in feature:
            scene["hazard"] = feature["hazard"]
            written["hazard"] = feature["hazard"]
        applied.append({
            "operation": "host.seed_chase_features",
            **written,
            "authority": "host_diagnostic_seed",
            "note": "lane-private authored-data override; not module content",
            "ok": True,
        })
    path.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return applied


def _campaign_default_investigator(campaign_dir: Path) -> str:
    """The campaign's default investigator, for host sanity seeds."""
    party_path = campaign_dir / "party.json"
    ids: list[str] = []
    if party_path.is_file():
        try:
            party = json.loads(party_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            party = None
        if isinstance(party, dict):
            raw = party.get("investigator_ids") or party.get("active_investigator_ids") or []
            if isinstance(raw, list):
                ids = [str(item) for item in raw if isinstance(item, str) and item]
    if not ids:
        state_dir = campaign_dir / "save" / "investigator-state"
        if state_dir.is_dir():
            ids = sorted(
                path.stem for path in state_dir.glob("*.json")
                if path.is_file() and not path.is_symlink()
            )
    if not ids:
        raise DebugExperimentError(
            "situation_catalog_unavailable",
            "the lane campaign names no default investigator",
        )
    return ids[0]


def _seed_insanity(
    campaign_dir: Path, insanity: dict[str, Any],
) -> list[dict[str, Any]]:
    """Mark the default investigator insane with no active bout."""
    investigator_id = _campaign_default_investigator(campaign_dir)
    session = coc_sanity.SanitySession.load(campaign_dir, investigator_id)
    kind = insanity["kind"]
    if kind == "temporary":
        session.temporary_insane = True
        if session.temporary_insane_remaining_hours < 1:
            session.temporary_insane_remaining_hours = 1
    else:
        session.indefinite_insane = True
    session.bout_active = False
    session.bout_rounds_remaining = 0
    session.active_bout_id = None
    session.save(campaign_dir)
    if kind == "indefinite":
        # Auto-apply and graph settle both read psychoanalysis_skill from
        # investigator-state. Untrained 0 is not a legal percentile target
        # (r79 s-treat5: "target must be between 1 and 100").
        state_path = (
            campaign_dir / "save" / "investigator-state"
            / f"{investigator_id}.json"
        )
        try:
            inv_state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            inv_state = {}
        if isinstance(inv_state, dict):
            inv_state["psychoanalysis_skill"] = max(
                1, int(inv_state.get("psychoanalysis_skill") or 10),
            )
            state_path.parent.mkdir(parents=True, exist_ok=True)
            state_path.write_text(
                json.dumps(inv_state, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
    # Flag-only insanity never scheduled the due trigger apply-treatment
    # and recover-temporary bind. Advance_time then had nothing to fire,
    # so those cards stayed withheld (r76 s-treat4 / s-recov1). Due now,
    # auto_apply_if_safe: still pending until a safe rest, which is what
    # the Keeper settles. Do not also advance_time past this in the same
    # situation or process_due_triggers will consume it.
    (campaign_dir / "logs").mkdir(parents=True, exist_ok=True)
    (campaign_dir / "save").mkdir(parents=True, exist_ok=True)
    if not coc_time.read_time_state(campaign_dir):
        coc_time.initialize_time_state(campaign_dir)
    now = int(
        (coc_time.read_time_state(campaign_dir).get("clock") or {}).get(
            "elapsed_minutes", 0,
        )
    )
    if kind == "temporary":
        handler = "recover_temporary_insanity"
        trigger_kind = "condition_expiry"
        payload = {"condition": "temporary_insane"}
    else:
        handler = "apply_psychoanalysis_treatment"
        trigger_kind = "treatment"
        payload = {"condition": "indefinite_insane"}
    trigger_id = coc_time.schedule_trigger(campaign_dir, {
        "kind": trigger_kind,
        "scope": "investigator",
        "target_id": investigator_id,
        "due_elapsed_minutes": now,
        "policy": "auto_apply_if_safe",
        "handler": handler,
        "payload": payload,
    })
    return [{
        "operation": "host.seed_insanity",
        "investigator_id": investigator_id,
        "kind": kind,
        "trigger_id": trigger_id,
        "handler": handler,
        "authority": "host_diagnostic_seed",
        "note": "lane-private SanitySession seed; not a toolbox write",
        "ok": True,
    }]


def _seed_known_spells(
    campaign_dir: Path, spells: list[str],
) -> list[dict[str, Any]]:
    """Persist learned spells so magic:cast-spell can open.

    Host ``magic.learn`` is a percentile check. A diagnostic seed that only
    started study left the investigator with no known spell, so the cast
    card never appeared (r76 mg-cast4).
    """
    investigator_id = _campaign_default_investigator(campaign_dir)
    path = (
        campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    )
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise DebugExperimentError(
            "situation_catalog_unavailable",
            "the lane investigator-state is unreadable",
        ) from exc
    if not isinstance(state, dict):
        raise DebugExperimentError(
            "situation_catalog_unavailable",
            "the lane investigator-state is not an object",
        )
    magic = state.get("magic") if isinstance(state.get("magic"), dict) else {}
    learned = list(dict.fromkeys(
        [*(magic.get("learned_spells") or []), *spells]
    ))
    state["magic"] = {**magic, "learned_spells": learned}
    path.write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return [{
        "operation": "host.seed_known_spells",
        "investigator_id": investigator_id,
        "spells": learned,
        "authority": "host_diagnostic_seed",
        "ok": True,
    }]


def _seed_delusion(
    campaign_dir: Path, delusion: dict[str, Any],
) -> list[dict[str, Any]]:
    """Plant a delusion after insanity; requires insane and no bout."""
    investigator_id = _campaign_default_investigator(campaign_dir)
    session = coc_sanity.SanitySession.load(campaign_dir, investigator_id)
    try:
        planted = session.plant_delusion(
            delusion["description"],
            backstory_field=delusion.get("backstory_field"),
        )
    except ValueError as exc:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"cannot plant a delusion: {exc}",
        ) from exc
    session.save(campaign_dir)
    return [{
        "operation": "host.seed_delusion",
        "investigator_id": investigator_id,
        "description": planted["description"],
        **({
            "backstory_field": planted["backstory_field"],
        } if planted.get("backstory_field") else {}),
        "authority": "host_diagnostic_seed",
        "note": "lane-private SanitySession seed; not a toolbox write",
        "ok": True,
    }]


def _seed_san_gain(
    campaign_dir: Path, san_gain: dict[str, Any],
) -> list[dict[str, Any]]:
    """Write the pending SAN-gain receipt another producer reads."""
    investigator_id = _campaign_default_investigator(campaign_dir)
    path = (
        campaign_dir / "save" / "sanity-gain-pending" / f"{investigator_id}.json"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": 1,
        "investigator_id": investigator_id,
        "san_gain": san_gain["amount"],
        "gain_source": san_gain["source"],
        "seeded": True,
    }
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return [{
        "operation": "host.seed_san_gain",
        "investigator_id": investigator_id,
        "path": str(path),
        "authority": "host_diagnostic_seed",
        "ok": True,
    }]


def _load_campaign_object(path: Path, *, missing: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise DebugExperimentError(
            "situation_catalog_unavailable", missing,
        ) from exc
    if not isinstance(value, dict):
        raise DebugExperimentError(
            "situation_catalog_unavailable", missing,
        )
    return value


def _active_scene_id(campaign_dir: Path) -> str:
    data = _load_campaign_object(
        campaign_dir / "save" / "active-scene.json",
        missing="the lane campaign has no active scene",
    )
    scene_id = data.get("scene_id")
    if not isinstance(scene_id, str) or not scene_id.strip():
        raise DebugExperimentError(
            "situation_catalog_unavailable",
            "the lane campaign's active scene has no scene_id",
        )
    return scene_id


def _investigator_sheet(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    return _load_campaign_object(
        campaign_dir / "investigators" / investigator_id / "character.json",
        missing=f"investigator {investigator_id!r} has no character sheet",
    )


def _investigator_state(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
    if not path.is_file():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _npc_authored_profile(campaign_dir: Path, npc_id: str) -> dict[str, Any]:
    _path, _agendas, by_id = _sandbox_npc_agendas(campaign_dir)
    npc = by_id.get(npc_id)
    if npc is None:
        raise DebugExperimentError(
            "situation_unknown_npc",
            f"NPC {npc_id!r} is not authored in the sealed campaign",
        )
    mechanics = npc.get("mechanics")
    profile = mechanics.get("profile") if isinstance(mechanics, dict) else None
    if not isinstance(mechanics, dict) or mechanics.get("status") != "authored":
        raise DebugExperimentError(
            "situation_npc_mechanics_unavailable",
            f"NPC {npc_id!r} has no authored combat/chase mechanics profile",
        )
    if not isinstance(profile, dict):
        raise DebugExperimentError(
            "situation_npc_mechanics_unavailable",
            f"NPC {npc_id!r} authored mechanics carry no profile",
        )
    return profile


def _weapon_rows(value: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if isinstance(value, list):
        for item in value:
            if isinstance(item, str) and item.strip():
                rows.append({"weapon_id": item.strip()})
            elif isinstance(item, dict) and item.get("weapon_id"):
                rows.append({"weapon_id": str(item["weapon_id"])})
    return rows or [{"weapon_id": "unarmed"}]


def _npc_stat_block(profile: dict[str, Any], npc_id: str) -> dict[str, Any]:
    characteristics = profile.get("characteristics") if isinstance(
        profile.get("characteristics"), dict,
    ) else {}
    skills = profile.get("skills") if isinstance(profile.get("skills"), dict) else {}
    derived = profile.get("derived") if isinstance(profile.get("derived"), dict) else {}
    damage = coc_rules.damage_bonus_build(
        int(characteristics.get("STR", 50)),
        int(characteristics.get("SIZ", 50)),
    )
    return {
        "actor_id": npc_id,
        "side": "npc",
        "dex": int(characteristics.get("DEX", 50)),
        "combat_skill": int(
            skills.get("Fighting (Brawl)", skills.get("Fighting", 25)),
        ),
        "dodge_skill": int(
            skills.get("Dodge", max(1, int(characteristics.get("DEX", 50)) // 2)),
        ),
        "firearms_skill": 0,
        "has_ready_firearm": False,
        "build": int(derived.get("Build", damage["build"])),
        "damage_bonus": str(derived.get("DB", damage["damage_bonus"])),
        "hp_max": int(derived.get("HP", 10)),
        "hp_current": int(derived.get("HP", 10)),
        "con": int(characteristics.get("CON", 50)),
        "magic_points": int(derived.get("MP", 0)),
        "armor": 0,
        "armor_rule": None,
        "weapons": _weapon_rows(profile.get("weapons")),
        "conditions": [],
        "mov": int(derived.get("MOV", 8)),
    }


def _investigator_combat_spec(
    sheet: dict[str, Any], state: dict[str, Any], investigator_id: str,
) -> dict[str, Any]:
    characteristics = sheet.get("characteristics") if isinstance(
        sheet.get("characteristics"), dict,
    ) else {}
    skills = sheet.get("skills") if isinstance(sheet.get("skills"), dict) else {}
    derived = sheet.get("derived") if isinstance(sheet.get("derived"), dict) else {}
    damage = coc_rules.damage_bonus_build(
        int(characteristics.get("STR", 50)),
        int(characteristics.get("SIZ", 50)),
    )
    rows = _weapon_rows(sheet.get("weapons"))
    return {
        "actor_id": investigator_id,
        "side": "investigator",
        "dex": int(characteristics.get("DEX", 50)),
        "combat_skill": int(skills.get("Fighting (Brawl)", 25)),
        "dodge_skill": int(
            skills.get("Dodge", max(1, int(characteristics.get("DEX", 50)) // 2)),
        ),
        "firearms_skill": int(skills.get("Firearms (Handgun)", 0) or 0),
        "build": int(damage["build"]),
        "damage_bonus": str(damage["damage_bonus"]),
        "hp_max": int(state.get("hp_max", derived.get("HP", 10))),
        "hp_current": int(state.get("current_hp", derived.get("HP", 10))),
        "con": int(characteristics.get("CON", 50)),
        "magic_points": int(state.get("current_mp", derived.get("MP", 0))),
        "weapons": rows,
        "conditions": list(state.get("conditions") or []),
        "mov": int(derived.get("MOV", 8)),
    }


def _add_combat_participant(session: Any, spec: dict[str, Any]) -> None:
    session.add_participant(
        spec["actor_id"], spec["side"], spec["dex"], spec["combat_skill"],
        spec["build"], spec["hp_max"],
        weapons=spec.get("weapons") or [{"weapon_id": "unarmed"}],
        conditions=list(spec.get("conditions") or []),
        dodge_skill=spec.get("dodge_skill"),
        firearms_skill=spec.get("firearms_skill", 0),
        has_ready_firearm=bool(spec.get("has_ready_firearm", False)),
        damage_bonus=spec.get("damage_bonus", "none"),
        con=spec.get("con", 50),
        magic_points=spec.get("magic_points", 0),
        armor=spec.get("armor", 0),
        armor_rule=spec.get("armor_rule"),
        mechanics_revision_ref=spec.get("mechanics_revision_ref"),
    )
    session.participants[spec["actor_id"]]["hp_current"] = spec["hp_current"]


def _seed_combat(
    campaign_dir: Path, combat: dict[str, Any],
) -> list[dict[str, Any]]:
    """Plant an active CombatSession on the investigator's turn."""
    investigator_id = _campaign_default_investigator(campaign_dir)
    npc_id = combat["npc_id"]
    sheet = _investigator_sheet(campaign_dir, investigator_id)
    state = _investigator_state(campaign_dir, investigator_id)
    inv = _investigator_combat_spec(sheet, state, investigator_id)
    profile = _npc_authored_profile(campaign_dir, npc_id)
    npc = _npc_stat_block(profile, npc_id)
    spent = combat.get("spent_weapon_id")
    if spent:
        if not any(
            isinstance(row, dict) and row.get("weapon_id") == spent
            for row in inv["weapons"]
        ):
            inv["weapons"] = list(inv["weapons"]) + [{"weapon_id": spent}]
        inv["has_ready_firearm"] = True
        inv["firearms_skill"] = max(int(inv.get("firearms_skill") or 0), 1)
    scene_id = _active_scene_id(campaign_dir)
    session = coc_combat.CombatSession(
        "debug-seed-combat", scene_id, 0, rng=random.Random(0),
    )
    _add_combat_participant(session, inv)
    _add_combat_participant(session, npc)
    session.begin_round()
    if combat.get("investigator_acts_now", True):
        order = [
            row["actor_id"] for row in session._current_initiative
        ]
        if investigator_id not in order:
            raise DebugExperimentError(
                "debug_request_invalid",
                "the investigator is not in the seeded combat initiative",
            )
        session.initiative_cursor = order.index(investigator_id)
    if spent:
        try:
            session.set_ammo(investigator_id, spent, 0)
        except Exception as exc:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"cannot empty ammo for {spent!r}: {exc}",
            ) from exc
    session.pending_attack = None
    session.revision = 1
    session.save(campaign_dir)
    return [{
        "operation": "host.seed_combat",
        "investigator_id": investigator_id,
        "npc_id": npc_id,
        "scene_id": scene_id,
        "acts_now": (
            session._current_initiative[session.initiative_cursor]["actor_id"]
            if session._current_initiative else None
        ),
        "spent_weapon_id": spent,
        "authority": "host_diagnostic_seed",
        "ok": True,
    }]


def _chase_location_chain(
    campaign_dir: Path, scene_id: str,
) -> list[dict[str, Any]]:
    _path, _graph, by_id = _sandbox_story_graph(campaign_dir)
    scene = by_id.get(scene_id)
    if scene is None:
        raise DebugExperimentError(
            "situation_unknown_scene",
            f"scene {scene_id!r} is not in the sealed story graph",
        )
    connected = [scene_id]
    for edge in scene.get("scene_edges") or []:
        if not isinstance(edge, dict):
            continue
        target = edge.get("target_scene_id") or edge.get("to")
        if isinstance(target, str) and target and target not in connected:
            connected.append(target)
    locations: list[dict[str, Any]] = []
    for candidate_id in connected:
        candidate = by_id.get(candidate_id)
        if not isinstance(candidate, dict):
            continue
        locations.append({
            "label": candidate_id,
            "hazard": (
                candidate.get("hazard")
                if isinstance(candidate.get("hazard"), dict) else None
            ),
            "barrier": (
                candidate.get("barrier")
                if isinstance(candidate.get("barrier"), dict) else None
            ),
        })
    if len(locations) < 2:
        raise DebugExperimentError(
            "debug_request_invalid",
            "chase seeding needs two connected scenes on the active location",
        )
    return locations


def _place_chase_pending(
    locations: list[dict[str, Any]], pending: str,
) -> dict[str, int | bool]:
    """Positions that make kernel chase.pending.kind equal `pending`."""
    def feature_at(index: int, key: str) -> bool:
        row = locations[index] if 0 <= index < len(locations) else None
        return isinstance(row, dict) and isinstance(row.get(key), dict)

    if pending == "end":
        return {"quarry": 0, "pursuer": 0, "escaped": True}
    if pending == "conflict":
        for index in range(len(locations)):
            if not feature_at(index + 1, "barrier") and not feature_at(
                index + 1, "hazard",
            ):
                return {"quarry": index, "pursuer": index, "escaped": False}
        raise DebugExperimentError(
            "debug_request_invalid",
            "chase pending=conflict needs a location whose next step is clear",
        )
    wanted = "barrier" if pending == "barrier" else "hazard" if pending == "hazard" else None
    if wanted:
        for index, row in enumerate(locations):
            if index == 0:
                continue
            if isinstance(row.get(wanted), dict):
                return {
                    "quarry": index - 1, "pursuer": 0, "escaped": False,
                }
        raise DebugExperimentError(
            "debug_request_invalid",
            f"chase pending={pending} needs that feature on a later location",
        )
    for index in range(len(locations) - 1):
        if not feature_at(index + 1, "barrier") and not feature_at(
            index + 1, "hazard",
        ):
            pursuer = 0 if index > 0 else 0
            quarry = index
            if quarry == pursuer and index + 1 < len(locations) - 1:
                quarry = index + 1
                if feature_at(quarry + 1, "barrier") or feature_at(
                    quarry + 1, "hazard",
                ):
                    continue
            if quarry == pursuer:
                continue
            return {"quarry": quarry, "pursuer": pursuer, "escaped": False}
    raise DebugExperimentError(
        "debug_request_invalid",
        "chase pending=move needs two positions whose next step is clear",
    )


def _seed_chase(
    campaign_dir: Path, chase: dict[str, Any],
) -> list[dict[str, Any]]:
    """Plant an active ChaseSession whose pending kind the kernel will see."""
    investigator_id = _campaign_default_investigator(campaign_dir)
    npc_id = chase["npc_id"]
    role = chase.get("investigator_role", "quarry")
    pending = chase.get("pending", "move")
    sheet = _investigator_sheet(campaign_dir, investigator_id)
    state = _investigator_state(campaign_dir, investigator_id)
    inv = _investigator_combat_spec(sheet, state, investigator_id)
    profile = _npc_authored_profile(campaign_dir, npc_id)
    npc = _npc_stat_block(profile, npc_id)
    scene_id = _active_scene_id(campaign_dir)
    locations = _chase_location_chain(campaign_dir, scene_id)
    placement = _place_chase_pending(locations, pending)
    inv_side = role
    npc_side = "pursuer" if role == "quarry" else "quarry"
    inv_hp = int(state.get("current_hp", inv["hp_current"]))
    inv_conditions = list(state.get("conditions") or [])
    inv_row = {
        "actor_id": investigator_id,
        "side": inv_side,
        "mov": int(inv.get("mov") or 8),
        "dex": int(inv["dex"]),
        "con": int(inv["con"]),
        "hp": inv_hp,
        "fight": int(inv["combat_skill"]),
        "dodge": int(inv["dodge_skill"]),
        "build": int(inv.get("build") or 0),
        "current_position": int(
            placement["quarry"] if inv_side == "quarry" else placement["pursuer"]
        ),
        "conditions": inv_conditions,
    }
    npc_row = {
        "actor_id": npc_id,
        "side": npc_side,
        "mov": int(npc.get("mov") or 8),
        "dex": int(npc["dex"]),
        "con": int(npc["con"]),
        "hp": int(npc["hp_current"]),
        "fight": int(npc["combat_skill"]),
        "dodge": int(npc["dodge_skill"]),
        "build": int(npc.get("build") or 0),
        "current_position": int(
            placement["quarry"] if npc_side == "quarry" else placement["pursuer"]
        ),
        "conditions": [],
    }
    chain = []
    for row in locations:
        chain.append({
            "label": row["label"],
            "hazard": row.get("hazard"),
            "barrier": row.get("barrier"),
        })
    (campaign_dir / "logs").mkdir(parents=True, exist_ok=True)
    command = {
        "command_id": "debug-seed-chase-start",
        "kind": "chase_start",
        "phase": "start",
        "payload": {
            "decision_id": "debug-seed-chase-start",
            "chase_id": "debug-seed-chase",
            "participants": [inv_row, npc_row],
            "locations": chain,
        },
    }
    sheet_path = (
        campaign_dir / "investigators" / investigator_id / "character.json"
    )
    try:
        coc_subsystem_executor.execute_commands(
            campaign_dir, sheet_path, investigator_id, [command],
            rng=random.Random(0),
            character_snapshot=sheet,
        )
    except coc_subsystem_executor.SubsystemExecutorError as exc:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"canonical chase start refused: {exc}",
        ) from exc
    ledger = campaign_dir / "logs" / "chase-genesis.jsonl"
    try:
        evidence = json.loads(ledger.read_text(encoding="utf-8").splitlines()[-1])
    except (OSError, UnicodeError, json.JSONDecodeError, IndexError) as exc:
        raise DebugExperimentError(
            "debug_request_invalid",
            "canonical chase start wrote no genesis evidence",
        ) from exc
    session = coc_chase.ChaseSession.load(
        campaign_dir / "save" / "chase.json",
        rng=random.Random(0),
        genesis_evidence=evidence,
    )
    if placement.get("escaped"):
        quarry_id = investigator_id if inv_side == "quarry" else npc_id
        session.participants[quarry_id]["escaped"] = True
    order = session.rounds[-1]["dex_order"] if session.rounds else []
    if investigator_id in order:
        session.initiative_cursor = order.index(investigator_id)
    session.save(campaign_dir)
    applied = [{
        "operation": "host.seed_chase",
        "investigator_id": investigator_id,
        "npc_id": npc_id,
        "pending": pending,
        "investigator_role": role,
        "authority": "host_diagnostic_seed",
        "ok": True,
    }]
    if pending == "conflict":
        applied.extend(_seed_chase_conflict_combat(
            campaign_dir, sheet_path, investigator_id, sheet, inv, npc,
        ))
    return applied


def _combat_payload_participant(spec: dict[str, Any]) -> dict[str, Any]:
    return {
        "actor_id": spec["actor_id"],
        "side": spec["side"],
        "dex": int(spec["dex"]),
        "combat_skill": int(spec["combat_skill"]),
        "dodge_skill": int(spec["dodge_skill"]),
        "build": int(spec.get("build") or 0),
        "hp_max": int(spec["hp_max"]),
        "hp_current": int(spec["hp_current"]),
        "con": int(spec["con"]),
        "weapons": list(spec.get("weapons") or [{"weapon_id": "unarmed"}]),
        "conditions": list(spec.get("conditions") or []),
        "magic_points": int(spec.get("magic_points") or 0),
    }


def _seed_chase_conflict_combat(
    campaign_dir: Path,
    sheet_path: Path,
    investigator_id: str,
    sheet: dict[str, Any],
    inv: dict[str, Any],
    npc: dict[str, Any],
) -> list[dict[str, Any]]:
    """Leave one unused combat_defend receipt for chase:conflict.

    The executor will not settle chase_conflict without it. Seeding combat
    and chase as two situation keys is forbidden; this is the chase seed's
    own continuation, the same shape as the subsystem ledger test.
    """
    scene_id = _active_scene_id(campaign_dir)
    start = {
        "command_id": "debug-seed-conflict-combat-start",
        "kind": "combat_start",
        "phase": "start",
        "payload": {
            "decision_id": "debug-seed-conflict-combat",
            "combat_id": "debug-seed-conflict-combat",
            "scene_ref": scene_id,
            "turn_number": 1,
            "participants": [
                _combat_payload_participant(inv),
                _combat_payload_participant(npc),
            ],
        },
    }
    attack = {
        "command_id": "debug-seed-conflict-attack",
        "kind": "combat_attack",
        "phase": "declare",
        "payload": {
            "decision_id": "debug-seed-conflict-combat",
            "revision": 1,
            "actor_id": investigator_id,
            "target_actor_id": npc["actor_id"],
            "declared_intent": "chase conflict grab",
            "resolution_hint": "opposed_melee",
            "weapon_id": "unarmed",
        },
    }
    defend = {
        "command_id": "debug-seed-conflict-defend",
        "kind": "combat_defend",
        "phase": "resolve",
        "payload": {
            "decision_id": "debug-seed-conflict-combat",
            "revision": 2,
            "actor_id": npc["actor_id"],
            "attack_command_id": "debug-seed-conflict-attack",
            "defense_kind": "dodge",
        },
    }
    for command in (start, attack, defend):
        try:
            coc_subsystem_executor.execute_commands(
                campaign_dir, sheet_path, investigator_id, [command],
                rng=random.Random(0),
                character_snapshot=sheet,
            )
        except coc_subsystem_executor.SubsystemExecutorError as exc:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"canonical {command['kind']} for chase conflict refused: {exc}",
            ) from exc
    return [{
        "operation": "host.seed_chase_conflict_combat",
        "investigator_id": investigator_id,
        "npc_id": npc["actor_id"],
        "combat_command_id": "debug-seed-conflict-defend",
        "authority": "host_diagnostic_seed",
        "ok": True,
    }]


def _situation_spell_teachers(value: Any, *, label: str) -> list[dict[str, Any]]:
    """NPCs this lane appoints as spell sources, with what they teach.

    `magic.learn.sources` is keyed `<source_kind>:<npc_id>`, and the learn gate
    asks whether the named spell is in that source's list. Both halves are
    authored content: no shipped module marks any NPC teachable, so the gate
    can never open in a diagnostic. This is the seed for it.
    """
    if not isinstance(value, list) or not 1 <= len(value) <= _MAX_SITUATION_LIST:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label} must be a list of 1 to {_MAX_SITUATION_LIST} teachers",
        )
    teachers: list[dict[str, Any]] = []
    for index, raw in enumerate(value):
        row = _strict_object(raw, label=f"{label}[{index}]")
        _exact_keys(row, set(_SITUATION_TEACHER_KEYS), label=f"{label}[{index}]")
        npc_id = _situation_id(row.get("npc_id"), label=f"{label}[{index}].npc_id")
        kind = row.get("source_kind", "person")
        if kind not in _SITUATION_TEACHER_KINDS:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}[{index}].source_kind must be one of "
                f"{', '.join(sorted(_SITUATION_TEACHER_KINDS))}",
            )
        spells = _situation_text_list(
            row.get("spells"), label=f"{label}[{index}].spells",
        )
        teachers.append(
            {"npc_id": npc_id, "source_kind": kind, "spells": spells},
        )
    seen = [row["npc_id"] for row in teachers]
    if len(set(seen)) != len(seen):
        raise DebugExperimentError(
            "debug_request_invalid", f"{label} names one NPC twice",
        )
    return teachers


def _situation_text_list(value: Any, *, label: str) -> list[str]:
    """A list of authored names, not semantic ids.

    Spells are named the way the rulebook names them -- "Contact Deity" --
    so the id grammar is the wrong validator here.
    """
    if not isinstance(value, list) or not 1 <= len(value) <= _MAX_SITUATION_LIST:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label} must be a list of 1 to {_MAX_SITUATION_LIST} names",
        )
    names = [
        _nonempty_text(item, label=f"{label}[{index}]")
        for index, item in enumerate(value)
    ]
    if len(set(names)) != len(names):
        raise DebugExperimentError(
            "debug_request_invalid", f"{label} contains duplicate names",
        )
    return names


def _situation_positive_int(value: Any, *, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise DebugExperimentError(
            "debug_request_invalid", f"{label} must be a positive integer",
        )
    return value


def _situation_items(value: Any, *, label: str) -> list[dict[str, Any]]:
    """Item grants, each named well enough for the toolbox to grant it."""
    if not isinstance(value, list) or not 1 <= len(value) <= _MAX_SITUATION_LIST:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label} must be a list of 1 to {_MAX_SITUATION_LIST} items",
        )
    items: list[dict[str, Any]] = []
    for index, raw in enumerate(value):
        item = _strict_object(raw, label=f"{label}[{index}]")
        _exact_keys(item, set(_SITUATION_ITEM_KEYS), label=f"{label}[{index}]")
        if not (item.get("item_id") or item.get("label")):
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}[{index}] needs item_id or label",
            )
        item = {**item, "kind": item.get("kind", "gear")}
        items.append(item)
    return items


def _situation_damage(value: Any, *, label: str) -> dict[str, Any]:
    """Damage as a bare amount or an {amount, kind} object.

    The common seed is "hurt the investigator by N"; requiring an object for
    that would be ceremony, so a bare amount is accepted and the kind defaults
    here rather than in the caller that builds the operation.

    `kind` is the direction the toolbox means -- damage or heal -- not a damage
    type. Seeding sent "physical", which `rules.damage` rejects with
    `invalid_param`, so every wounded lane failed to seed and the healing
    family looked unreachable for a reason that was never in the rule layer.
    """
    if isinstance(value, int) and not isinstance(value, bool):
        return {
            "amount": _situation_positive_int(value, label=label),
            "kind": "damage",
        }
    damage = _strict_object(value, label=label)
    _exact_keys(damage, {"amount", "kind"}, label=label)
    return {
        "amount": _situation_positive_int(
            damage.get("amount"), label=f"{label}.amount",
        ),
        "kind": damage.get("kind", "damage"),
    }


def _situation_ending(value: Any, *, label: str) -> dict[str, Any]:
    """A persisted ending, as a summary string or a {summary, kind} object."""
    if isinstance(value, str):
        return {"summary": _nonempty_text(value, label=label)}
    ending = _strict_object(value, label=label)
    _exact_keys(ending, {"summary", "kind"}, label=label)
    normalized = {
        "summary": _nonempty_text(
            ending.get("summary"), label=f"{label}.summary",
        ),
    }
    if "kind" in ending:
        normalized["kind"] = _nonempty_text(
            ending["kind"], label=f"{label}.kind",
        )
    return normalized


def _situation_closed_int(
    value: Any, *, label: str, lo: int, hi: int,
) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not lo <= value <= hi:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label} must be an integer from {lo} through {hi}",
        )
    return value


def _situation_npc_skills(value: Any, *, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not 1 <= len(value) <= _MAX_SITUATION_LIST:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label} must be a list of 1 to {_MAX_SITUATION_LIST} NPC skill maps",
        )
    rows: list[dict[str, Any]] = []
    for index, raw in enumerate(value):
        row = _strict_object(raw, label=f"{label}[{index}]")
        _exact_keys(row, set(_SITUATION_NPC_SKILL_KEYS), label=f"{label}[{index}]")
        npc_id = _situation_id(row.get("npc_id"), label=f"{label}[{index}].npc_id")
        skills_raw = _strict_object(row.get("skills"), label=f"{label}[{index}].skills")
        if not 1 <= len(skills_raw) <= _MAX_SITUATION_LIST:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}[{index}].skills must hold 1 to {_MAX_SITUATION_LIST} skills",
            )
        skills: dict[str, int] = {}
        for key, skill_value in skills_raw.items():
            name = _nonempty_text(key, label=f"{label}[{index}].skills key")
            skills[name] = _situation_closed_int(
                skill_value, label=f"{label}[{index}].skills[{name}]", lo=1, hi=100,
            )
        rows.append({"npc_id": npc_id, "skills": skills})
    seen = [row["npc_id"] for row in rows]
    if len(set(seen)) != len(seen):
        raise DebugExperimentError(
            "debug_request_invalid", f"{label} names one NPC twice",
        )
    return rows


def _situation_chase_hazard(value: Any, *, label: str) -> dict[str, Any]:
    hazard = _strict_object(value, label=label)
    extra = sorted(set(hazard) - _CHASE_HAZARD_KEYS)
    if extra:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label} has unknown fields: {', '.join(extra)}",
        )
    missing = {"hazard_id", "skill", "target"} - set(hazard)
    if missing:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label} needs {', '.join(sorted(missing))}",
        )
    out: dict[str, Any] = {
        "hazard_id": _situation_id(hazard["hazard_id"], label=f"{label}.hazard_id"),
        "skill": _nonempty_text(hazard["skill"], label=f"{label}.skill"),
        "target": _situation_closed_int(
            hazard["target"], label=f"{label}.target", lo=0, hi=100,
        ),
    }
    difficulty = hazard.get("difficulty", "regular")
    if difficulty not in _CHASE_DIFFICULTIES:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label}.difficulty must be one of {', '.join(sorted(_CHASE_DIFFICULTIES))}",
        )
    if "difficulty" in hazard:
        out["difficulty"] = difficulty
    for key in ("damage_dice", "collision_severity", "from_wreck", "from_debris", "sudden"):
        if key in hazard:
            out[key] = hazard[key]
    return out


def _situation_chase_barrier(value: Any, *, label: str) -> dict[str, Any]:
    barrier = _strict_object(value, label=label)
    extra = sorted(set(barrier) - _CHASE_BARRIER_KEYS)
    if extra:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label} has unknown fields: {', '.join(extra)}",
        )
    missing = {"barrier_id", "hp", "hp_max", "skill", "target"} - set(barrier)
    if missing:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label} needs {', '.join(sorted(missing))}",
        )
    hp = _situation_closed_int(barrier["hp"], label=f"{label}.hp", lo=0, hi=10_000)
    hp_max = _situation_closed_int(
        barrier["hp_max"], label=f"{label}.hp_max", lo=0, hi=10_000,
    )
    if hp > hp_max:
        raise DebugExperimentError(
            "debug_request_invalid", f"{label}.hp cannot exceed hp_max",
        )
    out: dict[str, Any] = {
        "barrier_id": _situation_id(
            barrier["barrier_id"], label=f"{label}.barrier_id",
        ),
        "hp": hp,
        "hp_max": hp_max,
        "skill": _nonempty_text(barrier["skill"], label=f"{label}.skill"),
        "target": _situation_closed_int(
            barrier["target"], label=f"{label}.target", lo=0, hi=100,
        ),
    }
    difficulty = barrier.get("difficulty", "regular")
    if difficulty not in _CHASE_DIFFICULTIES:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label}.difficulty must be one of {', '.join(sorted(_CHASE_DIFFICULTIES))}",
        )
    if "difficulty" in barrier:
        out["difficulty"] = difficulty
    for key in ("damage_dice", "description"):
        if key in barrier:
            out[key] = barrier[key]
    return out


def _situation_chase_features(value: Any, *, label: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not 1 <= len(value) <= _MAX_SITUATION_LIST:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label} must be a list of 1 to {_MAX_SITUATION_LIST} chase features",
        )
    features: list[dict[str, Any]] = []
    for index, raw in enumerate(value):
        row = _strict_object(raw, label=f"{label}[{index}]")
        _exact_keys(
            row, set(_SITUATION_CHASE_FEATURE_KEYS), label=f"{label}[{index}]",
        )
        if "scene_id" not in row:
            raise DebugExperimentError(
                "debug_request_invalid", f"{label}[{index}] needs scene_id",
            )
        if "barrier" not in row and "hazard" not in row:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}[{index}] needs barrier or hazard",
            )
        feature: dict[str, Any] = {
            "scene_id": _situation_id(
                row["scene_id"], label=f"{label}[{index}].scene_id",
            ),
        }
        if "barrier" in row:
            feature["barrier"] = _situation_chase_barrier(
                row["barrier"], label=f"{label}[{index}].barrier",
            )
        if "hazard" in row:
            feature["hazard"] = _situation_chase_hazard(
                row["hazard"], label=f"{label}[{index}].hazard",
            )
        features.append(feature)
    seen = [row["scene_id"] for row in features]
    if len(set(seen)) != len(seen):
        raise DebugExperimentError(
            "debug_request_invalid", f"{label} names one scene twice",
        )
    return features


def _situation_insanity(value: Any, *, label: str) -> dict[str, Any]:
    insanity = _strict_object(value, label=label)
    _exact_keys(insanity, {"kind"}, label=label)
    kind = insanity.get("kind")
    if kind not in _SITUATION_INSANITY_KINDS:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label}.kind must be one of {', '.join(sorted(_SITUATION_INSANITY_KINDS))}",
        )
    return {"kind": kind}


def _situation_delusion(value: Any, *, label: str) -> dict[str, Any]:
    delusion = _strict_object(value, label=label)
    _exact_keys(delusion, {"description", "backstory_field"}, label=label)
    normalized = {
        "description": _nonempty_text(
            delusion.get("description"), label=f"{label}.description",
        ),
    }
    if "backstory_field" in delusion:
        normalized["backstory_field"] = _nonempty_text(
            delusion["backstory_field"], label=f"{label}.backstory_field",
        )
    return normalized


def _situation_san_gain(value: Any, *, label: str) -> dict[str, Any]:
    gain = _strict_object(value, label=label)
    _exact_keys(gain, {"amount", "source"}, label=label)
    return {
        "amount": _situation_positive_int(
            gain.get("amount"), label=f"{label}.amount",
        ),
        "source": _nonempty_text(gain.get("source"), label=f"{label}.source"),
    }


def _situation_combat(value: Any, *, label: str) -> dict[str, Any]:
    combat = _strict_object(value, label=label)
    _exact_keys(combat, set(_SITUATION_COMBAT_KEYS), label=label)
    if "npc_id" not in combat:
        raise DebugExperimentError(
            "debug_request_invalid", f"{label} needs npc_id",
        )
    out: dict[str, Any] = {
        "npc_id": _situation_id(combat["npc_id"], label=f"{label}.npc_id"),
    }
    if "investigator_acts_now" in combat:
        if combat["investigator_acts_now"] is not True and combat[
            "investigator_acts_now"
        ] is not False:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}.investigator_acts_now must be a boolean",
            )
        out["investigator_acts_now"] = combat["investigator_acts_now"]
    if "spent_weapon_id" in combat:
        out["spent_weapon_id"] = _situation_id(
            combat["spent_weapon_id"], label=f"{label}.spent_weapon_id",
        )
    return out


def _situation_chase(value: Any, *, label: str) -> dict[str, Any]:
    chase = _strict_object(value, label=label)
    _exact_keys(chase, set(_SITUATION_CHASE_KEYS), label=label)
    if "npc_id" not in chase:
        raise DebugExperimentError(
            "debug_request_invalid", f"{label} needs npc_id",
        )
    out: dict[str, Any] = {
        "npc_id": _situation_id(chase["npc_id"], label=f"{label}.npc_id"),
    }
    if "investigator_role" in chase:
        role = chase["investigator_role"]
        if role not in _SITUATION_CHASE_ROLES:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}.investigator_role must be one of "
                f"{', '.join(sorted(_SITUATION_CHASE_ROLES))}",
            )
        out["investigator_role"] = role
    if "pending" in chase:
        pending = chase["pending"]
        if pending not in _SITUATION_CHASE_PENDING:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}.pending must be one of "
                f"{', '.join(sorted(_SITUATION_CHASE_PENDING))}",
            )
        out["pending"] = pending
    return out


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
    normalized: dict[str, Any] = {
        "shape": "structural",
        "scene_id": scene_id,
        "npc_presence": npc_presence,
        "clue_ids": clue_ids,
        "flags": flags,
    }
    # Every remaining structural key has to be carried out of here explicitly.
    # A fixed four-key return accepted `spells`/`damage`/`advance_minutes` in
    # validation and then dropped them on the floor, so `_situation_operations`
    # -- which reads the normalized situation, not the request -- emitted only
    # the scene move. Lanes seeded with a spell reported
    # `magic.spell.known is None` and the whole magic family looked unreachable.
    if "items" in situation:
        normalized["items"] = _situation_items(
            situation["items"], label=f"{label}.items",
        )
    if "spells" in situation:
        normalized["spells"] = _situation_text_list(
            situation["spells"], label=f"{label}.spells",
        )
    if "damage" in situation:
        normalized["damage"] = _situation_damage(
            situation["damage"], label=f"{label}.damage",
        )
    if "advance_minutes" in situation:
        normalized["advance_minutes"] = _situation_positive_int(
            situation["advance_minutes"], label=f"{label}.advance_minutes",
        )
    if "spell_teachers" in situation:
        normalized["spell_teachers"] = _situation_spell_teachers(
            situation["spell_teachers"], label=f"{label}.spell_teachers",
        )
    if "safe_rest" in situation:
        normalized["safe_rest"] = _nonempty_text(
            situation["safe_rest"], label=f"{label}.safe_rest",
        )
    if "ending" in situation:
        normalized["ending"] = _situation_ending(
            situation["ending"], label=f"{label}.ending",
        )
    if "npc_skills" in situation:
        normalized["npc_skills"] = _situation_npc_skills(
            situation["npc_skills"], label=f"{label}.npc_skills",
        )
    if "chase_features" in situation:
        normalized["chase_features"] = _situation_chase_features(
            situation["chase_features"], label=f"{label}.chase_features",
        )
    if "insanity" in situation:
        normalized["insanity"] = _situation_insanity(
            situation["insanity"], label=f"{label}.insanity",
        )
    if "delusion" in situation:
        if "insanity" not in situation:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}.delusion requires {label}.insanity",
            )
        normalized["delusion"] = _situation_delusion(
            situation["delusion"], label=f"{label}.delusion",
        )
    if "san_gain" in situation:
        normalized["san_gain"] = _situation_san_gain(
            situation["san_gain"], label=f"{label}.san_gain",
        )
    if "combat" in situation and "chase" in situation:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label} cannot seed combat and chase together",
        )
    if "combat" in situation:
        normalized["combat"] = _situation_combat(
            situation["combat"], label=f"{label}.combat",
        )
    if "chase" in situation:
        normalized["chase"] = _situation_chase(
            situation["chase"], label=f"{label}.chase",
        )
    return normalized


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
    # State a scene and a roster cannot reach. Eleven of the forty-three
    # decisions were unreachable by seeding on 2026-09-02 -- both magic
    # decisions, six of seven healing decisions, and settle-ending -- because
    # they need a learned spell, a wounded or dying investigator, or a
    # persisted ending, none of which follow from `scene_id` and
    # `npc_presence`.
    #
    # Each still goes through the canonical toolbox gateway, so the state is
    # exactly what real play would have produced. Seeding a spell is not
    # simulating one.
    for item in situation.get("items") or []:
        item_id = str(item.get("item_id") or item.get("label") or "item")
        operations.append({
            "operation": "state.item_grant",
            "arguments": {
                "campaign": campaign_id,
                "kind": str(item.get("kind") or "gear"),
                "label": str(item.get("label") or item_id),
                "note": reason,
                **{
                    key: item[key] for key in
                    ("item_id", "weapon", "weapon_id", "mechanics_ref",
                     "quantity", "consumable", "investigator")
                    if item.get(key) is not None
                },
                "decision_id": f"debug-situation:{lane_id}:item-grant:{item_id}",
            },
        })
    # A lane that appointed a teacher learns from that teacher: seeding a
    # spell as read from a book while the situation says a person taught it
    # puts the receipt at odds with the scene the Keeper is looking at.
    taught_by = {
        spell: row["source_kind"]
        for row in situation.get("spell_teachers") or []
        for spell in row["spells"]
    }
    for spell in situation.get("spells") or []:
        operations.append({
            "operation": "magic.learn",
            "arguments": {
                "campaign": campaign_id,
                "spell": spell,
                # `source` here is the kind of teacher, a closed set the
                # operation enforces -- not a free-text note like the `reason`
                # every other seeded write carries.
                "source": taught_by.get(spell, "tome"),
                "decision_id": f"debug-situation:{lane_id}:learn-spell:{spell}",
            },
        })
    # Every branch below reads the normalized situation, whose shapes
    # `_normalize_situation` has already settled: damage and ending are always
    # objects here, safe_rest always a string.
    damage = situation.get("damage")
    if damage:
        operations.append({
            "operation": "rules.damage",
            "arguments": {
                "campaign": campaign_id,
                "amount": damage["amount"],
                "source": reason,
                **({"kind": damage["kind"]} if damage.get("kind") else {}),
                "decision_id":
                    f"debug-situation:{lane_id}:damage:{damage['amount']}",
            },
        })
    # Ordered after the state that the clock acts on: damage first, then the
    # hours that let a wound or an insanity reach its recovery trigger.
    minutes = situation.get("advance_minutes")
    if minutes:
        operations.append({
            "operation": "state.advance_time",
            "arguments": {
                "campaign": campaign_id,
                "minutes": minutes,
                "reason": reason,
                "decision_id": f"debug-situation:{lane_id}:advance-time:{minutes}",
            },
        })
    rest = situation.get("safe_rest")
    # A due Sanity trigger is auto_apply_if_safe. Marking rest in the same
    # seed fires it before the Keeper can settle apply-treatment /
    # recover-temporary (r79 s-treat5 / s-recov2). Leave the trigger pending.
    if rest and not situation.get("insanity"):
        operations.append({
            "operation": "state.mark_safe_rest",
            "arguments": {
                "campaign": campaign_id,
                "rest_kind": rest,
                "decision_id": f"debug-situation:{lane_id}:safe-rest",
            },
        })
    ending = situation.get("ending")
    if ending:
        operations.append({
            "operation": "state.end_session",
            "arguments": {
                "campaign": campaign_id,
                "summary": ending["summary"],
                **({"kind": ending["kind"]} if ending.get("kind") else {}),
                "decision_id": f"debug-situation:{lane_id}:end-session",
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


def _operation_contract(operation: str) -> dict[str, Any]:
    """The operation's own declared parameter contract."""
    try:
        described = subprocess.run(
            [sys.executable, str(_TOOLBOX_SCRIPT), "describe", operation],
            capture_output=True, text=True, timeout=30, check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise DebugExperimentError(
            "situation_catalog_unavailable",
            f"cannot read the contract for {operation}",
        ) from exc
    if described.returncode != 0 or not described.stdout.strip():
        raise DebugExperimentError(
            "situation_catalog_unavailable",
            f"cannot read the contract for {operation}",
        )
    try:
        contract = json.loads(described.stdout)
    except json.JSONDecodeError as exc:
        raise DebugExperimentError(
            "situation_catalog_unavailable",
            f"the contract for {operation} is unreadable",
        ) from exc
    return contract.get("params") or {}


def _validate_seed_arguments(spec: dict[str, Any]) -> None:
    """Check every seeded write against the contract of the operation it calls.

    Four seeding rounds in a row shipped an argument the operation rejects --
    a damage `kind` of "physical" where it means damage-or-heal, an item kind
    of "tome" where it takes gear or weapon, a `magic.learn` source carrying
    prose where it takes tome/person/entity. Each cost a whole lane, and
    because a failed seed fails the lane, the evidence left behind read like a
    rule-layer refusal of a family that had never been reached at all.

    The operations already declare these sets. Copying them here would be a
    second place to drift; this reads the declaration instead.
    """
    contracts: dict[str, dict[str, Any]] = {}
    for lane in spec["lanes"]:
        for row in _situation_operations(lane, "contract-check"):
            operation = row["operation"]
            if operation not in contracts:
                contracts[operation] = _operation_contract(operation)
            params = contracts[operation]
            for name, value in row["arguments"].items():
                declared = params.get(name)
                if not isinstance(declared, dict):
                    continue
                allowed = declared.get("enum")
                if isinstance(allowed, list) and value not in allowed:
                    raise DebugExperimentError(
                        "debug_request_invalid",
                        f"lane {lane['id']}: {operation} {name} must be one of "
                        f"{', '.join(str(item) for item in allowed)}, "
                        f"not {value!r}",
                    )


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
        for row in situation.get("npc_skills") or []:
            npc_id = row["npc_id"]
            if coc_npc_identity.resolve_authored_npc(npc_agendas, npc_id) is None:
                raise DebugExperimentError(
                    "situation_unknown_npc",
                    f"lane {lane['id']}: NPC {npc_id!r} is not authored in the sealed campaign",
                )
        for feature in situation.get("chase_features") or []:
            scene_id = feature["scene_id"]
            if scene_id not in scene_ids:
                raise DebugExperimentError(
                    "situation_unknown_scene",
                    f"lane {lane['id']}: scene {scene_id!r} is not in the sealed story graph",
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
            {
                "id", "profile", "player_input", "second_player_input",
                "doctrine_overrides", "situation",
            },
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
            # Optional. A lane is one pi session, and the play prompt tells the
            # Keeper to load every active skill's SKILL.md at session start --
            # so a one-turn lane charges a once-per-session cost to the only
            # turn it measures. A second input in the SAME session is what a
            # per-turn budget is actually about.
            **(
                {"second_player_input": _nonempty_text(
                    lane["second_player_input"],
                    label=f"lanes[{index}].second_player_input",
                )}
                if lane.get("second_player_input") is not None else {}
            ),
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


def _situation_turn_note(situation: dict[str, Any]) -> str:
    note = _SITUATION_SEEDED_TURN_NOTE
    if situation.get("combat"):
        note += _SITUATION_COMBAT_TURN_NOTE
    if situation.get("chase"):
        note += _SITUATION_CHASE_TURN_NOTE
        pending = (situation.get("chase") or {}).get("pending")
        if pending == "conflict":
            note += (
                " A combat defense receipt is already bound to this chase. "
                "Settle decision:coc7:chase:conflict; do not combat:end."
            )
    if situation.get("spell_teachers") or situation.get("spells"):
        note += _SITUATION_MAGIC_TURN_NOTE
    if situation.get("insanity") and not situation.get("delusion"):
        note += _SITUATION_SANITY_DUE_TURN_NOTE
    return note


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


def _entry_category(custom: Any) -> str:
    """Which lane file an appended entry belongs in.

    A replan abandons the rest of a batched tool run and costs a fresh model
    round trip, so it belongs with the working-set evidence. It used to fall
    through to the undifferentiated rpc stream, so no lane could select it:
    the audit existed and was unreadable. Measured once it was selectable, a
    schema lookup that triggers a replan is followed by ~33s of model time
    against ~0s for one that does not.
    """
    if custom in {"coc-tool-working-set", "coc-tool-working-set-replan"}:
        return "working_set"
    if custom == "coc-turn-timing":
        return "timing"
    return "rpc"


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
        # OAuth refresh writes the rotated token into this home. Copying
        # auth.json meant a successful lane burned the source refresh token:
        # r79 rotated inside the copy, rmtree dropped it, r80+ died
        # invalid_grant. Bind the live credential file so refresh lands
        # on the source home the operator actually logs into.
        source_auth = source / "auth.json"
        auth = target / "auth.json"
        if source_auth.exists():
            real_auth = source_auth.resolve()
            if not real_auth.is_file():
                raise DebugExperimentError(
                    "rpc_spawn_failed", "source Pi home auth.json is not a file",
                )
            if auth.exists() or auth.is_symlink():
                auth.unlink()
            os.symlink(real_auth, auth)
            os.chmod(real_auth, 0o600)
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
        situation = lane.get("situation") or {}

        def campaign_dir() -> Path:
            raw = materialized.get("campaign_dir")
            if not raw:
                raise DebugExperimentError(
                    "situation_catalog_unavailable",
                    "the lane materialization names no campaign_dir",
                )
            return Path(raw)

        teachers = situation.get("spell_teachers") or []
        if teachers:
            # Authored data first: a spell seeded before its teacher exists
            # would be refused by the same gate this appointment opens.
            applied.extend(_appoint_spell_teachers(campaign_dir(), teachers))
        npc_skills = situation.get("npc_skills") or []
        if npc_skills:
            applied.extend(_seed_npc_skills(campaign_dir(), npc_skills))
        chase_features = situation.get("chase_features") or []
        if chase_features:
            applied.extend(_seed_chase_features(campaign_dir(), chase_features))
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
        # After scene/NPC toolbox writes: those call process_due_triggers.
        # Seeding a due Sanity trigger before them let a library scene-change
        # eat apply-treatment (r85 s-treat6). Rest/advance are still omitted
        # when insanity is set, so the Keeper can settle the card.
        if situation.get("insanity"):
            applied.extend(_seed_insanity(campaign_dir(), situation["insanity"]))
        if situation.get("delusion"):
            applied.extend(_seed_delusion(campaign_dir(), situation["delusion"]))
        # Combat and chase need the scene/NPC/items the toolbox just wrote.
        if situation.get("spells") and not situation.get("spell_teachers"):
            applied.extend(_seed_known_spells(
                campaign_dir(), list(situation["spells"]),
            ))
        if situation.get("combat"):
            applied.extend(_seed_combat(campaign_dir(), situation["combat"]))
        if situation.get("chase"):
            applied.extend(_seed_chase(campaign_dir(), situation["chase"]))
        # SAN-gain is a pending receipt, not a toolbox write.
        if situation.get("san_gain"):
            applied.extend(_seed_san_gain(campaign_dir(), situation["san_gain"]))
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
            situation_evidence["instruction"] = _situation_turn_note(
                lane.get("situation") or {},
            )
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
        # A settled state.end_session moves the campaign into its ending
        # phase, where no later player turn can finalize. The turn2 gate and
        # the lane annotation read this.
        session_ended = False
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
            nonlocal session_ended
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
                # Monotonic milliseconds since the lane began. Without it the
                # record says which calls happened and in what order but
                # nothing about where the turn's time went: a lane that runs
                # 280s against a 180s budget cannot be told apart from one
                # that makes the same calls in 120s. Model time is then the
                # gap between one call ending and the next beginning.
                tool_row = {
                    "category": "tools",
                    "phase": "start" if event_type.endswith("start") else "end",
                    "operation": operation,
                    "at_ms": round((time.monotonic() - started) * 1000),
                    # Which side of the player's input this call falls on.
                    # Without it the resume phase and the turn are one
                    # undifferentiated number, and the turn cannot be measured
                    # against a turn budget at all.
                    "lane_phase": current_phase,
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
                if (
                    event_type == "tool_execution_end"
                    and operation == "state.end_session"
                ):
                    session_ended = _tool_result_success(event)
            elif event_type == "message_end":
                text = _assistant_text(event.get("message"))
                if text:
                    visible_text = text
                # How much prose the model produced, and when. Tool time is
                # 3% of a lane, so the budget question is entirely about what
                # the model generates; a size beside each turn boundary is
                # what separates "thinking a long time" from "writing a lot".
                events.append({
                    "category": "timing",
                    "phase": "message_end",
                    "operation": "message",
                    "at_ms": round((time.monotonic() - started) * 1000),
                    "lane_phase": current_phase,
                    "text_chars": len(text or ""),
                })
            elif event_type == "entry_appended":
                entry = event.get("entry")
                custom = entry.get("customType") if isinstance(entry, dict) else None
                category = _entry_category(custom)
                row = {"category": category, "event": _redact(event)}
                if category == "working_set":
                    row["at_ms"] = round((time.monotonic() - started) * 1000)
                    row["lane_phase"] = current_phase
                events.append(row)
            else:
                events.append({"category": "rpc", "event": _redact(event)})
                if event_type in {"message_start", "message_update"}:
                    events.append({"category": "provider_stream", "event": _redact(event)})

        def wait_terminal(*, phase: str) -> tuple[bool, str | None]:
            nonlocal abort_count, current_phase
            current_phase = phase
            progress(phase)
            # The resume phase ends at agent_settled: stopping at
            # awaiting_player is its whole job. A player turn does not: it is
            # over only once turn.finalize has succeeded, which is the lane's
            # completion condition. A Keeper that goes quiet before then has
            # stopped mid-turn, not ended it -- returning at that moment
            # truncated still-open turns into player_turn_undelivered
            # (measured 2026-09-04 on r74 c-flee3), so the loop keeps waiting
            # to the deadline and classifies only there.
            player_turn = phase != "resume"
            settled_unfinalized = False
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
                                # A settle that follows the abort
                                # confirmation is the abort acknowledgement,
                                # not the Keeper stopping mid-turn.
                                if (
                                    player_turn and not finalized
                                    and not abort_confirmed
                                ):
                                    settled_unfinalized = True
                            if settled_seen and abort_confirmed:
                                break
                    # A turn that settled without a finalize is a delivery
                    # failure; a deadline hit while the model was still
                    # working is a budget overrun. Both used to read as the
                    # same timeout.
                    if player_turn and settled_unfinalized and not finalized:
                        return False, "player_turn_undelivered"
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
                    if player_turn and not finalized:
                        settled_unfinalized = True
                        continue
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
            second_input = lane.get("second_player_input")
            turn2_skipped: dict[str, Any] | None = None
            second_turn_due = (
                settled and failure is None and finalized
                and isinstance(second_input, str) and second_input
            )
            if second_turn_due and session_ended:
                # turn1 settled state.end_session: the campaign is in its
                # ending phase, where a player turn has nothing left to
                # finalize (measured 2026-09-04 on r73 d-settle2 -- turn2
                # produced ending narration with no finalizable output, and
                # the lane verdict flipped from turn1's successful delivery
                # to player_turn_undelivered). The lane is judged by turn1
                # and carries a note saying the second input was never sent.
                turn2_skipped = {"reason": "session_ending_after_turn1"}
            elif second_turn_due:
                # Same session, same skills already loaded, no situation
                # seeding: the cost of an ordinary turn rather than a first
                # one. `finalized` and the delivery text are reset so the
                # lane's verdict describes the turn it ends on.
                finalized = False
                visible_text = ""
                rendered_text = ""
                first_operation = None
                send({
                    "type": "prompt",
                    "id": f"turn2-{lane['id']}",
                    "message": second_input,
                })
                settled, failure = wait_terminal(phase="turn2")
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
            if turn2_skipped is not None:
                result["turn2_skipped"] = turn2_skipped
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
            # Argument shapes first: they need no sealed campaign, and a
            # value the target operation rejects is worth saying before any
            # id lookup.
            _validate_seed_arguments(spec)
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
