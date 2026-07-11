"""Boundary hardening for semantic requests, source evidence, and confidence IDs."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


SCRIPTS = Path("plugins/coc-keeper/scripts").resolve()
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_epistemic_compile
import coc_pdf_source
import coc_scenario_compile


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def test_compile_request_excludes_raw_npc_and_front_keeper_prose(tmp_path: Path):
    scenario = tmp_path / "scenario"
    scenario.mkdir()
    _write_json(
        scenario / "module-meta.json",
        {
            "scenario_id": "safe-request",
            "structure_type": "branching_investigation",
            "era": "invented",
            "module_identity": {"canonical_module_id": "safe-request"},
        },
    )
    _write_json(scenario / "story-graph.json", {"scenes": []})
    _write_json(scenario / "clue-graph.json", {"conclusions": []})
    _write_json(
        scenario / "npc-agendas.json",
        {
            "npcs": [
                {
                    "npc_id": "npc-clerk",
                    "display_name": "The Clerk",
                    "agenda": "RAW NPC KEEPER AGENDA",
                    "agenda_summary": "Wants to finish the public appointment.",
                    "fear": "RAW NPC KEEPER FEAR",
                    "secret": "RAW NPC KEEPER SECRET",
                    "voice": "terse",
                    "relationship_to_investigators": "neutral_stranger",
                    "has_secret": True,
                    "secret_id": "secret-clerk",
                }
            ]
        },
    )
    _write_json(
        scenario / "threat-fronts.json",
        {
            "fronts": [
                {
                    "front_id": "front-watchers",
                    "scope": "scenario",
                    "dangers": [
                        {
                            "id": "danger-watchers",
                            "impulse": "RAW DANGER KEEPER IMPULSE",
                            "moves": ["RAW DANGER KEEPER MOVE"],
                            "lethal": False,
                            "player_safe_summary": "Unknown observers shadow the route.",
                        }
                    ],
                    "clocks": [
                        {
                            "clock_id": "clock-alert",
                            "segments": 4,
                            "on_tick_visible": ["A parked car appears again."],
                            "on_full": "RAW CLOCK KEEPER CONSEQUENCE",
                        }
                    ],
                }
            ]
        },
    )
    _write_json(scenario / "pacing-map.json", {"pacing_curve": []})
    _write_json(
        scenario / "improvisation-boundaries.json",
        {"keeper_secrets": [{"id": "secret-clerk", "category": "npc"}]},
    )

    request = coc_epistemic_compile.build_compile_request(scenario)
    serialized = json.dumps(request, ensure_ascii=False)

    for forbidden in (
        "RAW NPC KEEPER AGENDA",
        "RAW NPC KEEPER FEAR",
        "RAW NPC KEEPER SECRET",
        "RAW DANGER KEEPER IMPULSE",
        "RAW DANGER KEEPER MOVE",
        "RAW CLOCK KEEPER CONSEQUENCE",
    ):
        assert forbidden not in serialized
    assert "Wants to finish the public appointment." in serialized
    assert "Unknown observers shadow the route." in serialized
    assert "A parked car appears again." in serialized
    assert "npc-clerk" in serialized
    assert "danger-watchers" in serialized
    assert "clock-alert" in serialized


def _source_inputs(
    *,
    segment_review="auto_accepted",
    segment_text="Evidence segment A",
    segment_hash=None,
):
    if segment_hash is None:
        segment_hash = hashlib.sha256(segment_text.encode("utf-8")).hexdigest()
    page_map = {
        "sources": [
            {
                "source_id": "pdf:x",
                "path": "x.pdf",
                "file_sha256": "file-a",
                "pages": [
                    {
                        "pdf_index": 11,
                        "printed_page": 7,
                        "printed_label": "7",
                    }
                ],
            }
        ]
    }
    manifest = {
        "default_threshold": 0.8,
        "ranges": [
            {
                "range_id": "range-a",
                "source_id": "pdf:x",
                "pdf_indices": [11],
                "file_sha256": "file-a",
                "text_sha256": "range-text-a",
                "quality": {"overall": 0.95},
                "review_state": "auto_accepted",
            }
        ],
    }
    segments = [
        {
            "segment_id": "seg-a",
            "source_id": "pdf:x",
            "locator": {"pdf_index": 11, "printed_page": 7},
            "text_sha256": segment_hash,
            "parse_confidence": 0.91,
            "review_state": segment_review,
            "grep_anchors": ["Anchor A"],
            "text": segment_text,
        }
    ]
    ref = {"source_id": "pdf:x", "printed_page": 7, "grep_anchor": "Anchor A"}
    return ref, page_map, manifest, segments


def test_critical_source_rejects_unreviewed_evidence_segment():
    ref, page_map, manifest, segments = _source_inputs(segment_review="rejected")

    result = coc_pdf_source.critical_source_allowed(
        [ref], manifest, segments, page_map=page_map
    )

    assert result["allowed"] is False
    assert "source_needs_review" in {finding["code"] for finding in result["findings"]}


def test_critical_source_rejects_tampered_segment_text_hash():
    ref, page_map, manifest, segments = _source_inputs(segment_hash="0" * 64)

    result = coc_pdf_source.critical_source_allowed(
        [ref], manifest, segments, page_map=page_map
    )

    assert result["allowed"] is False
    assert "stale_source_hash" in {finding["code"] for finding in result["findings"]}


def _compiled_with_confidence(nodes: list[dict]) -> dict:
    return {
        "module_meta": {
            "scenario_id": "confidence-ids",
            "structure_type": "branching_investigation",
        },
        "story_graph": {
            "scenes": [
                {
                    "scene_id": "start",
                    "is_start": True,
                    "scene_type": "investigation",
                    "dramatic_question": "What happened?",
                    "available_clues": ["clue-a"],
                    "npc_ids": [],
                    "scene_edges": [{"to": "finale", "when": {"kind": "always"}}],
                },
                {
                    "scene_id": "finale",
                    "is_final": True,
                    "scene_type": "resolution",
                    "dramatic_question": "Can it be resolved?",
                    "available_clues": [],
                    "npc_ids": [],
                    "scene_edges": [],
                },
            ]
        },
        "clue_graph": {
            "conclusions": [
                {
                    "conclusion_id": "conclusion-a",
                    "importance": "major",
                    "clues": [
                        {
                            "clue_id": "clue-a",
                            "delivery_kind": "obvious",
                            "leads_to": ["finale"],
                            "origin": "source",
                        }
                    ],
                }
            ]
        },
        "npc_agendas": {"npcs": []},
        "threat_fronts": {"fronts": []},
        "epistemic_graph": {
            "questions": [
                {
                    "question_id": "q-known",
                    "layer": "fact",
                    "player_facing_question": "Was it altered?",
                    "truth_ref": "truth-known",
                    "importance": "major",
                }
            ],
            "evidence_links": [
                {
                    "clue_id": "clue-a",
                    "question_id": "q-known",
                    "effect": "confirm",
                    "strength": 0.9,
                }
            ],
        },
        "reveal_contracts": {
            "contracts": [
                {
                    "reveal_contract_id": "rc-known",
                    "mode": "confirm",
                    "target_question_id": "q-known",
                    "trigger_clue_ids": ["clue-a"],
                }
            ]
        },
        "compile_confidence": {"schema_version": 1, "nodes": nodes},
    }


def test_compile_confidence_rejects_unknown_authored_node_ids():
    compiled = _compiled_with_confidence(
        [
            {
                "node_type": "question",
                "node_id": "q-missing",
                "effective_confidence": 0.9,
                "review_state": "auto_accepted",
            },
            {
                "node_type": "reveal_contract",
                "node_id": "rc-missing",
                "effective_confidence": 0.9,
                "review_state": "auto_accepted",
            },
        ]
    )

    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    broken = [finding for finding in findings if finding["code"] == "broken_epistemic_reference"]

    assert any("q-missing" in finding["message"] for finding in broken)
    assert any("rc-missing" in finding["message"] for finding in broken)


def test_compile_confidence_rejects_duplicate_and_unknown_node_types():
    compiled = _compiled_with_confidence(
        [
            {
                "node_type": "question",
                "node_id": "q-known",
                "effective_confidence": 0.9,
                "review_state": "auto_accepted",
            },
            {
                "node_type": "question",
                "node_id": "q-known",
                "effective_confidence": 0.8,
                "review_state": "manual_accepted",
            },
            {
                "node_type": "mystery_blob",
                "node_id": "q-known",
                "effective_confidence": 0.9,
                "review_state": "auto_accepted",
            },
        ]
    )

    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    codes = {finding["code"] for finding in findings}

    assert "duplicate_compile_confidence_node" in codes
    assert "invalid_compile_confidence_node" in codes
