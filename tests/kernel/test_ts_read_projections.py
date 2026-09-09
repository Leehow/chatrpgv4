"""Read migration comparisons over retained Python-prepared saves; no gameplay claim."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path

import pytest

from conftest import CAMPAIGN, MODULE, PREGEN, RpcClient, WORKTREE, campaign_dir
from rpc_support import differences, python_command, retain_comparison, snapshot


def retained(case: str) -> Path:
    base = Path(os.environ.get("COC_RPC_EVIDENCE_DIR", str(
        WORKTREE / ".coc" / "playtests" / "runtime-consolidation" / "read-projections")))
    base.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=case + "-", dir=base))


def candidate_command() -> list[str]:
    entry = WORKTREE / "build" / "kernel" / "rpc.mjs"
    assert entry.is_file(), "Build the actual registered TypeScript RPC entry before this suite"
    node = shutil.which("node")
    assert node, "The Node executable for the TypeScript kernel is unavailable"
    return [node, str(entry)]


def state_bytes(workspace: Path) -> dict[str, str]:
    root = workspace / ".coc"
    return {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(root.rglob("*")) if path.is_file()
            and path.relative_to(root).parts[0] != "repos"}


def prepare(workspace: Path, *, language: str = "en", rich: bool = False) -> None:
    client = RpcClient(workspace, command=python_command(), env={"COC_KERNEL_SEED": "7"}, frozen_clock=True)
    try:
        if rich:
            from test_capsule_budgets import build_rich_state
            build_rich_state(client)
            client.table("player_input", text="Continue inspecting the saved scene.")
        else:
            client.ok("campaign.create", {"id": CAMPAIGN, "module": MODULE, "pregen": PREGEN,
                                          "play_language": language, "title": "Read migration fixture"})
        client.table("look", focus="time")
    finally:
        client.close()


READS = [
    ("table.status", {}), ("table.view", {}), ("table.capsule", {}),
    ("table.look", {"focus": "scene"}), ("table.look", {"focus": "npc"}),
    ("table.look", {"focus": "investigator"}), ("table.look", {"focus": "clues"}),
    ("table.look", {"focus": "time"}), ("table.look", {"focus": "session"}),
    ("table.look", {"focus": "object"}),
    ("table.lookup", {"kind": "module", "query": "Knott"}),
    ("table.lookup", {"kind": "secret", "scope": "scene"}),
    ("table.lookup", {"kind": "secret", "scope": "module"}),
]


def observe(workspace: Path, command: list[str], reads: list[tuple[str, dict]], content: Path | None = None) -> dict:
    before = state_bytes(workspace)
    client = RpcClient(workspace, command=command, content=content, env={"COC_KERNEL_SEED": "7"}, frozen_clock=True)
    failure = None
    try:
        for method, params in reads:
            client.call(method, {"campaign": CAMPAIGN, **params})
    except Exception as exc:
        failure = str(exc)
    finally:
        client.close()
    return {"exchanges": client.exchanges, "before_bytes": before, "after_bytes": state_bytes(workspace),
            "snapshot": snapshot(workspace), "exit_code": client.proc.returncode, "failure": failure}


def compare(root: Path, reads: list[tuple[str, dict]] = READS, content: Path | None = None,
            *, expect_write: bool = False) -> tuple[dict, dict]:
    source, candidate = root / "reference-workspace", root / "candidate-workspace"
    shutil.copytree(source, candidate, symlinks=True)
    reference = observe(source, python_command(), reads, content)
    actual = observe(candidate, candidate_command(), reads, content)
    evidence, findings = retain_comparison(root.name, reference, actual, root / "comparisons")
    assert (reference["before_bytes"] != reference["after_bytes"]) == expect_write, f"Unexpected oracle mutation: {evidence}"
    assert (actual["before_bytes"] != actual["after_bytes"]) == expect_write, f"Unexpected TypeScript mutation: {evidence}"
    assert not reference["failure"] and not actual["failure"], str(evidence)
    assert reference["exit_code"] == actual["exit_code"] == 0, str(evidence)
    assert not findings, f"{evidence}: " + "\n".join(findings)
    return reference, actual


@pytest.mark.parametrize("language", ["en", "zh-Hans"])
def test_read_rpc_matches_python_on_an_existing_acting_campaign(language):
    root = retained("basic-" + language)
    prepare(root / "reference-workspace", language=language)
    reference, actual = compare(root)
    assert all(item["response"]["ok"] for item in actual["exchanges"])
    assert reference["exchanges"][1]["response"]["result"]["clues"] == {"discovered": []}


def test_rich_capsule_preserves_budgets_memory_warnings_and_live_combat():
    root = retained("rich-capsule")
    prepare(root / "reference-workspace", rich=True)
    _, actual = compare(root)
    capsule = actual["exchanges"][2]["response"]["result"]
    assert capsule["where"]["session"]["kind"] == "combat"
    assert capsule["director"]["override"] == "session"
    assert capsule["memory"] and capsule["warnings"]
    assert "truncated" in capsule


def test_legacy_table_view_reads_without_persisting_the_scene_trail():
    root = retained("legacy-view")
    prepare(root / "reference-workspace")
    path = campaign_dir(root / "reference-workspace") / "world.json"
    world = json.loads(path.read_text())
    world.pop("scene_trail", None)
    path.write_text(json.dumps(world, ensure_ascii=False, indent=2) + "\n")
    with (path.parent / "events.jsonl").open("a") as stream:
        stream.write("unfinished event fragment\n")
    compare(root, [("table.view", {})])


@pytest.mark.parametrize("boundary", ["open-turn", "legacy-trail"])
def test_read_side_transitions_match_the_python_writer(boundary):
    root = retained("writer-boundary-" + boundary)
    workspace = root / "reference-workspace"
    prepare(workspace)
    if boundary == "open-turn":
        path = campaign_dir(workspace) / "turn.json"
        turn = json.loads(path.read_text())
        turn["state"] = "open"
        path.write_text(json.dumps(turn, ensure_ascii=False, indent=2) + "\n")
        reads = [("table.look", {"focus": "scene"}), ("table.lookup", {"kind": "module", "query": "Knott"})]
    else:
        path = campaign_dir(workspace) / "world.json"
        world = json.loads(path.read_text())
        world.pop("scene_trail", None)
        path.write_text(json.dumps(world, ensure_ascii=False, indent=2) + "\n")
        reads = [("table.status", {}), ("table.capsule", {})]
    _, result = compare(root, reads, expect_write=True)
    assert all(item["response"]["ok"] for item in result["exchanges"])


@pytest.mark.parametrize("hp,conditions,elapsed,age,decision", [
    (9, [], 30, 10, "healing:first-aid-ordinary"),
    (0, ["major_wound", "dying"], 30, 5, "healing:dying-round-clock"),
    (5, ["major_wound"], 15000, 11000, "healing:weekly-major-wound-recovery"),
])
def test_saved_healing_facts_drive_real_situations_and_clock_pressure(hp, conditions, elapsed, age, decision):
    from conftest import open_turn
    from test_rules_families import seed_wound
    root = retained("healing-situations")
    workspace = root / "reference-workspace"
    client = RpcClient(workspace, command=python_command(), env={"COC_KERNEL_SEED": "7"}, frozen_clock=True)
    try:
        open_turn(client)
        client.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": elapsed}])
        seed_wound(workspace, hp, conditions=conditions, minutes_ago=age)
    finally:
        client.close()
    _, actual = compare(root)
    capsule = actual["exchanges"][2]["response"]["result"]
    assert decision in [value["decision"] for value in capsule["situations"]]
    assert any(value["kind"] == "clock" for value in capsule["pressures"])


def test_active_mod_relationships_and_saved_document_objects_match_the_oracle():
    from test_mod_documents import owned_paper, view, edit
    root = retained("mod-objects")
    workspace = root / "reference-workspace"
    client = RpcClient(workspace, command=python_command(), env={"COC_KERNEL_SEED": "7"}, frozen_clock=True)
    try:
        owned_paper(client, text="Meet at the station.")
        edit(client, view(client), text="The investigator's amended notes.")
        client.table("resolve", call_id="t1-c2", action={"intent": "social", "decision": "natural-npc:first-impression",
                                                       "target": "Steven Knott", "goal": "Introduce myself"})
    finally:
        client.close()
    _, actual = compare(root, [*READS, ("table.look", {"focus": "object", "name": "Notebook"})])
    capsule = actual["exchanges"][2]["response"]["result"]
    assert capsule["mods"]["active"] and capsule["mods"]["relationships"]
    assert capsule["mods"]["objects"]["instances"][0]["document"]["text"] == "The investigator's amended notes."
    item = actual["exchanges"][1]["response"]["result"]["investigators"][0]["objects"][0]
    assert item["document"]["modified"] is True


@pytest.mark.parametrize("remembers", [True, False])
def test_saved_worldline_memory_is_read_only_and_visible_only_to_declared_npcs(remembers):
    from test_worldline import rewound_with_a_memory
    root = retained("worldline-memory")
    client = rewound_with_a_memory(root, "reference-workspace", remembers=remembers)
    content = client.content
    try:
        client.table("player_input", text="Inspect the retained loop state.")
        client.table("look", focus="time")
    finally:
        client.close()
    _, actual = compare(root, content=content)
    capsule = actual["exchanges"][2]["response"]["result"]
    assert capsule["worldlines"]["loop"] == 1
    assert capsule["worldlines"]["previous_loop"]
    assert any("from_other_lines" in value for value in capsule["present"]) is remembers


def test_a_published_graph_generation_is_refreshed_without_rewriting_its_bytes():
    from coc.modules.store import ModuleStore
    root = retained("graph-generation")
    source, candidate = root / "reference-workspace", root / "candidate-workspace"
    prepare(source)
    shutil.copytree(source, candidate, symlinks=True)
    reference = RpcClient(source, command=python_command(), frozen_clock=True)
    actual = RpcClient(candidate, command=candidate_command(), frozen_clock=True)
    phases = []
    try:
        for generation in (1, 2):
            if generation == 2:
                store = ModuleStore(source)
                graph = store.read_graph(MODULE)
                node = next(node for node in graph["nodes"] if node["node_id"] == "npc-steven-knott")
                node["properties"]["publication_fixture"] = "The second accepted generation."
                store.write_module(store.write_graph(store.module(MODULE), graph))
                shutil.copytree(source / ".coc" / "modules" / MODULE,
                                candidate / ".coc" / "modules" / MODULE, dirs_exist_ok=True)
            before = [state_bytes(workspace) for workspace in (source, candidate)]
            values = [client.ok("table.lookup", {"campaign": CAMPAIGN, "kind": "module", "query": "Steven Knott"})
                      for client in (reference, actual)]
            after = [state_bytes(workspace) for workspace in (source, candidate)]
            assert before == after and before[0] == before[1]
            assert not differences(values[0], values[1])
            if generation == 2:
                assert values[1]["entities"][0]["properties"]["publication_fixture"] == "The second accepted generation."
            meta = json.loads((source / ".coc" / "modules" / MODULE / "module.json").read_text())
            phases.append({"generation": meta["generation"], "before": before, "after": after, "values": values})
    finally:
        reference.close()
        actual.close()
    assert phases[1]["generation"] == phases[0]["generation"] + 1
    evidence, findings = retain_comparison(root.name,
        {"exchanges": reference.exchanges, "state": snapshot(source), "failure": None},
        {"exchanges": actual.exchanges, "state": snapshot(candidate), "failure": None}, root / "comparisons")
    (root / "phases.json").write_text(json.dumps(phases, ensure_ascii=False, indent=2) + "\n")
    assert not findings, f"{evidence}: {findings}"


def test_simple_views_do_not_read_unrelated_broken_memory_or_npc_ledgers():
    root = retained("unrelated-ledgers")
    workspace = root / "reference-workspace"
    prepare(workspace)
    folder = campaign_dir(workspace)
    (folder / "npc-ledger.json").write_text("unfinished NPC ledger")
    (folder / "memory").mkdir(exist_ok=True)
    (folder / "memory" / "candidates.jsonl").write_text("unfinished memory row\n")
    compare(root, [("table.status", {}), ("table.view", {}),
                   ("table.lookup", {"kind": "module", "query": "Knott"}),
                   ("table.look", {"focus": "npc", "name": "Steven Knott"})])


def test_setup_sheet_view_does_not_require_a_world_or_turn():
    root = retained("setup-view")
    client = RpcClient(root / "reference-workspace", command=python_command(), frozen_clock=True)
    try:
        client.ok("campaign.create", {"id": CAMPAIGN, "module": MODULE, "play_language": "en"})
        # Materialize the existing advisory-lock inode before the read-only byte baseline.
        client.ok("table.view", {"campaign": CAMPAIGN})
    finally:
        client.close()
    _, actual = compare(root, [("table.view", {})])
    assert actual["exchanges"][0]["response"]["result"]["state"] == "setting_up"
