# Ordinary improvisation: implementation and live acceptance

## Intent and baseline

The owner rejected source coverage as a permission gate for fiction. Success means an unlisted but plausible place, person and lead can enter play promptly and remain usable on later turns. A working lookup, a new schema or a large passing test count without playable continuation is insufficient.

Baseline: `11c0d8ccd`, branch `0.9.6a`, initially clean. The prior canonical App's Nora campaign ended its police-return turn by explicitly saying that police-station material was still being read and arrival could not happen. The UI still showed the cemetery. That is retained adverse evidence, not an acceptable degraded outcome.

Primary guidance: the supplied Call of Cthulhu Keeper Rulebook, printed pp. 189, 199, 201, 217 and 221 (PDF pages +12). In particular, p. 201 allows plausible new evidence not listed by a scenario, using established event causality. Cross-checks: [TypeSafe intent routing](https://docs.typesafe.ai/patterns/intent-routing) retains handlers for open LLM work; [Fate Core Scenario In Play](https://fate-srd.com/fate-core/scenario-play) uses motivations and player choices to adapt prepared material. Fate is a different rules system; only the preparation principle is relevant here.

## Implemented prototype

- Contract section 150 supersedes the mandatory adaptation route for ordinary additions.
- Existing `apply move` and `apply clue` accept an explicit `establish: {summary}` declaration. Route/acquisition context remains required; player admission and ordinary transactions remain owners.
- World records project into the campaign graph on every load; source graph bytes remain unchanged. NPCs retain the existing `walk_on` path. Decorative detail requires no structured record.
- Lookup now searches projected campaign entities and marks them usable without source review. A later exact same-name source entry cannot seize the established campaign handle. Nonexact identity reconciliation remains explicit.
- Unconditional destination-source preflight was removed. Source lookup remains available for actual missing facts. The Keeper receives a normal improvisation instruction, not a new planner or a separate author/reviewer pipeline.
- A known source scene's incomplete dossier does not by itself prevent arrival. Existing action admission remains unchanged in purpose and includes new establishment content in its reuse key.
- Divergent worldline entity records refuse confluence instead of silently discarding one branch. Automatic reconciliation is outside this prototype.

## Verification so far

- `npm run check:kernel` and runtime build passed.
- Full kernel/play suite: 2,026 passed in 357.46 s (`.pi/improvisation-full-py.log`). This run used the first emitted prototype; subsequent lookup-label/provenance and confluence corrections have focused follow-up coverage.
- Final emitted worldline/improvisation regression: 43 passed in 36.85 s (`.pi/improvisation-final-py.log`).
- Focused extension/admission/source run: 26 passed (`.pi/improvisation-focused-ext.log`).
- Bound-PDF test found and then fixed an incorrect `unprepared` label on a campaign-created clue. Adverse run: `.pi/improvisation-pdf-regression.log`; corrected actual-PDF fixture: `.pi/improvisation-pdf-followup.log`.
- Source immutability, late same-name publication, player-admission binding and confluence preservation: 3 passed in `tests/extension/table-improvisation.test.mjs`.
- Remote test host probe reported unreachable; tests ran locally. No remote checkout was changed.
- Full extension suite: 3,804/3,817 passed in 440.80 s (`.pi/improvisation-full-ext.log`). The 13 failures exercised the superseded mandatory scene-material/adaptation route. Updated arrival expectations preserve incomplete-coverage reporting and explicit index-page access. Source-owner mutation/retry/fault tests now read an authored clue rather than require a dossier before ordinary movement; isolation and publication assertions remain.
- Six affected files: 59 passed, 9 fixture failures after changing the source-owner subject to a clue (`.pi/improvisation-contract-followup.log`). The fixture needed a conclusion supported by that clue and a valid final scene. Corrected source-owner suite: 12/12 passed (`.pi/improvisation-source-owner-followup.log`). This is focused recovery, not a claim of a second full-suite run.
- Review found source-text headers explicitly prohibited inventing absent people, clues and exits. The scene/person/pending messages now share the section 150 improvisation guidance. Ordinary checks also no longer wait for a complete scene dossier; actual person/evidence/mechanical requirements keep their specific owners.
- Final typecheck and 18 source/improvisation/system-language/world-state seam checks passed (`.pi/improvisation-final-ext.log`). Review included every scoped tracked diff and the three new code/test files; no unowned changes were staged.

## Live evidence

Pending the signed canonical package and Computer Use continuation. Do not treat the deterministic scenarios above as Keeper play or as a latency result.
