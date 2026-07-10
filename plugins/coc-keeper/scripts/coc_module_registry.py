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
alias keys (lowercase + strip punctuation/whitespace + **rules_edition**,
and **chapter** when present).

Alias key shape
---------------
- Chapterless module: ``title|rules_edition`` (or bare ``title`` when no
  rules_edition).
- Chaptered module: ``title|rules_edition|chapter``.
- Lookup **without** ``chapter`` matches a chapterless alias key only — it
  does not fall through to chapter-qualified keys. Lookup **with**
  ``chapter`` matches only the chapter-qualified key. Sibling chapters of a
  mega-module may therefore share an identical translated title.

Edition fields
--------------
- ``module_edition``: the published book/product edition (e.g. Masks "5th").
- ``rules_edition``: the CoC rules edition used to play (e.g. "7e").
- Legacy ``edition`` alone is treated as ``rules_edition`` via
  ``normalize_module_identity`` (structured migration; no free-text guessing).
  Alias index keys always use ``rules_edition`` (and ``chapter`` when set).
  ``load_registry`` rebuilds alias keys from on-disk ``identity.json`` so
  older chapterless index entries for chaptered modules are migrated.
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

LICENSE_NOTE_FILENAME = "LICENSE-note.md"
LICENSE_NOTE_TEXT = """# Product Identity / License Boundary

This library entry stores a **compiled structured index** (JSON story/clue
graphs and related machine-readable fields) for private play reuse under
`.coc/module-library/`.

- **Allowed here:** structured IDs, tags, enums, mechanical fields,
  player-safe summaries authored for play, and `source_refs` (path + printed
  page numbers).
- **Must not be committed to git as source prose:** verbatim module text,
  handout copy lifted from the book, or keeper-secret narrative paragraphs
  taken from the PDF. Chaosium (and other publishers') Product Identity
  remains outside the repository; keep source PDFs local and consult the
  publisher's license before any redistribution.

Compiled JSON under this entry is a play index, not a substitute for owning
the published module.
"""


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


def normalize_module_identity(identity: dict[str, Any]) -> dict[str, Any]:
    """Structured migration: legacy ``edition`` → ``rules_edition`` when absent.

    Does not guess from free text. If ``rules_edition`` is already set, leave
    ``edition`` untouched for backward-compatible readers.
    """
    out = dict(identity or {})
    rules = out.get("rules_edition")
    if not (isinstance(rules, str) and rules.strip()):
        legacy = out.get("edition")
        if isinstance(legacy, str) and legacy.strip():
            out["rules_edition"] = legacy.strip()
    return out


def _rules_edition_value(identity: dict[str, Any]) -> str | None:
    normalized = normalize_module_identity(identity)
    rules = normalized.get("rules_edition")
    if isinstance(rules, str) and rules.strip():
        return rules.strip()
    return None


def normalize_alias_key(
    title: str,
    rules_edition: str | None = None,
    chapter: str | None = None,
) -> str:
    """Orthographic normalization for alias index keys (not semantic matching).

    Shape: ``title|rules_edition`` when chapter is absent; when ``chapter`` is
    present, ``title|rules_edition|chapter``. A lookup without chapter matches
    a chapterless key only (see module docstring).
    """
    text = str(title or "").lower()
    text = _PUNCT_RE.sub("", text)
    text = _WS_RE.sub("", text)
    ed = str(rules_edition or "").lower().strip()
    ed = _PUNCT_RE.sub("", ed)
    ed = _WS_RE.sub("", ed)
    ch = str(chapter or "").lower().strip()
    ch = _PUNCT_RE.sub("", ch)
    ch = _WS_RE.sub("", ch)
    if ch:
        # Chaptered keys always include the rules_edition slot (may be empty)
        # so sibling chapters never collide with chapterless title-only keys.
        return f"{text}|{ed}|{ch}"
    return f"{text}|{ed}" if ed else text


def _empty_registry() -> dict[str, Any]:
    return {"schema_version": REGISTRY_SCHEMA_VERSION, "modules": {}, "alias_index": {}}


def _chapter_value(identity: dict[str, Any]) -> str | None:
    chapter = identity.get("chapter")
    if isinstance(chapter, str) and chapter.strip():
        return chapter.strip()
    return None


def _migrate_registry_alias_keys(coc_root: Path, registry: dict[str, Any]) -> dict[str, Any]:
    """Rebuild alias_keys from on-disk identity.json (chapter-aware).

    Structural migration only: no free-text guessing. When identity.json is
    missing, leave the summary untouched.
    """
    modules = registry.get("modules") or {}
    changed = False
    for cid, summary in list(modules.items()):
        if not isinstance(summary, dict):
            continue
        identity_path = module_dir(coc_root, str(cid)) / "identity.json"
        if not identity_path.is_file():
            continue
        try:
            identity = normalize_module_identity(
                json.loads(identity_path.read_text(encoding="utf-8"))
            )
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            continue
        alias_keys = _collect_alias_keys(identity)
        if summary.get("alias_keys") != alias_keys or summary.get("chapter") != identity.get(
            "chapter"
        ):
            summary = dict(summary)
            summary["alias_keys"] = alias_keys
            if "chapter" in identity:
                summary["chapter"] = identity.get("chapter")
            modules[cid] = summary
            changed = True
    if changed:
        registry = dict(registry)
        registry["modules"] = modules
        _rebuild_alias_index(registry)
    else:
        # Still ensure alias_index mirrors modules even if keys were already current.
        _rebuild_alias_index(registry)
    return registry


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
    return _migrate_registry_alias_keys(coc_root, raw)


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
    identity = normalize_module_identity(identity)
    return {
        "canonical_module_id": identity["canonical_module_id"],
        "canonical_title": identity["canonical_title"],
        "publisher": identity.get("publisher"),
        "edition": identity.get("edition"),
        "module_edition": identity.get("module_edition"),
        "rules_edition": identity.get("rules_edition"),
        "parent_module_id": identity.get("parent_module_id"),
        "chapter": identity.get("chapter"),
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
    identity = normalize_module_identity(identity)
    rules_edition = _rules_edition_value(identity)
    chapter = _chapter_value(identity)
    keys: list[str] = []
    seen: set[str] = set()

    def _add(title: str) -> None:
        key = normalize_alias_key(title, rules_edition, chapter=chapter)
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


def _write_license_note(entry_dir: Path) -> None:
    path = entry_dir / LICENSE_NOTE_FILENAME
    path.write_text(LICENSE_NOTE_TEXT, encoding="utf-8")


def register_module(
    coc_root: Path,
    scenario_dir: Path,
    identity: dict[str, Any],
) -> dict[str, Any]:
    """Validate scenario, write library entry + registry index, return entry."""
    scenario_dir = Path(scenario_dir)
    identity = normalize_module_identity(dict(identity))
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
    _write_license_note(entry_dir)

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
    """Exact match on canonical_module_id, else normalized alias title+rules_edition[+chapter].

    A lookup without ``chapter`` matches a chapterless alias key only.
    """
    identity = normalize_module_identity(identity or {})
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
    rules_edition = _rules_edition_value(identity)
    chapter = _chapter_value(identity)
    key = normalize_alias_key(title.strip(), rules_edition, chapter=chapter)
    owner = (registry.get("alias_index") or {}).get(key)
    if not owner:
        return None
    return _load_entry(coc_root, owner)


def _load_entry(coc_root: Path, canonical_module_id: str) -> dict[str, Any] | None:
    entry_dir = module_dir(coc_root, canonical_module_id)
    identity_path = entry_dir / "identity.json"
    if not identity_path.is_file():
        return None
    identity = normalize_module_identity(
        json.loads(identity_path.read_text(encoding="utf-8"))
    )
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

    identity = normalize_module_identity(dict(entry["identity"]))
    aliases = list(identity.get("aliases") or [])
    # Exact structured dedupe on title+locale+rules_edition[+chapter] context.
    locale = alias.get("locale")
    rules_edition = _rules_edition_value(identity)
    chapter = _chapter_value(identity)
    new_key = normalize_alias_key(title, rules_edition, chapter=chapter)
    for existing in aliases:
        if not isinstance(existing, dict):
            continue
        if normalize_alias_key(
            str(existing.get("title") or ""),
            rules_edition,
            chapter=chapter,
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


def list_family(coc_root: Path, parent_module_id: str) -> list[dict[str, Any]]:
    """List sibling chapter entries that share the same ``parent_module_id``."""
    parent = str(parent_module_id or "").strip()
    if not parent:
        raise ValueError("parent_module_id is required")
    out: list[dict[str, Any]] = []
    for summary in list_modules(coc_root):
        if str(summary.get("parent_module_id") or "").strip() == parent:
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

    family = sub.add_parser(
        "list-family",
        help="list sibling chapters sharing a parent_module_id",
    )
    family.add_argument(
        "--parent",
        required=True,
        help="parent_module_id (e.g. masks-of-nyarlathotep)",
    )

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
        if args.cmd == "list-family":
            return _emit(
                {
                    "parent_module_id": args.parent,
                    "modules": list_family(root, args.parent),
                }
            )
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
