#!/usr/bin/env python3
"""tests/play/judge_tools.py -- the judge lane's tools, copied into a run's directory.

Spec: docs/specs/player-persona-benchmark.md section 6, tier C. The first version of this
lane handed the judge a 39KB `judge-packet.json` and asked it to answer from it; the agent
read the file and then produced nothing at all, twice. This repository already knows why:
give a reader tools, not raw JSON -- an agent made to reshape its own input spends its
context on the reshaping.

So the packet stays as data and the judge reads it through these subcommands:

    python judge_tools.py questions            what you must answer
    python judge_tools.py turns                one line per turn
    python judge_tools.py turn <n>             one turn in full
    python judge_tools.py truth [--kind clue]  the module's own truth
    python judge_tools.py record --metric M --turn N --verdict ok|violation
                                 --quote "..." [--why "..."]

`record` is the only way a finding is kept, and it refuses what cannot be cited: an unknown
metric, a turn that is not in this run, a verdict outside the two words, an empty quote, or
a quote that does not actually occur in that turn's text. The count of refusals is kept too,
so a judge that argues with the record leaves a trace.

Only the standard library is used.
"""
from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACKET = HERE / "judge-packet.json"
FINDINGS = HERE / "judgement.jsonl"
REFUSALS = HERE / "judge-refusals.jsonl"
VERDICTS = ("ok", "violation")


def packet() -> dict:
    return json.loads(PACKET.read_text(encoding="utf-8"))


def normalise(text: str) -> str:
    return "".join(unicodedata.normalize("NFKC", text).split())


def turn_text(turn: dict) -> str:
    return " ".join(str(turn.get(field) or "") for field in ("keeper_text", "player_message"))


def cmd_questions(args, data) -> int:
    for question in data["questions"]:
        print(f"[{question['id']}]\n{question['question']}\n{question['good_answer']}\n")
    return 0


def cmd_turns(args, data) -> int:
    for turn in data["turns"]:
        player = (turn.get("player_message") or "(opening: no player input)").replace("\n", " ")
        keeper = (turn.get("keeper_text") or "").replace("\n", " ")
        print(f"turn {turn['turn']}: player={player[:90]!r} keeper={keeper[:110]!r} "
              f"receipts={len(turn.get('receipts') or [])}")
    return 0


def cmd_turn(args, data) -> int:
    for turn in data["turns"]:
        if turn["turn"] == args.n:
            print(json.dumps(turn, ensure_ascii=False, indent=1))
            return 0
    print(f"no turn {args.n} in this run", file=sys.stderr)
    return 1


def cmd_truth(args, data) -> int:
    rows = [row for row in data["module_truth"] if not args.kind or row.get("kind") == args.kind]
    for row in rows:
        print(f"{row.get('kind')}\t{row.get('visibility')}\t{row.get('name')}\t{row.get('summary')}")
    return 0


def cmd_record(args, data) -> int:
    allowed = {question["id"] for question in data["questions"]}
    turns = {turn["turn"]: turn for turn in data["turns"]}
    quote = (args.quote or "").strip()

    def refuse(reason: str) -> int:
        with REFUSALS.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"metric": args.metric, "turn": args.turn, "verdict": args.verdict,
                                "quote": quote, "reason": reason}, ensure_ascii=False) + "\n")
        print(f"refused: {reason}", file=sys.stderr)
        return 2

    if args.metric not in allowed:
        return refuse(f"{args.metric!r} is not one of this run's questions: {sorted(allowed)}")
    if args.turn not in turns:
        return refuse(f"turn {args.turn} is not in this run")
    if args.verdict not in VERDICTS:
        return refuse(f"verdict must be one of {VERDICTS}")
    if not quote:
        return refuse("a finding without a quote is not a finding")
    if normalise(quote) not in normalise(turn_text(turns[args.turn])):
        return refuse(f"that sentence does not occur in turn {args.turn}")

    with FINDINGS.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"metric": args.metric, "turn": args.turn, "verdict": args.verdict,
                            "quote": quote, "why": args.why or ""}, ensure_ascii=False) + "\n")
    print(f"recorded {args.verdict} for {args.metric} at turn {args.turn}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="judge_tools.py")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("questions").set_defaults(func=cmd_questions)
    sub.add_parser("turns").set_defaults(func=cmd_turns)
    p = sub.add_parser("turn"); p.add_argument("n", type=int); p.set_defaults(func=cmd_turn)
    p = sub.add_parser("truth"); p.add_argument("--kind", default=None); p.set_defaults(func=cmd_truth)
    p = sub.add_parser("record")
    p.add_argument("--metric", required=True)
    p.add_argument("--turn", type=int, required=True)
    p.add_argument("--verdict", required=True)
    p.add_argument("--quote", required=True)
    p.add_argument("--why", default="")
    p.set_defaults(func=cmd_record)
    args = parser.parse_args(argv)
    return args.func(args, packet())


if __name__ == "__main__":
    sys.exit(main())
