"""History projection: read-only Git scanner (coc_history_projection_git)."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


scanner = load_module(
    "coc_history_projection_git", SCRIPTS / "coc_history_projection_git.py"
)

CAMPAIGN_ID = "hist-scan-camp"


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
        "user.name=scan-test",
        "-c",
        "user.email=scan-test@localhost",
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


def _worktree(tmp_path: Path) -> Path:
    return tmp_path / "camp-root" / ".coc" / "campaigns" / CAMPAIGN_ID


def _repo(tmp_path: Path) -> Path:
    return tmp_path / "camp-root" / ".coc" / "repos" / "campaigns" / f"{CAMPAIGN_ID}.git"


def _write(worktree: Path, relpath: str, text: str) -> None:
    path = worktree / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _write_bytes(worktree: Path, relpath: str, payload: bytes) -> None:
    path = worktree / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def _track_raw_path(worktree: Path, relpath_bytes: bytes, payload: bytes) -> None:
    """Stage a file whose tracked name is not valid UTF-8.

    macOS rejects such filenames at the VFS layer, so the entry is staged
    through git plumbing (``hash-object`` + ``update-index --cacheinfo``)
    without ever materializing the name on disk. Must run after
    ``git add -A`` and before the commit, or ``add -A`` would drop it.
    """
    blob_sha = subprocess.run(
        ["git", "hash-object", "-w", "--stdin"],
        input=payload,
        env=_env(),
        capture_output=True,
        check=True,
        cwd=str(worktree),
    ).stdout.decode("ascii").strip()
    path_arg = relpath_bytes.decode("utf-8", "surrogateescape")
    _git(
        "update-index",
        "--add",
        "--cacheinfo",
        "100644",
        blob_sha,
        path_arg,
        cwd=worktree,
    )


def _read(worktree: Path, relpath: str) -> str:
    return (worktree / relpath).read_text(encoding="utf-8")


def _message(subject: str, trailers: list[tuple[str, str]]) -> str:
    return subject + "\n\n" + "\n".join(f"{key}: {value}" for key, value in trailers)


def _commit(worktree: Path, subject: str, trailers: list[tuple[str, str]]) -> str:
    _git("add", "-A", cwd=worktree)
    _git(
        "commit",
        "--allow-empty",
        "-m",
        _message(subject, trailers),
        cwd=worktree,
    )
    return _git("rev-parse", "HEAD", cwd=worktree).strip()


BASELINE_FILES = {
    "campaign.json": '{"campaign_id": "hist-scan-camp", "title": "scan"}\n',
    "party.json": '{"investigator_ids": ["inv-1"]}\n',
    "save/world-state.json": '{"day": 1}\n',
    # Disallowed kinds: wrong roots or wrong suffixes.
    "save/notes.txt": "scratch",
    "investigators/inv-1/character.json": '{"name": "inv-1"}\n',
    "handout.md": "not projected",
    "logs/debug.log": "noise",
    "scenario/cover.png": "binary-ish",
    # Full ignore face (all tracked, none projected).
    "save/session-state.json": '{"session": 1}\n',
    "save/toolbox-ledger.json": "{}\n",
    "save/commit-snapshots/snap-1.json": "{}\n",
    "save/development-settlements/settle-1.json": "{}\n",
    "save/roll-operation-receipts.json": "{}\n",
    "save/run-identity.lock": "locked",
    "save/timeline-state.json": "{}\n",
    "logs/pending-turns/pending-1.jsonl": "{}\n",
    "memory/index.json": "{}\n",
    "memory/history-projection.db": "sqlite-bytes",
    # Allowed scenario / temporal memory faces.
    "scenario/story-graph.json": '{"nodes": []}\n',
    "scenario/module-meta.json": '{"scenario_id": "scan-scenario"}\n',
    "memory/temporal/assertions.jsonl": '{"assertion": "a-1"}\n',
    "memory/temporal/schema.json": '{"version": 1}\n',
}

EXPECTED_BASELINE_PATHS = sorted(
    {
        "campaign.json",
        "party.json",
        "save/world-state.json",
        "logs/turn-finalizations.jsonl",
        "scenario/story-graph.json",
        "scenario/module-meta.json",
        "memory/temporal/assertions.jsonl",
        "memory/temporal/schema.json",
    }
)


def _build_campaign(tmp_path: Path) -> dict[str, str]:
    """One main timeline with a fork branch merged back in.

    Layout: baseline -> main turn 1 -> (fork turn 1) -> merge -> main turn 2,
    committed in a worktree repo, then published as the sidecar bare repo.
    """
    worktree = _worktree(tmp_path)
    worktree.parent.mkdir(parents=True, exist_ok=True)
    _git("init", "-b", "main", str(worktree))

    for relpath, text in BASELINE_FILES.items():
        _write(worktree, relpath, text)
    _write(
        worktree,
        "logs/turn-finalizations.jsonl",
        '{"finalization_id": "base-000"}\n',
    )
    baseline = _commit(
        worktree,
        "coc baseline: scan fixture",
        [
            ("COC-Commit-Type", "baseline"),
            ("Campaign-Id", CAMPAIGN_ID),
            ("Timeline-Id", "tl-main"),
            ("Schema-Generation", "scan/test"),
        ],
    )

    _write(worktree, "save/world-state.json", '{"day": 2}\n')
    _write(
        worktree,
        "logs/turn-finalizations.jsonl",
        '{"finalization_id": "base-000"}\n{"finalization_id": "main-001"}\n',
    )
    turn1 = _commit(
        worktree,
        "coc turn 0001: main-001",
        [
            ("COC-Commit-Type", "turn"),
            ("Campaign-Id", CAMPAIGN_ID),
            ("Timeline-Id", "tl-main"),
            ("Turn-Number", "1"),
            ("Finalization-Id", "main-001"),
        ],
    )

    _git("checkout", "-b", "fork", cwd=worktree)
    _write(worktree, "save/world-state.json", '{"day": 2, "fork": true}\n')
    _write(worktree, "memory/temporal/stream.jsonl", '{"stream": "fork"}\n')
    fork_turn1 = _commit(
        worktree,
        "coc turn 0001: fork-001",
        [
            ("COC-Commit-Type", "turn"),
            ("Campaign-Id", CAMPAIGN_ID),
            ("Timeline-Id", "tl-fork"),
            ("Turn-Number", "1"),
            ("Finalization-Id", "fork-001"),
        ],
    )

    _git("checkout", "main", cwd=worktree)
    _git(
        "merge",
        "--no-ff",
        "-X",
        "theirs",
        "-m",
        _message(
            "merge fork timeline back into main",
            [
                ("COC-Commit-Type", "timeline-merge"),
                ("Campaign-Id", CAMPAIGN_ID),
            ],
        ),
        "fork",
        cwd=worktree,
    )
    merge = _git("rev-parse", "HEAD", cwd=worktree).strip()

    # turn 2 also mutates an ignored file; the projection must not see it.
    _write(worktree, "save/world-state.json", '{"day": 3}\n')
    _write(worktree, "save/session-state.json", '{"session": 99}\n')
    _write(
        worktree,
        "logs/turn-finalizations.jsonl",
        '{"finalization_id": "base-000"}\n'
        '{"finalization_id": "main-001"}\n'
        '{"finalization_id": "main-002"}\n',
    )
    turn2 = _commit(
        worktree,
        "coc turn 0002: main-002",
        [
            ("COC-Commit-Type", "turn"),
            ("Campaign-Id", CAMPAIGN_ID),
            ("Timeline-Id", "tl-main"),
            ("Turn-Number", "2"),
            ("Finalization-Id", "main-002"),
        ],
    )

    repo = _repo(tmp_path)
    repo.parent.mkdir(parents=True, exist_ok=True)
    _git("clone", "--bare", str(worktree), str(repo))
    return {
        "baseline": baseline,
        "turn1": turn1,
        "fork_turn1": fork_turn1,
        "merge": merge,
        "turn2": turn2,
    }


def _record(commits: list[dict], sha: str) -> dict:
    matches = [c for c in commits if c["sha"] == sha]
    assert len(matches) == 1
    return matches[0]


def _paths(record: dict) -> list[str]:
    return [f["path"] for f in record["files"]]


def _build_repo_with(
    tmp_path: Path,
    *,
    files: dict[str, str] | None = None,
    raw_files: dict[str, bytes] | None = None,
    raw_path_files: dict[bytes, bytes] | None = None,
    trailers: list[tuple[str, str]] | None = None,
) -> Path:
    """Minimal one-commit campaign with arbitrary tracked content.

    Returns the campaign root whose sidecar bare repo holds exactly one
    commit containing the requested files (text, byte payloads, or raw
    non-UTF-8 path names) and commit trailers.
    """
    worktree = _worktree(tmp_path)
    worktree.parent.mkdir(parents=True, exist_ok=True)
    _git("init", "-b", "main", str(worktree))
    for relpath, text in (files or {}).items():
        _write(worktree, relpath, text)
    for relpath, payload in (raw_files or {}).items():
        _write_bytes(worktree, relpath, payload)
    _git("add", "-A", cwd=worktree)
    for relpath_bytes, payload in (raw_path_files or {}).items():
        _track_raw_path(worktree, relpath_bytes, payload)
    _git(
        "commit",
        "--allow-empty",
        "-m",
        _message("coc baseline: adversarial", trailers or []),
        cwd=worktree,
    )
    repo = _repo(tmp_path)
    repo.parent.mkdir(parents=True, exist_ok=True)
    _git("clone", "--bare", str(worktree), str(repo))
    return tmp_path / "camp-root"


@pytest.fixture()
def campaign(tmp_path) -> tuple[Path, dict[str, str], list[dict]]:
    shas = _build_campaign(tmp_path)
    commits = scanner.scan_campaign_history(tmp_path / "camp-root", CAMPAIGN_ID)
    return tmp_path / "camp-root", shas, commits


class TestPathFaces:
    def test_ignore_face_covers_every_shared_context_path(self):
        for pattern in scanner.IGNORE_PATHS:
            assert scanner.path_is_ignored(pattern.rstrip("/"))
            if pattern.endswith("/"):
                assert scanner.path_is_ignored(pattern + "anything.json")

    def test_allowed_face(self):
        allowed = [
            "campaign.json",
            "party.json",
            "save/world-state.json",
            "save/pending-turn.json",
            "save/deep/nested/state.json",
            "logs/turn-finalizations.jsonl",
            "logs/nested/stream.jsonl",
            "scenario/story-graph.json",
            "scenario/quests.json",
            "memory/temporal/assertions.jsonl",
            "memory/temporal/schema.json",
        ]
        for relpath in allowed:
            assert scanner.path_is_allowed(relpath), relpath

    def test_disallowed_face(self):
        disallowed = [
            "investigators/inv-1/character.json",
            "save/notes.txt",
            "logs/debug.log",
            "scenario/cover.png",
            "memory/other.json",
            "memory/temporal/notes.txt",
            "notes.md",
            "",
        ]
        for relpath in disallowed:
            assert not scanner.path_is_allowed(relpath), relpath

    def test_ignored_paths_are_never_allowed(self):
        for pattern in scanner.IGNORE_PATHS:
            stem = pattern.rstrip("/")
            if pattern.endswith("/"):
                assert not scanner.path_is_allowed(stem + "/x.json")
            else:
                assert not scanner.path_is_allowed(stem)


class TestAdversarialPathFaces:
    """Reviewer finding: path checks must never normalize a tracked name.

    The old ``lstrip("./")`` + backslash conversion repaired disguised
    names (``.save/x.json``, ``save\\x.json``) into the read face. Exact
    matching must reject them without transformation.
    """

    def test_dot_disguises_never_admitted(self):
        for bad in (
            ".save/rogue.json",
            "./save/rogue.json",
            "..save/rogue.json",
            ".campaign.json",
            "./campaign.json",
            ".logs/rogue.jsonl",
        ):
            assert not scanner.path_is_allowed(bad), bad

    def test_backslash_names_never_admitted(self):
        for bad in (
            "save\\rogue.json",
            "save\\nested\\rogue.json",
            ".\\save\\rogue.json",
            "..\\save\\rogue.json",
            "logs\\rogue.jsonl",
            "memory\\temporal\\rogue.json",
        ):
            assert not scanner.path_is_allowed(bad), bad

    def test_absolute_and_traversal_names_never_admitted(self):
        for bad in (
            "/save/rogue.json",
            "/campaign.json",
            "save/../rogue.json",
            "save/./rogue.json",
            "./save/rogue.json",
            "../save/rogue.json",
            "save//rogue.json",
            "save/rogue/../x.json",
        ):
            assert not scanner.path_is_allowed(bad), bad

    def test_ignore_face_requires_exact_name_too(self):
        # A disguised spelling is not the ignored name either; it lands
        # outside every face instead of being repaired into one.
        for bad in (
            ".save/session-state.json",
            "./save/session-state.json",
            "save\\session-state.json",
            "./logs/pending-turns/x.jsonl",
        ):
            assert not scanner.path_is_ignored(bad), bad
            assert not scanner.path_is_allowed(bad), bad

    def test_exact_read_face_unchanged(self):
        for good in (
            "campaign.json",
            "party.json",
            "save/rogue.json",
            "logs/rogue.jsonl",
            "scenario/rogue.json",
            "memory/temporal/rogue.jsonl",
        ):
            assert scanner.path_is_allowed(good), good


class TestScanCampaignHistory:
    def test_walks_main_fork_and_merge_commits(self, campaign):
        _root, shas, commits = campaign
        assert {c["sha"] for c in commits} == set(shas.values())

        order = [c["sha"] for c in commits]
        assert order.index(shas["baseline"]) < order.index(shas["turn1"])
        assert order.index(shas["baseline"]) < order.index(shas["fork_turn1"])
        assert order.index(shas["turn1"]) < order.index(shas["merge"])
        assert order.index(shas["fork_turn1"]) < order.index(shas["merge"])
        assert order.index(shas["merge"]) < order.index(shas["turn2"])

        assert _record(commits, shas["baseline"])["parents"] == []
        assert _record(commits, shas["turn1"])["parents"] == [shas["baseline"]]
        assert _record(commits, shas["fork_turn1"])["parents"] == [shas["turn1"]]
        # First parent stays the timeline that merged (main).
        assert _record(commits, shas["merge"])["parents"] == [
            shas["turn1"],
            shas["fork_turn1"],
        ]
        assert _record(commits, shas["turn2"])["parents"] == [shas["merge"]]

    def test_trailers_parsed_into_record_fields(self, campaign):
        _root, shas, commits = campaign
        turn1 = _record(commits, shas["turn1"])
        assert turn1["campaign_id"] == CAMPAIGN_ID
        assert turn1["timeline_id"] == "tl-main"
        assert turn1["turn_number"] == 1
        assert turn1["finalization_id"] == "main-001"
        assert turn1["commit_type"] == "turn"

        fork = _record(commits, shas["fork_turn1"])
        assert fork["timeline_id"] == "tl-fork"
        assert fork["turn_number"] == 1
        assert fork["finalization_id"] == "fork-001"

        # Merge commit carries no timeline/turn trailers: deterministic
        # defaults apply instead of invented values.
        merge = _record(commits, shas["merge"])
        assert merge["timeline_id"] == scanner.DEFAULT_TIMELINE_ID
        assert merge["turn_number"] is None
        assert merge["finalization_id"] is None
        assert merge["commit_type"] == "timeline-merge"

    def test_records_only_allowed_tracked_files_sorted_by_path(self, campaign):
        _root, shas, commits = campaign
        baseline = _record(commits, shas["baseline"])
        assert _paths(baseline) == EXPECTED_BASELINE_PATHS

        fork = _record(commits, shas["fork_turn1"])
        assert _paths(fork) == sorted(
            set(EXPECTED_BASELINE_PATHS) | {"memory/temporal/stream.jsonl"}
        )

        for record in commits:
            for relpath in _paths(record):
                assert scanner.path_is_allowed(relpath), relpath

    def test_file_text_matches_worktree_content(self, campaign):
        root, shas, commits = campaign
        worktree = root / ".coc" / "campaigns" / CAMPAIGN_ID
        baseline = _record(commits, shas["baseline"])
        by_path = {f["path"]: f for f in baseline["files"]}
        assert by_path["campaign.json"]["text"] == BASELINE_FILES["campaign.json"]
        assert (
            by_path["memory/temporal/assertions.jsonl"]["text"]
            == BASELINE_FILES["memory/temporal/assertions.jsonl"]
        )
        assert by_path["save/world-state.json"]["text"] == '{"day": 1}\n'

        turn1 = _record(commits, shas["turn1"])
        state = {f["path"]: f for f in turn1["files"]}["save/world-state.json"]
        assert state["text"] == '{"day": 2}\n'
        assert state["blob_sha"] != by_path["save/world-state.json"]["blob_sha"]

    def test_tree_digest_is_deterministic_and_content_sensitive(self, campaign):
        _root, shas, commits = campaign
        for record in commits:
            assert isinstance(record["tree_digest"], str)
            assert len(record["tree_digest"]) == 64
            int(record["tree_digest"], 16)
        assert (
            _record(commits, shas["baseline"])["tree_digest"]
            != _record(commits, shas["turn1"])["tree_digest"]
        )
        assert scanner._tree_digest([("a", "1"), ("b", "2")]) == scanner._tree_digest(
            [("a", "1"), ("b", "2")]
        )
        assert scanner._tree_digest([("a", "1")]) != scanner._tree_digest(
            [("a", "2")]
        )

    def test_scan_is_deterministic_across_runs(self, tmp_path, campaign):
        root, _shas, commits = campaign
        again = scanner.scan_campaign_history(root, CAMPAIGN_ID)
        assert again == commits

    def test_missing_repo_scans_empty(self, tmp_path):
        assert scanner.scan_campaign_history(tmp_path / "nope", CAMPAIGN_ID) == []

    def test_empty_repo_scans_empty(self, tmp_path):
        repo = _repo(tmp_path)
        repo.parent.mkdir(parents=True, exist_ok=True)
        _git("init", "--bare", str(repo))
        assert scanner.scan_campaign_history(tmp_path / "camp-root", CAMPAIGN_ID) == []

    def test_unsafe_campaign_id_rejected(self, tmp_path):
        root = tmp_path / "camp-root"
        for bad in ("../evil", "a/b", "", "camp id", None, 3):
            with pytest.raises(ValueError):
                scanner.scan_campaign_history(root, bad)

    def test_symlinked_repo_path_rejected(self, tmp_path):
        root = tmp_path / "camp-root"
        repos = root / ".coc" / "repos" / "campaigns"
        repos.mkdir(parents=True, exist_ok=True)
        target = tmp_path / "elsewhere.git"
        target.mkdir()
        (repos / f"{CAMPAIGN_ID}.git").symlink_to(target)
        with pytest.raises(ValueError):
            scanner.repo_path_for(root, CAMPAIGN_ID)


class TestAdversarialScan:
    """End-to-end adversarial repos: disguised names, corrupt provenance."""

    def test_disguised_and_backslash_tracked_names_stay_invisible(self, tmp_path):
        # These names really exist in the tree; a normalizing scanner would
        # rewrite them into the read face and project them.
        root = _build_repo_with(
            tmp_path,
            files={
                "campaign.json": '{"campaign_id": "hist-scan-camp"}\n',
                "save/world-state.json": '{"day": 1}\n',
                ".save/rogue.json": '{"rogue": 1}\n',
                "..save/rogue.json": '{"rogue": 2}\n',
                ".campaign.json": '{"rogue": 3}\n',
                # Literal backslash file names (one flat, one pseudo-nested).
                "save\\rogue.json": '{"rogue": 4}\n',
                "save\\nested\\rogue.json": '{"rogue": 5}\n',
                "logs\\rogue.jsonl": '{"rogue": 6}\n',
            },
        )
        commits = scanner.scan_campaign_history(root, CAMPAIGN_ID)
        assert len(commits) == 1
        assert _paths(commits[0]) == ["campaign.json", "save/world-state.json"]
        # Deterministic across reruns, and the diff face hides them too.
        assert scanner.scan_campaign_history(root, CAMPAIGN_ID) == commits
        changes = scanner.diff_commits(root, CAMPAIGN_ID, None, commits[0]["sha"])
        assert [c["path"] for c in changes] == [
            "campaign.json",
            "save/world-state.json",
        ]
        assert all(c["change"] == "added" for c in changes)

    def test_non_utf8_tracked_path_skipped_without_transformation(self, tmp_path):
        root = _build_repo_with(
            tmp_path,
            files={
                "campaign.json": '{"campaign_id": "hist-scan-camp"}\n',
                "save/world-state.json": '{"day": 1}\n',
            },
            raw_path_files={
                b"save/\xffrogue.json": b'{"rogue": 1}\n',
            },
        )
        commits = scanner.scan_campaign_history(root, CAMPAIGN_ID)
        assert len(commits) == 1
        # The corrupt name is skipped exactly as tracked; it must not be
        # transcoded into the read face (e.g. via U+FFFD replacement) and
        # must not fail the otherwise-clean scan.
        assert _paths(commits[0]) == ["campaign.json", "save/world-state.json"]
        assert all("\ufffd" not in path for path in _paths(commits[0]))

    def test_invalid_utf8_blob_fails_closed(self, tmp_path):
        root = _build_repo_with(
            tmp_path,
            files={"campaign.json": '{"campaign_id": "hist-scan-camp"}\n'},
            raw_files={"save/world-state.json": b'{"day": 1}\xff\xfe\n'},
        )
        with pytest.raises(scanner.GitScanError) as excinfo:
            scanner.scan_campaign_history(root, CAMPAIGN_ID)
        assert "not valid UTF-8" in str(excinfo.value)

    def test_multibyte_utf8_blob_passes_through_exactly(self, tmp_path):
        payload = '{"day": 1, "scene": "夜色深沉"}\n'
        root = _build_repo_with(
            tmp_path,
            files={
                "campaign.json": '{"campaign_id": "hist-scan-camp"}\n',
                "save/world-state.json": payload,
            },
        )
        commits = scanner.scan_campaign_history(root, CAMPAIGN_ID)
        texts = {f["path"]: f["text"] for f in commits[0]["files"]}
        assert texts["save/world-state.json"] == payload

    def test_foreign_campaign_trailer_fails_closed(self, tmp_path):
        root = _build_repo_with(
            tmp_path,
            files={"campaign.json": '{"campaign_id": "hist-scan-camp"}\n'},
            trailers=[
                ("Campaign-Id", "other-camp"),
                ("Timeline-Id", "tl-main"),
            ],
        )
        with pytest.raises(scanner.GitScanError) as excinfo:
            scanner.scan_campaign_history(root, CAMPAIGN_ID)
        message = str(excinfo.value)
        assert "Campaign-Id" in message
        assert "other-camp" in message

    def test_campaign_trailer_must_match_exactly(self, tmp_path):
        # Exact equality, not case-insensitive or fuzzy matching.
        root = _build_repo_with(
            tmp_path,
            files={"campaign.json": '{}\n'},
            trailers=[("Campaign-Id", CAMPAIGN_ID.upper())],
        )
        with pytest.raises(scanner.GitScanError):
            scanner.scan_campaign_history(root, CAMPAIGN_ID)

    @pytest.mark.parametrize(
        "bad_timeline",
        [
            "MAIN",  # no tl- semantic prefix
            "main",
            "tl-a:b",  # colon is ref-unsafe
            "tl-../evil",  # traversal spelling
            "tl-main/evil",  # path separator
            "../evil",
        ],
    )
    def test_malformed_timeline_trailer_fails_closed(self, tmp_path, bad_timeline):
        root = _build_repo_with(
            tmp_path,
            files={"campaign.json": '{}\n'},
            trailers=[
                ("Campaign-Id", CAMPAIGN_ID),
                ("Timeline-Id", bad_timeline),
            ],
        )
        with pytest.raises(scanner.GitScanError) as excinfo:
            scanner.scan_campaign_history(root, CAMPAIGN_ID)
        assert "Timeline-Id" in str(excinfo.value)

    @pytest.mark.parametrize(
        "good_timeline",
        ["tl-main", "tl-fork", "tl-crimson-dawn-2", "tl-phase2"],
    )
    def test_semantic_timeline_trailers_scan_cleanly(self, tmp_path, good_timeline):
        root = _build_repo_with(
            tmp_path,
            files={"campaign.json": '{}\n'},
            trailers=[
                ("Campaign-Id", CAMPAIGN_ID),
                ("Timeline-Id", good_timeline),
            ],
        )
        commits = scanner.scan_campaign_history(root, CAMPAIGN_ID)
        assert commits[0]["timeline_id"] == good_timeline


class TestResolveCommit:
    def test_no_selectors_returns_latest(self, campaign):
        _root, shas, commits = campaign
        assert scanner.resolve_commit(commits)["sha"] == shas["turn2"]

    def test_timeline_only_returns_latest_on_timeline(self, campaign):
        _root, shas, commits = campaign
        assert scanner.resolve_commit(commits, timeline_id="tl-main")["sha"] == shas[
            "turn2"
        ]

    def test_timeline_and_turn_select_main_turn(self, campaign):
        _root, shas, commits = campaign
        resolved = scanner.resolve_commit(
            commits, timeline_id="tl-main", turn_number=1
        )
        assert resolved["sha"] == shas["turn1"]

    def test_timeline_and_turn_select_fork_turn(self, campaign):
        _root, shas, commits = campaign
        resolved = scanner.resolve_commit(
            commits, timeline_id="tl-fork", turn_number=1
        )
        assert resolved["sha"] == shas["fork_turn1"]

    def test_full_sha_and_unique_prefix(self, campaign):
        _root, shas, commits = campaign
        assert scanner.resolve_commit(commits, commit_sha=shas["turn1"])["sha"] == shas[
            "turn1"
        ]
        assert scanner.resolve_commit(commits, commit_sha=shas["turn1"][:8])["sha"] == (
            shas["turn1"]
        )

    def test_sha_combined_with_semantic_filters(self, campaign):
        _root, shas, commits = campaign
        assert (
            scanner.resolve_commit(
                commits, commit_sha=shas["fork_turn1"], timeline_id="tl-main"
            )
            is None
        )

    def test_unknown_selectors_return_none(self, campaign):
        _root, _shas, commits = campaign
        assert scanner.resolve_commit(commits, timeline_id="tl-none") is None
        assert (
            scanner.resolve_commit(commits, timeline_id="tl-main", turn_number=99)
            is None
        )
        unknown = "0" * 40
        assert scanner.resolve_commit(commits, commit_sha=unknown) is None
        assert scanner.resolve_commit(commits, commit_sha=unknown[:7]) is None

    def test_ambiguous_prefix_raises(self):
        commits = [
            {"sha": "aaab000000000000000000000000000000000000", "timeline_id": "tl-main"},
            {"sha": "aaac000000000000000000000000000000000000", "timeline_id": "tl-main"},
        ]
        with pytest.raises(scanner.GitScanError):
            scanner.resolve_commit(commits, commit_sha="aaa")

    def test_invalid_selector_values_rejected(self, campaign):
        _root, _shas, commits = campaign
        with pytest.raises(ValueError):
            scanner.resolve_commit(commits, turn_number="1")
        with pytest.raises(ValueError):
            scanner.resolve_commit(commits, turn_number=True)
        with pytest.raises(ValueError):
            scanner.resolve_commit(commits, timeline_id="")
        with pytest.raises(ValueError):
            scanner.resolve_commit(commits, commit_sha="")


class TestDiffCommits:
    def test_structured_diff_between_turns(self, campaign):
        root, shas, commits = campaign
        changes = scanner.diff_commits(root, CAMPAIGN_ID, shas["baseline"], shas["turn1"])
        assert [c["path"] for c in changes] == [
            "logs/turn-finalizations.jsonl",
            "save/world-state.json",
        ]
        assert all(c["change"] == "modified" for c in changes)
        baseline_state = {
            f["path"]: f["blob_sha"]
            for f in _record(commits, shas["baseline"])["files"]
        }
        turn1_state = {
            f["path"]: f["blob_sha"]
            for f in _record(commits, shas["turn1"])["files"]
        }
        for change in changes:
            assert change["from_blob_sha"] == baseline_state[change["path"]]
            assert change["to_blob_sha"] == turn1_state[change["path"]]

    def test_diff_includes_added_paths(self, campaign):
        root, shas, _commits = campaign
        changes = scanner.diff_commits(
            root, CAMPAIGN_ID, shas["turn1"], shas["fork_turn1"]
        )
        by_path = {c["path"]: c for c in changes}
        assert by_path["memory/temporal/stream.jsonl"]["change"] == "added"
        assert by_path["memory/temporal/stream.jsonl"]["from_blob_sha"] is None
        assert by_path["save/world-state.json"]["change"] == "modified"
        assert [c["path"] for c in changes] == sorted(by_path)

    def test_diff_from_empty_tree_to_commit(self, campaign):
        root, shas, _commits = campaign
        changes = scanner.diff_commits(root, CAMPAIGN_ID, None, shas["baseline"])
        assert [c["path"] for c in changes] == EXPECTED_BASELINE_PATHS
        assert all(c["change"] == "added" for c in changes)

    def test_diff_from_commit_to_empty_tree(self, campaign):
        root, shas, _commits = campaign
        changes = scanner.diff_commits(root, CAMPAIGN_ID, shas["baseline"], None)
        assert [c["path"] for c in changes] == EXPECTED_BASELINE_PATHS
        assert all(c["change"] == "removed" for c in changes)

    def test_diff_same_commit_is_empty_and_accepts_prefix(self, campaign):
        root, shas, _commits = campaign
        assert scanner.diff_commits(root, CAMPAIGN_ID, shas["turn2"], shas["turn2"]) == []
        assert scanner.diff_commits(
            root, CAMPAIGN_ID, shas["turn2"][:8], shas["turn2"]
        ) == []

    def test_diff_ignores_ignored_path_changes(self, campaign):
        root, shas, _commits = campaign
        # turn 2 also rewrote save/session-state.json; it must not appear.
        changes = scanner.diff_commits(root, CAMPAIGN_ID, shas["merge"], shas["turn2"])
        assert [c["path"] for c in changes] == [
            "logs/turn-finalizations.jsonl",
            "save/world-state.json",
        ]

    def test_diff_unknown_commit_raises(self, campaign):
        root, _shas, _commits = campaign
        with pytest.raises(scanner.GitScanError):
            scanner.diff_commits(root, CAMPAIGN_ID, "0" * 40, "0" * 40)

    def test_diff_validation(self, campaign):
        root, _shas, _commits = campaign
        with pytest.raises(ValueError):
            scanner.diff_commits(root, "../evil", "x", "y")
        with pytest.raises(scanner.GitScanError):
            scanner.diff_commits(root / "no-repo-here", CAMPAIGN_ID, None, None)


class TestReadOnlyGuarantee:
    def test_scan_and_diff_never_mutate_repo_or_worktree(self, tmp_path, campaign):
        root, shas, _commits = campaign
        repo = _repo(tmp_path)
        worktree = root / ".coc" / "campaigns" / CAMPAIGN_ID

        def repo_state() -> str:
            refs = _git("for-each-ref", repo=repo)
            head = _git("rev-parse", "HEAD", repo=repo)
            objects = _git("count-objects", "-v", repo=repo)
            files = sorted(
                str(p.relative_to(repo)) for p in repo.rglob("*") if p.is_file()
            )
            return "\n".join([refs, head, objects, *files])

        def worktree_state() -> str:
            digest = hashlib.sha256()
            for path in sorted(p for p in worktree.rglob("*") if p.is_file()):
                digest.update(str(path.relative_to(worktree)).encode())
                digest.update(path.read_bytes())
            return digest.hexdigest()

        before_repo = repo_state()
        before_worktree = worktree_state()

        scanner.scan_campaign_history(root, CAMPAIGN_ID)
        scanner.diff_commits(root, CAMPAIGN_ID, shas["baseline"], shas["turn2"])
        scanner.resolve_commit(
            scanner.scan_campaign_history(root, CAMPAIGN_ID),
            timeline_id="tl-fork",
            turn_number=1,
        )

        assert repo_state() == before_repo
        assert worktree_state() == before_worktree
        assert not (repo / "index.lock").exists()
