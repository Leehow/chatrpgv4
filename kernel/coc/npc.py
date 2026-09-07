"""Contract §17.3 (#29): the runtime NPC ledger — what playing this table did to the
people in it, as distinct from what the book authored about them (§17.2, read off the
module graph) .

One file per campaign, `npc-ledger.json`, keyed by NPC node id. Every field is written
deterministically from receipts, world snapshots and memory candidates: nothing here
reads prose, and no number is written in code — the stance moves by
`content/rulesets/coc7/rules-json/npc-stance.json`.

Because the ledger is a pure function of the closed turn records plus the memory
candidates, `rebuild` replays it from scratch — which is both the crash-recovery path
(§12.6) and how a campaign that predates this slice gets a ledger on its first
`table.open`. Presence is not in the ledger: `world.npc_presence` stays the single truth
about where a person is, and the ledger only references it."""

from __future__ import annotations

from typing import Any, Iterable

from .errors import RpcError
from .fileio import read_json, write_json_atomic

LEDGER_FILENAME = "npc-ledger.json"
STANCE_TABLE = "npc-stance"
#: the table must say it is the table (§13.10's law, applied here too)
STANCE_CONTRACT_ID = "coc.npc-stance.v1"
#: §17.3: how the keeper's own `apply npc stance` is recorded next to the settled ones.
KEEPER_SET = "keeper"
#: the interaction kinds the ledger keeps, by the family the settlement declared
INTERACTION_FAMILIES = {"social": "social", "combat": "combat", "chase": "chase",
                        "psychology": "psychology"}
#: §17.4: how many `because` lines a projection carries, newest first
BECAUSE_LIMIT = 3


class StanceTable:
    """The closed table §17.3 puts the numbers in. A missing file is a content error, and
    an approach or level the table does not name moves the score by nothing."""

    def __init__(self, tables: Any) -> None:
        self.raw = tables.load(STANCE_TABLE)
        # Fail closed on the wrong table, the way the Director graph and the text graph do
        # (§13.10): a stance table of another shape would otherwise be read silently and
        # every approach would quietly move nothing.
        if self.raw.get("contract_id") != STANCE_CONTRACT_ID:
            raise RpcError("campaign_not_ready",
                           f"{STANCE_TABLE} does not declare {STANCE_CONTRACT_ID}",
                           fix=f"restore content/rulesets/coc7/rules-json/{STANCE_TABLE}",
                           details={"stance": {"declared": self.raw.get("contract_id")}})
        self.initial = int(self.raw["initial_score"])
        low, high = self.raw["score_range"]
        self.low, self.high = int(low), int(high)
        self.levels = [(str(row["value"]), int(row["at_most"])) for row in self.raw["levels"]]
        self.social = self.raw["social"]
        self.pushed_failure_delta = int(self.raw["pushed_failure_delta"])
        self.combat_target_score = int(self.raw["combat_target_score"])

    def delta(self, approach: Any, level: Any) -> int:
        row = self.social.get(str(approach or "")) if isinstance(self.social, dict) else None
        if not isinstance(row, dict):
            return 0
        value = row.get(str(level or ""))
        return int(value) if isinstance(value, int) else 0

    def knows_approach(self, approach: Any) -> bool:
        return isinstance(self.social, dict) and str(approach or "") in self.social

    def clamp(self, score: int) -> int:
        return max(self.low, min(self.high, int(score)))

    def word(self, score: int) -> str:
        for value, at_most in self.levels:
            if score <= at_most:
                return value
        return self.levels[-1][0] if self.levels else "neutral"

    def floor_of(self, word: str) -> int:
        """The lowest score that still reads as this word: what an explicit
        `apply npc stance` sets the score to (§17.3)."""
        previous = self.low
        for value, at_most in self.levels:
            if value == word:
                return max(self.low, previous)
            previous = at_most + 1
        return self.initial

    @property
    def words(self) -> list[str]:
        return [value for value, _ in self.levels]


def empty_entry() -> dict[str, Any]:
    return {"stance": None, "disclosed": [], "exchanged": [], "interactions": [], "promises": [],
            "said": [], "turns_present": None}


def entry_of(ledger: dict[str, Any], npc_id: str) -> dict[str, Any]:
    entry = ledger.get(npc_id)
    if not isinstance(entry, dict):
        entry = empty_entry()
        ledger[npc_id] = entry
    return entry


# ---- writers: one turn's receipts -------------------------------------------------------

def _set_stance(entry: dict[str, Any], table: StanceTable, score: int, turn: int,
                receipt: str | None, *, because: dict[str, Any] | None = None) -> None:
    stance = entry.get("stance") or {}
    score = table.clamp(score)
    word = table.word(score)
    reasons = list(stance.get("because") or [])
    if because:
        reasons.append({**because, "turn": turn, "receipt": receipt})
        reasons = reasons[-BECAUSE_LIMIT:]
    entry["stance"] = {"value": word, "score": score,
                       "since_turn": turn if stance.get("value") != word else stance.get("since_turn", turn),
                       "because": reasons}


def _score(entry: dict[str, Any], table: StanceTable) -> int:
    stance = entry.get("stance") or {}
    return int(stance.get("score", table.initial)) if isinstance(stance.get("score"), int) else table.initial


def apply_receipts(ledger: dict[str, Any], receipts: Iterable[dict[str, Any]], *, turn: int,
                   table: StanceTable, npc_id_of: Any) -> None:
    """Fold one turn's receipts into the ledger. `npc_id_of` maps whatever a receipt calls
    a person (a handle, a node id, a display name) to the node id the ledger is keyed by,
    or None when the receipt is not about an NPC at all."""
    for receipt in receipts:
        kind = receipt.get("kind")
        if kind == "roll":
            _fold_roll(ledger, receipt, turn=turn, table=table, npc_id_of=npc_id_of)
        elif kind == "clue":
            _fold_clue(ledger, receipt, turn=turn, npc_id_of=npc_id_of)
        elif kind == "npc":
            _fold_npc_effect(ledger, receipt, turn=turn, table=table, npc_id_of=npc_id_of)
        elif kind == "delta":
            _fold_delta(ledger, receipt, turn=turn, npc_id_of=npc_id_of)
        elif kind == "item":
            _fold_item(ledger, receipt, turn=turn, npc_id_of=npc_id_of)



def _fold_roll(ledger: dict[str, Any], receipt: dict[str, Any], *, turn: int, table: StanceTable,
               npc_id_of: Any) -> None:
    """A settled check that named an NPC: the interaction is recorded, and a social one
    moves the stance by the table. `npc` is the person the check was against; an NPC's own
    roll (`actor`) counts as an interaction but moves nothing."""
    against = npc_id_of(receipt.get("npc"))
    actor = npc_id_of(receipt.get("actor"))
    family = INTERACTION_FAMILIES.get(str(receipt.get("family") or receipt.get("roll_kind") or ""))
    for npc_id, is_target in ((against, True), (actor, False)):
        if not npc_id or (npc_id == against and not is_target):
            continue
        entry = entry_of(ledger, npc_id)
        interaction = {"turn": turn, "kind": family or "social", "receipt": receipt.get("id"),
                       "level": receipt.get("level")}
        approach = receipt.get("approach")
        if isinstance(approach, str):
            interaction["approach"] = approach
        entry["interactions"].append(interaction)
        if not is_target:
            continue
        if family == "combat":
            _set_stance(entry, table, table.combat_target_score, turn, receipt.get("id"),
                        because={"how": "combat"})
            continue
        # A roll that names an approach the stance table knows is a social one, whatever
        # family settled it: a push and a luck spend continue the social check they came
        # from, and it is the same person on the other side of it.
        if family != "social" and not (isinstance(approach, str) and table.knows_approach(approach)):
            continue
        delta = table.delta(approach, receipt.get("level"))
        if receipt.get("pushed") and not receipt.get("passed"):
            delta += table.pushed_failure_delta
        if delta:
            _set_stance(entry, table, _score(entry, table) + delta, turn, receipt.get("id"),
                        because={"how": "social", "approach": approach, "level": receipt.get("level"),
                                 "delta": delta})


def _fold_clue(ledger: dict[str, Any], receipt: dict[str, Any], *, turn: int, npc_id_of: Any) -> None:
    npc_id = npc_id_of(receipt.get("from"))
    if not npc_id:
        return
    entry = entry_of(ledger, npc_id)
    handle = receipt.get("clue")
    if not any(row.get("clue") == handle for row in entry["disclosed"]):
        entry["disclosed"].append({"clue": handle, "turn": turn, "receipt": receipt.get("id")})


def _fold_item(ledger: dict[str, Any], receipt: dict[str, Any], *, turn: int, npc_id_of: Any) -> None:
    """§17.3: a thing that changed hands with someone goes on their account. Only when the
    keeper named the other party (`apply item`'s `from`): who a thing came from is theirs to
    say, not the kernel's to infer from who happened to be standing there."""
    npc_id = npc_id_of(receipt.get("from"))
    if not npc_id:
        return
    entry = entry_of(ledger, npc_id)
    entry["exchanged"].append(
        {"item": receipt.get("label") or receipt.get("name"), "turn": turn,
         "receipt": receipt.get("id")})


def _fold_npc_effect(ledger: dict[str, Any], receipt: dict[str, Any], *, turn: int,
                     table: StanceTable, npc_id_of: Any) -> None:
    """`apply npc` (§17.3): the keeper's own judgement, recorded with its reason."""
    npc_id = npc_id_of(receipt.get("npc") or receipt.get("name"))
    if not npc_id:
        return
    entry = entry_of(ledger, npc_id)
    stance = receipt.get("stance")
    if isinstance(stance, str) and stance in table.words:
        _set_stance(entry, table, table.floor_of(stance), turn, receipt.get("id"),
                    because={"how": KEEPER_SET, "stance": stance, "why": receipt.get("why")})


def _fold_delta(ledger: dict[str, Any], receipt: dict[str, Any], *, turn: int, npc_id_of: Any) -> None:
    """§17.3 `dead`: an NPC's HP crossing zero in a settlement."""
    if receipt.get("resource") != "hp":
        return
    npc_id = npc_id_of(receipt.get("subject"))
    after = receipt.get("after")
    if not npc_id or not isinstance(after, int) or after > 0:
        return
    entry = entry_of(ledger, npc_id)
    entry.setdefault("dead", {"turn": turn, "receipt": receipt.get("id")})


def note_present(ledger: dict[str, Any], present_ids: Iterable[str], turn: int) -> None:
    """`turns_present` from the closed turn's world snapshot (§17.3)."""
    for npc_id in present_ids:
        entry = entry_of(ledger, npc_id)
        seen = entry.get("turns_present")
        if not isinstance(seen, dict):
            entry["turns_present"] = {"first": turn, "last": turn, "count": 1}
            continue
        if seen.get("last") == turn:
            continue
        seen["last"] = turn
        seen["count"] = int(seen.get("count", 0)) + 1
        seen.setdefault("first", turn)


def note_memory(ledger: dict[str, Any], rows: Iterable[dict[str, Any]], *, npc_id_of: Any) -> None:
    """§17.3 `promises` / `said`: memory candidates referenced by id, never copied. A
    `promise` whose subject is this person is a promise of theirs; a `knowledge` or
    `belief` they are a knower of is something they said or came to hold at this table."""
    for row in rows:
        kind = row.get("kind")
        turn = row.get("valid_from_turn", row.get("turn"))
        if kind == "promise":
            npc_id = npc_id_of(row.get("subject"))
            if npc_id:
                _append_memory(entry_of(ledger, npc_id)["promises"], row.get("id"), turn)
        elif kind in ("knowledge", "belief"):
            for knower in row.get("knowers") or []:
                npc_id = npc_id_of(knower)
                if npc_id:
                    _append_memory(entry_of(ledger, npc_id)["said"], row.get("id"), turn)


def _append_memory(rows: list[dict[str, Any]], memory_id: Any, turn: Any) -> None:
    if memory_id and not any(row.get("memory_id") == memory_id for row in rows):
        rows.append({"memory_id": memory_id, "turn": turn})


# ---- storage ---------------------------------------------------------------------------

def read_ledger(path: Any) -> dict[str, Any]:
    try:
        data = read_json(path)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def write_ledger(path: Any, ledger: dict[str, Any]) -> None:
    write_json_atomic(path, ledger)
