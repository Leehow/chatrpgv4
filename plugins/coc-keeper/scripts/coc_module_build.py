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
from concurrent import futures
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))

import coc_module_graph as graph  # noqa: E402
import coc_module_graph_template as graph_template  # noqa: E402
import coc_module_graph_extract as extract  # noqa: E402
import coc_module_plan as planner  # noqa: E402


class Reader(Protocol):
    """How the host runs one reading agent over one prepared work dir.

    The agent is given the directory and a brief; it opens the packet itself,
    writes `shard.json` there across as many turns as it needs, and runs the
    review command on itself. It returns nothing: what it did is on disk, and
    the driver judges that, never the agent's account of it.

    Why an agent and not a completion: a single reply has to fit one assistant
    message, and on this project's channel that ceiling sits near 47,000
    characters. Everything the pipeline used to do about it -- four-page
    leaves, findings ferried in and out, a 70 KB packet pushed through the
    prompt -- was a patch on that limit. Measured against it: the same book,
    whole, in one agent session produced a 113,448-character shard, 68% of the
    section's spans cited, and a scene graph in one connected piece where the
    chunked pipeline left eight fragments and five scenes nothing could reach.
    """

    def __call__(self, work_dir: Path, brief: str) -> None: ...


# Kept for hosts that still inject a plain completion; the driver no longer
# uses it. See `Reader` for why.
class Ask(Protocol):
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


SHARD_NAME = "shard.json"
BRIEF_PATH = _HERE.parent / "pi" / "prompts" / "module-graph-agent-brief.md"


def review_command(work_dir: Path) -> str:
    """The self-check the agent runs on itself, exactly as it must be typed."""
    script = _HERE / "coc_module_graph_extract.py"
    return (
        "PYTHONDONTWRITEBYTECODE=1 uv run --frozen python "
        f"{script} review --work-dir {work_dir} "
        f"--model-output {work_dir / SHARD_NAME}"
    )


def build_brief(
    work_dir: Path,
    *,
    instruction_path: Path | None = None,
    repo_root: Path | None = None,
) -> str:
    """The agent's standing orders for one section, with its paths filled in."""
    template = BRIEF_PATH.read_text(encoding="utf-8")
    root = repo_root or _HERE.parents[2]
    return template.format(
        work_dir=work_dir,
        instruction_path=instruction_path or extract.INSTRUCTION_PATH,
        repo_root=root,
        review_command=review_command(work_dir),
        template_path=graph_template.TEMPLATE_PATH,
        query=(
            "PYTHONDONTWRITEBYTECODE=1 uv run --frozen python "
            f"{_HERE / 'coc_evidence_query.py'} "
            f"--packet {work_dir / 'extraction-packet.json'}"
        ),
    )


def _retry_brief(brief: str, findings: list[dict[str, Any]]) -> str:
    """The same orders, plus what the machine refused, verbatim.

    Verbatim because a paraphrase is where a loop starts optimising for the
    paraphrase. The agent has usually seen these already from its own review
    run; repeating them costs nothing and covers the case where it stopped
    before the gates were silent.
    """
    return brief + (
        "\n\n## 上一轮机器判定的结果（原样）\n\n"
        "你上次留下的 shard 没有通过。以下是机器给的 findings，照着改：\n\n"
        "```json\n" + json.dumps(findings, ensure_ascii=False, indent=2) + "\n```\n"
    )


def extract_section(
    work_dir: Path,
    read_with_agent: Reader,
    *,
    max_rounds: int = 3,
    instruction_path: Path | None = None,
    repo_root: Path | None = None,
) -> dict[str, Any]:
    """Have an agent read one prepared section, then judge what it wrote.

    The agent reviews itself -- that is most of the speed -- but the driver
    reviews it again from the file it left behind. An agent that reports
    success it did not have is exactly the failure this pipeline exists to
    catch, and the gates cost milliseconds.
    """
    brief = build_brief(work_dir, instruction_path=instruction_path,
                        repo_root=repo_root)
    shard_path = work_dir / SHARD_NAME
    rounds: list[Round] = []
    for attempt in range(1, max_rounds + 1):
        read_with_agent(work_dir, brief if attempt == 1 else _retry_brief(
            brief, rounds[-1].findings))
        if not shard_path.exists():
            finding = {"code": "agent_wrote_no_shard", "path": "/",
                       "message": f"the agent left no {SHARD_NAME} in {work_dir}"}
            rounds.append(Round(attempt, "findings", "shape", 1, [finding]))
            continue
        try:
            written = json.loads(shard_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            finding = {"code": "shard_not_json", "path": "/",
                       "message": f"{SHARD_NAME} does not parse: {error}"}
            rounds.append(Round(attempt, "findings", "shape", 1, [finding]))
            continue
        result = extract.review(work_dir, written)
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
    read_with_agent: Reader,
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
        work / "skeleton", read_with_agent, max_rounds=max_rounds,
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


# The skeleton names the book's people, places and factions once, at name
# level. Handing that list to every section is what keeps one cult from
# becoming two: a section that sees `faction-bloody-tongue` in `known_nodes`
# reuses it instead of minting `faction-cult-of-the-bloody-tongue-nyc`.
# 19 such splits were on record before this was wired.
_ROSTER_KINDS = ("npc", "creature", "faction", "organization", "location")


def _skeleton_roster(work: Path) -> list[dict[str, Any]]:
    """Name-level nodes the skeleton established, in the frozen known-node shape."""
    shard_path = work / "skeleton" / "accepted.shard.json"
    if not shard_path.exists():
        return []
    try:
        shard = json.loads(shard_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    roster: list[dict[str, Any]] = []
    seen: set[str] = set()
    for node in shard.get("nodes") or []:
        if not isinstance(node, dict) or node.get("node_kind") not in _ROSTER_KINDS:
            continue
        node_id = node.get("node_id")
        name = node.get("name")
        if not isinstance(node_id, str) or not isinstance(name, str) or node_id in seen:
            continue
        seen.add(node_id)
        roster.append({
            "node_id": node_id,
            "node_kind": node["node_kind"],
            "name": name,
            "visibility": node.get("visibility") or "keeper-only",
        })
    return roster


def _extract_ranged(
    bundle: Path,
    work: Path,
    module_id: str,
    section_id: str,
    pdf_index_start: int,
    pdf_index_end: int,
    read_with_agent: Reader,
    max_rounds: int,
    results: list[dict[str, Any]],
    _base_id: str | None = None,
    *,
    known_nodes: list[dict[str, Any]] | None = None,
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
        known_nodes=known_nodes,
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
    outcome = extract_section(
        work / section_id, read_with_agent, max_rounds=max_rounds,
    )
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


def _assemble(work: Path, results: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge the accepted section shards into the module's one graph.

    Reported, never raised: the sections are on disk either way, and a merge
    that refuses is telling the caller something specific -- two sections gave
    one entity different meanings under one id -- which belongs in the receipt
    next to the sections that produced it, not in a traceback.
    """
    # The skeleton is a shard like any other and it is where the book's roster
    # lives: the module node, the spine, the named people and places sections
    # reference rather than redefine. Leaving it out orphans every one of those
    # references -- one `unresolved_node_ref` refused a whole build that had
    # otherwise passed every gate.
    shard_paths = [work / "skeleton" / "accepted.shard.json"]
    shard_paths += [
        work / result["section_id"] / "accepted.shard.json"
        for result in results
        if result.get("status") == "accepted"
    ]
    shards = []
    for path in shard_paths:
        if path.exists():
            shards.append(json.loads(path.read_text(encoding="utf-8")))
    if not shards:
        return {"status": "nothing_to_assemble", "shards": 0}
    catalog: dict[str, dict[str, Any]] = {}
    for packet in work.rglob("evidence-packet.json"):
        try:
            evidence = json.loads(packet.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for span in evidence.get("spans") or []:
            if isinstance(span, dict) and isinstance(span.get("span_id"), str):
                catalog[span["span_id"]] = span
    try:
        merged = graph.merge_shards(shards, evidence_catalog=catalog)
    except graph.ModuleGraphError as error:
        return {
            "status": "conflicted",
            "shards": len(shards),
            "findings": getattr(error, "findings", []) or [],
        }
    except Exception as error:  # noqa: BLE001 - see below
        # Assembly runs after every section has been paid for. A malformed
        # catalog row surfacing here as a bare exception would throw away a
        # whole build's work at the last step, so it is reported like any
        # other refusal and the sections stay on disk.
        return {
            "status": "assembly_failed",
            "shards": len(shards),
            "findings": [{
                "code": "assembly_raised",
                "path": "/",
                "message": f"{type(error).__name__}: {error}",
            }],
        }
    out = work / "module-graph.json"
    node_ids = {node["node_id"] for node in merged.get("nodes") or []
                if isinstance(node, dict) and isinstance(node.get("node_id"), str)}
    dangling = sum(
        1 for relation in merged.get("relations") or []
        if isinstance(relation, dict) and (
            relation.get("from_node_id") not in node_ids
            or relation.get("to_node_id") not in node_ids
        )
    )
    # Merging is not finishing. The three gates judge one section against the
    # contract; nothing judged whether the assembled book can be played, and
    # that silence hid twenty-two structural defects in a build whose every
    # section was accepted -- a scene graph in eight pieces, twelve actors no
    # scene contained, and no entrance declared anywhere.
    # Where play opens is a fact about the book that only the skeleton is asked
    # for, and it lived nowhere afterwards: the scene nodes carried the mark and
    # the assembled graph had no field to put it in, so every graph failed
    # "no entrance declared" no matter what the skeleton found.
    entrances = sorted(
        node["node_id"] for node in merged.get("nodes") or []
        if isinstance(node, dict) and node.get("node_kind") == "scene"
        and isinstance(node.get("properties"), dict)
        and node["properties"].get("is_entrance")
        and isinstance(node.get("node_id"), str)
    )
    if entrances:
        merged["entry_scene_ids"] = entrances

    spans = sum(
        len(json.loads(packet.read_text(encoding="utf-8")).get("spans") or [])
        for packet in work.rglob("evidence-packet.json")
    ) or None
    out.write_text(json.dumps(merged, ensure_ascii=False), encoding="utf-8")
    playable = graph_template.check(merged, evidence_total=spans)
    return {
        "status": "assembled" if playable["status"] == "playable"
                  else "assembled_not_playable",
        "shards": len(shards),
        "nodes": len(merged.get("nodes") or []),
        "relations": len(merged.get("relations") or []),
        "dangling_relations": dangling,
        "template": {
            "status": playable["status"],
            "finding_counts": playable["finding_counts"],
            "measures": playable["measures"],
        },
        "findings": playable["findings"],
        "path": str(out),
    }


# The relation kinds the campaign projection turns into a scene exit. A scene
# joined to the graph by none of them is in the book and out of the game: the
# Keeper has no move that reaches it.
_SCENE_EDGE_KINDS = ("play-precedes", "may-lead-to", "alternative-to", "hands-off-to")


def _unreachable_scenes(merged: dict[str, Any]) -> list[str]:
    """Scenes no exit leads to and none leads out of.

    Reported, not refused. Measured on the short module: five of twenty-six,
    and every one of them sat in a shard whose other scenes were well
    connected -- two were the branches of a decision on the same page. So this
    is the model omitting an edge, not a section unable to see across its own
    boundary, and the number belongs where a caller will read it.
    """
    scenes = {
        node["node_id"] for node in merged.get("nodes") or []
        if isinstance(node, dict) and node.get("node_kind") == "scene"
        and isinstance(node.get("node_id"), str)
    }
    joined: set[str] = set()
    for relation in merged.get("relations") or []:
        if not isinstance(relation, dict):
            continue
        if relation.get("relation_kind") not in _SCENE_EDGE_KINDS:
            continue
        for end in ("from_node_id", "to_node_id"):
            if relation.get(end) in scenes:
                joined.add(relation[end])
    return sorted(scenes - joined)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--adapter", required=True,
        help=(
            "import path of a module exposing `read_with_agent(work_dir, brief)` "
             "and `ask(instruction, payload)` for the planning step. "
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
        "--max-leaf-pages", type=int, default=0,
        help="pre-split sections past this many pages; 0 (the default) does "
             "not split. Four was the old default, chosen so one reply would "
             "fit one assistant message -- a limit an agent writing to a file "
             "does not have. Measured since: an eighteen-page book read whole "
             "gave a 113k-character shard, 68%% of its spans cited, and one "
             "connected scene graph, where four-page leaves left eight "
             "fragments and five scenes nothing could reach. Set it only when "
             "a section proves too large for one session",
    )
    parser.add_argument(
        "--workers", type=int, default=6,
        help="chunks extracted concurrently; each worker holds its own model "
             "session, so this is bounded by the channel, not by CPU. Eight "
             "concurrent sessions answered with no failures and a 7.6x "
             "speedup, but on short prompts; six is what a build defaults to "
             "until that holds for full extractions too",
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
    read_with_agent: Reader = adapter.read_with_agent

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
        planned = plan_module(bundle, adapter.ask, budget=args.budget,
                              max_rounds=args.max_rounds)
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
            bundle, work, args.module_id, planned, read_with_agent,
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

    # The roster the skeleton established, handed to every section so they
    # name the book's people and places the same way. Without it each section
    # mints its own id for the same cult and the book merges as two cults.
    roster = _skeleton_roster(work) if skeleton_result else []

    chunks: list[tuple[str, int, int]] = []
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
        if args.max_leaf_pages and end - start + 1 > args.max_leaf_pages:
            spread = [
                (chunk_start, min(chunk_start + args.max_leaf_pages - 1, end))
                for chunk_start in range(start, end + 1, args.max_leaf_pages)
            ]
        else:
            spread = [(start, end)]
        for chunk_start, chunk_end in spread:
            chunk_id = (
                sid if (chunk_start, chunk_end) == (start, end)
                else f"{sid}-p{chunk_start}-{chunk_end}"
            )
            chunks.append((chunk_id, chunk_start, chunk_end))

    # Chunks are independent: each reads its own pages and writes its own work
    # dir, and the roster they share is fixed before any of them starts. The
    # cost of a build is generation time, so running them one at a time spends
    # hours waiting on a channel that answers several at once.
    results: list[dict[str, Any]] = []
    per_chunk: list[list[dict[str, Any]]] = [[] for _ in chunks]

    def _run(index: int) -> None:
        chunk_id, chunk_start, chunk_end = chunks[index]
        _extract_ranged(
            bundle, work, args.module_id, chunk_id, chunk_start, chunk_end,
            read_with_agent, args.max_rounds, per_chunk[index],
                known_nodes=roster,
        )

    workers = max(1, min(args.workers, len(chunks)))
    if workers == 1 or len(chunks) <= 1:
        for index in range(len(chunks)):
            _run(index)
    else:
        with futures.ThreadPoolExecutor(max_workers=workers) as pool:
            for future in futures.as_completed(
                [pool.submit(_run, index) for index in range(len(chunks))]
            ):
                future.result()
    # Reported in plan order, not completion order, so two runs of the same
    # book produce the same receipt.
    for collected in per_chunk:
        results.extend(collected)
    # Whatever channels the host opened are the host's to close, once, here --
    # not after each chunk, which would respawn a session for the next one.
    closer = getattr(sys.modules.get(getattr(read_with_agent, "__module__", "")),
                     "close_sessions", None)
    if callable(closer):
        closer()

    # Sections that pass the gates are still N graphs until they are merged.
    # A build that stops at N shards has not built anything a campaign can be
    # projected from, and the failure mode is quiet: the receipt says every
    # section was accepted while no module graph exists.
    assembly = _assemble(work, results) if not args.only_section else None

    receipt_name = (
        f"build.{args.only_section}.json" if args.only_section else "build.json"
    )
    # A --only-section worker shares its work dir with the other sections of
    # the same module; its receipt is its own, or forty-two workers would
    # rewrite one build.json into whoever finished last.
    (work / receipt_name).write_text(
        json.dumps({"plan": planned, "skeleton": skeleton_result,
                    "sections": results, "assembly": assembly},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    counted = [r for r in results if r["status"] != "empty"]
    accepted = sum(1 for r in counted if r["status"] == "accepted")
    whole = accepted == len(counted) and (
        assembly is None or assembly["status"] == "assembled"
    )
    print(json.dumps({
        "status": "built" if whole else "partial",
        "sections_accepted": accepted,
        "sections_total": len(counted),
        "assembly": assembly and {k: v for k, v in assembly.items()
                                  if k != "findings"},
        "receipt": str(work / receipt_name),
    }, ensure_ascii=False, indent=2))
    return 0 if whole else 1


if __name__ == "__main__":
    sys.exit(main())
