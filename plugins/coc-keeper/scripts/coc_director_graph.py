#!/usr/bin/env python3
"""DirectorGraph compiler — vocabulary and doctrine planes (slices D1/D2).

Spec: docs/specs/pi-coc-director-graph-runtime.md
Inventory: docs/status/director-doctrine-inventory.md

DirectorGraph is a *doctrine* graph, not a source-fidelity graph. No rulebook
states that PRESSURE scores 0.85 when a player has yielded the scene twice, so
this compiler's job is not to check a value against a printed page. Its job is
to make every Director tunable **represented, classified, and accountable**:

  - vocabulary nodes carry the exact legacy token in ``properties.legacy_key``
    so migration cannot rename a runtime value;
  - doctrine nodes carry an ``evidence_class``, and an ``authored-doctrine``
    node must additionally carry ``rationale``, ``origin`` and
    ``falsifiable_by`` (contract ``accountability_law``);
  - ``origin`` may be the exact token ``unknown-legacy-tuning``. Recording that
    a value's provenance is unknown is the CORRECT outcome; inventing one is
    prohibited.

Three stages mirror ``coc_rule_graph.py``:

    prepare(plane)   -> a closed packet describing what may be transcribed
    accept(shard)    -> deterministic findings for one candidate shard
    build(shards)    -> merged graph + manifest with a content digest

``build_from_legacy_sources()`` composes the production artifact from the two
kinds of migration input: vocabulary that still lives in package JSON is read
live (so library drift is caught), and vocabulary that lived as Python
declarations is held here as frozen ``LEGACY_*`` tables — moving those tables
out of ``coc_story_director.py`` IS the migration.

The compiler never scores, never selects, and never reads prose.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
REFERENCES_DIR = SCRIPT_DIR.parent / "references"
RULES_JSON_DIR = SCRIPT_DIR.parent / "rulesets" / "coc7" / "rules-json"
CONTRACT_PATH = REFERENCES_DIR / "director-graph-contract-v1.json"

CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

CONTRACT_ID = str(CONTRACT["contract_id"])
GRAPH_CONTRACT_ID = str(CONTRACT["graph_contract_id"])
SHARD_CONTRACT_ID = str(CONTRACT["shard_contract_id"])
PACKET_CONTRACT_ID = str(CONTRACT["packet_contract_id"])
BUILD_MANIFEST_CONTRACT_ID = str(CONTRACT["build_manifest_contract_id"])
COMPILER_IDENTITY = str(CONTRACT["compiler_identity"])
SCHEMA_VERSION = int(CONTRACT["schema_version"])

GRAPH_ID = "graph:director:production"

NODE_KINDS = frozenset(CONTRACT["node_kinds"])
VOCABULARY_NODE_KINDS = frozenset(CONTRACT["vocabulary_node_kinds"])
DOCTRINE_NODE_KINDS = frozenset(CONTRACT["doctrine_node_kinds"])
RELATION_KINDS = frozenset(CONTRACT["relation_kinds"])
EVIDENCE_CLASSES = frozenset(CONTRACT["evidence_classes"])
SIGNAL_GROUPS = tuple(CONTRACT["signal_groups"])
PLANES = tuple(CONTRACT["planes"])
NODE_KEYS = frozenset(CONTRACT["node_keys"])
OPTIONAL_NODE_KEYS = frozenset(CONTRACT["optional_node_keys"])
RELATION_KEYS = frozenset(CONTRACT["relation_keys"])
EVIDENCE_REQUIRED = CONTRACT["evidence_class_required_keys"]
NODE_PROPERTY_KEYS = CONTRACT["node_property_keys"]
EXPECTED_NODE_COUNTS = CONTRACT["expected_node_counts"]

SEMANTIC_ID_RE = re.compile(str(CONTRACT["semantic_id_pattern"]))

# --------------------------------------------------------------------------
# Frozen legacy declarations being migrated out of coc_story_director.py.
# These are transcribed verbatim; ordering is preserved because ACTIONS order
# is observable through score dict construction and tiebreak fallbacks.
# --------------------------------------------------------------------------

LEGACY_ACTIONS: tuple[str, ...] = (
    "REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE",
    "CUT", "MONTAGE", "SUBSYSTEM", "RECOVER", "PAYOFF",
)

LEGACY_SIGNAL_TAGS: dict[str, tuple[str, ...]] = {
    "low-agency": (
        "move",
        "continue",
        "follow",
        "follow_group",
        "low_agency_continue",
        "passive_follow",
        "continue_without_new_goal",
        "keep_following",
        "move_with_group",
        "yield_initiative",
        "continue_existing_strategy",
    ),
    "low-agency-recent-class": (
        "move",
        "continue",
        "follow",
        "follow_group",
        "low_agency_continue",
        "passive_follow",
    ),
    "routine-progress": (
        "routine_action",
        "routine_search",
        "routine_travel",
        "routine_professional_action",
        "connective_action",
        "continue_existing_strategy",
        "maintain_posture",
        "low_risk_action",
    ),
    "dramatic-progress-advance-until": (
        "threat_approaches",
        "new_clue_or_obvious_information",
        "npc_requests_specialist_judgment",
        "meaningful_choice",
        "risk_requires_roll",
        "scene_arrival_or_transition",
    ),
    "non-blocking-rule-request": (
        "npc_assist",
    ),
    "social-reveal-delivery": (
        "npc_dialogue",
        "social",
    ),
}

# NOTE: coc_story_director's comment calls _LOW_AGENCY_RECENT_CLASSES a
# derivation of _LOW_AGENCY_TAGS, but it is a hand-written 6-item subset with
# its own membership — nothing computes it. It is therefore migrated as its own
# signal group rather than reconstructed, so its exact membership stays pinned.


# --------------------------------------------------------------------------
# Frozen doctrine transcription (slice D2). Every value below is transcribed
# verbatim from the literal it replaces in coc_story_director.py; see
# docs/status/director-doctrine-inventory.md sections 2 and 3. Only two entries
# are rule-derived (Keeper Rulebook p.83-85 and p.209); the rest are honest
# authored-doctrine rows whose origin is unknown-legacy-tuning, because the
# design spec they were tuned under is absent from the tree. Their rationale
# states the observable behaviour the value produces, never an invented reason.
# --------------------------------------------------------------------------

UNKNOWN = "unknown-legacy-tuning"

# (condition_id, action, value, value_kind, rationale, origin, falsifiable_by, source_refs)
LEGACY_SCORING_RULES = [
    ("investigate-intent", "REVEAL", 0.9, "constant",
     "With an available un-revealed clue and investigate intent, REVEAL enters scoring near the top of the range, so it wins unless a structure weight or a Layer-3 override displaces it.",
     UNKNOWN,
     "Two production lanes on one settled investigation checkpoint, REVEAL base varied against the committed value; compare selected action and whether the turn still delivers the clue.",
     None),
    ("social-intent", "REVEAL", 0.75, "constant",
     "Under social intent REVEAL scores below its investigate value, so a scene with an agenda NPC can reach CHARACTER instead.",
     UNKNOWN,
     "Two lanes on a social checkpoint with an agenda NPC present; vary the social REVEAL base and compare REVEAL-vs-CHARACTER selection.",
     None),
    ("dramatic-question-present", "DEEPEN", 0.5, "constant",
     "DEEPEN only competes mid-range, so it rarely beats REVEAL or PRESSURE and mostly surfaces when both are unavailable.",
     UNKNOWN,
     "Lanes on a checkpoint with a dramatic question and no available clue; vary the DEEPEN base and compare against the CHOICE no-trigger default.",
     None),
    ("yielded-scene", "PRESSURE", 0.85, "constant",
     "After the player has yielded the scene twice with pressure available, PRESSURE outscores REVEAL's social value and every mid-range action.",
     UNKNOWN,
     "Lanes from a checkpoint with two recorded low-agency continues; vary this value and compare whether the Director escalates or keeps revealing.",
     None),
    ("clock-near-full-or-stalled", "PRESSURE", 0.8, "constant",
     "A near-full threat clock or a single stalled turn puts PRESSURE just below the yielded-scene value and above all mid-range actions.",
     UNKNOWN,
     "Lanes from a checkpoint with one stalled turn; vary this value and compare selected action.",
     None),
    ("baseline", "PRESSURE", 0.2, "constant",
     "With no stall and no near-full clock, PRESSURE stays in scoring at a low value rather than dropping out, so a high structure weight can still surface it.",
     UNKNOWN,
     "Lanes on a calm checkpoint under the multi_faction weight (PRESSURE 1.2); vary the baseline and compare whether PRESSURE ever wins from calm.",
     None),
    ("reckless-posture-adjust", "PRESSURE", 0.1, "constant",
     "A reckless risk posture raises PRESSURE by one tenth, capped at 0.95, so posture can flip a tie but cannot by itself promote the baseline above a mid-range action.",
     UNKNOWN,
     "Lanes replaying one checkpoint with reckless and neutral rich-intent posture; compare selected action at equal base.",
     None),
    ("cautious-posture-adjust", "PRESSURE", -0.1, "constant",
     "A cautious risk posture lowers PRESSURE by one tenth, floored at 0.05, so pressure is tempered but never removed from scoring.",
     UNKNOWN,
     "Lanes replaying one checkpoint with cautious and neutral posture; compare selected action at equal base.",
     None),
    ("pushed-fail-nudge", "PRESSURE", 0.1, "constant",
     "A legal pushed-roll failure nudges PRESSURE once by one tenth, capped at 0.95, realising the rulebook's consequence-follows-a-pushed-failure requirement as a pacing preference rather than a gate.",
     "Keeper Rulebook 40th Anniversary p.83-85, cited in coc_story_director._base_score",
     None,
     ["coc7-keeper-rulebook-40th:printed-p83-85"]),
    ("agenda-npc-in-scene", "CHARACTER", 0.7, "constant",
     "An NPC with an authored agenda puts CHARACTER in the upper-middle of the range, below investigate REVEAL and above DEEPEN.",
     UNKNOWN,
     "Lanes on a checkpoint with both an available clue and an agenda NPC; vary this value and compare REVEAL-vs-CHARACTER.",
     None),
    ("two-undiscovered-clues", "CHOICE", 0.7, "constant",
     "Under idle, ambiguous or stuck intent with at least two undiscovered clues, CHOICE scores level with CHARACTER.",
     UNKNOWN,
     "Lanes from a stuck-intent checkpoint with exactly two undiscovered clues; vary this value and compare against the redirection path.",
     None),
    ("explicit-move-intent", "CUT", 1.0, "constant",
     "An explicit move intent with a resolved destination makes CUT the maximum possible base score, so movement wins unless a structure weight below 1.0 pulls it under another action.",
     UNKNOWN,
     "Lanes on a move-intent checkpoint under hub_sandbox (CUT weight 0.7); confirm whether movement still wins after weighting.",
     None),
    ("exit-condition-met", "CUT", 0.8, "constant",
     "A satisfied scene exit condition under low-agency continue scores CUT level with stalled PRESSURE.",
     UNKNOWN,
     "Lanes from a checkpoint whose exit condition is met while a threat clock is near full; compare CUT-vs-PRESSURE.",
     None),
    ("main-line-complete", "CUT", 0.7, "constant",
     "Once every core objective is worked out, a non-final scene generates transition pressure below a met exit condition, so the Keeper can still override by simply moving.",
     UNKNOWN,
     "Lanes from a main-line-complete checkpoint in a non-final scene; vary this value and compare whether the Director pushes toward the ending.",
     None),
    ("stalled-transition-pressure", "CUT", [0.45, 0.15, 0.85], "capped-linear",
     "From two stalled turns, CUT rises as 0.45 + 0.15 x stalled capped at 0.85, so it reaches the stalled-PRESSURE and RECOVER band at three stalled turns rather than immediately.",
     UNKNOWN,
     "Lanes replaying a checkpoint at two, three and four stalled turns; compare the turn at which CUT overtakes RECOVER.",
     None),
    ("montage-intent", "MONTAGE", 0.6, "constant",
     "Explicit montage intent scores just above DEEPEN, so montage is reachable but loses to any triggered REVEAL or PRESSURE.",
     UNKNOWN,
     "Lanes on a montage-intent checkpoint that also has an available clue; compare MONTAGE-vs-REVEAL.",
     None),
    ("combat-flee-cast-intent", "SUBSYSTEM", 0.9, "constant",
     "Combat, flight or spellcasting intent scores level with investigate REVEAL, and SUBSYSTEM's first place in the tiebreak order resolves that tie in its favour.",
     UNKNOWN,
     "Lanes on a checkpoint with both combat intent and an available clue; confirm the tiebreak resolves to SUBSYSTEM.",
     None),
    ("stalled-turns", "RECOVER", 0.85, "constant",
     "From two stalled turns RECOVER scores level with yielded-scene PRESSURE, and RECOVER's second place in the tiebreak order decides between them.",
     UNKNOWN,
     "Lanes from a two-stall checkpoint with pressure available; confirm the tiebreak resolves to RECOVER and compare play quality.",
     None),
    ("structured-entity-overlap", "PAYOFF", [0.15, 0.12, 0.85], "capped-linear",
     "PAYOFF rises as 0.15 + 0.12 x overlap capped at 0.85, so a single weak entity match stays below every triggered action and only multi-entity overlap competes.",
     UNKNOWN,
     "Lanes on a checkpoint with one-entity and three-entity temporal overlap; compare when PAYOFF first wins.",
     None),
]

# (threshold_id, subject, comparison, value, rationale, origin, falsifiable_by, source_refs)
LEGACY_THRESHOLDS = [
    ("pressure-clock-near-full-fraction", "clock.current_segments", "gte", [2, 3],
     "A threat clock counts as near full at two thirds of its segments, which is when PRESSURE leaves its baseline. Stored as a numerator/denominator pair because the source computes segments * 2 / 3; the quotient 0.6666666666666666 is not float-equivalent for 65 of the first 199 segment counts, including a 5-segment clock.",
     UNKNOWN,
     "Lanes on a checkpoint with a clock at one half, two thirds and three quarters; compare when the Director escalates.",
     None),
    ("pressure-yielded-low-agency-count", "rule_signals.low_agency_continue_count", "gte", 2,
     "Two consecutive low-agency continues with pressure available count as a yielded scene.",
     UNKNOWN,
     "Lanes replaying at one and two low-agency continues; compare escalation timing.",
     None),
    ("pressure-stalled-turns", "rule_signals.stalled_turns", "gte", 1,
     "A single stalled turn is enough to lift PRESSURE out of its baseline.",
     UNKNOWN,
     "Lanes at zero and one stalled turn; compare whether the Director escalates after one quiet turn.",
     None),
    ("choice-undiscovered-clue-count", "active_scene.available_clues.undiscovered", "gte", 2,
     "CHOICE requires at least two undiscovered clues so that offering a choice is meaningful.",
     UNKNOWN,
     "Lanes with one and two undiscovered clues under stuck intent; compare CHOICE availability.",
     None),
    ("cut-stalled-transition-turns", "rule_signals.stalled_turns", "gte", 2,
     "Stalled transition pressure on CUT starts at two stalled turns.",
     UNKNOWN,
     "Lanes at one, two and three stalled turns; compare when transition pressure appears.",
     None),
    ("recover-stalled-turns", "rule_signals.stalled_turns", "gte", 2,
     "RECOVER becomes available at two stalled turns.",
     UNKNOWN,
     "Lanes at one and two stalled turns; compare RECOVER availability.",
     None),
    ("override-low-agency-count", "rule_signals.low_agency_continue_count", "gte", 2,
     "Two low-agency continues with pressure available trigger the Layer-3 override that bypasses scoring entirely.",
     UNKNOWN,
     "Lanes at one and two continues; compare whether the override fires and scoring is bypassed.",
     None),
    ("override-stalled-turns", "rule_signals.stalled_turns", "gte", 3,
     "Three stalled turns trigger the Layer-3 override, one turn later than the scoring-level stall thresholds.",
     UNKNOWN,
     "Lanes at two, three and four stalled turns; compare override timing against scoring-level escalation.",
     None),
    ("scene-exit-pressure-continue-count", "rule_signals.low_agency_continue_count", "gte", 2,
     "The scene-exit pressure directive is emitted from the second low-agency continue.",
     UNKNOWN,
     "Lanes at one and two continues; compare whether the exit directive reaches the Keeper.",
     None),
    ("fair-warning-lethal-chances", "threat_clock.lethal_chances_used", "gte", 3,
     "Lethal outcomes are downgraded until three warnings have been used, realising the rulebook's Fair Warning requirement as a deterministic ladder.",
     "Keeper Rulebook 40th Anniversary p.209, cited in coc_story_director._apply_fair_warning_ladder",
     None,
     ["coc7-keeper-rulebook-40th:printed-p209"]),
    ("compression-max-beats-default", "scene.compression_budget.max_beats", "eq", 4,
     "A scene without an authored compression budget compresses low-agency play into at most four beats.",
     UNKNOWN,
     "Lanes on a low-agency stretch with the default and a doubled cap; compare beats spent before the Director forces progress.",
     None),
    ("compression-max-beats-floor", "scene.compression_budget.max_beats", "gte", 2,
     "An authored max_beats below two is clamped up, so no scene can compress to a single beat.",
     UNKNOWN,
     "Lanes with an authored max_beats of one; confirm the clamp and compare pacing.",
     None),
    ("compression-max-beats-ceiling", "scene.compression_budget.max_beats", "lte", 8,
     "An authored max_beats above eight is clamped down, bounding how long a scene may idle.",
     UNKNOWN,
     "Lanes with an authored max_beats of sixteen; confirm the clamp and compare pacing.",
     None),
    ("compression-min-beats-default", "scene.compression_budget.min_beats", "eq", 2,
     "A scene without an authored budget spends at least two beats before compression can complete.",
     UNKNOWN,
     "Lanes with min_beats one and two; compare the shortest compressed stretch.",
     None),
    ("compression-max-minutes-default", "scene.compression_budget.max_minutes", "eq", 10,
     "Compressed low-agency play advances at most ten in-fiction minutes by default.",
     UNKNOWN,
     "Lanes with ten and thirty minute caps; compare in-fiction clock drift over a low-agency stretch.",
     None),
    ("compression-max-minutes-ceiling", "scene.compression_budget.max_minutes", "lte", 30,
     "An authored max_minutes above thirty is clamped down, bounding time skipped inside one scene.",
     UNKNOWN,
     "Lanes with an authored max_minutes of ninety; confirm the clamp.",
     None),
    ("low-agency-max-beats-fallback", "scene.low_agency_max_beats", "eq", 4,
     "When neither a compression budget nor a bridge fallback is authored, four beats is the low-agency cap.",
     UNKNOWN,
     "Lanes on an unbudgeted bridge scene; vary the fallback and compare when the bridge exhausts.",
     None),
    ("pressure-move-stalled-gate", "rule_signals.stalled_turns", "gte", 1,
     "Pressure moves are only built for non-PRESSURE, non-RECOVER actions once at least one turn has stalled.",
     UNKNOWN,
     "Lanes at zero and one stalled turn under a REVEAL action; compare whether a pressure move accompanies the reveal.",
     None),
    ("pressure-move-low-agency-count", "rule_signals.low_agency_continue_count", "gte", 2,
     "Two low-agency continues also admit pressure moves regardless of the stall gate.",
     UNKNOWN,
     "Lanes at one and two continues with zero stalled turns; compare pressure-move presence.",
     None),
    ("clue-route-default-priority", "clue.route_priority", "eq", 0.5,
     "A clue without an authored route priority is treated as exactly mid-priority, so unauthored clues neither lead nor trail authored ones.",
     UNKNOWN,
     "Lanes on a scene mixing authored and unauthored route priorities; compare route ordering.",
     None),
    ("pressure-posture-ceiling", "scoring.pressure_base", "lte", 0.95,
     "Risk-posture and pushed-failure adjustments cannot lift PRESSURE past 0.95, so it stays below an explicit move intent's CUT score of 1.0.",
     UNKNOWN,
     "Lanes on a reckless-posture checkpoint that also has explicit move intent; raise the ceiling to 1.0 and compare PRESSURE-vs-CUT.",
     None),
    ("pressure-posture-floor", "scoring.pressure_base", "gte", 0.05,
     "A cautious posture cannot drive PRESSURE below 0.05, so pressure is tempered but never removed from scoring entirely.",
     UNKNOWN,
     "Lanes on a cautious-posture calm checkpoint under the multi_faction weight; drop the floor to 0.0 and compare whether PRESSURE leaves scoring.",
     None),
    ("default-clock-segments", "clock.segments", "eq", 6,
     "A threat clock that omits its segment count is treated as a six-segment clock, which sets both its near-full point and when it is considered complete.",
     UNKNOWN,
     "Lanes on a checkpoint carrying a clock with no authored segments; vary the default and compare escalation timing.",
     None),
    ("score-precision-digits", "scoring.weighted_score", "eq", 4,
     "Weighted scores are rounded to four decimals before comparison, which decides how often two actions tie and fall through to the tiebreak order.",
     UNKNOWN,
     "Lanes with two and six digits of precision on a checkpoint where two actions score within 1e-5; compare tiebreak frequency.",
     None),
]

# (ladder_id, rungs, rationale, origin, falsifiable_by)
LEGACY_AFFINITY_LADDERS = [
    ("pressure-move-scene-affinity",
     [{"rank": 6, "kind": "scene_clock_refs"},
      {"rank": 5, "kind": "danger_ids"},
      {"rank": 4, "kind": "scene_ids"},
      {"rank": 3, "kind": "threat_front_ids"},
      {"rank": 2, "kind": "scene_tags_any"},
      {"rank": 1, "kind": "faction_ids"},
      {"rank": 0, "kind": "fallback"}],
     "When several threat fronts could supply a pressure move, the one sharing the most specific structured reference with the scene wins: a clock the scene names beats a shared danger, which beats a scene id, and so on down to an unmatched fallback.",
     UNKNOWN,
     "Lanes on a checkpoint where two fronts match at different rungs; swap two adjacent rungs and compare which front supplies the pressure move."),
]


# Craft directives (slice D3). Unlike the numeric doctrine above, these declare
# a Director control decision as structured data so it can be grounded in the
# RuleGraph. They do not change control flow; a test pins each ``declares``
# payload against the branch it describes so the two cannot drift.
# (directive_id, name, declares, rationale, source_refs, grounded_by)
LEGACY_CRAFT_DIRECTIVES = [
    ("dying-clock-kind",
     "Dying tick uses the hour clock once stabilized, the round clock otherwise",
     {"stabilized": "hour", "unstabilized": "round"},
     "When an investigator is dying the Director asks the rescue engine for a "
     "dying tick and chooses the clock granularity, rather than requesting a "
     "generic CON check that could narrate death without applying it.",
     ["rule-graph:coc7:decision:dying-hour-clock",
      "rule-graph:coc7:decision:dying-round-clock"],
     ["decision:coc7:healing:dying-hour-clock",
      "decision:coc7:healing:dying-round-clock"]),
    ("dying-forces-rescue-subsystem",
     "A dying investigator hands the scene to the rescue subsystem",
     {"scene_action": "SUBSYSTEM", "subsystem": "combat", "extra_pressure": True},
     "Dying is the one HP state that overrides scoring entirely, because the "
     "death clock and durable dead state belong to the rescue engine and not "
     "to a pacing decision.",
     ["rule-graph:coc7:rule:dying-entry"],
     ["rule:coc7:healing:dying-entry"]),
]


def _slug(token: str) -> str:
    """Map a legacy token to a kebab-case semantic id segment."""
    return token.strip().lower().replace("_", "-")


def _finding(code: str, path: str, message: str) -> dict[str, str]:
    return {"code": code, "path": path, "message": message}


# --------------------------------------------------------------------------
# Legacy source readers
# --------------------------------------------------------------------------

def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def legacy_vocabulary() -> dict[str, list[str]]:
    """Return every legacy vocabulary token, keyed by target node_kind.

    Package JSON is read live so that adding a storylet without rebuilding the
    graph fails the round-trip test instead of silently drifting.
    """
    weights = _read_json(RULES_JSON_DIR / "structure-weights.json")
    storylets = _read_json(RULES_JSON_DIR / "storylet-library.json")
    time_costs = _read_json(RULES_JSON_DIR / "time-costs.json")

    signals: list[str] = []
    for group in SIGNAL_GROUPS:
        signals.extend(f"{group}/{tag}" for tag in LEGACY_SIGNAL_TAGS[group])

    return {
        "director-action": list(LEGACY_ACTIONS),
        "player-signal": signals,
        "structure-type": list(weights["types"]),
        "conflict-level": list(storylets["conflict_levels"]),
        "storylet": [row["storylet_id"] for row in storylets["storylets"]],
        "time-cost-category": list(time_costs["categories"]),
    }


# --------------------------------------------------------------------------
# Stage 1 — prepare
# --------------------------------------------------------------------------

def prepare(plane: str) -> dict[str, Any]:
    """Build a closed packet describing what one plane may transcribe."""
    if plane not in PLANES:
        raise ValueError(f"unknown plane {plane!r}")
    kinds = (
        sorted(VOCABULARY_NODE_KINDS) if plane == "vocabulary"
        else sorted(DOCTRINE_NODE_KINDS)
    )
    legacy_sources = (
        [
            "coc_story_director.ACTIONS",
            "coc_story_director._LOW_AGENCY_TAGS",
            "coc_story_director._ROUTINE_PROGRESS_TAGS",
            "coc_story_director._DRAMATIC_PROGRESS_ADVANCE_UNTIL",
            "coc_story_director._NON_BLOCKING_RULE_REQUEST_KINDS",
            "coc_story_director._SOCIAL_REVEAL_DELIVERY_KINDS",
            "rules-json/structure-weights.json#types",
            "rules-json/storylet-library.json#conflict_levels",
            "rules-json/storylet-library.json#storylets",
            "rules-json/time-costs.json#categories",
        ] if plane == "vocabulary" else [
            "coc_story_director._base_score",
            "coc_story_director.select_action",
            "coc_story_director._compression_budget",
            "coc_story_director.apply_rule_signal_overrides",
            "coc_story_director._build_pressure_moves",
            "rules-json/structure-weights.json#weights",
            "rules-json/structure-weights.json#tiebreak_order",
        ]
    )
    return {
        "contract_id": PACKET_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "plane": plane,
        "available_node_kinds": kinds,
        "legacy_sources": legacy_sources,
    }


# --------------------------------------------------------------------------
# Stage 2 — accept
# --------------------------------------------------------------------------

def accept(
    shard: Any, known_node_ids: frozenset[str] | None = None
) -> list[dict[str, str]]:
    """Deterministically validate one candidate shard. Returns findings.

    ``known_node_ids`` carries node ids owned by sibling shards. A doctrine
    node legitimately references a vocabulary node, so reference closure is
    only complete once shards are merged; ``build`` re-runs acceptance with the
    full id set and rejects anything still dangling.
    """
    findings: list[dict[str, str]] = []
    if not isinstance(shard, dict):
        return [_finding("invalid_shard", "/", "shard must be an object")]
    if shard.get("contract_id") != SHARD_CONTRACT_ID:
        findings.append(_finding(
            "wrong_contract_id", "/contract_id", str(shard.get("contract_id"))
        ))
    plane = shard.get("plane")
    if plane not in PLANES:
        findings.append(_finding("unknown_plane", "/plane", str(plane)))
    allowed_kinds = (
        VOCABULARY_NODE_KINDS if plane == "vocabulary"
        else DOCTRINE_NODE_KINDS if plane == "doctrine"
        else NODE_KINDS
    )

    nodes = shard.get("nodes")
    if not isinstance(nodes, list):
        return findings + [_finding("invalid_nodes", "/nodes", "nodes must be an array")]

    seen: set[str] = set()
    for index, node in enumerate(nodes):
        path = f"/nodes/{index}"
        if not isinstance(node, dict):
            findings.append(_finding("invalid_node", path, "node must be an object"))
            continue
        node_id = str(node.get("node_id") or "")
        kind = str(node.get("node_kind") or "")

        if kind not in NODE_KINDS:
            findings.append(_finding("unknown_node_kind", f"{path}/node_kind", kind))
        elif kind not in allowed_kinds:
            findings.append(_finding(
                "node_kind_outside_plane", f"{path}/node_kind",
                f"{kind} does not belong to plane {plane!r}",
            ))

        if not SEMANTIC_ID_RE.fullmatch(node_id):
            findings.append(_finding("invalid_semantic_id", f"{path}/node_id", node_id))
        elif not node_id.startswith(f"{kind}:"):
            findings.append(_finding(
                "node_id_kind_mismatch", f"{path}/node_id",
                f"node id must begin with {kind!r}",
            ))
        if node_id in seen:
            findings.append(_finding("duplicate_node_id", f"{path}/node_id", node_id))
        seen.add(node_id)

        extra = set(node) - NODE_KEYS - OPTIONAL_NODE_KEYS
        if extra:
            findings.append(_finding(
                "unknown_node_key", path, ", ".join(sorted(extra))
            ))
        missing = NODE_KEYS - set(node)
        if missing:
            findings.append(_finding(
                "missing_node_key", path, ", ".join(sorted(missing))
            ))

        properties = node.get("properties")
        if not isinstance(properties, dict):
            findings.append(_finding(
                "invalid_properties", f"{path}/properties", "must be an object"
            ))
        elif kind in NODE_PROPERTY_KEYS:
            allowed = set(NODE_PROPERTY_KEYS[kind])
            unknown = set(properties) - allowed
            if unknown:
                findings.append(_finding(
                    "unknown_property", f"{path}/properties",
                    ", ".join(sorted(unknown)),
                ))
            absent = allowed - set(properties)
            if absent:
                findings.append(_finding(
                    "missing_property", f"{path}/properties",
                    ", ".join(sorted(absent)),
                ))
            if kind == "player-signal":
                group = properties.get("signal_group")
                if group not in SIGNAL_GROUPS:
                    findings.append(_finding(
                        "unknown_signal_group", f"{path}/properties/signal_group",
                        str(group),
                    ))

        findings.extend(_accountability_findings(node, kind, path))

    relations = shard.get("relations")
    if not isinstance(relations, list):
        findings.append(_finding("invalid_relations", "/relations", "must be an array"))
    else:
        for index, relation in enumerate(relations):
            path = f"/relations/{index}"
            if not isinstance(relation, dict):
                findings.append(_finding("invalid_relation", path, "must be an object"))
                continue
            if relation.get("relation_kind") not in RELATION_KINDS:
                findings.append(_finding(
                    "unknown_relation_kind", f"{path}/relation_kind",
                    str(relation.get("relation_kind")),
                ))
            if set(relation) != RELATION_KEYS:
                findings.append(_finding(
                    "relation_key_mismatch", path,
                    "relations use the exact closed key set",
                ))
            resolvable = seen | (known_node_ids or frozenset())
            for endpoint in ("from_node_id", "to_node_id"):
                target = str(relation.get(endpoint) or "")
                if target and target not in resolvable:
                    findings.append(_finding(
                        "dangling_relation", f"{path}/{endpoint}", target
                    ))
    return findings


def _accountability_findings(
    node: dict[str, Any], kind: str, path: str
) -> list[dict[str, str]]:
    """Contract accountability_law: doctrine values must say where they came from."""
    findings: list[dict[str, str]] = []
    evidence_class = node.get("evidence_class")
    if kind in VOCABULARY_NODE_KINDS:
        if evidence_class is not None:
            findings.append(_finding(
                "unexpected_evidence_class", f"{path}/evidence_class",
                "vocabulary nodes carry no evidence class",
            ))
        return findings
    if kind not in DOCTRINE_NODE_KINDS:
        return findings
    if evidence_class not in EVIDENCE_CLASSES:
        findings.append(_finding(
            "missing_evidence_class", f"{path}/evidence_class", str(evidence_class)
        ))
        return findings
    for field in EVIDENCE_REQUIRED[evidence_class]:
        value = node.get(field)
        ok = (
            bool(value) if field == "source_refs"
            else isinstance(value, str) and bool(value.strip())
        )
        if not ok:
            findings.append(_finding(
                "missing_accountability", f"{path}/{field}",
                f"{evidence_class} requires a non-empty {field}",
            ))
    return findings


# --------------------------------------------------------------------------
# Stage 3 — build
# --------------------------------------------------------------------------

def _canonical_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def build(shards: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge accepted shards into one graph plus its build manifest."""
    nodes: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []
    plane_coverage = {plane: "unresolved" for plane in PLANES}
    shard_ids: list[str] = []

    all_node_ids = frozenset(
        str(node.get("node_id") or "")
        for shard in shards
        for node in (shard.get("nodes") or [])
        if isinstance(node, dict)
    )
    for shard in shards:
        findings = accept(shard, known_node_ids=all_node_ids)
        if findings:
            raise ValueError(f"shard {shard.get('shard_id')!r} is not acceptable: {findings}")
        shard_ids.append(str(shard["shard_id"]))
        nodes.extend(shard["nodes"])
        relations.extend(shard["relations"])
        plane_coverage[str(shard["plane"])] = "accepted"

    nodes.sort(key=lambda row: row["node_id"])
    relations.sort(key=lambda row: row["relation_id"])

    graph = {
        "contract_id": GRAPH_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "graph_id": GRAPH_ID,
        "nodes": nodes,
        "relations": relations,
        "coverage": plane_coverage,
    }
    counts: dict[str, int] = {}
    for node in nodes:
        counts[node["node_kind"]] = counts.get(node["node_kind"], 0) + 1

    manifest = {
        "contract_id": BUILD_MANIFEST_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "graph_id": GRAPH_ID,
        "graph_content_digest": hashlib.sha256(
            _canonical_json(graph).encode("utf-8")
        ).hexdigest(),
        "shards": sorted(shard_ids),
        "plane_coverage": plane_coverage,
        "compiler_identity": COMPILER_IDENTITY,
        "node_counts": dict(sorted(counts.items())),
    }
    return {"graph": graph, "manifest": manifest}


# --------------------------------------------------------------------------
# Production artifact composition
# --------------------------------------------------------------------------

def vocabulary_shard() -> dict[str, Any]:
    """Compose the D1 vocabulary shard from the legacy sources."""
    storylets = _read_json(RULES_JSON_DIR / "storylet-library.json")
    time_costs = _read_json(RULES_JSON_DIR / "time-costs.json")
    storylet_rows = {row["storylet_id"]: row for row in storylets["storylets"]}

    nodes: list[dict[str, Any]] = []

    for ordinal, action in enumerate(LEGACY_ACTIONS):
        nodes.append({
            "node_id": f"director-action:{_slug(action)}",
            "node_kind": "director-action",
            "plane": "vocabulary",
            "name": action,
            "properties": {"legacy_key": action, "ordinal": ordinal},
        })

    for group in SIGNAL_GROUPS:
        for ordinal, tag in enumerate(LEGACY_SIGNAL_TAGS[group]):
            nodes.append({
                "node_id": f"player-signal:{group}:{_slug(tag)}",
                "node_kind": "player-signal",
                "plane": "vocabulary",
                "name": tag,
                "properties": {
                    "legacy_key": tag, "signal_group": group, "ordinal": ordinal,
                },
            })

    structures = _read_json(RULES_JSON_DIR / "structure-weights.json")["types"]
    for ordinal, structure in enumerate(structures):
        nodes.append({
            "node_id": f"structure-type:{_slug(structure)}",
            "node_kind": "structure-type",
            "plane": "vocabulary",
            "name": structure,
            "properties": {"legacy_key": structure, "ordinal": ordinal},
        })

    for ordinal, level in enumerate(storylets["conflict_levels"]):
        nodes.append({
            "node_id": f"conflict-level:{_slug(level)}",
            "node_kind": "conflict-level",
            "plane": "vocabulary",
            "name": level,
            "properties": {"legacy_key": level, "ordinal": ordinal},
        })

    for ordinal, (storylet_id, row) in enumerate(storylet_rows.items()):
        nodes.append({
            "node_id": f"storylet:{storylet_id}",
            "node_kind": "storylet",
            "plane": "vocabulary",
            "name": row.get("title") or storylet_id,
            "properties": {
                "legacy_key": storylet_id, "payload": row, "ordinal": ordinal,
            },
        })

    for ordinal, (category, row) in enumerate(time_costs["categories"].items()):
        nodes.append({
            "node_id": f"time-cost-category:{_slug(category)}",
            "node_kind": "time-cost-category",
            "plane": "vocabulary",
            "name": category,
            "properties": {
                "legacy_key": category, "payload": row, "ordinal": ordinal,
            },
        })

    relations: list[dict[str, Any]] = []
    node_ids = {node["node_id"] for node in nodes}
    for storylet_id, row in storylet_rows.items():
        level = row.get("conflict_level")
        target = f"conflict-level:{_slug(str(level))}"
        if target in node_ids:
            relations.append({
                "relation_id": f"relation:director:storylet-{storylet_id}-conflict",
                "relation_kind": "part-of",
                "from_node_id": f"storylet:{storylet_id}",
                "to_node_id": target,
            })

    return {
        "contract_id": SHARD_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "shard_id": "shard:director:vocabulary",
        "plane": "vocabulary",
        "nodes": nodes,
        "relations": relations,
    }


def _doctrine_node(
    node_id: str,
    kind: str,
    name: str,
    properties: dict[str, Any],
    *,
    rationale: str,
    origin: str | None,
    falsifiable_by: str | None,
    source_refs: list[str] | None,
) -> dict[str, Any]:
    """Assemble one doctrine node with its accountability fields."""
    node: dict[str, Any] = {
        "node_id": node_id,
        "node_kind": kind,
        "plane": "doctrine",
        "name": name,
        "properties": properties,
    }
    if source_refs:
        node["evidence_class"] = "rule-derived"
        node["source_refs"] = list(source_refs)
        node["rationale"] = rationale
        node["origin"] = origin or ""
    else:
        node["evidence_class"] = "authored-doctrine"
        node["rationale"] = rationale
        node["origin"] = origin or UNKNOWN
        node["falsifiable_by"] = falsifiable_by or ""
    return node


def doctrine_shard() -> dict[str, Any]:
    """Compose the D2 doctrine shard. Values are transcribed, never retuned."""
    weights_doc = _read_json(RULES_JSON_DIR / "structure-weights.json")
    nodes: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []

    weight_rationale = (
        "Layer-2 multiplier applied to every Layer-1 base score for this module "
        "structure, deciding which action a structure prefers when several are "
        "triggered at once."
    )
    weight_falsifiable = (
        "Two production lanes on one settled checkpoint under this structure "
        "type, this cell varied against the committed value; compare the "
        "selected action and the resulting turn."
    )
    for structure, row in weights_doc["weights"].items():
        for action, value in row.items():
            nodes.append(_doctrine_node(
                f"structure-weight:{_slug(structure)}:{_slug(action)}",
                "structure-weight",
                f"{structure} x {action}",
                {
                    "structure_ref": f"structure-type:{_slug(structure)}",
                    "action_ref": f"director-action:{_slug(action)}",
                    "value": value,
                },
                rationale=weight_rationale,
                origin=UNKNOWN,
                falsifiable_by=weight_falsifiable,
                source_refs=None,
            ))
            relations.append({
                "relation_id": f"relation:director:weight-{_slug(structure)}-{_slug(action)}",
                "relation_kind": "weights",
                "from_node_id": f"structure-weight:{_slug(structure)}:{_slug(action)}",
                "to_node_id": f"director-action:{_slug(action)}",
            })

    nodes.append(_doctrine_node(
        "tiebreak-order:default",
        "tiebreak-order",
        "director action tiebreak order",
        {"order": list(weights_doc["tiebreak_order"])},
        rationale=(
            "When several actions share the maximum weighted score, the first "
            "entry of this order wins. SUBSYSTEM and RECOVER lead it, so a "
            "triggered subsystem or recovery beats an equally scored reveal."
        ),
        origin=UNKNOWN,
        falsifiable_by=(
            "Lanes on a checkpoint that ties SUBSYSTEM with REVEAL; swap the "
            "two leading entries and compare the selected action."
        ),
        source_refs=None,
    ))

    for (condition_id, action, value, value_kind, rationale, origin,
         falsifiable_by, source_refs) in LEGACY_SCORING_RULES:
        node_id = f"scoring-rule:{_slug(action)}:{condition_id}"
        nodes.append(_doctrine_node(
            node_id, "scoring-rule", f"{action} / {condition_id}",
            {
                "action_ref": f"director-action:{_slug(action)}",
                "condition_id": condition_id,
                "value": value,
                "value_kind": value_kind,
            },
            rationale=rationale, origin=origin,
            falsifiable_by=falsifiable_by, source_refs=source_refs,
        ))
        relations.append({
            "relation_id": f"relation:director:scores-{_slug(action)}-{condition_id}",
            "relation_kind": "scores",
            "from_node_id": node_id,
            "to_node_id": f"director-action:{_slug(action)}",
        })

    for (threshold_id, subject, comparison, value, rationale, origin,
         falsifiable_by, source_refs) in LEGACY_THRESHOLDS:
        nodes.append(_doctrine_node(
            f"threshold:{threshold_id}", "threshold", threshold_id,
            {
                "threshold_id": threshold_id,
                "value": value,
                "comparison": comparison,
                "subject": subject,
            },
            rationale=rationale, origin=origin,
            falsifiable_by=falsifiable_by, source_refs=source_refs,
        ))

    for ladder_id, rungs, rationale, origin, falsifiable_by in LEGACY_AFFINITY_LADDERS:
        nodes.append(_doctrine_node(
            f"affinity-ladder:{ladder_id}", "affinity-ladder", ladder_id,
            {"ladder_id": ladder_id, "rungs": rungs},
            rationale=rationale, origin=origin,
            falsifiable_by=falsifiable_by, source_refs=None,
        ))

    for (directive_id, name, declares, rationale, source_refs,
         grounded_by) in LEGACY_CRAFT_DIRECTIVES:
        node = _doctrine_node(
            f"craft-directive:{directive_id}", "craft-directive", name,
            {"directive_id": directive_id, "declares": declares},
            rationale=rationale,
            origin="coc_story_director control branch, grounded in the coc7 RuleGraph",
            falsifiable_by=None,
            source_refs=source_refs,
        )
        node["grounded_by"] = list(grounded_by)
        nodes.append(node)

    return {
        "contract_id": SHARD_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "shard_id": "shard:director:doctrine",
        "plane": "doctrine",
        "nodes": nodes,
        "relations": relations,
    }


def build_from_legacy_sources() -> dict[str, Any]:
    """Build the production DirectorGraph artifact and manifest."""
    return build([vocabulary_shard(), doctrine_shard()])


def main(argv: list[str] | None = None) -> int:
    built = build_from_legacy_sources()
    (REFERENCES_DIR / "director-graph.json").write_text(
        json.dumps(built["graph"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (REFERENCES_DIR / "director-graph-manifest.json").write_text(
        json.dumps(built["manifest"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({
        "ok": True,
        "node_counts": built["manifest"]["node_counts"],
        "digest": built["manifest"]["graph_content_digest"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
