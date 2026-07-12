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

## Canonical Evaluation Contract

Codex, ZCode, Cursor, CI, and local agents must use the same versioned evaluation
entry point for official COC Keeper validation:

```bash
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite <smoke|pr|nightly|release|diagnostic> --root .
```

Additional official commands on the same CLI: `report`, `verify`, `compare`,
`baseline`, `matrix`, `calibrate`, and `holdouts`. Details live in
`plugins/coc-keeper/skills/coc-playtest/SKILL.md` (official evaluation
section). Do not add a parallel `coc-eval` skill tree.

Use `smoke` for fast local contract checks and `pr` for ordinary change
validation. Do not replace the named suite with an agent-specific collection of
commands and still call the result an official evaluation. `nightly` or
`release` may be claimed only when that exact suite records `PASS`; a
`NOT_RUN` capability must not be hidden by running a smaller suite.

For an existing playtest run, generate or verify its report contract with:

```bash
python3 plugins/coc-keeper/scripts/coc_eval.py report <run-dir>
python3 plugins/coc-keeper/scripts/coc_eval.py verify <run-dir>
```

The exact status vocabulary is `PASS`, `FAIL`, `INELIGIBLE`, `NOT_RUN`, and
`NON_COMPARABLE`. Missing evidence never becomes `PASS`. Deterministic fixture
and registry self-tests are contract evidence; they are not external-model
gameplay battle reports.

### Dice Completeness Gate

Structured roll logs are authoritative. Every required `public` or
`consequence_public` roll must appear exactly once in the report's
`rules-and-dice` section with source-traceable numerical detail. A report with a
missing required public roll is a hard failure; the same applies to a duplicate
marker, untraced marker, malformed roll log, or missing roll source log. If no
public rolls occurred, the report must explicitly record a public roll count of
zero.

Never reconstruct missing dice from memory or report prose. Never remove a
failed completeness finding when delivering a report.

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
- Before delivering any report, read `artifacts/report-completeness.json`; a
  failed or missing receipt must be stated directly.
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
