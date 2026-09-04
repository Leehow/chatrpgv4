#!/usr/bin/env python3
"""Serve one extraction packet the way a reader wants it.

The packet is JSON because machines pass it around. A reader handed it with a
plain file tool did the obvious thing: it spent a turn converting the whole
thing into `=== span-id ===` blocks of flat text before it read a word. That
was not a preference -- nothing told it to -- it was the reader saying the
shape was wrong, and paying for the fix out of its own context.

So this serves the packet in that shape, and adds the two things the flat file
still could not do:

- `search` looks for a name across every span at once. That is what turns
  "which scenes is this cult in" from a whole second reading of the book into
  one query, and it is why a relation no longer has to live inside whichever
  chunk happened to contain both of its ends.
- `verify` answers whether a span id exists before a shard is written with it.
  Every fabricated citation on record -- 1281 of them -- extrapolated the id
  numbering past the packet's last page. Discovering that at the gate costs a
  whole generation; discovering it here costs a tool call.

Nothing here judges content. The gates remain the authority on what is
acceptable; this only decides how the evidence is handed over.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable


def _spans(packet: dict[str, Any]) -> list[dict[str, Any]]:
    view = packet.get("evidence_view")
    rows = (view or {}).get("spans") if isinstance(view, dict) else packet.get("spans")
    return [row for row in (rows or []) if isinstance(row, dict)]


def _page_of(span_id: str) -> int | None:
    if "-page-" not in span_id:
        return None
    tail = span_id.split("-page-", 1)[1].split("-", 1)[0]
    return int(tail) if tail.isdigit() else None


def _render(rows: Iterable[dict[str, Any]]) -> str:
    out: list[str] = []
    for row in rows:
        out.append(f"=== {row.get('span_id')} ===")
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", required=True, type=Path)
    sub = parser.add_subparsers(dest="command", required=True)

    outline = sub.add_parser("outline", help="pages, span counts, and sizes")

    read = sub.add_parser("read", help="span text, in id-anchored blocks")
    read.add_argument("--pages", help="e.g. 5 or 5-8 or 5,7,9-11")
    read.add_argument("--ids", help="comma-separated span ids")
    read.add_argument("--limit", type=int, default=0, help="0 = no limit")

    search = sub.add_parser("search", help="every span whose text matches")
    search.add_argument("pattern")
    search.add_argument("--regex", action="store_true")
    search.add_argument("--context", type=int, default=0,
                        help="also return N spans either side of each hit")
    search.add_argument("--limit", type=int, default=60)

    verify = sub.add_parser("verify", help="which of these span ids exist")
    verify.add_argument("--ids", help="comma-separated span ids")
    verify.add_argument("--shard", type=Path,
                        help="check every evidence_span_ids in this shard")

    args = parser.parse_args(argv)
    packet = json.loads(args.packet.read_text(encoding="utf-8"))
    rows = _spans(packet)
    by_id = {str(row.get("span_id")): row for row in rows}

    if args.command == "outline":
        pages: dict[int, list[dict[str, Any]]] = {}
        for row in rows:
            page = _page_of(str(row.get("span_id")))
            if page is not None:
                pages.setdefault(page, []).append(row)
        window = packet.get("page_window") or {}
        print(json.dumps({
            "spans": len(rows),
            "pages": len(pages),
            "page_window": window,
            "per_page": [
                {"page": page, "spans": len(items),
                 "chars": sum(len(str(r.get("text") or "")) for r in items)}
                for page, items in sorted(pages.items())
            ],
        }, ensure_ascii=False, indent=2))
        return 0

    if args.command == "read":
        wanted_pages = _parse_pages(args.pages)
        wanted_ids = {i.strip() for i in (args.ids or "").split(",") if i.strip()}
        picked = [
            row for row in rows
            if (not wanted_ids or str(row.get("span_id")) in wanted_ids)
            and (wanted_pages is None
                 or _page_of(str(row.get("span_id"))) in wanted_pages)
        ]
        if args.limit:
            picked = picked[: args.limit]
        sys.stdout.write(_render(picked))
        return 0

    if args.command == "search":
        if args.regex:
            probe = re.compile(args.pattern)
            hit = lambda text: bool(probe.search(text))  # noqa: E731
        else:
            needle = args.pattern
            hit = lambda text: needle in text  # noqa: E731
        indexes = [i for i, row in enumerate(rows)
                   if hit(str(row.get("text") or ""))]
        chosen: list[int] = []
        for index in indexes[: args.limit]:
            for offset in range(-args.context, args.context + 1):
                neighbour = index + offset
                if 0 <= neighbour < len(rows) and neighbour not in chosen:
                    chosen.append(neighbour)
        print(f"# {len(indexes)} span(s) matched"
              + (f", showing {args.limit}" if len(indexes) > args.limit else ""))
        sys.stdout.write(_render(rows[i] for i in sorted(chosen)))
        return 0

    if args.command == "verify":
        asked: list[str] = []
        if args.ids:
            asked += [i.strip() for i in args.ids.split(",") if i.strip()]
        if args.shard:
            shard = json.loads(args.shard.read_text(encoding="utf-8"))
            for collection in ("nodes", "claims", "relations"):
                for row in shard.get(collection) or []:
                    if isinstance(row, dict):
                        asked += [str(s) for s in (row.get("evidence_span_ids") or [])]
            asked += [str(s) for s in (shard.get("evidence_span_ids") or [])]
        unknown = sorted({span for span in asked if span not in by_id})
        pages = sorted({p for p in (_page_of(i) for i in by_id) if p is not None})
        print(json.dumps({
            "checked": len(set(asked)),
            "unknown": unknown,
            "unknown_count": len(unknown),
            "packet_pages": [pages[0], pages[-1]] if pages else [],
            "hint": ("every unknown id is invented: this packet holds only the "
                     "pages above, and ids are not continuous beyond them")
            if unknown else "",
        }, ensure_ascii=False, indent=2))
        return 1 if unknown else 0

    return 2


if __name__ == "__main__":
    sys.exit(main())
