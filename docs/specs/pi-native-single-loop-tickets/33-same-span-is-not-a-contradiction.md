Status: ready-for-agent
Stage: SL-33 (P0, PDF reading path; blocks SL-29)
Spec: docs/kernel-rpc.md §20, §22 (publication gate, contradictions), §90.5

# SL-33 — A re-transcription of the same span is not a contradiction; no duplicate reading of a focus in flight

## Evidence (SL-29A, 2026-09-24, worktree chatrpgv4-wt-pdf-a; module `.coc/modules/book-1/`, both refusals in its `findings.json`; worker logs `.coc/playtests/sl29-a-import/`)
- guidance published the module node's `investigator_hook` with two misreadings of one sentence (卡片 for 车卡, 轰蹭 for 轰趴). Both opening readings read the same page more accurately; the publication gate refused each as "the new reading contradicts a published value", not retryable; the App-style retry failed the same way. About 3 min and 35–50 calls per attempt; whether an import succeeds depends on whether the second reader happens to copy the first's errors.
- When the worker's 120 s foreground wait expired it re-entered preparation and a connection-point repair job (`read-4`, focus `xu-mu`) read the same pages while the first opening reading was still running: 18 calls, 286K tokens, cancelled at exit.
- The player only sees "The preparation stopped before it answered"; the reason stays in the hidden detail.

## Scope
1. Contract first (§22 amendment): two readings of the same source span (same page anchor / evidence span) for one field are the same fact transcribed twice, never a contradiction: the later, reviewed reading replaces the earlier value and records the replacement; a contradiction is a different value from a different span or a claim the book states elsewhere. No word-level comparison, no similarity threshold in code: the rule is structural (span identity); where spans are not recorded, record them.
2. A focus already being read is not read again by a repair or preparation job until that reading settles; the worker's re-entry after the foreground wait attaches to the running job.
3. The player-visible refusal names the field and the reason from `findings.json` (one sentence, data-derived).
4. Tests, mutation-killable, on a fixture PDF the suite owns (two readings of one page differing in transcription; the gate accepts the second); a duplicate-focus test; then the manual check: a fresh module id for 血色公路, the App's worker order through `opening`, reporting stages and calls; stop before `converse`.

## Comments
