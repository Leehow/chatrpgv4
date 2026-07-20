#!/usr/bin/env python3
"""Versioned, rebuildable compiled archive for progressive module IR.

Canonical scenario IR and campaign save state remain authoritative. Archive
documents are materialized read models only: exact-schema, hash-bound, scene
and entity sharded, published through an atomic manifest. Malformed or stale
documents fail closed; there are no legacy migrations.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable

_HERE = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, _HERE / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio_compiled_archive", "coc_fileio.py")

SCHEMA_VERSION = 1
ARCHIVE_KIND = "compiled_archive_manifest"
SCENE_KIND = "compiled_scene_shard"
NPC_KIND = "compiled_npc_shard"
CLUE_KIND = "compiled_clue_shard"
SECRET_KIND = "compiled_keeper_secret_shard"
STATUS_KIND = "compiled_archive_status"
ARCHIVE_DIRNAME = "compiled-archive"
GENERATIONS_DIRNAME = "generations"
MANIFEST_NAME = "manifest.json"
STATUS_NAME = "status.json"
_SAFE = re.compile(r"[^A-Za-z0-9._-]+")

# Exactly the seven authoritative progressive IR files the archive consumes.
# scenario.json is campaign metadata only and must never enter source identity.
CANONICAL_IR_FILES: tuple[str, ...] = (
    "module-meta.json",
    "story-graph.json",
    "clue-graph.json",
    "npc-agendas.json",
    "threat-fronts.json",
    "pacing-map.json",
    "improvisation-boundaries.json",
)

MANIFEST_FIELDS = frozenset({
    "schema_version", "kind", "campaign_id", "archive_revision",
    "source_identity", "published_at", "status", "shard_index",
    "covered_domains", "content_sha256",
})
STATUS_FIELDS = frozenset({
    "schema_version", "kind", "campaign_id", "status", "error",
    "updated_at", "archive_revision",
})
COMMON_SHARD_FIELDS = frozenset({
    "schema_version", "kind", "campaign_id", "entity_id", "content_sha256",
    "source_identity", "parse_state", "evidence_gap", "player_safe",
    "keeper_only", "drilldown_refs", "provenance",
})


class CompiledArchiveError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _safe_id(value: str) -> str:
    cleaned = _SAFE.sub("-", str(value or "").strip()).strip("-")
    return cleaned or "unknown"


def _archive_root(campaign_dir: Path) -> Path:
    return Path(campaign_dir) / "save" / ARCHIVE_DIRNAME


def _manifest_path(campaign_dir: Path) -> Path:
    return _archive_root(campaign_dir) / MANIFEST_NAME


def _status_path(campaign_dir: Path) -> Path:
    return _archive_root(campaign_dir) / STATUS_NAME


def _shard_rel(kind: str, entity_id: str, *, generation: str) -> str:
    """Relative path under archive root, inside an immutable generation tree."""
    gen = _safe_id(generation)
    return f"{GENERATIONS_DIRNAME}/{gen}/shards/{kind}/{_safe_id(entity_id)}.json"


def _read_plugin_contract_identity() -> dict[str, Any]:
    path = Path(__file__).resolve()
    try:
        raw = path.read_bytes()
        digest = f"sha256:{hashlib.sha256(raw).hexdigest()}"
        stat = path.stat()
        size = stat.st_size
    except OSError:
        digest = "sha256:unavailable"
        size = None
    return {
        "name": "coc-compiled-archive",
        "schema_version": SCHEMA_VERSION,
        "module": path.name,
        "module_sha256": digest,
        "module_size": size,
    }


_PLUGIN_CONTRACT_IDENTITY = _read_plugin_contract_identity()


def _plugin_contract_identity() -> dict[str, Any]:
    """Identity of the compiler code loaded by this process.

    The file hash is captured once at import. Hot-path archive reads compare
    this small value to the identity stored in the manifest; they never scan
    canonical IR or touch the source PDF.
    """
    return deepcopy(_PLUGIN_CONTRACT_IDENTITY)


def _canonical_ir_files(ir: dict[str, Any]) -> dict[str, Any]:
    """Return only the seven authoritative IR payloads (deepcopy)."""
    files: dict[str, Any] = {}
    missing: list[str] = []
    for name in CANONICAL_IR_FILES:
        payload = ir.get(name)
        if not isinstance(payload, dict):
            missing.append(name)
            continue
        files[name] = deepcopy(payload)
    if missing:
        raise CompiledArchiveError(
            "source_incomplete",
            "canonical IR missing: " + ", ".join(missing),
        )
    return files


def ir_source_identity(ir: dict[str, Any]) -> dict[str, Any]:
    """Deterministic identity of the seven-file IR used to build the archive.

    Includes the archive contract identity so a contract change cannot collide
    with an older generation derived from the same IR payload.
    """
    files = _canonical_ir_files(ir)
    return {
        "ir_digest": _digest(files),
        "file_names": list(CANONICAL_IR_FILES),
        "plugin_contract": _plugin_contract_identity(),
    }


def archive_revision_for_source(source_identity: dict[str, Any]) -> str:
    """Stable generation/revision id from the complete source identity."""
    digest = _digest(source_identity)
    hex_part = digest.split(":", 1)[-1]
    return f"ca-v1-{hex_part[:32]}"


def campaign_ir_source_identity(campaign_dir: Path) -> dict[str, Any]:
    """Explicit rebuild helper: hash only the seven canonical IR files on disk.

    Not for hot-path consumers. scenario.json is intentionally excluded.
    """
    scenario = Path(campaign_dir) / "scenario"
    files: dict[str, Any] = {}
    for name in CANONICAL_IR_FILES:
        path = scenario / name
        if not path.is_file():
            raise CompiledArchiveError(
                "source_incomplete",
                f"canonical IR file missing: {name}",
            )
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise CompiledArchiveError(
                "source_unreadable",
                f"cannot read scenario source {name}",
            ) from exc
        if not isinstance(payload, dict):
            raise CompiledArchiveError(
                "source_unreadable",
                f"scenario source {name} is not an object",
            )
        files[name] = payload
    return ir_source_identity(files)


def _write_status(
    campaign_dir: Path,
    *,
    status: str,
    error: str | None = None,
    archive_revision: str | None = None,
) -> None:
    payload = {
        "schema_version": SCHEMA_VERSION,
        "kind": STATUS_KIND,
        "campaign_id": Path(campaign_dir).name,
        "status": status,
        "error": error,
        "updated_at": _now_iso(),
        "archive_revision": archive_revision,
    }
    if set(payload) != STATUS_FIELDS:
        raise CompiledArchiveError("internal", "status fields mismatch")
    root = _archive_root(campaign_dir)
    root.mkdir(parents=True, exist_ok=True)
    coc_fileio.write_json_atomic(
        _status_path(campaign_dir),
        payload,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )


def _write_status_best_effort(
    campaign_dir: Path,
    *,
    status: str,
    error: str | None = None,
    archive_revision: str | None = None,
) -> bool:
    """Best-effort status write; never raises to callers."""
    try:
        _write_status(
            campaign_dir,
            status=status,
            error=error,
            archive_revision=archive_revision,
        )
        return True
    except Exception:  # noqa: BLE001 — status is non-authoritative
        return False


def _neutralize_status_best_effort(campaign_dir: Path) -> bool:
    """Best-effort remove advisory status.json so it cannot poison a valid manifest.

    Status is non-authoritative. When a successful publish cannot write
    ``status=current``, an older mismatched status would make ``load_published``
    fail closed incorrectly. Removing the file restores the advisory-missing
    path (trust a valid manifest). Never raises.
    """
    try:
        path = _status_path(Path(campaign_dir))
        if path.is_file():
            path.unlink()
        return True
    except Exception:  # noqa: BLE001 — advisory only
        return False


def record_error(
    campaign_dir: Path,
    error: str,
    *,
    archive_revision: str | None = None,
) -> None:
    """Persist an explicit archive failure without touching the current manifest.

    Best-effort only: status I/O failures never escape. Archive status must not
    become an authority gate for canonical IR writers. When a failed publish
    already computed an attempted generation revision, pass it so consumers can
    detect staleness against the previous live manifest.
    """
    _write_status_best_effort(
        Path(campaign_dir),
        status="error",
        error=str(error),
        archive_revision=archive_revision,
    )


def load_status(campaign_dir: Path) -> dict[str, Any] | None:
    path = _status_path(campaign_dir)
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or set(payload) != STATUS_FIELDS:
        return None
    if (
        payload.get("schema_version") != SCHEMA_VERSION
        or payload.get("kind") != STATUS_KIND
        or payload.get("campaign_id") != Path(campaign_dir).name
    ):
        return None
    return payload


def _validate_manifest(payload: dict[str, Any], campaign_dir: Path) -> dict[str, Any]:
    if set(payload) != MANIFEST_FIELDS:
        raise CompiledArchiveError("archive_corrupt", "manifest fields invalid")
    if (
        payload.get("schema_version") != SCHEMA_VERSION
        or payload.get("kind") != ARCHIVE_KIND
        or payload.get("campaign_id") != Path(campaign_dir).name
        or payload.get("status") != "current"
        or not isinstance(payload.get("archive_revision"), str)
        or not payload["archive_revision"]
        or not isinstance(payload.get("source_identity"), dict)
        or not isinstance(payload.get("shard_index"), dict)
        or not isinstance(payload.get("covered_domains"), list)
        or not isinstance(payload.get("content_sha256"), str)
    ):
        raise CompiledArchiveError("archive_corrupt", "manifest schema invalid")
    body = {
        key: payload[key]
        for key in (
            "schema_version", "kind", "campaign_id", "archive_revision",
            "source_identity", "published_at", "status", "shard_index",
            "covered_domains",
        )
    }
    if payload["content_sha256"] != _digest(body):
        raise CompiledArchiveError("archive_corrupt", "manifest content hash mismatch")
    return payload


def load_manifest(campaign_dir: Path) -> dict[str, Any]:
    path = _manifest_path(campaign_dir)
    if not path.is_file():
        raise CompiledArchiveError("archive_missing", "compiled archive manifest missing")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CompiledArchiveError(
            "archive_corrupt", "compiled archive manifest unreadable"
        ) from exc
    if not isinstance(payload, dict):
        raise CompiledArchiveError("archive_corrupt", "manifest must be an object")
    manifest = _validate_manifest(payload, campaign_dir)
    stored_contract = (manifest.get("source_identity") or {}).get("plugin_contract")
    current_contract = _plugin_contract_identity()
    if stored_contract != current_contract:
        raise CompiledArchiveError(
            "archive_stale",
            "compiled archive was built by a different compiler contract; "
            "writer-side rebuild required",
        )
    return manifest


def _validate_shard(payload: dict[str, Any], *, kind: str, campaign_id: str) -> dict[str, Any]:
    if set(payload) != COMMON_SHARD_FIELDS:
        raise CompiledArchiveError("archive_corrupt", f"{kind} shard fields invalid")
    if (
        payload.get("schema_version") != SCHEMA_VERSION
        or payload.get("kind") != kind
        or payload.get("campaign_id") != campaign_id
        or not isinstance(payload.get("entity_id"), str)
        or not payload["entity_id"]
        or not isinstance(payload.get("player_safe"), dict)
        or not isinstance(payload.get("keeper_only"), dict)
        or payload["keeper_only"].get("secret") is not True
        or not isinstance(payload.get("drilldown_refs"), dict)
        or not isinstance(payload.get("provenance"), dict)
        or not isinstance(payload.get("source_identity"), dict)
    ):
        raise CompiledArchiveError("archive_corrupt", f"{kind} shard schema invalid")
    body = {key: payload[key] for key in COMMON_SHARD_FIELDS if key != "content_sha256"}
    if payload.get("content_sha256") != _digest(body):
        raise CompiledArchiveError("archive_corrupt", f"{kind} shard hash mismatch")
    return payload


def _load_shard(
    campaign_dir: Path,
    *,
    rel_path: str,
    kind: str,
    expected_sha: str | None = None,
) -> dict[str, Any]:
    path = _archive_root(campaign_dir) / rel_path
    if not path.is_file():
        raise CompiledArchiveError("archive_corrupt", f"missing shard {rel_path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CompiledArchiveError(
            "archive_corrupt", f"unreadable shard {rel_path}"
        ) from exc
    if not isinstance(payload, dict):
        raise CompiledArchiveError("archive_corrupt", f"shard {rel_path} not object")
    shard = _validate_shard(
        payload, kind=kind, campaign_id=Path(campaign_dir).name,
    )
    if expected_sha is not None and shard["content_sha256"] != expected_sha:
        raise CompiledArchiveError(
            "archive_stale", f"shard {rel_path} digest does not match manifest"
        )
    return shard


def load_scene_shard(campaign_dir: Path, scene_id: str) -> dict[str, Any]:
    manifest = load_manifest(campaign_dir)
    row = (manifest.get("shard_index") or {}).get("scenes", {}).get(str(scene_id))
    if not isinstance(row, dict):
        raise CompiledArchiveError(
            "archive_missing", f"no scene shard for {scene_id!r}"
        )
    return _load_shard(
        campaign_dir,
        rel_path=str(row["path"]),
        kind=SCENE_KIND,
        expected_sha=str(row.get("content_sha256") or ""),
    )


def is_manifest_current(
    campaign_dir: Path,
    source_identity: dict[str, Any] | None = None,
) -> bool:
    """Compare published manifest identity to an explicit source identity.

    When ``source_identity`` is omitted this reads disk IR (repair/diagnostic
    only). Hot-path consumers must not call this.
    """
    try:
        manifest = load_manifest(campaign_dir)
    except CompiledArchiveError:
        return False
    expected = source_identity or campaign_ir_source_identity(campaign_dir)
    return manifest.get("source_identity") == expected


def _all_clues(clue_graph: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for conclusion in clue_graph.get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        for clue in conclusion.get("clues") or []:
            if isinstance(clue, dict) and clue.get("clue_id"):
                row = deepcopy(clue)
                row["conclusion_id"] = conclusion.get("conclusion_id")
                out.append(row)
    return out


def _clue_map(ir: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(clue["clue_id"]): clue
        for clue in _all_clues(ir.get("clue-graph.json") or {})
    }


def _npc_map(ir: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for npc in (ir.get("npc-agendas.json") or {}).get("npcs") or []:
        if isinstance(npc, dict) and npc.get("npc_id"):
            out[str(npc["npc_id"])] = npc
    return out


def _secret_map(ir: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for secret in (ir.get("improvisation-boundaries.json") or {}).get(
        "keeper_secrets"
    ) or []:
        if isinstance(secret, dict) and secret.get("id"):
            out[str(secret["id"])] = secret
    return out


def _build_shard(
    *,
    kind: str,
    campaign_id: str,
    entity_id: str,
    source_identity: dict[str, Any],
    parse_state: Any,
    evidence_gap: bool,
    player_safe: dict[str, Any],
    keeper_only: dict[str, Any],
    drilldown_refs: dict[str, Any],
    provenance: dict[str, Any],
) -> dict[str, Any]:
    keeper = deepcopy(keeper_only)
    keeper["secret"] = True
    body = {
        "schema_version": SCHEMA_VERSION,
        "kind": kind,
        "campaign_id": campaign_id,
        "entity_id": entity_id,
        "source_identity": source_identity,
        "parse_state": parse_state,
        "evidence_gap": bool(evidence_gap),
        "player_safe": deepcopy(player_safe),
        "keeper_only": keeper,
        "drilldown_refs": deepcopy(drilldown_refs),
        "provenance": deepcopy(provenance),
    }
    body["content_sha256"] = _digest(body)
    return body


def build_documents(
    ir: dict[str, Any],
    *,
    campaign_id: str,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """Build manifest + generation-relative shard map from canonical IR."""
    source = ir_source_identity(ir)
    generation = archive_revision_for_source(source)
    scenes = (ir.get("story-graph.json") or {}).get("scenes") or []
    clues = _clue_map(ir)
    npcs = _npc_map(ir)
    secrets = _secret_map(ir)
    shards: dict[str, dict[str, Any]] = {}
    scene_index: dict[str, Any] = {}
    npc_index: dict[str, Any] = {}
    clue_index: dict[str, Any] = {}
    secret_index: dict[str, Any] = {}

    for scene in scenes:
        if not isinstance(scene, dict) or not scene.get("scene_id"):
            continue
        sid = str(scene["scene_id"])
        clue_ids = [str(c) for c in (scene.get("available_clues") or []) if c]
        npc_ids = [str(n) for n in (scene.get("npc_ids") or []) if n]
        secret_ids = [
            str(ref.get("id") if isinstance(ref, dict) else ref)
            for ref in (scene.get("keeper_secret_refs") or [])
            if ref
        ]
        # Also bind module-level secrets that explicitly list this scene.
        for secret_id, secret in secrets.items():
            scene_ids = {
                str(value)
                for value in (secret.get("scene_ids") or [])
                if value
            }
            if sid in scene_ids and secret_id not in secret_ids:
                secret_ids.append(secret_id)
        on_enter = scene.get("on_enter") if isinstance(scene.get("on_enter"), dict) else {}
        affordances = [
            deepcopy(row)
            for row in (scene.get("affordances") or [])
            if isinstance(row, dict)
        ]
        keeper_ops = []
        public_affordances = []
        for row in affordances:
            public = {
                key: deepcopy(value)
                for key, value in row.items()
                if key != "rules_operation"
            }
            public_affordances.append(public)
            op = row.get("rules_operation")
            if isinstance(op, dict):
                keeper_ops.append({
                    "affordance_id": row.get("id"),
                    "kind": op.get("kind"),
                    "tool": (
                        "combat.resolve"
                        if op.get("kind") == "combat_engagement"
                        else None
                    ),
                })
        shard = _build_shard(
            kind=SCENE_KIND,
            campaign_id=campaign_id,
            entity_id=sid,
            source_identity=source,
            parse_state=scene.get("parse_state"),
            evidence_gap=bool(scene.get("evidence_gap")),
            player_safe={
                "display_name": scene.get("display_name"),
                "scene_type": scene.get("scene_type"),
                "dramatic_question": scene.get("dramatic_question"),
                "tone": scene.get("tone"),
                "location_tags": scene.get("location_tags"),
                "player_safe_summary": scene.get("player_safe_summary"),
                "pressure_moves": scene.get("pressure_moves"),
                "exit_conditions": scene.get("exit_conditions"),
                "allowed_improvisation": scene.get("allowed_improvisation"),
                "affordances": public_affordances,
                "scene_edges": deepcopy(scene.get("scene_edges") or []),
                "available_clue_ids": clue_ids,
                "npc_ids": npc_ids,
            },
            keeper_only={
                "san_triggers": deepcopy(on_enter.get("san_triggers") or []),
                "affordance_operations": keeper_ops,
                "secret_ref_ids": secret_ids,
            },
            drilldown_refs={
                "npc": npc_ids,
                "clue": clue_ids,
                "secret": secret_ids,
            },
            provenance={
                "scene_id": sid,
                "origin": scene.get("origin"),
                "source_refs": deepcopy(scene.get("source_refs") or []),
                "source_span": deepcopy(scene.get("source_span")),
                "source_page_indices": deepcopy(
                    scene.get("source_page_indices") or []
                ),
                "page_text_sha256": deepcopy(scene.get("page_text_sha256") or []),
                "source_evidence": deepcopy(scene.get("source_evidence")),
                "source_discrepancies": deepcopy(
                    scene.get("source_discrepancies") or []
                ),
            },
        )
        rel = _shard_rel("scene", sid, generation=generation)
        shards[rel] = shard
        scene_index[sid] = {
            "path": rel,
            "content_sha256": shard["content_sha256"],
            "parse_state": shard["parse_state"],
            "evidence_gap": shard["evidence_gap"],
            "npc_ids": npc_ids,
            "clue_ids": clue_ids,
            "secret_ids": secret_ids,
        }

    for nid, npc in npcs.items():
        player_safe = {
            "name": npc.get("name") or npc.get("display_name") or nid,
            "display_name": npc.get("display_name") or npc.get("name") or nid,
            "voice": npc.get("voice"),
            "relationship_to_investigators": npc.get(
                "relationship_to_investigators"
            ),
            "availability": npc.get("availability"),
            "social_role": npc.get("social_role"),
            "role_label": npc.get("role_label"),
            "player_safe_summary": npc.get("player_safe_summary"),
            "aliases": deepcopy(npc.get("aliases") or npc.get("names") or []),
        }
        # Identity contract needs stable authored fields without free-prose
        # secret bodies leaking into player_safe.
        identity_fields = {
            key: deepcopy(npc[key])
            for key in (
                "npc_id", "name", "display_name", "names", "aliases", "voice",
                "relationship_to_investigators", "social_role", "role_label", "schedule",
                "agenda", "source_refs", "origin", "parse_state",
            )
            if key in npc
        }
        identity_fields["npc_id"] = nid
        shard = _build_shard(
            kind=NPC_KIND,
            campaign_id=campaign_id,
            entity_id=nid,
            source_identity=source,
            parse_state=npc.get("parse_state"),
            evidence_gap=bool(npc.get("evidence_gap")),
            player_safe=player_safe,
            keeper_only={
                "agenda": npc.get("agenda"),
                "secret": npc.get("secret"),
                "keeper_note": npc.get("keeper_note"),
                "keeper_only_notes": npc.get("keeper_only_notes"),
                "identity_source": identity_fields,
            },
            drilldown_refs={"scene": list(npc.get("scene_ids") or [])},
            provenance={
                "npc_id": nid,
                "origin": npc.get("origin"),
                "source_refs": deepcopy(npc.get("source_refs") or []),
                "source_span": deepcopy(npc.get("source_span")),
                "source_page_indices": deepcopy(npc.get("source_page_indices") or []),
                "page_text_sha256": deepcopy(npc.get("page_text_sha256") or []),
                "source_evidence": deepcopy(npc.get("source_evidence")),
                "source_discrepancies": deepcopy(
                    npc.get("source_discrepancies") or []
                ),
            },
        )
        rel = _shard_rel("npc", nid, generation=generation)
        shards[rel] = shard
        npc_index[nid] = {
            "path": rel,
            "content_sha256": shard["content_sha256"],
            "parse_state": shard["parse_state"],
            "evidence_gap": shard["evidence_gap"],
        }

    for cid, clue in clues.items():
        shard = _build_shard(
            kind=CLUE_KIND,
            campaign_id=campaign_id,
            entity_id=cid,
            source_identity=source,
            parse_state=clue.get("parse_state"),
            evidence_gap=bool(clue.get("evidence_gap")),
            player_safe={
                "clue_id": cid,
                "conclusion_id": clue.get("conclusion_id"),
                "delivery": clue.get("delivery"),
                "delivery_kind": clue.get("delivery_kind"),
                "skill": clue.get("skill"),
                "difficulty": clue.get("difficulty"),
                "visibility": clue.get("visibility") or "player-safe",
            },
            keeper_only={
                "player_safe_summary": clue.get("player_safe_summary"),
                "localized_text": clue.get("localized_text"),
                "mentions": deepcopy(clue.get("mentions") or []),
                "source_npc_ids": deepcopy(clue.get("source_npc_ids") or []),
            },
            drilldown_refs={
                "scene": list(clue.get("scene_ids") or []),
                "npc": list(clue.get("source_npc_ids") or []),
            },
            provenance={
                "clue_id": cid,
                "origin": clue.get("origin"),
                "source_refs": deepcopy(clue.get("source_refs") or []),
                "source_span": deepcopy(clue.get("source_span")),
                "source_page_indices": deepcopy(clue.get("source_page_indices") or []),
                "page_text_sha256": deepcopy(clue.get("page_text_sha256") or []),
                "source_evidence": deepcopy(clue.get("source_evidence")),
                "source_discrepancies": deepcopy(
                    clue.get("source_discrepancies") or []
                ),
            },
        )
        rel = _shard_rel("clue", cid, generation=generation)
        shards[rel] = shard
        clue_index[cid] = {
            "path": rel,
            "content_sha256": shard["content_sha256"],
            "parse_state": shard["parse_state"],
            "evidence_gap": shard["evidence_gap"],
        }

    for secret_id, secret in secrets.items():
        shard = _build_shard(
            kind=SECRET_KIND,
            campaign_id=campaign_id,
            entity_id=secret_id,
            source_identity=source,
            parse_state=secret.get("parse_state") or "source",
            evidence_gap=bool(secret.get("evidence_gap")),
            player_safe={
                "secret_id": secret_id,
                "category": secret.get("category") or "keeper_secret",
                "has_body": bool(secret.get("prose")),
            },
            keeper_only={
                "prose": secret.get("prose") or "",
                "category": secret.get("category") or "keeper_secret",
                "scene_ids": list(secret.get("scene_ids") or []),
            },
            drilldown_refs={"scene": list(secret.get("scene_ids") or [])},
            provenance={
                "secret_id": secret_id,
                "origin": secret.get("origin") or "source",
                "source_refs": deepcopy(secret.get("source_refs") or []),
                "source_evidence": deepcopy(secret.get("source_evidence")),
            },
        )
        rel = _shard_rel("keeper-secret", secret_id, generation=generation)
        shards[rel] = shard
        secret_index[secret_id] = {
            "path": rel,
            "content_sha256": shard["content_sha256"],
            "keeper_only": True,
            "category": secret.get("category") or "keeper_secret",
        }

    archive_revision = generation
    shard_index = {
        "scenes": scene_index,
        "npcs": npc_index,
        "clues": clue_index,
        "keeper_secrets": secret_index,
    }
    covered = ["scene", "npc", "clue", "keeper_secret"]
    body = {
        "schema_version": SCHEMA_VERSION,
        "kind": ARCHIVE_KIND,
        "campaign_id": campaign_id,
        "archive_revision": archive_revision,
        "source_identity": source,
        "published_at": _now_iso(),
        "status": "current",
        "shard_index": shard_index,
        "covered_domains": covered,
    }
    body["content_sha256"] = _digest(body)
    return body, shards


def publish_from_ir(
    campaign_dir: Path,
    ir: dict[str, Any],
) -> dict[str, Any]:
    """Generation-atomic publish: write a new generation tree, then switch manifest.

    All shards live under ``generations/<archive_revision>/...``. The published
    ``manifest.json`` is written only after every generation document is on
    disk. A failed new generation never overwrites shards still referenced by
    the previous manifest.

    On failure after ``build_documents``, best-effort records ``status=error``
    with the attempted generation revision so ``load_published`` can fail closed
    instead of silently serving a stale prior manifest. Always returns
    ``{ok:true|false,...}`` without raising. Canonical IR is never modified.
    """
    campaign_dir = Path(campaign_dir)
    campaign_id = campaign_dir.name
    attempted_revision: str | None = None
    try:
        manifest, shards = build_documents(ir, campaign_id=campaign_id)
        root = _archive_root(campaign_dir)
        root.mkdir(parents=True, exist_ok=True)
        generation = str(manifest["archive_revision"])
        attempted_revision = generation
        gen_root = root / GENERATIONS_DIRNAME / _safe_id(generation)
        gen_root.mkdir(parents=True, exist_ok=True)
        # Status is advisory only; failures here must not abort a valid publish.
        _write_status_best_effort(
            campaign_dir,
            status="building",
            archive_revision=generation,
        )
        for rel, payload in sorted(shards.items()):
            path = root / rel
            # Defensive: every shard path must land inside this generation tree.
            try:
                path.resolve().relative_to(gen_root.resolve())
            except ValueError as exc:
                raise CompiledArchiveError(
                    "internal",
                    f"shard path escapes generation: {rel}",
                ) from exc
            path.parent.mkdir(parents=True, exist_ok=True)
            coc_fileio.write_json_atomic(
                path,
                payload,
                indent=2,
                ensure_ascii=False,
                trailing_newline=True,
            )
        # Manifest is the atomic publish gate: written last, after generation docs.
        coc_fileio.write_json_atomic(
            _manifest_path(campaign_dir),
            manifest,
            indent=2,
            ensure_ascii=False,
            trailing_newline=True,
        )
        status_current_ok = _write_status_best_effort(
            campaign_dir,
            status="current",
            archive_revision=generation,
        )
        if not status_current_ok:
            # Manifest already switched. An older mismatched status must not
            # poison consumers of this successful generation.
            _neutralize_status_best_effort(campaign_dir)
        return {
            "ok": True,
            "archive_revision": generation,
            "generation": generation,
            "scene_shards": len(manifest["shard_index"]["scenes"]),
            "npc_shards": len(manifest["shard_index"]["npcs"]),
            "clue_shards": len(manifest["shard_index"]["clues"]),
            "secret_shards": len(manifest["shard_index"]["keeper_secrets"]),
            "manifest_path": str(
                _manifest_path(campaign_dir).relative_to(campaign_dir)
            ),
        }
    except Exception as exc:  # noqa: BLE001 — never corrupt IR; never raise
        try:
            record_error(
                campaign_dir,
                str(exc),
                archive_revision=attempted_revision,
            )
        except Exception:  # noqa: BLE001 — status best-effort only
            pass
        return {"ok": False, "error": str(exc)}


def publish_from_campaign(campaign_dir: Path) -> dict[str, Any]:
    """Explicit cold-start / repair publish from the seven canonical IR files.

    Never called by hot-path consumers. scenario.json is never loaded.
    """
    campaign_dir = Path(campaign_dir)
    scenario = campaign_dir / "scenario"
    if not scenario.is_dir():
        err = "campaign scenario directory missing"
        record_error(campaign_dir, err)
        return {"ok": False, "error": err}
    ir: dict[str, Any] = {}
    for name in CANONICAL_IR_FILES:
        path = scenario / name
        if not path.is_file():
            err = f"canonical IR file missing: {name}"
            record_error(campaign_dir, err)
            return {"ok": False, "error": err}
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            err = f"unreadable scenario file {name}: {exc}"
            record_error(campaign_dir, err)
            return {"ok": False, "error": err}
        if not isinstance(payload, dict):
            err = f"scenario source {name} is not an object"
            record_error(campaign_dir, err)
            return {"ok": False, "error": err}
        ir[name] = payload
    return publish_from_ir(campaign_dir, ir)


def load_published(
    campaign_dir: Path,
) -> dict[str, Any]:
    """Read-only hot-path load of the published manifest.

    Loads and validates only the small status/manifest surface. Never reads
    scenario IR, never hashes sources, and never rebuilds or repairs.

    Status is advisory relative to the atomic manifest:

    - missing/unreadable status → trust a valid manifest
    - ``current`` / ``building`` / ``error`` with the *same* revision as the
      manifest → trust (the manifest gate proves that exact snapshot)
    - status revision missing or differing from the manifest → fail closed
      with ``archive_stale`` so callers can fall back without rebuilding
    """
    campaign_dir = Path(campaign_dir)
    try:
        manifest = load_manifest(campaign_dir)
    except CompiledArchiveError as exc:
        return {"ok": False, "error": str(exc), "code": exc.code}

    manifest_rev = str(manifest["archive_revision"])
    status = load_status(campaign_dir)
    if status is None:
        return {
            "ok": True,
            "rebuilt": False,
            "archive_revision": manifest_rev,
            "manifest": manifest,
        }

    status_state = status.get("status")
    status_rev = status.get("archive_revision")
    status_rev_ok = isinstance(status_rev, str) and bool(status_rev)
    same_revision = status_rev_ok and status_rev == manifest_rev
    if same_revision and status_state in ("current", "building", "error"):
        return {
            "ok": True,
            "rebuilt": False,
            "archive_revision": manifest_rev,
            "manifest": manifest,
        }

    # Missing revision or revision mismatch: previous manifest may be stale
    # relative to a failed/in-progress generation attempt.
    return {
        "ok": False,
        "error": (
            "compiled archive may be stale relative to last publish attempt "
            f"(status={status_state!r}, status_revision={status_rev!r}, "
            f"manifest_revision={manifest_rev!r})"
        ),
        "code": "archive_stale",
        "status": status_state,
        "status_error": status.get("error"),
        "status_archive_revision": status_rev,
        "manifest_archive_revision": manifest_rev,
    }


def ensure_current(campaign_dir: Path) -> dict[str, Any]:
    """Compatibility alias for :func:`load_published` (read-only, no rebuild).

    Historical name; does not ensure freshness against disk IR. Prefer
    ``load_published`` for new callers. Explicit repair uses
    ``publish_from_campaign`` / writer-side ``publish_from_ir``.
    """
    return load_published(campaign_dir)


def player_safe_scene_view(shard: dict[str, Any]) -> dict[str, Any]:
    """Project only player-safe fields from a scene shard."""
    _validate_shard(
        shard, kind=SCENE_KIND, campaign_id=str(shard.get("campaign_id") or ""),
    )
    safe = deepcopy(shard["player_safe"])
    safe["scene_id"] = shard["entity_id"]
    safe["parse_state"] = shard.get("parse_state")
    safe["evidence_gap"] = bool(shard.get("evidence_gap"))
    return safe


def active_scene_static_packet(
    campaign_dir: Path,
    scene_id: str,
) -> dict[str, Any]:
    """Bounded static packet for one active scene from the published archive.

    Hot path: reads only the published manifest and referenced shards.
    """
    campaign_dir = Path(campaign_dir)
    loaded = load_published(campaign_dir)
    if not loaded.get("ok"):
        raise CompiledArchiveError(
            str(loaded.get("code") or "archive_error"),
            str(loaded.get("error") or "compiled archive unavailable"),
        )
    manifest = loaded["manifest"]
    scene_row = (manifest["shard_index"].get("scenes") or {}).get(str(scene_id))
    if not isinstance(scene_row, dict):
        raise CompiledArchiveError(
            "archive_missing", f"active scene {scene_id!r} not in archive"
        )
    scene_shard = _load_shard(
        campaign_dir,
        rel_path=str(scene_row["path"]),
        kind=SCENE_KIND,
        expected_sha=str(scene_row.get("content_sha256") or ""),
    )
    npc_shards = []
    for npc_id in scene_shard["player_safe"].get("npc_ids") or []:
        row = (manifest["shard_index"].get("npcs") or {}).get(str(npc_id))
        if not isinstance(row, dict):
            continue
        shard = _load_shard(
            campaign_dir,
            rel_path=str(row["path"]),
            kind=NPC_KIND,
            expected_sha=str(row.get("content_sha256") or ""),
        )
        npc_shards.append(shard)
    clue_shards = []
    for clue_id in scene_shard["player_safe"].get("available_clue_ids") or []:
        row = (manifest["shard_index"].get("clues") or {}).get(str(clue_id))
        if not isinstance(row, dict):
            continue
        shard = _load_shard(
            campaign_dir,
            rel_path=str(row["path"]),
            kind=CLUE_KIND,
            expected_sha=str(row.get("content_sha256") or ""),
        )
        clue_shards.append(shard)
    return {
        "archive_revision": manifest["archive_revision"],
        "source_identity": manifest["source_identity"],
        "covered_domains": list(manifest["covered_domains"]),
        "scene": scene_shard,
        "npcs": npc_shards,
        "clues": clue_shards,
        "drilldown_refs": deepcopy(scene_shard.get("drilldown_refs") or {}),
    }


def secrets_briefing_from_archive(
    campaign_dir: Path,
    *,
    scope: str,
    scene_id: str | None = None,
    npc_ids: Iterable[str] | None = None,
    clue_ids: Iterable[str] | None = None,
    discovered_clue_ids: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Keeper-only secret briefing from archive shards.

    Hot path: reads only the published manifest and referenced shards.
    Default and entity scopes never walk the whole module. Whole-module audit
    is explicit only.

    For ``scope=entities``, a scene is included only when the caller passed an
    explicit ``scene_id``; npc_ids/clue_ids alone never expand to the active
    scene.
    """
    campaign_dir = Path(campaign_dir)
    loaded = load_published(campaign_dir)
    if not loaded.get("ok"):
        raise CompiledArchiveError(
            str(loaded.get("code") or "archive_error"),
            str(loaded.get("error") or "compiled archive unavailable"),
        )
    manifest = loaded["manifest"]
    discovered = {str(value) for value in (discovered_clue_ids or [])}
    selected_npc_ids = {str(value) for value in (npc_ids or []) if value}
    selected_clue_ids = {str(value) for value in (clue_ids or []) if value}
    selected_secret_ids: set[str] = set()
    scene_ids: set[str] = set()

    if scope == "whole_module_audit":
        scene_ids = set((manifest["shard_index"].get("scenes") or {}))
        selected_npc_ids = set((manifest["shard_index"].get("npcs") or {}))
        selected_clue_ids = set((manifest["shard_index"].get("clues") or {}))
        selected_secret_ids = set(
            (manifest["shard_index"].get("keeper_secrets") or {})
        )
    elif scope == "entities":
        # Only expand via scene when the caller explicitly requested a scene_id.
        if scene_id:
            scene_ids.add(str(scene_id))
    elif scope == "active_scene":
        if not scene_id:
            raise CompiledArchiveError(
                "invalid_request", "active_scene scope requires scene_id"
            )
        scene_ids.add(str(scene_id))
    else:
        raise CompiledArchiveError(
            "invalid_request",
            "scope must be active_scene, entities, or whole_module_audit",
        )

    for sid in scene_ids:
        row = (manifest["shard_index"].get("scenes") or {}).get(sid)
        if not isinstance(row, dict):
            continue
        selected_npc_ids.update(str(n) for n in (row.get("npc_ids") or []))
        selected_clue_ids.update(str(c) for c in (row.get("clue_ids") or []))
        selected_secret_ids.update(str(s) for s in (row.get("secret_ids") or []))

    undiscovered = []
    for clue_id in sorted(selected_clue_ids):
        if clue_id in discovered:
            continue
        row = (manifest["shard_index"].get("clues") or {}).get(clue_id)
        if not isinstance(row, dict):
            continue
        shard = _load_shard(
            campaign_dir,
            rel_path=str(row["path"]),
            kind=CLUE_KIND,
            expected_sha=str(row.get("content_sha256") or ""),
        )
        undiscovered.append({
            "clue_id": clue_id,
            "player_safe_summary": shard["keeper_only"].get("player_safe_summary"),
            "delivery": shard["player_safe"].get("delivery"),
            "delivery_kind": shard["player_safe"].get("delivery_kind"),
            "secret": True,
        })

    npc_secrets = []
    for npc_id in sorted(selected_npc_ids):
        row = (manifest["shard_index"].get("npcs") or {}).get(npc_id)
        if not isinstance(row, dict):
            continue
        shard = _load_shard(
            campaign_dir,
            rel_path=str(row["path"]),
            kind=NPC_KIND,
            expected_sha=str(row.get("content_sha256") or ""),
        )
        secret = shard["keeper_only"].get("secret")
        keeper_note = shard["keeper_only"].get("keeper_note") or shard[
            "keeper_only"
        ].get("keeper_only_notes")
        if not secret and not keeper_note:
            continue
        npc_secrets.append({
            "npc_id": npc_id,
            "name": shard["player_safe"].get("name"),
            "secret": secret,
            "keeper_note": keeper_note,
            "secret_marker": True,
        })

    module_secrets = []
    for secret_id in sorted(selected_secret_ids):
        row = (manifest["shard_index"].get("keeper_secrets") or {}).get(secret_id)
        if not isinstance(row, dict):
            continue
        shard = _load_shard(
            campaign_dir,
            rel_path=str(row["path"]),
            kind=SECRET_KIND,
            expected_sha=str(row.get("content_sha256") or ""),
        )
        module_secrets.append({
            "id": secret_id,
            "category": shard["keeper_only"].get("category"),
            "prose": shard["keeper_only"].get("prose"),
            "secret": True,
        })

    return {
        "scope": scope,
        "scene_id": scene_id,
        "archive_revision": manifest["archive_revision"],
        "covered_domains": ["keeper_secret", "clue", "npc"],
        "undiscovered_clues": undiscovered,
        "npc_secrets": npc_secrets,
        "module_secrets": module_secrets,
        "secret": True,
        "whole_module": scope == "whole_module_audit",
        "selected_counts": {
            "scenes": len(scene_ids),
            "npcs": len(selected_npc_ids),
            "clues": len(selected_clue_ids),
            "secrets": len(selected_secret_ids),
        },
    }


def payload_byte_size(value: Any) -> int:
    """Canonical JSON byte size for bounded-packet comparisons."""
    return len(
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")
    )
