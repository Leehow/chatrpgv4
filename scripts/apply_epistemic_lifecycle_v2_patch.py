#!/usr/bin/env python3
"""Patch large runtime files for confidence and question-lifecycle v2."""
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {count}")
    return text.replace(old, new, 1)


# Scenario compiler lifecycle validation and confidence loading.
path = Path("plugins/coc-keeper/scripts/coc_scenario_compile.py")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    "import coc_pdf_source\n",
    "import coc_pdf_source\nimport coc_epistemic_lifecycle\n",
    "compiler lifecycle import",
)
text = replace_once(
    text,
    "    findings.extend(_check_source_evidence(\n        compiled, source_bundle, strict_sources=strict_sources\n    ))\n    return findings",
    "    findings.extend(_check_source_evidence(\n        compiled, source_bundle, strict_sources=strict_sources\n    ))\n    findings.extend(coc_epistemic_lifecycle.validate_question_lifecycle(\n        compiled.get(\"epistemic_graph\"),\n        clue_ids=set(id_maps.get(\"clue\", {})),\n        scene_ids=set(id_maps.get(\"scene\", {})),\n    ))\n    return findings",
    "compiler lifecycle validation",
)
text = replace_once(
    text,
    '        "reveal_contracts": _read(scenario_dir / "reveal-contracts.json") if (scenario_dir / "reveal-contracts.json").exists() else {},\n',
    '        "reveal_contracts": _read(scenario_dir / "reveal-contracts.json") if (scenario_dir / "reveal-contracts.json").exists() else {},\n        "compile_confidence": _read(scenario_dir / "compile-confidence.json") if (scenario_dir / "compile-confidence.json").exists() else {},\n',
    "compiler confidence load",
)
path.write_text(text, encoding="utf-8")

# Director context supplies compile confidence to the policy.
path = Path("plugins/coc-keeper/scripts/coc_story_director.py")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    '        "reveal_contracts": _read_json(scenario / "reveal-contracts.json", {"contracts": []}),\n        "belief_state": coc_belief_state.read_belief_state(campaign_dir),',
    '        "reveal_contracts": _read_json(scenario / "reveal-contracts.json", {"contracts": []}),\n        "compile_confidence": _read_json(scenario / "compile-confidence.json", {"schema_version": 1, "nodes": []}),\n        "belief_state": coc_belief_state.read_belief_state(campaign_dir),',
    "director confidence context",
)
path.write_text(text, encoding="utf-8")

# Apply layer evaluates authored question transitions after clue commitment.
path = Path("plugins/coc-keeper/scripts/coc_director_apply.py")
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    'coc_epistemic_resolve = _load_sibling("coc_epistemic_resolve", "coc_epistemic_resolve.py")\n',
    'coc_epistemic_resolve = _load_sibling("coc_epistemic_resolve", "coc_epistemic_resolve.py")\ncoc_epistemic_lifecycle = _load_sibling("coc_epistemic_lifecycle", "coc_epistemic_lifecycle.py")\n',
    "apply lifecycle import",
)
old = '''    world["discovered_clue_ids"] = discovered
    # Epistemic state updates only after clue commitment is resolved.
    belief_events = coc_belief_state.apply_belief_turn(
        campaign_dir, plan, committed_clues, investigator_id, ts
    )
    for ev in belief_events:
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
'''
new = '''    world["discovered_clue_ids"] = discovered
    # Epistemic state updates only after clue commitment is resolved. Question
    # opening/closure is evaluated from structured authored conditions.
    epistemic_graph = _read_json(
        campaign_dir / "scenario" / "epistemic-graph.json",
        {"questions": [], "evidence_links": []},
    )
    current_belief = coc_belief_state.read_belief_state(campaign_dir)
    flags_set = _truthy_flag_ids(_read_json(save / "flags.json", {}))
    epistemic_contract = plan.get("epistemic_contract") or {}
    resolved_effects = epistemic_contract.get("resolved_effects")
    if not isinstance(resolved_effects, list):
        resolved_effects = epistemic_contract.get("effects")
    if not isinstance(resolved_effects, list):
        resolved_effects = [epistemic_contract] if isinstance(epistemic_contract, dict) else []
    question_transitions = coc_epistemic_lifecycle.evaluate_question_transitions(
        epistemic_graph,
        current_belief,
        world,
        committed_clues,
        flags_set=flags_set,
        visited_scene_ids=world.get("visited_scene_ids") or [],
        resolved_effects=[effect for effect in resolved_effects if isinstance(effect, dict)],
    )
    belief_events = coc_belief_state.apply_belief_turn(
        campaign_dir,
        plan,
        committed_clues,
        investigator_id,
        ts,
        question_transitions=question_transitions,
    )
    for ev in belief_events:
        events.append(ev)
        _append_jsonl(logs / "events.jsonl", ev)
'''
text = replace_once(text, old, new, "apply lifecycle block")
path.write_text(text, encoding="utf-8")
