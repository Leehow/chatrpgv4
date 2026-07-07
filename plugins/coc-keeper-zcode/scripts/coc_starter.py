#!/usr/bin/env python3
"""Loader for built-in starter scenarios.

Starter scenarios are pre-packaged, play-ready scenarios shipped with the
plugin under `references/starter-scenarios/<id>/`. They let new players
start a game with zero PDF preparation.

`install_starter` copies the seven story-graph JSON files (plus
pregen-investigators.json) into a campaign's `scenario/` directory, which is
the only location the runtime Story Director reads
(`coc_story_director.py:95`). The campaign.json is updated with
active_scenario_id/era.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

PLUGIN_ROOT = SCRIPT_DIR.parent
STARTER_DIR = PLUGIN_ROOT / "references" / "starter-scenarios"
import coc_state

# The seven story-graph JSON files the Story Director reads (see
# coc_story_director.py:95-183). Pregen-investigators.json is copied
# alongside but is not a director-read file.
STARTER_SCENARIO_FILES = (
    "module-meta.json",
    "story-graph.json",
    "clue-graph.json",
    "npc-agendas.json",
    "threat-fronts.json",
    "pacing-map.json",
    "improvisation-boundaries.json",
)


def list_starter_scenarios() -> list[dict[str, Any]]:
    """Enumerate built-in starter scenarios from their module-meta.json files.

    Returns one dict per starter: scenario_id, title, one_liner,
    structure_type, era, content_flags.
    """
    out: list[dict[str, Any]] = []
    if not STARTER_DIR.is_dir():
        return out
    for child in sorted(STARTER_DIR.iterdir()):
        meta_path = child / "module-meta.json"
        if not meta_path.is_file():
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        out.append(
            {
                "scenario_id": meta["scenario_id"],
                "title": meta["title"],
                "one_liner": meta.get("one_liner", ""),
                "structure_type": meta["structure_type"],
                "era": meta["era"],
                "content_flags": meta.get("content_flags", []),
            }
        )
    return out


def install_starter(root: Path, campaign_id: str, scenario_id: str) -> Path:
    """Copy a starter scenario into a campaign's scenario/ directory.

    Idempotency: raises FileExistsError if the campaign already has any of
    the seven story-graph files (i.e. a scenario is already bound).
    Raises FileNotFoundError if the starter scenario_id is unknown.
    Returns the scenario directory path.
    """
    src_dir = STARTER_DIR / scenario_id
    if not src_dir.is_dir():
        raise FileNotFoundError(f"unknown starter scenario: {scenario_id}")

    coc_root = _coc_root(root)
    campaign_dir = coc_root / "campaigns" / campaign_id
    if not campaign_dir.is_dir():
        raise FileNotFoundError(f"unknown campaign: {campaign_id}")

    scenario_dir = campaign_dir / "scenario"
    # Idempotency: refuse to clobber an existing scenario.
    for fname in STARTER_SCENARIO_FILES:
        if (scenario_dir / fname).exists():
            raise FileExistsError(
                f"campaign {campaign_id} already has scenario file {fname}; "
                " refusing to overwrite. Remove it first to re-install."
            )

    for fname in STARTER_SCENARIO_FILES:
        shutil.copy2(src_dir / fname, scenario_dir / fname)
    # Pregen investigators (optional, not director-read).
    pregen_src = src_dir / "pregen-investigators.json"
    if pregen_src.is_file():
        shutil.copy2(pregen_src, scenario_dir / "pregen-investigators.json")

    _update_campaign_json(campaign_dir, scenario_id)
    _activate_scenario(campaign_dir, scenario_dir, scenario_id)
    return scenario_dir


def _activate_scenario(campaign_dir: Path, scenario_dir: Path, scenario_id: str) -> None:
    """Flip world-state.json from setup to active so the Story Director can run.

    install_starter copies scenario files and updates campaign.json, but the
    Director reads active_scene_id from save/world-state.json. Without
    activation, world-state stays at status=setup / active_scene_id=null and
    the Director spins on empty turns (it cannot resolve a scene). This sets
    scenario_id, status=active, active_subsystem=play, and active_scene_id to
    the first scene in story-graph.json — matching how a bound scenario is
    expected to look at the start of play.
    """
    world_path = campaign_dir / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8")) if world_path.is_file() else {}
    story_graph = json.loads((scenario_dir / "story-graph.json").read_text(encoding="utf-8"))
    scenes = story_graph.get("scenes", [])
    first_scene = scenes[0]["scene_id"] if scenes else None
    world["scenario_id"] = scenario_id
    world["status"] = "active"
    world["active_subsystem"] = "play"
    if first_scene:
        world["active_scene_id"] = first_scene
    world["updated_at"] = _now_iso()
    world_path.write_text(
        json.dumps(world, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def _coc_root(root: Path) -> Path:
    # Mirror coc_state.coc_root: if `root` already ends in .coc, use it;
    # otherwise treat it as the workspace root containing `.coc/`.
    root = Path(root)
    if root.name == ".coc":
        return root
    return root / ".coc"


def _update_campaign_json(campaign_dir: Path, scenario_id: str) -> None:
    campaign_path = campaign_dir / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["active_scenario_id"] = scenario_id
    # Align era with the scenario's module-meta if present.
    meta_path = STARTER_DIR / scenario_id / "module-meta.json"
    if meta_path.is_file():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        campaign["era"] = meta.get("era", campaign.get("era", "1920s"))
    else:
        meta = {}
    campaign["updated_at"] = _now_iso()
    campaign_path.write_text(
        json.dumps(campaign, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    coc_state.reset_campaign_time_state(
        campaign_dir,
        str(campaign.get("campaign_id") or campaign_dir.name),
        era=str(campaign.get("era") or "1920s"),
        start_clock=meta.get("start_clock") if isinstance(meta.get("start_clock"), dict) else None,
    )


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="List or install built-in starter scenarios.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="list available starter scenarios")

    inst = sub.add_parser("install", help="install a starter scenario into a campaign")
    inst.add_argument("--campaign", required=True)
    inst.add_argument("--scenario", required=True)
    inst.add_argument("--root", default=".coc", help="path to .coc workspace")

    args = parser.parse_args(argv)

    if args.cmd == "list":
        for s in list_starter_scenarios():
            print(f"{s['scenario_id']}\t{s['title']}\t{s['one_liner']}")
        return 0
    if args.cmd == "install":
        path = install_starter(Path(args.root), args.campaign, args.scenario)
        print(f"installed {args.scenario} -> {path}")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
