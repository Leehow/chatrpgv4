#!/usr/bin/env python3
"""Deterministic reachability lint over one projected scenario set.

The question this module answers is "can this module actually be played
through?", and it answers it with arithmetic over the structure the
scenario already declares: scene edges, clue placements, gate conditions,
and the conclusions' own ``minimum_routes``.

Two laws shape every check here (docs/specs/pi-coc-module-reachability-lint.md
§3).  First, *declared, never inferred*: the only thresholds are the ones the
module states about itself, so no keyword list, regex over prose, phrase
table, or substring match on a free-text field appears anywhere below.  The
inputs are ids, enums, booleans, integers, and structural arrays.  Second,
*every finding carries a completeness class*, because a missing target means
something different in a finished module than in a progressive skeleton that
has not been deepened yet.

The lint is a report.  It never repairs, backfills, generates a route,
mutates an input, writes a file, or blocks anything.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


CONTRACT_ID = "coc.module-reachability-lint.v1"
SCHEMA_VERSION = 1

STORY_GRAPH = "story-graph.json"
CLUE_GRAPH = "clue-graph.json"
QUESTS = "quests.json"
THREAT_FRONTS = "threat-fronts.json"
MODULE_META = "module-meta.json"

#: Every document this lint reads.  Nothing outside this tuple is opened,
#: and ``clues.json`` is deliberately absent: ``clue-graph.json`` is the
#: single clue authority.
LINT_DOCUMENTS: tuple[str, ...] = (
    CLUE_GRAPH,
    MODULE_META,
    QUESTS,
    STORY_GRAPH,
    THREAT_FRONTS,
)

CHECK_CODES: tuple[str, ...] = (
    "edge-target-unknown",
    "available-clue-unknown",
    "clue-unplaced",
    "gate-clue-unobtainable",
    "quest-destination-unknown",
    "front-scene-unknown",
    "duplicate-record-id",
    "start-scene-count",
    "scene-unreachable",
    "scene-terminal-undeclared",
    "conclusion-behind-unreachable-scenes",
    "gate-self-locks",
    "declared-minimum-shortfall",
    "routes-not-declared",
    "conclusion-without-clues",
)

REASONS: dict[str, str] = {
    "edge-target-unknown":
        "scene edge names a scene that no record defines",
    "available-clue-unknown":
        "scene lists an available clue that no conclusion defines",
    "clue-unplaced":
        "conclusion clue appears in no scene's available_clues",
    "gate-clue-unobtainable":
        "clue gate names a clue that no scene provides",
    "quest-destination-unknown":
        "quest destination names a scene that no record defines",
    "front-scene-unknown":
        "threat front names a scene that no record defines",
    "duplicate-record-id":
        "two records in one collection share an id",
    "start-scene-count":
        "scenario does not declare exactly one start scene",
    "scene-unreachable":
        "no scene_edges path reaches this scene from any start",
    "scene-terminal-undeclared":
        "scene has no outbound edge and does not declare is_final",
    "conclusion-behind-unreachable-scenes":
        "every clue of this conclusion sits only in unreachable scenes",
    "gate-self-locks":
        "the gate's clue is only placed beyond the gate it opens",
    "declared-minimum-shortfall":
        "declared minimum route count exceeds distinct scene placements",
    "routes-not-declared":
        "conclusion declares importance but no minimum_routes",
    "conclusion-without-clues":
        "conclusion carries no clues",
}

SEVERITY_WHEN_DEAD: dict[str, str] = {
    "edge-target-unknown": "defect",
    "available-clue-unknown": "defect",
    "clue-unplaced": "defect",
    "gate-clue-unobtainable": "defect",
    "quest-destination-unknown": "defect",
    "front-scene-unknown": "defect",
    "duplicate-record-id": "defect",
    "start-scene-count": "observation",
    "scene-unreachable": "observation",
    "scene-terminal-undeclared": "observation",
    "conclusion-behind-unreachable-scenes": "observation",
    "gate-self-locks": "defect",
    "declared-minimum-shortfall": "defect",
    "routes-not-declared": "observation",
    "conclusion-without-clues": "observation",
}

DEAD = "dead"
PENDING = "pending-materialization"
NOT_MEASURED = "not-measured"
COMPLETENESS_CLASSES: tuple[str, ...] = (DEAD, PENDING, NOT_MEASURED)

#: Documents a code needs before it can say anything.  A code whose
#: documents are not all present is *not measured*: it yields no finding and
#: no clean pass, and lands in the report's ``codes_not_measured``.
_CODE_DOCUMENTS: dict[str, tuple[str, ...]] = {
    "edge-target-unknown": (STORY_GRAPH,),
    "available-clue-unknown": (STORY_GRAPH, CLUE_GRAPH),
    "clue-unplaced": (STORY_GRAPH, CLUE_GRAPH),
    "gate-clue-unobtainable": (STORY_GRAPH,),
    "quest-destination-unknown": (QUESTS, STORY_GRAPH),
    "front-scene-unknown": (THREAT_FRONTS, STORY_GRAPH),
    "duplicate-record-id": (),
    "start-scene-count": (STORY_GRAPH,),
    "scene-unreachable": (STORY_GRAPH,),
    "scene-terminal-undeclared": (STORY_GRAPH,),
    "conclusion-behind-unreachable-scenes": (STORY_GRAPH, CLUE_GRAPH),
    "gate-self-locks": (STORY_GRAPH,),
    "declared-minimum-shortfall": (STORY_GRAPH, CLUE_GRAPH),
    "routes-not-declared": (CLUE_GRAPH,),
    "conclusion-without-clues": (CLUE_GRAPH,),
}

_ALL_SCENES = "all-scenes"
_SUBJECT_SCENE = "subject-scene"
_NO_SCENES = "no-scenes"

#: Which scenes a code's claim depends on, and therefore which scenes'
#: parse depth decides ``not-measured``.  A negative-existence claim ("no
#: scene provides this clue", "no path reaches this scene") ranges over the
#: whole scene set, so an under-parsed scene anywhere makes it unmeasurable:
#: the missing placement or the missing edge may simply not have been read
#: out of the source yet.  A claim about one scene's own record depends on
#: that scene alone, and a claim about a record's own shape depends on no
#: scene at all.
_CODE_SCENE_SCOPE: dict[str, str] = {
    "edge-target-unknown": _ALL_SCENES,
    "available-clue-unknown": _SUBJECT_SCENE,
    "clue-unplaced": _ALL_SCENES,
    "gate-clue-unobtainable": _ALL_SCENES,
    "quest-destination-unknown": _ALL_SCENES,
    "front-scene-unknown": _ALL_SCENES,
    "duplicate-record-id": _NO_SCENES,
    "start-scene-count": _ALL_SCENES,
    "scene-unreachable": _ALL_SCENES,
    "scene-terminal-undeclared": _SUBJECT_SCENE,
    "conclusion-behind-unreachable-scenes": _ALL_SCENES,
    "gate-self-locks": _ALL_SCENES,
    "declared-minimum-shortfall": _ALL_SCENES,
    "routes-not-declared": _NO_SCENES,
    "conclusion-without-clues": _ALL_SCENES,
}

#: Codes whose whole statement is about traversal from a start scene.
_START_DEPENDENT_CODES: frozenset[str] = frozenset({
    "conclusion-behind-unreachable-scenes",
    "gate-self-locks",
    "scene-unreachable",
})

_CLUE_DISCOVERED = "clue_discovered"
_DEEP = "deep"

#: Top-level story-graph scene fields written by the raw-PDF progressive lane
#: (`coc_module_project.py`) and governed by no field registry.
#:
#: `coc_module_projection.RECORD_FIELD_REGISTRY` does not reach these files —
#: every one of its call sites takes a ModuleGraph, and a progressive
#: campaign's `scenario/` directory has none — so registering them there would
#: assert a jurisdiction that module does not have (its own comment carries
#: the evidence). This lint is the first consumer to read both carriers, so
#: this is where the progressive lane's extra field surface gets declared.
#:
#: Two of the nine are read by this module's own completeness classifier
#: (`_scene_is_under_parsed`). The rest are declared because a field carried
#: in data and named in no ledger is exactly the silence this lint exists to
#: end — and because one of them, `keeper_only`, turns out to have no reader
#: at all. Producer and consumer, measured by grep, one field at a time:
#:
#: - `evidence_gap` — written at coc_module_project.py:700 (and 5370/5374).
#:   Read by coc_compiled_archive.py:629 into the scene shard, by
#:   pi/extensions/coordinator.ts:1015 and :1072, by
#:   pi/lib/current-dependency-machine.ts:450, and by `_scene_is_under_parsed`
#:   below.
#: - `keeper_only` — written at coc_module_project.py:746. **No known
#:   consumer.** Nothing reads a scene record's `keeper_only`:
#:   coc_compiled_archive.py builds a shard block of the same name from
#:   `on_enter`, affordances, secret refs and `source_context_mentions`, and
#:   coordinator.ts:1022 reads `source_material.keeper_only`, a different
#:   object. Keeper-only prose that reaches no reader is the keeper_notes
#:   dead-field class again; recorded here rather than left unstated.
#: - `keeper_secret_refs` — written at coc_module_project.py:932/3564/3753.
#:   Read by coc_compiled_archive.py:585 into the shard's
#:   `keeper_only.secret_ref_ids`.
#: - `page_text_sha256` — written at coc_module_project.py:770-776. Read by
#:   coc_compiled_archive.py:673 into the shard's `provenance`.
#: - `parse_state` — written at coc_module_project.py:699 (and 5373). Read by
#:   coc_compiled_archive.py:628, pi/extensions/coordinator.ts:1071,
#:   pi/lib/current-dependency-machine.ts:449, and `_scene_is_under_parsed`.
#: - `source_context_mentions` — written at coc_module_project.py:765, from a
#:   pack field the producer names `mentions`. Read by
#:   coc_operation_kernel.py:10034, which projects it to the live Keeper as
#:   `source_material.contextual_mentions` (:10090); also by
#:   coc_compiled_archive.py:656 and pi/extensions/coordinator.ts:1068.
#: - `source_evidence` — written at coc_module_project.py:770-776. Read by
#:   coc_compiled_archive.py:674 into the shard's `provenance`.
#: - `source_page_indices` — written at coc_module_project.py:770-776. Read by
#:   coc_compiled_archive.py:670 into the shard's `provenance`.
#: - `source_span` — written at coc_module_project.py:770-776. Read by
#:   coc_compiled_archive.py:669 into the shard's `provenance`.
#:
#: Pinned against a committed fixture by tests/test_progressive_scene_fields.py
#: so that a tenth field appearing on a progressive scene is a decision someone
#: makes rather than something nobody notices.
PROGRESSIVE_SCENE_FIELDS: frozenset[str] = frozenset({
    "evidence_gap",
    "keeper_only",
    "keeper_secret_refs",
    "page_text_sha256",
    "parse_state",
    "source_context_mentions",
    "source_evidence",
    "source_page_indices",
    "source_span",
})

#: Record collections whose ids must be unique inside their own collection.
#: Cross-collection name collisions are deliberately not checked: the
#: committed starter carries twelve scene/beat pairs that share a slug and
#: are not duplicates (spec §2.3).
_ID_COLLECTIONS: tuple[tuple[str, str, str], ...] = (
    (CLUE_GRAPH, "conclusions", "conclusion_id"),
    (QUESTS, "quests", "quest_id"),
    (STORY_GRAPH, "scenes", "scene_id"),
    (THREAT_FRONTS, "fronts", "front_id"),
)


class ModuleReachabilityError(ValueError):
    """A scenario set could not be read as a set of JSON objects."""


# --------------------------------------------------------------------------
# Structural readers.  Everything below tolerates a malformed record by
# skipping it; a bad shape anywhere must never raise out of the lint.
# --------------------------------------------------------------------------


def _semantic_id(value: Any) -> str | None:
    """Return ``value`` when it is a usable id token, else ``None``."""
    if isinstance(value, str) and value:
        return value
    return None


def _objects(document: Any, collection: str) -> list[dict[str, Any]]:
    """Return the dict records of ``document[collection]``."""
    if not isinstance(document, dict):
        return []
    rows = document.get(collection)
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _id_list(value: Any) -> list[str]:
    return [token for token in _list(value) if _semantic_id(token)]


def _int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    return value if isinstance(value, int) else None


def _has_source_refs(record: Any) -> bool:
    return (
        isinstance(record, dict)
        and isinstance(record.get("source_refs"), list)
        and bool(record["source_refs"])
    )


def _mention_ids(scene: dict[str, Any]) -> set[str]:
    """Ids named in a scene's ``mentions``, whatever carrier shape it uses.

    Entries are either bare id tokens or objects carrying one; only the
    structural id keys are read, never a note or a name rendered for a
    human.
    """
    # Measured finding, recorded rather than acted on: this read — and with
    # it the second disjunct of `pending-materialization` in `_classify` —
    # is inert today. `mentions` is registered in
    # `coc_module_projection.RECORD_FIELD_REGISTRY`, but no scene record in
    # the committed starter or in any of the four progressive campaigns
    # measured locally carries the key at all, let alone a populated value.
    # The progressive producer renames it at the boundary: it reads a pack's
    # `mentions` and writes the scene's `source_context_mentions`
    # (coc_module_project.py:765).
    #
    # That sibling field cannot stand in for this one, so switching the read
    # would not revive the disjunct. Its entries identify entities, not
    # destinations — an entity ref (`npc-john-croft`, `loc-marshalsea-prison`)
    # or, in the amaranthine campaign, a bare person name with no id key of
    # any kind. Measured across both campaigns that populate it: zero entries
    # name a scene id, and the one scenario whose edge target is missing
    # (`dunwich-1287`) does not name that target anywhere in the field. So no
    # `edge-target-unknown` could ever be resolved through it.
    #
    # Left in place deliberately. `mentions` is the registered field, the
    # spec's §3.2 names it, and the classification would be wrong the moment a
    # carrier does populate it. Deleting a correct branch because today's data
    # never reaches it is how a check quietly stops being a check.
    found: set[str] = set()
    for entry in _list(scene.get("mentions")):
        token = _semantic_id(entry)
        if token is not None:
            found.add(token)
            continue
        if isinstance(entry, dict):
            for key in ("ref_id", "id", "target_id"):
                token = _semantic_id(entry.get(key))
                if token is not None:
                    found.add(token)
    return found


def _gate_clue(condition: Any) -> str | None:
    """The clue id a ``clue_discovered`` condition is gated on."""
    if not isinstance(condition, dict):
        return None
    if condition.get("kind") != _CLUE_DISCOVERED:
        return None
    return _semantic_id(condition.get("clue_id"))


# --------------------------------------------------------------------------
# The scenario model: one pass over the documents, then pure arithmetic.
# --------------------------------------------------------------------------


class _Scenario:
    """Everything the checks need, read once from the loaded documents."""

    def __init__(self, scenario_set: dict[str, Any]) -> None:
        documents = scenario_set.get("documents")
        self.documents: dict[str, Any] = (
            documents if isinstance(documents, dict) else {}
        )
        self.present: frozenset[str] = frozenset(
            name for name in LINT_DOCUMENTS if name in self.documents
        )

        meta = self.documents.get(MODULE_META)
        meta = meta if isinstance(meta, dict) else {}
        self.scenario_id: str | None = _semantic_id(meta.get("scenario_id"))
        self.progressive: bool = bool(meta.get("progressive"))

        # Scenes.  The first record to claim an id owns it; a later
        # collision is reported by duplicate-record-id rather than silently
        # overwriting the earlier record.
        self.scenes: list[dict[str, Any]] = []
        self.scene_by_id: dict[str, dict[str, Any]] = {}
        for scene in _objects(self.documents.get(STORY_GRAPH), "scenes"):
            scene_id = _semantic_id(scene.get("scene_id"))
            if scene_id is None or scene_id in self.scene_by_id:
                continue
            self.scene_by_id[scene_id] = scene
            self.scenes.append(scene)
        self.scene_ids: frozenset[str] = frozenset(self.scene_by_id)

        self.declares_is_final: bool = any(
            "is_final" in scene for scene in self.scenes
        )
        self.under_parsed: frozenset[str] = frozenset(
            scene_id
            for scene_id, scene in self.scene_by_id.items()
            if _scene_is_under_parsed(scene)
        )
        mentioned: set[str] = set()
        for scene in self.scenes:
            mentioned |= _mention_ids(scene)
        self.mentioned_ids: frozenset[str] = frozenset(mentioned)

        # Conclusions and their clues.  clue-graph.json is the only clue
        # authority; clues.json is never opened.
        self.conclusions: list[dict[str, Any]] = _objects(
            self.documents.get(CLUE_GRAPH), "conclusions"
        )
        self.clue_records: dict[str, dict[str, Any]] = {}
        for conclusion in self.conclusions:
            for clue in _list(conclusion.get("clues")):
                if not isinstance(clue, dict):
                    continue
                clue_id = _semantic_id(clue.get("clue_id"))
                if clue_id is not None:
                    self.clue_records.setdefault(clue_id, clue)
        self.clue_ids: frozenset[str] = frozenset(self.clue_records)

        # Placements: which scenes make a clue available.
        placements: dict[str, set[str]] = {}
        for scene_id, scene in self.scene_by_id.items():
            for clue_id in _id_list(scene.get("available_clues")):
                placements.setdefault(clue_id, set()).add(scene_id)
        self.placements: dict[str, set[str]] = placements

        # Traversal.  Gate conditions are ignored here: a gated edge is
        # still a route, and whether it can be opened is gate-self-locks'
        # separate question.
        self.edges: dict[str, list[dict[str, Any]]] = {
            scene_id: [
                edge
                for edge in _list(scene.get("scene_edges"))
                if isinstance(edge, dict)
            ]
            for scene_id, scene in self.scene_by_id.items()
        }
        self.start_ids: tuple[str, ...] = tuple(
            sorted(
                scene_id
                for scene_id, scene in self.scene_by_id.items()
                if scene.get("is_start")
            )
        )
        self.reachable: frozenset[str] = self.reach(closed_edge=None)

    def reach(
        self, *, closed_edge: tuple[str, int] | None
    ) -> frozenset[str]:
        """Scenes reachable from any start, as a fixed point.

        ``closed_edge`` names one ``(scene_id, edge index)`` to remove from
        the graph, which is how a gate is closed for gate-self-locks.
        """
        seen: set[str] = set(self.start_ids)
        frontier: list[str] = list(self.start_ids)
        while frontier:
            scene_id = frontier.pop()
            for index, edge in enumerate(self.edges.get(scene_id, ())):
                if closed_edge == (scene_id, index):
                    continue
                target = _semantic_id(edge.get("to"))
                if target is None or target in seen:
                    continue
                if target not in self.scene_by_id:
                    continue
                seen.add(target)
                frontier.append(target)
        return frozenset(seen)

    def obtainable(self, clue_id: str, scenes: frozenset[str]) -> bool:
        """Whether ``clue_id`` is available in any scene of ``scenes``."""
        return bool(self.placements.get(clue_id, set()) & scenes)

    def measured(self, code: str) -> bool:
        needed = _CODE_DOCUMENTS.get(code, ())
        if not all(name in self.present for name in needed):
            return False
        if code == "duplicate-record-id":
            return any(
                name in self.present
                for name, _collection, _field in _ID_COLLECTIONS
            )
        if code == "scene-terminal-undeclared":
            # The check exists only where the scenario uses the field.  A
            # scenario that never declares is_final would otherwise have
            # every leaf flagged for a convention it does not follow.
            return self.declares_is_final
        if code in _START_DEPENDENT_CODES:
            # Traversal has no origin without a declared start, so every
            # reachability answer would be an artifact of the missing
            # start rather than a fact about the module.  start-scene-count
            # names that gap; these codes report not-measured instead of a
            # wall of findings or a clean pass.
            return bool(self.start_ids)
        return True


def _scene_is_under_parsed(scene: dict[str, Any]) -> bool:
    """Whether a scene was never parsed deeply enough to measure.

    ``parse_state`` and ``evidence_gap`` are written by the progressive
    import path rather than projected from a graph.  A scene that carries
    neither (the committed starter's form) is measured.
    """
    parse_state = scene.get("parse_state")
    if parse_state is not None and parse_state != _DEEP:
        return True
    return bool(scene.get("evidence_gap"))


# --------------------------------------------------------------------------
# Finding construction.
# --------------------------------------------------------------------------


def _scope_scenes(
    scenario: _Scenario, code: str, subject_id: str
) -> frozenset[str]:
    scope = _CODE_SCENE_SCOPE.get(code, _NO_SCENES)
    if scope == _ALL_SCENES:
        return scenario.scene_ids
    if scope == _SUBJECT_SCENE:
        return frozenset({subject_id} & scenario.scene_ids)
    return frozenset()


def _classify(
    scenario: _Scenario,
    code: str,
    subject_id: str,
    *,
    referencing_record: Any,
    target_ids: tuple[str, ...],
) -> str:
    """The completeness class of one finding (spec §3.2).

    ``not-measured`` beats ``pending-materialization`` beats ``dead``.
    """
    if _scope_scenes(scenario, code, subject_id) & scenario.under_parsed:
        return NOT_MEASURED
    if scenario.progressive:
        if _has_source_refs(referencing_record):
            return PENDING
        if any(target in scenario.mentioned_ids for target in target_ids):
            return PENDING
    return DEAD


def _make_finding(
    scenario: _Scenario,
    code: str,
    *,
    subject_id: str,
    subject_kind: str,
    related_ids: tuple[str, ...] = (),
    declared: dict[str, Any] | None = None,
    counted: dict[str, Any] | None = None,
    referencing_record: Any = None,
    target_ids: tuple[str, ...] = (),
) -> dict[str, Any]:
    completeness = _classify(
        scenario,
        code,
        subject_id,
        referencing_record=referencing_record,
        target_ids=target_ids,
    )
    severity = (
        SEVERITY_WHEN_DEAD[code] if completeness == DEAD else "observation"
    )
    return {
        "code": code,
        "severity": severity,
        "completeness": completeness,
        "subject_id": subject_id,
        "subject_kind": subject_kind,
        "related_ids": sorted(set(related_ids)),
        "declared": dict(declared or {}),
        "counted": dict(counted or {}),
        "reason": REASONS[code],
    }


# --------------------------------------------------------------------------
# R1 — referential integrity.
# --------------------------------------------------------------------------


def _check_edge_target_unknown(
    scenario: _Scenario,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for scene_id in sorted(scenario.scene_by_id):
        for edge in scenario.edges.get(scene_id, ()):
            target = _semantic_id(edge.get("to"))
            if target is None or target in scenario.scene_ids:
                continue
            if (scene_id, target) in seen:
                continue
            seen.add((scene_id, target))
            findings.append(
                _make_finding(
                    scenario,
                    "edge-target-unknown",
                    subject_id=scene_id,
                    subject_kind="scene",
                    related_ids=(target,),
                    referencing_record=edge,
                    target_ids=(target,),
                )
            )
    return findings


def _check_available_clue_unknown(
    scenario: _Scenario,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for scene_id in sorted(scenario.scene_by_id):
        scene = scenario.scene_by_id[scene_id]
        unknown = {
            clue_id
            for clue_id in _id_list(scene.get("available_clues"))
            if clue_id not in scenario.clue_ids
        }
        for clue_id in sorted(unknown):
            findings.append(
                _make_finding(
                    scenario,
                    "available-clue-unknown",
                    subject_id=scene_id,
                    subject_kind="scene",
                    related_ids=(clue_id,),
                    target_ids=(clue_id,),
                )
            )
    return findings


def _check_clue_unplaced(scenario: _Scenario) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for conclusion in scenario.conclusions:
        conclusion_id = _semantic_id(conclusion.get("conclusion_id"))
        for clue in _list(conclusion.get("clues")):
            if not isinstance(clue, dict):
                continue
            clue_id = _semantic_id(clue.get("clue_id"))
            if clue_id is None or scenario.placements.get(clue_id):
                continue
            related = (conclusion_id,) if conclusion_id else ()
            findings.append(
                _make_finding(
                    scenario,
                    "clue-unplaced",
                    subject_id=clue_id,
                    subject_kind="clue",
                    related_ids=related,
                    target_ids=(clue_id,),
                )
            )
    return findings


def _scene_gates(
    scenario: _Scenario, scene_id: str
) -> list[tuple[str, Any]]:
    """Every ``clue_discovered`` gate a scene declares, as (clue, record).

    Both carriers the spec names are read: an outbound edge's ``when`` and
    an ``exit_conditions`` entry.
    """
    scene = scenario.scene_by_id[scene_id]
    gates: list[tuple[str, Any]] = []
    for edge in scenario.edges.get(scene_id, ()):
        clue_id = _gate_clue(edge.get("when"))
        if clue_id is not None:
            gates.append((clue_id, edge))
    for condition in _list(scene.get("exit_conditions")):
        clue_id = _gate_clue(condition)
        if clue_id is not None:
            gates.append((clue_id, condition))
    return gates


def _check_gate_clue_unobtainable(
    scenario: _Scenario,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for scene_id in sorted(scenario.scene_by_id):
        seen: set[str] = set()
        for clue_id, record in _scene_gates(scenario, scene_id):
            if clue_id in seen or scenario.placements.get(clue_id):
                continue
            seen.add(clue_id)
            findings.append(
                _make_finding(
                    scenario,
                    "gate-clue-unobtainable",
                    subject_id=scene_id,
                    subject_kind="scene",
                    related_ids=(clue_id,),
                    referencing_record=record,
                    target_ids=(clue_id,),
                )
            )
    return findings


def _check_quest_destination_unknown(
    scenario: _Scenario,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    quests = _objects(scenario.documents.get(QUESTS), "quests")
    for quest in quests:
        quest_id = _semantic_id(quest.get("quest_id"))
        target = _semantic_id(quest.get("destination_scene_id"))
        if quest_id is None or target is None:
            continue
        if target in scenario.scene_ids:
            continue
        findings.append(
            _make_finding(
                scenario,
                "quest-destination-unknown",
                subject_id=quest_id,
                subject_kind="quest",
                related_ids=(target,),
                target_ids=(target,),
            )
        )
    return findings


def _check_front_scene_unknown(
    scenario: _Scenario,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    fronts = _objects(scenario.documents.get(THREAT_FRONTS), "fronts")
    for front in fronts:
        front_id = _semantic_id(front.get("front_id"))
        if front_id is None:
            continue
        unknown = {
            scene_id
            for scene_id in _id_list(front.get("scene_ids"))
            if scene_id not in scenario.scene_ids
        }
        for scene_id in sorted(unknown):
            findings.append(
                _make_finding(
                    scenario,
                    "front-scene-unknown",
                    subject_id=front_id,
                    subject_kind="front",
                    related_ids=(scene_id,),
                    target_ids=(scene_id,),
                )
            )
    return findings


def _duplicate_ids(
    records: list[dict[str, Any]], id_field: str
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for record in records:
        record_id = _semantic_id(record.get(id_field))
        if record_id is not None:
            counts[record_id] = counts.get(record_id, 0) + 1
    return {key: value for key, value in counts.items() if value > 1}


def _check_duplicate_record_id(
    scenario: _Scenario,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    # (locator ids for related_ids, records, id field).  The subject of the
    # finding is the shared id itself, which is a real record id; the
    # collection it collides in is carried in related_ids, so the lint mints
    # no identifier of its own.
    collections: list[tuple[tuple[str, ...], list[dict[str, Any]], str]] = []
    for filename, collection, id_field in _ID_COLLECTIONS:
        if filename not in scenario.present:
            continue
        records = _objects(scenario.documents.get(filename), collection)
        collections.append(((filename,), records, id_field))
    if CLUE_GRAPH in scenario.present:
        for conclusion in scenario.conclusions:
            conclusion_id = _semantic_id(conclusion.get("conclusion_id"))
            if conclusion_id is None:
                continue
            clues = [
                clue
                for clue in _list(conclusion.get("clues"))
                if isinstance(clue, dict)
            ]
            collections.append(((CLUE_GRAPH, conclusion_id), clues, "clue_id"))
    for locator, records, id_field in collections:
        duplicates = _duplicate_ids(records, id_field)
        for record_id in sorted(duplicates):
            findings.append(
                _make_finding(
                    scenario,
                    "duplicate-record-id",
                    subject_id=record_id,
                    subject_kind="collection",
                    related_ids=locator,
                    counted={"records": duplicates[record_id]},
                )
            )
    return findings


# --------------------------------------------------------------------------
# R2 — reachability.
# --------------------------------------------------------------------------


def _check_start_scene_count(
    scenario: _Scenario,
) -> list[dict[str, Any]]:
    if len(scenario.start_ids) == 1:
        return []
    subject_id = scenario.scenario_id or "scenario"
    return [
        _make_finding(
            scenario,
            "start-scene-count",
            subject_id=subject_id,
            subject_kind="scenario",
            related_ids=scenario.start_ids,
            counted={"start_scenes": len(scenario.start_ids)},
        )
    ]


def _check_scene_unreachable(
    scenario: _Scenario,
) -> list[dict[str, Any]]:
    return [
        _make_finding(
            scenario,
            "scene-unreachable",
            subject_id=scene_id,
            subject_kind="scene",
            target_ids=(scene_id,),
        )
        for scene_id in sorted(scenario.scene_ids - scenario.reachable)
    ]


def _check_scene_terminal_undeclared(
    scenario: _Scenario,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for scene_id in sorted(scenario.scene_by_id):
        scene = scenario.scene_by_id[scene_id]
        if scenario.edges.get(scene_id):
            continue
        if scene.get("is_final"):
            continue
        findings.append(
            _make_finding(
                scenario,
                "scene-terminal-undeclared",
                subject_id=scene_id,
                subject_kind="scene",
            )
        )
    return findings


def _conclusion_placements(
    scenario: _Scenario, conclusion: dict[str, Any]
) -> tuple[tuple[str, ...], dict[str, set[str]]]:
    """A conclusion's clue ids, and where each of them is placed."""
    clue_ids: list[str] = []
    placed: dict[str, set[str]] = {}
    for clue in _list(conclusion.get("clues")):
        if not isinstance(clue, dict):
            continue
        clue_id = _semantic_id(clue.get("clue_id"))
        if clue_id is None or clue_id in placed:
            continue
        clue_ids.append(clue_id)
        placed[clue_id] = set(scenario.placements.get(clue_id, set()))
    return tuple(clue_ids), placed


def _check_conclusion_behind_unreachable_scenes(
    scenario: _Scenario,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for conclusion in scenario.conclusions:
        conclusion_id = _semantic_id(conclusion.get("conclusion_id"))
        if conclusion_id is None:
            continue
        _clue_ids, placed = _conclusion_placements(scenario, conclusion)
        scenes: set[str] = set()
        for scene_ids in placed.values():
            scenes |= scene_ids
        if not scenes or scenes & scenario.reachable:
            continue
        findings.append(
            _make_finding(
                scenario,
                "conclusion-behind-unreachable-scenes",
                subject_id=conclusion_id,
                subject_kind="conclusion",
                related_ids=tuple(scenes),
                counted={
                    "scene_placements": len(scenes),
                    "reachable_scene_placements": 0,
                },
            )
        )
    return findings


def _check_gate_self_locks(scenario: _Scenario) -> list[dict[str, Any]]:
    """A gate whose own clue lives only beyond the gate it opens.

    For each ``clue_discovered`` edge, reachability is recomputed as a
    fixed point with exactly that edge removed.  If no scene in that closed
    set places the clue, no play can ever open the gate.  Gates whose
    source scene is itself unreachable are left to ``scene-unreachable``,
    and a gate on a clue that no scene places at all is left to
    ``gate-clue-unobtainable``, so neither is reported twice.
    """
    findings: list[dict[str, Any]] = []
    for scene_id in sorted(scenario.scene_by_id):
        if scene_id not in scenario.reachable:
            continue
        seen: set[tuple[str, str]] = set()
        for index, edge in enumerate(scenario.edges.get(scene_id, ())):
            clue_id = _gate_clue(edge.get("when"))
            if clue_id is None or not scenario.placements.get(clue_id):
                continue
            target = _semantic_id(edge.get("to")) or ""
            if (clue_id, target) in seen:
                continue
            closed = scenario.reach(closed_edge=(scene_id, index))
            if scenario.obtainable(clue_id, closed):
                continue
            seen.add((clue_id, target))
            related = (clue_id,) + ((target,) if target else ())
            findings.append(
                _make_finding(
                    scenario,
                    "gate-self-locks",
                    subject_id=scene_id,
                    subject_kind="scene",
                    related_ids=related,
                    referencing_record=edge,
                    target_ids=(clue_id,),
                    counted={
                        "placements_beyond_gate": len(
                            scenario.placements.get(clue_id, set())
                        ),
                        "placements_before_gate": 0,
                    },
                )
            )
    return findings


# --------------------------------------------------------------------------
# R3 — declared-minimum accounting.
# --------------------------------------------------------------------------


def _route_counts(
    scenario: _Scenario, conclusion: dict[str, Any]
) -> tuple[int, int, set[str]]:
    """Scene-independent and context-independent route counts.

    A route the players cannot reach separately is not a separate route, so
    the count compared against ``minimum_routes`` is the number of distinct
    scenes.  The ``(scene, delivery_kind, skill)`` count is reported beside
    it for review and is never compared against anything.
    """
    scenes: set[str] = set()
    contexts: set[tuple[str, str, str]] = set()
    for clue in _list(conclusion.get("clues")):
        if not isinstance(clue, dict):
            continue
        clue_id = _semantic_id(clue.get("clue_id"))
        if clue_id is None:
            continue
        delivery_kind = _semantic_id(clue.get("delivery_kind")) or ""
        skill = _semantic_id(clue.get("skill")) or ""
        for scene_id in scenario.placements.get(clue_id, set()):
            scenes.add(scene_id)
            contexts.add((scene_id, delivery_kind, skill))
    return len(scenes), len(contexts), scenes


def _check_declared_minimum_shortfall(
    scenario: _Scenario,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for conclusion in scenario.conclusions:
        conclusion_id = _semantic_id(conclusion.get("conclusion_id"))
        minimum = _int(conclusion.get("minimum_routes"))
        if conclusion_id is None or minimum is None:
            continue
        scene_routes, context_routes, scenes = _route_counts(
            scenario, conclusion
        )
        if scene_routes >= minimum:
            continue
        clue_ids, _placed = _conclusion_placements(scenario, conclusion)
        findings.append(
            _make_finding(
                scenario,
                "declared-minimum-shortfall",
                subject_id=conclusion_id,
                subject_kind="conclusion",
                related_ids=tuple(clue_ids) + tuple(scenes),
                declared={"minimum_routes": minimum},
                counted={
                    "scene_independent_routes": scene_routes,
                    "context_independent_routes": context_routes,
                },
            )
        )
    return findings


def _check_routes_not_declared(
    scenario: _Scenario,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for conclusion in scenario.conclusions:
        conclusion_id = _semantic_id(conclusion.get("conclusion_id"))
        importance = _semantic_id(conclusion.get("importance"))
        if conclusion_id is None or importance is None:
            continue
        if _int(conclusion.get("minimum_routes")) is not None:
            continue
        findings.append(
            _make_finding(
                scenario,
                "routes-not-declared",
                subject_id=conclusion_id,
                subject_kind="conclusion",
                declared={"importance": importance},
            )
        )
    return findings


def _check_conclusion_without_clues(
    scenario: _Scenario,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for conclusion in scenario.conclusions:
        conclusion_id = _semantic_id(conclusion.get("conclusion_id"))
        if conclusion_id is None:
            continue
        clue_ids, _placed = _conclusion_placements(scenario, conclusion)
        if clue_ids:
            continue
        findings.append(
            _make_finding(
                scenario,
                "conclusion-without-clues",
                subject_id=conclusion_id,
                subject_kind="conclusion",
                counted={"clues": 0},
            )
        )
    return findings


_CHECKS: dict[str, Any] = {
    "edge-target-unknown": _check_edge_target_unknown,
    "available-clue-unknown": _check_available_clue_unknown,
    "clue-unplaced": _check_clue_unplaced,
    "gate-clue-unobtainable": _check_gate_clue_unobtainable,
    "quest-destination-unknown": _check_quest_destination_unknown,
    "front-scene-unknown": _check_front_scene_unknown,
    "duplicate-record-id": _check_duplicate_record_id,
    "start-scene-count": _check_start_scene_count,
    "scene-unreachable": _check_scene_unreachable,
    "scene-terminal-undeclared": _check_scene_terminal_undeclared,
    "conclusion-behind-unreachable-scenes":
        _check_conclusion_behind_unreachable_scenes,
    "gate-self-locks": _check_gate_self_locks,
    "declared-minimum-shortfall": _check_declared_minimum_shortfall,
    "routes-not-declared": _check_routes_not_declared,
    "conclusion-without-clues": _check_conclusion_without_clues,
}


# --------------------------------------------------------------------------
# Public API.
# --------------------------------------------------------------------------


def load_scenario_set(ir_dir: str | Path) -> dict[str, Any]:
    """Read the scenario documents present in one scenario directory.

    Returns ``{"documents": {filename: parsed_json}, "absent": [...]}``.
    An optional document that is simply not there is never an error;
    unreadable bytes, invalid JSON, or a non-object document are.
    """
    root = Path(ir_dir)
    if not root.is_dir():
        raise ModuleReachabilityError(
            f"scenario directory not readable: {root}"
        )
    documents: dict[str, Any] = {}
    absent: list[str] = []
    for filename in LINT_DOCUMENTS:
        path = root / filename
        if not path.is_file():
            absent.append(filename)
            continue
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError as error:
            raise ModuleReachabilityError(
                f"scenario document unreadable: {path}"
            ) from error
        try:
            parsed = json.loads(raw)
        except ValueError as error:
            raise ModuleReachabilityError(
                f"scenario document is not JSON: {path}"
            ) from error
        if not isinstance(parsed, dict):
            raise ModuleReachabilityError(
                f"scenario document is not an object: {path}"
            )
        documents[filename] = parsed
    return {"documents": documents, "absent": sorted(absent)}


def lint_scenario_set(scenario_set: dict[str, Any]) -> dict[str, Any]:
    """Return one reachability report for a loaded scenario set."""
    scenario = _Scenario(scenario_set)

    findings: list[dict[str, Any]] = []
    not_measured_codes: list[str] = []
    for code in CHECK_CODES:
        if not scenario.measured(code):
            not_measured_codes.append(code)
            continue
        findings.extend(_CHECKS[code](scenario))

    findings.sort(
        key=lambda finding: (
            finding["code"],
            finding["subject_id"],
            tuple(finding["related_ids"]),
        )
    )

    summary_completeness = {name: 0 for name in COMPLETENESS_CLASSES}
    defects = 0
    observations = 0
    for finding in findings:
        summary_completeness[finding["completeness"]] += 1
        if finding["severity"] == "defect":
            defects += 1
        else:
            observations += 1

    return {
        "contract_id": CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "scenario_id": scenario.scenario_id,
        "progressive": scenario.progressive,
        "documents_present": sorted(scenario.present),
        "documents_absent": sorted(
            name for name in LINT_DOCUMENTS if name not in scenario.present
        ),
        "codes_not_measured": sorted(not_measured_codes),
        "findings": findings,
        "summary": {
            "defect": defects,
            "observation": observations,
            "by_completeness": summary_completeness,
        },
    }


def lint_scenario_dir(ir_dir: str | Path) -> dict[str, Any]:
    """Load one scenario directory and lint it."""
    return lint_scenario_set(load_scenario_set(ir_dir))
