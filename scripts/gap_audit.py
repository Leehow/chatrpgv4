#!/usr/bin/env python3
"""Gap auditor for coc-keeper rule tables.

Quantifies how complete each structured rule table is vs the rulebook, and
checks for structural gaps (missing rule-ids, parity, unresolved PARTIAL
items). Emits a machine-readable report the zralph detect->fix->verify loop
consumes to decide what to work on next.

Exit code 0 = no gaps; non-zero = gaps remain (used by the loop to know
whether to keep iterating).

Run:
    python3 scripts/gap_audit.py [--plugin-root plugins/coc-keeper]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Expected minimum row counts per table (from the rulebook).
# A table is "complete" when it has >= the expected count. These are floor
# values derived from the coverage audit; the rulebook often has a few more.
# ---------------------------------------------------------------------------
EXPECTED_MIN_COUNTS = {
    "weapons": (25, "weapons"),
    "skills": (78, "skills"),          # ~80 incl specializations
    "characteristic-dice": (9, "characteristics"),
    "occupations": (28, "occupations"),
    "spells": (80, "spells"),          # Grimoire ~85
    "tomes": (15, "tomes"),
    "monsters": (25, "monsters"),
    "phobias": (100, "phobias"),       # Table IX p160 = exactly 100
    "manias": (100, "manias"),         # Table X p161 = exactly 100
    "poisons": (7, "poisons"),
    "artifacts": (6, "artifacts"),
}

# bout-tables and equipment have nested structure; check separately.
# Table VII/VIII are each exactly 1-10 (1D10 roll).
EXPECTED_BOUT = {"realtime": 10, "summary": 10}
EXPECTED_EQUIP = {"1920s": 15, "modern": 15}      # p396-399

# Missing rule-ids the coverage audit flagged as still-unresolved PARTIAL.
# These should exist in rule-index.json for the audit to pass.
EXPECTED_RULE_IDS = {
    "core.development.tick",
    "core.development.improvement_roll",
    "core.luck.spend",
    "core.luck.recovery",
    "core.luck.roll",
    "core.sanity.max_formula",
}


def _load_table(root: Path, name: str) -> dict | list:
    path = root / "references" / "rules-json" / f"{name}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _count(d, key):
    """Return len of dict-or-list at d[key], or 0."""
    v = d.get(key, []) if isinstance(d, dict) else []
    return len(v)


def audit_data_counts(root: Path) -> list[str]:
    """Section A: tables with fewer rows than expected."""
    gaps = []
    for table, (expected, key) in EXPECTED_MIN_COUNTS.items():
        try:
            d = _load_table(root, table)
        except (FileNotFoundError, json.JSONDecodeError) as e:
            gaps.append(f"[A] {table}.json: UNREADABLE ({e})")
            continue
        actual = _count(d, key)
        if actual < expected:
            gaps.append(
                f"[A] {table}.json [{key}]: {actual}/{expected} rows "
                f"({actual * 100 // expected}% — need {expected - actual} more)"
            )
    # bout-tables
    try:
        bout = _load_table(root, "bout-tables")
        for sub, exp in EXPECTED_BOUT.items():
            actual = _count(bout, sub)
            if actual < exp:
                gaps.append(f"[A] bout-tables.json [{sub}]: {actual}/{exp}")
    except (FileNotFoundError, json.JSONDecodeError) as e:
        gaps.append(f"[A] bout-tables.json: UNREADABLE ({e})")
    # equipment
    try:
        equip = _load_table(root, "equipment")
        periods = equip.get("periods", {}) if isinstance(equip, dict) else {}
        for period, exp in EXPECTED_EQUIP.items():
            actual = len(periods.get(period, []))
            if actual < exp:
                gaps.append(f"[A] equipment.json [{period}]: {actual}/{exp}")
    except (FileNotFoundError, json.JSONDecodeError) as e:
        gaps.append(f"[A] equipment.json: UNREADABLE ({e})")
    return gaps


def audit_rule_ids(root: Path) -> list[str]:
    """Section B: expected rule-ids missing from rule-index.json."""
    try:
        idx = _load_table(root, "rule-index")
        ids = {r["id"] for r in idx.get("rules", [])}
    except (FileNotFoundError, json.JSONDecodeError) as e:
        return [f"[B] rule-index.json: UNREADABLE ({e})"]
    return [f"[B] missing rule-id: {rid}" for rid in EXPECTED_RULE_IDS if rid not in ids]


def audit_db_extrapolation(root: Path) -> list[str]:
    """Section B: DB/Build table must have a >524 extrapolation rule."""
    try:
        rows = _load_table(root, "damage-bonus-build")
        # rows is a list of {min,max,damage_bonus,build}
        if isinstance(rows, list) and rows:
            last = rows[-1]
            max_total = last.get("max", 0)
            if max_total < 600:
                return [f"[B] damage-bonus-build: caps at {max_total}, no >524 extrapolation"]
    except (FileNotFoundError, json.JSONDecodeError):
        return ["[B] damage-bonus-build.json: UNREADABLE"]
    blob = json.dumps(_load_table(root, "damage-bonus-build"))
    if "extrapolat" not in blob.lower() and "per_80" not in blob.lower():
        return ["[B] damage-bonus-build: no extrapolation field for >524"]
    return []


def audit_teamwork(root: Path) -> list[str]:
    """Section B: combined_roll should have a teamwork field."""
    try:
        combat = _load_table(root, "combat")
        cr = combat.get("combined_roll", {}) if isinstance(combat, dict) else {}
        blob = json.dumps(cr).lower()
        if "teamwork" not in blob:
            return ["[B] combat.json combined_roll: no teamwork field"]
    except (FileNotFoundError, json.JSONDecodeError):
        return ["[B] combat.json: UNREADABLE"]
    return []


def _load_ref(project: Path, name: str) -> dict | None:
    p = project / "checks" / f"rulebook-{name}-ref.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError:
        return None


def audit_weapon_content(root: Path, project: Path) -> list[str]:
    """Section D: weapon damage_die / base_range / malfunction / magazine vs Table XVII."""
    ref = _load_ref(project, "weapons")
    if not ref:
        return []
    rb = ref.get("weapons", {})
    try:
        w = _load_table(root, "weapons").get("weapons", {})
    except (FileNotFoundError, json.JSONDecodeError):
        return ["[D] weapons.json: UNREADABLE"]
    gaps = []
    for name, rrow in rb.items():
        if name not in w:
            gaps.append(f"[D] weapons: '{name}' in rulebook ref but not in weapons.json")
            continue
        m = w[name]
        for field, rbv in rrow.items():
            if field == "note":
                continue
            ours = m.get(field)
            if field == "uses_per_round":
                if str(ours).strip() != str(rbv).strip():
                    gaps.append(f"[D] weapons {name}.uses_per_round: ours={ours!r} rulebook={rbv!r}")
                continue
            if field == "base_range_yards":
                # null range in rulebook == melee/Touch. Our null is fine. A non-null
                # value is acceptable only if special mentions feet/reach (reach weapon).
                if rbv is None:
                    if ours is not None:
                        sp = str(m.get("special", "")).lower()
                        if "feet" not in sp and "reach" not in sp:
                            gaps.append(f"[D] weapons {name}.base_range_yards: ours={ours} rulebook=null (Touch)")
                    continue
                # rulebook has a yard range -> ours must match the integer
                if ours != rbv:
                    gaps.append(f"[D] weapons {name}.base_range_yards: ours={ours!r} rulebook={rbv!r}")
                continue
            # default exact comparison (damage_die, malfunction, magazine)
            if ours != rbv:
                gaps.append(f"[D] weapons {name}.{field}: ours={ours!r} rulebook={rbv!r}")
    return gaps


def _norm_cost(v) -> str:
    """Normalize a spell cost token for comparison.

    Strips descriptive units, lowercases, and reduces per-unit/variable forms
    to their base comparator. e.g. '10 magic points' -> '10'; 'variable' stays
    'variable'; None/0 -> '0'.
    """
    if v is None:
        return "0"
    s = str(v).strip().lower()
    if s in ("0", "none", "n/a", ""):
        return "0"
    # strip common unit words
    for word in ("magic points", "magic point", "sanity points", "sanity point",
                 "pow", "per organ", "per caster", "per dose", "per stone",
                 "per person", "per round", "per 6 hours", "per 3 doses",
                 "each", "every 6 hours of casting"):
        s = s.replace(word, "")
    s = s.strip().rstrip(";,. ").strip()
    if s in ("", "variable", "varies"):
        return "variable"
    return s


def audit_spell_costs(root: Path, project: Path) -> list[str]:
    """Section D: spell cost_mp / cost_pow / cost_sanity vs the Grimoire.

    Comparison is normalized: '10 magic points' == '10'. Variable/per-unit costs
    compare loosely. Spells marked with a non-core source_note (supplement) are
    skipped. Also checks source_page is within the Grimoire range (240-263).
    """
    ref = _load_ref(project, "spells")
    if not ref:
        return []
    core = ref.get("core_spells", {})
    cat = ref.get("category_spells", {})
    rb = {**core, **cat}
    try:
        spells = _load_table(root, "spells")
        spell_list = spells.get("spells", [])
    except (FileNotFoundError, json.JSONDecodeError):
        return ["[D] spells.json: UNREADABLE"]
    gaps = []
    by_name = {}
    for s in spell_list:
        by_name[s.get("name", "")] = s
    for name, rrow in rb.items():
        s = by_name.get(name)
        if s is None:
            gaps.append(f"[D] spells: '{name}' in rulebook ref but not in spells.json")
            continue
        for field in ("cost_mp", "cost_pow", "cost_sanity"):
            rbv = rrow.get(field)
            ours = s.get(field)
            # treat our None as 0 for cost fields
            if _norm_cost(ours) != _norm_cost(rbv):
                gaps.append(
                    f"[D] spells {name}.{field}: ours={ours!r} rulebook={rbv!r}"
                )
    # source_page range check for core spells only
    for name in core:
        s = by_name.get(name)
        if s is None:
            continue
        sp = s.get("source_page")
        try:
            spv = int(sp)
            if spv < 240 or spv > 263:
                gaps.append(
                    f"[D] spells {name}.source_page: ours={spv} outside Grimoire range 240-263"
                )
        except (ValueError, TypeError):
            gaps.append(f"[D] spells {name}.source_page: ours={sp!r} not an int in Grimoire range")
    return gaps


def audit_skill_base_chance(root: Path, project: Path) -> list[str]:
    """Section D: skill base_chance vs Skill List p56."""
    ref = _load_ref(project, "skills")
    if not ref:
        return []
    rb = ref.get("skills", {})
    try:
        skills = _load_table(root, "skills").get("skills", {})
    except (FileNotFoundError, json.JSONDecodeError):
        return ["[D] skills.json: UNREADABLE"]
    gaps = []
    for name, rbv in rb.items():
        if name not in skills:
            gaps.append(f"[D] skills: '{name}' in rulebook ref but not in skills.json")
            continue
        ours = skills[name].get("base_chance")
        # normalize: int stays int; tokens compared case-insensitively
        def _norm(x):
            if isinstance(x, (int, float)):
                return int(x)
            return str(x).strip()
        if _norm(ours) != _norm(rbv):
            gaps.append(f"[D] skills {name}.base_chance: ours={ours!r} rulebook={rbv!r}")
    return gaps


def audit_occupation_credit_rating(root: Path, project: Path) -> list[str]:
    """Section D: occupation credit_rating_range vs Sample Occupations p40-41."""
    ref = _load_ref(project, "occupations")
    if not ref:
        return []
    rb = ref.get("occupations", {})
    try:
        occs = _load_table(root, "occupations").get("occupations", {})
    except (FileNotFoundError, json.JSONDecodeError):
        return ["[D] occupations.json: UNREADABLE"]
    gaps = []
    for name, rbv in rb.items():
        if name not in occs:
            gaps.append(f"[D] occupations: '{name}' in rulebook ref but not in occupations.json")
            continue
        ours = occs[name].get("credit_rating_range")
        if isinstance(rbv, list) and isinstance(ours, list):
            if [int(ours[0]), int(ours[1])] != [int(rbv[0]), int(rbv[1])]:
                gaps.append(
                    f"[D] occupations {name}.credit_rating_range: ours={ours} rulebook={rbv}"
                )
        else:
            gaps.append(f"[D] occupations {name}.credit_rating_range: ours={ours!r} rulebook={rbv!r}")
    return gaps


def audit_spell_mechanics(root: Path, project: Path) -> list[str]:
    """Section D: spell casting/learning/mp_economy mechanic values vs Ch.9 p176-180."""
    ref = _load_ref(project, "spell-mechanics")
    if not ref:
        return []
    try:
        spells = _load_table(root, "spells")
    except (FileNotFoundError, json.JSONDecodeError):
        return ["[D] spells.json: UNREADABLE"]
    gaps = []

    def _norm_mech(v):
        if isinstance(v, bool):
            return v
        if isinstance(v, (int, float)):
            return int(v)
        s = str(v).strip().lower()
        # strip filler words that don't change semantics
        for w in (" floor", " (floor)", "exactly"):
            s = s.replace(w, "")
        return s

    for section in ("casting", "learning", "mp_economy"):
        rb_sec = ref.get(section, {})
        ours_sec = spells.get(section, {})
        if not isinstance(ours_sec, dict):
            gaps.append(f"[D] spells.{section}: missing or not an object")
            continue
        for key, rbv in rb_sec.items():
            ours = ours_sec.get(key)
            if _norm_mech(ours) != _norm_mech(rbv):
                gaps.append(
                    f"[D] spells.{section}.{key}: ours={ours!r} rulebook={rbv!r}"
                )
    return gaps


def _norm_damage(s) -> str:
    """Normalize a damage die string: lowercase, collapse whitespace, treat
    '+DB', '+db', '+damage bonus' as equivalent ('+db')."""
    if s is None:
        return ""
    t = str(s).strip().lower().replace(" ", "")
    t = t.replace("+damagebonus", "+db")
    return t


def audit_monster_attacks(root: Path, project: Path) -> list[str]:
    """Section D: monster primary-attack damage dice vs rulebook Fighting damage.

    Compares monsters.json attacks[0].damage to the rulebook's primary Fighting
    damage. Only monsters listed in the reference are checked (others have
    special/non-dice attacks that aren't comparable).
    """
    ref = _load_ref(project, "monster-attacks")
    if not ref:
        return []
    rb = ref.get("attacks", {})
    try:
        monsters = _load_table(root, "monsters").get("monsters", {})
    except (FileNotFoundError, json.JSONDecodeError):
        return ["[D] monsters.json: UNREADABLE"]
    gaps = []
    for name, rb_dmg in rb.items():
        m = monsters.get(name)
        if m is None:
            gaps.append(f"[D] monsters {name}: missing (cannot check attacks)")
            continue
        atks = m.get("attacks", [])
        if not atks:
            gaps.append(f"[D] monsters {name}.attacks: empty, expected primary '{rb_dmg}'")
            continue
        primary = atks[0].get("damage", "") if isinstance(atks[0], dict) else ""
        if _norm_damage(primary) != _norm_damage(rb_dmg):
            gaps.append(
                f"[D] monsters {name}.attacks[0].damage: ours={primary!r} rulebook={rb_dmg!r}"
            )
    return gaps


def audit_parity(keeper: Path, zcode: Path) -> list[str]:
    """Both plugins must have identical rule-id sets and shared JSON content."""
    gaps = []
    try:
        k_ids = {r["id"] for r in _load_table(keeper, "rule-index").get("rules", [])}
        z_ids = {r["id"] for r in _load_table(zcode, "rule-index").get("rules", [])}
        if k_ids != z_ids:
            gaps.append(f"[C] rule-id set mismatch: only-keeper={k_ids - z_ids} only-zcode={z_ids - k_ids}")
    except (FileNotFoundError, json.JSONDecodeError) as e:
        gaps.append(f"[C] rule-index parity: UNREADABLE ({e})")
    # spot-check a few shared JSON files for byte-content parity
    for name in ("spells", "monsters", "weapons", "skills", "tomes"):
        kf = keeper / "references" / "rules-json" / f"{name}.json"
        zf = zcode / "references" / "rules-json" / f"{name}.json"
        if kf.exists() and zf.exists() and kf.read_text() != zf.read_text():
            gaps.append(f"[C] {name}.json content differs between plugins")
    return gaps


# Section D: content correctness (not just counts).
# Authoritative bout-table results from Keeper Rulebook Table VII (p157) and
# Table VIII (p159). Each is a 1D10 roll with exactly 10 entries.
RULEBOOK_BOUT_REALTIME = {
    1: "Amnesia",
    2: "Psychosomatic disability",
    3: "Violence",
    4: "Paranoia",
    5: "Significant Person",
    6: "Faint",
    7: "Flee in panic",
    8: "Physical hysterics or emotional outburst",
    9: "Phobia",
    10: "Mania",
}
RULEBOOK_BOUT_SUMMARY = {
    1: "Amnesia",
    2: "Robbed",
    3: "Battered",
    4: "Violence",
    5: "Ideology/Beliefs",
    6: "Significant People",
    7: "Institutionalized",
    8: "Flee in panic",
    9: "Phobia",
    10: "Mania",
}


def audit_bout_content(root: Path) -> list[str]:
    """Section D: bout-tables must match the rulebook Table VII/VIII exactly."""
    gaps = []
    try:
        bout = _load_table(root, "bout-tables")
    except (FileNotFoundError, json.JSONDecodeError) as e:
        return [f"[D] bout-tables.json: UNREADABLE ({e})"]
    for sub, expected in (("realtime", RULEBOOK_BOUT_REALTIME),
                          ("summary", RULEBOOK_BOUT_SUMMARY)):
        rows = bout.get(sub, [])
        # must be exactly 1-10, no extra rows
        rolls = sorted(r.get("d10_roll", 0) for r in rows)
        if rolls != list(range(1, 11)):
            gaps.append(
                f"[D] bout-tables {sub}: d10 rolls are {rolls}, "
                f"expected exactly 1-10 (rulebook Table "
                f"{'VII' if sub=='realtime' else 'VIII'} p"
                f"{'157' if sub=='realtime' else '159'})"
            )
        # each result name must start with the rulebook name
        by_roll = {r.get("d10_roll"): r.get("result", "") for r in rows}
        for d10, exp_name in expected.items():
            got = by_roll.get(d10, "MISSING")
            if got == "MISSING":
                gaps.append(f"[D] bout-tables {sub}: missing d10={d10}")
            elif exp_name.split()[0].lower() not in got.lower() and got.lower() not in exp_name.lower():
                gaps.append(
                    f"[D] bout-tables {sub} d10={d10}: got '{got}', "
                    f"expected '{exp_name}'"
                )
    return gaps


def audit_weapon_db_flags(root: Path) -> list[str]:
    """Section D: melee weapons add DB, firearms do not (rulebook p103-104)."""
    gaps = []
    try:
        w = _load_table(root, "weapons").get("weapons", {})
    except (FileNotFoundError, json.JSONDecodeError) as e:
        return [f"[D] weapons.json: UNREADABLE ({e})"]
    for name, row in w.items():
        skill = str(row.get("skill", ""))
        adds = row.get("adds_damage_bonus")
        damage_type = str(row.get("damage_type", ""))
        damage = str(row.get("damage_die", ""))
        special = str(row.get("special", ""))
        # Status weapons (burn/stun) use Fighting skill but don't add DB.
        is_status_weapon = damage_type in ("burn", "stun") or any(
            t in (damage + " " + special).lower() for t in ("burn", "stun")
        )
        if skill.startswith("Fighting") and adds is False and not is_status_weapon:
            gaps.append(f"[D] weapons {name}: Fighting skill but adds_damage_bonus=False (melee adds DB)")
        if skill.startswith("Firearms") and adds is True:
            gaps.append(f"[D] weapons {name}: Firearms skill but adds_damage_bonus=True (firearms do not add DB)")
    return gaps


# Rulebook p405-406 authoritative impale rules:
#   "Rifles and handguns can impale, however shotguns cannot"
#   "(i) marks a weapon which can impale"
# Firearms impale by category (except shotguns); specific melee weapons
# are marked (i) in Table XVII. Per OCR of Table XVII, the (i)-marked
# melee/thrown weapons are: chainsaw, garrote, hatchet/sickle, knife (all),
# shuriken, spear (cavalry lance), spear thrown, sword medium, wood axe,
# crossbow. Sword heavy and Sword light are NOT marked (do not impale).
_IMPALE_MELEE_NAMES = {
    "knife", "sword, medium", "rapier", "epee",
    "spear", "dagger", "hatchet", "sickle", "axe", "shuriken",
    "crossbow", "garrote", "chainsaw", "switchblade", "machete",
    "cavalry lance", "wood axe",
}


def audit_weapon_damage_type(root: Path) -> list[str]:
    """Section D: damage_type must match rulebook impale rules (p405-406).

    - Firearms (handgun/rifle/SMG/MG/Bow): impale
    - Firearms (Heavy Weapons): impale EXCEPT explosive launchers
      (grenade launchers, rockets, LAW) which deal area damage and do not
      impale.
    - Firearms (shotgun): normal (cannot impale)
    - Fighting weapons in _IMPALE_MELEE_NAMES: impale
    - Other Fighting weapons: normal
    - burn/stun weapons: keep their type
    """
    gaps = []
    try:
        w = _load_table(root, "weapons").get("weapons", {})
    except (FileNotFoundError, json.JSONDecodeError) as e:
        return [f"[D] weapons.json: UNREADABLE ({e})"]
    # Explosive heavy weapons (area-effect; do not impale). The OCR damage
    # cell carries a "<dice>/<N> yards" blast-radius pattern for these.
    EXPLOSIVE_NAMES = {"m79 grenade launcher", "law", "bazooka", "rpg"}
    for key, row in w.items():
        dtype = str(row.get("damage_type", ""))
        skill = str(row.get("skill", "")).lower()
        name = str(row.get("display_name", key)).lower()
        if dtype in ("burn", "stun"):
            continue  # status weapons, no impale check
        # determine expected
        # Shotguns (by name) cannot impale; rifles/handguns can.
        is_shotgun = "shotgun" in name or ("shotgun" in skill and "rifle" not in name)
        if is_shotgun:
            expected = "normal"
        elif skill.startswith("firearms"):
            # Bow/arrow is NOT impale (rulebook has no (i) marker for it)
            if "bow" in skill and "crossbow" not in name:
                expected = "normal"
            elif "heavy" in skill and any(name.startswith(e) or e in name for e in EXPLOSIVE_NAMES):
                expected = "normal"  # explosive launcher, area-effect
            else:
                expected = "impale"
        elif skill.startswith("fighting"):
            expected = "impale" if any(n in name for n in _IMPALE_MELEE_NAMES) else "normal"
        elif "throw" in skill:
            expected = "impale" if any(n in name for n in ("spear", "shuriken")) else "normal"
        else:
            continue  # demolitions/artillery/etc — skip
        if dtype != expected:
            gaps.append(
                f"[D] weapons {key}: damage_type='{dtype}' expected '{expected}' "
                f"(skill={row.get('skill')}, name={row.get('display_name','')[:40]})"
            )
    return gaps


def _norm_stat(v) -> str:
    """Normalize a stat value to a comparable string token."""
    if v is None:
        return ""
    s = str(v).strip()
    if s in ("N/A", "n/a", "varies", "special"):
        return s.lower()
    # strip trailing .0
    try:
        return str(int(s))
    except (ValueError, TypeError):
        return s


def audit_monster_stats(root: Path, project: Path) -> list[str]:
    """Section D: monster STR/CON/SIZ/DEX/INT/POW/HP must match rulebook.

    Ref values may be ints, 'N/A', 'varies'. Our value is skipped only if
    it is absent or explicitly N/A; otherwise it must match the rulebook int.
    """
    ref_path = project / "checks" / "rulebook-monsters-ref.json"
    if not ref_path.exists():
        return []  # no reference file, skip
    try:
        ref = json.loads(ref_path.read_text())["monsters"]
    except (json.JSONDecodeError, KeyError):
        return ["[D] rulebook-monsters-ref.json: UNREADABLE"]
    try:
        monsters = _load_table(root, "monsters").get("monsters", {})
    except (FileNotFoundError, json.JSONDecodeError):
        return ["[D] monsters.json: UNREADABLE"]
    gaps = []
    for name, rb in ref.items():
        if name not in monsters:
            gaps.append(f"[D] monsters: '{name}' in rulebook ref but not in monsters.json")
            continue
        m = monsters[name]
        for attr in ("STR", "CON", "SIZ", "DEX", "INT", "POW", "HP"):
            if attr not in rb:
                continue
            rbv = rb[attr]
            rbn = _norm_stat(rbv)
            ours = m.get(attr.lower())
            on = _norm_stat(ours)
            if on == "":
                # missing in our data
                if rbn not in ("n/a", "varies", ""):
                    gaps.append(f"[D] monsters {name}.{attr}: ours=MISSING rulebook={rbv}")
                continue
            if on == "n/a":
                continue  # our data marks it N/A; acceptable for N/A/varies rulebook values
            # numeric comparison
            if rbn in ("n/a", "varies"):
                continue  # rulebook is non-numeric; cannot compare numerically
            try:
                if int(on) != int(rbn):
                    gaps.append(f"[D] monsters {name}.{attr}: ours={ours} rulebook={rbv}")
            except ValueError:
                if on != rbn:
                    gaps.append(f"[D] monsters {name}.{attr}: ours={ours} rulebook={rbv}")
    return gaps


def audit_monster_san_loss(root: Path, project: Path) -> list[str]:
    """Section D: monster san_loss must match rulebook 'success/failure' dice.

    Our schema: san_loss={"success": "X", "failure": "Y"} OR {"success":"X/Y",...}.
    Rulebook ref: san_loss="X/Y". We compare X==success and Y==failure.
    """
    ref_path = project / "checks" / "rulebook-monsters-ref.json"
    if not ref_path.exists():
        return []
    try:
        ref = json.loads(ref_path.read_text())["monsters"]
    except (json.JSONDecodeError, KeyError):
        return []
    try:
        monsters = _load_table(root, "monsters").get("monsters", {})
    except (FileNotFoundError, json.JSONDecodeError):
        return ["[D] monsters.json: UNREADABLE"]
    gaps = []
    for name, rb in ref.items():
        if name not in monsters:
            continue
        if "san_loss" not in rb:
            continue  # ref has no SAN value for this monster (e.g. supplements)
        rb_san = rb["san_loss"]  # "X/Y"
        ours = monsters[name].get("san_loss")
        if ours is None:
            gaps.append(f"[D] monsters {name}.san_loss: ours=MISSING rulebook={rb_san}")
            continue
        # parse our value
        if isinstance(ours, dict):
            our_success = str(ours.get("success", "")).strip()
            our_failure = str(ours.get("failure", "")).strip()
        else:
            our_success = our_failure = ""
        # rulebook split
        if "/" in rb_san:
            rb_success, rb_failure = rb_san.split("/", 1)
            rb_success = rb_success.strip()
            rb_failure = rb_failure.strip()
        else:
            rb_success = rb_failure = rb_san.strip()
        # normalize our success: it may erroneously hold "X/Y"
        if "/" in our_success:
            our_success = our_success.split("/", 1)[0].strip()
        # normalize dice case-insensitively (1d6 == 1D6)
        def _dn(s):
            return s.upper().replace(" ", "")
        if _dn(our_success) != _dn(rb_success):
            gaps.append(
                f"[D] monsters {name}.san_loss.success: ours={our_success!r} rulebook={rb_success!r}"
            )
        if _dn(our_failure) != _dn(rb_failure):
            gaps.append(
                f"[D] monsters {name}.san_loss.failure: ours={our_failure!r} rulebook={rb_failure!r}"
            )
    return gaps


def audit_monster_armor(root: Path, project: Path) -> list[str]:
    """Section D: monster armor must match rulebook.

    Ref armor is int, "special", or omitted. When the ref is an int, our armor
    must equal it. When ref is "special", our armor may be any non-positive or
    'special'/text value (we only flag if we claim a specific large number that
    contradicts special). When ref omits armor, skip.
    """
    ref_path = project / "checks" / "rulebook-monsters-ref.json"
    if not ref_path.exists():
        return []
    try:
        ref = json.loads(ref_path.read_text())["monsters"]
    except (json.JSONDecodeError, KeyError):
        return []
    try:
        monsters = _load_table(root, "monsters").get("monsters", {})
    except (FileNotFoundError, json.JSONDecodeError):
        return ["[D] monsters.json: UNREADABLE"]
    gaps = []
    for name, rb in ref.items():
        if name not in monsters:
            continue
        if "armor" not in rb:
            continue
        rb_armor = rb["armor"]
        ours = monsters[name].get("armor")
        if isinstance(rb_armor, int):
            try:
                if int(ours) != rb_armor:
                    gaps.append(f"[D] monsters {name}.armor: ours={ours} rulebook={rb_armor}")
            except (ValueError, TypeError):
                gaps.append(f"[D] monsters {name}.armor: ours={ours!r} rulebook={rb_armor}")
        # rb_armor == "special": only flag if our value is a positive int > 0
        # (a concrete armor number contradicts "no numeric armor / special rule")
        elif rb_armor == "special":
            try:
                if isinstance(ours, (int, float)) and int(ours) > 0:
                    gaps.append(
                        f"[D] monsters {name}.armor: ours={ours} but rulebook=special (no numeric armor pts)"
                    )
            except (ValueError, TypeError):
                pass
    return gaps


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plugin-root", default="plugins/coc-keeper")
    ap.add_argument("--zcode-root", default="plugins/coc-keeper-zcode")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    root = Path(args.plugin_root)
    zroot = Path(args.zcode_root)
    # project root = parent of plugin-root (for checks/ dir)
    project = root.parent.parent if root.parent.name == "plugins" else Path.cwd()

    all_gaps = []
    all_gaps += audit_data_counts(root)
    all_gaps += audit_rule_ids(root)
    all_gaps += audit_db_extrapolation(root)
    all_gaps += audit_teamwork(root)
    all_gaps += audit_bout_content(root)
    all_gaps += audit_weapon_db_flags(root)
    all_gaps += audit_weapon_damage_type(root)
    all_gaps += audit_monster_stats(root, project)
    all_gaps += audit_monster_san_loss(root, project)
    all_gaps += audit_monster_armor(root, project)
    all_gaps += audit_weapon_content(root, project)
    all_gaps += audit_spell_costs(root, project)
    all_gaps += audit_skill_base_chance(root, project)
    all_gaps += audit_occupation_credit_rating(root, project)
    all_gaps += audit_spell_mechanics(root, project)
    all_gaps += audit_monster_attacks(root, project)
    all_gaps += audit_parity(root, zroot)

    if all_gaps:
        if not args.quiet:
            print(f"GAP AUDIT: {len(all_gaps)} gap(s) found:")
            for g in all_gaps:
                print(f"  - {g}")
        else:
            print(f"{len(all_gaps)} gaps")
    else:
        print("GAP AUDIT: clean — no gaps detected.")
    # non-zero exit so the loop knows gaps remain
    return 1 if all_gaps else 0


if __name__ == "__main__":
    sys.exit(main())
