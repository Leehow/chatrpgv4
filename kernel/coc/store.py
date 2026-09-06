"""Campaign storage under <workspace>/.coc (contract §3). Every write is atomic."""

from __future__ import annotations

import datetime as _dt
import re
from pathlib import Path
from typing import Any

from .errors import RpcError
from .fileio import (append_jsonl, canonical_json, read_json, read_jsonl, sha256_text,
                     write_json_atomic)

CAMPAIGN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
CALL_ID = re.compile(r"^t(?P<turn>\d+)-c(?P<n>\d+)$")


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_call_id(call_id: Any) -> tuple[int, int]:
    if not isinstance(call_id, str) or not CALL_ID.match(call_id):
        raise RpcError("invalid_params", "call_id must look like t<turn>-c<n>",
                       fix="the extension mints call_id; the model never writes it",
                       details={"call_id": call_id})
    match = CALL_ID.match(call_id)
    assert match is not None
    return int(match.group("turn")), int(match.group("n"))


def params_digest(params: dict[str, Any]) -> str:
    return sha256_text(canonical_json(params))


def fresh_turn(number: int, state: str = "awaiting_player",
               pending_choice: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "turn": number,
        "state": state,
        "player_text": None,
        "opened_at": now_iso(),
        "calls": {},
        "receipts": [],
        "pending_choice": pending_choice,
    }


class Store:
    def __init__(self, workspace: Path) -> None:
        self.workspace = Path(workspace)
        self.root = self.workspace / ".coc"
        self.campaigns_dir = self.root / "campaigns"
        self.repos_dir = self.root / "repos"
        #: §14.1: the module store, shared by every campaign of the same module.
        self.modules_dir = self.root / "modules"

    def campaign_ids(self) -> list[str]:
        if not self.campaigns_dir.exists():
            return []
        return sorted(p.name for p in self.campaigns_dir.iterdir()
                      if (p / "campaign.json").exists())

    def campaign_dir(self, campaign_id: str) -> Path:
        return self.campaigns_dir / campaign_id

    def repo_dir(self, campaign_id: str) -> Path:
        return self.repos_dir / f"{campaign_id}.git"

    def validate_new_id(self, campaign_id: Any) -> str:
        if not isinstance(campaign_id, str) or not CAMPAIGN_ID.match(campaign_id):
            raise RpcError("invalid_params", "campaign id must be a short slug",
                           fix="use letters, digits, '.', '_' or '-' (max 64 chars)")
        if self.campaign_dir(campaign_id).exists():
            raise RpcError("invalid_params", f"campaign {campaign_id!r} already exists",
                           fix="pick another id or open the existing campaign")
        return campaign_id

    def open(self, campaign_id: Any, *, require_turn: bool = True) -> "Campaign":
        """`require_turn=False` is for `table.open`, which may rebuild a lost turn.json
        from the continuation checkpoint before anything reads it (contract §12.2)."""
        if not isinstance(campaign_id, str) or not campaign_id:
            raise RpcError("invalid_params", "params.campaign is required")
        campaign = Campaign(self, campaign_id)
        if not campaign.campaign_json.exists():
            raise RpcError("campaign_not_found", f"no campaign {campaign_id!r}",
                           fix="call campaign.list, or campaign.create",
                           details={"campaigns": self.campaign_ids()})
        required = [campaign.world_json] + ([campaign.turn_json] if require_turn else [])
        for path in required:
            if not path.exists():
                raise RpcError("campaign_not_ready",
                               f"campaign {campaign_id!r} is missing {path.name}")
        return campaign


class Campaign:
    def __init__(self, store: Store, campaign_id: str) -> None:
        self.store = store
        self.id = campaign_id
        self.dir = store.campaign_dir(campaign_id)
        self.repo_dir = store.repo_dir(campaign_id)
        self.campaign_json = self.dir / "campaign.json"
        self.world_json = self.dir / "world.json"
        self.turn_json = self.dir / "turn.json"
        self.party_dir = self.dir / "party"
        self.turns_dir = self.dir / "turns"
        self.transcript_path = self.dir / "transcript.jsonl"
        self.events_path = self.dir / "events.jsonl"
        self.telemetry_path = self.dir / "telemetry.jsonl"
        # slice 2 (contract §3, §12): the rebuildable checkpoint and the memory stores
        self.checkpoint_path = self.dir / "save" / "continuation" / "latest.json"
        self.memory_dir = self.dir / "memory"
        self.episodes_path = self.memory_dir / "episodes.jsonl"
        self.candidates_path = self.memory_dir / "candidates.jsonl"
        self.jobs_dir = self.memory_dir / "jobs"
        self.backlog_path = self.memory_dir / "backlog.jsonl"
        #: §14.8: a text handout is materialized here so the attachment is a file path.
        self.handouts_dir = self.dir / "handouts"

    # ---- documents --------------------------------------------------------

    def read_campaign(self) -> dict[str, Any]:
        return read_json(self.campaign_json)

    def write_campaign(self, data: dict[str, Any]) -> None:
        write_json_atomic(self.campaign_json, data)

    def read_world(self) -> dict[str, Any]:
        return read_json(self.world_json)

    def write_world(self, data: dict[str, Any]) -> None:
        write_json_atomic(self.world_json, data)

    def read_turn(self) -> dict[str, Any]:
        return read_json(self.turn_json)

    def write_turn(self, data: dict[str, Any]) -> None:
        write_json_atomic(self.turn_json, data)

    def party(self) -> list[dict[str, Any]]:
        if not self.party_dir.exists():
            return []
        return [read_json(p) for p in sorted(self.party_dir.glob("*.json"))]

    def write_sheet(self, sheet: dict[str, Any]) -> None:
        write_json_atomic(self.party_dir / f"{sheet['id']}.json", sheet)

    # ---- closed turns -----------------------------------------------------

    def turn_record_path(self, number: int) -> Path:
        return self.turns_dir / f"{number:04d}.json"

    def read_turn_record(self, number: int) -> dict[str, Any] | None:
        path = self.turn_record_path(number)
        return read_json(path) if path.exists() else None

    def write_turn_record(self, record: dict[str, Any]) -> None:
        write_json_atomic(self.turn_record_path(int(record["turn"])), record)

    def closed_turns(self) -> list[dict[str, Any]]:
        if not self.turns_dir.exists():
            return []
        return [read_json(p) for p in sorted(self.turns_dir.glob("*.json"))]

    # ---- append-only logs -------------------------------------------------

    def append_transcript(self, turn: int, role: str, text: str) -> dict[str, Any]:
        entry = {"turn": turn, "role": role, "text": text, "at": now_iso()}
        append_jsonl(self.transcript_path, entry)
        return entry

    def read_transcript(self) -> list[dict[str, Any]]:
        return read_jsonl(self.transcript_path)

    def read_events(self) -> list[dict[str, Any]]:
        return read_jsonl(self.events_path)

    def append_telemetry(self, row: dict[str, Any]) -> None:
        """One flat line per lane step (contract §8, §12.5). The extension writes its own
        rows to the same file; the kernel's carry `lane`."""
        append_jsonl(self.telemetry_path, {"at": now_iso(), **row})

    def turn_records_by_number(self) -> dict[int, dict[str, Any]]:
        return {int(r["turn"]): r for r in self.closed_turns()}

    # ---- idempotency (contract §2) ----------------------------------------

    def lookup_call(self, turn: dict[str, Any], call_id: str) -> dict[str, Any] | None:
        stored = (turn.get("calls") or {}).get(call_id)
        if stored is None:
            call_turn, _ = parse_call_id(call_id)
            record = self.read_turn_record(call_turn)
            stored = ((record or {}).get("calls") or {}).get(call_id)
        return stored

    def replay_or_conflict(self, turn: dict[str, Any], call_id: str,
                           params: dict[str, Any]) -> dict[str, Any] | None:
        """Return the stored result (marked replayed) for a repeated call_id, raise on
        a different payload, or None when the call is new."""
        digest = params_digest(params)
        stored = self.lookup_call(turn, call_id)
        if stored is None:
            return None
        if stored.get("params_sha256") != digest:
            raise RpcError("idempotency_conflict",
                           f"call_id {call_id} was already used with different params",
                           fix="mint a new call_id for a new call",
                           details={"call_id": call_id})
        return {**stored["result"], "replayed": True}

    @staticmethod
    def remember_call(turn: dict[str, Any], call_id: str, params: dict[str, Any],
                      result: dict[str, Any]) -> None:
        turn.setdefault("calls", {})[call_id] = {
            "params_sha256": params_digest(params),
            "result": result,
            "at": now_iso(),
        }
