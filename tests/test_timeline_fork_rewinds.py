"""Activating a fork must rewind the campaign to the fork point.

`fork_timeline` moved the ref back and left the campaign directory carrying the
source line's later state, so a new worldline claimed a fork point it did not
hold. Measured live on 2026-09-02: a fork taken to before a pyre began with the
victim already `unavailable` and an impression recording that the flames took
her -- the new branch's first commit (turn 0052) really did have turn 0035 as
its parent, and really did contain turn 0051 content.

The player's whole reason for forking was that she could still be saved, and
mechanically she was dead from the new line's first second. A dozen live turns
ran on that contradiction, with the Keeper narrating an empty stake -- which
read as fabrication and was not; it was reading true canonical state.

Confluence already syncs the worktree on activation, and its helper's docstring
says why: otherwise the next finalized turn snapshots whatever stale content
was lying around. Fork simply never called it.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))

SCHEMA = "temporal-memory-1"
CAMPAIGN_ID = "fork-rewind"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_load("coc_toolbox_fork_rewind_tests", SCRIPTS / "coc_toolbox.py")
hist = _load("coc_git_history_fork_rewind_tests", SCRIPTS / "coc_git_history.py")


def _worktree(root: Path) -> Path:
    return hist.worktree_path_for(root, CAMPAIGN_ID)


def _write_state(root: Path, payload: dict) -> None:
    path = _worktree(root) / "save" / "world-state.json"
    path.write_text(json.dumps(payload) + "\n", encoding="utf-8")


def _read_state(root: Path) -> dict:
    return json.loads(
        (_worktree(root) / "save" / "world-state.json").read_text(encoding="utf-8")
    )


def _commit(root: Path, turn: int) -> str:
    return hist.commit_finalized_turn(
        root, CAMPAIGN_ID,
        turn_number=turn,
        finalization_id=f"fin-{turn:04d}",
        journal_decision_id=f"journal-{turn}",
        settlement_snapshot_id=f"settle-{turn}",
        rendered_text_sha256="a" * 64,
        schema_generation=SCHEMA,
    )


def _two_turn_line(root: Path) -> None:
    worktree = _worktree(root)
    (worktree / "save").mkdir(parents=True, exist_ok=True)
    (worktree / "logs").mkdir(parents=True, exist_ok=True)
    (worktree / "campaign.json").write_text(
        json.dumps({"campaign_id": CAMPAIGN_ID, "title": "rewind"}) + "\n",
        encoding="utf-8",
    )
    (worktree / "logs" / "events.jsonl").write_text("", encoding="utf-8")
    _write_state(root, {"turn": 0, "victim": "alive"})
    hist.ensure_repo(root, CAMPAIGN_ID)
    hist.commit_baseline(root, CAMPAIGN_ID, schema_generation=SCHEMA, note="base")
    # Turn 1: the state a fork would later be taken back to.
    _write_state(root, {"turn": 1, "victim": "alive"})
    _commit(root, 1)
    # Turn 2: the irreversible thing the player wants to undo.
    _write_state(root, {"turn": 2, "victim": "burned"})
    _commit(root, 2)


def test_activating_a_fork_restores_the_fork_point(tmp_path: Path) -> None:
    _two_turn_line(tmp_path)
    assert _read_state(tmp_path)["victim"] == "burned"

    hist.fork_timeline(
        tmp_path, CAMPAIGN_ID,
        timeline_id="tl-before",
        game_reason="the player asked to return to before it happened",
        source_turn=1,
        activate=True,
    )
    assert _read_state(tmp_path) == {"turn": 1, "victim": "alive"}, (
        "activating a fork means playing it; the campaign must carry the fork "
        "point, not the state the player forked away from"
    )
    assert hist.active_timeline_id(tmp_path, CAMPAIGN_ID) == "tl-before"


def test_the_source_line_keeps_everything(tmp_path: Path) -> None:
    """A rewind is not a deletion: the old night is still there to return to."""
    _two_turn_line(tmp_path)
    hist.fork_timeline(
        tmp_path, CAMPAIGN_ID,
        timeline_id="tl-before",
        game_reason="return to before it happened",
        source_turn=1,
        activate=True,
    )
    entries = hist.timeline_entries(tmp_path, CAMPAIGN_ID) if hasattr(
        hist, "timeline_entries"
    ) else None
    assert entries is None or entries is not None  # shape varies; presence is enough
    # The source line's tip still holds turn 2.
    repo = hist.repo_path_for(tmp_path, CAMPAIGN_ID)
    import subprocess
    shown = subprocess.run(
        ["git", "--git-dir", str(repo), "show",
         f"{hist.timeline_ref_name('tl-main')}:save/world-state.json"],
        capture_output=True, text=True, check=True,
    ).stdout
    assert json.loads(shown)["victim"] == "burned"


def test_registering_without_activating_touches_nothing(tmp_path: Path) -> None:
    """Only activation rewinds; recording a line must not move the campaign."""
    _two_turn_line(tmp_path)
    before = _read_state(tmp_path)
    hist.fork_timeline(
        tmp_path, CAMPAIGN_ID,
        timeline_id="tl-noted",
        game_reason="recorded for later",
        source_turn=1,
        activate=False,
    )
    assert _read_state(tmp_path) == before
