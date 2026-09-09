"""Self-authored Mod packages, immutable versions and save-local activation.

Only JSON/Markdown packages are executable in game interface v1: behavior is
declared through registered core recipes and tool-enabled host Agent tasks.
This module knows neither Table nor Pi. World values cross its public seam.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import stat
import uuid
import zipfile
from pathlib import Path
from typing import Any

from ..errors import RpcError, invalid_params
from ..fileio import canonical_json, read_json, write_json_atomic

GAME_API = "pipicoc.game.v1"
CAPABILITIES = frozenset({"checks.percentile.v1", "context.npc.v1", "definitions.v1",
                          "objects.v1", "objects.state.v2", "objects.adopt.v1", "objects.documents.v1", "mods.order.v1",
                          "ui.documents.v1", "ui.documents.language.v1", "agents.tools.v1", "weapons.v1", "weapons.profile.v2", "spells.v1", "item-effects.v1",
                          "setup.guidance.v1", "setup.aptitude.v1"})
SLUG = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
VERSION = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
MAX_PACKAGE_BYTES = 16 * 1024 * 1024
MAX_FILES = 128


def version_key(value: Any) -> tuple[int, int, int]:
    if not isinstance(value, str) or not VERSION.fullmatch(value):
        raise invalid_params("Mod version must be major.minor.patch")
    return tuple(int(p) for p in value.split("."))


def package_files(root: Path) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    size = 0
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise invalid_params("Mod packages cannot contain symlinks")
        if not path.is_file():
            continue
        if path.suffix not in {".json", ".md"}:
            raise invalid_params("Game interface v1 packages contain JSON and Markdown only")
        size += path.stat().st_size
        if size > MAX_PACKAGE_BYTES or len(files) >= MAX_FILES:
            raise invalid_params("Mod package exceeds the file or byte budget")
        files[path.relative_to(root).as_posix()] = path.read_bytes()
    return files


def package_digest(files: dict[str, bytes]) -> str:
    digest = hashlib.sha256()
    for name, data in sorted(files.items()):
        digest.update(name.encode() + b"\0" + hashlib.sha256(data).digest())
    return digest.hexdigest()


def manifest_from(files: dict[str, bytes]) -> dict[str, Any]:
    try:
        manifest = json.loads(files["mod.json"])
    except (KeyError, ValueError, UnicodeError) as exc:
        raise invalid_params("Package needs a valid mod.json") from exc
    if not isinstance(manifest, dict) or not SLUG.fullmatch(str(manifest.get("id", ""))):
        raise invalid_params("Mod id must be a lowercase semantic slug")
    version_key(manifest.get("version"))
    for field in ("name", "description", "author", "game_api"):
        if not isinstance(manifest.get(field), str) or not manifest[field].strip():
            raise invalid_params(f"mod.json needs {field}")
    if type(manifest.get("state_version")) is not int or manifest["state_version"] < 1:
        raise invalid_params("state_version must be a positive integer")
    for field in ("requires", "conflicts"):
        if not isinstance(manifest.get(field), list) or any(not isinstance(v, str) for v in manifest[field]):
            raise invalid_params(f"{field} must be a string list")
    for field in ("dependencies", "settings", "contributes"):
        if not isinstance(manifest.get(field), dict):
            raise invalid_params(f"{field} must be an object")
    if type(manifest.get("default_enabled")) is not bool:
        raise invalid_params("default_enabled must be boolean")
    if manifest["game_api"] != GAME_API or not set(manifest["requires"]) <= CAPABILITIES:
        # Unknown required interfaces are catalog metadata, never executable contributions.
        return manifest
    ui = manifest.get("ui", {})
    if not isinstance(ui, dict) or set(ui) - {"document_editor"}:
        raise invalid_params("Unknown Mod UI contribution")
    if "document_editor" in ui:
        previous = manifest["contributes"].get("document_editor")
        if previous is not None and previous != ui["document_editor"]:
            raise invalid_params("A package declares conflicting document editors")
        manifest["contributes"]["document_editor"] = ui["document_editor"]
    if any(type(v) not in (str, bool, int, float) for v in manifest["settings"].values()):
        raise invalid_params("Game interface v1 settings are scalar values")
    if not isinstance(manifest.get("settings_schema", {}), dict):
        raise invalid_params("settings_schema must be an object")
    if set(manifest["contributes"]) - {"instructions", "setup_instructions", "checks", "materializer", "auditor", "audit_on_decisions", "audit_slot", "document_editor"}:
        raise invalid_params("Unknown Mod contribution in game interface v1")
    for dep, ver in manifest["dependencies"].items():
        if not SLUG.fullmatch(dep):
            raise invalid_params("Dependency ids must be semantic slugs")
        version_key(ver)
    if type(manifest.get("default_enabled")) is not bool:
        raise invalid_params("default_enabled must be boolean")
    for field in ("instructions", "setup_instructions", "materializer", "auditor"):
        path = manifest["contributes"].get(field)
        if path is not None and (not isinstance(path, str) or path not in files or not path.endswith(".md")):
            raise invalid_params(f"contributes.{field} must name a package Markdown file")
    for check in manifest["contributes"].get("checks", []):
        if (not isinstance(check, dict) or not re.fullmatch(r"[a-z][a-z0-9-]*:[a-z][a-z0-9-]*", str(check.get("name", "")))
                or check.get("selection") != "maximum" or check.get("scope") != "actor-target"
                or check.get("difficulty") not in {"regular", "hard", "extreme"}
                or not isinstance(check.get("values"), list) or not check["values"]
                or not isinstance(check.get("results"), dict)):
            raise invalid_params("Invalid contributed percentile decision")
        for value in check["values"]:
            if (not isinstance(value, dict) or not isinstance(value.get("label"), str)
                    or not isinstance(value.get("path"), str)
                    or not value["path"].startswith(("characteristics.", "skills."))):
                raise invalid_params("Check values must reference actor characteristics or skills")
        if set(check["results"]) != {"critical", "extreme", "hard", "regular", "failure", "fumble"}:
            raise invalid_params("A percentile decision must define all six results")
    names = [check["name"] for check in manifest["contributes"].get("checks", [])]
    if len(names) != len(set(names)):
        raise invalid_params("A package cannot define the same check twice")
    editor = manifest["contributes"].get("document_editor")
    if editor is not None and (not isinstance(editor, dict) or set(editor) != {"renderer"}
                               or editor["renderer"] not in {"paper", "plain"}):
        raise invalid_params("Document editor must select a supported paper or plain renderer")
    slot = manifest["contributes"].get("audit_slot")
    if slot is not None and (not isinstance(slot, str) or not re.fullmatch(r"[a-z][a-z0-9:-]{0,127}", slot)
                             or not manifest["contributes"].get("auditor")):
        raise invalid_params("An audit slot needs a semantic name and an auditor")
    return manifest


class ModRuntime:
    def __init__(self, builtin: Path, home: Path) -> None:
        self.builtin = Path(builtin)
        self.root = Path(home) / ".coc" / "mods"

    def catalog(self) -> dict[tuple[str, str], dict[str, Any]]:
        roots = list(self.builtin.glob("*/mod.json"))
        roots += list((self.root / "packages").glob("*/*/mod.json"))
        out = {}
        for path in sorted(roots):
            files = package_files(path.parent)
            manifest = manifest_from(files)
            row = {**manifest, "digest": package_digest(files), "files": files}
            key = (row["id"], row["version"])
            if key in out and out[key]["digest"] != row["digest"]:
                raise RpcError("campaign_not_ready", f"Conflicting bytes for {key[0]} {key[1]}")
            row["compatible"] = row["game_api"] == GAME_API and set(row["requires"]) <= CAPABILITIES
            out[key] = row
        return out

    def install(self, source: Path) -> dict[str, Any]:
        source = source.expanduser().resolve()
        if source.is_dir():
            files = package_files(source)
        else:
            files = {}
            size = 0
            try:
                with zipfile.ZipFile(source) as archive:
                    entries = [i for i in archive.infolist() if not i.is_dir()]
                    if len(entries) > MAX_FILES:
                        raise invalid_params("Mod archive has too many files")
                    for entry in entries:
                        path = Path(entry.filename)
                        size += entry.file_size
                        if (path.is_absolute() or ".." in path.parts or "\\" in entry.filename
                                or stat.S_ISLNK(entry.external_attr >> 16) or size > MAX_PACKAGE_BYTES
                                or path.suffix not in {".md", ".json"}):
                            raise invalid_params("Unsafe or unsupported Mod archive entry")
                        if entry.filename in files:
                            raise invalid_params("Duplicate Mod archive entry")
                        files[entry.filename] = archive.read(entry)
            except (OSError, zipfile.BadZipFile) as exc:
                raise invalid_params("Not a readable Mod directory or ZIP") from exc
            if "mod.json" not in files:
                manifests = [p for p in files if p.endswith("/mod.json")]
                if len(manifests) != 1:
                    raise invalid_params("Archive must contain exactly one Mod root")
                prefix = manifests[0][:-len("mod.json")]
                if any(not p.startswith(prefix) for p in files):
                    raise invalid_params("Archive contains files outside its Mod root")
                files = {p[len(prefix):]: value for p, value in files.items()}
        manifest = manifest_from(files)
        target = self.root / "packages" / manifest["id"] / manifest["version"]
        digest = package_digest(files)
        previous = self.catalog().get((manifest["id"], manifest["version"]))
        if previous:
            if previous["digest"] != digest:
                raise invalid_params("An installed Mod version cannot be replaced with different bytes")
            self.freeze(previous)
            return {"id": manifest["id"], "version": manifest["version"], "reused": True}
        stage = self.root / "imports" / uuid.uuid4().hex
        stage.mkdir(parents=True)
        for name, data in files.items():
            path = stage / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        target.parent.mkdir(parents=True, exist_ok=True)
        stage.rename(target)
        return {"id": manifest["id"], "version": manifest["version"], "digest": digest}

    def freeze(self, row: dict[str, Any]) -> None:
        """Retain shipped package bytes so an application upgrade cannot strand a save."""
        target = self.root / "packages" / row["id"] / row["version"]
        if target.exists():
            if package_digest(package_files(target)) != row["digest"]:
                raise invalid_params("Locked Mod package bytes have changed")
            return
        stage = self.root / "imports" / uuid.uuid4().hex
        stage.mkdir(parents=True)
        for name, data in row["files"].items():
            path = stage / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        target.parent.mkdir(parents=True, exist_ok=True)
        stage.rename(target)

    def defaults(self, mod_id: str | None = None, enabled: bool | None = None) -> dict[str, bool]:
        path = self.root / "defaults.json"
        values = read_json(path) if path.exists() else {}
        if mod_id is not None:
            if not any(k[0] == mod_id for k in self.catalog()) or type(enabled) is not bool:
                raise invalid_params("Choose an installed Mod and a boolean default")
            values[mod_id] = enabled
            write_json_atomic(path, values)
        return values

    def initialize(self, world: dict[str, Any]) -> bool:
        if "mods" in world:
            rows = self.active(world)
            if "order" not in world["mods"]:
                world["mods"]["order"] = self.topological(self.order(world), rows)
                return True
            return False
        catalog = self.catalog()
        defaults = self.defaults()
        latest = {}
        for row in sorted(catalog.values(), key=lambda r: version_key(r["version"])):
            if row["compatible"]:
                latest[row["id"]] = row
        world["mods"] = {"game_api": GAME_API, "active": {}, "state": {}, "pending": {}}
        for mod_id, row in latest.items():
            self.freeze(row)
            world["mods"]["active"][mod_id] = self.lock(row, defaults.get(mod_id, row["default_enabled"]))
        world["mods"]["order"] = self.topological(self.order(world), [r for r in latest.values()
                                                   if world["mods"]["active"][r["id"]]["enabled"]])
        self.active(world)
        return True

    def order(self, world: dict[str, Any] | None = None) -> list[str]:
        ids = {key[0] for key in self.catalog()} | set((world or {}).get("mods", {}).get("active", {}))
        path = self.root / "load-order.json"
        preferred = (world or {}).get("mods", {}).get("order")
        if preferred is None:
            preferred = read_json(path) if path.exists() else []
        return [name for name in preferred if name in ids] + sorted(ids - set(preferred))

    @staticmethod
    def topological(preferred: list[str], rows: list[dict[str, Any]]) -> list[str]:
        dependencies = {r["id"]: set(r["dependencies"]) for r in rows}
        done: list[str] = []
        todo = list(preferred)
        while todo:
            ready = next((name for name in todo if not dependencies.get(name, set()) - set(done)), None)
            if ready is None:
                raise invalid_params("Mod dependency order is cyclic or incomplete")
            done.append(ready)
            todo.remove(ready)
        return done

    def reorder(self, world: dict[str, Any] | None, order: Any, *, busy: bool = False) -> None:
        expected = self.order(world)
        if (not isinstance(order, list) or any(not isinstance(name, str) for name in order)
                or len(order) != len(set(order)) or set(order) != set(expected)):
            raise invalid_params("Load order must contain every installed Mod id exactly once")
        if world is None:
            catalog = self.catalog()
            defaults = self.defaults()
            latest = {}
            for row in sorted(catalog.values(), key=lambda r: version_key(r["version"])):
                if row["compatible"]:
                    latest[row["id"]] = row
            enabled = [r for r in latest.values() if defaults.get(r["id"], r["default_enabled"])]
            if self.topological(order, enabled) != order:
                raise invalid_params("Dependencies must load before the Mods that require them")
            write_json_atomic(self.root / "load-order.json", order)
            return
        staged = copy.deepcopy(world)
        staged["mods"]["order"] = list(order)
        self.active(staged)
        if busy:
            world["mods"]["pending_order"] = list(order)
        else:
            world["mods"]["order"] = list(order)
            world["mods"].pop("pending_order", None)

    @staticmethod
    def lock(row: dict[str, Any], enabled: bool, settings: dict[str, Any] | None = None) -> dict[str, Any]:
        return {k: row[k] for k in ("version", "digest", "state_version")} | {
            "enabled": enabled, "settings": copy.deepcopy({**row["settings"], **(settings or {})})}

    def active(self, world: dict[str, Any]) -> list[dict[str, Any]]:
        catalog = self.catalog()
        locks = (world.get("mods") or {}).get("active", {})
        out = []
        for mod_id, lock in locks.items():
            if not lock.get("enabled"):
                continue
            row = catalog.get((mod_id, lock["version"]))
            if not row or not row["compatible"] or row["digest"] != lock["digest"]:
                raise RpcError("campaign_not_ready", f"Missing or incompatible locked Mod {mod_id} {lock['version']}")
            for dep, required in row["dependencies"].items():
                other = locks.get(dep, {})
                if not other.get("enabled") or other.get("version") != required:
                    raise invalid_params(f"{mod_id} requires {dep} {required}")
            for conflict in row["conflicts"]:
                if locks.get(conflict, {}).get("enabled"):
                    raise invalid_params(f"{mod_id} conflicts with {conflict}")
            out.append(row)
        preferred = self.order(world)
        ordered = self.topological(preferred, out)
        if "order" in world.get("mods", {}) and ordered != preferred:
            raise invalid_params("Dependencies must load before the Mods that require them")
        return sorted(out, key=lambda r: ordered.index(r["id"]))

    def providers(self, world: dict[str, Any]) -> dict[str, list[str]]:
        slots: dict[str, list[str]] = {"document_editor": ["core"]}
        for row in self.active(world):
            contributes = row["contributes"]
            keys = [f"check:{check['name']}" for check in contributes.get("checks", [])]
            keys.extend(key for key in ("materializer", "document_editor") if contributes.get(key))
            if contributes.get("auditor"):
                keys.append(f"audit:{contributes.get('audit_slot', row['id'])}")
            for key in keys:
                slots.setdefault(key, []).append(row["id"])
        return slots

    def effective(self, world: dict[str, Any]) -> list[dict[str, Any]]:
        slots = self.providers(world)
        out = []
        for row in self.active(world):
            contributes = row["contributes"]
            policy = [f"check:{check['name']}" for check in contributes.get("checks", [])]
            if contributes.get("materializer"):
                policy.append("materializer")
            if not policy and contributes.get("document_editor"):
                policy.append("document_editor")
            if not policy and contributes.get("auditor"):
                policy.append(f"audit:{contributes.get('audit_slot', row['id'])}")
            if not policy or any(slots[key][-1] == row["id"] for key in policy):
                out.append(row)
        return out

    def editor(self, world: dict[str, Any]) -> dict[str, Any]:
        provider = self.providers(world)["document_editor"][-1]
        if provider == "core":
            return {"provider": "core", "renderer": "plain"}
        row = next(r for r in self.active(world) if r["id"] == provider)
        return {"provider": provider, **row["contributes"]["document_editor"]}

    def configure(self, world: dict[str, Any], change: dict[str, Any], *, busy: bool) -> None:
        self.initialize(world)
        mod_id = change.get("id")
        old = world["mods"]["active"].get(mod_id, {})
        version = change.get("version", old.get("version"))
        row = self.catalog().get((mod_id, version))
        if not row or not row["compatible"]:
            raise invalid_params("Choose a compatible installed Mod version")
        self.freeze(row)
        enabled = change.get("enabled", old.get("enabled", True))
        settings = change.get("settings", old.get("settings", row["settings"]))
        if type(enabled) is not bool or not isinstance(settings, dict) or set(settings) - set(row["settings"]):
            raise invalid_params("Invalid Mod enable state or unknown setting")
        settings = {**row["settings"], **settings}
        for key, value in settings.items():
            expected = row["settings"][key]
            schema = row.get("settings_schema", {}).get(key, {})
            if type(expected) not in (str, bool, int, float) or type(value) is not type(expected):
                raise invalid_params(f"Setting {key} has an unsupported type")
            if "enum" in schema and value not in schema["enum"]:
                raise invalid_params(f"Setting {key} must be one of its declared options")
            if type(value) in (int, float) and not schema.get("minimum", float("-inf")) <= value <= schema.get("maximum", float("inf")):
                raise invalid_params(f"Setting {key} is outside its declared range")
        staged = copy.deepcopy(world)
        staged["mods"]["active"][mod_id] = self.lock(row, enabled, settings)
        staged["mods"]["order"] = self.order(staged)
        self.active(staged)
        if busy:
            world["mods"]["pending"][mod_id] = {"id": mod_id, "version": version, "enabled": enabled, "settings": settings}
            return
        state = copy.deepcopy(staged["mods"]["state"].get(mod_id, {}))
        before = int(old.get("state_version", row["state_version"]))
        after = row["state_version"]
        while before != after:
            migration = next((m for m in row.get("migrations", []) if m.get("from") == before and m.get("to") == before + 1), None)
            if migration is None:
                raise invalid_params(f"No state migration from {before} to {after} for {mod_id}")
            for op in migration.get("operations", []):
                if op.get("op") == "default" and isinstance(op.get("key"), str):
                    state.setdefault(op["key"], copy.deepcopy(op.get("value")))
                elif op.get("op") == "rename" and isinstance(op.get("from"), str) and isinstance(op.get("to"), str):
                    if op["from"] in state:
                        if op["to"] in state:
                            raise invalid_params("Mod migration would overwrite an existing field")
                        state[op["to"]] = state.pop(op["from"])
                else:
                    raise invalid_params("Unsupported Mod migration operation")
            before += 1
        staged["mods"]["state"][mod_id] = state
        staged["mods"]["pending"].pop(mod_id, None)
        world["mods"] = staged["mods"]

    def apply_pending(self, world: dict[str, Any]) -> bool:
        changes = list((world.get("mods") or {}).get("pending", {}).values())
        order = (world.get("mods") or {}).get("pending_order")
        staged = copy.deepcopy(world)
        if order is not None:
            self.reorder(staged, order)
        for change in changes:
            self.configure(staged, change, busy=False)
        if changes or order is not None:
            world["mods"] = staged["mods"]
        return bool(changes) or order is not None

    def view(self, world: dict[str, Any] | None = None) -> dict[str, Any]:
        locks = (world or {}).get("mods", {})
        defaults = self.defaults()
        rows = []
        for row in sorted(self.catalog().values(), key=lambda r: (r["id"], version_key(r["version"]))):
            rows.append({k: row[k] for k in ("id", "version", "name", "description", "author", "compatible", "requires", "dependencies", "conflicts")} | {
                "settings": row["settings"] if row["compatible"] else {},
                "default_enabled": defaults.get(row["id"], row["default_enabled"]),
                "active": locks.get("active", {}).get(row["id"]), "pending": locks.get("pending", {}).get(row["id"]),
                "settings_schema": row.get("settings_schema", {}) if row["compatible"] else {},
                "changelog": row["files"].get("CHANGELOG.md", b"").decode("utf-8")})
        return {"game_api": GAME_API, "capabilities": sorted(CAPABILITIES), "mods": rows,
                "order": self.order(world), "pending_order": locks.get("pending_order"),
                "providers": self.providers(world) if world and locks else {}}

    def setup_context(self, lock: dict[str, Any] | None) -> dict[str, Any]:
        """The mod set as the setup process sees it: which packages are on, what they require
        and what they have to say about creation. `lock` is world.mods or campaign.mods_pending."""
        world = {"mods": lock or {}}
        active = self.active(world)
        return {"active": [{"id": r["id"], "version": r["version"]} for r in active],
                "authority": "Only this active Mod set applies to setup. Earlier instructions from disabled or replaced versions are inactive.",
                "capabilities": sorted({cap for r in active for cap in r.get("requires", [])}),
                "setup": [{"mod": r["id"], "version": r["version"],
                           "settings": world["mods"]["active"][r["id"]]["settings"],
                           "instruction": r["files"][r["contributes"]["setup_instructions"]].decode()}
                          for r in active if r["contributes"].get("setup_instructions")]}

    def instructions(self, world: dict[str, Any]) -> list[dict[str, Any]]:
        return [{"mod": r["id"], "version": r["version"], "settings":world["mods"]["active"][r["id"]]["settings"],
                 "instruction": r["files"][r["contributes"]["instructions"]].decode()}
                for r in self.effective(world) if r["contributes"].get("instructions")]

    def decisions(self, world: dict[str, Any]) -> dict[str, tuple[str, dict[str, Any]]]:
        return {check["name"]: (row["id"], check) for row in self.active(world)
                for check in row["contributes"].get("checks", [])}
