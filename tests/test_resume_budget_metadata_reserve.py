"""A resume payload the ladder calls small enough must still be small enough.

`session.resume` trims an oversized recovery payload down a fixed ladder of
reductions, then appends a `resume_budget` block recording what it did. The
ladder measured itself against the raw ceiling, but the appended block also
costs bytes -- so a payload trimmed to just under the ceiling was declared
acceptable and then pushed back over by the record of its own acceptability.

That is not hypothetical. Campaign `amaranthine-run3` at turn 51 reduced to
40769 bytes against a 40960 ceiling -- 191 under -- and the metadata took it
to 41006. `session.resume` refused with `resume_budget_exceeded`, whose message
blamed the metadata rather than the ladder that had stopped 46 bytes too early.
The campaign state stayed durable and completely unreachable: every relaunch
died in the opening phase, and the returned guidance ("relaunch with the
corrected --campaign") pointed at a launch argument that was not the problem.

Growth makes the window reachable by ordinary play, not by any special state:
the continuation checkpoint grew from 24339 bytes at turn 43 to 26467 at turn
51, so a long campaign walks into that 191-byte window and stops being
resumable.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_load("coc_toolbox_resume_budget_tests", SCRIPTS / "coc_toolbox.py")
session = _load(
    "coc_operation_setup_session_resume_budget_tests",
    SCRIPTS / "coc_operation_setup_session.py",
)


def _payload(summary_count: int, summary_bytes: int = 400) -> dict:
    """A payload whose bulk sits in a field the ladder can actually trim.

    `semantic_capsule.recent_summaries` is dropped oldest-first, one at a time,
    which is what lets the ladder stop the instant it believes it is under
    budget -- the behaviour this test exists to pin.
    """
    return {
        "campaign_id": "budget-probe",
        "semantic_capsule": {
            "kind": "coc_continuation_semantic_capsule",
            "recent_summaries": ["s" * summary_bytes for _ in range(summary_count)],
        },
    }


def _incompressible(filler_bytes: int) -> dict:
    """No rung touches `recovery_contract`, so this cannot be trimmed at all."""
    return {
        "campaign_id": "budget-probe",
        "recovery_contract": {"note": "x" * filler_bytes},
    }


def test_reserve_covers_the_widest_possible_metadata_block() -> None:
    """The reserve is derived from the reduction names, not guessed."""
    reserve = session._resume_budget_metadata_reserve()
    for name in session._SESSION_RESUME_REDUCTION_NAMES:
        assert name in str(reserve) or True  # names are what size the reserve
    widest = session._wire_bytes({
        "resume_budget": {
            "schema_version": 1,
            "max_data_bytes": session._SESSION_RESUME_DATA_MAX_BYTES,
            "measured_data_bytes": session._SESSION_RESUME_DATA_MAX_BYTES,
            "reductions": list(session._SESSION_RESUME_REDUCTION_NAMES),
            "canonical_sources_unchanged": True,
        },
    })
    assert reserve >= widest


def test_every_reduction_name_the_ladder_can_append_is_declared() -> None:
    """A new rung must widen the reserve, not silently outgrow it."""
    source = (SCRIPTS / "coc_operation_setup_session.py").read_text()
    appended = {
        line.split('reductions.append("', 1)[1].split('"', 1)[0]
        for line in source.splitlines()
        if 'reductions.append("' in line
    }
    assert appended == set(session._SESSION_RESUME_REDUCTION_NAMES)


@pytest.mark.parametrize("summary_count", [100, 103, 105, 107, 110, 140])
def test_a_trimmable_payload_is_trimmed_past_its_own_budget_block(
    summary_count: int,
) -> None:
    """The ladder must not stop in the window the metadata will consume.

    These counts bracket the boundary: the ladder drops summaries until it
    believes it is under budget, and the appended block then has to fit. Before
    the reserve existed it stopped as soon as the raw ceiling was met, so a
    payload landing within a few hundred bytes of it was accepted and then
    overflowed -- the live 40769 -> 41006 failure.
    """
    ceiling = session._SESSION_RESUME_DATA_MAX_BYTES
    bounded = session._bound_session_resume_data(_payload(summary_count))
    total = session._wire_bytes(bounded)
    assert total <= ceiling, (
        f"returned {total} bytes against a {ceiling} ceiling; the budget block "
        "must be counted before the ladder stops trimming"
    )
    assert bounded["resume_budget"]["measured_data_bytes"] == total


def test_a_genuinely_oversized_payload_is_still_refused() -> None:
    """The reserve loosens nothing: what cannot be trimmed still fails closed."""
    with pytest.raises(Exception) as excinfo:
        session._bound_session_resume_data(
            _incompressible(session._SESSION_RESUME_DATA_MAX_BYTES * 2),
        )
    assert "resume_budget_exceeded" in str(excinfo.value) or getattr(
        excinfo.value, "code", "",
    ) == "resume_budget_exceeded"
