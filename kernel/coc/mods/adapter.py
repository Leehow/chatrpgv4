"""Current Table/storage adapter for the JSON game interface."""
from __future__ import annotations

import copy
import hashlib
from pathlib import Path
from typing import Any

from ..capsule import npcs_present, where_section
from ..errors import RpcError, invalid_params
from ..fileio import canonical_json, read_json, write_json_atomic
from ..rules.percentile import percentile_check
from ..sessions import SessionView
from ..store import now_iso
from ..text import normalize
from . import objects
from .runtime import CAPABILITIES, ModRuntime


class ModAdapter:
    def __init__(self, table: Any) -> None:
        self.table = table
        self.runtime = ModRuntime(table.content.parent / "mods", table.store.workspace)

    def initialize(self, campaign: Any, world: dict[str, Any], *, pending: bool = False) -> None:
        meta = campaign.read_campaign()
        staged = meta.get("mods_pending")
        changed = "mods" not in world and isinstance(staged, dict)
        if changed:
            world["mods"] = copy.deepcopy(staged)
        changed = self.runtime.initialize(world) or changed
        if pending and not self.busy(campaign, world):
            changed = self.runtime.apply_pending(world) or changed
        if changed:
            campaign.write_world(world)
        if staged is not None:
            meta.pop("mods_pending", None)
            campaign.write_campaign(meta)
        if "objects" in world:
            self.project_inventory(campaign, world)

    def busy(self, campaign: Any, world: dict[str, Any]) -> bool:
        turn = campaign.read_turn()
        if turn.get("state") in {"open", "acting"} or turn.get("pending_choice"):
            return True
        graph = self.table.graph(campaign.read_campaign()["module_id"])
        return bool(SessionView(campaign.dir, graph, campaign.party(), world).active_session())

    def owner(self, campaign: Any, graph: Any, world: dict[str, Any], name: Any) -> dict[str, str]:
        if not isinstance(name, str) or not name.strip():
            raise invalid_params("Object owner must be an investigator, NPC or scene name")
        if name == "here":
            node = graph.scene(world["active_scene"])
            return {"kind": "scene", "id": graph.handle(node), "name": graph.display_name(node)}
        for sheet in campaign.party():
            if normalize(name) in {normalize(sheet["id"]), normalize(sheet["name"])}:
                return {"kind": "investigator", "id": sheet["id"], "name": sheet["name"]}
        node = graph.find(name)
        if node and node.get("node_kind") == "npc":
            return {"kind": "npc", "id": graph.handle(node), "name": graph.display_name(node)}
        container = objects.instance(world, name)
        if container:
            return {"kind":"object", "id":container["id"], "name":container["name"]}
        try:
            scene = graph.scene(name)
            return {"kind": "scene", "id": graph.handle(scene), "name": graph.display_name(scene)}
        except RpcError:
            raise RpcError("unknown_entity", f"No object owner named {name!r}") from None

    def context(self, campaign: Any, graph: Any, world: dict[str, Any]) -> dict[str, Any]:
        active = self.runtime.active(world)
        checks = self.runtime.decisions(world)
        present = npcs_present(graph, world, graph.scene(world["active_scene"]))
        contact = []
        relations = []
        for name, (mod_id, recipe) in checks.items():
            rows = world.get("mods", {}).get("state", {}).get(mod_id, {}).get("checks", {})
            for actor in campaign.party():
                for npc in present:
                    pair = self.pair(name, actor["id"], npc["node_id"])
                    old = rows.get(pair)
                    if old:
                        relations.append({"actor": actor["name"], "target": graph.display_name(npc),
                                          "decision": name, "impression": old["result"]["outcome"].get("impression"),
                                          "since_turn": old["turn"]})
                    else:
                        contact.append({"actor": actor["name"], "target": graph.display_name(npc), "decision": name,
                                        "when": "first meaningful contact, not merely appearing in this list"})
        return {"active": [{"id": r["id"], "version": r["version"]} for r in active],
                "authority": "Only this active Mod set applies. Earlier instructions from disabled or replaced versions are inactive.",
                "instructions": self.runtime.instructions(world), "pending_contacts": contact[:12],
                "relationships": relations[:12], "objects": self.object_context(world)}

    @staticmethod
    def object_context(world: dict[str, Any]) -> dict[str, Any]:
        data = world.get("objects") or {}
        return {"definitions": [{"name": r["name"], "category": r["category"], "parameters": r["parameters"], "traits":r.get("traits", [])}
                                 for r in list(data.get("definitions", {}).values())[-24:]],
                "instances": [{"name": r["name"], "owner": r["owner"]["name"], "state": r["state"],
                               "definition": data["definitions"][r["definition"]]["name"]}
                              for r in list(data.get("instances", {}).values())[-24:]]}

    @staticmethod
    def pair(decision: str, actor: str, target: str) -> str:
        return hashlib.sha256(canonical_json([decision, actor, target]).encode()).hexdigest()

    def check(self, campaign: Any, graph: Any, world: dict[str, Any], turn: dict[str, Any],
              action: dict[str, Any], call_id: str) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
        if action.get("intent") == "cast" and action.get("actor"):
            from ..rules.runtime import SettleContext
            from ..store import parse_call_id
            from .effects import cast_npc
            definition = objects.named((world.get("objects") or {}).get("definitions", {}), str(action.get("spell") or ""))
            owner = self.owner(campaign, graph, world, action["actor"])
            if owner["kind"] == "npc" and definition and definition["category"] == "spell":
                self.require_choice_settled(campaign, graph, world, turn)
                actor = self.table._actor(campaign, None)
                ctx = SettleContext(self.table.engine, campaign, graph, world, turn, call_id, parse_call_id(call_id)[1],
                                    self.table.rng, actor, actor, action)
                outcome = cast_npc(ctx, owner["name"], definition)
                return {"outcome":outcome, "decision":"magic:cast-spell", "effects":ctx.effects, "continuations":[],
                        "rule_refs":[], "family":"magic", "receipts":[r["id"] for r in ctx.receipts]}, ctx.receipts
        if action.get("decision") in {"objects:use", "objects:repair"}:
            self.require_choice_settled(campaign, graph, world, turn)
            from ..rules.runtime import SettleContext
            from ..store import parse_call_id
            from .effects import use_item, repair_item
            owner = self.owner(campaign, graph, world, action["actor"]) if action.get("actor") else None
            actor = self.table._actor(campaign, action.get("actor") if not owner or owner["kind"] == "investigator" else None)
            ctx = SettleContext(self.table.engine, campaign, graph, world, turn, call_id, parse_call_id(call_id)[1],
                                self.table.rng, actor, actor, action)
            if owner and owner["kind"] == "npc":
                ctx.actor_id = owner["id"]
            operation = repair_item if action["decision"] == "objects:repair" else use_item
            outcome = operation(ctx, str(action.get("object") or ""))
            return {"outcome":outcome, "decision":action["decision"], "effects":ctx.effects, "continuations":[],
                    "rule_refs":[], "family":"objects", "receipts":[r["id"] for r in ctx.receipts]}, ctx.receipts
        found = self.runtime.decisions(world).get(action.get("decision"))
        if not found:
            return None
        self.require_choice_settled(campaign, graph, world, turn)
        mod_id, recipe = found
        actor = self.table._actor(campaign, action.get("actor"))
        target = graph.npc(action.get("target"))
        if target["node_id"] not in {n["node_id"] for n in npcs_present(graph, world, graph.scene(world["active_scene"]))}:
            raise RpcError("not_here", "The first-impression target must be present")
        pair = self.pair(recipe["name"], actor["id"], target["node_id"])
        state = world["mods"]["state"].setdefault(mod_id, {}).setdefault("checks", {})
        prior = state.get(pair)
        if prior is None and recipe.get("legacy"):
            prior = self.legacy_impression(campaign, graph, actor, target, recipe)
            if prior is not None:
                state[pair] = prior
                campaign.write_world(world)
        if prior:
            orphan = prior["turn"] == turn["turn"] and not any(r.get("id") == prior["receipt"]["id"] for r in turn["receipts"])
            return {**prior["result"], "reused": True}, [prior["receipt"]] if orphan else []
        values = []
        for spec in recipe["values"]:
            group, key = spec["path"].split(".", 1)
            value = actor.get(group, {}).get(key)
            if type(value) is not int or not 0 <= value <= 100:
                raise invalid_params(f"Actor has no valid {spec['label']} value")
            values.append((value, spec["label"]))
        value, label = max(values, key=lambda p: p[0])
        check = percentile_check(self.table.tables, value, recipe["difficulty"], rng=self.table.rng)
        impression = copy.deepcopy(recipe["results"][check["level"]])
        receipt = {"id": f"roll:mod-{mod_id}-{call_id}", "kind": "roll", "call_id": call_id,
                   "roll_kind": "mod_check", "family": "mod", "mod": mod_id, "decision": recipe["name"],
                   "actor": actor["id"], "actor_label": actor["name"], "npc": graph.handle(target),
                   "skill": label, "target": value, "roll": check["roll"], "level": check["level"],
                   "difficulty": recipe["difficulty"], "check": check, "visibility": "public", "at": now_iso()}
        receipt.update({"passed": check["passed"], "threshold": check["threshold"], "actor_is_investigator": True})
        receipt["impression"] = impression
        result = {"receipt": receipt["id"], "receipts": [receipt["id"]], "decision": recipe["name"], "family": "mod",
                  "outcome": {"kind": "check", **check, "skill": label, "actor": actor["name"],
                              "target_npc": graph.display_name(target), "impression": impression,
                              "attribute_snapshot": dict((label, value) for value, label in values)},
                  "effects": [], "continuations": [], "rule_refs": recipe.get("rule_refs", []),
                  "note": "Realize this impression through the NPC's actual manner and opportunity/friction, preserving their motives and boundaries."}
        state[pair] = {"turn": turn["turn"], "actor": actor["id"], "target": target["node_id"],
                       "receipt": receipt, "result": result}
        campaign.write_world(world)
        return result, [receipt]

    @staticmethod
    def require_choice_settled(campaign: Any, graph: Any, world: dict[str, Any], turn: dict[str, Any]) -> None:
        pending = SessionView(campaign.dir, graph, campaign.party(), world).pending_choice() or turn.get("pending_choice")
        if pending:
            raise RpcError("turn_state", "Settle the existing choice before a Mod action",
                           fix="use the pending choice's ordinary rule action first", details={"pending_choice":pending})

    def legacy_impression(self, campaign: Any, graph: Any, actor: dict[str, Any], target: dict[str, Any],
                          recipe: dict[str, Any]) -> dict[str, Any] | None:
        legacy = recipe["legacy"]
        if legacy.get("format") != "npc-first-impression":
            raise invalid_params("Unknown legacy check format")
        relative = Path(str(legacy.get("file", "")))
        if relative.is_absolute() or ".." in relative.parts or not relative.parts or relative.parts[0] != "save":
            raise invalid_params("Legacy check source must be a campaign save path")
        path = campaign.dir / relative
        if not path.exists():
            return None
        if path.is_symlink() or path.stat().st_size > 16000000:
            raise invalid_params("Invalid legacy check document")
        document = read_json(path)
        target_names = {normalize(v) for v in (target["node_id"], graph.handle(target), graph.display_name(target))}
        for raw in document.get("receipts", {}).values():
            if raw.get("investigator_id") != actor["id"] or normalize(str(raw.get("npc_id"))) not in target_names:
                continue
            schema = raw.get("schema_version")
            expected = "sha256:" + hashlib.sha256(canonical_json({k:v for k,v in raw.items() if k != "integrity_digest"}).encode()).hexdigest()
            if schema not in (1, 2) or raw.get("integrity_digest") != expected:
                raise RpcError("campaign_not_ready", "The existing first-impression receipt failed integrity validation; it will not be rerolled")
            outcome = {"kind":"check", "legacy":True, "status":"recorded",
                       "impression":{"reaction":raw.get("reaction_tier", raw.get("disposition")), "disposition":raw.get("disposition")},
                       "actor":actor["name"], "target_npc":graph.display_name(target)}
            if schema == 2:
                outcome.update(roll=(raw.get("roll_record") or {}).get("roll"), target=raw.get("governing_value"),
                               level=raw.get("achieved_level"), passed=raw.get("passed"))
            result = {"outcome":outcome,"decision":recipe["name"],"family":"mod","receipts":[],"effects":[],
                      "continuations":[],"rule_refs":[raw.get("rule_ref")],
                      "note":"An existing first impression was retained. Do not reroll or disclose legacy hidden dice."}
            return {"turn":-1,"actor":actor["id"],"target":target["node_id"],"result":result,
                    "receipt":{"id":raw.get("receipt_id"),"kind":"legacy-impression","visibility":"keeper"}}
        return None

    def stage(self, campaign: Any, graph: Any, world: dict[str, Any], effect: dict[str, Any],
              turn: int, call_id: str, mint: Any) -> tuple[dict[str, Any], tuple[str, dict[str, Any]]]:
        kind = effect["kind"]
        if kind == "define":
            draft = effect.get("_definition")
            if not isinstance(draft, dict):
                raise RpcError("needs", "Definition needs the host's tool-enabled Mod creator",
                               details={"reason": "mod_generation_required"})
            objects.validate_definition(draft, name=effect.get("name"), category=effect.get("category"))
            provenance = effect.get("_provenance") or {}
            active = {r["id"]: r for r in self.runtime.active(world)}
            package = active.get(provenance.get("mod"))
            if not package or package["digest"] != provenance.get("digest") or not package["contributes"].get("materializer"):
                raise invalid_params("Definition provenance is not an active materializer")
            accepted = self.accept({"campaign":campaign.id, "job":provenance.get("job")})
            if canonical_json(accepted.get("definition")) != canonical_json(draft):
                raise invalid_params("Definition differs from the accepted Mod job")
            value = objects.define(world, draft, provenance)
            receipt = {"id": mint(f"definition:{call_id}"), "kind": "definition", "name": value["name"],
                       "category": value["category"], "definition": value["id"], "visibility": "keeper", "call_id": call_id}
            return receipt, ("definition-created", {"name": value["name"], "category": value["category"]})
        if kind == "object":
            name = effect.get("name")
            if not isinstance(name, str) or not name.strip():
                raise invalid_params("Object needs a name")
            owner = self.owner(campaign, graph, world, effect.get("to"))
            source = self.owner(campaign, graph, world, effect["from"]) if effect.get("from") else None
            prior = objects.instance(world, name)
            quantity = effect.get("quantity", prior["quantity"] if prior else 1)
            item = objects.move(world, name, effect.get("definition"), owner, source=source, turn=turn, quantity=quantity,
                                condition=effect.get("condition"))
            definition = objects.registry(world)["definitions"][item["definition"]]
            receipt = {"id": mint(f"item:{call_id}"), "kind": "item", "name": name, "label": name,
                       "subject": owner["id"], "subject_label": owner["name"], "quantity": quantity,
                       "instance": item["id"], "from": source["name"] if source else None,
                       "weapon": item["id"] if definition["category"] == "weapon" else None, "call_id": call_id,
                       "why": effect.get("why"), "state": copy.deepcopy(item["state"])}
            return receipt, ("item-transferred", {"name": name, "to": owner["name"], "from": receipt["from"]})
        if kind == "ability":
            owner = self.owner(campaign, graph, world, effect.get("to"))
            if owner["kind"] not in {"npc", "investigator"} or not isinstance(effect.get("source"), str) or not effect["source"].strip():
                raise invalid_params("Ability acquisition needs a person and an explicit source")
            definition = objects.named(objects.registry(world)["definitions"], str(effect.get("name")))
            if not definition or definition["category"] != "spell":
                raise invalid_params("Ability must name an accepted spell definition")
            if owner["kind"] == "investigator":
                raise RpcError("needs", "Owning a source does not teach its spell; use resolve magic:learn-spell",
                               details={"reason": "spell_learning_required"})
            objects.registry(world)["abilities"].setdefault(owner["id"], {})[definition["name"]] = {"source": effect["source"], "turn": turn}
            receipt = {"id": mint(f"ability:{call_id}"), "kind": "ability", "name": definition["name"],
                       "subject": owner["id"], "source": effect["source"], "visibility": "keeper", "call_id": call_id}
            return receipt, ("ability-acquired", {"name": definition["name"], "subject": owner["id"]})
        raise invalid_params("Unsupported Mod world effect")

    def job(self, params: dict[str, Any]) -> dict[str, Any]:
        campaign, graph, world, turn = self.table._context(params)
        role = params.get("role")
        if role not in {"create", "audit"}:
            raise invalid_params("Mod job role must be create or audit")
        if role == "create":
            data = params.get("input")
            if not isinstance(data, dict) or data.get("category") not in {"weapon", "spell", "item"}:
                raise invalid_params("Definition request needs a category and a name")
            if data["category"] == "spell" and any(normalize(str(row.get("name"))) == normalize(str(data.get("name")))
                    for row in self.table.tables.spells_table().get("spells", [])):
                raise RpcError("needs", "This name already belongs to a rulebook spell",
                               fix="use the existing spell, or give a distinct derivative its own name")
        field = "materializer" if role == "create" else "auditor"
        candidates = [r for r in self.runtime.active(world) if r["contributes"].get(field)]
        if role == "audit":
            decisions = {r.get("decision") for r in turn.get("receipts", [])}
            candidates = [r for r in candidates if not r["contributes"].get("audit_on_decisions")
                          or decisions.intersection(r["contributes"]["audit_on_decisions"])]
        if not candidates:
            return {"enabled": False}
        package = candidates[0]
        request = {"role": role, "input": params.get("input"), "capabilities": sorted(CAPABILITIES),
                   "play_language": campaign.read_campaign().get("play_language", "en"),
                   "mod_settings": {r["id"]:world["mods"]["active"][r["id"]]["settings"] for r in candidates},
                   "scene": where_section(graph, world, graph.scene(world["active_scene"])),
                   "party": campaign.party(), "objects": self.object_context(world), "receipts": turn.get("receipts", [])}
        if role == "create":
            request["catalogs"] = {"weapons": self.table.tables.weapons_table(), "spells": self.table.tables.spells_table()}
        identity = {"campaign": campaign.id, "turn": turn["turn"], "worldline": campaign.read_campaign().get("active_worldline"),
                    "mod": package["id"], "digest": package["digest"],
                    "packages": [{"id":r["id"], "digest":r["digest"]} for r in candidates],
                    "request": request if role == "audit" else {"input": params.get("input"), "role": role}}
        key = hashlib.sha256(canonical_json(identity).encode()).hexdigest()
        root = self.runtime.root / "jobs" / key
        if not (root / "request.json").exists():
            root.mkdir(parents=True, exist_ok=True)
            write_json_atomic(root / "request.json", request)
            write_json_atomic(root / "identity.json", {k: v for k, v in identity.items() if k != "request"})
            (root / "prompt.md").write_bytes(b"\n\n".join(r["files"][r["contributes"][field]] for r in candidates))
            if role == "create":
                prior = objects.named((world.get("objects") or {}).get("definitions", {}), str(params["input"].get("name")))
                if prior and prior["category"] == params["input"]["category"]:
                    value = {k:copy.deepcopy(prior[k]) for k in ("name", "category", "description", "basis", "parameters", "player_view", "traits") if k in prior}
                    write_json_atomic(root / "accepted.json", {"definition":value, "provenance":{
                        "mod":package["id"], "digest":package["digest"], "job":key, "reused_definition":prior["id"]}})
        return {"enabled": True, "job": key, "cwd": str(root), "system_prompt": str(root / "prompt.md"),
                "accepted": (root / "accepted.json").exists(), "role": role}

    def project_inventory(self, campaign: Any, world: dict[str, Any]) -> None:
        """Character rows are mirrors of core instances, never independent ownership."""
        for sheet in campaign.party():
            objects.project_sheet(world, sheet)
            campaign.write_sheet(sheet)
        path = campaign.dir / "save" / "combat.json"
        if path.exists():
            snapshot = read_json(path)
            if snapshot.get("status") == "active":
                for actor in snapshot.get("participants", []):
                    prior = [w for w in actor.get("weapons", []) if not isinstance(w, dict) or not w.get("object_id")]
                    extra = objects.weapon_rows(world, actor["actor_id"])
                    actor["weapons"] = prior + extra
                    for weapon in extra:
                        snapshot.setdefault("weapon_catalog", {})[weapon["weapon_id"]] = weapon
                        if weapon["ammo"] is not None:
                            actor.setdefault("_ammo", {})[weapon["weapon_id"]] = weapon["ammo"]
                write_json_atomic(path, snapshot)

    def accept(self, params: dict[str, Any]) -> dict[str, Any]:
        key = params.get("job")
        if not isinstance(key, str) or len(key) != 64 or any(c not in "0123456789abcdef" for c in key):
            raise invalid_params("Unknown Mod job")
        root = self.runtime.root / "jobs" / key
        identity = read_json(root / "identity.json")
        campaign, graph, world, turn = self.table._context(params)
        if identity["campaign"] != campaign.id or identity["turn"] != turn["turn"] or identity["worldline"] != campaign.read_campaign().get("active_worldline"):
            raise invalid_params("Mod job belongs to another turn or worldline")
        active = {r["id"]: r for r in self.runtime.active(world)}
        if identity["mod"] not in active or active[identity["mod"]]["digest"] != identity["digest"]:
            raise invalid_params("Mod changed while the job was running")
        if any(active.get(r["id"], {}).get("digest") != r["digest"] for r in identity.get("packages", [])):
            raise invalid_params("An audit contributor changed while the job was running")
        if (root / "accepted.json").exists():
            return read_json(root / "accepted.json")
        path = root / "result.json"
        if not path.exists() or path.is_symlink() or path.stat().st_size > 128000:
            raise invalid_params("Mod agent did not write a bounded result.json")
        raw = read_json(path)
        request = read_json(root / "request.json")
        if request["role"] == "create":
            data = request["input"]
            value = objects.validate_definition(raw, name=data.get("name"), category=data.get("category"))
            if value["category"] == "weapon" and "weapons.profile.v2" in active[identity["mod"]]["requires"] and "adds_damage_bonus" not in value["parameters"]:
                raise invalid_params("Weapon profile v2 must explicitly declare adds_damage_bonus from its preset rule")
            result = {"definition": value, "provenance": {"mod": identity["mod"], "digest": identity["digest"], "job": key}}
        else:
            if not isinstance(raw, dict) or set(raw) - {"missing", "findings"} or not isinstance(raw.get("missing"), list) or len(raw["missing"]) > 16:
                raise invalid_params("Audit must return a bounded missing list")
            for row in raw["missing"]:
                if (not isinstance(row, dict) or set(row) != {"name", "category", "reason"}
                        or row["category"] not in {"weapon", "spell", "item"}
                        or not all(isinstance(row[k], str) and row[k].strip() for k in row)):
                    raise invalid_params("Audit finding needs name, category and reason")
            findings = raw.get("findings", [])
            if not isinstance(findings, list) or len(findings) > 10 or any(
                    not isinstance(r, dict) or set(r) != {"reason", "fix"} or
                    not all(isinstance(v, str) and v.strip() for v in r.values()) for r in findings):
                raise invalid_params("Narrative audit findings need reason and fix")
            result = raw
        write_json_atomic(root / "accepted.json", result)
        return result


def methods(table: Any) -> dict[str, Any]:
    adapter = table.mods

    def listing(params):
        if not params.get("campaign"):
            return adapter.runtime.view()
        campaign = table.store.open(params["campaign"], require_world=False)
        config = campaign.read_world() if campaign.world_json.exists() else {"mods":campaign.read_campaign().get("mods_pending", {})}
        return {**adapter.runtime.view(config), "campaign": campaign.id,
                "play_language": campaign.read_campaign().get("play_language", "en")}

    def configure(params):
        campaign = table.store.open(params.get("campaign"), require_world=False)
        if not campaign.world_json.exists():
            meta = campaign.read_campaign()
            config = {"mods":copy.deepcopy(meta["mods_pending"])} if meta.get("mods_pending") else {}
            adapter.runtime.configure(config, params, busy=False)
            meta["mods_pending"] = config["mods"]
            campaign.write_campaign(meta)
            return listing(params)
        world = campaign.read_world()
        adapter.initialize(campaign, world)
        adapter.runtime.configure(world, params, busy=adapter.busy(campaign, world))
        campaign.write_world(world)
        return listing(params)

    def context(params):
        campaign, graph, world, _turn = table._context(params)
        return adapter.context(campaign, graph, world)

    return {"mods.list": listing, "mods.configure": configure,
            "mods.install": lambda p: adapter.runtime.install(Path(p["path"])),
            "mods.defaults": lambda p: adapter.runtime.defaults(p.get("id"), p.get("enabled")),
            "mods.context": context, "mods.job": adapter.job, "mods.accept": adapter.accept}
