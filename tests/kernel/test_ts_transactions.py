"""Transaction migration against real Python RPC, retaining both state/history trees."""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

from conftest import RpcClient, stating
from rpc_support import differences, python_command, snapshot

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / ".coc" / "playtests" / "ts-transactions"


def retained(name: str) -> Path:
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=name + "-", dir=EVIDENCE))


def build_candidate() -> list[str]:
    override = os.environ.get("COC_TS_TRANSACTIONS_COMMAND")
    if override:
        return json.loads(override)
    entry = ROOT / "build/kernel/rpc.mjs"
    if not entry.is_file():
        raise RuntimeError("Build the canonical TypeScript runtime before transaction comparisons")
    return ["node", str(entry)]


@pytest.fixture(scope="module")
def candidate():
    return build_candidate()


CREATE = ("campaign.create", {"id": "c1", "module": "the-haunting", "pregen": "thomas-hayes", "play_language": "en"})
OPEN = ("table.open", {"campaign": "c1"})
OPENING = ("table.narrate", {"campaign": "c1", "call_id": "t0-c1", "text": "The case begins.\n\nA letter waits."})
INPUT = ("table.player_input", {"campaign": "c1", "text": "I ask about the letter."})
NARRATE = ("table.narrate", {"campaign": "c1", "call_id": "t1-c1", "text": "The ink is dry.\n\nThe witness waits."})


CASES = {
    "create": [CREATE, ("campaign.list", {}), CREATE,
               ("campaign.create", {"id": "setup", "module": "the-haunting", "play_language": "en"}),
               ("table.open", {"campaign": "setup"}), ("campaign.list", {})],
    "turns-and-replay": [CREATE, OPEN, OPENING, INPUT, ("table.capsule", {"campaign": "c1"}),
        ("table.look", {"campaign": "c1", "focus": "scene"}),
        ("table.ask", {"campaign": "c1", "call_id": "t1-c1", "prompt": "Which lead?", "options": ["Door", "Letter"], "binds": "first-lead", "text": "He points at the desk."}),
        ("table.ask", {"campaign": "c1", "call_id": "t1-c1", "prompt": "Which lead?", "options": ["Door", "Letter"], "binds": "first-lead", "text": "He points at the desk."}),
        ("table.ask", {"campaign": "c1", "call_id": "t1-c1", "prompt": "Changed?", "options": ["Door", "Letter"]}),
        INPUT, ("table.narrate", {"campaign": "c1", "call_id": "t2-c1", "text": "You study the paper."}),
        ("table.narrate", {"campaign": "c1", "call_id": "t2-c1", "text": "You study the paper."}),
        ("table.capsule", {"campaign": "c1"}), {"restart": True}, OPEN, INPUT,
        ("table.narrate", {"campaign": "c1", "call_id": "t3-c1", "text": "A new detail emerges."}), INPUT],
    "implicit-opening-and-mechanics-choice": [CREATE, INPUT,
        ("table.ask", {"campaign": "c1", "call_id": "t1-c1", "kind": "mechanics", "options": ["push", "accept"]}),
        {"restart": True}, OPEN, INPUT,
        ("table.narrate", {"campaign": "c1", "call_id": "t2-c1", "text": "You leave the question open."})],
    "commit-failure": [CREATE, OPEN, OPENING, INPUT, {"hide_repo": True}, NARRATE,
        {"snapshot": "failed"}, {"hide_repo": False}, NARRATE, ("table.status", {"campaign": "c1"})],
    "post-commit-episode-failure": [CREATE, OPEN, OPENING, INPUT, {"block_episode": True}, NARRATE,
        ("table.status", {"campaign": "c1"}), OPEN],
    "checkpoint-and-cursor-recovery": [CREATE, OPEN, OPENING, INPUT, NARRATE,
        {"damage": "save/continuation/latest.json", "delete": True}, {"restart": True}, OPEN, OPEN,
        {"damage": "turn.json", "value": "{not json"}, {"restart": True}, OPEN, INPUT,
        ("table.ask", {"campaign": "c1", "call_id": "t2-c1", "prompt": "Continue?", "options": ["Yes", "Wait"]}),
        {"damage": "turn.json", "delete": True}, {"restart": True}, OPEN, INPUT],
    "partial-receipts": [OPEN, ("table.status", {"campaign": "c1"}), {"stated": "The sound fades.", "call_id": "t1-c2"},
        ("table.status", {"campaign": "c1"}), {"restart": True}, OPEN],
    "ending-and-language": [CREATE, OPEN, OPENING, INPUT,
        ("table.narrate", {"campaign": "c1", "call_id": "t1-c1", "text": "Bad {{check:missing}}"}),
        {"ending": {"scope": "chapter", "summary": "An accounted chapter", "continued": False}}, NARRATE, INPUT],
    "unicode-delivery": [("campaign.create", {**CREATE[1], "play_language": "zh-Hans"}), OPEN,
        ("table.narrate", {"campaign": "c1", "call_id": "t0-c1", "text": "English only."}),
        ("table.narrate", {"campaign": "c1", "call_id": "t0-c1", "text": "\u4f60\u597d " + "\U0001f680" * 65 + "\n\n\u5f00\u573a\u3002"}),
        ("table.player_input", {"campaign": "c1", "text": "\u6211\u770b\u4fe1\u3002"}),
        ("table.ask", {"campaign": "c1", "call_id": "t1-c1", "prompt": "English prompt", "options": ["\u662f", "\u5426"]}),
        ("table.narrate", {"campaign": "c1", "call_id": "t1-c1", "text": "\u4fe1\u7eb8\u5df2\u7ecf\u53d1\u9ec4\u3002"})],
    "legacy-trail": [OPEN, ("table.status", {"campaign": "c1"}),
        ("table.lookup", {"campaign": "c1", "kind": "module", "query": "Knott"}), NARRATE],
}


def seed_base(root: Path, name: str) -> Path | None:
    if name not in {"partial-receipts", "legacy-trail"}:
        return None
    base = root / "base"
    client = RpcClient(base, command=python_command(), frozen_clock=True, env={"COC_KERNEL_SEED": "transaction-oracle"})
    try:
        for method, params in [CREATE, OPEN, OPENING, INPUT]:
            client.ok(method, params)
        if name == "partial-receipts":
            client.ok("table.resolve", {"campaign": "c1", "call_id": "t1-c1", "action": {"intent": "investigate", "goal": "listen", "method": "", "skill": "Listen"}})
        else:
            path = base / ".coc/campaigns/c1/world.json"
            world = json.loads(path.read_text()); world.pop("scene_trail", None)
            path.write_text(json.dumps(world, ensure_ascii=False, indent=2) + "\n")
    finally:
        client.close()
    return base


def observe(root: Path, name: str, command: list[str], label: str, base: Path | None) -> dict:
    workspace = root / "workspace"
    if base:
        shutil.copytree(base, workspace)
    snapshots = {}
    client = RpcClient(workspace, command=command, frozen_clock=True, env={"COC_KERNEL_SEED": "transaction-oracle"})
    exchanges = []
    try:
        for index, step in enumerate(CASES[name]):
            if isinstance(step, tuple):
                client.call(*step)
            elif step.get("restart"):
                exchanges.extend(client.exchanges); client.close()
                client = RpcClient(workspace, command=command, frozen_clock=True, env={"COC_KERNEL_SEED": "transaction-oracle"})
            elif "snapshot" in step:
                # The failed Git repository is deliberately absent at this checkpoint.
                snapshots[step["snapshot"]] = snapshot(workspace)
            elif "hide_repo" in step:
                source, target = workspace / ".coc/repos/c1.git", workspace / ".coc/repos/c1.broken"
                (source if step["hide_repo"] else target).rename(target if step["hide_repo"] else source)
            elif "damage" in step:
                path = workspace / ".coc/campaigns/c1" / step["damage"]
                if path.exists():
                    (root / f"{label}-retained-before-damage-{index}.bin").write_bytes(path.read_bytes())
                if step.get("delete"):
                    path.unlink()
                else:
                    path.write_text(step["value"])
            elif step.get("block_episode"):
                path = workspace / ".coc/campaigns/c1/memory/episodes.jsonl"
                path.rename(root / f"{label}-retained-episodes.jsonl")
                path.mkdir()
            elif "ending" in step:
                path = workspace / ".coc/campaigns/c1/world.json"
                world = json.loads(path.read_text()); world["ending"] = step["ending"]
                path.write_text(json.dumps(world, ensure_ascii=False, indent=2) + "\n")
            elif "stated" in step:
                client.call("table.narrate", {"campaign": "c1", "call_id": step["call_id"], "text": stating(client, step["stated"])})
        exchanges.extend(client.exchanges)
    finally:
        client.close()
    result = {"exchanges": exchanges, "snapshots": snapshots, "state": snapshot(workspace)}
    (root / f"{label}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    workspace.rename(root / f"{label}-workspace")
    return result


@pytest.mark.parametrize("name", list(CASES))
def test_transactions_match_python(candidate, name):
    root = retained(name)
    base = seed_base(root, name)
    reference = observe(root, name, python_command(), "python", base)
    actual = observe(root, name, candidate, "typescript", base)
    findings = differences(reference, actual)
    (root / "comparison.json").write_text(json.dumps({"equal": not findings, "differences": findings}, indent=2) + "\n")
    assert not findings, f"{name}: retained evidence {root}\n" + "\n".join(findings)


if __name__ == "__main__":
    entry = build_candidate()
    for selected in sys.argv[1:] or ["create"]:
        test_transactions_match_python(entry, selected)
    print("Direct transaction reference comparison passed")
