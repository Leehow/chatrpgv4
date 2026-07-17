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
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_epistemic_compile
import coc_fileio
import coc_pdf_source
import coc_scenario_compile
import coc_starter
import coc_state

SCENARIO_FILES = coc_starter.STARTER_SCENARIO_FILES
OPTIONAL_SCENARIO_SIDECAR_FILES = coc_epistemic_compile.SIDECAR_FILES
REGISTRY_SCHEMA_VERSION = 1
IDENTITY_SCHEMA_VERSION = 1
SOURCE_INDEX_FILES = (
    "page-map.json",
    "parse-manifest.json",
    "evidence-segments.jsonl",
)
_LOCAL_SOURCE_PATH_FIELDS = {
    "base_dir",
    "module_source",
    "source_bundle_path",
    "source_pdf",
    "source_root",
}

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


def _require_safe_component(value: str, field: str) -> str:
    text = str(value or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", text):
        raise ValueError(f"{field} must be a safe path component")
    return text


def _require_contained_without_symlinks(root: Path, path: Path, field: str) -> None:
    trusted_root = Path(os.path.abspath(root))
    candidate = Path(os.path.abspath(path))
    try:
        relative = candidate.relative_to(trusted_root)
    except ValueError as exc:
        raise ValueError(f"{field} escapes its trusted root") from exc
    cursor = trusted_root
    if cursor.is_symlink():
        raise ValueError(f"{field} contains a symlink: {cursor}")
    for part in relative.parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError(f"{field} contains a symlink: {cursor}")


def _require_safe_destination_directory(path: Path, field: str) -> None:
    if path.is_symlink():
        raise ValueError(f"{field} must not be a symlink")
    if path.exists() and not path.is_dir():
        raise ValueError(f"{field} must be a directory")


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


def discover_optional_scenario_sidecars(scenario_dir: Path) -> list[str]:
    """Return present epistemic sidecar filenames, or [] when absent.

    Partial bundles are rejected: either all sidecars are present, or none.
    """
    scenario_dir = Path(scenario_dir)
    present = [
        name
        for name in OPTIONAL_SCENARIO_SIDECAR_FILES
        if (scenario_dir / name).exists()
    ]
    if not present:
        return []
    if set(present) != set(OPTIONAL_SCENARIO_SIDECAR_FILES):
        missing = sorted(set(OPTIONAL_SCENARIO_SIDECAR_FILES) - set(present))
        raise ValueError(
            "partial epistemic sidecar bundle is rejected; missing: "
            + ", ".join(missing)
        )
    for name in present:
        _contained_regular_file(scenario_dir, scenario_dir / name)
    return list(OPTIONAL_SCENARIO_SIDECAR_FILES)


def _copy_scenario_files(src: Path, dest: Path) -> list[str]:
    """Copy the seven IR files plus an optional atomic epistemic sidecar set."""
    dest.mkdir(parents=True, exist_ok=True)
    for fname in SCENARIO_FILES:
        shutil.copy2(src / fname, dest / fname)
    sidecars = discover_optional_scenario_sidecars(src)
    for fname in sidecars:
        shutil.copy2(src / fname, dest / fname)
    return sidecars


def _copy_scenario_atomic(src: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    staging = dest.parent / f".{dest.name}.staging"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True, exist_ok=True)
    try:
        _copy_scenario_files(src, staging)
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


def _contained_regular_file(root: Path, path: Path) -> Path:
    root_resolved = root.resolve()
    candidate = path if path.is_absolute() else root / path
    try:
        named = candidate.stat(follow_symlinks=False)
    except OSError as exc:
        raise ValueError(f"unsafe source index path: {path}") from exc
    if stat.S_ISLNK(named.st_mode) or not stat.S_ISREG(named.st_mode):
        raise ValueError(f"source index path must be a regular file: {path}")
    resolved = candidate.resolve()
    try:
        resolved.relative_to(root_resolved)
    except ValueError as exc:
        raise ValueError(f"source index path escapes package root: {path}") from exc
    if ".." in Path(path).parts:
        raise ValueError(f"source index path escapes package root: {path}")
    return resolved


def _is_unsafe_local_path(value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    text = value.strip().replace("\\", "/")
    path = Path(text)
    return (
        "\x00" in text
        or path.is_absolute()
        or ".." in path.parts
        or bool(re.match(r"^[A-Za-z]:/", text))
    )


def _reject_unsafe_persisted_source_paths(value: Any) -> None:
    """Reject local-machine paths only in explicitly structured source fields."""
    if isinstance(value, list):
        for item in value:
            _reject_unsafe_persisted_source_paths(item)
        return
    if not isinstance(value, dict):
        return
    for key, item in value.items():
        source_ref_path = key == "path" and (
            "source_id" in value
            or any(
                locator in value
                for locator in ("grep_anchor", "page", "pdf_index", "printed_page")
            )
        )
        if (key in _LOCAL_SOURCE_PATH_FIELDS or source_ref_path) and _is_unsafe_local_path(item):
            raise ValueError(f"absolute or unsafe local source path is not allowed in {key}")
        _reject_unsafe_persisted_source_paths(item)


def _validate_scenario_source_paths(scenario_dir: Path) -> None:
    for filename in SCENARIO_FILES:
        path = _contained_regular_file(scenario_dir, scenario_dir / filename)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"invalid scenario JSON in {filename}: {exc}") from exc
        _reject_unsafe_persisted_source_paths(payload)


def _discover_source_index_dir(scenario_dir: Path) -> Path | None:
    """Return sibling package index/ when present as an atomic optional bundle."""
    package_root = Path(scenario_dir).resolve().parent
    index_dir = package_root / "index"
    if not index_dir.exists():
        return None
    try:
        named = index_dir.stat(follow_symlinks=False)
    except OSError as exc:
        raise ValueError("unsafe source index directory") from exc
    if stat.S_ISLNK(named.st_mode) or not stat.S_ISDIR(named.st_mode):
        raise ValueError("source index directory must be a real directory")
    present = []
    for name in SOURCE_INDEX_FILES:
        candidate = index_dir / name
        if candidate.exists():
            _contained_regular_file(index_dir, candidate)
            present.append(name)
    if not present:
        return None
    if set(present) != set(SOURCE_INDEX_FILES):
        missing = sorted(set(SOURCE_INDEX_FILES) - set(present))
        raise ValueError(
            "partial source evidence bundle is rejected; missing: "
            + ", ".join(missing)
        )
    return index_dir


def _load_and_strip_source_bundle(
    index_dir: Path, *, expected_scenario_id: str | None = None
) -> dict[str, Any]:
    page_map = json.loads((index_dir / "page-map.json").read_text(encoding="utf-8"))
    parse_manifest = json.loads(
        (index_dir / "parse-manifest.json").read_text(encoding="utf-8")
    )
    segments: list[dict[str, Any]] = []
    for line in (index_dir / "evidence-segments.jsonl").read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if not isinstance(row, dict):
            raise ValueError("evidence segment rows must be objects")
        segments.append(row)
    if not isinstance(page_map, dict) or not isinstance(parse_manifest, dict):
        raise ValueError("source evidence page-map/parse-manifest must be objects")
    for filename, payload in (
        ("page-map.json", page_map),
        ("parse-manifest.json", parse_manifest),
    ):
        if payload.get("schema_version") != 1:
            raise ValueError(f"invalid source evidence {filename}: schema_version must be 1")
        scenario_id = str(payload.get("scenario_id") or "").strip()
        if not scenario_id:
            raise ValueError(f"invalid source evidence {filename}: scenario_id is required")
        if expected_scenario_id is not None and scenario_id != expected_scenario_id:
            raise ValueError(
                f"source evidence scenario_id {scenario_id!r} in {filename} "
                f"does not match scenario {expected_scenario_id!r}"
            )
    if page_map["scenario_id"] != parse_manifest["scenario_id"]:
        raise ValueError("source evidence scenario_id values do not match")

    sources = page_map.get("sources")
    ranges = parse_manifest.get("ranges")
    if not isinstance(sources, list) or not isinstance(ranges, list):
        raise ValueError("source evidence sources/ranges must be lists")
    source_by_id: dict[str, dict[str, Any]] = {}
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("source evidence source entries must be objects")
        source_id = str(source.get("source_id") or "").strip()
        if not source_id or source_id in source_by_id:
            raise ValueError("source evidence source_id values must be unique and non-empty")
        if not isinstance(source.get("pages"), list):
            raise ValueError(f"source evidence pages for {source_id!r} must be a list")
        source_by_id[source_id] = source
    for record in ranges:
        if not isinstance(record, dict):
            raise ValueError("source evidence range entries must be objects")
        source_id = str(record.get("source_id") or "").strip()
        source = source_by_id.get(source_id)
        if source is None:
            raise ValueError(f"source evidence range has unknown source_id {source_id!r}")
        if not isinstance(record.get("pdf_indices"), list):
            raise ValueError("source evidence range pdf_indices must be a list")
        source_hash = str(source.get("file_sha256") or "").strip()
        range_hash = str(record.get("file_sha256") or "").strip()
        if source_hash and range_hash and source_hash != range_hash:
            raise ValueError(f"source evidence hash binding mismatch for {source_id!r}")
    for segment in segments:
        source_id = str(segment.get("source_id") or "").strip()
        if source_id not in source_by_id:
            raise ValueError(f"source evidence segment has unknown source_id {source_id!r}")
        locator = segment.get("locator")
        if not isinstance(locator, dict) or coc_pdf_source.resolve_locator(
            {"source_id": source_id, **locator}, page_map
        ) is None:
            raise ValueError(
                f"invalid source evidence locator for {segment.get('segment_id')!r}"
            )
        declared_hash = str(segment.get("text_sha256") or "").strip()
        local_text = segment.get("text")
        if isinstance(local_text, str):
            actual_hash = hashlib.sha256(local_text.encode("utf-8")).hexdigest()
            if not declared_hash or declared_hash != actual_hash:
                raise ValueError(
                    f"source evidence text_sha256 mismatch for {segment.get('segment_id')!r}"
                )
        elif not declared_hash:
            raise ValueError(
                f"source evidence text_sha256 is required for {segment.get('segment_id')!r}"
            )
    # Never persist absolute staging roots into the library entry.
    if "source_root" in page_map:
        page_map = dict(page_map)
        page_map.pop("source_root", None)
    bundle = {
        "page_map": page_map,
        "parse_manifest": parse_manifest,
        "evidence_segments": segments,
    }
    _reject_unsafe_persisted_source_paths(bundle)
    return coc_pdf_source.strip_local_evidence_text(bundle)


def _write_source_index_bundle(package_root: Path, bundle: dict[str, Any]) -> dict[str, str]:
    """Transactionally replace the three source members, preserving other index files."""
    package_root = Path(package_root)
    _require_safe_destination_directory(package_root, "source evidence package")
    package_root.mkdir(parents=True, exist_ok=True)
    index_dir = package_root / "index"
    _require_safe_destination_directory(index_dir, "source evidence index")
    index_dir.mkdir(parents=True, exist_ok=True)
    targets = {name: index_dir / name for name in SOURCE_INDEX_FILES}
    for name, target in targets.items():
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise ValueError(f"source evidence target must be a regular file: {name}")

    with tempfile.TemporaryDirectory(prefix=".source-evidence-", dir=package_root) as temporary:
        temporary_root = Path(temporary)
        staging_root = temporary_root / "payload"
        coc_pdf_source.write_source_bundle(
            staging_root,
            bundle["page_map"],
            bundle["parse_manifest"],
            bundle["evidence_segments"],
        )
        staged_index = staging_root / "index"
        backup_dir = temporary_root / "backup"
        backup_dir.mkdir()
        backups: dict[str, Path] = {}
        installed: list[str] = []
        try:
            for name in SOURCE_INDEX_FILES:
                target = targets[name]
                if target.exists():
                    backup = backup_dir / name
                    target.replace(backup)
                    backups[name] = backup
                (staged_index / name).replace(target)
                installed.append(name)
        except BaseException:
            for name in reversed(installed):
                targets[name].unlink(missing_ok=True)
            for name, backup in backups.items():
                backup.replace(targets[name])
            raise
    return {name: str(targets[name]) for name in SOURCE_INDEX_FILES}


def _preflight_campaign_source_index(campaign_dir: Path) -> None:
    index_dir = campaign_dir / "index"
    if index_dir.is_symlink():
        raise ValueError("campaign source evidence index must not be a symlink")
    if index_dir.exists() and not index_dir.is_dir():
        raise ValueError("campaign source evidence index must be a directory")
    present: list[str] = []
    for name in SOURCE_INDEX_FILES:
        member = index_dir / name
        if member.is_symlink():
            raise ValueError(f"campaign source evidence member must not be a symlink: {name}")
        if member.exists():
            if not member.is_file():
                raise ValueError(f"campaign source evidence member must be a file: {name}")
            present.append(name)
    if present and set(present) != set(SOURCE_INDEX_FILES):
        missing = sorted(set(SOURCE_INDEX_FILES) - set(present))
        raise ValueError(
            "campaign source evidence bundle must contain all members; missing: "
            + ", ".join(missing)
        )


def _install_stripped_index_bundle(
    entry_index: Path, campaign_dir: Path, *, expected_scenario_id: str
) -> dict[str, str]:
    """Copy a library index bundle into the campaign and rebind source_root locally."""
    if not entry_index.is_dir():
        return {}
    for name in SOURCE_INDEX_FILES:
        _contained_regular_file(entry_index, entry_index / name)
    bundle = _load_and_strip_source_bundle(
        entry_index, expected_scenario_id=expected_scenario_id
    )
    # Fail closed if registry somehow retained local prose.
    for segment in bundle.get("evidence_segments") or []:
        if isinstance(segment, dict) and "text" in segment:
            raise ValueError("registry source evidence must not contain text")
    return _write_source_index_bundle(campaign_dir, bundle)


def _register_source_index(
    scenario_dir: Path, entry_dir: Path, *, expected_scenario_id: str
) -> dict[str, str]:
    index_dir = _discover_source_index_dir(scenario_dir)
    if index_dir is None:
        return {}
    bundle = _load_and_strip_source_bundle(
        index_dir, expected_scenario_id=expected_scenario_id
    )
    for segment in bundle.get("evidence_segments") or []:
        if isinstance(segment, dict) and "text" in segment:
            raise ValueError("stripped source evidence still contains text")
    return _write_source_index_bundle(entry_dir, bundle)


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
    _validate_scenario_source_paths(scenario_dir)

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
    _require_contained_without_symlinks(
        library_root(coc_root), entry_dir, "module library entry"
    )
    _require_safe_destination_directory(entry_dir, "module library entry")
    entry_dir.mkdir(parents=True, exist_ok=True)
    _copy_scenario_atomic(scenario_dir, entry_dir / "scenario")
    scenario_meta = json.loads(
        (scenario_dir / "module-meta.json").read_text(encoding="utf-8")
    )
    expected_scenario_id = str(scenario_meta.get("scenario_id") or "").strip()
    source_evidence_paths = _register_source_index(
        scenario_dir, entry_dir, expected_scenario_id=expected_scenario_id
    )
    has_source_index = bool(source_evidence_paths)
    sidecar_names = discover_optional_scenario_sidecars(entry_dir / "scenario")
    coc_fileio.write_json_atomic(
        entry_dir / "identity.json",
        identity,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )
    _write_license_note(entry_dir)

    registry["modules"][cid] = _summary_for(identity, alias_keys=alias_keys)
    if has_source_index:
        registry["modules"][cid]["has_source_index"] = True
    if sidecar_names:
        registry["modules"][cid]["has_epistemic_sidecars"] = True
    _rebuild_alias_index(registry)
    _write_registry(coc_root, registry)

    return {
        "canonical_module_id": cid,
        "path": str(entry_dir),
        "identity": identity,
        "summary": registry["modules"][cid],
        "validation_warnings": result.get("warnings") or [],
        "has_source_index": has_source_index,
        "source_evidence_paths": source_evidence_paths,
        "has_epistemic_sidecars": bool(sidecar_names),
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
    canonical_module_id = _require_safe_component(
        canonical_module_id, "canonical_module_id"
    )
    campaign_id = _require_safe_component(campaign_id, "campaign_id")
    entry = _load_entry(coc_root, canonical_module_id)
    if entry is None:
        raise FileNotFoundError(f"unknown module: {canonical_module_id}")

    base = _coc_root(coc_root)
    campaign_dir = base / "campaigns" / campaign_id
    _require_contained_without_symlinks(
        base / "campaigns", campaign_dir, "campaign directory"
    )
    if not campaign_dir.is_dir():
        raise FileNotFoundError(f"unknown campaign: {campaign_id}")

    src_dir = Path(entry["scenario_dir"])
    meta = json.loads((src_dir / "module-meta.json").read_text(encoding="utf-8"))
    scenario_id = str(meta.get("scenario_id") or canonical_module_id)
    entry_index = Path(entry["path"]) / "index"
    if entry_index.is_dir():
        _preflight_campaign_source_index(campaign_dir)
        _load_and_strip_source_bundle(
            entry_index, expected_scenario_id=scenario_id
        )
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
    sidecars = discover_optional_scenario_sidecars(src_dir)
    for fname in sidecars:
        shutil.copy2(src_dir / fname, scenario_dir / fname)

    source_evidence_paths: dict[str, str] = {}
    if entry_index.is_dir():
        source_evidence_paths = _install_stripped_index_bundle(
            entry_index,
            campaign_dir,
            expected_scenario_id=scenario_id,
        )

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

    installed_paths = {fname: str(scenario_dir / fname) for fname in SCENARIO_FILES}
    for fname in sidecars:
        installed_paths[fname] = str(scenario_dir / fname)
    return {
        "canonical_module_id": canonical_module_id,
        "campaign_id": campaign_id,
        "scenario_id": scenario_id,
        "scenario_dir": str(scenario_dir),
        "paths": installed_paths,
        "has_source_index": (campaign_dir / "index" / "page-map.json").is_file(),
        "source_evidence_paths": source_evidence_paths,
        "has_epistemic_sidecars": bool(sidecars),
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
