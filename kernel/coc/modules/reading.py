"""One persisted queue for source indexing, opening preparation and focused reading."""
from __future__ import annotations

import copy
import fcntl
import hashlib
import os
import shutil
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from ..errors import RpcError, invalid_params
from ..fileio import canonical_json, read_json, write_json_atomic
from ..module_graph import normalize
from .contract import COVERAGE_DOMAINS, module_node_id, valid_source_language, vocabulary
from .playability import opening_check
from .store import ModuleStore, now_iso
from .visual import assemble_visual, check_draft, check_review, reject

PURPOSES = ("index", "skeleton", "opening", "detail")


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


@contextmanager
def mutex(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def contained(root: Path, value: Any) -> Path:
    if not isinstance(value, str):
        reject("a path must be a string")
    path = Path(value).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        reject("the artifact must exist inside the current reading attempt")
    return path


class Reading:
    def __init__(self, store: ModuleStore):
        self.store = store
        self.leases: dict[tuple[str, str], tuple[list[Any], str, str]] = {}

    def bind(self, params: dict[str, Any]) -> dict[str, Any]:
        source = params.get("source")
        if not isinstance(source, dict) or type(source.get("page_count")) is not int or source["page_count"] < 1:
            raise invalid_params("source needs path, file_sha256 and a positive page_count")
        path = Path(str(source.get("path") or "")).resolve()
        if not path.is_file() or digest(path) != source.get("file_sha256"):
            raise invalid_params("the original PDF bytes do not match source.file_sha256",
                                 fix="inspect the original PDF again with the host page reader")
        title = str(params.get("title") or path.stem)
        with mutex(self.store.root / ".registry.lock"):
            for mid in self.store.module_ids():
                meta = self.store.module(mid)
                if meta.get("file_sha256") != source["file_sha256"]:
                    continue
                with mutex(self.store.module_dir(mid) / ".metadata.lock"):
                    meta = self.store.module(mid)
                    destination = self.store.module_dir(mid) / "source.pdf"
                    corrupted = destination.is_file() and digest(destination) != source["file_sha256"]
                    if not meta.get("source_document") or not destination.is_file() or corrupted:
                        if path != destination.resolve():
                            temporary = destination.with_name(f"source-copy-{uuid.uuid4().hex}.pdf")
                            shutil.copyfile(path, temporary)
                            if digest(temporary) != source["file_sha256"]:
                                raise invalid_params("source changed during restoration")
                            if corrupted:
                                destination.rename(destination.with_name(f"source-corrupt-{uuid.uuid4().hex}.pdf"))
                            os.replace(temporary, destination)
                        if not meta.get("source_document"):
                            graph = self.store.read_graph(mid)
                            queue = self.store.queue_path(mid)
                            if queue.exists():
                                queue.rename(queue.with_name(f"legacy-queue-{uuid.uuid4().hex}.json"))
                            self.store.write_queue(mid, [])
                            meta["reading"] = self.initial_state()
                            if graph:
                                meta["reading"]["materials"] = [{"purpose": "detail", "verification": "legacy",
                                    "node_ids": [n["node_id"] for n in graph.get("nodes", [])],
                                    "generation": meta.get("generation", 0)}]
                        meta.update(reading_version=1, source_document={"path": "source.pdf", **{k: source[k] for k in ("file_sha256", "page_count")}})
                        meta["page_count"] = source["page_count"]
                        self.store.write_module(meta)
                    return {"module_id": mid, "replayed": True}
            wanted = params.get("module_id")
            if wanted:
                mid = self.store.validate_id(wanted)
                if self.store.module_dir(mid).exists():
                    raise invalid_params("this module id belongs to a different source",
                                         fix="omit module_id to register a new module")
            else:
                n = 1
                while self.store.module_dir(f"book-{n}").exists():
                    n += 1
                mid = f"book-{n}"
            directory = self.store.module_dir(mid)
            directory.mkdir(parents=True, exist_ok=False)
            try:
                shutil.copyfile(path, directory / "source.pdf")
                if digest(directory / "source.pdf") != source["file_sha256"]:
                    raise invalid_params("source changed during registration")
                meta = {"id": mid, "title": title, "source": "pdf", "reading_version": 1,
                    "source_document": {"path": "source.pdf", **{k: source[k] for k in ("file_sha256", "page_count")}},
                    "file_sha256": source["file_sha256"], "page_count": source["page_count"],
                    "languages": [params["language"]] if params.get("language") else [],
                    "generation": 0, "status": "registered", "created_at": now_iso(),
                    "opening_ready": False, "reading": self.initial_state()}
                self.store.write_sections(mid, [])
                self.store.write_queue(mid, [])
                self.store.write_module(meta)
                return {"module_id": mid, "replayed": False}
            except Exception:
                # Preserve bytes and the interrupted reservation as evidence, never delete them.
                raise

    @staticmethod
    def initial_state() -> dict[str, Any]:
        return {"state": "indexing", "index_complete": False, "viewed_pages": [], "materials": [], "missing": []}

    def source(self, meta: dict[str, Any]) -> dict[str, Any]:
        source = meta.get("source_document")
        if not isinstance(source, dict):
            raise RpcError("needs", "the original PDF is required for further reading",
                           fix="bind the matching original PDF with module.source.bind",
                           details={"reason": "needs_source"})
        path = self.store.module_dir(meta["id"]) / source["path"]
        if not path.is_file():
            raise RpcError("needs", "the original PDF is unavailable for further reading",
                           fix="bind the matching original PDF with module.source.bind",
                           details={"reason": "needs_source"})
        path = contained(self.store.module_dir(meta["id"]), str(path))
        if digest(path) != source["file_sha256"]:
            raise invalid_params("the registered original PDF was modified", fix="supply the matching original source")
        return {**source, "path": str(path)}

    def material_ready(self, mid: str, name: str) -> bool:
        meta = self.store.module(mid)
        if not meta.get("reading_version"):
            return self.store.graph_path(mid).exists()
        graph = self.store.read_graph(mid) or {}
        matched = {n["node_id"] for n in graph.get("nodes", []) if normalize(name) in
                   {normalize(v) for v in [n["node_id"], n["node_id"].removeprefix(n["node_kind"] + "-"), n.get("name", ""), *n.get("aliases", [])]}}
        return bool(matched) and matched <= {nid for m in meta.get("reading", {}).get("materials", []) for nid in m.get("node_ids", [])}

    def request(self, params: dict[str, Any]) -> dict[str, Any]:
        mid = self.store.validate_id(params.get("module_id"))
        purpose = params.get("purpose")
        if purpose not in PURPOSES:
            raise invalid_params(f"purpose must be one of {list(PURPOSES)}")
        with mutex(self.store.module_dir(mid) / ".metadata.lock"):
            meta = self.store.module(mid)
            reading = meta.setdefault("reading", self.initial_state())
            focus, question = params.get("focus") or "", params.get("question") or ""
            if purpose == "opening" and meta.get("opening_choice"):
                focus = meta["opening_choice"]["start_scene"]
            if not isinstance(focus, str) or not isinstance(question, str):
                raise invalid_params("focus and question must be strings")
            if purpose == "detail" and not focus.strip():
                raise invalid_params("a detail reading needs a named focus",
                                     fix="pass the entity or place as focus, and the unresolved question when known")
            result = {"generation": meta.get("generation", 0), "missing": []}
            if purpose == "skeleton" and self.store.read_graph(mid):
                return {**result, "state": "ready"}
            if purpose == "opening" and meta.get("opening_ready"):
                return {**result, "state": "ready"}
            if purpose == "detail" and not question and self.material_ready(mid, focus):
                return {**result, "state": "ready"}
            if purpose == "index" and reading["index_complete"]:
                return {**result, "state": "ready"}
            source = self.source(meta)
            pages = []
            key = hashlib.sha256(canonical_json([source["file_sha256"], purpose, normalize(focus), question, pages]).encode()).hexdigest()
            for material in reading["materials"] if purpose == "detail" else []:
                if material.get("key") == key:
                    return {**result, "state": "ready"}
            queue = self.store.read_queue(mid)
            existing = next((j for j in reversed(queue) if j.get("key") == key), None)
            if existing:
                if existing["state"] in ("queued", "running"):
                    if params.get("foreground"):
                        existing["foreground"] = True
                        self.store.write_queue(mid, queue)
                    return {**result, "state": "reading" if existing["state"] == "running" else "queued", "job_id": existing["job_id"]}
                if existing["state"] == "completed":
                    return {**result, "state": "blocked", "missing": meta.get("opening", {}).get("missing", []), "opening": meta.get("opening"),
                            "fix": "choose an authored opening, then request preparation again"}
                if not params.get("retry"):
                    return {**result, "state": "blocked", "missing": [existing.get("detail", "reading failed")],
                            "fix": "request the same reading with retry: true"}
            job = {"job_id": f"read-{len(queue) + 1}", "key": key, "purpose": purpose, "focus": focus,
                   "question": question, "pages": pages, "foreground": bool(params.get("foreground")),
                   "state": "queued", "attempts": 0, "at": now_iso()}
            if existing and existing.get("work_dir"):
                job["resume_from"] = existing["work_dir"]
            queue.append(job)
            self.store.write_queue(mid, queue)
            return {**result, "state": "queued", "job_id": job["job_id"]}

    @staticmethod
    def try_lock(path: Path, mode: int):
        handle = path.open("a+")
        try:
            fcntl.flock(handle, mode | fcntl.LOCK_NB)
            return handle
        except BlockingIOError:
            handle.close()
            return None

    def claim(self, params: dict[str, Any]) -> dict[str, Any]:
        mid = self.store.validate_id(params.get("module_id"))
        directory = self.store.module_dir(mid)
        with mutex(directory / ".metadata.lock"):
            meta = self.store.module(mid)
            source = self.source(meta)
            queue = self.store.read_queue(mid)
            active = []
            for stale in queue:
                committed = meta.get("reading", {}).get("completed", {}).get(stale["job_id"])
                if committed:
                    stale.update(state="completed", result=committed)
                    self.release(mid, stale["job_id"])
                if stale.get("state") == "running":
                    if (mid, stale["job_id"]) in self.leases:
                        active.append(stale)
                        continue
                    lock = directory / (f".job-{stale['job_id']}.lock" if stale.get("lock_version") == 2 else ".reader.lock")
                    probe = self.try_lock(lock, fcntl.LOCK_EX)
                    if probe is None:
                        active.append(stale)
                        continue
                    probe.close()
                    stale["state"] = "queued"
                if stale.get("state") == "queued" and (
                    (stale["purpose"] == "index" and meta["reading"]["index_complete"]) or
                    (stale["purpose"] == "opening" and meta.get("opening_ready")) or
                    (stale["purpose"] == "detail" and not stale.get("question") and self.material_ready(mid, stale["focus"]))
                ):
                    stale.update(state="completed", finished_at=now_iso(), reused_generation=meta.get("generation", 0),
                                 result={"state": "ready", "generation": meta.get("generation", 0),
                                         "opening_ready": bool(meta.get("opening_ready"))})
            pending = sorted((j for j in queue if j.get("state") == "queued"),
                             key=lambda j: (not j["foreground"], j["purpose"] != "opening", j["at"]))
            if len(active) >= 2:
                self.store.write_queue(mid, queue)
                return {"job_id": None}
            for job in pending:
                if any(bool(j.get("foreground")) == bool(job.get("foreground"))
                       or (normalize(j.get("focus", "")) == normalize(job.get("focus", ""))) for j in active):
                    continue
                shared = self.try_lock(directory / ".reader.lock", fcntl.LOCK_SH)
                if shared is None:
                    continue
                individual = self.try_lock(directory / f".job-{job['job_id']}.lock", fcntl.LOCK_EX)
                if individual is None:
                    shared.close()
                    continue
                handles = [shared, individual]
                try:
                    if job.get("work_dir"):
                        job["resume_from"] = job["work_dir"]
                    job.update(state="running", owner=str(params.get("owner") or "host"), lease=uuid.uuid4().hex,
                               lock_version=2, attempts=job["attempts"] + 1, base_generation=meta.get("generation", 0))
                    work = directory / "work" / job["job_id"] / f"attempt-{job['attempts']}"
                    while work.exists():
                        job["attempts"] += 1
                        work = directory / "work" / job["job_id"] / f"attempt-{job['attempts']}"
                    work.mkdir(parents=True, exist_ok=False)
                    job["work_dir"] = str(work.resolve())
                    self.store.write_queue(mid, queue)
                    self.leases[mid, job["job_id"]] = (handles, job["job_id"], job["lease"])
                    graph = {} if job["purpose"] == "index" else self.store.read_graph(mid) or {}
                    ready = {nid for material in meta.get("reading", {}).get("materials", []) for nid in material.get("node_ids", [])}
                    known = [{**{k: n[k] for k in ("node_id", "node_kind", "name", "aliases", "summary", "properties", "visibility") if k in n},
                              "source_refs": [{"page": ref["pdf_index"] + 1, **({"box": ref["box"]} if "box" in ref else {})}
                                              for ref in n.get("source_refs", []) if type(ref.get("pdf_index")) is int],
                              "ready": n["node_id"] in ready} for n in graph.get("nodes", [])]
                    if not known:
                        known = [{"node_id": module_node_id(mid), "node_kind": "module", "name": meta["title"], "ready": False}]
                    packet = {**job, "module_id": mid, "source": source,
                              "concurrency": 2,
                              "index": [] if job["purpose"] == "index" else self.store.read_sections(mid),
                              "known_nodes": known, "known_claims": graph.get("claims", []),
                              "vocabulary": vocabulary(), "coverage_domains": list(COVERAGE_DOMAINS)}
                    write_json_atomic(work / "packet.json", packet)
                    return packet
                except Exception:
                    for handle in handles:
                        handle.close()
                    self.leases.pop((mid, job["job_id"]), None)
                    raise
            self.store.write_queue(mid, queue)
            return {"job_id": None}

    def finish(self, params: dict[str, Any]) -> dict[str, Any]:
        mid = self.store.validate_id(params.get("module_id"))
        with mutex(self.store.module_dir(mid) / ".metadata.lock"):
            meta = self.store.module(mid)
            queue = self.store.read_queue(mid)
            job = next((j for j in queue if j.get("job_id") == params.get("job_id")), None)
            if job is None:
                raise invalid_params("unknown reading job")
            committed = meta.get("reading", {}).get("completed", {}).get(job["job_id"])
            if committed:
                job.update(state="completed", result=committed)
                self.store.write_queue(mid, queue)
                if (mid, job["job_id"]) in self.leases:
                    self.release(mid, job["job_id"])
                return {**committed, "replayed": True}
            if job.get("state") == "completed":
                return {**job["result"], "replayed": True}
            lease = self.leases.get((mid, job["job_id"]))
            if not lease or lease[1:] != (job["job_id"], params.get("lease")) or job.get("lease") != params.get("lease"):
                raise invalid_params("this reading attempt no longer owns publication")
            outcome = params.get("outcome")
            if outcome not in ("completed", "failed", "cancelled"):
                raise invalid_params("outcome must be completed, failed or cancelled")
            if outcome != "completed":
                job.update(state=outcome, detail=str(params.get("detail") or outcome), finished_at=now_iso())
                self.store.write_queue(mid, queue)
                self.release(mid, job["job_id"])
                return {"state": outcome}
            work = Path(job["work_dir"])
            packet = read_json(work / "packet.json")
            observations = read_json(contained(work, str(work / "observations.json")))
            if observations.get("file_sha256") != meta["source_document"]["file_sha256"]:
                reject("reader observations do not belong to the registered source")
            seen = set(observations.get("read_pages", []))
            draft = read_json(contained(work, params.get("draft_path")))
            if job["purpose"] == "index":
                self.finish_index(mid, meta, job, draft, set(observations.get("full_pages", [])))
            else:
                filled = check_draft(draft, packet, seen)
                review_path = contained(work, params.get("review_path"))
                review_seen = set(observations.get("review_pages", []))
                check_review(draft, filled, read_json(review_path), meta["page_count"], review_seen)
                graph = assemble_visual(self.store.read_graph(mid), filled, meta)
                assets = params.get("assets") or []
                if not isinstance(assets, list) or any(not isinstance(a, dict) for a in assets):
                    reject("assets must be an array of host-rendered asset records")
                for asset in assets:
                    node = next((n for n in graph["nodes"] if n["node_id"] == asset.get("node_id")), None)
                    path = contained(work, asset.get("path"))
                    if (node is None or node["node_kind"] not in ("handout", "asset") or
                        node.get("visibility") not in ("player-safe", "revealable") or
                        not node.get("properties", {}).get("image_sources") or
                        path.stat().st_size > 20 * 1024 * 1024 or digest(path) != asset.get("sha256") or
                        not path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")):
                        reject("the rendered asset does not match its reviewed source declaration")
                    node["properties"].update(asset_ref=str(path.relative_to(self.store.module_dir(mid).resolve())), media_type="image/png")
                opening = opening_check(graph)
                prepared = {nid for material in meta["reading"]["materials"] for nid in material.get("node_ids", [])}
                prepared.update(filled["ready_nodes"])
                if opening["opening_ready"] and opening.get("start_scene") not in prepared:
                    opening["opening_ready"] = False
                    opening["missing"].append("start_scene_material")
                if job["purpose"] == "opening" and not opening["opening_ready"] and not opening.get("choice"):
                    reject(f"the opening is not playable: {opening.get('missing')} {opening.get('findings')}")
                if job["purpose"] == "skeleton":
                    opening["opening_ready"] = False
                meta["opening"] = opening
                meta["opening_ready"] = bool(opening["opening_ready"])
                meta["reading"]["state"] = "ready" if meta["opening_ready"] else "preparing" if job["purpose"] == "skeleton" else "blocked"
                meta["reading"]["viewed_pages"] = sorted(set(meta["reading"]["viewed_pages"]) | {p - 1 for p in seen})
                meta["reading"]["materials"].append({"key": job["key"], "purpose": job["purpose"],
                    "focus": job["focus"], "question": job["question"], "node_ids": filled["ready_nodes"],
                    "generation": meta.get("generation", 0) + 1})
                meta["status"] = "installed" if meta["opening_ready"] else "assembled"
                self.store.write_graph(meta, graph)
            result = {"state": "ready" if meta.get("opening_ready") else meta["reading"]["state"],
                      "generation": meta.get("generation", 0), "opening_ready": meta.get("opening_ready", False)}
            job.update(state="completed", result=result, finished_at=now_iso())
            meta["reading"].setdefault("completed", {})[job["job_id"]] = result
            self.store.write_module(meta)
            self.store.write_queue(mid, queue)
            self.release(mid, job["job_id"])
            return result

    def finish_index(self, mid: str, meta: dict[str, Any], job: dict[str, Any], draft: Any, seen: set[int]) -> None:
        if not isinstance(draft, dict) or not isinstance(draft.get("sections"), list):
            reject("index draft needs a sections array")
        expected = seen
        if not seen:
            reject(f"index pages were not viewed as full page images: {sorted(expected - seen)}")
        covered = set()
        sections = self.store.read_sections(mid) if meta.get("index_file") else []
        for raw in draft["sections"]:
            row = copy.deepcopy(raw)
            if not isinstance(row, dict) or not isinstance(row.get("name"), str) or not isinstance(row.get("pages"), list) or not row["pages"]:
                reject("index sections need name and physical page ranges")
            ranges = []
            for pair in row["pages"]:
                if not isinstance(pair, list) or len(pair) != 2 or any(type(v) is not int for v in pair) or not 1 <= pair[0] <= pair[1] <= meta["page_count"]:
                    reject("index page ranges must lie in the original PDF")
                pages = set(range(pair[0], pair[1] + 1))
                evidence = {r.get("page") for r in row.get("source_refs", [])}
                if evidence:
                    if not evidence <= seen:
                        reject("navigation references must have been viewed")
                elif not pages <= seen:
                    reject("unseen navigation ranges need an observed source reference")
                covered |= pages
                ranges.append([pair[0] - 1, pair[1] - 1])
            for key in ("topics", "entities"):
                if not isinstance(row.get(key, []), list) or any(not isinstance(v, str) for v in row.get(key, [])):
                    reject(f"index {key} must be a list of names")
            if row.get("state", "indexed") not in ("indexed", "unreadable"):
                reject("index state must be indexed or unreadable")
            row.update(pages=ranges, state=row.get("state", "indexed"))
            sections.append(row)

        if 1 in expected and not valid_source_language(draft.get("language")):
            reject("identify the source language using a BCP 47 tag")
        index_path = Path(job["work_dir"]) / "index.json"
        write_json_atomic(index_path, sorted(sections, key=lambda row: (min(pair[0] for pair in row["pages"]), row["name"])))
        meta["index_file"] = str(index_path.relative_to(self.store.module_dir(mid).resolve()))
        if 1 in expected and isinstance(draft.get("title"), str) and draft["title"].strip():
            meta["title"] = draft["title"].strip()
        if 1 in expected and isinstance(draft.get("language"), str) and draft["language"].strip():
            meta["languages"] = [draft["language"].strip()]
        reading = meta["reading"]
        reading["viewed_pages"] = sorted(set(reading["viewed_pages"]) | {p - 1 for p in seen})
        reading["index_complete"] = True
        reading["state"] = "preparing" if reading["index_complete"] else "indexing"

    def release(self, mid: str, job_id: str | None = None) -> None:
        for key in list(self.leases):
            if key[0] == mid and (job_id is None or key[1] == job_id):
                for handle in self.leases.pop(key)[0]:
                    handle.close()

    def choose_opening(self, params: dict[str, Any]) -> dict[str, Any]:
        from .assemble import apply_opening_choice, resolve_start_scene
        from .playability import start_scene_candidates
        mid = self.store.validate_id(params.get("module_id"))
        with mutex(self.store.module_dir(mid) / ".metadata.lock"):
            meta = self.store.module(mid)
            graph = self.store.read_graph(mid)
            if meta.get("source") != "pdf":
                raise invalid_params("a starter's opening is defined by its content graph")
            if not graph:
                raise RpcError("campaign_not_ready", "read the source before choosing its opening")
            candidates = start_scene_candidates(graph)
            chosen = resolve_start_scene(graph, str(params.get("scene") or ""))
            if chosen is None:
                raise RpcError("needs_choice", "choose one of the authored openings",
                               fix="use a scene from details.candidates", details={"candidates": candidates})
            apply_opening_choice(graph, chosen)
            opening = opening_check(graph)
            meta["opening_choice"] = {"start_scene": chosen, "at": now_iso()}
            meta["opening"] = opening
            meta["opening_ready"] = bool(opening["opening_ready"] and
                                         (not meta.get("reading_version") or self.material_ready(mid, chosen)))
            if meta.get("reading_version"):
                meta["reading"]["state"] = "ready" if meta["opening_ready"] else "preparing"
            if meta["opening_ready"]:
                meta["status"] = "installed"
            self.store.write_graph(meta, graph)
            self.store.write_module(meta)
            return {"module_id": mid, "opening_ready": meta["opening_ready"], "opening": opening,
                    "start_scene": chosen, "generation": meta["generation"]}
