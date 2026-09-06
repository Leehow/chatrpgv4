"""The on-demand deep-read queue (contract §14.6).

`apply move` and `table.open` enqueue the sections the party stands in and the
ones one exit away; the module extension's background lane claims one at a
time, reads it (§14.5), and completes. A failed section stays in the queue
marked `failed` and is retried once at the next enqueue (the next `table.open`).
Priorities: under the party's feet 100, the opening scene 90, one exit away 80."""

from __future__ import annotations

from typing import Any

from ..errors import invalid_params
from .contract import EXIT_RELATION_KINDS
from .store import ModuleStore, node_pages, now_iso

PRIORITY_MOVE = 100
PRIORITY_OPENING = 90
PRIORITY_ADJACENT = 80
MAX_RETRIES = 1
QUEUE_STATUSES = ("queued", "claimed", "failed", "done")


def enqueue(store: ModuleStore, module_id: str, section_ids: list[str], reason: str,
            priority: int) -> list[str]:
    """Queue every section not yet `accepted`; an entry already queued keeps the higher
    priority, a `failed` entry is retried while it has retries left. Returns the ids
    queued or re-prioritised by this call (the queue itself is `store.read_queue`)."""
    queue = store.read_queue(module_id)
    sections = {row["id"]: row for row in store.read_sections(module_id)}
    by_id = {row["section_id"]: row for row in queue}
    touched: list[str] = []
    for section_id in section_ids:
        row = sections.get(section_id)
        if row is None or row.get("status") in ("accepted", "skipped"):
            continue
        entry = by_id.get(section_id)
        if entry is None:
            entry = {"section_id": section_id, "reason": reason, "priority": int(priority),
                     "status": "queued", "retries": 0, "at": now_iso()}
            queue.append(entry)
            by_id[section_id] = entry
            touched.append(section_id)
            continue
        if entry["status"] == "failed":
            if int(entry.get("retries") or 0) < MAX_RETRIES:
                entry.update({"status": "queued", "reason": reason, "priority": int(priority),
                              "retries": int(entry.get("retries") or 0) + 1, "at": now_iso()})
                touched.append(section_id)
            continue
        if entry["status"] == "done":
            entry.update({"status": "queued", "reason": reason, "priority": int(priority), "at": now_iso()})
            touched.append(section_id)
            continue
        if int(priority) > int(entry.get("priority") or 0):
            entry["priority"] = int(priority)
            entry["reason"] = reason
            touched.append(section_id)
    if touched:
        store.write_queue(module_id, queue)
    return touched


def claim(store: ModuleStore, module_id: str, claimed_by: str | None = None) -> dict[str, Any] | None:
    """Hand out the highest-priority queued section; one claim at a time. None when
    nothing is queued or a claim is already outstanding."""
    queue = store.read_queue(module_id)
    if any(row["status"] == "claimed" for row in queue):
        return None
    queued = [row for row in queue if row["status"] == "queued"]
    if not queued:
        return None
    queued.sort(key=lambda row: (-int(row.get("priority") or 0), row.get("at") or "", row["section_id"]))
    entry = queued[0]
    entry.update({"status": "claimed", "claimed_by": claimed_by or "deepen", "claimed_at": now_iso()})
    store.write_queue(module_id, queue)
    store.set_section_status(module_id, str(entry["section_id"]), "reading")
    return {"section_id": entry["section_id"], "reason": entry["reason"], "priority": entry["priority"]}


def complete(store: ModuleStore, module_id: str, section_id: str, ok: bool,
             detail: Any = None) -> dict[str, Any]:
    queue = store.read_queue(module_id)
    entry = next((row for row in queue if row["section_id"] == section_id), None)
    if entry is None:
        raise invalid_params(f"section {section_id!r} is not in the deepen queue",
                             details={"queued": [row["section_id"] for row in queue]})
    if entry["status"] != "claimed":
        raise invalid_params(f"section {section_id!r} is {entry['status']}, not claimed")
    entry.update({"status": "done" if ok else "failed", "completed_at": now_iso()})
    entry.pop("claimed_by", None)
    if detail is not None:
        entry["detail"] = detail
    if ok:
        queue = [row for row in queue if row is not entry]
    store.write_queue(module_id, queue)
    section = store.section(module_id, section_id)
    if not ok and section.get("status") != "accepted":
        store.set_section_status(module_id, section_id, "failed")
    return dict(entry)


def sections_around(store: ModuleStore, module_id: str, scene_handle: str) -> dict[str, Any]:
    """`{"here": section_id|None, "adjacent": [section_id...]}` for a scene handle: the
    section whose pages hold the scene, and the sections one exit away."""
    here = store.section_for_scene(module_id, scene_handle)
    here_id = here["section_id"] if here else None
    adjacent: list[str] = []
    if not store.graph_path(module_id).exists() or not store.read_sections(module_id):
        return {"here": here_id, "adjacent": adjacent}
    graph = store.graph(module_id)
    scene = graph.scene_by_handle(scene_handle)
    if scene is None:
        return {"here": here_id, "adjacent": adjacent}
    targets: list[dict[str, Any]] = []
    for rel in graph.out_rel.get(scene["node_id"], []):
        if rel["relation_kind"] in EXIT_RELATION_KINDS:
            target = graph.nodes.get(rel["to_node_id"])
            if target is not None:
                targets.append(target)
    for exit_ in graph.scene_exits(scene):
        target = graph.scene_by_handle(exit_["to"])
        if target is not None and target not in targets:
            targets.append(target)
    for target in targets:
        for page in sorted(node_pages(target)):
            row = store.section_for_page(module_id, page)
            if row is not None and row["id"] != here_id and row["id"] not in adjacent:
                adjacent.append(row["id"])
                break
    return {"here": here_id, "adjacent": adjacent}


def enqueue_for_scene(store: ModuleStore, module_id: str, scene_handle: str, *,
                      reason: str = "move") -> dict[str, Any]:
    """What `apply move` (reason `move`) and `table.open` (reason `opening`) call."""
    around = sections_around(store, module_id, scene_handle)
    here_priority = PRIORITY_OPENING if reason == "opening" else PRIORITY_MOVE
    queued: list[str] = []
    if around["here"]:
        queued += enqueue(store, module_id, [around["here"]], reason, here_priority)
    if around["adjacent"]:
        queued += enqueue(store, module_id, around["adjacent"], "adjacent", PRIORITY_ADJACENT)
    return {**around, "queued": queued, "queue": store.read_queue(module_id)}


def material_state(store: ModuleStore, module_id: str, scene_handle: str) -> str:
    """`ready|reading|missing` for the capsule's `where.material` (§14.6)."""
    row = store.section_for_scene(module_id, scene_handle)
    if row is None:
        return "missing"
    status = row.get("status")
    if status == "accepted":
        return "ready"
    if status == "reading":
        return "reading"
    queued = {q["section_id"]: q for q in store.read_queue(module_id)}
    entry = queued.get(row.get("section_id"))
    if entry and entry.get("status") in ("queued", "claimed"):
        return "reading"
    return "missing"
