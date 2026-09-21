"""T10 private memory evidence owner through the TypeScript kernel RPC seam.

Fixtures exercise read-only evidence transport and authority. They are not gameplay or semantic-query acceptance.
"""

from __future__ import annotations

import hashlib
import json

import pytest

from conftest import CAMPAIGN, campaign_dir, git_log, read_json, read_jsonl
from test_memory import INV, KNOTT, close_turn, first_turn, submit
from test_jev_memory_write import decisions_with, finish_step, play_turn, referenced_job


def evidence(client, action, **params):
    return client.ok("memory.evidence", {"campaign": CAMPAIGN, "action": action, **params})


def evidence_error(client, action, **params):
    return client.err("memory.evidence", {"campaign": CAMPAIGN, "action": action, **params})


def pages(client, snapshot):
    rows, offset = [], 0
    while True:
        page = evidence(client, "page", snapshot=snapshot, offset=offset)
        assert len(page["rows"]) <= 20
        assert len(json.dumps(page, ensure_ascii=False).encode()) <= 12 * 1024
        rows.extend(page["rows"])
        if page["next_offset"] is None:
            return rows
        assert page["next_offset"] > offset
        offset = page["next_offset"]


def finish(client, snapshot, selected=(), assessments=(), considered=(), unknown=()):
    return evidence(client, "finish", snapshot=snapshot, selected=list(selected), assessments=list(assessments),
                    considered=list(considered), unknown=list(unknown))


def assessment(alias, **overrides):
    return {"alias": alias, "relevance": "direct", "support": "supported", "applicability": "current",
            "contradiction": "none", **overrides}


def fingerprint(client):
    root = campaign_dir(client.workspace)
    result = {}
    for name in ["campaign.json", "world.json", "turn.json", "events.jsonl", "memory/candidates.jsonl",
                 "npc-ledger.json"]:
        path = root / name
        result[name] = hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
    result["git"] = git_log(client.workspace)
    return result


def utf16_slice(text, start, end):
    return text.encode("utf-16-le")[start * 2:end * 2].decode("utf-16-le")


def publish_exact_keeper_source(client, keeper_text, needle):
    play_turn(client, "I ask for the exact account.", keeper_text)
    retained = None
    while True:
        packet = referenced_job(client)
        matches = [segment for segment in packet["step"]["segments"] if needle in segment["text"]]
        annotations = {}
        if matches:
            assert retained is None, "the fixture answer must occupy one exact issued occurrence"
            retained = matches[0]
            annotations[retained["alias"]] = [{"kind": "knowledge", "subject": INV, "entities": [KNOTT]}]
        submitted = finish_step(client, packet, decisions_with(packet, annotations))
        if submitted["status"] == "done":
            assert retained is not None
            return retained
        assert submitted["status"] == "open"


def read_keeper_pages(client, snapshot, alias):
    reads, offset = [], 0
    while True:
        result = evidence(client, "original", snapshot=snapshot, alias=alias, role="keeper", offset=offset)
        assert len(json.dumps(result, ensure_ascii=False).encode()) <= 12 * 1024
        reads.append(result)
        continuation = result["context"][0].get("next")
        if continuation is None:
            return reads
        assert continuation["offset"] > offset
        offset = continuation["offset"]


def test_wide_candidate_pool_pages_beyond_twelve_and_raw_gap_fallback_is_explicit_and_read_only(kernel):
    first_turn(kernel)
    submit(kernel, "extract:c1:t1", [
        {"kind": "knowledge", "subject": INV, "entities": [KNOTT], "statement": f"turn one indexed report {index}"}
        for index in range(12)
    ])
    close_turn(kernel, 2)
    submit(kernel, "extract:c1:t2", [
        {"kind": "belief", "subject": INV, "entities": [KNOTT], "statement": f"turn two indexed report {index}"}
        for index in range(12)
    ])
    before = fingerprint(kernel)

    snapshot = evidence(kernel, "snapshot", query="Find any retained report about the investigation.")
    assert snapshot["indexed"] == 24 and snapshot["total"] > 24
    assert snapshot["coverage"]["raw_gap_turns"] == [0]
    assert snapshot["coverage"]["raw_unavailable_lines"] == []
    rows = pages(kernel, snapshot["snapshot"])
    assert len(rows) == snapshot["total"]
    assert [row["alias"] for row in rows] == [f"entry:{index}" for index in range(len(rows))]
    assert sum(row["origin"] == "memory" for row in rows) == 24
    assert any(row["origin"] == "raw" and row["status"] == "unindexed" for row in rows)
    assert all(row["authority"] == "conversation_report" for row in rows)

    widened = evidence(kernel, "snapshot", query="Inspect every raw original too.", raw_all=True)
    widened_rows = pages(kernel, widened["snapshot"])
    assert widened["indexed"] == 24 and widened["raw"] > snapshot["raw"]
    assert widened["total"] > snapshot["total"]
    assert {row["turn"] for row in widened_rows if row["origin"] == "raw"}.issuperset({0, 1, 2})
    filtered = evidence(kernel, "snapshot", query="Only turn-two beliefs about the investigator.",
                        filters={"turns": [2, 2], "about": [INV], "kinds": ["belief"], "include_superseded": False})
    filtered_rows = pages(kernel, filtered["snapshot"])
    assert filtered["indexed"] == 12 and filtered["raw"] == 0
    assert all(row["kind"] == "belief" and row["turn"] == 2 and row["subject"] == INV for row in filtered_rows)
    assert fingerprint(kernel) == before, "snapshot and paging never write memory, world, events, or Git"


def test_exact_original_preserves_negation_conditions_utf16_refs_and_speaker_while_legacy_summary_is_derived(kernel):
    spoken = '"I will not enter if the bell rings 🔔."'
    play_turn(kernel, "I listen carefully.", f"A pause. {{{{say:{KNOTT}}}}}{spoken}{{{{/say}}}}")
    packet = referenced_job(kernel)
    source = next(segment for segment in packet["step"]["segments"] if spoken in segment["text"])
    finish_step(kernel, packet, decisions_with(packet, {source["alias"]: [{
        "kind": "promise", "subject": KNOTT, "entities": [INV]}]}))
    close_turn(kernel, 2)
    legacy_statement = "Generated legacy summary that is not copied from either original role."
    legacy_job = kernel.ok("memory.job", {"campaign": CAMPAIGN, "turn": 2})
    kernel.ok("memory.submit", {"campaign": CAMPAIGN, "job_id": legacy_job["job_id"], "candidates": [{
        "kind": "belief", "subject": INV, "entities": [KNOTT], "statement": legacy_statement}]})

    before = fingerprint(kernel)
    snapshot = evidence(kernel, "snapshot", query="What exactly was promised, including its condition and negation?")
    rows = pages(kernel, snapshot["snapshot"])
    promise = next(row for row in rows if row["text"] == source["text"] and row["kind"] == "promise")
    legacy = next(row for row in rows if row["text"] == legacy_statement)
    assert promise["derived"] is False and promise["attribution"] == source["attribution"]
    assert legacy["derived"] is True

    refused = evidence_error(kernel, "finish", snapshot=snapshot["snapshot"], selected=[promise["alias"]],
                             assessments=[assessment(promise["alias"])], considered=[promise["alias"]], unknown=[])
    assert refused["code"] == "invalid_params" and "verified original" in refused["message"]
    original = evidence(kernel, "original", snapshot=snapshot["snapshot"], alias=promise["alias"])
    assert original["verified"] is True and original["derived"] is False
    assert original["entry"]["text"] == source["text"]
    assert original["entry"]["attribution"] == source["attribution"]
    keeper = next(row for row in original["context"] if row["role"] == "keeper")
    assert spoken in keeper["text"]
    assert any(row["name"] == KNOTT and row["kind"] == "npc" for row in keeper["speakers"])
    primary = original["refs"][0]
    assert primary["sourceType"] == "turn" and primary["resource"].endswith(":keeper")
    assert primary["scope"] == snapshot["scope"]
    assert utf16_slice(keeper["text"], primary["selector"]["start"] - original["refs"][1]["selector"]["start"],
                       primary["selector"]["end"] - original["refs"][1]["selector"]["start"]) == source["text"]

    legacy_original = evidence(kernel, "original", snapshot=snapshot["snapshot"], alias=legacy["alias"])
    assert legacy_original["verified"] is True and legacy_original["derived"] is True
    assert {row["role"] for row in legacy_original["context"]} == {"player", "keeper"}
    complete = finish(kernel, snapshot["snapshot"], selected=[promise["alias"]],
                      assessments=[assessment(promise["alias"])], considered=[row["alias"] for row in rows])
    assert complete["status"] == "ready"
    assert complete["hits"][0]["entry"]["text"] == source["text"]
    assert complete["hits"][0]["assessment"] == assessment(promise["alias"])
    assert complete["refs"]
    assert fingerprint(kernel) == before


def test_finish_preserves_separately_read_initial_condition_and_later_answer(kernel):
    condition = "Initial condition: the cellar door remains locked until the witness returns."
    answer = "Later answer: Knott confirms that the witness returned before midnight."
    source = publish_exact_keeper_source(kernel, condition + "\n" + ("quiet corridor; " * 285) + "\n" + answer, answer)
    snapshot = evidence(kernel, "snapshot", query="What condition governed the later answer?")
    rows = pages(kernel, snapshot["snapshot"])
    selected = next(row for row in rows if row["text"] == source["text"])

    original_pages = read_keeper_pages(kernel, snapshot["snapshot"], selected["alias"])
    assert len(original_pages) == 2
    completed = finish(kernel, snapshot["snapshot"], selected=[selected["alias"]],
                       assessments=[assessment(selected["alias"])],
                       considered=[row["alias"] for row in rows])

    assert completed["status"] == "ready"
    combined = "".join(piece["text"] for piece in completed["hits"][0]["context"])
    assert condition in combined and answer in combined
    assert completed["hits"][0].get("omitted_context_count", 0) == 0
    assert original_pages[-1]["refs"][0] in completed["refs"], "the selected occurrence keeps its primary canonical ref"


def test_finish_bounds_accumulated_original_pages_and_reports_explicit_context_omission(kernel):
    answer = "Final answer: Knott identifies the sealed room after reviewing every condition."
    source = publish_exact_keeper_source(kernel, ("long contextual condition; " * 720) + "\n" + answer, answer)
    snapshot = evidence(kernel, "snapshot", query="Which final answer follows the long conditions?")
    rows = pages(kernel, snapshot["snapshot"])
    selected = next(row for row in rows if row["text"] == source["text"])
    original_pages = read_keeper_pages(kernel, snapshot["snapshot"], selected["alias"])
    assert len(original_pages) >= 4

    completed = finish(kernel, snapshot["snapshot"], selected=[selected["alias"]],
                       assessments=[assessment(selected["alias"])],
                       considered=[row["alias"] for row in rows])

    assert completed["status"] == "partial"
    hit = completed["hits"][0]
    assert hit["omitted_context_count"] >= 1
    assert hit["omitted_context"] and all(set(item) == {"role", "range"} for item in hit["omitted_context"])
    assert len(json.dumps(completed, ensure_ascii=False).encode()) <= 12 * 1024
    assert original_pages[-1]["refs"][0] in completed["refs"], "context shedding cannot discard the primary ref"


def test_scope_unissued_alias_and_selection_bounds_fail_closed(kernel):
    first_turn(kernel)
    submit(kernel, "extract:c1:t1", [{"kind": "knowledge", "subject": INV, "statement": f"row {index}"}
                                      for index in range(12)])
    close_turn(kernel, 2)
    submit(kernel, "extract:c1:t2", [{"kind": "belief", "subject": INV, "statement": f"later {index}"}
                                      for index in range(12)])
    foreign = evidence_error(kernel, "snapshot", query="scope", scope={"owner": "foreign", "campaign": "other",
        "worldline": "main", "loop": 0, "audience": "keeper"})
    assert foreign["code"] == "invalid_params"
    snapshot = evidence(kernel, "snapshot", query="scope")
    rows = pages(kernel, snapshot["snapshot"])
    stale = evidence_error(kernel, "page", snapshot=snapshot["snapshot"], offset=0,
                           scope={**snapshot["scope"], "worldline": "foreign"})
    assert stale["code"] == "invalid_params"
    assert evidence_error(kernel, "original", snapshot=snapshot["snapshot"], alias="entry:unissued")["code"] == "invalid_params"
    assert evidence_error(kernel, "finish", snapshot=snapshot["snapshot"], selected=[], assessments=[],
                          considered=["entry:unissued"], unknown=[])["code"] == "invalid_params"
    selected = [row["alias"] for row in rows[:21]]
    assert len(selected) == 21
    too_many = evidence_error(kernel, "finish", snapshot=snapshot["snapshot"], selected=selected,
                              assessments=[assessment(alias) for alias in selected], considered=selected, unknown=[])
    assert too_many["code"] == "invalid_params" and "twenty" in too_many["message"]


@pytest.mark.parametrize("change", ["receipt", "index", "source"])
def test_finish_requires_refresh_after_receipt_index_or_committed_source_change(kernel, change):
    first_turn(kernel)
    if change == "receipt":
        kernel.table("player_input", text="I wait while the task is open.")
    snapshot = evidence(kernel, "snapshot", query=f"refresh after {change}")
    if change == "receipt":
        kernel.table("apply", call_id="t2-c1", effects=[{"kind": "time", "minutes": 5}])
    elif change == "index":
        job = kernel.ok("memory.job", {"campaign": CAMPAIGN, "turn": 1})
        kernel.ok("memory.submit", {"campaign": CAMPAIGN, "job_id": job["job_id"], "candidates": [
            {"kind": "knowledge", "subject": INV, "statement": "A new indexed report."}]})
    else:
        close_turn(kernel, 2)
    assert finish(kernel, snapshot["snapshot"])["status"] == "refresh"


def test_explicit_foreign_line_reads_indexed_rows_but_reports_raw_originals_unavailable(kernel):
    first_turn(kernel)
    submit(kernel, "extract:c1:t1", [{"kind": "knowledge", "subject": INV, "statement": "Main-line indexed memory."}])
    commit = read_json(campaign_dir(kernel.workspace) / "turns" / "0001.json")["commit"]
    kernel.table("branch", commit=commit, name="side")
    close_turn(kernel, 2)
    submit(kernel, "extract:c1:t2", [{"kind": "belief", "subject": INV, "statement": "Side-line indexed memory."}])

    main = evidence(kernel, "snapshot", query="Read the main line", filters={"line": "main"})
    main_rows = pages(kernel, main["snapshot"])
    assert any(row["text"] == "Main-line indexed memory." and row["line"] == "main" for row in main_rows)
    assert main["coverage"]["raw_unavailable_lines"] == ["main"]
    assert main["raw"] == 0
    partial = finish(kernel, main["snapshot"], considered=[row["alias"] for row in main_rows])
    assert partial["status"] == "partial" and partial["coverage"]["raw_unavailable_lines"] == ["main"]

    any_line = evidence(kernel, "snapshot", query="Read both indexed lines", filters={"line": "any"})
    any_rows = pages(kernel, any_line["snapshot"])
    texts = {row["text"] for row in any_rows}
    assert {"Main-line indexed memory.", "Side-line indexed memory."}.issubset(texts)
    assert [row["text"] for row in any_rows].count("Main-line indexed memory.") == 1, (
        "line:any must not duplicate the same inherited candidate occurrence across branches")
    assert "main" in any_line["coverage"]["raw_unavailable_lines"]
    assert evidence_error(kernel, "snapshot", query="unknown line", filters={"line": "missing-line"})["code"] == "invalid_params"


def test_snapshot_include_superseded_filter_controls_closed_relationship_rows(kernel):
    first_turn(kernel)
    old = "Knott remains polite but distant."
    current = "Knott now trusts the investigator."
    submit(kernel, "extract:c1:t1", [{"kind": "relationship", "subject": KNOTT, "entities": [INV], "statement": old}])
    close_turn(kernel, 2)
    submit(kernel, "extract:c1:t2", [{"kind": "relationship", "subject": KNOTT, "entities": [INV], "statement": current}])

    active = evidence(kernel, "snapshot", query="What is Knott's current relationship?",
                      filters={"about": [KNOTT], "kinds": ["relationship"], "include_superseded": False})
    active_rows = pages(kernel, active["snapshot"])
    assert [row["text"] for row in active_rows if row["origin"] == "memory"] == [current]

    historical = evidence(kernel, "snapshot", query="How did Knott's relationship change?",
                          filters={"about": [KNOTT], "kinds": ["relationship"], "include_superseded": True})
    historical_rows = [row for row in pages(kernel, historical["snapshot"]) if row["origin"] == "memory"]
    assert {row["text"] for row in historical_rows} == {old, current}
    assert next(row for row in historical_rows if row["text"] == old)["status"] == "superseded"


def test_any_line_collapses_inherited_occurrence_but_keeps_same_id_from_distinct_source_commits(kernel):
    first_turn(kernel)
    common = "One retained occurrence exists before either branch."
    submit(kernel, "extract:c1:t1", [{"kind": "knowledge", "subject": INV, "statement": common}])
    turn_commit = read_json(campaign_dir(kernel.workspace) / "turns" / "0001.json")["commit"]

    # The first branch seals the post-turn memory write onto main. Two later branches share that
    # exact inherited occurrence, then independently create mem:t2-1 from different turn commits.
    kernel.table("branch", commit=turn_commit, name="seed")
    sealed_main = read_json(campaign_dir(kernel.workspace) / "campaign.json")["worldlines"]["main"]["last_commit"]
    kernel.table("branch", commit=sealed_main, name="side")
    side = "The side branch records its own turn-two statement."
    close_turn(kernel, 2, side)
    submit(kernel, "extract:c1:t2", [{"kind": "belief", "subject": INV, "statement": side}])

    kernel.table("branch", commit=sealed_main, name="other")
    other = "The other branch records a distinct turn-two statement."
    close_turn(kernel, 2, other)
    submit(kernel, "extract:c1:t2", [{"kind": "belief", "subject": INV, "statement": other}])

    snapshot = evidence(kernel, "snapshot", query="Compare memory occurrences across every line.", filters={"line": "any"})
    texts = [row["text"] for row in pages(kernel, snapshot["snapshot"]) if row["origin"] == "memory"]
    assert texts.count(common) == 1, "one inherited source occurrence must not be repeated for each descendant line"
    assert texts.count(side) == 1 and texts.count(other) == 1, (
        "candidate IDs reused on two branches remain distinct when their canonical source commits differ")


def test_public_recall_query_requires_typed_host_and_rejects_unissued_continuations(kernel):
    first_turn(kernel)
    submit(kernel, "extract:c1:t1", [{"kind": "knowledge", "subject": INV,
        "statement": "The ordinary retained-memory row remains directly readable."}])

    ordinary = kernel.table("recall", what="memory", about=[INV])
    unavailable = kernel.table_err("recall", what="memory", query="What was retained?", about=[INV])
    assert unavailable["code"] == "needs"
    assert unavailable["details"]["reason"] == "memory_query_requires_host"
    assert unavailable["fix"]

    invalid = [
        {"what": "history", "query": "What was retained?"},
        {"what": "memory", "query": ""},
        {"what": "memory", "query": "What was retained?", "read": {"turn": 1, "role": "keeper"}},
        {"what": "memory", "query": "What was retained?", "detail": {"section": "hits", "index": 0}},
        {"what": "memory", "query": "What was retained?", "page": {"section": "hits", "offset": 1}},
    ]
    for request in invalid:
        assert kernel.table_err("recall", **request)["code"] == "invalid_params"

    repeated = kernel.table("recall", what="memory", about=[INV])
    assert repeated["hits"] == ordinary["hits"], "adding query guards cannot alter the existing direct recall path"
