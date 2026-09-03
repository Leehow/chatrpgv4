"""Temporal memory / worldline guidance in the canonical live-KP surfaces.

Guards the discoverable temporal UX contract in `coc-keeper-play` (main skill
+ typed-ops reference) and the Pi-Coc play host prompt: canonical temporal
operations only, semantic (never keyword) interpretation, explicit player
confirmation before worldline changes, no legacy card ops advertised as the
temporal path on the normal play surface. Also guards the bounded long-tail
loading contract: exact-operation `coc_discover` is the only permitted
discovery form during play and is always taught together with the
no-argument / whole-domain prohibition, plus the extraction-backlog and
two-step exact-transcript flows.
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
ONBOARDING_PROMPT = (
    REPO_ROOT / "plugins" / "coc-keeper" / "pi" / "prompts" / "onboarding-system.md"
)
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
    "memory.extraction_status",
    "memory.extraction_settle",
    "timeline.transfer",
)

# `transcript.locate` / `transcript.read` are guided for normal play but are
# registered by the transcript-ops slice; extend the archive-presence check
# once they land in the canonical operation archive.


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
    assert (
        "the player never calls or names timeline, history, memory, or transcript operations"
        in ref
    )
    assert "ordinary turns never require a recall, history, timeline, or transcript call" in ref


def test_exact_operation_discovery_exception_is_taught_with_broad_ban() -> None:
    """The exact-operation loader exception and the no-arg / whole-domain
    prohibition must appear together in every live-KP guidance surface, so
    neither can drift away from the other."""
    surfaces = {
        "play_prompt": _compact(PLAY_PROMPT.read_text(encoding="utf-8")),
        "main_skill": _compact(PLAY_SKILL.read_text(encoding="utf-8")),
        "typed_ops": _compact(TYPED_OPS.read_text(encoding="utf-8")),
    }
    for name, compact in surfaces.items():
        # The exception: one concrete dotted operation loads that typed tool.
        assert '{"operation":"memory.recall"}' in compact, name
        # The ban: broad discovery stays forbidden on the same surface.
        assert "never call `coc_discover` with no arguments" in compact, name
        assert "never discover a whole domain/namespace" in compact, name
    # Bounded semantics stay explicit: scoped grant, no pipeline, no quota.
    ref = surfaces["typed_ops"]
    assert "the grant is stage/phase/role-scoped and expires when the turn settles" in ref
    assert "no fixed pipeline, no quota; load only when semantically relevant" in ref


def test_play_prompt_documents_extraction_transfer_and_transcript_flows() -> None:
    play = PLAY_PROMPT.read_text(encoding="utf-8")
    compact = _compact(play)
    for typed_name in (
        "`coc_memory_extraction_status`",
        "`coc_memory_extraction_settle`",
        "`coc_timeline_transfer`",
        "`coc_transcript_locate`",
        "`coc_transcript_read`",
    ):
        assert typed_name in play, typed_name
    assert "the backlog never blocks play and carries no settle quota" in compact
    assert "never reconstruct wording from summaries" in compact
    # Two-step verification is locate first, read second.
    locate_at = compact.index("`coc_transcript_locate`")
    read_at = compact.index("`coc_transcript_read`")
    assert locate_at < read_at


def test_typed_ops_reference_documents_extraction_transfer_transcript() -> None:
    ref = _compact(TYPED_OPS.read_text(encoding="utf-8"))
    # Extraction lifecycle: bounded status list, one-at-a-time settle.
    assert "**extraction backlog (never a blocker).**" in ref
    assert "play never waits on the backlog, and there is no settle quota" in ref
    assert "`recovered` routes your candidate result" in ref
    assert "`abandoned` records your concise reason" in ref
    # Transfer: explicit recorded cross-timeline memory only.
    assert "recorded through `timeline.transfer`" in ref
    assert "privacy may only tighten" in ref
    # Transcript: structured locate, exact hash-verified read.
    assert "**exact transcript verification (two steps, never reconstruction).**" in ref
    assert "returns bounded candidate cards" in ref
    assert "returns the exact hash-verified text" in ref
    assert "quote only from that return" in ref


def test_main_skill_routes_extraction_and_transcript_cases() -> None:
    main = PLAY_SKILL.read_text(encoding="utf-8")
    compact = _compact(main)
    assert (
        "extraction backlog (`memory.extraction_status` / `memory.extraction_settle`)"
        in compact
    )
    assert "exact transcript verification (`transcript.locate` / `transcript.read`)" in compact
    assert "the backlog never blocks play" in compact
    assert "never reconstruct wording from summaries or memory" in compact


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
    # The setup prompt is retired; onboarding is the other prompt now, and it
    # carries none of the temporal surface.
    onboarding = ONBOARDING_PROMPT.read_text(encoding="utf-8")
    constitution = _constitution(play)
    for marker in (
        "coc_memory_recall",
        "coc_timeline_fork_request",
        "temporal_capsule",
    ):
        assert marker not in constitution, marker
        assert marker not in onboarding, marker
    # The byte-identity invariant itself is owned by test_prompt_constitution.


def test_guided_operations_exist_in_canonical_operation_archive() -> None:
    """Guidance must not advertise operations outside the canonical registry."""
    archive = json.loads(OPERATION_ARCHIVE.read_text(encoding="utf-8"))
    operations = archive["operations"]
    for operation in CANONICAL_TEMPORAL_OPERATIONS:
        assert operation in operations, operation
