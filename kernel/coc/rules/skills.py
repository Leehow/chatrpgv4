"""Skill and characteristic resolution for table.resolve (contract §5 step 2-3).

The vocabulary is closed: the investigator sheet, the coc7 skill table (English
names plus the localized labels the rules data carries) and the nine characteristics
(English names here, localized labels from characteristic-dice.json). Anything else is
answered with a `needs` so the keeper names the skill explicitly. No label lives in
code (§16.1)."""

from __future__ import annotations

import difflib
import re
from typing import Any

from ..text import is_latin, normalize_text
from .tables import RuleTables

# abbreviation -> English name; the localized labels come from the rules data
CHARACTERISTICS: dict[str, str] = {
    "STR": "Strength", "DEX": "Dexterity", "INT": "Intelligence", "POW": "Power", "CON": "Constitution",
    "APP": "Appearance", "SIZ": "Size", "EDU": "Education", "LUCK": "Luck",
}

_LATIN_SUFFIXES = r"(?:s|es|ing|ed)?"
#: "Group (Specialization)" with ASCII or fullwidth parentheses (a localized label's own).
_PAREN = re.compile(r"^(.*?)\s*[\uff08(]\s*(.*?)\s*[)\uff09]\s*$")


def _localized(entry: dict[str, Any]) -> list[str]:
    """The `localized_labels` values of one rules-table row, whatever the languages."""
    labels = entry.get("localized_labels")
    if not isinstance(labels, dict):
        return []
    return [str(v) for v in labels.values() if isinstance(v, str) and v.strip()]


def characteristic_labels(tables: RuleTables) -> dict[str, list[str]]:
    """abbr -> the localized labels `characteristic-dice.json` carries for it."""
    try:
        table = tables.load("characteristic-dice").get("characteristics") or {}
    except (OSError, ValueError, AttributeError):
        return {}
    out: dict[str, list[str]] = {}
    for key, entry in table.items():
        abbr = str(key).upper()
        if abbr in CHARACTERISTICS and isinstance(entry, dict):
            out[abbr] = _localized(entry)
    return out


def _label_for(entry: Any, language: str) -> str | None:
    labels = entry.get("localized_labels") if isinstance(entry, dict) else None
    value = labels.get(language) if isinstance(labels, dict) else None
    return value.strip() if isinstance(value, str) and value.strip() else None


def player_glossary(tables: RuleTables, language: str) -> dict[str, str]:
    """Canonical rules name -> the word a player of `language` uses for it (contract §23).

    Characteristic abbreviations, their full canonical names, and skill names, straight from
    the rules data's own `localized_labels`. Empty for the system language, whose canonical names already are the
    player's, and empty of any term the data does not rename: a name this project does not
    have in the rulebook is left canonical rather than invented in code (§16.1).

    Read on demand rather than cached: the same process serves several campaigns and they do
    not share a play language.
    """
    if not language or language == "en":
        return {}
    out: dict[str, str] = {}
    try:
        characteristics = tables.load("characteristic-dice").get("characteristics") or {}
    except (OSError, ValueError, AttributeError):
        characteristics = {}
    for key, entry in characteristics.items():
        abbr = str(key).upper()
        if abbr in CHARACTERISTICS and (label := _label_for(entry, language)):
            out[abbr] = label
            # A characteristic check is filed under its full canonical word ("Appearance"),
            # not the abbreviation, so the glossary carries that form too -- same table row.
            name = entry.get("name") if isinstance(entry, dict) else None
            if isinstance(name, str) and name.strip() and name.strip() != abbr:
                out[name.strip()] = label
    try:
        skills = tables.skills_table()
    except (OSError, ValueError, AttributeError, KeyError):
        skills = {}
    for name, entry in skills.items():
        if (label := _label_for(entry, language)):
            out[str(name)] = label
    return out


class SkillResolver:
    def __init__(self, tables: RuleTables, sheet: dict[str, Any]) -> None:
        self.tables = tables
        self.sheet = sheet
        self.sheet_skills: dict[str, int] = {
            str(name): int(value) for name, value in (sheet.get("skills") or {}).items()
        }
        self.table_skills = tables.skills_table()
        self.groups = tables.load("skills").get("specialization_groups") or {}
        self._aliases: dict[str, set[str]] = {}
        self._build_aliases()

    # ---- vocabulary -------------------------------------------------------

    def _add_alias(self, alias: str, canonical: str, *, bare: bool = False) -> None:
        key = normalize_text(alias)
        if not key:
            return
        # A bare specialization must carry enough characters to be found in prose
        # without false hits: at least 2 CJK characters or 4 Latin letters.
        if bare and len(key) < (4 if is_latin(key) else 2):
            return
        self._aliases.setdefault(key, set()).add(canonical)

    def _add_skill_aliases(self, name: str, localized: list[str], allow_inner: bool) -> None:
        """Full name and every localized label always; the bare specialization ("Brawl",
        or a label's own parenthesized part) only for real specialization groups, never
        for placeholders like Language (Own)."""
        self._add_alias(name, name)
        parts = _PAREN.match(name)
        if parts and allow_inner:
            group, inner = parts.group(1), parts.group(2)
            self._add_alias(inner, name, bare=True)
            for piece in inner.split("/"):
                self._add_alias(piece, name, bare=True)
            self._add_alias(f"{group} {inner}", name)
        for label in localized:
            self._add_alias(label, name)
            label_parts = _PAREN.match(label)
            if label_parts and allow_inner:
                self._add_alias(label_parts.group(2), name, bare=True)
                for piece in label_parts.group(2).split("/"):
                    self._add_alias(piece, name, bare=True)

    def _allow_inner(self, name: str) -> bool:
        entry = self.table_skills.get(name) or {}
        group = entry.get("group")
        if not group:
            return False
        spec = (self.groups.get(group) or {}).get("specializations")
        return isinstance(spec, (list, dict))

    def _build_aliases(self) -> None:
        for name, entry in self.table_skills.items():
            self._add_skill_aliases(name, _localized(entry), self._allow_inner(name))
        for name in self.sheet_skills:
            self._add_skill_aliases(name, _localized(self.table_skills.get(name) or {}), self._allow_inner(name))
        glossary = characteristic_labels(self.tables)
        for abbr, english in CHARACTERISTICS.items():
            self._add_alias(abbr, abbr)
            self._add_alias(english, abbr)
            for label in glossary.get(abbr, []):
                self._add_alias(label, abbr)
        # Aliases shared by several canonicals can never identify one skill.
        self._unique: dict[str, str] = {
            key: next(iter(names)) for key, names in self._aliases.items() if len(names) == 1
        }

    def canonical_names(self) -> list[str]:
        names = list(self.sheet_skills)
        names.extend(n for n in self.table_skills if n not in self.sheet_skills)
        names.extend(CHARACTERISTICS)
        return names

    # ---- resolution -------------------------------------------------------

    def resolve_explicit(self, text: str) -> str | None:
        key = normalize_text(text)
        if key in self._unique:
            return self._unique[key]
        for canonical in self.canonical_names():
            if normalize_text(canonical) == key:
                return canonical
        return None

    def find_in_text(self, text: str) -> list[str]:
        haystack = f" {normalize_text(text)} "
        if not haystack.strip():
            return []
        found: list[str] = []
        for alias, canonical in self._unique.items():
            if is_latin(alias):
                pattern = r"(?<![a-z0-9])" + re.escape(alias) + _LATIN_SUFFIXES + r"(?![a-z0-9])"
                hit = re.search(pattern, haystack) is not None
            else:
                hit = alias in haystack
            if hit and canonical not in found:
                found.append(canonical)
        return found

    def options_for(self, text: str, preferred: list[str] | None = None, limit: int = 6) -> list[str]:
        """Up to `limit` sheet skills (then characteristics) ranked by similarity to the text."""
        options: list[str] = list(preferred or [])
        probe = normalize_text(text)
        scored: list[tuple[float, str]] = []
        for canonical in list(self.sheet_skills) + list(CHARACTERISTICS):
            if canonical in options:
                continue
            aliases = [alias for alias, name in self._unique.items() if name == canonical]
            best = 0.0
            for alias in aliases:
                if alias and alias in probe:
                    best = max(best, 1.0)
                    continue
                best = max(best, difflib.SequenceMatcher(None, alias, probe).ratio())
            value = self.sheet_skills.get(canonical, 0)
            scored.append((best + value / 1000.0, canonical))
        scored.sort(key=lambda item: (-item[0], item[1]))
        for _, canonical in scored:
            if len(options) >= limit:
                break
            options.append(canonical)
        return options[:limit]

    # ---- targets ----------------------------------------------------------

    def characteristic_value(self, abbr: str) -> int:
        chars = self.sheet.get("characteristics") or {}
        if abbr == "LUCK" and "current_luck" in self.sheet:
            return int(self.sheet["current_luck"])
        if abbr not in chars:
            raise KeyError(abbr)
        return int(chars[abbr])

    def target_value(self, canonical: str) -> int:
        if canonical in self.sheet_skills:
            return self.sheet_skills[canonical]
        if canonical in CHARACTERISTICS:
            return self.characteristic_value(canonical)
        entry = self.table_skills.get(canonical)
        if entry is None:
            raise KeyError(canonical)
        base = entry.get("base_chance")
        if isinstance(base, int):
            return base
        if isinstance(base, str):
            if base.startswith("half_"):
                return self.characteristic_value(base[len("half_"):]) // 2
            if base in CHARACTERISTICS:
                return self.characteristic_value(base)
        raise KeyError(canonical)
