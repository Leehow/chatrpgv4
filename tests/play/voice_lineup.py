"""The lineup test of docs/specs/npc-voice-mask.md §4 (contract §40.7): every spoken line of a table with
`who.npc` set, names stripped and shuffled, is given to a judge model with the roster -- name and station
only, never the masks -- and the judge says who said each. The role-language test 「去掉人称也分得清」.

    uv run --frozen python tests/play/voice_lineup.py build --campaign voice-bench-1   # writes lineup.json + lineup.md
    uv run --frozen python tests/play/voice_lineup.py judge --campaign voice-bench-1   # runs the judge, writes verdict.json

Nothing here reads a mask, detects a language or scores prose: the judge is a model, the roster is the
graph's, and the report is a confusion table. The un-judged `lineup.md` is for the user's own reading.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
from player import seed_home  # noqa: E402

DEFAULT_JUDGE_MODEL = "deepseek/deepseek-v4-flash"
JUDGE_TIMEOUT = 600

JUDGE_INSTRUCTIONS = """You are judging a lineup. `lineup.json` in this directory holds `roster` (people, each with a
name and one line saying who they are -- their station, nothing about how they talk) and `lines` (spoken
lines from a game, in random order, each with an `id`). Every line was said by exactly one person on the
roster. For every line, decide who said it from the words alone: what they call people, how the sentence
ends, the level of the words, any habit you notice repeating across lines.

Write `verdict.jsonl` in this directory: one JSON object per line, `{"id": <line id>, "who": <roster name>,
"why": <at most 80 characters>}`, one object per line of the lineup, in any order. Use the write tool once
with the whole file. No other output is needed."""


def coc_home() -> Path:
    raw = os.environ.get("PI_COC_HOME", "").strip()
    if not raw:
        return REPO_ROOT
    expanded = Path(raw).expanduser()
    return expanded if expanded.is_absolute() else (REPO_ROOT / expanded).resolve()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def roster_of(campaign_dir: Path) -> dict[str, str]:
    """Name → station, from the campaign's module graph: the NPC node's summary (the bench writes the
    station there) or the role label, never the mask."""
    meta = read_json(campaign_dir / "campaign.json")
    module = meta.get("module_id") or meta.get("module")
    graph_path = None
    for candidate in (coc_home() / ".coc" / "modules" / str(module) / "module-graph.json",
                      REPO_ROOT / "content" / "starters" / str(module).removeprefix("module-") / "module-graph.json"):
        if candidate.is_file():
            graph_path = candidate
            break
    if graph_path is None:
        raise SystemExit(f"no module graph for {module!r}")
    graph = read_json(graph_path)
    roster: dict[str, str] = {}
    for node in graph["nodes"]:
        if node.get("node_kind") != "npc":
            continue
        record = ((node.get("properties") or {}).get("runtime_projection") or {}).get("record") or {}
        # The station is the first clause of the book's voice line (who they are), never the rest (how they talk).
        voice = str(record.get("voice") or node.get("summary") or "")
        station = voice.split("，")[0].split(",")[0].strip() or str(record.get("relationship_to_investigators") or "")
        roster[node["name"]] = station
    return roster


def lines_of(campaign_dir: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in sorted((campaign_dir / "turns").glob("*.json")):
        record = read_json(path)
        for span in record.get("speech") or []:
            who = span.get("who") or {}
            if not who.get("npc"):
                continue
            rows.append({"turn": record.get("turn"), "who": who.get("name") or who.get("npc"), "text": span.get("text", "")})
    return rows


def cmd_build(args: argparse.Namespace) -> int:
    campaign_dir = coc_home() / ".coc" / "campaigns" / args.campaign
    out = Path(args.out) if args.out else coc_home() / ".coc" / "playtests" / args.run / "lineup"
    out.mkdir(parents=True, exist_ok=True)
    roster = roster_of(campaign_dir)
    rows = [row for row in lines_of(campaign_dir) if row["who"] in roster]
    rng = random.Random(args.seed)
    order = list(range(len(rows)))
    rng.shuffle(order)
    lineup = {
        "campaign": args.campaign,
        "roster": [{"name": name, "station": station} for name, station in roster.items()],
        "lines": [{"id": f"L{index + 1:03d}", "text": rows[i]["text"]} for index, i in enumerate(order)],
    }
    key = {f"L{index + 1:03d}": {"who": rows[i]["who"], "turn": rows[i]["turn"]} for index, i in enumerate(order)}
    (out / "lineup.json").write_text(json.dumps(lineup, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "key.json").write_text(json.dumps(key, ensure_ascii=False, indent=1), encoding="utf-8")
    by_person: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        by_person[row["who"]].append(f"（第 {row['turn']} 回合）{row['text']}")
    md = ["# 台词列队（去掉名字）", "", f"战役 `{args.campaign}`，{len(rows)} 句，{len(by_person)} 张嘴。先读乱序的，再看答案。", "", "## 乱序"]
    md += [f"- **{line['id']}** {line['text']}" for line in lineup["lines"]]
    md += ["", "## 答案：按人"]
    for name, station in roster.items():
        md += [f"### {name}（{station}）"] + [f"- {text}" for text in by_person.get(name, [])] + [""]
    (out / "lineup.md").write_text("\n".join(md), encoding="utf-8")
    print(f"{len(rows)} lines from {len(by_person)} people → {out}")
    return 0


def _judge_argv(pi: Path, provider: str, model_id: str, run_dir: Path) -> list[str]:
    return [str(pi), "-p", "--no-extensions", "--no-skills", "--no-prompt-templates",
            "--session-dir", str(run_dir / "judge-session"),
            "--no-context-files", "--approve", "--thinking", "off",
            "--tools", "read,write", "--provider", provider, "--model", model_id,
            "Follow JUDGE.md in this directory."]


def cmd_judge(args: argparse.Namespace) -> int:
    out = Path(args.out) if args.out else coc_home() / ".coc" / "playtests" / args.run / "lineup"
    lineup = read_json(out / "lineup.json")
    key = read_json(out / "key.json")
    (out / "JUDGE.md").write_text(JUDGE_INSTRUCTIONS, encoding="utf-8")
    (out / "verdict.jsonl").unlink(missing_ok=True)
    (out / "judge-session").mkdir(exist_ok=True)
    pi = REPO_ROOT / "node_modules" / ".bin" / "pi"
    provider, _, model_id = args.model.partition("/")
    home = seed_home(Path(tempfile.mkdtemp(prefix="voice-lineup-judge-")) / "home", REPO_ROOT / ".pi" / "coc-agent")
    env = {k: v for k, v in os.environ.items() if not k.startswith(("PI_COC_", "PIPIUI_", "PI_CODING_AGENT_DIR"))}
    env["PI_CODING_AGENT_DIR"] = str(home)
    try:
        proc = subprocess.run(_judge_argv(pi, provider, model_id, out), cwd=str(out), capture_output=True, text=True,
                              timeout=JUDGE_TIMEOUT, env=env)
    finally:
        shutil.rmtree(home.parent, ignore_errors=True)
    (out / "judge-stdout.log").write_text(proc.stdout + "\n" + proc.stderr, encoding="utf-8")
    path = out / "verdict.jsonl"
    if not path.is_file():
        print("the judge wrote no verdict; see judge-stdout.log", file=sys.stderr)
        return 1
    verdicts: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict) and row.get("id") in key:
            verdicts[row["id"]] = str(row.get("who", ""))
    per: dict[str, Counter] = defaultdict(Counter)
    confusion: Counter = Counter()
    for line_id, truth in key.items():
        guess = verdicts.get(line_id, "(none)")
        per[truth["who"]][guess == truth["who"]] += 1
        if guess != truth["who"]:
            confusion[(truth["who"], guess)] += 1
    total = sum(sum(c.values()) for c in per.values())
    right = sum(c[True] for c in per.values())
    report = {
        "model": args.model, "lines": total, "right": right, "accuracy": round(right / total, 3) if total else None,
        "per_person": {name: {"lines": sum(c.values()), "right": c[True], "accuracy": round(c[True] / sum(c.values()), 3)} for name, c in per.items()},
        "confusions": [{"said_by": a, "judged": b, "count": n} for (a, b), n in confusion.most_common()],
        "unanswered": [line_id for line_id in key if line_id not in verdicts],
    }
    (out / "verdict.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build", help="write the anonymised lineup and the key")
    build.add_argument("--campaign", required=True)
    build.add_argument("--run", default=None, help="playtest run id the lineup folder lives under (default: the campaign id)")
    build.add_argument("--out", default=None)
    build.add_argument("--seed", type=int, default=20260916)
    build.set_defaults(func=cmd_build)
    judge = sub.add_parser("judge", help="run the judge model over a built lineup")
    judge.add_argument("--campaign", required=True)
    judge.add_argument("--run", default=None)
    judge.add_argument("--out", default=None)
    judge.add_argument("--model", default=DEFAULT_JUDGE_MODEL)
    judge.set_defaults(func=cmd_judge)
    args = parser.parse_args(argv)
    if getattr(args, "run", None) is None:
        args.run = args.campaign
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
