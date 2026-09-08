"""The shared setup step table and deterministic campaign/character setup methods."""

from __future__ import annotations

import datetime as _dt
import json
from pathlib import Path
from typing import Any, Iterable

from .chargen import ALLOCATION_POLICIES, Chargen, ChargenError, METHODS, default_investigator_id
from .errors import RpcError, invalid_params, unsupported_value
from .events import append_event
from .fileio import read_json, write_json_atomic
from .text import normalize

STEPS_CONTRACT = "coc.setup-steps.v1"
STEP_KINDS = frozenset({"ask", "op"})
STATUS_SETTING_UP = "setting_up"
STATUS_READY = "ready_for_table"
STATUS_ACTIVE = "active"
STATUSES = (STATUS_SETTING_UP, STATUS_READY, STATUS_ACTIVE)
HANDOFF_RECEIPT = "setup:handoff"
#: §14.6: a section's build status → what the keeper is told about the material there.

def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


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
        """Ids unique, needs known, only_for a declared source, investigator_source a
        declared investigator source (§21.5's second, independent axis -- new vs.
        loaded from the library), kinds closed, op present for op steps, and the
        needs form a DAG."""
        sources = set(self.raw.get("sources") or [])
        investigator_sources = set(self.raw.get("investigator_sources") or [])
        if len(self.by_id) != len(self.steps):
            raise ValueError("setup steps: duplicate step id")
        for step in self.steps:
            if step.get("kind") not in STEP_KINDS:
                raise ValueError(f"setup step {step['id']}: kind must be one of {sorted(STEP_KINDS)}")
            if step["kind"] == "op" and not isinstance(step.get("op"), str):
                raise ValueError(f"setup step {step['id']}: op steps name their kernel method")
            if step.get("only_for") is not None and step["only_for"] not in sources:
                raise ValueError(f"setup step {step['id']}: only_for must be one of {sorted(sources)}")
            if step.get("investigator_source") is not None and step["investigator_source"] not in investigator_sources:
                raise ValueError(f"setup step {step['id']}: investigator_source must be one of "
                                 f"{sorted(investigator_sources)}")
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

    def order(self, source: str | Iterable[str]) -> list[str]:
        """Topological order for one source kind (or set of active kinds, §21.5), steps
        for another kind left out."""
        out: list[str] = []
        for step in self.steps:
            if not self.applies(step["id"], source):
                continue
            if step["id"] not in out:
                out.append(step["id"])
        return out

    def applies(self, step_id: str, source: str | Iterable[str]) -> bool:
        """Apply the module-source and investigator-source axes from the step table."""
        kinds = {source} if isinstance(source, str) else set(source)
        step = self.step(step_id)
        only_for = step.get("only_for")
        if only_for is not None and only_for not in kinds:
            return False
        applies_to = step.get("applies_to")
        if isinstance(applies_to, list) and applies_to and not kinds.intersection(applies_to):
            return False
        investigator_source = step.get("investigator_source")
        if investigator_source is not None and investigator_source not in kinds:
            return False
        return True

    def table_open_fix(self, campaign_id: str) -> str:
        return str(self.raw["table_open_fix"]).format(campaign=campaign_id)

    def launch_line(self, campaign_id: str) -> str:
        return str(self.raw["launch_line"]).format(campaign=campaign_id)

    def next_line(self, step_id: str) -> str:
        """The step's English `next` line (§16.1); the setup model says it in the player's language."""
        lines = self.step(step_id).get("lines") or {}
        return str(lines.get("next") or step_id)


from .modules.store import ModuleStore


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
        from .setup_drafts import SetupDrafts
        self.drafts = SetupDrafts(self)

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
        module = self.table.module_store.module(module_id)
        if module.get("reading_version") and not self.table.reading.opening_ready(module_id, meta.get("opening_scene") or ""):
            return False
        graph = self.table.graph(module_id)
        world, start_handle = self.table.initial_world(graph, meta.get("opening_scene"))
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
        # §20.7: a non-starter module whose graph already existed the moment
        # `campaign.create` ran (kernel/coc/table.py `campaign_create`: `has_graph` true,
        # so `opening_scene` is filled in immediately) was picked already-installed --
        # the `module` source -- rather than genuinely bound and built in this setup (the
        # `pdf` source, whose graph is still being prepared, so `opening_scene`
        # stays unset until then). Nothing else distinguishes the two once both are done,
        # which is also the point at which the distinction stops mattering.
        reused = (not starter) and meta.get("opening_scene") is not None
        kind = "starter" if starter else ("module" if reused else "pdf")
        completed = {"choose-source", "create-campaign"}
        # `applies` is the same only_for/applies_to machinery `order` uses: for
        # `starter`/`module` these two steps are not part of the table at all (not
        # applicable), so they are never inserted as done, matching the pdf-only lane.
        if self.steps.applies("prepare-module", kind) and module and \
                (module.get("status") == "installed" or module.get("opening_ready") is True or
                 meta.get("guidance_key") in module.get("character_guidance", {})):
            completed.add("prepare-module")
        # §21.5's second axis: which investigator source(s) this campaign's setup
        # receipts actually show, derived from campaign state the same way `kind` is --
        # never a stored "chosen lane". `setup.investigator`'s receipt never carries a
        # `source` key; `investigator.load`'s does, and only says "library" (kernel/coc/
        # library.py `load`). A mixed party (one card built, one loaded) reports both.
        receipts = (meta.get("setup") or {}).get("receipts") or []
        investigator_kinds: set[str] = set()
        for receipt in receipts:
            if not isinstance(receipt, dict) or receipt.get("kind") != "investigator":
                continue
            investigator_kinds.add("library" if receipt.get("source") == "library" else "new")
        if "new" in investigator_kinds:
            completed.update({"create-investigator", "confirm-investigator"})
        if (meta.get("setup") or {}).get("draft_revision"):
            completed.add("create-investigator")
        if "library" in investigator_kinds:
            # `browse-library` (investigator.list) changes nothing on its own, so there is
            # no receipt to check it against; a completed load implies it was consulted.
            completed.update({"browse-library", "load-investigator"})
        if meta.get("status") in (STATUS_READY, STATUS_ACTIVE):
            completed.add("complete")
        active_kinds = {kind, *investigator_kinds}
        ordered_completed = [step_id for step_id in self.steps.order(active_kinds) if step_id in completed]
        state: dict[str, Any] = {"campaign": campaign.id, "module_id": module_id, "module": module_id,
                                 "source": {"kind": kind, "module_id": module_id}, "source_kind": kind, "play_language": meta.get("play_language", "zh-Hans")}
        draft = self.drafts.load(campaign, meta)
        if draft:
            state["draft"] = self.drafts.result(draft)
        state["prologue"] = (meta.get("setup") or {}).get("prologue")
        state["guidance_key"] = meta.get("guidance_key")
        state["rulebook_eras"] = list(self.table.tables.load("cash-assets")["periods"])
        state["start_scene"] = meta.get("opening_scene")
        state["waiting_for_opening"] = bool((meta.get("setup") or {}).get("waiting_for_opening"))
        return {**table, "completed": ordered_completed, "state": state}

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
        allocation = params.get("allocation")
        if allocation is not None and not isinstance(allocation, str):
            raise unsupported_value("allocation", allocation, ALLOCATION_POLICIES,
                                    message="params.allocation must be a policy name from the steps table")
        module_id = str(meta["module_id"])
        from .library import module_era as era_of_module  # local: keep this module free of graph imports at load
        module_era = None
        if self.table.module_store.graph_path(module_id).exists() or module_id in self.table.modules():
            # A module node carries `runtime_projection.documents`, never `.record`, so reading
            # the record silently returned None and every card fell back to 1920s, whatever
            # the book declared. One reader for both callers (contract §21.3).
            module_era = era_of_module(self.table.graph(module_id))
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
                                                age=age, sex=sex, method=method, seed=seed, era=era,
                                                allocation=allocation)
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
            "next": self.steps.next_line("complete"),
        }

    def complete(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign = self.table.store.open(params.get("campaign"), require_turn=False, require_world=False)
        meta = campaign.read_campaign()
        if meta.get("status") in (STATUS_READY, STATUS_ACTIVE) and (meta.get("setup") or {}).get("handoff"):
            return {**meta["setup"]["handoff"], "status": meta["status"], "replayed": True}
        if meta.get("status") != STATUS_SETTING_UP:
            raise RpcError("campaign_not_ready", f"campaign {campaign.id!r} is {meta.get('status')!r}",
                           details={"status": meta.get("status")})
        party = campaign.party()
        if not party:
            raise RpcError("needs", "the party is empty; create an investigator first",
                           fix=self.steps.next_line("create-investigator"),
                           details={"needs": {"field": "investigator", "step": "create-investigator"}})
        from .setup_drafts import completeness
        receipts = (meta.get("setup") or {}).get("receipts") or []
        imported = bool(receipts) and all(row.get("source") == "library" for row in receipts if row.get("kind") == "investigator")
        issues = [] if imported else [issue for card in party for issue in completeness(card)]
        if issues:
            raise RpcError("campaign_not_ready", "Complete the actual card before opening play", code_detail="incomplete_investigator", details={"issues": issues})
        if not imported and (not (meta.get("setup") or {}).get("confirmed_revision") or meta["setup"]["confirmed_revision"] != meta["setup"].get("draft_revision")):
            raise RpcError("needs", "Confirm the displayed draft before completing setup", code_detail="preview_required")
        module_id = str(meta["module_id"])
        module = module_meta(self.table.module_store, module_id)
        ready = bool(module and (self.table.reading.opening_ready(module_id, meta.get("opening_scene") or "") if module.get("reading_version")
                                else module.get("status") == "installed" or module.get("opening_ready") is True))
        if not ready:
            meta.setdefault("setup", {})["waiting_for_opening"] = True
            campaign.write_campaign(meta)
            raise RpcError("campaign_not_ready", f"module {module_id!r} is not installed and not opening_ready",
                           fix="The confirmed investigator is retained. End this reply; the host will retry completion when the selected opening is ready. Do not recreate or reconfirm the card.",
                           details={"reason": "opening_preparing", "start_scene": meta.get("opening_scene")})
        generation = self.table.module_store.generation(module_id)
        if self._start_world_if_ready(campaign, meta):
            meta = campaign.read_campaign()
        handoff = {
            "receipt": HANDOFF_RECEIPT,
            "module_id": module_id,
            "module_generation": generation,
            "prologue": (meta.get("setup") or {}).get("prologue"),
            "investigators": [str(s.get("id")) for s in party],
            "at": now_iso(),
            "launch": self.steps.launch_line(campaign.id),
        }
        setup_block = dict(meta.get("setup") or {})
        setup_block["handoff"] = handoff
        setup_block.pop("waiting_for_opening", None)
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
