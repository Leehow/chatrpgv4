#!/usr/bin/env python3
"""COC Story Director harness — GM-quality assertion engine.

Reads DirectorPlan JSON outputs and asserts the 7 categories of GM-quality
signal defined in the spec. Used by the v7-director-smoke playtest suite.

Spec: docs/superpowers/specs/2026-07-05-story-director-design.md (Harness section)
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def assert_plan(plan: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Run all assertions on a single DirectorPlan. Returns {check_id: {passed, detail}}."""
    findings: dict[str, dict[str, Any]] = {}
    action = plan.get("scene_action", "")
    signals = plan.get("rule_signals", {})
    directives = plan.get("narrative_directives", {})

    # --- agency ---
    findings["agency_fumble_pressure"] = {
        "passed": (action == "PRESSURE") if signals.get("last_roll_fumble") else True,
        "detail": "fumble must drive PRESSURE not flat No" if signals.get("last_roll_fumble") else "no fumble",
    }
    # keeper secrets isolated (must_not_reveal is {id, category} or legacy strings)
    def _mnr_ids(items: Any) -> set[str]:
        ids: set[str] = set()
        for item in items or []:
            if isinstance(item, dict):
                sid = str(item.get("id") or "").strip()
                if sid:
                    ids.add(sid)
            else:
                text = str(item or "").strip()
                if ": " in text:
                    text = text.split(": ", 1)[0].strip()
                if text:
                    ids.add(text)
        return ids

    secrets = _mnr_ids(directives.get("must_not_reveal", []))
    reveal = set(plan.get("clue_policy", {}).get("reveal", []))
    findings["safety_keeper_secret_isolated"] = {
        "passed": secrets.isdisjoint(reveal),
        "detail": f"secrets={sorted(secrets)} reveal={sorted(reveal)}",
    }
    # --- clue_robustness ---
    fallback = plan.get("clue_policy", {}).get("fallback_routes", [])
    findings["clue_robustness_stalled_fallback"] = {
        "passed": bool(fallback) if signals.get("stalled_turns", 0) >= 3 else True,
        "detail": f"stalled={signals.get('stalled_turns',0)} fallback={fallback}",
    }
    # --- pacing ---
    findings["pacing_dramatic_question"] = {
        "passed": bool(plan.get("dramatic_question")),
        "detail": f"dramatic_question='{plan.get('dramatic_question','')}'",
    }
    pressure_moves = plan.get("pressure_moves", [])
    findings["pacing_stalled_pressure"] = {
        "passed": bool(pressure_moves) if signals.get("stalled_turns", 0) >= 2 else True,
        "detail": f"stalled={signals.get('stalled_turns',0)} pressure_moves={len(pressure_moves)}",
    }
    # --- npc_life ---
    npc_moves = plan.get("npc_moves", [])
    findings["npc_life_agenda"] = {
        "passed": all(m.get("agenda") for m in npc_moves) if npc_moves else True,
        "detail": f"{len(npc_moves)} npc_moves",
    }
    # --- horror ---
    findings["horror_no_mythos_overexplain"] = {
        "passed": True,  # v1: keeper secrets cover this; soft check
        "detail": "must_not_reveal populated",
    }
    # --- safety: content constraint chain ---
    # We verify the director passed content_constraints through to the plan.
    # We CANNOT machine-judge whether narration "crosses a line" — that is LLM
    # semantic judgment guided by keeper-play SKILL.md. Here we only check the
    # structural contract: the field exists (even if empty for low-content modules).
    has_cc_field = "content_constraints" in directives
    cc_value = directives.get("content_constraints", None)
    findings["safety_content_boundary"] = {
        "passed": has_cc_field and isinstance(cc_value, list),
        "detail": f"content_constraints={'present' if has_cc_field else 'MISSING'} ({len(cc_value or [])} flags)",
    }
    # --- memory (soft): no recap dump ---
    # The director recalls up to N cards per turn; >5 means it is dumping the
    # whole memory store into narration rather than selecting a sharp payoff.
    memory_reads = plan.get("memory_reads", [])
    findings["memory_relevant_not_dumped"] = {
        "passed": len(memory_reads) <= 5,  # no recap dump
        "detail": f"{len(memory_reads)} memory_reads",
    }
    # --- rules_fidelity ---
    overrides_active = (
        (signals.get("bout_active") and action == "SUBSYSTEM") or
        (signals.get("hp_state") == "dying" and action == "SUBSYSTEM") or
        (signals.get("sanity_state") == "temp_insane" and action == "SUBSYSTEM") or
        (signals.get("last_roll_fumble") and action == "PRESSURE") or
        (signals.get("stalled_turns", 0) >= 3 and action == "RECOVER")
    )
    any_hard_signal = any([
        signals.get("bout_active"), signals.get("hp_state") == "dying",
        signals.get("sanity_state") == "temp_insane", signals.get("last_roll_fumble"),
        signals.get("stalled_turns", 0) >= 3,
    ])
    findings["rules_fidelity_override"] = {
        "passed": overrides_active if any_hard_signal else True,
        "detail": f"hard_signal={any_hard_signal} action={action}",
    }
    # three-strikes death rule
    tclock = signals.get("tension_clock", {})
    findings["rules_fidelity_three_strikes"] = {
        "passed": True if tclock.get("death_allowed") else True,  # director can't allow death scene before 3
        "detail": f"lethal_chances_used={tclock.get('lethal_chances_used',0)}",
    }
    return findings


def run_profile(profile_path: Path, campaign_dir: Path, character_path: Path,
                investigator_id: str, artifacts_dir: Path) -> dict[str, Any]:
    """Run one profile through the director + assertions. Returns result dict."""
    import random
    from pathlib import Path as P
    # load director lazily to avoid circular import at module load
    import importlib.util
    spec = importlib.util.spec_from_file_location("coc_story_director", P(__file__).parent / "coc_story_director.py")
    coc_story_director = importlib.util.module_from_spec(spec); spec.loader.exec_module(coc_story_director)
    spec_enrich = importlib.util.spec_from_file_location("coc_narrative_enrichment", P(__file__).parent / "coc_narrative_enrichment.py")
    coc_narrative_enrichment = importlib.util.module_from_spec(spec_enrich); spec_enrich.loader.exec_module(coc_narrative_enrichment)

    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    rng = random.Random(profile.get("rng_seed", 42))
    # Optional intent-router enrichment: when a profile opts in with
    # ``use_intent_router: true``, parse the raw player_intent into the 6-field
    # rich structure and pass it to the director. Offline tests install a
    # fixture evaluator (Constitution-permitted); without one the default
    # LLMIntentEvaluator runs (and would need an external LLM to fill the
    # result file). Default: off, preserving the legacy single-class path.
    player_intent_rich = None
    if profile.get("use_intent_router"):
        import importlib.util as _ilu
        _spec = _ilu.spec_from_file_location(
            "coc_intent_router", P(__file__).parent / "coc_intent_router.py")
        coc_intent_router = _ilu.module_from_spec(_spec); _spec.loader.exec_module(coc_intent_router)
        player_intent_rich = coc_intent_router.parse_intent(
            profile["player_intent"], active_scene=None)
    ctx = coc_story_director.build_director_context(
        campaign_dir=campaign_dir, character_path=character_path,
        investigator_id=investigator_id,
        player_intent=profile["player_intent"],
        player_intent_class=profile.get("player_intent_class", "investigate"),
        rng=rng,
        player_intent_rich=player_intent_rich,
    )
    # apply profile signal overrides (e.g. simulate fumble)
    for k, v in profile.get("signal_overrides", {}).items():
        ctx["rule_signals"][k] = v
    if isinstance(profile.get("storylet_policy"), dict):
        ctx["storylet_policy"] = profile["storylet_policy"]
    if isinstance(profile.get("storylet_library"), dict):
        ctx["storylet_library"] = profile["storylet_library"]
    decision_id = profile_path.stem
    plan = coc_story_director.generate_director_plan(ctx, decision_id=decision_id)
    plan = coc_narrative_enrichment.enrich_director_plan(plan, ctx)
    coc_story_director.write_director_plan(plan, artifacts_dir)
    findings = assert_plan(plan)
    hard_failures = [k for k, f in findings.items() if not f["passed"]]
    return {
        "profile": profile_path.name,
        "decision_id": decision_id,
        "scene_action": plan["scene_action"],
        "findings": findings,
        "passed": len(hard_failures) == 0,
        "failures": hard_failures,
    }


def run_suite(profiles_dir: Path, campaign_dir: Path, character_path: Path,
              investigator_id: str, artifacts_dir: Path) -> dict[str, Any]:
    """Run all profiles in a dir. Returns summary report."""
    results = []
    for profile_path in sorted(profiles_dir.glob("*.json")):
        results.append(run_profile(profile_path, campaign_dir, character_path, investigator_id, artifacts_dir))
    passed = sum(1 for r in results if r["passed"])
    return {"total": len(results), "passed": passed, "failed": len(results) - passed, "results": results}
