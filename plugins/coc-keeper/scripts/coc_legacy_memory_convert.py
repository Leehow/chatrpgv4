#!/usr/bin/env python3
"""Offline, explicit, idempotent converter: legacy Markdown memory cards ->
canonical ``temporal-memory-1`` records in a FRESH target campaign.

Standing laws encoded here:

- The source campaign is read-only byte-for-byte — campaign files AND the
  Git sidecar. No rename, cleanup, in-place migration, deletion, or sidecar
  rewrite ever happens. After the run, the source snapshot digest is
  recomputed and must match; any drift fails the run loudly.
- Both campaign ids are caller-supplied. The suggested target suffix
  (``-temporal-import-1``) is a hint only — this tool never chooses,
  appends, or overwrites anything silently. Same-id conversion, an existing
  incompatible target, and path escapes (including nested symlinks) are
  rejected.
- Provenance is proven, never invented: a card is importable only when its
  exact current bytes are committed on the source campaign's ACTIVE
  timeline lineage AND the introducing commit carries canonical turn +
  finalization trailers. ``--all`` ref scans are never used: fork/branch
  content that is absent from the active lineage quarantines. Cards without
  that evidence are quarantined in the manifest and never materialized as
  canonical assertions. ``source_commit``, ``source_turn``, receipts,
  identity, and turns always come from real evidence.
- Terminal hook states are materialized through a converter-owned
  deterministic successor/supersession write that binds the VERIFIED
  resolution commit/turn/finalization receipt — never through a generic
  resolver that would synthesize provenance. The base assertion is closed
  by the one sanctioned ``plan_supersession`` delta; the full bundle is
  validated before publication.
- Crash safety: the whole target generation is built in a non-canonical
  staging directory and published by one atomic rename. The completion
  receipt travels inside the staged generation, so a published target is
  never without one. Post-publish side effects (sidecar baseline commit,
  campaign index entry) are idempotent and repaired on resume. Staging is
  disposable by construction: it is rebuilt deterministically from the
  source, never trusted as input, so partial or tampered staging cannot
  influence any outcome.
- Replay: the receipt binds the source snapshot digest, the source sidecar
  ref-tip digest, and the provenance commits. On replay the source proof,
  the full target store (file digests + per-record digests), the manifest,
  and the receipt itself are re-verified before an idempotent success is
  returned. Any drift or tampering fails closed.
- Context packs are derived retrieval artifacts: hashed into the manifest,
  never converted. Session summaries are continuation evidence: preserved
  in place, never bulk-converted.
- Semantic mapping is conservative: legacy ``scope`` must be ``campaign``;
  opaque memory ids quarantine; ``npc_relationship`` resolves an EXACT
  investigator subject from the source campaign's party identity or
  quarantines — relationships are never broadened to the party.
- This module deliberately does NOT import ``coc_memory.py`` (slated for
  retirement). The legacy card grammar is reproduced below as a frozen
  tombstone of the retired schema so the converter survives legacy-module
  removal.

The semantic decision of *whether* a historical card is still true is never
made here: imported records keep their historical validity window and are
advisory memory for the live KP to judge, exactly like all temporal memory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_fileio
import coc_git_history as git_history
import coc_state
import coc_temporal_memory as temporal_memory
from coc_temporal_memory_contract import (
    MAX_STATEMENT_CHARS,
    ROOT_TIMELINE_ID,
    SCHEMA_GENERATION,
    plan_supersession,
    validate_assertion_bundle,
)

TOOL_NAME = "coc_legacy_memory_convert"

#: Suggested (never auto-applied) target campaign suffix.
SUGGESTED_TARGET_SUFFIX = "-temporal-import-1"

# ---------------------------------------------------------------------------
# Frozen tombstone of the retired legacy card schema (see module docstring)
# ---------------------------------------------------------------------------

LEGACY_CARD_KINDS: tuple[str, ...] = (
    "fact",
    "event",
    "npc_relationship",
    "unresolved_hook",
    "foreshadowing",
    "player_preference",
    "keeper_correction",
)
LEGACY_HOOK_KINDS: tuple[str, ...] = ("unresolved_hook", "foreshadowing")
LEGACY_HOOK_STATUSES: tuple[str, ...] = ("open", "resolved", "paid_off", "abandoned")
LEGACY_TERMINAL_HOOK_STATUSES: tuple[str, ...] = ("resolved", "paid_off", "abandoned")
LEGACY_PRIVACY_DIRS: dict[str, str] = {
    "player_safe": "player-safe",
    "keeper_only": "keeper-only",
    "system_only": "keeper-only",
}
#: Privacy projection: never downgrade visibility.
LEGACY_PRIVACY_TO_CANONICAL: dict[str, str] = {
    "player_safe": "player_safe",
    "keeper_only": "keeper_only",
    "system_only": "keeper_only",
}

#: Legacy entity-ref prefixes with a deterministic canonical entity kind.
#: A ref without a recognized prefix is never kind-guessed; it is recorded
#: as ``unmapped_entity_refs`` in the manifest instead.
LEGACY_ENTITY_PREFIX_KINDS: tuple[tuple[str, str], ...] = (
    ("npc-", "person"),
    ("inv-", "person"),
    ("investigator-", "person"),
    ("loc-", "location"),
    ("location-", "location"),
    ("item-", "item"),
    ("clue-", "clue"),
    ("org-", "organization"),
    ("organization-", "organization"),
    ("creature-", "creature"),
    ("event-", "event"),
    ("concept-", "concept"),
)
_INVESTIGATOR_REF_PREFIXES: tuple[str, ...] = ("inv-", "investigator-")

_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
#: Legacy memory ids must be already-semantic: the converter republishes
#: them inside target ids and never invents slug tails for opaque input.
_MEMORY_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_SLUG_RE = re.compile(r"[^a-z0-9]+")
_TRAILING_TURN_RE = re.compile(r"(\d+)$")
_GIT_OID_RE = re.compile(r"^[0-9a-f]{40,64}$")
_MAX_ID_LEN = 128

QUARANTINE_MISSING_GIT_SIDECAR = "missing_git_sidecar"
QUARANTINE_EMPTY_GIT_HISTORY = "empty_git_history"
QUARANTINE_GIT_UNAVAILABLE = "git_history_unavailable"
QUARANTINE_PATH_NOT_IN_HISTORY = "path_not_in_active_history"
QUARANTINE_CONTENT_NOT_COMMITTED = "content_not_committed"
QUARANTINE_UNPROVABLE_TURN = "unprovable_turn_or_finalization"
QUARANTINE_MODIFIED_AFTER_INTRODUCTION = "modified_after_introduction"
QUARANTINE_UNPROVABLE_RESOLUTION = "unprovable_resolution_provenance"


class LegacyConversionError(ValueError):
    """Caller- or state-level rejection. Quarantine is NOT an error."""


# ---------------------------------------------------------------------------
# Small deterministic helpers
# ---------------------------------------------------------------------------


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_text(text: str) -> str:
    return _sha256_bytes(text.encode("utf-8"))


def _git_blob_sha(data: bytes) -> str:
    """Git object id of ``data`` as a blob (loose-object header + sha1)."""
    return hashlib.sha1(b"blob %d\x00" % len(data) + data).hexdigest()


def _slug_token(value: Any) -> str:
    """Deterministic semantic slug for already-validated semantic input."""
    text = _SLUG_RE.sub("-", str(value or "").strip().lower()).strip("-")
    if text:
        return text
    raise LegacyConversionError(
        f"cannot derive a semantic slug from {value!r}; refusing to invent "
        "an opaque identifier"
    )


def _prefixed_id(prefix: str, value: str) -> str:
    budget = _MAX_ID_LEN - len(prefix)
    if budget < 8:
        raise LegacyConversionError(
            f"semantic id prefix {prefix!r} leaves no room for a slug tail"
        )
    return prefix + _slug_token(value)[:budget]


def target_assertion_id(target_campaign_id: str, memory_id: str) -> str:
    return _prefixed_id(f"mem-{target_campaign_id}-legacy-", str(memory_id))


def target_hook_id(target_campaign_id: str, memory_id: str) -> str:
    return _prefixed_id(f"hook-{target_campaign_id}-legacy-", str(memory_id))


def _map_entity_ref(token: str) -> str | None:
    """Deterministic canonical entity id for a legacy ref, or None.

    Only recognized prefixes are mapped; nothing is kind-guessed.
    """
    text = str(token or "").strip()
    for prefix, kind in LEGACY_ENTITY_PREFIX_KINDS:
        if text.startswith(prefix):
            tail = text[len(prefix):]
            if not _slug_token(tail).strip("-"):
                return None
            return f"entity-{kind}-{_slug_token(tail)}"
    return None


# ---------------------------------------------------------------------------
# Legacy frontmatter parser (frozen tombstone of the retired grammar)
# ---------------------------------------------------------------------------


def parse_legacy_frontmatter(text: str) -> tuple[dict[str, Any] | None, str]:
    """Parse one legacy card file's frontmatter exactly like the retired
    writer's grammar (``key: value`` plus ``  - item`` lists, int/float
    coercion). Returns ``(meta, error)``; ``meta`` is None on structure
    errors that the legacy parser would also have rejected.
    """
    if not text.startswith("---\n"):
        return None, "card does not start with '---' frontmatter marker"
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None, "frontmatter closing '---' marker missing"
    meta: dict[str, Any] = {"body": parts[2].strip()}
    current_list_key: str | None = None
    current_list: list[str] = []
    for line in parts[1].splitlines():
        list_item = re.match(r"^\s*-\s+(.+)$", line)
        if list_item and current_list_key:
            current_list.append(list_item.group(1).strip())
            continue
        m = re.match(r"^([a-z_]+):\s*(.*)$", line)
        if m:
            if current_list_key and current_list:
                meta[current_list_key] = current_list
            key, val = m.group(1), m.group(2).strip()
            current_list_key = key if val == "" else None
            current_list = []
            if val:
                try:
                    meta[key] = float(val) if "." in val else int(val)
                except ValueError:
                    meta[key] = val
    if current_list_key and current_list:
        meta[current_list_key] = current_list
    return meta, ""


def validate_legacy_card(meta: dict[str, Any], *, privacy_dir: str) -> list[str]:
    """Clean-slate validation mirroring the retired schema checks plus the
    privacy/path agreement, scope, and semantic-id rules. Empty list means
    valid."""
    errors: list[str] = []
    memory_id = meta.get("memory_id")
    if (
        not isinstance(memory_id, str)
        or _MEMORY_ID_RE.fullmatch(memory_id) is None
        or _slug_token(memory_id) != memory_id.lower()
    ):
        errors.append(
            f"invalid, opaque, or missing memory_id {memory_id!r}; expected a "
            "semantic kebab identifier"
        )
    if meta.get("scope") != "campaign":
        errors.append(
            f"unsupported scope {meta.get('scope')!r}; only campaign-scoped "
            "legacy cards are convertible"
        )
    kind = meta.get("kind")
    if kind not in LEGACY_CARD_KINDS:
        errors.append(
            f"invalid or missing kind {kind!r}; expected one of "
            f"{', '.join(LEGACY_CARD_KINDS)}"
        )
        return errors
    status = meta.get("status")
    if kind in LEGACY_HOOK_KINDS:
        if status is not None and status not in LEGACY_HOOK_STATUSES:
            errors.append(
                f"invalid status {status!r} for hook kind {kind!r}; expected "
                f"one of {', '.join(LEGACY_HOOK_STATUSES)}"
            )
    else:
        if status is not None:
            errors.append(
                f"status is only valid for hook kinds, not kind {kind!r}"
            )
        if meta.get("resolved_at"):
            errors.append(
                f"resolved_at is only valid for hook kinds, not kind {kind!r}"
            )
    privacy = meta.get("privacy")
    if privacy not in LEGACY_PRIVACY_TO_CANONICAL:
        errors.append(f"invalid or missing privacy {privacy!r}")
    elif LEGACY_PRIVACY_DIRS[privacy] != privacy_dir:
        errors.append(
            f"privacy {privacy!r} disagrees with storage dir {privacy_dir!r}"
        )
    return errors


# ---------------------------------------------------------------------------
# Path safety (strict containment; every symlink component rejected)
# ---------------------------------------------------------------------------


def _assert_no_symlink_components(base: Path, child: Path, *, label: str) -> None:
    """Reject any symlink along ``base -> child`` and any escape."""
    current = base
    for part in child.relative_to(base).parts:
        current = current / part
        if current.is_symlink():
            raise LegacyConversionError(
                f"{label} path contains a symlink component: {current}"
            )
    resolved_child = child.resolve(strict=False)
    resolved_base = base.resolve(strict=False)
    try:
        resolved_child.relative_to(resolved_base)
    except ValueError as exc:
        raise LegacyConversionError(f"{label} path escapes its root") from exc


def _assert_real_subpath(
    anchor: Path,
    *parts: str,
    label: str,
    missing_tail: int = 0,
) -> Path:
    """Strict component walk from a trusted anchor: every existing component
    must be a REAL directory (never a symlink), and the final
    ``missing_tail`` components may be absent. Any pre-existing nested
    symlink anywhere along the chain fails closed BEFORE any read, write,
    cleanup, publish, or commit happens."""
    if not parts:
        raise LegacyConversionError(f"{label} path needs components")
    current = anchor
    stop_exist = len(parts) - missing_tail
    for index, part in enumerate(parts):
        current = current / part
        try:
            info = os.lstat(current)
        except FileNotFoundError:
            if index >= stop_exist:
                return current
            raise LegacyConversionError(
                f"{label} path is missing: {current}"
            ) from None
        if stat.S_ISLNK(info.st_mode):
            raise LegacyConversionError(
                f"{label} path contains a symlink component: {current}"
            )
        if not stat.S_ISDIR(info.st_mode):
            raise LegacyConversionError(
                f"{label} path component is not a directory: {current}"
            )
    return current


def _safe_campaign_dir(
    root: Path,
    campaign_id: str,
    *,
    label: str,
    must_exist: bool | None = None,
) -> Path:
    """Validated campaign directory: safe id, every component of the
    ``<root>/.coc/campaigns/<id>`` chain real (no nested symlinks), and the
    leaf, when present, a real directory."""
    if not isinstance(campaign_id, str) or _SAFE_ID.fullmatch(campaign_id) is None:
        raise LegacyConversionError(
            f"{label} campaign id {campaign_id!r} is not a safe stable id"
        )
    campaigns = _assert_real_subpath(
        root, ".coc", "campaigns", label=label, missing_tail=1
    )
    campaign_dir = campaigns / campaign_id
    try:
        info = os.lstat(campaign_dir)
    except FileNotFoundError:
        if must_exist:
            raise LegacyConversionError(
                f"{label} campaign does not exist: {campaign_id}"
            ) from None
        return campaign_dir
    if stat.S_ISLNK(info.st_mode):
        raise LegacyConversionError(
            f"{label} campaign path is a symlink: {campaign_dir}"
        )
    if not stat.S_ISDIR(info.st_mode):
        raise LegacyConversionError(
            f"{label} campaign path is not a directory: {campaign_dir}"
        )
    return campaign_dir


def _assert_sidecar_chain(root: Path, campaign_id: str, *, label: str) -> Path:
    """Every component of the sidecar repo path
    ``<root>/.coc/repos/campaigns/<id>.git`` must be real before any Git
    command is pointed at it."""
    repos = _assert_real_subpath(
        root, ".coc", "repos", "campaigns", label=f"{label} Git sidecar",
        missing_tail=2,
    )
    repo = repos / f"{campaign_id}.git"
    try:
        info = os.lstat(repo)
    except FileNotFoundError:
        return repo
    if stat.S_ISLNK(info.st_mode):
        raise LegacyConversionError(
            f"{label} Git sidecar repo path is a symlink: {repo}"
        )
    if not stat.S_ISDIR(info.st_mode):
        raise LegacyConversionError(
            f"{label} Git sidecar repo path is not a directory: {repo}"
        )
    return repo


def _import_lock_path(root: Path, target_campaign_id: str) -> Path:
    """Symlink-safe workspace-wide conversion lock path.

    ONE lock for every target id: the campaign-index update is a shared
    read-modify-write across all conversions, so different-target runs must
    serialize too, not only same-target runs.
    """
    _safe_campaign_dir(root, target_campaign_id, label="target")
    locks_dir = _assert_real_subpath(
        root, ".coc", "locks", label="import lock", missing_tail=1
    )
    locks_dir.mkdir(parents=True, exist_ok=True)
    lock_path = locks_dir / "legacy-conversion.lock"
    if os.path.lexists(lock_path):
        if os.path.islink(lock_path):
            raise LegacyConversionError(
                f"import lock path is a symlink: {lock_path}"
            )
        if not stat.S_ISREG(os.lstat(lock_path).st_mode):
            raise LegacyConversionError(
                f"import lock path is not a regular file: {lock_path}"
            )
    return lock_path


def _open_import_lock(root: Path, target_campaign_id: str):
    """Serialize staging cleanup/build, publish, sidecar baseline creation,
    and the SHARED campaign-index update for all targets behind the
    canonical descriptor-owned workspace-wide flock (``coc_fileio``), so
    concurrent conversions converge (the loser becomes a replay) or fail
    cleanly, no process deletes another's staging tree, and index updates
    can never race or lose entries."""
    lock_path = _import_lock_path(root, target_campaign_id)
    try:
        return coc_fileio.advisory_file_lock(lock_path, wait_seconds=120.0)
    except coc_fileio.CampaignLockError as exc:
        raise LegacyConversionError(
            f"another legacy conversion holds the import lock for "
            f"{target_campaign_id}; failing cleanly"
        ) from exc


def _staging_root_for(root: Path, target_campaign_id: str) -> Path:
    """Non-canonical staging home for one target generation.

    Lives outside ``campaigns/`` so a staged generation is never visible as
    a campaign until the single atomic publish rename. Every component is
    verified real before any cleanup or build touches it.
    """
    _safe_campaign_dir(root, target_campaign_id, label="target")
    staging_home = _assert_real_subpath(
        root, ".coc", "legacy-import-staging",
        label="legacy-import staging", missing_tail=1,
    )
    staging_root = staging_home / target_campaign_id
    if os.path.lexists(staging_root) and os.path.islink(staging_root):
        raise LegacyConversionError(
            f"legacy-import staging path is a symlink: {staging_root}"
        )
    if os.path.lexists(staging_root) and not stat.S_ISDIR(
        os.lstat(staging_root).st_mode
    ):
        raise LegacyConversionError(
            f"legacy-import staging path is not a directory: {staging_root}"
        )
    return staging_root


def _assert_target_memory_tree_clean(target_dir: Path) -> None:
    """No symlink may exist anywhere under the target campaign's memory
    tree; replay reads store/manifest/receipt bytes only through real
    files."""
    memory_root = target_dir / "memory"
    if not memory_root.is_dir() or memory_root.is_symlink():
        raise LegacyConversionError("target memory tree is missing or unsafe")
    for path in sorted(memory_root.rglob("*")):
        if path.is_symlink():
            raise LegacyConversionError(
                f"target memory tree contains a symlink: {path}"
            )


def _atomic_write_json(base: Path, relpath: str, payload: Any) -> None:
    """Contained, crash-atomic JSON write (temp file + fsync + replace).
    Every component of ``base/relpath`` must be a real directory; no write
    may escape ``base``."""
    path = base / relpath
    _assert_no_symlink_components(base, path, label="conversion evidence write")
    path.parent.mkdir(parents=True, exist_ok=True)
    coc_state.write_json_atomic(path, payload)


# ---------------------------------------------------------------------------
# Read-only source access
# ---------------------------------------------------------------------------


def _snapshot_from_bytes(files: dict[str, bytes]) -> dict[str, Any]:
    """Canonical byte inventory used for both live and historical sources."""
    inventory = {
        relpath: {"sha256": _sha256_bytes(data), "bytes": len(data)}
        for relpath, data in sorted(files.items())
    }
    return {
        "files": inventory,
        "digest": _sha256_text(
            "\n".join(
                f"{rel}:{inventory[rel]['sha256']}" for rel in sorted(inventory)
            )
        ),
    }


def _snapshot_directory(directory: Path, *, label: str) -> tuple[dict[str, Any], dict[str, bytes]]:
    """Read every regular file beneath a trusted directory without ever
    following a symlink.  The returned raw bytes are only used for an
    immutable Git-tree view; live-source callers retain their path-based
    readers so no temporary source copy is materialized."""
    try:
        info = os.lstat(directory)
    except FileNotFoundError as exc:
        raise LegacyConversionError(f"{label} path is missing: {directory}") from exc
    if stat.S_ISLNK(info.st_mode):
        raise LegacyConversionError(f"{label} path is a symlink: {directory}")
    if not stat.S_ISDIR(info.st_mode):
        raise LegacyConversionError(f"{label} path is not a directory: {directory}")
    raw_files: dict[str, bytes] = {}
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise LegacyConversionError(
                f"{label} contains a symlink path; refusing to read outside "
                f"its root: {path}"
            )
        if path.is_dir():
            continue
        if not path.is_file():
            raise LegacyConversionError(f"{label} contains a non-regular path: {path}")
        relpath = path.relative_to(directory).as_posix()
        raw_files[relpath] = path.read_bytes()
    return _snapshot_from_bytes(raw_files), raw_files


def _source_snapshot(campaign_dir: Path) -> dict[str, Any]:
    """Read-only inventory of the ENTIRE live source campaign tree."""
    snapshot, _ = _snapshot_directory(campaign_dir, label="source campaign")
    return snapshot


def _sidecar_snapshot(root: Path, campaign_id: str) -> dict[str, Any]:
    """Byte-for-byte inventory of the source sidecar before/after a run.

    Git reads are configured not to take optional locks, but this independent
    snapshot is the preservation proof: ref-tip equality alone would miss a
    changed object, config, or packed ref.  Alternate object stores would
    make a historical tree escape this sidecar, so they are rejected.
    """
    repo = _assert_sidecar_chain(root, campaign_id, label="source")
    if not repo.exists():
        return {"present": False, **_snapshot_from_bytes({})}
    alternates = repo / "objects" / "info" / "alternates"
    if os.path.lexists(alternates):
        raise LegacyConversionError(
            "source Git sidecar uses alternate object storage; refusing an "
            "external historical source"
        )
    snapshot, _ = _snapshot_directory(repo, label="source Git sidecar")
    if any(relpath.endswith(".lock") for relpath in snapshot["files"]):
        raise LegacyConversionError(
            "source Git sidecar has an active lock; refusing a concurrent "
            "historical source"
        )
    return {"present": True, **snapshot}


def _card_from_bytes(relpath: str, privacy_dir: str, data: bytes) -> dict[str, Any]:
    return {
        "relpath": relpath,
        "privacy_dir": privacy_dir,
        "sha256": _sha256_bytes(data),
        "bytes": len(data),
        "raw_bytes": data,
        "text": data.decode("utf-8", errors="replace"),
    }


def _discover_cards(campaign_dir: Path) -> list[dict[str, Any]]:
    """Inventory live legacy card files (read-only) from both privacy dirs."""
    cards: list[dict[str, Any]] = []
    cards_root = campaign_dir / "memory" / "cards"
    if not cards_root.is_dir():
        return cards
    for privacy_dir in ("player-safe", "keeper-only"):
        d = cards_root / privacy_dir
        if not d.is_dir():
            continue
        for path in sorted(d.glob("*.md")):
            _assert_no_symlink_components(campaign_dir, path, label="source card")
            if path.is_file():
                cards.append(
                    _card_from_bytes(
                        path.relative_to(campaign_dir).as_posix(),
                        privacy_dir,
                        path.read_bytes(),
                    )
                )
    return cards


def _discover_cards_from_tree(files: dict[str, bytes]) -> list[dict[str, Any]]:
    """Inventory cards directly from a validated immutable Git tree."""
    cards: list[dict[str, Any]] = []
    for privacy_dir in ("player-safe", "keeper-only"):
        prefix = f"memory/cards/{privacy_dir}/"
        for relpath, data in sorted(files.items()):
            leaf = relpath.removeprefix(prefix)
            if not relpath.startswith(prefix) or "/" in leaf or not leaf.endswith(".md"):
                continue
            cards.append(_card_from_bytes(relpath, privacy_dir, data))
    return cards


# ---------------------------------------------------------------------------
# Provenance (read-only Git against the source sidecar; active lineage only)
# ---------------------------------------------------------------------------


def _git_env() -> dict[str, str]:
    env = os.environ.copy()
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    env["GIT_TERMINAL_PROMPT"] = "0"
    # Historical source inspection must never write an index/lock or honor a
    # replacement-object graph outside the sidecar snapshot we verify.
    env["GIT_OPTIONAL_LOCKS"] = "0"
    env["GIT_NO_REPLACE_OBJECTS"] = "1"
    for key in (
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ):
        env.pop(key, None)
    return env


def _git(
    repo: Path,
    worktree: Path,
    *args: str,
    check: bool = True,
    input_text: str | None = None,
) -> str:
    git = git_history._git_executable()
    cmd = [git, f"--git-dir={repo}", f"--work-tree={worktree}", *args]
    completed = subprocess.run(
        cmd,
        cwd=str(worktree),
        env=_git_env(),
        input=input_text,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if check and completed.returncode != 0:
        raise LegacyConversionError(
            f"git {' '.join(args)} failed: {(completed.stderr or '').strip()}"
        )
    return completed.stdout


def _parse_trailers(repo: Path, worktree: Path, message: str) -> dict[str, str]:
    """Parse canonical trailers without leaving the no-replace source view."""
    output = _git(
        repo,
        worktree,
        "interpret-trailers",
        "--parse",
        input_text=message,
    )
    parsed: dict[str, str] = {}
    for line in output.splitlines():
        if not line:
            continue
        if ": " in line:
            key, value = line.split(": ", 1)
        elif ":" in line:
            key, value = line.split(":", 1)
            value = value.strip()
        else:
            continue
        parsed[key] = value
    return parsed


def _git_bytes(repo: Path, worktree: Path, *args: str, check: bool = True) -> bytes:
    """Binary-safe read-only Git command for immutable tree/blob access."""
    git = git_history._git_executable()
    cmd = [git, f"--git-dir={repo}", f"--work-tree={worktree}", *args]
    completed = subprocess.run(
        cmd,
        cwd=str(worktree),
        env=_git_env(),
        capture_output=True,
        check=False,
    )
    if check and completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise LegacyConversionError(f"git {' '.join(args)} failed: {detail}")
    return completed.stdout


def _git_blob_batch(
    repo: Path, worktree: Path, oids: list[str]
) -> dict[str, bytes]:
    """Read and integrity-check many selected blobs in one Git process."""
    unique_oids = list(dict.fromkeys(oids))
    if not unique_oids:
        return {}
    git = git_history._git_executable()
    cmd = [git, f"--git-dir={repo}", f"--work-tree={worktree}", "cat-file", "--batch"]
    completed = subprocess.run(
        cmd,
        cwd=str(worktree),
        env=_git_env(),
        input=b"".join(oid.encode("ascii") + b"\n" for oid in unique_oids),
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise LegacyConversionError(f"git cat-file --batch failed: {detail}")
    output = completed.stdout
    offset = 0
    blobs: dict[str, bytes] = {}
    for expected_oid in unique_oids:
        newline = output.find(b"\n", offset)
        if newline < 0:
            raise LegacyConversionError("historical source blob batch is truncated")
        header = output[offset:newline].split(b" ")
        offset = newline + 1
        if len(header) != 3:
            raise LegacyConversionError("historical source blob batch has a malformed header")
        try:
            actual_oid = header[0].decode("ascii", errors="strict")
            kind = header[1].decode("ascii", errors="strict")
            size = int(header[2].decode("ascii", errors="strict"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise LegacyConversionError("historical source blob batch has a malformed header") from exc
        if actual_oid != expected_oid or kind != "blob" or size < 0:
            raise LegacyConversionError("historical source blob batch has an invalid object")
        end = offset + size
        if end >= len(output) or output[end:end + 1] != b"\n":
            raise LegacyConversionError("historical source blob batch is truncated")
        blobs[expected_oid] = output[offset:end]
        offset = end + 1
    if offset != len(output):
        raise LegacyConversionError("historical source blob batch has trailing data")
    return blobs


def _ref_sha(repo: Path, worktree: Path, ref: str) -> str | None:
    out = _git(repo, worktree, "rev-parse", "--verify", "--quiet", ref, check=False)
    sha = out.strip()
    if not sha:
        return None
    return sha.splitlines()[0]


def _is_descendant(
    repo: Path, worktree: Path, *, ancestor: str, descendant: str
) -> bool:
    """Check reachability in the same original, no-replace object graph."""
    git = git_history._git_executable()
    completed = subprocess.run(
        [
            git,
            f"--git-dir={repo}",
            f"--work-tree={worktree}",
            "merge-base",
            "--is-ancestor",
            ancestor,
            descendant,
        ],
        cwd=str(worktree),
        env=_git_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if completed.returncode not in (0, 1):
        raise LegacyConversionError(
            "git merge-base --is-ancestor failed: "
            f"{(completed.stderr or '').strip()}"
        )
    return completed.returncode == 0


def _git_state(root: Path, source_campaign_id: str) -> dict[str, Any]:
    """Bind the conversion to the source sidecar's identity: the ACTIVE
    timeline lineage plus every ref tip. Fork refs are recorded and bound,
    never silently searched for provenance."""
    state: dict[str, Any] = {
        "repo_present": False,
        "timeline_id": None,
        "active_ref": None,
        "ref_tips": {},
        "digest": _sha256_text(""),
    }
    # Path validation strictly precedes any Git-sidecar probe or read —
    # INCLUDING repo_path_for itself, whose internal resolve/symlink guard
    # raises ValueError that the legacy ``except ValueError`` below would
    # otherwise swallow into a quiet "repo absent" quarantine.
    _assert_sidecar_chain(root, source_campaign_id, label="source")
    try:
        repo = git_history.repo_path_for(root, source_campaign_id)
    except ValueError:
        return state
    if not git_history.looks_like_git_repo(repo):
        return state
    state["repo_present"] = True
    worktree = git_history.worktree_path_for(root, source_campaign_id)
    timeline_id = git_history.active_timeline_id(root, source_campaign_id)
    state["timeline_id"] = timeline_id
    state["active_ref"] = git_history.timeline_ref_name(timeline_id)
    tips: dict[str, str] = {}
    listing = _git(
        repo, worktree, "for-each-ref", "--format=%(refname)", "refs/heads"
    )
    for ref in listing.splitlines():
        ref = ref.strip()
        if not ref:
            continue
        sha = _ref_sha(repo, worktree, ref)
        tips[ref] = sha or "-"
    state["ref_tips"] = dict(sorted(tips.items()))
    state["digest"] = _sha256_text(
        "\n".join(f"{ref}:{tips[ref]}" for ref in sorted(tips))
    )
    return state


def _commit_log_records(
    repo: Path, worktree: Path, *, rev: str
) -> list[tuple[str, str]]:
    """Read commit messages from one no-replace lineage."""
    output = _git(repo, worktree, "log", "--format=%H%x1e%B%x1d", rev)
    records: list[tuple[str, str]] = []
    for chunk in output.split("\x1d"):
        piece = chunk.strip("\n")
        if not piece:
            continue
        sha, separator, body = piece.partition("\x1e")
        if separator:
            records.append((sha.strip(), body))
    return records


def _commits_touching(
    repo: Path, worktree: Path, ref: str, relpath: str
) -> list[dict[str, Any]]:
    """Commits touching ``relpath`` on exactly one proven lineage (``ref``),
    oldest first (deterministic topo order). Read-only."""
    out = _git(
        repo,
        worktree,
        "log",
        ref,
        "--topo-order",
        "--reverse",
        "--format=%H%x1f%B%x1e",
        "--",
        relpath,
    )
    commits: list[dict[str, Any]] = []
    for chunk in out.split("\x1e"):
        chunk = chunk.strip("\n")
        if not chunk.strip():
            continue
        sha, sep, body = chunk.partition("\x1f")
        if not sep:
            continue
        commits.append(
            {"sha": sha.strip(), "trailers": _parse_trailers(repo, worktree, body)}
        )
    return commits


def _blob_sha_at(repo: Path, worktree: Path, sha: str, relpath: str) -> str | None:
    out = _git(repo, worktree, "ls-tree", sha, "--", relpath)
    for line in out.splitlines():
        m = re.match(r"^\d+\s+blob\s+([0-9a-f]{40,64})\t", line)
        if m:
            return m.group(1)
    return None


def _turn_and_finalization(trailers: dict[str, str]) -> tuple[int, str] | None:
    """Provenant (turn, finalization receipt) from canonical trailers.

    Anything less than an exact numeric Turn-Number plus a non-empty
    Finalization-Id is unprovable — never inferred, never defaulted.
    """
    raw_turn = (trailers.get("Turn-Number") or "").strip()
    finalization = (trailers.get("Finalization-Id") or "").strip()
    if not raw_turn.isdigit() or not finalization:
        return None
    return int(raw_turn), finalization


def _require_git_oid(value: str, *, label: str) -> str:
    token = value.strip().lower()
    if _GIT_OID_RE.fullmatch(token) is None:
        raise LegacyConversionError(f"{label} is not a well-formed Git object id")
    return token


def _git_object_type(repo: Path, worktree: Path, oid: str, *, expected: str) -> None:
    actual = _git(repo, worktree, "cat-file", "-t", oid).strip()
    if actual != expected:
        raise LegacyConversionError(
            f"historical source object {oid} is {actual!r}, not {expected!r}"
        )


def _commit_tree_oid(repo: Path, worktree: Path, commit: str) -> str:
    """Validate a commit object and return its validated root tree oid."""
    commit = _require_git_oid(commit, label="historical source commit")
    _git(repo, worktree, "cat-file", "-e", f"{commit}^{{commit}}")
    _git_object_type(repo, worktree, commit, expected="commit")
    # ``cat-file`` validates the selected commit/tree/blob object contents
    # below. Do not invoke maintenance-like Git commands here: source-sidecar
    # byte preservation is stricter than a broad repository health scan.
    tree = _git(repo, worktree, "rev-parse", f"{commit}^{{tree}}").strip()
    tree = _require_git_oid(tree, label="historical source tree")
    _git_object_type(repo, worktree, tree, expected="tree")
    return tree


def _safe_tree_relpath(raw_path: bytes) -> str:
    try:
        relpath = raw_path.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise LegacyConversionError("historical source tree contains a non-UTF-8 path") from exc
    if (
        not relpath
        or relpath.startswith("/")
        or "\\" in relpath
        or any(part in ("", ".", "..") for part in relpath.split("/"))
    ):
        raise LegacyConversionError(
            f"historical source tree contains an unsafe path: {relpath!r}"
        )
    return relpath


def _read_historical_tree(
    repo: Path, worktree: Path, commit: str
) -> tuple[str, dict[str, bytes], dict[str, Any]]:
    """Read a selected immutable commit tree as validated raw blobs only."""
    tree = _commit_tree_oid(repo, worktree, commit)
    listing = _git_bytes(repo, worktree, "ls-tree", "-r", "-z", "--full-tree", commit)
    entries: list[tuple[str, str]] = []
    seen_paths: set[str] = set()
    for record in listing.split(b"\0"):
        if not record:
            continue
        header, sep, raw_path = record.partition(b"\t")
        fields = header.split(b" ")
        if not sep or len(fields) != 3:
            raise LegacyConversionError("historical source tree has a malformed entry")
        try:
            mode, kind, raw_oid = (field.decode("ascii", errors="strict") for field in fields)
        except UnicodeDecodeError as exc:
            raise LegacyConversionError("historical source tree has a malformed entry") from exc
        oid = _require_git_oid(raw_oid, label="historical source blob")
        relpath = _safe_tree_relpath(raw_path)
        if relpath in seen_paths:
            raise LegacyConversionError("historical source tree contains a duplicate path")
        seen_paths.add(relpath)
        if kind != "blob" or mode not in ("100644", "100755"):
            raise LegacyConversionError(
                "historical source tree contains a symlink, submodule, or "
                f"non-regular entry at {relpath!r}"
            )
        entries.append((relpath, oid))
    blobs = _git_blob_batch(repo, worktree, [oid for _, oid in entries])
    files = {relpath: blobs[oid] for relpath, oid in entries}
    return tree, files, _snapshot_from_bytes(files)


def _is_canonical_finalized_turn(
    trailers: dict[str, str], *, campaign_id: str, timeline_id: str, turn: int
) -> bool:
    """The finalized-turn contract written by ``commit_finalized_turn``.

    A bare turn-number trailer is not enough: all canonical finalization
    trailers must be present, and the campaign/timeline identity must match
    the active source timeline selected by this command.
    """
    if (
        trailers.get("COC-Commit-Type") != "turn"
        or trailers.get("Campaign-Id") != campaign_id
        or trailers.get("Timeline-Id") != timeline_id
        or trailers.get("Turn-Number") != str(turn)
    ):
        return False
    return all(
        isinstance(trailers.get(key), str) and bool(trailers[key].strip())
        for key in (
            "Finalization-Id",
            "Journal-Decision-Id",
            "Settlement-Snapshot-Id",
            "Rendered-Text-SHA256",
            "Schema-Generation",
        )
    )


def _selection_digest(selection: dict[str, Any]) -> str:
    """Machine-owned integrity binding; callers never supply these ids."""
    return _sha256_text(
        json.dumps(selection, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    )


def _historical_source_view(
    root: Path,
    source_campaign_id: str,
    git_state: dict[str, Any],
    source_turn: int,
) -> dict[str, Any]:
    """Resolve one semantic finalized turn and read only its commit tree."""
    if not git_state["repo_present"]:
        raise LegacyConversionError(
            "--source-turn requires a source campaign Git sidecar with a "
            "canonical finalized timeline"
        )
    timeline_id = git_state["timeline_id"]
    ref = git_state["active_ref"]
    if not isinstance(timeline_id, str) or not isinstance(ref, str):
        raise LegacyConversionError("source campaign has no active timeline for --source-turn")
    repo = git_history.repo_path_for(root, source_campaign_id)
    worktree = git_history.worktree_path_for(root, source_campaign_id)
    tip = _ref_sha(repo, worktree, ref)
    if tip is None:
        raise LegacyConversionError("source campaign active timeline ref is missing")
    # Resolution, trailer parsing, ancestry, and tree/blob reads must all
    # inspect one original graph.  Do not delegate this to coc_git_history:
    # its generic history helpers intentionally support normal Git views,
    # while historical conversion must never honor refs/replace.
    matching: list[tuple[str, dict[str, str]]] = []
    for sha, body in _commit_log_records(repo, worktree, rev=ref):
        trailers = _parse_trailers(repo, worktree, body)
        if (
            trailers.get("COC-Commit-Type") == "turn"
            and trailers.get("Timeline-Id") == timeline_id
            and trailers.get("Turn-Number") == str(source_turn)
        ):
            matching.append((sha, trailers))
    if not matching:
        raise LegacyConversionError(
            f"source turn {source_turn} is missing or not on the active timeline"
        )
    resolved_commit = matching[0][0]
    candidates = [
        (sha, trailers)
        for sha, trailers in matching
        if _is_canonical_finalized_turn(
            trailers,
            campaign_id=source_campaign_id,
            timeline_id=timeline_id,
            turn=source_turn,
        )
    ]
    if not candidates:
        raise LegacyConversionError(
            f"source turn {source_turn} is not a canonical finalized turn"
        )
    if len(candidates) != 1:
        raise LegacyConversionError(
            f"source turn {source_turn} is ambiguous on active timeline {timeline_id}"
        )
    commit, trailers = candidates[0]
    if resolved_commit != commit:
        raise LegacyConversionError(
            f"source turn {source_turn} resolved ambiguously by Git history"
        )
    if not _is_descendant(repo, worktree, ancestor=commit, descendant=tip):
        raise LegacyConversionError(
            f"source turn {source_turn} is not an ancestor of the active timeline"
        )
    tree, files, snapshot = _read_historical_tree(repo, worktree, commit)
    selection = {
        "mode": "historical_turn",
        "timeline_id": timeline_id,
        "active_ref": ref,
        "source_turn": source_turn,
        "finalization_id": trailers["Finalization-Id"],
        "commit": commit,
        "tree": tree,
    }
    selection["integrity_digest"] = _selection_digest(selection)
    return {"files": files, "snapshot": snapshot, "selection": selection}


def _current_source_selection(
    root: Path, source_campaign_id: str, git_state: dict[str, Any]
) -> dict[str, Any]:
    """Bind default mode to the active clean worktree's tip/tree."""
    selection: dict[str, Any] = {
        "mode": "current_worktree",
        "timeline_id": git_state["timeline_id"],
        "active_ref": git_state["active_ref"],
        "source_turn": None,
        "finalization_id": None,
        "commit": None,
        "tree": None,
    }
    if git_state["repo_present"]:
        repo = git_history.repo_path_for(root, source_campaign_id)
        worktree = git_history.worktree_path_for(root, source_campaign_id)
        ref = selection["active_ref"]
        if not isinstance(ref, str) or not ref:
            raise LegacyConversionError("source campaign has no active timeline ref")
        tip = _ref_sha(repo, worktree, ref)
        if tip is None:
            raise LegacyConversionError("source campaign active timeline ref is missing")
        selection["commit"] = tip
        selection["tree"] = _commit_tree_oid(repo, worktree, tip)
    selection["integrity_digest"] = _selection_digest(selection)
    return selection


def _assert_current_source_clean(
    root: Path,
    source_campaign_id: str,
    git_state: dict[str, Any],
    live_snapshot: dict[str, Any],
) -> dict[str, Any]:
    """Default mode accepts only a live tree byte-identical to its tip.

    Do not ask Git to refresh/read its worktree index here: even a nominally
    read-only ``git diff`` can rewrite source-sidecar stat metadata.  Comparing
    the already-snapshotted live tree with independently read commit blobs is
    both stricter (it includes untracked/ignored bytes) and non-mutating.
    """
    selection = _current_source_selection(root, source_campaign_id, git_state)
    if not git_state["repo_present"]:
        return selection
    repo = git_history.repo_path_for(root, source_campaign_id)
    worktree = git_history.worktree_path_for(root, source_campaign_id)
    tree, _, committed_snapshot = _read_historical_tree(
        repo, worktree, str(selection["commit"])
    )
    committed_files = committed_snapshot["files"]
    live_files = live_snapshot["files"]
    tracked_drift = any(
        live_files.get(relpath) != metadata
        for relpath, metadata in committed_files.items()
    )
    unignored_extra = [
        relpath
        for relpath in live_files
        if relpath not in committed_files and not git_history.path_is_ignored(relpath)
    ]
    if tree != selection["tree"] or tracked_drift or unignored_extra:
        raise LegacyConversionError(
            "source campaign worktree is dirty or drifted; default conversion "
            "requires the current source to be clean and verified (use --source-turn "
            "<positive integer> to select an immutable finalized turn)"
        )
    return selection


def _resolve_provenance(
    root: Path,
    source_campaign_id: str,
    git_state: dict[str, Any],
    card: dict[str, Any],
    *,
    history_ref: str | None = None,
) -> dict[str, Any]:
    """Prove the card's selected bytes against ONE unique lineage.

    Default mode uses the active ref; historical mode passes its immutable
    selected commit as the lineage tip, so later source turns cannot affect
    provenance, hook resolution, or target records.

    Returns a provenance record whose ``status`` is either ``proven`` or a
    stable quarantine reason. The introduction commit binds
    source_commit/source_turn/source_receipts for the base record; for
    terminal hooks the newest content commit binds the resolution evidence.
    """
    record: dict[str, Any] = {
        "repo_present": git_state["repo_present"],
        "timeline_id": git_state["timeline_id"],
        "ref": history_ref or git_state["active_ref"],
        "introduction_commit": None,
        "introduction_turn": None,
        "introduction_finalization_id": None,
        "resolution_commit": None,
        "resolution_turn": None,
        "resolution_finalization_id": None,
        "current_bytes_in_git": False,
        "status": QUARANTINE_MISSING_GIT_SIDECAR,
    }
    if not git_state["repo_present"]:
        return record
    repo = git_history.repo_path_for(root, source_campaign_id)
    worktree = git_history.worktree_path_for(root, source_campaign_id)
    ref = history_ref or git_state["active_ref"]
    if _ref_sha(repo, worktree, ref) is None:
        record["status"] = QUARANTINE_EMPTY_GIT_HISTORY
        return record
    try:
        commits = _commits_touching(repo, worktree, ref, card["relpath"])
    except LegacyConversionError:
        record["status"] = QUARANTINE_GIT_UNAVAILABLE
        return record
    if not commits:
        record["status"] = QUARANTINE_PATH_NOT_IN_HISTORY
        return record

    current_blob = _git_blob_sha(card["raw_bytes"])
    content_commits = [
        c
        for c in commits
        if _blob_sha_at(repo, worktree, c["sha"], card["relpath"]) == current_blob
    ]
    if not content_commits:
        record["status"] = QUARANTINE_CONTENT_NOT_COMMITTED
        return record
    record["current_bytes_in_git"] = True

    introduction = commits[0]
    last_content = content_commits[-1]
    record["introduction_commit"] = introduction["sha"]
    record["resolution_commit"] = last_content["sha"]

    introduced = _turn_and_finalization(introduction["trailers"])
    if introduced is None:
        record["status"] = QUARANTINE_UNPROVABLE_TURN
        return record
    record["introduction_turn"] = introduced[0]
    record["introduction_finalization_id"] = introduced[1]

    kind = card["meta"].get("kind")
    is_terminal_hook = (
        kind in LEGACY_HOOK_KINDS
        and card["meta"].get("status") in LEGACY_TERMINAL_HOOK_STATUSES
    )
    if introduction["sha"] != last_content["sha"] and not is_terminal_hook:
        # Only hook lifecycle rewrites may change a card after introduction;
        # anything else makes the current content's origin ambiguous.
        record["status"] = QUARANTINE_MODIFIED_AFTER_INTRODUCTION
        return record
    if is_terminal_hook:
        resolved = _turn_and_finalization(last_content["trailers"])
        if resolved is None:
            record["status"] = QUARANTINE_UNPROVABLE_RESOLUTION
            return record
        if resolved[0] < introduced[0]:
            # Resolution proven on an earlier turn than introduction is
            # contradictory lineage evidence.
            record["status"] = QUARANTINE_UNPROVABLE_RESOLUTION
            return record
        record["resolution_turn"] = resolved[0]
        record["resolution_finalization_id"] = resolved[1]

    record["status"] = "proven"
    return record


# ---------------------------------------------------------------------------
# Source party identity (exact investigator resolution for relationships)
# ---------------------------------------------------------------------------


def _source_investigator_ids(source: Path | dict[str, bytes]) -> list[str]:
    """Read party identity from either a live source or immutable tree map."""
    try:
        if isinstance(source, Path):
            party_path = source / "party.json"
            if not party_path.is_file() or party_path.is_symlink():
                return []
            raw = party_path.read_bytes()
        else:
            raw = source.get("party.json")
            if raw is None:
                return []
        party = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return []
    ids = party.get("investigator_ids")
    if not isinstance(ids, list):
        return []
    return [i for i in ids if isinstance(i, str) and i]


def _resolve_relationship_owner(
    source: Path | dict[str, bytes], investigator_ref: str
) -> str | None:
    """Exact, validated investigator identity for a legacy ``inv-*`` ref.

    The ref must match an investigator id recorded in the source campaign's
    own party identity (full ref form, or the ref without its legacy
    prefix). Anything else is unproven ownership and quarantines — the
    relationship is never broadened to the party.
    """
    ids = _source_investigator_ids(source)
    for candidate in (investigator_ref, *(
        investigator_ref[len(prefix):]
        for prefix in _INVESTIGATOR_REF_PREFIXES
        if investigator_ref.startswith(prefix)
    )):
        if candidate in ids:
            return candidate
    return None


# ---------------------------------------------------------------------------
# Mapping plan (conservative, deterministic)
# ---------------------------------------------------------------------------


def _plan_card(
    card: dict[str, Any],
    *,
    source: Path | dict[str, bytes],
    target_campaign_id: str,
    provenance: dict[str, Any],
) -> dict[str, Any]:
    """Derive one card's disposition: ``imported`` with concrete canonical
    writes, or ``quarantined`` with a stable reason."""
    entry: dict[str, Any] = {
        "relpath": card["relpath"],
        "sha256": card["sha256"],
        "memory_id": card["meta"].get("memory_id"),
        "disposition": "quarantined",
        "quarantine_reason": None,
    }
    meta = card["meta"]
    kind = meta.get("kind")
    body = str(meta.get("body") or "").strip()
    if provenance["status"] != "proven":
        entry["quarantine_reason"] = provenance["status"]
        return entry

    assertion_id = target_assertion_id(target_campaign_id, str(meta["memory_id"]))
    entry["target_assertion_id"] = assertion_id
    privacy = LEGACY_PRIVACY_TO_CANONICAL[meta["privacy"]]
    source_commit = provenance["introduction_commit"]
    source_turn = int(provenance["introduction_turn"])
    source_receipts = [provenance["introduction_finalization_id"]]
    entry["privacy"] = privacy
    entry["statement"] = body
    entry["source_commit"] = source_commit
    entry["source_turn"] = source_turn
    entry["source_receipts"] = list(source_receipts)

    def _finish(mapping: dict[str, Any]) -> dict[str, Any]:
        entry["mapping"] = mapping
        entry["disposition"] = "imported"
        return entry

    def _quarantine(reason: str) -> dict[str, Any]:
        entry["quarantine_reason"] = reason
        entry.pop("target_assertion_id", None)
        return entry

    if not body:
        return _quarantine("empty_statement")
    if len(body) > MAX_STATEMENT_CHARS:
        return _quarantine("statement_too_long")

    mapped_entities: list[str] = []
    unmapped: list[str] = []
    for token in meta.get("entities") or []:
        entity_id = _map_entity_ref(str(token))
        if entity_id is None or entity_id in mapped_entities:
            if entity_id is None:
                unmapped.append(str(token))
            continue
        mapped_entities.append(entity_id)

    notes: list[str] = []
    if unmapped:
        notes.append(f"unmapped_entity_refs:{sorted(unmapped)}")

    if kind in ("fact", "event"):
        # A table-established truth / played event is world-level knowledge;
        # the card carries no per-subject identity, so none is invented.
        return _finish(
            {
                "kind": "world_event",
                "subject_id": temporal_memory.contract.subject_id_for(
                    "world", target_campaign_id, ""
                ),
                "knowers": [],
                "entity_refs": mapped_entities,
            }
        )
    if kind == "npc_relationship":
        # Canonical relationship is subject -> exactly one entity target.
        # Directional semantics are preserved: the EXACT investigator owns
        # the relationship and the NPC is the target entity. The owner must
        # be proven from the source campaign's own party identity; it is
        # never broadened to the party and never guessed.
        refs = [str(t) for t in (meta.get("entities") or [])]
        npc_refs = [r for r in refs if r.startswith("npc-")]
        investigator_refs = [
            r
            for r in refs
            if any(r.startswith(p) for p in _INVESTIGATOR_REF_PREFIXES)
        ]
        if len(refs) != 2 or len(npc_refs) != 1 or len(investigator_refs) != 1:
            return _quarantine("ambiguous_relationship_direction")
        owner_id = _resolve_relationship_owner(source, investigator_refs[0])
        if owner_id is None:
            return _quarantine("unprovable_relationship_owner")
        subject_id = temporal_memory.contract.subject_id_for(
            "investigator", None, _slug_token(owner_id)
        )
        notes.append(
            f"relationship_owner:subject-investigator:{owner_id};"
            f"target_entity:{_map_entity_ref(npc_refs[0])}"
        )
        return _finish(
            {
                "kind": "relationship",
                "subject_id": subject_id,
                "knowers": [subject_id],
                "entity_refs": [_map_entity_ref(npc_refs[0])],
                "owner_investigator_id": owner_id,
                "notes": notes,
            }
        )
    if kind in ("player_preference", "keeper_correction"):
        # Table-level preferences/corrections bind to the default table
        # subjects created by the canonical store bootstrap.
        subject_kind = "player" if kind == "player_preference" else "keeper"
        subject_id = temporal_memory.contract.subject_id_for(subject_kind, None, "table")
        return _finish(
            {
                "kind": kind,
                "subject_id": subject_id,
                "knowers": [subject_id],
                "entity_refs": mapped_entities,
            }
        )
    # unresolved_hook / foreshadowing
    status = meta.get("status") or "open"
    subject_id = temporal_memory.contract.subject_id_for("keeper", None, "table")
    hook: dict[str, Any] = {
        "hook_id": target_hook_id(target_campaign_id, str(meta["memory_id"])),
        "kind": kind,
        "status": status,
        "introduced_at": str(meta.get("introduced_at") or ""),
        "possible_payoff": str(meta.get("possible_payoff") or ""),
    }
    if status in LEGACY_TERMINAL_HOOK_STATUSES:
        resolved_at = str(meta.get("resolved_at") or "").strip()
        if not resolved_at:
            return _quarantine("hook_resolution_evidence_missing")
        match = _TRAILING_TURN_RE.search(resolved_at)
        if match is None or int(match.group(1)) != int(
            provenance["resolution_turn"]
        ):
            # The card's stamped resolution reference must agree exactly
            # with the verified resolution commit's turn evidence.
            return _quarantine("resolution_turn_mismatch")
        reason_text = str(meta.get("resolution_reason") or "").strip()
        if len(reason_text) > MAX_STATEMENT_CHARS:
            return _quarantine("resolution_reason_too_long")
        resolution_turn = int(provenance["resolution_turn"])
        hook["resolution"] = status
        hook["resolved_at"] = resolved_at
        hook["resolution_reason"] = reason_text
        hook["decision_id"] = (
            f"legacy-import-{target_campaign_id}-"
            f"{_slug_token(str(meta['memory_id']))}-{status}"
        )
        hook["successor_id"] = f"{assertion_id}-{status}"[:_MAX_ID_LEN]
        # Verified resolution provenance — bound verbatim into the
        # converter-owned successor/supersession records.
        hook["resolution_commit"] = provenance["resolution_commit"]
        hook["resolution_turn"] = resolution_turn
        hook["resolution_finalization_id"] = provenance[
            "resolution_finalization_id"
        ]
    if notes:
        hook["notes"] = notes
    return _finish(
        {
            "kind": "knowledge",
            "subject_id": subject_id,
            "knowers": [subject_id],
            "entity_refs": mapped_entities,
            "hook": hook,
        }
    )


# ---------------------------------------------------------------------------
# Conversion plan (pure derivation from the read-only source)
# ---------------------------------------------------------------------------


def _parse_campaign_identity(
    raw: bytes, campaign_id: str, *, label: str
) -> dict[str, Any]:
    try:
        identity = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LegacyConversionError(f"{label} campaign.json is unreadable: {exc}") from exc
    if not isinstance(identity, dict) or identity.get("campaign_id") != campaign_id:
        raise LegacyConversionError(
            f"campaign.json identity does not match requested campaign id "
            f"{campaign_id!r}"
        )
    schema_version = identity.get("schema_version")
    if schema_version != int(coc_state.CURRENT_SCHEMA_VERSIONS["campaign"]):
        raise LegacyConversionError(
            f"unsupported source campaign schema_version {schema_version!r}; "
            f"this converter supports exactly "
            f"{int(coc_state.CURRENT_SCHEMA_VERSIONS['campaign'])}"
        )
    return identity


def _load_campaign_identity(source_dir: Path, campaign_id: str) -> dict[str, Any]:
    path = source_dir / "campaign.json"
    if path.is_symlink() or not path.is_file():
        raise LegacyConversionError(
            f"source campaign directory is missing campaign.json: {source_dir}"
        )
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise LegacyConversionError(f"source campaign.json is unreadable: {exc}") from exc
    return _parse_campaign_identity(raw, campaign_id, label="source")


def _load_historical_campaign_identity(
    files: dict[str, bytes], campaign_id: str
) -> dict[str, Any]:
    raw = files.get("campaign.json")
    if raw is None:
        raise LegacyConversionError(
            "historical source tree is missing source campaign.json"
        )
    return _parse_campaign_identity(raw, campaign_id, label="historical source")


def _plan_conversion(
    root: Path,
    source_campaign: str,
    target_campaign: str,
    target_title: str | None,
    source_turn: int | None,
) -> dict[str, Any]:
    """Read-only planning from either a clean worktree or one historical tree.

    Historical mode snapshots the entire dirty live source for preservation,
    but derives every target-facing byte only from the selected finalized
    commit tree.  No checkout, index, ref, or source file is ever changed.
    """
    if source_turn is not None and (
        not isinstance(source_turn, int)
        or isinstance(source_turn, bool)
        or source_turn < 1
    ):
        raise LegacyConversionError("source_turn must be a positive integer")
    source_dir = _safe_campaign_dir(
        root, source_campaign, label="source", must_exist=True
    )
    _safe_campaign_dir(root, target_campaign, label="target")

    # These two snapshots are intentionally first: historical conversion may
    # proceed while the source is dirty, but it must prove the exact live
    # worktree and sidecar remained byte-for-byte untouched until publish.
    live_snapshot = _source_snapshot(source_dir)
    sidecar_snapshot = _sidecar_snapshot(root, source_campaign)
    git_state = _git_state(root, source_campaign)
    if source_turn is None:
        selection = _assert_current_source_clean(
            root, source_campaign, git_state, live_snapshot
        )
        source_identity = _load_campaign_identity(source_dir, source_campaign)
        snapshot = live_snapshot
        cards = _discover_cards(source_dir)
        source_view: Path | dict[str, bytes] = source_dir
        history_ref: str | None = None
    else:
        historical = _historical_source_view(
            root, source_campaign, git_state, source_turn
        )
        selection = historical["selection"]
        snapshot = historical["snapshot"]
        source_identity = _load_historical_campaign_identity(
            historical["files"], source_campaign
        )
        cards = _discover_cards_from_tree(historical["files"])
        source_view = historical["files"]
        history_ref = selection["commit"]
    entries: list[dict[str, Any]] = []
    for card in cards:
        meta, parse_error = parse_legacy_frontmatter(card["text"])
        card_entry: dict[str, Any] = {
            "relpath": card["relpath"],
            "sha256": card["sha256"],
            "bytes": card["bytes"],
            "privacy_dir": card["privacy_dir"],
            "memory_id": (meta or {}).get("memory_id"),
            "disposition": "quarantined",
            "quarantine_reason": None,
        }
        if meta is None:
            card_entry["quarantine_reason"] = f"invalid_frontmatter:{parse_error}"
            entries.append(card_entry)
            continue
        validation_errors = validate_legacy_card(
            meta, privacy_dir=card["privacy_dir"]
        )
        card_entry["parsed"] = {k: v for k, v in meta.items() if k != "body"}
        if validation_errors:
            card_entry["quarantine_reason"] = (
                "invalid_card_schema:" + "; ".join(validation_errors)
            )
            entries.append(card_entry)
            continue
        card["meta"] = meta
        provenance = _resolve_provenance(
            root,
            source_campaign,
            git_state,
            card,
            history_ref=history_ref,
        )
        planned = _plan_card(
            card,
            source=source_view,
            target_campaign_id=target_campaign,
            provenance=provenance,
        )
        planned["bytes"] = card["bytes"]
        planned["privacy_dir"] = card["privacy_dir"]
        planned["parsed"] = card_entry["parsed"]
        planned["provenance"] = provenance
        entries.append(planned)

    # Deterministic id collision check (fail closed per card). Covers base
    # assertion ids AND terminal-hook successor ids.
    seen_ids: dict[str, str] = {}
    for entry in entries:
        if entry["disposition"] != "imported":
            continue
        ids = [entry["target_assertion_id"]]
        hook = entry["mapping"].get("hook")
        if hook and hook.get("successor_id"):
            ids.append(hook["successor_id"])
        for semantic_id in ids:
            if semantic_id in seen_ids and seen_ids[semantic_id] != entry["relpath"]:
                for entry2 in entries:
                    if entry2.get("target_assertion_id") == semantic_id or (
                        entry2.get("mapping", {}).get("hook", {}).get("successor_id")
                        == semantic_id
                    ):
                        entry2["disposition"] = "quarantined"
                        entry2["quarantine_reason"] = "semantic_id_collision"
                        entry2.pop("mapping", None)
                        entry2.pop("target_assertion_id", None)
            seen_ids.setdefault(semantic_id, entry["relpath"])

    imported = [e for e in entries if e["disposition"] == "imported"]
    quarantined = [e for e in entries if e["disposition"] == "quarantined"]

    context_packs = sorted(
        rel
        for rel in snapshot["files"]
        if rel.startswith("memory/context-packs/") and rel.endswith(".md")
    )
    summaries_rel = "memory/session-summaries.jsonl"

    return {
        "tool": TOOL_NAME,
        "schema_generation": SCHEMA_GENERATION,
        "source_campaign": source_campaign,
        "target_campaign": target_campaign,
        "source_dir": source_dir,
        "source_identity": source_identity,
        # ``snapshot`` is target-facing: current worktree for default mode,
        # selected immutable commit tree for --source-turn.
        "snapshot": snapshot,
        "source_worktree_snapshot": live_snapshot,
        "source_sidecar_snapshot": sidecar_snapshot,
        "source_selection": selection,
        "git_state": git_state,
        "entries": entries,
        "counts": {
            "cards_discovered": len(entries),
            "cards_imported": len(imported),
            "cards_quarantined": len(quarantined),
            "context_packs_archived": len(context_packs),
            "summaries_present": summaries_rel in snapshot["files"],
        },
        "context_packs": context_packs,
        "summaries_present": summaries_rel in snapshot["files"],
        "target": {
            "campaign_id": target_campaign,
            "title": target_title
            or f"[legacy import] {source_identity.get('title') or source_campaign}",
            "era": source_identity.get("era"),
            "play_language": source_identity.get("play_language")
            or coc_state.DEFAULT_PLAY_LANGUAGE,
        },
    }


# ---------------------------------------------------------------------------
# Expected canonical store records (single source of truth for staging AND
# replay verification)
# ---------------------------------------------------------------------------


def _normalize_assertion(payload: dict[str, Any], target_campaign_id: str) -> dict:
    class _Dir:
        name = target_campaign_id

    return temporal_memory._normalize_assertion(payload, campaign_dir=_Dir())


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


#: Named internal failpoints for crash-boundary tests. Empty in production;
#: tests arm exactly one name and clear it to model a repaired restart.
_FAILPOINTS: set[str] = set()


def _failpoint(name: str) -> None:
    if name in _FAILPOINTS:
        raise LegacyConversionError(f"injected failpoint: {name}")


def _expected_subject_rows(plan: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Exact subject rows the converted store must contain: the canonical
    bootstrap defaults for the target campaign plus one exact row per proven
    relationship owner."""
    target_campaign_id = plan["target_campaign"]
    rows: dict[str, dict[str, Any]] = {
        temporal_memory.contract.subject_id_for("world", target_campaign_id, ""): {
            "subject_id": temporal_memory.contract.subject_id_for(
                "world", target_campaign_id, ""
            ),
            "kind": "world",
            "campaign_id": target_campaign_id,
            "display_name": "World",
            "same_subject_as": [],
        },
        temporal_memory.contract.subject_id_for("party", target_campaign_id, ""): {
            "subject_id": temporal_memory.contract.subject_id_for(
                "party", target_campaign_id, ""
            ),
            "kind": "party",
            "campaign_id": target_campaign_id,
            "display_name": "Party",
            "same_subject_as": [],
        },
        temporal_memory.contract.subject_id_for("player", None, "table"): {
            "subject_id": temporal_memory.contract.subject_id_for(
                "player", None, "table"
            ),
            "kind": "player",
            "campaign_id": None,
            "display_name": "Player",
            "same_subject_as": [],
        },
        temporal_memory.contract.subject_id_for("keeper", None, "table"): {
            "subject_id": temporal_memory.contract.subject_id_for(
                "keeper", None, "table"
            ),
            "kind": "keeper",
            "campaign_id": None,
            "display_name": "Keeper",
            "same_subject_as": [],
        },
    }
    for entry in plan["entries"]:
        if entry["disposition"] != "imported":
            continue
        mapping = entry["mapping"]
        if mapping["kind"] == "relationship" and mapping.get(
            "owner_investigator_id"
        ):
            owner = mapping["owner_investigator_id"]
            rows[mapping["subject_id"]] = {
                "subject_id": mapping["subject_id"],
                "kind": "investigator",
                "campaign_id": None,
                "display_name": owner,
                "same_subject_as": [],
            }
    return rows


def _expected_entity_rows(plan: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Exact full entity rows the converted store must contain — byte-for-
    byte the rows ``_ensure_entity`` derives for well-formed canonical ids,
    computed from the plan, never from the stored files."""
    target_campaign_id = plan["target_campaign"]
    rows: dict[str, dict[str, Any]] = {}
    for assertion in _expected_store_records(plan)["assertions"]:
        for entity_id in assertion.get("entities") or []:
            parts = entity_id.split("-", 2)
            kind = parts[1] if len(parts) >= 3 else "concept"
            slug = parts[2] if len(parts) >= 3 else entity_id
            rows[entity_id] = {
                "entity_id": entity_id,
                "kind": kind,
                "campaign_id": target_campaign_id,
                "display_name": slug.replace("-", " "),
                "aliases": [slug],
                "same_entity_as": [],
                "subject_ref": None,
            }
    return rows


def _expected_store_records(plan: dict[str, Any]) -> dict[str, Any]:
    """Deterministic canonical records the conversion must produce.

    ``assertions`` is the exact write order; ``hook_rows`` maps hook memory
    id to its FINAL ledger row (terminal rows replace the open row as the
    latest-per-id view the store exposes). Terminal hooks are built by the
    converter itself: the successor belief binds the VERIFIED resolution
    commit/turn/finalization receipt, and the base closes through the one
    sanctioned ``plan_supersession`` delta.
    """
    target_campaign_id = plan["target_campaign"]
    assertions: list[dict[str, Any]] = []
    hook_rows: dict[str, dict[str, Any]] = {}
    subjects: list[dict[str, Any]] = []

    def _subject_id_ref(record: dict[str, Any]) -> None:
        subjects.append(record)

    for entry in plan["entries"]:
        if entry["disposition"] != "imported":
            continue
        mapping = entry["mapping"]
        hook = mapping.get("hook")
        base = _normalize_assertion(
            {
                "assertion_id": entry["target_assertion_id"],
                "kind": mapping["kind"],
                "scope": "campaign",
                "campaign_id": target_campaign_id,
                "timeline_id": ROOT_TIMELINE_ID,
                "subject_id": mapping["subject_id"],
                "knowers": list(mapping["knowers"]),
                "privacy": entry["privacy"],
                "state": "accurate",
                "statement": entry["statement"],
                "entities": list(mapping["entity_refs"]),
                "occurred_turn": entry["source_turn"],
                "valid_from_turn": entry["source_turn"],
                "source_commit": entry["source_commit"],
                "source_turn": entry["source_turn"],
                "source_receipts": list(entry["source_receipts"]),
            },
            target_campaign_id,
        )
        if mapping["kind"] == "relationship" and mapping.get(
            "owner_investigator_id"
        ):
            owner = mapping["owner_investigator_id"]
            _subject_id_ref(
                {
                    "subject_id": mapping["subject_id"],
                    "kind": "investigator",
                    "campaign_id": None,
                    "display_name": owner,
                    "same_subject_as": [],
                }
            )
        if hook is None:
            assertions.append(base)
            continue

        open_row = {
            "memory_id": hook["hook_id"],
            "assertion_id": base["assertion_id"],
            "kind": hook["kind"],
            "status": "open",
            "introduced_at": hook.get("introduced_at") or "",
            "resolved_at": "",
            "resolution_reason": "",
            "possible_payoff": hook.get("possible_payoff") or "",
            "decision_id": "",
        }
        if not hook.get("resolution"):
            assertions.append(base)
            hook_rows[hook["hook_id"]] = open_row
            continue

        resolution_turn = int(hook["resolution_turn"])
        successor = _normalize_assertion(
            {
                "assertion_id": hook["successor_id"],
                "kind": "belief",
                "scope": "campaign",
                "campaign_id": target_campaign_id,
                "timeline_id": ROOT_TIMELINE_ID,
                "subject_id": base["subject_id"],
                "knowers": list(base["knowers"]),
                "privacy": base["privacy"],
                "state": "accurate",
                "statement": (
                    hook.get("resolution_reason") or f"hook {hook['resolution']}"
                ).strip(),
                "entities": list(base["entities"]),
                "occurred_turn": resolution_turn,
                "valid_from_turn": resolution_turn,
                "source_commit": hook["resolution_commit"],
                "source_turn": resolution_turn,
                "source_receipts": [hook["resolution_finalization_id"]],
                "confirms": [base["assertion_id"]],
            },
            target_campaign_id,
        )
        closed_base = _normalize_assertion(
            plan_supersession(
                base,
                hook["successor_id"],
                valid_until_turn=resolution_turn,
            ),
            target_campaign_id,
        )
        # Write order: successor first, then the closed base — mirroring the
        # canonical resolve_hook record order.
        assertions.append(successor)
        assertions.append(closed_base)
        hook_rows[hook["hook_id"]] = {
            **open_row,
            "status": hook["resolution"],
            "resolved_at": hook.get("resolved_at") or "",
            "resolution_reason": hook.get("resolution_reason") or "",
            "decision_id": hook["decision_id"],
            "successor_id": hook["successor_id"],
        }
    return {
        "assertions": assertions,
        "hook_rows": hook_rows,
        "subjects": subjects,
    }


def _provenance_commits_digest(plan: dict[str, Any]) -> str:
    commits: set[str] = set()
    for entry in plan["entries"]:
        if entry["disposition"] != "imported":
            continue
        provenance = entry.get("provenance") or {}
        for key in ("introduction_commit", "resolution_commit"):
            if provenance.get(key):
                commits.add(provenance[key])
    return _sha256_text("\n".join(sorted(commits)))


# ---------------------------------------------------------------------------
# Staged transaction: build -> validate -> publish -> idempotent repair
# ---------------------------------------------------------------------------


def _verify_source_unchanged(root: Path, plan: dict[str, Any]) -> None:
    """Final source boundary immediately before atomic publication.

    It proves both live preservation snapshots first, then re-resolves the
    selected Git tree/turn.  Thus dirty live bytes are permitted only in
    historical mode, remain untouched, and can never leak into the target.
    """
    source_dir = _safe_campaign_dir(
        root, plan["source_campaign"], label="source", must_exist=True
    )
    fresh_worktree = _source_snapshot(source_dir)
    if fresh_worktree["digest"] != plan["source_worktree_snapshot"]["digest"]:
        raise LegacyConversionError(
            "source campaign drifted between preflight and publish; "
            "aborting before publication"
        )
    fresh_sidecar = _sidecar_snapshot(root, plan["source_campaign"])
    if fresh_sidecar["digest"] != plan["source_sidecar_snapshot"]["digest"]:
        raise LegacyConversionError(
            "source campaign Git sidecar drifted between preflight and "
            "publish; aborting before publication"
        )
    fresh_git = _git_state(root, plan["source_campaign"])
    if fresh_git["digest"] != plan["git_state"]["digest"]:
        raise LegacyConversionError(
            "source campaign Git sidecar drifted between preflight and "
            "publish; aborting before publication"
        )

    selection = plan["source_selection"]
    if selection["mode"] == "historical_turn":
        historical = _historical_source_view(
            root,
            plan["source_campaign"],
            fresh_git,
            int(selection["source_turn"]),
        )
        if (
            historical["selection"] != selection
            or historical["snapshot"]["digest"] != plan["snapshot"]["digest"]
        ):
            raise LegacyConversionError(
                "historical source turn/commit/tree drifted between preflight "
                "and publish; aborting before publication"
            )
    elif selection["mode"] == "current_worktree":
        fresh_selection = _assert_current_source_clean(
            root, plan["source_campaign"], fresh_git, fresh_worktree
        )
        if fresh_selection != selection:
            raise LegacyConversionError(
                "source campaign Git selection drifted between preflight and "
                "publish; aborting before publication"
            )
    else:
        raise LegacyConversionError("conversion plan has an unknown source selection")


def _stage_generation(root: Path, plan: dict[str, Any]) -> Path:
    """Build and self-validate the complete target generation in a
    non-canonical staging directory. Staging is disposable: it is wiped and
    rebuilt from the deterministic plan on every run, so a partial or
    tampered staging directory can never influence the outcome.
    """
    staging_root = _staging_root_for(root, plan["target_campaign"])
    if os.path.lexists(staging_root):
        # Disposable by construction; never follow a symlink during cleanup.
        if os.path.islink(staging_root) or not staging_root.is_dir():
            raise LegacyConversionError(
                f"staging path is unsafe for cleanup: {staging_root}"
            )
        shutil.rmtree(staging_root)
    staging_root.mkdir(parents=True)
    target_campaign_id = plan["target_campaign"]
    # The staged directory carries the TARGET campaign id as its name: the
    # canonical writers bootstrap default subjects from the directory name,
    # so a placeholder name would mint rows bound to a bogus campaign id.
    staging_dir = staging_root / target_campaign_id

    coc_state._create_campaign_at(
        root,
        staging_dir,
        target_campaign_id,
        plan["target"]["title"],
        era=plan["target"]["era"],
        play_language=plan["target"]["play_language"],
        update_index=False,
    )

    expected = _expected_store_records(plan)
    temporal_memory.ensure_store(staging_dir)
    temporal_memory.ensure_default_subjects(
        staging_dir, campaign_id=target_campaign_id
    )
    for subject in expected["subjects"]:
        temporal_memory._write_subject(staging_dir, subject)
    for assertion in expected["assertions"]:
        temporal_memory.record_assertion(assertion, campaign_dir=staging_dir)
    for hook_id, row in expected["hook_rows"].items():
        temporal_memory.register_hook(
            hook_id,
            row["assertion_id"],
            campaign_dir=staging_dir,
            kind=row["kind"],
            status="open",
            introduced_at=row.get("introduced_at") or "",
            possible_payoff=row.get("possible_payoff") or "",
        )
        if row.get("decision_id"):
            temporal_memory._append_jsonl(
                temporal_memory._path(staging_dir, "hooks"), row
            )
            # Named internal failpoint: fires exactly after the terminal
            # hook row is durably written to the staged ledger (test
            # instrumentation; never set in production).
            _failpoint("after-terminal-hook-row")

    # Self-check before publication: staged records must equal the plan.
    staged_assertions = temporal_memory.load_assertions(staging_dir)
    if set(staged_assertions) != {a["assertion_id"] for a in expected["assertions"]}:
        raise LegacyConversionError(
            "staged assertion set does not match the deterministic plan"
        )
    for assertion in expected["assertions"]:
        if temporal_memory.contract.record_digest(
            staged_assertions[assertion["assertion_id"]]
        ) != temporal_memory.contract.record_digest(assertion):
            raise LegacyConversionError(
                f"staged assertion {assertion['assertion_id']!r} drifts from "
                "the deterministic plan"
            )
    staged_hooks = temporal_memory.load_hooks(staging_dir)
    for hook_id, row in expected["hook_rows"].items():
        staged = staged_hooks.get(hook_id)
        if staged is None or temporal_memory.contract.record_digest(
            staged
        ) != temporal_memory.contract.record_digest(row):
            raise LegacyConversionError(
                f"staged hook row {hook_id!r} drifts from the deterministic plan"
            )
    validate_assertion_bundle(list(staged_assertions.values()))

    # Manifest only: the receipt is written by the orchestrator AFTER
    # staging completes and BEFORE the final pre-publish verification, so
    # that verification is the last operation before the atomic rename.
    manifest = _build_manifest(plan)
    _atomic_write_json(
        staging_dir,
        "memory/legacy-import/import-manifest.json",
        manifest,
    )
    return staging_dir


def _build_manifest(plan: dict[str, Any]) -> dict[str, Any]:
    git_state = plan["git_state"]
    return {
        "tool": TOOL_NAME,
        "schema_generation": SCHEMA_GENERATION,
        "source_campaign": {
            "campaign_id": plan["source_campaign"],
            "title": plan["source_identity"].get("title"),
            "play_language": plan["source_identity"].get("play_language"),
            "era": plan["source_identity"].get("era"),
            "schema_version": plan["source_identity"].get("schema_version"),
            "campaign_json_sha256": plan["snapshot"]["files"]
            .get("campaign.json", {})
            .get("sha256"),
        },
        "target_campaign_id": plan["target_campaign"],
        "source_snapshot": {
            "digest": plan["snapshot"]["digest"],
            # Target-facing tree: cards, identity, party, context packs, and
            # every other committed source byte used by this conversion.
            "files": {
                rel: plan["snapshot"]["files"][rel]
                for rel in sorted(plan["snapshot"]["files"])
            },
        },
        # Historical mode may intentionally differ from the live dirty tree.
        # Both live snapshots are preservation evidence, never conversion input.
        "source_worktree_snapshot": {
            "digest": plan["source_worktree_snapshot"]["digest"],
            "files": {
                rel: plan["source_worktree_snapshot"]["files"][rel]
                for rel in sorted(plan["source_worktree_snapshot"]["files"])
            },
        },
        "source_sidecar_snapshot": {
            "present": plan["source_sidecar_snapshot"]["present"],
            "digest": plan["source_sidecar_snapshot"]["digest"],
            "files": {
                rel: plan["source_sidecar_snapshot"]["files"][rel]
                for rel in sorted(plan["source_sidecar_snapshot"]["files"])
            },
        },
        # The CLI accepts only source_turn; commit/tree ids are generated and
        # verified by this process as machine integrity evidence.
        "source_selection": dict(plan["source_selection"]),
        "source_git": {
            "repo_present": git_state["repo_present"],
            "timeline_id": git_state["timeline_id"],
            "active_ref": git_state["active_ref"],
            "ref_tips": git_state["ref_tips"],
            "digest": git_state["digest"],
            "provenance_commits_digest": _provenance_commits_digest(plan),
        },
        "cards": plan["entries"],
        "context_packs": {
            "disposition": "archived_only_not_converted",
            "files": {
                rel: plan["snapshot"]["files"][rel] for rel in plan["context_packs"]
            },
        },
        "session_summaries": {
            "disposition": "preserved_in_place_not_converted",
            "present": plan["summaries_present"],
            "file": {
                "memory/session-summaries.jsonl": plan["snapshot"]["files"].get(
                    "memory/session-summaries.jsonl"
                )
            }
            if plan["summaries_present"]
            else {},
        },
    }


def _store_file_digests(campaign_dir: Path) -> dict[str, str]:
    temporal = campaign_dir / "memory" / "temporal"
    digests: dict[str, str] = {}
    if temporal.is_dir():
        for path in sorted(temporal.iterdir()):
            if path.is_file() and not path.is_symlink():
                digests[path.name] = _sha256_bytes(path.read_bytes())
    return digests


#: Exact receipt shape. Replay rejects any receipt with missing or
#: additional fields — coordinated store+manifest+receipt tampering cannot
#: introduce fields, and every field value is re-derived or re-measured.
RECEIPT_FIELDS: tuple[str, ...] = (
    "decision_id",
    "tool",
    "schema_generation",
    "status",
    "source_campaign_id",
    "target_campaign_id",
    "source_snapshot_digest",
    "source_worktree_snapshot_digest",
    "source_sidecar_snapshot_digest",
    "source_git_digest",
    "source_selection",
    "source_provenance_commits_digest",
    "source_byte_preservation_verified",
    "counts",
    "target_store",
    "manifest_sha256",
)
RECEIPT_STORE_FIELDS: tuple[str, ...] = (
    "assertion_count",
    "hook_count",
    "file_digests",
)

#: Exact bytes of the temporal store schema marker written by
#: ``coc_temporal_memory.ensure_store`` — replay compares bytes, not a
#: receipt claim, so schema tampering fails even with coordinated digests.
EXPECTED_SCHEMA_BYTES = (
    json.dumps(
        {
            "schema_generation": SCHEMA_GENERATION,
            "authority": "advisory",
            "hard_gate": False,
        },
        sort_keys=True,
        indent=2,
        ensure_ascii=False,
    )
    + "\n"
).encode("utf-8")


def _build_receipt(plan: dict[str, Any], staged_dir: Path) -> dict[str, Any]:
    manifest_path = staged_dir / "memory" / "legacy-import" / "import-manifest.json"
    assertions = temporal_memory.load_assertions(staged_dir)
    return {
        "decision_id": (
            f"legacy-convert-{plan['source_campaign']}-to-{plan['target_campaign']}"
        ),
        "tool": TOOL_NAME,
        "schema_generation": SCHEMA_GENERATION,
        "status": "complete",
        "source_campaign_id": plan["source_campaign"],
        "target_campaign_id": plan["target_campaign"],
        "source_snapshot_digest": plan["snapshot"]["digest"],
        "source_worktree_snapshot_digest": plan["source_worktree_snapshot"]["digest"],
        "source_sidecar_snapshot_digest": plan["source_sidecar_snapshot"]["digest"],
        "source_git_digest": plan["git_state"]["digest"],
        "source_selection": dict(plan["source_selection"]),
        "source_provenance_commits_digest": _provenance_commits_digest(plan),
        "source_byte_preservation_verified": True,
        "counts": plan["counts"],
        "target_store": {
            "assertion_count": len(assertions),
            "hook_count": len(temporal_memory.load_hooks(staged_dir)),
            "file_digests": _store_file_digests(staged_dir),
        },
        "manifest_sha256": _sha256_bytes(manifest_path.read_bytes()),
    }


def _prepare_atomic_publish(
    root: Path, plan: dict[str, Any], staging_dir: Path
) -> Path:
    """Precompute and validate every publish argument while the workspace-
    wide conversion lock is held.

    This is intentionally separate from the final rename: all target/path/
    leaf/existence and staging checks happen here, BEFORE the final source
    verification. Cooperative converters hold the same lock, so the checked
    non-existent target leaf cannot race another conversion before rename.
    """
    target_dir = _safe_campaign_dir(root, plan["target_campaign"], label="target")
    if os.path.lexists(target_dir):
        raise LegacyConversionError(
            f"target campaign directory appeared during conversion: "
            f"{plan['target_campaign']}; refusing to overwrite"
        )
    if not staging_dir.is_dir() or staging_dir.is_symlink():
        raise LegacyConversionError("staged generation is missing or unsafe")
    return target_dir


def _repair_post_publish(root: Path, target_campaign: str) -> None:
    """Idempotent post-publish side effects: fresh sidecar baseline commit
    and campaign index exposure. Safe to re-run on every resume. Both
    touched paths are component-verified real first."""
    _assert_sidecar_chain(root, target_campaign, label="target")
    git_history.ensure_repo(root, target_campaign)
    git_history.commit_baseline(
        root,
        target_campaign,
        schema_generation=git_history.format_schema_generation(
            coc_state.CURRENT_SCHEMA_VERSIONS
        ),
        note="initial campaign generation",
    )
    _assert_real_subpath(
        root, ".coc", "indexes", label="campaign index", missing_tail=1
    )
    index_path = coc_state.coc_root(root) / "indexes" / "campaigns.json"
    if os.path.lexists(index_path):
        if os.path.islink(index_path):
            raise LegacyConversionError(
                f"campaign index path is a symlink: {index_path}"
            )
        if not stat.S_ISREG(os.lstat(index_path).st_mode):
            raise LegacyConversionError(
                f"campaign index path is not a regular file: {index_path}"
            )
    coc_state._upsert_campaign_index(root, target_campaign)


# ---------------------------------------------------------------------------
# Replay verification (deep; fail closed)
# ---------------------------------------------------------------------------


def _read_receipt(target_dir: Path) -> dict[str, Any] | None:
    path = target_dir / "memory" / "legacy-import" / "conversion-receipt.json"
    if not path.is_file() or path.is_symlink():
        return None
    try:
        receipt = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return receipt if isinstance(receipt, dict) else None


def _verify_replay(root: Path, plan: dict[str, Any], receipt: dict[str, Any]) -> None:
    """Re-verify the complete conversion before returning idempotent
    success: receipt identity, source snapshot, source Git binding, target
    campaign identity, store file digests, per-record digests against the
    deterministic plan, hook ledger, and manifest bytes."""
    target_dir = _safe_campaign_dir(root, plan["target_campaign"], label="target")
    expected_decision = (
        f"legacy-convert-{plan['source_campaign']}-to-{plan['target_campaign']}"
    )
    expected_receipt_identity = {
        "decision_id": expected_decision,
        "tool": TOOL_NAME,
        "schema_generation": SCHEMA_GENERATION,
        "status": "complete",
        "source_campaign_id": plan["source_campaign"],
        "target_campaign_id": plan["target_campaign"],
        "source_snapshot_digest": plan["snapshot"]["digest"],
        "source_worktree_snapshot_digest": plan["source_worktree_snapshot"]["digest"],
        "source_sidecar_snapshot_digest": plan["source_sidecar_snapshot"]["digest"],
        "source_git_digest": plan["git_state"]["digest"],
        "source_selection": dict(plan["source_selection"]),
        "source_provenance_commits_digest": _provenance_commits_digest(plan),
        "counts": plan["counts"],
    }
    if set(receipt) != set(RECEIPT_FIELDS):
        raise LegacyConversionError(
            "existing target receipt has missing or unexpected fields "
            f"{sorted(set(receipt) ^ set(RECEIPT_FIELDS))}; refusing to "
            "touch it"
        )
    receipt_store = receipt.get("target_store")
    if not isinstance(receipt_store, dict) or set(receipt_store) != set(
        RECEIPT_STORE_FIELDS
    ):
        raise LegacyConversionError(
            "existing target receipt store binding has missing or "
            "unexpected fields; refusing to touch it"
        )
    for field, expected_value in expected_receipt_identity.items():
        if receipt.get(field) == expected_value:
            continue
        detail = {
            "source_snapshot_digest": (
                "historical source view drifted since the previous conversion "
                "run; failing closed instead of writing divergent records"
            ),
            "source_worktree_snapshot_digest": (
                "source campaign worktree drifted since the previous "
                "conversion run; failing closed"
            ),
            "source_sidecar_snapshot_digest": (
                "source campaign Git sidecar drifted (byte snapshot) since the "
                "previous conversion run; failing closed"
            ),
            "source_selection": (
                "historical source turn/commit/tree binding drifted; failing "
                "closed"
            ),
            "source_git_digest": (
                "source campaign Git sidecar drifted since the previous "
                "conversion run (ref tips or lineage changed); failing closed"
            ),
            "source_provenance_commits_digest": (
                "source Git provenance for the imported cards drifted; "
                "failing closed"
            ),
            "counts": (
                "target receipt counts disagree with the deterministic "
                "plan; failing closed"
            ),
        }.get(
            field,
            "existing target receipt is not a complete conversion by this "
            "tool for this source/target pair; refusing to touch it",
        )
        raise LegacyConversionError(detail)
    if receipt.get("source_byte_preservation_verified") is not True:
        raise LegacyConversionError(
            "existing target receipt does not claim verified source "
            "preservation; refusing to touch it"
        )

    # No symlink may exist anywhere under the target memory tree before any
    # store/manifest/receipt byte is read.
    _assert_target_memory_tree_clean(target_dir)

    campaign_path = target_dir / "campaign.json"
    if campaign_path.is_symlink():
        raise LegacyConversionError("target campaign.json is a symlink")
    try:
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise LegacyConversionError(
            f"target campaign.json is unreadable: {exc}"
        ) from exc
    if campaign.get("campaign_id") != plan["target_campaign"] or campaign.get(
        "schema_version"
    ) != int(coc_state.CURRENT_SCHEMA_VERSIONS["campaign"]):
        raise LegacyConversionError(
            "target campaign identity/schema does not match the conversion "
            "receipt; failing closed"
        )

    # The temporal store may contain exactly the record classes this tool
    # writes (no episodes/adjudications/backlog). File digests are claims to
    # check, never their own authority.
    expected_store_files = {
        "schema.json",
        "subjects.jsonl",
        "entities.jsonl",
        "assertions.jsonl",
    }
    expected = _expected_store_records(plan)
    if expected["hook_rows"]:
        expected_store_files.add("hooks.jsonl")
    store_files = _store_file_digests(target_dir)
    if set(store_files) != expected_store_files:
        raise LegacyConversionError(
            "target temporal store contains unexpected or missing record "
            f"classes: {sorted(set(store_files) ^ expected_store_files)}; "
            "failing closed"
        )
    receipt_file_digests = receipt.get("target_store", {}).get("file_digests")
    if not isinstance(receipt_file_digests, dict) or store_files != receipt_file_digests:
        raise LegacyConversionError(
            "target temporal store files drifted from the conversion "
            "receipt (tampered or partial); failing closed"
        )

    # Subjects: exact expected rows (canonical defaults plus proven
    # relationship owners) — subject-store tampering fails even when the
    # receipt digests were coordinated with it.
    # schema.json is compared byte-for-byte against the deterministic
    # marker this tool's store bootstrap writes — never against the
    # receipt's digest claim alone.
    schema_path = target_dir / "memory" / "temporal" / "schema.json"
    if schema_path.read_bytes() != EXPECTED_SCHEMA_BYTES:
        raise LegacyConversionError(
            "target temporal schema marker drifted from the deterministic "
            "schema generation; failing closed"
        )

    stored_subjects = temporal_memory.load_subjects(target_dir)
    expected_subjects = _expected_subject_rows(plan)
    if set(stored_subjects) != set(expected_subjects):
        raise LegacyConversionError(
            "target subject store does not match the deterministic "
            "conversion plan; failing closed"
        )
    for subject_id, expected_row in expected_subjects.items():
        if temporal_memory.contract.record_digest(
            stored_subjects[subject_id]
        ) != temporal_memory.contract.record_digest(expected_row):
            raise LegacyConversionError(
                f"target subject row {subject_id!r} drifted from the "
                "deterministic conversion plan; failing closed"
            )

    # Entities: every referenced entity present with its derived kind and
    # campaign; no unreferenced entity rows.
    stored_entities = temporal_memory.load_entities(target_dir)
    expected_entities = _expected_entity_rows(plan)
    if set(stored_entities) != set(expected_entities):
        raise LegacyConversionError(
            "target entity store does not match the deterministic "
            "conversion plan; failing closed"
        )
    for entity_id, expected_row in expected_entities.items():
        if temporal_memory.contract.record_digest(
            stored_entities[entity_id]
        ) != temporal_memory.contract.record_digest(expected_row):
            raise LegacyConversionError(
                f"target entity row {entity_id!r} drifted from the "
                "deterministic conversion plan; failing closed"
            )

    stored_assertions = temporal_memory.load_assertions(target_dir)
    expected_assertions = {a["assertion_id"]: a for a in expected["assertions"]}
    if set(stored_assertions) != set(expected_assertions):
        raise LegacyConversionError(
            "target assertion set does not match the deterministic "
            "conversion plan; failing closed"
        )
    for assertion_id, expected_record in expected_assertions.items():
        if temporal_memory.contract.record_digest(
            stored_assertions[assertion_id]
        ) != temporal_memory.contract.record_digest(expected_record):
            raise LegacyConversionError(
                f"target assertion {assertion_id!r} drifted from the "
                "deterministic conversion plan; failing closed"
            )
    stored_hooks = temporal_memory.load_hooks(target_dir)
    if set(stored_hooks) != set(expected["hook_rows"]):
        raise LegacyConversionError(
            "target hook ledger does not match the deterministic conversion "
            "plan; failing closed"
        )
    for hook_id, expected_row in expected["hook_rows"].items():
        if temporal_memory.contract.record_digest(
            stored_hooks[hook_id]
        ) != temporal_memory.contract.record_digest(expected_row):
            raise LegacyConversionError(
                f"target hook row {hook_id!r} drifted from the deterministic "
                "conversion plan; failing closed"
            )
    if int(receipt.get("target_store", {}).get("assertion_count", -1)) != len(
        expected["assertions"]
    ) or int(receipt.get("target_store", {}).get("hook_count", -1)) != len(
        expected["hook_rows"]
    ):
        raise LegacyConversionError(
            "target receipt counts disagree with the deterministic plan; "
            "failing closed"
        )

    # The manifest is a pure function of the source evidence: recompute it
    # and deep-compare against the stored bytes. A coordinated edit to
    # manifest + receipt can never pass, because the expected manifest is
    # derived from the source, never from the stored files.
    manifest_path = target_dir / "memory" / "legacy-import" / "import-manifest.json"
    if not manifest_path.is_file():
        raise LegacyConversionError("target conversion manifest is missing")
    try:
        stored_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise LegacyConversionError(
            f"target conversion manifest is unreadable: {exc}"
        ) from exc
    expected_manifest = _build_manifest(plan)
    if _canonical(stored_manifest) != _canonical(expected_manifest):
        raise LegacyConversionError(
            "target conversion manifest does not match the manifest "
            "recomputed from the source evidence (tampered or stale); "
            "failing closed"
        )
    if _sha256_bytes(manifest_path.read_bytes()) != receipt.get("manifest_sha256"):
        raise LegacyConversionError(
            "target conversion manifest drifted from the receipt "
            "(tampered); failing closed"
        )
    # legacy-import evidence dir carries exactly the two artifacts.
    evidence_dir = target_dir / "memory" / "legacy-import"
    present = sorted(p.name for p in evidence_dir.iterdir() if not p.is_symlink())
    if present != ["conversion-receipt.json", "import-manifest.json"] or any(
        p.is_symlink() for p in evidence_dir.iterdir()
    ):
        raise LegacyConversionError(
            "target legacy-import evidence directory contains unexpected "
            "artifacts; failing closed"
        )


# ---------------------------------------------------------------------------
# Conversion orchestration
# ---------------------------------------------------------------------------


def convert_legacy_memory(
    root: Path | str,
    *,
    source_campaign: str,
    target_campaign: str,
    target_title: str | None = None,
    source_turn: int | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Convert legacy Markdown cards from ``source_campaign`` into a fresh
    ``target_campaign`` generation. Explicit, non-destructive, idempotent,
    crash-safe.

    Raises :class:`LegacyConversionError` on caller- or state-level
    rejections. Quarantined cards are a normal, reported outcome.
    """
    root = Path(root).resolve()
    if not root.is_dir():
        raise LegacyConversionError(f"root does not exist: {root}")
    if source_campaign == target_campaign:
        raise LegacyConversionError(
            "source and target campaign ids must differ; conversion never "
            f"mutates a campaign in place (suggested target suffix: "
            f"{SUGGESTED_TARGET_SUFFIX!r}, supplied explicitly by the caller)"
        )
    plan = _plan_conversion(
        root, source_campaign, target_campaign, target_title, source_turn
    )

    def _public_evidence_paths() -> dict[str, str]:
        base = f".coc/campaigns/{target_campaign}/memory/legacy-import"
        return {
            "manifest_path": f"{base}/import-manifest.json",
            "receipt_path": f"{base}/conversion-receipt.json",
        }

    def _summary(**extra: Any) -> dict[str, Any]:
        summary = {
            "tool": TOOL_NAME,
            "schema_generation": SCHEMA_GENERATION,
            "status": "planned" if dry_run else "complete",
            "source_campaign": source_campaign,
            "target_campaign": target_campaign,
            "dry_run": bool(dry_run),
            "replay": False,
            # The public result is semantic-only.  Refs, object ids, tree
            # ids, snapshots, and hashes remain machine evidence in the
            # receipt/manifest and are never inputs for a rerun.
            "source_mode": plan["source_selection"]["mode"],
            "source_turn": plan["source_selection"]["source_turn"],
            "source_lineage": {
                "timeline_id": plan["source_selection"]["timeline_id"],
            },
            "counts": plan["counts"],
            "cards": [
                {
                    key: entry[key]
                    for key in (
                        "relpath",
                        "memory_id",
                        "disposition",
                        "quarantine_reason",
                        "target_assertion_id",
                    )
                    if key in entry
                }
                for entry in plan["entries"]
            ],
        }
        summary.update(extra)
        return summary

    if dry_run:
        return _summary()

    # One dedicated repository/workspace-wide conversion lock serializes
    # staging cleanup/build, publish, sidecar baseline creation, and the
    # shared campaign-index update for ALL target ids (index updates are a
    # shared read-modify-write). The fresh-vs-replay decision is (re)made
    # inside the lock, so a concurrent conversion converges (the loser
    # becomes a replay) or fails cleanly on lock timeout instead of racing.
    with _open_import_lock(root, target_campaign):
        target_dir = _safe_campaign_dir(root, target_campaign, label="target")
        if target_dir.exists():
            # Path validation strictly precedes any receipt/manifest/store
            # read: every parent and leaf under the target memory tree must
            # be a real file or directory before a single byte is read.
            _assert_target_memory_tree_clean(target_dir)
            receipt = _read_receipt(target_dir)
            if receipt is None:
                raise LegacyConversionError(
                    f"target campaign directory already exists without a "
                    f"complete legacy-import receipt: {target_campaign}; "
                    "conversion never overwrites an existing target"
                )
            _verify_replay(root, plan, receipt)
            # Replay publishes no source-derived target bytes; planning already
            # recomputed the live snapshots and selected historical tree.
            _repair_post_publish(root, target_campaign)
            return _summary(replay=True, **_public_evidence_paths())

        # All staging artifacts — including the receipt — are built and
        # written first. The second source-tree/Git verification is then
        # the FINAL operation before the atomic rename, with no intervening
        # receipt construction, write, or read. The receipt's preservation
        # claim is accepted only because this verification succeeds and
        # publication follows immediately under the same lock.
        staged_dir = _stage_generation(root, plan)
        receipt = _build_receipt(plan, staged_dir)
        _atomic_write_json(
            staged_dir,
            "memory/legacy-import/conversion-receipt.json",
            receipt,
        )
        target_dir = _prepare_atomic_publish(root, plan, staged_dir)
        staging_home = staged_dir.parent
        _verify_source_unchanged(root, plan)
        os.rename(staged_dir, target_dir)
        try:
            staging_home.rmdir()
        except OSError:
            pass
        _repair_post_publish(root, target_campaign)
        return _summary(replay=False, **_public_evidence_paths())


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _positive_source_turn(value: str) -> int:
    """Argparse boundary for the sole model/human historical selector."""
    if not value.isascii() or not value.isdigit() or int(value) < 1:
        raise argparse.ArgumentTypeError("source turn must be a positive integer")
    return int(value)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog=TOOL_NAME,
        description=(
            "Convert legacy Markdown memory cards into a fresh "
            "temporal-memory-1 target campaign. The source campaign is "
            "never modified; unprovable records are quarantined, never "
            "materialized."
        ),
    )
    parser.add_argument("--root", default=".", help="repository root (default: .)")
    parser.add_argument(
        "--source-campaign", required=True, help="source campaign id (read-only)"
    )
    parser.add_argument(
        "--target-campaign",
        required=True,
        help=(
            "fresh target campaign id; must not exist. Suggested pattern: "
            "<source-id>" + SUGGESTED_TARGET_SUFFIX
        ),
    )
    parser.add_argument(
        "--target-title", default=None, help="optional title for the fresh target"
    )
    parser.add_argument(
        "--source-turn",
        type=_positive_source_turn,
        default=None,
        metavar="N",
        help=(
            "optional finalized turn number; reads only that immutable active-"
            "timeline commit and permits a dirty source worktree"
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="inventory, prove, and plan without writing anything",
    )
    args = parser.parse_args(argv)
    try:
        result = convert_legacy_memory(
            args.root,
            source_campaign=args.source_campaign,
            target_campaign=args.target_campaign,
            target_title=args.target_title,
            source_turn=args.source_turn,
            dry_run=args.dry_run,
        )
    except LegacyConversionError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
