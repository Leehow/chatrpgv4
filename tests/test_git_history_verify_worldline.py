"""Deterministic-verification gate for the worldline/temporal sweeps.

Covers ``coc_git_history_verify.py`` beyond the original git-side checks:

- schema-generation pins (projection, timeline-state, temporal contract);
- worldline DAG rules over ``save/timeline-state.json`` (unique tl-main
  root, parent reachability, cycles, fork/confluence arity, active
  pointer), reusing the fork/confluence fixture shapes from
  ``tests/test_git_history_verify.py``;
- trailer completeness swept across *all* lineages, including unrecorded
  confluence commits and duplicate-parent merges;
- zero-record explicitness for timelines/confluences/transfers/episodes/
  backlog — zero is reported as zero;
- projection-vs-Git identity through the facade's ``projection_runs``
  row (missing -> "rebuild needed"; corrupt store -> finding, never an
  exception);
- exit-code semantics: findings drive non-zero exits, never vacuous passes.

Read-only guarantee: the verifier never writes the campaign tree, sidecar
repo, or cache; fixtures own their tmp_path campaigns. Every tampering
test hand-edits only its own tmp_path save (never live campaign data).
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
VERIFY_SCRIPT = SCRIPTS / "coc_git_history_verify.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


hist = load_module("coc_git_history", SCRIPTS / "coc_git_history.py")
verify = load_module("coc_git_history_verify", VERIFY_SCRIPT)
coc_state = load_module("coc_state", SCRIPTS / "coc_state.py")
proj = load_module(
    "coc_history_projection", SCRIPTS / "coc_history_projection.py"
)
proj_schema = load_module(
    "coc_history_projection_schema", SCRIPTS / "coc_history_projection_schema.py"
)
tm = load_module(
    "coc_temporal_memory_contract", SCRIPTS / "coc_temporal_memory_contract.py"
)

SCHEMA = hist.format_schema_generation(coc_state.CURRENT_SCHEMA_VERSIONS)
CAMPAIGN_ID = "worldline-verify"
ZERO_COUNTS = {
    "timelines": 0,
    "confluences": 0,
    "transfers": 0,
    "episodes": 0,
    "backlog": 0,
    "ambiguous_canonical_ids": 0,
}


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


def _worktree(root: Path, campaign_id: str = CAMPAIGN_ID) -> Path:
    return root / ".coc" / "campaigns" / campaign_id


def _git(
    root: Path,
    *args: str,
    check: bool = True,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    env["GIT_TERMINAL_PROMPT"] = "0"
    return subprocess.run(
        [
            "git",
            "-c",
            "user.name=coc-keeper",
            "-c",
            "user.email=coc-keeper@localhost",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "safe.directory=*",
            f"--git-dir={root / '.coc' / 'repos' / 'campaigns' / f'{CAMPAIGN_ID}.git'}",
            f"--work-tree={_worktree(root)}",
            *args,
        ],
        check=check,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
        input=input_text,
    )


def _tree_fingerprint(path: Path) -> str:
    digest_bytes = []
    for item in sorted(path.rglob("*"), key=lambda p: p.as_posix()):
        rel = item.relative_to(path).as_posix().encode("utf-8")
        if item.is_symlink():
            digest_bytes.append(b"L" + rel + os.readlink(item).encode())
        elif item.is_file():
            digest_bytes.append(b"F" + rel + item.read_bytes())
        elif item.is_dir():
            digest_bytes.append(b"D" + rel)
    import hashlib

    return hashlib.sha256(b"".join(digest_bytes)).hexdigest()


def _workspace_fingerprint(root: Path) -> tuple[str, str]:
    return (
        _tree_fingerprint(root / ".coc"),
        _tree_fingerprint(_worktree(root)),
    )


def _write_receipts(root: Path, finalization_ids: list[str]) -> None:
    path = _worktree(root) / "logs" / "turn-finalizations.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    for index, fid in enumerate(finalization_ids, start=1):
        lines.append(
            json.dumps(
                {
                    "finalization_id": fid,
                    "decision_id": f"dec-{index}",
                    "journal_decision_id": f"journal-{index}",
                },
                ensure_ascii=False,
            )
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _commit_turn(
    root: Path,
    turn_number: int,
    finalization_id: str,
    *,
    schema_generation: str = SCHEMA,
) -> str:
    return hist.commit_finalized_turn(
        root,
        CAMPAIGN_ID,
        turn_number=turn_number,
        finalization_id=finalization_id,
        journal_decision_id=f"journal-{turn_number}",
        settlement_snapshot_id=f"settle-{turn_number}",
        rendered_text_sha256="a" * 64,
        schema_generation=schema_generation,
    )


def _prepare_campaign(root: Path) -> Path:
    coc_state.create_campaign(root, CAMPAIGN_ID, "Worldline Verify Fixture")
    hist.ensure_repo(root, CAMPAIGN_ID)
    hist.commit_baseline(
        root,
        CAMPAIGN_ID,
        schema_generation=SCHEMA,
        note="initial campaign generation",
    )
    return _worktree(root)


def _clean_main_fixture(root: Path, *, turns: int = 2) -> Path:
    """Single-timeline campaign: baseline + finalized turns + fresh cache."""
    _prepare_campaign(root)
    fids = [f"fin-{index:04d}" for index in range(1, turns + 1)]
    _write_receipts(root, fids)
    for index, fid in enumerate(fids, start=1):
        _commit_turn(root, index, fid)
    proj.rebuild_history_projection(root, CAMPAIGN_ID)
    return _worktree(root)


def _rewrite_timeline_state(worktree: Path, mutate) -> None:
    """Hand-edit save/timeline-state.json in place (tamper harness)."""
    path = worktree / hist.TIMELINE_STATE_RELPATH
    payload = json.loads(path.read_text(encoding="utf-8"))
    mutate(payload)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _note_world_branch(worktree: Path, branch: str) -> None:
    """Diverge the tracked world file with a schema-valid extra field.

    Only ``schema_version`` (int) and identity fields are validated, so an
    added ``world_note`` key yields a genuinely different blob without
    tripping the schema readers.
    """
    path = worktree / "save" / "world-state.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["world_note"] = branch
    path.write_text(
        json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def _write_temporal_store(
    root: Path, filename: str, lines: list[str]
) -> Path:
    path = _worktree(root) / "memory" / "temporal" / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "".join(line if line.endswith("\n") else line + "\n" for line in lines)
    path.write_text(text, encoding="utf-8")
    return path


def _append_log_row(root: Path, relpath: str, row: dict) -> None:
    """Append one structured JSONL row to a tracked campaign log."""
    path = _worktree(root) / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _codes(proof) -> list[str]:
    return [item.code for item in proof.findings]


def _run_verify(root: Path, *extra: str) -> tuple[int, str, str]:
    completed = subprocess.run(
        [
            sys.executable,
            str(VERIFY_SCRIPT),
            "--root",
            str(root),
            "--campaign",
            CAMPAIGN_ID,
            *extra,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    return completed.returncode, completed.stdout, completed.stderr


def _record_counts_line(infos) -> str:
    matches = [line for line in infos if line.startswith("record_counts")]
    assert len(matches) == 1, infos
    return matches[0]


# ---------------------------------------------------------------------------
# Shared worldline fixtures (shapes reused from test_git_history_verify.py)
# ---------------------------------------------------------------------------


def _fork_pair_fixture(root: Path) -> Path:
    """main turn1 + tl-left/tl-right turn2, receipts aligned, cache fresh.

    The two side turns diverge the tracked world file with schema-valid
    extra fields so the branches carry genuinely different blobs.
    """
    _prepare_campaign(root)
    worktree = _worktree(root)
    _write_receipts(root, ["fin-0001", "fin-left-2", "fin-right-2"])
    _commit_turn(root, 1, "fin-0001")
    hist.fork_timeline(
        root,
        CAMPAIGN_ID,
        timeline_id="tl-left",
        source_turn=1,
        game_reason="left",
        activate=True,
    )
    _note_world_branch(worktree, "left")
    _commit_turn(root, 2, "fin-left-2")
    hist.set_active_timeline(root, CAMPAIGN_ID, "tl-main")
    hist.fork_timeline(
        root,
        CAMPAIGN_ID,
        timeline_id="tl-right",
        source_turn=1,
        game_reason="right",
        activate=True,
    )
    _note_world_branch(worktree, "right")
    _commit_turn(root, 2, "fin-right-2")
    proj.rebuild_history_projection(root, CAMPAIGN_ID)
    return worktree


def _confluence_conflicts(confluence_id: str) -> list[dict]:
    conflict_id = tm.conflict_id_for(confluence_id, "world-state")
    return [
        {
            "conflict_id": conflict_id,
            "class": "world_fact",
            "left": {
                "timeline": "tl-left",
                "refs": ["save/world-state.json"],
                "value": "left",
            },
            "right": {
                "timeline": "tl-right",
                "refs": ["save/world-state.json"],
                "value": "right",
            },
            "disposition": {"mode": "choose_left", "receipt": "disp-1"},
        }
    ]


def _confluence_fixture(root: Path) -> str:
    """Fork pair plus a real recorded confluence; returns merge commit."""
    worktree = _fork_pair_fixture(root)
    confluence_id = f"confluence-{CAMPAIGN_ID}-tl-merged"
    merged = hist.confluence_timelines(
        root,
        CAMPAIGN_ID,
        timeline_id="tl-merged",
        left_timeline_id="tl-left",
        right_timeline_id="tl-right",
        receipt="conf-1",
        schema_generation=SCHEMA,
        conflicts=_confluence_conflicts(confluence_id),
        path_resolutions={"save/world-state.json": "choose_left"},
        confluence_id=confluence_id,
    )
    proj.rebuild_history_projection(root, CAMPAIGN_ID)
    del worktree
    return merged["merge_commit"]


def _craft_commit(
    root: Path,
    *,
    parents: list[str],
    message: str,
    ref: str | None = None,
) -> str:
    """Plumb a bare commit object into the sidecar repo (test tamper)."""
    if parents:
        tree = _git(root, "rev-parse", f"{parents[0]}^{{tree}}").stdout.strip()
    else:
        # Deterministic empty tree (git canonical empty-directory hash).
        tree = _git(
            root,
            "hash-object",
            "-t",
            "tree",
            "--stdin",
            input_text="",
        ).stdout.strip()
    lines = [f"tree {tree}"]
    for parent in parents:
        lines.append(f"parent {parent}")
    identity = "coc-keeper <coc-keeper@localhost> 1700000000 +0000"
    lines.extend([f"author {identity}", f"committer {identity}"])
    body = "\n".join(lines) + "\n\n" + message
    completed = _git(
        root,
        "hash-object",
        "-t",
        "commit",
        "-w",
        "--stdin",
        input_text=body,
    )
    sha = completed.stdout.strip()
    if ref:
        _git(root, "update-ref", ref, sha)
    return sha


def _full_confluence_message(
    merge_id: str, digest_a: str, digest_b: str
) -> str:
    return "\n".join(
        [
            f"coc confluence: {merge_id}",
            "",
            "COC-Commit-Type: confluence",
            f"Campaign-Id: {CAMPAIGN_ID}",
            "Timeline-Id: tl-merged",
            f"Confluence-Id: {merge_id}",
            "Parent-Timeline-Left: tl-left",
            "Parent-Timeline-Right: tl-right",
            f"Conflict-Manifest-SHA256: {digest_a}",
            f"Disposition-Manifest-SHA256: {digest_b}",
            f"Schema-Generation: {SCHEMA}",
            "",
        ]
    )


# ---------------------------------------------------------------------------
# Schema-generation pins
# ---------------------------------------------------------------------------


def test_schema_generation_pins():
    assert proj_schema.SCHEMA_GENERATION == "history-projection-2"
    assert verify.proj_schema.SCHEMA_GENERATION == "history-projection-2"
    assert hist.TIMELINE_STATE_SCHEMA == "timeline-state-1"
    assert tm.SCHEMA_GENERATION == "temporal-memory-1"
    assert tm.ROOT_TIMELINE_ID == "tl-main"
    # Trailer completeness is pinned to the exact key sets, including the
    # fork/confluence-specific identities and manifest digests.
    assert verify.TURN_TRAILER_KEYS == (
        "COC-Commit-Type",
        "Campaign-Id",
        "Timeline-Id",
        "Turn-Number",
        "Finalization-Id",
        "Journal-Decision-Id",
        "Settlement-Snapshot-Id",
        "Rendered-Text-SHA256",
        "Schema-Generation",
    )
    assert verify.CONFLUENCE_TRAILER_KEYS == (
        "COC-Commit-Type",
        "Campaign-Id",
        "Timeline-Id",
        "Confluence-Id",
        "Parent-Timeline-Left",
        "Parent-Timeline-Right",
        "Conflict-Manifest-SHA256",
        "Disposition-Manifest-SHA256",
        "Schema-Generation",
    )


# ---------------------------------------------------------------------------
# Worldline DAG rules
# ---------------------------------------------------------------------------


def test_clean_main_campaign_passes_with_explicit_zero_records(tmp_path):
    """Single-timeline campaign proves a full PASS and reports all zeroes."""
    _clean_main_fixture(tmp_path)

    code, stdout, stderr = _run_verify(tmp_path)
    assert code == 0, stdout + stderr
    assert "GIT HISTORY CHECK PASSED" in stdout
    assert (
        "record_counts timelines=1 confluences=0 transfers=0 episodes=0 "
        "backlog=0 ambiguous_canonical_ids=0"
    ) in stdout

    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == verify.STATUS_PASS
    assert proof.worldline_counts == {
        "timelines": 1,
        "confluences": 0,
        "transfers": 0,
        "episodes": 0,
        "backlog": 0,
        "ambiguous_canonical_ids": 0,
    }
    counts_line = _record_counts_line(proof.infos)
    assert "confluences=0" in counts_line
    assert "backlog=0" in counts_line


def test_duplicate_timeline_flagged(tmp_path):
    worktree = _fork_pair_fixture(tmp_path)

    def mutate(state):
        state["timelines"].append(dict(state["timelines"][1]))

    _rewrite_timeline_state(worktree, mutate)
    code, stdout, _ = _run_verify(tmp_path)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert verify.CODE_DAG_DUPLICATE in _codes(proof)
    assert code == 1


def test_missing_tl_main_root_flagged_as_invalid_and_disconnected(tmp_path):
    worktree = _fork_pair_fixture(tmp_path)

    def mutate(state):
        state["timelines"] = [
            record
            for record in state["timelines"]
            if record["timeline_id"] != hist.DEFAULT_TIMELINE_ID
        ]
        state["active_timeline_id"] = "tl-left"

    _rewrite_timeline_state(worktree, mutate)
    code, _stdout, _stderr = _run_verify(tmp_path)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    codes = _codes(proof)
    assert verify.CODE_DAG_ROOT in codes
    # With no root nothing is reachable from tl-main.
    assert verify.CODE_DAG_DISCONNECTED in codes
    assert code == 1


def test_second_root_record_flagged(tmp_path):
    worktree = _fork_pair_fixture(tmp_path)

    def mutate(state):
        for record in state["timelines"]:
            if record["timeline_id"] == "tl-left":
                record["kind"] = "root"

    _rewrite_timeline_state(worktree, mutate)
    code, _stdout, _stderr = _run_verify(tmp_path)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert verify.CODE_DAG_ROOT in _codes(proof)
    assert code == 1


def test_unknown_parent_flagged(tmp_path):
    worktree = _fork_pair_fixture(tmp_path)

    def mutate(state):
        for record in state["timelines"]:
            if record["timeline_id"] == "tl-left":
                record["parents"] = ["tl-ghost"]

    _rewrite_timeline_state(worktree, mutate)
    code, stdout, _stderr = _run_verify(tmp_path)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert verify.CODE_DAG_PARENT_UNKNOWN in _codes(proof)
    assert "tl-ghost" in stdout
    assert code == 1


def test_cycle_flagged_without_hanging(tmp_path):
    worktree = _fork_pair_fixture(tmp_path)

    def mutate(state):
        by_id = {r["timeline_id"]: r for r in state["timelines"]}
        by_id[hist.DEFAULT_TIMELINE_ID]["parents"] = ["tl-left"]
        by_id["tl-left"]["parents"] = [hist.DEFAULT_TIMELINE_ID]

    _rewrite_timeline_state(worktree, mutate)
    code, _stdout, _stderr = _run_verify(tmp_path)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    cycle_findings = [
        f for f in proof.findings if f.kind == verify.CODE_DAG_CYCLE
    ]
    assert cycle_findings, _codes(proof)
    assert "tl-left" in cycle_findings[0].detail
    assert code == 1


def test_disconnected_component_flagged(tmp_path):
    worktree = _fork_pair_fixture(tmp_path)

    def mutate(state):
        state["timelines"].append(
            {
                "timeline_id": "tl-isle-a",
                "campaign_id": CAMPAIGN_ID,
                "kind": "root",
                "parents": [],
                "fork_point": None,
                "created_by": "initial",
            }
        )

    _rewrite_timeline_state(worktree, mutate)
    code, _stdout, _stderr = _run_verify(tmp_path)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    codes = _codes(proof)
    assert verify.CODE_DAG_DISCONNECTED in codes
    assert any("tl-isle-a" in f.detail for f in proof.findings)
    # A second kind=root record also violates the unique-root rule.
    assert verify.CODE_DAG_ROOT in codes
    assert code == 1


def test_fork_record_with_two_parents_flagged(tmp_path):
    worktree = _fork_pair_fixture(tmp_path)

    def mutate(state):
        for record in state["timelines"]:
            if record["timeline_id"] == "tl-left":
                record["parents"] = ["tl-main", "tl-right"]

    _rewrite_timeline_state(worktree, mutate)
    code, _stdout, _stderr = _run_verify(tmp_path)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    fork_findings = [
        f for f in proof.findings if f.kind == verify.CODE_FORK_TOPOLOGY
    ]
    assert fork_findings
    assert "exactly one parent" in fork_findings[0].detail
    assert code == 1


def test_confluence_record_arity_enforced_on_state_side(tmp_path):
    _confluence_fixture(tmp_path)
    worktree = _worktree(tmp_path)

    def mutate(state):
        for record in state["timelines"]:
            if record["timeline_id"] == "tl-merged":
                record["parents"] = ["tl-left"]

    _rewrite_timeline_state(worktree, mutate)
    code, _stdout, _stderr = _run_verify(tmp_path)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    confluence_arity = [
        f
        for f in proof.findings
        if f.kind == verify.CODE_CONFLUENCE_PARENTS
        and f.detail.startswith("timeline_id=tl-merged")
    ]
    assert confluence_arity
    assert code == 1


def test_active_pointer_must_reference_known_timeline(tmp_path):
    worktree = _fork_pair_fixture(tmp_path)

    def mutate(state):
        state["active_timeline_id"] = "tl-nope"

    _rewrite_timeline_state(worktree, mutate)
    code, stdout, _stderr = _run_verify(tmp_path)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert verify.CODE_ACTIVE_TIMELINE_INVALID in _codes(proof)
    assert "tl-nope" in stdout
    assert code == 1


# ---------------------------------------------------------------------------
# All-lineage git sweeps
# ---------------------------------------------------------------------------


def test_unrecorded_confluence_commit_flagged(tmp_path):
    _fork_pair_fixture(tmp_path)
    left_sha = _git(tmp_path, "rev-parse", "timelines/tl-left").stdout.strip()
    right_sha = _git(
        tmp_path, "rev-parse", "timelines/tl-right"
    ).stdout.strip()
    merge_id = f"confluence-{CAMPAIGN_ID}-tl-shadow"
    _craft_commit(
        tmp_path,
        parents=[left_sha, right_sha],
        message=_full_confluence_message(merge_id, "b" * 64, "c" * 64),
        ref="refs/heads/timelines/tl-shadow",
    )

    code, _stdout, _stderr = _run_verify(tmp_path)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    codes = _codes(proof)
    # Fully-formed confluence trailers pass, but the commit is not bound
    # to any timeline-state confluence record.
    assert verify.CODE_CONFLUENCE_UNRECORDED in codes
    assert verify.CODE_CONFLUENCE_TRAILER not in codes
    assert code == 1


def test_duplicate_parent_confluence_commit_flagged(tmp_path):
    _fork_pair_fixture(tmp_path)
    left_sha = _git(tmp_path, "rev-parse", "timelines/tl-left").stdout.strip()
    merge_id = f"confluence-{CAMPAIGN_ID}-tl-dup"
    _craft_commit(
        tmp_path,
        parents=[left_sha, left_sha],
        message=_full_confluence_message(merge_id, "d" * 64, "e" * 64),
        ref="refs/heads/timelines/tl-dup",
    )

    code, _stdout, _stderr = _run_verify(tmp_path)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    duplicates = [
        f
        for f in proof.findings
        if f.kind == verify.CODE_CONFLUENCE_PARENTS
        and f.detail.startswith("duplicate_parent_sha=")
    ]
    assert duplicates
    assert code == 1


def test_foreign_lineage_turn_with_incomplete_trailers_flagged(tmp_path):
    worktree = _fork_pair_fixture(tmp_path)
    left_sha = _git(tmp_path, "rev-parse", "timelines/tl-left").stdout.strip()
    message = "\n".join(
        [
            "coc turn 0007: fin-left-x",
            "",
            "COC-Commit-Type: turn",
            f"Campaign-Id: {CAMPAIGN_ID}",
            "Finalization-Id: fin-left-x",
            "",
        ]
    )
    _craft_commit(
        tmp_path,
        parents=[left_sha],
        message=message,
        ref="refs/heads/timelines/tl-left",
    )
    del worktree

    code, _stdout, _stderr = _run_verify(tmp_path)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    incomplete = [
        f
        for f in proof.findings
        if f.kind == "incomplete_trailer" and f.sha
    ]
    assert incomplete
    assert any("missing=" in f.detail for f in incomplete)
    assert code == 1


def test_extra_rootless_commit_breaks_unique_root_invariant(tmp_path):
    _fork_pair_fixture(tmp_path)
    message = "\n".join(
        [
            "coc turn 0042: fin-orphan-root",
            "",
            "COC-Commit-Type: turn",
            f"Campaign-Id: {CAMPAIGN_ID}",
            "Timeline-Id: tl-main",
            "Turn-Number: 42",
            "Finalization-Id: fin-orphan-root",
            "Journal-Decision-Id: journal-42",
            "Settlement-Snapshot-Id: settle-42",
            "Rendered-Text-SHA256: " + ("a" * 64),
            f"Schema-Generation: {SCHEMA}",
            "",
        ]
    )
    # A parentless turn object referenced from a stray ref means rewritten
    # history: more than one rootless commit exists in the object database.
    _craft_commit(
        tmp_path,
        parents=[],
        message=message,
        ref="refs/heads/timelines/tl-stray",
    )

    code, _stdout, _stderr = _run_verify(tmp_path)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    roots = [
        f
        for f in proof.findings
        if f.kind == verify.CODE_DAG_ROOT
        and "rootless_commit_count=" in f.detail
    ]
    assert roots
    assert "rootless_commit_count=2" in roots[0].detail
    assert code == 1


def test_confluence_trailer_completeness_pins(tmp_path):
    _confluence_fixture(tmp_path)
    merge = None
    state = json.loads(
        (_worktree(tmp_path) / hist.TIMELINE_STATE_RELPATH).read_text(
            encoding="utf-8"
        )
    )
    merge = state["confluences"][0]["merge_commit"]
    body = _git(tmp_path, "log", "-1", "--format=%B", merge).stdout
    trailers = hist.parse_trailers(body)
    assert trailers["COC-Commit-Type"] == "confluence"

    stripped = {
        key: value
        for key, value in trailers.items()
        if key != "Parent-Timeline-Left"
    }
    findings = verify._validate_confluence_trailers(
        merge, stripped, campaign_id=CAMPAIGN_ID
    )
    codes = [f.kind for f in findings]
    assert verify.CODE_CONFLUENCE_TRAILER in codes
    missing_finding = next(f for f in findings if f.detail.startswith("missing="))
    assert "Parent-Timeline-Left" in missing_finding.detail

    bad_digest = dict(trailers)
    bad_digest["Conflict-Manifest-SHA256"] = "short"
    findings = verify._validate_confluence_trailers(
        merge, bad_digest, campaign_id=CAMPAIGN_ID
    )
    assert any("not a sha256 digest" in f.detail for f in findings)

    clean = verify._validate_confluence_trailers(
        merge, trailers, campaign_id=CAMPAIGN_ID
    )
    assert clean == []


# ---------------------------------------------------------------------------
# Projection-vs-Git identity
# ---------------------------------------------------------------------------


def test_projection_identity_matches_after_rebuild(tmp_path):
    _clean_main_fixture(tmp_path)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == verify.STATUS_PASS
    # The projection dimension is separate from core findings.
    assert proof.projection_status == verify.STATUS_PASS
    assert list(proof.projection_findings) == []
    payload = proof.to_dict()
    assert payload["projection_status"] == "PASS"
    assert payload["projection_findings"] == []


def test_missing_projection_db_is_dimension_gap_only(tmp_path):
    """A never-built cache never downgrades the core finalize/git proof."""
    _clean_main_fixture(tmp_path)
    db = proj_schema.projection_path(tmp_path, CAMPAIGN_ID)
    db.unlink()

    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    # Core status stays PASS on complete git/finalization evidence; the
    # gap lives only in the projection dimension.
    assert proof.status == verify.STATUS_PASS
    assert _codes(proof) == []
    assert proof.projection_status == verify.STATUS_NOT_PROVEN
    assert [
        f.kind for f in proof.projection_findings
    ] == [verify.CODE_PROJECTION_REBUILD_NEEDED]
    assert "rebuild needed" in proof.projection_findings[0].detail

    code, stdout, stderr = _run_verify(tmp_path, "--json")
    payload = json.loads(stdout)
    assert payload["status"] == "PASS"
    assert payload["findings"] == []
    assert payload["projection_status"] == "NOT_PROVEN"
    assert (
        payload["projection_findings"][0]["code"]
        == verify.CODE_PROJECTION_REBUILD_NEEDED
    )
    assert code == 2  # sweep exit held at 2 until the cache rebuilds
    # Zero-record reporting stays intact even while the cache is gone.
    assert payload["worldline_counts"]["timelines"] == 1
    assert payload["worldline_counts"]["backlog"] == 0
    assert stderr == ""

    # Text mode renders the hybrid verdict without a vacuous-pass error.
    text_code, text_out, text_err = _run_verify(tmp_path)
    assert text_code == 2, text_out + text_err
    assert "GIT HISTORY CHECK PASSED (core)" in text_out
    assert "WORLDLINE GAP" in text_out
    assert "refusing a vacuous pass" not in text_out
    assert text_err == ""


def test_corrupt_projection_fails_dimension_never_raises(tmp_path):
    _clean_main_fixture(tmp_path)
    db = proj_schema.projection_path(tmp_path, CAMPAIGN_ID)
    db.write_bytes(b"this is not sqlite" * 100)

    code, stdout, _stderr = _run_verify(tmp_path, "--json")
    payload = json.loads(stdout)
    # Present-but-wrong cache: hard dimension FAIL (exit 1), while the
    # core finalize/git proof itself stays clean.
    assert payload["projection_status"] == "FAIL"
    dim_codes = [f["code"] for f in payload["projection_findings"]]
    assert verify.CODE_PROJECTION_UNREADABLE in dim_codes
    assert payload["status"] == "PASS"
    assert payload["findings"] == []
    assert code == 1


def test_stale_projection_drifts_after_new_turn(tmp_path):
    _clean_main_fixture(tmp_path)
    # A finalized turn after the last projection rebuild must surface as
    # drift: the cached run row no longer matches the Git head/count.
    path = _worktree(tmp_path) / "logs" / "turn-finalizations.jsonl"
    rows = path.read_text(encoding="utf-8").splitlines()
    rows.append(
        json.dumps(
            {
                "finalization_id": "fin-0009",
                "decision_id": "dec-9",
                "journal_decision_id": "journal-9",
            },
            ensure_ascii=False,
        )
    )
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    _commit_turn(tmp_path, 9, "fin-0009")

    code, stdout, _stderr = _run_verify(tmp_path, "--json")
    payload = json.loads(stdout)
    dim_codes = [f["code"] for f in payload["projection_findings"]]
    assert verify.CODE_PROJECTION_DRIFT in dim_codes
    drift_details = [
        finding["detail"]
        for finding in payload["projection_findings"]
        if finding["code"] == verify.CODE_PROJECTION_DRIFT
    ]
    assert any("projection_runs.head_commit_sha" in d for d in drift_details)
    assert payload["projection_status"] == "FAIL"
    assert payload["status"] == "PASS"
    assert code == 1


def test_projection_generation_marker_tamper_flagged(tmp_path):
    _clean_main_fixture(tmp_path)
    import sqlite3

    db = proj_schema.projection_path(tmp_path, CAMPAIGN_ID)
    conn = sqlite3.connect(db)
    try:
        conn.execute(
            "UPDATE campaigns SET schema_generation = 'history-projection-0'"
        )
        conn.execute(
            "UPDATE projection_runs SET schema_generation = 'history-projection-0'"
        )
        conn.commit()
    finally:
        conn.close()

    code, stdout, _stderr = _run_verify(tmp_path, "--json")
    payload = json.loads(stdout)
    drift = [
        f
        for f in payload["projection_findings"]
        if f["code"] == verify.CODE_PROJECTION_DRIFT
    ]
    assert drift
    assert any("schema_generation" in f["detail"] for f in drift)
    assert payload["projection_status"] == "FAIL"
    assert code == 1


def test_missing_run_row_flagged_when_history_exists(tmp_path):
    _clean_main_fixture(tmp_path)
    import sqlite3

    db = proj_schema.projection_path(tmp_path, CAMPAIGN_ID)
    conn = sqlite3.connect(db)
    try:
        conn.execute("DELETE FROM projection_runs")
        conn.commit()
    finally:
        conn.close()

    code, stdout, _stderr = _run_verify(tmp_path, "--json")
    payload = json.loads(stdout)
    drift = [
        f
        for f in payload["projection_findings"]
        if f["code"] == verify.CODE_PROJECTION_DRIFT
    ]
    assert any("projection_runs rows=0" in f["detail"] for f in drift)
    assert payload["projection_status"] == "FAIL"
    assert code == 1


# ---------------------------------------------------------------------------
# Temporal stores: zero-record explicitness and corruption
# ---------------------------------------------------------------------------


def test_nonzero_store_counts_reported_verbatim(tmp_path):
    _fork_pair_fixture(tmp_path)
    transfer_row = {
        "transfer_id": f"transfer-{CAMPAIGN_ID}-from-tl-left-to-tl-main-turn-2",
        "campaign_id": CAMPAIGN_ID,
        "from_timeline": "tl-left",
        "to_timeline": "tl-main",
    }
    episode_row = {
        "episode_id": f"episode-{CAMPAIGN_ID}-tl-main-turn-1",
        "campaign_id": CAMPAIGN_ID,
    }
    _write_temporal_store(
        tmp_path, "transfers.jsonl", [json.dumps(transfer_row)]
    )
    _write_temporal_store(
        tmp_path,
        "episodes.jsonl",
        [json.dumps(episode_row), json.dumps(dict(episode_row))],
    )

    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.worldline_counts == {
        "timelines": 3,
        "confluences": 0,
        "transfers": 1,
        "episodes": 2,
        "backlog": 0,
        "ambiguous_canonical_ids": 0,
    }
    counts_line = _record_counts_line(proof.infos)
    assert "transfers=1" in counts_line
    assert "episodes=2" in counts_line
    assert "backlog=0" in counts_line


def test_corrupt_temporal_store_line_flagged(tmp_path):
    _clean_main_fixture(tmp_path)
    _write_temporal_store(
        tmp_path, "backlog.jsonl", ['{"ok": true}', "not-json-at-all"]
    )

    code, stdout, _stderr = _run_verify(tmp_path)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    codes = _codes(proof)
    assert verify.CODE_TEMPORAL_STORE_CORRUPT in codes
    assert any("backlog.jsonl" in f.detail for f in proof.findings)
    assert proof.status == "FAIL"
    assert code == 1


# ---------------------------------------------------------------------------
# Advisory canonical-id introduction lineage (single-mint rule)
# ---------------------------------------------------------------------------


def test_duplicate_canonical_id_minted_on_both_siblings_flagged(tmp_path):
    """One roll id minted fresh on both sides after a fork -> one advisory.

    Receipt ledger rows are written up front (the established fixture
    pattern) so the shared accumulating ledger never diverges between
    sibling tips; only the roll row is genuinely minted per side.
    """
    _prepare_campaign(tmp_path)
    _write_receipts(
        tmp_path,
        ["fin-0001", "fin-left-2", "fin-right-2", "fin-left-3", "fin-right-3"],
    )
    _commit_turn(tmp_path, 1, "fin-0001")
    hist.fork_timeline(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-left",
        source_turn=1,
        game_reason="left",
        activate=True,
    )
    _note_world_branch(_worktree(tmp_path), "left")
    _commit_turn(tmp_path, 2, "fin-left-2")
    _append_log_row(
        tmp_path, "logs/table-rolls.jsonl", {"roll_id": "roll-dup-1"}
    )
    _commit_turn(tmp_path, 3, "fin-left-3")

    hist.set_active_timeline(tmp_path, CAMPAIGN_ID, "tl-main")
    hist.fork_timeline(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-right",
        source_turn=1,
        game_reason="right",
        activate=True,
    )
    _note_world_branch(_worktree(tmp_path), "right")
    _commit_turn(tmp_path, 2, "fin-right-2")
    # Same canonical id, minted independently on the sibling tip: neither
    # introduction is an ancestor of the other.
    _append_log_row(
        tmp_path, "logs/table-rolls.jsonl", {"roll_id": "roll-dup-1"}
    )
    _commit_turn(tmp_path, 3, "fin-right-3")
    proj.rebuild_history_projection(tmp_path, CAMPAIGN_ID)

    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    # Advisory severity: core proof and findings stay clean.
    assert proof.status == verify.STATUS_PASS
    assert _codes(proof) == []
    assert proof.worldline_counts["ambiguous_canonical_ids"] == 1
    advisories = list(proof.worldline_advisories)
    assert [entry["canonical_id"] for entry in advisories] == ["roll-dup-1"]
    # Shared working tree: the right branch's separating commit (whose
    # parent predates the roll row) is the right side's first fresh
    # carrier, hence turn 2 — the pair itself is what must be reported.
    intros = advisories[0]["introductions"]
    assert [
        (intro["timeline_id"], intro["turn_number"])
        for intro in intros
    ] == [("tl-left", 3), ("tl-right", 2)]
    assert all(len(intro["commit"]) == 40 for intro in intros)

    payload = proof.to_dict()
    assert payload["worldline_counts"]["ambiguous_canonical_ids"] == 1
    assert payload["worldline_advisories"] == advisories
    assert "ambiguous_canonical_ids=1" in _record_counts_line(proof.infos)

    # Advisory surfaces in the text report without flipping the exit code.
    code, stdout, stderr = _run_verify(tmp_path)
    assert code == 0
    assert stderr == ""
    advisory_lines = [
        line
        for line in stdout.splitlines()
        if line.startswith("info: ambiguous_canonical_id")
    ]
    assert advisory_lines == [
        "info: ambiguous_canonical_id roll-dup-1: "
        "introductions tl-left@turn3 tl-right@turn2"
    ]
    assert "GIT HISTORY CHECK PASSED" in stdout

    # Deterministic output across runs (no wall clock, stable ordering).
    repeat_code, repeat_stdout, repeat_stderr = _run_verify(tmp_path)
    assert (repeat_code, repeat_stdout, repeat_stderr) == (code, stdout, stderr)
    repeat_proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert list(repeat_proof.worldline_advisories) == advisories
    assert (
        [dict(entry) for entry in repeat_proof.worldline_advisories]
        == [dict(entry) for entry in proof.worldline_advisories]
    )
    assert repeat_proof.worldline_counts == proof.worldline_counts
    assert repeat_proof.findings == proof.findings


def test_child_inherits_parent_introduction_not_flagged(tmp_path):
    """Fork replay of a parent-era id never counts as a second mint."""
    _prepare_campaign(tmp_path)
    _write_receipts(tmp_path, ["fin-0001", "fin-child-2"])
    _append_log_row(
        tmp_path, "logs/table-rolls.jsonl", {"roll_id": "roll-inherit-1"}
    )
    _commit_turn(tmp_path, 1, "fin-0001")
    hist.fork_timeline(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-child",
        source_turn=1,
        game_reason="replay",
        activate=True,
    )
    # Re-record the very same canonical id on the child: its introduction
    # still traces through the parent commit's ancestry.
    _append_log_row(
        tmp_path, "logs/table-rolls.jsonl", {"roll_id": "roll-inherit-1"}
    )
    _commit_turn(tmp_path, 2, "fin-child-2")
    proj.rebuild_history_projection(tmp_path, CAMPAIGN_ID)

    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == verify.STATUS_PASS
    assert proof.worldline_counts["ambiguous_canonical_ids"] == 0
    assert list(proof.worldline_advisories) == []


def test_post_confluence_re_record_through_parent_ancestry_not_flagged(tmp_path):
    """A merged line re-recording an inherited id stays single-introduction."""
    _prepare_campaign(tmp_path)
    _write_receipts(
        tmp_path, ["fin-0001", "fin-left-2", "fin-right-2", "fin-merged-4"]
    )
    _append_log_row(
        tmp_path, "logs/table-rolls.jsonl", {"roll_id": "roll-replay-1"}
    )
    _commit_turn(tmp_path, 1, "fin-0001")
    hist.fork_timeline(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-left",
        source_turn=1,
        game_reason="left",
        activate=True,
    )
    _note_world_branch(_worktree(tmp_path), "left")
    _commit_turn(tmp_path, 2, "fin-left-2")
    hist.set_active_timeline(tmp_path, CAMPAIGN_ID, "tl-main")
    hist.fork_timeline(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-right",
        source_turn=1,
        game_reason="right",
        activate=True,
    )
    _note_world_branch(_worktree(tmp_path), "right")
    _commit_turn(tmp_path, 2, "fin-right-2")
    confluence_id = f"confluence-{CAMPAIGN_ID}-tl-merged-replay"
    hist.confluence_timelines(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-merged-replay",
        left_timeline_id="tl-left",
        right_timeline_id="tl-right",
        receipt="conf-replay-1",
        schema_generation=SCHEMA,
        conflicts=_confluence_conflicts(confluence_id),
        path_resolutions={"save/world-state.json": "choose_left"},
        confluence_id=confluence_id,
        activate=True,
    )
    # The merged line re-records the id; its introduction traces through
    # either parent's ancestry (here: every parent tip already carried it).
    _append_log_row(
        tmp_path, "logs/table-rolls.jsonl", {"roll_id": "roll-replay-1"}
    )
    _commit_turn(tmp_path, 4, "fin-merged-4")
    proj.rebuild_history_projection(tmp_path, CAMPAIGN_ID)

    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == verify.STATUS_PASS
    assert proof.worldline_counts["ambiguous_canonical_ids"] == 0
    assert list(proof.worldline_advisories) == []


# ---------------------------------------------------------------------------
# Read-only guarantee across the whole sweep
# ---------------------------------------------------------------------------


def test_full_worldline_sweep_writes_nothing(tmp_path):
    _confluence_fixture(tmp_path)
    _write_temporal_store(
        tmp_path,
        "episodes.jsonl",
        [json.dumps({"episode_id": "episode-x"})],
    )
    before = _workspace_fingerprint(tmp_path)

    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.worldline_counts["timelines"] == 4
    assert proof.worldline_counts["confluences"] == 1
    assert proof.worldline_counts["episodes"] == 1
    assert _workspace_fingerprint(tmp_path) == before

    code, stdout, stderr = _run_verify(tmp_path, "--json")
    payload = json.loads(stdout)
    assert code in (0, 1, 2)  # any verdict; determinism is the gate here
    assert payload["worldline_counts"] == proof.worldline_counts
    assert [
        (f["code"], f["detail"], f.get("sha"))
        for f in payload["findings"]
    ] == [
        (f.kind, f.detail, f.sha)
        for f in verify.state_integrity_proof(tmp_path, CAMPAIGN_ID).findings
    ]
    assert _workspace_fingerprint(tmp_path) == before
