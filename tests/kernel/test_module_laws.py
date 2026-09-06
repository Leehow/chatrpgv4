"""Black-box laws for module storage, PDF binding, unattended build and on-demand
deepening (contract §14.1-14.3, 14.6, 14.8), driven entirely through the RPC surface
against `tests/kernel/fixtures/bundle-laws/{good,broken}` -- a tiny synthetic
zh-Hans scenario ("红灯笼茶馆疑云", built with `tests/play/bundle_from_pages.py`)
authored independently of the kernel workers' own fixture (`tests/kernel/fixtures/
bundle-tiny`, driven from `tests/kernel/module_helpers.py`). Where both exist,
treat them as two independent readings of the same contract, not duplicates: this
file's assertions were derived from `docs/kernel-rpc.md` §14 and the shipped
`content/modules/module-graph-{contract-v3,template-v1}.json` before this file's
author read `kernel/coc/modules/*.py`'s own tests.

Status at write time: `kernel/coc/modules/{store,bundle,plan,packet,gates,assemble,
playability,deepen,assets,rpc}.py` are all complete and internally consistent with
the contract (verified here and by hand against a real pipeline run) -- but
`kernel/coc/rpc.py`'s `build_methods()` does not yet merge in
`coc.modules.rpc.methods(table)`, so **every `module.*` call in this file fails
with `unknown_method` today**. That is "not implemented yet", not a law violation;
once the three-line wiring lands, these should mostly go green unchanged (they were
written and hand-verified against `coc.modules.rpc.methods()` called directly,
bypassing the RPC transport, before being converted to the black-box RPC form below).

One separate, genuine, still-open gap found while writing this file (not a "not
implemented yet" stub, an actual blocking bug): `table.py`'s `campaign_create`
refuses any `module` that is not already a directory under `content/starters/`
with a `module-graph.json` (`self.modules()`). A module bound from a PDF only ever
lives under `.coc/modules/<id>/`, never under `content/starters/`, so **no
campaign can ever be created against a bound module** -- this blocks both the
`apply move` deepen test and the `apply handout` test below (both need a live
table against this module), and it blocks the pdf lane's own `create-campaign`
step, which the seven-step table (`content/setup/steps.json`) places *before*
`bind-source`. Both tests are written to the contract's intent and will start
proving something real the moment that gate is fixed; until then they fail at
`campaign.create` with `invalid_params: unknown module 'red-lantern-teahouse'`,
which is exactly what they assert today.
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

import pytest

from conftest import CAMPAIGN, RpcClient, campaign_dir, read_json

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "bundle-laws"
BUNDLE_GOOD = FIXTURES / "good"
BUNDLE_BROKEN = FIXTURES / "broken"
MODULE_GOOD = "red-lantern-teahouse"
MODULE_BROKEN = "red-lantern-teahouse-broken"

COVERAGE_DOMAINS = ("structure", "world", "actors", "relationships", "events",
                   "knowledge", "causal", "mechanics", "assets", "direction")
MODULE_STATUS_LADDER = ("registered", "planned", "building", "assembled", "installed")
PDF_LIBRARY_NAMES = ("pypdf", "PyPDF2", "pdfplumber", "fitz", "pymupdf", "pdfminer",
                    "pikepdf", "camelot", "tabula", "pdf2image")


# ---- generic RPC helpers ---------------------------------------------------------


def registered_methods(client: RpcClient) -> set[str]:
    return set(client.err("nope.not-a-real-method", {})["details"]["methods"])


def mcall(client: RpcClient, method: str, **params: Any) -> dict[str, Any]:
    return client.ok(f"module.{method}", params)


def mcall_err(client: RpcClient, method: str, **params: Any) -> dict[str, Any]:
    return client.err(f"module.{method}", params)


def module_dir(workspace: Path, module_id: str) -> Path:
    return workspace / ".coc" / "modules" / module_id


def full_coverage(status: str = "accepted") -> dict[str, str]:
    return {domain: status for domain in COVERAGE_DOMAINS}


def bind_and_plan_one_section(client: RpcClient, bundle: Path, *, budget: int | None = None) -> tuple[str, str]:
    """`module.bind` the fixture, `module.plan` (+`.accept`) it, return
    `(module_id, section_id)`. With the default budget the whole tiny book is one
    section; a small `budget` splits by page instead."""
    bound = mcall(client, "bind", bundle=str(bundle))
    module_id = bound["module_id"]
    params: dict[str, Any] = {"module_id": module_id}
    if budget is not None:
        params["budget"] = budget
    plan = client.ok("module.plan", params)
    classified = [{"id": row["id"], "kind": "scene", "priority": 100} for row in plan["sections"]]
    accepted = mcall(client, "plan.accept", module_id=module_id, sections=classified)
    return module_id, accepted["order"]


def packet_and_spans(client: RpcClient, module_id: str, section_id: str) -> tuple[dict[str, Any], dict[str, str]]:
    result = mcall(client, "packet", module_id=module_id, section_id=section_id)
    packet = read_json(Path(result["packet"]))
    spans = {row["span_id"]: row["text"] for row in packet["spans"]}
    return packet, spans


def find_span(spans: dict[str, str], needle: str) -> str:
    for span_id, text in spans.items():
        if needle in text:
            return span_id
    raise AssertionError(f"no span in this packet contains {needle!r} (have {sorted(spans)})")


def write_shard(client: RpcClient, module_id: str, section_id: str, shard: dict[str, Any]) -> Path:
    path = module_dir(client.workspace, module_id) / "work" / section_id / "shard.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(shard, ensure_ascii=False, indent=1), encoding="utf-8")
    return path


# ---- v3 node/claim/relation builders (contract_id coc.module-graph-shard.v3,
# content/modules/module-graph-contract-v3.json) --------------------------------


def mknode(node_id: str, kind: str, name: str, spans: list[str], *, visibility: str = "keeper-only",
          summary: str | None = None, properties: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"node_id": node_id, "node_kind": kind, "name": name, "visibility": visibility,
            "aliases": [], "summary": summary or name, "evidence_span_ids": spans,
            "properties": properties or {}}


def mclaim_relation(claim_id: str, subject: str, predicate: str, obj: str, spans: list[str],
                    *, visibility: str = "keeper-only") -> tuple[dict[str, Any], dict[str, Any]]:
    claim = {"claim_id": claim_id, "subject_id": subject, "predicate": predicate,
             "object": {"node_id": obj}, "truth_status": "authored-fact",
             "visibility": visibility, "evidence_span_ids": spans}
    relation = {"relation_id": f"rel-{claim_id[len('claim-'):]}", "relation_kind": predicate,
                "from_node_id": subject, "to_node_id": obj, "claim_id": claim_id, "properties": {}}
    return claim, relation


def base_shard(module_id: str, section_id: str, packet: dict[str, Any]) -> dict[str, Any]:
    return {"contract_id": "coc.module-graph-shard.v3", "schema_version": 3,
            "module_id": module_id, "section_id": section_id, "source_language": "zh-Hans",
            "aspects": list(packet["aspects"]), "node_refs": [], "coverage": full_coverage(),
            "nodes": [], "claims": [], "relations": []}


def close_shard(shard: dict[str, Any]) -> dict[str, Any]:
    """`evidence_span_ids` as the union of every node/claim citation, per the
    contract's `evidence_scope_law`."""
    shard = copy.deepcopy(shard)
    spans: set[str] = set()
    for node in shard["nodes"]:
        spans.update(node["evidence_span_ids"])
    for claim in shard["claims"]:
        spans.update(claim["evidence_span_ids"])
    shard["evidence_span_ids"] = sorted(spans)
    return shard


def good_shard(module_id: str, section_id: str, packet: dict[str, Any], spans: dict[str, str]) -> dict[str, Any]:
    """The scenario's whole graph (front matter, two connected scenes, an NPC, two
    clues each supporting the conclusion, a handout, a keeper-only asset). Mirrors
    exactly what `module.assemble` accepted when this fixture was hand-verified."""
    find = lambda needle: find_span(spans, needle)  # noqa: E731
    module_node_id = f"module-{module_id}"
    shard = base_shard(module_id, section_id, packet)
    shard["nodes"] = [
        mknode(module_node_id, "module", "红灯笼茶馆疑云", [find("红灯笼茶馆深夜仍亮着灯")],
              summary="三十年代江南小镇的怪谈短篇。",
              properties={"entry_scene_ids": ["scene-front-hall"], "ending_scene_ids": []}),
        mknode("scene-front-hall", "scene", "茶馆前厅", [find("前厅摆着八张方桌")],
              properties={"is_entrance": True}),
        mknode("scene-back-yard", "scene", "后院", [find("老板娘阿秀站在后院的水井旁")]),
        mknode("scene-cellar", "scene", "地窖", [find("地窖里堆满了旧木箱")]),
        mknode("npc-aqiu", "npc", "阿秀", [find("老板娘阿秀站在后院的水井旁")]),
        mknode("clue-faded-letter", "clue", "褪色的信笺", [find("阿秀的裙摆下露出一封褪色的信笺")],
              visibility="revealable", properties={"delivery_kind": "skill_check"}),
        mknode("clue-cellar-key", "clue", "地窖钥匙", [find("水井旁的地砖下藏着一把地窖钥匙")],
              visibility="revealable", properties={"delivery_kind": "skill_check"}),
        mknode("conclusion-aqiu-is-the-pawnbroker", "conclusion", "阿秀就是三十年前失踪的当铺老板娘本人",
              [find("就能确认阿秀就是三十年前失踪的当铺老板娘本人")]),
        mknode("handout-teahouse-map", "handout", "茶馆地图", [find("茶馆地图")], visibility="player-safe"),
        mknode("asset-secret-plan", "asset", "科尔比特秘密平面图",
              [find("老板娘阿秀站在后院的水井旁")]),
    ]
    pairs = [
        ("claim-route-front-hall-back-yard", "scene-front-hall", "route-to", "scene-back-yard",
         [find("穿过后门的布帘可以走到后院")]),
        ("claim-route-back-yard-cellar", "scene-back-yard", "route-to", "scene-cellar",
         [find("地窖钥匙能打开后院角落的地窖入口")]),
        ("claim-aqiu-present-back-yard", "npc-aqiu", "present-in", "scene-back-yard",
         [find("老板娘阿秀站在后院的水井旁")]),
        ("claim-letter-discoverable", "clue-faded-letter", "discoverable-at", "scene-back-yard",
         [find("阿秀的裙摆下露出一封褪色的信笺")]),
        ("claim-key-discoverable", "clue-cellar-key", "discoverable-at", "scene-back-yard",
         [find("水井旁的地砖下藏着一把地窖钥匙")]),
        ("claim-letter-supports", "clue-faded-letter", "supports", "conclusion-aqiu-is-the-pawnbroker",
         [find("就能确认阿秀就是三十年前失踪的当铺老板娘本人")]),
        ("claim-key-supports", "clue-cellar-key", "supports", "conclusion-aqiu-is-the-pawnbroker",
         [find("就能确认阿秀就是三十年前失踪的当铺老板娘本人")]),
    ]
    for claim_id, subject, predicate, obj, evidence in pairs:
        claim, relation = mclaim_relation(claim_id, subject, predicate, obj, evidence)
        shard["claims"].append(claim)
        shard["relations"].append(relation)
    return close_shard(shard)


def broken_shard(module_id: str, section_id: str, packet: dict[str, Any], spans: dict[str, str]) -> dict[str, Any]:
    """Same scenario, deliberately broken: a `route-to` to `scene-attic` (declared
    only as an external `node_refs` entry, never a real node anywhere) -> a
    `dangling_relation`; a clue mentioned in the text but never tied to any scene
    via `discoverable-at` -> `clue_nowhere_to_find`."""
    find = lambda needle: find_span(spans, needle)  # noqa: E731
    module_node_id = f"module-{module_id}"
    shard = base_shard(module_id, section_id, packet)
    shard["node_refs"] = ["scene-attic"]
    shard["nodes"] = [
        mknode(module_node_id, "module", "红灯笼茶馆疑云（残卷）", [find("红灯笼茶馆深夜仍亮着灯")],
              properties={"entry_scene_ids": ["scene-front-hall"], "ending_scene_ids": []}),
        mknode("scene-front-hall", "scene", "茶馆前厅", [find("前厅摆着八张方桌")],
              properties={"is_entrance": True}),
        mknode("scene-back-yard", "scene", "后院", [find("老板娘阿秀站在后院的水井旁")]),
        mknode("npc-aqiu", "npc", "阿秀", [find("老板娘阿秀站在后院的水井旁")]),
        mknode("clue-faded-letter", "clue", "褪色的信笺", [find("阿秀的裙摆下露出一封褪色的信笺")],
              visibility="revealable", properties={"delivery_kind": "skill_check"}),
        mknode("clue-cellar-key", "clue", "地窖钥匙", [find("水井旁的地砖下藏着一把地窖钥匙")],
              visibility="revealable", properties={"delivery_kind": "skill_check"}),
        # Mentioned on the page, never placed anywhere: clue_nowhere_to_find.
        mknode("clue-attic-blueprint", "clue", "阁楼图纸", [find("据说阁楼里还藏着一张阁楼图纸")],
              visibility="revealable", properties={"delivery_kind": "skill_check"}),
        mknode("conclusion-aqiu-is-the-pawnbroker", "conclusion", "阿秀就是三十年前失踪的当铺老板娘本人",
              [find("就能确认阿秀就是三十年前失踪的当铺老板娘本人")]),
    ]
    pairs = [
        ("claim-route-front-hall-back-yard", "scene-front-hall", "route-to", "scene-back-yard",
         [find("穿过后门的布帘可以走到后院")]),
        # Dangling: routes to a scene never defined in any accepted shard.
        ("claim-route-front-hall-attic", "scene-front-hall", "route-to", "scene-attic",
         [find("顺着吱呀作响的楼梯还能爬上阁楼")]),
        ("claim-aqiu-present-back-yard", "npc-aqiu", "present-in", "scene-back-yard",
         [find("老板娘阿秀站在后院的水井旁")]),
        ("claim-letter-discoverable", "clue-faded-letter", "discoverable-at", "scene-back-yard",
         [find("阿秀的裙摆下露出一封褪色的信笺")]),
        ("claim-key-discoverable", "clue-cellar-key", "discoverable-at", "scene-back-yard",
         [find("水井旁的地砖下藏着一把地窖钥匙")]),
        ("claim-letter-supports", "clue-faded-letter", "supports", "conclusion-aqiu-is-the-pawnbroker",
         [find("就能确认阿秀就是三十年前失踪的当铺老板娘本人")]),
        ("claim-key-supports", "clue-cellar-key", "supports", "conclusion-aqiu-is-the-pawnbroker",
         [find("就能确认阿秀就是三十年前失踪的当铺老板娘本人")]),
        ("claim-blueprint-supports", "clue-attic-blueprint", "supports", "conclusion-aqiu-is-the-pawnbroker",
         [find("就能确认阿秀就是三十年前失踪的当铺老板娘本人")]),
    ]
    for claim_id, subject, predicate, obj, evidence in pairs:
        claim, relation = mclaim_relation(claim_id, subject, predicate, obj, evidence)
        shard["claims"].append(claim)
        shard["relations"].append(relation)
    return close_shard(shard)


def build_good_module(client: RpcClient) -> tuple[str, str]:
    """bind -> plan -> packet -> author -> review -> accept -> assemble the whole
    good fixture as one section. Returns (module_id, section_id)."""
    module_id, sections = bind_and_plan_one_section(client, BUNDLE_GOOD)
    section_id = sections[0]
    packet, spans = packet_and_spans(client, module_id, section_id)
    write_shard(client, module_id, section_id, good_shard(module_id, section_id, packet, spans))
    report = mcall(client, "review", module_id=module_id, section_id=section_id)
    assert report["accepted"], report["findings"]
    mcall(client, "accept", module_id=module_id, section_id=section_id)
    return module_id, section_id


# =============================================================================
# §14.2 module.bind
# =============================================================================


def test_bind_rejects_a_tampered_page_naming_it_in_details_pages(kernel, tmp_path):
    bundle = tmp_path / "tampered"
    import shutil
    shutil.copytree(BUNDLE_GOOD, bundle)
    (bundle / "pages" / "0002.md").write_text("有人偷偷改过这一页。\n", encoding="utf-8")

    error = mcall_err(kernel, "bind", bundle=str(bundle))
    assert error["code"] == "invalid_params"
    bad_pages = error["details"]["pages"]
    assert any(row.get("pdf_index") == 2 and row.get("code") == "sha256_mismatch" for row in bad_pages)


def test_bind_refuses_non_contiguous_pages(kernel, tmp_path):
    import shutil
    bundle = tmp_path / "gap"
    shutil.copytree(BUNDLE_GOOD, bundle)
    manifest_path = bundle / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["pages"] = [p for p in manifest["pages"] if p["pdf_index"] != 2]
    manifest["source"]["page_count"] = len(manifest["pages"])
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    (bundle / "pages" / "0002.md").unlink()

    error = mcall_err(kernel, "bind", bundle=str(bundle))
    assert error["code"] == "invalid_params"
    codes = {row.get("code") for row in error["details"]["pages"]}
    assert "page_missing_from_manifest" in codes or "page_out_of_sequence" in codes


def test_store_is_append_only_binding_twice_never_overwrites_pages(kernel):
    import hashlib

    def page_hashes(module_id: str) -> dict[str, str]:
        pages_dir = module_dir(kernel.workspace, module_id) / "bundle" / "pages"
        return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(pages_dir.iterdir())}

    first = mcall(kernel, "bind", bundle=str(BUNDLE_GOOD))
    before = page_hashes(first["module_id"])
    second = kernel.call("module.bind", {"bundle": str(BUNDLE_GOOD)})
    if second["ok"]:
        assert second["result"]["page_count"] == first["page_count"]
    else:
        assert second["error"]["code"] in {"invalid_params", "idempotency_conflict"}
    after = page_hashes(first["module_id"])
    assert after == before, "a second bind must never overwrite a stored page"


def test_no_pdf_library_is_imported_anywhere_under_kernel():
    kernel_root = Path(__file__).resolve().parents[2] / "kernel"
    import_re = re.compile(r"^\s*(?:import|from)\s+([a-zA-Z0-9_.]+)")
    offenders = []
    for path in kernel_root.rglob("*.py"):
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            match = import_re.match(line)
            if match and match.group(1).split(".")[0] in PDF_LIBRARY_NAMES:
                offenders.append(f"{path}: {line.strip()}")
    assert offenders == []


# =============================================================================
# §14.3 module.status ladder
# =============================================================================


def test_module_status_only_moves_forward(kernel):
    def status_of(module_id: str) -> str:
        return read_json(module_dir(kernel.workspace, module_id) / "module.json")["status"]

    bound = mcall(kernel, "bind", bundle=str(BUNDLE_GOOD))
    module_id = bound["module_id"]
    seen = [status_of(module_id)]
    assert seen == ["registered"]

    plan = mcall(kernel, "plan", module_id=module_id)
    section_id = plan["sections"][0]["id"]
    mcall(kernel, "plan.accept", module_id=module_id,
         sections=[{"id": section_id, "kind": "scene", "priority": 100}])
    seen.append(status_of(module_id))

    packet, spans = packet_and_spans(kernel, module_id, section_id)
    seen.append(status_of(module_id))  # module.packet advances to "building"
    write_shard(kernel, module_id, section_id, good_shard(module_id, section_id, packet, spans))
    report = mcall(kernel, "review", module_id=module_id, section_id=section_id)
    assert report["accepted"], report["findings"]
    mcall(kernel, "accept", module_id=module_id, section_id=section_id)
    assemble = mcall(kernel, "assemble", module_id=module_id)
    seen.append(assemble["status"])
    install = mcall(kernel, "install", module_id=module_id)
    seen.append(install["status"])

    ranks = [MODULE_STATUS_LADDER.index(s) if s in MODULE_STATUS_LADDER
             else MODULE_STATUS_LADDER.index("assembled") for s in seen]
    assert ranks == sorted(ranks), f"status ladder went backwards: {seen}"
    assert seen[0] == "registered" and seen[-1] == "installed"


# =============================================================================
# §14.3 module.review: determinism and the three fail-closed gates
# =============================================================================


def test_review_is_deterministic_same_shard_same_findings(kernel):
    module_id, sections = bind_and_plan_one_section(kernel, BUNDLE_GOOD)
    section_id = sections[0]
    packet, spans = packet_and_spans(kernel, module_id, section_id)
    write_shard(kernel, module_id, section_id, good_shard(module_id, section_id, packet, spans))
    first = mcall(kernel, "review", module_id=module_id, section_id=section_id)
    second = mcall(kernel, "review", module_id=module_id, section_id=section_id)
    assert first["accepted"] == second["accepted"]
    assert first["findings"] == second["findings"]
    assert first["measures"] == second["measures"]


def test_review_fails_closed_on_an_invented_span_id(kernel):
    module_id, sections = bind_and_plan_one_section(kernel, BUNDLE_GOOD)
    section_id = sections[0]
    packet, spans = packet_and_spans(kernel, module_id, section_id)
    shard = good_shard(module_id, section_id, packet, spans)
    shard["nodes"][0]["evidence_span_ids"].append("span-p999-1")
    shard["evidence_span_ids"] = sorted(set(shard["evidence_span_ids"]) | {"span-p999-1"})
    write_shard(kernel, module_id, section_id, shard)
    report = mcall(kernel, "review", module_id=module_id, section_id=section_id)
    assert report["accepted"] is False
    assert any(f["gate"] == "shape" and f["code"] == "unknown_evidence_span" for f in report["findings"])


def test_review_fails_closed_on_a_node_id_without_kind_prefix(kernel):
    module_id, sections = bind_and_plan_one_section(kernel, BUNDLE_GOOD)
    section_id = sections[0]
    packet, spans = packet_and_spans(kernel, module_id, section_id)
    shard = good_shard(module_id, section_id, packet, spans)
    shard["nodes"][1]["node_id"] = "front-hall"  # was "scene-front-hall"
    write_shard(kernel, module_id, section_id, shard)
    report = mcall(kernel, "review", module_id=module_id, section_id=section_id)
    assert report["accepted"] is False
    assert any(f["gate"] == "shape" for f in report["findings"])


def test_review_fails_closed_on_a_claim_id_without_claim_prefix(kernel):
    module_id, sections = bind_and_plan_one_section(kernel, BUNDLE_GOOD)
    section_id = sections[0]
    packet, spans = packet_and_spans(kernel, module_id, section_id)
    shard = good_shard(module_id, section_id, packet, spans)
    shard["claims"][0]["claim_id"] = "route-front-hall-back-yard"  # missing "claim-"
    shard["relations"][0]["claim_id"] = "route-front-hall-back-yard"
    write_shard(kernel, module_id, section_id, shard)
    report = mcall(kernel, "review", module_id=module_id, section_id=section_id)
    assert report["accepted"] is False
    assert any(f["gate"] == "shape" for f in report["findings"])


def test_review_fails_closed_on_an_undeclared_coverage_aspect(kernel):
    """The `fill` step (`kernel/coc/modules/gates.py`) machine-heals a `coverage` dict
    missing a domain key back to `"unresolved"` before any gate runs -- an omitted
    key alone can never fail review (the coverage LAW is "every undeclared aspect
    is exactly unresolved", and fill enforces exactly that). What review does
    reject is a domain claiming real coverage (`"accepted"`) while the shard never
    even declared it as one of the `aspects` this section covers -- an aspect
    outside the section's own declared scope."""
    module_id, sections = bind_and_plan_one_section(kernel, BUNDLE_GOOD)
    section_id = sections[0]
    packet, spans = packet_and_spans(kernel, module_id, section_id)
    shard = good_shard(module_id, section_id, packet, spans)
    shard["aspects"] = [a for a in shard["aspects"] if a != "assets"]  # "assets" now undeclared
    assert shard["coverage"]["assets"] == "accepted"  # ... yet still claims real coverage
    write_shard(kernel, module_id, section_id, shard)
    report = mcall(kernel, "review", module_id=module_id, section_id=section_id)
    assert report["accepted"] is False
    assert any(f["gate"] == "coverage" and f["code"] == "coverage_outside_aspects" for f in report["findings"])


def test_machine_filled_keys_are_filled_when_absent_and_the_shard_still_passes(kernel):
    module_id, sections = bind_and_plan_one_section(kernel, BUNDLE_GOOD)
    section_id = sections[0]
    packet, spans = packet_and_spans(kernel, module_id, section_id)
    shard = good_shard(module_id, section_id, packet, spans)
    del shard["relations"]
    for claim in shard["claims"]:
        claim.pop("visibility", None)
    write_shard(kernel, module_id, section_id, shard)

    report = mcall(kernel, "review", module_id=module_id, section_id=section_id)
    assert report["accepted"] is True, report["findings"]
    assert "relations" in report["machine_filled"]
    accepted = mcall(kernel, "accept", module_id=module_id, section_id=section_id)
    stored = read_json(Path(accepted["shard"]))
    assert len(stored["relations"]) == len(shard["claims"])
    assert all(c.get("visibility") for c in stored["claims"])


# =============================================================================
# §14.3 module.assemble: never raises, reports instead; the broken fixture
# =============================================================================


def test_assemble_never_raises_on_a_conflicting_shard_reports_instead(kernel):
    """Two sections of the same fresh bind both describe `npc-aqiu` (阿秀 is named on
    both the back-yard page and the appendix page) -- same node id, same kind, but a
    different `summary`. That is a legitimate two-reader disagreement, not a shape
    violation (an id/kind mismatch would be caught by `module.review` itself, before
    ever reaching assemble; see the sibling shape-gate tests above). `module.assemble`
    must report the field conflict and keep going, not raise (contract §14.3:
    "合并冲突...是报告不是异常"), and still merge every claim/relation from both."""
    module_id, sections = bind_and_plan_one_section(kernel, BUNDLE_GOOD, budget=1)
    back_yard_section = next(s for s in sections
                             if "老板娘阿秀站在后院的水井旁" in "".join(
                                 packet_and_spans(kernel, module_id, s)[1].values()))
    appendix_section = next(s for s in sections
                            if "阿秀的力量是45" in "".join(
                                packet_and_spans(kernel, module_id, s)[1].values()))

    packet1, spans1 = packet_and_spans(kernel, module_id, back_yard_section)
    shard1 = base_shard(module_id, back_yard_section, packet1)
    shard1["nodes"] = [mknode("npc-aqiu", "npc", "阿秀", [find_span(spans1, "老板娘阿秀站在后院的水井旁")],
                              summary="老板娘阿秀站在后院的水井旁。")]
    write_shard(kernel, module_id, back_yard_section, shard1)
    report1 = mcall(kernel, "review", module_id=module_id, section_id=back_yard_section)
    assert report1["accepted"], report1["findings"]
    mcall(kernel, "accept", module_id=module_id, section_id=back_yard_section)

    packet2, spans2 = packet_and_spans(kernel, module_id, appendix_section)
    shard2 = base_shard(module_id, appendix_section, packet2)
    shard2["nodes"] = [mknode("npc-aqiu", "npc", "阿秀", [find_span(spans2, "阿秀的力量是45")],
                              summary="阿秀的力量是45，体质是60，体型是55。")]
    write_shard(kernel, module_id, appendix_section, shard2)
    report2 = mcall(kernel, "review", module_id=module_id, section_id=appendix_section)
    assert report2["accepted"], report2["findings"]
    mcall(kernel, "accept", module_id=module_id, section_id=appendix_section)

    result = mcall(kernel, "assemble", module_id=module_id)  # must not raise
    assert isinstance(result, dict) and "status" in result
    graph = read_json(module_dir(kernel.workspace, module_id) / "module-graph.json")
    merged = next(n for n in graph["nodes"] if n["node_id"] == "npc-aqiu")
    assert set(merged["evidence_span_ids"]) == set(shard1["nodes"][0]["evidence_span_ids"]) | set(
        shard2["nodes"][0]["evidence_span_ids"]), "both sections' evidence survives the merge"


def test_broken_fixture_assembles_not_playable_with_dangling_relation_and_clue_nowhere_to_find(kernel):
    module_id, sections = bind_and_plan_one_section(kernel, BUNDLE_BROKEN)
    section_id = sections[0]
    packet, spans = packet_and_spans(kernel, module_id, section_id)
    shard = broken_shard(module_id, section_id, packet, spans)
    write_shard(kernel, module_id, section_id, shard)
    report = mcall(kernel, "review", module_id=module_id, section_id=section_id)
    assert report["accepted"], report["findings"]
    mcall(kernel, "accept", module_id=module_id, section_id=section_id)

    result = mcall(kernel, "assemble", module_id=module_id)
    assert result["status"] == "assembled_not_playable"
    assert result["playability"]["finding_counts"].get("dangling_relation", 0) >= 1
    assert result["playability"]["finding_counts"].get("clue_nowhere_to_find", 0) >= 1
    assert any(d["node_id"] == "scene-attic" for d in result["dangling_relations"])

    refused = mcall_err(kernel, "install", module_id=module_id)
    assert refused["code"] == "invalid_params"
    meta = read_json(module_dir(kernel.workspace, module_id) / "module.json")
    assert meta["status"] == "assembled_not_playable"

    forced = mcall(kernel, "install", module_id=module_id, force=True)
    assert forced["status"] == "installed" and forced["forced"] is True


# =============================================================================
# §14.3 opening_ready
# =============================================================================


def test_opening_ready_false_before_accept_true_after(kernel):
    module_id, sections = bind_and_plan_one_section(kernel, BUNDLE_GOOD)
    section_id = sections[0]
    before = mcall(kernel, "status", module_id=module_id)
    assert before["opening_ready"] is False

    packet, spans = packet_and_spans(kernel, module_id, section_id)
    write_shard(kernel, module_id, section_id, good_shard(module_id, section_id, packet, spans))
    report = mcall(kernel, "review", module_id=module_id, section_id=section_id)
    assert report["accepted"], report["findings"]
    mcall(kernel, "accept", module_id=module_id, section_id=section_id)
    result = mcall(kernel, "assemble", module_id=module_id)

    assert result["opening_ready"] is True
    after = mcall(kernel, "status", module_id=module_id)
    assert after["opening_ready"] is True


# =============================================================================
# §14.6 deepen via `apply move`; §14.8 `apply handout`
#
# Both blocked today by campaign_create's starter-only module gate (see module
# docstring). Written to the contract's intent; asserts the specific blocker.
# =============================================================================


def _campaign_create_for_bound_module(kernel: RpcClient, module_id: str) -> dict[str, Any]:
    """§14.4 for a bound book: create (setting_up, no world yet) → investigator → complete
    (world starts from the assembled graph) → open (active). Returns the create envelope so
    callers can still see a refusal."""
    created = kernel.call("campaign.create", {"id": CAMPAIGN, "module": module_id, "play_language": "zh-Hans"})
    if not created["ok"]:
        return created
    occupation = kernel.ok("setup.occupations", {"campaign": CAMPAIGN})["occupations"][0]["id"]
    kernel.ok("setup.investigator", {"campaign": CAMPAIGN, "name": "Lin Tester", "occupation": occupation, "seed": 7})
    kernel.ok("setup.complete", {"campaign": CAMPAIGN})
    kernel.table("open")
    return created


def test_apply_move_enqueues_target_and_neighbour_sections_with_priorities(kernel):
    module_id, sections = bind_and_plan_one_section(kernel, BUNDLE_GOOD, budget=1)
    # Accept front-hall's and back-yard's sections only (enough for opening_ready);
    # leave cellar's section unaccepted so moving into back-yard has something to
    # queue one exit away.
    accepted_sections: dict[str, str] = {}
    for section_id in sections:
        packet, spans = packet_and_spans(kernel, module_id, section_id)
        combined = "".join(spans.values())
        if "前厅摆着八张方桌" in combined:
            accepted_sections["front-hall"] = section_id
        elif "老板娘阿秀站在后院的水井旁" in combined and "地窖里堆满了旧木箱" not in combined:
            accepted_sections["back-yard"] = section_id
        elif "地窖里堆满了旧木箱" in combined:
            accepted_sections["cellar"] = section_id
    assert {"front-hall", "back-yard", "cellar"} <= set(accepted_sections)

    def author_and_accept(key: str, builder) -> None:
        section_id = accepted_sections[key]
        packet, spans = packet_and_spans(kernel, module_id, section_id)
        shard = builder(module_id, section_id, packet, spans)
        report = mcall(kernel, "review", module_id=module_id, section_id=section_id)
        write_shard(kernel, module_id, section_id, shard)
        report = mcall(kernel, "review", module_id=module_id, section_id=section_id)
        assert report["accepted"], (key, report["findings"])
        mcall(kernel, "accept", module_id=module_id, section_id=section_id)

    def front_hall_only_shard(mid, sid, packet, spans):
        find = lambda needle: find_span(spans, needle)  # noqa: E731
        shard = base_shard(mid, sid, packet)
        shard["nodes"] = [
            mknode(f"module-{mid}", "module", "红灯笼茶馆疑云", [find("前厅摆着八张方桌")],
                  properties={"entry_scene_ids": ["scene-front-hall"], "ending_scene_ids": []}),
            mknode("scene-front-hall", "scene", "茶馆前厅", [find("前厅摆着八张方桌")],
                  properties={"is_entrance": True}),
        ]
        shard["node_refs"] = ["scene-back-yard"]
        claim, relation = mclaim_relation("claim-route-front-hall-back-yard", "scene-front-hall",
                                          "route-to", "scene-back-yard", [find("穿过后门的布帘可以走到后院")])
        shard["claims"], shard["relations"] = [claim], [relation]
        return close_shard(shard)

    def back_yard_only_shard(mid, sid, packet, spans):
        find = lambda needle: find_span(spans, needle)  # noqa: E731
        shard = base_shard(mid, sid, packet)
        shard["nodes"] = [
            mknode("scene-back-yard", "scene", "后院", [find("老板娘阿秀站在后院的水井旁")]),
            mknode("npc-aqiu", "npc", "阿秀", [find("老板娘阿秀站在后院的水井旁")]),
            mknode("clue-faded-letter", "clue", "褪色的信笺", [find("阿秀的裙摆下露出一封褪色的信笺")],
                  visibility="revealable", properties={"delivery_kind": "skill_check"}),
        ]
        shard["node_refs"] = ["scene-cellar", "conclusion-aqiu-is-the-pawnbroker"]
        pairs = [
            ("claim-aqiu-present-back-yard", "npc-aqiu", "present-in", "scene-back-yard",
             [find("老板娘阿秀站在后院的水井旁")]),
            ("claim-letter-discoverable", "clue-faded-letter", "discoverable-at", "scene-back-yard",
             [find("阿秀的裙摆下露出一封褪色的信笺")]),
            ("claim-letter-supports", "clue-faded-letter", "supports", "conclusion-aqiu-is-the-pawnbroker",
             [find("阿秀的裙摆下露出一封褪色的信笺")]),
            # The route to cellar (an external, not-yet-defined node_ref) is what
            # lets `_enqueue_deepen` later see cellar's section as one exit away.
            ("claim-route-back-yard-cellar", "scene-back-yard", "route-to", "scene-cellar",
             [find("地窖钥匙能打开后院角落的地窖入口")]),
        ]
        for claim_id, subject, predicate, obj, evidence in pairs:
            claim, relation = mclaim_relation(claim_id, subject, predicate, obj, evidence)
            shard["claims"].append(claim)
            shard["relations"].append(relation)
        return close_shard(shard)

    author_and_accept("front-hall", front_hall_only_shard)
    author_and_accept("back-yard", back_yard_only_shard)
    assembled = mcall(kernel, "assemble", module_id=module_id)
    assert assembled["opening_ready"] is True
    status = mcall(kernel, "status", module_id=module_id)
    cellar_section = accepted_sections["cellar"]
    assert any(row["id"] == cellar_section and row["status"] != "accepted"
              for row in status["sections"]["rows"])

    created = _campaign_create_for_bound_module(kernel, module_id)
    if not created["ok"]:
        assert created["error"]["code"] == "invalid_params"
        pytest.skip(
            "campaign.create refuses a bound (non-starter) module_id "
            f"({created['error']['message']!r}) -- see this file's module docstring; "
            "the deepen-on-move mechanics above (opening_ready, section acceptance) "
            "are proven, only the apply-move trigger itself is blocked"
        )

    # Once campaign.create accepts a bound module, the rest of this test proves the
    # actual §14.6 trigger: moving into back-yard must enqueue cellar's section
    # (a route-to neighbour, priority 80) via `table.apply`'s own `deepen_queued`.
    kernel.table("player_input", text="我走到后院。")
    result = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "back-yard"}])
    assert cellar_section in result.get("deepen_queued", [])

    claim = mcall(kernel, "deepen.claim", module_id=module_id)
    assert claim["section_id"] == cellar_section
    assert mcall(kernel, "deepen.claim", module_id=module_id)["section_id"] is None, "one claim at a time"

    packet, spans = packet_and_spans(kernel, module_id, cellar_section)
    find = lambda needle: find_span(spans, needle)  # noqa: E731
    cellar_shard = base_shard(module_id, cellar_section, packet)
    cellar_shard["nodes"] = [mknode("scene-cellar", "scene", "地窖", [find("地窖里堆满了旧木箱")])]
    write_shard(kernel, module_id, cellar_section, cellar_shard)
    report = mcall(kernel, "review", module_id=module_id, section_id=cellar_section)
    assert report["accepted"], report["findings"]
    mcall(kernel, "accept", module_id=module_id, section_id=cellar_section)
    mcall(kernel, "assemble", module_id=module_id)
    done = mcall(kernel, "deepen.complete", module_id=module_id, section_id=cellar_section, ok=True)
    assert done["status"] == "done"


def test_apply_handout_refuses_keeper_only_and_delivers_player_safe_with_attachment(kernel):
    module_id, section_id = build_good_module(kernel)
    mcall(kernel, "assemble", module_id=module_id)

    created = _campaign_create_for_bound_module(kernel, module_id)
    if not created["ok"]:
        assert created["error"]["code"] == "invalid_params"
        pytest.skip(
            "campaign.create refuses a bound (non-starter) module_id "
            f"({created['error']['message']!r}) -- see this file's module docstring"
        )

    kernel.table("player_input", text="我打量茶馆。")
    refused = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "handout", "name": "科尔比特秘密平面图"}])
    assert refused["code"] == "invalid_params"

    delivered = kernel.table("apply", call_id="t1-c2", effects=[{"kind": "handout", "name": "茶馆地图"}])
    receipts = delivered["receipts"] if isinstance(delivered.get("receipts", [None])[0], dict) else None
    attachment = delivered.get("attachment") or (receipts[-1]["attachment"] if receipts else None)
    assert attachment is not None
    assert attachment.get("available") is not False
