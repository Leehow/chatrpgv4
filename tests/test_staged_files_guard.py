from __future__ import annotations

from pathlib import Path
import subprocess
import sys

from scripts.check_staged_files import GUARDED_ROOT_PATTERNS


ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / "scripts" / "check_staged_files.py"


def _run(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=repo,
        text=True,
        capture_output=True,
        check=False,
    )


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return _run(repo, "git", *args)


def _init_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    assert _git(repo, "init", "-q").returncode == 0
    assert _git(repo, "config", "user.name", "Guard Test").returncode == 0
    assert _git(repo, "config", "user.email", "guard@example.invalid").returncode == 0
    (repo / ".gitignore").write_text(
        "/artifacts/\n/desktop/build/\n/desktop/dist/\n",
        encoding="utf-8",
    )
    (repo / "tracked.txt").write_text("baseline\n", encoding="utf-8")
    assert _git(repo, "add", ".gitignore", "tracked.txt").returncode == 0
    assert _git(repo, "commit", "-qm", "baseline").returncode == 0
    return repo


def _guard(repo: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return _run(
        repo,
        sys.executable,
        str(GUARD),
        "--repo",
        str(repo),
        *extra,
    )


def test_guard_reports_exact_evidence_path_and_does_not_change_index(tmp_path: Path):
    repo = _init_repo(tmp_path)
    evidence = repo / "artifacts" / "run.log"
    evidence.parent.mkdir()
    evidence.write_bytes(b"kept evidence\n")
    assert _git(repo, "add", "-f", "artifacts/run.log").returncode == 0
    before = _git(repo, "diff", "--cached", "--name-status").stdout

    result = _guard(repo)

    assert result.returncode == 1
    assert (
        "artifacts/run.log\t14 bytes\tpath is protected by committed repository policy"
        in result.stderr
    )
    assert _git(repo, "diff", "--cached", "--name-status").stdout == before
    assert evidence.read_bytes() == b"kept evidence\n"


def test_guard_reports_large_blob_and_generated_app_payload(tmp_path: Path):
    repo = _init_repo(tmp_path)
    app_file = repo / "stray" / "Pi Keeper.app" / "Contents" / "payload.bin"
    app_file.parent.mkdir(parents=True)
    app_file.write_bytes(b"12345")
    assert _git(repo, "add", str(app_file.relative_to(repo))).returncode == 0

    result = _guard(repo, "--max-bytes", "4")

    assert result.returncode == 1
    assert "stray/Pi Keeper.app/Contents/payload.bin\t5 bytes" in result.stderr
    assert "generated App or desktop build payload" in result.stderr
    assert "blob exceeds 4 bytes" in result.stderr


def test_guard_rejects_small_forced_staged_desktop_build_payloads(tmp_path: Path):
    repo = _init_repo(tmp_path)
    payloads = (
        repo / "desktop" / "build" / "payload" / "manifest.json",
        repo / "desktop" / "dist" / "Pi-Keeper.dmg",
    )
    for payload in payloads:
        payload.parent.mkdir(parents=True, exist_ok=True)
        payload.write_bytes(b"x")
        assert _git(repo, "add", "-f", str(payload.relative_to(repo))).returncode == 0

    result = _guard(repo)

    assert result.returncode == 1
    for relative in (
        "desktop/build/payload/manifest.json",
        "desktop/dist/Pi-Keeper.dmg",
    ):
        assert (
            f"{relative}\t1 bytes\tgenerated App or desktop build payload"
            in result.stderr
        )


def test_guard_rejects_a_large_modified_tracked_file(tmp_path: Path):
    repo = _init_repo(tmp_path)
    tracked = repo / "tracked.txt"
    tracked.write_bytes(b"12345")
    assert _git(repo, "add", "tracked.txt").returncode == 0

    result = _guard(repo, "--max-bytes", "4")

    assert result.returncode == 1
    assert "tracked.txt\t5 bytes\tblob exceeds 4 bytes" in result.stderr


def test_committed_range_rejects_the_proposed_blob_not_an_empty_ci_index(tmp_path: Path):
    repo = _init_repo(tmp_path)
    tracked = repo / "tracked.txt"
    tracked.write_bytes(b"12345")
    assert _git(repo, "add", "tracked.txt").returncode == 0
    assert _git(repo, "commit", "-qm", "large change").returncode == 0

    result = _guard(
        repo,
        "--base",
        "HEAD^",
        "--head",
        "HEAD",
        "--max-bytes",
        "4",
    )

    assert result.returncode == 1
    assert "committed-range guard: suspicious proposed files" in result.stderr
    assert "tracked.txt\t5 bytes\tblob exceeds 4 bytes" in result.stderr


def test_committed_range_ignores_machine_local_exclude_rules(tmp_path: Path):
    repo = _init_repo(tmp_path)
    (repo / ".git" / "info" / "exclude").write_text(
        "tracked.txt\n",
        encoding="utf-8",
    )
    (repo / "tracked.txt").write_text("changed\n", encoding="utf-8")
    assert _git(repo, "add", "tracked.txt").returncode == 0
    assert _git(repo, "commit", "-qm", "ordinary tracked change").returncode == 0

    result = _guard(repo, "--base", "HEAD^", "--head", "HEAD")

    assert result.returncode == 0
    assert result.stdout.strip() == "committed-range guard: no suspicious proposed files"
    assert result.stderr == ""


def test_guard_accepts_an_ordinary_small_staged_source_file(tmp_path: Path):
    repo = _init_repo(tmp_path)
    source = repo / "src" / "example.py"
    source.parent.mkdir()
    source.write_text("value = 1\n", encoding="utf-8")
    assert _git(repo, "add", "src/example.py").returncode == 0

    result = _guard(repo)

    assert result.returncode == 0
    assert result.stdout.strip() == "staged-file guard: no suspicious proposed files"
    assert result.stderr == ""


def test_guarded_paths_match_the_exact_root_gitignore_block():
    lines = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    marker = "# Generated local evidence and runtime scratch — retain on disk, never stage"
    start = lines.index(marker) + 1
    end = lines.index("", start)

    assert tuple(lines[start:end]) == GUARDED_ROOT_PATTERNS


def test_ci_consumes_committed_range_mode():
    workflow = (ROOT / ".github" / "workflows" / "tests.yml").read_text(
        encoding="utf-8"
    )
    assert "fetch-depth: 0" in workflow
    assert "scripts/check_staged_files.py" in workflow
    assert '--base "$base_sha" --head HEAD' in workflow
