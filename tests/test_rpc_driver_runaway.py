"""A Keeper turn that loops instead of playing must fail fast, not time out.

Found by playing: glm-5.2 twice collapsed into repeating one sentence --
184,467 and 190,150 characters, zero tool calls -- and the driver waited out
its whole 900-second budget before reporting `not_settled` with no text. Two of
four turns on that model. A playtest cannot run unattended when a dead turn
costs fifteen minutes and looks like slowness.

Detection is lexical: how much text, how many tool calls, and whether the tail
is one short string repeated. It makes no judgement about what the text says.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location(
        "rpc_driver_runaway_tests", ROOT / "tests" / "pi" / "_lib" / "rpc-driver.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["rpc_driver_runaway_tests"] = module
    spec.loader.exec_module(module)
    return module


driver = _load()


def _text_rows(text: str) -> list[dict]:
    return [{"assistantMessageEvent": {"type": "text_delta", "delta": text}}]


def test_a_repeating_toolless_turn_is_reported():
    rows = _text_rows("我在脑海中决定：进入谈判场景，然后写下并结束这一回合。" * 800)
    found = driver._runaway_generation(rows)
    assert found is not None
    assert found["tool_calls"] == 0
    assert "进入谈判场景" in found["repeated_unit"]


def test_tool_calls_do_not_excuse_a_repeating_turn():
    """The first cut of this check required zero tools and missed the next case.

    A live turn called three tools, then emitted 107,418 characters of
    "鉴于已经做出了让bp。" repeated. Having done some real work earlier does not
    make a collapsed turn recoverable.
    """
    rows = _text_rows("鉴于已经做出了让bp。" * 6000)
    rows.append({"type": "tool_execution_start", "toolName": "coc_scene_context"})
    rows.append({"type": "tool_execution_start", "toolName": "coc_actions_list"})
    found = driver._runaway_generation(rows)
    assert found is not None, "a repeating turn passed because it had called tools"
    assert found["tool_calls"] == 2, "the tool count is reported, not a gate"


def test_a_collapse_that_drifts_instead_of_repeating_is_still_caught():
    """The two collapses failed differently, and one check caught only one.

    The first drifted into mangled half-sentences -- "就绪。就绪。" spliced with
    English fragments -- with no stable repeating unit at the tail, so a
    periodicity check passed it while it burned the whole budget. Volume is
    the decision; repetition only names what went wrong when it is there.
    """
    rows = _text_rows("".join(f"第{i}段崩坏的碎句，THE CALL — final attempt。" for i in range(2000)))
    found = driver._runaway_generation(rows)
    assert found is not None
    assert found["kind"] == "runaway_volume"
    assert found["repeated_unit"] is None


def test_the_threshold_sits_well_above_a_real_turn():
    """Nine healthy turns on this campaign ran 188 to 975 characters."""
    assert driver.RUNAWAY_MIN_CHARS >= 20 * 975


def test_a_normal_turn_is_not_a_runaway():
    rows = _text_rows("你举着空碗站起身，向主位朗声道：规矩既然讲过了。")
    assert driver._runaway_generation(rows) is None


def test_the_runaway_exit_code_is_distinct():
    """A resend-able failure must not be confused with a handoff or a death."""
    assert driver.RUNAWAY_EXIT_CODE not in {
        0, 3, 4, 5, driver.UNCLAIMED_HANDOFF_EXIT_CODE,
    }
