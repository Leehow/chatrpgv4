"""§21: the investigator library -- a card built once, played at any table.

Rows live under `<workspace>/.coc/investigators/<library_id>.json`, beside the module
store (a module is a library, a campaign is a save; an investigator card is the same
kind of thing as a module). A row is the whole party sheet as the campaign last wrote
it, plus where it came from and where it was last played.

The campaign is the authority and the library is its mirror. `investigator.load`
copies a row's sheet into a campaign byte for byte -- only `id` changes and `origin`
is added; no conversion, no re-roll, no era gate (§21.3). Every committed turn then
writes the sheet back (`write_back`, hung on the post-commit chain, §21.4). Nothing
ever flows from the library into a campaign that already holds the card."""

from __future__ import annotations

import copy
import re
from pathlib import Path
from typing import Any, Callable

from . import history
from .chargen import default_investigator_id
from .errors import RpcError, invalid_params
from .fileio import read_json, write_json_atomic
from .module_graph import ModuleGraph, module_declaration
from .store import Campaign, Store, now_iso
from .text import ascii_slug

SCHEMA_VERSION = 1
LANE = "library"
#: §21.4: the closed reasons a `lane: library` telemetry row can carry.
REASON_UNWRITABLE = "library_unwritable"
REASON_CONFLICT = "library_conflict"
#: the stem a library_id falls back to when the name has no Latin letter or digit
FALLBACK_STEM = "investigator"
LIBRARY_ID = re.compile(r"^(?P<stem>[a-z0-9][a-z0-9-]*)-(?P<n>[1-9]\d*)$")
#: the turn states in which a card may join the party: the keeper is not acting
LOADABLE_STATES = frozenset({"awaiting_player", "asked"})


# ---- errors ---------------------------------------------------------------------------------

class LibraryError(Exception):
    """A row could not be written; `reason` is one of the two closed codes."""
    reason = REASON_UNWRITABLE


class Unwritable(LibraryError):
    reason = REASON_UNWRITABLE


class Conflict(LibraryError):
    reason = REASON_CONFLICT


# ---- ids and slugs --------------------------------------------------------------------------

def _ascii_stem(name: str, limit: int = 32) -> str:
    """The ascii kebab of a name, or the fallback stem when it has no Latin letter or digit."""
    return ascii_slug(name, limit=limit) or FALLBACK_STEM


def origin_of(sheet: dict[str, Any]) -> str | None:
    """The library row a campaign sheet mirrors, or None for a card that was never saved."""
    origin = sheet.get("origin")
    library_id = origin.get("library_id") if isinstance(origin, dict) else None
    return library_id if isinstance(library_id, str) and library_id else None


# ---- the store ------------------------------------------------------------------------------

class Library:
    def __init__(self, store: Store) -> None:
        self.root: Path = store.investigators_dir

    def path(self, library_id: str) -> Path:
        return self.root / f"{library_id}.json"

    def ids(self) -> list[str]:
        if not self.root.exists():
            return []
        return sorted(p.stem for p in self.root.glob("*.json") if p.is_file())

    def read(self, library_id: str) -> dict[str, Any] | None:
        """The row; None when there is none; `Conflict` when the file is not a row this
        kernel can update (not JSON, another schema, an id that is not its file name)."""
        path = self.path(library_id)
        if not path.exists():
            return None
        try:
            row = read_json(path)
        except (OSError, ValueError) as exc:
            raise Conflict(f"{path.name} is not readable as a library row: {exc}") from exc
        if (not isinstance(row, dict) or row.get("schema_version") != SCHEMA_VERSION
                or row.get("library_id") != library_id or not isinstance(row.get("sheet"), dict)):
            raise Conflict(f"{path.name} is not a schema {SCHEMA_VERSION} library row for {library_id!r}")
        return row

    def write(self, row: dict[str, Any]) -> None:
        """Whole-file atomic write, like everything else under .coc/."""
        try:
            write_json_atomic(self.path(str(row["library_id"])), row)
        except OSError as exc:
            raise Unwritable(f"cannot write {self.root}: {exc}") from exc

    def mint_id(self, name: str) -> str:
        """`<ascii slug of the name>-<n>`: `n` is one past the highest ordinal that stem
        already holds, so the same library and the same name always mint the same id and
        two cards of one name never collide (`ada-lovelace-1`, `ada-lovelace-2`)."""
        stem = _ascii_stem(name)
        taken = set(self.ids())
        ordinal = 1 + max((int(m.group("n")) for lid in taken
                           if (m := LIBRARY_ID.match(lid)) and m.group("stem") == stem), default=0)
        while f"{stem}-{ordinal}" in taken:
            ordinal += 1
        return f"{stem}-{ordinal}"


# ---- rows -----------------------------------------------------------------------------------

def play_block(previous: dict[str, Any] | None, campaign_id: str, turn: int | None,
               commit: str | None) -> dict[str, Any]:
    campaigns = [c for c in (previous or {}).get("campaigns") or [] if isinstance(c, str)]
    if campaign_id not in campaigns:
        campaigns.append(campaign_id)
    return {"last_campaign": campaign_id, "last_turn": turn, "last_commit": commit,
            "updated_at": now_iso(), "campaigns": campaigns}


def new_row(library_id: str, sheet: dict[str, Any], campaign_id: str, play: dict[str, Any]) -> dict[str, Any]:
    return {
        "library_id": library_id,
        "sheet": sheet,
        "origin": {"created_in": campaign_id, "created_at": now_iso(), "era_at_creation": sheet.get("era")},
        "play": play,
        "schema_version": SCHEMA_VERSION,
    }


def upsert(library: Library, campaign: Campaign, sheet: dict[str, Any], turn: int | None,
           commit: str | None) -> tuple[dict[str, Any], bool]:
    """Mirror `sheet` (which carries `origin.library_id`) into its row: the row's `sheet`
    is replaced whole and `play` moves on; a row that is missing is created from the
    sheet. Returns (row, created). Raises `Conflict` / `Unwritable`."""
    library_id = str(origin_of(sheet))
    existing = library.read(library_id)
    play = play_block(existing.get("play") if existing else None, campaign.id, turn, commit)
    row = new_row(library_id, sheet, campaign.id, play) if existing is None else {**existing, "sheet": sheet, "play": play}
    library.write(row)
    return row, existing is None


def committed_position(campaign: Campaign) -> tuple[int | None, str | None]:
    """Where a campaign stands for a manual save: HEAD's turn number (None before the first
    narrate commit, or when HEAD is not a turn commit) and its short sha."""
    return history.head_turn(campaign.repo_dir, campaign.dir), history.head_sha(campaign.repo_dir, campaign.dir)


def summary_row(row: dict[str, Any]) -> dict[str, Any]:
    """The `investigator.list` projection (§21.2)."""
    sheet = row.get("sheet") or {}
    play = row.get("play") or {}
    return {"library_id": row.get("library_id"), "name": sheet.get("name"), "occupation": sheet.get("occupation"),
            "era": sheet.get("era"), "current_hp": sheet.get("current_hp"), "current_san": sheet.get("current_san"),
            "last_campaign": play.get("last_campaign"), "last_turn": play.get("last_turn"),
            "updated_at": play.get("updated_at")}


# ---- eras (§21.3) ---------------------------------------------------------------------------

def module_era(graph: ModuleGraph) -> str | None:
    """The era the book declares: `module-meta.json`'s `era` in the module node's runtime
    projection (where every starter carries it), else the node's record. None when the
    graph says nothing -- then there is nothing to mismatch against."""
    era = module_declaration(graph.module_node).get("era")
    return era if isinstance(era, str) and era else None


def era_mismatch(graph: ModuleGraph, sheet: dict[str, Any]) -> dict[str, str] | None:
    """`{sheet, module}` when both eras are known and differ; None otherwise."""
    sheet_era = sheet.get("era")
    book = module_era(graph)
    if isinstance(sheet_era, str) and sheet_era and book and sheet_era != book:
        return {"sheet": sheet_era, "module": book}
    return None


def era_note(graph: ModuleGraph, sheet: dict[str, Any]) -> dict[str, str]:
    """The one line the capsule's `known.investigator` carries for a library card whose
    era is not the book's; empty for every other sheet."""
    mismatch = era_mismatch(graph, sheet) if origin_of(sheet) else None
    if not mismatch:
        return {}
    return {"era_note": (f"This sheet was built for the {mismatch['sheet']} era and the module is set in "
                         f"{mismatch['module']}; its characteristics, skills and money are unchanged. "
                         "Reconcile the difference in the fiction, not in the numbers.")}


# ---- the per-turn write-back (§21.4) -------------------------------------------------------

def write_back(store: Store, campaign: Campaign, record: dict[str, Any]) -> None:
    """After a turn is committed, mirror every library card at the table into its row.
    Never raises: the turn is closed and stays closed. A card that cannot be written
    leaves a `lane: library` telemetry row with its reason and the mirror as it was; a
    card that was written leaves an `ok: true` row so the evidence shows the mirror moved."""
    try:
        library = Library(store)
        turn, commit = int(record["turn"]), record.get("commit")
        party = campaign.party()
    except Exception as exc:  # noqa: BLE001 - the turn is committed; nothing here may fail it
        # Nothing could even be read: one row for the turn, since no card was reached.
        campaign.append_telemetry({"lane": LANE, "ok": False, "reason": REASON_UNWRITABLE,
                                   "error": f"{type(exc).__name__}: {exc}"})
        return
    for sheet in party:
        library_id = origin_of(sheet)
        if library_id is None:
            continue
        row = {"lane": LANE, "turn": turn, "investigator": sheet.get("id"), "library_id": library_id}
        try:
            upsert(library, campaign, sheet, turn, commit)
        except LibraryError as exc:
            campaign.append_telemetry({**row, "ok": False, "reason": exc.reason, "error": str(exc)})
        except Exception as exc:  # noqa: BLE001 - the turn is committed; nothing here may fail it
            campaign.append_telemetry({**row, "ok": False, "reason": REASON_UNWRITABLE,
                                       "error": f"{type(exc).__name__}: {exc}"})
        else:
            campaign.append_telemetry({**row, "ok": True})


# ---- the four methods (§21.2) --------------------------------------------------------------

def _str(params: dict[str, Any], key: str, *, required: bool = True) -> str | None:
    value = params.get(key)
    if value is None:
        if required:
            raise invalid_params(f"params.{key} is required")
        return None
    if not isinstance(value, str) or not value.strip():
        raise invalid_params(f"params.{key} must be a non-empty string")
    return value


class LibraryMethods:
    def __init__(self, table: Any) -> None:
        self.table = table
        self.library = Library(table.store)

    # ---- helpers ------------------------------------------------------------------

    def _campaign(self, params: dict[str, Any]) -> tuple[Campaign, dict[str, Any]]:
        """Any campaign that exists: a card is saved or loaded while setting up as well as
        at an active table; neither needs a world or a turn."""
        campaign = self.table.store.open(params.get("campaign"), require_turn=False, require_world=False)
        return campaign, campaign.read_campaign()

    def _row(self, library_id: str) -> dict[str, Any]:
        try:
            row = self.library.read(library_id)
        except Conflict as exc:
            raise RpcError("internal", str(exc), code_detail=REASON_CONFLICT,
                           fix="the row on disk is not one this kernel can read; inspect or remove it by hand")
        if row is None:
            raise RpcError("unknown_entity", f"no investigator {library_id!r} in the library",
                           fix="call investigator.list and use one of its library_id values",
                           details={"query": library_id, "candidates": self.library.ids()})
        return row

    def _loadable_turn(self, campaign: Campaign) -> int:
        """The turn a card joins at: 0 while setting up; otherwise the open turn number,
        provided the keeper is not in the middle of acting on it."""
        if not campaign.turn_json.exists():
            return 0
        turn = campaign.read_turn()
        if turn.get("state") not in LOADABLE_STATES:
            raise RpcError("turn_state", f"a card cannot join while the turn is {turn.get('state')!r}",
                           fix="finish the turn (narrate or ask) first",
                           details={"turn": turn.get("turn"), "state": turn.get("state")})
        return int(turn.get("turn") or 0)

    @staticmethod
    def _party_id(name: str, party: list[dict[str, Any]]) -> str:
        taken = {str(s.get("id")) for s in party}
        base = default_investigator_id(name, len(party) + 1)
        candidate, n = base, 2
        while candidate in taken:
            candidate = f"{base}-{n}"
            n += 1
        return candidate

    # ---- investigator.list / get ---------------------------------------------------

    def list(self, params: dict[str, Any]) -> dict[str, Any]:
        rows, unreadable = [], []
        for library_id in self.library.ids():
            try:
                row = self.library.read(library_id)
            except Conflict:
                unreadable.append(library_id)
                continue
            if row is not None:
                rows.append(summary_row(row))
        rows.sort(key=lambda r: (str(r.get("updated_at") or ""), str(r.get("library_id"))), reverse=True)
        result: dict[str, Any] = {"investigators": rows}
        if unreadable:
            result["unreadable"] = unreadable
        return result

    def get(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._row(str(_str(params, "library_id")))

    # ---- investigator.save ---------------------------------------------------------

    def save(self, params: dict[str, Any]) -> dict[str, Any]:
        """The campaign's card into the library: a card with an origin updates its row; a
        card without one gets a row minted and `origin.library_id` written on the sheet.
        The row is written before the sheet, so a sheet's origin always names a row."""
        campaign, _ = self._campaign(params)
        sheet = self.table._actor(campaign, params.get("investigator"))
        minted = origin_of(sheet) is None
        if minted:
            sheet["origin"] = {"library_id": self.library.mint_id(str(sheet.get("name") or ""))}
        turn, commit = committed_position(campaign)
        try:
            row, created = upsert(self.library, campaign, sheet, turn, commit)
        except LibraryError as exc:
            raise RpcError("internal", str(exc), code_detail=exc.reason,
                           fix="make .coc/investigators writable, or inspect the row it names")
        if minted:
            campaign.write_sheet(sheet)
        return {"library_id": row["library_id"], "investigator": sheet.get("id"), "name": sheet.get("name"),
                "created": created, "play": row["play"]}

    # ---- investigator.load ---------------------------------------------------------

    def load(self, params: dict[str, Any]) -> dict[str, Any]:
        """The row's sheet into the campaign, byte for byte: only `id` changes and `origin`
        is added. With `as`, the copy is renamed and gets a row of its own (§21.4: a double
        is two people), `forked_from` naming the row it came from."""
        campaign, meta = self._campaign(params)
        library_id = str(_str(params, "library_id"))
        as_name = _str(params, "as", required=False)
        row = self._row(library_id)
        turn_number = self._loadable_turn(campaign)
        party = campaign.party()
        sheet = copy.deepcopy(row["sheet"])
        if as_name is not None:
            sheet["name"] = as_name
        sheet["id"] = self._party_id(str(sheet.get("name") or ""), party)
        forked_from = None
        if as_name is not None:
            forked_from = library_id
            library_id = self.library.mint_id(as_name)
        sheet["origin"] = {"library_id": library_id, "loaded_at_turn": turn_number}
        if forked_from is not None:
            fork = new_row(library_id, sheet, campaign.id, play_block(None, campaign.id, None, None))
            fork["origin"]["forked_from"] = forked_from
            try:
                self.library.write(fork)
            except LibraryError as exc:
                raise RpcError("internal", str(exc), code_detail=exc.reason,
                               fix="make .coc/investigators writable, then load again")
        campaign.party_dir.mkdir(parents=True, exist_ok=True)
        campaign.write_sheet(sheet)

        meta["investigators"] = [str(s.get("id")) for s in campaign.party()]
        mismatch = None
        module_id = str(meta.get("module_id") or "")
        if module_id and (self.table.module_store.graph_path(module_id).exists() or module_id in self.table.modules()):
            mismatch = era_mismatch(self.table.graph(module_id), sheet)
        if mismatch:
            # §21.3: both eras on the record; nothing on the sheet changes.
            meta["era_mismatch"] = mismatch
        if meta.get("status") == "setting_up":
            block = dict(meta.get("setup") or {})
            receipts = list(block.get("receipts") or [])
            receipts.append({"id": f"investigator:{sheet['id']}", "kind": "investigator", "investigator": sheet["id"],
                             "name": sheet.get("name"), "occupation": sheet.get("occupation"), "source": "library",
                             "library_id": library_id, "forked_from": forked_from, "at": now_iso()})
            block["receipts"] = receipts
            meta["setup"] = block
        campaign.write_campaign(meta)
        return {"receipt": f"investigator:{sheet['id']}", "investigator": self.table.investigator_row(sheet),
                "sheet": sheet, "library_id": library_id, "forked_from": forked_from,
                "loaded_at_turn": turn_number, "era_mismatch": mismatch}


def methods(table: Any) -> dict[str, Callable[[dict[str, Any]], dict[str, Any]]]:
    """The `investigator.*` map for `coc.rpc.build_methods`."""
    api = LibraryMethods(table)
    return {
        "investigator.list": api.list,
        "investigator.get": api.get,
        "investigator.save": api.save,
        "investigator.load": api.load,
    }
