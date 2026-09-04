"""Reading a section is an agent's job; judging what it wrote is not.

The agent opens the packet, writes the shard to a file across as many turns as
it needs, and runs the gates on itself -- that self-check is most of the speed.
None of it is evidence. The driver re-runs the same gates over the file the
agent left, because an agent reporting a success it did not have is exactly the
failure the gates exist to catch.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))
_spec = importlib.util.spec_from_file_location(
    "coc_module_build_agent", SCRIPTS / "coc_module_build.py"
)
build = importlib.util.module_from_spec(_spec)
sys.modules["coc_module_build_agent"] = build
_spec.loader.exec_module(build)


@pytest.fixture
def work(tmp_path: Path) -> Path:
    d = tmp_path / "whole-book"
    d.mkdir()
    (d / "extraction-packet.json").write_text("{}", encoding="utf-8")
    return d


def test_the_brief_tells_the_agent_where_everything_is(work: Path):
    brief = build.build_brief(work)
    assert str(work) in brief
    assert "extraction-packet.json" in brief
    assert str(build.extract.INSTRUCTION_PATH) in brief
    # Without the self-check command the agent cannot close its own loop, and
    # every round costs a driver round-trip again.
    assert "review --work-dir" in brief
    assert str(work / build.SHARD_NAME) in brief


def test_the_brief_says_the_shard_is_a_file_not_a_reply():
    """The whole reason for agent mode; if the brief loses it, so does the run."""
    template = build.BRIEF_PATH.read_text("utf-8")
    assert "不是一条回复" in template
    assert "不要为了塞进一次输出而压缩内容" in template


def test_an_agent_that_writes_nothing_is_reported(work: Path, monkeypatch):
    monkeypatch.setattr(build.extract, "review", lambda *a, **k: pytest.fail(
        "review ran with no shard on disk"))
    out = build.extract_section(work, lambda work_dir, brief: None, max_rounds=2)
    assert out["status"] == "not_accepted"
    codes = {f["code"] for r in out["rounds"] for f in r["findings"]}
    assert codes == {"agent_wrote_no_shard"}


def test_an_unparseable_shard_is_reported_not_raised(work: Path):
    def agent(work_dir, brief):
        (Path(work_dir) / build.SHARD_NAME).write_text("{ not json", encoding="utf-8")

    out = build.extract_section(work, agent, max_rounds=1)
    assert out["status"] == "not_accepted"
    assert out["rounds"][0]["findings"][0]["code"] == "shard_not_json"


def test_the_driver_judges_the_file_not_the_agents_account(work: Path, monkeypatch):
    """An agent claiming success it did not have must not get it."""
    def lying_agent(work_dir, brief):
        target = Path(work_dir)
        (target / build.SHARD_NAME).write_text('{"nodes": []}', encoding="utf-8")
        (target / "DONE.json").write_text(
            '{"nodes": 999, "claims": 999, "rounds": 1}', encoding="utf-8")

    monkeypatch.setattr(build.extract, "review", lambda work_dir, shard: {
        "status": "findings", "gate": "structure", "finding_count": 1,
        "findings": [{"code": "contract_mismatch", "path": "/", "message": "no"}],
    })
    out = build.extract_section(work, lying_agent, max_rounds=1)
    assert out["status"] == "not_accepted"
    assert out["rounds"][0]["findings"][0]["code"] == "contract_mismatch"


def test_an_accepted_shard_is_taken_from_the_gates_not_the_agent(work: Path, monkeypatch):
    def agent(work_dir, brief):
        (Path(work_dir) / build.SHARD_NAME).write_text('{"nodes": []}', encoding="utf-8")

    monkeypatch.setattr(build.extract, "review", lambda work_dir, shard: {
        "status": "accepted", "shard_path": str(work / "accepted.shard.json"),
        "nodes": 7, "claims": 5, "relations": 5,
    })
    out = build.extract_section(work, agent, max_rounds=2)
    assert out["status"] == "accepted"
    assert out["attempts"] == 1
    assert (out["nodes"], out["claims"]) == (7, 5)


def test_a_retry_hands_the_machine_findings_back_verbatim(work: Path, monkeypatch):
    seen: list[str] = []

    def agent(work_dir, brief):
        seen.append(brief)
        (Path(work_dir) / build.SHARD_NAME).write_text('{"nodes": []}', encoding="utf-8")

    findings = [{"code": "name-not-on-cited-pages", "path": "/nodes/16/name",
                 "message": "no declared name occurs in the spans this node cites",
                 "node_id": "location-hyperborean-ghost-city"}]
    monkeypatch.setattr(build.extract, "review", lambda work_dir, shard: {
        "status": "findings", "gate": "grounding", "finding_count": 1,
        "findings": findings,
    })
    build.extract_section(work, agent, max_rounds=2)
    assert len(seen) == 2
    assert "location-hyperborean-ghost-city" in seen[1], (
        "the second run was not told what the first one got wrong"
    )
    # Verbatim, because a paraphrase is where a loop starts optimising for the
    # paraphrase rather than for the book.
    assert findings[0]["message"] in seen[1]
    assert seen[0] not in seen[1] or seen[1].startswith(seen[0])


def test_the_review_command_names_the_shard_the_agent_writes(work: Path):
    command = build.review_command(work)
    assert str(work / build.SHARD_NAME) in command
    assert "--work-dir" in command and "--model-output" in command
