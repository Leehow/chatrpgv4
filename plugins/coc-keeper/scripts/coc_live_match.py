#!/usr/bin/env python3
"""Live LLM-player vs KP match harness (N5).

Orchestrates: build player-safe request → player_send_turn → run_live_turn →
battle-report artifacts. The player brain lives in ``runtime/adapters/player/``;
this module stays plugin-side and does not fork keeper skills/rules into runtime.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
# parents[0]=coc-keeper, [1]=plugins, [2]=repo root
REPO_ROOT = SCRIPT_DIR.parents[2]


def _load_sibling(name: str, filename: str):
    import importlib.util

    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _load_runtime_module(name: str, rel: str):
    import importlib.util

    path = REPO_ROOT / rel
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


playtest_driver = _load_sibling("coc_playtest_driver", "coc_playtest_driver.py")
playtest_evidence = _load_sibling("coc_playtest_evidence", "coc_playtest_evidence.py")
playtest_report = _load_sibling("coc_playtest_report", "coc_playtest_report.py")
live_turn_runner = _load_sibling("coc_live_turn_runner", "coc_live_turn_runner.py")
narration_contract = _load_sibling("coc_narration_contract", "coc_narration_contract.py")
apply_mod = _load_sibling("coc_director_apply", "coc_director_apply.py")
coc_scene_graph = _load_sibling("coc_scene_graph", "coc_scene_graph.py")
try:
    coc_adherence = _load_sibling("coc_adherence", "coc_adherence.py")
except Exception:
    coc_adherence = None
public_state_mod = _load_runtime_module(
    "runtime_public_state", "runtime/engine/public_state.py"
)
player_adapter = _load_runtime_module(
    "runtime_player_adapter", "runtime/adapters/player/adapter.py"
)
narrator_adapter = _load_runtime_module(
    "runtime_narrator_adapter", "runtime/adapters/narrator/adapter.py"
)

NON_LIVE_EVIDENCE_DISCLAIMER = (
    "Non-live artifacts are never gameplay evidence per AGENTS.md "
    "Playtest Battle Report Evidence Standard."
)


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def _campaign_dir(workspace: Path, campaign_id: str) -> Path:
    return Path(workspace) / ".coc" / "campaigns" / campaign_id


def _default_character_path(workspace: Path, investigator_id: str) -> Path:
    return (
        Path(workspace)
        / ".coc"
        / "investigators"
        / investigator_id
        / "character.json"
    )


def load_character_card(character_path: Path | str) -> dict[str, Any]:
    """Load the investigator's own character sheet (player-safe by ownership)."""
    data = _read_json(Path(character_path), {})
    return data if isinstance(data, dict) else {}


def player_visible_narration(
    turn: dict[str, Any] | None,
    campaign_dir: Path,
    *,
    play_language: str = "zh-Hans",
    previous_affordance_ids: list[str] | None = None,
) -> str:
    """Derive player-visible narration text from a live turn (no keeper secrets)."""
    if not turn:
        world = _read_json(campaign_dir / "save" / "world-state.json", {})
        scene_id = world.get("active_scene_id") if isinstance(world, dict) else None
        story = _read_json(campaign_dir / "scenario" / "story-graph.json", {"scenes": []})
        scenes = story.get("scenes") if isinstance(story, dict) else []
        for scene in scenes or []:
            if isinstance(scene, dict) and scene.get("scene_id") == scene_id:
                dq = scene.get("dramatic_question")
                if dq:
                    return str(dq)
        return "场景开始。你站在可调查的现场。" if play_language == "zh-Hans" else "The scene opens."

    clue_names = playtest_driver._clue_lookup(campaign_dir)
    npc_names = playtest_driver._npc_lookup(campaign_dir)
    return playtest_driver._keeper_turn_text(
        turn,
        clue_names,
        npc_names,
        previous_affordance_ids=previous_affordance_ids,
    )


def build_player_request(
    workspace: Path | str,
    campaign_id: str,
    *,
    narration: str,
    character_card: dict[str, Any],
    transcript_tail: list[dict[str, Any]],
) -> dict[str, Any]:
    """Assemble a player-brain request from player-safe inputs only."""
    public_state = public_state_mod.build_public_state(workspace, campaign_id)
    pending = public_state.get("pending_choice")
    return {
        "public_state": public_state,
        "narration": str(narration or ""),
        "character_card": dict(character_card),
        "transcript_tail": list(transcript_tail),
        "pending_choice": pending,
    }


def investigator_playability(
    campaign_dir: Path,
    investigator_id: str,
) -> dict[str, Any]:
    """Classify structured investigator state without equating 0 HP to death."""
    state = _read_json(
        campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json",
        {},
    )
    if not isinstance(state, dict):
        state = {}
    raw_conditions = state.get("conditions") or []
    conditions = {
        str(condition).strip().lower()
        for condition in raw_conditions
        if str(condition).strip()
    } if isinstance(raw_conditions, list) else set()

    if "dead" in conditions:
        return {"status": "dead", "playable": False, "terminal": True}

    if "stabilized" in conditions:
        return {
            "status": "stabilized",
            "playable": False,
            "terminal": False,
            "pending_resolution": {
                "kind": "stabilized_death_clock",
                "investigator_id": investigator_id,
                "event_type": "stabilized_con_roll",
            },
        }

    if "dying" in conditions:
        return {
            "status": "dying",
            "playable": False,
            "terminal": False,
            "pending_resolution": {
                "kind": "dying_rescue",
                "investigator_id": investigator_id,
                "rescue_event_type": "first_aid_stabilize",
                "death_clock_event_type": "dying_con_roll",
            },
        }

    if (
        "permanently_unplayable" in conditions
        or state.get("permanently_insane")
        or state.get("permanent_insane")
    ):
        return {
            "status": "permanently_unplayable",
            "playable": False,
            "terminal": False,
        }

    if (
        "temporarily_unplayable" in conditions
        or "bout_active" in conditions
        or state.get("bout_active")
    ):
        return {
            "status": "temporarily_unplayable",
            "playable": False,
            "terminal": False,
        }

    hp = state.get("current_hp")
    hp_at_or_below_zero = False
    try:
        hp_at_or_below_zero = hp is not None and int(hp) <= 0
    except (TypeError, ValueError):
        pass

    if "unconscious" in conditions or hp_at_or_below_zero:
        return {"status": "unconscious", "playable": False, "terminal": False}
    return {"status": "active", "playable": True, "terminal": False}


def _playability_stop_reason(playability: dict[str, Any]) -> str | None:
    if playability.get("terminal") is True:
        return "investigator_dead"
    if isinstance(playability.get("pending_resolution"), dict):
        return "pending_resolution"
    if playability.get("playable") is False:
        return f"investigator_{playability.get('status') or 'unplayable'}"
    return None


def _match_metadata(
    *,
    user_claimed_live: bool,
    campaign_id: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "campaign_id": campaign_id,
        "user_claimed_live": bool(user_claimed_live),
        "audit_profile": "player_bridge_match",
        "play_language": "zh-Hans",
        "runner_kind": "unknown",
        "player_profile": "unattested_runner",
        "simulation_method": "unattested_runner_match_not_gameplay_evidence",
        "evidence_disclaimer": NON_LIVE_EVIDENCE_DISCLAIMER,
        "eligible_as_gameplay_evidence": False,
        "evidence_reasons": ["evidence_receipt_pending"],
        "subsystems_covered": [
            "investigation",
            "rules",
            "narrative_enrichment",
            "storylet_engine",
            "player_brain_bridge",
        ],
        "passed_test_cases": [
            "bridged_player_turns",
            "actual_play_transcript",
            "rules_rolls",
            "storylet_events",
        ],
        "failed_test_cases": [],
        "future_enhancements": [
            "Provide structured runner/model attestations for evidence-grade gameplay receipts."
        ],
    }
    if extra:
        meta.update(extra)
    return meta


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _invocation_row(
    *,
    run_dir: Path,
    role: str,
    runner_path: Path | None,
    attempt: int,
    outcome: str,
    model_identity: Any,
    response_mode: Any,
    fallback_kind: str | None,
) -> dict[str, Any]:
    observed = playtest_evidence.observe_runner(run_dir, role, runner_path)
    return {
        "schema_version": 1,
        "role": role,
        "attempt": attempt,
        "transcript_turn": None,
        "runner_kind": observed.get("kind"),
        "runner_identity": observed.get("identity"),
        "runner_path": observed.get("path"),
        "runner_sha256": observed.get("sha256"),
        "model_identity": model_identity,
        "outcome": outcome,
        "response_mode": response_mode,
        "fallback_kind": fallback_kind,
    }


def _read_jsonl_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.is_file():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            rows.append(row)
    return rows


def _write_invocation_ledger(run_dir: Path, rows: list[dict[str, Any]]) -> Path:
    transcript = _read_jsonl_rows(run_dir / "transcript.jsonl")
    turns_by_role = {
        "player": [
            row.get("turn")
            for row in transcript
            if row.get("role") == "player_simulator"
        ],
        "narrator": [
            row.get("turn")
            for row in transcript
            if row.get("role") == "keeper_under_test"
        ],
    }
    role_offsets = {"player": 0, "narrator": 0}
    for row in rows:
        role = row.get("role")
        available = turns_by_role.get(str(role), [])
        offset = role_offsets.get(str(role), 0)
        if offset < len(available):
            row["transcript_turn"] = available[offset]
        role_offsets[str(role)] = offset + 1
    return playtest_evidence.write_invocation_ledger_artifact(
        run_dir,
        "".join(
            json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n"
            for row in rows
        ),
    )


def _enrich_transcript_with_player_notes(
    run_dir: Path,
    player_turns: list[dict[str, Any]],
) -> None:
    """Attach per-turn player_notes onto player transcript rows (report artifact).

    Notes stay on the structured ``player_notes`` field so the battle report can
    render them as a sub-bullet; do not inline into quoted player_text.
    """
    path = run_dir / "transcript.jsonl"
    if not path.exists():
        return
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    note_by_text = {
        str(pt.get("player_text") or ""): pt.get("player_notes")
        for pt in player_turns
        if pt.get("player_notes")
    }
    player_idx = 0
    for row in rows:
        if row.get("role") != "player_simulator":
            continue
        notes = None
        if player_idx < len(player_turns):
            notes = player_turns[player_idx].get("player_notes")
        if notes is None:
            notes = note_by_text.get(str(row.get("text") or ""))
        if notes:
            row["player_notes"] = notes
            # Strip legacy inline pollution if a prior run inlined notes.
            base = str(row.get("text") or "")
            marker = "\n[player_notes] "
            if marker in base:
                row["text"] = base.split(marker, 1)[0]
        player_idx += 1
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def build_narrator_request(
    *,
    narration_envelope: dict[str, Any],
    last_player_text: str,
    play_language: str,
    recent_narrations: list[str],
) -> dict[str, Any]:
    """Assemble a narrator-brain request (envelope already player-safe)."""
    return {
        "narration_envelope": dict(narration_envelope or {}),
        "last_player_text": str(last_player_text or ""),
        "play_language": str(play_language or "zh-Hans"),
        "recent_narrations": list(recent_narrations or [])[-2:],
    }


def _apply_narrator_or_template(
    *,
    template_text: str,
    projected: dict[str, Any],
    live_turn: dict[str, Any],
    campaign_dir: Path,
    last_player_text: str,
    play_language: str,
    recent_narrations: list[str],
    narrator_runner: Path | None,
    timeout_s: float,
) -> tuple[str, str, dict[str, Any] | None, dict[str, Any]]:
    """Return text, method, fallback event, and structured runner outcome.

    Fallback ladder: narrator error/timeout → template text + narrator_fallback.
    """
    if narrator_runner is None:
        return template_text, "template", None, {
            "outcome": "template",
            "fallback_kind": "template",
            "model_identity": None,
            "response_mode": "template",
        }

    envelope = (
        projected.get("narration_envelope")
        or live_turn.get("narration_envelope")
        or {}
    )
    request = build_narrator_request(
        narration_envelope=envelope if isinstance(envelope, dict) else {},
        last_player_text=last_player_text,
        play_language=play_language,
        recent_narrations=recent_narrations,
    )
    try:
        result = narrator_adapter.narrator_send_turn(
            request,
            runner_path=narrator_runner,
            timeout_s=timeout_s,
        )
    except Exception as exc:  # noqa: BLE001 — fallback ladder must catch all runner failures
        fallback = {
            "event": "narrator_fallback",
            "error": str(exc),
            "decision_id": projected.get("decision_id") or live_turn.get("decision_id"),
        }
        return template_text, "template", fallback, {
            "outcome": "template_fallback",
            "fallback_kind": "template",
            "model_identity": None,
            "response_mode": "runner_failure",
        }

    final_text = str(result.get("final_text") or "").strip()
    if not final_text:
        fallback = {
            "event": "narrator_fallback",
            "error": "narrator returned empty final_text",
            "decision_id": projected.get("decision_id") or live_turn.get("decision_id"),
        }
        return template_text, "template", fallback, {
            "outcome": "template_fallback",
            "fallback_kind": "template",
            "model_identity": None,
            "response_mode": "runner_failure",
        }

    audit = narration_contract.audit_final_text(
        final_text,
        decision_id=str(projected.get("decision_id") or live_turn.get("decision_id") or ""),
        language=play_language,
    )
    guarded = audit.get("guarded") or {}
    findings = guarded.get("findings") or []
    has_rewrite = any(
        isinstance(f, dict) and str(f.get("severity") or "") == "rewrite"
        for f in findings
    )
    if guarded.get("changed") and has_rewrite:
        final_text = str(guarded.get("final_text") or final_text).strip()
    narration_contract.append_narration_audit_records(
        campaign_dir, audit.get("records") or []
    )
    notes = result.get("notes")
    if notes:
        projected["narrator_notes"] = notes
    response_mode = result.get("response_mode")
    return final_text, "llm_narrator", None, {
        "outcome": "external_success",
        "fallback_kind": (
            "prose_degradation" if response_mode == "prose_fallback" else None
        ),
        "model_identity": result.get("model_identity"),
        "response_mode": response_mode,
    }


def run_live_match(
    workspace: Path | str,
    campaign_id: str,
    investigator_id: str,
    *,
    player_runner: Path | str,
    max_turns: int = 20,
    rng_seed: int | str | None = None,
    live: bool = False,
    character_path: Path | str | None = None,
    run_dir: Path | str | None = None,
    intent_class: str | None = None,
    player_intent_rich: dict[str, Any] | None = None,
    timeout_s: float = 300,
    transcript_tail_limit: int = 6,
    narrator_runner: Path | str | None = None,
    evidence_provenance: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run a multi-turn match: external player brain ↔ KP ``run_live_turn``.

    ``live`` is recorded only as ``user_claimed_live``.  Evidence eligibility,
    runner kind, and model identity are derived from ``evidence.json`` and its
    structured provenance; the flag itself carries no attestation authority.
    When ``narrator_runner`` is set, KP prose goes through the narrator bridge
    with a template fallback ladder.
    """
    started_at = _utc_timestamp()
    ws = Path(workspace)
    camp = _campaign_dir(ws, campaign_id)
    if not camp.is_dir():
        raise FileNotFoundError(f"campaign not found: {camp}")
    char_path = Path(character_path) if character_path else _default_character_path(ws, investigator_id)
    if not char_path.is_file():
        raise FileNotFoundError(f"character sheet not found: {char_path}")

    character_card = load_character_card(char_path)
    rng = random.Random(rng_seed if rng_seed is not None else f"{campaign_id}|{time.time_ns()}")
    runner = Path(player_runner)
    narrator_path = Path(narrator_runner) if narrator_runner is not None else None

    if run_dir is None:
        stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        out = ws / ".coc" / "playtests" / f"live-match-{stamp}"
    else:
        out = Path(run_dir)
    out.mkdir(parents=True, exist_ok=True)

    turns: list[dict[str, Any]] = []
    player_turns: list[dict[str, Any]] = []
    player_requests: list[dict[str, Any]] = []
    player_choices: list[dict[str, Any]] = []
    transcript_tail: list[dict[str, Any]] = []
    recent_narrations: list[str] = []
    invocation_rows: list[dict[str, Any]] = []
    tension_curve: list[Any] = []
    scene_path: list[str] = []
    stop_reason = "max_turns_reached"
    pending_resolution: dict[str, Any] | None = None
    last_turn: dict[str, Any] | None = None
    previous_affordance_ids: list[str] | None = None
    fallback_turns = 0
    used_llm_narrator = False

    campaign_meta = _read_json(camp / "campaign.json", {})
    module_meta = _read_json(camp / "scenario" / "module-meta.json", {})
    play_language = str(
        campaign_meta.get("play_language") if isinstance(campaign_meta, dict) else "zh-Hans"
    ) or "zh-Hans"
    story = _read_json(camp / "scenario" / "story-graph.json", {"scenes": []})
    current_playability = investigator_playability(camp, investigator_id)

    for _offset in range(max(1, int(max_turns))):
        automatic_subsystem_request: dict[str, Any] | None = None
        canonical_pending = live_turn_runner.subsystem_executor.get_current_pending_choice(camp)
        keeper_progression = (
            isinstance(canonical_pending, dict)
            and canonical_pending.get("responder") == "keeper"
        )
        if keeper_progression:
            allowed_actions = {
                str(option.get("action"))
                for option in (canonical_pending.get("options") or [])
                if isinstance(option, dict) and option.get("action")
            }
            if "tick" not in allowed_actions:
                stop_reason = "keeper_pending_choice_requires_explicit_policy"
                pending_resolution = {
                    "kind": "keeper_subsystem_choice",
                    "choice_id": canonical_pending.get("choice_id"),
                }
                break
            player_result = {
                "ok": True,
                "player_text": "",
                "pending_choice_response": {
                    "choice_id": canonical_pending["choice_id"],
                    "responder": "keeper",
                    "revision": canonical_pending["revision"],
                    "action": "tick",
                },
            }
        else:
            current_playability = investigator_playability(camp, investigator_id)
            pending_playability = current_playability.get("pending_resolution")
            pending_kind = (
                pending_playability.get("kind")
                if isinstance(pending_playability, dict)
                else None
            )
            if pending_kind in {"dying_rescue", "stabilized_death_clock"}:
                # The KP owns death-clock progression.  Do not ask an
                # unconscious player-brain for prose merely to reach the
                # structured rescue engine.
                keeper_progression = True
                automatic_subsystem_request = {
                    "kind": "dying_tick",
                    "payload": {
                        "decision_id": f"live-match-rescue-{_offset + 1}",
                        "clock_kind": (
                            "hour" if pending_kind == "stabilized_death_clock" else "round"
                        ),
                    },
                }
                player_result = {"ok": True, "player_text": ""}
            else:
                playability_stop = _playability_stop_reason(current_playability)
                if playability_stop:
                    stop_reason = playability_stop
                    pending = current_playability.get("pending_resolution")
                    pending_resolution = dict(pending) if isinstance(pending, dict) else None
                    break

            if automatic_subsystem_request is None:
                narration = player_visible_narration(
                    last_turn,
                    camp,
                    play_language=play_language,
                    previous_affordance_ids=previous_affordance_ids,
                )
                request = build_player_request(
                    ws,
                    campaign_id,
                    narration=narration,
                    character_card=character_card,
                    transcript_tail=transcript_tail[-transcript_tail_limit:],
                )
                player_requests.append(json.loads(json.dumps(request, ensure_ascii=False)))

                player_result = player_adapter.player_send_turn(
                    request,
                    runner_path=runner,
                    timeout_s=timeout_s,
                )
        player_response_mode = player_result.get("response_mode")
        if not keeper_progression:
            invocation_rows.append(
                _invocation_row(
                    run_dir=out,
                    role="player",
                    runner_path=runner,
                    attempt=len(
                        [r for r in invocation_rows if r.get("role") == "player"]
                    ) + 1,
                    outcome="external_success",
                    model_identity=player_result.get("model_identity"),
                    response_mode=player_response_mode,
                    fallback_kind=(
                        "prose_degradation"
                        if player_response_mode == "prose_fallback"
                        else None
                    ),
                )
            )
        player_text = player_result["player_text"]
        player_notes = player_result.get("player_notes")
        # Per-turn structured intent from the player brain takes precedence over
        # the match-level CLI override (Semantic Matcher: structured evidence).
        turn_intent_class = player_result.get("intent_class") or intent_class

        live_result = live_turn_runner.run_live_turn(
            camp,
            char_path,
            investigator_id,
            player_text,
            intent_class=turn_intent_class,
            player_intent_rich=player_intent_rich,
            pending_choice_response=player_result.get("pending_choice_response"),
            subsystem_request=automatic_subsystem_request,
            max_auto_advance=1,
            auto_advance_low_agency=False,
            recording_mode="sync",
            recording_flush="manual",
            rng=rng,
        )

        choice_record = {
            "intent": player_text,
            "text": player_text,
            "player_text": player_text,
            "player_notes": player_notes,
            "intent_class": turn_intent_class,
        }
        if not keeper_progression:
            if isinstance(player_result.get("pending_choice_response"), dict):
                choice_record["pending_choice_response"] = dict(
                    player_result["pending_choice_response"]
                )
            player_choices.append(choice_record)
            player_turns.append(
                {
                    "player_text": player_text,
                    "player_notes": player_notes,
                    "live_result": {
                        "auto_advance": live_result.get("auto_advance"),
                        "final_state": live_result.get("final_state"),
                    },
                }
            )
            transcript_tail.append({"role": "player", "text": player_text})

        for live_turn in live_result.get("turns") or []:
            decision_id = str(live_turn.get("decision_id") or "")
            turn_num = playtest_driver._decision_turn_number(decision_id) or (len(turns) + 1)
            projected = playtest_driver._project_driver_turn(live_turn, turn_num)
            current_scene = projected.get("scene_id") or "?"
            if not scene_path or scene_path[-1] != current_scene:
                scene_path.append(str(current_scene))
            tension_curve.append(projected.get("tension") or "low")
            current_ids = playtest_driver._choice_frame_route_ids(
                projected.get("choice_frame", {}) or {}
            )
            template_text = player_visible_narration(
                projected,
                camp,
                play_language=play_language,
                previous_affordance_ids=previous_affordance_ids,
            )
            keeper_text, method, fallback, narrator_outcome = _apply_narrator_or_template(
                template_text=template_text,
                projected=projected,
                live_turn=live_turn if isinstance(live_turn, dict) else {},
                campaign_dir=camp,
                last_player_text=player_text,
                play_language=play_language,
                recent_narrations=recent_narrations,
                narrator_runner=narrator_path,
                timeout_s=timeout_s,
            )
            invocation_rows.append(
                _invocation_row(
                    run_dir=out,
                    role="narrator",
                    runner_path=narrator_path,
                    attempt=len(
                        [r for r in invocation_rows if r.get("role") == "narrator"]
                    )
                    + 1,
                    outcome=str(narrator_outcome.get("outcome")),
                    model_identity=narrator_outcome.get("model_identity"),
                    response_mode=narrator_outcome.get("response_mode"),
                    fallback_kind=narrator_outcome.get("fallback_kind"),
                )
            )
            if method == "llm_narrator":
                used_llm_narrator = True
            if fallback is not None:
                fallback_turns += 1
                projected["narrator_fallback"] = fallback
            narration_block = dict(projected.get("narration") or {})
            narration_block["final_text"] = keeper_text
            narration_block["method"] = method
            projected["narration"] = narration_block
            # Keep live_turn in sync for any runtime mapper consumers.
            if isinstance(live_turn, dict):
                live_narration = dict(live_turn.get("narration") or {})
                live_narration["final_text"] = keeper_text
                live_narration["method"] = method
                live_turn["narration"] = live_narration
            turns.append(projected)
            last_turn = projected
            if current_ids:
                previous_affordance_ids = current_ids
            transcript_tail.append({"role": "keeper", "text": keeper_text})
            recent_narrations.append(keeper_text)
            if len(recent_narrations) > 2:
                recent_narrations = recent_narrations[-2:]

        world_after = _read_json(camp / "save" / "world-state.json", {})
        turn_terminal = coc_scene_graph.terminal_evidence(
            story, world_after, live_result
        )
        if turn_terminal["session_ending"]:
            stop_reason = "session_ending"
            break
        pending_after = live_turn_runner.subsystem_executor.get_current_pending_choice(camp)
        if (
            isinstance(pending_after, dict)
            and pending_after.get("responder") == "keeper"
        ):
            continue
        current_playability = investigator_playability(camp, investigator_id)
        playability_stop = _playability_stop_reason(current_playability)
        if playability_stop:
            stop_reason = playability_stop
            pending = current_playability.get("pending_resolution")
            pending_resolution = dict(pending) if isinstance(pending, dict) else None
            break

    world_final = _read_json(camp / "save" / "world-state.json", {})
    discovered_final = world_final.get("discovered_clue_ids", [])
    current_playability = investigator_playability(camp, investigator_id)
    if pending_resolution is None:
        pending = current_playability.get("pending_resolution")
        pending_resolution = dict(pending) if isinstance(pending, dict) else None
    ending_evidence = coc_scene_graph.terminal_evidence(story, world_final, turns)
    clue_graph = _read_json(camp / "scenario" / "clue-graph.json", {"conclusions": []})
    total_clues: set[str] = set()
    for concl in clue_graph.get("conclusions", []) if isinstance(clue_graph, dict) else []:
        for cl in concl.get("clues", []) if isinstance(concl, dict) else []:
            if isinstance(cl, dict) and cl.get("clue_id"):
                total_clues.add(str(cl["clue_id"]))
    session_result: dict[str, Any] = {
        "turns": turns,
        "final_state": {
            "active_scene": world_final.get("active_scene_id"),
            "discovered_clues": discovered_final,
            "tension": _read_json(camp / "save" / "pacing-state.json", {}).get(
                "tension_level"
            ),
        },
        "clue_coverage": {
            "discovered_count": len(discovered_final) if isinstance(discovered_final, list) else 0,
            "total_in_graph": len(total_clues),
            "discovered": discovered_final,
        },
        "tension_curve": tension_curve,
        "scene_path": scene_path,
        "reached_terminal": ending_evidence["reached_terminal"],
        "terminal_evidence": ending_evidence,
        "investigator_playability": current_playability,
        "pipeline": "run_live_turn",
        "stop_reason": stop_reason,
        "player_turn_count": len(player_turns),
    }
    if pending_resolution is not None:
        session_result["pending_resolution"] = pending_resolution

    # Enrich play record with structured fields adherence evaluation consumes.
    if isinstance(world_final, dict):
        visited = world_final.get("visited_scene_ids") or scene_path
        session_result["visited_scene_ids"] = (
            list(visited) if isinstance(visited, list) else list(scene_path)
        )
        session_result["discovered_clue_ids"] = (
            list(discovered_final) if isinstance(discovered_final, list) else []
        )
    threat_state = _read_json(camp / "save" / "threat-state.json", {})
    if isinstance(threat_state, dict) and isinstance(threat_state.get("clocks"), dict):
        session_result["clocks"] = threat_state["clocks"]
        session_result["threat_state"] = threat_state

    # Narration method: llm_narrator when at least one turn used the bridge.
    if narrator_path is not None and used_llm_narrator:
        narration_method = "llm_narrator"
    else:
        narration_method = "template"

    # Fail-open narrative adherence (SENNA checklist) when scenario dir resolves.
    narrative_adherence = None
    scenario_dir = camp / "scenario"
    if coc_adherence is not None and scenario_dir.is_dir():
        try:
            narrative_adherence = coc_adherence.compute_adherence_for_scenario(
                scenario_dir, session_result
            )
        except Exception:
            narrative_adherence = None

    metadata_extra: dict[str, Any] = {
        "run_id": out.name,
        "stop_reason": stop_reason,
        "module_coverage": scene_path,
        "scenario": (
            (module_meta.get("title") if isinstance(module_meta, dict) else None)
            or (campaign_meta.get("title") if isinstance(campaign_meta, dict) else None)
            or campaign_id
        ),
        "scenario_id": (
            (module_meta.get("scenario_id") if isinstance(module_meta, dict) else None)
            or (campaign_meta.get("scenario_id") if isinstance(campaign_meta, dict) else None)
            or (campaign_meta.get("active_scenario_id") if isinstance(campaign_meta, dict) else None)
            or campaign_id
        ),
        "play_language": play_language,
        "narration_method": narration_method,
        "fallback_turns": fallback_turns,
        "narrator_configured": narrator_path is not None,
    }
    if narrative_adherence is not None:
        metadata_extra["narrative_adherence"] = narrative_adherence

    metadata = _match_metadata(
        user_claimed_live=live,
        campaign_id=campaign_id,
        extra=metadata_extra,
    )
    # Package the run without rendering yet: evidence.json must exist before the
    # first battle-report readout consumes these artifacts.
    battle_path = playtest_driver.write_playtest_artifacts(
        out,
        camp,
        char_path,
        investigator_id,
        player_choices,
        session_result,
        metadata=metadata,
        generate_report=False,
    )
    _enrich_transcript_with_player_notes(out, player_turns)
    # Caller evidence_provenance is deliberately non-authoritative.  Trust,
    # identities, observed model use, and counts come only from this ledger.
    _ = evidence_provenance
    invocation_ledger_path = _write_invocation_ledger(out, invocation_rows)
    target_log_dir = (
        out / "sandbox" / ".coc" / "campaigns" / campaign_id / "logs"
    )
    event_log_paths = [
        path.resolve().relative_to(out.resolve()).as_posix()
        for path in sorted(target_log_dir.glob("*.jsonl"))
        if path.is_file()
    ]
    evidence_receipt = playtest_evidence.build_evidence_receipt(
        out,
        {
            "started_at": started_at,
            "ended_at": _utc_timestamp(),
            "user_claimed_live": bool(live),
            "transcript_path": "transcript.jsonl",
            "invocation_ledger_path": invocation_ledger_path.name,
            "event_log_paths": event_log_paths,
        },
    )
    evidence_path = playtest_evidence.write_evidence_receipt(out, evidence_receipt)
    evidence_receipt = playtest_evidence.read_evidence_receipt(out)
    receipt_runners = evidence_receipt.get("runners") or {}
    receipt_player = receipt_runners.get("player") or {}
    receipt_narrator = receipt_runners.get("narrator") or {}
    eligible = evidence_receipt.get("eligible_as_gameplay_evidence") is True
    fallback_turns = int(evidence_receipt.get("fallback_turns") or 0)
    metadata.update(
        {
            "runner_kind": receipt_player.get("kind") or "unknown",
            "narrator_runner_kind": receipt_narrator.get("kind") or "absent",
            "eligible_as_gameplay_evidence": eligible,
            "evidence_reasons": list(evidence_receipt.get("evidence_reasons") or []),
            "external_model_turns": evidence_receipt.get("external_model_turns", 0),
            "fallback_turns": fallback_turns,
        }
    )
    if eligible:
        metadata.update(
            {
                "audit_profile": "evidence_grade_player_bridge_match",
                "player_profile": "attested_external_model_bridge",
                "simulation_method": "attested_external_model_playtest",
                "evidence_disclaimer": "Gameplay evidence eligibility verified from evidence.json.",
                "future_enhancements": [],
            }
        )

    # Re-stamp playtest.json in case write_playtest_artifacts setdefault'd differently.
    playtest_path = out / "playtest.json"
    stamped = _read_json(playtest_path, {})
    if not isinstance(stamped, dict):
        stamped = {}
    stamped.pop("live", None)
    stamped.update(metadata)
    stamped.update(
        {
            "stop_reason": stop_reason,
            "investigator_playability": current_playability,
            "pending_resolution": pending_resolution,
            "terminal_evidence": ending_evidence,
            "reached_terminal": ending_evidence["reached_terminal"],
            "narration_method": narration_method,
            "fallback_turns": fallback_turns,
        }
    )
    if narrative_adherence is not None:
        stamped["narrative_adherence"] = narrative_adherence
    playtest_path.write_text(
        json.dumps(stamped, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (out / "player-requests.json").write_text(
        json.dumps(player_requests, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (out / "match-result.json").write_text(
        json.dumps(
            {
                **session_result,
                "simulation_method": metadata["simulation_method"],
                "runner_kind": metadata["runner_kind"],
                "user_claimed_live": bool(live),
                "eligible_as_gameplay_evidence": eligible,
                "evidence_reasons": metadata["evidence_reasons"],
                "narration_method": narration_method,
                "fallback_turns": fallback_turns,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    # This is deliberately the first report generation for the run.
    battle_path = playtest_report.generate_battle_report(out)

    return {
        "run_dir": str(out),
        "battle_report_path": str(battle_path),
        "evidence_path": str(evidence_path),
        "evidence": evidence_receipt,
        "turns": turns,
        "player_turns": player_turns,
        "player_requests": player_requests,
        "player_choices": player_choices,
        "metadata": metadata,
        "result": session_result,
        "stop_reason": stop_reason,
        "investigator_playability": current_playability,
        "pending_resolution": pending_resolution,
        "terminal_evidence": ending_evidence,
        "narration_method": narration_method,
        "fallback_turns": fallback_turns,
    }


def _main() -> int:
    ap = argparse.ArgumentParser(
        description="Live LLM-player vs KP match harness (N5)"
    )
    ap.add_argument("--workspace", required=True, help="workspace root containing .coc/")
    ap.add_argument("--campaign", required=True, dest="campaign_id")
    ap.add_argument("--investigator", default="inv1", dest="investigator_id")
    ap.add_argument("--runner", required=True, help="player-brain runner executable or .mjs")
    ap.add_argument(
        "--narrator-runner",
        default=None,
        help="optional KP narrator runner (.mjs or fake executable)",
    )
    ap.add_argument("--max-turns", type=int, default=20)
    ap.add_argument("--rng-seed", default=None)
    ap.add_argument(
        "--live",
        action="store_true",
        help="record a user claim that this is live; does not attest evidence eligibility",
    )
    ap.add_argument("--character", default=None, help="override character.json path")
    ap.add_argument("--run-dir", default=None, help="output playtest directory")
    ap.add_argument("--intent-class", default=None, help="optional intent_class override")
    ap.add_argument("--timeout", type=float, default=300)
    args = ap.parse_args()

    rng_seed: int | str | None = args.rng_seed
    if rng_seed is not None:
        try:
            rng_seed = int(rng_seed)
        except ValueError:
            pass

    result = run_live_match(
        args.workspace,
        args.campaign_id,
        args.investigator_id,
        player_runner=args.runner,
        max_turns=args.max_turns,
        rng_seed=rng_seed,
        live=bool(args.live),
        character_path=args.character,
        run_dir=args.run_dir,
        intent_class=args.intent_class,
        timeout_s=args.timeout,
        narrator_runner=args.narrator_runner,
    )
    print(f"stop_reason: {result['stop_reason']}")
    print(f"player_turns: {len(result['player_turns'])}")
    print(f"kp_turns: {len(result['turns'])}")
    print(f"battle_report: {result['battle_report_path']}")
    print(f"simulation_method: {result['metadata']['simulation_method']}")
    print(f"narration_method: {result.get('narration_method')}")
    print(f"fallback_turns: {result.get('fallback_turns')}")
    print(
        "eligible_as_gameplay_evidence: "
        f"{result['metadata']['eligible_as_gameplay_evidence']}"
    )
    print(f"evidence: {result['evidence_path']}")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
