"""Setup (contract §14.4, §14.7): the seven-step table, the `setup.*` methods and the
seam to the module store.

The table lives in `content/setup/steps.json`; the kernel reads it for the
`table.open` fix line, the chargen policy and `setup.steps`, and the extension reads
the same file for order and rejection lines. The module store (§14.1) is K5a's
`coc.modules` package; until it is importable, `StarterModuleStore` below covers the
starter lane with the same method names so nothing here has to change when it lands."""

from __future__ import annotations

import datetime as _dt
import json
import shutil
from pathlib import Path
from typing import Any

from .chargen import Chargen, ChargenError, METHODS, default_investigator_id
from .errors import RpcError, invalid_params
from .events import append_event
from .fileio import read_json, sha256_file, write_json_atomic
from .rules.graph_digest import compute_graph_content_digest
from .text import normalize

STEPS_CONTRACT = "coc.setup-steps.v1"
STEP_KINDS = frozenset({"ask", "external", "op"})
STATUS_SETTING_UP = "setting_up"
STATUS_READY = "ready_for_table"
STATUS_ACTIVE = "active"
STATUSES = (STATUS_SETTING_UP, STATUS_READY, STATUS_ACTIVE)
HANDOFF_RECEIPT = "setup:handoff"
#: §14.6: a section's build status → what the keeper is told about the material there.
MATERIAL_BY_STATUS = {"accepted": "ready", "planned": "reading", "reading": "reading", "claimed": "reading",
                      "failed": "missing", "skipped": "missing"}


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def material_status(section: dict[str, Any] | None) -> str:
    """`ready` when the module has no sections (a starter) or the section is accepted."""
    if not section:
        return "ready"
    return MATERIAL_BY_STATUS.get(str(section.get("status")), "missing")


# ---- the seven-step table -----------------------------------------------------------

class SetupSteps:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.raw = read_json(self.path)
        if self.raw.get("contract") != STEPS_CONTRACT:
            raise ValueError(f"{self.path} is not a {STEPS_CONTRACT} table")
        self.steps: list[dict[str, Any]] = list(self.raw["steps"])
        self.by_id: dict[str, dict[str, Any]] = {str(s["id"]): s for s in self.steps}
        self.validate()

    def validate(self) -> None:
        """Ids unique, needs known, only_for a declared source, kinds closed, op present
        for op steps, and the needs form a DAG."""
        sources = set(self.raw.get("sources") or [])
        if len(self.by_id) != len(self.steps):
            raise ValueError("setup steps: duplicate step id")
        for step in self.steps:
            if step.get("kind") not in STEP_KINDS:
                raise ValueError(f"setup step {step['id']}: kind must be one of {sorted(STEP_KINDS)}")
            if step["kind"] == "op" and not isinstance(step.get("op"), str):
                raise ValueError(f"setup step {step['id']}: op steps name their kernel method")
            if step.get("only_for") is not None and step["only_for"] not in sources:
                raise ValueError(f"setup step {step['id']}: only_for must be one of {sorted(sources)}")
            for need in step.get("needs") or []:
                if need not in self.by_id:
                    raise ValueError(f"setup step {step['id']} needs unknown step {need!r}")
        visiting: set[str] = set()
        done: set[str] = set()

        def visit(step_id: str) -> None:
            if step_id in done:
                return
            if step_id in visiting:
                raise ValueError(f"setup steps: cycle through {step_id}")
            visiting.add(step_id)
            for need in self.by_id[step_id].get("needs") or []:
                visit(need)
            visiting.discard(step_id)
            done.add(step_id)

        for step_id in self.by_id:
            visit(step_id)
        if self.raw.get("start") not in self.by_id:
            raise ValueError("setup steps: start must name a step")

    def step(self, step_id: str) -> dict[str, Any]:
        return self.by_id[step_id]

    def order(self, source: str) -> list[str]:
        """Topological order for one source kind, steps for the other kind left out."""
        out: list[str] = []
        for step in self.steps:
            if step.get("only_for") not in (None, source):
                continue
            if step["id"] not in out:
                out.append(step["id"])
        return out

    def table_open_fix(self, campaign_id: str) -> str:
        return str(self.raw["table_open_fix"]).format(campaign=campaign_id)

    def launch_line(self, campaign_id: str) -> str:
        return str(self.raw["launch_line"]).format(campaign=campaign_id)

    def next_line(self, step_id: str, language: str) -> str:
        lines = self.step(step_id).get("lines") or {}
        block = lines.get(language) or lines.get("en") or {}
        return str(block.get("next") or step_id)


# ---- module store seam (§14.1, §14.6) ------------------------------------------------

class StarterModuleStore:
    """The starter lane of the module store: register a `content/starters/<id>` graph
    into `<workspace>/.coc/modules/<id>/` and answer the reads the table needs. Same
    method names as `coc.modules.store.ModuleStore`; no sections, no bundle."""

    def __init__(self, workspace_root: Path) -> None:
        self.root = Path(workspace_root) / ".coc" / "modules"

    def module_dir(self, module_id: str) -> Path:
        return self.root / module_id

    def module(self, module_id: str) -> dict[str, Any] | None:
        path = self.module_dir(module_id) / "module.json"
        return read_json(path) if path.exists() else None

    def graph_path(self, module_id: str) -> Path:
        return self.module_dir(module_id) / "module-graph.json"

    def generation(self, module_id: str) -> int:
        meta = self.module(module_id)
        return int(meta.get("generation") or 0) if meta else 0

    def section_for_scene(self, module_id: str, scene_handle: str) -> dict[str, Any] | None:
        return None

    def assets(self, module_id: str) -> list[dict[str, Any]]:
        path = self.module_dir(module_id) / "assets.json"
        return list(read_json(path).get("assets") or []) if path.exists() else []

    def asset(self, module_id: str, name: str) -> dict[str, Any] | None:
        key = normalize(name)
        for row in self.assets(module_id):
            if key in {normalize(str(row.get("id"))), normalize(str(row.get("name")))}:
                return row
        return None

    def register_starter(self, module_id: str, starters_dir: Path) -> dict[str, Any]:
        """Copy the starter's graph in (once; again only when the content graph's digest
        changed, which is a new generation). Status is `installed` from the start."""
        source = Path(starters_dir) / module_id / "module-graph.json"
        if not source.exists():
            raise invalid_params(f"unknown module {module_id!r}", fix="one of kernel.hello content.modules")
        digest = sha256_file(source)
        existing = self.module(module_id)
        if existing and existing.get("graph_digest") == digest:
            return existing
        graph = read_json(source)
        target = self.module_dir(module_id)
        target.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, self.graph_path(module_id))
        manifest_source = source.parent / "module-graph-manifest.json"
        if manifest_source.exists():
            shutil.copyfile(manifest_source, target / "module-graph-manifest.json")
        else:
            write_json_atomic(target / "module-graph-manifest.json", {
                "module_id": graph.get("module_id"), "graph_content_digest": compute_graph_content_digest(graph),
                "file_sha256": digest, "source": "starter", "note": "no committed manifest; digest computed at registration"})
        module_node = next((n for n in graph.get("nodes") or [] if n.get("node_kind") == "module"), {})
        meta = {
            "id": module_id,
            "title": module_node.get("name") or module_id,
            "source": "starter",
            "languages": list(graph.get("source_languages") or []),
            "graph_digest": digest,
            "generation": int((existing or {}).get("generation") or 0) + 1,
            "status": "installed",
            "starter_path": str(source),
            "registered_at": now_iso(),
        }
        write_json_atomic(target / "module.json", meta)
        write_json_atomic(target / "assets.json", {"module_id": module_id, "assets": starter_assets(graph)})
        return meta


def starter_assets(graph: dict[str, Any]) -> list[dict[str, Any]]:
    """`assets.json` rows from the graph's handout and asset nodes: id, kind, name,
    pages, path (the graph's asset_ref / image_ref, bytes not shipped), visibility."""
    rows = []
    for node in graph.get("nodes") or []:
        kind = node.get("node_kind")
        if kind not in ("handout", "asset"):
            continue
        props = node.get("properties") or {}
        record = (props.get("runtime_projection") or {}).get("record") or {}
        pages = sorted({int(ref["pdf_index"]) for ref in node.get("source_refs") or []
                        if isinstance(ref, dict) and isinstance(ref.get("pdf_index"), int)})
        rows.append({
            "id": node["node_id"],
            "kind": kind if kind == "handout" else str(props.get("role") or "illustration"),
            "name": node.get("name"),
            "pages": pages,
            "path": props.get("asset_ref") or props.get("image_ref"),
            "media_type": props.get("media_type"),
            "visibility": node.get("visibility"),
            "authored_text": record.get("authored_text"),
        })
    return rows


class _DeepenShim:
    """`coc.modules.deepen.enqueue` until K5a's package is importable: rows land in
    `deepen-queue.json`, one per section, the higher priority winning a repeat."""

    @staticmethod
    def enqueue(store: Any, module_id: str, section_ids: list[str], reason: str, priority: int) -> list[str]:
        if not section_ids:
            return []
        path = Path(store.module_dir(module_id)) / "deepen-queue.json"
        # The queue is a plain list (the shape K5a's store.read_queue/write_queue use).
        loaded = read_json(path) if path.exists() else []
        rows: list[dict[str, Any]] = list(loaded if isinstance(loaded, list) else loaded.get("queue") or [])
        by_id = {str(r.get("section_id")): r for r in rows}
        queued = []
        for section_id in section_ids:
            row = by_id.get(section_id)
            if row is None:
                row = {"section_id": section_id, "reason": reason, "priority": int(priority), "status": "queued",
                       "at": now_iso()}
                rows.append(row)
                by_id[section_id] = row
            elif int(row.get("priority") or 0) < int(priority):
                row.update({"reason": reason, "priority": int(priority), "at": now_iso()})
            queued.append(section_id)
        write_json_atomic(path, rows)
        return queued


try:  # K5a's package; the shims above are the same names for the starter lane.
    # `register_starter` there imports assets and playability lazily, so the seam is
    # only taken when the whole package is importable.
    from .modules import assets as _assets, playability as _playability  # noqa: F401  # type: ignore[import-not-found]
    from .modules.store import ModuleStore  # type: ignore[import-not-found]
    MODULE_STORE_SOURCE = "coc.modules.store"
except ImportError:  # pragma: no cover - depends on the concurrent worker's tree
    ModuleStore = StarterModuleStore  # type: ignore[misc,assignment]
    MODULE_STORE_SOURCE = "coc.setup.StarterModuleStore"
try:
    from .modules import deepen  # type: ignore[import-not-found]
    DEEPEN_SOURCE = "coc.modules.deepen"
except ImportError:  # pragma: no cover
    deepen = _DeepenShim()  # type: ignore[assignment]
    DEEPEN_SOURCE = "coc.setup._DeepenShim"


def module_meta(store: Any, module_id: str) -> dict[str, Any] | None:
    """`store.module()` as an optional: K5a's store raises for an unknown module, the
    starter shim returns None."""
    try:
        return store.module(module_id)
    except RpcError:
        return None


def module_registered(store: Any, module_id: str) -> bool:
    exists = getattr(store, "exists", None)
    if callable(exists):
        return bool(exists(module_id))
    return module_meta(store, module_id) is not None


# ---- setup.* --------------------------------------------------------------------------

class SetupMethods:
    """`setup.steps`, `setup.occupations`, `setup.investigator`, `setup.complete`. Bound
    to the table for its store, content and rule tables."""

    def __init__(self, table: Any) -> None:
        self.table = table
        self.steps = SetupSteps(Path(table.content) / "setup" / "steps.json")
        self.chargen = Chargen(table.tables, self.steps.step("create-investigator"))

    def _campaign(self, params: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
        campaign = self.table.store.open(params.get("campaign"), require_turn=False, require_world=False)
        meta = campaign.read_campaign()
        if meta.get("status") != STATUS_SETTING_UP:
            raise RpcError("campaign_not_ready", f"campaign {campaign.id!r} is {meta.get('status')!r}, not setting up",
                           fix="setup methods only run while the campaign is setting_up",
                           details={"status": meta.get("status")})
        self._start_world_if_ready(campaign, meta)
        return campaign, meta

    def _start_world_if_ready(self, campaign: Any, meta: dict[str, Any]) -> bool:
        """§14.4: a campaign created for a bound book has no world until the book's graph
        exists. The first setup call that finds the graph starts the world; idempotent."""
        if campaign.world_json.exists() and meta.get("opening_scene"):
            return False
        module_id = str(meta.get("module_id"))
        if not self.table.module_store.graph_path(module_id).exists():
            return False
        graph = self.table.graph(module_id)
        world, start_handle = self.table.initial_world(graph)
        campaign.write_world(world)
        meta["opening_scene"] = start_handle
        meta["module_digest"] = graph.digest
        meta["module_generation"] = self.table.module_store.generation(module_id)
        campaign.write_campaign(meta)
        return True

    def steps_method(self, params: dict[str, Any]) -> dict[str, Any]:
        """The table, plus — when a campaign is named — what it has already completed and
        the values the extension carries between steps, so `bin/pi-coc setup --campaign
        <id>` resumes a half-finished setup (§14.4)."""
        table = json.loads(json.dumps(self.steps.raw))
        campaign_id = params.get("campaign")
        if not isinstance(campaign_id, str) or not campaign_id:
            return table
        try:
            campaign = self.table.store.open(campaign_id, require_turn=False, require_world=False)
        except RpcError as exc:
            if exc.code == "campaign_not_found":
                return {**table, "completed": [], "state": {"campaign": campaign_id}}
            raise
        meta = campaign.read_campaign()
        module_id = str(meta.get("module_id") or "")
        module = module_meta(self.table.module_store, module_id) if module_id else None
        starter = module_id in self.table.modules()
        kind = "starter" if starter else "pdf"
        completed = ["choose-source", "create-campaign"]
        state: dict[str, Any] = {"campaign": campaign.id, "module_id": module_id, "module": module_id,
                                 "source": {"kind": kind, "module_id": module_id}, "source_kind": kind}
        if not starter and module:
            completed[1:1] = ["build-bundle", "bind-source"]
            if module.get("status") == "installed" or module.get("opening_ready") is True:
                completed.append("build-opening")
        if campaign.party():
            completed.append("create-investigator")
        if meta.get("status") in (STATUS_READY, STATUS_ACTIVE):
            completed.append("complete")
        return {**table, "completed": completed, "state": state}

    def occupations(self, params: dict[str, Any]) -> dict[str, Any]:
        return {"occupations": self.chargen.occupations(),
                "source": "content/rulesets/coc7/rules-json/occupations.json"}

    def investigator(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, meta = self._campaign(params)
        name = params.get("name")
        if not isinstance(name, str) or not name.strip():
            raise invalid_params("params.name must be a non-empty string")
        policy = self.steps.step("create-investigator")
        defaults = policy.get("defaults") or {}
        method = params.get("method", defaults.get("method"))
        age = params.get("age", defaults.get("age"))
        concept = params.get("concept")
        if concept is not None and not isinstance(concept, str):
            raise invalid_params("params.concept must be a string")
        sex = params.get("sex")
        if sex is not None and not isinstance(sex, str):
            raise invalid_params("params.sex must be a string")
        seed = params.get("seed")
        if seed is None:
            seed = str(self.table.rng.getrandbits(32))
        elif isinstance(seed, bool) or not isinstance(seed, (int, str)):
            raise invalid_params("params.seed must be an integer or string")
        seed = str(seed)
        module_id = str(meta["module_id"])
        from .module_graph import record_of  # local: keep this module free of graph imports at load
        module_era = None
        if self.table.module_store.graph_path(module_id).exists() or module_id in self.table.modules():
            module_era = record_of(self.table.graph(module_id).module_node).get("era")
        # A bound book whose graph has not landed yet has no era to read: the rulebook default.
        era = params.get("era") or module_era or "1920s"
        if not isinstance(era, str):
            raise invalid_params("params.era must be a string")
        party = campaign.party()
        investigator_id = params.get("id") or default_investigator_id(name, len(party) + 1)
        if not isinstance(investigator_id, str) or not investigator_id.strip():
            raise invalid_params("params.id must be a slug")
        if any(str(s.get("id")) == investigator_id for s in party):
            raise invalid_params(f"investigator {investigator_id!r} already exists in this campaign",
                                 fix="give another id, or another name")
        try:
            sheet, receipt = self.chargen.build(investigator_id=investigator_id, name=name,
                                                occupation_id=params.get("occupation"), concept=concept,
                                                age=age, sex=sex, method=method, seed=seed, era=era)
        except ChargenError as exc:
            if exc.stage == "occupation":
                raise RpcError("needs", str(exc), fix="call setup.occupations and pass one of its ids",
                               details={"needs": {"field": "occupation", "options": (exc.expected or {}).get("options")}})
            raise invalid_params(str(exc), details={"stage": exc.stage, "expected": exc.expected})
        sheet["current_hp"] = sheet["derived"]["HP"]
        sheet["current_san"] = sheet["derived"]["SAN"]
        sheet["current_mp"] = sheet["derived"]["MP"]
        sheet["current_luck"] = sheet["characteristics"]["LUCK"]
        campaign.party_dir.mkdir(parents=True, exist_ok=True)
        campaign.write_sheet(sheet)
        setup_block = dict(meta.get("setup") or {})
        receipts = list(setup_block.get("receipts") or [])
        receipts.append({**receipt, "at": now_iso()})
        setup_block["receipts"] = receipts
        meta["setup"] = setup_block
        meta["investigators"] = [str(s.get("id")) for s in campaign.party()]
        campaign.write_campaign(meta)
        return {
            "receipt": receipt["id"],
            "investigator": self.table.investigator_row(sheet),
            "sheet": sheet,
            "choices_pending": receipt["choices_pending"],
            "next": self.steps.next_line("complete", str(meta.get("play_language") or "zh-Hans")),
        }

    def complete(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign = self.table.store.open(params.get("campaign"), require_turn=False, require_world=False)
        meta = campaign.read_campaign()
        language = str(meta.get("play_language") or "zh-Hans")
        if meta.get("status") in (STATUS_READY, STATUS_ACTIVE) and (meta.get("setup") or {}).get("handoff"):
            return {**meta["setup"]["handoff"], "status": meta["status"], "replayed": True}
        if meta.get("status") != STATUS_SETTING_UP:
            raise RpcError("campaign_not_ready", f"campaign {campaign.id!r} is {meta.get('status')!r}",
                           details={"status": meta.get("status")})
        party = campaign.party()
        if not party:
            raise RpcError("needs", "the party is empty; create an investigator first",
                           fix=self.steps.next_line("create-investigator", language),
                           details={"needs": {"field": "investigator", "step": "create-investigator"}})
        module_id = str(meta["module_id"])
        module = module_meta(self.table.module_store, module_id)
        if not module or not (module.get("status") == "installed" or module.get("opening_ready") is True):
            raise RpcError("campaign_not_ready", f"module {module_id!r} is not installed and not opening_ready",
                           fix="finish build-opening (module.build until opening_ready) first",
                           details={"module": module})
        generation = self.table.module_store.generation(module_id)
        if self._start_world_if_ready(campaign, meta):
            meta = campaign.read_campaign()
        handoff = {
            "receipt": HANDOFF_RECEIPT,
            "module_id": module_id,
            "module_generation": generation,
            "investigators": [str(s.get("id")) for s in party],
            "at": now_iso(),
            "launch": self.steps.launch_line(campaign.id),
        }
        setup_block = dict(meta.get("setup") or {})
        setup_block["handoff"] = handoff
        meta["setup"] = setup_block
        meta["module_generation"] = generation
        meta["status"] = STATUS_READY
        campaign.write_campaign(meta)
        append_event(campaign, 0, "setup-completed",
                     {"module_id": module_id, "module_generation": generation, "investigators": handoff["investigators"]},
                     receipt=HANDOFF_RECEIPT)
        from . import history
        try:
            history.commit(campaign.repo_dir, campaign.dir, f"campaign {campaign.id}: setup handoff")
        except history.CommitFailed as exc:
            raise RpcError("commit_failed", f"could not commit the setup handoff: {exc}")
        return {**handoff, "status": STATUS_READY}
