#!/usr/bin/env python3
"""Compiled-module registry keyed by MODULE IDENTITY (not file identity).

Library layout under ``.coc/module-library/``::

    registry.json
    <canonical_module_id>/
      identity.json
      scenario/          # validated 7-file compiled scenario

Mega-module / chapter policy
----------------------------
One registry entry = one playable compiled unit. For campaign mega-modules
(e.g. Masks of Nyarlathotep), register each chapter as its own entry with a
chapter-scoped id such as ``masks-of-nyarlathotep-ch-peru``. Optional
``identity.chapters`` may list sibling chapter ids for documentation; the
compiled JSON always lives under the chapter entry's ``scenario/``.

Identity matching (Semantic Matcher Constitution)
------------------------------------------------
Runtime never scans free text or fuzzy-matches titles. The compiling LLM
emits a structured ``module_identity`` block; this module only does exact
comparisons on ``canonical_module_id`` and orthographically normalized
alias keys (lowercase + strip punctuation/whitespace + edition).
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_fileio
import coc_scenario_compile
import coc_starter
import coc_state

SCENARIO_FILES = coc_starter.STARTER_SCENARIO_FILES
REGISTRY_SCHEMA_VERSION = 1
IDENTITY_SCHEMA_VERSION = 1

_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
_WS_RE = re.compile(r"\s+", re.UNICODE)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _coc_root(root: Path) -> Path:
    return coc_state.coc_root(root)


def library_root(coc_root: Path) -> Path:
    return _coc_root(coc_root) / "module-library"


def registry_path(coc_root: Path) -> Path:
    return library_root(coc_root) / "registry.json"


def module_dir(coc_root: Path, canonical_module_id: str) -> Path:
    return library_root(coc_root) / canonical_module_id


def normalize_alias_key(title: str, edition: str | None = None) -> str:
    """Orthographic normalization for alias index keys (not semantic matching)."""
    text = str(title or "").lower()
    text = _PUNCT_RE.sub("", text)
    text = _WS_RE.sub("", text)
    ed = str(edition or "").lower().strip()
    ed = _PUNCT_RE.sub("", ed)
    ed = _WS_RE.sub("", ed)
    return f"{text}|{ed}" if ed else text


def _empty_registry() -> dict[str, Any]:
    return {"schema_version": REGISTRY_SCHEMA_VERSION, "modules": {}, "alias_index": {}}


def load_registry(coc_root: Path) -> dict[str, Any]:
    path = registry_path(coc_root)
    if not path.is_file():
        return _empty_registry()
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        return _empty_registry()
    raw.setdefault("schema_version", REGISTRY_SCHEMA_VERSION)
    raw.setdefault("modules", {})
    raw.setdefault("alias_index", {})
    return raw


def _write_registry(coc_root: Path, registry: dict[str, Any]) -> None:
    library_root(coc_root).mkdir(parents=True, exist_ok=True)
    coc_fileio.write_json_atomic(
        registry_path(coc_root),
        registry,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )


def _require_identity_fields(identity: dict[str, Any]) -> str:
    cid = str(identity.get("canonical_module_id") or "").strip()
    if not cid:
        raise ValueError("identity.canonical_module_id is required")
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", cid):
        raise ValueError(
            f"identity.canonical_module_id must be kebab-case slug, got {cid!r}"
        )
    title = str(identity.get("canonical_title") or "").strip()
    if not title:
        raise ValueError("identity.canonical_title is required")
    return cid


def _alias_dicts(identity: dict[str, Any]) -> list[dict[str, Any]]:
    aliases = identity.get("aliases") or []
    if not isinstance(aliases, list):
        raise ValueError("identity.aliases must be a list")
    out: list[dict[str, Any]] = []
    for item in aliases:
        if not isinstance(item, dict):
            raise ValueError("each alias must be an object")
        title = str(item.get("title") or "").strip()
        if not title:
            raise ValueError("alias.title is required")
        out.append(dict(item))
    return out


def _summary_for(
    identity: dict[str, Any],
    *,
    alias_keys: list[str],
) -> dict[str, Any]:
    return {
        "canonical_module_id": identity["canonical_module_id"],
        "canonical_title": identity["canonical_title"],
        "publisher": identity.get("publisher"),
        "edition": identity.get("edition"),
        "chapters": identity.get("chapters") or [],
        "alias_keys": alias_keys,
        "compiled_at": identity.get("compiled_at"),
    }


def _rebuild_alias_index(registry: dict[str, Any]) -> None:
    alias_index: dict[str, str] = {}
    for cid, summary in (registry.get("modules") or {}).items():
        for key in summary.get("alias_keys") or []:
            alias_index[str(key)] = str(cid)
    registry["alias_index"] = alias_index


def _collect_alias_keys(identity: dict[str, Any]) -> list[str]:
    edition = identity.get("edition")
    keys: list[str] = []
    seen: set[str] = set()

    def _add(title: str) -> None:
        key = normalize_alias_key(title, edition if isinstance(edition, str) else None)
        if key and key not in seen:
            seen.add(key)
            keys.append(key)

    _add(str(identity["canonical_title"]))
    for alias in _alias_dicts(identity):
        _add(str(alias["title"]))
    return keys


def _copy_scenario_atomic(src: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    staging = dest.parent / f".{dest.name}.staging"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True, exist_ok=True)
    try:
        for fname in SCENARIO_FILES:
            shutil.copy2(src / fname, staging / fname)
        # Replace dest contents atomically-ish: write into staging then swap.
        if dest.exists():
            backup = dest.parent / f".{dest.name}.bak"
            if backup.exists():
                shutil.rmtree(backup)
            dest.rename(backup)
            try:
                staging.rename(dest)
            except Exception:
                backup.rename(dest)
                raise
            shutil.rmtree(backup, ignore_errors=True)
        else:
            staging.rename(dest)
    finally:
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)


def register_module(
    coc_root: Path,
    scenario_dir: Path,
    identity: dict[str, Any],
) -> dict[str, Any]:
    """Validate scenario, write library entry + registry index, return entry."""
    scenario_dir = Path(scenario_dir)
    identity = dict(identity)
    cid = _require_identity_fields(identity)

    result = coc_scenario_compile.validate_scenario(scenario_dir)
    errors = result.get("errors") or []
    if errors:
        raise ValueError(
            "refusing to register invalid scenario: " + "; ".join(errors)
        )

    identity.setdefault("schema_version", IDENTITY_SCHEMA_VERSION)
    identity["canonical_module_id"] = cid
    identity.setdefault("aliases", [])
    identity.setdefault("chapters", [])
    identity.setdefault("source_fingerprints", [])
    identity.setdefault("compiled_at", _now_iso())
    identity.setdefault("compiler_note", "")
    # Ensure canonical title is also present as structured alias material via keys.
    _alias_dicts(identity)

    alias_keys = _collect_alias_keys(identity)
    registry = load_registry(coc_root)
    # Detect alias collisions against other modules before writing.
    for key in alias_keys:
        owner = (registry.get("alias_index") or {}).get(key)
        if owner and owner != cid:
            raise ValueError(
                f"alias key {key!r} already owned by {owner!r}; refuse collision"
            )

    entry_dir = module_dir(coc_root, cid)
    entry_dir.mkdir(parents=True, exist_ok=True)
    _copy_scenario_atomic(scenario_dir, entry_dir / "scenario")
    coc_fileio.write_json_atomic(
        entry_dir / "identity.json",
        identity,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )

    registry["modules"][cid] = _summary_for(identity, alias_keys=alias_keys)
    _rebuild_alias_index(registry)
    _write_registry(coc_root, registry)

    return {
        "canonical_module_id": cid,
        "path": str(entry_dir),
        "identity": identity,
        "summary": registry["modules"][cid],
        "validation_warnings": result.get("warnings") or [],
    }


def lookup_module(coc_root: Path, identity: dict[str, Any]) -> dict[str, Any] | None:
    """Exact match on canonical_module_id, else normalized alias title+edition."""
    identity = identity or {}
    registry = load_registry(coc_root)

    cid = identity.get("canonical_module_id")
    if isinstance(cid, str) and cid.strip():
        cid = cid.strip()
        if cid in registry.get("modules", {}):
            return _load_entry(coc_root, cid)
        return None

    title = identity.get("canonical_title") or identity.get("title")
    if not isinstance(title, str) or not title.strip():
        return None
    edition = identity.get("edition")
    key = normalize_alias_key(
        title.strip(),
        edition if isinstance(edition, str) else None,
    )
    owner = (registry.get("alias_index") or {}).get(key)
    if not owner:
        return None
    return _load_entry(coc_root, owner)


def _load_entry(coc_root: Path, canonical_module_id: str) -> dict[str, Any] | None:
    entry_dir = module_dir(coc_root, canonical_module_id)
    identity_path = entry_dir / "identity.json"
    if not identity_path.is_file():
        return None
    identity = json.loads(identity_path.read_text(encoding="utf-8"))
    registry = load_registry(coc_root)
    summary = (registry.get("modules") or {}).get(canonical_module_id) or {}
    return {
        "canonical_module_id": canonical_module_id,
        "path": str(entry_dir),
        "scenario_dir": str(entry_dir / "scenario"),
        "identity": identity,
        "summary": summary,
    }


def add_alias(
    coc_root: Path,
    canonical_module_id: str,
    alias: dict[str, Any],
) -> dict[str, Any]:
    """Append a structured alias and refresh registry alias_index."""
    entry = _load_entry(coc_root, canonical_module_id)
    if entry is None:
        raise FileNotFoundError(f"unknown module: {canonical_module_id}")

    title = str((alias or {}).get("title") or "").strip()
    if not title:
        raise ValueError("alias.title is required")

    identity = dict(entry["identity"])
    aliases = list(identity.get("aliases") or [])
    # Exact structured dedupe on title+locale+edition context.
    locale = alias.get("locale")
    edition = identity.get("edition")
    new_key = normalize_alias_key(title, edition if isinstance(edition, str) else None)
    for existing in aliases:
        if not isinstance(existing, dict):
            continue
        if normalize_alias_key(
            str(existing.get("title") or ""),
            edition if isinstance(edition, str) else None,
        ) == new_key and existing.get("locale") == locale:
            # Already present; still ensure index is current.
            break
    else:
        aliases.append(dict(alias))
        identity["aliases"] = aliases

    alias_keys = _collect_alias_keys(identity)
    registry = load_registry(coc_root)
    for key in alias_keys:
        owner = (registry.get("alias_index") or {}).get(key)
        if owner and owner != canonical_module_id:
            raise ValueError(
                f"alias key {key!r} already owned by {owner!r}; refuse collision"
            )

    coc_fileio.write_json_atomic(
        module_dir(coc_root, canonical_module_id) / "identity.json",
        identity,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )
    registry["modules"][canonical_module_id] = _summary_for(
        identity, alias_keys=alias_keys
    )
    _rebuild_alias_index(registry)
    _write_registry(coc_root, registry)

    return {
        "canonical_module_id": canonical_module_id,
        "identity": identity,
        "summary": registry["modules"][canonical_module_id],
    }


def list_modules(coc_root: Path) -> list[dict[str, Any]]:
    registry = load_registry(coc_root)
    out = []
    for cid, summary in sorted((registry.get("modules") or {}).items()):
        out.append(dict(summary))
    return out


def install_to_campaign(
    coc_root: Path,
    canonical_module_id: str,
    campaign_id: str,
) -> dict[str, Any]:
    """Copy library scenario into a campaign and activate it (starter semantics)."""
    entry = _load_entry(coc_root, canonical_module_id)
    if entry is None:
        raise FileNotFoundError(f"unknown module: {canonical_module_id}")

    base = _coc_root(coc_root)
    campaign_dir = base / "campaigns" / campaign_id
    if not campaign_dir.is_dir():
        raise FileNotFoundError(f"unknown campaign: {campaign_id}")

    src_dir = Path(entry["scenario_dir"])
    scenario_dir = campaign_dir / "scenario"
    for fname in SCENARIO_FILES:
        if (scenario_dir / fname).exists():
            raise FileExistsError(
                f"campaign {campaign_id} already has scenario file {fname}; "
                "refusing to overwrite. Remove it first to re-install."
            )

    scenario_dir.mkdir(parents=True, exist_ok=True)
    for fname in SCENARIO_FILES:
        shutil.copy2(src_dir / fname, scenario_dir / fname)

    meta = json.loads((scenario_dir / "module-meta.json").read_text(encoding="utf-8"))
    scenario_id = str(meta.get("scenario_id") or canonical_module_id)

    campaign_path = campaign_dir / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["active_scenario_id"] = scenario_id
    campaign["era"] = meta.get("era", campaign.get("era", "1920s"))
    campaign["updated_at"] = _now_iso()
    coc_fileio.write_json_atomic(
        campaign_path, campaign, indent=2, ensure_ascii=False, trailing_newline=True
    )
    coc_state.reset_campaign_time_state(
        campaign_dir,
        str(campaign.get("campaign_id") or campaign_id),
        era=str(campaign.get("era") or "1920s"),
        start_clock=meta.get("start_clock")
        if isinstance(meta.get("start_clock"), dict)
        else None,
    )
    coc_starter._activate_scenario(campaign_dir, scenario_dir, scenario_id)

    repo_root = base.parent if base.name == ".coc" else Path(coc_root)
    try:
        coc_character_creation = __import__("coc_character_creation_briefing")
        coc_character_creation.render_briefing_from_campaign(
            campaign_dir,
            repo_root=repo_root,
            write_back=True,
        )
    except Exception:
        # Briefing is best-effort; scenario install + activation are the contract.
        pass

    return {
        "canonical_module_id": canonical_module_id,
        "campaign_id": campaign_id,
        "scenario_id": scenario_id,
        "scenario_dir": str(scenario_dir),
        "paths": {fname: str(scenario_dir / fname) for fname in SCENARIO_FILES},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Compiled-module registry keyed by module identity."
    )
    parser.add_argument(
        "--root",
        default=".coc",
        help="workspace root or .coc directory (default: .coc)",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="list registered modules")

    look = sub.add_parser("lookup", help="lookup by identity JSON")
    look.add_argument(
        "--identity",
        required=True,
        help='JSON object, e.g. \'{"canonical_module_id":"..."}\'',
    )

    reg = sub.add_parser("register", help="register a validated scenario")
    reg.add_argument("--scenario-dir", required=True)
    reg.add_argument("--identity", required=True, help="identity JSON object")

    inst = sub.add_parser("install", help="install registered module into a campaign")
    inst.add_argument("--module", required=True, help="canonical_module_id")
    inst.add_argument("--campaign", required=True)

    alias_p = sub.add_parser("add-alias", help="add a structured alias")
    alias_p.add_argument("--module", required=True)
    alias_p.add_argument("--alias", required=True, help="alias JSON object")

    args = parser.parse_args(argv)
    root = Path(args.root)

    def _emit(payload: Any, *, ok: bool = True) -> int:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0 if ok else 1

    try:
        if args.cmd == "list":
            return _emit({"modules": list_modules(root)})
        if args.cmd == "lookup":
            identity = json.loads(args.identity)
            entry = lookup_module(root, identity)
            return _emit({"hit": entry is not None, "entry": entry})
        if args.cmd == "register":
            identity = json.loads(args.identity)
            entry = register_module(root, Path(args.scenario_dir), identity)
            return _emit(entry)
        if args.cmd == "install":
            result = install_to_campaign(root, args.module, args.campaign)
            return _emit(result)
        if args.cmd == "add-alias":
            alias = json.loads(args.alias)
            result = add_alias(root, args.module, alias)
            return _emit(result)
    except (ValueError, FileNotFoundError, FileExistsError, json.JSONDecodeError) as exc:
        return _emit({"error": str(exc)}, ok=False)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
