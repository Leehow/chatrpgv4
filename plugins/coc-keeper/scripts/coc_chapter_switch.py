#!/usr/bin/env python3
"""Atomic sibling-chapter switching for Masks-style mega-modules.

Replaces only campaign ``scenario/`` and ``index/`` trees for a validated
sibling module that shares ``parent_module_id``. Investigator, inventory,
rolls, memories, NPC history, threats, belief/questions, and language state
are preserved. Failures roll back to the original chapter byte-for-byte.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_fileio
import coc_module_registry
import coc_scenario_compile
import coc_scene_graph
import coc_state

PRESERVED_TREES = ("save", "memory", "logs")
PRESERVED_ROOT_FILES = ("campaign.json", "party.json")
SCENARIO_FILES = coc_module_registry.SCENARIO_FILES
OPTIONAL_SCENARIO_SIDECAR_FILES = coc_module_registry.OPTIONAL_SCENARIO_SIDECAR_FILES
SOURCE_INDEX_FILES = coc_module_registry.SOURCE_INDEX_FILES


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _coc_root(workspace: Path) -> Path:
    root = Path(workspace)
    if root.name == ".coc":
        return root
    return root / ".coc"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _require_regular_dir(path: Path, label: str) -> Path:
    try:
        named = path.stat(follow_symlinks=False)
    except OSError as exc:
        raise ValueError(f"{label} is missing") from exc
    if stat.S_ISLNK(named.st_mode) or not stat.S_ISDIR(named.st_mode):
        raise ValueError(f"{label} must be a real directory")
    return path.resolve()


def _require_regular_file(root: Path, path: Path, label: str) -> Path:
    try:
        named = path.stat(follow_symlinks=False)
    except OSError as exc:
        raise ValueError(f"{label} is missing") from exc
    if stat.S_ISLNK(named.st_mode) or not stat.S_ISREG(named.st_mode):
        raise ValueError(f"{label} must be a regular file")
    resolved = path.resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError(f"{label} escapes containment root") from exc
    return resolved


def _validate_terminal_evidence(evidence: Any) -> dict[str, Any]:
    if not isinstance(evidence, dict):
        raise ValueError("terminal_evidence must be a structured object")
    required = {
        "reached_terminal",
        "active_scene_id",
        "graph_terminal",
        "session_ending",
    }
    missing = sorted(required - set(evidence))
    if missing:
        raise ValueError(
            "terminal_evidence missing fields: " + ", ".join(missing)
        )
    for key in ("reached_terminal", "graph_terminal", "session_ending"):
        if not isinstance(evidence.get(key), bool):
            raise ValueError(f"terminal_evidence.{key} must be a boolean")
    active = evidence.get("active_scene_id")
    if active is not None and (not isinstance(active, str) or not active.strip()):
        raise ValueError("terminal_evidence.active_scene_id must be a string or null")
    if evidence.get("reached_terminal") is not True:
        raise ValueError("structured source terminal evidence is required")
    if evidence.get("reached_terminal") is not (
        evidence["graph_terminal"] or evidence["session_ending"]
    ):
        raise ValueError("terminal_evidence.reached_terminal is inconsistent")
    return {
        "reached_terminal": evidence["reached_terminal"],
        "active_scene_id": active.strip() if isinstance(active, str) else None,
        "graph_terminal": evidence["graph_terminal"],
        "session_ending": evidence["session_ending"],
    }


def _module_identity_from_scenario(scenario_dir: Path) -> dict[str, Any]:
    meta = json.loads((scenario_dir / "module-meta.json").read_text(encoding="utf-8"))
    identity = meta.get("module_identity")
    if not isinstance(identity, dict):
        raise ValueError("current scenario lacks structured module_identity")
    return coc_module_registry.normalize_module_identity(dict(identity))


def _collect_entity_ids(scenario_dir: Path) -> dict[str, set[str]]:
    story = json.loads((scenario_dir / "story-graph.json").read_text(encoding="utf-8"))
    clues = json.loads((scenario_dir / "clue-graph.json").read_text(encoding="utf-8"))
    npcs = json.loads((scenario_dir / "npc-agendas.json").read_text(encoding="utf-8"))
    scene_ids = {
        str(scene.get("scene_id"))
        for scene in (story.get("scenes") or [])
        if isinstance(scene, dict) and scene.get("scene_id")
    }
    clue_ids: set[str] = set()
    for conclusion in clues.get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        for clue in conclusion.get("clues") or []:
            if isinstance(clue, dict) and clue.get("clue_id"):
                clue_ids.add(str(clue["clue_id"]))
    npc_ids = {
        str(npc.get("npc_id"))
        for npc in (npcs.get("npcs") or [])
        if isinstance(npc, dict) and npc.get("npc_id")
    }
    return {"scenes": scene_ids, "clues": clue_ids, "npcs": npc_ids}


def _reject_id_collisions(source_ids: dict[str, set[str]], target_ids: dict[str, set[str]]) -> None:
    for kind in ("scenes", "clues", "npcs"):
        overlap = sorted(source_ids[kind] & target_ids[kind])
        if overlap:
            raise ValueError(
                f"refusing chapter switch due to {kind} id collision: "
                + ", ".join(overlap[:8])
            )


def _snapshot_preserved(campaign_dir: Path) -> dict[str, str]:
    snapshot: dict[str, str] = {}
    for name in PRESERVED_ROOT_FILES:
        path = campaign_dir / name
        if path.is_file():
            snapshot[name] = _sha256_file(path)
    for tree in PRESERVED_TREES:
        root = campaign_dir / tree
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            if path.is_file() and not path.is_symlink():
                rel = path.relative_to(campaign_dir).as_posix()
                snapshot[rel] = _sha256_file(path)
    return snapshot


def _stage_target_package(
    campaign_dir: Path,
    entry: dict[str, Any],
) -> tuple[Path, Path | None, Path]:
    """Stage target scenario(+optional index) as a sibling package tree.

    Returns ``(staging_scenario, staging_index_or_none, staging_package_root)``.
    The package layout lets ``validate_scenario`` discover ``../index`` the same
    way module-library packages do, instead of accidentally reading the live
    campaign's previous-chapter index.
    """
    src_scenario = Path(entry["scenario_dir"])
    _require_regular_dir(src_scenario, "target scenario")
    for fname in SCENARIO_FILES:
        _require_regular_file(src_scenario, src_scenario / fname, f"target {fname}")

    staging_root = campaign_dir / ".chapter-switch-staging"
    if staging_root.exists():
        shutil.rmtree(staging_root)
    staging_root.mkdir(parents=True, exist_ok=True)
    staging_scenario = staging_root / "scenario"
    staging_scenario.mkdir(parents=True, exist_ok=True)
    coc_module_registry._copy_scenario_files(src_scenario, staging_scenario)

    staging_index: Path | None = None
    entry_index = Path(entry["path"]) / "index"
    if entry_index.exists():
        _require_regular_dir(entry_index, "target index")
        for fname in SOURCE_INDEX_FILES:
            _require_regular_file(entry_index, entry_index / fname, f"target {fname}")
        staging_index = staging_root / "index"
        staging_index.mkdir(parents=True, exist_ok=True)
        for fname in SOURCE_INDEX_FILES:
            shutil.copy2(entry_index / fname, staging_index / fname)
    return staging_scenario, staging_index, staging_root


def _cleanup_staging(staging_root: Path | None) -> None:
    if staging_root is not None and staging_root.exists():
        shutil.rmtree(staging_root, ignore_errors=True)


def _atomic_replace_dir(dest: Path, staged: Path) -> None:
    parent = dest.parent
    backup = parent / f".{dest.name}.switch-bak"
    if backup.exists():
        shutil.rmtree(backup)
    if dest.exists():
        dest.rename(backup)
    try:
        staged.rename(dest)
    except Exception:
        if backup.exists():
            if dest.exists():
                shutil.rmtree(dest, ignore_errors=True)
            backup.rename(dest)
        raise
    if backup.exists():
        shutil.rmtree(backup, ignore_errors=True)


def _activate_entry_scene(campaign_dir: Path, scenario_dir: Path, scenario_id: str) -> str:
    story = json.loads((scenario_dir / "story-graph.json").read_text(encoding="utf-8"))
    entry_scene = coc_scene_graph.start_scene_id(story)
    if not entry_scene:
        raise ValueError("target chapter has no entry scene")
    world_path = campaign_dir / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8")) if world_path.is_file() else {}
    world = coc_scene_graph.ensure_world_scene_fields(world, story)
    world["scenario_id"] = scenario_id
    world["status"] = "active"
    world["active_subsystem"] = "play"
    world["active_scene_id"] = entry_scene
    unlocked = world.get("unlocked_scene_ids")
    if isinstance(unlocked, list) and entry_scene not in unlocked:
        unlocked.append(entry_scene)
    world["updated_at"] = _now_iso()
    coc_fileio.write_json_atomic(
        world_path, world, indent=2, ensure_ascii=False, trailing_newline=True
    )
    return entry_scene


def _append_chapter_history(
    campaign_dir: Path,
    *,
    source_module_id: str,
    target_module_id: str,
    parent_module_id: str,
    terminal_evidence: dict[str, Any],
    entry_scene_id: str,
    preservation_manifest: dict[str, Any],
) -> None:
    logs = campaign_dir / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    path = logs / "chapter-history.jsonl"
    row = {
        "schema_version": 1,
        "switched_at": _now_iso(),
        "parent_module_id": parent_module_id,
        "source_module_id": source_module_id,
        "target_module_id": target_module_id,
        "terminal_evidence": terminal_evidence,
        "entry_scene_id": entry_scene_id,
        "preservation_manifest_sha256": hashlib.sha256(
            json.dumps(
                preservation_manifest,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest(),
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def switch_chapter(
    workspace: Path,
    campaign_id: str,
    target_module_id: str,
    terminal_evidence: dict[str, Any],
) -> dict[str, Any]:
    """Atomically switch a campaign to a sibling chapter module."""
    coc_root = _coc_root(workspace)
    campaign_dir = coc_root / "campaigns" / campaign_id
    _require_regular_dir(campaign_dir, "campaign")
    scenario_dir = campaign_dir / "scenario"
    _require_regular_dir(scenario_dir, "campaign scenario")

    evidence = _validate_terminal_evidence(terminal_evidence)
    source_identity = _module_identity_from_scenario(scenario_dir)
    source_module_id = str(source_identity.get("canonical_module_id") or "").strip()
    source_parent = str(source_identity.get("parent_module_id") or "").strip()
    if not source_module_id or not source_parent:
        raise ValueError("current chapter lacks parent_module_id / canonical_module_id")

    target_id = str(target_module_id or "").strip()
    if not target_id:
        raise ValueError("target_module_id is required")
    if target_id == source_module_id:
        raise ValueError("refusing to switch to the already-active chapter")

    entry = coc_module_registry.lookup_module(
        coc_root, {"canonical_module_id": target_id}
    )
    if entry is None:
        library = coc_module_registry.library_root(coc_root)
        raise FileNotFoundError(
            f"unknown module: {target_id} "
            f"(no registry entry under {library}; "
            "ensure .coc/module-library is present on the campaign workspace)"
        )
    target_identity = coc_module_registry.normalize_module_identity(
        dict(entry.get("identity") or {})
    )
    target_parent = str(target_identity.get("parent_module_id") or "").strip()
    if target_parent != source_parent:
        raise ValueError(
            "source and target chapters must share the same parent_module_id"
        )

    # Validate target before mutating the live campaign.
    target_scenario = Path(entry["scenario_dir"])
    validation = coc_scenario_compile.validate_scenario(target_scenario)
    if validation.get("errors"):
        raise ValueError(
            "refusing invalid target chapter: "
            + "; ".join(validation["errors"])
        )

    source_ids = _collect_entity_ids(scenario_dir)
    target_ids = _collect_entity_ids(target_scenario)
    _reject_id_collisions(source_ids, target_ids)

    before = _snapshot_preserved(campaign_dir)
    staging_scenario, staging_index, staging_root = _stage_target_package(
        campaign_dir, entry
    )
    staged_validation = coc_scenario_compile.validate_scenario(staging_scenario)
    if staged_validation.get("errors"):
        _cleanup_staging(staging_root)
        raise ValueError(
            "staged target chapter failed validation: "
            + "; ".join(staged_validation["errors"])
        )

    meta = json.loads((staging_scenario / "module-meta.json").read_text(encoding="utf-8"))
    scenario_id = str(meta.get("scenario_id") or target_id)
    original_scenario = campaign_dir / "scenario"
    original_index = campaign_dir / "index"
    scenario_backup = campaign_dir / ".scenario.switch-bak"
    index_backup = campaign_dir / ".index.switch-bak"
    for backup in (scenario_backup, index_backup):
        if backup.exists():
            shutil.rmtree(backup)

    replaced_scenario = False
    replaced_index = False
    removed_index = False
    try:
        if original_scenario.exists():
            original_scenario.rename(scenario_backup)
        staging_scenario.rename(original_scenario)
        replaced_scenario = True

        if staging_index is not None:
            if original_index.exists():
                original_index.rename(index_backup)
                replaced_index = True
            staging_index.rename(original_index)
        elif original_index.exists():
            original_index.rename(index_backup)
            removed_index = True
        _cleanup_staging(staging_root)

        world_path = campaign_dir / "save" / "world-state.json"
        world_before = world_path.read_bytes() if world_path.is_file() else None
        entry_scene = _activate_entry_scene(campaign_dir, original_scenario, scenario_id)

        campaign_path = campaign_dir / "campaign.json"
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
        campaign_before = campaign_path.read_bytes()
        campaign["active_scenario_id"] = scenario_id
        campaign["era"] = meta.get("era", campaign.get("era", "1920s"))
        campaign["updated_at"] = _now_iso()
        coc_fileio.write_json_atomic(
            campaign_path,
            campaign,
            indent=2,
            ensure_ascii=False,
            trailing_newline=True,
        )

        after = _snapshot_preserved(campaign_dir)
        changed = {
            path: {"before": before.get(path), "after": digest}
            for path, digest in after.items()
            if before.get(path) != digest
        }
        allowed_changed = {
            "campaign.json",
            "save/world-state.json",
        }
        unexpected = sorted(set(changed) - allowed_changed)
        if unexpected:
            campaign_path.write_bytes(campaign_before)
            if world_before is not None:
                world_path.write_bytes(world_before)
            raise ValueError(
                "chapter switch mutated preserved state: " + ", ".join(unexpected)
            )
        missing = sorted(set(before) - set(after) - allowed_changed)
        if missing:
            campaign_path.write_bytes(campaign_before)
            if world_before is not None:
                world_path.write_bytes(world_before)
            raise ValueError(
                "chapter switch removed preserved state: " + ", ".join(missing)
            )

        preservation_manifest = {
            "preserved_file_count": len(before),
            "changed_files": sorted(changed),
            "source_module_id": source_module_id,
            "target_module_id": target_id,
            "parent_module_id": source_parent,
            "entry_scene_id": entry_scene,
        }
        _append_chapter_history(
            campaign_dir,
            source_module_id=source_module_id,
            target_module_id=target_id,
            parent_module_id=source_parent,
            terminal_evidence=evidence,
            entry_scene_id=entry_scene,
            preservation_manifest=preservation_manifest,
        )
        if scenario_backup.exists():
            shutil.rmtree(scenario_backup, ignore_errors=True)
        if index_backup.exists():
            shutil.rmtree(index_backup, ignore_errors=True)
        return {
            "ok": True,
            "campaign_id": campaign_id,
            "source_module_id": source_module_id,
            "target_module_id": target_id,
            "parent_module_id": source_parent,
            "entry_scene_id": entry_scene,
            "scenario_id": scenario_id,
            "terminal_evidence": evidence,
            "preservation_manifest": preservation_manifest,
        }
    except Exception:
        # Restore original chapter trees byte-for-byte.
        if "campaign_before" in locals() and campaign_path.exists():
            try:
                campaign_path.write_bytes(campaign_before)
            except OSError:
                pass
        if "world_before" in locals() and world_before is not None:
            try:
                world_path.write_bytes(world_before)
            except OSError:
                pass
        if replaced_scenario:
            if original_scenario.exists():
                shutil.rmtree(original_scenario, ignore_errors=True)
            if scenario_backup.exists():
                scenario_backup.rename(original_scenario)
        if replaced_index or removed_index:
            if original_index.exists():
                shutil.rmtree(original_index, ignore_errors=True)
            if index_backup.exists():
                index_backup.rename(original_index)
        for leftover in (
            campaign_dir / ".chapter-switch-staging",
            campaign_dir / ".scenario.switch-staging",
            campaign_dir / ".index.switch-staging-root",
        ):
            if leftover.exists():
                shutil.rmtree(leftover, ignore_errors=True)
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Switch a campaign to a sibling chapter.")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--campaign", required=True)
    parser.add_argument("--target-module", required=True)
    parser.add_argument(
        "--terminal-evidence-json",
        required=True,
        help="JSON object with structured terminal evidence",
    )
    args = parser.parse_args(argv)
    evidence = json.loads(args.terminal_evidence_json)
    result = switch_chapter(
        Path(args.workspace),
        args.campaign,
        args.target_module,
        evidence,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
