"""Module inventory and the visual source-reading RPC boundary."""
from __future__ import annotations
from pathlib import Path
from typing import Any, Callable
from ..errors import RpcError, invalid_params
from .playability import opening_check, start_scene_candidates
from .store import ModuleStore
from .reading import Reading


def _str(params: dict[str, Any], key: str, *, required: bool = True) -> str | None:
    value = params.get(key)
    if value is None or value == "":
        if required:
            raise invalid_params(f"params.{key} is required")
        return None
    if not isinstance(value, str):
        raise invalid_params(f"params.{key} must be a string")
    return value


class ModuleMethods:
    def __init__(self, store: ModuleStore, starters_dir: Path | None = None) -> None:
        self.store = store
        self.starters_dir = Path(starters_dir) if starters_dir else None

    def list(self, params: dict[str, Any]) -> dict[str, Any]:
        rows = []
        for module_id in self.store.module_ids():
            meta = self.store.module(module_id)
            rows.append({"module_id": module_id, "title": meta.get("title"), "source": meta.get("source"),
                         "status": meta.get("status"), "generation": meta.get("generation"),
                         "setup_ready": bool(meta.get("character_guidance"))})
        return {"modules": rows}

    def status(self, params: dict[str, Any]) -> dict[str, Any]:
        module_id = _str(params, "module_id")
        meta = self.store.module(module_id)
        if meta.get("reading_version") == 1:
            queue = self.store.read_queue(module_id)
            reading = meta.get("reading", {})
            return {"module_id": module_id, "title": meta.get("title"), "source": "pdf", "status": meta.get("status"),
                    "generation": meta.get("generation", 0), "page_count": meta.get("page_count"),
                    "languages": meta.get("languages", []), "opening_ready": bool(meta.get("opening_ready")),
                    "opening": meta.get("opening", {}), "reading": {**reading,
                        "opening_ready": bool(meta.get("opening_ready")),
                        "queued": sum(j.get("state") == "queued" for j in queue),
                        "active": next((j["job_id"] for j in queue if j.get("state") == "running"), None)},
                    "opening_candidates": start_scene_candidates(self.store.read_graph(module_id) or {})}
        sections = self.store.read_sections(module_id)
        counts: dict[str, int] = {}
        for row in sections:
            counts[str(row.get("status"))] = counts.get(str(row.get("status")), 0) + 1
        opening: dict[str, Any] = {"opening_ready": False, "missing": ["graph"]}
        graph = self.store.read_graph(module_id)
        if graph is not None:
            opening = opening_check(graph)
        playability = meta.get("playability") or {}
        queue = self.store.read_queue(module_id)
        return {
            "module_id": module_id,
            "title": meta.get("title"),
            "source": meta.get("source"),
            "status": meta.get("status"),
            "generation": meta.get("generation"),
            "graph_digest": meta.get("graph_digest"),
            "page_count": meta.get("page_count"),
            "languages": meta.get("languages"),
            "sections": {"total": len(sections), "by_status": counts,
                         "rows": [{"id": r["id"], "kind": r.get("kind"), "priority": r.get("priority"),
                                   "pages": r.get("pages"), "status": r.get("status"), "rounds": r.get("rounds")}
                                  for r in sections]},
            "queue": [{"section_id": q["section_id"], "status": q["status"], "priority": q["priority"],
                       "reason": q["reason"]} for q in queue],
            "playability": {"status": playability.get("status"),
                            "finding_counts": playability.get("finding_counts"),
                            "measures": playability.get("measures")} if playability else None,
            "opening_ready": bool(opening.get("opening_ready")),
            "opening": opening,
            "opening_candidates": start_scene_candidates(graph or {}),
            "install": meta.get("install"),
        }

    def register(self, params: dict[str, Any]) -> dict[str, Any]:
        module_id = _str(params, "module_id")
        if self.starters_dir is None:
            raise invalid_params("no starters directory is configured for module.register")
        meta = self.store.register_starter(module_id, self.starters_dir)
        return {"module_id": module_id, "status": meta["status"], "generation": meta["generation"],
                "graph_digest": meta.get("graph_digest"), "title": meta.get("title")}

    def asset(self, params: dict[str, Any]) -> dict[str, Any]:
        module_id = _str(params, "module_id")
        name = _str(params, "name")
        self.store.module(module_id)
        entry = self.store.asset(module_id, name)
        if entry is None:
            raise RpcError("unknown_entity", f"no asset or handout named {name!r} in module {module_id!r}",
                           fix="pick one of details.candidates",
                           details={"query": name,
                                    "candidates": [{"name": a.get("name"), "kind": a.get("kind"),
                                                    "visibility": a.get("visibility")}
                                                   for a in self.store.assets(module_id)][:12]})
        return {"module_id": module_id, "asset": entry,
                "player_visible": entry.get("visibility") in ("player-safe", "revealable")}


def methods(table_or_store: Any, content_dir: Path | str | None = None) -> dict[str, Callable[[dict[str, Any]], dict[str, Any]]]:
    """The `module.*` map for `coc.rpc.build_methods`. Accepts a `Table` (uses its store
    and content dir), a campaign `Store`, or a `ModuleStore`."""
    if isinstance(table_or_store, ModuleStore):
        store = table_or_store
    elif hasattr(table_or_store, "store") and hasattr(table_or_store.store, "workspace"):
        store = ModuleStore(table_or_store.store.workspace)
        content_dir = content_dir or getattr(table_or_store, "content", None)
    elif hasattr(table_or_store, "workspace"):
        store = ModuleStore(table_or_store.workspace)
    else:
        raise TypeError("methods() needs a Table, a Store, or a ModuleStore")
    starters = Path(content_dir) / "starters" if content_dir else None
    api = ModuleMethods(store, starters)
    reading = Reading(store)
    return {
        "module.source.bind": reading.bind,
        "module.read.request": reading.request,
        "module.read.claim": reading.claim,
        "module.read.finish": reading.finish,
        "module.list": api.list,
        "module.status": api.status,
        "module.register": api.register,
        "module.opening.choose": reading.choose_opening,
        "module.asset": api.asset,
    }
