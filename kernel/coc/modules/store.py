"""The module store: `<workspace>/.coc/modules/<module_id>/` (contract §14.1).

Shared by every campaign of one module, append-only in spirit: shards and pages
are never deleted, `status` only advances, `generation` only grows. Every write
is atomic (`fileio.write_json_atomic`)."""

from __future__ import annotations

import datetime as _dt
import shutil
from pathlib import Path
from typing import Any

from ..errors import RpcError, invalid_params
from ..fileio import append_jsonl, read_json, read_jsonl, sha256_file, write_json_atomic
from ..module_graph import ModuleGraph, record_of
from ..rules.graph_digest import compute_graph_content_digest, sort_graph_lists
from ..text import normalize
from .contract import (MODULE_ID_RE, MODULE_STATUSES, SECTION_STATUSES, span_page)

GRAPH_NAME = "module-graph.json"
MANIFEST_NAME = "module-graph-manifest.json"
MANIFEST_CONTRACT_ID = "coc.module-graph-manifest.v1"


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def status_rank(status: str) -> int:
    """`assembled` and `assembled_not_playable` share a rung; everything else is a ladder."""
    ladder = {"registered": 0, "planned": 1, "building": 2, "assembled": 3,
              "assembled_not_playable": 3, "installed": 4}
    return ladder.get(status, -1)


def graph_manifest(graph: dict[str, Any], *, module_id: str, generation: int) -> dict[str, Any]:
    """The summary written beside every graph, hashed the way the rule graph is."""
    nodes = graph.get("nodes") or []
    relations = graph.get("relations") or []
    kinds: dict[str, int] = {}
    for node in nodes:
        if isinstance(node, dict):
            kind = str(node.get("node_kind"))
            kinds[kind] = kinds.get(kind, 0) + 1
    return {
        "contract_id": MANIFEST_CONTRACT_ID,
        "schema_version": 1,
        "module_id": module_id,
        "generation": generation,
        "graph_contract_id": graph.get("contract_id"),
        "graph_content_digest": compute_graph_content_digest(graph),
        "node_count": len(nodes),
        "relation_count": len(relations),
        "claim_count": len(graph.get("claims") or []),
        "node_kinds": dict(sorted(kinds.items())),
        "section_ids": list(graph.get("section_ids") or []),
        "built_at": now_iso(),
    }


class ModuleStore:
    def __init__(self, workspace_root: Path | str) -> None:
        self.workspace = Path(workspace_root)
        self.root = self.workspace / ".coc" / "modules"
        self._graphs: dict[str, tuple[int, ModuleGraph]] = {}

    # ---- paths ----------------------------------------------------------------

    def module_dir(self, module_id: str) -> Path:
        return self.root / module_id

    def module_json(self, module_id: str) -> Path:
        return self.module_dir(module_id) / "module.json"

    def graph_path(self, module_id: str) -> Path:
        if self.module_json(module_id).exists():
            relative = self.module(module_id).get("graph_file")
            if isinstance(relative, str):
                path = (self.module_dir(module_id) / relative).resolve()
                if not path.is_relative_to(self.module_dir(module_id).resolve()):
                    raise ValueError("graph_file escapes the module store")
                return path
        return self.module_dir(module_id) / GRAPH_NAME

    def manifest_path(self, module_id: str) -> Path:
        if self.module_json(module_id).exists() and self.module(module_id).get("graph_file"):
            return self.graph_path(module_id).parent / "module-graph-manifest.json"
        return self.module_dir(module_id) / MANIFEST_NAME

    def bundle_dir(self, module_id: str) -> Path:
        return self.module_dir(module_id) / "bundle"

    def sections_path(self, module_id: str) -> Path:
        return self.module_dir(module_id) / "sections.json"

    def shards_dir(self, module_id: str) -> Path:
        return self.module_dir(module_id) / "shards"

    def shard_path(self, module_id: str, section_id: str) -> Path:
        return self.shards_dir(module_id) / f"{section_id}.json"

    def work_dir(self, module_id: str, section_id: str | None = None) -> Path:
        base = self.module_dir(module_id) / "work"
        return base / section_id if section_id else base

    def assets_path(self, module_id: str) -> Path:
        if self.module_json(module_id).exists() and self.module(module_id).get("graph_file"):
            return self.graph_path(module_id).parent / "assets.json"
        return self.module_dir(module_id) / "assets.json"

    def queue_path(self, module_id: str) -> Path:
        return self.module_dir(module_id) / "deepen-queue.json"

    def build_log_path(self, module_id: str) -> Path:
        return self.module_dir(module_id) / "build.jsonl"

    # ---- identity ---------------------------------------------------------------

    def module_ids(self) -> list[str]:
        if not self.root.exists():
            return []
        return sorted(p.name for p in self.root.iterdir() if (p / "module.json").exists())

    def exists(self, module_id: str) -> bool:
        return isinstance(module_id, str) and self.module_json(module_id).exists()

    @staticmethod
    def validate_id(module_id: Any) -> str:
        if not isinstance(module_id, str) or not MODULE_ID_RE.match(module_id):
            raise invalid_params("module_id must be a short kebab slug",
                                 fix="lowercase letters, digits and '-' (max 64 chars)",
                                 details={"module_id": module_id})
        return module_id

    def module(self, module_id: Any) -> dict[str, Any]:
        if not isinstance(module_id, str) or not module_id:
            raise invalid_params("params.module_id is required")
        path = self.module_json(module_id)
        if not path.exists():
            raise invalid_params(f"unknown module {module_id!r}",
                                 fix="module.bind a bundle or module.register a starter first",
                                 details={"module_id": module_id, "modules": self.module_ids()})
        return read_json(path)

    def write_module(self, meta: dict[str, Any]) -> None:
        meta["updated_at"] = now_iso()
        write_json_atomic(self.module_json(str(meta["id"])), meta)

    def advance(self, meta: dict[str, Any], status: str) -> dict[str, Any]:
        """Status only moves forward; a lower rung is ignored, a sibling rung replaces."""
        if status not in MODULE_STATUSES:
            raise ValueError(f"unknown module status {status!r}")
        current = str(meta.get("status") or "registered")
        if status_rank(status) >= status_rank(current):
            meta["status"] = status
        return meta

    def generation(self, module_id: str) -> int:
        return int(self.module(module_id).get("generation") or 0)

    # ---- graph ------------------------------------------------------------------

    def read_graph(self, module_id: str) -> dict[str, Any] | None:
        path = self.graph_path(module_id)
        return read_json(path) if path.exists() else None

    def write_graph(self, meta: dict[str, Any], graph: dict[str, Any]) -> dict[str, Any]:
        """Write graph + manifest, bump `generation`, refresh `graph_digest`."""
        module_id = str(meta["id"])
        generation = int(meta.get("generation") or 0) + 1
        ordered = sort_graph_lists(graph)
        if meta.get("reading_version") == 1:
            import uuid
            directory = self.module_dir(module_id) / "generations" / f"generation-{generation}-{uuid.uuid4().hex}"
            directory.mkdir(parents=True, exist_ok=False)
            path = directory / GRAPH_NAME
            write_json_atomic(path, ordered)
            write_json_atomic(directory / "module-graph-manifest.json",
                              graph_manifest(ordered, module_id=module_id, generation=generation))
            meta.update(generation=generation, graph_file=str(path.relative_to(self.module_dir(module_id))),
                        graph_digest=sha256_file(path))
            self._graphs.pop(module_id, None)
            return meta
        write_json_atomic(self.graph_path(module_id), ordered)
        write_json_atomic(self.manifest_path(module_id),
                          graph_manifest(ordered, module_id=module_id, generation=generation))
        meta["generation"] = generation
        meta["graph_digest"] = sha256_file(self.graph_path(module_id))
        self._graphs.pop(module_id, None)
        return meta

    def graph(self, module_id: str) -> ModuleGraph:
        """The indexed current-generation graph; the cache keys on `generation` (§14.6)."""
        generation = self.generation(module_id)
        cached = self._graphs.get(module_id)
        if cached and cached[0] == generation:
            return cached[1]
        path = self.graph_path(module_id)
        if not path.exists():
            raise RpcError("campaign_not_ready", f"module {module_id!r} has no graph yet",
                           fix="module.assemble after at least one accepted section")
        loaded = ModuleGraph(module_id, path)
        self._graphs[module_id] = (generation, loaded)
        return loaded

    # ---- starter registration (§14.1) ---------------------------------------------

    def register_starter(self, module_id: str, starters_dir: Path | str) -> dict[str, Any]:
        """Copy `content/starters/<id>/module-graph.json` in and mark it `installed`.
        Idempotent: an entry whose graph is the content graph (same file digest) is
        returned untouched; a changed content graph is copied again as a new generation
        (§14.1: the campaign reads the store's current generation, digest is provenance)."""
        module_id = self.validate_id(module_id)
        source = Path(starters_dir) / module_id / GRAPH_NAME
        if not source.exists():
            raise invalid_params(f"unknown starter {module_id!r}",
                                 fix=f"no {GRAPH_NAME} under {Path(starters_dir) / module_id}")
        existing = self.module(module_id) if self.exists(module_id) else None
        if existing is not None and existing.get("graph_digest") == sha256_file(source):
            return existing
        graph = read_json(source)
        title = module_id
        languages = list(graph.get("source_languages") or [])
        for node in graph.get("nodes") or []:
            if isinstance(node, dict) and node.get("node_kind") == "module" and node.get("name"):
                title = str(node["name"])
                break
        generation = int((existing or {}).get("generation") or 0) + 1
        meta: dict[str, Any] = {
            "id": module_id,
            "title": title,
            "source": "starter",
            "languages": languages,
            "generation": generation,
            "status": "registered",
            "starter_path": str(source),
            "created_at": str((existing or {}).get("created_at") or now_iso()),
            "registered_at": now_iso(),
        }
        self.module_dir(module_id).mkdir(parents=True, exist_ok=True)
        # Byte copy first (the loader and every campaign digest hash the file), then the
        # manifest from the same bytes; nodes/relations keep the order the file has.
        shutil.copyfile(source, self.graph_path(module_id))
        meta["graph_digest"] = sha256_file(self.graph_path(module_id))
        self._graphs.pop(module_id, None)
        write_json_atomic(self.manifest_path(module_id),
                          graph_manifest(graph, module_id=module_id, generation=generation))
        from .assets import registry_from_graph  # local import: assets reads the store
        write_json_atomic(self.assets_path(module_id), registry_from_graph(graph, []))
        from .playability import check as playability_check
        from .playability import opening_check
        meta["playability"] = playability_check(graph)
        opening = opening_check(graph)
        meta["opening"] = opening
        meta["opening_ready"] = bool(opening["opening_ready"])
        meta["installed_at"] = now_iso()
        meta["status"] = "installed"
        self.write_module(meta)
        return meta

    # ---- sections -------------------------------------------------------------------

    def read_sections(self, module_id: str) -> list[dict[str, Any]]:
        path = self.sections_path(module_id)
        return list(read_json(path)) if path.exists() else []

    def write_sections(self, module_id: str, sections: list[dict[str, Any]]) -> None:
        write_json_atomic(self.sections_path(module_id), sections)

    def section(self, module_id: str, section_id: Any) -> dict[str, Any]:
        if not isinstance(section_id, str) or not section_id:
            raise invalid_params("params.section_id is required")
        for row in self.read_sections(module_id):
            if row.get("id") == section_id:
                return row
        raise invalid_params(f"unknown section {section_id!r} in module {module_id!r}",
                             fix="module.plan then module.plan.accept first",
                             details={"sections": [r.get("id") for r in self.read_sections(module_id)]})

    def set_section_status(self, module_id: str, section_id: str, status: str,
                           **fields: Any) -> dict[str, Any]:
        if status not in SECTION_STATUSES:
            raise ValueError(f"unknown section status {status!r}")
        sections = self.read_sections(module_id)
        found: dict[str, Any] | None = None
        for row in sections:
            if row.get("id") == section_id:
                row["status"] = status
                row.update(fields)
                found = row
        if found is None:
            raise invalid_params(f"unknown section {section_id!r}",
                                 fix="use one of details.sections",
                                 details={"field": "section_id",
                                          "sections": [str(row.get("id")) for row in sections]})
        self.write_sections(module_id, sections)
        return found

    def accepted_shards(self, module_id: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for row in self.read_sections(module_id):
            if row.get("status") != "accepted":
                continue
            path = self.shard_path(module_id, str(row["id"]))
            if path.exists():
                out.append(read_json(path))
        return out

    def section_for_page(self, module_id: str, page: int) -> dict[str, Any] | None:
        for row in self.read_sections(module_id):
            pages = row.get("pages") or [None, None]
            if isinstance(pages[0], int) and isinstance(pages[1], int) and pages[0] <= page <= pages[1]:
                return row
        return None

    def section_for_scene(self, module_id: str, scene_handle: str) -> dict[str, Any] | None:
        """`{"section_id", "status"}` for the section whose pages hold this scene, so
        the capsule can say ready|reading|missing (§14.6). A starter (no sections) is
        wholly present: `section_id` None, status `accepted`. None when the scene is
        not in the current graph or its pages belong to no planned section."""
        if not self.exists(module_id) or not self.graph_path(module_id).exists():
            return None
        sections = self.read_sections(module_id)
        graph = self.graph(module_id)
        scene = graph.scene_by_handle(scene_handle)
        if scene is None:
            return None
        if not sections:
            return {"section_id": None, "status": "accepted"}
        for page in sorted(node_pages(scene)):
            row = self.section_for_page(module_id, page)
            if row is not None:
                return {"section_id": row["id"], "status": row.get("status")}
        return None

    # ---- assets (§14.8) ----------------------------------------------------------------

    def assets(self, module_id: str) -> list[dict[str, Any]]:
        path = self.assets_path(module_id)
        if not path.exists():
            return []
        return list(read_json(path).get("assets") or [])

    def asset(self, module_id: str, name: str) -> dict[str, Any] | None:
        """Resolve a registry entry by id, name, node id, or node name (normalized); the
        `path` comes back absolute when the store holds bytes for it."""
        key = normalize(name)
        if not key:
            return None
        for row in self.assets(module_id):
            keys = {row.get("id"), row.get("name"), row.get("node_id"), row.get("bundle_asset_id")}
            keys.update(row.get("aliases") or [])
            node_id = row.get("node_id")
            if isinstance(node_id, str):
                for kind in ("asset", "handout"):
                    if node_id.startswith(f"{kind}-"):
                        keys.add(node_id[len(kind) + 1:])
            if any(isinstance(k, str) and normalize(k) == key for k in keys):
                resolved = dict(row)
                if row.get("path"):
                    resolved["path"] = str(self.module_dir(module_id) / str(row["path"]))
                return resolved
        return None

    # ---- telemetry / queue ----------------------------------------------------------------

    def append_build_log(self, module_id: str, row: dict[str, Any]) -> None:
        append_jsonl(self.build_log_path(module_id), {"at": now_iso(), **row})

    def read_build_log(self, module_id: str) -> list[dict[str, Any]]:
        return read_jsonl(self.build_log_path(module_id))

    def read_queue(self, module_id: str) -> list[dict[str, Any]]:
        path = self.queue_path(module_id)
        return list(read_json(path)) if path.exists() else []

    def write_queue(self, module_id: str, queue: list[dict[str, Any]]) -> None:
        write_json_atomic(self.queue_path(module_id), queue)


def node_pages(node: dict[str, Any]) -> set[int]:
    """Every page a node can be traced to: span ids that name a page, source_refs with a
    pdf_index, a property pdf_index, or the record's source_refs."""
    pages: set[int] = set()
    for span in node.get("evidence_span_ids") or []:
        page = span_page(span)
        if page is not None:
            pages.add(page)
    for ref in node.get("source_refs") or []:
        if isinstance(ref, dict) and isinstance(ref.get("pdf_index"), int):
            pages.add(int(ref["pdf_index"]))
    props = node.get("properties") or {}
    if isinstance(props.get("pdf_index"), int) and not isinstance(props.get("pdf_index"), bool):
        pages.add(int(props["pdf_index"]))
    for ref in record_of(node).get("source_refs") or []:
        if isinstance(ref, dict) and isinstance(ref.get("pdf_index"), int):
            pages.add(int(ref["pdf_index"]))
    return pages
