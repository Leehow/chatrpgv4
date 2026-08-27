"""History projection: thin rebuild facade (coc_history_projection).

Builds a synthetic sidecar Git history — main turn, fork turn, and a
two-parent confluence merge — then proves the full rebuild through the
facade: insertion-ready rows land verbatim, state changes diff against
the first parent, queries work through the re-exports, rebuilds are
deterministic, a corrupt cache is replaced only by a validated complete
build, and a mid-build failure preserves the previous good database and
all Git evidence. No real campaign data.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"

sys.path.insert(0, str(SCRIPTS))


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


facade_mod = load_module(
    "coc_history_projection", SCRIPTS / "coc_history_projection.py"
)
schema_mod = load_module(
    "coc_history_projection_schema", SCRIPTS / "coc_history_projection_schema.py"
)
git_mod = load_module(
    "coc_history_projection_git", SCRIPTS / "coc_history_projection_git.py"
)
state_mod = load_module(
    "coc_history_projection_state", SCRIPTS / "coc_history_projection_state.py"
)
events_mod = load_module(
    "coc_history_projection_events", SCRIPTS / "coc_history_projection_events.py"
)
import coc_history_projection_query as query_via_path  # noqa: E402

CAMPAIGN_ID = "hist-facade-camp"

STATE_PATHS = {
    "campaign.json",
    "party.json",
    "save/clocks.json",
    "save/npc-contacts.json",
    "save/world-state.json",
}

IGNORED_FIXTURE_PATHS = (
    "save/session-state.json",
    "memory/index.json",
)


@pytest.fixture(autouse=True)
def isolated_git_home(tmp_path, monkeypatch):
    home = tmp_path / "_empty_home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    for key in (
        "XDG_CONFIG_HOME",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_SYSTEM",
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
        "GIT_AUTHOR_DATE",
        "GIT_COMMITTER_DATE",
    ):
        monkeypatch.delenv(key, raising=False)


def _env() -> dict[str, str]:
    env = os.environ.copy()
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    env["GIT_TERMINAL_PROMPT"] = "0"
    return env


def _git(*args: str, cwd: Path | None = None, repo: Path | None = None) -> str:
    cmd = [
        "git",
        "-c",
        "user.name=facade-test",
        "-c",
        "user.email=facade-test@localhost",
        "-c",
        "commit.gpgsign=false",
    ]
    if repo is not None:
        cmd.append(f"--git-dir={repo}")
    cmd.extend(args)
    completed = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert completed.returncode == 0, f"git {args} failed: {completed.stderr}"
    return completed.stdout


def _worktree(root: Path) -> Path:
    return root / ".coc" / "campaigns" / CAMPAIGN_ID


def _repo(root: Path) -> Path:
    return root / ".coc" / "repos" / "campaigns" / f"{CAMPAIGN_ID}.git"


def _write(worktree: Path, relpath: str, text: str) -> None:
    path = worktree / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _commit(worktree: Path, subject: str, trailers: list[tuple[str, str]]) -> str:
    message = subject + "\n\n" + "\n".join(f"{key}: {value}" for key, value in trailers)
    _git("add", "-A", cwd=worktree)
    _git("commit", "--allow-empty", "-m", message, cwd=worktree)
    return _git("rev-parse", "HEAD", cwd=worktree).strip()


def _push(root: Path) -> None:
    _git("push", str(_repo(root)), "main", cwd=_worktree(root))


def _db_path(root: Path) -> Path:
    return schema_mod.projection_path(root, CAMPAIGN_ID)


def _rows(root: Path, table: str, *columns: str) -> list[tuple]:
    connection = schema_mod.open_projection_db(root, CAMPAIGN_ID)
    try:
        names = ",".join(columns) if columns else "*"
        return [tuple(row) for row in connection.execute(f'SELECT {names} FROM "{table}"')]
    finally:
        connection.close()


def _counts(root: Path) -> dict[str, int]:
    connection = schema_mod.open_projection_db(root, CAMPAIGN_ID)
    try:
        return {
            table: int(connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
            for table in (
                "campaigns",
                "timelines",
                "commits",
                "entities",
                "state_snapshots",
                "state_changes",
                "events",
                "receipts",
                "rolls",
                "effects",
                "transactions",
                "relations",
                "backlog",
                "projection_runs",
            )
        }
    finally:
        connection.close()


def _temp_leftovers(root: Path) -> list[Path]:
    return sorted(_db_path(root).parent.glob(".history-projection-*.tmp"))


def build_campaign(tmp_path: Path) -> tuple[Path, dict[str, str]]:
    """Baseline -> main turn 1 -> fork turn 1 -> two-parent merge -> turn 2."""
    root = tmp_path / "camp-root"
    worktree = _worktree(root)
    worktree.parent.mkdir(parents=True, exist_ok=True)
    _git("init", "-b", "main", str(worktree))

    _write(
        worktree,
        "campaign.json",
        json.dumps({"campaign_id": CAMPAIGN_ID, "title": "facade"}) + "\n",
    )
    _write(
        worktree,
        "party.json",
        json.dumps(
            {
                "members": [
                    {"investigator_id": "inv-a", "name": "Arden"},
                    {"investigator_id": "inv-b"},
                ]
            }
        )
        + "\n",
    )
    _write(worktree, "save/world-state.json", '{"day": 1, "era": "1925"}\n')
    _write(
        worktree,
        "save/npc-contacts.json",
        json.dumps(
            {
                "contacts": [
                    {
                        "investigator_id": "inv-a",
                        "npc_id": "npc-w",
                        "relation_kind": "first_contact",
                    }
                ]
            }
        )
        + "\n",
    )
    # Ignore-face files: tracked in Git, invisible to the projection.
    _write(worktree, "save/session-state.json", '{"session": 1}\n')
    _write(worktree, "memory/index.json", "{}\n")
    _write(worktree, "logs/pending-turns/pending-1.jsonl", "{}\n")
    _write(
        worktree,
        "logs/turn-finalizations.jsonl",
        '{"finalization_id": "fin-base"}\n',
    )
    baseline = _commit(
        worktree,
        "coc baseline",
        [
            ("COC-Commit-Type", "baseline"),
            ("Campaign-Id", CAMPAIGN_ID),
            ("Timeline-Id", "tl-main"),
        ],
    )

    _write(worktree, "save/world-state.json", '{"day": 2, "era": "1926"}\n')
    _write(worktree, "save/clocks.json", '{"clock_id": "clock-doom", "progress": 1}\n')
    _write(
        worktree,
        "logs/turn-finalizations.jsonl",
        '{"finalization_id": "fin-base"}\n{"finalization_id": "fin-main-001"}\n',
    )
    _write(
        worktree,
        "logs/dice.jsonl",
        '{"roll_id": "roll-001", "type": "roll", "skill": "listen", "outcome": 33}\n'
        '{"effect_id": "effect-001", "roll_id": "roll-001", "entity_id": "inv-a",'
        ' "type": "effect", "result": "door creaks"}\n'
        '{"event_type": "scene_shift", "scene_id": "scene-hall", "secret": true}\n',
    )
    turn1 = _commit(
        worktree,
        "coc turn 0001",
        [
            ("COC-Commit-Type", "turn"),
            ("Campaign-Id", CAMPAIGN_ID),
            ("Timeline-Id", "tl-main"),
            ("Turn-Number", "1"),
            ("Finalization-Id", "fin-main-001"),
        ],
    )

    _git("checkout", "-b", "fork", cwd=worktree)
    _write(worktree, "save/world-state.json", '{"day": 2, "era": "1926", "fork": true}\n')
    _write(
        worktree,
        "memory/temporal/stream.jsonl",
        '{"event_type": "temporal_note", "note": "fork"}\n',
    )
    _write(
        worktree,
        "logs/turn-finalizations.jsonl",
        '{"finalization_id": "fin-base"}\n'
        '{"finalization_id": "fin-main-001"}\n'
        '{"finalization_id": "fin-fork-001"}\n',
    )
    fork1 = _commit(
        worktree,
        "coc turn 0001 fork",
        [
            ("COC-Commit-Type", "turn"),
            ("Campaign-Id", CAMPAIGN_ID),
            ("Timeline-Id", "tl-fork"),
            ("Turn-Number", "1"),
            ("Finalization-Id", "fin-fork-001"),
        ],
    )

    _git("checkout", "main", cwd=worktree)
    _git(
        "merge",
        "--no-ff",
        "-m",
        "merge fork timeline back into main\n\n"
        f"COC-Commit-Type: timeline-merge\nCampaign-Id: {CAMPAIGN_ID}",
        "fork",
        cwd=worktree,
    )
    merge = _git("rev-parse", "HEAD", cwd=worktree).strip()

    _write(worktree, "save/world-state.json", '{"day": 3, "era": "1926", "fork": true}\n')
    # Ignored mutation in the same turn: must stay invisible.
    _write(worktree, "save/session-state.json", '{"session": 99}\n')
    _write(
        worktree,
        "save/npc-contacts.json",
        json.dumps(
            {
                "contacts": [
                    {
                        "investigator_id": "inv-a",
                        "npc_id": "npc-w",
                        "relation_kind": "first_contact",
                    },
                    {
                        "investigator_id": "inv-b",
                        "npc_id": "npc-w",
                        "relation_kind": "ally",
                    },
                ]
            }
        )
        + "\n",
    )
    _write(
        worktree,
        "logs/turn-finalizations.jsonl",
        '{"finalization_id": "fin-base"}\n'
        '{"finalization_id": "fin-main-001"}\n'
        '{"finalization_id": "fin-fork-001"}\n'
        '{"finalization_id": "fin-main-002"}\n',
    )
    _write(
        worktree,
        "logs/dice.jsonl",
        '{"roll_id": "roll-001", "type": "roll", "skill": "listen", "outcome": 33}\n'
        '{"effect_id": "effect-001", "roll_id": "roll-001", "entity_id": "inv-a",'
        ' "type": "effect", "result": "door creaks"}\n'
        '{"event_type": "scene_shift", "scene_id": "scene-hall", "secret": true}\n'
        '{"roll_id": "roll-002", "type": "roll", "skill": "spot_hidden", "outcome": 7}\n'
        'not-json-line {{{\n',
    )
    turn2 = _commit(
        worktree,
        "coc turn 0002",
        [
            ("COC-Commit-Type", "turn"),
            ("Campaign-Id", CAMPAIGN_ID),
            ("Timeline-Id", "tl-main"),
            ("Turn-Number", "2"),
            ("Finalization-Id", "fin-main-002"),
        ],
    )

    repo = _repo(root)
    repo.parent.mkdir(parents=True, exist_ok=True)
    _git("clone", "--bare", str(worktree), str(repo))
    return root, {
        "baseline": baseline,
        "turn1": turn1,
        "fork1": fork1,
        "merge": merge,
        "turn2": turn2,
    }


@pytest.fixture()
def campaign(tmp_path):
    return build_campaign(tmp_path)


@pytest.fixture()
def projected(tmp_path, campaign):
    root, shas = campaign
    envelope = facade_mod.rebuild_history_projection(root, CAMPAIGN_ID)
    return root, shas, envelope


class TestReExports:
    def test_query_reexports_are_the_query_module_functions(self):
        # Same module object the facade composed (sys.modules cache).
        assert facade_mod.query_history_at is query_via_path.query_history_at
        assert facade_mod.query_history_diff is query_via_path.query_history_diff
        assert facade_mod.query_entity_history is query_via_path.query_entity_history
        assert facade_mod.query_event_log is query_via_path.query_event_log


class TestFullRebuild:
    def test_envelope_reports_the_completed_run(self, projected):
        _root, shas, envelope = projected
        assert envelope["status"] == "complete"
        assert envelope["campaign_id"] == CAMPAIGN_ID
        assert envelope["schema_generation"] == "history-projection-2"
        assert envelope["head_commit_sha"] == shas["turn2"]
        assert envelope["commit_count"] == 5
        assert envelope["run_id"] == (
            f"hist-rebuild:{CAMPAIGN_ID}:{envelope['input_digest']}"
        )
        assert len(envelope["input_digest"]) == 64
        int(envelope["input_digest"], 16)
        assert len(envelope["projection_digest"]) == 64

    def test_run_row_matches_envelope(self, projected):
        root, shas, envelope = projected
        runs = _rows(root, "projection_runs")
        assert len(runs) == 1
        run_id, generation, head, count, digest = runs[0]
        assert (run_id, generation, head, count, digest) == (
            envelope["run_id"],
            "history-projection-2",
            shas["turn2"],
            5,
            envelope["projection_digest"],
        )

    def test_campaign_and_timeline_rows(self, projected):
        root, shas, _envelope = projected
        assert _rows(root, "campaigns") == [
            (CAMPAIGN_ID, "history-projection-2", shas["turn2"], 5)
        ]
        assert _rows(root, "timelines", "timeline_id", "first_commit_sha",
                     "head_commit_sha", "last_turn_number", "commit_count") == [
            ("tl-main", shas["baseline"], shas["turn2"], 2, 4),
            ("tl-fork", shas["fork1"], shas["fork1"], 1, 1),
        ]

    def test_mechanic_rows_carry_emitting_source_log_paths(self, projected):
        """Stored rolls/effects/transactions name their emitting JSONL file.

        The receipt-driven drop contract depends on this column: a one-sided
        mechanic conflict's refs can then claim the exact tracked log path
        and a validated sacrifice/defer disposition drops that file from the
        merged worldline tree.
        """
        root, _shas, _envelope = projected
        connection = schema_mod.open_projection_db(root, CAMPAIGN_ID)
        try:
            assert [tuple(row) for row in connection.execute(
                "SELECT roll_id, source_path FROM rolls ORDER BY roll_id"
            )] == [
                ("roll-001", "logs/dice.jsonl"),
                ("roll-002", "logs/dice.jsonl"),
            ]
            assert [tuple(row) for row in connection.execute(
                "SELECT effect_id, source_path FROM effects ORDER BY effect_id"
            )] == [("effect-001", "logs/dice.jsonl")]
            assert connection.execute(
                "SELECT count(*) FROM transactions WHERE source_path = ''"
            ).fetchone()[0] == 0
        finally:
            connection.close()

    def test_commits_in_scanner_order_with_two_parent_merge(self, projected):
        root, shas, _envelope = projected
        rows = _rows(
            root, "commits", "sha", "timeline_id", "ordinal", "turn_number",
            "commit_type", "parents_json",
        )
        assert rows == [
            (shas["baseline"], "tl-main", 1, None, "baseline", "[]"),
            (shas["turn1"], "tl-main", 2, 1, "turn", f'["{shas["baseline"]}"]'),
            (shas["fork1"], "tl-fork", 3, 1, "turn", f'["{shas["turn1"]}"]'),
            (
                shas["merge"],
                "tl-main",
                4,
                None,
                "timeline-merge",
                f'["{shas["turn1"]}","{shas["fork1"]}"]',
            ),
            (shas["turn2"], "tl-main", 5, 2, "turn", f'["{shas["merge"]}"]'),
        ]
        # files_json carries content identity (path + blob sha), not text.
        connection = schema_mod.open_projection_db(root, CAMPAIGN_ID)
        try:
            files = json.loads(
                connection.execute(
                    "SELECT files_json FROM commits WHERE sha = ?",
                    (shas["baseline"],),
                ).fetchone()[0]
            )
        finally:
            connection.close()
        assert all(set(item) == {"path", "blob_sha"} for item in files)
        assert {item["path"] for item in files} == {
            "campaign.json",
            "party.json",
            "save/npc-contacts.json",
            "save/world-state.json",
            "logs/turn-finalizations.jsonl",
        }

    def test_snapshot_and_change_counts_and_key_changes(self, projected):
        root, shas, _envelope = projected
        assert _counts(root)["state_snapshots"] == 4 + 5 + 5 + 5 + 5
        assert _counts(root)["state_changes"] == 20
        connection = schema_mod.open_projection_db(root, CAMPAIGN_ID)
        try:
            turn1_day = connection.execute(
                "SELECT change_json FROM state_changes WHERE commit_sha = ?"
                " AND path = 'save/world-state.json' AND pointer = '/day'",
                (shas["turn1"],),
            ).fetchone()[0]
            assert json.loads(turn1_day) == {
                "change_type": "replace",
                "old_value_json": "1",
                "new_value_json": "2",
            }
            baseline_types = [
                row[0]
                for row in connection.execute(
                    "SELECT json_extract(change_json, '$.change_type')"
                    " FROM state_changes WHERE commit_sha = ?",
                    (shas["baseline"],),
                )
            ]
            assert set(baseline_types) == {"add"}  # root commit: everything added
        finally:
            connection.close()

    def test_merge_state_changes_diff_against_first_parent(self, projected):
        root, shas, _envelope = projected
        connection = schema_mod.open_projection_db(root, CAMPAIGN_ID)
        try:
            # The merge commit's whole allowed-face tree equals the fork's
            # (git resolved cleanly onto the fork state): a scan-order
            # previous-commit diff would produce zero changes. The first
            # parent is turn1, so the confluence diff is exactly /fork add.
            merge_tree = connection.execute(
                "SELECT tree_digest FROM commits WHERE sha = ?",
                (shas["merge"],),
            ).fetchone()[0]
            fork_tree = connection.execute(
                "SELECT tree_digest FROM commits WHERE sha = ?",
                (shas["fork1"],),
            ).fetchone()[0]
            assert merge_tree == fork_tree
            merge_changes = [
                (row[0], row[1], json.loads(row[2]))
                for row in connection.execute(
                    "SELECT path, pointer, change_json FROM state_changes"
                    " WHERE commit_sha = ?",
                    (shas["merge"],),
                )
            ]
        finally:
            connection.close()
        assert merge_changes == [
            (
                "save/world-state.json",
                "/fork",
                {"change_type": "add", "old_value_json": None, "new_value_json": "true"},
            )
        ]

    def test_entity_mentions_fold_first_and_last(self, projected):
        root, shas, _envelope = projected
        assert sorted(
            _rows(
                root, "entities", "entity_id", "entity_type",
                "first_commit_sha", "last_commit_sha",
            )
        ) == sorted(
            [
                ("inv-a", "investigator", shas["baseline"], shas["turn2"]),
                ("inv-b", "investigator", shas["baseline"], shas["turn2"]),
                ("npc-w", "npc", shas["baseline"], shas["turn2"]),
                ("clock-doom", "clock", shas["turn1"], shas["turn2"]),
            ]
        )

    def test_relations_are_per_commit_evidence(self, projected):
        root, shas, _envelope = projected
        rows = _rows(
            root, "relations", "commit_sha", "pointer",
            "from_entity_id", "to_entity_id", "relation_kind",
        )
        assert sorted(rows) == sorted(
            [
                (sha, "/contacts/0", "inv-a", "npc-w", "first_contact")
                for sha in (
                    shas["baseline"],
                    shas["turn1"],
                    shas["fork1"],
                    shas["merge"],
                    shas["turn2"],
                )
            ]
            + [(shas["turn2"], "/contacts/1", "inv-b", "npc-w", "ally")]
        )

    def test_canonical_log_rows_first_occurrence_wins(self, projected):
        root, shas, _envelope = projected
        receipts = _rows(
            root, "receipts", "receipt_id", "commit_sha", "timeline_id",
            "turn_number",
        )
        assert sorted(receipts) == sorted(
            [
                ("fin-base", shas["baseline"], "tl-main", None),
                ("fin-main-001", shas["turn1"], "tl-main", 1),
                ("fin-fork-001", shas["fork1"], "tl-fork", 1),
                ("fin-main-002", shas["turn2"], "tl-main", 2),
            ]
        )
        # roll-001/effect-001 replay in every descendant snapshot of
        # logs/dice.jsonl but are stored once, at first occurrence.
        assert sorted(_rows(root, "rolls", "roll_id", "commit_sha")) == sorted(
            [
                ("roll-001", shas["turn1"]),
                ("roll-002", shas["turn2"]),
            ]
        )
        assert _rows(root, "effects", "effect_id", "entity_id", "commit_sha") == [
            ("effect-001", "inv-a", shas["turn1"])
        ]
        assert _counts(root)["transactions"] == 0

    def test_backlog_preserves_malformed_evidence(self, projected):
        root, shas, _envelope = projected
        backlog = _rows(root, "backlog", "backlog_id", "kind", "commit_sha")
        assert len(backlog) == 1
        backlog_id, kind, commit_sha = backlog[0]
        assert kind == "invalid_json"
        assert commit_sha == shas["turn2"]
        assert backlog_id == (
            f"hist-backlog:{shas['turn2']}:logs/dice.jsonl:5"
        )
        connection = schema_mod.open_projection_db(root, CAMPAIGN_ID)
        try:
            payload = json.loads(
                connection.execute(
                    "SELECT payload_json FROM backlog WHERE backlog_id = ?",
                    (backlog_id,),
                ).fetchone()[0]
            )
        finally:
            connection.close()
        assert payload["raw_line"] == "not-json-line {{{"
        assert payload["source_ordinal"] == 5
        assert payload["source_path"] == "logs/dice.jsonl"

    def test_generic_events_replay_once_per_emitting_commit(self, projected):
        root, shas, _envelope = projected
        events = _rows(
            root, "events", "event_id", "commit_sha", "timeline_id",
            "turn_number", "source_path", "source_ordinal", "event_type",
        )
        # scene_shift lives in dice.jsonl from turn1 on (4 commits);
        # temporal_note lives in stream.jsonl from fork1 on (3 commits).
        assert events == [
            (1, shas["turn1"], "tl-main", 1, "logs/dice.jsonl", 3, "scene_shift"),
            (2, shas["fork1"], "tl-fork", 1, "logs/dice.jsonl", 3, "scene_shift"),
            (3, shas["fork1"], "tl-fork", 1, "memory/temporal/stream.jsonl", 1, "temporal_note"),
            (4, shas["merge"], "tl-main", None, "logs/dice.jsonl", 3, "scene_shift"),
            (5, shas["merge"], "tl-main", None, "memory/temporal/stream.jsonl", 1, "temporal_note"),
            (6, shas["turn2"], "tl-main", 2, "logs/dice.jsonl", 3, "scene_shift"),
            (7, shas["turn2"], "tl-main", 2, "memory/temporal/stream.jsonl", 1, "temporal_note"),
        ]


class TestFacadeQueries:
    def test_query_history_at_returns_commit_and_snapshots(self, projected):
        root, shas, _envelope = projected
        result = facade_mod.query_history_at(
            root, CAMPAIGN_ID, timeline_id="tl-main", turn_number=2
        )
        assert result["commit"]["sha"] == shas["turn2"]
        assert result["commit"]["ordinal"] == 5
        assert set(result["snapshots"]) == STATE_PATHS
        world = result["snapshots"]["save/world-state.json"]["state"]
        assert world == {"day": 3, "era": "1926", "fork": True}

    def test_query_history_diff_cross_timeline(self, projected):
        root, shas, _envelope = projected
        result = facade_mod.query_history_diff(
            root,
            CAMPAIGN_ID,
            {"timeline_id": "tl-fork", "turn_number": 1},
            {"timeline_id": "tl-main", "turn_number": 2},
        )
        assert result["from_commit"]["sha"] == shas["fork1"]
        assert result["to_commit"]["sha"] == shas["turn2"]
        changes = [
            (c["path"], c["pointer"], c["change_type"]) for c in result["changes"]
        ]
        assert changes == [
            ("save/npc-contacts.json", "/contacts/1/investigator_id", "add"),
            ("save/npc-contacts.json", "/contacts/1/npc_id", "add"),
            ("save/npc-contacts.json", "/contacts/1/relation_kind", "add"),
            ("save/world-state.json", "/day", "replace"),
        ]
        day = next(
            c for c in result["changes"] if c["pointer"] == "/day"
        )
        assert day["old_value"] == 2 and day["new_value"] == 3

    def test_query_entity_history(self, projected):
        root, shas, _envelope = projected
        inv_a = facade_mod.query_entity_history(root, CAMPAIGN_ID, "inv-a")
        assert inv_a["entity_types"] == ["investigator"]
        assert inv_a["first_commit_sha"] == shas["baseline"]
        assert inv_a["last_commit_sha"] == shas["turn2"]
        assert [c["ordinal"] for c in inv_a["commits"]] == [1, 2, 3, 4, 5]
        assert len(inv_a["relations"]) == 5

        clock = facade_mod.query_entity_history(root, CAMPAIGN_ID, "clock-doom")
        assert clock["entity_types"] == ["clock"]
        assert [c["ordinal"] for c in clock["commits"]] == [2, 3, 4, 5]

        # Event-only mention: scene-hall never enters the entities table
        # (it lives only in event payloads), but its event history resolves.
        scene = facade_mod.query_entity_history(root, CAMPAIGN_ID, "scene-hall")
        assert scene["entity_types"] == []
        assert scene["commits"] == []
        assert len(scene["events"]) == 4
        assert all(e["event_type"] == "scene_shift" for e in scene["events"])

    def test_query_event_log_ordering_filter_and_privacy(self, projected):
        root, _shas, _envelope = projected
        result = facade_mod.query_event_log(
            root, CAMPAIGN_ID, timeline_id="tl-main", limit=10
        )
        assert [
            (e["event_id"], e["turn_number"], e["event_type"])
            for e in result["events"]
        ] == [
            (7, 2, "temporal_note"),
            (6, 2, "scene_shift"),
            (1, 1, "scene_shift"),
            (5, None, "temporal_note"),
            (4, None, "scene_shift"),
        ]
        # Privacy field passes through verbatim.
        scene = next(
            e for e in result["events"] if e["event_type"] == "scene_shift"
        )
        assert scene["payload"]["secret"] is True
        # Timeline filter excludes the main-line replay; both fork rows
        # share turn 1, so the deterministic tie-break is event_id DESC.
        fork_log = facade_mod.query_event_log(root, CAMPAIGN_ID, timeline_id="tl-fork")
        assert [e["event_id"] for e in fork_log["events"]] == [3, 2]
        typed = facade_mod.query_event_log(
            root, CAMPAIGN_ID, event_types=["temporal_note"]
        )
        # No timeline filter: newest-first is turn 2 (id 7), then the
        # fork's turn 1 (id 3), then the merge's turn-less row (id 5).
        assert [e["event_id"] for e in typed["events"]] == [7, 3, 5]


class TestDeterministicRebuild:
    def test_rebuild_is_deterministic_digest_and_counts(self, tmp_path, projected):
        root, _shas, first = projected
        db_path = _db_path(root)
        first_copy = tmp_path / "first.db"
        first_copy.write_bytes(db_path.read_bytes())

        second = facade_mod.rebuild_history_projection(root, CAMPAIGN_ID)

        for key in (
            "status",
            "run_id",
            "schema_generation",
            "input_digest",
            "head_commit_sha",
            "commit_count",
            "projection_digest",
        ):
            assert second[key] == first[key], key
        left = sqlite3.connect(first_copy)
        right = sqlite3.connect(db_path)
        left.row_factory = right.row_factory = sqlite3.Row
        try:
            assert schema_mod.projection_digest(left) == schema_mod.projection_digest(
                right
            )
            assert [
                tuple(row) for row in left.execute("SELECT * FROM projection_runs")
            ] == [tuple(row) for row in right.execute("SELECT * FROM projection_runs")]
        finally:
            left.close()
            right.close()
        assert _counts(root) == {
            "campaigns": 1,
            "timelines": 2,
            "commits": 5,
            "entities": 4,
            "state_snapshots": 24,
            "state_changes": 20,
            "events": 7,
            "receipts": 4,
            "rolls": 2,
            "effects": 1,
            "transactions": 0,
            "relations": 6,
            "backlog": 1,
            "projection_runs": 1,
        }

    def test_new_history_changes_input_digest_and_run_id(self, tmp_path, campaign):
        root, _shas = campaign
        first = facade_mod.rebuild_history_projection(root, CAMPAIGN_ID)
        _write(_worktree(root), "save/clocks.json", '{"clock_id": "clock-doom", "progress": 2}\n')
        _commit(
            _worktree(root),
            "coc turn 0003",
            [
                ("COC-Commit-Type", "turn"),
                ("Campaign-Id", CAMPAIGN_ID),
                ("Timeline-Id", "tl-main"),
                ("Turn-Number", "3"),
                ("Finalization-Id", "fin-main-003"),
            ],
        )
        _push(root)
        second = facade_mod.rebuild_history_projection(root, CAMPAIGN_ID)
        assert second["commit_count"] == 6
        assert second["input_digest"] != first["input_digest"]
        assert second["run_id"] != first["run_id"]
        assert second["projection_digest"] != first["projection_digest"]


class TestCorruptCacheReplacement:
    def test_garbage_cache_replaced_by_validated_build(self, tmp_path, projected):
        root, _shas, envelope = projected
        _db_path(root).write_bytes(b"definitely not a sqlite database" * 64)
        again = facade_mod.rebuild_history_projection(root, CAMPAIGN_ID)
        assert again["status"] == "complete"
        assert again["run_id"] == envelope["run_id"]
        assert _counts(root)["commits"] == 5
        assert len(_rows(root, "projection_runs")) == 1
        facade_mod.query_history_at(root, CAMPAIGN_ID, timeline_id="tl-main", turn_number=2)

    def test_stale_generation_cache_replaced(self, tmp_path, projected):
        root, _shas, _envelope = projected
        stale = sqlite3.connect(_db_path(root))
        stale.execute("PRAGMA user_version = 999")
        stale.commit()
        stale.close()
        again = facade_mod.rebuild_history_projection(root, CAMPAIGN_ID)
        assert again["status"] == "complete"
        connection = schema_mod.open_projection_db(root, CAMPAIGN_ID)
        try:
            assert (
                connection.execute("PRAGMA user_version").fetchone()[0]
                == schema_mod.PROJECTION_USER_VERSION
                == 2
            )
        finally:
            connection.close()


class TestFailurePreservesPriorDB:
    def test_mid_build_failure_keeps_previous_database_and_git_evidence(
        self, tmp_path, projected
    ):
        root, shas, envelope = projected
        db_path = _db_path(root)
        prior_bytes = db_path.read_bytes()

        # Grow the history with a commit whose state file is not JSON.
        _write(_worktree(root), "save/world-state.json", "{corrupt not json\n")
        _commit(
            _worktree(root),
            "coc turn 0003",
            [
                ("COC-Commit-Type", "turn"),
                ("Campaign-Id", CAMPAIGN_ID),
                ("Timeline-Id", "tl-main"),
                ("Turn-Number", "3"),
                ("Finalization-Id", "fin-main-003"),
            ],
        )
        _push(root)

        repo = _repo(root)

        def repo_state() -> str:
            return "\n".join(
                [
                    _git("for-each-ref", repo=repo),
                    _git("rev-parse", "HEAD", repo=repo),
                    _git("count-objects", "-v", repo=repo),
                ]
            )

        before = repo_state()
        with pytest.raises(
            facade_mod.HistoryProjectionRebuildError,
            match="state file is not valid JSON",
        ):
            facade_mod.rebuild_history_projection(root, CAMPAIGN_ID)

        assert repo_state() == before  # Git evidence untouched
        assert db_path.read_bytes() == prior_bytes  # previous good DB untouched
        assert not _temp_leftovers(root)
        assert _counts(root)["commits"] == 5
        assert _rows(root, "projection_runs") == [
            (
                envelope["run_id"],
                "history-projection-2",
                shas["turn2"],
                5,
                envelope["projection_digest"],
            )
        ]
        # The old projection still serves queries.
        at = facade_mod.query_history_at(
            root, CAMPAIGN_ID, timeline_id="tl-main", turn_number=2
        )
        assert at["commit"]["sha"] == shas["turn2"]

    def test_scan_failure_is_typed_and_publishes_nothing(self, tmp_path):
        root = tmp_path / "camp-root"
        worktree = _worktree(root)
        worktree.parent.mkdir(parents=True, exist_ok=True)
        _git("init", "-b", "main", str(worktree))
        _write(worktree, "campaign.json", "{}\n")
        _commit(
            worktree,
            "foreign provenance",
            [
                ("COC-Commit-Type", "baseline"),
                ("Campaign-Id", "other-camp"),
                ("Timeline-Id", "tl-main"),
            ],
        )
        repo = _repo(root)
        repo.parent.mkdir(parents=True, exist_ok=True)
        _git("clone", "--bare", str(worktree), str(repo))

        with pytest.raises(
            facade_mod.HistoryProjectionRebuildError, match="history scan failed"
        ):
            facade_mod.rebuild_history_projection(root, CAMPAIGN_ID)
        assert not _db_path(root).exists()

    def test_unsafe_campaign_id_is_typed_error(self, campaign):
        root, _shas = campaign
        for bad in ("../evil", "a/b", "", None, 3):
            with pytest.raises(facade_mod.HistoryProjectionRebuildError):
                facade_mod.rebuild_history_projection(root, bad)


class TestIgnoredPathsAbsent:
    def test_ignored_paths_never_projected(self, projected):
        root, _shas, _envelope = projected
        connection = schema_mod.open_projection_db(root, CAMPAIGN_ID)
        try:
            snapshot_paths = {
                row[0]
                for row in connection.execute("SELECT path FROM state_snapshots")
            }
            change_paths = {
                row[0] for row in connection.execute("SELECT path FROM state_changes")
            }
            event_sources = {
                row[0] for row in connection.execute("SELECT source_path FROM events")
            }
            receipt_commits = {
                row[0]
                for row in connection.execute("SELECT DISTINCT commit_sha FROM receipts")
            }
        finally:
            connection.close()
        assert snapshot_paths == STATE_PATHS
        assert change_paths == STATE_PATHS
        assert event_sources == {"logs/dice.jsonl", "memory/temporal/stream.jsonl"}
        assert len(receipt_commits) == 4  # every append replay still attributed
        # The ignored files really exist in the campaign worktree; they are
        # simply invisible to the projection.
        worktree = _worktree(root)
        for relpath in IGNORED_FIXTURE_PATHS:
            assert (worktree / relpath).is_file(), relpath
            assert relpath not in snapshot_paths
            assert relpath not in change_paths
        assert (worktree / "logs" / "pending-turns" / "pending-1.jsonl").is_file()

    def test_ignored_mutation_in_turn2_invisible(self, projected):
        root, shas, _envelope = projected
        connection = schema_mod.open_projection_db(root, CAMPAIGN_ID)
        try:
            turn2_paths = {
                row[0]
                for row in connection.execute(
                    "SELECT path FROM state_changes WHERE commit_sha = ?",
                    (shas["turn2"],),
                )
            }
        finally:
            connection.close()
        assert turn2_paths == {"save/npc-contacts.json", "save/world-state.json"}
        assert "save/session-state.json" not in turn2_paths


class TestDirectRowInsertCompatibility:
    """Stored rows are exactly the extractors' insertion-ready rows.

    Re-runs both pure extractors over the same scanned records (with the
    facade's first-parent snapshot chaining) and proves the database holds
    those rows verbatim — no field translation — plus the two documented
    fold policies (entity upsert; canonical ids first-occurrence-wins).
    """

    def test_stored_rows_equal_extractor_outputs(self, campaign):
        root, shas = campaign
        facade_mod.rebuild_history_projection(root, CAMPAIGN_ID)
        records = git_mod.scan_campaign_history(root, CAMPAIGN_ID)
        assert [r["sha"] for r in records] == [
            shas["baseline"],
            shas["turn1"],
            shas["fork1"],
            shas["merge"],
            shas["turn2"],
        ]

        expected: dict[str, list[dict]] = {
            "state_snapshots": [],
            "state_changes": [],
            "relations": [],
            "events": [],
            "backlog": [],
        }
        canonical_first: dict[str, dict[str, dict]] = {
            "receipts": {},
            "rolls": {},
            "effects": {},
            "transactions": {},
        }
        entity_fold: dict[tuple[str, str], dict[str, str]] = {}
        snapshots_by_commit: dict[str, dict[str, dict]] = {}
        for record in records:
            parent = record["parents"][0] if record["parents"] else None
            previous = snapshots_by_commit.get(parent) if parent else None
            state = state_mod.extract_state(record, previous)
            expected["state_snapshots"].extend(state["snapshots"])
            expected["state_changes"].extend(state["changes"])
            expected["relations"].extend(state["relations"])
            snapshots_by_commit[record["sha"]] = {
                row["path"]: row for row in state["snapshots"]
            }
            for row in state["entities"]:
                key = (row["entity_id"], row["entity_type"])
                if key not in entity_fold:
                    entity_fold[key] = dict(row)
                entity_fold[key]["last_commit_sha"] = row["last_commit_sha"]

            event_rows = events_mod.extract_events(record)
            expected["events"].extend(event_rows["events"])
            expected["backlog"].extend(event_rows["backlog"])
            for table in canonical_first:
                for row in event_rows[table]:
                    canonical_first[table].setdefault(
                        row[f"{table[:-1]}_id"], row
                    )

        def stored_dicts(table: str) -> list[dict]:
            connection = schema_mod.open_projection_db(root, CAMPAIGN_ID)
            try:
                cursor = connection.execute(f'SELECT * FROM "{table}"')
                columns = [str(desc[0]) for desc in cursor.description]
                return [dict(zip(columns, row)) for row in cursor.fetchall()]
            finally:
                connection.close()

        def canon(rows: list[dict]) -> list[tuple]:
            return sorted(tuple(sorted(row.items())) for row in rows)

        for table in ("state_snapshots", "state_changes", "relations", "backlog"):
            assert canon(stored_dicts(table)) == canon(expected[table]), table

        # Entities fold in scan order: first mention sticks, last advances.
        expected_entities = [
            {
                "entity_id": entity_id,
                "entity_type": entity_type,
                "first_commit_sha": fold["first_commit_sha"],
                "last_commit_sha": fold["last_commit_sha"],
            }
            for (entity_id, entity_type), fold in entity_fold.items()
        ]
        assert canon(stored_dicts("entities")) == canon(expected_entities)

        # Canonical append-log identities keep their first occurrence in
        # topo order; later replays are dropped.
        for table, first_rows in canonical_first.items():
            assert canon(stored_dicts(table)) == canon(
                list(first_rows.values())
            ), table

        # Generic events carry an autoincrement id assigned by insertion
        # order; compare every content column in exactly that order.
        connection = schema_mod.open_projection_db(root, CAMPAIGN_ID)
        try:
            stored_events = [
                dict(
                    zip(
                        (
                            "commit_sha", "timeline_id", "turn_number",
                            "source_path", "source_ordinal", "event_type",
                            "payload_sha256", "payload_json",
                        ),
                        row,
                    )
                )
                for row in connection.execute(
                    "SELECT commit_sha, timeline_id, turn_number, source_path,"
                    " source_ordinal, event_type, payload_sha256, payload_json"
                    " FROM events ORDER BY event_id"
                )
            ]
        finally:
            connection.close()
        content_columns = (
            "commit_sha", "timeline_id", "turn_number", "source_path",
            "source_ordinal", "event_type", "payload_sha256", "payload_json",
        )
        assert stored_events == [
            {column: row[column] for column in content_columns}
            for row in expected["events"]
        ]


class TestEmptyHistory:
    def test_missing_repo_publishes_empty_projection_without_run_row(
        self, tmp_path
    ):
        root = tmp_path / "camp-root"
        (root / ".coc" / "campaigns" / CAMPAIGN_ID).mkdir(parents=True)
        envelope = facade_mod.rebuild_history_projection(root, CAMPAIGN_ID)
        assert envelope["status"] == "complete"
        assert envelope["commit_count"] == 0
        assert envelope["run_id"] is None
        assert envelope["head_commit_sha"] is None
        counts = _counts(root)
        assert counts["commits"] == 0
        assert counts["projection_runs"] == 0
        assert counts["campaigns"] == 1
        assert _rows(root, "campaigns") == [
            (CAMPAIGN_ID, "history-projection-2", None, 0)
        ]
        log = facade_mod.query_event_log(root, CAMPAIGN_ID)
        assert log["events"] == []
        # Deterministic: an empty rebuild reproduces itself.
        again = facade_mod.rebuild_history_projection(root, CAMPAIGN_ID)
        assert again["projection_digest"] == envelope["projection_digest"]


class TestReadonlyScanGuarantee:
    def test_rebuild_does_not_mutate_repo_or_worktree(self, tmp_path, projected):
        root, _shas, _envelope = projected
        repo = _repo(root)
        worktree = _worktree(root)

        def repo_state() -> str:
            return "\n".join(
                [
                    _git("for-each-ref", repo=repo),
                    _git("rev-parse", "HEAD", repo=repo),
                    _git("count-objects", "-v", repo=repo),
                ]
            )

        def worktree_digest() -> str:
            digest = hashlib.sha256()
            for path in sorted(p for p in worktree.rglob("*") if p.is_file()):
                digest.update(str(path.relative_to(worktree)).encode())
                digest.update(path.read_bytes())
            return digest.hexdigest()

        before_repo = repo_state()
        before_worktree = worktree_digest()
        facade_mod.rebuild_history_projection(root, CAMPAIGN_ID)
        assert repo_state() == before_repo
        assert worktree_digest() == before_worktree
