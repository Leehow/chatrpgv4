"""Contract §15 (#23): worldlines -- if lines and time loops.

A worldline is a branch `wl/<name>` in the campaign's sidecar repo (ADR-0001) and the
campaign directory is the work tree of whichever branch HEAD points at. That is the whole
mechanism: `world.json`, `turn.json`, `turns/`, `save/`, `memory/` and the three logs are
all committed, so switching to another line is a checkout and everything that line knew
comes back with it. No line is ever deleted; a rewind is a new branch, not a truncation.

The registry lives in `campaign.json` (`active_worldline`, `worldlines`) because it is
campaign-global: it must describe every line while only one line's tree is on disk. It is
written before the line is left and again after the line is entered, so a checkout that
restores an older `campaign.json` cannot lose it.

What resets on a rewind, what survives it and who remembers the last loop is declared by
the module graph (§15.2) and computed here; nothing in this file reads prose or guesses.
The keeper asks for a worldline through `apply` like any other change to the world, and
the kernel performs it after that turn's `narrate` has committed -- the narration of
"you open your eyes, and it is the morning again" is delivered first, and the player's
next line lands on the new line's first turn.

`merge` is staged and performed by `confluence.py` (§15.4), which this module hands the
effect to; echoes -- what another line left standing in a scene -- are `echoes.py`.
"""

from __future__ import annotations

import copy
import json
import re
from typing import Any, Callable

from . import history
from . import echoes as echoes_mod, memory
from .errors import RpcError, invalid_params
from .fileio import read_json, sha256_text, write_json_atomic
from .module_graph import ModuleGraph, record_of
from .store import Campaign, now_iso
from .text import normalize

# ---- vocabulary -----------------------------------------------------------------------

MAIN = "main"
#: §15.1 `kind`; `merge` is minted by §15.3's merge effect, which this slice does not run.
KIND_MAIN, KIND_IF, KIND_LOOP, KIND_MERGE = "main", "if", "loop", "merge"
#: §15.1 `status`. A line the party left keeps everything and waits; `merged` is closed.
STATUS_ACTIVE, STATUS_DORMANT, STATUS_MERGED = "active", "dormant", "merged"
#: §15.3: the three ways the world's line of history changes.
FORK, SWITCH, MERGE = "fork", "switch", "merge"
OPERATIONS = (FORK, SWITCH, MERGE)
#: `apply fork` modes (§15.3).
MODE_IF, MODE_LOOP = "if", "loop"
MODES = (MODE_IF, MODE_LOOP)
#: A line name is model-visible, so it is a name (§2): a short kebab slug, and `wl/` is
#: prepended by git alone.
LINE_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
SEED_CHARS = 16
#: §15.2 relations and record flags. A module that declares none of these has no loop.
RESET_RELATION = "resets-to"
PERSIST_RELATION = "persists-across-loop"
KNOWS_RELATION = "knows"
REMEMBERS_FIELD = "remembers_across_loops"
ACROSS_LOOPS_PROPERTY = "across_loops"
#: `properties.reset` on a `resets-to` relation, a closed table with `anchor` defaults.
RESET_FACETS = ("clock", "investigators")
RESET_ANCHOR, RESET_KEEP = "anchor", "keep"
RESET_POLICIES = (RESET_ANCHOR, RESET_KEEP)
DEFAULT_RESET = {facet: RESET_ANCHOR for facet in RESET_FACETS}
#: How a scene holds the ending/event node that resets: any containment relation, either
#: direction. Structure only -- nothing here reads what a node says.
CONTAINMENT_RELATIONS = ("contains", "occurs-at", "present-in", "located-in", "discoverable-at")
#: §13.1 budget for the capsule's new section.
CAPSULE_BUDGET = 1536
#: §15.6 caps inside it.
ECHO_LIMIT = 3
PREVIOUS_LOOP_LIMIT = 4
LINES_LIMIT = 8
#: §15.5: how many statements from another circuit or line one declared NPC carries.
FROM_OTHER_LINES_LIMIT = 3
#: §15.6: the obligation a scene that can rewind puts on the keeper's slate.
LOOP_OBLIGATION = "This module's loop can be rewound from here."

Mint = Callable[[str], str]


# ---- registry and identity (§15.1) ------------------------------------------------------

def registry(meta: dict[str, Any]) -> dict[str, Any]:
    lines = meta.get("worldlines")
    return lines if isinstance(lines, dict) else {}


def active_name(meta: dict[str, Any]) -> str:
    name = meta.get("active_worldline")
    return name if isinstance(name, str) and name else MAIN


def active_line(meta: dict[str, Any]) -> dict[str, Any]:
    """The active line's registry row, or a `main` row invented on the spot for a campaign
    whose registry has not been written yet."""
    name = active_name(meta)
    row = registry(meta).get(name)
    return row if isinstance(row, dict) else new_line(str(meta.get("id") or ""), name, KIND_MAIN, 0, None)


def line_seed(campaign_id: str, name: str, forked_commit: str | None) -> str:
    """§15.1: one dice seed per line. The fork point's commit is in the material, so two
    lines that branch from the same turn under different names, and the same name forked
    twice from different turns, all roll differently. `main` has no fork point and takes
    the empty string in its place."""
    return sha256_text(f"{campaign_id}:{name}:{forked_commit or ''}")[:SEED_CHARS]


def turn_seed(seed: str, turn_number: int) -> str:
    """The rng material for one turn of one line (§15.1): the line's seed replayed by
    turn number, so the same action on two lines cannot roll the same numbers and a turn
    retried after a crash rolls what it rolled before."""
    return f"{seed}:{turn_number}"


def new_line(campaign_id: str, name: str, kind: str, loop: int, forked_from: dict[str, Any] | None,
             *, parents: list[dict[str, Any]] | None = None, status: str = STATUS_ACTIVE,
             last_turn: int | None = None, last_commit: str | None = None) -> dict[str, Any]:
    row: dict[str, Any] = {
        "name": name,
        "kind": kind,
        "loop": int(loop),
        "forked_from": forked_from,
        "seed": line_seed(campaign_id, name, (forked_from or {}).get("commit")),
        "status": status,
        "last_turn": last_turn,
        "last_commit": last_commit,
        "created_at": now_iso(),
    }
    if parents is not None:
        row["parents"] = parents
    return row


def validate_name(value: Any, *, what: str) -> str:
    if not isinstance(value, str) or not LINE_NAME.match(value.strip()):
        raise invalid_params(f"{what} must be a short kebab name",
                             fix="lowercase letters, digits and '-', at most 40 characters, e.g. loop-2",
                             details={what: value})
    return value.strip()


# ---- opening a campaign on its active line (§15.1, §15.6) --------------------------------

def open_active_line(campaign: Campaign, meta: dict[str, Any]) -> bool:
    """Make the work tree the active line's, registering `wl/main` for a campaign that
    predates worldlines (its HEAD becomes the branch; no commit is touched). Returns
    whether `meta` changed and must be written back.

    The registry declares which line is active; git decides whether that is possible. When
    the registry names a branch that does not exist (a process died between writing the
    registry and creating the branch) the tree stays where HEAD already is and the
    registry is repaired to say so, because the tree on disk is the only state a keeper
    can actually play."""
    repo, tree = campaign.repo_dir, campaign.dir
    changed = False
    on = history.current_line(repo, tree)
    if on is None:
        # A campaign made before worldlines: adopt HEAD as wl/main without rewriting it.
        head = history.head_sha(repo, tree)
        if head is not None and history.line_commit(repo, tree, MAIN) is None:
            history.create_branch(repo, tree, MAIN, head)
        history.point_head_at(repo, tree, MAIN)
        on = MAIN
    wanted = active_name(meta)
    if wanted != on:
        if history.line_commit(repo, tree, wanted) is None:
            wanted = on  # the registry named a line git never got; the tree wins
        else:
            history.commit_if_dirty(repo, tree, f"worldline {on}: sealed before opening {wanted}")
            history.checkout(repo, tree, wanted)
            # The checkout restored that line's `campaign.json`; the registry the caller
            # holds is the campaign-global truth and must be written back over it.
            changed = True
    lines = dict(registry(meta))
    if wanted not in lines:
        lines[wanted] = new_line(str(meta.get("id") or ""), wanted,
                                 KIND_MAIN if wanted == MAIN else KIND_IF, 0, None)
        changed = True
    for name, row in lines.items():
        status = STATUS_ACTIVE if name == wanted else (row.get("status") or STATUS_DORMANT)
        if status == STATUS_MERGED or row.get("status") == STATUS_MERGED:
            continue
        if row.get("status") != status:
            row["status"] = status
            changed = True
    if meta.get("active_worldline") != wanted:
        meta["active_worldline"] = wanted
        changed = True
    if meta.get("worldlines") != lines:
        meta["worldlines"] = lines
        changed = True
    return changed


# ---- module declarations (§15.2) ---------------------------------------------------------

def _reset_relations(graph: ModuleGraph) -> list[dict[str, Any]]:
    return [rel for rel in graph.raw.get("relations", []) if rel.get("relation_kind") == RESET_RELATION]


def declares_loop(graph: ModuleGraph) -> bool:
    return bool(_reset_relations(graph))


def reset_policy(relation: dict[str, Any] | None) -> dict[str, str]:
    """`properties.reset`, a closed table: each facet is `anchor` (the default) or `keep`.
    An unknown word is a module defect, so it falls back to the default rather than
    stopping a rewind the keeper already narrated."""
    declared = ((relation or {}).get("properties") or {}).get("reset")
    policy = dict(DEFAULT_RESET)
    if isinstance(declared, dict):
        for facet in RESET_FACETS:
            value = declared.get(facet)
            if isinstance(value, str) and value in RESET_POLICIES:
                policy[facet] = value
    return policy


def _here(graph: ModuleGraph, scene: dict[str, Any], node_id: str) -> bool:
    """Whether a node is the scene or is held by it, by containment relations alone."""
    if node_id == scene["node_id"]:
        return True
    for rel in graph.out_rel.get(scene["node_id"], []) + graph.in_rel.get(scene["node_id"], []):
        if rel.get("relation_kind") not in CONTAINMENT_RELATIONS:
            continue
        if node_id in (rel.get("from_node_id"), rel.get("to_node_id")):
            return True
    return False


def loop_anchor(graph: ModuleGraph, scene: dict[str, Any] | None) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """The `resets-to` relation that applies, and the anchor scene it points at. A relation
    whose endpoint is here (the scene itself, or an ending/event the scene holds) wins;
    otherwise the module's first declared reset, by node id, so two calls agree."""
    relations = sorted(_reset_relations(graph), key=lambda r: (str(r.get("from_node_id")), str(r.get("to_node_id"))))
    if not relations:
        return None
    chosen = None
    if scene is not None:
        chosen = next((r for r in relations if _here(graph, scene, str(r.get("from_node_id")))), None)
    chosen = chosen or relations[0]
    anchor = graph.nodes.get(str(chosen.get("to_node_id")))
    return (chosen, anchor) if anchor is not None else None


def loop_available(graph: ModuleGraph, scene: dict[str, Any]) -> bool:
    """§15.6: true when the loop can be rewound from where the party stands -- a
    `resets-to` whose source is this scene or something this scene holds."""
    return any(_here(graph, scene, str(rel.get("from_node_id"))) for rel in _reset_relations(graph))


def persisted_nodes(graph: ModuleGraph) -> list[dict[str, Any]]:
    """The nodes declared `persists-across-loop`: what a rewind leaves standing."""
    ids = {str(rel.get("from_node_id")) for rel in graph.raw.get("relations", [])
           if rel.get("relation_kind") == PERSIST_RELATION}
    return [graph.nodes[node_id] for node_id in sorted(ids) if node_id in graph.nodes]


def persisted_handles(graph: ModuleGraph) -> set[str]:
    return {graph.handle(node) for node in persisted_nodes(graph)}


def persisted_keys(graph: ModuleGraph) -> set[str]:
    """Normalized handles and display names, for matching sheet rows (an item, a
    condition) that carry a name rather than a node id."""
    keys: set[str] = set()
    for node in persisted_nodes(graph):
        keys.add(normalize(graph.handle(node)))
        keys.add(normalize(graph.display_name(node)))
    return keys


def remembers_across_loops(graph: ModuleGraph, node: dict[str, Any]) -> bool:
    """§15.2: the NPC record says so, or one of its `knows` relations is marked
    `across_loops`. No other NPC sees another loop."""
    if record_of(node).get(REMEMBERS_FIELD) is True or (node.get("properties") or {}).get(REMEMBERS_FIELD) is True:
        return True
    return any(rel.get("relation_kind") == KNOWS_RELATION
               and (rel.get("properties") or {}).get(ACROSS_LOOPS_PROPERTY) is True
               for rel in graph.out_rel.get(node["node_id"], []))


# ---- the anchor snapshot (§15.2) ----------------------------------------------------------

ANCHOR_SCHEMA = 1


def read_anchor(campaign: Campaign) -> dict[str, Any] | None:
    path = campaign.anchor_path
    if not path.exists():
        return None
    try:
        data = read_json(path)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("world") else None


def anchor_turn(campaign: Campaign, meta: dict[str, Any], anchor_handle: str) -> dict[str, Any] | None:
    """§15.2: the turn the party first entered the anchor scene, as `{turn, commit}`. When
    the anchor is the opening scene the answer is the campaign's own first commit -- the
    state the table was built with, before turn 0 was ever narrated."""
    repo, tree = campaign.repo_dir, campaign.dir
    if str(meta.get("opening_scene") or "") == anchor_handle:
        root = history.root_commit(repo, tree)
        return {"turn": 0, "commit": root} if root else None
    records = campaign.turn_records_by_number()
    for number in sorted(records):
        record = records[number]
        snapshot = record.get("world") if isinstance(record.get("world"), dict) else {}
        if str((snapshot.get("scene") or {}).get("name") or "") != anchor_handle:
            continue
        commit = record.get("commit")
        if commit:
            return {"turn": number, "commit": str(commit)}
    return None


def build_anchor(campaign: Campaign, anchor_handle: str, at: dict[str, Any], line: str) -> dict[str, Any]:
    """Read the world and the sheets as that commit had them. The turn record keeps only a
    summary of a turn, so the commit is the only place the whole world survives."""
    repo, tree = campaign.repo_dir, campaign.dir
    commit = str(at["commit"])
    raw = history.read_blob(repo, tree, commit, "world.json")
    if raw is None:
        raise RpcError("commit_failed", f"the anchor commit {commit} has no world.json",
                       details={"anchor": anchor_handle, "turn": at.get("turn")})
    party: dict[str, Any] = {}
    for path in history.list_tree(repo, tree, commit, "party/"):
        sheet_raw = history.read_blob(repo, tree, commit, path)
        if sheet_raw is None:
            continue
        sheet = json.loads(sheet_raw)
        if isinstance(sheet, dict) and sheet.get("id"):
            party[str(sheet["id"])] = sheet
    return {"schema": ANCHOR_SCHEMA, "scene": anchor_handle, "turn": int(at["turn"]), "commit": commit,
            "line": line, "world": json.loads(raw), "party": party, "created_at": now_iso()}


def write_anchor(campaign: Campaign, anchor: dict[str, Any]) -> None:
    write_json_atomic(campaign.anchor_path, anchor)


# ---- the reset a loop writes (§15.2) ------------------------------------------------------

def reset_world(anchor: dict[str, Any], world: dict[str, Any], graph: ModuleGraph,
                policy: dict[str, str]) -> dict[str, Any]:
    """The world the next loop starts in: the anchor's, plus whatever the module declared
    `persists-across-loop` and the clock when the reset says `keep`. A clue discovered on
    the last loop counts as discovered when it persists; everything else is undiscovered
    again, and so is the trail, the labels and where the NPCs stood."""
    reset = copy.deepcopy(anchor["world"])
    handles = persisted_handles(graph)
    discovered = list(reset.get("discovered_clues") or [])
    for clue in world.get("discovered_clues") or []:
        if str(clue) in handles and clue not in discovered:
            discovered.append(clue)
    reset["discovered_clues"] = discovered
    flags = dict(reset.get("flags") or {})
    for name, value in (world.get("flags") or {}).items():
        if str(name) in handles:
            flags[str(name)] = value
    reset["flags"] = flags
    if policy.get("clock") == RESET_KEEP:
        reset["clock"] = copy.deepcopy(world.get("clock") or {"minutes": 0})
    reset["active_scene"] = anchor["scene"]
    return reset


def reset_sheets(anchor: dict[str, Any], party: list[dict[str, Any]], graph: ModuleGraph,
                 policy: dict[str, str]) -> list[dict[str, Any]]:
    """The investigators the next loop starts with. `keep` leaves the sheets as the loop
    left them; `anchor` restores them, then carries back the equipment rows and conditions
    the module declared persistent (an object taken on the last loop is still in hand)."""
    if policy.get("investigators") == RESET_KEEP:
        return [copy.deepcopy(sheet) for sheet in party]
    keys = persisted_keys(graph)
    restored: list[dict[str, Any]] = []
    for sheet in party:
        base = anchor.get("party", {}).get(str(sheet.get("id")))
        if not isinstance(base, dict):
            restored.append(copy.deepcopy(sheet))
            continue
        fresh = copy.deepcopy(base)
        if keys:
            fresh["equipment"] = _carried(fresh.get("equipment"), sheet.get("equipment"), keys)
            fresh["weapons"] = _carried(fresh.get("weapons"), sheet.get("weapons"), keys)
            fresh["conditions"] = sorted({str(c) for c in (fresh.get("conditions") or [])}
                                         | {str(c) for c in (sheet.get("conditions") or [])
                                            if normalize(str(c)) in keys})
        restored.append(fresh)
    return restored


def _carried(base: Any, current: Any, keys: set[str]) -> list[Any]:
    """The anchor's rows plus the persistent ones the party still holds, by name."""
    rows = [row for row in (base if isinstance(base, list) else [])]
    held = {normalize(str((row or {}).get("name") or "")) for row in rows if isinstance(row, dict)}
    for row in current if isinstance(current, list) else []:
        if not isinstance(row, dict):
            continue
        key = normalize(str(row.get("name") or ""))
        if key in keys and key not in held:
            rows.append(copy.deepcopy(row))
            held.add(key)
    return rows


# ---- staging one worldline effect inside a batch (§15.3) ----------------------------------

def stage(campaign: Campaign, meta: dict[str, Any], graph: ModuleGraph, world: dict[str, Any],
          effect: dict[str, Any], turn: dict[str, Any], *, index: int, count: int,
          turn_number: int, call_id: str, mint: Mint) -> tuple[dict[str, Any], dict[str, Any]]:
    """Validate a `fork`/`switch` effect and return `(receipt, plan)`. Everything that can
    be known before the commit is decided here -- the name is free, the target exists, the
    module has an anchor -- so the keeper is refused inside the batch, not after the turn
    has already been delivered. The plan rides on `turn.json` and the turn record; the
    transition itself happens in `transition()` after `narrate` commits."""
    kind = str(effect.get("kind"))
    if turn.get("worldline"):
        raise invalid_params("a turn carries at most one worldline effect",
                             fix="fork or switch once per turn; the line changes after this turn commits",
                             details={"already": turn["worldline"].get("operation")})
    if index != count - 1:
        raise invalid_params("a worldline effect must be the last effect of its batch",
                             fix="apply everything the turn changed first, then fork or switch",
                             details={"index": index, "effects": count})
    lines = registry(meta)
    source = active_name(meta)
    label = effect.get("label")
    label = label.strip() if isinstance(label, str) and label.strip() else None
    if kind == MERGE:
        # local: confluence reads this module's registry; the import cannot be at load time
        from . import confluence
        plan = confluence.plan(campaign, graph, meta, effect, source, turn_number)
        plan["label"] = label
        plan["source_turn"] = turn_number
        receipt = confluence.receipt_of(plan, turn_number, call_id, label, mint)
        plan["receipt"] = receipt["id"]
        return receipt, plan
    plan = _fork_plan(campaign, meta, graph, world, effect, lines, source, turn_number) if kind == FORK \
        else _switch_plan(campaign, lines, source, effect)
    plan["label"] = label
    plan["source_turn"] = turn_number
    if plan["from"].get("turn") is None:
        plan["from"]["turn"] = turn_number
    receipt = {
        "id": mint(f"{kind}:{plan['line']}-t{turn_number}"),
        "kind": "worldline",
        "call_id": call_id,
        "operation": kind,
        "line": plan["line"],
        "mode": plan.get("mode"),
        "loop": plan["loop"],
        "from": {"line": source, "turn": plan["from"]["turn"]},
        "label": label,
        "visibility": "public",
        "at": now_iso(),
    }
    plan["receipt"] = receipt["id"]
    return receipt, plan


def _fork_plan(campaign: Campaign, meta: dict[str, Any], graph: ModuleGraph, world: dict[str, Any],
               effect: dict[str, Any], lines: dict[str, Any], source: str, turn_number: int) -> dict[str, Any]:
    name = validate_name(effect.get("name"), what="name")
    if name in lines or history.line_commit(campaign.repo_dir, campaign.dir, name) is not None:
        raise invalid_params(f"worldline {name!r} already exists",
                             fix="pick a name no line has, or switch to it",
                             details={"lines": sorted(lines)})
    mode = effect.get("mode")
    if mode not in MODES:
        raise invalid_params(f"fork mode must be one of {list(MODES)}",
                             fix="if branches the line as it stands; loop rewinds to the module's anchor",
                             details={"mode": mode})
    parent = lines.get(source) if isinstance(lines.get(source), dict) else {}
    plan: dict[str, Any] = {"operation": FORK, "line": name, "mode": mode,
                            "from": {"line": source, "turn": turn_number, "commit": None},
                            "loop": int(parent.get("loop") or 0)}
    if mode == MODE_IF:
        from_turn = effect.get("from_turn")
        if from_turn is not None:
            if not isinstance(from_turn, int) or isinstance(from_turn, bool) or from_turn < 0:
                raise invalid_params("from_turn must be a turn number", details={"from_turn": from_turn})
            if from_turn != turn_number:
                record = campaign.read_turn_record(int(from_turn))
                if record is None or not record.get("commit"):
                    closed = [n for n, r in sorted(campaign.turn_records_by_number().items()) if r.get("commit")]
                    raise invalid_params(f"turn {from_turn} has no commit on this line",
                                         fix="fork from a turn this line committed, or omit from_turn for this one",
                                         details={"from_turn": from_turn, "committed_turns": closed})
                plan["from"] = {"line": source, "turn": int(from_turn), "commit": str(record["commit"])}
        return plan
    anchor = loop_anchor(graph, graph.scene(world["active_scene"]))
    if anchor is None:
        raise invalid_params("this module declares no loop anchor",
                             fix="mode: if forks the line as it stands",
                             details={"module": graph.module_id, "relation": RESET_RELATION})
    relation, anchor_node = anchor
    handle = graph.handle(anchor_node)
    at = read_anchor(campaign)
    at = {"turn": at["turn"], "commit": at["commit"]} if at and at.get("scene") == handle \
        else anchor_turn(campaign, meta, handle)
    if at is None:
        raise invalid_params(f"the party has never been in the anchor scene {handle!r}",
                             fix="the loop can only rewind to a scene this line has played",
                             details={"anchor": handle})
    plan["loop"] = int(parent.get("loop") or 0) + 1
    plan["anchor"] = {"scene": handle, **at}
    plan["reset"] = reset_policy(relation)
    return plan


def _switch_plan(campaign: Campaign, lines: dict[str, Any], source: str,
                 effect: dict[str, Any]) -> dict[str, Any]:
    name = validate_name(effect.get("line"), what="line")
    row = lines.get(name)
    if not isinstance(row, dict) or history.line_commit(campaign.repo_dir, campaign.dir, name) is None:
        raise invalid_params(f"no worldline {name!r}",
                             fix="switch to a line this campaign has, or fork one",
                             details={"lines": sorted(lines)})
    if row.get("status") == STATUS_MERGED:
        raise invalid_params(f"worldline {name!r} was merged and cannot be played again",
                             details={"line": name, "status": STATUS_MERGED})
    if name == source:
        raise invalid_params(f"worldline {name!r} is already the active line",
                             details={"line": name})
    return {"operation": SWITCH, "line": name, "mode": None,
            "from": {"line": source, "turn": None, "commit": None},
            "loop": int(row.get("loop") or 0)}


# ---- performing it after the commit (§15.3) ----------------------------------------------

def transition(campaign: Campaign, graph: ModuleGraph, plan: dict[str, Any],
               turn_number: int) -> dict[str, Any]:
    """Perform a staged fork or switch. The turn is already committed, so this leaves the
    source line sealed at that commit and lands the work tree on the new one; when
    anything here fails, the reference goes back and the campaign stays where it was
    playing. Returns the telemetry row, which also carries the events to append."""
    if plan["operation"] == MERGE:
        from . import confluence  # local: see stage()
        return confluence.perform(campaign, graph, plan, turn_number)
    repo, tree = campaign.repo_dir, campaign.dir
    meta = campaign.read_campaign()
    before = copy.deepcopy(meta)
    source = str(plan["from"]["line"])
    target = str(plan["line"])
    lines = dict(registry(meta))
    if plan["operation"] == FORK and plan.get("mode") == MODE_LOOP and read_anchor(campaign) is None:
        write_anchor(campaign, build_anchor(campaign, str(plan["anchor"]["scene"]),
                                            plan["anchor"], source))
    # Seal the line before leaving it: a turn always leaves residue behind its own commit
    # (the record learning its sha), and a checkout refuses a dirty tree.
    seal = history.commit_if_dirty(repo, tree, f"worldline {source}: sealed at turn {turn_number}")
    base = seal or history.head_sha(repo, tree)
    branch_created = False
    try:
        if plan["operation"] == FORK:
            fork_commit = str(plan["from"].get("commit") or base)
            plan["from"]["commit"] = fork_commit
            history.create_branch(repo, tree, target, fork_commit)
            branch_created = True
        history.checkout(repo, tree, target)
        row = lines.get(source)
        if isinstance(row, dict):
            row["status"] = STATUS_DORMANT
            row["last_turn"] = turn_number
            row["last_commit"] = base
        if plan["operation"] == FORK:
            lines[target] = new_line(campaign.id, target, KIND_LOOP if plan.get("mode") == MODE_LOOP else KIND_IF,
                                     int(plan["loop"]), dict(plan["from"]))
        else:
            target_row = lines.get(target)
            if isinstance(target_row, dict):
                target_row["status"] = STATUS_ACTIVE
        meta["worldlines"] = lines
        meta["active_worldline"] = target
        campaign.write_campaign(meta)
        message = f"worldline {target}: forked from {source} at turn {turn_number}" \
            if plan["operation"] == FORK else f"worldline {target}: resumed from {source} at turn {turn_number}"
        if plan["operation"] == FORK and plan.get("mode") == MODE_LOOP:
            _write_reset(campaign, graph, plan)
            # §15.4: the loop the party just left becomes echoes on the new one -- the
            # doors it opened, the clues it took, the fights and the deaths, as receipts.
            fresh = echoes_mod.generate(campaign, source, int(lines.get(source, {}).get("loop") or 0))
            echoes_mod.write(campaign, echoes_mod.merged_into(echoes_mod.read(campaign), fresh))
            campaign.write_campaign(meta)
            message = f"loop {plan['loop']} reset"
        landed = history.commit_if_dirty(repo, tree, message) or history.head_sha(repo, tree)
        lines[target]["last_commit"] = landed
        lines[target]["last_turn"] = campaign.read_turn().get("turn") if campaign.turn_json.exists() else None
        campaign.write_campaign(meta)
    except Exception:
        # §15.8: a failed state write rolls the reference back; the line the table was
        # playing keeps everything and the branch this call invented is undone.
        try:
            history.checkout(repo, tree, source, force=True)
            if branch_created:
                history.delete_branch(repo, tree, target)
            campaign.write_campaign(before)
        except Exception:  # noqa: BLE001 - the rollback is best effort; the raise below reports
            pass
        raise
    return {"operation": plan["operation"], "line": target, "from": source, "mode": plan.get("mode"),
            "loop": int(plan["loop"]), "seal": base, "commit": lines[target].get("last_commit")}


def _write_reset(campaign: Campaign, graph: ModuleGraph, plan: dict[str, Any]) -> None:
    anchor = read_anchor(campaign)
    if anchor is None:
        raise RpcError("commit_failed", "the loop anchor snapshot is missing",
                       details={"anchor": plan.get("anchor")})
    policy = plan.get("reset") if isinstance(plan.get("reset"), dict) else dict(DEFAULT_RESET)
    world = campaign.read_world()
    party = campaign.party()
    campaign.write_world(reset_world(anchor, world, graph, policy))
    for sheet in reset_sheets(anchor, party, graph, policy):
        campaign.write_sheet(sheet)


def event_of(plan: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """§12.1: one canonical event per performed transition. It is appended to the line the
    table landed on, at that line's next turn number, and names where it came from; the
    line it left keeps the receipt and the plan in its own turn record."""
    if plan["operation"] == FORK:
        return "worldline-forked", {"name": plan["line"], "mode": plan.get("mode"), "loop": int(plan["loop"]),
                                    "from": dict(plan["from"])}
    if plan["operation"] == MERGE:
        return "worldline-merged", {"name": plan["line"], "lines": list(plan.get("lines") or []),
                                    "into": plan.get("into"),
                                    "conflicts": len((plan.get("report") or {}).get("conflicts") or [])}
    return "worldline-switched", {"line": plan["line"], "from": dict(plan["from"])}


# ---- the capsule section (§15.6) -----------------------------------------------------------

def capsule_section(graph: ModuleGraph, campaign: Campaign, meta: dict[str, Any], world: dict[str, Any],
                    scene: dict[str, Any], present: list[dict[str, Any]]) -> dict[str, Any]:
    """What the keeper needs to run a loop: which line this is, which circuit, where the
    anchor is, what a rewind would leave standing, who would remember it, and every line
    the campaign has. Echoes (§15.4) and the previous loop's memory (§15.5) are the second
    half of this slice; their keys are here and empty so the shape never changes."""
    row = active_line(meta)
    anchor = read_anchor(campaign)
    if anchor is None:
        found = loop_anchor(graph, scene)
        anchor_view = None
        if found is not None:
            handle = graph.handle(found[1])
            at = anchor_turn(campaign, meta, handle)
            anchor_view = {"scene": handle, "since_turn": (at or {}).get("turn")}
    else:
        anchor_view = {"scene": anchor.get("scene"), "since_turn": anchor.get("turn")}
    lines = registry(meta)
    loop = int(row.get("loop") or 0)
    standing = echoes_mod.here(echoes_mod.read(campaign), graph.handle(scene),
                               world.get("discovered_echoes"))
    return {
        "line": row.get("name"),
        "kind": row.get("kind"),
        "loop": loop,
        "anchor": anchor_view,
        "persisted": [graph.display_name(n) for n in persisted_nodes(graph)],
        "remembers": [graph.display_name(n) for n in present if remembers_across_loops(graph, n)],
        "echoes_here": len(standing),
        "echoes": [{"id": echo["id"], "summary": echo.get("summary")} for echo in standing[:ECHO_LIMIT]],
        "previous_loop": previous_loop(campaign, loop),
        "lines": [{"name": name, "kind": line.get("kind"), "loop": int(line.get("loop") or 0),
                   "last_turn": line.get("last_turn"), "status": line.get("status")}
                  for name, line in sorted(lines.items())][:LINES_LIMIT],
        "loop_available": loop_available(graph, scene),
    }


def previous_loop(campaign: Campaign, loop: int) -> list[dict[str, Any]]:
    """§15.6: what the investigators carry over from the circuit before this one. A `loop`
    branch keeps the last loop's candidates in its own `memory/` file, so this is a filter
    on what is already on disk -- ranked as `recall memory` ranks with no `about` to weigh:
    the kind tier, then the most recent turn, then the id."""
    if loop <= 0:
        return []
    rows = [row for row in memory.read_candidates(campaign)
            if int(row.get("loop") or 0) == loop - 1 and row.get("superseded_by") is None]
    rows.sort(key=lambda row: (memory.kind_rank(row.get("kind")),
                               -int(row.get("valid_from_turn") or 0), str(row.get("id"))))
    return [{"statement": row.get("statement"), "turn": row.get("valid_from_turn")}
            for row in rows[:PREVIOUS_LOOP_LIMIT]]


def cross_line_reader(campaign: Campaign, graph: ModuleGraph, meta: dict[str, Any],
                      index: Any) -> Callable[[dict[str, Any]], list[dict[str, Any]]]:
    """§15.5: a reader that answers, for one person, what they know from another circuit or
    another line -- and answers nothing at all for anyone the module did not declare
    `remembers_across_loops`. The union over the branches is read once, and only if some
    declared NPC is actually on stage."""
    line, loop = active_name(meta), int(active_line(meta).get("loop") or 0)
    rows: list[dict[str, Any]] | None = None

    def read(node: dict[str, Any]) -> list[dict[str, Any]]:
        nonlocal rows
        if not remembers_across_loops(graph, node):
            return []
        if rows is None:
            rows = memory.candidates_for(campaign, meta, memory.LINE_ANY)
        return memory.from_other_lines(rows, index, graph.display_name(node), line, loop,
                                       FROM_OTHER_LINES_LIMIT)

    return read


def loop_obligation(section: dict[str, Any]) -> list[dict[str, Any]]:
    """§15.6: a scene that can rewind puts one obligation on the slate; whether to offer
    the player the choice is the keeper's."""
    if not section.get("loop_available"):
        return []
    anchor = section.get("anchor") or {}
    return [{"kind": "loop", "name": str(anchor.get("scene") or "loop"), "who": "keeper",
             "state": f"loop {section.get('loop', 0)}", "cue": LOOP_OBLIGATION}]


def director_signals(section: dict[str, Any]) -> dict[str, Any]:
    """§15.6: three signals into `director.because`; they add no number to the scoring."""
    return {"loop_count": int(section.get("loop") or 0),
            "echoes_here": int(section.get("echoes_here") or 0),
            "loop_available": bool(section.get("loop_available"))}
