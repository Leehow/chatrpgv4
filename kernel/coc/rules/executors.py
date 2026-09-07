"""Capability -> executor table. One entry per `resolver_capability` the RuleGraph's
capability nodes name; the adapter shapes a plan's payload into `args`, the executor
runs the engine, writes state through `ctx` and returns `(data, warnings, hints)`.

Session capabilities (`combat.*`, `chase.*`, `sanity.*`) register later through
`register()`; an unregistered capability answers `not_implemented` naming the family."""

from __future__ import annotations

import hashlib
from typing import Any, Callable, Mapping

from ..errors import RpcError, not_implemented, unsupported_value
from ..store import now_iso
from . import development, magic
from .adapter import npc_check
from .healing import HealingSession
from .mp import MPool
from .percentile import SUCCESS_OUTCOMES
from .skills import CHARACTERISTICS, SkillResolver

Executor = Callable[[Any, dict[str, Any], Mapping[str, Any]], tuple[Any, list[str], list[str]]]
EXECUTORS: dict[str, Executor] = {}


def register(capability: str) -> Callable[[Executor], Executor]:
    def wrap(fn: Executor) -> Executor:
        EXECUTORS[capability] = fn
        return fn
    return wrap


def run(ctx: Any, capability: str | None, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    handler = EXECUTORS.get(str(capability or ""))
    if handler is None:
        family = str(plan.get("family") or "")
        raise not_implemented(f"the {family} family's capability {capability!r} has no executor in this kernel yet",
                              details={"family": family, "capability": capability,
                                       "fix": f"the {family} family arrives with the session engines (second half of slice 1)"})
    return handler(ctx, args, plan)


# ---- checks -------------------------------------------------------------------

def _resolve_target(ctx: Any, args: dict[str, Any]) -> tuple[str, int, str, str]:
    """(label, target, target_source, kind) for a check. Host-locked `target` wins; a
    skill missing from the sheet falls back to the rulebook base (slice-0 rule)."""
    sheet = ctx.actor
    characteristic = args.get("characteristic")
    skill = args.get("skill")
    if characteristic:
        label = str(characteristic).upper()
        if label not in CHARACTERISTICS:
            raise RpcError("needs", f"unknown characteristic {characteristic!r}",
                           details={"needs": {"field": "skill", "options": list(CHARACTERISTICS)}})
        if args.get("target") is not None:
            return label, int(args["target"]), "explicit", "characteristic_check"
        return label, SkillResolver(ctx.tables, sheet).characteristic_value(label), "sheet", "characteristic_check"
    label = str(skill or "").strip()
    if not label:
        raise RpcError("needs", "the check names no skill", details={"needs": {"field": "skill", "options": []}})
    if args.get("target") is not None:
        source = "sheet" if label in (sheet.get("skills") or {}) else "rulebook_base"
        return label, int(args["target"]), source, "skill_check"
    resolver = SkillResolver(ctx.tables, sheet)
    canonical = resolver.resolve_explicit(label) or label
    try:
        target = resolver.target_value(canonical)
    except KeyError:
        raise RpcError("needs", f"no target value for {label!r}",
                       details={"needs": {"field": "skill", "options": resolver.options_for(label)}})
    source = "sheet" if canonical in (sheet.get("skills") or {}) else "rulebook_base"
    if canonical in CHARACTERISTICS:
        return canonical, target, "sheet", "characteristic_check"
    return canonical, target, source, "skill_check"


@register("check")
def execute_check(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    difficulty = str(args.get("difficulty") or "regular")
    bonus = int(args.get("bonus") or 0)
    penalty = int(args.get("penalty") or 0)
    pushed = bool(args.get("pushed"))
    combined = args.get("combined_targets")
    if isinstance(combined, list) and combined:
        label = " / ".join(str(row["label"]) for row in combined)
        target = max(int(row["value"]) for row in combined)
        target_source, kind = "sheet", "combined_skill_check"
    else:
        label, target, target_source, kind = _resolve_target(ctx, args)
    check = ctx.resolver.check(target, difficulty, bonus, penalty, rng=ctx.rng)
    data: dict[str, Any] = {
        **check, "investigator_id": ctx.actor_id, "skill": label, "target_source": target_source, "pushed": pushed,
        "goal": str(args.get("goal") or ""), "stakes": args.get("stakes") or {},
        "difficulty_basis": str(args.get("difficulty_basis") or "keeper"), "kind": kind,
        "decision": plan.get("decision_ref"),
    }
    data["push_eligible"] = kind == "skill_check" and ctx.resolver.skill_pushable(label) or kind == "characteristic_check"
    if isinstance(combined, list) and combined:
        mode = str(args.get("combined_mode") or "any")
        data["combined_roll"] = ctx.resolver.combined_roll(combined, roll=int(check["roll"]), required_level=difficulty,
                                                            comparison_mode=mode)
        data["improvement_tick_eligible"] = False
        data["push_eligible"] = False
        data["success"] = bool(data["combined_roll"]["overall_success"])
        data["passed"] = data["success"]
        if not data["success"]:
            data["outcome"] = data["level"] = data["achieved_level"] = "failure"
    for key in ("npc_id", "social_adjudication_ref"):
        if args.get(key) is not None:
            data[key] = args[key]
    hints: list[str] = []
    if pushed:
        consequence = {"summary": str(args.get("failure_consequence") or "")}
        data.update({"method_changed": str(args.get("method_changed") or ""), "failure_consequence": consequence,
                     "announced_consequence": consequence,
                     "pushed_roll_protocol": {"failure_consequence_source": "keeper", "keeper_foreshadowed_failure": True,
                                              "player_confirmation_recorded": True},
                     "original_check": {"decision_id": args.get("original_check_decision_id"),
                                        "roll_id": args.get("original_check_decision_id")}})
    receipt_id = ctx.add_roll(
        actor=ctx.actor_id, skill=label, target=data["target"], difficulty=difficulty, threshold=data["threshold"],
        roll=data["roll"], level=data["level"], passed=data["passed"], bonus=data["bonus"], penalty=data["penalty"],
        visibility=str(args.get("visibility") or "public"), pushed=pushed, kind=kind,
        source_receipt=args.get("original_check_decision_id") if pushed else None,
        check=dict(data),
    )
    data["roll_id"] = receipt_id
    if target_source == "rulebook_base":
        hints.append(f"{label} is not listed on the investigator sheet; used the canonical rulebook base chance {target}%")
    if data["outcome"] == "critical":
        hints.append("critical success: realize a source-bound benefit in the fiction")
    if data["outcome"] == "fumble":
        hints.append("fumble: realize a source-bound cost and its causal complication")
    if pushed and not data["success"]:
        hints.append("pushed roll failed: the announced consequence is authoritative")
    return data, [], hints


@register("opposed")
def execute_opposed(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    label, target, target_source, kind = _resolve_target(ctx, args)
    opponent_value = int(args["opponent_value"])
    opponent_label = str(args.get("opponent_label") or "opponent")
    settled = ctx.resolver.opposed(target, opponent_value, rng=ctx.rng)
    mine, theirs, winner = settled["investigator_roll"], settled["opponent_roll"], settled["winner"]
    parts = opponent_label.split(":")
    opponent_id = parts[1] if len(parts) == 4 else opponent_label
    authored = npc_check(ctx, opponent_label)
    opponent_skill = authored[0].split(" ", 1)[1] if authored else label
    my_id = ctx.add_roll(actor=ctx.actor_id, skill=label, target=mine["target"], difficulty="regular",
                         threshold=mine["threshold"], roll=mine["roll"], level=mine["level"], passed=mine["passed"],
                         bonus=0, penalty=0, visibility="public", kind="opposed_check", opposed_side="investigator",
                         contest_winner=winner, check={**mine, "investigator_id": ctx.actor_id, "skill": label,
                                                       "opposed_won": winner == "investigator", "kind": "opposed_check"})
    their_id = ctx.add_roll(actor=opponent_id, skill=opponent_skill, target=theirs["target"], difficulty="regular",
                            threshold=theirs["threshold"], roll=theirs["roll"], level=theirs["level"],
                            passed=theirs["passed"], bonus=0, penalty=0, visibility=str(args.get("opponent_visibility") or "public"),
                            kind="opposed_check", opposed_side="opponent", contest_winner=winner,
                            check={**theirs, "actor": opponent_id, "skill": opponent_skill, "kind": "opposed_check"})
    data = {"investigator_id": ctx.actor_id, "skill": label, "target_source": target_source, "investigator_roll": mine,
            "opponent_id": opponent_id, "opponent_skill": opponent_skill, "opponent_label": opponent_label,
            "opponent_roll": theirs, "winner": winner, "investigator_roll_id": my_id, "opponent_roll_id": their_id,
            "outcome": winner, "kind": "opposed_check"}
    hints = ["both sides failed: the situation stalls or worsens — narrate movement, not a freeze"] if winner == "none" else []
    return data, [], hints


@register("push_policy")
def execute_push(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    original = args.get("canonical_roll_receipt") or {}
    verdict = ctx.resolver.push_policy(original.get("outcome"), bool(original.get("pushed")), original.get("skill"))
    if verdict:
        raise RpcError("turn_state", f"the last check cannot be pushed: {verdict}",
                       fix="let the failure stand and narrate its consequence, or spend Luck with action.luck",
                       details={"source_receipt": args.get("original_check_decision_id")})
    check_args = {
        "skill": original.get("skill") if str(original.get("skill") or "").upper() not in CHARACTERISTICS else None,
        "characteristic": original.get("skill") if str(original.get("skill") or "").upper() in CHARACTERISTICS else None,
        "target": args.get("target", original.get("target")), "difficulty": args.get("difficulty", original.get("difficulty")),
        "bonus": args.get("bonus", original.get("bonus")), "penalty": args.get("penalty", original.get("penalty")),
        "goal": original.get("goal"), "stakes": original.get("stakes"), "difficulty_basis": original.get("difficulty_basis"),
        "pushed": True, "method_changed": args.get("method_changed"), "failure_consequence": args.get("failure_consequence"),
        "original_check_decision_id": args.get("original_check_decision_id"),
        "npc_id": original.get("npc_id"), "social_adjudication_ref": original.get("social_adjudication_ref"),
    }
    return execute_check(ctx, check_args, plan)


@register("luck_spend")
def execute_luck_spend(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    original = dict(args.get("canonical_roll_receipt") or {})
    points = int(args["points"])
    sheet = ctx.actor
    current_luck = int(sheet.get("current_luck") if sheet.get("current_luck") is not None
                       else (sheet.get("characteristics") or {}).get("LUCK", 0))
    try:
        recomputed = ctx.resolver.luck_spend(original, points, current_luck)
    except ValueError as exc:
        reason = str(exc)
        fixes = {
            "insufficient_luck": f"the investigator has {current_luck} Luck; spend at most that",
            "luck_may_only_alter_a_failed_roll": "the last check passed; there is nothing to buy",
            "criticals_fumbles_malfunctions_cannot_be_bought_off": "a fumble stands; spend less or accept it",
            "luck_may_not_alter_a_pushed_roll": "a pushed roll cannot be altered with Luck",
        }
        raise RpcError("invalid_params", f"luck spend refused: {reason}",
                       fix=fixes.get(reason, "check action.luck against luck.json constraints"),
                       details={"reason": reason, "current_luck": current_luck, "points": points})
    after = current_luck - points
    sheet["current_luck"] = after
    ctx.write_sheet(sheet)
    source_id = str(args.get("original_check_decision_id") or args.get("source_roll_id") or "")
    # The delta names the check it altered, so a later push finds the spend and refuses.
    ctx.add_delta("luck", ctx.actor_id, current_luck, after, source_receipt=source_id or None)
    ctx.mark_receipt_continued(source_id, "luck")
    # The bought result is a result: a push mints a receipt for its new roll and a Luck spend
    # did not, so the check it turned stayed `failure` in the record for ever, the success
    # lived only in this call's return, and `mechanics` showed the player a Luck spend with
    # nothing bought. Seen at the table: a search failed at 74, twenty-four Luck bought it to
    # 50, and the turn's receipts held no roll at all. `luck_bought` is not a continuable kind,
    # so nothing can be pushed off the back of it.
    bought_id = ctx.add_roll(
        actor=ctx.actor_id,
        skill=str(original.get("skill") or "check"),
        target=int(recomputed.get("target", original.get("target", 0))),
        difficulty=str(recomputed.get("difficulty", original.get("difficulty", "regular"))),
        threshold=int(recomputed.get("threshold", recomputed.get("target", original.get("target", 0)))),
        roll=int(recomputed["roll"]),
        level=str(recomputed.get("outcome") or recomputed.get("level") or ""),
        passed=bool(recomputed.get("passed")),
        visibility=str(original.get("visibility") or "public"),
        kind="luck_bought",
        source_receipt=source_id or None,
        skill_label=original.get("skill_label"),
        luck_spent=points,
    )
    data = {**recomputed, "investigator_id": ctx.actor_id, "points": points, "luck_before": current_luck,
            "luck_after": after, "source_roll_id": args.get("source_roll_id"), "original_check_decision_id": source_id,
            "bought_roll_id": bought_id, "kind": "luck_spend"}
    return data, [], ["Luck spent: no improvement tick for this check; the roll now reads {}".format(recomputed["roll"])]


# ---- social / psychology --------------------------------------------------------

@register("social_difficulty")
def execute_social(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    motive = args.get("motive") or {}
    leverage = args.get("leverage") or []
    request = {
        "approach": args.get("approach"), "motive_direction": motive.get("direction") or "neutral",
        "motive_intensity": motive.get("intensity", 0), "described_action": args.get("described_action") or "",
        "goal": args.get("goal_summary") or "", "motive_evidence": list(motive.get("evidence_refs") or []),
        "bonus": 0, "penalty": 0, "leverage_one_level": bool(leverage),
    }
    defense = args.get("npc_defense_value")
    try:
        policy = ctx.resolver.social_difficulty(request, defense)
    except ValueError as exc:
        raise RpcError("needs", str(exc), details={"needs": {"field": "skill", "options": ["Charm", "Fast Talk", "Intimidate", "Persuade"]}})
    goal_key = hashlib.sha256("\x00".join((str(args["npc_id"]), str(args["conversation_window_id"]),
                                           str(args["commitment_id"]))).encode("utf-8")).hexdigest()[:16]
    warnings: list[str] = []
    if defense is None:
        warnings.append(f"no authored social defense for npc {args['npc_id']!r}; base difficulty defaults to regular")
    data = {
        "schema_version": 2, "investigator_id": ctx.actor_id, "npc_id": args["npc_id"],
        "conversation_window_id": args["conversation_window_id"], "commitment_id": args["commitment_id"],
        "approach": args.get("approach"), "approach_skill": policy["approach_skill"],
        "goal_summary": request["goal"], "goal_key": goal_key, "feasibility": policy["feasibility"],
        "defense_value": defense, "defense_source": "authored" if defense is not None else "unknown",
        "base_difficulty": policy["base_difficulty"],
        "motive": {"direction": request["motive_direction"], "intensity": request["motive_intensity"],
                   "evidence_refs": request["motive_evidence"]},
        "motive_delta": policy["motive_adjustment"], "leverage": list(leverage),
        "leverage_delta": policy["strategic_adjustment"], "final_difficulty": policy["final_difficulty"],
        "bonus_dice": policy["bonus_dice"], "penalty_dice": policy["penalty_dice"],
        "feasibility_refs": list(args.get("feasibility_refs") or []), "resolution": "new",
    }
    return data, warnings, []


def _observations_document(ctx: Any) -> dict[str, Any]:
    document = ctx.read_save("psychology-observations.json") or {}
    document.setdefault("schema_version", 2)
    if not isinstance(document.get("observations"), dict):
        document["observations"] = {}
    if not isinstance(document.get("realizations"), dict):
        document["realizations"] = {}
    return document


@register("psychology_check_contract")
def execute_psychology_observe(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    observer_skill = args.get("observer_skill")
    contract = ctx.resolver.psychology_check_contract({
        "observer_skill": observer_skill, "target_opposing_social": args.get("target_opposing_social"),
        "question": str(args.get("question") or ""), "observable_facts": list(args.get("observable_fact_refs") or [])})
    check = ctx.resolver.check(int(contract["observer_skill"]), contract["difficulty"], 0, 0, rng=ctx.rng)
    policy = ctx.resolver.psychology_policy(check, "concrete_observation")
    window_key = "\x00".join((str(args["observer_scope"]), str(args["npc_id"]), str(args["conversation_window_id"]),
                              str(args["observation_revision"])))
    insight_id = f"psych-insight-{hashlib.sha256(window_key.encode('utf-8')).hexdigest()[:12]}"
    roll_id = ctx.add_roll(actor=ctx.actor_id, skill="Psychology", target=check["target"], difficulty=contract["difficulty"],
                           threshold=check["threshold"], roll=check["roll"], level=check["level"], passed=check["passed"],
                           bonus=0, penalty=0, visibility="keeper", kind="psychology_observe",
                           check={**check, "investigator_id": ctx.actor_id, "skill": "Psychology", "kind": "psychology_observe"})
    record = {
        "insight_id": insight_id, "window_key": window_key, "investigator_id": ctx.actor_id,
        "observer_scope": args["observer_scope"], "npc_id": args["npc_id"],
        "conversation_window_id": args["conversation_window_id"], "observation_revision": args["observation_revision"],
        "question": str(args.get("question") or ""), "observable_fact_refs": list(args.get("observable_fact_refs") or []),
        "observer_skill": contract["observer_skill"], "observer_skill_source": contract["observer_skill_source"],
        "difficulty": contract["difficulty"], "roll_id": roll_id, "outcome": check["outcome"],
        "inference_depth": policy["inference_depth"], "misread_policy": policy["misread_policy"], "created_at": now_iso(),
    }
    document = _observations_document(ctx)
    document["observations"][window_key] = record
    ctx.write_save("psychology-observations.json", document)
    data = {"resolution": "settled", **{k: v for k, v in record.items() if k not in ("created_at",)}}
    return data, [], ["this window is locked until the conversation moves on; do not reroll Psychology on it"]


@register("psychology_policy")
def execute_psychology_realize(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    insight_id = str(args.get("insight_id") or "")
    visible = str(args.get("visible_observation") or "").strip()
    document = _observations_document(ctx)
    matching = next((row for row in document["observations"].values()
                     if isinstance(row, dict) and row.get("insight_id") == insight_id), None)
    if not insight_id or matching is None:
        raise RpcError("turn_state", "no settled Psychology observation to realize for this NPC",
                       fix="observe first (decision psychology:observe-concealed), then realize")
    if not visible:
        raise RpcError("needs", "the realization needs the behavior the player may see",
                       fix="put the player-safe observation in action.method",
                       details={"needs": {"field": "method", "options": []}})
    try:
        policy = ctx.resolver.psychology_policy(
            {"inference_ceiling": args.get("inference_ceiling") or matching.get("inference_depth"),
             "external_behavior": visible}, "realize")
    except ValueError as exc:
        raise RpcError("invalid_params", str(exc))
    data = {"insight_id": insight_id, "npc_id": matching.get("npc_id"),
            "conversation_window_id": matching.get("conversation_window_id"),
            "player_projection": policy["player_projection"], "concealed_result": policy["concealed_result"],
            "bound_to_observe": matching.get("roll_id"), "realized_at": now_iso()}
    document["realizations"][insight_id] = data
    ctx.write_save("psychology-observations.json", document)
    return data, [], ["only player_projection.external_behavior may reach the player"]


# ---- healing --------------------------------------------------------------------

def _healing_session(ctx: Any) -> HealingSession:
    """The patient's session, with the state as it stood before this settlement kept
    on the instance (`before_hp`, `before_conditions`) for the receipts."""
    sheet = ctx.subject
    derived = sheet.get("derived") or {}
    characteristics = sheet.get("characteristics") or {}
    session = HealingSession.load(ctx.tables, ctx.campaign_dir, ctx.subject_id, int(derived.get("HP") or 10),
                                  int(characteristics.get("CON") or 50), ctx.rng, current_hp=sheet.get("current_hp"))
    session.before_hp = session.current_hp
    session.before_conditions = list(session.conditions)
    return session


def _finish_healing(ctx: Any, session: HealingSession, event: dict[str, Any], *, rescuer_id: str | None,
                    skill_label: str | None, extra_rolls: list[tuple[str, dict[str, Any]]] | None = None) -> dict[str, Any]:
    before_hp = int(session.before_hp)
    before_conditions = list(session.before_conditions)
    event.setdefault("hp_before", before_hp)
    event.setdefault("skill", skill_label)
    session.save(ctx.campaign_dir)
    ctx.sync_healing(ctx.subject_id, session.current_hp, list(session.conditions))
    check = event.get("check")
    if isinstance(check, dict) and skill_label:
        event["roll_id"] = ctx.add_roll(actor=rescuer_id or ctx.actor_id, skill=skill_label, target=check["target"],
                                        difficulty=check["difficulty"], threshold=check["threshold"], roll=check["roll"],
                                        level=check["level"], passed=check["passed"], bonus=check.get("bonus", 0),
                                        penalty=check.get("penalty", 0), visibility="public", kind="healing_check",
                                        pushed=bool(event.get("pushed")),
                                        check={**check, "investigator_id": rescuer_id or ctx.actor_id, "skill": skill_label,
                                               "kind": "healing_check"})
    for label, dice in extra_rolls or []:
        if isinstance(dice, dict):
            ctx.add_dice_roll(actor=rescuer_id or ctx.actor_id, label=label, expression=dice.get("expression"),
                              faces=dice.get("raw") or dice.get("rolls") or [], total=dice.get("total"))
    if session.current_hp != before_hp:
        ctx.add_delta("hp", ctx.subject_id, before_hp, session.current_hp)
    if list(session.conditions) != before_conditions:
        ctx.add_effect("condition", ctx.subject_id, before_conditions, list(session.conditions))
    return {"investigator_id": ctx.subject_id, "rescuer_id": rescuer_id, "event": event,
            "current_hp": session.current_hp, "conditions": list(session.conditions),
            "player_state_receipt": {"schema_version": 1, "investigator_id": ctx.subject_id,
                                     "hp": {"before": before_hp, "after": session.current_hp},
                                     "conditions_before": before_conditions, "conditions_after": list(session.conditions)},
            "events": list(session.events)}


@register("first_aid")
def execute_first_aid(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    session = _healing_session(ctx)
    event = session.first_aid(int(args["skill_value"]), pushed=bool(args.get("pushed")), rescuer_id=args.get("rescuer_id"),
                              assistant_skill_value=args.get("assistant_skill_value"),
                              assistant_rescuer_id=args.get("assistant_rescuer_id"))
    data = _finish_healing(ctx, session, event, rescuer_id=str(args.get("rescuer_id") or ctx.actor_id), skill_label="First Aid")
    hints = [event.get("summary", "")] if event.get("summary") else []
    if event.get("already_used_today") or event.get("push_unavailable") or event.get("push_already_used"):
        hints.append("First Aid is once per wound per day; Medicine or rest are the remaining routes")
    return data, [], hints


@register("medicine")
def execute_medicine(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    session = _healing_session(ctx)
    minutes_since = ctx.minutes_since_injury()
    same_day = minutes_since is None or minutes_since < 24 * 60
    event = session.medicine(int(args["skill_value"]), same_day=same_day)
    data = _finish_healing(ctx, session, event, rescuer_id=str(args.get("rescuer_id") or ctx.actor_id), skill_label="Medicine",
                           extra_rolls=[("Medicine 1D3", event.get("healing_dice"))] if event.get("healing_dice") else None)
    return data, [], [event.get("summary", "")] if event.get("summary") else []


@register("dying_check")
def execute_dying_check(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    session = _healing_session(ctx)
    clock_kind = str(args.get("clock_kind") or "round")
    event = session.dying_con_roll() if clock_kind == "round" else session.stabilized_con_roll()
    data = _finish_healing(ctx, session, event, rescuer_id=None, skill_label="CON")
    data["clock_kind"] = clock_kind
    return data, [], [event.get("summary", "")]


@register("weekly_recovery")
def execute_weekly_recovery(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    session = _healing_session(ctx)
    medical_care_success: bool | None = None
    medicine_fumbled = False
    extra: list[tuple[str, dict[str, Any]]] = []
    care_roll = None
    if args.get("medicine_skill_value") is not None:
        care_roll = ctx.resolver.check(int(args["medicine_skill_value"]), "regular", 0, 0, rng=ctx.rng)
        medical_care_success = care_roll["outcome"] in SUCCESS_OUTCOMES
        medicine_fumbled = care_roll["outcome"] == "fumble"
        ctx.add_roll(actor=str(args.get("caregiver_id") or ctx.actor_id), skill="Medicine", target=care_roll["target"],
                     difficulty="regular", threshold=care_roll["threshold"], roll=care_roll["roll"], level=care_roll["level"],
                     passed=care_roll["passed"], bonus=0, penalty=0, visibility="public", kind="healing_check",
                     check={**care_roll, "skill": "Medicine", "kind": "healing_check"})
    event = session.major_wound_recovery_roll(complete_rest=bool(args.get("complete_rest")),
                                              medical_care_success=medical_care_success,
                                              poor_environment=bool(args.get("poor_environment")),
                                              medicine_fumbled=medicine_fumbled,
                                              attempt_elapsed_minutes=ctx.clock_minutes)
    if event.get("healing_dice"):
        extra.append(("recovery", event["healing_dice"]))
    data = _finish_healing(ctx, session, event, rescuer_id=None, skill_label="CON", extra_rolls=extra)
    data["medical_care_roll"] = care_roll
    return data, [], [event.get("summary", "")]


# ---- magic ----------------------------------------------------------------------

def _caster_state(sheet: dict[str, Any]) -> dict[str, Any]:
    characteristics = sheet.get("characteristics") or {}
    return {"pow": int(characteristics.get("POW") or 0), "int": int(characteristics.get("INT") or 0),
            "current_mp": int(sheet.get("current_mp") or 0), "current_hp": int(sheet.get("current_hp") or 0),
            "current_san": int(sheet.get("current_san") or 0)}


@register("magic.cast")
def execute_magic_cast(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    sheet = ctx.actor
    spell = ctx.canonical_spell_name(str(args.get("spell") or ""))
    state = magic.read_magic_state(ctx.campaign_dir, ctx.actor_id)
    caster = _caster_state(sheet)
    pool = MPool.load(ctx.tables, ctx.campaign_dir, ctx.actor_id, caster["pow"], ctx.rng,
                      current_mp=caster["current_mp"], current_hp=caster["current_hp"])
    cast_spells = {str(v) for v in state["cast_spells"]}
    try:
        result = magic.cast_spell(ctx.tables, ctx.catalog, spell, caster, is_first_cast=spell not in cast_spells,
                                  is_npc=args.get("is_npc") is True, pushed=args.get("pushed") is True,
                                  interrupted=args.get("interrupted") is True, rng=ctx.rng, mp_pool=pool,
                                  module_spells=ctx.module_spells)
    except magic.UnpricedSpellError as exc:
        raise RpcError("invalid_params", str(exc), fix="author cost_mp/cost_sanity on the module spell node or adjudicate the cast in the fiction",
                       details={"spell": exc.spell, "module_node_id": exc.node_id, "unpriced_fields": exc.missing})
    except KeyError as exc:
        raise RpcError("unknown_entity", f"unknown spell {spell!r}",
                       details={"query": spell, "candidates": ctx.spell_candidates(spell)}) from exc
    if result.get("success") and spell not in cast_spells:
        state["cast_spells"].append(spell)
    magic.write_magic_state(ctx.campaign_dir, ctx.actor_id, state)
    pool.save(ctx.campaign_dir)
    roll = result.get("roll_result")
    if isinstance(roll, dict):
        result["roll_id"] = ctx.add_roll(actor=ctx.actor_id, skill="POW", target=roll["target"], difficulty="hard",
                                         threshold=roll["threshold"], roll=roll["roll"], level=roll["level"],
                                         passed=roll["passed"], bonus=0, penalty=0, visibility="public", kind="casting_roll",
                                         check={**roll, "investigator_id": ctx.actor_id, "skill": "POW", "kind": "casting_roll"})
    before = _caster_state(sheet)
    after = {"current_mp": pool.current_mp, "current_hp": pool.current_hp if pool.current_hp is not None else caster["current_hp"],
             "current_san": caster["current_san"]}
    for resource, key in (("mp", "current_mp"), ("hp", "current_hp"), ("san", "current_san")):
        if after[key] != before[key]:
            sheet[key] = after[key]
            ctx.add_delta(resource, ctx.actor_id, before[key], after[key])
    ctx.write_sheet(sheet)
    if after["current_hp"] < before["current_hp"]:
        ctx.record_wound(ctx.actor_id, source=result.get("roll_id"))
    data = {"schema_version": 1, "authority": "coc7_magic_runtime", "investigator_id": ctx.actor_id,
            "spell": {"canonical_name": spell}, "result": result, "outcome": "success" if result.get("success") else "failure",
            "side_effect": result.get("side_effect")}
    return data, [], [str(result.get("summary") or "")]


@register("magic.learn")
def execute_magic_learn(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    sheet = ctx.actor
    spell = ctx.canonical_spell_name(str(args.get("spell") or ""))
    source = str(args.get("source") or "tome")
    state = magic.read_magic_state(ctx.campaign_dir, ctx.actor_id)
    try:
        result = magic.learn_spell(ctx.tables, ctx.catalog, spell, _caster_state(sheet), source, rng=ctx.rng,
                                   clock_minutes=ctx.clock_minutes, module_spells=ctx.module_spells)
    except KeyError as exc:
        raise RpcError("unknown_entity", f"unknown spell {spell!r}",
                       details={"query": spell, "candidates": ctx.spell_candidates(spell)}) from exc
    roll = result.get("roll_result")
    if isinstance(roll, dict):
        result["roll_id"] = ctx.add_roll(actor=ctx.actor_id, skill="INT", target=roll["target"], difficulty=roll["difficulty"],
                                         threshold=roll["threshold"], roll=roll["roll"], level=roll["level"],
                                         passed=roll["passed"], bonus=0, penalty=0, visibility="public", kind="learning_roll",
                                         check={**roll, "investigator_id": ctx.actor_id, "skill": "INT", "kind": "learning_roll"})
    learned_now = False
    if result.get("learned"):
        due = result.get("study_completion_elapsed_minutes")
        if due is not None and source in ("tome", "person"):
            state["studying_spells"] = [row for row in state["studying_spells"]
                                        if not (isinstance(row, dict) and str(row.get("spell") or "") == spell)]
            state["studying_spells"].append({"spell": spell, "source": source, "source_ref": args.get("source_ref"),
                                             "study_weeks": int(result.get("study_weeks") or 0),
                                             "study_days": int(result.get("study_days") or 0),
                                             "due_elapsed_minutes": int(due)})
        elif spell not in {str(v) for v in state["learned_spells"]}:
            state["learned_spells"].append(spell)
            learned_now = True
    magic.write_magic_state(ctx.campaign_dir, ctx.actor_id, state)
    data = {"schema_version": 1, "authority": "coc7_magic_runtime", "investigator_id": ctx.actor_id,
            "spell": {"canonical_name": spell}, "source": source, "source_ref": args.get("source_ref"), "result": result,
            "outcome": "learned" if result.get("learned") else "failure", "known_now": learned_now,
            "study_due_minutes": result.get("study_completion_elapsed_minutes")}
    return data, [], [str(result.get("summary") or "")]


# ---- development ------------------------------------------------------------------

def _apply_settlement_effects(ctx: Any, investigator_id: str, before: dict[str, Any], sheet: dict[str, Any],
                              receipt: dict[str, Any]) -> None:
    if sheet.get("current_luck") != before.get("current_luck"):
        ctx.add_delta("luck", investigator_id, before.get("current_luck"), sheet.get("current_luck"))
    if sheet.get("current_san") != before.get("current_san"):
        ctx.add_delta("san", investigator_id, before.get("current_san"), sheet.get("current_san"))
    for row in receipt.get("skills_improved") or []:
        ctx.add_effect("skill", investigator_id, row.get("current_value_before_apply"), row.get("value_after"),
                       skill=row.get("skill"))


@register("state.end_session")
def execute_end_session(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    kind = str(args.get("kind") or "conclusion")
    if kind not in development.ENDING_KINDS:
        raise unsupported_value("kind", kind, list(development.ENDING_KINDS),
                                message=f"unknown session ending kind {kind!r}")
    sheets = {str(s["id"]): s for s in ctx.party()}
    record = {"event_type": "session_ending", "scene_id": ctx.active_scene, "kind": kind, "decision_id": ctx.call_id,
              "investigator_ids": sorted(sheets), "summary": args.get("summary") or None}
    ending_id = development.ending_id_for_event(record)
    capsule = development.load_ending_capsule(ctx.campaign_dir, ending_id)
    if capsule is None:
        capsule = development.build_ending_capsule(ctx.tables, ctx.campaign_dir, record, sheets,
                                                   luck_recovery_gate=ctx.luck_recovery_gate(), captured_at=now_iso())
        development.persist_ending_capsule(ctx.campaign_dir, capsule)
    settlements = []
    for investigator_id in capsule["investigator_ids"]:
        sheet = sheets[investigator_id]
        before = {"current_luck": sheet.get("current_luck"), "current_san": sheet.get("current_san")}
        receipt = development.run_development_phase(ctx.tables, ctx.campaign_dir, investigator_id, sheet, capsule)
        ctx.write_sheet(sheet)
        _apply_settlement_effects(ctx, investigator_id, before, sheet, receipt)
        settlements.append({"investigator_id": investigator_id, "status": "PASS", "receipt": receipt})
    data = {"session_ending": True, "scene_id": ctx.active_scene, "kind": kind, "summary": record["summary"],
            "investigator_ids": capsule["investigator_ids"], "ending_id": ending_id,
            "development": {"status": "PASS", "ending_id": ending_id, "settlements": settlements}, "outcome": "settled"}
    return data, [], ["the session ending is durable; development has been settled for every investigator"]


@register("development.settle")
def execute_development_settle(ctx: Any, args: dict[str, Any], plan: Mapping[str, Any]) -> tuple[Any, list[str], list[str]]:
    ending_id = str(args.get("ending_id") or "")
    if not ending_id:
        pending = [e for e, inv in development.pending_settlements(ctx.campaign_dir) if inv == ctx.actor_id]
        if not pending:
            raise RpcError("turn_state", "no ending awaits development settlement for this investigator",
                           fix="end the session first (decision development:end-session)")
        ending_id = pending[-1]
    capsule = development.load_ending_capsule(ctx.campaign_dir, ending_id)
    if capsule is None:
        raise RpcError("unknown_entity", f"no ending {ending_id!r} is recorded", details={"query": ending_id, "candidates": []})
    sheet = ctx.actor
    before = {"current_luck": sheet.get("current_luck"), "current_san": sheet.get("current_san")}
    receipt = development.run_development_phase(ctx.tables, ctx.campaign_dir, ctx.actor_id, sheet, capsule)
    ctx.write_sheet(sheet)
    if not receipt.get("replayed"):
        _apply_settlement_effects(ctx, ctx.actor_id, before, sheet, receipt)
    data = {"ending_id": ending_id, "investigator_id": ctx.actor_id, "receipt": receipt,
            "outcome": "replayed" if receipt.get("replayed") else "settled"}
    return data, [], ["development settlement is complete and safe to report"]
from . import session_executors  # noqa: E402,F401 - registers the session capabilities
