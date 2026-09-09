"""Real RPC setup/library oracle comparisons; deterministic fixtures, not gameplay."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import tempfile

import pytest

from conftest import RpcClient
from rpc_support import differences, python_command, snapshot
from test_setup_drafts import profile

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / ".coc/playtests/ts-setup-library"


def retained(name):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=name + "-", dir=EVIDENCE))


def candidate_command():
    override = os.environ.get("COC_TS_SETUP_COMMAND")
    if override:
        return json.loads(override)
    entry = ROOT / "build/kernel/rpc.mjs"
    if not entry.is_file():
        raise RuntimeError("Build the actual TypeScript RPC before setup comparisons")
    return ["node", str(entry)]


def create(client, campaign="c1", pregen=False):
    return client.ok("campaign.create", {"id": campaign, "module": "the-haunting", "play_language": "en",
        **({"pregen": "thomas-hayes"} if pregen else {})})


def draft(client, campaign="c1", **extra):
    return client.ok("setup.draft", {"campaign": campaign, "profile": profile(), **extra})


def observe(directory, label, command, scenario):
    workspace = directory / "workspace"
    client = RpcClient(workspace, command=command, frozen_clock=True, env={"COC_KERNEL_SEED": "setup-library-oracle"})
    exchanges, checkpoints = [], {}

    def restart():
        nonlocal client
        exchanges.extend(client.exchanges)
        client.close()
        client = RpcClient(workspace, command=command, frozen_clock=True, env={"COC_KERNEL_SEED": "setup-library-oracle"})

    def saved_file(relative):
        return workspace / ".coc" / relative

    try:
        if scenario == "generation":
            client.ok("setup.occupations")
            client.ok("setup.steps")
            client.ok("setup.steps", {"campaign": "unknown"})
            create(client)
            for index, age in enumerate([15, 19, 20, 39, 40, 49, 50, 59, 60, 69, 70, 79, 80, 89]):
                for method in ["quick_fire", "rolled"]:
                    result = client.ok("setup.investigator", {"campaign": "c1", "id": f"age-{age}-{method}", "name": "Age boundary",
                        "occupation": ["Journalist", "Military Officer", "Antiquarian"][index % 3], "method": method, "age": age,
                        "seed": "\u8c03\u67e5\u5458-" + str(age), "allocation": "fill" if index % 2 else "spread"})
                    assert result["sheet"]["age"] == age
            for allocation in ["spread", "fill"]:
                client.ok("setup.investigator", {"campaign": "c1", "id": allocation, "name": "Allocation", "occupation": "Military Officer", "seed": 2**65+1, "allocation": allocation})
            client.err("setup.complete", {"campaign": "c1"})
            client.ok("setup.steps", {"campaign": "c1"})
        elif scenario == "generation-errors":
            create(client)
            common = {"campaign": "c1", "name": "Errors", "occupation": "Journalist"}
            for patch in [{"name": ""}, {"concept": 1}, {"sex": []}, {"seed": True}, {"seed": 1.5}, {"seed": {}},
                          {"allocation": []}, {"allocation": "invented"}, {"method": "invented"}, {"age": 14}, {"age": 90},
                          {"age": True}, {"age": None}, {"occupation": "Invented"}]:
                client.err("setup.investigator", {**common, **patch})
            client.ok("setup.investigator", {**common, "name": "Zo\u00eb O'Brien-N\u00fa\u00f1ez"})
            client.ok("setup.investigator", {**common, "name": "\u8c03\u67e5\u5458", "era": "unsupported"})
            client.err("setup.investigator", {**common, "id": "inv-2"})
        elif scenario == "draft-confirmation":
            create(client)
            original = draft(client, input_key="description")
            client.err("setup.confirm", {"campaign": "c1", "revision": original["revision"], "consent": "approved"})
            client.err("setup.previewed", {"campaign": "c1", "revision": 0})
            client.ok("setup.previewed", {"campaign": "c1", "revision": original["revision"]})
            client.err("setup.confirm", {"campaign": "c1", "revision": original["revision"], "consent": "approved", "input_key": "description"})
            assert draft(client)["revision"] == original["revision"]
            for patch in [{"unexpected": True}, {"backstory": []}, {"key_connection": []}, {"occupation_skills": [{}]},
                          {"equipment": None}, {"weapons": ["Invented"]}, {"era": "unsupported"}]:
                client.err("setup.draft", {"campaign": "c1", "profile": patch})
            updated = client.ok("setup.draft", {"campaign": "c1", "profile": {"age": 45}, "input_key": "older"})
            assert updated["sheet"]["creation"]["characteristics"] == original["sheet"]["creation"]["characteristics"]
            assert updated["sheet"]["creation"]["luck"] == original["sheet"]["creation"]["luck"]
            client.err("setup.confirm", {"campaign": "c1", "revision": original["revision"], "consent": "approved"})
            restart()
            client.ok("setup.steps", {"campaign": "c1"})
            client.err("setup.prologue", {"campaign": "c1", "scene": "Knott's Office", "guide": "Walter Corbitt", "text": "Meeting."})
            client.ok("setup.prologue", {"campaign": "c1", "scene": "Knott's Office", "guide": "Steven Knott", "text": "Knott asks who the visitor is.", "handoff": "Continue after introductions."})
            client.ok("setup.prologue", {"campaign": "c1", "scene": "wrong", "text": "This cannot overwrite the first meeting."})
            confirm = {"campaign": "c1", "revision": updated["revision"], "consent": "delegated", "last_exchange": "My name is Helen.",
                "pending_action": "inspect the door", "player_requests": ["Please inspect the door after the meeting."]}
            client.err("setup.confirm", {**confirm, "pending_action": "take the keys"})
            accepted = client.ok("setup.confirm", confirm)
            assert accepted["sheet"] == updated["sheet"]
            client.ok("setup.confirm", confirm)
            client.err("setup.draft", {"campaign": "c1", "profile": {"age": 55}})
            client.ok("setup.complete", {"campaign": "c1"})
            client.ok("setup.complete", {"campaign": "c1"})
            client.ok("table.open", {"campaign": "c1"})
        elif scenario == "guidance-and-opening-wait":
            create(client, "seed")
            module_path = saved_file("modules/the-haunting/module.json")
            module = json.loads(module_path.read_text())
            key = next(key for key, value in module["character_guidance"].items() if value["play_language"] == "en")
            client.ok("campaign.create", {"id": "c1", "module": "the-haunting", "play_language": "en", "guidance_key": key})
            state = client.ok("setup.steps", {"campaign": "c1"})["state"]
            assert state["guidance_key"] == key
            era = next(era for era in state["rulebook_eras"] if era != "1920s")
            value = client.ok("setup.draft", {"campaign": "c1", "profile": {**profile(), "era": era}})
            assert value["sheet"]["finance"]["period"] == era
            client.ok("setup.confirm", {"campaign": "c1", "revision": value["revision"], "consent": "delegated"})
            before = module_path.read_bytes()
            module = json.loads(before); module["status"] = "registered"; module["opening_ready"] = False
            module_path.write_text(json.dumps(module, ensure_ascii=False, indent=2) + "\n")
            error = client.err("setup.complete", {"campaign": "c1"})
            assert error["details"]["reason"] == "opening_preparing"
            assert client.ok("setup.steps", {"campaign": "c1"})["state"]["waiting_for_opening"]
            checkpoints["waiting"] = snapshot(workspace)
            module_path.write_bytes(before)
            restart()
            client.ok("setup.complete", {"campaign": "c1"})
            assert client.ok("setup.steps", {"campaign": "c1"})["state"]["guidance_key"] == key
        elif scenario in {"draft-crash-recovery", "draft-tamper"}:
            create(client)
            original = draft(client)
            draft_path = saved_file(f"campaigns/c1/setup/drafts/{original['revision']}.json")
            if scenario == "draft-crash-recovery":
                sheet_path = saved_file("campaigns/c1/party/investigator.json")
                sheet_path.parent.mkdir(parents=True, exist_ok=True)
                sheet_path.write_text(json.dumps(original["sheet"], ensure_ascii=False, indent=2) + "\n")
                restart()
                client.ok("setup.confirm", {"campaign": "c1", "revision": original["revision"], "consent": "delegated"})
                client.ok("setup.complete", {"campaign": "c1"})
            else:
                before = draft_path.read_bytes()
                (directory / f"{label}-draft-before-tamper.bin").write_bytes(before)
                edited = json.loads(before); edited["sheet"]["name"] = "Altered"
                draft_path.write_text(json.dumps(edited, ensure_ascii=False, indent=2) + "\n")
                client.err("setup.confirm", {"campaign": "c1", "revision": original["revision"], "consent": "delegated"})
                assert not list(saved_file("campaigns/c1/party").glob("*.json"))
        elif scenario in {"library-roundtrip", "library-conflict"}:
            create(client, pregen=True)
            saved = client.ok("investigator.save", {"campaign": "c1"})
            library_id = saved["library_id"]
            client.ok("investigator.save", {"campaign": "c1"})
            client.ok("investigator.list")
            source = client.ok("investigator.get", {"library_id": library_id})
            if scenario == "library-conflict":
                path = saved_file(f"investigators/{library_id}.json")
                (directory / f"{label}-library-before-corruption.bin").write_bytes(path.read_bytes())
                path.write_text("{broken")
                client.ok("investigator.list")
                client.err("investigator.get", {"library_id": library_id})
                client.err("investigator.save", {"campaign": "c1"})
                client.ok("table.open", {"campaign": "c1"})
                client.ok("table.narrate", {"campaign": "c1", "call_id": "t0-c1", "text": "The meeting begins."})
                assert path.read_text() == "{broken"
                checkpoints["unreadable-mirror"] = snapshot(workspace)
            else:
                create(client, "c2")
                copied = client.ok("investigator.load", {"campaign": "c2", "library_id": library_id})
                assert {key: value for key, value in copied["sheet"].items() if key not in {"id", "origin"}} == {
                    key: value for key, value in source["sheet"].items() if key not in {"id", "origin"}}
                client.ok("investigator.load", {"campaign": "c2", "library_id": library_id, "as": "Zo\u00eb O'Brien-N\u00fa\u00f1ez With A Long Name"})
                client.err("investigator.save", {"campaign": "c2"})
                client.err("investigator.save", {"campaign": "c2", "investigator": "wrong"})
                client.ok("setup.steps", {"campaign": "c2"})
                client.ok("setup.complete", {"campaign": "c2"})
                restart()
                client.ok("table.open", {"campaign": "c2"})
                client.ok("table.narrate", {"campaign": "c2", "call_id": "t0-c1", "text": "The meeting begins."})
                client.ok("table.player_input", {"campaign": "c2", "text": "I look around."})
                client.err("investigator.load", {"campaign": "c2", "library_id": library_id})
                sheet_path = saved_file(f"campaigns/c2/party/{copied['sheet']['id']}.json")
                changed = json.loads(sheet_path.read_text()); changed["current_hp"] -= 1; changed["skills"]["Listen"] += 1
                sheet_path.write_text(json.dumps(changed, ensure_ascii=False, indent=2) + "\n")
                client.ok("table.narrate", {"campaign": "c2", "call_id": "t1-c1", "text": "The office is quiet."})
                assert client.ok("investigator.get", {"library_id": library_id})["sheet"] == changed
                client.ok("investigator.list")
                client.ok("investigator.save", {"campaign": "c2", "investigator": copied["sheet"]["id"]})
        else:
            raise AssertionError(scenario)
        exchanges.extend(client.exchanges)
    finally:
        client.close()
    result = {"exchanges": exchanges, "checkpoints": checkpoints, "state": snapshot(workspace)}
    (directory / f"{label}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    workspace.rename(directory / f"{label}-workspace")
    return result


@pytest.mark.parametrize("scenario", ["generation", "generation-errors", "draft-confirmation", "guidance-and-opening-wait", "draft-crash-recovery", "draft-tamper", "library-roundtrip", "library-conflict"])
def test_setup_library_matches_python(scenario):
    root = retained(scenario)
    reference = observe(root, "python", python_command(), scenario)
    candidate = observe(root, "typescript", candidate_command(), scenario)
    findings = differences(reference, candidate)
    (root / "comparison.json").write_text(json.dumps({"equal": not findings, "differences": findings}, indent=2) + "\n")
    assert not findings, f"retained evidence {root}\n" + "\n".join(findings)


def test_python_and_typescript_confirm_the_same_draft_once():
    root = retained("cross-runtime-confirm")
    workspace = root / "workspace"
    python = RpcClient(workspace, command=python_command(), frozen_clock=True, env={"COC_KERNEL_SEED": "setup-library-oracle"})
    typescript = RpcClient(workspace, command=candidate_command(), frozen_clock=True, env={"COC_KERNEL_SEED": "setup-library-oracle"})
    try:
        create(python)
        value = draft(python)
        params = {"campaign": "c1", "revision": value["revision"], "consent": "delegated"}
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda client: client.ok("setup.confirm", params), [python, typescript]))
        assert all(result["committed"] for result in results)
        assert sum(bool(result.get("replayed")) for result in results) == 1
        assert all(result["sheet"] == value["sheet"] for result in results)
        meta = json.loads((workspace / ".coc/campaigns/c1/campaign.json").read_text())
        assert len(meta["setup"]["receipts"]) == 1
        assert len(list((workspace / ".coc/campaigns/c1/party").glob("*.json"))) == 1
        (root / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    finally:
        python.close(); typescript.close()
