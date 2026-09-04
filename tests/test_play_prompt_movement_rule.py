"""The play prompt must require the operation that moves the party.

Measured across one live playthrough: of 24 Keeper turns with tool activity,
eleven never loaded scene context, and in two consecutive turns the Keeper
narrated walking into another scene -- "你走到圆屋门口，推门进去" -- while
`active_scene_id` stayed where it was. The turn finalized clean. Fiction moved,
state did not, and every later scene context, clue availability and NPC
presence answered for the old scene.

Nothing can catch that afterwards without judging what the prose means, which
this repository forbids hardcoding. So the rule belongs in the prompt, stated
once and plainly, next to the other state-mutation rules.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROLES = ROOT / "plugins" / "coc-keeper" / "pi" / "session-roles.json"


def _play_prompt() -> Path:
    roles = json.loads(ROLES.read_text(encoding="utf-8"))
    prompts = set()

    def walk(node):
        if isinstance(node, dict):
            value = node.get("prompt")
            if isinstance(value, str) and value.endswith(".md"):
                prompts.add(value)
            for item in node.values():
                walk(item)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(roles)
    play = [p for p in prompts if "play" in p]
    assert play, f"no play-role prompt in session-roles.json: {sorted(prompts)}"
    return ROOT / sorted(play)[0]


def test_the_play_prompt_requires_state_move_scene_when_the_fiction_moves():
    text = _play_prompt().read_text(encoding="utf-8")
    assert "state.move_scene" in text
    # Not merely mentioned in passing: the prompt names the consequence, which
    # is what a Keeper needs in order to care.
    rule = [
        line for line in text.splitlines()
        if "state.move_scene" in line and ("叙述" in line or "narrat" in line.lower())
    ]
    assert rule, (
        "the prompt mentions state.move_scene but never says that narrating a "
        "move obliges calling it; the Keeper narrated arrivals that never "
        "happened and the turn finalized clean"
    )


def test_the_rule_also_covers_time():
    """The same divergence, one axis over: a night that passes in prose only."""
    text = _play_prompt().read_text(encoding="utf-8")
    assert "state.advance_time" in text


def test_the_play_prompt_says_played_history_outranks_the_default_script():
    """A scene card describes what happens if nobody intervenes.

    Found by playing: the player rolled STR 30/50 and pulled the king out of
    the river alive; two turns later the Keeper entered the authored
    「国王遇刺」scene and recited its summary — "the guards were too late, the
    body was carried ashore" — killing a living king and erasing the roll that
    saved him. Nothing in the prompt said which one wins.
    """
    text = _play_prompt().read_text(encoding="utf-8")
    assert "player_safe_summary" in text, (
        "the prompt never mentions the field the Keeper recites from"
    )
    rule = [
        line for line in text.splitlines()
        if "默认" in line and ("事实" in line or "玩出来" in line)
    ]
    assert rule, (
        "the prompt does not say that played history outranks the module's "
        "default script"
    )
