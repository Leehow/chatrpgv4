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
