"""Contract §18 (#27): the keeper's bookkeeping effects and where they surface.

`apply flag` writes `world.flags`, read by the capsule's exit gates (`unlock_when.met`)
and `known.flags`. `apply note` records continuity debt in `notes.jsonl`, surfaced as
`obligations` of kind `note`. `apply ruling` records a table decision in `rulings.jsonl`,
anchored to rule identifiers only (a family, a decision name, a skill, graph entities),
and is replayed into `resolve` results and the capsule when those identifiers are equal.
Nothing here judges likeness: a ruling matches when every facet its anchor names is
equal to the facet at hand, never when two situations look alike.

Both ledgers are append-only; the current state of a note or ruling is its last row.
Everything the kernel writes here is English and keeper-only (§16.1); none of these
receipts reach the `mechanics` projection."""

from __future__ import annotations

from typing import Any, Callable

from .errors import RpcError, invalid_params
from .fileio import canonical_json, read_jsonl
from .module_graph import ModuleGraph
from .rules.graph import semantic_name
from .rules.skills import SkillResolver
from .store import Campaign, now_iso
from .text import ascii_slug, kebab, normalize

FLAG_VALUE_CHARS = 40
#: §18.1 / §18.3 capsule budgets for the two new projections.
KNOWN_FLAGS_BUDGET = 512
RULINGS_BUDGET = 1024
#: how many rulings either projection carries, newest first (§18.3)
RULINGS_LIMIT = 3
#: notes not tied to anyone present: the most recent this many (§18.2)
NOTES_RECENT = 3
NOTE_OPEN, NOTE_CLOSED = "open", "closed"
RULING_ACTIVE, RULING_SUPERSEDED = "active", "superseded"
RULING_SCOPES = ("campaign", "module", "scene")
ANCHOR_FIELDS = ("family", "decision", "skill", "entities")
#: a live session's kind -> the RuleGraph family a ruling anchors to
SESSION_FAMILY = {"combat": "combat", "chase": "chase", "sanity_bout": "sanity"}
KEEPER = "keeper"

Mint = Callable[[str], str]


def _why(effect: dict[str, Any]) -> str | None:
    why = effect.get("why")
    return why.strip() if isinstance(why, str) and why.strip() else None


def _receipt_id(prefix: str, name: str, turn_number: int, ordinal: int, mint: Mint) -> str:
    """`<prefix>:<ascii slug>-t<n>-c<k>`, or `<prefix>:t<n>-c<k>` when the name has no
    Latin slug (§16: ids are machine-face ASCII); the name itself rides in the receipt."""
    slug = ascii_slug(name)
    return mint(f"{prefix}:{slug}-t{turn_number}-c{ordinal}" if slug else f"{prefix}:t{turn_number}-c{ordinal}")


# ---- flags (§18.1) ------------------------------------------------------------------------

def flag_slug(name: Any) -> str:
    slug = kebab(name) if isinstance(name, str) else ""
    if not slug:
        raise invalid_params("flag name must be a non-empty string", fix="name the flag, e.g. ritual-stopped")
    return slug


#: The two words a string-typed tool schema can send for a boolean; a closed table.
FLAG_WORDS = {"true": True, "false": False}


def flag_value(value: Any) -> bool | str:
    """`value` omitted or true -> true; false -> false; the words "true"/"false" read as
    the booleans (a host tool schema may type `value` as a string); any other short
    string is kept as given."""
    if value is None or value is True:
        return True
    if value is False:
        return False
    if isinstance(value, str) and value.strip().lower() in FLAG_WORDS:
        return FLAG_WORDS[value.strip().lower()]
    if isinstance(value, str) and value.strip() and len(value.strip()) <= FLAG_VALUE_CHARS:
        return value.strip()
    raise invalid_params(f"flag value must be true, false or a string of at most {FLAG_VALUE_CHARS} characters",
                         details={"value": value})


def stage_flag(world: dict[str, Any], effect: dict[str, Any], turn_number: int, ordinal: int,
               call_id: str, mint: Mint) -> tuple[dict[str, Any], tuple[str, dict[str, Any]]]:
    """Write `world.flags[<slug>]`. The map keeps write order (a re-set flag moves to the
    end) so `known.flags` can list the most recent writes first."""
    slug = flag_slug(effect.get("name"))
    value = flag_value(effect.get("value"))
    flags = world.setdefault("flags", {})
    previous = flags.pop(slug, None)
    flags[slug] = value
    receipt = {"id": _receipt_id("flag", slug, turn_number, ordinal, mint), "kind": "flag", "call_id": call_id,
               "name": slug, "value": value, "previous": previous, "why": _why(effect), "visibility": KEEPER,
               "at": now_iso()}
    return receipt, ("flag-set", {"name": slug, "value": value, "previous": previous})


def known_flags(world: dict[str, Any]) -> list[dict[str, Any]]:
    """`known.flags`: every flag the world holds, most recently written first."""
    flags = world.get("flags") or {}
    return [{"name": str(name), "value": value} for name, value in reversed(list(flags.items()))]


# ---- ledgers ------------------------------------------------------------------------------

def _latest_by_name(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """The current row per normalized name, each carrying `seq` (its line number) so
    recency can be ordered after the fold."""
    latest: dict[str, dict[str, Any]] = {}
    for seq, row in enumerate(rows):
        key = normalize(str(row.get("name") or ""))
        if key:
            latest[key] = {**row, "seq": seq}
    return latest


def _newest_first(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda row: (-int(row.get("turn") or 0), -int(row.get("seq") or 0)))


def _ledger(campaign: Campaign, path: Any, staged: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """The ledger on disk with the rows this batch has staged (not yet appended) on top."""
    return _latest_by_name(read_jsonl(path) + list(staged))


def read_notes(campaign: Campaign, staged: list[dict[str, Any]] | None = None) -> dict[str, dict[str, Any]]:
    return _ledger(campaign, campaign.notes_path, staged or [])


def open_notes(campaign: Campaign) -> list[dict[str, Any]]:
    return [row for row in read_notes(campaign).values() if row.get("status") == NOTE_OPEN]


def read_rulings(campaign: Campaign, staged: list[dict[str, Any]] | None = None) -> dict[str, dict[str, Any]]:
    return _ledger(campaign, campaign.rulings_path, staged or [])


def active_rulings(campaign: Campaign) -> list[dict[str, Any]]:
    return [row for row in read_rulings(campaign).values() if row.get("status") == RULING_ACTIVE]


def _public(row: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in row.items() if k != "seq"}


# ---- notes (§18.2) ------------------------------------------------------------------------

def _names(value: Any, field: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(v, str) and v.strip() for v in value):
        raise invalid_params(f"{field} must be a list of names")
    return [v.strip() for v in value]


def lenient_entities(graph: ModuleGraph, party: list[dict[str, Any]], names: list[str]) -> list[str]:
    """A note's entities: the canonical name when the name resolves to exactly one
    investigator, NPC, scene or clue (exact, else one whole word of a name, §12.4);
    the keeper's own words otherwise. A note is the keeper's memo, not a world write."""
    from .memory import EntityIndex  # local: memory imports facts, which imports render
    index = EntityIndex(graph, party)
    out: list[str] = []
    for name in names:
        found = index.matches(name) or index.loose_matches(name)
        canonical = index.canonical_name(found[0]) if len(found) == 1 else name
        if canonical not in out:
            out.append(canonical)
    return out


def stage_note(campaign: Campaign, graph: ModuleGraph, party: list[dict[str, Any]], effect: dict[str, Any],
               turn_number: int, ordinal: int, call_id: str, mint: Mint,
               staged: list[dict[str, Any]]) -> tuple[dict[str, Any], tuple[str, dict[str, Any]]]:
    """`text` opens a note under `name`; `closes` closes the open note of that name; both
    at once replace one note by another. Rows go to `staged`; the batch appends them once
    every effect validated."""
    name = effect.get("name")
    text = effect.get("text")
    closes = effect.get("closes")
    for field, value in (("name", name), ("text", text), ("closes", closes)):
        if value is not None and (not isinstance(value, str) or not value.strip()):
            raise invalid_params(f"note {field} must be a non-empty string")
    if text is None and closes is None:
        raise invalid_params("a note needs text (to open one) or closes (to close one)",
                             fix='{"kind": "note", "name": "...", "text": "one line"} or {"kind": "note", "closes": "<name>"}')
    if text is not None and name is None:
        raise invalid_params("a note with text needs a name", fix="give the note a short semantic name")
    ledger = read_notes(campaign, staged)
    rows: list[dict[str, Any]] = []
    closed: dict[str, Any] | None = None
    if closes is not None:
        row = ledger.get(normalize(closes))
        if row is None or row.get("status") != NOTE_OPEN:
            open_names = [str(r.get("name")) for r in ledger.values() if r.get("status") == NOTE_OPEN]
            raise invalid_params(f"no open note named {closes!r}",
                                 fix=f"close one of {open_names}" if open_names else "there is no open note to close",
                                 details={"closes": closes, "open": open_names})
        closed = {**_public(row), "status": NOTE_CLOSED, "closed_turn": turn_number, "closed_by": call_id}
        rows.append(closed)
    opened: dict[str, Any] | None = None
    if text is not None:
        assert isinstance(name, str)
        key = normalize(name)
        existing = ledger.get(key)
        if existing is not None and existing.get("status") == NOTE_OPEN and not (closes is not None and normalize(closes) == key):
            raise invalid_params(f"a note named {name!r} is already open",
                                 fix="pick another name, or close it first with closes",
                                 details={"name": name, "open_since_turn": existing.get("turn")})
        opened = {"name": name.strip(), "text": " ".join(text.split()),
                  "entities": lenient_entities(graph, party, _names(effect.get("entities"), "entities")),
                  "turn": turn_number, "status": NOTE_OPEN}
    label = (opened or closed or {}).get("name") or str(closes)
    receipt_id = _receipt_id("note", str(label), turn_number, ordinal, mint)
    if opened is not None:
        opened["receipt"] = receipt_id
        rows.append(opened)
    staged.extend(rows)
    receipt = {"id": receipt_id, "kind": "note", "call_id": call_id, "name": label,
               "status": NOTE_OPEN if opened else NOTE_CLOSED,
               "text": opened["text"] if opened else None, "entities": list(opened["entities"]) if opened else [],
               "closes": closed["name"] if closed else None, "visibility": KEEPER, "at": now_iso()}
    return receipt, ("note-written", {"name": label, "status": receipt["status"], "entities": receipt["entities"],
                                      "closes": receipt["closes"]})


def note_obligations(notes: list[dict[str, Any]], present: list[str], here: list[str]) -> list[dict[str, Any]]:
    """`obligations` rows of kind `note`: every open note whose entities meet someone
    present or this scene, then the most recent NOTES_RECENT of the rest (§18.2)."""
    names = {normalize(n) for n in present + here if n}
    linked = [n for n in notes if names & {normalize(str(e)) for e in n.get("entities") or []}]
    rest = _newest_first([n for n in notes if n not in linked])[:NOTES_RECENT]
    rows = []
    for note in linked + rest:
        row: dict[str, Any] = {"kind": "note", "name": str(note.get("name")), "who": KEEPER,
                               "state": str(note.get("text") or ""), "turn": note.get("turn")}
        entities = [str(e) for e in note.get("entities") or []]
        if entities:
            row["cue"] = ", ".join(entities)
        rows.append(row)
    return rows


# ---- rulings (§18.3) ----------------------------------------------------------------------

def _closed(field: str, given: str, options: list[str]) -> RpcError:
    return invalid_params(f"ruling.anchor.{field} {given!r} is not a known {field}",
                          fix=f"use one of details.options for anchor.{field}",
                          details={"field": field, "query": given, "options": options})


def anchor_of(raw: Any, *, families: list[str], decisions: list[str], resolver: SkillResolver,
              graph: ModuleGraph) -> dict[str, Any]:
    """The anchor with every facet validated against its registry and spelled
    canonically: a RuleGraph family, a decision's semantic name, a skill catalog name,
    graph handles. At least one facet; unknown keys are refused."""
    if not isinstance(raw, dict) or not raw:
        raise invalid_params("ruling.anchor must be an object with at least one of family, decision, skill, entities",
                             fix=f"anchor fields: {list(ANCHOR_FIELDS)}")
    unknown = sorted(set(raw) - set(ANCHOR_FIELDS))
    if unknown:
        raise invalid_params(f"unknown anchor fields {unknown}", fix=f"anchor fields: {list(ANCHOR_FIELDS)}")
    anchor: dict[str, Any] = {}
    family = raw.get("family")
    if family is not None:
        if not isinstance(family, str) or family not in families:
            raise _closed("family", str(family), families)
        anchor["family"] = family
    decision = raw.get("decision")
    if decision is not None:
        name = semantic_name(decision) if isinstance(decision, str) else ""
        if name not in decisions:
            raise _closed("decision", str(decision), decisions)
        anchor["decision"] = name
    skill = raw.get("skill")
    if skill is not None:
        found = resolver.resolve_explicit(skill) if isinstance(skill, str) and skill.strip() else None
        if found is None:
            raise _closed("skill", str(skill), resolver.options_for(str(skill)))
        anchor["skill"] = found
    entities = raw.get("entities")
    if entities is not None:
        handles: list[str] = []
        for name in _names(entities, "anchor.entities"):
            try:
                node = graph.resolve(name)
            except RpcError as exc:
                raise invalid_params(f"ruling.anchor.entities: {exc.message}",
                                     fix="name an entity of the module graph exactly, or one of details.candidates",
                                     details={"field": "entities", **(exc.details or {})}) from exc
            handle = graph.handle(node)
            if handle not in handles:
                handles.append(handle)
        if not handles:
            raise invalid_params("ruling.anchor.entities must name at least one entity")
        anchor["entities"] = sorted(handles)
    if not anchor:
        raise invalid_params("ruling.anchor must carry at least one of family, decision, skill, entities")
    return anchor


def anchor_key(anchor: dict[str, Any]) -> str:
    return canonical_json(anchor)


def stage_ruling(campaign: Campaign, effect: dict[str, Any], turn_number: int, ordinal: int, call_id: str,
                 mint: Mint, staged: list[dict[str, Any]], *, anchor: dict[str, Any], scene: str,
                 module_id: str) -> tuple[dict[str, Any], tuple[str, dict[str, Any]]]:
    """A new ruling supersedes the active one with the same name and every active one
    with the identical anchor (the continuation law of §13.5 memory)."""
    name = effect.get("name")
    statement = effect.get("statement")
    if not isinstance(name, str) or not name.strip():
        raise invalid_params("ruling name must be a non-empty string", fix="a short semantic name for the ruling")
    if not isinstance(statement, str) or not statement.strip():
        raise invalid_params("ruling statement must be a non-empty string", fix="one line: how it is judged")
    scope = effect.get("scope", "campaign")
    if scope not in RULING_SCOPES:
        raise invalid_params(f"unknown ruling scope {scope!r}", fix=f"one of {list(RULING_SCOPES)}")
    ledger = read_rulings(campaign, staged)
    key = anchor_key(anchor)
    superseded = [row for row in ledger.values()
                  if row.get("status") == RULING_ACTIVE
                  and (normalize(str(row.get("name"))) == normalize(name) or anchor_key(row.get("anchor") or {}) == key)]
    receipt_id = _receipt_id("ruling", name, turn_number, ordinal, mint)
    rows = [{**_public(row), "status": RULING_SUPERSEDED, "superseded_by": name.strip(), "superseded_turn": turn_number}
            for row in superseded]
    rows.append({"name": name.strip(), "statement": " ".join(statement.split()), "anchor": anchor, "scope": scope,
                 "scene": scene, "module": module_id, "turn": turn_number, "status": RULING_ACTIVE, "receipt": receipt_id})
    staged.extend(rows)
    supersedes = [str(row.get("name")) for row in superseded]
    receipt = {"id": receipt_id, "kind": "ruling", "call_id": call_id, "name": name.strip(),
               "statement": rows[-1]["statement"], "anchor": anchor, "scope": scope, "supersedes": supersedes,
               "visibility": KEEPER, "at": now_iso()}
    return receipt, ("ruling-made", {"name": name.strip(), "anchor": anchor, "scope": scope, "supersedes": supersedes})


def _in_scope(row: dict[str, Any], scene: str, module_id: str | None) -> bool:
    scope = row.get("scope")
    if scope == "scene":
        return row.get("scene") == scene
    if scope == "module":
        return row.get("module") in (None, module_id)
    return True


def _facets_match(anchor: dict[str, Any], *, family: str | None, decision: str | None,
                  skills: list[str], entities: list[str], judged: tuple[str, ...]) -> bool:
    """Every facet the anchor names among `judged` is equal to the facet at hand;
    facets outside `judged` are not held against it (the capsule cannot know a skill)."""
    if "family" in judged and anchor.get("family") is not None and anchor["family"] != family:
        return False
    if "decision" in judged and anchor.get("decision") is not None and anchor["decision"] != decision:
        return False
    if "skill" in judged and anchor.get("skill") is not None:
        if normalize(str(anchor["skill"])) not in {normalize(s) for s in skills}:
            return False
    if "entities" in judged and anchor.get("entities"):
        if not set(anchor["entities"]) & set(entities):
            return False
    return True


def rulings_for_resolve(rulings: list[dict[str, Any]], *, decision: str, family: str, skills: list[str],
                        entities: list[str], scene: str, module_id: str | None) -> list[dict[str, Any]]:
    """§18.3 projection 1: the active rulings whose every anchored facet equals what this
    settlement selected (its decision, family, the skills rolled, the entities the
    action named), newest first, at most RULINGS_LIMIT."""
    hits = [row for row in rulings if _in_scope(row, scene, module_id)
            and _facets_match(row.get("anchor") or {}, family=family, decision=decision, skills=skills,
                              entities=entities, judged=ANCHOR_FIELDS)]
    return [{"name": str(row.get("name")), "statement": str(row.get("statement"))}
            for row in _newest_first(hits)[:RULINGS_LIMIT]]


def rulings_for_capsule(rulings: list[dict[str, Any]], *, session_kind: str | None, present: list[str],
                        scene: str, module_id: str | None) -> list[dict[str, Any]]:
    """§18.3 projection 2: rulings that bind here -- anchored (by family and/or entities,
    the facets a capsule can judge) to the live session's family or to someone present
    or this scene, or scoped to this very scene -- newest first, at most RULINGS_LIMIT."""
    family = SESSION_FAMILY.get(str(session_kind)) if session_kind else None
    here = [*present, scene]
    hits = []
    for row in rulings:
        if not _in_scope(row, scene, module_id):
            continue
        anchor = row.get("anchor") or {}
        # A capsule can judge a family facet only against a live session, so only a
        # session family (combat, chase, sanity) is held against the ruling here; a
        # core-check or social anchor is judged by `resolve`, never guessed at.
        judged = ("family", "entities") if anchor.get("family") in SESSION_FAMILY.values() else ("entities",)
        judgeable = "family" in judged or bool(anchor.get("entities"))
        if (row.get("scope") == "scene" and row.get("scene") == scene) or (
                judgeable and _facets_match(anchor, family=family, decision=None, skills=[], entities=here, judged=judged)):
            hits.append(row)
    return [{"name": str(row.get("name")), "statement": str(row.get("statement")), "anchor": row.get("anchor"),
             "scope": row.get("scope")} for row in _newest_first(hits)[:RULINGS_LIMIT]]
