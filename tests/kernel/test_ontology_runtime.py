"""Slice 3, kernel side: the ontology registry at runtime (contract §13.4), the fail-closed
content graphs (§13.3, §13.6) and the `promise` memory kind (§13.5), through the RPC seam."""

import json
import os
from pathlib import Path

from conftest import narrate, CAMPAIGN, CONTENT_DIR, RpcClient, campaign_dir, create_campaign, open_turn, read_jsonl
from test_rules_families import resolve

INVESTIGATOR = "托马斯·海斯"


def content_variant(tmp_path: Path, *, drop: str | None = None, rewrite: dict[str, str] | None = None) -> Path:
    """A content directory that shares everything with the shipped one except what the
    test breaks: `drop` a file, `rewrite` a file's text."""
    root = tmp_path / "content"
    root.mkdir()
    for child in CONTENT_DIR.iterdir():
        target = root / child.name
        if child.is_dir():
            target.mkdir()
            for grandchild in child.iterdir():
                rel = f"{child.name}/{grandchild.name}"
                if rel == drop:
                    continue
                if rewrite and rel in rewrite:
                    (target / grandchild.name).write_text(rewrite[rel], encoding="utf-8")
                else:
                    os.symlink(grandchild, target / grandchild.name)
        else:
            os.symlink(child, target)
    return root


# ---- validation at table.open ---------------------------------------------------------------

def test_a_bad_ontology_reference_stops_the_table_from_opening_but_not_hello(tmp_path):
    ontology = json.loads((CONTENT_DIR / "ontology" / "system-ontology.json").read_text(encoding="utf-8"))
    ontology["references"].append({"ref_id": "ref:rule:coc7:decision-coc7-magic-summon-shoggoth", "graph_id": "graph:rule:coc7",
                                   "semantic_id": "decision:coc7:magic:summon-shoggoth", "reference_kind": "artifact-node",
                                   "node_kind": "decision"})
    ontology["relations"].append({"relation_id": "relation:system:dangling", "relation_kind": "grounded-by",
                                  "from_ref": "ref:director:investigate-intent", "to_ref": "ref:nowhere"})
    content = content_variant(tmp_path, rewrite={"ontology/system-ontology.json": json.dumps(ontology, ensure_ascii=False)})
    client = RpcClient(tmp_path / "ws", content=content)
    try:
        assert "the-haunting" in client.ok("kernel.hello")["content"]["modules"]
        create_campaign(client)
        error = client.table_err("open")
        assert error["code"] == "campaign_not_ready"
        bad = error["details"]["ontology"]
        assert {row.get("ref_id") for row in bad} == {"ref:rule:coc7:decision-coc7-magic-summon-shoggoth", "ref:nowhere"}
        reasons = " ".join(row["reason"] for row in bad)
        assert "rule graph" in reasons and "relation end" in reasons
    finally:
        client.close()


def test_the_shipped_ontology_validates_and_the_table_opens(kernel):
    create_campaign(kernel)
    opened = kernel.table("open")
    assert opened["opening_needed"] is True and opened["campaign"]["register"] == "purist"


def test_a_missing_director_graph_fails_closed(tmp_path):
    content = content_variant(tmp_path, drop="director/director-graph.json")
    client = RpcClient(tmp_path / "ws", content=content)
    try:
        assert client.ok("kernel.hello")["kernel_version"]
        error = client.err("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": "thomas-hayes"})
        assert error["code"] == "campaign_not_ready" and "unreadable" in error["details"]["director"]["reason"]
    finally:
        client.close()


def test_a_director_graph_whose_digest_disagrees_with_the_manifest_fails_closed(tmp_path):
    graph = json.loads((CONTENT_DIR / "director" / "director-graph.json").read_text(encoding="utf-8"))
    for node in graph["nodes"]:
        if node["node_id"] == "scoring-rule:reveal:investigate-intent":
            node["properties"]["value"] = 0.1  # a literal smuggled past the manifest
    content = content_variant(tmp_path, rewrite={"director/director-graph.json": json.dumps(graph, ensure_ascii=False)})
    client = RpcClient(tmp_path / "ws", content=content)
    try:
        error = client.err("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": "thomas-hayes"})
        assert error["code"] == "campaign_not_ready"
        assert "digest" in error["details"]["director"]["reason"]
        assert error["details"]["director"]["declared"] != error["details"]["director"]["actual"]
    finally:
        client.close()


def test_a_beat_table_naming_an_unknown_directive_fails_closed(tmp_path):
    table = json.loads((CONTENT_DIR / "craft" / "beat-directives.json").read_text(encoding="utf-8"))
    table["beats"]["REVEAL"].append("write-purple-prose")
    content = content_variant(tmp_path, rewrite={"craft/beat-directives.json": json.dumps(table, ensure_ascii=False)})
    client = RpcClient(tmp_path / "ws", content=content)
    try:
        error = client.err("campaign.create", {"id": CAMPAIGN, "module": "the-haunting", "pregen": "thomas-hayes"})
        assert error["code"] == "campaign_not_ready"
        assert any("write-purple-prose" in p for p in error["details"]["craft"]["problems"])
    finally:
        client.close()


def test_grounded_by_comes_only_from_the_registry(seeded_kernel):
    kernel = seeded_kernel  # the seed keeps the previous turn's roll ordinary (no fumble override)
    ontology = json.loads((CONTENT_DIR / "ontology" / "system-ontology.json").read_text(encoding="utf-8"))
    refs = {r["ref_id"]: r for r in ontology["references"]}
    allowed = set()
    for rel in ontology["relations"]:
        if rel["relation_kind"] in ("grounded-by", "may-emit-effect"):
            semantic = refs[rel["to_ref"]]["semantic_id"]
            allowed.add(semantic)
            allowed.add(":".join(semantic.split(":")[2:]))
    open_turn(kernel, "我仔细观察诺特。")
    resolve(kernel, "t1-c1", intent="investigate", goal="看他", method="用侦查", skill="Spot Hidden")
    narrate(kernel, "t1-c2", "……")
    director = kernel.table("player_input", text="继续。")["capsule"]["director"]
    assert director["grounded_by"] and set(director["grounded_by"]) <= allowed


# ---- needs_choice narrowing in resolve -------------------------------------------------------

def social_read(client, call_id, **extra):
    """social with a Psychology method: two candidates (§11.10), social:adjudicate-difficulty
    and psychology:observe-concealed."""
    return client.table_err("resolve", call_id=call_id, action={"intent": "social", "goal": "他在隐瞒什么", "method": "用心理学读他",
                                                                 "target": "Steven Knott", **extra})


def test_one_grounded_candidate_settles_with_decision_source_director(seeded_kernel):
    kernel = seeded_kernel  # the seed keeps the previous turn's roll ordinary (no fumble override)
    open_turn(kernel, "我仔细观察诺特。")
    resolve(kernel, "t1-c1", intent="investigate", goal="看他", method="用侦查", skill="Spot Hidden")
    narrate(kernel, "t1-c2", "……")
    director = kernel.table("player_input", text="我读他的表情。")["capsule"]["director"]
    assert director["beat"] == "REVEAL"
    assert "psychology:observe-concealed" in director["grounded_by"] and "social:adjudicate-difficulty" not in director["grounded_by"]
    result = kernel.table("resolve", call_id="t2-c1", action={"intent": "social", "goal": "他在隐瞒什么", "method": "用心理学读他",
                                                               "target": "Steven Knott"})
    assert result["decision"] == "psychology:observe-concealed" and result["decision_source"] == "director"


def test_several_grounded_candidates_narrow_the_choice_to_the_intersection(seeded_kernel):
    kernel = seeded_kernel  # the seed keeps the previous turn's roll ordinary (no fumble override)
    open_turn(kernel, "我恭维诺特。")
    resolve(kernel, "t1-c1", intent="social", goal="套话", method="用魅惑套话", target="Steven Knott")
    narrate(kernel, "t1-c2", "……")
    director = kernel.table("player_input", text="我读他的表情。")["capsule"]["director"]
    assert director["beat"] == "REVEAL"
    assert {"psychology:observe-concealed", "social:adjudicate-difficulty"} <= set(director["grounded_by"])
    error = social_read(kernel, "t2-c1")
    assert error["code"] == "needs_choice" and error["details"]["narrowed_by"] == "REVEAL"
    assert {c["name"] for c in error["details"]["candidates"]} == {"psychology:observe-concealed", "social:adjudicate-difficulty"}
    assert "REVEAL" in error["fix"]


def test_no_intersection_leaves_the_full_list_and_an_explicit_decision_is_never_overturned(kernel):
    open_turn(kernel, "我读诺特的表情。")
    assert kernel.table("capsule")["director"]["grounded_by"] == []  # CHARACTER grounds nothing
    error = social_read(kernel, "t1-c1")
    assert error["code"] == "needs_choice" and "narrowed_by" not in error["details"]
    assert len(error["details"]["candidates"]) == 2
    chosen = kernel.table("resolve", call_id="t1-c2", action={"intent": "social", "goal": "他在隐瞒什么", "method": "用心理学读他",
                                                               "target": "Steven Knott", "decision": "social:adjudicate-difficulty",
                                                               "skill": "Persuade"})
    assert chosen["decision"] == "social:adjudicate-difficulty" and "decision_source" not in chosen


def test_an_explicit_decision_is_untouched_even_when_the_director_grounds_the_other(seeded_kernel):
    kernel = seeded_kernel  # the seed keeps the previous turn's roll ordinary (no fumble override)
    open_turn(kernel, "我仔细观察诺特。")
    resolve(kernel, "t1-c1", intent="investigate", goal="看他", method="用侦查", skill="Spot Hidden")
    narrate(kernel, "t1-c2", "……")
    kernel.table("player_input", text="我读他的表情。")
    chosen = kernel.table("resolve", call_id="t2-c1", action={"intent": "social", "goal": "他在隐瞒什么", "method": "用心理学读他",
                                                               "target": "Steven Knott", "decision": "social:adjudicate-difficulty",
                                                               "skill": "Persuade"})
    assert chosen["decision"] == "social:adjudicate-difficulty" and "decision_source" not in chosen


# ---- the promise kind (§13.5) -----------------------------------------------------------------

def submit(client, job_id, candidates):
    return client.call("memory.submit", {"campaign": CAMPAIGN, "job_id": job_id, "candidates": candidates})


def test_promise_is_accepted_shown_as_an_obligation_and_closed_by_its_successor(kernel):
    open_turn(kernel, "我和诺特谈报酬。")
    job_id = narrate(kernel, "t1-c1", "诺特答应了。")["extraction"]["job_id"]
    landed = submit(kernel, job_id, [{"kind": "promise", "subject": "Steven Knott", "entities": [INVESTIGATOR],
                                      "statement": "三天内付清报酬，条件是交出书面报告。"}])
    assert landed["ok"], landed
    first_id = landed["result"]["written"][0]
    obligations = kernel.table("player_input", text="我记下了。")["capsule"]["obligations"]
    promise = next(o for o in obligations if o["kind"] == "promise")
    assert promise == {"kind": "promise", "name": first_id, "who": "Steven Knott", "state": "三天内付清报酬，条件是交出书面报告。",
                       "cue": INVESTIGATOR, "authority": "conversation_report",
                       "fulfillment": {"status": "open", "terms": []}}
    job_id = narrate(kernel, "t2-c1", "他改口了。")["extraction"]["job_id"]
    landed = submit(kernel, job_id, [{"kind": "promise", "subject": "Steven Knott", "entities": [INVESTIGATOR],
                                      "statement": "一周内付清报酬。"}])
    assert landed["ok"] and landed["result"]["superseded"] == [first_id]
    rows = {r["id"]: r for r in read_jsonl(campaign_dir(kernel.workspace) / "memory" / "candidates.jsonl")}
    assert rows[first_id]["status"] == "superseded" and rows[first_id]["valid_until_turn"] == 2
    obligations = kernel.table("player_input", text="好吧。")["capsule"]["obligations"]
    assert [o["state"] for o in obligations if o["kind"] == "promise"] == ["一周内付清报酬。"]


def test_promise_validation_is_the_same_closed_validation(kernel):
    open_turn(kernel, "我和诺特谈。")
    job_id = narrate(kernel, "t1-c1", "……")["extraction"]["job_id"]
    rejected = submit(kernel, job_id, [{"kind": "promise", "subject": "Steven Knott", "entities": ["a stranger"],
                                        "statement": "x"}])
    assert not rejected["ok"] and rejected["error"]["code"] == "invalid_params" and rejected["error"]["details"]["index"] == 0
    packet = kernel.ok("memory.job", {"campaign": CAMPAIGN, "turn": 1})
    assert "promise" in packet["instruction"]
