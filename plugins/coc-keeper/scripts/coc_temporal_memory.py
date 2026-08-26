#!/usr/bin/env python3
"""Temporal episode/assertion facade for campaign memory.

Canonical store is rebuildable JSONL under ``memory/temporal/``. Git tracks
those files; any SQLite/index is a later projection. Memory is advisory:
``state.*`` / ``rules.*`` stay authoritative. This module never deletes an
assertion; supersession closes valid-time and writes an edge.

Clean-slate schema generation ``temporal-memory-1``. Runtime reads only this
store. Legacy Markdown cards are not consulted here.

Standing API (campaign persistence is keyword-only so the brief positional
surface stays model-facing and semantic):

- ``record_turn_episode(root, campaign_id, timeline_id, turn_number, ...)``
  — model-facing episode recording; the finalized turn commit is resolved
  internally from semantic campaign/timeline/turn and attached by code
- ``record_assertion(assertion)``
- ``recall(subject, context)``
- ``adjudicate_candidate(decision_id, candidate_id, action)``
- ``resolve_hook(memory_id, resolution, decision_id)``
- ``build_resume_projection(campaign_id, turn_number)``

Machine-internal surfaces (commit shas are machine integrity evidence;
models never transcribe them):

- ``resolve_turn_commit(root, campaign_id, timeline_id, turn_number)``
- ``record_episode(commit_sha, timeline_id, turn_number, ...)`` — low-level
  commit-bound writer for callers (e.g. the commit coordinator) that
  already hold the finalized turn commit sha
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_temporal_memory_contract as contract

SCHEMA_GENERATION = contract.SCHEMA_GENERATION
UNBOUND_COMMIT = "0" * 40
TEMPORAL_DIRNAME = "memory/temporal"
AUTHORITY = "advisory"

ADJUDICATION_ACTIONS: tuple[str, ...] = ("accept", "modify", "reject")
HOOK_RESOLUTIONS: tuple[str, ...] = ("resolved", "paid_off", "abandoned")
HOOK_KINDS: tuple[str, ...] = ("unresolved_hook", "foreshadowing")
DEFAULT_PLAYER_SLUG = "table"
DEFAULT_KEEPER_SLUG = "table"
_SLUG_RE = re.compile(r"[^a-z0-9]+")
_TURN_RE = re.compile(r"(\d+)$")

_FILES = {
    "schema": "schema.json",
    "subjects": "subjects.jsonl",
    "entities": "entities.jsonl",
    "episodes": "episodes.jsonl",
    "episode_evidence": "episode-evidence.jsonl",
    "assertions": "assertions.jsonl",
    "hooks": "hooks.jsonl",
    "adjudications": "adjudications.jsonl",
    "backlog": "backlog.jsonl",
}

_ASSERTION_OPTIONAL: dict[str, Any] = {
    "knowers": (),
    "entities": (),
    "occurred_turn": None,
    "valid_until_turn": None,
    "superseded_by": (),
    "contradicts": (),
    "confirms": (),
    "covers_commits": (),
    "transfer_ref": None,
    "campaign_id": None,
    "timeline_id": None,
}


class TemporalMemoryError(ValueError):
    """Facade-level error (missing store path, unknown hook, bad action)."""


# ---------------------------------------------------------------------------
# Paths / JSONL
# ---------------------------------------------------------------------------


def temporal_dir(campaign_dir: Path | str) -> Path:
    return Path(campaign_dir) / "memory" / "temporal"


def _path(campaign_dir: Path | str, key: str) -> Path:
    return temporal_dir(campaign_dir) / _FILES[key]


def _require_campaign_dir(campaign_dir: Path | str | None) -> Path:
    if campaign_dir is None:
        raise TemporalMemoryError("campaign_dir is required")
    return Path(campaign_dir)


def ensure_store(campaign_dir: Path | str) -> Path:
    """Create the temporal store and schema marker. Idempotent."""
    root = temporal_dir(campaign_dir)
    root.mkdir(parents=True, exist_ok=True)
    schema_path = root / _FILES["schema"]
    if not schema_path.exists():
        schema_path.write_text(
            json.dumps(
                {
                    "schema_generation": SCHEMA_GENERATION,
                    "authority": AUTHORITY,
                    "hard_gate": False,
                },
                sort_keys=True,
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
    return root


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text:
            continue
        payload = json.loads(text)
        if isinstance(payload, dict):
            rows.append(payload)
    return rows


def _append_jsonl(path: Path, record: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    with path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def _load_latest(path: Path, id_field: str) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for row in _read_jsonl(path):
        key = row.get(id_field)
        if isinstance(key, str) and key:
            latest[key] = row
    return latest


def _closed(record: Mapping[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    return {key: record.get(key) for key in fields}


def _sha256_text(text: str | None) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def _slugify(value: str) -> str:
    text = _SLUG_RE.sub("-", str(value).strip().lower()).strip("-")
    if text:
        return text[:80]
    digest = hashlib.sha256(str(value).encode("utf-8")).hexdigest()[:12]
    return f"x{digest}"


def _prefixed_id(prefix: str, value: str) -> str:
    """Semantic id from a namespace prefix + slugged tail.

    The slug tail is bounded by the remaining id budget so the finished id
    never exceeds ``_MAX_ID_LEN`` through blind slicing — truncation cannot
    silently merge two distinct decisions. Callers still enforce an
    explicit collision check bound to the originating decision.
    """
    budget = contract._MAX_ID_LEN - len(prefix)
    if budget < 8:
        raise TemporalMemoryError(
            f"semantic id prefix {prefix!r} leaves no room for a slug tail"
        )
    text = _SLUG_RE.sub("-", str(value).strip().lower()).strip("-")
    if text:
        return prefix + text[:budget]
    digest = hashlib.sha256(str(value).encode("utf-8")).hexdigest()[:12]
    return prefix + f"x{digest}"[:budget]


def _parse_turn(value: Any, default: int = 0) -> int:
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    if isinstance(value, str):
        match = _TURN_RE.search(value.strip())
        if match:
            return int(match.group(1))
    return default


def _campaign_id_of(campaign_dir: Path, explicit: str | None = None) -> str:
    if explicit:
        return explicit
    return campaign_dir.name


# ---------------------------------------------------------------------------
# Subjects / entities
# ---------------------------------------------------------------------------


def _write_subject(campaign_dir: Path, record: dict[str, Any]) -> dict[str, Any]:
    payload = _closed(record, contract.SUBJECT_FIELDS)
    if payload.get("same_subject_as") is None:
        payload["same_subject_as"] = []
    contract.validate_subject(payload)
    existing = _load_latest(_path(campaign_dir, "subjects"), "subject_id")
    prior = existing.get(payload["subject_id"])
    if prior is not None:
        if contract.record_digest(prior) == contract.record_digest(payload):
            return prior
        if not contract.is_sanctioned_identity_extension(
            prior, payload, record_kind="subject"
        ):
            raise TemporalMemoryError(
                f"subject {payload['subject_id']!r} already exists; identity "
                "fields "
                f"{', '.join(contract.SUBJECT_IMMUTABLE_FIELDS)} are "
                "immutable and same_subject_as may only be extended "
                "append-only, never rewritten"
            )
        _append_jsonl(_path(campaign_dir, "subjects"), payload)
        return payload
    _append_jsonl(_path(campaign_dir, "subjects"), payload)
    return payload


def _write_entity(campaign_dir: Path, record: dict[str, Any]) -> dict[str, Any]:
    payload = _closed(record, contract.ENTITY_FIELDS)
    if payload.get("aliases") is None:
        payload["aliases"] = []
    if payload.get("same_entity_as") is None:
        payload["same_entity_as"] = []
    contract.validate_entity(payload)
    existing = _load_latest(_path(campaign_dir, "entities"), "entity_id")
    prior = existing.get(payload["entity_id"])
    if prior is not None:
        if contract.record_digest(prior) == contract.record_digest(payload):
            return prior
        if not contract.is_sanctioned_identity_extension(
            prior, payload, record_kind="entity"
        ):
            raise TemporalMemoryError(
                f"entity {payload['entity_id']!r} already exists; identity "
                "fields "
                f"{', '.join(contract.ENTITY_IMMUTABLE_FIELDS)} are "
                "immutable and aliases/same_entity_as may only be extended "
                "append-only, never rewritten"
            )
        _append_jsonl(_path(campaign_dir, "entities"), payload)
        return payload
    _append_jsonl(_path(campaign_dir, "entities"), payload)
    return payload


def _ensure_subject_record(
    campaign_dir: Path, record: dict[str, Any]
) -> dict[str, Any]:
    """Bootstrap-default semantics: keep any existing record as-is.

    ``_write_subject`` fail-closes on same-id rewrites; bootstrap defaults
    must instead leave an existing (possibly customized) subject untouched.
    """
    existing = _load_latest(_path(campaign_dir, "subjects"), "subject_id")
    prior = existing.get(record["subject_id"])
    if prior is not None:
        return prior
    return _write_subject(campaign_dir, record)


def ensure_default_subjects(
    campaign_dir: Path | str, *, campaign_id: str | None = None
) -> dict[str, dict[str, Any]]:
    """Ensure world/party/player/keeper subjects exist. Idempotent."""
    camp = _require_campaign_dir(campaign_dir)
    ensure_store(camp)
    cid = _campaign_id_of(camp, campaign_id)
    written = {
        "world": _ensure_subject_record(
            camp,
            {
                "subject_id": contract.subject_id_for("world", cid, ""),
                "kind": "world",
                "campaign_id": cid,
                "display_name": "World",
                "same_subject_as": [],
            },
        ),
        "party": _ensure_subject_record(
            camp,
            {
                "subject_id": contract.subject_id_for("party", cid, ""),
                "kind": "party",
                "campaign_id": cid,
                "display_name": "Party",
                "same_subject_as": [],
            },
        ),
        "player": _ensure_subject_record(
            camp,
            {
                "subject_id": contract.subject_id_for(
                    "player", None, DEFAULT_PLAYER_SLUG
                ),
                "kind": "player",
                "campaign_id": None,
                "display_name": "Player",
                "same_subject_as": [],
            },
        ),
        "keeper": _ensure_subject_record(
            camp,
            {
                "subject_id": contract.subject_id_for(
                    "keeper", None, DEFAULT_KEEPER_SLUG
                ),
                "kind": "keeper",
                "campaign_id": None,
                "display_name": "Keeper",
                "same_subject_as": [],
            },
        ),
    }
    return written


def _ensure_entity(
    campaign_dir: Path, entity_id: str, *, campaign_id: str
) -> dict[str, Any]:
    existing = _load_latest(_path(campaign_dir, "entities"), "entity_id")
    if entity_id in existing:
        return existing[entity_id]
    # entity-<kind>-<slug>
    parts = entity_id.split("-", 2)
    kind = parts[1] if len(parts) >= 3 else "concept"
    slug = parts[2] if len(parts) >= 3 else _slugify(entity_id)
    if kind not in contract.ENTITY_KINDS:
        kind = "concept"
        slug = _slugify(entity_id.removeprefix("entity-"))
        entity_id = contract.entity_id_for(kind, slug)
    return _write_entity(
        campaign_dir,
        {
            "entity_id": entity_id,
            "kind": kind,
            "campaign_id": campaign_id,
            "display_name": slug.replace("-", " "),
            "aliases": [slug],
            "same_entity_as": [],
            "subject_ref": None,
        },
    )


def load_subjects(campaign_dir: Path | str) -> dict[str, dict[str, Any]]:
    return _load_latest(_path(campaign_dir, "subjects"), "subject_id")


def load_entities(campaign_dir: Path | str) -> dict[str, dict[str, Any]]:
    return _load_latest(_path(campaign_dir, "entities"), "entity_id")


def load_assertions(campaign_dir: Path | str) -> dict[str, dict[str, Any]]:
    return _load_latest(_path(campaign_dir, "assertions"), "assertion_id")


def load_episodes(campaign_dir: Path | str) -> dict[str, dict[str, Any]]:
    return _load_latest(_path(campaign_dir, "episodes"), "episode_id")


def load_hooks(campaign_dir: Path | str) -> dict[str, dict[str, Any]]:
    return _load_latest(_path(campaign_dir, "hooks"), "memory_id")


def load_adjudications(campaign_dir: Path | str) -> dict[str, dict[str, Any]]:
    return _load_latest(_path(campaign_dir, "adjudications"), "decision_id")


# ---------------------------------------------------------------------------
# Assertion normalize / persist
# ---------------------------------------------------------------------------


def _normalize_assertion(
    assertion: Mapping[str, Any], *, campaign_dir: Path
) -> dict[str, Any]:
    rec = dict(assertion)
    cid = rec.get("campaign_id") or campaign_dir.name
    if rec.get("scope") is None:
        rec["scope"] = "campaign"
    if rec.get("scope") == "campaign":
        rec.setdefault("campaign_id", cid)
        rec.setdefault("timeline_id", contract.ROOT_TIMELINE_ID)
    rec.setdefault("privacy", "player_safe")
    rec.setdefault("state", "accurate")
    rec.setdefault("source_commit", UNBOUND_COMMIT)
    if rec.get("source_turn") is None:
        rec["source_turn"] = rec.get("valid_from_turn") if rec.get("valid_from_turn") is not None else 0
    if rec.get("valid_from_turn") is None:
        rec["valid_from_turn"] = rec.get("source_turn") or 0
    if rec.get("occurred_turn") is None:
        rec["occurred_turn"] = rec.get("valid_from_turn")
    if rec.get("source_receipts") is None:
        rec["source_receipts"] = []
    for key, default in _ASSERTION_OPTIONAL.items():
        if key not in rec:
            rec[key] = list(default) if isinstance(default, tuple) else default
        elif default == () and rec[key] is None:
            rec[key] = []
    if rec.get("kind") in (
        "knowledge",
        "belief",
        "relationship",
        "player_assertion",
        "player_preference",
        "keeper_correction",
    ):
        knowers = list(rec.get("knowers") or [])
        subject_id = rec.get("subject_id")
        if subject_id and subject_id not in knowers:
            knowers.append(subject_id)
            rec["knowers"] = knowers
    if rec.get("privacy") == "system_only":
        # Contract privacy is player_safe | keeper_only. system_only projects
        # as keeper_only; the original label lives on hook/card projections.
        rec["privacy"] = "keeper_only"
    return _closed(rec, contract.ASSERTION_FIELDS)


def record_assertion(
    assertion: Mapping[str, Any],
    *,
    campaign_dir: Path | str,
) -> dict[str, Any]:
    """Persist one contract-valid assertion. Same-id identical write is idempotent.

    A same-id rewrite is allowed only when it is a supersession close of the
    existing record (``plan_supersession`` shape). Other mutations raise.
    """
    camp = _require_campaign_dir(campaign_dir)
    ensure_store(camp)
    ensure_default_subjects(camp)
    payload = _normalize_assertion(assertion, campaign_dir=camp)
    contract.validate_assertion(payload)
    cid = payload.get("campaign_id") or camp.name
    for entity_id in payload.get("entities") or []:
        _ensure_entity(camp, entity_id, campaign_id=cid)

    existing = load_assertions(camp)
    prior = existing.get(payload["assertion_id"])
    if prior is not None:
        if contract.record_digest(prior) == contract.record_digest(payload):
            return prior
        if not contract.is_sanctioned_supersession(prior, payload):
            raise TemporalMemoryError(
                f"assertion {payload['assertion_id']!r} already exists; a "
                "same-id write must replay byte-identically or apply exactly "
                "the plan_supersession delta ("
                f"{', '.join(contract.SUPERSESSION_DELTA_FIELDS)}); subject, "
                "knowers, privacy, state, statement, entities, provenance, "
                "and edges are immutable"
            )
    _append_jsonl(_path(camp, "assertions"), payload)
    return payload


# ---------------------------------------------------------------------------
# Episodes
# ---------------------------------------------------------------------------


def record_episode(
    commit_sha: str,
    timeline_id: str,
    turn_number: int,
    receipts: Iterable[str],
    player_text: str | None,
    keeper_text: str | None,
    *,
    campaign_dir: Path | str,
    campaign_id: str | None = None,
    subjects_present: Iterable[str] | None = None,
    entities: Iterable[str] | None = None,
    candidates: Iterable[Mapping[str, Any]] | None = None,
    finalization_receipt: str | None = None,
) -> dict[str, Any]:
    """Create one immutable episode bound to a finalized commit/turn.

    Player/keeper text is stored only as hashes. Extracted entity/relationship
    candidates stay on the evidence sidecar and are never auto-promoted to
    world facts. Missing extraction enqueues an explicit backlog row.

    Replay of an existing episode id requires canonical equivalence of the
    full episode record and its evidence sidecar (receipts, text hashes,
    participants, candidates); any drift fails closed. This is the
    low-level commit-bound writer — model-facing callers use
    ``record_turn_episode`` and never supply a commit sha.
    """
    camp = _require_campaign_dir(campaign_dir)
    ensure_store(camp)
    cid = _campaign_id_of(camp, campaign_id)
    ensure_default_subjects(camp, campaign_id=cid)
    receipt_list = [str(item) for item in receipts if str(item).strip()]
    if not receipt_list:
        raise TemporalMemoryError("record_episode requires at least one receipt")
    finale = finalization_receipt or receipt_list[0]
    episode_id = contract.episode_id_for(cid, timeline_id, int(turn_number))
    episode = {
        "episode_id": episode_id,
        "campaign_id": cid,
        "timeline_id": timeline_id,
        "commit": commit_sha,
        "turn_number": int(turn_number),
        "finalization_receipt": finale,
        "subjects_present": list(subjects_present or []),
        "entities": list(entities or []),
    }
    contract.validate_episode(episode)

    candidate_rows = [dict(row) for row in (candidates or []) if isinstance(row, Mapping)]
    evidence = {
        "episode_id": episode_id,
        "player_text_sha256": _sha256_text(player_text),
        "keeper_text_sha256": _sha256_text(keeper_text),
        "source_receipts": receipt_list,
        "candidate_entities": [
            row for row in candidate_rows if row.get("kind") != "relationship"
        ],
        "candidate_relationships": [
            row for row in candidate_rows if row.get("kind") == "relationship"
        ],
    }

    existing = load_episodes(camp)
    prior = existing.get(episode_id)
    if prior is not None:
        if contract.record_digest(prior) != contract.record_digest(episode):
            raise TemporalMemoryError(
                f"episode {episode_id!r} is immutable; the replayed episode "
                "drifts from the recorded one (commit, finalization receipt, "
                "or participants/entities)"
            )
        prior_evidence = load_episode_evidence(camp).get(episode_id)
        if prior_evidence is None or (
            contract.record_digest(prior_evidence) != contract.record_digest(evidence)
        ):
            raise TemporalMemoryError(
                f"episode {episode_id!r} is immutable; the replayed evidence "
                "drifts from the recorded sidecar (receipts, text hashes, or "
                "candidates)"
            )
        episode_out = dict(prior)
        episode_out["evidence"] = prior_evidence
        return episode_out

    _append_jsonl(_path(camp, "episodes"), episode)
    _append_jsonl(_path(camp, "episode_evidence"), evidence)

    if not candidate_rows:
        backlog = {
            "backlog_id": contract.backlog_id_for(cid, int(turn_number), "extract"),
            "campaign_id": cid,
            "timeline_id": timeline_id,
            "commit": commit_sha,
            "turn_number": int(turn_number),
            "reason": "review_required",
            "status": "pending",
        }
        contract.validate_backlog_record(backlog)
        existing_backlog = _load_latest(_path(camp, "backlog"), "backlog_id")
        if backlog["backlog_id"] not in existing_backlog:
            _append_jsonl(_path(camp, "backlog"), backlog)

    episode_out = dict(episode)
    episode_out["evidence"] = evidence
    return episode_out


def load_episode_evidence(campaign_dir: Path | str) -> dict[str, dict[str, Any]]:
    return _load_latest(_path(campaign_dir, "episode_evidence"), "episode_id")


# ---------------------------------------------------------------------------
# Machine-facing commit resolution (semantic in, machine sha out)
# ---------------------------------------------------------------------------


def resolve_turn_commit(
    root: Path | str,
    campaign_id: str,
    timeline_id: str,
    turn_number: int,
) -> dict[str, Any]:
    """Resolve semantic (campaign, timeline, turn) to the finalized turn
    commit.

    Commit SHAs are machine-internal integrity evidence: models never supply
    or transcribe them. This is the sanctioned resolution path — code reads
    the campaign git history, verifies the commit is the finalized turn on
    the requested timeline, and hands the sha to ``record_episode``.
    """
    import coc_git_history as git_history

    resolved = git_history.resolve_history_selector(
        root, campaign_id, {"timeline_id": timeline_id, "turn": int(turn_number)}
    )
    if resolved.get("commit_type") != "turn":
        raise TemporalMemoryError(
            f"turn {turn_number} on timeline {timeline_id!r} resolved to a "
            f"non-turn commit ({resolved.get('commit_type')!r})"
        )
    if (
        resolved.get("timeline_id") != timeline_id
        or resolved.get("turn_number") != str(int(turn_number))
    ):
        raise TemporalMemoryError(
            "resolved commit does not match the requested semantic "
            "campaign/timeline/turn"
        )
    return resolved


def record_turn_episode(
    root: Path | str,
    campaign_id: str,
    timeline_id: str,
    turn_number: int,
    receipts: Iterable[str],
    player_text: str | None,
    keeper_text: str | None,
    *,
    subjects_present: Iterable[str] | None = None,
    entities: Iterable[str] | None = None,
    candidates: Iterable[Mapping[str, Any]] | None = None,
    finalization_receipt: str | None = None,
) -> dict[str, Any]:
    """Model-facing episode recording: semantic campaign/timeline/turn in,
    machine-attached commit out.

    Resolves the finalized turn commit from the campaign git history via
    ``resolve_turn_commit`` and records the episode into the campaign's
    temporal store. The caller never handles a commit sha; the low-level
    ``record_episode`` stays machine-internal for the commit coordinator.
    """
    import coc_git_history as git_history

    resolved = resolve_turn_commit(root, campaign_id, timeline_id, turn_number)
    campaign_dir = git_history.worktree_path_for(root, campaign_id)
    return record_episode(
        resolved["commit"],
        timeline_id,
        int(turn_number),
        receipts,
        player_text,
        keeper_text,
        campaign_dir=campaign_dir,
        campaign_id=campaign_id,
        subjects_present=subjects_present,
        entities=entities,
        candidates=candidates,
        finalization_receipt=finalization_receipt,
    )


# ---------------------------------------------------------------------------
# Recall
# ---------------------------------------------------------------------------


def _entity_tokens(entity_id: str, entities: Mapping[str, Mapping[str, Any]]) -> set[str]:
    tokens = {entity_id}
    rec = entities.get(entity_id)
    if rec is None:
        # also accept the trailing slug
        parts = entity_id.split("-", 2)
        if len(parts) >= 3:
            tokens.add(parts[2])
        return tokens
    tokens.add(str(rec.get("display_name") or ""))
    tokens.update(str(alias) for alias in (rec.get("aliases") or []))
    return {token for token in tokens if token}


def _entity_overlap(
    query: Iterable[str],
    assertion: Mapping[str, Any],
    entities: Mapping[str, Mapping[str, Any]],
) -> int:
    wanted = {str(item) for item in query if str(item)}
    if not wanted:
        return 0
    have: set[str] = set()
    for entity_id in assertion.get("entities") or []:
        have |= _entity_tokens(str(entity_id), entities)
        have.add(str(entity_id))
    return len(wanted & have)


def recall(subject: str | None, context: Mapping[str, Any]) -> dict[str, Any]:
    """Deterministic narrow-then-rank. Semantic adoption stays with the KP.

    ``context`` keys: ``campaign_dir`` (required), ``timeline_id``,
    ``as_of_turn``, ``privacy``/``view`` (``player_safe``|``keeper``),
    ``entities``, ``kinds``, ``include_superseded``, ``limit``.
    """
    camp = _require_campaign_dir(context.get("campaign_dir"))
    ensure_store(camp)
    assertions = list(load_assertions(camp).values())
    entities = load_entities(camp)
    timeline_id = context.get("timeline_id") or contract.ROOT_TIMELINE_ID
    as_of = context.get("as_of_turn")
    as_of_turn = as_of if isinstance(as_of, int) and not isinstance(as_of, bool) else None
    view = str(context.get("privacy") or context.get("view") or "keeper")
    kinds = set(context.get("kinds") or [])
    query_entities = [str(item) for item in (context.get("entities") or []) if str(item)]
    include_superseded = bool(context.get("include_superseded"))
    limit = int(context.get("limit") or 8)
    limit = max(1, min(32, limit))

    if subject:
        assertions = [
            dict(row)
            for row in contract.project_subject_view(
                assertions, subject, as_of_turn=as_of_turn
            )
        ]
    elif as_of_turn is not None:
        assertions = [row for row in assertions if contract.effective_at(row, as_of_turn)]

    narrowed: list[dict[str, Any]] = []
    for row in assertions:
        if row.get("timeline_id") not in (None, timeline_id):
            continue
        if view == "player_safe" and not contract.is_player_visible(row):
            continue
        if kinds and row.get("kind") not in kinds:
            continue
        if (
            not include_superseded
            and as_of_turn is None
            and row.get("valid_until_turn") is not None
        ):
            continue
        if query_entities and _entity_overlap(query_entities, row, entities) == 0:
            continue
        narrowed.append(row)

    ranked: list[dict[str, Any]] = []
    for row in narrowed:
        overlap = _entity_overlap(query_entities, row, entities)
        subject_hit = 1 if subject and (
            row.get("subject_id") == subject or subject in (row.get("knowers") or [])
        ) else 0
        source_turn = int(row.get("source_turn") or 0)
        score = 4 * overlap + 2 * subject_hit + source_turn / 1000.0
        item = dict(row)
        item["score"] = round(score, 3)
        item["authority"] = AUTHORITY
        item["hard_gate"] = False
        ranked.append(item)
    ranked.sort(key=lambda row: (-row["score"], -int(row.get("source_turn") or 0), row["assertion_id"]))
    ranked = ranked[:limit]

    pending = [
        row
        for row in ranked
        if row.get("kind") == "player_assertion"
    ]
    return {
        "schema_generation": SCHEMA_GENERATION,
        "authority": AUTHORITY,
        "hard_gate": False,
        "view": view,
        "count": len(ranked),
        "candidates": ranked,
        "pending_player_assertions": pending,
    }


# ---------------------------------------------------------------------------
# Adjudication
# ---------------------------------------------------------------------------


def _adjudication_id(campaign_id: str, decision_id: str) -> str:
    return _prefixed_id(f"mem-{campaign_id}-adj-", decision_id)


def _promoted_id(campaign_id: str, candidate_id: str, decision_id: str) -> str:
    return _prefixed_id(
        f"mem-{campaign_id}-promoted-", f"{candidate_id}-{decision_id}"
    )


def _adjudication_request_fingerprint(
    candidate_id: str,
    action: str,
    *,
    statement: str | None,
    kind: str | None,
    subject_id: str | None,
    privacy: str | None,
    state: str | None,
) -> str:
    """Canonical digest of the full adjudication request.

    Machine-internal integrity evidence bound to the stored receipt: replay
    of a ``decision_id`` is idempotent only for the byte-equal request
    (candidate, action, and every modification parameter). Reuse of a
    decision id with a different candidate/action/modification fails closed.
    """
    payload = {
        "candidate_id": candidate_id,
        "action": action,
        "statement": (statement or "").strip(),
        "kind": kind,
        "subject_id": subject_id,
        "privacy": privacy,
        "state": state,
    }
    return hashlib.sha256(contract.canonical_json(payload).encode("utf-8")).hexdigest()


def adjudicate_candidate(
    decision_id: str,
    candidate_id: str,
    action: str,
    *,
    campaign_dir: Path | str,
    statement: str | None = None,
    kind: str | None = None,
    subject_id: str | None = None,
    privacy: str | None = None,
    state: str | None = None,
) -> dict[str, Any]:
    """KP accept/modify/reject of a candidate. Never deletes the candidate.

    ``accept`` / ``modify`` write a new belief/knowledge that ``confirms`` the
    candidate. ``reject`` records the decision only. Player assertions stay
    ``player_assertion`` until this call promotes them.
    """
    if action not in ADJUDICATION_ACTIONS:
        raise TemporalMemoryError(
            f"action must be one of {ADJUDICATION_ACTIONS}, got {action!r}"
        )
    camp = _require_campaign_dir(campaign_dir)
    ensure_store(camp)
    fingerprint = _adjudication_request_fingerprint(
        candidate_id,
        action,
        statement=statement,
        kind=kind,
        subject_id=subject_id,
        privacy=privacy,
        state=state,
    )
    prior = load_adjudications(camp).get(decision_id)
    if prior is not None:
        if prior.get("request_fingerprint") != fingerprint:
            raise TemporalMemoryError(
                f"decision_id {decision_id!r} is already bound to a different "
                "adjudication request; a decision is immutable once recorded "
                "(candidate/action/modification must replay exactly)"
            )
        return prior

    assertions = load_assertions(camp)
    candidate = assertions.get(candidate_id)
    if candidate is None:
        raise TemporalMemoryError(f"candidate not found: {candidate_id}")

    cid = candidate.get("campaign_id") or camp.name
    adjudication_id = _adjudication_id(cid, decision_id)
    for row in load_adjudications(camp).values():
        if (
            row.get("adjudication_id") == adjudication_id
            and row.get("decision_id") != decision_id
        ):
            raise TemporalMemoryError(
                f"generated adjudication id {adjudication_id!r} collides with "
                f"decision {row.get('decision_id')!r}; choose a more "
                "distinct semantic decision_id"
            )
    promoted_id = None
    if action in {"accept", "modify"}:
        if action == "modify" and not (statement or "").strip():
            raise TemporalMemoryError("modify requires a statement")
        defaults = ensure_default_subjects(camp, campaign_id=cid)
        target_subject = subject_id or defaults["party"]["subject_id"]
        promoted_kind = kind or "belief"
        if promoted_kind == "player_assertion":
            raise TemporalMemoryError(
                "adjudication cannot promote into player_assertion"
            )
        text = (statement or candidate.get("statement") or "").strip()
        promoted_assertion_id = _promoted_id(cid, candidate_id, decision_id)
        if promoted_assertion_id in assertions:
            raise TemporalMemoryError(
                f"generated promoted id {promoted_assertion_id!r} collides "
                "with an assertion from a different decision; choose a "
                "more distinct semantic decision_id"
            )
        promoted = {
            "assertion_id": promoted_assertion_id,
            "kind": promoted_kind,
            "scope": "campaign",
            "campaign_id": cid,
            "timeline_id": candidate.get("timeline_id") or contract.ROOT_TIMELINE_ID,
            "subject_id": target_subject,
            "knowers": [target_subject],
            "privacy": privacy or candidate.get("privacy") or "player_safe",
            "state": state or "accurate",
            "statement": text,
            "entities": list(candidate.get("entities") or []),
            "occurred_turn": candidate.get("occurred_turn"),
            "valid_from_turn": candidate.get("valid_from_turn") or 0,
            "source_commit": candidate.get("source_commit") or UNBOUND_COMMIT,
            "source_turn": candidate.get("source_turn") or 0,
            "source_receipts": [f"receipt-adjudicate-{_slugify(decision_id)}"],
            "confirms": [candidate_id],
        }
        if promoted["privacy"] == "system_only":
            promoted["privacy"] = "keeper_only"
        written = record_assertion(promoted, campaign_dir=camp)
        promoted_id = written["assertion_id"]

    receipt = {
        "decision_id": decision_id,
        "adjudication_id": adjudication_id,
        "candidate_id": candidate_id,
        "action": action,
        "promoted_assertion_id": promoted_id,
        "request_fingerprint": fingerprint,
        "authority": AUTHORITY,
        "hard_gate": False,
    }
    _append_jsonl(_path(camp, "adjudications"), receipt)
    return receipt


# ---------------------------------------------------------------------------
# Hooks (supersession, not in-place mutation)
# ---------------------------------------------------------------------------


def register_hook(
    memory_id: str,
    assertion_id: str,
    *,
    campaign_dir: Path | str,
    kind: str = "unresolved_hook",
    status: str = "open",
    introduced_at: str | None = None,
    possible_payoff: str = "",
) -> dict[str, Any]:
    """Bind a semantic memory_id to an assertion as an open hook ledger row."""
    if kind not in HOOK_KINDS:
        raise TemporalMemoryError(f"hook kind must be one of {HOOK_KINDS}")
    camp = _require_campaign_dir(campaign_dir)
    ensure_store(camp)
    existing = load_hooks(camp).get(memory_id)
    if existing is not None:
        return existing
    row = {
        "memory_id": memory_id,
        "assertion_id": assertion_id,
        "kind": kind,
        "status": status,
        "introduced_at": introduced_at or "",
        "resolved_at": "",
        "resolution_reason": "",
        "possible_payoff": possible_payoff,
        "decision_id": "",
    }
    _append_jsonl(_path(camp, "hooks"), row)
    return row


def resolve_hook(
    memory_id: str,
    resolution: str,
    decision_id: str,
    *,
    campaign_dir: Path | str,
    resolved_at: str = "",
    reason: str = "",
) -> dict[str, Any]:
    """Close a hook by writing a successor + supersession edge.

    The original assertion keeps its id and statement. Status lives on the
    hook projection. Idempotent for the same ``decision_id``.
    """
    if resolution not in HOOK_RESOLUTIONS:
        raise TemporalMemoryError(
            f"invalid hook resolution {resolution!r}; expected one of "
            f"{', '.join(HOOK_RESOLUTIONS)}"
        )
    camp = _require_campaign_dir(campaign_dir)
    ensure_store(camp)

    for row in _read_jsonl(_path(camp, "hooks")):
        if row.get("decision_id") == decision_id and row.get("memory_id") == memory_id:
            return {
                "memory_id": memory_id,
                "kind": row.get("kind"),
                "status": row.get("status"),
                "resolved_at": row.get("resolved_at") or "",
                "already_resolved": True,
                "decision_id": decision_id,
                "successor_id": row.get("successor_id"),
                "assertion_id": row.get("assertion_id"),
            }

    hooks = load_hooks(camp)
    hook = hooks.get(memory_id)
    assertions = load_assertions(camp)
    if hook is None:
        assertion = assertions.get(memory_id)
        if assertion is None:
            raise TemporalMemoryError(f"memory card not found: {memory_id}")
        hook = register_hook(
            memory_id, assertion["assertion_id"], campaign_dir=camp, kind="unresolved_hook"
        )
    if hook.get("kind") not in HOOK_KINDS:
        raise TemporalMemoryError(
            f"memory card {memory_id} has kind {hook.get('kind')!r}; "
            f"only {', '.join(HOOK_KINDS)} cards own a lifecycle status"
        )
    if hook.get("status") == resolution:
        return {
            "memory_id": memory_id,
            "kind": hook.get("kind"),
            "status": resolution,
            "resolved_at": hook.get("resolved_at") or "",
            "already_resolved": True,
            "decision_id": decision_id,
            "successor_id": hook.get("successor_id"),
            "assertion_id": hook.get("assertion_id"),
        }

    assertion = assertions.get(hook["assertion_id"])
    if assertion is None:
        raise TemporalMemoryError(
            f"hook {memory_id} references missing assertion {hook['assertion_id']}"
        )
    cid = assertion.get("campaign_id") or camp.name
    close_turn = _parse_turn(resolved_at, default=int(assertion.get("valid_from_turn") or 0))
    if close_turn < int(assertion.get("valid_from_turn") or 0):
        close_turn = int(assertion.get("valid_from_turn") or 0)
    successor_id = _prefixed_id(
        f"mem-{cid}-hook-", f"{_slugify(memory_id)}-{resolution}"
    )
    successor_clash = assertions.get(successor_id)
    if successor_clash is not None and successor_clash.get("confirms") != [
        assertion["assertion_id"]
    ]:
        raise TemporalMemoryError(
            f"generated successor id {successor_id!r} collides with an "
            "unrelated assertion; choose a more distinct semantic memory_id"
        )
    successor = {
        "assertion_id": successor_id,
        "kind": "belief",
        "scope": "campaign",
        "campaign_id": cid,
        "timeline_id": assertion.get("timeline_id") or contract.ROOT_TIMELINE_ID,
        "subject_id": assertion.get("subject_id"),
        "knowers": list(assertion.get("knowers") or [assertion.get("subject_id")]),
        "privacy": assertion.get("privacy") or "keeper_only",
        "state": "accurate",
        "statement": (reason or f"hook {resolution}").strip(),
        "entities": list(assertion.get("entities") or []),
        "occurred_turn": assertion.get("occurred_turn"),
        "valid_from_turn": close_turn,
        "source_commit": assertion.get("source_commit") or UNBOUND_COMMIT,
        "source_turn": close_turn,
        "source_receipts": [f"receipt-hook-{_slugify(decision_id)}"],
        "confirms": [assertion["assertion_id"]],
    }
    record_assertion(successor, campaign_dir=camp)
    closed = contract.plan_supersession(
        assertion, successor_id, valid_until_turn=close_turn
    )
    record_assertion(closed, campaign_dir=camp)

    updated = dict(hook)
    updated["status"] = resolution
    updated["resolved_at"] = resolved_at
    updated["resolution_reason"] = reason
    updated["decision_id"] = decision_id
    updated["successor_id"] = successor_id
    _append_jsonl(_path(camp, "hooks"), updated)
    return {
        "memory_id": memory_id,
        "kind": updated.get("kind"),
        "status": resolution,
        "resolved_at": resolved_at,
        "already_resolved": False,
        "decision_id": decision_id,
        "successor_id": successor_id,
        "assertion_id": assertion["assertion_id"],
    }


# ---------------------------------------------------------------------------
# Resume projection
# ---------------------------------------------------------------------------


def _read_session_summaries(campaign_dir: Path, through_turn: int) -> list[dict[str, Any]]:
    path = campaign_dir / "memory" / "session-summaries.jsonl"
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for raw in _read_jsonl(path):
        turn = raw.get("turn_number")
        if not isinstance(turn, int) or isinstance(turn, bool) or turn < 0:
            continue
        if turn > through_turn:
            continue
        summary = raw.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            continue
        rows.append(
            {
                "turn_number": turn,
                "summary": summary.strip(),
                "source_ref": f"memory/session-summaries.jsonl#turn-{turn}",
            }
        )
    rows.sort(key=lambda row: row["turn_number"])
    return rows[-6:]


def build_resume_projection(
    campaign_id: str,
    turn_number: int,
    *,
    campaign_dir: Path | str,
    timeline_id: str = contract.ROOT_TIMELINE_ID,
    limit: int = 12,
) -> dict[str, Any]:
    """Bounded advisory capsule from temporal history + session summaries."""
    camp = _require_campaign_dir(campaign_dir)
    ensure_store(camp)
    through = int(turn_number)
    episodes = [
        row
        for row in load_episodes(camp).values()
        if row.get("campaign_id") == campaign_id
        and row.get("timeline_id") == timeline_id
        and int(row.get("turn_number") or 0) <= through
    ]
    episodes.sort(key=lambda row: int(row.get("turn_number") or 0))
    evidence = load_episode_evidence(camp)
    recent_episodes = []
    for row in episodes[-6:]:
        item = dict(row)
        ev = evidence.get(row["episode_id"])
        if ev is not None:
            item["player_text_sha256"] = ev.get("player_text_sha256")
            item["keeper_text_sha256"] = ev.get("keeper_text_sha256")
        recent_episodes.append(item)

    recalled = recall(
        None,
        {
            "campaign_dir": camp,
            "timeline_id": timeline_id,
            "as_of_turn": through,
            "view": "keeper",
            "limit": max(1, min(24, int(limit))),
        },
    )
    hooks = [
        row
        for row in load_hooks(camp).values()
        if row.get("status") == "open"
    ]
    adjudications = load_adjudications(camp)
    accepted = {
        row["candidate_id"]
        for row in adjudications.values()
        if row.get("action") in {"accept", "modify"}
    }
    pending = [
        row
        for row in load_assertions(camp).values()
        if row.get("kind") == "player_assertion"
        and row["assertion_id"] not in accepted
        and row.get("valid_until_turn") is None
    ]
    pending.sort(key=lambda row: row["assertion_id"])
    return {
        "schema_generation": SCHEMA_GENERATION,
        "authority": AUTHORITY,
        "hard_gate": False,
        "campaign_id": campaign_id,
        "timeline_id": timeline_id,
        "turn_number": through,
        "recent_episodes": recent_episodes,
        "active_assertions": recalled["candidates"],
        "open_hooks": hooks[:16],
        "pending_candidates": pending[:16],
        "session_summaries": _read_session_summaries(camp, through),
    }
