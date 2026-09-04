#!/usr/bin/env python3
"""Drive one module from PDF pages to an accepted graph, unattended.

Everything under this module already existed as pieces a person had to carry
between by hand: plan the sections, prepare a packet, hand it to a model, run
the gates, hand the findings back. Four books were extracted that way, and the
gates caught the reader repeatedly -- twelve invented span ids, four
miscitations, one reply that would have passed as an extraction while citing
2.8% of its section. That is the loop working. What was missing is anything
that runs it without a person in the chair.

Host-agnostic on purpose
------------------------
The one thing this module does not do is call a model. It takes `ask`, a
callable of (instruction, payload) -> str, and the host supplies it: in a
packaged desktop build that is the app's own session, which is the same model
already running the Keeper; in development it is whatever adapter the caller
injects. Naming a binary here would work on the machine that wrote it and fail
on the customer's, which is the trap this pipeline has already been walked back
from once.

Convergence is not assumed
--------------------------
A findings round is only worth taking if the reply改善. Each attempt records
its gate and finding count, the loop stops at `max_rounds`, and the receipt
carries every round so a caller can see whether the model was converging or
circling. A section that never passes is reported as such, with its last
findings, rather than being written out half-checked.

A section can also be too big to say
------------------------------------
Measured on the first unattended runs: a reply dies mid-token at roughly
64,000 characters, while one faithful whole-book shard is 77,000. Input that
fits the packet budget can still exceed what one generation can carry, so
`extract_section` reports `output_over_generation_budget` instead of retrying
an identical failure, and the driver narrows the section -- split the page
range in half and extract each half -- down to a single page, which either
fits or is reported as unbuildable with its evidence intact.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

import coc_module_graph_extract as extract  # noqa: E402
import coc_module_plan as planner  # noqa: E402


class Ask(Protocol):
    """How the host reaches its model. Instruction and payload in, text out."""

    def __call__(self, instruction: str, payload: str) -> str: ...


@dataclass
class Round:
    attempt: int
    status: str
    gate: str | None = None
    finding_count: int = 0
    findings: list[dict[str, Any]] = field(default_factory=list)


def _parse_reply(text: str) -> tuple[Any | None, str | None]:
    """The model returns one JSON object; accept it, or say why not."""
    stripped = text.strip()
    if stripped.startswith("```"):
        # A fenced reply is the contract being ignored, not a parse problem,
        # but recovering it costs nothing and the gates still judge the content.
        stripped = stripped.split("```", 2)[1]
        if stripped.lstrip().lower().startswith("json"):
            stripped = stripped.lstrip()[4:]
        stripped = stripped.rsplit("```", 1)[0]
    start = stripped.find("{")
    if start < 0:
        return None, "reply carried no JSON object"
    end = stripped.rfind("}")
    error: json.JSONDecodeError | None = None
    if end > start:
        try:
            return json.loads(stripped[start:end + 1]), None
        except json.JSONDecodeError as decode_error:
            error = decode_error
    # Judge truncation against everything the model emitted. Trimming back to
    # the last `}` is prose-stripping; on a cut-off reply it hides the cut.
    if _completes_when_closed(stripped[start:]):
        # The generation stopped mid-token. Everything it emitted was
        # well-formed; it simply never reached the end. Calling that a JSON
        # mistake sends the next round to fix punctuation that is not wrong,
        # and the same reply comes back the same length.
        return None, TRUNCATED
    if error is None:
        return None, "reply carried no JSON object"
    return None, f"reply did not parse as JSON: {error}"


TRUNCATED = "the reply ended mid-token; the generation stopped before finishing"


def _completes_when_closed(body: str) -> bool:
    """Whether the reply is a prefix of some valid JSON document.

    This separates a cut-off generation from a mistyped one without guessing
    at a ratio, in two exact steps.

    First, a cut leaves containers open. If the reply's brackets balance, the
    generation reached its end and any parse failure is a mistake it made, not
    a cut -- that guard is what stops the repair below from also "repairing"
    a stray comma by discarding the well-formed remainder after it.

    Then the element the cut landed inside is dropped and the open containers
    closed. A truncation parses once that is done; a mistake does not.
    """
    if not _open_containers(body):
        return False
    for prefix in _repair_candidates(body):
        stack = _open_containers(prefix)
        if not stack:
            continue
        try:
            json.loads(prefix + "".join(reversed(stack)))
            return True
        except json.JSONDecodeError:
            continue
    return False


def _open_containers(text: str) -> list[str] | None:
    """Closers for the containers `text` leaves open; None if its brackets clash."""
    stack: list[str] = []
    in_string = escaped = False
    for char in text:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char in "{[":
            stack.append("}" if char == "{" else "]")
        elif char in "}]":
            if not stack or stack.pop() != char:
                return None
    return stack


def _repair_candidates(body: str) -> list[str]:
    """Prefixes to try, longest first: the tail back to each element boundary.

    A cut lands inside one element, so the repair is always within a few
    boundaries of the end. Searching the whole document instead would make a
    long malformed reply cost O(n^2) to reject.
    """
    trimmed = body.rstrip().rstrip(",:")
    candidates = [trimmed]
    position = len(trimmed)
    for _ in range(REPAIR_BOUNDARIES):
        position = max(trimmed.rfind(",", 0, position),
                       trimmed.rfind("[", 0, position),
                       trimmed.rfind("{", 0, position))
        if position < 0:
            break
        head = trimmed[:position] if trimmed[position] == "," else trimmed[:position + 1]
        candidates.append(head.rstrip().rstrip(",:"))
    return candidates


REPAIR_BOUNDARIES = 8


def extract_section(
    work_dir: Path,
    ask: Ask,
    *,
    max_rounds: int = 3,
    instruction_path: Path | None = None,
) -> dict[str, Any]:
    """Read one prepared section until both gates are silent, or give up."""
    instruction = (instruction_path or extract.INSTRUCTION_PATH).read_text(
        encoding="utf-8"
    )
    packet = (work_dir / "extraction-packet.json").read_text(encoding="utf-8")
    rounds: list[Round] = []
    payload = packet
    for attempt in range(1, max_rounds + 1):
        reply = ask(instruction, payload)
        parsed, problem = _parse_reply(reply)
        if parsed is None:
            truncated = problem == TRUNCATED
            code = "model_output_truncated" if truncated else "model_output_not_json"
            finding = {"code": code, "path": "/", "message": problem,
                       "reply_chars": len(reply)}
            rounds.append(Round(attempt, "findings", "shape", 1, [finding]))
            if truncated:
                # Retrying is not a fix: the ask is larger than one generation
                # can carry, so every round dies at the same place. Report it
                # as its own outcome so the caller narrows the section instead
                # of spending the remaining rounds on an identical failure.
                return {
                    "section_id": work_dir.name,
                    "status": "output_over_generation_budget",
                    "attempts": attempt,
                    "rounds": [r.__dict__ for r in rounds],
                    "findings": [finding],
                }
        else:
            result = extract.review(work_dir, parsed)
            rounds.append(Round(
                attempt, result["status"], result.get("gate"),
                result.get("finding_count", 0), result.get("findings", []),
            ))
            if result["status"] == "accepted":
                return {
                    "status": "accepted",
                    "attempts": attempt,
                    "rounds": [r.__dict__ for r in rounds],
                    "shard_path": result["shard_path"],
                    "nodes": result["nodes"],
                    "claims": result["claims"],
                    "relations": result["relations"],
                }
        # Findings go back verbatim: the model is told what failed, not a
        # paraphrase of it, because a paraphrase is where a loop starts to
        # optimise for the paraphrase.
        payload = json.dumps({
            "extraction_packet": json.loads(packet),
            "previous_attempt_findings": rounds[-1].findings,
        }, ensure_ascii=False)
    return {
        "status": "not_accepted",
        "attempts": len(rounds),
        "rounds": [r.__dict__ for r in rounds],
        "reason": (
            f"{max_rounds} rounds did not clear the gates; the last attempt "
            f"failed the {rounds[-1].gate} gate with "
            f"{rounds[-1].finding_count} findings"
        ),
    }


def plan_module(
    bundle: Path,
    ask: Ask,
    *,
    budget: int = planner.DEFAULT_SECTION_BUDGET,
    max_rounds: int = 3,
) -> dict[str, Any]:
    """Decide the sections, checking every proposal before accepting it."""
    dispatched = planner.dispatch(bundle, budget=budget)
    if dispatched["status"] != "dispatch":
        return dispatched
    measured = dispatched["measured"]
    if measured["fits_whole_book"]:
        return {
            "status": "accepted",
            "attempts": 0,
            "sections": [{
                "section_id": "whole-book",
                "pdf_index_start": measured["pdf_index_first"],
                "pdf_index_end": measured["pdf_index_last"],
                "reason": "the module fits one section under the budget",
            }],
        }
    instruction = planner.INSTRUCTION_PATH.read_text(encoding="utf-8")
    base = {
        "measured": {k: v for k, v in measured.items() if k != "page_chars"},
        "structure_page_text": dispatched["structure_page_text"],
    }
    rounds: list[Round] = []
    payload = json.dumps(base, ensure_ascii=False)
    for attempt in range(1, max_rounds + 1):
        parsed, problem = _parse_reply(ask(instruction, payload))
        if parsed is None:
            findings = [{"code": "model_output_not_json", "message": problem}]
        else:
            findings = planner.check(measured, parsed)
            over_budget_only = bool(findings) and all(
                f.get("code") == "section_over_budget" for f in findings
            )
            if over_budget_only:
                # A plan that is wrong only in arithmetic the model cannot
                # perform is repaired, not retried: split at page boundaries
                # and re-check, and the receipt says the machine did it.
                repaired, repairs = planner.split_over_budget(
                    measured, parsed["sections"],
                )
                if repairs and not planner.check(measured, {"sections": repaired}):
                    rounds.append(Round(
                        attempt, "repaired", "plan", len(findings), findings,
                    ))
                    return {
                        "status": "accepted",
                        "attempts": attempt,
                        "rounds": [r.__dict__ for r in rounds],
                        "sections": repaired,
                        "repairs": repairs,
                    }
            if not findings:
                return {
                    "status": "accepted",
                    "attempts": attempt,
                    "rounds": [r.__dict__ for r in rounds],
                    "sections": parsed["sections"],
                }
        rounds.append(Round(attempt, "findings", "plan", len(findings), findings))
        payload = json.dumps(
            {**base, "previous_attempt_findings": findings}, ensure_ascii=False,
        )
    return {
        "status": "not_accepted",
        "attempts": len(rounds),
        "rounds": [r.__dict__ for r in rounds],
        "reason": f"{max_rounds} rounds produced no plan the checker accepted",
    }


SKELETON_INSTRUCTION_PATH = (
    _HERE.parent / "pi" / "prompts" / "module-skeleton.md"
)
SKELETON_ASPECTS = ("structure", "world", "actors")


def skeleton_module(
    bundle: Path,
    work: Path,
    module_id: str,
    plan: dict[str, Any],
    ask: Ask,
    *,
    max_rounds: int = 3,
) -> dict[str, Any]:
    """One coarse read of the whole book: spine, roster, entry candidates.

    The skeleton is a shard like any other -- same contract, same gates,
    same receipt -- over a deliberately scattered page set: the book's own
    structure pages plus the first page of every planned section. It exists
    to decide what gets deep-read first, which is why it runs after the plan
    and before any section.
    """
    measured = planner.measure(bundle)
    if measured["status"] != "measured":
        return measured
    pages = sorted({
        *(int(i) for i in measured["structure_page_candidates"]),
        *(int(s["pdf_index_start"]) for s in plan["sections"]),
    })
    prepared = extract.prepare(
        bundle,
        work / "skeleton",
        module_id=module_id,
        section_id="skeleton",
        pdf_indices=pages,
        aspects=SKELETON_ASPECTS,
    )
    if prepared.get("status") == "empty":
        return {"status": "empty", "pages": pages}
    outcome = extract_section(
        work / "skeleton", ask, max_rounds=max_rounds,
        instruction_path=SKELETON_INSTRUCTION_PATH,
    )
    result: dict[str, Any] = {
        "pages": pages,
        "spans": prepared["span_count"],
        **outcome,
    }
    if outcome["status"] == "accepted":
        shard = json.loads(
            Path(outcome["shard_path"]).read_text(encoding="utf-8")
        )
        result["opening"] = opening_sections(plan, shard)
    return result


def opening_sections(
    plan: dict[str, Any], shard: dict[str, Any]
) -> dict[str, Any]:
    """Which sections hold the skeleton's entry evidence, deterministically.

    The model may propose the entry; only its evidence pages decide which
    sections get deep-read first. A proposal without evidence decides
    nothing and says so, rather than guessing the first section.
    """
    pages: set[int] = set()
    for node in shard.get("nodes") or []:
        if not isinstance(node, dict) or node.get("node_kind") != "scene":
            continue
        for span_id in node.get("evidence_span_ids") or []:
            match = re.search(r"-page-(\d+)-", str(span_id))
            if match:
                pages.add(int(match.group(1)))
    if not pages:
        return {
            "sections": [],
            "entry_pages": [],
            "basis": "the skeleton named no entry scene with evidence",
        }
    chosen = [
        str(section["section_id"])
        for section in plan["sections"]
        if any(
            int(section["pdf_index_start"]) <= page <= int(section["pdf_index_end"])
            for page in pages
        )
    ]
    return {
        "sections": chosen,
        "entry_pages": sorted(pages),
        "basis": "entry scene evidence pages mapped to their plan sections",
    }


def _extract_ranged(
    bundle: Path,
    work: Path,
    module_id: str,
    section_id: str,
    pdf_index_start: int,
    pdf_index_end: int,
    ask: Ask,
    max_rounds: int,
    results: list[dict[str, Any]],
    _base_id: str | None = None,
) -> None:
    """Extract one page range, narrowing by bisection when one reply cannot
    carry the shard. A single page is the floor: past it there is nothing
    smaller to ask for, so the page is reported with its evidence.

    Children are named from the section they descend from plus their own page
    range (`whole-book-p9-13`), never by compounding the parent's id.
    """
    base_id = _base_id or section_id
    prepared = extract.prepare(
        bundle,
        work / section_id,
        module_id=module_id,
        section_id=section_id,
        pdf_index_start=pdf_index_start,
        pdf_index_end=pdf_index_end,
    )
    if prepared.get("status") == "empty":
        # Only declared holes live in this range; there is nothing to read.
        # Recorded, never counted as accepted or as failed.
        results.append({
            "section_id": section_id, "spans": 0, "status": "empty",
            "reason": prepared.get("reason"),
        })
        (work / section_id).mkdir(parents=True, exist_ok=True)
        (work / section_id / "outcome.json").write_text(
            json.dumps(results[-1], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(json.dumps({
            "section_id": section_id, "status": "empty",
        }, ensure_ascii=False), flush=True)
        return
    outcome = extract_section(work / section_id, ask, max_rounds=max_rounds)
    if (
        outcome["status"] == "output_over_generation_budget"
        and pdf_index_end > pdf_index_start
    ):
        mid = (pdf_index_start + pdf_index_end) // 2
        _extract_ranged(
            bundle, work, module_id, f"{base_id}-p{pdf_index_start}-{mid}",
            pdf_index_start, mid, ask, max_rounds, results, base_id,
        )
        _extract_ranged(
            bundle, work, module_id, f"{base_id}-p{mid + 1}-{pdf_index_end}",
            mid + 1, pdf_index_end, ask, max_rounds, results, base_id,
        )
        return
    results.append({"section_id": section_id, "spans": prepared["span_count"], **{
        k: v for k, v in outcome.items() if k != "rounds"
    }, "rounds": outcome["rounds"]})
    # Every resolved section lands on disk immediately. A driver that dies
    # mid-build (one pilot did, on a hanged channel) loses only the sections
    # still in flight, never the rounds already judged.
    (work / section_id).mkdir(parents=True, exist_ok=True)
    (work / section_id / "outcome.json").write_text(
        json.dumps(results[-1], ensure_ascii=False, indent=2), encoding="utf-8",
    )
    print(json.dumps({
        "section_id": section_id,
        "status": outcome["status"],
        "attempts": outcome.get("attempts"),
        "nodes": outcome.get("nodes"),
    }, ensure_ascii=False), flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--adapter", required=True,
        help=(
            "import path of a module exposing `ask(instruction, payload)`. "
            "The product supplies the app's own session; this flag exists so "
            "development can inject a scaffold without the pipeline naming one."
        ),
    )
    parser.add_argument("--source-bundle", required=True)
    parser.add_argument(
        "--work-dir",
        help="receipts and packets land here; defaults to "
             ".coc/module-builds/<module-id> under the current directory",
    )
    parser.add_argument("--module-id", required=True)
    parser.add_argument("--budget", type=int, default=planner.DEFAULT_SECTION_BUDGET)
    parser.add_argument(
        "--max-rounds", type=int, default=4,
        help="findings rounds per extraction target; measured on a dense book: "
             "small leaves pass in 1-3, and 3 was cutting off rounds that "
             "were converging (two leaves needed exactly the 5th)",
    )
    parser.add_argument(
        "--max-leaf-pages", type=int, default=4,
        help="pre-split sections past this many pages instead of discovering "
             "the generation ceiling by truncation; 4-page chunks of the "
             "densest book on record all passed within 3 rounds",
    )
    parser.add_argument("--only-section")
    parser.add_argument(
        "--opening-only",
        action="store_true",
        help="deep-read only the sections the skeleton's entry evidence names",
    )
    parser.add_argument(
        "--no-skeleton",
        action="store_true",
        help="skip the skeleton pass (plain full build)",
    )
    parser.add_argument(
        "--plan-only",
        action="store_true",
        help="plan, write plan.json, and stop -- an operator reviews the "
             "sectioning before spending a model call per section",
    )
    parser.add_argument(
        "--plan",
        help=(
            "path to an already-accepted plan.json. One plan drives many "
            "section workers; without this flag every invocation would "
            "re-plan, which is one wasted model call per section."
        ),
    )
    args = parser.parse_args(argv)

    import importlib
    adapter = importlib.import_module(args.adapter)
    ask: Ask = adapter.ask

    bundle = Path(args.source_bundle)
    work = Path(args.work_dir) if args.work_dir else Path(
        ".coc", "module-builds", args.module_id
    )
    work.mkdir(parents=True, exist_ok=True)

    if args.plan:
        planned = json.loads(Path(args.plan).read_text(encoding="utf-8"))
        if planned.get("status") != "accepted":
            print(json.dumps({
                "status": "not_accepted",
                "reason": f"--plan carries status {planned.get('status')!r}, "
                          "only an accepted plan can drive sections",
            }, ensure_ascii=False, indent=2))
            return 1
    else:
        planned = plan_module(bundle, ask, budget=args.budget, max_rounds=args.max_rounds)
        (work / "plan.json").write_text(
            json.dumps(planned, ensure_ascii=False, indent=2), encoding="utf-8",
        )
    if planned["status"] != "accepted":
        print(json.dumps(planned, ensure_ascii=False, indent=2))
        return 1

    if args.plan_only:
        print(json.dumps({
            "status": "planned",
            "sections": len(planned["sections"]),
            "plan": str(work / "plan.json"),
        }, ensure_ascii=False, indent=2))
        return 0

    skeleton_result: dict[str, Any] | None = None
    if not args.no_skeleton and not args.only_section:
        skeleton_result = skeleton_module(
            bundle, work, args.module_id, planned, ask,
            max_rounds=args.max_rounds,
        )
        (work / "skeleton").mkdir(parents=True, exist_ok=True)
        (work / "skeleton" / "outcome.json").write_text(
            json.dumps(skeleton_result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(json.dumps({
            "section_id": "skeleton",
            "status": skeleton_result["status"],
            "attempts": skeleton_result.get("attempts"),
            "opening_sections": (skeleton_result.get("opening") or {}).get("sections"),
        }, ensure_ascii=False), flush=True)

    if args.opening_only:
        opening = (skeleton_result or {}).get("opening") or {}
        extract_first = set(opening.get("sections") or [])
        if not extract_first:
            print(json.dumps({
                "status": "not_accepted",
                "reason": "the skeleton identified no opening sections "
                          f"({opening.get('basis')})",
            }, ensure_ascii=False, indent=2))
            return 1

    results: list[dict[str, Any]] = []
    for section in planned["sections"]:
        sid = section["section_id"]
        if args.only_section and sid != args.only_section:
            continue
        if args.opening_only and sid not in extract_first:
            continue
        # Pre-split into leaf-sized chunks: every truncation-first narrowing
        # measured so far burned a full generation discovering a size the
        # page count already predicts. The narrowing recursion stays as the
        # safety net under each chunk.
        start, end = int(section["pdf_index_start"]), int(section["pdf_index_end"])
        spans_range = end - start + 1
        if spans_range > args.max_leaf_pages:
            chunks = [
                (chunk_start, min(chunk_start + args.max_leaf_pages - 1, end))
                for chunk_start in range(start, end + 1, args.max_leaf_pages)
            ]
        else:
            chunks = [(start, end)]
        for chunk_start, chunk_end in chunks:
            chunk_id = (
                sid if (chunk_start, chunk_end) == (start, end)
                else f"{sid}-p{chunk_start}-{chunk_end}"
            )
            _extract_ranged(
                bundle,
                work,
                args.module_id,
                chunk_id,
                chunk_start,
                chunk_end,
                ask,
                args.max_rounds,
                results,
            )

    receipt_name = (
        f"build.{args.only_section}.json" if args.only_section else "build.json"
    )
    # A --only-section worker shares its work dir with the other sections of
    # the same module; its receipt is its own, or forty-two workers would
    # rewrite one build.json into whoever finished last.
    (work / receipt_name).write_text(
        json.dumps({"plan": planned, "skeleton": skeleton_result,
                    "sections": results}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    counted = [r for r in results if r["status"] != "empty"]
    accepted = sum(1 for r in counted if r["status"] == "accepted")
    print(json.dumps({
        "status": "built" if accepted == len(counted) else "partial",
        "sections_accepted": accepted,
        "sections_total": len(counted),
        "receipt": str(work / receipt_name),
    }, ensure_ascii=False, indent=2))
    return 0 if accepted == len(counted) else 1


if __name__ == "__main__":
    sys.exit(main())
