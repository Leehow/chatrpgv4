"""The reader's evidence tool over one packet (contract §14.5; `bin/coc-evidence`).

    coc-evidence [--packet packet.json] search <text> [--regex] [--context N] [--limit N]
    coc-evidence [--packet packet.json] verify <span-id>[,<span-id>...] [--shard shard.json]
    coc-evidence [--packet packet.json] page <pdf_index>
    coc-evidence [--packet packet.json] outline
    coc-evidence [--packet packet.json] read --pages 5-8 | --ids a,b
    coc-evidence [--packet packet.json] coverage --shard shard.json

Serves the packet in id-anchored blocks so the reader never rewrites JSON for
itself; `search` finds every span mentioning a name at once; `verify` answers
whether a span id exists before a shard is written with it. Nothing here judges
content."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable

from .contract import SUBSTANTIVE_SPAN_CHARS


def _spans(packet: dict[str, Any]) -> list[dict[str, Any]]:
    return [row for row in (packet.get("spans") or []) if isinstance(row, dict)]


def _render(rows: Iterable[dict[str, Any]]) -> str:
    out: list[str] = []
    for row in rows:
        out.append(f"=== {row.get('span_id')} (page {row.get('page')}) ===")
        out.append(str(row.get("text") or ""))
        out.append("")
    return "\n".join(out)


def _parse_pages(value: str | None) -> set[int] | None:
    if not value:
        return None
    wanted: set[int] = set()
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part[1:]:
            first, last = part.split("-", 1)
            wanted.update(range(int(first), int(last) + 1))
        else:
            wanted.add(int(part))
    return wanted


def _shard_span_ids(shard_path: Path) -> list[str]:
    shard = json.loads(shard_path.read_text(encoding="utf-8"))
    asked: list[str] = []
    for collection in ("nodes", "claims", "relations"):
        for row in shard.get(collection) or []:
            if isinstance(row, dict):
                asked += [str(s) for s in (row.get("evidence_span_ids") or [])]
    asked += [str(s) for s in (shard.get("evidence_span_ids") or [])]
    return asked


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="coc-evidence", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--packet", type=Path, default=Path("packet.json"))
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("outline", help="pages, span counts and sizes")
    read = sub.add_parser("read", help="span text in id-anchored blocks")
    read.add_argument("--pages", help="e.g. 5 or 5-8 or 5,7,9-11")
    read.add_argument("--ids", help="comma-separated span ids")
    read.add_argument("--limit", type=int, default=0)
    page = sub.add_parser("page", help="one whole page")
    page.add_argument("pdf_index", type=int)
    search = sub.add_parser("search", help="every span whose text contains the pattern")
    search.add_argument("pattern")
    search.add_argument("--regex", action="store_true")
    search.add_argument("--context", type=int, default=0)
    search.add_argument("--limit", type=int, default=60)
    verify = sub.add_parser("verify", help="which of these span ids exist in this packet")
    verify.add_argument("ids", nargs="?", help="comma-separated span ids")
    verify.add_argument("--shard", type=Path, help="check every evidence_span_ids in this shard")
    coverage = sub.add_parser("coverage", help="which spans a shard left uncited, longest first")
    coverage.add_argument("--shard", required=True, type=Path)
    coverage.add_argument("--show", type=int, default=12)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.packet.exists():
        print(json.dumps({"error": f"no packet at {args.packet}", "hint": "pass --packet <work_dir>/packet.json"},
                         ensure_ascii=False))
        return 2
    packet = json.loads(args.packet.read_text(encoding="utf-8"))
    rows = _spans(packet)
    by_id = {str(row.get("span_id")): row for row in rows}
    window = packet.get("page_window") or {}

    if args.command == "outline":
        pages: dict[int, list[dict[str, Any]]] = {}
        for row in rows:
            pages.setdefault(int(row.get("page", -1)), []).append(row)
        print(json.dumps({
            "section_id": packet.get("section_id"), "spans": len(rows), "pages": len(pages),
            "page_window": window,
            "per_page": [{"page": p, "spans": len(items), "chars": sum(len(str(r.get("text") or "")) for r in items)}
                         for p, items in sorted(pages.items())],
        }, ensure_ascii=False, indent=2))
        return 0

    if args.command == "read":
        wanted_pages = _parse_pages(args.pages)
        wanted_ids = {i.strip() for i in (args.ids or "").split(",") if i.strip()}
        picked = [row for row in rows
                  if (not wanted_ids or str(row.get("span_id")) in wanted_ids)
                  and (wanted_pages is None or int(row.get("page", -1)) in wanted_pages)]
        if args.limit:
            picked = picked[:args.limit]
        sys.stdout.write(_render(picked))
        return 0

    if args.command == "page":
        picked = [row for row in rows if int(row.get("page", -1)) == args.pdf_index]
        if not picked:
            print(json.dumps({"page": args.pdf_index, "spans": 0, "page_window": window,
                              "hint": "this page is not in the packet; the section covers "
                                      f"{window.get('first_page')}-{window.get('last_page')}"},
                             ensure_ascii=False))
            return 1
        sys.stdout.write(_render(picked))
        return 0

    if args.command == "search":
        if args.regex:
            probe = re.compile(args.pattern)
            hit = lambda text: bool(probe.search(text))  # noqa: E731
        else:
            needle = args.pattern
            hit = lambda text: needle in text  # noqa: E731
        indexes = [i for i, row in enumerate(rows) if hit(str(row.get("text") or ""))]
        chosen: list[int] = []
        for index in indexes[:args.limit]:
            for offset in range(-args.context, args.context + 1):
                neighbour = index + offset
                if 0 <= neighbour < len(rows) and neighbour not in chosen:
                    chosen.append(neighbour)
        print(f"# {len(indexes)} span(s) matched" + (f", showing {args.limit}" if len(indexes) > args.limit else ""))
        sys.stdout.write(_render(rows[i] for i in sorted(chosen)))
        return 0

    if args.command == "verify":
        asked: list[str] = []
        if args.ids:
            asked += [i.strip() for i in args.ids.split(",") if i.strip()]
        if args.shard:
            asked += _shard_span_ids(args.shard)
        unknown = sorted({span for span in asked if span not in by_id})
        print(json.dumps({
            "checked": len(set(asked)), "unknown": unknown, "unknown_count": len(unknown),
            "packet_pages": [window.get("first_page"), window.get("last_page")],
            "hint": ("every unknown id is invented: this packet holds only the pages above, and "
                     "span-p<page>-<n> does not continue past them") if unknown else "",
        }, ensure_ascii=False, indent=2))
        return 1 if unknown else 0

    if args.command == "coverage":
        cited = set(_shard_span_ids(args.shard))
        uncited = [row for row in rows if str(row.get("span_id")) not in cited]
        substantive = sorted((row for row in uncited if len(str(row.get("text") or "")) >= SUBSTANTIVE_SPAN_CHARS),
                             key=lambda row: -len(str(row.get("text") or "")))
        per_page: dict[int, dict[str, int]] = {}
        for row in uncited:
            bucket = per_page.setdefault(int(row.get("page", -1)), {"uncited": 0, "substantive": 0})
            bucket["uncited"] += 1
            if len(str(row.get("text") or "")) >= SUBSTANTIVE_SPAN_CHARS:
                bucket["substantive"] += 1
        print(json.dumps({
            "spans": len(rows), "cited": len(rows) - len(uncited), "uncited": len(uncited),
            "substantive_uncited": len(substantive),
            "by_page": [{"page": p, **c} for p, c in sorted(per_page.items(), key=lambda kv: (-kv[1]["substantive"], kv[0]))],
            "note": "Uncited is not missed: a page number carries nothing to extract. Look at the substantive "
                    "ones below and either extract them or say in coverage why they hold nothing the graph needs.",
        }, ensure_ascii=False, indent=2))
        if substantive:
            print()
            sys.stdout.write(_render(substantive[:args.show]))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
