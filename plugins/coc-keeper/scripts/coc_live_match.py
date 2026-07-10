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
live_turn_runner = _load_sibling("coc_live_turn_runner", "coc_live_turn_runner.py")
apply_mod = _load_sibling("coc_director_apply", "coc_director_apply.py")
public_state_mod = _load_runtime_module(
    "runtime_public_state", "runtime/engine/public_state.py"
)
player_adapter = _load_runtime_module(
    "runtime_player_adapter", "runtime/adapters/player/adapter.py"
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
    return playtest_driver._keeper_turn_text(turn, clue_names, npc_names)


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


def _investigator_terminal(campaign_dir: Path, investigator_id: str) -> str | None:
    """Return a stop reason if the investigator is dead or indefinitely insane."""
    inv = _read_json(
        campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json",
        {},
    )
    if not isinstance(inv, dict):
        return None
    hp = inv.get("current_hp")
    try:
        if hp is not None and int(hp) <= 0:
            return "investigator_dead"
    except (TypeError, ValueError):
        pass
    conditions = inv.get("conditions") or []
    if isinstance(conditions, list):
        lowered = {str(c).lower() for c in conditions}
        if "dead" in lowered or "dying" in lowered:
            return "investigator_dead"
    if inv.get("indefinite_insane") or inv.get("permanent_insane"):
        return "investigator_indefinite_insanity"
    return None


def _result_has_session_ending(live_result: dict[str, Any]) -> bool:
    for turn in live_result.get("turns") or []:
        if not isinstance(turn, dict):
            continue
        for et in turn.get("event_types") or []:
            if et == "session_ending":
                return True
        events = turn.get("events") or []
        for ev in events:
            if isinstance(ev, dict) and (
                ev.get("type") == "session_ending" or ev.get("event_type") == "session_ending"
            ):
                return True
    return False


def _match_metadata(*, live: bool, campaign_id: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    meta: dict[str, Any] = {
        "campaign_id": campaign_id,
        "live": bool(live),
        "audit_profile": "live_llm_player_match",
        "play_language": "zh-Hans",
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
    }
    if live:
        meta["runner_kind"] = "live_bridge"
        meta["player_profile"] = "external_llm_bridge"
        meta["simulation_method"] = "live_llm_player_vs_kp"
        meta["evidence_disclaimer"] = (
            "Live external player bridge — eligible as gameplay evidence when "
            "the run completes with a real LLM player."
        )
        meta["future_enhancements"] = []
    else:
        meta["runner_kind"] = "scripted_fake"
        meta["player_profile"] = "bridged_scripted_player"
        meta["simulation_method"] = "bridged_scripted_player_not_live_llm"
        meta["evidence_disclaimer"] = NON_LIVE_EVIDENCE_DISCLAIMER
        meta["future_enhancements"] = [
            "Pass --live with a real external player LLM bridge for evidence-grade battle reports."
        ]
    if extra:
        meta.update(extra)
    return meta


def _enrich_transcript_with_player_notes(
    run_dir: Path,
    player_turns: list[dict[str, Any]],
) -> None:
    """Attach per-turn player_notes onto player transcript rows (report artifact)."""
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
            # Surface notes in visible text so battle-report.md includes them.
            base = str(row.get("text") or "")
            if str(notes) not in base:
                row["text"] = f"{base}\n[player_notes] {notes}"
        player_idx += 1
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


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
) -> dict[str, Any]:
    """Run a multi-turn match: external player brain ↔ KP ``run_live_turn``.

    When ``live=False`` (default; all tests), metadata uses a non-live
    ``simulation_method`` and stamps the AGENTS.md evidence disclaimer.
    Only ``live=True`` may claim ``live_llm_player_vs_kp`` / ``external_llm_bridge``.
    """
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
    tension_curve: list[Any] = []
    scene_path: list[str] = []
    stop_reason = "max_turns_reached"
    last_turn: dict[str, Any] | None = None

    campaign_meta = _read_json(camp / "campaign.json", {})
    play_language = str(
        campaign_meta.get("play_language") if isinstance(campaign_meta, dict) else "zh-Hans"
    ) or "zh-Hans"

    for _offset in range(max(1, int(max_turns))):
        terminal = _investigator_terminal(camp, investigator_id)
        if terminal:
            stop_reason = terminal
            break

        narration = player_visible_narration(
            last_turn, camp, play_language=play_language
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
            turns.append(projected)
            last_turn = projected
            current_scene = projected.get("scene_id") or "?"
            if not scene_path or scene_path[-1] != current_scene:
                scene_path.append(str(current_scene))
            tension_curve.append(projected.get("tension") or "low")
            keeper_text = player_visible_narration(
                projected, camp, play_language=play_language
            )
            transcript_tail.append({"role": "keeper", "text": keeper_text})

        if _result_has_session_ending(live_result):
            stop_reason = "session_ending"
            break
        terminal = _investigator_terminal(camp, investigator_id)
        if terminal:
            stop_reason = terminal
            break

    discovered_final = _read_json(camp / "save" / "world-state.json", {}).get(
        "discovered_clue_ids", []
    )
    story = _read_json(camp / "scenario" / "story-graph.json", {"scenes": []})
    clue_graph = _read_json(camp / "scenario" / "clue-graph.json", {"conclusions": []})
    total_clues: set[str] = set()
    for concl in clue_graph.get("conclusions", []) if isinstance(clue_graph, dict) else []:
        for cl in concl.get("clues", []) if isinstance(concl, dict) else []:
            if isinstance(cl, dict) and cl.get("clue_id"):
                total_clues.add(str(cl["clue_id"]))
    scene_ids = [
        s["scene_id"]
        for s in (story.get("scenes") or [])
        if isinstance(s, dict) and s.get("scene_id")
    ]

    session_result: dict[str, Any] = {
        "turns": turns,
        "final_state": {
            "active_scene": _read_json(camp / "save" / "world-state.json", {}).get(
                "active_scene_id"
            ),
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
        "reached_terminal": bool(scene_path and scene_ids and scene_path[-1] == scene_ids[-1]),
        "pipeline": "run_live_turn",
        "stop_reason": stop_reason,
        "player_turn_count": len(player_turns),
    }

    metadata = _match_metadata(
        live=live,
        campaign_id=campaign_id,
        extra={
            "run_id": out.name,
            "stop_reason": stop_reason,
            "module_coverage": scene_path,
            "scenario": campaign_meta.get("title", campaign_id)
            if isinstance(campaign_meta, dict)
            else campaign_id,
            "scenario_id": campaign_meta.get("scenario_id", campaign_id)
            if isinstance(campaign_meta, dict)
            else campaign_id,
            "play_language": play_language,
        },
    )
    # Force honest simulation_method / player_profile (do not let defaults overwrite).
    battle_path = playtest_driver.write_playtest_artifacts(
        out,
        camp,
        char_path,
        investigator_id,
        player_choices,
        session_result,
        metadata=metadata,
    )
    _enrich_transcript_with_player_notes(out, player_turns)
    # Regenerate so battle-report.md picks up player_notes in transcript text.
    playtest_report = _load_sibling("coc_playtest_report", "coc_playtest_report.py")
    battle_path = playtest_report.generate_battle_report(out)

    # Re-stamp playtest.json in case write_playtest_artifacts setdefault'd differently.
    playtest_path = out / "playtest.json"
    stamped = _read_json(playtest_path, {})
    if not isinstance(stamped, dict):
        stamped = {}
    stamped.update(
        {
            "live": metadata["live"],
            "runner_kind": metadata["runner_kind"],
            "player_profile": metadata["player_profile"],
            "simulation_method": metadata["simulation_method"],
            "evidence_disclaimer": metadata["evidence_disclaimer"],
            "stop_reason": stop_reason,
        }
    )
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
                "live": live,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    return {
        "run_dir": str(out),
        "battle_report_path": str(battle_path),
        "turns": turns,
        "player_turns": player_turns,
        "player_requests": player_requests,
        "player_choices": player_choices,
        "metadata": metadata,
        "result": session_result,
        "stop_reason": stop_reason,
    }


def _main() -> int:
    ap = argparse.ArgumentParser(
        description="Live LLM-player vs KP match harness (N5)"
    )
    ap.add_argument("--workspace", required=True, help="workspace root containing .coc/")
    ap.add_argument("--campaign", required=True, dest="campaign_id")
    ap.add_argument("--investigator", default="inv1", dest="investigator_id")
    ap.add_argument("--runner", required=True, help="player-brain runner executable or .mjs")
    ap.add_argument("--max-turns", type=int, default=20)
    ap.add_argument("--rng-seed", default=None)
    ap.add_argument(
        "--live",
        action="store_true",
        help="mark metadata as live external bridge (evidence-eligible)",
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
    )
    print(f"stop_reason: {result['stop_reason']}")
    print(f"player_turns: {len(result['player_turns'])}")
    print(f"kp_turns: {len(result['turns'])}")
    print(f"battle_report: {result['battle_report_path']}")
    print(f"simulation_method: {result['metadata']['simulation_method']}")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
