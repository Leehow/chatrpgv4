"""Contract 28: a package adds a word to the actor dossier spine.

The shape checks run on the default engine because both mirror them. Everything downstream --
the reader's ask, the module's provenance, and the word arriving at the table -- runs against the
emitted kernel: it is the only one that takes its vocabulary from the `--content` it was given,
and the only one that binds packages at build time (contract 28.2)."""

import json
import os
import shutil
from pathlib import Path

import pytest

from conftest import CAMPAIGN, KERNEL_DIR, RpcClient, WORKTREE, create_campaign, read_json

# A key of this fixture's own. Natural NPC ships `language`; a second package claiming it would be
# testing the collision rule instead of the feature.
DIALECT = {"key": "dialect", "label": "dialect",
           "ask": "the dialect this person speaks in, when the book names one"}


def package(tmp_path, *, name="dialects", vocabulary=DIALECT, requires=True, **manifest_overrides):
    """A real installable package: Natural NPC's files with this fixture's own contribution."""
    path = tmp_path / f"package-{name}"
    shutil.copytree(WORKTREE / "mods" / "natural-npc", path)
    manifest = read_json(path / "mod.json")
    manifest["id"] = name
    manifest["version"] = "1.0.0"
    manifest["requires"] = [cap for cap in manifest["requires"] if cap != "graph.vocabulary.v1"]
    if requires:
        manifest["requires"] = [*manifest["requires"], "graph.vocabulary.v1"]
    manifest["contributes"].pop("vocabulary", None)
    if vocabulary is not None:
        manifest["contributes"]["vocabulary"] = {"actor_profile_keys": [vocabulary]}
    # one package owns one check name; a second copy must not collide with natural-npc's
    for check in manifest["contributes"]["checks"]:
        check["name"] = f"{name}:first-impression"
    manifest["contributes"]["audit_on_decisions"] = [f"{name}:first-impression"]
    manifest.update(manifest_overrides)
    (path / "mod.json").write_text(json.dumps(manifest))
    return path


def emitted_client(workspace, content=None):
    entry = KERNEL_DIR.parent / "build" / "kernel" / "rpc.mjs"
    command = json.loads(os.environ["COC_TS_MODS_COMMAND"]) if os.environ.get("COC_TS_MODS_COMMAND") \
        else ["node", str(entry)]
    if command[-1] == str(entry) and not entry.is_file():
        pytest.skip("build the emitted kernel first (npm run build:runtime)")
    return RpcClient(workspace, command=command, content=content)


# ---- shape (contract 28.3) -------------------------------------------------------------------

def test_a_vocabulary_contribution_is_checked_for_shape(kernel, tmp_path):
    """Only shape is decided at install: the package declares the capability, names a bounded key,
    label and ask, and does not claim one key twice. Nothing here knows the core spine."""
    kernel.ok("mods.install", {"path": str(package(tmp_path, name="dialects"))})

    def rejected(name, **kwargs):
        error = kernel.err("mods.install", {"path": str(package(tmp_path, name=name, **kwargs))})
        assert error["code"] == "invalid_params", (name, error)
        return error["message"]

    assert "graph.vocabulary.v1" in rejected("no-capability", requires=False)
    assert "slug" in rejected("bad-slug", vocabulary={**DIALECT, "key": "Language"})
    assert "label" in rejected("no-label", vocabulary={**DIALECT, "label": "   "})
    assert "ask" in rejected("long-ask", vocabulary={**DIALECT, "ask": "x" * 401})
    assert "key, a label and an ask" in rejected("extra-field", vocabulary={**DIALECT, "extra": 1})
    assert "one to eight" in rejected("empty-list", vocabulary=None,
                                      contributes={"vocabulary": {"actor_profile_keys": []}})


# ---- the build boundary (contract 28.2) ------------------------------------------------------

def built_module(client, tmp_path, npc_properties):
    """Bind a source, index it, and merge one reader result carrying an npc. Returns the module id
    and the packet the reader was handed, so the ask and the provenance can both be read."""
    from module_helpers import claim, finish, indexed, observed, request, write

    mid, _ = indexed(client, tmp_path)
    request(client, mid, "opening")
    job = claim(client, mid)
    packet = read_json(Path(job["work_dir"]) / "packet.json")
    observed(job)
    refs = [{"page": 1}]
    nodes = [
        {"node_id": "scene-dock", "node_kind": "scene", "name": "Dock", "source_refs": refs,
         "properties": {"is_entrance": True}},
        {"node_id": "scene-tower", "node_kind": "scene", "name": "Tower", "source_refs": [{"page": 2}],
         "summary": "An old tower beyond the harbor.", "properties": {"is_final": True}},
        {"node_id": "npc-tenant", "node_kind": "npc", "name": "Tenant", "source_refs": refs,
         "summary": "A tenant.", "properties": npc_properties},
    ]
    claims = [{"subject_id": a, "predicate": r, "object": {"node_id": b}, "truth_status": "authored-fact",
               "source_refs": refs}
              for a, r, b in [("scene-dock", "route-to", "scene-tower"), ("npc-tenant", "present-in", "scene-dock")]]
    write(Path(job["work_dir"]) / "draft.json",
          {"nodes": nodes, "claims": claims, "node_refs": [], "coverage": {}, "dependencies": [],
           "critical": [], "ready_nodes": ["scene-dock", "npc-tenant"]})
    write(Path(job["work_dir"]) / "review.json",
          {"checked": [{"path": p, "verdict": "supported", "source_refs": refs, "reason": "fixture support"}
                       for p in ["/nodes/0", "/nodes/2", "/claims/0", "/claims/1"]], "missing": []})
    finish(client, job)
    return mid, packet


def test_a_contributed_key_reaches_the_reader_and_the_module_records_it(tmp_path):
    """28.2/28.3: the reader is asked for the package's key by name, in its own words, and the
    module writes down the vocabulary it was read under -- the provenance the read side needs."""
    client = emitted_client(tmp_path / "ws")
    try:
        client.ok("mods.install", {"path": str(package(tmp_path, name="dialects"))})
        mid, packet = built_module(client, tmp_path, {"agenda": "Keep the room.", "dialect": "Sicilian"})

        # Natural NPC ships `language` and is on by default, so the reader is asked for both.
        contributed = packet["vocabulary"]["actor_dossier"]["contributed"]
        assert DIALECT in contributed
        assert {entry["key"] for entry in contributed} == {"language", "dialect"}
        # 28.5: a contributed word never joins the core list. `npcs_without_material` counts that
        # list and only that list, so merging the two here is what would quietly make every
        # under-written actor in every book look finished.
        core = packet["vocabulary"]["actor_dossier"]["profile_keys"]
        assert "dialect" not in core and "language" not in core

        recorded = read_json(client.workspace / ".coc" / "modules" / mid / "module.json")["vocabulary"]
        by_key = {entry["key"]: entry for entry in recorded["actor_profile_keys"]}
        assert set(by_key) == {"language", "dialect"}
        assert by_key["dialect"]["mod"] == "dialects" and by_key["language"]["mod"] == "natural-npc"
    finally:
        client.close()


BOOK = "c2"


def table_npcs(client, campaign):
    return {p["name"]: p for p in client.ok("table.look", {"campaign": campaign, "focus": "npc"})["present"]}


def played(client, tmp_path, mid):
    """A campaign on a built book: the library path of §21.5 -- create, load an investigator saved
    from a starter pregen, finish setup, open. A built book has no pregens of its own."""
    create_campaign(client)
    library_id = client.ok("investigator.save", {"campaign": CAMPAIGN})["library_id"]
    client.ok("campaign.create", {"id": BOOK, "module": mid, "play_language": "en"})
    client.ok("investigator.load", {"campaign": BOOK, "library_id": library_id})
    client.ok("setup.complete", {"campaign": BOOK})
    client.ok("table.open", {"campaign": BOOK})
    return BOOK


def test_a_recorded_key_reaches_the_table_and_does_not_need_its_package_on(tmp_path):
    """28.2/28.5: what the module was read under is what the table reads it by. Turning the
    package off stops its instructions, not the book's own facts -- the graph carries material
    under that word, and hiding it would make the book less readable than before it was installed."""
    client = emitted_client(tmp_path / "ws")
    try:
        client.ok("mods.install", {"path": str(package(tmp_path, name="dialects"))})
        mid, _ = built_module(client, tmp_path, {"agenda": "Keep the room.", "dialect": "Sicilian"})
        campaign = played(client, tmp_path, mid)

        tenant = table_npcs(client, campaign)["Tenant"]
        assert tenant["dialect"] == "Sicilian"
        assert tenant["wants"] == "Keep the room."

        client.ok("mods.configure", {"campaign": campaign, "id": "dialects", "enabled": False})
        assert table_npcs(client, campaign)["Tenant"]["dialect"] == "Sicilian"
    finally:
        client.close()


def test_a_word_no_package_asked_for_does_not_reach_the_table(tmp_path):
    """The absence half of 28.2: a graph carrying a property under a key no package contributed is
    not projected. Without this the feature would be 'every property reaches the Keeper', which is
    what `entityView` already does on focus and what the per-turn dossier deliberately does not."""
    client = emitted_client(tmp_path / "ws")
    try:
        # `dialects` is not installed here; only Natural NPC's own `language` was ever asked for.
        mid, packet = built_module(client, tmp_path, {"agenda": "Keep the room.", "dialect": "Sicilian"})
        assert [entry["key"] for entry in packet["vocabulary"]["actor_dossier"]["contributed"]] == ["language"]
        tenant = table_npcs(client, played(client, tmp_path, mid))["Tenant"]
        assert tenant["wants"] == "Keep the room."
        assert "dialect" not in tenant and "Sicilian" not in json.dumps(tenant)
    finally:
        client.close()
