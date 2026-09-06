"""#22 (§13.1): the `module` section — the table briefing — rides in the capsule once, on
this process's first turn after open (the same condition as the full `style`), built from
the module graph alone: title, era, synopsis, the faction/place/people rosters with one
line each (people keeper-only, absent ones included), ending and conclusion names, the
structure type. Empty arrays where the graph has nothing; 2KB; `head` says it is there."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from conftest import CONTENT_DIR, KERNEL_DIR, RpcClient, campaign_dir, narrate, narrate_opening, open_turn, read_json

sys.path.insert(0, str(KERNEL_DIR))

from coc.capsule import MODULE_BUDGET, MODULE_LINE_STEPS, fitted_module_section, json_size, module_section  # noqa: E402
from coc.module_graph import ModuleGraph  # noqa: E402

HAUNTING = read_json(CONTENT_DIR / "starters" / "the-haunting" / "module-graph.json")


def names(kind: str) -> list[str]:
    return [n["name"] for n in HAUNTING["nodes"] if n["node_kind"] == kind]


def test_the_first_turn_after_open_carries_the_briefing_from_the_graph(kernel):
    capsule = open_turn(kernel, "我环顾四周。")["capsule"]
    module = capsule["module"]
    node = next(n for n in HAUNTING["nodes"] if n["node_kind"] == "module")
    assert module["title"] == node["name"] and module["synopsis"] == node["summary"]
    assert "era" not in module  # the-haunting's module record declares none: nothing is guessed
    assert [f["name"] for f in module["factions"]] == names("organization") + names("faction")
    assert [p["name"] for p in module["places"]] == names("location")
    # every person in the book, present or not — Corbitt is nowhere near Knott's office
    assert [p["name"] for p in module["people"]] == names("npc")
    assert "Walter Corbitt" in [p["name"] for p in module["people"]] and "Walter Corbitt" not in [p["name"] for p in capsule["present"]]
    assert module["endings"] == [] and module["conclusions"] == names("conclusion") and len(module["conclusions"]) == 6
    assert module["structure_type"] == "branching_investigation"
    assert all(set(row) == {"name", "line"} for roster in ("factions", "places", "people") for row in module[roster])
    assert module["factions"][0]["line"].startswith("A church linked to Corbitt")
    assert json_size(module) <= MODULE_BUDGET
    # the-haunting's full lines overflow 2KB: lines were cut, nobody was dropped, and it says so
    assert "module" in capsule["truncated"]
    assert "module" in capsule["head"] and "lookup" in capsule["head"]
    assert kernel.table("capsule")["module"] == module  # same turn, same process

    narrate(kernel, "t1-c1", "……")
    later = kernel.table("player_input", text="继续。")["capsule"]
    assert "module" not in later and "module" not in later.get("truncated", [])
    assert "module section" not in later["head"] and later["head"] in capsule["head"]


def test_a_new_process_briefs_again_under_the_same_condition_as_style_and_resume(tmp_path):
    first = RpcClient(tmp_path / "ws")
    try:
        open_turn(first, "我看看。")
        narrate(first, "t1-c1", "……")
        assert "module" not in first.table("player_input", text="继续。")["capsule"]
    finally:
        first.close()
    second = RpcClient(tmp_path / "ws")
    try:
        assert second.table("open")["turn"]["number"] == 2
        narrate(second, "t2-c1", "……")
        capsule = second.table("player_input", text="再来。")["capsule"]
        assert capsule["module"]["title"] == "The Haunting" and capsule["resume"]["turn"] == 1  # the checkpoint open found
        assert len(capsule["style"]["directives"]) > 4  # the full style, the resume and the briefing: one condition
    finally:
        second.close()


def test_the_briefing_speaks_the_play_language_in_head_only(tmp_path):
    client = RpcClient(tmp_path / "ws")
    try:
        client.ok("campaign.create", {"id": "c1", "module": "the-haunting", "pregen": "thomas-hayes", "play_language": "en"})
        narrate_opening(client)
        capsule = client.table("player_input", text="I look around.")["capsule"]
        assert "module section" in capsule["head"] and capsule["module"]["title"] == "The Haunting"
    finally:
        client.close()


# ---- in process: the fit and the empty domains --------------------------------------------------

def graph(module_id: str) -> ModuleGraph:
    return ModuleGraph(module_id, CONTENT_DIR / "starters" / module_id / "module-graph.json")


def test_lines_step_down_before_anyone_is_dropped_and_the_tail_goes_last():
    haunting = graph("the-haunting")
    full = module_section(haunting)
    assert json_size(full) > MODULE_BUDGET and max(len(p["line"]) for p in full["people"]) <= MODULE_LINE_STEPS[0]
    fitted, cut = fitted_module_section(haunting)
    assert cut and json_size(fitted) <= MODULE_BUDGET
    assert [p["name"] for p in fitted["people"]] == [p["name"] for p in full["people"]]  # nobody dropped
    assert 0 < max(len(p["line"]) for p in fitted["people"]) < MODULE_LINE_STEPS[0]  # lines shortened instead
    # a book that fits keeps its full lines and is not marked cut
    white_war = graph("the-white-war")
    untouched, cut = fitted_module_section(white_war)
    assert not cut and untouched == module_section(white_war)
    # only when names alone still overflow does the roster lose its tail
    squeezed, cut = fitted_module_section(haunting, budget=700)
    assert cut and json_size(squeezed) <= 700
    assert all(p["line"] == "" for p in squeezed["people"]) and 0 < len(squeezed["people"]) < len(full["people"])
    assert squeezed["people"][0]["name"] == full["people"][0]["name"]


def test_domains_the_graph_lacks_are_empty_arrays_never_guesses():
    for module_id in ("mystery-house", "the-white-war"):
        section = module_section(graph(module_id))
        raw = json.loads((CONTENT_DIR / "starters" / module_id / "module-graph.json").read_text(encoding="utf-8"))
        kinds = {n["node_kind"] for n in raw["nodes"]}
        assert not kinds & {"faction", "organization", "location", "ending"}
        assert section["factions"] == [] and section["places"] == [] and section["endings"] == []
        assert [p["name"] for p in section["people"]] == [n["name"] for n in raw["nodes"] if n["node_kind"] == "npc"]
        assert len(section["conclusions"]) == sum(1 for n in raw["nodes"] if n["node_kind"] == "conclusion")
        # §15.9: the module node declares itself in `module-meta.json`, so this is the
        # book's own word, not the reader's default -- the-white-war says `linear_acts`.
        meta = next(d["root"] for n in raw["nodes"] if n["node_id"].startswith("module-")
                    for d in n["properties"]["runtime_projection"]["documents"]
                    if d["filename"] == "module-meta.json")
        assert section["structure_type"] == meta["structure_type"] and "era" not in section


def test_the_line_is_graph_text_never_the_name_repeated():
    section = module_section(graph("the-haunting"))
    knott = next(p for p in section["people"] if p["name"] == "Steven Knott")
    record = next(n for n in HAUNTING["nodes"] if n["name"] == "Steven Knott")["properties"]["runtime_projection"]["record"]
    assert knott["line"] == f"{record['relationship_to_investigators']}; {record['agenda']}"[:MODULE_LINE_STEPS[0]]
    assert Path(CONTENT_DIR / "starters" / "the-haunting" / "module-graph.json").exists()
