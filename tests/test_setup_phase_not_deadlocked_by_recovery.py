"""A setup that has not finished must never read as `recovery`.

`recovery` describes an unclosed PLAY turn, and every operation that answers it
is a play operation. A setup that has not finished has none of them, so
resolving the phase to `recovery` while a campaign is still in setup leaves no
legal move at all:

  setup.complete              -> phase_forbidden   (cold_start/opening/live_turn)
  progressive.prepare_opening -> phase_forbidden   (opening)
  state.journal               -> role_forbidden    (role: setup)
  turn.output_context         -> role_forbidden
  scene.context               -> role_forbidden

Seen live on 2026-09-02 in a fresh campaign: chargen failed on an unrecognized
occupation skill, the turn never closed, the startup resume gate went pending,
and the phase read `recovery` from then on. The Keeper tried six operations,
found no way forward, and the table could never open -- a hard, unrecoverable
block on the one path a new campaign must take.

`setup.complete` already carried a comment about a neighbouring case: it lists
`live_turn` because "session.resume can advance the host phase before handoff;
setup.complete must still be legal". That was the same trap answered by adding
one more phase to one operation. The ordering fix answers it at the source: an
active opening setup decides the phase before a pending startup resume does.
"""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
EXTENSION = ROOT / "plugins" / "coc-keeper" / "pi" / "extensions" / "index.ts"
sys.path.insert(0, str(SCRIPTS))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_load("coc_toolbox_setup_phase_tests", SCRIPTS / "coc_toolbox.py")
policy = _load("coc_operation_policy_setup_phase_tests", SCRIPTS / "coc_operation_policy.py")


def _table() -> dict:
    for attr in dir(policy):
        value = getattr(policy, attr)
        if isinstance(value, dict) and "setup.complete" in value:
            return value
    raise AssertionError("operation policy table not found")


def test_an_active_opening_setup_outranks_a_pending_resume() -> None:
    source = EXTENSION.read_text(encoding="utf-8")
    start = source.index("const resolveAclPhase")
    body = source[start:start + 1800]
    opening = body.index("hasActiveOpeningSetupFor")
    pending = body.index('startupResumeGate.phase === "pending"')
    assert opening < pending, (
        "the opening-setup branches must be reached before the resume gate "
        "returns `recovery`; ordering them the other way leaves a setup-role "
        "session with no legal operation at all"
    )


def test_the_operations_a_stuck_setup_needs_are_opening_legal() -> None:
    """The fix works only because these are legal in `opening`."""
    table = _table()
    for operation in ("setup.complete", "progressive.prepare_opening"):
        phases = table[operation].get("phases") or ()
        assert "opening" in phases, (operation, phases)


def test_recovery_still_answers_an_unclosed_play_turn() -> None:
    """Nothing is loosened: session.resume remains legal in recovery."""
    table = _table()
    assert "recovery" in (table["session.resume"].get("phases") or ())
