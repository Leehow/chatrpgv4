"""Versioned drafts over the existing Chargen calculator; no second rules engine."""
from __future__ import annotations

import copy
import fcntl
from contextlib import contextmanager
from typing import Any

from .chargen import ChargenError
from .errors import RpcError, invalid_params
from .fileio import canonical_json, read_json, sha256_text, write_json_atomic

BACKSTORY = ("personal_description", "ideology_beliefs", "significant_people",
             "meaningful_locations", "treasured_possessions", "traits")
FIELDS = {"name", "occupation", "age", "sex", "concept", "occupation_skills", "interest_skills",
          "own_language", "backstory", "key_connection", "equipment", "weapons", "era"}

@contextmanager
def locked(campaign):
    with (campaign.dir / "setup.lock").open("a+b") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def completeness(sheet):
    problems = []
    for name in ("occupation", "interest"):
        account = sheet.get("creation", {}).get("skills", {}).get(name, {})
        if account.get("unspent") != 0:
            problems.append(f"{name} skills have an incomplete budget")
    if sheet.get("creation", {}).get("skills", {}).get("occupation", {}).get("choices_pending"):
        problems.append("occupational choices remain unresolved")
    backstory = sheet.get("backstory") or {}
    if sum(nonempty(backstory.get(k)) for k in BACKSTORY) < 3 or not nonempty(backstory.get("scenario_bound")):
        problems.append("structured backstory and scenario involvement are required")
    connection = sheet.get("key_connection") or {}
    if connection.get("backstory_field") not in BACKSTORY or not nonempty(connection.get("summary")):
        problems.append("key connection is missing")
    if not nonempty(sheet.get("own_language")):
        problems.append("a concrete native language is required")
    if not isinstance(sheet.get("equipment"), list):
        problems.append("record ordinary kit in equipment, not only prose")
    if not sheet.get("finance"):
        problems.append("era finance is unavailable")
    if any(not isinstance(sheet.get("characteristics", {}).get(k), int) for k in ("STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU", "LUCK")):
        problems.append("characteristics are incomplete")
    return problems


class SetupDrafts:
    def __init__(self, setup):
        self.setup = setup
        self.table = setup.table

    def campaign(self, params):
        return self.table.store.open(params.get("campaign"), require_turn=False, require_world=False)

    def load(self, campaign, meta):
        revision = (meta.get("setup") or {}).get("draft_revision")
        return read_json(campaign.dir / "setup" / "drafts" / f"{revision}.json") if revision else None

    def result(self, draft):
        sheet = draft["sheet"]
        from .rules.skills import player_glossary
        return {"revision": draft["revision"], "sheet": sheet, "profile": draft["profile"],
                "labels": player_glossary(self.table.tables, draft.get("play_language", "en")),
                "completeness": {"valid": not completeness(sheet), "issues": completeness(sheet)}}

    def validate_profile(self, profile):
        errors = []
        for k in ("name", "occupation", "concept", "own_language"):
            if not nonempty(profile.get(k)):
                errors.append(f"{k} is required")
        raw_backstory = profile.get("backstory")
        backstory = raw_backstory if isinstance(raw_backstory, dict) else {}
        if not isinstance(raw_backstory, dict) or set(backstory) - {*BACKSTORY, "scenario_bound"}:
            errors.append("backstory must use the declared categories")
        elif sum(nonempty(backstory.get(k)) for k in BACKSTORY) < 3 or not nonempty(backstory.get("scenario_bound")):
            errors.append("supply 3-6 backstory categories and scenario_bound")
        key = profile.get("key_connection") or {}
        if not isinstance(key, dict) or key.get("backstory_field") not in BACKSTORY or not nonempty(key.get("summary")) or not nonempty(backstory.get(key.get("backstory_field"))):
            errors.append("key_connection needs backstory_field and summary referring to a populated category")
        kit = profile.get("equipment")
        if not isinstance(kit, list) or not all(nonempty(x) for x in kit):
            errors.append("equipment must list the ordinary items the draft says are carried")
        skills = self.table.tables.skills_table()
        def legal(name):
            return isinstance(name, str) and (name in skills or (name.startswith("Language (Other: ") and name.endswith(")") and len(name) > 19))
        occ, interests = profile.get("occupation_skills"), profile.get("interest_skills")
        if not isinstance(occ, list) or len(occ) != 8 or not all(legal(x) for x in occ) or len(set(occ)) != 8:
            errors.append("occupation_skills must name eight distinct concrete catalog skills")
        if not isinstance(interests, list) or not interests or not all(legal(x) for x in interests) or len(set(interests)) != len(interests):
            errors.append("interest_skills must name distinct concrete skills chosen for this person")
        if any(isinstance(x, str) and x in {"Cthulhu Mythos", "Credit Rating"} for x in (occ if isinstance(occ, list) else []) + (interests if isinstance(interests, list) else [])):
            errors.append("Credit Rating is allocated separately; no starting Cthulhu Mythos")
        try:
            _, occupation = self.setup.chargen.occupation(profile.get("occupation"))
            required = [self.setup.chargen.catalog_name(x) for x in occupation.get("occupational_skills", [])]
            missing = [x for x in required if x and isinstance(occ, list) and x not in occ]
            if missing:
                errors.append(f"retain required occupation skills: {missing}")
        except ChargenError:
            errors.append("occupation must be a listed occupation")
        weapons = profile.get("weapons", [])
        if not isinstance(weapons, list) or not all(isinstance(x, str) and x in self.table.tables.weapons_table() for x in weapons):
            errors.append("weapons must use existing rulebook profile names")
        if errors:
            raise RpcError("needs", "Complete the semantic profile without interviewing for ordinary missing details",
                           details={"issues": errors, "backstory_fields": BACKSTORY,
                                    "skills": list(skills), "language_specialty": "Language (Other: English)",
                                    "occupations": self.setup.chargen.occupations()})

    def draft(self, params):
        campaign = self.campaign(params)
        with locked(campaign):
            meta = campaign.read_campaign()
            if meta.get("status") != "setting_up":
                raise invalid_params("the campaign is no longer accepting drafts")
            previous = self.load(campaign, meta)
            patch = params.get("profile")
            if not isinstance(patch, dict) or set(patch) - FIELDS:
                raise invalid_params("profile contains unknown fields", details={"fields": sorted(FIELDS)})
            profile = {**(previous["profile"] if previous else {}), **patch}
            self.validate_profile(profile)
            if previous and profile == previous["profile"]:
                return self.result(previous)
            if (meta.get("setup") or {}).get("confirmed_revision"):
                raise RpcError("campaign_not_ready", "The confirmed card cannot be replaced during handoff")
            state = meta.setdefault("setup", {})
            seed = previous["seed"] if previous else state.get("draft_seed") or str(self.table.rng.getrandbits(64))
            if "draft_seed" not in state:
                state["draft_seed"] = seed
                campaign.write_campaign(meta)
            from .library import module_era
            graph = self.table.graph(meta["module_id"])
            selected = graph.scene(meta["opening_scene"]) if meta.get("opening_scene") else graph.start_scene()
            source_era = (selected.get("properties", {}).get("investigator_setup") or {}).get("era") or module_era(graph)
            periods = list(self.table.tables.load("cash-assets")["periods"])
            era = profile.get("era") or source_era or "1920s"
            if era not in periods:
                raise RpcError("needs", "No applicable rulebook finance period has been selected for the authored era",
                    fix="Choose profile.era from the returned options only when it matches the source setting, then retry in this turn. If no period applies, keep setup blocked; do not approximate or invent finance tables. Do not ask the player to fix a system parameter.",
                    details={"field": "era", "source_era": source_era, "options": periods})
            try:
                sheet, receipt = self.setup.chargen.build(investigator_id="investigator", name=profile["name"],
                    occupation_id=profile["occupation"], concept=profile["concept"], age=profile.get("age", 27),
                    sex=profile.get("sex"), method="rolled", seed=seed, era=era,
                    occupation_skills=profile["occupation_skills"], interest_skills=profile["interest_skills"])
            except (ChargenError, ValueError, KeyError) as exc:
                raise RpcError("needs", str(exc), details={"expected": getattr(exc, "expected", None)}) from exc
            sheet.update(backstory=copy.deepcopy(profile["backstory"]), key_connection=copy.deepcopy(profile["key_connection"]),
                         own_language=profile["own_language"], equipment=list(profile["equipment"]))
            sheet["backstory"]["concept"] = profile["concept"]
            sheet["weapons"] = [{"name": name, **self.table.tables.weapon_by_name(name)} for name in profile.get("weapons", [])]
            for weapon in profile.get("weapons", []):
                if weapon not in sheet["equipment"]:
                    sheet["equipment"].append(weapon)
            for key, source in (("hp", "HP"), ("mp", "MP"), ("san", "SAN")):
                sheet[f"current_{key}"] = sheet["derived"][source]
            sheet["current_luck"] = sheet["characteristics"]["LUCK"]
            errors = completeness(sheet)
            if errors:
                raise RpcError("needs", "The card is incomplete", details={"issues": errors})
            revision = (previous["revision"] if previous else 0) + 1
            draft = {"revision": revision, "play_language": meta.get("play_language", "en"), "seed": seed, "profile": profile, "sheet": sheet,
                     "input_key": params.get("input_key"), "receipt": receipt, "digest": sha256_text(canonical_json(sheet))}
            write_json_atomic(campaign.dir / "setup" / "drafts" / f"{revision}.json", draft)
            state = dict(meta.get("setup") or {})
            state.update(draft_revision=revision, previewed_revision=None)
            meta["setup"] = state
            campaign.write_campaign(meta)
            return self.result(draft)

    def previewed(self, params):
        campaign = self.campaign(params)
        with locked(campaign):
            meta = campaign.read_campaign()
            draft = self.load(campaign, meta)
            if not draft or params.get("revision") != draft["revision"]:
                raise RpcError("idempotency_conflict", "The preview is not the current draft", code_detail="stale_draft")
            meta["setup"]["previewed_revision"] = draft["revision"]
            campaign.write_campaign(meta)
            return {"previewed": True, "revision": draft["revision"]}

    def confirm(self, params):
        campaign = self.campaign(params)
        with locked(campaign):
            meta = campaign.read_campaign()
            draft = self.load(campaign, meta)
            if not draft or params.get("revision") != draft["revision"]:
                raise RpcError("idempotency_conflict", "Confirm the current draft; no new card was written", code_detail="stale_draft")
            state = meta["setup"]
            consent = params.get("consent")
            if consent not in {"approved", "delegated"}:
                raise invalid_params("consent must be approved or explicitly delegated")
            if sha256_text(canonical_json(draft["sheet"])) != draft["digest"]:
                raise RpcError("idempotency_conflict", "The immutable draft was altered")
            if state.get("confirmed_revision") == draft["revision"]:
                return {**self.result(draft), "committed": True, "replayed": True}
            if meta.get("status") != "setting_up":
                raise invalid_params("the campaign is no longer accepting character changes")
            if consent == "approved" and state.get("previewed_revision") != draft["revision"]:
                raise RpcError("needs", "Wait until the current complete card is displayed before confirmation", code_detail="preview_required")
            if consent == "approved" and draft.get("input_key") and draft.get("input_key") == params.get("input_key"):
                raise RpcError("needs", "Wait for the next player message to approve the displayed draft", code_detail="confirmation_required")
            if completeness(draft["sheet"]):
                raise RpcError("needs", "This draft is incomplete")
            target = campaign.party_dir / "investigator.json"
            if target.exists() and read_json(target) != draft["sheet"]:
                raise RpcError("idempotency_conflict", "A different investigator already occupies this campaign slot")
            pending_action = params.get("pending_action")
            if pending_action:
                requests = params.get("player_requests") or []
                if not isinstance(pending_action, str) or not any(isinstance(r, str) and pending_action in r for r in requests):
                    raise invalid_params("pending_action must quote a real player request")
                state.setdefault("prologue", {})["pending_action"] = pending_action
            self.setup._start_world_if_ready(campaign, meta)
            campaign.write_sheet(draft["sheet"])
            state["confirmed_revision"] = draft["revision"]
            state["receipts"] = [*(state.get("receipts") or []), draft["receipt"]]
            if state.get("prologue"):
                state["prologue"]["last_exchange"] = str(params.get("last_exchange") or "")
                state["prologue"]["introduction"] = {"name": draft["sheet"]["name"], "occupation": draft["sheet"]["occupation"]}
            meta["investigators"] = ["investigator"]
            campaign.write_campaign(meta)
            return {**self.result(draft), "committed": True}

    def prologue(self, params):
        campaign = self.campaign(params)
        with locked(campaign):
            meta = campaign.read_campaign()
            state = meta.setdefault("setup", {})
            if state.get("prologue"):
                return {"recorded": True}
            if meta.get("status") != "setting_up":
                raise invalid_params("prologue recording belongs to setup")
            graph = self.table.graph(meta["module_id"])
            scene = graph.scene(params.get("scene"))
            selected = graph.scene(meta["opening_scene"]) if meta.get("opening_scene") else graph.start_scene()
            if graph.handle(scene) != graph.handle(selected):
                raise invalid_params("the prologue must use the authored opening scene")
            guide = params.get("guide")
            if guide:
                npc = graph.npc(guide)
                present = graph.scene_npc_ids(scene)
                if graph.handle(npc) not in present and npc["node_id"] not in present:
                    raise invalid_params("the guide must be present in the opening")
            state["prologue"] = {"scene": graph.display_name(scene), "guide": guide,
                                 "opening": str(params.get("text") or ""), "handoff": str(params.get("handoff") or "")}
            campaign.write_campaign(meta)
            return {"recorded": True}
