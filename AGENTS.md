# Project Rules

## COC Plugin Single-Track Law

This repository maintains one plugin track:

- `plugins/coc-keeper/` is the canonical Codex plugin.

Do not recreate a parallel host-specific plugin copy. Shared runtime behavior
lives only in `plugins/coc-keeper/`.

Platform-specific capabilities must stay explicitly gated in the Codex plugin.
In particular, investigator portrait generation is Codex-only and must remain
inside `CODEX_ONLY_IMAGEGEN` markers in `skills/coc-character/SKILL.md`. Other
hosts should skip that capability rather than invent a second plugin tree.

Before finishing plugin work, run at minimum:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py -q -p no:cacheprovider
```

## Playtest Battle Report Evidence Standard

When the user asks to see a COC playtest battle report, "战报" means an actual
playtest artifact with gameplay evidence, not a formatter smoke test or a
synthetic unit-test fixture.

- Do not present scripted regression baselines, formatter-only fixtures, or
  synthetic smoke-test reports as "the battle report" unless explicitly labeled
  as such.
- Before summarizing or quoting a battle report, read the generated
  `battle-report.md` end to end.
- A battle report used as gameplay evidence should include, at minimum,
  investigator context, player/KP transcript or actual-play turns, rules/rolls
  when relevant, discovered clues, scene progression, and any narrative
  enrichment/storylet effects being evaluated.
- If no live LLM-vs-KP runner or real playtest artifact is available, state that
  limitation directly and do not substitute a smoke-test artifact as if it were
  gameplay evidence.
- Formatter smoke tests may be used to verify rendering bugs, but call them
  "formatter verification samples", not battle reports.

## Semantic Matcher Constitution

Do not classify player intent, NPC hostility, clue relevance, report coverage,
storylet fit, or other meaning-bearing behavior by hardcoded keyword hits or
fixed prose fragments.

- Runtime logic may consume structured fields, explicit enums, boolean flags,
  IDs, tags, rules data, and LLM/semantic-router outputs with recorded reasons.
- Runtime logic must not infer meaning by scanning free text such as player
  prose, NPC agenda prose, scene summaries, battle reports, or translated
  module text for fixed phrases.
- If a semantic distinction is needed but only free text is available, add or
  call a semantic compilation/router step that emits structured evidence; do
  not add another local keyword list.
- Legacy compatibility fallbacks that still use string heuristics should be
  treated as technical debt and not copied into new behavior.

## Runtime Track

`runtime/` is the open headless agent interface (Event SDK + debug/pi adapters).
It must not fork keeper skills or rules. Shared behavior remains in
`plugins/coc-keeper/`. Project brain switch lives at `.coc/runtime.json`.
