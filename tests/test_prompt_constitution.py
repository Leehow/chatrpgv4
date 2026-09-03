from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PROMPTS = REPO_ROOT / "plugins" / "coc-keeper" / "pi" / "prompts"
ONBOARDING = PROMPTS / "onboarding-system.md"
PLAY = PROMPTS / "host-system-play.md"
LEGACY = PROMPTS / "host-system.md"

BEGIN = "<!-- CONSTITUTION:BEGIN -->"
END = "<!-- CONSTITUTION:END -->"


def _constitution(text: str) -> str:
    start = text.index(BEGIN) + len(BEGIN)
    stop = text.index(END)
    return text[start:stop]


def test_the_constitution_has_exactly_one_carrier() -> None:
    """It used to be pinned byte-identical across the setup and play prompts.

    With the setup prompt retired there is one carrier left, and the invariant
    that matters becomes stronger: exactly one prompt holds the block, so it
    cannot drift between copies because there are none to drift.
    """
    carriers = [
        path.name for path in sorted(PROMPTS.glob("*.md"))
        if BEGIN in path.read_text(encoding="utf-8")
    ]
    assert carriers == ["host-system-play.md"], carriers
    play = PLAY.read_text(encoding="utf-8")
    assert END in play and _constitution(play).strip()


def test_onboarding_prompt_does_not_carry_the_play_constitution() -> None:
    """Onboarding has none of the surface that constitution describes.

    The shared block is 23k characters about the table: the skill set, the
    path-restricted `read`, the COC tool surface. The onboarding session loads
    one extension and a seven-row step table and has none of it, so pasting the
    constitution in would name tools that session does not carry -- the exact
    defect the step table exists to make unrepresentable.

    It carries its own red lines instead, and those are what this pins.
    """
    onboarding = ONBOARDING.read_text(encoding="utf-8")
    assert BEGIN not in onboarding
    # Its own three, in the player's language.
    assert "不要编造模组内容" in onboarding
    assert "不要向玩家提问任何数值" in onboarding
    assert "不要开场叙事" in onboarding
    # Sequencing lives in the step table and is never restated here: no step
    # order, no step count, no progress bar. (A tool name may appear inside an
    # instruction telling the Keeper not to say it to the player.)
    assert "第一步" not in onboarding
    assert "共 8 步" not in onboarding
    assert "共 7 步" not in onboarding


def test_play_prompt_is_play_only() -> None:
    play = PLAY.read_text(encoding="utf-8")
    assert "ready_for_table" in play
    assert "table_opening" in play
    assert "setup.complete" not in play
    assert "A source-supported year does not authorize inventing" in play


def test_role_prompts_name_the_typed_surface_not_hidden_domain_wrappers() -> None:
    play = PLAY.read_text(encoding="utf-8")
    for prompt in (play,):
        constitution = _constitution(prompt)
        assert "operation-specific typed tools" in constitution
        assert "`coc_session_resume`" in constitution
        assert "`coc_evidence_table_opening`" in constitution
        assert "those\n  wrapper names are not callable in this role" in constitution
        assert "Use the closed domain tools" not in constitution
    assert "visible `coc_session_resume` tool" in play
    assert "`coc_evidence_table_opening` for canonical operation" in play


def test_play_prompt_has_open_turn_recovery_acting_then_closure_guidance() -> None:
    play = PLAY.read_text(encoding="utf-8")
    assert "open_turn_recovery" in play
    assert "continue_current_turn_from_receipts" in play
    assert "turn.output_context" in play
    assert "state.journal" in play
    assert "turn.finalize" in play
    assert "state.move_scene" in play
    recovery = play.split("## Open-turn recovery", 1)[1]
    acting = recovery.index("`scene.context` / `actions.list`")
    journal = recovery.index("`state.journal`")
    output = recovery.index("`turn.output_context`")
    review = recovery.index("`narration.review`")
    finalize = recovery.index("`turn.finalize`")
    assert acting < journal < output < review < finalize
    assert "settle only missing mechanics before journaling" in recovery
    assert "no new `rules.*` rolls" not in recovery
    assert "turn.output_context` — required closures" not in recovery
    assert "current_acl_supersedes_prior_denials" not in play
    assert "open_turn_recovery" not in _constitution(play)


def test_play_prompt_has_contract_driven_single_draft_finalize_guidance() -> None:
    play = " ".join(PLAY.read_text(encoding="utf-8").split())
    assert "`agency_review_required=false`" in play
    assert "`turn.output_context.contract_projection.agency_review_required=true`" in play
    assert "player-facing narration is still required" in play
    assert "treat that first draft as final" in play
    assert "Do **not** call or discover `narration.review`" in play
    assert "returned `finalize_operation` exactly once" in play
    assert "no prose-review or revision loop" in play


def test_play_prompt_gives_the_exact_ending_closure_chain() -> None:
    play = PLAY.read_text(encoding="utf-8")
    # 3d8125ea: state.end_session is host-private since the ten-family
    # cutover, so the ending is settled as the development end-session card.
    assert "`decision:coc7:development:end-session` card" in play
    assert "`development`, then `rules.settle`) → `state.journal` →" in play
    assert "`turn.output_context` → `turn.finalize`" in play
    assert "`turn.finalize` directly after that settlement" in play
    assert "state.end_session" not in play


def test_play_prompt_item_handoff_requires_grant_before_prose() -> None:
    play = PLAY.read_text(encoding="utf-8")
    assert "coc_state_item_grant" in play
    assert "**before prose**" in play
    assert "One grant per item, unique `decision_id` each" in play
    assert "coc_state_item_grant" not in _constitution(play)


def test_play_prompt_clue_discover_requires_record_before_prose() -> None:
    play = PLAY.read_text(encoding="utf-8")
    assert "coc_state_record_clue" in play
    assert "state.record_clue" in play
    assert "One write per" in play
    assert "`clue_id`" in play
    assert "coc_state_record_clue" not in _constitution(play)


def test_play_discovery_exception_cannot_drift_from_constitution_ban() -> None:
    """The shared constitution bans discovery on the ordinary live KP path;
    the play body must keep teaching the single exact-operation exception
    together with the no-argument / whole-domain prohibition, so removing
    either half fails here."""
    play = PLAY.read_text(encoding="utf-8")
    constitution = _constitution(play)
    assert (
        "do not call `coc_invoke`, `coc_discover`, or `coc_capabilities` on the ordinary live kp path"
        in " ".join(constitution.split()).lower()
    )
    body = play.replace(constitution, "")
    compact_body = " ".join(body.split()).lower()
    assert '{"operation":"memory.recall"}' in compact_body
    assert "never call `coc_discover` with no arguments" in compact_body
    assert "never discover a whole domain/namespace" in compact_body
    # The long-tail temporal/transcript exception is play-only guidance, and it
    # must not leak into the onboarding prompt: that session carries none of
    # those tools, and naming a tool the session lacks is the defect the step
    # table exists to prevent.
    onboarding = ONBOARDING.read_text(encoding="utf-8")
    for marker in (
        '"operation":"memory.recall"',
        "coc_memory_extraction_status",
        "coc_transcript_locate",
        "coc_discover",
    ):
        assert marker not in onboarding, marker


def test_host_prompts_and_role_manifest_align_on_restricted_skill_doc_read() -> None:
    """Both Pi host prompts must state the read boundary accurately and the
    role manifest must keep the restricted `read` active (Pi's native skill
    progressive disclosure addresses the `read` tool). Play is the only role
    left; onboarding has no skill surface and no `read` at all."""
    legacy = LEGACY.read_text(encoding="utf-8")
    play = PLAY.read_text(encoding="utf-8")
    restricted = (
        "The one `read` tool in your list is path-restricted to this session's "
        "canonical COC skill/reference documentation"
    )
    for name, text in (("legacy", legacy), ("play", play)):
        assert restricted in text, name
        # The old blanket ban is gone; unrestricted filesystem read stays denied.
        assert "Built-in read/bash/edit/write tools are disabled" not in text, name
        assert "Unrestricted filesystem tools are disabled" in text, name
    manifest = json.loads(
        (REPO_ROOT / "plugins" / "coc-keeper" / "pi" / "session-roles.json")
        .read_text(encoding="utf-8")
    )
    assert "setup" not in manifest, "the setup half of the manifest is retired"
    assert "read" in manifest["play"]["tools"]
