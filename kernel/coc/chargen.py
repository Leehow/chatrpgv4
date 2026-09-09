"""Deterministic investigator creation (contract §14.7).

The model brings a name and an occupation id; everything numeric comes from the
rules tables under `content/rulesets/coc7/rules-json` and from the policy block of
`content/setup/steps.json` (`create-investigator.defaults/formulas/interest_pool`).
No number in this module is a literal of its own: the array, the dice, the age
brackets, the derived-value divisors, the skill bases, the cap, the finance tiers
and the point formulas are all read, and the receipt says which table each came
from. Choices the rulebook leaves to the player (which alternative of a formula,
which of "any one other skill") are not judged here: the formula takes the
alternative worth the most points and says so; a skill phrase that is not a
catalog name is returned in `choices_pending`, untouched, for the table to settle
with the development family."""

from __future__ import annotations

import random
import re
from typing import Any

from .rules import RuleTables
from .rules.percentile import roll_expression
from .text import kebab, normalize

FORMULA_TERM = re.compile(r"([A-Z]{3})\s*\*\s*(\d+)")
METHODS = ("quick_fire", "rolled")
#: #21: how occupation points land. `spread` walks the occupational list tier by tier
#: (the policy block's `tiers`, then the cap); `fill` is the earlier one-point round-robin
#: over the resolvable entries only. Which one, and the tiers, are content
#: (steps.json create-investigator.allocation), never a literal here.
ALLOCATION_POLICIES = ("spread", "fill")
LUCK_KEY = "Luck"


class ChargenError(ValueError):
    """A parameter the kernel cannot honour; `stage` names the step, `expected` what would."""

    def __init__(self, stage: str, message: str, *, expected: Any = None) -> None:
        super().__init__(message)
        self.stage = stage
        self.expected = expected


# ---- formulas ---------------------------------------------------------------------

def parse_formula(formula: str) -> dict[str, Any]:
    """`EDU*4` → base terms; `EDU*2+either APP*2, DEX*2 or STR*2` → base plus one
    alternative per named term. Anything without a `ABBR*n` term is an error."""
    text = str(formula or "")
    head, _, tail = text.partition("either")
    base = [(abbr, int(mult)) for abbr, mult in FORMULA_TERM.findall(head)]
    alternatives = [[(abbr, int(mult))] for abbr, mult in FORMULA_TERM.findall(tail)]
    if not base and not alternatives:
        raise ChargenError("formula", f"skill point formula {formula!r} has no ABBR*n term")
    return {"formula": text, "base": base, "alternatives": alternatives}


def evaluate_formula(parsed: dict[str, Any], characteristics: dict[str, int]) -> dict[str, Any]:
    """Sum of the base terms plus the richest alternative; the alternative taken is
    reported so the receipt can say which one."""
    total = sum(int(characteristics[abbr]) * mult for abbr, mult in parsed["base"])
    chosen: list[tuple[str, int]] | None = None
    best = None
    for alternative in parsed["alternatives"]:
        value = sum(int(characteristics[abbr]) * mult for abbr, mult in alternative)
        if best is None or value > best:
            best, chosen = value, alternative
    if best is not None:
        total += best
    return {"formula": parsed["formula"], "total": total,
            "terms": [f"{abbr}*{mult}" for abbr, mult in parsed["base"]],
            "alternative": [f"{abbr}*{mult}" for abbr, mult in chosen] if chosen else None}


def formula_characteristics(parsed: dict[str, Any]) -> list[str]:
    """Characteristics the formula names, base first, then alternatives in order."""
    order: list[str] = []
    for abbr, _ in parsed["base"] + [term for alt in parsed["alternatives"] for term in alt]:
        if abbr not in order:
            order.append(abbr)
    return order


# ---- the builder ------------------------------------------------------------------

class Chargen:
    def __init__(self, tables: RuleTables, policy: dict[str, Any]) -> None:
        self.tables = tables
        #: the `create-investigator` step of content/setup/steps.json
        self.policy = policy
        dice = tables.load("characteristic-dice")
        self.multiplier = int(dice["multiplier"])
        self.dice_table = dice["characteristics"]
        self.characteristics = [key for key in self.dice_table if key != LUCK_KEY]
        self.methods = dice["generation_methods"]
        self.age_rules = tables.load("age-adjustments")
        self.derived_rules = tables.load("derived-attributes")
        self.skills_doc = tables.load("skills")
        self.cap = int(self.skills_doc["guided_creation_policy"]["starting_skill_cap"])

    # ---- occupations ----------------------------------------------------------------

    def occupations(self) -> list[dict[str, Any]]:
        rows = []
        for occupation_id, spec in self.tables.occupations_table().items():
            rows.append({"id": occupation_id, "name": occupation_id,
                         "skill_point_formula": spec.get("skill_point_formula"),
                         "occupational_skills": list(spec.get("occupational_skills") or []),
                         "credit_rating_range": list(spec.get("credit_rating_range") or []),
                         "tags": list(spec.get("tags") or [])})
        return rows

    def occupation(self, occupation_id: Any) -> tuple[str, dict[str, Any]]:
        table = self.tables.occupations_table()
        if isinstance(occupation_id, str) and occupation_id in table:
            return occupation_id, table[occupation_id]
        key = normalize(str(occupation_id or ""))
        for name, spec in table.items():
            if normalize(name) == key:
                return name, spec
        raise ChargenError("occupation", f"unknown occupation id {occupation_id!r}",
                           expected={"options": sorted(table)})

    # ---- characteristics ------------------------------------------------------------

    def quick_fire(self, priority: list[str]) -> dict[str, Any]:
        method = self.methods["quick_fire_array"]
        array = [int(v) for v in method["array"]]
        order = [abbr for abbr in priority if abbr in self.characteristics]
        order.extend(abbr for abbr in self.characteristics if abbr not in order)
        values = {abbr: value for abbr, value in zip(order, array, strict=True)}
        return {"method": "quick_fire", "values": values, "assignment_order": order,
                "array": array, "source": "characteristic-dice.generation_methods.quick_fire_array"}

    def dice_pools(self) -> list[tuple[str, list[str]]]:
        """Characteristics grouped by the die that makes them; a pool assignment never
        crosses groups, so the 3D6 results stay among STR/CON/DEX/APP/POW and the
        2D6+6 results among SIZ/INT/EDU."""
        pools: list[tuple[str, list[str]]] = []
        for abbr in self.characteristics:
            expression = str(self.dice_table[abbr]["dice"]).strip().upper().replace(" ", "")
            for key, pool in pools:
                if key == expression:
                    pool.append(abbr)
                    break
            else:
                pools.append((expression, [abbr]))
        return pools

    def aptitude(self, value: Any) -> dict[str, list[str]] | None:
        """The player's own words about this person, already read into characteristics by
        the setup model. The kernel only accepts the closed set; it classifies no prose."""
        if value is None:
            return None
        declared = value if isinstance(value, dict) else {}
        strong = [str(abbr) for abbr in (declared.get("strong") or [])]
        weak = [str(abbr) for abbr in (declared.get("weak") or [])]
        if not strong and not weak:
            return None
        unknown = [abbr for abbr in strong + weak if abbr not in self.characteristics]
        if unknown:
            raise ChargenError("aptitude", f"unknown characteristics {unknown!r}",
                               expected={"options": list(self.characteristics)})
        both = [abbr for abbr in strong if abbr in weak]
        if both:
            raise ChargenError("aptitude", f"{both!r} cannot be both notably strong and notably weak",
                               expected={"strong": strong, "weak": weak})
        if len(set(strong)) != len(strong) or len(set(weak)) != len(weak):
            raise ChargenError("aptitude", "name each characteristic at most once",
                               expected={"strong": strong, "weak": weak})
        return {"strong": strong, "weak": weak}

    def _assign(self, rolled: dict[str, Any], aptitude: dict[str, list[str]]) -> dict[str, str]:
        """Which slot's result each characteristic ends up holding. The multiset of results
        is unchanged: named strong take the highest remaining of their pool in listed order,
        named weak the lowest, and everyone else keeps their own result when it is free."""
        held: dict[str, str] = {}
        total = lambda slot: int(rolled[slot]["total"])  # noqa: E731
        for _, pool in self.dice_pools():
            available = list(pool)
            #: ties keep the first slot in table order, which `max`/`min` already do
            for pick, named in ((max, aptitude["strong"]), (min, aptitude["weak"])):
                for abbr in named:
                    if abbr in pool:
                        chosen = pick(available, key=total)
                        available.remove(chosen)
                        held[abbr] = chosen
            rest = [abbr for abbr in pool if abbr not in held]
            for abbr in rest:
                if abbr in available:
                    available.remove(abbr)
                    held[abbr] = abbr
            for abbr in rest:
                if abbr not in held:
                    held[abbr] = available.pop(0)
        return held

    def rolled(self, rng: random.Random, aptitude: dict[str, list[str]] | None = None) -> dict[str, Any]:
        rolled = {abbr: roll_expression(str(self.dice_table[abbr]["dice"]), rng) for abbr in self.characteristics}
        held = self._assign(rolled, aptitude) if aptitude else {abbr: abbr for abbr in self.characteristics}
        values: dict[str, int] = {}
        rolls: dict[str, Any] = {}
        for abbr in self.characteristics:
            roll = rolled[held[abbr]]
            values[abbr] = int(roll["total"]) * self.multiplier
            rolls[abbr] = {"dice": roll["expression"], "faces": roll["rolls"], "total": roll["total"]}
        generated = {"method": "rolled", "values": values, "rolls": rolls,
                     "multiplier": self.multiplier, "source": "characteristic-dice.characteristics"}
        if not aptitude:
            return generated

        def direction(abbr: str) -> str | None:
            return "strong" if abbr in aptitude["strong"] else "weak" if abbr in aptitude["weak"] else None

        generated.update(method="rolled_pool_assignment", aptitude=aptitude,
                         assignment=[{"characteristic": abbr, "rolled_for": held[abbr], "direction": direction(abbr)}
                                     for abbr in self.characteristics],
                         source="characteristic-dice.generation_methods.rolled_pool_assignment")
        return generated

    def luck(self, rng: random.Random, keep_highest: int) -> dict[str, Any]:
        spec = self.dice_table[LUCK_KEY]
        attempts = []
        for _ in range(max(1, keep_highest)):
            roll = roll_expression(str(spec["dice"]), rng)
            attempts.append({"faces": roll["rolls"], "total": roll["total"]})
        best = max(a["total"] for a in attempts)
        return {"value": best * self.multiplier, "dice": str(spec["dice"]).upper(), "attempts": attempts,
                "keep_highest": keep_highest, "multiplier": self.multiplier,
                "source": "characteristic-dice.characteristics.Luck"}

    # ---- age ------------------------------------------------------------------------

    def age_bracket(self, age: int) -> dict[str, Any]:
        lo, hi = int(self.age_rules["minimum_age"]), int(self.age_rules["maximum_age"])
        if not isinstance(age, int) or isinstance(age, bool) or not lo <= age <= hi:
            raise ChargenError("age", f"age must be an integer between {lo} and {hi}",
                               expected={"minimum_age": lo, "maximum_age": hi})
        for row in self.age_rules["brackets"]:
            if int(row["min_age"]) <= age <= int(row["max_age"]):
                return row
        raise ChargenError("age", f"no age bracket for {age}: {self.age_rules.get('unlisted_age_policy')}",
                           expected={"brackets": [r["key"] for r in self.age_rules["brackets"]]})

    def apply_age(self, characteristics: dict[str, int], age: int, rng: random.Random) -> dict[str, Any]:
        """The bracket's EDU/APP reductions, its STR/CON/DEX(/SIZ) spend spread evenly
        across the listed choices, and its EDU improvement checks (1D100 > EDU → +1D10,
        capped) rolled here. Returns the adjusted values and the arithmetic."""
        bracket = self.age_bracket(age)
        adjusted = dict(characteristics)
        trace: dict[str, Any] = {"bracket": bracket["key"], "source": "age-adjustments.brackets"}
        edu_reduction = int(bracket.get("edu_reduction", 0))
        app_reduction = int(bracket.get("app_reduction", 0))
        adjusted["EDU"] = max(0, adjusted["EDU"] - edu_reduction)
        adjusted["APP"] = max(0, adjusted["APP"] - app_reduction)
        trace["edu_reduction"] = edu_reduction
        trace["app_reduction"] = app_reduction

        total = int(bracket.get("characteristic_reduction_total", 0))
        choices = [str(c) for c in bracket.get("characteristic_reduction_choices") or []]
        reductions = []
        if total and choices:
            base, extra = divmod(total, len(choices))
            for index, abbr in enumerate(choices):
                amount = base + (1 if index < extra else 0)
                if amount > 0:
                    adjusted[abbr] = max(0, adjusted[abbr] - amount)
                    reductions.append({"characteristic": abbr, "amount": amount})
        trace["characteristic_reductions"] = reductions

        checks = []
        edu_max = int(self.age_rules.get("edu_maximum", 99))
        for _ in range(int(bracket.get("edu_improvement_checks", 0))):
            check = roll_expression(str(self.age_rules["edu_improvement_die"]), rng)
            row: dict[str, Any] = {"roll": check["total"], "edu": adjusted["EDU"]}
            if check["total"] > adjusted["EDU"]:
                gain = roll_expression(str(self.age_rules["edu_improvement_amount"]), rng)
                row["improvement"] = gain["total"]
                adjusted["EDU"] = min(edu_max, adjusted["EDU"] + int(gain["total"]))
            checks.append(row)
        trace["edu_improvement_checks"] = checks
        trace["mov_penalty"] = int(bracket.get("mov_penalty", 0))
        trace["luck_rolls_keep_highest"] = max(1, int(bracket.get("luck_rolls_keep_highest", 1)))
        return {"values": adjusted, "trace": trace}

    # ---- derived --------------------------------------------------------------------

    def movement(self, characteristics: dict[str, int], mov_penalty: int) -> dict[str, Any]:
        table = self.tables.load("movement-rate")
        siz = int(characteristics["SIZ"])

        def relation(value: int) -> str:
            return "less_than" if value < siz else ("greater_than" if value > siz else "equal")

        str_rel, dex_rel = relation(int(characteristics["STR"])), relation(int(characteristics["DEX"]))
        for row in table["rules"]:
            if row["str_relation_to_siz"] not in ("any", str_rel):
                continue
            if row["dex_relation_to_siz"] not in ("any", dex_rel):
                continue
            base = int(row["base_mov"])
            minimum = int(table.get("age_penalty", {}).get("minimum_mov", 0))
            return {"mov": max(minimum, base - mov_penalty), "base_mov": base, "rule": row["key"],
                    "age_mov_penalty": mov_penalty, "source": "movement-rate.rules"}
        raise ChargenError("derived", "no movement-rate rule matched")

    def derive(self, characteristics: dict[str, int], luck: int, mov_penalty: int) -> dict[str, Any]:
        hp = self.derived_rules["hit_points"]
        mp = self.derived_rules["magic_points"]
        san = self.derived_rules["sanity"]
        db = self.tables.damage_bonus_build(int(characteristics["STR"]), int(characteristics["SIZ"]))
        mov = self.movement(characteristics, mov_penalty)
        derived = {
            "HP": sum(int(characteristics[s]) for s in hp["sources"]) // int(hp["divisor"]),
            "SAN": int(characteristics[san["source"]]),
            "MP": int(characteristics[mp["source"]]) // int(mp["divisor"]),
            "MOV": mov["mov"],
            "DB": db["damage_bonus"],
            "BUILD": db["build"],
        }
        trace = {"HP": f"derived-attributes.hit_points ({'+'.join(hp['sources'])})/{hp['divisor']}",
                 "SAN": f"derived-attributes.sanity ({san['source']})",
                 "MP": f"derived-attributes.magic_points ({mp['source']})/{mp['divisor']}",
                 "MOV": f"{mov['source']} {mov['rule']} - age penalty {mov_penalty}",
                 "DB": f"damage-bonus-build STR+SIZ={db['total']}", "BUILD": f"damage-bonus-build STR+SIZ={db['total']}",
                 "LUCK": "characteristic-dice.characteristics.Luck"}
        return {"values": derived, "trace": trace}

    # ---- skills ---------------------------------------------------------------------

    def catalog_name(self, phrase: str) -> str | None:
        """A catalog skill name for a phrase, or None when the phrase is not one
        (a rulebook choice such as "any one other skill" stays a phrase)."""
        key = normalize(phrase)
        for name in self.tables.skills_table():
            if normalize(name) == key:
                return name
        return None

    def skill_base(self, name: str, characteristics: dict[str, int]) -> int:
        if name.startswith("Language (Other: ") and name.endswith(")"):
            base = self.tables.skill_specialization_groups()["Language (Other)"]["base_chance"]
        else:
            base = self.tables.skill_by_name(name)["base_chance"]
        if isinstance(base, int):
            return base
        text = str(base)
        if text.startswith("half_"):
            return int(characteristics[text[len("half_"):]]) // 2
        return int(characteristics[text])

    def standard_sheet(self, era: str) -> list[str] | None:
        sheet = (self.skills_doc.get("standard_sheet") or {}).get(era)
        return [str(s) for s in sheet["default_skill_ids"]] if isinstance(sheet, dict) else None

    def allocation_policy(self, name: Any) -> dict[str, Any]:
        """The occupation-point policy: `name` when given, else the block's default. The
        tiers come from the block too; the cap is skills.json's."""
        block = self.policy.get("allocation") if isinstance(self.policy.get("allocation"), dict) else {}
        policy = name if name is not None else block.get("default")
        if policy not in ALLOCATION_POLICIES:
            raise ChargenError("allocation", f"allocation must be one of {ALLOCATION_POLICIES}",
                               expected={"options": list(ALLOCATION_POLICIES), "default": block.get("default")})
        tiers = block.get("tiers") if isinstance(block.get("tiers"), list) else []
        if not all(isinstance(t, int) and not isinstance(t, bool) for t in tiers):
            raise ChargenError("allocation", "allocation.tiers must be integers", expected={"tiers": tiers})
        return {"policy": str(policy), "tiers": [int(t) for t in tiers],
                "source": "steps.json create-investigator.allocation"}

    @staticmethod
    def spread(slots: list[str], resolved: set[str], budget: int, values: dict[str, int], cap: int,
               tiers: list[int]) -> tuple[dict[str, int], list[dict[str, Any]]]:
        """Every entry of the occupational list is a slot, in the book's order. Tier by
        tier (`tiers`, then the cap) each resolved skill is raised to the tier; an entry
        the kernel cannot name (`any one other skill`, a group like `Firearms`) is reserved
        the tier's value — its base is unknown, so nothing less guarantees the tier — and
        that reservation stays unspent for the table's development family. Stops when the
        budget is gone; what is left over is unspent too."""
        allocations = {slot: 0 for slot in slots if slot in resolved}
        reserved: dict[str, int] = {slot: 0 for slot in slots if slot not in resolved}
        remaining = int(budget)
        targets = [min(int(t), cap) for t in tiers if int(t) < cap] + [cap]
        for target in targets:
            for slot in slots:
                if remaining <= 0:
                    break
                if slot in allocations:
                    need = target - (values[slot] + allocations[slot])
                else:
                    need = target - reserved[slot]
                if need <= 0:
                    continue
                give = min(need, remaining)
                if slot in allocations:
                    allocations[slot] += give
                else:
                    reserved[slot] += give
                remaining -= give
        return ({k: v for k, v in allocations.items() if v > 0},
                [{"for": phrase, "points": points} for phrase, points in reserved.items() if points > 0])

    @staticmethod
    def allocate(skill_ids: list[str], budget: int, values: dict[str, int], cap: int) -> dict[str, int]:
        """`fill`: one point at a time down the list, skipping skills at the cap, until the
        budget is spent or nothing can take more (the old allocate_points_in_order)."""
        allocations = {skill_id: 0 for skill_id in skill_ids}
        remaining = int(budget)
        while remaining > 0 and skill_ids:
            progressed = False
            for skill_id in skill_ids:
                if remaining <= 0:
                    break
                if values[skill_id] + allocations[skill_id] >= cap:
                    continue
                allocations[skill_id] += 1
                remaining -= 1
                progressed = True
            if not progressed:
                break
        return {k: v for k, v in allocations.items() if v > 0}

    # ---- the sheet ------------------------------------------------------------------

    def build(self, *, investigator_id: str, name: str, occupation_id: str, concept: str | None,
              age: int, sex: str | None, method: str, seed: str, era: str,
              allocation: str | None = None, aptitude: Any = None,
              occupation_skills: list[str] | None = None,
              interest_skills: list[str] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
        if method not in METHODS:
            raise ChargenError("method", f"method must be one of {METHODS}", expected={"options": list(METHODS)})
        occupation_name, spec = self.occupation(occupation_id)
        policy = self.allocation_policy(allocation)
        formula = parse_formula(str(spec.get("skill_point_formula") or ""))
        stated = self.aptitude(aptitude)
        if stated and method != "rolled":
            raise ChargenError("aptitude", "a stated aptitude assigns rolled results and cannot direct the quick-fire array",
                               expected={"method": method, "expected_method": "rolled"})
        rng = random.Random(seed)
        trace: dict[str, Any] = {"seed": seed, "method": method}

        # 1. characteristics
        if method == "quick_fire":
            generated = self.quick_fire(formula_characteristics(formula))
        else:
            generated = self.rolled(random.Random(seed + ":characteristics") if occupation_skills is not None else rng, stated)
        trace["method"] = str(generated["method"])
        trace["characteristics"] = generated
        aged = self.apply_age(generated["values"], age, random.Random(seed + ":age") if occupation_skills is not None else rng)
        characteristics = aged["values"]
        trace["age"] = aged["trace"]
        luck = self.luck(random.Random(seed + ":luck") if occupation_skills is not None else rng, aged["trace"]["luck_rolls_keep_highest"])
        trace["luck"] = luck
        characteristics["LUCK"] = luck["value"]

        # 2. derived
        derived = self.derive(characteristics, luck["value"], aged["trace"]["mov_penalty"])
        trace["derived"] = derived["trace"]

        # 3. skills: bases for the era's standard sheet plus the occupation's list
        sheet_ids = self.standard_sheet(era)
        resolved: list[str] = []
        pending: list[str] = []
        #: the occupational list in the book's order, each entry its catalog name or,
        #: when it is a rulebook choice the kernel does not make, the phrase itself
        slots: list[str] = []
        for phrase in spec.get("occupational_skills") or []:
            found = self.catalog_name(str(phrase))
            if found is None:
                pending.append(str(phrase))
                slots.append(str(phrase))
            elif found not in resolved:
                resolved.append(found)
                slots.append(found)
        if occupation_skills is not None:
            resolved = list(occupation_skills)
            slots = list(occupation_skills)
            pending = []
        credit_range = [int(v) for v in spec.get("credit_rating_range") or [0, 0]]
        credit_rating = credit_range[0]
        listed = list(sheet_ids or [])
        for skill_id in resolved:
            if skill_id not in listed:
                listed.append(skill_id)
        if "Credit Rating" not in listed:
            listed.append("Credit Rating")
        values = {skill_id: self.skill_base(skill_id, characteristics) for skill_id in listed}
        values["Credit Rating"] = credit_rating

        budget = evaluate_formula(formula, characteristics)
        occupation_pool = [s for s in resolved if s != "Credit Rating"]
        occupation_points = max(0, budget["total"] - credit_rating)
        reserved: list[dict[str, Any]] = []
        if policy["policy"] == "spread":
            occupation_alloc, reserved = self.spread([s for s in slots if s != "Credit Rating"], set(occupation_pool),
                                                     occupation_points, values, self.cap, policy["tiers"])
        else:
            occupation_alloc = self.allocate(occupation_pool, occupation_points, values, self.cap)
        for skill_id, points in occupation_alloc.items():
            values[skill_id] += points

        interest_formula = parse_formula(str(self.policy["formulas"]["personal_interest_points"]))
        interest_budget = evaluate_formula(interest_formula, characteristics)
        exclude = set(self.policy["interest_pool"].get("exclude") or [])
        interest_pool = list(interest_skills) if interest_skills is not None else [s for s in (sheet_ids or []) if s not in resolved and s not in exclude]
        for skill_id in interest_pool:
            if skill_id not in values:
                values[skill_id] = self.skill_base(skill_id, characteristics)
        interest_alloc = self.allocate(interest_pool, interest_budget["total"], values, self.cap)
        for skill_id, points in interest_alloc.items():
            values[skill_id] += points
        if occupation_skills is not None and (sum(occupation_alloc.values()) != occupation_points or sum(interest_alloc.values()) != interest_budget["total"]):
            raise ChargenError("skills", "Selected skills cannot hold the full budget; choose more interest skills or a wider legal occupational selection", expected={"occupation_unspent": occupation_points-sum(occupation_alloc.values()), "interest_unspent": interest_budget["total"]-sum(interest_alloc.values())})
        trace["skills"] = {
            "standard_sheet": f"skills.standard_sheet.{era}" if sheet_ids else None,
            "cap": {"value": self.cap, "source": "skills.guided_creation_policy.starting_skill_cap"},
            "occupation": {"id": occupation_name, "resolved": resolved, "choices_pending": pending,
                           "budget": budget, "credit_rating": {"value": credit_rating, "range": credit_range,
                                                                "source": "occupations.credit_rating_range[0]"},
                           "points": occupation_points, "spent": sum(occupation_alloc.values()),
                           "unspent": occupation_points - sum(occupation_alloc.values()),
                           "allocations": occupation_alloc, "allocation": policy["policy"],
                           # #21: unspent points set aside, per pending entry, for the table
                           "reserved": reserved},
            "interest": {"budget": interest_budget, "pool": interest_pool, "spent": sum(interest_alloc.values()),
                         "allocations": interest_alloc,
                         "unspent": interest_budget["total"] - sum(interest_alloc.values())},
        }

        # 4. finance and kit
        try:
            finance = self.tables.cash_and_assets(credit_rating, era)
        except ValueError as exc:
            finance = None
            trace["finance"] = {"available": False, "reason": str(exc), "source": "cash-assets.periods"}
        else:
            trace["finance"] = {"available": True, "source": f"cash-assets.periods.{era}"}
        trace["equipment"] = {"source": None,
                              "note": "equipment.json records carry no occupation field; no default kit is invented"}
        #: #21: the policy by name, with its tiers and where they came from
        trace["allocation"] = policy

        sheet: dict[str, Any] = {
            "schema_version": 1,
            "id": investigator_id,
            "name": name,
            "occupation": occupation_name,
            "era": era,
            "age": age,
            "sex": sex,
            "characteristics": {**{k: int(characteristics[k]) for k in self.characteristics}, "LUCK": luck["value"]},
            "derived": derived["values"],
            "skills": dict(sorted(values.items())),
            "weapons": [],
            "equipment": [],
            "backstory": {"concept": concept},
            "credit_rating": credit_rating,
            "cash": (f"{finance['cash']['amount']} {finance['cash']['currency']}" if finance else None),
            "finance": finance,
            "creation": trace,
        }
        receipt = {
            "id": f"investigator:{investigator_id}",
            "kind": "investigator",
            "investigator": investigator_id,
            "name": name,
            "occupation": occupation_name,
            "method": str(generated["method"]),
            "seed": seed,
            "choices_pending": pending,
            "allocation": policy["policy"],
            "occupation_unspent": trace["skills"]["occupation"]["unspent"],
            "occupation_reserved": sum(int(r["points"]) for r in reserved),
            "interest_unspent": trace["skills"]["interest"]["unspent"],
            "finance_available": finance is not None,
        }
        return sheet, receipt


def default_investigator_id(name: str, ordinal: int) -> str:
    """kebab of a Latin name; `inv-<n>` when the name has no Latin letters to slug."""
    slug = kebab(name)
    if slug and re.fullmatch(r"[a-z0-9][a-z0-9-]*", slug):
        return slug
    return f"inv-{ordinal}"
