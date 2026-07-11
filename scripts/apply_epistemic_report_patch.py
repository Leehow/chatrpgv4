#!/usr/bin/env python3
"""Apply epistemic metrics integration to the large playtest report module."""
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "plugins/coc-keeper/scripts/coc_playtest_report.py"


def replace_once(text: str, old: str, new: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"marker not found: {old[:140]!r}")
    return text.replace(old, new, 1)


def main() -> None:
    text = TARGET.read_text(encoding="utf-8")

    text = replace_once(
        text,
        "from coc_roll import format_percentile_result\n",
        "from coc_roll import format_percentile_result\nimport coc_epistemic_metrics\n",
    )

    text = replace_once(
        text,
        '''def _render_narrative_adherence_section(adherence: Any) -> list[str]:
    """Optional 叙事贴合 / Narrative Adherence section (SENNA checklist).''',
        '''def _render_epistemic_experience_section(
    metrics: dict[str, Any],
    language_profile: dict[str, Any],
) -> list[str]:
    """Render deterministic belief/question diagnostics without prose inference."""
    keys = (
        "belief_gain",
        "curiosity_load",
        "explanation_compression",
        "reframe_fairness",
        "confirmation_saturation",
        "unexplained_surprise",
        "parse_risk_exposure",
        "epistemic_health",
    )
    lines = [_report_heading(2, "Epistemic Experience", language_profile)]
    for key in keys:
        payload = metrics.get(key, {}) if isinstance(metrics, dict) else {}
        lines.append(
            f"- {key}: "
            + json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        )
    lines.append("")
    return lines


def _render_narrative_adherence_section(adherence: Any) -> list[str]:
    """Optional 叙事贴合 / Narrative Adherence section (SENNA checklist).''',
    )

    text = replace_once(
        text,
        '''    campaign = context["campaign"]
    scenario = context["scenario"]
    characters = context["characters"]
    handouts = (''',
        '''    campaign = context["campaign"]
    scenario = context["scenario"]
    characters = context["characters"]
    campaign_dir = context["campaign_dir"]
    belief_events = (
        _read_jsonl(campaign_dir / "logs" / "belief-events.jsonl")
        if campaign_dir
        else []
    )
    belief_state = (
        _read_json(campaign_dir / "save" / "belief-state.json", {})
        if campaign_dir
        else {}
    )
    compile_confidence = (
        _read_json(campaign_dir / "scenario" / "compile-confidence.json", {})
        if campaign_dir
        else {}
    )
    parse_manifest = (
        _read_json(campaign_dir / "index" / "parse-manifest.json", {})
        if campaign_dir
        else {}
    )
    epistemic_metrics = coc_epistemic_metrics.compute_epistemic_metrics(
        belief_events,
        belief_state=belief_state,
        compile_confidence=compile_confidence,
        parse_manifest=parse_manifest,
    )
    metadata["epistemic_metrics"] = epistemic_metrics
    (run_dir / "playtest.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\\n",
        encoding="utf-8",
    )
    handouts = (''',
    )

    text = replace_once(
        text,
        '''        _report_heading(2, "Clues Found", language_profile),
        *_list_lines(clue_lines, "- No clues recorded."),
        "",
        *_render_narrative_adherence_section(metadata.get("narrative_adherence")),''',
        '''        _report_heading(2, "Clues Found", language_profile),
        *_list_lines(clue_lines, "- No clues recorded."),
        "",
        *_render_epistemic_experience_section(epistemic_metrics, language_profile),
        *_render_narrative_adherence_section(metadata.get("narrative_adherence")),''',
    )

    TARGET.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
