"""Measure a bound book and cut it into candidate sections (contract §14.3).

Only what the document declares about itself, and only lexically: pages and
characters, the `#` heading lines and their depth, and which pages are a table
of contents (a page whose lines reappear as headings later on — never the word
"contents" in any language). The cut is arithmetic, and it has two numbers: the
budget is a ceiling no section may cross, the target is the size a section
should aim at. A book within the target is one section; above it, the book is
cut at the shallowest heading depth that divides it into sections which are
themselves within the target, then within the budget, and only a book with no
usable heading structure is swallowed whole or sliced at page boundaries.
Classification (`kind`, `priority`) is a whole-book judgement and belongs to the
extension's agent; `plan.accept` writes it down."""

from __future__ import annotations

import re
from typing import Any

from ..errors import invalid_params
from ..text import normalize_text
from .contract import SECTION_ID_RE, SECTION_KINDS

#: The ceiling: no section may hold more characters than this.
DEFAULT_SECTION_BUDGET = 60_000
#: The target: the size a section should aim at. A book above it is cut wherever its
#: own headings allow; the budget alone never decides that a book stays whole. What the
#: number is worth is measured, not assumed: a 48-page book of 53,118 characters fits a
#: 60,000 budget whole, and read whole it failed both grounding gates, consumed 0.395 of
#: its spans and left the on-demand deepening queue with nothing to read (issue #33).
DEFAULT_SECTION_TARGET = 20_000
TOC_MIN_MATCHES = 8
TOC_MIN_RATIO = 0.4

_HEADING = re.compile(r"^(#{1,6})\s*(.+?)\s*$")
_ASCII_WORD = re.compile(r"[a-z0-9]+")


def _fold(text: str) -> str:
    return "".join(text.split()).casefold()


def outline_pages(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per page: index, chars, non-empty lines, headings with depth."""
    out: list[dict[str, Any]] = []
    for page in pages:
        text = str(page.get("text") or "")
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        headings = []
        for line in text.splitlines():
            match = _HEADING.match(line.rstrip())
            if match:
                headings.append({"depth": len(match.group(1)), "text": match.group(2)})
        out.append({"pdf_index": int(page["pdf_index"]), "chars": len(text), "lines": lines,
                    "headings": headings})
    out.sort(key=lambda row: row["pdf_index"])
    return out


def _later_headings(pages: list[dict[str, Any]]) -> list[set[str]]:
    later: list[set[str]] = []
    running: set[str] = set()
    for page in reversed(pages):
        later.append(set(running))
        for heading in page["headings"]:
            running.add(_fold(heading["text"]))
    later.reverse()
    return later


def contents_pages(pages: list[dict[str, Any]]) -> list[int]:
    found = []
    for page, later in zip(pages, _later_headings(pages)):
        lines = [_fold(line) for line in page["lines"]]
        lines = [line for line in lines if len(line) > 1]
        if not lines:
            continue
        matches = sum(1 for line in lines if line in later)
        if matches >= TOC_MIN_MATCHES and matches / len(lines) >= TOC_MIN_RATIO:
            found.append(page["pdf_index"])
    return found


def structure_pages(pages: list[dict[str, Any]], limit: int = 6) -> list[int]:
    """Pages most likely to state the book's own structure, ranked by how many distinct
    later headings they point at."""
    scored = []
    for page, later in zip(pages, _later_headings(pages)):
        lines = [_fold(line) for line in page["lines"] if len(line.strip()) > 1]
        if not lines:
            continue
        referenced = {h for h in later if len(h) > 3 and any(h in line for line in lines)}
        if len(referenced) >= 3:
            scored.append((len(referenced), page["pdf_index"]))
    scored.sort(key=lambda row: (-row[0], row[1]))
    return [index for _, index in scored[:limit]]


def cut_at_depth(pages: list[dict[str, Any]], depth: int, skip: set[int]) -> list[dict[str, Any]]:
    starts = [page["pdf_index"] for page in pages
              if page["pdf_index"] not in skip and any(h["depth"] == depth for h in page["headings"])]
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
        sections.append({"title": title, "from": members[0], "to": members[-1],
                         "chars": sum(by_index[i]["chars"] for i in members)})
    return sections


def split_by_budget(section: dict[str, Any], page_chars: dict[int, int], budget: int) -> list[dict[str, Any]]:
    """Split one over-budget page range at page boundaries, greedily."""
    lo, hi = int(section["from"]), int(section["to"])
    parts: list[tuple[int, int]] = []
    run_start, run_chars = lo, 0
    for index in range(lo, hi + 1):
        chars = page_chars.get(index, 0)
        if run_chars and run_chars + chars > budget:
            parts.append((run_start, index - 1))
            run_start, run_chars = index, 0
        run_chars += chars
    parts.append((run_start, hi))
    if len(parts) < 2:
        return [dict(section)]
    out = []
    for part_index, (part_lo, part_hi) in enumerate(parts):
        out.append({**section, "from": part_lo, "to": part_hi,
                    "chars": sum(page_chars.get(i, 0) for i in range(part_lo, part_hi + 1)),
                    "split": part_index + 1, "split_of": section.get("title") or ""})
    return out


def _ascii_slug(title: str, limit: int = 32) -> str:
    words = _ASCII_WORD.findall(normalize_text(title))
    slug = "-".join(words)
    return slug[:limit].rstrip("-")


def _section_ids(sections: list[dict[str, Any]]) -> None:
    width = max(2, len(str(len(sections))))
    seen: set[str] = set()
    for position, section in enumerate(sections, start=1):
        base = f"section-{position:0{width}d}"
        slug = _ascii_slug(str(section.get("title") or ""))
        candidate = f"{base}-{slug}" if slug else base
        while candidate in seen or not SECTION_ID_RE.fullmatch(candidate):
            candidate = base
            if candidate in seen:
                candidate = f"{base}-{position}"
        seen.add(candidate)
        section["id"] = candidate


def resolve_target(budget: int, target: int | None = None) -> int:
    """The target never exceeds the ceiling: a caller who lowers the budget below the
    default target has said the sections must be smaller than that, not larger."""
    return max(1, min(int(target if target is not None else DEFAULT_SECTION_TARGET), int(budget)))


def measure(pages: list[dict[str, Any]], *, budget: int = DEFAULT_SECTION_BUDGET,
            target: int | None = None) -> dict[str, Any]:
    outline = outline_pages(pages)
    if not outline:
        return {"status": "unmeasurable", "reason": "bundle carries no readable pages"}
    aim = resolve_target(budget, target)
    total = sum(page["chars"] for page in outline)
    skip = set(contents_pages(outline))
    attempts = []
    for depth in range(1, 7):
        cut = cut_at_depth(outline, depth, skip)
        largest = max((s["chars"] for s in cut), default=None)
        attempts.append({"depth": depth, "sections": len(cut), "largest_chars": largest,
                         "smallest_chars": min((s["chars"] for s in cut), default=None),
                         "divides": len(cut) >= 2,
                         "within_target": bool(cut) and len(cut) >= 2 and largest is not None and largest <= aim,
                         "within_budget": bool(cut) and len(cut) >= 2 and largest is not None and largest <= budget})
    return {
        "status": "measured",
        "pages": len(outline),
        "chars": total,
        "budget": budget,
        "target": aim,
        "fits_whole_book": total <= budget,
        "fits_target": total <= aim,
        "contents_pages": sorted(skip),
        "structure_pages": structure_pages(outline),
        "heading_depth_cuts": attempts,
        "page_chars": {str(page["pdf_index"]): page["chars"] for page in outline},
    }


def choose_cut(outline: list[dict[str, Any]], measured: dict[str, Any], *,
               budget: int, target: int) -> tuple[list[dict[str, Any]], str]:
    """Pick the cut and say why (contract §14.13). The budget is a ceiling, the target is
    the aim; a book above the target is cut wherever its own headings divide it, and the
    shallowest depth that works wins because it keeps sections as large as the aim allows.

    The reason travels in the basis, so `plan.json` records which rule fired and
    `measured.heading_depth_cuts` records the alternatives it beat."""
    first, last = outline[0]["pdf_index"], outline[-1]["pdf_index"]
    whole = [{"title": "", "from": first, "to": last, "chars": measured["chars"]}]
    if measured["fits_target"]:
        return whole, "whole_book_within_target"
    skip = set(measured["contents_pages"])
    cuts = [(depth, cut_at_depth(outline, depth, skip)) for depth in range(1, 7)]
    dividing = [(depth, cut) for depth, cut in cuts if len(cut) >= 2]
    for ceiling, why in ((target, "within_target"), (budget, "within_budget")):
        for depth, cut in dividing:
            if max(section["chars"] for section in cut) <= ceiling:
                return cut, f"heading_depth_{depth}_{why}"
    if dividing:
        depth, cut = dividing[0]
        return cut, f"heading_depth_{depth}_split_by_budget"
    if measured["fits_whole_book"]:
        return whole, "whole_book_no_heading_structure"
    return whole, "budget_only"


def candidates(pages: list[dict[str, Any]], *, budget: int = DEFAULT_SECTION_BUDGET,
               target: int | None = None) -> dict[str, Any]:
    """Measurements plus the machine's cut: candidate sections with `kind: null`."""
    measured = measure(pages, budget=budget, target=target)
    if measured["status"] != "measured":
        raise invalid_params("bundle carries no readable pages", details=measured)
    outline = outline_pages(pages)
    page_chars = {int(k): int(v) for k, v in measured["page_chars"].items()}
    cut, basis = choose_cut(outline, measured, budget=budget, target=measured["target"])
    sections: list[dict[str, Any]] = []
    for section in cut:
        if section["chars"] > budget:
            sections.extend(split_by_budget(section, page_chars, budget))
        else:
            sections.append(dict(section))
    _section_ids(sections)
    rows = []
    for section in sections:
        heads = []
        for page in outline:
            if section["from"] <= page["pdf_index"] <= section["to"]:
                heads.extend(f"#{h['depth']} {h['text']}" for h in page["headings"][:3])
        rows.append({
            "id": section["id"],
            "title": section.get("title") or "",
            "pages": [section["from"], section["to"]],
            "chars": section["chars"],
            "headings": heads[:12],
            "kind": None,
            "priority": None,
        })
    return {"measured": {k: v for k, v in measured.items() if k != "page_chars"},
            "basis": basis, "sections": rows}


def page_heads(pages: list[dict[str, Any]], lines: int = 2) -> list[dict[str, Any]]:
    """Per page: index, chars, the first `lines` non-empty lines — what the
    classification agent is shown instead of the book."""
    out = []
    for page in outline_pages(pages):
        out.append({"pdf_index": page["pdf_index"], "chars": page["chars"],
                    "head": page["lines"][:lines]})
    return out


def accept(candidate_rows: list[dict[str, Any]], classified: Any) -> list[dict[str, Any]]:
    """Join the agent's `{id, kind, priority}` rows onto the machine's candidates and
    return the sections table (§14.1 `sections.json`). Every candidate must be
    classified; unknown ids, kinds, or priorities are `invalid_params`."""
    if not isinstance(classified, list) or not classified:
        raise invalid_params("params.sections must be a non-empty list of {id, kind, priority}")
    by_id = {row["id"]: row for row in candidate_rows}
    problems: list[dict[str, Any]] = []
    picked: dict[str, dict[str, Any]] = {}
    for position, row in enumerate(classified):
        if not isinstance(row, dict):
            problems.append({"position": position, "code": "not_an_object"})
            continue
        section_id = row.get("id")
        if section_id not in by_id:
            problems.append({"position": position, "code": "unknown_section", "id": section_id})
            continue
        if section_id in picked:
            problems.append({"position": position, "code": "duplicate_section", "id": section_id})
            continue
        kind = row.get("kind")
        if kind not in SECTION_KINDS:
            problems.append({"position": position, "code": "unknown_kind", "id": section_id,
                             "kind": kind, "kinds": list(SECTION_KINDS)})
            continue
        priority = row.get("priority")
        if isinstance(priority, bool) or not isinstance(priority, int):
            problems.append({"position": position, "code": "priority_not_int", "id": section_id})
            continue
        picked[section_id] = {"kind": kind, "priority": priority}
    missing = [row["id"] for row in candidate_rows if row["id"] not in picked]
    if missing:
        problems.append({"code": "unclassified_sections", "ids": missing})
    if problems:
        raise invalid_params("section classification does not cover the plan",
                             fix="classify every candidate id exactly once with a known kind",
                             details={"problems": problems, "kinds": list(SECTION_KINDS)})
    table = []
    for row in candidate_rows:
        table.append({
            "id": row["id"],
            "title": row.get("title") or "",
            "pages": list(row["pages"]),
            "chars": row.get("chars"),
            "kind": picked[row["id"]]["kind"],
            "priority": picked[row["id"]]["priority"],
            "status": "planned",
            "shard": None,
            "rounds": 0,
        })
    return table
