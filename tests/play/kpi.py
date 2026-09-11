#!/usr/bin/env python3
"""tests/play/kpi.py -- the acceptance metric from docs/kernel-rpc.md §13.8.

Slice 0-2 evidence (haunting-s0 turns 13-25) is what motivated the nine-section
capsule in slice 3: the keeper was reading the table several times a turn for
things the capsule should have already told it (the clock, undiscovered clues
and NPC secrets in the current scene, exits, what changed last turn). §13.8's
acceptance test is: over some run of turns, the median number of *read-only*
tool calls before the *first successful write* should drop (4 -> <=2), the
mean should drop (5.3 -> <=3), and the number of turns that reach the rules
layer (a successful `resolve`) must not drop. This script computes those
numbers from a real `.coc/campaigns/<id>/telemetry.jsonl` (contract §8's
`{turn, tool, call_id, started_at, ms, ok, code?}` rows, plus lane rows
carrying `lane` and turn-closed rows carrying `event`) -- it never
synthesizes or hardcodes the answer.

Usage:
    uv run --frozen python tests/play/kpi.py --campaign <id> [--turns A-B] [--workspace .coc]
    uv run --frozen python tests/play/kpi.py --baseline [--workspace .coc]

`--workspace` is the directory that directly holds `campaigns/<id>/telemetry.jsonl`
(the repo's own `.coc/` for a real run; a test fixture directory in tests).
`--baseline` prints the slice-1/2 numbers for `haunting-s0` turns 13-25 (the
range named in §13.8) so a later run's numbers have something to sit next to;
it is independent of `--campaign`/`--turns`.

Only the standard library is used. Output is deterministic: same input file,
same bytes out (module-level dict order follows insertion, which here follows
ascending turn number).
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import unicodedata
from pathlib import Path
from typing import Any, Iterable

#: contract §8: only these four tool calls mint a call_id and change state.
WRITE_TOOLS = {"resolve", "apply", "ask", "narrate"}
#: contract §8: look/lookup/recall never carry a call_id -- pure reads.
READ_TOOLS = {"look", "lookup", "recall"}
#: the extension's own turn-opening call (contract §8's `before_agent_start`),
#: not a tool the keeper chose to call -- excluded from every count here.
HARNESS_TOOLS = {"table.player_input"}

DEFAULT_WORKSPACE = ".coc"
BASELINE_CAMPAIGN = "haunting-s0"
BASELINE_TURNS = (13, 25)


def telemetry_path(workspace: str, campaign: str) -> Path:
    return Path(workspace) / "campaigns" / campaign / "telemetry.jsonl"


def load_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(f"no telemetry.jsonl at {path}")
    rows = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def is_tool_call(row: dict[str, Any]) -> bool:
    """A real RPC tool-call row, as opposed to a `narrate`/`ask` turn-closed
    marker (carries `event`), a memory/verifier lane row (carries `lane`),
    or the harness's own `table.player_input`."""
    tool = row.get("tool")
    if not tool or tool in HARNESS_TOOLS:
        return False
    if "event" in row or "lane" in row:
        return False
    return True


def group_by_turn(rows: Iterable[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    by_turn: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        if not is_tool_call(row):
            continue
        turn = row.get("turn")
        if turn is None:
            continue
        by_turn.setdefault(int(turn), []).append(row)
    return by_turn


def turn_metrics(calls: list[dict[str, Any]]) -> dict[str, Any]:
    """One turn's tool-call rows, in call order.

    `reads_before_write` counts read-only calls (look/lookup/recall) made
    before the first *successful* write (a resolve/apply/ask/narrate with
    `ok: true`) -- a write call that errored never touched state, so it
    neither counts as a read nor stops the count; the keeper just kept
    trying to write, or reading around the failure, until one landed."""
    reads_before_write = 0
    reached_write = False
    for call in calls:
        tool = call["tool"]
        if tool in WRITE_TOOLS and call.get("ok") is True:
            reached_write = True
            break
        if tool in READ_TOOLS:
            reads_before_write += 1
    return {
        "reads_before_write": reads_before_write,
        "reached_write": reached_write,
        "total_calls": len(calls),
        "kernel_errors": sum(1 for c in calls if c.get("ok") is False),
        # contract §13.8's other acceptance clause: "进规则层的 lane 数不降".
        "reached_rules_layer": any(c["tool"] == "resolve" and c.get("ok") is True for c in calls),
    }


def normalize(name: str) -> str:
    """The same case/width/separator-insensitive key the kernel matches names by, so a
    `lookup` of "Steven Knott" and a capsule entry "steven-knott" are one name here too."""
    text = unicodedata.normalize("NFKC", str(name)).lower()
    return re.sub(r"[\s_\-]+", " ", text).strip()


def present_names(workspace: str, campaign: str) -> dict[int, set[str]]:
    """Who the capsule already put in the room, per closed turn (§17.6). Read from the turn
    records' own `capsule`, which is what the keeper actually saw -- not rebuilt from the
    graph, and not from the mutable world."""
    directory = Path(workspace) / "campaigns" / campaign / "turns"
    by_turn: dict[int, set[str]] = {}
    for path in sorted(directory.glob("*.json")) if directory.is_dir() else []:
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        capsule = record.get("capsule")
        if not isinstance(record.get("turn"), int) or not isinstance(capsule, dict):
            continue
        names = {normalize(entry["name"]) for entry in capsule.get("present") or []
                 if isinstance(entry, dict) and isinstance(entry.get("name"), str)}
        if names:
            by_turn[int(record["turn"])] = names
    return by_turn


def redundant_npc_reads(calls: list[dict[str, Any]], here: set[str]) -> int:
    """§17.6: read calls aimed at someone the capsule already described in full. A `lookup`
    or `look focus=npc` naming one of them is the call the NPC layer is supposed to make
    unnecessary; a call about anyone else is a real question and is not counted."""
    hits = 0
    for call in calls:
        if call.get("tool") not in ("look", "lookup"):
            continue
        about = call.get("about")
        if isinstance(about, str) and normalize(about) in here:
            hits += 1
    return hits


def compute(rows: list[dict[str, Any]], turns: tuple[int, int] | None = None,
            present: dict[int, set[str]] | None = None) -> dict[int, dict[str, Any]]:
    by_turn = group_by_turn(rows)
    selected = sorted(by_turn)
    if turns is not None:
        lo, hi = turns
        selected = [t for t in selected if lo <= t <= hi]
    metrics = {t: turn_metrics(by_turn[t]) for t in selected}
    for turn, here in (present or {}).items():
        if turn in metrics:
            metrics[turn]["npcs_present"] = len(here)
            metrics[turn]["redundant_npc_reads"] = redundant_npc_reads(by_turn[turn], here)
            metrics[turn]["reads_carry_about"] = any(
                call.get("tool") in ("look", "lookup") and isinstance(call.get("about"), str)
                for call in by_turn[turn])
    return metrics


def offers(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Contract §31.2: what the capsule put within reach, against what the turns took.

    A capability nobody uses and a capability nobody *can* use read the same way here --
    offered, never taken -- and that is the useful part: both have shipped in this project,
    and telling them apart costs one investigation instead of one slice. Counting only;
    nothing here reaches the next capsule (§13.7's law).
    """
    kinds: dict[str, dict[str, int]] = {}
    turns = 0
    for row in rows:
        if row.get("lane") != "offers":
            continue
        turns += 1
        taken = {str(name) for name in row.get("taken", [])}
        for name in row.get("offered", []):
            kind = str(name).split(":", 1)[0]
            counts = kinds.setdefault(kind, {"offered": 0, "taken": 0})
            counts["offered"] += 1
            counts["taken"] += 1 if str(name) in taken else 0
    if not turns:
        return {}
    return {"turns_with_offers": turns,
            "by_kind": {kind: {**counts, "never_taken": counts["taken"] == 0}
                        for kind, counts in sorted(kinds.items())}}


def admission(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Contract §32.7: what the action-admission review decided, and what it cost.

    Counts per verdict, how many verdicts were reused within a turn, how many reviews could not
    reach a verdict (and why), and the foreground time the reviews took -- kept apart from the
    turn's delivery time, because rollout compares the two. Whether a refusal was right is a
    human reading of the turn record; nothing here scores it.
    """
    verdicts: dict[str, int] = {}
    unavailable: dict[str, int] = {}
    reviewed = reused = skipped = 0
    ms: list[int] = []
    for row in rows:
        if row.get("lane") != "admission":
            continue
        if row.get("skipped"):
            skipped += 1
            continue
        if row.get("ok") is False:
            reason = str(row.get("reason", "unknown"))
            unavailable[reason] = unavailable.get(reason, 0) + 1
            continue
        verdict = str(row.get("verdict", "unknown"))
        verdicts[verdict] = verdicts.get(verdict, 0) + 1
        if row.get("reused"):
            reused += 1
        else:
            reviewed += 1
            if isinstance(row.get("ms"), (int, float)):
                ms.append(int(row["ms"]))
    if not (reviewed or reused or skipped or unavailable):
        return {}
    return {"reviews": reviewed, "reused": reused, "skipped": skipped,
            "verdicts": dict(sorted(verdicts.items())),
            "unavailable": dict(sorted(unavailable.items())),
            "review_ms": {"total": sum(ms), "max": max(ms) if ms else 0,
                          "mean": round(sum(ms) / len(ms)) if ms else 0}}


def summarize(per_turn: dict[int, dict[str, Any]]) -> dict[str, Any]:
    if not per_turn:
        return {"turns": 0}
    reads = [m["reads_before_write"] for m in per_turn.values()]
    summary: dict[str, Any] = {
        "turns": len(per_turn),
        "reads_before_write_median": statistics.median(reads),
        "reads_before_write_mean": round(sum(reads) / len(reads), 3),
        "reads_before_write_max": max(reads),
        "total_calls_median": statistics.median(m["total_calls"] for m in per_turn.values()),
        "kernel_errors_total": sum(m["kernel_errors"] for m in per_turn.values()),
        "reached_rules_layer_turns": sum(1 for m in per_turn.values() if m["reached_rules_layer"]),
        "reached_write_turns": sum(1 for m in per_turn.values() if m["reached_write"]),
    }
    # §17.6: over the turns that had anyone in the room, how often the keeper still went
    # and looked one of them up. The capsule carries the dossier and the account, so the
    # acceptance number is a median of zero.
    with_npcs = [m for m in per_turn.values() if m.get("npcs_present")]
    if with_npcs:
        summary["turns_with_npcs"] = len(with_npcs)
        if any(m.get("reads_carry_about") for m in with_npcs):
            reads = [m["redundant_npc_reads"] for m in with_npcs]
            summary["redundant_npc_reads_median"] = statistics.median(reads)
            summary["redundant_npc_reads_total"] = sum(reads)
        else:
            # A run recorded before the read rows carried `about` cannot answer this: every
            # count would be zero because the column is missing, not because the keeper
            # stopped asking. Say so rather than reporting a zero that means nothing.
            summary["redundant_npc_reads_median"] = "unmeasurable (telemetry has no `about` column)"
    return summary


def format_report(per_turn: dict[int, dict[str, Any]], summary: dict[str, Any], *, title: str) -> str:
    lines = [f"=== {title} ==="]
    for turn in sorted(per_turn):
        m = per_turn[turn]
        lines.append(
            f"turn {turn:>3}: reads_before_write={m['reads_before_write']:<3} "
            f"total_calls={m['total_calls']:<3} kernel_errors={m['kernel_errors']:<2} "
            f"reached_rules_layer={m['reached_rules_layer']!s:<5} reached_write={m['reached_write']}"
        )
    lines.append("---")
    for key, value in summary.items():
        lines.append(f"{key}: {value}")
    return "\n".join(lines)


def parse_turns(spec: str) -> tuple[int, int]:
    if "-" not in spec:
        raise ValueError("--turns must look like 'A-B'")
    lo, hi = spec.split("-", 1)
    return int(lo), int(hi)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Contract §13.8 read-before-write KPI over a campaign's telemetry.")
    parser.add_argument("--campaign", help="campaign id (its telemetry.jsonl is read)")
    parser.add_argument("--turns", help="inclusive turn range 'A-B'; default is every turn in the file")
    parser.add_argument("--workspace", default=DEFAULT_WORKSPACE,
                         help=f"directory holding campaigns/<id>/telemetry.jsonl (default: {DEFAULT_WORKSPACE})")
    parser.add_argument("--baseline", action="store_true",
                         help=f"print the slice-1/2 numbers for {BASELINE_CAMPAIGN} turns "
                              f"{BASELINE_TURNS[0]}-{BASELINE_TURNS[1]} instead of --campaign's")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.baseline:
        campaign, turns, title = BASELINE_CAMPAIGN, BASELINE_TURNS, \
            f"baseline: {BASELINE_CAMPAIGN} turns {BASELINE_TURNS[0]}-{BASELINE_TURNS[1]}"
    else:
        if not args.campaign:
            parser.error("--campaign is required unless --baseline is given")
        campaign = args.campaign
        turns = parse_turns(args.turns) if args.turns else None
        title = campaign if not args.turns else f"{campaign} turns {args.turns}"

    path = telemetry_path(args.workspace, campaign)
    rows = load_rows(path)
    per_turn = compute(rows, turns, present_names(args.workspace, campaign))
    summary = summarize(per_turn)
    ledger = offers(rows)
    if ledger:
        summary["offers"] = ledger
    reviews = admission(rows)
    if reviews:
        summary["admission"] = reviews
    print(format_report(per_turn, summary, title=title))
    return 0


if __name__ == "__main__":
    sys.exit(main())
