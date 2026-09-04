#!/usr/bin/env python3
"""The extractor: the loop that reads a module into a graph, minus the model.

Until now this repository had every deterministic half of module extraction --
prepare the packet, attach evidence, check the contract, merge shards, project
the seven IR files -- and no extractor. The reading step was performed by
whichever agent happened to be in the conversation, by hand, and its output was
committed as a fixture. That is why the "PDF parsing pipeline" could parse a
twenty-page module in 0.27 seconds: it never read the book.

This module closes the loop without owning the model call.

Why not call a model here
-------------------------
Shelling out to a globally installed CLI would work on this machine and fail on
a packaged desktop build, where no such binary is on PATH. So this follows the
pattern the rest of the repository already uses for model work
(`_source_direct_single_dispatch`): the canonical script emits a *dispatch* --
the exact instruction and payload -- and the host runs it on whatever model the
host is already running (`model_policy: inherit_parent`). The host may be the
Keeper session, a worker agent, or a desktop app's own runtime; none of them
are named here.

The loop, from the host's side:

    prepare  -> packet + instruction        (this module)
    <host gives both to its model>
    review   -> accepted shard, or findings (this module)
    <host hands findings back to its model, verbatim>
    ... until accepted or the round budget runs out

Both gates run on every review, and neither downgrades:

    gate one   contract + evidence scope     coc_module_graph.validate_shard
    gate two   name/number source grounding  coc_module_graph_grounding
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

import coc_module_graph as graph  # noqa: E402
import coc_module_graph_grounding as grounding  # noqa: E402

INSTRUCTION_PATH = (
    _HERE.parent / "pi" / "prompts" / "module-graph-extraction.md"
)
PREPARE_CONTRACT_ID = "coc.module-graph-prepare-request.v1"
DEFAULT_ASPECTS = (
    "actors", "causal", "events", "knowledge", "mechanics", "structure", "world",
)


class ExtractError(RuntimeError):
    """A deterministic failure with findings the host can act on."""

    def __init__(self, findings: list[dict[str, Any]]):
        super().__init__("; ".join(str(f) for f in findings))
        self.findings = findings


def _manifest(source_bundle: Path) -> dict[str, Any]:
    return json.loads((source_bundle / "manifest.json").read_text("utf-8"))


def _page_count(source_bundle: Path) -> int:
    """The source's own page count, which is what page indexes count against.

    Manifest rows are not the bound: the producer may omit blank or failed
    pages, so len(pages) would silently truncate every trailing section.
    """
    return int(_manifest(source_bundle)["source"]["page_count"])


def _source_id(source_bundle: Path) -> str:
    return str((_manifest(source_bundle).get("source") or {}).get("source_id") or "")


def _bound_page_indices(source_bundle: Path) -> list[int]:
    """pdf_index values the bundle actually carries, sorted.

    The bundle contract requires in-bounds, duplicate-free rows but not
    contiguous ones; page_refs must name only pages the catalog can bind.
    """
    pages = _manifest(source_bundle).get("pages") or []
    return sorted(
        page["pdf_index"]
        for page in pages
        if isinstance(page, dict)
        and isinstance(page.get("pdf_index"), int)
        and not isinstance(page.get("pdf_index"), bool)
    )


def build_request(
    source_bundle: Path,
    *,
    module_id: str,
    section_id: str,
    source_language: str,
    max_nodes: int,
    max_relations: int,
    pdf_index_start: int | None = None,
    pdf_index_end: int | None = None,
    pdf_indices: list[int] | None = None,
    aspects: tuple[str, ...] = DEFAULT_ASPECTS,
) -> dict[str, Any]:
    """One prepare request covering the bundle, a page range, or a page set.

    The page set form exists for the skeleton pass: its pages are structure
    pages and section openers, which are nowhere near contiguous.
    """
    source_id = _source_id(source_bundle)
    bound_all = _bound_page_indices(source_bundle)
    if pdf_indices is not None:
        wanted = set(pdf_indices)
        bound = [index for index in bound_all if index in wanted]
    else:
        page_count = _page_count(source_bundle)
        first = 0 if pdf_index_start is None else pdf_index_start
        last = (
            page_count - 1 if pdf_index_end is None
            else min(pdf_index_end, page_count - 1)
        )
        bound = [index for index in bound_all if first <= index <= last]
    return {
        "contract_id": PREPARE_CONTRACT_ID,
        "schema_version": 1,
        "module_id": module_id,
        "section_id": section_id,
        "section_role": section_id,
        "source_language": source_language,
        "aspects": list(aspects),
        "default_visibility": "keeper-only",
        "approved_player_safe_span_ids": [],
        "known_nodes": [],
        "output_budget": {"max_nodes": max_nodes, "max_relations": max_relations},
        "page_refs": [
            {"source_id": source_id, "pdf_index": index}
            for index in bound
        ],
        "selected_evidence_span_ids": None,
    }


def prepare(
    source_bundle: Path,
    work_dir: Path,
    *,
    module_id: str,
    section_id: str = "whole-book",
    source_language: str = "zh-Hans",
    max_nodes: int = 120,
    max_relations: int = 200,
    pdf_index_start: int | None = None,
    pdf_index_end: int | None = None,
    pdf_indices: list[int] | None = None,
    aspects: tuple[str, ...] = DEFAULT_ASPECTS,
) -> dict[str, Any]:
    """Write the packet pair and return the dispatch the host should run."""
    work_dir.mkdir(parents=True, exist_ok=True)
    request = build_request(
        source_bundle,
        module_id=module_id,
        section_id=section_id,
        source_language=source_language,
        max_nodes=max_nodes,
        max_relations=max_relations,
        pdf_index_start=pdf_index_start,
        pdf_index_end=pdf_index_end,
        pdf_indices=pdf_indices,
        aspects=aspects,
    )
    (work_dir / "request.json").write_text(
        json.dumps(request, ensure_ascii=False), encoding="utf-8"
    )
    if not request["page_refs"]:
        # A range that spans only declared holes has nothing to read. This is
        # neither acceptance nor failure; the driver records it and moves on.
        return {
            "status": "empty",
            "module_id": module_id,
            "section_id": section_id,
            "span_count": 0,
            "work_dir": str(work_dir),
            "reason": "this page range carries only declared bundle holes",
        }
    catalog = graph.load_page_catalog([str(source_bundle)])
    prepared = graph.prepare_from_request(catalog, request)
    extraction = prepared["extraction_packet"]
    evidence = prepared["evidence_packet"]
    (work_dir / "extraction-packet.json").write_text(
        json.dumps(extraction, ensure_ascii=False), encoding="utf-8"
    )
    (work_dir / "evidence-packet.json").write_text(
        json.dumps(evidence, ensure_ascii=False), encoding="utf-8"
    )
    return {
        "status": "prepared",
        "module_id": module_id,
        "section_id": section_id,
        "span_count": len(evidence.get("spans") or []),
        "work_dir": str(work_dir),
        "dispatch": {
            "kind": "module_graph_extraction",
            # No binary, no provider, no key: the host reads this with whatever
            # model it is already running, which is what makes the pipeline
            # survive being packaged and shipped.
            "model_policy": "inherit_parent",
            "instruction_path": str(INSTRUCTION_PATH),
            "instruction": INSTRUCTION_PATH.read_text("utf-8"),
            "payload_path": str(work_dir / "extraction-packet.json"),
            "response_contract": "one GraphShard JSON object, no prose",
            # Declarative on purpose: naming an argv would tell the host to
            # spawn a subprocess, which is the same portability trap as naming
            # a model binary. The host calls the review entry point it already
            # has linked in, with these arguments.
            "review_operation": {
                "entry_point": "coc_module_graph_extract.review",
                "arguments": {
                    "work_dir": str(work_dir),
                    "model_output": "<the model's reply, parsed as JSON>",
                },
                "on_findings": (
                    "hand findings back to the model verbatim and extract again"
                ),
            },
        },
    }


def review(
    work_dir: Path,
    model_output: Any,
    *,
    source_bundle: Path | None = None,
) -> dict[str, Any]:
    """Run both gates over one model reply. Neither gate downgrades."""
    evidence = json.loads(
        (work_dir / "evidence-packet.json").read_text("utf-8")
    )
    catalog = {
        str(span["span_id"]): span
        for span in (evidence.get("spans") or [])
        if isinstance(span, dict) and span.get("span_id")
    }

    if not isinstance(model_output, dict):
        return {
            "status": "findings",
            "gate": "shape",
            "findings": [{
                "code": "model_output_not_an_object",
                "path": "/",
                "message": "the reply must be one GraphShard JSON object",
            }],
        }

    # Gate one: the contract, and that every cited span exists.
    # The packet's declared default is what the machine fills claims with. A
    # review re-run over an archived work dir may not have the packet any more;
    # the contract default stands in, which is what the packet would have said.
    packet_path = work_dir / "extraction-packet.json"
    default_visibility = "keeper-only"
    if packet_path.exists():
        packet = json.loads(packet_path.read_text("utf-8"))
        default_visibility = str(packet.get("default_visibility") or default_visibility)
    assembled = graph.assemble_model_shard(
        model_output, default_visibility=default_visibility
    )
    structure = graph.validate_shard(assembled, evidence_catalog=catalog)
    if structure:
        return {
            "status": "findings",
            "gate": "structure",
            "finding_count": len(structure),
            "findings": structure,
        }

    # Gate two: is the content on the pages it cites?
    text_catalog = grounding.build_catalog(evidence)
    grounded = grounding.check_grounding(assembled, text_catalog)
    if grounded:
        return {
            "status": "findings",
            "gate": "grounding",
            "finding_count": len(grounded),
            "findings": grounded,
        }

    # Gate three: was the section read at all? Three nodes for a hundred
    # thousand characters pass both gates above, because those three nodes are
    # genuinely grounded. This one counts spans nobody cited.
    unread = grounding.check_coverage(assembled, text_catalog)
    if unread:
        return {
            "status": "findings",
            "gate": "coverage",
            "finding_count": len(unread),
            "findings": unread,
        }

    (work_dir / "accepted.shard.json").write_text(
        json.dumps(assembled, ensure_ascii=False), encoding="utf-8"
    )
    nodes = assembled.get("nodes") or []
    kinds: dict[str, int] = {}
    for node in nodes:
        if isinstance(node, dict):
            kind = str(node.get("node_kind") or "")
            kinds[kind] = kinds.get(kind, 0) + 1
    return {
        "status": "accepted",
        "shard_path": str(work_dir / "accepted.shard.json"),
        "nodes": len(nodes),
        "claims": len(assembled.get("claims") or []),
        "relations": len(assembled.get("relations") or []),
        "node_kinds": dict(sorted(kinds.items())),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("prepare", help="packet + host dispatch for one bundle")
    p.add_argument("--source-bundle", required=True)
    p.add_argument("--work-dir", required=True)
    p.add_argument("--module-id", required=True)
    p.add_argument("--section-id", default="whole-book")
    p.add_argument("--source-language", default="zh-Hans")
    p.add_argument("--max-nodes", type=int, default=120)
    p.add_argument("--max-relations", type=int, default=200)

    r = sub.add_parser("review", help="run both gates over one model reply")
    r.add_argument("--work-dir", required=True)
    r.add_argument("--model-output", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "prepare":
        try:
            result = prepare(
                Path(args.source_bundle),
                Path(args.work_dir),
                module_id=args.module_id,
                section_id=args.section_id,
                source_language=args.source_language,
                max_nodes=args.max_nodes,
                max_relations=args.max_relations,
            )
        except graph.ModuleGraphError as error:
            # The contract caps one packet at 200 nodes / 400 relations, which
            # is how it says "a book this size is extracted section by
            # section". Raising the traceback instead of the findings hid that
            # sentence behind a stack trace on the first long module tried.
            print(json.dumps({
                "status": "findings",
                "gate": "prepare",
                "finding_count": len(error.findings),
                "findings": error.findings,
            }, ensure_ascii=False, indent=2))
            return 1
        # The instruction is long and the host already has the path; keep the
        # printed receipt small enough to read.
        printed = json.loads(json.dumps(result))
        printed["dispatch"].pop("instruction", None)
        print(json.dumps(printed, ensure_ascii=False, indent=2))
        return 0

    raw = Path(args.model_output).read_text("utf-8")
    try:
        output = json.loads(raw)
    except json.JSONDecodeError as error:
        print(json.dumps({
            "status": "findings",
            "gate": "shape",
            "findings": [{
                "code": "model_output_not_json",
                "path": "/",
                "message": f"reply did not parse as JSON: {error}",
            }],
        }, ensure_ascii=False, indent=2))
        return 1
    result = review(Path(args.work_dir), output)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "accepted" else 1


if __name__ == "__main__":
    sys.exit(main())
