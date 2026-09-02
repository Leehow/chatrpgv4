"""A thinking level the provider ignores must not look like it was applied.

The preflight already refuses a level the model's catalog does not support.
It did not catch the quieter case: a reasoning model whose provider takes no
effort parameter accepts every level and then ignores it.

Measured 2026-09-02 on zai-coding-cn, same lane and same 180 s budget:

    glm-5.3 + low   26,818 thinking chars   2 tool calls
    glm-5.2 + low   26,977 thinking chars   5 tool calls
    glm-5.2 + off    4,076 thinking chars  13 tool calls

Pi's zai format sends `thinking: {type: "enabled"}` for ANY non-null effort
and `{type: "disabled"}` only for off, so `--thinking low` bought nothing
while looking exactly like a saving.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PREFLIGHT = ROOT / "plugins/coc-keeper/pi/bin/pi-coc-thinking-preflight.mjs"


@pytest.fixture
def agent_home(tmp_path: Path) -> Path:
    home = tmp_path / "agent-home"
    home.mkdir()
    (home / "settings.json").write_text("{}\n", encoding="utf-8")
    (home / "models-store.json").write_text(
        json.dumps({
            "probe": {
                    "models": [
                        {
                            "id": "ignores-effort",
                            "name": "Ignores Effort",
                            "provider": "probe",
                            "reasoning": True,
                            "compat": {
                                "thinkingFormat": "zai",
                                "supportsReasoningEffort": False,
                            },
                        },
                        {
                            "id": "honours-effort",
                            "name": "Honours Effort",
                            "provider": "probe",
                            "reasoning": True,
                            "compat": {
                                "thinkingFormat": "zai",
                                "supportsReasoningEffort": True,
                            },
                        },
                ],
            },
        }),
        encoding="utf-8",
    )
    return home


def _preflight(home: Path, model: str, thinking: str):
    return subprocess.run(
        [
            "node", str(PREFLIGHT), str(home),
            "--provider", "probe", "--model", model, "--thinking", thinking,
        ],
        capture_output=True, text=True,
    )


def test_an_ignored_effort_level_fails_instead_of_looking_applied(agent_home):
    result = _preflight(agent_home, "ignores-effort", "low")
    assert result.returncode != 0
    message = result.stdout + result.stderr
    assert "takes no reasoning-effort parameter" in message
    assert "--thinking off" in message, "the message must name the real remedy"


def test_off_is_the_one_level_that_does_something_there(agent_home):
    """off is exactly the level that maps to the provider's disable parameter,
    so it must stay available on a model that ignores every other level."""
    assert _preflight(agent_home, "ignores-effort", "off").returncode == 0


def test_a_model_that_honours_effort_is_untouched(agent_home):
    for level in ("off", "low"):
        assert _preflight(agent_home, "honours-effort", level).returncode == 0
