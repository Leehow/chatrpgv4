"""Instance-owned writing and immutable acquisition snapshots."""
from __future__ import annotations

import copy
import hashlib
from typing import Any

from ..errors import RpcError, invalid_params
from ..fileio import append_jsonl, canonical_json
from ..store import now_iso

MAX_TEXT = 64000
PRESENTATIONS = {"paper", "notebook", "book"}


def validate_seed(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("presentation") not in PRESENTATIONS:
        raise invalid_params("Document needs bounded plain text and presentation paper, notebook or book")
    valid = (set(value) == {"text", "presentation"} and isinstance(value.get("text"), str) and len(value["text"]) <= MAX_TEXT)
    valid = valid or (set(value) == {"handout", "presentation"} and isinstance(value.get("handout"), str) and 0 < len(value["handout"]) <= 160)
    if not valid:
        raise invalid_params("Document needs bounded plain text and presentation paper, notebook or book")
    return copy.deepcopy(value)


def initialize(item: dict[str, Any], seed: Any) -> None:
    if item.get("document") is not None:
        raise invalid_params("An existing document cannot be reinitialized; its acquisition snapshot is retained")
    item["document"] = {**validate_seed(seed), "original": None, "acquired_by": None, "revision": 1}
    if "text" not in item["document"]:
        raise invalid_params("The kernel must materialize the revealed handout before initializing its carrier")


def root_owner(world: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    instances = (world.get("objects") or {}).get("instances", {})
    owner = item["owner"]
    seen = set()
    while owner["kind"] == "object":
        if owner["id"] in seen or owner["id"] not in instances:
            raise invalid_params("Document ownership is cyclic or incomplete")
        seen.add(owner["id"])
        owner = instances[owner["id"]]["owner"]
    return owner


def ownership_changed(world: dict[str, Any]) -> None:
    for item in (world.get("objects") or {}).get("instances", {}).values():
        document = item.get("document")
        if not document:
            continue
        owner = root_owner(world, item)
        actor = owner["id"] if owner["kind"] == "investigator" else None
        if document.get("acquired_by") != actor:
            if actor is not None:
                document["original"] = document["text"]
                document["acquired_turn"] = item.get("changed_turn", item.get("created_turn"))
            document["acquired_by"] = actor
            document["revision"] += 1


def version(campaign: Any, world: dict[str, Any], item: dict[str, Any]) -> str:
    value = [campaign.id, campaign.read_campaign().get("active_worldline"), item["id"],
             root_owner(world, item), item["document"]]
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def write(item: dict[str, Any], text: Any) -> bool:
    if not isinstance(text, str) or len(text) > MAX_TEXT:
        raise invalid_params("Document text must be a string of at most 64000 characters")
    document = item.get("document")
    if not document:
        raise invalid_params("Initialize the writable carrier before changing its text")
    if text == document["text"]:
        return False
    document["text"] = text
    document["revision"] += 1
    document["edited_at"] = now_iso()
    return True


def methods(adapter: Any) -> dict[str, Any]:
    from . import objects

    def owned(params):
        campaign = adapter.table.store.open(params.get("campaign"))
        world = campaign.read_world()
        actor = adapter.table._actor(campaign, params.get("actor"))
        item = objects.instance(world, params.get("name"))
        if not item or not item.get("document"):
            raise RpcError("unknown_entity", "No writable document with that name")
        owner = root_owner(world, item)
        if owner.get("kind") != "investigator" or owner["id"] != actor["id"]:
            raise RpcError("not_owned", "This investigator does not own the document")
        if item["document"].get("acquired_by") != actor["id"]:
            raise RpcError("needs", "The document acquisition has not been committed")
        return campaign, world, actor, item

    def response(campaign, world, actor, item):
        document = item["document"]
        editor = adapter.runtime.editor(world)
        return {"name": item["name"], "actor": actor["name"], "text": document["text"],
                "original": document["original"], "presentation": document["presentation"],
                "version": version(campaign, world, item), "editor": editor,
                "play_language": campaign.read_campaign().get("play_language", "en")}

    def view(params):
        return response(*owned(params))

    def apply(params):
        if set(params) - {"campaign", "actor", "name", "version", "action", "text"}:
            raise invalid_params("Unknown document edit field")
        campaign, world, actor, item = owned(params)
        if params.get("version") != version(campaign, world, item):
            raise RpcError("revision_conflict", "The document or its ownership changed; keep your draft and reload before saving")
        action = params.get("action")
        if action not in {"save", "reset"} or action == "reset" and "text" in params:
            raise invalid_params("Document action must be save with text, or reset without client text")
        document = item["document"]
        text = document["original"] if action == "reset" else params.get("text")
        before = document["text"]
        if write(item, text):
            campaign.write_world(world)
            append_jsonl(campaign.dir / "document-edits.jsonl", {
                "kind": "document-edit", "at": document["edited_at"], "action": action,
                "actor": actor["id"], "instance": item["id"], "revision": document["revision"],
                "before": before, "after": text,
                "worldline": campaign.read_campaign().get("active_worldline")})
        return response(campaign, world, actor, item)

    return {"mods.document.view": view, "mods.document.apply": apply}
