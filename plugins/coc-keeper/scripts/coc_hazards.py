#!/usr/bin/env python3
"""Environmental / other-forms-of-damage engine for Call of Cthulhu 7e (W3-3).

Implements Keeper Rulebook Table III: Other Forms of Damage (p.124) plus the
asphyxiation/drowning and poison footnotes, as pure structured helpers plus a
small HazardSession for persistence.

Rulebook basis (7e 40th Anniversary, Chapter 6):
- Table III severity ladder (p.124): minor 1D3, moderate 1D6, severe 1D10,
  deadly 2D10, terminal 4D10, splat 8D10 — one incident or one round.
- Environmental sources (poison, drowning, fire, falling, etc.) bypass armor
  (p.120: "armor will not reduce damage from magical attacks, poison,
  drowning, etc.").
- Asphyxiation and Drowning (*): CON roll each round; once failed, damage
  each round thereafter until death or the victim can breathe. Physical
  exertion → Hard CON. "Death occurs at 0 hit points (ignore the Major
  Wound rule)."
- Poisons (**): Extreme CON success halves damage. Sample poisons p.129
  (very mild / mild / strong / lethal bands).

Does NOT modify coc_combat.py. Conditions such as ``dying``, ``unconscious``,
``major_wound``, ``dead``, ``suffocating`` are written as structured tags on
the participant/investigator state dict for the apply layer to consume.

Files managed (via HazardSession):
  save/hazards.json                      — active environmental effects
  save/investigator-state/<id>.json      — current_hp + conditions (merged)
  logs/events.jsonl                      — hazard events
"""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
RULES_DIR = SCRIPT_DIR.parent / "references" / "rules-json"


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_roll = _load_sibling("coc_roll", "coc_roll.py")
coc_fileio = _load_sibling("coc_fileio", "coc_fileio.py")


# --------------------------------------------------------------------------- #
# Table III severity ladder (p.124) — encoded defaults; hazards.json may
# override / extend via load_hazards_table().
# --------------------------------------------------------------------------- #
SEVERITY_TIERS: dict[str, dict[str, Any]] = {
    "minor": {
        "damage_expr": "1D3",
        "rulebook_page": 124,
        "note": "A person could survive numerous occurrences of this level.",
    },
    "moderate": {
        "damage_expr": "1D6",
        "rulebook_page": 124,
        "note": "Might cause a major wound; a few such attacks to kill.",
    },
    "severe": {
        "damage_expr": "1D10",
        "rulebook_page": 124,
        "note": "Likely major wound; one or two occurrences unconscious/dead.",
    },
    "deadly": {
        "damage_expr": "2D10",
        "rulebook_page": 124,
        "note": "Average person has ~50% chance of dying.",
    },
    "terminal": {
        "damage_expr": "4D10",
        "rulebook_page": 124,
        "note": "Outright death is likely.",
    },
    "splat": {
        "damage_expr": "8D10",
        "rulebook_page": 124,
        "note": "Outright death almost certain.",
    },
}

# Default asphyxiation damage severity when kind maps to Table III examples.
SUFFOCATION_DEFAULT_SEVERITY = {
    "drowning": "moderate",       # breathing water → 1D6
    "asphyxiation": "minor",      # breathing smoky atmosphere → 1D3
    "vacuum": "moderate",         # exposure to vacuum → 1D6
}

POISON_POTENCY_DAMAGE = {
    "very_mild": None,   # no damage; temporary unconsciousness
    "mild": "1D10",
    "strong": "2D10",
    "lethal": "4D10",
}


# --------------------------------------------------------------------------- #
# Rule-data loading
# --------------------------------------------------------------------------- #
def load_hazards_table(rules_dir: Path | None = None) -> dict[str, Any]:
    rdir = rules_dir or RULES_DIR
    path = rdir / "hazards.json"
    if not path.exists():
        return {
            "severity": dict(SEVERITY_TIERS),
            "presets": {},
        }
    return json.loads(path.read_text(encoding="utf-8"))


def load_poisons_table(rules_dir: Path | None = None) -> dict[str, Any]:
    rdir = rules_dir or RULES_DIR
    path = rdir / "poisons.json"
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("poisons", {})


def _severity_damage_expr(severity: str, table: dict[str, Any] | None = None) -> str:
    key = severity.strip().lower()
    tiers = (table or load_hazards_table()).get("severity") or SEVERITY_TIERS
    if key not in tiers:
        raise KeyError(f"unknown Table III severity: {severity!r}")
    return str(tiers[key]["damage_expr"])


def _resolve_preset(
    hazard_id: str, table: dict[str, Any] | None = None
) -> dict[str, Any]:
    presets = (table or load_hazards_table()).get("presets") or {}
    if hazard_id not in presets:
        raise KeyError(f"unknown hazard preset: {hazard_id!r}")
    return dict(presets[hazard_id])


def _ensure_conditions(participant: dict[str, Any]) -> list[str]:
    conds = participant.get("conditions")
    if conds is None:
        participant["conditions"] = []
        return participant["conditions"]
    if not isinstance(conds, list):
        participant["conditions"] = list(conds)
    return participant["conditions"]


def _add_condition(participant: dict[str, Any], tag: str) -> None:
    conds = _ensure_conditions(participant)
    if tag not in conds:
        conds.append(tag)


def _remove_condition(participant: dict[str, Any], tag: str) -> None:
    conds = _ensure_conditions(participant)
    while tag in conds:
        conds.remove(tag)


def _apply_hp_loss(
    participant: dict[str, Any],
    raw_damage: int,
    *,
    ignore_major_wound: bool = False,
) -> dict[str, Any]:
    """Apply HP loss and structured wound/death conditions.

    When ``ignore_major_wound`` is True (suffocation/drowning, p.124), reaching
    0 HP sets ``dead`` and never ``dying`` — even if ``major_wound`` is present.
    """
    hp_before = int(participant.get("current_hp", 0))
    hp_max = int(participant.get("hp_max", hp_before) or hp_before)
    damage = max(0, int(raw_damage))
    hp_after = max(0, hp_before - damage)
    participant["current_hp"] = hp_after

    major_this_blow = damage >= max(1, (hp_max + 1) // 2) and damage > 0
    if major_this_blow and not ignore_major_wound:
        _add_condition(participant, "major_wound")

    died = False
    if hp_after <= 0 and damage > 0:
        if ignore_major_wound:
            _add_condition(participant, "dead")
            _remove_condition(participant, "dying")
            died = True
        elif "major_wound" in _ensure_conditions(participant):
            _add_condition(participant, "dying")
        else:
            _add_condition(participant, "unconscious")

    return {
        "hp_before": hp_before,
        "hp_after": hp_after,
        "hp_delta": hp_after - hp_before,
        "raw_damage": damage,
        "major_wound_this_blow": major_this_blow and not ignore_major_wound,
        "died": died,
    }


# --------------------------------------------------------------------------- #
# apply_other_damage — Table III (p.124)
# --------------------------------------------------------------------------- #
def apply_other_damage(
    participant: dict[str, Any],
    *,
    severity: str | None = None,
    hazard_id: str | None = None,
    damage_expr: str | None = None,
    rng: random.Random | None = None,
    source: str = "environmental",
    ignore_major_wound: bool = False,
    rules_dir: Path | None = None,
) -> dict[str, Any]:
    """Apply one incident/round of Table III other-forms damage.

    Always sets ``bypass_armor: True`` (environmental / non-weapon sources).
    Resolve severity via ``severity``, ``hazard_id`` preset, or explicit
    ``damage_expr`` (priority: damage_expr > hazard_id > severity).
    """
    rng = rng or random.Random()
    table = load_hazards_table(rules_dir)
    category = "other"
    resolved_severity = severity
    resolved_hazard_id = hazard_id
    expr = damage_expr

    if expr is None and hazard_id is not None:
        preset = _resolve_preset(hazard_id, table)
        resolved_severity = str(preset.get("severity") or resolved_severity or "moderate")
        category = str(preset.get("category") or category)
        expr = preset.get("damage_expr") or _severity_damage_expr(resolved_severity, table)
    elif expr is None:
        if resolved_severity is None:
            raise ValueError("apply_other_damage requires severity, hazard_id, or damage_expr")
        expr = _severity_damage_expr(resolved_severity, table)
        # Infer category from common severity-only calls stays "other".

    roll = coc_roll.roll_expression(str(expr), rng)
    raw = int(roll["total"])
    hp = _apply_hp_loss(participant, raw, ignore_major_wound=ignore_major_wound)

    event: dict[str, Any] = {
        "event_type": "other_damage",
        "participant_id": participant.get("id"),
        "source": source,
        "severity": resolved_severity,
        "hazard_id": resolved_hazard_id,
        "category": category,
        "damage_expr": str(expr).upper(),
        "damage_roll": roll,
        "bypass_armor": True,
        "ignore_major_wound": ignore_major_wound,
        "rule_refs": ["core.combat.other_forms_of_damage"],
        **hp,
    }
    return event


# --------------------------------------------------------------------------- #
# Suffocation / drowning state machine (p.124 footnote *)
# --------------------------------------------------------------------------- #
def _suffocation_severity_for_kind(kind: str) -> str:
    return SUFFOCATION_DEFAULT_SEVERITY.get(kind, "moderate")


def start_suffocation(
    participant: dict[str, Any],
    *,
    kind: str = "drowning",
    severity: str | None = None,
    exertion: bool = False,
) -> dict[str, Any]:
    """Mark participant as suffocating and return the start event + state blob."""
    sev = severity or _suffocation_severity_for_kind(kind)
    _add_condition(participant, "suffocating")
    state = {
        "kind": kind,
        "severity": sev,
        "exertion": bool(exertion),
        "rounds_under": 0,
        "con_failed": False,
        "active": True,
    }
    event = {
        "event_type": "suffocation_start",
        "participant_id": participant.get("id"),
        "kind": kind,
        "severity": sev,
        "exertion": bool(exertion),
        "condition": "suffocating",
        "bypass_armor": True,
        "rule_refs": ["core.combat.other_forms_of_damage"],
        "summary": (
            f"{participant.get('id')} begins {kind} "
            f"(severity={sev}, exertion={bool(exertion)})."
        ),
    }
    return {"event": event, "state": state}


def suffocation_round(
    participant: dict[str, Any],
    state: dict[str, Any],
    *,
    rng: random.Random | None = None,
    con_roll_result: dict[str, Any] | None = None,
    rules_dir: Path | None = None,
) -> dict[str, Any]:
    """Advance one round of asphyxiation/drowning.

    Before the first CON failure: roll CON (Hard if exertion). On failure,
    apply Table III damage this round. After the first failure: apply damage
    every round with no further CON gate. At 0 HP → ``dead`` (ignore major
    wound / dying).
    """
    if not state.get("active"):
        return {
            "event_type": "suffocation_round",
            "participant_id": participant.get("id"),
            "skipped": True,
            "reason": "not_active",
        }

    rng = rng or random.Random()
    state["rounds_under"] = int(state.get("rounds_under", 0)) + 1
    con = int(participant.get("con", 50))
    difficulty = "hard" if state.get("exertion") else "regular"
    con_failed = bool(state.get("con_failed"))
    con_outcome = None
    con_roll = None
    rolled_this_round = False
    damage_applied = False
    raw_damage = 0
    damage_event: dict[str, Any] | None = None
    died = False
    death_rule = None

    if not con_failed:
        if con_roll_result is not None:
            con_roll = dict(con_roll_result)
        else:
            con_roll = coc_roll.percentile_check(con, difficulty=difficulty, rng=rng)
        rolled_this_round = True
        con_outcome = str(con_roll.get("outcome", "failure"))
        success = con_outcome in {"regular", "hard", "extreme", "critical"}
        if not success:
            con_failed = True
            state["con_failed"] = True

    if con_failed:
        sev = str(state.get("severity") or "moderate")
        damage_event = apply_other_damage(
            participant,
            severity=sev,
            rng=rng,
            source=f"suffocation:{state.get('kind', 'asphyxiation')}",
            ignore_major_wound=True,
            rules_dir=rules_dir,
        )
        damage_applied = True
        raw_damage = int(damage_event["raw_damage"])
        died = bool(damage_event.get("died"))
        if died:
            death_rule = "suffocation_ignore_major_wound"
            state["active"] = False
            _remove_condition(participant, "suffocating")

    return {
        "event_type": "suffocation_round",
        "participant_id": participant.get("id"),
        "kind": state.get("kind"),
        "rounds_under": state["rounds_under"],
        "con_difficulty": difficulty,
        "con_roll": con_roll if rolled_this_round else None,
        "con_outcome": con_outcome,
        "con_failed": con_failed,
        "damage_applied": damage_applied,
        "raw_damage": raw_damage,
        "bypass_armor": True,
        "died": died,
        "death_rule": death_rule,
        "hp_before": (
            damage_event["hp_before"] if damage_event else participant.get("current_hp")
        ),
        "hp_after": (
            damage_event["hp_after"] if damage_event else participant.get("current_hp")
        ),
        "rule_refs": ["core.combat.other_forms_of_damage"],
    }


def end_suffocation(
    participant: dict[str, Any],
    state: dict[str, Any],
    *,
    reason: str = "able_to_breathe",
) -> dict[str, Any]:
    state["active"] = False
    _remove_condition(participant, "suffocating")
    return {
        "event_type": "suffocation_end",
        "participant_id": participant.get("id"),
        "kind": state.get("kind"),
        "reason": reason,
        "rounds_under": state.get("rounds_under", 0),
        "rule_refs": ["core.combat.other_forms_of_damage"],
    }


# --------------------------------------------------------------------------- #
# Poison (p.124 footnote ** / Sample Poisons p.129)
# --------------------------------------------------------------------------- #
def _infer_potency(entry: dict[str, Any]) -> str:
    if entry.get("potency"):
        return str(entry["potency"])
    expr = str(entry.get("damage_expr") or entry.get("damage_or_effect") or "").upper()
    if "NO DAMAGE" in expr or expr.startswith("NO "):
        return "very_mild"
    if "4D10" in expr:
        return "lethal"
    if "2D10" in expr:
        return "strong"
    if "1D10" in expr:
        return "mild"
    return "mild"


def _poison_damage_expr(entry: dict[str, Any], potency: str) -> str | None:
    if "damage_expr" in entry:
        raw = entry["damage_expr"]
        if raw is None:
            return None
        expr = str(raw).strip()
        if not expr or expr.upper() in {"NONE", "NO", "0", "NULL"}:
            return None
        return expr.upper()
    return POISON_POTENCY_DAMAGE.get(potency)


def _zero_hp_delta(participant: dict[str, Any]) -> dict[str, Any]:
    hp = int(participant.get("current_hp", 0))
    return {
        "hp_before": hp,
        "hp_after": hp,
        "hp_delta": 0,
        "raw_damage": 0,
        "major_wound_this_blow": False,
        "died": False,
    }


def apply_poison(
    participant: dict[str, Any],
    poison_id: str,
    *,
    rng: random.Random | None = None,
    doses: int = 1,
    con_roll_result: dict[str, Any] | None = None,
    allow_critical_shake_off: bool = True,
    rules_dir: Path | None = None,
) -> dict[str, Any]:
    """Apply one dose (or more) of a named poison from poisons.json.

    Extreme CON success halves damage (p.124 / p.129). Critical success may
    shake off effects entirely when ``allow_critical_shake_off`` is True.
    Multiple doses add a penalty die to the CON roll (p.129).
    """
    rng = rng or random.Random()
    poisons = load_poisons_table(rules_dir)
    if poison_id not in poisons:
        raise KeyError(f"unknown poison_id: {poison_id!r}")
    entry = dict(poisons[poison_id])
    potency = _infer_potency(entry)
    symptom_tags = list(entry.get("symptoms") or [])
    onset = entry.get("onset")
    expr = _poison_damage_expr(entry, potency)

    con = int(participant.get("con", 50))
    penalty = max(0, int(doses) - 1)
    if con_roll_result is not None:
        con_roll = dict(con_roll_result)
    else:
        con_roll = coc_roll.percentile_check(
            con, difficulty="regular", penalty=penalty, rng=rng
        )
    con_outcome = str(con_roll.get("outcome", "failure"))

    shaken_off = bool(allow_critical_shake_off and con_outcome == "critical")
    damage_halved = False
    damage_before_halve = 0
    raw_damage = 0
    damage_roll = None

    if shaken_off:
        hp = _zero_hp_delta(participant)
    elif potency == "very_mild" or expr is None:
        # No HP damage; temporary unconsciousness for very mild (p.129).
        if "unconscious" not in symptom_tags:
            symptom_tags = list(symptom_tags) + ["unconscious"]
        _add_condition(participant, "unconscious")
        hp = _zero_hp_delta(participant)
    else:
        damage_roll = coc_roll.roll_expression(expr, rng)
        damage_before_halve = int(damage_roll["total"])
        raw_damage = damage_before_halve
        if con_outcome in {"extreme", "critical"}:
            # Extreme (≤ CON/5) halves damage. Round up residual half-point.
            raw_damage = (damage_before_halve + 1) // 2
            damage_halved = True
        hp = _apply_hp_loss(participant, raw_damage, ignore_major_wound=False)

    return {
        "event_type": "poison",
        "participant_id": participant.get("id"),
        "poison_id": poison_id,
        "potency": potency,
        "onset": onset,
        "doses": int(doses),
        "symptom_tags": list(symptom_tags),
        "damage_expr": expr,
        "damage_roll": damage_roll,
        "damage_before_halve": damage_before_halve,
        "damage_halved": damage_halved,
        "shaken_off": shaken_off,
        "con_roll": con_roll,
        "con_outcome": con_outcome,
        "bypass_armor": True,
        "rule_refs": ["core.combat.poisons", "core.combat.other_forms_of_damage"],
        "raw_damage": 0 if shaken_off else raw_damage,
        "hp_before": hp["hp_before"],
        "hp_after": hp["hp_after"],
        "hp_delta": hp["hp_delta"],
        "died": hp.get("died", False),
    }


# --------------------------------------------------------------------------- #
# Persistence helpers
# --------------------------------------------------------------------------- #
def _inv_state_path(campaign_dir: Path, investigator_id: str) -> Path:
    return campaign_dir / "save" / "investigator-state" / f"{investigator_id}.json"


def _read_inv_state(campaign_dir: Path, investigator_id: str) -> dict[str, Any]:
    path = _inv_state_path(campaign_dir, investigator_id)
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_inv_state(campaign_dir: Path, investigator_id: str, data: dict[str, Any]) -> None:
    path = _inv_state_path(campaign_dir, investigator_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    coc_fileio.write_json_atomic(
        path, data, indent=2, ensure_ascii=False, trailing_newline=True
    )


def _hazards_path(campaign_dir: Path) -> Path:
    return campaign_dir / "save" / "hazards.json"


def _append_event(campaign_dir: Path, event: dict[str, Any]) -> None:
    path = campaign_dir / "logs" / "events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


# --------------------------------------------------------------------------- #
# HazardSession
# --------------------------------------------------------------------------- #
class HazardSession:
    """Session wrapper around environmental damage / suffocation / poison.

    Deterministic given the injected RNG. Tracks active suffocation states
    keyed by participant id and accumulates structured events.
    """

    def __init__(
        self,
        rng: random.Random | None = None,
        *,
        rules_dir: Path | None = None,
    ) -> None:
        self._rng = rng or random.Random()
        self._rules_dir = rules_dir
        self.active: dict[str, dict[str, Any]] = {}
        self.events: list[dict[str, Any]] = []
        self._event_counter = 0

    def _record(self, event: dict[str, Any]) -> dict[str, Any]:
        self._event_counter += 1
        ev = {"eid": f"hz{self._event_counter}", **event}
        self.events.append(ev)
        return ev

    def apply_other_damage(
        self,
        participant: dict[str, Any],
        *,
        severity: str | None = None,
        hazard_id: str | None = None,
        damage_expr: str | None = None,
        source: str = "environmental",
        ignore_major_wound: bool = False,
    ) -> dict[str, Any]:
        ev = apply_other_damage(
            participant,
            severity=severity,
            hazard_id=hazard_id,
            damage_expr=damage_expr,
            rng=self._rng,
            source=source,
            ignore_major_wound=ignore_major_wound,
            rules_dir=self._rules_dir,
        )
        return self._record(ev)

    def start_suffocation(
        self,
        participant: dict[str, Any],
        *,
        kind: str = "drowning",
        severity: str | None = None,
        exertion: bool = False,
    ) -> dict[str, Any]:
        result = start_suffocation(
            participant, kind=kind, severity=severity, exertion=exertion
        )
        pid = str(participant.get("id") or "unknown")
        self.active[pid] = result["state"]
        return self._record(result["event"])

    def suffocation_round(
        self,
        participant: dict[str, Any],
        *,
        con_roll_result: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        pid = str(participant.get("id") or "unknown")
        state = self.active.get(pid)
        if state is None:
            return self._record({
                "event_type": "suffocation_round",
                "participant_id": pid,
                "skipped": True,
                "reason": "no_active_suffocation",
            })
        ev = suffocation_round(
            participant,
            state,
            rng=self._rng,
            con_roll_result=con_roll_result,
            rules_dir=self._rules_dir,
        )
        if not state.get("active"):
            self.active.pop(pid, None)
        return self._record(ev)

    def end_suffocation(
        self,
        participant: dict[str, Any],
        *,
        reason: str = "able_to_breathe",
    ) -> dict[str, Any]:
        pid = str(participant.get("id") or "unknown")
        state = self.active.pop(pid, {
            "kind": "asphyxiation",
            "rounds_under": 0,
            "active": False,
        })
        return self._record(end_suffocation(participant, state, reason=reason))

    def apply_poison(
        self,
        participant: dict[str, Any],
        poison_id: str,
        *,
        doses: int = 1,
        con_roll_result: dict[str, Any] | None = None,
        allow_critical_shake_off: bool = True,
    ) -> dict[str, Any]:
        ev = apply_poison(
            participant,
            poison_id,
            rng=self._rng,
            doses=doses,
            con_roll_result=con_roll_result,
            allow_critical_shake_off=allow_critical_shake_off,
            rules_dir=self._rules_dir,
        )
        return self._record(ev)

    # ------------------------------------------------------------------ #
    # Persistence
    # ------------------------------------------------------------------ #
    def snapshot(self) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "active": {k: dict(v) for k, v in self.active.items()},
            "events": list(self.events),
        }

    def save(
        self,
        campaign_dir: Path,
        *,
        participant: dict[str, Any] | None = None,
    ) -> Path:
        """Write save/hazards.json; optionally merge HP/conditions for one participant."""
        path = _hazards_path(campaign_dir)
        path.parent.mkdir(parents=True, exist_ok=True)
        snap = self.snapshot()
        # Don't dump the full event log into the save file — keep it lean.
        lean = {"schema_version": 1, "active": snap["active"]}
        coc_fileio.write_json_atomic(
            path, lean, indent=2, ensure_ascii=False, trailing_newline=True
        )
        if participant is not None and participant.get("id"):
            pid = str(participant["id"])
            data = _read_inv_state(campaign_dir, pid)
            data["current_hp"] = participant.get("current_hp")
            data["conditions"] = list(_ensure_conditions(participant))
            if "hp_max" in participant:
                data["hp_max"] = participant["hp_max"]
            if "con" in participant:
                data["con"] = participant["con"]
            _write_inv_state(campaign_dir, pid, data)
        return path

    def persist_events(self, campaign_dir: Path) -> None:
        for ev in self.events:
            _append_event(campaign_dir, ev)

    @classmethod
    def load(
        cls,
        campaign_dir: Path,
        rng: random.Random | None = None,
        *,
        rules_dir: Path | None = None,
    ) -> "HazardSession":
        sess = cls(rng=rng, rules_dir=rules_dir)
        path = _hazards_path(campaign_dir)
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            active = data.get("active") or {}
            if isinstance(active, dict):
                sess.active = {str(k): dict(v) for k, v in active.items()}
        return sess
