#!/usr/bin/env python3
"""One-shot repository patcher for the epistemic Director v1 branch.

The GitHub connector cannot apply unified diffs, so this script performs
asserted, exact source edits inside an Actions checkout. It deletes itself,
its trigger, and its temporary workflow after a successful source rewrite.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, found {count}: {old[:100]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def append_once(path: str, marker: str, content: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if marker in text:
        return
    if not text.endswith("\n"):
        text += "\n"
    target.write_text(text + content, encoding="utf-8")


def patch_scenario_compile() -> None:
    path = "plugins/coc-keeper/scripts/coc_scenario_compile.py"
    replace_once(
        path,
        'VALID_PAGE_KINDS = frozenset({"printed", "pdf_index"})\n',
        'VALID_PAGE_KINDS = frozenset({"printed", "pdf_index"})\n'
        'VALID_EPISTEMIC_LAYERS = frozenset({\n'
        '    "fact", "identity", "method", "motive", "causal", "structure",\n'
        '    "world", "personal",\n'
        '})\n'
        'VALID_EPISTEMIC_EFFECTS = frozenset({\n'
        '    "confirm", "expand", "complicate", "reframe", "payoff",\n'
        '})\n'
        'VALID_REVEAL_MODES = VALID_EPISTEMIC_EFFECTS\n',
    )

    function_block = r'''

def _check_epistemic_sidecars(
    compiled: dict[str, Any],
    id_maps: dict[str, dict[str, list[str]]],
) -> list[dict[str, str]]:
    """Validate optional question/evidence/reveal sidecars.

    The check is ID- and enum-driven only. Missing sidecars are valid legacy
    mode; malformed opt-in sidecars fail closed for core references.
    """
    graph = compiled.get("epistemic_graph")
    contracts_doc = compiled.get("reveal_contracts")
    if not isinstance(graph, dict) and not isinstance(contracts_doc, dict):
        return []
    graph = graph if isinstance(graph, dict) else {}
    contracts_doc = contracts_doc if isinstance(contracts_doc, dict) else {}
    findings: list[dict[str, str]] = []
    clue_ids = set(id_maps.get("clue", {}))

    questions: dict[str, dict[str, Any]] = {}
    duplicate_questions: set[str] = set()
    for index, question in enumerate(graph.get("questions") or []):
        path = f"epistemic_graph.questions[{index}]"
        if not isinstance(question, dict):
            findings.append(_finding(
                "invalid_epistemic_question", "error",
                "epistemic question must be an object", path=path,
            ))
            continue
        question_id = str(question.get("question_id") or "").strip()
        if not question_id:
            findings.append(_finding(
                "invalid_epistemic_question", "error",
                "epistemic question requires question_id", path=path,
            ))
            continue
        if question_id in questions:
            duplicate_questions.add(question_id)
        questions[question_id] = question
        layer = question.get("layer")
        if layer not in VALID_EPISTEMIC_LAYERS:
            findings.append(_finding(
                "invalid_epistemic_layer", "error",
                f"question '{question_id}' layer '{layer}' not in {sorted(VALID_EPISTEMIC_LAYERS)}",
                path=f"{path}.layer",
            ))
        for opened in question.get("opens_questions") or []:
            if not isinstance(opened, str):
                findings.append(_finding(
                    "broken_epistemic_reference", "error",
                    f"question '{question_id}' opens_questions entries must be ids",
                    path=f"{path}.opens_questions",
                ))
        if question.get("importance") == "critical" and not question.get("source_refs"):
            findings.append(_finding(
                "critical_question_missing_source", "warning",
                f"critical question '{question_id}' has no source_refs",
                path=path,
            ))
    for question_id in sorted(duplicate_questions):
        findings.append(_finding(
            "duplicate_epistemic_question", "error",
            f"duplicate epistemic question id '{question_id}'",
            path="epistemic_graph.questions",
        ))

    links_by_question: dict[str, int] = {}
    reframe_pairs: set[tuple[str, str]] = set()
    for index, link in enumerate(graph.get("evidence_links") or []):
        path = f"epistemic_graph.evidence_links[{index}]"
        if not isinstance(link, dict):
            findings.append(_finding(
                "invalid_epistemic_link", "error",
                "evidence link must be an object", path=path,
            ))
            continue
        clue_id = link.get("clue_id")
        question_id = link.get("question_id")
        effect = link.get("effect")
        if clue_id not in clue_ids:
            findings.append(_finding(
                "broken_epistemic_reference", "error",
                f"evidence link clue_id '{clue_id}' does not resolve",
                path=f"{path}.clue_id",
            ))
        if question_id not in questions:
            findings.append(_finding(
                "broken_epistemic_reference", "error",
                f"evidence link question_id '{question_id}' does not resolve",
                path=f"{path}.question_id",
            ))
        else:
            links_by_question[str(question_id)] = links_by_question.get(str(question_id), 0) + 1
        if effect not in VALID_EPISTEMIC_EFFECTS:
            findings.append(_finding(
                "invalid_epistemic_effect", "error",
                f"evidence effect '{effect}' not in {sorted(VALID_EPISTEMIC_EFFECTS)}",
                path=f"{path}.effect",
            ))
        elif effect == "reframe" and isinstance(question_id, str) and isinstance(clue_id, str):
            reframe_pairs.add((question_id, clue_id))
        strength = link.get("strength")
        if strength is not None:
            try:
                numeric = float(strength)
            except (TypeError, ValueError):
                numeric = -1.0
            if numeric < 0.0 or numeric > 1.0:
                findings.append(_finding(
                    "invalid_epistemic_strength", "warning",
                    f"evidence strength for clue '{clue_id}' should be within 0..1",
                    path=f"{path}.strength",
                ))

    for question_id, question in questions.items():
        if question.get("importance") == "critical" and links_by_question.get(question_id, 0) == 0:
            findings.append(_finding(
                "critical_question_without_evidence", "warning",
                f"critical question '{question_id}' has no evidence links",
                path=f"epistemic_graph.questions/{question_id}",
            ))
        for opened in question.get("opens_questions") or []:
            if isinstance(opened, str) and opened not in questions:
                findings.append(_finding(
                    "broken_epistemic_reference", "error",
                    f"question '{question_id}' opens missing question '{opened}'",
                    path=f"epistemic_graph.questions/{question_id}.opens_questions",
                ))

    covered_reframes: set[tuple[str, str]] = set()
    for index, contract in enumerate(contracts_doc.get("contracts") or []):
        path = f"reveal_contracts.contracts[{index}]"
        if not isinstance(contract, dict):
            findings.append(_finding(
                "invalid_reveal_contract", "error",
                "reveal contract must be an object", path=path,
            ))
            continue
        mode = str(contract.get("mode") or "").lower()
        if mode not in VALID_REVEAL_MODES:
            findings.append(_finding(
                "invalid_reveal_contract", "error",
                f"reveal mode '{mode}' not in {sorted(VALID_REVEAL_MODES)}",
                path=f"{path}.mode",
            ))
        question_id = contract.get("target_question_id")
        if question_id not in questions:
            findings.append(_finding(
                "broken_epistemic_reference", "error",
                f"reveal contract target_question_id '{question_id}' does not resolve",
                path=f"{path}.target_question_id",
            ))
        trigger_ids = [value for value in contract.get("trigger_clue_ids") or [] if isinstance(value, str)]
        for clue_id in trigger_ids:
            if clue_id not in clue_ids:
                findings.append(_finding(
                    "broken_epistemic_reference", "error",
                    f"reveal contract trigger clue '{clue_id}' does not resolve",
                    path=f"{path}.trigger_clue_ids",
                ))
            if mode == "reframe" and isinstance(question_id, str):
                covered_reframes.add((question_id, clue_id))
        for clue_id in contract.get("setup_refs") or []:
            if clue_id not in clue_ids:
                findings.append(_finding(
                    "broken_epistemic_reference", "error",
                    f"reveal contract setup ref '{clue_id}' does not resolve",
                    path=f"{path}.setup_refs",
                ))
        for opened in contract.get("opens_questions") or []:
            if opened not in questions:
                findings.append(_finding(
                    "broken_epistemic_reference", "error",
                    f"reveal contract opens missing question '{opened}'",
                    path=f"{path}.opens_questions",
                ))
        if mode == "reframe":
            setup_refs = [value for value in contract.get("setup_refs") or [] if isinstance(value, str)]
            if len(set(setup_refs)) < 2:
                findings.append(_finding(
                    "invalid_reframe_contract", "error",
                    "reframe contract requires at least two setup_refs",
                    path=f"{path}.setup_refs",
                ))
            preserve = [value for value in contract.get("preserve_as_true") or [] if isinstance(value, str) and value.strip()]
            if not preserve:
                findings.append(_finding(
                    "invalid_reframe_contract", "error",
                    "reframe contract requires non-empty preserve_as_true",
                    path=f"{path}.preserve_as_true",
                ))

    for question_id, clue_id in sorted(reframe_pairs - covered_reframes):
        findings.append(_finding(
            "reframe_missing_contract", "warning",
            f"reframe evidence ({question_id}, {clue_id}) has no matching reveal contract",
            path="epistemic_graph.evidence_links",
        ))
    return findings
'''
    replace_once(
        path,
        '\ndef validate_compiled_scenario(\n',
        function_block + '\n\ndef validate_compiled_scenario(\n',
    )
    replace_once(
        path,
        '    findings.extend(_check_location_tags(compiled))\n    return findings\n',
        '    findings.extend(_check_location_tags(compiled))\n'
        '    findings.extend(_check_epistemic_sidecars(compiled, id_maps))\n'
        '    return findings\n',
    )
    replace_once(
        path,
        '        "threat_fronts": _read(scenario_dir / "threat-fronts.json") if (scenario_dir / "threat-fronts.json").exists() else {"fronts": []},\n'
        '    }\n',
        '        "threat_fronts": _read(scenario_dir / "threat-fronts.json") if (scenario_dir / "threat-fronts.json").exists() else {"fronts": []},\n'
        '        "epistemic_graph": _read(scenario_dir / "epistemic-graph.json") if (scenario_dir / "epistemic-graph.json").exists() else {},\n'
        '        "reveal_contracts": _read(scenario_dir / "reveal-contracts.json") if (scenario_dir / "reveal-contracts.json").exists() else {},\n'
        '    }\n',
    )
    replace_once(
        path,
        '    return {"errors": errors, "warnings": warnings}\n\n\ndef _main() -> int:\n',
        '    compiled = load_compiled_from_dir(scenario_dir)\n'
        '    epi_findings = _check_epistemic_sidecars(compiled, _collect_id_maps(compiled))\n'
        '    for finding in epi_findings:\n'
        '        rendered = f"{finding.get(\'code\')}: {finding.get(\'message\')}"\n'
        '        if finding.get("severity") == "error":\n'
        '            errors.append(rendered)\n'
        '        else:\n'
        '            warnings.append(rendered)\n\n'
        '    return {"errors": errors, "warnings": warnings}\n\n\ndef _main() -> int:\n',
    )


def patch_story_director() -> None:
    path = "plugins/coc-keeper/scripts/coc_story_director.py"
    replace_once(
        path,
        'coc_scene_graph = _load_sibling("coc_scene_graph", "coc_scene_graph.py")\n',
        'coc_scene_graph = _load_sibling("coc_scene_graph", "coc_scene_graph.py")\n'
        'coc_epistemic_policy = _load_sibling("coc_epistemic_policy", "coc_epistemic_policy.py")\n'
        'coc_belief_state = _load_sibling("coc_belief_state", "coc_belief_state.py")\n',
    )
    replace_once(
        path,
        '        "clue_graph": _read_json(scenario / "clue-graph.json", {"conclusions": []}),\n'
        '        "npc_agendas": _read_json(scenario / "npc-agendas.json", {"npcs": []}),\n',
        '        "clue_graph": _read_json(scenario / "clue-graph.json", {"conclusions": []}),\n'
        '        "epistemic_graph": _read_json(scenario / "epistemic-graph.json", {"questions": [], "evidence_links": []}),\n'
        '        "reveal_contracts": _read_json(scenario / "reveal-contracts.json", {"contracts": []}),\n'
        '        "belief_state": coc_belief_state.read_belief_state(campaign_dir),\n'
        '        "npc_agendas": _read_json(scenario / "npc-agendas.json", {"npcs": []}),\n',
    )
    replace_once(
        path,
        '    clue_policy = _select_clue_policy(ctx, action)\n'
        '    rules_requests = _build_rules_requests(ctx, action, clue_policy)\n',
        '    clue_policy = _select_clue_policy(ctx, action)\n'
        '    epistemic_contract = coc_epistemic_policy.plan_epistemic_contract(\n'
        '        ctx, clue_policy, action\n'
        '    )\n'
        '    rules_requests = _build_rules_requests(ctx, action, clue_policy)\n',
    )
    replace_once(
        path,
        '            "player_intent_class": ctx["player_intent_class"],\n'
        '            "active_scene_id": ctx["active_scene_id"],\n',
        '            "player_intent_class": ctx["player_intent_class"],\n'
        '            "player_intent_rich": ctx.get("player_intent_rich"),\n'
        '            "active_scene_id": ctx["active_scene_id"],\n',
    )
    replace_once(
        path,
        '        "clue_policy": clue_policy,\n'
        '        "npc_moves": npc_moves,\n',
        '        "clue_policy": clue_policy,\n'
        '        "epistemic_contract": epistemic_contract,\n'
        '        "npc_moves": npc_moves,\n',
    )


def patch_director_apply() -> None:
    path = "plugins/coc-keeper/scripts/coc_director_apply.py"
    replace_once(
        path,
        'coc_npc_state = _load_sibling("coc_npc_state", "coc_npc_state.py")\n',
        'coc_npc_state = _load_sibling("coc_npc_state", "coc_npc_state.py")\n'
        'coc_belief_state = _load_sibling("coc_belief_state", "coc_belief_state.py")\n',
    )
    replace_once(
        path,
        '    world["discovered_clue_ids"] = discovered\n'
        '    # Mark scene-level SAN triggers as fired (dedup: director won\'t re-request).\n',
        '    world["discovered_clue_ids"] = discovered\n'
        '    # Epistemic state updates only after clue commitment is resolved.\n'
        '    belief_events = coc_belief_state.apply_belief_turn(\n'
        '        campaign_dir, plan, committed_clues, investigator_id, ts\n'
        '    )\n'
        '    for ev in belief_events:\n'
        '        events.append(ev)\n'
        '        _append_jsonl(logs / "events.jsonl", ev)\n'
        '    # Mark scene-level SAN triggers as fired (dedup: director won\'t re-request).\n',
    )


def patch_docs() -> None:
    append_once(
        "plugins/coc-keeper/skills/coc-scenario-import/SKILL.md",
        "## Epistemic Sidecars",
        '''\n## Epistemic Sidecars\n\nAfter the seven canonical scenario files validate, a belief-aware compile may\nalso emit optional `epistemic-graph.json` and `reveal-contracts.json`. Questions\nmust reference structured clue ids; `reframe` evidence requires a reveal\ncontract with at least two setup clue refs and non-empty `preserve_as_true`.\nMissing sidecars preserve legacy Director behavior.\n''',
    )
    append_once(
        "plugins/coc-keeper/skills/coc-scenario-import/references/compile-protocol.md",
        "## Epistemic compilation (optional v1 sidecar)",
        '''\n## Epistemic compilation (optional v1 sidecar)\n\nFor modules prepared for player-belief-aware directing, compile two additional\nfiles after the seven-file graph is green:\n\n1. `epistemic-graph.json`: structured questions plus clue-to-question evidence\n   links (`confirm|expand|complicate|reframe|payoff`).\n2. `reveal-contracts.json`: source-backed reveal contracts. A `reframe` must\n   preserve prior truths and require at least two setup clue ids.\n\nRuntime never maps module prose or player prose to these ids by keyword. A host\nsemantic evaluator may emit a structured belief candidate; the deterministic\nDirector consumes only ids, enums, and flags.\n''',
    )
    append_once(
        "plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md",
        "## 9. epistemic-graph.json (optional)",
        '''\n## 9. epistemic-graph.json (optional)\n\n`questions[]` fields: `question_id`, `layer` (`fact|identity|method|motive|causal|structure|world|personal`), `player_facing_question`, `truth_ref`, `importance`, optional `opens_questions` and `source_refs`.\n\n`evidence_links[]` fields: `clue_id`, `question_id`, `effect` (`confirm|expand|complicate|reframe|payoff`), optional `strength` in `0..1`.\n\n## 10. reveal-contracts.json (optional)\n\n`contracts[]` fields: `reveal_contract_id`, `mode`, `target_question_id`, `trigger_clue_ids`, `preserve_as_true`, `revise_hypothesis_kinds`, `setup_refs`, `opens_questions`, `explanation_targets`, and `must_not`. `reframe` requires at least two setup clue ids and at least one preserved truth.\n''',
    )
    append_once(
        "plugins/coc-keeper/references/director-protocol.md",
        "## Epistemic Contract",
        '''\n## Epistemic Contract\n\n`DirectorPlan.epistemic_contract` is orthogonal to `scene_action`. `mode` is one\nof `NONE|CONFIRM|EXPAND|COMPLICATE|REFRAME|HOLD|PAYOFF`. The apply layer commits\na treatment only when a clue in `deliver_clue_ids` actually lands after rules\nresolution. `REFRAME` carries `preserve_fact_refs`, `setup_refs`, and\n`must_not`; it never invalidates earlier confirmed facts by default.\n''',
    )


def cleanup() -> None:
    for rel in (
        "scripts/apply_epistemic_v1_patch.py",
        ".github/workflows/apply-epistemic-v1.yml",
        ".github/epistemic-v1-trigger",
    ):
        path = ROOT / rel
        if path.exists():
            path.unlink()


def main() -> None:
    patch_scenario_compile()
    patch_story_director()
    patch_director_apply()
    patch_docs()
    cleanup()


if __name__ == "__main__":
    main()
