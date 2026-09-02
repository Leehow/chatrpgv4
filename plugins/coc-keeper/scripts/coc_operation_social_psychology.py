#!/usr/bin/env python3
"""Operation adapter cell: social-psychology."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
    _canonical_digest,
    _clue_by_id,
    _jsonl_rows,
    _load_json_document,
    _now_iso,
    _npc_by_id,
    _replay_bound_decision,
    _request_digest,
    _resolve_investigator,
    _roll_common,
    _rules_resolver,
    _save_json_document,
    deepcopy,
    hashlib,
    json,
    tool,
)

def _npc_authored_skill_value(ctx: Ctx, npc_id: str, skill: str) -> int | None:
    """One numeric skill from the optional npc-agendas `skills` block."""
    npc = _npc_by_id(ctx.npc_agendas, npc_id)
    if not isinstance(npc, dict):
        return None
    skills = npc.get("skills") if isinstance(npc.get("skills"), dict) else {}
    value = skills.get(skill)
    if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 100:
        return value
    return None

def _npc_authored_social_defense(
    ctx: Ctx, npc_id: str, defense_skills: list[str]
) -> tuple[int | None, str | None]:
    """Resolve the highest authored value from package-declared defense skills."""
    candidates = [
        (skill, value)
        for skill in defense_skills
        if (value := _npc_authored_skill_value(ctx, npc_id, skill)) is not None
    ]
    if not candidates:
        return None, None
    key, value = max(candidates, key=lambda row: row[1])
    return value, key


def _observer_psychology_skill(
    ctx: Ctx, investigator_id: str, base_chance: int
) -> tuple[int, str]:
    """Host-lock observer Psychology, defaulting to the package 10% base."""
    sheet = ctx.sheet(investigator_id)
    skills = sheet.get("skills") if isinstance(sheet, dict) else {}
    if not isinstance(skills, dict):
        return base_chance, "rulebook_base"
    value = skills.get("Psychology")
    if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 100:
        return value, "sheet"
    return base_chance, "rulebook_base"

# The closed set `_resolve_contract_ref` dispatches on. Published on the
# `supporting_action` shape and named in every rejection: a Keeper that cannot
# spell a source_ref cannot claim leverage, and the player's earned clue then
# counts for nothing. Seen live on 2026-09-02 -- the Keeper wrote
# `level: 1` correctly, spelled the ref `player_input:current`, was told only
# that it "does not resolve", and downgraded its own claim to level 0 with
# `clue-crown-slab-heraldry` sitting in the provenance field it had just
# filled in.
LEVERAGE_SOURCE_KINDS: tuple[str, ...] = (
    "npc_agenda", "npc_fact", "npc_state", "clue", "event",
)


def _leverage_source_forms() -> str:
    return ", ".join(f"{kind}:<id>" for kind in LEVERAGE_SOURCE_KINDS)


def _resolve_contract_ref(
    ctx: Ctx,
    source_ref: str,
    *,
    require_player_known: bool,
) -> dict[str, Any]:
    """Resolve one typed reference without interpreting free prose.

    This is deliberately a small structural resolver over canonical records;
    credibility and relevance remain explicit Keeper judgments on the request.
    """
    kind, separator, identifier = source_ref.partition(":")
    identifier = identifier.strip()
    if not separator or not kind or not identifier:
        raise ToolError(
            "leverage_source_invalid",
            f"invalid structured source_ref {source_ref!r}; use one of "
            f"{_leverage_source_forms()}",
        )
    record: dict[str, Any] | None = None
    player_known = False
    if kind == "npc_agenda":
        record = _npc_by_id(ctx.npc_agendas, identifier)
    elif kind == "npc_fact":
        npc_ref, separator, fact_id = identifier.partition("/")
        npc = _npc_by_id(ctx.npc_agendas, npc_ref)
        if separator and isinstance(npc, dict):
            facts = npc.get("facts") if isinstance(npc.get("facts"), list) else []
            fact = next(
                (
                    value for value in facts
                    if isinstance(value, dict) and value.get("fact_id") == fact_id
                ),
                None,
            )
            if isinstance(fact, dict) and fact_id in {
                str(value) for value in npc.get("known_fact_ids") or []
            }:
                record = {"npc_id": npc_ref, "fact": fact}
    elif kind == "npc_state":
        path = ctx.campaign_dir / "save" / "npc-state.json"
        if path.is_file():
            try:
                state = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                raise ToolError("state_corrupt", "save/npc-state.json is unreadable") from exc
            psych = state.get("psych") if isinstance(state, dict) and isinstance(state.get("psych"), dict) else {}
            value = psych.get(identifier)
            record = value if isinstance(value, dict) else None
    elif kind == "clue":
        clue = _clue_by_id(ctx.clue_graph, identifier)
        if isinstance(clue, dict):
            record = clue
            player_known = identifier in {
                str(value) for value in ctx.world().get("discovered_clue_ids") or []
            }
    elif kind == "event":
        matches = [
            row
            for row in _jsonl_rows(ctx.campaign_dir / "logs" / "events.jsonl")
            if str(row.get("event_id") or "") == identifier
        ]
        if len(matches) > 1:
            raise ToolError("state_corrupt", f"event source {identifier!r} is duplicated")
        if matches:
            record = matches[0]
            journal_id = str(
                record.get("journal_decision_id") or record.get("decision_id") or ""
            ).strip()
            finalizations = [
                row for row in _jsonl_rows(ctx.campaign_dir / "logs" / "turn-finalizations.jsonl")
                if str(row.get("journal_decision_id") or "") == journal_id
                and isinstance(row.get("finalization_id"), str)
                and isinstance(row.get("rendered_text_sha256"), str)
            ]
            deliveries = _jsonl_rows(
                ctx.campaign_dir / "save" / "continuation" / "delivery-receipts.jsonl"
            )
            declared_player_visible = (
                record.get("player_visible") is True
                or str(record.get("visibility") or "").casefold()
                in {"public", "player", "player_visible"}
            )
            player_known = declared_player_visible and len(finalizations) == 1 and any(
                delivery.get("status") == "confirmed"
                and delivery.get("finalization_id") == finalizations[0]["finalization_id"]
                and delivery.get("rendered_text_sha256")
                == finalizations[0]["rendered_text_sha256"]
                for delivery in deliveries
            )
    if not isinstance(record, dict):
        raise ToolError(
            "leverage_source_invalid",
            f"source_ref {source_ref!r} does not resolve; use one of "
            f"{_leverage_source_forms()} naming a record this campaign holds",
        )
    if require_player_known and not player_known:
        raise ToolError(
            "leverage_source_invalid",
            f"source_ref {source_ref!r} resolves but is not established as "
            "player-known; leverage may only rest on what the players have "
            "actually learned in play",
        )
    return {
        "source_ref": source_ref,
        "kind": kind,
        "identifier": identifier,
        "player_known": player_known,
        "record_digest": _canonical_digest(record),
    }

def _resolve_psychology_grounding_ref(
    ctx: Ctx,
    source_ref: str,
    *,
    target_npc_id: str,
) -> dict[str, Any]:
    """Resolve Psychology grounding without treating Keeper truth as leverage.

    Target-bound NPC truth is Keeper-only provenance for the concealed
    settlement.  Player evidence retains the stricter established-knowledge
    check used by social leverage.  No source body is projected here.
    """
    kind, separator, identifier = source_ref.partition(":")
    identifier = identifier.strip()
    if not separator or not kind or not identifier:
        raise ToolError(
            "psychology_grounding_invalid",
            f"invalid Psychology grounding ref {source_ref!r}; use an exact typed ref, not a bare id",
        )
    keeper_target_truth = kind in {"npc_agenda", "npc_fact", "npc_state"}
    player_observation = kind in {"clue", "event"}
    if not keeper_target_truth and not player_observation:
        raise ToolError(
            "psychology_grounding_invalid",
            "Psychology grounding must be target-bound npc_agenda:/npc_fact:/npc_state: "
            "or an established player-known clue:/event: ref",
        )
    try:
        resolved = _resolve_contract_ref(
            ctx,
            source_ref,
            require_player_known=player_observation,
        )
    except ToolError as exc:
        if exc.code != "leverage_source_invalid":
            raise
        raise ToolError(
            "psychology_grounding_invalid",
            f"Psychology grounding {source_ref!r} is unresolved or not established for its required scope",
        ) from exc
    if keeper_target_truth:
        target_matches = (
            identifier.startswith(target_npc_id + "/")
            if kind == "npc_fact"
            else identifier == target_npc_id
        )
        if not target_matches:
            raise ToolError(
                "psychology_grounding_invalid",
                "Keeper-truth Psychology grounding must belong to the observed target NPC",
            )
    return {
        **resolved,
        "grounding_scope": (
            "keeper_target_truth" if keeper_target_truth else "player_known_observation"
        ),
    }

# Host-internal social contract (RulesRuntime payload after promotion).
# Never listed on the KP-facing rules.social_adjudicate schema.
_SOCIAL_HOST_INTERNAL_KEYS = (
    "described_action",
    "supporting_action",
    "leverage_one_level",
    "goal",
    "motive_evidence",
)


def social_host_internal_overlay(
    *,
    described_action: str | None = None,
    supporting_action: str | None = None,
    leverage_one_level: bool | None = None,
    goal: str | None = None,
    motive_evidence: list[str] | None = None,
) -> dict[str, Any]:
    """Host-internal social inputs for resolver.social_difficulty.

    Two seams:
    - KP-facing ``rules.social_adjudicate`` never lists these keys and never
      copies them from model-visible args into the result envelope.
    - RulesRuntime / tests pass this overlay into ``build_social_difficulty_request``;
      the resolver result MAY then carry described_action, supporting_action,
      and leverage_one_level.
    """
    overlay: dict[str, Any] = {}
    if described_action is not None:
        overlay["described_action"] = described_action
    if supporting_action is not None:
        overlay["supporting_action"] = supporting_action
    if leverage_one_level is not None:
        overlay["leverage_one_level"] = bool(leverage_one_level)
    if goal is not None:
        overlay["goal"] = goal
    if motive_evidence is not None:
        overlay["motive_evidence"] = list(motive_evidence)
    return overlay


def build_social_difficulty_request(
    *,
    approach: str,
    motive_direction: str,
    motive_intensity: int,
    bonus: int,
    penalty: int,
    host_internal: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Resolver request for social_difficulty. host_internal is the runtime channel."""
    request: dict[str, Any] = {
        "approach": approach,
        "motive_direction": motive_direction,
        "motive_intensity": motive_intensity,
        "bonus": bonus,
        "penalty": penalty,
    }
    overlay = host_internal or {}
    for key in _SOCIAL_HOST_INTERNAL_KEYS:
        if key in overlay:
            request[key] = overlay[key]
    return request


def _tool_rules_social_adjudicate(ctx: Ctx, args: dict[str, Any]):
    prior = _replay_bound_decision(ctx, "rules.social_adjudicate", args)
    if prior is not None:
        return prior, ["duplicate decision_id: returning the previously settled result"], []
    investigator_id = _resolve_investigator(ctx, args)
    npc_id = str(args["npc_id"]).strip()
    if not npc_id:
        raise ToolError("invalid_param", "npc_id must be non-empty")
    conversation_window_id = str(args["conversation_window_id"]).strip()
    commitment_id = str(args["commitment_id"]).strip()
    if not conversation_window_id or not commitment_id:
        raise ToolError(
            "invalid_param",
            "conversation_window_id and commitment_id must be non-empty",
        )
    approach = str(args["approach"]).strip()
    resolver = _rules_resolver(ctx, "social_difficulty")
    try:
        approach_policy = resolver.social_difficulty(
            {"approach": approach}, None
        )
    except ValueError as exc:
        raise ToolError(
            "invalid_param",
            str(exc),
        ) from exc
    approach_skill = str(approach_policy["approach_skill"])
    goal_summary = str(args["goal_summary"] or "").strip()
    if not goal_summary:
        raise ToolError("invalid_param", "goal_summary must be non-empty")
    # described_action / supporting_action / leverage_one_level are host-internal
    # resolver inputs (RulesRuntime payload after promotion). The KP schema must
    # not accept them; the adapter never reads them from model-visible args.
    goal_key = hashlib.sha256(
        "\x00".join((npc_id, conversation_window_id, commitment_id)).encode("utf-8")
    ).hexdigest()[:16]
    document = _load_json_document(ctx, "social-resolutions.json", 2, "resolutions")
    resolutions = document["resolutions"]
    prior_goal = resolutions.get(goal_key)

    warnings: list[str] = []
    defense = args.get("npc_defense_value")
    defense_source = "explicit"
    defense_key: str | None = "explicit"
    if (
        defense is not None
        and isinstance(prior_goal, dict)
        and defense != prior_goal.get("defense_value")
    ):
        raise ToolError(
            "social_goal_already_settled",
            "the social goal is already bound to a different immutable NPC defense",
        )
    if defense is None:
        if isinstance(prior_goal, dict):
            defense = prior_goal.get("defense_value")
            defense_source = str(prior_goal.get("defense_source") or "unknown")
            defense_key = prior_goal.get("defense_key")
        else:
            defense, defense_key = _npc_authored_social_defense(
                ctx,
                npc_id,
                [str(value) for value in approach_policy.get("defense_skills") or []],
            )
            defense_source = "authored" if defense is not None else "unknown"
    if defense is not None and (
        isinstance(defense, bool)
        or not isinstance(defense, int)
        or not 0 <= defense <= 100
    ):
        raise ToolError("invalid_param", "npc_defense_value must be an integer 0-100")
    if defense is None:
        warnings.append(
            f"no authored social defense for npc '{npc_id}' — base difficulty defaults "
            "to regular; pass npc_defense_value when the table knows better"
        )

    motive = args.get("motive") or {}
    if not isinstance(motive, dict):
        raise ToolError("invalid_param", "motive must be an object")
    direction = str(motive.get("direction") or "neutral").strip()
    if direction not in {"support", "neutral", "oppose"}:
        raise ToolError("invalid_param", "motive.direction must be support|neutral|oppose")
    intensity = motive.get("intensity", 0)
    if isinstance(intensity, bool) or not isinstance(intensity, int) or intensity not in (0, 1, 2):
        raise ToolError("invalid_param", "motive.intensity must be 0, 1, or 2")
    motive_evidence = [
        str(value).strip()
        for value in (motive.get("evidence_refs") or [])
        if str(value).strip()
    ]
    if intensity > 0 and not motive_evidence:
        raise ToolError(
            "invalid_param", "motive.intensity > 0 requires motive.evidence_refs"
        )
    resolved_motive_refs = [
        _resolve_contract_ref(ctx, source_ref, require_player_known=False)
        for source_ref in motive_evidence
    ]

    raw_leverage = args.get("leverage") or []
    if not isinstance(raw_leverage, list):
        raise ToolError("invalid_param", "leverage must be an array")
    leverage_items: list[dict[str, Any]] = []
    counted_sources: set[str] = set()
    counted_groups: set[str] = set()
    for index, item in enumerate(raw_leverage):
        if not isinstance(item, dict):
            raise ToolError("invalid_param", f"leverage[{index}] must be an object")
        leverage_id = str(item.get("leverage_id") or "").strip()
        source_ref = str(item.get("source_ref") or "").strip()
        independence_group = str(item.get("independence_group") or "").strip()
        credibility = str(item.get("credibility") or "").strip()
        relevance = str(item.get("relevance") or "").strip()
        reason = str(item.get("reason") or "").strip()
        if not all((leverage_id, source_ref, independence_group, reason)):
            raise ToolError(
                "invalid_param",
                f"leverage[{index}] requires leverage_id, source_ref, independence_group, and reason",
            )
        if credibility != "verified" or relevance != "direct":
            raise ToolError(
                "leverage_source_invalid",
                f"leverage[{index}] must record credibility=verified and relevance=direct",
            )
        resolved = _resolve_contract_ref(ctx, source_ref, require_player_known=True)
        normalized = {
            "leverage_id": leverage_id,
            "type": str(item.get("type") or "unspecified").strip() or "unspecified",
            "source_ref": source_ref,
            "independence_group": independence_group,
            "credibility": credibility,
            "relevance": relevance,
            "reason": reason,
            "resolved_source": resolved,
        }
        if source_ref in counted_sources:
            warnings.append(
                f"leverage source {source_ref!r} was duplicated and counts only once"
            )
            continue
        if independence_group in counted_groups:
            warnings.append(
                f"leverage independence_group {independence_group!r} was duplicated and counts only once"
            )
            continue
        counted_sources.add(source_ref)
        counted_groups.add(independence_group)
        leverage_items.append(normalized)
    leverage_counted = leverage_items
    if len(raw_leverage) > len(leverage_counted):
        warnings.append(
            "duplicate leverage sources or independence groups do not count twice"
        )
    if len(leverage_counted) > 1:
        warnings.append(
            "source authorizes only one difficulty level for a supporting case "
            "(pdf 104/printed 93); additional independent items do not reduce further"
        )

    tactical = args.get("tactical") or {}
    if not isinstance(tactical, dict):
        raise ToolError("invalid_param", "tactical must be an object")
    bonus = tactical.get("bonus", 0)
    penalty = tactical.get("penalty", 0)
    for label, value in (("bonus", bonus), ("penalty", penalty)):
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 2:
            raise ToolError("invalid_param", f"tactical.{label} must be 0-2")

    requirements = [str(v).strip() for v in (args.get("requirements") or []) if str(v).strip()]

    feasibility_override = str(args.get("feasibility") or "").strip()
    feasibility_refs = [
        str(value).strip()
        for value in (args.get("feasibility_refs") or [])
        if str(value).strip()
    ]
    if feasibility_override and not feasibility_refs:
        raise ToolError(
            "invalid_param", "an explicit feasibility override requires feasibility_refs"
        )
    resolved_feasibility_refs = [
        _resolve_contract_ref(ctx, source_ref, require_player_known=False)
        for source_ref in feasibility_refs
    ]

    outcome_ceiling = args.get("outcome_ceiling") or {}
    if not isinstance(outcome_ceiling, dict):
        raise ToolError("invalid_param", "outcome_ceiling must be an object")
    allowed_ceiling_fields = {
        "goal_scope", "npc_knowledge_refs", "scene_truth_max_tier", "forbidden_fact_refs"
    }
    if set(outcome_ceiling) - allowed_ceiling_fields:
        raise ToolError("invalid_param", "outcome_ceiling contains unknown fields")
    goal_scope = str(outcome_ceiling.get("goal_scope") or goal_summary).strip()
    if not goal_scope:
        raise ToolError("invalid_param", "outcome_ceiling.goal_scope must be non-empty")
    scene_truth_max_tier = outcome_ceiling.get("scene_truth_max_tier")
    if scene_truth_max_tier is not None and (
        isinstance(scene_truth_max_tier, bool)
        or not isinstance(scene_truth_max_tier, int)
        or not 0 <= scene_truth_max_tier <= 4
    ):
        raise ToolError("invalid_param", "outcome_ceiling.scene_truth_max_tier must be 0-4")
    knowledge_refs = [
        str(value).strip()
        for value in outcome_ceiling.get("npc_knowledge_refs") or []
        if str(value).strip()
    ]
    resolved_knowledge_refs = [
        _resolve_contract_ref(ctx, source_ref, require_player_known=False)
        for source_ref in knowledge_refs
    ]
    if any(
        ref.get("kind") != "npc_fact"
        or not str(ref.get("identifier") or "").startswith(npc_id + "/")
        for ref in resolved_knowledge_refs
    ):
        raise ToolError(
            "invalid_param",
            "outcome_ceiling.npc_knowledge_refs must name scoped npc_fact refs for the target NPC",
        )
    forbidden_refs = [
        str(value).strip()
        for value in outcome_ceiling.get("forbidden_fact_refs") or []
        if str(value).strip()
    ]
    resolved_forbidden_refs = [
        _resolve_contract_ref(ctx, source_ref, require_player_known=False)
        for source_ref in forbidden_refs
    ]
    normalized_ceiling = {
        "goal_scope": goal_scope,
        "npc_knowledge_refs": knowledge_refs,
        "scene_truth_max_tier": scene_truth_max_tier,
        "forbidden_fact_refs": forbidden_refs,
        "resolved_npc_knowledge_refs": resolved_knowledge_refs,
        "resolved_forbidden_fact_refs": resolved_forbidden_refs,
    }

    current_leverage_ids = sorted(item["leverage_id"] for item in leverage_counted)
    host_internal = social_host_internal_overlay(
        leverage_one_level=True if leverage_counted else None,
    )
    adjudication_source_digest = _canonical_digest({
        "npc_id": npc_id,
        "conversation_window_id": conversation_window_id,
        "commitment_id": commitment_id,
        "defense": {
            "value": defense,
            "source": defense_source,
            "key": defense_key,
        },
        "motive": {
            "direction": direction,
            "intensity": intensity,
            "evidence_refs": motive_evidence,
        },
        "leverage": leverage_counted,
        "tactical": {"bonus": bonus, "penalty": penalty},
        "requirements": requirements,
        "feasibility": feasibility_override,
        "feasibility_refs": feasibility_refs,
        "outcome_ceiling": normalized_ceiling,
    })
    if (
        isinstance(prior_goal, dict)
        and prior_goal.get("source_digest") == adjudication_source_digest
    ):
        data = dict(prior_goal["adjudication"])
        data["replayed"] = True
        data["resolution"] = "reuse"
        data["request_digest"] = _request_digest(args)
        ctx.ledger_record(args.get("decision_id"), "rules.social_adjudicate", data)
        return data, [
            "same goal key with unchanged motive/leverage: replaying the original "
            "adjudication — switching the approach skill name does not reopen the goal"
        ], []

    try:
        policy = resolver.social_difficulty(
            build_social_difficulty_request(
                approach=approach,
                motive_direction=direction,
                motive_intensity=intensity,
                bonus=bonus,
                penalty=penalty,
                host_internal=host_internal,
            ),
            defense,
        )
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    feasibility = feasibility_override or str(policy["feasibility"])
    if feasibility == "conditional" and not requirements:
        warnings.append(
            "feasibility is conditional but no requirements were recorded; attach "
            "unlock conditions so later play has something to pursue"
        )
    final_difficulty = str(policy["final_difficulty"])
    leverage_delta = 1 if policy.get("leverage_one_level") else 0
    data = {
        "schema_version": 2,
        "investigator_id": investigator_id,
        "npc_id": npc_id,
        "conversation_window_id": conversation_window_id,
        "commitment_id": commitment_id,
        "approach": approach,
        "approach_skill": approach_skill,
        "goal_summary": goal_summary,
        "goal_key": goal_key,
        "feasibility": feasibility,
        "defense_value": defense,
        "defense_source": defense_source,
        "defense_key": defense_key,
        "base_difficulty": policy["base_difficulty"],
        "motive": {
            "direction": direction,
            "intensity": intensity,
            "evidence_refs": motive_evidence,
            "resolved_evidence": resolved_motive_refs,
        },
        "motive_delta": policy["motive_adjustment"],
        "leverage": leverage_counted,
        "leverage_delta": leverage_delta,
        "final_difficulty": final_difficulty,
        "bonus_dice": bonus,
        "penalty_dice": penalty,
        "requirements": requirements,
        "feasibility_refs": resolved_feasibility_refs,
        "outcome_ceiling": normalized_ceiling,
        "source_digest": adjudication_source_digest,
        "resolution": "new",
        "replayed": False,
        "request_digest": _request_digest(args),
    }
    if feasibility == "roll":
        data["roll_operation"] = {
            "operation": "rules.roll",
            "invoke_via": "coc_rules_roll",
            "prefilled_arguments": {
                "investigator": investigator_id,
                "npc_id": npc_id,
                "skill": approach_skill,
                "difficulty": final_difficulty,
                "bonus": bonus,
                "penalty": penalty,
                "goal": goal_summary,
                "difficulty_basis": "opponent_skill",
                "social_adjudication_ref": goal_key,
            },
            "missing_arguments": ["stakes", "decision_id"],
            "argument_boundary": {
                "submission_shape": "prefilled_plus_missing_only",
                "forbidden_arguments": ["target", "reason"],
            },
        }
    resolutions[goal_key] = {
        "adjudication": {key: value for key, value in data.items() if key != "replayed"},
        "leverage_ids": current_leverage_ids,
        "motive_key": [direction, intensity],
        "defense_value": defense,
        "defense_source": defense_source,
        "defense_key": defense_key,
        "source_digest": adjudication_source_digest,
        "decision_id": str(args["decision_id"]),
        "ts": _now_iso(),
    }
    _save_json_document(ctx, "social-resolutions.json", document)
    hints: list[str] = []
    if feasibility == "roll":
        hints.append(
            f"roll {approach_skill} at {final_difficulty} difficulty "
            f"with difficulty_basis=opponent_skill; bonus={bonus} penalty={penalty}"
        )
    elif feasibility == "automatic":
        hints.append(
            "the NPC is ready to comply — no roll; play the compliance and let the "
            "strategic leverage that earned it show in the fiction"
        )
    else:
        hints.append(
            "the current goal cannot be settled by a roll now; satisfy the recorded "
            "requirements or change the approach/target"
        )
    ctx.ledger_record(args.get("decision_id"), "rules.social_adjudicate", data)
    return data, warnings, hints

_PSYCHOLOGY_REVISION_EVENTS = frozenset({
    "decisive_evidence_presented",
    "identity_exposed",
    "threat_state_changed",
    "hostility_state_changed",
    "confession_or_betrayal",
    "left_and_reencountered",
    "scene_changed",
})

def _tool_rules_psychology_observe(ctx: Ctx, args: dict[str, Any]):
    prior = _replay_bound_decision(ctx, "rules.psychology_observe", args)
    if prior is not None:
        return prior, ["duplicate decision_id: returning the previously settled result"], []
    investigator_id = _resolve_investigator(ctx, args)
    npc_id = str(args["npc_id"]).strip()
    question = str(args["question"] or "").strip()
    requested_observer_scope = str(
        args.get("observer_scope") or investigator_id
    ).strip()
    party_ids = sorted(set(ctx.party_ids()))
    if investigator_id not in party_ids:
        raise ToolError(
            "invalid_param",
            "Psychology observer must be a member of the canonical campaign party",
        )
    if requested_observer_scope != "team:party" and requested_observer_scope not in party_ids:
        raise ToolError(
            "invalid_param",
            "observer_scope must be a canonical party investigator id or literal team:party",
        )
    observer_scope = "team:party:" + hashlib.sha256(
        "\x00".join(party_ids).encode("utf-8")
    ).hexdigest()[:16]
    conversation_window_id = str(args["conversation_window_id"]).strip()
    revision = args["observation_revision"]
    if (
        not npc_id
        or not question
        or not observer_scope
        or not conversation_window_id
        or isinstance(revision, bool)
        or not isinstance(revision, int)
        or revision < 0
    ):
        raise ToolError(
            "invalid_param",
            "npc_id, question, observer_scope, conversation_window_id, and a nonnegative observation_revision are required",
        )
    window_key = "\x00".join(
        (observer_scope, npc_id, conversation_window_id, str(revision))
    )
    document = _load_json_document(ctx, "psychology-observations.json", 2, "observations")
    observations = document["observations"]
    realizations = document.setdefault("realizations", {})

    action = str(args.get("action") or "settle")
    if action == "realize":
        insight_id = str(args.get("insight_id") or "").strip()
        visible_observation = str(args.get("visible_observation") or "").strip()
        matching = next(
            (
                row
                for row in observations.values()
                if isinstance(row, dict) and row.get("insight_id") == insight_id
            ),
            None,
        )
        if not insight_id or not visible_observation or not isinstance(matching, dict):
            raise ToolError(
                "invalid_param",
                "action=realize requires an existing insight_id and non-empty visible_observation",
            )
        if (
            matching.get("conversation_window_id") != conversation_window_id
            or matching.get("observation_revision") != revision
            or matching.get("observer_scope") != observer_scope
            or matching.get("npc_id") != npc_id
            or matching.get("investigator_id") != investigator_id
        ):
            raise ToolError("revision_conflict", "realization does not match the settled observation window")
        existing_realization = realizations.get(insight_id)
        if isinstance(existing_realization, dict):
            existing_projection = existing_realization.get("player_projection")
            existing_behavior = (
                existing_projection.get("external_behavior")
                if isinstance(existing_projection, dict)
                else None
            ) or existing_realization.get("visible_observation")
            if existing_behavior != visible_observation:
                raise ToolError("revision_conflict", "insight already has a different player-safe realization")
            data = deepcopy(existing_realization)
            data["request_digest"] = _request_digest(args)
            ctx.ledger_record(args.get("decision_id"), "rules.psychology_observe", data)
            return data, ["player-safe realization already bound; replaying it"], []
        frozen_ceiling = str(matching.get("inference_depth") or "").strip()
        resolver = _rules_resolver(ctx, "psychology_policy")
        try:
            realization_policy = resolver.psychology_policy(
                {
                    "inference_ceiling": frozen_ceiling,
                    "external_behavior": visible_observation,
                },
                "realize",
            )
        except ValueError as exc:
            raise ToolError("invalid_param", str(exc)) from exc
        assembled = {
            "external_behavior": realization_policy["player_projection"][
                "external_behavior"
            ],
            "inference_ceiling": realization_policy["concealed_result"][
                "inference_ceiling"
            ],
            "insight_id": insight_id,
            "conversation_window_id": conversation_window_id,
            "observation_revision": revision,
            "investigator_id": investigator_id,
            "observer_scope": observer_scope,
            "npc_id": npc_id,
            "question": matching["question"],
            "observable_fact_refs": deepcopy(matching["observable_fact_refs"]),
            "visible_observation": visible_observation,
        }
        try:
            public = resolver.psychology_realization_public_projection(assembled)
        except ValueError as exc:
            raise ToolError("invalid_param", str(exc)) from exc
        concealed = {
            key: assembled[key]
            for key in assembled
            if key not in resolver.PSYCHOLOGY_REALIZATION_PUBLIC_KEYS
        }
        data = {
            "resolution": "realized",
            "insight_id": insight_id,
            "player_projection": public,
            "concealed_result": concealed,
            "visible_observation": visible_observation,
        }
        realizations[insight_id] = deepcopy(data)
        _save_json_document(ctx, "psychology-observations.json", document)
        ledger_data = {**data, "request_digest": _request_digest(args)}
        ctx.ledger_record(args.get("decision_id"), "rules.psychology_observe", ledger_data)
        return ledger_data, [], [
            "player_projection is the only player-visible realization field; "
            "concealed_result stays Keeper-only"
        ]

    if str(args.get("visible_observation") or "").strip():
        raise ToolError(
            "invalid_param",
            "settle the concealed roll before supplying player-safe realization prose",
        )

    observable_fact_refs = [
        str(value).strip()
        for value in args.get("observable_fact_refs") or []
        if str(value).strip()
    ]
    if not observable_fact_refs:
        raise ToolError(
            "psychology_grounding_invalid",
            "action=settle requires at least one exact typed observable_fact_ref; "
            "call npc.query first and prefer npc_fact:<npc_id>/<fact_id>",
        )
    resolved_observable_refs = [
        _resolve_psychology_grounding_ref(
            ctx,
            source_ref,
            target_npc_id=npc_id,
        )
        for source_ref in observable_fact_refs
    ]
    existing = observations.get(window_key)
    if isinstance(existing, dict):
        data = {
            "resolution": "reuse",
            "insight_id": existing["insight_id"],
            "window_key": window_key,
            "question": existing["question"],
            "conversation_window_id": conversation_window_id,
            "observation_revision": revision,
            "request_digest": _request_digest(args),
        }
        ctx.ledger_record(args.get("decision_id"), "rules.psychology_observe", data)
        return data, [], [
            "no new observable change: reuse the settled judgment — do not reroll "
            "Psychology on the same window"
        ]
    matching_revisions = [
        int(row.get("observation_revision"))
        for row in observations.values()
        if isinstance(row, dict)
        and row.get("observer_scope") == observer_scope
        and row.get("npc_id") == npc_id
        and row.get("conversation_window_id") == conversation_window_id
        and isinstance(row.get("observation_revision"), int)
    ]
    if revision > 0:
        revision_ref = str(args.get("revision_event_ref") or "").strip()
        if not revision_ref:
            raise ToolError(
                "observation_revision_invalid",
                "observation_revision > 0 requires revision_event_ref",
            )
        resolved_revision = _resolve_contract_ref(
            ctx, revision_ref, require_player_known=False
        )
        event = next(
            row
            for row in _jsonl_rows(ctx.campaign_dir / "logs" / "events.jsonl")
            if str(row.get("event_id") or "") == resolved_revision["identifier"]
        )
        if str(event.get("event_type") or "") not in _PSYCHOLOGY_REVISION_EVENTS:
            raise ToolError(
                "observation_revision_invalid",
                "revision event is not an allowed semantic observation boundary",
            )
        used_revision_refs = {
            str(row.get("revision_event_ref") or "")
            for row in observations.values()
            if isinstance(row, dict)
            and row.get("observer_scope") == observer_scope
            and row.get("npc_id") == npc_id
            and row.get("conversation_window_id") == conversation_window_id
        }
        if revision_ref in used_revision_refs:
            raise ToolError(
                "observation_revision_invalid",
                "revision_event_ref has already opened one observation revision",
            )
        expected_revision = (max(matching_revisions) + 1) if matching_revisions else 0
        if revision != expected_revision:
            raise ToolError(
                "observation_revision_invalid",
                f"observation_revision must advance exactly to {expected_revision}",
            )
    elif matching_revisions:
        raise ToolError(
            "observation_revision_invalid",
            "revision 0 cannot reopen an already revised conversation window",
        )
    resolver = _rules_resolver(ctx, "psychology_check_contract")
    try:
        provisional = resolver.psychology_check_contract({})
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    base_chance = int(provisional["observer_skill_base_chance"])
    observer_skill, observer_source = _observer_psychology_skill(
        ctx, investigator_id, base_chance
    )
    defense_skills = [str(value) for value in provisional.get("defense_skills") or []]
    defense, defense_key = _npc_authored_social_defense(ctx, npc_id, defense_skills)
    try:
        check_contract = resolver.psychology_check_contract(
            {
                "observer_skill": (
                    observer_skill if observer_source == "sheet" else None
                ),
                "target_opposing_social": defense,
                "question": question,
                "observable_facts": observable_fact_refs,
            }
        )
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    roll_args: dict[str, Any] = {
        "investigator": investigator_id,
        "skill": check_contract["skill"],
        "target": int(check_contract["observer_skill"]),
        "difficulty": check_contract["difficulty"],
        "difficulty_basis": check_contract["difficulty_basis"],
        "goal": question,
        "stakes": deepcopy(check_contract["stakes"]),
        "visibility": "keeper_only",
        "decision_id": f"{args['decision_id']}:roll",
    }
    if args.get("seed") is not None:
        roll_args["seed"] = args["seed"]
    roll_data, _roll_warnings, _roll_hints = _roll_common(
        ctx,
        roll_args,
        pushed=False,
        tool_name="rules.roll",
        dedicated_psychology_observe=True,
    )
    resolver = _rules_resolver(ctx, "psychology_policy")
    try:
        policy = resolver.psychology_policy(roll_data, "concrete_observation")
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    insight_id = (
        f"psych-insight-{hashlib.sha256(window_key.encode('utf-8')).hexdigest()[:12]}"
    )
    record = {
        "insight_id": insight_id,
        "window_key": window_key,
        "investigator_id": investigator_id,
        "observer_scope": observer_scope,
        "npc_id": npc_id,
        "conversation_window_id": conversation_window_id,
        "observation_revision": revision,
        "revision_event_ref": str(args.get("revision_event_ref") or "").strip() or None,
        "question": question,
        "observable_fact_refs": resolved_observable_refs,
        "roll_id": roll_data["roll_id"],
        "outcome": roll_data.get("outcome"),
        "inference_depth": policy["inference_depth"],
        "misread_policy": policy["misread_policy"],
        "created_at": _now_iso(),
    }
    observations[window_key] = record
    _save_json_document(ctx, "psychology-observations.json", document)
    data = {
        "resolution": "settled",
        "insight_id": insight_id,
        "window_key": window_key,
        "question": question,
        "conversation_window_id": conversation_window_id,
        "observation_revision": revision,
        "inference_depth": policy["inference_depth"],
        "misread_policy": policy["misread_policy"],
        "outcome": roll_data.get("outcome"),
        "roll_id": roll_data["roll_id"],
        "observable_fact_refs": deepcopy(resolved_observable_refs),
        "request_digest": _request_digest(args),
    }
    hints = [
        "the roll and outcome are keeper-concealed: the player sees only your "
        "observation prose; on failure you may give any unreliable information "
        "including the opposite, but do not automatically invert and do not expose the roll",
        "this window is locked until an explicit allowed observation revision event; ordinary NPC state deltas do not reopen it",
    ]
    ctx.ledger_record(args.get("decision_id"), "rules.psychology_observe", data)
    return data, [], hints

def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "rules.social_adjudicate",
    "Derive the authoritative difficulty for one social attempt (7e social resolution): feasibility first, base from NPC defense, motive and leverage adjustments, bonus/penalty dice last. The KP then rolls the approach skill with the returned difficulty; the same goal without new leverage or motive replays the original adjudication.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "npc_id": {"type": "string", "required": True, "desc": "target NPC id"},
        "conversation_window_id": {"type": "string", "required": True, "desc": "stable direct-conversation window id"},
        "commitment_id": {"type": "string", "required": True, "desc": "Keeper semantic id for the requested commitment; never inferred from prose"},
        "approach": {"type": "string", "required": True, "enum": ["charm", "fast_talk", "intimidate", "persuade"], "desc": "social approach skill family"},
        "goal_summary": {"type": "string", "required": True, "desc": "one-sentence concrete commitment the player wants from the NPC"},
        "npc_defense_value": {"type": "integer", "desc": "explicit NPC defense value (higher of Psychology or the approach skill); defaults to the authored npc skills block, then regular"},
        "motive": {
            "type": "object",
            "desc": "structured NPC motive: {direction: support|neutral|oppose, intensity: 0|1|2, evidence_refs: [typed refs]}; intensity>0 requires resolved evidence",
        },
        "leverage": {
            "type": "array",
            "desc": "strategic leverage [{leverage_id,type,source_ref,independence_group,credibility,relevance,reason}]; resolved player-known sources and distinct groups count once, capped at two",
        },
        "tactical": {
            "type": "object",
            "desc": "tactical conditions {bonus: 0-2, penalty: 0-2}; applied after the difficulty is fixed",
        },
        "requirements": {
            "type": "array",
            "desc": "KP-authored unlock conditions when feasibility is conditional (recorded, advisory)",
        },
        "feasibility": {"type": "string", "enum": ["automatic", "roll", "conditional", "impossible"], "desc": "optional source-bound semantic feasibility override"},
        "feasibility_refs": {"type": "array", "desc": "typed canonical refs grounding an explicit feasibility override"},
        "outcome_ceiling": {"type": "object", "desc": "structured goal/NPC-knowledge/scene-scope ceiling; references are validated, never inferred"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)(_tool_rules_social_adjudicate)
    registry.tool(
    "rules.psychology_observe",
    "Keeper-concealed Psychology observation. Order: (1) call npc.query for the exact target; (2) action=settle with a typed grounding ref such as npc_fact:<npc_id>/<fact_id> copied from returned facts[], or a previously established clue:<clue_id>/event:<event_id>; (3) action=realize with a player-safe realization containing only external behavior. Bare ids are invalid. Settle once per explicit observer/NPC/conversation/revision window and reuse it; Keeper truth is stored only as audit digest and never directly revealed. Ordinary NPC state deltas never reopen the window.",
    {
        "action": {"type": "string", "enum": ["settle", "realize"], "desc": "settle a concealed insight (default) or bind its player-safe realization"},
        "investigator": {"type": "string", "desc": "investigator id (observer)"},
        "observer_scope": {"type": "string", "desc": "observer entry: a canonical current-party investigator id or literal team:party; every valid entry normalizes to the same current-party observation window and arbitrary aliases are rejected"},
        "npc_id": {"type": "string", "required": True, "desc": "observed NPC id"},
        "conversation_window_id": {"type": "string", "required": True, "desc": "stable direct-conversation window id"},
        "observation_revision": {"type": "integer", "required": True, "desc": "explicit nonnegative semantic observation revision"},
        "revision_event_ref": {"type": "string", "desc": "required canonical event ref when opening revision > 0"},
        "question": {"type": "string", "required": True, "desc": "the concrete observation question (e.g. 'what is he afraid of?')"},
        "observable_fact_refs": {"type": "array", "desc": "non-empty exact typed refs. Same-turn target truth: npc_fact:<npc_id>/<fact_id> copied from npc.query facts[] (or target-bound npc_agenda:<npc_id>/npc_state:<npc_id>); these remain Keeper-only digest provenance. Previously delivered observation: clue:<clue_id> or event:<event_id>, which must already be player-known. Bare ids and arbitrary text are invalid. Required only for action=settle"},
        "insight_id": {"type": "string", "desc": "settled insight to realize when action=realize"},
        "visible_observation": {"type": "string", "desc": "player-safe external observation used only when action=realize"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)(_tool_rules_psychology_observe)


OPERATION_EXPORTS = (
    '_PSYCHOLOGY_REVISION_EVENTS',
    '_npc_authored_skill_value',
    '_npc_authored_social_defense',
    '_observer_psychology_skill',
    '_resolve_contract_ref',
    '_resolve_psychology_grounding_ref',
    '_tool_rules_psychology_observe',
    '_tool_rules_social_adjudicate',
    'build_social_difficulty_request',
    'social_host_internal_overlay',
)
