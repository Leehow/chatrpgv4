#!/usr/bin/env python3
"""Loader for built-in starter scenarios.

Starter scenarios are pre-packaged, play-ready scenarios shipped with the
plugin under `references/starter-scenarios/<id>/`. They let new players
start a game with zero PDF preparation.

`install_starter` copies the seven story-graph JSON files into a campaign's
`scenario/` directory, which is the only location the runtime Story Director
reads (`coc_story_director.py:95`). It also writes a player-safe character
creation briefing so the player can create their own investigator before play.
The campaign.json is updated with active_scenario_id/era.

`quick_start` (N7) creates a campaign, installs a starter that ships pregens,
copies a chosen pregen into workspace + campaign investigator slots, seeds
investigator-state, and returns ids ready for `run_live_turn`.
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
import coc_fileio
import coc_state
import coc_character_creation_briefing
import coc_investigator_guard

# The seven story-graph JSON files the Story Director reads (see
# coc_story_director.py:95-183).
STARTER_SCENARIO_FILES = (
    "module-meta.json",
    "story-graph.json",
    "clue-graph.json",
    "npc-agendas.json",
    "threat-fronts.json",
    "pacing-map.json",
    "improvisation-boundaries.json",
)

# Structured registry of shipped starter pregens (id → home scenario).
# Used for provenance backfill and dossier scenario-bound filtering — lookup by
# investigator id only, never free-text matching.
KNOWN_STARTER_PREGENS: dict[str, dict[str, str]] = {
    "thomas-hayes": {"scenario_id": "the-haunting"},
    "eleanor-reed": {"scenario_id": "the-haunting"},
}

_ZH_CHARACTERISTICS = {
    "STR": "力量", "CON": "体质", "SIZ": "体型", "DEX": "敏捷",
    "APP": "外貌", "INT": "智力", "POW": "意志", "EDU": "教育",
    "LUCK": "幸运",
}
_ZH_DERIVED = {
    "HP": "生命值", "SAN": "理智", "MP": "魔法值", "MOV": "移动力",
    "DB": "伤害加值", "BUILD": "体格",
}
_ZH_SKILLS = {
    "Accounting": "会计", "Art/Craft (Photography)": "艺术/手艺（摄影）",
    "Charm": "魅惑", "Climb": "攀爬", "Credit Rating": "信用评级",
    "Dodge": "闪避", "Drive Auto": "汽车驾驶", "Fast Talk": "话术",
    "Fighting (Brawl)": "格斗（斗殴）", "Firearms (Handgun)": "射击（手枪）",
    "History": "历史", "Intimidate": "恐吓", "Language (Latin)": "外语（拉丁语）",
    "Language (Own)": "母语（英语）", "Law": "法律", "Library Use": "图书馆使用",
    "Listen": "聆听", "Locksmith": "锁匠", "Occult": "神秘学",
    "Persuade": "说服", "Psychology": "心理学", "Spot Hidden": "侦查",
    "Stealth": "潜行", "Track": "追踪",
}


def ensure_pregen_player_facing_sheet(sheet: dict[str, Any]) -> dict[str, Any]:
    """Build the complete zh-Hans display layer for shipped starter pregens."""
    if not isinstance(sheet, dict) or str(sheet.get("id") or "") not in KNOWN_STARTER_PREGENS:
        return sheet
    if isinstance(sheet.get("player_facing_sheet_zh"), dict):
        return sheet
    out = dict(sheet)
    characteristics = sheet.get("characteristics") if isinstance(sheet.get("characteristics"), dict) else {}
    derived = sheet.get("derived") if isinstance(sheet.get("derived"), dict) else {}
    skills = sheet.get("skills") if isinstance(sheet.get("skills"), dict) else {}
    backstory = sheet.get("backstory") if isinstance(sheet.get("backstory"), dict) else {}
    bound = backstory.get("scenario_bound") if isinstance(backstory.get("scenario_bound"), dict) else {}
    details = [
        {"label": "重要之人", "items": [bound.get("significant_people")]},
        {"label": "重要地点", "items": [bound.get("meaningful_locations")]},
        {"label": "信念", "items": [backstory.get("ideology")]},
        {"label": "珍贵物品", "items": [backstory.get("treasured_possessions")]},
        {"label": "特质", "items": list(backstory.get("traits") or [])},
    ]
    details = [block for block in details if block["items"] and block["items"][0]]
    player_weapons = []
    for weapon in sheet.get("weapons") or []:
        if not isinstance(weapon, dict):
            continue
        player_weapons.append({
            "label": weapon.get("name") or weapon.get("weapon_id"),
            "skill_label": _ZH_SKILLS.get(str(weapon.get("skill")), weapon.get("skill")),
            "damage": weapon.get("damage"),
            "range": weapon.get("range"),
            "ammo_capacity": weapon.get("ammo", "—"),
            "malfunction": weapon.get("malfunction", "—"),
        })
    out["player_facing_sheet_zh"] = {
        "display_name": sheet.get("name"),
        "era": "1920年代",
        "nationality": "美国",
        "occupation": sheet.get("occupation"),
        "characteristics": {
            _ZH_CHARACTERISTICS.get(key, key): {"key": key, "value": value}
            for key, value in characteristics.items()
        },
        "derived": {
            _ZH_DERIVED.get(key, key): value for key, value in derived.items()
        },
        "skills": [
            {
                "key": key,
                "label": _ZH_SKILLS.get(key, key),
                "value": int(value),
                "half": int(value) // 2,
                "fifth": int(value) // 5,
            }
            for key, value in skills.items()
        ],
        "weapons": player_weapons,
        "backstory_summary": bound.get("description"),
        "backstory_details": details,
    }
    return out


def lookup_known_starter_pregen(pregen_id: str) -> dict[str, Any] | None:
    """Return registry entry for a known starter pregen, or None.

    Includes ``scenario_bound_keys`` from the canonical shipped sheet when
    available so dossier rendering can omit legacy flat bound fields.
    """
    key = str(pregen_id or "").strip()
    entry = KNOWN_STARTER_PREGENS.get(key)
    if not entry:
        return None
    result: dict[str, Any] = dict(entry)
    try:
        path = _pregen_character_path(entry["scenario_id"], key)
        sheet = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, FileNotFoundError, json.JSONDecodeError, TypeError, ValueError):
        return result
    if not isinstance(sheet, dict):
        return result
    backstory = sheet.get("backstory") if isinstance(sheet.get("backstory"), dict) else {}
    bound = backstory.get("scenario_bound")
    if isinstance(bound, dict):
        result["scenario_bound_keys"] = [
            str(k) for k, v in bound.items() if v not in (None, "", [], {})
        ]
    if isinstance(backstory.get("scenario_id"), str) and backstory["scenario_id"].strip():
        result["scenario_id"] = backstory["scenario_id"].strip()
    return result


def ensure_pregen_backstory_provenance(sheet: dict[str, Any]) -> dict[str, Any]:
    """Stamp / nest scenario provenance on known starter pregen sheets.

    Custom / unknown investigator ids are returned unchanged. For known starter
    pregens (thomas-hayes, eleanor-reed): stamp ``backstory.scenario_id`` when
    missing, and move legacy flat bound keys into ``scenario_bound`` using the
    canonical shipped sheet as the key list.
    """
    if not isinstance(sheet, dict):
        return sheet
    inv_id = str(sheet.get("id") or "").strip()
    entry = KNOWN_STARTER_PREGENS.get(inv_id)
    if not entry:
        return sheet

    out = dict(sheet)
    backstory = out.get("backstory")
    if not isinstance(backstory, dict):
        backstory = {}
    else:
        backstory = dict(backstory)
    out["backstory"] = backstory

    if not str(backstory.get("scenario_id") or "").strip():
        backstory["scenario_id"] = entry["scenario_id"]

    if isinstance(backstory.get("scenario_bound"), dict) and backstory["scenario_bound"]:
        return out

    # Restructure legacy flat bound fields using canonical scenario_bound keys.
    try:
        canon_path = _pregen_character_path(entry["scenario_id"], inv_id)
        canon = json.loads(canon_path.read_text(encoding="utf-8"))
    except (OSError, FileNotFoundError, json.JSONDecodeError, TypeError, ValueError):
        return out
    canon_bs = canon.get("backstory") if isinstance(canon, dict) else None
    canon_bound = (
        canon_bs.get("scenario_bound")
        if isinstance(canon_bs, dict)
        else None
    )
    if not isinstance(canon_bound, dict) or not canon_bound:
        return out
    moved: dict[str, Any] = {}
    for key in canon_bound:
        if key in {"scenario_id", "scenario_bound"}:
            continue
        if key in backstory and backstory[key] not in (None, "", [], {}):
            moved[key] = backstory.pop(key)
    if moved:
        backstory["scenario_bound"] = moved
    return out


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


def player_safe_opening(
    campaign_dir: Path | str,
    *,
    play_language: str = "zh-Hans",
) -> str | None:
    """Return the installed scenario's canonical player-safe opening.

    The lookup is deliberately limited to explicitly public fields.  It never
    falls back to a dramatic question, Keeper summary, scene plan, or other
    free-form scenario internals merely because they happen to contain prose.
    """
    scenario_dir = Path(campaign_dir) / "scenario"
    documents = [
        _read_json_object(scenario_dir / "module-meta.json"),
        _read_json_object(scenario_dir / "scenario.json"),
    ]
    for document in documents:
        localized = document.get("localized_text")
        localized_public = (
            localized.get(play_language)
            if isinstance(localized, dict)
            and isinstance(localized.get(play_language), dict)
            else {}
        )
        for value in (
            localized_public.get("opening_scene"),
            localized_public.get("player_safe_summary"),
            document.get("player_safe_summary"),
            document.get("opening_scene"),
        ):
            if isinstance(value, str) and value.strip():
                return value.strip()

    story = _read_json_object(scenario_dir / "story-graph.json")
    scenes = story.get("scenes") if isinstance(story.get("scenes"), list) else []
    start = next(
        (scene for scene in scenes if isinstance(scene, dict) and scene.get("is_start") is True),
        next((scene for scene in scenes if isinstance(scene, dict)), None),
    )
    if isinstance(start, dict):
        localized = start.get("localized_text")
        localized_public = (
            localized.get(play_language)
            if isinstance(localized, dict)
            and isinstance(localized.get(play_language), dict)
            else {}
        )
        for value in (
            localized_public.get("player_safe_summary"),
            start.get("player_safe_summary"),
        ):
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _read_json_object(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


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

    _update_campaign_json(campaign_dir, scenario_id)
    _activate_scenario(campaign_dir, scenario_dir, scenario_id)
    coc_character_creation_briefing.render_briefing_from_campaign(
        campaign_dir,
        repo_root=_repo_root_for_output(root),
        write_back=True,
    )
    return scenario_dir


def _activate_scenario(campaign_dir: Path, scenario_dir: Path, scenario_id: str) -> None:
    """Flip world-state.json from setup to active so the Story Director can run.

    install_starter copies scenario files and updates campaign.json, but the
    Director reads active_scene_id from save/world-state.json. Without
    activation, world-state stays at status=setup / active_scene_id=null and
    the Director spins on empty turns (it cannot resolve a scene). This sets
    scenario_id, status=active, active_subsystem=play, and active_scene_id to
    the first scene in story-graph.json.
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
    coc_fileio.write_json_atomic(
        world_path, world, indent=2, ensure_ascii=False, trailing_newline=True
    )


def _coc_root(root: Path) -> Path:
    # Mirror coc_state.coc_root: if `root` already ends in .coc, use it;
    # otherwise treat it as the workspace root containing `.coc/`.
    root = Path(root)
    if root.name == ".coc":
        return root
    return root / ".coc"


def _repo_root_for_output(root: Path) -> Path:
    root = Path(root)
    if root.name == ".coc":
        return root.parent
    return root


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
    coc_fileio.write_json_atomic(
        campaign_path, campaign, indent=2, ensure_ascii=False, trailing_newline=True
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


def list_pregens(scenario_id: str) -> list[dict[str, Any]]:
    """Enumerate pregen investigators shipped under a starter's ``pregens/`` dir."""
    pregen_root = STARTER_DIR / scenario_id / "pregens"
    if not pregen_root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for child in sorted(pregen_root.iterdir()):
        char_path = child / "character.json"
        if not child.is_dir() or not char_path.is_file():
            continue
        try:
            sheet = json.loads(char_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(sheet, dict):
            continue
        pregen_id = str(sheet.get("id") or child.name)
        out.append(
            {
                "pregen_id": pregen_id,
                "name": sheet.get("name"),
                "occupation": sheet.get("occupation"),
                "era": sheet.get("era"),
                "character_path": str(char_path),
            }
        )
    return out


def _pregen_character_path(scenario_id: str, pregen_id: str) -> Path:
    path = STARTER_DIR / scenario_id / "pregens" / pregen_id / "character.json"
    if not path.is_file():
        raise FileNotFoundError(
            f"unknown pregen '{pregen_id}' for starter scenario '{scenario_id}'"
        )
    return path


def _seed_investigator_state(
    campaign_dir: Path,
    campaign_id: str,
    investigator_id: str,
    sheet: dict[str, Any],
) -> Path:
    """Seed campaign investigator-state from a character sheet if missing."""
    coc_root = Path(campaign_dir).resolve().parents[1]
    try:
        return coc_state.seed_investigator_state_if_missing(
            coc_root,
            campaign_id,
            investigator_id,
            sheet=sheet,
        )
    except FileNotFoundError:
        # Bare campaign trees in unit tests may not sit under a full .coc root.
        derived = sheet.get("derived") if isinstance(sheet.get("derived"), dict) else {}
        characteristics = (
            sheet.get("characteristics") if isinstance(sheet.get("characteristics"), dict) else {}
        )
        state = {
            "schema_version": 1,
            "campaign_id": campaign_id,
            "investigator_id": investigator_id,
            "current_hp": int(derived.get("HP") or 10),
            "current_san": int(derived.get("SAN") or characteristics.get("POW") or 50),
            "current_mp": int(derived.get("MP") or max(1, int(characteristics.get("POW") or 50) // 5)),
            "current_luck": int(characteristics.get("LUCK") or 50),
            "conditions": [],
            "skill_checks_earned": [],
        }
        path = campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        coc_fileio.write_json_atomic(
            path, state, indent=2, ensure_ascii=False, trailing_newline=True
        )
        return path


def quick_start(
    root: Path,
    scenario_id: str,
    pregen_id: str,
    *,
    campaign_id: str | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    """Create a campaign, install a starter, and bind a shipped pregen investigator.

    Returns campaign_id / investigator_id / scenario_id / character_path /
    campaign_dir for an immediately playable table (``run_live_turn``-ready).
    """
    src_dir = STARTER_DIR / scenario_id
    if not src_dir.is_dir():
        raise FileNotFoundError(f"unknown starter scenario: {scenario_id}")
    pregen_path = _pregen_character_path(scenario_id, pregen_id)
    sheet = json.loads(pregen_path.read_text(encoding="utf-8"))
    if not isinstance(sheet, dict):
        raise ValueError(f"pregen character.json must be an object: {pregen_path}")
    sheet = ensure_pregen_backstory_provenance(sheet)
    sheet = ensure_pregen_player_facing_sheet(sheet)
    investigator_id = str(sheet.get("id") or pregen_id)

    meta_path = src_dir / "module-meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}
    era = str(meta.get("era") or "1920s")
    camp_id = campaign_id or f"{scenario_id}-qs"
    camp_title = title or str(meta.get("title") or scenario_id)

    coc_root = _coc_root(root)
    coc_state.ensure_workspace(coc_root)
    campaign_dir = coc_root / "campaigns" / camp_id
    campaign_path = campaign_dir / "campaign.json"

    # Campaign publication and reusable-investigator acceptance are one stable
    # boundary with the sole global lock order: campaign, then investigator.
    # Every seed/link/copy is derived from the exact object accepted under the
    # investigator guard, and no helper below re-enters that lock.
    with coc_fileio.campaign_lock(campaign_dir, wait_seconds=5.0):
        if campaign_path.exists():
            raise FileExistsError(
                f"campaign {camp_id} already exists; pass a fresh campaign_id or remove it first"
            )
        with coc_investigator_guard.guard_reusable_investigators(
            coc_root, [investigator_id]
        ):
            existing_path = (
                coc_root / "investigators" / investigator_id / "character.json"
            )
            reuse_existing = existing_path.is_file()
            accepted_snapshot = sheet
            if reuse_existing:
                existing = json.loads(existing_path.read_text(encoding="utf-8"))
                if existing != sheet:
                    raise FileExistsError(
                        "quick-start will not replace an existing reusable "
                        f"investigator: {investigator_id}"
                    )
                accepted_snapshot = existing

            coc_state.create_campaign(
                coc_root,
                camp_id,
                camp_title,
                era=era,
                start_clock=(
                    meta.get("start_clock")
                    if isinstance(meta.get("start_clock"), dict)
                    else None
                ),
            )
            install_starter(coc_root, camp_id, scenario_id)

            # The caller already owns the reusable-investigator guard.
            if not reuse_existing:
                coc_state._create_investigator_unlocked(
                    coc_root, investigator_id, accepted_snapshot
                )
            character_path = (
                coc_root / "investigators" / investigator_id / "character.json"
            )

            # Campaign-local copy for sandbox/report tooling.
            camp_inv_dir = campaign_dir / "investigators" / investigator_id
            camp_inv_dir.mkdir(parents=True, exist_ok=True)
            coc_fileio.write_json_atomic(
                camp_inv_dir / "character.json",
                accepted_snapshot,
                indent=2,
                ensure_ascii=False,
                trailing_newline=True,
            )

            _seed_investigator_state(
                campaign_dir,
                camp_id,
                investigator_id,
                accepted_snapshot,
            )
            coc_state._link_party_unlocked(
                coc_root,
                camp_id,
                [investigator_id],
                sheets={investigator_id: accepted_snapshot},
            )

            campaign = json.loads(
                (campaign_dir / "campaign.json").read_text(encoding="utf-8")
            )
            campaign["status"] = "active"
            campaign["active_subsystem"] = "play"
            campaign["character_creation"] = {
                **(
                    campaign.get("character_creation")
                    if isinstance(campaign.get("character_creation"), dict)
                    else {}
                ),
                "active_investigator_id": investigator_id,
                "pregen_id": pregen_id,
                "quick_start": True,
            }
            campaign["updated_at"] = _now_iso()
            coc_fileio.write_json_atomic(
                campaign_dir / "campaign.json",
                campaign,
                indent=2,
                ensure_ascii=False,
                trailing_newline=True,
            )

    return {
        "campaign_id": camp_id,
        "investigator_id": investigator_id,
        "scenario_id": scenario_id,
        "pregen_id": pregen_id,
        "character_path": str(character_path),
        "campaign_dir": str(campaign_dir),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="List or install built-in starter scenarios.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="list available starter scenarios")

    inst = sub.add_parser("install", help="install a starter scenario into a campaign")
    inst.add_argument("--campaign", required=True)
    inst.add_argument("--scenario", required=True)
    inst.add_argument("--root", default=".coc", help="path to .coc workspace")

    qs = sub.add_parser(
        "quick-start",
        help="create campaign + install starter + bind a shipped pregen (one-line play)",
    )
    qs.add_argument("--scenario", required=True)
    qs.add_argument("--pregen", required=True, help="pregen id (e.g. thomas-hayes)")
    qs.add_argument("--campaign", default=None, help="optional campaign id (default: <scenario>-qs)")
    qs.add_argument("--root", default=".coc", help="path to .coc workspace or its parent")
    qs.add_argument("--title", default=None, help="optional campaign title")

    pre = sub.add_parser("list-pregens", help="list pregen investigators for a starter")
    pre.add_argument("--scenario", required=True)

    args = parser.parse_args(argv)

    if args.cmd == "list":
        for s in list_starter_scenarios():
            print(f"{s['scenario_id']}\t{s['title']}\t{s['one_liner']}")
        return 0
    if args.cmd == "install":
        path = install_starter(Path(args.root), args.campaign, args.scenario)
        print(f"installed {args.scenario} -> {path}")
        return 0
    if args.cmd == "list-pregens":
        for p in list_pregens(args.scenario):
            print(f"{p['pregen_id']}\t{p.get('name')}\t{p.get('occupation')}")
        return 0
    if args.cmd == "quick-start":
        result = quick_start(
            Path(args.root),
            args.scenario,
            args.pregen,
            campaign_id=args.campaign,
            title=args.title,
        )
        print(
            f"quick-start ready campaign={result['campaign_id']} "
            f"investigator={result['investigator_id']} "
            f"character={result['character_path']}"
        )
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
