#!/usr/bin/env python3
"""tests/play/measure_say_name.py -- NR-05 (docs/kernel-rpc.md §188.5): how the Keeper handles an untold book person's name.

READ-ONLY. Nothing here calls a model or the network, and nothing under the data roots is written, moved or deleted
(evidence is never modified, Agents.md). The report is docs/specs/names-say-name-measurement.md.

Question (docs/specs/names-in-the-request-rename.md, problem 6): when the fiction has an untold book person's name said,
does the Keeper (1) copy that person's `say_name` (`{{name:<word>}}`, which the kernel replaces with the book's name,
§103.8 / §176.5 / §176.8), (2) write another name of its own (「叫我罗伊」 for the book's Robert Taylor), or (3) deflect
(「叫我老板就行」)? No product change follows from the numbers (§188.5).

What it reads
  * Campaign turn records, `<.coc>/campaigns/<id>/turns/NNNN.json` (+ `campaign.json`, `world.json`, `epithets.json`,
    `telemetry.jsonl`): the App home, every `~/leehow/code/*/.coc/campaigns`, and the acceptance home. A record holds the
    player's text, the delivered text, the speech rows (`speech[]`, from the Keeper's say tokens), the `person` receipts
    (what `apply person` set) and the capsule the Keeper was given (`capsule.present[].untold`: handle, table word,
    `say_name` when the kernel offered it). It does NOT keep the Keeper's raw text after the kernel put the book's name
    where a `{{name:}}` token stood, nor its tool arguments. The Keeper model of a record is the modal
    `provider-request` row of `telemetry.jsonl` for that turn.
  * Driver runs, `<root>/playtests/<run>/turn-N.json` (+ `driver.log` for the model, `final.json` for the campaign): the
    Keeper's tool calls with their arguments, so a `{{name:...}}` token is visible there and nowhere else. A delivery
    carried by `apply` (narrate in apply) is read the same way.
  * The book's module graph (`<.coc>/modules/<id>/generations/generation-<n>-*/module-graph.json`) for the names a book
    gives a person (name, aliases) and `world.json` `node_handles` / `table_people` for handles and walk-ons.

Unit of observation: one turn of one table times one person. A driver turn is linked to the campaign record it produced
(same player text and same delivered text: counted once, from the driver's richer view), or, failing that, borrows the
capsule of the record with the same player text (a replay of that campaign: group `r`, the tableau-closer sequences). A
campaign record no driver run produced is a unit of its own (the App tables).

A person has a hidden name at a turn when any of: the capsule of that turn lists them with an `untold` block; the next
turn's capsule does; or no earlier delivered text of the table shows the book's name or display name for them (the
kernel's own told rule, journal/naming.ts `toldTurn`, read from the records).

What it decides mechanically (strings the kernel holds; no word list, no classifier of meaning). One primary class per
row, in this order; the other signals stay on the row.
  AI   1 copied say_name        the raw text carries `{{name:W}}` and W is the person's table word, handle, epithet, or the
                                one graph person whose name the delivery shows although the raw text never wrote it.
  BB   2 book name, no token    the delivered text writes a full name or alias the book gives the person and the raw text
                                has no token for them (BBp: only a piece of it, split on punctuation: 罗伯特 of
                                罗伯特·泰勒; a piece may be a place or shop name as well). A name the player's own text
                                writes, or the investigator's, is not counted.
  BN   1|2 name delivered       the same, for a record whose raw text was not kept: a copied token and a literal name
                                cannot be told apart (BNp: a piece).
  BI   2 table word             a `person` effect put a word on the person that is neither the table word the capsule
                                showed, the handle, the epithet, nor a name of the book for them, AND the person says that
                                word in their own line (「叫我罗伊就行」). A word the person never says (a re-stated
                                epithet) is no name event; the row is not made. Whether the word is a personal name or a
                                title (老板) is a reading question.
  J    needs judgment           a hidden-name book person speaks (a say line) and nothing above fired. The player may have
                                asked the name and been deflected, asked something else, or the person may have said a
                                name of the Keeper's own inside the line; only prose semantics would tell.
Deflection (3) and "the name was asked at all" are never decided here. `--hand-read` merges the labels the author of the
report wrote after reading every J, BI and BN row (`HAND_READ` below); the default output is mechanical only.

Eras, from the shape of the kernel's own `untold` block in the capsule, not from dates:
  E0 no `id` in the block (before §103.5): the Keeper still saw the book's name; excluded from the class counts.
  E1 `id` and no `say_name` (§103.5/§103.8 .. before §176.8): the name is hidden; the token is instructed, not offered.
  E2 `say_name` in the block (§176.8): the Keeper is handed the token to copy.
  T  no capsule to read, but the raw text carries a `{{name:}}` token (a token exists only after §103.8).
  E? no untold block within eight turns: no evidence the name was hidden; excluded.
A trailing `r` marks replays (a driver turn that borrowed a campaign's capsule).

Limits (the report has the numbers): a delivery with no say token hides who spoke (the script cannot see an invented name
in such a prose); a person who is introduced and named in the same turn, and never in a capsule, is missed; a record
without raw text cannot tell a copied token from a literal name; models come from telemetry / the spawn line, and a
campaign resumed on another model is read turn by turn only where telemetry has the row.

Usage:
    uv run --frozen python tests/play/measure_say_name.py [--hand-read] [--json out.json] [--limit-examples N]
        [--app-campaigns DIR] [--code-root DIR] [--acceptance-home DIR]

Only the standard library is used. Output is deterministic for the same data.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

HOME = Path.home()
DEFAULT_APP_CAMPAIGNS = HOME / "Library/Application Support/Pipi/pipicoc/pi-coc/.coc/campaigns"
DEFAULT_CODE_ROOT = HOME / "leehow/code"
DEFAULT_ACCEPTANCE_HOME = DEFAULT_CODE_ROOT / "chatrpgv4-nfh-acceptance-home"

TOKEN = re.compile(r"\{\{(name|say):([^{}\n]{1,80})\}\}")
ERA_ORDER = ["E0", "E1", "E1r", "E2", "E2r", "T", "Tr", "E?", "E?r", "E0r"]
SCOPE_ERAS = ("E1", "E2", "T")
CLASS_LABEL = {
    "AI": "1 copied say_name ({{name:W}} in the raw text)",
    "BI": "2 a word a person effect put on them, said in their own line (a name or a title: read it)",
    "BB": "2 a full book name written, no token (raw text seen)",
    "BBp": "2 a piece of a book name written, no token (raw text seen; may be a place or shop that shares it)",
    "BN": "1|2 a full book name delivered, raw text not kept (token or literal)",
    "BNp": "1|2 a piece of a book name delivered, raw text not kept",
    "J": "needs judgment (a hidden-name book person speaks, nothing mechanical fired)",
}
CLASS_ORDER = ["AI", "BI", "BB", "BBp", "BN", "BNp", "J"]


# --------------------------------------------------------------------------------------------------------------------
# strings the kernel holds (kernel-ts/read/values.ts normalize, journal/naming.ts occurs / namePieces)

def norm(value: Any) -> str:
    """NFKC, lower-cased, separators collapsed (the kernel's `normalize`, minus its accent folding)."""
    return re.sub(r"[\s_\-]+", " ", unicodedata.normalize("NFKC", value if isinstance(value, str) else "").lower()).strip()


def occurs(text: str, key: str) -> bool:
    """Exact match; a Latin/digit run must not continue past either end (naming.ts `occurs`)."""
    if not key:
        return False
    latin = lambda ch: bool(ch) and bool(re.fullmatch(r"[a-z0-9]", ch))
    start = 0
    while start <= len(text):
        at = text.find(key, start)
        if at < 0:
            return False
        before = text[at - 1] if at > 0 else ""
        after = text[at + len(key)] if at + len(key) < len(text) else ""
        if not (latin(key[0]) and latin(before)) and not (latin(key[-1]) and latin(after)):
            return True
        start = at + 1
    return False


def pieces_of(names: Iterable[str]) -> list[str]:
    """A name's own pieces where it separates them with punctuation; a piece of one character is no name."""
    out: list[str] = []
    for name in names:
        part = ""
        for ch in name:
            if unicodedata.category(ch).startswith("P"):
                out.append(part)
                part = ""
            else:
                part += ch
        out.append(part)
    return sorted({p.strip() for p in out if len(p.strip()) >= 2} - set(names))


def strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from strings(v)


def jload(path: Path) -> Any:
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def sha(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------------------------------------------------
# campaigns

class Campaign:
    """One campaign directory: its book's graph, its handles, its records (reduced) and its Keeper models by turn."""

    def __init__(self, path: Path):
        self.path = path
        self.id = path.name
        self.home = path.parent.parent  # <.coc>
        meta = jload(path / "campaign.json") or {}
        self.module_id = meta.get("module_id") or ""
        self.generation = meta.get("module_generation")
        world = jload(path / "world.json") or {}
        self.node_handles: dict[str, str] = {}
        for node_id, value in (world.get("node_handles") or {}).items():
            handle = value.get("handle") if isinstance(value, dict) else value
            if isinstance(handle, str):
                self.node_handles[node_id] = handle
        self.table_made = {p.get("name") for p in world.get("table_people") or [] if isinstance(p, dict)}
        # this table's word for each graph person (epithets.json, contract §176.1): the word the Keeper is shown and writes
        self.epithet: dict[str, str] = {h: v["word"] for h, v in ((jload(path / "epithets.json") or {}).get("people") or {}).items()
                                       if isinstance(v, dict) and isinstance(v.get("word"), str)}
        self._graph: dict[str, dict] | None = None
        self.records: dict[int, dict] = {}
        self._models: dict[int, Counter] | None = None

    # -- graph ------------------------------------------------------------------------------------------------------
    def graph(self) -> dict[str, dict]:
        """node_id -> {name, aliases} for the book's people; empty when the library book is not on disk."""
        if self._graph is not None:
            return self._graph
        nodes: dict[str, dict] = {}
        folder = self.home / "modules" / self.module_id / "generations"
        found = sorted(folder.glob(f"generation-{self.generation}-*")) if self.generation is not None else []
        if not found and folder.is_dir():
            found = sorted(folder.glob("generation-*"), key=lambda p: int(re.match(r"generation-(\d+)-", p.name).group(1)))[-1:]
        for gen in found[:1]:
            data = jload(gen / "module-graph.json") or {}
            for node in data.get("nodes") or []:
                if node.get("node_kind") == "npc":
                    nodes[node["node_id"]] = {"name": node.get("name") or "", "aliases": list(node.get("aliases") or [])}
        self._graph = nodes
        return nodes

    def handle_for(self, node_id: str) -> str:
        return self.node_handles.get(node_id) or (node_id[4:] if node_id.startswith("npc-") else node_id)

    def told_turn(self, node_id: str, extra: Iterable[str] = ()) -> int | None:
        """The first turn whose delivered text shows the book's name for the node (journal/naming.ts `toldTurn`: the node's
        name and display name, not its aliases, and only the delivered text)."""
        node = self.graph().get(node_id) or {}
        words = {norm(w) for w in [node.get("name") or "", *extra] if w}
        for turn in sorted(self.records):
            text = norm(self.records[turn]["rendered"])
            if any(occurs(text, w) for w in words if w):
                return turn
        return None

    def node_for(self, handle: str) -> str | None:
        """The graph node a handle names: through `world.node_handles`, then the legacy `npc-<handle>` spelling."""
        graph = self.graph()
        for node_id, h in self.node_handles.items():
            if h == handle and node_id in graph:
                return node_id
        for node_id in (handle, f"npc-{handle}"):
            if node_id in graph:
                return node_id
        return None

    # -- Keeper model by turn (telemetry provider-request rows) -------------------------------------------------------
    def model_of(self, turn: int) -> str:
        if self._models is None:
            self._models = defaultdict(Counter)
            try:
                with open(self.path / "telemetry.jsonl", encoding="utf-8") as handle:
                    for line in handle:
                        if '"provider-request"' not in line:
                            continue
                        try:
                            row = json.loads(line)
                        except ValueError:
                            continue
                        if row.get("lane") == "provider-request" and isinstance(row.get("turn"), int):
                            self._models[row["turn"]][f"{row.get('provider')}/{row.get('model')} {row.get('reasoning_effort') or '-'}"] += 1
            except OSError:
                pass
        counts = self._models.get(turn)
        return counts.most_common(1)[0][0] if counts else "unknown"


def reduce_record(d: dict) -> dict:
    """The small part of a turn record this measurement reads."""
    capsule = d.get("capsule") or {}
    untold = []
    for p in capsule.get("present") or []:
        if not isinstance(p, dict):
            continue
        u = p.get("untold")
        if isinstance(u, dict):
            untold.append({"id": u.get("id"), "label": u.get("label"), "book": p.get("name"), "say_name": "say_name" in u,
                           "block_keys": sorted(u.keys())})
    speech = []
    for s in d.get("speech") or []:
        who = s.get("who") or {}
        speech.append({"npc": who.get("npc"), "name": who.get("name"), "label": who.get("label"),
                       "investigator": who.get("investigator"), "text": s.get("text") or ""})
    effects = []
    for r in d.get("receipts") or []:
        if r.get("kind") == "person":
            effects.append({"who": r.get("who"), "name": r.get("label"), "book": r.get("name"), "ok": True, "source": "receipt"})
    investigators = [i.get("name") for i in (d.get("world") or {}).get("investigators") or [] if isinstance(i, dict)]
    investigators += [((capsule.get("known") or {}).get("investigator") or {}).get("name")]
    return {
        "turn": d.get("turn"), "ts": d.get("closed_at") or d.get("opened_at") or "", "player_text": d.get("player_text") or "",
        "text": d.get("text") or "", "rendered": d.get("rendered_text") or d.get("text") or "", "speech": speech,
        "effects": effects, "untold": untold,
        "investigators": sorted({n for n in investigators if isinstance(n, str) and n}),
    }


def load_campaigns(dirs: list[Path]) -> dict[str, list[Campaign]]:
    index: dict[str, list[Campaign]] = defaultdict(list)
    for base in dirs:
        if not base.is_dir():
            continue
        for path in sorted(base.iterdir()):
            if not (path / "turns").is_dir():
                continue
            campaign = Campaign(path)
            seen = set()
            for tf in sorted((path / "turns").glob("*.json")):
                d = jload(tf)
                if not isinstance(d, dict) or not isinstance(d.get("turn"), int):
                    continue
                rec = reduce_record(d)
                key = (d["turn"], sha(rec["player_text"] + rec["rendered"]))
                if key in seen:
                    continue
                seen.add(key)
                campaign.records[d["turn"]] = rec
            index[campaign.id].append(campaign)
    return index


def era_of(campaign: Campaign, turn: int) -> str:
    """The shape of the kernel's untold block at (or, failing one, nearest) this turn."""
    for delta in (0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8):
        rec = campaign.records.get(turn + delta)
        if rec and rec["untold"]:
            keys = set().union(*(set(u["block_keys"]) for u in rec["untold"]))
            return "E2" if "say_name" in keys else "E1" if "id" in keys else "E0"
    return "E?"


# --------------------------------------------------------------------------------------------------------------------
# units

def driver_model(run: Path) -> tuple[str, str]:
    """(model label, campaign id) from the run's own spawn line."""
    model, camp = "unknown", ""
    try:
        with open(run / "driver.log", encoding="utf-8") as handle:
            for line in handle:
                if " spawning " in line:
                    provider = re.search(r"--provider (\S+)", line)
                    name = re.search(r"--model (\S+)", line)
                    think = re.search(r"--thinking (\S+)", line)
                    c = re.search(r"--campaign (\S+)", line)
                    if name:
                        model = f"{provider.group(1) + '/' if provider else ''}{name.group(1)} {think.group(1) if think else '-'}"
                    camp = c.group(1) if c else ""
                    break
    except OSError:
        pass
    final = jload(run / "final.json") or {}
    return model, final.get("campaign") or camp


def json_field(text: str, key: str) -> Any:
    """The value of `"key":<json>` inside a tool result, which the driver may have cut off; None when absent or cut."""
    at = text.find(f'"{key}":')
    if at < 0:
        return None
    try:
        return json.JSONDecoder().raw_decode(text[at + len(key) + 3:].lstrip())[0]
    except ValueError:
        return None


def speech_row(s: dict) -> dict:
    who = s.get("who") or {}
    return {"npc": who.get("npc"), "name": who.get("name"), "label": who.get("label"), "investigator": who.get("investigator"),
            "text": s.get("text") or ""}


SPAN = re.compile(r"\{\{say:([^{}\n]{1,80})\}\}(.*?)(?=\{\{/say\}\}|\{\{say:|\n\s*\n|$)", re.S)


def say_spans(texts: Iterable[str]) -> list[tuple[str, str]]:
    """(word the Keeper wrote in the token, the spoken words) for every say span of the raw text."""
    return [(m.group(1).strip(), m.group(2).strip()) for t in texts for m in SPAN.finditer(t)]


def driver_unit(run: Path, idx: int, d: dict, model: str, camp_id: str, ts: str) -> dict:
    raw, effects, speech, attempts = [], [], [], []
    delivery = d.get("delivery")
    delivered = d.get("final_text") or (delivery.get("rendered_text") if isinstance(delivery, dict) else delivery) or ""
    if not isinstance(delivered, str) or (isinstance(delivery, dict) and delivery.get("kind") == "notice"):
        delivered = ""   # a host notice ("this turn ended without a delivered result") is not the Keeper's text
    kturn, any_say_name = None, False
    for call in d.get("tools") or []:
        args, ok = call.get("args") or {}, not call.get("is_error")
        result = call.get("result_text") or ""
        any_say_name = any_say_name or "say_name" in result
        if ok:
            raw += [s for s in strings(args) if "{{" in s]
        if call.get("name") == "apply":
            for e in args.get("effects") or []:
                if isinstance(e, dict) and e.get("kind") == "person":
                    row = {"who": e.get("who"), "name": e.get("name"), "ok": ok, "source": "apply"}
                    (effects if ok else attempts).append(row)
        if ok and '"rendered_text"' in result:
            # a delivery: `narrate`, `ask`, or an `apply` that carries the narrate; the driver may have cut the result off
            try:
                body = json.loads(result)
            except ValueError:
                body = {"speech": json_field(result, "speech"), "turn": json_field(result, "turn"), "rendered_text": json_field(result, "rendered_text")}
            if isinstance(body, dict):
                if isinstance(body.get("turn"), int):
                    kturn = body["turn"]
                speech += [speech_row(s) for s in body.get("speech") or [] if isinstance(s, dict)]
                if isinstance(body.get("rendered_text"), str):
                    delivered = body["rendered_text"]
    return {"kind": "driver", "table": run.name, "campaign_id": camp_id, "turn": idx, "kturn": kturn, "ts": ts, "model": model,
            "player_text": d.get("player_text") or "", "raw": raw, "delivered": delivered, "speech": speech, "effects": effects,
            "attempts": attempts, "say_name_in_results": any_say_name, "has_raw": True}


def find_record(index: dict[str, list[Campaign]], cid: str, unit: dict) -> tuple[Campaign | None, dict | None, bool]:
    """(campaign, record, same): the record whose delivered text equals the unit's (the unit produced it), else the one
    with the same player text (a replay borrows its capsule), else nothing."""
    options = index.get(cid) or []
    rendered = unit["delivered"].strip()
    for campaign in options:
        for turn in sorted(campaign.records):
            rec = campaign.records[turn]
            if rendered and rec["rendered"].strip() == rendered and rec["player_text"] == unit["player_text"]:
                return campaign, rec, True
    for campaign in options:
        for turn in sorted(campaign.records):
            if unit["player_text"] and campaign.records[turn]["player_text"] == unit["player_text"]:
                return campaign, campaign.records[turn], False
    return None, None, False


# --------------------------------------------------------------------------------------------------------------------
# rows

class Person:
    """What the capsule, the graph and the unit's own effects say about one person this turn."""

    def __init__(self, handle: str, campaign: Campaign | None):
        self.handle = handle
        self.node = campaign.node_for(handle) if campaign else None
        node = (campaign.graph().get(self.node or "") if campaign else None) or {}
        self.names: set[str] = ({node["name"], *node["aliases"]} if node else set())
        self.keys: set[str] = {handle}
        self.shown: str | None = None
        self.book: str | None = None
        self.untold_start = False
        self.untold_next = False
        self.untold_by_text = False
        self.table_made = bool(campaign and handle in campaign.table_made)
        self.words: list[str] = []      # words a landed person effect put on them
        self.refused: list[str] = []    # words a refused person effect tried
        self.spoken: list[str] = []

    def knows(self, word: str) -> bool:
        w = norm(word)
        return bool(w) and (w in {norm(k) for k in self.keys} or w in {norm(n) for n in self.names})


def build_people(unit: dict, campaign: Campaign | None, rec: dict | None, nxt: dict | None) -> dict[str, Person]:
    people: dict[str, Person] = {}
    turn = (rec or {}).get("turn")

    def get(handle: str) -> Person:
        if handle not in people:
            people[handle] = Person(handle, campaign)
        return people[handle]

    def find(word: str) -> Person | None:
        found = next((p for p in people.values() if p.knows(word)), None)
        if found is None and campaign is not None:
            # a word that is some person's table word (epithets.json) names that person even when the capsule did not list them
            handle = next((h for h, w in campaign.epithet.items() if norm(w) == norm(word)), None)
            if handle:
                found = get(handle)
        return found

    for u in (rec or {}).get("untold") or []:
        if u["id"]:
            p = get(u["id"])
            p.shown, p.untold_start, p.book = u["label"], True, u["book"]
            p.names.add(u["book"] or "")
            p.keys.add(u["label"] or "")
            if campaign is not None and u["id"] in campaign.epithet:
                p.keys.add(campaign.epithet[u["id"]])
    for u in (nxt or {}).get("untold") or []:
        if u["id"]:
            get(u["id"]).untold_next = True
    for e in unit["effects"] + unit["attempts"]:
        who = e["who"]
        if not who:
            continue
        p = find(who) or get(who)
        if e.get("book"):
            p.names.add(e["book"])
            p.book = p.book or e["book"]
        word = e.get("name")
        if word and not p.knows(word):
            (p.words if e["ok"] else p.refused).append(word)
    for p in people.values():
        p.keys |= set(p.words)
    investigators = {norm(n) for n in (rec or {}).get("investigators") or []}
    # speakers: the raw say spans (the word the Keeper wrote) matched to speech rows (the handle the kernel resolved)
    rows = [dict(r) for r in unit["speech"] if not r.get("investigator")]
    spans = say_spans(unit["raw"]) if unit["raw"] else []
    heard: list[tuple[str | None, str, str]] = []
    for word, text in spans:
        if norm(word) in investigators:
            continue
        # the span still holds a `{{name:}}` token where the row holds the name put in: compare the ends, not the middle
        plain = TOKEN.sub("", text)
        match = next((r for r in rows if r["text"] and (r["text"][:8] in plain or plain[:8] in r["text"]
                                                         or r["text"][-8:] in plain or plain[-8:] in r["text"])), None)
        if match:
            rows.remove(match)
        heard.append((match["npc"] if match else None, word, text))
    heard += [(r["npc"], r["label"] or r["name"] or "", r["text"]) for r in rows]
    for npc, word, text in heard:
        p = get(npc) if npc else (find(word) or get(f"label:{word}"))
        if not npc and p.handle.startswith("label:"):
            p.table_made = True
        p.spoken.append(text)
    # a token word no capsule row, epithet or effect explains: it named the one graph person whose full name the delivery
    # shows although the raw text never wrote it (the kernel put the book's name where the token stood)
    raw_all = norm(" ".join(unit["raw"]))
    delivered = norm(unit["delivered"])
    for kind, word in [(m.group(1), m.group(2).strip()) for s in unit["raw"] for m in TOKEN.finditer(s)]:
        if kind != "name" or find(word) is not None or campaign is None:
            continue
        named = [n for n, node in campaign.graph().items() if node["name"] and occurs(delivered, norm(node["name"]))
                 and not occurs(raw_all, norm(node["name"]))
                 and not any(occurs(norm(i), norm(node["name"])) for i in (rec or {}).get("investigators") or [])]
        if len(named) == 1:
            get(campaign.handle_for(named[0])).keys.add(word)
    # the kernel's own told rule, read from the table's delivered texts: a person whose name no earlier delivery showed is untold
    if campaign is not None and isinstance(turn, int):
        for p in people.values():
            if p.node:
                told = campaign.told_turn(p.node, [p.book or ""])
                p.untold_by_text = told is None or told >= turn
    for p in people.values():
        p.names.discard("")
        p.keys.discard("")
    return people


def classify_unit(unit: dict, campaign: Campaign | None, rec: dict | None, nxt: dict | None, era: str, same: bool) -> list[dict]:
    people = build_people(unit, campaign, rec, nxt)
    raw_tokens = [(m.group(1), m.group(2).strip()) for s in unit["raw"] for m in TOKEN.finditer(s)]
    for kind, word in raw_tokens:
        if kind == "name" and not any(p.knows(word) for p in people.values()):
            people[f"label:{word}"] = Person(f"label:{word}", campaign)
            people[f"label:{word}"].keys.add(word)
    # a name of the investigator is not the book person's: take it out before looking for the person's names
    scrubbed = norm(unit["delivered"])
    for name in sorted({norm(n) for n in (rec or {}).get("investigators") or [] if n}, key=len, reverse=True):
        scrubbed = scrubbed.replace(name, " ")
    player = norm(unit["player_text"])
    rows = []
    for p in sorted(people.values(), key=lambda q: q.handle):
        names = sorted(n for n in p.names if len(n) >= 2)
        # a name the player's own text writes is the player's, echoed: it says nothing about what the Keeper wrote
        full = [n for n in names if occurs(scrubbed, norm(n)) and not occurs(player, norm(n))]
        pieces = [x for x in pieces_of(names) if occurs(scrubbed, norm(x)) and not occurs(player, norm(x)) and not any(x in f for f in full)]
        token = [w for kind, w in raw_tokens if kind == "name" and p.knows(w)]
        hidden = p.untold_start or p.untold_next or p.untold_by_text
        # a word a person effect put on them that the person says in their own line (a name or a title, to be read)
        said = [w for w in p.words if norm(w) in norm(" ".join(p.spoken))]
        if p.table_made and not (token or said):
            continue
        if not (token or full or pieces or said or (hidden and not p.table_made and p.spoken)):
            continue
        if not (token or hidden or p.table_made):
            continue
        # one primary class per row, in this order; the other signals stay on the row as flags
        if token:
            cls = "AI"
        elif full:
            cls = "BB" if unit["has_raw"] else "BN"
        elif pieces:
            cls = "BBp" if unit["has_raw"] else "BNp"
        elif said:
            cls = "BI"
        else:
            cls = "J"
        rows.append({
            "id": f"{unit['table']}#{unit['turn']}#{p.handle}", "table": unit["table"], "kind": unit["kind"], "turn": unit["turn"],
            "kturn": unit.get("kturn"), "ts": unit["ts"], "model": unit["model"], "era": era, "handle": p.handle, "shown": p.shown,
            "book": p.book, "node": p.node, "table_made": p.table_made,
            "hidden_by": "capsule" if p.untold_start else "next-capsule" if p.untold_next else "delivered-text" if p.untold_by_text else "token-only",
            "class": cls, "tokens": [w for k, w in raw_tokens if k == "name" and p.knows(w)], "new_words": p.words,
            "refused_words": p.refused, "book_hits": full, "piece_hits": pieces, "player_text": unit["player_text"],
            "line": " / ".join(p.spoken)[:240], "same_record": same,
        })
    return rows


# --------------------------------------------------------------------------------------------------------------------
# hand-read labels
#
# The reader's (the worker's, 2026-10-07) reading of the rows the classifier cannot decide: the J rows (does the player ask
# this person's name, and what does the person answer?) and the BI / BN rows (was the name asked at all?). The classifier
# never reads this table; `--hand-read` merges it into the tables, and the default output ignores it. A row that is not
# listed below was read and is not a name ask (`no-ask`); a token row (AI) is always an ask in this data and is read as
# `ask-copied`. Row key: `<table>#<turn>#<handle>` (the turn is the driver turn, or the record turn for a campaign).
#
#   ask-copied           the name was asked and the Keeper copied the offered token
#   ask-invented         asked, and the person gives a name the book does not give them (厄尔, 罗伊, 卡尔 ...)
#   ask-book-name        asked, and the person gives the book's own name (full, alias or a piece), no token visible
#   ask-deflected        asked, and the person answers with a title, a nickname or no name (「叫我老板就行」)
#   ask-third-party      the player asked about another person's name; this speaker is not the one asked
#   invented-unasked     a name of the Keeper's own, given without being asked
#   book-name-unasked    the book's name for them written without being asked (narration, not an answer)
#   no-ask               not a name ask (default for an unlisted J / BI / BN row)
_D, _I, _B = "ask-deflected", "ask-invented", "ask-book-name"
_APP = {"24bb66cb": "game-24bb66cb-df6e-4ebb-a0c8-aa22b59e7eb7", "33170a20": "game-33170a20-b06f-4e06-b488-d5182d62c22c",
        "45cd3976": "game-45cd3976-d028-4c94-a6ed-c2326527f727", "7e9db15c": "game-7e9db15c-adb6-4d71-ac38-194c80623394",
        "8e41c325": "game-8e41c325-5c5c-420e-bae8-0c2f7c7a167c", "91d04b3a": "game-91d04b3a-fad7-4f7b-b516-492102e8eab6",
        "d78dd9ec": "game-d78dd9ec-137f-49a1-85fe-1dda74e292ae", "e8e9249b": "game-e8e9249b-ad9b-453f-8223-b4ae53b46340",
        "f4d8e72b": "game-f4d8e72b-1f59-49a6-8ff7-f57abeef7eb5"}
_RT, _LW, _NP = "book-4-robert-taylor", "book-4-lars-williams", "book-4-nate-patterson"
HAND_READ: dict[str, tuple[str, str]] = {
    f"{_APP['24bb66cb']}#3#{_LW}": (_B, "「拉塞尔·威廉姆斯，先生」"),
    f"{_APP['24bb66cb']}#7#{_RT}": (_B, "「罗伯特就行」: the book's first name"),
    f"{_APP['24bb66cb']}#8#{_RT}": ("ask-third-party", "asked another man's name; 「真名我还真叫不上来」"),
    f"{_APP['33170a20']}#3#{_RT}": (_B, "「我叫罗伯特·泰勒」"),
    f"{_APP['33170a20']}#8#{_NP}": (_I, "「叫我厄尔就行」"),
    f"{_APP['45cd3976']}#3#{_RT}": (_B, "「这儿都叫我罗伯特·泰勒」"),
    f"{_APP['45cd3976']}#8#{_NP}": (_I, "「叫我厄尔就行」"),
    f"{_APP['7e9db15c']}#3#{_RT}": (_D, "「叫我老板就行」"),
    f"{_APP['7e9db15c']}#4#{_RT}": (_D, "「真名没人用」; the player had offered his own name"),
    f"{_APP['7e9db15c']}#6#{_NP}": (_D, "「真名？…叫老卡也行」"),
    f"{_APP['8e41c325']}#5#{_RT}": (_B, "「叫我罗伯特就行」: the book's first name"),
    f"{_APP['8e41c325']}#7#{_RT}": ("book-name-unasked", "the book's first name in the narration, not asked"),
    f"{_APP['91d04b3a']}#2#{_LW}": ("book-name-unasked", "the book's first name in the narration, not asked"),
    f"{_APP['d78dd9ec']}#3#{_RT}": (_D, "「叫我老板就行」"),
    f"{_APP['d78dd9ec']}#4#{_RT}": (_D, "「镇上的人都喊我老板」"),
    f"{_APP['d78dd9ec']}#7#{_NP}": (_I, "「叫我老乔就行」"),
    f"{_APP['e8e9249b']}#5#{_LW}": (_B, "「拉斯。拉塞尔也行」: an alias and the first name of the book"),
    f"{_APP['f4d8e72b']}#3#{_LW}": (_B, "「拉尔斯·威廉姆斯」: the book's surname, a first name of its own"),
    "nfh-accept-blood-road-1-play-1#2#sun-darkened-station-owner": (_D, "「叫我老板就行」"),
    "nfh-accept-blood-road-1-play-1#4#retired-sailor-dog-owner": (_D, "「叫我老兵就行」"),
    "nfh-accept-blood-road-1-play-1#13#pencil-mustache-bar-owner": (_D, "「叫我老板就行」"),
    "nfh-accept-blood-road-1-play-2#3#bearded-fast-food-cook": (_I, "「我叫马丁」, in prose only: no person effect, no token"),
    "nfh-accept-blood-road-1-play-2#5#pencil-mustache-bar-owner": (_I, "「叫我罗伊就行」, with `apply person`"),
    "nfh-accept-blood-road-1-play-2#7#柜台后的秃顶男人": (_I, "「叫卡尔」, for a person with no book node"),
    "rc-accept-blood-01-play#13#加油站老板": (_I, "「叫我埃德」, for a walk-on the kernel holds as table-made"),
    "tc-A1-20261004#2#book-4-lars-williams": (_B, "「威廉姆斯」: a piece of the book's name, learned from a source lookup"),
    "tc-A1-20261004#4#book-4-steve-brown": (_D, "「人叫我老兵就行」"),
    "tc-A2-20261004#4#book-4-steve-brown": (_I, "「叫我厄尔就行」, with `apply person`"),
    "tc-B1-20261004#2#book-4-lars-williams": (_B, "「威廉姆斯」: a piece of the book's name"),
    "tc-B1-20261004#4#book-4-steve-brown": (_I, "「叫我哈珀就行」, in prose only"),
    "tc-B2-20261004#4#book-4-steve-brown": (_I, "「人叫我沃尔特就行」, in prose only"),
    "tc-B2-20261004#7#book-4-robert-taylor": ("invented-unasked", "「罗伯特？我是埃德」: answers the player's 罗伯特 with a name of its own"),
    "tc-C1-20261004#2#book-4-lars-williams": (_B, "「拉斯」: an alias of the book"),
    "tc-C1-20261004#4#book-4-steve-brown": (_D, "「外头的人多半就叫我老头」"),
    "tc-C2-20261004#4#book-4-steve-brown": (_I, "「人叫我巴德就行」, in prose only"),
}


# --------------------------------------------------------------------------------------------------------------------
# main

def collect(args: argparse.Namespace) -> tuple[list[dict], dict]:
    code_root, acc = Path(args.code_root), Path(args.acceptance_home)
    campaign_dirs = [Path(args.app_campaigns)] + sorted(code_root.glob("*/.coc/campaigns"))
    if (acc / ".coc/campaigns").is_dir() and (acc / ".coc/campaigns") not in campaign_dirs:
        campaign_dirs.append(acc / ".coc/campaigns")
    index = load_campaigns(campaign_dirs)
    run_dirs = sorted(code_root.glob("*/.coc/playtests/*/")) + sorted((acc / "playtests").glob("*/"))
    stats: Counter = Counter()
    rows: list[dict] = []
    produced: set[tuple[str, str]] = set()
    seen_turns: dict[str, Counter] = defaultdict(Counter)   # per table: turns, turns with no delivery, deliveries with no say marker

    def watch(unit: dict) -> None:
        c = seen_turns[unit["table"]]
        c["turns"] += 1
        if not unit["delivered"].strip():
            c["undelivered"] += 1
        elif not unit["speech"] and not say_spans(unit["raw"]):
            c["no_say_marker"] += 1

    for run in run_dirs:
        turn_files = sorted(run.glob("turn-*.json"), key=lambda p: int(re.search(r"turn-(\d+)", p.name).group(1)))
        if not turn_files:
            continue
        model, camp_id = driver_model(run)
        stats["driver_runs"] += 1
        for tf in turn_files:
            d = jload(tf)
            if not isinstance(d, dict):
                continue
            idx = int(re.search(r"turn-(\d+)", tf.name).group(1))
            unit = driver_unit(run, idx, d, model, camp_id, d.get("ended_at") or d.get("started_at") or "")
            stats["driver_turns"] += 1
            campaign, rec, same = find_record(index, camp_id, unit)
            if rec and same:
                produced.add((campaign.id, sha(rec["player_text"] + rec["rendered"])))
                unit["kturn"] = rec["turn"]
            nxt = campaign.records.get(rec["turn"] + 1) if campaign and rec else None
            era = era_of(campaign, rec["turn"]) if campaign and rec else "E?"
            if unit["say_name_in_results"] and era in ("E?", "E1"):
                era = "E2"
            if era == "E?" and any(m.group(1) == "name" for t in unit["raw"] for m in TOKEN.finditer(t)):
                era = "T"
            watch(unit)
            for r in classify_unit(unit, campaign, rec, nxt, era, same):
                r["linked"] = "same-record" if same else ("replay-capsule" if rec else "none")
                rows.append(r)
    # campaign records no driver run produced (App tables, hand-played tables)
    for cid in sorted(index):
        for campaign in index[cid]:
            for turn in sorted(campaign.records):
                rec = campaign.records[turn]
                if (campaign.id, sha(rec["player_text"] + rec["rendered"])) in produced:
                    continue
                stats["record_turns"] += 1
                unit = {"kind": "campaign", "table": campaign.id, "turn": turn, "kturn": turn, "ts": rec["ts"],
                        "model": campaign.model_of(turn), "player_text": rec["player_text"], "raw": [],
                        "delivered": rec["rendered"], "speech": rec["speech"], "effects": rec["effects"], "attempts": [],
                        "say_name_in_results": False, "has_raw": False}
                watch(unit)
                for r in classify_unit(unit, campaign, rec, campaign.records.get(turn + 1), era_of(campaign, turn), True):
                    r["linked"] = "record"
                    rows.append(r)
    # one observation per (table, turn, person): a duplicated campaign directory is counted once
    seen, unique = set(), []
    for r in sorted(rows, key=lambda r: (r["table"], str(r["ts"]), r["turn"], r["handle"])):
        key = (r["table"], r["turn"], r["handle"], r["class"], r["line"])
        if key in seen:
            stats["duplicate_rows"] += 1
            continue
        seen.add(key)
        unique.append(r)
    for r in unique:
        # a driver turn that borrowed another campaign's capsule replays that campaign (the tableau-closer sequences)
        r["group"] = r["era"] + ("r" if r["linked"] == "replay-capsule" else "")
    stats = dict(stats)
    stats["observed"] = {table: dict(c) for table, c in seen_turns.items()}
    return unique, stats


def clip(text: str, n: int) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= n else text[: n - 1] + "…"


ASK_LABELS = ["ask-copied", "ask-invented", "ask-book-name", "ask-deflected"]
OTHER_LABELS = ["ask-third-party", "invented-unasked", "book-name-unasked", "no-ask"]


def table_md(P, head: list[str], body: list[list[Any]]) -> None:
    P("| " + " | ".join(head) + " |")
    P("|" + "---|" * len(head))
    for line in body:
        P("| " + " | ".join(str(c) for c in line) + " |")


def render(rows: list[dict], stats: dict, args: argparse.Namespace) -> str:
    out: list[str] = []
    P = out.append
    hand = HAND_READ if args.hand_read else {}
    scope = [r for r in rows if r["era"] in SCOPE_ERAS]

    def label(r: dict) -> str:
        if r["id"] in hand:
            return hand[r["id"]][0]
        return "ask-copied" if r["class"] == "AI" else "no-ask"

    P("## Scope")
    P(f"- driver runs read: {stats.get('driver_runs', 0)}; driver turns: {stats.get('driver_turns', 0)}; "
      f"campaign records no driver run produced: {stats.get('record_turns', 0)}")
    P(f"- rows (turn x hidden-name book person with a name event, or a say line): {len(rows)}; duplicates dropped: {stats.get('duplicate_rows', 0)}")
    by_era = Counter(r["group"] for r in rows)
    P("- rows by era: " + ", ".join(f"{e}={by_era.get(e, 0)}" for e in ERA_ORDER if by_era.get(e, 0))
      + "  (only E1, E2 and T are counted below: E0 = the Keeper still saw the book's name; E? = no hidden-name evidence near the turn)")
    P(f"- rows counted: {len(scope)} in {len({r['table'] for r in scope})} tables")
    P("")
    P("## Mechanical classes, E1+E2+T (the Keeper's request hid the name)")
    groups: dict[tuple, Counter] = defaultdict(Counter)
    for r in scope:
        groups[(r["table"], r["model"], r["group"])][r["class"]] += 1
    table_md(P, ["table", "model", "era", *CLASS_ORDER, "total"],
             [[k[0], k[1], k[2], *(c.get(x, 0) for x in CLASS_ORDER), sum(c.values())] for k, c in sorted(groups.items())])
    P("")
    P("### Per Keeper model")
    per_model: dict[str, Counter] = defaultdict(Counter)
    for r in scope:
        per_model[r["model"]][r["class"]] += 1
    total: Counter = Counter(r["class"] for r in scope)
    table_md(P, ["model", *CLASS_ORDER, "total"],
             [[m, *(c.get(x, 0) for x in CLASS_ORDER), sum(c.values())] for m, c in sorted(per_model.items())]
             + [["**all**", *(total.get(x, 0) for x in CLASS_ORDER), sum(total.values())]])
    P("")
    P("Legend: " + "; ".join(f"{k} = {v}" for k, v in CLASS_LABEL.items()))
    P("")
    P("### Per era (a trailing r: replays of a campaign's turns, not the campaign itself)")
    eras = [e for e in ERA_ORDER if any(r["group"] == e for r in rows)]
    table_md(P, ["era", *CLASS_ORDER, "total"],
             [[e, *(Counter(r["class"] for r in rows if r["group"] == e).get(x, 0) for x in CLASS_ORDER),
               sum(1 for r in rows if r["group"] == e)] for e in eras])
    P("")
    P("### What the script cannot see (turns of the counted tables)")
    seen = stats.get("observed", {})
    table_md(P, ["table", "turns", "no delivery", "delivery with no say marker"],
             [[t, seen.get(t, {}).get("turns", 0), seen.get(t, {}).get("undelivered", 0), seen.get(t, {}).get("no_say_marker", 0)]
              for t in sorted({r["table"] for r in scope})])
    P("")
    if args.hand_read:
        counted = Counter(label(r) for r in scope)
        P("## With the hand-read labels (the reader's judgment on J, BI and BN rows; NOT mechanical)")
        P("Asks are the rows labelled ask-*; the other labels are rows read and set aside.")
        P("")
        P("### Asks by era and model")
        eg: dict[tuple, Counter] = defaultdict(Counter)
        for r in scope:
            eg[(r["group"], r["model"])][label(r)] += 1
        body = []
        for (era, model), c in sorted(eg.items()):
            asks = sum(c.get(k, 0) for k in ASK_LABELS)
            if asks or any(c.get(k, 0) for k in OTHER_LABELS[:3]):
                body.append([era, model, *(c.get(k, 0) for k in ASK_LABELS), asks, *(c.get(k, 0) for k in OTHER_LABELS[:3])])
        asks_all = sum(counted.get(k, 0) for k in ASK_LABELS)
        body.append(["**all**", "", *(counted.get(k, 0) for k in ASK_LABELS), asks_all, *(counted.get(k, 0) for k in OTHER_LABELS[:3])])
        table_md(P, ["era", "model", *ASK_LABELS, "asks", *OTHER_LABELS[:3]], body)
        P("")
        P("### Asks per table")
        tg: dict[tuple, Counter] = defaultdict(Counter)
        for r in scope:
            tg[(r["table"], r["model"], r["group"])][label(r)] += 1
        body = []
        for (table, model, era), c in sorted(tg.items()):
            asks = sum(c.get(k, 0) for k in ASK_LABELS)
            if asks:
                body.append([table, model, era, *(c.get(k, 0) for k in ASK_LABELS), asks])
        table_md(P, ["table", "model", "era", *ASK_LABELS, "asks"], body)
        P("")
        P("### Share of asks")
        for era in ("E1", "E1r", "E2"):
            c = Counter(label(r) for r in scope if r["group"] == era)
            n = sum(c.get(k, 0) for k in ASK_LABELS)
            if n:
                P(f"- {era}: {n} asks: " + ", ".join(f"{k[4:]} {c.get(k, 0)} ({100 * c.get(k, 0) / n:.0f}%)" for k in ASK_LABELS))
        P("")
        P("### Examples by reading (one line each; the quote is the reader's note)")
        for k in ASK_LABELS:
            P(f"#### {k}")
            shown = 0
            for r in scope:
                if label(r) == k and shown < args.limit_examples:
                    note = hand[r["id"]][1] if r["id"] in hand else f"token {r['tokens']} {clip(r['line'], 60)}".strip()
                    P(f"- {r['id']} [{r['model']}, {r['group']}] {note}")
                    shown += 1
        P("")
    P("## Examples by mechanical class (first rows in table/time order; the J rows are listed in full below)")
    for cls in CLASS_ORDER[:-1]:
        P(f"### {cls} {CLASS_LABEL[cls]}")
        shown = 0
        for r in scope:
            if r["class"] != cls or shown >= args.limit_examples:
                continue
            extra = (f"token {r['tokens']}" if cls == "AI" else f"words {r['new_words']}" if cls == "BI"
                     else f"hits {r['book_hits'] or r['piece_hits']}")
            P(f"- {r['id']} [{r['model']}, {r['group']}] {extra} | player: {clip(r['player_text'], 50)} | line: {clip(r['line'], 70)}")
            shown += 1
        if not shown:
            P("- (none)")
    P("")
    P("## Needs judgment (J), E1/E2/T: a hidden-name book person speaks and nothing mechanical fired")
    for r in scope:
        if r["class"] != "J":
            continue
        tag = f" => {hand[r['id']][0]}: {hand[r['id']][1]}" if r["id"] in hand else (" => no-ask" if args.hand_read else "")
        P(f"- {r['id']} [{r['model']}, {r['group']}] player: {clip(r['player_text'], 90)} | line: {clip(r['line'], 90)}{tag}")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--app-campaigns", default=str(DEFAULT_APP_CAMPAIGNS))
    ap.add_argument("--code-root", default=str(DEFAULT_CODE_ROOT))
    ap.add_argument("--acceptance-home", default=str(DEFAULT_ACCEPTANCE_HOME))
    ap.add_argument("--hand-read", action="store_true", help="merge the HAND_READ labels into the tables")
    ap.add_argument("--json", help="also write every row to this path (outside the data roots)")
    ap.add_argument("--limit-examples", type=int, default=6)
    args = ap.parse_args(argv)
    rows, stats = collect(args)
    print(render(rows, stats, args))
    if args.json:
        Path(args.json).write_text(json.dumps(rows, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
