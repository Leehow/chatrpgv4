"""Temporal memory / worldline guidance in the canonical live-KP surfaces.

Guards the discoverable temporal UX contract in `coc-keeper-play` (main skill
+ typed-ops reference) and the Pi-Coc play host prompt: canonical temporal
operations only, semantic (never keyword) interpretation, explicit player
confirmation before worldline changes, no legacy card ops advertised as the
temporal path on the normal play surface.
"""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PLAY_SKILL = (
    REPO_ROOT
    / "plugins"
    / "coc-keeper"
    / "skills"
    / "coc-keeper-play"
    / "SKILL.md"
)
TYPED_OPS = (
    REPO_ROOT
    / "plugins"
    / "coc-keeper"
    / "skills"
    / "coc-keeper-play"
    / "references"
    / "turn-tooling-and-typed-ops.md"
)
PLAY_PROMPT = REPO_ROOT / "plugins" / "coc-keeper" / "pi" / "prompts" / "host-system-play.md"
SETUP_PROMPT = REPO_ROOT / "plugins" / "coc-keeper" / "pi" / "prompts" / "host-system-setup.md"
OPERATION_ARCHIVE = (
    REPO_ROOT / "plugins" / "coc-keeper" / "references" / "mcp-operation-contracts.json"
)

BEGIN = "<!-- CONSTITUTION:BEGIN -->"
END = "<!-- CONSTITUTION:END -->"

LEGACY_MEMORY_OPS = ("`memory.search`", "`memory.write`", "`memory.resolve_hook`")

CANONICAL_TEMPORAL_OPERATIONS = (
    "history.query",
    "history.diff",
    "timeline.fork_request",
    "timeline.fork_confirm",
    "timeline.confluence_query",
    "timeline.confluence_confirm",
    "memory.recall",
    "memory.adjudicate",
)


def _compact(text: str) -> str:
    return " ".join(text.split()).lower()


def _constitution(text: str) -> str:
    start = text.index(BEGIN) + len(BEGIN)
    stop = text.index(END)
    return text[start:stop]


def test_main_skill_routes_temporal_cases_into_typed_ops_reference() -> None:
    main = PLAY_SKILL.read_text(encoding="utf-8")
    compact = _compact(main)
    assert "## Progressive Context Routing" in main
    # The routing table names the temporal lane and points it at the
    # existing typed-ops reference (no new reference file).
    assert "temporal memory (`memory.recall` / `memory.adjudicate`)" in compact
    assert "`history.query` / `history.diff`" in compact
    assert "worldline-merge requests (`timeline.*`)" in compact
    assert "### temporal memory and worldlines" in _compact(
        TYPED_OPS.read_text(encoding="utf-8")
    )


def test_main_skill_memory_bullet_uses_temporal_path_not_legacy_cards() -> None:
    main = PLAY_SKILL.read_text(encoding="utf-8")
    compact = _compact(main)
    assert "**temporal story memory (advisory, never truth).**" in compact
    assert "`memory.recall` deterministically narrows candidate memory assertions" in compact
    assert "`memory.adjudicate` settles candidates and player assertions" in compact
    assert "no per-turn recall quota" in compact
    assert "never invent cross-line recall" in compact
    # The normal path must not instruct the legacy card surface.
    for legacy in LEGACY_MEMORY_OPS:
        assert legacy not in main, legacy


def test_typed_ops_reference_carries_full_temporal_discipline() -> None:
    ref = _compact(TYPED_OPS.read_text(encoding="utf-8"))
    # Recall/adjudicate split: deterministic narrowing vs KP semantics.
    assert "you** choose relevance semantically" in ref
    assert "recall is advisory context, never truth, and carries no per-turn quota" in ref
    # History anchors stay semantic; no SHA/digest copying.
    assert "never ask the model or the player to copy, read, or echo a commit sha" in ref
    # Fork: request never switches, confirm does; no automatic fork.
    assert "a request alone never switches the active timeline" in ref
    assert "never fork automatically from phrasing" in ref
    assert "confirm explicitly with the player" in ref
    # Confluence: complete dispositions, non-duplicable single, no silent merge.
    assert "complete** conflict list" in ref
    assert "never settle twice" in ref
    assert "never a silent json merge" in ref
    assert "`defer` is explicit narrative debt, never a skipped row" in ref
    # Cross-line memory boundary.
    assert "player meta-knowledge, not character memory" in ref
    # Tools invisible; no pipeline/quota/gate.
    assert "the player never calls or names timeline, history, or memory operations" in ref
    assert "ordinary turns never require a recall, history, or timeline call" in ref


def test_play_prompt_uses_typed_temporal_tools_and_drops_legacy_cards() -> None:
    play = PLAY_PROMPT.read_text(encoding="utf-8")
    compact = _compact(play)
    for typed_name in (
        "`coc_memory_recall`",
        "`coc_memory_adjudicate`",
        "`coc_timeline_fork_request`",
        "`coc_timeline_fork_confirm`",
        "`coc_timeline_confluence_query`",
        "`coc_timeline_confluence_confirm`",
        "`coc_history_query`",
        "`coc_history_diff`",
    ):
        assert typed_name in play, typed_name
    assert "never fork automatically from phrasing" in compact
    assert "one explicit player confirmation" in compact
    assert "never switches the active timeline" in compact
    assert "never settle twice" in compact
    assert "never a silent json merge" in compact
    assert "never ask the player to copy a commit hash, digest, or ref" in compact
    assert "temporal_capsule" in compact
    assert "never invent cross-line recall absent a recorded transfer" in compact
    # The legacy card ops are gone from the play prompt's normal path.
    for legacy in LEGACY_MEMORY_OPS:
        assert legacy not in play, legacy


def test_temporal_guidance_stays_outside_shared_constitution_block() -> None:
    play = PLAY_PROMPT.read_text(encoding="utf-8")
    setup = SETUP_PROMPT.read_text(encoding="utf-8")
    constitution = _constitution(play)
    for marker in (
        "coc_memory_recall",
        "coc_timeline_fork_request",
        "temporal_capsule",
    ):
        assert marker not in constitution, marker
        assert marker not in setup, marker
    # The byte-identity invariant itself is owned by test_prompt_constitution.


def test_guided_operations_exist_in_canonical_operation_archive() -> None:
    """Guidance must not advertise operations outside the canonical registry."""
    archive = json.loads(OPERATION_ARCHIVE.read_text(encoding="utf-8"))
    operations = archive["operations"]
    for operation in CANONICAL_TEMPORAL_OPERATIONS:
        assert operation in operations, operation
