"""`table.warn` — the verifier lane's findings (contract §12.5), all advisory.

The only anchor is deterministic: a finding's `quote` must be a substring of that
turn's `rendered_text`. A finding that does not anchor is dropped and counted, never
guessed at. Nothing here changes state, blocks a delivery or reopens a turn."""

from __future__ import annotations

from typing import Any

from .errors import invalid_params
from .store import Campaign, now_iso

LANES = ("verifier",)
FINDING_KINDS = ("reveal", "uncommitted_state", "player_agency")
MAX_FINDINGS = 10
QUOTE_CHARS = 120
WHY_CHARS = 200
WARNINGS_BUDGET = 1024


def warn(campaign: Campaign, params: dict[str, Any]) -> dict[str, Any]:
    turn = params.get("turn")
    if not isinstance(turn, int) or isinstance(turn, bool) or turn < 0:
        raise invalid_params("params.turn must be a committed turn number")
    lane = params.get("lane")
    if lane not in LANES:
        raise invalid_params(f"unknown lane {lane!r}", fix=f"one of {list(LANES)}")
    findings = params.get("findings")
    if not isinstance(findings, list):
        raise invalid_params("params.findings must be a list")
    record = campaign.read_turn_record(turn)
    if record is None or record.get("closed_by") != "narrate":
        raise invalid_params(f"turn {turn} has no narrate record to anchor findings to",
                             details={"turn": turn})
    rendered = str(record.get("rendered_text") or "")
    accepted: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []
    for index, finding in enumerate(findings):
        if not isinstance(finding, dict):
            raise invalid_params(f"findings[{index}] must be an object", details={"index": index})
        kind = finding.get("kind")
        if kind not in FINDING_KINDS:
            raise invalid_params(f"findings[{index}].kind {kind!r} is not a finding kind",
                                 fix=f"one of {list(FINDING_KINDS)}", details={"index": index})
        quote = finding.get("quote")
        why = finding.get("why")
        if not isinstance(quote, str) or not quote.strip() or quote not in rendered:
            dropped.append({"index": index, "kind": kind, "reason": "quote is not a substring of rendered_text"})
            continue
        if len(accepted) >= MAX_FINDINGS:
            dropped.append({"index": index, "kind": kind, "reason": f"more than {MAX_FINDINGS} findings"})
            continue
        accepted.append({"lane": lane, "kind": kind, "quote": quote[:QUOTE_CHARS],
                         "why": str(why or "")[:WHY_CHARS], "at": now_iso()})
    warnings = list(record.get("warnings") or [])
    warnings.extend(accepted)
    record["warnings"] = warnings
    campaign.write_turn_record(record)
    campaign.append_telemetry({"lane": lane, "turn": turn, "ok": True, "findings": len(findings),
                               "accepted": len(accepted), "dropped": len(dropped)})
    return {"turn": turn, "lane": lane, "accepted": len(accepted), "dropped": dropped,
            "warnings": [{"kind": w["kind"], "quote": w["quote"], "why": w["why"]} for w in warnings]}


def latest_warnings(campaign: Campaign, before_turn: int) -> list[dict[str, Any]]:
    """The capsule's `warnings`: findings on the most recent narrate-closed turn before
    the current one (§12.5: only the latest committed turn's)."""
    records = campaign.turn_records_by_number()
    for number in sorted(records, reverse=True):
        record = records[number]
        if number >= before_turn or record.get("closed_by") != "narrate":
            continue
        return [{"turn": number, "kind": w.get("kind"), "quote": w.get("quote"), "why": w.get("why")}
                for w in record.get("warnings") or []]
    return []
