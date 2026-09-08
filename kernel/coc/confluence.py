"""Contract §15.4 (#23): the confluence report, and the merge that follows it.

Two worldlines that flow together do not merge as git would merge them. Git is asked only
to keep both histories reachable (`-s ours`, §15.4); what the merged campaign actually
holds is computed here, from the state each line committed, under one closed table of
conflict classes and the dispositions each class allows.

The union is the default and needs no keeper: clues, echoes, handouts, scenes visited,
flags both lines agree on, people both lines put in the same place. A conflict is only
raised where the two lines say different things about the same subject, and it is raised
by name -- `conflict:<class>:<subject>:<field>` -- so the same report computed twice is
byte for byte the same and the keeper's dispositions can be sent back against it.

Nothing here duplicates what cannot be duplicated. A dead investigator does not come back
because the other line kept them alive; an object one line spent is not restocked by the
line that never spent it; rolls and one-shot effects are not re-counted, because they are
receipts in each line's own history and the merge commit keeps both of those histories
whole. That is what the old tree's `NON_DUPLICABLE_CONFLICT_CLASSES` becomes here: those
classes simply have no `sum` mode.
"""

from __future__ import annotations

import copy
import json
from typing import Any

from . import echoes as echoes_mod, history, memory, worldline
from .errors import RpcError, invalid_params
from .module_graph import ModuleGraph
from .store import Campaign, now_iso
from .text import normalize

# ---- the closed table (§15.4) ----------------------------------------------------------

NUMERIC, DEAD_ALIVE, CONSUMED, FLAG, NPC_PRESENCE, MOD_STATE = (
    "numeric", "dead_alive", "consumed", "flag", "npc_presence", "mod_state")
FROM, MIN, MAX, SUM, DROP = "from", "min", "max", "sum", "drop"
#: Which dispositions each class allows. `clue` is absent on purpose: clues never conflict,
#: they are a union. No class offers `sum` over something that cannot be duplicated.
DISPOSITIONS: dict[str, tuple[str, ...]] = {
    NUMERIC: (FROM, MIN, MAX),
    DEAD_ALIVE: (FROM,),
    CONSUMED: (FROM, DROP),
    FLAG: (FROM,),
    NPC_PRESENCE: (FROM, SUM),
    MOD_STATE: (FROM,),
}
#: The investigator numbers a merge compares, sheet field by capsule name.
RESOURCES = (("hp", "current_hp"), ("san", "current_san"), ("mp", "current_mp"), ("luck", "current_luck"))
#: The condition that says an investigator did not survive that line.
DEAD_CONDITION = "dead"
#: The world keys a merge unions outright; none of them can disagree.
UNION_LISTS = ("visited_scenes", "discovered_clues", "discovered_echoes", "handouts_shown")
#: The world keys that map a handle to the name the table gave it: merged by union, because a
#: name is not a claim two lines can disagree about (§23).
MERGED_LABEL_MAPS = ("scene_labels", "clue_labels")
#: A presence conflict where one line moved someone and another left them where the book
#: put them names that third option here; it is not a worldline and cannot be switched to.
BOOK = "*book*"


def conflict_id(kind: str, subject: str, field: str) -> str:
    return f"conflict:{kind}:{subject}:{field}"


# ---- reading a line without checking it out ---------------------------------------------

def line_state(campaign: Campaign, line: str) -> dict[str, Any]:
    """One worldline's committed state: its world, its sheets by id, and its memory
    candidates. Read out of git, so the party keeps standing where it stands."""
    repo, tree = campaign.repo_dir, campaign.dir
    raw = history.line_blob(repo, tree, line, "world.json")
    if raw is None:
        raise invalid_params(f"worldline {line!r} has no committed world",
                             fix="merge lines that have played at least one turn",
                             details={"line": line})
    party: dict[str, Any] = {}
    for path in history.line_tree(repo, tree, line, "party/"):
        sheet_raw = history.line_blob(repo, tree, line, path)
        if sheet_raw is None:
            continue
        try:
            sheet = json.loads(sheet_raw)
        except ValueError:
            continue
        if isinstance(sheet, dict) and sheet.get("id"):
            party[str(sheet["id"])] = sheet
    candidates_raw = history.line_blob(repo, tree, line, "memory/candidates.jsonl") or ""
    candidates = []
    for row in candidates_raw.splitlines():
        if not row.strip():
            continue
        try:
            parsed = json.loads(row)
        except ValueError:
            continue
        if isinstance(parsed, dict):
            candidates.append(parsed)
    return {"line": line, "world": json.loads(raw), "party": party, "candidates": candidates,
            "spent": spent_items(campaign, line)}


def spent_items(campaign: Campaign, line: str) -> set[tuple[str, str]]:
    """`(investigator, item)` for every object this line used up, handed over or had taken
    away -- an `item` receipt with a negative quantity (§5, #19). This is the difference
    between a thing one line never picked up and a thing one line *spent*: the first is an
    ordinary union, the second is the `consumed` conflict of §15.4."""
    repo, tree = campaign.repo_dir, campaign.dir
    spent: set[tuple[str, str]] = set()
    for path in history.line_tree(repo, tree, line, "turns/"):
        raw = history.line_blob(repo, tree, line, path)
        if raw is None:
            continue
        try:
            record = json.loads(raw)
        except ValueError:
            continue
        for receipt in (record.get("receipts") or []) if isinstance(record, dict) else []:
            if not isinstance(receipt, dict) or receipt.get("kind") != "item":
                continue
            quantity = receipt.get("quantity")
            if isinstance(quantity, int) and quantity < 0:
                spent.add((str(receipt.get("subject")), normalize(str(receipt.get("name") or ""))))
    return spent


# ---- the report -------------------------------------------------------------------------

def report(graph: ModuleGraph, states: list[dict[str, Any]], into: str | None) -> dict[str, Any]:
    """What merging these lines would produce, and everything they disagree about. Pure:
    it writes nothing and the same inputs give the same bytes."""
    first = states[0]
    scene = into or str(first["world"].get("active_scene") or "")
    conflicts: list[dict[str, Any]] = []
    world = _merge_world(graph, states, scene, conflicts)
    party = _merge_party(states, conflicts)
    conflicts.sort(key=lambda row: str(row["id"]))
    return {"lines": [state["line"] for state in states], "into": scene,
            "world": world, "party": party, "conflicts": conflicts}


def _merge_world(graph: ModuleGraph, states: list[dict[str, Any]], scene: str,
                 conflicts: list[dict[str, Any]]) -> dict[str, Any]:
    world = copy.deepcopy(states[0]["world"])
    for key in UNION_LISTS:
        seen: list[str] = []
        for state in states:
            for value in state["world"].get(key) or []:
                if str(value) not in seen:
                    seen.append(str(value))
        world[key] = seen
    world["active_scene"] = scene
    # The trail is where this party stands now, not two pasts stitched together.
    world["scene_trail"] = []
    for key in MERGED_LABEL_MAPS:
        labels: dict[str, Any] = {}
        for state in states:
            labels.update(state["world"].get(key) or {})
        world[key] = labels
    # The clock runs to the furthest either line reached: time does not un-pass.
    world["clock"] = {"minutes": max(int((state["world"].get("clock") or {}).get("minutes") or 0)
                                     for state in states)}
    world["flags"] = _merge_flags(states, conflicts)
    world["npc_presence"] = _merge_presence(graph, states, scene, conflicts)
    mod_values = {state["line"]: {key:copy.deepcopy(state["world"].get(key)) for key in ("mods", "objects", "npc_resources")}
                  for state in states}
    if len({json.dumps(v, sort_keys=True) for v in mod_values.values()}) > 1:
        conflicts.append({"id":conflict_id(MOD_STATE, "game-mods", "snapshot"), "class":MOD_STATE,
                          "subject":"game-mods", "field":"snapshot", "values":mod_values,
                          "modes":list(DISPOSITIONS[MOD_STATE])})
    return world


def _merge_flags(states: list[dict[str, Any]], conflicts: list[dict[str, Any]]) -> dict[str, Any]:
    flags: dict[str, Any] = {}
    for state in states:
        for name, value in (state["world"].get("flags") or {}).items():
            flags.setdefault(str(name), {})[state["line"]] = value
    merged: dict[str, Any] = {}
    for name in sorted(flags):
        by_line = flags[name]
        values = {json.dumps(value, sort_keys=True) for value in by_line.values()}
        merged[name] = next(iter(by_line.values()))
        if len(values) > 1:
            conflicts.append({"id": conflict_id(FLAG, name, "value"), "class": FLAG, "subject": name,
                              "field": "value", "values": by_line, "modes": list(DISPOSITIONS[FLAG])})
    return merged


def _merge_presence(graph: ModuleGraph, states: list[dict[str, Any]], scene: str,
                    conflicts: list[dict[str, Any]]) -> dict[str, Any]:
    """§15.4: presence is recomputed from the graph and then each line's moves are laid
    over it, so an NPC neither line touched stands where the book puts them."""
    base: dict[str, str] = {}
    for node in graph.scenes():
        for npc_id in graph.scene_npc_ids(node):
            base.setdefault(graph.handle(graph.nodes[npc_id]), graph.handle(node))
    moved: dict[str, dict[str, Any]] = {}
    for state in states:
        for npc, where in (state["world"].get("npc_presence") or {}).items():
            if base.get(str(npc)) != where:
                moved.setdefault(str(npc), {})[state["line"]] = where
    merged = dict(base)
    for npc in sorted(moved):
        by_line = moved[npc]
        places = {str(value) for value in by_line.values()}
        merged[npc] = next(iter(by_line.values()))
        if len(places) > 1 or (len(by_line) < len(states) and base.get(npc) not in places):
            # Two lines put the same person in different places, or one moved them and the
            # other left them where the book had them. Both are the keeper's to settle.
            if base.get(npc) is not None and len(by_line) < len(states):
                by_line = {**by_line, BOOK: base[npc]}
            conflicts.append({"id": conflict_id(NPC_PRESENCE, npc, "scene"), "class": NPC_PRESENCE,
                              "subject": npc, "field": "scene", "values": by_line,
                              "modes": list(DISPOSITIONS[NPC_PRESENCE])})
            merged[npc] = sorted(places)[0]
    return merged


def _merge_party(states: list[dict[str, Any]], conflicts: list[dict[str, Any]]) -> dict[str, Any]:
    spent_by_line = {state["line"]: state.get("spent") or set() for state in states}
    ids: list[str] = []
    for state in states:
        for sheet_id in sorted(state["party"]):
            if sheet_id not in ids:
                ids.append(sheet_id)
    merged: dict[str, Any] = {}
    for sheet_id in ids:
        sheets = {state["line"]: state["party"][sheet_id] for state in states if sheet_id in state["party"]}
        base = copy.deepcopy(next(iter(sheets.values())))
        _numbers(sheet_id, sheets, base, conflicts)
        _life(sheet_id, sheets, base, conflicts)
        _belongings(sheet_id, sheets, base, conflicts, spent_by_line)
        merged[sheet_id] = base
    return merged


def _numbers(sheet_id: str, sheets: dict[str, Any], base: dict[str, Any],
             conflicts: list[dict[str, Any]]) -> None:
    for field, key in RESOURCES:
        by_line = {line: sheet.get(key) for line, sheet in sheets.items()}
        if len({json.dumps(v, sort_keys=True) for v in by_line.values()}) > 1:
            conflicts.append({"id": conflict_id(NUMERIC, sheet_id, field), "class": NUMERIC,
                              "subject": sheet_id, "field": field, "values": by_line,
                              "sheet_field": key, "modes": list(DISPOSITIONS[NUMERIC])})


def _life(sheet_id: str, sheets: dict[str, Any], base: dict[str, Any],
          conflicts: list[dict[str, Any]]) -> None:
    by_line = {line: _alive(sheet) for line, sheet in sheets.items()}
    if len(set(by_line.values())) > 1:
        conflicts.append({"id": conflict_id(DEAD_ALIVE, sheet_id, "alive"), "class": DEAD_ALIVE,
                          "subject": sheet_id, "field": "alive", "values": by_line,
                          "modes": list(DISPOSITIONS[DEAD_ALIVE])})


def _alive(sheet: dict[str, Any]) -> bool:
    hp = sheet.get("current_hp")
    if isinstance(hp, int) and hp < 0:
        return False
    return not any(normalize(str(c)) == DEAD_CONDITION for c in sheet.get("conditions") or [])


def _belongings(sheet_id: str, sheets: dict[str, Any], base: dict[str, Any],
                conflicts: list[dict[str, Any]], spent_by_line: dict[str, set[tuple[str, str]]]) -> None:
    """Items merge by name. Holding the same thing on both lines is one thing, not two --
    the union is over what the party has, never over how many. A name one line still holds
    and another spent is a `consumed` conflict: it is the keeper's call whether the object
    survived the confluence."""
    held: dict[str, dict[str, Any]] = {}
    for line, sheet in sheets.items():
        for row in sheet.get("equipment") or []:
            name = row.get("name") if isinstance(row, dict) else row
            if not name:
                continue
            held.setdefault(normalize(str(name)), {})[line] = row
    rows: list[Any] = []
    for key in sorted(held):
        by_line = held[key]
        # Only a line that actually spent it disagrees. A line that simply never picked the
        # thing up is not in conflict with the line that did: that is the union.
        spent = sorted(line for line in sheets if line not in by_line and (sheet_id, key) in spent_by_line[line])
        if spent:
            conflicts.append({"id": conflict_id(CONSUMED, sheet_id, key), "class": CONSUMED,
                              "subject": sheet_id, "field": key,
                              "values": {**{line: "held" for line in by_line}, **{line: "spent" for line in spent}},
                              "modes": list(DISPOSITIONS[CONSUMED])})
        rows.append(copy.deepcopy(next(iter(by_line.values()))))
    base["equipment"] = rows
    weapons: dict[str, Any] = {}
    for sheet in sheets.values():
        for row in sheet.get("weapons") or []:
            if isinstance(row, dict):
                weapons.setdefault(normalize(str(row.get("name") or row.get("weapon_id") or "")), row)
    base["weapons"] = [copy.deepcopy(weapons[key]) for key in sorted(weapons) if key]
    conditions: set[str] = set()
    for sheet in sheets.values():
        conditions |= {str(c) for c in sheet.get("conditions") or []}
    base["conditions"] = sorted(conditions)


# ---- the keeper's dispositions ----------------------------------------------------------

def settle(result: dict[str, Any], dispositions: dict[str, Any]) -> dict[str, Any]:
    """Apply the keeper's rulings to the report, or refuse. Every conflict must be named
    and every mode must be one the class allows; a `drop` must say why. Returns the report
    with the conflicts resolved into the world and the sheets."""
    conflicts = {str(row["id"]): row for row in result["conflicts"]}
    unknown = sorted(key for key in dispositions if key not in conflicts)
    if unknown:
        raise invalid_params("dispositions name conflicts this merge does not have",
                             fix="send back the ids from details.conflicts, unchanged",
                             details={"unknown": unknown, "conflicts": sorted(conflicts)})
    undecided = [row for key, row in sorted(conflicts.items()) if key not in dispositions]
    if undecided:
        raise RpcError("needs", "this confluence has conflicts the keeper must settle",
                       fix="send params.dispositions with one entry per conflict id",
                       details={"conflicts": undecided})
    for key, row in sorted(conflicts.items()):
        _resolve(result, row, _mode_of(row, dispositions[key]))
    result["dispositions"] = {key: dict(value) for key, value in sorted(dispositions.items())}
    if "objects" in result["world"]:
        from .mods.objects import project_sheet
        for sheet in result["party"].values():
            project_sheet(result["world"], sheet)
    return result


def _mode_of(row: dict[str, Any], given: Any) -> dict[str, Any]:
    allowed = DISPOSITIONS[str(row["class"])]
    if not isinstance(given, dict) or given.get("mode") not in allowed:
        raise invalid_params(f"conflict {row['id']} cannot be settled that way",
                             fix=f"one of: {', '.join(allowed)}",
                             details={"conflict": row["id"], "class": row["class"], "modes": list(allowed),
                                      "given": given.get("mode") if isinstance(given, dict) else given})
    mode = str(given["mode"])
    if mode == FROM:
        line = given.get("line")
        if line not in row["values"]:
            raise invalid_params(f"conflict {row['id']} has nothing from that line",
                                 fix="name one of details.lines",
                                 details={"conflict": row["id"], "lines": sorted(row["values"]), "given": line})
    if mode == DROP and not (isinstance(given.get("note"), str) and given["note"].strip()):
        raise invalid_params(f"dropping {row['id']} must say why",
                             fix="add a note the table can read later",
                             details={"conflict": row["id"]})
    return dict(given)


def _resolve(result: dict[str, Any], row: dict[str, Any], given: dict[str, Any]) -> None:
    mode, kind = str(given["mode"]), str(row["class"])
    values, subject, field = row["values"], str(row["subject"]), str(row["field"])
    if kind == NUMERIC:
        numbers = [v for v in values.values() if isinstance(v, int)]
        chosen = values[given["line"]] if mode == FROM else (min(numbers) if mode == MIN else max(numbers))
        result["party"][subject][str(row["sheet_field"])] = chosen
    elif kind == DEAD_ALIVE:
        sheet = result["party"][subject]
        alive = bool(values[given["line"]])
        conditions = [c for c in sheet.get("conditions") or [] if normalize(str(c)) != DEAD_CONDITION]
        sheet["conditions"] = conditions if alive else sorted({*conditions, DEAD_CONDITION})
    elif kind == CONSUMED:
        # `drop` says the object did not survive the confluence; `from` takes one line's
        # word for it, and the line that spent it says it is gone.
        gone = mode == DROP or values.get(given.get("line")) == "spent"
        if gone:
            sheet = result["party"][subject]
            sheet["equipment"] = [r for r in sheet.get("equipment") or []
                                  if normalize(str((r or {}).get("name") if isinstance(r, dict) else r)) != field]
    elif kind == FLAG:
        result["world"]["flags"][subject] = values[given["line"]]
    elif kind == NPC_PRESENCE:
        places = sorted({str(v) for v in values.values()})
        result["world"]["npc_presence"][subject] = str(values[given["line"]]) if mode == FROM else (
            result["world"]["active_scene"] if result["world"]["active_scene"] in places else places[0])
    elif kind == MOD_STATE:
        for key, value in values[given["line"]].items():
            if value is None:
                result["world"].pop(key, None)
            else:
                result["world"][key] = copy.deepcopy(value)


# ---- staging a merge inside a batch (§15.3) ----------------------------------------------

def plan(campaign: Campaign, graph: ModuleGraph, meta: dict[str, Any], effect: dict[str, Any],
         source: str, turn_number: int) -> dict[str, Any]:
    """Validate the effect, compute the report and settle it. Raises `needs` while any
    conflict is unsettled, so the whole batch is refused before a byte is written."""
    lines = worldline.registry(meta)
    name = worldline.validate_name(effect.get("name"), what="name")
    if name in lines or history.line_commit(campaign.repo_dir, campaign.dir, name) is not None:
        raise invalid_params(f"worldline {name!r} already exists",
                             fix="the confluence makes a new line; pick a name no line has",
                             details={"lines": sorted(lines)})
    wanted = effect.get("lines")
    if not isinstance(wanted, list) or len(wanted) < 2:
        raise invalid_params("a confluence needs at least two lines",
                             fix="lines: [\"<a>\", \"<b>\"]", details={"lines": wanted})
    chosen: list[str] = []
    for value in wanted:
        line = worldline.validate_name(value, what="lines")
        row = lines.get(line)
        if not isinstance(row, dict) or history.line_commit(campaign.repo_dir, campaign.dir, line) is None:
            raise invalid_params(f"no worldline {line!r}", fix="merge lines this campaign has",
                                 details={"lines": sorted(lines)})
        if row.get("status") == worldline.STATUS_MERGED:
            raise invalid_params(f"worldline {line!r} was already merged",
                                 details={"line": line, "status": worldline.STATUS_MERGED})
        if line in chosen:
            raise invalid_params(f"worldline {line!r} is named twice", details={"line": line})
        chosen.append(line)
    if source not in chosen:
        raise invalid_params("a confluence must include the line at the table",
                             fix=f"add {source!r} to lines, or switch to one of them first",
                             details={"active": source, "lines": chosen})
    into = effect.get("into")
    if into is not None:
        into = graph.handle(graph.scene(str(into)))
    states = [line_state(campaign, line) for line in chosen]
    settled = settle(report(graph, states, into), _dispositions(effect.get("dispositions")))
    parents = [{"line": line, "turn": int((lines[line] or {}).get("last_turn") or 0),
                "commit": history.line_commit(campaign.repo_dir, campaign.dir, line)} for line in chosen]
    return {"operation": worldline.MERGE, "line": name, "mode": None, "lines": chosen,
            "from": {"line": source, "turn": turn_number, "commit": None},
            "loop": max(int((lines[line] or {}).get("loop") or 0) for line in chosen),
            "parents": parents, "into": settled["into"], "report": settled}


def _dispositions(given: Any) -> dict[str, Any]:
    if given is None:
        return {}
    if not isinstance(given, dict) or any(not isinstance(v, dict) for v in given.values()):
        raise invalid_params("dispositions must map a conflict id to a disposition",
                             fix='{"conflict:numeric:...": {"mode": "max"}}', details={"dispositions": given})
    return given


# ---- performing it after the commit (§15.3) ----------------------------------------------

def perform(campaign: Campaign, graph: ModuleGraph, plan_row: dict[str, Any],
            turn_number: int) -> dict[str, Any]:
    """Land the merge: a new branch off the first line, the other lines recorded as
    parents, and the computed state written over it. Rolls the reference back on any
    failure, exactly as a fork does."""
    repo, tree = campaign.repo_dir, campaign.dir
    meta = campaign.read_campaign()
    before = copy.deepcopy(meta)
    source = str(plan_row["from"]["line"])
    target = str(plan_row["line"])
    parents = [str(row["line"]) for row in plan_row["parents"]]
    base = history.commit_if_dirty(repo, tree, f"worldline {source}: sealed at turn {turn_number}") \
        or history.head_sha(repo, tree)
    created = False
    try:
        start = history.line_commit(repo, tree, parents[0])
        history.create_branch(repo, tree, target, str(start))
        created = True
        history.checkout(repo, tree, target)
        history.merge_parents(repo, tree, parents[1:])
        _write_state(campaign, plan_row["report"])
        _write_memory(campaign, plan_row)
        _write_echoes(campaign, meta, plan_row, parents)
        lines = dict(worldline.registry(meta))
        for name in parents:
            row = lines.get(name)
            if isinstance(row, dict):
                row["status"] = worldline.STATUS_MERGED
                row["last_commit"] = history.line_commit(repo, tree, name)
        lines[target] = worldline.new_line(campaign.id, target, worldline.KIND_MERGE, int(plan_row["loop"]),
                                           dict(plan_row["parents"][0]), parents=list(plan_row["parents"]))
        meta["worldlines"] = lines
        meta["active_worldline"] = target
        campaign.write_campaign(meta)
        landed = history.commit_if_dirty(
            repo, tree, f"worldline {target}: {', '.join(parents)} flowed together at turn {turn_number}")
        lines[target]["last_commit"] = landed or history.head_sha(repo, tree)
        lines[target]["last_turn"] = campaign.read_turn().get("turn") if campaign.turn_json.exists() else None
        campaign.write_campaign(meta)
    except Exception:
        try:
            history.abort_merge(repo, tree)
            history.checkout(repo, tree, source, force=True)
            if created:
                history.delete_branch(repo, tree, target)
            campaign.write_campaign(before)
        except Exception:  # noqa: BLE001 - best effort; the raise below is the real report
            pass
        raise
    return {"operation": worldline.MERGE, "line": target, "from": source, "mode": None,
            "loop": int(plan_row["loop"]), "lines": parents, "seal": base,
            "commit": lines[target].get("last_commit"),
            "conflicts": len(plan_row["report"]["conflicts"])}


def _write_state(campaign: Campaign, settled: dict[str, Any]) -> None:
    campaign.write_world(settled["world"])
    for sheet in settled["party"].values():
        campaign.write_sheet(sheet)


def _write_memory(campaign: Campaign, plan_row: dict[str, Any]) -> None:
    """The union of what every line remembers. A candidate written on two lines is one
    candidate: ids are minted per line and per turn, so the same id is the same memory."""
    rows: dict[str, Any] = {}
    for line in (str(row["line"]) for row in plan_row["parents"]):
        for candidate in memory.line_candidates(campaign, line):
            rows.setdefault(str(candidate.get("id")), candidate)
    memory.write_candidates(campaign, [rows[key] for key in sorted(rows)])


def _write_echoes(campaign: Campaign, meta: dict[str, Any], plan_row: dict[str, Any],
                  parents: list[str]) -> None:
    """§15.4: the confluence leaves echoes of the lines the party did not walk in on --
    every parent but the one the new branch starts from."""
    lines = worldline.registry(meta)
    fresh: list[dict[str, Any]] = []
    for line in parents[1:]:
        fresh.extend(echoes_mod.generate(campaign, line, int((lines.get(line) or {}).get("loop") or 0)))
    echoes_mod.write(campaign, echoes_mod.merged_into(echoes_mod.read(campaign), fresh))


def receipt_of(plan_row: dict[str, Any], turn_number: int, call_id: str, label: str | None,
               mint: Any) -> dict[str, Any]:
    return {
        "id": mint(f"{worldline.MERGE}:{plan_row['line']}-t{turn_number}"),
        "kind": "worldline", "call_id": call_id, "operation": worldline.MERGE,
        "line": plan_row["line"], "mode": None, "loop": int(plan_row["loop"]),
        "lines": list(plan_row["lines"]),
        "from": {"line": plan_row["from"]["line"], "turn": turn_number},
        "conflicts": len(plan_row["report"]["conflicts"]),
        "label": label, "visibility": "public", "at": now_iso(),
    }
