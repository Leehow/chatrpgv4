"""Memory (contract §12.3, §12.4 memory road): episodes, extraction jobs, candidate
assertions, backlog.

Three laws carried over from the old tree, unchanged:
- candidates never promote: nothing here turns a candidate into state or a rule fact;
- contradictions never delete: a superseded relationship keeps its row and gains
  `valid_until_turn` + `superseded_by`, so both records stay addressable;
- extraction never blocks `narrate`: everything that can fail lands in the backlog.

Name resolution is exact after normalization, over the names the job packet listed
(or, for recall, every name the graph and the party know). No prose is read to decide
anything; ambiguity is an error, never an auto-pick."""

from __future__ import annotations

import json
import re
from typing import Any

from .errors import RpcError, invalid_params
from .facts import committed_facts, instruction, prose_of
from .fileio import (append_jsonl, canonical_json, read_json, read_jsonl, sha256_text, write_json_atomic,
                     write_text_atomic)
from .module_graph import CLUE_KIND, NPC_KIND, SCENE_KIND, ModuleGraph
from .store import Campaign, now_iso
from .text import normalize

CANDIDATE_KINDS = ("world_event", "knowledge", "belief", "relationship", "player_assertion",
                   "player_preference", "keeper_correction", "promise")
#: #20 (§12.4): after overlap with `about`, hits rank by kind — what happened, what is
#: known, who stands where and what was promised come before what is believed or
#: preferred; a player_assertion comes last (it mostly restates player input the keeper
#: has already read). Closed tiers over CANDIDATE_KINDS; ties fall to recency, then id.
KIND_RANK_TIERS = (("world_event", "knowledge", "relationship", "promise"),
                   ("belief", "player_preference", "keeper_correction"),
                   ("player_assertion",))
#: Kinds where a new row with the same subject and entities closes the old one (§12.3 for
#: relationship, §13.5 for promise); every other kind only accumulates.
SUPERSEDING_KINDS = ("relationship", "promise")
CANDIDATE_FIELDS = frozenset({"kind", "subject", "knowers", "statement", "entities", "privacy", "state", "confidence"})
MACHINE_KEYS = frozenset({"commit", "receipt", "receipts", "turn", "id", "job_id", "episode_id", "call_id", "source"})
PRIVACY = ("player_safe", "keeper_only")
STATES = ("accurate", "uncertain", "distorted")
RESERVED_SUBJECTS = ("world", "party", "keeper", "player")
KNOWER_RESERVED = ("party", "keeper", "player")
FAIL_REASONS = ("invalid", "lane_error", "model_error")
MAX_CANDIDATES = 12
MAX_STATEMENT_CHARS = 400
PRIOR_LIMIT = 12
RECALL_DEFAULT_LIMIT = 12
RECALL_MAX_LIMIT = 30
ENTITY_KINDS = (NPC_KIND, SCENE_KIND, CLUE_KIND)

JOB_ID = re.compile(r"^extract:(?P<campaign>[A-Za-z0-9][A-Za-z0-9._-]{0,63}):t(?P<turn>\d+)$")


# ---- entity index -------------------------------------------------------------------------

class EntityIndex:
    """Names → canonical keys. `allowed` restricts graph nodes to the job's known entities;
    None means the whole graph (recall)."""

    def __init__(self, graph: ModuleGraph, party: list[dict[str, Any]], allowed: list[str] | None = None,
                 scene_labels: dict[str, str] | None = None) -> None:
        self.graph = graph
        self.party = party
        self.allowed = list(allowed) if allowed is not None else None
        # The keeper's own names for scenes (world.scene_labels) resolve like aliases;
        # stored rows keep the graph's name so a relabel never orphans them.
        self.scene_labels = {str(k): str(v) for k, v in (scene_labels or {}).items()}

    @staticmethod
    def node_key(node: dict[str, Any]) -> str:
        return f"{node['node_kind']}:{node['node_id']}"

    def canonical_name(self, key: str) -> str:
        kind, _, rest = key.partition(":")
        if kind == "reserved":
            return rest
        if kind == "investigator":
            for sheet in self.party:
                if str(sheet.get("id")) == rest:
                    return str(sheet.get("name") or rest)
            return rest
        node = self.graph.nodes.get(rest)
        if node is None:
            return rest
        # A clue's authored name is its summary sentence; the keeper knows it by its handle.
        return self.graph.handle(node) if node["node_kind"] == CLUE_KIND else self.graph.display_name(node)

    def describe(self, key: str) -> dict[str, str]:
        """A candidate the keeper can name unambiguously: the canonical name plus the id
        that resolves to exactly this entity (sheet id, or the graph handle)."""
        kind, _, rest = key.partition(":")
        if kind == "reserved":
            return {"name": rest, "kind": "reserved", "id": rest}
        if kind == "investigator":
            return {"name": self.canonical_name(key), "kind": "investigator", "id": rest}
        # The graph's own kind-prefixed id: a handle can collide with a name under
        # normalization (steven-knott == Steven Knott), the node id cannot.
        return {"name": self.canonical_name(key), "kind": kind, "id": rest}

    def matches(self, name: str, *, reserved: tuple[str, ...] = RESERVED_SUBJECTS,
                kinds: tuple[str, ...] = ENTITY_KINDS, investigators: bool = True) -> list[str]:
        key = normalize(name)
        if not key:
            return []
        found: list[str] = []
        if key in reserved:
            found.append(f"reserved:{key}")
        if investigators:
            for sheet in self.party:
                if key in {normalize(str(sheet.get("id"))), normalize(str(sheet.get("name")))}:
                    found.append(f"investigator:{sheet.get('id')}")
        for node_id in sorted(self.graph._names.get(key, ())):
            node = self.graph.nodes[node_id]
            if node["node_kind"] not in kinds:
                continue
            if self.allowed is not None and node_id not in self.allowed:
                continue
            found.append(self.node_key(node))
        if SCENE_KIND in kinds:
            for handle, label in self.scene_labels.items():
                if normalize(label) != key:
                    continue
                node = self.graph.find(handle, (SCENE_KIND,))
                if node and (self.allowed is None or node["node_id"] in self.allowed):
                    key_of = self.node_key(node)
                    if key_of not in found:
                        found.append(key_of)
        return found

    def loose_matches(self, name: str, *, kinds: tuple[str, ...] = ENTITY_KINDS) -> list[str]:
        """When the exact name was not given, a whole word of one: 'Knott' names Steven
        Knott. People (investigators, NPCs) win over places and clues that carry the same
        word; what stays ambiguous is an error, never a guess."""
        key = normalize(name)
        if not key:
            return []
        people: list[str] = []
        others: list[str] = []
        for sheet in self.party:
            words = set(normalize(str(sheet.get("name"))).split()) | set(normalize(str(sheet.get("id"))).split())
            if key in words:
                people.append(f"investigator:{sheet.get('id')}")
        for kind in kinds:
            for node in self.graph.by_kind.get(kind, []):
                if self.allowed is not None and node["node_id"] not in self.allowed:
                    continue
                words: set[str] = set()
                for alias in (self.graph.display_name(node), self.graph.handle(node), node.get("node_id"),
                              self.scene_labels.get(self.graph.handle(node)) if kind == SCENE_KIND else None):
                    if alias:
                        words |= set(normalize(str(alias)).split())
                if key in words:
                    (people if kind == NPC_KIND else others).append(self.node_key(node))
        return people if people else others

    def usable_names(self) -> list[str]:
        names = [str(sheet.get("name")) for sheet in self.party]
        ids = self.allowed if self.allowed is not None else [
            n["node_id"] for kind in ENTITY_KINDS for n in self.graph.by_kind.get(kind, [])]
        for node_id in ids:
            if node_id in self.graph.nodes:
                names.append(self.canonical_name(f"x:{node_id}"))
        return names

    def lenient_key(self, name: str) -> str:
        """For stored rows: the canonical key when the name resolves uniquely, else the
        normalized name itself so an unresolvable stored name still matches itself."""
        found = self.matches(name)
        return found[0] if len(found) == 1 else f"name:{normalize(name)}"


def known_entities_for(graph: ModuleGraph, party: list[dict[str, Any]], scene: dict[str, Any],
                       present: list[dict[str, Any]], clue_handles: list[str],
                       scene_name: str | None = None) -> tuple[list[dict[str, str]], list[str]]:
    """The names a job packet lists: investigators, present NPCs, the scene, the clues
    found so far. Returns (rows, allowed node ids in the same order)."""
    rows: list[dict[str, str]] = [{"name": str(s.get("name")), "kind": "investigator"} for s in party]
    allowed: list[str] = []
    for node in present:
        rows.append({"name": graph.display_name(node), "kind": "npc"})
        allowed.append(node["node_id"])
    rows.append({"name": scene_name or graph.display_name(scene), "kind": "scene"})
    allowed.append(scene["node_id"])
    for handle in clue_handles:
        node = graph.find(handle, (CLUE_KIND,))
        if node and node["node_id"] not in allowed:
            rows.append({"name": graph.handle(node), "kind": "clue"})
            allowed.append(node["node_id"])
    return rows, allowed


# ---- episodes -----------------------------------------------------------------------------

def episode_id(turn: int) -> str:
    return f"ep:t{turn}"


def write_episode(campaign: Campaign, record: dict[str, Any]) -> dict[str, Any]:
    snapshot = record.get("world") or {}
    receipts = list(record.get("receipts") or [])
    episode = {
        "episode_id": episode_id(int(record["turn"])),
        "turn": int(record["turn"]),
        "commit": record.get("commit"),
        "scene": (snapshot.get("scene") or {}).get("name"),
        "present": list(snapshot.get("present") or []),
        "investigators": [str(i.get("id")) for i in snapshot.get("investigators") or []],
        "receipts": [r["id"] for r in receipts],
        "clues_discovered": [r.get("label") or r.get("clue") for r in receipts if r.get("kind") == "clue"],
        "player_chars": len(record.get("player_text") or ""),
        "keeper_chars": len(record.get("rendered_text") or ""),
        "at": now_iso(),
    }
    append_jsonl(campaign.episodes_path, episode)
    return episode


# ---- jobs ---------------------------------------------------------------------------------

def job_id_for(campaign_id: str, turn: int) -> str:
    return f"extract:{campaign_id}:t{turn}"


def parse_job_id(campaign: Campaign, job_id: Any) -> int:
    match = JOB_ID.match(job_id) if isinstance(job_id, str) else None
    if match is None or match.group("campaign") != campaign.id:
        raise invalid_params("job_id must be the extract:<campaign>:t<n> that memory.job returned",
                             details={"job_id": job_id})
    return int(match.group("turn"))


def read_job(campaign: Campaign, job_id: str) -> dict[str, Any] | None:
    path = campaign.jobs_dir / f"{job_id}.json"
    if not path.exists():
        return None
    try:
        data = read_json(path)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def write_job(campaign: Campaign, job: dict[str, Any]) -> None:
    write_json_atomic(campaign.jobs_dir / f"{job['job_id']}.json", job)


def pending_backlog_turns(campaign: Campaign) -> set[int]:
    return {int(row["turn"]) for row in read_jsonl(campaign.backlog_path)
            if row.get("status") == "pending" and isinstance(row.get("turn"), int)}


def committed_records(campaign: Campaign) -> dict[int, dict[str, Any]]:
    return {n: r for n, r in campaign.turn_records_by_number().items()
            if r.get("closed_by") == "narrate" and r.get("commit")}


def default_job_turn(campaign: Campaign) -> int | None:
    """The latest committed turn with no completed job and no pending backlog row."""
    skip = pending_backlog_turns(campaign)
    for number in sorted(committed_records(campaign), reverse=True):
        if number in skip:
            continue
        job = read_job(campaign, job_id_for(campaign.id, number))
        if job and job.get("status") == "done":
            continue
        return number
    return None


def clues_known_by(records: dict[int, dict[str, Any]], turn: int) -> list[str]:
    handles: list[str] = []
    for number in sorted(records):
        if number > turn:
            break
        for receipt in records[number].get("receipts") or []:
            if receipt.get("kind") == "clue" and receipt.get("clue") not in handles:
                handles.append(str(receipt["clue"]))
    return handles


def build_job(campaign: Campaign, graph: ModuleGraph, language: str, turn: int,
              party: list[dict[str, Any]], world: dict[str, Any]) -> dict[str, Any]:
    """The packet for one committed turn, rebuilt from the turn record every time (an
    episode or an earlier job file is not required, §12.6). Names only: `turn` and
    `commit` are the extension's telemetry keys, not prompt material."""
    records = committed_records(campaign)
    record = records.get(turn)
    if record is None:
        raise invalid_params(f"turn {turn} has no committed record",
                             fix="only turns closed by narrate have extraction jobs",
                             details={"turn": turn, "committed_turns": sorted(records)})
    snapshot = record.get("world") if isinstance(record.get("world"), dict) else {}
    scene_name = (snapshot.get("scene") or {}).get("name") or world.get("active_scene")
    scene = graph.scene(str(scene_name))
    present_names = list(snapshot.get("present") or [])
    present = [node for name in present_names if (node := graph.find(str(name), (NPC_KIND,)))]
    labels = campaign.read_world().get("scene_labels") or {}
    scene_name = str(labels.get(graph.handle(scene)) or graph.display_name(scene))
    known, allowed = known_entities_for(graph, party, scene, present, clues_known_by(records, turn), scene_name=scene_name)
    labels = {str(i.get("id")): str(i.get("name")) for i in snapshot.get("investigators") or []}
    facts = record.get("facts") or {}
    committed = list(facts.get("committed") or []) or committed_facts(
        language, list(record.get("receipts") or []), snapshot, lambda actor: labels.get(actor, actor),
        player_text=record.get("player_text"))
    about = [row["name"] for row in known if row["kind"] in ("investigator", "npc")]
    prior = [{"id": h["id"], "kind": h["kind"], "subject": h["subject"], "statement": h["statement"],
              "status": h["status"], "turn": h["turn"]}
             for h in query_candidates(campaign, EntityIndex(graph, party, scene_labels=labels), about=about, narrow=False,
                                       limit=PRIOR_LIMIT)]
    return {
        "job_id": job_id_for(campaign.id, turn),
        "turn": turn,
        "commit": record.get("commit"),
        "scene": {"name": graph.handle(scene), "display_name": scene_name},
        "present": [graph.display_name(n) for n in present],
        "investigators": [{"id": str(s.get("id")), "name": str(s.get("name"))} for s in party],
        "player_text": record.get("player_text"),
        "keeper_text": prose_of(record.get("rendered_text")),
        "committed_facts": committed,
        "known_entities": known,
        "prior": prior,
        "budget": {"max_candidates": MAX_CANDIDATES, "max_statement_chars": MAX_STATEMENT_CHARS},
        "instruction": instruction(language),
        "_allowed": allowed,
        "_receipts": [r["id"] for r in record.get("receipts") or []],
    }


def open_job(campaign: Campaign, packet: dict[str, Any]) -> dict[str, Any]:
    """Persist the packet as an open job unless the job already completed or failed."""
    allowed = packet.pop("_allowed")
    receipts = packet.pop("_receipts")
    existing = read_job(campaign, packet["job_id"])
    if existing and existing.get("status") in ("done", "failed"):
        return packet
    write_job(campaign, {"job_id": packet["job_id"], "turn": packet["turn"], "commit": packet["commit"],
                         "status": "open", "opened_at": now_iso(), "packet": packet, "allowed": allowed,
                         "receipts": receipts})
    return packet


# ---- submit -------------------------------------------------------------------------------

def _reject(index: int, message: str, fix: str, **details: Any) -> RpcError:
    return invalid_params(message, fix=fix, details={"index": index, **details})


def _resolve_name(entity_index: EntityIndex, index: int, field: str, name: Any, **kw: Any) -> str:
    if not isinstance(name, str) or not name.strip():
        raise _reject(index, f"candidates[{index}].{field} must be a name",
                      f"use one of: {', '.join(entity_index.usable_names())}", field=field)
    found = entity_index.matches(name, **kw)
    if len(found) == 1:
        return found[0]
    usable = entity_index.usable_names()
    if not found:
        raise _reject(index, f"candidates[{index}].{field}: {name!r} is not a known name",
                      f"use one of: {', '.join(usable)}", field=field, name=name, candidates=usable)
    described = [entity_index.describe(k) for k in found]
    raise _reject(index, f"candidates[{index}].{field}: {name!r} names {len(found)} entities",
                  "say which one by id: " + ", ".join(f"{d['id']} ({d['kind']} {d['name']})" for d in described),
                  field=field, name=name, candidates=described)


def validate_candidates(entity_index: EntityIndex, candidates: Any) -> list[dict[str, Any]]:
    """Closed validation. Returns normalized rows (names canonical, keys attached under
    `_keys` for supersession) or raises invalid_params pointing at `details.index`."""
    if not isinstance(candidates, list):
        raise invalid_params("params.candidates must be a list")
    if len(candidates) > MAX_CANDIDATES:
        raise invalid_params(f"at most {MAX_CANDIDATES} candidates per job",
                             fix=f"keep the {MAX_CANDIDATES} most important", details={"index": MAX_CANDIDATES})
    rows: list[dict[str, Any]] = []
    for i, candidate in enumerate(candidates):
        if not isinstance(candidate, dict):
            raise _reject(i, f"candidates[{i}] must be an object", "give kind, subject and statement")
        machine = sorted(k for k in candidate if k in MACHINE_KEYS)
        if machine:
            raise _reject(i, f"candidates[{i}] carries machine keys {machine}",
                          "drop them; the kernel attaches turn, commit and receipts itself", fields=machine)
        unknown = sorted(k for k in candidate if k not in CANDIDATE_FIELDS)
        if unknown:
            raise _reject(i, f"candidates[{i}] has unknown fields {unknown}",
                          f"allowed fields: {', '.join(sorted(CANDIDATE_FIELDS))}", fields=unknown)
        kind = candidate.get("kind")
        if kind not in CANDIDATE_KINDS:
            raise _reject(i, f"candidates[{i}].kind {kind!r} is not a kind", f"one of: {', '.join(CANDIDATE_KINDS)}")
        statement = candidate.get("statement")
        if not isinstance(statement, str) or not 1 <= len(statement.strip()) <= MAX_STATEMENT_CHARS:
            raise _reject(i, f"candidates[{i}].statement must be 1–{MAX_STATEMENT_CHARS} characters",
                          "shorten or split the statement")
        subject_key = _resolve_name(entity_index, i, "subject", candidate.get("subject"))
        if kind == "world_event" and subject_key != "reserved:world":
            raise _reject(i, f"candidates[{i}]: a world_event's subject must be world",
                          "set subject to world, or choose knowledge/belief for what someone knows")
        knowers = candidate.get("knowers", [])
        if knowers is None:
            knowers = []
        if not isinstance(knowers, list):
            raise _reject(i, f"candidates[{i}].knowers must be a list of names", "list investigators, NPCs, party, keeper or player")
        knower_keys = [_resolve_name(entity_index, i, "knowers", k, reserved=KNOWER_RESERVED, kinds=(NPC_KIND,))
                       for k in knowers]
        entities = candidate.get("entities", [])
        if entities is None:
            entities = []
        if not isinstance(entities, list):
            raise _reject(i, f"candidates[{i}].entities must be a list of names", "list the names the statement is about")
        entity_keys = [_resolve_name(entity_index, i, "entities", e, reserved=()) for e in entities]
        if kind == "relationship" and len(entity_keys) != 1:
            raise _reject(i, f"candidates[{i}]: a relationship names exactly one entity, got {len(entity_keys)}",
                          "put the other party of the relationship, alone, in entities")
        privacy = candidate.get("privacy", "player_safe")
        if privacy not in PRIVACY:
            raise _reject(i, f"candidates[{i}].privacy {privacy!r}", f"one of: {', '.join(PRIVACY)}")
        state = candidate.get("state", "accurate")
        if state not in STATES:
            raise _reject(i, f"candidates[{i}].state {state!r}", f"one of: {', '.join(STATES)}")
        confidence = candidate.get("confidence")
        if confidence is not None and (isinstance(confidence, bool) or not isinstance(confidence, (int, float))
                                       or not 0 <= confidence <= 1):
            raise _reject(i, f"candidates[{i}].confidence must be a number from 0 to 1", "omit it or give 0–1")
        rows.append({
            "kind": kind,
            "subject": entity_index.canonical_name(subject_key),
            "knowers": [entity_index.canonical_name(k) for k in knower_keys],
            "entities": [entity_index.canonical_name(k) for k in entity_keys],
            "statement": statement.strip(),
            "privacy": privacy,
            "state": state,
            "confidence": confidence,
            "_keys": {"subject": subject_key, "entities": sorted(entity_keys)},
        })
    return rows


def read_candidates(campaign: Campaign) -> list[dict[str, Any]]:
    return read_jsonl(campaign.candidates_path)


def write_candidates(campaign: Campaign, rows: list[dict[str, Any]]) -> None:
    write_text_atomic(campaign.candidates_path, "".join(canonical_line(r) for r in rows))


def canonical_line(row: dict[str, Any]) -> str:
    return json.dumps(row, ensure_ascii=False) + "\n"


def candidates_digest(candidates: Any) -> str:
    return sha256_text(canonical_json(candidates))


def submit(campaign: Campaign, graph: ModuleGraph, party: list[dict[str, Any]], job: dict[str, Any],
           candidates: Any) -> tuple[dict[str, Any], bool]:
    """Validate, land, supersede. Returns (result, replayed). Same job + same content is
    idempotent; different content on a completed job is `idempotency_conflict`."""
    job_id = str(job["job_id"])
    turn = int(job["turn"])
    digest = candidates_digest(candidates)
    if job.get("status") == "done":
        if job.get("candidates_sha256") == digest:
            return dict(job.get("result") or {}), True
        raise RpcError("idempotency_conflict", f"job {job_id} already completed with different candidates",
                       fix="a completed job is final; nothing to resubmit", details={"job_id": job_id})
    entity_index = EntityIndex(graph, party, list(job.get("allowed") or []),
                               scene_labels=campaign.read_world().get("scene_labels"))
    try:
        rows = validate_candidates(entity_index, candidates)
    except RpcError as exc:
        if exc.code == "invalid_params":
            append_backlog(campaign, job_id, turn, "invalid", exc.message)
        raise
    existing = read_candidates(campaign)
    used = [int(r["id"].rsplit("-", 1)[1]) for r in existing
            if str(r.get("id", "")).startswith(f"mem:t{turn}-") and r["id"].rsplit("-", 1)[1].isdigit()]
    next_k = max(used, default=0) + 1
    graph_index = EntityIndex(graph, party, scene_labels=campaign.read_world().get("scene_labels"))
    written: list[dict[str, Any]] = []
    superseded: list[str] = []
    for row in rows:
        keys = row.pop("_keys")
        new_id = f"mem:t{turn}-{next_k}"
        next_k += 1
        if row["kind"] in SUPERSEDING_KINDS:
            for old in existing:
                if (old.get("kind") == row["kind"] and old.get("status") == "candidate"
                        and old.get("superseded_by") is None
                        and graph_index.lenient_key(str(old.get("subject"))) == keys["subject"]
                        and sorted(graph_index.lenient_key(str(e)) for e in old.get("entities") or []) == keys["entities"]):
                    old["valid_until_turn"] = turn
                    old["superseded_by"] = new_id
                    old["status"] = "superseded"
                    superseded.append(str(old["id"]))
        landed = {
            "id": new_id, **row, "status": "candidate",
            "source": {"turn": turn, "commit": job.get("commit"), "episode_id": episode_id(turn),
                       "receipts": list(job.get("receipts") or [])},
            "valid_from_turn": turn, "job_id": job_id, "at": now_iso(),
        }
        existing.append(landed)
        written.append(landed)
    write_candidates(campaign, existing)
    result = {"job_id": job_id, "turn": turn, "candidates": len(written), "written": [r["id"] for r in written],
              "superseded": superseded}
    write_job(campaign, {**job, "status": "done", "candidates_sha256": digest, "submitted": candidates,
                         "result": result, "completed_at": now_iso()})
    recover_backlog(campaign, job_id)
    return result, False


# ---- backlog ------------------------------------------------------------------------------

def append_backlog(campaign: Campaign, job_id: str, turn: int, reason: str, detail: Any) -> dict[str, Any]:
    row = {"job_id": job_id, "turn": turn, "reason": reason, "detail": detail, "at": now_iso(), "status": "pending"}
    append_jsonl(campaign.backlog_path, row)
    return row


def recover_backlog(campaign: Campaign, job_id: str) -> None:
    rows = read_jsonl(campaign.backlog_path)
    changed = False
    for row in rows:
        if row.get("job_id") == job_id and row.get("status") == "pending":
            row["status"] = "recovered"
            row["recovered_at"] = now_iso()
            changed = True
    if changed:
        write_text_atomic(campaign.backlog_path, "".join(canonical_line(r) for r in rows))


def fail(campaign: Campaign, job: dict[str, Any] | None, job_id: str, turn: int, reason: Any, detail: Any) -> dict[str, Any]:
    if reason not in FAIL_REASONS:
        raise invalid_params(f"reason {reason!r} is not a failure reason", fix=f"one of: {', '.join(FAIL_REASONS)}")
    row = append_backlog(campaign, job_id, turn, str(reason), detail)
    if job is not None and job.get("status") != "done":
        write_job(campaign, {**job, "status": "failed", "failed_at": now_iso(), "reason": reason, "detail": detail})
    return {"job_id": job_id, "turn": turn, "status": row["status"], "reason": reason}


# ---- open promises (§13.5) ----------------------------------------------------------------

def open_promises(campaign: Campaign) -> list[dict[str, Any]]:
    """`promise` candidates nobody has closed: `obligations.promise` reads these."""
    return [hit_view(row) for row in read_candidates(campaign)
            if row.get("kind") == "promise" and row.get("status") == "candidate" and row.get("superseded_by") is None]


# ---- recall memory ------------------------------------------------------------------------

def query_candidates(campaign: Campaign, entity_index: EntityIndex, *, about: list[str], narrow: bool,
                     turns: list[int] | None = None, kinds: list[str] | None = None,
                     include_superseded: bool = False, limit: int = RECALL_DEFAULT_LIMIT) -> list[dict[str, Any]]:
    """Deterministic narrowing and ranking (§12.4): overlap with `about` first, then the
    kind tier (#20), then recency, then id. `narrow` requires overlap with `about`; the
    default `about` only ranks."""
    about_keys = {entity_index.lenient_key(name) for name in about}
    hits: list[tuple[int, int, int, str, dict[str, Any]]] = []
    for row in read_candidates(campaign):
        if not include_superseded and row.get("superseded_by") is not None:
            continue
        if kinds and row.get("kind") not in kinds:
            continue
        valid_from = int(row.get("valid_from_turn") or 0)
        if turns and not turns[0] <= valid_from <= turns[1]:
            continue
        names = [row.get("subject"), *(row.get("knowers") or []), *(row.get("entities") or [])]
        keys = {entity_index.lenient_key(str(n)) for n in names if n}
        overlap = len(keys & about_keys)
        if narrow and overlap == 0:
            continue
        hits.append((-overlap, kind_rank(row.get("kind")), -valid_from, str(row.get("id")), row))
    hits.sort(key=lambda item: item[:4])
    return [hit_view(row) for *_, row in hits[:limit]]


def kind_rank(kind: Any) -> int:
    """The tier of a candidate kind in KIND_RANK_TIERS; a kind outside the closed list
    (a row written by a later contract) ranks after every known tier."""
    for rank, tier in enumerate(KIND_RANK_TIERS):
        if kind in tier:
            return rank
    return len(KIND_RANK_TIERS)


def capsule_hit(hit: dict[str, Any]) -> dict[str, Any]:
    """§12.7 (#20): what a memory hit is in the capsule — id, kind, statement, turn. The
    knowers, entities, privacy, confidence and state stay behind `recall memory`."""
    return {"id": hit.get("id"), "kind": hit.get("kind"), "statement": hit.get("statement"), "turn": hit.get("turn")}


def hit_view(row: dict[str, Any]) -> dict[str, Any]:
    hit = {"id": row.get("id"), "kind": row.get("kind"), "subject": row.get("subject"),
           "knowers": list(row.get("knowers") or []), "entities": list(row.get("entities") or []),
           "statement": row.get("statement"), "privacy": row.get("privacy"), "state": row.get("state"),
           "confidence": row.get("confidence"), "status": row.get("status"), "turn": row.get("valid_from_turn")}
    if row.get("superseded_by") is not None:
        hit["superseded_by"] = row["superseded_by"]
        hit["valid_until_turn"] = row.get("valid_until_turn")
    return hit
