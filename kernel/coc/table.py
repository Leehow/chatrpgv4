"""The table.* methods and the turn state machine (contract §4-§5)."""

from __future__ import annotations

import json

import copy
import random
import shutil
from pathlib import Path
from typing import Any, Callable

from . import KERNEL_VERSION, continuation, history, memory, recall as recall_roads, warn as warn_lane
from .capsule import (scene_label, build_capsule, clues_here, investigator_view, npc_view, npcs_present,
                      present_section, where_section)
from .craft import DEFAULT_REGISTER, TextGraph
from .director import DirectorGraph, director_adoption
from .errors import RpcError, invalid_params, not_implemented
from .events import append_event
from .facts import committed_facts, keeper_only_facts, language_of
from .fileio import file_size, read_json, truncate_file
from .module_graph import ModuleGraph, record_of
from .ontology import Ontology, ontology_not_ready
from .render import (has_self_written_mechanics, mechanics_block, place, render_choice)
from .resolve import ResolvePipeline
from .rules import RuleTables
from .rules.graph import REGISTERED_CONDITION_PATHS, semantic_name
from .rules.percentile import roll_expression
from .rules.runtime import RulesEngine, SettleContext
from .sessions import SessionView
from .setup import (ModuleStore, STATUS_ACTIVE, STATUS_READY, STATUS_SETTING_UP, SetupMethods, deepen,
                    material_status, module_registered)
from .store import Campaign, Store, fresh_turn, now_iso, parse_call_id
from .text import normalize, slugify

INTENTS = frozenset({"investigate", "social", "move", "combat", "flee", "cast", "idle", "meta",
                     "stuck", "ambiguous", "montage"})
NONE_INTENTS = frozenset({"idle", "meta", "stuck", "ambiguous"})
APPLY_KINDS = frozenset({"move", "clue", "time", "damage", "handout"})
APPLY_RESERVED = frozenset({"item", "cash", "npc", "flag", "note", "ruling"})
#: §14.8: what may be handed to the player as a card.
HANDOUT_VISIBILITIES = frozenset({"player-safe", "revealable"})
HANDOUT_KINDS = ("handout", "asset")
#: §14.6: deepen-queue priorities — the scene underfoot, one step away, the opening.
DEEPEN_PRIORITY = {"move": 100, "adjacent": 80, "opening": 90}
LOOK_FOCUS = frozenset({"scene", "npc", "investigator", "clues", "time"})
LOOKUP_KINDS = frozenset({"module", "secret", "rule", "catalog"})
RECALL_KINDS = frozenset({"transcript", "memory", "history"})
WRITABLE_STATES = frozenset({"open", "acting"})
PLAYER_INPUT_STATES = frozenset({"awaiting_player", "asked"})
DEFAULT_LANGUAGE = "zh-Hans"
#: the languages the kernel has sentence templates for (facts.py, steps.json lines)
SUPPORTED_LANGUAGES = ("zh-Hans", "en")
#: Fact namespaces that describe the table's state (a wound, a clock, a pending bout or
#: settlement). Content availability (`magic.*`) and call facts (`intent.*`, `receipt.*`)
#: never make a situation.
SITUATION_FACT_PREFIXES = ("actor.", "time.", "sanity.", "chase.", "development.", "clock.", "subsystem.")
COMMIT_SUBJECT_CHARS = 60


def _str(params: dict[str, Any], key: str, *, required: bool = True, default: str | None = None) -> str | None:
    value = params.get(key, default)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip():
        raise invalid_params(f"params.{key} must be a non-empty string")
    return value


def _turn_state_error(turn: dict[str, Any], method: str, allowed: str) -> RpcError:
    return RpcError("turn_state", f"{method} is not allowed while the turn is {turn['state']!r}",
                    fix=allowed, details={"turn": turn["turn"], "state": turn["state"]})


class Table:
    def __init__(self, store: Store, content_dir: Path, rng: random.Random) -> None:
        self.store = store
        self.content = Path(content_dir)
        self.rng = rng
        self.tables = RuleTables(self.content / "rulesets" / "coc7" / "rules-json")
        self.engine = RulesEngine(self.content, self.tables)
        #: §14.1: graphs are read from the module store once a module is registered;
        #: the cache is keyed by generation so a deepened graph is picked up.
        self.module_store = ModuleStore(self.store.workspace)
        self.setup = SetupMethods(self)
        self._graphs: dict[str, tuple[int, ModuleGraph]] = {}
        #: §12.2: the resume block `table.open` produced, carried into the first
        #: `player_input` capsule of this process and then dropped.
        self._resume_pending: dict[str, dict[str, Any]] = {}
        #: §13.6: the turn whose capsules carry every craft directive — the first turn this
        #: process opened with `player_input` for the campaign (a restart starts over).
        self._style_first_turn: dict[str, int] = {}
        #: §13.3, §13.4, §13.6: the content graphs, loaded once and failing closed.
        self._director: DirectorGraph | None = None
        self._craft: TextGraph | None = None
        self._ontology: Ontology | None = None
        self._ontology_checked = False

    # ---- content ----------------------------------------------------------

    def rulesets(self) -> list[str]:
        root = self.content / "rulesets"
        return sorted(p.name for p in root.iterdir() if p.is_dir()) if root.exists() else []

    def modules(self) -> list[str]:
        root = self.content / "starters"
        if not root.exists():
            return []
        return sorted(p.name for p in root.iterdir() if (p / "module-graph.json").exists())

    def graph(self, module_id: str) -> ModuleGraph:
        """The module's current graph: the store's generation when the module is
        registered there (§14.1), else the content starter (before registration)."""
        generation = self.module_store.generation(module_id) if module_registered(self.module_store, module_id) else 0
        cached = self._graphs.get(module_id)
        if cached is not None and cached[0] == generation:
            return cached[1]
        path = self.module_store.graph_path(module_id) if generation else self.content / "starters" / module_id / "module-graph.json"
        if not path.exists():
            raise invalid_params(f"unknown module {module_id!r}", fix=f"one of {self.modules()}")
        graph = ModuleGraph(module_id, path)
        self._graphs[module_id] = (generation, graph)
        return graph

    def initial_world(self, graph: ModuleGraph) -> tuple[dict[str, Any], str]:
        """§3 world.json at the start scene; also what setup.complete writes for a book
        whose graph arrived after the campaign was created (§14.4)."""
        start = graph.start_scene()
        start_handle = graph.handle(start)
        presence: dict[str, str] = {}
        for scene in graph.scenes():
            for npc_id in graph.scene_npc_ids(scene):
                presence.setdefault(graph.handle(graph.nodes[npc_id]), graph.handle(scene))
        world = {
            "active_scene": start_handle,
            "visited_scenes": [start_handle],
            "scene_trail": [],
            "scene_labels": {},
            "discovered_clues": [],
            "flags": {},
            "clock": {"minutes": 0},
            "npc_presence": presence,
        }
        return world, start_handle

    def material_of(self, module_id: str) -> Callable[[str], str]:
        """§14.6: scene handle → ready | reading | missing from the store's section index."""
        return lambda handle: material_status(self.module_store.section_for_scene(module_id, handle))

    def _enqueue_deepen(self, graph: ModuleGraph, scene: dict[str, Any], reason: str) -> list[str]:
        """§14.6: the scene's section and its route-to neighbours' sections that are not
        yet accepted go on the deepen queue. A starter has no sections; nothing is queued."""
        module_id = graph.module_id
        wanted: list[tuple[str, str, int]] = [(graph.handle(scene), reason, DEEPEN_PRIORITY[reason])]
        wanted.extend((exit_["to"], "adjacent", DEEPEN_PRIORITY["adjacent"]) for exit_ in graph.scene_exits(scene))
        # Routes into scenes the graph has no node for: their section is unread.
        wanted.extend((missing, "adjacent", DEEPEN_PRIORITY["adjacent"]) for missing in graph.scene_dangling_exits(scene))
        queued: list[str] = []
        here = self.module_store.section_for_scene(module_id, graph.handle(scene))
        for handle, why, priority in wanted:
            section = self.module_store.section_for_scene(module_id, handle)
            if section is None and why == "adjacent":
                # The neighbour has no node yet: its section is unread. The spine rule
                # (old read-ahead): the first unaccepted section after the one we stand in,
                # in print order.
                section = self._next_unread_section(module_id, here)
            if not section or section.get("status") == "accepted":
                continue
            section_id = str(section.get("section_id"))
            if section_id in queued:
                continue
            queued.extend(deepen.enqueue(self.module_store, module_id, [section_id], why, priority))
        return queued

    def _next_unread_section(self, module_id: str, here: dict[str, Any] | None) -> dict[str, Any] | None:
        rows = self.module_store.read_sections(module_id) if hasattr(self.module_store, "read_sections") else []
        rows = sorted((r for r in rows if isinstance(r, dict)), key=lambda r: (r.get("pages") or [0])[0])
        start = 0
        if here and here.get("section_id"):
            ids = [r.get("id") for r in rows]
            if here["section_id"] in ids:
                start = ids.index(here["section_id"]) + 1
        for row in rows[start:]:
            if row.get("status") != "accepted":
                return {"section_id": row.get("id"), "status": row.get("status")}
        return None

    @property
    def director(self) -> DirectorGraph:
        if self._director is None:
            self._director = DirectorGraph(self.content / "director")
        return self._director

    @property
    def craft(self) -> TextGraph:
        if self._craft is None:
            self._craft = TextGraph(self.content / "craft", self.director.beats)
        return self._craft

    @property
    def ontology(self) -> Ontology:
        if self._ontology is None:
            self._ontology = Ontology(self.content / "ontology" / "system-ontology.json")
        return self._ontology

    def _module_node_ids(self, module_id: str) -> list[str] | None:
        try:
            return list(self.graph(module_id).nodes)
        except RpcError:
            return None

    def validate_ontology(self) -> None:
        """§13.4: every registry reference must resolve in its graph, once per process.
        `kernel.hello` never calls this; `table.open` does, and fails with `campaign_not_ready`."""
        if self._ontology_checked:
            return
        bad = self.ontology.validate(
            rule_node_ids=[n["node_id"] for n in self.engine.graph.get("nodes") or [] if isinstance(n, dict)],
            director_node_ids=list(self.director.nodes), text_node_ids=list(self.craft.nodes),
            registered_paths=REGISTERED_CONDITION_PATHS, capabilities=list(self.engine.resolver_index()),
            module_node_ids=self._module_node_ids)
        if bad:
            raise ontology_not_ready(bad)
        self._ontology_checked = True

    def _load(self, params: dict[str, Any], *, require_turn: bool = True,
              statuses: frozenset[str] = frozenset({STATUS_ACTIVE})) -> tuple[Campaign, dict[str, Any], ModuleGraph, dict[str, Any]]:
        campaign = self.store.open(params.get("campaign"), require_turn=require_turn)
        meta = campaign.read_campaign()
        status = str(meta.get("status"))
        if status not in statuses:
            # §14.4: a campaign still setting up is sent back to the setup process.
            fix = self.setup.steps.table_open_fix(campaign.id) if status == STATUS_SETTING_UP else None
            raise RpcError("campaign_not_ready", f"campaign {campaign.id!r} is {status!r}", fix=fix,
                           details={"status": status})
        graph = self.graph(str(meta["module_id"]))
        world = campaign.read_world()
        if "scene_trail" not in world:
            # Worlds written before the trail existed rebuild it from the event log, once.
            world["scene_trail"] = self._replay_trail(campaign)
            campaign.write_world(world)
        return campaign, meta, graph, world

    def _context(self, params: dict[str, Any]) -> tuple[Campaign, ModuleGraph, dict[str, Any], dict[str, Any]]:
        campaign, _, graph, world = self._load(params)
        return campaign, graph, world, campaign.read_turn()

    def _snapshot(self, campaign: Campaign, graph: ModuleGraph, world: dict[str, Any],
                  party: list[dict[str, Any]]) -> dict[str, Any]:
        """The `world` block a closed turn record carries: where the table stood when the
        turn closed. history's timeline and diff, the checkpoint and the job packet all
        read this instead of the mutable world.json (§12.2–12.4)."""
        scene = graph.scene(world["active_scene"])
        view = SessionView(campaign.dir, graph, party, world)
        session = view.active_session()
        return {
            "scene": {"name": graph.handle(scene), "display_name": scene_label(graph, world, scene)},
            "clock": {"minutes": int((world.get("clock") or {}).get("minutes") or 0)},
            "present": [graph.display_name(n) for n in npcs_present(graph, world, scene)],
            "investigators": [{"id": s.get("id"), "name": s.get("name"), "hp": s.get("current_hp"),
                               "san": s.get("current_san"), "mp": s.get("current_mp"), "luck": s.get("current_luck")}
                              for s in party],
            "session": ({"kind": session.get("kind"), "status": session.get("status"), "round": session.get("round")}
                        if session else None),
            "pending_choice": view.pending_choice(),
        }

    # ---- kernel / campaign --------------------------------------------------

    def hello(self, params: dict[str, Any]) -> dict[str, Any]:
        return {"kernel_version": KERNEL_VERSION,
                "content": {"rulesets": self.rulesets(), "modules": self.modules()}}

    def campaign_list(self, params: dict[str, Any]) -> dict[str, Any]:
        rows = []
        for campaign_id in self.store.campaign_ids():
            campaign = Campaign(self.store, campaign_id)
            meta = campaign.read_campaign()
            turn = campaign.read_turn() if campaign.turn_json.exists() else {"turn": 0}
            rows.append({"id": meta.get("id", campaign_id), "title": meta.get("title"),
                         "module_id": meta.get("module_id"), "status": meta.get("status"),
                         "turn": turn.get("turn", 0)})
        return {"campaigns": rows}

    def campaign_create(self, params: dict[str, Any]) -> dict[str, Any]:
        """§5 / §14.4: with `pregen` the party is complete and the campaign is `active`
        as before; without it the campaign is `setting_up` with an empty party until
        `setup.investigator` and `setup.complete`. A starter is registered into the
        module store either way (§14.1) and the campaign records its digest and
        generation."""
        campaign_id = self.store.validate_new_id(params.get("id"))
        module_id = _str(params, "module")
        pregen_id = _str(params, "pregen", required=False)
        language = _str(params, "play_language", required=False) or DEFAULT_LANGUAGE
        if language not in SUPPORTED_LANGUAGES:
            raise invalid_params(f"unsupported play_language {language!r}", fix=f"one of {list(SUPPORTED_LANGUAGES)}")
        register = _str(params, "register", required=False) or DEFAULT_REGISTER
        if register not in self.craft.registers:
            raise invalid_params(f"unknown register {register!r}", fix=f"one of {self.craft.registers}")
        starter = module_id in self.modules()
        if not starter and not module_registered(self.module_store, module_id):
            raise invalid_params(f"unknown module {module_id!r}",
                                 fix=f"one of {self.modules()}, or a module bound with module.bind")
        if starter:
            module_meta = self.module_store.register_starter(module_id, self.content / "starters")
        else:
            # §14.4: a bound book may not have a graph yet (create-campaign precedes
            # build-opening); the world waits for setup.complete.
            module_meta = self.module_store.module(module_id) or {}
            if pregen_id is not None:
                raise invalid_params("pregens exist only for starters", fix="create the investigator with setup.investigator")
        has_graph = starter or self.module_store.graph_path(module_id).exists()
        graph = self.graph(module_id) if has_graph else None
        title = _str(params, "title", required=False) or (graph.title() if graph else str(module_meta.get("title") or module_id))

        sheet = None
        if pregen_id is not None:
            pregen_path = self.content / "starters" / module_id / "pregens" / pregen_id / "character.json"
            if not pregen_path.exists():
                pregens_dir = self.content / "starters" / module_id / "pregens"
                available = sorted(p.name for p in pregens_dir.iterdir()) if pregens_dir.exists() else []
                raise invalid_params(f"unknown pregen {pregen_id!r}", fix=f"one of {available}")
            sheet = read_json(pregen_path)
            derived = sheet.get("derived") or {}
            characteristics = sheet.get("characteristics") or {}
            sheet["id"] = sheet.get("id") or pregen_id
            sheet["current_hp"] = derived.get("HP")
            sheet["current_san"] = derived.get("SAN")
            sheet["current_mp"] = derived.get("MP")
            sheet["current_luck"] = characteristics.get("LUCK")

        world, start_handle = (self.initial_world(graph) if graph else (None, None))
        meta = {
            "id": campaign_id,
            "title": title,
            "module_id": module_id,
            "module_digest": graph.digest if graph else None,
            "module_generation": int(module_meta.get("generation") or self.module_store.generation(module_id)),
            "play_language": language,
            "register": register,
            "status": STATUS_ACTIVE if sheet is not None else STATUS_SETTING_UP,
            "created_at": now_iso(),
            "opening_scene": start_handle,
            "investigators": [sheet["id"]] if sheet is not None else [],
        }

        campaign = Campaign(self.store, campaign_id)
        campaign.dir.mkdir(parents=True, exist_ok=False)
        try:
            campaign.party_dir.mkdir()
            campaign.turns_dir.mkdir()
            if sheet is not None:
                campaign.write_sheet(sheet)
            if world is not None:
                campaign.write_world(world)
            campaign.write_campaign(meta)
            campaign.write_turn(fresh_turn(0))
            history.init_repo(campaign.repo_dir, campaign.dir)
            history.commit(campaign.repo_dir, campaign.dir, f"campaign {campaign_id}: created")
        except history.CommitFailed as exc:
            shutil.rmtree(campaign.dir, ignore_errors=True)
            shutil.rmtree(campaign.repo_dir, ignore_errors=True)
            raise RpcError("commit_failed", f"could not initialize the campaign repository: {exc}")
        return {"campaign": meta}

    # ---- reads --------------------------------------------------------------

    @staticmethod
    def investigator_row(sheet: dict[str, Any]) -> dict[str, Any]:
        return {"id": sheet.get("id"), "name": sheet.get("name"),
                "occupation": sheet.get("occupation"), "hp": sheet.get("current_hp"),
                "san": sheet.get("current_san"), "mp": sheet.get("current_mp"),
                "luck": sheet.get("current_luck")}

    def _investigators(self, campaign: Campaign) -> list[dict[str, Any]]:
        return [self.investigator_row(sheet) for sheet in campaign.party()]

    def _actor(self, campaign: Campaign, name: Any) -> dict[str, Any]:
        party = campaign.party()
        if name is None:
            if len(party) == 1:
                return party[0]
            raise RpcError("needs_choice", "several investigators at the table; name the actor",
                           details={"candidates": [s.get("name") for s in party]})
        if not isinstance(name, str):
            raise invalid_params("actor must be a string")
        key = normalize(name)
        for sheet in party:
            if key in {normalize(str(sheet.get("id"))), normalize(str(sheet.get("name")))}:
                return sheet
        raise RpcError("unknown_entity", f"no investigator {name!r} at the table",
                       details={"query": name,
                                "candidates": [{"name": s.get("name"), "kind": "investigator",
                                                "display_name": s.get("id")} for s in party]})

    def _touch_acting(self, campaign: Campaign, turn: dict[str, Any]) -> None:
        if turn["state"] == "open":
            turn["state"] = "acting"
            campaign.write_turn(turn)

    def open(self, params: dict[str, Any]) -> dict[str, Any]:
        # §14.4: only ready_for_table or active opens; the first open of a ready campaign
        # makes it active (the setup handoff is consumed here).
        campaign = self.store.open(params.get("campaign"), require_turn=False)
        legacy_module = str(campaign.read_campaign().get("module_id") or "")
        if legacy_module in self.modules() and not module_registered(self.module_store, legacy_module):
            # A campaign created before the module store existed: register its starter now
            # (§14.1: the first reference copies the graph in).
            self.module_store.register_starter(legacy_module, self.content / "starters")
        campaign, meta, graph, world = self._load(params, require_turn=False,
                                                  statuses=frozenset({STATUS_READY, STATUS_ACTIVE}))
        self.validate_ontology()
        if meta.get("status") == STATUS_READY:
            meta["status"] = STATUS_ACTIVE
            meta["activated_at"] = now_iso()
            campaign.write_campaign(meta)
        party = campaign.party()
        # §14.6: the opening scene's section (and its neighbours') go on the deepen queue.
        self._enqueue_deepen(graph, graph.scene(world["active_scene"]), "opening")
        # §12.2: the checkpoint follows HEAD; a lost turn.json is rebuilt from it.
        checkpoint, rebuilt = continuation.sync_checkpoint(campaign, language_of(meta),
                                                           self._snapshot(campaign, graph, world, party))
        turn = continuation.readable_turn(campaign)
        if turn is None:
            turn = continuation.rebuild_turn(campaign, checkpoint)
            if turn is None:
                raise RpcError("campaign_not_ready", f"campaign {campaign.id!r} has no turn.json and no checkpoint to rebuild it from")
            rebuilt = True
        scene = graph.scene(world["active_scene"])
        pending_turn = None
        if turn["state"] in WRITABLE_STATES:
            # The dead process minted call ids before it died; the next one must not reuse them.
            ordinals = [int(key.rsplit("-c", 1)[1]) for key in (turn.get("calls") or {})
                        if "-c" in key and key.rsplit("-c", 1)[1].isdigit()]
            pending_turn = {"player_text": turn.get("player_text"), "receipts": turn.get("receipts", []),
                            "owed": ["narrate"], "since": turn.get("opened_at"),
                            "last_call_ordinal": max(ordinals, default=0)}
        opening_needed = turn["turn"] == 0 and turn["state"] == "awaiting_player"
        resume = None if opening_needed else continuation.resume_view(checkpoint, rebuilt)
        if resume is not None:
            self._resume_pending[campaign.id] = resume
        else:
            self._resume_pending.pop(campaign.id, None)
        return {
            "campaign": meta,
            "turn": {"number": turn["turn"], "state": turn["state"]},
            "investigators": self._investigators(campaign),
            "scene": {"name": graph.handle(scene), "display_name": scene_label(graph, world, scene)},
            "pending_turn": pending_turn,
            "opening_needed": opening_needed,
            "resume": resume,
        }

    def status(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, _, _, turn = self._context(params)
        return {"turn": turn["turn"], "state": turn["state"], "receipts": turn.get("receipts", []),
                "pending_choice": turn.get("pending_choice")}

    def _capsule(self, campaign: Campaign, graph: ModuleGraph, world: dict[str, Any], turn: dict[str, Any], *,
                 resume: dict[str, Any] | None = None, consume_style: bool = False) -> dict[str, Any]:
        meta = campaign.read_campaign()
        first = self._style_first_turn.get(campaign.id)
        style_full = first is None or first == int(turn["turn"])
        if consume_style and first is None:
            self._style_first_turn[campaign.id] = int(turn["turn"])
        return build_capsule(graph, campaign, world, turn, campaign.party(), language=language_of(meta),
                             situations=self._situations(campaign, graph, world, turn), director_graph=self.director,
                             ontology=self.ontology, craft=self.craft,
                             register=str(meta.get("register") or DEFAULT_REGISTER), style_full=style_full, resume=resume,
                             material_of=self.material_of(graph.module_id))

    def capsule(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, graph, world, turn = self._context(params)
        return self._capsule(campaign, graph, world, turn)

    def look(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, graph, world, turn = self._context(params)
        focus = params.get("focus") or "scene"
        if focus not in LOOK_FOCUS:
            raise invalid_params(f"unknown focus {focus!r}", fix=f"one of {sorted(LOOK_FOCUS)}")
        name = params.get("name")
        self._touch_acting(campaign, turn)
        scene = graph.scene(world["active_scene"])
        if focus == "scene":
            return self._scene_view(campaign, graph, world, turn, scene)
        if focus == "npc":
            if name is None:
                return {"present": present_section(graph, world, scene)}
            node = graph.npc(_str({"name": name}, "name"))
            return npc_view(graph, world, node)
        if focus == "investigator":
            return investigator_view(self._actor(campaign, name))
        if focus == "clues":
            return {"discovered_clues": list(world.get("discovered_clues") or []),
                    "clues_here": clues_here(graph, world, scene)}
        return {"clock": world.get("clock") or {"minutes": 0}}

    def lookup(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, graph, world, turn = self._context(params)
        kind = params.get("kind")
        if kind not in LOOKUP_KINDS:
            raise invalid_params(f"unknown lookup kind {kind!r}", fix=f"one of {sorted(LOOKUP_KINDS)}")
        self._touch_acting(campaign, turn)
        if kind == "module":
            query = _str(params, "query")
            return {"query": query, "entities": [graph.entity_view(n) for n in graph.search(query)]}
        if kind == "rule":
            query = _str(params, "query")
            return {"query": query, "rules": self._lookup_rules(query)}
        if kind == "catalog":
            query = _str(params, "query")
            kinds = params.get("kinds")
            if kinds is not None and not (isinstance(kinds, list) and all(isinstance(k, str) for k in kinds)):
                raise invalid_params("params.kinds must be a list of catalog kinds")
            limit = params.get("limit")
            found = self.engine.catalog.search(query, kinds=kinds, limit=limit,
                                               module_spells=SettleContext.module_spells_for(graph))
            if not found.get("ok"):
                error = found.get("error") or {}
                raise invalid_params(str(error.get("detail") or error.get("code") or "bad catalog query"),
                                     details=error)
            return {"query": query, "kinds": found["kinds"], "candidates": found["candidates"],
                    "truncated": found["truncated"],
                    "unresolved_family_parameters": found["unresolved_family_parameters"]}
        scope = params.get("scope") or "scene"
        if scope not in ("scene", "module"):
            raise invalid_params("scope must be 'scene' or 'module'")
        secrets = [{"name": graph.handle(n), "summary": graph.summary(n)}
                   for n in graph.by_kind.get("secret", [])]
        if scope == "module":
            conclusions = []
            for node in graph.by_kind.get("conclusion", []):
                record = record_of(node)
                conclusions.append({"name": graph.handle(node), "summary": graph.summary(node),
                                    "importance": record.get("importance"),
                                    "minimum_routes": record.get("minimum_routes")})
            return {"scope": "module", "module_secrets": secrets, "conclusions": conclusions}
        scene = graph.scene(world["active_scene"])
        where = where_section(graph, world, scene)
        npc_secrets = []
        for node in npcs_present(graph, world, scene):
            record = record_of(node)
            npc_secrets.append({"name": graph.display_name(node), "secret": record.get("secret"),
                                "agenda": record.get("agenda")})
        return {
            "scope": "scene",
            "scene": {"name": where["scene"], "display_name": where["display_name"],
                      "dramatic_question": where["dramatic_question"],
                      "pressure_moves": where["pressure_moves"], "keeper_notes": where["keeper_notes"]},
            "undiscovered_clues": [c for c in clues_here(graph, world, scene) if not c["discovered"]],
            "npc_secrets": npc_secrets,
            "module_secrets": secrets,
        }

    def _lookup_rules(self, query: str, limit: int = 8) -> list[dict[str, Any]]:
        """RuleGraph `rule` nodes whose name or family matches the query; decisions that
        invoke a matching family ride along as `decisions` so the keeper sees the route."""
        key = normalize(query)
        tokens = [t for t in key.split() if t]
        if not tokens:
            return []
        rows: list[tuple[int, dict[str, Any]]] = []
        for node in self.engine.rule_nodes():
            family = str((node.get("properties") or {}).get("family_id") or "")
            haystack = normalize(f"{node.get('name') or ''} {node['node_id']} {family}")
            hits = sum(1 for t in tokens if t in haystack)
            if hits == 0:
                continue
            exact = key in haystack
            rows.append((-(hits + (10 if exact else 0)), {
                "name": node["node_id"], "family": family, "summary": node.get("name"),
                "evidence_span_ids": list(node.get("evidence_span_ids") or []),
                "authority": node.get("authority"), "visibility": node.get("visibility"),
            }))
        rows.sort(key=lambda item: (item[0], item[1]["name"]))
        return [row for _, row in rows[:limit]]

    def _scene_view(self, campaign: Campaign, graph: ModuleGraph, world: dict[str, Any], turn: dict[str, Any],
                    scene: dict[str, Any]) -> dict[str, Any]:
        """`look focus=scene`: the capsule's where/present sections plus the state-driven
        situations and, while one is live, the 11.9 `session` shape."""
        where = where_section(graph, world, scene, self.material_of(graph.module_id))
        where["situations"] = self._situations(campaign, graph, world, turn)
        where["session"] = SessionView(campaign.dir, graph, campaign.party(), world).active_session()
        return {"where": where, "present": present_section(graph, world, scene)}

    def _situations(self, campaign: Campaign, graph: ModuleGraph, world: dict[str, Any],
                    turn: dict[str, Any]) -> list[dict[str, Any]]:
        """Rule decisions the state alone makes available (no intent): a dying clock, a
        wound within the hour, a pending settlement. A decision counts when a hard gate
        holds because of something true about the state, not merely because nothing
        forbids it."""
        party = campaign.party()
        if not party:
            return []
        situations: list[dict[str, Any]] = []
        for sheet in party:
            ctx = SettleContext(self.engine, campaign, graph, world, turn, f"t{turn['turn']}-c0", 0, self.rng,
                                sheet, sheet, {})
            runtime = self.engine.runtime(ctx, intent=None)
            facts = runtime.facts_for_decision(None)
            for node in runtime.decision_nodes():
                ref = str(node["node_id"])
                applicable, hard_gated = runtime.applicability(ref, facts)
                if not applicable or not hard_gated:
                    continue
                because = [hit for hit in runtime.positive_gate_hits(ref, facts)
                           if str(hit["path"]).startswith(SITUATION_FACT_PREFIXES)]
                if not because:
                    continue
                situations.append({
                    "decision": semantic_name(ref), "family": runtime.family_of(ref), "label": node.get("name"),
                    "investigator": sheet.get("id"),
                    "because": [f"{hit['path']} = {hit['actual']!r}" for hit in because],
                })
        return situations

    def recall(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, graph, world, turn = self._context(params)
        what = params.get("what")
        if what not in RECALL_KINDS:
            raise invalid_params(f"unknown recall kind {what!r}", fix=f"one of {sorted(RECALL_KINDS)}")
        self._touch_acting(campaign, turn)
        current = int(turn["turn"])
        if what == "transcript":
            return recall_roads.transcript(campaign, current, params)
        if what == "history":
            return recall_roads.history(campaign, current, params)
        return self._recall_memory(campaign, graph, world, params)

    def _recall_memory(self, campaign: Campaign, graph: ModuleGraph, world: dict[str, Any],
                       params: dict[str, Any]) -> dict[str, Any]:
        party = campaign.party()
        index = memory.EntityIndex(graph, party, scene_labels=world.get("scene_labels"))
        about = params.get("about")
        narrow = about is not None
        if about is None:
            scene = graph.scene(world["active_scene"])
            about = [graph.display_name(n) for n in npcs_present(graph, world, scene)]
            about.extend(str(s.get("name")) for s in party)
        elif not isinstance(about, list) or not all(isinstance(a, str) and a.strip() for a in about):
            raise invalid_params("about must be a list of names")
        else:
            resolved: list[str] = []
            for name in about:
                # Exact name first; else one whole word of a name ('Knott' → Steven Knott),
                # people before places and clues. Ambiguity is an error that lists the names.
                found = index.matches(name) or index.loose_matches(name)
                if len(found) != 1:
                    names = [index.canonical_name(k) for k in found] if found else graph.candidates(name, memory.ENTITY_KINDS)
                    raise RpcError("unknown_entity",
                                   f"{name!r} is {'ambiguous' if found else 'not a known name'}",
                                   fix=f"use one of {names}" if names else
                                   "use an investigator, NPC, scene or clue name, or world/party/keeper/player",
                                   details={"query": name, "candidates": names})
                resolved.append(index.canonical_name(found[0]))
            about = resolved
        turns = params.get("turns")
        if turns is not None:
            turns = recall_roads.parse_span(turns, 0, 0)
        kinds = params.get("kinds")
        if kinds is not None:
            if not isinstance(kinds, list) or not all(k in memory.CANDIDATE_KINDS for k in kinds):
                raise invalid_params("kinds must be a list of candidate kinds", fix=f"one of {list(memory.CANDIDATE_KINDS)}")
        include_superseded = bool(params.get("include_superseded", False))
        limit = params.get("limit", memory.RECALL_DEFAULT_LIMIT)
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= memory.RECALL_MAX_LIMIT:
            raise invalid_params(f"limit must be 1–{memory.RECALL_MAX_LIMIT}")
        hits = memory.query_candidates(campaign, index, about=about, narrow=narrow, turns=turns, kinds=kinds,
                                       include_superseded=include_superseded, limit=limit)
        return {"what": "memory", "about": about, "hits": hits}

    # ---- player input -------------------------------------------------------

    def player_input(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, graph, world, turn = self._context(params)
        text = _str(params, "text")
        if turn["state"] not in PLAYER_INPUT_STATES:
            raise _turn_state_error(turn, "table.player_input",
                                    "finish the current turn with narrate or ask first")
        pending = None
        if turn["state"] == "asked":
            number = int(turn["turn"]) + 1
            pending = turn.get("pending_choice")
        elif int(turn["turn"]) == 0:
            # Opening skipped: turn 0 closes implicitly with no receipts.
            campaign.write_turn_record({
                "turn": 0, "player_text": None, "receipts": [], "text": None, "rendered_text": None,
                "calls": turn.get("calls", {}), "commit": None, "closed_by": "implicit",
                "opened_at": turn.get("opened_at"), "closed_at": now_iso(), "pending_choice": None,
                "world": self._snapshot(campaign, graph, world, campaign.party()),
            })
            number = 1
        else:
            number = int(turn["turn"])
        new_turn = fresh_turn(number, "open", pending)
        new_turn["player_text"] = text
        campaign.write_turn(new_turn)
        campaign.append_transcript(number, "player", text)
        append_event(campaign, number, "turn-started",
                     {"pending_choice": pending["name"] if pending else None})
        append_event(campaign, number, "player-declared", {"text": text})
        resume = self._resume_pending.pop(campaign.id, None)
        capsule = self._capsule(campaign, graph, world, new_turn, resume=resume, consume_style=True)
        # What the keeper was told this turn is evidence (spec §13): it rides in turn.json
        # and lands in the closed record with the receipts.
        new_turn["capsule"] = capsule
        campaign.write_turn(new_turn)
        return {"turn": number, "state": "open", "capsule": capsule}

    # ---- resolve ------------------------------------------------------------

    def _begin_write(self, campaign: Campaign, turn: dict[str, Any], method: str,
                     params: dict[str, Any], *, allow_opening: bool = False) -> tuple[str, dict[str, Any] | None]:
        """Shared preamble of resolve/apply/ask/narrate: a repeated call_id replays (or
        conflicts) before any state check, so a retry after a crash gets its stored result."""
        call_id = params.get("call_id")
        parse_call_id(call_id)
        call_id = str(call_id)
        replay = campaign.replay_or_conflict(turn, call_id, params)
        if replay is not None:
            return call_id, replay
        opening = allow_opening and int(turn["turn"]) == 0 and turn["state"] == "awaiting_player"
        if turn["state"] not in WRITABLE_STATES and not opening:
            raise _turn_state_error(turn, method, "wait for player_input to open a turn")
        return call_id, None

    def _bind_choice(self, turn: dict[str, Any], action: dict[str, Any], call_id: str) -> dict[str, Any] | None:
        choice = action.get("choice")
        if choice is None:
            return None
        if not isinstance(choice, dict) or not isinstance(choice.get("pending"), str):
            raise invalid_params("action.choice must be {pending, option}")
        pending = turn.get("pending_choice")
        # The ask's own name, or the session pending it binds (a player defense).
        if not pending or choice["pending"] not in (pending.get("name"), pending.get("binds")):
            raise invalid_params(f"no pending choice named {choice['pending']!r}",
                                 details={"pending_choice": pending})
        receipt = {"id": f"choice:{pending['name']}-t{turn['turn']}", "kind": "choice",
                   "call_id": call_id, "pending": pending["name"], "option": choice.get("option"),
                   "at": now_iso()}
        turn["pending_choice"] = None
        return receipt

    def resolve(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, graph, world, turn = self._context(params)
        call_id, replay = self._begin_write(campaign, turn, "table.resolve", params)
        if replay is not None:
            return replay
        action = params.get("action")
        if not isinstance(action, dict):
            raise invalid_params("params.action must be an object")
        intent = action.get("intent")
        if intent not in INTENTS:
            raise invalid_params(f"unknown intent {intent!r}", fix=f"one of {sorted(INTENTS)}")
        turn_number = int(turn["turn"])
        _, ordinal = parse_call_id(call_id)
        modifiers = self._modifiers(action.get("modifiers"))

        choice_receipt = self._bind_choice(turn, action, call_id)
        new_receipts = [choice_receipt] if choice_receipt else []
        # §13.3: the Director's `intent` signal reads the previous turn's declared intents.
        turn.setdefault("intents", []).append(intent)

        def session_state(settled: dict[str, Any] | None = None) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
            """11.9: the live session and its pending choice are echoed on every resolve; a
            session family's own settlement reports the transition it just made."""
            view = SessionView(campaign.dir, graph, campaign.party(), campaign.read_world())
            session = (settled or {}).get("session") or view.active_session()
            pending = (settled or {}).get("pending_choice") or view.pending_choice() or turn.get("pending_choice")
            return session, pending

        if intent in NONE_INTENTS:
            session, pending = session_state()
            result = {"outcome": {"kind": "none"},
                      "note": f"intent {intent}: nothing to roll; answer or clarify in the narration",
                      "session": session, "pending_choice": pending,
                      "continuations": [], "rule_refs": []}
            self._commit_resolve(campaign, turn, call_id, params, result, new_receipts, [])
            return result

        pipeline = ResolvePipeline(self.engine, campaign, graph, world, turn, call_id, ordinal, action, self.rng,
                                   self._actor, modifiers)
        settled = pipeline.run()
        if settled.get("kind") == "none":
            session, pending = session_state()
            result = {"outcome": {"kind": "none"}, "note": settled["note"], "session": session,
                      "pending_choice": pending, "continuations": [], "rule_refs": []}
            self._commit_resolve(campaign, turn, call_id, params, result, new_receipts, [])
            return result

        receipts = list(settled["receipts"])
        roll_ids = [r["id"] for r in receipts if r["kind"] == "roll"]
        session, pending = session_state(settled)
        result: dict[str, Any] = {
            "receipt": roll_ids[0] if roll_ids else (receipts[0]["id"] if receipts else None),
            "receipts": [r["id"] for r in receipts],
            "decision": settled["decision"],
            "family": settled["family"],
            "outcome": settled["outcome"],
            "effects": settled["effects"],
            "session": session,
            "pending_choice": pending,
            "continuations": settled["continuations"],
            "rule_refs": settled["rule_refs"],
        }
        if settled.get("decision_source"):
            result["decision_source"] = settled["decision_source"]
        if settled.get("hints"):
            result["hints"] = settled["hints"]
        if settled.get("warnings"):
            result["warnings"] = settled["warnings"]
        events: list[tuple[str, dict[str, Any], str | None]] = []
        goal = action.get("goal") if isinstance(action.get("goal"), str) else ""
        method = action.get("method") if isinstance(action.get("method"), str) else ""
        for receipt in receipts:
            if receipt["kind"] == "roll":
                data = {k: v for k, v in receipt.items() if k not in ("check", "id", "kind", "call_id", "at")}
                events.append(("roll-resolved", {**data, "goal": goal, "method": method}, receipt["id"]))
            elif receipt["kind"] == "delta":
                events.append(("resource-changed", {"resource": receipt["resource"], "subject": receipt["subject"],
                                                    "before": receipt["before"], "after": receipt["after"]}, receipt["id"]))
            elif receipt["kind"] == "session":
                data = {"family": receipt.get("family"), "transition": receipt.get("transition")}
                if receipt.get("outcome") is not None:
                    data["outcome"] = receipt["outcome"]
                if receipt.get("summary") is not None:
                    data["summary"] = receipt["summary"]
                events.append(("session-changed", data, receipt["id"]))
        events.append(("decision-settled", {"decision": settled["decision"], "family": settled["family"],
                                            "outcome_kind": settled["outcome"].get("kind"),
                                            "effect_kinds": settled["effect_kinds"],
                                            "effects": [e["kind"] for e in settled["effects"]],
                                            "continuations": [c["decision"] for c in settled["continuations"]],
                                            # 11.9: telemetry stays flat
                                            "session_kind": (session or {}).get("kind"),
                                            "session_status": (session or {}).get("status"),
                                            "pending_choice": (pending or {}).get("name")}, None))
        self._commit_resolve(campaign, turn, call_id, params, result, new_receipts + receipts, events)
        return result

    def _commit_resolve(self, campaign: Campaign, turn: dict[str, Any], call_id: str,
                        params: dict[str, Any], result: dict[str, Any],
                        receipts: list[dict[str, Any]], events: list[tuple[str, dict[str, Any], str | None]]) -> None:
        turn["receipts"].extend(receipts)
        turn["state"] = "acting"
        Campaign.remember_call(turn, call_id, params, result)
        campaign.write_turn(turn)
        for event_type, data, receipt_id in events:
            append_event(campaign, int(turn["turn"]), event_type, data, call_id=call_id, receipt=receipt_id)

    def _modifiers(self, modifiers: Any) -> tuple[int, int, str]:
        if modifiers is None:
            return 0, 0, "regular"
        if not isinstance(modifiers, dict):
            raise invalid_params("action.modifiers must be an object")
        bonus = modifiers.get("bonus_dice", 0)
        penalty = modifiers.get("penalty_dice", 0)
        difficulty = modifiers.get("difficulty", "regular")
        for label, value in (("bonus_dice", bonus), ("penalty_dice", penalty)):
            if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 2:
                raise invalid_params(f"modifiers.{label} must be 0, 1 or 2")
        if difficulty not in self.tables.difficulties():
            raise invalid_params(f"unknown difficulty {difficulty!r}",
                                 fix=f"one of {self.tables.difficulties()}")
        return bonus, penalty, difficulty

    # ---- apply --------------------------------------------------------------

    def apply(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, graph, world, turn = self._context(params)
        call_id, replay = self._begin_write(campaign, turn, "table.apply", params)
        if replay is not None:
            return replay
        effects = params.get("effects")
        if not isinstance(effects, list) or not effects:
            raise invalid_params("params.effects must be a non-empty list")
        turn_number = int(turn["turn"])
        _, ordinal = parse_call_id(call_id)

        staged = copy.deepcopy(world)
        receipts: list[dict[str, Any]] = []
        events: list[tuple[str, dict[str, Any], str]] = []
        receipt_ids: list[str] = []
        already: list[str] = []
        attachments: list[dict[str, Any] | None] = []
        time_effects = 0
        for index, effect in enumerate(effects):
            try:
                if not isinstance(effect, dict) or not isinstance(effect.get("kind"), str):
                    raise invalid_params("each effect needs a string kind")
                kind = effect["kind"]
                if kind in APPLY_RESERVED:
                    raise not_implemented(f"effect kind {kind!r} is reserved for a later slice")
                if kind not in APPLY_KINDS:
                    raise invalid_params(f"unknown effect kind {kind!r}", fix=f"one of {sorted(APPLY_KINDS)}")
                if kind == "move":
                    receipt, event = self._stage_move(campaign, graph, staged, effect, turn_number, ordinal, call_id)
                elif kind == "clue":
                    receipt, event = self._stage_clue(graph, staged, effect, turn_number, call_id)
                    if event is None:
                        already.append(receipt["clue"])
                        receipt_ids.append(receipt["id"])
                        continue
                elif kind == "damage":
                    damage_receipts, event = self._stage_damage(campaign, graph, staged, turn, effect,
                                                                call_id, ordinal)
                    receipts.extend(damage_receipts)
                    receipt_ids.extend(r["id"] for r in damage_receipts)
                    events.append((event[0], event[1], damage_receipts[-1]["id"]))
                    continue
                elif kind == "handout":
                    receipt, event = self._stage_handout(campaign, graph, staged, effect, turn_number, call_id)
                    attachments.append(receipt["attachment"])
                else:
                    time_effects += 1
                    receipt, event = self._stage_time(staged, effect, turn_number, ordinal, call_id, time_effects)
                receipts.append(receipt)
                receipt_ids.append(receipt["id"])
                events.append((event[0], event[1], receipt["id"]))
                if kind == "move" and int(receipt.get("minutes") or 0) > 0:
                    # §12.1: travel moves the clock too; the move receipt is its anchor.
                    events.append(("time-advanced", {"minutes": int(receipt["minutes"]), "why": "travel",
                                                     "clock": dict(staged.get("clock") or {})}, receipt["id"]))
            except RpcError as exc:
                exc.details = {"index": index, **(exc.details or {})}
                raise

        campaign.write_world(staged)
        turn["receipts"].extend(receipts)
        turn["state"] = "acting"
        destination = graph.scene(staged["active_scene"])
        material = self.material_of(graph.module_id)(graph.handle(destination))
        result: dict[str, Any] = {"receipts": receipt_ids,
                                  "world": {"active_scene": staged["active_scene"], "clock": staged["clock"]},
                                  "material_ready": material == "ready", "material": material}
        if any(r.get("kind") == "move" for r in receipts):
            # The destination as `look focus=scene` would show it, so the keeper need not
            # look again after moving.
            result.update(self._scene_view(campaign, graph, staged, turn, destination))
            # §14.6: the scene underfoot and its neighbours go on the deepen queue.
            result["deepen_queued"] = self._enqueue_deepen(graph, destination, "move")
        if attachments:
            # §14.8: the extension hands these to the player as message attachments.
            result["attachments"] = [a for a in attachments if a]
            result["attachment"] = result["attachments"][0] if result["attachments"] else None
        if already:
            result["already_discovered"] = already
            if not receipts:
                result["replayed"] = True
        Campaign.remember_call(turn, call_id, params, result)
        campaign.write_turn(turn)
        for event_type, data, receipt_id in events:
            append_event(campaign, turn_number, event_type, data, call_id=call_id, receipt=receipt_id)
        return result

    def _stage_move(self, campaign: Campaign, graph: ModuleGraph, world: dict[str, Any], effect: dict[str, Any],
                    turn_number: int, ordinal: int, call_id: str) -> tuple[dict[str, Any], tuple[str, dict[str, Any]]]:
        to = _str(effect, "to")
        current = graph.scene(world["active_scene"])
        current_handle = graph.handle(current)
        exits = {e["to"]: e for e in graph.scene_exits(current)}
        destination = graph.scene(to)
        dest_handle = graph.handle(destination)
        # The way you came in is always a way out: the trail of scenes the party walked through
        # to get here can be retraced in one move, even out of a lair with no authored exit.
        trail = [str(h) for h in world.get("scene_trail") or []]
        back = list(reversed(trail))
        if dest_handle not in exits and dest_handle not in trail:
            raise RpcError("not_reachable", f"{dest_handle!r} is not reachable from {current_handle!r}",
                           fix=f"move to one of {sorted(exits)} or retrace to one of {back}",
                           details={"from": current_handle, "to": dest_handle,
                                    "exits": sorted(exits), "back": back})
        minutes = effect.get("travel_minutes")
        if minutes is None:
            edge = exits.get(dest_handle) or next((e for e in graph.scene_exits(destination) if e["to"] == current_handle), {})
            minutes = edge.get("travel_minutes", 0)
        if not isinstance(minutes, int) or isinstance(minutes, bool) or minutes < 0:
            raise invalid_params("travel_minutes must be a non-negative integer")
        label = effect.get("label") if isinstance(effect.get("label"), str) and effect.get("label").strip() else None
        receipt = {"id": f"move:{dest_handle}-t{turn_number}-c{ordinal}", "kind": "move",
                   "call_id": call_id, "from": graph.handle(current), "to": dest_handle,
                   "from_label": scene_label(graph, world, current),
                   "to_label": label or scene_label(graph, world, destination),
                   "minutes": minutes, "at": now_iso()}
        if label:
            # A name given once is the scene's name from then on: 【变化】 lines, the capsule
            # and the checkpoint all say 罗克斯伯里疗养院, never the handle.
            world.setdefault("scene_labels", {})[dest_handle] = label
        world["scene_trail"] = trail[:trail.index(dest_handle)] if dest_handle in trail else [*trail, current_handle]
        world["active_scene"] = dest_handle
        if dest_handle not in world.setdefault("visited_scenes", []):
            world["visited_scenes"].append(dest_handle)
        world.setdefault("clock", {"minutes": 0})["minutes"] = int(world["clock"].get("minutes", 0)) + minutes
        return receipt, ("scene-moved", {"from": receipt["from"], "to": dest_handle, "minutes": minutes})

    @staticmethod
    def _replay_trail(campaign: Campaign) -> list[str]:
        """The trail is what replaying every `scene-moved` event with the retrace rule leaves."""
        trail: list[str] = []
        if not campaign.events_path.exists():
            return trail
        for line in campaign.events_path.read_text(encoding="utf-8").splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get("type") != "scene-moved":
                continue
            data = event.get("data") or {}
            src, dest = str(data.get("from")), str(data.get("to"))
            trail = trail[:trail.index(dest)] if dest in trail else [*trail, src]
        return trail

    def _stage_clue(self, graph: ModuleGraph, world: dict[str, Any], effect: dict[str, Any],
                    turn_number: int, call_id: str) -> tuple[dict[str, Any], tuple[str, dict[str, Any]] | None]:
        name = _str(effect, "clue")
        node = graph.clue(name)
        scene = graph.scene(world["active_scene"])
        here = graph.scene_clue_ids(scene)
        handle = graph.handle(node)
        if node["node_id"] not in here:
            raise RpcError("not_here", f"clue {handle!r} is not discoverable at {graph.handle(scene)!r}",
                           fix="discover one of details.clues_here, or move first",
                           details={"clue": handle, "scene": graph.handle(scene),
                                    "clues_here": [graph.handle(graph.nodes[c]) for c in here]})
        how = effect.get("how") if isinstance(effect.get("how"), str) else None
        label = effect.get("label") if isinstance(effect.get("label"), str) and effect.get("label").strip() else None
        receipt = {"id": f"clue:{handle}-t{turn_number}", "kind": "clue", "call_id": call_id,
                   "clue": handle, "label": label or handle, "summary": node.get("summary") or node.get("name"),
                   "scene": graph.handle(scene), "how": how, "at": now_iso()}
        if handle in world.setdefault("discovered_clues", []):
            return receipt, None
        world["discovered_clues"].append(handle)
        return receipt, ("clue-discovered", {"clue": handle, "scene": receipt["scene"], "how": how})

    def _stage_damage(self, campaign: Campaign, graph: ModuleGraph, world: dict[str, Any], turn: dict[str, Any],
                      effect: dict[str, Any], call_id: str, ordinal: int) -> tuple[list[dict[str, Any]], tuple[str, dict[str, Any]]]:
        """Damage with no attacker (a fall, fire, a collapsing stair): the keeper names the
        rulebook's dice, the kernel rolls them and moves HP, one roll receipt and one delta."""
        dice = _str(effect, "dice")
        try:
            rolled = roll_expression(dice, self.rng)
        except ValueError as exc:
            raise invalid_params(f"damage dice {dice!r} is not a dice expression", fix="use the rulebook form, e.g. 1D6 or 2D6+2") from exc
        sheet = self._actor(campaign, effect.get("subject"))
        subject_id = str(sheet["id"])
        ctx = SettleContext(self.engine, campaign, graph, world, turn, call_id, ordinal, self.rng, sheet, sheet, {})
        why = effect.get("why") if isinstance(effect.get("why"), str) else None
        roll_id = ctx.add_dice_roll(actor=subject_id, label="damage", expression=rolled["expression"],
                                    faces=rolled["rolls"], total=rolled["total"], skill_label="伤害", why=why)
        before = int(sheet.get("current_hp") or 0)
        after = max(0, before - int(rolled["total"]))
        ctx.add_delta("hp", subject_id, before, after, source_receipt=roll_id)
        ctx.mirror_investigator(subject_id, current_hp=after, wounds=[roll_id])
        return list(ctx.receipts), ("resource-changed", {"resource": "hp", "subject": subject_id,
                                                          "before": before, "after": after, "dice": dice,
                                                          "total": rolled["total"], "why": why})

    def _stage_time(self, world: dict[str, Any], effect: dict[str, Any], turn_number: int,
                    ordinal: int, call_id: str, nth: int) -> tuple[dict[str, Any], tuple[str, dict[str, Any]]]:
        minutes = effect.get("minutes")
        if not isinstance(minutes, int) or isinstance(minutes, bool) or minutes < 0:
            raise invalid_params("minutes must be a non-negative integer")
        clock = world.setdefault("clock", {"minutes": 0})
        before = int(clock.get("minutes", 0))
        clock["minutes"] = before + minutes
        why = effect.get("why") if isinstance(effect.get("why"), str) else None
        receipt_id = f"time:t{turn_number}-c{ordinal}" + (f"-{nth}" if nth > 1 else "")
        receipt = {"id": receipt_id, "kind": "time", "call_id": call_id, "minutes": minutes,
                   "why": why, "clock_before": before, "clock_after": clock["minutes"], "at": now_iso()}
        return receipt, ("time-advanced", {"minutes": minutes, "why": why, "clock": dict(clock)})

    def _stage_handout(self, campaign: Campaign, graph: ModuleGraph, world: dict[str, Any], effect: dict[str, Any],
                       turn_number: int, call_id: str) -> tuple[dict[str, Any], tuple[str, dict[str, Any]]]:
        """§14.8: a handout or asset node the player may see. The receipt carries the
        attachment the extension hands over: a materialized text file for an authored
        card, the registered bytes for an image, or an explicit `available: false` when
        the module only knows the reference (unavailable media is never invented)."""
        name = _str(effect, "name")
        node = graph.resolve(name, HANDOUT_KINDS, what="handout")
        handle = graph.handle(node)
        visibility = node.get("visibility")
        if visibility not in HANDOUT_VISIBILITIES:
            raise invalid_params(f"{handle!r} is {visibility}; it cannot be handed to the player",
                                 fix="keeper-only images and cards stay in lookup {kind: secret}; hand out a player-safe or revealable one",
                                 details={"handout": handle, "visibility": visibility})
        label = effect.get("label") if isinstance(effect.get("label"), str) and effect.get("label").strip() else None
        display = graph.display_name(node)
        record = record_of(node)
        props = node.get("properties") or {}
        registered = self.module_store.asset(graph.module_id, node["node_id"]) or {}
        attachment: dict[str, Any] = {"handout": handle, "path": None, "media_type": None, "available": False}
        text = record.get("authored_text") if isinstance(record.get("authored_text"), str) else registered.get("authored_text")
        if isinstance(text, str) and text.strip():
            path = campaign.handouts_dir / f"{handle}.md"
            campaign.handouts_dir.mkdir(parents=True, exist_ok=True)
            path.write_text(f"# {display}\n\n{text.strip()}\n", encoding="utf-8")
            attachment.update({"path": str(path), "media_type": "text/markdown", "available": True})
        else:
            ref = registered.get("path") or props.get("asset_ref") or props.get("image_ref")
            media_type = registered.get("media_type") or props.get("media_type")
            candidates = [Path(str(ref))] if ref else []
            module_dir = getattr(self.module_store, "module_dir", None)
            if ref and callable(module_dir):
                candidates.insert(0, Path(module_dir(graph.module_id)) / str(ref))
            found = next((p for p in candidates if p.is_file()), None)
            attachment.update({"path": str(found) if found else (str(ref) if ref else None),
                               "media_type": media_type, "available": found is not None})
        receipt = {"id": f"handout:{handle}-t{turn_number}", "kind": "handout", "call_id": call_id,
                   "handout": handle, "name": display, "label": label or display, "visibility": visibility,
                   "summary": node.get("summary"), "attachment": attachment, "at": now_iso()}
        shown = world.setdefault("handouts_shown", [])
        if handle not in shown:
            shown.append(handle)
        return receipt, ("handout-shown", {"handout": handle, "name": display, "visibility": visibility,
                                           "attachment_available": attachment["available"],
                                           "media_type": attachment["media_type"]})

    # ---- ask ----------------------------------------------------------------

    def ask(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, graph, world, turn = self._context(params)
        call_id, replay = self._begin_write(campaign, turn, "table.ask", params)
        if replay is not None:
            return replay
        prompt = _str(params, "prompt")
        options = params.get("options")
        if (not isinstance(options, list) or not options
                or not all(isinstance(o, str) and o.strip() for o in options)):
            raise invalid_params("params.options must be a non-empty list of strings")
        binds = _str(params, "binds", required=False)
        text = _str(params, "text", required=False)
        if text and has_self_written_mechanics(text):
            raise invalid_params("text contains 【明骰】 or 【变化】 lines",
                                 fix="delete them; the kernel renders mechanics blocks from the receipts")
        turn_number = int(turn["turn"])
        pending = {"name": f"ask-{slugify(binds or prompt)}-t{turn_number}", "prompt": prompt,
                   "options": list(options), "binds": binds}
        # The question closes the turn, so whatever was rolled this turn is delivered
        # with it: the player sees the shot before choosing how to answer it.
        block = mechanics_block(list(turn.get("receipts", [])))
        choice = render_choice(prompt, options)
        if text:
            rendered = f"{place(text, block, 'auto')}\n\n{choice}"
        elif block:
            rendered = f"{block}\n\n{choice}"
        else:
            rendered = choice
        result = {"pending_choice": pending, "rendered_text": rendered, "turn": turn_number, "state": "asked"}
        turn["pending_choice"] = pending
        turn["state"] = "asked"
        Campaign.remember_call(turn, call_id, params, result)
        snapshot = self._snapshot(campaign, graph, world, campaign.party())
        campaign.write_turn_record({
            "turn": turn_number, "player_text": turn.get("player_text"), "receipts": turn.get("receipts", []),
            "text": text or prompt, "rendered_text": rendered, "calls": turn.get("calls", {}), "commit": None,
            "closed_by": "ask", "opened_at": turn.get("opened_at"), "closed_at": now_iso(),
            "pending_choice": pending, "world": snapshot,
            "capsule": turn.get("capsule"), "intents": list(turn.get("intents") or []),
            "director_adoption": self._adoption(campaign, graph, turn, snapshot, closed_by="ask"),
        })
        campaign.write_turn(turn)
        campaign.append_transcript(turn_number, "keeper", rendered)
        append_event(campaign, turn_number, "choice-asked",
                     {"name": pending["name"], "prompt": prompt, "options": list(options), "binds": binds},
                     call_id=call_id)
        return result

    # ---- narrate ------------------------------------------------------------

    def narrate(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, graph, world, turn = self._context(params)
        call_id, replay = self._begin_write(campaign, turn, "table.narrate", params, allow_opening=True)
        if replay is not None:
            return replay
        text = _str(params, "text")
        placement = params.get("placement") or "auto"
        if placement not in ("auto", "end"):
            raise invalid_params("placement must be 'auto' or 'end'")
        if has_self_written_mechanics(text):
            raise invalid_params("text contains 【明骰】 or 【变化】 lines",
                                 fix="delete them; the kernel renders mechanics blocks from the receipts")

        turn_number = int(turn["turn"])
        receipts = list(turn.get("receipts", []))
        rendered = place(text, mechanics_block(receipts), placement)
        receipt_id = f"turn:{turn_number}"
        subject = " ".join(text.split())[:COMMIT_SUBJECT_CHARS]
        party = campaign.party()
        snapshot = self._snapshot(campaign, graph, world, party)
        facts = self._facts(campaign, graph, world, party, receipts, snapshot, turn.get("player_text"))
        result: dict[str, Any] = {"rendered_text": rendered, "turn": turn_number,
                                  "receipt": receipt_id, "commit": None, "facts": facts,
                                  "extraction": {"job_id": memory.job_id_for(campaign.id, turn_number)}}

        before = copy.deepcopy(turn)
        transcript_size = file_size(campaign.transcript_path)
        events_size = file_size(campaign.events_path)
        record_path = campaign.turn_record_path(turn_number)
        had_record = record_path.exists()

        Campaign.remember_call(turn, call_id, params, result)
        record = {
            "turn": turn_number, "player_text": turn.get("player_text"), "receipts": receipts,
            "text": text, "rendered_text": rendered, "placement": placement, "calls": turn.get("calls", {}),
            "commit": None, "closed_by": "narrate", "opened_at": turn.get("opened_at"),
            "closed_at": now_iso(), "pending_choice": turn.get("pending_choice"), "capsule": turn.get("capsule"),
            "world": snapshot, "facts": facts, "intents": list(turn.get("intents") or []),
            "director_adoption": self._adoption(campaign, graph, turn, snapshot, closed_by="narrate"),
        }
        campaign.write_turn_record(record)
        campaign.append_transcript(turn_number, "keeper", rendered)
        append_event(campaign, turn_number, "turn-finalized",
                     {"receipts": [r["id"] for r in receipts], "placement": placement},
                     call_id=call_id, receipt=receipt_id)
        campaign.write_turn(fresh_turn(turn_number + 1))
        try:
            sha = history.commit(campaign.repo_dir, campaign.dir, f"turn {turn_number}: {subject}")
        except history.CommitFailed as exc:
            if before["state"] == "open":
                before["state"] = "acting"
            campaign.write_turn(before)
            truncate_file(campaign.transcript_path, transcript_size)
            truncate_file(campaign.events_path, events_size)
            if not had_record:
                record_path.unlink(missing_ok=True)
            raise RpcError("commit_failed", f"git commit failed; the turn stays open: {exc}",
                           fix="retry narrate with the same text", details={"turn": turn_number})
        record["commit"] = sha
        record["calls"][call_id]["result"]["commit"] = sha
        campaign.write_turn_record(record)
        self._after_commit(campaign, language_of(campaign.read_campaign()), record, snapshot)
        return {**result, "commit": sha}

    def _adoption(self, campaign: Campaign, graph: ModuleGraph, turn: dict[str, Any], snapshot: dict[str, Any], *,
                  closed_by: str) -> dict[str, Any] | None:
        """§13.7: whether the receipts of this turn touched what the capsule's Director
        suggested. Telemetry only; None when the turn had no capsule (turn 0)."""
        capsule = turn.get("capsule") if isinstance(turn.get("capsule"), dict) else None
        director = (capsule or {}).get("director") if capsule else None
        if not isinstance(director, dict) or not director.get("beat"):
            return None
        adoption = director_adoption(str(director["beat"]), list(director.get("reveal") or []),
                                     list(turn.get("receipts") or []), closed_by=closed_by,
                                     turn_calls=turn.get("calls") or {}, present=list(snapshot.get("present") or []),
                                     graph=graph)
        campaign.append_telemetry({"lane": "director", "turn": int(turn["turn"]), "closed_by": closed_by, **adoption})
        return adoption

    def _facts(self, campaign: Campaign, graph: ModuleGraph, world: dict[str, Any], party: list[dict[str, Any]],
               receipts: list[dict[str, Any]], snapshot: dict[str, Any], player_text: str | None = None) -> dict[str, Any]:
        """§12.5: `committed` from the receipts and the snapshot, `keeper_only` from what
        the graph still hides here."""
        language = language_of(campaign.read_campaign())
        labels = {str(s.get("id")): str(s.get("name")) for s in party}
        scene = graph.scene(world["active_scene"])
        return {
            "committed": committed_facts(language, receipts, snapshot, lambda actor: labels.get(actor, actor),
                                         player_text=player_text),
            "keeper_only": keeper_only_facts(language, graph, world, scene, npcs_present(graph, world, scene)),
        }

    def _after_commit(self, campaign: Campaign, language: str, record: dict[str, Any], snapshot: dict[str, Any]) -> None:
        """§12.2–12.3: checkpoint, then episode. The turn is already closed; a failure
        here is telemetry, never an error to the keeper and never a rollback."""
        for step, action in (
            ("checkpoint", lambda: continuation.write_checkpoint(
                campaign, continuation.checkpoint_from_record(campaign.id, language, record, snapshot))),
            ("episode", lambda: memory.write_episode(campaign, record)),
        ):
            try:
                action()
            except Exception as exc:  # noqa: BLE001 - the commit stands whatever happens after it
                campaign.append_telemetry({"lane": "kernel", "step": step, "turn": int(record["turn"]),
                                           "ok": False, "error": f"{type(exc).__name__}: {exc}"})

    # ---- lanes (§12.3, §12.5): no call_id, no turn-state gate ------------------

    def warn(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, _, _, _ = self._load(params)
        return warn_lane.warn(campaign, params)

    def memory_job(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, meta, graph, world = self._load(params)
        turn = params.get("turn")
        if turn is None:
            turn = memory.default_job_turn(campaign)
            if turn is None:
                return {"job_id": None, "turn": None}
        elif not isinstance(turn, int) or isinstance(turn, bool) or turn < 0:
            raise invalid_params("params.turn must be a committed turn number")
        packet = memory.build_job(campaign, graph, language_of(meta), int(turn), campaign.party(), world)
        return memory.open_job(campaign, packet)

    def _job_for(self, campaign: Campaign, meta: dict[str, Any], graph: ModuleGraph, world: dict[str, Any],
                 job_id: Any) -> tuple[dict[str, Any] | None, int]:
        turn = memory.parse_job_id(campaign, job_id)
        job = memory.read_job(campaign, str(job_id))
        if job is None and turn in memory.committed_records(campaign):
            # submit without a prior memory.job in this process (§12.6): the packet is
            # rebuilt from the turn record.
            memory.open_job(campaign, memory.build_job(campaign, graph, language_of(meta), turn, campaign.party(), world))
            job = memory.read_job(campaign, str(job_id))
        return job, turn

    def memory_submit(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, meta, graph, world = self._load(params)
        job, turn = self._job_for(campaign, meta, graph, world, params.get("job_id"))
        if job is None:
            raise invalid_params(f"no extraction job for turn {turn}", fix="call memory.job first",
                                 details={"job_id": params.get("job_id")})
        result, replayed = memory.submit(campaign, graph, campaign.party(), job, params.get("candidates"))
        if replayed:
            return {**result, "replayed": True}
        append_event(campaign, turn, "memory-written",
                     {"job_id": result["job_id"], "turn": turn, "candidates": result["candidates"],
                      "superseded": len(result["superseded"])})
        return result

    def memory_fail(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, meta, graph, world = self._load(params)
        job_id = params.get("job_id")
        job, turn = self._job_for(campaign, meta, graph, world, job_id)
        detail = params.get("detail")
        return memory.fail(campaign, job, str(job_id), turn, params.get("reason"), detail)
