"""Skill and characteristic resolution for table.resolve (contract §5 step 2-3).

The vocabulary is closed: the investigator sheet, the coc7 skill table (English
names plus their zh-Hans labels) and the nine characteristics. Anything else is
answered with a `needs` so the keeper names the skill explicitly."""

from __future__ import annotations

import difflib
import re
from typing import Any

from ..text import is_latin, normalize_text
from .tables import RuleTables

# abbreviation -> (English name, zh-Hans name)
CHARACTERISTICS: dict[str, tuple[str, str]] = {
    "STR": ("Strength", "力量"),
    "DEX": ("Dexterity", "敏捷"),
    "INT": ("Intelligence", "智力"),
    "POW": ("Power", "意志"),
    "CON": ("Constitution", "体质"),
    "APP": ("Appearance", "外貌"),
    "SIZ": ("Size", "体型"),
    "EDU": ("Education", "教育"),
    "LUCK": ("Luck", "幸运"),
}

_LATIN_SUFFIXES = r"(?:s|es|ing|ed)?"
_PAREN = re.compile(r"^(.*?)\s*[（(]\s*(.*?)\s*[)）]\s*$")


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

    def _add_skill_aliases(self, name: str, zh_label: str | None, allow_inner: bool) -> None:
        """Full name and zh label always; the bare specialization ("Brawl", "手枪") only
        for real specialization groups, never for placeholders like Language (Own)."""
        self._add_alias(name, name)
        parts = _PAREN.match(name)
        if parts and allow_inner:
            group, inner = parts.group(1), parts.group(2)
            self._add_alias(inner, name, bare=True)
            for piece in inner.split("/"):
                self._add_alias(piece, name, bare=True)
            self._add_alias(f"{group} {inner}", name)
        if zh_label:
            self._add_alias(zh_label, name)
            zh_parts = _PAREN.match(zh_label)
            if zh_parts and allow_inner:
                self._add_alias(zh_parts.group(2), name, bare=True)
                for piece in zh_parts.group(2).split("/"):
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
            labels = entry.get("localized_labels") or {}
            self._add_skill_aliases(name, labels.get("zh-Hans"), self._allow_inner(name))
        for name in self.sheet_skills:
            labels = (self.table_skills.get(name) or {}).get("localized_labels") or {}
            self._add_skill_aliases(name, labels.get("zh-Hans"), self._allow_inner(name))
        for abbr, (english, chinese) in CHARACTERISTICS.items():
            self._add_alias(abbr, abbr)
            self._add_alias(english, abbr)
            self._add_alias(chinese, abbr)
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
