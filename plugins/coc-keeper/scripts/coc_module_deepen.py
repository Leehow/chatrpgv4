"""Read one more section while the table is playing, with the build's reader.

The queue already claims a deepening job, writes its host-work request and
parks it at `awaiting_host_pack`. Nothing then read the pages: the existing
coordinator dispatches `--no-tools` single completions, which is the one shape
graph extraction cannot use -- the reader has to open the packet, write a shard
across as many turns as it needs, run the gates on itself and fix what they
say. So every request sat open, and a party walking into an unread section
found a graph that had stopped growing.

This is the missing claimant, and it deliberately reuses the build's pipeline
rather than growing a second one: the same `prepare_from_request`, the same
`extract_section` with its three gates, the same
`put_section_shard_and_fulfill_host_work`. A second reader would drift from the
first, and the drift would show up as a book that reads differently depending
on whether a section was built up front or deepened at the table.

Nothing here raises into the worker's job loop. A failure leaves the host-work
request open, which is exactly the state it was already in -- a host can still
fulfill it. Swallowing the job would be worse than never having tried.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any, Callable

SCRIPT_DIR = Path(__file__).resolve().parent
PI_LIB = SCRIPT_DIR.parent / "pi" / "lib"

DISABLE_ENV = "COC_DISABLE_AGENT_DEEPENING"
MAX_ROUNDS = int(os.environ.get("COC_DEEPEN_MAX_ROUNDS", "3"))
# Names the book has already established. Bounded because it rides inside the
# packet the agent reads, and an unbounded roster on a 669-page book would
# crowd out the pages it is supposed to be reading.
MAX_KNOWN_NODES = int(os.environ.get("COC_DEEPEN_MAX_KNOWN_NODES", "400"))
ROSTER_KINDS = ("npc", "creature", "faction", "organization", "location")


class DeepenError(RuntimeError):
    """Raised only by direct callers; the worker path returns status instead."""


def _load(name: str, path: Path):
    cached = sys.modules.get(name)
    if cached is not None:
        return cached
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    if spec.loader is None:  # pragma: no cover - import machinery
        raise DeepenError(f"cannot load {path}")
    # Registered BEFORE execution: `dataclasses` resolves a field's annotations
    # through `sys.modules[cls.__module__]`, so a module loaded this way blows
    # up on its own `@dataclass` if it cannot find itself.
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(name, None)
        raise
    return module


def enabled() -> bool:
    """Deepening is on unless the environment turns it off.

    On by default because "parse as they play" is the whole point: a switch
    that has to be found and set is a feature nobody has. Off is one env var,
    mirroring `COC_DISABLE_QUEUE_WORKER`, because this spends model calls in the
    background and someone metering a run must be able to stop it.
    """
    return os.environ.get(DISABLE_ENV, "").strip().lower() not in {
        "1", "true", "yes", "on",
    }


def known_nodes(assets: Any, workspace: Path, asset_root_id: str) -> list[dict[str, Any]]:
    """Name-level nodes the book has already established, from kept shards.

    A build passes the skeleton's roster so sections reuse each other's ids. At
    the table there is no skeleton in hand, but the same names are in the shards
    the asset root kept -- so the deepened section joins the book instead of
    minting a second `faction-bloody-tongue` beside the first.
    """
    roster: list[dict[str, Any]] = []
    seen: set[str] = set()
    shard_root = assets.graph_shard_dir(workspace, asset_root_id)
    if not shard_root.is_dir():
        return roster
    for path in sorted(shard_root.glob("*.shard.json")):
        try:
            shard = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for node in shard.get("nodes") or []:
            if not isinstance(node, dict) or node.get("node_kind") not in ROSTER_KINDS:
                continue
            node_id = node.get("node_id")
            name = node.get("name")
            if not isinstance(node_id, str) or not isinstance(name, str):
                continue
            if node_id in seen:
                continue
            seen.add(node_id)
            roster.append({
                "node_id": node_id,
                "node_kind": node["node_kind"],
                "name": name,
                "visibility": node.get("visibility") or "keeper-only",
            })
            if len(roster) >= MAX_KNOWN_NODES:
                return roster
    return roster


def prepare_work_dir(
    workspace: Path,
    asset_root_id: str,
    *,
    job_id: str,
    work_dir: Path,
) -> dict[str, Any]:
    """Turn one open host-work request into a work dir the reader can open."""
    assets = _load("coc_module_assets_deepen", SCRIPT_DIR / "coc_module_assets.py")
    graph = _load("coc_module_graph_deepen", SCRIPT_DIR / "coc_module_graph.py")
    extract = _load("coc_module_graph_extract_deepen", SCRIPT_DIR / "coc_module_graph_extract.py")

    request = assets.get_host_work_request(workspace, asset_root_id, job_id)
    if not isinstance(request, dict):
        return {"status": "unavailable", "reason": "no open host-work request"}
    scope = request.get("requested_source_scope")
    scope = scope if isinstance(scope, dict) else {}
    indices = [int(value) for value in scope.get("pdf_indices") or []]
    if not indices:
        return {"status": "unavailable", "reason": "request names no pages"}

    refs = []
    for pdf_index in indices:
        try:
            ref = assets.cached_page_ref(workspace, asset_root_id, pdf_index)
        except Exception:  # noqa: BLE001 - a missing artifact is a hole, not a crash
            ref = None
        if ref is not None:
            refs.append(ref)
    if not refs:
        # Every page this section needs is either a declared hole in the book or
        # not cached yet. Neither is a failure of the reader, and neither is
        # fixed by running one.
        return {"status": "empty", "reason": "no cached page in the requested range"}

    identity = {}
    identity_path = assets._module_dir(workspace, asset_root_id) / "identity.json"
    if identity_path.is_file():
        try:
            identity = json.loads(identity_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            identity = {}
    language = str(identity.get("source_language") or "zh-Hans")

    catalog = graph.catalog_from_page_refs(refs)
    prepare_request = extract.request_over_pages(
        refs,
        module_id=str(asset_root_id),
        section_id=str(request.get("target_id") or "").strip() or "deepened-section",
        source_language=language,
        max_nodes=120,
        max_relations=200,
        known_nodes=known_nodes(assets, workspace, asset_root_id),
    )
    work_dir.mkdir(parents=True, exist_ok=True)
    (work_dir / "request.json").write_text(
        json.dumps(prepare_request, ensure_ascii=False), encoding="utf-8"
    )
    prepared = graph.prepare_from_request(catalog, prepare_request)
    (work_dir / "extraction-packet.json").write_text(
        json.dumps(prepared["extraction_packet"], ensure_ascii=False), encoding="utf-8"
    )
    (work_dir / "evidence-packet.json").write_text(
        json.dumps(prepared["evidence_packet"], ensure_ascii=False), encoding="utf-8"
    )
    return {
        "status": "prepared",
        "work_dir": str(work_dir),
        "section_id": prepare_request["section_id"],
        "pages": len(refs),
        "spans": len(prepared["evidence_packet"].get("spans") or []),
    }


def deepen_section(
    workspace: Path,
    asset_root_id: str,
    *,
    job_id: str,
    work_dir: Path,
    reader: Callable[[Path, str], None] | None = None,
    max_rounds: int = MAX_ROUNDS,
) -> dict[str, Any]:
    """Read one section and, only if the gates accept it, fulfil the request."""
    prepared = prepare_work_dir(
        workspace, asset_root_id, job_id=job_id, work_dir=work_dir,
    )
    if prepared["status"] != "prepared":
        return prepared

    build = _load("coc_module_build_deepen", SCRIPT_DIR / "coc_module_build.py")
    if reader is None:
        adapter = _load("build_ask_adapter_deepen", PI_LIB / "build_ask_adapter.py")
        reader = adapter.read_with_agent

    result = build.extract_section(Path(work_dir), reader, max_rounds=max_rounds)
    if result.get("status") != "accepted":
        # The request stays open. That is the state it was already in, and a
        # host can still answer it; the alternative -- closing a job nothing
        # read -- would lose the section silently.
        return {
            "status": "not_accepted",
            "work_dir": str(work_dir),
            "attempts": result.get("attempts"),
            "reason": result.get("reason"),
            "rounds": result.get("rounds"),
        }

    assets = _load("coc_module_assets_deepen_put", SCRIPT_DIR / "coc_module_assets.py")
    shard = json.loads(Path(result["shard_path"]).read_text(encoding="utf-8"))
    stored = assets.put_section_shard_and_fulfill_host_work(
        workspace, asset_root_id, host_work_job_id=job_id, shard=shard,
    )
    return {
        "status": "fulfilled",
        "work_dir": str(work_dir),
        "attempts": result.get("attempts"),
        "nodes": result.get("nodes"),
        "relations": result.get("relations"),
        "stored": stored,
    }
