# Craft-routing ablation: results

**Date:** 2026-10-05  
**Status:** offline writing research; production 2.3.1, load/default/state/receipt/App/campaign unchanged

## Executive summary

This ablation tests explanations for `NONE` and separates routing coverage from writing benefit. It supports **scoped applicability** as a viable retrieval design: it retrieves a method when the method fits the request, while residual-only routing does not. It does **not** establish that routed cards improve prose reliably, that minimal context is the overall winner, or that production should switch now. Retain `NONE` when no method is applicable.

The experiment used eight cases (six constructed, two prior source-derived), 37 completed native first drafts (32 factorial drafts plus five distinct routed packets), 16 primary blind native reader requests, and 10 diagnostic requests. All generation used Flapcode `gpt-6-luna`, low thinking; no Astra or Grok. Jev answered independent need/fit/broad/scoped questions per card. Policy variants reused those raw answers; these were not 80 independent API calls.

## Design and routing coverage

Methods/cards and the other guidance were unchanged. Full and minimal were separate states, with full requests fixed before minimal; therefore routing timing is not causal. The minimal core was 7,010 B versus 12,995 B for full, plus identical keeper, natural-NPC, and Chinese guidance. Relevance allowed 0–1 card. The selected masks/direct-answer packet differs from the human explanation intervention and must be judged as a separate packet, not automatically wrong.

| Routing policy | Full: selected/total | Minimal: selected/total |
|---|---:|---:|
| residual + broad | 0/8 | 0/8 |
| applicability + broad | 5/8 | 6/8 |
| residual + scoped | 0/8 | 0/8 |
| applicability + scoped | 8/8 | 8/8 |
| residual + broad, relaxed diagnostic | 3/8 | 2/8 |

There were 16 actual Jev HTTP batches (8 cases × 2 bases), all complete. The 80 completed items were derived POLICY-CASE-BASE decisions (8 × 5 × 2), not 80 requests. Routing yielded 0/16 residual, 11/16 applicability+broad, 16/16 applicability+scoped, and 5/16 relaxed selections; these are routing-coverage results, not independent request counts.

The experimental core retained hard duties in an independent model audit: source/knowledge/agency/identity and receipt boundaries, complete first-view and first-meeting presentation, whole supplied readout, unknown-history and heard-name limits, mood-before-speech ordering, exact speech tokens, urgent priorities, source-silent behavior, settings, and existing-state discipline. It also retains residual abstract overlap with several optional methods (guided perception, object resistance, textured quiet, direct answer, immediate warning, connected explanation). This is not production-parity evidence.

## Primary reader comparisons

The 16 primary blind-reader contexts were Flapcode GPT-6-Luna at low thinking, not Jev. Each context supplied four paired opinions, producing 64 primary pair verdicts over eight cases—not 64 independent samples. These are correlated, task-specific model opinions rather than human observations or stable statistical evidence.

| Pair | Total wins |
|---|---:|
| Full card: `full-none` vs `full-matched` | 7.5 : 8.5 |
| Minimal card: `minimal-none` vs `minimal-matched` | 8 : 8 |
| No card: `full-none` vs `minimal-none` | 8 : 8 |
| With card: `full-matched` vs `minimal-matched` | 4 : 12 |

Environment/NPC split:

| Pair | Environment | NPC |
|---|---:|---:|
| Full card (`none` : `matched`) | 3 : 5 | 4.5 : 3.5 |
| Minimal card (`none` : `matched`) | 4 : 4 | 4 : 4 |
| No card (`full` : `minimal`) | 2 : 6 | 6 : 2 |
| With card (`full` : `minimal`) | 2 : 6 | 2 : 6 |

The base/no-card result is a tie overall, with opposite domain patterns: minimal leads environment 6–2, while full leads NPC 6–2. The full-card increment is only 8.5–7.5; the minimal-card increment is tied. The apparent 12–4 minimal-with-card result cannot be called an overall winner: the primary design lacks the full-none versus minimal-matched diagonal, and both additive card contrasts are weak or tied. Selecting more cards alone therefore cannot justify production deployment.

## Diagnostics and reviewer evidence

These task-specific opinions found that Masks/full routed direct-answer beat full-none 2:0 and full matched-explanation 2:0; Masks/minimal routed-direct tied minimal-none 1:1 and beat matched-explanation 2:0. Full formal routed-direct lost 0:2 against both baseline and matched explanation, while minimal formal comparisons were both 1:1. Gazette routed-quiet beat minimal-none 2:0 and tied matched-view 1:1. These opinions should not be treated as reliable universal utility or a general card benefit.

The quote audit contains 63 reviewer claims, of which three are nonliteral; literal matching does not verify semantics. Root-confirmed source/say examples should remain distinct from disputed critiques about joint versus separate owner confirmations, article-memory precision, and evidence-layer wording. Human matched-card interventions were fixed before the data and withheld from Jev; agreement is not perfect semantic ground truth, and there was no human agreement validation.

The core audit found no lost hard duties and the material review found no conflicts. This establishes fit for offline comparison, not production parity.

## Material and operational notes

| Arm | Guidance median | Supplied-file median | Output chars | Native time median |
|---|---:|---:|---:|---:|
| full-none | 12,995 B | 60,779 B | 197.5 | 40.76 s |
| full-matched | 13,834.5 B | 61,603.5 B | 176 | 50.83 s |
| minimal-none | 7,010 B | 54,794 B | 191.5 | 50.63 s |
| minimal-matched | 7,849.5 B | 55,618.5 B | 194 | 47.30 s |

Supplied-file bytes are not actual single Keeper prompts. Native usage/cache fields are actual multi-tool session accounting. Wall-time medians are not player latency and are not evidence of causal speed. Output-length bias was addressed in the instructions; fresh-reader order was reversed without clipping prose.

Two blocked path-typo reads were recovered before one successful write; raw errors remain preserved. There was no first-draft regeneration, best-of selection, output-based threshold tuning, or live-gameplay measurement.

## Limits and conclusion

This is 37 single-draft samples across correlated pairwise model opinions, not human, statistical, or stable evidence. The eight cases and source-derived snapshots are offline writing research, not live gameplay or all-module coverage. The results justify testing scoped applicability further and retaining `NONE` for genuinely non-applicable requests, but not an immediate production switch.

Relative artifacts: [`experimental-core.md`](experimental-core.md), [`method-cards.json`](method-cards.json), [`protocol.json`](protocol.json), [`routing-counts.json`](routing-counts.json), [`review-protocol-amendment.json`](review-protocol-amendment.json). Main raw evidence is [the evaluation directory](../../../.coc/evaluations/craft-routing-ablation-20261005/), including [`comparison.html`](../../../.coc/evaluations/craft-routing-ablation-20261005/comparison.html).

Method references (supporting method, not these results): [Noul](https://docs.typesafe.ai/primitives/noul), [Score](https://docs.typesafe.ai/primitives/score), [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), and [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices).
