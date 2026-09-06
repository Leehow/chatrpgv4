"""The `module.*` RPC methods (contract §14.1–14.3, 14.6, 14.8).

`methods(table_or_store)` returns the name → handler map `coc.rpc.build_methods`
appends. Every handler takes the params object and returns the result object;
errors are `RpcError`s from the closed enum."""

from __future__ import annotations

import json
import shlex
from pathlib import Path
from typing import Any, Callable

from ..errors import RpcError, invalid_params
from ..fileio import read_json, write_json_atomic
from . import brief as brief_text
from . import deepen as deepen_lane
from . import plan as planner
from .assemble import assemble as assemble_graph
from .assets import registry_from_bundle
from .bundle import copy_into, load_pages, verify
from .contract import REPO_ROOT, module_node_id
from .gates import review as run_gates
from .packet import build as build_packet, span_catalog
from .playability import opening_check
from .store import ModuleStore, now_iso

MAX_READER_ROUNDS = 3


def _str(params: dict[str, Any], key: str, *, required: bool = True) -> str | None:
    value = params.get(key)
    if value is None or value == "":
        if required:
            raise invalid_params(f"params.{key} is required")
        return None
    if not isinstance(value, str):
        raise invalid_params(f"params.{key} must be a string")
    return value


def _int(params: dict[str, Any], key: str, default: int) -> int:
    value = params.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise invalid_params(f"params.{key} must be a positive integer")
    return value


class ModuleMethods:
    def __init__(self, store: ModuleStore, starters_dir: Path | None = None) -> None:
        self.store = store
        self.starters_dir = Path(starters_dir) if starters_dir else None

    # ---- inventory ----------------------------------------------------------------

    def list(self, params: dict[str, Any]) -> dict[str, Any]:
        rows = []
        for module_id in self.store.module_ids():
            meta = self.store.module(module_id)
            rows.append({"module_id": module_id, "title": meta.get("title"), "source": meta.get("source"),
                         "status": meta.get("status"), "generation": meta.get("generation")})
        return {"modules": rows}

    def status(self, params: dict[str, Any]) -> dict[str, Any]:
        module_id = _str(params, "module_id")
        meta = self.store.module(module_id)
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
            "install": meta.get("install"),
        }

    def register(self, params: dict[str, Any]) -> dict[str, Any]:
        module_id = _str(params, "module_id")
        if self.starters_dir is None:
            raise invalid_params("no starters directory is configured for module.register")
        meta = self.store.register_starter(module_id, self.starters_dir)
        return {"module_id": module_id, "status": meta["status"], "generation": meta["generation"],
                "graph_digest": meta.get("graph_digest"), "title": meta.get("title")}

    # ---- §14.2 bind -------------------------------------------------------------------

    def bind(self, params: dict[str, Any]) -> dict[str, Any]:
        bundle_dir = _str(params, "bundle")
        verified = verify(bundle_dir)
        module_id = _str(params, "module_id", required=False) or verified.slug
        module_id = self.store.validate_id(module_id)
        bundle_sha = verified.bundle_sha256()
        if self.store.exists(module_id):
            meta = self.store.module(module_id)
            if meta.get("bundle_sha256") == bundle_sha:
                return {"module_id": module_id, "page_count": meta.get("page_count"),
                        "assets": len(self.store.assets(module_id)), "replayed": True}
            raise invalid_params(f"module {module_id!r} already exists with a different bundle",
                                 fix="pass another module_id, or bind the same bundle",
                                 details={"module_id": module_id, "bundle_sha256": meta.get("bundle_sha256")})
        copy_into(verified, self.store.bundle_dir(module_id))
        meta = {
            "id": module_id,
            "title": verified.title,
            "source": "pdf",
            "languages": [verified.language] if verified.language else [],
            "bundle_sha256": bundle_sha,
            "file_sha256": verified.file_sha256,
            "page_count": verified.page_count,
            "producer": verified.manifest.get("producer"),
            "graph_digest": None,
            "generation": 0,
            "status": "registered",
            "created_at": now_iso(),
        }
        registry = registry_from_bundle(verified.assets)
        registry["bundle_assets"] = list(verified.assets)
        write_json_atomic(self.store.assets_path(module_id), registry)
        self.store.write_module(meta)
        self.store.append_build_log(module_id, {"event": "bind", "pages": verified.page_count,
                                                "assets": len(verified.assets)})
        return {"module_id": module_id, "page_count": verified.page_count, "assets": len(verified.assets)}

    # ---- §14.3 plan ---------------------------------------------------------------------

    def _pdf_module(self, module_id: str) -> dict[str, Any]:
        meta = self.store.module(module_id)
        if meta.get("source") != "pdf":
            raise invalid_params(f"module {module_id!r} is a starter; it has no bundle to plan or read")
        return meta

    def plan(self, params: dict[str, Any]) -> dict[str, Any]:
        module_id = _str(params, "module_id")
        meta = self._pdf_module(module_id)
        budget = _int(params, "budget", planner.DEFAULT_SECTION_BUDGET)
        if any(row.get("status") == "accepted" for row in self.store.read_sections(module_id)):
            raise invalid_params("module already has accepted sections; the plan is fixed",
                                 fix="bind the bundle under another module_id to re-plan")
        pages = load_pages(self.store.bundle_dir(module_id))
        result = planner.candidates(pages, budget=budget)
        heads = planner.page_heads(pages)
        plan = {"module_id": module_id, "budget": budget, "basis": result["basis"],
                "measured": result["measured"], "sections": result["sections"], "pages": heads,
                "planned_at": now_iso()}
        write_json_atomic(self.store.work_dir(module_id) / "plan.json", plan)
        out = {"module_id": module_id, "budget": budget, "basis": result["basis"],
               "measured": result["measured"], "sections": result["sections"], "pages": heads,
               "next": "module.plan.accept {module_id, sections: [{id, kind, priority}]}",
               "kinds": list(planner.SECTION_KINDS)}
        candidates = result["sections"]
        if len(candidates) == 1:
            # One packet holds the whole book: nothing to classify, the book is its own scene section.
            self.plan_accept({"module_id": module_id,
                              "sections": [{"id": candidates[0]["id"], "kind": "scene", "priority": 100}]})
            out.update({"auto": "single-section book", "section_count": 1, "next": "module.packet"})
            return out
        # Several sections: classification is a whole-book judgement for one reader session
        # (§14.3). The packet shows titles, pages and each page's first lines, never the book.
        work = self.store.work_dir(module_id, "_plan")
        work.mkdir(parents=True, exist_ok=True)
        packet = {"contract_id": "coc.module-plan-packet.v1", "module_id": module_id,
                  "module_title": meta.get("title"), "candidates": candidates, "pages": heads,
                  "kinds": list(planner.SECTION_KINDS),
                  "priority_hint": {"opening scene / front / keeper-truth": 100, "scenes in play order": 90,
                                    "npc-roster / handouts": 60, "rules / pregens": 40, "appendix / other": 20}}
        write_json_atomic(work / "packet.json", packet)
        plan_path = work / "plan.json"
        brief = (
            f"# 给《{meta.get('title') or module_id}》的 section 分类\n\n"
            f"工作目录 `{work}`。读 `packet.json`：`candidates[]` 是机器按预算切好的 section（id、pages、title），"
            f"`pages[]` 是每页的首两行。给每个 candidate 定 `kind`（只能取 `kinds` 里的词）与 `priority`（0–100，"
            f"开场场景、前言、守秘人信息最高；见 `priority_hint`）。\n\n"
            f"把结果写到 `{plan_path}`：`{{\"sections\": [{{\"id\": \"section-01\", \"kind\": \"scene\", \"priority\": 100}}, ...]}}`，"
            f"每个 candidate 恰好一行，不增不减。写完即可退出，不要写别的文件。"
        )
        out.update({"work_dir": str(work), "packet": str(work / "packet.json"), "brief": brief,
                    "section_count": len(candidates)})
        return out

    def plan_accept(self, params: dict[str, Any]) -> dict[str, Any]:
        module_id = _str(params, "module_id")
        meta = self._pdf_module(module_id)
        plan_path = self.store.work_dir(module_id) / "plan.json"
        if not plan_path.exists():
            raise invalid_params("no plan to accept", fix="call module.plan first")
        plan = read_json(plan_path)
        classified = params.get("sections")
        if classified is None:
            # The classification reader wrote work/_plan/plan.json (§14.3).
            reader_plan = self.store.work_dir(module_id, "_plan") / "plan.json"
            if not reader_plan.exists():
                raise invalid_params("no classification to accept",
                                     fix="pass sections: [{id, kind, priority}], or let the plan reader write work/_plan/plan.json")
            classified = read_json(reader_plan).get("sections")
        table = planner.accept(plan["sections"], classified)
        existing = {row["id"]: row for row in self.store.read_sections(module_id)}
        for row in table:
            old = existing.get(row["id"])
            if old and old.get("status") in ("accepted", "reading", "failed"):
                row.update({k: old[k] for k in ("status", "shard", "rounds") if k in old})
        self.store.write_sections(module_id, table)
        self.store.advance(meta, "planned")
        self.store.write_module(meta)
        self.store.append_build_log(module_id, {"event": "plan", "sections": len(table)})
        return {"module_id": module_id, "sections": len(table), "status": meta["status"],
                "order": [row["id"] for row in sorted(table, key=lambda r: (-int(r["priority"]), r["pages"][0]))]}

    # ---- §14.3 packet / review / accept ----------------------------------------------

    def _commands(self, module_id: str, section_id: str, work_dir: Path) -> tuple[str, str]:
        evidence = f"{shlex.quote(str(REPO_ROOT / 'bin' / 'coc-evidence'))} --packet {shlex.quote(str(work_dir / 'packet.json'))}"
        review = (f"{shlex.quote(str(REPO_ROOT / 'bin' / 'coc-review'))} --workspace "
                  f"{shlex.quote(str(self.store.workspace))} --module {shlex.quote(module_id)} "
                  f"--section {shlex.quote(section_id)}")
        return evidence, review

    def packet(self, params: dict[str, Any]) -> dict[str, Any]:
        module_id = _str(params, "module_id")
        section_id = _str(params, "section_id")
        meta = self._pdf_module(module_id)
        section = self.store.section(module_id, section_id)
        pages = load_pages(self.store.bundle_dir(module_id))
        work_dir = self.store.work_dir(module_id, section_id)
        language = str((meta.get("languages") or ["und"])[0])
        packet = build_packet(module_id=module_id, title=str(meta.get("title") or module_id),
                              source_language=language, section=section, pages=pages,
                              all_page_indices=[int(p["pdf_index"]) for p in pages],
                              accepted_shards=self.store.accepted_shards(module_id), work_dir=work_dir)
        evidence_cmd, review_cmd = self._commands(module_id, section_id, work_dir)
        text = brief_text.render(module_id=module_id, section_id=section_id,
                                 title=str(meta.get("title") or module_id),
                                 section_title=str(section.get("title") or ""), kind=section.get("kind"),
                                 source_language=language, aspects=list(packet["aspects"]),
                                 work_dir=str(work_dir), page_window=packet["page_window"],
                                 module_node_id=module_node_id(module_id),
                                 evidence_command=evidence_cmd, review_command=review_cmd)
        (work_dir / "BRIEF.md").write_text(text, encoding="utf-8")
        if section.get("status") == "planned":
            self.store.set_section_status(module_id, section_id, "reading")
        self.store.advance(meta, "building")
        self.store.write_module(meta)
        return {"module_id": module_id, "section_id": section_id, "packet": str(work_dir / "packet.json"),
                "work_dir": str(work_dir), "spans": len(packet["spans"]),
                "page_window": packet["page_window"], "known_nodes": len(packet["skeleton"]["known_nodes"]),
                "brief": text, "commands": {"evidence": evidence_cmd, "review": review_cmd},
                "max_rounds": MAX_READER_ROUNDS}

    def _review(self, module_id: str, section_id: str, *, count_round: bool) -> dict[str, Any]:
        self._pdf_module(module_id)
        section = self.store.section(module_id, section_id)
        work_dir = self.store.work_dir(module_id, section_id)
        packet_path = work_dir / "packet.json"
        if not packet_path.exists():
            raise invalid_params(f"no packet for section {section_id!r}", fix="call module.packet first")
        packet = read_json(packet_path)
        shard_path = work_dir / "shard.json"
        if not shard_path.exists():
            result: dict[str, Any] = {"accepted": False, "gates": {"shape": 1, "grounding": 0, "coverage": 0},
                                      "measures": {}, "findings": [{"gate": "shape", "code": "shard_missing",
                                                                    "path": "/", "message": f"no shard.json in {work_dir}"}]}
        else:
            try:
                shard = json.loads(shard_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                result = {"accepted": False, "gates": {"shape": 1, "grounding": 0, "coverage": 0}, "measures": {},
                          "findings": [{"gate": "shape", "code": "shard_not_json", "path": "/",
                                        "message": f"shard.json did not parse: {exc}"}]}
            else:
                result = run_gates(shard, packet, span_catalog(packet))
        rounds = int(section.get("rounds") or 0) + (1 if count_round else 0)
        report = {"module_id": module_id, "section_id": section_id, "accepted": result["accepted"],
                  "gates": result["gates"], "findings": result["findings"], "measures": result["measures"],
                  "machine_filled": result.get("machine_filled", []), "round": rounds, "at": now_iso()}
        write_json_atomic(work_dir / "findings.json", report)
        if "shard" in result:
            write_json_atomic(work_dir / "shard.filled.json", result["shard"])
        if count_round:
            status = str(section.get("status") or "reading")
            self.store.set_section_status(module_id, section_id, "reading" if status == "planned" else status,
                                          rounds=rounds)
            self.store.append_build_log(module_id, {"event": "review", "section_id": section_id, "round": rounds,
                                                    "findings_codes": sorted({f["code"] for f in result["findings"]}),
                                                    "accepted": result["accepted"], "measures": result["measures"]})
        return {**report, "shard": result.get("shard")}

    def review(self, params: dict[str, Any]) -> dict[str, Any]:
        module_id = _str(params, "module_id")
        section_id = _str(params, "section_id")
        report = self._review(module_id, section_id, count_round=True)
        report.pop("shard", None)
        if params.get("final") is True and not report.get("accepted"):
            # The last round the reader gets (§14.5): the section is failed, the build moves on.
            self.store.set_section_status(module_id, section_id, "failed", rounds=report.get("round"))
            report["status"] = "failed"
        return report

    def accept(self, params: dict[str, Any]) -> dict[str, Any]:
        module_id = _str(params, "module_id")
        section_id = _str(params, "section_id")
        report = self._review(module_id, section_id, count_round=False)
        if not report["accepted"]:
            raise RpcError("invalid_params", f"section {section_id!r} does not pass review",
                           fix="fix the findings in work/<section>/shard.json and review again",
                           details={"findings": report["findings"], "gates": report["gates"]})
        shard = report["shard"]
        write_json_atomic(self.store.shard_path(module_id, section_id), shard)
        self.store.set_section_status(module_id, section_id, "accepted",
                                      shard=str(self.store.shard_path(module_id, section_id)),
                                      accepted_at=now_iso())
        self.store.append_build_log(module_id, {"event": "accept", "section_id": section_id,
                                                "nodes": len(shard.get("nodes") or []),
                                                "claims": len(shard.get("claims") or [])})
        return {"module_id": module_id, "section_id": section_id, "nodes": len(shard.get("nodes") or []),
                "claims": len(shard.get("claims") or []), "relations": len(shard.get("relations") or []),
                "shard": str(self.store.shard_path(module_id, section_id))}

    def assemble(self, params: dict[str, Any]) -> dict[str, Any]:
        module_id = _str(params, "module_id")
        return assemble_graph(self.store, module_id)

    def install(self, params: dict[str, Any]) -> dict[str, Any]:
        module_id = _str(params, "module_id")
        meta = self.store.module(module_id)
        force = bool(params.get("force", False))
        status = str(meta.get("status"))
        if status == "installed":
            return {"module_id": module_id, "status": status, "generation": meta.get("generation"),
                    "graph_digest": meta.get("graph_digest"), "replayed": True}
        if status not in ("assembled", "assembled_not_playable"):
            raise RpcError("campaign_not_ready", f"module {module_id!r} is {status}, not assembled",
                           fix="module.assemble first")
        playability = meta.get("playability") or {}
        if status == "assembled_not_playable" and not force:
            raise invalid_params(f"module {module_id!r} failed the playability invariants",
                                 fix="fix the sections and assemble again, or install with force: true",
                                 details={"finding_counts": playability.get("finding_counts"),
                                          "findings": (playability.get("findings") or [])[:40]})
        meta["install"] = {"at": now_iso(), "forced": status == "assembled_not_playable",
                           "generation": meta.get("generation"),
                           "playability_status": playability.get("status"),
                           "finding_counts": playability.get("finding_counts")}
        self.store.advance(meta, "installed")
        self.store.write_module(meta)
        self.store.append_build_log(module_id, {"event": "install", "forced": meta["install"]["forced"]})
        return {"module_id": module_id, "status": meta["status"], "generation": meta.get("generation"),
                "graph_digest": meta.get("graph_digest"), "forced": meta["install"]["forced"],
                "playability": playability.get("status")}

    # ---- §14.6 deepen -----------------------------------------------------------------

    def deepen_claim(self, params: dict[str, Any]) -> dict[str, Any]:
        module_id = _str(params, "module_id")
        self.store.module(module_id)
        claimed = deepen_lane.claim(self.store, module_id, _str(params, "claimed_by", required=False))
        return claimed or {"section_id": None}

    def deepen_complete(self, params: dict[str, Any]) -> dict[str, Any]:
        module_id = _str(params, "module_id")
        section_id = _str(params, "section_id")
        ok = params.get("ok")
        if not isinstance(ok, bool):
            raise invalid_params("params.ok must be a boolean")
        self.store.module(module_id)
        return deepen_lane.complete(self.store, module_id, section_id, ok, params.get("detail"))

    def deepen_enqueue(self, params: dict[str, Any]) -> dict[str, Any]:
        module_id = _str(params, "module_id")
        self.store.module(module_id)
        scene = _str(params, "scene", required=False)
        reason = _str(params, "reason", required=False) or "move"
        if scene:
            return deepen_lane.enqueue_for_scene(self.store, module_id, scene, reason=reason)
        section_ids = params.get("section_ids")
        if not isinstance(section_ids, list) or not all(isinstance(s, str) for s in section_ids):
            raise invalid_params("params.section_ids must be a list of section ids (or pass params.scene)")
        priority = params.get("priority", deepen_lane.PRIORITY_MOVE)
        if isinstance(priority, bool) or not isinstance(priority, int):
            raise invalid_params("params.priority must be an integer")
        queued = deepen_lane.enqueue(self.store, module_id, section_ids, reason, priority)
        return {"queued": queued, "queue": self.store.read_queue(module_id)}

    # ---- §14.8 assets ---------------------------------------------------------------------

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
    return {
        "module.list": api.list,
        "module.status": api.status,
        "module.register": api.register,
        "module.bind": api.bind,
        "module.plan": api.plan,
        "module.plan.accept": api.plan_accept,
        "module.packet": api.packet,
        "module.review": api.review,
        "module.accept": api.accept,
        "module.assemble": api.assemble,
        "module.install": api.install,
        "module.deepen.claim": api.deepen_claim,
        "module.deepen.complete": api.deepen_complete,
        "module.deepen.enqueue": api.deepen_enqueue,
        "module.asset": api.asset,
    }
