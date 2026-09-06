"""The table.* methods and the turn state machine (contract §4-§5)."""

from __future__ import annotations

import copy
import random
import shutil
from pathlib import Path
from typing import Any

from . import KERNEL_VERSION, history
from .capsule import (build_capsule, clues_here, investigator_view, npc_view, npcs_present,
                      present_section, where_section)
from .errors import RpcError, invalid_params, not_implemented
from .events import append_event
from .fileio import file_size, read_json, truncate_file
from .module_graph import ModuleGraph, record_of
from .render import (has_self_written_mechanics, mechanics_block, place, render_choice)
from .resolve import ResolvePipeline
from .rules import RuleTables
from .rules.graph import semantic_name
from .rules.runtime import RulesEngine, SettleContext
from .sessions import SessionView
from .store import Campaign, Store, fresh_turn, now_iso, parse_call_id
from .text import normalize, slugify

INTENTS = frozenset({"investigate", "social", "move", "combat", "flee", "cast", "idle", "meta",
                     "stuck", "ambiguous", "montage"})
NONE_INTENTS = frozenset({"idle", "meta", "stuck", "ambiguous"})
APPLY_KINDS = frozenset({"move", "clue", "time"})
APPLY_RESERVED = frozenset({"handout", "item", "cash", "npc", "flag", "note", "ruling"})
LOOK_FOCUS = frozenset({"scene", "npc", "investigator", "clues", "time"})
LOOKUP_KINDS = frozenset({"module", "secret", "rule", "catalog"})
RECALL_KINDS = frozenset({"transcript", "memory", "history"})
WRITABLE_STATES = frozenset({"open", "acting"})
PLAYER_INPUT_STATES = frozenset({"awaiting_player", "asked"})
DEFAULT_LANGUAGE = "zh-Hans"
#: Fact namespaces that describe the table's state (a wound, a clock, a pending bout or
#: settlement). Content availability (`magic.*`) and call facts (`intent.*`, `receipt.*`)
#: never make a situation.
SITUATION_FACT_PREFIXES = ("actor.", "time.", "sanity.", "chase.", "development.", "clock.", "subsystem.")
RECALL_DEFAULT_TURNS = 3
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
        self._graphs: dict[str, ModuleGraph] = {}

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
        if module_id not in self._graphs:
            path = self.content / "starters" / module_id / "module-graph.json"
            if not path.exists():
                raise invalid_params(f"unknown module {module_id!r}",
                                     fix=f"one of {self.modules()}")
            self._graphs[module_id] = ModuleGraph(module_id, path)
        return self._graphs[module_id]

    def _context(self, params: dict[str, Any]) -> tuple[Campaign, ModuleGraph, dict[str, Any], dict[str, Any]]:
        campaign = self.store.open(params.get("campaign"))
        meta = campaign.read_campaign()
        if meta.get("status") != "active":
            raise RpcError("campaign_not_ready", f"campaign {campaign.id!r} is {meta.get('status')!r}")
        graph = self.graph(str(meta["module_id"]))
        return campaign, graph, campaign.read_world(), campaign.read_turn()

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
        campaign_id = self.store.validate_new_id(params.get("id"))
        module_id = _str(params, "module")
        pregen_id = _str(params, "pregen")
        language = _str(params, "play_language", required=False) or DEFAULT_LANGUAGE
        graph = self.graph(module_id)
        pregen_path = self.content / "starters" / module_id / "pregens" / pregen_id / "character.json"
        if not pregen_path.exists():
            pregens_dir = self.content / "starters" / module_id / "pregens"
            available = sorted(p.name for p in pregens_dir.iterdir()) if pregens_dir.exists() else []
            raise invalid_params(f"unknown pregen {pregen_id!r}", fix=f"one of {available}")
        title = _str(params, "title", required=False) or graph.title()

        sheet = read_json(pregen_path)
        derived = sheet.get("derived") or {}
        characteristics = sheet.get("characteristics") or {}
        sheet["id"] = sheet.get("id") or pregen_id
        sheet["current_hp"] = derived.get("HP")
        sheet["current_san"] = derived.get("SAN")
        sheet["current_mp"] = derived.get("MP")
        sheet["current_luck"] = characteristics.get("LUCK")

        start = graph.start_scene()
        start_handle = graph.handle(start)
        presence: dict[str, str] = {}
        for scene in graph.scenes():
            for npc_id in graph.scene_npc_ids(scene):
                presence.setdefault(graph.handle(graph.nodes[npc_id]), graph.handle(scene))
        world = {
            "active_scene": start_handle,
            "visited_scenes": [start_handle],
            "discovered_clues": [],
            "flags": {},
            "clock": {"minutes": 0},
            "npc_presence": presence,
        }
        meta = {
            "id": campaign_id,
            "title": title,
            "module_id": module_id,
            "module_digest": graph.digest,
            "play_language": language,
            "status": "active",
            "created_at": now_iso(),
            "opening_scene": start_handle,
            "investigators": [sheet["id"]],
        }

        campaign = Campaign(self.store, campaign_id)
        campaign.dir.mkdir(parents=True, exist_ok=False)
        try:
            campaign.party_dir.mkdir()
            campaign.turns_dir.mkdir()
            campaign.write_sheet(sheet)
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

    def _investigators(self, campaign: Campaign) -> list[dict[str, Any]]:
        rows = []
        for sheet in campaign.party():
            rows.append({"id": sheet.get("id"), "name": sheet.get("name"),
                         "occupation": sheet.get("occupation"), "hp": sheet.get("current_hp"),
                         "san": sheet.get("current_san"), "mp": sheet.get("current_mp"),
                         "luck": sheet.get("current_luck")})
        return rows

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
        campaign, graph, world, turn = self._context(params)
        scene = graph.scene(world["active_scene"])
        pending_turn = None
        if turn["state"] in WRITABLE_STATES:
            pending_turn = {"player_text": turn.get("player_text"), "receipts": turn.get("receipts", []),
                            "owed": ["narrate"], "since": turn.get("opened_at")}
        return {
            "campaign": campaign.read_campaign(),
            "turn": {"number": turn["turn"], "state": turn["state"]},
            "investigators": self._investigators(campaign),
            "scene": {"name": graph.handle(scene), "display_name": graph.display_name(scene)},
            "pending_turn": pending_turn,
            "opening_needed": turn["turn"] == 0 and turn["state"] == "awaiting_player",
        }

    def status(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, _, _, turn = self._context(params)
        return {"turn": turn["turn"], "state": turn["state"], "receipts": turn.get("receipts", []),
                "pending_choice": turn.get("pending_choice")}

    def capsule(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, graph, world, turn = self._context(params)
        return build_capsule(graph, campaign, world, turn, campaign.party())

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
        where = where_section(graph, world, scene)
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
        if what != "transcript":
            raise not_implemented(f"recall {what!r} is reserved for a later slice")
        self._touch_acting(campaign, turn)
        current = int(turn["turn"])
        span = params.get("turns")
        if span is None:
            span = [max(0, current - RECALL_DEFAULT_TURNS + 1), current]
        if (not isinstance(span, list) or len(span) != 2
                or not all(isinstance(v, int) and v >= 0 for v in span) or span[0] > span[1]):
            raise invalid_params("turns must be [from, to] with 0 <= from <= to")
        role = params.get("role")
        if role is not None and role not in ("player", "keeper"):
            raise invalid_params("role must be 'player' or 'keeper'")
        entries = [e for e in campaign.read_transcript()
                   if span[0] <= int(e["turn"]) <= span[1] and (role is None or e["role"] == role)]
        return {"what": "transcript", "turns": span, "entries": entries}

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
        return {"turn": number, "state": "open",
                "capsule": build_capsule(graph, campaign, world, new_turn, campaign.party())}

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
                    receipt, event = self._stage_move(graph, staged, effect, turn_number, ordinal, call_id)
                elif kind == "clue":
                    receipt, event = self._stage_clue(graph, staged, effect, turn_number, call_id)
                    if event is None:
                        already.append(receipt["clue"])
                        receipt_ids.append(receipt["id"])
                        continue
                else:
                    time_effects += 1
                    receipt, event = self._stage_time(staged, effect, turn_number, ordinal, call_id, time_effects)
                receipts.append(receipt)
                receipt_ids.append(receipt["id"])
                events.append((event[0], event[1], receipt["id"]))
            except RpcError as exc:
                exc.details = {"index": index, **(exc.details or {})}
                raise

        campaign.write_world(staged)
        turn["receipts"].extend(receipts)
        turn["state"] = "acting"
        result: dict[str, Any] = {"receipts": receipt_ids,
                                  "world": {"active_scene": staged["active_scene"], "clock": staged["clock"]},
                                  "material_ready": True}
        if any(r.get("kind") == "move" for r in receipts):
            # The destination as `look focus=scene` would show it, so the keeper need not
            # look again after moving.
            result.update(self._scene_view(campaign, graph, staged, turn, graph.scene(staged["active_scene"])))
        if already:
            result["already_discovered"] = already
            if not receipts:
                result["replayed"] = True
        Campaign.remember_call(turn, call_id, params, result)
        campaign.write_turn(turn)
        for event_type, data, receipt_id in events:
            append_event(campaign, turn_number, event_type, data, call_id=call_id, receipt=receipt_id)
        return result

    def _stage_move(self, graph: ModuleGraph, world: dict[str, Any], effect: dict[str, Any],
                    turn_number: int, ordinal: int, call_id: str) -> tuple[dict[str, Any], tuple[str, dict[str, Any]]]:
        to = _str(effect, "to")
        current = graph.scene(world["active_scene"])
        exits = {e["to"]: e for e in graph.scene_exits(current)}
        destination = graph.scene(to)
        dest_handle = graph.handle(destination)
        if dest_handle not in exits:
            raise RpcError("not_reachable", f"{dest_handle!r} is not reachable from {graph.handle(current)!r}",
                           fix="move to one of details.exits first",
                           details={"from": graph.handle(current), "to": dest_handle,
                                    "exits": sorted(exits)})
        minutes = effect.get("travel_minutes")
        if minutes is None:
            minutes = exits[dest_handle].get("travel_minutes", 0)
        if not isinstance(minutes, int) or isinstance(minutes, bool) or minutes < 0:
            raise invalid_params("travel_minutes must be a non-negative integer")
        label = effect.get("label") if isinstance(effect.get("label"), str) and effect.get("label").strip() else None
        receipt = {"id": f"move:{dest_handle}-t{turn_number}-c{ordinal}", "kind": "move",
                   "call_id": call_id, "from": graph.handle(current), "to": dest_handle,
                   "from_label": graph.display_name(current), "to_label": label or graph.display_name(destination),
                   "minutes": minutes, "at": now_iso()}
        world["active_scene"] = dest_handle
        if dest_handle not in world.setdefault("visited_scenes", []):
            world["visited_scenes"].append(dest_handle)
        world.setdefault("clock", {"minutes": 0})["minutes"] = int(world["clock"].get("minutes", 0)) + minutes
        return receipt, ("scene-moved", {"from": receipt["from"], "to": dest_handle, "minutes": minutes})

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
        campaign.write_turn_record({
            "turn": turn_number, "player_text": turn.get("player_text"), "receipts": turn.get("receipts", []),
            "text": text or prompt, "rendered_text": rendered, "calls": turn.get("calls", {}), "commit": None,
            "closed_by": "ask", "opened_at": turn.get("opened_at"), "closed_at": now_iso(),
            "pending_choice": pending,
        })
        campaign.write_turn(turn)
        campaign.append_transcript(turn_number, "keeper", rendered)
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
        result: dict[str, Any] = {"rendered_text": rendered, "turn": turn_number,
                                  "receipt": receipt_id, "commit": None}

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
            "closed_at": now_iso(), "pending_choice": turn.get("pending_choice"),
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
        return {**result, "commit": sha}
