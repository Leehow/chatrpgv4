#!/usr/bin/env python3
"""Capture a deterministic Director decision baseline (slice D4).

Slice D5 changes doctrine values. Before that is safe, there must be a
recorded "before": what the Director actually decides on a real settled
campaign, across a matrix of intents and pacing states.

Scope, stated plainly: this is the **Director decision** baseline, not a
whole-turn baseline. ``build_director_context`` and ``select_action`` are pure
deterministic functions over a campaign checkpoint, so this captures them
exactly and reproducibly with no model in the loop. It proves Director
determinism and gives D5 its comparison set. It does NOT prove end-to-end turn
behaviour or play quality — that is what a DebugExperiment ``production`` lane
is for, and it is recorded separately.

Usage:
    python scripts/gen_director_decision_baseline.py <campaign-id> [--check]

``--check`` recomputes and compares against the committed baseline instead of
writing it, which is how the determinism gate runs in tests.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
# checks/ is the repository's home for committed authoritative snapshots
# (see checks/rulebook-*-ref.json); artifacts/ is gitignored and would lose
# the baseline this slice exists to preserve.
BASELINE = ROOT / "checks" / "director-decision-baseline.json"

INTENT_CLASSES = (
    "investigate", "social", "move", "idle", "ambiguous", "stuck",
    "montage", "combat", "flee", "cast",
)
RISK_POSTURES = ("neutral", "reckless", "cautious")
PACING_STATES = (
    {"label": "calm", "stalled_turns": 0, "low_agency_continue_count": 0},
    {"label": "one-stall", "stalled_turns": 1, "low_agency_continue_count": 0},
    {"label": "two-stall", "stalled_turns": 2, "low_agency_continue_count": 0},
    {"label": "three-stall", "stalled_turns": 3, "low_agency_continue_count": 0},
    {"label": "yielded", "stalled_turns": 0, "low_agency_continue_count": 2},
)


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _director():
    return _load("coc_story_director_baseline", "coc_story_director.py")


def build(campaign_id: str) -> dict:
    director = _director()
    campaign_dir = ROOT / ".coc" / "campaigns" / campaign_id
    party = json.loads((campaign_dir / "party.json").read_text(encoding="utf-8"))
    investigator_id = party["investigator_ids"][0]
    # The guard requires the canonical <coc_root>/investigators/<id>/character.json
    character_path = (
        ROOT / ".coc" / "investigators" / investigator_id / "character.json"
    )

    rows = []
    for pacing in PACING_STATES:
        for intent in INTENT_CLASSES:
            for posture in RISK_POSTURES:
                ctx = director.build_director_context(
                    campaign_dir,
                    character_path,
                    investigator_id,
                    player_intent="baseline probe",
                    player_intent_class=intent,
                    rng=random.Random(0),
                    player_intent_rich={
                        "primary_intent": intent,
                        "risk_posture": posture,
                    },
                )
                # Overlay the pacing state deterministically: these are the
                # signals the migrated thresholds gate on.
                ctx["rule_signals"]["stalled_turns"] = pacing["stalled_turns"]
                ctx["rule_signals"]["low_agency_continue_count"] = (
                    pacing["low_agency_continue_count"]
                )
                ctx["rule_signals"]["scene_pressure_available"] = (
                    pacing["low_agency_continue_count"] >= 2
                )
                action, scores = director.select_action(ctx)
                rows.append({
                    "pacing": pacing["label"],
                    "intent": intent,
                    "risk_posture": posture,
                    "selected_action": action,
                    "scores": {k: v for k, v in sorted(scores.items())},
                })
    return {
        "schema_version": 1,
        "kind": "director-decision-baseline",
        "scope": (
            "Director decision only (build_director_context + select_action). "
            "Not a whole-turn or play-quality baseline."
        ),
        "campaign_id": campaign_id,
        "matrix": {
            "pacing_states": [p["label"] for p in PACING_STATES],
            "intent_classes": list(INTENT_CLASSES),
            "risk_postures": list(RISK_POSTURES),
        },
        "row_count": len(rows),
        "rows": rows,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("campaign_id")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)

    built = build(args.campaign_id)
    if args.check:
        if not BASELINE.is_file():
            print(json.dumps({"ok": False, "reason": "no committed baseline"}))
            return 1
        committed = json.loads(BASELINE.read_text(encoding="utf-8"))
        same = committed == built
        drift = [] if same else [
            f"{c['pacing']}/{c['intent']}/{c['risk_posture']}: "
            f"{c['selected_action']} -> {b['selected_action']}"
            for c, b in zip(committed["rows"], built["rows"])
            if c != b
        ]
        print(json.dumps({"ok": same, "drift": drift[:20]}, indent=2))
        return 0 if same else 1

    BASELINE.parent.mkdir(parents=True, exist_ok=True)
    BASELINE.write_text(
        json.dumps(built, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    actions = {}
    for row in built["rows"]:
        actions[row["selected_action"]] = actions.get(row["selected_action"], 0) + 1
    print(json.dumps({
        "ok": True, "rows": built["row_count"],
        "selected_action_distribution": dict(sorted(actions.items())),
        "out": str(BASELINE.relative_to(ROOT)),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
