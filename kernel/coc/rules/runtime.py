"""Wiring between the campaign store and the RuleGraph runtime. Ported from the old
coc_operation_kernel.py (`_facts_provider_for`, `_rules_runtime_for_ctx`,
`_latest_graph_check_receipt`, the social/psychology/magic/development bindings),
re-cut against the kernel: prior receipts come from `turn.json` and
`turns/NNNN.json`, snapshots from `save/`, and the party sheet is the sheet."""

from __future__ import annotations

import random
from pathlib import Path
from typing import Any, Callable, Mapping

from ..errors import RpcError
from ..fileio import read_json, write_json_atomic
from ..module_graph import NPC_KIND, ModuleGraph, record_of
from ..sessions import SessionView
from ..store import Campaign, now_iso
from ..text import kebab, normalize
from . import development, magic, rule_options
from .adapter import Coc7RuleGraphAdapter
from .catalog import Catalog, module_spell_records
from .graph import GraphLoadError, RulesRuntime, facts_from_state, load_ruleset_graph
from .healing import establish_damage_wound, read_healing_state, write_healing_state
from .resolver import Resolver
from .skills import SkillResolver
from .tables import RuleTables

RESOURCE_LABELS_ZH = {"hp": "生命值", "san": "理智", "mp": "魔法值", "luck": "幸运", "armor": "护甲", "ammo": "弹药",
                      "cash": "现金"}
SOCIAL_SKILLS = ("Charm", "Fast Talk", "Intimidate", "Persuade")


class RulesEngine:
    """Content-side singletons: rule tables, resolver, catalog and the loaded RuleGraph."""

    def __init__(self, content_dir: Path, tables: RuleTables) -> None:
        self.content = Path(content_dir)
        self.tables = tables
        self.resolver = Resolver(tables)
        self.catalog = Catalog(tables)
        self.ruleset_dir = self.content / "rulesets" / "coc7"
        self._loaded: dict[str, Any] | None = None

    def load(self) -> dict[str, Any]:
        if self._loaded is None:
            try:
                self._loaded = load_ruleset_graph(self.ruleset_dir)
            except GraphLoadError as exc:
                raise RpcError("campaign_not_ready", f"the coc7 rule graph is not loadable ({exc.reason})",
                               details={"findings": exc.findings})
        return self._loaded

    @property
    def graph(self) -> dict[str, Any]:
        return self.load()["graph"]

    @property
    def graph_manifest(self) -> dict[str, Any]:
        return self.load()["graph_manifest"]

    @property
    def package_manifest(self) -> dict[str, Any]:
        return self.load()["package_manifest"]

    def runtime(self, ctx: "SettleContext", *, intent: str | None,
                adapter: Coc7RuleGraphAdapter | None = None) -> RulesRuntime:
        loaded = self.load()
        adapter = adapter or Coc7RuleGraphAdapter(ctx)
        runtime = RulesRuntime(
            loaded["graph"], ruleset_id="coc7", graph_manifest=loaded["graph_manifest"], campaign_id=ctx.campaign_id,
            facts_provider=facts_provider(ctx, self, intent), resolver_index=self.resolver_index(),
            ruleset_adapter=adapter, optional_rules_provider=optional_rules_provider(ctx, self),
            grant_context_provider=lambda: {"player_turn_epoch": ctx.turn_number, "stage": "acting"},
        )
        return runtime

    def resolver_index(self) -> dict[str, Any]:
        from .executors import EXECUTORS
        index = dict(self.resolver.public_api_index())
        for name in EXECUTORS:
            index.setdefault(name, {"returns": "kernel executor"})
        return index

    def rule_nodes(self) -> list[dict[str, Any]]:
        return [n for n in self.graph.get("nodes") or [] if n.get("node_kind") == "rule"]


def optional_rules_provider(ctx: "SettleContext", engine: RulesEngine) -> Callable[[], Mapping[str, Mapping[str, Any]]]:
    def provider() -> Mapping[str, Mapping[str, Any]]:
        try:
            effective = rule_options.campaign_effective_optional_rules(ctx.campaign_dir, engine.package_manifest)
        except rule_options.OptionalRuleError as exc:
            raise RpcError("campaign_not_ready", str(exc))
        return rule_options.disabled_decision_gates(engine.package_manifest, effective)
    return provider


# ---- the settlement context -----------------------------------------------------------

class SettleContext:
    """What executors and the adapter may read and write during one resolve."""

    def __init__(self, engine: RulesEngine, campaign: Campaign, graph: ModuleGraph, world: dict[str, Any],
                 turn: dict[str, Any], call_id: str, ordinal: int, rng: random.Random, actor: dict[str, Any],
                 subject: dict[str, Any], action: Mapping[str, Any]) -> None:
        self.engine = engine
        self.tables = engine.tables
        self.resolver = engine.resolver
        self.catalog = engine.catalog
        self.campaign = campaign
        self.campaign_dir = campaign.dir
        self.campaign_id = campaign.id
        self.graph = graph
        self.world = world
        self.turn = turn
        self.turn_number = int(turn["turn"])
        self.call_id = call_id
        self.ordinal = ordinal
        self.rng = rng
        self.actor = actor
        self.actor_id = str(actor["id"])
        self.subject = subject
        self.subject_id = str(subject["id"])
        self.action = action
        self.module_spells = module_spell_records(graph)
        self.receipts: list[dict[str, Any]] = []
        self.effects: list[dict[str, Any]] = []
        self._ids: set[str] = set()

    @staticmethod
    def module_spells_for(graph: ModuleGraph) -> list[dict[str, Any]]:
        return module_spell_records(graph)

    # -- clock / scene ---------------------------------------------------------

    @property
    def clock_minutes(self) -> int:
        return int((self.world.get("clock") or {}).get("minutes", 0))

    @property
    def active_scene(self) -> str:
        return str(self.world.get("active_scene"))

    # -- party -----------------------------------------------------------------

    def party(self) -> list[dict[str, Any]]:
        return self.campaign.party()

    def party_names(self) -> list[str]:
        return [str(s.get("name") or s.get("id")) for s in self.party()]

    def sheet_by_id(self, investigator_id: str | None) -> dict[str, Any] | None:
        if not investigator_id:
            return None
        key = normalize(str(investigator_id))
        for sheet in self.party():
            if key in {normalize(str(sheet.get("id"))), normalize(str(sheet.get("name")))}:
                return sheet
        return None

    def write_sheet(self, sheet: dict[str, Any]) -> None:
        self.campaign.write_sheet(sheet)
        if str(sheet.get("id")) == self.actor_id:
            self.actor = sheet
        if str(sheet.get("id")) == self.subject_id:
            self.subject = sheet

    def skill_value(self, sheet: Mapping[str, Any] | None, skill_name: str) -> int | None:
        return self.resolver.actor_skill_value(dict(sheet) if sheet else None, skill_name)

    def sync_healing(self, investigator_id: str, current_hp: int, conditions: list[str]) -> None:
        sheet = self.sheet_by_id(investigator_id)
        if sheet is None:
            return
        sheet["current_hp"] = current_hp
        sheet["conditions"] = list(conditions)
        self.write_sheet(sheet)

    def record_wound(self, investigator_id: str, *, source: str | None) -> None:
        state = read_healing_state(self.campaign_dir, investigator_id)
        establish_damage_wound(state, decision_id=self.call_id, occurred_elapsed_minutes=self.clock_minutes,
                               source_damage_roll_id=source)
        state["investigator_id"] = investigator_id
        write_healing_state(self.campaign_dir, investigator_id, state)

    def minutes_since_injury(self) -> int | None:
        state = read_healing_state(self.campaign_dir, self.subject_id)
        active = [int(r["occurred_elapsed_minutes"]) for r in state.get("wound_ledger") or []
                  if isinstance(r, dict) and r.get("status") == "active" and isinstance(r.get("occurred_elapsed_minutes"), int)]
        if not active:
            return None
        return max(0, self.clock_minutes - max(active))

    # -- session engines -> sheet ---------------------------------------------------

    def mirror_investigator(self, investigator_id: str, *, current_hp: int | None = None, current_mp: int | None = None,
                            current_san: int | None = None, conditions: list[str] | None = None,
                            wounds: list[str] | None = None) -> None:
        """Write an engine's view of an investigator back onto the sheet (and the healing
        snapshot, whose `current_hp` / `conditions` the healing family reads)."""
        sheet = self.sheet_by_id(investigator_id)
        if sheet is None:
            return
        if current_hp is not None:
            sheet["current_hp"] = int(current_hp)
        if current_mp is not None:
            sheet["current_mp"] = int(current_mp)
        if current_san is not None:
            sheet["current_san"] = int(current_san)
        if conditions is not None:
            sheet["conditions"] = list(conditions)
        self.write_sheet(sheet)
        if current_hp is None and conditions is None and not wounds:
            return
        state = read_healing_state(self.campaign_dir, investigator_id)
        for source in wounds or []:
            establish_damage_wound(state, decision_id=f"{self.call_id}-{kebab(source)}",
                                   occurred_elapsed_minutes=self.clock_minutes, source_damage_roll_id=source)
        if not state and not wounds:
            return
        state["investigator_id"] = investigator_id
        if current_hp is not None:
            state["current_hp"] = int(current_hp)
        if conditions is not None:
            state["conditions"] = list(conditions)
        write_healing_state(self.campaign_dir, investigator_id, state)

    def sync_combatants(self, session: Any, *, concluded: bool) -> None:
        """Every investigator in a CombatSession: HP, MP and conditions (transient combat
        conditions drop once the fight is over); each new landed hit becomes a wound."""
        for actor_id, participant in session.participants.items():
            if self.sheet_by_id(actor_id) is None:
                continue
            conditions = [c for c in participant.get("conditions") or []
                          if not (concluded and c in {"prone", "grappled", "surprised", "outnumbered", "fled"})]
            known = {r.get("source_damage_roll_id") for r in read_healing_state(self.campaign_dir, actor_id).get("wound_ledger") or []
                     if isinstance(r, dict)}
            wounds = []
            for damage in session.damage_chain:
                source = damage.get("damage_roll_id") if isinstance(damage, dict) else None
                if (damage.get("target_actor_id") != actor_id or not isinstance(source, str) or source in known
                        or int(damage.get("raw_damage", 0)) - int(damage.get("armor_absorbed", 0)) <= 0):
                    continue
                wounds.append(source)
            self.mirror_investigator(actor_id, current_hp=int(participant["hp_current"]),
                                     current_mp=int(participant.get("magic_points") or 0), conditions=conditions, wounds=wounds)

    def sync_chase_participants(self, session: Any) -> None:
        for actor_id, participant in session.participants.items():
            if self.sheet_by_id(actor_id) is None:
                continue
            self.mirror_investigator(actor_id, current_hp=int(participant.get("hp") or 0))

    def sync_sanity(self, session: Any) -> None:
        self.mirror_investigator(session.investigator_id, current_san=int(session.san_current))

    # -- module graph ----------------------------------------------------------

    def npc_node(self, handle: str) -> dict[str, Any] | None:
        return self.graph.find(handle, (NPC_KIND,))

    def npc_profile(self, handle: str) -> dict[str, Any] | None:
        node = self.npc_node(handle)
        if node is None:
            return None
        mechanics = record_of(node).get("mechanics")
        profile = mechanics.get("profile") if isinstance(mechanics, dict) else None
        return profile if isinstance(profile, dict) else None

    def npc_skill_labels(self, ref: str) -> list[str]:
        parts = str(ref).split(":")
        profile = self.npc_profile(parts[1]) if len(parts) >= 2 else None
        if not profile:
            return []
        return sorted(str(k) for table in ("skills", "characteristics")
                      for k, v in (profile.get(table) or {}).items() if isinstance(v, int))

    def present_npc_names(self) -> list[str]:
        presence = self.world.get("npc_presence") or {}
        return sorted(handle for handle, at in presence.items() if at == self.active_scene)

    def sessions(self) -> SessionView:
        return SessionView(self.campaign_dir, self.graph, self.party(), self.world)

    def discovered_clue_names(self) -> list[str]:
        return list(self.world.get("discovered_clues") or [])

    def magic_learning_sources(self) -> dict[str, list[str]]:
        """`<kind>:<handle>` -> spells that source can teach. An NPC whose authored profile
        carries spells is a `person` source; a module `tome`/`creature` node listing spells
        in its properties is a `tome`/`entity` source. Possession is not a source."""
        sources: dict[str, list[str]] = {}
        for node in self.graph.by_kind.get(NPC_KIND, []):
            mechanics = record_of(node).get("mechanics")
            profile = mechanics.get("profile") if isinstance(mechanics, dict) else None
            spells = profile.get("spells") if isinstance(profile, dict) else None
            if isinstance(spells, list) and spells:
                sources[f"person:{self.graph.handle(node)}"] = [str(s) for s in spells if isinstance(s, str)]
        for kind, prefix in (("tome", "tome"), ("creature", "entity")):
            for node in self.graph.by_kind.get(kind, []):
                spells = (node.get("properties") or {}).get("spells") or record_of(node).get("spells")
                if isinstance(spells, list) and spells:
                    sources[f"{prefix}:{self.graph.handle(node)}"] = [str(s) for s in spells if isinstance(s, str)]
        return sources

    # -- catalog ---------------------------------------------------------------

    def canonical_spell_name(self, name: str) -> str:
        return magic.canonical_spell_name(self.tables, self.catalog, name, module_spells=self.module_spells)

    def spell_candidates(self, name: str) -> list[str]:
        result = self.catalog.search(name or "spell", kinds=["spell"], limit=8, module_spells=self.module_spells)
        return [str(c.get("name")) for c in result.get("candidates") or []] if result.get("ok") else []

    # -- save/ documents ------------------------------------------------------------

    def read_save(self, name: str) -> Any:
        path = self.campaign_dir / "save" / name
        return read_json(path) if path.exists() else None

    def write_save(self, name: str, data: Any) -> None:
        write_json_atomic(self.campaign_dir / "save" / name, data)

    def luck_recovery_gate(self) -> dict[str, Any] | None:
        effective = rule_options.campaign_effective_optional_rules(self.campaign_dir, self.engine.package_manifest)
        gate = rule_options.gate_for(self.engine.package_manifest, effective, settlement="development.luck_recovery")
        if gate is not None and gate.get("conflict"):
            raise RpcError("campaign_not_ready", rule_options.gate_message(gate))
        return gate

    # -- receipts -----------------------------------------------------------------

    def all_receipts(self) -> list[dict[str, Any]]:
        """Closed turns oldest first, then the open turn, then this call's new receipts."""
        rows: list[dict[str, Any]] = []
        for record in self.campaign.closed_turns():
            rows.extend(r for r in record.get("receipts") or [] if isinstance(r, dict))
        rows.extend(r for r in self.turn.get("receipts") or [] if isinstance(r, dict))
        rows.extend(self.receipts)
        return rows

    def receipt_continued(self, receipt_id: str) -> bool:
        return any(r.get("source_receipt") == receipt_id for r in self.all_receipts())

    def mark_receipt_continued(self, receipt_id: str, kind: str) -> None:
        for receipt in list(self.turn.get("receipts") or []) + self.receipts:
            if receipt.get("id") == receipt_id:
                receipt["continued_by"] = kind

    def _mint(self, base: str) -> str:
        candidate = base
        n = 2
        while candidate in self._ids or any(r.get("id") == candidate for r in self.turn.get("receipts") or []):
            candidate = f"{base}-{n}"
            n += 1
        self._ids.add(candidate)
        return candidate

    def add_roll(self, *, actor: str, skill: str, target: int, difficulty: str, threshold: int, roll: int, level: str,
                 passed: bool, bonus: int = 0, penalty: int = 0, visibility: str = "public", kind: str = "skill_check",
                 pushed: bool = False, source_receipt: str | None = None, check: dict[str, Any] | None = None,
                 skill_label: str | None = None, **extra: Any) -> str:
        actor_is_investigator = self.sheet_by_id(actor) is not None
        base = f"roll:{kebab(skill)}" + ("" if actor_is_investigator else f"-{kebab(actor)}") + f"-t{self.turn_number}-c{self.ordinal}"
        receipt_id = self._mint(base)
        rule_refs = list((check or {}).get("rule_refs") or [])
        receipt = {"id": receipt_id, "kind": "roll", "call_id": self.call_id, "actor": actor, "skill": skill,
                   "skill_label": skill_label or self.skill_label(skill), "target": int(target), "difficulty": difficulty,
                   "threshold": int(threshold), "roll": int(roll), "level": level, "passed": bool(passed),
                   "bonus": int(bonus), "penalty": int(penalty), "visibility": visibility, "roll_kind": kind,
                   "pushed": bool(pushed), "rule_refs": rule_refs, "at": now_iso(), **extra}
        if not actor_is_investigator:
            receipt["actor_label"] = self.graph.display_name(node) if (node := self.npc_node(actor)) else actor
        if source_receipt:
            receipt["source_receipt"] = source_receipt
        if check is not None:
            receipt["check"] = {k: v for k, v in check.items() if k != "rule_refs"}
            receipt["check"]["roll_id"] = receipt_id
        self.receipts.append(receipt)
        return receipt_id

    def add_dice_roll(self, *, actor: str, label: str, expression: Any, faces: list[int], total: Any,
                      skill_label: str | None = None, **extra: Any) -> str:
        """`label` names the die in the receipt id (ASCII engine vocabulary); `skill_label`
        is what the mechanics line prints."""
        receipt_id = self._mint(f"roll:{kebab(label) or 'dice'}-t{self.turn_number}-c{self.ordinal}")
        receipt = {"id": receipt_id, "kind": "roll", "form": "dice", "call_id": self.call_id, "actor": actor,
                   "skill": label, "skill_label": skill_label or label, "expression": expression, "faces": list(faces),
                   "total": total, "visibility": "public", "at": now_iso(), **extra}
        if self.sheet_by_id(actor) is None:
            receipt["actor_label"] = self.graph.display_name(node) if (node := self.npc_node(actor)) else actor
        self.receipts.append(receipt)
        return receipt_id

    def add_session_receipt(self, family: str, transition: str, *, outcome: str | None = None,
                            summary: str | None = None) -> str:
        """A session entered or ended (contract §11.6: 【变化】战斗开始 / 战斗结束：<outcome>)."""
        receipt_id = self._mint(f"session:{family}-{transition}-t{self.turn_number}-c{self.ordinal}")
        self.receipts.append({"id": receipt_id, "kind": "session", "call_id": self.call_id, "family": family,
                              "transition": transition, "outcome": outcome, "summary": summary, "at": now_iso()})
        return receipt_id

    def subject_label(self, subject: str) -> str:
        subject_sheet = self.sheet_by_id(subject)
        if subject_sheet is not None:
            return str(subject_sheet.get("name") or subject)
        node = self.npc_node(subject)
        return self.graph.display_name(node) if node else str(subject)

    def add_delta(self, resource: str, subject: str, before: Any, after: Any, *,
                  source_receipt: str | None = None, **extra: Any) -> str:
        receipt_id = self._mint(f"delta:{resource}-t{self.turn_number}-c{self.ordinal}")
        label = RESOURCE_LABELS_ZH.get(resource, resource)
        subject_label = self.subject_label(subject)
        receipt = {"id": receipt_id, "kind": "delta", "call_id": self.call_id, "resource": resource,
                   "subject": subject, "subject_label": subject_label, "label": label, "before": before,
                   "after": after, **extra, "at": now_iso()}
        if source_receipt:
            receipt["source_receipt"] = source_receipt
        self.receipts.append(receipt)
        self.effects.append({"kind": resource, "subject": subject, "before": before, "after": after, **extra})
        return receipt_id

    def add_effect(self, kind: str, subject: str, before: Any, after: Any, **extra: Any) -> None:
        self.effects.append({"kind": kind, "subject": subject, "before": before, "after": after, **extra})

    def skill_label(self, skill: str) -> str:
        try:
            return SkillResolver(self.tables, self.actor).display_label(skill)
        except Exception:  # noqa: BLE001 - a label is decoration
            return skill


# ---- facts --------------------------------------------------------------------------

def facts_provider(ctx: SettleContext, engine: RulesEngine, intent: str | None) -> Callable[[], Mapping[str, Any]]:
    def provider() -> Mapping[str, Any]:
        sheet = ctx.sheet_by_id(ctx.subject_id) or ctx.subject
        healing = read_healing_state(ctx.campaign_dir, ctx.subject_id)
        conditions = healing.get("conditions") if isinstance(healing.get("conditions"), list) else sheet.get("conditions") or []
        state = {
            "investigator_id": ctx.subject_id, "current_hp": sheet.get("current_hp"), "current_san": sheet.get("current_san"),
            "current_mp": sheet.get("current_mp"), "current_luck": sheet.get("current_luck"), "conditions": list(conditions),
            "wound_ledger": healing.get("wound_ledger") or [],
            "major_wound_recovery_ledger": healing.get("major_wound_recovery_ledger") or [],
        }
        facts = facts_from_state(state, sheet, ruleset_id="coc7", elapsed_minutes=ctx.clock_minutes)
        facts["campaign.ruleset_version"] = str(engine.graph_manifest.get("ruleset_version") or "1.0.0")
        facts["scene.id"] = ctx.active_scene
        facts["time.day"] = ctx.clock_minutes // (24 * 60)
        if intent:
            facts["intent.action_kind"] = intent
        # Session facts (11.2): from the engine snapshots under save/, read fresh each time.
        facts.update(ctx.sessions().facts(ctx.subject_id, ctx.clock_minutes))
        magic_state = magic.read_magic_state(ctx.campaign_dir, ctx.subject_id)
        facts["magic.known_spells"] = magic.known_spells(magic_state, ctx.clock_minutes)
        facts["magic.learn.sources"] = ctx.magic_learning_sources()
        facts["magic.spell.module_namespace"] = ctx.module_spells
        facts["development.settlement.pending"] = any(inv == ctx.subject_id
                                                      for _, inv in development.pending_settlements(ctx.campaign_dir))
        return facts
    return provider


# ---- prior receipts (push / luck) -------------------------------------------------------

_CONTINUABLE_ROLL_KINDS = frozenset({"skill_check", "characteristic_check"})


def latest_check_receipt(ctx: SettleContext) -> tuple[str, dict[str, Any]] | None:
    """The actor's most recent D100 check receipt: the source a push or a Luck spend binds
    to. Opposed, combined, concealed and dice rolls are never continuable."""
    for receipt in reversed(ctx.all_receipts()):
        if receipt.get("kind") != "roll" or receipt.get("form") == "dice":
            continue
        if receipt.get("actor") != ctx.actor_id or receipt.get("visibility") == "keeper":
            continue
        if receipt.get("roll_kind") not in _CONTINUABLE_ROLL_KINDS:
            continue
        check = receipt.get("check")
        if not isinstance(check, dict):
            continue
        return str(receipt["id"]), {**check, "roll_id": receipt["id"], "pushed": bool(receipt.get("pushed")),
                                    "continued_by": receipt.get("continued_by")}
    return None


# ---- bindings ---------------------------------------------------------------------------

def npc_social_defense(ctx: SettleContext, node: dict[str, Any], approach_skill: str | None) -> int | None:
    """The higher of the NPC's authored Psychology and the approach skill; None when the
    profile authors neither (the resolver then defaults the base difficulty to regular)."""
    profile = ctx.npc_profile(ctx.graph.handle(node)) or {}
    skills = profile.get("skills") if isinstance(profile.get("skills"), dict) else {}
    values = [int(v) for k, v in skills.items() if isinstance(v, int) and str(k) in ("Psychology", approach_skill)]
    return max(values) if values else None


def npc_opposing_social(ctx: SettleContext, node: dict[str, Any]) -> int | None:
    profile = ctx.npc_profile(ctx.graph.handle(node)) or {}
    skills = profile.get("skills") if isinstance(profile.get("skills"), dict) else {}
    values = [int(v) for k, v in skills.items() if isinstance(v, int) and str(k) in SOCIAL_SKILLS]
    return max(values) if values else None


def motive_evidence(ctx: SettleContext, node: dict[str, Any]) -> list[str]:
    """Structural: the NPC record's agenda and secret lines, by exact NPC identity."""
    record = record_of(node)
    handle = ctx.graph.handle(node)
    refs = []
    if isinstance(record.get("agenda"), str) and record["agenda"].strip():
        refs.append(f"npc_agenda:{handle}")
    if isinstance(record.get("secret"), str) and record["secret"].strip():
        refs.append(f"npc_secret:{handle}")
    return refs or [f"npc:{handle}"]


def social_binding(ctx: SettleContext, node: dict[str, Any], approach_skill: str | None) -> dict[str, Any]:
    handle = ctx.graph.handle(node)
    return {
        "target_ref": f"social-target:{handle}", "npc_id": handle,
        "conversation_window_id": f"turn {ctx.turn_number}",
        "commitment_id": f"commitment:{handle}-t{ctx.turn_number}",
        "motive_evidence": motive_evidence(ctx, node),
        "npc_defense": npc_social_defense(ctx, node, approach_skill),
    }


def observable_fact_refs(ctx: SettleContext, node: dict[str, Any]) -> list[str]:
    handle = ctx.graph.handle(node)
    refs = []
    for fact in record_of(node).get("facts") or []:
        clue_id = fact.get("clue_id") if isinstance(fact, dict) else None
        if isinstance(clue_id, str) and clue_id in ctx.graph.nodes:
            refs.append(f"npc_fact:{handle}/{ctx.graph.handle(ctx.graph.nodes[clue_id])}")
    return refs or [f"npc_agenda:{handle}"]


def psychology_binding(ctx: SettleContext, node: dict[str, Any], question: str) -> dict[str, Any]:
    handle = ctx.graph.handle(node)
    observer_skill = ctx.actor.get("skills", {}).get("Psychology")
    return {
        "investigator_id": ctx.actor_id, "npc_id": handle, "conversation_window_id": f"turn {ctx.turn_number}",
        "observation_revision": 0, "observer_scope": ctx.actor_id,
        "observable_fact_refs": observable_fact_refs(ctx, node), "question": question,
        "observer_skill": int(observer_skill) if isinstance(observer_skill, int) else None,
        "target_opposing_social": npc_opposing_social(ctx, node),
    }


def psychology_realize_binding(ctx: SettleContext, node: dict[str, Any]) -> dict[str, Any] | None:
    """The latest settled observation of this NPC by this actor, if any."""
    handle = ctx.graph.handle(node)
    document = ctx.read_save("psychology-observations.json") or {}
    rows = [row for row in (document.get("observations") or {}).values()
            if isinstance(row, dict) and row.get("npc_id") == handle and row.get("investigator_id") == ctx.actor_id]
    if not rows:
        return None
    latest = sorted(rows, key=lambda r: str(r.get("created_at") or ""))[-1]
    return {
        "investigator_id": ctx.actor_id, "npc_id": handle,
        "conversation_window_id": latest.get("conversation_window_id"),
        "observation_revision": latest.get("observation_revision", 0), "observer_scope": latest.get("observer_scope"),
        "observable_fact_refs": list(latest.get("observable_fact_refs") or []), "question": latest.get("question"),
        "inference_ceiling": latest.get("inference_depth"), "observation_receipt_ref": latest.get("insight_id"),
    }


def magic_binding(ctx: SettleContext, decision_ref: str, semantic: Mapping[str, Any]) -> dict[str, Any]:
    spell = ctx.canonical_spell_name(str(semantic.get("spell") or ""))
    if decision_ref.endswith(":cast-spell"):
        return {"investigator": ctx.actor_id, "is_npc": False, "decision_id": ctx.call_id,
                "known_spell_ref": f"learned-spell:{ctx.actor_id}:{kebab(spell)}"}
    return {"investigator": ctx.actor_id, "decision_id": ctx.call_id}


def development_binding(ctx: SettleContext, decision_ref: str) -> dict[str, Any]:
    binding: dict[str, Any] = {"investigator": ctx.actor_id, "decision_id": ctx.call_id}
    if decision_ref.endswith(":settle-ending"):
        pending = [e for e, inv in development.pending_settlements(ctx.campaign_dir) if inv == ctx.actor_id]
        if pending:
            binding["ending_id"] = pending[-1]
    return binding
