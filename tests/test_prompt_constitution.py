from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PROMPTS = REPO_ROOT / "plugins" / "coc-keeper" / "pi" / "prompts"
SETUP = PROMPTS / "host-system-setup.md"
PLAY = PROMPTS / "host-system-play.md"
LEGACY = PROMPTS / "host-system.md"

BEGIN = "<!-- CONSTITUTION:BEGIN -->"
END = "<!-- CONSTITUTION:END -->"


def _constitution(text: str) -> str:
    start = text.index(BEGIN) + len(BEGIN)
    stop = text.index(END)
    return text[start:stop]


def test_constitution_blocks_are_byte_identical() -> None:
    setup = SETUP.read_text(encoding="utf-8")
    play = PLAY.read_text(encoding="utf-8")
    assert BEGIN in setup and END in setup
    assert BEGIN in play and END in play
    assert _constitution(setup) == _constitution(play)


def test_setup_prompt_is_setup_only() -> None:
    setup = SETUP.read_text(encoding="utf-8")
    assert "setup.complete" in setup
    assert "turn.finalize" not in setup


def test_play_prompt_is_play_only() -> None:
    play = PLAY.read_text(encoding="utf-8")
    assert "ready_for_table" in play
    assert "table_opening" in play
    assert "setup.complete" not in play
    assert "A source-supported year does not authorize inventing" in play


def test_setup_prompt_uses_quick_start_as_first_builtin_mutation() -> None:
    setup = SETUP.read_text(encoding="utf-8")
    assert "Built-in starter, one mutation" in setup
    assert "setup.quick_start` as the **first mutation**" in setup
    assert "Do **not** call\n    `setup.inspect` first on a fresh selected id" in setup
    assert "do **not** call `campaign.create` first" in setup
    assert "Custom / raw-PDF campaign, 1 → 2 → 3" in setup
    assert "A campaign with no `active_scenario_id` is not ready" in setup
    assert "After `setup.inspect`" not in setup
    main = (
        REPO_ROOT / "plugins" / "coc-keeper" / "skills" / "coc-main" / "SKILL.md"
    ).read_text(encoding="utf-8")
    assert "selector only" in main
    assert '"campaign_id":"<selected-or-new-id>"' in main
    assert "do not `campaign.create` first" in main
    assert "do not require\n   > `setup.inspect` first" in main


def test_setup_prompt_preserves_source_time_precision() -> None:
    setup = SETUP.read_text(encoding="utf-8")
    assert "A source-supported year does not authorize inventing" in setup


def test_role_prompts_name_the_typed_surface_not_hidden_domain_wrappers() -> None:
    setup = SETUP.read_text(encoding="utf-8")
    play = PLAY.read_text(encoding="utf-8")
    for prompt in (setup, play):
        constitution = _constitution(prompt)
        assert "operation-specific typed tools" in constitution
        assert "`coc_session_resume`" in constitution
        assert "`coc_evidence_table_opening`" in constitution
        assert "those\n  wrapper names are not callable in this role" in constitution
        assert "Use the closed domain tools" not in constitution
    assert "visible `coc_session_resume` tool" in play
    assert "`coc_evidence_table_opening` for canonical operation" in play


def test_play_prompt_has_open_turn_recovery_closure_guidance() -> None:
    play = PLAY.read_text(encoding="utf-8")
    setup = SETUP.read_text(encoding="utf-8")
    assert "open_turn_recovery" in play
    assert "continue_current_turn_from_receipts" in play
    assert "turn.output_context" in play
    assert "state.journal" in play
    assert "turn.finalize" in play
    assert "state.move_scene" in play
    assert "current_acl_supersedes_prior_denials" not in play
    assert "open_turn_recovery" not in _constitution(play)
    assert "open_turn_recovery" not in setup


def test_play_prompt_gives_the_exact_ending_closure_chain() -> None:
    play = PLAY.read_text(encoding="utf-8")
    assert "state.end_session` → `state.journal` → `turn.output_context` → `turn.finalize" in play
    assert "Never call `turn.finalize` directly after `state.end_session`" in play


def test_setup_guided_chargen_forbids_first_turn_delegate() -> None:
    setup = SETUP.read_text(encoding="utf-8")
    assert "Default guided character path" in setup
    assert "Do not treat the first" in setup
    assert "name+occupation" in setup
    assert "never\n  call `coc_chargen_delegate`" in setup or (
        "never call `coc_chargen_delegate`" in setup
    )
    assert "explicitly asked for a quick/auto/direct card" in setup
    assert "no dry-run" in setup
    assert "inv-investigator" in setup
    assert "Call the delegate at most once per player turn" in setup
    assert "Do **not** call" in setup and "setup.complete" in setup
    assert "high-to-low" in setup
    assert "current written sheet" in setup
    assert "same `investigator_id`" in setup
    assert "Revision is setup-only" in setup
    assert "Do not ask the player to add" in setup
    play = PLAY.read_text(encoding="utf-8")
    assert "coc_chargen_delegate" not in _constitution(setup)
    assert "coc_chargen_delegate" not in _constitution(play)


def test_play_prompt_item_handoff_requires_grant_before_prose() -> None:
    play = PLAY.read_text(encoding="utf-8")
    setup = SETUP.read_text(encoding="utf-8")
    assert "coc_state_item_grant" in play
    assert "**before prose**" in play
    assert "One grant per item, unique `decision_id` each" in play
    assert "coc_state_item_grant" not in setup
    assert "coc_state_item_grant" not in _constitution(play)


def test_play_prompt_clue_discover_requires_record_before_prose() -> None:
    play = PLAY.read_text(encoding="utf-8")
    setup = SETUP.read_text(encoding="utf-8")
    assert "coc_state_record_clue" in play
    assert "state.record_clue" in play
    assert "One write per" in play
    assert "`clue_id`" in play
    assert "coc_state_record_clue" not in setup
    assert "coc_state_record_clue" not in _constitution(play)


def test_legacy_host_system_md_unmodified() -> None:
    import subprocess

    result = subprocess.run(
        ["git", "diff", "--", str(LEGACY.relative_to(REPO_ROOT))],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""
