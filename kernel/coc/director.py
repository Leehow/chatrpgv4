"""The Director (contract §13.3, §13.7): signals from state, three-layer scoring whose
every number is read from `content/director/director-graph.json`, and the adoption
evidence a closed turn leaves behind.

Two laws carried from the old tree's DirectorRuntime:

- fail closed: a missing, unparsable or digest-mismatched graph raises; nothing here
  falls back to a literal, so the values stay accountable to the artifact;
- ordinal law: vocabulary order (the beats, the structure types) is reconstructed from
  `properties.ordinal`, never from artifact order.

The Director has no write side. Its output is a section of the capsule; whether the
keeper followed it is inferred afterwards from receipts (`director_adoption`)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

from .errors import RpcError
from .fileio import read_json
from .module_graph import CLUE_KIND, ModuleGraph, condition_met, describe_condition, record_of
from .rules.graph_digest import compute_graph_content_digest
from .text import normalize

GRAPH_CONTRACT_ID = "coc.director-graph.v1"
MANIFEST_CONTRACT_ID = "coc.director-graph-build-manifest.v1"
#: The six node kinds the kernel reads (§13.3); storylet, multiplier, time-cost-category,
#: conflict-level and affinity-ladder stay in the file unread.
READ_KINDS = ("director-action", "structure-type", "structure-weight", "scoring-rule", "threshold",
              "tiebreak-order", "player-signal")

#: The spec's eleventh beat: the default when no scoring rule fires. Not in the graph.
ADVANCE = "ADVANCE"
BEATS_FROM_SPEC = (ADVANCE,)
DEFAULT_STRUCTURE = "branching_investigation"
REVEAL_LIMIT = 5

#: Closed vocabularies of the signals (§13.3 table).
INTENT_FROM_RECEIPTS = {"move": "move", "time": "idle", "none": "none"}
HP_STATES = ("healthy", "wounded", "major_wound", "dying", "dead")
SANITY_STATES = ("stable", "shaken", "bout_active", "indefinite")
SESSION_KINDS = ("none", "combat", "chase", "sanity_bout")
LAST_ROLLS = ("none", "passed", "failed", "critical", "fumble")

#: Layer 3 hard rules, in precedence order: override name -> (beat, extra beat in `because`).
OVERRIDES = {"session": ("SUBSYSTEM", None), "dying": ("SUBSYSTEM", "PRESSURE"),
             "fumble": ("PRESSURE", None), "pending_choice": ("CHOICE", None)}
#: The Director-graph nodes the ontology registers for an override's grounding (§13.4
#: `grounded-by` runs from Director nodes; an override hit no scoring rule, so it grounds
#: through the nodes the registry ties to that emergency). Closed; unlisted -> [].
OVERRIDE_GROUNDING = {
    "session": ("scoring-rule:subsystem:combat-flee-cast-intent",),
    "dying": ("craft-directive:dying-forces-rescue-subsystem", "craft-directive:dying-clock-kind"),
}

REASONS = {
    "advance": "no trigger; advance",
    "scored": "{beat}: {conditions} hold, weighted {score}",
    "override": {"session": "a session is live; hand it to the subsystem", "dying": "someone is dying: subsystem takes over, pressure on",
                 "fumble": "last roll fumbled; misfortune lands now", "pending_choice": "a choice is pending; the player answers first"},
}


# ---- the graph ----------------------------------------------------------------------------

class DirectorGraphError(RpcError):
    def __init__(self, message: str, **details: Any) -> None:
        super().__init__("campaign_not_ready", f"the Director graph is not usable: {message}",
                         fix="restore content/director/director-graph.json and its manifest; the Director never falls back to literals",
                         details={"director": {"reason": message, **details}})


class DirectorGraph:
    """Read-only accessor over the doctrine plane; holds no policy."""

    def __init__(self, directory: Path) -> None:
        self.dir = Path(directory)
        graph_path = self.dir / "director-graph.json"
        manifest_path = self.dir / "director-graph-manifest.json"
        try:
            graph = read_json(graph_path)
            manifest = read_json(manifest_path)
        except (OSError, ValueError) as exc:
            raise DirectorGraphError(f"artifact unreadable: {exc}")
        if not isinstance(graph, dict) or graph.get("contract_id") != GRAPH_CONTRACT_ID:
            raise DirectorGraphError(f"graph does not declare {GRAPH_CONTRACT_ID}")
        if not isinstance(manifest, dict) or manifest.get("contract_id") != MANIFEST_CONTRACT_ID:
            raise DirectorGraphError(f"manifest does not declare {MANIFEST_CONTRACT_ID}")
        if not isinstance(graph.get("nodes"), list):
            raise DirectorGraphError("graph has no node list")
        declared = manifest.get("graph_content_digest")
        actual = compute_graph_content_digest(graph)
        if not isinstance(declared, str) or declared != actual:
            raise DirectorGraphError("graph content digest does not match the manifest",
                                     declared=declared, actual=actual)
        self.digest = actual
        self.nodes: dict[str, dict[str, Any]] = {n["node_id"]: n for n in graph["nodes"]
                                                 if isinstance(n, dict) and isinstance(n.get("node_id"), str)}
        legacy = {node_id: str(n["properties"]["legacy_key"]) for node_id, n in self.nodes.items()
                  if n.get("plane") == "vocabulary" and "legacy_key" in (n.get("properties") or {})}
        self._legacy = legacy
        self.actions: list[str] = [legacy[n] for n in self._ordered("director-action")]
        self.structure_types: list[str] = [legacy[n] for n in self._ordered("structure-type")]
        self._scores: dict[tuple[str, str], Any] = {}
        self._thresholds: dict[str, Any] = {}
        self._weights: dict[str, dict[str, float]] = {}
        self._tiebreak: list[str] = []
        self.rule_ids: dict[tuple[str, str], str] = {}
        for node_id, node in self.nodes.items():
            kind = node.get("node_kind")
            props = node.get("properties") or {}
            if kind == "scoring-rule":
                key = (legacy[props["action_ref"]], str(props["condition_id"]))
                self._scores[key] = props["value"]
                self.rule_ids[key] = node_id
            elif kind == "threshold":
                self._thresholds[str(props["threshold_id"])] = props["value"]
            elif kind == "structure-weight":
                self._weights.setdefault(legacy[props["structure_ref"]], {})[legacy[props["action_ref"]]] = float(props["value"])
            elif kind == "tiebreak-order":
                self._tiebreak = [str(a) for a in props["order"]]
        if not self.actions or not self._tiebreak or not self._weights:
            raise DirectorGraphError("graph declares no actions, weights or tiebreak order")

    def _ordered(self, kind: str) -> list[str]:
        rows = [(n["properties"]["ordinal"], node_id) for node_id, n in self.nodes.items() if n.get("node_kind") == kind]
        return [node_id for _, node_id in sorted(rows)]

    @property
    def beats(self) -> list[str]:
        return [*self.actions, *BEATS_FROM_SPEC]

    def score(self, action: str, condition_id: str) -> Any:
        try:
            return self._scores[(action, condition_id)]
        except KeyError:
            raise DirectorGraphError(f"no scoring rule for {action}/{condition_id}") from None

    def threshold(self, threshold_id: str) -> Any:
        try:
            return self._thresholds[threshold_id]
        except KeyError:
            raise DirectorGraphError(f"no threshold {threshold_id!r}") from None

    def weight(self, structure: str, action: str) -> float:
        row = self._weights.get(structure)
        if row is None:
            raise DirectorGraphError(f"no structure weights for {structure!r}", known=self.structure_types)
        try:
            return row[action]
        except KeyError:
            raise DirectorGraphError(f"no weight for {structure}/{action}") from None

    @property
    def tiebreak(self) -> list[str]:
        return list(self._tiebreak)


# ---- signals -----------------------------------------------------------------------------

def hp_state(current_hp: Any, max_hp: Any, conditions: Iterable[str]) -> str:
    """Rulebook p.119-120: hp<0 dead; hp==0 with a major wound dying; major wound; hp<max wounded."""
    hp = int(current_hp or 0)
    conditions = set(conditions or ())
    if hp < 0:
        return "dead"
    if hp == 0 and "major_wound" in conditions:
        return "dying"
    if "major_wound" in conditions:
        return "major_wound"
    if isinstance(max_hp, int) and hp < max_hp:
        return "wounded"
    return "healthy"


def sanity_state(current_san: Any, *, bout: bool, indefinite: bool, lost_in_scene: bool) -> str:
    if bout:
        return "bout_active"
    if int(current_san or 0) <= 0 or indefinite:
        return "indefinite"
    return "shaken" if lost_in_scene else "stable"


def intent_of_record(record: dict[str, Any] | None) -> str:
    """The previous turn's declared intent, else what its receipts imply (§13.3)."""
    if record is None:
        return "none"
    intents = [str(i) for i in record.get("intents") or []]
    if intents:
        return intents[-1]
    kinds = {r.get("kind") for r in record.get("receipts") or [] if isinstance(r, dict)}
    if "move" in kinds:
        return INTENT_FROM_RECEIPTS["move"]
    if kinds and kinds <= {"time"}:
        return INTENT_FROM_RECEIPTS["time"]
    return INTENT_FROM_RECEIPTS["none"]


def last_roll_of(record: dict[str, Any] | None) -> str:
    if record is None:
        return "none"
    for receipt in reversed(record.get("receipts") or []):
        if not isinstance(receipt, dict) or receipt.get("kind") != "roll" or receipt.get("form") == "dice":
            continue
        level = str(receipt.get("level") or "")
        if level in ("critical", "fumble"):
            return level
        return "passed" if receipt.get("passed") else "failed"
    return "none"


def pushed_fail_pending(record: dict[str, Any] | None) -> bool:
    """A pushed roll that failed last turn with nothing bad landing after it: no negative
    delta, no damage die, no session start in the rest of that turn."""
    if record is None:
        return False
    receipts = [r for r in record.get("receipts") or [] if isinstance(r, dict)]
    for index, receipt in enumerate(receipts):
        if receipt.get("kind") != "roll" or not receipt.get("pushed") or receipt.get("passed"):
            continue
        later = receipts[index + 1:]
        consequence = any(
            (r.get("kind") == "delta" and isinstance(r.get("before"), int) and isinstance(r.get("after"), int)
             and r["after"] < r["before"])
            or (r.get("kind") == "roll" and r.get("form") == "dice")
            or (r.get("kind") == "session" and r.get("transition") == "start")
            for r in later)
        if not consequence:
            return True
    return False


def _changed_state(record: dict[str, Any]) -> bool:
    return any(isinstance(r, dict) and r.get("kind") in ("clue", "move", "session") for r in record.get("receipts") or [])


def played_records(records: dict[int, dict[str, Any]], before_turn: int) -> list[dict[str, Any]]:
    """Closed turns the player actually played, latest first (the opening turn 0 and any
    implicit close carry no player text and do not count as pacing)."""
    rows = [records[n] for n in sorted(records, reverse=True) if n < before_turn]
    return [r for r in rows if r.get("player_text")]


def stalled_turns(played: list[dict[str, Any]]) -> int:
    count = 0
    for record in played:
        if _changed_state(record):
            break
        count += 1
    return count


def turns_in_scene(played: list[dict[str, Any]], scene_handle: str) -> int:
    count = 1
    for record in played:
        scene = ((record.get("world") or {}).get("scene") or {}).get("name")
        if scene != scene_handle:
            break
        count += 1
    return count


def san_lost_in_scene(played: list[dict[str, Any]], scene_handle: str, investigator_id: str) -> bool:
    for record in played:
        scene = ((record.get("world") or {}).get("scene") or {}).get("name")
        if scene != scene_handle:
            break
        for receipt in record.get("receipts") or []:
            if (isinstance(receipt, dict) and receipt.get("kind") == "delta" and receipt.get("resource") == "san"
                    and str(receipt.get("subject")) == investigator_id and isinstance(receipt.get("before"), int)
                    and isinstance(receipt.get("after"), int) and receipt["after"] < receipt["before"]):
                return True
    return False


def conclusion_reachable(graph: ModuleGraph, conclusion: dict[str, Any], discovered: set[str]) -> bool:
    clues = [graph.handle(graph.nodes[r["from_node_id"]]) for r in graph.in_rel.get(conclusion["node_id"], [])
             if r.get("relation_kind") == "supports" and r.get("from_node_id") in graph.nodes
             and graph.nodes[r["from_node_id"]]["node_kind"] == CLUE_KIND]
    return bool(clues) and all(c in discovered for c in clues)


def main_line_complete(graph: ModuleGraph, world: dict[str, Any]) -> bool:
    discovered = set(world.get("discovered_clues") or [])
    return any(conclusion_reachable(graph, node, discovered) for node in graph.by_kind.get("conclusion", []))


def structure_type_of(graph: ModuleGraph) -> str:
    declared = record_of(graph.module_node).get("structure_type") if graph.module_node else None
    return str(declared) if isinstance(declared, str) and declared else DEFAULT_STRUCTURE


def memory_overlap_count(rows: Iterable[dict[str, Any]], names: Iterable[str]) -> int:
    """How many open memory candidates mention any of `names` (subject, knowers, entities)."""
    keys = {normalize(str(n)) for n in names if n}
    if not keys:
        return 0
    count = 0
    for row in rows:
        if row.get("superseded_by") is not None:
            continue
        mentioned = [row.get("subject"), *(row.get("knowers") or []), *(row.get("entities") or [])]
        if any(normalize(str(m)) in keys for m in mentioned if m):
            count += 1
    return count


# ---- scoring -----------------------------------------------------------------------------

def _capped_linear(value: Any, steps: int) -> float:
    base, per_turn, cap = (float(v) for v in value)
    return min(cap, base + per_turn * steps)


def _hits(dg: DirectorGraph, sig: dict[str, Any], scene: dict[str, Any], *, can_move: bool,
          overlap: int, pressure_available: bool) -> dict[str, list[tuple[str, float]]]:
    """Layer 1: per beat, the scoring-rule conditions that hold and their values. The
    condition ids are the graph's `condition_id`s; their semantics are the closed table
    in §13.3."""
    intent = sig["intent"]
    stalled = int(sig["stalled_turns"])
    hits: dict[str, list[tuple[str, float]]] = {}

    def hit(beat: str, condition: str, value: float | None = None) -> None:
        hits.setdefault(beat, []).append((condition, float(dg.score(beat, condition)) if value is None else value))

    if sig["undiscovered_here"] > 0:
        if intent == "investigate":
            hit("REVEAL", "investigate-intent")
        elif intent == "social":
            hit("REVEAL", "social-intent")
    if sig["dramatic_question"] and intent in ("investigate", "social"):
        hit("DEEPEN", "dramatic-question-present")
    hit("PRESSURE", "baseline")
    if sig["clock_near_full"] or stalled >= int(dg.threshold("pressure-stalled-turns")):
        hit("PRESSURE", "clock-near-full-or-stalled")
    if sig["turns_in_scene"] >= 3 and sig["undiscovered_here"] == 0 and pressure_available:
        hit("PRESSURE", "yielded-scene")
    if sig["agenda_npc_present"] > 0:
        hit("CHARACTER", "agenda-npc-in-scene")
    if intent in ("idle", "ambiguous", "stuck") and sig["undiscovered_here"] >= int(dg.threshold("choice-undiscovered-clue-count")):
        hit("CHOICE", "two-undiscovered-clues")
    if can_move:
        if intent == "move":
            hit("CUT", "explicit-move-intent")
        if sig["exit_condition_met"]:
            hit("CUT", "exit-condition-met")
        if sig["main_line_complete"] and not record_of(scene).get("is_final"):
            hit("CUT", "main-line-complete")
        if stalled >= int(dg.threshold("cut-stalled-transition-turns")):
            hit("CUT", "stalled-transition-pressure", _capped_linear(dg.score("CUT", "stalled-transition-pressure"), stalled))
    if intent == "montage":
        hit("MONTAGE", "montage-intent")
    if overlap > 0:
        hit("PAYOFF", "structured-entity-overlap", _capped_linear(dg.score("PAYOFF", "structured-entity-overlap"), overlap))
    if stalled >= int(dg.threshold("recover-stalled-turns")):
        hit("RECOVER", "stalled-turns")
    if intent in ("combat", "flee", "cast"):
        hit("SUBSYSTEM", "combat-flee-cast-intent")
    return hits


def override_of(sig: dict[str, Any]) -> str | None:
    """Layer 3, in precedence order (§13.3)."""
    if sig["session"] != "none":
        return "session"
    if sig["hp_state"] == "dying":
        return "dying"
    if sig["last_roll"] == "fumble":
        return "fumble"
    if sig["pending_choice"]:
        return "pending_choice"
    return None


def score(dg: DirectorGraph, sig: dict[str, Any], scene: dict[str, Any], *, can_move: bool,
          overlap: int, pressure_available: bool) -> dict[str, Any]:
    """Three layers: hard rules first, then Layer-1 hits x Layer-2 structure weight, then the
    tiebreak order. Returns {beat, reason, because, scores, override?, hit_rules}. `hit_rules`
    are Director-graph node ids for the ontology (not a capsule field)."""
    because = [f"{name} = {sig[name]}" for name in SIGNAL_ORDER]
    digits = int(dg.threshold("score-precision-digits"))
    name = override_of(sig)
    if name is not None:
        beat, extra = OVERRIDES[name]
        out = {"beat": beat, "reason": REASONS["override"][name], "because": list(because),
               "scores": {beat: 1.0}, "override": name,
               "hit_rules": list(OVERRIDE_GROUNDING.get(name, ()))}
        if extra:
            out["because"].append(f"extra = {extra}")
        return out
    hits = _hits(dg, sig, scene, can_move=can_move, overlap=overlap, pressure_available=pressure_available)
    structure = sig["structure_type"]
    ceiling = float(dg.threshold("pressure-posture-ceiling"))
    weighted: dict[str, float] = {}
    for beat in dg.actions:
        rows = hits.get(beat, [])
        base = max((v for _, v in rows), default=0.0)
        if beat == "PRESSURE" and sig["pushed_fail_pending"]:
            nudge = float(dg.score("PRESSURE", "pushed-fail-nudge"))
            base = min(ceiling, round(base + nudge, digits))
            rows.append(("pushed-fail-nudge", nudge))
            hits[beat] = rows
        weighted[beat] = round(base * dg.weight(structure, beat), digits)
    top = max(weighted.values(), default=0.0)
    ranked = sorted(weighted.items(), key=lambda item: (-item[1], dg.tiebreak.index(item[0]) if item[0] in dg.tiebreak else len(dg.tiebreak)))
    scores = {beat: value for beat, value in ranked[:3] if value > 0}
    # PRESSURE's `baseline` is what it keeps when nothing reacts (its rationale: "with no
    # stall and no near-full clock"); it is not a trigger. With no trigger at all the
    # spec's eleventh beat is the default (§13.3), and nothing grounds it.
    triggered = any(c != "baseline" for rows in hits.values() for c, _ in rows)
    if top <= 0.0 or not triggered:
        return {"beat": ADVANCE, "reason": REASONS["advance"], "because": because, "scores": {}, "hit_rules": []}
    tied = [beat for beat, value in weighted.items() if value == top]
    chosen = next((beat for beat in dg.tiebreak if beat in tied), tied[0])
    conditions = [c for c, _ in hits.get(chosen, [])]
    return {
        "beat": chosen,
        "reason": REASONS["scored"].format(beat=chosen, conditions=", ".join(conditions), score=weighted[chosen]),
        "because": because,
        "scores": scores,
        "hit_rules": [dg.rule_ids[(chosen, c)] for c in conditions if (chosen, c) in dg.rule_ids],
    }


SIGNAL_ORDER = ("structure_type", "intent", "undiscovered_here", "agenda_npc_present", "dramatic_question",
                "exit_condition_met", "main_line_complete", "stalled_turns", "turns_in_scene", "hp_state",
                "sanity_state", "session", "last_roll", "pushed_fail_pending", "pending_choice", "clock_near_full")


def signals(graph: ModuleGraph, world: dict[str, Any], scene: dict[str, Any], turn: dict[str, Any], *,
            party: list[dict[str, Any]], present: list[dict[str, Any]], undiscovered_here: int,
            records: dict[int, dict[str, Any]], session: dict[str, Any] | None, clock_near_full: bool,
            conditions_of: Any, sanity_of: Any) -> dict[str, Any]:
    """The sixteen signals of §13.3, every one from state or the closed turn records.
    `conditions_of(sheet)` and `sanity_of(sheet)` read the healing and sanity snapshots;
    the party's worst investigator sets `hp_state` / `sanity_state` (dying beats wounded)."""
    scene_handle = graph.handle(scene)
    played = played_records(records, int(turn["turn"]))
    previous = played[0] if played else None
    hp_rank = {name: i for i, name in enumerate(HP_STATES)}
    san_rank = {name: i for i, name in enumerate(SANITY_STATES)}
    hp = "healthy"
    san = "stable"
    for sheet in party:
        state = hp_state(sheet.get("current_hp"), (sheet.get("derived") or {}).get("HP"), conditions_of(sheet))
        if hp_rank[state] > hp_rank[hp]:
            hp = state
        snapshot = sanity_of(sheet) or {}
        bout = bool(snapshot.get("bout_active") or "bout_active" in (snapshot.get("conditions") or []))
        state = sanity_state(sheet.get("current_san"), bout=bout, indefinite=bool(snapshot.get("indefinite_insane")),
                             lost_in_scene=san_lost_in_scene(played, scene_handle, str(sheet.get("id"))))
        if san_rank[state] > san_rank[san]:
            san = state
    return {
        "structure_type": structure_type_of(graph),
        "intent": intent_of_record(previous),
        "undiscovered_here": int(undiscovered_here),
        # §17.4: the same dossier read the capsule uses, so a built book's NPCs count too —
        # the starter's projection and the first-class property are one reading now.
        "agenda_npc_present": sum(1 for n in present if graph.npc_profile(n).get("agenda")),
        "dramatic_question": bool(record_of(scene).get("dramatic_question")),
        "exit_condition_met": exit_condition_met(scene, world),
        "main_line_complete": main_line_complete(graph, world),
        "stalled_turns": stalled_turns(played),
        "turns_in_scene": turns_in_scene(played, scene_handle),
        "hp_state": hp,
        "sanity_state": san,
        "session": str((session or {}).get("kind") or "none") if session and session.get("status") == "active" else "none",
        "last_roll": last_roll_of(previous),
        "pushed_fail_pending": pushed_fail_pending(previous),
        "pending_choice": bool(turn.get("pending_choice")),
        "clock_near_full": bool(clock_near_full),
    }


# ---- reveal --------------------------------------------------------------------------------

def clue_gate(graph: ModuleGraph, node: dict[str, Any]) -> str:
    """`delivery_kind`, the conclusion contract's skill and difficulty for the clue when
    authored, and any unlock condition on the clue node (`describe_condition`)."""
    props = node.get("properties") or {}
    parts = [str(props.get("delivery_kind") or "unknown")]
    for conclusion in graph.by_kind.get("conclusion", []):
        for entry in record_of(conclusion).get("clues") or []:
            if isinstance(entry, dict) and entry.get("clue_id") == node["node_id"]:
                skill, difficulty = entry.get("skill"), entry.get("difficulty")
                if isinstance(skill, str) and skill:
                    parts.append(f"{skill} ({difficulty})" if isinstance(difficulty, str) and difficulty else skill)
                break
    record = record_of(node)
    for key in ("unlock", "requires", "unlock_when", "when"):
        condition = props.get(key) if key in props else record.get(key)
        if condition:
            parts.append(describe_condition(condition))
    return ": ".join(parts[:2]) + ("; " + "; ".join(parts[2:]) if len(parts) > 2 else "")


def reveal_list(graph: ModuleGraph, world: dict[str, Any], scene: dict[str, Any]) -> list[dict[str, str]]:
    discovered = set(world.get("discovered_clues") or [])
    out = []
    for clue_id in graph.scene_clue_ids(scene):
        node = graph.nodes[clue_id]
        handle = graph.handle(node)
        if handle in discovered:
            continue
        out.append({"clue": handle, "gate": clue_gate(graph, node)})
        if len(out) >= REVEAL_LIMIT:
            break
    return out


def exit_condition_met(scene: dict[str, Any], world: dict[str, Any]) -> bool:
    return any(condition_met(cond, world) for cond in record_of(scene).get("exit_conditions") or [])


# ---- adoption (§13.7) ---------------------------------------------------------------------

def _receipts_of_families(turn_calls: dict[str, Any], families: set[str]) -> list[str]:
    ids: list[str] = []
    for call in (turn_calls or {}).values():
        result = (call or {}).get("result") or {}
        if result.get("family") in families:
            ids.extend(str(r) for r in result.get("receipts") or [])
    return ids


def director_adoption(beat: str, reveal: list[dict[str, Any]], receipts: list[dict[str, Any]], *, closed_by: str,
                      turn_calls: dict[str, Any], present: list[str], graph: ModuleGraph) -> dict[str, Any]:
    """The closed judgement table: which receipts count as following the beat. Telemetry,
    never a lever: the next capsule does not read it."""
    rows = [r for r in receipts if isinstance(r, dict)]
    by_kind: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        by_kind.setdefault(str(r.get("kind")), []).append(r)
    ids = lambda kind, pred=lambda r: True: [str(r["id"]) for r in by_kind.get(kind, []) if pred(r)]  # noqa: E731
    moves = ids("move")
    evidence: list[str] = []
    adopted = False
    if beat == "REVEAL":
        wanted = {row.get("clue") for row in reveal}
        evidence = ids("clue", lambda r: r.get("clue") in wanted)
        adopted = bool(evidence)
    elif beat == "PRESSURE":
        evidence = (ids("time") + ids("roll", lambda r: r.get("form") == "dice")
                    + ids("delta", lambda r: isinstance(r.get("before"), int) and isinstance(r.get("after"), int) and r["after"] < r["before"])
                    + ids("session", lambda r: r.get("transition") == "start"))
        adopted = bool(evidence)
    elif beat == "CHOICE":
        adopted = closed_by == "ask"
    elif beat == "SUBSYSTEM":
        # A session receipt (start/end/round) or any roll made inside the session: a combat
        # round where only blows land still followed the beat.
        evidence = ids("session") + ids("roll", lambda r: bool(r.get("session_kind")) or r.get("roll_kind") == "combat_check")
        adopted = bool(evidence)
    elif beat == "CHARACTER":
        social = set(_receipts_of_families(turn_calls, {"social", "psychology"}))
        evidence = ids("roll", lambda r: r["id"] in social)
        adopted = bool(evidence) or (bool(present) and not moves)
    elif beat == "RECOVER":
        evidence = _receipts_of_families(turn_calls, {"healing", "development"})
        adopted = bool(evidence) or any((c or {}).get("result", {}).get("family") in ("healing", "development")
                                        for c in (turn_calls or {}).values())
    elif beat in ("CUT", ADVANCE):
        evidence = moves
        adopted = bool(evidence)
    elif beat == "MONTAGE":
        evidence = ids("time")
        adopted = sum(int(r.get("minutes") or 0) for r in by_kind.get("time", [])) >= 60
    elif beat == "DEEPEN":
        core = set(_receipts_of_families(turn_calls, {"core-check"}))
        evidence = ids("roll", lambda r: r["id"] in core)
        adopted = bool(evidence) and not moves
    elif beat == "PAYOFF":
        supporting = {graph.handle(graph.nodes[r["from_node_id"]])
                      for conclusion in graph.by_kind.get("conclusion", [])
                      for r in graph.in_rel.get(conclusion["node_id"], [])
                      if r.get("relation_kind") == "supports" and r.get("from_node_id") in graph.nodes}
        evidence = ids("clue", lambda r: r.get("clue") in supporting)
        adopted = bool(evidence)
    return {"beat": beat, "adopted": bool(adopted), "evidence": evidence}
