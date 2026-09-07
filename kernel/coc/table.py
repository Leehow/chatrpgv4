"""The table.* methods and the turn state machine (contract §4-§5)."""

from __future__ import annotations

import json

import copy
import difflib
import random
import shutil
from pathlib import Path
from typing import Any, Callable

from . import (KERNEL_VERSION, bookkeeping, continuation, echoes, history, library, memory,
               recall as recall_roads, warn as warn_lane, worldline)
from .capsule import (scene_label, build_capsule, clues_here, investigator_view, npc_view, npcs_present,
                      present_section, where_section)
from .craft import DEFAULT_REGISTER, TextGraph
from .director import DirectorGraph, director_adoption
from .errors import RpcError, invalid_params, not_implemented
from .events import append_event
from .facts import committed_facts, keeper_only_facts, language_of
from .fileio import append_jsonl, file_size, read_json, read_jsonl, truncate_file
from .module_graph import NPC_KIND, ModuleGraph, module_declaration, record_of
from .ontology import Ontology, ontology_not_ready
from . import npc as npc_lane
from .render import check_numbers, check_play_language, mechanics, render_choice
from .resolve import ResolvePipeline
from .rules import RuleTables
from .rules.combat import resolve_module_weapons
from .rules.graph import REGISTERED_CONDITION_PATHS, semantic_name
from .rules.percentile import roll_expression
from .rules.skills import SkillResolver
from .rules.runtime import RulesEngine, SettleContext
from .sessions import SessionView, module_weapons
from .setup import (ModuleStore, STATUS_ACTIVE, STATUS_READY, STATUS_SETTING_UP, SetupMethods, deepen,
                    material_status, module_registered)
from .store import Campaign, Store, fresh_turn, now_iso, parse_call_id
from .text import ascii_slug, normalize, slugify

INTENTS = frozenset({"investigate", "social", "move", "combat", "flee", "cast", "idle", "meta",
                     "stuck", "ambiguous", "montage"})
NONE_INTENTS = frozenset({"idle", "meta", "stuck", "ambiguous"})
APPLY_KINDS = frozenset({"move", "clue", "time", "damage", "handout", "item", "cash", "flag", "note", "ruling",
                         "npc",
                         # §15.3 (#23): the world changing lines. Performed after the turn commits.
                         "fork", "switch", "merge"})
#: §17 (#29) made `npc` live; §18 (#27) made flag, note and ruling live; §15 (#23) made the
#: three worldline effects live. Nothing is reserved.
APPLY_RESERVED: frozenset[str] = frozenset()
#: §17.3: where `apply npc to` may put someone, next to a scene name.
NPC_HERE, NPC_AWAY = "here", "away"
#: §17.3: the relations that say an NPC is the one who hands a clue over.
CLUE_SOURCE_RELATIONS = ("held-by", "delivered-by")
#: #19: the sheet fields `apply item` / `apply cash` own; a staged sheet is committed by
#: overlaying only these onto the file, so a `damage` effect in the same batch (which
#: mirrors HP straight onto the sheet) is never clobbered.
SHEET_FIELDS_OWNED_BY_APPLY = ("equipment", "weapons", "finance", "cash")
#: #19: how many close weapon ids a `needs` lists next to the era's full option list.
WEAPON_CLOSE_MATCHES = 6
#: §15.4: how many echo ids an unknown-echo error offers back.
ECHO_OPTIONS = 12
#: §14.8: what may be handed to the player as a card.
HANDOUT_VISIBILITIES = frozenset({"player-safe", "revealable"})
HANDOUT_KINDS = ("handout", "asset")
#: §14.6: deepen-queue priorities — the scene underfoot, one step away, the opening.
DEEPEN_PRIORITY = {"move": 100, "adjacent": 80, "opening": 90}
LOOK_FOCUS = frozenset({"scene", "npc", "investigator", "clues", "time", "session"})
LOOKUP_KINDS = frozenset({"module", "secret", "rule", "catalog"})
RECALL_KINDS = frozenset({"transcript", "memory", "history"})
WRITABLE_STATES = frozenset({"open", "acting"})
PLAYER_INPUT_STATES = frozenset({"awaiting_player", "asked"})
DEFAULT_LANGUAGE = "zh-Hans"
#: the play_language tags campaign.create accepts (§14.4); the kernel writes nothing in
#: them (§16.1) -- the tag is data for the keeper, the craft table and the extractor.
SUPPORTED_LANGUAGES = ("zh-Hans", "en")
#: Fact namespaces that describe the table's state (a wound, a clock, a pending bout or
#: settlement). Content availability (`magic.*`) and call facts (`intent.*`, `receipt.*`)
#: never make a situation.
SITUATION_FACT_PREFIXES = ("actor.", "time.", "sanity.", "chase.", "development.", "clock.", "subsystem.")
COMMIT_SUBJECT_CHARS = 60


def _receipt_id_for_npc(handle: str, turn_number: int, ordinal: int, mint: Any) -> str:
    """§17.3: `npc:<slug>-t<n>-c<k>`, falling back to the bare turn form when the handle
    carries no Latin slug (§16: ids are machine-face ASCII); the name rides in the receipt."""
    slug = ascii_slug(handle)
    return mint(f"npc:{slug}-t{turn_number}-c{ordinal}" if slug else f"npc:t{turn_number}-c{ordinal}")


def _str(params: dict[str, Any], key: str, *, required: bool = True, default: str | None = None) -> str | None:
    value = params.get(key, default)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip():
        raise invalid_params(f"params.{key} must be a non-empty string")
    return value


def _label(effect: dict[str, Any]) -> str | None:
    """The keeper's play-language short name carried on the receipt (data for the
    mechanics projection, §16.2), or None."""
    label = effect.get("label")
    return label.strip() if isinstance(label, str) and label.strip() else None


def _mint_id(base: str, taken: set[str]) -> str:
    """`base`, or `base-2`, `base-3`… when the turn already holds that receipt id."""
    candidate, n = base, 2
    while candidate in taken:
        candidate = f"{base}-{n}"
        n += 1
    taken.add(candidate)
    return candidate


def _number(value: Any) -> Any:
    """A finance amount as the table gives it: an integral float reads as an int."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _turn_state_error(turn: dict[str, Any], method: str, allowed: str) -> RpcError:
    return RpcError("turn_state", f"{method} is not allowed while the turn is {turn['state']!r}",
                    fix=allowed, details={"turn": turn["turn"], "state": turn["state"]})


class Table:
    def __init__(self, store: Store, content_dir: Path, rng: random.Random, *,
                 seed_locked: bool = False) -> None:
        self.store = store
        self.content = Path(content_dir)
        self.rng = rng
        #: §15.1: without an explicit COC_KERNEL_SEED the dice are reseeded per worldline
        #: and turn, so the same action on two lines cannot roll the same numbers. A test
        #: that pinned the seed keeps its one sequence and nothing reseeds it.
        self.seed_locked = bool(seed_locked)
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
        self._stance_table: npc_lane.StanceTable | None = None
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
    def stance_table(self) -> npc_lane.StanceTable:
        """§17.3: the closed table the NPC ledger's stance moves by; loaded once per process."""
        if self._stance_table is None:
            self._stance_table = npc_lane.StanceTable(self.tables)
        return self._stance_table

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
            # §15.1: every campaign starts on one worldline, `main`, and the sidecar repo's
            # HEAD is that line's branch from the first commit on.
            "active_worldline": worldline.MAIN,
            "worldlines": {worldline.MAIN: worldline.new_line(campaign_id, worldline.MAIN,
                                                              worldline.KIND_MAIN, 0, None)},
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
            history.point_head_at(campaign.repo_dir, campaign.dir, worldline.MAIN)
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

    def _seed_line(self, meta: dict[str, Any], turn_number: int) -> None:
        """§15.1: replay this line's dice from its seed and the turn number. Called when a
        turn opens and when the table is opened, never inside a turn -- two resolves in one
        turn must go on drawing from the same sequence."""
        if self.seed_locked:
            return
        self.rng.seed(worldline.turn_seed(str(worldline.active_line(meta).get("seed") or ""), turn_number))

    def _touch_acting(self, campaign: Campaign, turn: dict[str, Any]) -> None:
        if turn["state"] == "open":
            turn["state"] = "acting"
            campaign.write_turn(turn)

    def open(self, params: dict[str, Any]) -> dict[str, Any]:
        # §14.4: only ready_for_table or active opens; the first open of a ready campaign
        # makes it active (the setup handoff is consumed here).
        campaign = self.store.open(params.get("campaign"), require_turn=False)
        # §15.6: the table opens on `active_worldline`. This runs before anything reads
        # world.json or turn.json, because a checkout replaces both.
        opening_meta = campaign.read_campaign()
        if worldline.open_active_line(campaign, opening_meta):
            campaign.write_campaign(opening_meta)
        legacy_module = str(opening_meta.get("module_id") or "")
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
        # §17.3: a campaign that predates the NPC ledger — or one whose file was lost — gets
        # it back by replaying the closed turns and the memory candidates. Never on every
        # open: the file on disk is the state, and only its absence triggers a rebuild.
        if not campaign.npc_ledger_path.exists():
            self._rebuild_ledger(campaign, graph)
        # §12.2: the checkpoint follows HEAD; a lost turn.json is rebuilt from it.
        checkpoint, rebuilt = continuation.sync_checkpoint(campaign,
                                                           self._snapshot(campaign, graph, world, party),
                                                           worldline=worldline.active_name(meta))
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
        self._seed_line(meta, int(turn["turn"]))
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
            # §15.6: which line the table just opened on, and how many circuits in.
            "worldline": {"name": worldline.active_name(meta),
                          "kind": worldline.active_line(meta).get("kind"),
                          "loop": int(worldline.active_line(meta).get("loop") or 0)},
        }

    def status(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, _, _, turn = self._context(params)
        receipts = list(turn.get("receipts", []))
        return {"turn": turn["turn"], "state": turn["state"], "receipts": receipts,
                "mechanics": mechanics(receipts), "pending_choice": turn.get("pending_choice")}

    def _capsule(self, campaign: Campaign, graph: ModuleGraph, world: dict[str, Any], turn: dict[str, Any], *,
                 resume: dict[str, Any] | None = None, consume_style: bool = False) -> dict[str, Any]:
        meta = campaign.read_campaign()
        first = self._style_first_turn.get(campaign.id)
        style_full = first is None or first == int(turn["turn"])
        if consume_style and first is None:
            self._style_first_turn[campaign.id] = int(turn["turn"])
        # #22: the module briefing rides under the same condition as the full style — the
        # first turn this process opened for the campaign (and any capsule before it).
        return build_capsule(graph, campaign, world, turn, campaign.party(), language=language_of(meta), meta=meta,
                             situations=self._situations(campaign, graph, world, turn), director_graph=self.director,
                             ontology=self.ontology, craft=self.craft,
                             register=str(meta.get("register") or DEFAULT_REGISTER), style_full=style_full, resume=resume,
                             material_of=self.material_of(graph.module_id), module_brief=style_full)

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
                return {"present": self._present(campaign, graph, world, scene)}
            node = graph.npc(_str({"name": name}, "name"))
            return npc_view(graph, world, node, npc_lane.read_ledger(campaign.npc_ledger_path))
        if focus == "investigator":
            return investigator_view(self._actor(campaign, name))
        if focus == "clues":
            return {"discovered_clues": list(world.get("discovered_clues") or []),
                    "clues_here": clues_here(graph, world, scene)}
        if focus == "session":
            # §18.4: the live session in full (11.9 shape: kind, round, turn_of, actions,
            # pending defense, participants), rebuilt from the engine snapshots on disk, so
            # it survives a process restart; `{"session": null}` when none is live.
            view = SessionView(campaign.dir, graph, campaign.party(), world)
            return {"session": view.active_session(), "pending_choice": view.pending_choice()}
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
        # §15.5: a person the module declared `remembers_across_loops` carries what they
        # learned on another circuit or another line. Everyone else gets nothing.
        across = self._cross_line_reader(campaign, graph, world)
        npc_secrets = []
        for node in npcs_present(graph, world, scene):
            record = record_of(node)
            entry = {"name": graph.display_name(node), "secret": record.get("secret"),
                     "agenda": record.get("agenda")}
            elsewhere = across(node)
            if elsewhere:
                entry["from_other_lines"] = elsewhere
            npc_secrets.append(entry)
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
        return {"where": where, "present": self._present(campaign, graph, world, scene)}

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
            result = recall_roads.history(campaign, current, params)
            if params.get("lines"):
                # §15.6: the tree of worldlines -- every line, its fork point, its circuit
                # and its last turn. No line is ever removed from it.
                result["lines"] = recall_roads.worldline_tree(campaign.read_campaign())
            return result
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
        # §15.5: which worldlines to read. `current` is this branch's file; `any` is the
        # union over every line; a name is that line alone. Hits carry the line and circuit.
        line = params.get("line", memory.LINE_CURRENT)
        rows = memory.candidates_for(campaign, campaign.read_campaign(), line)
        hits = memory.query_candidates(campaign, index, about=about, narrow=narrow, turns=turns, kinds=kinds,
                                       include_superseded=include_superseded, limit=limit, rows=rows)
        return {"what": "memory", "about": about, "line": line, "hits": hits}

    # ---- player input -------------------------------------------------------

    def player_input(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, meta, graph, world = self._load(params)
        turn = campaign.read_turn()
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
        # §15.1: this line's dice, replayed from its seed and this turn number.
        self._seed_line(meta, number)
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
        # §18.3: the rulings whose anchor equals what this settlement selected
        result["rulings"] = self._rulings_for(campaign, graph, world, action, settled, receipts)
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

    def _rulings_for(self, campaign: Campaign, graph: ModuleGraph, world: dict[str, Any], action: dict[str, Any],
                     settled: dict[str, Any], receipts: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """§18.3 projection 1: the facets this settlement selected -- the decision, its
        family, the skills rolled, the graph entities the action named -- against the
        active rulings' anchors, identifier for identifier."""
        skills = [str(r["skill"]) for r in receipts if r.get("kind") == "roll" and r.get("form") != "dice" and r.get("skill")]
        outcome = settled.get("outcome") or {}
        if isinstance(outcome.get("skill"), str):
            skills.append(outcome["skill"])
        entities: list[str] = []
        for name in (action.get("target"), action.get("actor"), outcome.get("target")):
            node = graph.find(name) if isinstance(name, str) and name.strip() else None
            if node is not None and graph.handle(node) not in entities:
                entities.append(graph.handle(node))
        return bookkeeping.rulings_for_resolve(bookkeeping.active_rulings(campaign), decision=str(settled["decision"]),
                                               family=str(settled["family"]), skills=skills, entities=entities,
                                               scene=str(world["active_scene"]), module_id=graph.module_id)

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
        campaign, meta, graph, world = self._load(params)
        turn = campaign.read_turn()
        call_id, replay = self._begin_write(campaign, turn, "table.apply", params)
        if replay is not None:
            return replay
        effects = params.get("effects")
        if not isinstance(effects, list) or not effects:
            raise invalid_params("params.effects must be a non-empty list")
        turn_number = int(turn["turn"])
        _, ordinal = parse_call_id(call_id)

        staged = copy.deepcopy(world)
        #: #19: investigator sheets touched by item/cash, staged by id and committed with
        #: the world once every effect of the batch has validated.
        staged_sheets: dict[str, dict[str, Any]] = {}
        #: §18: ledger rows (notes, rulings) staged by the batch, appended after the world.
        staged_notes: list[dict[str, Any]] = []
        staged_rulings: list[dict[str, Any]] = []
        taken_ids = {str(r.get("id")) for r in turn.get("receipts") or []}
        mint = lambda base: _mint_id(base, taken_ids)  # noqa: E731 - the batch's id minter
        receipts: list[dict[str, Any]] = []
        events: list[tuple[str, dict[str, Any], str]] = []
        receipt_ids: list[str] = []
        already: list[str] = []
        attachments: list[dict[str, Any] | None] = []
        #: §15.3: the fork or switch this turn asked for. It is staged like any other
        #: effect but performed after `narrate` commits, so the keeper delivers "and you
        #: are back in the morning" before the line actually moves.
        staged_worldline: dict[str, Any] | None = None
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
                    receipt, event = self._stage_clue(campaign, graph, staged, effect, turn_number, call_id)
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
                elif kind == "item":
                    receipt, event = self._stage_item(campaign, graph, staged_sheets, effect, turn_number, ordinal,
                                                      call_id, taken_ids)
                elif kind == "cash":
                    receipt, event = self._stage_cash(campaign, graph, staged_sheets, effect, turn_number, ordinal,
                                                      call_id, taken_ids)
                elif kind == "flag":
                    receipt, event = bookkeeping.stage_flag(staged, effect, turn_number, ordinal, call_id, mint)
                elif kind == "note":
                    receipt, event = bookkeeping.stage_note(campaign, graph, campaign.party(), effect, turn_number,
                                                            ordinal, call_id, mint, staged_notes)
                elif kind == "ruling":
                    receipt, event = self._stage_ruling(campaign, graph, staged, effect, turn_number, ordinal, call_id,
                                                        mint, staged_rulings)
                elif kind == "npc":
                    receipt, event = self._stage_npc(graph, staged, effect, turn_number, ordinal, call_id, mint)
                elif kind in worldline.OPERATIONS:
                    receipt, staged_worldline = worldline.stage(
                        campaign, meta, graph, staged, effect, turn, index=index, count=len(effects),
                        turn_number=turn_number, call_id=call_id, mint=mint)
                    receipts.append(receipt)
                    receipt_ids.append(receipt["id"])
                    taken_ids.add(str(receipt["id"]))
                    # No event yet: `worldline-forked`/`-switched` are appended when the
                    # transition actually happens, after this turn's commit (§15.3).
                    continue
                else:
                    time_effects += 1
                    receipt, event = self._stage_time(staged, effect, turn_number, ordinal, call_id, time_effects)
                receipts.append(receipt)
                receipt_ids.append(receipt["id"])
                taken_ids.add(str(receipt["id"]))
                events.append((event[0], event[1], receipt["id"]))
                if kind == "move" and int(receipt.get("minutes") or 0) > 0:
                    # §12.1: travel moves the clock too; the move receipt is its anchor.
                    events.append(("time-advanced", {"minutes": int(receipt["minutes"]), "why": "travel",
                                                     "clock": dict(staged.get("clock") or {})}, receipt["id"]))
            except RpcError as exc:
                exc.details = {"index": index, **(exc.details or {})}
                raise

        self._commit_sheets(campaign, staged_sheets)
        campaign.write_world(staged)
        for row in staged_notes:
            append_jsonl(campaign.notes_path, row)
        for row in staged_rulings:
            append_jsonl(campaign.rulings_path, row)
        turn["receipts"].extend(receipts)
        turn["state"] = "acting"
        if staged_worldline is not None:
            turn["worldline"] = staged_worldline
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
        if staged_worldline is not None:
            # §15.3: staged, not done. The keeper narrates the turn first; the line moves
            # when that narrate commits, and the player's next line opens the new line.
            result["worldline"] = {"operation": staged_worldline["operation"], "line": staged_worldline["line"],
                                   "mode": staged_worldline.get("mode"), "loop": int(staged_worldline["loop"]),
                                   "when": "after this turn's narrate commits"}
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
            # A name given once is the scene's name from then on: the mechanics projection,
            # the capsule and the checkpoint all carry that label, never the handle.
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

    def _stage_clue(self, campaign: Campaign, graph: ModuleGraph, world: dict[str, Any],
                    effect: dict[str, Any], turn_number: int,
                    call_id: str) -> tuple[dict[str, Any], tuple[str, dict[str, Any]] | None]:
        name = _str(effect, "clue")
        if echoes.is_echo(name):
            return self._stage_echo(campaign, world, name, effect, turn_number, call_id)
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
        source = self._clue_source(graph, world, scene, node, effect.get("from"))
        receipt = {"id": f"clue:{handle}-t{turn_number}", "kind": "clue", "call_id": call_id,
                   "clue": handle, "label": label or handle, "summary": node.get("summary") or node.get("name"),
                   "scene": graph.handle(scene), "how": how, "from": source, "at": now_iso()}
        if handle in world.setdefault("discovered_clues", []):
            return receipt, None
        world["discovered_clues"].append(handle)
        return receipt, ("clue-discovered", {"clue": handle, "scene": receipt["scene"], "how": how})

    @staticmethod
    def _stage_echo(campaign: Campaign, world: dict[str, Any], handle: str, effect: dict[str, Any],
                    turn_number: int, call_id: str) -> tuple[dict[str, Any], tuple[str, dict[str, Any]] | None]:
        """§15.4: reveal one echo. It is a clue effect because it is evidence, and the
        evidence rule holds -- an echo the keeper only narrated is not discovered. The
        keeper cannot change what the echo says: `label` names it, the summary is the
        kernel's projection of the receipts it came from."""
        row = echoes.find(echoes.read(campaign), handle)
        if row is None:
            raise RpcError("unknown_entity", f"no echo {handle!r} on this worldline",
                           fix="reveal one of details.echoes, or none: echoes come from other lines",
                           details={"echo": handle,
                                    "echoes": [e["id"] for e in echoes.read(campaign)][:ECHO_OPTIONS]})
        label = effect.get("label") if isinstance(effect.get("label"), str) and effect["label"].strip() else None
        receipt = {"id": f"clue:{handle.replace(':', '-')}-t{turn_number}", "kind": "clue", "call_id": call_id,
                   "clue": handle, "label": label or row.get("summary"), "summary": row.get("summary"),
                   "scene": row.get("scene"), "how": effect.get("how") if isinstance(effect.get("how"), str) else None,
                   "from": None, "echo": {"line": row.get("line"), "loop": row.get("loop"), "turn": row.get("turn"),
                                          "kind": row.get("kind")},
                   "at": now_iso()}
        if handle in world.setdefault("discovered_echoes", []):
            return receipt, None
        world["discovered_echoes"].append(handle)
        return receipt, ("clue-discovered", {"clue": handle, "scene": row.get("scene"),
                                             "how": receipt["how"], "echo": row.get("line")})

    @staticmethod
    def _clue_source(graph: ModuleGraph, world: dict[str, Any], scene: dict[str, Any],
                     node: dict[str, Any], given: Any) -> str | None:
        """§17.3 `disclosed`: who handed this clue over. The keeper's `from` wins; otherwise
        the graph fills it in only when it is unambiguous — the clue is `held-by` /
        `delivered-by` exactly one NPC who is present. Two candidates means the machine does
        not choose, and the clue is simply not credited to anyone."""
        if isinstance(given, str) and given.strip():
            return graph.handle(graph.npc(given))
        here = {graph.handle(n) for n in npcs_present(graph, world, scene)}
        holders = {graph.handle(other) for rel in graph.in_rel.get(node["node_id"], [])
                   if rel["relation_kind"] in CLUE_SOURCE_RELATIONS
                   and (other := graph.nodes.get(rel["from_node_id"])) is not None
                   and other["node_kind"] == NPC_KIND}
        candidates = sorted(holders & here)
        return candidates[0] if len(candidates) == 1 else None

    def _stage_npc(self, graph: ModuleGraph, world: dict[str, Any], effect: dict[str, Any], turn_number: int,
                   ordinal: int, call_id: str, mint: Any) -> tuple[dict[str, Any], tuple[str, dict[str, Any]]]:
        """§17.3 (with #25): move a person on or off the stage, and record the keeper's own
        reading of where they stand with the party. `to` is a scene name, `here` for the
        active scene, or `away` to take them off it; `stance` is one of the ledger's four
        words. At least one of the two, or there is nothing to apply."""
        node = graph.npc(_str(effect, "name"))
        handle = graph.handle(node)
        to = effect.get("to")
        stance = effect.get("stance")
        why = effect.get("why") if isinstance(effect.get("why"), str) and effect["why"].strip() else None
        if to is None and stance is None:
            raise invalid_params("an npc effect needs `to`, `stance`, or both",
                                 fix=f"move them with to: {NPC_HERE}/{NPC_AWAY}/<scene>, "
                                     f"or set stance to one of {self.stance_table.words}")
        presence = world.setdefault("npc_presence", {})
        moved_to: str | None = None
        if to is not None:
            if not isinstance(to, str) or not to.strip():
                raise invalid_params("npc.to must be a scene name, 'here' or 'away'")
            if to.strip() == NPC_AWAY:
                presence.pop(handle, None)
                moved_to = NPC_AWAY
            else:
                scene = graph.scene(world["active_scene"]) if to.strip() == NPC_HERE else graph.scene(to)
                moved_to = graph.handle(scene)
                presence[handle] = moved_to
        if stance is not None and (not isinstance(stance, str) or stance not in self.stance_table.words):
            raise invalid_params(f"npc.stance {stance!r} is not one of the ledger's words",
                                 fix=f"one of {self.stance_table.words}")
        receipt = {"id": _receipt_id_for_npc(handle, turn_number, ordinal, mint), "kind": "npc", "call_id": call_id,
                   "npc": node["node_id"], "handle": handle, "name": graph.display_name(node),
                   "to": moved_to, "stance": stance, "why": why, "at": now_iso()}
        return receipt, ("npc-changed", {"npc": handle, "to": moved_to, "stance": stance, "why": why})

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
                                    faces=rolled["rolls"], total=rolled["total"], why=why)
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

    # ---- apply ruling (§18.3) ----------------------------------------------------

    def _stage_ruling(self, campaign: Campaign, graph: ModuleGraph, world: dict[str, Any], effect: dict[str, Any],
                      turn_number: int, ordinal: int, call_id: str, mint: Callable[[str], str],
                      staged: list[dict[str, Any]]) -> tuple[dict[str, Any], tuple[str, dict[str, Any]]]:
        """The anchor is validated against the RuleGraph (families, decision names), the
        skill catalog and the module graph before anything is written."""
        party = campaign.party()
        nodes = self.engine.graph.get("nodes") or []
        anchor = bookkeeping.anchor_of(
            effect.get("anchor"),
            families=sorted(self.engine.graph.get("coverage") or {}),
            decisions=sorted(semantic_name(str(n["node_id"])) for n in nodes if n.get("node_kind") == "decision"),
            resolver=SkillResolver(self.tables, party[0] if party else {}), graph=graph)
        return bookkeeping.stage_ruling(campaign, effect, turn_number, ordinal, call_id, mint, staged, anchor=anchor,
                                        scene=str(world["active_scene"]), module_id=graph.module_id)

    # ---- apply item / cash (#19) -----------------------------------------------

    def _staged_sheet(self, campaign: Campaign, sheets: dict[str, dict[str, Any]], name: Any) -> dict[str, Any]:
        """The batch's working copy of an investigator's sheet (§2 name resolution via
        `_actor`), one copy per investigator however many effects touch it."""
        sheet = self._actor(campaign, name)
        investigator_id = str(sheet["id"])
        if investigator_id not in sheets:
            sheets[investigator_id] = copy.deepcopy(sheet)
        return sheets[investigator_id]

    @staticmethod
    def _commit_sheets(campaign: Campaign, sheets: dict[str, dict[str, Any]]) -> None:
        """Overlay only the fields apply owns onto the sheet on disk: a `damage` effect in
        the same batch wrote HP there already and must not be undone."""
        for investigator_id, staged in sheets.items():
            current = next((s for s in campaign.party() if str(s.get("id")) == investigator_id), None)
            if current is None:
                continue
            for field in SHEET_FIELDS_OWNED_BY_APPLY:
                if field in staged:
                    current[field] = staged[field]
            campaign.write_sheet(current)

    def _weapon_catalog(self, graph: ModuleGraph) -> dict[str, dict[str, Any]]:
        """The rulebook's weapon profiles (`rules-json/weapons.json`, Table XVII: skill,
        damage, range, magazine, malfunction) with the module's own rows on top — the
        same merged table a combat session reads, so what `apply item` writes is what the
        engine will fire."""
        return resolve_module_weapons(self.tables, module_weapons(self.tables, graph))

    def _weapon_profile(self, graph: ModuleGraph, sheet: dict[str, Any], query: Any) -> dict[str, Any]:
        """`effect.weapon` → the profile, by id or display name (normalized). A miss is
        `needs` naming the era's usable ids, closest first."""
        if not isinstance(query, str) or not query.strip():
            raise invalid_params("weapon must be a weapons-table id or profile name")
        catalog = self._weapon_catalog(graph)
        key = normalize(query)
        for prefix in ("weapon:", "item:"):
            if key.startswith(prefix):
                key = key[len(prefix):]
        names_of: dict[str, set[str]] = {}
        for weapon_id, entry in catalog.items():
            names = {normalize(weapon_id)}
            for field in ("display_name", "name"):
                if isinstance(entry.get(field), str):
                    names.add(normalize(entry[field]))
            names_of[weapon_id] = names
            if key in names:
                return {**entry, "weapon_id": weapon_id}
        era = str(sheet.get("era") or module_declaration(graph.module_node).get("era") or "")
        options = [wid for wid, entry in catalog.items()
                   if not era or not entry.get("eras") or era in (entry.get("eras") or [])]
        by_name = {name: wid for wid, names in names_of.items() for name in names}
        close: list[str] = []
        for name in difflib.get_close_matches(key, list(by_name), n=WEAPON_CLOSE_MATCHES * 2, cutoff=0.5):
            if by_name[name] not in close:
                close.append(by_name[name])
        raise RpcError("needs", f"{query!r} is not a weapon profile in the rules tables",
                       fix="set weapon to one of details.needs.options (a weapons.json id or its display name), "
                           "or leave weapon out for an item that is not a weapon",
                       details={"needs": {"field": "weapon", "options": options, "close": close[:WEAPON_CLOSE_MATCHES],
                                          "source": "content/rulesets/coc7/rules-json/weapons.json"}})

    @staticmethod
    def _weapon_row(profile: dict[str, Any], name: str, label: str | None, turn_number: int) -> dict[str, Any]:
        """A sheet `weapons[]` row in the pregen shape, every number from the profile."""
        yards = profile.get("base_range_yards")
        row: dict[str, Any] = {
            "weapon_id": str(profile["weapon_id"]), "name": name, "profile": profile.get("display_name"),
            "skill": profile.get("skill"), "damage": profile.get("damage") or profile.get("damage_die"),
            "range": f"{yards} yards" if isinstance(yards, int) else None, "attacks": profile.get("uses_per_round"),
            "ammo": profile.get("magazine"), "malfunction": profile.get("malfunction"), "turn": turn_number,
        }
        if label:
            row["label"] = label
        return row

    @staticmethod
    def _item_matches(entry: Any, key: str) -> bool:
        if isinstance(entry, dict):
            return key in {normalize(str(entry.get(f) or "")) for f in ("name", "label", "weapon")}
        return normalize(str(entry)) == key

    @staticmethod
    def _weapon_matches(row: Any, key: str) -> bool:
        return isinstance(row, dict) and key in {normalize(str(row.get(f) or "")) for f in ("weapon_id", "name", "label")}

    def _held(self, sheet: dict[str, Any], key: str) -> int:
        """How many of an item the sheet holds: equipment entries (a bare string counts
        one), else the matching weapon rows (a pregen's pistol has no equipment entry)."""
        entries = [e for e in sheet.get("equipment") or [] if self._item_matches(e, key)]
        if entries:
            return sum(int(e.get("quantity") or 1) if isinstance(e, dict) else 1 for e in entries)
        return sum(1 for w in sheet.get("weapons") or [] if self._weapon_matches(w, key))

    def _add_item(self, sheet: dict[str, Any], name: str, quantity: int, turn_number: int, *, source: str | None,
                  label: str | None, profile: dict[str, Any] | None) -> None:
        key = normalize(name)
        equipment = sheet.get("equipment")
        if not isinstance(equipment, list):
            equipment = sheet["equipment"] = []
        for entry in equipment:
            if isinstance(entry, dict) and normalize(str(entry.get("name") or "")) == key:
                entry["quantity"] = int(entry.get("quantity") or 1) + quantity
                break
        else:
            entry = {"name": name, "quantity": quantity, "turn": turn_number}
            if source:
                entry["from"] = source
            if label:
                entry["label"] = label
            if profile:
                entry["weapon"] = str(profile["weapon_id"])
            equipment.append(entry)
        if profile:
            weapons = sheet.get("weapons")
            if not isinstance(weapons, list):
                weapons = sheet["weapons"] = []
            if not any(isinstance(w, dict) and str(w.get("weapon_id")) == str(profile["weapon_id"])
                       and normalize(str(w.get("name") or "")) == key for w in weapons):
                weapons.append(self._weapon_row(profile, name, label, turn_number))

    def _remove_item(self, sheet: dict[str, Any], name: str, loss: int) -> None:
        """Take `loss` of an item off the sheet; when none is left the matching weapon
        rows go too, so `resolve` can no longer fire it."""
        key = normalize(name)
        equipment = sheet.get("equipment") if isinstance(sheet.get("equipment"), list) else []
        weapons = sheet.get("weapons") if isinstance(sheet.get("weapons"), list) else []
        remaining = loss
        for index in reversed([i for i, e in enumerate(equipment) if self._item_matches(e, key)]):
            entry = equipment[index]
            have = int(entry.get("quantity") or 1) if isinstance(entry, dict) else 1
            take = min(have, remaining)
            if isinstance(entry, dict) and have - take > 0:
                entry["quantity"] = have - take
            else:
                del equipment[index]
            remaining -= take
            if remaining == 0:
                break
        if remaining > 0:
            # no equipment entry: the item lives only as weapon rows (a pregen's pistol)
            for index in reversed([i for i, w in enumerate(weapons) if self._weapon_matches(w, key)]):
                if remaining == 0:
                    break
                del weapons[index]
                remaining -= 1
        if not any(self._item_matches(e, key) for e in equipment):
            sheet["weapons"] = [w for w in weapons if not self._weapon_matches(w, key)]

    def _stage_item(self, campaign: Campaign, graph: ModuleGraph, sheets: dict[str, dict[str, Any]],
                    effect: dict[str, Any], turn_number: int, ordinal: int, call_id: str,
                    taken: set[str]) -> tuple[dict[str, Any], tuple[str, dict[str, Any]]]:
        """#19: something that reached (quantity > 0) or left (quantity < 0) an investigator's
        hands in the narration, written onto the sheet so `resolve` and combat see it."""
        name = _str(effect, "name")
        quantity = effect.get("quantity", 1)
        if not isinstance(quantity, int) or isinstance(quantity, bool) or quantity == 0:
            raise invalid_params("quantity must be a non-zero integer (negative is a loss)")
        sheet = self._staged_sheet(campaign, sheets, effect.get("to"))
        subject_id, subject_label = str(sheet["id"]), str(sheet.get("name") or sheet["id"])
        label = _label(effect)
        why = effect.get("why") if isinstance(effect.get("why"), str) else None
        source_name = effect.get("from")
        if source_name is not None and (not isinstance(source_name, str) or not source_name.strip()):
            raise invalid_params("from must be an NPC name")
        source = None
        if source_name:
            # The NPC's canonical name when it resolves (exact, else one whole word of a
            # name — the §12.4 rule, `Knott` → Steven Knott); the keeper's own words when
            # it does not: provenance is narrative, not a world write.
            index = memory.EntityIndex(graph, campaign.party())
            found = index.matches(source_name, kinds=(NPC_KIND,), investigators=False) or index.loose_matches(source_name, kinds=(NPC_KIND,))
            source = index.canonical_name(found[0]) if len(found) == 1 else source_name.strip()
        profile = self._weapon_profile(graph, sheet, effect["weapon"]) if effect.get("weapon") is not None else None
        key = normalize(name)
        before = self._held(sheet, key)
        if quantity > 0:
            self._add_item(sheet, name, quantity, turn_number, source=source, label=label, profile=profile)
        else:
            if before < -quantity:
                raise invalid_params(f"{subject_label} holds {before} × {name!r}; cannot lose {-quantity}",
                                     fix="an item leaves the sheet only if it is on it: apply the gain first, or a smaller loss",
                                     details={"name": name, "held": before, "quantity": quantity})
            self._remove_item(sheet, name, -quantity)
        after = self._held(sheet, key)
        # §16: the id is machine-face ASCII -- the name's Latin slug when it has one, else
        # the call ordinal alone (like cash); the name itself rides in `name` / `label`.
        slug = ascii_slug(name)
        receipt_id = _mint_id(f"item:{slug}-t{turn_number}-c{ordinal}" if slug else f"item:t{turn_number}-c{ordinal}", taken)
        receipt = {"id": receipt_id, "kind": "item",
                   "call_id": call_id, "name": name, "label": label or name, "subject": subject_id,
                   "subject_label": subject_label, "from": source,
                   "weapon": str(profile["weapon_id"]) if profile else None, "quantity": quantity,
                   "before": before, "after": after, "why": why, "at": now_iso()}
        data: dict[str, Any] = {"name": name, "to": subject_id, "quantity": quantity}
        if source:
            data["from"] = source
        if profile:
            data["weapon"] = str(profile["weapon_id"])
        return receipt, ("item-transferred", data)

    def _finance_block(self, graph: ModuleGraph, sheet: dict[str, Any]) -> dict[str, Any]:
        """A sheet without a finance block gets one from `cash-assets.json` for its era and
        credit rating (the chargen shape). An era the table has no period for starts at
        zero and says so: the balance is then the sum of the cash receipts, not a guess."""
        era = str(sheet.get("era") or module_declaration(graph.module_node).get("era") or "")
        credit = sheet.get("credit_rating")
        if not isinstance(credit, int) or isinstance(credit, bool):
            credit = (sheet.get("skills") or {}).get("Credit Rating")
        credit = int(credit) if isinstance(credit, int) and not isinstance(credit, bool) else 0
        try:
            finance = self.tables.cash_and_assets(credit, era)
        except ValueError as exc:
            currency = str(self.tables.load("cash-assets").get("currency") or "USD")
            return {"credit_rating": credit, "living_standard": None, "cash": {"amount": 0, "currency": currency},
                    "assets": None, "spending_level": None, "period": era or None, "source": None,
                    "note": f"no cash-assets period for era {era!r} ({exc}); the balance is the sum of cash receipts"}
        finance["source"] = f"cash-assets.periods.{era}"
        return finance

    def _stage_cash(self, campaign: Campaign, graph: ModuleGraph, sheets: dict[str, dict[str, Any]],
                    effect: dict[str, Any], turn_number: int, ordinal: int, call_id: str,
                    taken: set[str]) -> tuple[dict[str, Any], tuple[str, dict[str, Any]]]:
        """#19: money changing hands, on `finance.cash` of the sheet."""
        delta = effect.get("delta")
        if not isinstance(delta, int) or isinstance(delta, bool) or delta == 0:
            raise invalid_params("delta must be a non-zero integer in the era's currency unit")
        sheet = self._staged_sheet(campaign, sheets, effect.get("subject"))
        subject_id, subject_label = str(sheet["id"]), str(sheet.get("name") or sheet["id"])
        why = effect.get("why") if isinstance(effect.get("why"), str) else None
        finance = sheet.get("finance")
        if not isinstance(finance, dict) or not isinstance(finance.get("cash"), dict):
            finance = self._finance_block(graph, sheet)
        cash = finance["cash"]
        before = _number(cash.get("amount") or 0)
        currency = str(cash.get("currency") or "USD")
        after = _number(before + delta)
        if after < 0:
            raise invalid_params(f"{subject_label} has {before} {currency}; cannot lose {-delta}",
                                 fix="a smaller delta, or narrate the debt without a cash receipt",
                                 details={"before": before, "delta": delta, "currency": currency})
        cash["amount"] = after
        sheet["finance"] = finance
        sheet["cash"] = f"{after} {currency}"
        receipt = {"id": _mint_id(f"cash:t{turn_number}-c{ordinal}", taken), "kind": "cash", "call_id": call_id,
                   "resource": "cash", "subject": subject_id, "subject_label": subject_label,
                   "before": before, "after": after, "delta": delta,
                   "currency": currency, "why": why, "at": now_iso()}
        return receipt, ("resource-changed", {"resource": "cash", "subject": subject_id, "before": before,
                                              "after": after, "delta": delta, "why": why})

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
        if turn.get("worldline"):
            # §15.3: a turn that changes the worldline cannot end on a question -- the
            # answer would land on a line the player has not been told about yet.
            raise invalid_params("a turn that forks or switches the worldline cannot be closed by ask",
                                 fix="close this turn with narrate; ask on the new line's first turn",
                                 details={"worldline": turn["worldline"].get("operation")})
        # §16.3: player-facing fields first owe the campaign's play_language script, then
        # the public numbers. Script is a closed character class, not language detection.
        check_play_language(language_of(campaign.read_campaign()), {
            "prompt": prompt,
            **{f"options[{i}]": option for i, option in enumerate(options)},
            **({"text": text} if text else {}),
        })
        receipts = list(turn.get("receipts", []))
        # §16.3: the question closes the turn, so the player must see this turn's rolls
        # before choosing. The keeper states them in `text`; no text states nothing, so a
        # turn with public numbers refuses an ask without one.
        check_numbers(text or "", receipts)
        turn_number = int(turn["turn"])
        pending = {"name": f"ask-{slugify(binds or prompt)}-t{turn_number}", "prompt": prompt,
                   "options": list(options), "binds": binds}
        choice = render_choice(prompt, options)
        rendered = f"{text.strip()}\n\n{choice}" if text else choice
        projected = mechanics(receipts)
        result = {"pending_choice": pending, "rendered_text": rendered, "mechanics": projected,
                  "turn": turn_number, "state": "asked"}
        turn["pending_choice"] = pending
        turn["state"] = "asked"
        Campaign.remember_call(turn, call_id, params, result)
        snapshot = self._snapshot(campaign, graph, world, campaign.party())
        record = {
            "turn": turn_number, "player_text": turn.get("player_text"), "receipts": receipts,
            "text": text or prompt, "rendered_text": rendered, "mechanics": projected, "calls": turn.get("calls", {}),
            "commit": None,
            "closed_by": "ask", "opened_at": turn.get("opened_at"), "closed_at": now_iso(),
            "pending_choice": pending, "world": snapshot,
            "capsule": turn.get("capsule"), "intents": list(turn.get("intents") or []),
            "director_adoption": self._adoption(campaign, graph, turn, snapshot, closed_by="ask"),
        }
        campaign.write_turn_record(record)
        self._update_ledger(campaign, graph, record)
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
        # `placement` (pre-§16) is accepted and ignored: nothing is placed any more.
        turn_number = int(turn["turn"])
        receipts = list(turn.get("receipts", []))
        # §16.3: player-facing text first owes the campaign's play_language script, then
        # the public numbers. The kernel renders no mechanics; it delivers the text verbatim
        # and the receipts ride beside it as the language-neutral projection (§16.2).
        check_play_language(language_of(campaign.read_campaign()), {"text": text})
        check_numbers(text, receipts)
        rendered = text
        projected = mechanics(receipts)
        receipt_id = f"turn:{turn_number}"
        subject = " ".join(text.split())[:COMMIT_SUBJECT_CHARS]
        party = campaign.party()
        snapshot = self._snapshot(campaign, graph, world, party)
        facts = self._facts(campaign, graph, world, party, receipts, snapshot, turn.get("player_text"))
        result: dict[str, Any] = {"rendered_text": rendered, "mechanics": projected, "turn": turn_number,
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
            "text": text, "rendered_text": rendered, "mechanics": projected, "calls": turn.get("calls", {}),
            "commit": None, "closed_by": "narrate", "opened_at": turn.get("opened_at"),
            "closed_at": now_iso(), "pending_choice": turn.get("pending_choice"), "capsule": turn.get("capsule"),
            "world": snapshot, "facts": facts, "intents": list(turn.get("intents") or []),
            "director_adoption": self._adoption(campaign, graph, turn, snapshot, closed_by="narrate"),
            # §15.3: the fork or switch this turn asked for, performed below once the
            # commit stands. It rides in the record so a crash between the two is visible.
            "worldline": turn.get("worldline"),
        }
        campaign.write_turn_record(record)
        self._update_ledger(campaign, graph, record)
        campaign.append_transcript(turn_number, "keeper", rendered)
        append_event(campaign, turn_number, "turn-finalized",
                     {"receipts": [r["id"] for r in receipts]},
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
        moved = self._after_commit(campaign, graph, record, snapshot, turn_number)
        return {**result, "commit": sha, **({"worldline": moved} if moved else {})}

    def _move_worldline(self, campaign: Campaign, graph: ModuleGraph, record: dict[str, Any],
                        turn_number: int) -> dict[str, Any] | None:
        """§15.3: perform the turn's staged fork, switch or merge, after the commit and
        before the checkpoint. Like everything else in the post-commit chain a failure here
        is telemetry, never an error to the keeper: `transition` has already put the
        reference back, so the table keeps playing the line it was on and the next capsule
        says so."""
        plan = record.get("worldline")
        if not isinstance(plan, dict) or not plan.get("operation"):
            return None
        try:
            moved = worldline.transition(campaign, graph, plan, turn_number)
        except Exception as exc:  # noqa: BLE001 - the turn is committed; the line simply did not move
            campaign.append_telemetry({"lane": "worldline", "turn": turn_number, "ok": False,
                                       "operation": plan.get("operation"), "line": plan.get("line"),
                                       "error": f"{type(exc).__name__}: {exc}"})
            return None
        landed = int(campaign.read_turn().get("turn") or turn_number + 1)
        event_type, data = worldline.event_of(plan)
        append_event(campaign, landed, event_type, data, receipt=str(plan.get("receipt") or ""))
        campaign.append_telemetry({"lane": "worldline", "turn": turn_number, "ok": True, **moved})
        # The line's dice from here on are its own (§15.1).
        self._seed_line(campaign.read_campaign(), landed)
        return moved

    # ---- the NPC ledger (§17.3) ---------------------------------------------

    def _cross_line_reader(self, campaign: Campaign, graph: ModuleGraph,
                           world: dict[str, Any]) -> Callable[[dict[str, Any]], list[dict[str, Any]]]:
        """§15.5: what one person knows from another worldline. Built here because both
        `lookup secret scope=scene` and the capsule's `present` project it."""
        index = memory.EntityIndex(graph, campaign.party(), scene_labels=world.get("scene_labels"))
        return worldline.cross_line_reader(campaign, graph, campaign.read_campaign(), index)

    def _present(self, campaign: Campaign, graph: ModuleGraph, world: dict[str, Any],
                 scene: dict[str, Any]) -> list[dict[str, Any]]:
        """§17.4: the people in the room, dossier and ledger together — the same projection
        the capsule carries, so `look` and the capsule never disagree."""
        from .memory import read_candidates
        return present_section(graph, world, scene, npc_lane.read_ledger(campaign.npc_ledger_path),
                               read_candidates(campaign))



    @staticmethod
    def _npc_id_resolver(graph: ModuleGraph) -> Any:
        """Whatever a receipt or a snapshot calls a person — a node id, a handle, a display
        name — mapped to the node id the ledger is keyed by. Nothing else is an NPC."""
        cache: dict[str, str | None] = {}

        def resolve(value: Any) -> str | None:
            if not isinstance(value, str) or not value.strip():
                return None
            if value not in cache:
                node = graph.nodes.get(value) or graph.find(value, (NPC_KIND,))
                cache[value] = node["node_id"] if node and node["node_kind"] == NPC_KIND else None
            return cache[value]

        return resolve

    def _fold_turn(self, graph: ModuleGraph, ledger: dict[str, Any], record: dict[str, Any]) -> None:
        """One closed turn's receipts and world snapshot, folded in. Used both when the turn
        closes and when the ledger is rebuilt from the records (§12.6, §17.3)."""
        turn_number = int(record["turn"])
        npc_id_of = self._npc_id_resolver(graph)
        npc_lane.apply_receipts(ledger, record.get("receipts") or [], turn=turn_number,
                                table=self.stance_table, npc_id_of=npc_id_of)
        present = [npc_id for name in ((record.get("world") or {}).get("present") or [])
                   if (npc_id := npc_id_of(name))]
        npc_lane.note_present(ledger, present, turn_number)

    def _update_ledger(self, campaign: Campaign, graph: ModuleGraph, record: dict[str, Any]) -> None:
        ledger = npc_lane.read_ledger(campaign.npc_ledger_path)
        self._fold_turn(graph, ledger, record)
        npc_lane.write_ledger(campaign.npc_ledger_path, ledger)

    def _rebuild_ledger(self, campaign: Campaign, graph: ModuleGraph) -> dict[str, Any]:
        """§17.3: the ledger is a fold over the closed turns and the memory candidates, so a
        campaign that predates this slice — or one whose file was lost — gets it back by
        replaying them in order. Nothing is read from prose."""
        ledger: dict[str, Any] = {}
        for path in sorted(campaign.turns_dir.glob("*.json")):
            try:
                record = read_json(path)
            except (OSError, ValueError):
                continue
            if isinstance(record, dict) and isinstance(record.get("turn"), int):
                self._fold_turn(graph, ledger, record)
        npc_lane.note_memory(ledger, read_jsonl(campaign.candidates_path),
                             npc_id_of=self._npc_id_resolver(graph))
        npc_lane.write_ledger(campaign.npc_ledger_path, ledger)
        return ledger

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
        labels = {str(s.get("id")): str(s.get("name")) for s in party}
        scene = graph.scene(world["active_scene"])
        return {
            "committed": committed_facts(receipts, snapshot, lambda actor: labels.get(actor, actor),
                                         player_text=player_text),
            "keeper_only": keeper_only_facts(graph, world, scene, npcs_present(graph, world, scene)),
        }

    def _after_commit(self, campaign: Campaign, graph: ModuleGraph, record: dict[str, Any],
                      snapshot: dict[str, Any], turn_number: int) -> dict[str, Any] | None:
        """§12.2–12.3: checkpoint, then episode. The turn is already closed; a failure
        here is telemetry, never an error to the keeper and never a rollback.

        §15.3 puts the worldline transition in this chain, before the checkpoint, so the
        checkpoint names the line the *next* turn will be played on. A turn that moves the
        line therefore writes its library card and its episode first -- those belong to the
        line the turn was played on, and the fork point seals them into it -- and takes the
        checkpoint afterwards, off the state the table actually landed in (a rewind has
        replaced the world by then)."""
        moves = isinstance(record.get("worldline"), dict) and record["worldline"].get("operation")
        checkpoint = ("checkpoint", lambda: continuation.write_checkpoint(
            campaign, continuation.checkpoint_from_record(
                campaign.id, record, snapshot,
                worldline=worldline.active_name(campaign.read_campaign()))))
        # §21.4: the library cards at the table mirror the committed sheet; never raises
        rest = (("library", lambda: library.write_back(self.store, campaign, record)),
                ("episode", lambda: memory.write_episode(campaign, record)))
        for step, action in (rest if moves else (checkpoint, *rest)):
            self._post_commit_step(campaign, record, step, action)
        if not moves:
            return None
        moved = self._move_worldline(campaign, graph, record, turn_number)
        if moved is not None:
            # The world on disk is the new line's now; the checkpoint describes where the
            # next turn resumes from, not the turn that asked for the move.
            world = campaign.read_world()
            landed = self._snapshot(campaign, graph, world, campaign.party())
            checkpoint = ("checkpoint", lambda: continuation.write_checkpoint(
                campaign, continuation.checkpoint_from_record(
                    campaign.id, {**record, "world": None}, landed,
                    worldline=worldline.active_name(campaign.read_campaign()))))
        self._post_commit_step(campaign, record, *checkpoint)
        return moved

    def _post_commit_step(self, campaign: Campaign, record: dict[str, Any], step: str,
                          action: Callable[[], Any]) -> None:
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
        self._ledger_note_memory(campaign, graph, set(result.get("written") or []))
        append_event(campaign, turn, "memory-written",
                     {"job_id": result["job_id"], "turn": turn, "candidates": result["candidates"],
                      "superseded": len(result["superseded"])})
        return result

    def _ledger_note_memory(self, campaign: Campaign, graph: ModuleGraph, written: set[str]) -> None:
        """§17.3: the promises and the said, referenced by memory id. The ledger keeps no
        copy of the statement — the memory layer owns supersession and closure (§13.5)."""
        if not written:
            return
        rows = [row for row in read_jsonl(campaign.candidates_path) if str(row.get("id")) in written]
        if not rows:
            return
        ledger = npc_lane.read_ledger(campaign.npc_ledger_path)
        npc_lane.note_memory(ledger, rows, npc_id_of=self._npc_id_resolver(graph))
        npc_lane.write_ledger(campaign.npc_ledger_path, ledger)

    def memory_fail(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, meta, graph, world = self._load(params)
        job_id = params.get("job_id")
        job, turn = self._job_for(campaign, meta, graph, world, job_id)
        detail = params.get("detail")
        return memory.fail(campaign, job, str(job_id), turn, params.get("reason"), detail)
