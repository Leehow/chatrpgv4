"""The `table.resolve` pipeline (contract §11): facts -> candidates and selection -> slots
-> execution -> result and receipts.

`table.py` owns the turn state machine and commits what this module returns; this
module owns how one `action` becomes one RuleGraph decision and one settlement."""

from __future__ import annotations

import random
from typing import Any, Mapping

from .errors import RpcError, invalid_params, not_implemented
from .module_graph import NPC_KIND, ModuleGraph
from .rules import CHARACTERISTICS, SkillResolver
from .rules.adapter import (CAST_SPELL_REF, COMBINED_CHECK_REF, END_SESSION_REF, LEARN_SPELL_REF, LUCK_SPEND_REF,
                            OPPOSED_CHECK_REF, ORDINARY_CHECK_REF, PSYCHOLOGY_OBSERVE_REF, PSYCHOLOGY_REALIZE_REF,
                            PUSHED_ROLL_REF, SETTLE_ENDING_REF, SOCIAL_REF, Coc7RuleGraphAdapter)
from .rules.combat import VALID_OUTCOMES as COMBAT_OUTCOMES
from .rules.development import record_skill_tick
from .rules.executors import EXECUTORS, run as run_executor
from .rules.graph import semantic_name, thaw
from .rules.resolver import SOCIAL_APPROACH_SKILLS, validate_san_loss_expression
from .rules.runtime import (RESOURCE_LABELS_ZH, RulesEngine, SettleContext, development_binding, latest_check_receipt,
                            magic_binding, psychology_binding, psychology_realize_binding, social_binding)
from .rules.sanity import INVOLUNTARY_KINDS
from .sessions import (SessionView, bout_active, chase_active, chase_location_chain, chase_participant_from_combat_spec,
                       combat_active, combat_operation_for, defense_options, investigator_combat_participant,
                       npc_combat_participant, npc_profile, npc_san_loss, parse_san_loss, resolve_investigator_weapon,
                       weapon_options)
from .store import Campaign
from .text import kebab, normalize, normalize_text

DECISION_PREFIX = "decision:coc7:"
HEALING_SKILLS = {"First Aid", "Medicine"}
SESSION_FAMILIES = frozenset({"combat", "chase", "sanity"})
APPROACH_BY_SKILL = {skill: approach for approach, skill in SOCIAL_APPROACH_SKILLS.items()}

COMBAT_ATTACK_REF = "decision:coc7:combat:attack"
COMBAT_DEFEND_REF = "decision:coc7:combat:defend"
COMBAT_FLEE_REF = "decision:coc7:combat:flee"
CHASE_START_REF = "decision:coc7:chase:start"
SANITY_CHECK_REF = "decision:coc7:sanity:check"
SANITY_BOUT_REFS = ("decision:coc7:sanity:bout-tick", "decision:coc7:sanity:bout-end")
#: The kernel's own vocabulary for the SAN resource (the zh label the mechanics block
#: prints plus the rulebook's names): `stakes` naming it offers `sanity:check` (§11.5).
SAN_TERMS = ("san", "sanity", RESOURCE_LABELS_ZH["san"])

#: Which `action` field fills each keeper-semantic slot (contract §11.4). Used to tell
#: the keeper what a continuation or a missing slot needs, in `action` vocabulary.
SLOT_TO_ACTION = {
    "skill": "skill", "characteristic": "skill", "combined_target_refs": "skills", "combined_mode": "mode",
    "difficulty": "modifiers.difficulty", "bonus": "modifiers.bonus_dice", "penalty": "modifiers.penalty_dice",
    "goal": "goal", "stakes": "stakes", "difficulty_basis": "stakes", "target_ref": "target", "npc_id": "target",
    "target_npc_id": "target", "approach": "method", "described_action": "method", "commitment_ref": "goal",
    "motive_direction": "motive", "motive_intensity": "motive", "supporting_action": "support", "feasibility": "goal",
    "question": "goal", "external_behavior": "method", "spell": "spell", "source": "target", "source_ref": "target",
    "pushed": "push", "interrupted": "interrupted", "method_changed": "method", "failure_consequence": "stakes",
    "player_confirmed_risk": "push", "points": "luck", "rescuer_ref": "actor", "assistant_rescuer_ref": "target",
    "changed_method": "method", "complete_rest": "rest", "poor_environment": "rest", "summary": "goal",
    "kind": "ending", "weapon_ref": "weapon", "weapon_id": "weapon", "defense_kind": "defense",
    "actor_check_ref": "skill", "opponent_check_ref": "target", "candidate_ref": "target", "outcome": "outcome",
    "loss_failure": "san_loss", "loss_success": "san_loss", "involuntary_kind": "involuntary",
    "involuntary_summary": "involuntary", "trigger_ref": "trigger", "gain_source": "goal", "insight": "goal",
    "request_reality_check": "goal", "pursuer_refs": "target", "quarry_refs": "actor", "location_refs": "goal",
    "method": "method",
}


def full_decision_ref(name: str) -> str:
    name = str(name).strip()
    return name if name.startswith("decision:") else DECISION_PREFIX + name


def continuation_entry(runtime: Any, decision_ref: str) -> dict[str, Any]:
    name = semantic_name(decision_ref)
    if decision_ref == PUSHED_ROLL_REF:
        fields = ["push", "stakes", "method"]
    elif decision_ref == LUCK_SPEND_REF:
        fields = ["luck"]
    else:
        fields = ["decision"]
        for slot in runtime.required_semantic_slots(decision_ref):
            field = SLOT_TO_ACTION.get(slot)
            if field and field not in fields:
                fields.append(field)
    node = runtime.nodes.get(decision_ref) or {}
    return {"decision": name, "action": fields, "when": node.get("name")}


class ResolvePipeline:
    def __init__(self, engine: RulesEngine, campaign: Campaign, graph: ModuleGraph, world: dict[str, Any],
                 turn: dict[str, Any], call_id: str, ordinal: int, action: Mapping[str, Any], rng: random.Random,
                 actor_lookup: Any, modifiers: tuple[int, int, str]) -> None:
        self.engine = engine
        self.modifiers = modifiers
        self.campaign = campaign
        self.graph = graph
        self.world = world
        self.turn = turn
        self.call_id = call_id
        self.ordinal = ordinal
        self.action = action
        self.rng = rng
        self.actor_lookup = actor_lookup
        self.intent = str(action.get("intent"))
        self.goal = action.get("goal") if isinstance(action.get("goal"), str) else ""
        self.method = action.get("method") if isinstance(action.get("method"), str) else ""
        self.stakes = action.get("stakes") if isinstance(action.get("stakes"), str) else ""
        #: The NPC the keeper acts as (`action.actor` naming an NPC inside a session).
        self.npc_actor: str | None = None
        self.sessions: SessionView | None = None

    # ---- validation ---------------------------------------------------------------

    def _validate_extras(self) -> None:
        action = self.action
        if action.get("push") is not None and not isinstance(action.get("push"), bool):
            raise invalid_params("action.push must be a boolean")
        luck = action.get("luck")
        if luck is not None and (isinstance(luck, bool) or not isinstance(luck, int) or luck <= 0):
            raise invalid_params("action.luck must be a positive integer")
        if action.get("push") and luck is not None:
            raise invalid_params("push or spend Luck, but not both", fix="send either push: true or luck: <points>")
        for key in ("spell", "weapon", "target", "decision", "actor", "ending", "interrupted", "outcome", "san_loss",
                    "trigger"):
            value = action.get(key)
            if value is not None and key != "interrupted" and (not isinstance(value, str) or not value.strip()):
                raise invalid_params(f"action.{key} must be a non-empty string")
        if action.get("interrupted") is not None and not isinstance(action.get("interrupted"), bool):
            raise invalid_params("action.interrupted must be a boolean")
        if action.get("defense") is not None and action.get("defense") not in ("dodge", "fight_back", "none"):
            raise invalid_params("action.defense must be dodge, fight_back or none")
        if action.get("san_loss") is not None and parse_san_loss(action["san_loss"]) is None:
            raise invalid_params("action.san_loss must read <success>/<failure>, e.g. 0/1D6 or 1/1D8")
        involuntary = action.get("involuntary")
        if involuntary is not None and not (isinstance(involuntary, str) or (isinstance(involuntary, dict)
                                                                              and isinstance(involuntary.get("kind"), str))):
            raise invalid_params("action.involuntary must be a kind (string) or {kind, summary}")
        motive = action.get("motive")
        if motive is not None and (not isinstance(motive, dict) or motive.get("direction") not in ("support", "neutral", "oppose")
                                   or motive.get("intensity", 0) not in (0, 1, 2)):
            raise invalid_params("action.motive must be {direction: support|neutral|oppose, intensity: 0|1|2}")
        skills = action.get("skills")
        if skills is not None and (not isinstance(skills, list) or not all(isinstance(s, str) and s.strip() for s in skills)):
            raise invalid_params("action.skills must be a list of skill names")
        if action.get("mode") is not None and action.get("mode") not in ("any", "all"):
            raise invalid_params("action.mode must be any or all")

    # ---- actors and targets ----------------------------------------------------------

    def _session_restriction(self, sessions: SessionView) -> tuple[frozenset[str] | None, str, dict[str, Any]]:
        """11.3.1 precedence: a pending defense admits only `combat:defend`; a live chase
        only chase decisions; a running bout only bout-tick / bout-end. Returns the
        admitted decision refs, the message and the details for the refusal."""
        combat = sessions.combat
        if combat_active(combat) and isinstance(combat.get("pending_attack"), dict):
            pending = combat["pending_attack"]
            defender = str(pending["target_actor_id"])
            options = defense_options(pending)
            who = "the player" if sessions.is_investigator(defender) else "the keeper"
            return (frozenset({COMBAT_DEFEND_REF}),
                    f"an attack by {pending['actor_id']} on {defender} awaits {who}'s defense",
                    {"session": "combat", "required": "combat:defend", "actor": defender, "options": options,
                     "fix": (f"ask the player (ask.binds the pending defense), then resolve with actor: {defender} and "
                             f"defense: one of {options}") if sessions.is_investigator(defender)
                     else f"resolve with actor: {defender} and defense: one of {options}"})
        if chase_active(sessions.chase):
            refs = frozenset(n["node_id"] for n in self.engine.graph["nodes"]
                             if n.get("node_kind") == "decision" and (n.get("properties") or {}).get("family_id") == "chase")
            kind = sessions.chase_pending_kind(sessions.chase)
            return (refs, "a chase is underway; only chase decisions may resolve",
                    {"session": "chase", "required": f"chase:{kind}", "turn_of": sessions.chase_turn_of(sessions.chase),
                     "fix": f"resolve decision chase:{kind} (see session.actions), acting as session.turn_of"})
        for investigator_id, snapshot in sessions.sanity.items():
            if bout_active(snapshot):
                return (frozenset(SANITY_BOUT_REFS), f"{investigator_id} is in a bout of madness; only bout decisions may resolve",
                        {"session": "sanity_bout", "required": "sanity:bout-tick", "actor": investigator_id,
                         "fix": "resolve decision sanity:bout-tick to advance the bout, or sanity:bout-end to end it"})
        return None, "", {}

    def _npc_target(self, target: str | None) -> dict[str, Any] | None:
        """The target as a present NPC node, None when it is not an NPC at all, and
        `unknown_entity` with the present ones when it is an absent NPC."""
        if not target:
            return None
        node = self.graph.find(target, (NPC_KIND,))
        if node is None:
            return None
        handle = self.graph.handle(node)
        presence = self.world.get("npc_presence") or {}
        if presence.get(handle) != self.world.get("active_scene"):
            present = [{"name": h, "kind": "npc", "display_name": self.graph.display_name(self.graph.nodes[n["node_id"]])}
                       for h, at in presence.items() if at == self.world.get("active_scene")
                       for n in [self.graph.find(h, (NPC_KIND,))] if n]
            raise RpcError("unknown_entity", f"{self.graph.display_name(node)} is not in the current scene",
                           fix="target one of details.candidates, or move first",
                           details={"query": target, "candidates": present})
        return node

    def _target_investigator(self, target: str | None) -> dict[str, Any] | None:
        if not target:
            return None
        key = normalize(target)
        for sheet in self.campaign.party():
            if key in {normalize(str(sheet.get("id"))), normalize(str(sheet.get("name")))}:
                return sheet
        return None

    def _resolve_actor(self, sessions: SessionView) -> dict[str, Any]:
        """The investigator sheet the settlement is about. An NPC `actor` is admitted only
        inside a live combat or chase it takes part in (the keeper drives its turn); the
        sheet is then the investigator the NPC faces."""
        name = self.action.get("actor")
        if isinstance(name, str) and self._target_investigator(name) is None:
            node = self.graph.find(name, (NPC_KIND,))
            if node is not None:
                handle = self.graph.handle(node)
                snapshot = sessions.combat if combat_active(sessions.combat) else sessions.chase if chase_active(sessions.chase) else None
                participants = [str(p.get("actor_id")) for p in (snapshot or {}).get("participants") or [] if isinstance(p, dict)]
                if snapshot is None or handle not in participants:
                    raise RpcError("turn_state", f"{self.graph.display_name(node)} can act only inside a live combat or chase it takes part in",
                                   fix="start the fight from the investigator's side (intent combat), or resolve as the investigator",
                                   details={"actor": handle, "session": None if snapshot is None else snapshot.get("status")})
                self.npc_actor = handle
                pending = snapshot.get("pending_attack") if isinstance(snapshot.get("pending_attack"), dict) else None
                for candidate in ([pending["target_actor_id"], pending["actor_id"]] if pending else []) + participants:
                    sheet = self._target_investigator(str(candidate))
                    if sheet is not None:
                        return sheet
                return self.actor_lookup(self.campaign, None)
        return self.actor_lookup(self.campaign, name)

    def acting_id(self, ctx: SettleContext) -> str:
        return self.npc_actor or ctx.actor_id

    # ---- skills --------------------------------------------------------------------

    def _skill_matches(self, resolver: SkillResolver) -> list[str]:
        explicit = self.action.get("skill")
        if explicit is not None:
            if not isinstance(explicit, str) or not explicit.strip():
                raise invalid_params("action.skill must be a non-empty string")
            found = resolver.resolve_explicit(explicit)
            if found is None:
                raise RpcError("needs", f"unknown skill or characteristic {explicit!r}",
                               fix="set action.skill to one of details.needs.options",
                               details={"needs": {"field": "skill", "options": resolver.options_for(explicit)}})
            return [found]
        matches = resolver.find_in_text(self.method)
        if not matches:
            matches = resolver.find_in_text(self.goal)
        return matches

    def _one_skill(self, resolver: SkillResolver) -> str:
        matches = self._skill_matches(resolver)
        if len(matches) == 1:
            return matches[0]
        options = resolver.options_for(f"{self.method} {self.goal}", preferred=matches)
        message = "several skills named in method/goal; pick one" if matches else "no skill or characteristic found in method/goal"
        raise RpcError("needs", message, fix="set action.skill to one of details.needs.options",
                       details={"needs": {"field": "skill", "options": options}})

    def _approach(self, resolver: SkillResolver) -> tuple[str, str]:
        """(approach, approach skill) from the explicit skill or the method's vocabulary."""
        matches = [m for m in self._skill_matches(resolver) if m in APPROACH_BY_SKILL]
        if len(matches) == 1:
            return APPROACH_BY_SKILL[matches[0]], matches[0]
        raise RpcError("needs", "the social approach is not clear from method",
                       fix="set action.skill to Charm, Fast Talk, Intimidate or Persuade",
                       details={"needs": {"field": "skill", "options": list(SOCIAL_APPROACH_SKILLS.values())}})

    # ---- routing (11.3.2) -------------------------------------------------------------

    def _route(self, resolver: SkillResolver, npc: dict[str, Any] | None,
               target_investigator: dict[str, Any] | None) -> list[str]:
        action = self.action
        if action.get("push"):
            return [PUSHED_ROLL_REF]
        if action.get("luck") is not None:
            return [LUCK_SPEND_REF]
        if action.get("decision") is not None:
            ref = full_decision_ref(str(action["decision"]))
            node = next((n for n in self.engine.graph["nodes"]
                         if n.get("node_id") == ref and n.get("node_kind") == "decision"), None)
            if node is None:
                names = sorted(semantic_name(n["node_id"]) for n in self.engine.graph["nodes"] if n.get("node_kind") == "decision")
                raise invalid_params(f"unknown decision {action['decision']!r}", fix="use one of details.candidates",
                                     details={"candidates": names})
            return [ref]
        intent = self.intent
        sessions = self.sessions
        matches: list[str] = []
        try:
            matches = self._skill_matches(resolver)
        except RpcError:
            matches = []
        # Sessions first (11.3.1): a pending defense, a live chase, a running bout.
        combat = sessions.combat if sessions else None
        if combat_active(combat) and isinstance(combat.get("pending_attack"), dict):
            return [COMBAT_DEFEND_REF]
        if action.get("defense") is not None:
            return [COMBAT_DEFEND_REF]
        if sessions and chase_active(sessions.chase):
            kind = sessions.chase_pending_kind(sessions.chase) or "move"
            return [f"decision:coc7:chase:{kind}"]
        if sessions and any(bout_active(s) for s in sessions.sanity.values()):
            return list(SANITY_BOUT_REFS)
        if intent == "cast":
            if not action.get("spell"):
                raise RpcError("needs", "casting needs the spell's name", fix="set action.spell",
                               details={"needs": {"field": "spell", "options": self._known_spells()}})
            return [CAST_SPELL_REF]
        if intent == "combat" or self.npc_actor:
            return self._with_sanity_offer([COMBAT_ATTACK_REF])
        if intent == "flee":
            return [COMBAT_FLEE_REF] if combat_active(combat) else [CHASE_START_REF]
        if intent == "move":
            return self._with_sanity_offer([ORDINARY_CHECK_REF] if matches else [])
        if intent == "montage":
            return []
        if intent == "social":
            if npc is None:
                return self._with_sanity_offer([ORDINARY_CHECK_REF])
            refs = [SOCIAL_REF]
            if "Psychology" in matches:
                refs.append(PSYCHOLOGY_OBSERVE_REF)
            return self._with_sanity_offer(refs)
        # investigate
        healing_skills = [m for m in matches if m in HEALING_SKILLS]
        if healing_skills:
            return [n["node_id"] for n in self.engine.graph["nodes"]
                    if n.get("node_kind") == "decision" and (n.get("properties") or {}).get("family_id") == "healing"
                    and ("first-aid" in n["node_id"] if healing_skills[0] == "First Aid" else "medicine" in n["node_id"])]
        if action.get("spell"):
            return [LEARN_SPELL_REF]
        if npc is not None:
            if "Psychology" in matches:
                return self._with_sanity_offer([PSYCHOLOGY_OBSERVE_REF])
            if matches or action.get("skill"):
                return self._with_sanity_offer([ORDINARY_CHECK_REF])
            return self._with_sanity_offer([ORDINARY_CHECK_REF, PSYCHOLOGY_OBSERVE_REF])
        return self._with_sanity_offer([ORDINARY_CHECK_REF])

    def _stakes_name_sanity(self) -> bool:
        text = normalize_text(self.stakes)
        return bool(text) and any(term in text.split() or term in text for term in SAN_TERMS)

    def _with_sanity_offer(self, refs: list[str]) -> list[str]:
        """§11.5: `stakes` that name Sanity make `sanity:check` a candidate alongside the
        routed decision (a `san_loss` on the action does the same)."""
        if self.action.get("san_loss") is not None or self._stakes_name_sanity():
            if not refs:
                return [SANITY_CHECK_REF]
            return [*refs, SANITY_CHECK_REF]
        return refs

    # ---- slots (11.4) -------------------------------------------------------------------

    def _check_slots(self, resolver: SkillResolver) -> dict[str, Any]:
        skill = self._one_skill(resolver)
        modifiers = self.action.get("modifiers") or {}
        bonus, penalty, difficulty = self.modifiers
        sem: dict[str, Any] = {"difficulty": difficulty, "goal": self.goal or self.method or self.intent,
                               "stakes": self._stakes(), "difficulty_basis": "explicit" if modifiers.get("difficulty") else "keeper"}
        if skill in CHARACTERISTICS:
            sem["characteristic"] = skill
        else:
            sem["skill"] = skill
        if bonus:
            sem["bonus"] = bonus
        if penalty:
            sem["penalty"] = penalty
        return sem

    def _stakes(self) -> dict[str, str]:
        goal = self.goal or self.method or self.intent
        return {"on_success": goal, "on_failure": self.stakes or f"the attempt fails: {goal}"}

    def _combined_slots(self, resolver: SkillResolver) -> dict[str, Any]:
        names = self.action.get("skills")
        if not names:
            names = self._skill_matches(resolver)
        canonical: list[str] = []
        for name in names or []:
            found = resolver.resolve_explicit(name) if isinstance(name, str) else None
            if found is None:
                raise RpcError("needs", f"unknown skill {name!r} in action.skills",
                               details={"needs": {"field": "skills", "options": resolver.options_for(str(name))}})
            canonical.append(found)
        if len(canonical) < 2:
            raise RpcError("needs", "a combined check needs two or more skills", fix="list them in action.skills",
                           details={"needs": {"field": "skills", "options": resolver.options_for(f"{self.method} {self.goal}")}})
        refs = [f"characteristic:{kebab(s)}" if s in CHARACTERISTICS else f"skill:{kebab(s)}" for s in canonical]
        _, _, difficulty = self.modifiers
        return {"combined_target_refs": refs, "combined_mode": str(self.action.get("mode") or "any"),
                "difficulty": difficulty, "goal": self.goal or self.method or self.intent, "stakes": self._stakes()}

    def _opposed_slots(self, resolver: SkillResolver, ctx: SettleContext, npc: dict[str, Any] | None) -> dict[str, Any]:
        if npc is None:
            raise RpcError("needs", "an opposed check needs a present NPC as action.target",
                           details={"needs": {"field": "target", "options": ctx.present_npc_names()}})
        skill = self._one_skill(resolver)
        handle = self.graph.handle(npc)
        profile = ctx.npc_profile(handle) or {}
        if skill in (profile.get("skills") or {}):
            opponent = f"npc:{handle}:skill:{kebab(skill)}"
        elif skill in (profile.get("characteristics") or {}):
            opponent = f"npc:{handle}:characteristic:{kebab(skill)}"
        else:
            raise RpcError("needs", f"{self.graph.display_name(npc)} has no authored value for {skill}",
                           fix="pick a skill from details.needs.options or resolve an ordinary check instead",
                           details={"needs": {"field": "skill", "options": ctx.npc_skill_labels(f"npc:{handle}")}})
        actor_ref = f"characteristic:{kebab(skill)}" if skill in CHARACTERISTICS else f"skill:{kebab(skill)}"
        return {"actor_check_ref": actor_ref, "opponent_check_ref": opponent}

    def _social_slots(self, resolver: SkillResolver, npc: dict[str, Any] | None, ctx: SettleContext) -> tuple[dict[str, Any], str]:
        if npc is None:
            raise RpcError("needs", "social adjudication needs a present NPC as action.target",
                           details={"needs": {"field": "target", "options": ctx.present_npc_names()}})
        approach, approach_skill = self._approach(resolver)
        handle = self.graph.handle(npc)
        motive = self.action.get("motive") or {}
        sem: dict[str, Any] = {
            "described_action": self.method or self.goal, "goal": self.goal or self.method,
            "target_ref": f"social-target:{handle}", "commitment_ref": f"commitment:{handle}-t{ctx.turn_number}",
            "approach": approach, "motive_direction": motive.get("direction", "neutral"),
            "motive_intensity": motive.get("intensity", 0), "feasibility": "roll",
            # Level 0 unless the keeper names a discovered clue as leverage (action.support).
            "supporting_action": {"description": "", "level": 0, "provenance": ""},
        }
        support = self.action.get("support")
        if isinstance(support, str) and support.strip():
            clue = self.graph.find(support, ("clue",))
            discovered = set(self.world.get("discovered_clues") or [])
            if clue is None or self.graph.handle(clue) not in discovered:
                raise RpcError("needs", "action.support must name a discovered clue",
                               details={"needs": {"field": "support", "options": sorted(discovered)}})
            sem["supporting_action"] = {"description": support, "level": 1, "provenance": "discovered clue",
                                        "source_ref": f"clue:{self.graph.handle(clue)}"}
        return sem, approach_skill

    def _learn_slots(self, ctx: SettleContext, target: str | None) -> dict[str, Any]:
        spell = str(self.action.get("spell") or "").strip()
        if not spell:
            raise RpcError("needs", "learning a spell needs action.spell",
                           details={"needs": {"field": "spell", "options": ctx.spell_candidates("")}})
        canonical = ctx.canonical_spell_name(spell)
        sources = ctx.magic_learning_sources()
        source_ref = None
        if target:
            node = self.graph.find(target)
            if node is not None:
                handle = self.graph.handle(node)
                source_ref = next((ref for ref in sources if ref.split(":", 1)[1] == handle), None)
                if source_ref is None:
                    raise RpcError("needs", f"{self.graph.display_name(node)} teaches no spell",
                                   fix="target a source from details.needs.options",
                                   details={"needs": {"field": "target", "options": sorted(sources)}})
        if source_ref is None:
            matches = [ref for ref, spells in sources.items()
                       if canonical in {ctx.canonical_spell_name(str(s)) for s in spells}]
            if len(matches) == 1:
                source_ref = matches[0]
            else:
                raise RpcError("needs", f"no single source teaches {canonical!r}; name the source as action.target",
                               details={"needs": {"field": "target", "options": sorted(sources)}})
        return {"spell": canonical, "source": source_ref.split(":", 1)[0], "source_ref": source_ref}

    def _slots(self, ref: str, resolver: SkillResolver, ctx: SettleContext, npc: dict[str, Any] | None,
               target_investigator: dict[str, Any] | None) -> tuple[dict[str, Any], dict[str, Any]]:
        """(semantic_inputs, extra host bindings) for the chosen decision."""
        action = self.action
        target = action.get("target")
        extras: dict[str, Any] = {}
        if ref == ORDINARY_CHECK_REF or ref == "decision:coc7:push-luck:luck-roll":
            return self._check_slots(resolver), extras
        if ref == COMBINED_CHECK_REF:
            return self._combined_slots(resolver), extras
        if ref == OPPOSED_CHECK_REF:
            return self._opposed_slots(resolver, ctx, npc), extras
        if ref == SOCIAL_REF:
            sem, approach_skill = self._social_slots(resolver, npc, ctx)
            extras["_host_social_binding"] = social_binding(ctx, npc, approach_skill)
            return sem, extras
        if ref == PSYCHOLOGY_OBSERVE_REF:
            if npc is None:
                raise RpcError("needs", "a Psychology observation needs a present NPC as action.target",
                               details={"needs": {"field": "target", "options": ctx.present_npc_names()}})
            question = self.goal or self.method
            extras["_host_psychology_binding"] = psychology_binding(ctx, npc, question)
            return {"question": question, "target_ref": f"psychology-target:{self.graph.handle(npc)}"}, extras
        if ref == PSYCHOLOGY_REALIZE_REF:
            if npc is None:
                raise RpcError("needs", "realizing an observation needs the observed NPC as action.target",
                               details={"needs": {"field": "target", "options": ctx.present_npc_names()}})
            binding = psychology_realize_binding(ctx, npc)
            if binding is None:
                raise RpcError("turn_state", f"no Psychology observation of {self.graph.display_name(npc)} is settled yet",
                               fix="observe first: decision psychology:observe-concealed")
            extras["_host_psychology_binding"] = binding
            behavior = self.method or self.goal
            if not behavior:
                raise RpcError("needs", "the realization needs the player-visible behavior",
                               details={"needs": {"field": "method", "options": []}})
            return {"external_behavior": behavior}, extras
        if ref == PUSHED_ROLL_REF:
            if not self.stakes:
                raise RpcError("needs", "a pushed roll needs the announced consequence of failing it",
                               fix="put the consequence in action.stakes", details={"needs": {"field": "stakes", "options": []}})
            if not self.method:
                raise RpcError("needs", "a pushed roll needs the changed method",
                               fix="describe the new approach in action.method", details={"needs": {"field": "method", "options": []}})
            return {"method_changed": self.method, "failure_consequence": self.stakes, "player_confirmed_risk": True}, extras
        if ref == LUCK_SPEND_REF:
            return {"points": int(action["luck"])}, extras
        family = self.engine_family(ref)
        if family == "healing":
            sem: dict[str, Any] = {}
            if "first-aid" in ref or "medicine" in ref or "weekly" in ref:
                sem["rescuer_ref"] = ctx.actor_id
            if "first-aid" in ref:
                if target_investigator is not None and str(target_investigator["id"]) not in (ctx.actor_id, ctx.subject_id):
                    sem["assistant_rescuer_ref"] = str(target_investigator["id"])
                if action.get("push"):
                    sem["changed_method"] = self.method
                    sem["failure_consequence"] = self.stakes
            if "weekly" in ref:
                rest = action.get("rest") if isinstance(action.get("rest"), dict) else {}
                sem["complete_rest"] = bool(rest.get("complete", False))
                sem["poor_environment"] = bool(rest.get("poor_environment", False))
            return sem, extras
        if ref == CAST_SPELL_REF:
            spell = str(action.get("spell") or "").strip()
            if not spell:
                raise RpcError("needs", "casting needs action.spell",
                               details={"needs": {"field": "spell", "options": ctx.spell_candidates("")}})
            sem = {"spell": ctx.canonical_spell_name(spell), "pushed": bool(action.get("push")),
                   "interrupted": bool(action.get("interrupted"))}
            extras["_host_family_binding"] = magic_binding(ctx, ref, sem)
            return sem, extras
        if ref == LEARN_SPELL_REF:
            sem = self._learn_slots(ctx, target)
            extras["_host_family_binding"] = magic_binding(ctx, ref, sem)
            return sem, extras
        if ref == END_SESSION_REF:
            sem = {}
            if self.goal:
                sem["summary"] = self.goal
            sem["kind"] = str(action.get("ending") or "conclusion")
            extras["_host_family_binding"] = development_binding(ctx, ref)
            return sem, extras
        if ref == SETTLE_ENDING_REF:
            extras["_host_family_binding"] = development_binding(ctx, ref)
            return {}, extras
        if family in SESSION_FAMILIES:
            return self._session_slots(ref, family, ctx, npc, resolver)
        return {}, extras

    # ---- session slots (combat / chase / sanity) ------------------------------------------

    def _session_slots(self, ref: str, family: str, ctx: SettleContext, npc: dict[str, Any] | None,
                       resolver: SkillResolver) -> tuple[dict[str, Any], dict[str, Any]]:
        sessions = ctx.sessions()
        self.sessions = sessions
        if family == "combat":
            sem, binding = self._combat_slots(ref, ctx, npc, sessions)
        elif family == "chase":
            sem, binding = self._chase_slots(ref, ctx, sessions, resolver)
        else:
            sem, binding = self._sanity_slots(ref, ctx, npc, sessions)
        return sem, {"_host_session_binding": binding}

    def _combat_slots(self, ref: str, ctx: SettleContext, npc: dict[str, Any] | None,
                      sessions: SessionView) -> tuple[dict[str, Any], dict[str, Any]]:
        action = self.action
        suffix = ref.rsplit(":", 1)[-1]
        actor_id = self.acting_id(ctx)
        snapshot = sessions.combat if combat_active(sessions.combat) else None
        binding: dict[str, Any] = {"investigator_id": ctx.actor_id, "combat_revision": int((snapshot or {}).get("revision") or 0),
                                   "_actor_id": actor_id, "_goal_text": self.goal or self.method}
        sem: dict[str, Any] = {}
        participants = {str(p.get("actor_id")) for p in (snapshot or {}).get("participants") or [] if isinstance(p, dict)}
        if suffix == "defend":
            pending = (snapshot or {}).get("pending_attack")
            if not isinstance(pending, dict):
                raise RpcError("turn_state", "no attack awaits a defense", fix="declare an attack first (intent combat)")
            defender = str(pending.get("target_actor_id"))
            if actor_id != defender:
                who = "the player" if sessions.is_investigator(defender) else "the keeper, acting as the NPC"
                raise RpcError("turn_state", f"the pending defense belongs to {defender}; {who} answers it",
                               fix=f"resolve with actor: {defender} and defense: one of {defense_options(pending)}",
                               details={"session": "combat", "required": "combat:defend", "actor": defender,
                                        "options": defense_options(pending)})
            defense = action.get("defense")
            if defense is None:
                raise RpcError("needs", f"{pending['target_actor_id']} must choose a defense",
                               fix="set action.defense", details={"needs": {"field": "defense", "options": defense_options(pending)}})
            sem["defense_kind"] = str(defense)
            binding.update({"pending_attack_ref": pending.get("attack_command_id"), "attack_command_id": pending.get("attack_command_id"),
                            "target_actor_id": pending.get("target_actor_id"), "_actor_id": str(pending.get("target_actor_id"))})
            return sem, binding
        if suffix in ("attack", "maneuver"):
            if self.npc_actor:
                target = action.get("target")
                target_sheet = self._target_investigator(target) if target else None
                target_id = str(target_sheet["id"]) if target_sheet else ctx.actor_id
                if snapshot and target_id not in participants:
                    raise RpcError("unknown_entity", f"{target_id} is not in this combat",
                                   details={"query": target, "candidates": sorted(participants - {actor_id})})
                sem["candidate_ref"] = f"attack:{target_id}"
                binding["target_npc_id"] = target_id
                if action.get("weapon"):
                    binding["weapon_id"] = str(action["weapon"])
                    sem["weapon_ref"] = str(action["weapon"])
            else:
                if npc is None:
                    if snapshot:
                        opponents = sorted(pid for pid in participants if pid != ctx.actor_id)
                        if len(opponents) == 1 and not action.get("target"):
                            handle = opponents[0]
                        else:
                            raise RpcError("needs", "the attack needs a target in the fight",
                                           details={"needs": {"field": "target", "options": opponents}})
                    else:
                        raise RpcError("needs", "combat needs a present NPC as action.target",
                                       details={"needs": {"field": "target", "options": ctx.present_npc_names()}})
                else:
                    handle = self.graph.handle(npc)
                    if npc_profile(self.graph, npc) is None:
                        with_profiles = sorted(h for h, _, p in sessions.present_opponents() if p)
                        raise RpcError("needs", f"{self.graph.display_name(npc)} has no stat block in the module",
                                       fix="use lookup catalog for a creature stat block, or narrate the exchange without dice",
                                       details={"needs": {"field": "target", "options": with_profiles}})
                sem["candidate_ref"] = f"attack:{handle}"
                binding["target_npc_id"] = handle
                weapon = action.get("weapon")
                if weapon is None:
                    raise RpcError("needs", "the attack needs the weapon in hand", fix="set action.weapon (unarmed for fists)",
                                   details={"needs": {"field": "weapon", "options": weapon_options(ctx.actor)}})
                resolved = resolve_investigator_weapon(ctx.tables, ctx.actor, str(weapon))
                if resolved is None:
                    raise RpcError("needs", f"{weapon!r} is not a weapon the investigator carries",
                                   fix="set action.weapon to one of details.needs.options",
                                   details={"needs": {"field": "weapon", "options": weapon_options(ctx.actor)}})
                sem["weapon_ref"] = str(resolved["weapon_id"])
                binding["weapon_id"] = str(resolved["weapon_id"])
                if snapshot is None:
                    scene = self.graph.scene(ctx.active_scene)
                    affordance_id, _ = combat_operation_for(self.graph, scene, handle, str(resolved["weapon_id"]))
                    if affordance_id:
                        binding["affordance_id"] = affordance_id
            if suffix == "maneuver":
                sem["goal"] = self.goal or "ongoing_disadvantage"
            return sem, binding
        if suffix in ("aim", "reload"):
            weapon = action.get("weapon")
            if weapon is not None and not self.npc_actor:
                resolved = resolve_investigator_weapon(ctx.tables, ctx.actor, str(weapon))
                if resolved is None:
                    raise RpcError("needs", f"{weapon!r} is not a weapon the investigator carries",
                                   details={"needs": {"field": "weapon", "options": weapon_options(ctx.actor)}})
                sem["weapon_ref"] = str(resolved["weapon_id"])
                binding["weapon_id"] = str(resolved["weapon_id"])
            elif weapon is not None:
                sem["weapon_ref"] = str(weapon)
                binding["weapon_id"] = str(weapon)
            return sem, binding
        if suffix == "end":
            outcome = action.get("outcome") or ((snapshot or {}).get("outcome") if snapshot else None)
            if snapshot is None:
                raise RpcError("turn_state", "no combat is underway to end", fix="nothing to end")
            if not outcome:
                raise RpcError("needs", "combat:end needs the outcome the fight reached",
                               fix="set action.outcome", details={"needs": {"field": "outcome", "options": sorted(COMBAT_OUTCOMES - {None})}})
            if outcome not in COMBAT_OUTCOMES:
                raise invalid_params(f"unknown combat outcome {outcome!r}",
                                     details={"options": sorted(COMBAT_OUTCOMES - {None})})
            sem["outcome"] = str(outcome)
            return sem, binding
        return sem, binding  # flee: everything host-locked

    def _chase_slots(self, ref: str, ctx: SettleContext, sessions: SessionView,
                     resolver: SkillResolver) -> tuple[dict[str, Any], dict[str, Any]]:
        suffix = ref.rsplit(":", 1)[-1]
        action = self.action
        binding: dict[str, Any] = {"decision_id": ctx.call_id}
        sem: dict[str, Any] = {}
        if suffix == "start":
            if chase_active(sessions.chase):
                raise RpcError("turn_state", "a chase is already underway", fix="continue it with chase decisions")
            opponents = [(h, p) for h, _, p in sessions.present_opponents() if p]
            if not opponents:
                raise RpcError("needs", "a chase needs a present pursuer with a stat block",
                               fix="establish the pursuer in this scene first, or narrate the flight without dice",
                               details={"needs": {"field": "target", "options": ctx.present_npc_names()}})
            if action.get("target"):
                chosen = [(h, p) for h, p in opponents if normalize(h) == normalize(str(action["target"]))
                          or normalize(self.graph.display_name(self.graph.find(h, (NPC_KIND,)) or {"node_id": h, "node_kind": NPC_KIND})) == normalize(str(action["target"]))]
                if chosen:
                    opponents = chosen
            participants = []
            quarry = investigator_combat_participant(ctx.tables, ctx.actor, None)
            participants.append(chase_participant_from_combat_spec(quarry, "quarry", 0))
            for handle, profile in opponents:
                participants.append(chase_participant_from_combat_spec(npc_combat_participant(ctx.tables, handle, profile), "pursuer", 0))
            locations = chase_location_chain(self.graph, self.world, ctx.rng)
            sem.update({"pursuer_refs": [f"npc:{h}" for h, _ in opponents], "quarry_refs": [f"investigator:{ctx.actor_id}"],
                        "location_refs": [f"scene:{loc['label']}" if loc.get("kind") == "scene" else f"location:{loc['label']}"
                                          for loc in locations]})
            binding.update({"chase_id": f"chase:{ctx.active_scene}:{kebab(ctx.actor_id)}-vs-{kebab(opponents[0][0])}-t{ctx.turn_number}",
                            "participants": participants, "locations": locations})
            return sem, binding
        snapshot = sessions.chase
        if not chase_active(snapshot):
            raise RpcError("turn_state", "no chase is underway", fix="intent flee starts one")
        actor_id = self.acting_id(ctx)
        participants = {str(p.get("actor_id")): p for p in snapshot.get("participants") or [] if isinstance(p, dict)}
        binding["revision"] = snapshot.get("revision")
        if suffix == "end":
            sem["outcome"] = sessions.chase_end_outcome(action.get("outcome"))
            binding["chase_id"] = snapshot.get("chase_id")
            return sem, binding
        turn_of = sessions.chase_turn_of(snapshot)
        if not self.npc_actor and turn_of and turn_of != ctx.actor_id and turn_of in participants and not sessions.is_investigator(turn_of):
            raise RpcError("turn_state", f"it is {turn_of}'s move in the chase", fix=f"resolve with actor: {turn_of}",
                           details={"turn_of": turn_of})
        binding["actor_id"] = actor_id
        me = participants.get(actor_id) or {}
        chain = snapshot.get("location_chain") or []
        position = int(me.get("position", 0))
        nxt = chain[position + 1] if 0 <= position + 1 < len(chain) else {}
        if suffix == "move":
            binding["action_id"] = "move:advance"
        elif suffix in ("hazard", "barrier"):
            feature = nxt.get(suffix) if isinstance(nxt, dict) else None
            if not isinstance(feature, dict):
                raise RpcError("turn_state", f"the next location has no {suffix}", fix="resolve chase:move instead")
            skill = action.get("skill") or feature.get("skill") or "DEX"
            target = feature.get("target")
            if target is None:
                target = self._chase_target_value(ctx, actor_id, str(skill), sessions)
            if suffix == "hazard":
                binding.update({"action_id": f"hazard:{feature.get('hazard_id')}", "target": int(target),
                                "difficulty": feature.get("difficulty", "regular")})
            else:
                method = str(action.get("method") or "").strip().lower()
                if method not in ("negotiate", "break"):
                    raise RpcError("needs", "a barrier is negotiated (a skill roll) or broken (Build damage)",
                                   fix="set action.method to negotiate or break",
                                   details={"needs": {"field": "method", "options": ["negotiate", "break"]}})
                sem["method"] = method
                binding.update({"action_id": f"barrier:{feature.get('barrier_id')}:{method}", "target": int(target),
                                "difficulty": feature.get("difficulty", "regular")})
            if action.get("skill"):
                sem["skill"] = str(skill)
        elif suffix == "conflict":
            targets = [pid for pid, row in participants.items() if pid != actor_id
                       and int(row.get("position", -2)) == position and not row.get("escaped") and not row.get("captured")]
            target = action.get("target")
            chosen = None
            if target:
                chosen = next((pid for pid in targets if normalize(pid) == normalize(str(target))
                               or normalize(sessions.label(pid)) == normalize(str(target))), None)
            elif len(targets) == 1:
                chosen = targets[0]
            if chosen is None:
                raise RpcError("needs", "the conflict needs the caught opponent as action.target",
                               details={"needs": {"field": "target", "options": targets}})
            binding.update({"action_id": f"conflict:{chosen}", "target_actor_id": chosen,
                            "combat_command_id": f"{ctx.call_id}:conflict", "_defense_kind": action.get("defense") or "dodge",
                            "_weapon_id": action.get("weapon"), "_goal": self.goal or self.method})
        return sem, binding

    def _chase_target_value(self, ctx: SettleContext, actor_id: str, skill: str, sessions: SessionView) -> int:
        sheet = ctx.sheet_by_id(actor_id)
        if sheet is not None:
            resolver = SkillResolver(ctx.tables, sheet)
            canonical = resolver.resolve_explicit(skill) or skill
            try:
                return int(resolver.target_value(canonical))
            except KeyError:
                pass
        profile = next((p for h, _, p in sessions.present_opponents() if h == actor_id), None) or {}
        for table in ("skills", "characteristics"):
            value = (profile.get(table) or {}).get(skill)
            if isinstance(value, int) and not isinstance(value, bool):
                return int(value)
        raise RpcError("needs", f"{actor_id} has no value for {skill}",
                       details={"needs": {"field": "skill", "options": ctx.npc_skill_labels(f"npc:{actor_id}")}})

    def _sanity_slots(self, ref: str, ctx: SettleContext, npc: dict[str, Any] | None,
                      sessions: SessionView) -> tuple[dict[str, Any], dict[str, Any]]:
        suffix = ref.rsplit(":", 1)[-1]
        action = self.action
        snapshot = sessions.sanity.get(ctx.actor_id) or {}
        sheet = ctx.actor
        san_before = snapshot.get("san_current")
        if not isinstance(san_before, int):
            san_before = sheet.get("current_san")
        san_max = snapshot.get("san_max")
        if not isinstance(san_max, int):
            skills = sheet.get("skills") if isinstance(sheet.get("skills"), dict) else {}
            san_max = 99 - int(skills.get("Cthulhu Mythos", 0) or 0)
        binding: dict[str, Any] = {"investigator_id": ctx.actor_id, "san_before": san_before, "san_max": san_max}
        sem: dict[str, Any] = {}
        if suffix == "check":
            loss = parse_san_loss(action.get("san_loss")) if action.get("san_loss") else None
            if loss is None and npc is not None:
                loss = npc_san_loss(npc_profile(self.graph, npc))
            if loss is None:
                raise RpcError("needs", "the SAN check needs its loss expression (success/failure)",
                               fix="set action.san_loss like 0/1D6, or target an NPC whose profile states one",
                               details={"needs": {"field": "san_loss", "options": ["0/1", "0/1D3", "0/1D6", "1/1D6", "1/1D8", "1/1D10"]}})
            for label, expression in (("success", loss[0]), ("failure", loss[1])):
                if expression not in ("0", ""):
                    try:
                        validate_san_loss_expression(expression)
                    except ValueError as exc:
                        raise invalid_params(f"san_loss {label} part: {exc}") from exc
            involuntary = action.get("involuntary")
            kind = involuntary.get("kind") if isinstance(involuntary, dict) else involuntary
            summary = involuntary.get("summary") if isinstance(involuntary, dict) else None
            if kind not in INVOLUNTARY_KINDS:
                raise RpcError("needs", "a failed SAN roll always costs the investigator an involuntary action the Keeper decides (p.166)",
                               fix="set action.involuntary to one of details.needs.options (or {kind, summary})",
                               details={"needs": {"field": "involuntary", "options": sorted(INVOLUNTARY_KINDS)}})
            source = self.goal or self.method
            if not source and npc is not None:
                source = f"seeing {self.graph.display_name(npc)}"
            if not source:
                raise RpcError("needs", "the SAN check needs its source", fix="put what the investigator beholds in action.goal",
                               details={"needs": {"field": "goal", "options": []}})
            sem.update({"source": source, "loss_success": loss[0], "loss_failure": loss[1], "involuntary_kind": str(kind),
                        "involuntary_summary": str(summary or self.stakes or kind)})
            if action.get("trigger"):
                sem["trigger_ref"] = str(action["trigger"])
                binding["trigger_id"] = str(action["trigger"]).split(":", 1)[-1]
            return sem, binding
        if suffix in ("bout-tick", "bout-end"):
            if not bout_active(snapshot):
                raise RpcError("turn_state", "no bout of madness is running", fix="nothing to advance or end")
            view = sessions.bout_view(ctx.actor_id, snapshot) or {}
            binding.update({"pending_choice_ref": f"bout:{ctx.actor_id}-r{view.get('round')}",
                            "origin_command_id": snapshot.get("active_bout_id"), "bout_revision": int(view.get("round") or 0)})
            return sem, binding
        if suffix == "reality-check":
            if not isinstance(snapshot.get("active_delusion"), dict):
                raise RpcError("turn_state", "the investigator has no active delusion to test")
            sem["request_reality_check"] = True
            binding["active_delusion_ref"] = "active-delusion:current"
            return sem, binding
        if suffix == "insane-insight":
            if not (snapshot.get("temporary_insane") or snapshot.get("indefinite_insane")):
                raise RpcError("turn_state", "the investigator is not currently insane")
            if not self.goal:
                raise RpcError("needs", "the insight needs its wording", fix="put it in action.goal",
                               details={"needs": {"field": "goal", "options": []}})
            sem["insight"] = self.goal
            binding["insanity_state"] = "indefinite" if snapshot.get("indefinite_insane") else "temporary"
            return sem, binding
        if suffix == "gain-current-san":
            from .sessions import sanity_gain_pending
            receipt = sanity_gain_pending(ctx.campaign_dir, ctx.actor_id)
            if receipt is None:
                raise RpcError("turn_state", "no host SAN-gain receipt is pending for this investigator")
            sem["gain_source"] = self.goal or str(receipt.get("gain_source") or "reward")
            binding["san_gain"] = int(receipt["san_gain"])
            return sem, binding
        if suffix in ("apply-treatment", "recover-temporary"):
            key = "treatment_trigger" if suffix == "apply-treatment" else "recovery_trigger"
            trigger = snapshot.get(key) if isinstance(snapshot.get(key), dict) else None
            if trigger is None:
                raise RpcError("turn_state", f"no {suffix.replace('-', ' ')} is due")
            binding.update({("treatment_trigger_ref" if suffix == "apply-treatment" else "recovery_trigger_ref"): trigger.get("trigger_id"),
                            "due_elapsed_minutes": int(trigger.get("due_elapsed_minutes") or 0),
                            # The keeper's decision to treat or let recover is the assertion of a safe place.
                            "safe_place": True})
            if suffix == "apply-treatment":
                skills = sheet.get("skills") if isinstance(sheet.get("skills"), dict) else {}
                binding["psychoanalysis_skill"] = int(skills.get("Psychoanalysis", 1) or 1)
            return sem, binding
        return sem, binding

    def engine_family(self, ref: str) -> str:
        for node in self.engine.graph["nodes"]:
            if node.get("node_id") == ref:
                return str((node.get("properties") or {}).get("family_id") or "")
        return ""

    # ---- the run -----------------------------------------------------------------------

    def run(self) -> dict[str, Any]:
        self._validate_extras()
        self.sessions = SessionView(self.campaign.dir, self.graph, self.campaign.party(), self.world)
        actor = self._resolve_actor(self.sessions)
        target = self.action.get("target") if isinstance(self.action.get("target"), str) else None
        target_investigator = self._target_investigator(target)
        npc = None if target_investigator is not None else self._npc_target(target)
        resolver = SkillResolver(self.engine.tables, actor)
        pre_matches: list[str] = []
        try:
            pre_matches = self._skill_matches(resolver)
        except RpcError:
            pass
        subject = actor
        if target_investigator is not None and any(m in HEALING_SKILLS for m in pre_matches):
            subject = target_investigator
        ctx = SettleContext(self.engine, self.campaign, self.graph, self.world, self.turn, self.call_id, self.ordinal,
                            self.rng, actor, subject, self.action)
        adapter = Coc7RuleGraphAdapter(ctx)
        # A defense answers an attack and an NPC acts in the fight: both are combat, whatever
        # the keeper wrote as intent.
        effective_intent = "combat" if (self.action.get("defense") is not None or self.npc_actor) else self.intent
        runtime = self.engine.runtime(ctx, intent=effective_intent, adapter=adapter)

        candidates = self._route(resolver, npc, target_investigator)
        allowed, message, details = self._session_restriction(self.sessions)
        if allowed is not None:
            # The keeper answers a session explicitly (`decision` / `defense`); a chase also
            # accepts the movement intents, which route to the one pending chase decision.
            explicit = self.action.get("decision") is not None or self.action.get("defense") is not None
            implicit = details.get("session") == "chase" and self.intent in ("flee", "move", "combat")
            candidates = [ref for ref in candidates if ref in allowed]
            if not candidates or not (explicit or implicit):
                raise RpcError("turn_state", message, fix=str(details.get("fix")), details=details)
        if not candidates:
            note = (f"intent {self.intent}: nothing to roll; a scene change is apply's business (effects: move)"
                    if self.intent == "move" else f"intent {self.intent}: nothing to roll; narrate the outcome directly")
            return {"kind": "none", "note": note}

        source = latest_check_receipt(ctx)
        provisional = self._provisional_semantic(ctx, target)
        question_base: dict[str, Any] = {"kind": "procedure", "semantic_inputs": provisional}
        if source is not None:
            question_base["_host_source_receipt_id"], question_base["_host_source_receipt"] = source
            question_base["_host_source_decision_id"] = source[0]
        families = {self.engine_family(ref) for ref in candidates}
        cards: dict[str, dict[str, Any]] = {}
        withheld: list[dict[str, Any]] = []
        # The routing table (11.3.2) is the structural filter: a decision is a candidate
        # when the action can fill its slots at all (a target for psychology, a spell for
        # learning, push/luck for the continuations). The graph's own intent conditions
        # confirm or veto: a card that answers False to the declared intent is dropped
        # even when routed; a card the graph marks True but nothing routes is not
        # offered, because its slots cannot be filled from this action.
        for family in sorted(families):
            context = runtime.context({**question_base, "family": family})
            for card in context.get("cards") or []:
                if card["decision_ref"] in candidates and card.get("answers_declared_intent") is not False:
                    cards[card["decision_ref"]] = card
            withheld.extend(row for row in context.get("withheld") or [] if row["decision_ref"] in candidates)

        explicit_decision = self.action.get("decision") is not None or self.action.get("push") or self.action.get("luck") is not None
        if not cards:
            self._raise_no_candidates(candidates, withheld, source)
        decision_source: str | None = None
        if len(cards) > 1 and not explicit_decision:
            # §13.4: the ontology's grounded-by relations for this turn's Director beat
            # narrow the choice. One decision in the intersection settles it; several keep
            # the choice but list only those; none leaves the full list. An explicit
            # `decision` never reaches here, so the keeper's word is never overturned.
            beat, grounded = self._director_grounding()
            narrowed = [ref for ref in sorted(cards) if ref in grounded]
            if len(narrowed) == 1:
                decision_source = "director"
                cards = {narrowed[0]: cards[narrowed[0]]}
            else:
                listed = narrowed if narrowed else sorted(cards)
                fix = "set action.decision to one of details.candidates[].name and call resolve again"
                if narrowed:
                    fix = f"the Director beat {beat} grounds {len(narrowed)} of these; " + fix
                raise RpcError("needs_choice", "several rule decisions fit this action; pick one", fix=fix,
                               details={"candidates": [{"name": cards[ref]["name"], "when": cards[ref]["label"]} for ref in listed],
                                        **({"narrowed_by": beat} if narrowed else {})})
        chosen_ref = sorted(cards)[0] if len(cards) == 1 else candidates[0]
        chosen = cards[chosen_ref]

        capability = runtime.capability_of(chosen_ref)
        family = chosen["family"]
        if capability not in EXECUTORS:
            raise not_implemented(f"the {family} family ({chosen['name']}) has no executor in this kernel yet",
                                  details={"family": family, "decision": chosen["name"], "capability": capability})

        envelope = self._settle(ctx, runtime, adapter, chosen_ref, chosen, resolver, npc, target_investigator, source)
        self._record_ticks(ctx)
        shaped = self._shape(ctx, runtime, chosen, envelope)
        if decision_source is not None:
            shaped["decision_source"] = decision_source
        if chosen_ref == COMBAT_FLEE_REF and (shaped["outcome"].get("combat_outcome") == "fled"):
            self._continue_into_chase(ctx, adapter, resolver, shaped)
        return shaped

    def _director_grounding(self) -> tuple[str | None, set[str]]:
        """The decisions the capsule's `director.grounded_by` named this turn, as full refs.
        Effect names ride in the same list and are skipped."""
        from .ontology import is_effect_name  # local: ontology is content-side
        director = ((self.turn.get("capsule") or {}).get("director") or {}) if isinstance(self.turn.get("capsule"), dict) else {}
        names = [str(n) for n in director.get("grounded_by") or [] if not is_effect_name(str(n))]
        return director.get("beat"), {full_decision_ref(n) for n in names}

    def _settle(self, ctx: SettleContext, runtime: Any, adapter: Coc7RuleGraphAdapter, chosen_ref: str,
                chosen: dict[str, Any], resolver: SkillResolver, npc: dict[str, Any] | None,
                target_investigator: dict[str, Any] | None, source: tuple[str, dict[str, Any]] | None) -> dict[str, Any]:
        semantic, extras = self._slots(chosen_ref, resolver, ctx, npc, target_investigator)
        selected: dict[str, Any] = {"decision_ref": chosen_ref, "semantic_inputs": semantic, **extras}
        if source is not None:
            selected["_host_source_receipt_id"], selected["_host_source_receipt"] = source
        grant = runtime.latest_grant_covering(chosen_ref)
        runtime._host_locked_provider = adapter.host_locked_provider(runtime, selected, grant)

        def executor(plan: Mapping[str, Any], decision_id: str, selected_decision: Mapping[str, Any]) -> Any:
            args = adapter.executor_args(plan, selected_decision, decision_id)
            return run_executor(ctx, (plan.get("capability") or {}).get("resolver_capability"), args, plan)

        envelope = runtime.settle(selected, self.call_id, card_grant=grant, executor=executor)
        if envelope.get("status") != "settled":
            self._raise_settle_failure(envelope, chosen)
        return envelope

    def _continue_into_chase(self, ctx: SettleContext, adapter: Coc7RuleGraphAdapter, resolver: SkillResolver,
                             shaped: dict[str, Any]) -> None:
        """§11.5: a successful `combat:flee` continues as `chase:start` in the same result
        (`continues-as` on the graph). The chase needs a pursuer with a stat block present;
        without one the flight simply ends the fight."""
        self.sessions = ctx.sessions()
        if not self.sessions.chase_start_ready():
            shaped["continuations"].append({"decision": "chase:start", "executed": False,
                                            "when": "no pursuer with a stat block is present; the flight ends the fight"})
            return
        runtime = self.engine.runtime(ctx, intent="flee", adapter=adapter)
        context = runtime.context({"kind": "procedure", "semantic_inputs": {}, "family": "chase"})
        card = next((c for c in context.get("cards") or [] if c["decision_ref"] == CHASE_START_REF), None)
        if card is None:
            shaped["continuations"].append({"decision": "chase:start", "executed": False,
                                            "when": "chase:start is not applicable in the current state"})
            return
        envelope = self._settle(ctx, runtime, adapter, CHASE_START_REF, card, resolver, None, None, None)
        result = thaw((envelope.get("settlement") or {}).get("result")) or {}
        shaped["continuations"] = [c for c in shaped["continuations"] if c["decision"] != "chase:start"]
        shaped["continuations"].append({"decision": "chase:start", "executed": True, "when": card.get("label"),
                                        "outcome": self._outcome(CHASE_START_REF, "chase", result, ctx)})
        shaped["session"] = result.get("session")
        shaped["pending_choice"] = result.get("pending_choice")
        shaped["outcome"]["continued"] = "chase:start"
        for ref_id in envelope.get("rule_refs") or []:
            if ref_id not in shaped["rule_refs"]:
                shaped["rule_refs"].append(str(ref_id))
        shaped["effects"] = list(ctx.effects)
        shaped["receipts"] = ctx.receipts

    def _learning_sources(self) -> dict[str, list[str]]:
        actor = self.actor_lookup(self.campaign, self.action.get("actor"))
        ctx = SettleContext(self.engine, self.campaign, self.graph, self.world, self.turn, self.call_id, self.ordinal,
                            self.rng, actor, actor, self.action)
        return ctx.magic_learning_sources()

    def _provisional_semantic(self, ctx: SettleContext, target: str | None) -> dict[str, Any]:
        provisional: dict[str, Any] = {}
        spell = self.action.get("spell")
        if isinstance(spell, str) and spell.strip():
            provisional["spell"] = ctx.canonical_spell_name(spell)
            sources = ctx.magic_learning_sources()
            source_ref = None
            if target:
                node = self.graph.find(target)
                if node is not None:
                    handle = self.graph.handle(node)
                    source_ref = next((ref for ref in sources if ref.split(":", 1)[1] == handle), None)
            if source_ref is None:
                matches = [ref for ref, spells in sources.items()
                           if provisional["spell"] in {ctx.canonical_spell_name(str(s)) for s in spells}]
                source_ref = matches[0] if len(matches) == 1 else None
            if source_ref:
                provisional["source_ref"] = source_ref
                provisional["source"] = source_ref.split(":", 1)[0]
        return provisional

    def _known_spells(self) -> list[str]:
        from .rules.magic import known_spells, read_magic_state
        actor = self.actor_lookup(self.campaign, self.action.get("actor"))
        clock = int((self.world.get("clock") or {}).get("minutes", 0))
        return known_spells(read_magic_state(self.campaign.dir, str(actor["id"])), clock)

    def _raise_no_candidates(self, candidates: list[str], withheld: list[dict[str, Any]],
                             source: tuple[str, dict[str, Any]] | None) -> None:
        unmet = {row["decision_ref"]: row.get("unmet") or [] for row in withheld}
        names = [semantic_name(ref) for ref in candidates]
        if candidates == [CAST_SPELL_REF]:
            raise RpcError("needs", f"{self.action.get('spell')!r} is not a spell this investigator knows",
                           fix="set action.spell to a known spell (details.needs.options), or learn it first",
                           details={"needs": {"field": "spell", "options": self._known_spells()}, "unmet": unmet})
        if candidates == [LEARN_SPELL_REF]:
            raise RpcError("needs", f"no authored source teaches {self.action.get('spell')!r} here",
                           fix="target a tome, teacher or entity that carries the spell (details.needs.options)",
                           details={"needs": {"field": "target", "options": sorted(self._learning_sources())}, "unmet": unmet})
        if candidates == [CHASE_START_REF]:
            present = self.sessions.present_opponents() if self.sessions else []
            raise RpcError("needs", "a chase needs a pursuer with a stat block present in the scene",
                           fix="establish the pursuer here first (an NPC whose module record carries mechanics.profile), "
                               "or narrate the flight without dice",
                           details={"needs": {"field": "target", "options": sorted(h for h, _, p in present if p)},
                                    "present": sorted(h for h, _, _ in present), "unmet": unmet})
        if self.action.get("push") or self.action.get("luck") is not None:
            what = "push" if self.action.get("push") else "spend Luck on"
            if source is None:
                raise RpcError("needs", f"there is no check of this investigator to {what}",
                               fix="resolve a check first; push or Luck bind to the last failed check",
                               details={"needs": {"field": "intent", "options": ["investigate", "social"]}, "unmet": unmet})
            check = source[1]
            reason = ("the last check was already pushed" if check.get("pushed")
                      else f"the last check {check.get('outcome')!s}: only an ordinary failure can be continued")
            raise RpcError("turn_state", f"cannot {what} the last check: {reason}",
                           fix="let the result stand and narrate its consequence",
                           details={"source_receipt": source[0], "outcome": check.get("outcome"), "unmet": unmet})
        explanation = "; ".join(f"{semantic_name(ref)}: " + ", ".join(f"{u['path']} is {u['actual']!r}, needs {u['requirement']}"
                                                                     for u in rows) for ref, rows in unmet.items() if rows)
        raise RpcError("needs", f"no rule decision is available for intent {self.intent!r} in the current state"
                       + (f" ({explanation})" if explanation else ""),
                       fix="change action.intent, name action.decision, or resolve the state the unmet conditions describe",
                       details={"needs": {"field": "intent", "options": ["investigate", "social", "move", "cast", "idle"]},
                                "considered": names, "unmet": unmet})

    def _raise_settle_failure(self, envelope: dict[str, Any], chosen: dict[str, Any]) -> None:
        failure = envelope.get("failure") if isinstance(envelope.get("failure"), dict) else {}
        code = str(failure.get("code") or envelope.get("status") or "internal")
        message = str(failure.get("message") or code)
        if code == "missing_semantic_input":
            missing = [str(m) for m in failure.get("missing") or []]
            fields = sorted({SLOT_TO_ACTION.get(m, m) for m in missing})
            raise RpcError("needs", f"{chosen['name']} needs {', '.join(fields)}",
                           fix=f"fill action.{fields[0]} and call resolve again" if fields else message,
                           details={"needs": {"field": fields[0] if fields else "action", "options": []}, "decision": chosen["name"]})
        if code == "rule_decision_not_applicable":
            raise RpcError("turn_state", f"{chosen['name']} does not apply right now: {message}",
                           details={"decision": chosen["name"], "unmet": failure.get("unmet")})
        if code in {"invalid_semantic_input", "locked_input_override"}:
            fields = sorted({SLOT_TO_ACTION.get(str(f), str(f)) for f in failure.get("fields") or failure.get("missing") or []})
            raise invalid_params(f"{chosen['name']}: {message}", details={"fields": fields, "decision": chosen["name"]})
        if code in {"optional_rule_disabled", "rule_conflict"}:
            raise RpcError("turn_state", message, details={"decision": chosen["name"], "optional_rule": envelope.get("optional_rule")})
        raise RpcError("internal", f"{chosen['name']} could not settle ({code}): {message}", details=thaw(failure))

    def _record_ticks(self, ctx: SettleContext) -> None:
        for receipt in ctx.receipts:
            check = receipt.get("check")
            if receipt.get("kind") != "roll" or not isinstance(check, dict) or receipt.get("visibility") == "keeper":
                continue
            actor = str(receipt.get("actor") or "")
            if ctx.sheet_by_id(actor) is None or receipt.get("roll_kind") not in ("skill_check", "healing_check", "opposed_check"):
                continue
            record_skill_tick(self.engine.tables, ctx.campaign_dir, ctx.campaign_id, actor, str(receipt["skill"]),
                              {**check, "kind": receipt.get("roll_kind")}, source_event_id=str(receipt["id"]),
                              source_kind=str(receipt.get("roll_kind")))

    # ---- result (11.6) --------------------------------------------------------------------

    def _shape(self, ctx: SettleContext, runtime: Any, chosen: dict[str, Any], envelope: dict[str, Any]) -> dict[str, Any]:
        result = thaw((envelope.get("settlement") or {}).get("result")) or {}
        family = chosen["family"]
        ref = chosen["decision_ref"]
        outcome = self._outcome(ref, family, result, ctx)
        continuations = [continuation_entry(runtime, str(r)) for r in result.get("next_continuations") or []]
        for card in envelope.get("next_decisions") or []:
            entry = continuation_entry(runtime, str(card["decision_ref"]))
            if entry["decision"] not in {c["decision"] for c in continuations}:
                continuations.append(entry)
        if ref == PSYCHOLOGY_OBSERVE_REF:
            continuations.append({"decision": "psychology:realize-player-safe", "action": ["decision", "target", "method"],
                                  "when": "the player is told what they can see; the die stays concealed"})
        rule_refs: list[str] = []
        for receipt in ctx.receipts:
            for ref_id in receipt.get("rule_refs") or []:
                if ref_id not in rule_refs:
                    rule_refs.append(ref_id)
        for ref_id in envelope.get("rule_refs") or []:
            if ref_id not in rule_refs:
                rule_refs.append(str(ref_id))
        for block in (result.get("luck_spend"), result.get("event"), (result.get("result") or {}).get("roll_result")):
            ref_id = (block or {}).get("rule_ref") if isinstance(block, dict) else None
            if isinstance(ref_id, str) and ref_id not in rule_refs:
                rule_refs.append(ref_id)
        session = result.get("session") if family in SESSION_FAMILIES else None
        pending = result.get("pending_choice") if family in SESSION_FAMILIES else None
        return {
            "kind": "settled", "decision": chosen["name"], "family": family, "outcome": outcome,
            "effects": list(ctx.effects), "continuations": continuations, "rule_refs": rule_refs,
            "receipts": ctx.receipts, "hints": list(envelope.get("hints") or []),
            "warnings": list(envelope.get("warnings") or []), "effect_kinds": runtime.effect_kinds_for(ref),
            "settlement": result, "session": session, "pending_choice": pending,
        }

    @staticmethod
    def _check_view(check: Mapping[str, Any]) -> dict[str, Any]:
        return {"skill": check.get("skill"), "target": check.get("target"), "difficulty": check.get("difficulty"),
                "threshold": check.get("threshold"), "roll": check.get("roll"), "level": check.get("level"),
                "passed": check.get("passed"), "bonus": check.get("bonus", 0), "penalty": check.get("penalty", 0)}

    def _outcome(self, ref: str, family: str, result: dict[str, Any], ctx: SettleContext) -> dict[str, Any]:
        bound = result.get("bound_check") if isinstance(result.get("bound_check"), dict) else {}
        if ref == ORDINARY_CHECK_REF or ref == "decision:coc7:push-luck:luck-roll":
            if bound.get("combined_roll"):
                combined = bound["combined_roll"]
                return {"kind": "combined", **self._check_view(bound), "mode": combined["comparison_mode"],
                        "targets": combined["targets"], "passed": combined["overall_success"], "pushed": False}
            return {"kind": "check", **self._check_view(bound), "pushed": False}
        if ref == COMBINED_CHECK_REF:
            combined = bound.get("combined_roll") or {}
            return {"kind": "combined", **self._check_view(bound), "mode": combined.get("comparison_mode"),
                    "targets": combined.get("targets") or [], "passed": combined.get("overall_success"), "pushed": False}
        if ref == OPPOSED_CHECK_REF:
            return {"kind": "opposed", "skill": result.get("skill"), "investigator": self._check_view({**result["investigator_roll"], "skill": result.get("skill")}),
                    "opponent": self._check_view({**result["opponent_roll"], "skill": result.get("opponent_skill")}),
                    "opponent_id": result.get("opponent_id"), "winner": result.get("winner")}
        if ref == PUSHED_ROLL_REF:
            return {"kind": "push", **self._check_view(bound), "pushed": True,
                    "source_receipt": result.get("original_check_decision_id"),
                    "failure_consequence": result.get("failure_consequence")}
        if ref == LUCK_SPEND_REF:
            spend = result.get("luck_spend") or {}
            return {"kind": "luck", "points": result.get("points"), "luck_before": spend.get("luck_before"),
                    "luck_after": spend.get("luck_after"), "source_receipt": spend.get("original_check_decision_id"),
                    **{k: spend.get(k) for k in ("skill", "target", "difficulty", "threshold", "roll", "level", "passed")}}
        if ref == SOCIAL_REF:
            adjudication = result.get("adjudication") or {}
            out = {"kind": "social", "npc": adjudication.get("npc_id"), "approach": adjudication.get("approach"),
                   "approach_skill": adjudication.get("approach_skill"), "feasibility": adjudication.get("feasibility"),
                   "base_difficulty": adjudication.get("base_difficulty"), "final_difficulty": adjudication.get("final_difficulty"),
                   "motive": adjudication.get("motive"), "leverage_delta": adjudication.get("leverage_delta")}
            if bound:
                out.update(self._check_view(bound))
            else:
                out["level"] = adjudication.get("feasibility")
                out["passed"] = adjudication.get("feasibility") == "automatic"
            return out
        if ref == PSYCHOLOGY_OBSERVE_REF:
            return {"kind": "psychology", "status": "observed", "npc": result.get("npc_id"), "insight_id": result.get("insight_id"),
                    "inference_depth": result.get("inference_depth"), "misread_policy": result.get("misread_policy"),
                    "concealed": True, "level": result.get("outcome"), "roll_visibility": "keeper"}
        if ref == PSYCHOLOGY_REALIZE_REF:
            return {"kind": "psychology", "status": "realized", "npc": result.get("npc_id"), "insight_id": result.get("insight_id"),
                    "external_behavior": (result.get("player_projection") or {}).get("external_behavior")}
        if family == "healing":
            event = result.get("event") or {}
            return {"kind": "healing", "status": event.get("event_type"), "skill": event.get("skill"), "roll": event.get("roll"),
                    "target": event.get("target"), "difficulty": event.get("difficulty"), "level": event.get("outcome"),
                    "passed": event.get("outcome") in ("regular", "hard", "extreme", "critical"),
                    "hp_before": event.get("hp_before"), "hp_after": result.get("current_hp"), "hp_gained": event.get("hp_gained"),
                    "conditions": result.get("conditions"), "summary": event.get("summary"), "patient": result.get("investigator_id")}
        if ref == CAST_SPELL_REF:
            cast = result.get("result") or {}
            roll = cast.get("roll_result") or {}
            return {"kind": "magic", "status": "cast" if cast.get("success") else "failed", "spell": (result.get("spell") or {}).get("canonical_name"),
                    "mp_spent": cast.get("mp_spent"), "hp_damage": cast.get("hp_damage"), "san_lost": cast.get("san_lost"),
                    "pow_spent": cast.get("pow_spent"), "side_effect": cast.get("side_effect"), "roll": roll.get("roll"),
                    "level": roll.get("level"), "passed": cast.get("success"), "first_cast": cast.get("is_first_cast")}
        if ref == LEARN_SPELL_REF:
            learn = result.get("result") or {}
            roll = learn.get("roll_result") or {}
            status = "learned" if result.get("known_now") else ("studying" if learn.get("learned") else "failed")
            return {"kind": "magic", "status": status, "spell": (result.get("spell") or {}).get("canonical_name"),
                    "source": result.get("source"), "study_days": learn.get("study_days"),
                    "study_due_minutes": result.get("study_due_minutes"), "roll": roll.get("roll"), "level": roll.get("level"),
                    "passed": learn.get("learned")}
        if family == "development":
            receipts = [s.get("receipt") for s in (result.get("development") or {}).get("settlements") or []]
            receipt = receipts[0] if receipts else result.get("receipt") or {}
            return {"kind": "development", "status": result.get("outcome") or "settled", "ending_id": result.get("ending_id"),
                    "ending_kind": result.get("kind"), "skills_improved": [
                        {"skill": r.get("skill"), "before": r.get("current_value_before_apply"), "after": r.get("value_after")}
                        for r in (receipt or {}).get("skills_improved") or []],
                    "luck_recovery": (receipt or {}).get("luck_recovery"), "san_before": (receipt or {}).get("san_before"),
                    "san_after": (receipt or {}).get("san_after")}
        if family == "combat":
            turn = result.get("turn") if isinstance(result.get("turn"), dict) else {}
            pending = result.get("pending_attack") if isinstance(result.get("pending_attack"), dict) else None
            status = ("ended" if result.get("status") == "concluded" else "pending_defense" if pending
                      else "started" if result.get("started") and not turn else "resolved")
            out: dict[str, Any] = {"kind": "combat", "status": status, "action": result.get("action"),
                                   "actor": result.get("actor_id"), "round": result.get("round"),
                                   "rolls": self._roll_views(ctx), "damage": self._damage_views(ctx)}
            if pending:
                out.update({"target": pending.get("target_actor_id"), "defense_options": defense_options(pending),
                            "attack_kind": pending.get("resolution_hint")})
            if turn:
                out.update({"target": turn.get("target_actor_id"), "turn_outcome": turn.get("outcome"),
                            "defense": turn.get("defense_kind"), "opposed_outcome": turn.get("opposed_outcome")})
            if result.get("status") == "concluded":
                out["combat_outcome"] = result.get("outcome")
            if result.get("started"):
                out["started"] = True
                out["initiative"] = result.get("initiative")
            return out
        if family == "chase":
            turn = result.get("turn") if isinstance(result.get("turn"), dict) else {}
            status = "ended" if result.get("status") == "concluded" else "started" if result.get("command") == "chase_start" else "moved"
            out = {"kind": "chase", "status": status, "action": result.get("command"), "actor": (turn or {}).get("actor_id"),
                   "round": result.get("round"), "actions_taken": list((turn or {}).get("actions_taken") or []),
                   "rolls": self._roll_views(ctx)}
            if result.get("command") == "chase_start":
                out["established"] = result.get("established")
                out["initiative"] = result.get("initiative")
            if result.get("status") == "concluded":
                out["chase_outcome"] = result.get("outcome")
            return out
        if family == "sanity":
            check = result.get("check") if isinstance(result.get("check"), dict) else {}
            out = {"kind": "sanity", "status": str(result.get("command") or "settled"), "san_before": result.get("san_before"),
                   "san_after": result.get("san_after"), "temporary_insane": result.get("temporary_insane"),
                   "indefinite_insane": result.get("indefinite_insane"), "permanently_insane": result.get("permanently_insane"),
                   "bout_active": result.get("bout_active"), "bout_rounds_remaining": result.get("bout_rounds_remaining")}
            if check:
                out.update({k: check.get(k) for k in ("skill", "target", "roll", "level", "passed", "san_loss")})
            for key in ("involuntary_action", "bout", "delusion_cleared", "san_gain", "san_recovered", "setback", "insight",
                        "insanity_state", "recovered"):
                if result.get(key) is not None:
                    out[key] = result[key]
            return out
        return {"kind": family, "status": str(result.get("outcome") or "settled")}

    @staticmethod
    def _roll_views(ctx: SettleContext) -> list[dict[str, Any]]:
        return [{"actor": r.get("actor"), "skill": r.get("skill"), "roll": r.get("roll"), "target": r.get("target"),
                 "level": r.get("level"), "passed": r.get("passed"), "receipt": r.get("id")}
                for r in ctx.receipts if r.get("kind") == "roll" and r.get("form") != "dice"]

    @staticmethod
    def _damage_views(ctx: SettleContext) -> list[dict[str, Any]]:
        return [{"actor": r.get("actor"), "label": r.get("skill"), "expression": r.get("expression"), "faces": r.get("faces"),
                 "total": r.get("total"), "receipt": r.get("id")}
                for r in ctx.receipts if r.get("kind") == "roll" and r.get("form") == "dice"]
