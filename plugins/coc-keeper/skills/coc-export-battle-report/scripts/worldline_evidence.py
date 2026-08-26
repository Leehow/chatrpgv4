#!/usr/bin/env python3
"""Worldline / fork / confluence / transfer evidence projection.

Read-only consumer of preserved campaign evidence used by the sole canonical
battle-report exporter. Everything projected here was persisted by earlier
play through canonical tools:

- ``save/timeline-state.json`` — Git timeline DAG registry
  (schema ``timeline-state-1``: timelines, active pointer, confluence
  records with per-conflict disposition receipts);
- ``memory/temporal/transfers.jsonl`` — authoritative cross-timeline
  transfer events, when the integration wave persisted them;
- ``memory/temporal/assertions.jsonl`` — temporal memory rows, whose
  ``cross_timeline_echo`` records are the derived character memories.

This module never runs git, never opens the sidecar repository, and never
infers a commit, roll, conflict value, or disposition from prose. Missing or
malformed provenance becomes an explicit completeness finding; projections
always carry explicit zero counts instead of vacuous omission.

Privacy boundary (deterministic code, not judgement): semantic structural
labels (timeline ids, disposition modes, receipt names, classes, fidelity
states) and numeric mechanics are player-safe; raw conflict side values,
KP-authored free-text reasons/notes/causes, and any ``keeper_only`` entry
content stay in the audit projection only.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping

_SCRIPT_DIR = Path(__file__).resolve().parent

TIMELINE_STATE_RELPATH = "save/timeline-state.json"
ASSERTIONS_RELPATH = "memory/temporal/assertions.jsonl"
TRANSFERS_RELPATH = "memory/temporal/transfers.jsonl"

TIMELINE_STATE_SCHEMA = "timeline-state-1"
ROOT_TIMELINE_ID = "tl-main"
ECHO_STATE = "cross_timeline_echo"
_ABSENT_SIDE_VALUE = {"absent": True}

_CONTRACT_MODULE: Any = None


def _contract() -> Any:
    """Read-only access to the frozen ``temporal-memory-1`` contracts.

    Canonical caller: every validator invocation below. Read-only use keeps
    this projector byte-consistent with the write side; the contract module
    itself is never modified here.
    """
    global _CONTRACT_MODULE
    if _CONTRACT_MODULE is None:
        scripts_dir = Path(__file__).resolve().parents[3] / "scripts"
        if str(scripts_dir) not in sys.path:
            sys.path.insert(0, str(scripts_dir))
        import coc_temporal_memory_contract

        _CONTRACT_MODULE = coc_temporal_memory_contract
    return _CONTRACT_MODULE


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _absent_side(side: Any) -> bool:
    """One-sided conflicts mark their missing side inside ``value``."""
    if not isinstance(side, Mapping):
        return False
    value = side.get("value")
    return isinstance(value, Mapping) and dict(value) == _ABSENT_SIDE_VALUE


def _side_value(row: Any, key: str) -> Any:
    side = row.get(key) if isinstance(row, Mapping) else None
    return side.get("value") if isinstance(side, Mapping) else None


def _side_timeline(row: Any, key: str, fallback: Any) -> Any:
    side = row.get(key) if isinstance(row, Mapping) else None
    value = side.get("timeline") if isinstance(side, Mapping) else None
    return value if isinstance(value, str) and value.strip() else fallback


def _mode_histogram(items: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    histogram: dict[str, int] = {}
    for item in items:
        mode = str(item.get("mode") or "")
        if mode:
            histogram[mode] = histogram.get(mode, 0) + 1
    return dict(sorted(histogram.items()))


def _parsed_cost_envelope(record: Mapping[str, Any]) -> tuple[str | None, list[Any], str | None]:
    """Rebuild the durable ``{"cause": ..., "costs": [...]}`` envelope.

    Returns ``(cause, costs, error)``; error text replaces the envelope when
    the record's play_cost field is malformed (a provenance finding upstream).
    """
    raw = record.get("play_cost")
    try:
        envelope = json.loads(raw) if isinstance(raw, str) else None
    except (TypeError, ValueError):
        envelope = None
    if not isinstance(envelope, dict) or set(envelope) != {"cause", "costs"}:
        return None, [], "play_cost must be the canonical {cause, costs} JSON envelope"
    cause = envelope.get("cause")
    costs = envelope.get("costs")
    if not isinstance(cause, str) or not cause.strip():
        return None, [], "play_cost envelope cause must be non-empty"
    if not isinstance(costs, list):
        return None, [], "play_cost envelope costs must be a list"
    return cause, costs, None


def _zero_counts() -> dict[str, int]:
    return {
        "timelines": 0,
        "root_timelines": 0,
        "forks": 0,
        "confluence_timelines": 0,
        "confluences": 0,
        "conflicts": 0,
        "dispositions_with_resolver_receipt": 0,
        "transfer_events": 0,
        "transfer_entries": 0,
        "keeper_only_transfer_entries": 0,
        "echo_assertions": 0,
    }


# ---------------------------------------------------------------------------
# Section builders
# ---------------------------------------------------------------------------


def _project_timelines(
    timelines: list[Any], findings: list[str]
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for record in timelines:
        if not isinstance(record, Mapping):
            findings.append("timeline-state contains a non-object timeline record")
            continue
        timeline = record.get("timeline_id")
        kind = record.get("kind")
        parents = record.get("parents")
        fork_point = record.get("fork_point")
        fork_turn = (
            fork_point.get("turn")
            if isinstance(fork_point, Mapping) and isinstance(fork_point.get("turn"), int)
            else None
        )
        rows.append(
            {
                "timeline": timeline if isinstance(timeline, str) else "",
                "kind": kind if isinstance(kind, str) else "",
                "parent": (
                    parents[0]
                    if isinstance(parents, list) and len(parents) >= 1
                    and isinstance(parents[0], str) and kind != ROOT_TIMELINE_ID
                    else None
                ),
                "fork_turn": fork_turn,
            }
        )
    return rows


def _project_confluences(
    confluences: list[Any], findings: list[str]
) -> list[dict[str, Any]]:
    projected: list[dict[str, Any]] = []
    for record in confluences:
        if not isinstance(record, Mapping):
            findings.append("timeline-state contains a non-object confluence record")
            continue
        conflicts_raw = record.get("conflicts")
        if not isinstance(conflicts_raw, list):
            conflicts_raw = []
            findings.append(
                "confluence "
                f"{record.get('confluence_id')!r} carries a non-list conflicts field"
            )
        items: list[dict[str, Any]] = []
        for conflict in conflicts_raw:
            if not isinstance(conflict, Mapping):
                findings.append(
                    "confluence "
                    f"{record.get('confluence_id')!r} carries a non-object conflict"
                )
                continue
            disposition = conflict.get("disposition")
            left = conflict.get("left") if isinstance(conflict.get("left"), Mapping) else {}
            right = conflict.get("right") if isinstance(conflict.get("right"), Mapping) else {}
            merged_timeline = record.get("timeline_id")
            items.append(
                {
                    "conflict": conflict.get("conflict_id"),
                    "class": conflict.get("class"),
                    "left": _side_timeline(conflict, "left", merged_timeline),
                    "right": _side_timeline(conflict, "right", merged_timeline),
                    "left_absent": _absent_side(left),
                    "right_absent": _absent_side(right),
                    "mode": (
                        disposition.get("mode")
                        if isinstance(disposition, Mapping) else None
                    ),
                    "receipt": (
                        disposition.get("receipt")
                        if isinstance(disposition, Mapping) else None
                    ),
                    "resolver_receipt": (
                        disposition.get("resolver_receipt") or None
                        if isinstance(disposition, Mapping) else None
                    ),
                    "note_present": bool(
                        isinstance(disposition, Mapping)
                        and str(disposition.get("note") or "").strip()
                    ),
                }
            )
        projected.append(
            {
                "confluence": record.get("confluence_id"),
                "merged": record.get("timeline_id"),
                "parents": [
                    parent
                    for parent in (
                        record.get("parents") if isinstance(record.get("parents"), list) else []
                    )
                    if isinstance(parent, str)
                ],
                "conflicts_resolved": len(items),
                "modes": _mode_histogram(items),
                "items": items,
            }
        )
    return projected


def _project_transfers(
    rows: list[Any], *, transfers_present: bool, findings: list[str]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Project authoritative transfer events into (player, audit, conceal)."""
    players: list[dict[str, Any]] = []
    audits: list[dict[str, Any]] = []
    concealed: list[str] = []
    for source_line, row in enumerate(rows or [], start=1):
        if not isinstance(row, Mapping):
            findings.append(
                f"transfer store row {source_line} is not an object; provenance is malformed"
            )
            continue
        try:
            _contract().validate_transfer(dict(row))
        except Exception as exc:  # noqa: BLE001 - fail loud via finding
            findings.append(
                f"transfer record at store row {source_line} failed canonical "
                f"validation: {exc}"
            )
            continue
        cause, costs, envelope_error = _parsed_cost_envelope(row)
        if envelope_error:
            findings.append(
                f"transfer {row.get('transfer_id')!r}: {envelope_error}"
            )
        entries = row.get("entries") if isinstance(row.get("entries"), list) else []
        player_items: list[dict[str, Any]] = []
        audit_items: list[dict[str, Any]] = []
        cost_kinds: list[dict[str, Any]] = []
        for entry in entries:
            privacy = entry.get("privacy")
            safe_entry = privacy != "keeper_only"
            player_items.append(
                {
                    "fidelity": entry.get("state"),
                    "credibility": entry.get("credibility"),
                    "distortion": entry.get("distortion") if safe_entry else None,
                    "privacy": privacy,
                }
            )
            if not safe_entry:
                for key in ("target_assertion", "source_assertion"):
                    identifier = entry.get(key)
                    if isinstance(identifier, str) and identifier.strip():
                        concealed.append(identifier)
            audit_items.append(dict(entry))
        for cost in costs if isinstance(costs, list) else []:
            if isinstance(cost, Mapping) and cost.get("kind"):
                amount = cost.get("amount")
                cost_kinds.append({"kind": cost.get("kind"), "amount": amount})
        players.append(
            {
                "transfer": row.get("transfer_id"),
                "source": row.get("from_timeline"),
                "target": row.get("to_timeline"),
                "anchor_turn": row.get("source_turn"),
                "entries": len(entries),
                "costs": cost_kinds,
                "items": player_items,
            }
        )
        audits.append(
            {
                "record": dict(row),
                "cause": cause,
                "entries": audit_items,
                "envelope_error": envelope_error,
            }
        )
    return players, audits, concealed


def _echo_scan_all(rows: list[Any]) -> list[Any]:
    return list(rows or [])


def _echo_rows(rows: list[Any]) -> list[tuple[int, Mapping[str, Any]]]:
    selected: list[tuple[int, Mapping[str, Any]]] = []
    for source_line, row in enumerate(rows or [], start=1):
        if not isinstance(row, Mapping):
            continue
        if row.get("state") == ECHO_STATE or row.get("transfer_ref"):
            selected.append((source_line, row))
    return selected


def _project_echoes(
    rows: list[Any],
    *,
    assertions_present: bool,
    known_timeline_ids: set[str] | None,
    transfers_by_id: dict[str, Mapping[str, Any]],
    findings: list[str],
) -> tuple[dict[str, Any], list[dict[str, Any]], list[str]]:
    """Project echo assertions into (player summary, audit rows, conceal)."""
    echoes = _echo_rows(rows)
    by_fidelity: dict[str, int] = {}
    claimed_events: dict[str, list[str]] = {}
    target_ids: set[str] = set()
    audit_rows: list[dict[str, Any]] = []
    concealed: list[str] = []
    malformed_lines: list[int] = []
    for source_line, row in echoes:
        try:
            _contract().validate_assertion(dict(row))
        except Exception as exc:  # noqa: BLE001 - fail loud via finding
            findings.append(
                f"echo assertion at assertions store row {source_line} failed "
                f"canonical validation: {exc}"
            )
            malformed_lines.append(source_line)
            continue
        timeline = row.get("timeline_id")
        if (
            known_timeline_ids is not None
            and isinstance(timeline, str)
            and timeline
            and timeline not in known_timeline_ids
        ):
            findings.append(
                f"echo assertion {row.get('assertion_id')!r} claims unknown "
                f"timeline {timeline!r}"
            )
        fidelity = str(row.get("state") or "")
        by_fidelity[fidelity] = by_fidelity.get(fidelity, 0) + 1
        transfer_ref = row.get("transfer_ref")
        if isinstance(transfer_ref, str) and transfer_ref:
            claimed_events.setdefault(transfer_ref, []).append(str(row.get("assertion_id")))
        identifier = row.get("assertion_id")
        if row.get("privacy") == "keeper_only" and isinstance(identifier, str):
            concealed.append(identifier)
        audit_rows.append(dict(row))
        if isinstance(identifier, str) and identifier:
            target_ids.add(identifier)
    for event_id, claimants in sorted(claimed_events.items()):
        event = transfers_by_id.get(event_id)
        if event is None:
            findings.append(
                f"{len(claimants)} echo assertion(s) claim transfer event "
                f"{event_id!r}, which has no authoritative transfer record"
            )
            continue
    for event_id in sorted(transfers_by_id):
        event = transfers_by_id[event_id]
        for entry in (
            event.get("entries") if isinstance(event.get("entries"), list) else []
        ):
            if not isinstance(entry, Mapping):
                continue
            expected = entry.get("target_assertion")
            if isinstance(expected, str) and expected and expected not in target_ids:
                findings.append(
                    f"transfer {event_id!r} expects derived echo assertion "
                    f"{expected!r}, which is missing from the assertion store"
                )
    summary = {
        "store": bool(assertions_present),
        "count": len(echoes) - len(malformed_lines),
        "total_claiming_rows": len(echoes),
        "by_fidelity": dict(sorted(by_fidelity.items())),
    }
    return summary, audit_rows, concealed


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def build_worldline_evidence(
    *,
    state_doc: Any = None,
    state_present: bool = False,
    state_error: str | None = None,
    assertions_rows: list[Any] | None = None,
    assertions_present: bool = False,
    assertions_error: str | None = None,
    transfers_rows: list[Any] | None = None,
    transfers_present: bool = False,
    transfers_error: str | None = None,
) -> dict[str, Any]:
    """Project preserved worldline evidence into player-safe + audit parts.

    Returns ``{"player": <section>, "audit": <section>, "findings": [...],
    "concealed_ids": [...]}``. Deterministic: pure function of the given
    documents, no clock, no git access. ``*_error`` marks a preserved
    source file that exists but cannot be parsed as canonical evidence;
    that is provenance damage, reported as a finding — never inferred past.
    """
    findings: list[str] = []
    if state_present and state_error:
        findings.append(
            f"{TIMELINE_STATE_RELPATH} exists but cannot be read as "
            f"canonical evidence: {state_error}"
        )
    if assertions_present and assertions_error:
        findings.append(
            f"{ASSERTIONS_RELPATH} exists but cannot be read as "
            f"canonical evidence: {assertions_error}"
        )
    if transfers_present and transfers_error:
        findings.append(
            f"{TRANSFERS_RELPATH} exists but cannot be read as "
            f"canonical evidence: {transfers_error}"
        )
    timelines_list: list[Any] = []
    confluences_list: list[Any] = []
    game_reasons: dict[str, Any] = {}
    known_timeline_ids: set[str] | None = None
    active_timeline: str | None = None
    schema_generation_ok = True
    timeline_rows: list[dict[str, Any]] = []
    confluence_sections: list[dict[str, Any]] = []

    if state_present:
        if state_error:
            pass
        elif not isinstance(state_doc, Mapping):
            findings.append("timeline-state.json must contain a JSON object")
        else:
            generation = state_doc.get("schema_generation")
            if generation != TIMELINE_STATE_SCHEMA:
                schema_generation_ok = False
                findings.append(
                    f"timeline-state.json schema_generation must be "
                    f"{TIMELINE_STATE_SCHEMA!r}, got {generation!r}"
                )
            raw_timelines = state_doc.get("timelines")
            raw_confluences = state_doc.get("confluences")
            if not isinstance(raw_timelines, list):
                findings.append("timeline-state.json timelines must be a list")
            else:
                timelines_list = raw_timelines
            if not isinstance(raw_confluences, list):
                findings.append("timeline-state.json confluences must be a list")
            else:
                confluences_list = raw_confluences
            reasons = state_doc.get("game_reasons")
            if isinstance(reasons, dict):
                game_reasons = dict(reasons)
            active = state_doc.get("active_timeline_id")
            active_timeline = active if isinstance(active, str) and active else None
            known_timeline_ids = {
                str(record.get("timeline_id"))
                for record in timelines_list
                if isinstance(record, Mapping) and record.get("timeline_id")
            }
            contract = _contract()
            try:
                contract.validate_timeline_set(
                    [dict(item) for item in timelines_list if isinstance(item, Mapping)],
                    active_timeline_id=active_timeline,
                )
            except Exception as exc:  # noqa: BLE001 - surfaced as finding
                findings.append(
                    f"timeline-state.json failed canonical DAG validation: {exc}"
                )
            for index, record in enumerate(confluences_list, start=1):
                if not isinstance(record, Mapping):
                    findings.append(
                        f"confluence record #{index} in timeline-state.json is "
                        "not an object; provenance is malformed"
                    )
                    continue
                try:
                    contract.validate_confluence(dict(record))
                except Exception as exc:  # noqa: BLE001 - surfaced as finding
                    findings.append(
                        "confluence record "
                        f"{record.get('confluence_id') or ('#' + str(index))} "
                        f"failed canonical validation: {exc}"
                    )
            timeline_rows = _project_timelines(timelines_list, findings)
            confluence_sections = _project_confluences(confluences_list, findings)

    transfer_players, transfer_audits, transfer_conceal = _project_transfers(
        transfers_rows or [],
        transfers_present=transfers_present,
        findings=findings,
    )
    transfers_by_id = {
        str(audit["record"].get("transfer_id")): audit["record"]
        for audit in transfer_audits
        if isinstance(audit.get("record"), Mapping) and audit["record"].get("transfer_id")
    }
    echo_summary, echo_audit_rows, echo_conceal = _project_echoes(
        assertions_rows or [],
        assertions_present=assertions_present,
        known_timeline_ids=known_timeline_ids,
        transfers_by_id=transfers_by_id,
        findings=findings,
    )

    counts = _zero_counts()
    counts["timelines"] = len(timeline_rows)
    counts["root_timelines"] = sum(1 for row in timeline_rows if row["kind"] == "root")
    counts["forks"] = sum(1 for row in timeline_rows if row["kind"] == "fork")
    counts["confluence_timelines"] = sum(
        1 for row in timeline_rows if row["kind"] == "confluence"
    )
    counts["confluences"] = len(confluence_sections)
    counts["conflicts"] = sum(section["conflicts_resolved"] for section in confluence_sections)
    counts["dispositions_with_resolver_receipt"] = sum(
        1
        for section in confluence_sections
        for item in section["items"]
        if item.get("resolver_receipt")
    )
    counts["transfer_events"] = len(transfer_players)
    counts["transfer_entries"] = sum(entry["entries"] for entry in transfer_players)
    counts["keeper_only_transfer_entries"] = sum(
        1
        for audit in transfer_audits
        for entry in audit["entries"]
        if entry.get("privacy") == "keeper_only"
    )
    counts["echo_assertions"] = echo_summary["count"]

    player_section = {
        "present": state_present and schema_generation_ok,
        "source_present": bool(state_present),
        "counts": counts,
        "active_timeline": active_timeline,
        "timelines": timeline_rows,
        "forks": [row for row in timeline_rows if row["kind"] == "fork"],
        "confluences": confluence_sections,
        "transfers": transfer_players,
        "echoes": echo_summary,
    }
    audit_section = {
        "sources": {
            TIMELINE_STATE_RELPATH: {
                "present": bool(state_present),
                "readable": state_error is None if state_present else None,
                "error": state_error,
            },
            ASSERTIONS_RELPATH: {
                "present": bool(assertions_present),
                "readable": assertions_error is None if assertions_present else None,
                "error": assertions_error,
            },
            TRANSFERS_RELPATH: {
                "present": bool(transfers_present),
                "readable": transfers_error is None if transfers_present else None,
                "error": transfers_error,
            },
        },
        "findings": list(findings),
        "game_reasons": game_reasons,
        "timelines": timelines_list,
        "confluences": confluences_list,
        "transfers": transfer_audits,
        "echo_assertions": echo_audit_rows,
        "concealed_player_only_ids": sorted(set(transfer_conceal) | set(echo_conceal)),
    }
    return {
        "player": player_section,
        "audit": audit_section,
        "findings": findings,
        "concealed_ids": sorted(set(transfer_conceal) | set(echo_conceal)),
    }
