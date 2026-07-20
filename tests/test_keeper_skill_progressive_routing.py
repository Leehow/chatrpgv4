"""Progressive context routing for coc-keeper-play (ordinary-turn load bound)."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAY_DIR = ROOT / "plugins" / "coc-keeper" / "skills" / "coc-keeper-play"
MAIN = PLAY_DIR / "SKILL.md"
REFS = PLAY_DIR / "references"

MAX_MAIN_LINES = 320
MAX_MAIN_BYTES = 22 * 1024

REQUIRED_ROUTE_FILES = {
    "references/compound-and-causal-finalization.md",
    "references/declaration-adjudication-and-improv.md",
    "references/investigators-horror-npc.md",
    "references/style-scene-craft.md",
    "references/horror-san-content-endings.md",
    "references/turn-tooling-and-typed-ops.md",
}

# Major section anchors that previously lived only in the monolithic skill.
PACKAGE_SECTION_ANCHORS = (
    "### Compound player declarations (settle in order)",
    "### Causal Realization at the Final Boundary",
    "### Controlled Improvisation Becomes Campaign Canon",
    "## Declaration Adjudication",
    "### Player knowledge boundary (KP owns the intercept)",
    "## Personal Horror Weaving",
    "## Investigator Parameters in Play",
    "## Reusable Investigator Selection",
    "## Starter Scenario Character Gate",
    "### Table Wit (failures players feel)",
    "## Foreign-Language Dialogue",
    "## Action Prompt Shape",
    "## Scene Craft",
    "## Content Boundaries",
    "## Failed SAN Table Protocol",
    "## Horror Craft",
    "## Ending a Story",
    "### A Typical Turn",
    "### Typed Operations",
)

HARD_PHRASES = (
    "must make that declaration happen in the fictional world",
    "always-on prompt-level drafting responsibility",
    "not a fixed workflow",
    "never a keyword list",
    "required craft instruction",
    "not a mandatory pipeline",
    "settlement is **internal kp craft**",
    "acknowledge the unplayed remainder",
    "tease like a real table kp",
    "table wit (failures players feel)",
    "fumbles / 大失败",
    "【串联】",
    "player knowledge boundary",
    "kp owns the intercept",
    "lucky guesses stay guesses",
    "overconfident unearned knowledge",
    "action_uptake",
)


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _package_text() -> str:
    parts = [_text(MAIN)]
    for path in sorted(REFS.glob("*.md")):
        parts.append(_text(path))
    return "\n".join(parts)


def test_main_skill_frontmatter_and_size_budget():
    text = _text(MAIN)
    match = re.search(r"\A---\s*\nname:\s*([^\n]+)\n", text)
    assert match, "missing YAML front matter name"
    assert match.group(1).strip() == "coc-keeper-play"
    assert "description:" in text.split("---", 2)[1]

    lines = text.count("\n") + (0 if text.endswith("\n") else 1)
    nbytes = len(text.encode("utf-8"))
    assert lines <= MAX_MAIN_LINES, f"main skill lines={lines} > {MAX_MAIN_LINES}"
    assert nbytes <= MAX_MAIN_BYTES, f"main skill bytes={nbytes} > {MAX_MAIN_BYTES}"


def test_progressive_routing_table_points_at_existing_files():
    main = _text(MAIN)
    assert "## Progressive Context Routing" in main
    assert "Load the named reference before adjudicating" in main

    for rel in REQUIRED_ROUTE_FILES:
        assert rel in main, f"routing table missing {rel}"
        path = PLAY_DIR / rel
        assert path.is_file(), f"routed reference missing: {path}"
        body = _text(path)
        assert "Normative when routed" in body
        assert len(body.strip()) > 200


def test_main_retains_always_on_product_invariants():
    compact = " ".join(_text(MAIN).split()).lower()
    for phrase in (
        "the kp is the product",
        "no fixed turn pipeline",
        "must make that declaration happen in the fictional world",
        "play_language",
        "dice are real",
        "state writes go through tools",
        "module truth is read-only",
        "turn.finalize",
        "rendered_text",
        "player knowledge boundary",
        "kp owns the intercept",
        "controlled improvisation",
        "narrative debt",
        "state.exceptional_effect",
        "npc.reaction",
        "never a keyword list",
        "no mandatory director",
        "operational invisibility",
        "已深解析",
        "15-tool hotset",
        "coc_discover",
        "coc_invoke",
        "do not mix mcp and shell",
        "not a mandatory pipeline",
    ):
        assert phrase in compact, phrase


def test_mcp_hotset_and_no_repeated_full_catalog_guidance():
    compact = " ".join(_text(MAIN).split()).lower()
    assert "15-tool hotset" in compact
    assert "state.record_npc_engagement" in compact
    assert "state.move_scene" not in compact
    assert "coc_discover" in compact
    assert "coc_invoke" in compact
    assert "exact-operation or exact-domain" in compact or (
        "exact-operation" in compact and "exact-domain" in compact
    )
    assert "do not" in compact and "no-arg full catalog" in compact
    # No speculative domain discovery for awareness/reassurance/confirmation.
    assert "only when a concrete long-tail operation is needed" in compact
    assert "never discover a domain merely for awareness" in compact
    assert "do not mix mcp and shell" in compact
    assert "coc_toolbox.py" in compact
    assert "pi/headless" in compact or "pi/headless or no-plugin-mcp" in compact
    # On-demand shell discovery — not re-list entire catalog every turn.
    assert "do not" in compact and "re-list the entire catalog" in compact


def test_package_retains_prior_section_anchors_and_hard_phrases():
    package = _package_text()
    for anchor in PACKAGE_SECTION_ANCHORS:
        assert anchor in package, anchor
    compact = " ".join(package.split()).lower()
    for phrase in HARD_PHRASES:
        assert phrase in compact, phrase


def test_reference_count_is_cohesive_not_monolithic():
    refs = sorted(REFS.glob("*.md"))
    assert 4 <= len(refs) <= 6
    # No single reference should swallow nearly all prior substance alone.
    sizes = [path.stat().st_size for path in refs]
    assert max(sizes) < 40 * 1024
    total = sum(sizes)
    assert total > 30 * 1024  # retained detail still present
