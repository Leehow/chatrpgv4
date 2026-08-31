# Development family source review

- Reviewer identity: `codex-reviewer-development-source-20260831`
- Producer identity: `coc.rule-graph-compiler.v1` via
  `tests/fixtures/_gen_rulegraph_source_families_v1.py`
- Source: exact 40th Anniversary Keeper Rulebook PDF, SHA-256
  `a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb`
- Reviewed PDF indices: 105, 106, 110, 180
- Verdict: **ACCEPTED for development source coverage; not promoted**

## Review

The earlier `source-stage1/section-reference-lookups-source` candidate is not a
development-family candidate: it binds skill/equipment/cash lookup windows and
declares only partial coverage. It is therefore rejected as evidence for
Development Phase completion.

The replacement candidate covers the actual Development Phase rules:

- phase timing at scenario/chapter end or a suitable campaign pause;
- eligible skill checks, the bonus-die and opposed-loser exclusions, one check
  per skill, and the Cthulhu Mythos/Credit Rating exclusions;
- the D100 improvement test, over-95 rule, 1D10 gain, and values over 100;
- the 90+ skill mastery reward of 2D6 current SAN;
- Luck-spend exclusion and end-of-session Luck recovery, capped at 99;
- referenced self-help/finance/backstory activities and the per-development
  reduction of habituation totals.

The candidate keeps `development.settle` and `state.end_session` as existing
legacy capabilities. It does not claim that free-form self-help, employment,
or backstory editing are implemented by the deterministic settlement adapter.
Those source rules are retained as an explicit exception node rather than
silently omitted.

All applicable Development Phase source rules in this declared scope have a
bound page span. `unresolved_applicable_rules` is empty, the accepted shard has
a machine-generated non-null digest, production graph/manifest files are
untouched, and runtime ownership remains `legacy/visible`.
