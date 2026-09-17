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

from conftest import CAMPAIGN, RpcClient, WORKTREE, create_campaign, read_json

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
    entry = WORKTREE / "build" / "kernel" / "rpc.mjs"
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
    kernel.ok("mods.install", {"path": str(package(tmp_path, name="extra-field", vocabulary={**DIALECT, "extra": 1}))})
    future = next(row for row in kernel.ok("mods.list")["mods"] if row["id"] == "extra-field")
    assert future["compatible"] is False
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
                       for p in ["/nodes/0", "/nodes/2", "/claims/0", "/claims/1", "/coverage"]], "missing": []})
    finish(client, job)
    return mid, packet


def test_a_contributed_key_reaches_the_reader_and_the_module_records_it(tmp_path):
    """28.2/28.3: the reader is asked for the package's key by name, in its own words, and the
    module writes down the vocabulary it was read under -- the provenance the read side needs."""
    client = emitted_client(tmp_path / "ws")
    try:
        client.ok("mods.install", {"path": str(package(tmp_path, name="dialects"))})
        mid, packet = built_module(client, tmp_path, {"agenda": "Keep the room.", "dialect": "Sicilian"})

        # Natural NPC ships `language` and npc-voice ships `voice_mask` + `exchanges`, both on by default, so the reader is asked for all four.
        contributed = packet["vocabulary"]["actor_dossier"]["contributed"]
        assert DIALECT in contributed
        assert {entry["key"] for entry in contributed} == {"language", "voice_mask", "exchanges", "dialect"}
        # 28.5: a contributed word never joins the core list. `npcs_without_material` counts that
        # list and only that list, so merging the two here is what would quietly make every
        # under-written actor in every book look finished.
        core = packet["vocabulary"]["actor_dossier"]["profile_keys"]
        assert "dialect" not in core and "language" not in core

        recorded = read_json(client.workspace / ".coc" / "modules" / mid / "module.json")["vocabulary"]
        by_key = {entry["key"]: entry for entry in recorded["actor_profile_keys"]}
        assert set(by_key) == {"language", "voice_mask", "exchanges", "dialect"}
        assert by_key["dialect"]["mod"] == "dialects" and by_key["language"]["mod"] == "natural-npc"
        assert by_key["voice_mask"]["mod"] == "npc-voice" and by_key["exchanges"]["mod"] == "npc-voice"  # the shipped voice package (§40.7)
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
        assert [entry["key"] for entry in packet["vocabulary"]["actor_dossier"]["contributed"]] == ["language", "voice_mask", "exchanges"]
        tenant = table_npcs(client, played(client, tmp_path, mid))["Tenant"]
        assert tenant["wants"] == "Keep the room."
        assert "dialect" not in tenant and "Sicilian" not in json.dumps(tenant)
    finally:
        client.close()


def words(client, campaign):
    return {entry["key"]: entry for entry in client.ok("mods.context", {"campaign": campaign})
            .get("vocabulary", {}).get("words", [])}


def test_a_package_can_see_whether_its_own_word_reached_the_table(tmp_path):
    """28.6: enabling a package does not bind its word -- the build did that, or it did not. Both
    states put the same nothing on every actor, so a package that cannot read them apart answers
    'nobody here speaks anything else' off a book that was never asked. `bound` is that answer."""
    client = emitted_client(tmp_path / "ws")
    try:
        # Built with only Natural NPC installed: `language` was asked of this book, `dialect` never was.
        mid, _ = built_module(client, tmp_path, {"agenda": "Keep the room.", "dialect": "Sicilian"})
        client.ok("mods.install", {"path": str(package(tmp_path, name="dialects"))})
        campaign = played(client, tmp_path, mid)

        found = words(client, campaign)
        assert found["language"] == {"key": "language", "label": "speaks",
                                     "mod": "natural-npc", "bound": True}
        # On, and its word is absent from every actor in this book -- for a reason the package can read.
        assert found["dialect"] == {"key": "dialect", "label": "dialect",
                                    "mod": "dialects", "bound": False}
    finally:
        client.close()


def test_a_bound_word_outlives_the_package_that_asked_for_it(tmp_path):
    """28.5/28.6: the module's provenance is the authority, not the campaign's locks. A word whose
    package is gone still reaches the dossier, so reporting it as unbound -- or leaving it out --
    would tell the table a word it can plainly see is not there."""
    client = emitted_client(tmp_path / "ws")
    try:
        client.ok("mods.install", {"path": str(package(tmp_path, name="dialects"))})
        mid, _ = built_module(client, tmp_path, {"agenda": "Keep the room.", "dialect": "Sicilian"})
        campaign = played(client, tmp_path, mid)
        assert words(client, campaign)["dialect"] == {"key": "dialect", "label": "dialect",
                                                      "mod": "dialects", "bound": True}

        client.ok("mods.configure", {"campaign": campaign, "id": "dialects", "enabled": False})
        # The word is still on the actor (see the test above), so it is still reported -- unowned.
        assert table_npcs(client, campaign)["Tenant"]["dialect"] == "Sicilian"
        assert words(client, campaign)["dialect"] == {"key": "dialect", "label": "dialect",
                                                     "mod": None, "bound": True}
    finally:
        client.close()


# ---- establishing at the table (contract 28.7) --------------------------------------------------

def open_turn(client, campaign):
    client.ok("table.player_input", {"campaign": campaign, "text": "I try talking to them."})


def apply_dossier(client, campaign, name, values, call="t1-c1", why="The party heard them switch."):
    return client.ok("table.apply", {"campaign": campaign, "call_id": call, "effects": [
        {"kind": "dossier", "name": name, "values": values, "why": why}]})


def test_the_table_may_establish_a_word_the_book_left_silent(tmp_path):
    """28.7: no shipped book names anyone's tongue, so a word that could only be read off the source
    could only ever be read as nothing. What the table settles is kept, and reads back like any other
    word in the dossier -- so the same person is played the same way on every later turn."""
    client = emitted_client(tmp_path / "ws")
    try:
        client.ok("mods.install", {"path": str(package(tmp_path, name="dialects"))})
        # Built with the word bound but the book silent about this person.
        mid, _ = built_module(client, tmp_path, {"agenda": "Keep the room."})
        campaign = played(client, tmp_path, mid)
        open_turn(client, campaign)
        assert "dialect" not in table_npcs(client, campaign)["Tenant"]

        apply_dossier(client, campaign, "Tenant", {"dialect": "Sicilian, little English"})
        assert table_npcs(client, campaign)["Tenant"]["dialect"] == "Sicilian, little English"
    finally:
        client.close()


def test_what_the_table_established_goes_when_the_package_does(tmp_path):
    """28.7 against 28.5: a word the reader extracted is the book's own material and survives the
    package. A word the table established is the package's, and must not -- otherwise turning a Mod
    off leaves its fiction behind in a book that never said it."""
    client = emitted_client(tmp_path / "ws")
    try:
        client.ok("mods.install", {"path": str(package(tmp_path, name="dialects"))})
        mid, _ = built_module(client, tmp_path, {"agenda": "Keep the room."})
        campaign = played(client, tmp_path, mid)
        open_turn(client, campaign)
        apply_dossier(client, campaign, "Tenant", {"dialect": "Sicilian, little English"})

        # A turn in flight defers a Mod change to `mods.pending`, so the narration closes this one first.
        client.ok("table.narrate", {"campaign": campaign, "call_id": "t1-c2", "text": "The tenant shrugs."})

        client.ok("mods.configure", {"campaign": campaign, "id": "dialects", "enabled": False})
        assert "dialect" not in table_npcs(client, campaign)["Tenant"]
        client.ok("mods.configure", {"campaign": campaign, "id": "dialects", "enabled": True})
        assert table_npcs(client, campaign)["Tenant"]["dialect"] == "Sicilian, little English"
    finally:
        client.close()


def test_the_book_is_not_the_tables_to_overwrite(tmp_path):
    """28.7: one actor, one answer, and the authored one. Accepting the write and letting the source
    win on read would leave two answers on record and no way to see which the Keeper meant."""
    client = emitted_client(tmp_path / "ws")
    try:
        client.ok("mods.install", {"path": str(package(tmp_path, name="dialects"))})
        mid, _ = built_module(client, tmp_path, {"agenda": "Keep the room.", "dialect": "Sicilian"})
        campaign = played(client, tmp_path, mid)
        open_turn(client, campaign)

        refused = client.err("table.apply", {"campaign": campaign, "call_id": "t1-c1", "effects": [
            {"kind": "dossier", "name": "Tenant", "values": {"dialect": "Neapolitan"}}]})
        assert refused["code"] == "invalid_params"
        assert "Sicilian" in refused["message"]
        assert table_npcs(client, campaign)["Tenant"]["dialect"] == "Sicilian"
    finally:
        client.close()


def test_only_a_word_an_active_package_establishes_is_accepted(tmp_path):
    """28.7: the write is namespaced by the package that owns the word. A key nobody contributes has
    no namespace to land in, and accepting it would put an unowned fact on an actor."""
    client = emitted_client(tmp_path / "ws")
    try:
        client.ok("mods.install", {"path": str(package(tmp_path, name="dialects"))})
        mid, _ = built_module(client, tmp_path, {"agenda": "Keep the room."})
        campaign = played(client, tmp_path, mid)
        open_turn(client, campaign)

        refused = client.err("table.apply", {"campaign": campaign, "call_id": "t1-c1", "effects": [
            {"kind": "dossier", "name": "Tenant", "values": {"favourite_colour": "green"}}]})
        assert refused["code"] == "invalid_params"
        assert "favourite_colour" in refused["message"]
    finally:
        client.close()


def test_a_table_whose_module_never_carried_the_word_can_still_establish_it(tmp_path):
    """28.7's whole reason: a module built before the package was installed carries no label for the
    word, and reading the table's own record back through that build-time spine would leave the value
    written and unreadable -- the feature dead in exactly the case it exists for."""
    client = emitted_client(tmp_path / "ws")
    try:
        # Built with only Natural NPC installed: this module was never asked for `dialect` at all.
        mid, packet = built_module(client, tmp_path, {"agenda": "Keep the room."})
        assert [entry["key"] for entry in packet["vocabulary"]["actor_dossier"]["contributed"]] == ["language", "voice_mask", "exchanges"]
        client.ok("mods.install", {"path": str(package(tmp_path, name="dialects"))})
        campaign = played(client, tmp_path, mid)
        assert words(client, campaign)["dialect"]["bound"] is False

        open_turn(client, campaign)
        apply_dossier(client, campaign, "Tenant", {"dialect": "Sicilian, little English"})
        assert table_npcs(client, campaign)["Tenant"]["dialect"] == "Sicilian, little English"
    finally:
        client.close()
