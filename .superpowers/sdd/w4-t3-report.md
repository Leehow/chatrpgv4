# W4 Task 3 Report: P1-8 — 语言能力通电到 narration contract

## Status

DONE. Dialogue comprehension tier is wired into the narration contract: when a
scene's NPC carries a structured `foreign_dialogue` marker, enrichment computes
the investigator's comprehension tier via `coc_language` and injects a
`narrative_directives.dialogue_comprehension` directive telling the narrator how
much foreign dialogue to reveal (source-only / fragments / partial / full).

## Commit

`feat(coc): wire dialogue comprehension tier into narration contract (P1-8)`
(see `git log` for hash — commit created at end of task)

## What was done

### 1. `coc_narrative_enrichment.py` (canonical + zcode synced)
- Loaded `coc_language` as an optional sibling (mirrors the existing
  `coc_storylets` load pattern): `coc_language = _load_optional_sibling("coc_language", "coc_language.py")`.
- Added `build_dialogue_comprehension_directive(scene, npc_agendas, investigator, *, investigator_skills=None)`
  helper. It scans `scene.npc_ids` → npc-agendas for a structured
  `foreign_dialogue` marker (`{"source_language": "German", "sample_line": ...}`),
  calls `coc_language.language_skill_for_source` + `dialogue_comprehension_tier`,
  and returns a list of `{npc_id, source_language, sample_line, skill_value, native,
  comprehension, translation_visible, requires_investigator_skill, rule, source}`.
- Wired the helper into `enrich_director_plan`: the directive is injected into
  `narrative_directives.dialogue_comprehension` ONLY when at least one NPC in the
  scene carries a `foreign_dialogue` marker (guard: `if dialogue_comprehension:`).
  Otherwise the key is omitted entirely, so unrelated scenes are unaffected.
- Guard: if `coc_language` is unavailable, the helper returns `[]` (no crash, no
  malformed directive).
- Constitution: `source_language` and the skill value are both structured; the
  helper never scans free text.

### 2. `coc_story_director.py` (canonical + zcode synced)
- `build_director_context` now exposes `investigator_skills` (the character's
  structured skills dict) in the returned ctx. This lets enrichment gate
  foreign-dialogue translation on the actual Language skill value in live play
  without re-reading the character sheet. Slim dict only; the full sheet stays
  private. Backward-compatible (new optional key).

### 3. `the-white-war/npc-agendas.json` (canonical + zcode synced)
- Added `foreign_dialogue: {"source_language": "German", "sample_line": "Der Schrecken... unten."}`
  to `npc-surprise-austrian-survivor` (the crazed Austrian). Also extended his
  `keeper_note` to state Italian investigators without Language (Other: German)
  cannot parse his moaned phrase.
- Did NOT mark `npc-tomasso-like-survivor` (the old mountain man). He is a
  civilian prisoner conscripted by Austrians, but his voice is described as a
  "regional dialect" and the scenario is ambiguous about whether his speech is
  foreign to the Italian investigators. Marking him would be over-claiming; left
  unmarked so his dialogue defaults to normal comprehension. See Concerns.

### 4. `story-graph-schema.md` (canonical + zcode synced)
- Documented the optional `foreign_dialogue` field on npc-agenda entries
  (`source_language` structured key + optional `sample_line`), with a worked
  example and a note describing the runtime consumption path
  (`build_dialogue_comprehension_directive` → `narrative_directives.dialogue_comprehension`).

## Test summary

TDD: wrote 8 failing tests first (red), then implemented (green).

`tests/test_narrative_enrichment.py` (8 new tests):
- `test_dialogue_comprehension_directive_low_skill_yields_gist_or_none` — low
  skill → comprehension in {gist, none}, `translation_visible=False`, rule
  demands source display.
- `test_dialogue_comprehension_directive_fluent_allows_full_translation` —
  fluent → `translation_visible=True`.
- `test_dialogue_comprehension_directive_absent_when_no_foreign_dialogue` —
  unmarked NPC → directive key absent.
- `test_dialogue_comprehension_directive_only_scenes_npcs_in_scene` — only
  NPCs in `scene.npc_ids` are considered.
- `test_dialogue_comprehension_directive_placeholder_when_no_investigator` —
  no investigator in ctx → placeholder entry (`comprehension=None`,
  `requires_investigator_skill=True`), rule instructs narrator/runner to gate
  on structured skill value.
- `test_dialogue_comprehension_directive_uses_investigator_skills_dict` —
  slim `investigator_skills` dict path resolves the tier.
- `test_dialogue_comprehension_directive_absent_when_coc_language_unavailable` —
  `coc_language=None` → no directive, no crash.
- `test_build_dialogue_comprehension_directive_helper_signature` — helper
  returns structured list with canonical keys.

`tests/test_story_director.py` (1 new test):
- `test_build_director_context_exposes_investigator_skills_for_dialogue_gate` —
  ctx now carries `investigator_skills` from the character sheet.

Full suite: **1068 passed, 0 failed** (was 1067 before; +1 new director test).
Sync check: `plugin copies are in sync`.

End-to-end verified manually with the real white-war starter scenario + the
`federico-marchetti-ww1-20260708` investigator (who has no German skill): the
directive correctly emits `comprehension: "none"` with rule "展示源语原文与
语气/表情，不翻译；调查员听不懂具体意思。"

## Design decisions & gap handling

The brief anticipated that investigator skills might not be available in ctx.
Findings:
- `build_director_context` reads the character sheet internally (for rule
  signals) but did NOT expose it in the returned ctx.
- Two options were considered: (a) emit a placeholder directive and document
  the gap, (b) expose the investigator's skills in ctx so live play gets a real
  tier.

Chose (b) as the primary path (minimal, backward-compatible one-line addition
to the director ctx return) AND kept (a) as the fallback: if neither
`investigator` nor `investigator_skills` is present in ctx, the helper emits a
placeholder entry with `comprehension=null` and `requires_investigator_skill=true`,
plus a narrator-facing rule that explicitly instructs gating on the structured
Language skill value. This satisfies the constitution (structured skill value,
no prose scan) and the brief's "adapt honestly" guidance.

## Concerns

1. **Stale live campaigns**: existing compiled campaigns under `.coc/campaigns/`
   (e.g. `live-white-war-restart-20260708`) were compiled BEFORE this change,
   so their `npc-agendas.json` lacks the `foreign_dialogue` marker. They will
   NOT emit the directive until recompiled from the updated starter scenario.
   This is expected (compiled artifacts are snapshots); no action needed beyond
   noting that re-importing/recompiling the white-war scenario picks up the
   marker.

2. **`npc-tomasso-like-survivor` intentionally unmarked**: the old mountain man
   is a civilian conscripted by Austrians, but his voice is a "regional
   dialect" and the scenario does not clearly establish that his speech is
   foreign to the Italian investigators. Marking him would over-claim a
   comprehension gate that the source fiction does not clearly support. Left
   unmarked; can be revisited if a future scenario edit clarifies his language.

3. **`native` field in placeholder path**: when the investigator is unknown
   (placeholder path), `native` is set to `None` (not `false`) to distinguish
   "unknown" from "known non-native". Consumers should treat `None` as "not
   yet resolved".

4. **Narrator contract not yet consumed**: this task wires the directive into
   `narrative_directives`. Whether the narrator/runner actually reads
   `dialogue_comprehension` and gates visible text on it is a downstream
   concern (narration contract / live turn runner rendering). The directive is
   now present and structured; a follow-up can add an assertion or render-side
   test if needed.
