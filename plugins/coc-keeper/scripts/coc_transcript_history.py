#!/usr/bin/env python3
"""Operation core cell: exact historical table-transcript retrieval.

Canonical live-KP capability for retrieving exact old player/KP wording:
``transcript.locate`` narrows candidate table-transcript rows with bounded
deterministic structured selectors only (timeline, turn/range, role,
speaker, structured identity), and ``transcript.read`` resolves the exact
semantic locator through the campaign Git history and returns the exact
hash-verified wording with its speaker/role/turn/timeline evidence.

Hard boundaries owned here:

- Free prose never decides relevance. Locate accepts structured selectors
  only; semantic relevance stays with the KP (per the Semantic Matcher
  Constitution). There is no keyword/regex/FTS path in this module.
- The active worktree is never a fallback and worldline resolution never
  trusts mutable worktree metadata. Turn commits are resolved through the
  immutable Git refs / commit DAG / trailers of the campaign repository
  (``coc_git_history``); inherited history must be an actual commit-DAG
  ancestor of the selected timeline tip, and the table opening (turn 0) is
  bound to the immutable earliest commit whose blob first contains the
  opening row — never a moving tip.
- Locator identity is canonical row identity, never positional. A locator
  is ``xscript:<timeline>:turn-<n>:<role>:<record_kind>:<source identity>``
  where the source identity is the row's canonical journal decision,
  finalization id, or table-opening decision. Duplicate canonical row
  identities (or duplicate canonical ``entry_id``s) fail closed, so a
  locator can never drift onto another row when later rows are appended.
- Keeper wording is verified against the immutable
  ``logs/turn-finalizations.jsonl`` receipt from the same commit using the
  canonical production finalization contract
  (``coc_turn_finalization._valid_finalization``), then bound row-to-
  receipt on run_segment_id, session_id, turn_id, finalization_id,
  accepted_revision, journal decision, rendered text, and rendered text
  hash. Player wording is bound to its journal identity, text hash, and
  the receipt's finalized ``contract_projection.player_input``. Opening
  rows are bound to their canonical opening source identity. Any mismatch
  fails closed.
- Transport budget: every read returns exact contiguous text within an
  explicit aggregate character budget, chunked with total length, full
  text hash, and a deterministic continuation card. Rows are never
  truncated and responses are never unbounded.
- Commit shas and digests stay machine-internal on the input surface: a
  model never relays a SHA, ref, or digest to call these operations. The
  full-text digest on a returned chunk is response-side integrity
  evidence, computed and attached by code.
- Fail closed on missing/corrupt hash, malformed transcript lines,
  duplicate row identity, unknown timeline/turn, absent commit/blob,
  out-of-line history, or finalization mismatch. Only canonical table rows
  (``table_opening``, ``player_turn``, ``finalized_keeper``) are ever
  returned; tool, system, and Keeper-secret logs are unreachable through
  this surface.
"""
from __future__ import annotations

import json

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
    _canonical_digest,
    _load_sibling,
    _table_transcript_entry_id,
    re,
)

coc_git_history = _load_sibling("coc_git_history", "coc_git_history.py")

coc_turn_finalization = _load_sibling(
    "coc_turn_finalization", "coc_turn_finalization.py"
)

_TRANSCRIPT_RELPATH = "logs/table-transcript.jsonl"
_FINALIZATIONS_RELPATH = "logs/turn-finalizations.jsonl"
# Independent, tracked evidence written by the canonical
# evidence.table_opening operation after it records the transcript row.
_TOOLBOX_CALLS_RELPATH = "logs/toolbox-calls.jsonl"

_TABLE_OPENING_RECORD_KIND = "table_opening"
_PLAYER_TURN_RECORD_KIND = "player_turn"
_FINALIZED_KEEPER_RECORD_KIND = "finalized_keeper"

_ROLE_RECORD_KINDS: dict[str, frozenset[str]] = {
    "player": frozenset({_PLAYER_TURN_RECORD_KIND}),
    "keeper": frozenset({_FINALIZED_KEEPER_RECORD_KIND, _TABLE_OPENING_RECORD_KIND}),
}

_LOCATOR_PREFIX = "xscript"
_TURN_SEGMENT_RE = re.compile(r"^turn-(\d+)$")
_TIMELINE_RE = re.compile(r"^tl-[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$")
# Canonical safe-id shape for journal/finalization/opening source ids
# (same charset as the campaign decision-id law, colon included).
_SOURCE_TOKEN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$")
_MAX_REFS = 8
_MAX_PAGE_LIMIT = 8
_DEFAULT_PAGE_LIMIT = 6
_MAX_TURN_RANGE_SPAN = 200
_MAX_TOKEN_CHARS = 200
# Immutable-history walk bounds (fail closed beyond, never silently wide).
_MAX_COMMIT_WALK = 2000
# Transport budget: aggregate exact-text characters returned by one read
# call. Rows are chunked under this bound, never truncated.
_MAX_READ_CALL_CHARS = 12000


# --------------------------------------------------------------------------- #
# Semantic locator ids (canonical row identity, never positional)
# --------------------------------------------------------------------------- #

def _row_source_token(row: dict[str, Any]) -> str:
    """Canonical source identity of one transcript row: the journal decision
    owning a player row, the finalization id owning a finalized KP row, or
    the table-opening decision owning an opening row."""
    record_kind = row.get("record_kind")
    if record_kind == _PLAYER_TURN_RECORD_KIND:
        token = row.get("journal_decision_id")
    elif record_kind == _FINALIZED_KEEPER_RECORD_KIND:
        token = row.get("finalization_id")
    else:
        token = row.get("source_id")
    if not isinstance(token, str) or not _SOURCE_TOKEN_RE.match(token):
        raise ToolError(
            "state_corrupt",
            f"table transcript row carries no canonical {record_kind} "
            f"source identity: {token!r}",
        )
    return token


def row_identity(row: dict[str, Any]) -> tuple[str, str, str]:
    """Canonical identity of a transcript row: (role, record kind, source
    identity). Unique per campaign; duplicates fail closed."""
    return (str(row.get("role")), str(row.get("record_kind")), _row_source_token(row))


def _escape_locator_component(value: str) -> str:
    """Escape only the fixed grammar delimiter while preserving a semantic,
    human-readable id. Canonical ids cannot contain %, so percent escaping
    has one representation and never introduces aliases."""
    return value.replace("%", "%25").replace(":", "%3A")


def _unescape_locator_component(value: str, *, label: str) -> str:
    """Strict inverse of _escape_locator_component. Raw/unknown delimiter
    escapes are rejected rather than normalized into a second locator form."""
    result: list[str] = []
    index = 0
    while index < len(value):
        char = value[index]
        if char != "%":
            result.append(char)
            index += 1
            continue
        code = value[index:index + 3]
        if code == "%3A":
            result.append(":")
        elif code == "%25":
            result.append("%")
        else:
            raise ToolError(
                "invalid_param",
                f"transcript ref carries an invalid {label} escape {code!r}",
            )
        index += 3
    return "".join(result)


def build_transcript_ref(timeline_id: str, row: dict[str, Any]) -> str:
    """Build the semantic model-facing locator for one transcript row:
    kind prefix + worldline scope + canonical row identity, per the
    model-facing identifier law. Delimiter escaping preserves source ids
    containing ``:`` without hashing/base64 or positional ordinals."""
    role, record_kind, token = row_identity(row)
    return ":".join((
        _LOCATOR_PREFIX,
        _escape_locator_component(timeline_id),
        f"turn-{row['turn']}",
        role,
        record_kind,
        _escape_locator_component(token),
    ))


def parse_transcript_ref(ref: Any) -> dict[str, Any]:
    """Strictly parse an escaped fixed-field semantic locator returned by
    transcript.locate. Both timeline and source ids can contain ``:``;
    delimiter escaping gives each canonical id one round-trippable spelling."""
    if not isinstance(ref, str):
        raise ToolError(
            "invalid_param",
            f"transcript ref {ref!r} is not a semantic xscript locator",
        )
    parts = ref.split(":")
    if len(parts) != 6 or parts[0] != _LOCATOR_PREFIX:
        raise ToolError(
            "invalid_param",
            f"transcript ref {ref!r} is not a semantic xscript locator",
        )
    _prefix, escaped_timeline, turn_token, role, record_kind, escaped_token = parts
    timeline_id = _unescape_locator_component(escaped_timeline, label="timeline")
    token = _unescape_locator_component(escaped_token, label="source identity")
    turn_match = _TURN_SEGMENT_RE.match(turn_token)
    if turn_match is None:
        raise ToolError(
            "invalid_param", f"transcript ref {ref!r} carries no turn segment"
        )
    if role not in _ROLE_RECORD_KINDS or record_kind not in _ROLE_RECORD_KINDS[role]:
        raise ToolError(
            "invalid_param",
            f"transcript ref {ref!r} pairs role {role!r} with record kind "
            f"{record_kind!r}",
        )
    if not _TIMELINE_RE.match(timeline_id):
        raise ToolError(
            "invalid_param",
            f"transcript ref {ref!r} carries a non-semantic timeline id",
        )
    if not _SOURCE_TOKEN_RE.match(token):
        raise ToolError(
            "invalid_param",
            f"transcript ref {ref!r} carries a non-semantic source identity",
        )
    return {
        "timeline_id": timeline_id,
        "turn": int(turn_match.group(1)),
        "role": role,
        "record_kind": record_kind,
        "token": token,
    }


# --------------------------------------------------------------------------- #
# Immutable Git resolution (refs + commit DAG + trailers only)
# --------------------------------------------------------------------------- #

def _repo_paths(ctx: Ctx) -> tuple[Any, Any]:
    return (
        coc_git_history.repo_path_for(ctx.root, ctx.campaign_id),
        coc_git_history.worktree_path_for(ctx.root, ctx.campaign_id),
    )


def _worldline_log(
    ctx: Ctx, timeline_id: str
) -> list[tuple[str, dict[str, str]]]:
    """Newest-first (commit sha, trailers) walk of one timeline ref.

    Pure Git: ref existence, commit DAG ancestry, and COC trailers. A cap
    bounds the walk; exceeding it fails closed instead of silently
    narrowing history."""
    repo, worktree = _repo_paths(ctx)
    if not coc_git_history._looks_like_git_repo(repo):
        raise ToolError(
            "invalid_state", "campaign git repo is missing"
        )
    try:
        ref = coc_git_history.timeline_ref_name(timeline_id)
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    records = coc_git_history._commit_log_records(repo, worktree, rev=ref)
    if not records:
        raise ToolError(
            "invalid_state",
            f"timeline ref missing or unreachable in campaign git "
            f"history: {timeline_id!r}",
        )
    if len(records) > _MAX_COMMIT_WALK:
        raise ToolError(
            "invalid_state",
            f"timeline {timeline_id!r} history exceeds the "
            f"{_MAX_COMMIT_WALK}-commit resolution bound",
        )
    return [
        (sha, coc_git_history.parse_trailers(body)) for sha, body in records
    ]


def _blobs_at_commit(
    ctx: Ctx, commit_sha: str, paths: tuple[str, ...]
) -> dict[str, Any]:
    """Read committed blobs at one resolved commit. The sha is resolved by
    code from Git and never appears on the model-facing surface."""
    try:
        return coc_git_history.history_query(
            ctx.root, ctx.campaign_id, {"commit": commit_sha, "paths": list(paths)}
        )
    except coc_git_history.GitHistoryError as exc:
        raise ToolError(
            "invalid_state",
            f"campaign git history is unavailable at the resolved commit: {exc}",
        ) from exc


def _resolve_turn_commit(
    ctx: Ctx, timeline_id: str, turn: int
) -> tuple[str, str, bool]:
    """Resolve which immutable commit owns a turn on a worldline.

    Direct case: a turn commit on the requested timeline ref carrying its
    timeline id. Inherited case: the turn lives on an ancestor worldline —
    found by walking the actual commit-DAG ancestors of the requested tip,
    so a parent turn committed after a fork is never falsely inherited.
    Exactly one owning worldline must exist; ambiguity across merge
    parents fails closed."""
    records = _worldline_log(ctx, timeline_id)

    def _turn_of(trailers: dict[str, str]) -> bool:
        return (
            trailers.get("COC-Commit-Type") == "turn"
            and trailers.get("Turn-Number") == str(turn)
        )

    for sha, trailers in records:
        if _turn_of(trailers) and trailers.get("Timeline-Id") == timeline_id:
            return sha, timeline_id, False
    inherited: dict[str, str] = {}
    for sha, trailers in records:
        if _turn_of(trailers) and trailers.get("Timeline-Id") != timeline_id:
            owner = str(trailers.get("Timeline-Id") or "")
            if owner and owner not in inherited:
                inherited[owner] = sha
    if not inherited:
        raise ToolError(
            "invalid_state",
            f"no turn {turn} on timeline {timeline_id!r} or its commit-DAG "
            "ancestors in the campaign git history",
        )
    if len(inherited) > 1:
        raise ToolError(
            "ambiguous_identity",
            f"turn {turn} exists on more than one ancestor worldline of "
            f"{timeline_id!r} ({', '.join(sorted(inherited))}); pass the "
            "owning timeline explicitly",
        )
    owner, sha = next(iter(inherited.items()))
    return sha, owner, True


def _resolve_opening_commit(
    ctx: Ctx, timeline_id: str, token: str | None
) -> str:
    """Bind the table opening (turn 0) to the immutable *first* commit in
    Git path history whose transcript blob contains that opening identity.

    ``git log --reverse`` starts at the oldest transcript-changing commit,
    so >200 (or any number of) later commits cannot advance this anchor.
    This is intentionally unbounded by a moving tip window: the Git DAG is
    the historical authority for an opening locator.
    """
    repo, worktree = _repo_paths(ctx)
    try:
        ref = coc_git_history.timeline_ref_name(timeline_id)
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    completed = coc_git_history._run_git(
        ["log", "--format=%H", "--reverse", ref, "--", _TRANSCRIPT_RELPATH],
        repo=repo,
        worktree=worktree,
        check=False,
    )
    if completed.returncode != 0:
        raise ToolError(
            "invalid_state",
            f"cannot walk transcript history for timeline {timeline_id!r}",
        )
    for line in completed.stdout.splitlines():
        sha = line.strip()
        if not sha:
            continue
        result = _blobs_at_commit(ctx, sha, (_TRANSCRIPT_RELPATH,))
        rows = _transcript_rows_at(ctx, result)
        openings = [
            row for row in rows
            if row.get("record_kind") == _TABLE_OPENING_RECORD_KIND
            and (token is None or _row_source_token(row) == token)
        ]
        if openings:
            return sha
    raise ToolError(
        "invalid_state",
        f"no table opening row in Git history for timeline {timeline_id!r}",
    )



def _resolve_timeline_id(ctx: Ctx, args: dict[str, Any]) -> str:
    """Default-timeline resolution only; ownership and ancestry below never
    consult this mutable campaign metadata — they resolve through Git."""
    raw = args.get("timeline")
    if raw in (None, ""):
        try:
            state = coc_git_history.load_timeline_state(ctx.root, ctx.campaign_id)
        except coc_git_history.GitHistoryError as exc:
            raise ToolError(
                "invalid_state",
                f"cannot read campaign timeline metadata: {exc}",
            ) from exc
        active = state.get("active_timeline_id")
        if not isinstance(active, str) or not active.strip():
            raise ToolError(
                "invalid_state",
                "campaign timeline metadata carries no active_timeline_id; "
                "pass an explicit timeline",
            )
        timeline = active.strip()
        if not _TIMELINE_RE.match(timeline):
            raise ToolError(
                "invalid_state",
                f"campaign active timeline id is not semantic: {timeline!r}",
            )
        return timeline
    timeline = str(raw).strip()
    if not _TIMELINE_RE.match(timeline):
        raise ToolError(
            "invalid_param",
            f"timeline must be a semantic timeline id matching tl-<slug>, got {raw!r}",
        )
    return timeline


# --------------------------------------------------------------------------- #
# Blob parsing and canonical row identity
# --------------------------------------------------------------------------- #

def _parse_jsonl_strict(blob: str, label: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_no, line in enumerate(blob.splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ToolError(
                "state_corrupt",
                f"{label} line {line_no} is not valid JSON at the resolved commit",
            ) from exc
        if not isinstance(row, dict):
            raise ToolError(
                "state_corrupt",
                f"{label} line {line_no} is not a JSON object at the resolved commit",
            )
        rows.append(row)
    return rows


def _transcript_rows_at(ctx: Ctx, history_result: dict[str, Any]) -> list[dict[str, Any]]:
    content = history_result.get("content") or {}
    if _TRANSCRIPT_RELPATH not in content:
        raise ToolError(
            "invalid_state",
            f"no table transcript blob exists at the resolved commit "
            f"({_TRANSCRIPT_RELPATH})",
        )
    return _parse_jsonl_strict(content[_TRANSCRIPT_RELPATH], "table transcript")


def _require_str(row: dict[str, Any], key: str, where: str) -> str:
    value = row.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ToolError(
            "state_corrupt", f"{where} carries no valid {key}"
        )
    return value


def _verify_row_shape(row: dict[str, Any], *, index: int) -> dict[str, Any]:
    """Fail closed unless the row is a well-formed canonical table row whose
    canonical entry id, source identity, and text hash all check out. Only
    canonical table roles/kinds pass; tool/system log shapes are rejected
    before they can be returned."""
    where = f"table transcript row {index}"
    role = row.get("role")
    record_kind = row.get("record_kind")
    if role not in _ROLE_RECORD_KINDS:
        raise ToolError("state_corrupt", f"{where} carries an unknown role")
    if record_kind not in _ROLE_RECORD_KINDS[role]:
        raise ToolError(
            "state_corrupt",
            f"{where} pairs role {role!r} with record kind {record_kind!r}",
        )
    turn = row.get("turn")
    if isinstance(turn, bool) or not isinstance(turn, int) or turn < 0:
        raise ToolError("state_corrupt", f"{where} carries no valid turn number")
    text = row.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ToolError("state_corrupt", f"{where} carries no exact text")
    text_sha256 = row.get("text_sha256")
    if not isinstance(text_sha256, str) or not text_sha256:
        raise ToolError("state_corrupt", f"{where} carries no text hash")
    if text_sha256 != _canonical_digest(text):
        raise ToolError(
            "state_corrupt",
            f"{where} text hash mismatch: stored wording is corrupt",
        )
    _require_str(row, "turn_id", where)
    _require_str(row, "speaker", where)
    _require_str(row, "run_id", where)
    _require_str(row, "run_segment_id", where)
    _require_str(row, "session_id", where)
    source_id = row.get("source_id")
    journal_id = row.get("journal_decision_id")
    source_ref = row.get("source_ref")
    if record_kind == _PLAYER_TURN_RECORD_KIND:
        if not isinstance(journal_id, str) or not journal_id.strip():
            raise ToolError(
                "state_corrupt", f"{where} player row carries no journal identity"
            )
        if source_id != journal_id or source_ref != f"state.journal#{journal_id}":
            raise ToolError(
                "state_corrupt",
                f"{where} player row does not match its journal/transcript identity",
            )
    elif record_kind == _FINALIZED_KEEPER_RECORD_KIND:
        finalization_id = row.get("finalization_id")
        if not isinstance(finalization_id, str) or not finalization_id.strip():
            raise ToolError(
                "state_corrupt", f"{where} finalized KP row carries no finalization id"
            )
        if (
            source_id != finalization_id
            or source_ref != f"logs/turn-finalizations.jsonl#{finalization_id}"
        ):
            raise ToolError(
                "state_corrupt",
                f"{where} finalized KP row does not match its finalization identity",
            )
    else:  # _TABLE_OPENING_RECORD_KIND
        if not isinstance(source_id, str) or not source_id.strip():
            raise ToolError(
                "state_corrupt", f"{where} opening row carries no opening source id"
            )
        if journal_id not in (None, "") or source_ref != f"table.opening#{source_id}":
            raise ToolError(
                "state_corrupt",
                f"{where} opening row does not match its opening source identity",
            )
    # Canonical transcript entry identity: the digest-derived entry id must
    # equal the kernel's deterministic derivation for (role, source id).
    if row.get("entry_id") != _table_transcript_entry_id(role, str(source_id)):
        raise ToolError(
            "state_corrupt",
            f"{where} entry id does not match the canonical transcript "
            "entry identity derivation",
        )
    _row_source_token(row)
    return row


def _index_rows(rows: list[dict[str, Any]]) -> dict[tuple[str, str, str], dict[str, Any]]:
    """Verify every row and index by canonical identity. Duplicate canonical
    row identities or duplicate entry ids fail closed."""
    by_identity: dict[tuple[str, str, str], dict[str, Any]] = {}
    seen_entries: set[str] = set()
    for index, row in enumerate(rows):
        _verify_row_shape(row, index=index)
        identity = row_identity(row)
        if identity in by_identity:
            raise ToolError(
                "state_corrupt",
                f"duplicate canonical transcript row identity {identity!r} "
                "at the resolved commit",
            )
        entry_id = str(row.get("entry_id"))
        if entry_id in seen_entries:
            raise ToolError(
                "state_corrupt",
                f"duplicate canonical transcript entry id {entry_id!r} "
                "at the resolved commit",
            )
        seen_entries.add(entry_id)
        by_identity[identity] = row
    return by_identity


def _verify_opening_evidence(
    ctx: Ctx,
    transcript_result: dict[str, Any],
    evidence_result: dict[str, Any],
    row: dict[str, Any],
) -> None:
    """Authenticate an opening row against the independent, tracked
    ``evidence.table_opening`` toolbox receipt from the same historical Git
    commit. A transcript-only rewrite — even if it recomputes text hash and
    self-derived entry id — cannot satisfy this cross-record binding."""
    trailers = transcript_result.get("trailers")
    if not isinstance(trailers, dict) or trailers.get("Campaign-Id") != str(ctx.campaign_id):
        raise ToolError(
            "state_corrupt",
            "opening transcript commit does not bind the current campaign id",
        )
    content = evidence_result.get("content") or {}
    blob = content.get(_TOOLBOX_CALLS_RELPATH)
    if not isinstance(blob, str):
        raise ToolError(
            "state_corrupt",
            "opening transcript row has no tracked evidence.table_opening receipt",
        )
    source_id = _row_source_token(row)
    matches: list[dict[str, Any]] = []
    for call in _parse_jsonl_strict(blob, "table opening evidence"):
        if call.get("ok") is not True or call.get("tool") != "evidence.table_opening":
            continue
        args = call.get("args") if isinstance(call.get("args"), dict) else {}
        if args.get("decision_id") == source_id:
            matches.append(call)
    if not matches:
        raise ToolError(
            "state_corrupt",
            f"opening source decision {source_id!r} has no successful "
            "evidence.table_opening receipt in the historical commit",
        )
    expected = {
        "entry_id": row.get("entry_id"),
        "run_id": row.get("run_id"),
        "run_segment_id": row.get("run_segment_id"),
        "session_id": row.get("session_id"),
        "turn": 0,
        "turn_id": row.get("turn_id"),
        "journal_decision_id": row.get("journal_decision_id"),
        "role": "keeper",
        "source_id": source_id,
        "source_ref": f"table.opening#{source_id}",
        "record_kind": _TABLE_OPENING_RECORD_KIND,
        "text": row.get("text"),
        "text_sha256": row.get("text_sha256"),
    }
    for call in matches:
        args = call.get("args") if isinstance(call.get("args"), dict) else {}
        data = call.get("data") if isinstance(call.get("data"), dict) else {}
        if (
            args.get("decision_id") != source_id
            or args.get("run_id") != row.get("run_id")
        ):
            raise ToolError(
                "state_corrupt",
                "opening evidence args do not bind the transcript source decision/run",
            )
        for field, value in expected.items():
            if data.get(field) != value:
                raise ToolError(
                    "state_corrupt",
                    f"opening evidence {field} does not bind the transcript row",
                )


def _validated_historical_transcript(
    ctx: Ctx, commit_sha: str
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[tuple[str, str, str], dict[str, Any]]]:
    """Load one immutable transcript blob, reject malformed/duplicate rows,
    and independently authenticate every opening row with its tracked
    table-opening receipt from the same commit."""
    transcript_result = _blobs_at_commit(ctx, commit_sha, (_TRANSCRIPT_RELPATH,))
    rows = _transcript_rows_at(ctx, transcript_result)
    by_identity = _index_rows(rows)
    opening_rows = [
        row for row in rows
        if row.get("record_kind") == _TABLE_OPENING_RECORD_KIND
    ]
    if opening_rows:
        evidence_result = _blobs_at_commit(
            ctx, commit_sha, (_TOOLBOX_CALLS_RELPATH,)
        )
        for row in opening_rows:
            _verify_opening_evidence(ctx, transcript_result, evidence_result, row)
    return transcript_result, rows, by_identity


def _finalizations_at(ctx: Ctx, history_result: dict[str, Any]) -> dict[str, Any]:
    """Indexed finalized receipts from the same commit. Every receipt must
    satisfy the canonical production finalization contract; duplicated
    identity fails closed."""
    content = history_result.get("content") or {}
    if _FINALIZATIONS_RELPATH not in content:
        raise ToolError(
            "invalid_state",
            f"no turn-finalizations blob exists at the resolved commit "
            f"({_FINALIZATIONS_RELPATH})",
        )
    by_id: dict[str, dict[str, Any]] = {}
    by_journal: dict[str, dict[str, Any]] = {}
    for index, receipt in enumerate(_parse_jsonl_strict(
        content[_FINALIZATIONS_RELPATH], "turn finalizations"
    )):
        finalization_id = receipt.get("finalization_id")
        journal_id = receipt.get("journal_decision_id")
        if not isinstance(finalization_id, str) or not finalization_id.strip():
            raise ToolError(
                "state_corrupt",
                f"turn finalization record {index} carries no finalization_id",
            )
        if not isinstance(journal_id, str) or not journal_id.strip():
            raise ToolError(
                "state_corrupt",
                f"turn finalization {finalization_id!r} carries no journal_decision_id",
            )
        if finalization_id in by_id or journal_id in by_journal:
            raise ToolError(
                "state_corrupt",
                f"turn finalization identity is duplicated at the resolved commit: "
                f"{finalization_id!r}",
            )
        # Canonical production finalization contract (current schema):
        # closed field set, all structural hashes, segment/integrity
        # composition, and the receipt's own integrity digest.
        if not coc_turn_finalization._valid_finalization(receipt):
            raise ToolError(
                "state_corrupt",
                f"turn finalization {finalization_id!r} fails the canonical "
                "finalization contract at the resolved commit",
            )
        by_id[finalization_id] = receipt
        by_journal[journal_id] = receipt
    return {"by_id": by_id, "by_journal": by_journal}


# --------------------------------------------------------------------------- #
# Row integrity bindings
# --------------------------------------------------------------------------- #

def _bind_row_to_receipt(
    row: dict[str, Any], receipt: dict[str, Any], *, where: str,
    fields: tuple[str, ...],
) -> None:
    """Bind one transcript row to its settled receipt on the canonical
    identity fields that row carries: run segment, session, turn, journal
    decision for player rows; additionally finalization id, accepted
    revision, and rendered text/hash for the finalized KP row."""
    bindings = {
        "run_segment_id": (row.get("run_segment_id"), receipt.get("run_segment_id")),
        "session_id": (row.get("session_id"), receipt.get("session_id")),
        "turn_id": (row.get("turn_id"), receipt.get("turn_id")),
        "journal_decision_id": (
            row.get("journal_decision_id"), receipt.get("journal_decision_id")
        ),
        "finalization_id": (
            row.get("finalization_id"), receipt.get("finalization_id")
        ),
        "accepted_revision": (
            row.get("accepted_revision"), receipt.get("accepted_revision")
        ),
        "rendered_text_sha256": (
            row.get("rendered_text_sha256"), receipt.get("rendered_text_sha256")
        ),
    }
    for field in fields:
        row_value, receipt_value = bindings[field]
        if row_value != receipt_value:
            raise ToolError(
                "state_corrupt",
                f"{where} {field} mismatches its finalization receipt",
            )
    if "rendered_text_sha256" in fields and (
        row.get("text") != receipt.get("rendered_text")
    ):
        raise ToolError(
            "state_corrupt",
            f"{where} wording does not match its finalization receipt",
        )


def _verify_finalized_keeper_row(
    row: dict[str, Any], *, finalizations: dict[str, Any], where: str
) -> None:
    """Independently bind the finalized KP wording to the immutable
    turn-finalization receipt from the same historical commit, validated
    under the canonical production finalization contract."""
    receipt = finalizations["by_id"].get(row["finalization_id"])
    if receipt is None:
        raise ToolError(
            "state_corrupt",
            f"{where} references finalization {row['finalization_id']!r} which has "
            "no receipt in the resolved commit",
        )
    rendered = receipt.get("rendered_text")
    rendered_sha256 = receipt.get("rendered_text_sha256")
    if not isinstance(rendered, str) or not isinstance(rendered_sha256, str):
        raise ToolError(
            "state_corrupt",
            f"finalization {row['finalization_id']!r} carries no rendered text hash",
        )
    if rendered_sha256 != _canonical_digest(rendered):
        raise ToolError(
            "state_corrupt",
            f"finalization {row['finalization_id']!r} rendered text hash mismatch",
        )
    _bind_row_to_receipt(
        row, receipt, where=where,
        fields=(
            "run_segment_id", "session_id", "turn_id", "journal_decision_id",
            "finalization_id", "accepted_revision", "rendered_text_sha256",
        ),
    )


def _verify_player_row(
    row: dict[str, Any], *, finalizations: dict[str, Any], where: str
) -> str:
    """Bind the player wording to its journal identity, text hash, the
    settled receipt's run/session/turn identity, and the finalized
    player-input projection. Returns the extra verified-binding label."""
    receipt = finalizations["by_journal"].get(row["journal_decision_id"])
    if receipt is None:
        raise ToolError(
            "state_corrupt",
            f"{where} player row has no settled finalization receipt in the "
            "resolved commit",
        )
    projection = receipt.get("contract_projection")
    player_input = (
        projection.get("player_input") if isinstance(projection, dict) else None
    )
    if not isinstance(player_input, dict):
        # The canonical current contract always carries the finalized
        # player-input projection; a receipt without one cannot bind the
        # player wording and fails closed (clean-slate, no legacy path).
        raise ToolError(
            "state_corrupt",
            f"{where} player row's finalization receipt carries no finalized "
            "player-input projection",
        )
    projected_text = player_input.get("text")
    projected_sha256 = player_input.get("text_sha256")
    if not isinstance(projected_text, str) or not isinstance(projected_sha256, str):
        raise ToolError(
            "state_corrupt",
            f"{where} player row has a finalized projection without player text",
        )
    if projected_text != row["text"] or projected_sha256 != row["text_sha256"]:
        raise ToolError(
            "state_corrupt",
            f"{where} player wording does not match its finalized player-input "
            "projection",
        )
    _bind_row_to_receipt(
        row, receipt, where=where,
        fields=("run_segment_id", "session_id", "turn_id", "journal_decision_id"),
    )
    return "journal_receipt+player_input"


# --------------------------------------------------------------------------- #
# transcript.locate
# --------------------------------------------------------------------------- #

def _optional_int(args: dict[str, Any], key: str, *, minimum: int) -> int | None:
    value = args.get(key)
    if value in (None, ""):
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ToolError(
            "invalid_param",
            f"{key} must be an integer >= {minimum}, got {value!r}",
        )
    return value


def _optional_id_token(args: dict[str, Any], key: str) -> str | None:
    value = args.get(key)
    if value in (None, ""):
        return None
    if (
        not isinstance(value, str)
        or len(value) > _MAX_TOKEN_CHARS
        or not _SOURCE_TOKEN_RE.match(value)
    ):
        raise ToolError(
            "invalid_param",
            f"{key} must be a short exact identifier string, got {value!r}",
        )
    return value


def _optional_speaker(args: dict[str, Any]) -> str | None:
    """Speaker is an exact structured identity (a player-chosen name or
    KP), not a decision id and never a prose search: any short printable
    string matches exactly; no substring or fuzzy path exists."""
    value = args.get("speaker")
    if value in (None, ""):
        return None
    if (
        not isinstance(value, str)
        or not value.strip()
        or len(value) > _MAX_TOKEN_CHARS
        or re.search(r"[\r\n\x00-\x1f]", value)
    ):
        raise ToolError(
            "invalid_param",
            f"speaker must be a short exact identity string, got {value!r}",
        )
    return value


_SELECTOR_KEYS = (
    "turn", "turn_from", "turn_to", "role", "speaker",
    "turn_id", "journal_decision_id", "finalization_id",
)


def _parse_locate_args(args: dict[str, Any]) -> dict[str, Any]:
    turn = _optional_int(args, "turn", minimum=0)
    turn_from = _optional_int(args, "turn_from", minimum=0)
    turn_to = _optional_int(args, "turn_to", minimum=0)
    if turn_from is not None and turn_to is not None and turn_from > turn_to:
        raise ToolError(
            "invalid_param", "turn_from must not exceed turn_to"
        )
    if turn_to is not None and turn_to - (turn_from or 0) > _MAX_TURN_RANGE_SPAN:
        raise ToolError(
            "invalid_param",
            f"turn range span is bounded at {_MAX_TURN_RANGE_SPAN} turns; "
            "narrow the range",
        )
    role = args.get("role")
    if role not in (None, ""):
        if role not in _ROLE_RECORD_KINDS:
            raise ToolError(
                "invalid_param",
                f"role must be one of {sorted(_ROLE_RECORD_KINDS)}, got {role!r}",
            )
    speaker = _optional_speaker(args)
    turn_id = _optional_id_token(args, "turn_id")
    journal_id = _optional_id_token(args, "journal_decision_id")
    finalization_id = _optional_id_token(args, "finalization_id")
    selector: dict[str, Any] = {}
    if turn is not None:
        selector["turn"] = turn
    if turn_from is not None:
        selector["turn_from"] = turn_from
    if turn_to is not None:
        selector["turn_to"] = turn_to
    if role not in (None, ""):
        selector["role"] = role
    if speaker is not None:
        selector["speaker"] = speaker
    if turn_id is not None:
        selector["turn_id"] = turn_id
    if journal_id is not None:
        selector["journal_decision_id"] = journal_id
    if finalization_id is not None:
        selector["finalization_id"] = finalization_id
    if not selector:
        raise ToolError(
            "invalid_param",
            "transcript.locate requires at least one structured narrowing "
            f"selector ({', '.join(_SELECTOR_KEYS)}); free-prose search is "
            "not supported — relevance is the KP's semantic judgment",
        )
    offset = _optional_int(args, "offset", minimum=0) or 0
    limit = _optional_int(args, "limit", minimum=1)
    if limit is not None and limit > _MAX_PAGE_LIMIT:
        raise ToolError(
            "invalid_param",
            f"limit is bounded at {_MAX_PAGE_LIMIT}, got {limit}",
        )
    return {
        "selector": selector,
        "offset": offset,
        "limit": limit or _DEFAULT_PAGE_LIMIT,
    }


def _row_matches(row: dict[str, Any], selector: dict[str, Any]) -> bool:
    turn = row["turn"]
    if "turn" in selector and turn != selector["turn"]:
        return False
    if "turn_from" in selector and turn < selector["turn_from"]:
        return False
    if "turn_to" in selector and turn > selector["turn_to"]:
        return False
    if "role" in selector and row["role"] != selector["role"]:
        return False
    if "speaker" in selector and row["speaker"] != selector["speaker"]:
        return False
    if "turn_id" in selector and row["turn_id"] != selector["turn_id"]:
        return False
    if "journal_decision_id" in selector and (
        row.get("journal_decision_id") or None
    ) != selector["journal_decision_id"]:
        return False
    if "finalization_id" in selector and (
        row.get("finalization_id") or None
    ) != selector["finalization_id"]:
        return False
    return True


def _worldline_turn_numbers(ctx: Ctx, timeline_id: str) -> list[int]:
    """Turn numbers reachable from the requested timeline's immutable Git
    ref. Ownership is resolved separately for every number, so a merge
    ambiguity still fails closed exactly as transcript.read does."""
    turns: set[int] = set()
    for _sha, trailers in _worldline_log(ctx, timeline_id):
        if trailers.get("COC-Commit-Type") != "turn":
            continue
        raw_turn = trailers.get("Turn-Number")
        try:
            turn = int(str(raw_turn))
        except (TypeError, ValueError):
            continue
        if turn >= 1:
            turns.add(turn)
    return sorted(turns)


def _locate_turns(
    ctx: Ctx, timeline_id: str, selector: dict[str, Any]
) -> list[int]:
    """Select turn numbers structurally, then let each turn resolve through
    the exact same immutable Git ownership path as transcript.read. No
    mutable cumulative/tip transcript is ever used for range/speaker scans."""
    if "turn" in selector:
        return [selector["turn"]]
    lower = selector.get("turn_from")
    upper = selector.get("turn_to")
    selected = [
        turn for turn in _worldline_turn_numbers(ctx, timeline_id)
        if (lower is None or turn >= lower)
        and (upper is None or turn <= upper)
    ]
    # Opening is an optional pre-turn row for range/speaker discovery. Its
    # absence is a no-match, but malformed opening evidence remains fatal.
    opening_in_range = (lower is None or lower <= 0) and (upper is None or upper >= 0)
    if opening_in_range:
        try:
            _resolve_opening_commit(ctx, timeline_id, None)
        except ToolError as exc:
            if exc.code != "invalid_state":
                raise
        else:
            selected.insert(0, 0)
    return selected


def _rows_for_exact_turn(
    ctx: Ctx, timeline_id: str, turn: int
) -> list[dict[str, Any]]:
    """Read only the immutable transcript blob that owns this exact turn.
    Cumulative transcript files are filtered to their own turn before
    candidate creation, preventing later tip mutations from affecting a
    historical locator."""
    if turn == 0:
        commit_sha = _resolve_opening_commit(ctx, timeline_id, None)
    else:
        commit_sha, _source_timeline, _inherited = _resolve_turn_commit(
            ctx, timeline_id, turn
        )
    _result, rows, _by_identity = _validated_historical_transcript(ctx, commit_sha)
    return [row for row in rows if row["turn"] == turn]


def locate(ctx: Ctx, args: dict[str, Any]) -> tuple[dict[str, Any], list[str], list[str]]:
    """Bounded deterministic candidate narrowing over exact historical turn
    blobs. Every selected turn — explicit, range, speaker, or structured
    identity — resolves through the same immutable Git commit that
    transcript.read uses; a mutable timeline tip is never an aggregate
    source for candidate cards."""
    campaign_id = str(ctx.campaign_id)
    parsed = _parse_locate_args(args)
    timeline_id = _resolve_timeline_id(ctx, args)
    selector = parsed["selector"]
    matched: list[dict[str, Any]] = []
    for turn in _locate_turns(ctx, timeline_id, selector):
        matched.extend(
            row for row in _rows_for_exact_turn(ctx, timeline_id, turn)
            if _row_matches(row, selector)
        )
    offset = parsed["offset"]
    limit = parsed["limit"]
    total = len(matched)
    page = matched[offset:offset + limit]
    data: dict[str, Any] = {
        "schema_version": 1,
        "status": "matched" if total else "no_match",
        "campaign_id": campaign_id,
        "timeline_id": timeline_id,
        "selector": selector,
        "total_matches": total,
        "offset": offset,
        "limit": limit,
        "next_offset": (offset + limit) if offset + limit < total else None,
        "candidates": [
            {
                "transcript_ref": build_transcript_ref(timeline_id, row),
                "turn": row["turn"],
                "turn_id": row["turn_id"],
                "role": row["role"],
                "speaker": row["speaker"],
                "record_kind": row["record_kind"],
                "journal_decision_id": row.get("journal_decision_id") or None,
                "finalization_id": row.get("finalization_id"),
                "text_char_count": len(row["text"]),
                "read_operation": "transcript.read",
            }
            for row in page
        ],
    }
    return data, [], [
        "locators are structural cards only; which turn and wording the "
        "player means is your semantic judgment — never a keyword match",
        "pass transcript_ref values to transcript.read for the exact "
        "verified wording",
    ]


# --------------------------------------------------------------------------- #
# transcript.read
# --------------------------------------------------------------------------- #

def _parse_read_args(args: dict[str, Any]) -> list[dict[str, Any]]:
    refs = args.get("refs")
    if not isinstance(refs, list) or not refs:
        raise ToolError(
            "invalid_param",
            "transcript.read requires refs: an array of semantic locators "
            "returned by transcript.locate",
        )
    if len(refs) > _MAX_REFS:
        raise ToolError(
            "invalid_param", f"refs is bounded at {_MAX_REFS} locators per read"
        )
    if len(set(refs)) != len(refs):
        raise ToolError(
            "invalid_param", "refs must not repeat a locator"
        )
    text_offset = _optional_int(args, "text_offset", minimum=0) or 0
    text_limit = _optional_int(args, "text_limit", minimum=1)
    if text_limit is not None and text_limit > _MAX_READ_CALL_CHARS:
        raise ToolError(
            "invalid_param",
            f"text_limit is bounded at {_MAX_READ_CALL_CHARS} characters, "
            f"got {text_limit}",
        )
    parsed_refs = []
    for ref in refs:
        parsed = parse_transcript_ref(ref)
        parsed["ref"] = ref
        parsed_refs.append(parsed)
    return parsed_refs


def read(ctx: Ctx, args: dict[str, Any]) -> tuple[dict[str, Any], list[str], list[str]]:
    """Exact verified historical wording for semantic locators, resolved
    through the campaign Git history. No active-worktree fallback.

    Each locator resolves (timeline, turn) through immutable refs/DAG/
    trailers to one commit, reads that commit's transcript blob, and binds
    the row by canonical identity — a locator cannot drift when later rows
    are appended. Exact text is returned in bounded contiguous chunks;
    rows are never truncated and the response is never unbounded."""
    campaign_id = str(ctx.campaign_id)
    parsed_refs = _parse_read_args(args)
    text_offset = _optional_int(args, "text_offset", minimum=0) or 0
    text_limit = _optional_int(args, "text_limit", minimum=1) or _MAX_READ_CALL_CHARS
    groups: dict[tuple[str, int], list[dict[str, Any]]] = {}
    for parsed in parsed_refs:
        groups.setdefault((parsed["timeline_id"], parsed["turn"]), []).append(parsed)
    rows_out: list[dict[str, Any]] = []
    pending_cards: list[dict[str, Any]] = []
    inherited_any = False
    budget_left = _MAX_READ_CALL_CHARS
    for (timeline_id, turn), group in sorted(groups.items()):
        inherited = False
        if turn >= 1:
            commit_sha, source_timeline_id, inherited = _resolve_turn_commit(
                ctx, timeline_id, turn
            )
            _history_result, rows, by_identity = _validated_historical_transcript(
                ctx, commit_sha
            )
            finalizations: dict[str, Any] | None = None
        for parsed in group:
            if turn == 0:
                # Each opening locator binds to the immutable earliest commit
                # that first contains its own opening row. Opening rows carry
                # no finalization binding, so a missing receipts blob at that
                # earliest commit is not a corruption.
                commit_sha = _resolve_opening_commit(
                    ctx, timeline_id, parsed["token"]
                )
                source_timeline_id = timeline_id
                _history_result, rows, by_identity = _validated_historical_transcript(
                    ctx, commit_sha
                )
                finalizations = None
            inherited_any = inherited_any or inherited
            if budget_left <= 0:
                pending_cards.append({
                    "transcript_ref": parsed["ref"],
                    "disposition": "read_budget_exhausted",
                    "text_offset": text_offset,
                })
                continue
            row = by_identity.get(
                (parsed["role"], parsed["record_kind"], parsed["token"])
            )
            if row is None or row["turn"] != parsed["turn"]:
                raise ToolError(
                    "state_corrupt",
                    f"transcript ref {parsed['ref']!r} does not resolve to a "
                    f"row in the commit that owns turn {turn} of timeline "
                    f"{timeline_id!r}",
                )
            where = f"transcript ref {parsed['ref']!r}"
            verified: list[str] = ["text_hash"]
            if row["record_kind"] != _TABLE_OPENING_RECORD_KIND and finalizations is None:
                finalization_result = _blobs_at_commit(
                    ctx, commit_sha, (_FINALIZATIONS_RELPATH,)
                )
                finalizations = _finalizations_at(ctx, finalization_result)
            if row["record_kind"] == _FINALIZED_KEEPER_RECORD_KIND:
                assert finalizations is not None
                _verify_finalized_keeper_row(
                    row, finalizations=finalizations, where=where
                )
                verified.append("turn_finalization_receipt")
            elif row["record_kind"] == _PLAYER_TURN_RECORD_KIND:
                assert finalizations is not None
                verified.append(_verify_player_row(
                    row, finalizations=finalizations, where=where
                ))
            else:
                verified.append("table_opening_evidence")
            full_text = row["text"]
            if text_offset >= len(full_text):
                raise ToolError(
                    "invalid_param",
                    f"text_offset {text_offset} is beyond the end of "
                    f"{parsed['ref']!r} ({len(full_text)} characters)",
                )
            want = min(text_limit, len(full_text) - text_offset)
            take = min(want, budget_left)
            chunk = full_text[text_offset:text_offset + take]
            budget_left -= take
            chunk_end = text_offset + take
            rows_out.append({
                "transcript_ref": parsed["ref"],
                "timeline_id": source_timeline_id,
                "requested_timeline_id": timeline_id,
                "inherited": inherited,
                "turn": row["turn"],
                "turn_id": row["turn_id"],
                "role": row["role"],
                "speaker": row["speaker"],
                "record_kind": row["record_kind"],
                "journal_decision_id": row.get("journal_decision_id") or None,
                "finalization_id": row.get("finalization_id"),
                "source_ref": row["source_ref"],
                "text": chunk,
                "text_offset": text_offset,
                "text_chunk_chars": len(chunk),
                "text_total_chars": len(full_text),
                # Response-side integrity evidence: code computes and binds
                # the full-text digest; the model never relays a digest.
                "text_sha256": row["text_sha256"],
                "integrity": "verified",
                "verified_bindings": verified,
                "continuation": (
                    {
                        "operation": "transcript.read",
                        "refs": [parsed["ref"]],
                        "text_offset": chunk_end,
                    }
                    if chunk_end < len(full_text) else None
                ),
            })
    hints = [
        "this is the exact stored wording at the resolved historical commit; "
        "quote it verbatim and never regenerate or paraphrase it as a quote",
        "continue a continuation card with its exact text_offset to read the "
        "remainder; text is never truncated",
    ]
    if inherited_any:
        hints.append(
            "some rows were inherited from an ancestor worldline at the "
            "fork point; timeline_id on each row names the owning timeline"
        )
    data: dict[str, Any] = {
        "schema_version": 1,
        "campaign_id": campaign_id,
        "row_count": len(rows_out),
        "complete": not pending_cards and all(
            row["continuation"] is None for row in rows_out
        ),
        "read_budget_chars": _MAX_READ_CALL_CHARS,
        "rows": rows_out,
        "pending": pending_cards,
    }
    return data, [], hints
