"""coc7 rules: tables and the percentile check (slice 0) plus the slice-1 engines.

`tables` / `percentile` / `skills` are the slice-0 core. `graph` loads the RuleGraph and
runs it (RulesRuntime); `adapter` binds CoC 7e slots and composed flows; `executors` maps
capability names to engine calls; `runtime` wires all of it to the campaign store.
Engines: `resolver` (checks, social, psychology, push/luck, damage), `healing`, `mp`,
`magic`, `mythos`, `development`, `rule_options`; `catalog` is the recall surface behind
`table.lookup kind=catalog`."""

from .percentile import percentile_check, resolve_percentile_roll
from .skills import CHARACTERISTICS, SkillResolver
from .tables import RuleTables

__all__ = [
    "CHARACTERISTICS",
    "RuleTables",
    "SkillResolver",
    "percentile_check",
    "resolve_percentile_roll",
]
