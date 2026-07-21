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
    uv run --frozen python coc_toolbox.py list [--json]
    uv run --frozen python coc_toolbox.py describe <tool>
    uv run --frozen python coc_toolbox.py <tool> --root . --campaign <id> [--json '<args>']
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
from copy import deepcopy
import hashlib
import importlib.util
import json
import os
import random
import re
import sys
import time
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
coc_flag_state = _load_sibling("coc_flag_state_toolbox", "coc_flag_state.py")
coc_roll = _load_sibling("coc_roll", "coc_roll.py")
coc_language = _load_sibling("coc_language", "coc_language.py")
coc_rules = _load_sibling("coc_rules", "coc_rules.py")
coc_rulesets = _load_sibling("coc_rulesets", "coc_rulesets.py")
coc_rule_signals = _load_sibling("coc_rule_signals", "coc_rule_signals.py")
coc_scene_graph = _load_sibling("coc_scene_graph", "coc_scene_graph.py")
coc_npc_state = _load_sibling("coc_npc_state", "coc_npc_state.py")
coc_npc_identity = _load_sibling("coc_npc_identity_toolbox", "coc_npc_identity.py")
coc_npc_event_chain = _load_sibling(
    "coc_npc_event_chain_toolbox", "coc_npc_event_chain.py"
)
coc_first_impression = _load_sibling(
    "coc_first_impression", "coc_first_impression.py"
)
coc_async_recorder = _load_sibling(
    "coc_async_recorder_toolbox", "coc_async_recorder.py"
)
coc_time = _load_sibling("coc_time", "coc_time.py")
coc_storylets = _load_sibling("coc_storylets", "coc_storylets.py")
# NOTE: coc_sanity is no longer imported here directly — rules.* handlers
# obtain SAN mechanics through _rules_resolver (contract §4 seam 2).
coc_chase = _load_sibling("coc_chase_toolbox", "coc_chase.py")
coc_story_director = _load_sibling(
    "coc_story_director_toolbox", "coc_story_director.py"
)
coc_npc_persona = _load_sibling("coc_npc_persona_toolbox", "coc_npc_persona.py")
coc_threat_state = _load_sibling("coc_threat_state_toolbox", "coc_threat_state.py")
coc_belief_state = _load_sibling("coc_belief_state_toolbox", "coc_belief_state.py")
coc_epistemic_lifecycle = _load_sibling(
    "coc_epistemic_lifecycle_toolbox", "coc_epistemic_lifecycle.py"
)
coc_narration_style = _load_sibling(
    "coc_narration_style_toolbox", "coc_narration_style.py"
)
coc_narration_contract = _load_sibling(
    "coc_narration_contract_toolbox", "coc_narration_contract.py"
)
coc_exceptional_effects = _load_sibling(
    "coc_exceptional_effects", "coc_exceptional_effects.py"
)
coc_turn_manifest = _load_sibling("coc_turn_manifest", "coc_turn_manifest.py")
coc_continuation = _load_sibling("coc_continuation", "coc_continuation.py")
coc_host_context = _load_sibling("coc_host_context", "coc_host_context.py")
coc_working_set_cache = _load_sibling(
    "coc_working_set_cache", "coc_working_set_cache.py"
)
coc_turn_finalization = _load_sibling(
    "coc_turn_finalization", "coc_turn_finalization.py"
)
coc_development = _load_sibling("coc_development_toolbox", "coc_development.py")
coc_runtime_ops = _load_sibling("coc_runtime_ops_toolbox", "coc_runtime_ops.py")
coc_narrative_enrichment = _load_sibling(
    "coc_narrative_enrichment_toolbox", "coc_narrative_enrichment.py"
)
coc_subsystem_executor = _load_sibling(
    "coc_subsystem_executor_toolbox", "coc_subsystem_executor.py"
)
coc_inventory = _load_sibling("coc_inventory", "coc_inventory.py")
coc_mechanics = _load_sibling("coc_mechanics_toolbox", "coc_mechanics.py")
coc_action_resolver = _load_sibling(
    "coc_action_resolver_toolbox", "coc_action_resolver.py"
)
coc_keeper_planner = _load_sibling(
    "coc_keeper_planner_toolbox", "coc_keeper_planner.py"
)
coc_module_project = _load_sibling(
    "coc_module_project_toolbox", "coc_module_project.py"
)
coc_compiled_archive = _load_sibling(
    "coc_compiled_archive_toolbox", "coc_compiled_archive.py"
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
_LEDGER_SCHEMA_VERSION = 2
_LEDGER_FIELDS = frozenset({"schema_version", "entries"})
_LEDGER_ENTRY_V2_FIELDS = frozenset({
    "entry_schema_version", "tool", "decision_id", "ts", "data",
})
_LEDGER_ENTRY_V3_FIELDS = frozenset({
    *_LEDGER_ENTRY_V2_FIELDS,
    "source_receipt_required",
    "source_receipt_manifest",
})
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
    def __init__(
        self,
        code: str,
        message: str,
        *,
        violations: list[dict[str, str]] | None = None,
        details: dict[str, Any] | None = None,
    ):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.violations = violations
        self.details = deepcopy(details) if isinstance(details, dict) else None


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

    @property
    def module_meta(self) -> dict[str, Any]:
        return self.scenario("module-meta.json")

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
        if not path.is_file():
            return coc_flag_state.new_flag_document(campaign_id=self.campaign_id)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError, UnicodeError) as exc:
            raise ToolError(
                "state_corrupt",
                "save/flags.json exists but is unreadable or invalid JSON; refusing to replace canonical flag state",
            ) from exc
        if not coc_flag_state.valid_flag_document_structure(data):
            raise ToolError(
                "state_corrupt",
                "save/flags.json does not match the current schema-v3 document",
            )
        if data.get("campaign_id") not in (None, self.campaign_id):
            raise ToolError("state_corrupt", "save/flags.json campaign identity is invalid")
        receipts = data[_SOURCE_RECEIPTS_KEY]
        for tool_name, tool_receipts in receipts.items():
            if tool_name != "state.set_flag" or not isinstance(tool_receipts, dict):
                raise ToolError(
                    "state_corrupt",
                    f"save/flags.json has invalid receipts for {tool_name}",
                )
            for decision_id, receipt in tool_receipts.items():
                if (
                    not _stored_toolbox_receipt_valid(receipt)
                    or receipt.get("tool") != tool_name
                    or str(receipt.get("decision_id") or "") != str(decision_id)
                ):
                    raise ToolError(
                        "state_corrupt",
                        f"save/flags.json has an invalid current receipt for {tool_name}",
                    )
        for flag_id, head in (data.get("flag_heads") or {}).items():
            if not coc_flag_state.valid_entity_head(
                head, entity_kind="flag", entity_id=str(flag_id)
            ):
                raise ToolError(
                    "state_corrupt",
                    f"save/flags.json has an invalid live head for flag '{flag_id}'",
                )
        director_receipts = data[coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY]
        if not coc_flag_state.valid_director_flag_receipt_map(director_receipts):
            raise ToolError(
                "state_corrupt",
                "save/flags.json has an invalid director flag receipt map",
            )
        return data

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

    def prepare_roll(self, record: dict[str, Any]) -> dict[str, Any]:
        """Freeze one canonical roll row without materializing it yet.

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
        return canonical

    def log_roll(self, record: dict[str, Any]) -> dict[str, Any]:
        """Append one canonical roll while retaining legacy flat fields."""
        canonical = self.prepare_roll(record)
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

    def inv_state(
        self,
        investigator_id: str,
        *,
        character_snapshot: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        path = self.inv_state_path(investigator_id)
        if not path.is_file():
            coc_state.seed_investigator_state_if_missing(
                self.root,
                self.campaign_id,
                investigator_id,
                sheet=(
                    character_snapshot
                    if character_snapshot is not None
                    else self.sheet(investigator_id)
                ),
            )
        return json.loads(path.read_text(encoding="utf-8"))

    def save_inv_state(self, investigator_id: str, state: dict[str, Any]) -> None:
        coc_state.write_json_atomic(self.inv_state_path(investigator_id), state)

    def campaign_mechanics(self) -> dict[str, Any]:
        path = self.campaign_dir / "save" / "campaign-mechanics.json"
        if not path.is_file():
            return {"schema_version": 1, "items": {}}
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ToolError(
                "state_corrupt", "save/campaign-mechanics.json is unreadable",
            ) from exc
        if (
            not isinstance(document, dict)
            or document.get("schema_version") != 1
            or not isinstance(document.get("items"), dict)
        ):
            raise ToolError(
                "state_corrupt",
                "save/campaign-mechanics.json does not match schema version 1",
            )
        return document

    def save_campaign_mechanics(self, document: dict[str, Any]) -> None:
        coc_state.write_json_atomic(
            self.campaign_dir / "save" / "campaign-mechanics.json", document,
        )

    # -- idempotency ledger ---------------------------------------------------

    def _ledger_path(self) -> Path:
        return self.campaign_dir / "save" / "toolbox-ledger.json"

    @staticmethod
    def _ledger_key(tool: str, decision_id: str) -> str:
        return json.dumps([str(tool), str(decision_id)], ensure_ascii=False, separators=(",", ":"))

    def _load_ledger(self) -> dict[str, Any]:
        path = self._ledger_path()
        if not path.is_file():
            return {"schema_version": _LEDGER_SCHEMA_VERSION, "entries": {}}
        try:
            ledger = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError, UnicodeError) as exc:
            raise ToolError(
                "state_corrupt",
                "save/toolbox-ledger.json is unreadable; refusing to replace it",
            ) from exc
        if (
            not isinstance(ledger, dict)
            or set(ledger) != set(_LEDGER_FIELDS)
            or ledger.get("schema_version") != _LEDGER_SCHEMA_VERSION
            or not isinstance(ledger.get("entries"), dict)
        ):
            raise ToolError(
                "state_corrupt",
                "save/toolbox-ledger.json does not match the current schema",
            )
        for key, entry in ledger["entries"].items():
            if not isinstance(entry, dict):
                raise ToolError("state_corrupt", "toolbox ledger entry is invalid")
            entry_schema = entry.get("entry_schema_version")
            expected_fields = (
                _LEDGER_ENTRY_V2_FIELDS
                if entry_schema == 2
                else _LEDGER_ENTRY_V3_FIELDS
                if entry_schema == 3
                else None
            )
            tool_name = entry.get("tool")
            decision_id = entry.get("decision_id")
            if (
                expected_fields is None
                or set(entry) != set(expected_fields)
                or not isinstance(tool_name, str)
                or not tool_name
                or not isinstance(decision_id, str)
                or not decision_id
                or not isinstance(entry.get("ts"), str)
                or not entry["ts"]
                or str(key) != self._ledger_key(tool_name, decision_id)
                or (
                    entry_schema == 3
                    and entry.get("source_receipt_required") is not True
                )
            ):
                raise ToolError(
                    "state_corrupt",
                    "toolbox ledger entry does not match its current composite key schema",
                )
            if entry_schema == 3:
                _ledger_requires_source_receipt(entry)
        return ledger

    def ledger_lookup(self, tool: str, decision_id: str | None) -> dict[str, Any] | None:
        if not decision_id:
            return None
        path = self._ledger_path()
        if not path.is_file():
            return None
        ledger = self._load_ledger()
        entries = ledger["entries"]
        entry = entries.get(self._ledger_key(tool, str(decision_id)))
        if entry is not None:
            return entry
        return None

    def ledger_record(
        self,
        decision_id: str | None,
        tool: str,
        data: Any,
        *,
        source_receipt_manifest: dict[str, Any] | None = None,
    ) -> None:
        if not decision_id:
            return
        path = self._ledger_path()
        ledger = self._load_ledger()
        entries = ledger["entries"]
        entry = {
            "entry_schema_version": 3 if source_receipt_manifest is not None else 2,
            "tool": tool,
            "decision_id": str(decision_id),
            "ts": _now_iso(),
            "data": data,
        }
        if source_receipt_manifest is not None:
            entry["source_receipt_required"] = True
            entry["source_receipt_manifest"] = deepcopy(
                source_receipt_manifest
            )
        entries[self._ledger_key(tool, str(decision_id))] = entry
        if len(entries) > _LEDGER_MAX_ENTRIES:
            ordered = sorted(entries.items(), key=lambda kv: str(kv[1].get("ts", "")))
            for key, _ in ordered[: len(entries) - _LEDGER_MAX_ENTRIES]:
                entries.pop(key, None)
        coc_state.write_json_atomic(path, ledger)


def _rng(args: dict[str, Any]) -> random.Random:
    seed = args.get("seed")
    return random.Random(seed) if seed is not None else random.Random()


def _rules_resolver(ctx: Ctx, capability: str | None = None):
    """Resolver of the ruleset bound to the active campaign (contract §4).

    Phase 1 seam 2: ``rules.*`` handlers obtain every ruleset behavior
    (dice, checks, SAN/damage arithmetic, lookups, healing-chain requests)
    through this one registry lookup instead of importing
    ``coc_rules``/``coc_roll``/``coc_sanity`` directly. Campaign-less tools
    resolve the default ruleset. Direct module imports that remain below are
    kernel receipt-integrity validation (dice evidence re-derivation) or
    non-``rules.*`` subsystem code (combat profile, npc.reaction).
    """
    campaign = None
    if ctx.campaign_dir is not None:
        campaign = coc_state.load_campaign_state(ctx.campaign_dir)
    resolver = coc_rulesets.get_resolver(campaign)
    if capability is None:
        return resolver
    try:
        advertised = resolver.public_api_index()
    except Exception as exc:
        raise ToolError(
            "invalid_ruleset",
            "active ruleset public_api_index failed",
        ) from exc
    if isinstance(advertised, dict):
        supported = capability in advertised
    elif isinstance(advertised, (list, tuple, set, frozenset)):
        supported = capability in {
            value for value in advertised if isinstance(value, str)
        }
    else:
        raise ToolError(
            "invalid_ruleset",
            "active ruleset public_api_index must be an object or string list",
        )
    if not supported or not callable(getattr(resolver, capability, None)):
        ruleset_id = coc_rulesets.get_campaign_ruleset_id(campaign)
        raise ToolError(
            "unsupported_ruleset_operation",
            f"ruleset {ruleset_id!r} does not support {capability!r}",
        )
    return resolver


def _active_ruleset_id(ctx: Ctx) -> str:
    campaign = (
        coc_state.load_campaign_state(ctx.campaign_dir)
        if ctx.campaign_dir is not None
        else None
    )
    return coc_rulesets.get_campaign_ruleset_id(campaign)


_RULE_TOOL_CAPABILITIES = {
    "rules.check": "check",
    "rules.resource_delta": "resource_delta",
    "rules.skill_describe": "skill_describe",
    "rules.cash_assets": "cash_assets",
    "rules.build_scale": "build_scale",
    "rules.roll": "check",
    "rules.push": "push_policy",
    "rules.roll_dice": "roll_dice",
    "rules.opposed": "opposed",
    "rules.sanity_check": "sanity_check",
    "rules.damage": "damage",
    "rules.luck_spend": "luck_spend",
    "rules.first_aid": "first_aid",
    "rules.medicine": "medicine",
    "rules.weekly_recovery": "weekly_recovery",
    "rules.dying_check": "dying_check",
}

_RULE_TOOL_RESOURCE_REQUIREMENTS = {
    "rules.sanity_check": frozenset({"san"}),
    "rules.damage": frozenset({"hp"}),
    "rules.luck_spend": frozenset({"luck"}),
    "rules.first_aid": frozenset({"hp"}),
    "rules.medicine": frozenset({"hp"}),
    "rules.weekly_recovery": frozenset({"hp"}),
    "rules.dying_check": frozenset({"hp"}),
}


# --------------------------------------------------------------------------- #
# Registry
# --------------------------------------------------------------------------- #

TOOLS: dict[str, dict[str, Any]] = {}


def _working_set_domain_paths(
    ctx: Ctx, domains: tuple[str, ...]
) -> dict[str, tuple[Path, ...]]:
    campaign = ctx.campaign_dir
    save = campaign / "save"
    scenario = campaign / "scenario"
    known: dict[str, tuple[Path, ...]] = {
        "scene": (scenario / "story-graph.json",),
        "world": (save / "world-state.json",),
        "pacing": (save / "pacing-state.json", save / "active-scene.json"),
        "clues": (scenario / "clue-graph.json",),
        "npc": (
            scenario / "npc-agendas.json",
            scenario / "module-meta.json",
            save / "npc-state.json",
            save / coc_first_impression.FILENAME,
        ),
        "npc_presence": (
            scenario / "story-graph.json",
            save / "world-state.json",
            save / "npc-state.json",
            save / coc_first_impression.FILENAME,
        ),
        "time": (save / "time-state.json", save / "time-markers.json"),
        "active_effects": (save / coc_exceptional_effects.FILENAME,),
        "attempts": (save / "roll-operation-receipts.json",),
        "flags": (save / "flags.json",),
        # The compiled archive is a rebuildable read model, but scene.context
        # consumes it directly.  Its atomic manifest/status pair must therefore
        # participate in query-cache invalidation even when canonical scenario
        # IR and live campaign state are unchanged (for example after a
        # compiler-contract upgrade followed by writer-side republish).
        "module_archive": (
            save / coc_compiled_archive.ARCHIVE_DIRNAME / coc_compiled_archive.MANIFEST_NAME,
            save / coc_compiled_archive.ARCHIVE_DIRNAME / coc_compiled_archive.STATUS_NAME,
        ),
        "mechanics": (
            scenario / "module-meta.json",
            scenario / "npc-agendas.json",
            save / "npc-state.json",
            save / "campaign-mechanics.json",
        ),
    }
    party_paths: list[Path] = [campaign / "party.json"]
    for investigator_id in ctx.party_ids():
        party_paths.extend((
            ctx.coc_root / "investigators" / investigator_id / "character.json",
            save / "investigator-state" / f"{investigator_id}.json",
            save / "sanity-state" / f"{investigator_id}.json",
        ))
    known["party"] = tuple(party_paths)
    asset_root_id = (
        coc_module_project.campaign_asset_root_id(campaign)
        if campaign is not None else None
    )
    if asset_root_id:
        module_root = coc_module_project.coc_module_assets.assets_root(ctx.root) / asset_root_id
        known["module_progressive"] = (
            module_root / "parse-queue.json",
            *tuple(sorted((module_root / "host-work").glob("*.json"))),
        )
    return {
        domain: known[domain]
        for domain in domains
        if domain in known
    }


_CONTINUATION_DOMAINS = (
    "scene", "world", "pacing", "clues", "npc", "npc_presence", "time",
    "active_effects", "attempts", "flags", "party", "module_progressive",
)
_SESSION_RESUME_DATA_MAX_BYTES = 40 * 1024


def _wire_bytes(value: Any) -> int:
    return len(json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8"))


def _bound_session_resume_data(data: dict[str, Any]) -> dict[str, Any]:
    """Keep the recovery working set inside one explicit wire budget.

    Canonical sources remain untouched.  Oversized inline projections degrade
    to hash-bound refs and exact typed read cards, never guessed summaries.
    """
    bounded = deepcopy(data)
    reductions: list[str] = []

    def over() -> bool:
        return _wire_bytes(bounded) > _SESSION_RESUME_DATA_MAX_BYTES

    host_input = bounded.get("host_input")
    if over() and isinstance(host_input, dict) and isinstance(
        host_input.get("text"), str
    ):
        host_input["text_ref"] = (
            ".coc/runtime/host-sessions/"
            + str(((bounded.get("host_context") or {}).get("before_resume") or {}).get(
                "session_id"
            ) or "current")
        )
        host_input["text"] = None
        reductions.append("host_input_text_to_ref")

    delivery = bounded.get("delivery")
    if over() and isinstance(delivery, dict) and isinstance(
        delivery.get("exact_text"), str
    ):
        exact = delivery["exact_text"]
        delivery["exact_text_bytes"] = len(exact.encode("utf-8"))
        delivery["exact_text"] = None
        delivery["replay_operation"] = {
            "operation": "session.delivery_text",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {
                "finalization_id": delivery.get("finalization_id"),
                "rendered_sha256": delivery.get("rendered_sha256"),
            },
            "missing_arguments": [],
        }
        reductions.append("delivery_text_to_typed_read")

    current_turn = bounded.get("current_turn")
    if over() and isinstance(current_turn, dict):
        for row in current_turn.get("rows") or []:
            if not over():
                break
            if isinstance(row, dict) and "data" in row:
                payload = row.pop("data")
                row["data_ref"] = row.get("data_ref") or (
                    "logs/toolbox-calls.jsonl#call-"
                    + str(row.get("call_index") or "unknown")
                )
                row["data_digest"] = hashlib.sha256(json.dumps(
                    payload,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                    default=str,
                ).encode("utf-8")).hexdigest()
                row["data_bytes"] = _wire_bytes(payload)
        reductions.append("current_turn_rows_to_refs")

    if over() and isinstance(bounded.get("scene_context"), dict):
        scene = bounded["scene_context"]
        bounded["scene_context"] = {
            key: deepcopy(scene.get(key))
            for key in (
                "campaign_id", "active_scene_id", "scene", "npcs_present",
                "exits", "party", "party_investigators", "time",
                "tension_level", "turn_number", "action_routes",
                "operation_opportunities", "progressive", "drilldown_refs",
            )
            if key in scene
        }
        bounded["scene_context"]["full_projection_operation"] = {
            "operation": "scene.context",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {},
            "missing_arguments": [],
        }
        reductions.append("scene_context_to_core_projection")

    capsule = bounded.get("semantic_capsule")
    if over() and isinstance(capsule, dict):
        summaries = capsule.get("recent_summaries")
        if isinstance(summaries, list) and len(summaries) > 2:
            capsule["recent_summaries"] = summaries[-2:]
            capsule["older_summary_count"] = len(summaries) - 2
            reductions.append("older_semantic_summaries_to_count")

    if over() and bounded.get("pending_output_context") is not None:
        bounded["pending_output_context"] = {
            "projection_ref": "turn.output_context",
            "operation": {
                "operation": "turn.output_context",
                "invoke_via": "coc_invoke",
                "prefilled_arguments": {},
                "missing_arguments": [],
            },
        }
        reductions.append("pending_output_context_to_typed_read")

    if over() and isinstance(bounded.get("scene_context"), dict):
        scene = bounded["scene_context"]
        bounded["scene_context"] = {
            key: deepcopy(scene.get(key))
            for key in (
                "campaign_id", "active_scene_id", "scene", "party", "time",
                "operation_opportunities", "progressive",
                "full_projection_operation",
            )
            if key in scene
        }
        reductions.append("scene_context_to_minimal_ref")

    if over() and isinstance(current_turn, dict):
        current_turn["rows"] = [
            {
                "call_index": row.get("call_index"),
                "tool": row.get("tool"),
                "ok": row.get("ok"),
                "row_ref": row.get("row_ref") or row.get("data_ref"),
                "row_digest": row.get("row_digest") or row.get("data_digest"),
            }
            for row in current_turn.get("rows") or []
            if isinstance(row, dict)
        ]
        reductions.append("current_turn_to_receipt_refs")

    measured = _wire_bytes(bounded)
    if measured > _SESSION_RESUME_DATA_MAX_BYTES:
        raise ToolError(
            "resume_budget_exceeded",
            "bounded recovery identities still exceed the fixed resume budget; "
            "preserve canonical refs and inspect the cited typed projection",
        )
    bounded["resume_budget"] = {
        "schema_version": 1,
        "max_data_bytes": _SESSION_RESUME_DATA_MAX_BYTES,
        "measured_data_bytes": measured,
        "reductions": reductions,
        "canonical_sources_unchanged": True,
    }
    # Account for the budget metadata itself.
    bounded["resume_budget"]["measured_data_bytes"] = _wire_bytes(bounded)
    if bounded["resume_budget"]["measured_data_bytes"] > _SESSION_RESUME_DATA_MAX_BYTES:
        raise ToolError(
            "resume_budget_exceeded",
            "resume budget metadata exceeded the fixed recovery budget",
        )
    return bounded


def _continuation_revision(ctx: Ctx) -> tuple[dict[str, int], str]:
    return coc_working_set_cache.revision_vector(
        ctx.campaign_dir,
        _working_set_domain_paths(ctx, _CONTINUATION_DOMAINS),
    )


def _recover_compiled_archive_for_resume(
    campaign_dir: Path,
) -> tuple[dict[str, Any], list[str]]:
    """Publish a missing/stale rebuildable archive at lifecycle recovery.

    ``session.resume`` already repairs continuation caches.  Doing the same
    once-per-context maintenance for the compiled archive keeps ordinary turns
    on typed scene/entity projections instead of inviting host file scans.
    Canonical scenario IR is never modified.
    """
    loaded = coc_compiled_archive.load_published(campaign_dir)
    if loaded.get("ok"):
        return {
            "status": "reused",
            "archive_revision": loaded.get("archive_revision"),
            "canonical_sources_unchanged": True,
        }, []
    published = coc_compiled_archive.publish_from_campaign(campaign_dir)
    if published.get("ok"):
        return {
            "status": "published",
            "reason": loaded.get("code") or "archive_unavailable",
            "archive_revision": published.get("archive_revision"),
            "canonical_sources_unchanged": True,
        }, []
    return {
        "status": "fallback",
        "reason": loaded.get("code") or "archive_unavailable",
        "archive_revision": None,
        "canonical_sources_unchanged": True,
    }, [
        "compiled archive lifecycle maintenance failed; scene.context will use "
        "canonical IR fallback, but hosts must still use typed operations rather "
        "than reading module files: "
        + str(published.get("error") or loaded.get("error") or "unknown error")
    ]


def _query_cache_contract(spec: dict[str, Any]) -> dict[str, Any]:
    try:
        stat = (_HERE / "coc_toolbox.py").stat()
        source_identity = {"mtime_ns": stat.st_mtime_ns, "size": stat.st_size}
    except OSError:
        source_identity = {"mtime_ns": None, "size": None}
    return {
        "tool": spec["name"],
        "params": spec["params"],
        "read_domains": list(spec.get("read_domains") or ()),
        "response_mode": spec.get("response_mode", "full"),
        "source_identity": source_identity,
    }


def tool(
    name: str,
    summary: str,
    params: dict[str, dict[str, Any]],
    *,
    needs_campaign: bool = True,
    access: str = "mutation",
    read_domains: tuple[str, ...] = (),
    write_domains: tuple[str, ...] = (),
    recovery_domains: tuple[str, ...] | None = None,
    response_mode: str = "full",
    audit_mode: str = "full",
    strict_read_only: bool = False,
):
    if access not in {"query", "mutation"}:
        raise ValueError(f"invalid tool access mode: {access}")
    if strict_read_only and not (
        access == "query"
        and not write_domains
        and recovery_domains == ()
        and response_mode == "full"
        and audit_mode == "reference"
    ):
        raise ValueError(
            "strict_read_only requires query access, empty write/recovery "
            "domains, full response mode, and reference audit mode"
        )
    def deco(fn: Callable[[Ctx, dict[str, Any]], tuple[Any, list[str], list[str]]]):
        TOOLS[name] = {
            "name": name,
            "summary": summary,
            "params": params,
            "needs_campaign": needs_campaign,
            "access": access,
            "read_domains": tuple(read_domains),
            "write_domains": tuple(write_domains),
            "recovery_domains": (
                None if recovery_domains is None else tuple(recovery_domains)
            ),
            "response_mode": response_mode,
            "audit_mode": audit_mode,
            "strict_read_only": bool(strict_read_only),
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
) -> int | None:
    """Append a tool-call receipt for runtime event projection (best effort)."""
    if ctx is None or ctx.campaign_dir is None:
        return None
    record = {
        "schema_version": 2,
        "ts": _now_iso(),
        "tool": name,
        "ok": bool(envelope.get("ok")),
        "args": {k: v for k, v in args.items() if k != "seed"},
        # This is Keeper-internal audit evidence.  It deliberately preserves
        # structured tool results so a later JSON battle report can prove what
        # the KP observed before deciding what to use.  It is never a
        # player-facing narration source.
        "data": deepcopy(envelope.get("data")),
        "visibility": "keeper_internal",
        "warnings": envelope.get("warnings") or [],
        "hints": envelope.get("hints") or [],
        "attempt": attempt,
        "max_attempts": max_attempts,
        "retryable": bool(envelope.get("retryable")),
        "will_retry": bool(will_retry),
    }
    if isinstance(envelope.get("cache"), dict):
        record["cache"] = deepcopy(envelope["cache"])
    if envelope.get("idempotent_replay") is True:
        # A pending-turn exact replay is operational evidence, not a new
        # settlement.  Preserve that distinction so the bounded manifest can
        # ignore this row without weakening its post-journal mutation gate.
        record["idempotent_replay"] = True
    spec = TOOLS.get(name) or {}
    if (
        envelope.get("ok") is True
        and spec.get("audit_mode") == "reference"
        and isinstance(envelope.get("data"), dict)
    ):
        working_set = envelope["data"].get("working_set")
        cache = envelope.get("cache") if isinstance(envelope.get("cache"), dict) else {}
        record["data"] = {
            "projection_ref": cache.get("ref"),
            "result_digest": _canonical_digest(envelope["data"]),
            "working_set": deepcopy(working_set),
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
        pacing = ctx.pacing()
        record["turn_number"] = pacing.get("turn_number")
    except (OSError, ValueError, TypeError):
        record["turn_number"] = None
    try:
        log_path = ctx.campaign_dir / "logs" / "toolbox-calls.jsonl"
        coc_state.append_jsonl(log_path, record)
        return log_path.stat().st_size
    except OSError:
        return None


def _error_recovery_hints(code: str) -> list[str]:
    hints = {
        "unknown_npc": [
            "call npc.query without npc_id to inspect authored and campaign-local ids; unknown means no authored agenda, first-impression receipt, persona card, or live psych state currently owns that exact id"
        ],
        "unknown_skill": [
            "inspect the investigator sheet or pass an explicit target; canonical rulebook base chances are used automatically when available"
        ],
        "invalid_param": [
            "call describe for the tool schema, then retry with corrected structured arguments"
        ],
        "invalid_source_worker_pack": [
            "reject this child result unchanged; the parent must not repair or rewrite the pack, call describe/discover, retry fulfillment, or poll the same task again; leave the request unfulfilled for existing lease recovery"
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
        "context_rehydration_required": [
            "call session.resume for this campaign before any other campaign operation; use its bounded recovery bundle instead of rereading saves or rediscovering the full tool catalog"
        ],
        "context_epoch_conflict": [
            "the host compacted again while recovery was being built; call session.resume once more and use only the newest bundle"
        ],
        "delivery_conflict": [
            "acknowledge only the latest exact rendered_sha256 returned by session.resume; never regenerate or silently replace finalized text"
        ],
    }
    return list(hints.get(code, ["the keeper may continue with a different in-fiction approach or corrected tool arguments"]))


def run_tool(name: str, root: Path, campaign_id: str | None, args: dict[str, Any]) -> dict[str, Any]:
    """Programmatic entry point. Returns the envelope dict."""
    spec = TOOLS.get(name)
    if spec is None:
        return {"ok": False, "tool": name, "error": {"code": "unknown_tool", "message": f"unknown tool: {name}"}}
    def failure(
        code: str, message: str, *, details: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        envelope = {
            "ok": False,
            "tool": name,
            "error": {"code": code, "message": message},
            "hints": _error_recovery_hints(code),
        }
        if isinstance(details, dict):
            envelope["error"]["details"] = deepcopy(details)
        return envelope

    def execute_transaction(ctx: Ctx) -> dict[str, Any]:
        try:
            rules_capability = _RULE_TOOL_CAPABILITIES.get(name)
            if rules_capability is not None:
                _rules_resolver(ctx, rules_capability)
                required_resources = _RULE_TOOL_RESOURCE_REQUIREMENTS.get(name)
                if required_resources:
                    ruleset_id = _active_ruleset_id(ctx)
                    declared_resources = {
                        str(resource.get("key"))
                        for resource in coc_rulesets.ruleset_resources(ruleset_id)
                        if isinstance(resource.get("key"), str)
                    }
                    missing_resources = sorted(
                        required_resources - declared_resources
                    )
                    if missing_resources:
                        raise ToolError(
                            "unsupported_ruleset_operation",
                            f"ruleset {ruleset_id!r} lacks resources required by {name}: "
                            + ", ".join(missing_resources),
                        )
            pending_turn_manifest = None
            pending_exact_replay = None
            context_rehydration_advisory = None
            if spec["needs_campaign"] and ctx.campaign_dir is not None:
                host_marker = coc_host_context.current_marker(ctx.root)
                if name != "session.resume" and host_marker is not None and (
                    host_marker.get("requires_resume") is True
                    or host_marker.get("acknowledged_campaign_id")
                    not in {None, ctx.campaign_id}
                ):
                    context_rehydration_advisory = {
                        "code": "context_rehydration_recommended",
                        "campaign_id": ctx.campaign_id,
                        "host_session_id": host_marker.get("session_id"),
                        "context_epoch": host_marker.get("context_epoch"),
                        "next_operation": "session.resume",
                        "authority": "advisory",
                        "hard_gate": False,
                    }
                pending_turn_manifest = coc_turn_manifest.pending_manifest(
                    ctx.campaign_dir
                )
            if (
                pending_turn_manifest is not None
                and spec.get("access", "mutation") != "query"
            ):
                if (
                    name not in {
                        "turn.finalize", "state.exceptional_effect", "state.journal",
                    }
                ):
                    # The journal boundary forbids every new mutation.  The
                    # sole exception is a read-only proof that this exact NPC
                    # operation was fully recovered before state.journal and
                    # therefore has nothing left to write.  A missing source,
                    # ledger, event, or exact payload match remains blocked.
                    if name == "state.record_npc_engagement":
                        pending_exact_replay = (
                            _pending_npc_engagement_exact_replay(ctx, args)
                        )
                    if pending_exact_replay is None:
                        raise ToolError(
                            "turn_pending_finalization",
                            "state.journal already committed for this turn; finalize it "
                            "before any further state mutation",
                        )
            if (
                spec["needs_campaign"]
                and ctx.campaign_dir is not None
                and pending_turn_manifest is None
                and name != "session.resume"
                and name != "rules.luck_spend"
                and (
                    spec.get("access", "mutation") != "query"
                    or bool(spec.get("recovery_domains"))
                )
            ):
                reconcile_campaign_continuity(
                    ctx.campaign_dir,
                    ctx=ctx,
                    domains=spec.get("recovery_domains"),
                )
            cache_metadata = None
            cacheable = (
                spec.get("access") == "query"
                and spec.get("response_mode") == "full_or_not_modified"
                and ctx.campaign_dir is not None
            )
            if pending_exact_replay is not None:
                data, warnings, hints = pending_exact_replay
            elif cacheable:
                domain_paths = _working_set_domain_paths(
                    ctx, tuple(spec.get("read_domains") or ())
                )
                revision_vector, _domain_revision_token = (
                    coc_working_set_cache.revision_vector(
                        ctx.campaign_dir, domain_paths
                    )
                )
                cache_key, args_digest = coc_working_set_cache.cache_identity(
                    campaign_id=str(ctx.campaign_id),
                    tool=name,
                    args=args,
                    revision_vector=revision_vector,
                    contract_identity=_query_cache_contract(spec),
                )
                # The public token binds both state and exact argument scope;
                # a revision from a different filter must never produce a
                # false not_modified response.
                revision_token = f"ws-v1-{cache_key[:24]}"
                if args.get("since_revision") == revision_token:
                    data = {
                        "working_set": {
                            "mode": "not_modified",
                            "revision": revision_token,
                            "read_domains": revision_vector,
                        }
                    }
                    warnings, hints = [], [
                        "reuse the prior full projection for this exact tool and argument scope"
                    ]
                    cache_metadata = {
                        "status": "not_modified",
                        "revision": revision_token,
                        "key": cache_key,
                    }
                else:
                    cached = coc_working_set_cache.load(
                        ctx.campaign_dir,
                        tool=name,
                        cache_key=cache_key,
                        revision_token=revision_token,
                        revision_vector=revision_vector,
                        args_digest=args_digest,
                    )
                    if cached is None:
                        data, warnings, hints = spec["handler"](ctx, args)
                        cache_ref = coc_working_set_cache.store(
                            ctx.campaign_dir,
                            tool=name,
                            cache_key=cache_key,
                            revision_token=revision_token,
                            revision_vector=revision_vector,
                            args_digest=args_digest,
                            data=data,
                            warnings=warnings,
                            hints=hints,
                        )
                        cache_status = "miss"
                    else:
                        data, warnings, hints = cached
                        cache_ref = coc_working_set_cache.cache_ref(
                            ctx.campaign_dir,
                            tool=name,
                            cache_key=cache_key,
                        )
                        cache_status = "hit"
                    if isinstance(data, dict):
                        data = deepcopy(data)
                        data["working_set"] = {
                            "mode": "full",
                            "revision": revision_token,
                            "read_domains": revision_vector,
                        }
                    cache_metadata = {
                        "status": cache_status,
                        "revision": revision_token,
                        "key": cache_key,
                        "ref": cache_ref,
                    }
            else:
                data, warnings, hints = spec["handler"](ctx, args)
            envelope = {
                "ok": True,
                "tool": name,
                "data": data,
                "warnings": warnings,
                "hints": hints,
            }
            if cache_metadata is not None:
                envelope["cache"] = cache_metadata
            if pending_exact_replay is not None:
                envelope["idempotent_replay"] = True
            if context_rehydration_advisory is not None:
                envelope.setdefault("warnings", []).append(
                    "The current host context has not acknowledged its latest "
                    "recovery epoch; continuing is allowed, but session.resume "
                    "is recommended before relying on remembered scene state."
                )
                envelope.setdefault("hints", []).append(
                    "call session.resume once for this context epoch, then reuse "
                    "the returned bounded working set instead of resuming every turn"
                )
                envelope["context_rehydration"] = context_rehydration_advisory
        except ToolError as exc:
            error = {"code": exc.code, "message": exc.message}
            if exc.violations:
                error["violations"] = exc.violations
            if exc.details is not None:
                error["details"] = deepcopy(exc.details)
            envelope = {
                "ok": False,
                "tool": name,
                "error": error,
            }
        except coc_working_set_cache.WorkingSetCacheError as exc:
            envelope = {
                "ok": False,
                "tool": name,
                "error": {"code": exc.code, "message": str(exc)},
            }
        except (
            coc_continuation.ContinuationError,
            coc_host_context.HostContextError,
            coc_turn_manifest.TurnManifestError,
        ) as exc:
            envelope = {
                "ok": False,
                "tool": name,
                "error": {"code": exc.code, "message": str(exc)},
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
        details = exc.details
        if details is None and name == "progressive.publish_skeleton":
            details = {
                "status": "validation_failed",
                "complete": False,
                "stored": False,
                "projected": False,
            }
        envelope = failure(exc.code, exc.message, details=details)
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
                        if not spec.get("strict_read_only"):
                            coc_turn_manifest.recover_table_opening_boundary(
                                ctx.campaign_dir
                            )
                            coc_runtime_ops.recover_development_transactions(
                                ctx.campaign_dir
                            )
                    except coc_turn_manifest.TurnManifestError as exc:
                        envelope = failure(exc.code, str(exc))
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
        log_end_offset = None
        if ctx is not None and error_code.lower() != "recovery_conflict":
            log_end_offset = _log_tool_call(
                ctx,
                name,
                args,
                envelope,
                attempt=attempt,
                max_attempts=max_attempts,
                recovered_after_retry=recovered,
                will_retry=will_retry,
            )
        if (
            ctx is not None
            and ctx.campaign_dir is not None
            and envelope.get("ok") is True
            and name == "evidence.table_opening"
            and log_end_offset is not None
        ):
            try:
                with coc_fileio.campaign_lock(
                    ctx.campaign_dir,
                    wait_seconds=_TOOL_TRANSACTION_WAIT_SECONDS,
                ):
                    coc_turn_manifest.complete_table_opening_boundary(
                        ctx.campaign_dir,
                        decision_id=str(args.get("decision_id") or ""),
                        run_id=str(args.get("run_id") or ""),
                        completed_end_offset=log_end_offset,
                    )
            except (
                coc_fileio.CampaignLockError,
                coc_turn_manifest.TurnManifestError,
            ) as exc:
                envelope.setdefault("warnings", []).append(
                    "opening evidence is durable, but its pre-turn source boundary will recover on the next mutating campaign call: "
                    + str(exc)
                )
        if (
            ctx is not None
            and ctx.campaign_dir is not None
            and envelope.get("ok") is True
            and name == "turn.finalize"
            and log_end_offset is not None
        ):
            data = envelope.get("data") if isinstance(envelope.get("data"), dict) else {}
            try:
                with coc_fileio.campaign_lock(
                    ctx.campaign_dir,
                    wait_seconds=_TOOL_TRANSACTION_WAIT_SECONDS,
                ):
                    try:
                        repair_finalization_id = str(
                            args.get("repair_finalization_id") or ""
                        ).strip()
                        if repair_finalization_id:
                            coc_turn_manifest.complete_undelivered_output_repair(
                                ctx.campaign_dir,
                                journal_decision_id=str(
                                    data.get("journal_decision_id") or ""
                                ),
                                previous_finalization_id=repair_finalization_id,
                                finalization_id=str(
                                    data.get("finalization_id") or ""
                                ),
                                completed_end_offset=log_end_offset,
                            )
                        else:
                            coc_turn_manifest.complete_pending_turn(
                                ctx.campaign_dir,
                                journal_decision_id=str(
                                    data.get("journal_decision_id") or ""
                                ),
                                finalization_id=str(
                                    data.get("finalization_id") or ""
                                ),
                                completed_end_offset=log_end_offset,
                            )
                    except coc_turn_manifest.TurnManifestError as exc:
                        envelope.setdefault("warnings", []).append(
                            "turn finalization is durable, but the bounded source cursor will recover on the next campaign call: "
                            + str(exc)
                        )
                    try:
                        revision_vector, revision_token = _continuation_revision(ctx)
                        checkpoint = coc_continuation.publish_finalized_checkpoint(
                            ctx.campaign_dir,
                            data,
                            revision_vector=revision_vector,
                            revision_token=revision_token,
                        )
                    except (
                        coc_continuation.ContinuationError,
                        coc_working_set_cache.WorkingSetCacheError,
                    ) as exc:
                        envelope.setdefault("warnings", []).append(
                            "turn finalization is durable, but its rebuildable continuation checkpoint was not published; session.resume will retry from canonical receipts: "
                            + str(exc)
                        )
                    else:
                        envelope["continuation"] = {
                            "checkpoint_id": checkpoint["checkpoint_id"],
                            "turn_number": checkpoint["turn_number"],
                            "content_sha256": checkpoint["content_sha256"],
                        }
            except coc_fileio.CampaignLockError as exc:
                envelope.setdefault("warnings", []).append(
                    "turn finalization is durable, but post-finalization cursor/checkpoint publication will recover on the next campaign call: "
                    + str(exc)
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


def _npc_by_id(npc_agendas: dict[str, Any], npc_id: str) -> dict[str, Any] | None:
    return coc_npc_identity.resolve_authored_npc(npc_agendas, npc_id)


def _npc_identity_contract(
    npc: dict[str, Any],
    active_scene_id: str | None,
) -> dict[str, Any]:
    return coc_npc_identity.identity_contract(npc, active_scene_id)


def _campaign_npc_projection_index(
    ctx: Ctx, npc_state: dict[str, Any]
) -> tuple[set[str], dict[str, str], set[str]]:
    """Index campaign-local NPC ids and their player-safe stable names.

    Both npc.query and scene.context consume this same projection so an
    improvised contact cannot exist in relationship state yet disappear from
    scene grounding merely because the module did not author an agenda row.
    """
    try:
        campaign_id = coc_npc_event_chain.resolve_campaign_id(ctx.campaign_dir)
        impression_document = coc_first_impression.load_document(
            ctx.campaign_dir, campaign_id
        )
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc

    campaign_names: dict[str, str] = {}
    name_conflicts: set[str] = set()
    receipt_npc_ids: set[str] = set()
    for pair in sorted((impression_document.get("receipts") or {})):
        receipt = impression_document["receipts"][pair]
        npc_id = str(receipt.get("npc_id") or "").strip()
        if not npc_id:
            continue
        receipt_npc_ids.add(npc_id)
        display_name = str(receipt.get("npc_display_name") or "").strip()
        if not display_name:
            continue
        prior_name = campaign_names.setdefault(npc_id, display_name)
        if prior_name != display_name:
            name_conflicts.add(npc_id)

    persona_cards = (
        npc_state.get("npcs") if isinstance(npc_state.get("npcs"), dict) else {}
    )
    psych_by_id = (
        npc_state.get("psych") if isinstance(npc_state.get("psych"), dict) else {}
    )
    campaign_npc_ids = {
        str(npc_id).strip()
        for source in (persona_cards, psych_by_id)
        for npc_id in source
        if str(npc_id).strip()
    } | receipt_npc_ids
    for npc_id, card in persona_cards.items():
        if npc_id in campaign_names or not isinstance(card, dict):
            continue
        raw_name = card.get("name")
        if isinstance(raw_name, dict):
            raw_name = raw_name.get("value")
        if not isinstance(raw_name, str):
            raw_name = card.get("display_name")
        name = str(raw_name or "").strip()
        if name:
            campaign_names[str(npc_id)] = name
    return campaign_npc_ids, campaign_names, name_conflicts


# --------------------------------------------------------------------------- #
# Adjudication advisory evidence (warnings/hints only — never blocking)
# --------------------------------------------------------------------------- #

# Structured delivery markers that make a clue roll-gated by module design.
# Free text (clue prose, roll reasons, narration) is never inspected.
_ROLL_GATED_DELIVERY_KINDS = frozenset({"skill_check", "characteristic_check"})
_ROLL_GATED_DISCOVERY_MODES = frozenset({"check", "conditional_check"})


def _clue_is_roll_gated(clue: dict[str, Any]) -> bool:
    """Return True only for explicit check modes or starter check delivery."""
    discovery = clue.get("discovery")
    if isinstance(discovery, dict):
        mode = str(discovery.get("mode") or "")
        return mode in _ROLL_GATED_DISCOVERY_MODES
    return str(clue.get("delivery_kind") or "") in _ROLL_GATED_DELIVERY_KINDS


def _clue_roll_gate_skills(clue: dict[str, Any]) -> list[str]:
    """Structured skill labels the module binds to a roll-gated clue."""
    skills: list[str] = []
    discovery = clue.get("discovery")
    if isinstance(discovery, dict):
        primary = discovery.get("skill")
        if isinstance(primary, str) and primary.strip():
            skills.append(primary.strip())
    primary = clue.get("skill")
    if isinstance(primary, str) and primary.strip():
        label = primary.strip()
        if label.casefold() not in {skill.casefold() for skill in skills}:
            skills.append(label)
    affordance = clue.get("affordance")
    if isinstance(affordance, dict):
        for value in affordance.get("skills") or []:
            if isinstance(value, str) and value.strip():
                label = value.strip()
                if label.casefold() not in {skill.casefold() for skill in skills}:
                    skills.append(label)
    return skills


def _logged_roll_skills(ctx: Ctx) -> set[str] | None:
    """Casefolded skill labels present in logs/rolls.jsonl, or None when the
    log exists but cannot be read (advisory evidence must never accuse the KP
    on the basis of an I/O failure).  Only the structured ``skill`` field of a
    roll row (flat or inside its payload) is consulted; free-text fields such
    as ``reason`` are deliberately ignored."""
    path = ctx.campaign_dir / "logs" / "rolls.jsonl"
    if not path.is_file():
        return set()
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    skills: set[str] = set()
    for line in lines:
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(row, dict):
            continue
        for container in (row, row.get("payload")):
            if not isinstance(container, dict):
                continue
            label = container.get("skill")
            if isinstance(label, str) and label.strip():
                skills.add(label.strip().casefold())
    return skills


def _skill_check_clues_missing_roll_evidence(
    ctx: Ctx, clue_ids: list[str]
) -> list[dict[str, Any]] | None:
    """Roll-gated authored clues among clue_ids with no matching skill roll.

    Evidence is structural only: a clue counts as covered when the roll log
    holds at least one roll whose skill label matches one of the clue's
    authored gate skills.  Returns None when roll evidence is unreadable.
    """
    logged = _logged_roll_skills(ctx)
    if logged is None:
        return None
    missing: list[dict[str, Any]] = []
    for clue_id in clue_ids:
        clue = _clue_by_id(ctx.clue_graph, str(clue_id))
        if clue is None or not _clue_is_roll_gated(clue):
            continue
        gate_skills = _clue_roll_gate_skills(clue)
        if any(skill.casefold() in logged for skill in gate_skills):
            continue
        discovery = clue.get("discovery") if isinstance(clue.get("discovery"), dict) else {}
        missing.append({
            "clue_id": str(clue.get("clue_id")),
            "delivery_kind": clue.get("delivery_kind"),
            "discovery_mode": discovery.get("mode"),
            "gate_skills": gate_skills,
        })
    return missing


def _improvised_npc_engagement_count(ctx: Ctx) -> int | None:
    """Recorded state.record_npc_engagement receipts without an authored
    identity contract (structured improvised-NPC evidence).  None when the
    receipt source is unreadable."""
    try:
        document = coc_npc_event_chain.load_receipt_document(ctx.campaign_dir)
    except ValueError:
        return None
    count = 0
    for receipt in (document.get("receipts") or {}).values():
        if not isinstance(receipt, dict):
            continue
        if receipt.get("producer") != "state.record_npc_engagement":
            continue
        event = receipt.get("event")
        if isinstance(event, dict) and event.get("identity_contract") is None:
            count += 1
    return count


def _adjudication_gap_hints(ctx: Ctx) -> list[str]:
    """Session-level 'expected rolls that never happened' advisory counters."""
    world = ctx.world()
    discovered = [str(c) for c in (world.get("discovered_clue_ids") or [])]
    hints: list[str] = []
    missing = _skill_check_clues_missing_roll_evidence(ctx, discovered)
    if missing is not None:
        detail = f": {', '.join(row['clue_id'] for row in missing)}" if missing else ""
        hints.append(
            f"adjudication diagnostic: {len(missing)} recorded skill_check clue(s) "
            f"lack roll evidence{detail} — review whether each reveal was earned "
            "by a check or was a conscious free reveal"
        )
    improvised = _improvised_npc_engagement_count(ctx)
    if improvised is not None:
        hints.append(
            f"adjudication diagnostic: {improvised} improvised NPC engagement(s) "
            "recorded — the KP adjudicated each one's plausibility against "
            "module truth and established fiction"
        )
    return hints


def _npc_engagement_advisory_hints(
    authored_npc: dict[str, Any] | None, npc_id: str
) -> list[str]:
    """Project authored contact-route constraints and improvisation advice."""
    if authored_npc is None:
        return [
            f"improvised npc '{npc_id}' — the KP adjudicates whether this "
            "person's existence is plausible against module truth and "
            "established fiction"
        ]
    keeper_note = authored_npc.get("keeper_note")
    if isinstance(keeper_note, str) and keeper_note.strip():
        return [
            f"authored npc '{npc_id}' keeper_note: {keeper_note.strip()} — "
            "treat it as binding module advice; a deliberate bypass needs an "
            "earned in-fiction reason"
        ]
    return []


def _first_impression_hint(
    ctx: Ctx, npc_id: str, authored_npc: dict[str, Any] | None
) -> str | None:
    """Advisory pointer for the pair's one public first-impression check."""
    stats: tuple[str, int, int] | None = None
    try:
        investigator_id = _resolve_investigator(ctx, {})
        sheet = ctx.sheet(investigator_id)
        chars = sheet.get("characteristics") or {}
        skills = sheet.get("skills") or {}
        app_raw = chars.get("APP", 50)
        cr_raw = skills.get("Credit Rating", 0)
        stats = (
            investigator_id,
            int(app_raw) if app_raw is not None else 50,
            int(cr_raw) if cr_raw is not None else 0,
        )
    except ToolError:
        stats = None
    if stats is None:
        return (
            f"first impression: call npc.reaction once before the first substantive "
            f"engagement with '{npc_id}'; the APP/Credit Rating D100 is public"
        )
    investigator_id, app, credit_rating = stats
    try:
        campaign_id = coc_npc_event_chain.resolve_campaign_id(ctx.campaign_dir)
        document = coc_first_impression.load_document(ctx.campaign_dir, campaign_id)
        if coc_first_impression.find_by_pair(document, investigator_id, npc_id) is not None:
            return None
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    return (
        f"first impression: call npc.reaction once for {investigator_id}/'{npc_id}' "
        f"before their first substantive engagement; public D100 uses max(APP {app}, "
        f"Credit Rating {credit_rating}) and the KP realizes the result within authored, "
        "relationship, scene, and conduct boundaries"
    )


def _canonical_skill_base(skill: Any) -> tuple[str, int] | None:
    """Return an authored rulebook base chance for a known skill when numeric."""
    global _SKILL_BASES_CACHE
    if _SKILL_BASES_CACHE is None:
        _SKILL_BASES_CACHE = {}
        path = (
            coc_rulesets.ruleset_data_dir(coc_rulesets.DEFAULT_RULESET_ID)
            / "skills.json"
        )
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
        return int(clock.get("current_segments", 0)) >= int(threshold)

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


def _npc_receipt_path(ctx: Ctx) -> Path:
    return ctx.campaign_dir / "save" / coc_npc_event_chain.RECEIPT_FILENAME


def _save_npc_receipt_document(ctx: Ctx, document: dict[str, Any]) -> None:
    coc_state.write_json_atomic(_npc_receipt_path(ctx), document)


def _npc_receipts_for_decision(
    document: dict[str, Any], *, producer: str, decision_id: str
) -> list[dict[str, Any]]:
    receipts = document.get("receipts")
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "NPC engagement receipt map is invalid")
    found = [
        receipt
        for receipt in receipts.values()
        if isinstance(receipt, dict)
        and receipt.get("producer") == producer
        and receipt.get("decision_id") == decision_id
    ]
    if any(not coc_npc_event_chain.valid_receipt(receipt) for receipt in found):
        raise ToolError("state_corrupt", "NPC engagement source receipt is invalid")
    return sorted(found, key=lambda receipt: int(receipt["ordinal"]))


def _npc_receipt_warnings(receipt: dict[str, Any]) -> list[str]:
    """Rebuild the original advisory warnings from immutable receipt data."""
    event = receipt.get("event") or {}
    operation = receipt.get("operation") or {}
    npc_id = str(event.get("npc_id") or "")
    requested_npc_id = str(operation.get("npc_id") or "")
    identity_contract = event.get("identity_contract")
    identity_binding = event.get("identity_binding") or {}
    binding_status = str(identity_binding.get("status") or "")
    binding_reasons = list(identity_binding.get("reasons") or [])
    warnings: list[str] = []
    if not isinstance(identity_contract, dict):
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
    if requested_npc_id and requested_npc_id != npc_id:
        warnings.append(
            f"resolved NPC alias '{requested_npc_id}' to authored id '{npc_id}'"
        )
    requested_kind = str(operation.get("interaction_kind") or "")
    if event.get("interaction_label") is not None:
        warnings.append(
            f"unrecognized interaction_kind '{requested_kind}' was preserved as interaction_label and normalized to 'other'"
        )
    return warnings


def _materialize_stable_receipt_event(
    ctx: Ctx,
    *,
    event: dict[str, Any],
    event_id: str,
    relative_path: str = "logs/events.jsonl",
    inspect_pending: bool = True,
) -> bool:
    """Materialize a receipt-owned stable row in the recorder lock domain."""
    try:
        with coc_async_recorder.recorder_lock(ctx.campaign_dir):
            if inspect_pending:
                pending = _pending_jsonl_rows(ctx, relative_path, event_id)
            else:
                pending = []
            if any(row != event for row in pending) or len(pending) > 1:
                raise ToolError(
                    "state_corrupt",
                    f"pending stable event '{event_id}' conflicts with its source receipt",
                )
            target = ctx.campaign_dir / relative_path
            append_record = None
            if relative_path == "logs/events.jsonl":
                append_record = lambda _path, row: ctx.log_event(deepcopy(row))
            return coc_async_recorder.ensure_stable_jsonl_record_locked(
                target,
                deepcopy(event),
                append_record=append_record,
            )
    except coc_async_recorder.RecorderLockError as exc:
        raise ToolError("campaign_busy", str(exc)) from exc
    except coc_async_recorder.StableRecordError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc


def _ensure_npc_receipt_event(ctx: Ctx, receipt: dict[str, Any]) -> bool:
    if not coc_npc_event_chain.valid_receipt(receipt):
        raise ToolError("state_corrupt", "NPC engagement source receipt is invalid")
    return _materialize_stable_receipt_event(
        ctx,
        event=receipt["event"],
        event_id=str(receipt["event_id"]),
    )


def _reconcile_all_npc_source_receipts(ctx: Ctx) -> dict[str, Any]:
    try:
        document = coc_npc_event_chain.load_receipt_document(ctx.campaign_dir)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    receipts = document.get("receipts") or {}
    ordered = sorted(
        receipts.values(),
        key=lambda receipt: (
            str(receipt.get("run_id") or ""),
            str(receipt.get("decision_id") or ""),
            int(receipt.get("ordinal") or 0),
            str(receipt.get("event_id") or ""),
        ),
    )
    for receipt in ordered:
        if not coc_npc_event_chain.valid_receipt(receipt):
            raise ToolError("state_corrupt", "NPC engagement source receipt is invalid")
        _ensure_npc_receipt_event(ctx, receipt)
        if receipt.get("producer") == "director_apply.npc_move":
            secondary = (
                "logs/npc-engagement.jsonl"
                if receipt.get("event_type") == "npc_engagement"
                else "logs/npc-agency.jsonl"
            )
            _materialize_stable_receipt_event(
                ctx,
                event=receipt["event"],
                event_id=str(receipt["event_id"]),
                relative_path=secondary,
            )
        if receipt.get("producer") == "state.record_npc_engagement":
            decision_id = str(receipt["decision_id"])
            route_completion = (receipt.get("operation") or {}).get(
                "route_completion"
            )
            _settle_engagement_route_completion(
                ctx,
                route_completion,
                decision_id=decision_id,
                evidence_ref=(
                    f"logs/events.jsonl#{receipt['event_id']}"
                ),
            )
            data = deepcopy(receipt["event"])
            prior = ctx.ledger_lookup("state.record_npc_engagement", decision_id)
            if prior is None or prior.get("data") != data:
                ctx.ledger_record(
                    decision_id, "state.record_npc_engagement", data
                )
    return document


_SOURCE_RECEIPTS_KEY = "operation_receipts"
_SOURCE_RECEIPT_SCHEMA_VERSION = 3
_SOURCE_RECEIPT_INTEGRITY_KEY = "integrity_digest"
_SOURCE_RECEIPT_FIELDS = frozenset({
    "schema_version",
    "tool",
    "decision_id",
    "fingerprint",
    "operation",
    "event_id",
    "event",
    "data",
    "warnings",
    "hints",
    "entity_head",
    _SOURCE_RECEIPT_INTEGRITY_KEY,
})

_NPC_PRESENCE_SCHEMA_VERSION = 1
_NPC_PRESENCE_RECORD_FIELDS = frozenset({
    "schema_version",
    "npc_id",
    "scene_id",
    "status",
    "reason",
    "revision",
    "changed_at",
    "decision_id",
    "source_sequence",
    "producer",
})


def _operation_fingerprint(tool_name: str, operation: dict[str, Any]) -> str:
    encoded = json.dumps(
        {"tool": str(tool_name), "operation": operation},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _canonical_digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _source_receipt_integrity(receipt: dict[str, Any]) -> str:
    """Bind every immutable receipt field except the digest itself."""
    body = {
        key: deepcopy(value)
        for key, value in receipt.items()
        if key != _SOURCE_RECEIPT_INTEGRITY_KEY
    }
    return _canonical_digest(body)


def _source_receipt_manifest(receipt: dict[str, Any]) -> dict[str, Any]:
    """Bind one current source receipt into its idempotency ledger entry."""
    return {
        "schema_version": 1,
        "receipt_schema_version": receipt.get("schema_version"),
        "tool": receipt.get("tool"),
        "decision_id": receipt.get("decision_id"),
        "integrity_digest": receipt.get(_SOURCE_RECEIPT_INTEGRITY_KEY),
    }


_ROLL_RECEIPT_TOOLS = frozenset({
    "rules.roll", "rules.push", "rules.roll_dice", "rules.check",
})
_ROLL_RECEIPT_SCHEMA_VERSION = 5
_ROLL_RECEIPT_DOCUMENT_SCHEMA_VERSION = 6
_ROLL_RECEIPT_DOCUMENT_FIELDS = frozenset({
    "schema_version", "receipts", "pending_side_effects", "luck_spends"
})
_ROLL_RECEIPT_FIELDS = frozenset({
    "schema_version",
    "tool",
    "decision_id",
    "fingerprint",
    "operation",
    "resolution",
    "roll_id",
    "roll_record",
    "data",
    "warnings",
    "hints",
    "log_prefix_size",
    "log_prefix_sha256",
    _SOURCE_RECEIPT_INTEGRITY_KEY,
})
_PERCENTILE_INVOCATION_FIELDS = frozenset({
    "investigator", "skill", "characteristic", "explicit_target",
    "required_level", "bonus", "penalty", "goal", "stakes",
    "difficulty_basis", "reason", "fumble_consequence", "pushed",
    "method_changed", "failure_consequence", "original_check_decision_id",
    "npc_id",
})
_LEGACY_PERCENTILE_INVOCATION_FIELDS = frozenset(
    _PERCENTILE_INVOCATION_FIELDS - {"npc_id"}
)
_PERCENTILE_RESOLUTION_FIELDS = frozenset({
    "investigator_id", "resolved_label", "resolved_target", "target_source",
    "original_check_ref",
})
_DIFFICULTY_BASIS_VALUES = frozenset({
    "authored_gate", "opponent_skill", "environment", "keeper_judgment",
})
_PUSH_INHERITED_ARGUMENTS = frozenset({
    "investigator", "skill", "characteristic", "target", "difficulty",
    "bonus", "penalty", "goal", "stakes", "difficulty_basis", "reason",
    "npc_id",
})
_PUSH_INHERITED_OPERATION_FIELDS = frozenset({
    "investigator", "skill", "characteristic", "explicit_target",
    "required_level", "bonus", "penalty", "goal", "stakes",
    "difficulty_basis", "reason", "npc_id",
})
_DICE_RESOLUTION_FIELDS = frozenset({
    "expression", "count", "sides", "modifier"
})
_LUCK_SPEND_RECEIPT_SCHEMA_VERSION = 1
_LUCK_SPEND_RECEIPT_FIELDS = frozenset({
    "schema_version",
    "tool",
    "decision_id",
    "fingerprint",
    "operation",
    "source_receipt",
    "data",
    "event",
    _SOURCE_RECEIPT_INTEGRITY_KEY,
})
_LUCK_SPEND_OPERATION_FIELDS = frozenset({
    "investigator_id", "source_roll_id", "points"
})


def _roll_dice_semantic_operation(args: dict[str, Any]) -> dict[str, Any]:
    """Bind player/keeper meaning while treating the test RNG seed as transport."""
    expression = str(args["expression"]).strip().upper()
    if coc_roll.ROLL_PATTERN.fullmatch(expression) is None:
        raise ValueError(f"unsupported dice expression: {args['expression']}")
    return {
        "expression": expression,
        "reason": str(args["reason"]) if args.get("reason") is not None else None,
    }


def _roll_receipt_path(ctx: Ctx) -> Path:
    return ctx.campaign_dir / "save" / "roll-operation-receipts.json"


def _load_roll_receipt_document(ctx: Ctx) -> dict[str, Any]:
    path = _roll_receipt_path(ctx)
    if not path.is_file():
        return {
            "schema_version": _ROLL_RECEIPT_DOCUMENT_SCHEMA_VERSION,
            "receipts": {},
            "pending_side_effects": {},
            "luck_spends": {},
        }
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ToolError(
            "state_corrupt", "save/roll-operation-receipts.json is unreadable"
        ) from exc
    if (
        not isinstance(document, dict)
        or set(document) != set(_ROLL_RECEIPT_DOCUMENT_FIELDS)
        or document.get("schema_version") != _ROLL_RECEIPT_DOCUMENT_SCHEMA_VERSION
        or not isinstance(document.get("receipts"), dict)
        or not isinstance(document.get("pending_side_effects"), dict)
        or not isinstance(document.get("luck_spends"), dict)
    ):
        raise ToolError(
            "state_corrupt",
            "save/roll-operation-receipts.json does not match the current schema",
        )
    _validated_roll_document_collection(document)
    return document


def _save_roll_receipt_document(ctx: Ctx, document: dict[str, Any]) -> None:
    coc_state.write_json_atomic(_roll_receipt_path(ctx), document)


def _roll_receipt(
    document: dict[str, Any], tool_name: str, decision_id: str
) -> dict[str, Any] | None:
    receipts = document.get("receipts")
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "canonical roll receipt map is invalid")
    by_tool = receipts.get(str(tool_name))
    if by_tool is None:
        return None
    if not isinstance(by_tool, dict):
        raise ToolError(
            "state_corrupt", f"canonical roll receipts for {tool_name} are invalid"
        )
    receipt = by_tool.get(str(decision_id))
    if receipt is None:
        return None
    if not isinstance(receipt, dict):
        raise ToolError("state_corrupt", "canonical roll receipt is not an object")
    return receipt


def _put_roll_receipt(
    document: dict[str, Any], receipt: dict[str, Any]
) -> None:
    receipts = document.setdefault("receipts", {})
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "canonical roll receipt map is invalid")
    tool_name = str(receipt["tool"])
    by_tool = receipts.setdefault(tool_name, {})
    if not isinstance(by_tool, dict):
        raise ToolError(
            "state_corrupt", f"canonical roll receipts for {tool_name} are invalid"
        )
    by_tool[str(receipt["decision_id"])] = deepcopy(receipt)


def _roll_side_effect_key(receipt: dict[str, Any]) -> str:
    return f"{receipt['tool']}\u0000{receipt['decision_id']}"


def _roll_receipt_needs_side_effect(receipt: dict[str, Any]) -> bool:
    if receipt.get("tool") != "rules.roll":
        return False
    data = receipt.get("data") or {}
    operation = receipt.get("operation") or {}
    skill = str(data.get("skill") or "")
    return bool(
        data.get("outcome") in {"regular", "hard", "extreme", "critical"}
        and operation.get("skill") not in (None, "")
        and skill
        and skill not in _CHARACTERISTIC_NAMES
        and skill not in {"SAN", "LUCK"}
    )


def _queue_roll_side_effect(
    document: dict[str, Any], receipt: dict[str, Any]
) -> None:
    if not _roll_receipt_needs_side_effect(receipt):
        return
    pending = document.get("pending_side_effects")
    if not isinstance(pending, dict):
        raise ToolError("state_corrupt", "canonical roll pending index is invalid")
    pending[_roll_side_effect_key(receipt)] = str(receipt["roll_id"])


def _new_roll_receipt(
    *,
    tool_name: str,
    decision_id: str,
    operation: dict[str, Any],
    resolution: dict[str, Any],
    roll_record: dict[str, Any],
    data: dict[str, Any],
    warnings: list[str],
    hints: list[str],
) -> dict[str, Any]:
    receipt = {
        "schema_version": _ROLL_RECEIPT_SCHEMA_VERSION,
        "tool": str(tool_name),
        "decision_id": str(decision_id),
        "fingerprint": _operation_fingerprint(tool_name, operation),
        "operation": deepcopy(operation),
        "resolution": deepcopy(resolution),
        "roll_id": str(roll_record.get("roll_id") or ""),
        "roll_record": deepcopy(roll_record),
        "data": deepcopy(data),
        "warnings": list(warnings),
        "hints": list(hints),
        "log_prefix_size": 0,
        "log_prefix_sha256": f"sha256:{hashlib.sha256(b'').hexdigest()}",
    }
    receipt[_SOURCE_RECEIPT_INTEGRITY_KEY] = _source_receipt_integrity(receipt)
    return receipt


def _is_exact_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _luck_source_reference(receipt: dict[str, Any]) -> dict[str, Any]:
    return {
        "tool": str(receipt["tool"]),
        "decision_id": str(receipt["decision_id"]),
        "roll_id": str(receipt["roll_id"]),
        "integrity_digest": str(receipt[_SOURCE_RECEIPT_INTEGRITY_KEY]),
    }


def _luck_spend_data(
    source_receipt: dict[str, Any],
    *,
    points: int,
    luck_before: int,
    resolver: Any | None = None,
) -> dict[str, Any]:
    source_data = deepcopy(source_receipt["data"])
    skill = str(source_data.get("skill") or "")
    roll_kind = "luck" if skill == "LUCK" else "sanity" if skill == "SAN" else "skill"
    if resolver is None:
        # Receipt re-validation has no campaign in scope; canonical receipts do
        # not record a ruleset_id, so the default ruleset re-derives the same
        # arithmetic the settle path computed.
        resolver = coc_rulesets.get_resolver(None)
    adjusted = resolver.luck_spend(
        source_data,
        points,
        luck_before,
        roll_kind=roll_kind,
    )
    adjusted.update({
        "original_roll": int(source_data["roll"]),
        "adjusted_roll": int(adjusted["roll"]),
        "luck_before": luck_before,
        "luck_after": int(adjusted["luck_remaining"]),
        "source_roll_id": str(source_receipt["roll_id"]),
        "source_receipt": _luck_source_reference(source_receipt),
    })
    return adjusted


def _luck_spend_receipt(
    document: dict[str, Any], decision_id: str,
) -> dict[str, Any] | None:
    receipts = document.get("luck_spends")
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "canonical Luck receipt map is invalid")
    receipt = receipts.get(str(decision_id))
    if receipt is None:
        return None
    if not isinstance(receipt, dict):
        raise ToolError("state_corrupt", "canonical Luck receipt is invalid")
    return receipt


def _new_luck_spend_receipt(
    *,
    decision_id: str,
    operation: dict[str, Any],
    source_receipt: dict[str, Any],
    data: dict[str, Any],
) -> dict[str, Any]:
    event_id = _operation_event_id("rules.luck_spend", decision_id)
    event = {"event_id": event_id, "event_type": "luck_spent", **deepcopy(data)}
    receipt = {
        "schema_version": _LUCK_SPEND_RECEIPT_SCHEMA_VERSION,
        "tool": "rules.luck_spend",
        "decision_id": str(decision_id),
        "fingerprint": _operation_fingerprint("rules.luck_spend", operation),
        "operation": deepcopy(operation),
        "source_receipt": _luck_source_reference(source_receipt),
        "data": deepcopy(data),
        "event": event,
    }
    receipt[_SOURCE_RECEIPT_INTEGRITY_KEY] = _source_receipt_integrity(receipt)
    return receipt


def _validate_luck_spend_receipts(document: dict[str, Any]) -> None:
    luck_receipts = document.get("luck_spends")
    roll_receipts = document.get("receipts")
    if not isinstance(luck_receipts, dict) or not isinstance(roll_receipts, dict):
        raise ToolError("state_corrupt", "canonical Luck receipt collection is invalid")
    source_owners: dict[str, str] = {}
    for decision_id, receipt in sorted(luck_receipts.items()):
        if not isinstance(receipt, dict):
            raise ToolError("state_corrupt", "canonical Luck receipt is invalid")
        operation = receipt.get("operation")
        source_ref = receipt.get("source_receipt")
        data = receipt.get("data")
        event = receipt.get("event")
        source_decision_id = (
            str(source_ref.get("decision_id") or "")
            if isinstance(source_ref, dict)
            else ""
        )
        source = (roll_receipts.get("rules.roll") or {}).get(source_decision_id)
        invalid = bool(
            set(receipt) != set(_LUCK_SPEND_RECEIPT_FIELDS)
            or receipt.get("schema_version") != _LUCK_SPEND_RECEIPT_SCHEMA_VERSION
            or receipt.get("tool") != "rules.luck_spend"
            or str(receipt.get("decision_id") or "") != str(decision_id)
            or not isinstance(operation, dict)
            or set(operation) != set(_LUCK_SPEND_OPERATION_FIELDS)
            or receipt.get("fingerprint")
            != _operation_fingerprint("rules.luck_spend", operation or {})
            or not isinstance(source_ref, dict)
            or set(source_ref)
            != {"tool", "decision_id", "roll_id", "integrity_digest"}
            or source_ref.get("tool") != "rules.roll"
            or not isinstance(source, dict)
            or source_ref != _luck_source_reference(source or {})
            or not isinstance(data, dict)
            or not isinstance(event, dict)
            or receipt.get(_SOURCE_RECEIPT_INTEGRITY_KEY)
            != _source_receipt_integrity(receipt)
            or not isinstance(operation.get("investigator_id"), str)
            or not operation.get("investigator_id")
            or not isinstance(operation.get("source_roll_id"), str)
            or operation.get("source_roll_id") != source_ref.get("roll_id")
            or not _is_exact_int(operation.get("points"))
            or int(operation.get("points") or 0) <= 0
            or data.get("investigator_id") != operation.get("investigator_id")
            or not _is_exact_int(data.get("luck_before"))
            or data.get("source_receipt") != source_ref
            or data.get("source_roll_id") != source_ref.get("roll_id")
            or event
            != {
                "event_id": _operation_event_id(
                    "rules.luck_spend", str(decision_id)
                ),
                "event_type": "luck_spent",
                **(deepcopy(data) if isinstance(data, dict) else {}),
            }
        )
        if not invalid:
            try:
                expected = _luck_spend_data(
                    source,
                    points=int(operation["points"]),
                    luck_before=int(data["luck_before"]),
                )
            except (KeyError, TypeError, ValueError):
                invalid = True
            else:
                invalid = expected != data
        if invalid:
            raise ToolError(
                "state_corrupt",
                f"Luck source receipt decision_id '{decision_id}' is invalid",
            )
        source_roll_id = str(source_ref["roll_id"])
        prior = source_owners.get(source_roll_id)
        if prior is not None and prior != str(decision_id):
            raise ToolError(
                "state_corrupt",
                f"source roll_id '{source_roll_id}' has multiple Luck adjustments",
            )
        source_owners[source_roll_id] = str(decision_id)


def _optional_scalar_evidence_matches(
    field: str,
    value: str | None,
    *containers: dict[str, Any],
) -> bool:
    """Match the exact optional-field emission used by the roll tools."""
    if value:
        return all(
            field in container and container[field] == value
            for container in containers
        )
    return all(field not in container for container in containers)


def _optional_consequence_evidence_matches(
    field: str,
    value: str | None,
    *containers: dict[str, Any],
) -> bool:
    if value:
        return all(
            field in container
            and container[field] == {"summary": value}
            for container in containers
        )
    return all(field not in container for container in containers)


def _dice_evidence_is_consistent(
    operation: dict[str, Any],
    resolution: dict[str, Any],
    data: dict[str, Any],
    record: dict[str, Any],
    payload: dict[str, Any],
) -> bool:
    expression = resolution.get("expression")
    match = (
        coc_roll.ROLL_PATTERN.fullmatch(expression)
        if isinstance(expression, str)
        else None
    )
    if match is None:
        return False
    parsed_count = int(match.group("count"))
    parsed_sides = int(match.group("sides"))
    parsed_modifier = int(match.group("modifier") or 0)
    count = resolution.get("count")
    sides = resolution.get("sides")
    modifier = resolution.get("modifier")
    rolls = data.get("rolls")
    total = data.get("total")
    reason = operation.get("reason")
    return bool(
        set(operation) == {"expression", "reason"}
        and (reason is None or isinstance(reason, str))
        and set(resolution) == set(_DICE_RESOLUTION_FIELDS)
        and _is_exact_int(count)
        and _is_exact_int(sides)
        and _is_exact_int(modifier)
        and count == parsed_count
        and sides == parsed_sides
        and modifier == parsed_modifier
        and count > 0
        and sides > 0
        and isinstance(rolls, list)
        and len(rolls) == count
        and all(_is_exact_int(face) and 1 <= face <= sides for face in rolls)
        and _is_exact_int(total)
        and total == sum(rolls) + modifier
        and operation.get("expression") == expression
        and all(resolution.get(key) == data.get(key) for key in _DICE_RESOLUTION_FIELDS)
        and all(resolution.get(key) == record.get(key) for key in _DICE_RESOLUTION_FIELDS)
        and all(resolution.get(key) == payload.get(key) for key in _DICE_RESOLUTION_FIELDS)
        and record.get("rolls") == rolls
        and payload.get("rolls") == rolls
        and record.get("total") == total
        and payload.get("total") == total
        and payload.get("die_expression") == expression
        and payload.get("individual_faces") == rolls
        and payload.get("final_total") == total
        and payload.get("roll") == total
        and _optional_scalar_evidence_matches(
            "reason", reason, data, record, payload
        )
    )


def _validate_roll_resolution_consistency(receipt: dict[str, Any]) -> None:
    tool_name = str(receipt["tool"])
    operation = receipt["operation"]
    resolution = receipt["resolution"]
    data = receipt["data"]
    record = receipt["roll_record"]
    payload = record["payload"]
    invalid = False
    if tool_name == "rules.roll_dice":
        invalid = not _dice_evidence_is_consistent(
            operation, resolution, data, record, payload
        )
    else:
        selector_skill = operation.get("skill")
        selector_characteristic = operation.get("characteristic")
        explicit_target = operation.get("explicit_target")
        investigator = operation.get("investigator")
        required_level = operation.get("required_level")
        bonus = operation.get("bonus")
        penalty = operation.get("penalty")
        goal = operation.get("goal")
        stakes = operation.get("stakes")
        difficulty_basis = operation.get("difficulty_basis")
        reason = operation.get("reason")
        target_npc_id = operation.get("npc_id")
        fumble_consequence = operation.get("fumble_consequence")
        pushed = operation.get("pushed")
        method_changed = operation.get("method_changed")
        failure_consequence = operation.get("failure_consequence")
        original_check_decision_id = operation.get(
            "original_check_decision_id"
        )
        original_check_ref = resolution.get("original_check_ref")
        label = resolution.get("resolved_label")
        target_source = resolution.get("target_source")
        expected_bonus = (
            max(0, bonus - penalty)
            if _is_exact_int(bonus) and _is_exact_int(penalty)
            else None
        )
        expected_penalty = (
            max(0, penalty - bonus)
            if _is_exact_int(bonus) and _is_exact_int(penalty)
            else None
        )
        expected_result: dict[str, Any] | None = None
        if (
            _is_exact_int(resolution.get("resolved_target"))
            and _is_exact_int(data.get("roll"))
            and required_level in {"regular", "hard", "extreme"}
        ):
            try:
                expected_result = coc_roll.resolve_percentile_roll(
                    int(data["roll"]),
                    int(resolution["resolved_target"]),
                    str(required_level),
                )
            except (KeyError, TypeError, ValueError):
                expected_result = None
        valid_stakes = bool(
            isinstance(stakes, dict)
            and set(stakes) == {"on_success", "on_failure"}
            and all(
                isinstance(stakes.get(key), str)
                and bool(stakes[key].strip())
                and stakes[key] == stakes[key].strip()
                for key in ("on_success", "on_failure")
            )
        )
        valid_original_ref = bool(
            isinstance(original_check_ref, dict)
            and set(original_check_ref)
            == {"tool", "decision_id", "roll_id", "integrity_digest"}
            and original_check_ref.get("tool") == "rules.roll"
            and isinstance(original_check_ref.get("decision_id"), str)
            and bool(original_check_ref.get("decision_id"))
            and isinstance(original_check_ref.get("roll_id"), str)
            and bool(original_check_ref.get("roll_id"))
            and re.fullmatch(
                r"sha256:[0-9a-f]{64}",
                str(original_check_ref.get("integrity_digest") or ""),
            )
        )
        invalid = bool(
            frozenset(operation) not in {
                _PERCENTILE_INVOCATION_FIELDS,
                _LEGACY_PERCENTILE_INVOCATION_FIELDS,
            }
            or set(resolution) != set(_PERCENTILE_RESOLUTION_FIELDS)
            or not (
                investigator is None
                or (isinstance(investigator, str) and bool(investigator))
            )
            or not (
                selector_skill is None
                or (
                    isinstance(selector_skill, str)
                    and bool(selector_skill)
                    and selector_skill == selector_skill.strip()
                )
            )
            or not (
                selector_characteristic is None
                or (
                    isinstance(selector_characteristic, str)
                    and bool(selector_characteristic)
                    and selector_characteristic
                    == selector_characteristic.strip().upper()
                )
            )
            or not (explicit_target is None or _is_exact_int(explicit_target))
            or required_level not in {"regular", "hard", "extreme"}
            or not _is_exact_int(bonus)
            or not 0 <= bonus <= 2
            or not _is_exact_int(penalty)
            or not 0 <= penalty <= 2
            or not isinstance(goal, str)
            or not goal.strip()
            or goal != goal.strip()
            or not valid_stakes
            or difficulty_basis not in _DIFFICULTY_BASIS_VALUES
            or not (
                reason is None
                or (
                    isinstance(reason, str)
                    and bool(reason)
                    and reason == reason.strip()
                )
            )
            or not (
                target_npc_id is None
                or (
                    isinstance(target_npc_id, str)
                    and bool(target_npc_id)
                    and target_npc_id == target_npc_id.strip()
                )
            )
            or not (
                fumble_consequence is None
                or (
                    isinstance(fumble_consequence, str)
                    and bool(fumble_consequence)
                    and fumble_consequence == fumble_consequence.strip()
                )
            )
            or not isinstance(pushed, bool)
            or not isinstance(resolution.get("investigator_id"), str)
            or not resolution.get("investigator_id")
            or not isinstance(label, str)
            or not label
            or not _is_exact_int(resolution.get("resolved_target"))
            or expected_result is None
            or target_source not in {"explicit", "state", "sheet", "rulebook_base"}
            or resolution.get("investigator_id") != data.get("investigator_id")
            or resolution.get("investigator_id") != record.get("actor")
            or resolution.get("investigator_id") != payload.get("investigator_id")
            or label != data.get("skill")
            or label != record.get("skill")
            or label != payload.get("skill")
            or any(
                data.get(key) != value
                for key, value in (expected_result or {}).items()
            )
            or resolution.get("resolved_target") != data.get("target")
            or resolution.get("resolved_target") != record.get("target")
            or resolution.get("resolved_target") != payload.get("target")
            or target_source != data.get("target_source")
            or target_source != record.get("target_source")
            or target_source != payload.get("target_source")
            or (
                investigator is not None
                and investigator != resolution.get("investigator_id")
            )
            or (
                explicit_target is not None
                and explicit_target != resolution.get("resolved_target")
            )
            or (explicit_target is not None and target_source != "explicit")
            or (explicit_target is None and target_source == "explicit")
            or (
                selector_skill is not None
                and selector_skill.casefold() != label.casefold()
            )
            or (
                selector_characteristic is not None
                and selector_characteristic.casefold() != label.casefold()
            )
            or pushed != (tool_name == "rules.push")
            or any(
                container.get("required_level") != required_level
                for container in (data, record, payload)
            )
            or any(
                container.get("difficulty") != required_level
                for container in (data, record, payload)
            )
            or any(
                container.get("goal") != goal
                for container in (data, record, payload)
            )
            or any(
                container.get("stakes") != stakes
                for container in (data, record, payload)
            )
            or any(
                container.get("difficulty_basis") != difficulty_basis
                for container in (data, record, payload)
            )
            or any(
                container.get("bonus") != expected_bonus
                for container in (data, record, payload)
            )
            or any(
                container.get("penalty") != expected_penalty
                for container in (data, record, payload)
            )
            or any(
                container.get("pushed") != pushed
                for container in (data, record, payload)
            )
            or not _optional_scalar_evidence_matches(
                "reason", reason, data, record, payload
            )
            or not _optional_scalar_evidence_matches(
                "npc_id", target_npc_id, data, record, payload
            )
            or not _optional_consequence_evidence_matches(
                "fumble_consequence",
                fumble_consequence,
                data,
                record,
                payload,
            )
            or (
                pushed
                and (
                    not isinstance(method_changed, str)
                    or not method_changed
                    or method_changed != method_changed.strip()
                    or not isinstance(failure_consequence, str)
                    or not failure_consequence
                    or failure_consequence != failure_consequence.strip()
                    or not _optional_scalar_evidence_matches(
                        "method_changed", method_changed, data, record, payload
                    )
                    or not _optional_consequence_evidence_matches(
                        "failure_consequence",
                        failure_consequence,
                        data,
                        record,
                        payload,
                    )
                    or not _optional_consequence_evidence_matches(
                        "announced_consequence",
                        failure_consequence,
                        data,
                        record,
                        payload,
                    )
                    or not isinstance(original_check_decision_id, str)
                    or not original_check_decision_id
                    or not valid_original_ref
                    or original_check_ref.get("decision_id")
                    != original_check_decision_id
                    or any(
                        container.get("original_check") != original_check_ref
                        for container in (data, record, payload)
                    )
                )
            )
            or (
                not pushed
                and (
                    method_changed is not None
                    or failure_consequence is not None
                    or original_check_decision_id is not None
                    or original_check_ref is not None
                    or any(
                        field in container
                        for field in (
                            "method_changed",
                            "failure_consequence",
                            "announced_consequence",
                            "original_check",
                        )
                        for container in (data, record, payload)
                    )
                )
            )
        )
    if invalid:
        raise ToolError(
            "state_corrupt",
            f"roll source receipt for {tool_name} decision_id '{receipt['decision_id']}' has contradictory resolution evidence",
        )


def _validate_roll_receipt(
    receipt: dict[str, Any], *, tool_name: str, decision_id: str,
    current_operation: dict[str, Any] | None = None,
) -> None:
    operation = receipt.get("operation")
    resolution = receipt.get("resolution")
    record = receipt.get("roll_record")
    data = receipt.get("data")
    roll_id = str(receipt.get("roll_id") or "")
    payload = record.get("payload") if isinstance(record, dict) else None
    if (
        set(receipt) != set(_ROLL_RECEIPT_FIELDS)
        or receipt.get("schema_version") != _ROLL_RECEIPT_SCHEMA_VERSION
        or not isinstance(receipt.get("tool"), str)
        or receipt.get("tool") != tool_name
        or not isinstance(receipt.get("decision_id"), str)
        or receipt.get("decision_id") != decision_id
        or tool_name not in _ROLL_RECEIPT_TOOLS
        or not isinstance(operation, dict)
        or not isinstance(resolution, dict)
        or receipt.get("fingerprint")
        != _operation_fingerprint(tool_name, operation)
        or not isinstance(record, dict)
        or not isinstance(data, dict)
        or not isinstance(payload, dict)
        or not isinstance(receipt.get("warnings"), list)
        or not isinstance(receipt.get("hints"), list)
        or isinstance(receipt.get("log_prefix_size"), bool)
        or not isinstance(receipt.get("log_prefix_size"), int)
        or receipt.get("log_prefix_size") < 0
        or not re.fullmatch(
            r"sha256:[0-9a-f]{64}", str(receipt.get("log_prefix_sha256") or "")
        )
        or not roll_id
        or str(record.get("roll_id") or "") != roll_id
        or str(payload.get("roll_id") or "") != roll_id
        or str(data.get("roll_id") or "") != roll_id
        or record.get("visibility") != "public"
        or record.get("event_type") != "roll"
        or any(record.get(key) != value for key, value in data.items())
        or receipt.get(_SOURCE_RECEIPT_INTEGRITY_KEY)
        != _source_receipt_integrity(receipt)
    ):
        raise ToolError(
            "state_corrupt",
            f"roll source receipt for {tool_name} decision_id '{decision_id}' is invalid",
        )
    if tool_name == "rules.check":
        _validate_generic_check_receipt(receipt)
    else:
        _validate_roll_resolution_consistency(receipt)
    if (
        current_operation is not None
        and receipt.get("fingerprint")
        != _operation_fingerprint(tool_name, current_operation)
    ):
        raise ToolError(
            "idempotency_conflict",
            f"decision_id '{decision_id}' was already applied to a different {tool_name} semantic operation",
        )


def _validate_generic_check_receipt(receipt: dict[str, Any]) -> None:
    """Validate the package-neutral evidence frozen by ``rules.check``."""
    operation = receipt.get("operation")
    resolution = receipt.get("resolution")
    data = receipt.get("data")
    record = receipt.get("roll_record")
    payload = record.get("payload") if isinstance(record, dict) else None
    dice = data.get("dice") if isinstance(data, dict) else None
    required_operation = {
        "ruleset_id", "ruleset_version", "actor_id", "request", "seed",
    }
    required_resolution = {
        "label", "outcome", "success", "expression", "faces", "total", "target",
    }
    invalid = (
        not isinstance(operation, dict)
        or set(operation) != required_operation
        or not all(
            isinstance(operation.get(key), str) and bool(operation[key])
            for key in ("ruleset_id", "ruleset_version", "actor_id")
        )
        or not isinstance(operation.get("request"), dict)
        or (
            operation.get("seed") is not None
            and not _is_exact_int(operation.get("seed"))
        )
        or not isinstance(resolution, dict)
        or set(resolution) != required_resolution
        or not isinstance(resolution.get("label"), str)
        or not resolution.get("label")
        or not isinstance(resolution.get("outcome"), str)
        or not resolution.get("outcome")
        or not isinstance(resolution.get("success"), bool)
        or not isinstance(resolution.get("expression"), str)
        or not resolution.get("expression")
        or not isinstance(resolution.get("faces"), list)
        or not resolution.get("faces")
        or not all(_is_exact_int(value) for value in resolution.get("faces", []))
        or not _is_exact_int(resolution.get("total"))
        or (
            resolution.get("target") is not None
            and not _is_exact_int(resolution.get("target"))
        )
        or not isinstance(data, dict)
        or not isinstance(payload, dict)
        or not isinstance(dice, dict)
        or dice != {
            "expression": resolution.get("expression"),
            "raw": resolution.get("faces"),
            "total": resolution.get("total"),
        }
        or data.get("ruleset_id") != operation.get("ruleset_id")
        or data.get("ruleset_version") != operation.get("ruleset_version")
        or data.get("actor_id") != operation.get("actor_id")
        or data.get("investigator_id") != operation.get("actor_id")
        or data.get("skill") != resolution.get("label")
        or data.get("outcome") != resolution.get("outcome")
        or data.get("success") is not resolution.get("success")
        or data.get("roll") != resolution.get("total")
        or data.get("target") != resolution.get("target")
        or payload.get("dice") != dice
    )
    if invalid:
        raise ToolError(
            "state_corrupt",
            f"generic check source receipt decision_id '{receipt.get('decision_id')}' has contradictory evidence",
        )


def _roll_log_bytes(ctx: Ctx) -> bytes:
    path = ctx.campaign_dir / "logs" / "rolls.jsonl"
    if not path.is_file():
        return b""
    try:
        return path.read_bytes()
    except OSError as exc:
        raise ToolError("state_corrupt", "logs/rolls.jsonl is unreadable") from exc


def _roll_record_frame(record: dict[str, Any]) -> bytes:
    return json.dumps(record).encode("utf-8")


def _parse_complete_roll_frames(
    raw: bytes,
) -> tuple[bytes, bytes, dict[str, dict[str, Any]]]:
    """Parse framed rows once and return the first unproven suffix as tail.

    A process can die after writing a full JSON object but before its newline,
    and another low-level writer may then append a complete frame.  In that
    case the malformed physical line ends in a newline, so merely inspecting
    the final byte would misclassify it as durable corruption.  Returning the
    first malformed suffix lets a committed receipt prove the exact insertion
    boundary; callers still fail closed when no unique receipt does so.
    """
    index: dict[str, dict[str, Any]] = {}
    complete_size = 0
    line_number = 0
    for framed in raw.splitlines(keepends=True):
        line_number += 1
        if not framed.endswith(b"\n"):
            return raw[:complete_size], raw[complete_size:], index
        encoded = framed[:-1]
        if not encoded.strip():
            complete_size += len(framed)
            continue
        try:
            row = json.loads(encoded.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return raw[:complete_size], raw[complete_size:], index
        if not isinstance(row, dict):
            raise ToolError(
                "state_corrupt",
                f"logs/rolls.jsonl line {line_number} is not an object",
            )
        roll_id = str(row.get("roll_id") or "")
        if roll_id:
            if roll_id in index:
                raise ToolError(
                    "state_corrupt", f"duplicate roll_id '{roll_id}' in rolls.jsonl"
                )
            index[roll_id] = row
        complete_size += len(framed)
    return raw, b"", index


def _roll_prefix_hash_update(digest: Any, chunk: memoryview) -> None:
    """One instrumentation seam for bounded cumulative-prefix verification."""
    digest.update(chunk)


def _verify_roll_receipt_prefixes(
    raw: bytes, receipts: list[dict[str, Any]]
) -> None:
    """Verify every historical prefix with one monotonic hash pass."""
    ordered = sorted(
        receipts,
        key=lambda receipt: (
            int(receipt["log_prefix_size"]),
            str(receipt["tool"]),
            str(receipt["decision_id"]),
        ),
    )
    digest = hashlib.sha256()
    offset = 0
    view = memoryview(raw)
    for receipt in ordered:
        size = int(receipt["log_prefix_size"])
        if size < offset or size > len(raw):
            raise ToolError(
                "state_corrupt",
                f"roll source prefix for roll_id '{receipt['roll_id']}' is out of range",
            )
        if size > offset:
            _roll_prefix_hash_update(digest, view[offset:size])
            offset = size
        actual = f"sha256:{digest.hexdigest()}"
        if actual != receipt["log_prefix_sha256"]:
            raise ToolError(
                "state_corrupt",
                f"roll source prefix for roll_id '{receipt['roll_id']}' changed",
            )


def _append_roll_frame_locked(path: Path, frame: bytes) -> None:
    """Append one newline frame with recoverable partial-write semantics."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    try:
        pending = memoryview(frame + b"\n")
        while pending:
            written = os.write(descriptor, pending)
            if written <= 0:
                raise OSError("roll frame append made no progress")
            pending = pending[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _plan_receipt_owned_tail(
    raw: bytes,
    complete: bytes,
    tail: bytes,
    receipts: list[dict[str, Any]],
) -> tuple[bytes, dict[str, dict[str, Any]]]:
    """Repair only a unique final frame proven by a committed prefix receipt."""
    candidates: list[tuple[dict[str, Any], bytes]] = []
    for receipt in receipts:
        if int(receipt["log_prefix_size"]) != len(complete):
            continue
        expected = _roll_record_frame(receipt["roll_record"])
        if expected.startswith(tail):
            repaired = complete + expected + b"\n"
            candidates.append((receipt, repaired))
        elif tail.startswith(expected):
            # A later low-level append may have followed a complete frame whose
            # newline was lost. The exact expected length provides the only
            # safe insertion boundary; the remainder must itself be framed.
            repaired = complete + expected + b"\n" + tail[len(expected):]
            candidates.append((receipt, repaired))
    if len(candidates) != 1:
        raise ToolError(
            "state_corrupt",
            "logs/rolls.jsonl has an ambiguous or non-receipt-owned final tail",
        )
    _receipt, repaired = candidates[0]
    repaired_complete, repaired_tail, index = _parse_complete_roll_frames(repaired)
    if repaired_tail or repaired_complete != repaired:
        raise ToolError(
            "state_corrupt",
            "logs/rolls.jsonl final tail cannot be repaired without guessing",
        )
    return repaired, index


def _validated_roll_document_collection(
    document: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    ordered: list[dict[str, Any]] = []
    by_effect_key: dict[str, dict[str, Any]] = {}
    decision_owners: set[tuple[str, str]] = set()
    roll_owners: dict[str, tuple[str, str]] = {}
    receipts = document.get("receipts")
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "canonical receipts map is invalid")
    for tool_name in sorted(receipts):
        by_tool = receipts[tool_name]
        if tool_name not in _ROLL_RECEIPT_TOOLS or not isinstance(by_tool, dict):
            raise ToolError("state_corrupt", "canonical receipts map is invalid")
        for decision_id in sorted(by_tool):
            receipt = by_tool[decision_id]
            if not isinstance(receipt, dict):
                raise ToolError("state_corrupt", "canonical receipt is invalid")
            _validate_roll_receipt(
                receipt, tool_name=tool_name, decision_id=decision_id
            )
            decision_owner = (str(tool_name), str(decision_id))
            if decision_owner in decision_owners:
                raise ToolError(
                    "state_corrupt",
                    f"roll decision '{tool_name}:{decision_id}' has multiple receipt owners",
                )
            decision_owners.add(decision_owner)
            roll_id = str(receipt["roll_id"])
            prior_owner = roll_owners.get(roll_id)
            if prior_owner is not None:
                raise ToolError(
                    "state_corrupt",
                    f"roll_id '{roll_id}' has multiple receipt owners",
                )
            roll_owners[roll_id] = decision_owner
            ordered.append(receipt)
            by_effect_key[_roll_side_effect_key(receipt)] = receipt
    roll_receipts = receipts.get("rules.roll") or {}
    push_receipts = receipts.get("rules.push") or {}
    pushed_originals: dict[str, str] = {}
    for push_decision_id, push_receipt in push_receipts.items():
        push_operation = push_receipt["operation"]
        original_decision_id = str(
            push_operation.get("original_check_decision_id") or ""
        )
        original = roll_receipts.get(original_decision_id)
        if not isinstance(original, dict):
            raise ToolError(
                "state_corrupt",
                f"pushed roll '{push_decision_id}' has no canonical original rules.roll receipt",
            )
        expected_ref = {
            "tool": "rules.roll",
            "decision_id": original_decision_id,
            "roll_id": str(original["roll_id"]),
            "integrity_digest": str(original[_SOURCE_RECEIPT_INTEGRITY_KEY]),
        }
        if (
            original["data"].get("success") is not False
            or original["data"].get("passed") is not False
            or original["data"].get("outcome") != "failure"
            or push_receipt["resolution"].get("original_check_ref")
            != expected_ref
            or any(
                push_operation.get(field)
                != original["operation"].get(field)
                for field in _PUSH_INHERITED_OPERATION_FIELDS
            )
            or any(
                push_receipt["resolution"].get(field)
                != original["resolution"].get(field)
                for field in (
                    "investigator_id",
                    "resolved_label",
                    "resolved_target",
                    "target_source",
                )
            )
        ):
            raise ToolError(
                "state_corrupt",
                f"pushed roll '{push_decision_id}' contradicts its original check contract",
            )
        prior_push = pushed_originals.get(original_decision_id)
        if prior_push is not None and prior_push != str(push_decision_id):
            raise ToolError(
                "state_corrupt",
                f"original check '{original_decision_id}' has multiple pushed rolls",
            )
        pushed_originals[original_decision_id] = str(push_decision_id)
    pending = document.get("pending_side_effects")
    if not isinstance(pending, dict):
        raise ToolError("state_corrupt", "canonical roll pending index is invalid")
    for key, roll_id in pending.items():
        receipt = by_effect_key.get(str(key))
        if (
            not isinstance(key, str)
            or not isinstance(roll_id, str)
            or receipt is None
            or not _roll_receipt_needs_side_effect(receipt)
            or roll_id != str(receipt["roll_id"])
        ):
            raise ToolError(
                "state_corrupt", "canonical roll pending index has no valid receipt"
            )
    _validate_luck_spend_receipts(document)
    return ordered, by_effect_key


def _plan_roll_materialization(
    raw: bytes, receipts: list[dict[str, Any]]
) -> dict[str, Any]:
    _verify_roll_receipt_prefixes(raw, receipts)
    complete, tail, index = _parse_complete_roll_frames(raw)
    replacement: bytes | None = None
    if tail:
        replacement, index = _plan_receipt_owned_tail(
            raw, complete, tail, receipts
        )
    append_records: list[dict[str, Any]] = []
    planned_ids = set(index)
    for receipt in receipts:
        roll_id = str(receipt["roll_id"])
        expected = receipt["roll_record"]
        prior = index.get(roll_id)
        if prior is not None:
            if prior != expected:
                raise ToolError(
                    "state_corrupt",
                    f"roll_id '{roll_id}' conflicts with its source receipt",
                )
            continue
        if roll_id in planned_ids:
            raise ToolError(
                "state_corrupt", f"roll_id '{roll_id}' has multiple append owners"
            )
        planned_ids.add(roll_id)
        append_records.append(expected)
    return {"replacement": replacement, "append_records": append_records}


def _preflight_roll_document(
    document: dict[str, Any], raw: bytes
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, Any]]:
    ordered, by_effect_key = _validated_roll_document_collection(document)
    plan = _plan_roll_materialization(raw, ordered)
    return ordered, by_effect_key, plan


def _apply_roll_materialization_plan(ctx: Ctx, plan: dict[str, Any]) -> None:
    path = ctx.campaign_dir / "logs" / "rolls.jsonl"
    replacement = plan.get("replacement")
    if replacement is not None:
        coc_fileio.write_text_atomic(path, bytes(replacement).decode("utf-8"))
    for record in plan.get("append_records") or []:
        _append_roll_frame_locked(path, _roll_record_frame(record))


def _materialize_roll_receipts_locked(
    ctx: Ctx, receipts: list[dict[str, Any]]
) -> None:
    raw = _roll_log_bytes(ctx)
    plan = _plan_roll_materialization(raw, receipts)
    _apply_roll_materialization_plan(ctx, plan)


def _freeze_roll_receipt_source(
    ctx: Ctx,
    document: dict[str, Any],
    receipt: dict[str, Any],
) -> None:
    """Atomically publish the intent while its clean log prefix is frozen."""
    try:
        with coc_async_recorder.recorder_lock(ctx.campaign_dir):
            raw = _roll_log_bytes(ctx)
            _complete, tail, _index = _parse_complete_roll_frames(raw)
            if tail:
                raise ToolError(
                    "state_corrupt",
                    "cannot start a new roll while rolls.jsonl has an unterminated tail",
                )
            receipt["log_prefix_size"] = len(raw)
            receipt["log_prefix_sha256"] = (
                f"sha256:{hashlib.sha256(raw).hexdigest()}"
            )
            receipt[_SOURCE_RECEIPT_INTEGRITY_KEY] = _source_receipt_integrity(
                receipt
            )
            _validate_roll_receipt(
                receipt,
                tool_name=str(receipt["tool"]),
                decision_id=str(receipt["decision_id"]),
            )
            _put_roll_receipt(document, receipt)
            _queue_roll_side_effect(document, receipt)
            _preflight_roll_document(document, raw)
            _save_roll_receipt_document(ctx, document)
    except coc_async_recorder.RecorderLockError as exc:
        raise ToolError("campaign_busy", str(exc)) from exc


def _ensure_roll_receipt_row(ctx: Ctx, receipt: dict[str, Any]) -> bool:
    """Materialize one frozen roll row exactly once under the recorder lock."""
    _validate_roll_receipt(
        receipt,
        tool_name=str(receipt.get("tool") or ""),
        decision_id=str(receipt.get("decision_id") or ""),
    )
    try:
        with coc_async_recorder.recorder_lock(ctx.campaign_dir):
            before = _roll_log_bytes(ctx)
            _materialize_roll_receipts_locked(ctx, [receipt])
            return _roll_log_bytes(ctx) != before
    except coc_async_recorder.RecorderLockError as exc:
        raise ToolError("campaign_busy", str(exc)) from exc


def _apply_roll_receipt_side_effects(ctx: Ctx, receipt: dict[str, Any]) -> bool:
    """Repair deterministic non-log effects frozen by a percentile receipt."""
    if not _roll_receipt_needs_side_effect(receipt):
        return False
    data = receipt.get("data") or {}
    skill = str(data.get("skill") or "")
    return _mark_improvement_tick(
        ctx,
        str(data.get("investigator_id") or ""),
        skill,
        data,
        source_event_id=f"rules.roll:{receipt['decision_id']}",
        source_kind="rules.roll",
    )


def _settle_pending_roll_side_effect(
    ctx: Ctx,
    document: dict[str, Any],
    receipt: dict[str, Any],
) -> bool:
    pending = document.get("pending_side_effects")
    if not isinstance(pending, dict):
        raise ToolError("state_corrupt", "canonical roll pending index is invalid")
    key = _roll_side_effect_key(receipt)
    frozen_roll_id = pending.get(key)
    if frozen_roll_id is None:
        return False
    if str(frozen_roll_id) != str(receipt["roll_id"]):
        raise ToolError(
            "state_corrupt",
            f"pending roll side effect for decision_id '{receipt['decision_id']}' is invalid",
        )
    _apply_roll_receipt_side_effects(ctx, receipt)
    del pending[key]
    _save_roll_receipt_document(ctx, document)
    return True


def _repair_roll_receipt_ledger(ctx: Ctx, receipt: dict[str, Any]) -> None:
    data = deepcopy(receipt["data"])
    manifest = _source_receipt_manifest(receipt)
    prior = ctx.ledger_lookup(str(receipt["tool"]), str(receipt["decision_id"]))
    if (
        prior is None
        or prior.get("data") != data
        or prior.get("source_receipt_manifest") != manifest
    ):
        ctx.ledger_record(
            str(receipt["decision_id"]),
            str(receipt["tool"]),
            data,
            source_receipt_manifest=manifest,
        )


def _replay_roll_receipt(
    ctx: Ctx, document: dict[str, Any], receipt: dict[str, Any]
) -> tuple[dict[str, Any], list[str], list[str]]:
    _ensure_roll_receipt_row(ctx, receipt)
    _settle_pending_roll_side_effect(ctx, document, receipt)
    _repair_roll_receipt_ledger(ctx, receipt)
    warnings = list(receipt.get("warnings") or [])
    warnings.append(
        "duplicate decision_id: recovered the original roll source receipt"
    )
    data = receipt.get("data") if isinstance(receipt.get("data"), dict) else {}
    context = (
        data.get("resolution_context")
        if isinstance(data.get("resolution_context"), dict)
        else None
    )
    _route_receipt, route_warnings = _settle_contextual_route(
        ctx,
        context,
        decision_id=str(receipt.get("decision_id") or ""),
        source_tool=str(receipt.get("tool") or "rules.roll"),
        successful=bool(data.get("success")),
    )
    warnings.extend(route_warnings)
    return (
        deepcopy(data),
        warnings,
        list(receipt.get("hints") or []),
    )


def _existing_roll_receipt(
    ctx: Ctx,
    *,
    tool_name: str,
    decision_id: str,
    operation: dict[str, Any],
    document: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    if document is None:
        document = _load_roll_receipt_document(ctx)
    receipt = _roll_receipt(document, tool_name, decision_id)
    if receipt is not None:
        _validate_roll_receipt(
            receipt,
            tool_name=tool_name,
            decision_id=decision_id,
            current_operation=operation,
        )
        return document, receipt
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        raise ToolError(
            "state_corrupt",
            f"toolbox ledger entry for {tool_name} decision_id '{decision_id}' has no canonical roll source receipt",
        )
    return document, None


def _commit_new_roll_receipt(
    ctx: Ctx,
    document: dict[str, Any],
    receipt: dict[str, Any],
) -> None:
    """Durably freeze source, then materialize row/effects, then ledger."""
    _freeze_roll_receipt_source(ctx, document, receipt)
    _ensure_roll_receipt_row(ctx, receipt)
    _settle_pending_roll_side_effect(ctx, document, receipt)
    _repair_roll_receipt_ledger(ctx, receipt)


def _reconcile_all_roll_source_receipts(ctx: Ctx) -> None:
    document = _load_roll_receipt_document(ctx)
    # Most state tools have no roll receipts to reconcile.  Validate the empty
    # collection (including rejecting a ghost pending index) without taking the
    # recorder lock so unrelated background flushing cannot block state repair.
    ordered, _by_effect_key = _validated_roll_document_collection(document)
    if not ordered:
        return
    try:
        with coc_async_recorder.recorder_lock(ctx.campaign_dir):
            raw = _roll_log_bytes(ctx)
            _ordered, by_effect_key, plan = _preflight_roll_document(document, raw)
            _apply_roll_materialization_plan(ctx, plan)
    except coc_async_recorder.RecorderLockError as exc:
        raise ToolError("campaign_busy", str(exc)) from exc
    # The entire collection, log plan, and pending index are proven before the
    # first append or development mutation. Ledger repair remains requested-ID.
    pending = document["pending_side_effects"]
    pending_changed = False
    for key in sorted(list(pending)):
        receipt = by_effect_key.get(key)
        if receipt is None or not _roll_receipt_needs_side_effect(receipt):
            raise ToolError(
                "state_corrupt", "canonical roll pending index has no valid receipt"
            )
        if str(pending[key]) != str(receipt["roll_id"]):
            raise ToolError(
                "state_corrupt",
                f"pending roll side effect for decision_id '{receipt['decision_id']}' is invalid",
            )
        _apply_roll_receipt_side_effects(ctx, receipt)
        del pending[key]
        pending_changed = True
    if pending_changed:
        _save_roll_receipt_document(ctx, document)


def _ledger_requires_source_receipt(entry: dict[str, Any] | None) -> bool:
    if not isinstance(entry, dict):
        return False
    entry_schema = entry.get("entry_schema_version")
    explicitly_receipt_era = bool(
        entry.get("source_receipt_required") is True
        or (
            isinstance(entry_schema, int)
            and not isinstance(entry_schema, bool)
            and entry_schema >= 3
        )
    )
    if "source_receipt_manifest" not in entry:
        if explicitly_receipt_era:
            raise ToolError(
                "state_corrupt",
                "receipt-era toolbox ledger entry is missing its source receipt manifest",
            )
        return False
    manifest = entry.get("source_receipt_manifest")
    digest = str((manifest or {}).get("integrity_digest") or "") if isinstance(manifest, dict) else ""
    entry_tool = str(entry.get("tool"))
    supported_receipt_versions = (
        frozenset({_ROLL_RECEIPT_SCHEMA_VERSION})
        if entry_tool in _ROLL_RECEIPT_TOOLS
        else frozenset({_LUCK_SPEND_RECEIPT_SCHEMA_VERSION})
        if entry_tool == "rules.luck_spend"
        else frozenset({_SOURCE_RECEIPT_SCHEMA_VERSION})
    )
    if (
        not isinstance(manifest, dict)
        or manifest.get("schema_version") != 1
        or manifest.get("receipt_schema_version")
        not in supported_receipt_versions
        or str(manifest.get("tool")) != str(entry.get("tool"))
        or str(manifest.get("decision_id")) != str(entry.get("decision_id"))
        or not digest.startswith("sha256:")
        or len(digest) != len("sha256:") + 64
    ):
        raise ToolError(
            "state_corrupt",
            "toolbox ledger has an invalid source receipt manifest",
        )
    return True


def _operation_event_id(tool_name: str, decision_id: str) -> str:
    encoded = json.dumps(
        [str(tool_name), str(decision_id)],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"tool-operation-v1:{hashlib.sha256(encoded).hexdigest()[:32]}"


def _source_receipt(
    source: dict[str, Any],
    tool_name: str,
    decision_id: str,
) -> dict[str, Any] | None:
    all_receipts = source.get(_SOURCE_RECEIPTS_KEY)
    if all_receipts is None:
        return None
    if not isinstance(all_receipts, dict):
        raise ToolError(
            "state_corrupt",
            f"canonical source has invalid {_SOURCE_RECEIPTS_KEY}",
        )
    tool_receipts = all_receipts.get(str(tool_name))
    if tool_receipts is None:
        return None
    if not isinstance(tool_receipts, dict):
        raise ToolError(
            "state_corrupt",
            f"canonical source has invalid receipts for {tool_name}",
        )
    receipt = tool_receipts.get(str(decision_id))
    if receipt is None:
        return None
    if not isinstance(receipt, dict):
        raise ToolError(
            "state_corrupt",
            f"canonical source receipt for {tool_name} decision_id '{decision_id}' is not an object",
        )
    return receipt


def _put_source_receipt(
    source: dict[str, Any],
    receipt: dict[str, Any],
) -> None:
    all_receipts = source.get(_SOURCE_RECEIPTS_KEY)
    if all_receipts is None:
        all_receipts = {}
    elif not isinstance(all_receipts, dict):
        raise ToolError(
            "state_corrupt",
            f"canonical source has invalid {_SOURCE_RECEIPTS_KEY}; refusing to overwrite it",
        )
    tool_name = str(receipt["tool"])
    tool_receipts = all_receipts.get(tool_name)
    if tool_receipts is None:
        tool_receipts = {}
    elif not isinstance(tool_receipts, dict):
        raise ToolError(
            "state_corrupt",
            f"canonical source has invalid receipts for {tool_name}; refusing to overwrite them",
        )
    tool_receipts[str(receipt["decision_id"])] = deepcopy(receipt)
    all_receipts[tool_name] = tool_receipts
    source[_SOURCE_RECEIPTS_KEY] = all_receipts


def _new_source_receipt(
    *,
    tool_name: str,
    decision_id: str,
    operation: dict[str, Any],
    event: dict[str, Any],
    data: dict[str, Any],
    warnings: list[str] | None = None,
    hints: list[str] | None = None,
    entity_head: dict[str, Any],
) -> dict[str, Any]:
    receipt = {
        "schema_version": _SOURCE_RECEIPT_SCHEMA_VERSION,
        "tool": str(tool_name),
        "decision_id": str(decision_id),
        "fingerprint": _operation_fingerprint(tool_name, operation),
        "operation": deepcopy(operation),
        "event_id": event.get("event_id"),
        "event": deepcopy(event),
        "data": deepcopy(data),
        "warnings": list(warnings or []),
        "hints": list(hints or []),
        "entity_head": deepcopy(entity_head),
    }
    receipt[_SOURCE_RECEIPT_INTEGRITY_KEY] = _source_receipt_integrity(receipt)
    return receipt


def _validate_source_receipt(
    receipt: dict[str, Any],
    *,
    tool_name: str,
    decision_id: str,
    operation: dict[str, Any],
) -> None:
    # Validate the complete immutable receipt before comparing the requested
    # operation or performing any event/world/ledger repair.
    if (
        receipt.get("schema_version") != _SOURCE_RECEIPT_SCHEMA_VERSION
        or set(receipt) != set(_SOURCE_RECEIPT_FIELDS)
        or not isinstance(receipt.get("operation"), dict)
        or not isinstance(receipt.get("event"), dict)
        or not isinstance(receipt.get("data"), dict)
        or not isinstance(receipt.get("warnings"), list)
        or not isinstance(receipt.get("hints"), list)
        or str(receipt.get(_SOURCE_RECEIPT_INTEGRITY_KEY) or "")
        != _source_receipt_integrity(receipt)
    ):
        raise ToolError(
            "state_corrupt",
            f"source receipt for {tool_name} decision_id '{decision_id}' failed full integrity validation",
        )
    stored_operation = receipt.get("operation")
    stored_fingerprint = str(receipt.get("fingerprint") or "")
    stored_event = receipt.get("event")
    stable_event_id = _operation_event_id(tool_name, decision_id)
    if (
        str(receipt.get("tool")) != str(tool_name)
        or str(receipt.get("decision_id")) != str(decision_id)
        or stored_fingerprint
        != _operation_fingerprint(tool_name, stored_operation)
        or str(receipt.get("event_id") or "") != stable_event_id
        or not isinstance(stored_event, dict)
        or str(stored_event.get("event_id") or "") != stable_event_id
    ):
        raise ToolError(
            "state_corrupt",
            f"source receipt for {tool_name} decision_id '{decision_id}' is inconsistent",
        )
    expected = _operation_fingerprint(tool_name, operation)
    if stored_fingerprint != expected:
        raise ToolError(
            "idempotency_conflict",
            f"decision_id '{decision_id}' was already applied to a different {tool_name} payload",
        )
    head = receipt.get("entity_head")
    if (
        not coc_flag_state.valid_entity_head(head)
        or str(head.get("decision_id")) != str(decision_id)
        or str((receipt.get("event") or {}).get("live_head_digest") or "")
        != coc_flag_state.canonical_digest(head)
    ):
        raise ToolError(
            "state_corrupt",
            f"source receipt for {tool_name} decision_id '{decision_id}' has an invalid entity head",
        )


def _operation_event_present(ctx: Ctx, receipt: dict[str, Any]) -> bool:
    """Validate exact event cardinality without mutating the append-only log."""
    event = receipt.get("event")
    event_id = str(receipt.get("event_id") or "")
    if not isinstance(event, dict) or not event_id:
        raise ToolError("state_corrupt", "source receipt has no stable event payload")
    matches = [
        row
        for row in _read_jsonl_records(ctx.campaign_dir / "logs" / "events.jsonl")
        if str(row.get("event_id") or "") == event_id
    ]
    if matches:
        if len(matches) != 1 or matches[0] != event:
            raise ToolError(
                "state_corrupt",
                f"event '{event_id}' is duplicated or conflicts with its source receipt",
            )
        return True
    return False


def _pending_jsonl_rows(
    ctx: Ctx, relative_path: str, event_id: str
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    pending_dir = ctx.campaign_dir / "logs" / "pending-turns"
    if not pending_dir.is_dir():
        return rows
    for path in sorted(pending_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ToolError(
                "state_corrupt", f"pending recorder batch '{path.name}' is unreadable"
            ) from exc
        entries = payload.get("entries") if isinstance(payload, dict) else None
        if not isinstance(entries, list):
            raise ToolError(
                "state_corrupt", f"pending recorder batch '{path.name}' is invalid"
            )
        for entry in entries:
            if (
                isinstance(entry, dict)
                and entry.get("relative_path") == relative_path
                and isinstance(entry.get("record"), dict)
                and str(entry["record"].get("event_id") or "") == event_id
            ):
                rows.append(entry["record"])
    return rows


def _pending_event_rows(ctx: Ctx, event_id: str) -> list[dict[str, Any]]:
    return _pending_jsonl_rows(ctx, "logs/events.jsonl", event_id)


def _ensure_operation_event(
    ctx: Ctx,
    receipt: dict[str, Any],
    *,
    inspect_pending: bool = False,
) -> bool:
    """Append a receipt-owned event once, repairing a pre-ledger crash."""
    if not _stored_toolbox_receipt_valid(receipt):
        raise ToolError("state_corrupt", "source receipt integrity failed")
    event = receipt.get("event")
    assert isinstance(event, dict)
    return _materialize_stable_receipt_event(
        ctx,
        event=event,
        event_id=str(receipt.get("event_id") or ""),
        inspect_pending=inspect_pending,
    )


def _replay_source_receipt(
    ctx: Ctx,
    receipt: dict[str, Any],
) -> tuple[dict[str, Any], list[str], list[str]]:
    """Repair append/ledger stages while preserving the original result."""
    _ensure_operation_event(ctx, receipt)
    data = deepcopy(receipt.get("data") or {})
    ledger_entry = ctx.ledger_lookup(
        str(receipt["tool"]), str(receipt["decision_id"])
    )
    manifest = _source_receipt_manifest(receipt)
    if (
        ledger_entry is None
        or ledger_entry.get("data") != data
        or ledger_entry.get("source_receipt_manifest") != manifest
    ):
        ctx.ledger_record(
            str(receipt["decision_id"]),
            str(receipt["tool"]),
            data,
            source_receipt_manifest=manifest,
        )
    warnings = list(receipt.get("warnings") or [])
    warnings.append(
        "duplicate decision_id: recovered the original source-of-truth receipt"
    )
    return data, warnings, list(receipt.get("hints") or [])


def _validated_receipt_entity_head(
    receipt: dict[str, Any],
    *,
    entity_kind: str,
    entity_id: str,
) -> dict[str, Any]:
    """Return the entity head from a current schema-v3 receipt."""
    head = receipt.get("entity_head")
    if not coc_flag_state.valid_entity_head(
        head, entity_kind=entity_kind, entity_id=entity_id
    ):
        raise ToolError("state_corrupt", "source receipt has an invalid entity head")
    return deepcopy(head)


def _stored_toolbox_receipt_valid(receipt: Any) -> bool:
    if (
        not isinstance(receipt, dict)
        or receipt.get("schema_version") != _SOURCE_RECEIPT_SCHEMA_VERSION
        or set(receipt) != set(_SOURCE_RECEIPT_FIELDS)
        or str(receipt.get(_SOURCE_RECEIPT_INTEGRITY_KEY) or "")
        != _source_receipt_integrity(receipt)
        or not isinstance(receipt.get("operation"), dict)
    ):
        return False
    head = receipt.get("entity_head")
    event = receipt.get("event")
    return bool(
        coc_flag_state.valid_entity_head(head)
        and isinstance(event, dict)
        and str(receipt.get("event_id") or "")
        == _operation_event_id(
            str(receipt.get("tool") or ""), str(receipt.get("decision_id") or "")
        )
        and str(event.get("event_id") or "") == str(receipt.get("event_id") or "")
        and str(event.get("live_head_digest") or "")
        == coc_flag_state.canonical_digest(head)
        and str(head.get("decision_id") or "")
        == str(receipt.get("decision_id") or "")
    )


def _npc_presence_record_valid(
    record: Any, *, npc_id: str | None = None
) -> bool:
    if (
        not isinstance(record, dict)
        or set(record) != set(_NPC_PRESENCE_RECORD_FIELDS)
        or record.get("schema_version") != _NPC_PRESENCE_SCHEMA_VERSION
        or not isinstance(record.get("npc_id"), str)
        or not str(record.get("npc_id") or "").strip()
        or not isinstance(record.get("scene_id"), str)
        or not str(record.get("scene_id") or "").strip()
        or record.get("status") not in {"present", "absent"}
        or not isinstance(record.get("reason"), str)
        or not str(record.get("reason") or "").strip()
        or not isinstance(record.get("revision"), int)
        or isinstance(record.get("revision"), bool)
        or int(record.get("revision") or 0) < 1
        or not isinstance(record.get("changed_at"), str)
        or not str(record.get("changed_at") or "").strip()
        or not isinstance(record.get("decision_id"), str)
        or not str(record.get("decision_id") or "").strip()
        or not isinstance(record.get("source_sequence"), int)
        or isinstance(record.get("source_sequence"), bool)
        or int(record.get("source_sequence") or 0) < 1
        or record.get("producer") != "state.npc_presence"
    ):
        return False
    return npc_id is None or str(record["npc_id"]) == str(npc_id)


def _load_npc_presence_document(ctx: Ctx) -> dict[str, Any]:
    """Load the presence namespace that shares canonical npc-state.json.

    Persona cards and psychology retain their existing ownership.  Presence is
    an explicit live overlay: engagement history is never treated as proof
    that an NPC is still in a scene.
    """
    document = coc_npc_state.load_npc_state(ctx.campaign_dir)
    for key, default in (
        ("presence", {}),
        ("presence_heads", {}),
        ("presence_source_sequence", 0),
        (_SOURCE_RECEIPTS_KEY, {}),
    ):
        if key not in document:
            document[key] = deepcopy(default)
    if not isinstance(document.get("presence"), dict):
        raise ToolError("state_corrupt", "npc-state presence map is invalid")
    if not isinstance(document.get("presence_heads"), dict):
        raise ToolError("state_corrupt", "npc-state presence head map is invalid")
    sequence = document.get("presence_source_sequence")
    if not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 0:
        raise ToolError("state_corrupt", "npc-state presence source sequence is invalid")
    all_receipts = document.get(_SOURCE_RECEIPTS_KEY)
    if not isinstance(all_receipts, dict):
        raise ToolError("state_corrupt", "npc-state operation receipt map is invalid")
    presence_receipts = all_receipts.get("state.npc_presence", {})
    if not isinstance(presence_receipts, dict):
        raise ToolError("state_corrupt", "npc-state presence receipt map is invalid")
    for key, record in document["presence"].items():
        if not _npc_presence_record_valid(record, npc_id=str(key)):
            raise ToolError(
                "state_corrupt", f"npc presence record '{key}' is invalid"
            )
    for key, head in document["presence_heads"].items():
        if not coc_flag_state.valid_entity_head(
            head, entity_kind="npc_presence", entity_id=str(key)
        ):
            raise ToolError(
                "state_corrupt", f"npc presence head '{key}' is invalid"
            )
    return document


def _npc_presence_live_record(
    document: dict[str, Any], npc_id: str
) -> dict[str, Any]:
    presence = document.get("presence")
    presence = presence if isinstance(presence, dict) else {}
    record = presence.get(str(npc_id))
    return {
        "schema_version": _NPC_PRESENCE_SCHEMA_VERSION,
        "npc_id": str(npc_id),
        "record": deepcopy(record) if isinstance(record, dict) else None,
    }


def _npc_presence_receipts(document: dict[str, Any]) -> dict[str, Any]:
    receipts = (
        (document.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.npc_presence")
        or {}
    )
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "npc-state presence receipt map is invalid")
    return receipts


def _director_receipt_event_present(
    ctx: Ctx, receipt: dict[str, Any]
) -> bool:
    expected = receipt.get("event")
    event_id = str(receipt.get("event_id") or "")
    matches = [
        row
        for row in _read_jsonl_records(ctx.campaign_dir / "logs" / "events.jsonl")
        if str(row.get("event_id") or "") == event_id
    ]
    if matches and (len(matches) != 1 or matches[0] != expected):
        raise ToolError(
            "state_corrupt",
            f"director flag event '{event_id}' is duplicated or conflicts with its source receipt",
        )
    return bool(matches)


def _unique_max_head(
    heads: list[dict[str, Any]],
    *,
    entity_kind: str,
    entity_id: str,
) -> dict[str, Any] | None:
    if not heads:
        return None
    if any(
        not coc_flag_state.valid_entity_head(
            head, entity_kind=entity_kind, entity_id=entity_id
        )
        for head in heads
    ):
        raise ToolError("state_corrupt", "anchored entity head is invalid")
    maximum = max(int(head["source_sequence"]) for head in heads)
    candidates = [head for head in heads if int(head["source_sequence"]) == maximum]
    unique = {
        coc_flag_state.canonical_digest(head): deepcopy(head) for head in candidates
    }
    if len(unique) != 1:
        raise ToolError(
            "state_corrupt",
            f"{entity_kind} '{entity_id}' has conflicting source heads at sequence {maximum}",
        )
    return next(iter(unique.values()))


def _anchored_npc_presence_heads(
    ctx: Ctx,
    document: dict[str, Any],
    *,
    npc_id: str,
    require_event: bool = True,
) -> list[dict[str, Any]]:
    heads: list[dict[str, Any]] = []
    for receipt in _npc_presence_receipts(document).values():
        if (
            not isinstance(receipt, dict)
            or not _stored_toolbox_receipt_valid(receipt)
            or receipt.get("tool") != "state.npc_presence"
        ):
            raise ToolError("state_corrupt", "canonical NPC presence receipt is invalid")
        head = receipt["entity_head"]
        if str(head.get("entity_id") or "") != str(npc_id):
            continue
        present = _operation_event_present(ctx, receipt)
        if require_event and not present:
            continue
        heads.append(deepcopy(head))
    return heads


def _latest_anchored_npc_presence_head(
    ctx: Ctx,
    document: dict[str, Any],
    npc_id: str,
    *,
    require_event: bool = True,
) -> dict[str, Any] | None:
    return _unique_max_head(
        _anchored_npc_presence_heads(
            ctx, document, npc_id=npc_id, require_event=require_event
        ),
        entity_kind="npc_presence",
        entity_id=str(npc_id),
    )


def _anchored_flag_heads(
    ctx: Ctx,
    flags: dict[str, Any],
    *,
    flag_id: str,
    require_event: bool = True,
) -> list[dict[str, Any]]:
    heads: list[dict[str, Any]] = []
    receipts = ((flags.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.set_flag") or {})
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "canonical flag receipt map is invalid")
    for receipt in receipts.values():
        if not isinstance(receipt, dict):
            raise ToolError("state_corrupt", "canonical flag receipt is invalid")
        if receipt.get("schema_version") != _SOURCE_RECEIPT_SCHEMA_VERSION:
            raise ToolError("state_corrupt", "canonical flag receipt schema is unsupported")
        if not _stored_toolbox_receipt_valid(receipt) or receipt.get("tool") != "state.set_flag":
            raise ToolError("state_corrupt", "canonical flag receipt integrity failed")
        head = receipt["entity_head"]
        if str(head.get("entity_id") or "") != flag_id:
            continue
        present = _operation_event_present(ctx, receipt)
        if require_event and not present:
            continue
        heads.append(deepcopy(head))
    director_receipts = flags.get(coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY) or {}
    if not coc_flag_state.valid_director_flag_receipt_map(director_receipts):
        raise ToolError("state_corrupt", "canonical director flag receipt map is invalid")
    for receipt in director_receipts.values():
        if str(receipt.get("flag_id") or "") != flag_id:
            continue
        present = _director_receipt_event_present(ctx, receipt)
        if require_event and not present:
            continue
        heads.append(deepcopy(receipt["entity_head"]))
    return heads


def _anchored_marker_heads(
    ctx: Ctx,
    payload: dict[str, Any],
    *,
    marker_id: str,
    require_event: bool = True,
) -> list[dict[str, Any]]:
    heads: list[dict[str, Any]] = []
    receipts = (
        (payload.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.time_marker") or {}
    )
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "canonical marker receipt map is invalid")
    for receipt in receipts.values():
        if not isinstance(receipt, dict):
            raise ToolError("state_corrupt", "canonical marker receipt is invalid")
        if receipt.get("schema_version") != _SOURCE_RECEIPT_SCHEMA_VERSION:
            raise ToolError("state_corrupt", "canonical marker receipt schema is unsupported")
        if not _stored_toolbox_receipt_valid(receipt) or receipt.get("tool") != "state.time_marker":
            raise ToolError("state_corrupt", "canonical marker receipt integrity failed")
        head = receipt["entity_head"]
        if str(head.get("entity_id") or "") != marker_id:
            continue
        present = _operation_event_present(ctx, receipt)
        if require_event and not present:
            continue
        heads.append(deepcopy(head))
    return heads


def _latest_anchored_flag_head(
    ctx: Ctx, flags: dict[str, Any], flag_id: str, *, require_event: bool = True
) -> dict[str, Any] | None:
    return _unique_max_head(
        _anchored_flag_heads(
            ctx, flags, flag_id=flag_id, require_event=require_event
        ),
        entity_kind="flag",
        entity_id=flag_id,
    )


def _latest_anchored_marker_head(
    ctx: Ctx, payload: dict[str, Any], marker_id: str, *, require_event: bool = True
) -> dict[str, Any] | None:
    return _unique_max_head(
        _anchored_marker_heads(
            ctx, payload, marker_id=marker_id, require_event=require_event
        ),
        entity_kind="time_marker",
        entity_id=marker_id,
    )


def _flag_head_is_source_anchored(
    ctx: Ctx, flags: dict[str, Any], head: dict[str, Any]
) -> bool:
    receipts = ((flags.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.set_flag") or {})
    if isinstance(receipts, dict):
        for receipt in receipts.values():
            if (
                _stored_toolbox_receipt_valid(receipt)
                and receipt.get("tool") == "state.set_flag"
                and receipt.get("entity_head") == head
            ):
                _operation_event_present(ctx, receipt)
                return True
    director_receipts = flags.get(coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY) or {}
    if not coc_flag_state.valid_director_flag_receipt_map(director_receipts):
        return False
    for receipt in director_receipts.values():
        if receipt.get("entity_head") == head:
            _director_receipt_event_present(ctx, receipt)
            return True
    return False


def _flag_event_is_source_anchored(
    ctx: Ctx, flags: dict[str, Any], event: dict[str, Any]
) -> bool:
    receipts = ((flags.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.set_flag") or {})
    if isinstance(receipts, dict):
        for receipt in receipts.values():
            if (
                _stored_toolbox_receipt_valid(receipt)
                and receipt.get("tool") == "state.set_flag"
                and receipt.get("event") == event
            ):
                _operation_event_present(ctx, receipt)
                return True
    director_receipts = flags.get(coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY) or {}
    if not coc_flag_state.valid_director_flag_receipt_map(director_receipts):
        return False
    for receipt in director_receipts.values():
        if receipt.get("event") == event:
            _director_receipt_event_present(ctx, receipt)
            return True
    return False


def _marker_head_is_source_anchored(
    ctx: Ctx, payload: dict[str, Any], head: dict[str, Any]
) -> bool:
    receipts = (
        (payload.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.time_marker") or {}
    )
    if not isinstance(receipts, dict):
        return False
    for receipt in receipts.values():
        if (
            _stored_toolbox_receipt_valid(receipt)
            and receipt.get("tool") == "state.time_marker"
            and receipt.get("entity_head") == head
        ):
            _operation_event_present(ctx, receipt)
            return True
    return False


def _repair_flag_live_head(
    ctx: Ctx,
    flags: dict[str, Any],
    receipt: dict[str, Any],
) -> None:
    operation = receipt.get("operation") or {}
    flag_id = str(operation.get("flag_id") or "")
    target = _validated_receipt_entity_head(
        receipt, entity_kind="flag", entity_id=flag_id
    )
    if target is None:
        return
    if (
        str(target.get("producer")) != "state.set_flag"
        or str(target.get("decision_id")) != str(receipt.get("decision_id"))
        or (target.get("live_record") or {}).get("value")
        != bool(operation.get("value"))
    ):
        raise ToolError("state_corrupt", "flag receipt head is inconsistent")

    head_map = flags.get("flag_heads")
    if head_map is None:
        head_map = {}
        flags["flag_heads"] = head_map
    if not isinstance(head_map, dict):
        raise ToolError("state_corrupt", "canonical flag head map is invalid")
    expected_head = _latest_anchored_flag_head(
        ctx, flags, flag_id, require_event=False
    )
    if expected_head is None:
        expected_head = target
    causal_sequence = int(expected_head["source_sequence"])
    current_head = head_map.get(flag_id)
    if current_head is not None and current_head != expected_head:
        raise ToolError(
            "state_corrupt",
            f"flag '{flag_id}' live head does not equal its unique latest source receipt",
        )

    expected_record = deepcopy(expected_head["live_record"])
    actual_record = coc_flag_state.flag_live_record(flags, flag_id)
    changed = False
    if actual_record != expected_record:
        if actual_record.get("present") is True:
            raise ToolError(
                "state_corrupt", f"flag '{flag_id}' live value conflicts with its causal head"
            )
        try:
            coc_flag_state.apply_live_record(flags, expected_record)
        except ValueError as exc:
            raise ToolError("state_corrupt", str(exc)) from exc
        changed = True
    if current_head != expected_head:
        head_map[flag_id] = deepcopy(expected_head)
        changed = True
    if changed:
        flags["schema_version"] = max(int(flags.get("schema_version") or 1), 3)
        flags["flag_source_sequence"] = max(
            int(flags.get("flag_source_sequence") or 0), causal_sequence
        )
        ctx.save_flags(flags)


def _marker_live_record(payload: dict[str, Any], marker_id: str) -> dict[str, Any]:
    markers = payload.get("markers")
    markers = markers if isinstance(markers, dict) else {}
    present = str(marker_id) in markers
    marker = markers.get(str(marker_id))
    return {
        "schema_version": 1,
        "marker_id": str(marker_id),
        "present": present,
        "marker": deepcopy(marker) if isinstance(marker, dict) else None,
    }


def _apply_marker_live_record(
    payload: dict[str, Any], record: dict[str, Any]
) -> None:
    marker_id = str(record.get("marker_id") or "")
    if not marker_id or record.get("schema_version") != 1:
        raise ToolError("state_corrupt", "invalid marker live record")
    markers = payload.get("markers")
    if not isinstance(markers, dict):
        raise ToolError("state_corrupt", "canonical marker map is invalid")
    if record.get("present") is True and isinstance(record.get("marker"), dict):
        markers[marker_id] = deepcopy(record["marker"])
    elif record.get("present") is False and record.get("marker") is None:
        markers.pop(marker_id, None)
    else:
        raise ToolError("state_corrupt", "invalid marker live record presence")


def _repair_marker_live_head(
    ctx: Ctx,
    payload: dict[str, Any],
    receipt: dict[str, Any],
) -> None:
    operation = receipt.get("operation") or {}
    marker_id = str(operation.get("marker_id") or "")
    target = _validated_receipt_entity_head(
        receipt, entity_kind="time_marker", entity_id=marker_id
    )
    if target is None:
        return
    if (
        str(target.get("producer")) != "state.time_marker"
        or str(target.get("decision_id")) != str(receipt.get("decision_id"))
    ):
        raise ToolError("state_corrupt", "time marker receipt head is inconsistent")

    head_map = payload.get("marker_heads")
    if not isinstance(head_map, dict):
        raise ToolError("state_corrupt", "canonical marker head map is invalid")
    expected_head = _latest_anchored_marker_head(
        ctx, payload, marker_id, require_event=False
    )
    if expected_head is None:
        expected_head = target
    causal_sequence = int(expected_head["source_sequence"])
    current_head = head_map.get(marker_id)
    if current_head is not None and current_head != expected_head:
        raise ToolError(
            "state_corrupt",
            f"time marker '{marker_id}' live head does not equal its unique latest source receipt",
        )

    expected_record = deepcopy(expected_head["live_record"])
    actual_record = _marker_live_record(payload, marker_id)
    changed = False
    if actual_record != expected_record:
        if actual_record.get("present") is True:
            raise ToolError(
                "state_corrupt",
                f"time marker '{marker_id}' live record conflicts with its causal head",
            )
        _apply_marker_live_record(payload, expected_record)
        changed = True
    if current_head != expected_head:
        head_map[marker_id] = deepcopy(expected_head)
        changed = True
    if changed:
        payload["schema_version"] = max(int(payload.get("schema_version") or 1), 3)
        payload["marker_source_sequence"] = max(
            int(payload.get("marker_source_sequence") or 0), causal_sequence
        )
        _save_time_markers(ctx, payload)


def _flag_receipt_rows(flags: dict[str, Any]) -> list[tuple[int, str, dict[str, Any]]]:
    rows: list[tuple[int, str, dict[str, Any]]] = []
    toolbox = ((flags.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.set_flag") or {})
    if not isinstance(toolbox, dict):
        raise ToolError("state_corrupt", "canonical flag receipt map is invalid")
    for receipt in toolbox.values():
        if not isinstance(receipt, dict):
            raise ToolError("state_corrupt", "canonical flag receipt is invalid")
        if receipt.get("schema_version") != _SOURCE_RECEIPT_SCHEMA_VERSION:
            raise ToolError("state_corrupt", "canonical flag receipt schema is unsupported")
        if not _stored_toolbox_receipt_valid(receipt):
            raise ToolError("state_corrupt", "canonical flag receipt integrity failed")
        rows.append(
            (int(receipt["entity_head"]["source_sequence"]), "toolbox", receipt)
        )
    director = flags.get(coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY) or {}
    if not coc_flag_state.valid_director_flag_receipt_map(director):
        raise ToolError("state_corrupt", "canonical director flag receipt map is invalid")
    for receipt in director.values():
        rows.append(
            (int(receipt["entity_head"]["source_sequence"]), "director", receipt)
        )
    return sorted(rows, key=lambda item: (item[0], str(item[2].get("event_id") or "")))


def _reconcile_all_flag_source_receipts(ctx: Ctx, flags: dict[str, Any]) -> None:
    """Repair every current flag receipt before a new decision can allocate."""
    entity_ids: set[str] = set()
    for _sequence, kind, receipt in _flag_receipt_rows(flags):
        if kind == "toolbox":
            _ensure_operation_event(ctx, receipt, inspect_pending=True)
            manifest = _source_receipt_manifest(receipt)
            prior = ctx.ledger_lookup("state.set_flag", str(receipt["decision_id"]))
            if (
                prior is None
                or prior.get("data") != receipt.get("data")
                or prior.get("source_receipt_manifest") != manifest
            ):
                ctx.ledger_record(
                    str(receipt["decision_id"]),
                    "state.set_flag",
                    deepcopy(receipt.get("data") or {}),
                    source_receipt_manifest=manifest,
                )
            entity_ids.add(str(receipt["entity_head"]["entity_id"]))
            continue
        event = receipt["event"]
        event_id = str(receipt["event_id"])
        _materialize_stable_receipt_event(
            ctx,
            event=event,
            event_id=event_id,
        )
        entity_ids.add(str(receipt["entity_head"]["entity_id"]))

    flag_map = flags.get("flags") or {}
    provenance_map = flags.get("flag_provenance") or {}
    head_map = flags.get("flag_heads") or {}
    if not all(
        isinstance(value, dict)
        for value in (flag_map, provenance_map, head_map)
    ):
        raise ToolError("state_corrupt", "canonical flag maps are invalid")
    if set(provenance_map) - set(flag_map):
        raise ToolError("state_corrupt", "canonical flag provenance has orphan entries")
    entity_ids.update(str(flag_id) for flag_id in flag_map)
    entity_ids.update(str(flag_id) for flag_id in head_map)
    for flag_id in entity_ids:
        expected = _latest_anchored_flag_head(ctx, flags, flag_id)
        current = head_map.get(flag_id)
        if expected is None:
            raise ToolError(
                "state_corrupt",
                f"flag '{flag_id}' has no current source receipt anchor",
            )
        if current != expected:
            raise ToolError(
                "state_corrupt",
                f"flag '{flag_id}' current head does not match its unique latest anchored receipt",
            )
        actual = coc_flag_state.flag_live_record(flags, flag_id)
        if actual != expected["live_record"]:
            if actual.get("present") is True:
                raise ToolError(
                    "state_corrupt",
                    f"flag '{flag_id}' current value does not match its anchored head",
                )
            try:
                coc_flag_state.apply_live_record(flags, expected["live_record"])
            except ValueError as exc:
                raise ToolError("state_corrupt", str(exc)) from exc
            ctx.save_flags(flags)


def _reconcile_all_marker_source_receipts(
    ctx: Ctx, payload: dict[str, Any]
) -> None:
    receipts = (
        (payload.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.time_marker") or {}
    )
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "canonical marker receipt map is invalid")
    ordered: list[dict[str, Any]] = []
    for receipt in receipts.values():
        if not isinstance(receipt, dict):
            raise ToolError("state_corrupt", "canonical marker receipt is invalid")
        if receipt.get("schema_version") != _SOURCE_RECEIPT_SCHEMA_VERSION:
            raise ToolError("state_corrupt", "canonical marker receipt schema is unsupported")
        if not _stored_toolbox_receipt_valid(receipt):
            raise ToolError("state_corrupt", "canonical marker receipt integrity failed")
        ordered.append(receipt)
    ordered.sort(
        key=lambda receipt: (
            int(receipt["entity_head"]["source_sequence"]),
            str(receipt.get("event_id") or ""),
        )
    )
    entity_ids: set[str] = set()
    for receipt in ordered:
        _ensure_operation_event(ctx, receipt, inspect_pending=True)
        manifest = _source_receipt_manifest(receipt)
        prior = ctx.ledger_lookup("state.time_marker", str(receipt["decision_id"]))
        if (
            prior is None
            or prior.get("data") != receipt.get("data")
            or prior.get("source_receipt_manifest") != manifest
        ):
            ctx.ledger_record(
                str(receipt["decision_id"]),
                "state.time_marker",
                deepcopy(receipt.get("data") or {}),
                source_receipt_manifest=manifest,
            )
        entity_ids.add(str(receipt["entity_head"]["entity_id"]))
    markers = payload.get("markers") or {}
    head_map = payload.get("marker_heads") or {}
    if not isinstance(markers, dict) or not isinstance(head_map, dict):
        raise ToolError("state_corrupt", "canonical time marker maps are invalid")
    entity_ids.update(str(marker_id) for marker_id in markers)
    entity_ids.update(str(marker_id) for marker_id in head_map)
    for marker_id in entity_ids:
        expected = _latest_anchored_marker_head(ctx, payload, marker_id)
        current = head_map.get(marker_id)
        if expected is None:
            raise ToolError(
                "state_corrupt",
                f"time marker '{marker_id}' has no current source receipt anchor",
            )
        if current != expected:
            raise ToolError(
                "state_corrupt",
                f"time marker '{marker_id}' current head does not match its unique latest anchored receipt",
            )
        actual = _marker_live_record(payload, marker_id)
        if actual != expected["live_record"]:
            if actual.get("present") is True:
                raise ToolError(
                    "state_corrupt",
                    f"time marker '{marker_id}' current record does not match its anchored head",
                )
            _apply_marker_live_record(payload, expected["live_record"])
            _save_time_markers(ctx, payload)


def _reconcile_all_npc_presence_source_receipts(ctx: Ctx) -> None:
    """Finish durable presence receipts and verify their one live head.

    The presence record, head, and receipt share one atomic npc-state write;
    only append-only event and ledger materialization can remain after a
    crash.  A missing or divergent live record is therefore corruption, not
    an invitation to infer presence from engagement history.
    """
    document = _load_npc_presence_document(ctx)
    receipts = _npc_presence_receipts(document)
    ordered: list[dict[str, Any]] = []
    for receipt in receipts.values():
        if (
            not isinstance(receipt, dict)
            or not _stored_toolbox_receipt_valid(receipt)
            or receipt.get("tool") != "state.npc_presence"
        ):
            raise ToolError("state_corrupt", "canonical NPC presence receipt is invalid")
        operation = receipt.get("operation") or {}
        npc_id = str(operation.get("npc_id") or "")
        _validate_source_receipt(
            receipt,
            tool_name="state.npc_presence",
            decision_id=str(receipt.get("decision_id") or ""),
            operation=operation,
        )
        _validated_receipt_entity_head(
            receipt, entity_kind="npc_presence", entity_id=npc_id
        )
        ordered.append(receipt)
    ordered.sort(
        key=lambda receipt: (
            int(receipt["entity_head"]["source_sequence"]),
            str(receipt.get("event_id") or ""),
        )
    )
    for receipt in ordered:
        _ensure_operation_event(ctx, receipt, inspect_pending=True)
        manifest = _source_receipt_manifest(receipt)
        prior = ctx.ledger_lookup(
            "state.npc_presence", str(receipt["decision_id"])
        )
        if (
            prior is None
            or prior.get("data") != receipt.get("data")
            or prior.get("source_receipt_manifest") != manifest
        ):
            ctx.ledger_record(
                str(receipt["decision_id"]),
                "state.npc_presence",
                deepcopy(receipt.get("data") or {}),
                source_receipt_manifest=manifest,
            )

    presence = document["presence"]
    head_map = document["presence_heads"]
    entity_ids = {str(value) for value in presence} | {
        str(value) for value in head_map
    }
    max_sequence = 0
    for receipt in ordered:
        max_sequence = max(
            max_sequence, int(receipt["entity_head"]["source_sequence"])
        )
        entity_ids.add(str(receipt["entity_head"]["entity_id"]))
    if int(document["presence_source_sequence"]) != max_sequence:
        raise ToolError(
            "state_corrupt",
            "npc presence source sequence does not match its durable receipts",
        )
    for npc_id in entity_ids:
        expected = _latest_anchored_npc_presence_head(
            ctx, document, npc_id
        )
        if expected is None:
            raise ToolError(
                "state_corrupt",
                f"npc presence '{npc_id}' has no source receipt anchor",
            )
        if head_map.get(npc_id) != expected:
            raise ToolError(
                "state_corrupt",
                f"npc presence '{npc_id}' live head is not its latest receipt",
            )
        if _npc_presence_live_record(document, npc_id) != expected["live_record"]:
            raise ToolError(
                "state_corrupt",
                f"npc presence '{npc_id}' live record conflicts with its causal head",
            )


def _reconcile_all_canonical_source_receipts(ctx: Ctx) -> None:
    """Finish every durable source receipt before any later mutation.

    A host is allowed to continue after a tool failure.  Consequently recovery
    cannot depend on it retrying the same decision id: the next mutating tool
    repairs all receipt-owned event and ledger stages while the campaign lock
    is held.  This is transactional integrity, not a narration gate.
    """
    _reconcile_all_roll_source_receipts(ctx)

    flags = ctx.flags()
    _reconcile_all_flag_source_receipts(ctx, flags)

    if _time_markers_path(ctx).is_file():
        markers = _load_time_markers(ctx)
        _reconcile_all_marker_source_receipts(ctx, markers)

    if _npc_receipt_path(ctx).is_file():
        _reconcile_all_npc_source_receipts(ctx)

    if (ctx.campaign_dir / "save" / "npc-state.json").is_file():
        _reconcile_all_npc_presence_source_receipts(ctx)


def reconcile_campaign_continuity(
    campaign_dir: Path | str,
    *,
    ctx: Ctx | None = None,
    domains: tuple[str, ...] | list[str] | set[str] | None = None,
) -> None:
    """Complete every durable continuity receipt at a turn/read boundary.

    Callers must hold the campaign lock.  Toolbox dispatch passes its existing
    context; the live-turn and Director apply entrypoints construct an
    equivalent context for the same canonical preflight.  Repair is limited to
    already-committed source receipts and therefore does not impose a
    narrative eligibility gate.
    """
    campaign = Path(campaign_dir)
    if ctx is None:
        ctx = object.__new__(Ctx)
        ctx.root = campaign.parent
        ctx.coc_root = (
            campaign.parents[1]
            if campaign.parent.name == "campaigns"
            else campaign.parent
        )
        ctx.campaign_id = coc_npc_event_chain.resolve_campaign_id(campaign)
        ctx.campaign_dir = campaign
        ctx._scenario_cache = {}
        ctx._roll_ids = None
        ctx._roll_sequence = 0
    elif Path(ctx.campaign_dir) != campaign:
        raise ToolError(
            "state_corrupt",
            "continuity preflight context does not match its campaign directory",
        )
    selected = (
        {"rolls", "flags", "time_markers", "npc", "npc_presence"}
        if domains is None
        else {str(value) for value in domains}
    )
    unknown = selected - {
        "rolls", "flags", "time_markers", "npc", "npc_presence",
    }
    if unknown:
        raise ToolError(
            "invalid_request",
            "unknown continuity recovery domain(s): " + ", ".join(sorted(unknown)),
        )
    if "rolls" in selected:
        _reconcile_all_roll_source_receipts(ctx)
    if "flags" in selected:
        flags = ctx.flags()
        _reconcile_all_flag_source_receipts(ctx, flags)
    if "time_markers" in selected and _time_markers_path(ctx).is_file():
        markers = _load_time_markers(ctx)
        _reconcile_all_marker_source_receipts(ctx, markers)
    if "npc" in selected and _npc_receipt_path(ctx).is_file():
        _reconcile_all_npc_source_receipts(ctx)
    if (
        "npc_presence" in selected
        and (ctx.campaign_dir / "save" / "npc-state.json").is_file()
    ):
        _reconcile_all_npc_presence_source_receipts(ctx)


def _positive_source_sequence(value: Any) -> int | None:
    return coc_flag_state.positive_sequence(value)


def _next_flag_source_sequence(ctx: Ctx, flags: dict[str, Any]) -> int:
    """Allocate the next sequence from current source-owned receipts only."""
    stored = flags.get("flag_source_sequence")
    if (
        not isinstance(stored, int)
        or isinstance(stored, bool)
        or stored < 0
    ):
        raise ToolError("state_corrupt", "invalid flag_source_sequence counter")
    anchored: list[int] = []
    for sequence, _kind, receipt in _flag_receipt_rows(flags):
        if receipt.get("schema_version") == _SOURCE_RECEIPT_SCHEMA_VERSION:
            _operation_event_present(ctx, receipt)
        else:
            _director_receipt_event_present(ctx, receipt)
        anchored.append(sequence)
    if anchored:
        anchored_max = max(anchored)
        if stored != anchored_max:
            raise ToolError(
                "state_corrupt",
                "flag source counter is not anchored to the latest current receipt",
            )
        return anchored_max + 1
    if stored != 0:
        raise ToolError(
            "state_corrupt",
            "flag source counter has no current source receipt anchor",
        )
    return 1


def _world_flag_continuity(ctx: Ctx) -> dict[str, list[dict[str, Any]]]:
    """Project only current, source-anchored flag state and events."""
    flags_doc = ctx.flags()
    flag_map = flags_doc["flags"]
    head_map = flags_doc["flag_heads"]
    changes: list[dict[str, Any]] = []
    for _sequence, kind, receipt in _flag_receipt_rows(flags_doc):
        present = (
            _operation_event_present(ctx, receipt)
            if kind == "toolbox"
            else _director_receipt_event_present(ctx, receipt)
        )
        if not present:
            continue
        head = receipt["entity_head"]
        live_record = head["live_record"]
        provenance = deepcopy(live_record.get("provenance"))
        if not isinstance(provenance, dict):
            raise ToolError("state_corrupt", "current flag receipt has no provenance")
        provenance["integrity_status"] = "source_anchored"
        provenance["order_epoch"] = "sequenced-v1"
        changes.append({
            "flag_id": str(head["entity_id"]),
            "value": live_record.get("value"),
            "provenance": provenance,
        })

    live: list[dict[str, Any]] = []
    for flag_id, value in sorted(flag_map.items(), key=lambda pair: str(pair[0])):
        if type(value) is not bool:
            raise ToolError("state_corrupt", "current flag value must be boolean")
        stable_id = str(flag_id)
        expected = _latest_anchored_flag_head(ctx, flags_doc, stable_id)
        actual_record = coc_flag_state.flag_live_record(flags_doc, stable_id)
        if (
            expected is None
            or head_map.get(stable_id) != expected
            or actual_record != expected.get("live_record")
        ):
            raise ToolError(
                "state_corrupt",
                f"flag '{stable_id}' has no unique current source receipt/event anchor",
            )
        provenance = deepcopy(expected["live_record"].get("provenance"))
        if not isinstance(provenance, dict):
            raise ToolError("state_corrupt", f"flag '{stable_id}' provenance is missing")
        provenance["integrity_status"] = "source_anchored"
        live.append({
            "flag_id": stable_id,
            "value": value,
            "present": True,
            "provenance": provenance,
        })
    if set(head_map) != {str(flag_id) for flag_id in flag_map}:
        raise ToolError("state_corrupt", "current flag head map has orphan entries")
    return {
        "live_world_flags": live,
        "unverified_world_flags": [],
        "recent_world_flag_changes": changes[-12:],
    }


def _time_markers_path(ctx: Ctx) -> Path:
    return ctx.campaign_dir / "save" / "time-markers.json"


_TIME_MARKER_DOCUMENT_SCHEMA_VERSION = 3
_TIME_MARKER_DOCUMENT_FIELDS = frozenset({
    "schema_version",
    "markers",
    "marker_heads",
    "marker_source_sequence",
    _SOURCE_RECEIPTS_KEY,
})


def _load_time_markers(ctx: Ctx) -> dict[str, Any]:
    path = _time_markers_path(ctx)
    if not path.is_file():
        return {
            "schema_version": _TIME_MARKER_DOCUMENT_SCHEMA_VERSION,
            "markers": {},
            "marker_heads": {},
            "marker_source_sequence": 0,
            _SOURCE_RECEIPTS_KEY: {},
        }
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ToolError(
            "state_corrupt",
            "save/time-markers.json is unreadable; refusing to replace it",
        ) from exc
    if (
        not isinstance(payload, dict)
        or set(payload) != set(_TIME_MARKER_DOCUMENT_FIELDS)
        or payload.get("schema_version") != _TIME_MARKER_DOCUMENT_SCHEMA_VERSION
        or not isinstance(payload.get("markers"), dict)
        or not isinstance(payload.get("marker_heads"), dict)
        or not isinstance(payload.get(_SOURCE_RECEIPTS_KEY), dict)
    ):
        raise ToolError(
            "state_corrupt",
            "save/time-markers.json does not match the current schema-v3 document",
        )
    markers = payload["markers"]
    marker_heads = payload["marker_heads"]
    for marker_id, head in marker_heads.items():
        if not coc_flag_state.valid_entity_head(
            head, entity_kind="time_marker", entity_id=str(marker_id)
        ):
            raise ToolError(
                "state_corrupt",
                f"save/time-markers.json has an invalid live head for marker '{marker_id}'",
            )
    marker_sequence = payload["marker_source_sequence"]
    if (
        not isinstance(marker_sequence, int)
        or isinstance(marker_sequence, bool)
        or marker_sequence < 0
    ):
        raise ToolError(
            "state_corrupt",
            "save/time-markers.json has an invalid marker_source_sequence",
        )
    receipts = payload[_SOURCE_RECEIPTS_KEY]
    for tool_name, tool_receipts in receipts.items():
        if tool_name != "state.time_marker" or not isinstance(tool_receipts, dict):
            raise ToolError(
                "state_corrupt",
                f"save/time-markers.json has invalid receipts for {tool_name}",
            )
        for decision_id, receipt in tool_receipts.items():
            if (
                not _stored_toolbox_receipt_valid(receipt)
                or receipt.get("tool") != tool_name
                or str(receipt.get("decision_id") or "") != str(decision_id)
            ):
                raise ToolError(
                    "state_corrupt",
                    f"save/time-markers.json has an invalid current receipt for {tool_name}",
                )
    return payload


def _save_time_markers(ctx: Ctx, payload: dict[str, Any]) -> None:
    coc_state.write_json_atomic(_time_markers_path(ctx), payload)


def _next_marker_source_sequence(ctx: Ctx, payload: dict[str, Any]) -> int:
    stored = payload.get("marker_source_sequence", 0)
    if stored not in (None, 0) and _positive_source_sequence(stored) is None:
        raise ToolError("state_corrupt", "invalid marker_source_sequence counter")
    # Collect every receipt head because this is one global marker allocator.
    anchored: list[int] = []
    receipts = ((payload.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.time_marker") or {})
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "canonical marker receipt map is invalid")
    for receipt in receipts.values():
        if not isinstance(receipt, dict):
            raise ToolError("state_corrupt", "canonical marker receipt is invalid")
        if receipt.get("schema_version") != _SOURCE_RECEIPT_SCHEMA_VERSION:
            raise ToolError("state_corrupt", "canonical marker receipt schema is unsupported")
        if (
            not _stored_toolbox_receipt_valid(receipt)
            or receipt.get("tool") != "state.time_marker"
        ):
            raise ToolError("state_corrupt", "canonical marker receipt integrity failed")
        _operation_event_present(ctx, receipt)
        anchored.append(int(receipt["entity_head"]["source_sequence"]))
    if anchored:
        anchored_max = max(anchored)
        if int(stored or 0) != anchored_max:
            raise ToolError(
                "state_corrupt",
                "marker source counter is not anchored to the latest valid receipt",
            )
        return anchored_max + 1
    if int(stored or 0) != 0:
        raise ToolError(
            "state_corrupt",
            "marker source counter has no current source receipt anchor",
        )
    return 1


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
            "producer": marker.get("producer"),
            "decision_id": marker.get("decision_id"),
            "source_sequence": marker.get("source_sequence"),
            "created_at": marker.get("created_at"),
            "updated_at": marker.get("updated_at"),
            "reason": marker.get("reason"),
            "integrity_status": "source_anchored",
        },
    }


def _active_time_markers(ctx: Ctx) -> list[dict[str, Any]]:
    current = coc_time.current_stamp(ctx.campaign_dir)
    payload = _load_time_markers(ctx)
    markers = payload.get("markers") or {}
    heads = payload.get("marker_heads") or {}
    if not isinstance(markers, dict) or not isinstance(heads, dict):
        raise ToolError("state_corrupt", "canonical time marker maps are invalid")
    active: list[dict[str, Any]] = []
    for marker_id, marker in markers.items():
        if not isinstance(marker, dict) or marker.get("status") != "active":
            continue
        stable_id = str(marker_id)
        expected = _latest_anchored_marker_head(ctx, payload, stable_id)
        current_head = heads.get(stable_id)
        if expected is None:
            if current_head is not None:
                raise ToolError(
                    "state_corrupt",
                    f"time marker '{stable_id}' has a typed head without an exact source receipt/event anchor",
                )
            raise ToolError(
                "state_corrupt",
                f"time marker '{stable_id}' has no current source receipt/event anchor",
            )
        live_record = _marker_live_record(payload, stable_id)
        if current_head != expected or expected.get("live_record") != live_record:
            raise ToolError(
                "state_corrupt",
                f"time marker '{stable_id}' current deadline does not equal its unique latest anchored receipt head",
            )
        active.append(_project_time_marker(marker, current))
    return sorted(
        active,
        key=lambda marker: (
            int((marker.get("due_at") or {}).get("elapsed_minutes") or 0),
            str(marker.get("marker_id") or ""),
        ),
    )


def _project_active_time_markers(
    payload: dict[str, Any],
    current: dict[str, Any],
) -> list[dict[str, Any]]:
    markers = payload.get("markers")
    if not isinstance(markers, dict):
        markers = {}
    active = [
        _project_time_marker(marker, current)
        for marker in markers.values()
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
    ctx: Ctx,
    investigator_id: str,
    *,
    character_snapshot: dict[str, Any],
) -> dict[str, Any]:
    """Project canonical structured combat inputs without reading prose."""
    sheet = character_snapshot
    state = ctx.inv_state(
        investigator_id, character_snapshot=character_snapshot
    )
    characteristics = sheet.get("characteristics") or {}
    skills = sheet.get("skills") or {}
    derived = sheet.get("derived") or {}
    damage = coc_rules.damage_bonus_build(
        int(characteristics.get("STR", 50)),
        int(characteristics.get("SIZ", 50)),
    )
    inventory = coc_inventory.normalize_inventory(state)
    weapons = coc_inventory.effective_weapons(sheet.get("weapons"), inventory)
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


def _player_mechanical_snapshot(ctx: Ctx, investigator_id: str) -> dict[str, Any]:
    state = ctx.inv_state(investigator_id)
    return {
        "investigator_id": investigator_id,
        "hp": state.get("current_hp"),
        "san": state.get("current_san"),
        "mp": state.get("current_mp"),
        "luck": state.get("current_luck"),
        "conditions": list(state.get("conditions") or []),
    }


def _loaded_ammunition_snapshot(
    combat: dict[str, Any],
    investigator_id: str,
    profile: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    participants = combat.get("participants") or []
    if isinstance(participants, dict):
        participant = participants.get(investigator_id)
    elif isinstance(participants, list):
        participant = next(
            (
                row for row in participants
                if isinstance(row, dict) and row.get("actor_id") == investigator_id
            ),
            None,
        )
    else:
        participant = None
    participant = participant if isinstance(participant, dict) else {}
    ammo_map = participant.get("_ammo")
    ammo_map = ammo_map if isinstance(ammo_map, dict) else {}
    weapons = participant.get("weapons")
    if not isinstance(weapons, list) or not weapons:
        weapons = profile.get("weapons") or []
    catalog = combat.get("weapon_catalog")
    if not isinstance(catalog, dict):
        catalog = coc_subsystem_executor.coc_combat.load_weapon_catalog()
    snapshot: dict[str, dict[str, Any]] = {}
    for raw in weapons:
        override = raw if isinstance(raw, dict) else {"weapon_id": raw}
        weapon_id = coc_inventory.weapon_ref_id(override)
        weapon = deepcopy((catalog or {}).get(weapon_id) or {})
        weapon.update(override)
        magazine = weapon.get("magazine")
        if weapon_id is None or isinstance(magazine, bool) or not isinstance(magazine, int):
            continue
        loaded = ammo_map.get(weapon_id, magazine)
        if isinstance(loaded, bool) or not isinstance(loaded, int):
            raise ToolError(
                "state_corrupt", f"loaded ammunition for '{weapon_id}' is invalid"
            )
        snapshot[weapon_id] = {
            "weapon_id": weapon_id,
            "weapon_label": str(
                weapon.get("label")
                or weapon.get("name")
                or weapon.get("display_name")
                or weapon_id
            ),
            "loaded": loaded,
        }
    return snapshot


def _player_state_receipt(
    before: dict[str, Any],
    after: dict[str, Any],
    *,
    ammo_before: dict[str, dict[str, Any]] | None = None,
    ammo_after: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    receipt = {
        "schema_version": 1,
        "investigator_id": str(before["investigator_id"]),
        "hp": {"before": before.get("hp"), "after": after.get("hp")},
        "san": {"before": before.get("san"), "after": after.get("san")},
        "mp": {"before": before.get("mp"), "after": after.get("mp")},
        "luck": {"before": before.get("luck"), "after": after.get("luck")},
        "conditions_before": list(before.get("conditions") or []),
        "conditions_after": list(after.get("conditions") or []),
        "loaded_ammunition": [],
    }
    before_map = ammo_before or {}
    after_map = ammo_after or {}
    for weapon_id in sorted(set(before_map) | set(after_map)):
        old = before_map.get(weapon_id) or after_map[weapon_id]
        new = after_map.get(weapon_id) or before_map[weapon_id]
        receipt["loaded_ammunition"].append({
            "weapon_id": weapon_id,
            "weapon_label": str(new.get("weapon_label") or old.get("weapon_label") or weapon_id),
            "before": int(old["loaded"]),
            "change": int(new["loaded"]) - int(old["loaded"]),
            "after": int(new["loaded"]),
            "scope": "current_loaded_magazine_only",
        })
    return receipt


def _affordance_by_id(scene: dict[str, Any] | None, affordance_id: str) -> dict[str, Any] | None:
    for affordance in (scene or {}).get("affordances") or []:
        if (
            isinstance(affordance, dict)
            and str(affordance.get("id")) == str(affordance_id)
        ):
            return affordance
    return None


_CHARACTERISTIC_NAMES = {"STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK"}


def _canonical_skill_selector(
    ctx: Ctx, investigator_id: str, skill: str
) -> str:
    """Resolve a skill's structured, case-insensitive semantic identity."""
    stripped = str(skill).strip()
    if not stripped:
        return ""
    sheet = ctx.sheet(investigator_id)
    skills = sheet.get("skills") or {}
    if not isinstance(skills, dict):
        raise ToolError("state_corrupt", "investigator skill map is invalid")
    folded = stripped.casefold()
    matches = [
        str(key)
        for key in skills
        if isinstance(key, str) and key.casefold() == folded
    ]
    if len(matches) > 1:
        raise ToolError(
            "state_corrupt",
            f"investigator skill map has ambiguous selector '{stripped}'",
        )
    if matches:
        return matches[0]
    cname = stripped.upper()
    if cname in _CHARACTERISTIC_NAMES:
        return cname
    base = _canonical_skill_base(stripped)
    if base is not None:
        return str(base[0])
    return stripped


def _resolve_target_value(
    ctx: Ctx,
    investigator_id: str,
    args: dict[str, Any],
) -> tuple[int, str, str]:
    """Resolve the percentile target from explicit value, skill, or characteristic."""
    skill = (
        _canonical_skill_selector(ctx, investigator_id, str(args["skill"]))
        if args.get("skill") is not None and str(args["skill"]).strip()
        else None
    )
    characteristic = (
        str(args["characteristic"]).strip().upper()
        if args.get("characteristic") is not None
        and str(args["characteristic"]).strip()
        else None
    )
    if args.get("target") is not None:
        return (
            int(args["target"]),
            str(skill or characteristic or "explicit target"),
            "explicit",
        )
    sheet = ctx.sheet(investigator_id)
    if characteristic:
        cname = characteristic
        if cname == "SAN":
            return int(ctx.inv_state(investigator_id).get("current_san", 0)), "SAN", "state"
        if cname == "LUCK":
            return int(ctx.inv_state(investigator_id).get("current_luck", 0)), "LUCK", "state"
        value = (sheet.get("characteristics") or {}).get(cname)
        if value is None:
            raise ToolError("unknown_characteristic", f"{cname} not on sheet")
        return int(value), cname, "sheet"
    if not skill:
        raise ToolError("missing_param", "provide skill, characteristic, or target")
    skills = sheet.get("skills") or {}
    if skill in skills:
        return int(skills[skill]), str(skill), "sheet"
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


def _normalize_percentile_invocation(
    args: dict[str, Any],
    *,
    pushed: bool,
    frozen_operation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalize immutable caller fields without consulting mutable state."""
    if pushed:
        supplied_inherited = sorted(
            field for field in _PUSH_INHERITED_ARGUMENTS if field in args
        )
        if supplied_inherited:
            raise ToolError(
                "invalid_param",
                "rules.push inherits the original check contract; remove: "
                + ", ".join(supplied_inherited),
            )
        if not isinstance(frozen_operation, dict):
            raise ToolError(
                "missing_original_check",
                "rules.push requires a valid original rules.roll receipt",
            )
        original_check_decision_id = str(
            args.get("original_check_decision_id") or ""
        ).strip()
        if not original_check_decision_id:
            raise ToolError(
                "missing_param", "required parameter: original_check_decision_id"
            )
        method_changed = str(args.get("method_changed") or "").strip()
        failure_consequence = str(
            args.get("failure_consequence") or ""
        ).strip()
        if not method_changed or not failure_consequence:
            raise ToolError(
                "invalid_param",
                "rules.push requires non-empty method_changed and failure_consequence",
            )
        fumble_consequence = (
            str(args["fumble_consequence"]).strip()
            if args.get("fumble_consequence") is not None
            else ""
        ) or None
        operation = {
            field: deepcopy(frozen_operation.get(field))
            for field in _PUSH_INHERITED_OPERATION_FIELDS
        }
        operation.update({
            "fumble_consequence": fumble_consequence,
            "pushed": True,
            "method_changed": method_changed,
            "failure_consequence": failure_consequence,
            "original_check_decision_id": original_check_decision_id,
        })
        return operation

    raw_investigator = args.get("investigator")
    investigator = (
        str(raw_investigator).strip()
        if raw_investigator is not None and str(raw_investigator).strip()
        else None
    )
    raw_skill = args.get("skill")
    skill = None
    if raw_skill is not None and str(raw_skill).strip():
        stripped_skill = str(raw_skill).strip()
        hinted_skill = (
            frozen_operation.get("skill")
            if isinstance(frozen_operation, dict)
            else None
        )
        if (
            isinstance(hinted_skill, str)
            and hinted_skill
            and hinted_skill.casefold() == stripped_skill.casefold()
        ):
            skill = hinted_skill
        else:
            skill = stripped_skill
    raw_characteristic = args.get("characteristic")
    characteristic = (
        str(raw_characteristic).strip().upper()
        if raw_characteristic is not None and str(raw_characteristic).strip()
        else None
    )
    explicit_target = args.get("target")
    if explicit_target is not None and not _is_exact_int(explicit_target):
        raise ToolError("invalid_param", "target must be an integer")
    required_level = str(args.get("difficulty") or "").strip()
    bonus = args.get("bonus", 0)
    penalty = args.get("penalty", 0)
    if not _is_exact_int(bonus) or not _is_exact_int(penalty):
        raise ToolError("invalid_param", "bonus and penalty must be integers")
    raw_stakes = args.get("stakes")
    if (
        not isinstance(raw_stakes, dict)
        or set(raw_stakes) != {"on_success", "on_failure"}
        or any(
            not isinstance(raw_stakes.get(key), str)
            or not raw_stakes[key].strip()
            for key in ("on_success", "on_failure")
        )
    ):
        raise ToolError(
            "invalid_param",
            "stakes must be an object with non-empty on_success and on_failure strings",
        )
    goal = str(args.get("goal") or "").strip()
    difficulty_basis = str(args.get("difficulty_basis") or "").strip()
    reason = (
        str(args["reason"]).strip()
        if args.get("reason") is not None
        else ""
    ) or None
    fumble_consequence = (
        str(args["fumble_consequence"]).strip()
        if args.get("fumble_consequence") is not None
        else ""
    ) or None
    npc_id = (
        str(args["npc_id"]).strip()
        if args.get("npc_id") is not None
        else ""
    ) or None
    operation = {
        "investigator": investigator,
        "skill": skill,
        "characteristic": characteristic,
        "explicit_target": explicit_target,
        "required_level": required_level,
        "bonus": bonus,
        "penalty": penalty,
        "goal": goal,
        "stakes": {
            "on_success": raw_stakes["on_success"].strip(),
            "on_failure": raw_stakes["on_failure"].strip(),
        },
        "difficulty_basis": difficulty_basis,
        "reason": reason,
        "fumble_consequence": fumble_consequence,
        "pushed": False,
        "method_changed": None,
        "failure_consequence": None,
        "original_check_decision_id": None,
        "npc_id": npc_id,
    }
    if (
        isinstance(frozen_operation, dict)
        and "npc_id" not in frozen_operation
        and npc_id is None
    ):
        operation.pop("npc_id")
    return operation


def _compile_new_percentile_invocation(
    ctx: Ctx,
    args: dict[str, Any],
    *,
    pushed: bool,
    document: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Resolve mutable investigator/target state only for an unowned decision."""
    if pushed:
        original_check_decision_id = str(
            args.get("original_check_decision_id") or ""
        ).strip()
        original = _roll_receipt(
            document, "rules.roll", original_check_decision_id
        )
        if original is None:
            raise ToolError(
                "unknown_original_check",
                "rules.push original_check_decision_id must name a settled rules.roll",
            )
        _validate_roll_receipt(
            original,
            tool_name="rules.roll",
            decision_id=original_check_decision_id,
        )
        existing_pushes = (
            document.get("receipts", {}).get("rules.push") or {}
        )
        already_pushed = any(
            isinstance(existing, dict)
            and existing.get("operation", {}).get(
                "original_check_decision_id"
            )
            == original_check_decision_id
            for existing in existing_pushes.values()
        )
        push_verdict = _rules_resolver(ctx, "push_policy").push_policy(
            original["data"].get("outcome"), already_pushed
        )
        if push_verdict is not None:
            raise ToolError("invalid_push", push_verdict)
        operation = _normalize_percentile_invocation(
            args,
            pushed=True,
            frozen_operation=original["operation"],
        )
        resolution = {
            key: deepcopy(original["resolution"][key])
            for key in (
                "investigator_id",
                "resolved_label",
                "resolved_target",
                "target_source",
            )
        }
        resolution["original_check_ref"] = {
            "tool": "rules.roll",
            "decision_id": original_check_decision_id,
            "roll_id": str(original["roll_id"]),
            "integrity_digest": str(
                original[_SOURCE_RECEIPT_INTEGRITY_KEY]
            ),
        }
        return operation, resolution

    operation = _normalize_percentile_invocation(args, pushed=False)
    required_level = str(operation["required_level"])
    bonus = int(operation["bonus"])
    penalty = int(operation["penalty"])
    if required_level not in {"regular", "hard", "extreme"}:
        raise ToolError(
            "invalid_param", f"unsupported difficulty: {required_level}"
        )
    if not 0 <= bonus <= 2 or not 0 <= penalty <= 2:
        raise ToolError(
            "invalid_param", "bonus and penalty must be integers from 0 to 2"
        )
    if not operation["goal"]:
        raise ToolError("invalid_param", "goal must be a non-empty string")
    if operation["difficulty_basis"] not in _DIFFICULTY_BASIS_VALUES:
        raise ToolError(
            "invalid_param",
            "difficulty_basis must be one of: "
            + ", ".join(sorted(_DIFFICULTY_BASIS_VALUES)),
        )
    investigator_id = _resolve_investigator(
        ctx, {"investigator": operation["investigator"]}
    )
    if isinstance(operation.get("skill"), str) and operation.get("skill"):
        operation["skill"] = _canonical_skill_selector(
            ctx, investigator_id, str(operation["skill"])
        )
    normalized = {
        "investigator": operation["investigator"],
        "skill": operation["skill"],
        "characteristic": operation["characteristic"],
        "target": operation["explicit_target"],
    }
    target, label, target_source = _resolve_target_value(
        ctx, investigator_id, normalized
    )
    resolution = {
        "investigator_id": investigator_id,
        "resolved_label": label,
        "resolved_target": target,
        "target_source": target_source,
        "original_check_ref": None,
    }
    modifier = _matching_active_exceptional_modifier(
        ctx,
        investigator_id=investigator_id,
        skill=label,
        npc_id=operation.get("npc_id"),
    )
    if modifier is not None:
        expected_key = (
            "bonus" if modifier["effect_kind"] == "bonus_die" else "penalty"
        )
        opposite_key = "penalty" if expected_key == "bonus" else "bonus"
        dice = int(modifier["mechanics"]["dice"])
        if int(operation[expected_key]) != dice or int(operation[opposite_key]) != 0:
            raise ToolError(
                "exceptional_modifier_required",
                f"active {modifier['effect_kind']} {modifier['effect_id']} requires "
                f"{expected_key}={dice}, {opposite_key}=0 on this next matching check",
            )
    # ``seed`` is intentionally absent: it is tests-only RNG transport.
    return operation, resolution


def _mark_improvement_tick(
    ctx: Ctx,
    investigator_id: str,
    skill: str,
    roll_result: dict[str, Any],
    *,
    source_event_id: str,
    source_kind: str,
    character_snapshot: dict[str, Any] | None = None,
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
    state = ctx.inv_state(
        investigator_id, character_snapshot=character_snapshot
    )
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


_ROLL_RESOLUTION_CONTEXT_TEXT_FIELDS = (
    "attempt_id", "scene_id", "route_id", "roll_density_group",
)


def _current_elapsed_minutes(ctx: Ctx) -> int | None:
    try:
        value = coc_time.current_stamp(ctx.campaign_dir).get("elapsed_minutes")
    except (OSError, ValueError, TypeError):
        return None
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _normalize_roll_resolution_context(
    value: Any,
) -> tuple[dict[str, Any] | None, list[str]]:
    """Normalize KP-supplied attempt identity without interpreting its prose.

    This context is advisory continuity data.  Invalid optional fields are
    ignored with warnings; they never deny the action or suppress a die roll.
    """
    if value is None:
        return None, []
    if not isinstance(value, dict):
        return None, [
            "resolution_context was not an object; ignored without blocking the roll"
        ]
    context: dict[str, Any] = {"schema_version": 1, "hard_gate": False}
    warnings: list[str] = []
    for field in _ROLL_RESOLUTION_CONTEXT_TEXT_FIELDS:
        raw = value.get(field)
        if raw is None:
            continue
        text = str(raw).strip()
        if not text:
            warnings.append(
                f"resolution_context.{field} was blank and was ignored"
            )
            continue
        context[field] = text[:240]
    if "attempt_id" not in context and context.get("roll_density_group"):
        context["attempt_id"] = str(context["roll_density_group"])
    reset = value.get("reset_evidence")
    if reset is not None:
        if not isinstance(reset, dict):
            warnings.append(
                "resolution_context.reset_evidence was not an object and was ignored"
            )
        else:
            reason = str(reset.get("reason") or "").strip()
            if not reason:
                warnings.append(
                    "resolution_context.reset_evidence needs a semantic reason and was ignored"
                )
            else:
                context["reset_evidence"] = {
                    "kind": str(reset.get("kind") or "fiction_changed").strip()[:120],
                    "reason": reason[:1000],
                }
                for field in (
                    "elapsed_minutes", "source_attempt_elapsed_minutes",
                ):
                    number = reset.get(field)
                    if isinstance(number, int) and not isinstance(number, bool):
                        context["reset_evidence"][field] = number
                for field in ("policy_mode", "source_attempt_id"):
                    text = str(reset.get(field) or "").strip()
                    if text:
                        context["reset_evidence"][field] = text[:240]
    if len(context) == 2:
        return None, warnings
    return context, warnings


def _route_roll_context(
    ctx: Ctx, context: dict[str, Any] | None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    if not isinstance(context, dict):
        return None, None
    scene_id = str(context.get("scene_id") or "").strip()
    route_id = str(context.get("route_id") or "").strip()
    if not scene_id or not route_id:
        return None, None
    scene = _scene_by_id(ctx.story_graph, scene_id)
    return scene, _affordance_by_id(scene, route_id)


def _route_retry_status(
    ctx: Ctx,
    route: dict[str, Any] | None,
    context: dict[str, Any],
) -> dict[str, Any]:
    gate = route.get("roll_gate") if isinstance(route, dict) else None
    policy = gate.get("retry_policy") if isinstance(gate, dict) else None
    base = {
        "schema_version": 1,
        "authority": "advisory",
        "hard_gate": False,
        "eligible": False,
        "policy": deepcopy(policy) if isinstance(policy, dict) else None,
    }
    if not isinstance(policy, dict):
        return {
            **base,
            "status": "no_authored_reset_policy",
            "reason": "Use the open Push, change method or goal, or let the failed consequence stand.",
        }
    if policy.get("mode") != "elapsed_time_reset":
        return {**base, "status": "unsupported_authored_policy"}
    minimum = policy.get("minimum_elapsed_minutes")
    started = context.get("attempt_started_elapsed_minutes")
    current = _current_elapsed_minutes(ctx)
    if (
        not isinstance(minimum, int) or isinstance(minimum, bool)
        or not isinstance(started, int) or isinstance(started, bool)
        or current is None
    ):
        return {
            **base,
            "status": "insufficient_structured_time_evidence",
            "current_elapsed_minutes": current,
            "attempt_started_elapsed_minutes": started,
        }
    elapsed = max(0, current - started)
    eligible = elapsed >= minimum
    return {
        **base,
        "status": "eligible" if eligible else "waiting",
        "eligible": eligible,
        "elapsed_minutes": elapsed,
        "remaining_minutes": max(0, minimum - elapsed),
        "current_elapsed_minutes": current,
        "attempt_started_elapsed_minutes": started,
        "reset_evidence": (
            {
                "kind": "authored_elapsed_time_reset",
                "reason": (
                    f"Authored retry policy permits a fresh attempt after {minimum} elapsed minutes; "
                    f"canonical campaign time advanced by {elapsed} minutes."
                ),
                "elapsed_minutes": elapsed,
                "source_attempt_elapsed_minutes": started,
                "policy_mode": "elapsed_time_reset",
                "source_attempt_id": str(context.get("attempt_id") or ""),
            }
            if eligible else None
        ),
    }


def _settle_contextual_route(
    ctx: Ctx,
    context: dict[str, Any] | None,
    *,
    decision_id: str,
    source_tool: str,
    successful: bool,
    committed_clue_ids: list[str] | None = None,
) -> tuple[dict[str, Any] | None, list[str]]:
    """Project an exact structured settlement into the authored route ledger.

    Unknown, stale, repeatable, or incomplete route references degrade to
    warnings.  They never roll back the underlying clue or rules settlement.
    """
    scene, route = _route_roll_context(ctx, context)
    if scene is None or route is None:
        if isinstance(context, dict) and context.get("route_id"):
            return None, [
                "resolution_context route_ref was unavailable; the underlying settlement remains valid"
            ]
        return None, []
    scene_id = str(scene.get("scene_id") or context.get("scene_id") or "")
    route_id = str(route.get("id") or route.get("route_id") or "")
    if (
        route.get("repeatable") is True
        or str(route.get("status") or "") in {"repeatable", "resume"}
        or str(route.get("completion_policy") or "") == "repeatable"
    ):
        return None, []
    world = ctx.world()
    receipts = [
        deepcopy(row) for row in world.get("route_completion_receipts") or []
        if isinstance(row, dict)
    ]
    existing = next(
        (
            row for row in receipts
            if str(row.get("route_id") or "") == route_id
            and str(row.get("scene_id") or scene_id) == scene_id
            and row.get("status") in {"consumed", "blocked"}
        ),
        None,
    )
    if existing is not None:
        return deepcopy(existing), []
    completed = coc_action_resolver._route_receipt_ids(
        world, scene_id, "consumed"
    )
    required = {
        str(value).strip()
        for value in route.get("requires_completed_route_ids") or []
        if str(value or "").strip()
    }
    semantic_completion = context.get("semantic_completion") is True
    route_warnings: list[str] = []
    if not required.issubset(completed):
        if not semantic_completion:
            return None, [
                f"route '{route_id}' prerequisites are not yet settled; kept the result but left the route open"
            ]
        route_warnings.append(
            f"route '{route_id}' was completed by explicit KP semantic judgment despite unmet authored route prerequisites"
        )
    grants = coc_action_resolver._affordance_clue_ids(route)
    discovered = {
        str(value) for value in world.get("discovered_clue_ids") or [] if value
    }
    committed = [
        str(value) for value in committed_clue_ids or [] if str(value) in grants
    ]
    if grants:
        complete = set(grants).issubset(discovered)
    else:
        complete = bool(
            successful
            and (
                isinstance(route.get("roll_gate"), dict)
                or semantic_completion
            )
        )
    if not complete:
        return None, route_warnings
    completion = {
        "schema_version": 1,
        "route_id": route_id,
        "scene_id": scene_id,
        "status": "consumed",
        "committed_clue_ids": list(grants if grants else committed),
        "committed_flag_ids": [],
        "remaining_clue_ids": [],
        "rule_request_ids": [],
        "rule_outcomes": ["success"] if successful else [],
        "success": bool(successful or grants),
        "completion_quality": (
            "keeper_judgment" if semantic_completion else "clean"
        ),
        "decision_id": str(decision_id),
        "source": f"toolbox_context:{source_tool}",
        "ts": _now_iso(),
    }
    if semantic_completion:
        completion.update({
            "authority": "keeper_semantic_judgment",
            "hard_gate": False,
            "semantic_reason": str(context.get("semantic_reason") or ""),
            "evidence_ref": str(context.get("evidence_ref") or ""),
        })
    receipts.append(completion)
    world["route_completion_receipts"] = receipts[-256:]
    ctx.save_world(world)
    ctx.log_event({
        "event_type": "route_completed",
        "decision_id": str(decision_id),
        "route_id": route_id,
        "scene_id": scene_id,
        "committed_clue_ids": list(completion["committed_clue_ids"]),
        "status": "completed",
        "success": completion["success"],
        "completion_quality": completion["completion_quality"],
        "semantic_reason": completion.get("semantic_reason"),
        "evidence_ref": completion.get("evidence_ref"),
        "player_visible_goal": str(route.get("cue") or ""),
        "player_visible_outcome": str(route.get("player_visible_outcome") or ""),
        "source": completion["source"],
        "summary": f"structured route completed: {route_id}",
    })
    return completion, route_warnings


def _push_operation_opportunity(
    ctx: Ctx,
    receipt: dict[str, Any],
    *,
    no_progress_count: int = 1,
) -> dict[str, Any]:
    data = receipt.get("data") if isinstance(receipt.get("data"), dict) else {}
    context = (
        data.get("resolution_context")
        if isinstance(data.get("resolution_context"), dict)
        else {}
    )
    _scene, route = _route_roll_context(ctx, context)
    gate = route.get("roll_gate") if isinstance(route, dict) else None
    push_consequence = (
        gate.get("push_failure_consequence")
        if isinstance(gate, dict) else None
    )
    fumble_consequence = (
        gate.get("fumble_consequence") if isinstance(gate, dict) else None
    )
    retry_status = _route_retry_status(ctx, route, context)
    prefilled: dict[str, Any] = {
        "original_check_decision_id": str(receipt.get("decision_id") or ""),
    }
    missing = ["method_changed", "failure_consequence", "decision_id"]
    if isinstance(push_consequence, dict) and str(
        push_consequence.get("summary") or ""
    ).strip():
        prefilled["failure_consequence"] = str(
            push_consequence["summary"]
        ).strip()
        missing.remove("failure_consequence")
    if isinstance(fumble_consequence, dict) and str(
        fumble_consequence.get("summary") or ""
    ).strip():
        prefilled["fumble_consequence"] = str(
            fumble_consequence["summary"]
        ).strip()
    opportunity = {
        "schema_version": 1,
        "kind": "open_push_or_context_change",
        "authority": "advisory",
        "hard_gate": False,
        "reason_code": "ordinary_failure_has_unresolved_attempt",
        "source": {
            "decision_id": str(receipt.get("decision_id") or ""),
            "roll_id": data.get("roll_id"),
            "attempt_id": context.get("attempt_id"),
            "scene_id": context.get("scene_id"),
            "route_id": context.get("route_id"),
            "roll_density_group": context.get("roll_density_group"),
        },
        "suggested_operation": {
            "operation": "rules.push",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": prefilled,
            "missing_arguments": missing,
        },
        "attempt_pressure": {
            "schema_version": 1,
            "same_goal_no_progress_count": max(1, int(no_progress_count)),
            "level": (
                "repeated_without_progress"
                if int(no_progress_count) > 1
                else "first_ordinary_failure"
            ),
            "authority": "advisory",
            "hard_gate": False,
        },
        "retry_status": retry_status,
        "alternatives": [
            "accept the failed result and let its consequence change play",
            "change the fictional method or goal",
            "record structured reset_evidence after time, access, position, or circumstances materially change",
        ],
    }
    if retry_status.get("eligible") is True and isinstance(route, dict):
        opportunity["reset_retry_operations"] = _route_operation_cards(
            ctx,
            route,
            reset_evidence=retry_status.get("reset_evidence"),
        )
    return opportunity


def _open_attempt_opportunities_from_document(
    ctx: Ctx,
    document: dict[str, Any],
    *,
    scene_id: str | None = None,
) -> list[dict[str, Any]]:
    receipts = document.get("receipts") if isinstance(document, dict) else {}
    roll_receipts = receipts.get("rules.roll") if isinstance(receipts, dict) else {}
    push_receipts = receipts.get("rules.push") if isinstance(receipts, dict) else {}
    pushed_originals = {
        str((row.get("operation") or {}).get("original_check_decision_id") or "")
        for row in (push_receipts or {}).values()
        if isinstance(row, dict)
    }
    by_group: dict[str, dict[str, Any]] = {}
    pressure_by_group: dict[str, int] = {}
    for decision_id, receipt in (roll_receipts or {}).items():
        if not isinstance(receipt, dict):
            continue
        data = receipt.get("data") if isinstance(receipt.get("data"), dict) else {}
        context = data.get("resolution_context")
        if not isinstance(context, dict):
            continue
        group = str(context.get("roll_density_group") or "").strip()
        if not group:
            continue
        if scene_id and str(context.get("scene_id") or "") not in {"", scene_id}:
            continue
        outcome = str(data.get("outcome") or "")
        if outcome == "failure" and str(decision_id) not in pushed_originals:
            by_group[group] = receipt
            if isinstance(context.get("reset_evidence"), dict):
                pressure_by_group[group] = 1
            else:
                pressure_by_group[group] = pressure_by_group.get(group, 0) + 1
        else:
            by_group.pop(group, None)
            pressure_by_group.pop(group, None)
    return [
        _push_operation_opportunity(
            ctx,
            receipt,
            no_progress_count=pressure_by_group.get(group, 1),
        )
        for group, receipt in list(by_group.items())[-8:]
    ]


def _open_attempt_opportunities(
    ctx: Ctx, *, scene_id: str | None = None,
) -> list[dict[str, Any]]:
    return _open_attempt_opportunities_from_document(
        ctx, _load_roll_receipt_document(ctx), scene_id=scene_id,
    )


def _roll_common(
    ctx: Ctx,
    args: dict[str, Any],
    *,
    pushed: bool,
    tool_name: str,
) -> tuple[dict[str, Any], list[str], list[str]]:
    decision_id = str(args["decision_id"])
    document = _load_roll_receipt_document(ctx)
    receipt_hint = _roll_receipt(document, tool_name, decision_id)
    if receipt_hint is not None:
        _validate_roll_receipt(
            receipt_hint,
            tool_name=tool_name,
            decision_id=decision_id,
        )
        operation = _normalize_percentile_invocation(
            args,
            pushed=pushed,
            frozen_operation=receipt_hint["operation"],
        )
        if receipt_hint["fingerprint"] != _operation_fingerprint(
            tool_name, operation
        ):
            raise ToolError(
                "idempotency_conflict",
                f"decision_id '{decision_id}' was already applied to a "
                f"different {tool_name} semantic operation",
            )
        return _replay_roll_receipt(ctx, document, receipt_hint)
    operation, resolution = _compile_new_percentile_invocation(
        ctx, args, pushed=pushed, document=document
    )
    document, receipt = _existing_roll_receipt(
        ctx,
        tool_name=tool_name,
        decision_id=decision_id,
        operation=operation,
        document=document,
    )
    if receipt is not None:
        return _replay_roll_receipt(ctx, document, receipt)
    investigator_id = str(resolution["investigator_id"])
    target = int(resolution["resolved_target"])
    label = str(resolution["resolved_label"])
    target_source = str(resolution["target_source"])
    difficulty = str(operation["required_level"])
    bonus = int(operation["bonus"])
    penalty = int(operation["penalty"])
    context_warnings: list[str] = []
    resolution_context: dict[str, Any] | None
    if pushed:
        original = _roll_receipt(
            document,
            "rules.roll",
            str(operation.get("original_check_decision_id") or ""),
        )
        original_data = (
            original.get("data") if isinstance(original, dict) else None
        )
        resolution_context = (
            deepcopy(original_data.get("resolution_context"))
            if isinstance(original_data, dict)
            and isinstance(original_data.get("resolution_context"), dict)
            else None
        )
    else:
        resolution_context, context_warnings = (
            _normalize_roll_resolution_context(args.get("resolution_context"))
        )
        if (
            isinstance(resolution_context, dict)
            and resolution_context.get("roll_density_group")
        ):
            current_elapsed = _current_elapsed_minutes(ctx)
            if current_elapsed is not None:
                resolution_context["attempt_started_elapsed_minutes"] = current_elapsed
    prior_attempt_advisory = None
    if (
        not pushed
        and isinstance(resolution_context, dict)
        and resolution_context.get("roll_density_group")
        and not isinstance(resolution_context.get("reset_evidence"), dict)
    ):
        group = str(resolution_context["roll_density_group"])
        prior_attempt_advisory = next(
            (
                row for row in _open_attempt_opportunities_from_document(
                    ctx,
                    document,
                    scene_id=str(resolution_context.get("scene_id") or "") or None,
                )
                if str((row.get("source") or {}).get("roll_density_group") or "")
                == group
            ),
            None,
        )
    result = _rules_resolver(ctx, "check").check(
        target, difficulty, bonus, penalty, rng=_rng(args)
    )
    result["investigator_id"] = investigator_id
    result["skill"] = label
    result["target_source"] = target_source
    result["pushed"] = pushed
    result["goal"] = str(operation["goal"])
    result["stakes"] = deepcopy(operation["stakes"])
    result["difficulty_basis"] = str(operation["difficulty_basis"])
    if operation.get("reason"):
        result["reason"] = str(operation["reason"])
    if operation.get("npc_id"):
        result["npc_id"] = str(operation["npc_id"])
    if resolution_context is not None:
        result["resolution_context"] = deepcopy(resolution_context)
    if prior_attempt_advisory is not None:
        result["attempt_advisory"] = {
            **deepcopy(prior_attempt_advisory),
            "recommendation": (
                "This appears to revisit an unresolved attempt. Prefer the open Push, "
                "accept its consequence, or explain structured reset_evidence; this is "
                "advice only and the requested roll was still honored."
            ),
        }
    if pushed and operation.get("method_changed"):
        result["method_changed"] = str(operation["method_changed"])
    if pushed and operation.get("failure_consequence"):
        consequence = {"summary": str(operation["failure_consequence"])}
        result["failure_consequence"] = consequence
        result["announced_consequence"] = consequence
    if operation.get("fumble_consequence"):
        result["fumble_consequence"] = {
            "summary": str(operation["fumble_consequence"])
        }
    if pushed:
        result["original_check"] = deepcopy(
            resolution["original_check_ref"]
        )

    warnings: list[str] = list(context_warnings)
    hints: list[str] = []
    if prior_attempt_advisory is not None:
        warnings.append(
            "same roll_density_group still had an ordinary failure open; soft advice only, so the new roll was not blocked"
        )
    if target_source == "rulebook_base":
        hints.append(
            f"{label} is not listed on the investigator sheet; used the canonical rulebook base chance {target}%"
        )
    outcome = result["outcome"]
    success = bool(result["success"])
    if isinstance(resolution_context, dict) and resolution_context.get(
        "roll_density_group"
    ):
        prior_pressure = (
            ((prior_attempt_advisory or {}).get("attempt_pressure") or {}).get(
                "same_goal_no_progress_count"
            )
            or 0
        )
        result["attempt_pressure"] = {
            "schema_version": 1,
            "same_goal_no_progress_count": (
                int(prior_pressure) + 1 if outcome == "failure" else 0
            ),
            "level": (
                "resolved"
                if outcome != "failure"
                else (
                    "repeated_without_progress"
                    if int(prior_pressure) >= 1
                    else "first_ordinary_failure"
                )
            ),
            "authority": "advisory",
            "hard_gate": False,
        }
    if (
        success
        and not pushed
        and args.get("skill") not in (None, "")
        and label not in _CHARACTERISTIC_NAMES
        and label not in ("SAN", "LUCK")
    ):
        hints.append(f"success: improvement tick recorded for {label}")
    if outcome == "critical":
        hints.append(
            "critical success: before state.journal apply a source-bound benefit with state.exceptional_effect; prose alone cannot close it"
        )
    if outcome == "fumble":
        hints.append(
            "fumble: before state.journal apply a source-bound cost with state.exceptional_effect and realize its causal complication"
        )
    if outcome == "failure" and not pushed:
        hints.append(
            "failed: the player may push this roll with a changed method and an announced consequence (rules.push)"
        )
    if pushed and not success:
        hints.append(
            "pushed roll failed: before state.journal apply a source-bound cost with state.exceptional_effect; narration alone is insufficient"
        )
    if outcome in {"critical", "fumble"} or (pushed and not success):
        hints.append(
            "before applying state.exceptional_effect, write player_visible_impact, "
            "causal_link, and any until_condition boundary.description in the "
            "campaign's active play_language; turn.finalize renders all three "
            "verbatim, so internal English reasoning or machine ids do not belong there"
        )
    active_modifier = _matching_active_exceptional_modifier(
        ctx,
        investigator_id=investigator_id,
        skill=label,
        npc_id=operation.get("npc_id"),
    )
    if active_modifier is not None:
        hints.append(
            "this roll used active exceptional modifier "
            f"{active_modifier['effect_id']}; call state.exceptional_effect "
            "action=consume with this roll_id before state.journal"
        )
    if outcome == "failure" and not pushed:
        result["operation_opportunities"] = [
            _push_operation_opportunity(
                ctx,
                {"decision_id": decision_id, "data": result},
            )
        ]
    roll_record = ctx.prepare_roll({
        "event_type": "roll",
        "kind": "pushed_skill_check" if pushed else "skill_check",
        "actor": investigator_id,
        "visibility": "public",
        "payload": dict(result),
        **result,
    })
    result["roll_id"] = roll_record["roll_id"]
    if outcome == "failure" and not pushed:
        result["operation_opportunities"][0]["source"]["roll_id"] = result[
            "roll_id"
        ]
        roll_record["operation_opportunities"] = deepcopy(
            result["operation_opportunities"]
        )
        roll_record["payload"]["operation_opportunities"] = deepcopy(
            result["operation_opportunities"]
        )
    receipt = _new_roll_receipt(
        tool_name=tool_name,
        decision_id=decision_id,
        operation=operation,
        resolution=resolution,
        roll_record=roll_record,
        data=result,
        warnings=warnings,
        hints=hints,
    )
    _commit_new_roll_receipt(ctx, document, receipt)
    _route_receipt, route_warnings = _settle_contextual_route(
        ctx,
        resolution_context,
        decision_id=decision_id,
        source_tool=tool_name,
        successful=bool(result.get("success")),
    )
    warnings.extend(route_warnings)
    return result, warnings, hints


# --------------------------------------------------------------------------- #
# setup.* — canonical pre-session onboarding gateway
# --------------------------------------------------------------------------- #

_CUSTOM_SETUP_OPERATION_KINDS = (
    "campaign.create",
    "actor.create",
    "investigator.create",
    "campaign.link_investigator",
    "scenario.bind_pdf",
    "campaign.render_briefing",
    "investigator.render_card",
)


@tool(
    "setup.inspect",
    "Inspect canonical pre-session onboarding state: campaigns, investigators, built-in starters/pregens, and setup operation ids. Use in an empty or unknown workspace instead of searching files.",
    {},
    needs_campaign=False,
    access="query",
)
def _tool_setup_inspect(ctx: Ctx, args: dict[str, Any]):
    if args:
        raise ToolError("invalid_param", "setup.inspect takes no arguments")
    try:
        receipt = coc_runtime_ops.execute_setup_operation(
            ctx.root,
            operation={
                "schema_version": 1,
                "kind": "onboarding.inspect",
                "payload": {},
            },
        )
    except coc_runtime_ops.RuntimeOperationError as exc:
        raise ToolError("setup_failed", str(exc)) from exc
    return receipt, [], [
        "use the returned exact scenario_id and pregen_id with setup.quick_start; do not search plugin or campaign files",
    ]


@tool(
    "setup.quick_start",
    "Create a canonical built-in starter campaign and linked pregen investigator through the shared setup gateway. The starter path defaults player-visible play_language to zh-Hans.",
    {
        "scenario_id": {
            "type": "string",
            "required": True,
            "desc": "exact built-in scenario_id returned by setup.inspect",
        },
        "pregen_id": {
            "type": "string",
            "required": True,
            "desc": "exact pregen_id returned by setup.inspect for that scenario",
        },
        "campaign_id": {
            "type": "string",
            "desc": "optional stable campaign id; omit to let the canonical starter choose one",
        },
        "title": {
            "type": "string",
            "desc": "optional campaign title",
        },
    },
    needs_campaign=False,
    access="mutation",
    write_domains=("setup",),
)
def _tool_setup_quick_start(ctx: Ctx, args: dict[str, Any]):
    allowed = {"scenario_id", "pregen_id", "campaign_id", "title"}
    unsupported = sorted(set(args) - allowed)
    if unsupported:
        raise ToolError(
            "invalid_param",
            "setup.quick_start has unsupported fields: "
            + ", ".join(unsupported),
        )
    payload = {
        key: args[key]
        for key in ("scenario_id", "pregen_id", "campaign_id", "title")
        if args.get(key) is not None
    }
    try:
        receipt = coc_runtime_ops.execute_setup_operation(
            ctx.root,
            operation={
                "schema_version": 1,
                "kind": "campaign.quick_start",
                "payload": payload,
            },
        )
    except coc_runtime_ops.RuntimeOperationError as exc:
        raise ToolError("setup_failed", str(exc)) from exc
    campaign_id = str((receipt.get("result") or {}).get("campaign_id") or "")
    return receipt, [], [
        "call session.resume once with the returned campaign_id, then continue from its bounded working set",
        "do not pass play_language to setup.quick_start; the canonical built-in starter already defaults to zh-Hans",
    ] if campaign_id else []


@tool(
    "setup.invoke",
    "Invoke one existing canonical custom-campaign setup operation. This thin "
    "MCP-facing gateway delegates schema, source-bundle, path, and state "
    "validation to the shared pre-session setup runtime.",
    {
        "kind": {
            "type": "string",
            "required": True,
            "enum": list(_CUSTOM_SETUP_OPERATION_KINDS),
            "desc": "exact custom setup operation kind",
        },
        "payload": {
            "type": "object",
            "required": True,
            "desc": (
                "exact payload for the selected kind: campaign.create requires "
                "campaign_id/title and optionally ruleset_id/era/play_language/start_clock; "
                "actor.create requires campaign_id/actor_id/sheet and delegates "
                "validation to that campaign's ruleset; "
                "investigator.create requires investigator_id/sheet and optionally "
                "creation; campaign.link_investigator requires exactly "
                "campaign_id/investigator_ids; scenario.bind_pdf requires "
                "campaign_id/scenario_id/title/source_bundle_path and optionally "
                "compile_now; campaign.render_briefing requires campaign_id and "
                "optionally language; investigator.render_card requires "
                "campaign_id/investigator_id and optionally language/html_mode. "
                "Per-kind allowed fields are enforced by the canonical setup runtime. "
                "For installed-host progressive binding, omit compile_now or "
                "pass false; true requires the repository cold compiler runtime "
                "and is not part of the opening critical path"
            ),
            "properties": {
                "campaign_id": {"type": "string"},
                "actor_id": {"type": "string"},
                "title": {"type": "string"},
                "era": {"type": "string"},
                "play_language": {"type": "string"},
                "ruleset_id": {"type": "string"},
                "start_clock": {
                    "type": "object",
                    "additionalProperties": True,
                },
                "investigator_id": {"type": "string"},
                "sheet": {
                    "type": "object",
                    "additionalProperties": True,
                },
                "creation": {
                    "type": "object",
                    "additionalProperties": True,
                },
                "investigator_ids": {
                    "type": "array",
                    "minItems": 1,
                    "uniqueItems": True,
                    "items": {"type": "string"},
                },
                "scenario_id": {"type": "string"},
                "source_bundle_path": {"type": "string"},
                "language": {"type": "string"},
                "html_mode": {
                    "type": "string",
                    "enum": ["never", "auto", "always"],
                    "desc": "character-card HTML rendering mode",
                },
                "compile_now": {
                    "type": "boolean",
                    "desc": (
                        "optional cold full-module compile request; omit or pass "
                        "false for installed-host progressive import. true is "
                        "accepted only when the repository compiler runtime is "
                        "available and must not block the playable opening"
                    ),
                },
            },
            "additionalProperties": False,
        },
    },
    needs_campaign=False,
    access="mutation",
    write_domains=("setup",),
)
def _tool_setup_invoke(ctx: Ctx, args: dict[str, Any]):
    unsupported = sorted(set(args) - {"kind", "payload"})
    if unsupported:
        raise ToolError(
            "invalid_param",
            "setup.invoke has unsupported fields: " + ", ".join(unsupported),
        )
    kind = args.get("kind")
    if kind not in _CUSTOM_SETUP_OPERATION_KINDS:
        raise ToolError(
            "invalid_param",
            "setup.invoke kind must be one of: "
            + ", ".join(_CUSTOM_SETUP_OPERATION_KINDS),
        )
    payload = args.get("payload")
    if not isinstance(payload, dict):
        raise ToolError("invalid_param", "setup.invoke payload must be an object")
    try:
        receipt = coc_runtime_ops.execute_setup_operation(
            ctx.root,
            operation={
                "schema_version": 1,
                "kind": kind,
                "payload": deepcopy(payload),
            },
        )
    except (
        coc_runtime_ops.RuntimeOperationError,
        FileExistsError,
        FileNotFoundError,
    ) as exc:
        raise ToolError("setup_failed", str(exc)) from exc
    hints = [
        "complete only the remaining canonical setup steps, then call "
        "session.resume with the campaign_id used in those setup payloads",
    ]
    if kind == "scenario.bind_pdf" and receipt.get("status") == "PASS":
        briefing = (receipt.get("result") or {}).get(
            "character_creation_briefing"
        )
        briefing_path = (
            briefing.get("briefing_path") if isinstance(briefing, dict) else None
        )
        if isinstance(briefing_path, str) and briefing_path:
            hints.extend(
                [
                    "consume the exact result.character_creation_briefing."
                    "briefing_path directly from this receipt, rooted at the "
                    "current workspace; do not rerender it or rediscover it "
                    "through campaign.json, find, ls, glob, or directory listing "
                    "under .coc",
                    "call campaign.render_briefing only if a bind receipt lacks "
                    "that path or player-safe public setup metadata later changes",
                ]
            )
    return receipt, [], hints


# --------------------------------------------------------------------------- #
# rules.* — hard parameter rules
# --------------------------------------------------------------------------- #

_RULESET_REQUEST_RESERVED_FIELDS = frozenset({
    "rng", "current", "actor", "actor_id", "decision_id", "receipt_id",
    "roll_id", "ruleset_id", "ruleset_version",
})


def _ruleset_mutation_identity(
    ctx: Ctx, args: dict[str, Any], *, tool_name: str,
) -> tuple[str, str, str, str, dict[str, Any], int | None]:
    """Validate exact transport identity before package code is called."""
    decision_id = args.get("decision_id")
    actor_id = args.get("actor")
    if (
        not isinstance(decision_id, str)
        or not decision_id
        or decision_id != decision_id.strip()
    ):
        raise ToolError("invalid_param", "decision_id must be an exact non-empty string")
    if not isinstance(actor_id, str) or _SAFE_ID.fullmatch(actor_id) is None:
        raise ToolError("invalid_param", "actor must be a stable safe id")
    request = args.get("request")
    if not isinstance(request, dict):
        raise ToolError("invalid_param", "request must be an object")
    reserved = sorted(set(request) & _RULESET_REQUEST_RESERVED_FIELDS)
    if reserved:
        raise ToolError(
            "invalid_param",
            "request contains kernel-reserved fields: " + ", ".join(reserved),
        )
    seed = args.get("seed")
    if seed is not None and not _is_exact_int(seed):
        raise ToolError("invalid_param", "seed must be an integer")
    ruleset_id = _active_ruleset_id(ctx)
    manifest = coc_rulesets.load_manifest(ruleset_id)
    ruleset_version = manifest.get("version")
    if not isinstance(ruleset_version, str) or not ruleset_version:
        raise ToolError("invalid_ruleset", "active ruleset version must be non-empty")
    try:
        coc_state.load_ruleset_actor_state(ctx.campaign_dir, actor_id)
    except coc_state.UnsupportedSaveSchema as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    operation = {
        "ruleset_id": ruleset_id,
        "ruleset_version": ruleset_version,
        "actor_id": actor_id,
        "request": deepcopy(request),
        "seed": seed,
    }
    return decision_id, actor_id, ruleset_id, ruleset_version, operation, seed


def _generic_check_resolution(
    result: dict[str, Any], request: dict[str, Any],
) -> dict[str, Any]:
    """Normalize one small public check evidence contract."""
    nested = result.get("roll")
    if isinstance(nested, dict):
        expression = nested.get("expression")
        faces = nested.get("faces")
        total = nested.get("total")
    else:
        expression = "1D100"
        faces = [nested]
        total = nested
    success = result.get("success")
    outcome = result.get("outcome")
    if outcome is None and isinstance(success, bool):
        outcome = "success" if success else "failure"
    label = result.get("label") or request.get("label") or "check"
    target = result.get("target", result.get("difficulty"))
    resolution = {
        "label": label,
        "outcome": outcome,
        "success": success,
        "expression": expression,
        "faces": faces,
        "total": total,
        "target": target,
    }
    if (
        not isinstance(label, str) or not label.strip()
        or not isinstance(outcome, str) or not outcome.strip()
        or not isinstance(success, bool)
        or not isinstance(expression, str) or not expression.strip()
        or not isinstance(faces, list) or not faces
        or not all(_is_exact_int(value) for value in faces)
        or not _is_exact_int(total)
        or (target is not None and not _is_exact_int(target))
    ):
        raise ToolError(
            "invalid_ruleset",
            "ruleset check must return success/outcome and integer roll evidence",
        )
    return {
        "label": label.strip(),
        "outcome": outcome.strip(),
        "success": success,
        "expression": expression.strip().upper(),
        "faces": list(faces),
        "total": total,
        "target": target,
    }


def _resource_receipt_integrity(data: dict[str, Any]) -> str:
    return _canonical_digest({
        key: value for key, value in data.items() if key != "integrity_digest"
    })


@tool(
    "rules.check",
    "Run the active ruleset's generic deterministic check primitive and persist canonical public roll evidence. The request follows the package signature; the kernel binds actor, package version, idempotency, rolls.jsonl, and finalization.",
    {
        "actor": {
            "type": "string",
            "required": True,
            "desc": "campaign actor id created through the active ruleset setup path",
        },
        "request": {
            "type": "object",
            "required": True,
            "desc": "package-defined check keyword arguments (rng is injected by the kernel)",
        },
        "seed": {"type": "integer", "desc": "deterministic RNG seed"},
        "decision_id": {
            "type": "string",
            "required": True,
            "desc": "idempotency key",
        },
    },
)
def _tool_rules_check(ctx: Ctx, args: dict[str, Any]):
    unsupported = sorted(set(args) - {"actor", "request", "seed", "decision_id"})
    if unsupported:
        raise ToolError(
            "invalid_param", "rules.check has unsupported fields: " + ", ".join(unsupported)
        )
    (
        decision_id, actor_id, ruleset_id, ruleset_version, operation, _seed,
    ) = _ruleset_mutation_identity(ctx, args, tool_name="rules.check")
    document, receipt = _existing_roll_receipt(
        ctx,
        tool_name="rules.check",
        decision_id=decision_id,
        operation=operation,
    )
    if receipt is not None:
        return _replay_roll_receipt(ctx, document, receipt)
    resolver = _rules_resolver(ctx, "check")
    try:
        result = resolver.check(**deepcopy(operation["request"]), rng=_rng(args))
    except (TypeError, ValueError) as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    if not isinstance(result, dict):
        raise ToolError("invalid_ruleset", "ruleset check must return an object")
    resolution = _generic_check_resolution(result, operation["request"])
    data = {
        "schema_version": 1,
        "receipt_id": _operation_event_id(
            f"{ruleset_id}@{ruleset_version}.rules.check", decision_id
        ),
        "ruleset_id": ruleset_id,
        "ruleset_version": ruleset_version,
        "operation": "check",
        "decision_id": decision_id,
        "actor_id": actor_id,
        "investigator_id": actor_id,
        "kind": "ruleset_check",
        "skill": resolution["label"],
        "display_skill": resolution["label"],
        "outcome": resolution["outcome"],
        "success": resolution["success"],
        "roll": resolution["total"],
        "target": resolution["target"],
        "dice": {
            "expression": resolution["expression"],
            "raw": deepcopy(resolution["faces"]),
            "total": resolution["total"],
        },
        "request": {
            "request": deepcopy(operation["request"]),
            "seed": operation["seed"],
        },
        "result": deepcopy(result),
    }
    roll_record = ctx.prepare_roll({
        "event_type": "roll",
        "type": "ruleset_check",
        "kind": "ruleset_check",
        "actor": actor_id,
        "visibility": "public",
        "payload": deepcopy(data),
        **data,
    })
    data["roll_id"] = roll_record["roll_id"]
    roll_record.update(deepcopy(data))
    roll_record["payload"].update(deepcopy(data))
    receipt = _new_roll_receipt(
        tool_name="rules.check",
        decision_id=decision_id,
        operation=operation,
        resolution=resolution,
        roll_record=roll_record,
        data=data,
        warnings=[],
        hints=[],
    )
    _commit_new_roll_receipt(ctx, document, receipt)
    return data, [], []


@tool(
    "rules.resource_delta",
    "Apply the active ruleset's generic resource arithmetic to canonical actor state. Current state is kernel-owned; callers provide only the requested change.",
    {
        "actor": {
            "type": "string",
            "required": True,
            "desc": "campaign actor id whose canonical resource state changes",
        },
        "request": {
            "type": "object",
            "required": True,
            "desc": "package-defined resource_delta arguments; current/rng and identity fields are kernel-reserved",
        },
        "seed": {"type": "integer", "desc": "deterministic RNG seed"},
        "decision_id": {
            "type": "string",
            "required": True,
            "desc": "idempotency key",
        },
    },
)
def _tool_rules_resource_delta(ctx: Ctx, args: dict[str, Any]):
    unsupported = sorted(set(args) - {"actor", "request", "seed", "decision_id"})
    if unsupported:
        raise ToolError(
            "invalid_param",
            "rules.resource_delta has unsupported fields: " + ", ".join(unsupported),
        )
    (
        decision_id, actor_id, ruleset_id, ruleset_version, operation, _seed,
    ) = _ruleset_mutation_identity(ctx, args, tool_name="rules.resource_delta")
    request = operation["request"]
    resource_key = request.get("resource")
    declared_resources = {
        str(resource.get("key"))
        for resource in coc_rulesets.ruleset_resources(ruleset_id)
        if isinstance(resource.get("key"), str)
    }
    if not isinstance(resource_key, str) or resource_key not in declared_resources:
        raise ToolError("invalid_param", "request.resource is not declared by the ruleset")
    actor_state = coc_state.load_ruleset_actor_state(ctx.campaign_dir, actor_id)
    decisions = (
        actor_state.get("ruleset_resource_receipts")
        if ruleset_id == "coc7"
        else actor_state.get("decisions")
    )
    if decisions is None:
        decisions = {}
    if not isinstance(decisions, dict):
        raise ToolError("state_corrupt", "actor resource receipt index is invalid")
    frozen = decisions.get(decision_id)
    prior = ctx.ledger_lookup("rules.resource_delta", decision_id)
    if frozen is not None:
        if not isinstance(frozen, dict):
            raise ToolError("state_corrupt", "actor resource receipt is invalid")
        expected_integrity = _resource_receipt_integrity(frozen)
        result = frozen.get("result")
        try:
            current = coc_state.ruleset_actor_resource_value(
                ruleset_id, actor_state, resource_key
            )
        except ValueError as exc:
            raise ToolError("state_corrupt", str(exc)) from exc
        if (
            frozen.get("integrity_digest") != expected_integrity
            or frozen.get("ruleset_id") != ruleset_id
            or frozen.get("ruleset_version") != ruleset_version
            or frozen.get("actor_id") != actor_id
            or frozen.get("decision_id") != decision_id
            or frozen.get("request") != {
                "request": request, "seed": operation["seed"]
            }
            or not isinstance(result, dict)
            or result.get("resource") != resource_key
            or result.get("after") != current
        ):
            raise ToolError(
                "idempotency_conflict",
                f"decision_id {decision_id!r} owns different actor resource evidence",
            )
        if prior is not None and prior.get("data") != frozen:
            raise ToolError("state_corrupt", "toolbox ledger conflicts with actor state")
        if prior is None:
            ctx.ledger_record(decision_id, "rules.resource_delta", frozen)
        return deepcopy(frozen), [
            "duplicate decision_id: recovered the state-bound original receipt"
        ], []
    if prior is not None:
        raise ToolError(
            "state_corrupt",
            "toolbox ledger resource entry has no canonical actor-state receipt",
        )
    try:
        current = coc_state.ruleset_actor_resource_value(
            ruleset_id, actor_state, resource_key
        )
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    resolver = _rules_resolver(ctx, "resource_delta")
    try:
        result = resolver.resource_delta(
            **deepcopy(request), current=current, rng=_rng(args)
        )
    except (TypeError, ValueError) as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    if not isinstance(result, dict):
        raise ToolError("invalid_ruleset", "ruleset resource_delta must return an object")
    before, after, delta = result.get("before"), result.get("after"), result.get("delta")
    if (
        result.get("resource") != resource_key
        or not all(_is_exact_int(value) for value in (before, after, delta))
        or before != current
        or after - before != delta
    ):
        raise ToolError(
            "invalid_ruleset",
            "ruleset resource_delta returned contradictory state arithmetic",
        )
    data = {
        "schema_version": 1,
        "receipt_id": _operation_event_id(
            f"{ruleset_id}@{ruleset_version}.rules.resource_delta", decision_id
        ),
        "ruleset_id": ruleset_id,
        "ruleset_version": ruleset_version,
        "operation": "resource_delta",
        "decision_id": decision_id,
        "actor_id": actor_id,
        "investigator_id": actor_id,
        "request": {"request": deepcopy(request), "seed": operation["seed"]},
        "result": deepcopy(result),
        "state_bound": True,
    }
    data["integrity_digest"] = _resource_receipt_integrity(data)
    coc_state.write_ruleset_actor_resource_receipt(
        ctx.campaign_dir,
        actor_id,
        resource_key=resource_key,
        after=after,
        decision_id=decision_id,
        receipt=deepcopy(data),
    )
    ctx.ledger_record(decision_id, "rules.resource_delta", data)
    return data, [], []

@tool(
    "rules.skill_describe",
    "Fetch Keeper-facing skill prose from rules-json/skill-descriptions.json after the KP has narrowed candidate skills. Read-only; does not roll.",
    {
        "skill": {
            "type": "string",
            "desc": "optional canonical skill name (e.g. 'Persuade'); omit with include_selection_policy to list known entries",
        },
        "skills": {
            "type": "array",
            "desc": "optional list of candidate skill names to fetch together (e.g. interpersonal shortlist)",
        },
        "include_selection_policy": {
            "type": "boolean",
            "desc": "when true, include the interpersonal disambiguation policy (default true when fetching Charm/Fast Talk/Intimidate/Persuade)",
        },
    },
    needs_campaign=False,
)
def _tool_rules_skill_describe(ctx: Ctx, args: dict[str, Any]):
    try:
        catalog = _rules_resolver(ctx, "skill_describe").skill_describe()
    except (OSError, json.JSONDecodeError) as exc:
        raise ToolError("state_corrupt", f"skill-descriptions.json unreadable: {exc}") from exc
    if not isinstance(catalog, dict):
        raise ToolError("state_corrupt", "skill-descriptions.json must be an object")
    entries = catalog.get("skills")
    if not isinstance(entries, dict):
        raise ToolError("state_corrupt", "skill-descriptions.json missing skills object")

    requested: list[str] = []
    single = args.get("skill")
    if single is not None:
        if not isinstance(single, str) or not single.strip():
            raise ToolError("invalid_param", "skill must be a non-empty string")
        requested.append(single.strip())
    many = args.get("skills")
    if many is not None:
        if not isinstance(many, list) or not many:
            raise ToolError("invalid_param", "skills must be a non-empty array of strings")
        for item in many:
            if not isinstance(item, str) or not item.strip():
                raise ToolError("invalid_param", "skills entries must be non-empty strings")
            label = item.strip()
            if label not in requested:
                requested.append(label)

    include_policy = args.get("include_selection_policy")
    interpersonal = {"Charm", "Fast Talk", "Intimidate", "Persuade"}
    if include_policy is None:
        include_policy = (not requested) or any(name in interpersonal for name in requested)
    elif not isinstance(include_policy, bool):
        raise ToolError("invalid_param", "include_selection_policy must be a boolean")

    if not requested:
        requested = sorted(entries)

    found: dict[str, Any] = {}
    missing: list[str] = []
    by_case = {str(key).casefold(): key for key in entries}
    for name in requested:
        canonical = by_case.get(name.casefold())
        if canonical is None:
            missing.append(name)
            continue
        payload = entries[canonical]
        if not isinstance(payload, dict):
            raise ToolError("state_corrupt", f"skill description for {canonical!r} is invalid")
        found[canonical] = payload

    data: dict[str, Any] = {
        "schema_version": catalog.get("schema_version"),
        "source_note": catalog.get("source_note"),
        "requested": requested,
        "skills": found,
        "missing": missing,
        "catalog_skill_ids": sorted(entries),
    }
    if include_policy:
        policy = catalog.get("selection_policy")
        if isinstance(policy, dict):
            data["selection_policy"] = policy
    hints: list[str] = []
    if missing:
        hints.append(
            "missing entries are not yet compiled into skill-descriptions.json; "
            "adjudicate from the rulebook / authored affordance, or expand the catalog"
        )
    if found:
        hints.append(
            "KP flow: decide candidate skill(s) from player fiction → call this tool → "
            "choose the matching skill → then rules.roll; narrate what success/failure changes before clue dumps"
        )
    return data, [], hints


@tool(
    "rules.cash_assets",
    "Credit Rating to cash/assets/spending level and living standard (Table II, p.45-47). Read-only lookup; use when lifestyle, affordable purchases, or wealth-based social access matter.",
    {
        "credit_rating": {"type": "integer", "required": True, "desc": "the investigator's Credit Rating skill value"},
        "period": {"type": "string", "desc": "finance period from cash-assets.json (default '1920s')"},
    },
    needs_campaign=False,
)
def _tool_rules_cash_assets(ctx: Ctx, args: dict[str, Any]):
    credit_rating = args.get("credit_rating")
    if isinstance(credit_rating, bool) or not isinstance(credit_rating, int):
        raise ToolError("invalid_param", "credit_rating must be an integer")
    period = str(args.get("period") or "1920s").strip() or "1920s"
    try:
        data = _rules_resolver(ctx, "cash_assets").cash_assets(
            credit_rating, period=period
        )
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    return data, [], [
        "living standard is descriptive, not a ledger: items matching the investigator's station are simply owned; only spending beyond the daily level touches cash (p.45-47, p.95-97)",
        "wealth-based first impressions use the pair-bound public npc.reaction D100 (p.191); this lookup never rolls",
    ]


@tool(
    "rules.build_scale",
    "Comparative build scale and lift/throw capability (Table XV, p.279). Read-only lookup; use when size shapes the fiction — who can lift, carry, or throw whom, and how big something reads.",
    {
        "build": {"type": "integer", "desc": "single build value to look up scale examples for"},
        "actor_build": {"type": "integer", "desc": "acting being's build; with target_build, returns the lift/throw and maneuver verdict"},
        "target_build": {"type": "integer", "desc": "target being/object's build"},
    },
    needs_campaign=False,
)
def _tool_rules_build_scale(ctx: Ctx, args: dict[str, Any]):
    def _optional_int(name: str) -> int | None:
        value = args.get(name)
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, int):
            raise ToolError("invalid_param", f"{name} must be an integer")
        return value

    build = _optional_int("build")
    actor_build = _optional_int("actor_build")
    target_build = _optional_int("target_build")
    if (actor_build is None) != (target_build is None):
        raise ToolError("invalid_param", "actor_build and target_build must be given together")
    if build is None and actor_build is None:
        raise ToolError("invalid_param", "provide build, or actor_build and target_build")
    data = _rules_resolver(ctx, "build_scale").build_scale(
        build, actor_build=actor_build, target_build=target_build
    )
    return data, [], [
        "build derives from STR+SIZ via the damage-bonus-build table (p.33); this lookup never rolls",
        "a fighting maneuver against a target 3+ builds larger is physically impossible — narrate the impossibility instead of rolling (p.105)",
    ]


@tool(
    "rules.roll",
    "Contextual percentile skill/characteristic check. Requires an explicit goal, stakes, difficulty, and structured difficulty basis; returns distinct required and achieved levels.",
    {
        "investigator": {"type": "string", "desc": "investigator id (optional when party has one member)"},
        "skill": {"type": "string", "desc": "skill name on the sheet (e.g. 'Library Use')"},
        "characteristic": {"type": "string", "desc": "characteristic (STR/CON/.../SAN/LUCK) instead of a skill"},
        "target": {"type": "integer", "desc": "explicit target value override"},
        "difficulty": {"type": "string", "required": True, "desc": "required success level: regular | hard | extreme; never inferred or defaulted"},
        "goal": {"type": "string", "required": True, "desc": "the concrete fictional objective this one check may settle"},
        "stakes": {"type": "object", "required": True, "desc": "exactly {on_success, on_failure}, both non-empty player-action consequences"},
        "difficulty_basis": {"type": "string", "required": True, "desc": "authored_gate | opponent_skill | environment | keeper_judgment"},
        "bonus": {"type": "integer", "desc": "bonus dice 0-2"},
        "penalty": {"type": "integer", "desc": "penalty dice 0-2"},
        "reason": {"type": "string", "desc": "optional audit note distinct from the authoritative goal/stakes contract"},
        "npc_id": {"type": "string", "desc": "structured NPC target for a social check; required to match/consume an NPC-scoped relationship reward"},
        "fumble_consequence": {
            "type": "string",
            "desc": "predeclared meaningful complication if this roll fumbles (dice evidence)",
        },
        "resolution_context": {
            "type": "object",
            "desc": (
                "optional KP-supplied structured continuity identity: attempt_id, "
                "scene_id, route_id, roll_density_group, and optional reset_evidence. "
                "Used only for soft Push/retry/route advice; never blocks the roll"
            ),
        },
        "seed": {"type": "integer", "desc": "deterministic RNG seed (tests only)"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)
def _tool_rules_roll(ctx: Ctx, args: dict[str, Any]):
    return _roll_common(ctx, args, pushed=False, tool_name="rules.roll")


@tool(
    "rules.push",
    "Pushed re-roll bound to one ordinary-failure rules.roll receipt (never a fumble). Inherits that check's actor, target, required level, goal, stakes, basis, and dice modifiers; callers cannot substitute them.",
    {
        "original_check_decision_id": {"type": "string", "required": True, "desc": "decision_id of the failed canonical rules.roll to push"},
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
    tool_name = "rules.roll_dice"
    decision_id = str(args["decision_id"])
    operation = _roll_dice_semantic_operation(args)
    document, receipt = _existing_roll_receipt(
        ctx,
        tool_name=tool_name,
        decision_id=decision_id,
        operation=operation,
    )
    if receipt is not None:
        return _replay_roll_receipt(ctx, document, receipt)
    result = _rules_resolver(ctx, "roll_dice").roll_dice(
        str(args["expression"]), rng=_rng(args)
    )
    if args.get("reason"):
        result["reason"] = str(args["reason"])
    payload = {
        **result,
        "die_expression": result["expression"],
        "individual_faces": list(result["rolls"]),
        "final_total": result["total"],
        "roll": result["total"],
    }
    roll_record = ctx.prepare_roll({
        "event_type": "roll",
        "type": "random_table",
        "kind": "dice_expression",
        "actor": "keeper",
        "visibility": "public",
        "payload": payload,
        **result,
    })
    result["roll_id"] = roll_record["roll_id"]
    receipt = _new_roll_receipt(
        tool_name=tool_name,
        decision_id=decision_id,
        operation=operation,
        resolution={
            "expression": result["expression"],
            "count": result["count"],
            "sides": result["sides"],
            "modifier": result["modifier"],
        },
        roll_record=roll_record,
        data=result,
        warnings=[],
        hints=[],
    )
    _commit_new_roll_receipt(ctx, document, receipt)
    return result, [], []


@tool(
    "rules.opposed",
    "NON-COMBAT opposed check only: higher success level wins; ties favor the higher value. Attacks, Dodge, and Fight Back must use combat.resolve.",
    {
        "contest_kind": {
            "type": "string",
            "required": True,
            "desc": "must be noncombat; combat reactions use combat.resolve defense_kind",
        },
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
    if args.get("contest_kind") != "noncombat":
        raise ToolError(
            "invalid_param",
            "rules.opposed accepts only contest_kind=noncombat; resolve every "
            "attack, Dodge, or Fight Back through combat.resolve so the "
            "structured defense_kind owns its distinct tie rule",
        )
    prior = ctx.ledger_lookup("rules.opposed", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    investigator_id = _resolve_investigator(ctx, args)
    target, label, target_source = _resolve_target_value(ctx, investigator_id, args)
    rng = _rng(args)
    settled = _rules_resolver(ctx, "opposed").opposed(
        target, int(args["opponent_value"]), rng=rng
    )
    mine = settled["investigator_roll"]
    theirs = settled["opponent_roll"]
    winner = settled["winner"]
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
    settled = _rules_resolver(ctx, "sanity_check").sanity_check(
        current_san,
        args.get("loss_success", "0"),
        args["loss_failure"],
        rng=rng,
    )
    check = settled["check"]
    success = settled["success"]
    loss = settled["san_loss"]
    loss_detail = settled["loss_detail"]
    new_san = settled["san_after"]
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


def _rewrite_roll_visibilities(
    campaign_dir: Path,
    roll_ids: set[str],
    *,
    visibility: str,
    supersession_id: str,
    reason: str,
) -> list[str]:
    """Mark canonical roll rows as non-player-facing after a correction.

    Audit rows remain; only player-facing projection (turn.finalize, battle
    report) hides them. Returns the roll_ids that were rewritten.
    """
    path = Path(campaign_dir) / "logs" / "rolls.jsonl"
    if not path.is_file() or not roll_ids:
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    rewritten: list[str] = []
    out_lines: list[str] = []
    for raw in lines:
        if not raw.strip():
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError:
            out_lines.append(raw)
            continue
        if not isinstance(row, dict):
            out_lines.append(raw)
            continue
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        roll_id = str(
            row.get("roll_id")
            or payload.get("roll_id")
            or row.get("command_id")
            or ""
        ).strip()
        if roll_id not in roll_ids:
            out_lines.append(raw)
            continue
        row["visibility"] = visibility
        row["superseded"] = True
        row["supersession_id"] = supersession_id
        row["supersession_reason"] = reason
        if isinstance(payload, dict):
            payload = dict(payload)
            payload["visibility"] = visibility
            payload["superseded"] = True
            payload["supersession_id"] = supersession_id
            payload["supersession_reason"] = reason
            row["payload"] = payload
        out_lines.append(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
        rewritten.append(roll_id)
    coc_fileio.write_text_atomic(
        path,
        "\n".join(out_lines) + ("\n" if out_lines else ""),
        encoding="utf-8",
    )
    return rewritten


def _hide_related_hp_events(
    campaign_dir: Path,
    roll_ids: set[str],
    *,
    supersession_id: str,
    reason: str,
) -> int:
    """Hide hp_change events bound to superseded damage rolls from player view."""
    path = Path(campaign_dir) / "logs" / "events.jsonl"
    if not path.is_file() or not roll_ids:
        return 0
    lines = path.read_text(encoding="utf-8").splitlines()
    changed = 0
    out_lines: list[str] = []
    for raw in lines:
        if not raw.strip():
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError:
            out_lines.append(raw)
            continue
        if not isinstance(row, dict) or row.get("event_type") != "hp_change":
            out_lines.append(raw)
            continue
        event_roll = str(row.get("roll_id") or "").strip()
        if event_roll not in roll_ids:
            out_lines.append(raw)
            continue
        row["visibility"] = "superseded"
        row["player_facing"] = False
        row["superseded"] = True
        row["supersession_id"] = supersession_id
        row["supersession_reason"] = reason
        out_lines.append(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
        changed += 1
    if changed:
        coc_fileio.write_text_atomic(
            path,
            "\n".join(out_lines) + ("\n" if out_lines else ""),
            encoding="utf-8",
        )
    return changed


@tool(
    "state.supersede_settlement",
    "Correct a prior public settlement and hide the voided dice/HP from player-facing final output while keeping the audit trail.",
    {
        "roll_ids": {
            "type": "array",
            "required": True,
            "desc": "canonical roll_id values to hide from player-facing mechanics (damage, dodge error, etc.)",
        },
        "reason": {
            "type": "string",
            "required": True,
            "desc": "structured correction reason (e.g. same-level dodge voids hit)",
        },
        "investigator": {
            "type": "string",
            "desc": "investigator id when also reversing HP",
        },
        "restore_hp_to": {
            "type": "integer",
            "desc": "optional absolute current HP after correction (e.g. 12 when an erroneous 12→9 is voided)",
        },
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)
def _tool_state_supersede_settlement(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("state.supersede_settlement", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    raw_ids = args.get("roll_ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        raise ToolError("invalid_param", "roll_ids must be a non-empty array")
    roll_ids = {
        str(value).strip()
        for value in raw_ids
        if isinstance(value, str) and value.strip()
    }
    if not roll_ids:
        raise ToolError("invalid_param", "roll_ids must contain non-empty strings")
    reason = str(args.get("reason") or "").strip()
    if not reason:
        raise ToolError("invalid_param", "reason is required")
    supersession_id = f"supersede-{decision_id}"
    rewritten = _rewrite_roll_visibilities(
        ctx.campaign_dir,
        roll_ids,
        visibility="superseded",
        supersession_id=supersession_id,
        reason=reason,
    )
    _hide_related_hp_events(
        ctx.campaign_dir,
        roll_ids,
        supersession_id=supersession_id,
        reason=reason,
    )
    hp_receipt: dict[str, Any] | None = None
    restore_to = args.get("restore_hp_to")
    if restore_to is not None:
        if isinstance(restore_to, bool) or not isinstance(restore_to, int) or restore_to < 0:
            raise ToolError("invalid_param", "restore_hp_to must be a non-negative integer")
        investigator_id = _resolve_investigator(ctx, args)
        state = ctx.inv_state(investigator_id)
        sheet = ctx.sheet(investigator_id)
        max_hp = int((sheet.get("derived") or {}).get("HP") or 10)
        before = int(state.get("current_hp", max_hp))
        after = min(max_hp, int(restore_to))
        state["current_hp"] = after
        conditions_before = list(state.get("conditions") or [])
        conditions = list(conditions_before)
        if after > 0:
            for gone in ("dying", "unconscious"):
                if gone in conditions:
                    conditions.remove(gone)
        state["conditions"] = conditions
        ctx.save_inv_state(investigator_id, state)
        hp_receipt = {
            "investigator_id": investigator_id,
            "kind": "heal" if after >= before else "damage",
            "amount": abs(after - before),
            "hp_before": before,
            "hp_after": after,
            "max_hp": max_hp,
            "conditions_before": conditions_before,
            "conditions_after": list(conditions),
            "source": f"supersession:{supersession_id}",
            "player_facing": False,
            "superseded_correction": True,
        }
        ctx.log_event({
            "event_type": "hp_change",
            **hp_receipt,
            "visibility": "superseded",
            "supersession_id": supersession_id,
        })
    data = {
        "supersession_id": supersession_id,
        "decision_id": decision_id,
        "reason": reason,
        "requested_roll_ids": sorted(roll_ids),
        "rewritten_roll_ids": sorted(set(rewritten)),
        "hp_correction": hp_receipt,
        "player_facing_hidden": True,
    }
    ctx.log_event({
        "event_type": "settlement_superseded",
        **data,
        "ts": _now_iso(),
    })
    ctx.ledger_record(decision_id, "state.supersede_settlement", data)
    hints = [
        "superseded settlements stay in the audit log but are hidden from "
        "player-facing final mechanics and battle-report public dice"
    ]
    if hp_receipt is not None:
        hints.append(
            f"HP corrected to {hp_receipt['hp_after']} "
            f"(was {hp_receipt['hp_before']}); correction itself is non-player-facing"
        )
    return data, [], hints


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
    state = ctx.inv_state(investigator_id)
    sheet = ctx.sheet(investigator_id)
    max_hp = int((sheet.get("derived") or {}).get("HP") or 10)
    before = int(state.get("current_hp", max_hp))
    settled = _rules_resolver(ctx, "damage").damage(
        args["amount"], before, max_hp, kind=kind, rng=_rng(args)
    )
    amount = settled["amount"]
    detail = settled["roll_detail"]
    after = settled["hp_after"]
    state["current_hp"] = after
    conditions_before = list(state.get("conditions") or [])
    conditions = list(conditions_before)
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
        "conditions_before": conditions_before,
        "conditions_after": list(conditions),
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


def _luck_source_receipt_by_roll_id(
    ctx: Ctx,
    document: dict[str, Any],
    source_roll_id: str,
) -> dict[str, Any]:
    found: list[dict[str, Any]] = []
    for by_tool in (document.get("receipts") or {}).values():
        if not isinstance(by_tool, dict):
            raise ToolError("state_corrupt", "canonical roll receipt map is invalid")
        found.extend(
            receipt
            for receipt in by_tool.values()
            if isinstance(receipt, dict)
            and receipt.get("roll_id") == source_roll_id
        )
    if len(found) != 1:
        raise ToolError(
            "invalid_param",
            "source_roll_id does not identify one current canonical roll receipt",
        )
    source = found[0]
    if source.get("tool") != "rules.roll":
        raise ToolError(
            "invalid_param",
            "source roll is ineligible for Luck adjustment",
        )
    if _roll_side_effect_key(source) in document.get("pending_side_effects", {}):
        raise ToolError(
            "invalid_param",
            "source roll is not yet a fully settled current receipt",
        )
    raw = _roll_log_bytes(ctx)
    ordered, _by_effect_key = _validated_roll_document_collection(document)
    _verify_roll_receipt_prefixes(raw, ordered)
    complete, tail, index = _parse_complete_roll_frames(raw)
    if tail or complete != raw or index.get(source_roll_id) != source.get("roll_record"):
        raise ToolError(
            "state_corrupt",
            "source_roll_id is stale or diverges from its canonical public row",
        )
    if source.get("roll_record", {}).get("visibility") != "public":
        raise ToolError("invalid_param", "hidden rolls are ineligible for Luck")
    return source


def _ensure_luck_spend_receipt_effects(
    ctx: Ctx,
    receipt: dict[str, Any],
) -> None:
    expected_event = receipt["event"]
    events_path = ctx.campaign_dir / "logs" / "events.jsonl"
    matches = [
        row
        for row in _read_jsonl_records(events_path)
        if row.get("event_id") == expected_event["event_id"]
    ]
    if len(matches) > 1:
        raise ToolError("state_corrupt", "Luck spend event is duplicated")
    if matches:
        material = {key: value for key, value in matches[0].items() if key != "ts"}
        if material != expected_event:
            raise ToolError("state_corrupt", "Luck spend event contradicts its receipt")
    else:
        investigator_id = str(receipt["operation"]["investigator_id"])
        state = ctx.inv_state(investigator_id)
        current = state.get("current_luck")
        before = receipt["data"]["luck_before"]
        after = receipt["data"]["luck_after"]
        if not _is_exact_int(current) or current not in {before, after}:
            raise ToolError(
                "state_corrupt",
                "Luck state diverges from the pending adjustment receipt",
            )
        if current == before:
            state["current_luck"] = after
            ctx.save_inv_state(investigator_id, state)
        ctx.log_event(deepcopy(expected_event))
    manifest = _source_receipt_manifest(receipt)
    prior = ctx.ledger_lookup("rules.luck_spend", str(receipt["decision_id"]))
    if (
        prior is None
        or prior.get("data") != receipt["data"]
        or prior.get("source_receipt_manifest") != manifest
    ):
        ctx.ledger_record(
            str(receipt["decision_id"]),
            "rules.luck_spend",
            deepcopy(receipt["data"]),
            source_receipt_manifest=manifest,
        )


@tool(
    "rules.luck_spend",
    "Bind Luck spending to one existing canonical public rules.roll receipt; adjusts its settlement without creating another dice row.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "points": {"type": "integer", "required": True, "desc": "positive Luck points to spend"},
        "source_roll_id": {"type": "string", "required": True, "desc": "roll_id of the current canonical failed rules.roll receipt"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)
def _tool_rules_luck_spend(ctx: Ctx, args: dict[str, Any]):
    allowed = {"investigator", "points", "source_roll_id", "decision_id"}
    if set(args) - allowed or any(key not in args for key in ("points", "source_roll_id", "decision_id")):
        raise ToolError(
            "invalid_param",
            "rules.luck_spend requires only source_roll_id, points, decision_id, and optional investigator",
        )
    points = args.get("points")
    source_roll_id = args.get("source_roll_id")
    decision_id = args.get("decision_id")
    if not _is_exact_int(points) or points <= 0:
        raise ToolError("invalid_param", "points must be a positive integer")
    if not isinstance(source_roll_id, str) or not source_roll_id.strip():
        raise ToolError("invalid_param", "source_roll_id must be a non-empty string")
    if not isinstance(decision_id, str) or not decision_id.strip():
        raise ToolError("invalid_param", "decision_id must be a non-empty string")
    investigator_id = _resolve_investigator(ctx, args)
    operation = {
        "investigator_id": investigator_id,
        "source_roll_id": source_roll_id,
        "points": points,
    }
    document = _load_roll_receipt_document(ctx)
    existing = _luck_spend_receipt(document, decision_id)
    if existing is not None:
        if existing.get("fingerprint") != _operation_fingerprint(
            "rules.luck_spend", operation
        ):
            raise ToolError(
                "idempotency_conflict",
                f"decision_id '{decision_id}' was already applied to a different Luck adjustment",
            )
        source = _luck_source_receipt_by_roll_id(
            ctx,
            document,
            source_roll_id,
        )
        if existing.get("source_receipt") != _luck_source_reference(source):
            raise ToolError(
                "state_corrupt",
                "Luck adjustment receipt diverges from its current canonical source receipt",
            )
        _ensure_luck_spend_receipt_effects(ctx, existing)
        return deepcopy(existing["data"]), [
            "duplicate decision_id: recovered the original Luck source receipt"
        ], []
    if ctx.ledger_lookup("rules.luck_spend", decision_id) is not None:
        raise ToolError(
            "state_corrupt",
            "Luck ledger entry has no canonical adjustment receipt",
        )
    if any(
        receipt.get("source_receipt", {}).get("roll_id") == source_roll_id
        for receipt in document["luck_spends"].values()
        if isinstance(receipt, dict)
    ):
        raise ToolError("invalid_param", "source roll was already adjusted with Luck")
    source = _luck_source_receipt_by_roll_id(ctx, document, source_roll_id)
    if source.get("resolution", {}).get("investigator_id") != investigator_id:
        raise ToolError("invalid_param", "source roll belongs to another investigator")
    try:
        finalized_by = next(
            (
                receipt
                for receipt in coc_turn_finalization.load_finalizations(
                    ctx.campaign_dir
                )
                if source_roll_id in (receipt.get("source_roll_ids") or [])
            ),
            None,
        )
    except coc_turn_finalization.TurnContractError as exc:
        raise ToolError(exc.code, str(exc)) from exc
    if finalized_by is not None:
        raise ToolError(
            "invalid_state",
            "source roll is already frozen in a turn finalization; offer Luck "
            "before turn.finalize, or use state.supersede_settlement for an "
            "explicit correction",
        )
    state = ctx.inv_state(investigator_id)
    current_luck = state.get("current_luck")
    if not _is_exact_int(current_luck) or current_luck < 0:
        raise ToolError("state_corrupt", "current_luck must be a non-negative integer")
    try:
        adjusted = _luck_spend_data(
            source,
            points=points,
            luck_before=current_luck,
            resolver=_rules_resolver(ctx, "luck_spend"),
        )
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    receipt = _new_luck_spend_receipt(
        decision_id=decision_id,
        operation=operation,
        source_receipt=source,
        data=adjusted,
    )
    document["luck_spends"][decision_id] = deepcopy(receipt)
    _validated_roll_document_collection(document)
    _save_roll_receipt_document(ctx, document)
    _ensure_luck_spend_receipt_effects(ctx, receipt)
    return deepcopy(adjusted), [], []


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
    character_snapshot: dict[str, Any] | None = None,
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
            character_snapshot=character_snapshot,
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
    character_snapshot: dict[str, Any] | None = None,
) -> list[str]:
    """Project qualifying investigator combat rolls into toolbox tick state.

    Combat remains owned by the subsystem executor.  This consumer reads only
    its structured roll/turn receipts, binds them to skills on the reusable
    investigator sheet, and delegates eligibility to ``coc_development``.
    NPC, characteristic, damage, opposed-loser, and Luck-bought rolls therefore
    cannot enter the development stream.
    """
    snapshot = (
        character_snapshot
        if character_snapshot is not None
        else ctx.sheet(investigator_id)
    )
    sheet_skills = snapshot.get("skills") or {}
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
        if event.get("event_type") != "combat_roll":
            continue
        # Skill credit follows skill_owner, not mere presence on the turn and
        # not the action designer who only set a remote device in motion.
        skill_owner = coc_development.skill_owner_for_roll(event)
        if skill_owner != investigator_id:
            continue
        raw_skill = event.get("skill")
        if not isinstance(raw_skill, str):
            continue
        skill = canonical_skills.get(raw_skill.casefold())
        if skill is None:
            continue
        roll = deepcopy(event)
        roll["kind"] = "combat_skill"
        roll.setdefault("skill_owner_id", investigator_id)
        if event.get("actor_id") and event.get("actor_id") != investigator_id:
            roll.setdefault("executor_id", event.get("actor_id"))
        if event.get("action_designer_id"):
            roll["action_designer_id"] = event["action_designer_id"]
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
            character_snapshot=snapshot,
        ):
            if skill not in recorded:
                recorded.append(skill)
    return recorded


def _healing_tool_data(
    ctx: Ctx,
    investigator_id: str,
    results: list[dict[str, Any]],
    events: list[dict[str, Any]],
    *,
    state_before: dict[str, Any] | None = None,
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
    data = {
        "investigator_id": investigator_id,
        "event": primary,
        "results": results,
        "events": events,
        "current_hp": state.get("current_hp"),
        "conditions": list(state.get("conditions") or []),
    }
    if isinstance(state_before, dict):
        data["player_state_receipt"] = {
            "schema_version": 1,
            "investigator_id": investigator_id,
            "hp": {
                "before": state_before.get("current_hp"),
                "after": state.get("current_hp"),
            },
            "conditions_before": list(state_before.get("conditions") or []),
            "conditions_after": list(state.get("conditions") or []),
        }
    return data


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
    state_before = deepcopy(ctx.inv_state(investigator_id))
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
    request = _rules_resolver(ctx, "first_aid").first_aid(
        decision_id,
        int(args["skill_value"]),
        rescuer_id,
        pushed=pushed,
        changed_method=(
            str(args["changed_method"]).strip() if pushed else None
        ),
        failure_consequence=(
            str(args["failure_consequence"]).strip() if pushed else None
        ),
    )
    results, events = _execute_subsystem_requests(
        ctx,
        investigator_id=investigator_id,
        decision_id=decision_id,
        requests=[request],
        seed=args.get("seed"),
        tool_name="rules.first_aid",
    )
    data = _healing_tool_data(
        ctx,
        investigator_id,
        results,
        events,
        state_before=state_before,
    )
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
    state_before = deepcopy(ctx.inv_state(investigator_id))
    rescuer_id = str(args.get("rescuer_id") or investigator_id)
    results, events = _execute_subsystem_requests(
        ctx,
        investigator_id=investigator_id,
        decision_id=decision_id,
        requests=[_rules_resolver(ctx, "medicine").medicine(
            decision_id,
            int(args["skill_value"]),
            rescuer_id,
        )],
        seed=args.get("seed"),
        tool_name="rules.medicine",
    )
    data = _healing_tool_data(
        ctx,
        investigator_id,
        results,
        events,
        state_before=state_before,
    )
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
    state_before = deepcopy(ctx.inv_state(investigator_id))
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
    has_medicine = args.get("medicine_skill_value") is not None
    if not has_medicine and args.get("caregiver_id") is not None:
        raise ToolError(
            "invalid_param", "caregiver_id requires medicine_skill_value"
        )
    request = _rules_resolver(ctx, "weekly_recovery").weekly_recovery(
        decision_id,
        complete_rest,
        poor_environment,
        medicine_skill_value=(
            int(args["medicine_skill_value"]) if has_medicine else None
        ),
        caregiver_id=(
            str(args.get("caregiver_id") or investigator_id)
            if has_medicine
            else None
        ),
    )
    results, events = _execute_subsystem_requests(
        ctx,
        investigator_id=investigator_id,
        decision_id=decision_id,
        requests=[request],
        seed=args.get("seed"),
        tool_name="rules.weekly_recovery",
    )
    data = _healing_tool_data(
        ctx,
        investigator_id,
        results,
        events,
        state_before=state_before,
    )
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
    state_before = deepcopy(ctx.inv_state(investigator_id))
    clock_kind = str(args["clock_kind"])
    results, events = _execute_subsystem_requests(
        ctx,
        investigator_id=investigator_id,
        decision_id=decision_id,
        requests=[
            _rules_resolver(ctx, "dying_check").dying_check(
                decision_id, clock_kind
            )
        ],
        seed=args.get("seed"),
        tool_name="rules.dying_check",
    )
    data = _healing_tool_data(
        ctx,
        investigator_id,
        results,
        events,
        state_before=state_before,
    )
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


def _module_item(ctx: Ctx, item_id: str) -> dict[str, Any] | None:
    root = ctx.module_meta.get("module_mechanics")
    items = root.get("items") if isinstance(root, dict) else None
    row = items.get(str(item_id)) if isinstance(items, dict) else None
    return row if isinstance(row, dict) else None


def _runtime_generated_npc_mechanics(ctx: Ctx, npc_id: str) -> dict[str, Any] | None:
    document = coc_npc_state.load_npc_state(ctx.campaign_dir)
    card = (document.get("npcs") or {}).get(str(npc_id))
    mechanics = card.get("mechanics") if isinstance(card, dict) else None
    if isinstance(mechanics, dict) and mechanics.get("status") == "generated":
        return mechanics
    return None


def _with_mechanics_locator_discovery(
    ctx: Ctx,
    source_work: dict[str, Any],
    *,
    subject_kind: str,
    subject_id: str,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Expose the existing read-only locator planner for unknown source scope."""
    subject_kind = str(subject_kind or "").strip()
    subject_id = str(subject_id or "").strip()
    result = deepcopy(source_work)
    if not result.get("progressive") or result.get("ready"):
        return result, None
    root_id = str(result.get("asset_root_id") or "").strip()
    if not root_id:
        return result, None
    skeleton = coc_module_project.coc_module_assets.get_skeleton(
        ctx.root, root_id,
    ) or {}
    if str(skeleton.get("mechanics_locator_pass_status") or "") != "pending":
        return result, None
    locator = next(
        (
            row for row in (skeleton.get("mechanics_index") or [])
            if isinstance(row, dict)
            and str(row.get("subject_kind") or "") == subject_kind
            and str(row.get("subject_id") or "") == subject_id
        ),
        None,
    )
    locator_ready = (
        isinstance(locator, dict)
        and str(locator.get("locator_pass_status") or "") == "complete"
        and str(locator.get("status") or "") in {"located", "not_authored"}
    )
    if locator_ready:
        return result, None

    stub = result.get("stub") if isinstance(result.get("stub"), dict) else {}
    entity = stub.get("entity") if isinstance(stub.get("entity"), dict) else {}
    result["mechanics_locator_state"] = {
        "global_pass_status": "pending",
        "subject_locator_status": (
            "incomplete" if isinstance(locator, dict) else "missing"
        ),
        "narrative_body_refs_present": bool(
            entity.get("source_page_indices")
            or entity.get("source_refs")
            or entity.get("source_span")
        ),
        "narrative_body_refs_are_mechanics_locator": False,
    }
    card = _opening_card("progressive.prepare_opening", {}, [])
    card.update({
        "authority": "advisory",
        "hard_gate": False,
        "read_only": True,
        "required_for_opening": False,
        "purpose": "discover_mechanics_locator_window",
    })
    result["locator_discovery_operation"] = card
    return result, card


@tool(
    "mechanics.ensure",
    "Resolve one NPC or item into a source-bound mechanics profile. Authored PDF data wins; source subjects require a reviewed not-authored receipt before campaign fallback generation. Generated profiles are frozen and reused.",
    {
        "subject_kind": {
            "type": "string", "required": True, "desc": "npc | item",
        },
        "subject_id": {
            "type": "string", "required": True, "desc": "stable NPC/item id",
        },
        "purpose": {
            "type": "string", "required": True,
            "desc": "combat | check | item_use",
        },
        "fallback_archetype_id": {
            "type": "string",
            "desc": "KP-selected ordinary_adult | capable_adult | dangerous_actor; only when fallback is source-authorized",
        },
        "base_weapon_id": {
            "type": "string",
            "desc": "KP-selected comparable core weapon for a campaign-improvised item",
        },
        "label": {"type": "string", "desc": "table-language item/NPC label"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)
def _tool_mechanics_ensure(ctx: Ctx, args: dict[str, Any]):
    tool_name = "mechanics.ensure"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously resolved mechanics profile"
        ], []
    subject_kind = str(args["subject_kind"] or "").strip()
    subject_id = str(args["subject_id"] or "").strip()
    purpose = str(args["purpose"] or "").strip()
    if subject_kind not in {"npc", "item"}:
        raise ToolError("invalid_param", "subject_kind must be npc or item")
    if not subject_id:
        raise ToolError("invalid_param", "subject_id must be non-empty")
    if purpose not in {"combat", "check", "item_use"}:
        raise ToolError("invalid_param", "purpose must be combat, check, or item_use")

    if subject_kind == "npc":
        subject = _npc_by_id(ctx.npc_agendas, subject_id)
        generated = _runtime_generated_npc_mechanics(ctx, subject_id)
        if generated is not None:
            source_mechanics = (
                subject.get("mechanics") if isinstance(subject, dict) else None
            )
            conflict = None
            warnings = ["the frozen campaign profile was reused"]
            if (
                isinstance(source_mechanics, dict)
                and source_mechanics.get("status") == "authored"
            ):
                conflict = {
                    "kind": "continuity_contradiction",
                    "generated_decision_id": generated.get("decision_id"),
                    "authored_source_refs": deepcopy(
                        source_mechanics.get("source_refs") or []
                    ),
                    "disposition": "generated_profile_remains_campaign_canon_pending_kp_resolution",
                }
                document = coc_npc_state.load_npc_state(ctx.campaign_dir)
                card = (document.get("npcs") or {}).get(subject_id)
                if isinstance(card, dict):
                    card["mechanics_source_conflict"] = deepcopy(conflict)
                    coc_npc_state.save_npc_state(ctx.campaign_dir, document)
                ctx.log_event({
                    "event_type": "mechanics_source_conflict_observed",
                    "subject_kind": subject_kind,
                    "subject_id": subject_id,
                    "decision_id": decision_id,
                    **conflict,
                })
                warnings.append(
                    "later authored mechanics conflict was recorded; campaign canon was not silently overwritten"
                )
            data = {
                "status": "ready",
                "authority": "campaign_generated",
                "subject_kind": subject_kind,
                "subject_id": subject_id,
                "profile": deepcopy(generated["profile"]),
                "combat_participant": coc_mechanics.actor_combat_participant(
                    subject_id, generated["profile"], side="npc",
                ),
                "reused": True,
            }
            if conflict is not None:
                data["source_conflict"] = conflict
            ctx.ledger_record(decision_id, tool_name, data)
            return data, warnings, []
    else:
        subject = _module_item(ctx, subject_id)
        campaign_doc = ctx.campaign_mechanics()
        generated = campaign_doc["items"].get(subject_id)
        if isinstance(generated, dict):
            source_mechanics = (
                subject.get("mechanics") if isinstance(subject, dict) else None
            )
            conflict = None
            warnings = ["the frozen campaign item profile was reused"]
            if (
                isinstance(source_mechanics, dict)
                and source_mechanics.get("status") == "authored"
            ):
                conflict = {
                    "kind": "continuity_contradiction",
                    "generated_decision_id": generated.get("decision_id"),
                    "authored_source_refs": deepcopy(
                        source_mechanics.get("source_refs") or []
                    ),
                    "disposition": "generated_profile_remains_campaign_canon_pending_kp_resolution",
                }
                generated["source_conflict"] = deepcopy(conflict)
                ctx.save_campaign_mechanics(campaign_doc)
                ctx.log_event({
                    "event_type": "mechanics_source_conflict_observed",
                    "subject_kind": subject_kind,
                    "subject_id": subject_id,
                    "decision_id": decision_id,
                    **conflict,
                })
                warnings.append(
                    "later authored mechanics conflict was recorded; campaign canon was not silently overwritten"
                )
            data = {
                "status": "ready",
                "authority": "campaign_generated",
                "subject_kind": subject_kind,
                "subject_id": subject_id,
                "profile": deepcopy(generated["profile"]),
                "mechanics_ref": f"campaign-item:{subject_id}",
                "reused": True,
            }
            if conflict is not None:
                data["source_conflict"] = conflict
            ctx.ledger_record(decision_id, tool_name, data)
            return data, warnings, []

    subject = subject if isinstance(subject, dict) else {
        ("npc_id" if subject_kind == "npc" else "item_id"): subject_id,
        "origin": "improvised",
        "label": str(args.get("label") or subject_id),
    }
    mechanics = subject.get("mechanics")
    mechanics = mechanics if isinstance(mechanics, dict) else {"status": "unresolved"}
    source_status = str(mechanics.get("status") or "unresolved")
    if source_status == "authored":
        try:
            coc_mechanics.validate_mechanics_record(
                mechanics, subject_kind=subject_kind,
            )
        except coc_mechanics.MechanicsError as exc:
            raise ToolError("invalid_scenario", str(exc)) from exc
        profile = deepcopy(mechanics["profile"])
        data = {
            "status": "ready",
            "authority": "authored",
            "subject_kind": subject_kind,
            "subject_id": subject_id,
            "profile": profile,
            "source_refs": deepcopy(
                mechanics.get("source_refs") or subject.get("source_refs") or []
            ),
            "reused": True,
        }
        if subject_kind == "npc":
            data["combat_participant"] = coc_mechanics.actor_combat_participant(
                subject_id, profile, side="npc",
            )
        else:
            data["mechanics_ref"] = f"module-item:{subject_id}"
        ctx.ledger_record(decision_id, tool_name, data)
        return data, [], ["authored mechanics were selected over campaign fallback"]

    if source_status == "not_authored":
        try:
            coc_mechanics.validate_mechanics_record(
                mechanics, subject_kind=subject_kind,
            )
        except coc_mechanics.MechanicsError as exc:
            raise ToolError("invalid_scenario", str(exc)) from exc

    if not coc_mechanics.fallback_allowed(subject):
        try:
            source_work = coc_module_project.request_mechanics(
                ctx.root,
                ctx.campaign_id,
                kind=subject_kind,
                target_id=subject_id,
                title=str(args.get("label") or subject.get("name") or subject.get("label") or subject_id),
                reason=f"{purpose}_requires_mechanics",
            )
        except coc_module_project.ModuleProjectError as exc:
            raise ToolError("progressive_error", str(exc)) from exc
        source_work, locator_discovery = _with_mechanics_locator_discovery(
            ctx,
            source_work,
            subject_kind=subject_kind,
            subject_id=subject_id,
        )
        data = {
            "status": "source_work_required",
            "authority": "source_unresolved",
            "subject_kind": subject_kind,
            "subject_id": subject_id,
            "source_status": source_status,
            "source_work": source_work,
        }
        hints = [
            "do not generate over a possible authored appendix profile; fulfill the one source-bound mechanics request, then retry"
        ]
        if locator_discovery is not None:
            data["next_operation"] = deepcopy(locator_discovery)
            hints.append(
                "narrative/body source refs are not mechanics locator pages; "
                "use the read-only locator discovery operation without guessing pages"
            )
        return data, [], hints

    if subject_kind == "npc":
        archetype_id = str(args.get("fallback_archetype_id") or "").strip()
        if not archetype_id:
            raise ToolError(
                "fallback_choice_required",
                "KP must choose fallback_archetype_id after source fallback is authorized",
            )
        try:
            profile, generation_log = coc_mechanics.generate_actor_profile(
                npc_id=subject_id,
                archetype_id=archetype_id,
                campaign_id=str(ctx.campaign_id),
                reason=f"{purpose}: {args.get('label') or subject_id}",
            )
        except (coc_mechanics.MechanicsError, ValueError) as exc:
            raise ToolError("invalid_param", str(exc)) from exc
        document = coc_npc_state.load_npc_state(ctx.campaign_dir)
        card = (document.get("npcs") or {}).get(subject_id)
        card = deepcopy(card) if isinstance(card, dict) else {
            "npc_id": subject_id,
            "name": str(args.get("label") or subject.get("name") or subject_id),
            "origin": subject.get("origin") or "improvised",
        }
        card["mechanics"] = {
            "status": "generated",
            "profile": profile,
            "decision_id": decision_id,
            "source_status": source_status,
        }
        document["npcs"][subject_id] = card
        coc_npc_state.save_npc_state(ctx.campaign_dir, document)
        ctx.log_event({
            **generation_log,
            "decision_id": decision_id,
            "authority": "campaign_generated",
            "source_status": source_status,
        })
        data = {
            "status": "ready",
            "authority": "campaign_generated",
            "subject_kind": subject_kind,
            "subject_id": subject_id,
            "profile": profile,
            "combat_participant": coc_mechanics.actor_combat_participant(
                subject_id, profile, side="npc",
            ),
            "reused": False,
        }
    else:
        base_weapon_id = str(args.get("base_weapon_id") or "").strip()
        label = str(args.get("label") or subject.get("label") or subject_id)
        if base_weapon_id:
            catalog = coc_subsystem_executor.coc_combat.load_weapon_catalog()
            if base_weapon_id not in catalog:
                raise ToolError(
                    "invalid_param", f"unknown core base_weapon_id {base_weapon_id!r}",
                )
            profile = {
                "profile_kind": "weapon",
                "weapon_id": f"campaign:{subject_id}",
                "extends": base_weapon_id,
                "name": label,
                "authority": "keeper_improvisation",
            }
            coc_mechanics.validate_weapon_profile(profile)
        else:
            profile = {
                "profile_kind": "gear",
                "name": label,
                "effects": [],
                "authority": "keeper_improvisation",
            }
        campaign_doc["items"][subject_id] = {
            "profile": profile,
            "decision_id": decision_id,
            "source_status": source_status,
        }
        ctx.save_campaign_mechanics(campaign_doc)
        data = {
            "status": "ready",
            "authority": "campaign_generated",
            "subject_kind": subject_kind,
            "subject_id": subject_id,
            "profile": profile,
            "mechanics_ref": f"campaign-item:{subject_id}",
            "reused": False,
        }

    ctx.ledger_record(decision_id, tool_name, data)
    return data, [], [
        "fallback was frozen in campaign state and will be reused; later authored conflict must be recorded, never silently overwritten"
    ]


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
    "Execute one authored or KP-selected emergent combat beat through CombatSession, including reaction-specific ties, combat.json, and canonical roll evidence.",
    {
        "affordance_id": {
            "type": "string",
            "desc": "current-scene affordance whose rules_operation is combat_engagement",
        },
        "target_npc_id": {
            "type": "string",
            "desc": "present stable NPC id for an emergent attack (alternative to affordance_id)",
        },
        "investigator": {"type": "string", "desc": "investigator id"},
        "weapon_id": {
            "type": "string",
            "desc": "stable owned weapon id for a structured_player_selection route",
        },
        "weapon_effect_ids": {
            "type": "array",
            "desc": "authored weapon effect IDs whose applicability the KP has semantically established for this attack",
        },
        "defense_kind": {
            "type": "string",
            "desc": "structured reaction: dodge (ties defend) | fight_back (ties attack) | dive_for_cover | none",
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
    # Bind every character-derived consumer in this command to the same
    # marker-aware, detached file image.  A development settlement may commit
    # after this read, but it cannot make one combat command mix two accepted
    # investigator versions.
    character_snapshot = ctx.sheet(investigator_id)
    investigator_profile = _investigator_combat_profile(
        ctx,
        investigator_id,
        character_snapshot=character_snapshot,
    )
    player_state_before = _player_mechanical_snapshot(ctx, investigator_id)
    world = ctx.world()
    scene = _scene_by_id(ctx.story_graph, world.get("active_scene_id"))
    affordance_id = str(args.get("affordance_id") or "").strip()
    target_npc_id = str(args.get("target_npc_id") or "").strip()
    if bool(affordance_id) == bool(target_npc_id):
        raise ToolError(
            "invalid_param", "provide exactly one of affordance_id or target_npc_id",
        )
    if target_npc_id:
        presence_document = _load_npc_presence_document(ctx)
        live_presence = presence_document["presence"]
        active_scene_id = str(world.get("active_scene_id") or "")
        authored_ids = {
            str(value) for value in ((scene or {}).get("npc_ids") or []) if value
        }
        live = live_presence.get(target_npc_id)
        present = (
            (
                target_npc_id in authored_ids
                and not (
                    isinstance(live, dict)
                    and (
                        live.get("status") != "present"
                        or str(live.get("scene_id") or "") != active_scene_id
                    )
                )
            )
            or (
                isinstance(live, dict)
                and live.get("status") == "present"
                and str(live.get("scene_id") or "") == active_scene_id
            )
        )
        if not present:
            raise ToolError(
                "npc_not_present",
                f"NPC {target_npc_id!r} is not present in the active scene",
            )
        generated = _runtime_generated_npc_mechanics(ctx, target_npc_id)
        agenda = _npc_by_id(ctx.npc_agendas, target_npc_id) or {}
        source_mechanics = agenda.get("mechanics") if isinstance(agenda, dict) else None
        if generated is not None:
            profile = generated.get("profile")
        elif (
            isinstance(source_mechanics, dict)
            and source_mechanics.get("status") == "authored"
        ):
            profile = source_mechanics.get("profile")
        else:
            raise ToolError(
                "mechanics_not_ready",
                f"NPC {target_npc_id!r} has no ready mechanics profile; call mechanics.ensure first",
            )
        if not isinstance(profile, dict):
            raise ToolError("invalid_scenario", "ready NPC mechanics profile is malformed")
        module_weapons: list[dict[str, Any]] = []
        module_items = (
            ((ctx.module_meta.get("module_mechanics") or {}).get("items") or {})
            if isinstance(ctx.module_meta.get("module_mechanics"), dict) else {}
        )
        for item in module_items.values() if isinstance(module_items, dict) else []:
            mechanics = item.get("mechanics") if isinstance(item, dict) else None
            item_profile = mechanics.get("profile") if isinstance(mechanics, dict) else None
            if isinstance(item_profile, dict) and item_profile.get("profile_kind") == "weapon":
                weapon = deepcopy(item_profile)
                weapon.pop("profile_kind", None)
                module_weapons.append(weapon)
        route_id = f"campaign-combat:{target_npc_id}"
        opponent_weapons = list(profile.get("weapons") or [{"weapon_id": "unarmed"}])
        first_weapon = opponent_weapons[0]
        opponent_weapon_id = (
            str(first_weapon.get("weapon_id"))
            if isinstance(first_weapon, dict) else str(first_weapon)
        )
        operation = {
            "kind": "combat_engagement",
            "opponent": {
                "actor_id": target_npc_id,
                "side": "npc",
                "mechanics_profile": deepcopy(profile),
            },
            "module_weapons": module_weapons + [
                {key: deepcopy(value) for key, value in weapon.items()}
                for weapon in opponent_weapons
                if isinstance(weapon, dict) and weapon.get("weapon_id")
            ],
            "opponent_defense": "dodge",
            "opponent_weapon_id": opponent_weapon_id or "unarmed",
            "resolution_hint": "opposed_melee",
        }
        affordance_id = route_id
        affordance = {"id": route_id, "rules_operation": operation}
        scene = deepcopy(scene or {"scene_id": active_scene_id})
        scene.setdefault("affordances", []).append(affordance)
    else:
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
    selected_effect_ids = args.get("weapon_effect_ids") or []
    if not isinstance(selected_effect_ids, list) or any(
        not isinstance(value, str) or not value for value in selected_effect_ids
    ):
        raise ToolError("invalid_param", "weapon_effect_ids must be non-empty strings")
    if len(selected_effect_ids) != len(set(selected_effect_ids)):
        raise ToolError("invalid_param", "weapon_effect_ids must be unique")
    if selected_effect_ids:
        selected_weapon_id = str(args.get("weapon_id") or "").strip()
        selected_weapon = next(
            (
                weapon for weapon in investigator_profile.get("weapons") or []
                if isinstance(weapon, dict)
                and str(weapon.get("weapon_id") or "") == selected_weapon_id
            ),
            None,
        )
        effect_map = {
            str(effect.get("effect_id")): effect
            for effect in ((selected_weapon or {}).get("effects") or [])
            if isinstance(effect, dict) and effect.get("effect_id")
        }
        if not selected_weapon_id or any(
            effect_id not in effect_map for effect_id in selected_effect_ids
        ):
            raise ToolError(
                "invalid_param",
                "weapon_effect_ids must belong to the selected owned weapon",
            )
        if any(
            effect_map[effect_id].get("resolution")
            != "combat_damage_multiplier"
            for effect_id in selected_effect_ids
        ):
            raise ToolError(
                "invalid_param",
                "only combat_damage_multiplier effects can be activated by combat.resolve",
            )
    discovered = {str(value) for value in world.get("discovered_clue_ids") or []}
    missing = [
        str(value)
        for value in ((affordance or {}).get("requires_discovered_clue_ids") or [])
        if str(value) not in discovered
    ]
    if missing:
        warnings.append(
            "authored combat affordance prerequisites are not recorded: "
            + ", ".join(missing)
        )

    combat = _combat_state(ctx)
    loaded_ammunition_before = _loaded_ammunition_snapshot(
        combat, investigator_id, investigator_profile
    )
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
            rich["combat_action"] = {
                "weapon_id": str(args["weapon_id"]),
                "weapon_effect_ids": list(selected_effect_ids),
            }
        requests = coc_narrative_enrichment.build_route_operation_requests({
            "active_scene": scene or {},
            "combat_state": combat,
            "world_state": world,
            "investigator_combat_profile": investigator_profile,
            "character": character_snapshot,
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
        character_snapshot=character_snapshot,
    )
    improvement_ticks = _record_combat_improvement_ticks(
        ctx,
        investigator_id=investigator_id,
        events=events,
        character_snapshot=character_snapshot,
    )
    current = _combat_state(ctx)
    player_state_after = _player_mechanical_snapshot(ctx, investigator_id)
    loaded_ammunition_after = _loaded_ammunition_snapshot(
        current, investigator_id, investigator_profile
    )
    data = {
        "results": results,
        "events": events,
        "combat": current,
        "pending_defense": deepcopy(current.get("pending_attack")),
        "improvement_ticks_recorded": improvement_ticks,
        "player_state_receipt": _player_state_receipt(
            player_state_before,
            player_state_after,
            ammo_before=loaded_ammunition_before,
            ammo_after=loaded_ammunition_after,
        ),
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
    {
        "investigator": {
            "type": "string",
            "desc": "optional investigator whose pair-scoped NPC impressions should be projected; defaults only for a one-member party",
        },
        "since_revision": {
            "type": "string",
            "desc": "revision returned by the previous identical query; matching state returns not_modified instead of the full projection",
        },
    },
    access="query",
    read_domains=(
        "scene", "world", "pacing", "clues", "npc_presence", "npc", "time",
        "active_effects", "flags", "party", "module_archive", "module_progressive",
        "mechanics",
    ),
    recovery_domains=("flags", "time_markers", "npc", "npc_presence"),
    response_mode="full_or_not_modified",
    audit_mode="reference",
)
def _tool_scene_context(ctx: Ctx, args: dict[str, Any]):
    world = ctx.world()
    sg = ctx.story_graph
    active_id = world.get("active_scene_id")
    discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    warnings: list[str] = []
    requested_scene_id = str(args.get("scene_id") or "").strip()
    if requested_scene_id and requested_scene_id != str(active_id or ""):
        warnings.append(
            "scene.context reads only the current active scene; the supplied "
            f"scene_id {requested_scene_id!r} was ignored. Use the exact "
            "state.move_scene exit card first, then call scene.context once; "
            "do not read story-graph, clue-graph, or module asset files to preview it."
        )
    archive_meta: dict[str, Any] | None = None
    archive_packet: dict[str, Any] | None = None
    scene: dict[str, Any] | None = None
    static_npcs: dict[str, dict[str, Any]] = {}
    static_clues: dict[str, dict[str, Any]] = {}
    drilldown_refs: dict[str, Any] = {"npc": [], "clue": [], "secret": []}
    covered_domains = [
        "scene", "npc_presence", "clues", "time", "active_effects", "flags", "party",
    ]

    # Prefer the compiled archive scene shard for authored static material.
    # Live world/npc/time/effect state is always overlaid from canonical saves.
    if active_id and ctx.campaign_dir is not None:
        try:
            archive_packet = coc_compiled_archive.active_scene_static_packet(
                ctx.campaign_dir, str(active_id),
            )
            scene_shard = archive_packet["scene"]
            scene = {
                "scene_id": scene_shard["entity_id"],
                **deepcopy(scene_shard.get("player_safe") or {}),
                "on_enter": {
                    "san_triggers": deepcopy(
                        (scene_shard.get("keeper_only") or {}).get("san_triggers") or []
                    ),
                },
                "affordances": [
                    {
                        **deepcopy(row),
                        **(
                            {
                                "rules_operation": {
                                    "kind": op.get("kind"),
                                }
                            }
                            if (
                                op := next(
                                    (
                                        item
                                        for item in (
                                            (scene_shard.get("keeper_only") or {}).get(
                                                "affordance_operations"
                                            )
                                            or []
                                        )
                                        if item.get("affordance_id") == row.get("id")
                                    ),
                                    None,
                                )
                            )
                            else {}
                        ),
                    }
                    for row in (scene_shard.get("player_safe") or {}).get("affordances") or []
                    if isinstance(row, dict)
                ],
                "npc_ids": list(
                    (scene_shard.get("player_safe") or {}).get("npc_ids") or []
                ),
                "available_clues": list(
                    (scene_shard.get("player_safe") or {}).get("available_clue_ids") or []
                ),
                "parse_state": scene_shard.get("parse_state"),
                "evidence_gap": bool(scene_shard.get("evidence_gap")),
            }
            for npc_shard in archive_packet.get("npcs") or []:
                keeper_npc = npc_shard.get("keeper_only") or {}
                identity_source = (
                    keeper_npc.get("identity_source")
                    or {"npc_id": npc_shard.get("entity_id")}
                )
                static_npcs[str(npc_shard["entity_id"])] = {
                    **deepcopy(identity_source),
                    **deepcopy(npc_shard.get("player_safe") or {}),
                    # Agenda is keeper-only but meaning-bearing identity data.
                    # The archive must expose it to the same identity contract
                    # as canonical IR; omitting it made scene.context and
                    # npc.query disagree about one authored NPC.
                    "agenda": keeper_npc.get("agenda"),
                    "mechanics": deepcopy(keeper_npc.get("mechanics")),
                    "source_refs": deepcopy(
                        (npc_shard.get("provenance") or {}).get("source_refs") or []
                    ),
                    "npc_id": npc_shard["entity_id"],
                }
            for clue_shard in archive_packet.get("clues") or []:
                static_clues[str(clue_shard["entity_id"])] = {
                    **deepcopy(clue_shard.get("player_safe") or {}),
                    **{
                        key: deepcopy(value)
                        for key, value in (clue_shard.get("keeper_only") or {}).items()
                        if key in {"player_safe_summary", "localized_text", "mentions", "source_npc_ids"}
                    },
                    "clue_id": clue_shard["entity_id"],
                }
            drilldown_refs = deepcopy(archive_packet.get("drilldown_refs") or drilldown_refs)
            archive_meta = {
                "archive_revision": archive_packet.get("archive_revision"),
                "covered_domains": list(archive_packet.get("covered_domains") or []),
                "source": "compiled_archive",
            }
            # Inject keeper affordance ops from archive for mechanics block.
            scene["_archive_affordance_operations"] = deepcopy(
                (scene_shard.get("keeper_only") or {}).get("affordance_operations") or []
            )
        except coc_compiled_archive.CompiledArchiveError as exc:
            warnings.append(
                f"compiled archive unavailable ({exc.code}); falling back to scenario IR"
            )
            scene = _scene_by_id(sg, active_id)
        except Exception as exc:  # noqa: BLE001 — never block scene.context on archive
            warnings.append(
                f"compiled archive read failed; falling back to scenario IR ({exc})"
            )
            scene = _scene_by_id(sg, active_id)
    else:
        scene = _scene_by_id(sg, active_id)

    if scene is None:
        warnings.append(
            f"active scene '{active_id}' not found in story graph — use scene.map / state.move_scene"
        )

    npc_state = coc_npc_state.load_npc_state(ctx.campaign_dir)
    presence_document = _load_npc_presence_document(ctx)
    live_presence = presence_document["presence"]
    _campaign_npc_ids, campaign_names, name_conflicts = (
        _campaign_npc_projection_index(ctx, npc_state)
    )
    party_ids = ctx.party_ids()
    impression_investigator: str | None = None
    if args.get("investigator") is not None:
        impression_investigator = _resolve_investigator(ctx, args)
    elif len(party_ids) == 1:
        impression_investigator = party_ids[0]
    authored_presence_ids = [
        str(npc_id)
        for npc_id in ((scene or {}).get("npc_ids") or [])
        if str(npc_id or "").strip()
    ]
    present_npc_ids: list[str] = []
    for npc_id in authored_presence_ids:
        live = live_presence.get(npc_id)
        if live is None or (
            live.get("status") == "present"
            and str(live.get("scene_id")) == str(active_id)
        ):
            present_npc_ids.append(npc_id)
    for npc_id, live in live_presence.items():
        if (
            live.get("status") == "present"
            and str(live.get("scene_id")) == str(active_id)
            and str(npc_id) not in present_npc_ids
        ):
            present_npc_ids.append(str(npc_id))

    npcs = []
    current_npc_mechanics: dict[str, Any] = {}
    for npc_id in present_npc_ids:
        agenda = static_npcs.get(str(npc_id)) or _npc_by_id(ctx.npc_agendas, npc_id) or {}
        psych = (npc_state.get("psych") or {}).get(str(npc_id)) or {}
        normalized_psych = coc_npc_state.normalize_entry(psych)
        impression = (
            normalized_psych.get("impressions", {}).get(impression_investigator)
            if impression_investigator
            else None
        )
        identity = (
            _npc_identity_contract(agenda, str(active_id) if active_id else None)
            if agenda
            else None
        )
        mechanics = agenda.get("mechanics") if isinstance(agenda.get("mechanics"), dict) else {}
        mechanics_status = str(mechanics.get("status") or "unresolved")
        if mechanics_status == "authored" and isinstance(mechanics.get("profile"), dict):
            current_npc_mechanics[str(npc_id)] = deepcopy(mechanics["profile"])
        npcs.append({
            "npc_id": npc_id,
            "name": agenda.get("name") or campaign_names.get(str(npc_id)),
            "origin": agenda.get("origin") if agenda else "improvised",
            "agenda": agenda.get("agenda"),
            "voice": agenda.get("voice"),
            "relationship_to_investigators": agenda.get("relationship_to_investigators"),
            "social_role": deepcopy(agenda.get("social_role")),
            "role_label": agenda.get("role_label"),
            "availability": normalized_psych.get("availability") or agenda.get("availability"),
            "trust": normalized_psych.get("trust", 0),
            "fear": normalized_psych.get("fear", 0),
            "suspicion": normalized_psych.get("suspicion", 0),
            "impression": deepcopy(impression) if isinstance(impression, dict) else None,
            # scene.context is the hot path, so keep the stable identity and
            # current performance facts without embedding the full identity
            # contract a second time.  npc.query remains the exact drilldown.
            "identity_ref": (
                identity.get("identity_ref")
                if isinstance(identity, dict)
                else None
            ),
            "profile_revision_ref": (
                identity.get("profile_revision_ref")
                if isinstance(identity, dict)
                else None
            ),
            "presence": deepcopy(live_presence.get(str(npc_id))),
            "presence_source": (
                "live" if str(npc_id) in live_presence else "authored_initial"
            ),
            "mechanics_status": mechanics_status,
            "mechanics_ref": f"npc:{npc_id}",
        })
    if name_conflicts & set(present_npc_ids):
        warnings.append(
            "campaign-local first-impression receipts disagree on a present "
            "NPC display name; the earliest canonical name was preserved"
        )

    clues = []
    for clue_id in (scene or {}).get("available_clues") or []:
        clue = static_clues.get(str(clue_id)) or _clue_by_id(ctx.clue_graph, str(clue_id))
        if clue is not None:
            clues.append(_clue_public_view(clue, discovered))
        else:
            clues.append({"clue_id": clue_id, "discovered": str(clue_id) in discovered})

    candidates = coc_scene_graph.transition_candidates(active_id, sg, dict(world))
    authored_edges = list((scene or {}).get("scene_edges") or [])
    if authored_edges:
        edges = [
            {
                "to": edge.get("to"),
                "kind": edge.get("kind"),
                "when": edge.get("when"),
            }
            for edge in authored_edges
            if isinstance(edge, dict) and edge.get("to")
        ]
    else:
        edges = coc_scene_graph.derive_scene_edges(sg).get(str(active_id or ""), [])
    exits = []
    for edge in edges:
        target = str(edge["to"])
        exits.append({
            "to": target,
            "kind": edge.get("kind"),
            "when": edge.get("when"),
            "open": target in candidates,
            "operation_opportunity": {
                "operation": "state.move_scene",
                "invoke_via": "coc_invoke",
                "prefilled_arguments": {"scene_id": target},
                "missing_arguments": ["reason", "decision_id"],
                "authority": "advisory",
                "hard_gate": False,
            },
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
    try:
        exceptional_document = coc_exceptional_effects.load(ctx.campaign_dir)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    active_exceptional_effects = []
    for effect in exceptional_document["effects"].values():
        mechanics = effect.get("mechanics") or {}
        scoped_scene = mechanics.get("scene_id")
        if (
            effect.get("status") != "active"
            or (scoped_scene is not None and scoped_scene != active_id)
        ):
            continue
        active_exceptional_effects.append({
            "effect_id": effect["effect_id"],
            "direction": effect["direction"],
            "effect_kind": effect["effect_kind"],
            "player_visible_impact": effect["player_visible_impact"],
            "causal_link": effect["causal_link"],
            "boundary": deepcopy(effect["boundary"]),
            "mechanics": deepcopy(effect["mechanics"]),
            "visibility": effect["visibility"],
            "status": effect["status"],
        })
    active_exceptional_effects.sort(key=lambda row: row["effect_id"])
    # Compact keeper-facing narrative brief per party member (structured sheet
    # fields + sanity engine state only; no prose scanning). Lets the default
    # turn path see APP/CR/build/occupation/age and active madness without a
    # director.advise call.
    party_investigators = []
    for member_id in ctx.party_ids():
        try:
            member_sheet = ctx.sheet(member_id)
        except ToolError:
            warnings.append(
                f"party member '{member_id}' has no readable character sheet; "
                "skipped in party_investigators"
            )
            continue
        member_chars = member_sheet.get("characteristics") or {}
        member_derived = member_sheet.get("derived") or {}
        member_skills = member_sheet.get("skills") or {}
        member_cr_raw = member_skills.get("Credit Rating", 0)
        member_cr = int(member_cr_raw) if member_cr_raw is not None else 0
        san_signal = coc_rule_signals.read_sanity_engine_state(
            ctx.campaign_dir, member_id
        )
        madness = {
            "bout_active": bool(san_signal.get("bout_active")),
            "temporary_insane": bool(san_signal.get("temporary_insane")),
            "indefinite_insane": bool(san_signal.get("indefinite_insane")),
            "delusion_active": bool(san_signal.get("delusion_active")),
        }
        if san_signal.get("phobia"):
            madness["phobia"] = san_signal["phobia"]
        if san_signal.get("mania"):
            madness["mania"] = san_signal["mania"]
        member_luck = member_derived.get("Luck", member_chars.get("LUCK"))
        try:
            live_luck = ctx.inv_state(member_id).get("current_luck")
        except ToolError:
            live_luck = None
        if _is_exact_int(live_luck) and live_luck >= 0:
            member_luck = live_luck
        party_investigators.append({
            "investigator_id": member_id,
            "name": member_sheet.get("name"),
            "occupation": member_sheet.get("occupation"),
            "age": member_sheet.get("age"),
            "app": member_chars.get("APP"),
            "credit_rating": member_cr,
            "credit_tier": coc_rule_signals.read_credit_tier(member_cr),
            "build": member_derived.get("BUILD"),
            "mov": member_derived.get("MOV"),
            "luck": member_luck,
            "san": {
                "current": san_signal.get("current_san"),
                "max": san_signal.get("max_san"),
            },
            "cthulhu_mythos": san_signal.get("cm_value"),
            "madness": madness,
            "conditions": san_signal.get("conditions") or [],
        })
    archive_ops = (scene or {}).get("_archive_affordance_operations")
    if isinstance(archive_ops, list):
        affordance_operations = deepcopy(archive_ops)
    else:
        affordance_operations = [
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
        ]
    progressive_projection: dict[str, Any] | None = None
    if ctx.campaign_dir is not None:
        asset_root_id = coc_module_project.campaign_asset_root_id(ctx.campaign_dir)
        if asset_root_id:
            assets_mod = coc_module_project.coc_module_assets
            all_open_host_work = assets_mod.list_host_work_requests(
                ctx.root, asset_root_id, limit=None,
            )
            host_work_fields = (
                "job_id", "kind", "target_id", "priority",
                "requested_pdf_indices", "source_aspect", "deadline_class",
                "work_group_id", "dispatch_state", "dispatch_attempts",
                "cached_scope_complete",
            )
            compact_host_work = [
                {
                    key: deepcopy(row.get(key))
                    for key in host_work_fields
                    if key in row
                }
                for row in all_open_host_work
            ]
            ready_background = [
                compact
                for row, compact in zip(
                    all_open_host_work, compact_host_work, strict=True,
                )
                if row.get("dispatch_state") == "ready"
                and row.get("cached_scope_complete") is True
                and bool(row.get("requested_pdf_indices"))
            ]
            progressive_projection = {
                "asset_root_id": asset_root_id,
                "open_host_work_count": len(all_open_host_work),
                "open_host_work": compact_host_work[:3],
                "ready_for_background_count": len(ready_background),
                "blocking_micro_ready_count": sum(
                    row.get("deadline_class") == "blocking_micro"
                    for row in ready_background
                ),
                "leased_count": sum(
                    row.get("dispatch_state") == "leased"
                    for row in all_open_host_work
                ),
                "ready_background_requests": ready_background[:4],
            }
            if ready_background:
                ready_group_count = len({
                    str(row.get("work_group_id") or row.get("job_id"))
                    for row in ready_background
                })
                progressive_projection["background_takeover"] = {
                    "schema_version": 1,
                    "kind": "ready_background_source_work",
                    "authority": "advisory",
                    "hard_gate": False,
                    "claim_operation": {
                        "operation": "progressive.claim_host_work",
                        "invoke_via": "coc_invoke",
                        "prefilled_arguments": {
                            "limit": min(4, ready_group_count),
                        },
                        "missing_arguments": ["executor_id"],
                        "authority": "advisory",
                        "hard_gate": False,
                    },
                    "host_dispatch": {
                        "worker_profile": "coc-source-pack-worker",
                        "background": True,
                        "packet_binding": "one exact returned packets[] value per child",
                        "direct_submit_parent_waits": False,
                        "direct_submit_parent_result_polls": 0,
                        "direct_submit_parent_output_retrieval": False,
                        "direct_submit_parent_calls_fulfill_host_work": False,
                        "fallback_without_direct_submit": (
                            "forward exact completed results[i] once through "
                            "progressive.fulfill_host_work"
                        ),
                    },
                    "play_boundary": {
                        "player_action_gate": False,
                        "narrative_gate": False,
                        "output_gate": False,
                        "nondependent_play_may_continue": True,
                        "blocking_micro_applies_only_to_current_dependent_settlement": True,
                    },
                }
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
        "party_investigators": party_investigators,
        "tension_level": pacing.get("tension_level"),
        "turn_number": pacing.get("turn_number"),
        "time": coc_time.current_stamp(ctx.campaign_dir),
        "progressive": progressive_projection,
        "continuity": {
            "schema_version": 1,
            "keeper_only": True,
            "state_precedence": "live_over_authored_initial",
            **flag_continuity,
            "active_time_markers": active_time_markers,
            "active_exceptional_effects": active_exceptional_effects,
        },
        "exit_ready": str(active_id) in {str(s) for s in world.get("exit_ready_scene_ids") or []},
        "pending_san_triggers": [
            trigger for trigger in pending_san_triggers if trigger["status"] == "pending"
        ],
        "keeper_mechanics": {
            "secret": True,
            "affordance_operations": affordance_operations,
            "npc_profiles": current_npc_mechanics,
        },
        "action_routes": _project_action_route_cards(
            ctx, include_operation_opportunities=False
        ),
        "operation_opportunities": _open_attempt_opportunities(
            ctx, scene_id=str(active_id or "") or None,
        ),
        "compiled_archive": archive_meta or {
            "source": "scenario_ir_fallback",
            "archive_revision": None,
            "covered_domains": [],
        },
        "covered_domains": covered_domains + (
            list((archive_meta or {}).get("covered_domains") or [])
        ),
        "drilldown_refs": drilldown_refs,
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
    if data["action_routes"]:
        hints.append(
            "action_routes is the compact authored action working set: prefer direct_delivery without a roll; after semantic route selection, actions.advise returns the exact operation card; all recommendations are advisory and may be overridden by the KP"
        )
    if data["operation_opportunities"]:
        hints.append(
            "an ordinary failure still has a Push/context-change opportunity; do not fish for another roll, but this is a soft recommendation and never blocks play"
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
    if progressive_projection and progressive_projection.get(
        "background_takeover"
    ):
        hints.append(
            "progressive.background_takeover exposes exact cached source work for "
            "the existing progressive.claim_host_work operation; claim and dispatch "
            "it in the background. This is advisory and never gates player input, "
            "narration, or unrelated play; only a current settlement that depends on "
            "listed blocking_micro source may wait for that source result"
        )
    elif progressive_projection and progressive_projection["open_host_work"]:
        hints.append(
            "progressive.open_host_work is an unresolved host parsing boundary, not a "
            "completed parse; claim exact cached work for a source child. On a "
            "direct-submit host the parent does not wait, retrieve, poll, or call "
            "progressive.fulfill_host_work; only a host without direct submit uses "
            "the exact-forward fallback"
        )
    if active_exceptional_effects:
        hints.append(
            "active_exceptional_effects are canonical continuity: honor their explicit boundary. "
            "rules.roll fail-closes matching one-shot bonus/penalty dice; restrictions, "
            "conditions, and scene events remain KP-owned fictional constraints rather than hard scene gates"
        )
    if len(party_ids) > 1 and impression_investigator is None:
        hints.append(
            "scene.context has multiple investigators; pass investigator explicitly to project one pair-scoped NPC impression"
        )
    elif impression_investigator:
        hints.append(
            f"npcs_present.impression is the bounded textual memory for investigator '{impression_investigator}'; use it as semantic context, never as a hard gate"
        )
    if archive_meta and archive_meta.get("archive_revision"):
        hints.append(
            "compiled_archive supplies active-scene authored material; drilldown_refs "
            "list exact entity ids still available without rescanning the whole module"
        )
    hints.append(
        "optional pacing support: call director.advise on scene entry, after repeated approaches, or when momentum stalls; its suggestions are advisory and may be ignored"
    )
    hints.append(
        "optional enrichment support: call storylets.suggest when a personal callback or atmospheric beat would help; absence of a fitting storylet never blocks play"
    )
    return data, warnings, hints


_TURN_RECOVERY_MEANINGFUL_QUERIES = frozenset({"actions.advise"})
_TURN_RECOVERY_NON_TURN_MUTATIONS = frozenset({"session.delivery_ack"})


def _turn_recovery_meaningful_tools() -> frozenset[str]:
    """Classify recoverable turn work from registered structured authority."""
    return frozenset(
        name
        for name, spec in TOOLS.items()
        if (
            spec.get("access") == "mutation"
            and name not in _TURN_RECOVERY_NON_TURN_MUTATIONS
        )
        or name in _TURN_RECOVERY_MEANINGFUL_QUERIES
    )


@tool(
    "session.resume",
    "Load one bounded, hash-bound Keeper recovery bundle after startup, process restart, or context compaction. This is the first campaign call in a fresh host context.",
    {
        "investigator": {
            "type": "string",
            "desc": "optional investigator for pair-scoped NPC impression projection",
        },
        "host_session_id": {
            "type": "string",
            "desc": "optional host session identity when the host does not export one to child tools",
        },
        "context_epoch": {
            "type": "integer",
            "minimum": 1,
            "desc": "optional epoch from a host lifecycle notice; rejects a stale resume race",
        },
    },
    access="query",
    read_domains=_CONTINUATION_DOMAINS,
    recovery_domains=("flags", "time_markers", "npc"),
    audit_mode="reference",
)
def _tool_session_resume(ctx: Ctx, args: dict[str, Any]):
    current_host_marker = coc_host_context.current_marker(
        ctx.root, session_id=args.get("host_session_id")
    )
    requested_epoch = args.get("context_epoch")
    if (
        current_host_marker is not None
        and requested_epoch is not None
        and int(requested_epoch) != int(current_host_marker["context_epoch"])
    ):
        raise ToolError(
            "context_epoch_conflict",
            "host context changed since this session.resume request was prepared; "
            "use the current lifecycle epoch",
        )
    if (
        current_host_marker is not None
        and current_host_marker.get("ended_at") is None
        and current_host_marker.get("requires_resume") is False
        and current_host_marker.get("acknowledged_campaign_id")
        == str(ctx.campaign_id)
    ):
        acknowledged = coc_host_context.pending_projection(current_host_marker)
        if isinstance(acknowledged, dict):
            acknowledged["requires_resume"] = False
        data = _bound_session_resume_data({
            "schema_version": 1,
            "campaign_id": ctx.campaign_id,
            "mode": "already_acknowledged",
            "reuse_existing_working_set": True,
            "host_context": {"acknowledged": acknowledged},
            "next_operations": ["continue_from_existing_working_set"],
            "recovery_contract": {
                "authoritative_truth": [
                    "the bounded working set already returned for this exact host context epoch",
                    "deterministic receipts and canonical campaign state",
                ],
                "never": [
                    "rebuild campaign context again inside the same acknowledged epoch",
                    "reread saves, module files, or the full tool catalog",
                ],
            },
        })
        return data, [
            "session.resume already acknowledged this exact host context epoch; "
            "returning a no-op instead of rebuilding campaign context"
        ], [
            "reuse the working set and receipts already in model context; continue "
            "the current player turn without another recovery pass"
        ]

    pending = coc_turn_manifest.pending_manifest(ctx.campaign_dir)
    if pending is None:
        reconcile_campaign_continuity(
            ctx.campaign_dir,
            ctx=ctx,
            domains=TOOLS["session.resume"].get("recovery_domains"),
        )
    archive_recovery, archive_warnings = _recover_compiled_archive_for_resume(
        ctx.campaign_dir
    )
    revision_vector, revision_token = _continuation_revision(ctx)
    checkpoint, checkpoint_warnings = coc_continuation.ensure_latest_checkpoint(
        ctx.campaign_dir,
        revision_vector=revision_vector,
        revision_token=revision_token,
    )
    current_window = coc_turn_manifest.resume_window(
        ctx.campaign_dir,
        meaningful_tools=_turn_recovery_meaningful_tools(),
    )
    delivery = coc_continuation.delivery_projection(
        ctx.campaign_dir, checkpoint
    )
    semantic_capsule = (
        deepcopy(checkpoint["semantic_capsule"])
        if checkpoint is not None
        else coc_continuation.empty_semantic_capsule()
    )
    host_marker = coc_host_context.pending_marker(
        ctx.root, session_id=args.get("host_session_id")
    )
    host_before = coc_host_context.pending_projection(host_marker)
    unclassified_input = coc_continuation.classify_host_input(
        ctx.campaign_dir,
        coc_host_context.latest_unclassified_input(
            ctx.root,
            campaign_id=str(ctx.campaign_id),
            session_id=args.get("host_session_id"),
        ),
    )
    attempt_opportunities = _open_attempt_opportunities(
        ctx,
        scene_id=str(ctx.world().get("active_scene_id") or "") or None,
    )

    warnings = [*checkpoint_warnings, *archive_warnings]
    hints: list[str] = []
    scene_context: dict[str, Any] | None = None
    pending_output_context: dict[str, Any] | None = None
    if pending is not None:
        try:
            pending_output_context = coc_turn_finalization.build_output_context(
                ctx.campaign_dir
            )
        except coc_turn_finalization.TurnContractError as exc:
            raise ToolError(exc.code, str(exc)) from exc
        pending_output_context["narrative_opportunity"] = (
            _latest_narrative_opportunity(current_window)
        )
        mode = "pending_finalization"
        next_operations = ["turn.finalize"]
        if (
            pending_output_context.get("missing_substantive_effects")
            or pending_output_context.get("pending_modifier_consumptions")
        ):
            next_operations.insert(0, "state.exceptional_effect")
        hints.extend([
            "the journaled turn is already settled: use pending_output_context and finalize it before accepting another player action",
            "do not reroll, repeat state writes, reopen scene discovery, or regenerate deterministic mechanics",
        ])
    else:
        scene_context, scene_warnings, scene_hints = _tool_scene_context(
            ctx,
            {"investigator": args.get("investigator")},
        )
        warnings.extend(scene_warnings)
        hints.extend(scene_hints)
        if current_window["meaningful_row_count"]:
            mode = "open_turn_recovery"
            next_operations = ["continue_current_turn_from_receipts"]
            hints.insert(
                0,
                "continue semantic adjudication from current_turn.rows; reuse successful receipts by decision_id and never reroll them",
            )
        else:
            mode = "awaiting_player"
            next_operations = ["interpret_current_player_message"]
            hints.insert(
                0,
                "the campaign is ready for the current player message; use the recovered voice, scene, and unresolved threads without rereading history",
            )

    if current_window["overflow"]:
        warnings.append(
            "the current turn exceeded the bounded inline recovery budget; reference-only rows cite exact toolbox receipts and must not be guessed"
        )
    if (
        unclassified_input is not None
        and unclassified_input.get("disposition")
        == "uncommitted_unclassified"
    ):
        hints.append(
            "host_input is unclassified transport evidence only; semantically decide whether it is a player action, meta request, or something else before journaling"
        )
    if delivery["status"] == "unconfirmed":
        hints.append(
            "the previous exact Keeper output may not have reached the player; replay only delivery.exact_text byte-for-byte if absent, without any tool or state replay"
        )
    if attempt_opportunities:
        hints.append(
            "resume preserved an unresolved ordinary failure: prefer its exact Push opportunity, a changed goal, or structured reset evidence instead of repeating the same check"
        )

    data: dict[str, Any] = {
        "schema_version": 1,
        "campaign_id": ctx.campaign_id,
        "mode": mode,
        "working_set": {
            "mode": "full",
            "revision": revision_token,
            "read_domains": revision_vector,
        },
        "checkpoint": (
            {
                key: deepcopy(checkpoint[key])
                for key in (
                    "schema_version", "kind", "campaign_id", "checkpoint_id",
                    "turn_number", "status", "created_at", "source",
                    "canonical_projection", "refs", "content_sha256",
                )
                if key in checkpoint
            }
            if checkpoint is not None
            else None
        ),
        "semantic_capsule": semantic_capsule,
        "delivery": delivery,
        "current_turn": current_window,
        "pending_turn": deepcopy(pending),
        "pending_output_context": pending_output_context,
        "scene_context": scene_context,
        "host_input": unclassified_input,
        "host_context": {
            "before_resume": host_before,
            "acknowledged": None,
        },
        "operation_opportunities": attempt_opportunities,
        "compiled_archive_recovery": archive_recovery,
        "next_operations": next_operations,
        "recovery_contract": {
            "authoritative_truth": [
                "deterministic rules receipts and canonical state",
                "canonical_projection.time and scene_context.time override any time claim in summary prose",
                "turn finalization receipt and exact transcript",
                "KP-authored semantic capsule",
                "rebuildable continuation checkpoint",
            ],
            "never": [
                "reroll or reapply a successful receipt",
                "treat checkpoint prose as a second state ledger",
                "promote unclassified host input to campaign fact automatically",
                "drop scene craft, NPC agency, causality, or Table Wit after compaction",
                "derive exact elapsed time from narrative prose or expose backend clock arithmetic to the player",
            ],
        },
    }
    acknowledged = coc_host_context.acknowledge_resume(
        ctx.root,
        campaign_id=str(ctx.campaign_id),
        checkpoint_id=(
            str(checkpoint["checkpoint_id"])
            if checkpoint is not None
            else None
        ),
        session_id=args.get("host_session_id"),
        context_epoch=args.get("context_epoch"),
    )
    data["host_context"]["acknowledged"] = (
        coc_host_context.pending_projection(acknowledged)
        if acknowledged is not None
        else None
    )
    if isinstance(data["host_context"]["acknowledged"], dict):
        data["host_context"]["acknowledged"]["requires_resume"] = False
    data = _bound_session_resume_data(data)
    if data["resume_budget"]["reductions"]:
        hints.append(
            "resume projections exceeded the inline budget; use the returned exact typed read cards instead of scanning files"
        )
    return data, warnings, hints


@tool(
    "session.continuation_detail",
    "Read one exact paged section omitted from the compact session.resume working set. Use only a returned detail_operation card; never scan save files or logs.",
    {
        "section": {
            "type": "string",
            "required": True,
            "enum": [
                "recent_summaries",
                "threads",
                "confirmed_decisions",
                "do_not_repeat",
                "style_commitments",
                "current_turn",
            ],
            "desc": "exact continuation section named by session.resume",
        },
        "offset": {
            "type": "integer",
            "minimum": 0,
            "desc": "zero-based row offset (default 0)",
        },
        "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 8,
            "desc": "maximum exact rows to return (default 4, max 8)",
        },
        "ids": {
            "type": "array",
            "items": {"type": "string", "minLength": 1},
            "maxItems": 16,
            "desc": "optional exact structured ids; no prose or keyword search",
        },
    },
    access="query",
    read_domains=_CONTINUATION_DOMAINS,
    audit_mode="reference",
)
def _tool_session_continuation_detail(ctx: Ctx, args: dict[str, Any]):
    section = str(args.get("section") or "").strip()
    allowed = {
        "recent_summaries": "turn_number",
        "threads": "thread_id",
        "confirmed_decisions": "decision_id",
        "do_not_repeat": "item_id",
        "style_commitments": None,
        "current_turn": "call_index",
    }
    if section not in allowed:
        raise ToolError("invalid_param", "unknown continuation detail section")
    offset = int(args.get("offset") or 0)
    limit = int(args.get("limit") or 4)
    if offset < 0 or not 1 <= limit <= 8:
        raise ToolError(
            "invalid_param", "offset must be non-negative and limit must be 1..8"
        )
    requested_ids = args.get("ids") or []
    if (
        not isinstance(requested_ids, list)
        or len(requested_ids) > 16
        or any(not isinstance(value, str) or not value for value in requested_ids)
    ):
        raise ToolError("invalid_param", "ids must contain at most 16 exact strings")

    if section == "current_turn":
        source = coc_turn_manifest.resume_window(
            ctx.campaign_dir,
            meaningful_tools=_turn_recovery_meaningful_tools(),
        )
        rows = deepcopy(source.get("rows") or [])
        source_identity = source.get("source_digest")
    else:
        checkpoint = coc_continuation.load_latest_checkpoint(ctx.campaign_dir)
        capsule = (
            checkpoint.get("semantic_capsule")
            if isinstance(checkpoint, dict)
            else coc_continuation.empty_semantic_capsule()
        )
        rows = deepcopy(capsule.get(section) or [])
        source_identity = (
            checkpoint.get("content_sha256")
            if isinstance(checkpoint, dict)
            else None
        )
    id_field = allowed[section]
    if requested_ids:
        wanted = {str(value) for value in requested_ids}
        if id_field is None:
            rows = [row for row in rows if str(row) in wanted]
        else:
            rows = [
                row for row in rows
                if isinstance(row, dict) and str(row.get(id_field)) in wanted
            ]
    total = len(rows)
    page = rows[offset : offset + limit]
    next_offset = offset + len(page)
    data = {
        "schema_version": 1,
        "campaign_id": ctx.campaign_id,
        "section": section,
        "source_identity": source_identity,
        "section_sha256": _canonical_digest(rows),
        "offset": offset,
        "returned": len(page),
        "total": total,
        "rows": page,
        "next_offset": next_offset if next_offset < total else None,
    }
    if data["next_offset"] is not None:
        data["next_page_operation"] = {
            "operation": "session.continuation_detail",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {
                "section": section,
                "offset": data["next_offset"],
                "limit": limit,
                **({"ids": requested_ids} if requested_ids else {}),
            },
            "missing_arguments": [],
            "authority": "advisory",
            "hard_gate": False,
        }
    return data, [], [
        "this is an exact paged continuation projection; use only facts relevant to the current semantic decision and retain the compact working set",
    ]


@tool(
    "session.delivery_text",
    "Read the latest hash-bound immutable Keeper output when session.resume externalized it to stay inside the recovery byte budget.",
    {
        "finalization_id": {
            "type": "string", "required": True,
            "desc": "latest finalization identity from session.resume.delivery",
        },
        "rendered_sha256": {
            "type": "string", "required": True,
            "desc": "exact rendered hash from session.resume.delivery",
        },
    },
    access="query",
    read_domains=_CONTINUATION_DOMAINS,
    audit_mode="reference",
)
def _tool_session_delivery_text(ctx: Ctx, args: dict[str, Any]):
    receipt = coc_turn_finalization.finalization_by_id(
        ctx.campaign_dir, str(args["finalization_id"])
    )
    if (
        not isinstance(receipt, dict)
        or receipt.get("rendered_sha256") != str(args["rendered_sha256"])
    ):
        raise ToolError(
            "delivery_conflict",
            "requested delivery text does not match the canonical finalization",
        )
    return {
        "finalization_id": receipt["finalization_id"],
        "rendered_sha256": receipt["rendered_sha256"],
        "exact_text": receipt["rendered_text"],
    }, [], [
        "replay exact_text byte-for-byte only when the player did not receive it; never regenerate equivalent prose"
    ]


@tool(
    "session.delivery_ack",
    "Confirm that the latest immutable Keeper rendered_text was displayed or replayed. This never changes campaign fiction or mechanics.",
    {
        "finalization_id": {
            "type": "string", "required": True,
            "desc": "latest finalization_id returned by session.resume",
        },
        "rendered_sha256": {
            "type": "string", "required": True,
            "desc": "exact latest rendered_sha256 returned by session.resume",
        },
        "ack_kind": {
            "type": "string", "required": True,
            "enum": ["displayed", "replayed"],
            "desc": "how the host delivered the immutable text",
        },
        "source_id": {
            "type": "string", "required": True,
            "desc": "stable host delivery/event identity",
        },
        "decision_id": {
            "type": "string", "desc": "idempotency key",
        },
    },
    write_domains=("delivery",),
)
def _tool_session_delivery_ack(ctx: Ctx, args: dict[str, Any]):
    receipt = coc_continuation.acknowledge_delivery(
        ctx.campaign_dir,
        finalization_id=str(args["finalization_id"]),
        rendered_sha256=str(args["rendered_sha256"]),
        ack_kind=str(args["ack_kind"]),
        source_id=str(args["source_id"]),
    )
    return receipt, [], [
        "delivery confirmation closes transport uncertainty only; it does not create a new played turn"
    ]


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
            # Progressive track: skeleton/partial/deep (KP-only; never player-facing)
            "parse_state": scene.get("parse_state"),
            "evidence_gap": bool(scene.get("evidence_gap")),
        })
    data = {
        "active_scene_id": world.get("active_scene_id"),
        "scenes": scenes,
        "scene_history": world.get("scene_history"),
        "progressive_asset_root_id": coc_module_project.campaign_asset_root_id(
            ctx.campaign_dir
        )
        if ctx.campaign_dir is not None
        else None,
    }
    return data, [], []


_OPENING_INPUT_FIELDS = frozenset({
    "start_location_id", "opening_pdf_indices",
    "mechanics_locator_pdf_indices",
    "opening_required_npc_ids", "opening_required_secret_ids",
})
_OPENING_RESULT_CAPS = {
    "start_candidates": 64,
    "blocking": 16,
    "hard_work": 16,
    "soft_work": 32,
    "deferred": 32,
    "mutation_cards": 5,
}
_OPENING_PREPARATION_DATA_MAX_BYTES = 12 * 1024
# MCP decorates each returned mutation card with a short contract reference.
# Keep the handler payload below its public budget so the real gateway result
# remains bounded after that transport-only metadata is added.
_OPENING_PREPARATION_MCP_RESERVE_BYTES = 1024
_OPENING_SAFE_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"


def _opening_start_selector(value: Any, *, required: bool) -> str | None:
    try:
        return coc_module_project.parse_opening_start_selector(
            value,
            required=required,
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError("invalid_param", exc.message) from exc


def _opening_id_list(value: Any, field: str, *, maximum: int = 32) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not value:
        raise ToolError("invalid_param", f"{field} must be a non-empty array")
    if len(value) > maximum:
        raise ToolError("invalid_param", f"{field} accepts at most {maximum} ids")
    rows: list[str] = []
    for index, raw in enumerate(value):
        if not isinstance(raw, str) or not raw.strip():
            raise ToolError(
                "invalid_param", f"{field}[{index}] must be a non-empty string",
            )
        text = raw.strip()
        try:
            coc_module_project.coc_module_assets._require_id(
                text, f"{field}[{index}]",
            )
        except coc_module_project.coc_module_assets.ModuleAssetsError as exc:
            raise ToolError("invalid_param", str(exc)) from exc
        if text in rows:
            raise ToolError("invalid_param", f"{field} must contain unique ids")
        rows.append(text)
    return rows


def _opening_page_list(
    value: Any,
    *,
    field: str = "opening_pdf_indices",
) -> list[int] | None:
    if value is None:
        return None
    if not isinstance(value, list) or not value:
        raise ToolError(
            "invalid_param", f"{field} must contain 1..3 pages"
        )
    if len(value) > 3:
        raise ToolError(
            "invalid_param", f"{field} must contain 1..3 pages"
        )
    if any(
        isinstance(row, bool) or not isinstance(row, int) or row < 0
        for row in value
    ):
        raise ToolError(
            "invalid_param",
            f"{field} must be non-negative integers",
        )
    if len(value) != len(set(value)):
        raise ToolError(
            "invalid_param", f"{field} must not contain duplicates"
        )
    return list(value)


def _opening_card(
    operation: str,
    prefilled_arguments: dict[str, Any],
    missing_arguments: list[str],
) -> dict[str, Any]:
    return {
        "operation": operation,
        "invoke_via": "coc_invoke",
        "prefilled_arguments": deepcopy(prefilled_arguments),
        "missing_arguments": list(missing_arguments),
    }


def _opening_activation_card(start_location_id: str) -> dict[str, Any]:
    """Return the explicit, advisory initial scene activation card."""
    card = _opening_card(
        "state.move_scene",
        {
            "scene_id": start_location_id,
            "defer_initial_progressive_on_enter": True,
        },
        ["decision_id"],
    )
    card.update({"authority": "advisory", "hard_gate": False})
    return card


def _opening_skeleton_argument_contract(
    root_info: dict[str, Any],
) -> dict[str, Any]:
    """Describe the smallest source-bound Tier-1 skeleton the host must judge."""
    return {
        "schema_version": 1,
        "contract_id": "coc.progressive-opening-skeleton-argument.v1",
        "closed": True,
        "semantic_scope": "small_accepted_source_window_only",
        "guessing_allowed": False,
        "full_module_scan_allowed": False,
        "prefilled_template": {
            "schema_version": 1,
            "parse_tier": 1,
            "source": {
                key: root_info[key]
                for key in ("source_id", "file_sha256", "page_count", "producer")
            },
            "start_candidates": ["<source-grounded-location-id>"],
            "locations": [{
                "location_id": "<same-start-location-id>",
                "title": "<source-grounded-title>",
                "parse_state": "toc_only",
            }],
            "mechanics_locator_pass_status": "pending",
            "mechanics_index": [],
            "start_clock_status": "unresolved",
        },
        "first_submission_guidance": {
            "authority": "advisory",
            "hard_gate": False,
            "copy_prefilled_template": True,
            "replace_placeholders_only": True,
            "omit_optional_source_evidenced_fields": True,
        },
        "required_fields": [
            "schema_version",
            "parse_tier",
            "source",
            "start_candidates",
            "locations",
            "mechanics_locator_pass_status",
            "start_clock_status",
        ],
        "source_required_fields": [
            "source_id", "file_sha256", "page_count", "producer",
        ],
        "location_required_fields": [
            "location_id", "title", "parse_state",
        ],
        "location_parse_state_enum": sorted(
            coc_module_project.coc_module_assets.PARSE_STATES
        ),
        "optional_source_evidenced_fields": [
            "edges_provisional",
            "npc_roster",
            "item_roster",
            "start_clock",
            "start_clock_source_refs",
        ],
        "rules": [
            "start_candidates must be non-empty and each id must match a locations[].location_id",
            "mechanics_index=[] is valid while mechanics_locator_pass_status=pending",
            "for the first submission, copy the prefilled template, replace only its placeholders, and omit every optional source-evidenced field",
            "add optional roster, edges, mechanics locators, or start_clock only when supported by accepted source evidence",
            "do not guess unresolved facts or scan the full module",
        ],
    }


def _cap_opening_rows(
    data: dict[str, Any], key: str, rows: list[dict[str, Any]],
) -> None:
    cap = _OPENING_RESULT_CAPS[key]
    data[key] = rows[:cap]
    data[f"{key}_total"] = len(rows)
    data[f"{key}_returned_count"] = len(data[key])
    data[f"{key}_omitted_count"] = max(0, len(rows) - len(data[key]))


def _opening_encoded_data_bytes(data: dict[str, Any]) -> int:
    for _ in range(8):
        encoded_size = len(json.dumps(
            data, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        ).encode("utf-8"))
        if data.get("encoded_data_bytes") == encoded_size:
            return encoded_size
        data["encoded_data_bytes"] = encoded_size
    return len(json.dumps(
        data, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8"))


def _fit_opening_data_budget(
    data: dict[str, Any],
    *,
    selected_start_location_id: str | None,
) -> None:
    """Shrink optional rows in one stable order after their static caps."""
    collection_keys = (
        "start_candidates", "deferred", "soft_work", "hard_work",
        "blocking", "mutation_cards",
    )
    total_keys = {
        "start_candidates": "start_candidate_total",
        "deferred": "deferred_total",
        "soft_work": "soft_work_total",
        "hard_work": "hard_work_total",
        "blocking": "blocking_total",
        "mutation_cards": "mutation_cards_total",
    }

    def refresh_counts(key: str) -> None:
        returned = len(data.get(key) or [])
        total = int(data.get(total_keys[key]) or 0)
        prefix = "start_candidate" if key == "start_candidates" else key
        data[f"{prefix}_returned_count"] = returned
        data[f"{prefix}_omitted_count"] = max(0, total - returned)

    for key in collection_keys:
        refresh_counts(key)
    build_budget = (
        _OPENING_PREPARATION_DATA_MAX_BYTES
        - _OPENING_PREPARATION_MCP_RESERVE_BYTES
    )
    while _opening_encoded_data_bytes(data) > build_budget:
        removed = False
        for key in collection_keys:
            rows = data.get(key)
            if not isinstance(rows, list) or not rows:
                continue
            if key == "start_candidates" and selected_start_location_id:
                removable_index = next(
                    (
                        index for index in range(len(rows) - 1, -1, -1)
                        if str((rows[index] or {}).get("location_id") or "")
                        != selected_start_location_id
                    ),
                    None,
                )
                if removable_index is None:
                    continue
                rows.pop(removable_index)
            else:
                rows.pop()
            refresh_counts(key)
            removed = True
            break
        if not removed:
            code = (
                "opening_selected_candidate_too_large"
                if selected_start_location_id
                else "opening_result_too_large"
            )
            raise ToolError(
                code,
                "mandatory opening preparation data exceeds the 12 KiB budget",
            )
    _opening_encoded_data_bytes(data)


@tool(
    "progressive.prepare_opening",
    "Experimental strict read-only planner for one source-authored opening. "
    "It validates an accepted 1..3-page window and returns bounded readiness "
    "plus optional mutation cards; it never parses, queues, projects, moves, "
    "narrates, supervises background work, or gates player actions.",
    {
        "start_location_id": {
            "type": ["string", "null"], "maxLength": 128,
            "pattern": _OPENING_SAFE_ID_PATTERN,
            "desc": "optional exact structured start candidate id",
        },
        "opening_pdf_indices": {
            "type": "array", "minItems": 1, "maxItems": 3,
            "uniqueItems": True, "items": {"type": "integer", "minimum": 0},
            "desc": "optional exact host-selected contiguous accepted pages",
        },
        "mechanics_locator_pdf_indices": {
            "type": "array", "minItems": 1, "maxItems": 3,
            "uniqueItems": True, "items": {"type": "integer", "minimum": 0},
            "desc": "optional exact host-selected appendix/roster candidate pages; never required for opening",
        },
        "opening_required_npc_ids": {
            "type": "array", "minItems": 1, "maxItems": 32,
            "uniqueItems": True, "items": {"type": "string", "maxLength": 128},
            "desc": "optional present-NPC opening construction prerequisites",
        },
        "opening_required_secret_ids": {
            "type": "array", "minItems": 1, "maxItems": 32,
            "uniqueItems": True, "items": {"type": "string", "maxLength": 128},
            "desc": "optional keeper-secret opening construction prerequisites",
        },
    },
    access="query",
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
)
def _tool_progressive_prepare_opening(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    extras = set(args) - _OPENING_INPUT_FIELDS
    if extras:
        raise ToolError(
            "invalid_param",
            "progressive.prepare_opening accepts only structured opening selectors",
        )
    start_arg = _opening_start_selector(
        args.get("start_location_id"),
        required=False,
    )
    pages_arg = _opening_page_list(args.get("opening_pdf_indices"))
    locator_pages_arg = _opening_page_list(
        args.get("mechanics_locator_pdf_indices"),
        field="mechanics_locator_pdf_indices",
    )
    required_npcs = _opening_id_list(
        args.get("opening_required_npc_ids"), "opening_required_npc_ids",
    )
    required_secrets = _opening_id_list(
        args.get("opening_required_secret_ids"), "opening_required_secret_ids",
    )
    try:
        root_info = coc_module_project.resolve_opening_preparation_root(
            ctx.root, str(ctx.campaign_id),
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError(exc.code, exc.message) from exc
    assets_mod = coc_module_project.coc_module_assets
    root_id = str(root_info["asset_root_id"])
    skeleton = assets_mod.get_skeleton(ctx.root, root_id)
    data: dict[str, Any] = {
        "schema_version": 1,
        "experimental": True,
        "component_ready": True,
        "asset_root_id": root_id,
        "source": {
            key: root_info[key]
            for key in ("source_id", "file_sha256", "bundle_sha256", "page_count", "producer")
        },
        "link_state": root_info["link_state"],
        "source_window_ready": False,
        "skeleton_ready": isinstance(skeleton, dict),
        "selected_start_pack_ready": False,
        "projection_inputs_ready": False,
        "projected_selected_start_ready": False,
        "ready_to_activate": False,
        "active_scene_ready": False,
        "opening_ready": False,
        "selected_start_location_id": None,
        "source_window": None,
        "cached_page_refs": [],
        "window_origin": None,
        "ownership": {
            "kind": "diagnostic_work_planner",
            "narrator": False,
            "compiler": False,
            "semantic_model": False,
            "player_action_gate": False,
            "background_supervisor": False,
        },
        "limitations": [
            "component-ready experimental setup surface only",
            "no automatic source extraction, host callback, queue drain, or deferred-work resume",
        ],
        "contract_refs": [
            "coc.source-pack-worker.v1",
            "progressive.fulfill_host_work",
        ],
    }
    blocking: list[dict[str, Any]] = []
    hard_work: list[dict[str, Any]] = []
    soft_work: list[dict[str, Any]] = []
    deferred: list[dict[str, Any]] = []
    cards: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    selected: str | None = None
    window: dict[str, Any] | None = None
    readiness: dict[str, Any] | None = None

    if not isinstance(skeleton, dict):
        blocking.append({"code": "opening_skeleton_missing", "entity_id": root_id})
        if pages_arg is None:
            try:
                data.update(assets_mod.opening_page_candidate_catalog(
                    ctx.root,
                    root_id,
                    bundle_sha256=str(root_info["bundle_sha256"]),
                ))
            except assets_mod.ModuleAssetsError as exc:
                raise ToolError(
                    "opening_source_catalog_invalid", str(exc),
                ) from exc
        else:
            try:
                scope = assets_mod.validate_opening_source_window(
                    ctx.root,
                    root_id,
                    bundle_sha256=str(root_info["bundle_sha256"]),
                    pdf_indices=pages_arg,
                )
            except assets_mod.ModuleAssetsError as exc:
                raise ToolError(
                    "opening_source_window_invalid", str(exc),
                ) from exc
            module_root = assets_mod._module_dir(ctx.root, root_id)
            data["source_window_ready"] = True
            data["source_window"] = list(scope["pdf_indices"])
            data["window_origin"] = "host_selected_pre_skeleton"
            data["cached_page_refs"] = [
                {
                    **deepcopy(ref),
                    "path": str(
                        module_root / "pages" / f"{int(ref['pdf_index']):04d}.md"
                    ),
                }
                for ref in scope["page_refs"]
            ]
        publish_card = _opening_card(
            "progressive.publish_skeleton",
            {"asset_root_id": root_id, "source_file_sha256": root_info["file_sha256"]},
            ["skeleton"],
        )
        publish_card["skeleton_argument_contract"] = (
            _opening_skeleton_argument_contract(root_info)
        )
        cards.append(publish_card)
    else:
        candidates = coc_module_project.opening_start_candidates(skeleton)
        try:
            selected = coc_module_project.select_opening_start(
                ctx.campaign_dir, skeleton, start_arg,
            )
        except coc_module_project.OpeningPreparationError as exc:
            if exc.code == "opening_start_selection_required":
                blocking.append({"code": exc.code})
            else:
                raise ToolError(exc.code, exc.message) from exc
        if selected is not None:
            data["selected_start_location_id"] = selected
            try:
                binding_result = coc_module_project.resolve_selected_opening_binding(
                    ctx.root,
                    root_info,
                    skeleton,
                    selected,
                    pages_arg,
                    required_npc_ids=required_npcs,
                    required_secret_ids=required_secrets,
                )
                window = {
                    "window_origin": binding_result["window_origin"],
                    "scope": binding_result["scope"],
                }
                readiness = binding_result["readiness"]
            except coc_module_project.OpeningPreparationError as exc:
                if exc.code == "opening_source_window_required":
                    blocking.append({"code": exc.code, "entity_id": selected})
                else:
                    raise ToolError(exc.code, exc.message) from exc
            if window is not None:
                scope = window["scope"]
                data["source_window_ready"] = True
                data["window_origin"] = window["window_origin"]
                data["source_window"] = list(scope["pdf_indices"])
                data["cached_page_refs"] = deepcopy(scope["page_refs"][:3])
                data["selected_start_pack_ready"] = bool(readiness["ready"])
                data["projection_inputs_ready"] = bool(readiness["ready"])
                data["present_npc_ids"] = list(readiness["present_npc_ids"][:32])
                data["required_secret_status"] = list(
                    readiness["required_secret_status"][:32]
                )
                blocking.extend(deepcopy(readiness["blocking"]))
                for advisory in readiness.get("advisories") or []:
                    if (
                        not isinstance(advisory, dict)
                        or advisory.get("code") != "opening_npc_agenda_missing"
                    ):
                        continue
                    soft_work.append(deepcopy(advisory))
                    deferred.append({
                        "code": "opening_npc_agenda_deferred",
                        "entity_id": str(advisory.get("entity_id") or "")[:128],
                        "reason": "not_required_for_opening",
                    })

                all_requests = assets_mod.list_host_work_requests(
                    ctx.root, root_id, include_closed=True, limit=None,
                )
                exact_requests = [
                    row for row in all_requests
                    if row.get("kind") == "partial_opening"
                    and row.get("request_purpose") == assets_mod.FOREGROUND_OPENING_PURPOSE
                    and str(row.get("target_id") or "") == selected
                    and row.get("requested_source_scope") == scope
                ]
                open_exact = next(
                    (
                        row for row in exact_requests
                        if row.get("status") not in {"fulfilled", "cancelled", "superseded"}
                    ),
                    None,
                )
                if not readiness["ready"]:
                    hard_work.append({
                        "code": "opening_pack_required",
                        "entity_kind": "location",
                        "entity_id": selected,
                        "job_id": (open_exact or {}).get("job_id"),
                        "request_purpose": assets_mod.FOREGROUND_OPENING_PURPOSE,
                    })
                if open_exact is not None:
                    cards.append(_opening_card(
                        "progressive.fulfill_host_work",
                        {},
                        ["worker_result", "host_task_timing"],
                    ))
                elif not readiness["ready"]:
                    cards.append(_opening_card(
                        "progressive.request_opening_pack",
                        {
                            "asset_root_id": root_id,
                            "source_file_sha256": root_info["file_sha256"],
                            "start_location_id": selected,
                            "opening_pdf_indices": list(scope["pdf_indices"]),
                            "request_purpose": assets_mod.FOREGROUND_OPENING_PURPOSE,
                        },
                        [],
                    ))
                if readiness["ready"]:
                    projected_ready = (
                        coc_module_project.opening_projection_state_is_fresh(
                            ctx.root,
                            ctx.campaign_dir,
                            root_id,
                            selected,
                            scope,
                        )
                    )
                    data["projected_selected_start_ready"] = projected_ready
                    if not projected_ready:
                        blocking.append({
                            "code": "opening_projection_required",
                            "entity_id": selected,
                        })
                        cards.append(_opening_card(
                            "progressive.project_opening",
                            {
                                "asset_root_id": root_id,
                                "source_file_sha256": root_info["file_sha256"],
                                "start_location_id": selected,
                                "opening_pdf_indices": list(scope["pdf_indices"]),
                            },
                            [],
                        ))
                    world = ctx.world()
                    active_ready = (
                        projected_ready
                        and str(world.get("active_scene_id") or "") == selected
                    )
                    data["active_scene_ready"] = active_ready
                    data["ready_to_activate"] = (
                        projected_ready
                        and coc_module_project.campaign_is_pristine_for_opening(
                            ctx.campaign_dir
                        )
                    )
                    data["opening_ready"] = active_ready
                    if data["ready_to_activate"]:
                        cards.append(_opening_activation_card(selected))

                selected_job_ids = {
                    str(row.get("job_id") or "") for row in exact_requests
                }
                for row in all_requests:
                    job_id = str(row.get("job_id") or "")
                    if not job_id or job_id in selected_job_ids:
                        continue
                    soft_work.append({
                        "code": "deferred_host_work",
                        "job_id": job_id,
                        "entity_id": str(row.get("target_id") or "")[:128],
                    })
                    deferred.append({
                        "code": "not_required_for_opening",
                        "job_id": job_id,
                        "entity_id": str(row.get("target_id") or "")[:128],
                    })

        if str(skeleton.get("mechanics_locator_pass_status") or "") == "pending":
            soft_work.append({
                "code": "mechanics_locator_pass_pending",
                "required_for_opening": False,
                "hard_gate": False,
            })
            deferred.append({
                "code": "mechanics_locator_pass_deferred",
                "reason": "idle_warm_not_required_for_opening",
            })
            locator_prefill: dict[str, Any] = {
                "asset_root_id": root_id,
                "source_file_sha256": root_info["file_sha256"],
                "request_purpose": assets_mod.MECHANICS_LOCATOR_PURPOSE,
            }
            locator_missing = ["mechanics_locator_pdf_indices"]
            if locator_pages_arg is None:
                try:
                    catalog = assets_mod.opening_page_candidate_catalog(
                        ctx.root,
                        root_id,
                        bundle_sha256=str(root_info["bundle_sha256"]),
                    )
                except assets_mod.ModuleAssetsError as exc:
                    raise ToolError(
                        "mechanics_locator_source_catalog_invalid", str(exc),
                    ) from exc
                data["mechanics_locator_page_candidates"] = deepcopy(
                    catalog["opening_page_candidates"]
                )
                data["mechanics_locator_page_candidate_total"] = int(
                    catalog["opening_page_candidate_total"]
                )
                data["mechanics_locator_page_candidate_complete"] = True
                data["mechanics_locator_page_candidate_role"] = (
                    "selection_hint_only_not_provenance"
                )
            else:
                try:
                    locator_scope = assets_mod.validate_opening_source_window(
                        ctx.root,
                        root_id,
                        bundle_sha256=str(root_info["bundle_sha256"]),
                        pdf_indices=locator_pages_arg,
                    )
                except assets_mod.ModuleAssetsError as exc:
                    raise ToolError(
                        "mechanics_locator_source_window_invalid", str(exc),
                    ) from exc
                locator_prefill["mechanics_locator_pdf_indices"] = list(
                    locator_scope["pdf_indices"]
                )
                locator_missing = []
                data["mechanics_locator_source_window"] = list(
                    locator_scope["pdf_indices"]
                )
            locator_card = _opening_card(
                "progressive.request_locator_pass",
                locator_prefill,
                locator_missing,
            )
            locator_card.update({
                "authority": "advisory",
                "hard_gate": False,
                "required_for_opening": False,
                "deadline_class": "idle_warm",
            })
            cards.append(locator_card)

    selected_candidate = next(
        (row for row in candidates if row.get("location_id") == selected), None,
    )
    bounded_candidates = [
        {"location_id": str(row.get("location_id") or "")[:128],
         "title": str(row.get("title") or "")[:160]}
        for row in candidates[:_OPENING_RESULT_CAPS["start_candidates"]]
    ]
    if selected_candidate is not None and all(
        row["location_id"] != selected for row in bounded_candidates
    ):
        bounded_candidates[-1:] = [{
            "location_id": str(selected_candidate.get("location_id") or "")[:128],
            "title": str(selected_candidate.get("title") or "")[:160],
        }]
    data["start_candidates"] = bounded_candidates
    data["start_candidate_total"] = len(candidates)
    data["start_candidate_returned_count"] = len(bounded_candidates)
    data["start_candidate_omitted_count"] = max(0, len(candidates) - len(bounded_candidates))
    _cap_opening_rows(data, "blocking", blocking)
    _cap_opening_rows(data, "hard_work", hard_work)
    _cap_opening_rows(data, "soft_work", soft_work)
    _cap_opening_rows(data, "deferred", deferred)
    _cap_opening_rows(data, "mutation_cards", cards)
    data["encoded_data_budget_bytes"] = _OPENING_PREPARATION_DATA_MAX_BYTES
    data["encoded_data_bytes"] = 0
    _fit_opening_data_budget(
        data,
        selected_start_location_id=selected,
    )
    return data, [], [
        "use only the mutation cards whose prerequisites fit the current setup; "
        "this diagnostic does not impose a Keeper call sequence or gate play",
    ]


@tool(
    "progressive.publish_skeleton",
    "Experimental canonical publication of one structured source-bound skeleton. "
    "Stores validated shared module truth, then projects sparse campaign IR as a "
    "separate non-atomic phase; it never parses free prose or source pages.",
    {
        "asset_root_id": {"type": "string", "required": True, "maxLength": 128},
        "source_file_sha256": {"type": "string", "required": True, "minLength": 64, "maxLength": 64},
        "skeleton": {"type": "object", "required": True},
    },
)
def _tool_progressive_publish_skeleton(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    try:
        root_info = coc_module_project.resolve_opening_preparation_root(
            ctx.root, str(ctx.campaign_id),
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError(
            exc.code,
            exc.message,
            details={
                "status": "validation_failed", "complete": False,
                "stored": False, "projected": False,
            },
        ) from exc
    root_id = str(args.get("asset_root_id") or "").strip()
    source_sha = str(args.get("source_file_sha256") or "").strip()
    if root_id != root_info["asset_root_id"] or source_sha != root_info["file_sha256"]:
        raise ToolError(
            "opening_source_identity_mismatch",
            "publish arguments do not match the campaign-bound source root",
            details={
                "status": "validation_failed", "complete": False,
                "stored": False, "projected": False,
            },
        )
    skeleton = deepcopy(args.get("skeleton"))
    if not isinstance(skeleton, dict):
        raise ToolError(
            "invalid_param",
            "skeleton must be an object",
            details={
                "status": "validation_failed", "complete": False,
                "stored": False, "projected": False,
            },
        )
    assets_mod = coc_module_project.coc_module_assets
    try:
        stored = assets_mod.put_skeleton(ctx.root, root_id, skeleton)
    except assets_mod.SkeletonStorePhaseError as exc:
        return {
            "status": "stored_metadata_failed",
            "complete": False,
            "stored": True,
            "projected": False,
            "asset_root_id": root_id,
            "store": exc.store_result,
            "pending_phase": "parse_tier_registry_identity",
            "metadata_error": exc.metadata_error,
            "retry_card": _opening_card(
                "progressive.publish_skeleton",
                {"asset_root_id": root_id, "source_file_sha256": source_sha},
                ["skeleton"],
            ),
        }, [
            "skeleton.json committed but parse-tier registry identity did not; "
            "retry the same publication before sparse projection"
        ], []
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError(
            "invalid_param",
            str(exc),
            details={
                "status": "validation_failed", "complete": False,
                "stored": False, "projected": False,
            },
        ) from exc
    try:
        projected = coc_module_project.project_skeleton_to_campaign(
            ctx.root, str(ctx.campaign_id), root_id,
        )
    except Exception as exc:  # store truth is intentionally not rolled back
        return {
            "status": "stored_projection_failed",
            "complete": False,
            "stored": True,
            "projected": False,
            "asset_root_id": root_id,
            "store": stored,
            "projection_error": {
                "type": type(exc).__name__[:80],
                "message": str(exc)[:320],
            },
            "retry_card": _opening_card(
                "progressive.publish_skeleton",
                {"asset_root_id": root_id, "source_file_sha256": source_sha},
                ["skeleton"],
            ),
        }, [
            "skeleton storage completed but sparse projection failed; source truth was not rolled back"
        ], []
    return {
        "status": "complete",
        "complete": True,
        "stored": True,
        "projected": True,
        "asset_root_id": root_id,
        "store": stored,
        "projection": projected,
    }, [], [
        "skeleton and sparse projection are available; selected opening depth remains a separate explicit step"
    ]


@tool(
    "progressive.request_opening_pack",
    "Experimental mutation that enqueues exactly one selected-start partial opening "
    "slice over a validated 1..3-page accepted window. The queue kick only "
    "materializes host work; it does not perform semantic extraction.",
    {
        "asset_root_id": {"type": "string", "required": True, "maxLength": 128},
        "source_file_sha256": {"type": "string", "required": True, "minLength": 64, "maxLength": 64},
        "start_location_id": {
            "type": "string", "required": True,
            "minLength": 1, "maxLength": 128,
            "pattern": _OPENING_SAFE_ID_PATTERN,
        },
        "opening_pdf_indices": {
            "type": "array", "required": True, "minItems": 1, "maxItems": 3,
            "uniqueItems": True, "items": {"type": "integer", "minimum": 0},
        },
        "request_purpose": {
            "type": "string", "required": True,
            "enum": ["foreground_opening_slice"],
        },
    },
)
def _tool_progressive_request_opening_pack(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    selected_arg = _opening_start_selector(
        args.get("start_location_id"),
        required=True,
    )
    assets_mod = coc_module_project.coc_module_assets
    if args.get("request_purpose") != assets_mod.FOREGROUND_OPENING_PURPOSE:
        raise ToolError(
            "invalid_param",
            "request_purpose must equal foreground_opening_slice",
        )
    try:
        root_info = coc_module_project.resolve_opening_preparation_root(
            ctx.root, str(ctx.campaign_id),
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError(exc.code, exc.message) from exc
    root_id = str(args.get("asset_root_id") or "").strip()
    source_sha = str(args.get("source_file_sha256") or "").strip()
    if root_id != root_info["asset_root_id"] or source_sha != root_info["file_sha256"]:
        raise ToolError(
            "opening_source_identity_mismatch",
            "request arguments do not match the campaign-bound source root",
        )
    skeleton = assets_mod.get_skeleton(ctx.root, root_id)
    if not isinstance(skeleton, dict):
        raise ToolError("opening_skeleton_missing", "publish the skeleton first")
    try:
        selected = coc_module_project.select_opening_start(
            ctx.campaign_dir,
            skeleton,
            selected_arg,
        )
        binding_result = coc_module_project.resolve_selected_opening_binding(
            ctx.root,
            root_info,
            skeleton,
            selected,
            _opening_page_list(args.get("opening_pdf_indices")),
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError(exc.code, exc.message) from exc
    window = {
        "window_origin": binding_result["window_origin"],
        "scope": binding_result["scope"],
    }
    readiness = binding_result["readiness"]
    if readiness["ready"]:
        ingest_receipt = assets_mod.current_ingest_fulfillment_receipt(
            readiness.get("pack") or {}
        )
        return {
            "status": "current",
            "idempotent": True,
            "asset_root_id": root_id,
            "start_location_id": selected,
            "request_purpose": assets_mod.FOREGROUND_OPENING_PURPOSE,
            "source_scope_signature": assets_mod.opening_source_scope_signature(
                window["scope"]
            ),
            "job_id": str((ingest_receipt or {}).get("job_id") or "") or None,
            "worker_kick": {"started": False, "reason": "opening_pack_already_ready"},
        }, [], []
    try:
        stub = assets_mod.ensure_stub(
            ctx.root,
            root_id,
            "location",
            selected,
            reason="foreground_opening_slice",
        )
        queued = assets_mod.enqueue_job(
            ctx.root,
            root_id,
            kind="partial_opening",
            target_id=selected,
            priority=100,
            reason="foreground_opening_slice",
            request_purpose=assets_mod.FOREGROUND_OPENING_PURPOSE,
            requested_source_scope=window["scope"],
        )
    except assets_mod.ModuleAssetsError as exc:
        code = (
            "opening_source_scope_conflict"
            if "opening_source_scope_conflict" in str(exc)
            else "invalid_param"
        )
        raise ToolError(code, str(exc)) from exc
    job_id = str((queued.get("job") or {}).get("job_id") or "")
    open_request = next(
        (
            row
            for row in assets_mod.list_host_work_requests(
                ctx.root, root_id, include_closed=True, limit=None,
            )
            if str(row.get("job_id") or "") == job_id
        ),
        None,
    )
    return {
        "status": "queued" if queued.get("enqueued") else "coalesced",
        "idempotent": bool(queued.get("deduped")),
        "asset_root_id": root_id,
        "start_location_id": selected,
        "request_purpose": assets_mod.FOREGROUND_OPENING_PURPOSE,
        "source_scope_signature": assets_mod.opening_source_scope_signature(
            window["scope"]
        ),
        "requested_source_scope": window["scope"],
        "job_id": job_id,
        "dedupe_state": queued.get("dedupe_state"),
        "worker_kick": queued.get("worker_kick"),
        "host_request_id": (
            str((open_request or {}).get("job_id") or "") or None
        ),
        "stub_created": bool(stub.get("created")),
    }, [], [
        "the queue kick may materialize a host request; a host source worker must still return the exact partial pack"
    ]


@tool(
    "progressive.request_locator_pass",
    "Enqueue one nonblocking mechanics-locator pass over an exact host-selected "
    "contiguous 1..3-page accepted window. It never selects pages, scans the "
    "bundle, blocks opening readiness, or extracts mechanics profiles.",
    {
        "asset_root_id": {"type": "string", "required": True, "maxLength": 128},
        "source_file_sha256": {
            "type": "string", "required": True,
            "minLength": 64, "maxLength": 64,
        },
        "mechanics_locator_pdf_indices": {
            "type": "array", "required": True, "minItems": 1, "maxItems": 3,
            "uniqueItems": True, "items": {"type": "integer", "minimum": 0},
        },
        "request_purpose": {
            "type": "string", "required": True,
            "enum": ["mechanics_locator_pass"],
        },
    },
)
def _tool_progressive_request_locator_pass(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    assets_mod = coc_module_project.coc_module_assets
    if args.get("request_purpose") != assets_mod.MECHANICS_LOCATOR_PURPOSE:
        raise ToolError(
            "invalid_param", "request_purpose must equal mechanics_locator_pass",
        )
    try:
        root_info = coc_module_project.resolve_opening_preparation_root(
            ctx.root, str(ctx.campaign_id),
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError(exc.code, exc.message) from exc
    root_id = str(args.get("asset_root_id") or "").strip()
    source_sha = str(args.get("source_file_sha256") or "").strip()
    if root_id != root_info["asset_root_id"] or source_sha != root_info["file_sha256"]:
        raise ToolError(
            "mechanics_locator_source_identity_mismatch",
            "request arguments do not match the campaign-bound source root",
        )
    skeleton = assets_mod.get_skeleton(ctx.root, root_id)
    if not isinstance(skeleton, dict):
        raise ToolError("opening_skeleton_missing", "publish the skeleton first")
    if skeleton.get("mechanics_locator_pass_status") == "complete":
        return {
            "status": "current",
            "idempotent": True,
            "asset_root_id": root_id,
            "worker_kick": {"started": False, "reason": "locator_pass_complete"},
        }, [], []
    pages = _opening_page_list(
        args.get("mechanics_locator_pdf_indices"),
        field="mechanics_locator_pdf_indices",
    )
    try:
        scope = assets_mod.validate_opening_source_window(
            ctx.root,
            root_id,
            bundle_sha256=str(root_info["bundle_sha256"]),
            pdf_indices=pages,
        )
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError(
            "mechanics_locator_source_window_invalid", str(exc),
        ) from exc
    checked_scope = skeleton.get("mechanics_locator_scope")
    if (
        isinstance(checked_scope, dict)
        and str(checked_scope.get("source_file_sha256") or "").lower()
        == str(scope["file_sha256"]).lower()
        and set(scope["pdf_indices"]).issubset(
            set(checked_scope.get("pdf_indices") or [])
        )
    ):
        return {
            "status": "current",
            "idempotent": True,
            "asset_root_id": root_id,
            "request_purpose": assets_mod.MECHANICS_LOCATOR_PURPOSE,
            "requested_source_scope": scope,
            "source_scope_signature": assets_mod.opening_source_scope_signature(scope),
            "job_id": None,
            "worker_kick": {
                "started": False,
                "reason": "locator_window_already_reviewed",
            },
            "required_for_opening": False,
            "hard_gate": False,
            "deadline_class": "idle_warm",
        }, [], []
    try:
        queued = assets_mod.enqueue_job(
            ctx.root,
            root_id,
            kind="locate_mechanics_index",
            target_id=assets_mod.MECHANICS_LOCATOR_TARGET_ID,
            priority=20,
            reason=assets_mod.MECHANICS_LOCATOR_PURPOSE,
            request_purpose=assets_mod.MECHANICS_LOCATOR_PURPOSE,
            requested_source_scope=scope,
        )
    except assets_mod.ModuleAssetsError as exc:
        code = (
            "mechanics_locator_source_scope_conflict"
            if "mechanics_locator_source_scope_conflict" in str(exc)
            else "mechanics_locator_source_window_invalid"
        )
        raise ToolError(code, str(exc)) from exc
    job_id = str((queued.get("job") or {}).get("job_id") or "")
    return {
        "status": "queued" if queued.get("enqueued") else "coalesced",
        "idempotent": bool(queued.get("deduped")),
        "asset_root_id": root_id,
        "request_purpose": assets_mod.MECHANICS_LOCATOR_PURPOSE,
        "requested_source_scope": scope,
        "source_scope_signature": assets_mod.opening_source_scope_signature(scope),
        "job_id": job_id,
        "dedupe_state": queued.get("dedupe_state"),
        "worker_kick": queued.get("worker_kick"),
        "required_for_opening": False,
        "hard_gate": False,
        "deadline_class": "idle_warm",
    }, [], [
        "claim/spawn/forward this exact packet opportunistically; opening and ordinary play remain available",
    ]


@tool(
    "progressive.project_opening",
    "Experimental selected-only projection of one durable, current opening pack. "
    "Accepts no pack payload, never compiles alternate starts, and refuses stale "
    "projection writes after play has begun.",
    {
        "asset_root_id": {"type": "string", "required": True, "maxLength": 128},
        "source_file_sha256": {"type": "string", "required": True, "minLength": 64, "maxLength": 64},
        "start_location_id": {
            "type": "string", "required": True,
            "minLength": 1, "maxLength": 128,
            "pattern": _OPENING_SAFE_ID_PATTERN,
        },
        "opening_pdf_indices": {
            "type": "array", "minItems": 1, "maxItems": 3,
            "uniqueItems": True,
            "items": {"type": "integer", "minimum": 0},
            "desc": "optional exact qualified selected opening page window",
        },
    },
)
def _tool_progressive_project_opening(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    selected_arg = _opening_start_selector(
        args.get("start_location_id"),
        required=True,
    )
    pages_arg = _opening_page_list(args.get("opening_pdf_indices"))
    try:
        result = coc_module_project.project_selected_opening(
            ctx.root,
            str(ctx.campaign_id),
            str(args.get("asset_root_id") or ""),
            str(args.get("source_file_sha256") or ""),
            selected_arg,
            pages_arg,
        )
    except coc_module_project.OpeningPreparationError as exc:
        raise ToolError(exc.code, exc.message) from exc
    except coc_module_project.ModuleProjectError as exc:
        raise ToolError("opening_projection_failed", str(exc)) from exc
    if coc_module_project.campaign_is_pristine_for_opening(ctx.campaign_dir):
        result["activation_operation"] = _opening_activation_card(
            str(result.get("start_location_id") or selected_arg)
        )
    return result, [], [
        "selected authored opening projection is current; activation remains an explicit scene mutation"
    ]


@tool(
    "progressive.request_deepen",
    "Player-dig path for progressive modules: ensure a named_only stub, coalesce one reusable host deep-extract, "
    "and return host_hints / evidence_gap status. Use when the investigator materially pursues a "
    "place, NPC, clue, or handout that is only mentioned or stubbed — without moving scenes. "
    "Never invent deep bodies; never keyword-scan free prose (pass structured kind+id only).",
    {
        "kind": {
            "type": "string",
            "required": True,
            "desc": "location | npc | clue | handout | threat",
        },
        "target_id": {
            "type": "string",
            "required": True,
            "desc": "stable entity id (e.g. gypsy-hillside-camp, npc-carlos-mendoza)",
        },
        "title": {
            "type": "string",
            "desc": "optional display label for the stub (table language ok)",
        },
        "reason": {
            "type": "string",
            "desc": "why dig was requested (logged on the queue job)",
        },
    },
)
def _tool_progressive_request_deepen(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    try:
        result = coc_module_project.request_deepen(
            ctx.root,
            ctx.campaign_id,
            kind=str(args["kind"]),
            target_id=str(args["target_id"]),
            title=str(args["title"]) if args.get("title") else None,
            reason=str(args.get("reason") or "player_dig"),
        )
    except coc_module_project.ModuleProjectError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    except Exception as exc:
        raise ToolError("progressive_error", f"request_deepen failed: {exc}") from exc
    hints = list(result.get("host_hints") or [])
    if result.get("skipped"):
        hints.append("campaign is not on the progressive asset track")
    status = result.get("status") or {}
    if status.get("deep_ready"):
        hints.append(
            f"{args['kind']}:{args['target_id']} already deep — merge/process if not yet in IR"
        )
    elif not result.get("skipped"):
        hints.append(
            "play may continue with skeleton/stub; do not fabricate handout/secret bodies "
            "while evidence_gap or dig_pending is set"
        )
    return result, [], hints


@tool(
    "progressive.request_mechanics",
    "Request one source-first NPC/item mechanics lookup without reparsing its narrative body. Exact appendix/chapter pages are cached and same-page subjects are batched.",
    {
        "kind": {"type": "string", "required": True, "desc": "npc | item"},
        "target_id": {"type": "string", "required": True, "desc": "stable subject id"},
        "title": {"type": "string", "desc": "optional table-language label"},
        "reason": {"type": "string", "desc": "structured reason for the source lookup"},
    },
)
def _tool_progressive_request_mechanics(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    try:
        result = coc_module_project.request_mechanics(
            ctx.root,
            ctx.campaign_id,
            kind=str(args["kind"]),
            target_id=str(args["target_id"]),
            title=str(args.get("title") or "") or None,
            reason=str(args.get("reason") or "mechanics_required"),
        )
    except coc_module_project.ModuleProjectError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    result, _locator_discovery = _with_mechanics_locator_discovery(
        ctx,
        result,
        subject_kind=str(args["kind"]),
        subject_id=str(args["target_id"]),
    )
    return result, [], list(result.get("host_hints") or [])


@tool(
    "progressive.follow_mentions",
    "Enqueue deepen jobs from a structured mentions list "
    "[{kind, ref_id, raw_label?}]. For KP/host use when a deep pack, handout index, "
    "or dig yields explicit entity refs. Never pass free prose to scan.",
    {
        "mentions": {
            "type": "array",
            "required": True,
            "desc": "list of {kind, ref_id, raw_label?}",
        },
        "reason": {
            "type": "string",
            "desc": "queue reason label",
        },
    },
)
def _tool_progressive_follow_mentions(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    mentions = args.get("mentions")
    if not isinstance(mentions, list):
        raise ToolError("invalid_param", "mentions must be an array")
    try:
        result = coc_module_project.follow_structured_mentions(
            ctx.root,
            ctx.campaign_id,
            mentions,
            reason=str(args.get("reason") or "structured_mention"),
        )
    except coc_module_project.ModuleProjectError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    except Exception as exc:
        raise ToolError("progressive_error", f"follow_mentions failed: {exc}") from exc
    return result, [], list(result.get("host_hints") or [])


@tool(
    "progressive.register_source_bundle",
    "Validate and register one later host-PDF page window for the campaign's "
    "existing progressive asset root. This caches reviewed pages only; it does "
    "not parse PDF bytes or compile semantic entity packs.",
    {
        "source_bundle_path": {
            "type": "string",
            "required": True,
            "desc": "absolute path to one host-produced source-bundle directory",
        },
    },
)
def _tool_progressive_register_source_bundle(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    root_id = coc_module_project.campaign_asset_root_id(ctx.campaign_dir)
    if not root_id:
        raise ToolError("invalid_param", "campaign is not progressive")
    assets_mod = coc_module_project.coc_module_assets
    try:
        result = assets_mod.register_source_bundle(
            ctx.root,
            Path(str(args.get("source_bundle_path") or "")).expanduser().resolve(),
            asset_root_id=root_id,
        )
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    if str(result.get("asset_root_id") or "") != root_id:
        raise ToolError(
            "source_identity_mismatch",
            "source bundle resolved to a different progressive asset root",
        )
    return result, [], [
        "reviewed pages are now cached; claim background host work again so its "
        "exact cached_page_refs refresh without reopening the PDF",
    ]


@tool(
    "progressive.claim_host_work",
    "Atomically lease up to four exact cached-page work groups for bounded "
    "host-native source-pack subagents. Returns bare coc.source-pack-worker.v1 "
    "packets; children never write campaign/module state and the parent Keeper "
    "must submit accepted packs through progressive.fulfill_host_work.",
    {
        "executor_id": {
            "type": "string",
            "required": True,
            "desc": "stable host/session executor id used for leases and recovery",
        },
        "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 4,
            "desc": "maximum independent exact-page work groups to lease (default 1)",
        },
        "lease_seconds": {
            "type": "integer",
            "minimum": 30,
            "maximum": 3600,
            "desc": "crash-recovery lease duration (default 600 seconds)",
        },
    },
)
def _tool_progressive_claim_host_work(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    root_id = coc_module_project.campaign_asset_root_id(ctx.campaign_dir)
    if not root_id:
        raise ToolError("invalid_param", "campaign is not progressive")
    assets_mod = coc_module_project.coc_module_assets
    try:
        result = assets_mod.claim_host_work_requests(
            ctx.root,
            root_id,
            executor_id=str(args.get("executor_id") or ""),
            limit=args.get("limit", 1),
            lease_seconds=args.get("lease_seconds", 600),
            cached_only=True,
        )
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    hints = [
        "spawn one background source-pack child per returned packet and continue "
        "play; give the child that one bare packet without transcript or prose wrapper",
        "when the host exposes direct submit, the child submits itself and the parent "
        "never waits, polls, retrieves output, or calls progressive.fulfill_host_work; "
        "only an adapter without direct submit inspects once later and forwards each "
        "exact results[i] unchanged through that fallback operation",
    ]
    if not result.get("packets"):
        hints.append(
            "no exact cached-page group is ready; unresolved or uncached requests "
            "remain visible in progressive.status for a bounded host PDF window"
        )
    return result, [], hints


@tool(
    "progressive.fulfill_host_work",
    "Submit one exact source-worker result for an open progressive parsing request. "
    "This is the canonical closure path: it validates the request/entity binding, "
    "marks the handoff fulfilled, and re-enqueues campaign merge work.",
    {
        "worker_result": {
            "type": "object",
            "properties": {
                "job_id": {"type": "string"},
                "pack": {"type": "object"},
                "related_packs": {"type": "array"},
            },
            "required_fields": ["job_id", "pack", "related_packs"],
            "additionalProperties": False,
            "desc": (
                "preferred exact child results[i] object; pass it unchanged as "
                "one value and never combine it with legacy job_id/pack/related_packs"
            ),
        },
        "job_id": {
            "type": "string",
            "desc": "legacy explicit job id; mutually exclusive with worker_result",
        },
        "pack": {
            "type": "object",
            "desc": "legacy explicit pack; mutually exclusive with worker_result",
        },
        "related_packs": {
            "type": "array",
            "desc": "legacy optional same-page batch; mutually exclusive with worker_result",
        },
        "host_task_timing": {
            "type": "object",
            "properties": {
                "started_at": {"type": "string"},
                "completed_at": {"type": "string"},
                "duration_ms": {"type": "integer", "minimum": 0},
                "task_id": {"type": "string"},
            },
            "required_fields": [
                "started_at", "completed_at", "duration_ms", "task_id",
            ],
            "desc": "optional exact host-runtime metadata from the completed background task; never model-authored",
        },
    },
)
def _tool_progressive_fulfill_host_work(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    root_id = coc_module_project.campaign_asset_root_id(ctx.campaign_dir)
    if not root_id:
        raise ToolError("invalid_param", "campaign is not progressive")
    return _fulfill_host_work_for_asset(ctx, args, root_id=root_id)


def _source_submit_lock_path(ctx: Ctx) -> Path:
    assets_mod = coc_module_project.coc_module_assets
    return assets_mod.assets_root(ctx.root) / ".source-submit.lock"


def _fulfill_host_work_for_asset(
    ctx: Ctx, args: dict[str, Any], *, root_id: str,
):
    """Serialize both parent and source-scoped calls through one strict core."""
    try:
        with coc_fileio.advisory_file_lock(_source_submit_lock_path(ctx)):
            return _fulfill_host_work_for_asset_unlocked(
                ctx, args, root_id=root_id,
            )
    except coc_fileio.CampaignLockError as exc:
        raise ToolError("campaign_busy", str(exc)) from exc


def _fulfill_host_work_for_asset_unlocked(
    ctx: Ctx, args: dict[str, Any], *, root_id: str,
):
    assets_mod = coc_module_project.coc_module_assets

    # The preferred path keeps the source child's closed result item intact at
    # the host boundary.  Unwrap it once here, then run the unchanged strict
    # locator/mechanics/body validation below.  Legacy explicit arguments stay
    # available for older callers but may never be merged with this envelope.
    if "worker_result" in args:
        mixed_fields = [
            field for field in ("job_id", "pack", "related_packs")
            if field in args
        ]
        if mixed_fields:
            raise ToolError(
                "invalid_param",
                "worker_result is mutually exclusive with legacy "
                "job_id/pack/related_packs arguments",
            )
        worker_result = args.get("worker_result")
        if not isinstance(worker_result, dict):
            raise ToolError("invalid_param", "worker_result must be an object")
        if set(worker_result) != {"job_id", "pack", "related_packs"}:
            raise ToolError(
                "invalid_source_worker_pack",
                "worker_result must contain exactly job_id, pack, and related_packs",
            )
        exact_result = deepcopy(worker_result)
        if not str(exact_result.get("job_id") or "").strip():
            raise ToolError(
                "invalid_source_worker_pack",
                "worker_result.job_id must be a non-empty string",
            )
        effective_args = exact_result
        if "host_task_timing" in args:
            effective_args["host_task_timing"] = deepcopy(
                args.get("host_task_timing")
            )
        args = effective_args
    elif "job_id" not in args or "pack" not in args:
        raise ToolError(
            "invalid_param",
            "provide worker_result or the legacy job_id and pack arguments",
        )

    job_id = str(args.get("job_id") or "").strip()
    requests = assets_mod.list_host_work_requests(
        ctx.root, root_id, include_closed=True, limit=512,
    )
    request = next(
        (row for row in requests if str(row.get("job_id") or "") == job_id),
        None,
    )
    if request is None:
        raise ToolError("not_found", f"host-work job {job_id!r} was not found")
    if request.get("status") in {"fulfilled", "cancelled", "superseded"}:
        raise ToolError(
            "invalid_state",
            f"host-work job {job_id!r} is already {request.get('status')}",
        )
    job_kind = str(request.get("kind") or "")
    mechanics_job = job_kind in {
        "resolve_npc_mechanics", "resolve_item_mechanics",
    }
    entity_kind = assets_mod._job_entity_kind(job_kind)
    target_id = str(request.get("target_id") or "").strip()
    if job_kind != "locate_mechanics_index" and (not entity_kind or not target_id):
        raise ToolError("invalid_state", "host-work request has no entity binding")
    pack = deepcopy(args.get("pack"))
    if not isinstance(pack, dict):
        raise ToolError(
            "invalid_source_worker_pack"
            if job_kind == "locate_mechanics_index" or mechanics_job
            else "invalid_param",
            "pack must be an object",
        )
    measured_host_timing = None
    leased_at = str(request.get("leased_at") or "").strip()
    if leased_at:
        completed_dt = datetime.now(timezone.utc)
        try:
            started_dt = datetime.fromisoformat(leased_at)
        except ValueError as exc:
            raise ToolError(
                "invalid_state", "leased host-work has an invalid leased_at timestamp",
            ) from exc
        if started_dt.tzinfo is None:
            started_dt = started_dt.replace(tzinfo=timezone.utc)
        supplied_timing = args.get("host_task_timing")
        if supplied_timing is not None:
            if not isinstance(supplied_timing, dict):
                raise ToolError("invalid_param", "host_task_timing must be an object")
            try:
                task_started = datetime.fromisoformat(
                    str(supplied_timing.get("started_at") or "")
                )
                task_completed = datetime.fromisoformat(
                    str(supplied_timing.get("completed_at") or "")
                )
            except ValueError as exc:
                raise ToolError(
                    "invalid_param",
                    "host_task_timing started_at/completed_at must be ISO datetimes",
                ) from exc
            if task_started.tzinfo is None:
                task_started = task_started.replace(tzinfo=timezone.utc)
            if task_completed.tzinfo is None:
                task_completed = task_completed.replace(tzinfo=timezone.utc)
            duration_ms = supplied_timing.get("duration_ms")
            task_id = str(supplied_timing.get("task_id") or "").strip()
            if (
                isinstance(duration_ms, bool)
                or not isinstance(duration_ms, int)
                or duration_ms < 0
                or not task_id
            ):
                raise ToolError(
                    "invalid_param",
                    "host_task_timing requires non-negative duration_ms and task_id",
                )
            derived_ms = round(
                (task_completed - task_started).total_seconds() * 1000
            )
            if derived_ms < 0 or abs(derived_ms - duration_ms) > 1500:
                raise ToolError(
                    "invalid_param",
                    "host_task_timing duration does not match start/end metadata",
                )
            if task_started < started_dt - timedelta(seconds=5):
                raise ToolError(
                    "invalid_param",
                    "host task started before its source-work lease",
                )
            if task_completed > completed_dt + timedelta(seconds=5):
                raise ToolError(
                    "invalid_param",
                    "host task completion is in the future",
                )
            measured_host_timing = {
                "started_at": task_started.isoformat(),
                "completed_at": task_completed.isoformat(),
                "duration_ms": duration_ms,
                "producer": "host_background_subagent",
                "measurement": "exact_host_task_runtime",
                "task_id": task_id,
            }
        else:
            measured_host_timing = {
                "started_at": started_dt.isoformat(),
                "completed_at": completed_dt.isoformat(),
                "duration_ms": max(
                    0, round((completed_dt - started_dt).total_seconds() * 1000),
                ),
                "producer": "host_background_subagent",
                "measurement": "lease_to_fulfill_upper_bound",
            }
        # Timing is host/repository evidence. A language model must not invent
        # or override its own wall-clock receipt.
        pack["host_timing"] = measured_host_timing

    if job_kind == "locate_mechanics_index":
        if args.get("related_packs") not in (None, []):
            raise ToolError(
                "invalid_source_worker_pack",
                "locator fulfillment requires related_packs=[]",
            )
        if request.get("request_purpose") != assets_mod.MECHANICS_LOCATOR_PURPOSE:
            raise ToolError(
                "invalid_state", "locator request purpose is not mechanics_locator_pass",
            )
        try:
            exact_scope = assets_mod.validate_opening_source_scope(
                ctx.root, root_id, request.get("requested_source_scope"),
            )
        except assets_mod.ModuleAssetsError as exc:
            raise ToolError("invalid_state", str(exc)) from exc
        expected_signature = assets_mod.opening_source_scope_signature(exact_scope)
        if (
            request.get("requested_pdf_indices") != exact_scope["pdf_indices"]
            or str(request.get("source_scope_signature") or "")
            != expected_signature
        ):
            raise ToolError(
                "mechanics_locator_source_scope_mismatch",
                "locator request no longer matches its exact accepted source scope",
            )
        expected_locator_scope = {
            "scope_kind": "explicit_pdf_indices",
            "pdf_indices": list(exact_scope["pdf_indices"]),
            "source_file_sha256": exact_scope["file_sha256"],
        }
        allowed_pack_fields = {
            "mechanics_locator_pass_status",
            "mechanics_locator_scope",
            "npc_roster",
            "item_roster",
            "mechanics_index",
            "host_timing",
        }
        required_pack_fields = allowed_pack_fields - {"host_timing"}
        if set(pack) - allowed_pack_fields:
            raise ToolError(
                "invalid_source_worker_pack",
                "locator pack contains unsupported fields",
            )
        if not required_pack_fields <= set(pack):
            raise ToolError(
                "invalid_source_worker_pack",
                "locator pack is missing required fields",
            )
        if pack.get("mechanics_locator_pass_status") != "pending":
            raise ToolError(
                "invalid_source_worker_pack",
                "bounded locator pack must keep global pass pending",
            )
        if pack.get("mechanics_locator_scope") != expected_locator_scope:
            raise ToolError(
                "invalid_source_worker_pack",
                "locator pack scope must equal the leased exact page window",
            )
        for collection in ("npc_roster", "item_roster", "mechanics_index"):
            if not isinstance(pack.get(collection), list):
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"locator pack {collection} must be an array",
                )
        requested_indices = set(exact_scope["pdf_indices"])
        request_refs = {
            int(ref["pdf_index"]): {
                "source_id": str(ref.get("source_id") or ""),
                "pdf_index": int(ref["pdf_index"]),
                "text_sha256": str(ref.get("text_sha256") or ""),
            }
            for ref in (request.get("cached_page_refs") or [])
            if isinstance(ref, dict) and isinstance(ref.get("pdf_index"), int)
        }
        if set(request_refs) != requested_indices:
            raise ToolError(
                "invalid_state", "locator request lacks its complete leased cache refs",
            )

        def locator_source_bound_row(
            incoming: Any,
            *,
            field: str,
            allowed_fields: set[str],
        ) -> dict[str, Any]:
            if not isinstance(incoming, dict) or set(incoming) != allowed_fields:
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field} must contain exactly its allowed and required fields",
                )
            try:
                indices = assets_mod._source_indices(incoming, field=field)
            except assets_mod.ModuleAssetsError as exc:
                raise ToolError("invalid_source_worker_pack", str(exc)) from exc
            if not indices or not set(indices) <= requested_indices:
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field} must stay inside the leased exact page window",
                )
            expected_refs = [request_refs[index] for index in indices]
            supplied_refs = incoming.get("source_refs")
            if (
                not isinstance(supplied_refs, list)
                or len(supplied_refs) != len(indices)
                or not all(isinstance(ref, dict) for ref in supplied_refs)
            ):
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field}.source_refs must exactly match its page indices",
                )
            supplied_minimal = [
                {
                    "source_id": str(ref.get("source_id") or ""),
                    "pdf_index": ref.get("pdf_index"),
                    "text_sha256": str(ref.get("text_sha256") or ""),
                }
                for ref in supplied_refs if isinstance(ref, dict)
            ]
            if supplied_minimal != expected_refs:
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field}.source_refs must match the selected cached refs",
                )
            result = deepcopy(incoming)
            result["source_page_indices"] = list(indices)
            result["source_refs"] = expected_refs
            return result

        npc_additions: list[dict[str, Any]] = []
        for index, incoming in enumerate(pack.get("npc_roster") or []):
            row = locator_source_bound_row(
                incoming,
                field=f"locator.npc_roster[{index}]",
                allowed_fields={
                    "npc_id", "names", "parse_state",
                    "source_page_indices", "source_refs",
                },
            )
            try:
                assets_mod._require_id(row.get("npc_id"), f"npc_roster[{index}].npc_id")
            except assets_mod.ModuleAssetsError as exc:
                raise ToolError("invalid_source_worker_pack", str(exc)) from exc
            if row.get("parse_state") != "named_only":
                raise ToolError(
                    "invalid_source_worker_pack",
                    "locator npc roster additions must be named_only",
                )
            if not isinstance(row.get("names"), list) or not row["names"] or not all(
                isinstance(name, str) and name.strip() for name in row["names"]
            ):
                raise ToolError(
                    "invalid_source_worker_pack",
                    "locator npc roster additions require names",
                )
            npc_additions.append(row)

        item_additions: list[dict[str, Any]] = []
        for index, incoming in enumerate(pack.get("item_roster") or []):
            row = locator_source_bound_row(
                incoming,
                field=f"locator.item_roster[{index}]",
                allowed_fields={
                    "item_id", "label", "parse_state",
                    "source_page_indices", "source_refs",
                },
            )
            try:
                assets_mod._require_id(row.get("item_id"), f"item_roster[{index}].item_id")
            except assets_mod.ModuleAssetsError as exc:
                raise ToolError("invalid_source_worker_pack", str(exc)) from exc
            if row.get("parse_state") != "named_only" or not str(
                row.get("label") or ""
            ).strip():
                raise ToolError(
                    "invalid_source_worker_pack",
                    "locator item roster additions require label and parse_state=named_only",
                )
            item_additions.append(row)

        locator_rows: list[dict[str, Any]] = []
        locator_keys: set[tuple[str, str]] = set()
        for index, incoming in enumerate(pack.get("mechanics_index") or []):
            row = locator_source_bound_row(
                incoming,
                field=f"locator.mechanics_index[{index}]",
                allowed_fields={
                    "subject_kind", "subject_id", "status",
                    "locator_pass_status", "locator_scope",
                    "source_page_indices", "source_refs",
                },
            )
            subject_kind = str(row.get("subject_kind") or "")
            subject_id = str(row.get("subject_id") or "").strip()
            try:
                assets_mod._require_id(subject_id, f"mechanics_index[{index}].subject_id")
            except assets_mod.ModuleAssetsError as exc:
                raise ToolError("invalid_source_worker_pack", str(exc)) from exc
            key = (subject_kind, subject_id)
            if subject_kind not in {"npc", "item"} or key in locator_keys:
                raise ToolError(
                    "invalid_source_worker_pack",
                    "locator rows require unique npc/item subjects",
                )
            if (
                row.get("status") != "located"
                or row.get("locator_pass_status") != "complete"
                or row.get("locator_scope") != expected_locator_scope
            ):
                raise ToolError(
                    "invalid_source_worker_pack",
                    "bounded locator rows must be complete+located in the exact leased scope",
                )
            locator_keys.add(key)
            locator_rows.append(row)
        addition_keys = [
            *(('npc', str(row.get("npc_id") or "")) for row in npc_additions),
            *(('item', str(row.get("item_id") or "")) for row in item_additions),
        ]
        if len(addition_keys) != len(set(addition_keys)):
            raise ToolError(
                "invalid_source_worker_pack", "locator roster additions must be unique",
            )
        if not set(addition_keys) <= locator_keys:
            raise ToolError(
                "invalid_source_worker_pack",
                "locator roster additions require a matching located row",
            )
        current = assets_mod.get_skeleton(ctx.root, root_id)
        if not isinstance(current, dict):
            raise ToolError("invalid_state", "canonical skeleton is missing")
        if current.get("mechanics_locator_pass_status") == "complete":
            raise ToolError("invalid_state", "canonical locator pass is already complete")
        merged = deepcopy(current)
        for collection, id_field, additions in (
            ("npc_roster", "npc_id", npc_additions),
            ("item_roster", "item_id", item_additions),
        ):
            existing_rows = list(merged.get(collection) or [])
            existing_ids = {
                str(row.get(id_field) or "")
                for row in existing_rows if isinstance(row, dict)
            }
            existing_rows.extend(
                deepcopy(row) for row in additions
                if str(row.get(id_field) or "") not in existing_ids
            )
            merged[collection] = existing_rows
        roster_keys = {
            ("npc", str(row.get("npc_id") or ""))
            for row in merged.get("npc_roster") or [] if isinstance(row, dict)
        } | {
            ("item", str(row.get("item_id") or ""))
            for row in merged.get("item_roster") or [] if isinstance(row, dict)
        }
        if not locator_keys <= roster_keys:
            raise ToolError(
                "invalid_source_worker_pack",
                "each locator row must bind to the merged roster",
            )
        existing_locators = [
            deepcopy(row) for row in merged.get("mechanics_index") or []
            if isinstance(row, dict)
            and (
                str(row.get("subject_kind") or ""),
                str(row.get("subject_id") or ""),
            ) not in locator_keys
        ]
        merged["mechanics_index"] = [*existing_locators, *deepcopy(locator_rows)]
        merged["mechanics_locator_pass_status"] = "pending"
        prior_scope = merged.get("mechanics_locator_scope")
        accumulated_indices = set(exact_scope["pdf_indices"])
        if isinstance(prior_scope, dict):
            accumulated_indices.update(prior_scope.get("pdf_indices") or [])
        merged["mechanics_locator_scope"] = {
            "scope_kind": "explicit_pdf_indices",
            "pdf_indices": sorted(accumulated_indices),
            "source_file_sha256": exact_scope["file_sha256"],
        }
        started_put = time.perf_counter()
        try:
            put_result = assets_mod.put_skeleton(ctx.root, root_id, merged)
            repository_put_ms = max(
                0, round((time.perf_counter() - started_put) * 1000),
            )
            assets_mod.mark_locator_host_work_fulfilled(
                ctx.root,
                root_id,
                host_work_job_id=job_id,
                repository_put_ms=repository_put_ms,
            )
        except assets_mod.ModuleAssetsError as exc:
            raise ToolError("invalid_param", str(exc)) from exc
        return {
            "asset_root_id": root_id,
            "job_id": job_id,
            "request_status": "fulfilled",
            "locator_rows_merged": len(locator_rows),
            "npc_roster_additions": len(npc_additions),
            "item_roster_additions": len(item_additions),
            "global_locator_pass_status": "pending",
            "put": put_result,
            "measured_host_timing": measured_host_timing,
        }, [], [
            "locator rows are durable; later mechanics.ensure can request the exact indexed page without blocking ordinary play",
        ]

    validated_mechanics_related: list[dict[str, Any]] | None = None
    if mechanics_job:
        requested_indices = set(request.get("requested_pdf_indices") or [])
        raw_request_refs = request.get("cached_page_refs")
        if (
            not requested_indices
            or not isinstance(raw_request_refs, list)
            or len(raw_request_refs) != len(requested_indices)
            or any(
                not isinstance(ref, dict)
                or isinstance(ref.get("pdf_index"), bool)
                or not isinstance(ref.get("pdf_index"), int)
                or not str(ref.get("source_id") or "")
                or len(str(ref.get("text_sha256") or "")) != 64
                for ref in raw_request_refs
            )
            or {int(ref["pdf_index"]) for ref in raw_request_refs}
            != requested_indices
        ):
            raise ToolError(
                "invalid_state",
                "mechanics request lacks its complete leased exact cache refs",
            )
        request_ref_signatures = {
            (
                str(ref.get("source_id") or ""),
                int(ref["pdf_index"]),
                str(ref.get("text_sha256") or ""),
            )
            for ref in raw_request_refs
            if isinstance(ref, dict) and isinstance(ref.get("pdf_index"), int)
        }

        def validate_mechanics_worker_pack(
            incoming: Any,
            *,
            field: str,
            subject_kind: str,
            subject_id: str,
        ) -> None:
            """Reject malformed child output before any durable entity write."""
            if not isinstance(incoming, dict) or set(incoming) != {"mechanics"}:
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field} must contain exactly one nested mechanics object",
                )
            mechanics_payload = incoming.get("mechanics")
            if not isinstance(mechanics_payload, dict):
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field}.mechanics must be an object",
                )
            status = str(mechanics_payload.get("status") or "")
            if status == "authored":
                authored_fields = {
                    "status", "profile", "source_refs",
                    "fields_observed", "fields_extracted",
                    "fields_not_authored", "provenance",
                }
                if set(mechanics_payload) != authored_fields:
                    raise ToolError(
                        "invalid_source_worker_pack",
                        f"{field}.mechanics status=authored must contain exactly "
                        "status/profile/source_refs/fields_*/provenance",
                    )
                refs = mechanics_payload.get("source_refs")
                if not isinstance(refs, list) or not refs:
                    raise ToolError(
                        "invalid_source_worker_pack",
                        f"{field}.mechanics.source_refs must be a non-empty exact "
                        "request-cache subset",
                    )
                supplied_signatures: list[tuple[str, int, str]] = []
                for index, ref in enumerate(refs):
                    if (
                        not isinstance(ref, dict)
                        or set(ref) != {"source_id", "pdf_index", "text_sha256"}
                        or isinstance(ref.get("pdf_index"), bool)
                        or not isinstance(ref.get("pdf_index"), int)
                    ):
                        raise ToolError(
                            "invalid_source_worker_pack",
                            f"{field}.mechanics.source_refs[{index}] must be one "
                            "exact source_id/pdf_index/text_sha256 ref",
                        )
                    supplied_signatures.append((
                        str(ref.get("source_id") or ""),
                        int(ref["pdf_index"]),
                        str(ref.get("text_sha256") or ""),
                    ))
                if (
                    len(supplied_signatures) != len(set(supplied_signatures))
                    or not set(supplied_signatures) <= request_ref_signatures
                ):
                    raise ToolError(
                        "invalid_source_worker_pack",
                        f"{field}.mechanics.source_refs must be unique exact refs "
                        "from this leased request",
                    )
            elif status == "not_authored":
                allowed_fields = set(coc_mechanics.NOT_AUTHORED_KEYS)
                required_fields = {
                    "status", "locator_pass_status", "locator_scope",
                    "absence_receipt",
                }
                if (
                    set(mechanics_payload) - allowed_fields
                    or not required_fields <= set(mechanics_payload)
                ):
                    raise ToolError(
                        "invalid_source_worker_pack",
                        f"{field}.mechanics status=not_authored violates the "
                        "closed receipt-only shape",
                    )
            else:
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field}.mechanics.status must be authored or not_authored",
                )
            expected_locator_scope = None
            if status == "not_authored":
                locator = assets_mod._skeleton_mechanics_row(
                    ctx.root, root_id, subject_kind, subject_id,
                )
                if not isinstance(locator, dict) or not isinstance(
                    locator.get("locator_scope"), dict,
                ):
                    raise ToolError(
                        "invalid_source_worker_pack",
                        f"{field}.mechanics not_authored has no matching complete "
                        "skeleton locator scope",
                    )
                expected_locator_scope = locator["locator_scope"]
            try:
                coc_mechanics.validate_mechanics_record(
                    mechanics_payload,
                    subject_kind=subject_kind,
                    expected_locator_scope=expected_locator_scope,
                )
            except coc_mechanics.MechanicsError as exc:
                raise ToolError("invalid_source_worker_pack", str(exc)) from exc

        validate_mechanics_worker_pack(
            args.get("pack"),
            field="pack",
            subject_kind=entity_kind,
            subject_id=target_id,
        )
        raw_related = args.get("related_packs")
        if raw_related is None:
            raw_related = []
        if not isinstance(raw_related, list):
            raise ToolError(
                "invalid_source_worker_pack", "related_packs must be an array",
            )
        allowed_batch = {
            (str(row.get("subject_kind") or ""), str(row.get("subject_id") or ""))
            for row in (request.get("batch_subjects") or [])
            if isinstance(row, dict)
        }
        primary_subject = (entity_kind, target_id)
        seen_related: set[tuple[str, str]] = set()
        validated_mechanics_related = []
        for index, related in enumerate(raw_related):
            field = f"related_packs[{index}]"
            if (
                not isinstance(related, dict)
                or set(related) != {"subject_kind", "subject_id", "pack"}
            ):
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field} must contain exactly subject_kind/subject_id/pack",
                )
            related_kind = str(related.get("subject_kind") or "")
            related_id = str(related.get("subject_id") or "")
            related_subject = (related_kind, related_id)
            if (
                related_subject == primary_subject
                or related_subject in seen_related
                or related_subject not in allowed_batch
            ):
                raise ToolError(
                    "invalid_source_worker_pack",
                    f"{field} must name one unique eligible non-primary batch subject",
                )
            validate_mechanics_worker_pack(
                related.get("pack"),
                field=f"{field}.pack",
                subject_kind=related_kind,
                subject_id=related_id,
            )
            seen_related.add(related_subject)
            validated_mechanics_related.append(deepcopy(related))

    def _apply_mechanics_only_fulfill(
        *,
        kind: str,
        entity_id: str,
        incoming: dict[str, Any],
        force_host_job: bool,
    ) -> dict[str, Any]:
        """Merge only mechanics; never force narrative parse_state=deep."""
        mechanics_payload = incoming.get("mechanics")
        if not isinstance(mechanics_payload, dict):
            raise ToolError(
                "invalid_source_worker_pack",
                f"{job_kind} pack requires a mechanics object",
            )
        existing = assets_mod.get_entity(ctx.root, root_id, kind, entity_id)
        if existing is not None:
            merged = deepcopy(existing)
            merged["mechanics"] = deepcopy(mechanics_payload)
            # Preserve existing narrative parse_state; mechanics readiness is
            # independent of body depth.
            if force_host_job:
                merged["host_work_job_id"] = job_id
            else:
                merged.pop("host_work_job_id", None)
            if measured_host_timing and not merged.get("host_timing"):
                merged["host_timing"] = deepcopy(measured_host_timing)
            return merged
        id_key = assets_mod._ENTITY_ID_KEY[kind]
        shell: dict[str, Any] = {
            id_key: entity_id,
            "parse_state": "named_only",
            "origin": incoming.get("origin") or "source",
            "mechanics": deepcopy(mechanics_payload),
        }
        for key in (
            "name", "display_name", "label", "source_page_indices",
            "source_refs", "provenance",
        ):
            if key in incoming and incoming[key] is not None:
                shell[key] = deepcopy(incoming[key])
        if kind == "npc":
            shell.setdefault("name", entity_id)
            shell.setdefault("display_name", shell["name"])
        elif kind == "item":
            shell.setdefault("label", entity_id)
        # Mechanics-only entities must not claim deep narration.
        shell["parse_state"] = "named_only"
        if force_host_job:
            shell["host_work_job_id"] = job_id
        if measured_host_timing:
            shell["host_timing"] = deepcopy(measured_host_timing)
        return shell

    if job_kind in {"resolve_npc_mechanics", "resolve_item_mechanics"}:
        pack = _apply_mechanics_only_fulfill(
            kind=entity_kind,
            entity_id=target_id,
            incoming=pack,
            force_host_job=True,
        )
    else:
        expected_state = (
            "partial"
            if job_kind in {"partial_neighbor", "partial_opening"}
            else "deep"
        )
        supplied_state = str(pack.get("parse_state") or expected_state)
        if supplied_state != expected_state:
            raise ToolError(
                "invalid_param",
                f"{job_kind} requires parse_state={expected_state!r}",
            )
        pack["parse_state"] = expected_state
        pack["host_work_job_id"] = job_id
        if job_kind == "partial_opening":
            if (
                request.get("request_purpose")
                != assets_mod.FOREGROUND_OPENING_PURPOSE
            ):
                raise ToolError(
                    "invalid_state",
                    "partial_opening request purpose is not foreground_opening_slice",
                )
            try:
                exact_scope = assets_mod.validate_opening_source_scope(
                    ctx.root,
                    root_id,
                    request.get("requested_source_scope"),
                )
                expected_signature = assets_mod.opening_source_scope_signature(
                    exact_scope
                )
                incoming_indices = assets_mod._source_indices(
                    pack, field="partial_opening.pack",
                )
            except assets_mod.ModuleAssetsError as exc:
                raise ToolError("invalid_param", str(exc)) from exc
            if (
                str(request.get("source_scope_signature") or "")
                != expected_signature
                or incoming_indices != exact_scope["pdf_indices"]
            ):
                raise ToolError(
                    "opening_source_scope_mismatch",
                    "partial opening pack source scope must equal the exact request",
                )
    try:
        result = assets_mod.put_entity(
            ctx.root, root_id, entity_kind, target_id, pack,
        )
    except assets_mod.ModuleAssetsError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    stored_primary = assets_mod.get_entity(
        ctx.root, root_id, entity_kind, target_id,
    )
    refreshed_request = next(
        (
            row
            for row in assets_mod.list_host_work_requests(
                ctx.root, root_id, include_closed=True, limit=None,
            )
            if str(row.get("job_id") or "") == job_id
        ),
        None,
    )
    if (
        not isinstance(stored_primary, dict)
        or not isinstance(refreshed_request, dict)
        or not assets_mod.fulfilled_request_matches_current_pack(
            refreshed_request,
            stored_primary,
            kind=entity_kind,
            entity_id=target_id,
        )
    ):
        raise ToolError(
            "invalid_state",
            "canonical host-work fulfillment receipt does not match the current primary pack",
        )
    related_results = []
    allowed_batch = {
        (str(row.get("subject_kind") or ""), str(row.get("subject_id") or ""))
        for row in (request.get("batch_subjects") or [])
        if isinstance(row, dict)
    }
    related_subjects: list[tuple[str, str]] = []
    related_input = (
        validated_mechanics_related
        if mechanics_job and validated_mechanics_related is not None
        else args.get("related_packs") or []
    )
    for index, related in enumerate(related_input):
        if not isinstance(related, dict):
            raise ToolError(
                "invalid_source_worker_pack" if mechanics_job else "invalid_param",
                f"related_packs[{index}] must be an object",
            )
        related_kind = str(related.get("subject_kind") or "")
        related_id = str(related.get("subject_id") or "")
        if (related_kind, related_id) not in allowed_batch:
            raise ToolError(
                "invalid_source_worker_pack" if mechanics_job else "invalid_param",
                f"related_packs[{index}] is not in this request's batch_subjects",
            )
        related_pack = deepcopy(related.get("pack"))
        if not isinstance(related_pack, dict):
            raise ToolError(
                "invalid_source_worker_pack" if mechanics_job else "invalid_param",
                f"related_packs[{index}].pack must be an object",
            )
        if job_kind in {"resolve_npc_mechanics", "resolve_item_mechanics"}:
            related_pack = _apply_mechanics_only_fulfill(
                kind=related_kind,
                entity_id=related_id,
                incoming=related_pack,
                force_host_job=False,
            )
        else:
            related_pack["parse_state"] = "deep"
            related_pack.pop("host_work_job_id", None)
            if pack.get("host_timing") and not related_pack.get("host_timing"):
                related_pack["host_timing"] = deepcopy(pack["host_timing"])
        try:
            related_results.append(
                assets_mod.put_entity(
                    ctx.root, root_id, related_kind, related_id, related_pack,
                )
            )
        except assets_mod.ModuleAssetsError as exc:
            raise ToolError("invalid_param", str(exc)) from exc
        related_subjects.append((related_kind, related_id))

    # Mechanics-only packs stay narrative-shallow, so put_entity's deep-only
    # reenqueue path does not fire. Re-queue resolve_* merge jobs so durable
    # authored/not_authored mechanics still project into campaign IR.
    if job_kind in {"resolve_npc_mechanics", "resolve_item_mechanics"}:
        merge_jobs = [(entity_kind, target_id), *related_subjects]
        for subject_kind, subject_id in merge_jobs:
            resolve_kind = (
                "resolve_npc_mechanics" if subject_kind == "npc"
                else "resolve_item_mechanics" if subject_kind == "item"
                else None
            )
            if resolve_kind is None:
                continue
            assets_mod.enqueue_job(
                ctx.root,
                root_id,
                kind=resolve_kind,
                target_id=subject_id,
                priority=100,
                reason="mechanics_pack_ready",
            )

    if job_kind == "partial_opening":
        success_hints = [
            "the exact reusable partial opening pack is durable; call "
            "progressive.prepare_opening and use its returned mutation card",
        ]
    elif job_kind in {"resolve_npc_mechanics", "resolve_item_mechanics"}:
        success_hints = [
            "the reusable mechanics pack is durable and its mechanics merge "
            "job was re-enqueued",
        ]
    elif isinstance(result.get("worker"), dict) and not result["worker"].get("error"):
        success_hints = [
            "the reusable deep pack is durable and merge was re-enqueued; "
            "continue play from the pack instead of reopening the same PDF scope",
        ]
    else:
        success_hints = [
            "the reusable pack is durable; inspect progressive status before "
            "claiming a campaign merge was scheduled",
        ]

    return {
        "asset_root_id": root_id,
        "job_id": job_id,
        "request_status": refreshed_request["status"],
        "entity": coc_module_project._entity_status(
            ctx.root, root_id, entity_kind, target_id,
        ),
        "put": result,
        "related_puts": related_results,
        "measured_host_timing": measured_host_timing,
    }, [], success_hints


_SOURCE_RESULT_FIELDS = {
    "schema_version", "contract_id", "packet_id", "work_group_id",
    "status", "results",
}
_SOURCE_RESULT_ITEM_FIELDS = {"job_id", "pack", "related_packs"}
_SOURCE_RESULT_CONTRACT = "coc.source-pack-worker.v1"
_SOURCE_SUBMIT_RECEIPT_CONTRACT = "coc.source-submit-receipt.v1"


def _source_result_id(value: Any, *, field: str) -> str:
    text = str(value or "").strip()
    if not text or len(text) > 256:
        raise ToolError(
            "invalid_source_submission",
            f"{field} must be a non-empty string of at most 256 characters",
        )
    return text


def _validate_source_result_submission(
    payload: dict[str, Any],
) -> tuple[str, str, str, list[dict[str, Any]]]:
    if set(payload) != _SOURCE_RESULT_FIELDS:
        raise ToolError(
            "invalid_source_submission",
            "source submission must contain exactly schema_version, contract_id, "
            "packet_id, work_group_id, status, and results",
        )
    if type(payload.get("schema_version")) is not int or payload["schema_version"] != 1:
        raise ToolError(
            "invalid_source_submission", "source submission requires schema_version=1",
        )
    if payload.get("contract_id") != _SOURCE_RESULT_CONTRACT:
        raise ToolError(
            "invalid_source_submission",
            f"source submission requires contract_id={_SOURCE_RESULT_CONTRACT}",
        )
    packet_id = _source_result_id(payload.get("packet_id"), field="packet_id")
    work_group_id = _source_result_id(
        payload.get("work_group_id"), field="work_group_id",
    )
    status = str(payload.get("status") or "").strip()
    if status not in {"usable", "abstain", "failed"}:
        raise ToolError(
            "invalid_source_submission",
            "source submission status must be usable, abstain, or failed",
        )
    raw_results = payload.get("results")
    if not isinstance(raw_results, list) or len(raw_results) > 128:
        raise ToolError(
            "invalid_source_submission", "source submission results must be an array",
        )
    if status != "usable" and raw_results:
        raise ToolError(
            "invalid_source_submission",
            "abstain/failed source submissions require results=[]",
        )
    if status == "usable" and not raw_results:
        raise ToolError(
            "invalid_source_submission", "usable source submission requires results",
        )
    results: list[dict[str, Any]] = []
    job_ids: set[str] = set()
    for index, raw in enumerate(raw_results):
        if not isinstance(raw, dict) or set(raw) != _SOURCE_RESULT_ITEM_FIELDS:
            raise ToolError(
                "invalid_source_worker_pack",
                f"results[{index}] must contain exactly job_id, pack, and related_packs",
            )
        job_id = _source_result_id(raw.get("job_id"), field=f"results[{index}].job_id")
        if job_id in job_ids:
            raise ToolError(
                "invalid_source_submission", "source submission job ids must be unique",
            )
        job_ids.add(job_id)
        results.append(deepcopy(raw))
    return packet_id, work_group_id, status, results


def _leased_source_packet_binding(
    root: Path,
    *,
    packet_id: str,
    work_group_id: str,
) -> tuple[str, list[dict[str, Any]]]:
    assets_mod = coc_module_project.coc_module_assets
    store = assets_mod.assets_root(root)
    matches: list[tuple[str, dict[str, Any]]] = []
    if store.is_dir():
        for module_dir in sorted(path for path in store.iterdir() if path.is_dir()):
            work_dir = module_dir / "host-work"
            if not work_dir.is_dir():
                continue
            for path in sorted(work_dir.glob("*.json")):
                try:
                    request = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                if not isinstance(request, dict) or request.get("lease_id") != packet_id:
                    continue
                matches.append((module_dir.name, request))
    if not matches:
        raise ToolError(
            "invalid_source_lease", "packet_id does not bind an existing host-work lease",
        )
    asset_root_ids = {asset_root_id for asset_root_id, _request in matches}
    if len(asset_root_ids) != 1:
        raise ToolError(
            "invalid_source_lease", "packet_id ambiguously binds multiple asset roots",
        )
    asset_root_id = next(iter(asset_root_ids))
    now = datetime.now(timezone.utc)
    for bound_root_id, request in matches:
        if (
            bound_root_id != asset_root_id
            or str(request.get("asset_root_id") or "") != asset_root_id
            or str(request.get("work_group_id") or "") != work_group_id
            or str(request.get("dispatch_state") or "") != "leased"
            or assets_mod._lease_is_expired(request, now)
            or str(request.get("status") or "open")
            in {"fulfilled", "cancelled", "superseded"}
        ):
            raise ToolError(
                "invalid_source_lease",
                "source submission does not match one active leased packet",
            )
    requests = [deepcopy(request) for _asset_root_id, request in matches]
    requests.sort(key=lambda row: str(row.get("job_id") or ""))
    return asset_root_id, requests


def submit_source_worker_result(root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    """Bind one child result to its lease and reuse strict fulfillment serially."""
    if not isinstance(payload, dict):
        raise ToolError("invalid_source_submission", "source submission must be an object")
    packet_id, work_group_id, status, results = (
        _validate_source_result_submission(payload)
    )
    ctx = Ctx(Path(root).resolve(), None)
    try:
        with coc_fileio.advisory_file_lock(_source_submit_lock_path(ctx)):
            asset_root_id, requests = _leased_source_packet_binding(
                ctx.root,
                packet_id=packet_id,
                work_group_id=work_group_id,
            )
            leased_job_ids = {
                str(request.get("job_id") or "") for request in requests
            }
            result_job_ids = {str(result.get("job_id") or "") for result in results}
            if status == "usable" and result_job_ids != leased_job_ids:
                raise ToolError(
                    "invalid_source_lease",
                    "usable source submission job set must equal the leased packet job set",
                )

            receipt: dict[str, Any] = {
                "schema_version": 1,
                "contract_id": _SOURCE_SUBMIT_RECEIPT_CONTRACT,
                "packet_id": packet_id,
                "lease_id": packet_id,
                "work_group_id": work_group_id,
                "asset_root_id": asset_root_id,
                "ok": status == "usable",
                "submission_status": status,
                "submission_digest": _canonical_digest(payload),
                "job_receipts": [],
            }
            if status != "usable":
                receipt["error"] = {
                    "code": "source_result_not_usable",
                    "message": f"source worker returned status={status}",
                }
                for request in requests:
                    receipt["job_receipts"].append({
                        "job_id": request.get("job_id"),
                        "ok": False,
                        "request_status": str(request.get("status") or "open"),
                        "error": deepcopy(receipt["error"]),
                    })
                return receipt

            request_by_job = {
                str(request.get("job_id") or ""): request for request in requests
            }
            for result in results:
                job_id = str(result["job_id"])
                try:
                    data, _warnings, _hints = _fulfill_host_work_for_asset_unlocked(
                        ctx,
                        {"worker_result": result},
                        root_id=asset_root_id,
                    )
                except ToolError as exc:
                    failure = {
                        "job_id": job_id,
                        "ok": False,
                        "request_status": str(
                            request_by_job[job_id].get("status") or "open"
                        ),
                        "error": {"code": exc.code, "message": exc.message},
                    }
                    receipt["ok"] = False
                    receipt["error"] = deepcopy(failure["error"])
                    receipt["job_receipts"].append(failure)
                    return receipt
                receipt["job_receipts"].append({
                    "job_id": job_id,
                    "ok": True,
                    "request_status": data.get("request_status"),
                    "fulfillment_digest": _canonical_digest(data),
                })
            return receipt
    except coc_fileio.CampaignLockError as exc:
        raise ToolError("source_submit_busy", str(exc)) from exc


@tool(
    "progressive.status",
    "Read progressive parse queue + optional entity status for the campaign asset root. "
    "Also reports whether the detached parallel queue worker is running. "
    "Keeper-only; use before inventing detail on a dig target.",
    {
        "kind": {
            "type": "string",
            "desc": "optional entity kind to inspect",
        },
        "target_id": {
            "type": "string",
            "desc": "optional entity id to inspect (requires kind)",
        },
    },
)
def _tool_progressive_status(ctx: Ctx, args: dict[str, Any]):
    if ctx.campaign_dir is None:
        raise ToolError("invalid_param", "campaign required")
    root_id = coc_module_project.campaign_asset_root_id(ctx.campaign_dir)
    if not root_id:
        return {
            "progressive": False,
            "asset_root_id": None,
            "queue": None,
        }, ["campaign is not progressive"], []
    # list_queue lives on assets module (sibling of project)
    assets_mod = coc_module_project.coc_module_assets
    queue = assets_mod.list_queue(ctx.root, root_id)
    worker_mod = coc_module_project._load_sibling(
        "coc_module_queue_worker_toolbox", "coc_module_queue_worker.py",
    )
    module_root = assets_mod.assets_root(ctx.root) / root_id
    identity = _read_optional_json(module_root / "identity.json", {})
    skeleton = assets_mod.get_skeleton(ctx.root, root_id) or {}
    all_host_work = assets_mod.list_host_work_requests(
        ctx.root, root_id, limit=None,
    )
    data: dict[str, Any] = {
        "progressive": True,
        "asset_root_id": root_id,
        "queue": coc_module_project._compact_queue_snapshot(
            queue, open_host_work=all_host_work,
        ),
        "worker": worker_mod.worker_status(ctx.root),
        "source_cache": {
            "source_id": (identity.get("source") or {}).get("source_id"),
            "file_sha256": identity.get("file_sha256"),
            "bundle_count": len(identity.get("source_bundles") or []),
            "cached_pdf_indices": sorted(
                int(path.stem)
                for path in (module_root / "pages").glob("*.md")
                if path.stem.isdigit()
            ),
        },
        "start_clock_status": skeleton.get("start_clock_status") or "unbound",
        "host_work": {
            "open_count": len(all_host_work),
            "requests": all_host_work[:8],
            "ready_for_background_count": sum(
                row.get("dispatch_state") == "ready"
                and row.get("cached_scope_complete") is True
                and bool(row.get("requested_pdf_indices"))
                for row in all_host_work
            ),
            "leased_count": sum(
                row.get("dispatch_state") == "leased" for row in all_host_work
            ),
            "needs_source_window_count": sum(
                bool(row.get("requested_pdf_indices"))
                and row.get("cached_scope_complete") is False
                for row in all_host_work
            ),
            "claim_operation": {
                "tool": "progressive.claim_host_work",
                "args": {
                    "executor_id": "<stable host/session id>",
                    "limit": 1,
                },
            },
        },
    }
    kind = str(args.get("kind") or "").strip()
    tid = str(args.get("target_id") or "").strip()
    if kind or tid:
        if not kind or not tid:
            raise ToolError("invalid_param", "kind and target_id must be provided together")
        data["entity"] = coc_module_project._entity_status(
            ctx.root, root_id, kind, tid,
        )
    hints = [
        "queue is non-blocking: dig only enqueues; parallel worker merges ready packs "
        "and writes host-work requests for missing deep bodies",
    ]
    if all_host_work:
        hints.append(
            "open host_work requests are not completed parses: claim exact cached "
            "work for a source child. On a direct-submit host the parent does not "
            "wait, retrieve, poll, or call progressive.fulfill_host_work; only a "
            "host without direct submit uses the exact-forward fallback"
        )
    return data, [], hints


@tool(
    "clues.query",
    "Clue graph with discovery state. Filter by scene_id or clue_id. Undiscovered clues are keeper secrets.",
    {
        "scene_id": {"type": "string", "desc": "only clues available in this scene"},
        "clue_id": {"type": "string", "desc": "a single clue"},
        "undiscovered_only": {"type": "boolean", "desc": "only clues not yet found"},
        "since_revision": {
            "type": "string",
            "desc": "revision returned by the previous identical query; matching state returns not_modified instead of the full projection",
        },
    },
    access="query",
    read_domains=("clues", "world", "scene"),
    recovery_domains=(),
    response_mode="full_or_not_modified",
    audit_mode="reference",
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
    "NPC agendas plus live psych state and the requested investigator/NPC's bounded textual impression. 'secret'-marked fields are keeper-only reference — never reveal verbatim.",
    {
        "npc_id": {"type": "string", "desc": "a single NPC (default: all)"},
        "investigator": {"type": "string", "desc": "investigator whose pair-scoped impression should be projected"},
        "since_revision": {
            "type": "string",
            "desc": "revision returned by the previous identical query; matching state returns not_modified instead of the full projection",
        },
    },
    access="query",
    read_domains=("npc", "scene", "party"),
    recovery_domains=("npc",),
    response_mode="full_or_not_modified",
    audit_mode="reference",
)
def _tool_npc_query(ctx: Ctx, args: dict[str, Any]):
    npc_state = coc_npc_state.load_npc_state(ctx.campaign_dir)
    active_scene_id = ctx.world().get("active_scene_id")
    authored_npcs = [
        npc for npc in (ctx.npc_agendas.get("npcs") or [])
        if isinstance(npc, dict) and str(npc.get("npc_id") or "").strip()
    ]
    authored_by_id = {
        str(npc["npc_id"]): npc
        for npc in authored_npcs
    }
    psych_by_id = (
        npc_state.get("psych") if isinstance(npc_state.get("psych"), dict) else {}
    )
    campaign_npc_ids, campaign_names, name_conflicts = (
        _campaign_npc_projection_index(ctx, npc_state)
    )

    out = []
    requested_id = str(args.get("npc_id") or "").strip()
    requested_npc = _npc_by_id(ctx.npc_agendas, requested_id) if requested_id else None
    if requested_npc is not None:
        canonical_requested_id = str(requested_npc.get("npc_id"))
    elif requested_id and requested_id in campaign_npc_ids:
        canonical_requested_id = requested_id
    elif requested_id:
        raise ToolError(
            "unknown_npc",
            f"npc not found or short name is ambiguous: {requested_id}",
        )
    else:
        canonical_requested_id = ""
    impression_investigator: str | None = None
    if args.get("investigator") is not None:
        impression_investigator = _resolve_investigator(ctx, args)
    elif len(ctx.party_ids()) == 1:
        impression_investigator = ctx.party_ids()[0]
    projected_ids = [str(npc["npc_id"]) for npc in authored_npcs]
    projected_ids.extend(sorted(campaign_npc_ids - set(projected_ids)))
    for npc_id in projected_ids:
        npc = authored_by_id.get(npc_id)
        if canonical_requested_id and npc_id != canonical_requested_id:
            continue
        psych = psych_by_id.get(npc_id) or {}
        normalized_psych = coc_npc_state.normalize_entry(psych)
        impression = (
            normalized_psych.get("impressions", {}).get(impression_investigator)
            if impression_investigator
            else None
        )
        identity_contract = (
            _npc_identity_contract(npc, active_scene_id) if npc is not None else None
        )
        campaign_name = campaign_names.get(npc_id)
        out.append({
            "npc_id": npc_id,
            "name": npc.get("name") if npc is not None else campaign_name,
            "identity_ref": (
                identity_contract["identity_ref"] if identity_contract else None
            ),
            "profile_revision_ref": (
                identity_contract["profile_revision_ref"]
                if identity_contract else None
            ),
            "identity_contract": identity_contract,
            # Preserve the authored identity contract.  The module compiler
            # already distinguishes source NPCs from inferred/improvised
            # people and expands their structured social role; dropping those
            # fields here invited downstream Keepers to recast a court contact
            # as a police detective merely because both touch the same file.
            "origin": npc.get("origin") if npc is not None else "improvised",
            "voice": npc.get("voice") if npc is not None else None,
            "agenda": npc.get("agenda") if npc is not None else None,
            "fear": npc.get("fear") if npc is not None else None,
            "relationship_to_investigators": (
                npc.get("relationship_to_investigators") if npc is not None else None
            ),
            "social_role": deepcopy(npc.get("social_role")) if npc is not None else None,
            "role_label": npc.get("role_label") if npc is not None else None,
            "secret": {
                "value": npc.get("secret") if npc is not None else None,
                "secret": True,
            },
            "keeper_note": {
                "value": npc.get("keeper_note") if npc is not None else None,
                "secret": True,
            },
            "facts": npc.get("facts") if npc is not None else None,
            "known_fact_ids": npc.get("known_fact_ids") if npc is not None else None,
            "revealable_fact_ids": (
                npc.get("revealable_fact_ids") if npc is not None else None
            ),
            "lie_options": npc.get("lie_options") if npc is not None else None,
            "deflect_options": npc.get("deflect_options") if npc is not None else None,
            "schedule": npc.get("schedule") if npc is not None else None,
            "psych": {
                "trust": normalized_psych.get("trust", 0),
                "fear": normalized_psych.get("fear", 0),
                "suspicion": normalized_psych.get("suspicion", 0),
                "known_facts": normalized_psych.get("known_facts", []),
                "lies_told": normalized_psych.get("lies_told", []),
                "promises": normalized_psych.get("promises", []),
                "availability": normalized_psych.get("availability"),
                "impression": deepcopy(impression) if isinstance(impression, dict) else None,
            },
        })
    hints = [
        "fields marked secret:true are your reference only — reveal through play, not exposition",
        "origin=source plus relationship_to_investigators/social_role is an authored identity contract: preserve that NPC's institution and role; introduce a new stable NPC id for a different role",
        "role_label is source-authored display context only; never infer structured authority from its free prose",
        "origin=improvised is a campaign-local canonical contact projected from first-impression/persona/psych state; identity_contract stays null because the module did not author that identity",
        "pass the returned identity_ref to state.record_npc_engagement only when this authored identity is the one portrayed; a missing or mismatched ref records the interaction but is not authored-NPC coverage",
        "when an authored NPC has no pronoun or gender field, repeat the authored name; never invent a gendered pronoun",
    ]
    if impression_investigator:
        hints.append(
            f"psych.impression is the bounded, caller-authored textual memory for investigator '{impression_investigator}'; use it as semantic context, never as a hard action gate"
        )
    elif len(ctx.party_ids()) > 1:
        hints.append(
            "npc.query has multiple investigators; pass investigator explicitly to project one pair-scoped textual impression"
        )
    if name_conflicts:
        hints.append(
            "campaign-local first-impression receipts disagree on player-safe "
            f"display name for: {', '.join(sorted(name_conflicts))}; the earliest "
            "canonical receipt name is projected and the KP should preserve one stable identity"
        )
    if requested_id and requested_id != canonical_requested_id:
        hints.append(
            f"resolved NPC alias '{requested_id}' to authored id '{canonical_requested_id}'"
        )
    if canonical_requested_id:
        first_impression = _first_impression_hint(
            ctx, canonical_requested_id, requested_npc
        )
        if first_impression:
            hints.append(first_impression)
    return {"npcs": out}, [], hints


def _ensure_first_impression_roll(
    ctx: Ctx, receipt: dict[str, Any]
) -> None:
    """Materialize a schema-v2 public roll exactly once from its source receipt."""
    if receipt.get("schema_version") != 2:
        return
    expected = receipt.get("roll_record")
    roll_id = str(receipt.get("roll_id") or "")
    if not isinstance(expected, dict) or not roll_id:
        raise ToolError("state_corrupt", "first-impression receipt lacks its public roll source")
    try:
        with coc_async_recorder.recorder_lock(ctx.campaign_dir):
            raw = _roll_log_bytes(ctx)
            complete, tail, index = _parse_complete_roll_frames(raw)
            if tail or complete != raw:
                raise ToolError(
                    "state_corrupt",
                    "cannot materialize a first-impression roll over an incomplete rolls.jsonl tail",
                )
            prior = index.get(roll_id)
            if prior is not None:
                if prior != expected:
                    raise ToolError(
                        "state_corrupt",
                        f"first-impression roll_id '{roll_id}' conflicts with its source receipt",
                    )
                return
            _append_roll_frame_locked(
                ctx.campaign_dir / "logs" / "rolls.jsonl",
                _roll_record_frame(expected),
            )
    except coc_async_recorder.RecorderLockError as exc:
        raise ToolError("campaign_busy", str(exc)) from exc


def _campaign_play_language(ctx: Ctx) -> str:
    """Active campaign play_language for player-facing chrome (default zh-Hans)."""
    if ctx.campaign_dir is None:
        return "zh-Hans"
    path = ctx.campaign_dir / "campaign.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return "zh-Hans"
    if isinstance(data, dict):
        language = str(data.get("play_language") or "").strip()
        if language:
            return language
    return "zh-Hans"


def _first_impression_display_skill(ctx: Ctx) -> str:
    """First-impression public-roll label in the campaign play language."""
    language = _campaign_play_language(ctx)
    labels = coc_language.table_mechanics_labels(language)
    return str(
        labels.get("first_impression_tag")
        or coc_language.player_facing_skill_label("First Impression", language)
    )


def _first_impression_engagement_card(
    receipt: dict[str, Any],
) -> dict[str, Any]:
    """Carry the normal first-contact write without forcing rediscovery."""
    return {
        "operation": "state.record_npc_engagement",
        "invoke_via": "coc_invoke",
        "prefilled_arguments": {
            "npc_id": str(receipt["npc_id"]),
            "investigator": str(receipt["investigator_id"]),
            "first_impression_ref": str(receipt["receipt_id"]),
            "run_id": str(receipt["run_id"]),
        },
        "missing_arguments": [
            "interaction_kind",
            "decision_id",
            "first_impression_realization",
        ],
        "authority": "advisory",
        "hard_gate": False,
    }


@tool(
    "npc.reaction",
    "Settle exactly one public first-impression D100 for an investigator/NPC pair against max(APP, Credit Rating). Returns the frozen achieved level and reaction tier; the KP supplies the context-sensitive causal realization when recording the first engagement.",
    {
        "npc_id": {"type": "string", "required": True, "desc": "stable authored or improvised NPC id"},
        "npc_display_name": {"type": "string", "desc": "required for a new pair: localized player-safe table name for this stable NPC; never pass the raw npc_id"},
        "investigator": {"type": "string", "desc": "investigator id (optional when party has one member)"},
        "run_id": {"type": "string", "desc": "current play/report segment run id; use the same value for the first engagement"},
        "context": {
            "type": "object",
            "desc": "required for a new pair: exactly {player_conduct, scene_constraints, authored_or_relationship_boundary, semantic_reason}; structured semantic grounding only, never used to alter the die",
        },
        "seed": {"type": "integer", "desc": "deterministic advisory seed"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key; a second decision for the same pair returns the frozen receipt"},
    },
)
def _tool_npc_reaction(ctx: Ctx, args: dict[str, Any]):
    investigator_id = _resolve_investigator(ctx, args)
    sheet = ctx.sheet(investigator_id)
    characteristics = sheet.get("characteristics") or {}
    skills = sheet.get("skills") or {}
    # APP 0 is a legitimate value (p.31); never truthiness-fallback.
    _app_raw = characteristics.get("APP", 50)
    app = int(_app_raw) if _app_raw is not None else 50
    _cr_raw = skills.get("Credit Rating", 0)
    credit_rating = int(_cr_raw) if _cr_raw is not None else 0
    decision_id = str(args["decision_id"]).strip()
    requested_npc_id = str(args["npc_id"]).strip()
    if not requested_npc_id:
        raise ToolError("invalid_param", "npc_id must be non-empty")
    agenda = _npc_by_id(ctx.npc_agendas, requested_npc_id)
    npc_id = str(agenda.get("npc_id")) if agenda is not None else requested_npc_id
    npc_display_name = str(args.get("npc_display_name") or "").strip()
    campaign_id = coc_npc_event_chain.resolve_campaign_id(ctx.campaign_dir)
    run_id = coc_npc_event_chain.resolve_run_id(
        ctx.campaign_dir, structured_source=args
    )
    try:
        document = coc_first_impression.load_document(
            ctx.campaign_dir, campaign_id
        )
        decision_receipt = coc_first_impression.find_by_decision(
            document, decision_id
        )
        pair_receipt = coc_first_impression.find_by_pair(
            document, investigator_id, npc_id
        )
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    if decision_receipt is not None and (
        decision_receipt["investigator_id"] != investigator_id
        or decision_receipt["npc_id"] != npc_id
        or decision_receipt["run_id"] != run_id
    ):
        raise ToolError(
            "idempotency_conflict",
            f"decision_id '{decision_id}' already owns another first impression",
        )
    if pair_receipt is not None:
        if pair_receipt.get("schema_version") == 2:
            _ensure_first_impression_roll(ctx, pair_receipt)
        data = deepcopy(pair_receipt)
        data["first_impression_ref"] = pair_receipt["receipt_id"]
        data["record_engagement_operation"] = (
            _first_impression_engagement_card(pair_receipt)
        )
        return data, [
            "first impression already settled for this investigator/NPC pair; returned the frozen receipt without rerolling"
        ], [
            (
                "legacy schema-v1 receipt preserved without rerolling"
                if pair_receipt.get("schema_version") == 1
                else "the public die and reaction tier are frozen; use the receipt's context plus current fiction to realize the first response"
            )
        ]

    context = deepcopy(args.get("context"))
    if not npc_display_name or npc_display_name == npc_id:
        raise ToolError(
            "invalid_param",
            "a new first-impression pair requires a localized player-safe npc_display_name distinct from npc_id",
        )
    if not isinstance(context, dict) or set(context) != coc_first_impression.CONTEXT_FIELDS:
        raise ToolError(
            "invalid_param",
            "a new first-impression pair requires context exactly: player_conduct, scene_constraints, authored_or_relationship_boundary, semantic_reason",
        )
    if not all(
        isinstance(context.get(key), str)
        and bool(context[key].strip())
        and context[key] == context[key].strip()
        for key in coc_first_impression.CONTEXT_FIELDS
    ):
        raise ToolError("invalid_param", "all first-impression context fields must be non-empty strings")

    governing_attribute = "credit_rating" if credit_rating > app else "app"
    governing_value = max(app, credit_rating)
    result = coc_roll.percentile_check(
        governing_value, difficulty="regular", rng=_rng(args)
    )
    achieved_level = str(result["achieved_level"])
    reaction_tier = coc_first_impression.REACTION_TIERS[achieved_level]
    roll_id = coc_first_impression.current_roll_id(
        campaign_id, investigator_id, npc_id
    )
    roll_record = ctx.prepare_roll({
        "roll_id": roll_id,
        "kind": "npc_first_impression",
        "actor": investigator_id,
        "investigator_id": investigator_id,
        "npc_id": npc_id,
        "npc_display_name": npc_display_name,
        "skill": "First Impression",
        "display_skill": _first_impression_display_skill(ctx),
        "app": app,
        "credit_rating": credit_rating,
        "governing_attribute": governing_attribute,
        "governing_value": governing_value,
        **result,
        "reaction_tier": reaction_tier,
        "visibility": "public",
        "source": "keeper_toolbox",
    })
    try:
        receipt = coc_first_impression.new_receipt(
            campaign_id=campaign_id,
            run_id=run_id,
            decision_id=decision_id,
            investigator_id=investigator_id,
            npc_id=npc_id,
            npc_display_name=npc_display_name,
            app=app,
            credit_rating=credit_rating,
            roll_record=roll_record,
            achieved_level=achieved_level,
            outcome=str(result["outcome"]),
            passed=bool(result["passed"]),
            surplus_levels=int(result["surplus_levels"]),
            context=context,
        )
        coc_first_impression.put_receipt(document, receipt)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    coc_state.write_json_atomic(
        coc_first_impression.document_path(ctx.campaign_dir), document
    )
    _ensure_first_impression_roll(ctx, receipt)
    data = deepcopy(receipt)
    data["first_impression_ref"] = receipt["receipt_id"]
    data["record_engagement_operation"] = (
        _first_impression_engagement_card(receipt)
    )
    hints = [
        "the D100 is public and frozen; do not alter it with authored hostility, relationship state, scene constraints, or bonus/penalty dice",
        "the reaction_tier changes immediate opportunity or friction, not the NPC's agenda, allegiance, safety policy, authority, or established relationship",
        "supply first_impression_realization to the matching first state.record_npc_engagement call using the stored context and current fiction",
        "pass first_impression_ref to the matching first state.record_npc_engagement call",
    ]
    if achieved_level in {"critical", "fumble"}:
        hints.insert(
            0,
            "before state.journal, apply an independent source-bound state.exceptional_effect for this first-impression roll; prose, a flag, or elapsed time is insufficient",
        )
        hints.insert(
            1,
            "before applying that effect, write player_visible_impact, causal_link, "
            "and any until_condition boundary.description in the campaign's active "
            "play_language; turn.finalize renders all three verbatim",
        )
    return data, [], hints


def _current_open_affordances(ctx: Ctx) -> list[dict[str, Any]]:
    world = ctx.world()
    active_id = world.get("active_scene_id")
    scene = _scene_by_id(ctx.story_graph, active_id)
    if not isinstance(scene, dict):
        return []
    discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    scene_key = str(active_id or "")
    completed = coc_action_resolver._route_receipt_ids(
        world, scene_key, "consumed"
    )
    blocked = coc_action_resolver._route_receipt_ids(world, scene_key, "blocked")
    try:
        return coc_action_resolver._open_affordances(
            scene, discovered, completed, blocked
        )
    except RuntimeError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc


def _route_operation_cards(
    ctx: Ctx,
    route: dict[str, Any],
    *,
    reset_evidence: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    scene_id = str(route.get("route_owner_scene_id") or "")
    route_id = str(route.get("affordance_id") or "")
    clue_ids = [str(value) for value in route.get("grants_clue_ids") or []]
    gate = route.get("roll_gate") if isinstance(route.get("roll_gate"), dict) else None
    if clue_ids and gate is None:
        return [
            {
                "operation": "state.record_clue",
                "invoke_via": "coc_invoke",
                "prefilled_arguments": {
                    "clue_id": clue_id,
                    "method": "authored_direct_route",
                    "route_ref": {"scene_id": scene_id, "route_id": route_id},
                },
                "missing_arguments": ["decision_id"],
            }
            for clue_id in clue_ids
        ]
    if gate is None:
        return []
    density_group = f"route:{scene_id}:{route_id}"
    stakes_label = str(gate.get("stakes") or "the authored route objective")
    failure = gate.get("ordinary_failure") or {}
    failure_summary = str(
        failure.get("summary") or "failure changes the situation without progress"
    )
    fumble = gate.get("fumble_consequence") or {}
    cards = []
    for approach in gate.get("approaches") or []:
        if not isinstance(approach, dict) or not approach.get("skill"):
            continue
        attempt_id = density_group
        if isinstance(reset_evidence, dict):
            attempt_id = (
                f"{density_group}:reset:"
                f"{reset_evidence.get('source_attempt_elapsed_minutes', 'structured')}"
                f":{reset_evidence.get('elapsed_minutes', 'changed')}"
            )
        prefilled = {
            "skill": str(approach["skill"]),
            "difficulty": str(gate.get("difficulty") or "regular"),
            "goal": str(route.get("player_visible_cue") or stakes_label),
            "stakes": {
                "on_success": f"achieve the authored objective: {stakes_label}",
                "on_failure": failure_summary,
            },
            "difficulty_basis": "authored_gate",
            "reason": f"authored route {route_id}",
            "resolution_context": {
                "attempt_id": attempt_id,
                "scene_id": scene_id,
                "route_id": route_id,
                "roll_density_group": density_group,
            },
        }
        if isinstance(reset_evidence, dict):
            prefilled["resolution_context"]["reset_evidence"] = deepcopy(
                reset_evidence
            )
        if str(fumble.get("summary") or "").strip():
            prefilled["fumble_consequence"] = str(fumble["summary"]).strip()
        cards.append({
            "operation": "rules.roll",
            "invoke_via": "coc_invoke",
            "approach": {
                "verb": approach.get("verb"),
                "skill": approach.get("skill"),
            },
            "prefilled_arguments": prefilled,
            "missing_arguments": ["decision_id"],
        })
    return cards


def _project_action_route_cards(
    ctx: Ctx,
    *,
    include_operation_opportunities: bool = True,
) -> list[dict[str, Any]]:
    open_affordances = _current_open_affordances(ctx)
    open_attempts = _open_attempt_opportunities(
        ctx, scene_id=str(ctx.world().get("active_scene_id") or "") or None,
    )
    attempts_by_route = {
        str((row.get("source") or {}).get("route_id") or ""): row
        for row in open_attempts
        if str((row.get("source") or {}).get("route_id") or "")
    }
    cards: list[dict[str, Any]] = []
    for route in open_affordances:
        route_id = str(route.get("affordance_id") or "")
        clue_ids = [str(value) for value in route.get("grants_clue_ids") or []]
        gate = route.get("roll_gate")
        attempt_opportunity = attempts_by_route.get(route_id)
        retry_status = (
            (attempt_opportunity.get("retry_status") or {})
            if isinstance(attempt_opportunity, dict)
            else {}
        )
        if route_id in attempts_by_route and retry_status.get("eligible") is True:
            resolution_kind = "reset_retry"
        elif route_id in attempts_by_route:
            resolution_kind = "push_or_context_change"
        elif clue_ids and not isinstance(gate, dict):
            resolution_kind = "direct_delivery"
        elif isinstance(gate, dict):
            resolution_kind = "authored_roll_advice"
        elif route.get("runtime_status") == "NOT_IMPLEMENTED":
            resolution_kind = "typed_capability_unavailable"
        else:
            resolution_kind = "keeper_judgment"
        card = {
            "route_id": route_id,
            "route_type": route.get("route_type"),
            "cue": route.get("player_visible_cue"),
            "target_entities": deepcopy(route.get("target_entities") or []),
            "grants_clue_ids": clue_ids,
            "resolution_kind": resolution_kind,
            "authority": "advisory",
            "hard_gate": False,
            "may_override": True,
        }
        if isinstance(gate, dict):
            card["roll_advice"] = {
                "difficulty": str(gate.get("difficulty") or "regular"),
                "stakes": gate.get("stakes"),
                "approaches": [
                    {
                        "verb": approach.get("verb"),
                        "skill": approach.get("skill"),
                    }
                    for approach in gate.get("approaches") or []
                    if isinstance(approach, dict) and approach.get("skill")
                ],
            }
        if include_operation_opportunities:
            if route_id in attempts_by_route:
                if resolution_kind == "reset_retry":
                    card["operation_opportunities"] = deepcopy(
                        attempt_opportunity.get("reset_retry_operations") or []
                    )
                else:
                    card["operation_opportunities"] = [deepcopy(
                        attempt_opportunity["suggested_operation"]
                    )]
            else:
                card["operation_opportunities"] = _route_operation_cards(ctx, route)
        if route_id in attempts_by_route:
            card["attempt_opportunity"] = deepcopy(attempt_opportunity)
        cards.append(card)
    return cards


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


@tool(
    "actions.advise",
    "Contextual authored-route and roll advice for one KP-interpreted player action. Read-only; direct delivery, Push, retry, and narrative suggestions are all soft and never force or block play.",
    {
        "investigator": {"type": "string", "desc": "investigator id (optional when party has one member)"},
        "player_text": {"type": "string", "desc": "optional exact player message for combined Director/Storylet advice"},
        "intent_evidence": {
            "type": "object",
            "desc": (
                "optional KP semantic result; bind authored routes only with "
                "matched_affordance_ids or selected_affordance_ids from the "
                "current action_routes index"
            ),
            "properties": {
                "primary_intent": {
                    "type": "string",
                    "minLength": 1,
                    "desc": "KP semantic label for the player's main intent",
                },
                "semantic_reason": {
                    "type": "string",
                    "minLength": 1,
                    "desc": "why this structured interpretation fits the actual player action",
                },
                "reason": {
                    "type": "string",
                    "minLength": 1,
                    "desc": "backward-compatible alias for semantic_reason",
                },
                "matched_affordance_ids": {
                    "type": "array",
                    "items": {"type": "string", "minLength": 1},
                    "uniqueItems": True,
                    "desc": "preferred exact route IDs from scene.context.action_routes",
                },
                "selected_affordance_ids": {
                    "type": "array",
                    "items": {"type": "string", "minLength": 1},
                    "uniqueItems": True,
                    "desc": "accepted alias for matched_affordance_ids",
                },
                "method": {
                    "type": "string",
                    "desc": "optional semantic description of the attempted method",
                },
                "target": {
                    "type": "string",
                    "desc": "optional semantic target of the action",
                },
                "precautions": {
                    "type": "string",
                    "desc": "optional precautions explicitly established by the player",
                },
                "normalized_action_atoms": {
                    "type": "array",
                    "items": {"type": "object", "additionalProperties": True},
                    "desc": "optional structured atoms from a semantic host resolver",
                },
                "action_resolution": {
                    "type": "object",
                    "additionalProperties": True,
                    "desc": "optional structured semantic-router result",
                },
            },
            "required_fields": ["primary_intent"],
            "additionalProperties": True,
            "examples": [{
                "primary_intent": "search_clippings",
                "semantic_reason": "the player asks the clerk to retrieve the house file",
                "matched_affordance_ids": ["search-clippings"],
            }],
        },
    },
)
def _tool_actions_advise(ctx: Ctx, args: dict[str, Any]):
    world = ctx.world()
    active_id = world.get("active_scene_id")
    affordances = _current_open_affordances(ctx)
    investigator_id = _resolve_investigator(ctx, args)
    advice = coc_keeper_planner.build_rule_advice(
        affordances, ctx.sheet(investigator_id)
    )
    gated = [
        row for row in advice
        if isinstance(row, dict) and row.get("classification") == "authored_rule_advice"
    ]
    warnings: list[str] = []
    route_cards = _project_action_route_cards(ctx)
    route_index = {
        str(row.get("route_id") or ""): row
        for row in route_cards
        if isinstance(row, dict) and row.get("route_id")
    }
    intent: dict[str, Any] | None = None
    selected_ids: list[str] = []
    if args.get("intent_evidence") is not None:
        intent = _intent_evidence(args.get("intent_evidence"))
        selected_ids = list(dict.fromkeys(
            str(value).strip()
            for value in (
                intent.get("matched_affordance_ids")
                or intent.get("selected_affordance_ids")
                or []
            )
            if str(value or "").strip()
        ))
        legacy_route_ids = [
            str(value).strip()
            for value in (intent.get("selected_route_ids") or [])
            if str(value or "").strip()
        ]
        if legacy_route_ids and not selected_ids:
            warnings.append(
                "intent_evidence.selected_route_ids is not a supported semantic "
                "binding and was ignored; use matched_affordance_ids (or "
                "selected_affordance_ids) with the exact action_routes IDs. "
                "Do not compensate by reading scenario files."
            )
    unavailable = [route_id for route_id in selected_ids if route_id not in route_index]
    if unavailable:
        warnings.append(
            "KP-selected authored route ids are not in the current open working set and were ignored: "
            + ", ".join(unavailable)
        )
    selected_routes = [
        deepcopy(route_index[route_id])
        for route_id in selected_ids if route_id in route_index
    ]
    if intent is None:
        resolution_advice: dict[str, Any] = {
            "kind": "current_route_working_set",
            "authority": "advisory",
            "hard_gate": False,
            "routes": route_cards,
            "reason": "Supply KP semantic intent evidence to project one contextual route recommendation.",
        }
    elif not selected_routes:
        resolution_advice = {
            "kind": "keeper_judgment",
            "authority": "advisory",
            "hard_gate": False,
            "may_improvise": True,
            "reason": (
                "No exact current authored route was selected. The KP may adjudicate "
                "the action semantically, ask a necessary clarification, or improvise."
            ),
        }
    elif len(selected_routes) == 1:
        resolution_advice = deepcopy(selected_routes[0])
    else:
        resolution_advice = {
            "kind": "compound_or_ambiguous_authored_action",
            "authority": "advisory",
            "hard_gate": False,
            "selected_routes": selected_routes,
            "reason": "The KP decides whether these routes form one natural action, a montage, or successive goals.",
        }
    data = {
        "schema_version": 1,
        "authority": "advisory",
        "hard_gate": False,
        "scene_id": active_id,
        "investigator_id": investigator_id,
        "authored_roll_gate_count": len(gated),
        "rule_advice": advice,
        "action_routes": route_cards,
        "intent_evidence": intent,
        "resolution_advice": resolution_advice,
        "operation_opportunities": _open_attempt_opportunities(
            ctx, scene_id=str(active_id or "") or None,
        ),
    }
    player_text = str(args.get("player_text") or "").strip()
    if intent is not None and player_text:
        director_intent = deepcopy(intent)
        if not isinstance(director_intent.get("action_resolution"), dict):
            director_intent["action_resolution"] = {
                "schema_version": 1,
                "primary_intent": director_intent.get("primary_intent"),
                "matched_affordance_ids": [
                    route_id for route_id in selected_ids if route_id in route_index
                ],
                "matched_destination_scene_id": None,
                "normalized_action_atoms": deepcopy(
                    director_intent.get("normalized_action_atoms") or []
                ),
                "no_match": not bool(selected_routes),
            }
        try:
            director_data, director_ctx = _build_director_advice_payload(
                ctx,
                {
                    "player_text": player_text,
                    "intent_evidence": director_intent,
                    "investigator": investigator_id,
                },
            )
            storylet_data = _storylet_advice_payload(
                ctx,
                plan=director_data["candidate_plan"],
                director_ctx=director_ctx,
                seed=None,
                limit=1,
            )
            if storylet_data["candidates"]:
                candidate = storylet_data["candidates"][0]
                candidate_ref = _storylet_candidate_ref(
                    storylet_data["advice_id"], candidate
                )
                data["narrative_opportunity"] = {
                    "schema_version": 1,
                    "authority": "advisory",
                    "hard_gate": False,
                    "advice_id": storylet_data["advice_id"],
                    "candidate_ref": candidate_ref,
                    "candidate": candidate,
                    "reason": (
                        "A stable existing Storylet candidate is available for this "
                        "action. Adopt, modify, or ignore it according to current pacing; "
                        "never insert it merely to satisfy a quota."
                    ),
                    "adoption_operation": {
                        "operation": "evidence.record_adoption",
                        "invoke_via": "coc_invoke",
                        "prefilled_arguments": {
                            "advice_id": storylet_data["advice_id"],
                            "candidate_ref": candidate_ref,
                        },
                        "missing_arguments": [
                            "decision_id", "disposition", "reason", "adopted_fields",
                        ],
                    },
                }
            else:
                data["narrative_opportunity"] = None
        except (ToolError, ValueError, RuntimeError, OSError) as exc:
            warnings.append(
                f"combined Director/Storylet advice was unavailable and was skipped without blocking play: {exc}"
            )
            data["narrative_opportunity"] = None
    hints = [
        "the returned route cards are the bounded authored source for this action; do not reread story-graph, clue-graph, module assets, tool logs, or old finalization examples",
        "authored roll gates are cited rule advice, not a mandatory pipeline — accept, override with a reason, or ignore",
        "direct_delivery means the authored route grants its clue/handout without a roll; invoke the prefilled state.record_clue cards and narrate the actual discovery",
        "push_or_context_change is a soft anti-roll-fishing reminder; it never rejects a player action or prevents the KP from honoring a deliberately chosen new check",
        "narrative_opportunity is one stable optional Storylet candidate, not a random-event quota; record adoption only when its substance actually reaches play",
        "a player-declared fact never satisfies a roll gate by itself; resolve the check with rules.roll before recording its clue",
    ]
    return data, warnings, hints


# --------------------------------------------------------------------------- #
# KP orchestration helpers — structured evidence, never prose classification
# --------------------------------------------------------------------------- #

def _intent_evidence(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ToolError(
            "invalid_param",
            "intent_evidence must be the KP's structured semantic result",
        )
    primary = value.get("primary_intent")
    reason = value.get("reason") or value.get("semantic_reason")
    if not isinstance(primary, str) or not primary.strip():
        raise ToolError("invalid_param", "intent_evidence.primary_intent is required")
    if not isinstance(reason, str) or not reason.strip():
        raise ToolError(
            "invalid_param",
            "intent_evidence requires a non-empty semantic reason",
        )
    result = deepcopy(value)
    result["primary_intent"] = primary.strip()
    result["semantic_reason"] = reason.strip()
    result.pop("reason", None)
    return result


def _advice_id(tool_name: str, ctx: Ctx, material: Any) -> str:
    digest = hashlib.sha256(
        json.dumps(material, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:20]
    turn = ctx.pacing().get("turn_number", 0)
    return f"{tool_name}:{turn}:{digest}"


def _storylet_advice_matches_candidate(
    advice_id: Any, candidate: dict[str, Any]
) -> bool:
    projected = [_project_storylet_candidate(candidate)]
    digest = hashlib.sha256(
        json.dumps(
            projected,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:20]
    parts = str(advice_id or "").split(":")
    return len(parts) == 3 and parts[0] == "storylets" and parts[2] == digest


def _storylet_candidate_ref(
    advice_id: Any, candidate: dict[str, Any]
) -> str:
    material = {
        "advice_id": str(advice_id or ""),
        "candidate": _project_storylet_candidate(candidate),
    }
    digest = hashlib.sha256(json.dumps(
        material,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")).hexdigest()[:32]
    return f"storylet-candidate-v1:{digest}"


def _resolve_storylet_candidate_ref(
    ctx: Ctx,
    *,
    advice_id: Any,
    candidate_ref: Any,
) -> dict[str, Any]:
    """Resolve one stable Storylet reference from canonical advisory evidence."""
    expected_ref = str(candidate_ref or "").strip()
    expected_advice = str(advice_id or "").strip()
    if not expected_ref.startswith("storylet-candidate-v1:"):
        raise ToolError("invalid_param", "candidate_ref is not a Storylet candidate reference")
    if not expected_advice:
        raise ToolError("invalid_param", "advice_id is required with candidate_ref")
    rows = _read_jsonl_records(
        ctx.campaign_dir / "logs" / "toolbox-calls.jsonl"
    )
    for row in reversed(rows):
        if row.get("ok") is not True:
            continue
        tool_name = str(row.get("tool") or "")
        data = row.get("data") if isinstance(row.get("data"), dict) else {}
        candidates: list[dict[str, Any]] = []
        row_advice_id: Any = None
        if tool_name == "actions.advise":
            opportunity = data.get("narrative_opportunity")
            if isinstance(opportunity, dict):
                row_advice_id = opportunity.get("advice_id")
                candidate = opportunity.get("candidate")
                if isinstance(candidate, dict):
                    candidates = [candidate]
        elif tool_name == "storylets.suggest":
            row_advice_id = data.get("advice_id")
            candidates = [
                candidate
                for candidate in data.get("candidates") or []
                if isinstance(candidate, dict)
            ]
        if str(row_advice_id or "") != expected_advice:
            continue
        for candidate in candidates:
            if _storylet_candidate_ref(expected_advice, candidate) != expected_ref:
                continue
            if not _storylet_advice_matches_candidate(expected_advice, candidate):
                raise ToolError(
                    "state_corrupt",
                    "candidate_ref resolved to advisory evidence with a mismatched advice digest",
                )
            return deepcopy(candidate)
    raise ToolError(
        "invalid_param",
        "candidate_ref was not found in canonical Storylet advisory evidence",
    )


def _active_scene(ctx: Ctx) -> dict[str, Any]:
    return _scene_by_id(ctx.story_graph, ctx.world().get("active_scene_id")) or {}


def _investigator_character_path(ctx: Ctx, investigator_id: str) -> Path:
    return ctx.coc_root / "investigators" / investigator_id / "character.json"


def _read_optional_json(path: Path, fallback: Any) -> Any:
    if not path.is_file():
        return deepcopy(fallback)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ToolError("state_corrupt", f"invalid JSON source: {path}") from exc


def _execute_subsystem_command(
    ctx: Ctx,
    args: dict[str, Any],
    *,
    tool_name: str,
    allowed_kinds: set[str] | frozenset[str],
) -> tuple[dict[str, Any], list[str], list[str]]:
    prior = ctx.ledger_lookup(tool_name, args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    command = args.get("command")
    if not isinstance(command, dict):
        raise ToolError("invalid_param", "command must be an exact subsystem command object")
    kind = str(command.get("kind") or "")
    if kind not in allowed_kinds:
        raise ToolError(
            "invalid_param",
            f"{tool_name} does not accept subsystem command kind {kind!r}",
        )
    payload = command.get("payload")
    if not isinstance(payload, dict):
        raise ToolError("invalid_param", "command.payload must be an object")
    if str(payload.get("decision_id") or "") != str(args.get("decision_id") or ""):
        raise ToolError(
            "invalid_param",
            "command.payload.decision_id must equal the toolbox decision_id",
        )
    investigator_id = _resolve_investigator(ctx, args)
    results = coc_subsystem_executor.execute_commands(
        ctx.campaign_dir,
        _investigator_character_path(ctx, investigator_id),
        investigator_id,
        [command],
        rng=_rng(args),
        append_jsonl=coc_state.append_jsonl,
        character_snapshot=ctx.sheet(investigator_id),
    )
    data = {
        "schema_version": 1,
        "authority": "deterministic_subsystem",
        "investigator_id": investigator_id,
        "results": results,
    }
    ctx.ledger_record(args.get("decision_id"), tool_name, data)
    return data, [], [
        "the subsystem result is authoritative; the KP chooses the surrounding fiction but must not alter its numbers or state"
    ]


# --------------------------------------------------------------------------- #
# director.* — rich existing Director implementation, advisory only
# --------------------------------------------------------------------------- #


def _stable_advisory_seed(ctx: Ctx, kind: str, material: Any) -> str:
    digest = hashlib.sha256(
        json.dumps(
            material,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")
    ).hexdigest()
    return (
        f"{kind}:{ctx.campaign_id}:{ctx.pacing().get('turn_number', 0)}:"
        f"{ctx.world().get('active_scene_id')}:{digest}"
    )


def _build_director_advice_payload(
    ctx: Ctx, args: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    player_text = str(args.get("player_text") or "").strip()
    if not player_text:
        raise ToolError("invalid_param", "player_text is required")
    intent = _intent_evidence(args.get("intent_evidence"))
    investigator_id = _resolve_investigator(ctx, args)
    sheet = ctx.sheet(investigator_id)
    seed = (
        args.get("seed")
        if args.get("seed") is not None
        else _stable_advisory_seed(
            ctx, "director", {"player_text": player_text, "intent": intent},
        )
    )
    decision_id = str(args.get("decision_id") or _advice_id(
        "director", ctx, {"player_text": player_text, "intent": intent}
    ))
    director_ctx = coc_story_director.build_director_context(
        ctx.campaign_dir,
        _investigator_character_path(ctx, investigator_id),
        investigator_id,
        player_text,
        str(intent["primary_intent"]),
        rng=random.Random(seed),
        player_intent_rich=intent,
        character_snapshot=sheet,
    )
    plan = coc_story_director.generate_director_plan(director_ctx, decision_id)
    advice_id = _advice_id("director", ctx, plan)
    return {
        "schema_version": 1,
        "advice_id": advice_id,
        "authority": "advisory",
        "hard_gate": False,
        "intent_evidence": intent,
        "candidate_plan": plan,
        "context_summary": {
            "active_scene_id": director_ctx.get("active_scene_id"),
            "turn_number": director_ctx.get("turn_number"),
            "story_need": director_ctx.get("story_need"),
            "personal_horror_hooks": director_ctx.get("personal_horror_hooks") or [],
            "threat_fronts": director_ctx.get("threat_fronts") or {},
            "time_signals": director_ctx.get("time_signals") or {},
        },
    }, director_ctx


@tool(
    "director.advise",
    "Build the existing rich Director context and candidate plan from structured KP intent evidence. Advice only; never applies state or forces narration.",
    {
        "player_text": {"type": "string", "required": True, "desc": "exact current player message; retained as evidence, never keyword-classified"},
        "intent_evidence": {"type": "object", "required": True, "desc": "KP semantic result with primary_intent and reason"},
        "investigator": {"type": "string", "desc": "investigator id"},
        "decision_id": {"type": "string", "desc": "stable turn decision id"},
        "seed": {"type": "integer", "desc": "deterministic advisory seed"},
    },
)
def _tool_director_advise(ctx: Ctx, args: dict[str, Any]):
    data, _director_ctx = _build_director_advice_payload(ctx, args)
    return data, [], [
        "this is a candidate orchestration plan, not a turn pipeline or state mutation",
        "adopt, modify, or ignore any part; resolve dice and state only through authoritative tools",
    ]


def _project_storylet_candidate(move: dict[str, Any]) -> dict[str, Any]:
    fields = (
        "storylet_id", "family_id", "trope_id", "title", "cue", "beat",
        "conflict_level", "target_conflict_level", "bound_entities",
        "rolled_variants", "presentation_mode", "grounding_contract", "serves",
        "ledger_update", "source",
    )
    return {
        field: deepcopy(move[field]) for field in fields if field in move
    }


def _storylet_advice_payload(
    ctx: Ctx,
    *,
    plan: dict[str, Any],
    director_ctx: dict[str, Any],
    seed: Any | None,
    limit: int,
) -> dict[str, Any]:
    ledger_path = ctx.campaign_dir / "save" / "storylet-ledger.json"
    ledger = _read_optional_json(ledger_path, {})
    stable_seed = (
        seed
        if seed is not None
        else _stable_advisory_seed(
            ctx,
            "storylets",
            {
                "decision_id": plan.get("decision_id"),
                "scene_action": plan.get("scene_action"),
                "intent": (plan.get("turn_input") or {}).get("player_intent_rich"),
            },
        )
    )
    moves = coc_storylets.select_storylet_moves(
        plan,
        director_ctx,
        library=coc_storylets.load_storylet_library(),
        ledger=ledger,
        seed=stable_seed,
        max_storylets=max(1, min(5, int(limit))),
    )
    candidates = [_project_storylet_candidate(move) for move in moves]
    advice_id = _advice_id("storylets", ctx, candidates)
    return {
        "schema_version": 1,
        "advice_id": advice_id,
        "authority": "advisory",
        "hard_gate": False,
        "candidates": candidates,
    }


@tool(
    "storylets.suggest",
    "Run the existing rich storylet scheduler against a Director candidate plan. Advisory only; selection never applies itself.",
    {
        "candidate_plan": {"type": "object", "required": True, "desc": "candidate_plan returned by director.advise"},
        "player_text": {"type": "string", "required": True, "desc": "exact player message used for the Director context"},
        "intent_evidence": {"type": "object", "required": True, "desc": "KP semantic intent result"},
        "investigator": {"type": "string", "desc": "investigator id"},
        "max": {"type": "integer", "desc": "max suggestions (default 1)"},
        "seed": {"type": "integer", "desc": "deterministic advisory seed"},
    },
)
def _tool_storylets_suggest(ctx: Ctx, args: dict[str, Any]):
    plan = args.get("candidate_plan")
    if not isinstance(plan, dict):
        raise ToolError("invalid_param", "candidate_plan must be an object")
    player_text = str(args.get("player_text") or "").strip()
    if not player_text:
        raise ToolError("invalid_param", "player_text is required")
    intent = _intent_evidence(args.get("intent_evidence"))
    investigator_id = _resolve_investigator(ctx, args)
    director_ctx = coc_story_director.build_director_context(
        ctx.campaign_dir,
        _investigator_character_path(ctx, investigator_id),
        investigator_id,
        player_text,
        str(intent["primary_intent"]),
        rng=random.Random(
            args.get("seed")
            if args.get("seed") is not None
            else _stable_advisory_seed(
                ctx,
                "storylets-context",
                {"player_text": player_text, "intent": intent},
            )
        ),
        player_intent_rich=intent,
        character_snapshot=ctx.sheet(investigator_id),
    )
    limit = max(1, min(5, int(args.get("max") or 1)))
    data = _storylet_advice_payload(
        ctx,
        plan=plan,
        director_ctx=director_ctx,
        seed=args.get("seed"),
        limit=limit,
    )
    return data, [], [
        "storylets change presentation and cost only; they never rewrite module truth",
        "persist ledger use only after the KP actually adopts and delivers a candidate",
    ]


@tool(
    "npc.advise",
    "Build existing persona cards and optional NPC agency moves for NPCs in the active scene. Advice only.",
    {
        "intent_evidence": {"type": "object", "required": True, "desc": "KP semantic intent result"},
        "seed": {"type": "integer", "desc": "deterministic advisory seed"},
    },
)
def _tool_npc_advise(ctx: Ctx, args: dict[str, Any]):
    intent = _intent_evidence(args.get("intent_evidence"))
    scene = _active_scene(ctx)
    npc_state = _read_optional_json(
        ctx.campaign_dir / "save" / "npc-persona-state.json", {"npcs": {}}
    )
    result = coc_npc_persona.build_scene_npc_agency(
        scene,
        ctx.npc_agendas,
        npc_state,
        seed_parts=[ctx.campaign_id, scene.get("scene_id"), args.get("seed", 0)],
        player_intent_rich=intent,
    )
    return {
        "schema_version": 1,
        "advice_id": _advice_id("npc", ctx, result),
        "authority": "advisory",
        "intent_evidence": intent,
        "candidate_agency": result,
    }, [], [
        "choose, modify, or ignore these moves according to the actual conversation",
        "npc_state_writes are proposals; no persona or psych state was persisted",
    ]


@tool(
    "personal_horror.query",
    "Read structured personal-horror hooks and accepted backstory corruptions without scanning character prose.",
    {"investigator": {"type": "string", "desc": "investigator id"}},
)
def _tool_personal_horror_query(ctx: Ctx, args: dict[str, Any]):
    investigator_id = _resolve_investigator(ctx, args)
    state = coc_state.load_investigator_state(ctx.campaign_dir, investigator_id)
    return {
        "investigator_id": investigator_id,
        "personal_horror_hooks": deepcopy(state.get("personal_horror_hooks") or []),
        "backstory_corruptions": deepcopy(state.get("backstory_corruptions") or []),
    }, [], ["these are structured KP references; weave them only when naturally relevant"]


@tool(
    "state.personal_horror_add",
    "Persist one structured personal-horror hook after the KP has accepted it.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "hook_id": {"type": "string", "required": True, "desc": "stable hook id"},
        "backstory_field": {"type": "string", "required": True, "desc": "structured character-sheet backstory field"},
        "summary": {"type": "string", "required": True, "desc": "concise keeper summary"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_personal_horror_add(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.personal_horror_add", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    investigator_id = _resolve_investigator(ctx, args)
    state = coc_state.load_investigator_state(ctx.campaign_dir, investigator_id)
    hook_id = str(args["hook_id"])
    if any(str(row.get("hook_id")) == hook_id for row in state.get("personal_horror_hooks") or [] if isinstance(row, dict)):
        raise ToolError("invalid_param", f"personal horror hook already exists: {hook_id}")
    coc_state.add_personal_horror_hook(
        ctx.campaign_dir,
        investigator_id,
        hook_id=hook_id,
        backstory_field=str(args["backstory_field"]),
        summary=str(args["summary"]),
    )
    data = {"investigator_id": investigator_id, "hook_id": hook_id, "woven": False}
    ctx.ledger_record(args["decision_id"], "state.personal_horror_add", data)
    return data, [], ["the hook is available to the Director but never mandatory"]


@tool(
    "state.personal_horror_mark_woven",
    "Mark a structured personal-horror hook as actually woven after it appears in delivered play.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "hook_id": {"type": "string", "required": True, "desc": "existing hook id"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_personal_horror_mark_woven(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.personal_horror_mark_woven", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    investigator_id = _resolve_investigator(ctx, args)
    hook_id = str(args["hook_id"])
    state = coc_state.load_investigator_state(ctx.campaign_dir, investigator_id)
    matches = [row for row in state.get("personal_horror_hooks") or [] if isinstance(row, dict) and str(row.get("hook_id")) == hook_id]
    if len(matches) != 1:
        raise ToolError("invalid_param", f"personal horror hook not found exactly once: {hook_id}")
    coc_state.mark_hook_woven(ctx.campaign_dir, investigator_id, hook_id)
    data = {"investigator_id": investigator_id, "hook_id": hook_id, "woven": True}
    ctx.ledger_record(args["decision_id"], "state.personal_horror_mark_woven", data)
    return data, [], []


@tool(
    "state.backstory_corruption_add",
    "Persist an accepted SanitySession backstory amendment using structured fields only.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "mode": {"type": "string", "required": True, "desc": "corrupt_existing | add_irrational"},
        "backstory_field": {"type": "string", "required": True, "desc": "structured backstory field"},
        "keeper_note": {"type": "string", "required": True, "desc": "accepted amendment note"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_backstory_corruption_add(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.backstory_corruption_add", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    investigator_id = _resolve_investigator(ctx, args)
    coc_state.add_backstory_corruption(
        ctx.campaign_dir,
        investigator_id,
        mode=str(args["mode"]),
        backstory_field=str(args["backstory_field"]),
        keeper_note=str(args["keeper_note"]),
    )
    data = {
        "investigator_id": investigator_id,
        "mode": str(args["mode"]),
        "backstory_field": str(args["backstory_field"]),
    }
    ctx.ledger_record(args["decision_id"], "state.backstory_corruption_add", data)
    return data, [], ["this records an accepted consequence; it does not author one automatically"]


@tool(
    "threat.query",
    "Read authored threat fronts with verified live current_segments projected onto them.",
    {},
)
def _tool_threat_query(ctx: Ctx, args: dict[str, Any]):
    definitions = ctx.scenario("threat-fronts.json") or {"fronts": []}
    persisted = coc_threat_state.load_threat_state(ctx.campaign_dir / "save")
    return {
        "schema_version": 1,
        "authority": "structured_state",
        "threat_fronts": coc_threat_state.merge_threat_fronts(definitions, persisted),
    }, [], ["threat pressure is context; it does not force a scene transition or narration beat"]


@tool(
    "state.threat_tick",
    "Advance one authored threat clock segment transactionally. Consequences are returned as advice, never auto-narrated.",
    {
        "clock_id": {"type": "string", "required": True, "desc": "authored clock id"},
        "decision_id": {"type": "string", "desc": "idempotency key and stable source id"},
    },
)
def _tool_state_threat_tick(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.threat_tick", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    clock_id = str(args["clock_id"])
    definitions = ctx.scenario("threat-fronts.json") or {"fronts": []}
    clock = next(
        (
            row
            for front in definitions.get("fronts") or []
            if isinstance(front, dict)
            for row in front.get("clocks") or []
            if isinstance(row, dict) and str(row.get("clock_id")) == clock_id
        ),
        None,
    )
    if clock is None:
        raise ToolError("invalid_param", f"unknown authored threat clock: {clock_id}")
    segments = int(clock.get("segments") or 6)
    became_full = coc_threat_state.tick_clock(
        ctx.campaign_dir / "save",
        clock_id,
        segments,
        source_id=str(args["decision_id"]),
    )
    current = coc_threat_state.get_clock_segments(ctx.campaign_dir / "save", clock_id)
    data = {
        "clock_id": clock_id,
        "current_segments": current,
        "segments": segments,
        "full": current >= segments,
        "became_full": became_full,
        "candidate_on_full": deepcopy(clock.get("on_full")) if became_full else None,
    }
    ctx.ledger_record(args["decision_id"], "state.threat_tick", data)
    return data, [], ["candidate_on_full is advice for the KP; apply any real state change through its authoritative tool"]


@tool(
    "epistemic.query",
    "Read compiled open questions, belief state, and structured lifecycle suggestions from current evidence.",
    {},
)
def _tool_epistemic_query(ctx: Ctx, args: dict[str, Any]):
    graph = ctx.scenario("epistemic-graph.json")
    state = coc_belief_state.read_belief_state(ctx.campaign_dir)
    world = ctx.world()
    transitions = coc_epistemic_lifecycle.evaluate_question_transitions(
        graph,
        state,
        world,
        list(world.get("discovered_clue_ids") or []),
        flags_set=_flags_set(ctx),
        visited_scene_ids=world.get("visited_scene_ids") or [],
    )
    return {
        "schema_version": 1,
        "authority": "advisory",
        "questions": deepcopy(graph.get("questions") or []),
        "belief_state": state,
        "candidate_transitions": transitions,
    }, [], ["candidate transitions are structured advice until an adopted plan is committed"]


@tool(
    "state.belief_apply",
    "Apply an adopted Director epistemic contract and committed clues to the persistent belief ledger.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "candidate_plan": {"type": "object", "required": True, "desc": "adopted or KP-modified Director plan"},
        "committed_clue_ids": {"type": "array", "desc": "clue ids already committed by state.record_clue"},
        "decision_id": {"type": "string", "desc": "idempotency key; must match plan decision_id when present"},
    },
)
def _tool_state_belief_apply(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.belief_apply", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous receipt"], []
    plan = args.get("candidate_plan")
    if not isinstance(plan, dict):
        raise ToolError("invalid_param", "candidate_plan must be an object")
    plan_decision = plan.get("decision_id")
    if plan_decision is not None and str(plan_decision) != str(args.get("decision_id")):
        raise ToolError("invalid_param", "candidate_plan.decision_id must match decision_id")
    clues = args.get("committed_clue_ids") or []
    if not isinstance(clues, list) or any(not isinstance(value, str) for value in clues):
        raise ToolError("invalid_param", "committed_clue_ids must be an array of strings")
    world_clues = {str(value) for value in ctx.world().get("discovered_clue_ids") or []}
    if not set(clues).issubset(world_clues):
        raise ToolError("invalid_param", "committed_clue_ids must already exist in world state")
    investigator_id = _resolve_investigator(ctx, args)
    events = coc_belief_state.apply_belief_turn(
        ctx.campaign_dir,
        plan,
        clues,
        investigator_id,
        _now_iso(),
    )
    data = {"investigator_id": investigator_id, "events": events}
    ctx.ledger_record(args["decision_id"], "state.belief_apply", data)
    return data, [], ["belief state now reflects only the adopted plan and already-committed evidence"]


@tool(
    "narration.brief",
    "Build a minimum-privilege player-safe narration envelope plus the existing natural Chinese style contract.",
    {
        "candidate_plan": {"type": "object", "required": True, "desc": "KP-adopted or modified Director plan"},
        "investigator": {"type": "string", "desc": "investigator id"},
        "applied_events": {"type": "array", "desc": "authoritative state/rules receipts already applied this turn"},
    },
)
def _tool_narration_brief(ctx: Ctx, args: dict[str, Any]):
    plan = args.get("candidate_plan")
    if not isinstance(plan, dict):
        raise ToolError("invalid_param", "candidate_plan must be an object")
    investigator_id = _resolve_investigator(ctx, args)
    sheet = ctx.sheet(investigator_id)
    events = args.get("applied_events") or []
    if not isinstance(events, list) or any(not isinstance(row, dict) for row in events):
        raise ToolError("invalid_param", "applied_events must be an array of objects")
    envelope = coc_narration_contract.build_narration_envelope(
        plan,
        clue_graph=ctx.clue_graph,
        epistemic_graph=ctx.scenario("epistemic-graph.json"),
        active_scene=_active_scene(ctx),
        investigator_display_name=str(
            sheet.get("name") or sheet.get("display_name") or investigator_id
        ),
        applied_events=events,
        route_completion_receipts=ctx.world().get("route_completion_receipts") or [],
    )
    return {
        "schema_version": 1,
        "authority": "drafting_brief",
        "narration_envelope": envelope,
        "style_contract": coc_narration_style.player_facing_style_contract("zh-Hans"),
    }, [], [
        "when action_uptake contains a committed in-fiction action, naturally enact it before or alongside the settled outcome; do not merely echo the player",
        "write fresh player-facing prose from this envelope; never paste internal labels or raw JSON",
        "the KP owns the final narration and must preserve authoritative numerical results exactly",
    ]


@tool(
    "narration.review",
    "Record an LLM semantic review of drafted narration. Advice only; no keyword matcher and no blocking prose gate.",
    {
        "decision_id": {"type": "string", "required": True, "desc": "stable turn decision id"},
        "draft_text": {"type": "string", "required": True, "desc": "exact draft reviewed by the KP"},
        "findings": {"type": "array", "desc": "semantic findings with rule_id and reason; empty when the draft is sound"},
    },
)
def _tool_narration_review(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("narration.review", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previous review"], []
    draft = str(args.get("draft_text") or "")
    if not draft.strip():
        raise ToolError("invalid_param", "draft_text is required")
    raw_findings = args.get("findings") or []
    if not isinstance(raw_findings, list):
        raise ToolError("invalid_param", "findings must be an array")
    findings: list[dict[str, str]] = []
    for index, finding in enumerate(raw_findings):
        if not isinstance(finding, dict):
            raise ToolError("invalid_param", f"findings[{index}] must be an object")
        rule_id = str(finding.get("rule_id") or "").strip()
        reason = str(finding.get("reason") or "").strip()
        if not rule_id or not reason:
            raise ToolError(
                "invalid_param",
                f"findings[{index}] requires rule_id and semantic reason",
            )
        findings.append({"rule_id": rule_id, "reason": reason})
    data = {
        "schema_version": 1,
        "visibility": "keeper_internal",
        "authority": "advisory",
        "hard_gate": False,
        "decision_id": str(args["decision_id"]),
        "draft_sha256": hashlib.sha256(draft.encode("utf-8")).hexdigest(),
        "findings": findings,
        "recommendation": "consider_revision" if findings else "no_revision_suggested",
    }
    ctx.ledger_record(args["decision_id"], "narration.review", data)
    coc_state.append_jsonl(
        ctx.campaign_dir / "logs" / "narration-reviews.jsonl",
        {**data, "ts": _now_iso()},
    )
    return data, [], ["the KP decides whether and how to revise; this review never blocks delivery"]


@tool(
    "evidence.record_adoption",
    "Record which advisory candidates the KP adopted, modified, or ignored. Keeper-internal audit evidence only.",
    {
        "decision_id": {"type": "string", "required": True, "desc": "stable turn decision id"},
        "advice_id": {"type": "string", "required": True, "desc": "id returned by an advisory tool"},
        "disposition": {"type": "string", "required": True, "desc": "adopted | modified | ignored"},
        "reason": {"type": "string", "required": True, "desc": "concise semantic reason, not hidden chain-of-thought"},
        "adopted_fields": {"type": "array", "desc": "structured field paths actually used"},
        "emotional_tone_adoption": {"type": "array", "desc": "per-NPC first-impression follow-through for each npc_moves[].emotional_tone in the referenced plan: {npc_id, emotional_tone, adoption: adopted|modified|ignored}"},
        "storylet_candidate": {
            "type": "object",
            "desc": "legacy optional exact candidate returned by actions.advise/storylets.suggest; prefer candidate_ref",
        },
        "candidate_ref": {
            "type": "string",
            "desc": "optional stable candidate_ref returned by actions.advise; the canonical candidate is resolved from advisory evidence",
        },
        "finalization_id": {
            "type": "string",
            "desc": "optional finalized output proving the adopted candidate reached the delivered draft",
        },
        "exact_excerpt": {
            "type": "string",
            "desc": "optional exact finalized draft excerpt realizing the adopted candidate",
        },
    },
)
def _tool_evidence_record_adoption(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup(
        "evidence.record_adoption", args.get("decision_id")
    )
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously recorded advisory disposition"
        ], []
    disposition = str(args.get("disposition") or "")
    if disposition not in {"adopted", "modified", "ignored"}:
        raise ToolError("invalid_param", "disposition must be adopted, modified, or ignored")
    reason = str(args.get("reason") or "").strip()
    if not reason:
        raise ToolError("invalid_param", "reason is required")
    fields = args.get("adopted_fields") or []
    if not isinstance(fields, list) or any(not isinstance(value, str) for value in fields):
        raise ToolError("invalid_param", "adopted_fields must be an array of strings")
    tone_adoption = args.get("emotional_tone_adoption") or []
    if not isinstance(tone_adoption, list):
        raise ToolError("invalid_param", "emotional_tone_adoption must be an array")
    normalized_tones: list[dict[str, str]] = []
    for entry in tone_adoption:
        if not isinstance(entry, dict):
            raise ToolError("invalid_param", "emotional_tone_adoption entries must be objects")
        tone_npc_id = str(entry.get("npc_id") or "").strip()
        tone_value = str(entry.get("emotional_tone") or "").strip()
        tone_status = str(entry.get("adoption") or "").strip()
        if not tone_npc_id or not tone_value:
            raise ToolError(
                "invalid_param",
                "emotional_tone_adoption entries require npc_id and emotional_tone",
            )
        if tone_status not in {"adopted", "modified", "ignored"}:
            raise ToolError(
                "invalid_param",
                "emotional_tone_adoption adoption must be adopted, modified, or ignored",
            )
        normalized_tones.append({
            "npc_id": tone_npc_id,
            "emotional_tone": tone_value,
            "adoption": tone_status,
        })
    data = {
        "schema_version": 1,
        "visibility": "keeper_internal",
        "decision_id": str(args["decision_id"]),
        "advice_id": str(args["advice_id"]),
        "disposition": disposition,
        "reason": reason,
        "adopted_fields": fields,
    }
    if args.get("finalization_id") is not None:
        data["finalization_id"] = str(args["finalization_id"])
    if args.get("exact_excerpt") is not None:
        data["exact_excerpt"] = str(args["exact_excerpt"])
    if normalized_tones:
        data["emotional_tone_adoption"] = normalized_tones
    warnings: list[str] = []
    storylet_candidate = args.get("storylet_candidate")
    candidate_ref = str(args.get("candidate_ref") or "").strip()
    if storylet_candidate is not None and candidate_ref:
        warnings.append(
            "both candidate_ref and storylet_candidate were supplied; the stable candidate_ref was used"
        )
        storylet_candidate = None
    if candidate_ref:
        data["candidate_ref"] = candidate_ref
        try:
            storylet_candidate = _resolve_storylet_candidate_ref(
                ctx,
                advice_id=args.get("advice_id"),
                candidate_ref=candidate_ref,
            )
        except ToolError as exc:
            storylet_candidate = None
            warnings.append(
                "candidate_ref could not be resolved; adoption evidence was kept "
                f"but the anti-repeat ledger was not changed: {exc.message}"
            )
    if storylet_candidate is not None:
        if not isinstance(storylet_candidate, dict):
            warnings.append(
                "storylet_candidate was not an object; adoption evidence was kept but the anti-repeat ledger was not changed"
            )
        elif disposition in {"adopted", "modified"}:
            if not _storylet_advice_matches_candidate(
                args["advice_id"], storylet_candidate
            ):
                warnings.append(
                    "storylet candidate no longer matches this turn's stable advice id; adoption evidence was kept but the anti-repeat ledger was not changed"
                )
            elif not str(storylet_candidate.get("storylet_id") or "").strip():
                warnings.append(
                    "storylet candidate has no stable storylet_id; adoption evidence was kept but the anti-repeat ledger was not changed"
                )
            else:
                ledger_path = ctx.campaign_dir / "save" / "storylet-ledger.json"
                current_ledger = _read_optional_json(ledger_path, {})
                ledger_update = coc_storylets.project_ledger_update(
                    current_ledger, storylet_candidate
                )
                coc_state.write_json_atomic(ledger_path, ledger_update)
                data["storylet_adoption"] = {
                    "storylet_id": storylet_candidate.get("storylet_id"),
                    "family_id": storylet_candidate.get("family_id"),
                    "trope_id": storylet_candidate.get("trope_id"),
                    "ledger_updated": True,
                }
                ctx.log_event({
                    "event_type": "storylet_move",
                    "decision_id": str(args["decision_id"]),
                    "storylet_id": storylet_candidate.get("storylet_id"),
                    "family_id": storylet_candidate.get("family_id"),
                    "trope_id": storylet_candidate.get("trope_id"),
                    "title": storylet_candidate.get("title"),
                    "cue": storylet_candidate.get("cue"),
                    "beat": storylet_candidate.get("beat"),
                    "conflict_level": storylet_candidate.get("conflict_level"),
                    "target_conflict_level": storylet_candidate.get(
                        "target_conflict_level"
                    ),
                    "bound_entities": deepcopy(
                        storylet_candidate.get("bound_entities") or {}
                    ),
                    "rolled_variants": deepcopy(
                        storylet_candidate.get("rolled_variants") or {}
                    ),
                    "presentation_mode": storylet_candidate.get(
                        "presentation_mode"
                    ),
                    "grounding_contract": deepcopy(
                        storylet_candidate.get("grounding_contract") or {}
                    ),
                    "serves": deepcopy(storylet_candidate.get("serves") or []),
                    "source": "toolbox_advisory_adoption",
                })
    ctx.ledger_record(args["decision_id"], "evidence.record_adoption", data)
    coc_state.append_jsonl(
        ctx.campaign_dir / "logs" / "advisory-adoptions.jsonl",
        {**data, "ts": _now_iso()},
    )
    return data, warnings, [
        "this receipt proves use or rejection; it does not constrain the next turn",
        "an adopted Storylet updates only its existing anti-repeat ledger; the KP still owns fictional realization and may ignore future candidates",
    ]


@tool(
    "chase.context",
    "Read the current canonical ChaseSession snapshot and unresolved subsystem choices.",
    {},
)
def _tool_chase_context(ctx: Ctx, args: dict[str, Any]):
    snapshot = _read_optional_json(ctx.campaign_dir / "save" / "chase.json", None)
    choices = coc_subsystem_executor.get_current_pending_choices(ctx.campaign_dir)
    return {
        "active": isinstance(snapshot, dict) and snapshot.get("status") == "active",
        "snapshot": snapshot,
        "pending_choices": choices,
    }, [], ["use chase.execute only when the fiction naturally enters or continues a chase"]


@tool(
    "chase.execute",
    "Execute one exact command through the existing full ChaseSession subsystem. No fixed chase workflow is imposed by the toolbox.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "command": {"type": "object", "required": True, "desc": "exact chase_start/move/hazard/barrier/conflict/end command"},
        "seed": {"type": "integer", "desc": "deterministic RNG seed"},
        "decision_id": {"type": "string", "desc": "idempotency key; must match command.payload.decision_id"},
    },
)
def _tool_chase_execute(ctx: Ctx, args: dict[str, Any]):
    return _execute_subsystem_command(
        ctx,
        args,
        tool_name="chase.execute",
        allowed_kinds=coc_subsystem_executor.CHASE_COMMAND_KINDS,
    )


@tool(
    "sanity.context",
    "Read the full persisted SanitySession snapshot and unresolved subsystem choices.",
    {"investigator": {"type": "string", "desc": "investigator id"}},
)
def _tool_sanity_context(ctx: Ctx, args: dict[str, Any]):
    investigator_id = _resolve_investigator(ctx, args)
    snapshot = _read_optional_json(
        ctx.campaign_dir / "save" / "sanity-state" / f"{investigator_id}.json", None
    )
    choices = coc_subsystem_executor.get_current_pending_choices(ctx.campaign_dir)
    return {
        "investigator_id": investigator_id,
        "active": isinstance(snapshot, dict),
        "snapshot": snapshot,
        "pending_choices": choices,
    }, [], ["use sanity.execute for full checks, bouts, and their persisted consequences"]


@tool(
    "sanity.execute",
    "Execute one exact sanity_check/bout command through the existing full SanitySession subsystem.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "command": {"type": "object", "required": True, "desc": "exact sanity_check, bout_tick, or bout_end command"},
        "seed": {"type": "integer", "desc": "deterministic RNG seed"},
        "decision_id": {"type": "string", "desc": "idempotency key; must match command.payload.decision_id"},
    },
)
def _tool_sanity_execute(ctx: Ctx, args: dict[str, Any]):
    investigator_id = _resolve_investigator(ctx, args)
    player_state_before = _player_mechanical_snapshot(ctx, investigator_id)
    normalized_args = deepcopy(args)
    command = normalized_args.get("command")
    payload = command.get("payload") if isinstance(command, dict) else None
    trigger_id = ""
    if isinstance(payload, dict):
        trigger_id = str(
            payload.get("trigger_id") or payload.get("san_trigger_id") or ""
        ).strip()
        if trigger_id:
            payload["san_trigger_id"] = trigger_id

    data, warnings, hints = _execute_subsystem_command(
        ctx,
        normalized_args,
        tool_name="sanity.execute",
        allowed_kinds=frozenset({"sanity_check", "bout_tick", "bout_end"}),
    )
    data["player_state_receipt"] = _player_state_receipt(
        player_state_before,
        _player_mechanical_snapshot(ctx, investigator_id),
    )
    if trigger_id:
        active_scene = _active_scene(ctx)
        authored_ids = {
            str(trigger.get("trigger_id"))
            for trigger in ((active_scene.get("on_enter") or {}).get(
                "san_triggers", []
            ))
            if isinstance(trigger, dict) and trigger.get("trigger_id")
        }
        if trigger_id not in authored_ids:
            warnings.append(
                f"SAN trigger '{trigger_id}' is not authored for the active scene — "
                "the check remains valid but the trigger was recorded as improvised"
            )
        world = ctx.world()
        fired = [str(value) for value in (world.get("san_triggers_fired") or [])]
        if trigger_id not in fired:
            fired.append(trigger_id)
            world["san_triggers_fired"] = fired
            ctx.save_world(world)
        # Preserve the canonical authored identity in the returned/ledgered
        # subsystem evidence, including idempotent replay of pre-fix results.
        for result in data.get("results") or []:
            if not isinstance(result, dict) or result.get("kind") != "sanity_check":
                continue
            for event in result.get("events") or []:
                if isinstance(event, dict) and event.get("kind") == "sanity_check":
                    event["san_trigger_id"] = trigger_id
    ctx.ledger_record(args.get("decision_id"), "sanity.execute", data)
    return data, warnings, hints


@tool(
    "secrets.briefing",
    "Keeper-only briefing scoped to the active scene by default. "
    "Pass scope=whole_module_audit for explicit cold-path full-module dump.",
    {
        "scope": {
            "type": "string",
            "desc": "active_scene (default) | entities | whole_module_audit",
        },
        "scene_id": {
            "type": "string",
            "desc": (
                "for scope=active_scene: optional override (defaults to "
                "world.active_scene_id). for scope=entities: include a scene "
                "only when this is explicitly passed; never implied from active scene"
            ),
        },
        "npc_ids": {
            "type": "array",
            "desc": "optional explicit NPC ids when scope=entities",
        },
        "clue_ids": {
            "type": "array",
            "desc": "optional explicit clue ids when scope=entities",
        },
    },
    access="query",
    read_domains=("scene", "world", "clues", "npc", "flags"),
    response_mode="full",
    audit_mode="reference",
)
def _tool_secrets_briefing(ctx: Ctx, args: dict[str, Any]):
    world = ctx.world()
    discovered = {str(c) for c in (world.get("discovered_clue_ids") or [])}
    scope_raw = str(args.get("scope") or "active_scene").strip() or "active_scene"
    if scope_raw not in {"active_scene", "entities", "whole_module_audit"}:
        raise ToolError(
            "invalid_param",
            "scope must be active_scene, entities, or whole_module_audit",
        )
    # Default scene_id from world only for active_scene. Entity-only requests
    # must not silently expand to the active-scene secret surface.
    if scope_raw == "active_scene":
        scene_id = (
            str(args.get("scene_id") or world.get("active_scene_id") or "").strip()
            or None
        )
    elif "scene_id" in args and args.get("scene_id") is not None and str(args.get("scene_id")).strip():
        scene_id = str(args["scene_id"]).strip()
    else:
        scene_id = None
    npc_ids = [
        str(value)
        for value in (args.get("npc_ids") or [])
        if str(value).strip()
    ]
    clue_ids = [
        str(value)
        for value in (args.get("clue_ids") or [])
        if str(value).strip()
    ]
    if scope_raw == "active_scene" and not scene_id:
        raise ToolError(
            "invalid_param",
            "active_scene secrets.briefing requires an active scene or scene_id",
        )
    if scope_raw == "entities" and not (scene_id or npc_ids or clue_ids):
        raise ToolError(
            "invalid_param",
            "entities scope requires explicit scene_id and/or npc_ids and/or clue_ids",
        )

    warnings: list[str] = []
    archive_payload: dict[str, Any] | None = None
    if ctx.campaign_dir is not None:
        try:
            archive_payload = coc_compiled_archive.secrets_briefing_from_archive(
                ctx.campaign_dir,
                scope=scope_raw,
                scene_id=scene_id,
                npc_ids=npc_ids,
                clue_ids=clue_ids,
                discovered_clue_ids=discovered,
            )
        except coc_compiled_archive.CompiledArchiveError as exc:
            warnings.append(
                f"compiled archive unavailable ({exc.code}); using scenario IR fallback"
            )
        except Exception as exc:  # noqa: BLE001
            warnings.append(
                f"compiled archive secrets read failed; using scenario IR fallback ({exc})"
            )

    if archive_payload is not None:
        undiscovered = archive_payload.get("undiscovered_clues") or []
        npc_secrets = archive_payload.get("npc_secrets") or []
        module_secrets = archive_payload.get("module_secrets") or []
        archive_meta = {
            "archive_revision": archive_payload.get("archive_revision"),
            "source": "compiled_archive",
            "scope": archive_payload.get("scope"),
            "selected_counts": archive_payload.get("selected_counts"),
            "whole_module": bool(archive_payload.get("whole_module")),
        }
    else:
        # Explicit IR fallback (and whole_module_audit when archive missing).
        if scope_raw == "whole_module_audit":
            selected_clues = _all_clues(ctx.clue_graph)
            selected_npcs = [
                n for n in (ctx.npc_agendas.get("npcs") or []) if isinstance(n, dict)
            ]
            module_secrets = [
                {
                    "id": secret.get("id"),
                    "category": secret.get("category"),
                    "prose": secret.get("prose"),
                    "secret": True,
                }
                for secret in (
                    (ctx.scenario("improvisation-boundaries.json") or {}).get(
                        "keeper_secrets"
                    )
                    or []
                )
                if isinstance(secret, dict) and secret.get("id")
            ]
        elif scope_raw == "entities" and not scene_id:
            # Exact entity scope: only the explicit npc/clue ids, no active scene.
            selected_clues = [
                clue for clue in _all_clues(ctx.clue_graph)
                if str(clue.get("clue_id")) in set(clue_ids)
            ]
            selected_npcs = [
                n for n in (ctx.npc_agendas.get("npcs") or [])
                if isinstance(n, dict) and str(n.get("npc_id")) in set(npc_ids)
            ]
            module_secrets = []
        else:
            scene = _scene_by_id(ctx.story_graph, scene_id) if scene_id else None
            scene_clue_ids = {
                str(value) for value in ((scene or {}).get("available_clues") or [])
            }
            scene_npc_ids = {
                str(value) for value in ((scene or {}).get("npc_ids") or [])
            }
            if clue_ids:
                scene_clue_ids.update(clue_ids)
            if npc_ids:
                scene_npc_ids.update(npc_ids)
            selected_clues = [
                clue for clue in _all_clues(ctx.clue_graph)
                if str(clue.get("clue_id")) in scene_clue_ids
            ]
            selected_npcs = [
                n for n in (ctx.npc_agendas.get("npcs") or [])
                if isinstance(n, dict) and str(n.get("npc_id")) in scene_npc_ids
            ]
            module_secrets = []
        undiscovered = [
            {
                "clue_id": c.get("clue_id"),
                "player_safe_summary": c.get("player_safe_summary"),
                "delivery": c.get("delivery"),
                "secret": True,
            }
            for c in selected_clues
            if str(c.get("clue_id")) not in discovered
        ]
        npc_secrets = [
            {
                "npc_id": n.get("npc_id"),
                "name": n.get("name"),
                "secret": n.get("secret"),
                "keeper_note": n.get("keeper_note"),
                "secret_marker": True,
            }
            for n in selected_npcs
            if n.get("secret") or n.get("keeper_note")
        ]
        archive_meta = {
            "archive_revision": None,
            "source": "scenario_ir_fallback",
            "scope": scope_raw,
            "whole_module": scope_raw == "whole_module_audit",
        }

    meta = ctx.scenario("module-meta.json")
    # module_meta overview is only included on explicit whole-module audit.
    module_meta: dict[str, Any] = {"title": meta.get("title")}
    if scope_raw == "whole_module_audit":
        module_meta["keeper_overview"] = {
            "value": meta.get("keeper_overview") or meta.get("overview"),
            "secret": True,
        }
    data = {
        "module_truth_note": "module truth is read-only: tools never let you rewrite it, and you should not contradict it",
        "module_meta": module_meta,
        "scope": scope_raw,
        "scene_id": scene_id,
        "undiscovered_clues": undiscovered,
        "npc_secrets": npc_secrets,
        "module_secrets": module_secrets if scope_raw != "active_scene" or module_secrets else [],
        "spoiler_reveals_so_far": ctx.flags().get("spoiler_reveals"),
        "compiled_archive": archive_meta,
        "secret": True,
    }
    if scope_raw == "active_scene" and archive_payload is not None:
        # Active-scene path may still surface scene-bound module secret refs.
        data["module_secrets"] = archive_payload.get("module_secrets") or []
    hints = [
        "reveal secrets only through play (successful rolls, NPC disclosure, discovery) — never as narration exposition",
        "when a secret does surface, record it with state.record_clue or flags so the briefing stays current",
    ]
    if scope_raw == "active_scene":
        hints.append(
            "default secrets.briefing is active-scene scoped; pass scope=whole_module_audit "
            "only for explicit cold-path module audit"
        )
    elif scope_raw == "whole_module_audit":
        hints.append(
            "whole_module_audit returns the full remaining secret surface; prefer active_scene or entities during play"
        )
    return data, warnings, hints


# --------------------------------------------------------------------------- #
# state.* — transactional writes
# --------------------------------------------------------------------------- #

@tool(
    "state.record_clue",
    "Record a clue as discovered. Idempotent; unlocks any scenes gated on it. Off-design discoveries warn, not block.",
    {
        "clue_id": {"type": "string", "required": True, "desc": "clue id from the clue graph"},
        "method": {"type": "string", "desc": "how it was found (roll, social, exploration...)"},
        "route_ref": {
            "type": "object",
            "desc": "optional exact {scene_id, route_id} from actions.advise; binds direct clue delivery to authored route completion without forcing the route",
        },
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
    if clue is not None and _clue_is_roll_gated(clue):
        missing = _skill_check_clues_missing_roll_evidence(ctx, [clue_id])
        if missing:
            gate = missing[0]
            skills = "/".join(gate["gate_skills"]) or "the authored gate skill"
            mode = gate.get("discovery_mode") or gate.get("delivery_kind")
            warnings.append(
                f"clue '{clue_id}' is authored with roll gate {mode} "
                f"({skills}) but no matching skill roll is logged — if the player "
                "simply declared this fact, run rules.roll before confirming it, "
                "or consciously rule a free reveal"
            )

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

    route_context: dict[str, Any] | None = None
    route_ref = args.get("route_ref")
    if route_ref is not None:
        if isinstance(route_ref, dict):
            scene_ref = str(route_ref.get("scene_id") or "").strip()
            route_id = str(route_ref.get("route_id") or "").strip()
            if scene_ref and route_id:
                route_context = {
                    "schema_version": 1,
                    "hard_gate": False,
                    "scene_id": scene_ref,
                    "route_id": route_id,
                }
            else:
                warnings.append(
                    "route_ref was incomplete; clue remained recorded and no route completion was inferred"
                )
        else:
            warnings.append(
                "route_ref was not an object; clue remained recorded and no route completion was inferred"
            )
    route_completion, route_warnings = _settle_contextual_route(
        ctx,
        route_context,
        decision_id=str(args.get("decision_id") or f"clue:{clue_id}"),
        source_tool="state.record_clue",
        successful=False,
        committed_clue_ids=[clue_id] if not already else [],
    )
    warnings.extend(route_warnings)

    data = {
        "clue_id": clue_id,
        "already_discovered": already,
        "player_safe_summary": (clue or {}).get("player_safe_summary"),
        "localized_text": (clue or {}).get("localized_text"),
        "discovered_total": len(discovered),
        "newly_unlocked_scenes": newly_unlocked,
        "route_completion": deepcopy(route_completion),
    }
    progressive_hints: list[str] = []
    if not already:
        ctx.log_event({"event_type": "clue_discovered", "clue_id": clue_id, "method": args.get("method")})
        # Progressive dig queue: structured mentions on the clue only (no free-prose scan).
        try:
            if ctx.campaign_dir is not None and coc_module_project.campaign_asset_root_id(
                ctx.campaign_dir
            ):
                dig = coc_module_project.on_clue_discovered(
                    ctx.root, ctx.campaign_id, clue_id,
                )
                if dig and dig.get("progressive") and dig.get("followed"):
                    data["progressive"] = {
                        "followed": dig.get("followed"),
                        "host_hints": dig.get("host_hints") or [],
                        "merged_location_ids": dig.get("merged_location_ids") or [],
                    }
                    progressive_hints.extend(list(dig.get("host_hints") or []))
                    progressive_hints.append(
                        f"progressive: clue mentions queued {len(dig['followed'])} "
                        "deepen target(s) — host-extract missing packs before inventing table detail"
                    )
        except Exception as exc:  # progressive must never block clue write
            warnings.append(f"progressive clue-follow skipped: {exc}")
    hints: list[str] = []
    if newly_unlocked:
        hints.append(f"new scene(s) unlocked: {', '.join(newly_unlocked)} — consider signposting them")
    hints.extend(progressive_hints)
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
        "defer_initial_progressive_on_enter": {
            "type": "boolean",
            "desc": "experimental initial-only deferral of the complete progressive on-enter hook",
        },
    },
)
def _tool_state_move_scene(ctx: Ctx, args: dict[str, Any]):
    target = str(args["scene_id"])
    if (
        "defer_initial_progressive_on_enter" in args
        and not isinstance(args.get("defer_initial_progressive_on_enter"), bool)
    ):
        raise ToolError(
            "invalid_param", "defer_initial_progressive_on_enter must be boolean"
        )
    defer_initial = args.get("defer_initial_progressive_on_enter") is True
    prior = ctx.ledger_lookup("state.move_scene", args.get("decision_id"))
    if prior is not None:
        prior_data = prior.get("data") if isinstance(prior.get("data"), dict) else {}
        prior_progressive = (
            prior_data.get("progressive")
            if isinstance(prior_data.get("progressive"), dict)
            else {}
        )
        prior_deferred = prior_progressive.get("on_enter_deferred") is True
        if (defer_initial or prior_deferred) and (
            defer_initial != prior_deferred
            or str(prior_data.get("to_scene_id") or "") != target
        ):
            raise ToolError(
                "idempotency_conflict",
                "decision_id already settled a different initial scene deferral",
            )
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    world = ctx.world()
    sg = ctx.story_graph
    coc_scene_graph.ensure_world_scene_fields(world, sg)
    active = world.get("active_scene_id")
    warnings: list[str] = []
    scene = _scene_by_id(sg, target)
    if defer_initial:
        decision_id = str(args.get("decision_id") or "").strip()
        if not decision_id:
            raise ToolError(
                "initial_progressive_deferral_invalid",
                "initial progressive deferral requires a nonempty decision_id",
            )
        if ctx.campaign_dir is None or not coc_module_project.campaign_is_pristine_for_opening(
            ctx.campaign_dir
        ):
            raise ToolError(
                "initial_progressive_deferral_invalid",
                "initial progressive deferral is legal only before any played scene evidence",
            )
        try:
            root_info = coc_module_project.resolve_opening_preparation_root(
                ctx.root, str(ctx.campaign_id),
            )
            skeleton = coc_module_project.coc_module_assets.get_skeleton(
                ctx.root, str(root_info["asset_root_id"]),
            )
            if not isinstance(skeleton, dict):
                raise coc_module_project.OpeningPreparationError(
                    "opening_skeleton_missing", "opening skeleton is missing",
                )
            selected = coc_module_project.select_opening_start(
                ctx.campaign_dir, skeleton, target,
            )
            persisted_binding = (
                coc_module_project.current_opening_projection_source_binding(
                    ctx.campaign_dir
                )
            )
            if not isinstance(persisted_binding, dict):
                raise coc_module_project.OpeningPreparationError(
                    "opening_projection_binding_missing",
                    "the projected opening has no durable source binding",
                )
            persisted_scope = persisted_binding.get("source_scope")
            if not (
                persisted_binding.get("schema_version") == 1
                and persisted_binding.get("authority") == "source_authored"
                and persisted_binding.get("asset_root_id")
                == str(root_info["asset_root_id"])
                and persisted_binding.get("start_location_id") == selected
                and isinstance(persisted_scope, dict)
            ):
                raise coc_module_project.OpeningPreparationError(
                    "opening_projection_binding_invalid",
                    "the durable opening source binding does not match this target",
                )
            binding_result = coc_module_project.resolve_selected_opening_binding(
                ctx.root,
                root_info,
                skeleton,
                selected,
                persisted_scope.get("pdf_indices"),
            )
            readiness = binding_result["readiness"]
            if not readiness["ready"]:
                raise coc_module_project.OpeningPreparationError(
                    "opening_pack_not_ready", "selected opening pack is not ready",
                )
            if readiness.get("source_binding") != persisted_binding:
                raise coc_module_project.OpeningPreparationError(
                    "opening_projection_binding_invalid",
                    "the durable opening source binding no longer matches repository evidence",
                )
            payload = coc_module_project.build_opening_projection_payload(
                ctx.root,
                str(root_info["asset_root_id"]),
                selected,
                binding_result["scope"],
            )
            expected_receipt = coc_module_project.opening_projection_receipt(
                str(root_info["asset_root_id"]), selected, payload,
            )
        except coc_module_project.OpeningPreparationError as exc:
            raise ToolError(
                "initial_progressive_deferral_invalid", exc.message,
            ) from exc
        except coc_module_project.coc_module_assets.ModuleAssetsError as exc:
            raise ToolError(
                "initial_progressive_deferral_invalid", str(exc),
            ) from exc
        except coc_module_project.ModuleProjectError as exc:
            raise ToolError(
                "initial_progressive_deferral_invalid", str(exc),
            ) from exc
        if (
            coc_module_project.current_opening_projection_receipt(ctx.campaign_dir)
            != expected_receipt
            or not coc_module_project.opening_projection_state_is_fresh(
                ctx.root,
                ctx.campaign_dir,
                str(root_info["asset_root_id"]),
                selected,
                binding_result["scope"],
            )
        ):
            raise ToolError(
                "initial_progressive_deferral_invalid",
                "target is not the current receipt-bound authored start projection",
            )
    if scene is None:
        warnings.append(f"scene '{target}' is not in the story graph — moving anyway (improvised location)")
    else:
        candidates = coc_scene_graph.transition_candidates(active, sg, dict(world))
        unlocked = {str(s) for s in world.get("unlocked_scene_ids") or []}
        initial_authored_start = active is None and bool(scene.get("is_start"))
        if target not in candidates and not initial_authored_start:
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
    time_scene_change = coc_time.record_scene_change(
        ctx.campaign_dir,
        target,
        decision_id=str(args.get("decision_id") or f"scene:{active}:{target}"),
        reason=str(args.get("reason") or ""),
    )

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
        "decision_id": args.get("decision_id"),
    })
    data = {
        "from_scene_id": active,
        "to_scene_id": target,
        "newly_unlocked_scenes": newly_unlocked,
        "time_scene_change": time_scene_change,
        "scene": {
            "scene_type": (scene or {}).get("scene_type"),
            "dramatic_question": (scene or {}).get("dramatic_question"),
            "tone": (scene or {}).get("tone"),
        } if scene else None,
        "next_operation": {
            "operation": "scene.context",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {},
            "missing_arguments": [],
            "reason": "Read the newly active scene's bounded material after the transition.",
            "hard_gate": False,
        },
    }
    # Progressive on-demand track: hot-ring enqueue + merge ready deep packs.
    # Never blocks travel; failures become warnings only.
    try:
        progressive_info = (
            {"deferred": True}
            if defer_initial
            else coc_module_project.on_enter_scene(
                ctx.root, str(ctx.campaign_id or ""), target,
            )
        )
        if defer_initial:
            data["progressive"] = {
                "on_enter_deferred": True,
                "deferred_operation": "progressive.on_enter_scene",
                "resume_available": False,
                "scope": "entire_initial_progressive_on_enter_hook",
            }
        elif progressive_info and progressive_info.get("progressive"):
            data["progressive"] = {
                "merged_active": progressive_info.get("merged_active"),
                "neighbors": progressive_info.get("neighbors") or [],
                "prefetched_neighbors": progressive_info.get(
                    "prefetched_neighbors"
                ) or [],
                "deferred_neighbor_count": len(
                    progressive_info.get("deferred_neighbors") or []
                ),
                "neighbor_prefetch_budget": progressive_info.get(
                    "neighbor_prefetch_budget"
                ),
                "host_hints": progressive_info.get("host_hints") or [],
                "asset_root_id": progressive_info.get("asset_root_id"),
            }
            for hint in progressive_info.get("host_hints") or []:
                if isinstance(hint, str) and hint not in warnings:
                    warnings.append(hint)
            if progressive_info.get("merged_active"):
                # Invalidate scenario cache so later tools see deep merge
                ctx._scenario_cache.pop("story-graph.json", None)
                ctx._scenario_cache.pop("clue-graph.json", None)
                ctx._scenario_cache.pop("npc-agendas.json", None)
                ctx._scenario_cache.pop("module-meta.json", None)
                refreshed = _scene_by_id(ctx.story_graph, target)
                if refreshed:
                    data["scene"] = {
                        "scene_type": refreshed.get("scene_type"),
                        "dramatic_question": refreshed.get("dramatic_question"),
                        "tone": refreshed.get("tone"),
                        "parse_state": refreshed.get("parse_state"),
                    }
                post_merge_unlocked = _evaluate_and_apply_unlocks(ctx, world)
                if post_merge_unlocked:
                    newly_unlocked.extend(
                        scene_id for scene_id in post_merge_unlocked
                        if scene_id not in newly_unlocked
                    )
                    data["newly_unlocked_scenes"] = newly_unlocked
                    ctx.save_world(world)
    except Exception as exc:
        warnings.append(f"progressive on-enter skipped: {exc}")

    ctx.ledger_record(args.get("decision_id"), "state.move_scene", data)
    return data, warnings, [
        "call the returned exact scene.context card once after moving; never "
        "preview a destination by passing scene_id to scene.context or by reading "
        "story-graph, clue-graph, module assets, or prior tool logs",
        *_adjudication_gap_hints(ctx),
    ]


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
    tool_name = "state.set_flag"
    decision_id = str(args["decision_id"])
    flag_id = str(args["flag_id"])
    value = bool(args.get("value", True))
    reason = str(args["reason"]) if args.get("reason") is not None else None
    operation = {
        "flag_id": flag_id,
        "value": value,
        "reason": reason,
    }
    flags = ctx.flags()
    _reconcile_all_flag_source_receipts(ctx, flags)
    receipt = _source_receipt(flags, tool_name, decision_id)
    if receipt is not None:
        _validate_source_receipt(
            receipt,
            tool_name=tool_name,
            decision_id=decision_id,
            operation=operation,
        )
        _operation_event_present(ctx, receipt)
        _repair_flag_live_head(ctx, flags, receipt)
        # Verify/repair the immutable event before any additive world repair;
        # a duplicate or conflicting stable ID must leave world/ledger intact.
        _ensure_operation_event(ctx, receipt)
        # Unlocks are additive.  Repair only the exact IDs frozen in the
        # original receipt, preserving any later, unrelated world writes.
        frozen_unlocks = (receipt.get("data") or {}).get(
            "newly_unlocked_scenes"
        ) or []
        world = ctx.world()
        repaired = coc_scene_graph.apply_unlocks_to_world(
            world, [str(value) for value in frozen_unlocks if value]
        )
        if repaired:
            ctx.save_world(world)
        return _replay_source_receipt(ctx, receipt)

    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        raise ToolError(
            "state_corrupt",
            f"toolbox ledger entry for {tool_name} decision_id '{decision_id}' has no canonical source receipt",
        )

    flag_map = flags.get("flags")
    if flag_map is None:
        flag_map = {}
    elif not isinstance(flag_map, dict):
        raise ToolError(
            "state_corrupt",
            "save/flags.json has an invalid flags map; refusing to overwrite it",
        )
    flags["flags"] = flag_map
    current_head = (flags.get("flag_heads") or {}).get(flag_id)
    if current_head is not None and not _flag_head_is_source_anchored(
        ctx, flags, current_head
    ):
        raise ToolError(
            "state_corrupt",
            f"flag '{flag_id}' has an unanchored live head; refusing to overwrite it",
        )
    changed_at = _now_iso()
    source_sequence = _next_flag_source_sequence(ctx, flags)
    try:
        event, provenance, entity_head = coc_flag_state.commit_flag_mutation(
            flags,
            flag_id=flag_id,
            value=value,
            decision_id=decision_id,
            producer="state.set_flag",
            changed_at=changed_at,
            reason=reason,
            source_ref=f"save/flags.json#flag_provenance/{flag_id}",
            source_sequence=source_sequence,
            event_id=_operation_event_id(tool_name, decision_id),
        )
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    flag_map = flags["flags"]

    # Freeze the unlock result from this exact source transition before any
    # append/ledger stage.  A replay repairs these IDs additively and never
    # recalculates previous_value/provenance from later state.
    world = ctx.world()
    projected_world = deepcopy(world)
    unlock_candidates = coc_scene_graph.evaluate_unlocks(
        ctx.story_graph,
        projected_world,
        clock_reached=_clock_reached(ctx),
        flags_set={str(key) for key, enabled in flag_map.items() if enabled},
    )
    newly_unlocked = coc_scene_graph.apply_unlocks_to_world(
        projected_world, unlock_candidates
    )
    data = {
        "flag_id": flag_id,
        "value": value,
        "provenance": deepcopy(provenance),
        "newly_unlocked_scenes": list(newly_unlocked),
    }
    receipt = _new_source_receipt(
        tool_name=tool_name,
        decision_id=decision_id,
        operation=operation,
        event=event,
        data=data,
        entity_head=entity_head,
    )
    _put_source_receipt(flags, receipt)
    ctx.save_flags(flags)
    if newly_unlocked:
        ctx.save_world(projected_world)
    _ensure_operation_event(ctx, receipt)
    ctx.ledger_record(
        decision_id,
        tool_name,
        data,
        source_receipt_manifest=_source_receipt_manifest(receipt),
    )
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
        "conditions_before": before,
        "conditions_after": list(state.get("conditions") or []),
        "conditions": list(state.get("conditions") or []),
        "reason": reason,
    }
    ctx.ledger_record(
        decision_id, "state.clear_transient_condition", data
    )
    warnings = [] if changed else [f"condition '{condition}' was already absent"]
    return data, warnings, []


@tool(
    "state.inventory_list",
    "Show an investigator's effective items and weapons (character sheet minus recorded losses plus runtime gains), or an NPC's runtime items.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "npc_id": {"type": "string", "desc": "NPC actor id (query instead of an investigator)"},
    },
)
def _tool_state_inventory_list(ctx: Ctx, args: dict[str, Any]):
    npc_id = str(args.get("npc_id") or "").strip()
    if npc_id:
        document = coc_npc_state.load_npc_state(ctx.campaign_dir)
        row = coc_inventory.npc_items(document, npc_id)
        authored = coc_inventory.authored_weapons_for_npc(ctx.story_graph, npc_id)
        effective = coc_inventory.effective_npc_weapons(document, npc_id, authored)
        return {
            "npc_id": npc_id,
            "weapons": effective or [],
            "gear": row["gear"],
            "override_recorded": row["current_weapons"] is not None,
            "authored_weapons": authored,
        }, [], []
    investigator_id = _resolve_investigator(ctx, args)
    state = ctx.inv_state(investigator_id)
    sheet = ctx.sheet(investigator_id)
    inventory = coc_inventory.normalize_inventory(state)
    weapons = coc_inventory.effective_weapons(sheet.get("weapons"), inventory)
    return {
        "investigator_id": investigator_id,
        "items": coc_inventory.effective_items(
            sheet.get("equipment"), inventory
        ),
        "weapons": weapons,
        "lost_weapon_ids": list(inventory["lost_weapon_ids"]),
        "lost_equipment_ids": list(inventory["lost_equipment_ids"]),
    }, [], []


@tool(
    "state.item_grant",
    "Grant an item or weapon to an investigator or NPC. Granted weapons become legal combat selections; changes persist in campaign state and reach the investigator library at development settlement.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "npc_id": {"type": "string", "desc": "NPC actor id (exactly one of investigator/npc_id)"},
        "kind": {"type": "string", "required": True, "desc": "gear | weapon"},
        "label": {"type": "string", "required": True, "desc": "short display label"},
        "item_id": {"type": "string", "desc": "stable item id (defaults to weapon_id for weapons)"},
        "weapon_id": {"type": "string", "desc": "catalog/module weapon id (kind=weapon)"},
        "weapon": {"type": "object", "desc": "full custom weapon spec with weapon_id (kind=weapon)"},
        "mechanics_ref": {"type": "string", "desc": "campaign-item:<id> or module-item:<id> returned by mechanics.ensure"},
        "note": {"type": "string", "desc": "where/how the item was obtained"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_item_grant(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.item_grant"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    kind = str(args["kind"]).strip()
    if kind not in coc_inventory.ENTRY_KINDS:
        raise ToolError(
            "invalid_param", f"kind must be one of {list(coc_inventory.ENTRY_KINDS)}"
        )
    label = str(args["label"]).strip()
    if not label:
        raise ToolError("invalid_param", "label must be non-empty")
    note = str(args.get("note") or "").strip() or None
    weapon_spec: dict[str, Any] | None = None
    if kind == "weapon":
        raw_weapon = args.get("weapon")
        mechanics_ref = str(args.get("mechanics_ref") or "").strip()
        if mechanics_ref:
            if mechanics_ref.startswith("campaign-item:"):
                ref_id = mechanics_ref.split(":", 1)[1]
                row = ctx.campaign_mechanics()["items"].get(ref_id)
                profile = row.get("profile") if isinstance(row, dict) else None
            elif mechanics_ref.startswith("module-item:"):
                ref_id = mechanics_ref.split(":", 1)[1]
                source_item = _module_item(ctx, ref_id) or {}
                source_mechanics = source_item.get("mechanics")
                profile = (
                    source_mechanics.get("profile")
                    if isinstance(source_mechanics, dict)
                    and source_mechanics.get("status") == "authored"
                    else None
                )
            else:
                raise ToolError(
                    "invalid_param", "mechanics_ref must start with campaign-item: or module-item:",
                )
            if not isinstance(profile, dict) or profile.get("profile_kind") != "weapon":
                raise ToolError("invalid_param", "mechanics_ref does not resolve to a weapon profile")
            weapon_spec = deepcopy(profile)
            weapon_spec.pop("profile_kind", None)
        elif raw_weapon is not None:
            if not isinstance(raw_weapon, dict):
                raise ToolError("invalid_param", "weapon must be an object")
            weapon_spec = deepcopy(raw_weapon)
            if coc_inventory.weapon_ref_id(weapon_spec) is None:
                raise ToolError(
                    "invalid_param", "weapon.weapon_id must be a non-empty string"
                )
        else:
            weapon_id = str(args.get("weapon_id") or "").strip()
            if not weapon_id:
                raise ToolError(
                    "invalid_param", "kind=weapon requires weapon_id or weapon"
                )
            weapon_spec = {"weapon_id": weapon_id}
        item_id = (
            str(args.get("item_id") or "").strip()
            or coc_inventory.weapon_ref_id(weapon_spec)
        )
    else:
        if (
            args.get("weapon") is not None
            or str(args.get("weapon_id") or "").strip()
            or str(args.get("mechanics_ref") or "").strip()
        ):
            raise ToolError(
                "invalid_param", "kind=gear must not carry weapon_id/weapon"
            )
        item_id = str(args.get("item_id") or "").strip() or label

    npc_id = str(args.get("npc_id") or "").strip()
    if npc_id:
        document = coc_npc_state.load_npc_state(ctx.campaign_dir)
        if kind == "weapon":
            authored = coc_inventory.authored_weapons_for_npc(
                ctx.story_graph, npc_id
            )
            changed = coc_inventory.npc_add_weapon(
                document, npc_id, weapon_spec, authored
            )
        else:
            changed = coc_inventory.npc_add_gear(document, npc_id, label)
        if changed:
            coc_npc_state.save_npc_state(ctx.campaign_dir, document)
            ctx.log_event({
                "event_type": "item_granted",
                "owner_kind": "npc",
                "npc_id": npc_id,
                "kind": kind,
                "item_id": item_id,
                "weapon_id": coc_inventory.weapon_ref_id(weapon_spec),
                "label": label,
                "note": note,
            })
        data = {
            "npc_id": npc_id,
            "kind": kind,
            "item_id": item_id,
            "label": label,
            "changed": changed,
        }
        if kind == "weapon":
            data["weapon"] = deepcopy(weapon_spec)
        ctx.ledger_record(decision_id, tool_name, data)
        warnings = [] if changed else [f"item '{item_id}' already present"]
        return data, warnings, []

    investigator_id = _resolve_investigator(ctx, args)
    state = ctx.inv_state(investigator_id)
    sheet = ctx.sheet(investigator_id)
    inventory = coc_inventory.normalize_inventory(state)
    entry: dict[str, Any] = {"item_id": item_id, "kind": kind, "label": label}
    if weapon_spec is not None:
        entry["weapon"] = weapon_spec
    if note:
        entry["note"] = note
    entry["acquired"] = {
        "tool": tool_name,
        "decision_id": decision_id,
        "ts": _now_iso(),
    }
    inventory, changed = coc_inventory.grant_entry(inventory, entry)
    if changed:
        state["inventory"] = inventory
        ctx.save_inv_state(investigator_id, state)
        ctx.log_event({
            "event_type": "item_granted",
            "owner_kind": "investigator",
            "investigator_id": investigator_id,
            "kind": kind,
            "item_id": item_id,
            "weapon_id": coc_inventory.weapon_ref_id(weapon_spec),
            "label": label,
            "note": note,
        })
    data = {
        "investigator_id": investigator_id,
        "kind": kind,
        "item_id": item_id,
        "label": label,
        "changed": changed,
        "present_before": not changed,
        "present_after": True,
        "items": coc_inventory.effective_items(
            sheet.get("equipment"), inventory
        ),
    }
    if kind == "weapon":
        data["weapon"] = deepcopy(weapon_spec)
    ctx.ledger_record(decision_id, tool_name, data)
    warnings = [] if changed else [f"item '{item_id}' already present"]
    hints = (
        [f"weapon '{item_id}' is now a legal combat weapon_id for this investigator"]
        if kind == "weapon" and changed else []
    )
    return data, warnings, hints


@tool(
    "state.item_remove",
    "Remove an item or weapon from an investigator or NPC (lost, spent, given away, looted). Removing character-sheet equipment or a weapon records a campaign-local loss; removing an NPC weapon updates its runtime override.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "npc_id": {"type": "string", "desc": "NPC actor id (exactly one of investigator/npc_id)"},
        "item_id": {
            "type": "string",
            "required": True,
            "desc": "item id or weapon id to remove",
        },
        "reason": {"type": "string", "desc": "what happened to the item"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_item_remove(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.item_remove"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    item_id = str(args["item_id"]).strip()
    if not item_id:
        raise ToolError("invalid_param", "item_id must be non-empty")
    reason = str(args.get("reason") or "").strip() or None

    npc_id = str(args.get("npc_id") or "").strip()
    if npc_id:
        document = coc_npc_state.load_npc_state(ctx.campaign_dir)
        authored = coc_inventory.authored_weapons_for_npc(ctx.story_graph, npc_id)
        outcome = coc_inventory.npc_remove_weapon(
            document, npc_id, item_id, authored
        )
        removed_kind = "weapon"
        if outcome == "not_found":
            outcome = coc_inventory.npc_remove_gear(document, npc_id, item_id)
            removed_kind = "gear"
        changed = outcome != "not_found"
        if changed:
            coc_npc_state.save_npc_state(ctx.campaign_dir, document)
            ctx.log_event({
                "event_type": "item_removed",
                "owner_kind": "npc",
                "npc_id": npc_id,
                "kind": removed_kind,
                "item_id": item_id,
                "reason": reason,
            })
        data = {
            "npc_id": npc_id,
            "item_id": item_id,
            "outcome": outcome,
            "changed": changed,
        }
        ctx.ledger_record(decision_id, tool_name, data)
        warnings = [] if changed else [f"item '{item_id}' not found for npc '{npc_id}'"]
        return data, warnings, []

    investigator_id = _resolve_investigator(ctx, args)
    state = ctx.inv_state(investigator_id)
    sheet = ctx.sheet(investigator_id)
    sheet_weapon_ids = {
        wid
        for wid in (
            coc_inventory.weapon_ref_id(row) for row in (sheet.get("weapons") or [])
        )
        if wid is not None
    }
    sheet_equipment_entries = coc_inventory.sheet_equipment_entries(
        sheet.get("equipment")
    )
    sheet_equipment_ids = {
        str(entry["item_id"]) for entry in sheet_equipment_entries
    }
    inventory = coc_inventory.normalize_inventory(state)
    removed_label = item_id
    for entry in coc_inventory.effective_items(
        sheet.get("equipment"), inventory
    ):
        if isinstance(entry, dict) and str(entry.get("item_id") or "") == item_id:
            removed_label = str(entry.get("label") or item_id)
            break
    else:
        for weapon in coc_inventory.effective_weapons(
            sheet.get("weapons"), inventory
        ):
            if coc_inventory.weapon_ref_id(weapon) == item_id:
                removed_label = str(
                    weapon.get("label")
                    or weapon.get("name")
                    or weapon.get("weapon_id")
                    or item_id
                )
                break
    inventory, outcome = coc_inventory.remove_item(
        inventory, item_id, sheet_weapon_ids, sheet_equipment_ids
    )
    changed = outcome in {
        "removed_entry",
        "marked_lost",
        "marked_lost_equipment",
    }
    if changed:
        state["inventory"] = inventory
        ctx.save_inv_state(investigator_id, state)
        ctx.log_event({
            "event_type": "item_removed",
            "owner_kind": "investigator",
            "investigator_id": investigator_id,
            "item_id": item_id,
            "outcome": outcome,
            "reason": reason,
        })
    data = {
        "investigator_id": investigator_id,
        "item_id": item_id,
        "label": removed_label,
        "outcome": outcome,
        "changed": changed,
        "present_before": changed,
        "present_after": not changed,
        "items": coc_inventory.effective_items(
            sheet.get("equipment"), inventory
        ),
        "lost_weapon_ids": list(inventory["lost_weapon_ids"]),
        "lost_equipment_ids": list(inventory["lost_equipment_ids"]),
    }
    ctx.ledger_record(decision_id, tool_name, data)
    warnings = []
    if not changed:
        warnings.append(f"item '{item_id}' not found for investigator '{investigator_id}'")
    hints = []
    if outcome == "marked_lost":
        hints.append(
            f"'{item_id}' was a character-sheet weapon: the loss is recorded in "
            "campaign state and reaches the investigator library at development settlement"
        )
    if outcome == "marked_lost_equipment":
        hints.append(
            f"'{item_id}' was character-sheet equipment: the loss is recorded in "
            "campaign state and reaches the investigator library at development settlement"
        )
    return data, warnings, hints


def _normalize_engagement_route_completion(
    ctx: Ctx, value: Any,
) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {
        "scene_id", "route_id", "semantic_reason",
    }:
        raise ToolError(
            "invalid_param",
            "route_completion must contain exactly scene_id, route_id, semantic_reason",
        )
    normalized = {
        key: str(value.get(key) or "").strip()
        for key in ("scene_id", "route_id", "semantic_reason")
    }
    if not all(normalized.values()):
        raise ToolError(
            "invalid_param", "route_completion fields must be non-empty strings",
        )
    scene = _scene_by_id(ctx.story_graph, normalized["scene_id"])
    route = _affordance_by_id(scene, normalized["route_id"])
    if scene is None or route is None:
        raise ToolError(
            "invalid_param",
            "route_completion must name an exact authored scene/route pair",
        )
    return normalized


def _settle_engagement_route_completion(
    ctx: Ctx,
    route_completion: Any,
    *,
    decision_id: str,
    evidence_ref: str,
) -> tuple[dict[str, Any] | None, list[str]]:
    if not isinstance(route_completion, dict):
        return None, []
    return _settle_contextual_route(
        ctx,
        {
            "schema_version": 1,
            "hard_gate": False,
            "scene_id": route_completion["scene_id"],
            "route_id": route_completion["route_id"],
            "semantic_completion": True,
            "semantic_reason": route_completion["semantic_reason"],
            "evidence_ref": evidence_ref,
        },
        decision_id=decision_id,
        source_tool="state.record_npc_engagement",
        successful=True,
    )


def _npc_engagement_operation(
    ctx: Ctx, args: dict[str, Any]
) -> tuple[str, str, str, str, dict[str, Any]]:
    """Resolve the immutable engagement identity without writing campaign state."""
    decision_id = str(args["decision_id"])
    requested_npc_id = str(args["npc_id"])
    requested_interaction_kind = str(args["interaction_kind"]).strip()
    supplied_identity_ref = str(args.get("identity_ref") or "").strip()
    supplied_first_impression_ref = str(
        args.get("first_impression_ref") or ""
    ).strip()
    supplied_realization = deepcopy(args.get("first_impression_realization"))
    investigator_id = _resolve_investigator(ctx, args)
    run_id = coc_npc_event_chain.resolve_run_id(
        ctx.campaign_dir, structured_source=args
    )
    operation = {
        "npc_id": requested_npc_id,
        "investigator_id": investigator_id,
        "interaction_kind": requested_interaction_kind,
        "identity_ref": supplied_identity_ref or None,
        "first_impression_ref": supplied_first_impression_ref or None,
        "first_impression_realization": supplied_realization,
    }
    route_completion = _normalize_engagement_route_completion(
        ctx, args.get("route_completion")
    )
    if route_completion is not None:
        operation["route_completion"] = route_completion
    return (
        decision_id,
        requested_npc_id,
        requested_interaction_kind,
        run_id,
        operation,
    )


def _pending_npc_engagement_exact_replay(
    ctx: Ctx, args: dict[str, Any]
) -> tuple[dict[str, Any], list[str], list[str]] | None:
    """Prove a post-journal call is an already-recovered exact replay.

    This path is deliberately read-only.  It does not run source recovery or
    the normal handler because either could materialize a missing write after
    the journal boundary.
    """
    (
        decision_id,
        _requested_npc_id,
        _requested_interaction_kind,
        run_id,
        operation,
    ) = _npc_engagement_operation(ctx, args)
    try:
        document = coc_npc_event_chain.load_receipt_document(ctx.campaign_dir)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    prior_receipts = _npc_receipts_for_decision(
        document,
        producer="state.record_npc_engagement",
        decision_id=decision_id,
    )
    if not prior_receipts:
        return None
    if len(prior_receipts) != 1:
        raise ToolError(
            "state_corrupt",
            "state.record_npc_engagement decision_id "
            f"'{decision_id}' has multiple source receipts",
        )
    receipt = prior_receipts[0]
    if receipt.get("run_id") != run_id:
        raise ToolError(
            "idempotency_conflict",
            f"decision_id '{decision_id}' was already applied in a different play run",
        )
    if receipt.get("operation_digest") != coc_npc_event_chain.canonical_digest(
        operation
    ):
        raise ToolError(
            "idempotency_conflict",
            f"decision_id '{decision_id}' was already applied to a different NPC engagement payload",
        )
    event = receipt.get("event")
    if not isinstance(event, dict) or not _operation_event_present(ctx, receipt):
        raise ToolError(
            "state_corrupt",
            f"NPC engagement decision_id '{decision_id}' was not fully materialized before state.journal",
        )
    pending_rows = _pending_jsonl_rows(
        ctx, "logs/events.jsonl", str(receipt["event_id"])
    )
    if any(row != event for row in pending_rows) or len(pending_rows) > 1:
        raise ToolError(
            "state_corrupt",
            f"pending NPC engagement decision_id '{decision_id}' conflicts with its source receipt",
        )
    prior = ctx.ledger_lookup("state.record_npc_engagement", decision_id)
    if prior is None or prior.get("data") != event:
        raise ToolError(
            "state_corrupt",
            f"NPC engagement decision_id '{decision_id}' was not fully recovered before state.journal",
        )
    return deepcopy(event), [
        *_npc_receipt_warnings(receipt),
        "duplicate decision_id: returning the fully recovered NPC engagement without a new write",
    ], []


@tool(
    "state.record_npc_engagement",
    "Record one NPC's material participation. Each first investigator/NPC contact binds that pair's canonical npc.reaction receipt plus a KP-authored causal realization; one journal may contain zero to many independent engagements.",
    {
        "npc_id": {"type": "string", "required": True, "desc": "stable authored or improvised NPC id"},
        "investigator": {"type": "string", "desc": "investigator id (optional when party has one member)"},
        "interaction_kind": {
            "type": "string",
            "required": True,
            "desc": "dialogue | assistance | opposition | accompaniment | witness | other",
        },
        "identity_ref": {
            "type": "string",
            "desc": "exact identity_ref returned by npc.query/scene.context when the authored identity was portrayed",
        },
        "first_impression_ref": {
            "type": "string",
            "desc": "receipt ref from npc.reaction; mandatory on the first contact for this investigator/NPC pair",
        },
        "first_impression_realization": {
            "type": "object",
            "desc": "required for a new schema-v2 receipt: exactly {observable_manner, causal_explanation, boundary_preserved, opportunity_or_friction}; semantic KP judgment grounded in persona/agenda/relationship/scene/conduct",
        },
        "route_completion": {
            "type": "object",
            "desc": "optional exact {scene_id, route_id, semantic_reason}; include only when this engagement causally completes that authored route by KP semantic judgment, never by prose matching",
        },
        "run_id": {
            "type": "string",
            "desc": "current play/report segment run id; live play hosts supply this automatically",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_record_npc_engagement(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.record_npc_engagement"
    (
        decision_id,
        requested_npc_id,
        requested_interaction_kind,
        run_id,
        operation,
    ) = _npc_engagement_operation(ctx, args)
    supplied_route_completion = deepcopy(operation.get("route_completion"))
    supplied_identity_ref = str(args.get("identity_ref") or "").strip()
    supplied_first_impression_ref = str(
        args.get("first_impression_ref") or ""
    ).strip()
    supplied_realization = deepcopy(args.get("first_impression_realization"))
    investigator_id = str(operation["investigator_id"])
    campaign_id = coc_npc_event_chain.resolve_campaign_id(ctx.campaign_dir)

    document = _reconcile_all_npc_source_receipts(ctx)
    prior_receipts = _npc_receipts_for_decision(
        document, producer=tool_name, decision_id=decision_id
    )
    if prior_receipts:
        if len(prior_receipts) != 1:
            raise ToolError(
                "state_corrupt",
                f"{tool_name} decision_id '{decision_id}' has multiple source receipts",
            )
        receipt = prior_receipts[0]
        if receipt.get("run_id") != run_id:
            raise ToolError(
                "idempotency_conflict",
                f"decision_id '{decision_id}' was already applied in a different play run",
            )
        if receipt.get("operation_digest") != coc_npc_event_chain.canonical_digest(
            operation
        ):
            raise ToolError(
                "idempotency_conflict",
                f"decision_id '{decision_id}' was already applied to a different NPC engagement payload",
            )
        prior_event = receipt.get("event") if isinstance(receipt.get("event"), dict) else {}
        prior_effect = prior_event.get("context_effect") if isinstance(prior_event.get("context_effect"), dict) else {}
        if prior_event.get("first_contact") and all(
            isinstance(prior_effect.get(field), str) and prior_effect.get(field, "").strip()
            for field in (
                "source_receipt_id", "observable_manner", "causal_explanation",
                "boundary_preserved", "opportunity_or_friction",
            )
        ):
            coc_npc_state.initialize_first_impression(
                ctx.campaign_dir,
                str(prior_event.get("npc_id") or requested_npc_id),
                str(prior_event.get("investigator_id") or investigator_id),
                receipt_id=str(prior_effect["source_receipt_id"]),
                observable_manner=str(prior_effect["observable_manner"]),
                causal_explanation=str(prior_effect["causal_explanation"]),
                boundary_preserved=str(prior_effect["boundary_preserved"]),
                opportunity_or_friction=str(prior_effect["opportunity_or_friction"]),
                decision_id=decision_id,
            )
        _ensure_npc_receipt_event(ctx, receipt)
        route_receipt, route_warnings = _settle_engagement_route_completion(
            ctx,
            (receipt.get("operation") or {}).get("route_completion"),
            decision_id=decision_id,
            evidence_ref=f"logs/events.jsonl#{receipt['event_id']}",
        )
        replay_hints = []
        if route_receipt is not None:
            replay_hints.append(
                f"the engagement also completed authored route '{route_receipt['route_id']}' by recorded KP semantic judgment"
            )
        return deepcopy(receipt["event"]), [
            *_npc_receipt_warnings(receipt),
            *route_warnings,
            "duplicate decision_id: recovered the source-owned NPC engagement receipt",
        ], replay_hints

    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        raise ToolError(
            "state_corrupt",
            f"toolbox ledger entry for {tool_name} decision_id '{decision_id}' has no canonical source receipt",
        )

    authored_npc = _npc_by_id(ctx.npc_agendas, requested_npc_id)
    npc_id = str(authored_npc.get("npc_id")) if authored_npc else requested_npc_id
    prior_pair_engagements = [
        receipt
        for receipt in (document.get("receipts") or {}).values()
        if isinstance(receipt, dict)
        and receipt.get("producer") == tool_name
        and isinstance(receipt.get("event"), dict)
        and receipt["event"].get("investigator_id") == investigator_id
        and receipt["event"].get("npc_id") == npc_id
    ]
    first_contact = not prior_pair_engagements
    first_impression_receipt: dict[str, Any] | None = None
    context_effect: dict[str, Any] | None = None
    if first_contact:
        if not supplied_first_impression_ref:
            raise ToolError(
                "first_impression_required",
                "first contact requires first_impression_ref from npc.reaction before the engagement is written",
            )
        try:
            impression_document = coc_first_impression.load_document(
                ctx.campaign_dir, campaign_id
            )
            first_impression_receipt = coc_first_impression.find_by_ref(
                impression_document, supplied_first_impression_ref
            )
        except ValueError as exc:
            raise ToolError("state_corrupt", str(exc)) from exc
        if first_impression_receipt is None:
            raise ToolError(
                "first_impression_mismatch",
                "first_impression_ref does not identify a canonical current receipt",
            )
        if (
            first_impression_receipt.get("campaign_id") != campaign_id
            or first_impression_receipt.get("run_id") != run_id
            or first_impression_receipt.get("investigator_id") != investigator_id
            or first_impression_receipt.get("npc_id") != npc_id
        ):
            raise ToolError(
                "first_impression_mismatch",
                "first_impression_ref belongs to another campaign/run/investigator/NPC",
            )
        if first_impression_receipt.get("schema_version") == 2:
            if not coc_first_impression.valid_realization(supplied_realization):
                raise ToolError(
                    "first_impression_realization_required",
                    "schema-v2 first contact requires a complete causal realization grounded in NPC/scene/relationship/conduct boundaries",
                )
            _ensure_first_impression_roll(ctx, first_impression_receipt)
            context_effect = coc_first_impression.player_context_effect(
                first_impression_receipt, supplied_realization
            )
        else:
            if supplied_realization is not None:
                raise ToolError(
                    "invalid_param",
                    "legacy first-impression receipts already own their frozen observable manner",
                )
            context_effect = coc_first_impression.player_context_effect(
                first_impression_receipt
            )
    elif supplied_first_impression_ref:
        raise ToolError(
            "first_impression_already_consumed",
            "later meetings do not repeat or replace the pair's first-impression effect",
        )
    elif supplied_realization is not None:
        raise ToolError(
            "first_impression_already_consumed",
            "later meetings do not submit another first-impression realization",
        )
    interaction_kind = requested_interaction_kind
    allowed = {
        "dialogue", "assistance", "opposition", "accompaniment", "witness", "other",
    }
    if interaction_kind not in allowed:
        interaction_kind = "other"
    scene_id = str(ctx.world().get("active_scene_id") or "scene:unknown")
    identity_contract = (
        _npc_identity_contract(authored_npc, scene_id) if authored_npc else None
    )
    identity_binding = coc_npc_identity.identity_binding(
        identity_contract,
        supplied_identity_ref=supplied_identity_ref,
    )
    binding_status = str(identity_binding["status"])
    binding_reasons = list(identity_binding.get("reasons") or [])
    event_id = coc_npc_event_chain.stable_event_id(
        producer=tool_name,
        campaign_id=campaign_id,
        run_id=run_id,
        decision_id=decision_id,
        scene_id=scene_id,
        npc_id=npc_id,
        event_type="npc_engagement",
        ordinal=0,
    )
    event = {
        "schema_version": coc_npc_identity.ENGAGEMENT_EVENT_SCHEMA_VERSION,
        "event_type": "npc_engagement",
        "event_id": event_id,
        "source_receipt_schema_version": coc_npc_event_chain.RECEIPT_SCHEMA_VERSION,
        "producer": tool_name,
        "campaign_id": campaign_id,
        "run_id": run_id,
        "decision_id": decision_id,
        "investigator_id": investigator_id,
        "npc_id": npc_id,
        "scene_id": scene_id,
        "ts": _now_iso(),
        "interaction_kind": interaction_kind,
        "first_contact": first_contact,
        "first_impression_ref": (
            first_impression_receipt["receipt_id"]
            if first_impression_receipt is not None else None
        ),
        "context_effect": context_effect,
        "identity_contract": identity_contract,
        "identity_binding": identity_binding,
    }
    if supplied_route_completion is not None:
        event["route_completion"] = deepcopy(supplied_route_completion)
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
    receipt = coc_npc_event_chain.new_receipt(
        producer=tool_name,
        campaign_id=campaign_id,
        run_id=run_id,
        decision_id=decision_id,
        scene_id=scene_id,
        npc_id=npc_id,
        event_type="npc_engagement",
        ordinal=0,
        operation=operation,
        event=event,
    )
    if first_contact and isinstance(context_effect, dict) and all(
        isinstance(context_effect.get(field), str) and context_effect.get(field, "").strip()
        for field in (
            "source_receipt_id", "observable_manner", "causal_explanation",
            "boundary_preserved", "opportunity_or_friction",
        )
    ):
        coc_npc_state.initialize_first_impression(
            ctx.campaign_dir,
            npc_id,
            investigator_id,
            receipt_id=str(context_effect["source_receipt_id"]),
            observable_manner=str(context_effect["observable_manner"]),
            causal_explanation=str(context_effect["causal_explanation"]),
            boundary_preserved=str(context_effect["boundary_preserved"]),
            opportunity_or_friction=str(context_effect["opportunity_or_friction"]),
            decision_id=decision_id,
        )
    try:
        coc_npc_event_chain.put_receipt(document, receipt)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    # Source first: a crash before event/ledger is repaired by the next
    # mutating tool, even if the host chooses a different decision id.
    _save_npc_receipt_document(ctx, document)
    _ensure_npc_receipt_event(ctx, receipt)
    route_receipt, route_warnings = _settle_engagement_route_completion(
        ctx,
        supplied_route_completion,
        decision_id=decision_id,
        evidence_ref=f"logs/events.jsonl#{event_id}",
    )
    warnings.extend(route_warnings)
    hints = _npc_engagement_advisory_hints(authored_npc, npc_id)
    if first_contact:
        hints.append(
            "first contact settled exactly once for this pair: realize its observable manner, cause, and bounded opportunity/friction in the same fictional beat; other NPC pairs in this journal remain independent"
        )
    if route_receipt is not None:
        hints.append(
            f"this engagement completed authored route '{route_receipt['route_id']}' by explicit KP semantic judgment; dependent route cards are now discoverable without replaying its authored roll gate"
        )
    data = deepcopy(event)
    ctx.ledger_record(decision_id, tool_name, data)
    return data, warnings, hints


@tool(
    "state.record_route_completion",
    "Record a campaign-local authored route as completed when the KP has structured evidence that play achieved it through a causally valid alternate method. This never infers meaning from prose and never edits module truth.",
    {
        "scene_id": {
            "type": "string",
            "required": True,
            "desc": "exact authored scene id owning the route",
        },
        "route_id": {
            "type": "string",
            "required": True,
            "desc": "exact authored route/affordance id",
        },
        "semantic_reason": {
            "type": "string",
            "required": True,
            "desc": "KP semantic explanation of how established fiction completed the route",
        },
        "evidence_ref": {
            "type": "string",
            "required": True,
            "desc": "exact canonical receipt/event/state reference grounding that judgment",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_record_route_completion(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.record_route_completion"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously recorded route completion"
        ], []
    normalized = _normalize_engagement_route_completion(ctx, {
        "scene_id": args.get("scene_id"),
        "route_id": args.get("route_id"),
        "semantic_reason": args.get("semantic_reason"),
    })
    evidence_ref = str(args.get("evidence_ref") or "").strip()
    if not evidence_ref:
        raise ToolError("invalid_param", "evidence_ref must be non-empty")
    completion, warnings = _settle_engagement_route_completion(
        ctx,
        normalized,
        decision_id=decision_id,
        evidence_ref=evidence_ref,
    )
    data = {
        "completed": completion is not None,
        "route_completion": deepcopy(completion),
        "authority": "keeper_semantic_judgment",
        "hard_gate": False,
        "next_operation": {
            "operation": "scene.context",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": {},
            "missing_arguments": [],
            "reason": (
                "Refresh the bounded active-scene route index after recording "
                "this campaign-local semantic completion."
            ),
            "hard_gate": False,
        },
    }
    if completion is None:
        warnings.append(
            "the semantic route judgment was preserved as advice but did not yet satisfy the structured completion contract; clue-granting routes complete through state.record_clue route_ref"
        )
        return data, warnings, [
            "keep play moving; use the authored route's returned clue/state cards when their facts are actually delivered"
        ]
    ctx.ledger_record(decision_id, tool_name, data)
    return data, warnings, [
        "dependent authored routes are now visible through scene.context/actions.advise; this receipt does not force the player's next action"
    ]


@tool(
    "state.npc_presence",
    "Explicitly place or remove one stable authored/improvised NPC in a scene. This is live scene state; engagement history never implies continued presence.",
    {
        "npc_id": {
            "type": "string",
            "required": True,
            "desc": "stable authored or campaign-local NPC id",
        },
        "scene_id": {
            "type": "string",
            "required": True,
            "desc": "scene whose live presence is being asserted or ended",
        },
        "status": {
            "type": "string",
            "required": True,
            "enum": ["present", "absent"],
            "desc": "present places the NPC here; absent records that they are no longer here",
        },
        "reason": {
            "type": "string",
            "required": True,
            "desc": "fictional cause for this explicit presence change",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
    write_domains=("npc_presence",),
)
def _tool_state_npc_presence(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.npc_presence"
    decision_id = str(args["decision_id"])
    requested_npc_id = str(args["npc_id"]).strip()
    authored_npc = _npc_by_id(ctx.npc_agendas, requested_npc_id)
    npc_id = (
        str(authored_npc.get("npc_id")) if authored_npc else requested_npc_id
    )
    scene_id = str(args["scene_id"]).strip()
    status = str(args["status"]).strip().lower()
    reason = str(args["reason"]).strip()
    if not npc_id:
        raise ToolError("invalid_param", "npc_id must be non-empty")
    if not scene_id:
        raise ToolError("invalid_param", "scene_id must be non-empty")
    if status not in {"present", "absent"}:
        raise ToolError("invalid_param", "status must be present or absent")
    if not reason:
        raise ToolError("invalid_param", "reason must be non-empty")

    operation = {
        "npc_id": npc_id,
        "scene_id": scene_id,
        "status": status,
        "reason": reason,
    }
    document = _load_npc_presence_document(ctx)
    receipt = _source_receipt(document, tool_name, decision_id)
    if receipt is not None:
        _validate_source_receipt(
            receipt,
            tool_name=tool_name,
            decision_id=decision_id,
            operation=operation,
        )
        return _replay_source_receipt(ctx, receipt)
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        raise ToolError(
            "state_corrupt",
            f"toolbox ledger entry for {tool_name} decision_id '{decision_id}' has no canonical source receipt",
        )

    previous = deepcopy(document["presence"].get(npc_id))
    source_sequence = int(document["presence_source_sequence"]) + 1
    changed_at = _now_iso()
    record = {
        "schema_version": _NPC_PRESENCE_SCHEMA_VERSION,
        "npc_id": npc_id,
        "scene_id": scene_id,
        "status": status,
        "reason": reason,
        "revision": int((previous or {}).get("revision") or 0) + 1,
        "changed_at": changed_at,
        "decision_id": decision_id,
        "source_sequence": source_sequence,
        "producer": tool_name,
    }
    document["presence"][npc_id] = record
    live_record = _npc_presence_live_record(document, npc_id)
    entity_head = coc_flag_state.entity_head(
        entity_kind="npc_presence",
        entity_id=npc_id,
        decision_id=decision_id,
        source_sequence=source_sequence,
        producer=tool_name,
        live_record=live_record,
    )
    document["presence_heads"][npc_id] = deepcopy(entity_head)
    document["presence_source_sequence"] = source_sequence
    event = {
        "npc_presence_schema_version": _NPC_PRESENCE_SCHEMA_VERSION,
        "event_type": "npc_presence_changed",
        "event_id": _operation_event_id(tool_name, decision_id),
        "npc_id": npc_id,
        "scene_id": scene_id,
        "status": status,
        "previous_scene_id": (previous or {}).get("scene_id"),
        "previous_status": (previous or {}).get("status"),
        "reason": reason,
        "decision_id": decision_id,
        "source_sequence": source_sequence,
        "ts": changed_at,
        "live_head_digest": coc_flag_state.canonical_digest(entity_head),
    }
    warnings: list[str] = []
    if authored_npc is None:
        warnings.append(
            f"npc '{npc_id}' is campaign-local/improvised; explicit presence is tracked without inventing an authored identity contract"
        )
    elif requested_npc_id != npc_id:
        warnings.append(
            f"resolved NPC alias '{requested_npc_id}' to authored id '{npc_id}'"
        )
    if _scene_by_id(ctx.story_graph, scene_id) is None:
        warnings.append(
            f"scene '{scene_id}' is not in the current authored graph; presence remains campaign-local continuity"
        )
    hints = [
        "scene.context overlays this explicit live record over authored initial npc_ids; update it again when the NPC leaves or relocates",
        "do not derive current presence from state.record_npc_engagement history",
    ]
    data = {
        "npc_id": npc_id,
        "presence": deepcopy(record),
        "previous_presence": previous,
    }
    receipt = _new_source_receipt(
        tool_name=tool_name,
        decision_id=decision_id,
        operation=operation,
        event=event,
        data=data,
        warnings=warnings,
        hints=hints,
        entity_head=entity_head,
    )
    _put_source_receipt(document, receipt)
    coc_npc_state.save_npc_state(ctx.campaign_dir, document)
    _ensure_operation_event(ctx, receipt)
    ctx.ledger_record(
        decision_id,
        tool_name,
        data,
        source_receipt_manifest=_source_receipt_manifest(receipt),
    )
    return data, warnings, hints


@tool(
    "state.npc_update",
    "Update an NPC's live psych state: trust/fear/suspicion deltas, facts told, lies, promises made or resolved, availability, and a bounded investigator-specific textual impression authored by the KP.",
    {
        "npc_id": {"type": "string", "required": True, "desc": "npc id"},
        "investigator": {"type": "string", "desc": "investigator whose action changed this relationship; required when linking an NPC-scoped reward"},
        "trust_delta": {"type": "integer", "desc": "trust adjustment (-5..5 clamped)"},
        "fear_delta": {"type": "integer", "desc": "fear adjustment"},
        "suspicion_delta": {"type": "integer", "desc": "suspicion adjustment"},
        "record_fact": {"type": "string", "desc": "fact_id the NPC just disclosed"},
        "record_lie": {"type": "string", "desc": "lie_id the NPC just told"},
        "record_promise": {"type": "string", "desc": "promise_id made"},
        "resolve_promise": {
            "type": "object",
            "desc": "close an existing promise as exactly {promise_id, kept:boolean}",
            "properties": {
                "promise_id": {"type": "string"},
                "kept": {"type": "boolean"},
            },
            "additionalProperties": False,
        },
        "availability": {"type": "string", "desc": "availability status: available | unavailable"},
        "impression_update": {
            "type": "object",
            "desc": "semantic KP-authored update: {summary?, expectations?, reservations?, memory?, reason}; memory requires memory_id, event, interpretation, reason",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_npc_update(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.npc_update", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    requested_npc_id = str(args["npc_id"])
    investigator_id = (
        _resolve_investigator(ctx, args)
        if args.get("investigator") is not None
        else None
    )
    authored_npc = _npc_by_id(ctx.npc_agendas, requested_npc_id)
    npc_id = str(authored_npc.get("npc_id")) if authored_npc else requested_npc_id
    applied, entry = coc_npc_state.apply_psych_update(
        ctx.campaign_dir,
        npc_id,
        deltas={
            field: args[key]
            for field, key in (
                ("trust", "trust_delta"),
                ("fear", "fear_delta"),
                ("suspicion", "suspicion_delta"),
            )
            if args.get(key) is not None
        },
        record_fact_id=args.get("record_fact") or None,
        record_lie_id=args.get("record_lie") or None,
        record_promise_id=args.get("record_promise") or None,
        resolve_promise=deepcopy(args.get("resolve_promise")),
        availability=args.get("availability") or None,
        investigator_id=investigator_id,
        impression_update=deepcopy(args.get("impression_update")),
    )
    ctx.log_event({"event_type": "npc_update", "npc_id": npc_id, "applied": applied})
    warnings: list[str] = []
    if authored_npc is None:
        warnings.append(f"npc '{npc_id}' is not in the authored agendas — tracking state anyway (improvised NPC)")
    elif requested_npc_id != npc_id:
        warnings.append(
            f"resolved NPC alias '{requested_npc_id}' to authored id '{npc_id}'"
        )
    hints = _npc_engagement_advisory_hints(authored_npc, npc_id)
    if args.get("impression_update") is not None:
        hints.append(
            "textual impression updated for this investigator/NPC pair; later NPC portrayals should treat it as semantic context, not a deterministic gate"
        )
    data = {
        "npc_id": npc_id,
        "investigator_id": investigator_id,
        "applied": applied,
        "psych": entry,
    }
    ctx.ledger_record(args.get("decision_id"), "state.npc_update", data)
    return data, warnings, hints


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
    tool_name = "state.time_marker"
    decision_id = str(args["decision_id"])
    action = str(args["action"]).strip().lower()
    if action not in {"set", "reset", "clear"}:
        raise ToolError("invalid_param", "action must be set, reset, or clear")
    marker_id = str(args["marker_id"]).strip()
    if not marker_id:
        raise ToolError("invalid_param", "marker_id must be non-empty")

    minutes_from_now: int | None = None
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
    label = str(args["label"]) if args.get("label") is not None else None
    reason = str(args["reason"]) if args.get("reason") is not None else None
    operation = {
        "action": action,
        "marker_id": marker_id,
        "minutes_from_now": minutes_from_now,
        "label": label if action in {"set", "reset"} else None,
        "reason": reason,
    }

    payload = _load_time_markers(ctx)
    _reconcile_all_marker_source_receipts(ctx, payload)
    receipt = _source_receipt(payload, tool_name, decision_id)
    if receipt is not None:
        _validate_source_receipt(
            receipt,
            tool_name=tool_name,
            decision_id=decision_id,
            operation=operation,
        )
        _operation_event_present(ctx, receipt)
        _repair_marker_live_head(ctx, payload, receipt)
        return _replay_source_receipt(ctx, receipt)

    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        raise ToolError(
            "state_corrupt",
            f"toolbox ledger entry for {tool_name} decision_id '{decision_id}' has no canonical source receipt",
        )

    markers = payload["markers"]
    existing = markers.get(marker_id)
    existing = deepcopy(existing) if isinstance(existing, dict) else None
    current_head = payload["marker_heads"].get(marker_id)
    if current_head is not None and not _marker_head_is_source_anchored(
        ctx, payload, current_head
    ):
        raise ToolError(
            "state_corrupt",
            f"time marker '{marker_id}' has an unanchored live head; refusing to overwrite it",
        )
    warnings: list[str] = []
    now_wall = _now_iso()
    current = coc_time.current_stamp(ctx.campaign_dir)
    projected_marker: dict[str, Any] | None
    source_sequence = _next_marker_source_sequence(ctx, payload)
    payload["marker_source_sequence"] = source_sequence

    if action in {"set", "reset"}:
        assert minutes_from_now is not None
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
            "schema_version": coc_flag_state.TIME_MARKER_SCHEMA_VERSION,
            "marker_id": marker_id,
            "label": str(
                label
                or (existing or {}).get("label")
                or marker_id
            ),
            "status": "active",
            "revision": revision,
            "due_at": _deadline_due_at(current, minutes_from_now),
            "created_at": (existing or {}).get("created_at") or now_wall,
            "updated_at": now_wall,
            "decision_id": decision_id,
            "reason": reason,
            "source_sequence": source_sequence,
            "producer": "state.time_marker",
        }
        markers[marker_id] = marker
        projected_marker = _project_time_marker(marker, current)
    else:
        if existing is None:
            warnings.append(
                f"time marker '{marker_id}' was already absent; clear recorded a no-op"
            )
            projected_marker = None
        else:
            existing["schema_version"] = coc_flag_state.TIME_MARKER_SCHEMA_VERSION
            existing["status"] = "cleared"
            existing["revision"] = int(existing.get("revision") or 0) + 1
            existing["updated_at"] = now_wall
            existing["cleared_at"] = now_wall
            existing["decision_id"] = decision_id
            existing["reason"] = reason
            existing["source_sequence"] = source_sequence
            existing["producer"] = "state.time_marker"
            markers[marker_id] = existing
            projected_marker = _project_time_marker(existing, current)

    event = {
        "time_marker_schema_version": coc_flag_state.TIME_MARKER_SCHEMA_VERSION,
        "event_type": "time_marker_changed",
        "event_id": _operation_event_id(tool_name, decision_id),
        "action": action,
        "marker_id": marker_id,
        "decision_id": decision_id,
        "reason": reason,
        "previous_due_at": deepcopy((existing or {}).get("due_at")),
        "due_at": deepcopy((markers.get(marker_id) or {}).get("due_at")),
        "status": (markers.get(marker_id) or {}).get("status", "absent"),
        "ts": now_wall,
        "source_sequence": source_sequence,
    }
    data = {
        "action": action,
        "marker": projected_marker,
        "current_time": current,
        "active_time_markers": _project_active_time_markers(payload, current),
    }
    hints = [
        "time markers are deterministic bookkeeping only; due/overdue status does not auto-trigger rescue, scene movement, or any narrative gate"
    ]
    marker_live_record = _marker_live_record(payload, marker_id)
    entity_head = coc_flag_state.entity_head(
        entity_kind="time_marker",
        entity_id=marker_id,
        decision_id=decision_id,
        source_sequence=source_sequence,
        producer="state.time_marker",
        live_record=marker_live_record,
    )
    event["live_head_digest"] = coc_flag_state.canonical_digest(entity_head)
    payload["marker_heads"][marker_id] = deepcopy(entity_head)
    receipt = _new_source_receipt(
        tool_name=tool_name,
        decision_id=decision_id,
        operation=operation,
        event=event,
        data=data,
        warnings=warnings,
        hints=hints,
        entity_head=entity_head,
    )
    _put_source_receipt(payload, receipt)
    _save_time_markers(ctx, payload)
    _ensure_operation_event(ctx, receipt)
    ctx.ledger_record(
        decision_id,
        tool_name,
        data,
        source_receipt_manifest=_source_receipt_manifest(receipt),
    )
    return data, warnings, hints


@tool(
    "state.time_appearance",
    "Set the broad player-perceived light/time appearance without changing the "
    "authoritative elapsed or civil clock. Use for polar day/night, inverted cycles, "
    "or source-/fiction-established supernatural distortion.",
    {
        "mode": {
            "type": "string", "required": True,
            "enum": [
                "normal", "perpetual_daylight", "perpetual_darkness",
                "inverted", "distorted",
            ],
            "desc": "structured presentation mode chosen semantically by the KP",
        },
        "display_label": {
            "type": "string",
            "desc": "optional active-play-language label overriding the mode default",
        },
        "reason": {
            "type": "string", "required": True,
            "desc": "source- or fiction-established reason for the presentation change",
        },
        "source_ref": {
            "type": "string",
            "desc": "optional module/campaign evidence reference",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_time_appearance(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.time_appearance"
    prior = ctx.ledger_lookup(tool_name, args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    try:
        result = coc_time.set_time_appearance(
            ctx.campaign_dir,
            mode=str(args["mode"]),
            display_label=args.get("display_label"),
            reason=str(args["reason"]),
            source_ref=args.get("source_ref"),
            decision_id=str(args.get("decision_id") or f"toolbox-{_now_iso()}"),
        )
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    ctx.ledger_record(args.get("decision_id"), tool_name, result)
    return result, [], [
        "exact elapsed/civil time remains Keeper-only; player prose and final "
        "mechanics should use current_time.player_time",
    ]


@tool(
    "state.advance_time",
    "Advance the in-fiction clock (monotonic). Fires due triggers; an imprecise civil clock may also record a source- or fiction-established broad phase reached after the elapsed interval.",
    {
        "minutes": {"type": "integer", "required": True, "desc": "minutes to advance (>= 0)"},
        "reason": {"type": "string", "required": True, "desc": "what consumed the time"},
        "day_phase_after": {
            "type": "string",
            "enum": ["morning", "afternoon", "evening", "night"],
            "desc": "optional broad phase established after this interval for an imprecise civil clock; requires display_after",
        },
        "display_after": {
            "type": "string",
            "desc": "localized imprecise civil-time display paired with day_phase_after",
        },
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
        day_phase_after=args.get("day_phase_after"),
        display_after=args.get("display_after"),
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
    "state.clock_discontinuity",
    "Replace the in-fiction civil-calendar anchor for an explicit time shift, loop reset, dream transition, or correction while preserving monotonic elapsed time and relative deadlines.",
    {
        "discontinuity_kind": {
            "type": "string",
            "required": True,
            "enum": [
                "time_shift",
                "loop_reset",
                "dream_transition",
                "calendar_correction",
                "other",
            ],
            "desc": "structured semantic kind chosen by the KP; never inferred from prose",
        },
        "calendar_mode": {
            "type": "string",
            "required": True,
            "enum": [
                "relative",
                "gregorian",
                "julian",
                "proleptic_gregorian",
                "fictional",
            ],
            "desc": "calendar used by the target civil-time anchor",
        },
        "precision": {
            "type": "string",
            "required": True,
            "enum": ["exact", "minute", "hour", "date", "day_phase", "unknown"],
            "desc": "source-supported precision; day_phase/date avoid inventing an exact clock time",
        },
        "display": {
            "type": "string",
            "required": True,
            "desc": "faithful campaign-language rendering of the target civil time",
        },
        "local_datetime": {
            "type": "string",
            "desc": "ISO local datetime when precision is exact/minute/hour",
        },
        "local_date": {
            "type": "string",
            "desc": "ISO local date when the source establishes a date without an exact time",
        },
        "timezone": {
            "type": "string",
            "desc": "target timezone when meaningful; omission clears a stale prior timezone",
        },
        "day_phase": {
            "type": "string",
            "enum": ["morning", "afternoon", "evening", "night", "unknown"],
            "desc": "broad source-supported phase when no exact time is known",
        },
        "source_ref": {
            "type": "string",
            "desc": "optional module or campaign-canon provenance reference",
        },
        "civil_anchor_elapsed": {
            "type": "integer",
            "minimum": 0,
            "desc": "optional prior monotonic elapsed position where this civil anchor became true; use only for delayed recovery/correction from authoritative evidence",
        },
        "reason": {
            "type": "string",
            "required": True,
            "desc": "why the civil clock changed in the fiction",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
    write_domains=("time",),
)
def _tool_state_clock_discontinuity(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.clock_discontinuity"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously recorded civil-clock transition"
        ], []
    try:
        result = coc_time.record_clock_discontinuity(
            ctx.campaign_dir,
            discontinuity_kind=str(args["discontinuity_kind"]),
            calendar_mode=str(args["calendar_mode"]),
            precision=str(args["precision"]),
            display=str(args["display"]),
            decision_id=decision_id,
            reason=str(args["reason"]),
            local_datetime=args.get("local_datetime"),
            local_date=args.get("local_date"),
            timezone=args.get("timezone"),
            day_phase=args.get("day_phase"),
            source_ref=args.get("source_ref"),
            civil_anchor_elapsed=args.get("civil_anchor_elapsed"),
        )
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    result["active_time_markers"] = _active_time_markers(ctx)
    ctx.ledger_record(decision_id, tool_name, result)
    return result, [], [
        "the civil calendar changed, but elapsed_minutes and relative trigger deadlines remained monotonic",
        "render only the precision the source supports; a hidden date or era remains Keeper-only until play establishes it",
    ]


@tool(
    "state.mark_safe_rest",
    "Record that one investigator completed a full sleep in a safe place after its elapsed time was advanced. Resets the canonical rest anchor read by Director continuity; never inferred from prose.",
    {
        "investigator": {"type": "string", "desc": "investigator id (optional when party has one member)"},
        "rest_kind": {"type": "string", "required": True, "desc": "currently exactly full_sleep; a structured KP assertion, not text classification"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_mark_safe_rest(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.mark_safe_rest"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously recorded rest"
        ], []
    rest_kind = str(args.get("rest_kind") or "").strip()
    if rest_kind != "full_sleep":
        raise ToolError(
            "invalid_param",
            "rest_kind must be full_sleep; ordinary pauses do not reset the rest anchor",
        )
    investigator_id = _resolve_investigator(ctx, args)
    result = coc_time.mark_safe_rest(
        ctx.campaign_dir,
        investigator_id,
        decision_id=decision_id,
        rest_kind=rest_kind,
    )
    if result.get("at_elapsed") is None:
        raise ToolError("state_corrupt", "time state is not initialized")
    fired = coc_time.process_due_triggers(ctx.campaign_dir)
    time_state = coc_time.read_time_state(ctx.campaign_dir)
    due = coc_time.peek_due_triggers(ctx.campaign_dir)
    data = {
        **result,
        "fired_triggers": fired,
        "time_signals": coc_time.build_time_signals(time_state, due),
    }
    ctx.ledger_record(decision_id, tool_name, data)
    hints = [
        "the canonical rest anchor now drives later Director continuity; state.advance_time alone never records completed rest"
    ]
    if fired:
        hints.append(
            "safe-rest trigger(s) fired — settle and portray their authoritative outcomes"
        )
    return data, [], hints


_EXCEPTIONAL_CHANGE_KINDS = frozenset({
    "arrival", "hazard", "opening", "loss", "escalation", "reversal",
})


def _matching_active_exceptional_modifier(
    ctx: Ctx, *, investigator_id: str, skill: str, npc_id: str | None = None
) -> dict[str, Any] | None:
    try:
        document = coc_exceptional_effects.load(ctx.campaign_dir)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    active_scene_id = str(ctx.world().get("active_scene_id") or "")
    matches = []
    for effect in document["effects"].values():
        mechanics = effect.get("mechanics") or {}
        if (
            effect.get("status") == "active"
            and effect.get("effect_kind") in {"bonus_die", "penalty_die"}
            and mechanics.get("investigator_id") == investigator_id
            and str(mechanics.get("skill") or "").casefold() == skill.casefold()
            and (
                mechanics.get("target_id") is None
                or mechanics.get("target_id") == npc_id
            )
            and (
                mechanics.get("scene_id") is None
                or mechanics.get("scene_id") == active_scene_id
            )
        ):
            matches.append(effect)
    if len(matches) > 1:
        raise ToolError(
            "state_corrupt",
            "multiple active exceptional modifiers own the same actor+skill+NPC+scene scope",
        )
    return deepcopy(matches[0]) if matches else None


def _exceptional_roll_source(
    ctx: Ctx, roll_id: str
) -> dict[str, Any]:
    document = _load_roll_receipt_document(ctx)
    receipts, _ = _validated_roll_document_collection(document)
    matches = [row for row in receipts if str(row.get("roll_id")) == roll_id]
    if len(matches) == 1:
        receipt = matches[0]
        if receipt.get("tool") not in {"rules.roll", "rules.push"}:
            raise ToolError(
                "invalid_source_roll", "exceptional effects require a percentile check"
            )
        return receipt
    if matches:
        raise ToolError("state_corrupt", f"roll_id '{roll_id}' has multiple canonical sources")

    # CombatSession writes its authoritative percentile evidence directly to
    # logs/rolls.jsonl rather than the rules.roll receipt document.  These
    # rows still need to own critical/fumble effects; otherwise the finalizer
    # requires a substantive effect that state.exceptional_effect can never
    # create.
    raw_roll_log = _roll_log_bytes(ctx)
    _complete, tail, roll_index = _parse_complete_roll_frames(raw_roll_log)
    if tail:
        raise ToolError(
            "state_corrupt",
            "logs/rolls.jsonl has an incomplete tail; combat exceptional source cannot be proven",
        )
    logged_roll = roll_index.get(roll_id)
    if isinstance(logged_roll, dict):
        payload = logged_roll.get("payload")
        payload = payload if isinstance(payload, dict) else {}
        roll_role = logged_roll.get("roll_role", payload.get("roll_role"))
        source_command_id = str(
            logged_roll.get("source_command_id")
            or payload.get("source_command_id")
            or ""
        )
        if roll_role == "percentile_check" and source_command_id.startswith("combat-"):
            data = {
                key: deepcopy(value)
                for key, value in logged_roll.items()
                if key != "payload"
            }
            for key, value in payload.items():
                data.setdefault(key, deepcopy(value))
            actor_id = data.get("actor_id")
            if isinstance(actor_id, str) and actor_id in set(ctx.party_ids()):
                data.setdefault("investigator_id", actor_id)
            data.setdefault("pushed", False)
            data.setdefault("visibility", str(logged_roll.get("visibility") or "public"))
            return {
                "tool": "combat.resolve",
                "decision_id": source_command_id,
                "roll_id": roll_id,
                "roll_record": deepcopy(logged_roll),
                "data": data,
                _SOURCE_RECEIPT_INTEGRITY_KEY: coc_exceptional_effects.canonical_digest(
                    logged_roll
                ),
            }

    try:
        campaign_id = coc_npc_event_chain.resolve_campaign_id(ctx.campaign_dir)
        impressions = coc_first_impression.load_document(
            ctx.campaign_dir, campaign_id
        )
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    impression_matches = [
        receipt
        for receipt in (impressions.get("receipts") or {}).values()
        if isinstance(receipt, dict)
        and receipt.get("schema_version") == 2
        and receipt.get("roll_id") == roll_id
    ]
    if len(impression_matches) != 1:
        raise ToolError(
            "unknown_source_roll",
            "source_roll_id must name exactly one canonical percentile or schema-v2 first-impression receipt",
        )
    impression = impression_matches[0]
    _ensure_first_impression_roll(ctx, impression)
    roll_record = deepcopy(impression["roll_record"])
    return {
        "tool": "npc.reaction",
        "decision_id": impression["decision_id"],
        "roll_id": impression["roll_id"],
        "roll_record": roll_record,
        "data": {
            **{
                key: deepcopy(value)
                for key, value in roll_record.items()
                if key not in {"payload"}
            },
            "pushed": False,
            "visibility": "public",
        },
        _SOURCE_RECEIPT_INTEGRITY_KEY: impression["integrity_digest"],
    }


def _exceptional_resolution_source(
    ctx: Ctx, roll_id: str
) -> dict[str, Any]:
    """Return the authoritative final settlement for a resolution check.

    Luck spending does not create a second dice row: its canonical receipt
    supersedes the failed settlement carried by the original ``rules.roll``
    receipt.  Persistent-effect resolution therefore has to consult that
    adjustment instead of treating the immutable original roll as final.
    """
    source = _exceptional_roll_source(ctx, roll_id)
    if source["data"].get("passed") is True:
        return source

    document = _load_roll_receipt_document(ctx)
    _validated_roll_document_collection(document)
    adjustments = [
        receipt
        for receipt in document["luck_spends"].values()
        if isinstance(receipt, dict)
        and receipt.get("source_receipt", {}).get("roll_id") == roll_id
    ]
    if len(adjustments) > 1:
        raise ToolError(
            "state_corrupt",
            f"roll_id '{roll_id}' has multiple canonical Luck settlements",
        )
    if not adjustments:
        return source

    adjusted = deepcopy(source)
    adjusted["data"] = deepcopy(adjustments[0]["data"])
    adjusted["settlement_tool"] = "rules.luck_spend"
    adjusted["settlement_decision_id"] = str(adjustments[0]["decision_id"])
    return adjusted


def _successful_call_by_decision(
    ctx: Ctx, decision_id: str
) -> dict[str, Any]:
    path = ctx.campaign_dir / "logs" / "toolbox-calls.jsonl"
    rows = _read_jsonl_records(path) if path.is_file() else []
    matches = [
        row for row in rows
        if row.get("ok") is True
        and isinstance(row.get("args"), dict)
        and str(row["args"].get("decision_id") or "") == decision_id
    ]
    if len(matches) != 1:
        raise ToolError(
            "invalid_linked_effect",
            f"linked decision_id '{decision_id}' must name exactly one successful tool call",
        )
    return matches[0]


def _validated_exceptional_mechanics(
    ctx: Ctx,
    *,
    effect_kind: str,
    mechanics: Any,
    boundary: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(mechanics, dict):
        raise ToolError("invalid_param", "mechanics must be an object")
    normalized = deepcopy(mechanics)
    if effect_kind in {"bonus_die", "penalty_die"}:
        base_fields = {
            "dice", "investigator_id", "skill", "scene_id", "target_id",
        }
        allowed_field_sets = {
            frozenset(base_fields),
            frozenset({*base_fields, "target_display_name"}),
            frozenset({*base_fields, "source_decision_ids", "target_display_name"}),
        }
        if frozenset(normalized) not in allowed_field_sets:
            raise ToolError(
                "invalid_param",
                "dice-modifier mechanics require dice, investigator_id, skill, scene_id, target_id, plus optional source_decision_ids for a relationship reward",
            )
        if normalized.get("dice") not in {1, 2}:
            raise ToolError("invalid_param", "exceptional modifier dice must be 1 or 2")
        for key in ("investigator_id", "skill"):
            if not isinstance(normalized.get(key), str) or not normalized[key].strip():
                raise ToolError("invalid_param", f"mechanics.{key} must be non-empty")
            normalized[key] = normalized[key].strip()
        for key in ("scene_id", "target_id"):
            value = normalized.get(key)
            if value is not None and (not isinstance(value, str) or not value.strip()):
                raise ToolError("invalid_param", f"mechanics.{key} must be null or non-empty")
            normalized[key] = value.strip() if isinstance(value, str) else None
        target_display_name = normalized.get("target_display_name")
        if normalized["target_id"] is not None:
            if (
                not isinstance(target_display_name, str)
                or not target_display_name.strip()
                or target_display_name.strip() == normalized["target_id"]
            ):
                raise ToolError(
                    "invalid_param",
                    "an NPC-scoped modifier requires a localized player-safe target_display_name distinct from target_id",
                )
            normalized["target_display_name"] = target_display_name.strip()
        elif "target_display_name" in normalized and target_display_name is not None:
            raise ToolError(
                "invalid_param", "target_display_name must be null/absent when target_id is null"
            )
        if boundary != {"kind": "until_consumed", "uses": 1}:
            raise ToolError(
                "invalid_param", "bonus/penalty effects must use one-shot until_consumed boundary"
            )
        document = coc_exceptional_effects.load(ctx.campaign_dir)
        source_decision_ids = normalized.get("source_decision_ids")
        if source_decision_ids is not None:
            if (
                normalized["target_id"] is None
                or not isinstance(source_decision_ids, list)
                or not source_decision_ids
                or not all(
                    isinstance(value, str) and bool(value.strip())
                    for value in source_decision_ids
                )
                or len(set(source_decision_ids)) != len(source_decision_ids)
            ):
                raise ToolError(
                    "invalid_param",
                    "relationship reward source_decision_ids require a non-null target_id and unique non-empty decision ids",
                )
            normalized["source_decision_ids"] = [
                value.strip() for value in source_decision_ids
            ]
            linked_calls = [
                _successful_call_by_decision(ctx, value)
                for value in normalized["source_decision_ids"]
            ]
            if not any(
                call.get("tool") == "state.npc_update"
                and (call.get("data") or {}).get("npc_id") == normalized["target_id"]
                and (call.get("data") or {}).get("investigator_id")
                == normalized["investigator_id"]
                and bool((call.get("data") or {}).get("applied"))
                for call in linked_calls
                if isinstance(call.get("data"), dict)
            ):
                raise ToolError(
                    "invalid_linked_effect",
                    "an NPC-scoped relationship reward must link a successful state.npc_update for the same target_id",
                )
        for effect in document["effects"].values():
            if (
                effect.get("status") == "active"
                and effect.get("effect_kind") in {"bonus_die", "penalty_die"}
                and (effect.get("mechanics") or {}).get("investigator_id")
                == normalized["investigator_id"]
                and str((effect.get("mechanics") or {}).get("skill") or "").casefold()
                == normalized["skill"].casefold()
                and (effect.get("mechanics") or {}).get("target_id")
                == normalized["target_id"]
                and (effect.get("mechanics") or {}).get("scene_id")
                == normalized["scene_id"]
            ):
                raise ToolError(
                    "modifier_scope_conflict",
                    "an unconsumed exceptional modifier already owns this investigator+skill+NPC+scene scope",
                )
    elif effect_kind == "condition":
        if set(normalized) != {"target_id", "condition_id", "scene_id"}:
            raise ToolError(
                "invalid_param", "condition mechanics require target_id, condition_id, scene_id"
            )
        if boundary.get("kind") == "immediate":
            raise ToolError("invalid_param", "a condition requires a continuing boundary")
        if boundary.get("kind") == "until_consumed":
            raise ToolError("invalid_param", "only bonus/penalty effects may be consumed")
    elif effect_kind == "restriction":
        if set(normalized) != {"subject_id", "restriction_id", "scope", "scene_id"}:
            raise ToolError(
                "invalid_param", "restriction mechanics require subject_id, restriction_id, scope, scene_id"
            )
        if boundary.get("kind") == "immediate":
            raise ToolError("invalid_param", "a restriction requires a continuing boundary")
        if boundary.get("kind") == "until_consumed":
            raise ToolError("invalid_param", "only bonus/penalty effects may be consumed")
    elif effect_kind == "scene_event":
        if set(normalized) != {"scene_id", "event_id", "change_kind"}:
            raise ToolError(
                "invalid_param", "scene_event mechanics require scene_id, event_id, change_kind"
            )
        if normalized.get("change_kind") not in _EXCEPTIONAL_CHANGE_KINDS:
            raise ToolError(
                "invalid_param",
                "scene_event change_kind must be: " + ", ".join(sorted(_EXCEPTIONAL_CHANGE_KINDS)),
            )
        if boundary.get("kind") == "immediate":
            raise ToolError(
                "invalid_param",
                "scene_event must stay active to an explicit boundary so scene.context can consume it",
            )
        if boundary.get("kind") == "until_consumed":
            raise ToolError("invalid_param", "only bonus/penalty effects may be consumed")
    elif effect_kind in {"resource_delta", "relationship_or_clock"}:
        expected = (
            {"source_decision_ids"}
            if effect_kind == "resource_delta"
            else {"source_decision_ids", "affected_id", "change_summary"}
        )
        if set(normalized) != expected:
            raise ToolError(
                "invalid_param",
                f"{effect_kind} mechanics require exactly: " + ", ".join(sorted(expected)),
            )
        decision_ids = normalized.get("source_decision_ids")
        if (
            not isinstance(decision_ids, list)
            or not decision_ids
            or not all(isinstance(value, str) and value.strip() for value in decision_ids)
            or len(set(decision_ids)) != len(decision_ids)
        ):
            raise ToolError(
                "invalid_param", "source_decision_ids must be unique non-empty strings"
            )
        normalized["source_decision_ids"] = [value.strip() for value in decision_ids]
        calls = [
            _successful_call_by_decision(ctx, value)
            for value in normalized["source_decision_ids"]
        ]
        if effect_kind == "resource_delta":
            projected = coc_turn_finalization._project_state_deltas(
                calls,
                ruleset_id=_active_ruleset_id(ctx),
            )
            material = [
                row for row in projected
                if row.get("effect_kind") != "time"
                and row.get("source_decision_id") in normalized["source_decision_ids"]
            ]
            if not material:
                raise ToolError(
                    "invalid_linked_effect",
                    "resource_delta must link an authoritative non-time player state change",
                )
            if boundary != {"kind": "immediate"}:
                raise ToolError("invalid_param", "resource_delta boundary must be immediate")
        else:
            material = False
            for call in calls:
                tool_name = str(call.get("tool") or "")
                data = call.get("data") if isinstance(call.get("data"), dict) else {}
                if tool_name == "state.npc_update" and bool(data.get("applied")):
                    material = True
                elif tool_name == "state.threat_tick" and bool(data):
                    material = True
                elif tool_name == "state.time_marker" and bool(data.get("marker")):
                    material = True
                elif tool_name == "state.advance_time" and bool(data.get("fired_triggers")):
                    material = True
            if not material:
                raise ToolError(
                    "invalid_linked_effect",
                    "relationship_or_clock must link a real NPC/threat/deadline change; elapsed time or a flag name alone is insufficient",
                )
    else:
        raise ToolError("invalid_param", f"unsupported effect_kind: {effect_kind}")

    for key, value in normalized.items():
        if key.endswith("_id") and value is not None:
            if not isinstance(value, str) or not value.strip():
                raise ToolError("invalid_param", f"mechanics.{key} must be non-empty")
            normalized[key] = value.strip()
    if boundary.get("kind") == "until_scene_end":
        mechanics_scene = normalized.get("scene_id")
        if mechanics_scene != boundary.get("scene_id"):
            raise ToolError(
                "invalid_param",
                "until_scene_end requires mechanics.scene_id to match boundary.scene_id",
            )
    if (
        effect_kind == "relationship_or_clock"
        and boundary.get("kind") == "until_consumed"
    ):
        raise ToolError("invalid_param", "only bonus/penalty effects may be consumed")
    return normalized


@tool(
    "state.exceptional_effect",
    "Apply or consume one source-bound substantive consequence/reward for a critical, fumble, failed pushed check, or exceptional first-impression check. This is canonical state, not prose advice.",
    {
        "action": {"type": "string", "required": True, "desc": "apply | consume | resolve"},
        "source_roll_id": {"type": "string", "desc": "critical/fumble/pushed-failure/first-impression roll_id (apply)"},
        "effect_id": {"type": "string", "desc": "active bonus/penalty effect id (consume)"},
        "consuming_roll_id": {"type": "string", "desc": "later roll that actually used the modifier (consume)"},
        "resolution_roll_id": {"type": "string", "desc": "successful canonical check that satisfied an until_condition boundary (resolve)"},
        "resolution_event_ids": {"type": "array", "desc": "canonical event_id/decision_id evidence that satisfied a non-roll until_condition boundary (resolve)"},
        "resolution_reason": {"type": "string", "desc": "semantic reason the successful check satisfies the recorded boundary (resolve)"},
        "direction": {"type": "string", "desc": "benefit | cost (apply)"},
        "effect_kind": {"type": "string", "desc": "bonus_die | penalty_die | condition | restriction | relationship_or_clock | scene_event | resource_delta"},
        "player_visible_impact": {"type": "string", "desc": "exact concise mechanical/fictional impact rendered verbatim to the player; write it in the campaign's active play_language"},
        "causal_link": {"type": "string", "desc": "exact player-visible causal wording rendered verbatim; write it in the campaign's active play_language, not as internal audit reasoning"},
        "boundary": {"type": "object", "desc": "exactly one of {kind:immediate}; {kind:until_consumed,uses:1}; {kind:until_scene_end,scene_id}; {kind:until_time_marker,marker_id}; {kind:until_condition,description}. until_condition.description is rendered verbatim to the player and must use the campaign's active play_language"},
        "mechanics": {"type": "object", "desc": "bonus/penalty={dice,investigator_id,skill,scene_id:null|string,target_id:null|npc_id}; non-null target_id also requires localized target_display_name; NPC-scoped relationship bonus additionally requires source_decision_ids linking state.npc_update; condition={target_id,condition_id,scene_id}; restriction={subject_id,restriction_id,scope,scene_id}; scene_event={scene_id,event_id,change_kind}; resource_delta={source_decision_ids}; relationship_or_clock={source_decision_ids,affected_id,change_summary}"},
        "visibility": {"type": "string", "desc": "player_visible | concealed_observable | keeper_only"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_exceptional_effect(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.exceptional_effect"
    decision_id = str(args["decision_id"])
    action = str(args["action"]).strip()
    if action not in {"apply", "consume", "resolve"}:
        raise ToolError("invalid_param", "action must be apply, consume, or resolve")
    semantic_args = {
        key: deepcopy(value)
        for key, value in args.items()
        if key not in {"decision_id"}
    }
    fingerprint = _operation_fingerprint(tool_name, semantic_args)
    try:
        document = coc_exceptional_effects.load(ctx.campaign_dir)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    prior_operation = document["operations"].get(decision_id)
    if prior_operation is not None:
        if prior_operation.get("fingerprint") != fingerprint:
            raise ToolError(
                "idempotency_conflict",
                f"decision_id '{decision_id}' already owns a different exceptional effect operation",
            )
        data = deepcopy(prior_operation["data"])
        if ctx.ledger_lookup(tool_name, decision_id) is None:
            ctx.ledger_record(decision_id, tool_name, data)
        return data, ["duplicate decision_id: returning the immutable exceptional effect result"], []

    now = _now_iso()
    if action == "apply":
        source_roll_id = str(args.get("source_roll_id") or "").strip()
        direction = str(args.get("direction") or "").strip()
        effect_kind = str(args.get("effect_kind") or "").strip()
        visibility = str(args.get("visibility") or "player_visible").strip()
        impact = str(args.get("player_visible_impact") or "").strip()
        causal_link = str(args.get("causal_link") or "").strip()
        boundary = deepcopy(args.get("boundary"))
        if direction not in coc_exceptional_effects.DIRECTIONS:
            raise ToolError("invalid_param", "direction must be benefit or cost")
        if effect_kind not in coc_exceptional_effects.EFFECT_KINDS:
            raise ToolError("invalid_param", "unknown exceptional effect_kind")
        if visibility not in coc_exceptional_effects.VISIBILITIES:
            raise ToolError("invalid_param", "invalid exceptional effect visibility")
        if not impact or not causal_link:
            raise ToolError(
                "invalid_param", "player_visible_impact and causal_link must be non-empty"
            )
        if not coc_exceptional_effects._valid_boundary(boundary):
            raise ToolError("invalid_param", "boundary does not match the closed schema")
        source = _exceptional_roll_source(ctx, source_roll_id)
        source_data = source["data"]
        outcome = str(source_data.get("outcome") or "")
        pushed_failure = bool(source_data.get("pushed") is True and outcome == "failure")
        mechanics = _validated_exceptional_mechanics(
            ctx,
            effect_kind=effect_kind,
            mechanics=args.get("mechanics"),
            boundary=boundary,
        )
        relationship_reward = bool(
            source.get("tool") in {"rules.roll", "rules.push"}
            and source_data.get("passed") is True
            and outcome not in {"critical"}
            and direction == "benefit"
            and effect_kind == "bonus_die"
            and mechanics.get("target_id") is not None
            and mechanics.get("source_decision_ids")
        )
        expected_direction = (
            "benefit" if outcome == "critical"
            else "cost" if outcome == "fumble" or pushed_failure
            else "benefit" if relationship_reward
            else None
        )
        if expected_direction is None:
            raise ToolError(
                "invalid_source_roll",
                "only critical, fumble, failed pushed checks, or a successful NPC-scoped relationship reward with linked state.npc_update may create this effect",
            )
        if direction != expected_direction:
            raise ToolError(
                "invalid_param",
                f"{outcome}{' pushed' if pushed_failure else ''} requires direction={expected_direction}",
            )
        effect_id = coc_exceptional_effects.stable_effect_id(
            decision_id, source_roll_id
        )
        effect = {
            "schema_version": 1,
            "effect_id": effect_id,
            "source_roll": {
                "tool": source["tool"],
                "decision_id": source["decision_id"],
                "roll_id": source_roll_id,
                "integrity_digest": source[_SOURCE_RECEIPT_INTEGRITY_KEY],
                "outcome": outcome,
                "pushed": bool(source_data.get("pushed") is True),
                "visibility": str(source_data.get("visibility") or source["roll_record"].get("visibility") or "public"),
            },
            "direction": direction,
            "effect_kind": effect_kind,
            "player_visible_impact": impact,
            "causal_link": causal_link,
            "boundary": boundary,
            "mechanics": mechanics,
            "visibility": visibility,
            "status": "active" if boundary.get("kind") != "immediate" else "applied",
            "created_at": now,
            "created_decision_id": decision_id,
            "consumed_at": None,
            "consumed_decision_id": None,
            "consumed_by_roll_id": None,
            "integrity_digest": "",
        }
        effect["integrity_digest"] = coc_exceptional_effects.canonical_digest({
            key: deepcopy(value)
            for key, value in effect.items()
            if key != "integrity_digest"
        })
        if not coc_exceptional_effects.valid_effect(effect):
            raise ToolError("state_corrupt", "generated exceptional effect is invalid")
        document["effects"][effect_id] = effect
        projected = coc_exceptional_effects.project_player_effect(effect)
        data = {"action": "apply", "effect": deepcopy(effect), "player_effect": projected}
    elif action == "consume":
        effect_id = str(args.get("effect_id") or "").strip()
        consuming_roll_id = str(args.get("consuming_roll_id") or "").strip()
        effect = document["effects"].get(effect_id)
        if not isinstance(effect, dict):
            raise ToolError("unknown_effect", "effect_id is not a canonical exceptional effect")
        if effect.get("status") != "active" or effect.get("effect_kind") not in {"bonus_die", "penalty_die"}:
            raise ToolError("invalid_effect_state", "only an active bonus/penalty effect may be consumed")
        consuming = _exceptional_roll_source(ctx, consuming_roll_id)
        consuming_data = consuming["data"]
        mechanics = effect["mechanics"]
        if (
            consuming_data.get("investigator_id") != mechanics.get("investigator_id")
            or str(consuming_data.get("skill") or "").casefold()
            != str(mechanics.get("skill") or "").casefold()
        ):
            raise ToolError(
                "modifier_scope_mismatch",
                "consuming roll actor/skill does not match the declared exceptional scope",
            )
        if (
            mechanics.get("target_id") is not None
            and consuming_data.get("npc_id") != mechanics.get("target_id")
        ):
            raise ToolError(
                "modifier_scope_mismatch",
                "consuming roll NPC does not match the relationship reward target_id",
            )
        scene_id = mechanics.get("scene_id")
        if scene_id is not None and str(ctx.world().get("active_scene_id") or "") != scene_id:
            raise ToolError(
                "modifier_scope_mismatch", "consuming roll is outside the declared scene scope"
            )
        expected_key = "bonus" if effect["effect_kind"] == "bonus_die" else "penalty"
        opposite_key = "penalty" if expected_key == "bonus" else "bonus"
        if (
            consuming_data.get(expected_key) != mechanics.get("dice")
            or consuming_data.get(opposite_key) != 0
        ):
            raise ToolError(
                "modifier_not_applied",
                "the consuming roll must carry exactly the declared net bonus/penalty dice",
            )
        effect = deepcopy(effect)
        effect.update({
            "status": "consumed",
            "consumed_at": now,
            "consumed_decision_id": decision_id,
            "consumed_by_roll_id": consuming_roll_id,
            "integrity_digest": "",
        })
        effect["integrity_digest"] = coc_exceptional_effects.canonical_digest({
            key: deepcopy(value)
            for key, value in effect.items()
            if key != "integrity_digest"
        })
        document["effects"][effect_id] = effect
        data = {
            "action": "consume",
            "effect": deepcopy(effect),
            "player_effect": coc_exceptional_effects.project_player_effect(effect),
        }
    else:
        effect_id = str(args.get("effect_id") or "").strip()
        resolution_roll_id = str(args.get("resolution_roll_id") or "").strip()
        resolution_event_ids = args.get("resolution_event_ids") or []
        resolution_reason = str(args.get("resolution_reason") or "").strip()
        effect = document["effects"].get(effect_id)
        if not isinstance(effect, dict):
            raise ToolError("unknown_effect", "effect_id is not a canonical exceptional effect")
        if (
            effect.get("status") != "active"
            or effect.get("effect_kind") not in {"condition", "restriction"}
            or (effect.get("boundary") or {}).get("kind") != "until_condition"
        ):
            raise ToolError(
                "invalid_effect_state",
                "resolve requires an active condition/restriction with an until_condition boundary",
            )
        if not isinstance(resolution_event_ids, list) or any(
            not isinstance(value, str) or not value.strip()
            for value in resolution_event_ids
        ):
            raise ToolError(
                "invalid_param", "resolution_event_ids must be non-empty strings"
            )
        resolution_event_ids = [value.strip() for value in resolution_event_ids]
        if bool(resolution_roll_id) == bool(resolution_event_ids):
            raise ToolError(
                "invalid_param",
                "resolve requires exactly one of resolution_roll_id or resolution_event_ids",
            )
        if not resolution_reason:
            raise ToolError("invalid_param", "resolve requires resolution_reason")
        terminal_source_id: str | None = resolution_roll_id or None
        if resolution_roll_id:
            resolving = _exceptional_resolution_source(ctx, resolution_roll_id)
            if resolving["data"].get("passed") is not True:
                raise ToolError(
                    "resolution_not_proven",
                    "resolution_roll_id must name a successful canonical check",
                )
        else:
            event_rows: list[dict[str, Any]] = []
            events_path = ctx.campaign_dir / "logs" / "events.jsonl"
            if events_path.is_file():
                for line in events_path.read_text(encoding="utf-8").splitlines():
                    try:
                        row = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(row, dict):
                        event_rows.append(row)
            missing = [
                evidence_id for evidence_id in resolution_event_ids
                if not any(
                    evidence_id in {row.get("event_id"), row.get("decision_id")}
                    for row in event_rows
                )
            ]
            if missing:
                raise ToolError(
                    "resolution_not_proven",
                    "resolution_event_ids are not canonical campaign events: "
                    + ", ".join(missing),
                )
        effect = deepcopy(effect)
        effect.update({
            "status": "resolved",
            "consumed_at": now,
            "consumed_decision_id": decision_id,
            "consumed_by_roll_id": terminal_source_id,
            "integrity_digest": "",
        })
        effect["integrity_digest"] = coc_exceptional_effects.canonical_digest({
            key: deepcopy(value)
            for key, value in effect.items()
            if key != "integrity_digest"
        })
        document["effects"][effect_id] = effect
        data = {
            "action": "resolve",
            "effect": deepcopy(effect),
            "player_effect": coc_exceptional_effects.project_player_effect(effect),
        }

    document["operations"][decision_id] = {
        "decision_id": decision_id,
        "action": action,
        "fingerprint": fingerprint,
        "effect_id": effect_id,
        "data": deepcopy(data),
    }
    if not coc_exceptional_effects.valid_document(document):
        raise ToolError("state_corrupt", "generated exceptional effect document is invalid")
    coc_state.write_json_atomic(
        ctx.campaign_dir / "save" / coc_exceptional_effects.FILENAME,
        document,
    )
    ctx.log_event({
        "event_type": "exceptional_effect_" + action,
        "effect_id": effect_id,
        "decision_id": decision_id,
        "effect_kind": effect["effect_kind"],
        "direction": effect["direction"],
        "status": effect["status"],
    })
    ctx.ledger_record(decision_id, tool_name, data)
    return data, [], [
        "this effect is canonical state; realize its causal link in fiction and let turn.finalize render the player-visible impact",
        "player_visible_impact, causal_link, and any until_condition boundary.description are rendered verbatim in the mechanics block; keep all of them in the campaign's active play_language",
    ]


_TABLE_TRANSCRIPT_RELATIVE = Path("logs") / "table-transcript.jsonl"
_UNDELIVERED_OUTPUT_REPAIR_RELATIVE = (
    Path("logs") / "undelivered-output-repairs.jsonl"
)


def _table_transcript_rows(ctx: Ctx) -> list[dict[str, Any]]:
    path = ctx.campaign_dir / _TABLE_TRANSCRIPT_RELATIVE
    return _read_jsonl_records(path) if path.is_file() else []


def _table_transcript_entry_id(role: str, source_id: str) -> str:
    payload = json.dumps(
        ["table-transcript-v1", role, source_id],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"table-transcript-v1:{hashlib.sha256(payload).hexdigest()[:40]}"


def _record_table_transcript_entry(
    ctx: Ctx,
    *,
    role: str,
    text: str,
    run_id: str,
    turn_number: int,
    turn_id: str,
    journal_decision_id: str,
    source_id: str,
    speaker: str,
    finalization_id: str | None = None,
    presented_roll_ids: list[str] | None = None,
) -> dict[str, Any]:
    clean_text = str(text)
    if not clean_text.strip():
        raise ToolError("invalid_param", "table transcript text must be non-empty")
    entry_id = _table_transcript_entry_id(role, source_id)
    stable = {
        "schema_version": 1,
        "entry_id": entry_id,
        "run_id": run_id,
        "turn": int(turn_number),
        "turn_id": turn_id,
        "journal_decision_id": journal_decision_id,
        "role": role,
        "speaker": speaker,
        "text": clean_text,
        "text_sha256": _canonical_digest(clean_text),
        "source_id": source_id,
        "source_ref": (
            f"logs/turn-finalizations.jsonl#{finalization_id}"
            if finalization_id
            else f"table.opening#{source_id}"
            if role == "keeper"
            else f"state.journal#{journal_decision_id}"
        ),
        "finalization_id": finalization_id,
    }
    if presented_roll_ids is not None:
        stable["presented_roll_ids"] = list(presented_roll_ids)
    matches = [
        row for row in _table_transcript_rows(ctx)
        if row.get("entry_id") == entry_id
    ]
    if len(matches) > 1:
        raise ToolError("state_corrupt", f"duplicate table transcript entry '{entry_id}'")
    if matches:
        prior = matches[0]
        comparable = {key: prior.get(key) for key in stable}
        if comparable != stable:
            raise ToolError(
                "idempotency_conflict",
                f"table transcript entry '{entry_id}' already owns different text",
            )
        return deepcopy(prior)
    entry = {**stable, "ts": _now_iso()}
    coc_state.append_jsonl(ctx.campaign_dir / _TABLE_TRANSCRIPT_RELATIVE, entry)
    return entry


def _opening_first_impression_lines(
    ctx: Ctx,
    *,
    run_id: str,
    presented_roll_ids: Any,
) -> tuple[list[str], list[str]]:
    if not isinstance(presented_roll_ids, list):
        raise ToolError("invalid_param", "presented_roll_ids must be an ordered list")
    roll_ids = list(presented_roll_ids)
    if any(
        not isinstance(value, str) or not value or value != value.strip()
        for value in roll_ids
    ):
        raise ToolError(
            "invalid_param", "presented_roll_ids must contain non-empty roll_id strings"
        )
    if len(set(roll_ids)) != len(roll_ids):
        raise ToolError("invalid_param", "presented_roll_ids must not contain duplicates")
    campaign_id = coc_npc_event_chain.resolve_campaign_id(ctx.campaign_dir)
    try:
        document = coc_first_impression.load_document(ctx.campaign_dir, campaign_id)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    receipts_by_roll_id = {
        str(receipt.get("roll_id")): receipt
        for receipt in document.get("receipts", {}).values()
        if isinstance(receipt, dict) and receipt.get("schema_version") == 2
    }
    rendered: list[str] = []
    for roll_id in roll_ids:
        receipt = receipts_by_roll_id.get(roll_id)
        if receipt is None:
            raise ToolError(
                "invalid_param",
                f"presented roll_id '{roll_id}' is not a current public NPC first impression",
            )
        record = receipt.get("roll_record")
        if (
            receipt.get("campaign_id") != campaign_id
            or receipt.get("run_id") != run_id
            or not isinstance(record, dict)
            or record.get("roll_id") != roll_id
            or record.get("kind") != "npc_first_impression"
            or record.get("visibility") != "public"
        ):
            raise ToolError(
                "invalid_param",
                f"presented roll_id '{roll_id}' does not belong to this campaign opening run",
            )
        _ensure_first_impression_roll(ctx, receipt)
        rendered.append(
            coc_turn_finalization._render_public_roll(
                record,
                play_language=_campaign_play_language(ctx),
            )
        )
    return roll_ids, rendered


def _opening_text_with_public_rolls(text: str, rendered_lines: list[str]) -> str:
    if not rendered_lines:
        return text
    mechanics_block = "[roll]\n" + "\n".join(rendered_lines) + "\n[/roll]"
    closing_marker = "[/in_game]"
    marker_index = text.rfind(closing_marker)
    if marker_index < 0:
        return text.rstrip() + "\n\n" + mechanics_block
    before = text[:marker_index].rstrip()
    after = text[marker_index:]
    prefix = before + "\n\n" if before else ""
    return prefix + mechanics_block + "\n" + after


@tool(
    "evidence.table_opening",
    "Record the exact player-visible Keeper opening before the first player message, canonical-render its explicitly bound public first-impression rolls, and close the pre-turn setup/opening source prefix.",
    {
        "text": {"type": "string", "required": True, "desc": "Keeper-authored opening narrative; deterministic first-impression lines are inserted by the tool before a final [/in_game] marker when present, otherwise appended"},
        "run_id": {"type": "string", "required": True, "desc": "current play/report segment id"},
        "presented_roll_ids": {
            "type": "array",
            "required": True,
            "items": {"type": "string"},
            "uniqueItems": True,
            "desc": "ordered public npc_first_impression roll_ids from this campaign/run; [] is valid",
        },
        "speaker": {"type": "string", "desc": "player-facing Keeper speaker label"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)
def _tool_evidence_table_opening(ctx: Ctx, args: dict[str, Any]):
    raw_decision_id = str(args.get("decision_id") or "")
    decision_id = raw_decision_id.strip()
    if not decision_id or decision_id != raw_decision_id:
        raise ToolError("invalid_param", "evidence.table_opening requires a stable decision_id")
    raw_run_id = str(args.get("run_id") or "")
    run_id = raw_run_id.strip()
    if not run_id or run_id != raw_run_id:
        raise ToolError("invalid_param", "evidence.table_opening requires a stable run_id")
    presented_roll_ids, rendered_lines = _opening_first_impression_lines(
        ctx,
        run_id=run_id,
        presented_roll_ids=args.get("presented_roll_ids"),
    )
    exact_text = _opening_text_with_public_rolls(
        str(args.get("text") or ""), rendered_lines
    )
    prior = ctx.ledger_lookup("evidence.table_opening", decision_id)
    if prior is not None:
        entry = _record_table_transcript_entry(
            ctx,
            role="keeper",
            text=exact_text,
            run_id=run_id,
            turn_number=0,
            turn_id=f"opening:{run_id}",
            journal_decision_id="",
            source_id=decision_id,
            speaker=str(args.get("speaker") or "KP"),
            presented_roll_ids=presented_roll_ids,
        )
        return entry, ["duplicate decision_id: returning the immutable opening transcript row"], []
    if _table_transcript_rows(ctx):
        raise ToolError(
            "opening_already_started",
            "the table transcript already contains dialogue; an opening cannot be inserted later",
        )
    entry = _record_table_transcript_entry(
        ctx,
        role="keeper",
        text=exact_text,
        run_id=run_id,
        turn_number=0,
        turn_id=f"opening:{run_id}",
        journal_decision_id="",
        source_id=decision_id,
        speaker=str(args.get("speaker") or "KP"),
        presented_roll_ids=presented_roll_ids,
    )
    ctx.ledger_record(decision_id, "evidence.table_opening", entry)
    return entry, [], [
        "deliver data.text exactly; its deterministic public first-impression block is canonical and must not be recomputed, rewritten, or duplicated"
    ]


def _record_finalized_keeper_text(ctx: Ctx, receipt: dict[str, Any]) -> dict[str, Any]:
    journal_decision_id = str(receipt.get("journal_decision_id") or "")
    player_rows = [
        row for row in _table_transcript_rows(ctx)
        if row.get("role") == "player"
        and row.get("journal_decision_id") == journal_decision_id
    ]
    if len(player_rows) > 1:
        raise ToolError(
            "state_corrupt",
            f"journal '{journal_decision_id}' has multiple exact player transcript rows",
        )
    player_row = player_rows[0] if player_rows else {}
    run_id = str(player_row.get("run_id") or coc_npc_event_chain.resolve_run_id(ctx.campaign_dir))
    turn_number = player_row.get("turn")
    if isinstance(turn_number, bool) or not isinstance(turn_number, int):
        turn_number = int(ctx.pacing().get("turn_number") or 0)
    turn_id = str(player_row.get("turn_id") or f"journal:{journal_decision_id}")
    finalization_id = str(receipt.get("finalization_id") or "")
    return _record_table_transcript_entry(
        ctx,
        role="keeper",
        text=str(receipt.get("rendered_text") or ""),
        run_id=run_id,
        turn_number=turn_number,
        turn_id=turn_id,
        journal_decision_id=journal_decision_id,
        source_id=finalization_id,
        speaker="KP",
        finalization_id=finalization_id,
    )


def _replace_undelivered_finalization_artifacts(
    ctx: Ctx,
    *,
    source_receipt: dict[str, Any],
    replacement_receipt: dict[str, Any],
) -> dict[str, Any]:
    """Atomically swap the unpublished canonical tail and retain an audit copy."""
    finalization_path = (
        ctx.campaign_dir
        / "logs"
        / coc_turn_finalization.FINALIZATION_FILENAME
    )
    transcript_path = ctx.campaign_dir / _TABLE_TRANSCRIPT_RELATIVE
    try:
        original_finalization_text = finalization_path.read_text(encoding="utf-8")
        original_transcript_text = transcript_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise ToolError(
            "state_corrupt", "cannot read finalized output artifacts for repair"
        ) from exc

    finalizations = coc_turn_finalization.load_finalizations(ctx.campaign_dir)
    if not finalizations or finalizations[-1] != source_receipt:
        raise ToolError(
            "repair_conflict", "repair source is not the latest finalization"
        )
    transcript_rows = _table_transcript_rows(ctx)
    matches = [
        index
        for index, row in enumerate(transcript_rows)
        if row.get("role") == "keeper"
        and row.get("journal_decision_id")
        == source_receipt["journal_decision_id"]
        and row.get("finalization_id") == source_receipt["finalization_id"]
    ]
    if len(matches) != 1:
        raise ToolError(
            "state_corrupt",
            "undelivered finalization does not have exactly one Keeper transcript row",
        )
    transcript_index = matches[0]
    original_transcript_row = deepcopy(transcript_rows[transcript_index])
    replacement_id = str(replacement_receipt["finalization_id"])
    replacement_text = str(replacement_receipt["rendered_text"])
    replacement_transcript_row = {
        **original_transcript_row,
        "entry_id": _table_transcript_entry_id("keeper", replacement_id),
        "text": replacement_text,
        "text_sha256": str(replacement_receipt["rendered_sha256"]),
        "source_id": replacement_id,
        "source_ref": f"logs/turn-finalizations.jsonl#{replacement_id}",
        "finalization_id": replacement_id,
        "ts": _now_iso(),
    }
    finalizations[-1] = deepcopy(replacement_receipt)
    transcript_rows[transcript_index] = replacement_transcript_row
    repaired_finalization_text = "".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n"
        for row in finalizations
    )
    repaired_transcript_text = "".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n"
        for row in transcript_rows
    )
    repair_audit = {
        "schema_version": 1,
        "kind": "coc_undelivered_output_repair",
        "repair_id": (
            "undelivered-output-repair-v1:"
            + hashlib.sha256(
                json.dumps(
                    [
                        source_receipt["finalization_id"],
                        replacement_id,
                        replacement_receipt["decision_id"],
                    ],
                    ensure_ascii=False,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest()[:40]
        ),
        "campaign_id": ctx.campaign_id,
        "journal_decision_id": source_receipt["journal_decision_id"],
        "source_finalization": deepcopy(source_receipt),
        "source_transcript_row": original_transcript_row,
        "replacement_finalization_id": replacement_id,
        "replacement_rendered_sha256": replacement_receipt["rendered_sha256"],
        "decision_id": replacement_receipt["decision_id"],
        "created_at": _now_iso(),
    }
    audit_path = ctx.campaign_dir / _UNDELIVERED_OUTPUT_REPAIR_RELATIVE
    try:
        coc_fileio.write_text_atomic(
            finalization_path, repaired_finalization_text
        )
        coc_fileio.write_text_atomic(transcript_path, repaired_transcript_text)
        coc_state.append_jsonl(audit_path, repair_audit)
    except Exception as exc:
        coc_fileio.write_text_atomic(
            finalization_path, original_finalization_text
        )
        coc_fileio.write_text_atomic(transcript_path, original_transcript_text)
        raise ToolError(
            "repair_failed", "undelivered output repair did not commit atomically"
        ) from exc
    return {
        "repair": repair_audit,
        "transcript": replacement_transcript_row,
    }


@tool(
    "state.journal",
    "Close out a narrated turn: bump the turn counter, optionally set tension, and write player-safe receipts.",
    {
        "summary": {"type": "string", "required": True, "desc": "player-safe summary of what just happened"},
        "player_action": {"type": "string", "desc": "what the player did (verbatim or condensed)"},
        "player_text": {"type": "string", "desc": "exact byte-for-byte player message for the readable transcript"},
        "player_speaker": {"type": "string", "desc": "player-facing speaker name"},
        "run_id": {"type": "string", "desc": "current play/report segment id"},
        "intent_class": {"type": "string", "desc": "your read of the intent (investigate/social/move/stuck/meta/...)"},
        "tension": {"type": "string", "desc": "set tension level: low | medium | high | climax"},
        "continuation": {
            "type": "object",
            "desc": "optional KP-authored semantic delta for recovery after compaction; record only meaning that changed this turn",
            "properties": {
                "unresolved_intent": {"type": "string"},
                "clear_unresolved_intent": {"type": "boolean"},
                "open_threads": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "thread_id": {"type": "string"},
                            "summary": {"type": "string"},
                            "reason": {"type": "string"},
                            "status": {
                                "type": "string",
                                "enum": ["active", "deferred", "resolved", "archived"],
                            },
                        },
                        "required": ["thread_id", "summary", "reason", "status"],
                        "additionalProperties": False,
                    },
                },
                "confirmed_decisions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "decision_id": {"type": "string"},
                            "summary": {"type": "string"},
                            "reason": {"type": "string"},
                        },
                        "required": ["decision_id", "summary", "reason"],
                        "additionalProperties": False,
                    },
                },
                "do_not_repeat": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "item_id": {"type": "string"},
                            "instruction": {"type": "string"},
                            "reason": {"type": "string"},
                        },
                        "required": ["item_id", "instruction", "reason"],
                        "additionalProperties": False,
                    },
                },
                "style_commitments": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "additionalProperties": False,
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)
def _tool_state_journal(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.journal", args.get("decision_id"))
    if prior is not None:
        prior_data = prior.get("data") or {}
        try:
            replay_delta = coc_continuation.normalize_semantic_delta(
                args.get("continuation"),
                turn_number=int(prior_data.get("turn_number") or 0),
            )
        except coc_continuation.ContinuationError as exc:
            raise ToolError(exc.code, str(exc)) from exc
        if replay_delta != (prior_data.get("continuation_delta") or {}):
            raise ToolError(
                "idempotency_conflict",
                "state.journal decision_id already owns a different continuation delta",
            )
        player_text = args.get("player_text")
        if isinstance(player_text, str) and player_text.strip():
            run_id = coc_npc_event_chain.resolve_run_id(
                ctx.campaign_dir,
                structured_source={"run_id": args.get("run_id")},
            )
            _record_table_transcript_entry(
                ctx,
                role="player",
                text=player_text,
                run_id=run_id,
                turn_number=int(prior_data.get("turn_number") or 0),
                turn_id=str(prior_data.get("turn_id") or ""),
                journal_decision_id=str(args.get("decision_id") or ""),
                source_id=str(args.get("decision_id") or ""),
                speaker=str(args.get("player_speaker") or "Player"),
            )
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    decision_id = str(args.get("decision_id") or "").strip()
    if not decision_id:
        raise ToolError("invalid_param", "state.journal requires a stable decision_id")
    try:
        pending = coc_turn_manifest.pending_manifest(ctx.campaign_dir)
        coc_turn_manifest.load_or_create_cursor(ctx.campaign_dir)
    except coc_turn_manifest.TurnManifestError as exc:
        raise ToolError(exc.code, str(exc)) from exc
    if pending is not None and pending["journal_decision_id"] != decision_id:
        raise ToolError(
            "turn_finalization_pending",
            "the previous journaled turn must be finalized or repaired before another turn can close",
        )
    pacing = ctx.pacing()
    next_turn_number = int(pacing.get("turn_number") or 0) + 1
    try:
        continuation_delta = coc_continuation.normalize_semantic_delta(
            args.get("continuation"), turn_number=next_turn_number
        )
    except coc_continuation.ContinuationError as exc:
        raise ToolError(exc.code, str(exc)) from exc
    pacing["turn_number"] = next_turn_number
    warnings: list[str] = []
    player_text = args.get("player_text")
    if isinstance(player_text, str) and player_text.strip():
        try:
            delivery_ack = coc_continuation.acknowledge_latest_from_player_response(
                ctx.campaign_dir,
                player_text=player_text,
                source_journal_decision_id=decision_id,
            )
        except coc_continuation.ContinuationError as exc:
            raise ToolError(exc.code, str(exc)) from exc
        if delivery_ack is not None:
            warnings.append(
                "the player's exact reply confirmed delivery of the previous finalized Keeper output"
            )
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
            "continuation_delta": continuation_delta,
        },
    )
    try:
        manifest = coc_turn_manifest.start_pending_turn(
            ctx.campaign_dir,
            journal_decision_id=decision_id,
            turn_number=pacing["turn_number"],
        )
    except coc_turn_manifest.TurnManifestError as exc:
        raise ToolError(exc.code, str(exc)) from exc
    data = {
        "turn_number": pacing["turn_number"],
        "tension_level": pacing.get("tension_level"),
        "turn_id": manifest["turn_id"],
        "continuation_delta": continuation_delta,
    }
    if isinstance(player_text, str) and player_text.strip():
        run_id = coc_npc_event_chain.resolve_run_id(
            ctx.campaign_dir,
            structured_source={"run_id": args.get("run_id")},
        )
        _record_table_transcript_entry(
            ctx,
            role="player",
            text=player_text,
            run_id=run_id,
            turn_number=pacing["turn_number"],
            turn_id=manifest["turn_id"],
            journal_decision_id=decision_id,
            source_id=decision_id,
            speaker=str(args.get("player_speaker") or "Player"),
        )
    else:
        warnings.append(
            "exact player_text was not recorded; readable transcript completeness will fail"
        )
    ctx.ledger_record(decision_id, "state.journal", data)
    return data, warnings, []


def _latest_narrative_opportunity(
    current_window: dict[str, Any],
) -> dict[str, Any] | None:
    for row in reversed(current_window.get("rows") or []):
        if not isinstance(row, dict) or row.get("tool") != "actions.advise":
            continue
        data = row.get("data")
        if isinstance(data, dict) and isinstance(
            data.get("narrative_opportunity"), dict
        ):
            return deepcopy(data["narrative_opportunity"])
    return None


def _normalize_finalized_advisory_uptake(
    ctx: Ctx,
    raw: Any,
    *,
    draft: Any,
) -> dict[str, Any] | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ToolError("invalid_param", "advisory_uptake must be an object")
    common = {
        "advice_id", "disposition", "reason", "adopted_fields",
        "exact_excerpt",
    }
    candidate_fields = {"candidate_ref", "storylet_candidate"}
    if not common.issubset(raw) or not set(raw).issubset(common | candidate_fields):
        raise ToolError(
            "invalid_param", "advisory_uptake must use the exact closed schema"
        )
    present_candidate_fields = [
        field for field in candidate_fields if raw.get(field) is not None
    ]
    if len(present_candidate_fields) != 1:
        raise ToolError(
            "invalid_param",
            "advisory_uptake requires exactly one of candidate_ref or legacy storylet_candidate",
        )
    disposition = str(raw.get("disposition") or "").strip()
    if disposition not in {"adopted", "modified"}:
        raise ToolError(
            "invalid_param",
            "turn.finalize advisory_uptake records only adopted or modified candidates; ignored advice stays optional evidence.record_adoption",
        )
    candidate_ref = str(raw.get("candidate_ref") or "").strip()
    if candidate_ref:
        candidate = _resolve_storylet_candidate_ref(
            ctx,
            advice_id=raw.get("advice_id"),
            candidate_ref=candidate_ref,
        )
    else:
        candidate = raw.get("storylet_candidate")
        if not isinstance(candidate, dict) or not str(
            candidate.get("storylet_id") or ""
        ).strip():
            raise ToolError(
                "invalid_param", "advisory_uptake requires the exact Storylet candidate"
            )
        candidate_ref = _storylet_candidate_ref(raw.get("advice_id"), candidate)
    if not _storylet_advice_matches_candidate(raw.get("advice_id"), candidate):
        raise ToolError(
            "invalid_param", "advisory_uptake advice_id does not bind this candidate"
        )
    reason = str(raw.get("reason") or "").strip()
    fields = raw.get("adopted_fields")
    excerpt = str(raw.get("exact_excerpt") or "").strip()
    if not reason:
        raise ToolError("invalid_param", "advisory_uptake.reason is required")
    if (
        not isinstance(fields, list) or not fields
        or any(not isinstance(value, str) or not value.strip() for value in fields)
    ):
        raise ToolError(
            "invalid_param", "advisory_uptake.adopted_fields must be non-empty strings"
        )
    if not isinstance(draft, str) or not excerpt or excerpt not in draft:
        raise ToolError(
            "excerpt_mismatch",
            "advisory_uptake.exact_excerpt must occur verbatim in the finalized draft",
        )
    return {
        "advice_id": str(raw["advice_id"]),
        "disposition": disposition,
        "reason": reason,
        "adopted_fields": [str(value).strip() for value in fields],
        "candidate_ref": candidate_ref,
        "storylet_candidate": deepcopy(candidate),
        "exact_excerpt": excerpt,
    }


def _record_finalized_advisory_uptake(
    ctx: Ctx,
    *,
    uptake: dict[str, Any] | None,
    finalization: dict[str, Any],
) -> tuple[list[str], list[str]]:
    if uptake is None:
        return [], []
    _data, warnings, hints = _tool_evidence_record_adoption(ctx, {
        "decision_id": str(finalization["decision_id"]) + ":storylet-uptake",
        "advice_id": uptake["advice_id"],
        "disposition": uptake["disposition"],
        "reason": uptake["reason"],
        "adopted_fields": uptake["adopted_fields"],
        "candidate_ref": uptake["candidate_ref"],
        "finalization_id": finalization["finalization_id"],
        "exact_excerpt": uptake["exact_excerpt"],
    })
    return warnings, hints


@tool(
    "turn.output_context",
    "Read the latest unfinalized journal's causal obligations, Keeper-only NPC performance constraints, source-bound exceptional-effect status, and deterministic player-mechanics bundle. Call only after all settlement and state.journal.",
    {},
    access="query",
)
def _tool_turn_output_context(ctx: Ctx, args: dict[str, Any]):
    try:
        data = coc_turn_finalization.build_output_context(ctx.campaign_dir)
    except coc_turn_finalization.TurnContractError as exc:
        raise ToolError(exc.code, str(exc)) from exc
    current_window = coc_turn_manifest.resume_window(
        ctx.campaign_dir,
        meaningful_tools=_turn_recovery_meaningful_tools(),
    )
    data["narrative_opportunity"] = _latest_narrative_opportunity(
        current_window
    )
    return data, [], [
        "draft fiction from obligations; related sources may share an exact_excerpt, but every obligation_id needs exactly one coverage row",
        "npc_performance_constraints are Keeper-only: portray observable_manner naturally, but never print causal_explanation, opportunity_or_friction, or boundary_preserved as a player-facing analysis block",
        "missing_substantive_effects and pending_modifier_consumptions are hard blockers proving settlement was incomplete; never disguise them in prose",
        "split the draft into causal paragraphs and normally omit mechanics_placements: the finalizer inserts each public roll before its coverage result paragraph and groups later changes exactly once; provide explicit placements only when deliberate interleaving improves the scene",
        "mechanics_bundle text and arithmetic are deterministic; do not copy, recompute, or paraphrase their numbers in fictional paragraphs",
        "if narrative_opportunity actually shaped the draft, pass advisory_uptake with an exact draft excerpt to turn.finalize; only then is the Storylet ledger updated",
    ]


@tool(
    "turn.finalize",
    "Hard final boundary for one journaled turn. Validates exact causal coverage and paragraph-level mechanic placement, inserts authoritative dice/changes/context at those causal boundaries, persists hashes, and returns rendered_text that direct hosts must echo verbatim.",
    {
        "draft": {
            "type": "string",
            "required": True,
            "desc": "exact player-facing fictional prose, without deterministic dice/change blocks",
        },
        "coverage": {
            "type": "array",
            "required": True,
            "desc": "one closed semantic coverage row per obligation from turn.output_context",
            "items": {
                "type": "object",
                "properties": {
                    **{
                        field: {"type": ["string", "null"]}
                        for field in sorted(
                            coc_turn_finalization.COVERAGE_FIELDS
                            - {
                                "obligation_id",
                                "realization",
                                "player_input_handling",
                            }
                        )
                    },
                    "obligation_id": {"type": "string", "minLength": 1},
                    "realization": {
                        "type": "string",
                        "enum": sorted(coc_turn_finalization.REALIZATION_VALUES),
                    },
                    "player_input_handling": {
                        "type": "string",
                        "enum": sorted(
                            coc_turn_finalization.PLAYER_INPUT_HANDLING_VALUES
                        ),
                    },
                },
                "required": sorted(coc_turn_finalization.COVERAGE_FIELDS),
                "additionalProperties": False,
            },
        },
        "mechanics_placements": {
            "type": "array",
            "desc": "optional override rows {after_paragraph (zero-based), segment_type, source_ids}; omit for safe causal defaults, or supply every source exactly once when deliberate interleaving is needed",
            "items": {
                "type": "object",
                "properties": {
                    "after_paragraph": {"type": "integer", "minimum": 0},
                    "segment_type": {
                        "type": "string",
                        "enum": sorted(
                            coc_turn_finalization.MECHANIC_SEGMENT_TYPES
                        ),
                    },
                    "source_ids": {
                        "type": "array",
                        "items": {"type": "string", "minLength": 1},
                        "minItems": 1,
                        "uniqueItems": True,
                    },
                },
                "required": sorted(
                    coc_turn_finalization.MECHANICS_PLACEMENT_FIELDS
                ),
                "additionalProperties": False,
            },
        },
        "decision_id": {
            "type": "string", "required": True, "desc": "idempotency key",
        },
        "repair_finalization_id": {
            "type": "string",
            "desc": "optional latest finalization id; permits a prose/placement-only replacement only while that exact output remains delivery-unconfirmed",
        },
        "validate_only": {
            "type": "boolean",
            "desc": "optional preflight: run the full finalize validation and return every violation at once (error.violations) without writing any receipt",
        },
        "advisory_uptake": {
            "type": "object",
            "desc": "optional proof that one actions.advise Storylet candidate actually shaped this finalized draft; use candidate_ref, while storylet_candidate remains a legacy compatibility input",
            "properties": {
                "advice_id": {"type": "string", "minLength": 1},
                "disposition": {
                    "type": "string", "enum": ["adopted", "modified"],
                },
                "reason": {"type": "string", "minLength": 1},
                "adopted_fields": {
                    "type": "array",
                    "items": {"type": "string", "minLength": 1},
                    "minItems": 1,
                },
                "candidate_ref": {"type": "string", "minLength": 1},
                "storylet_candidate": {"type": "object"},
                "exact_excerpt": {"type": "string", "minLength": 1},
            },
            "required_fields": [
                "advice_id", "disposition", "reason", "adopted_fields",
                "exact_excerpt",
            ],
            "additionalProperties": False,
        },
    },
)
def _tool_turn_finalize(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    uptake = _normalize_finalized_advisory_uptake(
        ctx,
        args.get("advisory_uptake"), draft=args.get("draft")
    )

    def record_uptake(
        finalization: dict[str, Any],
    ) -> tuple[list[str], list[str]]:
        try:
            return _record_finalized_advisory_uptake(
                ctx, uptake=uptake, finalization=finalization
            )
        except (OSError, ValueError, ToolError) as exc:
            return [
                "finalized Storylet uptake evidence was not persisted; replay "
                f"this exact turn.finalize call to recover it: {exc}"
            ], []

    existing = coc_turn_finalization.finalization_by_decision(
        ctx.campaign_dir, decision_id
    )
    if existing is not None:
        if not coc_turn_finalization.replay_matches(
            existing,
            draft=args.get("draft"),
            coverage=args.get("coverage"),
            mechanics_placements=args.get("mechanics_placements"),
        ):
            raise ToolError(
                "idempotency_conflict",
                f"decision_id '{decision_id}' already finalized different draft or coverage",
            )
        _record_finalized_keeper_text(ctx, existing)
        uptake_warnings, uptake_hints = record_uptake(existing)
        return deepcopy(existing), [
            "duplicate decision_id: returning the immutable final turn output",
            *uptake_warnings,
        ], [
            "echo rendered_text exactly; do not prepend, append, or rewrite it",
            *uptake_hints,
        ]
    if args.get("validate_only"):
        violations = coc_turn_finalization.collect_finalize_violations(
            ctx.campaign_dir,
            draft=args.get("draft"),
            coverage=args.get("coverage"),
            mechanics_placements=args.get("mechanics_placements"),
        )
        if violations:
            first = violations[0]
            raise ToolError(first["code"], first["message"], violations=violations)
        return (
            {"would_finalize": True, "violations": []},
            [],
            [
                "validate_only preflight: no receipt was written; call "
                "turn.finalize without validate_only to commit this exact payload",
            ],
        )
    repair_finalization_id = str(
        args.get("repair_finalization_id") or ""
    ).strip()
    if repair_finalization_id:
        finalizations = coc_turn_finalization.load_finalizations(
            ctx.campaign_dir
        )
        if (
            not finalizations
            or finalizations[-1].get("finalization_id")
            != repair_finalization_id
        ):
            raise ToolError(
                "repair_conflict",
                "repair_finalization_id must name the latest canonical output",
            )
        checkpoint, checkpoint_warnings = (
            coc_continuation.ensure_latest_checkpoint(ctx.campaign_dir)
        )
        if checkpoint is None:
            raise ToolError(
                "state_corrupt", "latest finalized output has no recovery checkpoint"
            )
        delivery = coc_continuation.delivery_projection(
            ctx.campaign_dir, checkpoint
        )
        if (
            delivery.get("finalization_id") != repair_finalization_id
            or delivery.get("status") != "unconfirmed"
        ):
            raise ToolError(
                "delivery_conflict",
                "only the latest delivery-unconfirmed output may receive a narration repair",
            )
        try:
            receipt = coc_turn_finalization.build_undelivered_repair_receipt(
                ctx.campaign_dir,
                source_receipt=finalizations[-1],
                decision_id=decision_id,
                draft=args.get("draft"),
                coverage=args.get("coverage"),
                mechanics_placements=args.get("mechanics_placements"),
            )
        except coc_turn_finalization.TurnContractError as exc:
            raise ToolError(exc.code, str(exc), violations=exc.violations) from exc
        replacement = _replace_undelivered_finalization_artifacts(
            ctx,
            source_receipt=finalizations[-1],
            replacement_receipt=receipt,
        )
        uptake_warnings, uptake_hints = record_uptake(receipt)
        return receipt, [*checkpoint_warnings, *uptake_warnings], [
            "undelivered narration repaired without rerunning rules, state, or the journal",
            f"repair audit: logs/undelivered-output-repairs.jsonl#{replacement['repair']['repair_id']}",
            "echo rendered_text exactly; direct-host output is contract-invalid if any text or number is changed",
            *uptake_hints,
        ]
    try:
        receipt = coc_turn_finalization.build_finalization_receipt(
            ctx.campaign_dir,
            decision_id=decision_id,
            draft=args.get("draft"),
            coverage=args.get("coverage"),
            mechanics_placements=args.get("mechanics_placements"),
        )
        coc_turn_finalization.append_finalization(ctx.campaign_dir, receipt)
        _record_finalized_keeper_text(ctx, receipt)
    except coc_turn_finalization.TurnContractError as exc:
        raise ToolError(exc.code, str(exc), violations=exc.violations) from exc
    uptake_warnings, uptake_hints = record_uptake(receipt)
    return receipt, uptake_warnings, [
        "echo rendered_text exactly; direct-host output is contract-invalid if any text or number is changed",
        "a narration-only repair uses the same settled journal and never reruns rules or state",
        *uptake_hints,
    ]


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
    gap_hints = _adjudication_gap_hints(ctx)
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
            "retry state.end_session or development.settle with the same decision identity; do not reopen narration",
            *gap_hints,
        ]
    warnings = []
    if target_conflict is not None:
        warnings.append(
            "SETTLEMENT_TARGET_CONFLICT: retry target set differed; the persisted ending targets were preserved"
        )
    return data, warnings, [
        "development settlement completed synchronously",
        *gap_hints,
    ]


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

_MUTATING_TOOLS = frozenset({
    "session.delivery_ack",
    "npc.reaction",
    "rules.roll",
    "rules.check",
    "rules.resource_delta",
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
    "chase.execute",
    "sanity.execute",
    "development.settle",
    "evidence.record_adoption",
    "evidence.table_opening",
    "narration.review",
    "state.personal_horror_add",
    "state.personal_horror_mark_woven",
    "state.backstory_corruption_add",
    "state.threat_tick",
    "state.belief_apply",
    "state.record_clue",
    "state.move_scene",
    "state.set_flag",
    "state.clear_transient_condition",
    "state.item_grant",
    "state.item_remove",
    "state.record_npc_engagement",
    "state.record_route_completion",
    "state.npc_presence",
    "state.npc_update",
    "state.time_marker",
    "state.advance_time",
    "state.clock_discontinuity",
    "state.mark_safe_rest",
    "state.exceptional_effect",
    "state.supersede_settlement",
    "state.journal",
    "state.end_session",
    "turn.finalize",
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
        "access": spec.get("access", "mutation"),
        "read_domains": list(spec.get("read_domains") or ()),
        "write_domains": list(spec.get("write_domains") or ()),
        "recovery_domains": (
            None
            if spec.get("recovery_domains") is None
            else list(spec.get("recovery_domains") or ())
        ),
        "response_mode": spec.get("response_mode", "full"),
        "audit_mode": spec.get("audit_mode", "full"),
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
