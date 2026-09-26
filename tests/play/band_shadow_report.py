#!/usr/bin/env python3
"""tests/play/band_shadow_report.py -- the band-shadow report (contract §138.8, BR-04 of docs/specs/band-then-roll.md).

After a model-origin `apply time {minutes}` or `apply damage {dice}` lands, the kernel extension asks Jev the band
question for that effect in the background and writes one `lane: "band-shadow"` row beside the Keeper's number. This
script reads those rows from one or several campaigns' `telemetry.jsonl` and reports, per kind (and so per band table:
`time` -> `time-costs`, `damage` -> `hazards`):

- `rows`: every band-shadow row of the kind;
- `unasked`: rows whose question was never asked, by `skipped` (a deliberate skip, `ok: true`: `unconfigured` without a
  Jev key, `no_declaration` without player text) or `reason` (a failure, `ok: false`: `rows_unavailable`, the kernel
  could not list the rows; `lane_crashed`) -- they carry no `jev_calls`;
- `failed`: rows asked whose answer never came (a timeout, a service or schema error), by reason;
- `answered`: rows with a distribution; `banded`: answered rows whose argmax is a row, not the `unknown` exit;
- `hit_rate`: of the banded rows, the share whose Keeper number fell inside the band (`inside`);
- `gates`: for each candidate gate (0.5, 0.6, 0.7, 0.8), how many banded rows are at or above it, that count as a
  share of the answered rows (`rate`: how often the clerk would have bound the band), and the hit rate among them;
- `jev_seconds`: mean and total Jev time over the rows that spent a Jev call (a failed call costs time too);
- `bands`: how often each row was the argmax.

This is the evidence the owner rules on (the spec's Further Notes) and the calibration of BR-06's gates. It counts; it
does not judge a band right or wrong beyond `inside`, which the lane recorded.

Usage:
    uv run --frozen python tests/play/band_shadow_report.py --campaign <id> [--campaign <id> ...] [--workspace .coc] [--json]
    uv run --frozen python tests/play/band_shadow_report.py --all [--workspace .coc] [--json]
    uv run --frozen python tests/play/band_shadow_report.py <telemetry.jsonl> [<telemetry.jsonl> ...] [--json]

`--workspace` is the directory that directly holds `campaigns/<id>/telemetry.jsonl`, as in `kpi.py`. Only the
standard library is used; output is deterministic for the same input files.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

LANE = "band-shadow"
GATES = (0.5, 0.6, 0.7, 0.8)
KINDS = ("time", "damage")
DEFAULT_WORKSPACE = ".coc"


def telemetry_path(workspace: str, campaign: str) -> Path:
    return Path(workspace) / "campaigns" / campaign / "telemetry.jsonl"


def load_rows(paths: Iterable[Path]) -> list[dict[str, Any]]:
    """The band-shadow rows of every file, in file order and then line order."""
    rows: list[dict[str, Any]] = []
    for path in paths:
        if not path.exists():
            raise FileNotFoundError(f"no telemetry.jsonl at {path}")
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                row = json.loads(line)
                if isinstance(row, dict) and row.get("lane") == LANE:
                    rows.append(row)
    return rows


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole, 3) if whole else None


def _confidence(row: dict[str, Any]) -> float:
    value = row.get("confidence")
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.0


def summarize_kind(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """One kind's numbers from its band-shadow rows."""
    unasked = [row for row in rows if "jev_calls" not in row]
    asked = [row for row in rows if "jev_calls" in row]
    answered = [row for row in asked if isinstance(row.get("distribution"), dict)]
    failed = [row for row in asked if not isinstance(row.get("distribution"), dict)]
    banded = [row for row in answered if row.get("band") is not None]
    hits = [row for row in banded if row.get("inside") is True]
    gates: dict[str, Any] = {}
    for gate in GATES:
        above = [row for row in banded if _confidence(row) >= gate]
        gates[f"{gate:.1f}"] = {
            "at_or_above": len(above),
            "rate": _rate(len(above), len(answered)),
            "hit_rate": _rate(sum(1 for row in above if row.get("inside") is True), len(above)),
        }
    spent = [row for row in asked if isinstance(row.get("jev_calls"), int) and row["jev_calls"] > 0 and isinstance(row.get("ms"), (int, float))]
    total_seconds = sum(float(row["ms"]) for row in spent) / 1000
    tables = sorted({str(row["table"]) for row in rows if row.get("table")})
    bands = Counter(str(row["band"]) for row in banded)
    return {
        "table": tables[0] if len(tables) == 1 else (tables or None),
        "rows": len(rows),
        "unasked": dict(sorted(Counter(str(row.get("skipped") or row.get("reason") or "unstated") for row in unasked).items())),
        "failed": dict(sorted(Counter(str(row.get("reason") or "unstated") for row in failed).items())),
        "answered": len(answered),
        "banded": len(banded),
        "unknown": len(answered) - len(banded),
        "hits": len(hits),
        "hit_rate": _rate(len(hits), len(banded)),
        "gates": gates,
        "jev_seconds": {
            "calls": len(spent),
            "mean": round(total_seconds / len(spent), 3) if spent else None,
            "total": round(total_seconds, 3),
        },
        "bands": dict(sorted(bands.items(), key=lambda item: (-item[1], item[0]))),
    }


def report(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Per kind, in a fixed order; a kind with no row is absent rather than reported as zeros."""
    by_kind: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_kind.setdefault(str(row.get("kind")), []).append(row)
    ordered = [kind for kind in KINDS if kind in by_kind] + sorted(kind for kind in by_kind if kind not in KINDS)
    return {kind: summarize_kind(by_kind[kind]) for kind in ordered}


def format_report(result: dict[str, Any], *, title: str) -> str:
    lines = [f"=== band shadow: {title} ==="]
    if not result:
        lines.append("no band-shadow rows")
        return "\n".join(lines)
    for kind, entry in result.items():
        lines.append(f"--- {kind} ({entry['table']}) ---")
        lines.append(f"rows: {entry['rows']}  answered: {entry['answered']}  banded: {entry['banded']}  unknown: {entry['unknown']}")
        if entry["unasked"]:
            lines.append(f"unasked: {json.dumps(entry['unasked'], sort_keys=True)}")
        if entry["failed"]:
            lines.append(f"failed: {json.dumps(entry['failed'], sort_keys=True)}")
        lines.append(f"hit rate (Keeper's number inside the argmax band): {entry['hits']}/{entry['banded']} = {entry['hit_rate']}")
        for gate, row in entry["gates"].items():
            lines.append(f"gate {gate}: at or above {row['at_or_above']} (rate {row['rate']} of answered), hit rate {row['hit_rate']}")
        seconds = entry["jev_seconds"]
        lines.append(f"jev seconds: {seconds['calls']} calls, mean {seconds['mean']}, total {seconds['total']}")
        lines.append(f"bands: {json.dumps(entry['bands'])}")
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Contract §138.8 band-shadow report over campaigns' telemetry.")
    parser.add_argument("paths", nargs="*", help="telemetry.jsonl files to read directly")
    parser.add_argument("--campaign", action="append", default=[], help="campaign id (repeatable)")
    parser.add_argument("--all", action="store_true", help="every campaign under --workspace that has a telemetry.jsonl")
    parser.add_argument("--workspace", default=DEFAULT_WORKSPACE,
                        help=f"directory holding campaigns/<id>/telemetry.jsonl (default: {DEFAULT_WORKSPACE})")
    parser.add_argument("--json", action="store_true", help="print the report as JSON")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    paths = [Path(path) for path in args.paths]
    paths += [telemetry_path(args.workspace, campaign) for campaign in args.campaign]
    if args.all:
        paths += sorted((Path(args.workspace) / "campaigns").glob("*/telemetry.jsonl"))
    if not paths:
        parser.error("give telemetry files, --campaign, or --all")
    result = report(load_rows(paths))
    if args.json:
        print(json.dumps({"sources": [str(path) for path in paths], "kinds": result}, ensure_ascii=False, indent=2, sort_keys=False))
    else:
        title = ", ".join(args.campaign) if args.campaign and not args.paths and not args.all else f"{len(paths)} file(s)"
        print(format_report(result, title=title))
    return 0


if __name__ == "__main__":
    sys.exit(main())
