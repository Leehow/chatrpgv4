#!/usr/bin/env python3
"""COC Keeper toolbox: the LLM-facing tool registry.

The keeper LLM drives every turn. It decides which tools to call based on
context and player behavior, then writes the story using the results as
reference. Tools live in four namespaces:

- ``rules.*``   hard parameter rules (dice, HP/SAN arithmetic). Results are
  authoritative: the keeper must quote them faithfully and never invent dice.
- flow (``scene.*``/``clues.*``/``npc.*``/``actions.*``)  read-only queries
  over compiled scenario data and world state. Flow-control checks (scene
  connectivity, clue prerequisites) surface as ``warnings``/``hints`` — they
  never block.
- ``director.*`` deterministic advisory scoring (pacing, storylets, secrets).
  Suggestions only; the keeper may ignore them.
- ``state.*``   transactional writes to the campaign save. Hard guarantees:
  atomic writes, ``decision_id`` idempotency, journal receipts. Narrative
  legality checks degrade to warnings.

Envelope: every tool returns ``{ok, tool, data, warnings, hints}``.

CLI:
    python3 coc_toolbox.py list [--json]
    python3 coc_toolbox.py describe <tool>
    python3 coc_toolbox.py <tool> --root . --campaign <id> [--json '<args>']
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
from copy import deepcopy
import hashlib
import importlib.util
import json
import random
import re
import sys
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

_HERE = Path(__file__).resolve().parent
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def _load_sibling(name: str, filename: str):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, _HERE / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


coc_state = _load_sibling("coc_state", "coc_state.py")
coc_fileio = _load_sibling("coc_fileio", "coc_fileio.py")
coc_roll = _load_sibling("coc_roll", "coc_roll.py")
coc_rules = _load_sibling("coc_rules", "coc_rules.py")
coc_scene_graph = _load_sibling("coc_scene_graph", "coc_scene_graph.py")
coc_npc_state = _load_sibling("coc_npc_state", "coc_npc_state.py")
coc_time = _load_sibling("coc_time", "coc_time.py")
coc_storylets = _load_sibling("coc_storylets", "coc_storylets.py")
coc_sanity = _load_sibling("coc_sanity", "coc_sanity.py")
coc_development = _load_sibling("coc_development_toolbox", "coc_development.py")
coc_runtime_ops = _load_sibling("coc_runtime_ops_toolbox", "coc_runtime_ops.py")
coc_narrative_enrichment = _load_sibling(
    "coc_narrative_enrichment_toolbox", "coc_narrative_enrichment.py"
)
coc_subsystem_executor = _load_sibling(
    "coc_subsystem_executor_toolbox", "coc_subsystem_executor.py"
)

SCENARIO_FILES = (
    "story-graph.json",
    "clue-graph.json",
    "npc-agendas.json",
    "pacing-map.json",
    "threat-fronts.json",
    "module-meta.json",
)

_LEDGER_MAX_ENTRIES = 300
_TOOL_TRANSACTION_WAIT_SECONDS = 10.0
_TOOL_TRANSIENT_RETRY_ATTEMPTS = 3
_TOOL_TRANSIENT_RETRY_DELAY_SECONDS = 0.05
_TRANSIENT_TOOL_ERRORS = {
    "campaign_busy", "subsystem_transaction_failed",
    "development_settlement_failed",
}
_SKILL_BASES_CACHE: dict[str, tuple[str, int]] | None = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ToolError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


# --------------------------------------------------------------------------- #
# Campaign context
# --------------------------------------------------------------------------- #

class Ctx:
    """Resolved campaign context shared by tool handlers."""

    def __init__(self, root: Path, campaign_id: str | None):
        self.root = root
        self.coc_root = root / ".coc"
        self.campaign_id = campaign_id
        if campaign_id:
            self.campaign_dir = self.coc_root / "campaigns" / campaign_id
            if not self.campaign_dir.is_dir():
                raise ToolError("unknown_campaign", f"no campaign at {self.campaign_dir}")
        else:
            self.campaign_dir = None
        self._scenario_cache: dict[str, Any] = {}
        self._roll_ids: set[str] | None = None
        self._roll_sequence = 0

    def scenario(self, name: str) -> dict[str, Any]:
        """Load a compiled scenario file (cached). Missing file -> {}."""
        if name in self._scenario_cache:
            return self._scenario_cache[name]
        data: dict[str, Any] = {}
        if self.campaign_dir is not None:
            path = self.campaign_dir / "scenario" / name
            if path.is_file():
                try:
                    loaded = json.loads(path.read_text(encoding="utf-8"))
                    if isinstance(loaded, dict):
                        data = loaded
                except (json.JSONDecodeError, OSError):
                    data = {}
        self._scenario_cache[name] = data
        return data

    @property
    def story_graph(self) -> dict[str, Any]:
        return self.scenario("story-graph.json")

    @property
    def clue_graph(self) -> dict[str, Any]:
        return self.scenario("clue-graph.json")

    @property
    def npc_agendas(self) -> dict[str, Any]:
        return self.scenario("npc-agendas.json")

    def world(self) -> dict[str, Any]:
        return coc_state.load_world_state(self.campaign_dir)

    def save_world(self, world: dict[str, Any]) -> None:
        coc_state.write_json_atomic(self.campaign_dir / "save" / "world-state.json", world)

    def pacing(self) -> dict[str, Any]:
        return coc_state.load_pacing_state(self.campaign_dir)

    def save_pacing(self, pacing: dict[str, Any]) -> None:
        coc_state.write_json_atomic(self.campaign_dir / "save" / "pacing-state.json", pacing)

    def flags(self) -> dict[str, Any]:
        path = self.campaign_dir / "save" / "flags.json"
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    return data
            except (json.JSONDecodeError, OSError):
                pass
        return {"schema_version": 1, "clues_found": {}, "decisions": [], "spoiler_reveals": [], "flags": {}}

    def save_flags(self, flags: dict[str, Any]) -> None:
        coc_state.write_json_atomic(self.campaign_dir / "save" / "flags.json", flags)

    def log_event(self, record: dict[str, Any]) -> None:
        record.setdefault("ts", _now_iso())
        coc_state.append_jsonl(self.campaign_dir / "logs" / "events.jsonl", record)

    def _next_roll_id(self) -> str:
        """Return a campaign-local, source-stable id for one actual dice event."""
        if self._roll_ids is None:
            self._roll_ids = set()
            path = self.campaign_dir / "logs" / "rolls.jsonl"
            if path.is_file():
                for line in path.read_text(encoding="utf-8").splitlines():
                    try:
                        row = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(row, dict) and row.get("roll_id") not in (None, ""):
                        self._roll_ids.add(str(row["roll_id"]))
            self._roll_sequence = len(self._roll_ids)
        prefix = re.sub(r"[^A-Za-z0-9._:-]+", "-", str(self.campaign_id or "campaign"))
        while True:
            self._roll_sequence += 1
            candidate = f"toolbox-{prefix}-{self._roll_sequence:06d}"
            if candidate not in self._roll_ids:
                self._roll_ids.add(candidate)
                return candidate

    def log_roll(self, record: dict[str, Any]) -> dict[str, Any]:
        """Append one canonical roll while retaining legacy flat fields.

        The nested payload is the evaluation/report contract.  Flat fields stay
        in place for older runtime consumers that predate that contract.
        """
        canonical = dict(record)
        roll_id = str(canonical.get("roll_id") or self._next_roll_id())
        canonical["roll_id"] = roll_id
        canonical.setdefault("event_type", "roll")
        canonical.setdefault("type", "roll")
        canonical.setdefault(
            "actor",
            canonical.get("actor_id") or canonical.get("investigator_id") or "keeper",
        )
        canonical.setdefault("visibility", "public")
        canonical.setdefault("source", "keeper_toolbox")
        canonical.setdefault("source_ref", f"logs/rolls.jsonl#{roll_id}")
        canonical.setdefault("ts", _now_iso())
        if not isinstance(canonical.get("payload"), dict):
            metadata = {
                "actor", "actor_id", "event_type", "kind", "payload", "roll_id",
                "source", "source_ref", "ts", "type", "visibility",
            }
            canonical["payload"] = {
                key: value for key, value in canonical.items() if key not in metadata
            }
        canonical["payload"].setdefault("roll_id", roll_id)
        coc_state.append_jsonl(self.campaign_dir / "logs" / "rolls.jsonl", canonical)
        return canonical

    # -- investigators -------------------------------------------------------

    def party_ids(self) -> list[str]:
        path = self.campaign_dir / "party.json"
        if path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                return [str(i) for i in (data.get("investigator_ids") or [])]
            except (json.JSONDecodeError, OSError):
                pass
        return []

    def sheet(self, investigator_id: str) -> dict[str, Any]:
        path = self.coc_root / "investigators" / investigator_id / "character.json"
        if not path.is_file():
            raise ToolError("unknown_investigator", f"no character sheet for {investigator_id}")
        data = coc_runtime_ops.read_development_guarded_character(
            self.campaign_dir, investigator_id, path
        )
        if not isinstance(data, dict):
            raise ToolError("bad_character_sheet", f"character sheet must be an object: {path}")
        return data

    def inv_state_path(self, investigator_id: str) -> Path:
        return self.campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"

    def inv_state(self, investigator_id: str) -> dict[str, Any]:
        path = self.inv_state_path(investigator_id)
        if not path.is_file():
            coc_state.seed_investigator_state_if_missing(
                self.root, self.campaign_id, investigator_id, sheet=self.sheet(investigator_id)
            )
        return json.loads(path.read_text(encoding="utf-8"))

    def save_inv_state(self, investigator_id: str, state: dict[str, Any]) -> None:
        coc_state.write_json_atomic(self.inv_state_path(investigator_id), state)

    # -- idempotency ledger ---------------------------------------------------

    def _ledger_path(self) -> Path:
        return self.campaign_dir / "save" / "toolbox-ledger.json"

    @staticmethod
    def _ledger_key(tool: str, decision_id: str) -> str:
        return json.dumps([str(tool), str(decision_id)], ensure_ascii=False, separators=(",", ":"))

    def ledger_lookup(self, tool: str, decision_id: str | None) -> dict[str, Any] | None:
        if not decision_id:
            return None
        path = self._ledger_path()
        if not path.is_file():
            return None
        try:
            ledger = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
        entries = ledger.get("entries") or {}
        if not isinstance(entries, dict):
            return None
        entry = entries.get(self._ledger_key(tool, str(decision_id)))
        if isinstance(entry, dict) and str(entry.get("tool")) == str(tool):
            return entry
        # Schema-v1 compatibility: accept a legacy decision-only entry only
        # when it belongs to this exact tool.  A different tool using the same
        # decision id must execute normally instead of inheriting stale data.
        legacy = entries.get(str(decision_id))
        if isinstance(legacy, dict) and str(legacy.get("tool")) == str(tool):
            return legacy
        return None

    def ledger_record(self, decision_id: str | None, tool: str, data: Any) -> None:
        if not decision_id:
            return
        path = self._ledger_path()
        ledger: dict[str, Any] = {"schema_version": 2, "entries": {}}
        if path.is_file():
            try:
                loaded = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict) and isinstance(loaded.get("entries"), dict):
                    ledger = loaded
            except (json.JSONDecodeError, OSError):
                pass
        ledger["schema_version"] = 2
        entries = ledger["entries"]
        entries[self._ledger_key(tool, str(decision_id))] = {
            "tool": tool,
            "decision_id": str(decision_id),
            "ts": _now_iso(),
            "data": data,
        }
        if len(entries) > _LEDGER_MAX_ENTRIES:
            ordered = sorted(entries.items(), key=lambda kv: str(kv[1].get("ts", "")))
            for key, _ in ordered[: len(entries) - _LEDGER_MAX_ENTRIES]:
                entries.pop(key, None)
        coc_state.write_json_atomic(path, ledger)


def _rng(args: dict[str, Any]) -> random.Random:
    seed = args.get("seed")
    return random.Random(seed) if seed is not None else random.Random()


# --------------------------------------------------------------------------- #
# Registry
# --------------------------------------------------------------------------- #

TOOLS: dict[str, dict[str, Any]] = {}


def tool(name: str, summary: str, params: dict[str, dict[str, Any]], *, needs_campaign: bool = True):
    def deco(fn: Callable[[Ctx, dict[str, Any]], tuple[Any, list[str], list[str]]]):
        TOOLS[name] = {
            "name": name,
            "summary": summary,
            "params": params,
            "needs_campaign": needs_campaign,
            "handler": fn,
        }
        return fn
    return deco


def _log_tool_call(
    ctx: Ctx,
    name: str,
    args: dict[str, Any],
    envelope: dict[str, Any],
    *,
    attempt: int = 1,
    max_attempts: int = 1,
    recovered_after_retry: bool = False,
    will_retry: bool = False,
) -> None:
    """Append a tool-call receipt for runtime event projection (best effort)."""
    if ctx is None or ctx.campaign_dir is None:
        return
    record = {
        "ts": _now_iso(),
        "tool": name,
        "ok": bool(envelope.get("ok")),
        "args": {k: v for k, v in args.items() if k != "seed"},
        "warnings": envelope.get("warnings") or [],
        "hints": envelope.get("hints") or [],
        "attempt": attempt,
        "max_attempts": max_attempts,
        "retryable": bool(envelope.get("retryable")),
        "will_retry": bool(will_retry),
    }
    if envelope.get("retry_exhausted"):
        record["retry_exhausted"] = True
    if recovered_after_retry:
        record["recovered_after_retry"] = True
    if not envelope.get("ok"):
        error = envelope.get("error") or {}
        record["error"] = error.get("code")
        record["error_message"] = error.get("message")
    try:
        coc_state.append_jsonl(ctx.campaign_dir / "logs" / "toolbox-calls.jsonl", record)
    except OSError:
        pass


def _error_recovery_hints(code: str) -> list[str]:
    hints = {
        "unknown_npc": [
            "call npc.query without npc_id to inspect authored ids; an improvised NPC may still be recorded with state.record_npc_engagement"
        ],
        "unknown_skill": [
            "inspect the investigator sheet or pass an explicit target; canonical rulebook base chances are used automatically when available"
        ],
        "invalid_param": [
            "call describe for the tool schema, then retry with corrected structured arguments"
        ],
        "treatment_already_used": [
            "the attempted treatment remains spent; consider another rules-valid treatment or natural recovery"
        ],
        "campaign_busy": [
            "automatic retries were bounded; retry later with the same decision_id so an already-settled write replays safely"
        ],
        "subsystem_transaction_failed": [
            "the subsystem rolled back the failed transaction; retry later with the same decision_id if automatic recovery is exhausted"
        ],
        "development_settlement_failed": [
            "the ending remains recorded and the development transaction was rolled back; retry with the same decision_id"
        ],
        "recovery_conflict": [
            "campaign mutation is paused because an interrupted settlement has foreign state divergence; preserve the listed paths and resolve the integrity conflict before retrying"
        ],
        "settlement_unavailable": [
            "record state.end_session first, then retry development.settle for that persisted ending"
        ],
        "settlement_target_conflict": [
            "retry the persisted ending for one of its frozen investigator_ids; party changes do not retarget an existing ending"
        ],
    }
    return list(hints.get(code, ["the keeper may continue with a different in-fiction approach or corrected tool arguments"]))


def run_tool(name: str, root: Path, campaign_id: str | None, args: dict[str, Any]) -> dict[str, Any]:
    """Programmatic entry point. Returns the envelope dict."""
    spec = TOOLS.get(name)
    if spec is None:
        return {"ok": False, "tool": name, "error": {"code": "unknown_tool", "message": f"unknown tool: {name}"}}
    def failure(code: str, message: str) -> dict[str, Any]:
        return {
            "ok": False,
            "tool": name,
            "error": {"code": code, "message": message},
            "hints": _error_recovery_hints(code),
        }

    def execute_transaction(ctx: Ctx) -> dict[str, Any]:
        try:
            data, warnings, hints = spec["handler"](ctx, args)
            envelope = {
                "ok": True,
                "tool": name,
                "data": data,
                "warnings": warnings,
                "hints": hints,
            }
        except ToolError as exc:
            envelope = {
                "ok": False,
                "tool": name,
                "error": {"code": exc.code, "message": exc.message},
            }
        except coc_runtime_ops.DevelopmentRecoveryConflict as exc:
            envelope = {
                "ok": False,
                "tool": name,
                "error": {"code": "recovery_conflict", "message": str(exc)},
                "recovery": {
                    "status": "RECOVERY_CONFLICT",
                    "transaction_id": exc.transaction_id,
                    "conflicting_paths": exc.conflicting_paths,
                },
            }
        except (ValueError, FileNotFoundError) as exc:
            envelope = {
                "ok": False,
                "tool": name,
                "error": {"code": "invalid_request", "message": str(exc)},
            }
        return envelope

    try:
        if spec["needs_campaign"] and not campaign_id:
            raise ToolError("missing_campaign", "this tool requires --campaign <id>")
        for pname, pspec in spec["params"].items():
            if pspec.get("required") and args.get(pname) in (None, ""):
                raise ToolError("missing_param", f"required parameter: {pname}")
    except ToolError as exc:
        envelope = failure(exc.code, exc.message)
        envelope.update({
            "attempts": 1,
            "max_attempts": 1,
            "retryable": False,
            "recovered_after_retry": False,
        })
        try:
            ctx = Ctx(root, campaign_id)
        except (ToolError, ValueError, FileNotFoundError):
            ctx = None
        if ctx is not None:
            _log_tool_call(ctx, name, args, envelope)
        return envelope

    try:
        max_attempts = max(1, int(_TOOL_TRANSIENT_RETRY_ATTEMPTS))
    except (TypeError, ValueError):
        max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        # A failed subsystem transaction may have rolled state back or completed
        # recovery writes.  Rebuild the context so a retry cannot reuse stale
        # scenario, state, or roll-id caches from the failed attempt.
        try:
            ctx = Ctx(root, campaign_id)
        except ToolError as exc:
            envelope = failure(exc.code, exc.message)
            ctx = None
        except (ValueError, FileNotFoundError) as exc:
            envelope = failure("invalid_request", str(exc))
            ctx = None

        if ctx is not None and ctx.campaign_dir is None:
            envelope = execute_transaction(ctx)
        elif ctx is not None:
            try:
                with coc_fileio.campaign_lock(
                    ctx.campaign_dir,
                    wait_seconds=_TOOL_TRANSACTION_WAIT_SECONDS,
                ):
                    try:
                        coc_runtime_ops.recover_development_transactions(
                            ctx.campaign_dir
                        )
                    except coc_runtime_ops.DevelopmentRecoveryConflict as exc:
                        envelope = failure("recovery_conflict", str(exc))
                        envelope["recovery"] = {
                            "status": "RECOVERY_CONFLICT",
                            "transaction_id": exc.transaction_id,
                            "conflicting_paths": exc.conflicting_paths,
                        }
                    else:
                        envelope = execute_transaction(ctx)
            except coc_fileio.CampaignLockError as exc:
                envelope = failure("campaign_busy", str(exc))

        error_code = str((envelope.get("error") or {}).get("code") or "")
        retryable = not envelope.get("ok") and error_code in _TRANSIENT_TOOL_ERRORS
        recovered = bool(envelope.get("ok") and attempt > 1)
        if not envelope.get("ok"):
            envelope.setdefault("hints", _error_recovery_hints(error_code))
        envelope["attempts"] = attempt
        envelope["max_attempts"] = max_attempts
        envelope["retryable"] = retryable
        if retryable and attempt >= max_attempts:
            envelope["retry_exhausted"] = True
        envelope["recovered_after_retry"] = recovered
        will_retry = bool(retryable and attempt < max_attempts)
        # Recovery conflict is a strict, non-mutating reusable-state barrier;
        # even the best-effort toolbox audit log must remain byte-identical.
        if ctx is not None and error_code.lower() != "recovery_conflict":
            _log_tool_call(
                ctx,
                name,
                args,
                envelope,
                attempt=attempt,
                max_attempts=max_attempts,
                recovered_after_retry=recovered,
                will_retry=will_retry,
            )
        if not retryable or attempt >= max_attempts:
            return envelope
        time.sleep(_TOOL_TRANSIENT_RETRY_DELAY_SECONDS * attempt)

    raise AssertionError("tool retry loop exhausted without returning")


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #

def _scene_by_id(story_graph: dict[str, Any], scene_id: str | None) -> dict[str, Any] | None:
    if not scene_id:
        return None
    for scene in story_graph.get("scenes") or []:
        if isinstance(scene, dict) and str(scene.get("scene_id")) == str(scene_id):
            return scene
    return None


def _all_clues(clue_graph: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for conclusion in clue_graph.get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        for clue in conclusion.get("clues") or []:
            if isinstance(clue, dict) and clue.get("clue_id"):
                entry = dict(clue)
                entry["conclusion_id"] = conclusion.get("conclusion_id")
                out.append(entry)
    return out


def _clue_by_id(clue_graph: dict[str, Any], clue_id: str) -> dict[str, Any] | None:
    for clue in _all_clues(clue_graph):
        if str(clue.get("clue_id")) == str(clue_id):
            return clue
    return None


def _entity_key(value: Any) -> str:
    normalized = unicodedata.normalize("NFKC", str(value)).casefold()
    return " ".join(
        "".join(character if character.isalnum() else " " for character in normalized).split()
    )


def _npc_by_id(npc_agendas: dict[str, Any], npc_id: str) -> dict[str, Any] | None:
    """Resolve a structured NPC id/name/alias, allowing only unambiguous short ids."""
    query = _entity_key(npc_id)
    if not query:
        return None
    npcs = [npc for npc in (npc_agendas.get("npcs") or []) if isinstance(npc, dict)]
    exact: list[dict[str, Any]] = []
    short: list[dict[str, Any]] = []
    ignored_tokens = {"npc", "mr", "mrs", "ms", "miss", "dr", "the", "of"}
    for npc in npcs:
        aliases = npc.get("aliases") or []
        if isinstance(aliases, str):
            aliases = [aliases]
        values = [npc.get("npc_id"), npc.get("name"), *aliases]
        keys = {_entity_key(value) for value in values if value not in (None, "")}
        if query in keys:
            exact.append(npc)
            continue
        tokens: set[str] = set()
        for key in keys:
            tokens.update(token for token in key.split() if token not in ignored_tokens)
        if query in tokens:
            short.append(npc)
    matches = exact or short
    return matches[0] if len(matches) == 1 else None


def _npc_identity_contract(
    npc: dict[str, Any],
    active_scene_id: str | None,
) -> dict[str, Any]:
    """Project one stable authored identity without interpreting free prose.

    ``identity_ref`` binds the exact structured producer fields returned to the
    Keeper.  It is evidence that the consumer selected this authored identity,
    not an audit of the narration itself.
    """
    schedule = deepcopy(npc.get("schedule") or [])
    schedule_rows = schedule if isinstance(schedule, list) else [schedule]
    authored_scene_ids: set[str] = set()
    for row in schedule_rows:
        if not isinstance(row, dict):
            continue
        for scene_id in row.get("scene_ids") or []:
            if scene_id not in (None, ""):
                authored_scene_ids.add(str(scene_id))
    identity_source = {
        "npc_id": npc.get("npc_id"),
        "name": npc.get("name"),
        "origin": npc.get("origin"),
        "agenda": npc.get("agenda"),
        "voice": npc.get("voice"),
        "relationship_to_investigators": npc.get("relationship_to_investigators"),
        "social_role": deepcopy(npc.get("social_role")),
        "schedule": schedule,
        "source_refs": deepcopy(npc.get("source_refs") or []),
    }
    encoded = json.dumps(
        identity_source,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    identity_ref = f"npc-identity-v1:{hashlib.sha256(encoded).hexdigest()[:24]}"
    active = str(active_scene_id) if active_scene_id not in (None, "") else None
    scene_match: bool | None = None
    if authored_scene_ids:
        scene_match = bool(active and active in authored_scene_ids)
    return {
        "keeper_only": True,
        "npc_id": npc.get("npc_id"),
        "name": npc.get("name"),
        "origin": npc.get("origin"),
        "identity_ref": identity_ref,
        "role": {
            "relationship_to_investigators": npc.get("relationship_to_investigators"),
            "social_role": deepcopy(npc.get("social_role")),
        },
        "agenda": npc.get("agenda"),
        "voice": npc.get("voice"),
        "schedule": schedule,
        "location_provenance": {
            "active_scene_id": active,
            "authored_scene_ids": sorted(authored_scene_ids),
            "active_scene_matches_schedule": scene_match,
        },
        "source_refs": deepcopy(npc.get("source_refs") or []),
    }


def _canonical_skill_base(skill: Any) -> tuple[str, int] | None:
    """Return an authored rulebook base chance for a known skill when numeric."""
    global _SKILL_BASES_CACHE
    if _SKILL_BASES_CACHE is None:
        _SKILL_BASES_CACHE = {}
        path = _HERE.parent / "references" / "rules-json" / "skills.json"
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = {}
        for canonical, spec in (payload.get("skills") or {}).items():
            if not isinstance(spec, dict):
                continue
            base = spec.get("base_chance")
            if isinstance(base, int) and not isinstance(base, bool):
                _SKILL_BASES_CACHE[str(canonical).casefold()] = (str(canonical), int(base))
    return _SKILL_BASES_CACHE.get(str(skill).casefold())


def _clue_public_view(clue: dict[str, Any], discovered: set[str]) -> dict[str, Any]:
    clue_id = str(clue.get("clue_id"))
    is_discovered = clue_id in discovered
    view = {
        "clue_id": clue.get("clue_id"),
        "conclusion_id": clue.get("conclusion_id"),
        "discovered": is_discovered,
        "delivery": clue.get("delivery"),
        "delivery_kind": clue.get("delivery_kind"),
        "skill": clue.get("skill"),
        "difficulty": clue.get("difficulty"),
        "player_safe_summary": clue.get("player_safe_summary") if is_discovered else None,
        "localized_text": clue.get("localized_text") if is_discovered else None,
        "secret": not is_discovered,
    }
    if not is_discovered:
        view["keeper_only"] = {
            "secret": True,
            "content_available_after": "state.record_clue",
        }
    return view


def _flags_set(ctx: Ctx) -> set[str]:
    flags = ctx.flags().get("flags") or {}
    return {str(k) for k, v in flags.items() if v}


def _clock_reached(ctx: Ctx) -> Callable[[str | None, int], bool]:
    threat_path = ctx.campaign_dir / "save" / "threat-state.json"
    clocks: dict[str, Any] = {}
    if threat_path.is_file():
        try:
            clocks = (json.loads(threat_path.read_text(encoding="utf-8")) or {}).get("clocks") or {}
        except (json.JSONDecodeError, OSError):
            clocks = {}

    def reached(clock_id: str | None, threshold: int) -> bool:
        if not clock_id:
            return False
        clock = clocks.get(str(clock_id))
        if not isinstance(clock, dict):
            return False
        return int(clock.get("filled", 0)) >= int(threshold)

    return reached


def _evaluate_and_apply_unlocks(ctx: Ctx, world: dict[str, Any]) -> list[str]:
    newly = coc_scene_graph.evaluate_unlocks(
        ctx.story_graph,
        world,
        clock_reached=_clock_reached(ctx),
        flags_set=_flags_set(ctx),
    )
    return coc_scene_graph.apply_unlocks_to_world(world, newly)


def _resolve_investigator(ctx: Ctx, args: dict[str, Any]) -> str:
    inv = args.get("investigator")
    if not inv:
        party = ctx.party_ids()
        if len(party) == 1:
            return party[0]
        raise ToolError("missing_param", "required parameter: investigator (party has %d members)" % len(party))
    return str(inv)


def _read_object(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _read_jsonl_records(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    records: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return []
    for line in lines:
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            records.append(value)
    return records


def _flag_change_projection(
    row: dict[str, Any],
    *,
    source_ref: str,
) -> dict[str, Any]:
    return {
        "flag_id": str(row.get("flag_id")),
        "value": bool(row.get("value")),
        "provenance": {
            "source": "state.set_flag",
            "source_ref": source_ref,
            "decision_id": row.get("decision_id"),
            "changed_at": row.get("ts"),
            "reason": row.get("reason"),
            "previous_value": row.get("previous_value"),
        },
    }


def _world_flag_continuity(ctx: Ctx) -> dict[str, list[dict[str, Any]]]:
    flags_doc = ctx.flags()
    flag_map = flags_doc.get("flags") or {}
    provenance_map = flags_doc.get("flag_provenance") or {}
    if not isinstance(flag_map, dict):
        flag_map = {}
    if not isinstance(provenance_map, dict):
        provenance_map = {}

    event_changes: list[dict[str, Any]] = []
    latest_event_by_id: dict[str, dict[str, Any]] = {}
    for line_number, row in enumerate(
        _read_jsonl_records(ctx.campaign_dir / "logs" / "events.jsonl"),
        start=1,
    ):
        if row.get("event_type") != "flag_set" or row.get("flag_id") in (None, ""):
            continue
        projected = _flag_change_projection(
            row,
            source_ref=f"logs/events.jsonl#{line_number}",
        )
        event_changes.append(projected)
        latest_event_by_id[projected["flag_id"]] = projected["provenance"]

    live: list[dict[str, Any]] = []
    for flag_id, value in sorted(flag_map.items(), key=lambda pair: str(pair[0])):
        if not value:
            continue
        stable_id = str(flag_id)
        provenance = provenance_map.get(stable_id)
        if not isinstance(provenance, dict):
            provenance = latest_event_by_id.get(stable_id)
        if not isinstance(provenance, dict):
            provenance = {
                "source": "save.flags",
                "source_ref": f"save/flags.json#flags/{stable_id}",
                "decision_id": None,
                "changed_at": None,
                "reason": None,
                "previous_value": None,
            }
        live.append({
            "flag_id": stable_id,
            "value": True,
            "provenance": deepcopy(provenance),
        })
    return {
        "live_world_flags": live,
        "recent_world_flag_changes": event_changes[-12:],
    }


def _time_markers_path(ctx: Ctx) -> Path:
    return ctx.campaign_dir / "save" / "time-markers.json"


def _load_time_markers(ctx: Ctx) -> dict[str, Any]:
    payload = _read_object(_time_markers_path(ctx))
    markers = payload.get("markers")
    if not isinstance(markers, dict):
        markers = {}
    return {"schema_version": 1, "markers": markers}


def _save_time_markers(ctx: Ctx, payload: dict[str, Any]) -> None:
    coc_state.write_json_atomic(_time_markers_path(ctx), payload)


def _deadline_due_at(current: dict[str, Any], minutes_from_now: int) -> dict[str, Any]:
    elapsed = int(current.get("elapsed_minutes") or 0)
    local_value = current.get("local_datetime")
    due_local: str | None = None
    due_display: str | None = None
    if local_value:
        try:
            due_dt = datetime.fromisoformat(str(local_value)) + timedelta(
                minutes=minutes_from_now
            )
            due_local = due_dt.isoformat()
            due_display = due_dt.strftime("%Y-%m-%d %H:%M")
            current_display = str(current.get("display") or "")
            if "," in current_display:
                due_display += current_display[current_display.index(","):]
        except (TypeError, ValueError):
            due_local = None
            due_display = None
    return {
        "elapsed_minutes": elapsed + minutes_from_now,
        "local_datetime": due_local,
        "display": due_display,
    }


def _project_time_marker(
    marker: dict[str, Any],
    current: dict[str, Any],
) -> dict[str, Any]:
    due_at = marker.get("due_at") if isinstance(marker.get("due_at"), dict) else {}
    status = str(marker.get("status") or "active")
    remaining: int | None = None
    if due_at.get("elapsed_minutes") is not None:
        try:
            remaining = int(due_at["elapsed_minutes"]) - int(
                current.get("elapsed_minutes") or 0
            )
        except (TypeError, ValueError):
            remaining = None
    if status != "active":
        timing_state = status
    elif remaining is None:
        timing_state = "unknown"
    elif remaining < 0:
        timing_state = "overdue"
    elif remaining == 0:
        timing_state = "due"
    else:
        timing_state = "pending"
    return {
        "marker_id": marker.get("marker_id"),
        "label": marker.get("label"),
        "status": status,
        "revision": int(marker.get("revision") or 1),
        "due_at": deepcopy(due_at),
        "current_time": deepcopy(current),
        "remaining_minutes": remaining,
        "overdue": bool(status == "active" and remaining is not None and remaining < 0),
        "timing_state": timing_state,
        "provenance": {
            "source": "state.time_marker",
            "decision_id": marker.get("decision_id"),
            "created_at": marker.get("created_at"),
            "updated_at": marker.get("updated_at"),
            "reason": marker.get("reason"),
        },
    }


def _active_time_markers(ctx: Ctx) -> list[dict[str, Any]]:
    current = coc_time.current_stamp(ctx.campaign_dir)
    payload = _load_time_markers(ctx)
    active = [
        _project_time_marker(marker, current)
        for marker in payload["markers"].values()
        if isinstance(marker, dict) and marker.get("status") == "active"
    ]
    return sorted(
        active,
        key=lambda marker: (
            int((marker.get("due_at") or {}).get("elapsed_minutes") or 0),
            str(marker.get("marker_id") or ""),
        ),
    )


def _investigator_combat_profile(
    ctx: Ctx, investigator_id: str,
) -> dict[str, Any]:
    """Project canonical structured combat inputs without reading prose."""
    sheet = ctx.sheet(investigator_id)
    state = ctx.inv_state(investigator_id)
    characteristics = sheet.get("characteristics") or {}
    skills = sheet.get("skills") or {}
    derived = sheet.get("derived") or {}
    damage = coc_rules.damage_bonus_build(
        int(characteristics.get("STR", 50)),
        int(characteristics.get("SIZ", 50)),
    )
    weapons = [
        deepcopy(item)
        for item in (sheet.get("weapons") or [])
        if isinstance(item, dict)
        and isinstance(item.get("weapon_id"), str)
        and item["weapon_id"].strip()
    ]
    if not any(item.get("weapon_id") == "unarmed" for item in weapons):
        weapons.append({"weapon_id": "unarmed"})
    return {
        "actor_id": investigator_id,
        "side": "investigator",
        "dex": int(characteristics.get("DEX", 50)),
        "combat_skill": int(skills.get("Fighting (Brawl)", 25)),
        "dodge_skill": int(
            skills.get(
                "Dodge",
                max(1, int(characteristics.get("DEX", 50)) // 2),
            )
        ),
        "firearms_skill": int(skills.get("Firearms (Handgun)", 0)),
        "has_ready_firearm": False,
        "build": int(damage["build"]),
        "damage_bonus": str(damage["damage_bonus"]),
        "hp_max": int(state.get("hp_max", derived.get("HP", 10))),
        "hp_current": int(state.get("current_hp", derived.get("HP", 10))),
        "con": int(characteristics.get("CON", 50)),
        "magic_points": int(state.get("current_mp", derived.get("MP", 0))),
        "armor": 0,
        "armor_rule": None,
        "weapons": weapons,
        "conditions": list(state.get("conditions") or []),
    }


def _combat_state(ctx: Ctx) -> dict[str, Any]:
    return _read_object(ctx.campaign_dir / "save" / "combat.json")


def _affordance_by_id(scene: dict[str, Any] | None, affordance_id: str) -> dict[str, Any] | None:
    for affordance in (scene or {}).get("affordances") or []:
        if (
            isinstance(affordance, dict)
            and str(affordance.get("id")) == str(affordance_id)
        ):
            return affordance
    return None


_CHARACTERISTIC_NAMES = {"STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK"}


def _resolve_target_value(
    ctx: Ctx,
    investigator_id: str,
    args: dict[str, Any],
) -> tuple[int, str, str]:
    """Resolve the percentile target from explicit value, skill, or characteristic."""
    if args.get("target") is not None:
        return (
            int(args["target"]),
            str(args.get("skill") or args.get("characteristic") or "explicit target"),
            "explicit",
        )
    sheet = ctx.sheet(investigator_id)
    characteristic = args.get("characteristic")
    if characteristic:
        cname = str(characteristic).upper()
        if cname == "SAN":
            return int(ctx.inv_state(investigator_id).get("current_san", 0)), "SAN", "state"
        if cname == "LUCK":
            return int(ctx.inv_state(investigator_id).get("current_luck", 0)), "LUCK", "state"
        value = (sheet.get("characteristics") or {}).get(cname)
        if value is None:
            raise ToolError("unknown_characteristic", f"{cname} not on sheet")
        return int(value), cname, "sheet"
    skill = args.get("skill")
    if not skill:
        raise ToolError("missing_param", "provide skill, characteristic, or target")
    skills = sheet.get("skills") or {}
    if skill in skills:
        return int(skills[skill]), str(skill), "sheet"
    lowered = {str(k).lower(): (k, v) for k, v in skills.items()}
    hit = lowered.get(str(skill).lower())
    if hit is not None:
        return int(hit[1]), str(hit[0]), "sheet"
    cname = str(skill).upper()
    if cname in _CHARACTERISTIC_NAMES:
        value = (sheet.get("characteristics") or {}).get(cname)
        if value is not None:
            return int(value), cname, "sheet"
    base = _canonical_skill_base(skill)
    if base is not None:
        canonical, value = base
        return value, canonical, "rulebook_base"
    raise ToolError("unknown_skill", f"skill not on sheet: {skill}")


def _mark_improvement_tick(
    ctx: Ctx,
    investigator_id: str,
    skill: str,
    roll_result: dict[str, Any],
    *,
    source_event_id: str,
    source_kind: str,
) -> bool:
    tick = coc_development.record_skill_tick(
        ctx.campaign_dir,
        investigator_id,
        skill,
        roll_result,
        source_event_id=source_event_id,
        source_kind=source_kind,
    )
    if tick is None:
        return False
    if tick.get("development_event_status") == "already_claimed":
        return False
    state = ctx.inv_state(investigator_id)
    events = state.get("skill_check_events")
    if not isinstance(events, list):
        events = []
    token = tick["event_token"]
    if not any(
        isinstance(row, dict) and row.get("event_token") == token
        for row in events
    ):
        events.append({
            "event_token": token,
            "skill": skill,
            "campaign_id": tick["campaign_id"],
            "session_id": tick["session_id"],
            "source_kind": tick["source_kind"],
            "source_event_id": tick["source_event_id"],
        })
    state["skill_check_events"] = events
    state["skill_checks_earned"] = list(dict.fromkeys(
        str(row.get("skill"))
        for row in events
        if isinstance(row, dict) and isinstance(row.get("skill"), str)
    ))
    ctx.save_inv_state(investigator_id, state)
    return True


def _roll_common(
    ctx: Ctx,
    args: dict[str, Any],
    *,
    pushed: bool,
    tool_name: str,
) -> tuple[dict[str, Any], list[str], list[str]]:
    prior = ctx.ledger_lookup(tool_name, args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    investigator_id = _resolve_investigator(ctx, args)
    target, label, target_source = _resolve_target_value(ctx, investigator_id, args)
    difficulty = str(args.get("difficulty") or "regular")
    bonus = int(args.get("bonus") or 0)
    penalty = int(args.get("penalty") or 0)
    result = coc_roll.percentile_check(target, difficulty, bonus, penalty, rng=_rng(args))
    result["investigator_id"] = investigator_id
    result["skill"] = label
    result["target_source"] = target_source
    result["pushed"] = pushed
    if args.get("reason"):
        result["reason"] = str(args["reason"])
    if pushed and args.get("method_changed"):
        result["method_changed"] = str(args["method_changed"])
    if pushed and args.get("failure_consequence"):
        consequence = {"summary": str(args["failure_consequence"])}
        result["failure_consequence"] = consequence
        result["announced_consequence"] = consequence
    if args.get("fumble_consequence"):
        result["fumble_consequence"] = {
            "summary": str(args["fumble_consequence"])
        }

    warnings: list[str] = []
    hints: list[str] = []
    if target_source == "rulebook_base":
        hints.append(
            f"{label} is not listed on the investigator sheet; used the canonical rulebook base chance {target}%"
        )
    outcome = result["outcome"]
    success = outcome in ("regular", "hard", "extreme", "critical")
    if (
        success
        and not pushed
        and args.get("skill") not in (None, "")
        and label not in _CHARACTERISTIC_NAMES
        and label not in ("SAN", "LUCK")
    ):
        if _mark_improvement_tick(
            ctx,
            investigator_id,
            label,
            result,
            source_event_id=f"{tool_name}:{args['decision_id']}",
            source_kind=tool_name,
        ):
            hints.append(f"success: improvement tick recorded for {label}")
    if outcome == "critical":
        hints.append("critical success: consider an exceptional narrative payoff")
    if outcome == "fumble":
        hints.append("fumble: narrate a meaningful complication, not just failure")
    if not success and not pushed:
        hints.append(
            "failed: the player may push this roll with a changed method and an announced consequence (rules.push)"
        )
    if pushed and not success:
        hints.append(
            "pushed roll failed: a pushed failure carries a real consequence — narrate it and make it stick"
        )
    roll_record = ctx.log_roll({
        "event_type": "roll",
        "kind": "pushed_skill_check" if pushed else "skill_check",
        "actor": investigator_id,
        "visibility": "public",
        "payload": dict(result),
        **result,
    })
    ctx.ledger_record(args.get("decision_id"), tool_name, result)
    return result, warnings, hints


# --------------------------------------------------------------------------- #
# rules.* — hard parameter rules
# --------------------------------------------------------------------------- #

@tool(
    "rules.roll",
    "Percentile skill/characteristic check for an investigator. Deterministic dice; result is authoritative.",
    {
        "investigator": {"type": "string", "desc": "investigator id (optional when party has one member)"},
        "skill": {"type": "string", "desc": "skill name on the sheet (e.g. 'Library Use')"},
        "characteristic": {"type": "string", "desc": "characteristic (STR/CON/.../SAN/LUCK) instead of a skill"},
        "target": {"type": "integer", "desc": "explicit target value override"},
        "difficulty": {"type": "string", "desc": "regular | hard | extreme (default regular)"},
        "bonus": {"type": "integer", "desc": "bonus dice 0-2"},
        "penalty": {"type": "integer", "desc": "penalty dice 0-2"},
        "reason": {"type": "string", "desc": "what the roll is for (logged)"},
        "fumble_consequence": {
            "type": "string",
            "desc": "predeclared meaningful complication if this roll fumbles (dice evidence)",
        },
        "seed": {"type": "integer", "desc": "deterministic RNG seed (tests only)"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_rules_roll(ctx: Ctx, args: dict[str, Any]):
    return _roll_common(ctx, args, pushed=False, tool_name="rules.roll")


@tool(
    "rules.push",
    "Pushed re-roll after a failure. Requires both a changed method and the consequence announced before rolling.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "skill": {"type": "string", "desc": "skill name"},
        "characteristic": {"type": "string", "desc": "characteristic instead of a skill"},
        "target": {"type": "integer", "desc": "explicit target override"},
        "difficulty": {"type": "string", "desc": "regular | hard | extreme"},
        "bonus": {"type": "integer", "desc": "bonus dice"},
        "penalty": {"type": "integer", "desc": "penalty dice"},
        "method_changed": {"type": "string", "required": True, "desc": "how the approach differs from the first attempt"},
        "failure_consequence": {
            "type": "string",
            "required": True,
            "desc": "specific failure consequence announced to the player before the pushed roll",
        },
        "fumble_consequence": {
            "type": "string",
            "desc": "specific escalation if the pushed roll fumbles",
        },
        "reason": {"type": "string", "desc": "what the push is for"},
        "seed": {"type": "integer", "desc": "deterministic RNG seed"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_rules_push(ctx: Ctx, args: dict[str, Any]):
    data, warnings, hints = _roll_common(ctx, args, pushed=True, tool_name="rules.push")
    hints.insert(0, "the recorded failure_consequence is authoritative; apply it if the pushed roll fails")
    return data, warnings, hints


@tool(
    "rules.roll_dice",
    "Roll an arbitrary dice expression (e.g. '1D6+1') for damage, SAN loss amounts, or randomization.",
    {
        "expression": {"type": "string", "required": True, "desc": "NdM(+/-k) expression"},
        "reason": {"type": "string", "desc": "what the roll is for (logged)"},
        "seed": {"type": "integer", "desc": "deterministic RNG seed"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_rules_roll_dice(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("rules.roll_dice", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    result = coc_roll.roll_expression(str(args["expression"]), rng=_rng(args))
    if args.get("reason"):
        result["reason"] = str(args["reason"])
    payload = {
        **result,
        "die_expression": result["expression"],
        "individual_faces": list(result["rolls"]),
        "final_total": result["total"],
        "roll": result["total"],
    }
    roll_record = ctx.log_roll({
        "event_type": "roll",
        "type": "random_table",
        "kind": "dice_expression",
        "actor": "keeper",
        "visibility": "public",
        "payload": payload,
        **result,
    })
    ctx.ledger_record(args.get("decision_id"), "rules.roll_dice", result)
    return result, [], []


@tool(
    "rules.opposed",
    "Opposed check: investigator skill vs an opponent value. Higher success level wins; ties favor the higher value.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "skill": {"type": "string", "desc": "investigator skill"},
        "characteristic": {"type": "string", "desc": "characteristic instead of a skill"},
        "target": {"type": "integer", "desc": "explicit investigator target override"},
        "opponent_value": {"type": "integer", "required": True, "desc": "opponent's skill/characteristic value"},
        "opponent_label": {"type": "string", "desc": "opponent description (logged)"},
        "reason": {"type": "string", "desc": "what the contest is about"},
        "seed": {"type": "integer", "desc": "deterministic RNG seed"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_rules_opposed(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("rules.opposed", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    investigator_id = _resolve_investigator(ctx, args)
    target, label, target_source = _resolve_target_value(ctx, investigator_id, args)
    rng = _rng(args)
    mine = coc_roll.percentile_check(target, "regular", 0, 0, rng=rng)
    theirs = coc_roll.percentile_check(int(args["opponent_value"]), "regular", 0, 0, rng=rng)
    levels = {"fumble": 0, "failure": 0, "regular": 1, "hard": 2, "extreme": 3, "critical": 4}
    my_level = levels.get(str(mine["outcome"]), 0)
    their_level = levels.get(str(theirs["outcome"]), 0)
    if my_level != their_level:
        winner = "investigator" if my_level > their_level else "opponent"
    elif my_level == 0:
        winner = "none"
    else:
        winner = "investigator" if target >= int(args["opponent_value"]) else "opponent"
    data = {
        "investigator_id": investigator_id,
        "skill": label,
        "target_source": target_source,
        "investigator_roll": mine,
        "opponent_label": args.get("opponent_label"),
        "opponent_roll": theirs,
        "winner": winner,
    }
    mine_payload = {**mine, "skill": label, "reason": args.get("reason"), "opposed_side": "investigator"}
    mine_record = ctx.log_roll({
        "event_type": "roll", "kind": "opposed_check", "actor": investigator_id,
        "visibility": "public", "payload": mine_payload, **mine_payload,
    })
    opponent_label = str(args.get("opponent_label") or "opponent")
    their_payload = {
        **theirs,
        "skill": opponent_label,
        "reason": args.get("reason"),
        "opposed_side": "opponent",
    }
    their_record = ctx.log_roll({
        "event_type": "roll", "kind": "opposed_check", "actor": opponent_label,
        "visibility": "public", "payload": their_payload, **their_payload,
    })
    data["investigator_roll_id"] = mine_record["roll_id"]
    data["opponent_roll_id"] = their_record["roll_id"]
    ctx.ledger_record(args.get("decision_id"), "rules.opposed", data)
    hints = ["both sides failed: the situation stalls or worsens — narrate movement, not a freeze"] if winner == "none" else []
    if target_source == "rulebook_base":
        hints.append(
            f"{label} is not listed on the investigator sheet; used the canonical rulebook base chance {target}%"
        )
    return data, [], hints


def _parse_loss(expression: Any, rng: random.Random) -> tuple[int, dict[str, Any]]:
    text = str(expression if expression is not None else "0").strip()
    if text in ("0", ""):
        return 0, {"kind": "constant", "value": 0}
    spec = coc_sanity.validate_san_loss_expression(text)
    if spec["kind"] == "constant":
        return int(spec["value"]), spec
    rolled = coc_roll.roll_expression(
        f"{spec['count']}D{spec['sides']}" + (f"+{spec['modifier']}" if spec.get("modifier") else ""),
        rng=rng,
    )
    return int(rolled["total"]), {**spec, "rolls": rolled["rolls"], "total": rolled["total"]}


@tool(
    "rules.sanity_check",
    "SAN check with success/failure loss expressions (e.g. '0' / '1D6'). Applies the loss to the investigator.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "source": {"type": "string", "required": True, "desc": "what horror caused the check"},
        "loss_success": {"type": "string", "desc": "loss on success (default '0'; int or dice)"},
        "loss_failure": {"type": "string", "required": True, "desc": "loss on failure (int or dice, e.g. '1D6')"},
        "trigger_id": {
            "type": "string",
            "desc": "authored scene SAN trigger id; marks that trigger fired after settlement",
        },
        "seed": {"type": "integer", "desc": "deterministic RNG seed"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_rules_sanity_check(ctx: Ctx, args: dict[str, Any]):
    investigator_id = _resolve_investigator(ctx, args)
    prior = ctx.ledger_lookup("rules.sanity_check", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    rng = _rng(args)
    state = ctx.inv_state(investigator_id)
    current_san = int(state.get("current_san", 0))
    check = coc_roll.percentile_check(current_san, "regular", 0, 0, rng=rng)
    success = check["outcome"] in ("regular", "hard", "extreme", "critical")
    loss, loss_detail = _parse_loss(
        args.get("loss_success", "0") if success else args["loss_failure"], rng
    )
    new_san = max(0, current_san - loss)
    state["current_san"] = new_san
    ctx.save_inv_state(investigator_id, state)

    warnings: list[str] = []
    trigger_id = str(args.get("trigger_id") or "").strip()
    if trigger_id:
        world = ctx.world()
        active_scene = _scene_by_id(ctx.story_graph, world.get("active_scene_id"))
        authored_ids = {
            str(trigger.get("trigger_id"))
            for trigger in ((active_scene or {}).get("on_enter") or {}).get(
                "san_triggers", []
            )
            if isinstance(trigger, dict) and trigger.get("trigger_id")
        }
        if trigger_id not in authored_ids:
            warnings.append(
                f"SAN trigger '{trigger_id}' is not authored for the active scene — "
                "the check remains valid but the trigger was recorded as improvised"
            )
        fired = [str(value) for value in (world.get("san_triggers_fired") or [])]
        if trigger_id not in fired:
            fired.append(trigger_id)
            world["san_triggers_fired"] = fired
            ctx.save_world(world)

    data = {
        "investigator_id": investigator_id,
        "source": str(args["source"]),
        "check": check,
        "success": success,
        "san_loss": loss,
        "loss_detail": loss_detail,
        "san_before": current_san,
        "san_after": new_san,
        "trigger_id": trigger_id or None,
    }
    hints: list[str] = []
    if loss >= 5:
        hints.append(
            "lost 5+ SAN in one check: temporary insanity threat — make an INT roll; success means the "
            "investigator fully grasps the horror and suffers a bout of madness (see coc-sanity skill)"
        )
    if new_san == 0:
        hints.append("SAN reached 0: permanent insanity — this investigator is lost to the Mythos")
    elif loss > 0 and new_san <= current_san - current_san // 5:
        hints.append("heavy cumulative loss: consider indefinite-insanity pressure if a fifth of SAN went in one day")
    check_payload = {
        **check,
        "skill": "SAN",
        "source": str(args["source"]),
        "trigger_id": trigger_id or None,
        "san_loss": loss,
        "san_before": current_san,
        "san_after": new_san,
    }
    if check.get("outcome") == "fumble":
        check_payload["fumble_consequence"] = {
            "summary": (
                "SAN fumble resolves through the authored failed-check loss: "
                f"{loss} SAN lost from {args['loss_failure']}."
            ),
            "effect": {
                "kind": "san_loss",
                "amount": loss,
                "san_before": current_san,
                "san_after": new_san,
            },
        }
    check_record = ctx.log_roll({
        "event_type": "roll",
        "kind": "sanity_check",
        "actor": investigator_id,
        "visibility": "consequence_public",
        "payload": check_payload,
        **check_payload,
    })
    data["check_roll_id"] = check_record["roll_id"]
    if isinstance(loss_detail.get("rolls"), list) and loss_detail["rolls"]:
        loss_expression = args.get("loss_success", "0") if success else args["loss_failure"]
        loss_payload = {
            **loss_detail,
            "die_expression": str(loss_expression),
            "individual_faces": list(loss_detail["rolls"]),
            "final_total": loss,
            "roll": loss,
            "san_before": current_san,
            "san_after": new_san,
            "source": str(args["source"]),
        }
        loss_record = ctx.log_roll({
            "event_type": "roll",
            "type": "san_loss",
            "kind": "san_loss",
            "actor": investigator_id,
            "visibility": "consequence_public",
            "payload": loss_payload,
            **loss_payload,
        })
        data["loss_roll_id"] = loss_record["roll_id"]
    ctx.log_event({
        "event_type": "sanity_loss",
        "investigator_id": investigator_id,
        "loss": loss,
        "source": str(args["source"]),
        "trigger_id": trigger_id or None,
    })
    ctx.ledger_record(args.get("decision_id"), "rules.sanity_check", data)
    return data, warnings, hints


@tool(
    "rules.damage",
    "Apply damage or healing to an investigator's HP. Amount may be an integer or a dice expression.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "amount": {"type": "string", "required": True, "desc": "integer or dice expression (e.g. '1D6+1')"},
        "kind": {"type": "string", "desc": "damage | heal (default damage)"},
        "source": {"type": "string", "desc": "what caused it (logged)"},
        "seed": {"type": "integer", "desc": "deterministic RNG seed"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_rules_damage(ctx: Ctx, args: dict[str, Any]):
    investigator_id = _resolve_investigator(ctx, args)
    prior = ctx.ledger_lookup("rules.damage", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    kind = str(args.get("kind") or "damage")
    if kind not in ("damage", "heal"):
        raise ToolError("invalid_param", "kind must be damage or heal")
    raw = str(args["amount"]).strip()
    detail: dict[str, Any] | None = None
    if raw.lstrip("+-").isdigit():
        amount = abs(int(raw))
    else:
        rolled = coc_roll.roll_expression(raw, rng=_rng(args))
        amount = max(0, int(rolled["total"]))
        detail = rolled

    state = ctx.inv_state(investigator_id)
    sheet = ctx.sheet(investigator_id)
    max_hp = int((sheet.get("derived") or {}).get("HP") or 10)
    before = int(state.get("current_hp", max_hp))
    after = min(max_hp, before + amount) if kind == "heal" else max(0, before - amount)
    state["current_hp"] = after
    conditions = list(state.get("conditions") or [])
    hints: list[str] = []
    if kind == "damage":
        if amount >= (max_hp + 1) // 2 and amount > 0:
            if "major_wound" not in conditions:
                conditions.append("major_wound")
            hints.append("major wound: single hit >= half max HP — CON check or fall unconscious; healing is slowed")
        if after == 0:
            if "major_wound" in conditions:
                if "dying" not in conditions:
                    conditions.append("dying")
                hints.append("0 HP with a major wound: dying — needs First Aid to stabilize, then Medicine")
            else:
                if "unconscious" not in conditions:
                    conditions.append("unconscious")
                hints.append("0 HP without a major wound: unconscious, not dying")
    else:
        if after > 0:
            for gone in ("dying", "unconscious"):
                if gone in conditions:
                    conditions.remove(gone)
    state["conditions"] = conditions
    ctx.save_inv_state(investigator_id, state)
    data = {
        "investigator_id": investigator_id,
        "kind": kind,
        "amount": amount,
        "roll_detail": detail,
        "hp_before": before,
        "hp_after": after,
        "max_hp": max_hp,
        "conditions": conditions,
        "source": args.get("source"),
    }
    if detail is not None:
        damage_payload = {
            **detail,
            "die_expression": detail["expression"],
            "individual_faces": list(detail["rolls"]),
            "final_total": amount,
            "roll": amount,
            "hp_before": before,
            "hp_after": after,
            "source": args.get("source"),
        }
        damage_record = ctx.log_roll({
            "event_type": "roll",
            "type": "damage" if kind == "damage" else "healing",
            "kind": f"hp_{kind}",
            "actor": investigator_id,
            "visibility": "consequence_public",
            "payload": damage_payload,
            **damage_payload,
        })
        data["roll_id"] = damage_record["roll_id"]
    ctx.log_event({"event_type": "hp_change", **data})
    ctx.ledger_record(args.get("decision_id"), "rules.damage", data)
    return data, [], hints


@tool(
    "rules.luck_spend",
    "Spend Luck to lower a failed roll toward success. Enforces the rulebook's legality constraints.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "points": {"type": "integer", "required": True, "desc": "luck points to spend"},
        "roll": {"type": "integer", "required": True, "desc": "the original percentile roll value"},
        "target": {"type": "integer", "required": True, "desc": "the effective target of that roll"},
        "outcome": {"type": "string", "desc": "the original outcome label (default failure)"},
        "roll_kind": {"type": "string", "desc": "skill | luck | damage | sanity (default skill)"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_rules_luck_spend(ctx: Ctx, args: dict[str, Any]):
    investigator_id = _resolve_investigator(ctx, args)
    prior = ctx.ledger_lookup("rules.luck_spend", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    state = ctx.inv_state(investigator_id)
    current_luck = int(state.get("current_luck", 0))
    result = {
        "roll": int(args["roll"]),
        "effective_target": int(args["target"]),
        "target": int(args["target"]),
        "outcome": str(args.get("outcome") or "failure"),
    }
    adjusted = coc_roll.spend_luck(
        result, int(args["points"]), current_luck, roll_kind=str(args.get("roll_kind") or "skill")
    )
    state["current_luck"] = int(adjusted["luck_remaining"])
    ctx.save_inv_state(investigator_id, state)
    adjusted["investigator_id"] = investigator_id
    # Spending Luck alters an already-resolved roll; it does not create a new
    # dice event.  Record it in the event log without fabricating a roll row.
    ctx.log_event({"event_type": "luck_spent", **adjusted})
    ctx.ledger_record(args.get("decision_id"), "rules.luck_spend", adjusted)
    return adjusted, [], []


# --------------------------------------------------------------------------- #
# typed bridge to the canonical subsystem executor
# --------------------------------------------------------------------------- #

def _execute_subsystem_requests(
    ctx: Ctx,
    *,
    investigator_id: str,
    decision_id: str,
    requests: list[dict[str, Any]],
    seed: Any = None,
    tool_name: str = "combat.resolve",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    commands = coc_subsystem_executor.commands_from_rules_requests({
        "decision_id": decision_id,
        "rules_requests": requests,
    })
    if not commands:
        raise ToolError(
            "subsystem_operation_unavailable",
            "the requested operation could not produce a typed command",
        )
    character_path = (
        ctx.coc_root / "investigators" / investigator_id / "character.json"
    )
    try:
        results = coc_subsystem_executor.execute_commands(
            ctx.campaign_dir,
            character_path,
            investigator_id,
            commands,
            rng=random.Random(seed) if seed is not None else random.Random(),
        )
    except coc_subsystem_executor.SubsystemExecutorError as exc:
        if exc.code == "RECOVERY_CONFLICT":
            cause = exc.__cause__
            transaction_id = str(
                getattr(cause, "transaction_id", "development-reader")
            )
            marker_path = Path(
                getattr(
                    cause,
                    "marker_path",
                    ctx.coc_root
                    / "investigators"
                    / investigator_id
                    / "development-active-transaction.json",
                )
            )
            try:
                display_path = marker_path.relative_to(ctx.root).as_posix()
            except ValueError:
                display_path = str(marker_path)
            raise coc_runtime_ops.DevelopmentRecoveryConflict(
                transaction_id, [display_path]
            ) from exc
        raise ToolError(exc.code, exc.message) from exc

    events = coc_subsystem_executor.flatten_result_events(results)
    command_by_id = {
        str(result.get("command_id")): result for result in results
        if isinstance(result, dict) and result.get("command_id")
    }
    for event in events:
        record = deepcopy(event)
        source_command_id = record.get("source_command_id")
        result = command_by_id.get(str(source_command_id))
        record.setdefault("event_type", "subsystem_event")
        record["decision_id"] = decision_id
        record["tool"] = tool_name
        if isinstance(result, dict):
            record.setdefault("command_kind", result.get("kind"))
        ctx.log_event(record)
    return results, events


def _record_combat_improvement_ticks(
    ctx: Ctx,
    *,
    investigator_id: str,
    events: list[dict[str, Any]],
) -> list[str]:
    """Project qualifying investigator combat rolls into toolbox tick state.

    Combat remains owned by the subsystem executor.  This consumer reads only
    its structured roll/turn receipts, binds them to skills on the reusable
    investigator sheet, and delegates eligibility to ``coc_development``.
    NPC, characteristic, damage, opposed-loser, and Luck-bought rolls therefore
    cannot enter the development stream.
    """
    sheet_skills = ctx.sheet(investigator_id).get("skills") or {}
    if not isinstance(sheet_skills, dict):
        return []
    canonical_skills = {
        str(name).casefold(): str(name) for name in sheet_skills
        if isinstance(name, str) and name.strip()
    }
    opposed_wins: dict[str, bool] = {}
    for event in events:
        if event.get("event_type") != "combat_turn_resolved":
            continue
        turn = event.get("turn")
        if not isinstance(turn, dict):
            continue
        outcome = turn.get("opposed_outcome")
        attack_roll_id = turn.get("roll_id")
        defense_roll_id = turn.get("opposed_roll_id")
        if isinstance(attack_roll_id, str) and outcome in {
            "attacker_higher", "tie_attacker_wins",
            "defender_higher", "tie_defender_wins",
        }:
            opposed_wins[attack_roll_id] = outcome in {
                "attacker_higher", "tie_attacker_wins",
            }
        if isinstance(defense_roll_id, str) and outcome in {
            "attacker_higher", "tie_attacker_wins",
            "defender_higher", "tie_defender_wins",
        }:
            opposed_wins[defense_roll_id] = outcome in {
                "defender_higher", "tie_defender_wins",
            }

    recorded: list[str] = []
    for event in events:
        if (
            event.get("event_type") != "combat_roll"
            or event.get("actor_id") != investigator_id
        ):
            continue
        raw_skill = event.get("skill")
        if not isinstance(raw_skill, str):
            continue
        skill = canonical_skills.get(raw_skill.casefold())
        if skill is None:
            continue
        roll = deepcopy(event)
        roll["kind"] = "combat_skill"
        roll_id = roll.get("roll_id")
        if isinstance(roll_id, str) and roll_id in opposed_wins:
            roll["opposed_won"] = opposed_wins[roll_id]
        source_event_id = (
            str(roll_id)
            if isinstance(roll_id, str) and roll_id
            else "combat-roll:" + hashlib.sha256(
                json.dumps(event, sort_keys=True, ensure_ascii=False).encode("utf-8")
            ).hexdigest()
        )
        if _mark_improvement_tick(
            ctx,
            investigator_id,
            skill,
            roll,
            source_event_id=source_event_id,
            source_kind="combat.resolve",
        ):
            if skill not in recorded:
                recorded.append(skill)
    return recorded


def _healing_tool_data(
    ctx: Ctx,
    investigator_id: str,
    results: list[dict[str, Any]],
    events: list[dict[str, Any]],
) -> dict[str, Any]:
    state = ctx.inv_state(investigator_id)
    primary = next(
        (
            deepcopy(event)
            for event in events
            if event.get("event_type")
            in {
                "first_aid",
                "first_aid_stabilize",
                "medicine",
                "healing_skipped",
                "dying_con_roll",
                "stabilized_con_roll",
                "major_wound_recovery",
            }
        ),
        None,
    )
    return {
        "investigator_id": investigator_id,
        "event": primary,
        "results": results,
        "events": events,
        "current_hp": state.get("current_hp"),
        "conditions": list(state.get("conditions") or []),
    }


@tool(
    "rules.first_aid",
    "Resolve canonical First Aid, including stabilization at 0 HP, through the transactional healing engine.",
    {
        "investigator": {"type": "string", "desc": "injured investigator id"},
        "skill_value": {
            "type": "integer",
            "required": True,
            "desc": "First Aid value of the acting rescuer (1..100)",
        },
        "rescuer_id": {
            "type": "string",
            "desc": "stable actor id for roll evidence (defaults to the investigator)",
        },
        "pushed": {
            "type": "boolean",
            "desc": "true for second/subsequent attempts after an earlier First Aid roll",
        },
        "changed_method": {
            "type": "string",
            "desc": "what materially changes on the pushed First Aid attempt",
        },
        "failure_consequence": {
            "type": "string",
            "desc": "consequence announced before the pushed attempt",
        },
        "seed": {"type": "integer", "desc": "deterministic RNG seed (tests only)"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_rules_first_aid(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("rules.first_aid", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    investigator_id = _resolve_investigator(ctx, args)
    rescuer_id = str(args.get("rescuer_id") or investigator_id)
    pushed = args.get("pushed", False)
    if not isinstance(pushed, bool):
        raise ToolError("invalid_param", "pushed must be boolean")
    if pushed:
        for field in ("changed_method", "failure_consequence"):
            if not isinstance(args.get(field), str) or not args[field].strip():
                raise ToolError(
                    "missing_param",
                    f"pushed First Aid requires non-empty {field}",
                )
    request = {
        "kind": "stabilize",
        "command_id": f"{decision_id}-first-aid",
        "method": "first_aid",
        "skill_value": int(args["skill_value"]),
        "rescuer_id": rescuer_id,
        "pushed": pushed,
    }
    if pushed:
        request["changed_method"] = str(args["changed_method"]).strip()
        request["failure_consequence"] = str(args["failure_consequence"]).strip()
    results, events = _execute_subsystem_requests(
        ctx,
        investigator_id=investigator_id,
        decision_id=decision_id,
        requests=[request],
        seed=args.get("seed"),
        tool_name="rules.first_aid",
    )
    data = _healing_tool_data(ctx, investigator_id, results, events)
    data["rescuer_id"] = rescuer_id
    conditions = set(data["conditions"])
    hints: list[str] = []
    if "stabilized" in conditions and "dying" in conditions:
        hints.append(
            "stabilized at temporary HP: use rules.dying_check(clock_kind=hour) "
            "for each elapsed hour until successful rules.medicine clears the dying chain"
        )
    elif "dying" in conditions:
        hints.append(
            "First Aid did not stabilize the investigator; resolve the end-of-round "
            "rules.dying_check(clock_kind=round) before further fiction advances"
        )
    ctx.ledger_record(decision_id, "rules.first_aid", data)
    return data, [], hints


@tool(
    "rules.medicine",
    "Resolve canonical Medicine treatment, including clearing a stabilized dying state and its 1D3 healing.",
    {
        "investigator": {"type": "string", "desc": "injured investigator id"},
        "skill_value": {
            "type": "integer",
            "required": True,
            "desc": "Medicine value of the acting caregiver (1..100)",
        },
        "rescuer_id": {
            "type": "string",
            "desc": "stable actor id for roll evidence (defaults to the investigator)",
        },
        "seed": {"type": "integer", "desc": "deterministic RNG seed (tests only)"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_rules_medicine(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("rules.medicine", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    investigator_id = _resolve_investigator(ctx, args)
    rescuer_id = str(args.get("rescuer_id") or investigator_id)
    results, events = _execute_subsystem_requests(
        ctx,
        investigator_id=investigator_id,
        decision_id=decision_id,
        requests=[{
            "kind": "stabilize",
            "command_id": f"{decision_id}-medicine",
            "method": "medicine",
            "skill_value": int(args["skill_value"]),
            "rescuer_id": rescuer_id,
        }],
        seed=args.get("seed"),
        tool_name="rules.medicine",
    )
    data = _healing_tool_data(ctx, investigator_id, results, events)
    data["rescuer_id"] = rescuer_id
    conditions = set(data["conditions"])
    hints: list[str] = []
    if "stabilized" in conditions and "dying" in conditions:
        hints.append(
            "Medicine did not clear the dying chain; keep resolving "
            "rules.dying_check(clock_kind=hour) while the temporary stabilization lasts"
        )
    elif "dying" not in conditions:
        hints.append("the dying chain is cleared; ordinary recovery can now proceed")
    ctx.ledger_record(decision_id, "rules.medicine", data)
    return data, [], hints


@tool(
    "rules.weekly_recovery",
    "Resolve one due major-wound recovery week from authoritative game time, with optional weekly medical care and complete dice evidence.",
    {
        "investigator": {"type": "string", "desc": "recovering investigator id"},
        "complete_rest": {
            "type": "boolean",
            "required": True,
            "desc": "true only when the investigator had complete comfortable rest for the interval",
        },
        "poor_environment": {
            "type": "boolean",
            "required": True,
            "desc": "true when the recovery environment or rest was inadequate",
        },
        "medicine_skill_value": {
            "type": "integer",
            "desc": "optional caregiver Medicine value (1..100) for this week's care roll",
        },
        "caregiver_id": {
            "type": "string",
            "desc": "stable caregiver id; defaults to the investigator when Medicine is supplied",
        },
        "seed": {"type": "integer", "desc": "deterministic RNG seed (tests only)"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_rules_weekly_recovery(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("rules.weekly_recovery", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    investigator_id = _resolve_investigator(ctx, args)
    complete_rest = args["complete_rest"]
    poor_environment = args["poor_environment"]
    if not isinstance(complete_rest, bool) or not isinstance(
        poor_environment, bool
    ):
        raise ToolError(
            "invalid_param", "complete_rest and poor_environment must be boolean"
        )
    if complete_rest and poor_environment:
        raise ToolError(
            "invalid_param",
            "complete_rest and poor_environment are mutually exclusive",
        )
    request: dict[str, Any] = {
        "kind": "weekly_recovery",
        "command_id": f"{decision_id}-weekly-recovery",
        "complete_rest": complete_rest,
        "poor_environment": poor_environment,
    }
    if args.get("medicine_skill_value") is not None:
        request["medicine_skill_value"] = int(args["medicine_skill_value"])
        request["caregiver_id"] = str(
            args.get("caregiver_id") or investigator_id
        )
    elif args.get("caregiver_id") is not None:
        raise ToolError(
            "invalid_param", "caregiver_id requires medicine_skill_value"
        )
    results, events = _execute_subsystem_requests(
        ctx,
        investigator_id=investigator_id,
        decision_id=decision_id,
        requests=[request],
        seed=args.get("seed"),
        tool_name="rules.weekly_recovery",
    )
    data = _healing_tool_data(ctx, investigator_id, results, events)
    state = ctx.inv_state(investigator_id)
    data["major_wound_recovery_ledger"] = deepcopy(
        state.get("major_wound_recovery_ledger") or []
    )
    outcome = (data.get("event") or {}).get("outcome")
    conditions = set(data["conditions"])
    hints: list[str] = []
    if "major_wound" not in conditions:
        hints.append(
            "the major wound is cleared; do not submit another weekly recovery for this wound"
        )
    else:
        hints.append(
            "the major wound remains; another recovery roll is unavailable until one more full game week elapses"
        )
    if outcome == "fumble":
        hints.append(
            "record the structured lasting-injury consequence in Wounds & Scars"
        )
    ctx.ledger_record(decision_id, "rules.weekly_recovery", data)
    return data, [], hints


@tool(
    "rules.dying_check",
    "Resolve the canonical CON death clock for a dying or temporarily stabilized investigator.",
    {
        "investigator": {"type": "string", "desc": "dying investigator id"},
        "clock_kind": {
            "type": "string",
            "required": True,
            "desc": "round while unstabilized; hour while stabilized",
        },
        "seed": {"type": "integer", "desc": "deterministic RNG seed (tests only)"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_rules_dying_check(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("rules.dying_check", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    investigator_id = _resolve_investigator(ctx, args)
    clock_kind = str(args["clock_kind"])
    results, events = _execute_subsystem_requests(
        ctx,
        investigator_id=investigator_id,
        decision_id=decision_id,
        requests=[{
            "kind": "dying_tick",
            "command_id": f"{decision_id}-dying-{clock_kind}",
            "clock_kind": clock_kind,
        }],
        seed=args.get("seed"),
        tool_name="rules.dying_check",
    )
    data = _healing_tool_data(ctx, investigator_id, results, events)
    conditions = set(data["conditions"])
    hints: list[str] = []
    if "dead" in conditions:
        hints.append("the death clock failed: the investigator is dead")
    elif "stabilized" not in conditions and "dying" in conditions and clock_kind == "hour":
        hints.append(
            "the temporary stabilization deteriorated: First Aid is required again; "
            "because this is the same wound, submit it as a pushed attempt"
        )
    elif "dying" in conditions:
        hints.append(
            "the investigator holds on and a new round begins; the dying chain "
            "remains active, and any later First Aid attempt on the same wound is pushed"
        )
    ctx.ledger_record(decision_id, "rules.dying_check", data)
    return data, [], hints


# --------------------------------------------------------------------------- #
# combat.* — authored bridge to CombatSession through the same executor
# --------------------------------------------------------------------------- #


@tool(
    "combat.context",
    "Read the canonical combat snapshot, initiative cursor, and pending defense choice.",
    {},
)
def _tool_combat_context(ctx: Ctx, args: dict[str, Any]):
    state = _combat_state(ctx)
    if not state:
        return {"active": False, "combat": None}, [], [
            "start authored combat with combat.resolve and an affordance_id"
        ]
    pending = state.get("pending_attack")
    return {
        "active": state.get("status") == "active",
        "combat": {"secret": True, "value": state},
        "pending_defense": deepcopy(pending) if isinstance(pending, dict) else None,
    }, [], []


@tool(
    "combat.resolve",
    "Execute one authored combat beat through CombatSession; persists combat.json and canonical roll evidence.",
    {
        "affordance_id": {
            "type": "string",
            "required": True,
            "desc": "current-scene affordance whose rules_operation is combat_engagement",
        },
        "investigator": {"type": "string", "desc": "investigator id"},
        "weapon_id": {
            "type": "string",
            "desc": "stable owned weapon id for a structured_player_selection route",
        },
        "defense_kind": {
            "type": "string",
            "desc": "dodge | fight_back | dive_for_cover | none when the investigator owes a defense",
        },
        "luck_spend_max": {
            "type": "integer",
            "desc": "optional pre-authorization (1..99): spend only the minimum Luck that changes this opposed melee result",
        },
        "decision_id": {
            "type": "string", "required": True, "desc": "idempotency key"
        },
        "seed": {"type": "integer", "desc": "deterministic RNG seed (tests only)"},
    },
)
def _tool_combat_resolve(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("combat.resolve", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []

    investigator_id = _resolve_investigator(ctx, args)
    world = ctx.world()
    scene = _scene_by_id(ctx.story_graph, world.get("active_scene_id"))
    affordance_id = str(args["affordance_id"])
    affordance = _affordance_by_id(scene, affordance_id)
    operation = (
        affordance.get("rules_operation") if isinstance(affordance, dict) else None
    )
    if not isinstance(operation, dict) or operation.get("kind") != "combat_engagement":
        raise ToolError(
            "unknown_combat_affordance",
            f"'{affordance_id}' has no authored combat_engagement operation in the active scene",
        )

    warnings: list[str] = []
    discovered = {str(value) for value in world.get("discovered_clue_ids") or []}
    missing = [
        str(value)
        for value in (affordance.get("requires_discovered_clue_ids") or [])
        if str(value) not in discovered
    ]
    if missing:
        warnings.append(
            "authored combat affordance prerequisites are not recorded: "
            + ", ".join(missing)
        )

    combat = _combat_state(ctx)
    if combat.get("status") == "concluded":
        warnings.append(
            "the prior combat is concluded; this chosen attack starts a new "
            "authored encounter with a fresh combat/command/roll identity"
        )
    pending = combat.get("pending_attack")
    if isinstance(pending, dict):
        target_id = str(pending.get("target_actor_id") or "")
        defense_kind = args.get("defense_kind")
        if target_id == investigator_id and not defense_kind:
            raise ToolError(
                "combat_defense_required",
                "the investigator must choose defense_kind before this pending attack can resolve",
            )
        if not defense_kind:
            defense_kind = operation.get("opponent_defense") or "dodge"
        requests = [{
            "kind": "combat_defend",
            "command_id": f"{pending['attack_command_id']}-defense",
            "revision": int(combat.get("revision", 0)),
            "actor_id": target_id,
            "attack_command_id": str(pending["attack_command_id"]),
            "defense_kind": str(defense_kind),
            "route_resolution": {"matched_route_ids": [affordance_id]},
        }]
    else:
        rich: dict[str, Any] = {
            "action_resolution": {
                "matched_affordance_ids": [affordance_id],
                "no_match": False,
            }
        }
        if args.get("weapon_id"):
            rich["combat_action"] = {"weapon_id": str(args["weapon_id"])}
        requests = coc_narrative_enrichment.build_route_operation_requests({
            "active_scene": scene or {},
            "combat_state": combat,
            "world_state": world,
            "investigator_combat_profile": _investigator_combat_profile(
                ctx, investigator_id
            ),
            "character": ctx.sheet(investigator_id),
            "player_intent_rich": rich,
            "turn_number": int(ctx.pacing().get("turn_number") or 0),
        })
        # Conclusion rewards deliberately belong to development.settle, not
        # the combat tool.  A combat call may execute only combat commands.
        requests = [
            request for request in requests
            if str(request.get("kind") or "").startswith("combat_")
        ]

    luck_cap = args.get("luck_spend_max")
    if luck_cap is not None:
        if isinstance(luck_cap, bool) or not 1 <= int(luck_cap) <= 99:
            raise ToolError("invalid_param", "luck_spend_max must be 1..99")
        defend_requests = [
            request for request in requests
            if request.get("kind") == "combat_defend"
        ]
        if len(defend_requests) != 1:
            raise ToolError(
                "combat_luck_precommit_unavailable",
                "this combat beat does not contain exactly one opposed resolution",
            )
        defend_requests[0]["luck_spend_max"] = int(luck_cap)
        defend_requests[0]["luck_actor_id"] = investigator_id

    results, events = _execute_subsystem_requests(
        ctx,
        investigator_id=investigator_id,
        decision_id=decision_id,
        requests=requests,
        seed=args.get("seed"),
    )
    improvement_ticks = _record_combat_improvement_ticks(
        ctx,
        investigator_id=investigator_id,
        events=events,
    )
    current = _combat_state(ctx)
    data = {
        "results": results,
        "events": events,
        "combat": current,
        "pending_defense": deepcopy(current.get("pending_attack")),
        "improvement_ticks_recorded": improvement_ticks,
    }
    hints: list[str] = []
    if improvement_ticks:
        hints.append(
            "qualifying combat success: improvement tick recorded for "
            + ", ".join(improvement_ticks)
        )
    if isinstance(current.get("pending_attack"), dict):
        hints.append(
            "an attack is pending: ask the player for a legal defense, then call "
            "combat.resolve again with defense_kind"
        )
    luck_events = [
        event for event in events
        if event.get("event_type") == "combat_luck_spent"
    ]
    if luck_events:
        spent = luck_events[-1]
        hints.append(
            f"Luck precommit spent {spent.get('luck_spent')} point(s); "
            f"{spent.get('luck_after')} remain"
        )
    if current.get("status") == "concluded":
        hints.append(
            "combat outcome and combat_ended receipt are mechanically concluded; "
            "this does not by itself end the session or scenario. Continue with "
            "rescue/aftermath when fiction supports it, and call state.end_session "
            "only at an intentional session boundary"
        )
    ctx.ledger_record(decision_id, "combat.resolve", data)
    return data, warnings, hints


@tool(
    "combat.end",
    "Finalize the current CombatSession and emit the canonical combat_ended receipt.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "outcome": {
            "type": "string",
            "required": True,
            "desc": "structured CombatSession outcome",
        },
        "decision_id": {
            "type": "string", "required": True, "desc": "idempotency key"
        },
    },
)
def _tool_combat_end(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("combat.end", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    investigator_id = _resolve_investigator(ctx, args)
    combat = _combat_state(ctx)
    if not combat:
        raise ToolError("combat_not_started", "no canonical combat snapshot exists")
    outcome = str(args["outcome"])
    if (
        combat.get("status") == "concluded"
        and combat.get("outcome") not in (None, outcome)
    ):
        raise ToolError(
            "combat_outcome_mismatch",
            "combat.end outcome must match the mechanically concluded outcome",
        )
    results, events = _execute_subsystem_requests(
        ctx,
        investigator_id=investigator_id,
        decision_id=decision_id,
        requests=[{
            "kind": "combat_end",
            "command_id": f"{combat.get('combat_id', 'combat')}-end-{combat.get('revision', 0)}",
            "revision": int(combat.get("revision", 0)),
            "outcome": outcome,
        }],
        tool_name="combat.end",
    )
    data = {"results": results, "events": events, "combat": _combat_state(ctx)}
    ctx.ledger_record(decision_id, "combat.end", data)
    return data, [], [
        "if this is the scenario conclusion, call state.end_session and then the "
        "coc-development skill's development.settle operation"
    ]


# --------------------------------------------------------------------------- #
# flow.* — read-only queries (former gates surface as info)
# --------------------------------------------------------------------------- #

@tool(
    "scene.context",
    "Everything about the current scene: description, NPCs present, clues (with discovery state), exits, pacing, time.",
    {},
)
def _tool_scene_context(ctx: Ctx, args: dict[str, Any]):
    world = ctx.world()
    sg = ctx.story_graph
    active_id = world.get("active_scene_id")
    scene = _scene_by_id(sg, active_id)
    discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    warnings: list[str] = []
    if scene is None:
        warnings.append(f"active scene '{active_id}' not found in story graph — use scene.map / state.move_scene")

    npc_state = coc_npc_state.load_npc_state(ctx.campaign_dir)
    npcs = []
    for npc_id in (scene or {}).get("npc_ids") or []:
        agenda = _npc_by_id(ctx.npc_agendas, npc_id) or {}
        psych = (npc_state.get("psych") or {}).get(str(npc_id)) or {}
        npcs.append({
            "npc_id": npc_id,
            "name": agenda.get("name"),
            "voice": agenda.get("voice"),
            "relationship_to_investigators": agenda.get("relationship_to_investigators"),
            "availability": psych.get("availability") or agenda.get("availability"),
            "trust": psych.get("trust", 0),
            "fear": psych.get("fear", 0),
            "suspicion": psych.get("suspicion", 0),
            "identity_contract": (
                _npc_identity_contract(agenda, str(active_id) if active_id else None)
                if agenda
                else None
            ),
        })

    clues = []
    for clue_id in (scene or {}).get("available_clues") or []:
        clue = _clue_by_id(ctx.clue_graph, str(clue_id))
        if clue is not None:
            clues.append(_clue_public_view(clue, discovered))
        else:
            clues.append({"clue_id": clue_id, "discovered": str(clue_id) in discovered})

    candidates = coc_scene_graph.transition_candidates(active_id, sg, dict(world))
    edges = coc_scene_graph.derive_scene_edges(sg).get(str(active_id or ""), [])
    exits = []
    for edge in edges:
        target = str(edge["to"])
        exits.append({
            "to": target,
            "kind": edge.get("kind"),
            "when": edge.get("when"),
            "open": target in candidates,
        })

    pacing = ctx.pacing()
    fired_san_triggers = {
        str(value) for value in (world.get("san_triggers_fired") or []) if value
    }
    pending_san_triggers = []
    for trigger in ((scene or {}).get("on_enter") or {}).get("san_triggers") or []:
        if not isinstance(trigger, dict) or not trigger.get("trigger_id"):
            continue
        projected = deepcopy(trigger)
        projected["status"] = (
            "fired" if str(trigger["trigger_id"]) in fired_san_triggers else "pending"
        )
        pending_san_triggers.append(projected)

    flag_continuity = _world_flag_continuity(ctx)
    active_time_markers = _active_time_markers(ctx)
    data = {
        "campaign_id": ctx.campaign_id,
        "active_scene_id": active_id,
        "scene": {
            "scene_type": (scene or {}).get("scene_type"),
            "dramatic_question": (scene or {}).get("dramatic_question"),
            "tone": (scene or {}).get("tone"),
            "location_tags": (scene or {}).get("location_tags"),
            "pressure_moves": (scene or {}).get("pressure_moves"),
            "exit_conditions": (scene or {}).get("exit_conditions"),
            "allowed_improvisation": (scene or {}).get("allowed_improvisation"),
        } if scene else None,
        "npcs_present": npcs,
        "clues_here": clues,
        "exits": exits,
        "party": ctx.party_ids(),
        "tension_level": pacing.get("tension_level"),
        "turn_number": pacing.get("turn_number"),
        "time": coc_time.current_stamp(ctx.campaign_dir),
        "continuity": {
            "schema_version": 1,
            "keeper_only": True,
            "state_precedence": "live_over_authored_initial",
            **flag_continuity,
            "active_time_markers": active_time_markers,
        },
        "exit_ready": str(active_id) in {str(s) for s in world.get("exit_ready_scene_ids") or []},
        "pending_san_triggers": [
            trigger for trigger in pending_san_triggers if trigger["status"] == "pending"
        ],
        "keeper_mechanics": {
            "secret": True,
            "affordance_operations": [
                {
                    "affordance_id": affordance.get("id"),
                    "kind": affordance["rules_operation"].get("kind"),
                    "tool": (
                        "combat.resolve"
                        if affordance["rules_operation"].get("kind")
                        == "combat_engagement"
                        else None
                    ),
                }
                for affordance in (scene or {}).get("affordances") or []
                if isinstance(affordance, dict)
                and isinstance(affordance.get("rules_operation"), dict)
            ],
        },
    }
    hints: list[str] = []
    undiscovered = [c for c in clues if not c.get("discovered")]
    if undiscovered:
        hints.append(f"{len(undiscovered)} clue(s) here are still undiscovered")
    if data["pending_san_triggers"]:
        hints.append(
            "pending authored SAN trigger(s): resolve each witnessed trigger with "
            "rules.sanity_check and pass its trigger_id"
        )
    if data["keeper_mechanics"]["affordance_operations"]:
        hints.append(
            "structured scene mechanics are keeper-only; use combat.resolve for a "
            "combat_engagement and do not quote operation secrets to the player"
        )
    if data["continuity"]["live_world_flags"]:
        hints.append(
            "continuity.live_world_flags is current campaign truth and supersedes "
            "conflicting authored initial descriptions; use it when narrating the live scene"
        )
    if active_time_markers:
        hints.append(
            "active_time_markers are bookkeeping facts only; report their structured "
            "remaining/overdue values, but do not auto-trigger a rescue or block play"
        )
    hints.append(
        "optional pacing support: call director.advise on scene entry, after repeated approaches, or when momentum stalls; its suggestions are advisory and may be ignored"
    )
    hints.append(
        "optional enrichment support: call storylets.suggest when a personal callback or atmospheric beat would help; absence of a fitting storylet never blocks play"
    )
    return data, warnings, hints


@tool(
    "scene.map",
    "The whole scene graph with unlock/visit status — where the story can go and what gates each edge.",
    {},
)
def _tool_scene_map(ctx: Ctx, args: dict[str, Any]):
    world = ctx.world()
    sg = ctx.story_graph
    unlocked = {str(s) for s in world.get("unlocked_scene_ids") or []}
    visited = {str(s) for s in world.get("visited_scene_ids") or []}
    exhausted = {str(s) for s in world.get("exhausted_scene_ids") or []}
    edges_map = coc_scene_graph.derive_scene_edges(sg)
    scenes = []
    for scene in sg.get("scenes") or []:
        sid = str(scene.get("scene_id"))
        scenes.append({
            "scene_id": sid,
            "scene_type": scene.get("scene_type"),
            "dramatic_question": scene.get("dramatic_question"),
            "location_tags": scene.get("location_tags"),
            "unlocked": sid in unlocked,
            "visited": sid in visited,
            "exhausted": sid in exhausted,
            "is_terminal": coc_scene_graph.is_terminal_scene(scene, sg),
            "edges": edges_map.get(sid, []),
        })
    data = {
        "active_scene_id": world.get("active_scene_id"),
        "scenes": scenes,
        "scene_history": world.get("scene_history"),
    }
    return data, [], []


@tool(
    "clues.query",
    "Clue graph with discovery state. Filter by scene_id or clue_id. Undiscovered clues are keeper secrets.",
    {
        "scene_id": {"type": "string", "desc": "only clues available in this scene"},
        "clue_id": {"type": "string", "desc": "a single clue"},
        "undiscovered_only": {"type": "boolean", "desc": "only clues not yet found"},
    },
)
def _tool_clues_query(ctx: Ctx, args: dict[str, Any]):
    world = ctx.world()
    discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    clues = _all_clues(ctx.clue_graph)
    if args.get("clue_id"):
        clues = [c for c in clues if str(c.get("clue_id")) == str(args["clue_id"])]
    if args.get("scene_id"):
        scene = _scene_by_id(ctx.story_graph, str(args["scene_id"]))
        allowed = {str(c) for c in (scene or {}).get("available_clues") or []}
        clues = [c for c in clues if str(c.get("clue_id")) in allowed]
    if args.get("undiscovered_only"):
        clues = [c for c in clues if str(c.get("clue_id")) not in discovered]
    conclusions = []
    for conclusion in ctx.clue_graph.get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        route_ids = [
            str(clue.get("clue_id"))
            for clue in conclusion.get("clues") or []
            if isinstance(clue, dict) and clue.get("clue_id")
        ]
        discovered_routes = [clue_id for clue_id in route_ids if clue_id in discovered]
        minimum_routes = int(conclusion.get("minimum_routes") or 1)
        conclusions.append({
            "conclusion_id": conclusion.get("conclusion_id"),
            "importance": conclusion.get("importance"),
            "minimum_routes": minimum_routes,
            "progress": {
                "discovered_route_ids": discovered_routes,
                "discovered_route_count": len(discovered_routes),
                "supported": len(discovered_routes) >= minimum_routes,
            },
        })
    data = {
        "discovered_clue_ids": sorted(discovered),
        "clues": [_clue_public_view(c, discovered) for c in clues],
        "conclusions": conclusions,
    }
    return data, [], [
        "conclusion solution prose is intentionally omitted here; reveal only the "
        "player-safe text of clues already recorded as discovered"
    ]


@tool(
    "npc.query",
    "NPC agendas plus live psych state. 'secret'-marked fields are keeper-only reference — never reveal verbatim.",
    {
        "npc_id": {"type": "string", "desc": "a single NPC (default: all)"},
    },
)
def _tool_npc_query(ctx: Ctx, args: dict[str, Any]):
    npc_state = coc_npc_state.load_npc_state(ctx.campaign_dir)
    active_scene_id = ctx.world().get("active_scene_id")
    out = []
    requested_id = str(args.get("npc_id") or "").strip()
    requested_npc = _npc_by_id(ctx.npc_agendas, requested_id) if requested_id else None
    if requested_id and requested_npc is None:
        raise ToolError(
            "unknown_npc",
            f"npc not found or short name is ambiguous: {requested_id}",
        )
    canonical_requested_id = (
        str(requested_npc.get("npc_id")) if requested_npc is not None else ""
    )
    for npc in ctx.npc_agendas.get("npcs") or []:
        if canonical_requested_id and str(npc.get("npc_id")) != canonical_requested_id:
            continue
        npc_id = str(npc.get("npc_id"))
        psych = (npc_state.get("psych") or {}).get(npc_id) or {}
        identity_contract = _npc_identity_contract(npc, active_scene_id)
        out.append({
            "npc_id": npc_id,
            "name": npc.get("name"),
            "identity_ref": identity_contract["identity_ref"],
            "identity_contract": identity_contract,
            # Preserve the authored identity contract.  The module compiler
            # already distinguishes source NPCs from inferred/improvised
            # people and expands their structured social role; dropping those
            # fields here invited downstream Keepers to recast a court contact
            # as a police detective merely because both touch the same file.
            "origin": npc.get("origin"),
            "voice": npc.get("voice"),
            "agenda": npc.get("agenda"),
            "fear": npc.get("fear"),
            "relationship_to_investigators": npc.get("relationship_to_investigators"),
            "social_role": deepcopy(npc.get("social_role")),
            "secret": {"value": npc.get("secret"), "secret": True},
            "keeper_note": {"value": npc.get("keeper_note"), "secret": True},
            "facts": npc.get("facts"),
            "known_fact_ids": npc.get("known_fact_ids"),
            "revealable_fact_ids": npc.get("revealable_fact_ids"),
            "lie_options": npc.get("lie_options"),
            "deflect_options": npc.get("deflect_options"),
            "schedule": npc.get("schedule"),
            "psych": {
                "trust": psych.get("trust", 0),
                "fear": psych.get("fear", 0),
                "suspicion": psych.get("suspicion", 0),
                "known_facts": psych.get("known_facts", []),
                "lies_told": psych.get("lies_told", []),
                "promises": psych.get("promises", []),
                "availability": psych.get("availability"),
            },
        })
    hints = [
        "fields marked secret:true are your reference only — reveal through play, not exposition",
        "origin=source plus relationship_to_investigators/social_role is an authored identity contract: preserve that NPC's institution and role; introduce a new stable NPC id for a different role",
        "pass the returned identity_ref to state.record_npc_engagement only when this authored identity is the one portrayed; a missing or mismatched ref records the interaction but is not authored-NPC coverage",
        "when an authored NPC has no pronoun or gender field, repeat the authored name; never invent a gendered pronoun",
    ]
    if requested_id and requested_id != canonical_requested_id:
        hints.append(
            f"resolved NPC alias '{requested_id}' to authored id '{canonical_requested_id}'"
        )
    return {"npcs": out}, [], hints


@tool(
    "actions.list",
    "Authored affordances of the current scene with roll gates and precondition status (informational, not blocking).",
    {},
)
def _tool_actions_list(ctx: Ctx, args: dict[str, Any]):
    world = ctx.world()
    scene = _scene_by_id(ctx.story_graph, world.get("active_scene_id"))
    discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    out = []
    for aff in (scene or {}).get("affordances") or []:
        if not isinstance(aff, dict):
            continue
        missing_clues = [
            c for c in (aff.get("requires_discovered_clue_ids") or []) if str(c) not in discovered
        ]
        out.append({
            "id": aff.get("id"),
            "action_kind": aff.get("action_kind"),
            "cue": aff.get("cue"),
            "verbs": aff.get("verbs"),
            "skills": aff.get("skills"),
            "target_entities": aff.get("target_entities"),
            "roll_gate": aff.get("roll_gate"),
            "player_visible_outcome": aff.get("player_visible_outcome"),
            "clue_grants": aff.get("clue_grants") or aff.get("grants_clue_ids"),
            "preconditions_met": not missing_clues,
            "missing_prerequisites": missing_clues or None,
            "status": aff.get("status"),
            "operation_available": isinstance(aff.get("rules_operation"), dict),
            "resolution_mode": (
                "typed_tool"
                if isinstance(aff.get("rules_operation"), dict)
                else "keeper_adjudication"
            ),
            "keeper_only": (
                {
                    "secret": True,
                    "operation_kind": aff["rules_operation"].get("kind"),
                    "tool": (
                        "combat.resolve"
                        if aff["rules_operation"].get("kind")
                        == "combat_engagement"
                        else None
                    ),
                }
                if isinstance(aff.get("rules_operation"), dict)
                else None
            ),
        })
    hints = [
        "these are authored suggestions — improvised player actions are equally valid; use rules.roll for risky ones",
        "match action_kind to the player's explicit intent; keeper_adjudication is fully valid and must not be replaced by a typed combat route merely because that route has a tool",
        "keeper_only operation fields are execution data, never player-facing narration",
    ]
    return {"scene_id": world.get("active_scene_id"), "affordances": out}, [], hints


# --------------------------------------------------------------------------- #
# director.* — advisory only
# --------------------------------------------------------------------------- #

@tool(
    "director.advise",
    "Deterministic pacing read: tension, stalling, undiscovered clues, threat clocks — with suggested beats. Advice only.",
    {},
)
def _tool_director_advise(ctx: Ctx, args: dict[str, Any]):
    world = ctx.world()
    pacing = ctx.pacing()
    sg = ctx.story_graph
    active_id = world.get("active_scene_id")
    scene = _scene_by_id(sg, active_id)
    discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    scene_clues = [str(c) for c in (scene or {}).get("available_clues") or []]
    undiscovered_here = [c for c in scene_clues if c not in discovered]
    candidates = coc_scene_graph.transition_candidates(active_id, sg, dict(world))

    threat_path = ctx.campaign_dir / "save" / "threat-state.json"
    clocks: dict[str, Any] = {}
    if threat_path.is_file():
        try:
            clocks = (json.loads(threat_path.read_text(encoding="utf-8")) or {}).get("clocks") or {}
        except (json.JSONDecodeError, OSError):
            clocks = {}

    tension = str(pacing.get("tension_level") or "low")
    recent = [str(i) for i in (pacing.get("recent_intent_classes") or [])]
    stalled = len(recent) >= 3 and all(i in ("stuck", "ambiguous", "meta") for i in recent[-3:])

    suggestions: list[dict[str, str]] = []
    if undiscovered_here:
        suggestions.append({
            "beat": "REVEAL",
            "reason": f"{len(undiscovered_here)} authored clue(s) remain in this scene — give the player a hook toward one",
        })
    if stalled:
        suggestions.append({
            "beat": "RECOVER",
            "reason": "recent turns look stalled — offer an Idea-roll style nudge or an NPC/event that reopens motion",
        })
    if tension == "low" and not undiscovered_here:
        suggestions.append({
            "beat": "PRESSURE",
            "reason": "scene is drained and tension is low — introduce cost, pursuit, or a pressure move from the scene design",
        })
    if candidates and not undiscovered_here:
        suggestions.append({
            "beat": "CUT",
            "reason": f"open exits: {', '.join(candidates)} — a transition may serve better than lingering",
        })
    hot_clocks = [cid for cid, c in clocks.items() if isinstance(c, dict) and int(c.get("filled", 0)) >= max(1, int(c.get("segments", 6)) - 1)]
    if hot_clocks:
        suggestions.append({
            "beat": "THREAT",
            "reason": f"threat clock(s) near full: {', '.join(hot_clocks)} — let the front act onscreen",
        })
    if not suggestions:
        suggestions.append({"beat": "DEEPEN", "reason": "no pressure signals — deepen character, mood, or an existing thread"})

    data = {
        "tension_level": tension,
        "turn_number": pacing.get("turn_number"),
        "recent_intent_classes": recent,
        "stalled": stalled,
        "undiscovered_clues_in_scene": undiscovered_here,
        "open_exits": candidates,
        "threat_clocks": clocks,
        "pressure_moves": (scene or {}).get("pressure_moves"),
        "suggestions": suggestions,
    }
    return data, [], ["suggestions are advisory — your read of the table wins"]


@tool(
    "storylets.suggest",
    "Scored storylet candidates for the current scene with fit reasons. Never suppresses — low fit is just labeled.",
    {
        "max": {"type": "integer", "desc": "max candidates (default 5)"},
        "conflict_level": {"type": "string", "desc": "low | medium | high | climax (default from tension)"},
    },
)
def _tool_storylets_suggest(ctx: Ctx, args: dict[str, Any]):
    world = ctx.world()
    pacing = ctx.pacing()
    scene = _scene_by_id(ctx.story_graph, world.get("active_scene_id")) or {}
    library = coc_storylets.load_storylet_library()
    ledger_path = ctx.campaign_dir / "save" / "storylet-ledger.json"
    used: dict[str, int] = {}
    if ledger_path.is_file():
        try:
            ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
            for entry in ledger.get("used_storylets") or []:
                sid = str(entry.get("storylet_id") if isinstance(entry, dict) else entry)
                used[sid] = used.get(sid, 0) + 1
        except (json.JSONDecodeError, OSError):
            pass

    tension_map = {"low": "low", "medium": "medium", "high": "high", "climax": "climax"}
    level = str(args.get("conflict_level") or tension_map.get(str(pacing.get("tension_level") or "low"), "low"))
    scene_type = str(scene.get("scene_type") or "any")
    scene_tags = {str(t).lower() for t in (scene.get("storylet_tags") or [])}

    scored: list[dict[str, Any]] = []
    for st in library.get("storylets") or []:
        if not isinstance(st, dict):
            continue
        reasons: list[str] = []
        score = float(st.get("base_weight") or 1.0)
        st_level = str(st.get("conflict_level") or "low")
        if st_level == level:
            score += 2.0
            reasons.append(f"conflict level matches ({level})")
        eligible_types = {str(t) for t in (st.get("eligible_scene_types") or [])}
        if scene_type in eligible_types or "any" in eligible_types:
            score += 1.0
            reasons.append(f"fits scene type ({scene_type})")
        st_tags = {str(t).lower() for t in (st.get("scene_tags") or [])}
        overlap = scene_tags & st_tags
        if overlap:
            score += 2.0 * len(overlap)
            reasons.append(f"scene tag overlap: {', '.join(sorted(overlap))}")
        repeats = used.get(str(st.get("storylet_id")), 0)
        if repeats:
            score -= 2.0 * repeats
            reasons.append(f"already used {repeats}x (repetition penalty)")
        scored.append({
            "storylet_id": st.get("storylet_id"),
            "title": st.get("title"),
            "conflict_level": st_level,
            "cue": st.get("cue"),
            "beat": st.get("beat"),
            "narration_directive": st.get("narration_directive"),
            "fit_score": round(score, 2),
            "fit": "high" if score >= 3 else ("medium" if score >= 1.5 else "low"),
            "fit_reasons": reasons,
        })
    scored.sort(key=lambda s: (-s["fit_score"], str(s["storylet_id"])))
    limit = int(args.get("max") or 5)
    data = {"conflict_level": level, "candidates": scored[:limit]}
    hints = ["storylets change presentation and cost only — never rewrite module truth"]
    return data, [], hints


@tool(
    "secrets.briefing",
    "Keeper-only briefing: what is still secret (undiscovered clues, NPC secrets, module truth). Read-only reference.",
    {},
)
def _tool_secrets_briefing(ctx: Ctx, args: dict[str, Any]):
    world = ctx.world()
    discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    undiscovered = [
        {
            "clue_id": c.get("clue_id"),
            "player_safe_summary": c.get("player_safe_summary"),
            "delivery": c.get("delivery"),
        }
        for c in _all_clues(ctx.clue_graph)
        if str(c.get("clue_id")) not in discovered
    ]
    npc_secrets = [
        {"npc_id": n.get("npc_id"), "name": n.get("name"), "secret": n.get("secret"), "keeper_note": n.get("keeper_note")}
        for n in ctx.npc_agendas.get("npcs") or []
        if n.get("secret") or n.get("keeper_note")
    ]
    meta = ctx.scenario("module-meta.json")
    data = {
        "module_truth_note": "module truth is read-only: tools never let you rewrite it, and you should not contradict it",
        "module_meta": {
            "title": meta.get("title"),
            "keeper_overview": {"value": meta.get("keeper_overview") or meta.get("overview"), "secret": True},
        },
        "undiscovered_clues": undiscovered,
        "npc_secrets": npc_secrets,
        "spoiler_reveals_so_far": ctx.flags().get("spoiler_reveals"),
    }
    hints = [
        "reveal secrets only through play (successful rolls, NPC disclosure, discovery) — never as narration exposition",
        "when a secret does surface, record it with state.record_clue or flags so the briefing stays current",
    ]
    return data, [], hints


# --------------------------------------------------------------------------- #
# state.* — transactional writes
# --------------------------------------------------------------------------- #

@tool(
    "state.record_clue",
    "Record a clue as discovered. Idempotent; unlocks any scenes gated on it. Off-design discoveries warn, not block.",
    {
        "clue_id": {"type": "string", "required": True, "desc": "clue id from the clue graph"},
        "method": {"type": "string", "desc": "how it was found (roll, social, exploration...)"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_record_clue(ctx: Ctx, args: dict[str, Any]):
    clue_id = str(args["clue_id"])
    prior = ctx.ledger_lookup("state.record_clue", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    world = ctx.world()
    discovered = [str(c) for c in (world.get("discovered_clue_ids") or [])]
    warnings: list[str] = []
    clue = _clue_by_id(ctx.clue_graph, clue_id)
    if clue is None:
        warnings.append(f"clue '{clue_id}' is not in the clue graph — recording anyway (improvised clue)")
    active = world.get("active_scene_id")
    scene = _scene_by_id(ctx.story_graph, active)
    if clue is not None and scene is not None:
        here = {str(c) for c in scene.get("available_clues") or []}
        if clue_id not in here:
            warnings.append(f"clue '{clue_id}' is not authored for scene '{active}' — fine if you moved it deliberately")

    already = clue_id in discovered
    if not already:
        discovered.append(clue_id)
        world["discovered_clue_ids"] = discovered
    newly_unlocked = _evaluate_and_apply_unlocks(ctx, world)
    ctx.save_world(world)

    flags = ctx.flags()
    clues_found = flags.get("clues_found") or {}
    clues_found[clue_id] = {"ts": _now_iso(), "method": args.get("method")}
    flags["clues_found"] = clues_found
    ctx.save_flags(flags)

    data = {
        "clue_id": clue_id,
        "already_discovered": already,
        "player_safe_summary": (clue or {}).get("player_safe_summary"),
        "localized_text": (clue or {}).get("localized_text"),
        "discovered_total": len(discovered),
        "newly_unlocked_scenes": newly_unlocked,
    }
    if not already:
        ctx.log_event({"event_type": "clue_discovered", "clue_id": clue_id, "method": args.get("method")})
    hints = []
    if newly_unlocked:
        hints.append(f"new scene(s) unlocked: {', '.join(newly_unlocked)} — consider signposting them")
    ctx.ledger_record(args.get("decision_id"), "state.record_clue", data)
    return data, warnings, hints


@tool(
    "state.move_scene",
    "Move the party to a scene. Off-graph or locked moves warn but succeed — you own the fiction.",
    {
        "scene_id": {"type": "string", "required": True, "desc": "destination scene id"},
        "exhaust_previous": {"type": "boolean", "desc": "mark the departed scene exhausted (done with it)"},
        "reason": {"type": "string", "desc": "why the story moves (logged)"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_move_scene(ctx: Ctx, args: dict[str, Any]):
    target = str(args["scene_id"])
    prior = ctx.ledger_lookup("state.move_scene", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    world = ctx.world()
    sg = ctx.story_graph
    active = world.get("active_scene_id")
    warnings: list[str] = []
    scene = _scene_by_id(sg, target)
    if scene is None:
        warnings.append(f"scene '{target}' is not in the story graph — moving anyway (improvised location)")
    else:
        candidates = coc_scene_graph.transition_candidates(active, sg, dict(world))
        unlocked = {str(s) for s in world.get("unlocked_scene_ids") or []}
        if target not in candidates:
            if target not in unlocked:
                edges = coc_scene_graph.derive_scene_edges(sg)
                gate = None
                for edge in edges.get(str(active or ""), []):
                    if str(edge["to"]) == target:
                        gate = edge.get("when")
                        break
                detail = f" (authored gate: {json.dumps(gate, ensure_ascii=False)})" if gate else ""
                warnings.append(
                    f"scene '{target}' is not unlocked by the authored design{detail} — "
                    "moving anyway; make sure the fiction has earned this"
                )
            else:
                warnings.append(
                    f"no authored edge from '{active}' to '{target}' — moving anyway (off-graph travel)"
                )

    coc_scene_graph.record_scene_enter(
        world, target,
        decision_id=args.get("decision_id"),
        ts=_now_iso(),
        mark_previous_exhausted=str(active) if args.get("exhaust_previous") and active else None,
    )
    world["active_scene_id"] = target
    newly_unlocked = _evaluate_and_apply_unlocks(ctx, world)
    ctx.save_world(world)

    active_scene_path = ctx.campaign_dir / "save" / "active-scene.json"
    pointer = {
        "schema_version": 1,
        "campaign_id": ctx.campaign_id,
        "scenario_id": world.get("scenario_id"),
        "scene_id": target,
        "source_event_type": "scene_transition",
        "summary": str(args.get("reason") or ""),
        "pending_choices": None,
    }
    coc_state.write_json_atomic(active_scene_path, pointer)
    ctx.log_event({
        "event_type": "scene_transition",
        "from_scene_id": active,
        "to_scene_id": target,
        "reason": args.get("reason"),
    })
    data = {
        "from_scene_id": active,
        "to_scene_id": target,
        "newly_unlocked_scenes": newly_unlocked,
        "scene": {
            "scene_type": (scene or {}).get("scene_type"),
            "dramatic_question": (scene or {}).get("dramatic_question"),
            "tone": (scene or {}).get("tone"),
        } if scene else None,
    }
    ctx.ledger_record(args.get("decision_id"), "state.move_scene", data)
    return data, warnings, ["call scene.context after moving to see the new scene's full material"]


@tool(
    "state.set_flag",
    "Set or clear a structured world flag (feeds flag_set unlock conditions).",
    {
        "flag_id": {"type": "string", "required": True, "desc": "flag identifier"},
        "value": {"type": "boolean", "desc": "true (default) or false"},
        "reason": {"type": "string", "desc": "why (logged)"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_set_flag(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.set_flag", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    flag_id = str(args["flag_id"])
    value = bool(args.get("value", True))
    flags = ctx.flags()
    flag_map = flags.get("flags") or {}
    previous_value = flag_map.get(flag_id)
    flag_map[flag_id] = value
    flags["flags"] = flag_map
    changed_at = _now_iso()
    provenance_map = flags.get("flag_provenance") or {}
    if not isinstance(provenance_map, dict):
        provenance_map = {}
    provenance_map[flag_id] = {
        "source": "state.set_flag",
        "source_ref": f"save/flags.json#flag_provenance/{flag_id}",
        "decision_id": args.get("decision_id"),
        "changed_at": changed_at,
        "reason": args.get("reason"),
        "previous_value": previous_value,
    }
    flags["flag_provenance"] = provenance_map
    ctx.save_flags(flags)
    world = ctx.world()
    newly_unlocked = _evaluate_and_apply_unlocks(ctx, world)
    if newly_unlocked:
        ctx.save_world(world)
    ctx.log_event({
        "event_type": "flag_set",
        "flag_id": flag_id,
        "value": value,
        "previous_value": previous_value,
        "reason": args.get("reason"),
        "decision_id": args.get("decision_id"),
        "ts": changed_at,
    })
    data = {
        "flag_id": flag_id,
        "value": value,
        "provenance": deepcopy(provenance_map[flag_id]),
        "newly_unlocked_scenes": newly_unlocked,
    }
    ctx.ledger_record(args.get("decision_id"), "state.set_flag", data)
    return data, [], []


@tool(
    "state.clear_transient_condition",
    "Clear one combat-only positional condition after the fiction ends it; injury, dying, and death conditions are intentionally unsupported.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "condition": {
            "type": "string",
            "required": True,
            "desc": "prone | grappled | surprised | outnumbered | fled",
        },
        "reason": {
            "type": "string",
            "required": True,
            "desc": "the narrated action or transition that ended the condition",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_clear_transient_condition(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("state.clear_transient_condition", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    investigator_id = _resolve_investigator(ctx, args)
    condition = str(args["condition"])
    allowed = coc_subsystem_executor.TRANSIENT_COMBAT_CONDITIONS
    if condition not in allowed:
        raise ToolError(
            "invalid_param",
            "only prone, grappled, surprised, outnumbered, or fled may be cleared here",
        )
    reason = str(args["reason"]).strip()
    if not reason:
        raise ToolError("invalid_param", "reason must be non-empty")
    combat = _combat_state(ctx)
    if combat.get("status") == "active":
        raise ToolError(
            "condition_owned_by_active_combat",
            "active-combat positional conditions must be changed through combat resolution",
        )
    state = ctx.inv_state(investigator_id)
    before = list(state.get("conditions") or [])
    changed = condition in before
    if changed:
        state["conditions"] = [value for value in before if value != condition]
        ctx.save_inv_state(investigator_id, state)
        ctx.log_event({
            "event_type": "transient_condition_cleared",
            "investigator_id": investigator_id,
            "condition": condition,
            "reason": reason,
        })
    data = {
        "investigator_id": investigator_id,
        "condition": condition,
        "changed": changed,
        "conditions": list(state.get("conditions") or []),
        "reason": reason,
    }
    ctx.ledger_record(
        decision_id, "state.clear_transient_condition", data
    )
    warnings = [] if changed else [f"condition '{condition}' was already absent"]
    return data, warnings, []


@tool(
    "state.record_npc_engagement",
    "Record that an NPC materially participated in the current scene, even when no psych-state value changed.",
    {
        "npc_id": {"type": "string", "required": True, "desc": "stable authored or improvised NPC id"},
        "interaction_kind": {
            "type": "string",
            "required": True,
            "desc": "dialogue | assistance | opposition | accompaniment | witness | other",
        },
        "identity_ref": {
            "type": "string",
            "desc": "exact identity_ref returned by npc.query/scene.context when the authored identity was portrayed",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_record_npc_engagement(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup(
        "state.record_npc_engagement", args.get("decision_id")
    )
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []

    requested_npc_id = str(args["npc_id"])
    authored_npc = _npc_by_id(ctx.npc_agendas, requested_npc_id)
    npc_id = str(authored_npc.get("npc_id")) if authored_npc else requested_npc_id
    requested_interaction_kind = str(args["interaction_kind"]).strip()
    interaction_kind = requested_interaction_kind
    allowed = {
        "dialogue", "assistance", "opposition", "accompaniment", "witness", "other",
    }
    if interaction_kind not in allowed:
        interaction_kind = "other"
    scene_id = ctx.world().get("active_scene_id")
    identity_contract = (
        _npc_identity_contract(authored_npc, scene_id) if authored_npc else None
    )
    supplied_identity_ref = str(args.get("identity_ref") or "").strip()
    expected_identity_ref = (
        str(identity_contract.get("identity_ref")) if identity_contract else None
    )
    schedule_match = (
        (identity_contract.get("location_provenance") or {}).get(
            "active_scene_matches_schedule"
        )
        if identity_contract
        else None
    )
    binding_reasons: list[str] = []
    if authored_npc is None:
        binding_status = "improvised"
        binding_reasons.append("npc_id_not_in_authored_agendas")
    elif not supplied_identity_ref:
        binding_status = "unverified"
        binding_reasons.append("identity_ref_missing")
    elif supplied_identity_ref != expected_identity_ref:
        binding_status = "mismatch"
        binding_reasons.append("identity_ref_mismatch")
    elif schedule_match is False:
        binding_status = "mismatch"
        binding_reasons.append("active_scene_outside_authored_schedule")
    else:
        binding_status = "authored_bound"
    coverage_eligible = binding_status == "authored_bound"
    event = {
        "event_type": "npc_engagement",
        "npc_id": npc_id,
        "scene_id": scene_id,
        "interaction_kind": interaction_kind,
        "identity_contract": identity_contract,
        "identity_binding": {
            "status": binding_status,
            "authored_identity_attested": coverage_eligible,
            "coverage_eligible": coverage_eligible,
            "supplied_identity_ref": supplied_identity_ref or None,
            "expected_identity_ref": expected_identity_ref,
            "reasons": binding_reasons,
        },
    }
    warnings: list[str] = []
    if authored_npc is None:
        warnings.append(
            f"npc '{npc_id}' is not in the authored agendas — recorded as an improvised NPC"
        )
    elif binding_status == "unverified":
        warnings.append(
            f"authored npc '{npc_id}' engagement was recorded, but identity_ref is missing; it is not authored-NPC coverage"
        )
    elif binding_status == "mismatch" and "identity_ref_mismatch" in binding_reasons:
        warnings.append(
            f"supplied identity_ref does not match authored npc '{npc_id}'; engagement was recorded without authored-NPC coverage"
        )
    elif binding_status == "mismatch":
        warnings.append(
            f"authored npc '{npc_id}' is outside its structured scene schedule; engagement was recorded without authored-NPC coverage"
        )
    if authored_npc is not None and requested_npc_id != npc_id:
        warnings.append(
            f"resolved NPC alias '{requested_npc_id}' to authored id '{npc_id}'"
        )
    if requested_interaction_kind != interaction_kind:
        event["interaction_label"] = requested_interaction_kind
        warnings.append(
            f"unrecognized interaction_kind '{requested_interaction_kind}' was preserved as interaction_label and normalized to 'other'"
        )
    ctx.log_event(event)
    data = deepcopy(event)
    ctx.ledger_record(
        args.get("decision_id"), "state.record_npc_engagement", data
    )
    return data, warnings, []


@tool(
    "state.npc_update",
    "Update an NPC's live psych state: trust/fear/suspicion deltas, facts told, lies, promises, availability.",
    {
        "npc_id": {"type": "string", "required": True, "desc": "npc id"},
        "trust_delta": {"type": "integer", "desc": "trust adjustment (-5..5 clamped)"},
        "fear_delta": {"type": "integer", "desc": "fear adjustment"},
        "suspicion_delta": {"type": "integer", "desc": "suspicion adjustment"},
        "record_fact": {"type": "string", "desc": "fact_id the NPC just disclosed"},
        "record_lie": {"type": "string", "desc": "lie_id the NPC just told"},
        "record_promise": {"type": "string", "desc": "promise_id made"},
        "availability": {"type": "string", "desc": "availability status (available/unavailable/...)"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_npc_update(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.npc_update", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    requested_npc_id = str(args["npc_id"])
    authored_npc = _npc_by_id(ctx.npc_agendas, requested_npc_id)
    npc_id = str(authored_npc.get("npc_id")) if authored_npc else requested_npc_id
    applied: dict[str, Any] = {}
    for field, key in (("trust", "trust_delta"), ("fear", "fear_delta"), ("suspicion", "suspicion_delta")):
        if args.get(key) is not None:
            applied[field] = coc_npc_state.adjust(ctx.campaign_dir, npc_id, field, int(args[key]))
    if args.get("record_fact"):
        coc_npc_state.record_fact(ctx.campaign_dir, npc_id, str(args["record_fact"]))
        applied["recorded_fact"] = str(args["record_fact"])
    if args.get("record_lie"):
        coc_npc_state.record_lie(ctx.campaign_dir, npc_id, str(args["record_lie"]))
        applied["recorded_lie"] = str(args["record_lie"])
    if args.get("record_promise"):
        coc_npc_state.record_promise(ctx.campaign_dir, npc_id, str(args["record_promise"]))
        applied["recorded_promise"] = str(args["record_promise"])
    if args.get("availability"):
        coc_npc_state.set_availability(ctx.campaign_dir, npc_id, str(args["availability"]))
        applied["availability"] = str(args["availability"])
    ctx.log_event({"event_type": "npc_update", "npc_id": npc_id, "applied": applied})
    entry = coc_npc_state.get_npc_entry(ctx.campaign_dir, npc_id)
    warnings: list[str] = []
    if authored_npc is None:
        warnings.append(f"npc '{npc_id}' is not in the authored agendas — tracking state anyway (improvised NPC)")
    elif requested_npc_id != npc_id:
        warnings.append(
            f"resolved NPC alias '{requested_npc_id}' to authored id '{npc_id}'"
        )
    data = {"npc_id": npc_id, "applied": applied, "psych": entry}
    ctx.ledger_record(args.get("decision_id"), "state.npc_update", data)
    return data, warnings, []


@tool(
    "state.time_marker",
    "Set, reset, or clear a persistent in-fiction deadline marker. Bookkeeping only; it never auto-fires narrative effects.",
    {
        "action": {"type": "string", "required": True, "desc": "set | reset | clear"},
        "marker_id": {"type": "string", "required": True, "desc": "stable deadline/agreement id"},
        "minutes_from_now": {
            "type": "integer",
            "desc": "minutes until due; required for set/reset and must be >= 0",
        },
        "label": {"type": "string", "desc": "short keeper-facing label"},
        "reason": {"type": "string", "desc": "why the marker changed (logged)"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_time_marker(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("state.time_marker", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    action = str(args["action"]).strip().lower()
    if action not in {"set", "reset", "clear"}:
        raise ToolError("invalid_param", "action must be set, reset, or clear")
    marker_id = str(args["marker_id"]).strip()
    if not marker_id:
        raise ToolError("invalid_param", "marker_id must be non-empty")

    payload = _load_time_markers(ctx)
    markers = payload["markers"]
    existing = markers.get(marker_id)
    existing = deepcopy(existing) if isinstance(existing, dict) else None
    warnings: list[str] = []
    now_wall = _now_iso()
    current = coc_time.current_stamp(ctx.campaign_dir)
    projected_marker: dict[str, Any] | None

    if action in {"set", "reset"}:
        if args.get("minutes_from_now") is None:
            raise ToolError(
                "missing_param", "minutes_from_now is required for set/reset"
            )
        minutes_from_now = int(args["minutes_from_now"])
        if minutes_from_now < 0:
            raise ToolError(
                "invalid_param", "minutes_from_now must be >= 0 (time is monotonic)"
            )
        if action == "reset" and existing is None:
            warnings.append(
                f"time marker '{marker_id}' did not exist; reset created it"
            )
        if action == "set" and existing and existing.get("status") == "active":
            warnings.append(
                f"time marker '{marker_id}' was already active; set replaced its due time"
            )
        revision = int((existing or {}).get("revision") or 0) + 1
        marker = {
            "marker_id": marker_id,
            "label": str(
                args.get("label")
                or (existing or {}).get("label")
                or marker_id
            ),
            "status": "active",
            "revision": revision,
            "due_at": _deadline_due_at(current, minutes_from_now),
            "created_at": (existing or {}).get("created_at") or now_wall,
            "updated_at": now_wall,
            "decision_id": decision_id,
            "reason": args.get("reason"),
        }
        markers[marker_id] = marker
        _save_time_markers(ctx, payload)
        projected_marker = _project_time_marker(marker, current)
    else:
        if existing is None:
            warnings.append(
                f"time marker '{marker_id}' was already absent; clear recorded a no-op"
            )
            projected_marker = None
        else:
            existing["status"] = "cleared"
            existing["revision"] = int(existing.get("revision") or 0) + 1
            existing["updated_at"] = now_wall
            existing["cleared_at"] = now_wall
            existing["decision_id"] = decision_id
            existing["reason"] = args.get("reason")
            markers[marker_id] = existing
            _save_time_markers(ctx, payload)
            projected_marker = _project_time_marker(existing, current)

    ctx.log_event({
        "event_type": "time_marker_changed",
        "action": action,
        "marker_id": marker_id,
        "decision_id": decision_id,
        "reason": args.get("reason"),
        "previous_due_at": deepcopy((existing or {}).get("due_at")),
        "due_at": deepcopy((markers.get(marker_id) or {}).get("due_at")),
        "status": (markers.get(marker_id) or {}).get("status", "absent"),
    })
    data = {
        "action": action,
        "marker": projected_marker,
        "current_time": current,
        "active_time_markers": _active_time_markers(ctx),
    }
    ctx.ledger_record(decision_id, "state.time_marker", data)
    return data, warnings, [
        "time markers are deterministic bookkeeping only; due/overdue status does not auto-trigger rescue, scene movement, or any narrative gate"
    ]


@tool(
    "state.advance_time",
    "Advance the in-fiction clock (monotonic). Fires any due scheduled triggers.",
    {
        "minutes": {"type": "integer", "required": True, "desc": "minutes to advance (>= 0)"},
        "reason": {"type": "string", "required": True, "desc": "what consumed the time"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_advance_time(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.advance_time", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    result = coc_time.advance_time(
        ctx.campaign_dir,
        int(args["minutes"]),
        decision_id=str(args.get("decision_id") or f"toolbox-{_now_iso()}"),
        reason=str(args["reason"]),
        source="keeper_toolbox",
    )
    hints = []
    active_time_markers = _active_time_markers(ctx)
    result["active_time_markers"] = active_time_markers
    if result.get("fired_triggers"):
        hints.append("scheduled trigger(s) fired — weave their effects into the narration")
    if any(
        marker.get("timing_state") in {"due", "overdue"}
        for marker in active_time_markers
    ):
        hints.append(
            "one or more time markers are due/overdue; use the structured values for bookkeeping, but do not auto-apply a narrative consequence"
        )
    ctx.ledger_record(args.get("decision_id"), "state.advance_time", result)
    return result, [], hints


@tool(
    "state.journal",
    "Close out a narrated turn: bump the turn counter, optionally set tension, and write player-safe receipts.",
    {
        "summary": {"type": "string", "required": True, "desc": "player-safe summary of what just happened"},
        "player_action": {"type": "string", "desc": "what the player did (verbatim or condensed)"},
        "intent_class": {"type": "string", "desc": "your read of the intent (investigate/social/move/stuck/meta/...)"},
        "tension": {"type": "string", "desc": "set tension level: low | medium | high | climax"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_journal(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.journal", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    pacing = ctx.pacing()
    pacing["turn_number"] = int(pacing.get("turn_number") or 0) + 1
    warnings: list[str] = []
    if args.get("tension"):
        tension = str(args["tension"])
        if tension in ("low", "medium", "high", "climax"):
            pacing["tension_level"] = tension
        else:
            warnings.append(f"unknown tension '{tension}' — kept '{pacing.get('tension_level')}'")
    if args.get("intent_class"):
        recent = [str(i) for i in (pacing.get("recent_intent_classes") or [])]
        recent.append(str(args["intent_class"]))
        pacing["recent_intent_classes"] = recent[-8:]
    ctx.save_pacing(pacing)

    ctx.log_event({
        "event_type": "turn",
        "turn_number": pacing["turn_number"],
        "player_action": args.get("player_action"),
        "summary": str(args["summary"]),
    })
    coc_state.append_jsonl(
        ctx.campaign_dir / "memory" / "session-summaries.jsonl",
        {
            "ts": _now_iso(),
            "turn_number": pacing["turn_number"],
            "summary": str(args["summary"]),
        },
    )
    data = {"turn_number": pacing["turn_number"], "tension_level": pacing.get("tension_level")}
    ctx.ledger_record(args.get("decision_id"), "state.journal", data)
    return data, warnings, []


def _ending_rng(ending: dict[str, Any], investigator_id: str) -> random.Random:
    identities = ending.get("rng_identity")
    identity = identities.get(investigator_id) if isinstance(identities, dict) else None
    seed_material = (
        identity.get("seed_material") if isinstance(identity, dict) else None
    )
    if not isinstance(seed_material, str) or not seed_material:
        seed_material = (
            f"{ending.get('ending_id', 'pending-ending')}:"
            f"{investigator_id}:development.settle"
        )
    return random.Random(seed_material)


def _development_finalizer(
    ctx: Ctx,
    ending: dict[str, Any] | None,
) -> dict[str, Any]:
    """Synchronously settle deterministic post-ending bookkeeping.

    This is deliberately not a narrative gate.  Exhausted retries leave the
    ending in place and return structured pending evidence for later replay.
    """
    if ending is None:
        return {
            "status": "PENDING",
            "ending_id": None,
            "settlements": [],
            "error": "persisted ending evidence is unavailable",
        }
    frozen = ending.get("investigator_ids")
    if not isinstance(frozen, list) or not all(
        isinstance(value, str) for value in frozen
    ):
        return {
            "status": "PENDING",
            "ending_id": ending.get("ending_id"),
            "settlements": [],
            "error": "persisted ending target contract is invalid",
        }
    unique_ids = list(dict.fromkeys(value for value in frozen if value))
    if not unique_ids:
        return {
            "status": "PASS",
            "ending_id": ending["ending_id"],
            "settlements": [],
        }
    settlements: list[dict[str, Any]] = []
    for investigator_id in unique_ids:
        last_error: str | None = None
        for attempt in range(1, _TOOL_TRANSIENT_RETRY_ATTEMPTS + 1):
            try:
                receipt = coc_runtime_ops.settle_development(
                    ctx.campaign_dir,
                    investigator_id,
                    rng=_ending_rng(ending, investigator_id),
                    ending_id=str(ending["ending_id"]),
                )
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                if attempt < _TOOL_TRANSIENT_RETRY_ATTEMPTS:
                    time.sleep(_TOOL_TRANSIENT_RETRY_DELAY_SECONDS * attempt)
                    continue
                settlements.append({
                    "investigator_id": investigator_id,
                    "status": "PENDING",
                    "attempts": attempt,
                    "error": last_error,
                })
            else:
                settlements.append({
                    "investigator_id": investigator_id,
                    "status": "PASS",
                    "attempts": attempt,
                    "receipt": receipt,
                })
            break
    status = (
        "PASS"
        if settlements and all(row.get("status") == "PASS" for row in settlements)
        else "PENDING"
    )
    return {
        "status": status,
        "ending_id": ending["ending_id"],
        "settlements": settlements,
    }


def _record_settlement_pending(ctx: Ctx, development: dict[str, Any]) -> None:
    ending_id = development.get("ending_id")
    path = ctx.campaign_dir / "logs" / "events.jsonl"
    existing: set[tuple[str, str]] = set()
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict) and row.get("event_type") == "development_settlement_pending":
                existing.add((
                    str(row.get("ending_id") or ""),
                    str(row.get("investigator_id") or ""),
                ))
    for settlement in development.get("settlements") or []:
        if not isinstance(settlement, dict) or settlement.get("status") != "PENDING":
            continue
        investigator_id = str(settlement.get("investigator_id") or "")
        key = (str(ending_id or ""), investigator_id)
        if key in existing:
            continue
        ctx.log_event({
            "event_type": "development_settlement_pending",
            "ending_id": ending_id,
            "investigator_id": investigator_id,
            "attempts": settlement.get("attempts"),
            "error": settlement.get("error"),
        })
        existing.add(key)


def _normalized_investigator_ids(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    normalized: list[str] = []
    for value in values:
        if not isinstance(value, str) or not value:
            continue
        if _SAFE_ID.fullmatch(value) is None:
            raise ToolError(
                "invalid_param", "investigator id must be a stable safe id"
            )
        if value not in normalized:
            normalized.append(value)
    return normalized


def _requested_ending_targets(ctx: Ctx, args: dict[str, Any]) -> list[str]:
    return _normalized_investigator_ids(
        [str(args["investigator"])]
        if args.get("investigator") else ctx.party_ids()
    )


def _ending_target_retry_conflict(
    ctx: Ctx,
    args: dict[str, Any],
    frozen_ids: list[str],
) -> dict[str, Any] | None:
    requested_ids = _requested_ending_targets(ctx, args)
    if requested_ids == frozen_ids:
        return None
    return {
        "code": "SETTLEMENT_TARGET_CONFLICT",
        "frozen_investigator_ids": list(frozen_ids),
        "retry_investigator_ids": requested_ids,
        "resolution": "frozen_targets_preserved",
    }


@tool(
    "development.settle",
    "Replay or complete deterministic post-ending development bookkeeping through the canonical development engine.",
    {
        "investigator": {"type": "string", "desc": "investigator id; defaults to the linked party member"},
        "ending_id": {"type": "string", "desc": "exact persisted ending id; defaults to the latest ending"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
        "seed": {"type": "integer", "desc": "deterministic RNG seed (tests only)"},
    },
)
def _tool_development_settle(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("development.settle", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    investigator_id = _resolve_investigator(ctx, args)
    try:
        ending = coc_development.structured_ending_evidence(
            ctx.campaign_dir,
            ending_id=(str(args["ending_id"]) if args.get("ending_id") else None),
        )
        if ending is None:
            raise coc_runtime_ops.RuntimeOperationError(
                "development.settle requires a persisted state.end_session receipt"
            )
        rng = _rng(args) if args.get("seed") is not None else _ending_rng(
            ending, investigator_id
        )
        receipt = coc_runtime_ops.settle_development(
            ctx.campaign_dir,
            investigator_id,
            rng=rng,
            ending_id=str(ending["ending_id"]),
        )
    except coc_runtime_ops.DevelopmentRecoveryConflict as exc:
        raise ToolError("recovery_conflict", str(exc)) from exc
    except coc_runtime_ops.DevelopmentTargetConflict as exc:
        raise ToolError("settlement_target_conflict", str(exc)) from exc
    except coc_runtime_ops.RuntimeOperationError as exc:
        if "requires a persisted state.end_session" in str(exc):
            raise ToolError("settlement_unavailable", str(exc)) from exc
        raise ToolError("development_settlement_failed", str(exc)) from exc
    except Exception as exc:
        raise ToolError("development_settlement_failed", str(exc)) from exc
    data = {
        "ending_id": (receipt.get("result") or {}).get("ending_evidence", {}).get("ending_id"),
        "receipt": receipt,
    }
    ctx.ledger_record(decision_id, "development.settle", data)
    return data, [], ["development settlement is complete and safe to report"]


@tool(
    "state.end_session",
    "Declare a structured story ending, then synchronously finalize deterministic development bookkeeping without gating narration.",
    {
        "kind": {"type": "string", "desc": "ending flavor: conclusion | tpk | retreat | cliffhanger (default conclusion)"},
        "summary": {"type": "string", "desc": "player-safe closing summary"},
        "investigator": {"type": "string", "desc": "optional investigator id; defaults to every linked party member"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_end_session(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.end_session", args.get("decision_id"))
    if prior is not None:
        data = deepcopy(prior.get("data") or {})
        frozen_present = isinstance(data.get("investigator_ids"), list)
        frozen_ids = _normalized_investigator_ids(data.get("investigator_ids"))
        if not frozen_present:
            frozen_ids = _normalized_investigator_ids([
                row.get("investigator_id")
                for row in (data.get("development") or {}).get("settlements", [])
                if isinstance(row, dict)
            ])
            frozen_present = bool(frozen_ids)
        target_conflict = _ending_target_retry_conflict(
            ctx, args, frozen_ids
        ) if frozen_present else None
        if target_conflict is not None:
            data["retry_target_conflict"] = target_conflict
        development = data.get("development")
        if not isinstance(development, dict) or development.get("status") != "PASS":
            ending = coc_development.structured_ending_evidence(
                ctx.campaign_dir,
                ending_id=(
                    str(data["ending_id"]) if data.get("ending_id") else None
                ),
                decision_id=(
                    None if data.get("ending_id") else str(args["decision_id"])
                ),
            )
            development = _development_finalizer(ctx, ending)
            data["development"] = development
            if development.get("ending_id") is not None:
                data["ending_id"] = development.get("ending_id")
            data["investigator_ids"] = frozen_ids
            ctx.ledger_record(args.get("decision_id"), "state.end_session", data)
            if development.get("status") != "PASS":
                _record_settlement_pending(ctx, development)
                warnings = [
                    "duplicate ending receipt replayed; development settlement remains pending"
                ]
                if target_conflict is not None:
                    warnings.append(
                        "SETTLEMENT_TARGET_CONFLICT: retry target set differed; the persisted ending targets were preserved"
                    )
                return data, warnings, [
                    "retry state.end_session or development.settle with the same decision identity"
                ]
            warnings = [
                "duplicate ending receipt replayed; pending development settlement completed"
            ]
            if target_conflict is not None:
                warnings.append(
                    "SETTLEMENT_TARGET_CONFLICT: retry target set differed; the persisted ending targets were preserved"
                )
            return data, warnings, []
        warnings = ["duplicate decision_id: returning the previously settled result"]
        if target_conflict is not None:
            warnings.append(
                "SETTLEMENT_TARGET_CONFLICT: retry target set differed; the persisted ending targets were preserved"
            )
        return data, warnings, []
    decision_id = str(args["decision_id"])
    existing_ending: dict[str, Any] | None = None
    target_conflict: dict[str, Any] | None = None
    event_path = ctx.campaign_dir / "logs" / "events.jsonl"
    if event_path.is_file():
        for line in reversed(event_path.read_text(encoding="utf-8").splitlines()):
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if (
                isinstance(row, dict)
                and row.get("event_type") == "session_ending"
                and row.get("decision_id") == decision_id
            ):
                existing_ending = row
                break
    if existing_ending is not None:
        scene_id = existing_ending.get("scene_id")
        kind = str(existing_ending.get("kind") or "conclusion")
        frozen_present = isinstance(existing_ending.get("investigator_ids"), list)
        targets = _normalized_investigator_ids(existing_ending.get("investigator_ids"))
        if not frozen_present:
            # Legacy crash receipts predate frozen targets.  Freeze them once
            # in the reconstructed toolbox receipt; new endings always persist
            # them in the event itself before settlement begins.
            targets = _requested_ending_targets(ctx, args)
        else:
            target_conflict = _ending_target_retry_conflict(ctx, args, targets)
        ending = coc_development.structured_ending_evidence(
            ctx.campaign_dir,
            ending_id=(
                str(existing_ending["ending_id"])
                if existing_ending.get("ending_id") else None
            ),
            decision_id=(
                None if existing_ending.get("ending_id") else decision_id
            ),
        )
    else:
        try:
            ending = coc_development.ending_settlement_capsule_for_decision(
                ctx.campaign_dir, decision_id
            )
        except ValueError as exc:
            raise ToolError(
                "development_settlement_failed", str(exc)
            ) from exc
        if ending is not None:
            # A capsule may be the sole durable artifact after a process exit
            # between capsule persistence and event append.  Reconstruct the
            # event from that capsule, never from the now-current scene/party.
            scene_id = ending.get("scene_id")
            kind = str(ending.get("kind") or "conclusion")
            targets = _normalized_investigator_ids(
                ending.get("investigator_ids")
            )
            target_conflict = _ending_target_retry_conflict(
                ctx, args, targets
            )
            record = {
                "event_type": "session_ending",
                "event_id": ending["event_id"],
                "ending_id": ending["ending_id"],
                "scene_id": scene_id,
                "kind": kind,
                "decision_id": decision_id,
                "investigator_ids": targets,
                "ts": ending["captured_at"],
            }
            if ending.get("summary") is not None:
                record["summary"] = ending["summary"]
            capsule_path = coc_development.ending_settlement_capsule_path(
                ctx.campaign_dir, ending["ending_id"]
            )
        else:
            world = ctx.world()
            scene_id = world.get("active_scene_id")
            kind = str(args.get("kind") or "conclusion")
            if kind not in {"conclusion", "tpk", "retreat", "cliffhanger"}:
                raise ToolError(
                    "invalid_param",
                    "kind must be conclusion, tpk, retreat, or cliffhanger",
                )
            targets = _requested_ending_targets(ctx, args)
            record = {
                "event_type": "session_ending",
                "scene_id": scene_id,
                "kind": kind,
                "decision_id": decision_id,
                "investigator_ids": targets,
                "ts": _now_iso(),
            }
            if args.get("summary"):
                record["summary"] = str(args["summary"])
            record["ending_id"] = coc_development.ending_id_for_event(record)
            record["event_id"] = coc_development.ending_event_id(
                record["ending_id"]
            )
            # Claim shared reusable tick inputs while holding every target's
            # lock.  The surrounding transaction owns the campaign lock, so
            # the global order remains campaign -> investigator.
            with ExitStack() as input_locks:
                for investigator_id in sorted(set(targets)):
                    lock_path = (
                        ctx.coc_root
                        / "locks"
                        / "investigators"
                        / investigator_id
                        / ".investigator.lock"
                    )
                    if not coc_development._safe_campaign_child_target(
                        ctx.coc_root, lock_path
                    ):
                        raise ToolError(
                            "development_settlement_failed",
                            "investigator lock target is unsafe",
                        )
                    input_locks.enter_context(coc_fileio.advisory_file_lock(
                        lock_path,
                        wait_seconds=5.0,
                    ))
                capsule_path = coc_development.ending_settlement_capsule_path(
                    ctx.campaign_dir, record["ending_id"]
                )
                if capsule_path.exists() or capsule_path.is_symlink():
                    raise ToolError(
                        "development_settlement_failed",
                        "persisted ending settlement capsule is invalid",
                    )
                ending = coc_development.build_ending_settlement_capsule(
                    ctx.campaign_dir, record
                )
                capsule_path = coc_development.persist_ending_settlement_capsule(
                    ctx.campaign_dir, ending
                )
        if (
            ending.get("decision_id") != decision_id
            or ending.get("event_id") != record.get("event_id")
            or ending.get("captured_at") != record.get("ts")
            or ending.get("summary") != record.get("summary")
            or ending.get("scene_id") != scene_id
            or ending.get("kind") != kind
            or ending.get("investigator_ids") != targets
        ):
            raise ToolError(
                "development_settlement_failed",
                "persisted ending capsule identity conflicts with this decision",
            )
        record["settlement_capsule_ref"] = capsule_path.relative_to(
            ctx.campaign_dir
        ).as_posix()
        record["settlement_capsule_sha256"] = ending["capsule_sha256"]
        ctx.log_event(record)
    development = _development_finalizer(ctx, ending)
    data = {
        "session_ending": True,
        "scene_id": scene_id,
        "kind": kind,
        "investigator_ids": targets,
        "ending_id": development.get("ending_id"),
        "development": development,
    }
    if target_conflict is not None:
        data["retry_target_conflict"] = target_conflict
    ctx.ledger_record(args.get("decision_id"), "state.end_session", data)
    if development.get("status") != "PASS":
        _record_settlement_pending(ctx, development)
        warnings = [
            "session ending is durable, but development settlement remains pending after bounded retries"
        ]
        if target_conflict is not None:
            warnings.append(
                "SETTLEMENT_TARGET_CONFLICT: retry target set differed; the persisted ending targets were preserved"
            )
        return data, warnings, [
            "retry state.end_session or development.settle with the same decision identity; do not reopen narration"
        ]
    warnings = []
    if target_conflict is not None:
        warnings.append(
            "SETTLEMENT_TARGET_CONFLICT: retry target set differed; the persisted ending targets were preserved"
        )
    return data, warnings, ["development settlement completed synchronously"]


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

_MUTATING_TOOLS = frozenset({
    "rules.roll",
    "rules.push",
    "rules.roll_dice",
    "rules.opposed",
    "rules.sanity_check",
    "rules.damage",
    "rules.luck_spend",
    "rules.first_aid",
    "rules.medicine",
    "rules.weekly_recovery",
    "rules.dying_check",
    "combat.resolve",
    "combat.end",
    "development.settle",
    "state.record_clue",
    "state.move_scene",
    "state.set_flag",
    "state.clear_transient_condition",
    "state.record_npc_engagement",
    "state.npc_update",
    "state.time_marker",
    "state.advance_time",
    "state.journal",
    "state.end_session",
})
for _mutating_tool_name in _MUTATING_TOOLS:
    _decision_spec = TOOLS[_mutating_tool_name]["params"].get("decision_id")
    if not isinstance(_decision_spec, dict):
        raise RuntimeError(
            f"mutating toolbox tool lacks decision_id: {_mutating_tool_name}"
        )
    _decision_spec["required"] = True

def _describe(name: str) -> dict[str, Any]:
    spec = TOOLS[name]
    return {
        "name": spec["name"],
        "summary": spec["summary"],
        "needs_campaign": spec["needs_campaign"],
        "params": spec["params"],
    }


def list_tools() -> list[dict[str, Any]]:
    return [{"name": n, "summary": TOOLS[n]["summary"]} for n in sorted(TOOLS)]


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        print("tools:")
        for entry in list_tools():
            print(f"  {entry['name']:24s} {entry['summary']}")
        return 0

    command = argv[0]
    if command == "list":
        print(json.dumps({"tools": list_tools()}, ensure_ascii=False, indent=2))
        return 0
    if command == "describe":
        if len(argv) < 2 or argv[1] not in TOOLS:
            print(json.dumps({"ok": False, "error": {"code": "unknown_tool", "message": "describe <tool>"}}))
            return 1
        print(json.dumps(_describe(argv[1]), ensure_ascii=False, indent=2))
        return 0

    parser = argparse.ArgumentParser(prog=f"coc_toolbox.py {command}")
    parser.add_argument("--root", default=".", help="project root containing .coc/")
    parser.add_argument("--campaign", default=None, help="campaign id")
    parser.add_argument("--json", default=None, help="tool arguments as a JSON object")
    opts = parser.parse_args(argv[1:])
    try:
        args = json.loads(opts.json) if opts.json else {}
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "error": {"code": "bad_json", "message": str(exc)}}))
        return 1
    if not isinstance(args, dict):
        print(json.dumps({"ok": False, "error": {"code": "bad_json", "message": "--json must be an object"}}))
        return 1

    envelope = run_tool(command, Path(opts.root).resolve(), opts.campaign, args)
    print(json.dumps(envelope, ensure_ascii=False, indent=2))
    return 0 if envelope.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
