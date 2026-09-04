#!/usr/bin/env python3
"""Decide how to cut one module for extraction, from the module itself.

A twenty-page scenario and a six-hundred-page campaign do not want the same
treatment, and the difference is not a matter of taste:

    they-did-not-think-it-too-many    20 pages      33,280 chars
    cursed-be-the-city                18 pages      52,044 chars
    blood-highway                    111 pages     171,791 chars
    masks-of-nyarlathotep            654 pages   2,166,912 chars

The first two extract whole-book in one packet. The third cannot -- the shard
contract caps one packet at 200 nodes and 400 relations, which is the contract
saying "a book this size is read section by section". The fourth cannot even be
cut by chapter: every one of its seven chapters is larger than blood-highway
entire, and its England chapter alone projects a 478 KB packet.

So the strategy is a measurement, not a preference, and this module produces it
rather than leaving each operator to rediscover it by hand.

What it is allowed to use
-------------------------
Only what the document declares about itself, and only lexically:

  * how many pages and characters there are, per page and in total;
  * the heading lines the pages carry, and their `#` depth;
  * whether a page is a table of contents, decided structurally -- a page whose
    lines reappear as headings later in the book -- never by looking for the
    word "contents" in any language.

It never classifies prose, and it never decides. "Where does this book's
structure actually live?" is a reading question, and the first cut of this
module pretended otherwise -- a heuristic that scored heading depths and picked
one. It chose 93 sections for blood-highway where seven were right, and 627 for
Masks, whose text layer marks 1,522 lines as depth-1. Masks states its own
structure in one paragraph on page 11 ("The campaign is divided into seven core
chapters") followed by the chapter list; the heuristic matched none of it,
because that page is a structural summary rather than a page-number index. The
next book would defeat a fixed rule the same way, in a new direction.

So this module measures and validates, and the decision between the two is a
model's, on the same terms as extraction itself:

    measure   deterministic  sizes, heading-depth cuts and their consequences,
                             and the handful of pages that state the book's
                             own structure
    decide    a model        reads the measurements and those few pages -- not
                             the book -- and returns a section plan
    check     deterministic  every page covered exactly once, no overlaps, no
                             section over budget, ids well formed

That is the shape the extractor already uses, and it is the reason a module
nobody has seen yet needs no new code here.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# The largest raw section this repository has actually carried through both
# extraction gates is blood-highway's appendices at 76,010 characters, whose
# packet came to 165 KB. Nothing larger has been proven end to end, so the
# default refuses to promise one. Raise it deliberately, with evidence.
DEFAULT_SECTION_BUDGET = 80_000

# A page is a table of contents when its own lines turn up as headings further
# on. Two thresholds, both structural: how many of its lines must match, and
# how many matches are needed at all.
TOC_MIN_MATCHES = 8
TOC_MIN_RATIO = 0.4

_HEADING = re.compile(r"^(#{1,6})\s*(.+?)\s*$")


def _normalize(text: str) -> str:
    return "".join(text.split()).casefold()


def load_pages(bundle: Path) -> list[dict[str, Any]]:
    manifest = json.loads((bundle / "manifest.json").read_text(encoding="utf-8"))
    pages: list[dict[str, Any]] = []
    for row in manifest.get("pages") or []:
        path = bundle / str(row.get("markdown_path") or "")
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        headings = []
        for line in text.splitlines():
            match = _HEADING.match(line.rstrip())
            if match:
                headings.append({"depth": len(match.group(1)), "text": match.group(2)})
        pages.append({
            "pdf_index": int(row.get("pdf_index", len(pages))),
            "chars": len(text),
            "lines": [line.strip() for line in text.splitlines() if line.strip()],
            "headings": headings,
        })
    pages.sort(key=lambda page: page["pdf_index"])
    return pages


def contents_pages(pages: list[dict[str, Any]]) -> list[int]:
    """Pages whose lines reappear as headings later on.

    Structural on purpose. Looking for the word "contents" would work on one
    language and one typesetter, and a module's own contents page is exactly
    the thing that misleads a heading scan -- every chapter name in the book
    appears on it, so a naive scan reports every chapter as starting there.
    """
    later_headings: list[set[str]] = []
    running: set[str] = set()
    for page in reversed(pages):
        later_headings.append(set(running))
        for heading in page["headings"]:
            running.add(_normalize(heading["text"]))
    later_headings.reverse()

    found = []
    for page, later in zip(pages, later_headings):
        lines = [_normalize(line) for line in page["lines"]]
        lines = [line for line in lines if len(line) > 1]
        if not lines:
            continue
        matches = sum(1 for line in lines if line in later)
        if matches >= TOC_MIN_MATCHES and matches / len(lines) >= TOC_MIN_RATIO:
            found.append(page["pdf_index"])
    return found


def cut_at_depth(
    pages: list[dict[str, Any]], depth: int, skip: set[int],
) -> list[dict[str, Any]]:
    """Sections that start at each heading of exactly this depth."""
    starts = [
        page["pdf_index"]
        for page in pages
        if page["pdf_index"] not in skip
        and any(h["depth"] == depth for h in page["headings"])
    ]
    if not starts:
        return []
    first = pages[0]["pdf_index"]
    if starts[0] != first:
        starts.insert(0, first)
    by_index = {page["pdf_index"]: page for page in pages}
    ordered = [page["pdf_index"] for page in pages]
    sections = []
    for position, start in enumerate(starts):
        end = starts[position + 1] - 1 if position + 1 < len(starts) else ordered[-1]
        members = [i for i in ordered if start <= i <= end]
        if not members:
            continue
        title = ""
        for heading in by_index[start]["headings"]:
            if heading["depth"] == depth:
                title = heading["text"]
                break
        sections.append({
            "title": title,
            "pdf_index_start": members[0],
            "pdf_index_end": members[-1],
            "pages": len(members),
            "chars": sum(by_index[i]["chars"] for i in members),
        })
    return sections


def structure_pages(pages: list[dict[str, Any]], limit: int = 6) -> list[int]:
    """The few pages most likely to state the book's own structure.

    Ranked, not classified: a page scores by how many of its lines reappear as
    headings later in the book. A page-number index scores highest, but a
    prose summary of the chapters scores too, and both are worth a model's
    eyes. Nothing here decides what the structure IS -- only which pages are
    worth reading to find out, so the deciding step reads six pages instead of
    six hundred.
    """
    later_headings: list[set[str]] = []
    running: set[str] = set()
    for page in reversed(pages):
        later_headings.append(set(running))
        for heading in page["headings"]:
            running.add(_normalize(heading["text"]))
    later_headings.reverse()

    scored = []
    for page, later in zip(pages, later_headings):
        lines = [_normalize(line) for line in page["lines"] if len(line.strip()) > 1]
        if not lines:
            continue
        # How many DISTINCT later headings does this page point at? A contents
        # page or a chapter summary points at many; an ordinary page repeats
        # one. Counting matched lines instead made the score depend on how a
        # page is typeset, and a length guard on the heading dropped Masks's
        # own structure page entirely -- its chapter names are "Peru", "Egypt",
        # "Kenya", "China", every one of them under seven characters.
        referenced = {
            heading for heading in later
            if len(heading) > 3 and any(heading in line for line in lines)
        }
        if len(referenced) >= 3:
            scored.append((len(referenced), page["pdf_index"]))
    scored.sort(key=lambda row: (-row[0], row[1]))
    return [index for _, index in scored[:limit]]


def measure(bundle: Path, *, budget: int = DEFAULT_SECTION_BUDGET) -> dict[str, Any]:
    """Everything deterministic that a planning decision needs."""
    pages = load_pages(bundle)
    if not pages:
        return {"status": "unmeasurable", "reason": "bundle carries no readable pages"}
    total_chars = sum(page["chars"] for page in pages)
    candidates = structure_pages(pages)

    attempts = []
    for depth in range(1, 7):
        sections = cut_at_depth(pages, depth, set())
        attempts.append({
            "depth": depth,
            "sections": len(sections),
            "largest_chars": max((s["chars"] for s in sections), default=None),
            "median_chars": (
                sorted(s["chars"] for s in sections)[len(sections) // 2]
                if sections else None
            ),
        })

    return {
        "status": "measured",
        "module_pages": len(pages),
        "module_chars": total_chars,
        "section_budget_chars": budget,
        "fits_whole_book": total_chars <= budget,
        "pdf_index_first": pages[0]["pdf_index"],
        "pdf_index_last": pages[-1]["pdf_index"],
        "heading_depth_cuts": attempts,
        "structure_page_candidates": candidates,
        "page_chars": {
            str(page["pdf_index"]): page["chars"] for page in pages
        },
    }


def check(measured: dict[str, Any], proposed: Any) -> list[dict[str, Any]]:
    """Findings on one proposed plan. Silence means the plan is executable."""
    findings: list[dict[str, Any]] = []

    def finding(code: str, message: str, **extra: Any) -> None:
        findings.append({"code": code, "message": message, **extra})

    sections = proposed.get("sections") if isinstance(proposed, dict) else None
    if not isinstance(sections, list) or not sections:
        finding("no_sections", "a plan must carry a non-empty sections list")
        return findings

    budget = int(measured.get("section_budget_chars") or DEFAULT_SECTION_BUDGET)
    page_chars = {int(k): int(v) for k, v in (measured.get("page_chars") or {}).items()}
    first = int(measured.get("pdf_index_first", 0))
    last = int(measured.get("pdf_index_last", 0))

    seen: dict[int, str] = {}
    ids: set[str] = set()
    for position, section in enumerate(sections):
        path = f"/sections/{position}"
        if not isinstance(section, dict):
            finding("invalid_section", "each section must be an object", path=path)
            continue
        sid = str(section.get("section_id") or "").strip()
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", sid):
            finding("invalid_section_id", "kebab-case, 1-64 chars", path=path,
                    section_id=sid)
        elif sid in ids:
            finding("duplicate_section_id", "section ids must be unique",
                    path=path, section_id=sid)
        else:
            ids.add(sid)
        try:
            lo = int(section["pdf_index_start"])
            hi = int(section["pdf_index_end"])
        except Exception:
            finding("invalid_page_range",
                    "pdf_index_start and pdf_index_end must be integers", path=path)
            continue
        if lo > hi:
            finding("inverted_page_range", f"{lo} > {hi}", path=path)
            continue
        chars = sum(page_chars.get(i, 0) for i in range(lo, hi + 1))
        if chars > budget:
            finding("section_over_budget",
                    f"section carries {chars} characters against a {budget} budget",
                    path=path, section_id=sid, chars=chars)
        for i in range(lo, hi + 1):
            if i not in page_chars:
                continue
            if i in seen:
                finding("page_claimed_twice",
                        f"page {i} is in both {seen[i]!r} and {sid!r}",
                        path=path, pdf_index=i)
            seen[i] = sid

    missing = sorted(i for i in page_chars if i not in seen)
    if missing:
        # A page nobody reads is a page whose scenes, NPCs and clues are simply
        # absent from the graph, and nothing downstream can tell that apart
        # from a book that did not contain them.
        finding("pages_not_covered",
                f"{len(missing)} pages belong to no section",
                pdf_indices=missing[:20],
                first=first, last=last)
    return findings


def dispatch(bundle: Path, *, budget: int = DEFAULT_SECTION_BUDGET) -> dict[str, Any]:
    """Measurements plus the instruction a host runs on its own model."""
    measured = measure(bundle, budget=budget)
    if measured["status"] != "measured":
        return measured
    pages = load_pages(bundle)
    by_index = {page["pdf_index"]: page for page in pages}
    excerpts = {
        str(index): "\n".join(by_index[index]["lines"][:60])
        for index in measured["structure_page_candidates"]
        if index in by_index
    }
    return {
        "status": "dispatch",
        "measured": measured,
        "structure_page_text": excerpts,
        "dispatch": {
            "kind": "module_extraction_plan",
            # Same terms as extraction: no binary, no provider, no key. The
            # host reads this with the model it is already running.
            "model_policy": "inherit_parent",
            "instruction_path": str(INSTRUCTION_PATH),
            "response_contract": (
                "one JSON object {\"sections\": [{\"section_id\", \"title\", "
                "\"pdf_index_start\", \"pdf_index_end\", \"reason\"}]} covering "
                "every page exactly once, no section over the budget"
            ),
            "check_operation": {
                "entry_point": "coc_module_plan.check",
                "arguments": {"measured": "<the measured block above>",
                              "proposed": "<the model's reply, parsed as JSON>"},
                "on_findings": "hand findings back to the model verbatim and plan again",
            },
        },
    }


INSTRUCTION_PATH = (
    Path(__file__).resolve().parent.parent / "pi" / "prompts" / "module-plan.md"
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    m = sub.add_parser("measure", help="deterministic measurements only")
    m.add_argument("--source-bundle", required=True)
    m.add_argument("--budget", type=int, default=DEFAULT_SECTION_BUDGET)

    d = sub.add_parser("dispatch", help="measurements plus the host instruction")
    d.add_argument("--source-bundle", required=True)
    d.add_argument("--budget", type=int, default=DEFAULT_SECTION_BUDGET)
    d.add_argument("--output")

    c = sub.add_parser("check", help="validate one proposed plan")
    c.add_argument("--measured", required=True)
    c.add_argument("--plan", required=True)

    args = parser.parse_args(argv)
    if args.command == "check":
        measured = json.loads(Path(args.measured).read_text(encoding="utf-8"))
        proposed = json.loads(Path(args.plan).read_text(encoding="utf-8"))
        findings = check(measured, proposed)
        print(json.dumps({
            "status": "accepted" if not findings else "findings",
            "finding_count": len(findings),
            "findings": findings,
        }, ensure_ascii=False, indent=2))
        return 0 if not findings else 1

    result = (
        measure(Path(args.source_bundle), budget=args.budget)
        if args.command == "measure"
        else dispatch(Path(args.source_bundle), budget=args.budget)
    )
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if getattr(args, "output", None):
        Path(args.output).write_text(text, encoding="utf-8")
        printable = {k: v for k, v in result.items()
                     if k not in {"structure_page_text", "measured"}}
        printable["measured_summary"] = {
            k: v for k, v in (result.get("measured") or result).items()
            if k != "page_chars"
        }
        print(json.dumps(printable, ensure_ascii=False, indent=2))
    else:
        printable = dict(result)
        printable.pop("page_chars", None)
        if "measured" in printable:
            printable["measured"] = {
                k: v for k, v in printable["measured"].items() if k != "page_chars"
            }
        print(json.dumps(printable, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
