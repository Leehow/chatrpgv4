"""Contract tests for the advisory tool-loop guardrail (coc_toolbox.py).

The guardrail is warning-first and never blocking: after two consecutive
identical same-call audit rows (tool + canonical args digest, excluding
``seed``) inside the current pacing turn, the next identical call's envelope
carries one ``[tool-loop]`` warning. Idempotent pending-turn replays neither
count nor break the run. Covers:

- silence on 1st/2nd call, warning from the 3rd consecutive identical call;
- warning persists on the 4th consecutive call;
- turn-boundary reset (per-turn counting restarts);
- different args / different tool never misfire;
- ``idempotent_replay=True`` rows are not counted;
- internal transient-retry rows (``attempt > 1``) are deduped, not counted;
- corrupt audit lines are continuity barriers: they never stitch a run
  across themselves and can only cause undercounting;
- boundary degradation: missing log, no campaign, unreadable pacing all
  yield no warning and no exception;
- the normal beat (different tools interleaved in one turn) never warns.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
TOOLBOX_SCRIPT = SCRIPTS / "coc_toolbox.py"


def _load(name: str, rel: str | Path):
    path = Path(rel)
    if not path.is_absolute():
        path = REPO / path
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_loop_guard_under_test", TOOLBOX_SCRIPT)
coc_starter = _load("coc_starter_for_loop_guard", SCRIPTS / "coc_starter.py")


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


@pytest.fixture
def campaign_ws(tmp_path: Path):
    """Fresh workspace with a the-haunting / thomas-hayes quick-start campaign."""
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "toolbox-loop-guard-test"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Toolbox Loop Guard Test",
    )
    campaign_dir = Path(quick["campaign_dir"])
    return {
        "workspace": workspace,
        "coc_root": coc_root,
        "campaign_id": campaign_id,
        "campaign_dir": campaign_dir,
        "investigator_id": quick["investigator_id"],
        "quick": quick,
    }


# --------------------------------------------------------------------------- #
# Log-row helpers (unit-level: drive _loop_guard_warning directly)
# --------------------------------------------------------------------------- #


def _log_path(ws: dict) -> Path:
    return ws["campaign_dir"] / "logs" / "toolbox-calls.jsonl"


def _append_rows(ws: dict, rows: list[dict]) -> None:
    path = _log_path(ws)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _write_rows(ws: dict, rows: list[dict]) -> None:
    """Overwrite the audit log with exactly these rows (raw lines allowed)."""
    path = _log_path(ws)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(
            (
                row if isinstance(row, str) else json.dumps(row, ensure_ascii=False)
            ) + "\n"
            for row in rows
        ),
        encoding="utf-8",
    )


def _audit_row(
    *,
    tool: str,
    args: dict,
    turn: int,
    attempt: int = 1,
    idempotent_replay: bool = False,
) -> dict:
    """One toolbox-calls.jsonl row shaped like `_log_tool_call` writes it."""
    row: dict = {
        "schema_version": 2,
        "ts": "2026-01-01T00:00:00+00:00",
        "tool": tool,
        "ok": True,
        "access": "query",
        "args": {k: v for k, v in args.items() if k != "seed"},
        "data": None,
        "visibility": "keeper_internal",
        "warnings": [],
        "hints": [],
        "attempt": attempt,
        "max_attempts": max(1, attempt),
        "retryable": False,
        "will_retry": False,
        "turn_number": turn,
    }
    if idempotent_replay:
        row["idempotent_replay"] = True
    return row


def _same_rows(
    ws: dict, *, tool: str, args: dict, count: int, turn: int | None = None,
) -> list[dict]:
    if turn is None:
        turn = _current_turn(ws)
    return [
        _audit_row(tool=tool, args=args, turn=turn) for _ in range(count)
    ]


def _current_turn(ws: dict) -> int:
    ctx = coc_toolbox.Ctx(ws["workspace"], ws["campaign_id"])
    return int(ctx.pacing()["turn_number"])


def _bump_turn(ws: dict) -> int:
    path = ws["campaign_dir"] / "save" / "pacing-state.json"
    pacing = json.loads(path.read_text(encoding="utf-8"))
    pacing["turn_number"] = int(pacing["turn_number"]) + 1
    _write_json(path, pacing)
    return int(pacing["turn_number"])


def _probe(ws: dict, tool: str, args: dict | None = None) -> str | None:
    ctx = coc_toolbox.Ctx(ws["workspace"], ws["campaign_id"])
    return coc_toolbox._loop_guard_warning(ctx, tool, dict(args or {}))


# --------------------------------------------------------------------------- #
# Detection semantics
# --------------------------------------------------------------------------- #


def test_first_two_calls_silent_third_consecutive_warns(campaign_ws):
    ws = campaign_ws
    args = {"scene_id": ""}
    # Call 1: empty audit log.
    assert _probe(ws, "scene.context", args) is None
    # Call 2: one prior identical row.
    _append_rows(ws, _same_rows(ws, tool="scene.context", args=args, count=1))
    assert _probe(ws, "scene.context", args) is None
    # Call 3: two prior identical rows -> the guardrail speaks.
    _append_rows(ws, _same_rows(ws, tool="scene.context", args=args, count=1))
    warning = _probe(ws, "scene.context", args)
    assert warning is not None
    assert "[tool-loop]" in warning
    assert "same-call scene.context x3" in warning
    assert f"within turn {_current_turn(ws)}" in warning


def test_fourth_consecutive_call_still_warns(campaign_ws):
    ws = campaign_ws
    args = {"scene_id": ""}
    _append_rows(ws, _same_rows(ws, tool="scene.context", args=args, count=3))
    warning = _probe(ws, "scene.context", args)
    assert warning is not None
    assert "[tool-loop]" in warning
    assert "same-call scene.context x4" in warning


def test_turn_boundary_resets_the_count(campaign_ws):
    ws = campaign_ws
    args = {"scene_id": ""}
    first_turn = _current_turn(ws)
    # Two identical rows already, then the turn advances.
    _append_rows(ws, _same_rows(ws, tool="scene.context", args=args, count=2))
    next_turn = _bump_turn(ws)
    assert next_turn == first_turn + 1
    # First identical call in the new turn: silent (old-turn rows don't count).
    assert _probe(ws, "scene.context", args) is None
    # Second identical call in the new turn: still silent.
    _append_rows(
        ws,
        _same_rows(ws, tool="scene.context", args=args, count=1, turn=next_turn),
    )
    assert _probe(ws, "scene.context", args) is None
    # Third identical call in the new turn: the per-turn count fires again.
    _append_rows(
        ws,
        _same_rows(ws, tool="scene.context", args=args, count=1, turn=next_turn),
    )
    warning = _probe(ws, "scene.context", args)
    assert warning is not None
    assert f"within turn {next_turn}" in warning


def test_changed_args_never_misfire(campaign_ws):
    ws = campaign_ws
    first_args = {"investigator": "thomas-hayes"}
    changed_args = {"investigator": "eleanor-reed"}
    _append_rows(
        ws, _same_rows(ws, tool="npc.query", args=first_args, count=2)
    )
    assert _probe(ws, "npc.query", changed_args) is None
    # A changed arg also breaks the run for the original args.
    _append_rows(
        ws, _same_rows(ws, tool="npc.query", args=changed_args, count=1)
    )
    assert _probe(ws, "npc.query", first_args) is None


def test_different_tool_never_misfire(campaign_ws):
    ws = campaign_ws
    args = {"scene_id": ""}
    _append_rows(ws, _same_rows(ws, tool="scene.context", args=args, count=3))
    assert _probe(ws, "scene.map", args) is None
    # An interleaved different tool breaks the consecutive run.
    _append_rows(ws, [_audit_row(tool="scene.map", args={}, turn=_current_turn(ws))])
    assert _probe(ws, "scene.context", args) is None


def test_idempotent_replay_rows_are_not_counted(campaign_ws):
    ws = campaign_ws
    args = {"decision_id": "repair-only"}
    # Pure pending-turn exact replays: repair, not a loop.
    _append_rows(
        ws,
        [
            _audit_row(
                tool="state.record_clue", args=args, turn=_current_turn(ws),
                idempotent_replay=True,
            )
            for _ in range(3)
        ],
    )
    assert _probe(ws, "state.record_clue", args) is None
    # A replay between identical calls neither counts nor breaks the run.
    _append_rows(
        ws,
        [
            _audit_row(
                tool="state.record_clue", args=args, turn=_current_turn(ws),
            ),
            _audit_row(
                tool="state.record_clue", args=args,
                turn=_current_turn(ws), idempotent_replay=True,
            ),
            _audit_row(
                tool="state.record_clue", args=args, turn=_current_turn(ws),
            ),
        ],
    )
    warning = _probe(ws, "state.record_clue", args)
    assert warning is not None
    assert "[tool-loop]" in warning


# --------------------------------------------------------------------------- #
# Boundary degradation: broken inputs yield None, never exceptions
# --------------------------------------------------------------------------- #


def test_missing_log_file_yields_no_warning(campaign_ws):
    ws = campaign_ws
    assert not _log_path(ws).exists()
    assert _probe(ws, "scene.context", {}) is None


def test_transient_retry_rows_are_deduped_not_counted(campaign_ws):
    ws = campaign_ws
    args = {"scene_id": ""}
    turn = _current_turn(ws)

    def retry_row(attempt: int) -> dict:
        return _audit_row(
            tool="scene.context", args=args, turn=turn, attempt=attempt,
        )

    # One external call whose first attempt failed transiently and retried:
    # the probe is still only the 2nd external call -> silent.
    _write_rows(ws, [retry_row(1), retry_row(2)])
    assert _probe(ws, "scene.context", args) is None
    # Retry rows never inflate the count, no matter how many attempts.
    _write_rows(ws, [retry_row(1), retry_row(2), retry_row(3)])
    assert _probe(ws, "scene.context", args) is None
    # Two distinct external calls (the middle attempt=2 row belongs to the
    # first call): the probe is the 3rd call, not the 4th.
    _write_rows(ws, [retry_row(1), retry_row(2), retry_row(1)])
    warning = _probe(ws, "scene.context", args)
    assert warning is not None
    assert "same-call scene.context x3" in warning


def test_corrupt_line_breaks_the_run(campaign_ws):
    ws = campaign_ws
    args = {"scene_id": ""}
    good = _same_rows(
        ws, tool="scene.context", args=args, count=1,
    )[0]

    # good | corrupt | good: the corrupt line is a continuity barrier, so
    # nothing is stitched across it; the fresh run holds one row -> silent.
    _write_rows(ws, [good, "not json at all", good])
    assert _probe(ws, "scene.context", args) is None
    # good | corrupt | good | good: counting restarts after the barrier, so
    # the probe is the 3rd call of the new run and warns there.
    _write_rows(ws, [good, "not json at all", good, good])
    warning = _probe(ws, "scene.context", args)
    assert warning is not None
    assert "same-call scene.context x3" in warning
    # A partially flushed trailing line (concurrent append): degrade to no
    # warning, never an error.
    _write_rows(ws, [good, good, '{"truncated":'])
    assert _probe(ws, "scene.context", args) is None


def test_no_campaign_context_yields_no_warning(campaign_ws):
    ws = campaign_ws
    ctx_without_campaign = coc_toolbox.Ctx(ws["workspace"], None)
    assert ctx_without_campaign.campaign_dir is None
    assert (
        coc_toolbox._loop_guard_warning(ctx_without_campaign, "scene.context", {})
        is None
    )
    assert coc_toolbox._loop_guard_warning(None, "scene.context", {}) is None


def test_unreadable_pacing_degrades_to_no_warning(campaign_ws):
    ws = campaign_ws
    _append_rows(
        ws,
        _same_rows(ws, tool="scene.context", args={}, count=3),
    )
    pacing_path = ws["campaign_dir"] / "save" / "pacing-state.json"
    pacing_path.write_text("{corrupt", encoding="utf-8")
    assert _probe(ws, "scene.context", {}) is None


# --------------------------------------------------------------------------- #
# Integration: run_tool path
# --------------------------------------------------------------------------- #


def _run(ws: dict, tool: str, args: dict | None = None) -> dict:
    args = dict(args or {})
    if tool == "rules.roll":
        # Explicit neutral contract, like the shared toolbox test support.
        args.setdefault("difficulty", "regular")
        args.setdefault("goal", "settle the loop-guardrail test action")
        args.setdefault(
            "stakes",
            {
                "on_success": "the test action succeeds",
                "on_failure": "the test action does not succeed",
            },
        )
        args.setdefault("difficulty_basis", "keeper_judgment")
    return coc_toolbox.run_tool(
        tool,
        ws["workspace"],
        ws["campaign_id"],
        args,
    )


def _loop_warnings(envelope: dict) -> list[str]:
    return [
        warning
        for warning in (envelope.get("warnings") or [])
        if isinstance(warning, str) and "[tool-loop]" in warning
    ]


def test_run_tool_third_identical_call_carries_warning(campaign_ws):
    ws = campaign_ws
    first = _run(ws, "scene.context")
    assert first["ok"] is True, first
    assert _loop_warnings(first) == []
    second = _run(ws, "scene.context")
    assert second["ok"] is True, second
    assert _loop_warnings(second) == []
    third = _run(ws, "scene.context")
    assert third["ok"] is True, third
    loop_warnings = _loop_warnings(third)
    assert len(loop_warnings) == 1
    assert "same-call scene.context x3" in loop_warnings[0]
    assert third.get("ok") is True  # advisory only: ok/data untouched


def test_run_tool_normal_beat_never_warns(campaign_ws):
    ws = campaign_ws
    envelopes = [
        _run(ws, "scene.context"),
        _run(
            ws,
            "rules.roll",
            {
                "investigator": ws["investigator_id"],
                "skill": "Library Use",
                "target": 50,
                "decision_id": "loop-guard-roll-1",
                "seed": 7,
            },
        ),
        _run(ws, "scene.map"),
    ]
    for envelope in envelopes:
        assert envelope["ok"] is True, envelope
        assert _loop_warnings(envelope) == []
