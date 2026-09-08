"""CoC 7e RuleGraph settlement adapter. Ported from rulesets/coc7/rule_graph_adapter.py.

The generic RulesRuntime owns applicability, grants and plan compilation; this
adapter owns what is CoC-specific: how facts are augmented from the selected
inputs, which host-locked slots each decision gets and from where, how a plan's
payload becomes executor arguments, and the composed flows that need more than
one executor call (social adjudication + bound check, psychology observe/realize,
ordinary check with push/luck continuations).

Re-cut from the old adapter: the in-memory `_*_frozen` idempotency stores are gone —
the kernel's call_id replay owns idempotency, and prior checks are read from turn
receipts through `ctx`. The `_RuntimeView` method-binding trick is replaced by
passing the runtime explicitly."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Callable, Mapping

from ..errors import RpcError
from .graph import RulesRuntime, freeze, split_executor_result, thaw

_CHECK_FAILURE_OUTCOMES = frozenset({"failure"})
_CHECK_FUMBLE_OUTCOMES = frozenset({"fumble"})
_RESOURCE_KEYS = frozenset({"hp", "mp", "luck", "san"})
_DAMAGE_KINDS = frozenset({"damage", "heal"})

ORDINARY_CHECK_REF = "decision:coc7:core-check:ordinary-check"
COMBINED_CHECK_REF = "decision:coc7:core-check:combined-check"
OPPOSED_CHECK_REF = "decision:coc7:core-check:opposed-check"
PUSHED_ROLL_REF = "decision:coc7:push-luck:pushed-roll"
LUCK_SPEND_REF = "decision:coc7:push-luck:luck-spend"
LUCK_ROLL_REF = "decision:coc7:push-luck:luck-roll"
SOCIAL_REF = "decision:coc7:social:adjudicate-difficulty"
PSYCHOLOGY_OBSERVE_REF = "decision:coc7:psychology:observe-concealed"
PSYCHOLOGY_REALIZE_REF = "decision:coc7:psychology:realize-player-safe"
COMBAT_CONTEXT_REF = "decision:coc7:combat:context"
SANITY_CONTEXT_REF = "decision:coc7:sanity:context"
CAST_SPELL_REF = "decision:coc7:magic:cast-spell"
LEARN_SPELL_REF = "decision:coc7:magic:learn-spell"
END_SESSION_REF = "decision:coc7:development:end-session"
SETTLE_ENDING_REF = "decision:coc7:development:settle-ending"

CORE_SETTLE_DECISION_REFS = (ORDINARY_CHECK_REF, COMBINED_CHECK_REF, OPPOSED_CHECK_REF)
PSYCHOLOGY_SETTLE_DECISION_REFS = (PSYCHOLOGY_OBSERVE_REF, PSYCHOLOGY_REALIZE_REF)
PSYCHOLOGY_REALIZATION_PUBLIC_KEYS = frozenset({"external_behavior"})
SESSION_FAMILIES = frozenset({"combat", "chase", "sanity"})
SANITY_CAPABILITIES = frozenset({"sanity.execute", "sanity.session.gain_san", "sanity.session.reality_check",
                                 "sanity.context", "time.recover_temporary_insanity", "time.apply_psychoanalysis_treatment"})
#: Decision suffix -> the sanity engine command it drives (the old `sanity.execute` kinds).
SANITY_COMMAND_KINDS = {
    "check": "sanity_check", "bout-tick": "bout_tick", "bout-end": "bout_end", "reality-check": "reality_check",
    "gain-current-san": "gain_current_san", "insane-insight": "insane_insight",
    "apply-treatment": "apply_psychoanalysis_treatment", "recover-temporary": "recover_temporary_insanity",
}


def semantic_slug(value: Any) -> str:
    return "-".join(token for token in "".join(
        ch.lower() if ch.isalnum() else " " for ch in str(value or "")).split() if token)


def sheet_check(sheet: Mapping[str, Any], ref: str) -> tuple[str, int] | None:
    """`skill:<slug>` / `characteristic:<slug>` -> (label, value) from the sheet."""
    kind, separator, slug = str(ref or "").partition(":")
    if not separator or not slug:
        return None
    if kind == "skill":
        for label, value in (sheet.get("skills") or {}).items():
            if semantic_slug(label) == semantic_slug(slug) and isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 100:
                return str(label), int(value)
    if kind == "characteristic":
        for label, value in (sheet.get("characteristics") or {}).items():
            if semantic_slug(label) == semantic_slug(slug) and isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 100:
                return str(label).upper(), int(value)
    return None


def npc_check(ctx: Any, ref: str) -> tuple[str, int] | None:
    """`npc:<npc_id>:skill:<slug>` -> (label, value) from the NPC's authored profile
    (`mechanics.profile.skills`, then `characteristics`)."""
    parts = str(ref or "").split(":")
    if len(parts) != 4 or parts[0] != "npc" or parts[2] not in ("skill", "characteristic"):
        return None
    profile = ctx.npc_profile(parts[1])
    if not isinstance(profile, Mapping):
        return None
    table = profile.get("skills" if parts[2] == "skill" else "characteristics")
    if not isinstance(table, Mapping):
        return None
    for label, value in table.items():
        if semantic_slug(label) == semantic_slug(parts[3]) and isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 100:
            return f"{parts[1]} {label}", int(value)
    return None


def _fail(runtime: RulesRuntime, plan: Mapping[str, Any], decision_id: str, code: str, message: str,
          **extra: Any) -> dict[str, Any]:
    return {"schema_version": runtime.SCHEMA_VERSION, "decision_ref": plan["decision_ref"], "decision_id": decision_id,
            "family": plan["family"], "status": code, "failure": {"code": code, "message": message, **extra}}


def _settled(envelope: dict[str, Any], plan: Mapping[str, Any], result: Any, warnings: list[str], hints: list[str],
             *, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    envelope.update({"status": "settled",
                     "settlement": {"existing_result_envelope": True, "execution": "canonical-resolver-subsystem",
                                    "plan": plan, "result": result}})
    if extra:
        envelope.update(extra)
    if warnings:
        envelope["warnings"] = warnings
    if hints:
        envelope["hints"] = hints
    return envelope


class Coc7RuleGraphAdapter:
    """Package adapter: `augment_facts`, `host_locked_provider`, `executor_args` and the
    composed settlements. `ctx` is the kernel's settlement context (runtime.py)."""

    def __init__(self, ctx: Any) -> None:
        self.ctx = ctx

    # ---- facts ----------------------------------------------------------------

    def augment_facts(self, runtime: RulesRuntime, selected: Mapping[str, Any] | None,
                      facts: Mapping[str, Any]) -> dict[str, Any]:
        augmented = dict(facts)
        augmented.setdefault("intent.rescuer_count", 1)
        semantic = (selected.get("semantic_inputs") if isinstance(selected, Mapping)
                    and isinstance(selected.get("semantic_inputs"), Mapping) else {})
        assistant = semantic.get("assistant_rescuer_ref")
        if isinstance(assistant, str) and assistant.strip():
            augmented["intent.rescuer_count"] = 2
        source_receipt = (selected.get("_host_source_receipt") if isinstance(selected, Mapping)
                          and isinstance(selected.get("_host_source_receipt"), Mapping) else {})
        if source_receipt:
            outcome = source_receipt.get("outcome")
            if isinstance(outcome, str) and outcome:
                augmented["receipt.last_outcome"] = outcome
            augmented["intent.pushed"] = bool(source_receipt.get("pushed", False))
            augmented["receipt.push_eligible"] = source_receipt.get("push_eligible") is not False
        spell = self.ctx.canonical_spell_name(str(semantic.get("spell") or "").strip())
        known = {self.ctx.canonical_spell_name(str(v)) for v in augmented.get("magic.known_spells") or []}
        augmented["magic.spell.known"] = bool(spell and spell in known)
        source_ref = str(semantic.get("source_ref") or "").strip()
        source_kind = str(semantic.get("source") or "").strip()
        sources = augmented.get("magic.learn.sources")
        source_spells = (sources.get(source_ref) if isinstance(sources, Mapping)
                         and isinstance(sources.get(source_ref), list) else [])
        has_any_source = isinstance(sources, Mapping) and any(isinstance(v, list) and v for v in sources.values())
        if spell and source_ref:
            augmented["magic.learn.source-available"] = bool(
                source_ref.startswith(source_kind + ":")
                and spell in {self.ctx.canonical_spell_name(str(v)) for v in source_spells})
        else:
            augmented["magic.learn.source-available"] = has_any_source
        return augmented

    # ---- host-locked slots ------------------------------------------------------

    def host_locked_provider(self, runtime: RulesRuntime, selected: Mapping[str, Any],
                             card_grant: Mapping[str, Any] | None = None) -> Callable[[str], Mapping[str, Any]]:
        ctx = self.ctx
        semantic = selected.get("semantic_inputs") if isinstance(selected.get("semantic_inputs"), Mapping) else {}

        def provider(decision_ref: str) -> Mapping[str, Any]:
            investigator_id = ctx.actor_id
            rescuer_id = str(semantic.get("rescuer_ref") or investigator_id)
            locked: dict[str, Any] = {}
            declared = runtime.declared_payload_slots(decision_ref)
            if "first-aid" in decision_ref:
                # Whoever is treating them, which may be someone with no sheet at all. This
                # used to fall through to the patient's own sheet when the rescuer was an NPC.
                value = ctx.actor_of_id_skill_value(rescuer_id, "First Aid")
                if value is not None:
                    locked["skill_value"] = value
                locked["rescuer_id"] = rescuer_id
                locked["pushed"] = bool(semantic.get("changed_method") or semantic.get("failure_consequence"))
                assistant_id = semantic.get("assistant_rescuer_ref")
                if isinstance(assistant_id, str) and assistant_id.strip():
                    assistant_id = assistant_id.strip()
                    assistant_value = ctx.skill_value(ctx.sheet_by_id(assistant_id), "First Aid")
                    if assistant_value is not None:
                        locked["assistant_skill_value"] = assistant_value
                        locked["assistant_rescuer_id"] = assistant_id
            elif "medicine" in decision_ref:
                value = ctx.actor_of_id_skill_value(rescuer_id, "Medicine")
                if value is not None:
                    locked["skill_value"] = value
                locked["rescuer_id"] = rescuer_id
            elif "weekly" in decision_ref:
                caregiver = str(semantic.get("rescuer_ref") or investigator_id)
                value = ctx.skill_value(ctx.sheet_by_id(caregiver) or {}, "Medicine")
                if value is not None:
                    locked["medicine_skill_value"] = value
                    locked["caregiver_id"] = caregiver
            elif decision_ref in CORE_SETTLE_DECISION_REFS or decision_ref == LUCK_ROLL_REF:
                sheet = ctx.sheet_by_id(investigator_id) or {}
                if "investigator_id" in declared:
                    locked["investigator_id"] = investigator_id
                if decision_ref == ORDINARY_CHECK_REF:
                    ref = (f"skill:{semantic['skill']}" if semantic.get("skill")
                           else f"characteristic:{semantic['characteristic']}" if semantic.get("characteristic") else "")
                    resolved = sheet_check(sheet, ref)
                    if resolved is not None:
                        locked["target"] = resolved[1]
                    elif semantic.get("skill"):
                        base = ctx.skill_value(sheet, str(semantic["skill"]))
                        if base is not None:
                            locked["target"] = base
                elif decision_ref == COMBINED_CHECK_REF:
                    rows = []
                    for ref in semantic.get("combined_target_refs") or []:
                        resolved = sheet_check(sheet, str(ref))
                        if resolved is None and str(ref).startswith("skill:"):
                            base = ctx.skill_value(sheet, str(ref)[len("skill:"):])
                            resolved = (str(ref)[len("skill:"):], base) if base is not None else None
                        if resolved is not None:
                            rows.append({"label": resolved[0], "value": resolved[1]})
                    if rows:
                        locked["combined_targets"] = rows
                elif decision_ref == OPPOSED_CHECK_REF:
                    actor = sheet_check(sheet, str(semantic.get("actor_check_ref") or ""))
                    if actor is None and str(semantic.get("actor_check_ref") or "").startswith("skill:"):
                        base = ctx.skill_value(sheet, str(semantic["actor_check_ref"])[len("skill:"):])
                        actor = (str(semantic["actor_check_ref"])[len("skill:"):], base) if base is not None else None
                    opponent = npc_check(ctx, str(semantic.get("opponent_check_ref") or ""))
                    if actor is not None:
                        locked["investigator_target"] = actor[1]
                    if opponent is not None:
                        locked["opponent_value"] = opponent[1]
                elif decision_ref == LUCK_ROLL_REF:
                    locked["target"] = int(sheet.get("current_luck") if sheet.get("current_luck") is not None
                                           else (sheet.get("characteristics") or {}).get("LUCK", 0))
            elif decision_ref in {PUSHED_ROLL_REF, LUCK_SPEND_REF}:
                check = selected.get("_host_source_receipt") if isinstance(selected.get("_host_source_receipt"), Mapping) else None
                source_id = str(selected.get("_host_source_receipt_id") or "")
                if check and source_id:
                    locked.update({"original_check_decision_id": source_id, "canonical_roll_receipt": thaw(check),
                                   "continuation_grant": thaw(dict(card_grant or {})),
                                   "investigator_id": check.get("investigator_id") or investigator_id})
                    if decision_ref == LUCK_SPEND_REF:
                        locked["source_roll_id"] = check.get("roll_id") or source_id
                    else:
                        for key in ("target", "difficulty", "bonus", "penalty", "skill"):
                            if check.get(key) is not None:
                                locked[key] = check[key]
            elif decision_ref == SOCIAL_REF:
                binding = selected.get("_host_social_binding") if isinstance(selected.get("_host_social_binding"), Mapping) else {}
                evidence = binding.get("motive_evidence")
                if isinstance(evidence, (list, tuple)):
                    locked["motive_evidence"] = list(evidence)
                if binding.get("npc_defense") is not None and "npc_defense" in declared:
                    locked["npc_defense"] = binding["npc_defense"]
            elif decision_ref in PSYCHOLOGY_SETTLE_DECISION_REFS:
                binding = selected.get("_host_psychology_binding") if isinstance(selected.get("_host_psychology_binding"), Mapping) else {}
                for key in ("investigator_id", "npc_id", "observer_skill", "target_opposing_social",
                            "conversation_window_id", "observation_revision", "observer_scope",
                            "observable_fact_refs", "inference_ceiling", "observation_receipt_ref"):
                    if key in declared and binding.get(key) is not None:
                        locked[key] = thaw(binding[key])
            elif runtime.family_of(decision_ref) in SESSION_FAMILIES:
                # Combat / chase / sanity: the session layer computed the binding from the
                # snapshots (resolve.py `_session_slots`); only declared slots travel — the
                # runtime refuses a host-locked input the decision never declared.
                binding = selected.get("_host_session_binding") if isinstance(selected.get("_host_session_binding"), Mapping) else {}
                for key, value in binding.items():
                    if value is not None and str(key) in declared and not str(key).startswith("_"):
                        locked[str(key)] = thaw(value)
            else:
                binding = selected.get("_host_family_binding") if isinstance(selected.get("_host_family_binding"), Mapping) else {}
                for key, value in binding.items():
                    if value is not None and str(key) in declared:
                        locked[str(key)] = thaw(value)
            return locked

        return provider

    # ---- executor arguments -------------------------------------------------------

    def _no_skill_for(self, actor_id: Any, skill: str) -> RpcError:
        """Nobody has said what this person has for the skill they are using. The way out
        depends on who they are: another investigator can be named, but an NPC's number has
        to be pinned once — the book gave none, and the kernel does not choose one."""
        actor_id = str(actor_id or "")
        node = self.ctx.npc_node(actor_id)
        if node is None:
            return RpcError("needs", f"the rescuer has no {skill} value on the sheet",
                            fix=f"name an investigator with {skill} as action.actor",
                            details={"needs": {"field": "actor", "options": self.ctx.party_names()}})
        who = self.ctx.graph.display_name(node)
        return RpcError("needs", f"the book gives {who} no {skill}",
                        fix=f"pin it once with apply npc {{name: \"{who}\", skill: {{name: \"{skill}\", "
                            "value: <0-100>}}, why: ...}} — it is theirs from then on",
                        details={"needs": {"field": "npc.skill", "options": []},
                                 "actor": actor_id, "skill": skill})

    def executor_args(self, plan: Mapping[str, Any], selected: Mapping[str, Any], decision_id: str) -> dict[str, Any]:
        payload = (plan.get("command") or {}).get("payload") or {}
        if not isinstance(payload, dict):
            payload = {}
        semantic = selected.get("semantic_inputs") if isinstance(selected.get("semantic_inputs"), Mapping) else {}
        investigator_id = self.ctx.actor_id
        out: dict[str, Any] = {"investigator": investigator_id, "decision_id": str(decision_id)}
        capability = (plan.get("capability") or {}).get("resolver_capability")
        if capability == "first_aid":
            if "skill_value" not in payload:
                raise self._no_skill_for(payload.get("rescuer_id") or semantic.get("rescuer_ref") or investigator_id,
                                         "First Aid")
            out.update({"skill_value": payload["skill_value"],
                        "rescuer_id": payload.get("rescuer_id") or semantic.get("rescuer_ref") or investigator_id,
                        "pushed": bool(payload.get("pushed", False))})
            for key in ("changed_method", "failure_consequence"):
                if semantic.get(key):
                    out[key] = semantic[key]
            assistant_ref = semantic.get("assistant_rescuer_ref")
            if isinstance(assistant_ref, str) and assistant_ref.strip():
                if payload.get("assistant_skill_value") is None or not isinstance(payload.get("assistant_rescuer_id"), str):
                    raise RpcError("unknown_entity", "the assistant rescuer has no First Aid value",
                                   details={"query": assistant_ref, "candidates": self.ctx.party_names()})
                out["assistant_skill_value"] = payload["assistant_skill_value"]
                out["assistant_rescuer_id"] = payload["assistant_rescuer_id"]
        elif capability == "medicine":
            if "skill_value" not in payload:
                raise self._no_skill_for(payload.get("rescuer_id") or semantic.get("rescuer_ref") or investigator_id,
                                         "Medicine")
            out.update({"skill_value": payload["skill_value"],
                        "rescuer_id": payload.get("rescuer_id") or semantic.get("rescuer_ref") or investigator_id})
        elif capability == "dying_check":
            out["clock_kind"] = payload.get("clock_kind")
        elif capability == "weekly_recovery":
            out["complete_rest"] = semantic.get("complete_rest", payload.get("complete_rest"))
            out["poor_environment"] = semantic.get("poor_environment", payload.get("poor_environment"))
            for key in ("medicine_skill_value", "caregiver_id"):
                if payload.get(key) is not None:
                    out[key] = payload[key]
        elif capability == "check":
            for key in ("skill", "characteristic", "target", "combined_targets", "combined_mode", "difficulty", "goal",
                        "stakes", "difficulty_basis", "bonus", "penalty", "npc_id", "social_adjudication_ref", "pushed",
                        "method_changed", "failure_consequence", "original_check_decision_id"):
                if payload.get(key) is not None:
                    out[key] = thaw(payload[key])
            if payload.get("characteristic") == "LUCK":
                out["characteristic"] = "LUCK"
        elif capability == "opposed":
            actor_ref = str(payload.get("actor_check_ref") or "")
            kind, _, label = actor_ref.partition(":")
            if kind == "skill" and label:
                out["skill"] = label
            elif kind == "characteristic" and label:
                out["characteristic"] = label.upper()
            else:
                raise RpcError("needs", "the opposed check needs the investigator's skill",
                               details={"needs": {"field": "skill", "options": []}})
            if payload.get("investigator_target") is not None:
                out["target"] = payload["investigator_target"]
            if payload.get("opponent_value") is None:
                raise RpcError("needs", "the opponent has no authored value for that skill",
                               fix="pick a skill the NPC's authored profile carries (details.needs.options)",
                               details={"needs": {"field": "skill",
                                                  "options": self.ctx.npc_skill_labels(str(payload.get("opponent_check_ref") or ""))}})
            out.update({"contest_kind": "noncombat", "opponent_value": payload["opponent_value"],
                        "opponent_label": str(payload.get("opponent_check_ref") or "opponent"),
                        "reason": "RuleGraph opposed check"})
        elif capability == "push_policy":
            out.pop("investigator", None)
            for key in ("original_check_decision_id", "method_changed", "failure_consequence", "target", "difficulty",
                        "bonus", "penalty", "skill", "canonical_roll_receipt"):
                if payload.get(key) is not None:
                    out[key] = thaw(payload[key])
        elif capability == "luck_spend":
            for key in ("points", "source_roll_id", "canonical_roll_receipt", "original_check_decision_id"):
                if payload.get(key) is not None:
                    out[key] = thaw(payload[key])
        elif capability == "social_difficulty":
            binding = selected.get("_host_social_binding") if isinstance(selected.get("_host_social_binding"), Mapping) else {}
            missing = [k for k in ("npc_id", "conversation_window_id", "commitment_id", "motive_evidence") if not binding.get(k)]
            if missing:
                raise RpcError("unknown_entity", "the social target could not be bound",
                               details={"missing": missing, "candidates": self.ctx.present_npc_names()})
            out.update({"npc_id": binding["npc_id"], "conversation_window_id": binding["conversation_window_id"],
                        "commitment_id": binding["commitment_id"], "approach": payload.get("approach"),
                        "goal_summary": payload.get("goal"), "described_action": payload.get("described_action"),
                        "motive": {"direction": payload.get("motive_direction"), "intensity": payload.get("motive_intensity"),
                                   "evidence_refs": list(binding["motive_evidence"])},
                        "feasibility": payload.get("feasibility"), "feasibility_refs": list(binding["motive_evidence"])})
            if payload.get("npc_defense") is not None:
                out["npc_defense_value"] = payload["npc_defense"]
            supporting = payload.get("supporting_action")
            if isinstance(supporting, Mapping) and supporting.get("level") == 1:
                source_ref = str(supporting.get("source_ref") or "").strip()
                if not source_ref:
                    raise RpcError("needs", "supporting_action level 1 requires the clue it rests on",
                                   details={"needs": {"field": "support", "options": self.ctx.discovered_clue_names()}})
                out["leverage"] = [{"leverage_id": str(supporting.get("leverage_id") or f"support:{source_ref}"),
                                    "source_ref": source_ref,
                                    "independence_group": str(supporting.get("independence_group") or source_ref),
                                    "credibility": "verified", "relevance": "direct",
                                    "reason": str(supporting.get("description") or "supporting case"),
                                    "type": str(supporting.get("type") or "supporting_action")}]
            else:
                out["leverage"] = []
        elif capability in {"psychology_check_contract", "psychology_policy"}:
            binding = selected.get("_host_psychology_binding") if isinstance(selected.get("_host_psychology_binding"), Mapping) else {}
            missing = [k for k in ("npc_id", "conversation_window_id", "observation_revision", "observer_scope") if binding.get(k) is None]
            if missing:
                raise RpcError("unknown_entity", "the Psychology target could not be bound",
                               details={"missing": missing, "candidates": self.ctx.present_npc_names()})
            out.update({"action": "realize" if capability == "psychology_policy" else "settle",
                        "npc_id": binding["npc_id"], "conversation_window_id": binding["conversation_window_id"],
                        "observation_revision": binding["observation_revision"], "observer_scope": binding["observer_scope"],
                        "question": str(payload.get("question") or binding.get("question") or "")})
            if capability == "psychology_check_contract":
                out["observable_fact_refs"] = list(binding.get("observable_fact_refs") or [])
                for key in ("observer_skill", "target_opposing_social"):
                    if payload.get(key) is not None:
                        out[key] = payload[key]
            else:
                out.update({"insight_id": binding.get("observation_receipt_ref"),
                            "inference_ceiling": payload.get("inference_ceiling") or binding.get("inference_ceiling"),
                            "visible_observation": payload.get("external_behavior")})
        elif capability in {"magic.cast", "magic.learn"}:
            out["spell"] = payload.get("spell")
            if capability == "magic.cast":
                out.update({"pushed": payload.get("pushed") is True, "interrupted": payload.get("interrupted") is True,
                            "is_npc": payload.get("is_npc") is True})
            else:
                out["source"] = payload.get("source")
                out["source_ref"] = payload.get("source_ref")
        elif capability == "state.end_session":
            out.update({"summary": payload.get("summary"), "kind": payload.get("kind")})
        elif capability == "development.settle":
            if payload.get("ending_id") is not None:
                out["ending_id"] = payload.get("ending_id")
        elif capability in {"combat.resolve", "combat.end", "combat.context"}:
            out.update(self._combat_args(plan, payload, selected))
        elif capability in SANITY_CAPABILITIES:
            out.update(self._sanity_args(plan, payload, selected, decision_id))
        elif capability == "chase.execute":
            out.update(self._chase_args(plan, payload, selected, decision_id))
        else:
            raise RpcError("not_implemented", f"no CoC7 adapter for capability {capability!r}",
                           details={"capability": capability, "decision": plan.get("decision_ref")})
        return out

    # -- session families (ported from the old executor_args, re-cut to the kernel) ------

    @staticmethod
    def _session_binding(selected: Mapping[str, Any]) -> dict[str, Any]:
        binding = selected.get("_host_session_binding")
        return dict(binding) if isinstance(binding, Mapping) else {}

    def _combat_args(self, plan: Mapping[str, Any], payload: Mapping[str, Any], selected: Mapping[str, Any]) -> dict[str, Any]:
        binding = self._session_binding(selected)
        action = str(plan.get("decision_ref") or "").rsplit(":", 1)[-1]
        out: dict[str, Any] = {"action_kind": action, "actor_id": binding.get("_actor_id") or self.ctx.actor_id,
                               "goal_text": binding.get("_goal_text")}
        for key in ("affordance_id", "target_npc_id", "weapon_id", "weapon_effect_ids", "combat_revision",
                    "defense_kind", "luck_spend_max", "goal", "outcome"):
            if payload.get(key) is not None:
                out[key] = thaw(payload[key])
        if action == "attack" and self.ctx.action.get("defense") == "none":
            out["unopposed"] = True
        if action == "end" and not out.get("outcome"):
            raise RpcError("needs", "combat:end needs the outcome the fight reached",
                           fix="set action.outcome to one of details.needs.options",
                           details={"needs": {"field": "outcome", "options": ["investigators_win", "monsters_win", "fled", "stalemate"]}})
        return out

    def _sanity_args(self, plan: Mapping[str, Any], payload: Mapping[str, Any], selected: Mapping[str, Any],
                     decision_id: str) -> dict[str, Any]:
        suffix = str(plan.get("decision_ref") or "").rsplit(":", 1)[-1]
        kind = SANITY_COMMAND_KINDS.get(suffix)
        if not kind:
            raise RpcError("not_implemented", f"unknown sanity phase {suffix!r}")
        command: dict[str, Any] = {"decision_id": str(decision_id)}
        if kind in {"bout_tick", "bout_end"}:
            command.update({"choice_id": payload.get("pending_choice_ref"), "responder": "keeper",
                            "revision": payload.get("bout_revision"), "action": "tick" if kind == "bout_tick" else "end"})
        elif kind == "sanity_check":
            command.update({"source": payload.get("source"), "san_loss_success": payload.get("loss_success", "0"),
                            "san_loss_fail_expr": payload.get("loss_failure"), "involuntary_kind": payload.get("involuntary_kind"),
                            "involuntary_summary": payload.get("involuntary_summary"), "trigger_id": payload.get("trigger_id")})
        elif kind == "reality_check":
            command["request_reality_check"] = payload.get("request_reality_check")
        elif kind == "gain_current_san":
            command.update({"san_gain": payload.get("san_gain"), "gain_source": payload.get("gain_source")})
        elif kind == "insane_insight":
            command.update({"insight": payload.get("insight"), "insanity_state": payload.get("insanity_state")})
        elif kind == "apply_psychoanalysis_treatment":
            command.update({"treatment_trigger_ref": payload.get("treatment_trigger_ref"),
                            "psychoanalysis_skill": payload.get("psychoanalysis_skill"), "safe_place": payload.get("safe_place")})
        elif kind == "recover_temporary_insanity":
            command.update({"recovery_trigger_ref": payload.get("recovery_trigger_ref"), "safe_place": payload.get("safe_place")})
        return {"command": {"command_id": f"{decision_id}:command", "kind": kind,
                            "phase": str((plan.get("command") or {}).get("phase") or "resolve"), "payload": command}}

    def _chase_args(self, plan: Mapping[str, Any], payload: Mapping[str, Any], selected: Mapping[str, Any],
                    decision_id: str) -> dict[str, Any]:
        binding = self._session_binding(selected)
        kind = "chase_" + str(plan.get("decision_ref") or "").rsplit(":", 1)[-1]
        command: dict[str, Any] = {"decision_id": str(decision_id)}
        for key in ("chase_id", "participants", "locations", "actor_id", "action_id", "choice_id", "skill", "target",
                    "difficulty", "roll_id", "revision", "target_actor_id", "combat_command_id", "outcome", "method"):
            if payload.get(key) is not None:
                command[key] = thaw(payload[key])
        for key in ("defense_kind", "weapon_id", "goal"):
            if binding.get(f"_{key}") is not None:
                command[key] = binding[f"_{key}"]
        return {"command": {"command_id": f"{decision_id}:command", "kind": kind, "phase": "resolve", "payload": command}}

    @staticmethod
    def is_context_only(decision_ref: str) -> bool:
        return decision_ref in (COMBAT_CONTEXT_REF, SANITY_CONTEXT_REF)

    def prepare_settlement(self, runtime: RulesRuntime, decision_ref: str, decision_id: str,
                           selected: Mapping[str, Any]) -> dict[str, Any]:
        return {}

    # ---- composed settlements -------------------------------------------------------

    def settle(self, runtime: RulesRuntime, executor: Callable[..., Any], plan: Mapping[str, Any], decision_id: str,
               selected: Mapping[str, Any], facts: Mapping[str, Any], envelope: dict[str, Any]) -> dict[str, Any] | None:
        method = {
            SOCIAL_REF: self._settle_social,
            PSYCHOLOGY_OBSERVE_REF: self._settle_psychology_observe,
            PSYCHOLOGY_REALIZE_REF: self._settle_psychology_realize,
            ORDINARY_CHECK_REF: self._settle_ordinary_check,
            COMBINED_CHECK_REF: self._settle_ordinary_check,
            PUSHED_ROLL_REF: self._settle_pushed_roll,
            LUCK_SPEND_REF: self._settle_luck_spend,
            LUCK_ROLL_REF: self._settle_luck_roll,
        }.get(str(plan.get("decision_ref") or ""))
        if method is None:
            return None
        return method(runtime, executor, plan, decision_id, selected, facts, envelope)

    # -- social ------------------------------------------------------------------

    @staticmethod
    def _validate_social_provenance(payload: Mapping[str, Any]) -> dict[str, Any] | None:
        direction = str(payload.get("motive_direction") or "")
        intensity = payload.get("motive_intensity")
        evidence = payload.get("motive_evidence")
        if isinstance(evidence, (tuple, frozenset)):
            evidence = list(evidence)
        if direction not in {"support", "neutral", "oppose"}:
            return {"code": "invalid_semantic_input", "message": "motive_direction must be support|neutral|oppose",
                    "fields": ["motive_direction"]}
        if isinstance(intensity, bool) or not isinstance(intensity, int) or intensity not in (0, 1, 2):
            return {"code": "invalid_semantic_input", "message": "motive_intensity must be 0, 1, or 2",
                    "fields": ["motive_intensity"]}
        if intensity > 0 and not (isinstance(evidence, list) and evidence):
            return {"code": "invalid_semantic_input", "message": "motive.intensity > 0 requires motive evidence",
                    "fields": ["motive_evidence"], "missing": ["motive_evidence"]}
        supporting = payload.get("supporting_action")
        if supporting is not None:
            if not isinstance(supporting, Mapping):
                return {"code": "invalid_semantic_input", "message": "supporting_action must be an object",
                        "fields": ["supporting_action"]}
            level = supporting.get("level", 0)
            if isinstance(level, bool) or not isinstance(level, int) or level not in {0, 1}:
                return {"code": "invalid_semantic_input", "message": "supporting_action.level must be 0 or 1",
                        "fields": ["supporting_action"]}
        return None

    def _settle_social(self, runtime, executor, plan, decision_id, selected, facts, envelope):
        """One social settlement: adjudicate, then (only when feasibility == roll) the
        machine-derived bound check through the same executor."""
        payload = (plan.get("command") or {}).get("payload") or {}
        provenance = self._validate_social_provenance(payload)
        if provenance is not None:
            return _fail(runtime, plan, decision_id, provenance["code"], provenance["message"],
                         **{k: v for k, v in provenance.items() if k not in ("code", "message")})
        adjudicated = executor(thaw(plan), decision_id, selected)
        data, warnings, hints = split_executor_result(adjudicated)
        if not isinstance(data, Mapping) or "feasibility" not in data:
            return _fail(runtime, plan, decision_id, "invalid_settlement_result",
                         "bound adjudication must return feasibility")
        feasibility = str(data.get("feasibility") or "")
        result: dict[str, Any] = {"adjudication": thaw(data)}
        if feasibility == "roll":
            derived = self._social_bound_check_plan(runtime, plan, data)
            check = executor(thaw(derived), decision_id, selected)
            check_data, check_warnings, check_hints = split_executor_result(check)
            warnings = list(warnings) + list(check_warnings)
            hints = list(hints) + list(check_hints)
            result["bound_check"] = thaw(check_data)
            result["bound_check_plan"] = freeze(derived)
            outcome = str((check_data or {}).get("outcome") or "")
            result["outcome"] = outcome
            result["next_continuations"] = self._continuations_after_check(runtime, selected, check_data, decision_id)
        else:
            hints = list(hints) + [f"feasibility is {feasibility}: no bound roll is settled"]
            if feasibility == "automatic":
                hints.append("automatic success — play the compliance in fiction")
            elif feasibility == "conditional":
                hints.append("the goal cannot be settled by a roll now; pursue the recorded requirements or change approach/target")
            result["outcome"] = feasibility
            result["next_continuations"] = []
        return _settled(envelope, plan, freeze(result), warnings, hints, extra={"visibility": "keeper-only"})

    def _social_bound_check_plan(self, runtime: RulesRuntime, plan: Mapping[str, Any],
                                 adjudication: Mapping[str, Any]) -> dict[str, Any]:
        payload = (plan.get("command") or {}).get("payload") or {}
        goal = str(payload.get("goal") or "").strip()
        check_payload = {
            "skill": str(adjudication.get("approach_skill") or ""),
            "difficulty": str(adjudication.get("final_difficulty") or "regular"),
            "bonus": int(adjudication.get("bonus_dice") or 0),
            "penalty": int(adjudication.get("penalty_dice") or 0),
            "difficulty_basis": "opponent_skill", "goal": goal,
            "stakes": {"on_success": "the described social action achieves its declared goal: " + goal,
                       "on_failure": "the described social action does not achieve its declared goal: " + goal},
            "npc_id": adjudication.get("npc_id"),
            "social_adjudication_ref": adjudication.get("goal_key"),
        }
        return {"schema_version": runtime.SCHEMA_VERSION, "decision_ref": plan["decision_ref"], "family": plan["family"],
                "capability": {"ref": "capability:coc7:check", "adapter": "resolver", "resolver_capability": "check"},
                "command": {"kind": "check", "phase": "resolve", "payload": freeze(check_payload)},
                "rule_refs": list(plan.get("rule_refs") or []), "source_refs": list(plan.get("source_refs") or []),
                "resource_effects": [], "visibility": "keeper-only", "pending_choices": [], "next_decisions": [],
                "machine_derived": True}

    # -- psychology -----------------------------------------------------------------

    def _settle_psychology_observe(self, runtime, executor, plan, decision_id, selected, facts, envelope):
        executed = executor(thaw(plan), decision_id, selected)
        data, warnings, hints = split_executor_result(executed)
        if not isinstance(data, Mapping):
            return _fail(runtime, plan, decision_id, "invalid_settlement_result", "concealed observation must return a record")
        ceiling = next((data.get(k) for k in ("inference_depth", "inference_ceiling") if isinstance(data.get(k), str) and data.get(k)), None)
        insight_id = data.get("insight_id")
        if ceiling is None or not isinstance(insight_id, str) or not insight_id:
            return _fail(runtime, plan, decision_id, "invalid_settlement_result",
                         "concealed observation result lacks durable insight identity or inference ceiling")
        continuation = runtime.card(PSYCHOLOGY_REALIZE_REF, runtime.facts_for_decision(selected))
        if continuation.get("applicability") == "applicable":
            runtime.issue_card_grant([continuation], source_decision_id=decision_id)
        hints = list(hints) + ["the roll and outcome are keeper-concealed: the player sees only the realization's "
                               "external_behavior; do not expose the die"]
        return _settled(envelope, plan, freeze(thaw(data)), warnings, hints, extra={"visibility": "concealed-result"})

    def _settle_psychology_realize(self, runtime, executor, plan, decision_id, selected, facts, envelope):
        realized = executor(thaw(plan), decision_id, selected)
        data, warnings, hints = split_executor_result(realized)
        if not isinstance(data, Mapping):
            return _fail(runtime, plan, decision_id, "invalid_settlement_result", "realization must return a projection")
        public = data.get("player_projection")
        if not isinstance(public, Mapping):
            return _fail(runtime, plan, decision_id, "concealed_projection_violation",
                         "realization has no player_projection; concealed dice/outcome must never surface publicly")
        leaked = sorted(set(public) - PSYCHOLOGY_REALIZATION_PUBLIC_KEYS)
        if leaked:
            return _fail(runtime, plan, decision_id, "concealed_projection_violation",
                         "player-safe realization leaked concealed fields", leaked=leaked)
        projection = {"external_behavior": thaw(public.get("external_behavior"))}
        concealed = data.get("concealed_result")
        return _settled(envelope, plan, freeze(thaw(data)), warnings, hints,
                        extra={"visibility": "public", "player_projection": deepcopy(projection),
                               "concealed_result": thaw(concealed) if isinstance(concealed, Mapping) else {}})

    # -- checks -------------------------------------------------------------------

    @staticmethod
    def _validate_ordinary_check_provenance(payload: Mapping[str, Any]) -> dict[str, Any] | None:
        skill = str(payload.get("skill") or "").strip()
        characteristic = str(payload.get("characteristic") or "").strip()
        if not skill and not characteristic and not payload.get("combined_targets"):
            return {"code": "invalid_semantic_input", "message": "ordinary check requires skill or characteristic",
                    "missing": ["skill"]}
        if str(payload.get("difficulty") or "").strip() not in {"regular", "hard", "extreme"}:
            return {"code": "invalid_semantic_input", "message": "difficulty must be regular, hard, or extreme",
                    "fields": ["difficulty"]}
        goal = payload.get("goal")
        if not isinstance(goal, str) or not goal.strip():
            return {"code": "invalid_semantic_input", "message": "goal must be a non-empty string", "fields": ["goal"]}
        if not isinstance(payload.get("stakes"), Mapping):
            return {"code": "invalid_semantic_input", "message": "stakes must be {on_success, on_failure}",
                    "fields": ["stakes"]}
        return None

    def _continuations_after_check(self, runtime: RulesRuntime, selected: Mapping[str, Any],
                                   data: Mapping[str, Any], decision_id: str) -> list[str]:
        """After an ordinary failure the player may push or spend Luck (not both); a
        fumble offers neither; a combat skill cannot be pushed."""
        outcome = str((data or {}).get("outcome") or "")
        if outcome not in _CHECK_FAILURE_OUTCOMES:
            return []
        refs = [PUSHED_ROLL_REF, LUCK_SPEND_REF] if data.get("push_eligible") is not False else [LUCK_SPEND_REF]
        continuation_selected = {**dict(selected), "_host_source_receipt": thaw(data)}
        cards = [runtime.card(ref, runtime.facts_for_decision(continuation_selected)) for ref in refs
                 if isinstance(runtime.nodes.get(ref), Mapping)]
        cards = [card for card in cards if card.get("applicability") == "applicable"]
        if cards:
            runtime.issue_card_grant(cards, source_decision_id=decision_id)
        return [str(card["decision_ref"]) for card in cards]

    def _settle_ordinary_check(self, runtime, executor, plan, decision_id, selected, facts, envelope):
        payload = (plan.get("command") or {}).get("payload") or {}
        provenance = self._validate_ordinary_check_provenance(payload)
        if provenance is not None:
            return _fail(runtime, plan, decision_id, provenance["code"], provenance["message"],
                         **{k: v for k, v in provenance.items() if k not in ("code", "message")})
        executed = executor(thaw(plan), decision_id, selected)
        data, warnings, hints = split_executor_result(executed)
        if not isinstance(data, Mapping):
            return _fail(runtime, plan, decision_id, "invalid_settlement_result", "ordinary check must return a roll record")
        outcome = str(data.get("outcome") or "")
        result = {"bound_check": thaw(data), "outcome": outcome, "pushed": False}
        if outcome in _CHECK_FAILURE_OUTCOMES:
            result["next_continuations"] = self._continuations_after_check(runtime, selected, data, decision_id)
            hints = list(hints) + [
                ("ordinary failure: the player may push this roll with a changed method and an announced "
                 "consequence, or spend Luck; not both") if data.get("push_eligible") is not False
                else "ordinary failure: this check cannot be pushed; the player may spend Luck instead"]
        elif outcome in _CHECK_FUMBLE_OUTCOMES:
            result["next_continuations"] = []
            hints = list(hints) + ["a fumble cannot be pushed or bought off with Luck"]
        else:
            result["next_continuations"] = []
        return _settled(envelope, plan, freeze(result), warnings, hints, extra={"visibility": "public"})

    def _settle_luck_roll(self, runtime, executor, plan, decision_id, selected, facts, envelope):
        executed = executor(thaw(plan), decision_id, selected)
        data, warnings, hints = split_executor_result(executed)
        if not isinstance(data, Mapping):
            return _fail(runtime, plan, decision_id, "invalid_settlement_result", "Luck roll must return a roll record")
        result = {"bound_check": thaw(data), "outcome": str(data.get("outcome") or ""), "luck_roll": True,
                  "next_continuations": []}
        hints = list(hints) + ["Luck may not be spent on Luck rolls (luck.json constraints)"]
        return _settled(envelope, plan, freeze(result), warnings, hints, extra={"visibility": "public"})

    def _settle_pushed_roll(self, runtime, executor, plan, decision_id, selected, facts, envelope):
        payload = (plan.get("command") or {}).get("payload") or {}
        method = str(payload.get("method_changed") or "").strip()
        consequence = str(payload.get("failure_consequence") or "").strip()
        if not method or not consequence:
            return _fail(runtime, plan, decision_id, "invalid_semantic_input",
                         "pushed roll requires method_changed and failure_consequence locked before the roll",
                         missing=[n for n, v in (("method_changed", method), ("failure_consequence", consequence)) if not v])
        if payload.get("player_confirmed_risk") is not True:
            return _fail(runtime, plan, decision_id, "invalid_semantic_input",
                         "pushed roll requires player_confirmed_risk=true after the Keeper announces the failure consequence",
                         fields=["player_confirmed_risk"])
        original_id = str(payload.get("original_check_decision_id") or "").strip()
        original = payload.get("canonical_roll_receipt")
        if not original_id or not isinstance(original, Mapping):
            return _fail(runtime, plan, decision_id, "rule_decision_not_applicable",
                         "pushed roll requires a frozen failed non-pushed ordinary check")
        original_outcome = str(original.get("outcome") or "")
        if original.get("pushed") or original.get("luck_roll"):
            return _fail(runtime, plan, decision_id, "rule_decision_not_applicable",
                         "only a failed non-pushed ordinary check may be pushed")
        if original_outcome in _CHECK_FUMBLE_OUTCOMES:
            return _fail(runtime, plan, decision_id, "rule_decision_not_applicable", "a fumble cannot be pushed; it is final")
        if original_outcome not in _CHECK_FAILURE_OUTCOMES:
            return _fail(runtime, plan, decision_id, "rule_decision_not_applicable",
                         "only an ordinary failed original check may be pushed")
        if self.ctx.receipt_continued(original_id):
            return _fail(runtime, plan, decision_id, "rule_decision_not_applicable", "push or spend Luck, but not both")
        executed = executor(thaw(plan), decision_id, selected)
        data, warnings, hints = split_executor_result(executed)
        if not isinstance(data, Mapping):
            return _fail(runtime, plan, decision_id, "invalid_settlement_result", "pushed roll must return a roll record")
        result = {"bound_check": thaw(data), "outcome": str(data.get("outcome") or ""), "pushed": True,
                  "original_check_decision_id": original_id, "failure_consequence": consequence,
                  "method_changed": method, "player_confirmed_risk": True, "next_continuations": []}
        hints = list(hints) + ["the recorded failure_consequence is authoritative; apply it if the pushed roll fails"]
        return _settled(envelope, plan, freeze(result), warnings, hints, extra={"visibility": "public"})

    def _settle_luck_spend(self, runtime, executor, plan, decision_id, selected, facts, envelope):
        payload = (plan.get("command") or {}).get("payload") or {}
        points = payload.get("points")
        if isinstance(points, bool) or not isinstance(points, int) or points <= 0:
            return _fail(runtime, plan, decision_id, "invalid_semantic_input", "points must be a positive integer",
                         fields=["points"])
        source_roll_id = str(payload.get("source_roll_id") or "").strip()
        if not source_roll_id:
            return _fail(runtime, plan, decision_id, "invalid_semantic_input",
                         "source_roll_id is host-locked from the original receipt", missing=["source_roll_id"])
        original_id = str(payload.get("original_check_decision_id") or "").strip()
        original = payload.get("canonical_roll_receipt")
        if isinstance(original, Mapping):
            if original.get("luck_roll") or str(original.get("skill") or "").upper() == "LUCK":
                return _fail(runtime, plan, decision_id, "rule_decision_not_applicable", "Luck may not be spent on Luck rolls")
            if original.get("pushed"):
                return _fail(runtime, plan, decision_id, "rule_decision_not_applicable", "Luck may not alter a pushed roll")
            if original_id and self.ctx.receipt_continued(original_id):
                return _fail(runtime, plan, decision_id, "rule_decision_not_applicable", "push or spend Luck, but not both")
        executed = executor(thaw(plan), decision_id, selected)
        data, warnings, hints = split_executor_result(executed)
        if not isinstance(data, Mapping):
            return _fail(runtime, plan, decision_id, "invalid_settlement_result", "Luck spend must return a receipt")
        result = {"luck_spend": thaw(data), "source_roll_id": source_roll_id, "points": points, "resource_key": "luck",
                  "outcome": str(data.get("outcome") or ""), "next_continuations": []}
        return _settled(envelope, plan, freeze(result), warnings, hints, extra={"visibility": "public"})
