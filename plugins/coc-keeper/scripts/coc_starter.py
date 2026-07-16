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
import hashlib
import json
import os
import shutil
import sys
import uuid
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

    return _install_starter_at(
        campaign_dir,
        scenario_id,
        repo_root=_repo_root_for_output(root),
        published_campaign_dir=campaign_dir,
    )


def _install_starter_at(
    campaign_dir: Path,
    scenario_id: str,
    *,
    repo_root: Path,
    published_campaign_dir: Path,
) -> Path:
    """Install a starter into an explicit unpublished campaign generation."""
    src_dir = STARTER_DIR / scenario_id
    if not src_dir.is_dir():
        raise FileNotFoundError(f"unknown starter scenario: {scenario_id}")
    campaign_dir = Path(campaign_dir)
    published_campaign_dir = Path(published_campaign_dir)
    campaign_id = str(
        _read_json_object(campaign_dir / "campaign.json").get("campaign_id")
        or published_campaign_dir.name
    )

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
    briefing = coc_character_creation_briefing.render_briefing_from_campaign(
        campaign_dir,
        repo_root=repo_root,
        write_back=False,
    )
    briefing_name = Path(briefing["briefing_path"]).name
    published_briefing = (
        published_campaign_dir
        / "assets"
        / "character-creation"
        / briefing_name
    )
    try:
        briefing["briefing_path"] = (
            published_briefing.resolve()
            .relative_to(Path(repo_root).resolve())
            .as_posix()
        )
    except ValueError:
        briefing["briefing_path"] = published_briefing.resolve().as_posix()
    campaign_path = campaign_dir / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["character_creation"] = {
        **(
            campaign.get("character_creation")
            if isinstance(campaign.get("character_creation"), dict)
            else {}
        ),
        **briefing,
    }
    coc_fileio.write_json_atomic(
        campaign_path,
        campaign,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
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


def _finalize_quick_start_campaign(
    campaign_dir: Path,
    investigator_id: str,
    pregen_id: str,
) -> None:
    campaign_path = Path(campaign_dir) / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
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
        campaign_path,
        campaign,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )


def _write_campaign_local_character(
    campaign_dir: Path,
    investigator_id: str,
    sheet: dict[str, Any],
) -> Path:
    character_path = (
        Path(campaign_dir)
        / "investigators"
        / investigator_id
        / "character.json"
    )
    coc_fileio.write_json_atomic(
        character_path,
        sheet,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )
    return character_path


def _publish_campaign_generation(staging_dir: Path, campaign_dir: Path) -> None:
    """Atomically publish a complete same-filesystem campaign generation."""
    staging_dir = Path(staging_dir)
    campaign_dir = Path(campaign_dir)
    if staging_dir.parent.resolve() != campaign_dir.parent.resolve():
        raise ValueError("campaign publication requires same-parent staging")
    if staging_dir.is_symlink() or not staging_dir.is_dir():
        raise RuntimeError("campaign staging generation is not a directory")
    if os.path.lexists(campaign_dir):
        raise FileExistsError(f"campaign publication target exists: {campaign_dir}")
    staging_dir.rename(campaign_dir)


def _quick_start_stage_prefix(kind: str, identity: str) -> str:
    token = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20]
    return f".quick-start-{kind}-{token}-"


_QUICK_START_STAGE_MANIFEST_SUFFIX = ".owner.json"


def _stage_manifest_path(staging_dir: Path) -> Path:
    staging_dir = Path(staging_dir)
    return staging_dir.with_name(
        f"{staging_dir.name}{_QUICK_START_STAGE_MANIFEST_SUFFIX}"
    )


def _write_stage_manifest(
    staging_dir: Path,
    *,
    kind: str,
    identity: str,
) -> None:
    coc_fileio.write_json_atomic(
        _stage_manifest_path(staging_dir),
        {
            "schema_version": 1,
            "kind": kind,
            "identity": identity,
        },
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )


def _create_private_stage(
    parent: Path,
    prefix: str,
    *,
    kind: str,
    identity: str,
) -> Path:
    """Create an owned private stage with no unidentifiable crash window."""
    staging_dir = Path(parent) / f"{prefix}{uuid.uuid4().hex}"
    _write_stage_manifest(staging_dir, kind=kind, identity=identity)
    try:
        staging_dir.mkdir()
    except BaseException:
        _stage_manifest_path(staging_dir).unlink(missing_ok=True)
        raise
    return staging_dir


def _cleanup_stale_generations(
    parent: Path,
    prefix: str,
    *,
    kind: str,
    identity: str,
) -> None:
    """Remove only private quick-start generations while their owner lock is held."""
    expected = {
        "schema_version": 1,
        "kind": kind,
        "identity": identity,
    }
    candidates = list(parent.glob(f"{prefix}*"))
    sidecars = {
        candidate.name.removesuffix(_QUICK_START_STAGE_MANIFEST_SUFFIX): candidate
        for candidate in candidates
        if candidate.name.endswith(_QUICK_START_STAGE_MANIFEST_SUFFIX)
    }
    for sidecar in sidecars.values():
        if sidecar.is_symlink() or not sidecar.is_file():
            raise RuntimeError(f"unsafe quick-start staging owner: {sidecar}")
        if _read_json_object(sidecar) != expected:
            raise RuntimeError(f"unowned quick-start staging owner: {sidecar}")
    for candidate in candidates:
        if candidate.name.endswith(_QUICK_START_STAGE_MANIFEST_SUFFIX):
            continue
        if candidate.is_symlink() or not candidate.is_dir():
            raise RuntimeError(f"unsafe quick-start staging entry: {candidate}")
        sidecar = sidecars.pop(candidate.name, None)
        if sidecar is None:
            raise RuntimeError(f"unowned quick-start staging entry: {candidate}")
        shutil.rmtree(candidate)
        sidecar.unlink()
    # A process can die immediately after renaming a complete generation.  Its
    # sidecar remains at the old private name while the published directory is
    # clean; the next guarded entry may discard that verified orphan sidecar.
    for sidecar in sidecars.values():
        sidecar.unlink()


def _remove_owned_stage(staging_dir: Path) -> None:
    staging_dir = Path(staging_dir)
    if os.path.lexists(staging_dir):
        if staging_dir.is_symlink() or not staging_dir.is_dir():
            raise RuntimeError(f"unsafe owned quick-start stage: {staging_dir}")
        shutil.rmtree(staging_dir)
    sidecar = _stage_manifest_path(staging_dir)
    if os.path.lexists(sidecar):
        if sidecar.is_symlink() or not sidecar.is_file():
            raise RuntimeError(f"unsafe owned quick-start stage owner: {sidecar}")
        sidecar.unlink()


def _validate_quick_start_generation(
    campaign_dir: Path,
    *,
    campaign_id: str,
    scenario_id: str,
    investigator_id: str,
    accepted_snapshot: dict[str, Any],
) -> None:
    """Validate structural persistence invariants before publication."""
    campaign_dir = Path(campaign_dir)
    for filename in STARTER_SCENARIO_FILES:
        path = campaign_dir / "scenario" / filename
        if path.is_symlink() or not path.is_file():
            raise RuntimeError(f"quick-start scenario file is incomplete: {filename}")
    campaign = _read_json_object(campaign_dir / "campaign.json")
    world = _read_json_object(campaign_dir / "save" / "world-state.json")
    party = _read_json_object(campaign_dir / "party.json")
    local_character = _read_json_object(
        campaign_dir / "investigators" / investigator_id / "character.json"
    )
    investigator_state = _read_json_object(
        campaign_dir
        / "save"
        / "investigator-state"
        / f"{investigator_id}.json"
    )
    if (
        campaign.get("campaign_id") != campaign_id
        or campaign.get("active_scenario_id") != scenario_id
        or campaign.get("status") != "active"
        or campaign.get("active_subsystem") != "play"
        or world.get("campaign_id") != campaign_id
        or world.get("scenario_id") != scenario_id
        or world.get("status") != "active"
        or not world.get("active_scene_id")
        or party.get("campaign_id") != campaign_id
        or party.get("investigator_ids") != [investigator_id]
        or party.get("active_investigator_ids") != [investigator_id]
        or local_character != accepted_snapshot
        or investigator_state.get("campaign_id") != campaign_id
        or investigator_state.get("investigator_id") != investigator_id
    ):
        raise RuntimeError("quick-start staged generation failed structural validation")


def _validate_staged_investigator(
    investigator_dir: Path,
    investigator_id: str,
    accepted_snapshot: dict[str, Any],
) -> None:
    required = {
        "creation.json",
        "character.json",
        "history.jsonl",
        "development.jsonl",
        "inventory-history.jsonl",
    }
    if any(
        (Path(investigator_dir) / name).is_symlink()
        or not (Path(investigator_dir) / name).is_file()
        for name in required
    ) or _read_json_object(Path(investigator_dir) / "character.json") != accepted_snapshot:
        raise RuntimeError("quick-start investigator generation is incomplete")


def _best_effort_quick_start_indexes(
    root: Path,
    campaign_id: str,
    investigator_id: str,
    sheet: dict[str, Any],
) -> list[str]:
    """Repair derivative indexes without changing publication success."""
    warnings: list[str] = []
    for label, repair in (
        ("campaign", lambda: coc_state._upsert_campaign_index(root, campaign_id)),
        (
            "investigator",
            lambda: coc_state._upsert_investigator_index(root, investigator_id, sheet),
        ),
    ):
        try:
            repair()
        except Exception as exc:
            # The fully published campaign/investigator files are authoritative;
            # later index scans or setup calls may safely repair this cache.
            warnings.append(f"{label} index repair deferred: {type(exc).__name__}")
    return warnings


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
    campaigns_dir = coc_root / "campaigns"
    investigators_dir = coc_root / "investigators"
    publication_token = hashlib.sha256(camp_id.encode("utf-8")).hexdigest()
    publication_lock = (
        coc_root
        / "locks"
        / "campaign-publication"
        / publication_token
        / ".publication.lock"
    )
    campaign_prefix = _quick_start_stage_prefix("campaign", camp_id)
    investigator_prefix = _quick_start_stage_prefix("investigator", investigator_id)

    # Publication stays outside the final campaign tree, preserving the sole
    # global order: campaign publication, then reusable investigator.  Nothing
    # under the final campaign path exists until the completed generation's
    # single same-filesystem rename.
    with coc_fileio.advisory_file_lock(publication_lock, wait_seconds=5.0):
        _cleanup_stale_generations(
            campaigns_dir,
            campaign_prefix,
            kind="campaign",
            identity=camp_id,
        )
        if os.path.lexists(campaign_dir):
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
            _cleanup_stale_generations(
                investigators_dir,
                investigator_prefix,
                kind="investigator",
                identity=investigator_id,
            )
            campaign_stage = _create_private_stage(
                campaigns_dir,
                campaign_prefix,
                kind="campaign",
                identity=camp_id,
            )
            investigator_stage: Path | None = None
            published_new_investigator = False
            campaign_published = False
            post_commit_warnings: list[str] = []
            character_path = (
                coc_root / "investigators" / investigator_id / "character.json"
            )
            try:
                coc_state._create_campaign_at(
                    coc_root,
                    campaign_stage,
                    camp_id,
                    camp_title,
                    era=era,
                    start_clock=(
                        meta.get("start_clock")
                        if isinstance(meta.get("start_clock"), dict)
                        else None
                    ),
                    update_index=False,
                )
                _install_starter_at(
                    campaign_stage,
                    scenario_id,
                    repo_root=_repo_root_for_output(root),
                    published_campaign_dir=campaign_dir,
                )

                if not reuse_existing:
                    investigator_stage = _create_private_stage(
                        investigators_dir,
                        investigator_prefix,
                        kind="investigator",
                        identity=investigator_id,
                    )
                    coc_state._create_investigator_at(
                        investigator_stage,
                        investigator_id,
                        accepted_snapshot,
                    )
                    _validate_staged_investigator(
                        investigator_stage,
                        investigator_id,
                        accepted_snapshot,
                    )

                _write_campaign_local_character(
                    campaign_stage,
                    investigator_id,
                    accepted_snapshot,
                )
                coc_state._seed_investigator_state_at(
                    campaign_stage,
                    camp_id,
                    investigator_id,
                    accepted_snapshot,
                )
                coc_state._link_party_at(
                    campaign_stage,
                    camp_id,
                    [investigator_id],
                    sheets={investigator_id: accepted_snapshot},
                )
                _finalize_quick_start_campaign(
                    campaign_stage,
                    investigator_id,
                    pregen_id,
                )
                _validate_quick_start_generation(
                    campaign_stage,
                    campaign_id=camp_id,
                    scenario_id=scenario_id,
                    investigator_id=investigator_id,
                    accepted_snapshot=accepted_snapshot,
                )

                if investigator_stage is not None:
                    investigator_stage.rename(character_path.parent)
                    published_new_investigator = True
                    _stage_manifest_path(investigator_stage).unlink()
                    investigator_stage = None
                try:
                    _publish_campaign_generation(campaign_stage, campaign_dir)
                except BaseException:
                    # A callback may fail after the rename commit point.  Once
                    # the complete stage has become the final campaign, later
                    # failure is maintenance-only and must not roll publication
                    # back or report an authoritative success as failure.
                    if campaign_dir.is_dir() and not campaign_stage.exists():
                        campaign_published = True
                    else:
                        raise
                else:
                    campaign_published = True
                try:
                    _stage_manifest_path(campaign_stage).unlink(missing_ok=True)
                except OSError as exc:
                    post_commit_warnings.append(
                        "campaign staging owner cleanup deferred: "
                        f"{type(exc).__name__}"
                    )
            except BaseException as original:
                cleanup_errors: list[BaseException] = []
                if not campaign_published:
                    try:
                        _remove_owned_stage(campaign_stage)
                    except BaseException as exc:
                        cleanup_errors.append(exc)
                if investigator_stage is not None:
                    try:
                        _remove_owned_stage(investigator_stage)
                    except BaseException as exc:
                        cleanup_errors.append(exc)
                if published_new_investigator and not campaign_published:
                    try:
                        shutil.rmtree(character_path.parent)
                    except BaseException as exc:
                        cleanup_errors.append(exc)
                if cleanup_errors:
                    raise RuntimeError(
                        "quick-start could not roll back an owned generation"
                    ) from original
                raise

            index_warnings = post_commit_warnings + _best_effort_quick_start_indexes(
                coc_root,
                camp_id,
                investigator_id,
                accepted_snapshot,
            )

    result = {
        "campaign_id": camp_id,
        "investigator_id": investigator_id,
        "scenario_id": scenario_id,
        "pregen_id": pregen_id,
        "character_path": str(character_path),
        "campaign_dir": str(campaign_dir),
    }
    if index_warnings:
        result["warnings"] = index_warnings
    return result


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
