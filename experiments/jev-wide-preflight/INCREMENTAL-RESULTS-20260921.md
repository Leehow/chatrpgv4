# Context-aware incremental material supply: diagnostic results

Date: 2026-09-21. **Static component experiment; not a campaign, true-table acceptance, or production change.**

## Bounded conclusion

The prototype can recognize existing material and avoid reinjecting it, but the current page-level semantic policy does **not** reliably produce only the missing necessary material. It both overselects and misses a clearly needed fact. Its consistency behavior also requires scoped source review: a question-extraneous contradiction can block progress, while an unsupported additional effect is not necessarily a strict contradiction. Keep supplementation and agent judgment available; do not turn these uncalibrated argmax decisions into an authoritative completeness gate.

This does not overturn the earlier wide-retrieval result. Finding relevant material from an empty context and selecting the minimal useful delta against an existing context are different tests. Independently asking whether each page adds something to the same initial context also does not resolve overlap among the pages selected concurrently.

## Frozen design

Six authored source questions: posted clinic hours/emergency phone, veterinary syringe procedure, heat/dehydration, road chase, named cult spell/item, and mine radiation. Each is tested twice under six conditions:

| Condition | Actual supplied context |
| --- | --- |
| none | No original source material |
| partial | Multi-page questions lack their sorted middle required page; single-page questions retain only exact first-requirement source spans |
| full | All pages supporting the frozen requirements, plus an agreeing unverified claim |
| summary | A deliberately non-numeric topic summary, not the necessary source facts |
| stale | The same full original text carrying an obsolete revision; the host excludes it from current evidence |
| conflict | Full original text plus a disagreeing unverified claim |

V2 pairs the agreeing/disagreeing claims in the same language, about the same fact and with matching syntax. Full heat material is pages 90/92/93; partial heat has 90/93 and lacks 92. Context condition names, gold requirements and expected outcomes are not sent to Jev.

Jev first independently judges factual coverage and relevant consistency. `sufficient+clear` skips discovery; conflict/uncertainty requests review. Otherwise, it evaluates every remaining native-text page with Choice (`adds_needed`, `redundant`, `unrelated`, `uncertain`) against the current context, at HTTP concurrency 16. There is no fixed top-K or confidence threshold. The host removes exact already-supplied ranges; a final Jev call checks the real combined context. Requests have a conservative 30,000-byte bound; oversized final checks remain unresolved rather than silently truncating source text.

The host's revision checks and exact-range deduplication are deterministic guarantees, **not evidence that Jev itself recognizes stale data or duplicates perfectly**. A full condition means the diagnostic labels are supplied; those labels are not a proof that every possible interpretation of an open question is exhaustively answered.

## Evidence and iterations

All directories below are retained under `.pi/prototypes/jev-incremental-preflight-20260921/runs/`:

- V1: `2026-09-21T07-29-51.522Z-akSdXP/` — 72 records, 969 successful requests. Its source and fixture snapshot is in `implementation-snapshot/`; unchanged raw decisions were separately re-audited in `raw-gate-audit.json`.
- V2: `2026-09-21T07-41-40.388Z-UTM6PB/` — 72 records, 973 successful requests; structured aggregation is `analysis.json`.
- Source-audit synthesis: `.pi/prototypes/jev-incremental-preflight-20260921/source-audit-notes.md`, retaining both the initial source review and later CON/HP clarification.
- Post-hoc disambiguation: `posthoc-loss-scope-wKy2S8/`, four calls that explicitly contrast Constitution-not-HP with HP-not-Constitution. These do not replace V2.
- Two earlier full-context startup probes received HTTP 529 and remain in `2026-09-21T07-24-30.356Z-hTyTll/` and `2026-09-21T07-25-20.809Z-mBV1ku/`. They are service failures, not semantic results. A minimal wire probe, split-question diagnostics and a later successful full gate are retained separately. No automatic retry erased a failed attempt.

V1 exposed three experimental confounds: raw model misjudgments could be hidden by a conservative host outcome; reconstructed source fragments lost their original order/positions; full/conflict notes were not matched controls. V2 fixes those, not the model's mistakes. All six queries and all 24 frozen requirements were checked unchanged between V1 and V2. No gold or threshold was tuned against the later outputs. V2 is a corrected repeat on known diagnostics, not a held-out evaluation or an accuracy improvement claim.

V2 used pinned `jev-1.13.0`: **973/973 requests successful, 5,012 questions, 8,437,809 reported input tokens**. Estimated Jev input cost: **USD 0.354387978**, excluding other runs. V1's estimate was USD 0.351639498. These are estimates at the recorded rate, not invoices. Native extraction was already available; provider-internal cache behavior is unknown.

## V2 results

Each condition contains six questions repeated twice, **not twelve independent production questions**.

| Condition | Coverage of frozen known requirements after processing | Host outcomes | Median time | Median added original-text bytes |
| --- | ---: | --- | ---: | ---: |
| none | 12/12 | 8 ready; 2 still missing; 2 final-check budget limits | 1.680 s | 13,995 |
| partial | 8/12 | 6 ready; 4 still missing; 2 review | 1.510 s | 6,791.5 |
| full | 12/12 initially present | 9 immediately ready; 2 still missing; 1 review | 0.3695 s | 0 |
| summary | 12/12 | 9 ready; 3 final-check budget limits | 1.4735 s | 15,108.5 |
| stale | 12/12 after retrieval | 8 ready; 2 still missing; 2 final-check budget limits | 1.6315 s | 14,764 |
| conflict | 12/12 source facts present | 10 review; **2 clear/ready routes on the semantically disputed HP fixture** | 0.3535 s | 0 |

There were no observed coverage-`sufficient` answers contradicting the **frozen source-coverage labels**. The automatic expected-label scorer flags the two HP-fixture ready routes, but independent semantic review found that stimulus ambiguous; those flags are retained and are not treated as two proven contradiction misses. Raw coverage judgments, combined gate judgments and host-level readiness remain separate fields, including when a failed provider call causes the host to block an incorrect model answer. Mechanical label agreement is not the final semantic verdict.

All twelve full-context trials added zero text, but only nine skipped discovery and immediately returned ready. The other three are not successful fast-path decisions. Duplicate source bytes were zero across the run **because the host subtracts exact ranges**. Added-byte medians for partial contexts include unsuccessful zero-add cases; do not advertise a byte-saving percentage without conditioning on answer coverage.

## Concrete successes and failures

### A real incremental success

The heat partial fixture already contains pages 90 and 93. Both repeats select **only page 92**, adding 4,540 original-text bytes, with no repeated source ranges. The final gate still conservatively says missing despite the frozen requirements being present. Thus material selection succeeds here; the global sufficiency judgment remains unsettled.

### A clear missing-fact failure

The clinic partial fixture contains posted working days/hours but not the emergency phone number. The initial gate correctly says missing. The page containing the telephone is nevertheless classified `unrelated`, and no page is added in either repeat. Its first-repeat distribution is `unrelated: 0.49`, `adds_needed: 0.26`, `redundant: 0.25`, with **confidence 0.32**. The final gate continues to say missing, so the system does not falsely claim an answer, but it has failed to supply an available required fact.

This is direct evidence against relying on the winning Choice alone as a hard relevance rejection. The experiment deliberately did not add a post-hoc confidence threshold to turn it green.

### Extra pages are not all equally wrong

- Syringe partial needs the rest of page 84, but both repeats also select pages 81/82/83. Independent source review finds those are pursuer background, chase actions and other weapons/collisions; they do not supply the syringe's missing facts or its unstated conscious-impairment duration.
- Cult partial needs page 105 and also selects 96/97. Page 96 has substantive value for the question's opening about what cultists possess; page 97 adds optional scope details. They cannot simply be scored wrong because the frozen gold omitted them.
- Mine partial needs page 105 and also selects 60/64/65/66. Several are optional related-building hazards; page 66 has useful entrance-water/radiation evidence. Again, relevance and necessity must be evaluated, not inferred from gold membership alone.

Broad chasing/character material can grow to roughly 47–59 KB of proposed added text. Seven V2 final checks exceed the prototype's request bound and remain unresolved. The byte limit is not raised or hidden. This illustrates the cost of choosing every individually useful page without jointly minimizing the addition set.

### A disputed conflict stimulus, followed by a separate disambiguation

The mine source says a failed exposure check loses **CON**. The V2 fixture says it costs **HP**, without denying CON loss. Both repeats choose `sufficient/clear`; consistency confidence is **0.51** in repeat 1 and **0.36** in repeat 2. Natural rule-summary reading suggests a wrong attribute substitution, but the two claims can logically coexist. The actual consistency question explicitly excludes compatible facts and does not test every claim for source support. Independent review therefore rejects a strong claim that these are two proven contradiction misses. The extra HP consequence is still **unsupported**, not accepted as a source fact.

A separate, explicitly post-hoc four-call probe changes only the note to matched assertions about the source's stated loss: “Constitution, not HP” versus “HP, not Constitution.” Both agreeing calls return clear; both conflicting calls return conflict (conflict confidence 0.96). These calls clarify the stimulus boundary; they do not overwrite V2, alter its original labels, prove broad reliability, or tune a threshold.

Chase material contains a real but question-extraneous disagreement: the harpoon line is eighty feet on page 81 and fifty feet on page 83. The question asks participants, initiative and collision damage, not harpoon range. Review therefore treats blocking this question for that disagreement as a scope/relevance false alarm; the Choice responses do not reveal whether this was actually the model's cause.

### Source omission is not necessarily retrieval omission

The syringe source specifies the maneuver, hard CON resistance, conscious penalties, and unconscious durations, but does not state the conscious-penalty duration. A conservative missing judgment can reflect that source limitation rather than a missing page. A writer should acknowledge the unspecified duration, not invent it or keep fetching unrelated pages. Source material completeness and the source itself answering every possible detail are distinct.

## Review and decision

- `.pi/findings/jev-increment-review.md`: bounded GO for the corrected measurements, ordered source projection and matched note controls; not model-quality acceptance.
- `.pi/prototypes/jev-incremental-preflight-20260921/source-audit-notes.md`: retained synthesis of the initial source review (extraneous conflict, source omission, extra pages) and subsequent CON/HP clarification. The latest detailed clarification is `.pi/findings/jev-increment-quality.md`. Neither claims to know the model's unstated reasoning.

The experiment supports an **advisory incremental material path**, not a guaranteed minimal-supplement path. The next design work should separate missing evidence points from selecting a jointly sufficient candidate set, retain and act on uncertainty, and use a finer evidence unit where page-level decisions hide an essential fact. This report does not implement that next design or claim it will necessarily fix the observed cases.

All failures, first-run confounds and raw outputs remain preserved. Production, actual player turns, world settlement and App packaging were untouched.
