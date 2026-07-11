#!/usr/bin/env python3
"""One-shot asserted patch for epistemic review fixes."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one anchor, found {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def patch_apply() -> None:
    path = "plugins/coc-keeper/scripts/coc_director_apply.py"
    replace_once(
        path,
        'coc_belief_state = _load_sibling("coc_belief_state", "coc_belief_state.py")\n',
        'coc_belief_state = _load_sibling("coc_belief_state", "coc_belief_state.py")\n'
        'coc_epistemic_resolve = _load_sibling("coc_epistemic_resolve", "coc_epistemic_resolve.py")\n',
    )
    replace_once(
        path,
        '    else:\n'
        '        directives.pop("failure_consequence", None)\n\n'
        '    return resolved_plan\n',
        '    else:\n'
        '        directives.pop("failure_consequence", None)\n\n'
        '    planned_epistemic = resolved_plan.get("epistemic_contract")\n'
        '    resolved_epistemic = coc_epistemic_resolve.resolve_epistemic_contract(\n'
        '        planned_epistemic, committed\n'
        '    )\n'
        '    if isinstance(planned_epistemic, dict) and isinstance(resolved_epistemic, dict):\n'
        '        resolved_plan["planned_epistemic_contract"] = _copy_jsonable(planned_epistemic)\n'
        '        resolved_plan["epistemic_contract"] = resolved_epistemic\n'
        '        resolved_plan["resolved_epistemic_contract"] = resolved_epistemic\n'
        '        directives["belief_update_contract"] = resolved_epistemic\n\n'
        '    return resolved_plan\n',
    )


def patch_compiler() -> None:
    path = "plugins/coc-keeper/scripts/coc_scenario_compile.py"
    replace_once(
        path,
        '        layer = question.get("layer")\n'
        '        if layer not in VALID_EPISTEMIC_LAYERS:\n',
        '        if not str(question.get("player_facing_question") or "").strip():\n'
        '            findings.append(_finding(\n'
        '                "invalid_epistemic_question", "error",\n'
        '                f"question \'{question_id}\' requires player_facing_question",\n'
        '                path=f"{path}.player_facing_question",\n'
        '            ))\n'
        '        if not str(question.get("truth_ref") or "").strip():\n'
        '            findings.append(_finding(\n'
        '                "invalid_epistemic_question", "error",\n'
        '                f"question \'{question_id}\' requires truth_ref",\n'
        '                path=f"{path}.truth_ref",\n'
        '            ))\n'
        '        layer = question.get("layer")\n'
        '        if layer not in VALID_EPISTEMIC_LAYERS:\n',
    )
    replace_once(
        path,
        '    covered_reframes: set[tuple[str, str]] = set()\n'
        '    for index, contract in enumerate(contracts_doc.get("contracts") or []):\n',
        '    covered_reframes: set[tuple[str, str]] = set()\n'
        '    reveal_contract_ids: set[str] = set()\n'
        '    for index, contract in enumerate(contracts_doc.get("contracts") or []):\n',
    )
    replace_once(
        path,
        '        mode = str(contract.get("mode") or "").lower()\n'
        '        if mode not in VALID_REVEAL_MODES:\n',
        '        reveal_contract_id = str(contract.get("reveal_contract_id") or "").strip()\n'
        '        if not reveal_contract_id:\n'
        '            findings.append(_finding(\n'
        '                "invalid_reveal_contract", "error",\n'
        '                "reveal contract requires reveal_contract_id",\n'
        '                path=f"{path}.reveal_contract_id",\n'
        '            ))\n'
        '        elif reveal_contract_id in reveal_contract_ids:\n'
        '            findings.append(_finding(\n'
        '                "duplicate_reveal_contract", "error",\n'
        '                f"duplicate reveal contract id \'{reveal_contract_id}\'",\n'
        '                path=f"{path}.reveal_contract_id",\n'
        '            ))\n'
        '        else:\n'
        '            reveal_contract_ids.add(reveal_contract_id)\n'
        '        mode = str(contract.get("mode") or "").lower()\n'
        '        if mode not in VALID_REVEAL_MODES:\n',
    )
    replace_once(
        path,
        '        trigger_ids = [value for value in contract.get("trigger_clue_ids") or [] if isinstance(value, str)]\n'
        '        for clue_id in trigger_ids:\n',
        '        trigger_ids = [\n'
        '            value for value in contract.get("trigger_clue_ids") or []\n'
        '            if isinstance(value, str) and value.strip()\n'
        '        ]\n'
        '        if mode == "reframe" and not trigger_ids:\n'
        '            findings.append(_finding(\n'
        '                "invalid_reframe_contract", "error",\n'
        '                "reframe contract requires at least one trigger_clue_id",\n'
        '                path=f"{path}.trigger_clue_ids",\n'
        '            ))\n'
        '        for clue_id in trigger_ids:\n',
    )


def patch_protocol() -> None:
    path = "plugins/coc-keeper/references/director-protocol.md"
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    marker = "Post-rule backfill preserves the original under `planned_epistemic_contract`"
    if marker not in text:
        text += (
            "\nPost-rule backfill preserves the original under `planned_epistemic_contract` "
            "and exposes the narrator-safe result as both `epistemic_contract` and "
            "`narrative_directives.belief_update_contract`. If no supporting clue "
            "commits, an effective treatment becomes `HOLD`.\n"
        )
        target.write_text(text, encoding="utf-8")


def cleanup() -> None:
    for rel in (
        "scripts/apply_epistemic_review_patch.py",
        ".github/workflows/apply-epistemic-review.yml",
        ".github/epistemic-review-trigger",
    ):
        target = ROOT / rel
        if target.exists():
            target.unlink()


def main() -> None:
    patch_apply()
    patch_compiler()
    patch_protocol()
    cleanup()


if __name__ == "__main__":
    main()
